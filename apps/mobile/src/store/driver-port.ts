/**
 * PHASE-022 · the mobile SQLite driver port (T2-a; MASTER-PLAN §7 —
 * BINDING; DR-P22-08): the ONE seam every storage implementation plugs
 * into — `MobileStore` (store.ts) programs against this interface and
 * NOTHING else, so the same store/migrations/prune/corruption code runs
 * on:
 *
 * - **Node** (tests + the W3 chaos harness): `node-driver.ts` —
 *   better-sqlite3 over a real file (the @erp/desktop store precedent;
 *   the store API is identical, the ENGINE underneath is the same
 *   SQLite, so the harness is honest about everything except the cipher
 *   profile — on-device only, recorded by T-P22-3a).
 * - **Android** (the device): `apps/mobile/native/drivers/sqlite.ts` —
 *   expo-sqlite (SDK 52) with the SQLCipher key from SecureStorePort.
 *
 * SIGNATURES ARE SYNCHRONOUS ON PURPOSE (the sync-core StorageAdapter is
 * synchronous; better-sqlite3 is synchronous). expo-sqlite ALSO ships a
 * synchronous surface, so the device driver bridges with NO async
 * trampolines — the exact mapping for the native driver author:
 *
 *   SqliteDriverPort member      expo-sqlite implementation (SDK ~52)
 *   ---------------------------  ----------------------------------------
 *   open(path, key?)             openDatabaseSync(path) — then, when a
 *                                 key is supplied, run `PRAGMA key =
 *                                 '<escaped>'` as the FIRST statement
 *                                 (the SQLCipher first-statement rule,
 *                                 the desktop DR-P21-02 precedent); on a
 *                                 non-cipher build the pragma is a
 *                                 silently-ignored no-op — the honest
 *                                 fallback is the native author's call,
 *                                 never a silent plain file when cipher
 *                                 was requested (fail closed instead).
 *   run(sql, params?)            db.runSync(sql, params ?? [])
 *   all(sql, params?)            db.getAllSync(sql, params ?? [])
 *   get(sql, params?)            db.getFirstSync(sql, params ?? [])
 *                                 (returns undefined for no row —
 *                                 getFirstSync returns null; normalize
 *                                 null → undefined)
 *   transaction(fn)              db.withTransactionSync(fn) — nested
 *                                 calls flatten into savepoints exactly
 *                                 like better-sqlite3's db.transaction
 *   pragma(stmt)                 db.getAllSync(`PRAGMA ${stmt}`) and
 *                                 return the first row (or null) —
 *                                 journal_mode/foreign_keys/integrity_
 *                                 check all ride this
 *   tableBytes(table)            SELECT sum(pgsize) FROM dbstat WHERE
 *                                 name = ? via getAllSync (SQLite ≥ 3.7.9
 *                                 ships dbstat; expo-sqlite's bundled
 *                                 SQLite build includes it — verify on
 *                                 device with 3-a's D-02 inspection;
 *                                 the row-count fallback below stays the
 *                                 honest degradation when absent)
 *   integrityCheck()             PRAGMA integrity_check via getAllSync;
 *                                 a pragma that itself throws (malformed
 *                                 image) IS the not-ok verdict — same
 *                                 contract as the Node driver
 *
 * Everything else the store needs (statement caching, identifier
 * validation, empty-table-→-0-byte honesty, the row-approx fallback) is
 * implemented ONCE in store.ts against this port — the native driver
 * stays a thin mapping, never a second copy of store policy.
 */

/** How `tableBytes` measures (the honest store.info report). */
export type ByteMeasurement = "dbstat" | "row-approx";

/** The verdict of `PRAGMA integrity_check` (LOCAL_DATABASE §6.4). */
export interface DriverIntegrityCheckResult {
  readonly ok: boolean;
  /** "ok" when healthy; otherwise the pragma's findings or the thrown
   * error's message ("database disk image is malformed", …). */
  readonly detail: string;
}

/**
 * The synchronous SQLite driver contract (see the module header for the
 * expo-sqlite bridging table). `open` is called exactly once before any
 * other member; every other member on a closed driver throws loudly
 * (asserted by the store, not duplicated here).
 */
export interface SqliteDriverPort {
  /** Open the database file (`":memory:"` supported) — the SQLCipher key
   * is applied here when the build supports it (the first-statement
   * rule). Throws loudly on failure; never returns a half-open driver. */
  open(path: string, key?: string): void;
  /** Close the driver (idempotent). */
  close(): void;
  /** Whether the driver is open. */
  readonly isOpen: boolean;
  /** A mutating statement (INSERT/UPDATE/DELETE/DDL). */
  run(sql: string, params?: readonly unknown[]): void;
  /** Query rows as plain objects. */
  all(sql: string, params?: readonly unknown[]): Record<string, unknown>[];
  /** Query a single row (or undefined). */
  get(sql: string, params?: readonly unknown[]): Record<string, unknown> | undefined;
  /** Execute fn inside ONE transaction (a throw rolls back everything;
   * nested calls flatten into savepoints — sync-core relies on this). */
  transaction<T>(fn: () => T): T;
  /** Run a PRAGMA and return its first row (or null). */
  pragma(stmt: string): unknown;
  /** Byte-exact measurement of one table via the `dbstat` virtual table
   * (`sum(pgsize)`) — 0 for a missing table, 0 for an empty one (an
   * empty table's root page is schema overhead, not cached data). */
  tableBytes(table: string): number;
  /** How tableBytes measures on THIS driver. */
  readonly byteMeasurement: ByteMeasurement;
  /** `PRAGMA integrity_check` — a throwing pragma IS the not-ok verdict
   * (never an anonymous crash out of the driver). */
  integrityCheck(): DriverIntegrityCheckResult;
}
