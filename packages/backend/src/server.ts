import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
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

const sendNotFound = (res: http.ServerResponse) => {
  sendJson(res, 404, { message: "지원하지 않는 경로입니다." });
};

const testBridgeConnection = async (bridgeUrl: string): Promise<BridgeTestResult> => {
  try {
    const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const response = await fetch(`${normalizedUrl}/bridge/info`);
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
    const response = await fetch(`${normalizedUrl}${path}`);
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
  if (!req.url || !req.method) {
    sendNotFound(res);
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { status: "ok" });
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
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (bridgeUrl) {
      try {
        const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
        const response = await fetch(`${normalizedUrl}/bridge/world/overworld/edit/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await response.json().catch(() => undefined);
        sendJson(res, response.ok ? 201 : 502, payload ?? { message: "브릿지 응답 오류" });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        sendJson(res, 502, { message });
        return;
      }
    }
    const job = createEditJob("overworld", body.createdBy ?? "unknown", body.commands as any);
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
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (bridgeUrl) {
      try {
        const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
        const response = await fetch(`${normalizedUrl}/bridge/edit/jobs/${jobId}/revert`, {
          method: "POST",
        });
        const payload = await response.json().catch(() => undefined);
        sendJson(res, response.ok ? 200 : 502, payload ?? { message: "브릿지 응답 오류" });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        sendJson(res, 502, { message });
        return;
      }
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
      const response = await fetch(`${normalizedUrl}/bridge/world/overworld/chunks`);
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
