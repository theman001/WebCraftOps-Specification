import { createMap } from "./map.js";

const bridgeInput = document.getElementById("bridgeUrl");
const testButton = document.getElementById("testButton");
const result = document.getElementById("result");
const recentList = document.getElementById("recentList");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

const mapCanvas = document.getElementById("mapCanvas");
const mapStatus = document.getElementById("mapStatus");
const showPlayersToggle = document.getElementById("showPlayers");
const showMobsToggle = document.getElementById("showMobs");
const showItemsToggle = document.getElementById("showItems");

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
let auditCursor = null;
let consoleEventSource = null;
const mapInstance = createMap({ canvas: mapCanvas, statusEl: mapStatus });

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
showPlayersToggle.addEventListener("change", () => mapInstance.setEntityVisibility("players", showPlayersToggle.checked));
showMobsToggle.addEventListener("change", () => mapInstance.setEntityVisibility("mobs", showMobsToggle.checked));
showItemsToggle.addEventListener("change", () => mapInstance.setEntityVisibility("items", showItemsToggle.checked));
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
