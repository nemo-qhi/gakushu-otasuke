import { env } from "cloudflare:workers";

const maxDataBytes = 600_000;

type SyncRow = {
  id: string;
  code_hash: string;
  data_json: string;
  revision: number;
  updated_at: string;
};

type SyncPayload = Record<string, unknown>;

export type SyncSnapshot = {
  data: SyncPayload;
  revision: number;
  updatedAt: string;
};

export function normalizePersonalCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatPersonalCode(code: string) {
  const normalized = normalizePersonalCode(code);
  if (normalized.startsWith("JUKEN")) {
    return [
      normalized.slice(0, 5),
      normalized.slice(5, 9),
      normalized.slice(9, 13),
      normalized.slice(13, 17),
    ]
      .filter(Boolean)
      .join("-");
  }
  return normalized.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

export function isValidPersonalCode(code: string) {
  return /^JUKEN[A-Z0-9]{12}$/.test(normalizePersonalCode(code));
}

export function generatePersonalCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let suffix = "";

  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }

  return formatPersonalCode(`JUKEN${suffix}`);
}

export async function createSyncSpace({
  clientId,
  data,
}: {
  clientId?: string;
  data: SyncPayload;
}) {
  const d1 = getD1();
  await ensureSyncSchema(d1);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generatePersonalCode();
    const codeHash = await hashPersonalCode(code);
    const id = crypto.randomUUID();
    const serialized = serializeData(data);

    try {
      await d1
        .prepare(
          "INSERT INTO sync_spaces (id, code_hash, data_json, revision, last_client_id, updated_at) VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)",
        )
        .bind(id, codeHash, serialized, clientId ?? null)
        .run();

      const snapshot = await readSnapshotByHash(d1, codeHash);
      if (!snapshot) throw new Error("Created sync space could not be read.");
      return { code, ...snapshot };
    } catch (error) {
      if (!String(error).includes("UNIQUE")) throw error;
    }
  }

  throw new Error("Could not generate a unique personal code.");
}

export async function openSyncSpace(code: string) {
  const normalized = normalizePersonalCode(code);
  if (!isValidPersonalCode(normalized)) {
    throw new SyncError("invalid_code", "個人コードの形式が正しくありません。", 400);
  }

  const d1 = getD1();
  await ensureSyncSchema(d1);
  const snapshot = await readSnapshotByHash(d1, await hashPersonalCode(normalized));
  if (!snapshot) {
    throw new SyncError("not_found", "この個人コードのデータが見つかりません。", 404);
  }
  return snapshot;
}

export async function syncSpace({
  code,
  clientId,
  data,
  baseRevision,
  idempotencyKey,
}: {
  code: string;
  clientId?: string;
  data: SyncPayload;
  baseRevision?: number;
  idempotencyKey?: string;
}) {
  const normalized = normalizePersonalCode(code);
  if (!isValidPersonalCode(normalized)) {
    throw new SyncError("invalid_code", "個人コードの形式が正しくありません。", 400);
  }

  const d1 = getD1();
  await ensureSyncSchema(d1);
  const codeHash = await hashPersonalCode(normalized);
  const row = await readRowByHash(d1, codeHash);
  if (!row) {
    throw new SyncError("not_found", "この個人コードのデータが見つかりません。", 404);
  }

  if (idempotencyKey) {
    const event = await d1
      .prepare("SELECT id FROM sync_events WHERE idempotency_key = ? LIMIT 1")
      .bind(idempotencyKey)
      .first<{ id: string }>();
    if (event) {
      return { ...(await snapshotFromRow(row)), accepted: false, conflict: false };
    }
  }

  if (typeof baseRevision === "number" && baseRevision < row.revision) {
    return { ...(await snapshotFromRow(row)), accepted: false, conflict: true };
  }

  const serialized = serializeData(data);
  const payloadHash = await hashText(serialized);
  const nextRevision = row.revision + 1;

  await d1
    .prepare(
      "UPDATE sync_spaces SET data_json = ?, revision = ?, last_client_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    )
    .bind(serialized, nextRevision, clientId ?? null, row.id)
    .run();

  if (idempotencyKey) {
    await d1
      .prepare(
        "INSERT INTO sync_events (id, space_id, idempotency_key, client_id, payload_hash) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), row.id, idempotencyKey, clientId ?? null, payloadHash)
      .run();
  }

  const snapshot = await readSnapshotByHash(d1, codeHash);
  if (!snapshot) throw new Error("Synced space could not be read.");
  return { ...snapshot, accepted: true, conflict: false };
}

export class SyncError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export function syncErrorResponse(error: unknown) {
  if (error instanceof SyncError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : "Unexpected sync error";
  return Response.json({ error: "sync_error", message }, { status: 500 });
}

function getD1() {
  if (!env.DB) {
    throw new SyncError(
      "database_unavailable",
      "同期用データベースがまだ利用できません。",
      503,
    );
  }
  return env.DB;
}

async function ensureSyncSchema(d1: D1Database) {
  await d1.batch([
    d1.prepare(
      "CREATE TABLE IF NOT EXISTS sync_spaces (id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, data_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, last_client_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_spaces_code_hash ON sync_spaces (code_hash)",
    ),
    d1.prepare(
      "CREATE TABLE IF NOT EXISTS sync_events (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, client_id TEXT, payload_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    ),
    d1.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_events_idempotency_key ON sync_events (idempotency_key)",
    ),
  ]);
}

async function readSnapshotByHash(d1: D1Database, codeHash: string) {
  const row = await readRowByHash(d1, codeHash);
  return row ? snapshotFromRow(row) : null;
}

async function readRowByHash(d1: D1Database, codeHash: string) {
  return d1
    .prepare(
      "SELECT id, code_hash, data_json, revision, updated_at FROM sync_spaces WHERE code_hash = ? LIMIT 1",
    )
    .bind(codeHash)
    .first<SyncRow>();
}

async function snapshotFromRow(row: SyncRow): Promise<SyncSnapshot> {
  return {
    data: JSON.parse(row.data_json) as SyncPayload,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function serializeData(data: SyncPayload) {
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).length > maxDataBytes) {
    throw new SyncError("payload_too_large", "同期データが大きすぎます。", 413);
  }
  return serialized;
}

async function hashPersonalCode(code: string) {
  return hashText(normalizePersonalCode(code));
}

async function hashText(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
