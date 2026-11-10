import Database from "better-sqlite3";

import type {
  ByteMeasurement,
  DriverIntegrityCheckResult,
  SqliteDriverPort,
} from "./driver-port";

/**
 * PHASE-022 · the Node/mobile SQLite driver (T2-a; MASTER-PLAN §7): the
 * `SqliteDriverPort` over better-sqlite3 — the tests, the W3 expo chaos
 * harness (T-P22-3a opens the REAL mobile store on a temp SQLite file
 * through THIS driver — expo-sqlite is the same SQLite engine, so the
 * harness is honest about everything except the cipher profile) and any
 * Node-side tooling.
 *
 * The open sequence mirrors the @erp/desktop store invariants (the
 * DR-P22-08 port): WAL mandatory (crash roll-forward — asserted, never
 * assumed), foreign keys enforced (asserted), and an `integrity_check`
 * helper for the §6.4 boot drill. `PRAGMA key` is applied FIRST when a
 * key is supplied (the SQLCipher first-statement rule): on a cipher
 * build it derives the key; on the stock build it is a silently-ignored
 * unknown pragma — the mobile runtime's at-rest encryption posture is
 * owned by the DEVICE driver (expo-sqlite + SecureStore, DR-P22-09),
 * never by this Node build.
 */

/** The honest per-row byte fallback when the `dbstat` virtual table is
 * absent from a build (one page per row — coarse, and SAYS SO via
 * `byteMeasurement === "row-approx"`). */
export const MOBILE_ROW_BYTES_FALLBACK = 4_096;

/** A bare SQL identifier (defense-in-depth for every interpolated table
 * name — the store's allowlists are the primary guard). */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** SQLite can only bind numbers/strings/bigints/buffers/null — normalize
 * the port's `readonly unknown[]`: undefined→null, boolean→1/0 (SQLite
 * has no boolean); the rest pass through (better-sqlite3 rejects anything
 * else with its own clear error). */
function bindParams(params: readonly unknown[] | undefined): unknown[] {
  if (params === undefined) return [];
  return params.map((value: unknown): unknown => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

/** Probe whether this better-sqlite3 build compiled the `dbstat` virtual
 * table (SQLITE_ENABLE_DBSTAT_VTAB — better-sqlite3 ships it; a custom
 * build without it makes `tableBytes` fall back honestly). */
export function dbstatAvailable(db: Database.Database): boolean {
  try {
    db.prepare("SELECT 1 FROM dbstat LIMIT 1").get();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the Node driver (NOT yet open — `open(path, key?)` is the
 * caller's first call, the same lifecycle as the device driver so the
 * store code never special-cases either).
 */
export function createNodeDriver(): SqliteDriverPort {
  let db: Database.Database | null = null;
  let statements = new Map<string, Database.Statement>();
  let measuredByDbstat = false;

  const assertOpen = (operation: string): Database.Database => {
    if (db === null || !db.open) {
      throw new Error(`node driver is closed — ${operation} refused`);
    }
    return db;
  };

  const prepare = (connection: Database.Database, sql: string): Database.Statement => {
    const cached = statements.get(sql);
    if (cached !== undefined) return cached;
    const statement = connection.prepare(sql);
    // Bounded cache: distinct SQL shapes are few (sync-core + mobile
    // DDL); evict the oldest entry past the cap so memory stays flat.
    if (statements.size >= 512) {
      const oldest = statements.keys().next();
      if (!oldest.done && oldest.value !== undefined) statements.delete(oldest.value);
    }
    statements.set(sql, statement);
    return statement;
  };

  const tableExists = (connection: Database.Database, table: string): boolean => {
    const row = connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as Record<string, unknown> | undefined;
    return row !== undefined;
  };

  const countRows = (connection: Database.Database, table: string): number => {
    const row = prepare(connection, `SELECT count(*) AS n FROM ${table}`).get() as
      | { n: number }
      | undefined;
    return row === undefined ? 0 : Number(row.n);
  };

  const driver: SqliteDriverPort = {
    open(path: string, key?: string): void {
      if (db !== null && db.open) {
        throw new Error(`node driver is already open (${path}) — one driver, one file`);
      }
      const connection = new Database(path);
      if (key !== undefined && key !== "") {
        // PRAGMA key must be the first statement on the connection; on a
        // SQLCipher build it derives the encryption key, on the stock
        // build it is a silently-ignored unknown pragma (the desktop
        // DR-P21-02 caveat — the DEVICE driver owns real at-rest
        // encryption via expo-sqlite + SecureStore, never this build).
        const escaped = key.replace(/'/g, "''");
        connection.pragma(`key = '${escaped}'`);
      }
      // MASTER-PLAN §7: WAL mandatory (crash roll-forward) + foreign keys
      // enforced. Both are asserted, never assumed.
      const journal = connection.pragma("journal_mode = WAL", { simple: true });
      // :memory: databases cannot use WAL (SQLite reports "memory") — the
      // in-memory journal IS the memory profile's rollback journal; every
      // other path must get WAL (crash roll-forward, LOCAL_DATABASE §6.2).
      const walOk = journal === "wal" || (path === ":memory:" && journal === "memory");
      if (!walOk) {
        connection.close();
        throw new Error(
          `node driver: WAL journal mode refused (got ${String(journal)}) — LOCAL_DATABASE §6.2 requires WAL`,
        );
      }
      connection.pragma("foreign_keys = ON");
      if (connection.pragma("foreign_keys", { simple: true }) !== 1) {
        connection.close();
        throw new Error("node driver: PRAGMA foreign_keys = ON did not take effect");
      }
      db = connection;
      statements = new Map();
      measuredByDbstat = dbstatAvailable(connection);
    },

    close(): void {
      if (db === null) return;
      if (db.open) {
        statements.clear();
        db.close();
      }
      db = null;
    },

    get isOpen(): boolean {
      return db !== null && db.open;
    },

    run(sql: string, params?: readonly unknown[]): void {
      const connection = assertOpen("run");
      prepare(connection, sql).run(...bindParams(params));
    },

    all(sql: string, params?: readonly unknown[]): Record<string, unknown>[] {
      const connection = assertOpen("all");
      return prepare(connection, sql).all(...bindParams(params)) as Record<string, unknown>[];
    },

    get(sql: string, params?: readonly unknown[]): Record<string, unknown> | undefined {
      const connection = assertOpen("get");
      return prepare(connection, sql).get(...bindParams(params)) as
        | Record<string, unknown>
        | undefined;
    },

    transaction<T>(fn: () => T): T {
      const connection = assertOpen("transaction");
      // better-sqlite3 wraps fn so a throw rolls back everything (nested
      // calls flatten into savepoints — the sync-core engine relies on
      // all-or-nothing, LOCAL_DATABASE §2.2).
      return connection.transaction(fn)();
    },

    pragma(stmt: string): unknown {
      const connection = assertOpen("pragma");
      const rows = connection.pragma(stmt) as unknown;
      if (Array.isArray(rows)) {
        return rows.length > 0 ? (rows[0] as unknown) : null;
      }
      return rows ?? null;
    },

    tableBytes(table: string): number {
      const connection = assertOpen("tableBytes");
      if (!IDENTIFIER_PATTERN.test(table)) {
        throw new Error(`tableBytes: "${table}" is not a valid table identifier`);
      }
      if (!tableExists(connection, table)) return 0; // missing → 0, never a throw
      if (countRows(connection, table) === 0) {
        // An empty table's allocated root page is schema overhead, not
        // cached data — 0 data bytes is the honest budget contribution.
        return 0;
      }
      if (!measuredByDbstat) {
        return countRows(connection, table) * MOBILE_ROW_BYTES_FALLBACK;
      }
      const row = prepare(connection, "SELECT sum(pgsize) AS bytes FROM dbstat WHERE name = ?").get(
        table,
      ) as { bytes: number | null } | undefined;
      return row === undefined || row.bytes === null ? 0 : Number(row.bytes);
    },

    get byteMeasurement(): ByteMeasurement {
      return measuredByDbstat ? "dbstat" : "row-approx";
    },

    integrityCheck(): DriverIntegrityCheckResult {
      const connection = assertOpen("integrityCheck");
      try {
        const rows = connection.prepare("PRAGMA integrity_check").all() as Record<
          string,
          unknown
        >[];
        const detail = rows.map((row) => String(row.integrity_check ?? "")).join("; ");
        return { ok: rows.length === 1 && detail === "ok", detail };
      } catch (error) {
        // SqliteError from the pragma itself (malformed image, not a
        // database) — the loud honest verdict, same shape as a finding.
        return {
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };

  return driver;
}
