import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { Readable } from "node:stream";
import {
  cancelEditJob,
  createEditJob,
  getEditJob,
  listEditJobs,
  pauseEditJob,
  resumeEditJob,
  runEditJob,
  updateEditJobMetrics,
} from "./edit-jobs";
import { listAuditEntries } from "./audit-log";
import { bridgeHeaders } from "./bridge-auth";

// 프로세스가 뜰 때마다 새로 생성 — 프런트가 이 값의 변화로 백엔드 재시작을 감지해
// 세션을 끊는다(요구사항: 새로고침만으론 안 끊기고, 서버 재기동 시에는 끊김).
const BACKEND_BOOT_ID = randomUUID();

type ServerProfile = {
  id: string;
  name: string;
  bridgeUrl: string;
  pinned: boolean;
  lastConnectedAt?: string;
};

type BridgeTestResult = {
  ok: boolean;
  status: number;
  info?: unknown;
  error?: string;
};

type BridgeProxyResult = {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
};

type BlueprintMetadata = {
  id: string;
  name: string;
  format: "schem" | "unknown";
  size: [number, number, number];
  blocks: number;
  tags: string[];
  createdBy: string;
  createdAt: string;
};

const serverProfiles: ServerProfile[] = [];
const blueprints: BlueprintMetadata[] = [];
const metricsTickers = new Map<string, NodeJS.Timeout>();

const readJsonBody = async <T>(req: http.IncomingMessage): Promise<T | null> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(raw) as T;
};

const sendJson = (res: http.ServerResponse, status: number, payload: unknown) => {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

// 프런트엔드를 별도 서버로 안 띄우고 백엔드가 같은 오리진에서 정적 파일까지 서빙한다.
// 사용자는 Backend 주소를 몰라도 되고(항상 같은 오리진), Bridge(마크 서버) 주소만 입력하면 된다.
const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src");

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const serveStaticFile = (res: http.ServerResponse, pathname: string): boolean => {
  const relativePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(FRONTEND_DIR, relativePath);
  // 경로 탈출(path traversal) 방지: 반드시 FRONTEND_DIR 하위 파일이어야 한다.
  if (filePath !== FRONTEND_DIR && !filePath.startsWith(FRONTEND_DIR + path.sep)) {
    return false;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const contentType = STATIC_MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";

  // Cloudflare 등 프런트단 CDN이 .js를 엣지에서 캐싱해버리면 origin의
  // Cache-Control이 이미 캐싱된 옛 응답에는 소급 적용되지 않는다. index.html이
  // 참조하는 스크립트 URL 자체를 매 요청마다 다르게 만들어 캐시를 무력화한다.
  if (path.extname(filePath) === ".html") {
    const cacheBust = Date.now();
    const html = fs
      .readFileSync(filePath, "utf-8")
      .replace(/src="\.\/app\.js"/, `src="./app.js?v=${cacheBust}"`);
    const htmlBody = Buffer.from(html, "utf-8");
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": htmlBody.length,
      "Cache-Control": "no-store",
    });
    res.end(htmlBody);
    return true;
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
  return true;
};

const sendNotFound = (res: http.ServerResponse) => {
  sendJson(res, 404, { message: "지원하지 않는 경로입니다." });
};

const testBridgeConnection = async (bridgeUrl: string): Promise<BridgeTestResult> => {
  try {
    const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const response = await fetch(`${normalizedUrl}/bridge/info`, { headers: bridgeHeaders() });
    const info = await response.json().catch(() => undefined);

    return {
      ok: response.ok,
      status: response.status,
      info,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return {
      ok: false,
      status: 0,
      error: message,
    };
  }
};

const proxyBridgeRequest = async (bridgeUrl: string, path: string): Promise<BridgeProxyResult> => {
  try {
    const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const response = await fetch(`${normalizedUrl}${path}`, { headers: bridgeHeaders() });
    const payload = await response.json().catch(() => undefined);

    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    return {
      ok: false,
      status: 0,
      error: message,
    };
  }
};

const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
  // 프런트엔드가 백엔드와 다른 오리진(포트)에서 서빙되므로 CORS 허용이 없으면
  // 브라우저에서 아무 요청도 성공하지 못한다.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!req.url || !req.method) {
    sendNotFound(res);
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok", bootId: BACKEND_BOOT_ID });
    return;
  }

  if (req.method === "GET" && pathname === "/servers") {
    sendJson(res, 200, serverProfiles);
    return;
  }

  if (req.method === "POST" && pathname === "/servers") {
    const body = await readJsonBody<{ name?: string; bridgeUrl?: string; pinned?: boolean }>(req);
    if (!body?.bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl이 필요합니다." });
      return;
    }
    const profile: ServerProfile = {
      id: randomUUID(),
      name: body.name ?? "새 서버",
      bridgeUrl: body.bridgeUrl,
      pinned: body.pinned ?? false,
      lastConnectedAt: new Date().toISOString(),
    };
    serverProfiles.push(profile);
    sendJson(res, 201, profile);
    return;
  }

  if (req.method === "DELETE" && pathname.startsWith("/servers/")) {
    const id = pathname.replace("/servers/", "");
    const index = serverProfiles.findIndex((profile) => profile.id === id);
    if (index === -1) {
      sendJson(res, 404, { message: "서버를 찾을 수 없습니다." });
      return;
    }
    const [removed] = serverProfiles.splice(index, 1);
    sendJson(res, 200, removed);
    return;
  }

  if (req.method === "POST" && pathname === "/bridge/test") {
    const body = await readJsonBody<{ bridgeUrl?: string }>(req);
    if (!body?.bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl이 필요합니다." });
      return;
    }
    const result = await testBridgeConnection(body.bridgeUrl);
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (req.method === "GET" && pathname === "/blueprints") {
    sendJson(res, 200, blueprints);
    return;
  }

  if (req.method === "POST" && pathname === "/blueprints") {
    const body = await readJsonBody<Partial<BlueprintMetadata>>(req);
    if (!body?.name) {
      sendJson(res, 400, { message: "블루프린트 이름이 필요합니다." });
      return;
    }
    const blueprint: BlueprintMetadata = {
      id: randomUUID(),
      name: body.name,
      format: body.format ?? "schem",
      size: body.size ?? [0, 0, 0],
      blocks: body.blocks ?? 0,
      tags: body.tags ?? [],
      createdBy: body.createdBy ?? "unknown",
      createdAt: new Date().toISOString(),
    };
    blueprints.push(blueprint);
    sendJson(res, 201, blueprint);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/blueprints/")) {
    const id = pathname.replace("/blueprints/", "");
    const blueprint = blueprints.find((item) => item.id === id);
    if (!blueprint) {
      sendJson(res, 404, { message: "블루프린트를 찾을 수 없습니다." });
      return;
    }
    sendJson(res, 200, blueprint);
    return;
  }

  if (req.method === "POST" && pathname === "/bridge/world/overworld/edit/jobs") {
    const body = await readJsonBody<{ createdBy?: string; commands?: unknown[] }>(req);
    if (!body?.commands || !Array.isArray(body.commands)) {
      sendJson(res, 400, { message: "commands 배열이 필요합니다." });
      return;
    }
    const bridgeUrl = url.searchParams.get("bridgeUrl") ?? undefined;
    const job = createEditJob("overworld", body.createdBy ?? "unknown", body.commands as any, bridgeUrl);
    try {
      await runEditJob(job);
    } catch {
      sendJson(res, 500, { message: "작업 실행 중 오류가 발생했습니다.", job });
      return;
    }
    sendJson(res, 201, job);
    return;
  }

  if (req.method === "GET" && pathname === "/bridge/edit/jobs") {
    sendJson(res, 200, listEditJobs());
    return;
  }

  if (req.method === "GET" && pathname === "/audit") {
    const userId = url.searchParams.get("userId") ?? undefined;
    const worldId = url.searchParams.get("worldId") ?? undefined;
    const commandType = url.searchParams.get("commandType") ?? undefined;
    const since = url.searchParams.get("since") ?? undefined;
    const until = url.searchParams.get("until") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    if (since && Number.isNaN(Date.parse(since))) {
      sendJson(res, 400, { message: "since 파라미터가 올바르지 않습니다." });
      return;
    }
    if (until && Number.isNaN(Date.parse(until))) {
      sendJson(res, 400, { message: "until 파라미터가 올바르지 않습니다." });
      return;
    }
    if (since && until && Date.parse(since) > Date.parse(until)) {
      sendJson(res, 400, { message: "since가 until보다 클 수 없습니다." });
      return;
    }
    const entries = await listAuditEntries({
      userId,
      worldId,
      commandType,
      since,
      until,
      limit,
      cursor,
    });
    sendJson(res, 200, entries);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/bridge/edit/jobs/")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/metrics")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/metrics", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    const body = await readJsonBody<{ mspt?: number; tps?: number }>(req);
    updateEditJobMetrics(job, { mspt: body?.mspt, tps: body?.tps });
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/metrics/auto")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/metrics/auto", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    const body = await readJsonBody<{ intervalMs?: number; mspt?: number; tps?: number }>(req);
    const intervalMs = Math.max(500, body?.intervalMs ?? 1000);
    if (metricsTickers.has(jobId)) {
      clearInterval(metricsTickers.get(jobId));
    }
    const timer = setInterval(() => {
      updateEditJobMetrics(job, { mspt: body?.mspt, tps: body?.tps });
    }, intervalMs);
    metricsTickers.set(jobId, timer);
    sendJson(res, 200, { jobId, intervalMs });
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/metrics/auto/stop")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/metrics/auto/stop", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    if (metricsTickers.has(jobId)) {
      clearInterval(metricsTickers.get(jobId));
      metricsTickers.delete(jobId);
    }
    sendJson(res, 200, { jobId, status: "stopped" });
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/pause")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/pause", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    pauseEditJob(job);
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/resume")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/resume", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    resumeEditJob(job);
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "POST" && pathname.endsWith("/revert")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/revert", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    try {
      await runEditJob(job, { mode: "revert" });
      sendJson(res, 200, job);
      return;
    } catch {
      sendJson(res, 500, { message: "되돌리기 실행 중 오류가 발생했습니다.", job });
      return;
    }
  }

  if (req.method === "POST" && pathname.endsWith("/cancel")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/cancel", "");
    const job = getEditJob(jobId);
    if (!job) {
      sendJson(res, 404, { message: "작업을 찾을 수 없습니다." });
      return;
    }
    cancelEditJob(job);
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "GET" && pathname === "/bridge/info") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const result = await proxyBridgeRequest(bridgeUrl, "/bridge/info");
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (req.method === "GET" && pathname === "/bridge/registry/blocks") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const result = await proxyBridgeRequest(bridgeUrl, "/bridge/registry/blocks");
    sendJson(res, result.ok ? 200 : 502, result);
    return;
  }

  if (req.method === "GET" && pathname === "/bridge/world/overworld/chunks") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    try {
      const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
      // cx/cz를 그대로 브릿지로 전달 — 없으면 bridge-paper가 기본값 0,0으로 처리한다.
      const cx = url.searchParams.get("cx");
      const cz = url.searchParams.get("cz");
      const chunkQuery = new URLSearchParams();
      if (cx !== null) chunkQuery.set("cx", cx);
      if (cz !== null) chunkQuery.set("cz", cz);
      const queryString = chunkQuery.toString();
      const response = await fetch(
        `${normalizedUrl}/bridge/world/overworld/chunks${queryString ? `?${queryString}` : ""}`,
        { headers: bridgeHeaders() },
      );
      const buffer = await response.arrayBuffer();
      res.writeHead(response.ok ? 200 : 502, {
        "Content-Type": "application/octet-stream",
        "Content-Length": buffer.byteLength,
      });
      res.end(Buffer.from(buffer));
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      sendJson(res, 502, { ok: false, status: 0, error: message });
    }
    return;
  }

  // 브라우저 EventSource는 커스텀 헤더(X-Bridge-Token)를 못 보낸다 — 프런트는 항상
  // 같은 오리진인 이 프록시로만 연결하고, 여기서 브릿지로 넘어갈 때만 토큰을 싣는다.
  if (req.method === "GET" && pathname === "/bridge/console/stream") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const controller = new AbortController();
    try {
      const upstream = await fetch(`${normalizedUrl}/bridge/console/stream`, {
        headers: bridgeHeaders(),
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        sendJson(res, 502, { message: "브릿지 콘솔 스트림 연결에 실패했습니다." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      const upstreamStream = Readable.fromWeb(upstream.body as any);
      // req의 "close"만 믿으면 클라이언트가 갑자기 끊겼을 때(브라우저 탭 종료, 네트워크
      // 단절 등) 안 잡히는 경우가 있어 브릿지로 가는 커넥션이 계속 열린 채로 새는 걸
      // 실측으로 확인했다 — res 쪽도 같이 감시해서 어느 쪽이 먼저 닫히든 정리한다.
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        controller.abort();
        upstreamStream.destroy();
      };
      req.on("close", cleanup);
      res.on("close", cleanup);
      upstreamStream.on("error", () => {
        if (!res.writableEnded) res.end();
      });
      upstreamStream.pipe(res);
    } catch (error) {
      if (!res.headersSent) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        sendJson(res, 502, { ok: false, error: message });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
    return;
  }

  if (req.method === "POST" && pathname === "/bridge/console/command") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const body = await readJsonBody<{ command?: string }>(req);
    if (!body?.command) {
      sendJson(res, 400, { message: "command가 필요합니다." });
      return;
    }
    const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    try {
      const response = await fetch(`${normalizedUrl}/bridge/console/command`, {
        method: "POST",
        headers: bridgeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ command: body.command }),
      });
      const payload = await response.json().catch(() => undefined);
      sendJson(res, response.ok ? 200 : 502, payload ?? { ok: response.ok });
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      sendJson(res, 502, { ok: false, error: message });
    }
    return;
  }

  if (req.method === "GET" && serveStaticFile(res, pathname)) {
    return;
  }

  sendNotFound(res);
};

export const createBackendServer = () => {
  return http.createServer((req, res) => {
    void handleRequest(req, res);
  });
};

export const startBackendServer = (port = 4000) => {
  const server = createBackendServer();
  server.listen(port, () => {
    console.log(`WebCraftOps 백엔드가 ${port} 포트에서 실행 중입니다.`);
  });
  return server;
};
