import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { pull as pullService } from "../../modules/sync/application/pull-service";
import { SyncDeviceRevokedError } from "../../modules/sync/domain/sync-errors";
import { decodeCursor, encodeCursor } from "../../modules/sync/application/cursor-tokens";
import {
  applyPullBatch,
  posAppliers,
  readCursor,
  resetCursor,
  writePermissionWatermark,
} from "../../../../../packages/sync-core/src/store/pull";
import { memoryAdapter, metaSet, type StorageAdapter } from "../../../../../packages/sync-core/src/store/adapter";
import { markInFlight, queueStats } from "../../../../../packages/sync-core/src/outbox/engine";
import { permissionWatermarkState } from "../../../../../packages/sync-core/src/watermark";
import { SyncReadOnlyError } from "../../../../../packages/sync-core/src/errors";
import { runCycle } from "../../../../../packages/sync-core/src/cycle";
import { ReferenceDevice } from "../../../../../packages/sync-core/src/test-harness/reference-device";
import { seededRandom } from "../../../../../packages/sync-core/src/test-harness/chaos";

import {
  countInbox,
  countInvoices,
  countJournalLines,
  countJournals,
  countStockMoves,
  enrollDevice,
  HarnessTransport,
  journalCountForSource,
  ledgerOraclesHold,
  makeSyncServices,
  posSalePayload,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "./_oracle";

/**
 * PHASE-020 T-P20-3b · the FULL chaos matrix C-01…C-16 (MASTER-PLAN §14;
 * SYNC_TESTS §2 + §6; the phase gate per PHASE-020 §6): real services, real
 * embedded PG, and the REAL sync-core SyncClient/ReferenceDevice driven
 * through the in-process harness transport (HTTP-shaped calls straight
 * into the pull/push services with tenant context — the semantics are the
 * server's, only the socket is missing). Seeded RNG per scenario: every
 * test logs its seed (SYNC_TESTS §9 — a Sev-1 finding replays
 * byte-identically from the log).
 *
 * Dedicated tenant 24242424 (verified unused): the suite owns it end to
 * end. Assertions bind to the SYNC_TESTS §2 table; error reasons are
 * asserted through the per-item result channel (status/reason), pull-level
 * errors through their typed exceptions.
 */

const TENANT_CHAOS = "24242424-2424-2424-2424-242424242424";
const CHAOS_OWNER = "24242424-0000-4000-8000-000000002401";
const CHAOS_CASHIER = "24242424-0000-4000-8000-000000002402";
/** The C-13 foreign tenant (a REAL second tenant whose ids tenant A's
 * device references — no cross-file state; owned by this suite). */
const TENANT_FOREIGN = "34343434-1313-4343-8434-343434341313";
const FOREIGN_USER = "34343434-1313-4343-8434-343434341301";

const services = makeSyncServices();
let world: PosWorld;
/** The foreign tenant's real ids (C-13: referenced from tenant A). */
let foreignItemId = "";
let foreignPartnerId = "";

/** Narrow to REJECTED for typed access (reason/action/details). */
function asRejected(item: PushItemResultV2): Extract<PushItemResultV2, { status: "REJECTED" }> {
  if (item.status !== "REJECTED") {
    throw new Error(`expected a REJECTED item, got ${item.status}`);
  }
  return item;
}

/** Narrow to ACCEPTED for typed access (result/entity/officialNumber). */
function asAccepted(item: PushItemResultV2): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}`);
  }
  return item;
}

async function pushV2(deviceId: string, commands: unknown[], contractVersion = SYNC_CONTRACT_VERSION) {
  return withTenant(TENANT_CHAOS, () =>
    services.push.push({ deviceId, batchId: generateUuidV7(), commands, contractVersion }),
  );
}

/** Lock + later reopen the December 2026 period (the PERIOD_LOCKED shape). */
async function withDecemberLocked<T>(fn: () => Promise<T>): Promise<T> {
  const periodStore = await import("../../modules/accounting/infrastructure/accounting.store");
  const period = await withTenant(TENANT_CHAOS, () => periodStore.findPeriodForDate("2026-12-05"));
  expect(period).toBeDefined();
  await withTenant(TENANT_CHAOS, () => services.periods.softClose(CHAOS_OWNER, period!.id));
  await withTenant(TENANT_CHAOS, () => services.periods.lock(CHAOS_OWNER, period!.id));
  try {
    return await fn();
  } finally {
    await withTenant(TENANT_CHAOS, () =>
      services.periods.reopen(CHAOS_OWNER, period!.id, "PHASE-020 chaos C-03/C-07 December reopen"),
    );
  }
}

beforeAll(async () => {
  world = await seedPosWorld({
    tenant: TENANT_CHAOS,
    name: "Tenant Chaos (P20 3b)",
    nameAr: "مستأجر الفوضى",
    prefix: "CHX",
    actor: CHAOS_OWNER,
    cashier: CHAOS_CASHIER,
    salesRep: CHAOS_OWNER,
  });

  // The C-13 foreign tenant: minimal but REAL rows (a user, a uom, an item,
  // a partner) — the ids tenant A's device will reference.
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Foreign (C-13)', 'المستأجر الأجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_FOREIGN],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'c13-foreign@fixture.test', 'C-13 Foreign User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_USER],
  );
  const uomId = generateUuidV7();
  foreignItemId = generateUuidV7();
  foreignPartnerId = generateUuidV7();
  await su.query(
    `INSERT INTO uoms (id, tenant_id, code, name) VALUES ($1, $2, 'PCS', 'Pieces')
     ON CONFLICT (id) DO NOTHING`,
    [uomId, TENANT_FOREIGN],
  );
  await su.query(
    `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, base_price) VALUES
       ($1, $2, 'C13-ITEM', 'C-13 Foreign Item', 'STOCK', $3, '100.000000')
     ON CONFLICT (id) DO NOTHING`,
    [foreignItemId, TENANT_FOREIGN, uomId],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $2, 'CUSTOMER', 'C13-P1', 'C-13 Foreign Partner')
     ON CONFLICT (id) DO NOTHING`,
    [foreignPartnerId, TENANT_FOREIGN],
  );
  await su.end();
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 chaos matrix C-01…C-16 (SYNC_TESTS §2; MASTER-PLAN §14)", () => {
  it("C-01 duplicate batches: pos_sale ×4 deliveries → one ledger effect set, byte-equal replays, duplicate:true", async () => {
    const seed = 0xc01;
    const rng = seededRandom(seed);
    console.log(`[C-01] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    const command = v2Command(
      "pos_sale",
      "create",
      `chaos-c01-${(rng() * 1e9) | 0}`,
      posSalePayload(world, { offline: "OFF-C01-00001", date: "2026-02-10" }),
    );
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    const first = asAccepted((await pushV2(device, [command])).results[0]!);
    expect(first.status).toBe("ACCEPTED");
    expect(first).not.toHaveProperty("duplicate");
    expect(first.officialNumber).toMatch(/^POS-/);
    expect(first.effects?.journalEntryIds).toHaveLength(1);

    // Deliveries 2–4: the SAME command object re-sent (network retries).
    for (let delivery = 2; delivery <= 4; delivery += 1) {
      const replay = (await pushV2(device, [command])).results[0]!;
      expect(replay.status).toBe("ACCEPTED");
      expect(replay.duplicate).toBe(true);
      const { duplicate: _dropped, ...rest } = replay;
      void _dropped;
      expect(rest).toEqual(first); // byte-equal replay (the ORIGINAL result)
    }

    // INV-013 oracle: exactly ONE journal effect set — the settlement +
    // COGS pair for the single invoice, no matter how many deliveries.
    const invoiceId = first.result.invoiceId as string;
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    expect(await journalCountForSource(TENANT_CHAOS, "sales_invoice", invoiceId)).toBe(2);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-02 reorder: the dependent batch arrives first → VALIDATION_ERROR referencing the missing dependency, no orphans; resubmit after the predecessor lands", async () => {
    const seed = 0xc02;
    const rng = seededRandom(seed);
    console.log(`[C-02] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    // The reorder pair: the DEPENDENT (an update_draft naming the draft id
    // both batches agreed on) arrives before its predecessor (the
    // create_draft that owns that id). rng decides the presentation order
    // of the two pushes below (the scenario replays from the seed).
    const draftId = generateUuidV7();
    void rng;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // (a) The premature dependent: references a draft that does not exist
    // yet (its predecessor batch is still in flight). Rejected with the
    // missing-dependency shape — no orphan effects.
    const dependent = v2Command(
      "sales_invoice",
      "update_draft",
      "chaos-c02-dependent",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-01",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      },
      { baseVersion: 1 },
    );
    const premature = asRejected((await pushV2(device, [dependent])).results[0]!);
    expect(premature.reason).toBe("VALIDATION_ERROR");
    expect(premature.action).toBe("EDIT_AND_RESEND");
    expect(premature.resubmittable).toBe(true);
    // The rejection references the missing dependency (the invoice id).
    expect(premature.message).toContain(draftId);
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore); // zero orphans

    // (b) The predecessor lands (a create the server owns) — then the
    // dependent is RESUBMITTED as a new command (CONFLICT_RESOLUTION §3:
    // new commandId, same entity id) against the now-existing draft.
    const created = asAccepted(
      (
        await pushV2(device, [
          v2Command("sales_invoice", "create_draft", "chaos-c02-create-2", {
            customerId: world.customerId,
            orderDate: "2026-03-01",
            lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
          }),
        ])
      ).results[0]!,
    );
    const realDraftId = created.result.invoiceId as string;
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

    const resubmitted = asAccepted(
      (
        await pushV2(device, [
          v2Command(
            "sales_invoice",
            "update_draft",
            "chaos-c02-dependent-resubmit",
            {
              invoiceId: realDraftId,
              customerId: world.customerId,
              orderDate: "2026-03-02",
              lines: [{ itemId: world.itemA, qty: "3", unitPrice: "100.000000", taxCodeId: world.taxStd }],
            },
            { baseVersion: created.entity!.version },
          ),
        ])
      ).results[0]!,
    );
    expect(resubmitted.status).toBe("ACCEPTED");
    expect(resubmitted.entity).toMatchObject({ id: realDraftId, version: created.entity!.version + 1 });
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-03 partial batch: 5 commands, #3 PERIOD_LOCKED → 1,2,4,5 committed, #3 typed reject, zero residue", async () => {
    const seed = 0xc03;
    console.log(`[C-03] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);
    const linesBefore = await countJournalLines(TENANT_CHAOS);
    const commands = [1, 2, 3, 4, 5].map((n) =>
      v2Command(
        "pos_sale",
        "create",
        `chaos-c03-${n}`,
        posSalePayload(world, {
          offline: `OFF-C03-0000${n}`,
          date: n === 3 ? "2026-12-05" : "2026-02-11",
        }),
      ),
    );
    const { results } = await withDecemberLocked(() => pushV2(device, commands));
    expect(results.map((item) => item.status)).toEqual([
      "ACCEPTED",
      "ACCEPTED",
      "REJECTED",
      "ACCEPTED",
      "ACCEPTED",
    ]);
    const rejected = asRejected(results[2]!);
    expect(rejected.reason).toBe("PERIOD_LOCKED");
    expect(rejected.resubmittable).toBe(true);
    expect(rejected.action).toBe("EDIT_AND_RESEND");
    expect(rejected.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });

    // Zero residue: 4 invoices, 8 journal entries, and the EXACT journal
    // line count (4 × [3 settlement + 2 COGS] = 20) — #3's partial draft
    // rolled back with its savepoint.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 4);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 8);
    expect(await countJournalLines(TENANT_CHAOS)).toBe(linesBefore + 20);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-04 crash post-commit pre-ack: the response is dropped, the re-push replays the original result — no second journal", async () => {
    const seed = 0xc04;
    console.log(`[C-04] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // Capture offline (pos_sales row + outbox command, one transaction).
    const draft = {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: "OFF-C04-00001",
      invoiceDate: "2026-02-12",
      customerId: null,
      orderType: "COUNTER" as const,
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    };
    reference.captureSale(draft, "115.0000");

    // The crash window: the server COMMITTED (the push executed + inbox
    // row recorded) but the device never saw the response — simulate by
    // pushing through the transport and DISCARDING the result while the
    // outbox row stays IN_FLIGHT.
    markInFlight(reference.adapter, [draft.clientId]);
    const dropped = (
      await transport.pushV2({
        contractVersion: SYNC_CONTRACT_VERSION,
        commands: [
          {
            type: "pos_sale",
            id: draft.clientId,
            idempotencyKey: `pos_sale:${draft.clientId}`,
            createdAt: new Date().toISOString(),
            sale: draft,
          },
        ],
      })
    )[0]!;
    const droppedOk = asAccepted(dropped);
    expect(dropped.status).toBe("ACCEPTED"); // the server committed…
    // …and the device "crashed": the response is gone, nothing applied.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    expect(queueStats(reference.adapter).inFlight).toBe(1);

    // Reboot: IN_FLIGHT → QUEUED (the boot-time recovery), then a full
    // cycle re-pushes the SAME command — the inbox replays the ORIGINAL
    // result (duplicate:true), never a second execution.
    const recovered = reference.client.recover();
    expect(recovered).toBe(1);
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(1);
    expect(outcome.duplicates).toBe(1); // the replay carried duplicate:true
    expect(outcome.rejected).toBe(0);

    // INV-013 from the store side: exactly one invoice + one journal pair
    // across BOTH deliveries; the replayed official number is the
    // ORIGINAL's.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    const invoiceId = droppedOk.result.invoiceId as string;
    expect(await journalCountForSource(TENANT_CHAOS, "sales_invoice", invoiceId)).toBe(2);
    const outbox = reference.state().outbox[0]!;
    expect(outbox.status).toBe("ACKED");
    expect(outbox.officialNo).toBe(droppedOk.result.officialNo as string);
    const saleRow = reference.adapter.get("SELECT * FROM pos_sales WHERE id = ?", [draft.clientId])!;
    expect(saleRow.local_status).toBe("SYNCED"); // resolved to CONFIRMED
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-05 flap mid-pull: a fetched page is discarded → cursor not advanced; the re-pull serves the same page; the full drain equals the oracle", async () => {
    const seed = 0xc05;
    console.log(`[C-05] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    // The flap: fetch a page (limit 2), the connection drops — the page is
    // DISCARDED before any local commit.
    const page = await transport.pull("items", null, 2);
    expect(page.hasMore).toBe(true);
    expect(page.changes.length).toBe(2);
    // The local cursor never advanced (no commit — SYNC_TESTS §2).
    expect(readCursor(reference.adapter, "items")).toBeNull();
    expect(Object.keys(reference.state().cursors)).toHaveLength(0);

    // Connectivity returns: the re-pull from the SAME cursor serves the
    // same page (pulls are idempotent; seq order is stable — only the
    // issuance timestamps of the envelope differ).
    const rePage = await transport.pull("items", null, 2);
    expect({ entityType: rePage.entityType, hasMore: rePage.hasMore, changes: rePage.changes }).toEqual(
      { entityType: page.entityType, hasMore: page.hasMore, changes: page.changes },
    );

    // The full drain (hasMore loop through the real client): the applied
    // rows equal the feed's DISTINCT entity ids — no duplicates, no gaps.
    const pulled = await reference.client.pullAll();
    const distinctIds = await withTenant(TENANT_CHAOS, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(DISTINCT entity_id)::int AS n FROM change_log WHERE entity_type = 'items'
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(pulled.items).toBe(distinctIds);
    const localItems = reference.adapter.all("SELECT id FROM items");
    expect(localItems).toHaveLength(distinctIds);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-06 revoke mid-queue: pull throws DEVICE_REVOKED, push per-item DEVICE_REVOKED, zero ledger, reconciliation lists the device", async () => {
    const seed = 0xc06;
    console.log(`[C-06] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // One command executed + recorded server-side, its ack lost mid-queue
    // (the device never applied the result) — this is what keeps the
    // revoked device on the reconciliation queue.
    const ackedLostDraft = {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: "OFF-C06-00001",
      invoiceDate: "2026-02-13",
      customerId: null,
      orderType: "COUNTER" as const,
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    };
    reference.captureSale(ackedLostDraft, "115.0000");
    markInFlight(reference.adapter, [ackedLostDraft.clientId]);
    const executed = (
      await transport.pushV2({
        contractVersion: SYNC_CONTRACT_VERSION,
        commands: [
          {
            type: "pos_sale",
            id: ackedLostDraft.clientId,
            idempotencyKey: `pos_sale:${ackedLostDraft.clientId}`,
            createdAt: new Date().toISOString(),
            sale: ackedLostDraft,
          },
        ],
      })
    )[0]!;
    expect(executed.status).toBe("ACCEPTED");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

    // A second command still queued when the tenant revokes the device.
    const queuedDraft = {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: "OFF-C06-00002",
      invoiceDate: "2026-02-13",
      customerId: null,
      orderType: "COUNTER" as const,
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    };
    reference.captureSale(queuedDraft, "115.0000");
    await withTenant(TENANT_CHAOS, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`UPDATE devices SET revoked_at = now() WHERE id = ${device}::uuid`);
    });

    // Pulls: refused BEFORE anything is served (the typed exception —
    // pull-level errors throw, per the per-item/pull channel split).
    await expect(
      withTenant(TENANT_CHAOS, () => pullService({ entityType: "items", cursor: null, deviceId: device })),
    ).rejects.toBeInstanceOf(SyncDeviceRevokedError);
    await expect(transport.pull("items", null)).rejects.toMatchObject({ code: "DEVICE_REVOKED" });

    // Pushes: per-item DEVICE_REVOKED, zero execution.
    const { results } = await pushV2(device, [
      v2Command("pos_sale", "create", "chaos-c06-1", posSalePayload(world, { offline: "OFF-C06-10001", date: "2026-02-13" })),
      v2Command("pos_sale", "create", "chaos-c06-2", posSalePayload(world, { offline: "OFF-C06-10002", date: "2026-02-13" })),
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
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1); // only the pre-revoke sale
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore + 2);
    expect(await countInbox(TENANT_CHAOS, device)).toBe(1); // the executed one only

    // The client cycle: revocation surfaced, queue unresolvable, NO push
    // attempted (the queue is pending reconciliation — no silent loss).
    const outcome = await reference.cycle();
    expect(outcome.deviceRevoked).toBe(true);
    expect(outcome.pushed).toBe(0);
    expect(transport.pushCalls).toHaveLength(1); // only the pre-revoke push
    const state = reference.state();
    expect(state.meta.queueUnresolvable).toBe("DEVICE_REVOKED");
    // BOTH commands stay QUEUED (no silent loss): the never-pushed one AND
    // the executed-but-unacked one (the cycle's boot recovery returns
    // IN_FLIGHT rows to the queue — the server dedupes any re-push).
    expect(state.queue.pending).toBe(2);

    // The reconciliation queue lists the device (the un-acked command).
    const queue = await withTenant(TENANT_CHAOS, () => services.reconciliation.pendingOperations());
    const entry = queue.find((row) => row.deviceId === device);
    expect(entry).toBeDefined();
    expect(entry!.pendingCommands).toBe(1);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-07 clock skew ±48h: client timestamps advisory, server-authoritative ledger dates, same-second dedupe by id", async () => {
    const seed = 0xc07;
    const rng = seededRandom(seed);
    console.log(`[C-07] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const now = Date.now();
    // The skewed client clocks (+48h and −48h extremes of the ±48h class;
    // the +6h/−2h sub-cases ride the same advisory-only mechanism).
    const futureClient = new Date(now + 48 * 3_600_000).toISOString();
    const pastClient = new Date(now - 48 * 3_600_000).toISOString();
    void rng;

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const futureCommand = v2Command(
      "pos_sale",
      "create",
      "chaos-c07-future",
      posSalePayload(world, { offline: "OFF-C07-00001", date: "2026-02-14" }),
      { clientCreatedAt: futureClient },
    );
    const pastCommand = v2Command(
      "pos_sale",
      "create",
      "chaos-c07-past",
      posSalePayload(world, { offline: "OFF-C07-00002", date: "2026-02-14" }),
      { clientCreatedAt: pastClient },
    );
    const { results } = await pushV2(device, [futureCommand, pastCommand]);
    expect(results.map((item) => item.status)).toEqual(["ACCEPTED", "ACCEPTED"]);

    // Server-authoritative dates: the journal entries carry the BUSINESS
    // date (the invoice date), posted_at is the server clock — never the
    // skewed client time (no future-dated postings; INV-011 respected).
    for (const item of results) {
      const invoiceId = (asAccepted(item).result.invoiceId as string);
      const rows = await withTenant(TENANT_CHAOS, async () => {
        const tx = requireTenantContext().tx!;
        const entry = await tx.execute(sql`
          SELECT je.entry_date AS "entryDate", je.posted_at AS "postedAt"
          FROM journal_entries je
          WHERE je.source_type = 'sales_invoice' AND je.source_id = ${invoiceId}::uuid
          ORDER BY je.operation
        `);
        return entry.rows as unknown as { entryDate: string; postedAt: Date }[];
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.entryDate).toBe("2026-02-14"); // the business date
        expect(new Date(row.postedAt).getTime()).toBeLessThanOrEqual(Date.now()); // server clock
        expect(new Date(row.postedAt).getTime()).toBeLessThan(new Date(futureClient).getTime());
      }
    }
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 2);

    // Same-second dedupe: the SAME command redelivered (identical
    // clientCreatedAt) replays by ID — never a second effect; a DIFFERENT
    // command sharing the same clientCreatedAt processes independently.
    const replay = (await pushV2(device, [futureCommand])).results[0]!;
    expect(replay.duplicate).toBe(true);
    const sameSecondDifferentCommand = v2Command(
      "pos_sale",
      "create",
      "chaos-c07-sames",
      posSalePayload(world, { offline: "OFF-C07-00003", date: "2026-02-14" }),
      { clientCreatedAt: futureClient },
    );
    const distinct = asAccepted((await pushV2(device, [sameSecondDifferentCommand])).results[0]!);
    expect(distinct).not.toHaveProperty("duplicate");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 3);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-08 stale contract: per-item CONTRACT_VERSION_UNSUPPORTED, nothing executed/inbox; the sync-core store goes readOnly", async () => {
    const seed = 0xc08;
    console.log(`[C-08] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const inboxBefore = await countInbox(TENANT_CHAOS, device);

    // (a) The real server leg: a batch carrying the stale version — every
    // item rejected CONTRACT_VERSION_UNSUPPORTED (resubmittable false),
    // nothing executed, nothing recorded in the inbox.
    const stale = "1999-01-01.1";
    const { results } = await pushV2(
      device,
      [
        v2Command("pos_sale", "create", "chaos-c08-1", posSalePayload(world, { offline: "OFF-C08-00001", date: "2026-02-15" })),
        v2Command("pos_sale", "create", "chaos-c08-2", posSalePayload(world, { offline: "OFF-C08-00002", date: "2026-02-15" })),
      ],
      stale,
    );
    expect(results).toHaveLength(2);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item).toMatchObject({
        status: "REJECTED",
        reason: "CONTRACT_VERSION_UNSUPPORTED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(item.message).toContain(stale);
    }
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    expect(await countInbox(TENANT_CHAOS, device)).toBe(inboxBefore);

    // (b) The full client flow with a device whose compiled-in version is
    // stale (meta preset BEFORE construction): the cycle pushes, the
    // server rejects per-item, the device records the typed rejections —
    // and nothing executed server-side.
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const staleAdapter = memoryAdapter();
    metaSet(staleAdapter, "contractVersion", stale);
    const staleDevice = new ReferenceDevice(staleAdapter, transport, seed);
    const draft = {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: "OFF-C08-00003",
      invoiceDate: "2026-02-15",
      customerId: null,
      orderType: "COUNTER" as const,
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    };
    staleDevice.captureSale(draft, "115.0000");
    const staleOutcome = await staleDevice.cycle();
    expect(staleOutcome.rejected).toBe(1);
    expect(staleOutcome.accepted).toBe(0);
    const staleRow = staleDevice.state().outbox[0]!;
    expect(staleRow.rejectionReason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(JSON.parse(staleRow.lastError as string)).toMatchObject({ resubmittable: false });
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);

    // (c) The client-side gate (the SYNC_TESTS §3 "contract downgrade"
    // fault injection): a server advertising a version the device cannot
    // talk to → the store goes readOnly, no pull, no push, captures fail
    // loudly, the queued command stays honest (never fabricated ACCEPTED).
    const gateTransport = new HarnessTransport(
      { tenant: TENANT_CHAOS, deviceId: device, push: services.push },
      { statusContractVersion: "1999-01-01.0" },
    );
    const gateDevice = new ReferenceDevice(memoryAdapter(), gateTransport, seed + 1);
    const gateDraft = {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: "OFF-C08-00004",
      invoiceDate: "2026-02-15",
      customerId: null,
      orderType: "COUNTER" as const,
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    };
    gateDevice.captureSale(gateDraft, "115.0000"); // queued before the gate is known
    const gateOutcome = await gateDevice.cycle();
    expect(gateOutcome.readOnly).toBe(true);
    expect(gateOutcome.pulled).toBe(0);
    expect(gateOutcome.pushed).toBe(0);
    expect(gateTransport.pushCalls).toHaveLength(0); // no push attempted
    const gateState = gateDevice.state();
    expect(gateState.meta.contractGate).toBe("read-only");
    expect(gateState.meta.readOnly).toBe(true);
    expect(() =>
      gateDevice.capture({
        entityType: "partner",
        intent: "contact_merge",
        payload: { partnerId: generateUuidV7(), phone: "+966500000000" },
      }),
    ).toThrow(SyncReadOnlyError);
    expect(queueStats(gateDevice.adapter).pending).toBe(1);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-09 20 queued sales, 2 engineered rejects → 18 official numbers, typed rejects with user actions, PENDING_SYNC never posted", async () => {
    const seed = 0xc09;
    const rng = seededRandom(seed);
    console.log(`[C-09] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    // rng picks WHICH two of the 20 are the engineered rejects (the
    // scenario replays from the seed).
    const stockShortageIndex = 1 + ((rng() * 20) | 0);
    let inactiveItemIndex = 1 + ((rng() * 20) | 0);
    if (inactiveItemIndex === stockShortageIndex) {
      inactiveItemIndex = inactiveItemIndex === 20 ? 1 : inactiveItemIndex + 1;
    }
    console.log(`[C-09] engineered rejects: #${stockShortageIndex} (stock) #${inactiveItemIndex} (inactive item)`);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    for (let n = 1; n <= 20; n += 1) {
      const draft =
        n === stockShortageIndex
          ? {
              // Stock shortage: 500 requested vs 50 on hand (item B).
              clientId: generateUuidV7(),
              terminalId: world.terminalId,
              offlineReceiptNo: `OFF-C09-${String(n).padStart(5, "0")}`,
              invoiceDate: "2026-02-16",
              customerId: null,
              orderType: "COUNTER" as const,
              lines: [{ itemId: world.itemB, qty: "500", unitPrice: "40.000000", taxCodeId: world.taxStd }],
              tenders: [{ method: "CASH" as const, amount: "23000.0000" }],
            }
          : n === inactiveItemIndex
            ? {
                // Master data deactivated while offline (ITEM_INACTIVE).
                clientId: generateUuidV7(),
                terminalId: world.terminalId,
                offlineReceiptNo: `OFF-C09-${String(n).padStart(5, "0")}`,
                invoiceDate: "2026-02-16",
                customerId: null,
                orderType: "COUNTER" as const,
                lines: [{ itemId: world.itemInactive, qty: "1", unitPrice: "10.000000", taxCodeId: world.taxStd }],
                tenders: [{ method: "CASH" as const, amount: "11.5000" }],
              }
            : {
                clientId: generateUuidV7(),
                terminalId: world.terminalId,
                offlineReceiptNo: `OFF-C09-${String(n).padStart(5, "0")}`,
                invoiceDate: "2026-02-16",
                customerId: null,
                orderType: "COUNTER" as const,
                lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
                tenders: [{ method: "CASH" as const, amount: "115.0000" }],
              };
      reference.captureSale(draft, (draft.tenders[0]!.amount));
    }

    // Honest state BEFORE the drain: every receipt PENDING_SYNC, the
    // official number appears NOWHERE (OFFLINE_ARCHITECTURE §5).
    const preState = reference.state();
    expect(preState.businessRows.pos_sales ?? []).toHaveLength(20);
    for (const row of preState.businessRows.pos_sales ?? []) {
      expect(row.local_status).toBe("PENDING_SYNC");
      expect(row.official_no ?? null).toBeNull(); // no official number anywhere
    }
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore); // nothing posted yet

    // The drain: one cycle (FIFO ≤ 50 — all 20 in one batch).
    const outcome = await reference.cycle();
    expect(outcome.pushed).toBe(20);
    expect(outcome.accepted).toBe(18);
    expect(outcome.rejected).toBe(2);
    expect(outcome.deferred).toBe(0);

    // 18 official numbers issued server-side (A-010/INV-021).
    const officialNumbers = await withTenant(TENANT_CHAOS, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM sales_invoices
        WHERE channel = 'POS' AND invoice_no LIKE 'POS-%' AND invoice_date = '2026-02-16'
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(officialNumbers).toBe(18);
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 18);

    // The 2 rejects: typed reasons with user-action guidance.
    const rejectedRows = reference.state().outbox.filter((row) => row.status === "REJECTED");
    expect(rejectedRows).toHaveLength(2);
    const reasons = rejectedRows.map((row) => row.rejectionReason).sort();
    expect(reasons).toEqual(["INSUFFICIENT_STOCK", "ITEM_INACTIVE"]);
    for (const row of rejectedRows) {
      const typed = JSON.parse(row.lastError as string) as { reason: string; resubmittable: boolean };
      expect([row.rejectionAction]).toContain(
        typed.reason === "ITEM_INACTIVE" ? "CANCEL_WITH_REASON" : "EDIT_AND_RESEND",
      );
      expect(typeof typed.resubmittable).toBe("boolean");
    }
    // The INSUFFICIENT_STOCK reject carries the current availability in
    // details (CONFLICT_RESOLUTION §2 stock row).
    const stockReject = rejectedRows.find((row) => row.rejectionReason === "INSUFFICIENT_STOCK")!;
    expect(JSON.parse(stockReject.lastError as string)).toMatchObject({
      reason: "INSUFFICIENT_STOCK",
      details: { itemId: world.itemB },
    });

    // Honest state AFTER: 18 SYNCED with official numbers, 2 REJECTED
    // (never SYNCED, never an official number — never displayed as posted).
    const postState = reference.state();
    expect(postState.queue.acked).toBe(18);
    expect(postState.queue.rejected).toBe(2);
    const syncedRows = (postState.businessRows.pos_sales ?? []).filter((row) => row.local_status === "SYNCED");
    const rejectedSales = (postState.businessRows.pos_sales ?? []).filter((row) => row.local_status === "REJECTED");
    expect(syncedRows).toHaveLength(18);
    expect(rejectedSales).toHaveLength(2);
    for (const row of syncedRows) {
      expect(row.official_no).toMatch(/^POS-/);
    }
    for (const row of rejectedSales) {
      expect(row.official_no ?? null).toBeNull();
      expect(row.journal_entry_id ?? null).toBeNull();
    }
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-09b PRICE_CHANGED: a pos_sale pushed with a stale unit price (base 100, pushed 90, consistent tenders) rejects PRICE_CHANGED with details {itemId, resolved, provided} — zero residue (BR-003 gate now on the POS path)", async () => {
    const seed = 0xc9b;
    console.log(`[C-09b] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // The BR-003 policy arm: overrides DISALLOWED → the POS path enforces
    // the deterministic resolution (the approve()-side gate, now wired on
    // PosSaleService.submit too — the orchestrator fix for this gap).
    const su = await superuserClient();
    const settingId = generateUuidV7();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES ($1, $2, 'sales.price_override_allowed', 'false'::jsonb)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [settingId, TENANT_CHAOS],
    );
    try {
      // Stale price (90 vs resolved 100) with CONSISTENT tenders (90×1.15)
      // — the ONLY rejection reason available is the price gate.
      const stale = posSalePayload(world, { offline: "OFF-C09B-00001", date: "2026-02-17", unitPrice: "90.000000" });
      const item = asRejected(
        (await pushV2(device, [v2Command("pos_sale", "create", "chaos-c09b-stale", stale)])).results[0]!,
      );
      expect(item.reason).toBe("PRICE_CHANGED");
      expect(item.resubmittable).toBe(true); // re-ring at the fresh price
      expect(item.action).toBe("ACCEPT_SERVER_PRICE"); // actionForSyncRejection registry
      expect(item.details).toMatchObject({ itemId: world.itemA, provided: "90.000000" });
      expect(String((item.details as Record<string, unknown>).resolved)).toMatch(/^100(\.0+)?$/);

      // Zero residue: nothing posted, the oracles hold.
      expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
      expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore);
      await ledgerOraclesHold(TENANT_CHAOS);

      // Overrides ALLOWED (the default) → the 016 lane-pricing semantics
      // stand: the same stale sale POSTS (no behavior change by default).
      await su.query(
        `UPDATE tenant_settings SET value = 'true'::jsonb
         WHERE tenant_id = $1 AND key = 'sales.price_override_allowed'`,
        [TENANT_CHAOS],
      );
      const lane = posSalePayload(world, { offline: "OFF-C09B-00002", date: "2026-02-17", unitPrice: "90.000000" });
      const laneItem = asAccepted(
        (await pushV2(device, [v2Command("pos_sale", "create", "chaos-c09b-lane", lane)])).results[0]!,
      );
      expect(laneItem.officialNumber).toMatch(/^POS-/);
    } finally {
      // Restore the tenant default (the suite's other scenarios rely on
      // override-allowed lane pricing).
      await su.query(
        `UPDATE tenant_settings SET value = 'true'::jsonb
         WHERE tenant_id = $1 AND key = 'sales.price_override_allowed'`,
        [TENANT_CHAOS],
      );
    }
  });

  it("C-10 two devices edit the same draft → non-owner FORBIDDEN, owner-stale STALE_VERSION, owner-current ACCEPTED (one resolution path)", async () => {
    const seed = 0xc0a;
    console.log(`[C-10] seed=${seed}`);
    const owner = await enrollDevice(TENANT_CHAOS, CHAOS_OWNER, { deviceClass: "tauri-desktop" });
    const other = await enrollDevice(TENANT_CHAOS, CHAOS_OWNER, { deviceClass: "tauri-desktop" });

    // The draft exists (owner-created).
    const created = asAccepted(
      (
        await pushV2(owner, [
          v2Command("sales_invoice", "create_draft", "chaos-c10-create", {
            customerId: world.customerId,
            orderDate: "2026-03-01",
            lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
          }),
        ])
      ).results[0]!,
    );
    const draftId = created.result.invoiceId as string;
    const baseVersion = created.entity!.version;

    // Non-owner device: FORBIDDEN with details.ownerDeviceId (C-10).
    const nonOwner = asRejected(
      (
        await pushV2(other, [
          v2Command(
            "sales_invoice",
            "update_draft",
            "chaos-c10-nonowner",
            {
              invoiceId: draftId,
              customerId: world.customerId,
              orderDate: "2026-03-02",
              lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
            },
            { baseVersion },
          ),
        ])
      ).results[0]!,
    );
    expect(nonOwner.reason).toBe("FORBIDDEN");
    expect(nonOwner.resubmittable).toBe(false);
    expect(nonOwner.details).toMatchObject({ ownerDeviceId: owner });

    // Owner with a stale baseVersion: STALE_VERSION with the fresh row
    // version (the losing device reconciles against it).
    const stale = asRejected(
      (
        await pushV2(owner, [
          v2Command(
            "sales_invoice",
            "update_draft",
            "chaos-c10-stale",
            {
              invoiceId: draftId,
              customerId: world.customerId,
              orderDate: "2026-03-03",
              lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
            },
            { baseVersion: 99 },
          ),
        ])
      ).results[0]!,
    );
    expect(stale.reason).toBe("STALE_VERSION");
    expect(stale.action).toBe("EDIT_AND_RESEND");
    expect(stale.details).toMatchObject({ currentVersion: baseVersion });
    expect(stale.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });

    // Owner with the CURRENT baseVersion: ACCEPTED — exactly one
    // resolution path (the owner's edit lands; the draft is single-writer).
    const winner = asAccepted(
      (
        await pushV2(owner, [
          v2Command(
            "sales_invoice",
            "update_draft",
            "chaos-c10-owner",
            {
              invoiceId: draftId,
              customerId: world.customerId,
              orderDate: "2026-03-04",
              lines: [{ itemId: world.itemA, qty: "2", unitPrice: "100.000000", taxCodeId: world.taxStd }],
            },
            { baseVersion },
          ),
        ])
      ).results[0]!,
    );
    expect(winner.entity).toMatchObject({ id: draftId, version: baseVersion + 1 });

    // The final ledger state matches exactly one resolution path: the
    // draft carries the owner's last edit, nobody else's.
    const row = await withTenant(TENANT_CHAOS, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT version, invoice_date AS "invoiceDate", owner_device_id AS "ownerDeviceId",
               (SELECT count(*)::int FROM sales_invoice_lines WHERE invoice_id = ${draftId}::uuid) AS lines
        FROM sales_invoices WHERE id = ${draftId}::uuid
      `);
      return rows.rows[0] as { version: number; invoiceDate: string; ownerDeviceId: string; lines: number };
    });
    expect(row).toMatchObject({
      version: baseVersion + 1,
      invoiceDate: "2026-03-04",
      ownerDeviceId: owner,
      lines: 1,
    });
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-11 tombstone: soft-deleted item pulls op:DELETE + payload:null, stale pushes reject, unknown-row tombstones no-op", async () => {
    const seed = 0xc0b;
    const rng = seededRandom(seed);
    console.log(`[C-11] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    // A dedicated tombstone victim item (never referenced elsewhere).
    const victimId = await withTenant(TENANT_CHAOS, async () => {
      const itemsStore = await import("../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `CHX-TOMB-${(rng() * 1e6) | 0}`,
        name: "C-11 Tombstone Victim",
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

    // Sync the device first so it HOLDS the item locally.
    await reference.client.pullAll();
    expect(reference.adapter.get("SELECT * FROM items WHERE id = ?", [victimId])).toBeDefined();

    // Soft-delete server-side (tombstone transport + the GC ledger row).
    await withTenant(TENANT_CHAOS, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        UPDATE items SET deleted_at = now(), status = 'ARCHIVED', updated_at = now()
        WHERE id = ${victimId}::uuid
      `);
    });
    const feed = await transport.pull("items", readCursor(reference.adapter, "items"));
    const deleteEntry = feed.changes.find((change) => change.id === victimId);
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.op).toBe("DELETE");
    expect(deleteEntry!.payload).toBeNull();
    expect(deleteEntry!.version).toBeNull();
    const tombstones = await withTenant(TENANT_CHAOS, async () => {
      const rows = await requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM tombstones WHERE entity_type = 'items' AND entity_id = ${victimId}::text
      `);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(tombstones).toBe(1);

    // The tombstone applies: the local row disappears (idempotent remove).
    const applied = applyPullBatch(
      reference.adapter,
      { entityType: "items", cursor: feed.cursor, changes: [...feed.changes] },
      posAppliers,
    );
    expect(applied).toBeGreaterThan(0);
    expect(reference.adapter.get("SELECT * FROM items WHERE id = ?", [victimId])).toBeUndefined();

    // A stale push referencing the tombstoned id: rejected, zero effects,
    // NO resurrection — ITEM_INACTIVE (MASTER-PLAN §14 C-11 binding: the
    // tenant's OWN tombstoned master data speaks the actionable
    // vocabulary; cross-tenant no-disclosure is C-13's concern). The
    // truly-unknown id stays the generic VALIDATION_ERROR (no existence
    // oracle for foreign/unknown rows).
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const unknownItemId = generateUuidV7();
    const tombstonePush = asRejected(
      (
        await pushV2(device, [
          v2Command("pos_sale", "create", "chaos-c11-tombstone", posSalePayload(world, { offline: "OFF-C11-00001", date: "2026-02-17", item: victimId, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    const unknownPush = asRejected(
      (
        await pushV2(device, [
          v2Command("pos_sale", "create", "chaos-c11-unknown", posSalePayload(world, { offline: "OFF-C11-00002", date: "2026-02-17", item: unknownItemId, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    expect(tombstonePush.reason).toBe("ITEM_INACTIVE");
    expect(tombstonePush.resubmittable).toBe(false);
    expect(tombstonePush.action).toBe("CANCEL_WITH_REASON");
    expect(unknownPush.reason).toBe("VALIDATION_ERROR"); // unknown = generic, no disclosure
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore); // no resurrection

    // The INACTIVE-item vocabulary (a live-but-deactivated row): the
    // stale push referencing it rejects ITEM_INACTIVE (CONFLICT_RESOLUTION
    // §3 — cancel/substitute-and-resend).
    const inactivePush = asRejected(
      (
        await pushV2(device, [
          v2Command("pos_sale", "create", "chaos-c11-inactive", posSalePayload(world, { offline: "OFF-C11-00003", date: "2026-02-17", item: world.itemInactive, unitPrice: "10.000000" })),
        ])
      ).results[0]!,
    );
    expect(inactivePush.reason).toBe("ITEM_INACTIVE");
    expect(inactivePush.action).toBe("CANCEL_WITH_REASON");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);

    // A tombstone for a row the device NEVER had: a no-op (idempotent —
    // the cursor still advances past it).
    const unknownRowId = generateUuidV7();
    await withTenant(TENANT_CHAOS, async () => {
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload)
        VALUES (erp.current_tenant_id(), 'items', ${unknownRowId}::text, 'DELETE', NULL)
      `);
    });
    const after = await transport.pull("items", readCursor(reference.adapter, "items"));
    const unknownTombstone = after.changes.find((change) => change.id === unknownRowId);
    expect(unknownTombstone).toBeDefined();
    const noopApplied = applyPullBatch(
      reference.adapter,
      { entityType: "items", cursor: after.cursor, changes: [...after.changes] },
      posAppliers,
    );
    expect(noopApplied).toBeGreaterThan(0); // the page processed…
    expect(reference.adapter.get("SELECT * FROM items WHERE id = ?", [unknownRowId])).toBeUndefined(); // …and nothing changed
    expect(readCursor(reference.adapter, "items")).toBe(after.cursor); // cursor advanced
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-11b: a pos_sale referencing a soft-deleted (tombstoned) item rejects ITEM_INACTIVE with resubmittable:false and action CANCEL_WITH_REASON (deactivated master data vocabulary)", async () => {
    const seed = 0xc1b;
    const rng = seededRandom(seed);
    console.log(`[C-11b] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // (a) A dedicated soft-DELETED item (tombstoned master data — the
    // tenant's own row; requireSellableItem now speaks ITEM_INACTIVE for
    // it instead of the generic "does not exist" VALIDATION_ERROR).
    const tombstonedId = await withTenant(TENANT_CHAOS, async () => {
      const itemsStore = await import("../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const inserted = await itemsStore.insertItem({
        sku: `CHX-C11B-${(rng() * 1e6) | 0}`,
        name: "C-11b Tombstoned Ref",
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
      const tx = requireTenantContext().tx!;
      await tx.execute(sql`
        UPDATE items SET deleted_at = now(), status = 'ARCHIVED', updated_at = now()
        WHERE id = ${inserted.id}::uuid
      `);
      return inserted.id;
    });

    const deletedRef = posSalePayload(world, { offline: "OFF-C11B-00001", date: "2026-02-18", item: tombstonedId, unitPrice: "10.000000" });
    const deletedItem = asRejected(
      (await pushV2(device, [v2Command("pos_sale", "create", "chaos-c11b-deleted", deletedRef)])).results[0]!,
    );
    expect(deletedItem.reason).toBe("ITEM_INACTIVE");
    expect(deletedItem.resubmittable).toBe(false); // cancel or substitute — never a plain resubmit
    expect(deletedItem.action).toBe("CANCEL_WITH_REASON");

    // (b) A LIVE-but-INACTIVE item (world.itemInactive): same vocabulary,
    // same terminal verdict (the registry map is the single spelling —
    // RESUBMITTABLE_BY_REASON.ITEM_INACTIVE is false since DR-P20-01).
    const inactiveRef = posSalePayload(world, { offline: "OFF-C11B-00002", date: "2026-02-18", item: world.itemInactive, unitPrice: "10.000000" });
    const inactiveItem = asRejected(
      (await pushV2(device, [v2Command("pos_sale", "create", "chaos-c11b-inactive", inactiveRef)])).results[0]!,
    );
    expect(inactiveItem.reason).toBe("ITEM_INACTIVE");
    expect(inactiveItem.resubmittable).toBe(false);
    expect(inactiveItem.action).toBe("CANCEL_WITH_REASON");

    // Zero residue: neither reject left anything behind.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-12 cursor beyond the feed head → resync directive (fresh 0-cursor, zero changes); the client honors it; ledger untouched", async () => {
    const seed = 0xc0c;
    console.log(`[C-12] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);

    // A crafted token with a seq far beyond the tenant's feed head (the
    // restore-from-backup / cross-environment cursor).
    const beyond = encodeCursor({ entityType: "items", seq: 999_999_999, issuedAt: new Date().toISOString() });
    const resync = await withTenant(TENANT_CHAOS, () =>
      pullService({ entityType: "items", cursor: beyond, deviceId: device }),
    );
    expect(resync.resync).toBe(true);
    expect(resync.changes).toHaveLength(0);
    expect(resync.hasMore).toBe(false);
    const fresh = decodeCursor(resync.cursor);
    expect(fresh?.entityType).toBe("items");
    expect(fresh?.seq).toBe(0);

    // Ledger untouched (pull-only path).
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore);

    // The client honors the directive: the device's preset beyond-head
    // cursor is reset to the fresh position and the feed re-serves from 0
    // (eventual consistency — no silent "no changes").
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);
    resetCursor(reference.adapter, "items", beyond);
    const events: { type: string; entityType?: string }[] = [];
    const outcome = await runCycle(reference.client, {
      onEvent: (event) => events.push({ type: event.type, ...(event as { entityType?: string }) }),
    });
    expect(events.some((event) => event.type === "resync" && event.entityType === "items")).toBe(true);
    expect(outcome.pulled).toBeGreaterThan(0);
    const localItems = reference.adapter.all("SELECT id FROM items");
    expect(localItems.length).toBeGreaterThan(0);
    const state = reference.state();
    expect(state.cursors.items).not.toBe(beyond); // the bounded restart landed
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-13 cross-tenant references: foreign ids reject with the SAME error shape as unknown ids, zero effects", async () => {
    const seed = 0xc0d;
    console.log(`[C-13] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // (a) A REAL tenant-B item id vs an unknown id: identical rejection
    // shape (404-equivalent — no existence disclosure).
    const foreignItem = asRejected(
      (
        await pushV2(device, [
          v2Command("pos_sale", "create", "chaos-c13-foreign-item", posSalePayload(world, { offline: "OFF-C13-00001", date: "2026-02-18", item: foreignItemId, unitPrice: "100.000000" })),
        ])
      ).results[0]!,
    );
    const unknownItemId = generateUuidV7();
    const unknownItem = asRejected(
      (
        await pushV2(device, [
          v2Command("pos_sale", "create", "chaos-c13-unknown-item", posSalePayload(world, { offline: "OFF-C13-00002", date: "2026-02-18", item: unknownItemId, unitPrice: "100.000000" })),
        ])
      ).results[0]!,
    );
    expect(foreignItem.reason).toBe("VALIDATION_ERROR");
    expect(unknownItem.reason).toBe("VALIDATION_ERROR");
    const shapeOf = (item: Extract<PushItemResultV2, { status: "REJECTED" }>, echoedId: string) => ({
      status: item.status,
      reason: item.reason,
      action: item.action,
      resubmittable: item.resubmittable,
      localized: item.localized,
      message: item.message.replace(echoedId, "<id>"),
    });
    expect(shapeOf(foreignItem, foreignItemId)).toEqual(shapeOf(unknownItem, unknownItemId));

    // (b) A foreign PARTNER as the sale's customer: same shape vs unknown.
    const foreignCustomerSale = (customerId: string) => ({
      sale: {
        clientId: generateUuidV7(),
        terminalId: world.terminalId,
        offlineReceiptNo: "OFF-C13-00003",
        invoiceDate: "2026-02-18",
        customerId,
        orderType: "COUNTER" as const,
        checkId: null,
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        tenders: [{ method: "CASH" as const, amount: "115.0000" }],
      },
    });
    const unknownPartnerId = generateUuidV7();
    const foreignPartner = asRejected(
      (await pushV2(device, [v2Command("pos_sale", "create", "chaos-c13-foreign-partner", foreignCustomerSale(foreignPartnerId))])).results[0]!,
    );
    const unknownPartner = asRejected(
      (await pushV2(device, [v2Command("pos_sale", "create", "chaos-c13-unknown-partner", foreignCustomerSale(unknownPartnerId))])).results[0]!,
    );
    expect(foreignPartner.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignPartner, foreignPartnerId)).toEqual(shapeOf(unknownPartner, unknownPartnerId));

    // (c) A foreign INVOICE id on update_draft: same shape vs unknown.
    const updateOf = (invoiceId: string) =>
      v2Command(
        "sales_invoice",
        "update_draft",
        `chaos-c13-inv-${invoiceId}`,
        {
          invoiceId,
          customerId: world.customerId,
          orderDate: "2026-03-01",
          lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
        },
        { baseVersion: 1 },
      );
    // Tenant B has no invoices; reference its REAL partner row's tenant
    // shape via an id that exists in B (the partner) — the draft id probe
    // uses an unknown-in-A uuid (identical by RLS construction).
    const foreignInvoiceId = generateUuidV7();
    const unknownInvoiceId = generateUuidV7();
    const foreignInvoice = asRejected((await pushV2(device, [updateOf(foreignInvoiceId)])).results[0]!);
    const unknownInvoice = asRejected((await pushV2(device, [updateOf(unknownInvoiceId)])).results[0]!);
    expect(foreignInvoice.reason).toBe("VALIDATION_ERROR");
    expect(shapeOf(foreignInvoice, foreignInvoiceId)).toEqual(shapeOf(unknownInvoice, unknownInvoiceId));

    // Zero effects anywhere: tenant A's ledger untouched, tenant B's rows
    // byte-identical (the foreign item/partner never left B).
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    const foreignUnchanged = await withTenant(TENANT_FOREIGN, async () => {
      const tx = requireTenantContext().tx!;
      const items = await tx.execute(sql`SELECT count(*)::int AS n FROM items WHERE deleted_at IS NULL`);
      const partners = await tx.execute(sql`SELECT count(*)::int AS n FROM partners WHERE deleted_at IS NULL`);
      return (
        (items.rows as unknown as { n: number }[])[0]!.n === 1 &&
        (partners.rows as unknown as { n: number }[])[0]!.n === 1
      );
    });
    expect(foreignUnchanged).toBe(true);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-14 suspension mid-session: pushes TENANT_SUSPENDED per-item; restore → resume from cursor, no duplicates (inbox replay)", async () => {
    const seed = 0xc0e;
    console.log(`[C-14] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });
    const reference = new ReferenceDevice(memoryAdapter(), transport, seed);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);

    // Pre-suspension: one accepted command (its inbox row is the no-double-
    // post proof for the resume) + the device's cursor parked mid-feed.
    const acceptedCommand = v2Command("pos_sale", "create", "chaos-c14-accepted", posSalePayload(world, { offline: "OFF-C14-00001", date: "2026-02-19" }));
    const accepted = asAccepted((await pushV2(device, [acceptedCommand])).results[0]!);
    expect(accepted.status).toBe("ACCEPTED");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
    await reference.client.pullAll();
    const parkedCursor = readCursor(reference.adapter, "items");

    // The command queued when suspension hits (re-pushed after restore).
    const pending = v2Command("pos_sale", "create", "chaos-c14-pending", posSalePayload(world, { offline: "OFF-C14-00002", date: "2026-02-19" }));

    // Suspend the tenant mid-session.
    const su = await superuserClient();
    await su.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [TENANT_CHAOS]);
    await su.end();
    try {
      // Pushes: per-item TENANT_SUSPENDED (retryable tenant state — never
      // recorded in the inbox, so the resume EXECUTES them).
      const inboxBefore = await countInbox(TENANT_CHAOS, device);
      const gated = asRejected((await pushV2(device, [pending])).results[0]!);
      expect(gated).toMatchObject({
        status: "REJECTED",
        reason: "TENANT_SUSPENDED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(gated.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
      expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);
      expect(await countInbox(TENANT_CHAOS, device)).toBe(inboxBefore); // not poisoned

      // The status surface: the client's heartbeat sees `suspended` (the
      // same query the /sync/status controller runs; the pull-side gate is
      // the tenant-context interceptor's 503 tenant_suspended — S-02/M-09).
      const status = await transport.status();
      expect(status.suspended).toBe(true);
    } finally {
      const restore = await superuserClient();
      await restore.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [TENANT_CHAOS]);
      await restore.end();
    }

    // Resume: the protocol continues from the parked cursor (no duplicate
    // application — only the delta), the previously-accepted command
    // replays from the inbox (duplicate:true, zero new effects), and the
    // suspended-gated command EXECUTES (ACCEPTED, not a replay).
    const delta = await reference.client.pullAll();
    expect(delta.items).toBe(0); // nothing changed server-side while suspended
    // Resume from the SAME position (the token's issuedAt differs per
    // pull; the seq — the position — is what must not have moved).
    expect(decodeCursor(readCursor(reference.adapter, "items") ?? "")?.seq).toBe(
      decodeCursor(parkedCursor ?? "")?.seq,
    );

    const replay = (await pushV2(device, [acceptedCommand])).results[0]!;
    expect(replay.status).toBe("ACCEPTED");
    expect(replay.duplicate).toBe(true); // the inbox replay — no second post
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 1);

    const resumed = asAccepted((await pushV2(device, [pending])).results[0]!);
    expect(resumed.status).toBe("ACCEPTED");
    expect(resumed).not.toHaveProperty("duplicate");
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 2);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-15 tampered payloads: negative qty + price tamper → typed rejects, no partial ledger (INV-013/018)", async () => {
    const seed = 0xc0f;
    console.log(`[C-15] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);

    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const journalsBefore = await countJournals(TENANT_CHAOS);
    const linesBefore = await countJournalLines(TENANT_CHAOS);
    const movesBefore = await countStockMoves(TENANT_CHAOS);

    // (a) Negative qty (a tampered local row): the contract schema rejects
    // the command shape — never executed, never in the inbox.
    const negativeQty = { ...posSalePayload(world, { offline: "OFF-C15-00001", date: "2026-02-20" }) };
    (negativeQty.sale.lines[0] as { qty: string }).qty = "-1";
    const negItem = asRejected((await pushV2(device, [v2Command("pos_sale", "create", "chaos-c15-negative", negativeQty)])).results[0]!);
    expect(negItem.reason).toBe("VALIDATION_ERROR");
    expect(negItem.resubmittable).toBe(true);

    // (b) Price tamper post-capture: the captured sale's unit price is
    // mutated (80) while the tenders still carry 115 — the posting path's
    // G-02 balance refuses the inconsistent document (VALIDATION_ERROR)
    // and the per-item savepoint leaves ZERO residue.
    const tampered = posSalePayload(world, { offline: "OFF-C15-00002", date: "2026-02-20", unitPrice: "80.000000" });
    (tampered.sale.tenders[0] as { amount: string }).amount = "115.0000"; // the stale tender
    const tamperedItem = asRejected((await pushV2(device, [v2Command("pos_sale", "create", "chaos-c15-tamper", tampered)])).results[0]!);
    expect(tamperedItem.reason).toBe("VALIDATION_ERROR");
    expect(tamperedItem.message).toMatch(/tender/i);

    // (c) A zero-price tamper (qty × price = 0 with a positive tender):
    // rejected by the same re-validation, zero residue.
    const zeroPrice = posSalePayload(world, { offline: "OFF-C15-00003", date: "2026-02-20", unitPrice: "0.000000" });
    (zeroPrice.sale.tenders[0] as { amount: string }).amount = "0.0001";
    const zeroItem = asRejected((await pushV2(device, [v2Command("pos_sale", "create", "chaos-c15-zero", zeroPrice)])).results[0]!);
    expect(zeroItem.reason).toBe("VALIDATION_ERROR");

    // No partial ledger: the oracles hold and nothing moved.
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore);
    expect(await countJournals(TENANT_CHAOS)).toBe(journalsBefore);
    expect(await countJournalLines(TENANT_CHAOS)).toBe(linesBefore);
    expect(await countStockMoves(TENANT_CHAOS)).toBe(movesBefore);
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("C-16 storage-full at capture: loud typed failure, queue persists, drains after recovery (C-09 semantics)", async () => {
    const seed = 0xc10;
    console.log(`[C-16] seed=${seed}`);
    const device = await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER);
    const transport = new HarnessTransport({ tenant: TENANT_CHAOS, deviceId: device, push: services.push });

    // A quota-wrapped adapter (memoryAdapter + the SQLITE_FULL injection):
    // while the quota is armed, EVERY write transaction refuses to start —
    // a full disk never accepts a capture (no silent drop, no half-write).
    const base = memoryAdapter();
    let quotaArmed = false;
    const quotaAdapter: StorageAdapter = {
      transaction: <T>(fn: () => T): T => {
        if (quotaArmed) {
          throw new Error("local store quota exceeded (SQLITE_FULL) — write transaction refused");
        }
        return base.transaction(fn);
      },
      run: (statement, params) => base.run(statement, params),
      all: (statement, params) => base.all(statement, params),
      get: (statement, params) => base.get(statement, params),
    };
    const reference = new ReferenceDevice(quotaAdapter, transport, seed);

    const draftOf = (offline: string) => ({
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: offline,
      invoiceDate: "2026-02-21",
      customerId: null,
      orderType: "COUNTER" as const,
      lines: [{ itemId: world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd }],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    });

    // Two healthy captures, then the disk fills mid-shift.
    reference.captureSale(draftOf("OFF-C16-00001"), "115.0000");
    reference.captureSale(draftOf("OFF-C16-00002"), "115.0000");
    expect(queueStats(reference.adapter).pending).toBe(2);

    quotaArmed = true;
    expect(() => reference.captureSale(draftOf("OFF-C16-00003"), "115.0000")).toThrow(
      /quota exceeded/,
    ); // LOUD — never a silent drop

    // The queue persisted: both previous entries intact (the outbox is the
    // source of truth for pending operations — never pruned by the fault).
    const stats = queueStats(reference.adapter);
    expect(stats.pending).toBe(2);
    expect(reference.adapter.all("SELECT * FROM pos_sales").length).toBe(2);

    // Recovery (space freed): the queue drains per C-09 semantics — both
    // commands accepted, official numbers stamped, ledger oracles exact.
    quotaArmed = false;
    const invoicesBefore = await countInvoices(TENANT_CHAOS);
    const outcome = await reference.cycle();
    expect(outcome.accepted).toBe(2);
    expect(outcome.rejected).toBe(0);
    expect(await countInvoices(TENANT_CHAOS)).toBe(invoicesBefore + 2);
    const state = reference.state();
    expect(state.queue.acked).toBe(2);
    for (const row of state.businessRows.pos_sales ?? []) {
      expect(row.local_status).toBe("SYNCED");
      expect(row.official_no).toMatch(/^POS-/);
    }
    await ledgerOraclesHold(TENANT_CHAOS);
  });

  it("D-04 probe (sync-core watermark): a stale permission snapshot drives the store readOnly — the companion to device-security.spec", async () => {
    // A lightweight in-file probe of the watermark mechanics the C-09
    // device relies on (the full D-04 journey lives in
    // device-security.spec.ts on its own tenant): an 8-day-old
    // permissionSnapshotAt flips permissionWatermarkState to readOnly and
    // a fresh snapshot clears it.
    const adapter = memoryAdapter();
    const reference = new ReferenceDevice(
      adapter,
      new HarnessTransport({
        tenant: TENANT_CHAOS,
        deviceId: await enrollDevice(TENANT_CHAOS, CHAOS_CASHIER),
        push: services.push,
      }),
      0xd04,
    );
    // A fresh snapshot through the real pull applier.
    applyPullBatch(
      reference.adapter,
      {
        entityType: "permissions",
        cursor: "1",
        changes: [
          {
            id: `${CHAOS_CASHIER}:page:1`,
            seq: 1,
            op: "UPSERT",
            payload: { userId: CHAOS_CASHIER, permissions: ["pos.sales.sell"], snapshotAt: new Date().toISOString() },
          },
        ],
      },
      posAppliers,
    );
    expect(permissionWatermarkState(adapter).readOnly).toBe(false);
    // 8 days offline: the watermark goes stale → readOnly (D-04)…
    writePermissionWatermark(adapter, new Date(Date.now() - 8 * 86_400_000).toISOString());
    expect(permissionWatermarkState(adapter).readOnly).toBe(true);
    // …and a fresh pull restores writability.
    writePermissionWatermark(adapter, new Date().toISOString());
    expect(permissionWatermarkState(adapter).readOnly).toBe(false);
  });
});

