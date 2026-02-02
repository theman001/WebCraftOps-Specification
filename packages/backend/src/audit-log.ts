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

const DB_DRIVER = process.env.WEBCRAFTOPS_DB_DRIVER ?? "sqlite";
const DB_PATH = process.env.WEBCRAFTOPS_DB_PATH ?? "data/webcraftops.sqlite";
const POSTGRES_URL = process.env.WEBCRAFTOPS_POSTGRES_URL ?? "";

let sqliteDb: DatabaseSync | null = null;
let postgresClient: any | null = null;

const ensureSqlite = () => {
  if (sqliteDb) {
    return sqliteDb;
  }
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  sqliteDb = new DatabaseSync(DB_PATH);
  sqliteDb.exec(`
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
  sqliteDb.exec(`
    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS audit_logs_world_id_idx ON audit_logs(world_id);
    CREATE INDEX IF NOT EXISTS audit_logs_command_type_idx ON audit_logs(command_type);
  `);
  return sqliteDb;
};

const ensurePostgres = async () => {
  if (postgresClient) {
    return postgresClient;
  }
  if (!POSTGRES_URL) {
    throw new Error("WEBCRAFTOPS_POSTGRES_URL 환경 변수가 필요합니다.");
  }
  let pg: any;
  try {
    pg = await import("pg");
  } catch (error) {
    throw new Error("Postgres 사용을 위해 pg 패키지가 필요합니다.");
  }
  const client = new pg.Client({ connectionString: POSTGRES_URL });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mc_uuid TEXT NOT NULL,
      world_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      params_json TEXT NOT NULL,
      estimated_blocks INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
  await client.query(
    "CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);",
  );
  await client.query("CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);");
  await client.query("CREATE INDEX IF NOT EXISTS audit_logs_world_id_idx ON audit_logs(world_id);");
  await client.query(
    "CREATE INDEX IF NOT EXISTS audit_logs_command_type_idx ON audit_logs(command_type);",
  );
  postgresClient = client;
  return client;
};

export const recordAuditEntry = async (entry: Omit<AuditLogEntry, "id">) => {
  const auditEntry: AuditLogEntry = {
    id: randomUUID(),
    ...entry,
  };
  if (DB_DRIVER === "postgres") {
    const client = await ensurePostgres();
    await client.query(
      `
      INSERT INTO audit_logs (
        id, user_id, mc_uuid, world_id, command_type, params_json,
        estimated_blocks, duration_ms, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      );
    `,
      [
        auditEntry.id,
        auditEntry.userId,
        auditEntry.mcUuid,
        auditEntry.worldId,
        auditEntry.commandType,
        JSON.stringify(auditEntry.params),
        auditEntry.estimatedBlocks,
        auditEntry.durationMs,
        auditEntry.createdAt,
      ],
    );
    return auditEntry;
  }

  const database = ensureSqlite();
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

export const listAuditEntries = async (filters?: {
  userId?: string;
  worldId?: string;
  commandType?: string;
  since?: string;
  until?: string;
  limit?: number;
}) => {
  const limit = Math.min(filters?.limit ?? 100, 500);
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

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  if (DB_DRIVER === "postgres") {
    return listAuditEntriesPostgres(whereClause, params, limit);
  }
  return listAuditEntriesSqlite(whereClause, params, limit);
};

const listAuditEntriesSqlite = (
  whereClause: string,
  params: Record<string, string | number>,
  limit: number,
) => {
  const database = ensureSqlite();
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

const listAuditEntriesPostgres = async (
  whereClause: string,
  params: Record<string, string | number>,
  limit: number,
) => {
  const client = await ensurePostgres();
  const values = Object.values(params);
  let query = `
    SELECT * FROM audit_logs
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${limit};
  `;
  Object.keys(params).forEach((key, index) => {
    query = query.replace(`$${key}`, `$${index + 1}`);
  });
  const result = await client.query(query, values);
  return result.rows.map((row: any) => ({
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
