import http from "node:http";
import { URL } from "node:url";
import { randomUUID } from "node:crypto";

type BridgeInfo = {
  name: string;
  version: string;
  loader: "fabric" | "forge" | "neoforge" | "unknown";
  mcVersion: string;
  bootId: string;
};

// 프로세스가 뜰 때마다 새로 생성 — 프런트가 이 값의 변화로 브릿지(마크 서버) 재시작을 감지한다.
const BRIDGE_BOOT_ID = randomUUID();

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

type ChunkSectionPayload = {
  palette: string[];
  indices: number[];
};

type ChunkPayload = {
  cx: number;
  cz: number;
  sections: ChunkSectionPayload[];
};

type EditJobRequest = {
  createdBy?: string;
  commands?: Array<{ type: string; params: Record<string, unknown> }>;
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
  bootId: BRIDGE_BOOT_ID,
};

const sampleChunk: ChunkPayload = {
  cx: 0,
  cz: 0,
  sections: [
    {
      palette: ["minecraft:stone", "minecraft:oak_log", "minecraft:glass_pane", "create:shaft"],
      indices: [
        0, 0, 1, 1, 2, 2, 3, 3,
        0, 1, 2, 3, 0, 1, 2, 3,
      ],
    },
  ],
};

// Bridge 유선 포맷: varint(cx,cz,sectionCount) + 섹션별 팔레트 + RLE 인덱스.
// bridge-core/fabric-bridge.ts의 encodeChunkPayload와 동일한 포맷을 사용해야
// 프런트엔드 chunk-worker.js가 디코드할 수 있다.
const writeVarInt = (bytes: number[], value: number) => {
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
};

const encodeRle = (values: number[]) => {
  if (values.length === 0) {
    return [];
  }
  const result: Array<{ value: number; count: number }> = [];
  let current = values[0];
  let count = 1;
  for (let i = 1; i < values.length; i += 1) {
    const value = values[i];
    if (value === current) {
      count += 1;
    } else {
      result.push({ value: current, count });
      current = value;
      count = 1;
    }
  }
  result.push({ value: current, count });
  return result;
};

const encodeChunkPayload = (payload: ChunkPayload) => {
  const encoder = new TextEncoder();
  const bytes: number[] = [];

  writeVarInt(bytes, payload.cx);
  writeVarInt(bytes, payload.cz);
  writeVarInt(bytes, payload.sections.length);

  payload.sections.forEach((section) => {
    writeVarInt(bytes, section.palette.length);
    section.palette.forEach((id) => {
      const encoded = encoder.encode(id);
      writeVarInt(bytes, encoded.length);
      bytes.push(...encoded);
    });

    const rle = encodeRle(section.indices);
    writeVarInt(bytes, rle.length);
    rle.forEach((entry) => {
      writeVarInt(bytes, entry.count);
      writeVarInt(bytes, entry.value);
    });
  });

  return new Uint8Array(bytes).buffer;
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

  if (req.method === "POST" && pathname === "/bridge/world/overworld/edit/jobs") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
      const payload = body as EditJobRequest;
      const jobId = `mock-${Date.now()}`;
      sendJson(res, 201, {
        jobId,
        worldId: "overworld",
        createdBy: payload.createdBy ?? "unknown",
        status: "completed",
        commands: payload.commands ?? [],
      });
    });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/bridge/edit/jobs/") && pathname.endsWith("/revert")) {
    const jobId = pathname.replace("/bridge/edit/jobs/", "").replace("/revert", "");
    sendJson(res, 200, { jobId, status: "reverted" });
    return;
  }

  if (req.method === "POST" && pathname === "/bridge/command") {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf-8")) : {};
      sendJson(res, 200, { ok: true, type: body.type, mode: body.mode ?? "apply" });
    });
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
