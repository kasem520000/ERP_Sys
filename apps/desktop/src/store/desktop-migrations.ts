import type { LocalMigration, StorageAdapter } from "@erp/sync-core";

/**
 * PHASE-021 · the desktop-subset local migrations (MASTER-PLAN §1 item 5 /
 * §3; LOCAL_DATABASE §1.1 desktop subset + §2): versions 4+ continue the
 * sync-core numbering in the SAME `schema_migrations` table — sync-core's
 * `applyMigrations(adapter)` (v1–3, the POS subset + core machinery)
 * always runs FIRST, then `applyDesktopMigrations` adds the desktop
 * tables + meta seeds. Sync-core is consumed UNMODIFIED (review blocker
 * otherwise); these migrations only ADD.
 *
 * - **v4** (`minContractVersion "2026-11-04.1"`): the desktop read caches
 *   (`sales_invoices` + `version`, `quotations`, `delivery_notes`,
 *   `stock_counts`), the unified write set `draft_docs`
 *   (`DRAFT_LOCAL|PENDING_MERGE|SYNC_FAILED|MERGED|CANCELLED_LOCAL` —
 *   OFFLINE_CAPABILITIES_MATRIX honest states), and `local_events` (the
 *   audit-logged user choices, CONFLICT_RESOLUTION §3 — every rejection
 *   choice lands here with the rejecting response's `trace_id`).
 * - **v5**: meta seeds only (`deviceClass="tauri-desktop"`,
 *   `contractVersion`, `permissionSnapshotAt`, `enrolledDeviceId`,
 *   `rolloutChannel="stable"`) — INSERT OR IGNORE so a re-run NEVER
 *   clobbers runtime-written values.
 *
 * FROZEN SCHEMA RULE (LOCAL_DATABASE §2): column meanings below are
 * frozen. Any semantic change (rename, reinterpretation, meaning drift)
 * requires a NEW migration version (6+) AND a cursor reset (full re-pull
 * of the affected entities) — never an in-place edit, never a silent
 * reshape.
 */

/** The highest desktop migration version (versions 1–3 are sync-core's). */
export const DESKTOP_SCHEMA_VERSION = 5;

/** The desktop-subset DDL + meta seeds, applied after sync-core v1–3.
 * Reuses the sync-core `LocalMigration` shape verbatim (type-only import
 * — sync-core source untouched, MASTER-PLAN §1 item 5). */
export const DESKTOP_MIGRATIONS: readonly LocalMigration[] = [
  {
    version: 4,
    minContractVersion: "2026-11-04.1",
    statements: [
      // Read caches: pull-applied projections of the user's modules.
      // Money is TEXT (canonical decimal strings — never REAL, ADR-0009);
      // `payload` keeps the raw feed document; `version` is the server
      // row version (optimistic-concurrency source, CONFLICT_RESOLUTION
      // §4); `dirty` marks local edits (never pruned, LOCAL_DATABASE §5.2).
      `CREATE TABLE IF NOT EXISTS sales_invoices (
         id TEXT PRIMARY KEY,
         doc_no TEXT,
         partner_id TEXT,
         status TEXT NOT NULL,
         issue_date TEXT,
         total_gross TEXT,
         total_tax TEXT,
         currency TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE TABLE IF NOT EXISTS quotations (
         id TEXT PRIMARY KEY,
         doc_no TEXT,
         partner_id TEXT,
         status TEXT NOT NULL,
         issue_date TEXT,
         total_gross TEXT,
         total_tax TEXT,
         currency TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE TABLE IF NOT EXISTS delivery_notes (
         id TEXT PRIMARY KEY,
         doc_no TEXT,
         partner_id TEXT,
         status TEXT NOT NULL,
         issue_date TEXT,
         total_gross TEXT,
         total_tax TEXT,
         currency TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE TABLE IF NOT EXISTS stock_counts (
         id TEXT PRIMARY KEY,
         doc_no TEXT,
         status TEXT NOT NULL,
         counted_at TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      // The desktop write set (MASTER-PLAN §3): the unified draft store.
      // Rows are PRECIOUS until the server acknowledged them — prunable
      // only in the terminal MERGED/CANCELLED_LOCAL statuses (§6.5).
      `CREATE TABLE IF NOT EXISTS draft_docs (
         local_id TEXT PRIMARY KEY,
         doc_type TEXT NOT NULL,
         entity_id TEXT,
         payload TEXT NOT NULL,
         local_status TEXT NOT NULL DEFAULT 'DRAFT_LOCAL'
           CHECK(local_status IN ('DRAFT_LOCAL','PENDING_MERGE','SYNC_FAILED','MERGED','CANCELLED_LOCAL')),
         command_id TEXT,
         rejection TEXT,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS ix_draft_docs_type_status ON draft_docs (doc_type, local_status)`,
      // Audit-logged user choices (CONFLICT_RESOLUTION §3): every
      // rejection-flow decision writes {kind, choice, reason, trace_id,
      // command_id, at} — kept forever, never pruned, never machinery
      // of the sync engine (LOCAL_DATABASE §5.2 exclusion).
      `CREATE TABLE IF NOT EXISTS local_events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         kind TEXT NOT NULL,
         choice TEXT,
         reason TEXT,
         trace_id TEXT,
         command_id TEXT,
         payload TEXT,
         at TEXT NOT NULL
       )`,
    ],
  },
  {
    // Meta seeds only (MASTER-PLAN §3 v5). INSERT OR IGNORE is the whole
    // point: migration re-runs NEVER clobber values the runtime wrote
    // (contractVersion after a status call, enrolledDeviceId after
    // enrollment, permissionSnapshotAt after every permissions pull).
    version: 5,
    minContractVersion: "2026-11-04.1",
    statements: [
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('deviceClass', 'tauri-desktop')`,
      // The compiled-in contract floor this store understands — equals
      // SYNC_CONTRACT_VERSION "2026-11-04.1" (@erp/contracts), frozen
      // here because a migration's values must never drift with imports.
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('contractVersion', '2026-11-04.1')`,
      // "0" = never pulled a permissions snapshot: the sync-core
      // watermark treats ≤ 0 as "not tracked" (D-04 stays writable
      // pre-first-pull; a real snapshotAt epoch-ms overwrites this).
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('permissionSnapshotAt', '0')`,
      // Empty until device enrollment completes (W1 task 1-b owns the
      // enrollment flow that fills it).
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('enrolledDeviceId', '')`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('rolloutChannel', 'stable')`,
    ],
  },
];

/**
 * Apply pending desktop migrations (v4+) — the SAME one-transaction
 * semantics as sync-core `applyMigrations` (copied exactly): a single
 * outer transaction, already-applied versions skipped, every applied
 * version recorded into the shared `schema_migrations` table with
 * `version + min_contract_version + applied_at`. Safe to run after
 * sync-core v1–3 on the same store (versions continue the numbering)
 * and idempotent on re-run.
 *
 * Boot-order guard: refuses loudly when `schema_migrations` has no rows —
 * the sync-core machinery (outbox/cursors/meta) MUST exist before the
 * desktop subset is added (MASTER-PLAN §1 item 5: `applyMigrations`
 * first, then `applyDesktopMigrations`).
 */
export function applyDesktopMigrations(adapter: StorageAdapter): void {
  adapter.transaction(() => {
    adapter.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, min_contract_version TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const appliedRows = adapter.all("SELECT version FROM schema_migrations");
    if (appliedRows.length === 0) {
      throw new Error(
        "applyDesktopMigrations: sync-core applyMigrations (v1–3) must run first — the shared " +
          "schema_migrations table is empty (MASTER-PLAN §1 item 5 boot order)",
      );
    }
    const applied = new Set(appliedRows.map((row) => Number(row.version)));
    for (const migration of DESKTOP_MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      for (const statement of migration.statements) {
        adapter.run(statement);
      }
      adapter.run(
        "INSERT INTO schema_migrations (version, min_contract_version, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.minContractVersion, new Date().toISOString()],
      );
    }
  });
}
