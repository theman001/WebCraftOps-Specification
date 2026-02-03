// Backend API 계약 정의

export type ServerProfile = {
  id: string;
  name: string;
  bridgeUrl: string;
  pinned: boolean;
  lastConnectedAt?: string;
};

export type BlueprintMetadata = {
  id: string;
  name: string;
  format: "schem" | "unknown";
  size: [number, number, number];
  blocks: number;
  tags: string[];
  createdBy: string;
  createdAt: string;
};

export type AuditLogEntry = {
  id: string;
  userId: string;
  mcUuid: string;
  worldId: string;
  commandType: string;
  params: Record<string, unknown>;
  estimatedBlocks: number;
  durationMs: number;
  createdAt: string;
};
