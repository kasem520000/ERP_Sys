import Database from "better-sqlite3";
import type { StorageAdapter } from "@erp/sync-core";

/**
 * PHASE-021 · the @erp/desktop SQLite store (MASTER-PLAN §1 item 3 / §3;
 * DR-P21-02; LOCAL_DATABASE §1/§2/§4/§5; PHASE-021 T2): the REAL
 * device-side store — better-sqlite3 over a file, WAL journal, foreign
 * keys on — implementing the sync-core `StorageAdapter` contract verbatim
 * so the whole 020 machinery (migrations, outbox engine, pull applier,
 * recovery, pruning) runs against it profile-blind.
 *
 * Dual-profile open (DR-P21-02):
 * - `"cipher"` — a SQLCipher build of better-sqlite3 (the Windows CI
 *   custom build): `PRAGMA key` applied + verified via `PRAGMA
 *   cipher_version` → true at-rest encryption (D-02).
 * - `"standard"` — the stock better-sqlite3 build (sandbox + CI fallback;
 *   the recorded caveat): plain SQLite with every OTHER key-management
 *   invariant enforced — the key lives ONLY in the keychain abstraction
 *   and is NEVER written into the DB file or logs (secret-scan tested).
 *   Requesting encryption on a build without cipher support FAILS CLOSED
 *   (`SqlCipherUnavailableError`) unless `profile: "standard"` explicitly
 *   accepts the fallback — the caller must make that trade-off loudly,
 *   never the store silently.
 *
 * Pruning surface (DR-P21-03; LOCAL_DATABASE §5): `listBusinessTables` +
 * `countRows` + `deleteOldestSynced` (same semantics as the memory
 * adapter: never machinery, never dirty rows, write-set rows only after
 * the server acked) plus `tableBytes` measured byte-exact via the SQLite
 * `dbstat` virtual table (`sum(pgsize)`, SQLITE_ENABLE_DBSTAT_VTAB —
 * better-sqlite3 ships it; probed at open, with an honest row-count
 * fallback when absent).
 *
 * Column meanings of every table this store hosts are FROZEN per
 * LOCAL_DATABASE §2 — semantic changes are a new migration version +
 * cursor reset, never an in-place edit.
 */

/** A raw better-sqlite3 connection handle (re-exported for consumers
 * that need pragma-level access, e.g. the corruption drill). */
export type SqliteDatabase = Database.Database;

/** The store profile actually opened (DR-P21-02). */
export type DesktopStoreProfile = "cipher" | "standard";

/** Profile resolution input: `"auto"` (default) picks `cipher` whenever a
 * key is supplied and the build supports it, else fails closed. */
export type DesktopStoreProfileRequest = DesktopStoreProfile | "auto";

/**
 * The store refuses to fake at-rest encryption: an `encryptionKey` was
 * supplied (or `profile: "cipher"` requested) but the better-sqlite3
 * build reports no `PRAGMA cipher_version` — the stock build. Fail
 * closed unless the caller EXPLICITLY opts into the `"standard"`
 * fallback profile (the recorded DR-P21-02 caveat).
 */
export class SqlCipherUnavailableError extends Error {
  readonly code = "SQLCIPHER_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "SqlCipherUnavailableError";
  }
}

/** Observable facts about an open store (never secrets — the encryption
 * key lives only in the keychain abstraction, DR-P21-02). */
export interface DesktopStoreInfo {
  /** The DB file path (as passed to `createDesktopStore`). */
  readonly path: string;
  /** The profile actually opened. */
  readonly profile: DesktopStoreProfile;
  /** The SQLCipher build version when `profile === "cipher"`, else null. */
  readonly cipherVersion: string | null;
  /** How `tableBytes` measures: exact `dbstat` pages, or the honest
   * row-count × 4096 approximation when dbstat is unavailable. */
  readonly byteMeasurement: "dbstat" | "row-approx";
}

/**
 * The desktop store surface: the full sync-core `StorageAdapter`
 * (transaction/run/all/get) + the REQUIRED pruning trio + byte-exact
 * `tableBytes` + connection hygiene. Everything downstream is
 * profile-blind (DR-P21-02: the API is identical across profiles).
 */
export interface DesktopStore extends StorageAdapter {
  listBusinessTables(): string[];
  countRows(table: string): number;
  deleteOldestSynced(table: string, n: number): number;
  tableBytes(table: string): number;
  close(): void;
  readonly isOpen: boolean;
  readonly info: DesktopStoreInfo;
}

export interface CreateDesktopStoreOptions {
  /** DB file path (a temp file in tests; the app-data dir in the shell). */
  readonly path: string;
  /** The keychain-held encryption key (DR-P21-02). When set on a SQLCipher
   * build the store opens encrypted; on the stock build the open FAILS
   * CLOSED unless `profile: "standard"` is explicit. */
  readonly encryptionKey?: string;
  /** Profile request — default `"auto"` (see `DesktopStoreProfileRequest`). */
  readonly profile?: DesktopStoreProfileRequest;
}

/**
 * The desktop business tables — read caches + local write sets, the ONLY
 * pruning candidates (LOCAL_DATABASE §5.2). NEVER the sync-core
 * machinery (`outbox`/`inbox`/`cursors`/`meta`/`schema_migrations`) and
 * never `local_events` (the audit trail — kept forever, pruned by
 * nothing). This constant is the identifier allowlist every pruning
 * entry point validates against (SQL-injection guard: table names in SQL
 * are interpolated identifiers, so they may ONLY come from here).
 */
export const DESKTOP_BUSINESS_TABLES: readonly string[] = [
  // v1 POS-subset read caches + write set (sync-core LOCAL_MIGRATIONS).
  "items",
  "barcodes",
  "uoms",
  "price_list_items",
  "partners",
  "tax_codes",
  "pos_sales",
  // v4 desktop read caches (MASTER-PLAN §3; LOCAL_DATABASE §1.1 subset).
  "sales_invoices",
  "quotations",
  "delivery_notes",
  "stock_counts",
  // v4 desktop write set (the unified draft store).
  "draft_docs",
];

/** The honest per-row byte fallback when the `dbstat` virtual table is
 * absent from the build (one page per row — coarse, and SAYS SO via
 * `DesktopStoreInfo.byteMeasurement === "row-approx"`). */
export const DESKTOP_ROW_BYTES_FALLBACK = 4_096;

/** Per-table pruning rules (LOCAL_DATABASE §5.2): LRU order column +
 * which rows are precious. Table names come ONLY from
 * `DESKTOP_BUSINESS_TABLES`; columns are the frozen v1/v4 DDL. */
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

const PRUNE_SPECS: Readonly<Record<string, PruneSpec>> = {
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
  sales_invoices: { order: "updated_at", dirty: true },
  quotations: { order: "updated_at", dirty: true },
  delivery_notes: { order: "updated_at", dirty: true },
  stock_counts: { order: "counted_at", dirty: true },
  draft_docs: {
    order: "updated_at",
    writeSet: { column: "local_status", prunable: ["MERGED", "CANCELLED_LOCAL"] },
  },
};

/** A bare SQL identifier (defense-in-depth for every interpolated table
 * name — the allowlists above are the primary guard). */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Probe whether this better-sqlite3 build compiled the `dbstat` virtual
 * table (SQLITE_ENABLE_DBSTAT_VTAB — better-sqlite3 ships it; a custom
 * build without it makes `tableBytes` fall back honestly). */
export function dbstatAvailable(db: SqliteDatabase): boolean {
  try {
    db.prepare("SELECT 1 FROM dbstat LIMIT 1").get();
    return true;
  } catch {
    return false;
  }
}

/** The profile an OPEN connection is running (DR-P21-02): `"cipher"`
 * when the build reports a `PRAGMA cipher_version`, else `"standard"`. */
export function storeProfile(db: SqliteDatabase): DesktopStoreProfile {
  const version = db.pragma("cipher_version", { simple: true });
  return typeof version === "string" && version.length > 0 ? "cipher" : "standard";
}

/** SQLite can only bind numbers/strings/bigints/buffers/null — the
 * sync-core adapter contract passes `readonly unknown[]`, so normalize:
 * undefined→null, boolean→1/0 (SQLite has no boolean), rest passthrough
 * (better-sqlite3 rejects anything else with its own clear error). */
function bindParams(params: readonly unknown[] | undefined): unknown[] {
  if (params === undefined) return [];
  return params.map((value: unknown): unknown => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

/** Open the desktop store (MASTER-PLAN §3 boot step 1). Throws
 * `SqlCipherUnavailableError` fail-closed when encryption was requested
 * but the build cannot provide it and the caller did not explicitly
 * accept the `"standard"` fallback. */
export function createDesktopStore(opts: CreateDesktopStoreOptions): DesktopStore {
  const requested: DesktopStoreProfileRequest = opts.profile ?? "auto";
  if (opts.encryptionKey === "") {
    throw new Error(
      "createDesktopStore: encryptionKey must be non-empty (keychain misconfiguration)",
    );
  }
  const db: SqliteDatabase = new Database(opts.path);

  let profile: DesktopStoreProfile;
  let cipherVersion: string | null = null;
  if (opts.encryptionKey !== undefined) {
    // PRAGMA key must be the first statement on the connection; on a
    // SQLCipher build it derives the encryption key, on the stock build
    // it is a silently-ignored unknown pragma (verified — the key never
    // reaches the file either way, which the secret-scan test asserts).
    const escaped = opts.encryptionKey.replace(/'/g, "''");
    db.pragma(`key = '${escaped}'`);
    const probed = db.pragma("cipher_version", { simple: true });
    if (typeof probed === "string" && probed.length > 0) {
      profile = "cipher";
      cipherVersion = probed;
    } else if (requested === "standard") {
      // The explicit DR-P21-02 sandbox/CI fallback: plain file, key kept
      // only in the keychain abstraction, every other invariant enforced.
      profile = "standard";
    } else {
      db.close();
      throw new SqlCipherUnavailableError(
        "createDesktopStore: encryptionKey supplied but this better-sqlite3 build has no " +
          "SQLCipher support (PRAGMA cipher_version absent) — fail closed. Pass " +
          'profile: "standard" to explicitly accept the unencrypted fallback profile ' +
          "(DR-P21-02 recorded caveat) or ship the SQLCipher build.",
      );
    }
  } else {
    if (requested === "cipher") {
      db.close();
      throw new SqlCipherUnavailableError(
        'createDesktopStore: profile "cipher" requires opts.encryptionKey (the keychain-held key, DR-P21-02)',
      );
    }
    profile = "standard";
  }

  // MASTER-PLAN §3: WAL mandatory (crash roll-forward, LOCAL_DATABASE
  // §6.2) + foreign keys enforced. Both are asserted, never assumed.
  const journal = db.pragma("journal_mode = WAL", { simple: true });
  if (journal !== "wal") {
    db.close();
    throw new Error(
      `createDesktopStore: WAL journal mode refused (got ${String(journal)}) — LOCAL_DATABASE §6.2 requires WAL`,
    );
  }
  db.pragma("foreign_keys = ON");
  if (db.pragma("foreign_keys", { simple: true }) !== 1) {
    db.close();
    throw new Error("createDesktopStore: PRAGMA foreign_keys = ON did not take effect");
  }

  const measuredByDbstat = dbstatAvailable(db);
  const statements = new Map<string, Database.Statement>();
  const prepare = (sql: string): Database.Statement => {
    const cached = statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = db.prepare(sql);
    // Bounded cache: distinct SQL shapes are few (sync-core + desktop
    // DDL); evict the oldest entry past the cap so memory stays flat.
    if (statements.size >= 512) {
      const oldest = statements.keys().next();
      if (!oldest.done && oldest.value !== undefined) statements.delete(oldest.value);
    }
    statements.set(sql, statement);
    return statement;
  };
  const assertOpen = (operation: string): void => {
    if (!db.open) {
      throw new Error(`desktop store is closed (${opts.path}) — ${operation} refused`);
    }
  };
  const tableExists = (table: string): boolean => {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as Record<string, unknown> | undefined;
    return row !== undefined;
  };
  const countRows = (table: string): number => {
    if (!IDENTIFIER_PATTERN.test(table)) {
      throw new Error(`countRows: "${table}" is not a valid table identifier`);
    }
    if (!tableExists(table)) return 0; // missing (pre-migration) → honest 0
    const row = prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number } | undefined;
    return row === undefined ? 0 : Number(row.n);
  };

  const store: DesktopStore = {
    get isOpen(): boolean {
      return db.open;
    },
    info: Object.freeze({
      path: opts.path,
      profile,
      cipherVersion,
      byteMeasurement: measuredByDbstat ? "dbstat" : "row-approx",
    } satisfies DesktopStoreInfo),

    transaction<T>(fn: () => T): T {
      assertOpen("transaction");
      // better-sqlite3 wraps fn so a throw rolls back everything (and
      // nested calls flatten into savepoints — the sync-core engine
      // relies on all-or-nothing, LOCAL_DATABASE §2.2).
      return db.transaction(fn)();
    },

    run(sql: string, params?: readonly unknown[]): void {
      assertOpen("run");
      prepare(sql).run(...bindParams(params));
    },

    all(sql: string, params?: readonly unknown[]): Record<string, unknown>[] {
      assertOpen("all");
      return prepare(sql).all(...bindParams(params)) as Record<string, unknown>[];
    },

    get(sql: string, params?: readonly unknown[]): Record<string, unknown> | undefined {
      assertOpen("get");
      return prepare(sql).get(...bindParams(params)) as Record<string, unknown> | undefined;
    },

    listBusinessTables(): string[] {
      // The frozen allowlist (never machinery, never local_events) — the
      // schema is complete after migrations, and every pruning entry
      // point re-checks actual existence before touching a table.
      return [...DESKTOP_BUSINESS_TABLES];
    },

    countRows(table: string): number {
      assertOpen("countRows");
      return countRows(table);
    },

    deleteOldestSynced(table: string, n: number): number {
      assertOpen("deleteOldestSynced");
      // Injection guard + §5.2 scope guard: ONLY known business tables
      // are ever prunable — machinery/audit tables are rejected loudly.
      if (!DESKTOP_BUSINESS_TABLES.includes(table)) {
        throw new Error(
          `deleteOldestSynced: "${table}" is not a prunable business table (DESKTOP_BUSINESS_TABLES ` +
            "allowlist; machinery/audit tables are never pruned — LOCAL_DATABASE §5.2)",
        );
      }
      const spec = PRUNE_SPECS[table] as PruneSpec | undefined;
      if (spec === undefined) {
        throw new Error(`deleteOldestSynced: no prune spec for business table "${table}"`);
      }
      if (!Number.isFinite(n) || n <= 0) return 0;
      if (!tableExists(table)) return 0; // e.g. draft_docs before v4 ran
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
      const deleted = prepare(
        `DELETE FROM ${table} WHERE rowid IN ` +
          `(SELECT rowid FROM ${table} ${where} ORDER BY ${spec.order} ASC, rowid ASC LIMIT ?)`,
      ).run(...bindParams([...params, n]));
      return deleted.changes;
    },

    tableBytes(table: string): number {
      assertOpen("tableBytes");
      if (!IDENTIFIER_PATTERN.test(table)) {
        throw new Error(`tableBytes: "${table}" is not a valid table identifier`);
      }
      if (!tableExists(table)) return 0; // missing → 0, never a throw
      if (countRows(table) === 0) {
        // An empty table's allocated root page is schema overhead, not
        // cached data — 0 data bytes is the honest budget contribution.
        return 0;
      }
      if (!measuredByDbstat) {
        return countRows(table) * DESKTOP_ROW_BYTES_FALLBACK;
      }
      const row = prepare("SELECT sum(pgsize) AS bytes FROM dbstat WHERE name = ?").get(
        table,
      ) as { bytes: number | null } | undefined;
      return row === undefined || row.bytes === null ? 0 : Number(row.bytes);
    },

    close(): void {
      if (!db.open) return;
      statements.clear();
      db.close();
    },
  };
  return store;
}
