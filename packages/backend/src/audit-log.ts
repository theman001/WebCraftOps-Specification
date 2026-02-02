import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

const DB_PATH = process.env.WEBCRAFTOPS_DB_PATH ?? "data/webcraftops.sqlite";

let db: DatabaseSync | null = null;

const getDb = () => {
  if (db) {
    return db;
  }
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mc_uuid TEXT NOT NULL,
      world_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      params_json TEXT NOT NULL,
      estimated_blocks INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
};

export const recordAuditEntry = (entry: Omit<AuditLogEntry, "id">) => {
  const auditEntry: AuditLogEntry = {
    id: randomUUID(),
    ...entry,
  };
  const database = getDb();
  const stmt = database.prepare(`
    INSERT INTO audit_logs (
      id, user_id, mc_uuid, world_id, command_type, params_json,
      estimated_blocks, duration_ms, created_at
    ) VALUES (
      $id, $userId, $mcUuid, $worldId, $commandType, $paramsJson,
      $estimatedBlocks, $durationMs, $createdAt
    );
  `);
  stmt.run({
    id: auditEntry.id,
    userId: auditEntry.userId,
    mcUuid: auditEntry.mcUuid,
    worldId: auditEntry.worldId,
    commandType: auditEntry.commandType,
    paramsJson: JSON.stringify(auditEntry.params),
    estimatedBlocks: auditEntry.estimatedBlocks,
    durationMs: auditEntry.durationMs,
    createdAt: auditEntry.createdAt,
  });
  return auditEntry;
};

export const listAuditEntries = (filters?: {
  userId?: string;
  worldId?: string;
  commandType?: string;
  since?: string;
  until?: string;
  limit?: number;
}) => {
  const database = getDb();
  const where: string[] = [];
  const params: Record<string, string | number> = {};

  if (filters?.userId) {
    where.push("user_id = $userId");
    params.userId = filters.userId;
  }
  if (filters?.worldId) {
    where.push("world_id = $worldId");
    params.worldId = filters.worldId;
  }
  if (filters?.commandType) {
    where.push("command_type = $commandType");
    params.commandType = filters.commandType;
  }
  if (filters?.since) {
    where.push("created_at >= $since");
    params.since = filters.since;
  }
  if (filters?.until) {
    where.push("created_at <= $until");
    params.until = filters.until;
  }

  const limit = Math.min(filters?.limit ?? 100, 500);
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const stmt = database.prepare(`
    SELECT * FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit};
  `);
  const rows = stmt.all(params) as Array<{
    id: string;
    user_id: string;
    mc_uuid: string;
    world_id: string;
    command_type: string;
    params_json: string;
    estimated_blocks: number;
    duration_ms: number;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    mcUuid: row.mc_uuid,
    worldId: row.world_id,
    commandType: row.command_type,
    params: JSON.parse(row.params_json),
    estimatedBlocks: row.estimated_blocks,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }));
};
