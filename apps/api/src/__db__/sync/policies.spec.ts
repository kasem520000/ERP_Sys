import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION, type PushItemResultV2 } from "@erp/contracts";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant, requireTenantContext } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { PosSaleService } from "../../modules/sales/application/pos-channel/pos-sale-service";
import { QuotationService } from "../../modules/sales/application/quotations";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { PartnerService } from "../../modules/partners/application/partner-service";
import { ShiftService } from "../../modules/treasury/application/shift-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { ExpenseService } from "../../modules/treasury/application/expense-service";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { TransferService as TreasuryTransferService } from "../../modules/treasury/application/transfer-service";
import { VanStockService } from "../../modules/distribution/application/van-stock-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { OpeningStockService } from "../../modules/inventory/application/opening-stock-service";
import { TransferService as InventoryTransferService } from "../../modules/inventory/application/transfer-service";
import { CountService } from "../../modules/inventory/application/count-service";
import { PosShiftFlowService } from "../../modules/pos/application/shift-flow-service";
import { PushService } from "../../modules/sync/application/push-service";

/**
 * PHASE-020 T-P20-2b · push policy evidence (MASTER-PLAN §7 conflict-policy
 * table; CONFLICT_RESOLUTION §2/§3 + §6.2; SYNC_PROTOCOL §3/§6.3):
 * partner:contact_merge (FIELD_LEVEL_MERGE + the constrained-field gate),
 * sales_invoice create/update_draft (OWNER_DEVICE_WINS + baseVersion),
 * the ONLINE_ONLY guard, and C-02 ordering (same-entity serial execution
 * in array order; rejected dependencies leave no orphans).
 *
 * TENANT: shares TENANT_PUSH with push.spec.ts (the task allows either —
 * documented here): the db suite runs sequentially in one process, so the
 * first spec to boot materializes the fixture and the other's
 * find-or-create / ON CONFLICT inserts are no-ops. The fixture body is
 * kept in lockstep with push.spec.ts (same code, both idempotent).
 */

const TENANT_PUSH = "21212121-2121-2121-2121-212121212121";
const PUSH_ACTOR = "21212121-0000-4000-8000-000000002001";
const PUSH_CASHIER = "21212121-0000-4000-8000-000000002002";
const PUSH_SALES = "21212121-0000-4000-8000-000000002003";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
const posSales = new PosSaleService(audit, invoices, creditNotes);
const shiftFlow = new PosShiftFlowService(audit, new ShiftService(audit, posting));
const periods = new PeriodService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new RegistrationService(audit);
const treasuryAccounts = new AccountService(audit);
const warehouses = new WarehouseService(audit);
const openingStock = new OpeningStockService(audit, posting);
// PHASE-021 · DR-P21-08: the seven desktop write intents' owning services
// (the additive PushService constructor slots — same instances, same graph).
const partners = new PartnerService(audit);
const quotations = new QuotationService(audit, numbering);
const deliveries = new DeliveryNoteService(audit, posting, numbering);
const pettyCash = new PettyCashGuard(audit);
const expenses = new ExpenseService(audit, posting, numbering, pettyCash, resolver);
const treasuryTransfers = new TreasuryTransferService(audit, posting, numbering, pettyCash);
const inventoryTransfers = new InventoryTransferService(audit, posting, numbering);
const stockCounts = new CountService(audit, posting, numbering);
// PHASE-022 · DR-P22-06: the three field write intents' owning services
// (the additive PushService constructor slots — same instances, same graph).
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

interface World {
  branchId: string;
  warehouseId: string;
  customerId: string;
  itemA: string;
  itemB: string;
  taxStd: string;
  cashAccountId: string;
  terminalId: string;
}
let world: World;

let dDesk = "";
let dOther = "";

async function pushV2(deviceId: string, commands: unknown[]) {
  return withTenant(TENANT_PUSH, () =>
    push.push({
      deviceId,
      batchId: generateUuidV7(),
      commands,
      contractVersion: SYNC_CONTRACT_VERSION,
    }),
  );
}

function v2(
  entityType: string,
  intent: string,
  key: string,
  payload: unknown,
  extra?: { baseVersion?: number },
) {
  return {
    commandId: generateUuidV7(),
    entityType,
    intent,
    idempotencyKey: key,
    ...(extra?.baseVersion !== undefined ? { baseVersion: extra.baseVersion } : {}),
    clientCreatedAt: "2026-03-01T08:00:00Z",
    payload,
  };
}

/** The tenant-scoped app client (RLS world) for audit/feed assertions. */
async function policiesClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_PUSH]);
  return client;
}

async function countInvoices(): Promise<number> {
  return withTenant(TENANT_PUSH, async () => {
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM sales_invoices`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Push (sync)', 'المستأجر م', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PUSH],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'push-actor@fixture.test', 'Push Actor', 'x', 'ACTIVE'),
       ($2, 'push-cashier@fixture.test', 'Push Cashier', 'x', 'ACTIVE'),
       ($3, 'push-sales@fixture.test', 'Push Sales', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [PUSH_ACTOR, PUSH_CASHIER, PUSH_SALES],
  );
  await su.end();

  let itemA = "";
  let itemB = "";
  let taxStd = "";
  let cashAccountId = "";

  await withTenant(TENANT_PUSH, async () => {
    const tx = requireTenantContext().tx!;
    const { seedMasterDataBasics, provisionCoaTemplate, listBranches, insertBranch } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const { insertAccountPurpose } = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    const byCode = async (code: string) => {
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await accountingStore.findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("COGS", "5100");
    await mapPurpose("OPENING_EQUITY", "3100");
    await mapPurpose("AR_CONTROL", "1130");
    const cashGl = (await byCode("1111")).id;

    const existingYear = await accountingStore.findFiscalYearByName("FY2026");
    if (existingYear === undefined) {
      await periods.createYear(PUSH_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    const branches = await listBranches(null);
    const main =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    const existingWarehouses = await warehouses.list({ limit: 10, activeOnly: false });
    const wh =
      existingWarehouses.find((w) => w.code === "P-WH") ??
      (await warehouses.create({
        branchId: main.id,
        code: "P-WH",
        name: "Push warehouse",
        nameAr: "مستودع الدفع",
        inventoryAccountId: null,
        note: null,
        actorId: PUSH_ACTOR,
      }));

    const existingCustomer = await partnersStore.findPartnerByCode("P-CUST-01");
    const customerId =
      existingCustomer?.id ??
      (await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-CUST-01",
        name: "شركة الدفع",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      })).id;

    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: PUSH_ACTOR,
        note: "push fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    taxStd =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (await taxCodes.create({
        code: "STD",
        name: "Standard (SA)",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "STANDARD_RATED",
        actorId: PUSH_ACTOR,
      })).id;

    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, basePrice: string | null) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      return (await itemsStore.insertItem({
        sku,
        name: `Push ${sku}`,
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
        basePrice,
      })).id;
    };
    itemA = await ensureItem("P-A", "100.000000");
    itemB = await ensureItem("P-B", "40.000000");

    const existingAccounts = await treasuryAccounts.list({});
    const cash =
      existingAccounts.find((a) => a.name === "Push cash") ??
      (await treasuryAccounts.open({
        name: "Push cash",
        nameAr: "صندوق الدفع",
        type: "CASH",
        accountId: cashGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: PUSH_ACTOR,
      }));
    cashAccountId = cash.id;

    const terminalId = "eeeeeeee-0000-4000-8000-000000000001";
    await tx.execute(sql`
      INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id,
                                 warehouse_id, receipt_size, status)
      VALUES (${terminalId}, erp.current_tenant_id(), 'T1', 'Push Terminal 1', ${main.id},
              ${cashAccountId}, ${wh.id}, '80mm', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'
    `);

    // The desktop pair: the owner device + the second device (C-10).
    const enrollDesktop = (id: string, userId: string) => tx.execute(sql`
      INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class)
      VALUES (${id}::uuid, ${userId}::uuid, 'DESKTOP', ${`device-${id}`}, ${`key-${id}`}, 'tauri-desktop')
      ON CONFLICT (id) DO NOTHING
    `);
    dDesk = generateUuidV7();
    dOther = generateUuidV7();
    await enrollDesktop(dDesk, PUSH_SALES);
    await enrollDesktop(dOther, PUSH_SALES);

    world = {
      branchId: main.id,
      warehouseId: wh.id,
      customerId,
      itemA,
      itemB,
      taxStd,
      cashAccountId,
      terminalId,
    };
  });

  const su2 = await superuserClient();
  const existingOpening = await su2.query(
    `SELECT count(*)::int AS n FROM opening_balance_docs WHERE tenant_id = $1`,
    [TENANT_PUSH],
  );
  if ((existingOpening.rows as unknown as { n: number }[])[0]!.n === 0) {
    await su2.query(
      `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
       VALUES
         ('eeeeeeee-0000-4000-8000-0000000000a1', $1, 'STOCK', $2, 50, 60.000000, 'SAR', 'DRAFT'),
         ('eeeeeeee-0000-4000-8000-0000000000b1', $1, 'STOCK', $3, 25, 25.000000, 'SAR', 'DRAFT')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_PUSH, world.itemA, world.itemB],
    );
  }
  await su2.end();
  await withTenant(TENANT_PUSH, async () => {
    await openingStock.post({ warehouseId: world.warehouseId, actorId: PUSH_ACTOR });
  });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 push policies (T-P20-2b)", () => {
  it("1. partner:contact_merge — whitelisted merge + audit + feed + per-field before/after", async () => {
    // A fresh partner with NO contact/address rows (before = null everywhere).
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const partner = await withTenant(TENANT_PUSH, () =>
      partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-MERGE-01",
        name: "شركة الدمج",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    const command = v2("partner", "contact_merge", "policy-merge-1", {
      partnerId: partner.id,
      phone: "+966500000001",
      email: "owner@pmerge.test",
      contactPerson: "أحمد المدير",
      addressLine1: "الرياض - حي العليا",
      addressLine2: "مبنى 12",
      city: "الرياض",
    });
    const { results } = await pushV2(dDesk, [command]);
    const item = asAccepted(results[0]!);
    expect(item.status).toBe("ACCEPTED");
    expect(item.entity).toMatchObject({ id: partner.id, version: 2 });

    // Per-field before/after in the result (before = null: no rows existed).
    const merged = (item.result as unknown as { mergedFields: { field: string; before: unknown; after: unknown }[] }).mergedFields;
    expect(merged.map((row) => row.field).sort()).toEqual(
      ["addressLine1", "addressLine2", "city", "contactPerson", "email", "phone"].sort(),
    );
    for (const row of merged) {
      expect(row.before).toBeNull();
    }

    // The merged rows: partner_contacts + partner_addresses.
    const contact = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        SELECT name, phone, email, is_primary FROM partner_contacts
        WHERE tenant_id = erp.current_tenant_id() AND partner_id = ${partner.id}::uuid
      `),
    );
    expect(contact.rows).toHaveLength(1);
    expect(contact.rows[0]).toMatchObject({
      name: "أحمد المدير",
      phone: "+966500000001",
      email: "owner@pmerge.test",
      is_primary: true,
    });
    const address = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        SELECT type, line1, line2, city FROM partner_addresses
        WHERE tenant_id = erp.current_tenant_id() AND partner_id = ${partner.id}::uuid
      `),
    );
    expect(address.rows).toHaveLength(1);
    expect(address.rows[0]).toMatchObject({
      type: "BILLING",
      line1: "الرياض - حي العليا",
      line2: "مبنى 12",
      city: "الرياض",
    });

    // The partners marker stamp (version 2 — the feed version signal).
    const partnerRow = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT version FROM partners WHERE id = ${partner.id}::uuid`,
      ),
    );
    expect((partnerRow.rows as unknown as { version: number }[])[0]!.version).toBe(2);

    // The audit event (RLS world read).
    const client = await policiesClient();
    const events = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
       WHERE action = 'partner.contact_field_merged' AND entity_id = $1`,
      [partner.id],
    );
    await client.end();
    expect(events.rows[0]!.n).toBe(1);

    // The partner feed entry (same-tx change_log write).
    const feed = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT count(*)::int AS n FROM change_log WHERE entity_type = 'partners' AND entity_id = ${partner.id}::text`,
      ),
    );
    expect((feed.rows as unknown as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("2. contact_merge with a constrained field in the RAW payload → VALIDATION_ERROR, zero merge", async () => {
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const partner = await withTenant(TENANT_PUSH, () =>
      partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-CONST-01",
        name: "شركة القيد",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    // Bypass the contract schema: the RAW payload carries creditLimit.
    const command = v2("partner", "contact_merge", "policy-const-1", {
      partnerId: partner.id,
      phone: "+966500000002",
      creditLimit: "5000.0000",
    });
    const { results } = await pushV2(dDesk, [command]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.action).toBe("EDIT_AND_RESEND");
    expect(item.details).toMatchObject({ constrainedFields: ["creditLimit"] });

    // Zero merge: no contact rows, version untouched.
    const contact = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        SELECT count(*)::int AS n FROM partner_contacts
        WHERE tenant_id = erp.current_tenant_id() AND partner_id = ${partner.id}::uuid
      `),
    );
    expect((contact.rows as unknown as { n: number }[])[0]!.n).toBe(0);
    const partnerRow = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT version, credit_limit FROM partners WHERE id = ${partner.id}::uuid`,
      ),
    );
    expect(partnerRow.rows[0]).toMatchObject({ version: 1, credit_limit: null });
  });

  it("3. sales_invoice:create_draft → DRAFT created, owner_device_id stamped, feed entry", async () => {
    const command = v2("sales_invoice", "create_draft", "policy-draft-1", {
      customerId: world.customerId,
      orderDate: "2026-03-01",
      lines: [
        { itemId: world.itemA, qty: "2", unitPrice: "90.000000", taxCodeId: world.taxStd },
      ],
    });
    const { results } = await pushV2(dDesk, [command]);
    const item = asAccepted(results[0]!);
    expect(item.status).toBe("ACCEPTED");
    expect(item.result).toMatchObject({ status: "DRAFT" });
    expect(item.entity).toMatchObject({ version: 1 });
    const invoiceId = (item.result as unknown as { invoiceId: string }).invoiceId;

    const row = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        SELECT status, kind, owner_device_id AS "ownerDeviceId", channel
        FROM sales_invoices WHERE id = ${invoiceId}::uuid
      `),
    );
    expect(row.rows[0]).toMatchObject({
      status: "DRAFT",
      kind: "CREDIT",
      ownerDeviceId: dDesk,
    });

    const feed = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT count(*)::int AS n FROM change_log WHERE entity_type = 'sales_invoices' AND entity_id = ${invoiceId}::text`,
      ),
    );
    expect((feed.rows as unknown as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(1);

    // Stash for the update tests.
    (globalThis as { __draftId?: string }).__draftId = invoiceId;
  });

  it("4. update_draft by the owner with the correct baseVersion → ACCEPTED, version+1, aggregate replaced", async () => {
    const draftId = (globalThis as { __draftId?: string }).__draftId!;
    const command = v2(
      "sales_invoice",
      "update_draft",
      "policy-draft-2",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-02",
        lines: [
          { itemId: world.itemA, qty: "3", unitPrice: "80.000000", taxCodeId: world.taxStd },
          { itemId: world.itemB, qty: "1", unitPrice: "40.000000", taxCodeId: world.taxStd },
        ],
      },
      { baseVersion: 1 },
    );
    const { results } = await pushV2(dDesk, [command]);
    if (results[0]!.status !== "ACCEPTED") {
      console.log("DEBUG-UPDATE", JSON.stringify(results[0], null, 2));
    }
    const item = results[0]!;
    expect(item.status).toBe("ACCEPTED");
    expect(item.entity).toMatchObject({ id: draftId, version: 2 });

    // Lines replaced wholesale (2 rows) + recomputed totals (net
    // 3×80 + 1×40 = 280 + 15% VAT 42 = 322 gross).
    const row = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        SELECT
          (SELECT count(*)::int FROM sales_invoice_lines WHERE invoice_id = ${draftId}::uuid) AS lines,
          total_net AS "totalNet", total_tax AS "totalTax", total_gross AS "totalGross",
          version, owner_device_id AS "ownerDeviceId"
        FROM sales_invoices WHERE id = ${draftId}::uuid
      `),
    );
    expect(row.rows[0]).toMatchObject({
      lines: 2,
      totalNet: "280.0000",
      totalTax: "42.0000",
      totalGross: "322.0000",
      version: 2,
      ownerDeviceId: dDesk,
    });

    // A SHRINKING payload (2 → 1 lines) is a legitimate aggregate
    // snapshot replace (SYNC_PROTOCOL §6.2) — migration 0031 granted the
    // line DELETE, so the wholesale replace handles growth AND shrink.
    const shrink = v2(
      "sales_invoice",
      "update_draft",
      "policy-draft-2-shrink",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-02",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "80.000000", taxCodeId: world.taxStd }],
      },
      { baseVersion: 2 },
    );
    const shrinkItem = asAccepted((await pushV2(dDesk, [shrink])).results[0]!);
    expect(shrinkItem.entity).toMatchObject({ id: draftId, version: 3 });
    const afterShrink = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        SELECT version, total_net AS "totalNet",
          (SELECT count(*)::int FROM sales_invoice_lines WHERE invoice_id = ${draftId}::uuid) AS lines
        FROM sales_invoices WHERE id = ${draftId}::uuid
      `),
    );
    expect(afterShrink.rows[0]).toMatchObject({ version: 3, lines: 1, totalNet: "80.0000" });
  });

  it("5. update_draft by a non-owner device → FORBIDDEN details.ownerDeviceId (C-10)", async () => {
    const draftId = (globalThis as { __draftId?: string }).__draftId!;
    const command = v2(
      "sales_invoice",
      "update_draft",
      "policy-draft-3",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-03",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
      },
      { baseVersion: 3 },
    );
    const { results } = await pushV2(dOther, [command]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("FORBIDDEN");
    expect(item.resubmittable).toBe(false);
    expect(item.details).toMatchObject({ ownerDeviceId: dDesk });

    // The draft is untouched.
    const row = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT version, invoice_date AS "invoiceDate" FROM sales_invoices WHERE id = ${draftId}::uuid`,
      ),
    );
    expect(row.rows[0]).toMatchObject({ version: 3, invoiceDate: "2026-03-02" });
  });

  it("6. update_draft with a stale baseVersion → STALE_VERSION details.currentVersion", async () => {
    const draftId = (globalThis as { __draftId?: string }).__draftId!;
    const command = v2(
      "sales_invoice",
      "update_draft",
      "policy-draft-4",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-04",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "50.000000", taxCodeId: world.taxStd }],
      },
      { baseVersion: 99 },
    );
    const { results } = await pushV2(dDesk, [command]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("STALE_VERSION");
    expect(item.action).toBe("EDIT_AND_RESEND");
    expect(item.details).toMatchObject({ currentVersion: 3 });
    expect(item.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
  });

  it("7. ONLINE_ONLY push (roles:create) → FORBIDDEN resubmittable:false", async () => {
    const command = v2("roles", "create", "policy-online-1", { name: "should never exist" });
    const { results } = await pushV2(dDesk, [command]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("FORBIDDEN");
    expect(item.resubmittable).toBe(false);
    expect(item.action).toBe("CANCEL_WITH_REASON");
    expect(item.localized).toEqual({
      ar: "هذا النوع للتحرير عبر الإنترنت فقط",
      en: "This entity type is online-only",
    });
  });

  it("8. C-02 ordering: same-entity serial in one batch; a rejected create leaves no orphan dependents", async () => {
    const draftId = (globalThis as { __draftId?: string }).__draftId!; // version 3 after test 4's shrink

    // (a) ONE batch, two sequential updates of the SAME draft in array
    // order (§6.3): the second's baseVersion matches the first's result
    // (the wholesale aggregate replace handles any line-count change —
    // migration 0031's DELETE grant; see test 4).
    const first = v2(
      "sales_invoice",
      "update_draft",
      "policy-order-1",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-05",
        lines: [
          { itemId: world.itemA, qty: "1", unitPrice: "70.000000", taxCodeId: world.taxStd },
          { itemId: world.itemB, qty: "1", unitPrice: "40.000000", taxCodeId: world.taxStd },
        ],
      },
      { baseVersion: 3 },
    );
    const second = v2(
      "sales_invoice",
      "update_draft",
      "policy-order-2",
      {
        invoiceId: draftId,
        customerId: world.customerId,
        orderDate: "2026-03-06",
        lines: [
          { itemId: world.itemA, qty: "2", unitPrice: "70.000000", taxCodeId: world.taxStd },
          { itemId: world.itemB, qty: "2", unitPrice: "40.000000", taxCodeId: world.taxStd },
          { itemId: world.itemA, qty: "1", unitPrice: "65.000000", taxCodeId: world.taxStd },
        ],
      },
      { baseVersion: 4 },
    );
    const { results } = await pushV2(dDesk, [first, second]);
    expect(results.map((item) => item.status)).toEqual(["ACCEPTED", "ACCEPTED"]);
    expect(results[0]).toMatchObject({ entity: { id: draftId, version: 4 } });
    expect(results[1]).toMatchObject({ entity: { id: draftId, version: 5 } });

    // (b) across batches: a create_draft that will be REJECTED (unknown
    // item) leaves no invoice; a dependent update_draft referencing the
    // would-be id rejects — no orphans anywhere.
    const invoicesBefore = await countInvoices();
    const badCreate = v2("sales_invoice", "create_draft", "policy-order-3", {
      customerId: world.customerId,
      orderDate: "2026-03-07",
      lines: [
        { itemId: generateUuidV7(), qty: "1", unitPrice: "10.000000", taxCodeId: world.taxStd },
      ],
    });
    const rejectedCreate = asRejected((await pushV2(dDesk, [badCreate])).results[0]!);
    expect(rejectedCreate.reason).toBe("VALIDATION_ERROR");
    expect(await countInvoices()).toBe(invoicesBefore);

    const orphanUpdate = v2(
      "sales_invoice",
      "update_draft",
      "policy-order-4",
      {
        invoiceId: generateUuidV7(),
        customerId: world.customerId,
        orderDate: "2026-03-08",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "10.000000", taxCodeId: world.taxStd }],
      },
      { baseVersion: 1 },
    );
    const rejectedUpdate = asRejected((await pushV2(dDesk, [orphanUpdate])).results[0]!);
    expect(rejectedUpdate.reason).toBe("VALIDATION_ERROR");
    expect(rejectedUpdate.message).toMatch(/does not exist in this tenant/);
    expect(await countInvoices()).toBe(invoicesBefore);
  });
});
