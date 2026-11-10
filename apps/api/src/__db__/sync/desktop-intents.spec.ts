import { beforeAll, afterAll, describe, expect, it } from "vitest";
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
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
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
import { TransferService as InventoryTransferService } from "../../modules/inventory/application/transfer-service";
import { CountService } from "../../modules/inventory/application/count-service";
import { PosShiftFlowService } from "../../modules/pos/application/shift-flow-service";
import { PushService } from "../../modules/sync/application/push-service";
import { pull } from "../../modules/sync/application/pull-service";
import { handlerRegistryKeys } from "../../modules/sync/application/handlers";

/**
 * PHASE-021 T-P21-2d · DR-P21-08 — the seven desktop write intents
 * (MASTER-PLAN §6 table; OFFLINE_CAPABILITIES_MATRIX rows 7/10/11/25/26/34):
 * for every intent — ACCEPT (real rows + in-tx feed publication + device
 * audit), zod REJECT (VALIDATION_ERROR, zero residue), ONE real
 * server-side business rule (the owning service's typed error → the
 * existing push-service rejection mapping; fallbacks recorded in
 * T-P21-2d.md), and idempotent replay (C-01: same commandId +
 * idempotencyKey → duplicate:true, no second entity). Plus the OD-create
 * posture for quotations (create-only: no update intent in the registry)
 * and the frozen feed-group scope sanity (none of the new types is
 * pullable; the confirmation rides the push result).
 *
 * TENANT: dedicated 2d2d2d2d (verified unused across the repo — the master
 * plan's TENANT_DESKTOP 21212121 is taken by push/policies specs). Devices
 * are created directly (the policies.spec pattern — the enroll endpoint is
 * 1-b's; the direct row is the preferred spec bootstrap).
 */

const TENANT = "2d2d2d2d-2d2d-2d2d-2d2d-2d2d2d2d2d2d";
const OWNER = "2d2d2d2d-0000-4000-8000-000000002d01";
const DESK_USER = "2d2d2d2d-0000-4000-8000-000000002d02";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
const posSales = new PosSaleService(audit, invoices, creditNotes);
const shiftFlow = new PosShiftFlowService(audit, new ShiftService(audit, posting));
const treasuryAccounts = new AccountService(audit);
const warehouses = new WarehouseService(audit);
// DR-P21-08: the seven desktop write intents' owning services.
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
  warehouseAId: string;
  warehouseBId: string;
  customerId: string;
  customerInactiveId: string;
  itemA: string;
  itemB: string;
  itemService: string;
  cashAccountId: string;
  bankAccountId: string;
  expenseCategoryId: string;
  countId: string;
}
let world: World;

let dDesk = "";
let dQuote = "";
let dDn = "";
let dExp = "";
let dTr = "";
let dSt = "";
let dSc = "";
let dOther = "";

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

function v2(entityType: string, intent: string, key: string, payload: unknown) {
  return {
    commandId: generateUuidV7(),
    entityType,
    intent,
    idempotencyKey: key,
    clientCreatedAt: "2026-11-10T08:00:00Z",
    payload,
  };
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

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant Desktop Intents (P21 2d)', 'مستأجر سطح المكتب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'di-owner@fixture.test', 'DI Owner', 'x', 'ACTIVE'),
       ($2, 'di-desk@fixture.test', 'DI Desk User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER, DESK_USER],
  );
  await su.end();

  let itemA = "";
  let itemB = "";
  let itemService = "";
  let cashAccountId = "";
  let bankAccountId = "";
  let expenseCategoryId = "";
  let countId = "";

  await withTenant(TENANT, async () => {
    const tx = requireTenantContext().tx!;
    const { seedMasterDataBasics, provisionCoaTemplate, listBranches, insertBranch } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    const byCode = async (code: string) => {
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };

    const branches = await listBranches(null);
    const main =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));

    // Two warehouses (the stock-transfer from ≠ to rule).
    const existingWarehouses = await warehouses.list({ limit: 50, activeOnly: false });
    const ensureWh = async (code: string, name: string) => {
      const found = existingWarehouses.find((w) => w.code === code);
      if (found !== undefined) return found.id;
      return (
        await warehouses.create({
          branchId: main.id,
          code,
          name,
          nameAr: null,
          inventoryAccountId: null,
          note: null,
          actorId: OWNER,
        })
      ).id;
    };
    const warehouseAId = await ensureWh("DI-WH-A", "DI warehouse A");
    const warehouseBId = await ensureWh("DI-WH-B", "DI warehouse B");

    // The ACTIVE customer + the INACTIVE one (the quotation business rule).
    const ensurePartner = async (code: string, name: string) => {
      const existing = await partnersStore.findPartnerByCode(code);
      return (
        existing?.id ??
        (
          await partnersStore.insertPartner({
            kind: "CUSTOMER",
            code,
            name,
            nameAr: null,
            taxNumber: null,
            creditLimit: null,
            creditTermsId: null,
            priceListId: null,
          })
        ).id
      );
    };
    const customerId = await ensurePartner("DI-CUST-01", "شركة سطح المكتب");
    const customerInactiveId = await ensurePartner("DI-CUST-IN", "شركة موقوفة");
    await tx.execute(sql`
      UPDATE partners SET status = 'INACTIVE', updated_at = now()
      WHERE id = ${customerInactiveId}::uuid AND status = 'ACTIVE'
    `);

    // STOCK items + one SERVICE item (the delivery business rule).
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, basePrice: string | null, kind: string) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      return (
        await itemsStore.insertItem({
          sku,
          name: `DI ${sku}`,
          nameAr: null,
          kind,
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
        })
      ).id;
    };
    itemA = await ensureItem("DI-A", "100.000000", "STOCK");
    itemB = await ensureItem("DI-B", "40.000000", "STOCK");
    itemService = await ensureItem("DI-SVC", "10.000000", "SERVICE");

    // Two treasury accounts (GL 1:1 per tenant: cash 1111 + bank 1121).
    const existingAccounts = await treasuryAccounts.list({});
    const ensureAccount = async (name: string, type: "CASH" | "BANK", glCode: string) => {
      const found = existingAccounts.find((a) => a.name === name);
      if (found !== undefined) return found.id;
      return (
        await treasuryAccounts.open({
          name,
          nameAr: null,
          type,
          accountId: (await byCode(glCode)).id,
          branchId: null,
          currencyCode: "SAR",
          actorId: OWNER,
        })
      ).id;
    };
    cashAccountId = await ensureAccount("DI cash", "CASH", "1111");
    bankAccountId = await ensureAccount("DI bank", "BANK", "1121");

    // An active expense category (GL 5210 — Rent, EXPENSE/postable).
    const categories = await expenses.listCategories(true);
    const category =
      categories.find((row) => row.code === "DI-RENT") ??
      (await expenses.createCategory({
        code: "DI-RENT",
        name: "DI Rent",
        nameAr: "إيجار",
        accountId: (await byCode("5210")).id,
        approvalMode: "none",
        actorId: OWNER,
      }));
    expenseCategoryId = category.id;

    // The count session the desktop counts against (created ONLINE — the
    // system-qty snapshot is frozen server-side at session start).
    const counts = await stockCounts.list({ limit: 50 });
    const existingCount = counts.find((row) => row.warehouseId === warehouseAId && row.status === "DRAFT");
    countId =
      existingCount?.id ??
      (
        await stockCounts.create({
          warehouseId: warehouseAId,
          blind: false,
          itemIds: [itemA, itemB],
          note: "DI count session",
          noteAr: null,
          actorId: OWNER,
        })
      ).id;

    // The desktop pool: one device per intent cluster (the push rate
    // bucket is PER DEVICE — burst 20 / refill 10-per-min; a cluster's
    // ≤ 4 pushes stay far under it) + the second device (the OD posture).
    const enrollDesktop = (id: string, userId: string) => tx.execute(sql`
      INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class)
      VALUES (${id}::uuid, ${userId}::uuid, 'DESKTOP', ${`di-device-${id.slice(0, 8)}`},
              ${`key-${id}`}, 'tauri-desktop')
      ON CONFLICT (id) DO NOTHING
    `);
    dDesk = generateUuidV7();
    dQuote = generateUuidV7();
    dDn = generateUuidV7();
    dExp = generateUuidV7();
    dTr = generateUuidV7();
    dSt = generateUuidV7();
    dSc = generateUuidV7();
    dOther = generateUuidV7();
    for (const id of [dDesk, dQuote, dDn, dExp, dTr, dSt, dSc, dOther]) {
      await enrollDesktop(id, DESK_USER);
    }

    world = {
      warehouseAId,
      warehouseBId,
      customerId,
      customerInactiveId,
      itemA,
      itemB,
      itemService,
      cashAccountId,
      bankAccountId,
      expenseCategoryId,
      countId,
    };
  });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-021 DR-P21-08 · desktop write intents (T-P21-2d)", () => {
  // -- partner:create (SD · PartnerService.create) ------------------------------

  it("1. partner:create — ACCEPTED: partner row, in-tx partners feed, device audit, idempotent replay", async () => {
    const command = v2("partner", "create", "di-partner-1", {
      kind: "CUSTOMER",
      name: "شركة خارج الخط",
      nameAr: "Offline Co",
      taxNumber: "310000000000004",
    });
    const { results } = await pushV2(dDesk, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "ACTIVE" });
    expect(typeof (item.result as unknown as { partnerId: string }).partnerId).toBe("string");
    expect(item.entity?.version).toBe(1);
    const partnerId = (item.result as unknown as { partnerId: string }).partnerId;
    // BR-025: the code auto-numbered tenant-wide.
    expect((item.result as unknown as { code: string }).code).toMatch(/^P-\d{6}$/);
    // Stash for the feed-group pullability test (the policies.spec pattern).
    (globalThis as { __diPartnerId?: string }).__diPartnerId = partnerId;

    // The real row (partners table) with the payload's fields.
    const row = await oneRow(
      sql`SELECT kind, name, name_ar AS "nameAr", tax_number AS "taxNumber", status, version
          FROM partners WHERE id = ${partnerId}::uuid`,
    );
    expect(row).toMatchObject({
      kind: "CUSTOMER",
      name: "شركة خارج الخط",
      nameAr: "Offline Co",
      taxNumber: "310000000000004",
      status: "ACTIVE",
      version: 1,
    });

    // In-tx feed publication (partners IS a pulled feed entity).
    expect(await feedCount("partners", partnerId)).toBeGreaterThanOrEqual(1);

    // The device-stamped offline audit row (provenance) + the service's own.
    const offline = await offlineAudit("partner.offline_created", partnerId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dDesk);

    // C-01 replay: same commandId + idempotencyKey → duplicate, no second row.
    const partnersBefore = await countRows("partners");
    const replay = await pushV2(dDesk, [command]);
    const replayItem = asAccepted(replay.results[0]!);
    expect(replayItem.duplicate).toBe(true);
    expect((replayItem.result as unknown as { partnerId: string }).partnerId).toBe(partnerId);
    expect(await countRows("partners")).toBe(partnersBefore);
  });

  it("2. partner:create — zod REJECT (missing name): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("partners");
    const { results } = await pushV2(dDesk, [
      v2("partner", "create", "di-partner-2", { kind: "CUSTOMER" }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.action).toBe("EDIT_AND_RESEND");
    expect(item.message).toMatch(/partner:create payload rejected by the contract/);
    expect(await countRows("partners")).toBe(before);
  });

  it("3. partner:create — business rule (unknown price list): typed PRICE_LIST_NOT_FOUND → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("partners");
    const { results } = await pushV2(dDesk, [
      v2("partner", "create", "di-partner-3", {
        kind: "CUSTOMER",
        name: "قائمة أسعار مجهولة",
        priceListId: generateUuidV7(),
      }),
    ]);
    const item = asRejected(results[0]!);
    // The service's typed error code is not a sync wire reason — the
    // push service's honest fallback (recorded in T-P21-2d.md).
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/price list .* does not exist/i);
    expect(await countRows("partners")).toBe(before);
  });

  // -- quotation:create_draft (OD-create · QuotationService.create) -------------

  it("4. quotation:create_draft — ACCEPTED: DRAFT row + lines, in-tx feed, device audit, idempotent replay", async () => {
    const command = v2("quotation", "create_draft", "di-quote-1", {
      customerId: world.customerId,
      quoteDate: "2026-11-10",
      validUntil: "2026-12-10",
      lines: [
        { itemId: world.itemA, qty: "2", unitPrice: "90.000000" },
        { itemId: world.itemB, qty: "1", unitPrice: "40.000000", discountAmount: "5.0000" },
      ],
    });
    const { results } = await pushV2(dQuote, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "DRAFT", totalNet: "215.0000" });
    const quotationId = (item.result as unknown as { quotationId: string }).quotationId;
    expect(item.entity).toMatchObject({ id: quotationId, version: 1 });
    // No official number at DRAFT (QOT- reserves at send — BR-029); the
    // confirmation rides the push result (result.entity).
    expect(item.officialNumber).toBeUndefined();

    const row = await oneRow(sql`
      SELECT q.status, q.valid_until AS "validUntil", q.total_net AS "totalNet",
             (SELECT count(*)::int FROM quotation_lines WHERE quotation_id = q.id) AS lines,
             q.version
      FROM quotations q WHERE q.id = ${quotationId}::uuid
    `);
    expect(row).toMatchObject({
      status: "DRAFT",
      validUntil: "2026-12-10",
      totalNet: "215.0000",
      lines: 2,
      version: 1,
    });

    expect(await feedCount("quotations", quotationId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("sales.quotation_offline_created", quotationId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dQuote);

    // C-01 replay.
    const before = await countRows("quotations");
    const replay = asAccepted((await pushV2(dQuote, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    expect((replay.result as unknown as { quotationId: string }).quotationId).toBe(quotationId);
    expect(await countRows("quotations")).toBe(before);
  });

  it("5. quotation:create_draft — zod REJECT (empty lines): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("quotations");
    const { results } = await pushV2(dQuote, [
      v2("quotation", "create_draft", "di-quote-2", {
        customerId: world.customerId,
        quoteDate: "2026-11-10",
        lines: [],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/quotation:create_draft payload rejected by the contract/);
    expect(await countRows("quotations")).toBe(before);
  });

  it("6. quotation:create_draft — business rule (INACTIVE customer): the service's typed state error → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("quotations");
    const { results } = await pushV2(dQuote, [
      v2("quotation", "create_draft", "di-quote-3", {
        customerId: world.customerInactiveId,
        quoteDate: "2026-11-10",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "90.000000" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    // requireCustomer's SalesDocumentStateError (SALES_DOCUMENT_STATE) is
    // not a sync wire reason — the push service's honest fallback
    // (recorded in T-P21-2d.md; PARTNER_INACTIVE stays the 016 POS-sale
    // vocabulary — no remapping layer is added here).
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/is INACTIVE and cannot receive sales documents/);
    expect(await countRows("quotations")).toBe(before);
  });

  it("7. quotation OD-create posture — NO update intent: a second device's quotation:update_draft is an unknown-intent rejection", async () => {
    // DR-P21-08 create-only: the registry carries no quotation update.
    expect(handlerRegistryKeys()).not.toContain("quotation:update_draft");
    expect(handlerRegistryKeys()).toContain("quotation:create_draft");

    const { results } = await pushV2(dOther, [
      v2("quotation", "update_draft", "di-quote-4", {
        quotationId: generateUuidV7(),
        customerId: world.customerId,
        quoteDate: "2026-11-11",
        lines: [{ itemId: world.itemA, qty: "1", unitPrice: "90.000000" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/no handler for quotation:update_draft/);
    expect(item.details).toMatchObject({ supported: expect.arrayContaining(["quotation:create_draft"]) });
  });

  // -- delivery_note:create_draft (SD-at-submit · DeliveryNoteService.create) ---

  it("8. delivery_note:create_draft — ACCEPTED: DRAFT row + lines, in-tx feed, device audit, idempotent replay", async () => {
    const command = v2("delivery_note", "create_draft", "di-dn-accept-1", {
      customerId: world.customerId,
      warehouseId: world.warehouseAId,
      deliveryDate: "2026-11-10",
      lines: [
        { itemId: world.itemA, qty: "3" },
        { itemId: world.itemB, qty: "2", unitPrice: "38.000000" },
      ],
    });
    const { results } = await pushV2(dDn, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "DRAFT", totalNet: "376.0000" });
    const deliveryId = (item.result as unknown as { deliveryId: string }).deliveryId;
    expect(item.entity).toMatchObject({ id: deliveryId, version: 1 });
    // No stock moved, no COGS — posting is the online SD-at-submit path.
    const moves = await oneRow(
      sql`SELECT count(*)::int AS n FROM stock_moves WHERE source_type = 'delivery_note' AND source_id = ${deliveryId}::uuid`,
    );
    expect(Number(moves?.n)).toBe(0);

    const row = await oneRow(sql`
      SELECT d.status, d.total_net AS "totalNet",
             (SELECT count(*)::int FROM delivery_note_lines WHERE delivery_id = d.id) AS lines,
             d.version
      FROM delivery_notes d WHERE d.id = ${deliveryId}::uuid
    `);
    expect(row).toMatchObject({ status: "DRAFT", totalNet: "376.0000", lines: 2, version: 1 });

    expect(await feedCount("delivery_notes", deliveryId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("sales.delivery_note_offline_created", deliveryId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dDn);

    // C-01 replay.
    const before = await countRows("delivery_notes");
    const replay = asAccepted((await pushV2(dDn, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    expect(await countRows("delivery_notes")).toBe(before);
  });

  it("9. delivery_note:create_draft — zod REJECT (not-a-uuid warehouse): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("delivery_notes");
    const { results } = await pushV2(dDn, [
      v2("delivery_note", "create_draft", "di-dn-zod-2", {
        customerId: world.customerId,
        warehouseId: "not-a-uuid",
        deliveryDate: "2026-11-10",
        lines: [{ itemId: world.itemA, qty: "1" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/delivery_note:create_draft payload rejected by the contract/);
    expect(await countRows("delivery_notes")).toBe(before);
  });

  it("10. delivery_note:create_draft — business rule (SERVICE item): typed DELIVERY_LINE_INVALID → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("delivery_notes");
    const { results } = await pushV2(dDn, [
      v2("delivery_note", "create_draft", "di-dn-rule-3", {
        customerId: world.customerId,
        warehouseId: world.warehouseAId,
        deliveryDate: "2026-11-10",
        lines: [{ itemId: world.itemService, qty: "1" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/is not a STOCK item — deliveries move stock only/);
    expect(await countRows("delivery_notes")).toBe(before);
  });

  // -- expense:create (SD · ExpenseService.create) -------------------------------

  it("11. expense:create — ACCEPTED: DRAFT claim row, in-tx feed, device audit, idempotent replay", async () => {
    const command = v2("expense", "create", "di-exp-1", {
      categoryId: world.expenseCategoryId,
      cashAccountId: world.cashAccountId,
      payeeName: "مكتب الهندسة",
      currencyCode: "SAR",
      amount: "1250.0000",
      valueDate: "2026-11-10",
      description: "إيجار المكتب - نوفمبر",
    });
    const { results } = await pushV2(dExp, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "DRAFT", amount: "1250.0000" });
    const expenseId = (item.result as unknown as { expenseId: string }).expenseId;
    expect(item.entity).toMatchObject({ id: expenseId, version: 1 });

    const row = await oneRow(sql`
      SELECT e.status, e.payee_name AS "payeeName", e.amount, e.value_date AS "valueDate",
             e.version, e.created_by AS "createdBy"
      FROM expenses e WHERE e.id = ${expenseId}::uuid
    `);
    expect(row).toMatchObject({
      status: "DRAFT",
      payeeName: "مكتب الهندسة",
      amount: "1250.0000",
      valueDate: "2026-11-10",
      version: 1,
      createdBy: DESK_USER,
    });

    expect(await feedCount("expenses", expenseId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("treasury.expense_offline_created", expenseId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dExp);

    // C-01 replay.
    const before = await countRows("expenses");
    const replay = asAccepted((await pushV2(dExp, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    expect(await countRows("expenses")).toBe(before);
  });

  it("12. expense:create — zod REJECT (malformed amount): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("expenses");
    const { results } = await pushV2(dExp, [
      v2("expense", "create", "di-exp-2", {
        categoryId: world.expenseCategoryId,
        cashAccountId: world.cashAccountId,
        payeeName: "مكتب الهندسة",
        currencyCode: "SAR",
        amount: "12.50.00",
        valueDate: "2026-11-10",
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/expense:create payload rejected by the contract/);
    expect(await countRows("expenses")).toBe(before);
  });

  it("13. expense:create — business rule (negative amount): typed INVALID_AMOUNT → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("expenses");
    const { results } = await pushV2(dExp, [
      v2("expense", "create", "di-exp-3", {
        categoryId: world.expenseCategoryId,
        cashAccountId: world.cashAccountId,
        payeeName: "مكتب الهندسة",
        currencyCode: "SAR",
        amount: "-10.0000",
        valueDate: "2026-11-10",
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/expense amount must be a positive decimal/);
    expect(await countRows("expenses")).toBe(before);
  });

  // -- cash_transfer:create_draft (SD · treasury TransferService.create) --------

  it("14. cash_transfer:create_draft — ACCEPTED: DRAFT transfer row, in-tx feed, device audit, idempotent replay", async () => {
    const command = v2("cash_transfer", "create_draft", "di-tr-accept-1", {
      fromAccountId: world.bankAccountId,
      toAccountId: world.cashAccountId,
      currencyCode: "SAR",
      amount: "500.0000",
      valueDate: "2026-11-10",
      reference: "DI-BANK-001",
    });
    const { results } = await pushV2(dTr, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "DRAFT", amount: "500.0000", feeAmount: "0.0000" });
    const transferId = (item.result as unknown as { transferId: string }).transferId;
    expect(item.entity).toMatchObject({ id: transferId, version: 1 });

    const row = await oneRow(sql`
      SELECT t.status, t.from_account_id AS "fromAccountId", t.to_account_id AS "toAccountId",
             t.amount, t.fee_amount AS "feeAmount", t.reference, t.version
      FROM cash_transfers t WHERE t.id = ${transferId}::uuid
    `);
    expect(row).toMatchObject({
      status: "DRAFT",
      fromAccountId: world.bankAccountId,
      toAccountId: world.cashAccountId,
      amount: "500.0000",
      feeAmount: "0.0000",
      reference: "DI-BANK-001",
      version: 1,
    });
    // No cash movement at draft (G-12 posts online).
    const movements = await oneRow(
      sql`SELECT count(*)::int AS n FROM cash_movements WHERE source_type = 'cash_transfer' AND source_id = ${transferId}::uuid`,
    );
    expect(Number(movements?.n)).toBe(0);

    expect(await feedCount("cash_transfers", transferId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("treasury.cash_transfer_offline_created", transferId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dTr);

    // C-01 replay.
    const before = await countRows("cash_transfers");
    const replay = asAccepted((await pushV2(dTr, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    expect(await countRows("cash_transfers")).toBe(before);
  });

  it("15. cash_transfer:create_draft — zod REJECT (not-a-uuid account): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("cash_transfers");
    const { results } = await pushV2(dTr, [
      v2("cash_transfer", "create_draft", "di-tr-zod-2", {
        fromAccountId: "not-a-uuid",
        toAccountId: world.cashAccountId,
        currencyCode: "SAR",
        amount: "100.0000",
        valueDate: "2026-11-10",
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/cash_transfer:create_draft payload rejected by the contract/);
    expect(await countRows("cash_transfers")).toBe(before);
  });

  it("16. cash_transfer:create_draft — business rule (fee ≥ amount): typed TREASURY_DOCUMENT_STATE_INVALID → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("cash_transfers");
    const { results } = await pushV2(dTr, [
      v2("cash_transfer", "create_draft", "di-tr-rule-3", {
        fromAccountId: world.bankAccountId,
        toAccountId: world.cashAccountId,
        currencyCode: "SAR",
        amount: "100.0000",
        feeAmount: "150.0000",
        valueDate: "2026-11-10",
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/fee must be smaller than the transferred amount/);
    expect(await countRows("cash_transfers")).toBe(before);
  });

  // -- stock_transfer:create_draft (SD · inventory TransferService.create) ------

  it("17. stock_transfer:create_draft — ACCEPTED: DRAFT transfer + lines, in-tx feed, device audit, idempotent replay", async () => {
    const command = v2("stock_transfer", "create_draft", "di-st-accept-1", {
      fromWarehouseId: world.warehouseAId,
      toWarehouseId: world.warehouseBId,
      lines: [
        { itemId: world.itemA, qty: "5" },
        { itemId: world.itemB, qty: "2" },
      ],
      note: "DI transfer",
    });
    const { results } = await pushV2(dSt, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ status: "DRAFT", lineCount: 2 });
    const transferId = (item.result as unknown as { transferId: string }).transferId;
    expect(item.entity).toMatchObject({ id: transferId, version: 1 });

    const row = await oneRow(sql`
      SELECT t.status, t.from_warehouse_id AS "fromWarehouseId", t.to_warehouse_id AS "toWarehouseId",
             (SELECT count(*)::int FROM stock_transfer_lines WHERE transfer_id = t.id) AS lines,
             t.version
      FROM stock_transfers t WHERE t.id = ${transferId}::uuid
    `);
    expect(row).toMatchObject({
      status: "DRAFT",
      fromWarehouseId: world.warehouseAId,
      toWarehouseId: world.warehouseBId,
      lines: 2,
      version: 1,
    });
    // No stock moved at draft (dispatch posts the OUT leg online).
    const moves = await oneRow(
      sql`SELECT count(*)::int AS n FROM stock_moves WHERE source_type = 'stock_transfer' AND source_id = ${transferId}::uuid`,
    );
    expect(Number(moves?.n)).toBe(0);

    expect(await feedCount("stock_transfers", transferId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("inventory.stock_transfer_offline_created", transferId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dSt);

    // C-01 replay.
    const before = await countRows("stock_transfers");
    const replay = asAccepted((await pushV2(dSt, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    expect(await countRows("stock_transfers")).toBe(before);
  });

  it("18. stock_transfer:create_draft — zod REJECT (empty lines): VALIDATION_ERROR, zero residue", async () => {
    const before = await countRows("stock_transfers");
    const { results } = await pushV2(dSt, [
      v2("stock_transfer", "create_draft", "di-st-zod-2", {
        fromWarehouseId: world.warehouseAId,
        toWarehouseId: world.warehouseBId,
        lines: [],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/stock_transfer:create_draft payload rejected by the contract/);
    expect(await countRows("stock_transfers")).toBe(before);
  });

  it("19. stock_transfer:create_draft — business rule (same warehouse): typed STOCK_TRANSFER_SAME_WAREHOUSE → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    const before = await countRows("stock_transfers");
    const { results } = await pushV2(dSt, [
      v2("stock_transfer", "create_draft", "di-st-rule-3", {
        fromWarehouseId: world.warehouseAId,
        toWarehouseId: world.warehouseAId,
        lines: [{ itemId: world.itemA, qty: "1" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/from and to warehouses must differ/);
    expect(await countRows("stock_transfers")).toBe(before);
  });

  // -- stock_count:submit_lines (SD-aggregate · CountService.enterCounts) -------

  it("20. stock_count:submit_lines — ACCEPTED: counted lines land, in-tx feed, device audit, idempotent replay", async () => {
    const command = v2("stock_count", "submit_lines", "di-sc-accept-1", {
      countId: world.countId,
      lines: [
        { itemId: world.itemA, countedQty: "8" },
        { itemId: world.itemB, countedQty: "3.5" },
      ],
    });
    const { results } = await pushV2(dSc, [command]);
    const item = asAccepted(results[0]!);
    expect(item.result).toMatchObject({ countId: world.countId, status: "DRAFT", lines: 2 });
    expect(item.entity).toMatchObject({ id: world.countId, version: 1 });

    // The counted quantities landed on the session's lines (itemId-keyed).
    const rows = await withTenant(TENANT, async () => {
      const result = await requireTenantContext().tx!.execute(sql`
        SELECT l.item_id AS "itemId", l.counted_qty AS "countedQty"
        FROM stock_count_lines l
        WHERE l.stock_count_id = ${world.countId}::uuid
        ORDER BY l.line_no
      `);
      return result.rows as unknown as { itemId: string; countedQty: string | null }[];
    });
    const byItem = new Map(rows.map((row) => [row.itemId, row.countedQty]));
    expect(byItem.get(world.itemA)).toBe("8.000000");
    expect(byItem.get(world.itemB)).toBe("3.500000");

    expect(await feedCount("stock_counts", world.countId)).toBeGreaterThanOrEqual(1);
    const offline = await offlineAudit("inventory.stock_count_lines_offline_submitted", world.countId);
    expect(offline?.n).toBe(1);
    expect(offline?.deviceId).toBe(dSc);

    // C-01 replay: duplicate, values unchanged (no second execution).
    const replay = asAccepted((await pushV2(dSc, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    const after = await withTenant(TENANT, async () => {
      const result = await requireTenantContext().tx!.execute(sql`
        SELECT l.counted_qty AS "countedQty", l.version
        FROM stock_count_lines l WHERE l.stock_count_id = ${world.countId}::uuid ORDER BY l.line_no
      `);
      return result.rows as unknown as { countedQty: string | null; version: number }[];
    });
    expect(after.map((row) => row.countedQty)).toEqual(["8.000000", "3.500000"]);
  });

  it("21. stock_count:submit_lines — zod REJECT (negative counted qty): VALIDATION_ERROR, zero residue", async () => {
    // A fresh uncounted session (the main one is fully counted after test 20).
    const freshCount = await withTenant(TENANT, () =>
      stockCounts.create({
        warehouseId: world.warehouseAId,
        blind: false,
        itemIds: [world.itemA],
        note: "DI zod count",
        noteAr: null,
        actorId: OWNER,
      }),
    );
    const { results } = await pushV2(dSc, [
      v2("stock_count", "submit_lines", "di-sc-zod-2", {
        countId: freshCount.id,
        lines: [{ itemId: world.itemA, countedQty: "-1" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/stock_count:submit_lines payload rejected by the contract/);
    const stillNull = await oneRow(sql`
      SELECT count(*)::int AS n FROM stock_count_lines
      WHERE stock_count_id = ${freshCount.id}::uuid AND counted_qty IS NULL
    `);
    expect(Number(stillNull?.n)).toBe(1);
  });

  it("22. stock_count:submit_lines — business rule (non-DRAFT session): typed STOCK_COUNT_STATE_INVALID → the existing VALIDATION_ERROR mapping, zero residue", async () => {
    // A session the server already moved past DRAFT (cancelled online).
    const closedCount = await withTenant(TENANT, async () => {
      const created = await stockCounts.create({
        warehouseId: world.warehouseBId,
        blind: false,
        itemIds: [world.itemB],
        note: "DI closed count",
        noteAr: null,
        actorId: OWNER,
      });
      await stockCounts.cancel(created.id, OWNER);
      return created;
    });
    const { results } = await pushV2(dSc, [
      v2("stock_count", "submit_lines", "di-sc-rule-3", {
        countId: closedCount.id,
        lines: [{ itemId: world.itemB, countedQty: "1" }],
      }),
    ]);
    const item = asRejected(results[0]!);
    expect(item.reason).toBe("VALIDATION_ERROR");
    expect(item.message).toMatch(/entry needs DRAFT/);
    const stillNull = await oneRow(sql`
      SELECT count(*)::int AS n FROM stock_count_lines
      WHERE stock_count_id = ${closedCount.id}::uuid AND counted_qty IS NULL
    `);
    expect(Number(stillNull?.n)).toBe(1);
  });

  // -- frozen feed-group scope sanity (MASTER-PLAN §5) ---------------------------

  it("23. feed-group pullability — the new entity types are NOT in the desktop group; the offline partner IS", async () => {
    // None of the new types is pullable by a desktop-class device (the
    // frozen 020 scope: desktop = POS group + sales_invoices).
    await expect(
      withTenant(TENANT, () => pull({ entityType: "quotations", cursor: null, deviceId: dDesk })),
    ).rejects.toThrow(/not pulled/i);
    await expect(
      withTenant(TENANT, () => pull({ entityType: "delivery_notes", cursor: null, deviceId: dDesk })),
    ).rejects.toThrow(/not pulled/i);
    await expect(
      withTenant(TENANT, () => pull({ entityType: "stock_counts", cursor: null, deviceId: dDesk })),
    ).rejects.toThrow(/not pulled/i);

    // partners IS in the group: the offline-created partner (test 1)
    // reaches a desktop pull through the partners feed.
    const partnerId = (globalThis as { __diPartnerId?: string }).__diPartnerId!;
    const envelope = await withTenant(TENANT, () =>
      pull({ entityType: "partners", cursor: null, limit: 1000, deviceId: dDesk }),
    );
    expect(envelope.changes.some((change) => change.id === partnerId)).toBe(true);
  });
});
