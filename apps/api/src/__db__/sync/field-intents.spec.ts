import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { PosSaleService } from "../../modules/sales/application/pos-channel/pos-sale-service";
import { QuotationService } from "../../modules/sales/application/quotations";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { PartnerService } from "../../modules/partners/application/partner-service";
import { ShiftService } from "../../modules/treasury/application/shift-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { ExpenseService } from "../../modules/treasury/application/expense-service";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { TransferService as TreasuryTransferService } from "../../modules/treasury/application/transfer-service";
import { VanStockService } from "../../modules/distribution/application/van-stock-service";
import { SalesRepService } from "../../modules/sales/application/reps";
import { TransferService as InventoryTransferService } from "../../modules/inventory/application/transfer-service";
import { CountService } from "../../modules/inventory/application/count-service";
import { PosShiftFlowService } from "../../modules/pos/application/shift-flow-service";
import { PushService } from "../../modules/sync/application/push-service";
import { pull, SyncEntityNotPulledError } from "../../modules/sync/application/pull-service";
import { handlerRegistryKeys } from "../../modules/sync/application/handlers";
import {
  countJournals,
  countStockMoves,
  enrollDevice,
  journalCountForSource,
  ledgerOraclesHold,
  seedPosWorld,
  v2Command,
  type PosWorld,
} from "./_oracle";

/**
 * PHASE-022 T-P22-2c · DR-P22-06 — the three field write intents
 * (MASTER-PLAN §6 + §1; OFFLINE_CAPABILITIES_MATRIX rows 9/12/27
 * android-field): for every intent — ACCEPT (real rows + in-tx feed
 * publication + device audit), zod REJECT (VALIDATION_ERROR, zero
 * residue), the real server-side business rejections (PERIOD_LOCKED with
 * the engine's machine-readable details, INSUFFICIENT_STOCK with
 * `availableQty` for the over-unload, ITEM_INACTIVE, PARTNER_INACTIVE,
 * the double-load STALE_VERSION), and idempotent replay (C-01: same
 * commandId + idempotencyKey → duplicate:true, no second entity). The
 * receipt posts a REAL journal — the INV-013 ledger oracles assert after
 * every posting cluster.
 *
 * TENANT: dedicated F2C (verified unused across migrations + specs — the
 * F1D/P1D convention; grep for the exact uuid). Devices are created
 * directly (the desktop-intents pattern — the registration surface is
 * 2-b's). The van world follows pull-fields.spec (registerVan → loadOut
 * over the REAL services); the credit note + receipt allocations ride a
 * REAL posted credit invoice (the AR open item + the issue-cost snapshot).
 */
const TENANT = "f2c2c2c2-f2c2-f2c2-f2c2-f2c2f2c2f2c2";
const ACTOR = "f2c2c2c2-0000-4000-8000-000000000001";
const CASHIER = "f2c2c2c2-0000-4000-8000-000000000002";
const REP_USER = "f2c2c2c2-0000-4000-8000-000000000003";
/** The INACTIVE partner (the PARTNER_INACTIVE gate). */
const INACTIVE_PARTNER = "f2c2c2c2-0000-4000-8000-000000000101";

const INVOICE_NOTE_POSTED = "F2C credit-note reference invoice";
const INVOICE_NOTE_DRAFT = "F2C draft reference invoice (never posted)";
const VAN_CODE = "F2C-VAN-01";
const REP_CODE = "F2C-REP-01";
/** The receipt value dates (March — OPEN) + the December lock target. */
const COLLECTION_DATE = "2026-03-18";
const LOCKED_DATE = "2026-12-18";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
const posSales = new PosSaleService(audit, invoices, creditNotes);
const shiftFlow = new PosShiftFlowService(audit, new ShiftService(audit, posting));
const periods = new PeriodService(audit);
// The distribution chain (the pull-fields fixture shape) + the 021 slots.
const inventoryTransfers = new InventoryTransferService(audit, posting, numbering);
const repService = new SalesRepService(audit);
const vans = new VanStockService(audit, inventoryTransfers);
const partners = new PartnerService(audit);
const quotations = new QuotationService(audit, numbering);
const deliveries = new DeliveryNoteService(audit, posting, numbering);
const pettyCash = new PettyCashGuard(audit);
const expenses = new ExpenseService(audit, posting, numbering, pettyCash, resolver);
const treasuryTransfers = new TreasuryTransferService(audit, posting, numbering, pettyCash);
const stockCounts = new CountService(audit, posting, numbering);
// DR-P22-06: the three field intents' owning services.
const settlement = new SettlementCore(audit, posting, numbering);
const receipts = new ReceiptService(audit, settlement);
const allocations = new AllocationService(audit);
const vanStock = new VanStockService(audit, inventoryTransfers);
const push = new PushService(
  posSales,
  shiftFlow,
  audit,
  invoices,
  partners,
  quotations,
  deliveries,
  expenses,
  treasuryTransfers,
  inventoryTransfers,
  stockCounts,
  receipts,
  allocations,
  vanStock,
  creditNotes,
);

/** Narrow an item to its REJECTED variant (typed access to reason/action). */
function asRejected(item: { status: string }): Extract<PushItemResultV2, { status: "REJECTED" }> {
  if (item.status !== "REJECTED") {
    throw new Error(`expected a REJECTED item, got ${item.status}`);
  }
  return item as Extract<PushItemResultV2, { status: "REJECTED" }>;
}

/** Narrow an item to its ACCEPTED variant (typed access to result). */
function asAccepted(item: { status: string }): Extract<PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}`);
  }
  return item as Extract<PushItemResultV2, { status: "ACCEPTED" }>;
}

let world: PosWorld;
let repId = "";
let vanId = "";
let inTransitLoadId = "";
let postedInvoiceId = "";
let postedInvoiceLineId = "";
let draftInvoiceId = "";
let openItemId = "";

let dReceipt = "";
let dVan = "";
let dCreditNote = "";
let dPersonal = "";

async function pushV2(deviceId: string, commands: unknown[]) {
  return withTenant(TENANT, () =>
    push.push({
      deviceId,
      batchId: generateUuidV7(),
      commands,
      contractVersion: SYNC_CONTRACT_VERSION,
    }),
  );
}

/** Row count of a tenant table (fixed internal literals only). */
async function countRows(table: string): Promise<number> {
  return withTenant(TENANT, async () => {
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

/** One tenant-scoped row query (RLS world). */
async function oneRow(query: ReturnType<typeof sql>): Promise<Record<string, unknown> | undefined> {
  return withTenant(TENANT, async () => {
    const rows = await requireTenantContext().tx!.execute(query);
    return (rows.rows as unknown as Record<string, unknown>[])[0];
  });
}

/** The in-tx feed marker for (entityType, entityId) — same-tx change_log. */
async function feedCount(entityType: string, entityId: string): Promise<number> {
  const row = await oneRow(
    sql`SELECT count(*)::int AS n FROM change_log WHERE entity_type = ${entityType} AND entity_id = ${entityId}::text`,
  );
  return Number(row?.n ?? 0);
}

/** The device-stamped offline audit row for (action, entityId). */
async function offlineAudit(
  action: string,
  entityId: string,
): Promise<{ n: number; deviceId: string | null } | undefined> {
  return (await oneRow(sql`
    SELECT count(*)::int AS n, max(device_id::text) AS "deviceId"
    FROM audit_events WHERE action = ${action} AND entity_id = ${entityId}::uuid
  `)) as { n: number; deviceId: string | null } | undefined;
}

/** A REAL posted credit invoice (the AR open item + the issue-cost snapshot),
 * idempotent by note — the pull-fields ensurePostedCreditInvoice shape. */
async function ensurePostedCreditInvoice(): Promise<string> {
  const su = await superuserClient();
  const found = await su.query<{ id: string }>(
    `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND note = $2 LIMIT 1`,
    [TENANT, INVOICE_NOTE_POSTED],
  );
  const existing = found.rows[0]?.id;
  await su.end();
  if (existing !== undefined) {
    return existing;
  }
  const invoice = await withTenant(TENANT, () =>
    invoices.create({
      branchId: world.branchId,
      customerId: world.customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: "2026-03-15",
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: world.warehouseId,
      cashAccountId: null,
      note: INVOICE_NOTE_POSTED,
      noteAr: null,
      actorId: REP_USER,
      lines: [
        {
          itemId: world.itemA,
          accountId: null,
          deliveryLineId: null,
          description: null,
          descriptionAr: null,
          qty: "2",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: world.taxStd,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT, () => invoices.submit(invoice.id, REP_USER));
  await withTenant(TENANT, () => invoices.approve(invoice.id, ACTOR, false));
  const posted = await withTenant(TENANT, () => invoices.post(invoice.id, ACTOR));
  return posted.invoice.id;
}

/** Lock + later reopen the period covering LOCKED_DATE (the push.spec
 * withDecemberLocked shape — softClose → lock → try/finally reopen). */
async function withPeriodLocked<T>(fn: () => Promise<T>): Promise<T> {
  const periodStore = await import("../../modules/accounting/infrastructure/accounting.store");
  const period = await withTenant(TENANT, () => periodStore.findPeriodForDate(LOCKED_DATE));
  expect(period).toBeDefined();
  await withTenant(TENANT, () => periods.softClose(ACTOR, period!.id));
  await withTenant(TENANT, () => periods.lock(ACTOR, period!.id));
  try {
    return await fn();
  } finally {
    await withTenant(TENANT, () =>
      periods.reopen(ACTOR, period!.id, "PHASE-022 field-intents.spec December reopen"),
    );
  }
}

beforeAll(async () => {
  ensureTestDb();
  world = await seedPosWorld({
    tenant: TENANT,
    name: "Tenant F2C (field intents)",
    nameAr: "مستأجر ٢ج",
    prefix: "F2C",
    actor: ACTOR,
    cashier: CASHIER,
    salesRep: REP_USER,
  });

  // The INACTIVE partner (the PARTNER_INACTIVE gate) — a live row, status
  // flipped server-side (the desktop-intents convention).
  const su = await superuserClient();
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $2, 'CUSTOMER', 'F2C-CUST-IN', 'Field Fixture Inactive Partner')
     ON CONFLICT (id) DO NOTHING`,
    [INACTIVE_PARTNER, TENANT],
  );
  await su.end();
  await withTenant(TENANT, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`
      UPDATE partners SET status = 'INACTIVE', updated_at = now()
      WHERE id = ${INACTIVE_PARTNER}::uuid AND status = 'ACTIVE'
    `);
  });

  // The REAL distribution chain (the pull-fields fixture shape): rep + van
  // + the morning loadOut (IN_TRANSIT — the confirm_load substrate).
  await withTenant(TENANT, async () => {
    const existingReps = await repService.list({ limit: 50 });
    repId =
      existingReps.find((r) => r.code === REP_CODE)?.id ??
      (
        await repService.create({
          code: REP_CODE,
          name: "F2C field rep",
          nameAr: "مندوب ميداني",
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: ACTOR,
        })
      ).id;

    const { listVans } = await import("../../modules/distribution/infrastructure/distribution.store");
    const existingVans = await listVans({ limit: 50 });
    vanId =
      existingVans.find((v) => v.code === VAN_CODE)?.id ??
      (
        await vans.registerVan({
          code: VAN_CODE,
          name: "Van 01",
          nameAr: "سيارة التوزيع ٠١",
          branchId: world.branchId,
          salesRepId: repId,
          actorId: ACTOR,
        })
      ).id;

    // The morning load: 10 × itemA main → van, dispatched (IN_TRANSIT).
    const suOpen = await superuserClient();
    const openTransfers = await suOpen.query<{ id: string }>(
      `SELECT t.id FROM stock_transfers t WHERE t.tenant_id = $1 AND t.status = 'IN_TRANSIT'
         AND t.to_warehouse_id = $2 LIMIT 1`,
      [TENANT, vanId],
    );
    await suOpen.end();
    if (openTransfers.rows[0] === undefined) {
      const load = await vans.loadOut({
        fromWarehouseId: world.warehouseId,
        vanWarehouseId: vanId,
        lines: [{ itemId: world.itemA, qty: "10" }],
        note: "F2C morning load",
        noteAr: null,
        actorId: REP_USER,
      });
      inTransitLoadId = load.id;
    } else {
      inTransitLoadId = openTransfers.rows[0].id;
    }
  });

  // The posted reference invoice (the credit note's POSTED reference + the
  // receipt allocation's AR open item) + the DRAFT never-posted one (the
  // credit-note domain rejection).
  postedInvoiceId = await ensurePostedCreditInvoice();
  const suDraft = await superuserClient();
  const draftFound = await suDraft.query<{ id: string }>(
    `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND note = $2 LIMIT 1`,
    [TENANT, INVOICE_NOTE_DRAFT],
  );
  await suDraft.end();
  draftInvoiceId =
    draftFound.rows[0]?.id ??
    (
      await withTenant(TENANT, () =>
        invoices.create({
          branchId: world.branchId,
          customerId: world.customerId,
          salesRepId: null,
          kind: "CREDIT",
          invoiceDate: "2026-03-15",
          dueDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          orderId: null,
          deliveryId: null,
          warehouseId: world.warehouseId,
          cashAccountId: null,
          note: INVOICE_NOTE_DRAFT,
          noteAr: null,
          actorId: REP_USER,
          lines: [
            {
              itemId: world.itemA,
              accountId: null,
              deliveryLineId: null,
              description: null,
              descriptionAr: null,
              qty: "2",
              unitPrice: "100.000000",
              discountAmount: null,
              taxCodeId: world.taxStd,
              batchId: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      )
    ).id;

  // The posted invoice's line id (the credit note's invoiceLineId) + its AR
  // open item (the receipt allocation's openItemId).
  const lineRow = await oneRow(sql`
    SELECT id FROM sales_invoice_lines WHERE invoice_id = ${postedInvoiceId}::uuid
    ORDER BY line_no LIMIT 1
  `);
  postedInvoiceLineId = String(lineRow?.id ?? "");
  const openItems = await withTenant(TENANT, () =>
    allocations.openItems({ partnerId: world.customerId, side: "AR" }),
  );
  const invoiceItem = openItems.find((item) => item.sourceType === "sales_invoice");
  openItemId = invoiceItem?.id ?? "";

  // Devices: one android-field device per intent cluster (the push rate
  // bucket is PER DEVICE) + the linked personal device (the receipts feed
  // scope proof).
  dReceipt = await enrollDevice(TENANT, REP_USER, { deviceClass: "android-field" });
  dVan = await enrollDevice(TENANT, REP_USER, { deviceClass: "android-field" });
  dCreditNote = await enrollDevice(TENANT, REP_USER, { deviceClass: "android-field" });
  dPersonal = await enrollDevice(TENANT, ACTOR, {
    deviceClass: "android-personal",
    linkedPartnerId: world.customerId,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-022 DR-P22-06 · field write intents (T-P22-2c)", () => {
  // -- receipt:create_field_collection (SD-at-sync · ReceiptService) ---------

  it("1. receipt:create_field_collection — ACCEPTED: POSTED row + RCV number + journal + cash movement, in-tx feed, device audit, ledger oracles", async () => {
    const journalsBefore = await countJournals(TENANT);
    const command = v2Command("receipt", "create_field_collection", "f2c-rcpt-1", {
      partnerId: world.customerId,
      cashAccountId: world.cashAccountId,
      method: "CASH",
      currencyCode: "SAR",
      amount: "230.0000",
      valueDate: COLLECTION_DATE,
      collectedAt: "2026-03-18T09:15:00+03:00",
      reference: "F2C-COLL-001",
      description: "تحصيل مسار الشمال",
    });
    const { results } = await pushV2(dReceipt, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "POSTED", amount: "230.0000" });
    expect(item.result.receiptNo).toMatch(/^RCV-\d{4}-\d{6}$/);
    expect(item.officialNumber).toBe(item.result.receiptNo);
    const receiptId = (item.result as unknown as { receiptId: string }).receiptId;
    // insertReceipt starts at version 1; the POST flip (updateReceiptStatus)
    // bumps it — the posted row reads version 2.
    expect(item.entity).toMatchObject({ id: receiptId, version: 2 });
    expect(item.effects?.journalEntryIds).toHaveLength(1);

    // The real row (receipts table) — POSTED with the official number and
    // the journal bound (ck_receipts_posted_shape).
    const row = await oneRow(sql`
      SELECT r.status, r.receipt_no AS "receiptNo", r.amount, r.allocated_amount AS "allocatedAmount",
             r.posted_journal_id AS "postedJournalId", r.created_by AS "createdBy", r.version
      FROM receipts r WHERE r.id = ${receiptId}::uuid
    `);
    expect(row).toMatchObject({
      status: "POSTED",
      receiptNo: item.result.receiptNo,
      amount: "230.0000",
      // Fully on-account (no allocations on this collection — BR-027).
      allocatedAmount: "0.0000",
      postedJournalId: item.effects?.journalEntryIds?.[0],
      // Rep attribution: the device user is the collecting rep (created_by).
      createdBy: REP_USER,
      version: 2,
    });

    // The cash movement (INV-019) + the INV-013 per-source journal.
    const movement = await oneRow(sql`
      SELECT direction FROM cash_movements
      WHERE source_type = 'receipt' AND source_id = ${receiptId}::uuid
    `);
    expect(movement).toMatchObject({ direction: "IN" });
    expect(await journalCountForSource(TENANT, "receipt", receiptId)).toBe(1);
    expect(await countJournals(TENANT)).toBe(journalsBefore + 1);

    // In-tx feed publication (receipts IS a pulled feed entity — personal).
    expect(await feedCount("receipts", receiptId)).toBeGreaterThanOrEqual(1);

    // The device-stamped offline audit row (provenance) + the service's own.
    const offline = await offlineAudit("treasury.receipt_field_collection_posted", receiptId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dReceipt);

    // The composite ledger oracle (INV-013/001/002/009 + honest state).
    await ledgerOraclesHold(TENANT);
  });

  it("2. receipt:create_field_collection — C-01 replay: duplicate:true, no second receipt, no second journal", async () => {
    const command = v2Command("receipt", "create_field_collection", "f2c-rcpt-1", {
      partnerId: world.customerId,
      cashAccountId: world.cashAccountId,
      method: "CASH",
      currencyCode: "SAR",
      amount: "230.0000",
      valueDate: COLLECTION_DATE,
    });
    const before = await countRows("receipts");
    const journalsBefore = await countJournals(TENANT);
    const replay = await pushV2(dReceipt, [command]);
    const replayItem = asAccepted(replay.results[0]!);
    expect(replayItem.duplicate).toBe(true);
    expect((replayItem.result as unknown as { receiptId: string }).receiptId).toBeDefined();
    expect(await countRows("receipts")).toBe(before);
    expect(await countJournals(TENANT)).toBe(journalsBefore);
  });

  it("3. receipt:create_field_collection — zod REJECT (malformed amount): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("receipts");
    const { results } = await pushV2(dReceipt, [
      v2Command("receipt", "create_field_collection", "f2c-rcpt-zod-2", {
        partnerId: world.customerId,
        cashAccountId: world.cashAccountId,
        method: "CASH",
        currencyCode: "SAR",
        amount: "12.50.00",
        valueDate: COLLECTION_DATE,
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.action).toBe("EDIT_AND_RESEND");
    expect(item.message).toMatch(/payload rejected by the contract/);
    expect(await countRows("receipts")).toBe(before);
  });

  it("4. receipt:create_field_collection — PARTNER_INACTIVE (deactivated master data), zero residue", async () => {
    const before = await countRows("receipts");
    const { results } = await pushV2(dReceipt, [
      v2Command("receipt", "create_field_collection", "f2c-rcpt-inactive-3", {
        partnerId: INACTIVE_PARTNER,
        cashAccountId: world.cashAccountId,
        method: "CASH",
        currencyCode: "SAR",
        amount: "100.0000",
        valueDate: COLLECTION_DATE,
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("PARTNER_INACTIVE");
    expect(item.action).toBe("CANCEL_WITH_REASON");
    expect(item.resubmittable).toBe(false);
    expect(item.details).toMatchObject({ partnerId: INACTIVE_PARTNER, status: "INACTIVE" });
    expect(item.message).toMatch(/needs an ACTIVE partner/);
    expect(await countRows("receipts")).toBe(before);
  });

  it("5. receipt:create_field_collection — PERIOD_LOCKED (locked December), engine details, zero residue", async () => {
    const before = await countRows("receipts");
    const journalsBefore = await countJournals(TENANT);
    await withPeriodLocked(async () => {
      const { results } = await pushV2(dReceipt, [
        v2Command("receipt", "create_field_collection", "f2c-rcpt-period-4", {
          partnerId: world.customerId,
          cashAccountId: world.cashAccountId,
          method: "CASH",
          currencyCode: "SAR",
          amount: "90.0000",
          valueDate: LOCKED_DATE,
        }),
      ]);
      const item = asRejected(results[0]!);
      expect(item.reason).toBe("PERIOD_LOCKED");
      expect(item.action).toBe("EDIT_AND_RESEND");
      expect(item.resubmittable).toBe(true);
      // The engine's machine-readable details (MASTER-PLAN §6: rejection
      // details carry the deciding values).
      expect(item.details).toMatchObject({ entryDate: LOCKED_DATE, status: "LOCKED" });
      expect(item.message).toMatch(/falls in a LOCKED fiscal period/);
    });
    expect(await countRows("receipts")).toBe(before);
    expect(await countJournals(TENANT)).toBe(journalsBefore);
  });

  it("6. receipt:create_field_collection — with allocations: the posted receipt settles the AR open item (allocatedAmount, oracle)", async () => {
    expect(openItemId).not.toBe("");
    const command = v2Command("receipt", "create_field_collection", "f2c-rcpt-alloc-5", {
      partnerId: world.customerId,
      cashAccountId: world.cashAccountId,
      method: "CASH",
      currencyCode: "SAR",
      amount: "100.0000",
      valueDate: COLLECTION_DATE,
      allocations: [{ openItemId, amount: "100.0000" }],
    });
    const { results } = await pushV2(dReceipt, [command]);
    const item = asAccepted(results[0]!);
    // The allocation settled the open item; the remainder is on-account 0.
    expect(item.result).toMatchObject({
      status: "POSTED",
      amount: "100.0000",
      allocatedAmount: "100.0000",
    });
    const receiptId = (item.result as unknown as { receiptId: string }).receiptId;

    // The open item's outstanding dropped by the settled amount (the CC-02
    // authoritative path wrote treasury_allocations from the POSTED receipt).
    const settled = await oneRow(sql`
      SELECT (s.amount - COALESCE(settled.total, 0))::text AS outstanding
      FROM partner_subledger_entries s
      LEFT JOIN (
        SELECT a.open_item_id, SUM(a.amount) AS total FROM treasury_allocations a
        WHERE a.receipt_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM receipts r WHERE r.id = a.receipt_id AND r.status = 'POSTED')
        GROUP BY a.open_item_id
      ) settled ON settled.open_item_id = s.id
      WHERE s.id = ${openItemId}::uuid
    `);
    expect(settled?.outstanding).toBe("130.0000");

    // INV-013: one journal per receipt doc.
    expect(await journalCountForSource(TENANT, "receipt", receiptId)).toBe(1);
    await ledgerOraclesHold(TENANT);
  });

  // -- van:confirm_load / van:confirm_unload (SD-at-sync · VanStockService) --

  it("7. van:confirm_load — ACCEPTED: IN_TRANSIT → POSTED, the van mirror carries the load, in-tx feed, device audit", async () => {
    const command = v2Command("van", "confirm_load", "f2c-load-1", {
      transferId: inTransitLoadId,
      confirmedAt: "2026-03-18T07:40:00+03:00",
    });
    const { results } = await pushV2(dVan, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "POSTED", vanWarehouseId: vanId });
    expect(item.result.transferNo).toMatch(/^TRN-\d{4}-\d{6}$/);
    expect(item.officialNumber).toBe(item.result.transferNo);
    const transferId = (item.result as unknown as { transferId: string }).transferId;
    expect(transferId).toBe(inTransitLoadId);
    expect(item.entity).toMatchObject({ id: transferId });

    // The real row: POSTED + the IN leg landed (the carried cost).
    const row = await oneRow(sql`
      SELECT t.status, t.receive_date AS "receiveDate",
             (SELECT count(*)::int FROM stock_moves m
              WHERE m.source_type = 'stock_transfer' AND m.source_id = t.id
                AND m.warehouse_id = t.to_warehouse_id) AS "inLeg"
      FROM stock_transfers t WHERE t.id = ${transferId}::uuid
    `);
    expect(row).toMatchObject({ status: "POSTED", inLeg: 1 });
    expect(row?.receiveDate).not.toBeNull();

    // The van mirror (the snapshot) carries the load: 10 × itemA @60.
    const mirror = await withTenant(TENANT, () =>
      vanStock.listVanStock({ warehouseId: vanId, itemId: world.itemA }),
    );
    expect(mirror).toHaveLength(1);
    expect(mirror[0]).toMatchObject({ itemId: world.itemA, qty: "10.000000", value: "600.0000" });

    // In-tx feed marker + the device-stamped audit.
    expect(await feedCount("stock_transfers", transferId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("distribution.van_load_offline_confirmed", transferId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dVan);

    // The van_stocks feed over the REAL mirror (the 1-d substrate, now
    // handler-driven): the field device pulls the loaded snapshot.
    const feed = await withTenant(TENANT, () =>
      pull({ entityType: "van_stocks", cursor: null, deviceId: dVan }),
    );
    const upsert = feed.changes.find((c) => c.op === "UPSERT");
    expect(upsert).toBeDefined();
    expect(upsert!.payload).toMatchObject({
      warehouseId: vanId,
      itemId: world.itemA,
      qty: "10.000000",
      value: "600.0000",
    });
  });

  it("8. van:confirm_load — double-load (already POSTED): STALE_VERSION with details, zero residue", async () => {
    const movesBefore = await countStockMoves(TENANT);
    const { results } = await pushV2(dVan, [
      // A GENUINELY new command (fresh commandId + key) naming the SAME
      // load — the double-confirm the CONFLICT_RESOLUTION §2 rule rejects.
      v2Command("van", "confirm_load", "f2c-load-double-2", { transferId: inTransitLoadId }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("STALE_VERSION");
    expect(item.action).toBe("EDIT_AND_RESEND");
    expect(item.details).toMatchObject({ transferId: inTransitLoadId, currentStatus: "POSTED" });
    expect(item.message).toMatch(/double-load confirm/);
    expect(await countStockMoves(TENANT)).toBe(movesBefore);
  });

  it("9. van:confirm_load — unknown transfer + not-yet-dispatched: VALIDATION_ERROR, zero residue", async () => {
    const unknown = generateUuidV7();
    const { results } = await pushV2(dVan, [
      v2Command("van", "confirm_load", "f2c-load-unknown-3", { transferId: unknown }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/does not exist in this tenant/);

    // A not-yet-dispatched transfer (the load has not left the warehouse).
    const su = await superuserClient();
    const draftTransfer = await su.query<{ id: string }>(
      `SELECT t.id FROM stock_transfers t WHERE t.tenant_id = $1 AND t.status = 'DRAFT' LIMIT 1`,
      [TENANT],
    );
    await su.end();
    const draftId = draftTransfer.rows[0]?.id;
    if (draftId !== undefined) {
      const second = await pushV2(dVan, [
        v2Command("van", "confirm_load", "f2c-load-draft-4", { transferId: draftId }),
      ]);
      const item2 = asRejected(second.results[0]!);
      expect(item2.reason).toBe("VALIDATION_ERROR");
      expect(item2.message).toMatch(/only IN_TRANSIT loads confirm/);
      expect(item2.details).toMatchObject({ transferId: draftId, currentStatus: "DRAFT" });
    }
  });

  it("10. van:confirm_load — zod REJECT (not-a-uuid transferId): VALIDATION_ERROR, zero residue", async () => {
    const { results } = await pushV2(dVan, [
      v2Command("van", "confirm_load", "f2c-load-zod-5", { transferId: "not-a-uuid" }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/payload rejected by the contract/);
  });

  it("11. van:confirm_unload — over-unload (beyond the current van quantity): INSUFFICIENT_STOCK with availableQty, zero residue", async () => {
    const movesBefore = await countStockMoves(TENANT);
    const transfersBefore = await countRows("stock_transfers");
    const { results } = await pushV2(dVan, [
      v2Command("van", "confirm_unload", "f2c-unload-over-1", {
        vanWarehouseId: vanId,
        toWarehouseId: world.warehouseId,
        lines: [{ itemId: world.itemA, qty: "15" }],
        confirmedAt: "2026-03-18T18:05:00+03:00",
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("INSUFFICIENT_STOCK");
    expect(item.action).toBe("EDIT_AND_RESEND");
    expect(item.resubmittable).toBe(true);
    // The machine-readable detail the brief prescribes (MASTER-PLAN §6).
    expect(item.details).toMatchObject({
      vanWarehouseId: vanId,
      itemId: world.itemA,
      availableQty: "10.000000",
      requestedQty: "15",
    });
    expect(item.message).toMatch(/exceeds the current van quantity 10/);
    expect(await countStockMoves(TENANT)).toBe(movesBefore);
    expect(await countRows("stock_transfers")).toBe(transfersBefore);
  });

  it("12. van:confirm_unload — inactive item line: ITEM_INACTIVE (deactivated master data), zero residue", async () => {
    const transfersBefore = await countRows("stock_transfers");
    const { results } = await pushV2(dVan, [
      v2Command("van", "confirm_unload", "f2c-unload-inactive-2", {
        vanWarehouseId: vanId,
        toWarehouseId: world.warehouseId,
        lines: [{ itemId: world.itemInactive, qty: "1" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("ITEM_INACTIVE");
    expect(item.action).toBe("CANCEL_WITH_REASON");
    expect(item.resubmittable).toBe(false);
    expect(item.message).toMatch(/is inactive and cannot receive sales documents/);
    expect(await countRows("stock_transfers")).toBe(transfersBefore);
  });

  it("13. van:confirm_unload — ACCEPTED: the whole load returns (IN_TRANSIT), the mirror vanishes (DELETE diff + tombstone)", async () => {
    const command = v2Command("van", "confirm_unload", "f2c-unload-accept-3", {
      vanWarehouseId: vanId,
      toWarehouseId: world.warehouseId,
      lines: [{ itemId: world.itemA, qty: "10" }],
      note: "end-of-day return",
      confirmedAt: "2026-03-18T18:30:00+03:00",
    });
    const { results } = await pushV2(dVan, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "IN_TRANSIT", lines: 1 });
    expect(item.result.transferNo).toMatch(/^TRN-\d{4}-\d{6}$/);
    expect(item.officialNumber).toBe(item.result.transferNo);
    const transferId = (item.result as unknown as { transferId: string }).transferId;
    expect(transferId).not.toBe(inTransitLoadId);

    // The real row: the reverse-direction transfer dispatched (the OUT leg
    // left the van at the carried cost — BR-016 in-transit).
    const row = await oneRow(sql`
      SELECT t.status, t.from_warehouse_id AS "fromWarehouseId",
             (SELECT count(*)::int FROM stock_moves m
              WHERE m.source_type = 'stock_transfer' AND m.source_id = t.id
                AND m.warehouse_id = t.from_warehouse_id) AS "outLeg"
      FROM stock_transfers t WHERE t.id = ${transferId}::uuid
    `);
    expect(row).toMatchObject({ status: "IN_TRANSIT", fromWarehouseId: vanId, outLeg: 1 });

    // The mirror-first read leaves the van snapshot EMPTY (net 0 — the
    // 017 HAVING <> 0 rebuild drops the key).
    const mirror = await withTenant(TENANT, () =>
      vanStock.listVanStock({ warehouseId: vanId, itemId: world.itemA }),
    );
    expect(mirror).toHaveLength(0);

    // In-tx feed marker + the device-stamped audit.
    expect(await feedCount("stock_transfers", transferId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("distribution.van_unload_offline_confirmed", transferId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dVan);

    // The van_stocks feed: the previously-fed key is served as the DELETE
    // diff (op:'DELETE' + payload:null + a tombstones row — the 1-d proof,
    // now handler-driven), and the quiet re-pull emits nothing new.
    const feed = await withTenant(TENANT, () =>
      pull({ entityType: "van_stocks", cursor: null, deviceId: dVan }),
    );
    const upsertIds = feed.changes.filter((c) => c.op === "UPSERT").map((c) => c.id);
    expect(upsertIds).toHaveLength(1);
    const deleteEntry = feed.changes.find(
      (c) => upsertIds.includes(c.id) && c.op === "DELETE",
    );
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.payload).toBeNull();
    expect(deleteEntry!.version).toBeNull();

    const su = await superuserClient();
    const tombstones = await su.query<{ gc_after: string }>(
      `SELECT gc_after FROM tombstones WHERE tenant_id = $1 AND entity_type = 'van_stocks'
         AND entity_id = ANY($2)`,
      [TENANT, upsertIds],
    );
    await su.end();
    expect(tombstones.rows).toHaveLength(1);
    expect(tombstones.rows[0]!.gc_after).not.toBeNull();

    const quiet = await withTenant(TENANT, () =>
      pull({ entityType: "van_stocks", cursor: feed.cursor, deviceId: dVan }),
    );
    expect(quiet.changes).toHaveLength(0);
    expect(quiet.hasMore).toBe(false);
  });

  it("14. van:confirm_unload — zod REJECT (empty lines): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("stock_transfers");
    const { results } = await pushV2(dVan, [
      v2Command("van", "confirm_unload", "f2c-unload-zod-4", {
        vanWarehouseId: vanId,
        toWarehouseId: world.warehouseId,
        lines: [],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/payload rejected by the contract/);
    expect(await countRows("stock_transfers")).toBe(before);
  });

  // -- credit_note:create_draft (OD-create · CreditNoteService) ----------------

  it("15. credit_note:create_draft — ACCEPTED: DRAFT row + lines at the ORIGINAL issue cost, in-tx feed, device audit, NO posting, idempotent replay", async () => {
    const command = v2Command("credit_note", "create_draft", "f2c-cn-1", {
      invoiceId: postedInvoiceId,
      noteDate: "2026-03-19",
      note: "مرتجع مسار الشمال",
      lines: [
        {
          invoiceLineId: postedInvoiceLineId,
          qty: "1",
          returnToStock: true,
        },
      ],
    });
    const { results } = await pushV2(dCreditNote, [command]);
    const item = asAccepted(results[0]!);
    // 1 × 100 @15% STD = 115; the W-3 re-entry at the ORIGINAL issue cost
    // (60) — never a current-average recompute.
    expect(item.result).toMatchObject({
      status: "DRAFT",
      totalGross: "115.0000",
      reentryValue: "60.0000",
    });
    const noteId = (item.result as unknown as { creditNoteId: string }).creditNoteId;
    expect(item.entity).toMatchObject({ id: noteId, version: 1 });
    // No official number at DRAFT (CRN- reserves at post).
    expect(item.officialNumber).toBeUndefined();

    const row = await oneRow(sql`
      SELECT n.status, n.note_no AS "noteNo", n.customer_id AS "customerId", n.invoice_id AS "invoiceId",
             n.total_gross AS "totalGross", n.reentry_value AS "reentryValue",
             (SELECT count(*)::int FROM credit_note_lines l WHERE l.note_id = n.id) AS lines,
             n.version
      FROM credit_notes n WHERE n.id = ${noteId}::uuid
    `);
    expect(row).toMatchObject({
      status: "DRAFT",
      noteNo: null,
      // The customer is derived from the invoice server-side, never trusted.
      customerId: world.customerId,
      invoiceId: postedInvoiceId,
      totalGross: "115.0000",
      reentryValue: "60.0000",
      lines: 1,
      version: 1,
    });

    // OD draft semantics: NO posting (no journal, no stock re-entry moves).
    expect(await journalCountForSource(TENANT, "credit_note", noteId)).toBe(0);
    const reentry = await oneRow(sql`
      SELECT count(*)::int AS n FROM stock_moves
      WHERE source_type = 'credit_note' AND source_id = ${noteId}::uuid
    `);
    expect(Number(reentry?.n)).toBe(0);

    expect(await feedCount("credit_notes", noteId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("sales.credit_note_offline_created", noteId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dCreditNote);

    // C-01 replay.
    const before = await countRows("credit_notes");
    const replay = asAccepted((await pushV2(dCreditNote, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    expect((replay.result as unknown as { creditNoteId: string }).creditNoteId).toBe(noteId);
    expect(await countRows("credit_notes")).toBe(before);
  });

  it("16. credit_note:create_draft — zod REJECT (empty lines): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("credit_notes");
    const { results } = await pushV2(dCreditNote, [
      v2Command("credit_note", "create_draft", "f2c-cn-zod-2", {
        invoiceId: postedInvoiceId,
        noteDate: "2026-03-19",
        lines: [],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/payload rejected by the contract/);
    expect(await countRows("credit_notes")).toBe(before);
  });

  it("17. credit_note:create_draft — business rule (DRAFT invoice reference): the service's typed CREDIT_NOTE_REF_INVALID → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("credit_notes");
    const { results } = await pushV2(dCreditNote, [
      v2Command("credit_note", "create_draft", "f2c-cn-rule-3", {
        invoiceId: draftInvoiceId,
        noteDate: "2026-03-19",
        lines: [{ invoiceLineId: postedInvoiceLineId, qty: "1", returnToStock: false }],
      }),
    ]);
    const item = asRejected(results[0]!);
    // BR-004: the reference is never optional — a DRAFT invoice can never
    // receive a credit note. The service's typed error code is not a sync
    // wire reason — the honest fallback (the T-P21-2d convention).
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/credit notes reference POSTED invoices only/);
    expect(await countRows("credit_notes")).toBe(before);
  });

  // -- the frozen feed-group scope + the final oracle sweep -------------------

  it("18. feed-group scope: the field device never pulls receipts; the linked personal device pulls ONLY its partner's posted collections; the composite oracle holds", async () => {
    // The field group carries no receipts entity (the golden constants) —
    // a field device asking outside its group gets SYNC_ENTITY_NOT_PULLED.
    await expect(
      withTenant(TENANT, () => pull({ entityType: "receipts", cursor: null, deviceId: dVan })),
    ).rejects.toThrow(SyncEntityNotPulledError);

    // The linked personal device pulls the posted collections — partner-
    // scoped server-side (the handler's markers + the catch-up projection
    // with the partnerId scope key; LOCAL_DATABASE §1.1 rule 2).
    const feed = await withTenant(TENANT, () =>
      pull({ entityType: "receipts", cursor: null, deviceId: dPersonal }),
    );
    const posted = feed.changes.filter((c) => c.payload?.receiptNo !== undefined);
    expect(posted.length).toBe(2);
    for (const change of posted) {
      expect(change.payload?.partnerId).toBe(world.customerId);
      expect(change.payload?.status).toBe("POSTED");
      expect(change.payload?.receiptNo).toMatch(/^RCV-\d{4}-\d{6}$/);
      // Money as TEXT decimal strings (ADR-0009).
      expect(typeof change.payload?.amount).toBe("string");
    }

    // The registry (13 → 17 keys): the plan’s “13 → 16” counts the van pair
    // as one intent — the registry carries FOUR new keys (the van pair is
    // two intents, two handlers, one capability row).
    expect(handlerRegistryKeys()).toEqual(
      expect.arrayContaining([
        "receipt:create_field_collection",
        "van:confirm_load",
        "van:confirm_unload",
        "credit_note:create_draft",
      ]),
    );
    expect(handlerRegistryKeys()).toHaveLength(17);

    // The final composite oracle sweep over everything this spec posted.
    await ledgerOraclesHold(TENANT);
  });
});
