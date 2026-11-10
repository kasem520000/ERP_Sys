import { readFileSync, rmSync, writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  LocalStoreCorruptError,
  applyMigrations,
  maintainCursorCount,
  maintainInboxCount,
  metaDelete,
  metaSet,
} from "@erp/sync-core";

import {
  createDesktopStore,
  type DesktopStore,
  type DesktopStoreProfileRequest,
} from "./sqlite-adapter";
import { applyDesktopMigrations } from "./desktop-migrations";

/**
 * PHASE-021 · the LOCAL_DATABASE §6.4 corruption path (MASTER-PLAN §3;
 * PHASE-021 T2; FAILURE_RECOVERY §3): `PRAGMA integrity_check` on every
 * boot; anything but "ok" (including the pragma itself exploding —
 * "database disk image is malformed" / "file is not a database" both
 * surface as SqliteError) runs the documented recovery:
 *
 *   1. STAGE the readable outbox+inbox rows (the precious data — cached
 *      read models are disposable) to `<path>.staging` JSON, best-effort
 *      through a separate read-only connection; unreadable parts stage
 *      as a `partial: true` manifest, never a silent skip.
 *   2. CLOSE + DELETE the corrupt file (and its -wal/-shm sidecars).
 *   3. RECREATE the store (full boot: sync-core v1–3 + desktop v4+).
 *   4. RE-IMPORT the staged rows (INSERT OR IGNORE — idempotent).
 *   5. RESET the cursors (full re-pull from seq 0) + maintain the
 *      cursor/inbox checksums + stamp `meta.quarantineRecoveryAt`.
 *
 * Loud + honest throughout: every unrecoverable step throws the typed
 * `LocalStoreCorruptError` (the sync-core failure surface) — the store
 * NEVER silently continues on a corrupt file. The staging file is kept
 * on disk after the drill for manual salvage.
 */

/** The integrity verdict (LOCAL_DATABASE §6.4). */
export interface IntegrityCheckResult {
  readonly ok: boolean;
  /** "ok" when healthy; otherwise the pragma's findings or the
   * SqliteError message ("database disk image is malformed", …). */
  readonly detail: string;
}

/** `PRAGMA integrity_check` through the store. Corrupt files can make
 * the PRAGMA ITSELF throw — that throw IS the not-ok verdict (caught,
 * never propagated as an anonymous crash). */
export function integrityCheck(store: DesktopStore): IntegrityCheckResult {
  if (!store.isOpen) {
    throw new Error("integrityCheck: the store is closed — open it before checking");
  }
  try {
    const rows = store.all("PRAGMA integrity_check");
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
}

/** The staging manifest shape (versioned for forward compatibility). */
export interface StagedSurvivorsManifest {
  readonly version: 1;
  readonly stagedAt: string;
  readonly source: string;
  /** True when any part of the outbox/inbox was unreadable — the drill
   * proceeds with what WAS readable and says so. */
  readonly partial: boolean;
  readonly outbox: readonly Record<string, unknown>[];
  readonly inbox: readonly Record<string, unknown>[];
}

/** The staging summary (`stageSurvivors` result). */
export interface StagedSurvivors {
  readonly file: string;
  readonly partial: boolean;
  readonly outboxRows: number;
  readonly inboxRows: number;
  readonly stagedAt: string;
}

/** A bare SQL identifier (the staged column names are interpolated into
 * the re-import INSERTs — validated, never trusted blindly). */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const applyKeyPragma = (db: Database.Database, encryptionKey: string | undefined): void => {
  if (encryptionKey !== undefined) {
    // Best-effort mirror of the store open (DR-P21-02): on a SQLCipher
    // build the staged file needs the key before it reads; on the stock
    // build this is the verified no-op.
    db.pragma(`key = '${encryptionKey.replace(/'/g, "''")}'`);
  }
};

/** Read every row of one machinery table best-effort: a separate
 * connection (read-only first — a live WAL may need a read-write open
 * to recover the -shm, so that is the fallback). Returns null when the
 * table is unreadable (→ partial staging), rows (possibly []) when ok. */
function readSurvivorRows(
  path: string,
  table: string,
  encryptionKey: string | undefined,
): Record<string, unknown>[] | null {
  const attempt = (readonly: boolean): Record<string, unknown>[] | null => {
    let db: Database.Database | undefined;
    try {
      db = new Database(path, readonly ? { readonly: true } : undefined);
      applyKeyPragma(db, encryptionKey);
      return db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
    } catch {
      return null;
    } finally {
      if (db !== undefined && db.open) db.close();
    }
  };
  return attempt(true) ?? attempt(false);
}

/**
 * Stage the readable outbox+inbox rows to `<path>.staging` (§6.4 step 1).
 * Read failures degrade to an empty/partial manifest; only a failure to
 * WRITE the manifest throws (LocalStoreCorruptError) — without a staging
 * file the reset would destroy precious pending operations, so the drill
 * must stop loud instead.
 */
export function stageSurvivors(opts: {
  readonly path: string;
  readonly encryptionKey?: string;
}): StagedSurvivors {
  const outbox = readSurvivorRows(opts.path, "outbox", opts.encryptionKey);
  const inbox = readSurvivorRows(opts.path, "inbox", opts.encryptionKey);
  const partial = outbox === null || inbox === null;
  const manifest: StagedSurvivorsManifest = {
    version: 1,
    stagedAt: new Date().toISOString(),
    source: opts.path,
    partial,
    outbox: outbox ?? [],
    inbox: inbox ?? [],
  };
  const stagingFile = `${opts.path}.staging`;
  try {
    writeFileSync(stagingFile, JSON.stringify(manifest, null, 2), "utf8");
  } catch (cause) {
    throw new LocalStoreCorruptError(
      `stageSurvivors: cannot write the staging manifest (${stagingFile}) — refusing the ` +
        `§6.4 reset, the outbox is precious: ${errorMessage(cause)}`,
    );
  }
  return {
    file: stagingFile,
    partial,
    outboxRows: manifest.outbox.length,
    inboxRows: manifest.inbox.length,
    stagedAt: manifest.stagedAt,
  };
}

/** Read back a staging manifest (the drill's own re-import input + the
 * manual-salvage entry point). Throws LocalStoreCorruptError when the
 * file is unreadable or not a valid v1 manifest. */
export function readStagedSurvivors(file: string): StagedSurvivorsManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (cause) {
    throw new LocalStoreCorruptError(
      `readStagedSurvivors: staging file unreadable (${file}): ${errorMessage(cause)}`,
    );
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    (manifest as { version?: unknown }).version !== 1 ||
    !Array.isArray((manifest as { outbox?: unknown }).outbox) ||
    !Array.isArray((manifest as { inbox?: unknown }).inbox)
  ) {
    throw new LocalStoreCorruptError(
      `readStagedSurvivors: staging file is not a valid v1 manifest (${file})`,
    );
  }
  return manifest as StagedSurvivorsManifest;
}

/** Re-import staged rows (INSERT OR IGNORE — replay-safe by primary
 * key). Column names come from the staged DB itself and are identifier-
 * validated before interpolation. Returns the rows offered; the caller
 * measures the actual landed rows via table counts. */
function importSurvivorRows(
  adapter: DesktopStore,
  table: string,
  rows: readonly Record<string, unknown>[],
): void {
  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => IDENTIFIER_PATTERN.test(column));
    if (columns.length === 0) continue;
    adapter.run(
      `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
      columns.map((column) => row[column] ?? null),
    );
  }
}

export interface RecoverCorruptStoreOptions {
  /** The corrupt DB file path. */
  readonly path: string;
  /** The open store on that path, when boot got that far (closed by the
   * drill; its profile guides the recreation). Optional — a file too
   * corrupt to even open goes straight here. */
  readonly store?: DesktopStore;
  /** The keychain-held encryption key, re-applied on recreation
   * (DR-P21-02 — the key never lives in the DB or the staging file). */
  readonly encryptionKey?: string;
  /** Profile override for the recreated store; defaults to the open
   * store's actual profile, else "auto". */
  readonly profile?: DesktopStoreProfileRequest;
  /** The integrity failure detail (audit trail, lands in the thrown
   * errors when a step fails). */
  readonly integrityDetail?: string;
}

/** The §6.4 drill outcome (everything the caller + tests assert). */
export interface RecoverCorruptStoreResult {
  /** The fresh, fully migrated, survivors-re-imported store. */
  readonly store: DesktopStore;
  readonly stagingFile: string;
  readonly partial: boolean;
  readonly stagedOutbox: number;
  readonly stagedInbox: number;
  /** Rows actually landed (INSERT OR IGNORE skips pre-existing ids — on
   * a fresh recreation everything staged lands). */
  readonly reimportedOutbox: number;
  readonly reimportedInbox: number;
  readonly quarantineRecoveryAt: string;
}

/**
 * Run the LOCAL_DATABASE §6.4 corruption drill (stage → delete →
 * recreate → re-import → cursors reset). Consumes sync-core unmodified:
 * `applyMigrations` (v1–3) + the maintain* checksum helpers so the next
 * `recoveryPass` sees a consistent store. Throws LocalStoreCorruptError
 * on every unrecoverable step (staging unwritable, file undeletable,
 * recreation failed, re-import failed) — never a silent continuation.
 */
export function recoverCorruptStore(opts: RecoverCorruptStoreOptions): RecoverCorruptStoreResult {
  if (opts.store !== undefined && opts.store.info.path !== opts.path) {
    throw new Error(
      `recoverCorruptStore: opts.store path (${opts.store.info.path}) does not match opts.path (${opts.path})`,
    );
  }

  // 1) STAGE first — while the file still exists and the open store (if
  //    any) keeps the WAL/-shm readable for the staging connection.
  const staged = stageSurvivors({ path: opts.path, encryptionKey: opts.encryptionKey });

  // 2) Close + delete the corrupt file (+ WAL/SHM sidecars).
  opts.store?.close();
  for (const file of [opts.path, `${opts.path}-wal`, `${opts.path}-shm`]) {
    try {
      rmSync(file, { force: true });
    } catch (cause) {
      throw new LocalStoreCorruptError(
        `recoverCorruptStore: cannot delete the corrupt store file (${file}): ${errorMessage(cause)}`,
      );
    }
  }

  // 3) Recreate + full migration chain (sync-core v1–3 then desktop v4+).
  let fresh: DesktopStore;
  try {
    fresh = createDesktopStore({
      path: opts.path,
      encryptionKey: opts.encryptionKey,
      profile: opts.profile ?? opts.store?.info.profile ?? "auto",
    });
    applyMigrations(fresh);
    applyDesktopMigrations(fresh);
  } catch (cause) {
    throw new LocalStoreCorruptError(
      `recoverCorruptStore: store recreation failed (${opts.path}; integrity: ` +
        `${opts.integrityDetail ?? "unknown"}): ${errorMessage(cause)} — staged survivors kept at ${staged.file}`,
    );
  }

  // 4+5) Re-import survivors + reset cursors + maintain checksums, ONE
  // transaction (a crash mid-drill leaves a consistent fresh store that
  // re-runs the drill from the staged file).
  const manifest = readStagedSurvivors(staged.file);
  try {
    const reimported = fresh.transaction(() => {
      const outboxBefore = fresh.countRows("outbox");
      const inboxBefore = fresh.countRows("inbox");
      importSurvivorRows(fresh, "outbox", manifest.outbox);
      importSurvivorRows(fresh, "inbox", manifest.inbox);
      // Cursors reset = full re-pull from seq 0 (cached read models are
      // disposable; the feeds repopulate them).
      fresh.run("DELETE FROM cursors");
      maintainCursorCount(fresh); // meta cursorCount = "0"
      // The re-imported inbox rows must be covered by the inboxCount
      // checksum or the NEXT recoveryPass would flag a fresh mismatch.
      maintainInboxCount(fresh);
      // The §6.4 path HAS run — a stale quarantine flag (if any file
      // reuse ever carried one) must not wedge the fresh store.
      metaDelete(fresh, "quarantined");
      const quarantineRecoveryAt = new Date().toISOString();
      metaSet(fresh, "quarantineRecoveryAt", quarantineRecoveryAt);
      return {
        outbox: fresh.countRows("outbox") - outboxBefore,
        inbox: fresh.countRows("inbox") - inboxBefore,
        quarantineRecoveryAt,
      };
    });
    return {
      store: fresh,
      stagingFile: staged.file,
      partial: staged.partial,
      stagedOutbox: staged.outboxRows,
      stagedInbox: staged.inboxRows,
      reimportedOutbox: reimported.outbox,
      reimportedInbox: reimported.inbox,
      quarantineRecoveryAt: reimported.quarantineRecoveryAt,
    };
  } catch (cause) {
    fresh.close();
    throw new LocalStoreCorruptError(
      `recoverCorruptStore: survivor re-import failed (${opts.path}): ${errorMessage(cause)} ` +
        `— staged survivors kept at ${staged.file} for manual salvage`,
    );
  }
}
