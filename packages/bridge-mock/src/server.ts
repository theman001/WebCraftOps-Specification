import http from "node:http";
import { URL } from "node:url";

type BridgeInfo = {
  name: string;
  version: string;
  loader: "fabric" | "forge" | "neoforge" | "unknown";
  mcVersion: string;
};

type RegistryBlockEntry = {
  id: string;
  properties: Record<string, string[]>;
  defaultState: Record<string, string>;
  renderHint?: {
    type: "cube" | "pane" | "cross" | "slab" | "stairs" | "fluid" | "placeholder";
    label?: string;
  };
};

type RegistryDump = {
  blocks: RegistryBlockEntry[];
  generatedAt: string;
};

const registryDump: RegistryDump = {
  blocks: [
    {
      id: "minecraft:stone",
      properties: {},
      defaultState: {},
      renderHint: { type: "cube" },
    },
    {
      id: "minecraft:oak_log",
      properties: { axis: ["x", "y", "z"] },
      defaultState: { axis: "y" },
      renderHint: { type: "cube" },
    },
    {
      id: "minecraft:glass_pane",
      properties: { north: ["true", "false"] },
      defaultState: { north: "false" },
      renderHint: { type: "pane" },
    },
    {
      id: "create:shaft",
      properties: {},
      defaultState: {},
      renderHint: { type: "placeholder", label: "shaft" },
    },
  ],
  generatedAt: new Date().toISOString(),
};

const bridgeInfo: BridgeInfo = {
  name: "WebCraftOps Bridge Mock",
  version: "0.1.0",
  loader: "unknown",
  mcVersion: "1.20.x",
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

const handleRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (!req.url || !req.method) {
    sendNotFound(res);
    return;
  }

  const url = new URL(req.url, "http://localhost");
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/bridge/info") {
    sendJson(res, 200, bridgeInfo);
    return;
  }

  if (req.method === "GET" && pathname === "/bridge/registry/blocks") {
    sendJson(res, 200, registryDump);
    return;
  }

  sendNotFound(res);
};

export const createBridgeMockServer = () => {
  return http.createServer((req, res) => {
    handleRequest(req, res);
  });
};

export const startBridgeMockServer = (port = 4100) => {
  const server = createBridgeMockServer();
  server.listen(port, () => {
    console.log(`WebCraftOps Bridge Mock이 ${port} 포트에서 실행 중입니다.`);
  });
  return server;
};
