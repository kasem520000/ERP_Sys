import { sql } from "drizzle-orm";
import { generateUuidV7 } from "@erp/domain-core";
import {
  SYNC_CONTRACT_VERSION,
  type PullEnvelope,
  type PushItemResult,
  type PushItemResultV2,
} from "@erp/contracts";

import { ensureTestDb, superuserClient } from "../test-db";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
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
import { pull } from "../../modules/sync/application/pull-service";
import { loadDevice } from "../../modules/sync/application/feed-groups";
import { ReconciliationService } from "../../modules/sync/application/reconciliation-service";
import type { SyncTransport } from "../../../../../packages/sync-core/src/client";

/**
 * PHASE-020 T-P20-3b · the chaos-matrix shared substrate (MASTER-PLAN §14;
 * SYNC_TESTS §1/§6): the pos-world fixture (the push.spec golden shape,
 * factored so each suite owns its OWN tenant), the in-process harness
 * transport (HTTP-shaped calls straight into the pull/push services with
 * tenant context — no HTTP layer; the services carry the same semantics),
 * and the LEDGER ORACLES:
 *
 * - INV-013 per-source journal uniqueness — no two journal entries share
 *   (source_type, source_id, operation): the exactly-once guarantee under
 *   duplicate delivery;
 * - INV-001/002 balance — every journal entry's debits equal its credits;
 * - INV-018 stock/journal atomicity — every sales-invoice stock issue is
 *   journal-linked and every posted POS invoice with a COGS journal has
 *   its stock moves (or neither exists);
 * - INV-009/010 subledger equality — the AR control account balance equals
 *   the open partner subledger items (no phantom AR from pushed commands);
 * - honest-state — official numbers exist only on POSTED invoices (the
 *   PENDING_SYNC/REJECTED vocabulary is client-side; the server never
 *   hands an official number to a rejected command).
 *
 * Underscore-prefixed on purpose: `vitest.db.config.ts` collects only
 * `*.spec.ts` files under `src/__db__/`, so this module is a plain helper
 * (never a spec), imported by chaos-matrix/duplicates/push-isolation/
 * device-security.
 */

// -- the seeded world -----------------------------------------------------------------

/** The sale-able world each suite seeds inside its OWN tenant. */
export interface PosWorld {
  tenant: string;
  /** Owner-role actor (period locks, opening stock, admin plane). */
  actor: string;
  /** The pos-terminal device user (cashier). */
  cashier: string;
  /** The desktop device user (drafts). */
  salesRep: string;
  branchId: string;
  warehouseId: string;
  customerId: string;
  /** STOCK item, base 100, on-hand 100 @60. */
  itemA: string;
  /** STOCK item, base 40, on-hand 50 @25. */
  itemB: string;
  /** STOCK item deactivated server-side (status INACTIVE — ITEM_INACTIVE). */
  itemInactive: string;
  taxStd: string;
  cashAccountId: string;
  terminalId: string;
}

export interface PosWorldSeed {
  tenant: string;
  /** Tenant display names (Arabic + English). */
  name: string;
  nameAr: string;
  /** Fixture code/sku prefix (keeps per-tenant rows distinct). */
  prefix: string;
  actor: string;
  cashier: string;
  salesRep: string;
}

/**
 * Seed the pos world (push.spec.ts's fixture body, idempotent): tenant +
 * users + owner-role membership, master-data basics + CoA template + the
 * POS posting purposes, FY2026, branch/warehouse/customer/tax/items, the
 * till + ACTIVE terminal, and opening stock (A ×100 @60 + B ×50 @25).
 */
export async function seedPosWorld(seed: PosWorldSeed): Promise<PosWorld> {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, $2, $3, 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [seed.tenant, seed.name, seed.nameAr],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, $4, $5, 'x', 'ACTIVE'),
       ($2, $6, $7, 'x', 'ACTIVE'),
       ($3, $8, $9, 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [
      seed.actor,
      seed.cashier,
      seed.salesRep,
      `${seed.prefix.toLowerCase()}-actor@fixture.test`,
      `${seed.prefix} Actor`,
      `${seed.prefix.toLowerCase()}-cashier@fixture.test`,
      `${seed.prefix} Cashier`,
      `${seed.prefix.toLowerCase()}-sales@fixture.test`,
      `${seed.prefix} Sales`,
    ],
  );
  // One tenant role cloned from the system `owner` template (the 0005
  // cross-join grants every non-platform key — sync.* included).
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES
       ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, seed.tenant, `${seed.prefix.toLowerCase()}_owner`, `${seed.prefix} Owner`, "المالك"],
  );
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner' LIMIT 1`,
  );
  if (template.rows[0] !== undefined) {
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, seed.tenant, template.rows[0].id],
    );
  }
  for (const userId of [seed.actor, seed.cashier, seed.salesRep]) {
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, tenant_id) DO NOTHING`,
      [generateUuidV7(), seed.tenant, userId, roleId],
    );
  }
  await su.end();

  const world: PosWorld = {
    tenant: seed.tenant,
    actor: seed.actor,
    cashier: seed.cashier,
    salesRep: seed.salesRep,
    branchId: "",
    warehouseId: "",
    customerId: "",
    itemA: "",
    itemB: "",
    itemInactive: "",
    taxStd: "",
    cashAccountId: "",
    terminalId: generateUuidV7(),
  };

  await withTenant(seed.tenant, async () => {
    const tx = requireTenantContext().tx!;
    const { seedMasterDataBasics, provisionCoaTemplate, listBranches, insertBranch } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const { insertAccountPurpose } = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const taxCodes = new TaxCodesService(new AuditService(new DrizzleAuditStore()));
    const registrations = new RegistrationService(new AuditService(new DrizzleAuditStore()));
    const periods = new PeriodService(new AuditService(new DrizzleAuditStore()));
    const treasuryAccounts = new AccountService(new AuditService(new DrizzleAuditStore()));
    const warehouses = new WarehouseService(new AuditService(new DrizzleAuditStore()));
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
      await insertAccountPurpose({
        purposeKey,
        accountId: (await byCode(code)).id,
        activeFrom: "2025-12-01",
      });
      return (await byCode(code)).id;
    };
    // The POS posting chain: G-02 (revenue + VAT) + G-03 COGS + the G-16
    // opening leg + AR control (the subledger oracle's account).
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("COGS", "5100");
    await mapPurpose("OPENING_EQUITY", "3100");
    await mapPurpose("AR_CONTROL", "1130");
    const cashGl = (await byCode("1111")).id;

    // FY2026 spans the whole timeline (February sales + December locks).
    const existingYear = await accountingStore.findFiscalYearByName("FY2026");
    if (existingYear === undefined) {
      await periods.createYear(seed.actor, {
        name: "FY2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
    }

    const branches = await listBranches(null);
    const main =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    world.branchId = main.id;
    const existingWarehouses = await warehouses.list({ limit: 10, activeOnly: false });
    const wh =
      existingWarehouses.find((w) => w.code === `${seed.prefix}-WH`) ??
      (await warehouses.create({
        branchId: main.id,
        code: `${seed.prefix}-WH`,
        name: `${seed.prefix} warehouse`,
        nameAr: "مستودع الاختبار",
        inventoryAccountId: null,
        note: null,
        actorId: seed.actor,
      }));
    world.warehouseId = wh.id;

    const existingCustomer = await partnersStore.findPartnerByCode(`${seed.prefix}-CUST-01`);
    world.customerId =
      existingCustomer?.id ??
      (await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: `${seed.prefix}-CUST-01`,
        name: "شركة الاختبار",
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
        actorId: seed.actor,
        note: "chaos fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    world.taxStd =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (await taxCodes.create({
        code: "STD",
        name: "Standard (SA)",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "STANDARD_RATED",
        actorId: seed.actor,
      })).id;

    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, basePrice: string | null) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      return (await itemsStore.insertItem({
        sku,
        name: `${seed.prefix} ${sku}`,
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
    world.itemA = await ensureItem(`${seed.prefix}-A`, "100.000000");
    world.itemB = await ensureItem(`${seed.prefix}-B`, "40.000000");
    world.itemInactive = await ensureItem(`${seed.prefix}-INA`, "10.000000");
    // The deactivated item: status INACTIVE (live row — the ITEM_INACTIVE
    // gate), never soft-deleted (that is the tombstone leg's item).
    await tx.execute(sql`
      UPDATE items SET status = 'INACTIVE', updated_at = now()
      WHERE id = ${world.itemInactive}::uuid AND status = 'ACTIVE'
    `);

    const existingAccounts = await treasuryAccounts.list({});
    const cash =
      existingAccounts.find((a) => a.name === `${seed.prefix} cash`) ??
      (await treasuryAccounts.open({
        name: `${seed.prefix} cash`,
        nameAr: "صندوق الاختبار",
        type: "CASH",
        accountId: cashGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: seed.actor,
      }));
    world.cashAccountId = cash.id;

    await tx.execute(sql`
      INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id,
                                 warehouse_id, receipt_size, status)
      VALUES (${world.terminalId}, erp.current_tenant_id(), 'T1', ${`${seed.prefix} Terminal 1`},
              ${world.branchId}, ${world.cashAccountId}, ${world.warehouseId}, '80mm', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'
    `);
  });

  // Opening stock (superuser seeds the DRAFT docs; the service posts them
  // in the tenant scope): A ×100 @60 + B ×50 @25.
  const su2 = await superuserClient();
  const existingOpening = await su2.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM opening_balance_docs WHERE tenant_id = $1`,
    [seed.tenant],
  );
  if (existingOpening.rows[0]!.n === 0) {
    await su2.query(
      `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
       VALUES ($1, $3, 'STOCK', $4, 100, 60.000000, 'SAR', 'DRAFT'),
              ($2, $3, 'STOCK', $5, 50, 25.000000, 'SAR', 'DRAFT')`,
      [generateUuidV7(), generateUuidV7(), seed.tenant, world.itemA, world.itemB],
    );
  }
  await su2.end();
  await withTenant(seed.tenant, async () => {
    const openingStock = new OpeningStockService(
      new AuditService(new DrizzleAuditStore()),
      new PostingService(new AuditService(new DrizzleAuditStore()), new PartnerSubledgerService()),
    );
    await openingStock.post({ warehouseId: world.warehouseId, actorId: seed.actor });
  });
  return world;
}

// -- the service graph + devices --------------------------------------------------------

/** The full sync-facing service graph (the module wiring, spec-instantiated). */
export interface SyncServices {
  audit: AuditService;
  invoices: SalesInvoiceService;
  posSales: PosSaleService;
  periods: PeriodService;
  reconciliation: ReconciliationService;
  push: PushService;
}

/** Instantiate the services exactly as the module graph wires them (the
 * push.spec pattern — PushService's constructor wires the handler slots).
 * PHASE-021 · DR-P21-08: the seven desktop write intents' owning services
 * join the graph (the additive constructor slots).
 * PHASE-022 · DR-P22-06: the three field write intents' owning services
 * join the same way (receipts + allocations, the van stock service, the
 * credit-note service). */
export function makeSyncServices(): SyncServices {
  const audit = new AuditService(new DrizzleAuditStore());
  const posting = new PostingService(audit, new PartnerSubledgerService());
  const numbering = new NumberingService(audit);
  const resolver = new TaxResolverService();
  const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
  const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
  const posSales = new PosSaleService(audit, invoices, creditNotes);
  const shiftFlow = new PosShiftFlowService(audit, new ShiftService(audit, posting));
  const periods = new PeriodService(audit);
  const reconciliation = new ReconciliationService(audit);
  const partners = new PartnerService(audit);
  const quotations = new QuotationService(audit, numbering);
  const deliveries = new DeliveryNoteService(audit, posting, numbering);
  const pettyCash = new PettyCashGuard(audit);
  const expenses = new ExpenseService(audit, posting, numbering, pettyCash, resolver);
  const treasuryTransfers = new TreasuryTransferService(audit, posting, numbering, pettyCash);
  const inventoryTransfers = new InventoryTransferService(audit, posting, numbering);
  const stockCounts = new CountService(audit, posting, numbering);
  // PHASE-022 · DR-P22-06: the three field write intents' owning services.
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
  return { audit, invoices, posSales, periods, reconciliation, push };
}

/** Enroll a device row directly (the devices.spec fixture shape: devices is
 * service-mediated — no tenant_id; the tenant context rides withTenant).
 * PHASE-022 · DR-P22-05a: `linkedPartnerId` seeds the personal-account
 * linkage (migration 0033 — the registration surface that writes it in
 * production is task 2-b's; the specs seed the column directly, the
 * desktop-intents precedent). */
export async function enrollDevice(
  tenant: string,
  userId: string,
  options?: {
    deviceClass?: string;
    revoked?: boolean;
    contractVersion?: string;
    linkedPartnerId?: string;
  },
): Promise<string> {
  const deviceId = generateUuidV7();
  const platform =
    options?.deviceClass === "tauri-desktop"
      ? "DESKTOP"
      : options?.deviceClass === "android-field" || options?.deviceClass === "android-personal"
        ? "ANDROID"
        : "pos-terminal";
  await withTenant(tenant, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`
      INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class,
                           contract_version, revoked_at, linked_partner_id)
      VALUES (${deviceId}::uuid, ${userId}::uuid, ${platform},
              ${`chaos-device-${deviceId.slice(0, 8)}`}, ${`key-${deviceId}`},
              ${options?.deviceClass ?? null}, ${options?.contractVersion ?? null},
              ${options?.revoked === true ? sql`now()` : sql`NULL`},
              ${options?.linkedPartnerId ?? null})
      ON CONFLICT (id) DO NOTHING
    `);
  });
  return deviceId;
}

// -- command builders -------------------------------------------------------------------

/** A v2 command envelope (the syncCommandSchema shape). */
export function v2Command(
  entityType: string,
  intent: string,
  key: string,
  payload: unknown,
  extra?: {
    baseVersion?: number;
    commandId?: string;
    clientCreatedAt?: string;
    /** D-03b byte-budget injection: an over-cap localRef rides the
     * envelope RAW (the batch byte check fires before per-item parse). */
    localRef?: string;
  },
) {
  return {
    commandId: extra?.commandId ?? generateUuidV7(),
    entityType,
    intent,
    idempotencyKey: key,
    ...(extra?.baseVersion !== undefined ? { baseVersion: extra.baseVersion } : {}),
    clientCreatedAt: extra?.clientCreatedAt ?? "2026-02-01T08:00:00Z",
    ...(extra?.localRef !== undefined ? { localRef: extra.localRef } : {}),
    payload,
  };
}

/** The v2 pos_sale payload ({sale: …} — the inner 016 shape). */
export function posSalePayload(
  world: PosWorld,
  input: {
    offline: string;
    date: string;
    item?: string;
    qty?: string;
    unitPrice?: string;
    terminalId?: string;
    clientId?: string;
  },
) {
  const unitPrice = input.unitPrice ?? "100.000000";
  const qty = input.qty ?? "1";
  const net = Number(unitPrice) * Number(qty);
  return {
    sale: {
      clientId: input.clientId ?? generateUuidV7(),
      terminalId: input.terminalId ?? world.terminalId,
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
      tenders: [{ method: "CASH" as const, amount: `${(net * 1.15).toFixed(4)}` }],
    },
  };
}

// -- the harness transport (MASTER-PLAN §14: the in-process adapter) ---------------------

/**
 * The in-process SyncTransport: HTTP-shaped calls straight into the pull +
 * push services inside `withTenant` — the real server semantics without
 * the HTTP layer. `statusContractVersion` overrides the advertised
 * contract version (the C-08 fault injection: a server the device cannot
 * talk to).
 */
export class HarnessTransport implements SyncTransport {
  readonly pullCalls: { entityType: string; cursor: string | null }[] = [];
  readonly pushCalls: { commandCount: number }[] = [];
  readonly pullAcks: { entityType: string; cursor: string }[] = [];
  readonly pushAcks: string[][] = [];

  constructor(
    private readonly deps: { tenant: string; deviceId: string; push: PushService },
    private readonly overrides?: { statusContractVersion?: string },
  ) {}

  async status(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }> {
    if (this.overrides?.statusContractVersion !== undefined) {
      // The C-08 injection: the server advertises a contract the device's
      // compiled-in list does not support (a server upgraded past v(n-1)).
      return {
        serverTime: new Date().toISOString(),
        contractVersion: this.overrides.statusContractVersion,
        device: { revoked: false },
      };
    }
    return withTenant(this.deps.tenant, async () => {
      const device = await loadDevice(this.deps.deviceId);
      const tx = requireTenantContext().tx!;
      const rows = await tx.execute(
        sql`SELECT status FROM tenants WHERE id = erp.current_tenant_id() LIMIT 1`,
      );
      const tenantStatus = (rows.rows as unknown as { status: string }[])[0]?.status ?? "ACTIVE";
      return {
        serverTime: new Date().toISOString(),
        contractVersion: SYNC_CONTRACT_VERSION,
        suspended: tenantStatus !== "ACTIVE",
        device: { revoked: (device?.revokedAt ?? null) !== null },
      };
    });
  }

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    this.pullCalls.push({ entityType, cursor });
    const envelope = await withTenant(this.deps.tenant, () =>
      pull({ entityType, cursor, limit, deviceId: this.deps.deviceId }),
    );
    // The sync-core transport type carries a mutable changes array (the
    // pull service's is readonly) — copy once at the adapter seam.
    return { ...envelope, changes: [...envelope.changes] };
  }

  async push(
    batchId: string,
    commands: readonly Record<string, unknown>[],
  ): Promise<PushItemResult[]> {
    this.pushCalls.push({ commandCount: commands.length });
    const { results } = await withTenant(this.deps.tenant, () =>
      this.deps.push.push({ deviceId: this.deps.deviceId, batchId, commands: [...commands] }),
    );
    return results as unknown as PushItemResult[];
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]> {
    this.pushCalls.push({ commandCount: request.commands.length });
    const { results } = await withTenant(this.deps.tenant, () =>
      this.deps.push.push({
        deviceId: this.deps.deviceId,
        contractVersion: request.contractVersion,
        commands: [...request.commands],
      }),
    );
    return results;
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    this.pullAcks.push(...positions.map((position) => ({ ...position })));
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    this.pushAcks.push([...commandIds]);
  }
}

// -- the ledger oracles (MASTER-PLAN §14; SYNC_TESTS §6) --------------------------------

async function scalar(tenant: string, query: ReturnType<typeof sql>): Promise<number> {
  return withTenant(tenant, async () => {
    const rows = await requireTenantContext().tx!.execute(query);
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

export function countInvoices(tenant: string): Promise<number> {
  return scalar(tenant, sql`SELECT count(*)::int AS n FROM sales_invoices`);
}

export function countJournals(tenant: string): Promise<number> {
  return scalar(tenant, sql`SELECT count(*)::int AS n FROM journal_entries`);
}

export function countJournalLines(tenant: string): Promise<number> {
  return scalar(tenant, sql`SELECT count(*)::int AS n FROM journal_lines`);
}

export function countStockMoves(tenant: string): Promise<number> {
  return scalar(tenant, sql`SELECT count(*)::int AS n FROM stock_moves`);
}

export function countInbox(tenant: string, deviceId: string): Promise<number> {
  return scalar(
    tenant,
    sql`SELECT count(*)::int AS n FROM inbox_commands WHERE device_id = ${deviceId}::uuid`,
  );
}

/** Journal entries produced by one source document (INV-013's per-source
 * uniqueness input: a POS sale posts settlement + COGS = exactly 2). */
export function journalCountForSource(
  tenant: string,
  sourceType: string,
  sourceId: string,
): Promise<number> {
  return scalar(
    tenant,
    sql`SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = ${sourceType} AND source_id = ${sourceId}::uuid`,
  );
}

/**
 * INV-013 — per-source journal uniqueness: any (source_type, source_id,
 * operation) triple carried by MORE THAN ONE entry is a double-post.
 * Expect empty.
 */
export async function inv013Violations(tenant: string): Promise<string[]> {
  return withTenant(tenant, async () => {
    const rows = await requireTenantContext().tx!.execute(sql`
      SELECT source_type || ':' || source_id || ':' || operation AS k
      FROM journal_entries
      WHERE source_id IS NOT NULL
      GROUP BY source_type, source_id, operation
      HAVING count(*) > 1
    `);
    return (rows.rows as unknown as { k: string }[]).map((row) => row.k);
  });
}

/**
 * INV-001/002 — balance: every posted entry's debits equal its credits
 * (base currency). Expect empty.
 */
export async function unbalancedJournalEntries(tenant: string): Promise<string[]> {
  return withTenant(tenant, async () => {
    const rows = await requireTenantContext().tx!.execute(sql`
      SELECT je.id::text AS k
      FROM journal_entries je
      JOIN journal_lines l ON l.journal_entry_id = je.id
      GROUP BY je.id
      HAVING sum(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE 0 END)::numeric(19,4)
          <> sum(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE 0 END)::numeric(19,4)
    `);
    return (rows.rows as unknown as { k: string }[]).map((row) => row.k);
  });
}

/**
 * INV-018 — stock/journal atomicity: every sales-invoice stock issue is
 * journal-linked (posted_journal_id set) and every POSTED POS invoice with
 * a COGS journal carries its stock moves (or neither exists). Expect
 * empty.
 */
export async function inv018Violations(tenant: string): Promise<string[]> {
  return withTenant(tenant, async () => {
    const rows = await requireTenantContext().tx!.execute(sql`
      SELECT 'unjournaled-move:' || sm.id::text AS k
      FROM stock_moves sm
      WHERE sm.source_type = 'sales_invoice' AND sm.posted_journal_id IS NULL
      UNION ALL
      SELECT 'cogs-without-moves:' || si.id::text AS k
      FROM sales_invoices si
      WHERE si.channel = 'POS' AND si.status = 'POSTED'
        AND si.posted_cogs_journal_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_moves sm
          WHERE sm.source_type = 'sales_invoice' AND sm.source_id = si.id
        )
    `);
    return (rows.rows as unknown as { k: string }[]).map((row) => row.k);
  });
}

/** INV-009/010 — the AR control account balance equals the open partner
 * subledger items (no phantom AR; trivially 0 = 0 on cash-only tenants —
 * the point is pushed commands never drift it). */
export async function arSubledgerTie(tenant: string): Promise<{
  ok: boolean;
  control: string;
  subledger: string;
}> {
  return withTenant(tenant, async () => {
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const purpose = await accountingStore.findActivePurpose("AR_CONTROL");
    if (purpose === undefined) {
      return { ok: true, control: "0", subledger: "0" };
    }
    const journalStore = await import("../../modules/accounting/infrastructure/journal.store");
    const partners = await journalStore.listPartnersWithSubledger();
    const control = await journalStore.controlAccountBalance(purpose.accountId);
    const subledger = await journalStore.partnerSubledgerBalance(
      partners.map((partner) => partner.partnerId),
    );
    return { ok: control === subledger, control, subledger };
  });
}

/** Honest-state server leg — an official number exists ONLY on POSTED
 * invoices (a rejected/pending command never received one). */
export async function unpostedInvoicesWithNumbers(tenant: string): Promise<string[]> {
  return withTenant(tenant, async () => {
    const rows = await requireTenantContext().tx!.execute(sql`
      SELECT id::text AS k FROM sales_invoices
      WHERE status <> 'POSTED' AND invoice_no IS NOT NULL
    `);
    return (rows.rows as unknown as { k: string }[]).map((row) => row.k);
  });
}

/**
 * The composite oracle: every invariant holds for the whole tenant — the
 * chaos scenarios assert this after every fault they inject.
 */
export async function ledgerOraclesHold(tenant: string): Promise<void> {
  expectInTest(await inv013Violations(tenant)).toEqual([]);
  expectInTest(await unbalancedJournalEntries(tenant)).toEqual([]);
  expectInTest(await inv018Violations(tenant)).toEqual([]);
  expectInTest(await unpostedInvoicesWithNumbers(tenant)).toEqual([]);
  const tie = await arSubledgerTie(tenant);
  expectInTest(tie.ok).toBe(true);
}

// A tiny local expect wrapper so the oracle can assert without importing
// vitest into a non-spec module (keep the helper dependency-free: on
// mismatch throw a loud Error — vitest surfaces it as the test failure).
function expectInTest(actual: unknown) {
  return {
    toEqual(want: unknown): void {
      if (JSON.stringify(actual) !== JSON.stringify(want)) {
        throw new Error(`ledger oracle failed: got ${JSON.stringify(actual)}, want ${JSON.stringify(want)}`);
      }
    },
    toBe(want: unknown): void {
      if (actual !== want) {
        throw new Error(`ledger oracle failed: got ${String(actual)}, want ${String(want)}`);
      }
    },
  };
}
