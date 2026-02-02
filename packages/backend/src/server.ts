import http from "node:http";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";

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

const serverProfiles: ServerProfile[] = [];

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
