import type { LocalMigration, StorageAdapter } from "@erp/sync-core";

/**
 * PHASE-022 · the mobile local migrations (T2-a; MASTER-PLAN §7 — BINDING;
 * DR-P22-08 field + DR-P22-08b personal; LOCAL_DATABASE §1.1/§2): the TWO
 * store profiles of the ONE app, each with its own chain in the SAME
 * `schema_migrations` table shape (one file, one profile — they never mix;
 * the guards below refuse loudly on a cross-profile application):
 *
 * - **android-field** (`applyFieldMigrations`): sync-core's
 *   `applyMigrations(adapter)` (v1–3: the POS-subset read caches + the
 *   outbox/inbox/cursors/meta machinery + v3's version columns) ALWAYS
 *   runs first, then versions 4+ add the FIELD-subset DDL (the van_stocks
 *   / routes / settlement_templates / statements read caches, mirroring
 *   the LITE payload shapes of `packages/contracts/src/sync/
 *   feed-projections.ts` — DR-P22-05) and v5 the meta seeds. Sync-core is
 *   consumed UNMODIFIED (review blocker otherwise); these migrations only
 *   ADD.
 *
 * - **android-personal** (`applyPersonalMigrations`, DR-P22-08b):
 *   cursors + meta + the personal read models (statements, sales_invoices,
 *   receipts, notifications) ONLY — **NO outbox/inbox** (LOCAL_DATABASE
 *   §1.1 rule 2: the personal class is read-only by construction, so a
 *   tampered device holds no queue to tamper). sync-core's
 *   `applyMigrations` is deliberately NOT called for this profile — from
 *   `packages/sync-core/src/store/adapter.ts`, LOCAL_MIGRATIONS v1 (the
 *   quote the DR requires):
 *
 *     // §1.2 core machinery — identical on every write-capable device.
 *     `CREATE TABLE IF NOT EXISTS outbox (
 *        command_id TEXT PRIMARY KEY, … status TEXT NOT NULL DEFAULT 'QUEUED', …
 *      )`,
 *     `CREATE INDEX IF NOT EXISTS ix_outbox_status ON outbox (status, client_created_at)`,
 *     `CREATE TABLE IF NOT EXISTS inbox ( command_id TEXT PRIMARY KEY, processed_at … )`,
 *     `CREATE TABLE IF NOT EXISTS cursors ( entity_type TEXT PRIMARY KEY, … )`,
 *     `CREATE TABLE IF NOT EXISTS meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL )`,
 *
 *   v1 BUNDLES the outbox with the cursors+meta this profile needs, and
 *   `applyMigrations` applies the whole list atomically — there is no
 *   way to get cursors+meta without the outbox through sync-core. The
 *   personal profile therefore applies its own minimal DDL (cursors +
 *   meta + the four read models) into the same `schema_migrations` table
 *   with its own version entries; sync-core itself stays untouched (the
 *   pull-only cycles then run through `SyncClient`-level primitives, and
 *   every enqueue attempt fails loudly — the store has no outbox table
 *   to write into: the structural hard-guard the §1.1 rule 2 demands).
 *
 * FROZEN SCHEMA RULE (LOCAL_DATABASE §2): column meanings below are
 * frozen. Any semantic change requires a NEW migration version (6+ for
 * field, 3+ for personal) AND a cursor reset (full re-pull), never an
 * in-place edit.
 *
 * Money/quantities are TEXT canonical decimal strings — never REAL
 * (ADR-0009 §4), mirroring the LITE projections byte-for-byte in column
 * intent. Read caches carry the sync-core conventions: `payload` (the
 * raw feed document), `version` (the server row version — the
 * optimistic-concurrency source, CONFLICT_RESOLUTION §4), `updated_at`
 * (the feed's changedAt), `dirty` (local edits — never pruned,
 * LOCAL_DATABASE §5.2). Write sets (`local_status`) exist on the POS
 * write set (sync-core v1's pos_sales) only — the field app's writes
 * ride the outbox, not local tables.
 */

/** The highest field migration version (versions 1–3 are sync-core's). */
export const MOBILE_FIELD_SCHEMA_VERSION = 5;

/** The highest personal migration version (the personal chain is its own
 * numbering — the profiles never share a file). */
export const MOBILE_PERSONAL_SCHEMA_VERSION = 2;

// -- shared DDL fragments ------------------------------------------------------------
//
// `statements` is pulled by BOTH profiles (the field group scopes it to
// route customers, the personal group to the linked partner —
// LOCAL_DATABASE §1.1); the table shape is ONE frozen contract.

const STATEMENTS_READ_CACHE_DDL = `CREATE TABLE IF NOT EXISTS statements (
         id TEXT PRIMARY KEY,
         customer_code TEXT NOT NULL,
         customer_name TEXT NOT NULL,
         customer_name_ar TEXT,
         as_of TEXT,
         currency_code TEXT,
         opening_balance TEXT,
         closing_balance TEXT,
         closing_balance_base TEXT,
         aging TEXT,
         entries TEXT,
         generated_at TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`;

/** The field-subset DDL + meta seeds (applied after sync-core v1–3;
 * reuses the sync-core `LocalMigration` shape verbatim — type-only
 * import, sync-core source untouched). */
export const MOBILE_FIELD_MIGRATIONS: readonly LocalMigration[] = [
  {
    // v4 (minContractVersion "2026-11-04.1"): the field-subset read
    // caches — every column mirrors its LITE payload field
    // (packages/contracts/src/sync/feed-projections.ts, DR-P22-05):
    // van_stocks ← VanStockLite, routes ← RouteLite (customers ride the
    // row as an ordered JSON list), settlement_templates ←
    // SettlementTemplateLite (the PHASE-017 rep_settlements read model
    // under the field app's name), statements ← StatementLite (the
    // change row's id IS the partner id; version null on the wire).
    version: 4,
    minContractVersion: "2026-11-04.1",
    statements: [
      `CREATE TABLE IF NOT EXISTS van_stocks (
         id TEXT PRIMARY KEY,
         warehouse_id TEXT NOT NULL,
         item_id TEXT NOT NULL,
         batch_id TEXT,
         qty TEXT NOT NULL,
         value TEXT NOT NULL,
         refreshed_at TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS ix_van_stocks_slice ON van_stocks (warehouse_id, item_id)`,
      `CREATE TABLE IF NOT EXISTS routes (
         id TEXT PRIMARY KEY,
         code TEXT NOT NULL,
         name TEXT NOT NULL,
         name_ar TEXT,
         sales_rep_id TEXT,
         van_warehouse_id TEXT,
         day_pattern TEXT,
         status TEXT NOT NULL,
         customers TEXT NOT NULL DEFAULT '[]',
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS ix_routes_rep ON routes (sales_rep_id, status)`,
      `CREATE TABLE IF NOT EXISTS settlement_templates (
         id TEXT PRIMARY KEY,
         settlement_no TEXT,
         sales_rep_id TEXT NOT NULL,
         van_warehouse_id TEXT,
         shift_id TEXT,
         settlement_date TEXT,
         status TEXT NOT NULL,
         opening_cash TEXT,
         cash_sales TEXT,
         collections TEXT,
         cash_refunds TEXT,
         rep_expenses TEXT,
         expected_cash TEXT,
         counted_cash TEXT,
         variance TEXT,
         variance_direction TEXT,
         deposit_amount TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS ix_settlement_templates_rep ON settlement_templates (sales_rep_id, status)`,
      STATEMENTS_READ_CACHE_DDL,
      `CREATE INDEX IF NOT EXISTS ix_statements_asof ON statements (as_of)`,
    ],
  },
  {
    // v5: meta seeds only (the desktop v5 shape). INSERT OR IGNORE is the
    // whole point: a re-run NEVER clobbers runtime-written values
    // (contractVersion after a status call, enrolledDeviceId after
    // enrollment, permissionSnapshotAt after every permissions pull).
    // Values are FROZEN inline — a migration's values must never drift
    // with imports (the desktop LOCAL_DATABASE §2 note); the parity with
    // ./../constants golden values is asserted by the store suite.
    version: 5,
    minContractVersion: "2026-11-04.1",
    statements: [
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('deviceClass', 'android-field')`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('contractVersion', '2026-11-04.1')`,
      // "0" = never pulled a permissions snapshot: the sync-core D-04
      // watermark treats ≤ 0 as "not tracked" (stays writable
      // pre-first-pull; a real snapshotAt epoch-ms overwrites this).
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('permissionSnapshotAt', '0')`,
      // Empty until device enrollment completes (task 2-b owns the
      // enrollment flow that fills it).
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('enrolledDeviceId', '')`,
      // The preset byte-exact storage budget (MOBILE_STORAGE_BUDGET_BYTES
      // — 128 MB, MASTER-PLAN §0) so the prune pass reads the STORE's own
      // record, not a compiled constant that could drift from what the
      // file was budgeted at.
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('storageBudgetBytes', '134217728')`,
    ],
  },
];

/** The personal-subset DDL + meta seeds (its OWN chain — never after
 * sync-core; see the module header for the DR-P22-08b rationale). */
export const MOBILE_PERSONAL_MIGRATIONS: readonly LocalMigration[] = [
  {
    // v1: cursors + meta (the pull machinery this read-only profile
    // needs) + the personal read models — statements (shared LITE shape),
    // sales_invoices (the 020 desktop-group header projection: id,
    // changedAt→updated_at, version, invoiceNo, status, kind, channel,
    // customerId, orderDate, totalAmount, currency, ownerDeviceId),
    // receipts (ReceiptLite), notifications (NotificationLite).
    // NO outbox, NO inbox — LOCAL_DATABASE §1.1 rule 2.
    version: 1,
    minContractVersion: "2026-11-04.1",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version INTEGER PRIMARY KEY,
         min_contract_version TEXT NOT NULL,
         applied_at TEXT NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS cursors (
         entity_type TEXT PRIMARY KEY,
         last_seq TEXT NOT NULL,
         synced_at INTEGER NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS meta (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
      STATEMENTS_READ_CACHE_DDL,
      `CREATE INDEX IF NOT EXISTS ix_statements_asof ON statements (as_of)`,
      `CREATE TABLE IF NOT EXISTS sales_invoices (
         id TEXT PRIMARY KEY,
         invoice_no TEXT,
         status TEXT NOT NULL,
         kind TEXT,
         channel TEXT,
         customer_id TEXT,
         order_date TEXT,
         total_amount TEXT,
         currency TEXT,
         owner_device_id TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS ix_sales_invoices_customer ON sales_invoices (customer_id, status)`,
      `CREATE TABLE IF NOT EXISTS receipts (
         id TEXT PRIMARY KEY,
         receipt_no TEXT,
         status TEXT NOT NULL,
         partner_id TEXT,
         method TEXT,
         currency_code TEXT,
         amount TEXT,
         value_date TEXT,
         reference TEXT,
         posted_at TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS ix_receipts_partner ON receipts (partner_id, status)`,
      `CREATE TABLE IF NOT EXISTS notifications (
         id TEXT PRIMARY KEY,
         user_id TEXT,
         category TEXT,
         severity TEXT,
         title TEXT,
         body TEXT,
         action_label TEXT,
         action_url TEXT,
         read_at TEXT,
         payload TEXT NOT NULL,
         version INTEGER,
         updated_at TEXT,
         dirty INTEGER NOT NULL DEFAULT 0
       )`,
      `CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications (user_id, category)`,
    ],
  },
  {
    // v2: meta seeds only (INSERT OR IGNORE — a re-run NEVER clobbers
    // runtime-written values; frozen inline, the field v5 note applies).
    version: 2,
    minContractVersion: "2026-11-04.1",
    statements: [
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('deviceClass', 'android-personal')`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('contractVersion', '2026-11-04.1')`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('permissionSnapshotAt', '0')`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('enrolledDeviceId', '')`,
      `INSERT OR IGNORE INTO meta (key, value) VALUES ('storageBudgetBytes', '134217728')`,
    ],
  },
];

/**
 * Apply pending field migrations (v4+) — the SAME one-transaction
 * semantics as sync-core `applyMigrations`: a single outer transaction,
 * already-applied versions skipped, every applied version recorded into
 * the shared `schema_migrations` table. Idempotent on re-run.
 *
 * Boot-order guard (the desktop applyDesktopMigrations precedent,
 * strengthened): refuses loudly when sync-core v1–3 are not ALL present —
 * the POS-subset read caches + the outbox/cursors/meta machinery MUST
 * exist before the field subset is added (MASTER-PLAN §1 item 8:
 * `applyMigrations` first, then `applyFieldMigrations`). This also
 * refuses a PERSONAL file (its chain has no sync-core v3) and any junk
 * partial state — one file, one profile, never a silent mix.
 */
export function applyFieldMigrations(adapter: StorageAdapter): void {
  adapter.transaction(() => {
    adapter.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, min_contract_version TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const appliedRows = adapter.all("SELECT version FROM schema_migrations");
    const applied = new Set(appliedRows.map((row) => Number(row.version)));
    if (applied.size === 0 || ![1, 2, 3].every((version) => applied.has(version))) {
      throw new Error(
        "applyFieldMigrations: sync-core applyMigrations (v1–3) must run first — the shared " +
          "schema_migrations table does not carry the full v1–3 chain (MASTER-PLAN §1 item 8 boot order; " +
          "one file, one profile — a personal store never takes field migrations)",
      );
    }
    for (const migration of MOBILE_FIELD_MIGRATIONS) {
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

/**
 * Apply pending personal migrations (v1+). Deliberately does NOT call
 * sync-core's `applyMigrations` — see the module header for the quoted
 * v1 DDL (the outbox is bundled with the cursors this profile needs);
 * the personal profile applies its own minimal DDL instead.
 *
 * Guard: refuses loudly when the file already carries a NON-personal
 * migration chain (any version outside this chain's {1, 2}) or an
 * `outbox` table — a write-capable profile must never be silently
 * re-profiled personal (and vice versa: the field guard refuses this
 * file). Idempotent on re-run.
 */
export function applyPersonalMigrations(adapter: StorageAdapter): void {
  adapter.transaction(() => {
    adapter.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, min_contract_version TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const appliedRows = adapter.all("SELECT version FROM schema_migrations");
    const applied = new Set(appliedRows.map((row) => Number(row.version)));
    for (const version of applied) {
      if (!MOBILE_PERSONAL_MIGRATIONS.some((migration) => migration.version === version)) {
        throw new Error(
          `applyPersonalMigrations: this file carries a non-personal migration chain ` +
            `(version ${String(version)} is not part of the personal chain) — one file, one profile; ` +
            "a write-capable (outbox) store never becomes personal in place (LOCAL_DATABASE §1.1 rule 2)",
        );
      }
    }
    if (applied.size > 0) {
      const outbox = adapter.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outbox'",
      );
      if (outbox !== undefined) {
        throw new Error(
          "applyPersonalMigrations: an outbox table exists — this is a write-capable store; " +
            "the personal profile has NO outbox by construction (LOCAL_DATABASE §1.1 rule 2)",
        );
      }
    }
    for (const migration of MOBILE_PERSONAL_MIGRATIONS) {
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
