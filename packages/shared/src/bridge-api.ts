// Bridge API 계약 정의

export type BridgeInfo = {
  name: string;
  version: string;
  loader: "fabric" | "forge" | "neoforge" | "unknown";
  mcVersion: string;
};

export type RegistryBlockEntry = {
  id: string;
  properties: Record<string, string[]>;
  defaultState: Record<string, string>;
  renderHint?: RenderHint;
};

export type RenderHint =
  | { type: "cube" }
  | { type: "pane" }
  | { type: "cross" }
  | { type: "slab" }
  | { type: "stairs" }
  | { type: "fluid" }
  | { type: "placeholder"; label: string };

export type RegistryDump = {
  blocks: RegistryBlockEntry[];
  generatedAt: string;
};

export type EditJobPolicy = {
  adaptiveThrottle: boolean;
  tpsPauseThreshold: number;
};

export type EditJobStats = {
  estimatedBlocks: number;
  doneBlocks: number;
  mspt: number;
  tps: number;
};

export type EditJobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "canceled";

export type EditJob = {
  jobId: string;
  worldId: string;
  createdBy: string;
  status: EditJobStatus;
  policy: EditJobPolicy;
  stats: EditJobStats;
};
