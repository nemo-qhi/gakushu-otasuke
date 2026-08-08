import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("declares the provisional product name in app metadata and manifest", async () => {
  const [layout, manifestText] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(layout, /title:\s*"受験伴走システム"/);
  assert.equal(manifest.name, "受験伴走システム");
  assert.equal(manifest.short_name, "受験伴走");
  assert.equal(manifest.display, "standalone");
});

test("keeps material and schedule entry inside the app", async () => {
  const source = await readFile(
    new URL("../app/StudyPlannerApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const appName = "受験伴走システム"/);
  assert.match(source, /storageKey = "jukentanso-system-v0"/);
  assert.match(source, /window\.localStorage\.setItem/);
  assert.match(source, /教材追加/);
  assert.match(source, /生活時間/);
  assert.match(source, /function MaterialPanel/);
  assert.match(source, /function SchedulePanel/);
  assert.match(source, /追加して再計算/);
  assert.match(source, /\/api\/device\/create/);
  assert.match(source, /\/api\/device\/open/);
  assert.match(source, /\/api\/sync/);
});

test("configures D1-backed personal-code sync", async () => {
  const [hostingText, schema, store, migration] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/sync-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_personal_code_sync.sql", import.meta.url), "utf8"),
  ]);
  const hosting = JSON.parse(hostingText);

  assert.equal(hosting.d1, "DB");
  assert.match(schema, /syncSpaces/);
  assert.match(schema, /syncEvents/);
  assert.match(store, /hashPersonalCode/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS sync_spaces/);
  assert.match(migration, /CREATE TABLE `sync_spaces`/);
  assert.match(migration, /CREATE UNIQUE INDEX `idx_sync_spaces_code_hash`/);
});
