import { randomUUID } from "node:crypto";
import { recordAuditEntry } from "./audit-log";

export type CommandType = "setBlock" | "fill" | "replace" | "pasteBlueprint" | "clone";

export type CommandPayload = {
  type: CommandType;
  params: Record<string, unknown>;
};

export type CommandContext = {
  worldId: string;
  estimatedBlocks: number;
};

export type JobMetricsProvider = () => Promise<{ mspt?: number; tps?: number }>;

export interface Command {
  type: CommandType;
  apply(context: CommandContext): Promise<void>;
  revert(context: CommandContext): Promise<void>;
}

const createCommand = (payload: CommandPayload): Command => {
  switch (payload.type) {
    case "setBlock":
      return {
        type: "setBlock",
        async apply() {},
        async revert() {},
      };
    case "fill":
      return {
        type: "fill",
        async apply() {},
        async revert() {},
      };
    case "replace":
      return {
        type: "replace",
        async apply() {},
        async revert() {},
      };
    case "pasteBlueprint":
      return {
        type: "pasteBlueprint",
        async apply() {},
        async revert() {},
      };
    case "clone":
      return {
        type: "clone",
        async apply() {},
        async revert() {},
      };
    default:
      throw new Error("지원하지 않는 커맨드 타입입니다.");
  }
};

export type EditJobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "canceled";

export type EditJobStats = {
  estimatedBlocks: number;
  doneBlocks: number;
  mspt: number;
  tps: number;
  batchSize: number;
  delayMs: number;
};

export type EditJobPolicy = {
  adaptiveThrottle: boolean;
  tpsPauseThreshold: number;
  msptLowerBound: number;
  msptUpperBound: number;
  batchSizeMin: number;
  batchSizeMax: number;
  delayMsMin: number;
  delayMsMax: number;
};

export type EditJob = {
  jobId: string;
  worldId: string;
  createdBy: string;
  status: EditJobStatus;
  policy: EditJobPolicy;
  stats: EditJobStats;
  commands: CommandPayload[];
  createdAt: string;
  updatedAt: string;
};

const jobs = new Map<string, EditJob>();

export const createEditJob = (worldId: string, createdBy: string, commands: CommandPayload[]) => {
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const job: EditJob = {
    jobId,
    worldId,
    createdBy,
    status: "queued",
    policy: {
      adaptiveThrottle: true,
      tpsPauseThreshold: 15,
      msptLowerBound: 35,
      msptUpperBound: 45,
      batchSizeMin: 50,
      batchSizeMax: 500,
      delayMsMin: 0,
      delayMsMax: 200,
    },
    stats: {
      estimatedBlocks: commands.length * 10,
      doneBlocks: 0,
      mspt: 0,
      tps: 20,
      batchSize: 200,
      delayMs: 0,
    },
    commands,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(jobId, job);
  return job;
};

const updateJob = (job: EditJob, status: EditJobStatus) => {
  job.status = status;
  job.updatedAt = new Date().toISOString();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForResume = async (job: EditJob) => {
  while (job.status === "paused") {
    await sleep(500);
  }
};

export const runEditJob = async (
  job: EditJob,
  options?: { metricsProvider?: JobMetricsProvider },
) => {
  updateJob(job, "running");
  const context: CommandContext = {
    worldId: job.worldId,
    estimatedBlocks: job.stats.estimatedBlocks,
  };
  const startedAt = Date.now();

  try {
    let index = 0;
    while (index < job.commands.length) {
      if (job.status === "canceled") {
        return;
      }
      if (job.status === "paused") {
        await waitForResume(job);
      }

      const batchSize = Math.max(1, job.stats.batchSize);
      const batch = job.commands.slice(index, index + batchSize);
      for (const payload of batch) {
        const command = createCommand(payload);
        await command.apply(context);
        job.stats.doneBlocks += 10;
        if (job.status === "canceled") {
          return;
        }
      }
      index += batch.length;

      if (options?.metricsProvider) {
        const metrics = await options.metricsProvider();
        updateEditJobMetrics(job, metrics);
      }

      if (job.stats.delayMs > 0) {
        await sleep(job.stats.delayMs);
      }
    }
    updateJob(job, "completed");
    const durationMs = Date.now() - startedAt;
    for (const payload of job.commands) {
      await recordAuditEntry({
        userId: job.createdBy,
        mcUuid: job.createdBy,
        worldId: job.worldId,
        commandType: payload.type,
        params: payload.params,
        estimatedBlocks: job.stats.estimatedBlocks,
        durationMs,
        createdAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    updateJob(job, "failed");
    throw error;
  }
};

export const getEditJob = (jobId: string) => jobs.get(jobId);

export const listEditJobs = () => Array.from(jobs.values());

export const pauseEditJob = (job: EditJob) => {
  updateJob(job, "paused");
};

export const resumeEditJob = (job: EditJob) => {
  updateJob(job, "running");
};

export const cancelEditJob = (job: EditJob) => {
  updateJob(job, "canceled");
};

export const updateEditJobMetrics = (
  job: EditJob,
  metrics: { mspt?: number; tps?: number },
) => {
  if (typeof metrics.mspt === "number") {
    job.stats.mspt = metrics.mspt;
  }
  if (typeof metrics.tps === "number") {
    job.stats.tps = metrics.tps;
  }
  if (job.stats.tps < job.policy.tpsPauseThreshold) {
    updateJob(job, "paused");
    return;
  }
  if (job.status === "paused" && job.stats.tps >= job.policy.tpsPauseThreshold) {
    updateJob(job, "running");
  }

  if (!job.policy.adaptiveThrottle || typeof metrics.mspt !== "number") {
    return;
  }

  if (job.stats.mspt < job.policy.msptLowerBound) {
    job.stats.batchSize = Math.min(job.stats.batchSize + 25, job.policy.batchSizeMax);
    job.stats.delayMs = Math.max(job.stats.delayMs - 10, job.policy.delayMsMin);
    return;
  }

  if (job.stats.mspt > job.policy.msptUpperBound) {
    job.stats.batchSize = Math.max(job.stats.batchSize - 25, job.policy.batchSizeMin);
    job.stats.delayMs = Math.min(job.stats.delayMs + 10, job.policy.delayMsMax);
    return;
  }
};

export const startMetricsTicker = (
  job: EditJob,
  provider: JobMetricsProvider,
  intervalMs = 1000,
) => {
  let active = true;
  const run = async () => {
    if (!active) {
      return;
    }
    try {
      const metrics = await provider();
      updateEditJobMetrics(job, metrics);
    } finally {
      if (active) {
        setTimeout(run, intervalMs);
      }
    }
  };
  run();
  return () => {
    active = false;
  };
};
