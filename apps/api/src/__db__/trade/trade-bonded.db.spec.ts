import { sql } from "drizzle-orm";
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import {
  ensureTradeLcPostingWorld,
  setupTradeFixture,
  TENANT_TRADE,
  TENANT_TRADE_RLS,
  TR_ACTOR,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { RevaluationService } from "../../modules/inventory/application/revaluation-service";
import { PutawayService } from "../../modules/inventory/application/putaway-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { PickingService } from "../../modules/inventory/application/picking-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { GoodsReceiptService } from "../../modules/purchasing/application/goods-receipts";
import { LandedCostService } from "../../modules/purchasing/application/landed-costs";
import * as pStore from "../../modules/purchasing/infrastructure/purchasing.store";
import { CustomsService } from "../../modules/trade/application/customs-service";
import { BondedService } from "../../modules/trade/application/bonded-service";
import { planIssue } from "../../modules/inventory/application/movement-core";
import { suspendedQtyAt } from "../../modules/trade/infrastructure/bonded-gate";
import { BondedStockSuspendedError } from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-38 — T-11, 2026-11-25) `trade-bonded.db.spec` — THE BONDED
 * ENGINE over real PG16 (the plan §4's own arm; the master plan §3 W-38's
 * exit — acceptance #4's engine arms): **G-66 + BR-107 + THE BLOCKING
 * MATRIX over every baseline issue path** — the 050 quality-holds
 * evidence shape carried VERBATIM (the raw `planIssue` · the manualIssue
 * · the sales-delivery post · the transfer dispatch), the typed
 * `BONDED_STOCK_SUSPENDED` naming the stock + the bond + the figures,
 * ZERO residue on every refusal; the in-bond transfer with NO duty entry
 * through the REAL movement core; the release's duty recognition (the
 * G-65-shaped pair at the released quantity — the journal + the
 * revaluation uplift + the atomic recognition pair) + the single-use
 * stamp + the typed replay refusal + the flip-and-restore at release.
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * arm builds its own deposit + declaration through the REAL services
 * (the official numbers reserve per row — every world naturally
 * unique); a rejection arm never shares mutable rows with another arm.
 * THE CATCH LAW (the W-37 honest catch's own lesson): every refusal
 * arm's expect sits OUTSIDE the withTenant callback so the rejection
 * propagates through the transaction and the ROLLBACK actually happens
 * — INV-018 proven for real.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const revaluation = new RevaluationService(audit);
const landedCosts = new LandedCostService(audit, posting, numbering, new RevaluationService(audit));
const customs = new CustomsService(audit, numbering, landedCosts);
const bonded = new BondedService(audit, numbering, posting, revaluation);
const stock = new StockService(audit, posting);
const transfers = new TransferService(audit, posting, numbering);
const deliveries = new DeliveryNoteService(audit, posting, numbering, new PickingService(audit, numbering));
const purchaseOrders = new PurchaseOrderService(audit, numbering);
const goodsReceipts = new GoodsReceiptService(audit, posting, numbering, new PutawayService(audit));

const world: {
  branchId: string;
  itemId: string;
  itemBId: string;
  supplierId: string;
  customerId: string;
  bondedWhId: string;
  bondedWh2Id: string;
  freeWhId: string;
  rls?: { branchId: string; supplierId: string; itemId: string; warehouseId: string };
} = {
  branchId: "",
  itemId: "",
  itemBId: "",
  supplierId: "",
  customerId: "",
  bondedWhId: "",
  bondedWh2Id: "",
  freeWhId: "",
};

/** A fresh item per arm (the per-arm-world law — «أذرع الرفض كلٌّ على
 * عالمه»: every arm's worlds are naturally unique; the shared fixture
 * item NEVER carries two arms' positions — each arm mints its own). */
async function freshTradeItem(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method, base_price)
     VALUES (gen_random_uuid(), $1, $2, $3, 'صنف الضمان', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE, `TR-BND-${code}-${generateUuidV7().slice(0, 8)}`, `Bond Item ${code}`],
  );
  await su.end();
  return row.rows[0]!.id;
}


beforeAll(async () => {
  const fixture = await setupTradeFixture();
  world.branchId = fixture.branchId;
  world.itemId = fixture.itemId;
  world.supplierId = fixture.supplierId;
  world.bondedWhId = fixture.warehouseAId; // TR-BOND (the bonded warehouse)
  world.freeWhId = fixture.warehouseBId; // TR-FREE (free circulation)
  // The posting world (the CoA template + FY-TR-FIX's OPEN 2026-11
  // period + the 0122 §8 markers riding the provisioning:
  // CUSTOMS_DUTY_PAYABLE 2145 + the INVENTORY 1140 purpose).
  await ensureTradeLcPostingWorld();
  // The GRNI mapping (the template's 2130 carries no purpose_key — the
  // purchasing fixture's own gap note; the COMPLETED-refusal arm's GRN
  // posts need it) — ensured HERE so this spec runs in ANY order (the
  // per-arm-world law's ordering-independence corollary).
  await withTenant(TENANT_TRADE, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    if ((await tenancy.findActivePurpose("GRNI")) === undefined) {
      const account = await tenancy.findAccountByCode("2130");
      expect(account).toBeDefined();
      await tenancy.insertAccountPurpose({
        purposeKey: "GRNI",
        accountId: account!.id,
        activeFrom: "2025-12-01",
      });
    }
  });
  // THE TRADE ENTITLEMENT (the bonded gate's own plane): TENANT_TRADE
  // carries it; TENANT_TRADE_RLS does NOT (the flag-off arm's world).
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES ($1, $2, 'trade', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [generateUuidV7(), TENANT_TRADE],
  );
  // A customer for the delivery arm.
  const customer = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'CUSTOMER', 'TR-CUST', 'Domestic Customer', 'العميل المحلي')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  world.customerId = customer.rows[0]!.id;
  // The second item (the two-item worlds).
  const itemB = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method, base_price)
     VALUES (gen_random_uuid(), $1, 'TR-ITEM-B2', 'TR Bond Goods B', 'صنف الضمان ب', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 30)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  world.itemBId = itemB.rows[0]!.id;
  // THE SECOND BONDED WAREHOUSE with its own EXPLICIT inventory GL
  // account (1141 — the quality fixture's second-inventory-account
  // precedent): the in-bond transfer's G-15 distinct-accounts policy
  // arm rides it (the value-neutral pair — NEVER a duty entry).
  const account1141 = await su.query<{ id: string }>(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, parent_id, is_postable)
     SELECT gen_random_uuid(), $1, '1141', 'Inventory — Bond B', 'المخزون — ضمان ب', 'ASSET',
       (SELECT id FROM accounts WHERE tenant_id = $1 AND code = '1140' LIMIT 1), TRUE
     WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = $1 AND code = '1141')
     RETURNING id`,
    [TENANT_TRADE],
  );
  const bonded2 = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name, inventory_account_id)
     VALUES (gen_random_uuid(), $1, $2, 'TR-BOND2', 'Bonded Warehouse B', $3)
     ON CONFLICT (tenant_id, code) DO UPDATE SET inventory_account_id = EXCLUDED.inventory_account_id
     RETURNING id`,
    [TENANT_TRADE, world.branchId, account1141.rows[0]?.id ?? null],
  );
  world.bondedWh2Id = bonded2.rows[0]!.id;
  // THE BOUNDARY TENANT'S OWN MINI WORLD (the flag-off arm): the full
  // landed-cost substrate WITHOUT the trade entitlement — master-data
  // basics, branch, supplier, item, warehouse, the CoA template + the
  // GRNI + INVENTORY mappings + the OPEN period.
  await withTenant(TENANT_TRADE_RLS, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    if ((await tenancy.findActivePurpose("GRNI")) === undefined) {
      const account = await tenancy.findAccountByCode("2130");
      expect(account).toBeDefined();
      await tenancy.insertAccountPurpose({
        purposeKey: "GRNI",
        accountId: account!.id,
        activeFrom: "2025-12-01",
      });
    }
  });
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status)
     VALUES (gen_random_uuid(), $1, 'FY-RLS-FIX', '2026-01-01', '2026-12-31', 'OPEN')
     ON CONFLICT DO NOTHING`,
    [TENANT_TRADE_RLS],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status)
     SELECT gen_random_uuid(), $1, fy.id, '2026-11', 'REGULAR', '2026-11-01', '2026-11-30', 'OPEN'
     FROM fiscal_years fy
     WHERE fy.tenant_id = $1 AND fy.name = 'FY-RLS-FIX'
       AND NOT EXISTS (
         SELECT 1 FROM fiscal_periods fp
         WHERE fp.tenant_id = $1 AND fp.fiscal_year_id = fy.id AND fp.name = '2026-11')`,
    [TENANT_TRADE_RLS],
  );
  const rlsBranch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'RLS-BR', 'Boundary Branch', 'فرع الفصل')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE_RLS],
  );
  const rlsSupplier = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'SUPPLIER', 'RLS-SUP', 'Boundary Supplier', 'مورد الفصل')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE_RLS],
  );
  const rlsItem = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method, base_price)
     VALUES (gen_random_uuid(), $1, 'RLS-ITEM', 'Boundary Goods', 'صنف الفصل', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 10)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE_RLS],
  );
  const rlsWarehouse = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
     VALUES (gen_random_uuid(), $1, $2, 'RLS-WH', 'Boundary Warehouse')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE_RLS, rlsBranch.rows[0]!.id],
  );
  await su.end();
  world.rls = {
    branchId: rlsBranch.rows[0]!.id,
    supplierId: rlsSupplier.rows[0]!.id,
    itemId: rlsItem.rows[0]!.id,
    warehouseId: rlsWarehouse.rows[0]!.id,
  };
});

/** A posted GRN over the given items (the boundary tenant's substrate —
 * the REAL PO/GRN services, the purchasing suite's own shape). */
async function postedRlsGrn(items: readonly { itemId: string; qty: string; unitPrice: string }[]) {
  const tenantId = TENANT_TRADE_RLS;
  const rls = world.rls!;
  const order = await withTenant(tenantId, () =>
    purchaseOrders.create({
      branchId: rls.branchId,
      supplierId: rls.supplierId,
      orderDate: "2026-11-25",
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      lines: items.map((item) => ({
        itemId: item.itemId,
        qty: item.qty,
        unitPrice: item.unitPrice,
        taxCodeId: null,
        requestLineId: null,
        note: null,
      })),
    }),
  );
  await withTenant(tenantId, () => purchaseOrders.issue(order.id, TR_ACTOR));
  const orderLines = await withTenant(tenantId, () => pStore.listPurchaseOrderLines(order.id));
  const grn = await withTenant(tenantId, () =>
    goodsReceipts.create({
      branchId: rls.branchId,
      supplierId: rls.supplierId,
      poId: order.id,
      warehouseId: rls.warehouseId,
      receiptDate: "2026-11-25",
      poLessReason: null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      lines: items.map((item, index) => ({
        poLineId: orderLines[index]!.id,
        itemId: item.itemId,
        qty: item.qty,
        unitCost: item.unitPrice,
        accountId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        note: null,
      })),
    }),
  );
  await withTenant(tenantId, () => goodsReceipts.post(grn.id, TR_ACTOR));
  return grn.id;
}

/** A suspended world per arm: its own deposit (from NULL — the
 * custodial entry) landing `qty` units of `itemId` at the bonded
 * warehouse at the declared unit cost. Returns the move row. */
async function suspendedWorld(input: {
  itemId: string;
  qty: string;
  unitCost: string;
  warehouseId?: string;
}) {
  const created = await withTenant(TENANT_TRADE, () =>
    bonded.create({
      moveKind: "IN_BOND",
      fromWarehouseId: null,
      toWarehouseId: input.warehouseId ?? world.bondedWhId,
      declarationId: null,
      lines: [{ itemId: input.itemId, qty: input.qty, unitCost: input.unitCost }],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  const executed = await withTenant(TENANT_TRADE, () =>
    bonded.execute({ id: created.id, actorId: TR_ACTOR }),
  );
  return executed.move;
}

/** A declaration driven to the wanted rung (its OWN world — a fresh
 * declaration + lines per arm, the quantities ALWAYS set (the release
 * tie's own basis — the fold's ratio law)). */
async function declarationAt(
  rung: "ACCEPTED" | "SUBMITTED",
  input: {
    currency?: string;
    lines: readonly { itemId: string; qty: string; customsValue: string; dutyRate: string }[];
  },
): Promise<string> {
  const created = await withTenant(TENANT_TRADE, () =>
    customs.createDeclaration({
      declarationType: "IMPORT",
      customsOffice: "Jeddah Customs",
      currency: input.currency ?? "SAR",
      receiptId: null,
      purchaseOrderId: null,
      billOfLadingId: null,
      lines: input.lines.map((line) => ({
        hsCode: "8471",
        originCountry: "CN",
        itemId: line.itemId,
        description: null,
        quantity: line.qty,
        uom: "PCS",
        customsValue: line.customsValue,
        dutyRate: line.dutyRate,
        importVat: "0",
        note: null,
        noteAr: null,
      })),
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  await withTenant(TENANT_TRADE, () => customs.submit(created.id, TR_ACTOR));
  if (rung === "SUBMITTED") return created.id;
  await withTenant(TENANT_TRADE, () => customs.accept(created.id, TR_ACTOR));
  return created.id;
}

/** The journal lines of a source key (the golden read's own shape). */
async function journalLines(docType: string, docId: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.amount::text AS amount
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

async function journalCount(docType: string, docId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId}`);
  return rows.rows[0]!.n;
}

/** The register's raw row (the recognition pair's own read). */
async function rawBondedMove(id: string): Promise<{
  status: string;
  moveKind: string;
  dutyAmount: string | null;
  releaseRecognizedAt: string | null;
  releaseJournalEntryId: string | null;
  executedAt: string | null;
}> {
  const rows = await requireTenantContext().tx!.execute<{
    status: string;
    moveKind: string;
    dutyAmount: string | null;
    releaseRecognizedAt: string | null;
    releaseJournalEntryId: string | null;
    executedAt: string | null;
  }>(sql`
    SELECT status, move_kind AS "moveKind", duty_amount::text AS "dutyAmount",
           release_recognized_at::text AS "releaseRecognizedAt",
           release_journal_entry_id::text AS "releaseJournalEntryId",
           executed_at::text AS "executedAt"
    FROM bonded_warehouse_moves WHERE id = ${id}`);
  return rows.rows[0]!;
}

/** The stock position read (qty + WAC — the revaluation's own proof). */
async function positionOf(itemId: string, warehouseId: string): Promise<{ qty: string; avgCost: string | null }> {
  const rows = await requireTenantContext().tx!.execute<{ qty: string; avgCost: string | null }>(sql`
    SELECT qty::text AS qty, avg_cost::text AS "avgCost" FROM item_stock
    WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId}`);
  return rows.rows[0] ?? { qty: "0", avgCost: null };
}

describe("PHASE-051 W-38 — THE BONDED ENGINE (T-11: G-66 through the REAL movement core + THE SHARED GATE's blocking matrix + BR-107's exactly-once release)", () => {
  it("THE DEPOSIT (the bond ledger's seed — declared interpretation #7): the from-NULL IN_BOND move executes through the REAL movement core's receipt leg, lands the stock at the bonded warehouse, and posts NO journal (the custodial entry) — the register's row carries the G-66 no-duty floor (all duty fields NULL), the pool grows", async () => {
    const item = await freshTradeItem("DEP");
    const move = await suspendedWorld({ itemId: item, qty: "100", unitCost: "2.000000" });
    expect(move.status).toBe("EXECUTED");
    expect(move.moveKind).toBe("IN_BOND");
    expect(move.dutyAmount).toBeNull();
    expect(move.releaseRecognizedAt).toBeNull();
    expect(move.releaseJournalEntryId).toBeNull();
    // The stock landed: 100 @ 2.000000 WAC.
    const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(position.qty).toBe("100.000000");
    expect(position.avgCost).toBe("2.000000");
    // NO journal — the custodial deposit (declared interpretation #10).
    expect(await withTenant(TENANT_TRADE, () => journalCount("bonded_warehouse_move", move.id))).toBe(0);
    // THE POOL (the bond ledger's own arithmetic).
    const pool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(pool).toBe("100.000000");
  });

  it("THE BLOCKING MATRIX — THE RAW CHOKE POINT (the 050 hold-gate's own evidence shape): a planIssue on the suspended position is refused with the typed BONDED_STOCK_SUSPENDED naming the stock + the bond + the figures, BEFORE any slice is valued — ZERO residue", async () => {
    const item = await freshTradeItem("RAW");
    await suspendedWorld({ itemId: item, qty: "50", unitCost: "2.000000" });
    await expect(
      withTenant(TENANT_TRADE, () =>
        planIssue({
          itemId: item,
          warehouseId: world.bondedWhId,
          qty: "5",
          movedAt: "2026-11-25",
          moveKind: "issue",
          sourceType: "manual_issue",
          sourceId: item,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BONDED_STOCK_SUSPENDED",
      details: {
        itemId: item,
        warehouseId: world.bondedWhId,
        suspendedQty: "50.000000",
        onHand: "50.000000",
      },
    });
    // ZERO residue: the stock stands (the plan never writes).
    const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(position.qty).toBe("50.000000");
  });

  it("THE BLOCKING MATRIX — THE INVENTORY ISSUE PATH (the canonical baseline): manualIssue refuses with ZERO residue — no moves beyond the deposit's receipt, no journal", async () => {
    const item = await freshTradeItem("MAN");
    const move = await suspendedWorld({ itemId: item, qty: "40", unitCost: "2.000000" });
    await expect(
      withTenant(TENANT_TRADE, () =>
        stock.manualIssue({
          itemId: item,
          warehouseId: world.bondedWhId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-25",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(BondedStockSuspendedError);
    const su = await superuserClient();
    const moves = await su.query(
      `SELECT count(*)::int AS n FROM stock_moves WHERE tenant_id = $1 AND source_id = $2`,
      [TENANT_TRADE, move.id],
    );
    // The deposit's receipt move stands; the refused issue added NOTHING.
    expect(moves.rows[0]!.n).toBe(1);
    const journals = await su.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1 AND source_id = $2`,
      [TENANT_TRADE, move.id],
    );
    expect(journals.rows[0]!.n).toBe(0);
    await su.end();
  });

  it("THE BLOCKING MATRIX — THE SALES DELIVERY PATH (the baseline ship path): the post refuses, the document stays DRAFT, ZERO residue", async () => {
    const item = await freshTradeItem("DLV");
    await suspendedWorld({ itemId: item, qty: "30", unitCost: "2.000000" });
    const note = await withTenant(TENANT_TRADE, () =>
      deliveries.create({
        branchId: world.branchId,
        customerId: world.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: world.bondedWhId,
        deliveryDate: "2026-11-25",
        currencyCode: "SAR",
        note: "the blocked delivery",
        noteAr: null,
        actorId: TR_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: item,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    await expect(
      withTenant(TENANT_TRADE, () => deliveries.post(note.id, TR_ACTOR)),
    ).rejects.toMatchObject({ code: "BONDED_STOCK_SUSPENDED" });
    const su = await superuserClient();
    const state = await su.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = dn.tenant_id AND sm.source_id = dn.id) AS n
       FROM delivery_notes dn WHERE dn.id = $1`,
      [note.id],
    );
    expect(state.rows[0]!.status).toBe("DRAFT");
    expect(state.rows[0]!.n).toBe(0);
    await su.end();
  });

  it("THE BLOCKING MATRIX — THE TRANSFER DISPATCH PATH: the dispatch out of the bonded position refuses (the only legal exits are the bonded module's own in-bond transfer and the release)", async () => {
    const item = await freshTradeItem("XFR");
    await suspendedWorld({ itemId: item, qty: "20", unitCost: "2.000000" });
    const transfer = await withTenant(TENANT_TRADE, () =>
      transfers.create({
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: world.freeWhId,
        note: "the blocked transfer",
        noteAr: null,
        actorId: TR_ACTOR,
        lines: [{ itemId: item, qty: "5" }],
      }),
    );
    await expect(
      withTenant(TENANT_TRADE, () => transfers.dispatch(transfer.id, TR_ACTOR)),
    ).rejects.toMatchObject({ code: "BONDED_STOCK_SUSPENDED" });
  });

  it("THE IN-BOND TRANSFER (G-66 — D-08 VERBATIM): moves INSIDE the bond post NO duty — the REAL movement core's two legs (OUT at WAC with the bypass, IN at the carried cost), the G-15 policy journal on distinct accounts is the VALUE-NEUTRAL pair (DR the dest inventory · CR the src inventory — NEVER a duty line), the bond FOLLOWS THE GOODS (the source's pool drops, the destination's grows), and the gate blocks the DESTINATION alike", async () => {
    const item = await freshTradeItem("IBT");
    // The deposit into TR-BOND (100 @ 2).
    await suspendedWorld({ itemId: item, qty: "100", unitCost: "2.000000" });
    // The in-bond transfer TR-BOND → TR-BOND2 (the explicit 1141 GL —
    // the distinct-accounts policy arm).
    const created = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "IN_BOND",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: world.bondedWh2Id,
        declarationId: null,
        lines: [{ itemId: item, qty: "100", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    const executed = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: created.id, actorId: TR_ACTOR }),
    );
    expect(executed.move.status).toBe("EXECUTED");
    expect(executed.move.dutyAmount).toBeNull();
    // THE STOCK MOVED: TR-BOND empty, TR-BOND2 holds 100 @ 2.
    const src = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(src.qty).toBe("0.000000");
    const dest = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWh2Id));
    expect(dest.qty).toBe("100.000000");
    expect(dest.avgCost).toBe("2.000000");
    // THE G-15 VALUE-NEUTRAL PAIR (distinct accounts 1140/1141): two
    // lines, inventory accounts ONLY, NEVER a duty line.
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("bonded_warehouse_move", created.id),
    );
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ direction: "DEBIT", code: "1141", amount: "200.0000" });
    expect(lines[1]).toMatchObject({ direction: "CREDIT", code: "1140", amount: "200.0000" });
    // NO duty entry: zero journals sourced (bonded_warehouse_move, id,
    // release) — the recognition operation NEVER fired.
    const su = await superuserClient();
    const dutyJournals = await su.query(
      `SELECT count(*)::int AS n FROM journal_entries
       WHERE tenant_id = $1 AND source_id = $2 AND operation = 'release'`,
      [TENANT_TRADE, created.id],
    );
    expect(dutyJournals.rows[0]!.n).toBe(0);
    await su.end();
    // THE BOND FOLLOWS THE GOODS: the source's pool dropped, the
    // destination's grew — and the gate blocks the destination alike.
    const srcPool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(srcPool).toBe("0.000000");
    const destPool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWh2Id));
    expect(destPool).toBe("100.000000");
    await expect(
      withTenant(TENANT_TRADE, () =>
        planIssue({
          itemId: item,
          warehouseId: world.bondedWh2Id,
          qty: "5",
          movedAt: "2026-11-25",
          moveKind: "issue",
          sourceType: "manual_issue",
          sourceId: item,
        }),
      ),
    ).rejects.toMatchObject({ code: "BONDED_STOCK_SUSPENDED" });
  });

  it("THE RELEASE GOLDEN (BR-107 — the G-65-shaped pair at the released quantity): the in-place release recognizes the duty EXACTLY ONCE — the journal (DR the released stock's value 1140 · CR the purpose-mapped CUSTOMS_DUTY_PAYABLE 2145), the revaluation uplift (the WAC/layers math through the REAL service), the ATOMIC recognition pair, THE FLIP-AND-RESTORE (the gate falls silent), and THE SINGLE-USE STAMP (the replay refused)", async () => {
    const item = await freshTradeItem("REL");
    // The world: a deposit (100 @ 2) + an ACCEPTED declaration (qty
    // 100, customs value 200 × 5% = duty 10.0000).
    await suspendedWorld({ itemId: item, qty: "100", unitCost: "2.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [{ itemId: item, qty: "100", customsValue: "200", dutyRate: "0.05" }],
    });
    const created = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId,
        lines: [{ itemId: item, qty: "100", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    const executed = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: created.id, actorId: TR_ACTOR }),
    );
    // THE RECOGNITION PAIR (atomic — the register's own row).
    const raw = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(raw.status).toBe("EXECUTED");
    expect(raw.dutyAmount).toBe("10.0000");
    expect(raw.releaseRecognizedAt).not.toBeNull();
    expect(raw.releaseJournalEntryId).not.toBeNull();
    expect(executed.dutyBase).toBe("10.0000");
    // THE JOURNAL (Dr INVENTORY 1140 · Cr CUSTOMS_DUTY_PAYABLE 2145).
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("bonded_warehouse_move", created.id),
    );
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ direction: "DEBIT", code: "1140", amount: "10.0000" });
    expect(lines[1]).toMatchObject({ direction: "CREDIT", code: "2145", amount: "10.0000" });
    // THE REVALUATION (the WAC uplift at the released quantity): 2 +
    // 10/100 = 2.1 — the REAL service's own math.
    const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(position.qty).toBe("100.000000");
    expect(position.avgCost).toBe("2.100000");
    // The reval's adjust move row (the movement trail's own law).
    const su = await superuserClient();
    const adjustMoves = await su.query<{ n: number; journal: number }>(
      `SELECT count(*)::int AS n, count(posted_journal_id)::int AS journal
       FROM stock_moves WHERE tenant_id = $1 AND source_type = 'bonded_move' AND source_id = $2
         AND move_kind = 'adjust'`,
      [TENANT_TRADE, created.id],
    );
    expect(adjustMoves.rows[0]!.n).toBe(1);
    expect(adjustMoves.rows[0]!.journal).toBe(1);
    // THE FLIP-AND-RESTORE: the pool dropped to zero — the gate fell
    // silent, the manual issue passes (the WAC now carries the duty).
    const pool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(pool).toBe("0.000000");
    await withTenant(TENANT_TRADE, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: world.bondedWhId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-25",
        actorId: TR_ACTOR,
      }),
    );
    await su.end();
    // THE SINGLE-USE STAMP (BR-107's exactly-once): the replay refused
    // with the typed reason — ZERO residue (the row stands).
    await expect(
      withTenant(TENANT_TRADE, () => bonded.execute({ id: created.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({
      code: "BONDED_MOVE_STATE",
      details: { moveNo: executed.move.moveNo },
    });
    const rawAfter = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(rawAfter.dutyAmount).toBe("10.0000");
    expect(await withTenant(TENANT_TRADE, () => journalCount("bonded_warehouse_move", created.id))).toBe(1);
  });

  it("THE RELEASE WITH THE PHYSICAL MOVE (to provided): the OUT leg at WAC (the typed bypass caller), the IN leg at the carried cost, the uplift at the DESTINATION (the released stock's new home) — the destination's WAC carries the duty and its issues pass", async () => {
    const item = await freshTradeItem("RPM");
    await suspendedWorld({ itemId: item, qty: "100", unitCost: "2.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [{ itemId: item, qty: "100", customsValue: "200", dutyRate: "0.05" }],
    });
    const created = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: world.freeWhId,
        declarationId,
        lines: [{ itemId: item, qty: "100", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    const executed = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: created.id, actorId: TR_ACTOR }),
    );
    expect(executed.move.status).toBe("EXECUTED");
    expect(executed.move.dutyAmount).toBe("10.0000");
    // The stock moved: TR-BOND empty, TR-FREE holds 100 @ (2 + 10/100).
    const src = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(src.qty).toBe("0.000000");
    const dest = await withTenant(TENANT_TRADE, () => positionOf(item, world.freeWhId));
    expect(dest.qty).toBe("100.000000");
    expect(dest.avgCost).toBe("2.100000");
    // The pools: both dropped (the source released; the destination
    // never carried one).
    const srcPool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(srcPool).toBe("0.000000");
    const destPool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.freeWhId));
    // An empty bond ledger reads the numeric literal's own "0" — the
    // VALUE is the law (a free warehouse never carries a pool).
    expect(Number(destPool)).toBe(0);
    // The destination's issues pass (the flip-and-restore at the new
    // home).
    await withTenant(TENANT_TRADE, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: world.freeWhId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-25",
        actorId: TR_ACTOR,
      }),
    );
  });

  it("THE PARTIAL RELEASES + THE OVER-RELEASE GUARD (BR-107's arithmetic): two partial releases partition the declared duty; a release exceeding the declared quantity is refused BY NAME — never more duty than the declaration's own figure", async () => {
    const item = await freshTradeItem("PRT");
    await suspendedWorld({ itemId: item, qty: "100", unitCost: "2.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [{ itemId: item, qty: "100", customsValue: "200", dutyRate: "0.05" }],
    });
    // The FIRST partial release: 40 of 100 → duty 4.0000.
    const first = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId,
        lines: [{ itemId: item, qty: "40", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    const firstExecuted = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: first.id, actorId: TR_ACTOR }),
    );
    expect(firstExecuted.move.dutyAmount).toBe("4.0000");
    // The pool: 60 stand.
    const pool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(pool).toBe("60.000000");
    // THE OVER-RELEASE: 61 (40 + 61 > 100) refused BY NAME.
    const illegal = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId,
        lines: [{ itemId: item, qty: "61", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_TRADE, () => bonded.execute({ id: illegal.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "BONDED_RELEASE_SHAPE" });
    // The boundary itself passes: 60 (40 + 60 = 100) GREEN.
    const second = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId,
        lines: [{ itemId: item, qty: "60", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    const secondExecuted = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: second.id, actorId: TR_ACTOR }),
    );
    expect(secondExecuted.move.dutyAmount).toBe("6.0000");
    const poolAfter = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(poolAfter).toBe("0.000000");
  });

  it("THE DECLARATION-STATE REFUSALS (the honest bifurcation): a SUBMITTED declaration refuses (the customs office's acceptance precedes); an EXPORT declaration refuses (the release recognizes IMPORT duty); a COMPLETED declaration refuses (its duties already flowed through G-65 — the double-recognition refusal) — each with ZERO residue (the move stays DRAFT)", async () => {
    const item = await freshTradeItem("DST");
    await suspendedWorld({ itemId: item, qty: "90", unitCost: "2.000000" });
    // SUBMITTED.
    const submittedId = await declarationAt("SUBMITTED", {
      lines: [{ itemId: item, qty: "90", customsValue: "180", dutyRate: "0.05" }],
    });
    const submittedRelease = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId: submittedId,
        lines: [{ itemId: item, qty: "90", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_TRADE, () => bonded.execute({ id: submittedRelease.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "BONDED_RELEASE_SHAPE" });
    // The move stays DRAFT — ZERO residue.
    const rawSubmitted = await withTenant(TENANT_TRADE, () => rawBondedMove(submittedRelease.id));
    expect(rawSubmitted.status).toBe("DRAFT");
    expect(rawSubmitted.dutyAmount).toBeNull();

    // EXPORT type: a raw fixture declaration (its OWN world).
    const su0 = await superuserClient();
    const exportDecl = await su0.query<{ id: string }>(
      `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type, customs_office, status, submitted_at, accepted_at, currency, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'EXPORT', 'Jeddah Customs', 'ACCEPTED', now(), now(), 'SAR', $3)
       RETURNING id`,
      [TENANT_TRADE, `DEC-EXP-${generateUuidV7().slice(0, 8)}`, TR_ACTOR],
    );
    await su0.end();
    const exportRelease = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId: exportDecl.rows[0]!.id,
        lines: [{ itemId: item, qty: "1", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_TRADE, () => bonded.execute({ id: exportRelease.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "BONDED_RELEASE_SHAPE" });

    // COMPLETED: a receipt-linked declaration completed through the
    // REAL G-65 flow, then a release linked to it refused (the honest
    // bifurcation — the duties already flowed through the landed cost).
    const order = await withTenant(TENANT_TRADE, () =>
      purchaseOrders.create({
        branchId: world.branchId,
        supplierId: world.supplierId,
        orderDate: "2026-11-25",
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
        lines: [{ itemId: item, qty: "10", unitPrice: "3.000000", taxCodeId: null, requestLineId: null, note: null }],
      }),
    );
    await withTenant(TENANT_TRADE, () => purchaseOrders.issue(order.id, TR_ACTOR));
    const orderLines = await withTenant(TENANT_TRADE, () => pStore.listPurchaseOrderLines(order.id));
    const grn = await withTenant(TENANT_TRADE, () =>
      goodsReceipts.create({
        branchId: world.branchId,
        supplierId: world.supplierId,
        poId: order.id,
        warehouseId: world.freeWhId,
        receiptDate: "2026-11-25",
        poLessReason: null,
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
        lines: [
          {
            poLineId: orderLines[0]!.id,
            itemId: item,
            qty: "10",
            unitCost: "3.000000",
            accountId: null,
            batchNo: null,
            batchExpiry: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_TRADE, () => goodsReceipts.post(grn.id, TR_ACTOR));
    const completedDeclaration = await withTenant(TENANT_TRADE, () =>
      customs.createDeclaration({
        declarationType: "IMPORT",
        customsOffice: "Jeddah Customs",
        currency: "SAR",
        receiptId: grn.id,
        purchaseOrderId: null,
        billOfLadingId: null,
        lines: [
          {
            hsCode: "8471",
            originCountry: "CN",
            itemId: item,
            description: null,
            quantity: "10",
            uom: "PCS",
            customsValue: "30",
            dutyRate: "0.05",
            importVat: "0",
            note: null,
            noteAr: null,
          },
        ],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    await withTenant(TENANT_TRADE, () => customs.submit(completedDeclaration.id, TR_ACTOR));
    await withTenant(TENANT_TRADE, () => customs.accept(completedDeclaration.id, TR_ACTOR));
    await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: completedDeclaration.id, actorId: TR_ACTOR }),
    );
    const completedRelease = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId: completedDeclaration.id,
        lines: [{ itemId: item, qty: "1", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_TRADE, () =>
        bonded.execute({ id: completedRelease.id, actorId: TR_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BONDED_RELEASE_SHAPE" });
    const rawCompleted = await withTenant(TENANT_TRADE, () => rawBondedMove(completedRelease.id));
    expect(rawCompleted.status).toBe("DRAFT");
  });

  it("THE ZERO-DUTY RELEASE (the declared interpretation #6 extended): an all-EXW/free declaration's release executes with the EMPTY recognition pair — nothing posts (no journal, no revaluation), the pool still releases, and the flip-and-restore holds (the goods leave the bond)", async () => {
    const item = await freshTradeItem("ZDR");
    await suspendedWorld({ itemId: item, qty: "50", unitCost: "3.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [{ itemId: item, qty: "50", customsValue: "150", dutyRate: "0" }],
    });
    const created = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId,
        lines: [{ itemId: item, qty: "50", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    const executed = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: created.id, actorId: TR_ACTOR }),
    );
    expect(executed.move.status).toBe("EXECUTED");
    // THE EMPTY PAIR: the duties that do not, do not.
    const raw = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(raw.dutyAmount).toBeNull();
    expect(raw.releaseRecognizedAt).toBeNull();
    expect(raw.releaseJournalEntryId).toBeNull();
    expect(await withTenant(TENANT_TRADE, () => journalCount("bonded_warehouse_move", created.id))).toBe(0);
    // The WAC never moved.
    const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(position.avgCost).toBe("3.000000");
    // The pool released — the flip-and-restore holds.
    const pool = await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId));
    expect(pool).toBe("0.000000");
    await withTenant(TENANT_TRADE, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: world.bondedWhId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-25",
        actorId: TR_ACTOR,
      }),
    );
  });

  it("THE FX RIDE + THE FAIL-CLOSED PURPOSE (the G-65 flow's own laws, at the release): a foreign-currency declaration requires the contract rate at the act (the missing rate refuses with ZERO residue); the unmapped purpose refuses BEFORE the stamp (the move stays DRAFT); restored → THE RE-RUN GREEN (the flip-and-restore)", async () => {
    const item = await freshTradeItem("FXP");
    await suspendedWorld({ itemId: item, qty: "80", unitCost: "3.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      currency: "USD",
      lines: [{ itemId: item, qty: "80", customsValue: "240", dutyRate: "0.05" }],
    });
    // The USD duty at the released quantity: 240 × 5% = 12 USD.
    const created = await withTenant(TENANT_TRADE, () =>
      bonded.create({
        moveKind: "RELEASE",
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: null,
        declarationId,
        lines: [{ itemId: item, qty: "80", unitCost: null }],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    // THE MISSING RATE: the refusal is typed, ZERO residue.
    await expect(
      withTenant(TENANT_TRADE, () => bonded.execute({ id: created.id, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
    const rawMissing = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(rawMissing.status).toBe("DRAFT");
    // THE FAIL-CLOSED PURPOSE: superseded → the refusal precedes the
    // stamp (the move stays DRAFT, ZERO journals) — the W-37 arm's own
    // supersede shape (the accounting store's supersedePurpose).
    await withTenant(TENANT_TRADE, async () => {
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const active = await tenancy.findActivePurpose("CUSTOMS_DUTY_PAYABLE");
      expect(active).toBeDefined();
      await accounting.supersedePurpose(active!.id, active!.activeFrom);
    });
    await expect(
      withTenant(TENANT_TRADE, () =>
        bonded.execute({ id: created.id, exchangeRate: "3.75", actorId: TR_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BONDED_RELEASE_SHAPE" });
    const rawSuperseded = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(rawSuperseded.status).toBe("DRAFT");
    expect(await withTenant(TENANT_TRADE, () => journalCount("bonded_warehouse_move", created.id))).toBe(0);
    // RESTORED → THE RE-RUN GREEN (the flip-and-restore): the base
    // duty = 12 USD × 3.75 = 45.0000 SAR.
    await withTenant(TENANT_TRADE, async () => {
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      if ((await tenancy.findActivePurpose("CUSTOMS_DUTY_PAYABLE")) === undefined) {
        const account = await tenancy.findAccountByCode("2145");
        expect(account).toBeDefined();
        await tenancy.insertAccountPurpose({
          purposeKey: "CUSTOMS_DUTY_PAYABLE",
          accountId: account!.id,
          activeFrom: new Date().toISOString().slice(0, 10),
        });
      }
    });
    const executed = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: created.id, exchangeRate: "3.75", actorId: TR_ACTOR }),
    );
    expect(executed.move.dutyAmount).toBe("45.0000");
    expect(executed.dutyBase).toBe("45.0000");
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("bonded_warehouse_move", created.id),
    );
    expect(lines.length).toBe(2);
    expect(lines[0]).toMatchObject({ direction: "DEBIT", code: "1140", amount: "45.0000" });
    expect(lines[1]).toMatchObject({ direction: "CREDIT", code: "2145", amount: "45.0000" });
    // The WAC uplift: 3 + 45/80 = 3.5625.
    const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(position.avgCost).toBe("3.562500");
  });

  it("THE REGISTER'S OWN FLOORS: the RELEASE without a declaration link refuses at create (BR-107's law); the IN_BOND without a deposit target refuses; the deposit without its unit cost refuses; the unknown move is the typed 404; a bare execute on an EXECUTED deposit is the replay refusal", async () => {
    await expect(
      withTenant(TENANT_TRADE, () =>
        bonded.create({
          moveKind: "RELEASE",
          fromWarehouseId: world.bondedWhId,
          toWarehouseId: null,
          declarationId: null,
          lines: [{ itemId: world.itemId, qty: "5", unitCost: null }],
          note: null,
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BONDED_RELEASE_SHAPE" });
    await expect(
      withTenant(TENANT_TRADE, () =>
        bonded.create({
          moveKind: "IN_BOND",
          fromWarehouseId: world.bondedWhId,
          toWarehouseId: null,
          declarationId: null,
          lines: [{ itemId: world.itemId, qty: "5", unitCost: null }],
          note: null,
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BONDED_MOVE_STATE" });
    await expect(
      withTenant(TENANT_TRADE, () =>
        bonded.create({
          moveKind: "IN_BOND",
          fromWarehouseId: null,
          toWarehouseId: world.bondedWhId,
          declarationId: null,
          lines: [{ itemId: world.itemId, qty: "5", unitCost: null }],
          note: null,
          noteAr: null,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BONDED_LINE_INVALID" });
    await expect(
      withTenant(TENANT_TRADE, () => bonded.find(generateUuidV7())),
    ).rejects.toMatchObject({ code: "BONDED_MOVE_RECORD_NOT_FOUND" });
    await expect(
      withTenant(TENANT_TRADE, () => bonded.execute({ id: generateUuidV7(), actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "BONDED_MOVE_RECORD_NOT_FOUND" });
    // The typed-input floor (the uuid shape).
    await expect(
      withTenant(TENANT_TRADE, () => bonded.find("not-a-uuid")),
    ).rejects.toMatchObject({ code: "TRADE_INPUT_INVALID" });
  });

  it("THE FLAG-OFF BOUNDARY (the gate's own reading — the W-35/W-37 flags' shape): on a tenant WITHOUT the trade entitlement, a position whose bond-ledger pool is POSITIVE issues GREEN exactly as before (the gate is silent — the pre-051 behavior, never restated narrower)", async () => {
    // The boundary world: a posted GRN (the stock) + a RAW EXECUTED
    // IN_BOND row (the ledger's own read — the bond register exists on
    // the trade plane; the boundary tenant carries no entitlement).
    await postedRlsGrn([{ itemId: world.rls!.itemId, qty: "50", unitPrice: "10.000000" }]);
    const su = await superuserClient();
    await su.query(
      `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, to_warehouse_id, lines, status, executed_at)
       VALUES (gen_random_uuid(), $1, $2, 'IN_BOND', $3, $4::jsonb, 'EXECUTED', now())`,
      [
        TENANT_TRADE_RLS,
        `BND-RLS-${generateUuidV7().slice(0, 8)}`,
        world.rls!.warehouseId,
        JSON.stringify([{ itemId: world.rls!.itemId, qty: "50" }]),
      ],
    );
    await su.end();
    // THE GATE IS SILENT: the manual issue passes (the ordinary issue
    // behaves exactly as before — the flag boundary's own proof).
    await withTenant(TENANT_TRADE_RLS, () =>
      stock.manualIssue({
        itemId: world.rls!.itemId,
        warehouseId: world.rls!.warehouseId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-25",
        actorId: TR_ACTOR,
      }),
    );
  });
});
