import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { DeviceRegistryService } from "../../modules/sync/application/device-registry-service";
import { ReconciliationService } from "../../modules/sync/application/reconciliation-service";
import { pull as pullService } from "../../modules/sync/application/pull-service";
import { SyncDeviceRevokedError } from "../../modules/sync/domain/sync-errors";
import { PosSyncCommandInvalidError } from "../../modules/pos/domain/pos-errors";

import {
  applyPullBatch,
  posAppliers,
  writePermissionWatermark,
} from "../../../../../packages/sync-core/src/store/pull";
import { memoryAdapter } from "../../../../../packages/sync-core/src/store/adapter";
import { queueStats } from "../../../../../packages/sync-core/src/outbox/engine";
import {
  assertWritable,
  permissionWatermarkState,
  PERMISSION_SNAPSHOT_MAX_AGE_DAYS,
} from "../../../../../packages/sync-core/src/watermark";
import { SyncReadOnlyError } from "../../../../../packages/sync-core/src/errors";
import { ReferenceDevice } from "../../../../../packages/sync-core/src/test-harness/reference-device";

import {
  countInbox,
  countInvoices,
  countJournals,
  enrollDevice,
  HarnessTransport,
  ledgerOraclesHold,
  makeSyncServices,
  posSalePayload,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "./_oracle";

/**
 * PHASE-020 T-P20-3b · the device-security slices (SECURITY_TEST_PLAN §10
 * D-series rows applicable to 020; MASTER-PLAN §14 companion suites;
 * SECURITY_AND_DEVICE_MANAGEMENT §3):
 *
 * - D-01 revocation pre-exec: the kill switch lands BEFORE any push
 *   executes — pulls throw the typed DEVICE_REVOKED, pushes reject
 *   per-item with zero ledger effects, the client marks its queue
 *   unresolvable (no silent loss), and the reconciliation queue lists the
 *   device through the draft it still owns;
 * - D-03 malformed/oversized payloads: contract-shape violations (non-object
 *   commands, over-cap fields, unknown command types, over-budget batches)
 *   reject as typed VALIDATION_ERROR items — never executed, never in the
 *   inbox, zero residue;
 * - D-04 permission-snapshot expiry: the > 7d watermark flips the store
 *   read-only (loud SyncReadOnlyError on captures), a fresh snapshot pull
 *   restores writability, and the SERVER stays the final authority on every
 *   push regardless of the local gate;
 * - the spoof: tenant A's user device used inside tenant B's context —
 *   the pull serves B's rows only (A's never ride along) and the
 *   B-scoped permission projection for A's user is an EMPTY key set.
 *
 * Dedicated tenant 26262626 (verified unused) + a second real tenant
 * 28282828 (verified unused) as the spoof target — no cross-file state.
 */

const TENANT_SEC = "26262626-2626-2626-2626-262626262626";
const SEC_OWNER = "26262626-0000-4000-8000-000000002601";
const SEC_CASHIER = "26262626-0000-4000-8000-000000002602";
const TENANT_SPOOF_B = "28282828-2828-2828-2828-282828282828";

const services = makeSyncServices();
const audit = new AuditService(new DrizzleAuditStore());
const registry = new DeviceRegistryService(audit);
const reconciliation = new ReconciliationService(audit);
let world: PosWorld;

/** The spoof tenant's REAL rows (B's pull content). */
let bItemId = "";

async function pushV2(deviceId: string, commands: unknown[], contractVersion = SYNC_CONTRACT_VERSION) {
  return withTenant(TENANT_SEC, () =>
    services.push.push({ deviceId, batchId: generateUuidV7(), commands, contractVersion }),
  );
}

function asRejected(item: PushItemResultV2): Extract<PushItemResultV2, { status: "REJECTED" }> {
  if (item.status !== "REJECTED") {
    throw new Error(`expected a REJECTED item, got ${item.status}`);
  }
  return item;
}

function asAccepted(item: PushItemResultV2): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}`);
  }
  return item;
}

/** The 016-style offline draft the reference device captures. */
function offlineDraft(offline: string) {
  return {
    clientId: generateUuidV7(),
    terminalId: world.terminalId,
    offlineReceiptNo: offline,
    invoiceDate: "2026-02-27",
    customerId: null,
    orderType: "COUNTER" as const,
    lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
    tenders: [{ method: "CASH" as const, amount: "115.0000" }],
  };
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_SEC,
    name: "Tenant Device Security (P20 3b)",
    nameAr: "مستأجر أمن الأجهزة",
    prefix: "SEC",
    actor: SEC_OWNER,
    cashier: SEC_CASHIER,
    salesRep: SEC_OWNER,
  });

  // The spoof tenant: REAL rows only (a uom + an item) — its single purpose
  // is to be the context A's device gets used inside.
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Spoof B (P20 3b)', 'مستأجر الانتحال ب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_SPOOF_B],
  );
  const bUomId = generateUuidV7();
  bItemId = generateUuidV7();
  await su.query(
    `INSERT INTO uoms (id, tenant_id, code, name) VALUES ($1, $2, 'PCS', 'Pieces')
     ON CONFLICT (id) DO NOTHING`,
    [bUomId, TENANT_SPOOF_B],
  );
  await su.query(
    `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, base_price) VALUES
       ($1, $2, 'SEC-SPOOF-ITEM', 'Spoof B Item', 'STOCK', $3, '100.000000')
     ON CONFLICT (id) DO NOTHING`,
    [bItemId, TENANT_SPOOF_B, bUomId],
  );
  await su.end();
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 device security (SECURITY_TEST_PLAN §10; SECURITY_AND_DEVICE_MANAGEMENT §3)", () => {
  it("D-01 revocation pre-exec: pull typed DEVICE_REVOKED, push per-item DEVICE_REVOKED with zero ledger, queue unresolvable, reconciliation lists the device", async () => {
    const seed = 0xd01;
    console.log(`[D-01] seed=${seed}`);
    const device = await enrollDevice(TENANT_SEC, SEC_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_SEC, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    // The device owns a DRAFT (what puts it on the reconciliation queue) and
    // holds a full offline queue — nothing executed yet.
    const draft = asAccepted(
      (await pushV2(device, [
        v2Command("sales_invoice", "create_draft", "sec-d01-draft", {
          customerId: world.customerId,
          orderDate: "2026-03-05",
          lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        }),
      ])).results[0]!,
    );
    expect(draft.entity).toMatchObject({ version: 1 });
    reference.captureSale(offlineDraft("OFF-SEC-10001"), "115.0000");
    reference.captureSale(offlineDraft("OFF-SEC-10002"), "115.0000");
    reference.captureSale(offlineDraft("OFF-SEC-10003"), "115.0000");
    expect(queueStats(reference.adapter).pending).toBe(3);

    const invoicesBefore = await countInvoices(TENANT_SEC); // the DRAFT counts as a row
    const journalsBefore = await countJournals(TENANT_SEC);

    // The kill switch (the real registry path, audited) — BEFORE any push.
    const revoked = await withTenant(TENANT_SEC, () =>
      registry.revoke({ deviceId: device, actorId: SEC_OWNER, reason: "lost in the field", admin: true }),
    );
    expect(revoked.revokedAt).not.toBeNull();

    // Pulls: the typed exception, before anything is served.
    await expect(
      withTenant(TENANT_SEC, () => pullService({ entityType: "items", cursor: null, deviceId: device })),
    ).rejects.toBeInstanceOf(SyncDeviceRevokedError);
    await expect(transport.pull("items", null)).rejects.toMatchObject({ code: "DEVICE_REVOKED" });

    // Pushes: per-item DEVICE_REVOKED — zero execution, zero inbox rows.
    const { results } = await pushV2(device, [
      v2Command("pos_sale", "create", "sec-d01-1", posSalePayload(world, { offline: "OFF-SEC-20001", date: "2026-02-27" })),
      v2Command("pos_sale", "create", "sec-d01-2", posSalePayload(world, { offline: "OFF-SEC-20002", date: "2026-02-27" })),
    ]);
    expect(results).toHaveLength(2);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item).toMatchObject({
        status: "REJECTED",
        reason: "DEVICE_REVOKED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(item.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
    }
    expect(await countInvoices(TENANT_SEC)).toBe(invoicesBefore);
    expect(await countJournals(TENANT_SEC)).toBe(journalsBefore);
    expect(await countInbox(TENANT_SEC, device)).toBe(1); // the executed create_draft only

    // The client cycle: revocation surfaced, NO push attempted, the queue
    // marked unresolvable (no silent loss — "queued local data" stays
    // pending until a human resolves it; the wipe-on-contact rule is the
    // 021 consumer, honestly noted).
    const outcome = await reference.cycle();
    expect(outcome.deviceRevoked).toBe(true);
    expect(outcome.pushed).toBe(0);
    const state = reference.state();
    expect(state.meta.queueUnresolvable).toBe("DEVICE_REVOKED");
    expect(state.queue.pending).toBe(3);

    // The reconciliation queue lists the device through its owned draft.
    const queue = await withTenant(TENANT_SEC, () => reconciliation.pendingOperations());
    const entry = queue.find((row) => row.deviceId === device);
    expect(entry).toBeDefined();
    expect(entry!.ownedDrafts).toBe(1);
    await ledgerOraclesHold(TENANT_SEC);
  });

  it("D-03 malformed/oversized payloads: contract-shape violations reject as typed VALIDATION_ERROR items — never executed, never in the inbox", async () => {
    const seed = 0xd03;
    console.log(`[D-03] seed=${seed}`);
    const device = await enrollDevice(TENANT_SEC, SEC_CASHIER);

    const invoicesBefore = await countInvoices(TENANT_SEC);
    const journalsBefore = await countJournals(TENANT_SEC);
    const inboxBefore = await countInbox(TENANT_SEC, device);

    // The malformed batch: a non-object, an over-cap idempotencyKey (121 >
    // 120), an over-cap entityType (41 > 40), an over-cap localRef (81 >
    // 80), an unknown command type, and a legacy pos_sale with an over-cap
    // offlineReceiptNo (61 > 60). Six violations, one batch — per-item
    // results, the batch never aborts.
    const v2Base = {
      commandId: generateUuidV7(),
      entityType: "pos_sale",
      intent: "create",
      clientCreatedAt: "2026-02-27T08:00:00Z",
      payload: posSalePayload(world, { offline: "OFF-SEC-30001", date: "2026-02-27" }),
    };
    const oversizedLegacy = {
      type: "pos_sale" as const,
      id: generateUuidV7(),
      idempotencyKey: "sec-d03-legacy",
      createdAt: "2026-02-27T08:00:00Z",
      sale: {
        clientId: generateUuidV7(),
        terminalId: world.terminalId,
        offlineReceiptNo: "X".repeat(61), // over the 60-char cap
        invoiceDate: "2026-02-27",
        customerId: null,
        orderType: "COUNTER" as const,
        checkId: null,
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        tenders: [{ method: "CASH" as const, amount: "115.0000" }],
      },
    };
    const { results } = await pushV2(device, [
      "not-an-object", // 1: not an object
      { ...v2Base, idempotencyKey: "k".repeat(121) }, // 2: over-cap key
      { ...v2Base, idempotencyKey: "sec-d03-entity", entityType: "e".repeat(41) }, // 3: over-cap entityType
      {
        ...v2Base,
        idempotencyKey: "sec-d03-localref",
        localRef: "r".repeat(81), // 4: over-cap localRef
      } as unknown as Record<string, unknown>,
      { type: "resurrection", id: generateUuidV7(), idempotencyKey: "sec-d03-unknown" }, // 5: unknown type
      oversizedLegacy, // 6: legacy over-cap payload field
    ]);
    expect(results).toHaveLength(6);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item.status).toBe("REJECTED");
      expect(item.reason).toBe("VALIDATION_ERROR");
      expect(item.resubmittable).toBe(true);
      expect(item.action).toBe("EDIT_AND_RESEND");
      expect(item.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
    }
    // The distinct shape-reject messages (the contract vocabulary, never prose).
    const messages = results.map((raw) => asRejected(raw).message);
    expect(messages).toContain("command must be an object");
    expect(messages).toContain("command shape rejected by the v2 contract");
    expect(messages).toContain("command shape rejected by the contract");

    // Zero execution: no invoice, no journal, no inbox rows, oracles hold.
    expect(await countInvoices(TENANT_SEC)).toBe(invoicesBefore);
    expect(await countJournals(TENANT_SEC)).toBe(journalsBefore);
    expect(await countInbox(TENANT_SEC, device)).toBe(inboxBefore);
    await ledgerOraclesHold(TENANT_SEC);

    // The over-budget batch: 51 commands → the typed whole-request error
    // (the 50-command budget, MAX_PUSH_BATCH).
    const batch = Array.from({ length: 51 }, (_, index) =>
      v2Command("pos_sale", "create", `sec-d03-budget-${index}`, posSalePayload(world, { offline: `OFF-SEC-4${String(index).padStart(3, "0")}`, date: "2026-02-27" })),
    );
    await expect(pushV2(device, batch)).rejects.toBeInstanceOf(PosSyncCommandInvalidError);
    await expect(pushV2(device, batch)).rejects.toMatchObject({ code: "SYNC_COMMAND_INVALID" });
    expect(await countInvoices(TENANT_SEC)).toBe(invoicesBefore);
    await ledgerOraclesHold(TENANT_SEC);
  });

  it("D-03b oversized PAYLOAD: a batch serialized past the 1 MB budget rejects with the typed size error — nothing executed, nothing in the inbox (SYNC_PROTOCOL §3 ≤ 1 MB)", async () => {
    const device = await enrollDevice(TENANT_SEC, SEC_OWNER);

    const invoicesBefore = await countInvoices(TENANT_SEC);
    const inboxBefore = await countInbox(TENANT_SEC, device);

    // One command whose serialized payload alone blows past 1 MB (a
    // single localRef stuffed to ~1.1 MB — under every per-field shape
    // the zod contract would catch in the per-item channel, so the test
    // targets the BATCH byte budget that must fire BEFORE any parsing).
    const stuffed = "x".repeat(1_100_000);
    const oversized = v2Command(
      "pos_sale",
      "create",
      "sec-d03b-bytes",
      posSalePayload(world, { offline: "OFF-SEC-D03B-1", date: "2026-02-27" }),
      { localRef: stuffed },
    );

    await expect(pushV2(device, [oversized])).rejects.toBeInstanceOf(PosSyncCommandInvalidError);
    await expect(pushV2(device, [oversized])).rejects.toMatchObject({
      code: "SYNC_COMMAND_INVALID",
    });
    // The typed message names the budget (never prose drift).
    await pushV2(device, [oversized]).catch((error: Error) => {
      expect(error.message).toMatch(/1 MB/);
    });

    // Zero execution: no invoice, no inbox rows, oracles hold.
    expect(await countInvoices(TENANT_SEC)).toBe(invoicesBefore);
    expect(await countInbox(TENANT_SEC, device)).toBe(inboxBefore);
    await ledgerOraclesHold(TENANT_SEC);
  });

  it("D-04 permission-snapshot expiry: > 7d watermark → store read-only (loud SyncReadOnlyError), fresh pull restores writability, the server stays the final authority", async () => {
    const seed = 0xd04;
    console.log(`[D-04] seed=${seed}`);
    const device = await enrollDevice(TENANT_SEC, SEC_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_SEC, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    // The D-04 window is 7 days (the contract the client enforces).
    expect(PERMISSION_SNAPSHOT_MAX_AGE_DAYS).toBe(7);

    // (1) A fresh REAL permissions pull through the transport → the
    // applier stamps the watermark → the store is writable.
    const firstSnapshot = await transport.pull("permissions", null);
    expect(firstSnapshot.changes.length).toBeGreaterThanOrEqual(1);
    const applied = applyPullBatch(
      reference.adapter,
      { entityType: "permissions", cursor: firstSnapshot.cursor, changes: [...firstSnapshot.changes] },
      posAppliers,
    );
    expect(applied).toBeGreaterThan(0);
    const fresh = permissionWatermarkState(reference.adapter);
    expect(fresh.readOnly).toBe(false);
    expect(fresh.ageDays).toBeLessThan(1);
    assertWritable(reference.adapter); // no throw
    reference.captureSale(offlineDraft("OFF-SEC-50001"), "115.0000"); // capture OK
    expect(queueStats(reference.adapter).pending).toBe(1);

    // (2) 8 days offline: the watermark goes stale → readOnly. Captures
    // fail LOUDLY (SyncReadOnlyError) — never a silent drop — and the
    // queued command stays honest (never fabricated ACCEPTED).
    writePermissionWatermark(reference.adapter, new Date(Date.now() - 8 * 86_400_000).toISOString());
    const stale = permissionWatermarkState(reference.adapter);
    expect(stale.readOnly).toBe(true);
    expect(stale.ageDays).toBeGreaterThan(7);
    expect(() => assertWritable(reference.adapter)).toThrow(SyncReadOnlyError);
    expect(() => reference.captureSale(offlineDraft("OFF-SEC-50002"), "115.0000")).toThrow(SyncReadOnlyError);
    const gatedState = reference.state();
    expect(gatedState.meta.watermarkReadOnly).toBe(true);
    expect(gatedState.meta.readOnly).toBe(true);
    expect(gatedState.queue.pending).toBe(1); // the pre-gate capture only
    expect(gatedState.outbox[0]!.status).toBe("QUEUED");

    // (3) The server stays the final authority: even with the local store
    // read-only, a pushed command is re-validated server-side — the
    // read-only gate NEVER relaxes server enforcement (a tampered payload
    // still rejects, zero effects).
    const invoicesBefore = await countInvoices(TENANT_SEC);
    const tampered = posSalePayload(world, { offline: "OFF-SEC-50003", date: "2026-02-27", unitPrice: "80.000000" });
    (tampered.sale.tenders[0] as { amount: string }).amount = "115.0000";
    const serverStillChecks = asRejected(
      (await pushV2(device, [v2Command("pos_sale", "create", "sec-d04-authority", tampered)])).results[0]!,
    );
    expect(serverStillChecks.reason).toBe("VALIDATION_ERROR");
    expect(await countInvoices(TENANT_SEC)).toBe(invoicesBefore);

    // (4) Recovery: a fresh REAL permissions pull (snapshotAt = now)
    // restores writability and the queue drains (C-09 semantics).
    const recovery = await transport.pull("permissions", null);
    expect(recovery.changes.length).toBeGreaterThanOrEqual(1);
    const recoverySnapshot = recovery.changes[recovery.changes.length - 1]!.payload as {
      snapshotAt: string;
      watermarkDays: number;
    };
    expect(recoverySnapshot.watermarkDays).toBe(7);
    applyPullBatch(
      reference.adapter,
      { entityType: "permissions", cursor: recovery.cursor, changes: [...recovery.changes] },
      posAppliers,
    );
    expect(permissionWatermarkState(reference.adapter).readOnly).toBe(false);
    assertWritable(reference.adapter);

    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(0);
    const drained = reference.state();
    expect(drained.queue.acked).toBe(1);

    // The drained capture is SYNCED with its official number (the honest
    // state — never displayed as pending once the server assigned it).
    const drainedSale = reference.adapter.get(
      "SELECT * FROM pos_sales WHERE offline_receipt_no = ?",
      ["OFF-SEC-50001"],
    )!;
    expect(drainedSale.local_status).toBe("SYNCED");
    expect(drainedSale.official_no).toMatch(/^POS-/);

    // The REFUSED capture never entered the outbox (the source of truth for
    // pending operations — LOCAL_DATABASE §6.2: the business row and its
    // outbox command are ONE transaction). Note the harness caveat: the
    // memoryAdapter's transaction is a pass-through (adapter.ts "no partial
    // rollback needed for the harness semantics"), so its business row
    // lingers PENDING_SYNC in the store — a real SQLite store rolls the
    // whole capture back; the OUTBOX never listed it either way.
    expect(drained.outbox).toHaveLength(1);
    const refusedSale = reference.adapter.get(
      "SELECT * FROM pos_sales WHERE offline_receipt_no = ?",
      ["OFF-SEC-50002"],
    );
    if (refusedSale !== undefined) {
      // The pass-through adapter kept the pre-throw INSERT — it must still
      // read as PENDING_SYNC (never as posted) and carry no official number.
      expect(refusedSale.local_status).toBe("PENDING_SYNC");
      expect(refusedSale.official_no ?? null).toBeNull();
    }
    await ledgerOraclesHold(TENANT_SEC);
  });

  it("spoof: tenant A's user device inside tenant B's context → B's rows only, A's permission keys never leak, both ledgers untouched", async () => {
    const seed = 0x5f5;
    console.log(`[spoof] seed=${seed}`);
    const device = await enrollDevice(TENANT_SEC, SEC_CASHIER);

    const invoicesA = await countInvoices(TENANT_SEC);
    const journalsA = await countJournals(TENANT_SEC);

    // (a) The device pulls items inside B's context: the feed is B's —
    // A's items never ride along (the device row cannot import its owner
    // tenant's data into another tenant's view).
    const inB = await withTenant(TENANT_SPOOF_B, () =>
      pullService({ entityType: "items", cursor: null, deviceId: device }),
    );
    const bIds = inB.changes.map((change) => change.id);
    expect(bIds).toContain(bItemId);
    expect(bIds).not.toContain(world.itemA);
    expect(bIds).not.toContain(world.itemB);

    // (b) The permissions spoof: A's user's snapshot projected in B —
    // the B-scoped key set for a foreign user is EMPTY (A's permission
    // keys never leak into a B-scoped view).
    const permsInB = await withTenant(TENANT_SPOOF_B, () =>
      pullService({ entityType: "permissions", cursor: null, deviceId: device }),
    );
    const snapshot = permsInB.changes[permsInB.changes.length - 1]!.payload as {
      userId: string;
      permissions: string[];
    };
    expect(snapshot.userId).toBe(SEC_CASHIER);
    expect(snapshot.permissions).toEqual([]);

    // …while the home-context snapshot carries A's real keys (the same
    // device, its own tenant — the contrast that proves the scoping).
    const permsHome = await withTenant(TENANT_SEC, () =>
      pullService({ entityType: "permissions", cursor: null, deviceId: device }),
    );
    const homeSnapshot = permsHome.changes[permsHome.changes.length - 1]!.payload as {
      permissions: string[];
    };
    expect(homeSnapshot.permissions).toContain("partners.view");
    expect(homeSnapshot.permissions).toContain("sync.devices.register");

    // (c) Both ledgers untouched by the spoofed session.
    expect(await countInvoices(TENANT_SEC)).toBe(invoicesA);
    expect(await countJournals(TENANT_SEC)).toBe(journalsA);
    const bLedger = await withTenant(TENANT_SPOOF_B, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT (SELECT count(*)::int FROM journal_entries) AS journals,
               (SELECT count(*)::int FROM sales_invoices) AS invoices
      `);
      return rows.rows[0] as { journals: number; invoices: number };
    });
    expect(bLedger).toMatchObject({ journals: 0, invoices: 0 });
    await ledgerOraclesHold(TENANT_SEC);
  });
});
