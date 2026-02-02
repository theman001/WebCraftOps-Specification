const bridgeInput = document.getElementById("bridgeUrl");
const testButton = document.getElementById("testButton");
const result = document.getElementById("result");
const recentList = document.getElementById("recentList");
const paletteStatus = document.getElementById("paletteStatus");
const paletteGrid = document.getElementById("paletteGrid");

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

  try {
    const response = await fetch(`${bridgeUrl}/bridge/registry/blocks`);
    const payload = await response.json();
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
    const response = await fetch(`${normalized}/bridge/info`);
    const payload = await response.json();

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
