const bridgeInput = document.getElementById("bridgeUrl");
const testButton = document.getElementById("testButton");
const result = document.getElementById("result");
const recentList = document.getElementById("recentList");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const paletteSearch = document.getElementById("paletteSearch");
const paletteStatus = document.getElementById("paletteStatus");
const paletteGrid = document.getElementById("paletteGrid");
const selectedBlockLabel = document.getElementById("selectedBlockLabel");

const toolBrushButton = document.getElementById("toolBrush");
const toolSelectButton = document.getElementById("toolSelect");
const viewerLoadButton = document.getElementById("viewerLoadButton");
const viewerStatus = document.getElementById("viewerStatus");
const viewerCanvas = document.getElementById("viewerCanvas");
const resourcePackFileInput = document.getElementById("resourcePackFile");
const resourcePackButton = document.getElementById("resourcePackButton");
const viewerSettingsButton = document.getElementById("viewerSettingsButton");
const viewerSettingsDialog = document.getElementById("viewerSettingsDialog");
const viewerSettingsCloseButton = document.getElementById("viewerSettingsCloseButton");
const rotateSpeedInput = document.getElementById("rotateSpeedInput");
const zoomSpeedInput = document.getElementById("zoomSpeedInput");
const panSpeedInput = document.getElementById("panSpeedInput");
const rotateSpeedValue = document.getElementById("rotateSpeedValue");
const zoomSpeedValue = document.getElementById("zoomSpeedValue");
const panSpeedValue = document.getElementById("panSpeedValue");
const chunkRadiusInput = document.getElementById("chunkRadiusInput");

const blueprintFileInput = document.getElementById("blueprintFile");
const blueprintNameInput = document.getElementById("blueprintName");
const blueprintTagsInput = document.getElementById("blueprintTags");
const uploadBlueprintButton = document.getElementById("uploadBlueprintButton");
const refreshBlueprintsButton = document.getElementById("refreshBlueprintsButton");
const blueprintStatus = document.getElementById("blueprintStatus");
const blueprintList = document.getElementById("blueprintList");

const editJobList = document.getElementById("editJobList");
const refreshJobsButton = document.getElementById("refreshJobsButton");
const editJobStatus = document.getElementById("editJobStatus");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const historyStatus = document.getElementById("historyStatus");
const historyList = document.getElementById("historyList");

const auditUserIdInput = document.getElementById("auditUserId");
const auditWorldIdInput = document.getElementById("auditWorldId");
const auditCommandTypeInput = document.getElementById("auditCommandType");
const auditSinceInput = document.getElementById("auditSince");
const auditUntilInput = document.getElementById("auditUntil");
const auditLimitInput = document.getElementById("auditLimit");
const refreshAuditButton = document.getElementById("refreshAuditButton");
const loadMoreAuditButton = document.getElementById("loadMoreAuditButton");
const auditStatus = document.getElementById("auditStatus");
const auditList = document.getElementById("auditList");
const loadMoreAuditLabel = loadMoreAuditButton.textContent;

const consoleLog = document.getElementById("consoleLog");
const consoleStatus = document.getElementById("consoleStatus");
const consoleCommandForm = document.getElementById("consoleCommandForm");
const consoleCommandInput = document.getElementById("consoleCommandInput");

const RECENT_KEY = "webcraftops.recentServers";
const SESSION_KEY = "webcraftops.session";
const SESSION_MAX_IDLE_MS = 3 * 60 * 60 * 1000; // 3시간 자리비움 시 세션 만료
const HISTORY_MAX = 10;

const historyStack = [];
const redoStack = [];
let toolMode = "brush";
let rendererState = null;
let hasFramedCamera = false; // 첫 로드에서만 카메라를 자동으로 맞추고, 이후엔 사용자가 조작한 시점을 유지한다.
const loadedChunks = new Map(); // "cx,cz" -> { meshes, proxies } | null(로딩 중)
let chunkSyncTimer = null;
const chunkKey = (cx, cz) => `${cx},${cz}`;
let auditCursor = null;
let allBlocks = [];
let selectedBlockId = null;
let blockTextureBlobs = new Map(); // blockId -> PNG Blob (리소스팩에서 추출)
const blockTextureCache = new Map(); // blockId -> THREE.Texture (한 번 만든 건 재사용)

// 청크 렌더링은 월드 최저 높이를 0으로 둔 로컬 Y좌표를 쓴다(디코드/메쉬 좌표계).
// Bridge(bridge-paper)에 실제로 setBlock을 보낼 때는 진짜 월드 Y로 되돌려야 한다 —
// 이 보정이 빠지면 블록이 항상 64칸 위(하늘)에 배치된다. 표준 오버월드는 항상
// -64부터 시작한다(1.18+ 확장 높이). 커스텀 데이터팩으로 바뀐 월드는 다를 수 있음.
const WORLD_MIN_HEIGHT = -64;

const VIEWER_SETTINGS_KEY = "webcraftops.viewerSettings";
const DEFAULT_VIEWER_SETTINGS = { rotateSpeed: 1, zoomSpeed: 1, panSpeed: 1, chunkRadius: 0 };

const loadViewerSettings = () => {
  try {
    return { ...DEFAULT_VIEWER_SETTINGS, ...JSON.parse(localStorage.getItem(VIEWER_SETTINGS_KEY)) };
  } catch {
    return { ...DEFAULT_VIEWER_SETTINGS };
  }
};

const saveViewerSettings = (settings) => {
  localStorage.setItem(VIEWER_SETTINGS_KEY, JSON.stringify(settings));
};

let viewerSettings = loadViewerSettings();
let consoleEventSource = null;

const STATUS_LABEL = {
  queued: "대기",
  running: "실행 중",
  paused: "일시정지",
  completed: "완료",
  failed: "실패",
  canceled: "취소됨",
};

// ---- 탭 ----

const switchTab = (name) => {
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
};

const enableTabs = () => {
  tabButtons.forEach((btn) => {
    if (btn.dataset.tab !== "connect") {
      btn.disabled = false;
    }
  });
};

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) {
      return;
    }
    switchTab(btn.dataset.tab);
  });
});

// ---- 공통 유틸 ----
// 백엔드는 프런트와 항상 같은 오리진에서 서빙되므로(server.ts가 정적 파일도 같이 서빙),
// 별도 Backend 주소 입력 없이 전부 상대 경로로 호출한다.

// 마인크래프트 공식 한국어 번역(ko_kr.json의 block.minecraft.* 키)을 그대로 사용한다.
// 없는 블록(옛 wall_banner 등 극소수)만 영문 폴백으로 표시한다.
let koBlockNames = {};
try {
  const koResponse = await fetch("vendor/block-names-ko.json");
  koBlockNames = await koResponse.json();
} catch {
  koBlockNames = {};
}

const friendlyName = (id) => {
  if (koBlockNames[id]) {
    return koBlockNames[id];
  }
  const raw = id.includes(":") ? id.split(":")[1] : id;
  return raw
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

const hashHue = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
};

const swatchColor = (id) => `hsl(${hashHue(id)}, 55%, 55%)`;

const updateResult = (message) => {
  result.textContent = message;
};

// ---- 3D 뷰어 ----

// 리소스팩에서 뽑아온 PNG를 THREE.Texture로 변환(1회만, 이후 캐시). 리소스팩을
// 안 넣었거나 그 블록 텍스처가 없으면 null을 돌려줘서 호출부가 단색으로 대체하게 한다.
const getBlockTexture = async (THREE, blockId) => {
  if (blockTextureCache.has(blockId)) {
    return blockTextureCache.get(blockId);
  }
  const blob = blockTextureBlobs.get(blockId);
  if (!blob) {
    return null;
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const texture = new THREE.CanvasTexture(bitmap);
    texture.magFilter = THREE.NearestFilter; // 마인크래프트 특유의 픽셀 텍스처 유지(블러 방지)
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    blockTextureCache.set(blockId, texture);
    return texture;
  } catch {
    return null;
  }
};

const ensureRenderer = async () => {
  if (rendererState) {
    return rendererState;
  }
  const THREE = await import("./vendor/three.module.js");
  const { OrbitControls } = await import("./vendor/OrbitControls.js");
  const renderer = new THREE.WebGLRenderer({ canvas: viewerCanvas, antialias: true });
  renderer.setSize(viewerCanvas.clientWidth, viewerCanvas.clientHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1220");

  const camera = new THREE.PerspectiveCamera(
    45,
    viewerCanvas.clientWidth / viewerCanvas.clientHeight,
    0.1,
    500,
  );
  camera.position.set(6, 6, 8);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(5, 10, 7);
  scene.add(ambient);
  scene.add(light);

  // 드래그로 회전, 휠로 확대/축소, 오른쪽 드래그(또는 Ctrl+드래그)로 이동.
  // 이게 없으면 카메라가 고정 각도 하나뿐이라 원하는 블록을 조준할 방법이 없다.
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.rotateSpeed = viewerSettings.rotateSpeed;
  controls.zoomSpeed = viewerSettings.zoomSpeed;
  controls.panSpeed = viewerSettings.panSpeed;
  controls.target.set(0, 0, 0);
  camera.lookAt(controls.target);
  controls.update();

  // 시점(정확히는 target)이 옮겨질 때마다 주변 청크를 다시 계산한다. 드래그 중
  // 계속 발생하는 이벤트라 디바운스해서 과도한 요청을 막는다.
  controls.addEventListener("change", () => {
    clearTimeout(chunkSyncTimer);
    chunkSyncTimer = setTimeout(syncChunksAroundCamera, 400);
  });

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const selectable = [];

  // 배치될 위치를 클릭 전에 보여주는 반투명 미리보기 큐브 — "엉뚱한 곳에 생성"
  // 문제를 사용자가 클릭 전에 눈으로 검증할 수 있게 한다.
  const previewMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.35, wireframe: false }),
  );
  previewMesh.visible = false;
  scene.add(previewMesh);

  const render = () => {
    renderer.render(scene, camera);
  };
  render();

  const animate = () => {
    requestAnimationFrame(animate);
    controls.update();
    render();
  };
  animate();

  const handleResize = () => {
    const width = viewerCanvas.clientWidth;
    const height = viewerCanvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", handleResize);

  // 클릭/호버가 공유하는 대상 계산: 어느 면을 가리키고 있는지, 그 면 바깥쪽
  // (마인크래프트 방식 — 클릭한 블록을 바꾸는 게 아니라 옆에 새로 놓는다)
  // 인접 칸의 모서리 기준 좌표를 구한다. 프록시는 셀 중심(x+0.5)에 있으므로
  // -0.5를 빼서 다시 모서리 기준 정수 좌표로 되돌린다.
  const computeTarget = (clientX, clientY) => {
    const rect = viewerCanvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(selectable);
    if (intersects.length === 0) {
      return null;
    }
    const hit = intersects[0].object;
    const normal = intersects[0].face.normal.clone().transformDirection(hit.matrixWorld).round();
    return {
      hit,
      lx: hit.position.x - 0.5 + normal.x,
      ly: hit.position.y - 0.5 + normal.y,
      lz: hit.position.z - 0.5 + normal.z,
    };
  };

  viewerCanvas.addEventListener("mousemove", (event) => {
    if (toolMode !== "brush" || !selectedBlockId) {
      previewMesh.visible = false;
      return;
    }
    const target = computeTarget(event.clientX, event.clientY);
    if (!target) {
      previewMesh.visible = false;
      return;
    }
    previewMesh.position.set(target.lx + 0.5, target.ly + 0.5, target.lz + 0.5);
    previewMesh.visible = true;
    render();
  });
  viewerCanvas.addEventListener("mouseleave", () => {
    previewMesh.visible = false;
    render();
  });

  viewerCanvas.addEventListener("click", async (event) => {
    const rect = viewerCanvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(selectable);
    if (intersects.length === 0) {
      viewerStatus.textContent = "클릭한 위치에 블록이 없습니다. 드래그로 시점을 돌려보세요.";
      return;
    }

    if (toolMode === "select") {
      const hit = intersects[0].object;
      viewerStatus.textContent = `블록: ${friendlyName(hit.userData?.blockId ?? "unknown")}`;
      return;
    }

    if (!selectedBlockId) {
      viewerStatus.textContent = "먼저 팔레트에서 블록을 선택하세요.";
      return;
    }

    const target = computeTarget(event.clientX, event.clientY);
    if (!target) {
      return;
    }
    const { lx, ly, lz } = target;

    const bridgeUrl = bridgeInput.value.trim() || undefined;
    const { payload } = await createEditJobRequest("ui", [
      { type: "setBlock", params: { pos: [lx, ly + WORLD_MIN_HEIGHT, lz], block: selectedBlockId } },
    ], bridgeUrl);
    if (payload?.jobId) {
      recordAction(payload.jobId, "create", `블록 배치: ${friendlyName(selectedBlockId)}`);
      viewerStatus.textContent = `배치 완료: ${friendlyName(selectedBlockId)}`;
      await loadEditJobs();

      // 서버 응답을 기다렸다 "월드 불러오기"로 다시 받아오지 않고, 이미 뭘 어디에
      // 놓았는지 클라이언트가 알고 있으니 씬에 바로 반영한다.
      const texture = await getBlockTexture(THREE, selectedBlockId);
      const material = texture
        ? new THREE.MeshStandardMaterial({ map: texture })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(swatchColor(selectedBlockId)) });
      const placedMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      placedMesh.position.set(lx + 0.5, ly + 0.5, lz + 0.5);
      scene.add(placedMesh);

      const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      proxy.position.set(lx + 0.5, ly + 0.5, lz + 0.5);
      proxy.userData = { blockId: selectedBlockId };
      proxy.visible = false;
      scene.add(proxy);
      selectable.push(proxy);
      render();
    } else {
      viewerStatus.textContent = "블록 배치 실패";
    }
  });

  rendererState = { THREE, renderer, scene, camera, controls, selectable, render };
  return rendererState;
};

// 청크 (cx,cz)의 디코드 결과를 씬에 배치한다. 렌더링 좌표계는 진짜 월드 X/Z를 쓴다
// (renderX = cx*16 + localX) — 그래야 인접 청크가 자연스럽게 이어지고, 카메라
// 위치에서 바로 "지금 몇 번 청크를 보고 있는지" 계산할 수 있다.
const placeChunkMesh = async (cx, cz, mesh) => {
  const { THREE, scene, camera, controls, selectable, render } = await ensureRenderer();
  const ox = cx * 16;
  const oz = cz * 16;
  const meshes = [];
  const proxies = [];

  if (Array.isArray(mesh?.groups)) {
    for (const group of mesh.groups) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(group.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(group.normals, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(group.uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(group.indices, 1));

      const texture = await getBlockTexture(THREE, group.blockId);
      const material = texture
        ? new THREE.MeshStandardMaterial({ map: texture })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(...group.color) });
      const blockMesh = new THREE.Mesh(geometry, material);
      blockMesh.position.set(ox, 0, oz);
      scene.add(blockMesh);
      meshes.push(blockMesh);
    }
  }

  // 실제 청크는 최대 384블록 높이라 전체를 한 화면에 담을 수 없다. 지표면
  // (surfaceY) 근처를 기본 시야로 맞춘다 — 그렇지 않으면 카메라가 지형 속에
  // 파묻혀 아무 것도 클릭할 수 없다. 단, 이건 첫 로드에서만 한다 — 매번 다시
  // 불러올 때마다 하면 사용자가 드래그/줌으로 잡아둔 시점이 계속 초기화된다.
  if (!hasFramedCamera && mesh?.dimensions) {
    hasFramedCamera = true;
    const { sizeX, sizeZ } = mesh.dimensions;
    const focusY = mesh.surfaceY ?? 0;
    camera.position.set(ox + sizeX / 2 + 10, focusY + 8, oz + sizeZ / 2 + 14);
    // camera.lookAt() 대신 OrbitControls의 target을 옮겨야 한다 — 안 그러면
    // 컨트롤이 다음 조작 때 자기가 기억하던 이전 각도로 카메라를 되돌려버린다.
    controls.target.set(ox + sizeX / 2, focusY, oz + sizeZ / 2);
    controls.update();
  }

  // 클릭 판정용 프록시 박스. 눈에는 안 보여야 하지만(실제 색은 blockMesh가 그림),
  // 씬에 추가는 해야 한다 — Three.js는 씬 그래프에 없는 오브젝트의 matrixWorld를
  // 갱신하지 않아서, 추가하지 않으면 레이캐스팅이 전부 원점 기준으로 어긋난다.
  // BoxGeometry(1,1,1)은 중심이 원점이라 [x-0.5,x+0.5] 구간을 차지하는데,
  // blockMesh 쪽은 모서리 기준으로 [x,x+1] 구간을 쓴다 — +0.5 보정을 안 하면
  // 보이는 블록과 클릭 판정이 반 칸 어긋나서 엉뚱한 면이 잡힌다.
  mesh.voxels.forEach((voxel) => {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    proxy.position.set(ox + voxel.position[0] + 0.5, voxel.position[1] + 0.5, oz + voxel.position[2] + 0.5);
    proxy.userData = { blockId: voxel.blockId };
    proxy.visible = false;
    scene.add(proxy);
    selectable.push(proxy);
    proxies.push(proxy);
  });

  loadedChunks.set(chunkKey(cx, cz), { meshes, proxies });
  viewerStatus.textContent = "불러오기 완료. 블록을 클릭해 배치/조회하세요.";
  render();
};

const loadChunkAt = async (cx, cz) => {
  const key = chunkKey(cx, cz);
  if (loadedChunks.has(key)) {
    return;
  }
  loadedChunks.set(key, null); // 로딩 중 표시 — 동시에 두 번 요청 안 되게
  const bridgeUrl = bridgeInput.value.trim();
  if (!bridgeUrl) {
    loadedChunks.delete(key);
    return;
  }
  const normalized = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
  try {
    const { response, buffer } = await fetchChunkBinary(normalized, cx, cz);
    if (!response.ok) {
      loadedChunks.delete(key);
      return;
    }
    await new Promise((resolve) => {
      // CDN 엣지 캐시(Cloudflare 등)가 chunk-worker.js를 붙잡고 있을 수 있어
      // 매번 다른 쿼리스트링으로 요청해 캐시를 무력화한다.
      const worker = new Worker(`./chunk-worker.js?v=${Date.now()}`);
      worker.postMessage({ buffer, lodStep: 1 }, [buffer]);
      worker.addEventListener("message", async (event) => {
        await placeChunkMesh(cx, cz, event.data.mesh);
        worker.terminate();
        resolve();
      });
    });
  } catch (error) {
    loadedChunks.delete(key);
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    viewerStatus.textContent = `청크(${cx},${cz}) 로드 실패: ${message}`;
  }
};

const unloadChunk = async (cx, cz) => {
  const key = chunkKey(cx, cz);
  const entry = loadedChunks.get(key);
  loadedChunks.delete(key);
  if (!entry) {
    return; // null(로딩 중)이거나 이미 없음
  }
  const { scene, selectable, render } = await ensureRenderer();
  entry.meshes.forEach((m) => {
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  });
  entry.proxies.forEach((p) => {
    scene.remove(p);
    const idx = selectable.indexOf(p);
    if (idx !== -1) {
      selectable.splice(idx, 1);
    }
    p.geometry.dispose();
    p.material.dispose();
  });
  render();
};

// 카메라(정확히는 OrbitControls의 target — 사용자가 지금 보고 있는 지점)가 걸쳐 있는
// 청크를 기준으로 설정된 반경만큼만 로드하고, 범위를 벗어난 건 정리한다.
const syncChunksAroundCamera = async () => {
  if (!rendererState) {
    return;
  }
  const { controls } = rendererState;
  const centerCx = Math.floor(controls.target.x / 16);
  const centerCz = Math.floor(controls.target.z / 16);
  const radius = viewerSettings.chunkRadius;
  const desired = new Set();
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      desired.add(chunkKey(centerCx + dx, centerCz + dz));
    }
  }
  for (const key of desired) {
    if (!loadedChunks.has(key)) {
      const [cx, cz] = key.split(",").map(Number);
      await loadChunkAt(cx, cz);
    }
  }
  for (const key of Array.from(loadedChunks.keys())) {
    if (!desired.has(key)) {
      const [cx, cz] = key.split(",").map(Number);
      await unloadChunk(cx, cz);
    }
  }
};

const setToolMode = (mode) => {
  toolMode = mode;
  toolBrushButton.classList.toggle("active", mode === "brush");
  toolSelectButton.classList.toggle("active", mode === "select");
  viewerStatus.textContent = mode === "brush" ? "브러시 모드" : "조회 모드";
};

const loadWorld = async () => {
  const bridgeUrl = bridgeInput.value.trim();
  if (!bridgeUrl) {
    viewerStatus.textContent = "먼저 서버에 연결해 주세요.";
    return;
  }
  viewerStatus.textContent = "월드를 불러오는 중...";
  await ensureRenderer();
  await loadChunkAt(0, 0); // 이미 로드돼 있으면(재클릭) 아무 것도 안 함 — 카메라도 그대로.
  await syncChunksAroundCamera(); // 청크 반경 설정에 맞춰 주변 청크도 함께.
};

const applyResourcePack = async () => {
  const file = resourcePackFileInput.files?.[0];
  if (!file) {
    viewerStatus.textContent = "리소스팩 .zip 파일을 선택해 주세요.";
    return;
  }
  viewerStatus.textContent = "리소스팩 압축 해제 중...";
  try {
    const { loadBlockTexturesFromResourcePack } = await import("./resourcepack.js");
    blockTextureBlobs = await loadBlockTexturesFromResourcePack(file, (done, total) => {
      viewerStatus.textContent = `텍스처 추출 중... (${done}/${total})`;
    });
    // 이전 리소스팩에서 만들어둔 텍스처는 GPU 메모리에서 해제하고 새로 만든다.
    blockTextureCache.forEach((texture) => texture.dispose());
    blockTextureCache.clear();
    viewerStatus.textContent = `리소스팩 적용됨: 블록 텍스처 ${blockTextureBlobs.size}개`;
    if (bridgeInput.value.trim()) {
      await loadWorld();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    viewerStatus.textContent = `리소스팩 적용 실패: ${message}`;
  }
};

// ---- 세션 유지 ----
// 새로고침/네비게이션으론 안 끊기고, 3시간 자리비움이거나 백엔드/브릿지 자체가
// 재기동되면(부팅 ID가 바뀌면) 끊긴다. 그 외엔 계속 유지.

const loadSession = () => {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
};

const saveSession = (session) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
};

let lastActivityWriteAt = 0;
const touchSession = () => {
  const now = Date.now();
  if (now - lastActivityWriteAt < 5000) {
    return; // 너무 잦은 localStorage 쓰기 방지
  }
  const session = loadSession();
  if (!session) {
    return;
  }
  session.lastActivityAt = now;
  saveSession(session);
  lastActivityWriteAt = now;
};
document.addEventListener("click", touchSession);

const fetchBackendHealth = async () => {
  const response = await fetch("health");
  return response.json();
};

// 페이지를 열자마자 한 번 시도 — 저장된 세션이 있고, 3시간 안에 활동이 있었고,
// 백엔드/브릿지가 그때랑 같은 프로세스(부팅 ID 동일)면 자동 재연결한다.
// bootId가 없는(아직 재배포 전) 구버전 브릿지는 "재시작 여부를 알 수 없음"으로
// 보고 세션을 그대로 유지한다 — 값이 있는데 달라졌을 때만 끊는다.
const restoreSession = async () => {
  const session = loadSession();
  if (!session) {
    return;
  }
  if (Date.now() - session.lastActivityAt > SESSION_MAX_IDLE_MS) {
    clearSession();
    return;
  }
  try {
    const health = await fetchBackendHealth();
    if (session.backendBootId && health.bootId && session.backendBootId !== health.bootId) {
      clearSession();
      return;
    }
    const { response, payload } = await fetchBridgeInfo(session.bridgeUrl);
    if (!response.ok) {
      clearSession();
      return;
    }
    if (session.bridgeBootId && payload.bootId && session.bridgeBootId !== payload.bootId) {
      clearSession();
      return;
    }
    bridgeInput.value = session.bridgeUrl;
    await testConnection();
  } catch {
    clearSession();
  }
};

// ---- 서버 연결 / 최근 목록 ----

const loadRecents = () => {
  const stored = localStorage.getItem(RECENT_KEY);
  return stored ? JSON.parse(stored) : [];
};

const saveRecents = (items) => {
  localStorage.setItem(RECENT_KEY, JSON.stringify(items));
};

const renderRecents = () => {
  const items = loadRecents();
  recentList.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `${item.name} (${item.bridgeUrl})`;
    li.addEventListener("click", () => {
      bridgeInput.value = item.bridgeUrl;
      testConnection();
    });
    recentList.appendChild(li);
  });
};

const fetchBridgeInfo = async (bridgeUrl) => {
  const response = await fetch(`bridge/info?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
  const payload = await response.json();
  return { response, payload: payload.payload ?? payload };
};

const fetchRegistryBlocks = async (bridgeUrl) => {
  const response = await fetch(`bridge/registry/blocks?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
  const payload = await response.json();
  return { response, payload: payload.payload ?? payload };
};

const fetchChunkBinary = async (bridgeUrl, cx = 0, cz = 0) => {
  const params = new URLSearchParams({ bridgeUrl, cx: String(cx), cz: String(cz) });
  const response = await fetch(`bridge/world/overworld/chunks?${params.toString()}`);
  const buffer = await response.arrayBuffer();
  return { response, buffer };
};

const testConnection = async () => {
  const bridgeUrl = bridgeInput.value.trim();
  if (!bridgeUrl) {
    updateResult("서버 주소를 입력해 주세요.");
    return;
  }

  testButton.disabled = true;
  updateResult("연결 중...");

  try {
    const normalized = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const { response, payload } = await fetchBridgeInfo(normalized);

    if (response.ok) {
      updateResult(`연결됨: ${payload.name ?? "서버"}${payload.mcVersion ? ` · ${payload.mcVersion}` : ""}`);
      const recents = loadRecents();
      const next = [
        { name: payload.name ?? "서버", bridgeUrl: normalized },
        ...recents.filter((item) => item.bridgeUrl !== normalized),
      ].slice(0, 5);
      saveRecents(next);
      renderRecents();

      const health = await fetchBackendHealth().catch(() => ({}));
      saveSession({
        bridgeUrl: normalized,
        backendBootId: health.bootId ?? null,
        bridgeBootId: payload.bootId ?? null,
        lastActivityAt: Date.now(),
      });

      enableTabs();
      switchTab("build");
      await loadPalette(normalized);
      await loadEditJobs();
      await loadBlueprints();
      await loadAuditEntries();
      connectConsoleStream(normalized);
    } else {
      updateResult(`연결 실패 (${response.status})`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    updateResult(`연결 실패: ${message}`);
  } finally {
    testButton.disabled = false;
  }
};

// ---- 팔레트 ----

const renderPalette = (blocks) => {
  paletteGrid.innerHTML = "";
  if (blocks.length === 0) {
    paletteGrid.innerHTML = '<p class="empty-note">검색 결과가 없습니다.</p>';
    return;
  }
  blocks.forEach((block) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "palette-card" + (block.id === selectedBlockId ? " selected" : "");
    card.dataset.blockId = block.id;

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = swatchColor(block.id);

    const label = document.createElement("span");
    label.textContent = friendlyName(block.id);

    card.appendChild(swatch);
    card.appendChild(label);
    card.addEventListener("click", () => selectBlock(block.id));
    paletteGrid.appendChild(card);
  });
};

const selectBlock = (blockId) => {
  selectedBlockId = blockId;
  selectedBlockLabel.textContent = friendlyName(blockId);
  document.querySelectorAll(".palette-card").forEach((card) => {
    card.classList.toggle("selected", card.dataset.blockId === blockId);
  });
};

const applyPaletteFilter = () => {
  const query = paletteSearch.value.trim().toLowerCase();
  const filtered = query
    ? allBlocks.filter(
        (block) =>
          block.id.toLowerCase().includes(query) ||
          friendlyName(block.id).toLowerCase().includes(query),
      )
    : allBlocks;
  renderPalette(filtered);
};

const loadPalette = async (bridgeUrl) => {
  paletteStatus.textContent = "팔레트를 불러오는 중...";
  paletteGrid.innerHTML = "";

  try {
    const { response, payload } = await fetchRegistryBlocks(bridgeUrl);
    if (!response.ok) {
      paletteStatus.textContent = `팔레트 로드 실패 (${response.status})`;
      return;
    }
    allBlocks = payload.blocks ?? [];
    paletteStatus.textContent = `${allBlocks.length}개 블록`;
    applyPaletteFilter();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    paletteStatus.textContent = `팔레트 로드 실패: ${message}`;
  }
};

// ---- Edit Job ----

const fetchEditJobs = async () => {
  const response = await fetch("bridge/edit/jobs");
  const payload = await response.json();
  return { response, payload };
};

const createEditJobRequest = async (createdBy, commands, bridgeUrl) => {
  const query = bridgeUrl ? `?bridgeUrl=${encodeURIComponent(bridgeUrl)}` : "";
  const response = await fetch(`bridge/world/overworld/edit/jobs${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ createdBy, commands }),
  });
  const payload = await response.json();
  return { response, payload };
};

const updateEditJobStatus = async (jobId, action, bridgeUrl) => {
  const query = bridgeUrl ? `?bridgeUrl=${encodeURIComponent(bridgeUrl)}` : "";
  const response = await fetch(`bridge/edit/jobs/${jobId}/${action}${query}`, {
    method: "POST",
  });
  const payload = await response.json();
  return { response, payload };
};

const renderEditJobs = (jobs) => {
  editJobList.innerHTML = "";

  if (jobs.length === 0) {
    editJobList.innerHTML = '<p class="empty-note">생성된 작업이 없습니다.</p>';
    return;
  }

  jobs.forEach((job) => {
    const card = document.createElement("div");
    card.className = "item-card";

    const badge = document.createElement("span");
    badge.className = `badge badge-${job.status}`;
    badge.textContent = STATUS_LABEL[job.status] ?? job.status;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.style.marginTop = "0.4rem";
    meta.textContent = `월드: ${job.worldId}`;

    const progressTrack = document.createElement("div");
    progressTrack.className = "progress-track";
    const progressFill = document.createElement("div");
    progressFill.className = "progress-fill";
    const total = job.stats?.estimatedBlocks || 1;
    const done = job.stats?.doneBlocks ?? 0;
    progressFill.style.width = `${Math.min(100, Math.round((done / total) * 100))}%`;
    progressTrack.appendChild(progressFill);

    const progressLabel = document.createElement("span");
    progressLabel.className = "meta";
    progressLabel.textContent = `진행: ${done}/${job.stats?.estimatedBlocks ?? 0}`;

    const actions = document.createElement("div");
    actions.className = "btn-row";

    const pauseButton = document.createElement("button");
    pauseButton.className = "btn btn-sm";
    pauseButton.textContent = "일시정지";
    pauseButton.disabled = job.status !== "running";
    pauseButton.addEventListener("click", async () => {
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      await updateEditJobStatus(job.jobId, "pause", bridgeUrl);
      recordAction(job.jobId, "pause", "작업 일시정지");
      await loadEditJobs();
    });

    const resumeButton = document.createElement("button");
    resumeButton.className = "btn btn-sm";
    resumeButton.textContent = "재개";
    resumeButton.disabled = job.status !== "paused";
    resumeButton.addEventListener("click", async () => {
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      await updateEditJobStatus(job.jobId, "resume", bridgeUrl);
      recordAction(job.jobId, "resume", "작업 재개");
      await loadEditJobs();
    });

    const cancelButton = document.createElement("button");
    cancelButton.className = "btn btn-sm btn-danger";
    cancelButton.textContent = "취소";
    cancelButton.disabled = ["completed", "canceled"].includes(job.status);
    cancelButton.addEventListener("click", async () => {
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      await updateEditJobStatus(job.jobId, "cancel", bridgeUrl);
      recordAction(job.jobId, "cancel", "작업 취소");
      await loadEditJobs();
    });

    actions.appendChild(pauseButton);
    actions.appendChild(resumeButton);
    actions.appendChild(cancelButton);

    card.appendChild(badge);
    card.appendChild(meta);
    card.appendChild(progressTrack);
    card.appendChild(progressLabel);
    card.appendChild(actions);
    editJobList.appendChild(card);
  });
};

const loadEditJobs = async () => {
  try {
    const { response, payload } = await fetchEditJobs();
    if (!response.ok) {
      editJobStatus.textContent = `작업 목록 로드 실패 (${response.status})`;
      return;
    }
    editJobStatus.textContent = `${payload.length}개 작업`;
    renderEditJobs(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    editJobStatus.textContent = `작업 목록 로드 실패: ${message}`;
  }
};

// ---- Undo/Redo ----

const getInverseAction = (action) => {
  switch (action) {
    case "pause":
      return "resume";
    case "resume":
      return "pause";
    case "cancel":
      return null;
    case "create":
      return "revert";
    default:
      return null;
  }
};

const getRedoAction = (action) => {
  switch (action) {
    case "pause":
    case "resume":
      return action;
    default:
      return null;
  }
};

const pushHistory = (entry) => {
  historyStack.unshift(entry);
  if (historyStack.length > HISTORY_MAX) {
    historyStack.pop();
  }
  redoStack.length = 0;
  renderHistory();
};

const renderHistory = () => {
  historyList.innerHTML = "";
  if (historyStack.length === 0) {
    historyStatus.textContent = "기록이 없습니다.";
  } else {
    historyStatus.textContent = `최근 ${historyStack.length}건`;
  }
  historyStack.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `[${entry.timestamp}] ${entry.label}`;
    historyList.appendChild(item);
  });
  undoButton.disabled = historyStack.length === 0 || !historyStack[0].inverseAction;
  redoButton.disabled = redoStack.length === 0 || !redoStack[0].redoAction;
};

const recordAction = (jobId, action, label) => {
  pushHistory({
    jobId,
    action,
    inverseAction: getInverseAction(action),
    redoAction: getRedoAction(action),
    label,
    timestamp: new Date().toLocaleTimeString(),
  });
};

const runUndo = async () => {
  const bridgeUrl = bridgeInput.value.trim() || undefined;
  const entry = historyStack.shift();
  if (!entry || !entry.inverseAction) {
    historyStatus.textContent = "되돌릴 수 없는 작업입니다.";
    renderHistory();
    return;
  }
  historyStatus.textContent = "되돌리는 중...";
  try {
    await updateEditJobStatus(entry.jobId, entry.inverseAction, bridgeUrl);
    redoStack.unshift(entry);
    historyStatus.textContent = "완료";
    renderHistory();
    await loadEditJobs();
  } catch {
    historyStatus.textContent = "되돌리기 실패";
  }
};

const runRedo = async () => {
  const bridgeUrl = bridgeInput.value.trim() || undefined;
  const entry = redoStack.shift();
  if (!entry || !entry.redoAction) {
    historyStatus.textContent = "다시 실행할 수 없는 작업입니다.";
    renderHistory();
    return;
  }
  historyStatus.textContent = "다시 실행하는 중...";
  try {
    await updateEditJobStatus(entry.jobId, entry.redoAction, bridgeUrl);
    historyStack.unshift(entry);
    historyStatus.textContent = "완료";
    renderHistory();
    await loadEditJobs();
  } catch {
    historyStatus.textContent = "다시 실행 실패";
  }
};

// ---- 블루프린트 ----

const fetchBlueprints = async () => {
  const response = await fetch("blueprints");
  const payload = await response.json();
  return { response, payload };
};

const createBlueprint = async (blueprint) => {
  const response = await fetch("blueprints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blueprint),
  });
  const payload = await response.json();
  return { response, payload };
};

const createPasteJob = async (blueprintId) => {
  const bridgeUrl = bridgeInput.value.trim() || undefined;
  return createEditJobRequest("ui", [{ type: "pasteBlueprint", params: { blueprintId } }], bridgeUrl);
};

const renderBlueprints = (blueprints) => {
  blueprintList.innerHTML = "";

  if (blueprints.length === 0) {
    blueprintList.innerHTML = '<p class="empty-note">등록된 블루프린트가 없습니다.</p>';
    return;
  }

  blueprints.forEach((blueprint) => {
    const card = document.createElement("div");
    card.className = "item-card";

    const title = document.createElement("strong");
    title.textContent = blueprint.name ?? blueprint.id ?? "이름 없음";

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `블록 ${blueprint.blocks ?? "?"}개${
      blueprint.tags?.length ? ` · ${blueprint.tags.join(", ")}` : ""
    }`;

    const actions = document.createElement("div");
    actions.className = "btn-row";

    const pasteButton = document.createElement("button");
    pasteButton.className = "btn btn-sm btn-primary";
    pasteButton.textContent = "붙여넣기";
    pasteButton.addEventListener("click", async () => {
      blueprintStatus.textContent = "붙여넣기 작업 생성 중...";
      const { response, payload } = await createPasteJob(blueprint.id);
      if (!response.ok) {
        blueprintStatus.textContent = `붙여넣기 실패 (${response.status})`;
        return;
      }
      blueprintStatus.textContent = "붙여넣기 작업이 생성됐습니다.";
      recordAction(payload.jobId, "create", `블루프린트 붙여넣기: ${blueprint.name ?? blueprint.id}`);
      await loadEditJobs();
    });

    actions.appendChild(pasteButton);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);
    blueprintList.appendChild(card);
  });
};

const loadBlueprints = async () => {
  try {
    const { response, payload } = await fetchBlueprints();
    if (!response.ok) {
      blueprintStatus.textContent = `목록 로드 실패 (${response.status})`;
      return;
    }
    renderBlueprints(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    blueprintStatus.textContent = `목록 로드 실패: ${message}`;
  }
};

const uploadBlueprint = async () => {
  const file = blueprintFileInput.files?.[0];
  if (!file) {
    blueprintStatus.textContent = "schem 파일을 선택해 주세요.";
    return;
  }
  const name = blueprintNameInput.value.trim() || file.name.replace(".schem", "");
  const tags = blueprintTagsInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  blueprintStatus.textContent = "등록 중...";
  try {
    const { response, payload } = await createBlueprint({
      name,
      format: "schem",
      size: [0, 0, 0],
      blocks: 0,
      tags,
      createdBy: "ui",
      filename: file.name,
      bytes: file.size,
    });
    if (!response.ok) {
      blueprintStatus.textContent = `등록 실패 (${response.status})`;
      return;
    }
    blueprintStatus.textContent = `등록 완료: ${payload.name}`;
    await loadBlueprints();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    blueprintStatus.textContent = `등록 실패: ${message}`;
  }
};

// ---- 감사 로그 ----

const fetchAuditEntries = async (filters) => {
  const params = new URLSearchParams();
  if (filters.userId) params.set("userId", filters.userId);
  if (filters.worldId) params.set("worldId", filters.worldId);
  if (filters.commandType) params.set("commandType", filters.commandType);
  if (filters.since) params.set("since", filters.since);
  if (filters.until) params.set("until", filters.until);
  if (typeof filters.limit === "number" && !Number.isNaN(filters.limit)) {
    params.set("limit", String(filters.limit));
  }
  if (filters.cursor) params.set("cursor", filters.cursor);
  const query = params.toString();
  const response = await fetch(`audit${query ? `?${query}` : ""}`);
  const payload = await response.json();
  return { response, payload };
};

const renderAuditEntries = (entries, mode = "replace") => {
  if (mode === "replace") {
    auditList.innerHTML = "";
  }
  if (entries.length === 0) {
    if (mode === "replace") {
      auditList.innerHTML = '<p class="empty-note">감사 로그가 없습니다.</p>';
    }
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement("li");
    const summary = document.createElement("strong");
    summary.textContent = `${entry.commandType} · ${entry.worldId}`;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${entry.userId} · ${entry.estimatedBlocks}블록 · ${new Date(entry.createdAt).toLocaleString()}`;

    item.appendChild(summary);
    item.appendChild(meta);
    auditList.appendChild(item);
  });
};

const loadAuditEntries = async (mode = "replace") => {
  if (mode === "replace") {
    auditCursor = null;
  }
  loadMoreAuditButton.disabled = true;
  loadMoreAuditButton.textContent = "불러오는 중...";
  auditStatus.textContent = "불러오는 중...";
  try {
    const { response, payload } = await fetchAuditEntries({
      userId: auditUserIdInput.value.trim() || undefined,
      worldId: auditWorldIdInput.value.trim() || undefined,
      commandType: auditCommandTypeInput.value.trim() || undefined,
      since: auditSinceInput.value ? new Date(auditSinceInput.value).toISOString() : undefined,
      until: auditUntilInput.value ? new Date(auditUntilInput.value).toISOString() : undefined,
      limit: auditLimitInput.value ? Number(auditLimitInput.value) : undefined,
      cursor: mode === "append" ? auditCursor : undefined,
    });
    if (!response.ok) {
      auditStatus.textContent = `로드 실패 (${response.status})`;
      return;
    }
    const items = Array.isArray(payload) ? payload : payload.items ?? [];
    auditCursor = Array.isArray(payload) ? null : payload.nextCursor ?? null;
    auditStatus.textContent = `${items.length}건`;
    renderAuditEntries(items, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    auditStatus.textContent = `로드 실패: ${message}`;
  } finally {
    loadMoreAuditButton.textContent = loadMoreAuditLabel;
    loadMoreAuditButton.disabled = !auditCursor;
  }
};

// ---- 콘솔 ----

// 콘솔 로그는 터미널용 ANSI 색상 코드를 그대로 담고 있고(예: /help 결과), 마인크래프트가
// 자체 제공 명령어에 붙이는 "A Mojang provided command." 설명은 정보가 없어 노이즈만 된다.
const cleanConsoleLine = (line) =>
  line.replace(/\x1b\[[0-9;]*m/g, "").replace(/:\s*A Mojang provided command\.\s*$/, "");

const appendConsoleLine = (line) => {
  const cleaned = cleanConsoleLine(line);
  const atBottom = consoleLog.scrollHeight - consoleLog.scrollTop - consoleLog.clientHeight < 24;
  consoleLog.textContent += (consoleLog.textContent ? "\n" : "") + cleaned;
  if (atBottom) {
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }
};

// 브라우저 EventSource는 커스텀 헤더를 못 보내므로 항상 백엔드(같은 오리진)로만
// 연결한다 — 브릿지 토큰은 백엔드가 프록시하면서 실어 보낸다. 연결이 끊기면
// EventSource가 알아서 재시도한다(백엔드/브릿지 재기동 후 자동 복구).
const connectConsoleStream = (bridgeUrl) => {
  if (consoleEventSource) {
    consoleEventSource.close();
  }
  consoleLog.textContent = "";
  consoleStatus.textContent = "연결 중...";
  const es = new EventSource(`bridge/console/stream?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
  es.onopen = () => {
    consoleStatus.textContent = "연결됨";
  };
  es.onmessage = (event) => {
    appendConsoleLine(event.data);
  };
  es.onerror = () => {
    consoleStatus.textContent = "연결 끊김 (재시도 중...)";
  };
  consoleEventSource = es;
};

const sendConsoleCommand = async (bridgeUrl, command) => {
  try {
    const response = await fetch(`bridge/console/command?bridgeUrl=${encodeURIComponent(bridgeUrl)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      appendConsoleLine(`[오류] 명령어 실행 실패: ${payload.error ?? response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appendConsoleLine(`[오류] 명령어 전송 실패: ${message}`);
  }
};

consoleCommandForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const command = consoleCommandInput.value.trim();
  const bridgeUrl = bridgeInput.value.trim();
  if (!command || !bridgeUrl) {
    return;
  }
  consoleCommandInput.value = "";
  sendConsoleCommand(bridgeUrl, command);
});

// ---- 이벤트 바인딩 ----

testButton.addEventListener("click", testConnection);
toolBrushButton.addEventListener("click", () => setToolMode("brush"));
toolSelectButton.addEventListener("click", () => setToolMode("select"));
viewerLoadButton.addEventListener("click", loadWorld);
resourcePackButton.addEventListener("click", applyResourcePack);
viewerSettingsButton.addEventListener("click", () => viewerSettingsDialog.showModal());
viewerSettingsCloseButton.addEventListener("click", () => viewerSettingsDialog.close());

const applySpeedSetting = (key, valueEl, input) => {
  const value = Number(input.value);
  viewerSettings[key] = value;
  valueEl.textContent = value.toFixed(1);
  saveViewerSettings(viewerSettings);
  if (rendererState) {
    rendererState.controls[key] = value;
  }
};
rotateSpeedInput.addEventListener("input", () => applySpeedSetting("rotateSpeed", rotateSpeedValue, rotateSpeedInput));
zoomSpeedInput.addEventListener("input", () => applySpeedSetting("zoomSpeed", zoomSpeedValue, zoomSpeedInput));
panSpeedInput.addEventListener("input", () => applySpeedSetting("panSpeed", panSpeedValue, panSpeedInput));
chunkRadiusInput.addEventListener("input", () => {
  viewerSettings.chunkRadius = Number(chunkRadiusInput.value);
  saveViewerSettings(viewerSettings);
});

rotateSpeedInput.value = viewerSettings.rotateSpeed;
zoomSpeedInput.value = viewerSettings.zoomSpeed;
panSpeedInput.value = viewerSettings.panSpeed;
rotateSpeedValue.textContent = viewerSettings.rotateSpeed.toFixed(1);
zoomSpeedValue.textContent = viewerSettings.zoomSpeed.toFixed(1);
panSpeedValue.textContent = viewerSettings.panSpeed.toFixed(1);
chunkRadiusInput.value = viewerSettings.chunkRadius;
paletteSearch.addEventListener("input", applyPaletteFilter);
refreshJobsButton.addEventListener("click", loadEditJobs);
undoButton.addEventListener("click", runUndo);
redoButton.addEventListener("click", runRedo);
refreshBlueprintsButton.addEventListener("click", loadBlueprints);
uploadBlueprintButton.addEventListener("click", uploadBlueprint);
refreshAuditButton.addEventListener("click", () => loadAuditEntries());
loadMoreAuditButton.addEventListener("click", () => loadAuditEntries("append"));

renderRecents();
renderHistory();
loadMoreAuditButton.disabled = true;
await restoreSession();
