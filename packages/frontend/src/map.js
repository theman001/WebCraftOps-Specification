// 실시간 2D 지도: bridge-paper가 렌더링한 청크 타일(PNG)을 캔버스에 그리고, 드래그로
// 이동·휠로 확대/축소한다. 서버가 이미 완성된 이미지를 주므로 클라이언트는 그리기만
// 하면 되고, 청크가 늘어나도 3D 뷰어처럼 느려지지 않는다(구 버전은 청크가 늘수록 클라
// 이언트가 메쉬를 계속 새로 만들어야 해서 느렸다 — 그게 이번 개편의 이유).
//
// [디버깅] 엔티티가 지도에 안 보이면 브라우저 콘솔에서 "[EntityStream]" 로그를 먼저
// 확인 — SSE 연결 자체가 안 됐는지, 연결은 됐는데 파싱이 실패하는지 구분된다.
const TILE_BLOCKS = 16; // 타일 하나 = 청크 한 칸(16블록)
const TILE_SYNC_DEBOUNCE_MS = 250;
// [실측 확인된 버그 → 수정] 지도를 처음 열면 뷰포트에 걸친 타일(넓게 보면 수백 개)이
// 한꺼번에 요청됐는데, 브릿지 쪽에서 그만큼의 렌더 작업이 메인 스레드에 몰려 실제로
// 서버가 30초간 응답 없음(Paper Watchdog) → 강제 종료 → 재시작을 실측으로 확인했다.
// 동시 요청 개수를 여기서도 제한해서(브릿지 쪽 세마포어와 이중 방어) 애초에 몰아치지
// 않게 한다.
const MAX_CONCURRENT_TILE_LOADS = 4;
const MIN_SCALE = 0.5;
const MAX_SCALE = 16;
const MARKER_SIZE = 16; // 화면 픽셀 고정 크기(줌과 무관 — 마커가 안 사라지거나 안 커지게)
const CLICK_DRAG_THRESHOLD = 4; // 이 이하로 움직이면 드래그가 아니라 클릭으로 취급
// 백엔드 EntitySnapshotBroadcaster가 6틱(300ms)마다 스냅샷을 보낸다 — 이 구간을 화면에서
// 선형 보간해서 그린다(전송 빈도는 그대로 두고, 매 프레임 그리는 화면 쪽만 부드럽게).
const SNAPSHOT_INTERVAL_MS = 300;

export const createMap = ({ canvas, statusEl, onPlayersUpdate, onFocusChange, onSpawnPoint, onPlayerDropTeleport }) => {
  const ctx = canvas.getContext("2d");

  let currentBridgeUrl = null;
  let originX = 0; // 캔버스 중심이 가리키는 월드 X
  let originZ = 0;
  let scale = 4; // 픽셀/블록

  const tiles = new Map(); // "cx,cz" -> { img, status: "loading"|"ready"|"error" }
  let dragging = false;
  let dragStart = null;
  let dragMoved = 0;
  // 드래그가 플레이어 마커 위에서 시작됐으면 여기 기록 — CLICK_DRAG_THRESHOLD를 넘겨서
  // "진짜 드래그"가 되면 지도를 패닝하는 대신 그 플레이어를 드롭 지점으로 텔레포트시키는
  // 모드로 취급한다(임계값 이하로 끝나면 기존처럼 그냥 클릭=포커스 고정).
  let playerDragTarget = null; // {x,y,wx,wz,category,id,name} — 드래그 시작 시점의 히트 정보
  let syncTimer = null;
  let eventSource = null;
  let entityEventSource = null;
  let spawnPoint = null; // {x,y,z} | null

  const entityVisibility = { players: true, mobs: true, items: true };
  let latestEntities = { players: [], mobs: [], items: [] };
  const mobIconCache = new Map(); // type -> HTMLImageElement
  const itemIconCache = new Map(); // material -> HTMLImageElement
  const playerIconCache = new Map(); // uuid -> HTMLImageElement
  let markerHitTargets = []; // draw()마다 갱신 — 클릭/호버 히트테스트용 {x,y,radius,wx,wz,category,id,name}
  let hoverPoint = null; // 캔버스 기준 커서 좌표 {sx,sy} | null(캔버스 밖)
  // "포커스"는 한 번 중앙으로 이동하고 끝나는 게 아니라, 그 엔티티가 움직이는 대로 지도
  // 중심을 계속 그 엔티티에 고정하는 개념이다 — 매 스냅샷마다 좌표를 다시 읽어와 origin을
  // 갱신한다. 실제로 지도를 드래그하면(다른 곳을 보고 싶다는 뜻이므로) 자동 해제한다.
  let lockedTarget = null; // { category, id, name } | null

  // 스냅샷은 300ms에 한 번만 오는데 화면은 매 프레임(rAF) 그리므로, 스냅샷 사이 구간을
  // 이전 위치→새 위치로 선형 보간해서 그린다 — 안 그러면 스냅샷마다 순간이동하듯 뚝뚝
  // 끊겨 보인다(온라인 게임 클라이언트가 흔히 쓰는 방식 — 전송 빈도가 아니라 렌더링
  // 쪽에서 부드럽게 만든다).
  const motionState = { players: new Map(), mobs: new Map(), items: new Map() }; // id -> {prevX,prevZ,currX,currZ,t0}

  const idOf = (category, entity) => (category === "players" ? entity.uuid : entity.id);

  const interpolate = (state, now) => {
    const t = Math.min(1, (now - state.t0) / SNAPSHOT_INTERVAL_MS);
    return { x: state.prevX + (state.currX - state.prevX) * t, z: state.prevZ + (state.currZ - state.prevZ) * t };
  };

  // 지금 화면에 보이는(보간 중인) 위치를 그대로 다음 구간의 시작점으로 삼는다 — 안 그러면
  // 새 스냅샷이 올 때마다 이전 목표 지점으로 순간 복귀했다가 다시 움직이는 것처럼 보인다.
  const updateMotionState = (category, entities) => {
    const map = motionState[category];
    const now = performance.now();
    const seen = new Set();
    for (const entity of entities) {
      const id = idOf(category, entity);
      seen.add(id);
      const prev = map.get(id);
      const start = prev ? interpolate(prev, now) : { x: entity.x, z: entity.z };
      map.set(id, { prevX: start.x, prevZ: start.z, currX: entity.x, currZ: entity.z, t0: now });
    }
    for (const id of Array.from(map.keys())) {
      if (!seen.has(id)) map.delete(id);
    }
  };

  const positionOf = (category, entity) => {
    const state = motionState[category].get(idOf(category, entity));
    return state ? interpolate(state, performance.now()) : { x: entity.x, z: entity.z };
  };

  const key = (cx, cz) => `${cx},${cz}`;

  const worldToScreen = (wx, wz) => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.width / 2 + (wx - originX) * scale, y: rect.height / 2 + (wz - originZ) * scale };
  };

  const screenToWorld = (sx, sy) => {
    const rect = canvas.getBoundingClientRect();
    return { x: originX + (sx - rect.width / 2) / scale, z: originZ + (sy - rect.height / 2) / scale };
  };

  const loadIcon = (cache, src) => {
    let img = cache.get(src);
    if (img) return img;
    img = new Image();
    img.src = src;
    cache.set(src, img);
    return img;
  };

  const mobIconFor = (type) => {
    const src = `assets/mobs/${type.toLowerCase()}.png`;
    const img = loadIcon(mobIconCache, src);
    img.onerror = () => {
      // 크롭 안 된 타입 — 범용 폴백으로 대체(한 번만 갈아끼우면 이후 캐시가 폴백을 반환).
      if (img.src.endsWith("_fallback.png")) return;
      img.onerror = null;
      img.src = "assets/mobs/_fallback.png";
    };
    return img;
  };

  const itemIconFor = (material) => loadIcon(itemIconCache, `assets/items/${material.toLowerCase()}.png`);

  const playerIconFor = (uuid) => {
    if (!currentBridgeUrl) return null;
    let img = playerIconCache.get(uuid);
    if (img) return img;
    img = new Image();
    img.src = `bridge/players/${uuid}/head?bridgeUrl=${encodeURIComponent(currentBridgeUrl)}`;
    playerIconCache.set(uuid, img);
    return img;
  };

  const drawMarker = (img, wx, wz, label, hit) => {
    const { x, y } = worldToScreen(wx, wz);
    const half = MARKER_SIZE / 2;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, x - half, y - half, MARKER_SIZE, MARKER_SIZE);
    } else {
      ctx.fillStyle = "#6bc72e"; // --xp — UI 개편으로 새 팔레트에 맞춤(기존 청록 악센트 폐기)
      ctx.beginPath();
      ctx.arc(x, y, half * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const isLocked = lockedTarget && lockedTarget.category === hit.category && lockedTarget.id === hit.id;
    if (isLocked) {
      ctx.strokeStyle = "#e0b64a"; // --gold
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, half + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (label) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y - half - 3);
    }
    markerHitTargets.push({ x, y, radius: half, wx, wz, ...hit });
  };

  const hitTestMarker = (sx, sy) => {
    for (const target of markerHitTargets) {
      const dx = sx - target.x;
      const dy = sy - target.y;
      if (dx * dx + dy * dy <= target.radius * target.radius) {
        return target;
      }
    }
    return null;
  };

  const drawTooltip = (target) => {
    ctx.font = "11px sans-serif";
    const paddingX = 6;
    const textWidth = ctx.measureText(target.name).width;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = 18;
    const boxX = target.x - boxWidth / 2;
    const boxY = target.y - MARKER_SIZE / 2 - 3 - boxHeight;
    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f1f5f9";
    ctx.textAlign = "center";
    ctx.fillText(target.name, target.x, boxY + boxHeight - 5);
  };

  const drawEntities = () => {
    markerHitTargets = [];
    if (entityVisibility.items) {
      for (const item of latestEntities.items) {
        const { x, z } = positionOf("items", item);
        drawMarker(itemIconFor(item.material), x, z, null, {
          category: "items",
          id: item.id,
          name: item.material,
        });
      }
    }
    if (entityVisibility.mobs) {
      for (const mob of latestEntities.mobs) {
        const { x, z } = positionOf("mobs", mob);
        drawMarker(mobIconFor(mob.type), x, z, mob.name, {
          category: "mobs",
          id: mob.id,
          name: mob.name ?? mob.type,
        });
      }
    }
    if (entityVisibility.players) {
      for (const player of latestEntities.players) {
        const { x, z } = positionOf("players", player);
        drawMarker(playerIconFor(player.uuid), x, z, player.name, {
          category: "players",
          id: player.uuid,
          name: player.name,
        });
      }
    }
  };

  // 스폰 포인트를 지도에 핀으로 표시 — 뾰족한 끝이 실제 좌표를 정확히 가리킨다. 락온 링과
  // 헷갈리지 않게 원이 아니라 핀 실루엣으로 구분(--gold로 통일해 톤앤매너는 유지).
  const drawSpawnPoint = () => {
    if (!spawnPoint) return;
    const { x, y } = worldToScreen(spawnPoint.x, spawnPoint.z);
    const h = 20;
    const w = 13;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x - w / 2, y - h * 0.6, x, y - h);
    ctx.quadraticCurveTo(x + w / 2, y - h * 0.6, x, y);
    ctx.closePath();
    ctx.fillStyle = "#e0b64a"; // --gold
    ctx.strokeStyle = "#070708"; // --bevel-lo
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y - h * 0.62, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#070708";
    ctx.fill();
    ctx.restore();
    markerHitTargets.push({
      x,
      y: y - h * 0.62,
      radius: 9,
      wx: spawnPoint.x,
      wz: spawnPoint.z,
      category: "spawn",
      id: "spawn",
      name: "스폰 포인트",
    });
  };

  // 화면 고정 N/E/S/W — 월드 좌표가 아니라 캔버스 가장자리에 고정한다.
  // worldToScreen 규약: 북(Z-)=위, 남(Z+)=아래, 동(X+)=오른쪽, 서(X-)=왼쪽.
  const drawCompass = () => {
    const rect = canvas.getBoundingClientRect();
    const pad = 16;
    ctx.save();
    ctx.font = "bold 12px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#e0b64a"; // --gold
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", rect.width / 2, pad);
    ctx.fillText("S", rect.width / 2, rect.height - pad);
    ctx.fillText("E", rect.width - pad, rect.height / 2);
    ctx.fillText("W", pad, rect.height / 2);
    ctx.restore();
  };

  // 플레이어 마커를 드래그하는 동안 놓을 위치를 안내(점선 + 조준선). 실제 텔레포트 실행은
  // mouseup에서 onPlayerDropTeleport 콜백으로 위임 — 여긴 시각 피드백만 담당한다.
  const drawTeleportDrag = () => {
    if (!playerDragTarget || !hoverPoint || dragMoved < CLICK_DRAG_THRESHOLD) return;
    const { sx, sy } = hoverPoint;
    ctx.save();
    ctx.strokeStyle = "#e0b64a"; // --gold
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(playerDragTarget.x, playerDragTarget.y);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#6bc72e"; // --xp
    ctx.beginPath();
    ctx.moveTo(sx - 8, sy);
    ctx.lineTo(sx + 8, sy);
    ctx.moveTo(sx, sy - 8);
    ctx.lineTo(sx, sy + 8);
    ctx.stroke();
    ctx.restore();
  };

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.imageSmoothingEnabled = false; // 마인크래프트 픽셀 텍스처가 흐려지지 않게.
    ctx.fillStyle = "#131315"; // --stone-950 — UI 개편으로 페이지 배경과 맞춤(브릿지의 UNEXPLORED_COLOR도 동일하게 맞춰야 함)
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const [tileKey, tile] of tiles) {
      if (tile.status !== "ready") continue;
      const [cx, cz] = tileKey.split(",").map(Number);
      const { x, y } = worldToScreen(cx * TILE_BLOCKS, cz * TILE_BLOCKS);
      const size = TILE_BLOCKS * scale;
      ctx.drawImage(tile.img, x, y, size, size);
    }
    drawEntities();
    drawSpawnPoint();
    drawTeleportDrag();
    drawCompass();
    if (hoverPoint) {
      const hovered = hitTestMarker(hoverPoint.sx, hoverPoint.sy);
      if (hovered) {
        drawTooltip(hovered);
      }
    }
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    draw();
    // [수정: 라운드 1] 창을 넓히면(풀스크린 전환 등) 새로 보이는 가장자리에 타일이 없어서
    // 빈 칸으로 남았다 — 팬/줌 때처럼 리사이즈 후에도 뷰포트 기준 타일을 다시 동기화한다.
    scheduleSync();
  };

  let activeTileLoads = 0;
  const tileLoadQueue = []; // [{ cx, cz, bust }]
  // "새로고침" 버튼이 누를 때마다 하나씩 올린다 — 지금 세대가 아닌 응답/취소는 화면
  // 반영을 건너뛴다(교체됐거나 곧 지워질 tiles 항목을 건드리지 않기 위해).
  let loadGeneration = 0;

  const pumpTileQueue = () => {
    while (activeTileLoads < MAX_CONCURRENT_TILE_LOADS && tileLoadQueue.length > 0) {
      const { cx, cz, bust } = tileLoadQueue.shift();
      activeTileLoads += 1;
      startTileLoad(cx, cz, bust);
    }
  };

  // fetch+AbortController로 받는다(예전엔 <img>였는데, <img>는 요청을 진짜로 취소할
  // 방법이 없어서 "새로고침"을 눌러도 이미 나간 요청은 서버에 계속 남아있었다 — 이러면
  // 동시 요청 수 상한(MAX_CONCURRENT_TILE_LOADS)이 새로고침 한 번에 사실상 두 배가 될
  // 수 있었다). 여기선 refreshTiles()가 controller.abort()로 진짜 끊을 수 있다.
  const startTileLoad = (cx, cz, bust) => {
    const tileKey = key(cx, cz);
    const gen = loadGeneration;
    const params = new URLSearchParams({ bridgeUrl: currentBridgeUrl, cx: String(cx), cz: String(cz) });
    if (bust) params.set("v", String(Date.now()));
    const controller = new AbortController();
    const entry = { img: null, status: "loading", controller };
    tiles.set(tileKey, entry);
    // refreshTiles()/start()가 세대를 올릴 때 activeTileLoads를 0으로 강제 리셋한다 —
    // 그 시점에 아직 안 끝난 옛 세대 요청들의 몫은 이미 "청산"된 것으로 친다. 그런데 그
    // 요청들도 abort() 이후 결국 이 finish()를 taps(then/catch 어느 쪽이든)하므로, 여기서
    // 세대 구분 없이 매번 감산하면 새 세대 몫까지 이중으로 깎여 activeTileLoads가 실제
    // 동시 요청 수보다 작아지거나 음수가 될 수 있다(상한 체크가 무력화됨). 그래서 감산은
    // "지금 세대"에 속한 요청일 때만 한다.
    const finish = () => {
      if (gen === loadGeneration) {
        activeTileLoads -= 1;
      }
      pumpTileQueue();
    };
    fetch(`bridge/world/overworld/map/tile?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        if (gen === loadGeneration) {
          entry.img = bitmap;
          entry.status = "ready";
          draw();
        } else {
          bitmap.close(); // 이제 안 쓸 비트맵 — 메모리 바로 반납.
        }
        finish();
      })
      .catch((error) => {
        // AbortError는 refreshTiles()가 의도적으로 끊은 것 — 이 tileKey는 이미 tiles에서
        // 지워졌거나 새 세대로 덮어써졌으니 상태를 건드릴 필요가 없다. finish()(동시 로딩
        // 개수 반납)는 그것과 무관하게 항상 부른다 — 안 그러면 activeTileLoads가 안 줄어
        // 들어 이후 로딩이 막힌다.
        if (error.name !== "AbortError" && gen === loadGeneration) {
          entry.status = "error";
        }
        finish();
      });
  };

  // 즉시 로드하지 않고 큐에 넣기만 한다 — 실제 요청은 pumpTileQueue가 동시 개수를
  // 제한하며 순서대로 시작한다. tiles에 바로 "loading" 상태를 심어둬서 syncTiles가
  // 큐에 이미 있는 타일을 중복으로 또 넣지 않는다.
  const loadTile = (cx, cz, bust = false) => {
    if (!currentBridgeUrl) return;
    const tileKey = key(cx, cz);
    tiles.set(tileKey, { img: null, status: "loading" });
    tileLoadQueue.push({ cx, cz, bust });
    pumpTileQueue();
  };

  const visibleChunkRange = () => {
    const rect = canvas.getBoundingClientRect();
    const topLeft = screenToWorld(0, 0);
    const bottomRight = screenToWorld(rect.width, rect.height);
    return {
      minCx: Math.floor(topLeft.x / TILE_BLOCKS) - 1,
      maxCx: Math.floor(bottomRight.x / TILE_BLOCKS) + 1,
      minCz: Math.floor(topLeft.z / TILE_BLOCKS) - 1,
      maxCz: Math.floor(bottomRight.z / TILE_BLOCKS) + 1,
    };
  };

  // 뷰포트에 걸쳐 있는 타일만 로드하고, 벗어난 건 정리한다(3D 뷰어의 청크 반경 동기화와
  // 같은 개념이지만 여긴 "설정값"이 아니라 실제 보이는 영역 기준이라 손댈 게 없다).
  const syncTiles = () => {
    const { minCx, maxCx, minCz, maxCz } = visibleChunkRange();
    const desired = new Set();
    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cz = minCz; cz <= maxCz; cz += 1) {
        desired.add(key(cx, cz));
      }
    }
    for (const tileKey of desired) {
      if (!tiles.has(tileKey)) {
        const [cx, cz] = tileKey.split(",").map(Number);
        loadTile(cx, cz);
      }
    }
    for (const tileKey of Array.from(tiles.keys())) {
      if (!desired.has(tileKey)) {
        tiles.get(tileKey).img?.close(); // ImageBitmap은 참조만 버리면 GC를 기다려야 함 — 바로 반납.
        tiles.delete(tileKey);
      }
    }
  };

  const scheduleSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncTiles, TILE_SYNC_DEBOUNCE_MS);
  };

  // "새로고침" 버튼: 대기 중이거나 응답을 기다리던 타일 요청을 전부 버리고, 지금 화면에
  // 보이는 범위 기준으로 처음부터 다시 요청한다.
  const refreshTiles = () => {
    loadGeneration += 1; // 이후 도착하는 옛 세대 응답/취소는 startTileLoad가 화면 반영을 건너뛴다.
    // 이미 렌더링 끝난("ready") 타일은 그대로 둔다 — 로딩 중이거나 실패한 것만 버려서
    // syncTiles가 다시 요청하게 한다. 다 지우면 이미 잘 보이던 화면까지 깜빡이며 사라진다.
    // 로딩 중이던 건 controller.abort()로 실제로 요청을 끊는다(fetch라 진짜 취소가 됨 —
    // MAX_CONCURRENT_TILE_LOADS 상한을 새로고침 한 번에 두 배로 만들지 않기 위함).
    for (const [tileKey, tile] of tiles) {
      if (tile.status !== "ready") {
        tile.controller?.abort();
        tiles.delete(tileKey);
      }
    }
    tileLoadQueue.length = 0;
    activeTileLoads = 0; // abort()로 실제 취소되므로 0으로 리셋해도 상한을 넘기지 않는다.
    syncTiles();
  };

  // 마우스(mousedown/move/up)와 터치(1손가락 팬)가 같은 팬/클릭/드래그-텔레포트 로직을
  // 타도록 clientX/Y만 받는 형태로 뽑아뒀다 — 아래 mouse*/touch* 리스너 양쪽이 호출한다.
  const pointerDown = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const hit = hitTestMarker(clientX - rect.left, clientY - rect.top);
    // 플레이어 마커 위에서 시작한 드래그만 "놓은 지점으로 텔레포트" 모드로 취급한다 —
    // 임계값 이하로 끝나면 pointerUp에서 그냥 기존 클릭=포커스 고정으로 처리된다.
    playerDragTarget = hit && hit.category === "players" ? hit : null;
    dragging = true;
    dragMoved = 0;
    dragStart = { x: clientX, y: clientY, originX, originZ };
    canvas.style.cursor = "grabbing";
  };
  const pointerMove = (clientX, clientY) => {
    if (!dragging) return;
    // 터치는 mousemove 전용 hover 리스너가 없어서 여기서 직접 hoverPoint를 갱신해야
    // 드래그-텔레포트 안내선(drawTeleportDrag)이 손가락을 따라간다. 마우스는 아래 hover
    // 리스너가 같은 값으로 다시 갱신하지만 덮어써도 무해하다.
    const rect = canvas.getBoundingClientRect();
    hoverPoint = { sx: clientX - rect.left, sy: clientY - rect.top };
    const dx = clientX - dragStart.x;
    const dy = clientY - dragStart.y;
    const wasBelowThreshold = dragMoved < CLICK_DRAG_THRESHOLD;
    dragMoved = Math.max(dragMoved, Math.abs(dx), Math.abs(dy));
    // 진짜 드래그로 넘어가는 순간(=다른 곳을 보고 싶다는 뜻) 포커스 잠금을 푼다. 클릭
    // 수준의 미세한 흔들림까지 풀면 안 되니 임계값을 넘을 때 딱 한 번만 처리한다.
    if (wasBelowThreshold && dragMoved >= CLICK_DRAG_THRESHOLD) {
      clearLock();
    }
    if (playerDragTarget) {
      // 플레이어를 드래그하는 중 — 지도는 고정한 채 놓을 위치 안내만 다시 그린다.
      draw();
      return;
    }
    originX = dragStart.originX - dx / scale;
    originZ = dragStart.originZ - dy / scale;
    draw();
    scheduleSync();
  };
  const pointerUp = (clientX, clientY) => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = "grab";
    if (dragMoved < CLICK_DRAG_THRESHOLD) {
      handleClick(clientX, clientY);
    } else if (playerDragTarget) {
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      // 지도 밖(콘솔 패널, 유저 목록 등)에서 손을 뗀 건 "취소"로 취급 — 캔버스 밖 좌표까지
      // 그대로 world로 환산해 실제 tp를 쏘면 엉뚱한 곳(바다·공허 등)으로 보낼 수 있다.
      if (sx >= 0 && sx <= rect.width && sy >= 0 && sy <= rect.height) {
        const { x: wx, z: wz } = screenToWorld(sx, sy);
        onPlayerDropTeleport?.(playerDragTarget.name, wx, wz);
      }
    }
    playerDragTarget = null;
    draw();
  };

  canvas.addEventListener("mousedown", (event) => pointerDown(event.clientX, event.clientY));
  window.addEventListener("mousemove", (event) => pointerMove(event.clientX, event.clientY));
  window.addEventListener("mouseup", (event) => pointerUp(event.clientX, event.clientY));

  // 화면 좌표 하나를 고정한 채 scale만 바꾼다(그 지점 아래 월드 좌표가 확대/축소 후에도
  // 그대로 유지되게 origin을 보정) — 휠 줌과 핀치 줌이 이 로직을 공유한다.
  const zoomAt = (screenX, screenY, newScale) => {
    const before = screenToWorld(screenX, screenY);
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    const after = screenToWorld(screenX, screenY);
    originX += before.x - after.x;
    originZ += before.z - after.z;
  };

  // ---- 터치: 손가락 1개 = 팬/클릭/드래그-텔레포트(위 포인터 로직 재사용), 손가락 2개 = 핀치줌.
  let pinchIds = null; // [identifier, identifier] — 인덱스가 아니라 손가락 식별자로 추적
  let pinchStartDist = null;
  let pinchStartScale = null;
  const touchDistance = (t0, t1) => Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
  const touchMidpoint = (t0, t1) => ({ x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 });
  const findTouch = (touchList, id) => Array.prototype.find.call(touchList, (t) => t.identifier === id) ?? null;
  const resetPinch = () => {
    pinchIds = null;
    pinchStartDist = null;
    pinchStartScale = null;
  };

  canvas.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      if (event.touches.length >= 2) {
        // 핀치 시작 — 한 손가락 팬/드래그가 이미 진행 중이었으면 취소. 처음 잡힌 두 손가락의
        // identifier를 기억해서, 이후 세 번째 손가락이 스쳐도 엉뚱한 쌍으로 안 갈아탄다.
        dragging = false;
        playerDragTarget = null;
        const [t0, t1] = event.touches;
        pinchIds = [t0.identifier, t1.identifier];
        // 두 손가락이 거의 같은 지점에서 시작하면 거리가 0에 가까워 이후 나눗셈이 NaN/Infinity가
        // 될 수 있다 — 최소 1px로 바닥을 깔아둔다.
        pinchStartDist = Math.max(touchDistance(t0, t1), 1);
        pinchStartScale = scale;
        return;
      }
      if (event.touches.length === 1) {
        pointerDown(event.touches[0].clientX, event.touches[0].clientY);
      }
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
      if (pinchIds) {
        const t0 = findTouch(event.touches, pinchIds[0]);
        const t1 = findTouch(event.touches, pinchIds[1]);
        if (!t0 || !t1) return; // 추적 중이던 두 손가락 중 하나가 사라짐 — 다음 touchstart를 기다림
        const rect = canvas.getBoundingClientRect();
        const mid = touchMidpoint(t0, t1);
        zoomAt(mid.x - rect.left, mid.y - rect.top, pinchStartScale * (touchDistance(t0, t1) / pinchStartDist));
        draw();
        scheduleSync();
        return;
      }
      if (event.touches.length === 1) {
        pointerMove(event.touches[0].clientX, event.touches[0].clientY);
      }
    },
    { passive: false },
  );
  canvas.addEventListener(
    "touchend",
    (event) => {
      if (event.touches.length < 2) resetPinch();
      if (event.touches.length === 1) {
        // 핀치 중 손가락 하나를 뗀 경우 — 남은 손가락으로 팬을 자연스럽게 이어간다. 클릭
        // 판정(hitTestMarker)을 거치지 않고 팬 상태를 직접 세팅한다 — pointerDown을 타면 두
        // 손가락을 거의 동시에 뗄 때 곧바로 다음 touchend가 와서 "제자리 클릭"으로 오인해
        // 마커를 고정하거나 텔레포트를 쏠 수 있다(이미 드래그 중인 것으로 시작해 막는다).
        const t = event.touches[0];
        dragging = true;
        dragStart = { x: t.clientX, y: t.clientY, originX, originZ };
        dragMoved = CLICK_DRAG_THRESHOLD;
        playerDragTarget = null;
        canvas.style.cursor = "grabbing";
        return;
      }
      if (event.touches.length === 0) {
        hoverPoint = null; // 터치는 hover 개념이 없음 — 마우스의 mouseleave와 대응.
        if (event.changedTouches.length > 0) {
          const t = event.changedTouches[0];
          pointerUp(t.clientX, t.clientY);
        }
      }
    },
    { passive: false },
  );
  canvas.addEventListener("touchcancel", () => {
    // 팬/핀치/드래그 도중 제스처가 깨지면(OS 스와이프, 알림, 브라우저 뒤로가기 제스처 등
    // touchend 없이 끊기는 경우) 상태가 눌어붙지 않게 전부 원점으로 되돌린다.
    dragging = false;
    playerDragTarget = null;
    resetPinch();
    hoverPoint = null;
    canvas.style.cursor = "grab";
    draw();
  });

  // 실제로 드래그하지 않은(제자리) 클릭만 마커 포커스로 취급 — 지도를 드래그하다가
  // 마커 위에서 손을 뗐다고 갑자기 화면이 튀면 안 된다.
  const handleClick = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const target = hitTestMarker(clientX - rect.left, clientY - rect.top);
    if (!target) return;
    if (target.category === "spawn") {
      // 스폰 포인트는 고정된 지점이라 lockOnto(엔티티 추적용)로는 못 다룬다 — 그냥 한 번 이동.
      clearLock();
      centerOn(target.wx, target.wz);
      draw();
      scheduleSync();
      return;
    }
    lockOnto(target.category, target.id, target.name);
  };

  // 마커에 커서를 올리면 이름 툴팁을 보여준다(아이템/이름 없는 몹처럼 지도에 상시
  // 라벨이 없는 엔티티도 확인할 수 있게). 드래그 중엔 dragMove 핸들러가 이미 매번
  // draw()를 호출하므로 여기서 또 부를 필요 없음.
  canvas.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    hoverPoint = { sx: event.clientX - rect.left, sy: event.clientY - rect.top };
    if (!dragging) draw();
  });
  canvas.addEventListener("mouseleave", () => {
    hoverPoint = null;
    draw();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      zoomAt(event.clientX - rect.left, event.clientY - rect.top, scale * factor);
      draw();
      scheduleSync();
    },
    { passive: false },
  );

  window.addEventListener("resize", resize);

  // 블록이 바뀐 청크만 서버가 SSE로 알려주면, 그 타일만 캐시버스팅해서 다시 받는다 —
  // 지도 전체를 다시 그리지 않는 게 "실시간" 요구사항의 핵심.
  const connectEvents = (bridgeUrl) => {
    if (eventSource) {
      eventSource.close();
    }
    const es = new EventSource(`bridge/world/overworld/map/events?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
    es.onopen = () => {
      statusEl.textContent = "실시간 연결됨";
    };
    es.onmessage = (event) => {
      try {
        const { cx, cz } = JSON.parse(event.data);
        if (tiles.has(key(cx, cz))) {
          loadTile(cx, cz, true);
        }
      } catch {
        // 핑(":") 등 JSON이 아닌 이벤트는 무시.
      }
    };
    es.onerror = () => {
      statusEl.textContent = "실시간 연결 끊김 (재시도 중...)";
    };
    eventSource = es;
  };

  // 300ms마다 오는 플레이어/몹/아이템 스냅샷을 받아 그대로 다시 그린다.
  const connectEntities = (bridgeUrl) => {
    if (entityEventSource) {
      entityEventSource.close();
    }
    const es = new EventSource(`bridge/world/overworld/entities/stream?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
    es.onopen = () => console.debug("[EntityStream] 연결됨");
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        latestEntities = {
          players: parsed.players ?? [],
          mobs: parsed.mobs ?? [],
          items: parsed.items ?? [],
        };
        // 실제 그리기는 안 한다 — 목표 좌표만 갱신해두면 rAF 루프가 매 프레임 보간해서
        // 그린다(카메라 추적도 같은 루프 안에서 applyLock()이 매 프레임 처리).
        updateMotionState("players", latestEntities.players);
        updateMotionState("mobs", latestEntities.mobs);
        updateMotionState("items", latestEntities.items);
        onPlayersUpdate?.(latestEntities.players);
      } catch (error) {
        console.warn("[EntityStream] 스냅샷 파싱 실패", error, event.data);
      }
    };
    es.onerror = () => console.debug("[EntityStream] 연결 끊김 (재시도 중)");
    entityEventSource = es;
  };

  // 한 번만 조회하면 되는 정적 지점 — 매 스냅샷마다 올 필요 없어 별도 fetch로 처리.
  const fetchSpawnPoint = async (bridgeUrl) => {
    try {
      const res = await fetch(`bridge/world/overworld/spawn?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
      // 응답이 오는 사이 다른 서버로 전환됐으면(start()가 다시 호출됨) 낡은 결과라 버린다 —
      // 아니면 방금 연결한 새 서버 화면에 이전 서버의 스폰 좌표가 잘못 표시될 수 있다.
      if (bridgeUrl !== currentBridgeUrl) return;
      if (!res.ok) return;
      spawnPoint = await res.json();
      onSpawnPoint?.(spawnPoint);
      draw();
    } catch (error) {
      console.warn("[Map] 스폰 포인트 조회 실패", error);
    }
  };

  const setEntityVisibility = (category, visible) => {
    entityVisibility[category] = visible;
    draw();
  };

  const findEntity = (category, id) => {
    const list = latestEntities[category];
    if (!list) return null;
    return list.find((entity) => idOf(category, entity) === id) ?? null;
  };

  // 엔티티 좌표로 지도 중심을 옮긴다(잠금 상태의 "이번 순간 위치 반영"과, 최초 클릭 시의
  // "일단 그 위치로 이동" 둘 다 여기로 통일).
  const centerOn = (wx, wz) => {
    originX = wx;
    originZ = wz;
  };

  const applyLock = () => {
    if (!lockedTarget) return;
    const entity = findEntity(lockedTarget.category, lockedTarget.id);
    if (!entity) {
      // 디스폰/로그아웃 등으로 더 이상 존재하지 않음 — 잠금을 풀어준다.
      clearLock();
      return;
    }
    // 보간된(매 프레임 부드럽게 움직이는) 위치를 그대로 카메라 중심으로 써야 카메라도
    // 마커처럼 뚝뚝 끊기지 않고 같이 부드럽게 따라간다.
    const { x, z } = positionOf(lockedTarget.category, entity);
    centerOn(x, z);
  };

  const clearLock = () => {
    if (!lockedTarget) return;
    lockedTarget = null;
    onFocusChange?.(null);
    draw();
  };

  // 마커/유저 목록 클릭 시 호출 — 한 번 중앙으로 이동하고 끝나는 게 아니라, 이후 스냅샷마다
  // applyLock()이 계속 그 엔티티의 최신 좌표를 따라간다(지도를 드래그하면 자동 해제).
  const lockOnto = (category, id, name) => {
    lockedTarget = { category, id, name };
    onFocusChange?.(name);
    const entity = findEntity(category, id);
    if (entity) {
      centerOn(entity.x, entity.z);
    }
    draw();
    scheduleSync();
  };

  // 마커/카메라 보간을 매 프레임 반영하는 루프. 스냅샷 도착(onmessage)이 아니라 여기서
  // draw()를 계속 불러야 스냅샷 사이 구간에서도 화면이 움직인다.
  let animationFrameId = null;
  const tick = () => {
    applyLock();
    draw();
    animationFrameId = requestAnimationFrame(tick);
  };

  const start = (bridgeUrl) => {
    currentBridgeUrl = bridgeUrl;
    // 다른 서버로 전환 — refreshTiles()와 같은 이유로 세대를 올리고 이전 서버로 나가
    // 있던 요청을 실제로 끊는다. 안 그러면 이전 서버의 타일 응답이 늦게 도착했을 때 지금
    // 세대로 착각해 새 서버 화면에 잘못 그려질 수 있다.
    loadGeneration += 1;
    for (const tile of tiles.values()) {
      tile.controller?.abort();
      tile.img?.close();
    }
    tiles.clear();
    tileLoadQueue.length = 0;
    activeTileLoads = 0;
    playerIconCache.clear();
    motionState.players.clear();
    motionState.mobs.clear();
    motionState.items.clear();
    lockedTarget = null;
    onFocusChange?.(null);
    statusEl.textContent = "지도 불러오는 중...";
    spawnPoint = null;
    resize();
    syncTiles();
    connectEvents(bridgeUrl);
    connectEntities(bridgeUrl);
    fetchSpawnPoint(bridgeUrl);
    if (animationFrameId === null) {
      animationFrameId = requestAnimationFrame(tick);
    }
  };

  return { start, lockOnto, clearLock, setEntityVisibility, refreshTiles };
};
