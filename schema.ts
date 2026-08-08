import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const syncSpaces = sqliteTable(
  "sync_spaces",
  {
    id: text("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    dataJson: text("data_json").notNull(),
    revision: integer("revision").notNull().default(1),
    lastClientId: text("last_client_id"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    codeHashIdx: uniqueIndex("idx_sync_spaces_code_hash").on(table.codeHash),
  }),
);

export const syncEvents = sqliteTable(
  "sync_events",
  {
    id: text("id").primaryKey(),
    spaceId: text("space_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    clientId: text("client_id"),
    payloadHash: text("payload_hash"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex("idx_sync_events_idempotency_key").on(
      table.idempotencyKey,
    ),
  }),
);
