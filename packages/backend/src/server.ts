import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { Readable } from "node:stream";
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

// 프런트엔드를 별도 서버로 안 띄우고 백엔드가 같은 오리진에서 정적 파일까지 서빙한다.
// 사용자는 Backend 주소를 몰라도 되고(항상 같은 오리진), Bridge(마크 서버) 주소만 입력하면 된다.
const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src");

const STATIC_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8",
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

// SSE 프록시 3곳(콘솔 로그/지도 타일 이벤트/엔티티 스트림)이 전부 같은 모양이라 공용화한다.
// 브라우저 EventSource는 커스텀 헤더를 못 보내므로 프런트는 항상 이 프록시로만 붙고,
// 브릿지로 나가는 요청에만 토큰을 싣는다.
const proxySse = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bridgeUrl: string,
  upstreamPath: string,
) => {
  const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
  const controller = new AbortController();
  try {
    const upstream = await fetch(`${normalizedUrl}${upstreamPath}`, {
      headers: bridgeHeaders(),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      sendJson(res, 502, { message: "브릿지 SSE 스트림 연결에 실패했습니다." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    const upstreamStream = Readable.fromWeb(upstream.body as any);
    // req의 "close"만 믿으면 클라이언트가 갑자기 끊겼을 때(브라우저 탭 종료, 네트워크
    // 단절 등) 안 잡히는 경우가 있어 res 쪽도 같이 감시해서 어느 쪽이 먼저 닫히든 정리한다.
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
};

// 이미지 프록시 2곳(지도 타일/플레이어 얼굴)이 공유하는 단발성(스트리밍 아님) 바이너리 fetch.
const proxyImage = async (
  res: http.ServerResponse,
  bridgeUrl: string,
  upstreamPath: string,
  contentType: string,
) => {
  try {
    const normalizedUrl = bridgeUrl.endsWith("/") ? bridgeUrl.slice(0, -1) : bridgeUrl;
    const response = await fetch(`${normalizedUrl}${upstreamPath}`, { headers: bridgeHeaders() });
    const buffer = await response.arrayBuffer();
    res.writeHead(response.ok ? 200 : 502, {
      "Content-Type": contentType,
      "Content-Length": buffer.byteLength,
      "Cache-Control": "no-store",
    });
    res.end(Buffer.from(buffer));
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    sendJson(res, 502, { ok: false, status: 0, error: message });
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

  // 브라우저 EventSource는 커스텀 헤더(X-Bridge-Token)를 못 보낸다 — 프런트는 항상
  // 같은 오리진인 이 프록시로만 연결하고, 여기서 브릿지로 넘어갈 때만 토큰을 싣는다.
  if (req.method === "GET" && pathname === "/bridge/console/stream") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    await proxySse(req, res, bridgeUrl, "/bridge/console/stream");
    return;
  }

  // 네더/엔드 등 다른 월드도 지원하면서(각 핸들러가 /bridge/world/{worldId}/... 형태를
  // 그대로 받아들임) worldId별로 라우트를 5개씩 복붙하지 않으려고 패턴 하나로 묶는다.
  // worldId는 실제 Bukkit 월드 이름("world_nether" 등) 또는 "overworld" 별칭 그대로 통과.
  const worldRouteMatch = pathname.match(
    /^\/bridge\/world\/([^/]+)\/(map\/events|map\/tile|entities\/stream|spawn|heightmap)$/,
  );
  if (req.method === "GET" && worldRouteMatch) {
    const [, worldId, sub] = worldRouteMatch;
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const upstreamBase = `/bridge/world/${worldId}/${sub}`;
    if (sub === "map/events" || sub === "entities/stream") {
      await proxySse(req, res, bridgeUrl, upstreamBase);
      return;
    }
    if (sub === "map/tile") {
      const cx = url.searchParams.get("cx");
      const cz = url.searchParams.get("cz");
      const tileQuery = new URLSearchParams();
      if (cx !== null) tileQuery.set("cx", cx);
      if (cz !== null) tileQuery.set("cz", cz);
      const queryString = tileQuery.toString();
      await proxyImage(res, bridgeUrl, `${upstreamBase}${queryString ? `?${queryString}` : ""}`, "image/png");
      return;
    }
    if (sub === "spawn") {
      const result = await proxyBridgeRequest(bridgeUrl, upstreamBase);
      sendJson(res, result.ok ? 200 : result.status || 502, result.ok ? result.payload : result);
      return;
    }
    // sub === "heightmap"
    const x = url.searchParams.get("x");
    const z = url.searchParams.get("z");
    if (x === null || z === null) {
      sendJson(res, 400, { message: "x, z 쿼리 파라미터가 필요합니다." });
      return;
    }
    const result = await proxyBridgeRequest(bridgeUrl, `${upstreamBase}?${new URLSearchParams({ x, z })}`);
    sendJson(res, result.ok ? 200 : result.status || 502, result.ok ? result.payload : result);
    return;
  }

  if (req.method === "GET" && pathname === "/bridge/worlds") {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const result = await proxyBridgeRequest(bridgeUrl, "/bridge/worlds");
    sendJson(res, result.ok ? 200 : result.status || 502, result.ok ? result.payload : result);
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/bridge/players/") && pathname.endsWith("/head")) {
    const bridgeUrl = url.searchParams.get("bridgeUrl");
    if (!bridgeUrl) {
      sendJson(res, 400, { message: "bridgeUrl 쿼리 파라미터가 필요합니다." });
      return;
    }
    const uuid = pathname.replace("/bridge/players/", "").replace("/head", "");
    await proxyImage(res, bridgeUrl, `/bridge/players/${uuid}/head`, "image/png");
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
