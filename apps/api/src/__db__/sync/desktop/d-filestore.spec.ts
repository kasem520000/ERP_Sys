import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import {
  applyPermissionSnapshotPayload,
  createDesktopStore,
  DesktopSession,
  keychainNames,
  MemoryKeychain,
  purgeOnRevocation,
  REVOCATION_PURGED_TABLES,
  SqlCipherUnavailableError,
  SyncDesktopHost,
  unlockWithSnapshot,
  type DesktopStore,
} from "@erp/desktop";

import { superuserClient } from "../../test-db";
import { closeDb } from "../../../infra/db/client";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { seededRandom } from "../../../../../../packages/sync-core/src/test-harness/chaos";
import { writePermissionWatermark } from "../../../../../../packages/sync-core/src/store/pull";
import { metaGet } from "../../../../../../packages/sync-core/src/store/adapter";
import { SyncReadOnlyError } from "../../../../../../packages/sync-core/src/errors";
import { permissionWatermarkState } from "../../../../../../packages/sync-core/src/watermark";

import {
  enrollDevice,
  HarnessTransport,
  makeSyncServices,
  seedPosWorld,
  type PosWorld,
} from "../_oracle";
import { desktopDevice, disposeDesktopFiles, openBareDesktopFile } from "./desktop-device";

/**
 * PHASE-021 T13/3-a · D-01 / D-02 / D-04 on the REAL desktop file store
 * (MASTER-PLAN §9 — BINDING; PHASE-021 §6 "D-02 (SQLite unreadable without
 * keychain key), D-04 (snapshot watermark degrade), D-01 (revocation →
 * immediate stop, queued data wiped on next contact)"; DR-P21-02):
 *
 * - **D-01**: a revoked device drives the REAL SyncDesktopHost to its
 *   terminal "revoked" phase (the `onRevocation` hook — the shell's purge
 *   trigger), `purgeOnRevocation` runs against the REAL SQLite file, and
 *   the FILE itself is binary-grepped for seeded tenant markers
 *   before/after (the file-level purge completion: checkpoint + VACUUM —
 *   plain DELETE alone leaves SQLite freelist pages, and the production
 *   cipher profile bounds that residue by encryption-at-rest per
 *   SECURITY_AND_DEVICE_MANAGEMENT §6.2's documented accepted risk).
 * - **D-02 (a)**: the INVARIANT secret-scan — keychain-held secrets
 *   (refresh token, device key, the store's db key) seeded through the
 *   REAL flows (keychain + session + the store's PRAGMA-key open) NEVER
 *   appear in the DB file bytes.
 * - **D-02 (b)**: the cipher-profile binary inspection — requesting
 *   encryption on the stock build fails CLOSED (SqlCipherUnavailableError)
 *   + the RECORDED CAVEAT (DR-P21-02): the standard-profile file is
 *   readable plaintext (the honest sandbox posture; the Windows CI
 *   SQLCipher profile makes the file unreadable without the key — proven
 *   there, honestly noted here).
 * - **D-04**: the permission snapshot pulled from the REAL feed into the
 *   file store → `unlockWithSnapshot` full mode (the cached keys mirror
 *   the server's effective set exactly); the watermark aged 7 d + 1 h →
 *   readonly SNAPSHOT_EXPIRED (loud SyncReadOnlyError on capture); a REAL
 *   role change (the server appends a fresh snapshot) restores writability
 *   with the updated key set; a never-pulled store → readonly
 *   NO_SNAPSHOT.
 *
 * Dedicated tenant e4e4e4e4 (verified unused across the repo). Seeded RNG
 * per scenario (SYNC_TESTS §9).
 */

const TENANT_D = "e4e4e4e4-e4e4-e4e4-e4e4-e4e4e4e4e4e4";
const OWNER = "e4e4e4e4-0000-4000-8000-00000000e401";
const CASHIER = "e4e4e4e4-0000-4000-8000-00000000e402";

const services = makeSyncServices();
let world: PosWorld;

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_D,
    name: "Tenant Desktop D-Suite (P21 3a)",
    nameAr: "مستأجر أمن سطح المكتب",
    prefix: "DSD",
    actor: OWNER,
    cashier: CASHIER,
    salesRep: OWNER,
  });
});

afterAll(async () => {
  disposeDesktopFiles();
  await closeDb();
});

/** A captured pos_sale draft. */
function saleDraft(offline: string, date: string) {
  return {
    clientId: generateUuidV7(),
    terminalId: world.terminalId,
    offlineReceiptNo: offline,
    invoiceDate: date,
    customerId: null,
    orderType: "COUNTER" as const,
    lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
    tenders: [{ method: "CASH" as const, amount: "115.0000" }],
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
function checkpoint(store: DesktopStore): void {
  store.run("PRAGMA wal_checkpoint(TRUNCATE)");
}

/** A real DesktopSession over the in-memory keychain + a scripted token
 * exchange (the token material never touches the file — that is exactly
 * what D-02(a) asserts). */
function sessionOver(keychain: MemoryKeychain, deviceId: string, accessToken: string): DesktopSession {
  const names = keychainNames(deviceId);
  return new DesktopSession({
    getRefreshToken: () => keychain.get(names.refreshToken),
    refresh: async () => ({
      accessToken,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    }),
  });
}

describe("PHASE-021 D-01/D-02/D-04 on the desktop file store (MASTER-PLAN §9; DR-P21-02)", () => {
  it("D-01 revocation on the FILE: host phase revoked + onRevocation → purgeOnRevocation empties business/outbox/cursors, keeps local_events scrubbed — and the FILE no longer contains the tenant row data (binary grep)", async () => {
    const seed = 0xdd1;
    console.log(`[D-01/file] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });
    const reference = dd.device;

    // Seed the device with REAL tenant data across every family:
    // (1) a server-side item the device pulls into its items cache,
    const pulledMarker = `D01-PULLED-ITEM-${generateUuidV7().slice(0, 8)}`;
    const pulledItemId = await withTenant(TENANT_D, async () => {
      const itemsStore = await import("../../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `DSD-D01-${(seededRandom(seed)() * 1e6) | 0}`,
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
    expect(dd.store.get("SELECT * FROM items WHERE id = ?", [pulledItemId])).toBeDefined();

    // (2) one ACKED sale + one mid-queue sale (the OFF- numbers are the
    //     binary markers of the write set + the outbox),
    const acked = saleDraft("OFF-DD01-00001", "2026-02-22");
    reference.captureSale(acked, "115.0000");
    const ackedOutcome = await reference.cycle();
    expect(ackedOutcome.accepted).toBe(1);
    const queued = saleDraft("OFF-DD01-00002", "2026-02-22");
    reference.captureSale(queued, "115.0000");
    reference.markInFlight([queued.clientId]); // mid-queue when revocation lands

    // (3) a draft_docs row + (4) a local_events row whose payloads carry
    //     tenant data (the desktop UI's tables — seeded through the store
    //     adapter, the only write surface those tables have),
    const draftPayloadMarker = `D01-DRAFT-PAYLOAD-${generateUuidV7().slice(0, 8)}`;
    const eventsPayloadMarker = `D01-CHOICE-PAYLOAD-${generateUuidV7().slice(0, 8)}`;
    dd.store.run(
      "INSERT INTO draft_docs (local_id, doc_type, payload, local_status, updated_at) VALUES (?, 'invoice', ?, 'DRAFT_LOCAL', ?)",
      [`draft-${seed}`, JSON.stringify({ marker: draftPayloadMarker, lines: [] }), new Date().toISOString()],
    );
    dd.store.run(
      "INSERT INTO local_events (kind, choice, reason, trace_id, command_id, payload, at) VALUES (?, 'ACCEPT_SERVER_PRICE', 'PRICE_CHANGED', 'trace-dd01', ?, ?, ?)",
      [
        "rejection_choice",
        acked.clientId,
        JSON.stringify({ before: "10.00", after: "11.00", marker: eventsPayloadMarker }),
        new Date().toISOString(),
      ],
    );
    dd.store.run("UPDATE meta SET value = ? WHERE key = 'enrolledDeviceId'", [deviceId]);

    // BEFORE the purge: every tenant marker is honestly IN the file bytes
    // (checkpoint first so the committed WAL frames land in the main file).
    checkpoint(dd.store);
    const before = fileAndWalBytes(dd.filePath);
    const markers = {
      pulledItem: pulledMarker,
      offAcked: "OFF-DD01-00001",
      offQueued: "OFF-DD01-00002",
      draftPayload: draftPayloadMarker,
      eventsPayload: eventsPayloadMarker,
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
    const keychain = new MemoryKeychain();
    const names = keychainNames(deviceId);
    await keychain.set(names.refreshToken, "d01-refresh-token-material");
    const revocations: { source: string; at: string }[] = [];
    const host = new SyncDesktopHost({
      store: dd.store,
      transport,
      session: sessionOver(keychain, deviceId, "d01-access-token"),
      deviceId,
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
    expect(metaGet(dd.store, "queueUnresolvable")).toBe("DEVICE_REVOKED");
    // A revoked host refuses further cycles (D-01 terminal state).
    const refused = await host.syncNow();
    expect(refused).toMatchObject({ skipped: "revoked" });

    // The shell's purge: purgeOnRevocation on the REAL file — honest
    // per-table counts, local_events kept with scrubbed payloads.
    const report = purgeOnRevocation(dd.store);
    expect(report.tables).toMatchObject({
      items: expect.any(Number),
      pos_sales: 2,
      outbox: 2,
      draft_docs: 1,
    });
    expect(report.tables["items"]).toBeGreaterThan(0);
    for (const table of REVOCATION_PURGED_TABLES) {
      expect(dd.store.countRows(table)).toBe(0);
    }
    expect(report.localEventsKept).toBe(1);
    expect(report.localEventsPayloadsScrubbed).toBe(1);
    for (const row of dd.store.all("SELECT payload FROM local_events")) {
      expect(row.payload).toBeNull(); // audit facts kept, content scrubbed
    }
    expect(report.metaKeysDeleted).toEqual(
      expect.arrayContaining(["enrolledDeviceId", "permissionSnapshotAt", "queueUnresolvable"]),
    );

    // THE FILE-LEVEL PURGE COMPLETION (recorded posture, DR-P21-3a-01):
    // plain DELETE leaves freed pages in the SQLite freelist until
    // compaction, and the production cipher profile (DR-P21-02) bounds
    // that residue by encryption-at-rest (SECURITY_AND_DEVICE_MANAGEMENT
    // §6.2's documented accepted risk). The purge completes at the file
    // level with SQLite's own compaction (VACUUM + checkpoint — in WAL
    // mode the compacted content lands in the main file only at the
    // checkpoint) — then the binary grep must find NO tenant row data
    // anywhere in the file bytes.
    dd.store.run("VACUUM");
    checkpoint(dd.store);
    const after = fileAndWalBytes(dd.filePath);
    for (const [name, marker] of Object.entries(markers)) {
      expect(
        after.file.includes(Buffer.from(marker)) || after.wal.includes(Buffer.from(marker)),
        `post-purge: the ${name} marker must be GONE from the file bytes`,
      ).toBe(false);
    }
    // The audit FACTS survive in the file (the local_events row itself is
    // what §5.2 keeps — kind/choice/reason/trace_id, NOT the scrubbed
    // payload content).
    expect(after.file.includes(Buffer.from("trace-dd01"))).toBe(true);

    // The store remains healthy for re-enrollment: migrations intact,
    // no stale quarantine, the queue flag cleared by the purge.
    expect(metaGet(dd.store, "quarantined")).toBeNull();
    const reopened = dd.reopen();
    expect(reopened.store.all("SELECT version FROM schema_migrations")).toHaveLength(5);
    reopened.dispose();
  });

  it("D-02(a) secret-scan on the REAL file: keychain-held secrets seeded through the real flows NEVER appear in the DB bytes", async () => {
    const seed = 0xdd2;
    console.log(`[D-02a/file] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });

    // The three secret classes, seeded through the REAL flows:
    const keychain = new MemoryKeychain();
    const names = keychainNames(deviceId);
    const refreshToken = `D02A-REFRESH-SECRET-${generateUuidV7()}`;
    const deviceKey = `D02A-DEVICEKEY-SECRET-${generateUuidV7()}`;
    const dbKey = `D02A-DBKEY-SECRET-${generateUuidV7()}`;
    await keychain.set(names.refreshToken, refreshToken);
    await keychain.set(names.deviceKey, deviceKey);
    await keychain.set(names.dbKey, dbKey);

    // (1) the device's store opens with the keychain's dbKey applied via
    //     PRAGMA key (the DR-P21-02 standard-profile fallback: the stock
    //     build ignores the pragma; the key must reach the FILE through
    //     no other path),
    const dd = desktopDevice({
      transport,
      seed,
      storeOptions: { encryptionKey: dbKey, profile: "standard" },
    });
    expect(dd.store.info.profile).toBe("standard");

    // (2) the device runs real cycles with the session over the keychain
    //     (the access-token material is memory-only by design),
    const accessToken = `D02A-ACCESS-SECRET-${generateUuidV7()}`;
    const host = new SyncDesktopHost({
      store: dd.store,
      transport,
      session: sessionOver(keychain, deviceId, accessToken),
      deviceId,
    });
    const draft = saleDraft("OFF-DD02A-00001", "2026-02-23");
    dd.device.captureSale(draft, "115.0000");
    const cycle = await host.syncNow();
    expect(cycle.outcome!.accepted).toBe(1);
    // …plus the audit surface (local_events) and a queued command —
    // every table family carries live data when the scan runs.
    dd.device.captureSale(saleDraft("OFF-DD02A-00002", "2026-02-23"), "115.0000");
    dd.store.run(
      "INSERT INTO local_events (kind, choice, reason, trace_id, command_id, payload, at) VALUES ('rejection_choice', 'CANCEL_WITH_REASON', 'ITEM_INACTIVE', 'trace-d02a', 'cmd-d02a', ?, ?)",
      [JSON.stringify({ note: "audit row for the secret scan" }), new Date().toISOString()],
    );

    // THE SCAN: none of the secret material appears in the file bytes
    // (main file or WAL) after the real flows ran through them.
    const bytes = fileAndWalBytes(dd.filePath);
    for (const secret of [refreshToken, deviceKey, dbKey, accessToken, names.refreshToken]) {
      expect(
        bytes.file.includes(Buffer.from(secret)) || bytes.wal.includes(Buffer.from(secret)),
        "secret-scan: keychain/session key material must NEVER reach the DB file bytes",
      ).toBe(false);
    }
    // The honest control: the store DID capture the business data (the
    // scan is meaningful — the file is not empty).
    checkpoint(dd.store);
    const control = fileAndWalBytes(dd.filePath);
    expect(control.file.includes(Buffer.from("OFF-DD02A-00001"))).toBe(true);
    dd.dispose();
  });

  it("D-02(b) cipher-profile binary inspection: encryption on the stock build fails CLOSED; the standard profile is readable plaintext (the RECORDED CAVEAT, DR-P21-02)", () => {
    const seed = 0xdd2;
    console.log(`[D-02b/file] seed=${seed}`);
    const { store, filePath } = openBareDesktopFile("d02b");

    // (a) Requesting the cipher profile on the stock build FAILS CLOSED —
    //     the store never fakes at-rest encryption.
    let failedClosed = false;
    try {
      createDesktopStore({ path: `${filePath}.cipher`, encryptionKey: "keychain-db-key", profile: "cipher" });
    } catch (error) {
      failedClosed = error instanceof SqlCipherUnavailableError;
      expect((error as SqlCipherUnavailableError).code).toBe("SQLCIPHER_UNAVAILABLE");
    }
    expect(failedClosed).toBe(true);

    // (b) The RECORDED CAVEAT (DR-P21-02): on the Windows CI SQLCipher
    //     build the same open ENCRYPTS the file (unreadable without the
    //     keychain key — D-02 proper runs there). The sandbox/CI fallback
    //     profile is plain SQLite: this assert proves the honest posture —
    //     the standard-profile file IS readable plaintext (no fake
    //     encryption claim), while every OTHER key-management invariant
    //     holds (D-02(a) above: the key never reaches the bytes).
    const marker = `D02B-PLAINTEXT-VISIBILITY-${generateUuidV7().slice(0, 8)}`;
    store.run("INSERT INTO partners (id, code, name, kind, status) VALUES (?, ?, ?, 'CUSTOMER', 'ACTIVE')", [
      `partner-d02b-${seed}`,
      "D02B-P1",
      marker,
    ]);
    checkpoint(store);
    const bytes = readFileSync(filePath);
    expect(bytes.subarray(0, 15).toString("latin1")).toBe("SQLite format 3"); // a plain SQLite file
    expect(bytes.includes(Buffer.from(marker))).toBe(true); // …readable plaintext — the honest posture
    store.close();
  });

  it("D-04 on the FILE store: the REAL permission snapshot unlocks full mode; 7d+1h ages to readonly SNAPSHOT_EXPIRED (loud capture refusal); a REAL role change restores writability; no snapshot → readonly NO_SNAPSHOT", async () => {
    const seed = 0xdd4;
    console.log(`[D-04/file] seed=${seed}`);
    const deviceId = await enrollDevice(TENANT_D, CASHIER, { deviceClass: "tauri-desktop" });
    const transport = new HarnessTransport({ tenant: TENANT_D, deviceId, push: services.push });
    const dd = desktopDevice({ transport, seed });

    // (0) A never-pulled store: the v5 seed leaves permissionSnapshotAt
    //     un-set ("0" = not tracked) → readonly NO_SNAPSHOT.
    const fresh = openBareDesktopFile("d04-fresh");
    expect(unlockWithSnapshot(fresh.store)).toEqual({ mode: "readonly", reason: "NO_SNAPSHOT" });

    // (1) Pull the REAL permissions feed (the pull service's per-user
    //     snapshot) into the file store through the desktop applier —
    //     the watermark + the cached key rows land in the FILE.
    const snapshotPage = await transport.pull("permissions", null);
    expect(snapshotPage.changes.length).toBeGreaterThan(0);
    for (const change of snapshotPage.changes) {
      expect(change.payload).not.toBeNull();
      applyPermissionSnapshotPayload(dd.store, change.payload!);
    }
    const parkedCursor = snapshotPage.nextCursor ?? snapshotPage.cursor;
    const unlocked = unlockWithSnapshot(dd.store);
    expect(unlocked.mode).toBe("full");
    if (unlocked.mode !== "full") throw new Error("unreachable");
    expect(unlocked.permissions.length).toBeGreaterThan(0); // the real role keys
    const serverKeys = await withTenant(TENANT_D, async () => {
      const rows = await requireTenantContext().tx!.execute(
        sql`SELECT permission_key FROM erp.user_effective_permissions(${CASHIER}::uuid, erp.current_tenant_id())`,
      );
      return (rows.rows as unknown as { permission_key: string }[]).map((row) => row.permission_key).sort();
    });
    expect(unlocked.permissions).toEqual(serverKeys); // the cache mirrors the server exactly
    expect(permissionWatermarkState(dd.store).readOnly).toBe(false);

    // (2) Age the watermark 7 days + 1 hour: readonly SNAPSHOT_EXPIRED +
    //     the engine's capture gate throws LOUD (D-04).
    const aged = new Date(Date.now() - (7 * 86_400_000 + 3_600_000)).toISOString();
    writePermissionWatermark(dd.store, aged);
    const stale = unlockWithSnapshot(dd.store);
    expect(stale).toMatchObject({ mode: "readonly", reason: "SNAPSHOT_EXPIRED" });
    expect(permissionWatermarkState(dd.store).readOnly).toBe(true);
    expect(() => dd.device.captureSale(saleDraft("OFF-DD04-00001", "2026-02-24"), "115.0000")).toThrow(
      SyncReadOnlyError,
    );
    // Nothing was captured — the refusal rolled back whole.
    expect(dd.store.all("SELECT * FROM outbox")).toHaveLength(0);
    expect(dd.store.all("SELECT * FROM pos_sales")).toHaveLength(0);

    // (3) A REAL permission change (one role grant removed server-side):
    //     the snapshot catch-up writer appends a fresh row, the cursor-
    //     anchored re-pull serves it, and the desktop applier restores
    //     writability with the UPDATED key set.
    const su = await superuserClient();
    await su.query(
      `DELETE FROM role_permissions WHERE ctid IN (
         SELECT rp.ctid FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         WHERE r.tenant_id = $1 AND r.key LIKE 'dsd%'
         LIMIT 1
       )`,
      [TENANT_D],
    );
    await su.end();
    const refreshed = await transport.pull("permissions", parkedCursor);
    expect(refreshed.changes.length).toBeGreaterThan(0);
    for (const change of refreshed.changes) {
      applyPermissionSnapshotPayload(dd.store, change.payload!);
    }
    expect(unlockWithSnapshot(dd.store).mode).toBe("full");
    expect(permissionWatermarkState(dd.store).readOnly).toBe(false);
    const updatedKeys = await withTenant(TENANT_D, async () => {
      const rows = await requireTenantContext().tx!.execute(
        sql`SELECT permission_key FROM erp.user_effective_permissions(${CASHIER}::uuid, erp.current_tenant_id())`,
      );
      return (rows.rows as unknown as { permission_key: string }[]).map((row) => row.permission_key).sort();
    });
    expect(updatedKeys).toHaveLength(serverKeys.length - 1); // the removed grant propagated
    const afterUnlock = unlockWithSnapshot(dd.store);
    if (afterUnlock.mode !== "full") throw new Error("unreachable");
    expect(afterUnlock.permissions).toEqual(updatedKeys);
    dd.device.captureSale(saleDraft("OFF-DD04-00002", "2026-02-24"), "115.0000");
    expect(dd.store.all("SELECT * FROM outbox")).toHaveLength(1);

    fresh.store.close();
    dd.dispose();
  });
});
