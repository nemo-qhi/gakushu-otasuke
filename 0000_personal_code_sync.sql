CREATE TABLE `sync_spaces` (
  `id` text PRIMARY KEY NOT NULL,
  `code_hash` text NOT NULL,
  `data_json` text NOT NULL,
  `revision` integer DEFAULT 1 NOT NULL,
  `last_client_id` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_spaces_code_hash` ON `sync_spaces` (`code_hash`);
--> statement-breakpoint
CREATE TABLE `sync_events` (
  `id` text PRIMARY KEY NOT NULL,
  `space_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `client_id` text,
  `payload_hash` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sync_events_idempotency_key` ON `sync_events` (`idempotency_key`);
