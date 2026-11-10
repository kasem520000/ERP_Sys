import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PullEnvelope, PushItemResult } from "@erp/contracts";

// Direct mobile-source imports (the desktop-device.ts convention for
// sync-core: @erp/mobile is NOT an @erp/api dependency — the relative
// path and @erp/mobile's own dependency resolve to the SAME real files
// the app ships). The package BARREL is deliberately NOT imported: it
// re-exports the RN screens (.tsx — JSX is not enabled in the API
// tsconfig), while the store/sync areas consumed here are pure TS.
import {
  openFieldStore,
  openPersonalStore,
  type MobileStore,
  type MobileStoreProfile,
} from "../../../../../../apps/mobile/src/store/store";
import {
  MOBILE_FEED_APPLIERS,
  MOBILE_FIELD_FEED_TYPES,
  MobileSyncHost,
} from "../../../../../../apps/mobile/src/sync/host";
import { integrityCheck as mobileIntegrityCheck } from "../../../../../../apps/mobile/src/store/corruption";

// Direct sync-core source imports (the chaos-matrix.spec.ts convention —
// @erp/sync-core is not an @erp/api dependency; the relative path and
// @erp/desktop's own dependency resolve to the SAME real files).
import { metaSet, type StorageAdapter } from "../../../../../../packages/sync-core/src/store/adapter";
import { recoveryPass } from "../../../../../../packages/sync-core/src/recovery";
import { ReferenceDevice } from "../../../../../../packages/sync-core/src/test-harness/reference-device";
import type { SyncTransport } from "../../../../../../packages/sync-core/src/client";

/**
 * PHASE-022 T-P22-3a · the EXPO chaos profile device factory (MASTER-
 * PLAN §9 — BINDING; SYNC_TESTS §5 device-matrix row "Field-sales phone
 * (Expo Android, PHASE-022)" + §7 PHASE-022 row "Full matrix against
 * Expo/SQLite store"): constructs the 020 `ReferenceDevice` harness over
 * the REAL `@erp/mobile` SQLite store — `openFieldStore` on a temp-dir
 * file through the Node better-sqlite3 driver (WAL journal, foreign
 * keys, sync-core migrations v1–3 + the mobile field migrations v4/v5,
 * meta `deviceClass = "android-field"` seeded by v5) — so the FULL chaos
 * matrix C-01…C-16 runs against the production device store instead of
 * the in-memory adapter.
 *
 * HONEST ENGINE NOTE (MASTER-PLAN §9, recorded): expo-sqlite is the SAME
 * SQLite engine as better-sqlite3 (the driver-port.ts bridging table is
 * the device mapping), so this harness is honest about everything except
 * the CIPHER profile — on-device the store opens with the SecureStore-
 * held SQLCipher key (DR-P22-09; `native/drivers/sqlite.ts`), which the
 * Node driver applies as a documented no-op pragma (the desktop
 * DR-P21-02 caveat). The cipher-profile binary inspection (D-02 on
 * device) is the device-farm/CI leg — recorded as the honest deferral,
 * exactly like PHASE-021's Windows-hardware evidence posture.
 *
 * The harness is constructed, never modified: `ReferenceDevice`'s
 * constructor calls sync-core `applyMigrations` (v1–3), which is
 * idempotent — on this store every version is already recorded, so the
 * call is a no-op and the mobile v4/v5 tables survive untouched. The
 * device class resolves from the v5-seeded meta (exactly the 020
 * contract: "a scenario presets meta BEFORE constructing the device").
 *
 * The PERSONAL profile (`expoPersonalDevice`) deliberately does NOT
 * construct a ReferenceDevice: its constructor runs sync-core
 * `applyMigrations`, which would CREATE the outbox/inbox tables the
 * personal profile forbids by construction (DR-P22-08b — LOCAL_DATABASE
 * §1.1 rule 2). The personal chaos profile therefore drives the REAL
 * `MobileSyncHost` over `openPersonalStore` (pull-only cycles, the
 * hard no-push guard, D-01 revocation, the C-08 gate) — the app's own
 * host IS the harness.
 *
 * sync-core itself stays UNMODIFIED (the review blocker): everything
 * here is harness plumbing around `openFieldStore`/`openPersonalStore`
 * + `new ReferenceDevice(store, transport, seed)` / `new MobileSyncHost`.
 */

/** Every temp dir created by this factory — `afterAll(disposeExpoFiles)`
 * cleans them all (specs may also dispose early). */
const tempDirs: string[] = [];

/** Remove every temp DB file this factory created (spec afterAll). */
export function disposeExpoFiles(): void {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fresh temp DB file path (registered for disposal). */
function newTempFilePath(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `erp-expo-chaos-${label}-`));
  tempDirs.push(dir);
  return join(dir, "expo-store.db");
}

export interface ExpoDeviceOptions {
  /** The injected transport (HarnessTransport over the real API services,
   * or a scripted/fault transport for the kill matrix + fault profiles). */
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
  readonly wrapAdapter?: (store: MobileStore) => StorageAdapter;
  /** Pull-materialization seam (default TRUE — the app's pull path): the
   * transport is wrapped so the 022 field feed entities (van_stocks /
   * routes / settlement_templates / statements) materialize into the
   * mobile tables — ONE version-guarded transaction per pulled page,
   * applied BEFORE the envelope returns to runCycle (which owns the
   * authoritative cursor advance + the POS-subset projection). This is
   * the harness twin of the app's `FieldMaterializingTransport`
   * (sync/host.ts): without it runCycle's fixed `posAppliers` projects
   * the POS subset only and the 022 caches would never fill. Disable for
   * scenarios that drive the raw transport. */
  readonly materialize?: boolean;
  /** The SQLCipher key passthrough (the SecureStore-held dbKey on
   * device). The Node driver applies `PRAGMA key` as a documented no-op
   * on the stock build — see the module header's honest cipher note. */
  readonly key?: string;
}

/** A reference device over a REAL mobile SQLite file + the file's handle. */
export interface ExpoDevice {
  /** The 020 harness device (capture/cycle/state) over the file store. */
  readonly device: ReferenceDevice;
  /** The REAL mobile field store (better-sqlite3, WAL) backing the device
   * — the RAW handle even when `wrapAdapter` guards the device path. */
  readonly store: MobileStore;
  /** The DB file path on disk. */
  readonly filePath: string;
  /** Close the store, reopen the SAME file, and rebuild the reference
   * device over it — the simulated-crash reboot (C-04 on the file
   * store: the outbox/cursors/state must survive the close/reopen). */
  reopen(): ExpoDevice;
  /** Boot-time recovery pass (IN_FLIGHT → QUEUED + integrity check) —
   * the MASTER-PLAN §7 boot step the host owns; exposed for the crash
   * scenarios to run it EXPLICITLY before any cycle. */
  recover(): ReturnType<typeof recoveryPass>;
  /** Close the handle + delete the temp dir (cheap; afterAll sweeps the
   * rest). */
  dispose(): void;
}

/**
 * Construct a chaos-matrix FIELD device over the REAL mobile store
 * (temp file, WAL, sync-core v1–3 + mobile v4/v5, deviceClass
 * "android-field").
 */
export function expoDevice(options: ExpoDeviceOptions): ExpoDevice {
  const filePath = newTempFilePath("field");
  let firstBuild = true;
  const build = (): ExpoDevice => {
    const store = openFieldStore(filePath, options.key === undefined ? undefined : { key: options.key });
    if (firstBuild) {
      for (const [key, value] of Object.entries(options.presetMeta ?? {})) {
        metaSet(store, key, value);
      }
      firstBuild = false;
    }
    const transport =
      options.materialize === false ? options.transport : expoMaterializingTransport(options.transport, store);
    const adapter =
      options.wrapAdapter !== undefined ? options.wrapAdapter(store) : store;
    const device = new ReferenceDevice(adapter, transport, options.seed ?? 42);
    let disposed = false;
    return {
      device,
      store,
      filePath,
      reopen(): ExpoDevice {
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

/** Build the field device over an EXISTING file path (the kill matrix's
 * post-SIGKILL reopen + any scenario that owns the file's lifecycle). */
export function expoDeviceOnFile(
  filePath: string,
  options: Omit<ExpoDeviceOptions, "presetMeta">,
): ExpoDevice {
  const dir = join(filePath, "..");
  if (!tempDirs.includes(dir)) tempDirs.push(dir);
  const build = (): ExpoDevice => {
    const store = openFieldStore(filePath, options.key === undefined ? undefined : { key: options.key });
    const transport =
      options.materialize === false ? options.transport : expoMaterializingTransport(options.transport, store);
    const adapter =
      options.wrapAdapter !== undefined ? options.wrapAdapter(store) : store;
    const device = new ReferenceDevice(adapter, transport, options.seed ?? 42);
    let disposed = false;
    return {
      device,
      store,
      filePath,
      reopen(): ExpoDevice {
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
  return build();
}

/** The personal-profile harness options (the pull-only class — chaos
 * includes ITS profile: pulls only, no outbox, DR-P22-08b). */
export interface ExpoPersonalDeviceOptions {
  /** The injected transport (HarnessTransport over the real API services
   * for the linked-partner scoped pulls). */
  readonly transport: SyncTransport;
  /** The scenario seed (logged per test — SYNC_TESTS §9 replayability). */
  readonly seed?: number;
  /** The memory-session access-token provider — the host's fail-closed
   * pre-cycle check refuses a null token (never an anonymous cycle). */
  readonly accessToken: () => string | null;
  /** C-08: fired ONCE per contract-gate trip (the release-policy UI). */
  readonly onUpdatePrompt?: (reason: "CONTRACT_VERSION_UNSUPPORTED") => void;
  /** D-01: fired when revocation is detected. */
  readonly onRevocation?: (detection: {
    readonly source: "status" | "data-expiry";
    readonly at: string;
    readonly detail?: string;
  }) => void;
}

/** The personal device over a REAL mobile personal store (pull-only). */
export interface ExpoPersonalDevice {
  /** The REAL mobile sync host — pull-only cycles for android-personal
   * (`pushNow()` refuses `{ skipped: "pull-only" }`; the guard transport
   * makes push/pushV2 THROW; the store has no outbox table at all). */
  readonly host: MobileSyncHost;
  /** The REAL personal store (cursors + meta + the four read models —
   * statements/sales_invoices/receipts/notifications — NO outbox/inbox). */
  readonly store: MobileStore;
  readonly filePath: string;
  /** Close the store, reopen the SAME file, rebuild the host. */
  reopen(): ExpoPersonalDevice;
  dispose(): void;
}

/**
 * Construct the PERSONAL chaos device over the REAL mobile personal
 * store (`openPersonalStore` — cursors + meta + read models ONLY, no
 * outbox by construction). The device IS the app's `MobileSyncHost`
 * (android-personal profile): pull-only cycles, the C-08 gate, D-01
 * revocation, the 256 KB background budget arming. The seed is recorded
 * on the harness for the per-scenario log (the host itself is
 * deterministic).
 */
export function expoPersonalDevice(options: ExpoPersonalDeviceOptions): ExpoPersonalDevice {
  const filePath = newTempFilePath("personal");
  void options.seed; // recorded by the caller's log; the host is deterministic
  const build = (): ExpoPersonalDevice => {
    const store = openPersonalStore(filePath);
    const host = new MobileSyncHost({
      store,
      deviceClass: "android-personal",
      transport: options.transport,
      accessToken: options.accessToken,
      onUpdatePrompt: options.onUpdatePrompt,
      onRevocation: options.onRevocation,
    });
    let disposed = false;
    return {
      host,
      store,
      filePath,
      reopen(): ExpoPersonalDevice {
        store.close();
        return build();
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

/**
 * A bare migrated mobile file store (no harness device) — the D-01/D-02/
 * D-04 store scenarios + the kill matrix reopen. Returns the store and
 * its temp path; the afterAll sweep (or `dispose` via the caller) cleans
 * up. The profile picks the migration chain (`field` = sync-core v1–3 +
 * mobile v4/v5; `personal` = the pull-only chain).
 */
export function openBareExpoFile(
  label: string,
  profile: MobileStoreProfile = "field",
): { store: MobileStore; filePath: string } {
  const filePath = newTempFilePath(label);
  const store = profile === "field" ? openFieldStore(filePath) : openPersonalStore(filePath);
  return { store, filePath };
}

/** Assert the file is a healthy mobile store (WAL recovered cleanly —
 * the kill matrix's post-SIGKILL gate; the §6.4 integrity verdict). */
export function assertExpoFileIntegrity(store: MobileStore): void {
  const result = mobileIntegrityCheck(store);
  if (!result.ok) {
    throw new Error(`mobile store integrity_check failed: ${result.detail}`);
  }
}

// -- the pull-materialization seam (the app's FieldMaterializingTransport twin) ----

/**
 * The harness twin of the app's `FieldMaterializingTransport`
 * (apps/mobile/src/sync/host.ts): observes nothing, guards nothing —
 * it materializes the 022 field feed types' pulled pages into the REAL
 * mobile store, ONE version-guarded transaction per page, applied
 * BEFORE the envelope returns to runCycle (which owns the authoritative
 * cursor advance + the POS-subset projection; a crash between the two
 * re-pulls the page, which is idempotent by primary key — the same
 * LOCAL_DATABASE §2 design the app ships). Every other call delegates
 * to the inner transport untouched (inner call counters stay
 * meaningful).
 */
export function expoMaterializingTransport(inner: SyncTransport, store: MobileStore): SyncTransport {
  const materializeTypes = new Set<string>(MOBILE_FIELD_FEED_TYPES);
  const transport: SyncTransport = {
    async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
      const envelope = await inner.pull(entityType, cursor, limit);
      if (materializeTypes.has(entityType) && envelope.changes.length > 0) {
        store.transaction(() => {
          for (const change of envelope.changes) {
            if (change.op === "DELETE") {
              MOBILE_FEED_APPLIERS.remove(store, entityType, change.id);
              continue;
            }
            if (change.payload === null) continue;
            const version = change.version ?? null;
            if (version !== null) {
              const local = MOBILE_FEED_APPLIERS.readVersion(store, entityType, change.id);
              if (local !== null && version <= local) continue; // stale — skip
            }
            MOBILE_FEED_APPLIERS.upsert(store, entityType, change.payload, version);
          }
        });
      }
      return envelope;
    },
    async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
      return inner.push(batchId, commands);
    },
  };
  // Optional members copy the INNER transport's presence (their presence
  // drives runCycle's v2 mode) — the app wrapper's exact rule.
  if (inner.status !== undefined) {
    transport.status = async () => inner.status!();
  }
  if (inner.pushV2 !== undefined) {
    transport.pushV2 = async (request: {
      contractVersion: string;
      commands: readonly Record<string, unknown>[];
    }) => inner.pushV2!(request);
  }
  if (inner.pullAck !== undefined) {
    transport.pullAck = async (positions: readonly { entityType: string; cursor: string }[]) =>
      inner.pullAck!(positions);
  }
  if (inner.pushAck !== undefined) {
    transport.pushAck = async (commandIds: readonly string[]) => inner.pushAck!(commandIds);
  }
  return transport;
}
