// 실시간 2D 지도: bridge-paper가 렌더링한 청크 타일(PNG)을 캔버스에 그리고, 드래그로
// 이동·휠로 확대/축소한다. 서버가 이미 완성된 이미지를 주므로 클라이언트는 그리기만
// 하면 되고, 청크가 늘어나도 3D 뷰어처럼 느려지지 않는다(구 버전은 청크가 늘수록 클라
// 이언트가 메쉬를 계속 새로 만들어야 해서 느렸다 — 그게 이번 개편의 이유).
//
// [디버깅] 엔티티가 지도에 안 보이면 브라우저 콘솔에서 "[EntityStream]" 로그를 먼저
// 확인 — SSE 연결 자체가 안 됐는지, 연결은 됐는데 파싱이 실패하는지 구분된다.
const TILE_BLOCKS = 16; // 타일 하나 = 청크 한 칸(16블록)
const TILE_SYNC_DEBOUNCE_MS = 250;
const MIN_SCALE = 0.5;
const MAX_SCALE = 16;
const MARKER_SIZE = 16; // 화면 픽셀 고정 크기(줌과 무관 — 마커가 안 사라지거나 안 커지게)
const CLICK_DRAG_THRESHOLD = 4; // 이 이하로 움직이면 드래그가 아니라 클릭으로 취급

export const createMap = ({ canvas, statusEl }) => {
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
  let markerHitTargets = []; // draw()마다 갱신 — 클릭 히트테스트용 {x,y,wx,wz}

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

  const drawMarker = (img, wx, wz, label) => {
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
    if (label) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, x, y - half - 3);
    }
    markerHitTargets.push({ x, y, radius: half, wx, wz });
  };

  const drawEntities = () => {
    markerHitTargets = [];
    if (entityVisibility.items) {
      for (const item of latestEntities.items) {
        drawMarker(itemIconFor(item.material), item.x, item.z, null);
      }
    }
    if (entityVisibility.mobs) {
      for (const mob of latestEntities.mobs) {
        drawMarker(mobIconFor(mob.type), mob.x, mob.z, mob.name);
      }
    }
    if (entityVisibility.players) {
      for (const player of latestEntities.players) {
        drawMarker(playerIconFor(player.uuid), player.x, player.z, player.name);
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

  const loadTile = (cx, cz, bust = false) => {
    if (!currentBridgeUrl) return;
    const tileKey = key(cx, cz);
    const params = new URLSearchParams({ bridgeUrl: currentBridgeUrl, cx: String(cx), cz: String(cz) });
    if (bust) params.set("v", String(Date.now()));
    const img = new Image();
    const entry = { img, status: "loading" };
    tiles.set(tileKey, entry);
    img.onload = () => {
      entry.status = "ready";
      draw();
    };
    img.onerror = () => {
      entry.status = "error";
    };
    img.src = `bridge/world/overworld/map/tile?${params.toString()}`;
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
    dragMoved = Math.max(dragMoved, Math.abs(dx), Math.abs(dy));
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

  // 실제로 드래그하지 않은(제자리) 클릭만 엔티티 포커스로 취급 — 지도를 드래그하다가
  // 마커 위에서 손을 뗐다고 갑자기 화면이 튀면 안 된다.
  const handleClick = (event) => {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    for (const target of markerHitTargets) {
      const dx = sx - target.x;
      const dy = sy - target.y;
      if (dx * dx + dy * dy <= target.radius * target.radius) {
        focusOn(target.wx, target.wz);
        return;
      }
    }
  };

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
        draw();
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

  const focusOn = (wx, wz) => {
    originX = wx;
    originZ = wz;
    draw();
    scheduleSync();
  };

  const start = (bridgeUrl) => {
    currentBridgeUrl = bridgeUrl;
    tiles.clear();
    playerIconCache.clear();
    statusEl.textContent = "지도 불러오는 중...";
    resize();
    syncTiles();
    connectEvents(bridgeUrl);
    connectEntities(bridgeUrl);
  };

  return { start, focusOn, setEntityVisibility };
};
