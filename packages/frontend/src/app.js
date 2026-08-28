import { createMap } from "./map.js";
import { COMMAND_CATEGORIES, COMMANDS } from "./commands.js";

const bridgeInput = document.getElementById("bridgeUrl");
const testButton = document.getElementById("testButton");
const result = document.getElementById("result");
const recentList = document.getElementById("recentList");
const connectionDot = document.getElementById("connectionDot");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const mapCanvas = document.getElementById("mapCanvas");
const mapStatus = document.getElementById("mapStatus");
const showPlayersToggle = document.getElementById("showPlayers");
const showMobsToggle = document.getElementById("showMobs");
const showItemsToggle = document.getElementById("showItems");
const mapPlayerList = document.getElementById("mapPlayerList");
const mapFocusRow = document.getElementById("mapFocusRow");
const mapFocusStatus = document.getElementById("mapFocusStatus");
const mapFocusReleaseButton = document.getElementById("mapFocusReleaseButton");
const mapRefreshButton = document.getElementById("mapRefreshButton");
const mapSpawnStatus = document.getElementById("mapSpawnStatus");
const mapWorldTabs = document.getElementById("mapWorldTabs");

const commandSearchInput = document.getElementById("commandSearchInput");
const commandResultLog = document.getElementById("commandResultLog");

const consoleLog = document.getElementById("consoleLog");
const renderLog = document.getElementById("renderLog");
const consoleSubTabs = document.getElementById("consoleSubTabs");
const consoleStatus = document.getElementById("consoleStatus");
const consoleCommandForm = document.getElementById("consoleCommandForm");
const consoleCommandInput = document.getElementById("consoleCommandInput");
const consoleScrollBottomButton = document.getElementById("consoleScrollBottomButton");

const RECENT_KEY = "webcraftops.recentServers";
const SESSION_KEY = "webcraftops.session";
const SESSION_MAX_IDLE_MS = 3 * 60 * 60 * 1000; // 3시간 자리비움 시 세션 만료

let consoleEventSource = null;
let latestOnlinePlayers = []; // 명령어 탭의 플레이어 드롭다운/자동완성이 여길 참조한다.
// uuid별로 li를 유지해서, 매 스냅샷(300ms)마다 얼굴 아이콘을 다시 요청하지 않게 한다
// (엔티티 목록은 위치가 바뀔 때마다 통째로 갱신되지만, 얼굴 이미지는 유저가 들어오고
// 나갈 때만 새로 받아오면 충분함).
const mapPlayerListItems = new Map(); // uuid -> li
const renderMapPlayerList = (players) => {
  // 엔티티 스트림은 이제 모든 월드를 함께 보내므로(map.js 참고), 지도 탭 목록은 지금
  // 보고 있는 월드 소속만 걸러서 보여준다 — 명령어 탭 드롭다운은 이걸 거치지 않고
  // 전체(latestOnlinePlayers)를 쓴다(어느 월드에 있든 대상으로 고를 수 있어야 함). world
  // 필드가 없으면(재배포 전 구버전 bridge-paper) 걸러내지 않는다 — map.js의 같은 필터와
  // 동일한 하위호환 규칙.
  const inCurrentWorld = players.filter(
    (player) => player.world === undefined || player.world === mapInstance.getCurrentWorldId(),
  );
  if (inCurrentWorld.length === 0) {
    mapPlayerListItems.clear();
    mapPlayerList.innerHTML = '<li class="empty-note" style="cursor: default">접속한 유저가 없습니다.</li>';
    return;
  }
  if (mapPlayerList.querySelector(".empty-note")) {
    mapPlayerList.innerHTML = "";
  }
  const bridgeUrl = bridgeInput.value.trim();
  const seenUuids = new Set();
  inCurrentWorld.forEach((player) => {
    seenUuids.add(player.uuid);
    let entry = mapPlayerListItems.get(player.uuid);
    if (!entry) {
      const li = document.createElement("li");
      const icon = document.createElement("img");
      icon.className = "player-face-icon";
      icon.alt = "";
      icon.src = `bridge/players/${player.uuid}/head?bridgeUrl=${encodeURIComponent(bridgeUrl)}`;
      const nameEl = document.createElement("span");
      nameEl.textContent = player.name;
      const coordEl = document.createElement("span");
      coordEl.className = "player-list-coord"; // 실시간 좌표 — 스냅샷마다 텍스트만 갱신.
      li.appendChild(icon);
      li.appendChild(nameEl);
      li.appendChild(coordEl);
      li.addEventListener("click", () => mapInstance.lockOnto("players", player.uuid, player.name));
      mapPlayerList.appendChild(li);
      entry = { li, coordEl };
      mapPlayerListItems.set(player.uuid, entry);
    }
    // bridge-paper 재배포 전에는 스냅샷에 y가 없을 수 있음(구버전 플러그인) — NaN을 그대로
    // 보여주지 않고 "?"로 표시.
    const round = (n) => (Number.isFinite(n) ? Math.round(n) : "?");
    entry.coordEl.textContent = `${round(player.x)}, ${round(player.y)}, ${round(player.z)}`;
  });
  for (const [uuid, entry] of mapPlayerListItems) {
    if (!seenUuids.has(uuid)) {
      entry.li.remove();
      mapPlayerListItems.delete(uuid);
    }
  }
};

// 지도 탭의 플레이어 목록 갱신에 얹혀서, 명령어 탭의 플레이어 드롭다운/자동완성도 같이
// 최신 상태로 유지한다 — 별도로 엔티티 스트림을 또 구독할 필요 없음.
const onPlayersUpdate = (players) => {
  renderMapPlayerList(players);
  latestOnlinePlayers = players;
  updateCommandPlayerOptions(players);
};

// 지도 위 마커/유저 목록을 클릭해 "고정"하면(단순 1회 이동이 아니라 대상이 움직이는 동안
// 계속 화면 중앙에 붙어 따라감) 여기서 상태 표시 + 해제 버튼을 보여준다.
const renderMapFocusStatus = (name) => {
  mapFocusRow.style.display = name ? "flex" : "none";
  mapFocusStatus.textContent = name ? `고정 중: ${name}` : "";
};

const renderSpawnPoint = (spawn) => {
  mapSpawnStatus.textContent = spawn
    ? `스폰 포인트: ${Math.round(spawn.x)}, ${Math.round(spawn.y)}, ${Math.round(spawn.z)}`
    : "스폰 포인트: -";
};

// 탭/드롭다운에 보여줄 한글 라벨 — environment 기준(표시용일 뿐이라 커스텀 차원은
// world.id로 자연히 대체됨, 아래 ?? 참고). 실제 /execute in에 쓰는 값은 이제 서버가
// 내려주는 dimensionKey를 그대로 쓴다(environment로 유추하지 않음 — 커스텀 차원이나
// 같은 environment의 월드가 여럿이면 유추가 틀릴 수 있어서).
const WORLD_LABELS = { NORMAL: "오버월드", NETHER: "네더", THE_END: "엔드" };

// 지도 상단 월드 탭(오버월드/네더/엔드 등, 서버에 실제로 있는 월드만) — 클릭하면 그 월드
// 기준으로 지도를 다시 불러온다. 기존 서브탭(명령어/콘솔) 패턴 그대로 재사용.
const renderWorldTabs = (worlds) => {
  mapWorldTabs.innerHTML = "";
  worlds.forEach((world) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtab-btn";
    btn.textContent = WORLD_LABELS[world.environment] ?? world.id;
    btn.classList.toggle("active", world.id === mapInstance.getCurrentWorldId());
    btn.addEventListener("click", () => {
      mapInstance.switchWorld(world.id);
      renderWorldTabs(worlds);
    });
    mapWorldTabs.appendChild(btn);
  });
  updateCommandWorldOptions(worlds);
};

// 지도에서 플레이어 마커를 드래그해 놓으면(map.js) 그 지점 x,z의 최고 높이를 물어본 뒤
// +2 높이로 tp 명령을 보낸다 — 실제 명령 전송/실패 로그는 여기(콘솔 탭 로직)가 담당.
const handlePlayerDropTeleport = async (playerName, wx, wz) => {
  const bridgeUrl = bridgeInput.value.trim();
  if (!bridgeUrl) return;
  const x = Math.floor(wx);
  const z = Math.floor(wz);
  try {
    const params = new URLSearchParams({ bridgeUrl, x: String(x), z: String(z) });
    const res = await fetch(`bridge/world/${mapInstance.getCurrentWorldId()}/heightmap?${params}`);
    if (!res.ok) {
      // 409는 bridge-paper가 "아직 생성되지 않은 지역"이라 강제 생성을 피하고 돌려주는
      // 응답 — 그 외 상태 코드는 인증/프록시/서버 예외 등 다른 원인이라 뭉뚱그리지 않는다.
      const reason = res.status === 409 ? "미생성 지역" : `서버 오류 ${res.status}`;
      appendLine(consoleLog, `[오류] 텔레포트 실패: 그 지점의 높이를 알 수 없습니다(${reason}).`);
      return;
    }
    const { y } = await res.json();
    sendConsoleCommand(bridgeUrl, `tp ${playerName} ${x} ${y + 2} ${z}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appendLine(consoleLog, `[오류] 텔레포트 실패: ${message}`);
  }
};

const mapInstance = createMap({
  canvas: mapCanvas,
  statusEl: mapStatus,
  onPlayersUpdate,
  onFocusChange: renderMapFocusStatus,
  onSpawnPoint: renderSpawnPoint,
  onPlayerDropTeleport: handlePlayerDropTeleport,
  onWorldsUpdate: renderWorldTabs,
});

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

const updateResult = (message) => {
  result.textContent = message;
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
      connectionDot.classList.add("online");
      connectionDot.title = `연결됨 · ${payload.name ?? "서버"}`;
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
      switchTab("map");
      mapInstance.start(normalized);
      connectConsoleStream(normalized);
    } else {
      updateResult(`연결 실패 (${response.status})`);
      connectionDot.classList.remove("online");
      connectionDot.title = "연결 안 됨";
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    updateResult(`연결 실패: ${message}`);
    connectionDot.classList.remove("online");
    connectionDot.title = "연결 안 됨";
  } finally {
    testButton.disabled = false;
  }
};

// ---- 콘솔 ----

// 콘솔 로그는 터미널용 ANSI 색상 코드를 그대로 담고 있고(예: /help 결과), 마인크래프트가
// 자체 제공 명령어에 붙이는 "A Mojang provided command." 설명은 정보가 없어 노이즈만 된다.
const cleanConsoleLine = (line) =>
  line.replace(/\x1b\[[0-9;]*m/g, "").replace(/:\s*A Mojang provided command\.\s*$/, "");

// 지도 타일을 조금만 움직여도 [MapTile]/[MapEvents] 로그가 수백 줄씩 쏟아져서 실제 채팅/
// 명령 결과가 그 안에 파묻힌다 — 렌더링 로그는 아예 다른 패널(렌더링 로그 탭)로 분리한다.
const isRenderLogLine = (line) => line.includes("[MapTile]") || line.includes("[MapEvents]");

const appendLine = (el, line) => {
  const cleaned = cleanConsoleLine(line);
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  el.textContent += (el.textContent ? "\n" : "") + cleaned;
  if (atBottom) {
    el.scrollTop = el.scrollHeight;
  }
};

// 명령어 탭에서 "전송"으로 만든 명령의 실제 실행 결과(성공/에러 메시지)는 이 콘솔 스트림
// 라인으로 나온다 — 새 연결을 또 만들지 않고 같은 스트림을 명령어 탭 로그에도 그대로
// 흘려보낸다(렌더링 로그는 여기서도 무의미하니 같이 걸러낸다).
// 콘솔 전체 트래픽을 그대로 미러링하다 보니 consoleLog와 달리 여기는 오래 열어두면
// 계속 불어난다 — 최근 N줄만 남겨서 무한정 커지지 않게 한다.
const COMMAND_RESULT_LOG_MAX_LINES = 500;
const commandResultLines = [];
const appendCommandResultLine = (line) => {
  commandResultLines.push(cleanConsoleLine(line));
  if (commandResultLines.length > COMMAND_RESULT_LOG_MAX_LINES) {
    commandResultLines.splice(0, commandResultLines.length - COMMAND_RESULT_LOG_MAX_LINES);
  }
  commandResultLog.textContent = commandResultLines.join("\n");
  commandResultLog.scrollTop = commandResultLog.scrollHeight;
};

// 명령어를 실제로 보낸 순간 결과 로그 테두리를 잠깐 반짝여서, 로그 텍스트를 눈으로
// 훑지 않아도 "보냈다"는 걸 바로 알 수 있게 한다. 연달아 눌러도 매번 다시 반짝이도록
// 클래스를 지웠다 강제로 리플로우시킨 뒤 다시 붙인다.
const flashSent = (el) => {
  el.classList.remove("flash-sent");
  void el.offsetWidth;
  el.classList.add("flash-sent");
};

// 브라우저 EventSource는 커스텀 헤더를 못 보내므로 항상 백엔드(같은 오리진)로만
// 연결한다 — 브릿지 토큰은 백엔드가 프록시하면서 실어 보낸다. 연결이 끊기면
// EventSource가 알아서 재시도한다(백엔드/브릿지 재기동 후 자동 복구).
const connectConsoleStream = (bridgeUrl) => {
  if (consoleEventSource) {
    consoleEventSource.close();
  }
  consoleLog.textContent = "";
  renderLog.textContent = "";
  consoleStatus.textContent = "연결 중...";
  const es = new EventSource(`bridge/console/stream?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
  es.onopen = () => {
    consoleStatus.textContent = "연결됨";
  };
  es.onmessage = (event) => {
    if (isRenderLogLine(event.data)) {
      appendLine(renderLog, event.data);
      return;
    }
    appendLine(consoleLog, event.data);
    appendCommandResultLine(event.data);
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
      appendLine(consoleLog, `[오류] 명령어 실행 실패: ${payload.error ?? response.status}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    appendLine(consoleLog, `[오류] 명령어 전송 실패: ${message}`);
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
  flashSent(consoleLog);
});
// 서버 로그 / 렌더링 로그 서브탭 — 명령어 탭과 같은 방식(둘 중 하나만 보임).
let activeConsolePanel = consoleLog;
consoleSubTabs.querySelectorAll(".subtab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    consoleSubTabs.querySelectorAll(".subtab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    const showRender = btn.dataset.consoleSubtab === "render";
    consoleLog.hidden = showRender;
    renderLog.hidden = !showRender;
    activeConsolePanel = showRender ? renderLog : consoleLog;
  });
});

consoleScrollBottomButton.addEventListener("click", () => {
  activeConsolePanel.scrollTop = activeConsolePanel.scrollHeight;
});
mapFocusReleaseButton.addEventListener("click", () => mapInstance.clearLock());
mapRefreshButton.addEventListener("click", () => mapInstance.refreshTiles());

// ---- 명령어 (GUI 빌더) ----

// playerText(오프라인 계정도 가능한 대상)용 자동완성 목록 — 탭 전체가 공유한다.
const onlinePlayersDatalist = document.createElement("datalist");
onlinePlayersDatalist.id = "onlinePlayersDatalist";
document.body.appendChild(onlinePlayersDatalist);

const playerSelectElements = []; // "player" 타입 인자의 <select> 전체 — 플레이어 목록 갱신 시 같이 채운다.
const worldSelectElements = []; // "world" 타입 인자의 <select> 전체 — 월드 목록 갱신 시 같이 채운다.

const buildArgField = (command, arg) => {
  const field = document.createElement("div");
  field.className = "field";
  const label = document.createElement("label");
  label.textContent = arg.label;
  field.appendChild(label);

  if (arg.type === "player") {
    // 접속자가 있어도 맨 앞 옵션은 항상 빈 플레이스홀더 — 그래야 브라우저가 알파벳
    // 순으로 첫 플레이어를 "무선택 상태"로 자동 지정해버리는 일이 없다(킥/밴/처치처럼
    // 위험한 명령에서 확인 없이 엉뚱한 대상에게 나가면 안 되니까).
    const select = document.createElement("select");
    select.dataset.argKey = arg.key;
    select.innerHTML = '<option value="">(접속한 플레이어 없음)</option>';
    playerSelectElements.push(select);
    field.appendChild(select);
    return { field, getValue: () => select.value };
  }

  if (arg.type === "world") {
    // 접속자 목록과 달리 월드는 항상 최소 오버월드 하나는 있고 "대상 없음"이 위험하지
    // 않으므로(플레이어 선택과 달리 무작위 대상 오발송 위험이 없음), 빈 플레이스홀더 없이
    // 첫 옵션이 바로 기본 선택된다 — updateCommandWorldOptions가 실제 목록으로 채운다.
    const select = document.createElement("select");
    select.dataset.argKey = arg.key;
    worldSelectElements.push(select);
    field.appendChild(select);
    return { field, getValue: () => select.value };
  }

  if (arg.type === "playerText") {
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("list", onlinePlayersDatalist.id);
    input.placeholder = "플레이어 이름";
    input.autocomplete = "off";
    field.appendChild(input);
    return { field, getValue: () => input.value.trim() };
  }

  if (arg.type === "select") {
    const select = document.createElement("select");
    arg.options.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    field.appendChild(select);
    return { field, getValue: () => select.value };
  }

  if (arg.type === "number") {
    const input = document.createElement("input");
    input.type = "number";
    if (arg.min !== undefined) input.min = String(arg.min);
    if (arg.max !== undefined) input.max = String(arg.max);
    input.value = String(arg.default ?? 0);
    field.appendChild(input);
    return { field, getValue: () => input.value };
  }

  // "text" — 공지 문구처럼 타이핑이 꼭 필요한 값만 여기로 온다.
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = arg.placeholder ?? "";
  field.appendChild(input);
  return { field, getValue: () => input.value.trim() };
};

const buildCommandCard = (command) => {
  const card = document.createElement("div");
  card.className = "item-card command-card";
  card.dataset.searchText = `${command.label} ${command.syntax} ${command.id}`.toLowerCase();

  const title = document.createElement("strong");
  title.textContent = command.label;
  const syntax = document.createElement("span");
  syntax.className = "meta";
  syntax.textContent = command.syntax;
  title.appendChild(document.createElement("br"));
  title.appendChild(syntax);
  card.appendChild(title);

  const getters = command.args.map((arg) => {
    const { field, getValue } = buildArgField(command, arg);
    card.appendChild(field);
    return { key: arg.key, getValue, optional: Boolean(arg.optional) };
  });

  const actions = document.createElement("div");
  actions.className = "btn-row";
  const sendButton = document.createElement("button");
  sendButton.className = `btn btn-sm ${command.danger ? "btn-danger" : "btn-primary"}`;
  sendButton.textContent = "전송";
  sendButton.addEventListener("click", () => {
    const bridgeUrl = bridgeInput.value.trim();
    if (!bridgeUrl) {
      appendCommandResultLine("[오류] 먼저 서버에 연결해 주세요.");
      return;
    }
    const values = {};
    for (const getter of getters) {
      const value = getter.getValue();
      if (!value && !getter.optional) {
        appendCommandResultLine(`[오류] "${command.label}" 값이 비어 있습니다.`);
        return;
      }
      values[getter.key] = value;
    }
    if (command.confirmMessage && !window.confirm(command.confirmMessage)) {
      return;
    }
    const builtCommand = command.build(values);
    appendCommandResultLine(`> ${builtCommand}`);
    sendConsoleCommand(bridgeUrl, builtCommand);
    flashSent(commandResultLog);
  });
  actions.appendChild(sendButton);
  card.appendChild(actions);

  return card;
};

// 플레이어/서버를 한 페이지에 같이 늘어놓으면 카드가 너무 많아 스크롤이 길어지므로,
// 서브탭으로 나눠 한 번에 한 카테고리만 보여준다.
let activeCommandCategory = COMMAND_CATEGORIES[0].id;

const renderCommandCatalog = () => {
  const subTabsNav = document.getElementById("commandSubTabs");
  COMMAND_CATEGORIES.forEach((category) => {
    const group = document.getElementById(`commandGroup-${category.id}`);
    COMMANDS.filter((command) => command.category === category.id).forEach((command) => {
      group.appendChild(buildCommandCard(command));
    });

    const subTabButton = document.createElement("button");
    subTabButton.type = "button";
    subTabButton.className = `subtab-btn${category.id === activeCommandCategory ? " active" : ""}`;
    subTabButton.textContent = category.label;
    subTabButton.addEventListener("click", () => {
      activeCommandCategory = category.id;
      applyCommandFilters();
    });
    subTabsNav.appendChild(subTabButton);
  });
  applyCommandFilters();
};

// 서브탭 전환과 검색 필터가 같은 표시 로직을 공유한다 — 활성 카테고리만 보이고, 그 안에서
// 검색어에 맞는 카드만 남는다.
const applyCommandFilters = () => {
  const query = commandSearchInput.value.trim().toLowerCase();
  document.querySelectorAll("#commandSubTabs .subtab-btn").forEach((btn, index) => {
    btn.classList.toggle("active", COMMAND_CATEGORIES[index].id === activeCommandCategory);
  });
  COMMAND_CATEGORIES.forEach((category) => {
    const isActiveCategory = category.id === activeCommandCategory;
    const group = document.getElementById(`commandGroup-${category.id}`);
    group.querySelectorAll(".command-card").forEach((card) => {
      const matches = !query || card.dataset.searchText.includes(query);
      card.style.display = matches ? "" : "none";
    });
    document.getElementById(`commandCategory-${category.id}`).style.display = isActiveCategory ? "" : "none";
  });
};

// 300ms 스냅샷마다 매번 <select>를 통째로 새로 만들면 열려 있던 드롭다운이 깜빡이니,
// 옵션 목록이 실제로 바뀌었을 때만 갱신한다.
let lastPlayerOptionsKey = "";
const updateCommandPlayerOptions = (players) => {
  const names = players.map((p) => p.name).sort();
  const key = names.join(",");
  if (key === lastPlayerOptionsKey) return;
  lastPlayerOptionsKey = key;

  onlinePlayersDatalist.innerHTML = names.map((name) => `<option value="${name}"></option>`).join("");

  playerSelectElements.forEach((select) => {
    const previous = select.value;
    const placeholder =
      names.length === 0 ? "(접속한 플레이어 없음)" : "-- 플레이어 선택 --";
    select.innerHTML =
      `<option value="">${placeholder}</option>` +
      names.map((name) => `<option value="${name}">${name}</option>`).join("");
    if (names.includes(previous)) {
      select.value = previous;
    }
  });
};

// 월드 목록은 접속한 서버가 바뀔 때만 달라지므로(플레이어 접속/퇴장처럼 자주 갱신될 일이
// 없음), 지난번과 같으면 다시 채우지 않는다 — innerHTML을 새로 채우면 관리자가 골라둔
// 선택값이 날아가므로, 정말 서버가 바뀌었을 때만 갱신한다.
let lastWorldOptionsKey = "";
const updateCommandWorldOptions = (worlds) => {
  const key = worlds.map((w) => w.id).join(",");
  if (key === lastWorldOptionsKey) return;
  lastWorldOptionsKey = key;
  const optionsHtml = worlds
    .map((w) => `<option value="${w.dimensionKey}">${WORLD_LABELS[w.environment] ?? w.id}</option>`)
    .join("");
  worldSelectElements.forEach((select) => {
    const previous = select.value;
    select.innerHTML = optionsHtml;
    if (previous && Array.from(select.options).some((opt) => opt.value === previous)) {
      select.value = previous;
    }
  });
};

commandSearchInput.addEventListener("input", applyCommandFilters);

renderCommandCatalog();

// ---- 이벤트 바인딩 ----

testButton.addEventListener("click", testConnection);
showPlayersToggle.addEventListener("change", () => mapInstance.setEntityVisibility("players", showPlayersToggle.checked));
showMobsToggle.addEventListener("change", () => mapInstance.setEntityVisibility("mobs", showMobsToggle.checked));
showItemsToggle.addEventListener("change", () => mapInstance.setEntityVisibility("items", showItemsToggle.checked));

renderRecents();
await restoreSession();
