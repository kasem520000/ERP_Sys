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
import { PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { GoodsReceiptService } from "../../modules/purchasing/application/goods-receipts";
import { LandedCostService } from "../../modules/purchasing/application/landed-costs";
import * as pStore from "../../modules/purchasing/infrastructure/purchasing.store";
import { CustomsService } from "../../modules/trade/application/customs-service";
import {
  CustomsPurposeNotMappedError,
  DeclarationIncompleteError,
  DeclarationLineTieInvalidError,
  DeclarationRecordNotFoundError,
  DeclarationRequiredError,
  DeclarationStateError,
  HsCodeDuplicateError,
  HsCodeFrozenError,
  HsCodeRecordNotFoundError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-37 — T-10, 2026-11-25) `trade-customs.db.spec` — THE
 * CUSTOMS ENGINE over real PG16 (the plan §4's own arm; the master plan
 * §3 W-37's exit — acceptance #3's engine arms): **G-65 + INV-036** —
 * the line math (the fold's duty_amount on every line), THE ALLOCATION
 * THROUGH THE REAL SERVICE (the LandedCostService the ONLY allocator,
 * D-06/D-15(a) VERBATIM — the landed-cost document of kind customs,
 * DR INVENTORY · DR COGS · CR the purpose-mapped CUSTOMS_DUTY_PAYABLE),
 * THE COMPLETENESS REFUSALS (D-07's honest interpretation:
 * DECLARATION_REQUIRED / DECLARATION_INCOMPLETE) with ZERO residue, and
 * THE LINE-LEVEL TIE («every allocated duty tied to its declaration
 * line» — the one-line-per-item exactness laws, the declared
 * interpretation #5).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * arm builds its own GRN + declaration through the REAL services (the
 * official numbers reserve per row — every world naturally unique); a
 * rejection arm never shares mutable rows with another arm.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const landedCosts = new LandedCostService(audit, posting, numbering, new RevaluationService(audit));
const customs = new CustomsService(audit, numbering, landedCosts);
const purchaseOrders = new PurchaseOrderService(audit, numbering);
const goodsReceipts = new GoodsReceiptService(audit, posting, numbering, new PutawayService(audit));

const world: {
  branchId: string;
  supplierId: string;
  itemId: string;
  itemBId: string;
  warehouseId: string;
  rlsBranchId?: string;
  rlsSupplierId?: string;
  rlsItemId?: string;
  rlsWarehouseId?: string;
} = { branchId: "", supplierId: "", itemId: "", itemBId: "", warehouseId: "" };

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  world.branchId = fixture.branchId;
  world.supplierId = fixture.supplierId;
  world.itemId = fixture.itemId;
  world.warehouseId = fixture.warehouseBId;
  // The LC posting world (the CoA template + FY-TR-FIX's OPEN 2026-11
  // period — every posting lands inside it; the 0122 §8 markers ride
  // the provisioning: CUSTOMS_DUTY_PAYABLE 2145 included).
  await ensureTradeLcPostingWorld();
  // The GRNI mapping (the template's 2130 carries no purpose_key — the
  // purchasing fixture's own gap note; the GRN posts need it).
  await withTenant(TENANT_TRADE, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    if ((await tenancy.findActivePurpose("GRNI")) === undefined) {
      const account = await tenancy.findAccountByCode("2130");
      expect(account).toBeDefined();
      await tenancy.insertAccountPurpose({
        purposeKey: "GRNI",
        accountId: account!.id,
        activeFrom: "2025-12-01",
      });
    }
    void accounting;
  });
  // THE TRADE ENTITLEMENT (the customs floor's own plane — the
  // whole-module composable unit): TENANT_TRADE carries it;
  // TENANT_TRADE_RLS does NOT (the flag-off arm's own world).
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES ($1, $2, 'trade', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [generateUuidV7(), TENANT_TRADE],
  );
  // The second item (the tie-law arms' two-item worlds).
  const itemB = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method, base_price)
     VALUES (gen_random_uuid(), $1, 'TR-ITEM-B', 'TR Import Goods B', 'صنف الاستيراد ب', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 30)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  world.itemBId = itemB.rows[0]!.id;
  // THE BOUNDARY TENANT'S OWN MINI WORLD (the flag-off arm): the full
  // landed-cost substrate WITHOUT the trade entitlement — master-data
  // basics, branch, supplier, item, warehouse, the CoA template + the
  // GRNI mapping + the OPEN period (the GRN posts inside it).
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
  world.rlsBranchId = rlsBranch.rows[0]!.id;
  world.rlsSupplierId = rlsSupplier.rows[0]!.id;
  world.rlsItemId = rlsItem.rows[0]!.id;
  world.rlsWarehouseId = rlsWarehouse.rows[0]!.id;
});

/** A posted GRN over the given items (the allocation substrate — the
 * REAL PO/GRN services, the same shape the purchasing suite rides). */
async function postedGrn(
  items: readonly { itemId: string; qty: string; unitPrice: string }[],
  tenant: "TR" | "RLS" = "TR",
): Promise<{ grnId: string; lines: { grnLineId: string; itemId: string }[] }> {
  const tenantId = tenant === "TR" ? TENANT_TRADE : TENANT_TRADE_RLS;
  const branchId = tenant === "TR" ? world.branchId : world.rlsBranchId!;
  const supplierId = tenant === "TR" ? world.supplierId : world.rlsSupplierId!;
  const warehouseId = tenant === "TR" ? world.warehouseId : world.rlsWarehouseId!;
  const actor = TR_ACTOR;
  const order = await withTenant(tenantId, () =>
    purchaseOrders.create({
      branchId,
      supplierId,
      orderDate: "2026-11-25",
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      actorId: actor,
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
  await withTenant(tenantId, () => purchaseOrders.issue(order.id, actor));
  const orderLines = await withTenant(tenantId, () => pStore.listPurchaseOrderLines(order.id));
  const grn = await withTenant(tenantId, () =>
    goodsReceipts.create({
      branchId,
      supplierId,
      poId: order.id,
      warehouseId,
      receiptDate: "2026-11-25",
      poLessReason: null,
      note: null,
      noteAr: null,
      actorId: actor,
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
  await withTenant(tenantId, () => goodsReceipts.post(grn.id, actor));
  const lines = await withTenant(tenantId, () => pStore.listGoodsReceiptLines(grn.id));
  return {
    grnId: grn.id,
    lines: lines
      .filter((line) => line.accountId === null)
      .map((line) => ({ grnLineId: line.id, itemId: line.itemId })),
  };
}

/** A declaration driven to the wanted rung (its OWN world — a fresh
 * declaration + lines per arm). */
async function declarationAt(
  rung: "DRAFT" | "SUBMITTED" | "ACCEPTED",
  input: {
    grnId: string | null;
    currency?: string;
    lines: readonly {
      itemId?: string | null;
      customsValue: string;
      dutyRate: string;
      importVat: string;
    }[];
  },
): Promise<string> {
  const created = await withTenant(TENANT_TRADE, () =>
    customs.createDeclaration({
      declarationType: "IMPORT",
      customsOffice: "Jeddah Customs",
      currency: input.currency ?? "SAR",
      receiptId: input.grnId,
      purchaseOrderId: null,
      billOfLadingId: null,
      lines: input.lines.map((line) => ({
        hsCode: "8471",
        originCountry: "CN",
        itemId: line.itemId ?? null,
        description: null,
        quantity: null,
        uom: null,
        customsValue: line.customsValue,
        dutyRate: line.dutyRate,
        importVat: line.importVat,
        note: null,
        noteAr: null,
      })),
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  if (rung === "DRAFT") return created.id;
  await withTenant(TENANT_TRADE, () => customs.submit(created.id, TR_ACTOR));
  if (rung === "SUBMITTED") return created.id;
  await withTenant(TENANT_TRADE, () => customs.accept(created.id, TR_ACTOR));
  return created.id;
}

/** The landed-cost rows sourcing a declaration (the zero-residue read). */
async function landedCostsOf(declarationId: string): Promise<{ id: string; status: string; costNo: string | null }[]> {
  const rows = await requireTenantContext().tx!.execute<{ id: string; status: string; costNo: string | null }>(sql`
    SELECT id, status, cost_no AS "costNo" FROM landed_costs WHERE declaration_id = ${declarationId}`);
  return rows.rows;
}

/** The allocation rows of a landed cost (the line-level tie read). */
async function allocationsOf(landedCostId: string): Promise<
  { grnLineId: string; declarationLineId: string | null; allocatedAmount: string }[]
> {
  const rows = await requireTenantContext().tx!.execute<{
    grnLineId: string;
    declarationLineId: string | null;
    allocatedAmount: string;
  }>(sql`
    SELECT grn_line_id AS "grnLineId", declaration_line_id AS "declarationLineId",
           allocated_amount::text AS "allocatedAmount"
    FROM landed_cost_allocations WHERE landed_cost_id = ${landedCostId} ORDER BY grn_line_id`);
  return rows.rows;
}

/** The journal lines of a source key (the golden read's own shape). */
async function journalLines(docType: string, docId: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
    currency: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.amount::text AS amount, je.currency_code AS currency
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

async function rawDeclaration(id: string): Promise<{
  status: string;
  landedCostId: string | null;
  landedCostNo: string | null;
}> {
  const rows = await requireTenantContext().tx!.execute<{
    status: string;
    landedCostId: string | null;
    landedCostNo: string | null;
  }>(sql`
    SELECT status, landed_cost_id AS "landedCostId", landed_cost_no AS "landedCostNo"
    FROM customs_declarations WHERE id = ${id}`);
  return rows.rows[0]!;
}

describe("PHASE-051 W-37 — THE CUSTOMS ENGINE (T-10: G-65 through the REAL LandedCostService + INV-036's completeness floor + the line-level tie)", () => {
  it("THE GOLDEN G-65 ARM (D-06 VERBATIM): the completion creates + posts the landed-cost document of kind customs through the REAL service — DR INVENTORY · CR the purpose-mapped CUSTOMS_DUTY_PAYABLE — the allocation rows carry THE LINE-LEVEL TIE, the declaration's linkage pair lands, the totals render from the lines, and THE COMPLETION IS EXACTLY-ONCE", async () => {
    // The world: a posted GRN over two items (100 @ 2 + 50 @ 4).
    const grn = await postedGrn([
      { itemId: world.itemId, qty: "100", unitPrice: "2.000000" },
      { itemId: world.itemBId, qty: "50", unitPrice: "4.000000" },
    ]);
    // The declaration: one line per item (the tie's function shape).
    // itemA: 200 × 5% = 10 duty + 15 VAT; itemB: 200 × 2.5% = 5 + 10.
    const declarationId = await declarationAt("ACCEPTED", {
      grnId: grn.grnId,
      lines: [
        { itemId: world.itemId, customsValue: "200", dutyRate: "0.05", importVat: "15" },
        { itemId: world.itemBId, customsValue: "200", dutyRate: "0.025", importVat: "10" },
      ],
    });
    const completed = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }),
    );
    // The completion's own summary: the fold's totals + the landed amount.
    expect(completed.declaration.status).toBe("COMPLETED");
    expect(completed.totals.totalCustomsValue).toBe("400.0000");
    expect(completed.totals.totalDuty).toBe("15.0000");
    expect(completed.totals.totalImportVat).toBe("25.0000");
    expect(completed.totals.totalLandedAmount).toBe("40.0000");
    expect(completed.landedAmountBase).toBe("40.0000");
    expect(completed.landedCost).not.toBeNull();
    expect(completed.landedCost!.costNo).toMatch(/^LDC-2026-\d{6}$/);
    expect(completed.landedCost!.journalEntryId).not.toBeNull();
    // The declaration's own linkage pair (the 0125 columns).
    const raw = await withTenant(TENANT_TRADE, () => rawDeclaration(declarationId));
    expect(raw.landedCostId).toBe(completed.landedCost!.id);
    expect(raw.landedCostNo).toBe(completed.landedCost!.costNo);
    // THE JOURNAL (G-65's own shape — DR INVENTORY · CR CUSTOMS_DUTY_PAYABLE):
    // fully on hand → allocated_to_stock = 40, COGS = 0.
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("landed_cost", completed.landedCost!.id),
    );
    expect(lines).toEqual([
      { direction: "DEBIT", code: "1140", amount: "40.0000", currency: "SAR" },
      { direction: "CREDIT", code: "2145", amount: "40.0000", currency: "SAR" },
    ]);
    // THE LINE-LEVEL TIE (INV-036's own demand): every allocation row
    // carries its declaration line.
    const allocations = await withTenant(TENANT_TRADE, () =>
      allocationsOf(completed.landedCost!.id),
    );
    expect(allocations.length).toBe(2);
    const declarationLines = await withTenant(TENANT_TRADE, () =>
      requireTenantContext().tx!.execute<{ id: string; itemId: string | null }>(sql`
        SELECT id, item_id AS "itemId" FROM customs_declaration_lines
        WHERE declaration_id = ${declarationId} ORDER BY line_no`),
    );
    const tieByItem = new Map(declarationLines.rows.map((row) => [row.itemId, row.id]));
    for (const allocation of allocations) {
      expect(allocation.declarationLineId).not.toBeNull();
    }
    const grnLineA = grn.lines.find((line) => line.itemId === world.itemId)!;
    const grnLineB = grn.lines.find((line) => line.itemId === world.itemBId)!;
    const tieA = allocations.find((row) => row.grnLineId === grnLineA.grnLineId)!;
    const tieB = allocations.find((row) => row.grnLineId === grnLineB.grnLineId)!;
    expect(tieA.declarationLineId).toBe(tieByItem.get(world.itemId));
    expect(tieB.declarationLineId).toBe(tieByItem.get(world.itemBId));
    // The VALUE allocation: both lines' basis 200/400 → 20.0000 each.
    expect(tieA.allocatedAmount).toBe("20.0000");
    expect(tieB.allocatedAmount).toBe("20.0000");
    // THE EXACTLY-ONCE (the completion CAS): a second complete refuses.
    const second = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }).catch((error: unknown) => error),
    );
    expect(second).toBeInstanceOf(DeclarationStateError);
    expect((second as DeclarationStateError).details).toMatchObject({
      from: "COMPLETED",
      to: "COMPLETED",
    });
    expect(String((second as DeclarationStateError).details?.declarationNo)).toMatch(/^CUS-\d{4}-\d{6}$/);
    // One landed-cost document, ever (the 0125 unique's caller-side proof).
    expect(await withTenant(TENANT_TRADE, () => landedCostsOf(declarationId))).toHaveLength(1);
    // The find's own chain: the declaration + the lines + the totals.
    const found = await withTenant(TENANT_TRADE, () => customs.find(declarationId));
    expect(found.totals.totalLandedAmount).toBe("40.0000");
    expect(found.lines).toHaveLength(2);
    expect(found.lines[0]!.dutyAmount).toBe("10.0000");
    expect(found.lines[1]!.dutyAmount).toBe("5.0000");
  });

  it("INV-036's COMPLETENESS FLOOR (D-07's honest interpretation): a customs landed-cost allocation on a receipt whose declaration is ACCEPTED (not COMPLETED) refuses DECLARATION_INCOMPLETE with ZERO residue; a receipt with NO declaration refuses DECLARATION_REQUIRED — the drafts stand, nothing posts", async () => {
    // World A: the incomplete-declaration receipt.
    const grnA = await postedGrn([{ itemId: world.itemId, qty: "40", unitPrice: "3.000000" }]);
    await declarationAt("ACCEPTED", {
      grnId: grnA.grnId,
      lines: [{ itemId: world.itemId, customsValue: "120", dutyRate: "0.05", importVat: "6" }],
    });
    const chargeA = await withTenant(TENANT_TRADE, () => ensureCustomsAccount());
    expect(chargeA).not.toBeNull();
    const costA = await withTenant(TENANT_TRADE, () =>
      landedCosts.create({
        grnId: grnA.grnId,
        costType: "customs",
        vendorId: null,
        amount: "12.0000",
        allocationMethod: "VALUE",
        chargeAccountId: chargeA!,
        note: null,
        actorId: TR_ACTOR,
      }),
    );
    const refusalA = await withTenant(TENANT_TRADE, () =>
      landedCosts.post(costA.id, TR_ACTOR).catch((error: unknown) => error),
    );
    expect(refusalA).toBeInstanceOf(DeclarationIncompleteError);
    // ZERO RESIDUE: the draft stays a draft — no journal, no allocations.
    const draftA = await withTenant(TENANT_TRADE, () => pStore.findLandedCostById(costA.id));
    expect(draftA!.status).toBe("DRAFT");
    expect(draftA!.postedJournalId).toBeNull();
    expect(await withTenant(TENANT_TRADE, () => journalCount("landed_cost", costA.id))).toBe(0);
    expect(await withTenant(TENANT_TRADE, () => allocationsOf(costA.id))).toHaveLength(0);

    // World B: the no-declaration receipt.
    const grnB = await postedGrn([{ itemId: world.itemBId, qty: "30", unitPrice: "5.000000" }]);
    const costB = await withTenant(TENANT_TRADE, () =>
      landedCosts.create({
        grnId: grnB.grnId,
        costType: "customs",
        vendorId: null,
        amount: "20.0000",
        allocationMethod: "VALUE",
        chargeAccountId: chargeA!,
        note: null,
        actorId: TR_ACTOR,
      }),
    );
    const refusalB = await withTenant(TENANT_TRADE, () =>
      landedCosts.post(costB.id, TR_ACTOR).catch((error: unknown) => error),
    );
    expect(refusalB).toBeInstanceOf(DeclarationRequiredError);
    const draftB = await withTenant(TENANT_TRADE, () => pStore.findLandedCostById(costB.id));
    expect(draftB!.status).toBe("DRAFT");
    expect(await withTenant(TENANT_TRADE, () => journalCount("landed_cost", costB.id))).toBe(0);
  });

  it("THE NON-DUTY LANDED COSTS STAND UNTOUCHED (D-07's own boundary — the existing behavior, never restated narrower): a freight landed cost posts GREEN with NO declaration anywhere near the receipt", async () => {
    const grn = await postedGrn([{ itemId: world.itemId, qty: "25", unitPrice: "6.000000" }]);
    const charge = await withTenant(TENANT_TRADE, () => ensureCustomsAccount());
    const cost = await withTenant(TENANT_TRADE, () =>
      landedCosts.create({
        grnId: grn.grnId,
        costType: "freight",
        vendorId: null,
        amount: "30.0000",
        allocationMethod: "VALUE",
        chargeAccountId: charge!,
        note: "ordinary freight",
        actorId: TR_ACTOR,
      }),
    );
    const posted = await withTenant(TENANT_TRADE, () => landedCosts.post(cost.id, TR_ACTOR));
    expect(posted.cost.status).toBe("POSTED");
    expect(posted.costNo).toMatch(/^LDC-2026-\d{6}$/);
    // The ordinary allocation rows carry NO tie (the null-on-ordinary law).
    const allocations = await withTenant(TENANT_TRADE, () => allocationsOf(cost.id));
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.declarationLineId).toBeNull();
  });

  it("THE LINE-LEVEL TIE'S EXACTNESS LAWS (the declared interpretation #5 — INV-018's all-or-nothing): a line without an item, a doubled item, and an undeclared GRN item each refuse at the landed-cost post — THE WHOLE COMPLETION ROLLS BACK (the declaration stays ACCEPTED, zero landed-cost documents, zero journals)", async () => {
    // (a) a declaration line without an item.
    const grnA = await postedGrn([{ itemId: world.itemId, qty: "10", unitPrice: "2.000000" }]);
    const declarationA = await declarationAt("ACCEPTED", {
      grnId: grnA.grnId,
      lines: [{ itemId: null, customsValue: "20", dutyRate: "0.05", importVat: "1" }],
    });
    // NOTE (the INV-018 proof's own shape): the catch rides OUTSIDE the
    // withTenant — the refusal must propagate through the transaction so
    // the whole act rolls back (a catch inside would commit the stamp).
    const refusalA = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationA, actorId: TR_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusalA).toBeInstanceOf(DeclarationLineTieInvalidError);
    expect((refusalA as DeclarationLineTieInvalidError).message).toContain("carries no item");
    // INV-018: the whole act rolled back — the declaration stays ACCEPTED.
    expect((await withTenant(TENANT_TRADE, () => rawDeclaration(declarationA))).status).toBe("ACCEPTED");
    expect(await withTenant(TENANT_TRADE, () => landedCostsOf(declarationA))).toHaveLength(0);

    // (b) the doubled item (the tie is a function, never a relation).
    const grnB = await postedGrn([{ itemId: world.itemBId, qty: "12", unitPrice: "2.000000" }]);
    const declarationB = await declarationAt("ACCEPTED", {
      grnId: grnB.grnId,
      lines: [
        { itemId: world.itemBId, customsValue: "12", dutyRate: "0.05", importVat: "1" },
        { itemId: world.itemBId, customsValue: "6", dutyRate: "0.05", importVat: "1" },
      ],
    });
    const refusalB = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationB, actorId: TR_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusalB).toBeInstanceOf(DeclarationLineTieInvalidError);
    expect((refusalB as DeclarationLineTieInvalidError).message).toContain("one declaration line per item");
    expect((await withTenant(TENANT_TRADE, () => rawDeclaration(declarationB))).status).toBe("ACCEPTED");
    expect(await withTenant(TENANT_TRADE, () => landedCostsOf(declarationB))).toHaveLength(0);

    // (c) the coverage law: a GRN stock line's item NOT declared.
    const grnC = await postedGrn([
      { itemId: world.itemId, qty: "8", unitPrice: "2.000000" },
      { itemId: world.itemBId, qty: "8", unitPrice: "2.000000" },
    ]);
    const declarationC = await declarationAt("ACCEPTED", {
      grnId: grnC.grnId,
      lines: [{ itemId: world.itemId, customsValue: "16", dutyRate: "0.05", importVat: "1" }],
    });
    const refusalC = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationC, actorId: TR_ACTOR }),
    ).catch((error: unknown) => error);
    expect(refusalC).toBeInstanceOf(DeclarationLineTieInvalidError);
    expect((refusalC as DeclarationLineTieInvalidError).message).toContain("is not declared on this declaration");
    expect((await withTenant(TENANT_TRADE, () => rawDeclaration(declarationC))).status).toBe("ACCEPTED");
    expect(await withTenant(TENANT_TRADE, () => landedCostsOf(declarationC))).toHaveLength(0);
  });

  it("THE FAIL-CLOSED PURPOSE (G-65's own law): CUSTOMS_DUTY_PAYABLE superseded → the completion refuses with ZERO residue (the declaration stays ACCEPTED — the check precedes the stamp); restored → THE RE-RUN GREEN (the flip-and-restore)", async () => {
    const grn = await postedGrn([{ itemId: world.itemId, qty: "18", unitPrice: "4.000000" }]);
    const declarationId = await declarationAt("ACCEPTED", {
      grnId: grn.grnId,
      lines: [{ itemId: world.itemId, customsValue: "72", dutyRate: "0.05", importVat: "5" }],
    });
    // THE FLIP: supersede the purpose mapping.
    await withTenant(TENANT_TRADE, async () => {
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const active = await tenancy.findActivePurpose("CUSTOMS_DUTY_PAYABLE");
      expect(active).toBeDefined();
      await accounting.supersedePurpose(active!.id, active!.activeFrom);
    });
    const refusal = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }).catch((error: unknown) => error),
    );
    expect(refusal).toBeInstanceOf(CustomsPurposeNotMappedError);
    // ZERO RESIDUE: the check precedes the stamp — the declaration stays
    // ACCEPTED, no landed-cost document, no journal.
    expect((await withTenant(TENANT_TRADE, () => rawDeclaration(declarationId))).status).toBe("ACCEPTED");
    expect(await withTenant(TENANT_TRADE, () => landedCostsOf(declarationId))).toHaveLength(0);
    // THE RESTORE: the re-run GREEN (the flip-and-restore law).
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
    const completed = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }),
    );
    expect(completed.declaration.status).toBe("COMPLETED");
    expect(completed.landedCost).not.toBeNull();
    expect(completed.landedAmountBase).toBe("8.6000");
  });

  it("THE FX RIDE (D-21's own shape): a foreign-currency declaration completes at the act's contract rate — the landed amount is the BASE figure (the existing engine's own law); the missing rate refuses at the act", async () => {
    const grn = await postedGrn([{ itemId: world.itemBId, qty: "22", unitPrice: "5.000000" }]);
    const declarationId = await declarationAt("ACCEPTED", {
      grnId: grn.grnId,
      currency: "USD",
      lines: [{ itemId: world.itemBId, customsValue: "100", dutyRate: "0.05", importVat: "5" }],
    });
    // The missing contract rate refuses (the existing FX discipline).
    const refusal = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }).catch((error: unknown) => error),
    );
    expect((refusal as Error).message).toContain("the contract rate is required at the act");
    expect((await withTenant(TENANT_TRADE, () => rawDeclaration(declarationId))).status).toBe("ACCEPTED");
    // The contract rate: 10 (duty + vat) × 3.75 = 37.5000 base.
    const completed = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, exchangeRate: "3.75000000", actorId: TR_ACTOR }),
    );
    expect(completed.landedAmountBase).toBe("37.5000");
    expect(completed.landedCost).not.toBeNull();
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("landed_cost", completed.landedCost!.id),
    );
    expect(lines.map((line) => [line.direction, line.code, line.amount])).toEqual([
      ["DEBIT", "1140", "37.5000"],
      ["CREDIT", "2145", "37.5000"],
    ]);
  });

  it("THE ZERO-DUTY COMPLETION (the declared interpretation #6, recorded at the claim site): an all-EXW/free set completes WITHOUT a landed-cost document — nothing to allocate, the linkage pair stays NULL, the stamp stands alone", async () => {
    const grn = await postedGrn([{ itemId: world.itemId, qty: "9", unitPrice: "3.000000" }]);
    const declarationId = await declarationAt("ACCEPTED", {
      grnId: grn.grnId,
      lines: [{ itemId: world.itemId, customsValue: "27", dutyRate: "0", importVat: "0" }],
    });
    const completed = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }),
    );
    expect(completed.declaration.status).toBe("COMPLETED");
    expect(completed.landedCost).toBeNull();
    expect(completed.landedAmountBase).toBe("0.0000");
    const raw = await withTenant(TENANT_TRADE, () => rawDeclaration(declarationId));
    expect(raw.landedCostId).toBeNull();
    expect(raw.landedCostNo).toBeNull();
  });

  it("THE LADDER + THE LINES WINDOW (the 0121 stamp law's fold): the lines add only on the DRAFT rung; the cancellation exits the DRAFT rung ONLY (the submission stamp is monotone evidence that never un-stamps); the unknown declaration is the typed 404", async () => {
    // The DRAFT-only lines window.
    const grn = await postedGrn([{ itemId: world.itemId, qty: "6", unitPrice: "2.000000" }]);
    const declarationId = await declarationAt("SUBMITTED", {
      grnId: grn.grnId,
      lines: [{ itemId: world.itemId, customsValue: "12", dutyRate: "0.05", importVat: "1" }],
    });
    const addRefusal = await withTenant(TENANT_TRADE, () =>
      customs
        .addLine(declarationId, {
          hsCode: "8471",
          originCountry: "CN",
          itemId: world.itemId,
          description: null,
          quantity: null,
          uom: null,
          customsValue: "5",
          dutyRate: "0.05",
          importVat: "0",
          note: null,
          noteAr: null,
        }, TR_ACTOR)
        .catch((error: unknown) => error),
    );
    expect(addRefusal).toBeInstanceOf(DeclarationStateError);
    expect((addRefusal as DeclarationStateError).message).toContain("the lines window is the DRAFT rung only");
    // The DRAFT-only cancel (the 0121 stamp-shape floor).
    const cancelRefusal = await withTenant(TENANT_TRADE, () =>
      customs.cancel(declarationId, "withdrawn", TR_ACTOR).catch((error: unknown) => error),
    );
    expect(cancelRefusal).toBeInstanceOf(DeclarationStateError);
    expect((cancelRefusal as DeclarationStateError).message).toContain("the submission stamp is monotone evidence");
    // The DRAFT rung DOES cancel (its own world).
    const draftId = await declarationAt("DRAFT", {
      grnId: null,
      lines: [{ itemId: null, customsValue: "10", dutyRate: "0", importVat: "0" }],
    });
    const cancelled = await withTenant(TENANT_TRADE, () =>
      customs.cancel(draftId, "withdrawn before lodging", TR_ACTOR),
    );
    expect(cancelled.status).toBe("CANCELLED");
    // The typed 404.
    const notFound = await withTenant(TENANT_TRADE, () =>
      customs.find("00000000-0000-4000-8000-000000000000").catch((error: unknown) => error),
    );
    expect(notFound).toBeInstanceOf(DeclarationRecordNotFoundError);
  });

  it("THE HS REGISTRY (D-16 — the tenant-extensible starter set): the tenant addition, the duplicate refused BY NAME, the frozen code, the retirement's snapshot semantics, the typed 404", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      customs.createHsCode({
        hsCode: "9401",
        name: "Seats (furniture)",
        nameAr: "مقاعد (أثاث)",
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    expect(created.hsCode).toBe("9401");
    expect(created.isActive).toBe(true);
    // The duplicate refuses BY NAME.
    const duplicate = await withTenant(TENANT_TRADE, () =>
      customs
        .createHsCode({
          hsCode: "9401",
          name: "Seats again",
          nameAr: "مقاعد مرة أخرى",
          note: null,
          noteAr: null,
          actorId: TR_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(duplicate).toBeInstanceOf(HsCodeDuplicateError);
    // The frozen code.
    const frozen = await withTenant(TENANT_TRADE, () =>
      customs
        .updateHsCode({
          hsCode: "9401",
          attemptedCode: "9402",
          actorId: TR_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(frozen).toBeInstanceOf(HsCodeFrozenError);
    // The retirement (the snapshot semantics: the row stays, reads filter).
    const retired = await withTenant(TENANT_TRADE, () =>
      customs.updateHsCode({ hsCode: "9401", isActive: false, actorId: TR_ACTOR }),
    );
    expect(retired.isActive).toBe(false);
    const activeList = await withTenant(TENANT_TRADE, () => customs.listHsCodes({ activeOnly: true }));
    expect(activeList.find((row) => row.hsCode === "9401")).toBeUndefined();
    const fullList = await withTenant(TENANT_TRADE, () => customs.listHsCodes({ activeOnly: false }));
    expect(fullList.find((row) => row.hsCode === "9401")).toBeDefined();
    // The typed 404.
    const notFound = await withTenant(TENANT_TRADE, () =>
      customs.findHsCode("9999999999").catch((error: unknown) => error),
    );
    expect(notFound).toBeInstanceOf(HsCodeRecordNotFoundError);
  });

  it("THE FLAG-OFF BOUNDARY (the gate's own reading — the W-35 order gate's shape): on a tenant WITHOUT the trade entitlement, a customs-kind landed cost posts GREEN exactly as before (the floor is silent, the pre-051 behavior never restated narrower)", async () => {
    const grn = await postedGrn([{ itemId: world.rlsItemId!, qty: "15", unitPrice: "2.000000" }], "RLS");
    let chargeAccount: string | null = null;
    await withTenant(TENANT_TRADE_RLS, async () => {
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const account = await tenancy.findAccountByCode("5240");
      chargeAccount = account?.id ?? null;
    });
    expect(chargeAccount).not.toBeNull();
    const cost = await withTenant(TENANT_TRADE_RLS, () =>
      landedCosts.create({
        grnId: grn.grnId,
        costType: "customs",
        vendorId: null,
        amount: "15.0000",
        allocationMethod: "VALUE",
        chargeAccountId: chargeAccount!,
        note: "pre-051 customs cost on a flag-off tenant",
        actorId: TR_ACTOR,
      }),
    );
    const posted = await withTenant(TENANT_TRADE_RLS, () => landedCosts.post(cost.id, TR_ACTOR));
    expect(posted.cost.status).toBe("POSTED");
    expect(posted.costNo).toMatch(/^LDC-2026-\d{6}$/);
  });
});

/** The purpose-mapped customs account (the arms' charge account). */
async function ensureCustomsAccount(): Promise<string | null> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const mapping = await tenancy.findActivePurpose("CUSTOMS_DUTY_PAYABLE");
  return mapping?.accountId ?? null;
}
