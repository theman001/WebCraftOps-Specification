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

type ChunkPayload = {
  palette: string[];
  indices: number[];
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

const sampleChunk: ChunkPayload = {
  palette: ["minecraft:stone", "minecraft:oak_log", "minecraft:glass_pane", "create:shaft"],
  indices: [
    0, 0, 1, 1, 2, 2, 3, 3,
    0, 1, 2, 3, 0, 1, 2, 3,
  ],
};

const encodeChunkPayload = (payload: ChunkPayload) => {
  const encoder = new TextEncoder();
  const paletteEntries = payload.palette.map((entry) => encoder.encode(entry));
  const paletteSize = paletteEntries.reduce((sum, entry) => sum + 1 + entry.length, 0);
  const indicesLength = payload.indices.length;
  const buffer = new ArrayBuffer(1 + paletteSize + 2 + indicesLength);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint8(offset, payload.palette.length);
  offset += 1;

  paletteEntries.forEach((entry) => {
    view.setUint8(offset, entry.length);
    offset += 1;
    new Uint8Array(buffer, offset, entry.length).set(entry);
    offset += entry.length;
  });

  view.setUint16(offset, indicesLength);
  offset += 2;
  payload.indices.forEach((value, index) => {
    view.setUint8(offset + index, value);
  });

  return buffer;
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

  if (req.method === "GET" && pathname === "/bridge/world/overworld/chunks") {
    const buffer = encodeChunkPayload(sampleChunk);
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": buffer.byteLength,
    });
    res.end(Buffer.from(buffer));
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
