import { sql } from "drizzle-orm";
import type { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";

import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import {
  ensureTradeLcPostingWorld,
  setupTradeFixture,
  TENANT_TRADE,
  TR_ACTOR,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingError } from "../../modules/accounting/domain/posting-engine/posting-errors";
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
import { LcService } from "../../modules/trade/application/lc-service";
import { CustomsService } from "../../modules/trade/application/customs-service";
import { BondedService } from "../../modules/trade/application/bonded-service";
import { planIssue } from "../../modules/inventory/application/movement-core";
import { suspendedQtyAt } from "../../modules/trade/infrastructure/bonded-gate";
import {
  BondedMoveStateError,
  BondedReleaseShapeError,
  DeclarationIncompleteError,
  DeclarationRequiredError,
  DeclarationStateError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-41 — T-16, dated 2026-11-26) · `trade-goldens.db.spec` —
 * THE GOLDEN TRANSCRIPTS with their MANDATORY FAILURE PACKS (the
 * JOURNAL_RULES §7 law, the 048-W14/049-W22/050-W31 pattern: every
 * golden row is mirrored by a golden test whose failure pack flips the
 * world to the failing shape, proves the typed refusal WITH ITS FULL
 * PAYLOAD and the ZERO RESIDUE, restores through the runtime surface,
 * and the SAME act re-runs green). The transcripts:
 *
 * - G-64 (D-05 — the LC margin deposit/retirement): the issue deposits
 *   the margin — DR the purpose-mapped LC_MARGIN_DEPOSIT (1180) · CR the
 *   tenant's chosen bank (1121, SAR) — and the retirement REVERSES it
 *   (DR the bank · CR 1180) with the settled pair stamped TOGETHER; the
 *   journal EXACT at the line level (4dp, balanced to the cent), the
 *   INV-013 single-use keys (lc, issue)/(lc, retirement), the
 *   INV-019-exact treasury movements; the pack carries the unmapped
 *   LC_MARGIN_DEPOSIT flip (PURPOSE_NOT_MAPPED with its payload, the
 *   register untouched at DRAFT, zero journals, zero movements) and the
 *   flip-and-restore green re-run with the SAME transcript;
 * - G-65 (D-06 — the declaration completion): the duty+VAT totals
 *   through the PURE fold → the landed-cost document of kind `customs`
 *   through the REAL LandedCostService (DR INVENTORY 1140 · CR the
 *   purpose-mapped CUSTOMS_DUTY_PAYABLE 2145 — rendered VERBATIM what
 *   the engine posts), the line-level tie, the linkage pair, the
 *   exactly-once; the pack is INV-036's completeness — a customs
 *   landed-cost allocation on an import receipt REFUSED without a
 *   completed declaration (DECLARATION_INCOMPLETE / DECLARATION_REQUIRED
 *   with ZERO residue), then the flip-and-restore: the declaration
 *   completed through the runtime surface and the SAME post GREEN;
 * - G-66/BR-107 (D-08/D-11 — the bonded release): the recognition pair
 *   (DR the released stock's value 1140 · CR the purpose-mapped
 *   CUSTOMS_DUTY_PAYABLE 2145) EXACTLY-ONCE (the single-use stamp), the
 *   revaluation uplift through the REAL service, the zero-duty release's
 *   EMPTY pair; the pack carries the unmapped CUSTOMS_DUTY_PAYABLE flip
 *   (the typed refusal, the move untouched at DRAFT) and the
 *   flip-and-restore green re-run;
 * - THE BONDED BLOCKING-MATRIX GOLDEN: ONE arm walking the canonical
 *   baseline issue paths (the raw planIssue, the manualIssue, the
 *   sales-delivery post, the transfer dispatch) with the typed
 *   BONDED_STOCK_SUSPENDED refusal's FULL payload + ZERO residue per
 *   path + THE FLIP-AND-RESTORE (the release, then the same issue
 *   GREEN);
 * - THE OFFLINE-REJECTION SHAPE (D-20 — OA-02 N/A-RECORDED for trade,
 *   the master plan's own ruling: trade documentation is web-only, no
 *   synced entity added; the bonded gate is SERVER-SIDE in planIssue):
 *   the arm proves the SERVER-SIDE-ONLY law — the same refusal from a
 *   second distinct baseline path (the sync-reconciliation-shaped
 *   delivery draft's POST) with the details EQUAL payload-for-payload.
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * arm builds its OWN world with unique natural keys (the GLD-* code
 * family — the quality W-31 honest disclosure's lesson: codes never
 * collide across specs sharing the tenant; the official numbers reserve
 * per row through the REAL services) and every failure pack restores
 * the world it flipped.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const revaluation = new RevaluationService(audit);
const landedCosts = new LandedCostService(audit, posting, numbering, new RevaluationService(audit));
const lcs = new LcService(audit, posting, numbering);
const customs = new CustomsService(audit, numbering, landedCosts);
const bonded = new BondedService(audit, numbering, posting, revaluation);
const stock = new StockService(audit, posting);
const transfers = new TransferService(audit, posting, numbering);
const deliveries = new DeliveryNoteService(audit, posting, numbering, new PickingService(audit, numbering));
const purchaseOrders = new PurchaseOrderService(audit, numbering);
const goodsReceipts = new GoodsReceiptService(audit, posting, numbering, new PutawayService(audit));

const world: {
  branchId: string;
  supplierId: string;
  customerId: string;
  freeWhId: string;
  bondedWhId: string;
  sarBankId: string;
  sarBankCode: string;
  marginAccountCode: string;
  dutyAccountCode: string;
} = {
  branchId: "",
  supplierId: "",
  customerId: "",
  freeWhId: "",
  bondedWhId: "",
  sarBankId: "",
  sarBankCode: "",
  marginAccountCode: "",
  dutyAccountCode: "",
};

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  world.branchId = fixture.branchId;
  world.supplierId = fixture.supplierId;
  world.freeWhId = fixture.warehouseBId; // TR-FREE (free circulation)
  world.bondedWhId = fixture.warehouseAId; // TR-BOND (the customs bond)
  // The LC posting world (the CoA template with the 0122 §8 markers
  // LC_MARGIN_DEPOSIT 1180 + CUSTOMS_DUTY_PAYABLE 2145, FY-TR-FIX's OPEN
  // 2026-11 period, the SAR bank) — every posting lands inside it.
  const postingWorld = await ensureTradeLcPostingWorld();
  world.sarBankId = postingWorld.sarBankId;
  world.sarBankCode = postingWorld.glSarBankCode;
  world.marginAccountCode = postingWorld.marginAccountCode;
  world.dutyAccountCode = "2145";
  // The GRNI mapping (the template's 2130 carries no purpose_key — the
  // purchasing fixture's own gap note; the GRN posts need it) — ensured
  // HERE so this spec runs in ANY order (the per-arm-world law's
  // ordering-independence corollary).
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
  const su: Client = await superuserClient();
  // THE TRADE ENTITLEMENT (the shared gate's own plane — the bonded gate
  // and the customs landed-cost floor are silent without it): ensured
  // idempotently here for the ordering-independence law.
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES ($1, $2, 'trade', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [generateUuidV7(), TENANT_TRADE],
  );
  // The customer for the delivery arms (this spec's own natural key —
  // the GLD-* family, never another spec's TR-CUST).
  const customer = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'CUSTOMER', 'TR-GLD-CUST', 'Golden Customer', 'العميل الذهبي')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  await su.end();
  world.customerId = customer.rows[0]!.id;
});

/** A fresh item per arm (the per-arm-world law — «أذرع الرفض كلٌّ على
 * عالمه»: the GLD-* SKU family, unique by construction). */
async function freshGoldenItem(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method, base_price)
     VALUES (gen_random_uuid(), $1, $2, $3, 'صنف القيد الذهبي', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE, `TR-GLD-${code}-${generateUuidV7().slice(0, 8)}`, `Golden Item ${code}`],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** The journal lines a source-keyed entry posted (direction + account
 * code + amount + base amount + currency, ordered by line_no) — the
 * golden read's own shape. */
async function journalLines(docType: string, docId: string, operation?: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
    baseAmount: string;
    currency: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.amount::text AS amount, jl.base_amount::text AS "baseAmount",
           je.currency_code AS currency
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
      AND (${operation ?? null}::text IS NULL OR je.operation = ${operation ?? null})
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

/** The treasury movements of a source (the INV-019-exactness read). */
async function movementsOf(sourceType: string, sourceId: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    amount: string;
    currencyCode: string;
    baseAmount: string;
  }>(sql`
    SELECT direction, amount::text AS amount, currency_code AS "currencyCode",
           base_amount::text AS "baseAmount"
    FROM cash_movements WHERE source_type = ${sourceType} AND source_id = ${sourceId}
    ORDER BY id
  `);
  return rows.rows;
}

/** Count a source key's entries (the INV-013 idempotency proof). */
async function entryCount(docType: string, docId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId}
  `);
  return rows.rows[0]!.n;
}

/** The flip-and-restore idiom's FLIP: supersede an active purpose
 * mapping (the tenant's own runtime surface — never a raw table poke),
 * so the next engine act fails closed. */
async function supersedePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  expect(active).toBeDefined();
  await accounting.supersedePurpose(active!.id, active!.activeFrom);
}

/** The flip-and-restore idiom's RESTORE: re-map the purpose key to the
 * seeded CoA's own account (the tenant's own runtime repair path). */
async function restorePurposeKey(purposeKey: string, code: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  if ((await tenancy.findActivePurpose(purposeKey)) === undefined) {
    const account = await tenancy.findAccountByCode(code);
    expect(account).toBeDefined();
    await tenancy.insertAccountPurpose({
      purposeKey,
      accountId: account!.id,
      activeFrom: "2026-11-26",
    });
  }
}

/** A posted GRN over the given items (the allocation substrate — the
 * REAL PO/GRN services, the same shape the purchasing suite rides),
 * landing in the FREE warehouse. */
async function postedGrn(
  items: readonly { itemId: string; qty: string; unitPrice: string }[],
): Promise<{ grnId: string; lines: { grnLineId: string; itemId: string }[] }> {
  const order = await withTenant(TENANT_TRADE, () =>
    purchaseOrders.create({
      branchId: world.branchId,
      supplierId: world.supplierId,
      orderDate: "2026-11-26",
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
  await withTenant(TENANT_TRADE, () => purchaseOrders.issue(order.id, TR_ACTOR));
  const orderLines = await withTenant(TENANT_TRADE, () => pStore.listPurchaseOrderLines(order.id));
  const grn = await withTenant(TENANT_TRADE, () =>
    goodsReceipts.create({
      branchId: world.branchId,
      supplierId: world.supplierId,
      poId: order.id,
      warehouseId: world.freeWhId,
      receiptDate: "2026-11-26",
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
  await withTenant(TENANT_TRADE, () => goodsReceipts.post(grn.id, TR_ACTOR));
  const lines = await withTenant(TENANT_TRADE, () => pStore.listGoodsReceiptLines(grn.id));
  return {
    grnId: grn.id,
    lines: lines
      .filter((line) => line.accountId === null)
      .map((line) => ({ grnLineId: line.id, itemId: line.itemId })),
  };
}

/** A declaration driven to the wanted rung (its OWN world — a fresh
 * declaration + lines per arm, one line per item so the tie resolves). */
async function declarationAt(
  rung: "DRAFT" | "SUBMITTED" | "ACCEPTED",
  input: {
    grnId?: string | null;
    lines: readonly {
      itemId?: string | null;
      quantity?: string | null;
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
      currency: "SAR",
      receiptId: input.grnId ?? null,
      purchaseOrderId: null,
      billOfLadingId: null,
      lines: input.lines.map((line) => ({
        hsCode: "8471",
        originCountry: "CN",
        itemId: line.itemId ?? null,
        description: null,
        quantity: line.quantity ?? "0",
        uom: "PCS",
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
async function landedCostsOf(declarationId: string): Promise<{ id: string; status: string }[]> {
  const rows = await requireTenantContext().tx!.execute<{ id: string; status: string }>(sql`
    SELECT id, status FROM landed_costs WHERE declaration_id = ${declarationId}`);
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

/** The register's raw declaration row (the linkage pair's own read). */
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

/** The register's raw bonded-move row (the recognition pair's read). */
async function rawBondedMove(id: string): Promise<{
  status: string;
  dutyAmount: string | null;
  releaseRecognizedAt: string | null;
  releaseJournalEntryId: string | null;
}> {
  const rows = await requireTenantContext().tx!.execute<{
    status: string;
    dutyAmount: string | null;
    releaseRecognizedAt: string | null;
    releaseJournalEntryId: string | null;
  }>(sql`
    SELECT status, duty_amount::text AS "dutyAmount",
           release_recognized_at::text AS "releaseRecognizedAt",
           release_journal_entry_id::text AS "releaseJournalEntryId"
    FROM bonded_warehouse_moves WHERE id = ${id}`);
  return rows.rows[0]!;
}

/** The stock position read (qty + WAC — the revaluation's own proof). */
async function positionOf(
  itemId: string,
  warehouseId: string,
): Promise<{ qty: string; avgCost: string | null }> {
  const rows = await requireTenantContext().tx!.execute<{ qty: string; avgCost: string | null }>(sql`
    SELECT qty::text AS qty, avg_cost::text AS "avgCost" FROM item_stock
    WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId}`);
  return rows.rows[0] ?? { qty: "0", avgCost: null };
}

/** A suspended world per arm: its own deposit (from NULL — the
 * custodial entry) landing `qty` units of `itemId` at the bonded
 * warehouse at the declared unit cost. */
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
    bonded.execute({ id: created.id, entryDate: "2026-11-26", actorId: TR_ACTOR }),
  );
  return executed.move;
}

describe("PHASE-051 W-41 — T-16: G-64 (the LC margin deposit/retirement — the golden transcript with its mandatory failure pack)", () => {
  it("G-64 THE GOLDEN TRANSCRIPT — the issue's margin deposit (DR the purpose-mapped 1180 · CR the bank) + the retirement's REVERSED pair (DR the bank · CR 1180) + the settled pair stamped TOGETHER: the journal EXACT at the line level, the INV-013 single-use keys, the INV-019-exact movements", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      lcs.create({
        currency: "SAR",
        amount: "50000.0000",
        marginAmount: "10000.0000",
        issuingBank: "G-64 Golden Bank",
        beneficiaryName: "Overseas Seller SARL",
        applicantName: "TR Trading Co",
        expiryDate: "2027-06-30",
        actorId: TR_ACTOR,
      }),
    );
    expect(created.status).toBe("DRAFT");
    expect(created.lcNo).toMatch(/^LC-2026-\d{6}$/);
    // No posting occurs before the act (the row stands, the journal
    // does not).
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", created.id))).toBe(0);

    // ── THE ISSUE (the G-64 margin deposit) ───────────────────────────
    const issued = await withTenant(TENANT_TRADE, () =>
      lcs.issue(created.id, {
        bankAccountId: world.sarBankId!,
        entryDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
    expect(issued.lc.status).toBe("ISSUED");
    expect(issued.journalEntryId).not.toBeNull();
    expect(issued.lc.marginJournalEntryId).toBe(issued.journalEntryId);

    // THE TRANSCRIPT — the issue's journal lines EXACT (DR the
    // purpose-mapped LC_MARGIN_DEPOSIT 1180 · CR the tenant's chosen
    // SAR bank 1121; 10000.0000 at 4dp, base-currency SAR), balanced to
    // the cent.
    const issueLines = await withTenant(TENANT_TRADE, () =>
      journalLines("letters_of_credit", created.id, "issue"),
    );
    expect(issueLines).toEqual([
      {
        direction: "DEBIT",
        code: world.marginAccountCode,
        amount: "10000.0000",
        baseAmount: "10000.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.sarBankCode,
        amount: "10000.0000",
        baseAmount: "10000.0000",
        currency: "SAR",
      },
    ]);
    const debits = issueLines.filter((line) => line.direction === "DEBIT");
    const credits = issueLines.filter((line) => line.direction === "CREDIT");
    expect(
      new Decimal(debits[0]!.baseAmount).equals(new Decimal(credits[0]!.baseAmount)),
    ).toBe(true);

    // THE INV-013 SINGLE-USE KEY — exactly one entry for (lc, issue).
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", created.id))).toBe(1);

    // THE INV-019-EXACT TREASURY WITNESS — the margin blocked at the
    // bank (OUT, the movement's base equals the journal line's base).
    const issueMovements = await withTenant(TENANT_TRADE, () =>
      movementsOf("letters_of_credit", created.id),
    );
    expect(issueMovements).toEqual([
      {
        direction: "OUT",
        amount: "10000.0000",
        currencyCode: "SAR",
        baseAmount: "10000.0000",
      },
    ]);

    // ── THE RETIREMENT (the G-64 reversal + the settled pair) ─────────
    const retired = await withTenant(TENANT_TRADE, () =>
      lcs.retire(created.id, {
        bankAccountId: world.sarBankId!,
        entryDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
    expect(retired.lc.status).toBe("RETIRED");
    expect(retired.lc.settledAt).not.toBeNull();
    expect(retired.lc.retirementJournalEntryId).toBe(retired.journalEntryId);

    // THE TRANSCRIPT — the retirement's REVERSED pair EXACT (DR the
    // bank · CR LC_MARGIN_DEPOSIT — D-05's "reverses it"), balanced.
    const retirementLines = await withTenant(TENANT_TRADE, () =>
      journalLines("letters_of_credit", created.id, "retirement"),
    );
    expect(retirementLines).toEqual([
      {
        direction: "DEBIT",
        code: world.sarBankCode,
        amount: "10000.0000",
        baseAmount: "10000.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.marginAccountCode,
        amount: "10000.0000",
        baseAmount: "10000.0000",
        currency: "SAR",
      },
    ]);

    // THE INV-013 SINGLE-USE KEY — the retirement is its OWN key (two
    // entries total: (lc, issue) + (lc, retirement), never one reused).
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", created.id))).toBe(2);

    // THE INV-019-EXACT WITNESS — the margin released back to the bank.
    const movements = await withTenant(TENANT_TRADE, () =>
      movementsOf("letters_of_credit", created.id),
    );
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({ direction: "OUT", amount: "10000.0000" });
    expect(movements[1]).toMatchObject({ direction: "IN", amount: "10000.0000", baseAmount: "10000.0000" });

    // THE LEDGER ARITHMETIC — the margin asset's net over the whole
    // lifecycle is ZERO (deposited 10000 − released 10000): the
    // deposit's only exit is the retirement pair.
    const marginNet = await withTenant(TENANT_TRADE, async () => {
      const rows = await requireTenantContext().tx!.execute<{ n: string }>(sql`
        SELECT COALESCE(SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.base_amount
                                  ELSE -jl.base_amount END), 0)::text AS n
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.tenant_id = ${TENANT_TRADE} AND a.code = ${world.marginAccountCode}
          AND je.source_type = 'letters_of_credit' AND je.source_id = ${created.id}`);
      return rows.rows[0]!.n;
    });
    expect(marginNet).toBe("0.0000");
  });

  it("G-64's FAILURE PACK — the unmapped LC_MARGIN_DEPOSIT purpose: the typed PURPOSE_NOT_MAPPED refusal WITH ITS FULL PAYLOAD, the ZERO RESIDUE (the row stays DRAFT, no journal, no movement, no stamp), then the flip-and-restore (the purpose re-mapped through the tenancy runtime surface) and the SAME act GREEN with the SAME transcript", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      lcs.create({
        currency: "SAR",
        amount: "8000.0000",
        marginAmount: "1600.0000",
        issuingBank: "G-64 Failure Pack Bank",
        beneficiaryName: "Overseas Seller SARL",
        applicantName: "TR Trading Co",
        expiryDate: "2027-06-30",
        actorId: TR_ACTOR,
      }),
    );

    // THE FLIP — supersede the active mapping through the tenant's own
    // runtime surface.
    await withTenant(TENANT_TRADE, () => supersedePurposeKey("LC_MARGIN_DEPOSIT"));
    try {
      const refused = await withTenant(TENANT_TRADE, () =>
        lcs
          .issue(created.id, {
            bankAccountId: world.sarBankId!,
            entryDate: "2026-11-26",
            actorId: TR_ACTOR,
          })
          .catch((error: unknown) => error),
      );
      // (a) THE TYPED REFUSAL WITH ITS FULL PAYLOAD — the engine's own
      // fail-closed law (no fallback account, CHART_OF_ACCOUNTS §2).
      expect(refused).toBeInstanceOf(PostingError);
      expect((refused as PostingError).code).toBe("PURPOSE_NOT_MAPPED");
      expect((refused as PostingError).details).toEqual({
        purposeKey: "LC_MARGIN_DEPOSIT",
      });

      // (b) THE ZERO RESIDUE — together-or-nothing: the register row
      // keeps its DRAFT state with NO margin stamp, zero journal rows,
      // zero treasury movements.
      const su = await superuserClient();
      const row = await su.query<{ status: string; stamp: string | null }>(
        `SELECT status, margin_journal_entry_id::text AS stamp FROM letters_of_credit WHERE id = $1`,
        [created.id],
      );
      await su.end();
      expect(row.rows[0]!.status).toBe("DRAFT");
      expect(row.rows[0]!.stamp).toBeNull();
      expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", created.id))).toBe(0);
      expect(await withTenant(TENANT_TRADE, () => movementsOf("letters_of_credit", created.id))).toEqual([]);
    } finally {
      // THE RESTORE — the tenant's own runtime repair path (the purpose
      // re-mapped to the 0122 §8 marker's own account 1180).
      await withTenant(TENANT_TRADE, () => restorePurposeKey("LC_MARGIN_DEPOSIT", "1180"));
    }

    // (c) THE GREEN RE-RUN — the SAME issue act re-runs cleanly and
    // lands the SAME balanced transcript the golden pins.
    const issued = await withTenant(TENANT_TRADE, () =>
      lcs.issue(created.id, {
        bankAccountId: world.sarBankId!,
        entryDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
    expect(issued.lc.status).toBe("ISSUED");
    expect(issued.journalEntryId).not.toBeNull();
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", created.id))).toBe(1);
    const issueLines = await withTenant(TENANT_TRADE, () =>
      journalLines("letters_of_credit", created.id, "issue"),
    );
    expect(issueLines).toEqual([
      {
        direction: "DEBIT",
        code: world.marginAccountCode,
        amount: "1600.0000",
        baseAmount: "1600.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.sarBankCode,
        amount: "1600.0000",
        baseAmount: "1600.0000",
        currency: "SAR",
      },
    ]);
    const movements = await withTenant(TENANT_TRADE, () =>
      movementsOf("letters_of_credit", created.id),
    );
    expect(movements).toEqual([
      {
        direction: "OUT",
        amount: "1600.0000",
        currencyCode: "SAR",
        baseAmount: "1600.0000",
      },
    ]);
    // And the retirement closes the loop (the deposit's only exit).
    const retired = await withTenant(TENANT_TRADE, () =>
      lcs.retire(created.id, {
        bankAccountId: world.sarBankId!,
        entryDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
    expect(retired.lc.status).toBe("RETIRED");
    expect(retired.lc.settledAt).not.toBeNull();
    const retirementLines = await withTenant(TENANT_TRADE, () =>
      journalLines("letters_of_credit", created.id, "retirement"),
    );
    expect(retirementLines).toEqual([
      {
        direction: "DEBIT",
        code: world.sarBankCode,
        amount: "1600.0000",
        baseAmount: "1600.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.marginAccountCode,
        amount: "1600.0000",
        baseAmount: "1600.0000",
        currency: "SAR",
      },
    ]);
  });
});

describe("PHASE-051 W-41 — T-16: G-65 (the declaration completion — the golden transcript + the INV-036 completeness failure pack)", () => {
  it("G-65 THE GOLDEN TRANSCRIPT — the fold's duty+VAT totals flow into the landed-cost document of kind customs through the REAL LandedCostService (DR INVENTORY 1140 · CR the purpose-mapped CUSTOMS_DUTY_PAYABLE 2145), the line-level tie, the linkage pair, the exactly-once", async () => {
    const item = await freshGoldenItem("G65");
    // The world: a posted GRN (60 @ 5.000000 = 300) + its declaration
    // (customs value 300 × 5% = duty 15 + import VAT 15 → landed 30).
    const grn = await postedGrn([{ itemId: item, qty: "60", unitPrice: "5.000000" }]);
    const declarationId = await declarationAt("ACCEPTED", {
      grnId: grn.grnId,
      lines: [{ itemId: item, quantity: "60", customsValue: "300", dutyRate: "0.05", importVat: "15" }],
    });

    const completed = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }),
    );
    // THE FOLD'S TOTALS — rendered from the declaration's OWN lines,
    // never a stored parallel figure.
    expect(completed.declaration.status).toBe("COMPLETED");
    expect(completed.totals.totalCustomsValue).toBe("300.0000");
    expect(completed.totals.totalDuty).toBe("15.0000");
    expect(completed.totals.totalImportVat).toBe("15.0000");
    expect(completed.totals.totalLandedAmount).toBe("30.0000");
    expect(completed.landedAmountBase).toBe("30.0000");
    expect(completed.landedCost).not.toBeNull();
    expect(completed.landedCost!.costNo).toMatch(/^LDC-2026-\d{6}$/);
    expect(completed.landedCost!.journalEntryId).not.toBeNull();

    // THE DECLARATION'S OWN LINKAGE PAIR (the 0125 columns, landed with
    // the stamp).
    const raw = await withTenant(TENANT_TRADE, () => rawDeclaration(declarationId));
    expect(raw.landedCostId).toBe(completed.landedCost!.id);
    expect(raw.landedCostNo).toBe(completed.landedCost!.costNo);

    // THE TRANSCRIPT — the REAL LandedCostService's own journal shape
    // (fully on hand → DR INVENTORY 1140 · CR the purpose-mapped
    // CUSTOMS_DUTY_PAYABLE 2145 — rendered VERBATIM what the engine
    // posts), balanced to the cent.
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("landed_cost", completed.landedCost!.id),
    );
    expect(lines).toEqual([
      {
        direction: "DEBIT",
        code: "1140",
        amount: "30.0000",
        baseAmount: "30.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.dutyAccountCode,
        amount: "30.0000",
        baseAmount: "30.0000",
        currency: "SAR",
      },
    ]);
    expect(
      new Decimal(lines[0]!.baseAmount).equals(new Decimal(lines[1]!.baseAmount)),
    ).toBe(true);

    // THE LINE-LEVEL TIE (INV-036's own demand) — the allocation row
    // carries its declaration line.
    const allocations = await withTenant(TENANT_TRADE, () =>
      allocationsOf(completed.landedCost!.id),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.grnLineId).toBe(grn.lines[0]!.grnLineId);
    expect(allocations[0]!.allocatedAmount).toBe("30.0000");
    const declarationLineId = await withTenant(TENANT_TRADE, async () => {
      const rows = await requireTenantContext().tx!.execute<{ id: string }>(sql`
        SELECT id FROM customs_declaration_lines
        WHERE declaration_id = ${declarationId} AND item_id = ${item} LIMIT 1`);
      return rows.rows[0]!.id;
    });
    expect(allocations[0]!.declarationLineId).toBe(declarationLineId);

    // THE EXACTLY-ONCE — the 0125 partial unique's caller-side face: a
    // second completion refuses, ONE landed-cost document ever.
    const second = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationId, actorId: TR_ACTOR }).catch((error: unknown) => error),
    );
    expect(second).toBeInstanceOf(DeclarationStateError);
    expect((second as DeclarationStateError).details).toMatchObject({
      declarationId,
      from: "COMPLETED",
      to: "COMPLETED",
    });
    expect(await withTenant(TENANT_TRADE, () => landedCostsOf(declarationId))).toHaveLength(1);
    expect(
      await withTenant(TENANT_TRADE, () => entryCount("landed_cost", completed.landedCost!.id)),
    ).toBe(1);
  });

  it("G-65's INV-036 COMPLETENESS FAILURE PACK — the customs landed-cost allocation REFUSED without a completed declaration (DECLARATION_INCOMPLETE with the declaration's own state, DECLARATION_REQUIRED with no declaration at all), ZERO residue on both, then the flip-and-restore (the declaration completed through the runtime surface) and the SAME post GREEN", async () => {
    const item = await freshGoldenItem("G65F");
    // World A: the incomplete-declaration receipt (ACCEPTED, not
    // COMPLETED) — 40 @ 3.000000, customs value 120 × 5% = 6 + VAT 6.
    const grnA = await postedGrn([{ itemId: item, qty: "40", unitPrice: "3.000000" }]);
    const declarationA = await declarationAt("ACCEPTED", {
      grnId: grnA.grnId,
      lines: [
        { itemId: item, quantity: "40", customsValue: "120", dutyRate: "0.05", importVat: "6" },
      ],
    });
    // The purpose-mapped customs account (the arms' charge account).
    const chargeAccount = await withTenant(TENANT_TRADE, async () => {
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const mapping = await tenancy.findActivePurpose("CUSTOMS_DUTY_PAYABLE");
      expect(mapping).toBeDefined();
      return mapping!.accountId;
    });
    const costA = await withTenant(TENANT_TRADE, () =>
      landedCosts.create({
        grnId: grnA.grnId,
        costType: "customs",
        vendorId: null,
        amount: "12.0000",
        allocationMethod: "VALUE",
        chargeAccountId: chargeAccount,
        note: "the G-65 failure pack's customs cost",
        actorId: TR_ACTOR,
      }),
    );
    // THE REFUSAL — the typed DECLARATION_INCOMPLETE naming the receipt
    // + the declaration's OWN state, WITH ITS FULL PAYLOAD.
    const refusalA = await withTenant(TENANT_TRADE, () =>
      landedCosts.post(costA.id, TR_ACTOR).catch((error: unknown) => error),
    );
    expect(refusalA).toBeInstanceOf(DeclarationIncompleteError);
    expect((refusalA as DeclarationIncompleteError).code).toBe("DECLARATION_INCOMPLETE");
    // THE FULL PAYLOAD — the receipt + the declaration's OWN state.
    expect((refusalA as DeclarationIncompleteError).details).toMatchObject({
      grnId: grnA.grnId,
      declarationId: declarationA,
      status: "ACCEPTED",
    });
    expect(String((refusalA as DeclarationIncompleteError).details?.declarationNo)).toMatch(
      /^CUS-2026-\d{6}$/,
    );
    // THE ZERO RESIDUE — the refused draft stays a draft: no journal,
    // no allocations.
    const draftA = await withTenant(TENANT_TRADE, () => pStore.findLandedCostById(costA.id));
    expect(draftA!.status).toBe("DRAFT");
    expect(draftA!.postedJournalId).toBeNull();
    expect(await withTenant(TENANT_TRADE, () => entryCount("landed_cost", costA.id))).toBe(0);
    expect(await withTenant(TENANT_TRADE, () => allocationsOf(costA.id))).toHaveLength(0);

    // World B: the no-declaration receipt — DECLARATION_REQUIRED.
    const itemB = await freshGoldenItem("G65R");
    const grnB = await postedGrn([{ itemId: itemB, qty: "30", unitPrice: "5.000000" }]);
    const costB = await withTenant(TENANT_TRADE, () =>
      landedCosts.create({
        grnId: grnB.grnId,
        costType: "customs",
        vendorId: null,
        amount: "20.0000",
        allocationMethod: "VALUE",
        chargeAccountId: chargeAccount,
        note: null,
        actorId: TR_ACTOR,
      }),
    );
    const refusalB = await withTenant(TENANT_TRADE, () =>
      landedCosts.post(costB.id, TR_ACTOR).catch((error: unknown) => error),
    );
    expect(refusalB).toBeInstanceOf(DeclarationRequiredError);
    expect((refusalB as DeclarationRequiredError).code).toBe("DECLARATION_REQUIRED");
    expect((refusalB as DeclarationRequiredError).details).toEqual({
      grnId: grnB.grnId,
      costType: "customs",
    });
    expect(await withTenant(TENANT_TRADE, () => entryCount("landed_cost", costB.id))).toBe(0);

    // THE FLIP-AND-RESTORE — the repair runs through the RUNTIME
    // surface (the customs engine's own completion act), then the very
    // SAME refused post re-runs GREEN: the floor resolves the receipt's
    // now-COMPLETED declaration, the tie map rides the allocation.
    const completed = await withTenant(TENANT_TRADE, () =>
      customs.complete({ id: declarationA, actorId: TR_ACTOR }),
    );
    expect(completed.declaration.status).toBe("COMPLETED");
    expect(completed.landedCost).not.toBeNull();
    const posted = await withTenant(TENANT_TRADE, () => landedCosts.post(costA.id, TR_ACTOR));
    expect(posted.cost.status).toBe("POSTED");
    expect(posted.costNo).toMatch(/^LDC-2026-\d{6}$/);
    expect(await withTenant(TENANT_TRADE, () => entryCount("landed_cost", costA.id))).toBe(1);
    const lines = await withTenant(TENANT_TRADE, () => journalLines("landed_cost", costA.id));
    expect(lines).toEqual([
      {
        direction: "DEBIT",
        code: "1140",
        amount: "12.0000",
        baseAmount: "12.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.dutyAccountCode,
        amount: "12.0000",
        baseAmount: "12.0000",
        currency: "SAR",
      },
    ]);
    const allocations = await withTenant(TENANT_TRADE, () => allocationsOf(costA.id));
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.declarationLineId).not.toBeNull();
    // World B's draft STILL stands (the refusal never rewrote it).
    const draftB = await withTenant(TENANT_TRADE, () => pStore.findLandedCostById(costB.id));
    expect(draftB!.status).toBe("DRAFT");
  });
});

describe("PHASE-051 W-41 — T-16: G-66/BR-107 (the bonded release's duty recognition — the golden transcript with its mandatory failure pack)", () => {
  it("G-66 THE GOLDEN TRANSCRIPT — the release recognizes the duty EXACTLY ONCE: the recognition pair (DR the released stock's value 1140 · CR the purpose-mapped CUSTOMS_DUTY_PAYABLE 2145), the revaluation uplift through the REAL service, the ATOMIC recognition pair, and the single-use stamp (the replay refused with ZERO residue)", async () => {
    const item = await freshGoldenItem("G66");
    // The world: a deposit (100 @ 2) + an ACCEPTED declaration (qty 100,
    // customs value 200 × 5% = duty 10.0000).
    await suspendedWorld({ itemId: item, qty: "100", unitCost: "2.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [
        { itemId: item, quantity: "100", customsValue: "200", dutyRate: "0.05", importVat: "0" },
      ],
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
      bonded.execute({ id: created.id, entryDate: "2026-11-26", actorId: TR_ACTOR }),
    );
    // THE ATOMIC RECOGNITION PAIR (the register's own row).
    const raw = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(raw.status).toBe("EXECUTED");
    expect(raw.dutyAmount).toBe("10.0000");
    expect(raw.releaseRecognizedAt).not.toBeNull();
    expect(raw.releaseJournalEntryId).not.toBeNull();
    expect(executed.dutyBase).toBe("10.0000");
    expect(executed.journalEntryId).toBe(raw.releaseJournalEntryId);

    // THE TRANSCRIPT — the recognition pair EXACT (DR the released
    // stock's value 1140 · CR the purpose-mapped 2145), balanced.
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("bonded_warehouse_move", created.id),
    );
    expect(lines).toEqual([
      {
        direction: "DEBIT",
        code: "1140",
        amount: "10.0000",
        baseAmount: "10.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.dutyAccountCode,
        amount: "10.0000",
        baseAmount: "10.0000",
        currency: "SAR",
      },
    ]);
    expect(
      new Decimal(lines[0]!.baseAmount).equals(new Decimal(lines[1]!.baseAmount)),
    ).toBe(true);

    // THE REVALUATION UPLIFT — the REAL service's own math (2 + 10/100).
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
    await su.end();

    // THE SINGLE-USE STAMP (BR-107's exactly-once) — the replay refused
    // with the typed reason naming the move, ZERO residue (the row and
    // its journal stand).
    const replay = await withTenant(TENANT_TRADE, () =>
      bonded
        .execute({ id: created.id, entryDate: "2026-11-26", actorId: TR_ACTOR })
        .catch((error: unknown) => error),
    );
    expect(replay).toBeInstanceOf(BondedMoveStateError);
    expect((replay as BondedMoveStateError).details).toMatchObject({
      moveId: created.id,
      moveNo: executed.move.moveNo,
      from: "EXECUTED",
      to: "EXECUTED",
    });
    expect(await withTenant(TENANT_TRADE, () => entryCount("bonded_warehouse_move", created.id))).toBe(1);
    const rawAfter = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(rawAfter.dutyAmount).toBe("10.0000");
    expect(rawAfter.releaseJournalEntryId).toBe(raw.releaseJournalEntryId);

    // THE FLIP-AND-RESTORE AT THE GATE — the pool released, the gate
    // fell silent (the manual issue passes; the WAC now carries the
    // duty).
    expect(await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId))).toBe(
      "0.000000",
    );
    await withTenant(TENANT_TRADE, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: world.bondedWhId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
  });

  it("G-66's ZERO-DUTY RELEASE — the declared interpretation #6: an all-EXW/free declaration's release executes with the EMPTY recognition pair (no journal, no revaluation, the WAC never moves), the pool still releases, and the gate falls silent", async () => {
    const item = await freshGoldenItem("G66Z");
    await suspendedWorld({ itemId: item, qty: "50", unitCost: "3.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [
        { itemId: item, quantity: "50", customsValue: "150", dutyRate: "0", importVat: "0" },
      ],
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
      bonded.execute({ id: created.id, entryDate: "2026-11-26", actorId: TR_ACTOR }),
    );
    expect(executed.move.status).toBe("EXECUTED");
    expect(executed.dutyBase).toBeNull();
    // THE EMPTY PAIR — «the duties that exist flow; the duties that do
    // not, do not».
    const raw = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(raw.dutyAmount).toBeNull();
    expect(raw.releaseRecognizedAt).toBeNull();
    expect(raw.releaseJournalEntryId).toBeNull();
    expect(await withTenant(TENANT_TRADE, () => entryCount("bonded_warehouse_move", created.id))).toBe(0);
    const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
    expect(position.avgCost).toBe("3.000000");
    // The pool released — the flip-and-restore at the gate.
    expect(await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId))).toBe(
      "0.000000",
    );
    await withTenant(TENANT_TRADE, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: world.bondedWhId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
  });

  it("G-66's FAILURE PACK — the unmapped CUSTOMS_DUTY_PAYABLE purpose: the typed refusal BEFORE the stamp, the ZERO RESIDUE (the move stays DRAFT, zero journals, the stock and the pool untouched), then the flip-and-restore and the SAME execute GREEN with the SAME recognition pair", async () => {
    const item = await freshGoldenItem("G66P");
    await suspendedWorld({ itemId: item, qty: "80", unitCost: "3.000000" });
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [
        { itemId: item, quantity: "80", customsValue: "240", dutyRate: "0.05", importVat: "0" },
      ],
    });
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

    // THE FLIP — the purpose superseded through the tenant's own
    // runtime surface.
    await withTenant(TENANT_TRADE, () => supersedePurposeKey("CUSTOMS_DUTY_PAYABLE"));
    try {
      const refused = await withTenant(TENANT_TRADE, () =>
        bonded
          .execute({ id: created.id, entryDate: "2026-11-26", actorId: TR_ACTOR })
          .catch((error: unknown) => error),
      );
      // (a) THE TYPED REFUSAL WITH ITS FULL PAYLOAD — the fail-closed
      // check precedes the execution stamp (BR-107's own law).
      expect(refused).toBeInstanceOf(BondedReleaseShapeError);
      expect((refused as BondedReleaseShapeError).code).toBe("BONDED_RELEASE_SHAPE");
      expect((refused as BondedReleaseShapeError).details).toMatchObject({
        moveNo: created.moveNo,
      });
      expect(String((refused as BondedReleaseShapeError).details?.reason)).toContain(
        "CUSTOMS_DUTY_PAYABLE is not mapped",
      );
      // (b) THE ZERO RESIDUE — the move stays DRAFT, zero journals, the
      // stock never moved, the pool still holds.
      const raw = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
      expect(raw.status).toBe("DRAFT");
      expect(raw.dutyAmount).toBeNull();
      expect(await withTenant(TENANT_TRADE, () => entryCount("bonded_warehouse_move", created.id))).toBe(0);
      const position = await withTenant(TENANT_TRADE, () => positionOf(item, world.bondedWhId));
      expect(position.qty).toBe("80.000000");
      expect(position.avgCost).toBe("3.000000");
      expect(await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId))).toBe(
        "80.000000",
      );
    } finally {
      // THE RESTORE — the tenant's own runtime repair path (the purpose
      // re-mapped to the 0122 §8 marker's own account 2145).
      await withTenant(TENANT_TRADE, () => restorePurposeKey("CUSTOMS_DUTY_PAYABLE", "2145"));
    }

    // (c) THE GREEN RE-RUN — the SAME execute act lands the SAME
    // recognition pair the golden pins (240 × 5% = 12.0000).
    const executed = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: created.id, entryDate: "2026-11-26", actorId: TR_ACTOR }),
    );
    expect(executed.move.status).toBe("EXECUTED");
    expect(executed.dutyBase).toBe("12.0000");
    const raw = await withTenant(TENANT_TRADE, () => rawBondedMove(created.id));
    expect(raw.dutyAmount).toBe("12.0000");
    expect(raw.releaseJournalEntryId).not.toBeNull();
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("bonded_warehouse_move", created.id),
    );
    expect(lines).toEqual([
      {
        direction: "DEBIT",
        code: "1140",
        amount: "12.0000",
        baseAmount: "12.0000",
        currency: "SAR",
      },
      {
        direction: "CREDIT",
        code: world.dutyAccountCode,
        amount: "12.0000",
        baseAmount: "12.0000",
        currency: "SAR",
      },
    ]);
  });
});

describe("PHASE-051 W-41 — T-16: THE BONDED BLOCKING-MATRIX GOLDEN + THE OFFLINE-REJECTION SHAPE (D-20)", () => {
  it("THE BONDED BLOCKING-MATRIX GOLDEN — the suspended stock refused on EVERY baseline path IN ONE ARM (the raw plan, the manual issue, the sales-delivery post, the transfer dispatch), every payload pinned, ZERO residue per path, then the release + the GREEN re-run of the very issue that was refused", async () => {
    const item = await freshGoldenItem("GLDMTX");
    const move = await suspendedWorld({ itemId: item, qty: "50", unitCost: "2.000000" });
    expect(move.status).toBe("EXECUTED");

    // THE FIRST PATH — the raw choke point itself (planIssue on the
    // suspended position, the typed refusal WITH ITS FULL PAYLOAD —
    // naming the stock + the bond + BOTH figures).
    const rawRefusal = await withTenant(TENANT_TRADE, () =>
      planIssue({
        itemId: item,
        warehouseId: world.bondedWhId,
        qty: "5",
        movedAt: "2026-11-26",
        moveKind: "issue",
        sourceType: "manual_issue",
        sourceId: item,
      }).catch((error: unknown) => error),
    );
    expect((rawRefusal as { code?: string }).code).toBe("BONDED_STOCK_SUSPENDED");
    expect((rawRefusal as { details?: unknown }).details).toEqual({
      itemId: item,
      warehouseId: world.bondedWhId,
      suspendedQty: "50.000000",
      onHand: "50.000000",
    });

    // THE SECOND PATH — the manual issue (the inventory engine's own
    // baseline): the SAME typed refusal, payload for payload.
    const manualRefusal = await withTenant(TENANT_TRADE, () =>
      stock
        .manualIssue({
          itemId: item,
          warehouseId: world.bondedWhId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-26",
          actorId: TR_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect((manualRefusal as { code?: string }).code).toBe("BONDED_STOCK_SUSPENDED");
    expect((manualRefusal as { details?: unknown }).details).toEqual(
      (rawRefusal as { details?: unknown }).details,
    );

    // THE THIRD PATH — the sales delivery post (the baseline ship path).
    const note = await withTenant(TENANT_TRADE, () =>
      deliveries.create({
        branchId: world.branchId,
        customerId: world.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: world.bondedWhId,
        deliveryDate: "2026-11-26",
        currencyCode: "SAR",
        note: "the matrix's blocked delivery",
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
    const deliveryRefusal = await withTenant(TENANT_TRADE, () =>
      deliveries.post(note.id, TR_ACTOR).catch((error: unknown) => error),
    );
    expect((deliveryRefusal as { code?: string }).code).toBe("BONDED_STOCK_SUSPENDED");
    expect((deliveryRefusal as { details?: unknown }).details).toEqual(
      (rawRefusal as { details?: unknown }).details,
    );

    // THE FOURTH PATH — the transfer dispatch (the baseline transfer
    // path out of the bond).
    const transfer = await withTenant(TENANT_TRADE, () =>
      transfers.create({
        fromWarehouseId: world.bondedWhId,
        toWarehouseId: world.freeWhId,
        note: "the matrix's blocked transfer",
        noteAr: null,
        actorId: TR_ACTOR,
        lines: [{ itemId: item, qty: "5" }],
      }),
    );
    const transferRefusal = await withTenant(TENANT_TRADE, () =>
      transfers.dispatch(transfer.id, TR_ACTOR).catch((error: unknown) => error),
    );
    expect((transferRefusal as { code?: string }).code).toBe("BONDED_STOCK_SUSPENDED");
    expect((transferRefusal as { details?: unknown }).details).toEqual(
      (rawRefusal as { details?: unknown }).details,
    );

    // THE ZERO RESIDUE PER PATH — the delivery stays DRAFT with no moves
    // of its own, the transfer stays DRAFT, the item's ledger carries
    // exactly the deposit's receipt move, and NO journal row landed for
    // any of the four refused acts.
    const su = await superuserClient();
    const deliveryState = await su.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = dn.tenant_id AND sm.source_id = dn.id) AS n
       FROM delivery_notes dn WHERE dn.id = $1`,
      [note.id],
    );
    expect(deliveryState.rows[0]!.status).toBe("DRAFT");
    expect(deliveryState.rows[0]!.n).toBe(0);
    const transferState = await su.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = st.tenant_id AND sm.source_id = st.id) AS n
       FROM stock_transfers st WHERE st.id = $1`,
      [transfer.id],
    );
    expect(transferState.rows[0]!.status).toBe("DRAFT");
    expect(transferState.rows[0]!.n).toBe(0);
    const itemMoves = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND item_id = $2`,
      [TENANT_TRADE, item],
    );
    expect(itemMoves.rows[0]!.n).toBe(1);
    const refusedJournals = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries
        WHERE tenant_id = $1 AND source_id IN ($2, $3)`,
      [TENANT_TRADE, note.id, transfer.id],
    );
    expect(refusedJournals.rows[0]!.n).toBe(0);
    await su.end();

    // THE FLIP-AND-RESTORE — the release (BR-107's act) drops the pool
    // to zero, then the very manual issue that was refused re-runs
    // GREEN through the REAL engine.
    const declarationId = await declarationAt("ACCEPTED", {
      lines: [
        { itemId: item, quantity: "50", customsValue: "100", dutyRate: "0.05", importVat: "0" },
      ],
    });
    const release = await withTenant(TENANT_TRADE, () =>
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
    const executedRelease = await withTenant(TENANT_TRADE, () =>
      bonded.execute({ id: release.id, entryDate: "2026-11-26", actorId: TR_ACTOR }),
    );
    expect(executedRelease.move.status).toBe("EXECUTED");
    expect(await withTenant(TENANT_TRADE, () => suspendedQtyAt(item, world.bondedWhId))).toBe(
      "0.000000",
    );
    await withTenant(TENANT_TRADE, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: world.bondedWhId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-26",
        actorId: TR_ACTOR,
      }),
    );
    const su2 = await superuserClient();
    const after = await su2.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND item_id = $2`,
      [TENANT_TRADE, item],
    );
    // The ledger after the flip-and-restore: the deposit's receipt +
    // the release's duty uplift (the revaluation's adjust move, its
    // journal linked) + the GREEN issue that was refused.
    expect(after.rows[0]!.n).toBe(3);
    await su2.end();
  });

  it("THE OFFLINE-REJECTION SHAPE (D-20 — OA-02 N/A-RECORDED for trade): the gate is SERVER-SIDE in planIssue, so the sync-reconciliation-shaped document's POST runs the same plan and sees the SAME typed refusal, payload for payload — ZERO residue (the document stays exactly as the client left it)", async () => {
    // D-20's own ruling (the master plan §1, recorded — never a silent
    // scope cut): trade documentation is web-only; no synced entity was
    // added. The bonded gate is SERVER-SIDE, so an offline document
    // issuing suspended stock is rejected at sync reconciliation when
    // its POST runs the same plan — the payload-for-payload law, the
    // 050 D-20 pattern. This spec's world has no offline client
    // surface, so the arm proves the SERVER-SIDE-ONLY law directly: the
    // delivery draft (the offline client's own state — DRAFT is what a
    // disconnected device captures) sees the SAME refusal as the online
    // manual issue, with the details EQUAL payload for payload.
    const item = await freshGoldenItem("GLDOFF");
    await suspendedWorld({ itemId: item, qty: "40", unitCost: "2.000000" });

    // THE ONLINE PATH's refusal (the manual issue — the gate's own
    // baseline shape), captured first.
    const onlineRefusal = await withTenant(TENANT_TRADE, () =>
      stock
        .manualIssue({
          itemId: item,
          warehouseId: world.bondedWhId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-26",
          actorId: TR_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect((onlineRefusal as { code?: string }).code).toBe("BONDED_STOCK_SUSPENDED");

    // THE SYNC-RECONCILIATION-SHAPED DOCUMENT — a delivery captured on
    // the device while disconnected (DRAFT is the offline client's own
    // state), carrying the suspended item; its POST at sync
    // reconciliation runs the SAME server-side planIssue.
    const offlineNote = await withTenant(TENANT_TRADE, () =>
      deliveries.create({
        branchId: world.branchId,
        customerId: world.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: world.bondedWhId,
        deliveryDate: "2026-11-26",
        currencyCode: "SAR",
        note: "the offline-captured delivery (reconciled at sync)",
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
    const offlineRefusal = await withTenant(TENANT_TRADE, () =>
      deliveries.post(offlineNote.id, TR_ACTOR).catch((error: unknown) => error),
    );

    // THE SHAPE EQUALITY — the same typed refusal, payload for payload:
    // the offline leg's POST is the same plan.
    expect((offlineRefusal as { code?: string }).code).toBe("BONDED_STOCK_SUSPENDED");
    expect((offlineRefusal as { code?: string }).code).toBe((onlineRefusal as { code?: string }).code);
    expect((offlineRefusal as { details?: Record<string, unknown> }).details).toEqual(
      (onlineRefusal as { details?: Record<string, unknown> }).details,
    );
    expect((offlineRefusal as { details?: Record<string, unknown> }).details).toEqual({
      itemId: item,
      warehouseId: world.bondedWhId,
      suspendedQty: "40.000000",
      onHand: "40.000000",
    });

    // ZERO RESIDUE — the offline document stays exactly as the client
    // left it (DRAFT, no moves, no journal): the reconciliation refused
    // the POST, never rewrote the document.
    const su = await superuserClient();
    const state = await su.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = dn.tenant_id AND sm.source_id = dn.id) AS n
       FROM delivery_notes dn WHERE dn.id = $1`,
      [offlineNote.id],
    );
    expect(state.rows[0]!.status).toBe("DRAFT");
    expect(state.rows[0]!.n).toBe(0);
    const itemMoves = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND item_id = $2`,
      [TENANT_TRADE, item],
    );
    expect(itemMoves.rows[0]!.n).toBe(1);
    await su.end();
  });
});
