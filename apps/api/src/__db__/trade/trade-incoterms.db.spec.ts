import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { generateUuidV7 } from "@erp/domain-core";
import {
  setupTradeFixture,
  TENANT_TRADE,
  TENANT_TRADE_RLS,
  TR_ACTOR,
} from "./fixtures";
import { IncotermsService } from "../../modules/trade/application/incoterms-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  materializeCanonicalHsStarterSet,
  materializeCanonicalIncoterms,
} from "../../modules/trade/infrastructure/trade-canonical";
import {
  IncotermCodeFrozenError,
  IncotermDuplicateError,
  IncotermInactiveError,
  IncotermInvalidError,
  IncotermRecordNotFoundError,
  OrderIncotermRequiredError,
} from "../../modules/trade/domain/trade-errors";
import { superuserClient } from "../test-db";

/**
 * PHASE-051 (W-35 — T-08, 2026-11-25) `trade-incoterms.db.spec` — THE
 * REGISTRY + BR-106'S MANDATE over real PG16 (the plan §4's own arm;
 * the master plan §3 W-35's exit: acceptance #6's registry/selector
 * arms): the canonical seeds materialize through the ONBOARDING path
 * (the new-tenant arm of the one-source law — the 0122 §6 seed's
 * existing-tenant sweep is the other path), the ownership matrix IS
 * the row's own data (the risk-hint lines rendered AR/EN from the
 * booleans — CIF/DDP/EXW's own shapes), the tenant additions + the
 * frozen code + the write floors, the retirement's selection floor
 * (the snapshot semantics: an order created before the retirement
 * keeps its recorded selection), and THE MANDATE ITSELF at BOTH order
 * families' own posting — the owner's ruling (ج) VERBATIM: with the
 * trade flag enabled, an order whose currency differs from the base OR
 * that carries the import/export tag must post WITH an incoterm (the
 * typed refusal naming the order + the missing field, ZERO residue —
 * the number never reserves); the flag OFF = the gate silent (the
 * declared neutral zero's own reading, proven on the boundary tenant).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * rejection arm builds its own order/registry row — a rejection arm
 * never shares mutable rows with another arm. THE DEDICATED SEEDS
 * TENANT TRI (the sweep spec's TENANT_TSW shape): the canonical-seed
 * arms' absolute assertions (every row carries the disclaimer) hold on
 * a tenant NO other spec writes — the shared trade fixture tenant
 * carries the W-33 schema spec's own registry rows, so the seeds arm
 * never asserts there. The mandate arms run in the fixture tenant
 * (the branch/supplier/item world) against THIS spec's own registry
 * rows (TR1 the satisfied selection · XDP the retirement arm) — never
 * the canonical codes, whose presence there is order-dependent.
 */

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const registry = new IncotermsService(audit);

/** The second actor — the SO approve act's SoD floor (creator ≠ approver). */
const TR_ACTOR2 = "7c7c7c7c-0000-4000-8000-0000000007c2";

/** THE DEDICATED SEEDS TENANT (the TENANT_TSW shape — mine alone). */
const TENANT_TRI = "7c6a7c6a-7c6a-7c6a-7c6a-7c6a7c6a7c6b";

const world: {
  branchId?: string;
  supplierId?: string;
  itemId?: string;
  customerId?: string;
  warehouseId?: string;
  rlsBranchId?: string;
  rlsSupplierId?: string;
  rlsItemId?: string;
} = {};

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  world.branchId = fixture.branchId;
  world.supplierId = fixture.supplierId;
  world.itemId = fixture.itemId;
  world.warehouseId = fixture.warehouseAId;

  const su: Client = await superuserClient();
  // THE SEEDS TENANT (mine alone — the canonical materialization's
  // dedicated world), created BEFORE the entitlements insert (the FK's
  // own demand).
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant TRI (incoterms seeds)', 'المستأجر شروط', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TRI],
  );
  // THE TRADE ENTITLEMENT (the mandate's own plane — the whole-module
  // composable unit, 0122 §5c's grant shape): TENANT_TRADE carries it;
  // TENANT_TRADE_RLS (the boundary tenant, empty by construction) does
  // NOT — the flag-off arm's own world. TENANT_TRI (the seeds tenant)
  // carries it too (the materialization's own plane; the entitlement is
  // irrelevant to the seeds, granted for shape parity only).
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES ($1, $2, 'trade', 'PLAN'), ($3, $4, 'trade', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [generateUuidV7(), TENANT_TRADE, generateUuidV7(), TENANT_TRI],
  );
  // The second actor (the SO approval's SoD floor).
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'trade-actor2@fixture.test', 'Trade Actor Two', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TR_ACTOR2],
  );
  // A customer for the sales legs (the fixture's partner plane).
  const customer = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'CUSTOMER', 'TR-CUST', 'Export Customer', 'عميل التصدير')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  world.customerId = customer.rows[0]!.id;

  // THE BOUNDARY TENANT'S OWN MINI WORLD (the flag-off arm): the
  // master-data basics (its own uoms — the item insert's own demand),
  // branch, supplier and item — nothing shared with TENANT_TRADE.
  await withTenant(TENANT_TRADE_RLS, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
  });
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
  await su.end();
  world.rlsBranchId = rlsBranch.rows[0]!.id;
  world.rlsSupplierId = rlsSupplier.rows[0]!.id;
  world.rlsItemId = rlsItem.rows[0]!.id;

  // THE ONBOARDING PATH (the new-tenant arm of the one-source law):
  // the canonical seeds materialize inside the DEDICATED seeds
  // tenant's own scope (never the shared fixture tenant — the
  // per-arm-world law).
  await withTenant(TENANT_TRI, async () => {
    await materializeCanonicalIncoterms();
    await materializeCanonicalHsStarterSet();
  });
  // The mandate arms' own selection (the satisfied-mandate arms' code —
  // THIS spec's own row in the fixture tenant, present in every run
  // order, never the canonical codes whose presence there is
  // order-dependent).
  await withTenant(TENANT_TRADE, () =>
    registry.create({
      code: "TR1",
      name: "Trade Fixture Term",
      nameAr: "شرط التجارة",
      carriageBySeller: true,
      insuranceBySeller: true,
      exportClearanceBySeller: true,
      importClearanceBySeller: false,
      importDutyBySeller: false,
      actorId: TR_ACTOR,
    }),
  );
});

/** The registry rows' raw read (the seeds' own assertions). */
async function incotermRows(tenantId: string): Promise<
  { code: string; name: string; note: string | null; carriage: boolean; insurance: boolean; exportClearance: boolean; importClearance: boolean; importDuty: boolean; isActive: boolean }[]
> {
  const su = await superuserClient();
  const rows = await su.query<{
    code: string; name: string; note: string | null; carriage: boolean; insurance: boolean;
    exportClearance: boolean; importClearance: boolean; importDuty: boolean; isActive: boolean;
  }>(
    `SELECT code, name, note, carriage_by_seller AS carriage, insurance_by_seller AS insurance,
            export_clearance_by_seller AS "exportClearance", import_clearance_by_seller AS "importClearance",
            import_duty_by_seller AS "importDuty", is_active AS "isActive"
     FROM incoterms WHERE tenant_id = $1 ORDER BY code`,
    [tenantId],
  );
  await su.end();
  return rows.rows;
}

async function hsRowCount(tenantId: string): Promise<number> {
  const su = await superuserClient();
  const rows = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM hs_code_registry WHERE tenant_id = $1`,
    [tenantId],
  );
  await su.end();
  return rows.rows[0]!.n;
}

/** A PO created through the REAL service (the mandate's own subject). */
async function createPo(
  input: { currencyCode: string; exchangeRate?: string | null; incotermCode?: string | null; tradeDirection?: "IMPORT" | "EXPORT" | null },
  tenant: "TRADE" | "RLS" = "TRADE",
): Promise<{ id: string; orderNo: string | null; status: string; incotermCode: string | null }> {
  const tenantId = tenant === "TRADE" ? TENANT_TRADE : TENANT_TRADE_RLS;
  return withTenant(tenantId, async () => {
    const { PurchaseOrderService } = await import("../../modules/purchasing/application/orders");
    const purchaseOrders = new PurchaseOrderService(audit, numbering);
    const created = await purchaseOrders.create({
      branchId: tenant === "TRADE" ? world.branchId! : world.rlsBranchId!,
      supplierId: tenant === "TRADE" ? world.supplierId! : world.rlsSupplierId!,
      orderDate: "2026-11-25",
      expectedDate: null,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate ?? null,
      incotermCode: input.incotermCode ?? null,
      tradeDirection: input.tradeDirection ?? null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      lines: [
        {
          itemId: tenant === "TRADE" ? world.itemId! : world.rlsItemId!,
          qty: "2",
          unitPrice: "45.000000",
          taxCodeId: null,
          requestLineId: null,
          note: null,
        },
      ],
    });
    return {
      id: created.id,
      orderNo: created.orderNo,
      status: created.status,
      incotermCode: created.incotermCode,
    };
  });
}

/** The PO issue act (the order's own posting — the mandate's own gate). */
async function issuePo(id: string, tenant: "TRADE" | "RLS" = "TRADE"): Promise<{ orderNo: string | null; status: string }> {
  const tenantId = tenant === "TRADE" ? TENANT_TRADE : TENANT_TRADE_RLS;
  return withTenant(tenantId, async () => {
    const { PurchaseOrderService } = await import("../../modules/purchasing/application/orders");
    const purchaseOrders = new PurchaseOrderService(audit, numbering);
    const issued = await purchaseOrders.issue(id, TR_ACTOR);
    return { orderNo: issued.orderNo, status: issued.status };
  });
}

/** The raw PO row (the zero-residue assertions' own read). */
async function rawPo(id: string): Promise<{ status: string; orderNo: string | null; incotermCode: string | null }> {
  const rows = await requireTenantContext().tx!.execute<{
    status: string; orderNo: string | null; incotermCode: string | null;
  }>(sql`
    SELECT status, order_no AS "orderNo", incoterm_code AS "incotermCode"
    FROM purchase_orders WHERE id = ${id}`);
  return rows.rows[0]!;
}

/** The issuance audits of a PO (the zero-residue assertions' own read). */
async function issuanceAuditsOf(id: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM audit_events
    WHERE entity_type = 'purchase_order' AND entity_id = ${id}
      AND action = 'purchasing.purchase_order_issued'`);
  return rows.rows[0]!.n;
}

/** A SO created through the REAL service (the sales leg's own subject). */
async function createSo(input: { incotermCode: string | null; tradeDirection: "IMPORT" | "EXPORT" | null }) {
  return withTenant(TENANT_TRADE, async () => {
    const { SalesOrderService } = await import("../../modules/sales/application/orders");
    const { AtpService } = await import("../../modules/manufacturing/application/atp-service");
    const salesOrders = new SalesOrderService(audit, numbering, new AtpService());
    return salesOrders.create({
      branchId: world.branchId!,
      customerId: world.customerId!,
      salesRepId: null,
      warehouseId: world.warehouseId!,
      quotationId: null,
      orderDate: "2026-11-25",
      expectedDate: null,
      currencyCode: "USD",
      exchangeRate: "3.75",
      incotermCode: input.incotermCode,
      tradeDirection: input.tradeDirection,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      reserve: false,
      lines: [
        {
          itemId: world.itemId!,
          qty: "1",
          unitPrice: "45.000000",
          discountAmount: null,
          taxCodeId: null,
          description: null,
          descriptionAr: null,
          note: null,
        },
      ],
    });
  });
}

/** The SO journey through the approval hop (the SoD floor) to the issue. */
async function soJourney(id: string): Promise<{ status: string; orderNo: string | null; incotermCode: string | null }> {
  return withTenant(TENANT_TRADE, async () => {
    const { SalesOrderService } = await import("../../modules/sales/application/orders");
    const { AtpService } = await import("../../modules/manufacturing/application/atp-service");
    const salesOrders = new SalesOrderService(audit, numbering, new AtpService());
    await salesOrders.submit(id, TR_ACTOR);
    await salesOrders.approve(id, TR_ACTOR2);
    const issued = await salesOrders.issue(id, TR_ACTOR);
    return { status: issued.status, orderNo: issued.orderNo, incotermCode: issued.incotermCode };
  });
}

describe("PHASE-051 W-35 — THE INCOTERMS REGISTRY (T-08: the one-source seeds, the matrix as the row's own data, the tenant additions, the write floors, the retirement's snapshot semantics)", () => {
  it("THE SEEDS materialize through the ONBOARDING path: the 11 Incoterms-2020 rules with the accuracy disclaimer on every row + the 14 HS chapter headings; the re-run is idempotent (the one-source law, both paths)", async () => {
    const rows = await incotermRows(TENANT_TRI);
    expect(rows.map((row) => row.code)).toEqual([
      "CFR", "CIF", "CIP", "CPT", "DAP", "DDP", "DPU", "EXW", "FAS", "FCA", "FOB",
    ]);
    // THE ACCURACY DISCLAIMER on every starter row (D-16 — «البذور
    // بإقرار الدقة»).
    for (const row of rows) {
      expect(row.note).toContain("STARTER SET (Incoterms 2020)");
      expect(row.note).toContain("مسؤولية المستأجر");
      expect(row.isActive).toBe(true);
    }
    // THE HS STARTER SET: 14 chapter headings, no duty rates anywhere.
    expect(await hsRowCount(TENANT_TRI)).toBe(14);
    // IDEMPOTENT: the re-run materializes nothing new (the ON CONFLICT
    // law — the two paths never conflict, never duplicate).
    await withTenant(TENANT_TRI, async () => {
      expect(await materializeCanonicalIncoterms()).toBe(11);
      expect(await materializeCanonicalHsStarterSet()).toBe(14);
    });
    expect((await incotermRows(TENANT_TRI)).length).toBe(11);
    expect(await hsRowCount(TENANT_TRI)).toBe(14);
  });

  it("THE MATRIX IS THE ROW'S OWN DATA: the service renders five AR/EN risk-hint lines from the booleans — CIF (seller carriage/insurance/export, buyer clearance/duty) · DDP (the seller owns the import side) · EXW (all-buyer)", async () => {
    const cif = await withTenant(TENANT_TRI, () => registry.find("CIF"));
    expect(cif.row.nameAr).toBe("التكلفة والتأمين والنولون");
    expect(cif.matrix.en).toHaveLength(5);
    expect(cif.matrix.ar).toHaveLength(5);
    expect(cif.matrix.en[0]).toContain("SELLER arranges");
    expect(cif.matrix.en[1]).toContain("SELLER procures");
    expect(cif.matrix.en[2]).toContain("SELLER's obligation");
    expect(cif.matrix.en[3]).toContain("BUYER's obligation");
    expect(cif.matrix.en[4]).toContain("BUYER bears");
    expect(cif.matrix.ar[0]).toContain("البائع");
    expect(cif.matrix.ar[4]).toContain("المشتري");

    const ddp = await withTenant(TENANT_TRI, () => registry.find("DDP"));
    expect(ddp.matrix.en[3]).toContain("SELLER's obligation");
    expect(ddp.matrix.en[4]).toContain("SELLER bears");

    const exw = await withTenant(TENANT_TRI, () => registry.find("EXW"));
    expect(exw.matrix.en.every((line) => line.includes("BUYER"))).toBe(true);
  });

  it("THE TENANT ADDITION: a custom code lands active with its own matrix; the duplicate refuses BY NAME with ZERO residue", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      registry.create({
        code: "XDP",
        name: "Custom Delivered Term",
        nameAr: "شرط تسليم خاص",
        carriageBySeller: true,
        insuranceBySeller: false,
        exportClearanceBySeller: true,
        importClearanceBySeller: false,
        importDutyBySeller: false,
        note: "the tenant's own calibrated term",
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    expect(created.row.code).toBe("XDP");
    expect(created.row.isActive).toBe(true);
    expect(created.matrix.en[0]).toContain("SELLER arranges");

    const refusal = (await withTenant(TENANT_TRADE, () =>
      registry.create({
        code: "XDP",
        name: "Another Term",
        nameAr: "شرط آخر",
        carriageBySeller: false,
        insuranceBySeller: false,
        exportClearanceBySeller: false,
        importClearanceBySeller: false,
        importDutyBySeller: false,
        actorId: TR_ACTOR,
      }).catch((error: unknown) => error))) as IncotermDuplicateError;
    expect(refusal).toBeInstanceOf(IncotermDuplicateError);
    expect(refusal.code).toBe("INCOTERM_DUPLICATE");
    expect(refusal.details!.code).toBe("XDP");
    // ZERO RESIDUE: still one XDP row.
    const rows = (await incotermRows(TENANT_TRADE)).filter((row) => row.code === "XDP");
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe("Custom Delivered Term");
  });

  it("THE REGISTRY WRITE FLOORS: the code shape and the bilingual names refuse; the code rewrite refuses (the frozen identity); the empty update refuses with ZERO residue", async () => {
    await expect(
      withTenant(TENANT_TRADE, () =>
        registry.create({
          code: "TOOLONGCODE",
          name: "Too Long",
          nameAr: "طويل",
          carriageBySeller: false,
          insuranceBySeller: false,
          exportClearanceBySeller: false,
          importClearanceBySeller: false,
          importDutyBySeller: false,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(IncotermInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        registry.create({
          code: "OK1",
          name: "x",
          nameAr: "قصير",
          carriageBySeller: false,
          insuranceBySeller: false,
          exportClearanceBySeller: false,
          importClearanceBySeller: false,
          importDutyBySeller: false,
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(IncotermInvalidError);

    // THE FROZEN CODE: the update never rewrites the identity.
    const frozen = (await withTenant(TENANT_TRADE, () =>
      registry.update("XDP", { code: "YDP", name: "Renamed Term", actorId: TR_ACTOR })
        .catch((error: unknown) => error))) as IncotermCodeFrozenError;
    expect(frozen).toBeInstanceOf(IncotermCodeFrozenError);
    expect(frozen.code).toBe("INCOTERM_CODE_FROZEN");
    expect(frozen.details!.code).toBe("XDP");
    expect(frozen.details!.attempted).toBe("YDP");

    // THE EMPTY UPDATE: refused BEFORE the write — the row never moves.
    await expect(
      withTenant(TENANT_TRADE, () => registry.update("XDP", { actorId: TR_ACTOR })),
    ).rejects.toBeInstanceOf(IncotermInvalidError);
    const unchanged = (await incotermRows(TENANT_TRADE)).find((row) => row.code === "XDP");
    expect(unchanged!.name).toBe("Custom Delivered Term");

    // The legitimate update rides: the name + the matrix booleans move.
    const updated = await withTenant(TENANT_TRADE, () =>
      registry.update("XDP", { insuranceBySeller: true, note: "re-calibrated" , actorId: TR_ACTOR }));
    expect(updated.row.insuranceBySeller).toBe(true);
    expect(updated.matrix.en[1]).toContain("SELLER procures");

    // The unknown code is the typed 404 shape.
    const notFound = (await withTenant(TENANT_TRADE, () =>
      registry.find("ZZZ").catch((error: unknown) => error))) as IncotermRecordNotFoundError;
    expect(notFound).toBeInstanceOf(IncotermRecordNotFoundError);
    expect(notFound.code).toBe("INCOTERM_RECORD_NOT_FOUND");
  });

  it("THE RETIREMENT'S SNAPSHOT SEMANTICS: a retired code never rides a NEW order (the typed refusal at create); an order created BEFORE the retirement keeps its recorded selection and posts", async () => {
    // The order created while XDP is still ACTIVE (re-calibrated above).
    const before = await createPo({ currencyCode: "USD", exchangeRate: "3.75", incotermCode: "XDP" });
    expect(before.incotermCode).toBe("XDP");

    // THE RETIREMENT.
    const retired = await withTenant(TENANT_TRADE, () =>
      registry.update("XDP", { isActive: false, actorId: TR_ACTOR }));
    expect(retired.row.isActive).toBe(false);

    // A NEW order with the retired code refuses at create (the
    // selector's own floor — the typed refusal names the code).
    const refusal = (await withTenant(TENANT_TRADE, () =>
      createPo({ currencyCode: "USD", exchangeRate: "3.75", incotermCode: "XDP" })
        .catch((error: unknown) => error))) as IncotermInactiveError;
    expect(refusal).toBeInstanceOf(IncotermInactiveError);
    expect(refusal.code).toBe("INCOTERM_INACTIVE");
    expect(refusal.details!.code).toBe("XDP");

    // THE SNAPSHOT: the order created before the retirement keeps its
    // recorded selection and ISSUES GREEN (the issue gate checks
    // PRESENCE; the registry's activeness is the CREATE gate).
    const issued = await issuePo(before.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.orderNo).toMatch(/^POR-/);

    // Restore XDP for the later arms (the flip-and-restore idiom).
    await withTenant(TENANT_TRADE, () => registry.update("XDP", { isActive: true, actorId: TR_ACTOR }));
  });
});

describe("PHASE-051 W-35 — BR-106'S MANDATE AT THE ORDERS' OWN POSTING (the owner's ruling (ج) VERBATIM: currency ≠ base, or the import/export tag)", () => {
  it("THE CURRENCY ARM: a foreign-currency PO without an incoterm refuses at issue — the typed refusal names the order + the missing field + the trigger arms, ZERO residue (no number, no issuance audit, the row untouched)", async () => {
    const po = await createPo({ currencyCode: "USD", exchangeRate: "3.75" });
    expect(po.incotermCode).toBeNull();

    const refusal = (await withTenant(TENANT_TRADE, () =>
      issuePo(po.id).catch((error: unknown) => error))) as OrderIncotermRequiredError;
    expect(refusal).toBeInstanceOf(OrderIncotermRequiredError);
    expect(refusal.code).toBe("ORDER_INCOTERM_REQUIRED");
    expect(refusal.details!.docType).toBe("purchase_order");
    expect(refusal.details!.orderId).toBe(po.id);
    expect(refusal.details!.currency).toBe("USD");
    expect(refusal.details!.baseCurrency).toBe("SAR");
    const arms = refusal.details!.arms as string[];
    expect(arms).toHaveLength(1);
    expect(arms[0]).toContain("CURRENCY");
    expect(refusal.message).toContain("BR-106");

    // ZERO RESIDUE: the row stays DRAFT, no number, no issuance audit.
    const residue = await withTenant(TENANT_TRADE, async () => {
      const row = await rawPo(po.id);
      const audits = await issuanceAuditsOf(po.id);
      return { row, audits };
    });
    expect(residue.row.status).toBe("DRAFT");
    expect(residue.row.orderNo).toBeNull();
    expect(residue.audits).toBe(0);
  });

  it("THE SATISFIED MANDATE: a foreign-currency PO WITH its incoterm issues GREEN — the number reserves, the register posts", async () => {
    const po = await createPo({ currencyCode: "USD", exchangeRate: "3.75", incotermCode: "TR1" });
    const issued = await issuePo(po.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.orderNo).toMatch(/^POR-\d{4}-\d{6}$/);
  });

  it("THE UNTRIGGERED SHAPE: a base-currency PO without the marker and without an incoterm issues GREEN — the mandate sleeps", async () => {
    const po = await createPo({ currencyCode: "SAR" });
    const issued = await issuePo(po.id);
    expect(issued.status).toBe("ISSUED");
  });

  it("THE MARKER ARM: a base-currency PO carrying the explicit IMPORT tag must post WITH an incoterm — the refusal names the marker arm; with the selection it issues GREEN", async () => {
    const refused = await createPo({ currencyCode: "SAR", tradeDirection: "IMPORT" });
    const refusal = (await withTenant(TENANT_TRADE, () =>
      issuePo(refused.id).catch((error: unknown) => error))) as OrderIncotermRequiredError;
    expect(refusal.code).toBe("ORDER_INCOTERM_REQUIRED");
    const markerArms = refusal.details!.arms as string[];
    expect(markerArms).toHaveLength(1);
    expect(markerArms[0]).toContain("MARKER");
    expect(markerArms[0]).toContain("IMPORT");
    // ZERO RESIDUE: the row stays DRAFT, no number.
    const row = await withTenant(TENANT_TRADE, () => rawPo(refused.id));
    expect(row.status).toBe("DRAFT");
    expect(row.orderNo).toBeNull();

    const satisfied = await createPo({ currencyCode: "SAR", tradeDirection: "EXPORT", incotermCode: "TR1" });
    const issued = await issuePo(satisfied.id);
    expect(issued.status).toBe("ISSUED");
  });

  it("BOTH ARMS TOGETHER: the foreign currency AND the marker — two named arms in the refusal; the field rides the row (the 0124 columns' own read)", async () => {
    const po = await createPo({ currencyCode: "EUR", exchangeRate: "4.10", tradeDirection: "IMPORT" });
    const refusal = (await withTenant(TENANT_TRADE, () =>
      issuePo(po.id).catch((error: unknown) => error))) as OrderIncotermRequiredError;
    const bothArms = refusal.details!.arms as string[];
    expect(bothArms).toHaveLength(2);
    expect(bothArms.join("; ")).toContain("CURRENCY");
    expect(bothArms.join("; ")).toContain("MARKER");
    // The 0124 columns' own read: the row carries its marker.
    const row = await withTenant(TENANT_TRADE, async () => {
      const result = await requireTenantContext().tx!.execute<{
        tradeDirection: string | null; incotermCode: string | null;
      }>(sql`SELECT trade_direction AS "tradeDirection", incoterm_code AS "incotermCode"
             FROM purchase_orders WHERE id = ${po.id}`);
      return result.rows[0]!;
    });
    expect(row.tradeDirection).toBe("IMPORT");
    expect(row.incotermCode).toBeNull();
  });

  it("THE SELECTION FLOOR AT CREATE: an unknown code refuses BEFORE the row lands (ZERO residue — no order row at all)", async () => {
    const refusal = (await withTenant(TENANT_TRADE, () =>
      createPo({ currencyCode: "SAR", incotermCode: "ZZZ" })
        .catch((error: unknown) => error))) as IncotermRecordNotFoundError;
    expect(refusal).toBeInstanceOf(IncotermRecordNotFoundError);
    expect(refusal.code).toBe("INCOTERM_RECORD_NOT_FOUND");
    const su = await superuserClient();
    const rows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM purchase_orders WHERE tenant_id = $1 AND incoterm_code = 'ZZZ'`,
      [TENANT_TRADE],
    );
    await su.end();
    expect(rows.rows[0]!.n).toBe(0);
  });

  it("THE FLAG OFF = THE GATE SILENT: on a tenant WITHOUT the trade entitlement, a foreign-currency PO without an incoterm issues GREEN (the declared neutral zero's own reading)", async () => {
    const po = await createPo({ currencyCode: "USD", exchangeRate: "3.75" }, "RLS");
    const issued = await issuePo(po.id, "RLS");
    expect(issued.status).toBe("ISSUED");
    expect(issued.orderNo).toMatch(/^POR-/);
  });

  it("THE SALES LEG (the export side): a foreign-currency SO without an incoterm refuses at its own posting; with the selection it issues GREEN — the same gate, the same typed refusal", async () => {
    // The refusal's own world.
    const refused = await createSo({ incotermCode: null, tradeDirection: null });
    // The approval hop (the SoD floor: the creator cannot approve).
    await withTenant(TENANT_TRADE, async () => {
      const { SalesOrderService } = await import("../../modules/sales/application/orders");
      const { AtpService } = await import("../../modules/manufacturing/application/atp-service");
      const salesOrders = new SalesOrderService(audit, numbering, new AtpService());
      await salesOrders.submit(refused.id, TR_ACTOR);
      await salesOrders.approve(refused.id, TR_ACTOR2);
    });
    const refusal = (await withTenant(TENANT_TRADE, () =>
      (async () => {
        const { SalesOrderService } = await import("../../modules/sales/application/orders");
        const { AtpService } = await import("../../modules/manufacturing/application/atp-service");
        const salesOrders = new SalesOrderService(audit, numbering, new AtpService());
        return salesOrders.issue(refused.id, TR_ACTOR);
      })().catch((error: unknown) => error))) as OrderIncotermRequiredError;
    expect(refusal).toBeInstanceOf(OrderIncotermRequiredError);
    expect(refusal.code).toBe("ORDER_INCOTERM_REQUIRED");
    expect(refusal.details!.docType).toBe("sales_order");
    // ZERO RESIDUE: the row stays APPROVED, no number.
    const row = await withTenant(TENANT_TRADE, async () => {
      const rows = await requireTenantContext().tx!.execute<{ status: string; orderNo: string | null }>(sql`
        SELECT status, order_no AS "orderNo" FROM sales_orders WHERE id = ${refused.id}`);
      return rows.rows[0]!;
    });
    expect(row.status).toBe("APPROVED");
    expect(row.orderNo).toBeNull();

    // The satisfied shape: the same journey WITH the selection.
    const satisfied = await createSo({ incotermCode: "TR1", tradeDirection: "EXPORT" });
    const issued = await soJourney(satisfied.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.orderNo).toMatch(/^SOR-\d{4}-\d{6}$/);
    expect(issued.incotermCode).toBe("TR1");
  });
});
