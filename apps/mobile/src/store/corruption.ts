import { rmSync, readFileSync, writeFileSync } from "node:fs";

import {
  LocalStoreCorruptError,
  maintainCursorCount,
  maintainInboxCount,
  metaDelete,
  metaSet,
} from "@erp/sync-core";

import type { SqliteDriverPort } from "./driver-port";
import { createNodeDriver } from "./node-driver";
import { openFieldStore, openPersonalStore, type MobileStore, type MobileStoreProfile } from "./store";

/**
 * PHASE-022 · the LOCAL_DATABASE §6.4 corruption path, ported from the
 * proven @erp/desktop drill (T2-a; MASTER-PLAN §7 — the §6.4 binding;
 * FAILURE_RECOVERY §3): `PRAGMA integrity_check` on every boot; anything
 * but "ok" (including the pragma itself exploding — "database disk image
 * is malformed" / "file is not a database" both surface as SqliteError)
 * runs the documented recovery:
 *
 *   1. STAGE the readable precious rows to `<path>.staging` JSON,
 *      best-effort through a separate connection; unreadable parts stage
 *      as a `partial: true` manifest, never a silent skip.
 *      - field profile: outbox + inbox (the desktop drill verbatim —
 *        cached read models are disposable);
 *      - personal profile: cursors only (the profile has no outbox/inbox
 *        by construction, DR-P22-08b — the cursor positions are its only
 *        sync state worth staging, and even they are reset for the full
 *        re-pull; read models are disposable).
 *   2. CLOSE + DELETE the corrupt file (and its -wal/-shm sidecars).
 *   3. RECREATE the store (full boot: sync-core v1–3 + field v4+ for the
 *      field profile; personal v1+ for the personal profile).
 *   4. RE-IMPORT the staged rows (INSERT OR IGNORE — idempotent).
 *   5. RESET the cursors (full re-pull from seq 0) + maintain the
 *      cursor/inbox checksums (inbox only where an inbox exists) + stamp
 *      `meta.quarantineRecoveryAt` + set `meta.fullPullPending` — the
 *      explicit full-pull flag the host clears after the next successful
 *      cycle.
 *
 * Loud + honest throughout: every unrecoverable step throws the typed
 * `LocalStoreCorruptError` (the sync-core failure surface) — the store
 * NEVER silently continues on a corrupt file. The staging file is kept
 * on disk after the drill for manual salvage.
 *
 * The drill goes through the `SqliteDriverPort` only (never a second
 * copy of store policy); the driver is created by the injectable
 * `driverFactory` (default: the Node driver — tests, the W3 chaos
 * harness; the DEVICE shell passes its own factory over expo-sqlite).
 */

/** The integrity verdict (LOCAL_DATABASE §6.4). */
export interface IntegrityCheckResult {
  readonly ok: boolean;
  /** "ok" when healthy; otherwise the pragma's findings or the
   * SqliteError message ("database disk image is malformed", …). */
  readonly detail: string;
}

/** The staging manifest shape (versioned for forward compatibility). */
export interface StagedSurvivorsManifest {
  readonly version: 1;
  readonly stagedAt: string;
  readonly source: string;
  /** "field" | "personal" — which chain the re-import runs under. */
  readonly profile: MobileStoreProfile;
  /** True when any part of the staged tables was unreadable — the drill
   * proceeds with what WAS readable and says so. */
  readonly partial: boolean;
  readonly outbox: readonly Record<string, unknown>[];
  readonly inbox: readonly Record<string, unknown>[];
  readonly cursors: readonly Record<string, unknown>[];
}

/** The staging summary (`stageSurvivors` result). */
export interface StagedSurvivors {
  readonly file: string;
  readonly partial: boolean;
  readonly outboxRows: number;
  readonly inboxRows: number;
  readonly cursorsRows: number;
  readonly stagedAt: string;
}

/** A bare SQL identifier (the staged column names are interpolated into
 * the re-import INSERTs — validated, never trusted blindly). */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Read every row of one precious table best-effort through a SEPARATE
 * connection: read-write open (a live WAL may need a checkpointing open
 * to recover the -shm — the desktop drill's fallback path is the norm
 * here; the driver port has no readonly mode and none is needed, the
 * staging connection never issues writes). Returns null when the table
 * is unreadable (→ partial staging), rows (possibly []) when ok.
 */
function readSurvivorRows(
  factory: () => SqliteDriverPort,
  path: string,
  table: string,
  key: string | undefined,
): Record<string, unknown>[] | null {
  let driver: SqliteDriverPort | undefined;
  try {
    driver = factory();
    driver.open(path, key); // a corrupt file fails HERE → partial
    return driver.all(`SELECT * FROM ${table}`);
  } catch {
    return null;
  } finally {
    driver?.close();
  }
}

/**
 * Stage the readable precious rows to `<path>.staging` (§6.4 step 1).
 * Read failures degrade to an empty/partial manifest; only a failure to
 * WRITE the manifest throws (LocalStoreCorruptError) — without a staging
 * file the reset would destroy precious pending operations, so the drill
 * must stop loud instead.
 */
export function stageSurvivors(opts: {
  readonly path: string;
  readonly profile: MobileStoreProfile;
  readonly key?: string;
  readonly driverFactory?: () => SqliteDriverPort;
}): StagedSurvivors {
  const factory = opts.driverFactory ?? createNodeDriver;
  const key = opts.key;
  const outbox =
    opts.profile === "field" ? readSurvivorRows(factory, opts.path, "outbox", key) : [];
  const inbox =
    opts.profile === "field" ? readSurvivorRows(factory, opts.path, "inbox", key) : [];
  const cursors = readSurvivorRows(factory, opts.path, "cursors", key);
  // Personal: a missing cursors read is partial (honest); field: the
  // cursors staging is best-effort extra, only outbox/inbox unreadability
  // marks the manifest partial (the desktop semantics).
  const partial =
    opts.profile === "field"
      ? outbox === null || inbox === null
      : outbox === null || inbox === null || cursors === null;
  const manifest: StagedSurvivorsManifest = {
    version: 1,
    stagedAt: new Date().toISOString(),
    source: opts.path,
    profile: opts.profile,
    partial,
    outbox: outbox ?? [],
    inbox: inbox ?? [],
    cursors: cursors ?? [],
  };
  const stagingFile = `${opts.path}.staging`;
  try {
    writeFileSync(stagingFile, JSON.stringify(manifest, null, 2), "utf8");
  } catch (cause) {
    throw new LocalStoreCorruptError(
      `stageSurvivors: cannot write the staging manifest (${stagingFile}) — refusing the ` +
        `§6.4 reset, the precious rows are at stake: ${errorMessage(cause)}`,
    );
  }
  return {
    file: stagingFile,
    partial,
    outboxRows: manifest.outbox.length,
    inboxRows: manifest.inbox.length,
    cursorsRows: manifest.cursors.length,
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
    ((manifest as { profile?: unknown }).profile !== "field" &&
      (manifest as { profile?: unknown }).profile !== "personal") ||
    !Array.isArray((manifest as { outbox?: unknown }).outbox) ||
    !Array.isArray((manifest as { inbox?: unknown }).inbox) ||
    !Array.isArray((manifest as { cursors?: unknown }).cursors)
  ) {
    throw new LocalStoreCorruptError(
      `readStagedSurvivors: staging file is not a valid v1 manifest (${file})`,
    );
  }
  return manifest as StagedSurvivorsManifest;
}

/** Re-import staged rows (INSERT OR IGNORE — replay-safe by primary
 * key). Column names come from the staged DB itself and are identifier-
 * validated before interpolation. */
function importSurvivorRows(
  store: MobileStore,
  table: string,
  rows: readonly Record<string, unknown>[],
): void {
  for (const row of rows) {
    const columns = Object.keys(row).filter((column) => IDENTIFIER_PATTERN.test(column));
    if (columns.length === 0) continue;
    store.run(
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
  /** Which profile's chain the recreation runs (one file, one profile). */
  readonly profile: MobileStoreProfile;
  /** The open store on that path, when boot got that far (closed by the
   * drill; its info guides the recreation). Optional — a file too
   * corrupt to even open goes straight here. */
  readonly store?: MobileStore;
  /** The SecureStore-held encryption key, re-applied on recreation. */
  readonly key?: string;
  /** Driver factory for the staging connection + the recreation
   * (default: the Node driver). */
  readonly driverFactory?: () => SqliteDriverPort;
  /** The integrity failure detail (audit trail, lands in the thrown
   * errors when a step fails). */
  readonly integrityDetail?: string;
}

/** The §6.4 drill outcome (everything the caller + tests assert). */
export interface RecoverCorruptStoreResult {
  /** The fresh, fully migrated, survivors-re-imported store. */
  readonly store: MobileStore;
  readonly stagingFile: string;
  readonly partial: boolean;
  readonly stagedOutbox: number;
  readonly stagedInbox: number;
  readonly stagedCursors: number;
  /** Rows actually landed (INSERT OR IGNORE skips pre-existing ids — on
   * a fresh recreation everything staged lands). */
  readonly reimportedOutbox: number;
  readonly reimportedInbox: number;
  readonly reimportedCursors: number;
  readonly quarantineRecoveryAt: string;
  /** The full-pull flag's value ("true") — the host clears it after the
   * next successful cycle. */
  readonly fullPullPending: "true";
}

/**
 * Run the LOCAL_DATABASE §6.4 corruption drill (stage → delete →
 * recreate → re-import → cursors reset + fullPullPending). Consumes
 * sync-core unmodified (`maintain*` checksum helpers so the next
 * recoveryPass sees a consistent store). Throws LocalStoreCorruptError
 * on every unrecoverable step (staging unwritable, file undeletable,
 * recreation failed, re-import failed) — never a silent continuation.
 */
export function recoverCorruptStore(opts: RecoverCorruptStoreOptions): RecoverCorruptStoreResult {
  if (opts.store !== undefined && opts.store.info.path !== opts.path) {
    throw new Error(
      `recoverCorruptStore: opts.store path (${opts.store.info.path}) does not match opts.path (${opts.path})`,
    );
  }
  if (opts.store !== undefined && opts.store.deviceClass !== (opts.profile === "field" ? "android-field" : "android-personal")) {
    throw new Error(
      `recoverCorruptStore: opts.store class (${opts.store.deviceClass}) does not match opts.profile (${opts.profile})`,
    );
  }

  // 1) STAGE first — while the file still exists and the open store (if
  //    any) keeps the WAL/-shm readable for the staging connection.
  const staged = stageSurvivors({
    path: opts.path,
    profile: opts.profile,
    key: opts.key,
    driverFactory: opts.driverFactory,
  });

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

  // 3) Recreate + the FULL migration chain for the profile.
  let fresh: MobileStore;
  try {
    fresh =
      opts.profile === "field"
        ? openFieldStore(opts.path, { key: opts.key, driver: opts.driverFactory?.() })
        : openPersonalStore(opts.path, { key: opts.key, driver: opts.driverFactory?.() });
  } catch (cause) {
    throw new LocalStoreCorruptError(
      `recoverCorruptStore: store recreation failed (${opts.path}; integrity: ` +
        `${opts.integrityDetail ?? "unknown"}): ${errorMessage(cause)} — staged survivors kept at ${staged.file}`,
    );
  }

  // 4+5) Re-import survivors + reset cursors + maintain checksums + the
  // full-pull flag, ONE transaction (a crash mid-drill leaves a
  // consistent fresh store that re-runs the drill from the staged file).
  const manifest = readStagedSurvivors(staged.file);
  try {
    const reimported = fresh.transaction(() => {
      const outboxBefore = fresh.countRows("outbox");
      const inboxBefore = fresh.countRows("inbox");
      const cursorsBefore = fresh.countRows("cursors");
      importSurvivorRows(fresh, "outbox", manifest.outbox);
      importSurvivorRows(fresh, "inbox", manifest.inbox);
      importSurvivorRows(fresh, "cursors", manifest.cursors);
      // Cursors reset = full re-pull from seq 0 (cached read models are
      // disposable; the feeds repopulate them).
      fresh.run("DELETE FROM cursors");
      maintainCursorCount(fresh); // meta cursorCount = "0"
      if (opts.profile === "field") {
        // The re-imported inbox rows must be covered by the inboxCount
        // checksum or the NEXT recoveryPass would flag a fresh mismatch.
        // (personal has no inbox — nothing to maintain, DR-P22-08b.)
        maintainInboxCount(fresh);
      }
      // The §6.4 path HAS run — a stale quarantine flag (if any file
      // reuse ever carried one) must not wedge the fresh store.
      metaDelete(fresh, "quarantined");
      const quarantineRecoveryAt = new Date().toISOString();
      metaSet(fresh, "quarantineRecoveryAt", quarantineRecoveryAt);
      // The explicit full-pull flag: the next successful cycle clears it
      // (the host does; until then the UI can label the cache "re-pulling").
      metaSet(fresh, "fullPullPending", "true");
      return {
        outbox: fresh.countRows("outbox") - outboxBefore,
        inbox: fresh.countRows("inbox") - inboxBefore,
        cursors: fresh.countRows("cursors") - cursorsBefore,
        quarantineRecoveryAt,
      };
    });
    return {
      store: fresh,
      stagingFile: staged.file,
      partial: staged.partial,
      stagedOutbox: staged.outboxRows,
      stagedInbox: staged.inboxRows,
      stagedCursors: staged.cursorsRows,
      reimportedOutbox: reimported.outbox,
      reimportedInbox: reimported.inbox,
      reimportedCursors: reimported.cursors,
      quarantineRecoveryAt: reimported.quarantineRecoveryAt,
      fullPullPending: "true",
    };
  } catch (cause) {
    fresh.close();
    throw new LocalStoreCorruptError(
      `recoverCorruptStore: survivor re-import failed (${opts.path}): ${errorMessage(cause)} ` +
        `— staged survivors kept at ${staged.file} for manual salvage`,
    );
  }
}

/**
 * `PRAGMA integrity_check` through the store (LOCAL_DATABASE §6.4). A
 * corrupt file can make the PRAGMA ITSELF throw — that throw IS the
 * not-ok verdict (caught, never propagated as an anonymous crash).
 */
export function integrityCheck(store: MobileStore): IntegrityCheckResult {
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
