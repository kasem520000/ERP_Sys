import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { superuserClient } from "../../test-db";
import { closeDb } from "../../../infra/db/client";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { writePermissionWatermark } from "../../../../../../packages/sync-core/src/store/pull";
import { metaGet } from "../../../../../../packages/sync-core/src/store/adapter";
import { SyncReadOnlyError } from "../../../../../../packages/sync-core/src/errors";
import { seededRandom } from "../../../../../../packages/sync-core/src/test-harness/chaos";
import type { MobileStore } from "../../../../../../apps/mobile/src/store/store";
import { openFieldStore } from "../../../../../../apps/mobile/src/store/store";
import { pruneMobileStore, mobileStoreBytes } from "../../../../../../apps/mobile/src/store/prune";
import {
  purgeOnRevocation,
  revocationPurgedTables,
} from "../../../../../../apps/mobile/src/sync/revocation";
import { MobileSyncHost } from "../../../../../../apps/mobile/src/sync/host";
import { MemorySecureStore, secureStoreNames } from "../../../../../../apps/mobile/src/auth/secure-store-port";
import {
  canWriteOffline,
  offlineWritePolicy,
  permissionWatermarkState,
} from "../../../../../../apps/mobile/src/device/watermark";
import type { SqliteDriverPort } from "../../../../../../apps/mobile/src/store/driver-port";
import { createNodeDriver } from "../../../../../../apps/mobile/src/store/node-driver";

import {
  enrollDevice,
  HarnessTransport,
  makeSyncServices,
  seedPosWorld,
  type PosWorld,
} from "../_oracle";
import { assertExpoFileIntegrity, disposeExpoFiles, expoDevice, expoPersonalDevice } from "./expo-device";

/**
 * PHASE-022 T-P22-3a · D-01 / D-02 / D-04 + the 128 MB prune-budget drill
 * on the REAL mobile store (MASTER-PLAN §9 — BINDING; DR-P22-08/08b/09 +
 * the §0 golden constant "Storage budget 128 MB LRU, byte-exact dbstat
 * accounting"; SECURITY_AND_DEVICE_MANAGEMENT §6.2):
 *
 * - **D-01**: a revoked device drives the REAL MobileSyncHost to its
 *   terminal "revoked" phase (the `onRevocation` hook — the shell's purge
 *   trigger), `purgeOnRevocation` runs against the REAL SQLite file
 *   (BOTH profiles — the field store's business/outbox/cursors AND the
 *   personal read models), and the FILE itself is binary-grepped for
 *   seeded tenant markers before/after (checkpoint + VACUUM — the
 *   desktop posture: plain DELETE alone leaves SQLite freelist pages; the
 *   production cipher profile bounds that residue by encryption-at-rest,
 *   the documented accepted risk, on-device only).
 * - **D-02 (a)**: the INVARIANT secret-scan — SecureStore-held secrets
 *   (refresh token, device key, the store's db key, the memory-only
 *   access token) seeded through the REAL flows (MemorySecureStore + the
 *   store's PRAGMA-key open + real cycles) NEVER appear in the DB file
 *   bytes. **D-02 (b)**: the HONEST CIPHER NOTE — the Node driver is the
 *   same SQLite engine with `PRAGMA key` as a documented no-op (the
 *   desktop DR-P21-02 caveat): the file is readable plaintext in-sim and
 *   the SQLCipher cipher inspection is the DEVICE-farm/CI leg (recorded
 *   deferral — expo-sqlite + SecureStore key, DR-P22-09).
 * - **D-04**: the permission snapshot pulled from the REAL feed into the
 *   mobile store → the 2-b watermark policy (fresh ≤ 7 d, writable +
 *   offline queueing); 7 d + 1 h → read-only + ONLINE-REQUIRED-FOR-WRITES
 *   (the UI policy degrades, the engine's assertWritable refuses captures
 *   LOUD, nothing half-captured); a REAL role change re-pulls a fresh
 *   snapshot → writable restored. The two-layer boundary is asserted
 *   honestly: the engine's 016-compat treats a never-pulled store
 *   ("permissionSnapshotAt" = "0") as not-tracked/writable while the UI
 *   policy reads NO_SNAPSHOT (2-b's documented stricter view).
 * - **The 128 MB prune drill**: byte-exact `dbstat` accounting under a
 *   tiny budget (LRU batches, dirty rows never pruned, write-set rows
 *   only in SYNCED, machinery never touched) AND under fault — a
 *   DELETE-refusing driver (the storage-fault seam) makes the post-cycle
 *   prune fail honestly (recorded, the cycle outcome unaffected, the
 *   store intact), then the armed-off pass converges under budget.
 *
 * Dedicated tenant EXD (the same golden-constant family as TENANT_EXPO —
 * verified unused across migrations + specs before use). Seeded RNG per
 * scenario (SYNC_TESTS §9).
 */

const TENANT_D = "7e5d00dd-0022-4000-8000-0000000000dd";
const OWNER = "7e5d00dd-0022-4000-8000-0000000000d1";
const CASHIER = "7e5d00dd-0022-4000-8000-0000000000d2";
const REP = "7e5d00dd-0022-4000-8000-0000000000d3";

const services = makeSyncServices();
let world: PosWorld;

/** Extra temp dirs created outside the factory (the prune drill owns its
 * driver + file) — swept in afterAll alongside the factory's dirs. */
const extraTempDirs: string[] = [];

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_D,
    name: "Tenant Expo D-Suite (P22 3a)",
    nameAr: "مستأجر أمن الجوال",
    prefix: "EXD",
    actor: OWNER,
    cashier: CASHIER,
    salesRep: REP,
  });
});

afterAll(async () => {
  disposeExpoFiles();
  for (const dir of extraTempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  await closeDb();
});

/** A captured field-collection reference (the write-set binary marker). */
function receiptPayloadOf(reference: string) {
  return {
    partnerId: world.customerId,
    cashAccountId: world.cashAccountId,
    method: "CASH" as const,
    currencyCode: "SAR",
    amount: "10.0000",
    valueDate: "2026-03-24",
    reference,
  };
}

/** The store file's bytes + the WAL's bytes (post-checkpoint the WAL is
 * truncated to zero — both are the binary-inspection surface). */
function fileAndWalBytes(filePath: string): { file: Buffer; wal: Buffer } {
  return {
    file: readFileSync(filePath),
    wal: existsSync(`${filePath}-wal`) ? readFileSync(`${filePath}-wal`) : Buffer.alloc(0),
  };
}

/** Checkpoint the WAL into the main file (every committed byte in one
 * place — the pre/post binary-inspection gate). */
function checkpoint(store: MobileStore): void {
  store.run("PRAGMA wal_checkpoint(TRUNCATE)");
}

/**
 * The storage-fault driver seam (the prune-under-fault drill): wraps the
 * REAL node driver and refuses DELETEs on BUSINESS tables while armed —
 * the honest "the cache partition refuses maintenance writes" shape (a
 * quota'd / failing flash cell). Machinery deletes (meta/cursors/outbox/
 * inbox — the cycle's own bookkeeping) pass through; everything else
 * delegates untouched.
 */
const MACHINERY_DELETE_TARGETS = /^(\s*DELETE\s+FROM\s+(meta|cursors|outbox|inbox))\b/i;

function createBusinessDeleteRefusingDriver(): SqliteDriverPort & { refuseDeletes: boolean } {
  const inner = createNodeDriver();
  const wrapper = {
    refuseDeletes: false,
    open(path: string, key?: string): void {
      inner.open(path, key);
    },
    close(): void {
      inner.close();
    },
    get isOpen(): boolean {
      return inner.isOpen;
    },
    run(sqlText: string, params?: readonly unknown[]): void {
      if (wrapper.refuseDeletes && /^\s*DELETE/i.test(sqlText) && !MACHINERY_DELETE_TARGETS.test(sqlText)) {
        throw new Error("simulated storage fault — DELETE refused (read-only medium)");
      }
      inner.run(sqlText, params);
    },
    all(sqlText: string, params?: readonly unknown[]) {
      return inner.all(sqlText, params);
    },
    get(sqlText: string, params?: readonly unknown[]) {
      return inner.get(sqlText, params);
    },
    transaction<T>(fn: () => T): T {
      return inner.transaction(fn);
    },
    pragma(stmt: string): unknown {
      return inner.pragma(stmt);
    },
    tableBytes(table: string): number {
      return inner.tableBytes(table);
    },
    get byteMeasurement() {
      return inner.byteMeasurement;
    },
    integrityCheck() {
      return inner.integrityCheck();
    },
  };
  return wrapper;
}

describe("PHASE-022 D-01/D-02/D-04 + the 128 MB prune drill on the mobile store (MASTER-PLAN §9; DR-P22-08/09)", () => {
  it("D-01 revocation on the EXPO store: host phase revoked + onRevocation → purgeOnRevocation empties the field store's business/outbox/cursors — and the FILE no longer contains the tenant row data (binary grep); the personal read models purge the same way", async () => {
    const seed = 0xdd1;
    console.log(`[D-01/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });
    const reference = ed.device;

    // Seed the device with REAL tenant data across every family:
    // (1) server-side rows the device PULLS into its caches (an item +
    //     the van-world-free statements cache seeded through the store
    //     adapter — the desktop draft_docs precedent: the read cache's
    //     only writer besides the feed),
    const pulledMarker = `D01-PULLED-ITEM-${generateUuidV7().slice(0, 8)}`;
    const pulledItemId = await withTenant(TENANT_D, async () => {
      const itemsStore = await import("../../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `EXD-D01-${(seededRandom(seed)() * 1e6) | 0}`,
        name: pulledMarker,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "10.000000",
      });
      return inserted.id;
    });
    await reference.client.pullAll();
    expect(ed.store.get("SELECT * FROM items WHERE id = ?", [pulledItemId])).toBeDefined();
    const statementMarker = `D01-STATEMENT-${generateUuidV7().slice(0, 8)}`;
    ed.store.run(
      `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
         opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload,
         version, updated_at, dirty)
       VALUES (?, 'EXD-CUST-01', ?, NULL, '2026-03-24', 'SAR', '0.0000', '0.0000', '0.0000', '{}', '[]',
         '2026-03-24T00:00:00Z', ?, NULL, '2026-03-24T00:00:00Z', 0)`,
      [world.customerId, statementMarker, JSON.stringify({ marker: statementMarker })],
    );

    // (2) one ACKED collection + one mid-queue collection (the references
    //     are the binary markers of the write set + the outbox),
    const acked = reference.capture({
      entityType: "receipt",
      intent: "create_field_collection",
      payload: receiptPayloadOf("OFF-EXD01-00001"),
      idempotencyKey: "expo-d01-receipt-1",
    });
    void acked;
    const ackedOutcome = await reference.cycle();
    expect(ackedOutcome.accepted).toBe(1);
    const queued = reference.capture({
      entityType: "receipt",
      intent: "create_field_collection",
      payload: receiptPayloadOf("OFF-EXD01-00002"),
      idempotencyKey: "expo-d01-receipt-2",
    });
    reference.markInFlight([queued]); // mid-queue when revocation lands
    ed.store.run("UPDATE meta SET value = ? WHERE key = 'enrolledDeviceId'", [deviceId]);

    // BEFORE the purge: every tenant marker is honestly IN the file bytes
    // (checkpoint first so the committed WAL frames land in the main file).
    checkpoint(ed.store);
    const before = fileAndWalBytes(ed.filePath);
    const markers = {
      pulledItem: pulledMarker,
      statement: statementMarker,
      offAcked: "OFF-EXD01-00001",
      offQueued: "OFF-EXD01-00002",
    };
    for (const [name, marker] of Object.entries(markers)) {
      expect(
        before.file.includes(Buffer.from(marker)) || before.wal.includes(Buffer.from(marker)),
        `pre-purge: the ${name} marker must be present in the file bytes`,
      ).toBe(true);
    }

    // Revoke the device server-side, then drive the REAL host: the cycle
    // surfaces deviceRevoked → phase "revoked" + the onRevocation hook
    // (the shell's purge trigger), queue marked unresolvable.
    const revocations: { source: string; at: string }[] = [];
    const host = new MobileSyncHost({
      store: ed.store,
      deviceClass: "android-field",
      transport,
      accessToken: () => "expo-d01-access-token",
      onRevocation: (detection) => revocations.push({ source: detection.source, at: detection.at }),
    });
    await withTenant(TENANT_D, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`UPDATE devices SET revoked_at = now() WHERE id = ${deviceId}::uuid`);
    });
    const outcome = await host.syncNow();
    expect(outcome.outcome!.deviceRevoked).toBe(true);
    expect(host.state.phase).toBe("revoked");
    expect(revocations).toEqual([{ source: "status", at: expect.any(String) }]);
    expect(metaGet(ed.store, "queueUnresolvable")).toBe("DEVICE_REVOKED");
    // A revoked host refuses further cycles (D-01 terminal state).
    const refused = await host.syncNow();
    expect(refused).toMatchObject({ skipped: "revoked" });

    // The shell's purge: purgeOnRevocation on the REAL field file —
    // honest per-table counts, every purged table at zero.
    const report = purgeOnRevocation(ed.store);
    expect(report.tables).toMatchObject({
      items: expect.any(Number),
      van_stocks: 0, // no van world in this tenant — honest zero
      statements: 1,
      outbox: 2,
      inbox: 1, // the ACKED command's local mirror (the queued one never pushed)
      cursors: expect.any(Number),
    });
    expect(report.tables["items"]).toBeGreaterThan(0);
    expect(report.tables["cursors"]).toBeGreaterThan(0);
    for (const table of revocationPurgedTables("android-field")) {
      expect(ed.store.countRows(table)).toBe(0);
    }
    expect(report.metaKeysDeleted).toEqual(
      expect.arrayContaining(["enrolledDeviceId", "permissionSnapshotAt", "queueUnresolvable"]),
    );

    // THE FILE-LEVEL PURGE COMPLETION (the desktop posture): plain DELETE
    // leaves freed pages in the SQLite freelist until compaction, and the
    // production cipher profile (DR-P22-09, on-device) bounds that residue
    // by encryption-at-rest (the documented accepted risk). The purge
    // completes at the file level with SQLite's own compaction — then the
    // binary grep must find NO tenant row data anywhere in the file bytes.
    ed.store.run("VACUUM");
    checkpoint(ed.store);
    const after = fileAndWalBytes(ed.filePath);
    for (const [name, marker] of Object.entries(markers)) {
      expect(
        after.file.includes(Buffer.from(marker)) || after.wal.includes(Buffer.from(marker)),
        `post-purge: the ${name} marker must be GONE from the file bytes`,
      ).toBe(false);
    }
    // The store remains healthy for re-enrollment: migrations intact, no
    // stale quarantine, the queue flag cleared by the purge.
    expect(metaGet(ed.store, "quarantined")).toBeNull();
    const reopened = ed.reopen();
    expect(reopened.store.all("SELECT version FROM schema_migrations")).toHaveLength(5);
    assertExpoFileIntegrity(reopened.store);
    reopened.dispose();

    // THE PERSONAL CLASS (the "incl. the personal read models" rule): the
    // linked personal device's D-01 is the same journey over the pull-only
    // store — revoke → the host's revoked phase → the purge empties the
    // read models + cursors (there IS no outbox — honest zeros).
    const personalDeviceId = await enrollDevice(TENANT_D, OWNER, {
      deviceClass: "android-personal",
      linkedPartnerId: world.customerId,
    });
    const personalTransport = new HarnessTransport({
      tenant: TENANT_D,
      deviceId: personalDeviceId,
      push: services.push,
    });
    const pd = expoPersonalDevice({
      transport: personalTransport,
      seed,
      accessToken: () => "expo-d01-personal-token",
    });
    const personalCycle = await pd.host.syncNow();
    expect(personalCycle.outcome!.pulled).toBeGreaterThan(0);
    expect(pd.store.all("SELECT * FROM receipts").length).toBeGreaterThanOrEqual(1); // the ACKED collection above
    await withTenant(TENANT_D, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`UPDATE devices SET revoked_at = now() WHERE id = ${personalDeviceId}::uuid`);
    });
    const personalRevocations: string[] = [];
    const personalHost = new MobileSyncHost({
      store: pd.store,
      deviceClass: "android-personal",
      transport: personalTransport,
      accessToken: () => "expo-d01-personal-token",
      onRevocation: (detection) => personalRevocations.push(detection.source),
    });
    const personalOutcome = await personalHost.syncNow();
    expect(personalOutcome.outcome!.deviceRevoked).toBe(true);
    expect(personalHost.state.phase).toBe("revoked");
    expect(personalRevocations).toEqual(["status"]);
    const personalReport = purgeOnRevocation(pd.store);
    expect(personalReport.tables).toMatchObject({
      statements: expect.any(Number),
      sales_invoices: expect.any(Number),
      receipts: expect.any(Number),
      notifications: 0,
      cursors: expect.any(Number),
    });
    expect(personalReport.tables["receipts"]).toBeGreaterThanOrEqual(1);
    expect(personalReport.metaKeysDeleted).not.toContain("queueUnresolvable"); // never existed — no queue
    for (const table of revocationPurgedTables("android-personal")) {
      expect(pd.store.countRows(table)).toBe(0);
    }
    // The re-login requirement: the identity meta is gone on both profiles.
    expect(metaGet(pd.store, "enrolledDeviceId")).toBeNull();
    pd.dispose();
  });

  it("D-02(a) secret-scan on the REAL file: SecureStore-held secrets seeded through the real flows NEVER appear in the DB bytes; D-02(b) the honest cipher note — the node build is plain SQLite (the cipher inspection is the device-farm leg)", async () => {
    const seed = 0xdd2;
    console.log(`[D-02/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });

    // The secret classes, seeded through the REAL 2-b flows: the vault
    // (MemorySecureStore — the SecureStorePort test double), the store's
    // dbKey applied at open (the node driver's documented no-op pragma),
    // and the memory-only access token the host carries.
    const secureStore = new MemorySecureStore();
    const names = secureStoreNames(deviceId);
    const refreshToken = `D02-REFRESH-SECRET-${generateUuidV7()}`;
    const deviceKey = `D02-DEVICEKEY-SECRET-${generateUuidV7()}`;
    const dbKey = `D02-DBKEY-SECRET-${generateUuidV7()}`;
    await secureStore.setItem(names.refreshToken, refreshToken);
    await secureStore.setItem(names.deviceKey, deviceKey);
    await secureStore.setItem(names.dbKey, dbKey);
    const accessToken = `D02-ACCESS-SECRET-${generateUuidV7()}`;

    // (1) the device's store opens with the vault's dbKey applied via the
    //     key option (the node driver's PRAGMA-key no-op caveat — the key
    //     must reach the FILE through no other path),
    const ed = expoDevice({ transport, seed, key: dbKey });

    // (2) the device runs real cycles under the REAL host (the access
    //     token is memory-only by design) + a queued command — every
    //     table family carries live data when the scan runs.
    const host = new MobileSyncHost({
      store: ed.store,
      deviceClass: "android-field",
      transport,
      accessToken: () => accessToken,
    });
    const commandId = ed.device.capture({
      entityType: "receipt",
      intent: "create_field_collection",
      payload: receiptPayloadOf("OFF-EXD02A-00001"),
      idempotencyKey: "expo-d02-receipt-1",
    });
    const cycle = await host.syncNow();
    expect(cycle.outcome!.accepted).toBe(1);
    ed.device.capture({
      entityType: "receipt",
      intent: "create_field_collection",
      payload: receiptPayloadOf("OFF-EXD02A-00002"),
      idempotencyKey: "expo-d02-receipt-2",
    });

    // THE SCAN (a): none of the secret material appears in the file bytes
    // (main file or WAL) after the real flows ran through them.
    const bytes = fileAndWalBytes(ed.filePath);
    for (const secret of [refreshToken, deviceKey, dbKey, accessToken, names.refreshToken]) {
      expect(
        bytes.file.includes(Buffer.from(secret)) || bytes.wal.includes(Buffer.from(secret)),
        "secret-scan: SecureStore/session key material must NEVER reach the DB file bytes",
      ).toBe(false);
    }
    // The honest control: the store DID capture the business data (the
    // scan is meaningful — the file is not empty).
    checkpoint(ed.store);
    const control = fileAndWalBytes(ed.filePath);
    expect(control.file.includes(Buffer.from("OFF-EXD02A-00001"))).toBe(true);
    expect(String(ed.store.get("SELECT status FROM outbox WHERE command_id = ?", [commandId])?.status)).toBe(
      "ACKED",
    );

    // THE HONEST CIPHER NOTE (b): the node build's file IS readable
    // plaintext SQLite (the engine is the same; `PRAGMA key` is a no-op —
    // no fake at-rest-encryption claim), while every OTHER key-management
    // invariant holds ((a) above). The REAL cipher inspection — the file
    // unreadable without the SecureStore key — runs on the DEVICE profile
    // (expo-sqlite + SQLCipher, DR-P22-09) in the device farm/CI; that is
    // the recorded honest deferral, exactly like PHASE-021's
    // Windows-hardware SQLCipher evidence posture.
    expect(control.file.subarray(0, 15).toString("latin1")).toBe("SQLite format 3");
    expect(ed.store.info.byteMeasurement).toBe("dbstat"); // the exact engine measurement
    ed.dispose();
  });

  it("D-04 on the EXPO store: the REAL permissions snapshot makes the policy writable; 7d+1h degrades to read-only + online-required (the engine refuses captures LOUD, nothing half-captured); a REAL role change restores writability; the two-layer no-snapshot boundary is asserted honestly", async () => {
    const seed = 0xdd4;
    console.log(`[D-04/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });
    const ed = expoDevice({ transport, seed });

    // (0) A never-pulled store: the v5 seed leaves permissionSnapshotAt
    //     "0" — the ENGINE (sync-core assertWritable, 016 compat) treats
    //     it as not-tracked → writable, while the mobile UI POLICY (2-b)
    //     reads NO_SNAPSHOT → read-only + online-required. Both layers
    //     asserted honestly — the documented two-view difference.
    expect(metaGet(ed.store, "permissionSnapshotAt")).toBe("0");
    const noSnapshot = permissionWatermarkState(ed.store);
    expect(noSnapshot).toMatchObject({ mode: "stale", reason: "NO_SNAPSHOT", asOf: null });
    expect(offlineWritePolicy(noSnapshot)).toMatchObject({
      mode: "read-only",
      localWriteCaching: false,
      onlineRequiredForWrites: true,
      reason: "NO_SNAPSHOT",
    });
    const captureBeforePull = ed.device.capture({
      entityType: "receipt",
      intent: "create_field_collection",
      payload: receiptPayloadOf("OFF-EXD04-00000"),
      idempotencyKey: "expo-d04-receipt-0",
    }); // the ENGINE allows it (not tracked ≠ stale, 016 compat)
    expect(String(outboxStatus(ed.store, captureBeforePull))).toBe("QUEUED");
    ed.store.run("DELETE FROM outbox"); // the probe never drains — reset

    // (1) Pull the REAL permissions feed (the pull service's per-user
    //     snapshot) into the mobile store through the mobile applier —
    //     the watermark lands in the FILE.
    const snapshotPage = await transport.pull("permissions", null);
    expect(snapshotPage.changes.length).toBeGreaterThan(0);
    for (const change of snapshotPage.changes) {
      expect(change.payload).not.toBeNull();
      ed.store.transaction(() => {
        // The mobile applier's permissions case (MOBILE_FEED_APPLIERS is
        // the app's; the watermark write is the sync-core primitive it
        // delegates to — driven here through the same seam).
        writePermissionWatermark(ed.store, (change.payload as { snapshotAt: string }).snapshotAt);
      });
    }
    const parkedCursor = snapshotPage.nextCursor ?? snapshotPage.cursor;
    const fresh = permissionWatermarkState(ed.store);
    expect(fresh.mode).toBe("fresh");
    expect(fresh.asOf).not.toBeNull();
    const freshPolicy = offlineWritePolicy(fresh);
    expect(freshPolicy).toMatchObject({ mode: "writable", localWriteCaching: true, onlineRequiredForWrites: false });
    expect(canWriteOffline(freshPolicy, false)).toBe(true);
    // The boundary: EXACTLY 7 days is still fresh (the `> 7` rule).
    writePermissionWatermark(ed.store, new Date(Date.now() - 7 * 86_400_000).toISOString());
    expect(permissionWatermarkState(ed.store).mode).toBe("fresh");

    // (2) Age the watermark 7 days + 1 hour: the policy degrades to
    //     read-only + online-required-for-writes and the ENGINE's capture
    //     gate throws LOUD (D-04) — nothing half-captured.
    const aged = new Date(Date.now() - (7 * 86_400_000 + 3_600_000)).toISOString();
    writePermissionWatermark(ed.store, aged);
    const stale = permissionWatermarkState(ed.store);
    expect(stale).toMatchObject({ mode: "stale", reason: "SNAPSHOT_EXPIRED" });
    const stalePolicy = offlineWritePolicy(stale);
    expect(stalePolicy).toMatchObject({
      mode: "read-only",
      localWriteCaching: false,
      onlineRequiredForWrites: true,
      reason: "SNAPSHOT_EXPIRED",
    });
    expect(canWriteOffline(stalePolicy, false)).toBe(false); // offline writes refused
    expect(canWriteOffline(stalePolicy, true)).toBe(true); // online writes go live (§5.3)
    expect(() =>
      ed.device.capture({
        entityType: "receipt",
        intent: "create_field_collection",
        payload: receiptPayloadOf("OFF-EXD04-00001"),
        idempotencyKey: "expo-d04-receipt-1",
      }),
    ).toThrow(SyncReadOnlyError);
    // Nothing was captured — the refusal rolled back whole.
    expect(ed.store.all("SELECT * FROM outbox")).toHaveLength(0);

    // (3) A REAL permission change (one role grant removed server-side):
    //     the snapshot catch-up serves a fresh row from the parked cursor,
    //     the watermark restores writability with the UPDATED key set.
    const su = await superuserClient();
    await su.query(
      `DELETE FROM role_permissions WHERE ctid IN (
         SELECT rp.ctid FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         WHERE r.tenant_id = $1 AND r.key LIKE 'exd%'
         LIMIT 1
       )`,
      [TENANT_D],
    );
    await su.end();
    const refreshed = await transport.pull("permissions", parkedCursor);
    expect(refreshed.changes.length).toBeGreaterThan(0);
    for (const change of refreshed.changes) {
      ed.store.transaction(() => {
        writePermissionWatermark(ed.store, (change.payload as { snapshotAt: string }).snapshotAt);
      });
    }
    expect(permissionWatermarkState(ed.store).mode).toBe("fresh");
    expect(offlineWritePolicy(permissionWatermarkState(ed.store)).mode).toBe("writable");
    const restoredCapture = ed.device.capture({
      entityType: "receipt",
      intent: "create_field_collection",
      payload: receiptPayloadOf("OFF-EXD04-00002"),
      idempotencyKey: "expo-d04-receipt-2",
    });
    expect(ed.store.all("SELECT * FROM outbox")).toHaveLength(1);
    expect(String(outboxStatus(ed.store, restoredCapture))).toBe("QUEUED");
    ed.dispose();
  });

  it("the 128 MB prune-budget drill: byte-exact dbstat accounting under a tiny budget (LRU batches, dirty + non-SYNCED rows never pruned, machinery untouched) AND under the DELETE-refusing storage fault (the host records the prune failure, the cycle outcome is unaffected, the store converges once the fault clears)", async () => {
    const seed = 0xdd5;
    const rng = seededRandom(seed);
    console.log(`[D-128MB/expo] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, REP, { deviceClass: "android-field" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });

    // The fault-seam driver: refuses business-table DELETEs while armed
    // (the storage fault), delegates everything else to the REAL driver.
    const driver = createBusinessDeleteRefusingDriver();
    const dir = mkdtempSync(join(tmpdir(), "erp-expo-prune-"));
    extraTempDirs.push(dir);
    const store = openFieldStore(join(dir, "prune.db"), { driver });

    // Seed the cache: 240 statements rows (~1.6 KB payloads each — the
    // read-cache bulk), 40 dirty (never pruned), plus the write set in
    // every honest state (only SYNCED is prunable) + pulled items.
    for (let n = 1; n <= 240; n += 1) {
      const dirty = n <= 40 ? 1 : 0;
      const stamp = new Date(Date.now() - (240 - n) * 60_000).toISOString(); // LRU order: n asc = oldest
      store.run(
        `INSERT INTO statements (id, customer_code, customer_name, customer_name_ar, as_of, currency_code,
           opening_balance, closing_balance, closing_balance_base, aging, entries, generated_at, payload,
           version, updated_at, dirty)
         VALUES (?, ?, ?, NULL, '2026-03-24', 'SAR', '0.0000', '0.0000', '0.0000', '{}', '[]', ?, ?, 1, ?, ?)`,
        [
          `d128-statement-${n}`,
          `EXD-${String(n).padStart(4, "0")}`,
          `Statement row ${n}`,
          stamp,
          JSON.stringify({ n, filler: `x`.repeat(1600), r: rng() }),
          stamp,
          dirty,
        ],
      );
    }
    for (let n = 1; n <= 6; n += 1) {
      const status = n <= 2 ? "SYNCED" : n <= 4 ? "REJECTED" : "PENDING_SYNC"; // only SYNCED prunable
      store.run(
        `INSERT INTO pos_sales (id, offline_receipt_no, terminal_id, customer_id, order_type,
           invoice_date, total_gross, tenders, lines, local_status, official_no, synced_at, created_at)
         VALUES (?, ?, '00000000-0000-0000-0000-000000000000', NULL, 'COUNTER', '2026-03-24',
           '115.0000', '[]', '[]', ?, NULL, ?, '2026-03-24T08:00:00Z')`,
        [
          `d128-sale-${n}`,
          `OFF-D128-${String(n).padStart(5, "0")}`,
          status,
          status === "SYNCED" ? new Date(Date.now() - n * 60_000).toISOString() : null,
        ],
      );
    }

    // Byte-exact accounting: the measured footprint is dbstat-exact on
    // this build, and the prune math ties to the byte.
    expect(store.info.byteMeasurement).toBe("dbstat");
    const seededBytes = mobileStoreBytes(store);
    expect(seededBytes).toBeGreaterThan(0);

    // UNDER FAULT: the business-DELETE-refusing driver + the REAL host with
    // a tiny prune budget — the post-cycle prune FAILS, is recorded
    // honestly, and NEVER fails the cycle (the business tables keep every
    // row; the cycle's own machinery bookkeeping is not part of the fault).
    driver.refuseDeletes = true;
    const host = new MobileSyncHost({
      store,
      deviceClass: "android-field",
      transport,
      accessToken: () => "expo-d128-access-token",
      // A byte budget below the seeded bulk — integer truncation via |0
      // (the repo's established idiom; Math.floor is the banned money
      // rounding rule, ADR-0009). The cycle's pulls add only a few read
      // rows — the budget stays under the post-cycle footprint, so the
      // prune genuinely attempts its LRU batches under the fault.
      prune: { budgetBytes: (seededBytes / 2) | 0 },
    });
    const faultCycle = await host.syncNow();
    expect(faultCycle.outcome!.accepted).toBe(0); // an empty-queue cycle — pulls only
    expect(host.state.phase).toBe("idle"); // the cycle outcome is unaffected
    expect(host.lastPrune).toBeNull();
    expect(host.lastPruneError).toMatch(/DELETE refused/);
    expect(store.countRows("statements")).toBe(240); // nothing half-pruned
    expect(store.countRows("pos_sales")).toBe(6);
    // The pulls during the fault cycle may have grown the caches — measure
    // the post-fault baseline for the byte-exact tie-out below (and the
    // machinery baseline: the CYCLE writes cursors/meta; the PRUNE never
    // touches machinery — the assertion below isolates the prune's
    // effect by comparing against this post-cycle snapshot).
    const startBytes = mobileStoreBytes(store);
    const machineryBefore = {
      outbox: store.countRows("outbox"),
      cursors: store.countRows("cursors"),
      meta: store.countRows("meta"),
    };

    // THE CONVERGING PASS (fault cleared): the tiny budget drives LRU
    // batches until under budget — byte-exact freed accounting, dirty
    // rows never pruned, the write set only in SYNCED, machinery intact.
    driver.refuseDeletes = false;
    const budget = (startBytes / 2) | 0; // integer truncation (|0, the ADR-0009 lint-safe idiom)
    const result = pruneMobileStore(store, { budgetBytes: budget });
    expect(result.estimated).toBe(false); // dbstat-exact, honestly reported
    expect(result.stillOverBudget).toBe(false);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(result.iterations).toBeGreaterThan(0);
    const endBytes = mobileStoreBytes(store);
    expect(endBytes).toBe(startBytes - result.freedBytes); // byte-exact tie-out
    expect(endBytes).toBeLessThanOrEqual(budget);
    // LRU: the OLDEST non-dirty statements rows are gone, the 40 dirty
    // ones ALL survive, and only SYNCED pos_sales rows were pruned.
    const survivors = store.all("SELECT id FROM statements ORDER BY id");
    expect(survivors.length).toBeGreaterThanOrEqual(40);
    expect(survivors.length).toBeLessThan(240);
    for (const row of survivors) {
      expect(String(row.id)).toMatch(/^d128-statement-/);
    }
    const dirtySurvivors = store.all("SELECT id FROM statements WHERE dirty = 1");
    expect(dirtySurvivors).toHaveLength(40);
    const salesSurvivors = store.all("SELECT id, local_status FROM pos_sales");
    for (const row of salesSurvivors) {
      expect(String(row.local_status)).not.toBe("SYNCED"); // only SYNCED pruned
    }
    // Machinery never pruned (LOCAL_DATABASE §5.2).
    expect(store.countRows("outbox")).toBe(machineryBefore.outbox);
    expect(store.countRows("cursors")).toBe(machineryBefore.cursors);
    expect(store.countRows("meta")).toBe(machineryBefore.meta);

    // The 128 MB golden budget itself: the store is far under it and a
    // pass at the production budget is a honest no-op.
    const noop = pruneMobileStore(store);
    expect(noop).toMatchObject({ freedBytes: 0, iterations: 0, stillOverBudget: false });
    void seededBytes;
    store.close();
  });
});

/** The outbox status of one command (typed read). */
function outboxStatus(store: MobileStore, commandId: string): string {
  return String(store.get("SELECT status FROM outbox WHERE command_id = ?", [commandId])?.status);
}
