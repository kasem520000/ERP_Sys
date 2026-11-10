import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient, appClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { stopBoss } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { OpeningStockService } from "../../modules/inventory/application/opening-stock-service";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { ContractService } from "../../modules/crm/application/contract-service";
import { ServiceOrderService } from "../../modules/crm/application/service-order-service";
import { ServiceOrderPosting } from "../../modules/crm/application/service-order-posting";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as crmStore from "../../modules/crm/infrastructure/crm.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import type { Server } from "node:net";
import type { Client } from "pg";

/**
 * PHASE-019 T48 db evidence (MASTER-PLAN §7 + §15 service-order chain):
 * the job-card lifecycle generalized to the crm module, pinned to the §15
 * golden numbers on a dedicated tenant (6c6c6c6c — SAR; verified unused
 * across the repo before adoption). Real services, real PostingService,
 * real movement core; zero direct GL/stock writes:
 *
 *  1. The §15 issue_immediate golden — SO with 1 SERVICE line (3 h @
 *     150.000000) + 1 PARTS line (STOCK item, qty 2, warehouse W-SO with
 *     stock @ 50.000000 WAC): create → SO- number; approve (issue_immediate)
 *     → J-COGS [DR COGS 100.0000 · CR INVENTORY 100.0000] (source
 *     service_order:issue_parts; stock on-hand reduced by the delta; moves
 *     sourced `service_order`); logHours; complete; invoice → the invoice
 *     POSTED + J-SO [DR AR 724.5000 · CR SALES_REVENUE 180.0000 (parts
 *     2×90) · CR SERVICE_REVENUE 450.0000 (3×150) · CR VAT 67.5000 +
 *     27.0000] (the ordinary chain's settlement ordering; the parts tax
 *     rides the ITEM row — the T47 precedent); the SO INVOICED + per-line
 *     invoice_line_id (positional 1:1, verified by itemId) + the W-3 issue
 *     snapshot copied onto the invoice parts line.
 *  2. The contract-linked variant — identical journals (contract linkage
 *     does NOT alter any journal — §7) + invoice.contract_id set.
 *  3. reserve mode — holds at approval (holderType SERVICE_ORDER), the
 *     with-goods invoice at completion (settlement + COGS at the invoice's
 *     own post), holds consumed at invoice; cancel releases the holds.
 *  4. Lifecycle guards — typed errors for every off-lifecycle move; the
 *     DRAFT full-replace; the atomic INSUFFICIENT_STOCK rollback.
 *  5. HTTP rows 37–45 through the real AppModule pipeline.
 */

const TENANT = "6c6c6c6c-6c6c-6c6c-6c6c-6c6c6c6c6c6c";
const ACTOR = "6c6c6c6c-0000-4000-8000-0000000006c1";
const HTTP_PASSWORD = "service-orders-t48-strong-passphrase-9";
const HTTP_EMAIL = "c48-service-orders@fixture.test";

// -- the service graph (constructed manually — §18 lesson 6) ----------------

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const reservations = new ReservationService(audit);
const port = new ServiceOrderPosting(posting, invoices, reservations);
const service = new ServiceOrderService(audit, numbering);
service.setPostingPort(port);
const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const contracts = new ContractService(audit, posting, numbering, resolveConfig);
const periods = new PeriodService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new RegistrationService(audit);
const warehouses = new WarehouseService(audit);
const openingStock = new OpeningStockService(audit, posting);

// -- fixture ids (resolved in beforeAll) --------------------------------------

let PARTNER = "";
let BRANCH = "";
let WAREHOUSE = "";
let SO_SVC = "";
let SO_PART = "";
let STD_TAX = "";
let CONTRACT = "";
const GL = {
  arControl: "",
  salesRevenue: "",
  serviceRevenue: "",
  vatPayable: "",
  cogs: "",
  inventory: "",
  openingEquity: "",
};

/** The issue_immediate golden's journals (set in describe 1; the
 * contract-linked variant asserts line-for-line equality against them). */
let goldenSettlement: Line[] | undefined;
let goldenCogs: Line[] | undefined;

// -- helpers -------------------------------------------------------------------

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

/** The tenant-scoped app client (RLS world) for read assertions. */
async function cClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT]);
  return client;
}

/** The invoice row of an order (the inverted linkage — the invoice carries
 * service_order_id; 0027's service_orders has no invoice_id column). */
interface OrderInvoice {
  id: string;
  status: string;
  kind: string;
  warehouseId: string | null;
  contractId: string | null;
  serviceOrderId: string | null;
  invoiceNo: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  postedJournalId: string | null;
  postedCogsJournalId: string | null;
}

async function invoiceOfOrder(orderId: string): Promise<OrderInvoice> {
  const client = await cClient();
  const result = await client.query<OrderInvoice>(
    `SELECT id, status, kind, warehouse_id AS "warehouseId", contract_id AS "contractId",
            service_order_id AS "serviceOrderId", invoice_no AS "invoiceNo",
            total_net::text AS "totalNet", total_tax::text AS "totalTax",
            total_gross::text AS "totalGross", posted_journal_id AS "postedJournalId",
            posted_cogs_journal_id AS "postedCogsJournalId"
     FROM sales_invoices WHERE service_order_id = $1 LIMIT 1`,
    [orderId],
  );
  await client.end();
  const row = result.rows[0];
  if (row === undefined) throw new Error(`no invoice row for order ${orderId}`);
  return row;
}

async function countJournals(): Promise<number> {
  return withTenant(TENANT, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM journal_entries`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function stockOf(itemId: string): Promise<{ qty: string; avgCost: string }> {
  const row = await withTenant(TENANT, () =>
    inventoryStore.findItemStock(itemId, WAREHOUSE),
  );
  if (row === undefined) throw new Error(`no stock row for ${itemId}`);
  return { qty: row.qty, avgCost: row.avgCost };
}

async function movesFor(sourceType: string, sourceId: string) {
  const moves = await withTenant(TENANT, () =>
    inventoryStore.listStockMoves({ sourceType, sourceId, limit: 50 }),
  );
  return moves.filter((move) => move.sourceId === sourceId);
}

/** Audit actions for one entity (the leads.spec read pattern). */
async function auditActions(entityType: string, entityId: string): Promise<string[]> {
  const client = await cClient();
  const result = await client.query<{ action: string }>(
    `SELECT action FROM audit_events WHERE entity_type = $1 AND entity_id = $2 ORDER BY at`,
    [entityType, entityId],
  );
  await client.end();
  return result.rows.map((row) => row.action);
}

interface LineInput {
  /** Preserved on the DRAFT full-replace (PUT); ignored on create. */
  id?: string | null;
  lineType: "SERVICE" | "PARTS";
  itemId: string;
  qty: string | null;
  unitPrice: string | null;
  estimatedHours: string | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

const serviceLine = (): LineInput => ({
  lineType: "SERVICE",
  itemId: SO_SVC,
  qty: null,
  unitPrice: "150",
  estimatedHours: "3",
  description: "Consulting hours",
  descriptionAr: "ساعات استشارة",
  note: null,
});

const partsLine = (qty = "2", unitPrice = "90"): LineInput => ({
  lineType: "PARTS",
  itemId: SO_PART,
  qty,
  unitPrice,
  estimatedHours: null,
  description: "Materials",
  descriptionAr: "مواد",
  note: null,
});

async function createOrder(input?: { contractId?: string | null; lines?: readonly LineInput[] }) {
  return withTenant(TENANT, () =>
    service.create({
      branchId: BRANCH,
      partnerId: PARTNER,
      contractId: input?.contractId ?? null,
      warehouseId: WAREHOUSE,
      note: "the §15 service-order chain",
      noteAr: null,
      actorId: ACTOR,
      lines: input?.lines ?? [serviceLine(), partsLine()],
    }),
  );
}

// -- the HTTP pipeline (the contracts.spec real-AppModule pattern) --------------

let httpBase = "";
let httpShutdown: (() => Promise<void>) | undefined;
let httpToken = "";

interface ApiReply {
  status: number;
  body: { data?: unknown; error?: { code: string; message: string } };
}

async function httpCall(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<ApiReply> {
  const hasBody = body !== undefined && method !== "GET";
  const headers: Record<string, string> = { "x-session-token": httpToken };
  if (hasBody) headers["content-type"] = "application/json";
  if (method === "POST") headers["idempotency-key"] = generateUuidV7();
  const response = await fetch(`${httpBase}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as ApiReply["body"]) };
}

// -- bootstrap -------------------------------------------------------------------

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant C48 (service orders)', 'المستأجر س٤٨', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT],
  );
  const { PasswordService } = await import("../../modules/identity/application/password-service");
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, $2, 'C48 Service Orders Owner', $3, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR, HTTP_EMAIL, await new PasswordService().hashFromNewPassword(HTTP_PASSWORD)],
  );
  // The owner role over the global template's permission set (0027 seeded
  // crm.service_orders.manage for it) + the BR-039 feature entitlements —
  // the FULL BR-040 dependency closure for crm.service_orders (a partial
  // grant fails the resolve-layer validation: the template-prerequisites
  // spec's closure rule).
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, 'owner', 'Owner', 'المالك')`,
    [roleId, TENANT],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
    [roleId, TENANT, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT, ACTOR, roleId],
  );
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES (gen_random_uuid(), $1, 'crm.service_orders', 'MANUAL'),
            (gen_random_uuid(), $1, 'crm.service_contracts', 'MANUAL'),
            (gen_random_uuid(), $1, 'inventory.stock_ledger', 'MANUAL'),
            (gen_random_uuid(), $1, 'inventory.multi_warehouse', 'MANUAL'),
            (gen_random_uuid(), $1, 'platform.branches', 'MANUAL'),
            (gen_random_uuid(), $1, 'platform.tenant_lifecycle', 'MANUAL'),
            (gen_random_uuid(), $1, 'items.item_master', 'MANUAL'),
            (gen_random_uuid(), $1, 'partners.directory', 'MANUAL'),
            (gen_random_uuid(), $1, 'platform.onboarding', 'MANUAL'),
            (gen_random_uuid(), $1, 'platform.registration', 'MANUAL')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [TENANT],
  );
  await su.end();

  await withTenant(TENANT, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate(); // maps the standard purposes (§15's 5100/1140/…)

    // §15 purposes (the job-card-posting fixture set + OPENING_EQUITY for
    // the opening-stock leg): AR_CONTROL 1130, SALES_REVENUE 4100,
    // SERVICE_REVENUE 4200, VAT_PAYABLE 2120, COGS 5100, INVENTORY 1140.
    const byCode = async (code: string) => {
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account.id;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await accountingStore.findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const accountId = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId, activeFrom: "2025-12-01" });
      return accountId;
    };
    GL.inventory = await mapPurpose("INVENTORY", "1140");
    GL.arControl = await mapPurpose("AR_CONTROL", "1130");
    GL.salesRevenue = await mapPurpose("SALES_REVENUE", "4100");
    GL.serviceRevenue = await mapPurpose("SERVICE_REVENUE", "4200");
    GL.vatPayable = await mapPurpose("VAT_PAYABLE", "2120");
    GL.cogs = await mapPurpose("COGS", "5100");
    GL.openingEquity = await mapPurpose("OPENING_EQUITY", "3100");

    // FY2026 spans the whole test timeline (today's posts need an OPEN
    // period; the SO- series keys on the creation year).
    if ((await accountingStore.findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    // Branch MAIN + warehouse W-SO (§15: parts issue from W-SO).
    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    BRANCH = mainBranch.id;
    WAREHOUSE = (
      await warehouses.create({
        branchId: mainBranch.id,
        code: "W-SO",
        name: "Service orders warehouse",
        nameAr: "مستودع أوامر الخدمة",
        inventoryAccountId: null,
        note: null,
        actorId: ACTOR,
      })
    ).id;

    // §15: partner P-000001 (CUSTOMER, credit terms 30d).
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    PARTNER = (
      await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-000001",
        name: "Gulf Advisory Group",
        nameAr: "مجموعة الخليج للاستشارات",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: net30.id,
        priceListId: null,
      })
    ).id;

    // Tax registration (SA pack, REGISTERED) + the STD 15% code.
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: ACTOR,
        note: "service-orders fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    STD_TAX =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (
        await taxCodes.create({
          code: "STD",
          name: "Standard (SA)",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "STANDARD_RATED",
          actorId: ACTOR,
        })
      ).id;

    // Items: SO-SVC (SERVICE, bills 150/h) + SO-PART (STOCK, sells @ 90).
    // The item row carries the tax code — SO lines have no tax column, so
    // the invoice lines resolve it from the ITEM (the T47 precedent).
    const uoms = await itemsStore.listUoms();
    const hr = uoms.find((u) => u.code === "HR") ?? uoms[0]!;
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    SO_SVC = (
      await itemsStore.insertItem({
        sku: "SO-SVC",
        name: "Advisory hours",
        nameAr: "ساعات استشارية",
        kind: "SERVICE",
        uomId: hr.id,
        categoryId: null,
        taxCodeId: STD_TAX,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "150.000000",
      })
    ).id;
    SO_PART = (
      await itemsStore.insertItem({
        sku: "SO-PART",
        name: "Materials kit",
        nameAr: "طقم مواد",
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: STD_TAX,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "90.000000",
      })
    ).id;
  });

  // Opening stock at W-SO: SO-PART ×100 @ 50.000000 WAC — the §15 seed
  // (stock asserts are delta-based, never absolute, so the size is
  // invisible to the goldens — the sales-fixture convention).
  const su2 = await superuserClient();
  await su2.query(
    `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
     VALUES ($1, $2, 'STOCK', $3, 100, 50.000000, 'SAR', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT, SO_PART],
  );
  await su2.end();
  await withTenant(TENANT, () => openingStock.post({ warehouseId: WAREHOUSE, actorId: ACTOR }));

  // The ACTIVE contract for the contract-linked variant (§15: identical
  // journals — linkage never alters one; the real ContractService path).
  const created = await withTenant(TENANT, () =>
    contracts.create({
      partnerId: PARTNER,
      projectId: null,
      title: "Advisory retainer 2026 (T48 fixture)",
      titleAr: null,
      scope: "The contract-linked service-order variant",
      feeModel: "RETAINER",
      startDate: "2026-01-15",
      endDate: "2026-06-14",
      monthlyAmount: "1000",
      feeItemId: SO_SVC,
      milestones: null,
      currencyCode: null,
      note: "T48 contract-linked fixture",
      noteAr: null,
      actorId: ACTOR,
    }),
  );
  CONTRACT = (
    await withTenant(TENANT, () => contracts.activate(created.contract.id, ACTOR))
  ).contract.id;

  // The real pipeline: full AppModule + HTTP listener on a free port.
  const { NestFactory } = await import("@nestjs/core");
  const { AppModule } = await import("../../app.module");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  httpShutdown = async () => {
    await server.close();
  };
  const login = await fetch(`${httpBase}/api/v1/identity/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: HTTP_EMAIL, password: HTTP_PASSWORD }),
  });
  expect(login.status).toBe(200);
  httpToken = ((await login.json()) as { data: { token: string } }).data.token;
}, 180_000);

afterAll(async () => {
  if (httpShutdown !== undefined) {
    await httpShutdown();
  }
  await stopBoss();
  await closeDb();
});

// ---------------------------------------------------------------------------

describe("the §15 service-order chain (issue_immediate golden)", () => {
  let G1 = "";
  let partsLineId = "";
  let serviceLineId = "";

  it("create → the SO- number at creation + DRAFT + PENDING lines", async () => {
    const order = await createOrder();
    G1 = order.id;
    expect(order.status).toBe("DRAFT");
    expect(order.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
    expect(order.contractId).toBeNull();
    expect(order.warehouseId).toBe(WAREHOUSE);

    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(G1));
    expect(lines).toHaveLength(2);
    const serviceRow = lines.find((l) => l.lineType === "SERVICE")!;
    const partsRow = lines.find((l) => l.lineType === "PARTS")!;
    expect(serviceRow.status).toBe("PENDING");
    expect(serviceRow.estimatedHours).toBe("3.000000");
    expect(serviceRow.unitPrice).toBe("150.000000");
    expect(serviceRow.qty).toBe("1.000000"); // the line count — billing rides estimatedHours
    expect(serviceRow.loggedHours).toBe("0.000000");
    expect(partsRow.status).toBe("PENDING");
    expect(partsRow.qty).toBe("2.000000");
    expect(partsRow.unitPrice).toBe("90.000000");
    expect(partsRow.estimatedHours).toBeNull();
    serviceLineId = serviceRow.id;
    partsLineId = partsRow.id;
    expect(await auditActions("service_order", G1)).toContain("crm.service_order.created");
  });

  it("approve (issue_immediate) → J-COGS exact + the stock delta + per-line snapshots", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(SO_PART);

    const approved = await withTenant(TENANT, () =>
      service.approve(G1, { partsIssueMode: "issue_immediate", actorId: ACTOR }),
    );
    expect(approved.status).toBe("IN_PROGRESS");
    expect(approved.approvedAt).not.toBeNull();

    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(G1));
    const parts = lines.find((l) => l.lineType === "PARTS")!;
    const serviceRow = lines.find((l) => l.lineType === "SERVICE")!;
    expect(parts.status).toBe("ISSUED");
    expect(parts.issueJournalId).not.toBeNull();
    expect(parts.issueUnitCost).toBe("50.000000");
    expect(parts.issueValue).toBe("100.0000");
    expect(parts.reservationId).toBeNull(); // the reservation absence
    expect(serviceRow.status).toBe("PENDING"); // SERVICE lines untouched by the issue

    const issueJournal = await withTenant(TENANT, () =>
      journal.findEntryBySourceKey("service_order", G1, "issue_parts"),
    );
    expect(issueJournal).toBeDefined();
    expect(issueJournal!.id).toBe(parts.issueJournalId);
    goldenCogs = await withTenant(TENANT, () => journalLinesOf(issueJournal!.id));
    expect(goldenCogs).toEqual([
      { accountId: GL.cogs, direction: "DEBIT", amount: "100.0000" },
      { accountId: GL.inventory, direction: "CREDIT", amount: "100.0000" },
    ]);

    const moves = await movesFor("service_order", G1);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.qty).toBe("2.000000");
    expect(moves[0]!.valueAmount).toBe("100.0000");

    const stockAfter = await stockOf(SO_PART);
    expect(stockAfter.qty).toBe(`${Number(stockBefore.qty) - 2}.000000`);
    expect(stockAfter.avgCost).toBe(stockBefore.avgCost); // issues never move the average
    expect(await countJournals()).toBe(journalsAtStart + 1);
  });

  it("INV-013: re-running issuePartsImmediate with all lines ISSUED is a no-op", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(SO_PART);
    await withTenant(TENANT, () => port.issuePartsImmediate(G1, ACTOR));
    expect(await countJournals()).toBe(journalsAtStart);
    expect((await movesFor("service_order", G1)).length).toBe(1);
    expect((await stockOf(SO_PART)).qty).toBe(stockBefore.qty);
  });

  it("logHours on the SERVICE line accumulates; on the PARTS line → typed", async () => {
    const first = await withTenant(TENANT, () =>
      service.logHours(G1, serviceLineId, { hours: "1.5", actorId: ACTOR }),
    );
    expect(first.status).toBe("IN_PROGRESS");
    await withTenant(TENANT, () => service.logHours(G1, serviceLineId, { hours: "0.5", actorId: ACTOR }));
    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(G1));
    expect(lines.find((l) => l.lineType === "SERVICE")!.loggedHours).toBe("2.000000");

    await expect(
      withTenant(TENANT, () => service.logHours(G1, partsLineId, { hours: "1", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_LINE_ERROR" });
    await expect(
      withTenant(TENANT, () => service.logHours(G1, serviceLineId, { hours: "0", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_INPUT_INVALID" });
  });

  it("complete → COMPLETED; invoice → POSTED + J-SO exact + INVOICED + line links 1:1", async () => {
    const completed = await withTenant(TENANT, () => service.complete(G1, { actorId: ACTOR }));
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();

    const invoiced = await withTenant(TENANT, () => service.invoice(G1, { actorId: ACTOR }));
    expect(invoiced.status).toBe("INVOICED");
    expect(invoiced.invoicedAt).not.toBeNull();

    // The order lines: INVOICED + invoice_line_id linked by the port.
    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(G1));
    expect(lines.every((l) => l.status === "INVOICED")).toBe(true);
    expect(lines.every((l) => l.invoiceLineId !== null)).toBe(true);

    // The invoice row (the inverted linkage): revenue-only CREDIT (stock
    // left at approval), the SO provenance pair, exact §15 totals
    // (3×150 + 2×90; 15% VAT per the item-carried STD code).
    const invoice = await invoiceOfOrder(G1);
    expect(invoice.status).toBe("POSTED");
    expect(invoice.kind).toBe("CREDIT");
    expect(invoice.warehouseId).toBeNull(); // revenue-only: no flow-B issue
    expect(invoice.serviceOrderId).toBe(G1);
    expect(invoice.contractId).toBeNull();
    expect(invoice.invoiceNo).toMatch(/^SAL-\d{4}-\d{6}$/);
    expect(invoice.postedCogsJournalId).toBeNull(); // exactly ONE COGS journal over the life
    expect(invoice.totalNet).toBe("630.0000"); // 450 + 180
    expect(invoice.totalTax).toBe("94.5000"); // 67.5 + 27
    expect(invoice.totalGross).toBe("724.5000");

    // The settlement journal EXACTLY: DR AR 724.5 · CR SALES_REVENUE 180
    // (parts — the goods nature) · CR SERVICE_REVENUE 450 (the service
    // nature) · CR VAT 67.5 + 27 (per line, in line order).
    goldenSettlement = await withTenant(TENANT, () => journalLinesOf(invoice.postedJournalId!));
    expect(goldenSettlement).toEqual([
      { accountId: GL.arControl, direction: "DEBIT", amount: "724.5000" },
      { accountId: GL.salesRevenue, direction: "CREDIT", amount: "180.0000" },
      { accountId: GL.serviceRevenue, direction: "CREDIT", amount: "450.0000" },
      { accountId: GL.vatPayable, direction: "CREDIT", amount: "67.5000" },
      { accountId: GL.vatPayable, direction: "CREDIT", amount: "27.0000" },
    ]);

    // No COGS journal exists for this invoice at all (the approval owns it).
    const cogsForInvoice = await withTenant(TENANT, () =>
      journal.findEntryBySourceKey("sales_invoice", invoice.id, "cogs"),
    );
    expect(cogsForInvoice).toBeUndefined();
    // No stock moved at the invoice — only the approval moved it.
    expect(await movesFor("sales_invoice", invoice.id)).toHaveLength(0);

    // The port's order-line ↔ invoice-line mapping: positional 1:1, ids
    // line up, itemId-verified; the W-3 copy rides the invoice parts line.
    const invoiceLines = await withTenant(TENANT, () => sStore.listSalesInvoiceLines(invoice.id));
    expect(invoiceLines).toHaveLength(2);
    expect(new Set(lines.map((l) => l.invoiceLineId))).toEqual(new Set(invoiceLines.map((l) => l.id)));
    const invoicePartsLine = invoiceLines.find((l) => l.itemId === SO_PART)!;
    expect(invoicePartsLine.issueUnitCost).toBe("50.000000");
    expect(invoicePartsLine.issueValue).toBe("100.0000");

    // The audit trail.
    const actions = await auditActions("service_order", G1);
    for (const expected of [
      "crm.service_order.created",
      "crm.service_order.approved",
      "crm.service_order.hours_logged",
      "crm.service_order.completed",
      "crm.service_order.invoiced",
    ]) {
      expect(actions).toContain(expected);
    }
  });

  it("off-lifecycle after INVOICED: second invoice / PUT / cancel → typed SERVICE_ORDER_STATE", async () => {
    await expect(
      withTenant(TENANT, () => service.invoice(G1, { actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_STATE" });
    await expect(
      withTenant(TENANT, () => service.update(G1, { note: "too late", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_STATE" });
    await expect(
      withTenant(TENANT, () => service.cancel(G1, { reason: "never", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_STATE" });
    expect((await withTenant(TENANT, () => service.find(G1))).status).toBe("INVOICED");
  });
});

describe("the contract-linked variant (§15: identical journals)", () => {
  it("an SO with contractId → the same J-COGS + J-SO + invoice.contract_id set", async () => {
    const stockBefore = await stockOf(SO_PART);
    const journalsAtStart = await countJournals();

    const order = await createOrder({ contractId: CONTRACT });
    expect(order.contractId).toBe(CONTRACT);
    expect(order.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);

    await withTenant(TENANT, () =>
      service.approve(order.id, { partsIssueMode: "issue_immediate", actorId: ACTOR }),
    );
    const issueJournal = await withTenant(TENANT, () =>
      journal.findEntryBySourceKey("service_order", order.id, "issue_parts"),
    );
    expect(issueJournal).toBeDefined();
    // The J-COGS is IDENTICAL to the standalone golden's (line-for-line).
    expect(await withTenant(TENANT, () => journalLinesOf(issueJournal!.id))).toEqual(goldenCogs);

    await withTenant(TENANT, () => service.complete(order.id, { actorId: ACTOR }));
    await withTenant(TENANT, () => service.invoice(order.id, { actorId: ACTOR }));

    const invoice = await invoiceOfOrder(order.id);
    expect(invoice.status).toBe("POSTED");
    expect(invoice.contractId).toBe(CONTRACT); // the linkage lands on the invoice row
    expect(invoice.warehouseId).toBeNull();
    expect(invoice.totalGross).toBe("724.5000");

    // The settlement journal is IDENTICAL to the standalone golden's —
    // contract linkage does NOT alter any journal (§7, line-for-line).
    expect(await withTenant(TENANT, () => journalLinesOf(invoice.postedJournalId!))).toEqual(
      goldenSettlement,
    );

    // Stock + journals: exactly the standalone shape's deltas.
    expect((await stockOf(SO_PART)).qty).toBe(`${Number(stockBefore.qty) - 2}.000000`);
    expect(await countJournals()).toBe(journalsAtStart + 2);
  });
});

describe("reserve mode (holds at approval, consumed at invoice, released at cancel)", () => {
  it("approve (reserve) → line RESERVED + a SERVICE_ORDER-held row, no ledger; invoice → with-goods + holds consumed", async () => {
    const stockBefore = await stockOf(SO_PART);
    const journalsAtStart = await countJournals();

    const order = await createOrder();
    const approved = await withTenant(TENANT, () =>
      service.approve(order.id, { partsIssueMode: "reserve", actorId: ACTOR }),
    );
    expect(approved.status).toBe("IN_PROGRESS");

    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(order.id));
    const parts = lines.find((l) => l.lineType === "PARTS")!;
    const serviceRow = lines.find((l) => l.lineType === "SERVICE")!;
    expect(parts.status).toBe("RESERVED");
    expect(parts.reservationId).not.toBeNull();
    expect(serviceRow.status).toBe("PENDING"); // SERVICE lines are never held

    const reservation = await withTenant(TENANT, () =>
      inventoryStore.findReservationById(parts.reservationId!),
    );
    expect(reservation?.holderType).toBe("SERVICE_ORDER");
    expect(reservation?.holderId).toBe(order.id);
    expect(reservation?.status).toBe("ACTIVE");
    expect(reservation?.itemId).toBe(SO_PART);
    expect(reservation?.warehouseId).toBe(WAREHOUSE);
    expect(reservation?.qty).toBe("2.000000");
    // The hold is not a movement: no journal, no stock change.
    expect(await countJournals()).toBe(journalsAtStart);
    expect((await stockOf(SO_PART)).qty).toBe(stockBefore.qty);

    // Completion + the with-goods invoice: the invoice's own post issues
    // stock (COGS journal sales_invoice:cogs) and consumes the hold.
    await withTenant(TENANT, () => service.complete(order.id, { actorId: ACTOR }));
    const invoiced = await withTenant(TENANT, () => service.invoice(order.id, { actorId: ACTOR }));
    expect(invoiced.status).toBe("INVOICED");

    const invoice = await invoiceOfOrder(order.id);
    expect(invoice.status).toBe("POSTED");
    expect(invoice.warehouseId).toBe(WAREHOUSE); // flow B: the invoice issues
    expect(invoice.postedCogsJournalId).not.toBeNull();
    expect(invoice.totalGross).toBe("724.5000");

    // The settlement is the identical golden shape; the COGS journal is the
    // invoice's own (DR COGS 100 · CR INVENTORY 100 at WAC 50).
    expect(await withTenant(TENANT, () => journalLinesOf(invoice.postedJournalId!))).toEqual(
      goldenSettlement,
    );
    expect(
      await withTenant(TENANT, () => journalLinesOf(invoice.postedCogsJournalId!)),
    ).toEqual(goldenCogs);

    const invoiceMoves = await movesFor("sales_invoice", invoice.id);
    expect(invoiceMoves).toHaveLength(1);
    expect(invoiceMoves[0]!.direction).toBe("OUT");
    expect(invoiceMoves[0]!.qty).toBe("2.000000");
    expect(invoiceMoves[0]!.valueAmount).toBe("100.0000");

    // The hold is CONSUMED at the moment the goods leave.
    const consumed = await withTenant(TENANT, () =>
      inventoryStore.findReservationById(parts.reservationId!),
    );
    expect(consumed?.status).toBe("CONSUMED");
    // Stock left at the invoice (not at approval).
    expect((await stockOf(SO_PART)).qty).toBe(`${Number(stockBefore.qty) - 2}.000000`);
    expect(await countJournals()).toBe(journalsAtStart + 2);
  });

  it("cancel under reserve → the ACTIVE holds release, zero ledger, lines VOID", async () => {
    const stockBefore = await stockOf(SO_PART);
    const journalsAtStart = await countJournals();

    const order = await createOrder();
    await withTenant(TENANT, () =>
      service.approve(order.id, { partsIssueMode: "reserve", actorId: ACTOR }),
    );
    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(order.id));
    const parts = lines.find((l) => l.lineType === "PARTS")!;
    expect(parts.reservationId).not.toBeNull();

    const cancelled = await withTenant(TENANT, () =>
      service.cancel(order.id, { reason: "scope changed", actorId: ACTOR }),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(cancelled.cancelReason).toBe("scope changed");

    // The hold is RELEASED; the row stays linked on the line as the trail.
    const released = await withTenant(TENANT, () =>
      inventoryStore.findReservationById(parts.reservationId!),
    );
    expect(released?.status).toBe("RELEASED");

    const afterLines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(order.id));
    expect(afterLines.every((l) => l.status === "VOID")).toBe(true);
    // No ledger ever on a cancel; no stock movement.
    expect(await countJournals()).toBe(journalsAtStart);
    expect((await stockOf(SO_PART)).qty).toBe(stockBefore.qty);
    expect(await auditActions("service_order", order.id)).toContain("crm.service_order.cancelled");
  });
});

describe("lifecycle guards (typed errors + the DRAFT full-replace)", () => {
  it("contractId must exist + be ACTIVE (the crm store read)", async () => {
    await expect(createOrder({ contractId: generateUuidV7() })).rejects.toMatchObject({
      code: "SERVICE_ORDER_INPUT_INVALID",
    });
    // A DRAFT contract (created, never activated) is not linkable.
    const draft = await withTenant(TENANT, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: null,
        title: "Never activated",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-02-01",
        endDate: "2026-03-31",
        monthlyAmount: "500",
        feeItemId: SO_SVC,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    await expect(createOrder({ contractId: draft.contract.id })).rejects.toMatchObject({
      code: "SERVICE_ORDER_INPUT_INVALID",
    });
    // Zero residue: neither attempt wrote an order row.
    const client = await cClient();
    const count = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM service_orders WHERE note = 'the §15 service-order chain' AND contract_id IS NOT NULL`,
    );
    await client.end();
    expect(count.rows[0]!.n).toBe(1); // the one contract-linked success only
  });

  it("line-type mismatches are typed (SERVICE↔STOCK, missing hours/qty)", async () => {
    // SERVICE line referencing a STOCK item.
    await expect(
      createOrder({ lines: [{ ...serviceLine(), itemId: SO_PART }] }),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_LINE_ERROR" });
    // PARTS line referencing a SERVICE item.
    await expect(
      createOrder({ lines: [partsLine(), { ...partsLine(), itemId: SO_SVC }] }),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_LINE_ERROR" });
    // SERVICE line without estimatedHours.
    await expect(
      createOrder({ lines: [{ ...serviceLine(), estimatedHours: null }] }),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_LINE_ERROR" });
    // PARTS line without qty.
    await expect(
      createOrder({ lines: [partsLine(), { ...partsLine(), qty: null }] }),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_LINE_ERROR" });
    // Empty line set.
    await expect(createOrder({ lines: [] })).rejects.toMatchObject({
      code: "SERVICE_ORDER_INPUT_INVALID",
    });
  });

  it("the DRAFT full-replace: preserved ids + renumber + tombstones; PUT after approve → typed", async () => {
    const order = await createOrder();
    const original = await withTenant(TENANT, () => crmStore.listServiceOrderLines(order.id));
    const serviceRow = original.find((l) => l.lineType === "SERVICE")!;

    const updated = await withTenant(TENANT, () =>
      service.update(order.id, {
        note: "edited while DRAFT",
        lines: [
          // The SERVICE line preserved by id, hours replaced (3 → 2.5).
          { ...serviceLine(), id: serviceRow.id, estimatedHours: "2.5" },
          // A NEW parts line (the original parts line is not mentioned →
          // tombstoned VOID).
          partsLine("3", "75"),
        ],
        actorId: ACTOR,
      }),
    );
    expect(updated.status).toBe("DRAFT");
    expect(updated.note).toBe("edited while DRAFT");

    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(order.id));
    const live = lines.filter((l) => l.status !== "VOID");
    const voided = lines.filter((l) => l.status === "VOID");
    expect(live).toHaveLength(2);
    expect(voided).toHaveLength(1);
    expect(voided[0]!.lineType).toBe("PARTS");
    expect(live.map((l) => l.lineNo)).toEqual([1, 2]);
    // The preserved row keeps its id at its new position; hours + logged
    // hours were replaced (the replace never carries work state forward).
    const keptService = live.find((l) => l.lineType === "SERVICE")!;
    expect(keptService.id).toBe(serviceRow.id);
    expect(keptService.lineNo).toBe(1);
    expect(keptService.estimatedHours).toBe("2.500000");
    expect(keptService.loggedHours).toBe("0.000000");
    const newParts = live.find((l) => l.lineType === "PARTS")!;
    expect(newParts.qty).toBe("3.000000");
    expect(newParts.unitPrice).toBe("75.000000");
    expect(newParts.reservationId).toBeNull();

    // After approval the DRAFT-only edit is typed.
    await withTenant(TENANT, () =>
      service.approve(order.id, { partsIssueMode: "reserve", actorId: ACTOR }),
    );
    await expect(
      withTenant(TENANT, () =>
        service.update(order.id, { note: "too late", actorId: ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_STATE" });
    // A line that belongs to another order is refused.
    const other = await createOrder();
    await expect(
      withTenant(TENANT, () =>
        service.update(other.id, {
          lines: [{ ...serviceLine(), id: newParts.id }],
          actorId: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_LINE_ERROR" });
  });

  it("insufficient stock at issue_immediate approval: typed INSUFFICIENT_STOCK, the atomic rollback", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(SO_PART);

    const order = await createOrder({ lines: [serviceLine(), partsLine("5000")] });
    await expect(
      withTenant(TENANT, () =>
        service.approve(order.id, { partsIssueMode: "issue_immediate", actorId: ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    // Zero residue: the order never left DRAFT, no journal, no move.
    const stuck = await withTenant(TENANT, () => service.find(order.id));
    expect(stuck.status).toBe("DRAFT");
    const lines = await withTenant(TENANT, () => crmStore.listServiceOrderLines(order.id));
    expect(lines.every((l) => l.status === "PENDING")).toBe(true);
    expect(lines.every((l) => l.issueJournalId === null && l.reservationId === null)).toBe(true);
    expect(await countJournals()).toBe(journalsAtStart);
    expect(await movesFor("service_order", order.id)).toHaveLength(0);
    expect((await stockOf(SO_PART)).qty).toBe(stockBefore.qty);
  });

  it("unknown ids are typed (A7 parity)", async () => {
    const unknown = generateUuidV7();
    await expect(withTenant(TENANT, () => service.find(unknown))).rejects.toMatchObject({
      code: "SERVICE_ORDER_NOT_FOUND",
    });
    await expect(
      withTenant(TENANT, () => service.approve(unknown, { partsIssueMode: "reserve", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_NOT_FOUND" });
    await expect(
      withTenant(TENANT, () => service.invoice(unknown, { actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "SERVICE_ORDER_NOT_FOUND" });
    // A well-formed uuid that exists nowhere reads identically (A7).
    const lists = await withTenant(TENANT, () =>
      service.list({ contractId: unknown, limit: 10 }),
    );
    expect(lists).toHaveLength(0);
  });
});

describe("HTTP rows 37–45 (the real AppModule pipeline)", () => {
  it("the full lifecycle + the typed guards over HTTP", async () => {
    // Row 37: GET ?status&contractId&limit.
    const listed = await httpCall(
      "GET",
      `/api/v1/crm/service-orders?status=IN_PROGRESS&contractId=${CONTRACT}&limit=5`,
    );
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.data)).toBe(true);

    // Row 38: POST create (the service-order line set).
    const created = await httpCall("POST", "/api/v1/crm/service-orders", {
      branchId: BRANCH,
      partnerId: PARTNER,
      contractId: null,
      warehouseId: WAREHOUSE,
      note: "the HTTP chain",
      noteAr: null,
      lines: [
        { lineType: "SERVICE", itemId: SO_SVC, qty: null, unitPrice: "150", estimatedHours: "3", description: "Consulting hours", descriptionAr: null, note: null },
        { lineType: "PARTS", itemId: SO_PART, qty: "1", unitPrice: "90", estimatedHours: null, description: "Materials", descriptionAr: null, note: null },
      ],
    });
    expect(created.status).toBe(201);
    const H1 = (created.body.data as { id: string; orderNo: string; status: string });
    expect(H1.orderNo).toMatch(/^SO-\d{4}-\d{5}$/);
    expect(H1.status).toBe("DRAFT");

    // Row 39: GET :id.
    const read = await httpCall("GET", `/api/v1/crm/service-orders/${H1.id}`);
    expect(read.status).toBe(200);
    expect((read.body.data as { lines: unknown[] }).lines).toHaveLength(2);

    // Row 40: PUT :id (DRAFT-only) — swap the parts qty to 2.
    const put = await httpCall("PUT", `/api/v1/crm/service-orders/${H1.id}`, {
      note: "edited over HTTP",
      lines: [
        { lineType: "SERVICE", itemId: SO_SVC, qty: null, unitPrice: "150", estimatedHours: "3", description: "Consulting hours", descriptionAr: null, note: null },
        { lineType: "PARTS", itemId: SO_PART, qty: "2", unitPrice: "90", estimatedHours: null, description: "Materials", descriptionAr: null, note: null },
      ],
    });
    expect(put.status).toBe(200);
    expect((put.body.data as { note: string }).note).toBe("edited over HTTP");

    // Row 41: POST :id/approve (reserve default — the with-goods chain).
    const approved = await httpCall("POST", `/api/v1/crm/service-orders/${H1.id}/approve`, {});
    expect(approved.status).toBe(201);
    expect((approved.body.data as { status: string }).status).toBe("IN_PROGRESS");
    // GET :id returns the order WITH lines (findWithLines) — the parts line
    // is RESERVED with its hold linked.
    const afterApprove = await httpCall("GET", `/api/v1/crm/service-orders/${H1.id}`);
    expect(afterApprove.status).toBe(200);
    const approvedLines = (afterApprove.body.data as {
      lines: { lineType: string; status: string; reservationId: string | null; id: string }[];
    }).lines;
    // The PUT replace tombstoned the original pair — the LIVE set is the
    // non-VOID rows (tombstones park at negative line_no and list first).
    const httpParts = approvedLines.find((l) => l.lineType === "PARTS" && l.status !== "VOID")!;
    expect(httpParts.status).toBe("RESERVED");
    expect(httpParts.reservationId).not.toBeNull();

    // Row 42: POST :id/log-hours {lineId, hours}.
    const serviceLineId = approvedLines.find((l) => l.lineType === "SERVICE" && l.status !== "VOID")!.id;
    const logged = await httpCall("POST", `/api/v1/crm/service-orders/${H1.id}/log-hours`, {
      lineId: serviceLineId,
      hours: "2",
    });
    expect(logged.status).toBe(201);

    // Row 43: POST :id/complete.
    const completed = await httpCall("POST", `/api/v1/crm/service-orders/${H1.id}/complete`, {});
    expect(completed.status).toBe(201);
    expect((completed.body.data as { status: string }).status).toBe("COMPLETED");

    // Row 44: POST :id/invoice — the with-goods invoice over HTTP.
    const invoiced = await httpCall("POST", `/api/v1/crm/service-orders/${H1.id}/invoice`, {});
    expect(invoiced.status).toBe(201);
    expect((invoiced.body.data as { status: string }).status).toBe("INVOICED");
    const httpInvoice = await invoiceOfOrder(H1.id);
    expect(httpInvoice.status).toBe("POSTED");
    expect(httpInvoice.warehouseId).toBe(WAREHOUSE);
    expect(httpInvoice.totalGross).toBe("724.5000");

    // Row 45: POST :id/cancel — refused on the invoiced order (typed 409).
    const cancelAttempt = await httpCall("POST", `/api/v1/crm/service-orders/${H1.id}/cancel`, {
      reason: "too late",
    });
    expect(cancelAttempt.status).toBe(409);
    expect(cancelAttempt.body.error?.code).toBe("SERVICE_ORDER_STATE");

    // The typed guards: unknown id 404; malformed line 422.
    const missing = await httpCall("GET", `/api/v1/crm/service-orders/${generateUuidV7()}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("SERVICE_ORDER_NOT_FOUND");
    const malformed = await httpCall("POST", "/api/v1/crm/service-orders", {
      branchId: BRANCH,
      partnerId: PARTNER,
      contractId: null,
      warehouseId: WAREHOUSE,
      note: null,
      noteAr: null,
      lines: [{ lineType: "SERVICE", itemId: SO_SVC, qty: null, unitPrice: "150", estimatedHours: null, description: null, descriptionAr: null, note: null }],
    });
    expect(malformed.status).toBe(422);
    expect(malformed.body.error?.code).toBe("SERVICE_ORDER_LINE_ERROR");
  });
});
