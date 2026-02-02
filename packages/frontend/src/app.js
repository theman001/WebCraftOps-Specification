const bridgeInput = document.getElementById("bridgeUrl");
const backendInput = document.getElementById("backendUrl");
const testButton = document.getElementById("testButton");
const result = document.getElementById("result");
const recentList = document.getElementById("recentList");
const paletteStatus = document.getElementById("paletteStatus");
const paletteGrid = document.getElementById("paletteGrid");
const chunkButton = document.getElementById("chunkButton");
const chunkStatus = document.getElementById("chunkStatus");
const chunkResult = document.getElementById("chunkResult");

const RECENT_KEY = "webcraftops.recentServers";

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
    });
    recentList.appendChild(li);
  });
};

const updateResult = (message) => {
  result.textContent = message;
};

const getBackendUrl = () => {
  const backendUrl = backendInput.value.trim();
  if (!backendUrl) {
    return null;
  }
  return backendUrl.endsWith("/") ? backendUrl.slice(0, -1) : backendUrl;
};

const fetchBridgeInfo = async (bridgeUrl, backendUrl) => {
  if (backendUrl) {
    const response = await fetch(
      `${backendUrl}/bridge/info?bridgeUrl=${encodeURIComponent(bridgeUrl)}`,
    );
    const payload = await response.json();
    return { response, payload: payload.payload ?? payload };
  }
  const response = await fetch(`${bridgeUrl}/bridge/info`);
  const payload = await response.json();
  return { response, payload };
};

const fetchRegistryBlocks = async (bridgeUrl, backendUrl) => {
  if (backendUrl) {
    const response = await fetch(
      `${backendUrl}/bridge/registry/blocks?bridgeUrl=${encodeURIComponent(bridgeUrl)}`,
    );
    const payload = await response.json();
    return { response, payload: payload.payload ?? payload };
  }
  const response = await fetch(`${bridgeUrl}/bridge/registry/blocks`);
  const payload = await response.json();
  return { response, payload };
};

const fetchChunkBinary = async (bridgeUrl, backendUrl) => {
  const chunkPath = "/bridge/world/overworld/chunks";
  if (backendUrl) {
    const response = await fetch(
      `${backendUrl}${chunkPath}?bridgeUrl=${encodeURIComponent(bridgeUrl)}`,
    );
    const buffer = await response.arrayBuffer();
    return { response, buffer };
  }
  const response = await fetch(`${bridgeUrl}${chunkPath}`);
  const buffer = await response.arrayBuffer();
  return { response, buffer };
};

const renderPalette = (blocks) => {
  paletteGrid.innerHTML = "";
  blocks.forEach((block) => {
    const card = document.createElement("div");
    card.className = "palette-card";

    const title = document.createElement("strong");
    title.textContent = block.id;

    const hint = document.createElement("span");
    hint.textContent = block.renderHint?.type
      ? `render: ${block.renderHint.type}`
      : "render: none";

    const properties = document.createElement("small");
    const propertyKeys = Object.keys(block.properties ?? {});
    properties.textContent =
      propertyKeys.length > 0
        ? `속성: ${propertyKeys.join(", ")}`
        : "속성: 없음";

    const defaults = document.createElement("small");
    defaults.textContent = block.defaultState
      ? `기본 상태: ${JSON.stringify(block.defaultState)}`
      : "기본 상태: 없음";

    card.appendChild(title);
    card.appendChild(hint);
    card.appendChild(properties);
    card.appendChild(defaults);
    paletteGrid.appendChild(card);
  });
};

const loadPalette = async (bridgeUrl) => {
  paletteStatus.textContent = "팔레트를 불러오는 중...";
  paletteGrid.innerHTML = "";
  const backendUrl = getBackendUrl();

  try {
    const { response, payload } = await fetchRegistryBlocks(bridgeUrl, backendUrl);
    if (!response.ok) {
      paletteStatus.textContent = `팔레트 로드 실패 (${response.status})`;
      return;
    }
    paletteStatus.textContent = `총 ${payload.blocks?.length ?? 0}개 블록 로드됨`;
    renderPalette(payload.blocks ?? []);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    paletteStatus.textContent = `팔레트 로드 실패: ${message}`;
  }
};

const decodeChunk = async (bridgeUrl) => {
  const backendUrl = getBackendUrl();
  chunkStatus.textContent = "청크를 불러오는 중...";
  chunkResult.innerHTML = "";

  try {
    const { response, buffer } = await fetchChunkBinary(bridgeUrl, backendUrl);
    if (!response.ok) {
      chunkStatus.textContent = `청크 로드 실패 (${response.status})`;
      return;
    }

    const worker = new Worker("./chunk-worker.js");
    worker.postMessage({ buffer }, [buffer]);
    worker.addEventListener("message", (event) => {
      const { palette, counts } = event.data;
      chunkStatus.textContent = "디코드 완료";
      chunkResult.innerHTML = "";
      palette.forEach((name, index) => {
        const li = document.createElement("li");
        li.textContent = `${name}: ${counts[index]} blocks`;
        chunkResult.appendChild(li);
      });
      worker.terminate();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    chunkStatus.textContent = `청크 로드 실패: ${message}`;
  }
};

const testConnection = async () => {
  const bridgeUrl = bridgeInput.value.trim();
  if (!bridgeUrl) {
    updateResult("Bridge URL을 입력해 주세요.");
    return;
  }

  testButton.disabled = true;
  updateResult("연결 테스트 중...");

  try {
    const normalized = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const backendUrl = getBackendUrl();
    const { response, payload } = await fetchBridgeInfo(normalized, backendUrl);

    if (response.ok) {
      updateResult(`연결 성공!\n${JSON.stringify(payload, null, 2)}`);
      const recents = loadRecents();
      const next = [
        { name: payload.name ?? "서버", bridgeUrl: normalized },
        ...recents.filter((item) => item.bridgeUrl !== normalized),
      ].slice(0, 5);
      saveRecents(next);
      renderRecents();
      await loadPalette(normalized);
      chunkButton.onclick = () => decodeChunk(normalized);
    } else {
      updateResult(`연결 실패 (${response.status})\n${JSON.stringify(payload, null, 2)}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    updateResult(`연결 실패: ${message}`);
  } finally {
    testButton.disabled = false;
  }
};

testButton.addEventListener("click", testConnection);
renderRecents();
