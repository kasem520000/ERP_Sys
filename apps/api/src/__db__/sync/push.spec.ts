import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { requireTenantContext } from "../../infra/db/tenant-context";
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
 * PHASE-020 T-P20-2b · push-side db evidence (MASTER-PLAN §6/§14; SYNC
 * PROTOCOL §3/§4 + §6; CONFLICT_RESOLUTION §2/§3): the unified push flow —
 * 016 legacy byte-compat, v2 extensions, inbox dedupe (C-01), partial
 * batches with zero residue (C-03), rejected-result replay, the rate
 * limit (DEFERRED, never executed, never in the inbox), and the
 * device/tenant/contract gates (C-06/C-08/C-14).
 *
 * Tenant TENANT_PUSH (SAR, SA pack — verified unused). The fixture follows
 * the 016 pos golden spec (pos/golden.spec.ts): a sale-able world (branch +
 * warehouse + items with opening stock + STD tax + a cash-account-bound
 * ACTIVE terminal), devices enrolled directly (platform rows), services
 * instantiated exactly as the module graph wires them.
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
function asRejected(item: { status: string }): Extract<import("@erp/contracts").PushItemResultV2, { status: "REJECTED" }> {
  if (item.status !== "REJECTED") {
    throw new Error(`expected a REJECTED item, got ${item.status}`);
  }
  return item as Extract<import("@erp/contracts").PushItemResultV2, { status: "REJECTED" }>;
}

/** Narrow an item to its ACCEPTED variant (typed access to result). */
function asAccepted(item: { status: string }): Extract<import("@erp/contracts").PushItemResultV2, { status: "ACCEPTED" }> {
  if (item.status !== "ACCEPTED") {
    throw new Error(`expected an ACCEPTED item, got ${item.status}`);
  }
  return item as Extract<import("@erp/contracts").PushItemResultV2, { status: "ACCEPTED" }>;
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

// The suite's devices (generated UUIDv7 — never fixed ids, MASTER-PLAN §0).
let d1 = "";
let dRev = "";

async function countInvoices(): Promise<number> {
  return withTenant(TENANT_PUSH, async () => {
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM sales_invoices`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function countJournals(): Promise<number> {
  return withTenant(TENANT_PUSH, async () => {
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM journal_entries`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function countInbox(deviceId: string): Promise<number> {
  return withTenant(TENANT_PUSH, async () => {
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM inbox_commands WHERE device_id = ${deviceId}::uuid`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function pushLegacy(deviceId: string, commands: unknown[]) {
  return withTenant(TENANT_PUSH, () =>
    push.push({ deviceId, batchId: generateUuidV7(), commands }),
  );
}

async function pushV2(
  deviceId: string,
  commands: unknown[],
  contractVersion: string = SYNC_CONTRACT_VERSION,
) {
  return withTenant(TENANT_PUSH, () =>
    push.push({ deviceId, batchId: generateUuidV7(), commands, contractVersion }),
  );
}

/** The 016 command object (posSaleCommandSchema shape). */
function legacySale(input: {
  id: string;
  key: string;
  offline: string;
  date: string;
  item?: string;
  unitPrice?: string;
  tender?: string;
}) {
  const unitPrice = input.unitPrice ?? "100.000000";
  const qty = "1";
  const net = Number(unitPrice);
  return {
    type: "pos_sale" as const,
    id: input.id,
    idempotencyKey: input.key,
    createdAt: "2026-02-01T08:00:00Z",
    sale: {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: input.offline,
      invoiceDate: input.date,
      customerId: null,
      orderType: "COUNTER" as const,
      checkId: null,
      lines: [
        {
          itemId: input.item ?? world.itemA,
          qty,
          unitPrice,
          taxCodeId: world.taxStd,
        },
      ],
      tenders: [{ method: "CASH" as const, amount: input.tender ?? `${(net * 1.15).toFixed(4)}` }],
    },
  };
}

/** A v2 command envelope (syncCommandSchema shape). */
function v2(
  entityType: string,
  intent: string,
  key: string,
  payload: unknown,
  extra?: { baseVersion?: number; commandId?: string },
) {
  return {
    commandId: extra?.commandId ?? generateUuidV7(),
    entityType,
    intent,
    idempotencyKey: key,
    ...(extra?.baseVersion !== undefined ? { baseVersion: extra.baseVersion } : {}),
    clientCreatedAt: "2026-02-01T08:00:00Z",
    payload,
  };
}

function salePayload(input: { offline: string; date: string; item?: string }) {
  return {
    sale: {
      clientId: generateUuidV7(),
      terminalId: world.terminalId,
      offlineReceiptNo: input.offline,
      invoiceDate: input.date,
      customerId: null,
      orderType: "COUNTER" as const,
      checkId: null,
      lines: [
        { itemId: input.item ?? world.itemA, qty: "1", unitPrice: "100.000000", taxCodeId: world.taxStd },
      ],
      tenders: [{ method: "CASH" as const, amount: "115.0000" }],
    },
  };
}

/** Lock + later reopen the December 2026 period (the PERIOD_LOCKED shape). */
async function withDecemberLocked<T>(fn: () => Promise<T>): Promise<T> {
  const periodStore = await import("../../modules/accounting/infrastructure/accounting.store");
  const period = await withTenant(TENANT_PUSH, () =>
    periodStore.findPeriodForDate("2026-12-05"),
  );
  expect(period).toBeDefined();
  await withTenant(TENANT_PUSH, () => periods.softClose(PUSH_ACTOR, period!.id));
  await withTenant(TENANT_PUSH, () => periods.lock(PUSH_ACTOR, period!.id));
  try {
    return await fn();
  } finally {
    await withTenant(TENANT_PUSH, () =>
      periods.reopen(PUSH_ACTOR, period!.id, "PHASE-020 push.spec December reopen"),
    );
  }
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
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { insertAccountPurpose } = tenancyStore;
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
    // The POS posting chain: G-02 (revenue + VAT) + G-03 COGS + the G-16
    // opening leg (INVENTORY · OPENING_EQUITY).
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("COGS", "5100");
    await mapPurpose("OPENING_EQUITY", "3100");
    await mapPurpose("AR_CONTROL", "1130");
    const cashGl = (await byCode("1111")).id;

    // FY2026 spans the whole timeline (February sales + December locks).
    const existingYear = await accountingStore.findFiscalYearByName("FY2026");
    const yearId =
      existingYear?.id ??
      (await periods.createYear(PUSH_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
    void yearId;

    // Branch + warehouse + the cash till.
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

    // The standard customer (unlimited credit).
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

    // SA registration + the STD code (15% STANDARD_RATED).
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

    // Items A (base 100) + B (base 40).
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

    // The till (G-02 cash leg).
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

    // The ACTIVE terminal bound to the till + warehouse (the golden.spec
    // shape).
    const terminalId = "eeeeeeee-0000-4000-8000-000000000001";
    await tx.execute(sql`
      INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id,
                                 warehouse_id, receipt_size, status)
      VALUES (${terminalId}, erp.current_tenant_id(), 'T1', 'Push Terminal 1', ${main.id},
              ${cashAccountId}, ${wh.id}, '80mm', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'
    `);

    // Devices: D1 (the primary pos-terminal) + D_REV (revoked in-test).
    const enroll = (id: string, userId: string) => tx.execute(sql`
      INSERT INTO devices (id, user_id, platform, name, device_key_hash)
      VALUES (${id}::uuid, ${userId}::uuid, 'pos-terminal', ${`device-${id}`}, ${`key-${id}`})
      ON CONFLICT (id) DO NOTHING
    `);
    d1 = generateUuidV7();
    dRev = generateUuidV7();
    await enroll(d1, PUSH_CASHIER);
    await enroll(dRev, PUSH_CASHIER);

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

  // Opening stock (superuser): A ×50 @60 + B ×25 @25 — the W-1 seed sized
  // for this suite (delta-based asserts never see absolute stock).
  const su2 = await superuserClient();
  await su2.query(
    `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
     VALUES
       ('eeeeeeee-0000-4000-8000-0000000000a1', $1, 'STOCK', $2, 50, 60.000000, 'SAR', 'DRAFT'),
       ('eeeeeeee-0000-4000-8000-0000000000b1', $1, 'STOCK', $3, 25, 25.000000, 'SAR', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PUSH, world.itemA, world.itemB],
  );
  await su2.end();
  await withTenant(TENANT_PUSH, async () => {
    await openingStock.post({ warehouseId: world.warehouseId, actorId: PUSH_ACTOR });
  });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-020 push (T-P20-2b): unified flow", () => {
  it("1. legacy 016 batch: ACCEPTED with EXACTLY the 016 field set (no v2 leaks)", async () => {
    const command = legacySale({
      id: generateUuidV7(),
      key: "push-legacy-1",
      offline: "OFF-T1-10001",
      date: "2026-02-10",
    });
    const before = await countInvoices();
    const { results } = await pushLegacy(d1, [command]);
    expect(results).toHaveLength(1);
    const item = results[0]!;
    // The 016 field set exactly — byte-compat (§11 rule 3).
    expect(item).toEqual({
      id: command.id,
      status: "ACCEPTED",
      idempotencyKey: "push-legacy-1",
      result: {
        invoiceId: expect.any(String),
        officialNo: expect.stringMatching(/^POS-[A-Z0-9]+-\d{4}-\d{5}$/),
        offlineReceiptNo: "OFF-T1-10001",
        journalEntryId: expect.any(String),
        replay: false,
      },
    });
    // No v2-only fields leak on the legacy path.
    for (const field of ["commandId", "duplicate", "entity", "officialNumber", "effects", "resubmittable", "localized", "retryAfterMs"]) {
      expect(item).not.toHaveProperty(field);
    }
    expect(await countInvoices()).toBe(before + 1);

    // The ledger: settlement + COGS journals for the posted invoice.
    const invoiceId = asAccepted(item).result.invoiceId as string;
    const journals = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT count(*)::int AS n FROM journal_entries WHERE source_type = 'sales_invoice' AND source_id = ${invoiceId}::uuid`,
      ),
    );
    expect((journals.rows as unknown as { n: number }[])[0]!.n).toBe(2);
  });

  it("2. v2 pos_sale: ACCEPTED + commandId + entity + officialNumber + effects; result parity with legacy", async () => {
    const command = v2(
      "pos_sale",
      "create",
      "push-v2-2",
      salePayload({ offline: "OFF-T1-10002", date: "2026-02-10" }),
    );
    const { results } = await pushV2(d1, [command]);
    const item = asAccepted(results[0]!);
    expect(item.status).toBe("ACCEPTED");
    expect(item.commandId).toBe(command.commandId);
    // The row version the feed marker carries (a posted POS invoice sits at
    // version 3: insert + APPROVED + POSTED — the handler reads the real
    // row version, never a guess).
    expect(item.entity).toMatchObject({ id: expect.any(String), version: expect.any(Number) });
    expect(item.officialNumber).toMatch(/^POS-/);
    expect(item.effects).toMatchObject({
      journalEntryIds: [expect.any(String)],
    });
    // Result parity with the legacy path — the same five 016 fields, the
    // same service underneath.
    expect(Object.keys(item.result).sort()).toEqual(
      ["invoiceId", "journalEntryId", "officialNo", "offlineReceiptNo", "replay"].sort(),
    );

    // The feed marker entry for the invoice (same-tx feed write).
    const feed = await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`SELECT count(*)::int AS n FROM change_log WHERE entity_type = 'sales_invoices' AND entity_id = ${item.entity!.id}::text`,
      ),
    );
    expect((feed.rows as unknown as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("3. C-01 duplicates: same v2 command ×3 deliveries + a cross-key redelivery → 1 invoice, 1 journal pair, byte-equal replays", async () => {
    const command = v2(
      "pos_sale",
      "create",
      "push-v2-3",
      salePayload({ offline: "OFF-T1-10003", date: "2026-02-10" }),
    );
    const invoicesBefore = await countInvoices();
    const journalsBefore = await countJournals();

    const first = asAccepted((await pushV2(d1, [command])).results[0]!);
    expect(first.status).toBe("ACCEPTED");
    expect(first).not.toHaveProperty("duplicate");

    // Delivery 2 + 3: the same command object, different batches.
    const second = (await pushV2(d1, [command])).results[0]!;
    const third = (await pushV2(d1, [command])).results[0]!;
    for (const replay of [second, third]) {
      expect(replay.status).toBe("ACCEPTED");
      expect(replay.duplicate).toBe(true);
      const { duplicate: _dropped, ...rest } = replay;
      void _dropped;
      expect(rest).toEqual(first);
    }

    // Delivery 4: a DIFFERENT commandId carrying the same idempotencyKey —
    // the idempotency_key lookup path (SYNC_PROTOCOL §4.1).
    const rekeyed = v2(
      "pos_sale",
      "create",
      "push-v2-3",
      salePayload({ offline: "OFF-T1-10003", date: "2026-02-10" }),
      { commandId: generateUuidV7() },
    );
    const fourth = (await pushV2(d1, [rekeyed])).results[0]!;
    expect(fourth.duplicate).toBe(true);
    expect(fourth.id).toBe(first.id);

    // Exactly-once: one invoice, one journal pair (settlement + COGS).
    expect(await countInvoices()).toBe(invoicesBefore + 1);
    expect(await countJournals()).toBe(journalsBefore + 2);
  });

  it("4. C-03 partial batch: #3 PERIOD_LOCKED → 1,2,4,5 committed, #3 typed reject, zero residue", async () => {
    const invoicesBefore = await countInvoices();
    const journalsBefore = await countJournals();
    const commands = [1, 2, 3, 4, 5].map((n) =>
      v2(
        "pos_sale",
        "create",
        `push-v2-4-${n}`,
        salePayload({
          offline: `OFF-T1-2000${n}`,
          date: n === 3 ? "2026-12-05" : "2026-02-11",
        }),
      ),
    );
    const { results } = await withDecemberLocked(async () => pushV2(d1, commands));
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
    expect(rejected.localized).toMatchObject({
      ar: expect.any(String),
      en: expect.any(String),
    });
    // Zero residue: the savepoint rolled #3's partial draft back — exactly
    // 4 invoices and 8 journal entries (2 per accepted sale).
    expect(await countInvoices()).toBe(invoicesBefore + 4);
    expect(await countJournals()).toBe(journalsBefore + 8);
  });

  it("5. inbox replay of REJECTED: a rejected command redelivered → same rejection + duplicate:true", async () => {
    const command = v2(
      "pos_sale",
      "create",
      "push-v2-5",
      salePayload({ offline: "OFF-T1-30001", date: "2026-12-05" }),
    );
    const invoicesBefore = await countInvoices();
    const first = await withDecemberLocked(async () => (await pushV2(d1, [command])).results[0]!);
    expect(first).toMatchObject({ status: "REJECTED", reason: "PERIOD_LOCKED" });
    // The redelivery (period still locked) replays the STORED rejection.
    const replay = await withDecemberLocked(async () => (await pushV2(d1, [command])).results[0]!);
    expect(replay.duplicate).toBe(true);
    const { duplicate: _dropped, ...rest } = replay;
    void _dropped;
    expect(rest).toEqual(first);
    // Nothing executed across both deliveries.
    expect(await countInvoices()).toBe(invoicesBefore);
    // The rejection IS in the inbox (status REJECTED rows replay).
    expect(await countInbox(d1)).toBeGreaterThanOrEqual(1);
  });

  it("6. rate limit: burst past the bucket → DEFERRED RATE_LIMITED, nothing executed, nothing in the inbox", async () => {
    // A fresh device: the bucket starts full (burst 20).
    const dRate = generateUuidV7();
    await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(sql`
        INSERT INTO devices (id, user_id, platform, name, device_key_hash)
        VALUES (${dRate}::uuid, ${PUSH_CASHIER}::uuid, 'pos-terminal', ${`device-${dRate}`}, ${`key-${dRate}`})
        ON CONFLICT (id) DO NOTHING
      `),
    );
    const invoicesBefore = await countInvoices();
    let deferredAt = -1;
    let accepted = 0;
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const command = v2(
        "pos_sale",
        "create",
        `push-rate-${attempt}`,
        salePayload({ offline: `OFF-T1-4000${attempt}`, date: "2026-02-12" }),
      );
      const { results } = await pushV2(dRate, [command]);
      const item = results[0]!;
      if (item.status === "DEFERRED") {
        expect(item.reason).toBe("RATE_LIMITED");
        expect(item.retryAfterMs).toBe(5000);
        expect(item.message).toMatch(/rate limit/i);
        deferredAt = attempt;
        break;
      }
      expect(item.status).toBe("ACCEPTED");
      accepted += 1;
    }
    expect(accepted).toBeGreaterThan(0);
    expect(deferredAt).toBeGreaterThan(0);

    // The DEFERRED push executed nothing and recorded no inbox row.
    const inboxBefore = await countInbox(dRate);
    expect(inboxBefore).toBe(accepted);
    const { results } = await pushV2(dRate, [
      v2("pos_sale", "create", "push-rate-deferred", salePayload({ offline: "OFF-T1-40099", date: "2026-02-12" })),
    ]);
    expect(results[0]!.status).toBe("DEFERRED");
    expect(await countInbox(dRate)).toBe(inboxBefore);
    expect(await countInvoices()).toBe(invoicesBefore + accepted);
  });

  it("7. revoked device: all items DEVICE_REVOKED, zero invoices, zero inbox rows", async () => {
    await withTenant(TENANT_PUSH, () =>
      requireTenantContext().tx!.execute(
        sql`UPDATE devices SET revoked_at = now() WHERE id = ${dRev}::uuid`,
      ),
    );
    const invoicesBefore = await countInvoices();
    const { results } = await pushV2(dRev, [
      v2("pos_sale", "create", "push-revoked-1", salePayload({ offline: "OFF-T1-50001", date: "2026-02-13" })),
      v2("pos_sale", "create", "push-revoked-2", salePayload({ offline: "OFF-T1-50002", date: "2026-02-13" })),
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
    expect(await countInvoices()).toBe(invoicesBefore);
    expect(await countInbox(dRev)).toBe(0);
  });

  it("8. contract gate: an unsupported contractVersion → all items CONTRACT_VERSION_UNSUPPORTED, nothing executed", async () => {
    const inboxBefore = await countInbox(d1);
    const invoicesBefore = await countInvoices();
    const { results } = await pushV2(d1, [
      v2("pos_sale", "create", "push-contract-1", salePayload({ offline: "OFF-T1-60001", date: "2026-02-13" })),
      v2("pos_sale", "create", "push-contract-2", salePayload({ offline: "OFF-T1-60002", date: "2026-02-13" })),
    ], "1999-01-01.1");
    expect(results).toHaveLength(2);
    for (const raw of results) {
      const item = asRejected(raw);
      expect(item).toMatchObject({
        status: "REJECTED",
        reason: "CONTRACT_VERSION_UNSUPPORTED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect((item as { message?: string }).message).toMatch(/1999-01-01\.1/);
    }
    expect(await countInvoices()).toBe(invoicesBefore);
    expect(await countInbox(d1)).toBe(inboxBefore);
  });

  it("9. tenant suspended: all items TENANT_SUSPENDED; restore → the same commands EXECUTE (no inbox poisoning)", async () => {
    const suClient = await superuserClient();
    await suClient.query(`UPDATE tenants SET status = 'SUSPENDED' WHERE id = $1`, [TENANT_PUSH]);
    await suClient.end();
    try {
      const invoicesBefore = await countInvoices();
      const inboxBefore = await countInbox(d1);
      const command = v2(
        "pos_sale",
        "create",
        "push-suspended-1",
        salePayload({ offline: "OFF-T1-70001", date: "2026-02-13" }),
      );
      const gated = asRejected((await pushV2(d1, [command])).results[0]!);
      expect(gated).toMatchObject({
        status: "REJECTED",
        reason: "TENANT_SUSPENDED",
        resubmittable: false,
        action: "CANCEL_WITH_REASON",
      });
      expect(gated.localized).toMatchObject({ ar: expect.any(String), en: expect.any(String) });
      expect(await countInvoices()).toBe(invoicesBefore);
      // Never in the inbox — the gate is a retryable state, not a verdict.
      expect(await countInbox(d1)).toBe(inboxBefore);
    } finally {
      const restore = await superuserClient();
      await restore.query(`UPDATE tenants SET status = 'ACTIVE' WHERE id = $1`, [TENANT_PUSH]);
      await restore.end();
    }
    // C-14 resume: the unacked command redelivered after restore EXECUTES
    // (ACCEPTED, not a duplicate) — the suspended rejection was not poison.
    const command2 = v2(
      "pos_sale",
      "create",
      "push-suspended-1",
      salePayload({ offline: "OFF-T1-70001", date: "2026-02-13" }),
    );
    const resumed = (await pushV2(d1, [command2])).results[0]!;
    expect(resumed.status).toBe("ACCEPTED");
    expect(resumed).not.toHaveProperty("duplicate");
  });
});
