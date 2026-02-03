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
const toolBrushButton = document.getElementById("toolBrush");
const toolSelectButton = document.getElementById("toolSelect");
const toolFillButton = document.getElementById("toolFill");
const viewerClearButton = document.getElementById("viewerClear");
const viewerStatus = document.getElementById("viewerStatus");
const viewerCanvas = document.getElementById("viewerCanvas");
const createdByInput = document.getElementById("createdBy");
const commandTypeInput = document.getElementById("commandType");
const commandParamsInput = document.getElementById("commandParams");
const createJobButton = document.getElementById("createJobButton");
const editJobStatus = document.getElementById("editJobStatus");
const refreshJobsButton = document.getElementById("refreshJobsButton");
const editJobList = document.getElementById("editJobList");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const historyStatus = document.getElementById("historyStatus");
const historyList = document.getElementById("historyList");
const blueprintFileInput = document.getElementById("blueprintFile");
const blueprintNameInput = document.getElementById("blueprintName");
const blueprintTagsInput = document.getElementById("blueprintTags");
const uploadBlueprintButton = document.getElementById("uploadBlueprintButton");
const refreshBlueprintsButton = document.getElementById("refreshBlueprintsButton");
const blueprintStatus = document.getElementById("blueprintStatus");
const blueprintList = document.getElementById("blueprintList");
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

const RECENT_KEY = "webcraftops.recentServers";
const HISTORY_MAX = 10;

const historyStack = [];
const redoStack = [];
let toolMode = "brush";
let rendererState = null;
let auditCursor = null;

const ensureRenderer = async () => {
  if (rendererState) {
    return rendererState;
  }
  const THREE = await import("./vendor/three.module.js");
  const renderer = new THREE.WebGLRenderer({ canvas: viewerCanvas, antialias: true });
  renderer.setSize(viewerCanvas.clientWidth, viewerCanvas.clientHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1220");

  const camera = new THREE.PerspectiveCamera(
    45,
    viewerCanvas.clientWidth / viewerCanvas.clientHeight,
    0.1,
    100,
  );
  camera.position.set(6, 6, 8);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(5, 10, 7);
  scene.add(ambient);
  scene.add(light);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const selectable = [];

  const render = () => {
    renderer.render(scene, camera);
  };
  render();

  const handleResize = () => {
    const width = viewerCanvas.clientWidth;
    const height = viewerCanvas.clientHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  };
  window.addEventListener("resize", handleResize);

  viewerCanvas.addEventListener("click", async (event) => {
    const rect = viewerCanvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(selectable);
    if (intersects.length === 0) {
      return;
    }
    const hit = intersects[0].object;
    if (toolMode === "select") {
      hit.material.emissive = new THREE.Color("#facc15");
    } else if (toolMode === "brush") {
      hit.material.color = new THREE.Color("#38bdf8");
    } else if (toolMode === "fill") {
      selectable.forEach((mesh) => {
        mesh.material.color = new THREE.Color("#34d399");
      });
    }
    render();

    const backendUrl = getBackendUrl();
    if (backendUrl) {
      const blockId = hit.userData?.blockId ?? "unknown";
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      const { payload } = await createEditJobRequest(backendUrl, "ui", [
        {
          type: "setBlock",
          params: { pos: hit.position.toArray(), tool: toolMode, blockId },
        },
      ], bridgeUrl);
      if (payload?.jobId) {
        recordAction(payload.jobId, "create", `3D 편집 작업 생성 (${toolMode})`);
      }
    }
  });

  rendererState = {
    THREE,
    renderer,
    scene,
    camera,
    selectable,
    render,
  };
  return rendererState;
};

const renderVoxelPreview = async (palette, counts, mesh) => {
  const { THREE, scene, selectable, render } = await ensureRenderer();
  selectable.splice(0, selectable.length);
  while (scene.children.length > 2) {
    scene.remove(scene.children[2]);
  }

  if (mesh?.positions) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

    const material = new THREE.MeshStandardMaterial({ vertexColors: true });
    const chunkMesh = new THREE.Mesh(geometry, material);
    chunkMesh.position.set(-2, 0, -2);
    scene.add(chunkMesh);
  }

  if (Array.isArray(mesh?.voxels)) {
    mesh.voxels.forEach((voxel) => {
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      proxy.position.set(voxel.position[0], voxel.position[1], voxel.position[2]);
      proxy.userData = { blockId: voxel.blockId };
      selectable.push(proxy);
    });
  } else {
    const max = Math.min(48, counts.length);
    for (let i = 0; i < max; i += 1) {
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
      proxy.position.set((i % 8) - 3.5, 0, Math.floor(i / 8) - 2.5);
      proxy.userData = { blockId: palette[i] };
      selectable.push(proxy);
    }
  }

  viewerStatus.textContent = `렌더링 완료: 청크 메쉬 생성됨 (LOD ${mesh?.lodStep ?? 1})`;
  render();
};

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

const fetchEditJobs = async (backendUrl) => {
  const response = await fetch(`${backendUrl}/bridge/edit/jobs`);
  const payload = await response.json();
  return { response, payload };
};

const createEditJobRequest = async (backendUrl, createdBy, commands, bridgeUrl) => {
  const query = bridgeUrl ? `?bridgeUrl=${encodeURIComponent(bridgeUrl)}` : "";
  const response = await fetch(`${backendUrl}/bridge/world/overworld/edit/jobs${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ createdBy, commands }),
  });
  const payload = await response.json();
  return { response, payload };
};

const updateEditJobStatus = async (backendUrl, jobId, action, bridgeUrl) => {
  const query = bridgeUrl ? `?bridgeUrl=${encodeURIComponent(bridgeUrl)}` : "";
  const response = await fetch(`${backendUrl}/bridge/edit/jobs/${jobId}/${action}${query}`, {
    method: "POST",
  });
  const payload = await response.json();
  return { response, payload };
};

const fetchBlueprints = async (backendUrl) => {
  const response = await fetch(`${backendUrl}/blueprints`);
  const payload = await response.json();
  return { response, payload };
};

const createBlueprint = async (backendUrl, blueprint) => {
  const response = await fetch(`${backendUrl}/blueprints`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(blueprint),
  });
  const payload = await response.json();
  return { response, payload };
};

const downloadBlueprint = (blueprint) => {
  const blob = new Blob([JSON.stringify(blueprint, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${blueprint.id ?? "blueprint"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const createPasteJob = async (backendUrl, blueprintId) => {
  const bridgeUrl = bridgeInput.value.trim() || undefined;
  const { response, payload } = await createEditJobRequest(
    backendUrl,
    "ui",
    [{ type: "pasteBlueprint", params: { blueprintId } }],
    bridgeUrl,
  );
  return { response, payload };
};

const fetchAuditEntries = async (backendUrl, filters) => {
  const params = new URLSearchParams();
  if (filters.userId) {
    params.set("userId", filters.userId);
  }
  if (filters.worldId) {
    params.set("worldId", filters.worldId);
  }
  if (filters.commandType) {
    params.set("commandType", filters.commandType);
  }
  if (filters.since) {
    params.set("since", filters.since);
  }
  if (filters.until) {
    params.set("until", filters.until);
  }
  if (typeof filters.limit === "number" && !Number.isNaN(filters.limit)) {
    params.set("limit", String(filters.limit));
  }
  if (filters.cursor) {
    params.set("cursor", filters.cursor);
  }
  const query = params.toString();
  const response = await fetch(`${backendUrl}/audit${query ? `?${query}` : ""}`);
  const payload = await response.json();
  return { response, payload };
};

const getInverseAction = (action) => {
  switch (action) {
    case "pause":
      return "resume";
    case "resume":
      return "pause";
    case "cancel":
      return null;
    case "create":
      return "cancel";
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
    const inverseLabel = entry.inverseAction ? ` (Undo: ${entry.inverseAction})` : " (Undo 없음)";
    item.textContent = `[${entry.timestamp}] ${entry.label}${inverseLabel}`;
    historyList.appendChild(item);
  });
  undoButton.disabled = historyStack.length === 0 || !historyStack[0].inverseAction;
  redoButton.disabled = redoStack.length === 0 || !redoStack[0].redoAction;
};

const recordAction = (jobId, action, label) => {
  const inverseAction = getInverseAction(action);
  const redoAction = getRedoAction(action);
  pushHistory({
    jobId,
    action,
    inverseAction,
    redoAction,
    label,
    timestamp: new Date().toLocaleTimeString(),
  });
};

const runUndo = async () => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    historyStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
  const bridgeUrl = bridgeInput.value.trim() || undefined;
  const entry = historyStack.shift();
  if (!entry) {
    renderHistory();
    return;
  }
  if (!entry.inverseAction) {
    historyStatus.textContent = "되돌릴 수 없는 작업입니다.";
    renderHistory();
    return;
  }
  historyStatus.textContent = "Undo 실행 중...";
  try {
    if (entry.action === "create") {
      await updateEditJobStatus(backendUrl, entry.jobId, "revert", bridgeUrl);
    } else {
      await updateEditJobStatus(backendUrl, entry.jobId, entry.inverseAction, bridgeUrl);
    }
    redoStack.unshift(entry);
    historyStatus.textContent = "Undo 완료";
    renderHistory();
    await loadEditJobs();
  } catch (error) {
    historyStatus.textContent = "Undo 실패";
  }
};

const runRedo = async () => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    historyStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
  const bridgeUrl = bridgeInput.value.trim() || undefined;
  const entry = redoStack.shift();
  if (!entry) {
    renderHistory();
    return;
  }
  if (!entry.redoAction) {
    historyStatus.textContent = "Redo를 지원하지 않는 작업입니다.";
    renderHistory();
    return;
  }
  historyStatus.textContent = "Redo 실행 중...";
  try {
    await updateEditJobStatus(backendUrl, entry.jobId, entry.redoAction, bridgeUrl);
    historyStack.unshift(entry);
    historyStatus.textContent = "Redo 완료";
    renderHistory();
    await loadEditJobs();
  } catch (error) {
    historyStatus.textContent = "Redo 실패";
  }
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

const renderEditJobs = (jobs, backendUrl) => {
  editJobList.innerHTML = "";

  if (jobs.length === 0) {
    editJobList.innerHTML = "<small>생성된 작업이 없습니다.</small>";
    return;
  }

  jobs.forEach((job) => {
    const card = document.createElement("div");
    card.className = "edit-job-card";

    const title = document.createElement("strong");
    title.textContent = `Job ${job.jobId}`;

    const status = document.createElement("small");
    status.textContent = `상태: ${job.status}`;

    const meta = document.createElement("small");
    meta.textContent = `월드: ${job.worldId} · 생성자: ${job.createdBy}`;

    const stats = document.createElement("small");
    stats.textContent = `진행: ${job.stats?.doneBlocks ?? 0}/${job.stats?.estimatedBlocks ?? 0}`;

    const actions = document.createElement("div");
    actions.className = "edit-job-actions";

    const pauseButton = document.createElement("button");
    pauseButton.textContent = "일시정지";
    pauseButton.disabled = job.status !== "running";
    pauseButton.addEventListener("click", async () => {
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      await updateEditJobStatus(backendUrl, job.jobId, "pause", bridgeUrl);
      recordAction(job.jobId, "pause", `작업 일시정지: ${job.jobId}`);
      await loadEditJobs();
    });

    const resumeButton = document.createElement("button");
    resumeButton.textContent = "재개";
    resumeButton.disabled = job.status !== "paused";
    resumeButton.addEventListener("click", async () => {
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      await updateEditJobStatus(backendUrl, job.jobId, "resume", bridgeUrl);
      recordAction(job.jobId, "resume", `작업 재개: ${job.jobId}`);
      await loadEditJobs();
    });

    const cancelButton = document.createElement("button");
    cancelButton.textContent = "취소";
    cancelButton.disabled = ["completed", "canceled"].includes(job.status);
    cancelButton.addEventListener("click", async () => {
      const bridgeUrl = bridgeInput.value.trim() || undefined;
      await updateEditJobStatus(backendUrl, job.jobId, "cancel", bridgeUrl);
      recordAction(job.jobId, "cancel", `작업 취소: ${job.jobId}`);
      await loadEditJobs();
    });

    actions.appendChild(pauseButton);
    actions.appendChild(resumeButton);
    actions.appendChild(cancelButton);

    card.appendChild(title);
    card.appendChild(status);
    card.appendChild(meta);
    card.appendChild(stats);
    card.appendChild(actions);
    editJobList.appendChild(card);
  });
};

const renderBlueprints = (blueprints, backendUrl) => {
  blueprintList.innerHTML = "";

  if (blueprints.length === 0) {
    blueprintList.innerHTML = "<small>등록된 블루프린트가 없습니다.</small>";
    return;
  }

  blueprints.forEach((blueprint) => {
    const card = document.createElement("div");
    card.className = "blueprint-card";

    const title = document.createElement("strong");
    title.textContent = blueprint.name ?? blueprint.id ?? "이름 없음";

    const meta = document.createElement("small");
    meta.textContent = `포맷: ${blueprint.format ?? "schem"} · 블록: ${
      blueprint.blocks ?? "?"
    }`;

    const size = document.createElement("small");
    size.textContent = blueprint.size
      ? `크기: ${blueprint.size.join("x")}`
      : "크기: 미지정";

    const tags = document.createElement("small");
    tags.textContent = blueprint.tags?.length ? `태그: ${blueprint.tags.join(", ")}` : "태그 없음";

    const actions = document.createElement("div");
    actions.className = "blueprint-actions";

    const downloadButton = document.createElement("button");
    downloadButton.textContent = "메타데이터 다운로드";
    downloadButton.addEventListener("click", () => downloadBlueprint(blueprint));

    const pasteButton = document.createElement("button");
    pasteButton.textContent = "붙여넣기 작업 생성";
    pasteButton.addEventListener("click", async () => {
      blueprintStatus.textContent = "붙여넣기 작업 생성 중...";
      const { response, payload } = await createPasteJob(backendUrl, blueprint.id);
      if (!response.ok) {
        blueprintStatus.textContent = `붙여넣기 작업 실패 (${response.status})`;
        return;
      }
      blueprintStatus.textContent = `붙여넣기 작업 생성 완료: ${payload.jobId}`;
      recordAction(payload.jobId, "create", `붙여넣기 작업 생성: ${payload.jobId}`);
      await loadEditJobs();
    });

    actions.appendChild(downloadButton);
    actions.appendChild(pasteButton);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(size);
    card.appendChild(tags);
    card.appendChild(actions);
    blueprintList.appendChild(card);
  });
};

const renderAuditEntries = (entries, mode = "replace") => {
  if (mode === "replace") {
    auditList.innerHTML = "";
  }
  if (entries.length === 0) {
    if (mode === "replace") {
      auditList.innerHTML = "<small>감사 로그가 없습니다.</small>";
    }
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement("li");
    const summary = document.createElement("strong");
    summary.textContent = `${entry.commandType} · ${entry.worldId}`;

    const meta = document.createElement("small");
    meta.textContent = `사용자: ${entry.userId} · 블록: ${entry.estimatedBlocks} · ${entry.durationMs}ms`;

    const time = document.createElement("small");
    time.textContent = `시간: ${entry.createdAt}`;

    item.appendChild(summary);
    item.appendChild(meta);
    item.appendChild(time);
    auditList.appendChild(item);
  });
};

const loadAuditEntries = async (mode = "replace") => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    auditStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
  if (mode === "replace") {
    auditCursor = null;
  }
  loadMoreAuditButton.disabled = true;
  loadMoreAuditButton.textContent = "불러오는 중...";
  auditStatus.textContent = "감사 로그를 불러오는 중...";
  try {
    const { response, payload } = await fetchAuditEntries(backendUrl, {
      userId: auditUserIdInput.value.trim() || undefined,
      worldId: auditWorldIdInput.value.trim() || undefined,
      commandType: auditCommandTypeInput.value.trim() || undefined,
      since: auditSinceInput.value ? new Date(auditSinceInput.value).toISOString() : undefined,
      until: auditUntilInput.value ? new Date(auditUntilInput.value).toISOString() : undefined,
      limit: auditLimitInput.value ? Number(auditLimitInput.value) : undefined,
      cursor: mode === "append" ? auditCursor : undefined,
    });
    if (!response.ok) {
      auditStatus.textContent = `감사 로그 로드 실패 (${response.status})`;
      return;
    }
    const items = Array.isArray(payload) ? payload : payload.items ?? [];
    auditCursor = Array.isArray(payload) ? null : payload.nextCursor ?? null;
    auditStatus.textContent = `총 ${items.length}건 감사 로그`;
    renderAuditEntries(items, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    auditStatus.textContent = `감사 로그 로드 실패: ${message}`;
  } finally {
    loadMoreAuditButton.textContent = loadMoreAuditLabel;
    loadMoreAuditButton.disabled = !auditCursor;
  }
};

const loadBlueprints = async () => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    blueprintStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
  blueprintStatus.textContent = "블루프린트 목록을 불러오는 중...";
  try {
    const { response, payload } = await fetchBlueprints(backendUrl);
    if (!response.ok) {
      blueprintStatus.textContent = `블루프린트 목록 로드 실패 (${response.status})`;
      return;
    }
    blueprintStatus.textContent = `총 ${payload.length}개 블루프린트`;
    renderBlueprints(payload, backendUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    blueprintStatus.textContent = `블루프린트 목록 로드 실패: ${message}`;
  }
};

const uploadBlueprint = async () => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    blueprintStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
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

  blueprintStatus.textContent = "블루프린트 등록 중...";
  try {
    const blueprintPayload = {
      name,
      format: "schem",
      size: [0, 0, 0],
      blocks: 0,
      tags,
      created_by: "ui",
      created_at: new Date().toISOString(),
      filename: file.name,
      bytes: file.size,
    };
    const { response, payload } = await createBlueprint(backendUrl, blueprintPayload);
    if (!response.ok) {
      blueprintStatus.textContent = `블루프린트 등록 실패 (${response.status})`;
      return;
    }
    blueprintStatus.textContent = `블루프린트 등록 완료: ${payload.id ?? payload.name}`;
    await loadBlueprints();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    blueprintStatus.textContent = `블루프린트 등록 실패: ${message}`;
  }
};

const loadEditJobs = async () => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    editJobStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
  editJobStatus.textContent = "작업 목록을 불러오는 중...";
  try {
    const { response, payload } = await fetchEditJobs(backendUrl);
    if (!response.ok) {
      editJobStatus.textContent = `작업 목록 로드 실패 (${response.status})`;
      return;
    }
    editJobStatus.textContent = `총 ${payload.length}개 작업`;
    renderEditJobs(payload, backendUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    editJobStatus.textContent = `작업 목록 로드 실패: ${message}`;
  }
};

const createEditJob = async () => {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    editJobStatus.textContent = "Backend URL을 입력해 주세요.";
    return;
  }
  const createdBy = createdByInput.value.trim() || "unknown";
  const type = commandTypeInput.value.trim() || "setBlock";
  let params = {};
  if (commandParamsInput.value.trim()) {
    try {
      params = JSON.parse(commandParamsInput.value);
    } catch (error) {
      editJobStatus.textContent = "커맨드 파라미터 JSON을 확인해 주세요.";
      return;
    }
  }
  editJobStatus.textContent = "작업 생성 중...";
  try {
    const bridgeUrl = bridgeInput.value.trim() || undefined;
    const { response, payload } = await createEditJobRequest(
      backendUrl,
      createdBy,
      [{ type, params }],
      bridgeUrl,
    );
    if (!response.ok) {
      editJobStatus.textContent = `작업 생성 실패 (${response.status})`;
      return;
    }
    editJobStatus.textContent = `작업 생성 완료: ${payload.jobId}`;
    recordAction(payload.jobId, "create", `작업 생성: ${payload.jobId}`);
    await loadEditJobs();
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    editJobStatus.textContent = `작업 생성 실패: ${message}`;
  }
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
    const lodStep = buffer.byteLength > 4096 ? 2 : 1;
    worker.postMessage({ buffer, lodStep }, [buffer]);
    worker.addEventListener("message", (event) => {
      const { palette, counts, mesh } = event.data;
      chunkStatus.textContent = "디코드 완료";
      chunkResult.innerHTML = "";
      palette.forEach((name, index) => {
        const li = document.createElement("li");
        li.textContent = `${name}: ${counts[index]} blocks`;
        chunkResult.appendChild(li);
      });
      renderVoxelPreview(palette, counts, mesh);
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
      refreshJobsButton.onclick = loadEditJobs;
      createJobButton.onclick = createEditJob;
      refreshBlueprintsButton.onclick = loadBlueprints;
      uploadBlueprintButton.onclick = uploadBlueprint;
      await loadEditJobs();
      await loadBlueprints();
      await loadAuditEntries();
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
toolBrushButton.addEventListener("click", () => {
  toolMode = "brush";
  viewerStatus.textContent = "브러시 모드 활성화";
});
toolSelectButton.addEventListener("click", () => {
  toolMode = "select";
  viewerStatus.textContent = "선택 모드 활성화";
});
toolFillButton.addEventListener("click", () => {
  toolMode = "fill";
  viewerStatus.textContent = "채우기 모드 활성화";
});
viewerClearButton.addEventListener("click", async () => {
  if (!rendererState) {
    return;
  }
  const { scene, selectable, render } = rendererState;
  selectable.splice(0, selectable.length);
  while (scene.children.length > 2) {
    scene.remove(scene.children[2]);
  }
  viewerStatus.textContent = "렌더링 초기화 완료";
  render();
});
refreshJobsButton.addEventListener("click", loadEditJobs);
createJobButton.addEventListener("click", createEditJob);
undoButton.addEventListener("click", runUndo);
redoButton.addEventListener("click", runRedo);
refreshBlueprintsButton.addEventListener("click", loadBlueprints);
uploadBlueprintButton.addEventListener("click", uploadBlueprint);
refreshAuditButton.addEventListener("click", loadAuditEntries);
loadMoreAuditButton.addEventListener("click", () => loadAuditEntries("append"));
renderRecents();
renderHistory();
loadMoreAuditButton.disabled = true;
