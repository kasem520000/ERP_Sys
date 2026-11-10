import type { StorageAdapter } from "@erp/sync-core";

import type { ByteMeasurement, SqliteDriverPort } from "./driver-port";
import { createNodeDriver } from "./node-driver";
import { applyFieldMigrations, applyPersonalMigrations } from "./migrations";
import { applyMigrations } from "@erp/sync-core";

/**
 * PHASE-022 · the @erp/mobile SQLite store (T2-a; MASTER-PLAN §7 — BINDING;
 * DR-P22-08; LOCAL_DATABASE §1/§2/§4/§5): `MobileStore implements
 * StorageAdapter` over a `SqliteDriverPort` — the REAL device-side store
 * the whole 020 machinery (migrations, outbox engine, pull applier,
 * recovery, pruning) runs against, profile-blind across the ONE app's TWO
 * capability experiences:
 *
 * - **android-field** — the POS-subset read caches + the outbox write
 *   machinery (sync-core v1–3) + the field-subset read caches (v4+):
 *   pull+push cycles.
 * - **android-personal** — cursors + meta + the personal read models
 *   ONLY, NO outbox/inbox (DR-P22-08b): pull-only cycles; every enqueue
 *   attempt fails loudly — there is no outbox table to write into.
 *
 * Pruning surface (the DR-P21-03 port under the 128 MB budget,
 * MOBILE_STORAGE_BUDGET_BYTES): `listBusinessTables` + `countRows` +
 * `deleteOldestSynced` (same semantics as the sync-core adapter: never
 * machinery, never dirty rows, write-set rows only after the server
 * acked) plus `tableBytes` measured byte-exact via the driver's `dbstat`
 * `sum(pgsize)` (the DR-P21-03 approach), and `dbstatBytes()` — the
 * byte-exact footprint across the whole business-table set, the number
 * the prune pass holds under the budget.
 *
 * Column meanings of every table this store hosts are FROZEN per
 * LOCAL_DATABASE §2 — semantic changes are a new migration version +
 * cursor reset, never an in-place edit.
 */

/** The store's device class (contracts DeviceClass — the ONE app's TWO
 * capability experiences). */
export type MobileDeviceClass = "android-field" | "android-personal";

/** The internal profile key (the class minus the platform prefix). */
export type MobileStoreProfile = "field" | "personal";

/** Observable facts about an open store (never secrets — the SQLCipher
 * key lives only in SecureStorePort, DR-P22-09; the DEVICE driver owns
 * at-rest encryption). */
export interface MobileStoreInfo {
  /** The DB file path (as passed to the open helper; `":memory:"` in
   * fast unit tests). */
  readonly path: string;
  /** The device class this store serves. */
  readonly deviceClass: MobileDeviceClass;
  /** How `tableBytes` measures: exact `dbstat` pages, or the honest
   * row-count × 4096 approximation when dbstat is unavailable. */
  readonly byteMeasurement: ByteMeasurement;
}

/**
 * The mobile store surface: the full sync-core `StorageAdapter`
 * (transaction/run/all/get) + the REQUIRED pruning trio + byte-exact
 * `tableBytes` + `dbstatBytes` + connection hygiene.
 */
export interface MobileStore extends StorageAdapter {
  listBusinessTables(): string[];
  countRows(table: string): number;
  deleteOldestSynced(table: string, n: number): number;
  tableBytes(table: string): number;
  /** The byte-exact footprint across the business-table set (the prune
   * pass's measured input; machinery is excluded by the allowlist). */
  dbstatBytes(): number;
  close(): void;
  readonly isOpen: boolean;
  readonly info: MobileStoreInfo;
  readonly deviceClass: MobileDeviceClass;
}

/** Options for the open helpers (driver injection is how the suite fakes
 * dbstat and how future hosts plug a non-Node driver without touching
 * this module). */
export interface OpenMobileStoreOptions {
  /** The SQLCipher key (SecureStore-held on device). On the Node driver
   * an unknown pragma is a no-op — the desktop DR-P21-02 caveat; the
   * DEVICE driver owns real at-rest encryption. */
  readonly key?: string;
  /** Driver override (default: the Node better-sqlite3 driver). */
  readonly driver?: SqliteDriverPort;
}

/**
 * The android-field business tables — read caches + the POS write set,
 * the ONLY pruning candidates (LOCAL_DATABASE §5.2). NEVER the sync-core
 * machinery (`outbox`/`inbox`/`cursors`/`meta`/`schema_migrations`).
 * v1 POS subset (sync-core) + the v4 field-subset read caches
 * (MASTER-PLAN §1 item 8; LOCAL_DATABASE §1.1). This constant is the
 * identifier allowlist every pruning entry point validates against
 * (SQL-injection guard: table names in SQL are interpolated identifiers,
 * so they may ONLY come from here).
 */
export const FIELD_BUSINESS_TABLES: readonly string[] = [
  // v1 POS-subset read caches + write set (sync-core LOCAL_MIGRATIONS).
  "items",
  "barcodes",
  "uoms",
  "price_list_items",
  "partners",
  "tax_codes",
  "pos_sales",
  // v4 field-subset read caches (MASTER-PLAN §7; the LITE mirrors).
  "van_stocks",
  "routes",
  "settlement_templates",
  "statements",
];

/**
 * The android-personal read models (the personal profile's ONLY tables
 * besides cursors/meta/schema_migrations — DR-P22-08b; LOCAL_DATABASE
 * §1.1 rule 2: no outbox, no inbox, no write set).
 */
export const PERSONAL_READ_MODELS: readonly string[] = [
  "statements",
  "sales_invoices",
  "receipts",
  "notifications",
];

/** Per-table pruning rules (LOCAL_DATABASE §5.2): LRU order column +
 * which rows are precious. Table names come ONLY from the frozen
 * allowlists above; columns are the frozen v1/v4 DDL. */
interface PruneSpec {
  /** Oldest-first ordering column (NULLs first — never-pulled rows are
   * the coldest cache entries). */
  readonly order: string;
  /** The table carries a `dirty` column → dirty rows are never pruned. */
  readonly dirty?: boolean;
  /** Write-set tables: rows prunable ONLY in these server-acked terminal
   * statuses (§6.5 "precious" otherwise). */
  readonly writeSet?: {
    readonly column: string;
    readonly prunable: readonly string[];
  };
}

const FIELD_PRUNE_SPECS: Readonly<Record<string, PruneSpec>> = {
  items: { order: "updated_at", dirty: true },
  barcodes: { order: "updated_at" },
  uoms: { order: "updated_at" },
  price_list_items: { order: "updated_at" },
  partners: { order: "updated_at" },
  tax_codes: { order: "updated_at" },
  pos_sales: {
    order: "synced_at",
    writeSet: { column: "local_status", prunable: ["SYNCED"] },
  },
  van_stocks: { order: "updated_at", dirty: true },
  routes: { order: "updated_at", dirty: true },
  settlement_templates: { order: "updated_at", dirty: true },
  statements: { order: "updated_at", dirty: true },
};

const PERSONAL_PRUNE_SPECS: Readonly<Record<string, PruneSpec>> = {
  statements: { order: "updated_at", dirty: true },
  sales_invoices: { order: "updated_at", dirty: true },
  receipts: { order: "updated_at", dirty: true },
  notifications: { order: "updated_at", dirty: true },
};

/** A bare SQL identifier (defense-in-depth for every interpolated table
 * name — the allowlists above are the primary guard). */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The business tables + prune specs for one profile. */
interface ProfileShape {
  readonly deviceClass: MobileDeviceClass;
  readonly businessTables: readonly string[];
  readonly pruneSpecs: Readonly<Record<string, PruneSpec>>;
}

const PROFILES: Readonly<Record<MobileStoreProfile, ProfileShape>> = {
  field: {
    deviceClass: "android-field",
    businessTables: FIELD_BUSINESS_TABLES,
    pruneSpecs: FIELD_PRUNE_SPECS,
  },
  personal: {
    deviceClass: "android-personal",
    businessTables: PERSONAL_READ_MODELS,
    pruneSpecs: PERSONAL_PRUNE_SPECS,
  },
};

/**
 * Create the store over an OPEN driver (the lower-level constructor —
 * the open helpers below add the migration chains). The driver must be
 * open; the store owns it from here on (`close()` closes it).
 */
export function createMobileStore(
  driver: SqliteDriverPort,
  profile: MobileStoreProfile,
  path: string,
): MobileStore {
  if (!driver.isOpen) {
    throw new Error(`createMobileStore: the driver must be OPEN first (${path})`);
  }
  const shape = PROFILES[profile];
  const assertOpen = (operation: string): void => {
    if (!driver.isOpen) {
      throw new Error(`mobile store is closed (${path}) — ${operation} refused`);
    }
  };
  const tableExists = (table: string): boolean => {
    if (!IDENTIFIER_PATTERN.test(table)) {
      throw new Error(`tableExists: "${table}" is not a valid table identifier`);
    }
    return (
      driver.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]) !==
      undefined
    );
  };
  const countRows = (table: string): number => {
    if (!IDENTIFIER_PATTERN.test(table)) {
      throw new Error(`countRows: "${table}" is not a valid table identifier`);
    }
    if (!tableExists(table)) return 0; // missing (pre-migration) → honest 0
    const row = driver.get(`SELECT count(*) AS n FROM ${table}`) as { n: number } | undefined;
    return row === undefined ? 0 : Number(row.n);
  };

  const store: MobileStore = {
    get isOpen(): boolean {
      return driver.isOpen;
    },
    deviceClass: shape.deviceClass,
    info: Object.freeze({
      path,
      deviceClass: shape.deviceClass,
      byteMeasurement: driver.byteMeasurement,
    } satisfies MobileStoreInfo),

    transaction<T>(fn: () => T): T {
      assertOpen("transaction");
      // The driver wraps fn so a throw rolls back everything (nested
      // calls flatten into savepoints — sync-core relies on
      // all-or-nothing, LOCAL_DATABASE §2.2).
      return driver.transaction(fn);
    },

    run(sql: string, params?: readonly unknown[]): void {
      assertOpen("run");
      driver.run(sql, params);
    },

    all(sql: string, params?: readonly unknown[]): Record<string, unknown>[] {
      assertOpen("all");
      return driver.all(sql, params);
    },

    get(sql: string, params?: readonly unknown[]): Record<string, unknown> | undefined {
      assertOpen("get");
      return driver.get(sql, params);
    },

    listBusinessTables(): string[] {
      // The frozen per-profile allowlist (never machinery) — the schema
      // is complete after migrations, and every pruning entry point
      // re-checks actual existence before touching a table.
      return [...shape.businessTables];
    },

    countRows(table: string): number {
      assertOpen("countRows");
      return countRows(table);
    },

    deleteOldestSynced(table: string, n: number): number {
      assertOpen("deleteOldestSynced");
      // Injection guard + §5.2 scope guard: ONLY known business tables
      // are ever prunable — machinery tables are rejected loudly.
      if (!shape.businessTables.includes(table)) {
        throw new Error(
          `deleteOldestSynced: "${table}" is not a prunable business table for the ` +
            `${profile} profile (LOCAL_DATABASE §5.2 allowlist; machinery is never pruned)`,
        );
      }
      const spec = shape.pruneSpecs[table] as PruneSpec | undefined;
      if (spec === undefined) {
        throw new Error(`deleteOldestSynced: no prune spec for business table "${table}"`);
      }
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (!tableExists(table)) return 0; // e.g. pre-migration
      const guards: string[] = [];
      const params: unknown[] = [];
      if (spec.dirty === true) {
        guards.push("dirty = 0"); // local edits are never pruned (§5.2)
      }
      if (spec.writeSet !== undefined) {
        guards.push(
          `${spec.writeSet.column} IN (${spec.writeSet.prunable.map(() => "?").join(", ")})`,
        );
        params.push(...spec.writeSet.prunable);
      }
      const where = guards.length > 0 ? `WHERE ${guards.join(" AND ")}` : "";
      const before = countRows(table);
      driver.run(
        `DELETE FROM ${table} WHERE rowid IN ` +
          `(SELECT rowid FROM ${table} ${where} ORDER BY ${spec.order} ASC, rowid ASC LIMIT ?)`,
        [...params, n],
      );
      const after = countRows(table);
      return before - after;
    },

    tableBytes(table: string): number {
      assertOpen("tableBytes");
      if (!IDENTIFIER_PATTERN.test(table)) {
        throw new Error(`tableBytes: "${table}" is not a valid table identifier`);
      }
      if (!tableExists(table)) return 0; // missing → 0, never a throw
      return driver.tableBytes(table);
    },

    dbstatBytes(): number {
      assertOpen("dbstatBytes");
      return shape.businessTables.reduce((sum, table) => sum + this.tableBytes(table), 0);
    },

    close(): void {
      if (!driver.isOpen) return;
      driver.close();
    },
  };
  return store;
}

/**
 * Open + migrate the android-field store (the MASTER-PLAN §7 boot
 * sequence): driver open (WAL + foreign keys + the key pragma) →
 * sync-core `applyMigrations` (v1–3) → `applyFieldMigrations` (v4+) —
 * returning a fully migrated, ready-to-sync store.
 */
export function openFieldStore(path: string, opts?: OpenMobileStoreOptions): MobileStore {
  const driver = opts?.driver ?? createNodeDriver();
  driver.open(path, opts?.key);
  const store = createMobileStore(driver, "field", path);
  applyMigrations(store);
  applyFieldMigrations(store);
  return store;
}

/**
 * Open + migrate the android-personal store (DR-P22-08b): driver open →
 * `applyPersonalMigrations` (v1+ — cursors + meta + the personal read
 * models ONLY; NO outbox/inbox; sync-core's applyMigrations is
 * deliberately NOT called — see migrations.ts for the quoted v1 DDL
 * rationale). Pull-only by construction.
 */
export function openPersonalStore(path: string, opts?: OpenMobileStoreOptions): MobileStore {
  const driver = opts?.driver ?? createNodeDriver();
  driver.open(path, opts?.key);
  const store = createMobileStore(driver, "personal", path);
  applyPersonalMigrations(store);
  return store;
}
