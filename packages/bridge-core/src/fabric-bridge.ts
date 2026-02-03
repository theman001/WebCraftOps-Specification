import type {
  PlayerIdentity,
  RegistryAdapter,
  WorldAccessAdapter,
  PermissionAdapter,
} from "./adapters";

export type ChunkSectionPayload = {
  palette: string[];
  indices: number[];
};

export type ChunkPayload = {
  cx: number;
  cz: number;
  sections: ChunkSectionPayload[];
};

export type FabricRegistrySource = {
  getRegistryDump: RegistryAdapter["getRegistryDump"];
};

export type FabricWorldSource = {
  listWorlds: WorldAccessAdapter["listWorlds"];
};

export type FabricPermissionSource = {
  hasPermission: PermissionAdapter["hasPermission"];
  isOperator: PermissionAdapter["isOperator"];
};

export type FabricChunkSource = {
  loadChunkPayload(cx: number, cz: number): Promise<ChunkPayload>;
};

export type FabricEditJobExecutor = {
  applyCommand(command: { type: string; params: Record<string, unknown> }): Promise<void>;
};

export type FabricBridgeOptions = {
  registry: FabricRegistrySource;
  worlds: FabricWorldSource;
  permissions: FabricPermissionSource;
  chunks: FabricChunkSource;
  editJobs: FabricEditJobExecutor;
};

// Fabric 서버 환경에서 BridgeCore 로직을 수행하는 기본 구현
export class FabricBridgeCore implements RegistryAdapter, WorldAccessAdapter, PermissionAdapter {
  constructor(private readonly options: FabricBridgeOptions) {}

  async getRegistryDump() {
    return this.options.registry.getRegistryDump();
  }

  async listWorlds() {
    return this.options.worlds.listWorlds();
  }

  async hasPermission(player: PlayerIdentity, node: string) {
    return this.options.permissions.hasPermission(player, node);
  }

  async isOperator(player: PlayerIdentity) {
    return this.options.permissions.isOperator(player);
  }

  async streamChunk(cx: number, cz: number) {
    const payload = await this.options.chunks.loadChunkPayload(cx, cz);
    return encodeChunkPayload(payload);
  }

  async applyEditJob(commands: Array<{ type: string; params: Record<string, unknown> }>) {
    for (const command of commands) {
      await this.options.editJobs.applyCommand(command);
    }
  }
}

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

  return new Uint8Array(bytes);
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

const writeVarInt = (bytes: number[], value: number) => {
  let v = value >>> 0;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
};
