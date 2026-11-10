import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { integrityCheck, openDesktopStore, type DesktopStore } from "@erp/desktop";

// Direct sync-core source imports (the chaos-matrix.spec.ts convention —
// @erp/sync-core is not an @erp/api dependency; the relative path and
// @erp/desktop's own dependency resolve to the SAME real files).
import { metaSet, type StorageAdapter } from "../../../../../../packages/sync-core/src/store/adapter";
import { recoveryPass } from "../../../../../../packages/sync-core/src/recovery";
import { ReferenceDevice } from "../../../../../../packages/sync-core/src/test-harness/reference-device";
import type { SyncTransport } from "../../../../../../packages/sync-core/src/client";

/**
 * PHASE-021 T13/3-a · the DESKTOP chaos profile device factory (MASTER-
 * PLAN §9 — BINDING; PHASE-021 §6 "full sync chaos matrix against the
 * desktop harness"): constructs the 020 `ReferenceDevice` harness over
 * the REAL `@erp/desktop` SQLite file store — `openDesktopStore` on a
 * temp-dir file (WAL journal, foreign keys, dual-profile DR-P21-02,
 * sync-core migrations v1–3 + desktop migrations v4/v5, meta
 * `deviceClass = "tauri-desktop"` seeded by v5) — so the FULL chaos
 * matrix C-01…C-16 runs against the production device store instead of
 * the in-memory adapter.
 *
 * The harness is constructed, never modified: `ReferenceDevice`'s
 * constructor calls sync-core `applyMigrations` (v1–3), which is
 * idempotent — on this store every version is already recorded, so the
 * call is a no-op and the desktop v4/v5 tables survive untouched. The
 * device class resolves from the v5-seeded meta (exactly the 020
 * contract: "a scenario presets meta BEFORE constructing the device").
 *
 * sync-core itself stays UNMODIFIED (the review blocker): everything
 * here is harness plumbing around `openDesktopStore` +
 * `new ReferenceDevice(store, transport, seed)`.
 */

/** Every temp dir created by this factory — `afterAll(disposeDesktopFiles)`
 * cleans them all (specs may also dispose early). */
const tempDirs: string[] = [];

/** Remove every temp DB file this factory created (spec afterAll). */
export function disposeDesktopFiles(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fresh temp DB file path (registered for disposal). */
function newTempFilePath(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `erp-desktop-chaos-${label}-`));
  tempDirs.push(dir);
  return join(dir, "desktop-store.db");
}

export interface DesktopDeviceOptions {
  /** The injected transport (HarnessTransport over the real API services,
   * or a scripted transport for the kill matrix). */
  readonly transport: SyncTransport;
  /** The scenario seed (logged per test — SYNC_TESTS §9 replayability). */
  readonly seed?: number;
  /** Meta keys preset BEFORE the ReferenceDevice constructor reads them
   * (the C-08 stale-contractVersion preset, for example). Applied on the
   * FIRST build of the file only — a reopen never clobbers runtime meta. */
  readonly presetMeta?: Readonly<Record<string, string>>;
  /** Fault-injection seam (C-16): wraps the REAL store in the adapter the
   * ReferenceDevice programs against. Reads/writes still hit the real
   * file unless the wrapper refuses (the quota-armed SQLITE_FULL shape). */
  readonly wrapAdapter?: (store: DesktopStore) => StorageAdapter;
  /** Store-open passthrough (D-02(a)): the keychain-held dbKey applied to
   * the connection (the DR-P21-02 standard-profile fallback on the stock
   * build — the secret-scan asserts it never reaches the file bytes). */
  readonly storeOptions?: { readonly encryptionKey?: string; readonly profile?: "standard" };
}

/** A reference device over a REAL SQLite file + the file's handle. */
export interface DesktopDevice {
  /** The 020 harness device (capture/cycle/state) over the file store. */
  readonly device: ReferenceDevice;
  /** The REAL desktop store (better-sqlite3, WAL) backing the device —
   * the RAW handle even when `wrapAdapter` guards the device path. */
  readonly store: DesktopStore;
  /** The DB file path on disk. */
  readonly filePath: string;
  /** Close the store, reopen the SAME file, and rebuild the reference
   * device over it — the simulated-crash reboot (C-04 on the file
   * store: the outbox/cursors/state must survive the close/reopen). */
  reopen(): DesktopDevice;
  /** Boot-time recovery pass (IN_FLIGHT → QUEUED + integrity check) —
   * the MASTER-PLAN §3 boot step the host owns; exposed for the crash
   * scenarios to run it EXPLICITLY before any cycle. */
  recover(): ReturnType<typeof recoveryPass>;
  /** Close the handle + delete the temp dir (cheap; afterAll sweeps the
   * rest). */
  dispose(): void;
}

/**
 * Construct a chaos-matrix device over the REAL desktop file store
 * (temp file, WAL, migrations v1–5, deviceClass "tauri-desktop").
 */
export function desktopDevice(options: DesktopDeviceOptions): DesktopDevice {
  const filePath = newTempFilePath("dev");
  let firstBuild = true;
  const build = (): DesktopDevice => {
    const store = openDesktopStore({
      path: filePath,
      ...(options.storeOptions?.encryptionKey !== undefined
        ? { encryptionKey: options.storeOptions.encryptionKey }
        : {}),
      ...(options.storeOptions?.profile !== undefined ? { profile: options.storeOptions.profile } : {}),
    });
    if (firstBuild) {
      for (const [key, value] of Object.entries(options.presetMeta ?? {})) {
        metaSet(store, key, value);
      }
      firstBuild = false;
    }
    const adapter =
      options.wrapAdapter !== undefined ? options.wrapAdapter(store) : store;
    const device = new ReferenceDevice(adapter, options.transport, options.seed ?? 42);
    let disposed = false;
    return {
      device,
      store,
      filePath,
      reopen(): DesktopDevice {
        store.close();
        return build();
      },
      recover(): ReturnType<typeof recoveryPass> {
        return recoveryPass(store);
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        store.close();
        const dir = join(filePath, "..");
        rmSync(dir, { recursive: true, force: true });
        const index = tempDirs.indexOf(dir);
        if (index !== -1) tempDirs.splice(index, 1);
      },
    };
  };
  return build();
}

/** Build the device over an EXISTING file path (the kill matrix's
 * post-SIGKILL reopen + any scenario that owns the file's lifecycle). */
export function desktopDeviceOnFile(
  filePath: string,
  options: Omit<DesktopDeviceOptions, "presetMeta">,
): DesktopDevice {
  const dir = join(filePath, "..");
  if (!tempDirs.includes(dir)) tempDirs.push(dir);
  let firstBuild = true;
  const build = (): DesktopDevice => {
    const store = openDesktopStore({ path: filePath });
    firstBuild = false;
    const adapter =
      options.wrapAdapter !== undefined ? options.wrapAdapter(store) : store;
    const device = new ReferenceDevice(adapter, options.transport, options.seed ?? 42);
    let disposed = false;
    return {
      device,
      store,
      filePath,
      reopen(): DesktopDevice {
        store.close();
        return build();
      },
      recover(): ReturnType<typeof recoveryPass> {
        return recoveryPass(store);
      },
      dispose(): void {
        if (disposed) return;
        disposed = true;
        store.close();
        rmSync(dir, { recursive: true, force: true });
        const index = tempDirs.indexOf(dir);
        if (index !== -1) tempDirs.splice(index, 1);
      },
    };
  };
  void firstBuild;
  return build();
}

/**
 * A bare migrated desktop file store (no harness device) — the D-01/D-02/
 * D-04 file-store scenarios + the kill matrix reopen. Returns the store
 * and its temp path; the afterAll sweep (or `dispose`) cleans up.
 */
export function openBareDesktopFile(label: string): { store: DesktopStore; filePath: string } {
  const filePath = newTempFilePath(label);
  const store = openDesktopStore({ path: filePath });
  return { store, filePath };
}

/** Assert the file is a healthy SQLite store (WAL recovered cleanly —
 * the kill matrix's post-SIGKILL gate). Throws with the findings. */
export function assertFileIntegrity(store: DesktopStore): void {
  const result = integrityCheck(store);
  if (!result.ok) {
    throw new Error(`desktop store integrity_check failed: ${result.detail}`);
  }
}
