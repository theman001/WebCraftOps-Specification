import { randomUUID } from "node:crypto";

export type CommandType = "setBlock" | "fill" | "replace" | "pasteBlueprint" | "clone";

export type CommandPayload = {
  type: CommandType;
  params: Record<string, unknown>;
};

export type CommandContext = {
  worldId: string;
  estimatedBlocks: number;
};

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
};

export type EditJobPolicy = {
  adaptiveThrottle: boolean;
  tpsPauseThreshold: number;
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
    },
    stats: {
      estimatedBlocks: commands.length * 10,
      doneBlocks: 0,
      mspt: 0,
      tps: 20,
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

export const runEditJob = async (job: EditJob) => {
  updateJob(job, "running");
  const context: CommandContext = {
    worldId: job.worldId,
    estimatedBlocks: job.stats.estimatedBlocks,
  };

  try {
    for (const payload of job.commands) {
      const command = createCommand(payload);
      await command.apply(context);
      job.stats.doneBlocks += 10;
    }
    updateJob(job, "completed");
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
