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

export const createMap = ({ canvas, statusEl, onPlayersUpdate, onFocusChange }) => {
  const ctx = canvas.getContext("2d");

  let currentBridgeUrl = null;
  let originX = 0; // 캔버스 중심이 가리키는 월드 X
  let originZ = 0;
  let scale = 4; // 픽셀/블록

  const tiles = new Map(); // "cx,cz" -> { img, status: "loading"|"ready"|"error" }
  let dragging = false;
  let dragStart = null;
  let dragMoved = 0;
  let syncTimer = null;
  let eventSource = null;
  let entityEventSource = null;

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
      ctx.fillStyle = "#38bdf8";
      ctx.beginPath();
      ctx.arc(x, y, half * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const isLocked = lockedTarget && lockedTarget.category === hit.category && lockedTarget.id === hit.id;
    if (isLocked) {
      ctx.strokeStyle = "#facc15";
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
        drawMarker(itemIconFor(item.material), item.x, item.z, null, {
          category: "items",
          id: item.id,
          name: item.material,
        });
      }
    }
    if (entityVisibility.mobs) {
      for (const mob of latestEntities.mobs) {
        drawMarker(mobIconFor(mob.type), mob.x, mob.z, mob.name, {
          category: "mobs",
          id: mob.id,
          name: mob.name ?? mob.type,
        });
      }
    }
    if (entityVisibility.players) {
      for (const player of latestEntities.players) {
        drawMarker(playerIconFor(player.uuid), player.x, player.z, player.name, {
          category: "players",
          id: player.uuid,
          name: player.name,
        });
      }
    }
    if (hoverPoint) {
      const hovered = hitTestMarker(hoverPoint.sx, hoverPoint.sy);
      if (hovered) {
        drawTooltip(hovered);
      }
    }
  };

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
    ctx.imageSmoothingEnabled = false; // 마인크래프트 픽셀 텍스처가 흐려지지 않게.
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, rect.width, rect.height);
    for (const [tileKey, tile] of tiles) {
      if (tile.status !== "ready") continue;
      const [cx, cz] = tileKey.split(",").map(Number);
      const { x, y } = worldToScreen(cx * TILE_BLOCKS, cz * TILE_BLOCKS);
      const size = TILE_BLOCKS * scale;
      ctx.drawImage(tile.img, x, y, size, size);
    }
    drawEntities();
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

  const pumpTileQueue = () => {
    while (activeTileLoads < MAX_CONCURRENT_TILE_LOADS && tileLoadQueue.length > 0) {
      const { cx, cz, bust } = tileLoadQueue.shift();
      activeTileLoads += 1;
      startTileLoad(cx, cz, bust);
    }
  };

  const startTileLoad = (cx, cz, bust) => {
    const tileKey = key(cx, cz);
    const params = new URLSearchParams({ bridgeUrl: currentBridgeUrl, cx: String(cx), cz: String(cz) });
    if (bust) params.set("v", String(Date.now()));
    const img = new Image();
    const entry = { img, status: "loading" };
    tiles.set(tileKey, entry);
    const finish = () => {
      activeTileLoads -= 1;
      pumpTileQueue();
    };
    img.onload = () => {
      entry.status = "ready";
      draw();
      finish();
    };
    img.onerror = () => {
      entry.status = "error";
      finish();
    };
    img.src = `bridge/world/overworld/map/tile?${params.toString()}`;
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
        tiles.delete(tileKey);
      }
    }
  };

  const scheduleSync = () => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncTiles, TILE_SYNC_DEBOUNCE_MS);
  };

  canvas.addEventListener("mousedown", (event) => {
    dragging = true;
    dragMoved = 0;
    dragStart = { x: event.clientX, y: event.clientY, originX, originZ };
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (event) => {
    if (!dragging) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    const wasBelowThreshold = dragMoved < CLICK_DRAG_THRESHOLD;
    dragMoved = Math.max(dragMoved, Math.abs(dx), Math.abs(dy));
    // 진짜 드래그로 넘어가는 순간(=다른 곳을 보고 싶다는 뜻) 포커스 잠금을 푼다. 클릭
    // 수준의 미세한 흔들림까지 풀면 안 되니 임계값을 넘을 때 딱 한 번만 처리한다.
    if (wasBelowThreshold && dragMoved >= CLICK_DRAG_THRESHOLD) {
      clearLock();
    }
    originX = dragStart.originX - dx / scale;
    originZ = dragStart.originZ - dy / scale;
    draw();
    scheduleSync();
  });
  window.addEventListener("mouseup", (event) => {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = "grab";
    if (dragMoved < CLICK_DRAG_THRESHOLD) {
      handleClick(event);
    }
  });

  // 실제로 드래그하지 않은(제자리) 클릭만 마커 포커스로 취급 — 지도를 드래그하다가
  // 마커 위에서 손을 뗐다고 갑자기 화면이 튀면 안 된다.
  const handleClick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const target = hitTestMarker(event.clientX - rect.left, event.clientY - rect.top);
    if (target) {
      lockOnto(target.category, target.id, target.name);
    }
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
      const before = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
      scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
      const after = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
      originX += before.x - after.x; // 커서 아래 지점이 그대로 고정되도록 보정.
      originZ += before.z - after.z;
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
        applyLock(); // 잠긴 엔티티가 있으면 이번 스냅샷의 새 좌표로 지도 중심을 다시 맞춘다.
        draw();
        onPlayersUpdate?.(latestEntities.players);
      } catch (error) {
        console.warn("[EntityStream] 스냅샷 파싱 실패", error, event.data);
      }
    };
    es.onerror = () => console.debug("[EntityStream] 연결 끊김 (재시도 중)");
    entityEventSource = es;
  };

  const setEntityVisibility = (category, visible) => {
    entityVisibility[category] = visible;
    draw();
  };

  const findEntity = (category, id) => {
    const list = latestEntities[category];
    if (!list) return null;
    return list.find((entity) => (category === "players" ? entity.uuid : entity.id) === id) ?? null;
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
    centerOn(entity.x, entity.z);
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

  const start = (bridgeUrl) => {
    currentBridgeUrl = bridgeUrl;
    tiles.clear();
    playerIconCache.clear();
    lockedTarget = null;
    onFocusChange?.(null);
    statusEl.textContent = "지도 불러오는 중...";
    resize();
    syncTiles();
    connectEvents(bridgeUrl);
    connectEntities(bridgeUrl);
  };

  return { start, lockOnto, clearLock, setEntityVisibility };
};
