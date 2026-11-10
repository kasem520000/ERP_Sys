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
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { SalesInvoiceService, POLICY_ACTOR_ID } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { ContractService } from "../../modules/crm/application/contract-service";
import { BillingRunService } from "../../modules/crm/application/billing-run-service";
import { DeferralService } from "../../modules/crm/application/deferral-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import * as crmStore from "../../modules/crm/infrastructure/crm.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import type { Server } from "node:net";
import type { Client } from "pg";

/**
 * PHASE-019 T47 db evidence (MASTER-PLAN §5 + §15 + §11 rows 30–31): the
 * recurring billing run over the §15 golden fixtures — the retainer chain
 * (2 drafts @ net 1000.0000 / gross 1150.0000 with 15% VAT, idempotent
 * re-runs, the full 6-period grid), the milestone + hourly chains (the
 * honest timeslip: narrative-less entries listed + skipped), the duplicate
 * guard (a second PLANNED entry claiming an already-guarded periodKey →
 * per-entry savepoint rollback + skippedDuplicate — the concurrent-window
 * simulation), the period-lock refusal (LOCKED June skipped + listed,
 * reopened then billed), the ordinary posting chain (J-INV with the §1
 * row 1 stamps + the partner subledger row same tx + the SAL number), the
 * credit-note cancellation (net-zero pair; the cancelled period never
 * regenerates — the guard row persists), and the auto-submit policy
 * fixture. Rows #30–#31 ride the real AppModule pipeline at the tail.
 *
 * Dedicated tenant 68686868 (SAR; the first-execution family — verified
 * unused). §18 lesson 6: the port is wired on THIS spec's own
 * salesInvoices instance exactly as CrmModule does.
 */

const TENANT_B = "68686868-6868-6868-6868-686868686868";
const ACTOR = "68686868-0000-4000-8000-0000000006b1";
const ACTOR2 = "68686868-0000-4000-8000-0000000006b2";
const HTTP_PASSWORD = "billing-t47-strong-passphrase-9";
const HTTP_EMAIL = "t47-billing@fixture.test";

// -- the service graph (constructed manually — §18 lesson 6) ----------------

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const contracts = new ContractService(audit, posting, numbering, resolveConfig);
const periods = new PeriodService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new RegistrationService(audit);
const inbox = new InboxService();
const deferral = new DeferralService(audit, posting, inbox);
const billingRuns = new BillingRunService(audit, salesInvoices, contracts, resolveConfig);

// §18 lesson 6: wire the contract-billing port on the spec's OWN
// salesInvoices instance exactly as CrmModule's constructor does — or the
// release path never fires under test.
salesInvoices.setContractBillingPort({
  validateContract: async (contractId: string) =>
    (await crmStore.findContractById(contractId)) !== undefined,
  onContractInvoicePosted: (contractId: string, invoiceId: string, actorId: string | null) =>
    deferral.onContractInvoicePosted(contractId, invoiceId, actorId),
});

// -- fixture ids (resolved in beforeAll) --------------------------------------

let PARTNER = "";
let CASE01 = "";
let FEE_RET = "";
let FEE_MIL = "";
let FEE_HR = "";
let TAX_STD = "";

// sequential state across the describes (§16 order discipline)
let C1 = ""; // the §15 retainer chain
let C2 = ""; // the §15 milestone chain
let C3 = ""; // the §15 hourly chain
let C_ROGUE = ""; // the duplicate-window simulation contract
let C_LOCK = ""; // the period-lock contract
let C_AUTO = ""; // the auto-submit policy contract
let JAN_INVOICE = ""; // the January draft (posted in the posting describe)
const C1_INVOICES = new Map<string, string>(); // periodKey → invoiceId

// -- helpers -------------------------------------------------------------------

/** The tenant-scoped app client (RLS world) for read assertions. */
async function bClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_B]);
  return client;
}

/**
 * Upsert a tenant setting with `updated_at = now()` — the resolve cache's
 * fingerprint hashes `key || ':' || updated_at`, so the bump is what makes
 * a mid-suite value flip visible (the setting-reader quirk; T46's helper).
 */
async function setSetting(key: string, value: string | boolean): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TENANT_B, key, JSON.stringify(value)],
  );
  await su.end();
}

async function clearSetting(key: string): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [TENANT_B, key]);
  await su.end();
}

/** The schedule grid mapped to a plain comparable shape. */
async function gridOf(contractId: string) {
  const rows = await withTenant(TENANT_B, () => contracts.listSchedule(contractId));
  return rows.map((row) => ({
    key: row.periodKey,
    type: row.entryType,
    billDate: row.billDate,
    status: row.status,
    invoiceId: row.invoiceId,
  }));
}

/** The contract's guard rows (periodKey/milestone pairs). */
async function guardsOf(contractId: string) {
  const rows = await withTenant(TENANT_B, () =>
    crmStore.listContractInvoices({ contractId, limit: 100 }),
  );
  return rows.map((row) => ({ periodKey: row.periodKey, milestoneScheduleId: row.milestoneScheduleId }));
}

/** Journal lines as a comparable shape (account code + the §1 stamps). */
async function linesOf(entryId: string) {
  const rows = await withTenant(TENANT_B, () => journal.listLines(entryId));
  return rows.map((row) => ({
    accountCode: row.accountCode,
    direction: row.direction,
    amount: row.amount,
    partnerId: row.partnerId,
    projectId: row.projectId,
  }));
}

/** A 23505-shaped failure (the guard's constraint class — the pg error
 * rides the drizzle wrapper's cause chain). */
async function expectUniqueViolation(violating: () => Promise<unknown>): Promise<void> {
  const error: unknown = await violating().then(
    () => undefined,
    (cause: unknown) => cause,
  );
  let matched = false;
  let candidate: unknown = error;
  for (let depth = 0; depth < 5 && candidate !== null && candidate !== undefined; depth += 1) {
    const asError = candidate as { code?: string; message?: string; cause?: unknown };
    if (asError.code === "23505" || /duplicate key value/i.test(String(asError.message ?? ""))) {
      matched = true;
      break;
    }
    candidate = asError.cause;
  }
  expect(matched).toBe(true);
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
     VALUES ($1, 'Tenant T47B (billing)', 'المستأجر ت٤٧', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
  const passwords = await import("../../modules/identity/application/password-service");
  const passwordService = new passwords.PasswordService();
  for (const [id, email, name] of [
    [ACTOR, HTTP_EMAIL, "T47 Billing Owner"],
    [ACTOR2, "t47-billing-approver@fixture.test", "T47 Billing Approver"],
  ] as const) {
    await su.query(
      `INSERT INTO users (id, email, full_name, password_hash, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [id, email, name, await passwordService.hashFromNewPassword(HTTP_PASSWORD)],
    );
  }
  // The owner role over the global template's permission set (0027 seeded
  // crm.contracts.bill + crm.contracts.manage for it) + the FULL BR-040
  // closure for crm.recurring_billing (17 keys — the feature-catalog
  // dependency closure; a partial grant fails resolveTenantStatic).
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, 'owner', 'Owner', 'المالك')`,
    [roleId, TENANT_B],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
    [roleId, TENANT_B, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_B, ACTOR, roleId],
  );
  const closure = [
    "accounting.chart_of_accounts",
    "accounting.journal_entries",
    "crm.recurring_billing",
    "crm.service_contracts",
    "inventory.multi_warehouse",
    "inventory.stock_ledger",
    "items.item_master",
    "items.price_lists",
    "partners.directory",
    "platform.branches",
    "platform.onboarding",
    "platform.registration",
    "platform.tenant_lifecycle",
    "sales.invoices",
    "sales.orders",
    "sales.quotations",
    "tax.engine",
  ];
  for (const featureKey of closure) {
    await su.query(
      `INSERT INTO entitlements (id, tenant_id, feature_key, source)
       VALUES (gen_random_uuid(), $1, $2, 'MANUAL')
       ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
      [TENANT_B, featureKey],
    );
  }
  await su.end();

  await withTenant(TENANT_B, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertBranch } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate(); // maps AR_CONTROL→1130, DEFERRED_REVENUE→2130, SERVICE_REVENUE→4200, VAT_PAYABLE→2120, SALES_RETURNS→4110

    // FY2025 + FY2026: the §15 windows (2025-12 → 2026-09) all OPEN.
    if ((await accountingStore.findFiscalYearByName("FY2025")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2025", startDate: "2025-01-01", endDate: "2025-12-31" });
    }
    if ((await accountingStore.findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    // The run's branch resolution target.
    await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null });

    // Tax: SA REGISTERED + the STD 15% code (the sales-fixture mirror —
    // the §15 golden's 15% rides the fee items' stored tax code).
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: ACTOR,
        note: "T47 billing fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    TAX_STD =
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

    // §15: Partner P-000001 (CUSTOMER, credit terms 30d) + project CASE-01.
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
    CASE01 = (
      await accountingStore.insertProject({ code: "CASE-01", name: "Advisory case 1", nameAr: null, parentId: null })
    ).id;

    // §15 fee items (SERVICE) — each WITH the STD 15% tax code (the
    // item-level tax home the run resolves; the job-card line pattern).
    const uoms = await itemsStore.listUoms();
    const hr = uoms.find((u) => u.code === "HR") ?? uoms[0]!;
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, uomId: string) =>
      itemsStore.insertItem({
        sku,
        name: `${sku} fee item`,
        nameAr: null,
        kind: "SERVICE",
        uomId,
        categoryId: null,
        taxCodeId: TAX_STD,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
    FEE_RET = (await ensureItem("FEE-RET", pcs.id)).id;
    FEE_MIL = (await ensureItem("FEE-MIL", pcs.id)).id;
    FEE_HR = (await ensureItem("FEE-HR", hr.id)).id;
  });

  // The §15 retainer chain contract (created FIRST so the early runs see
  // only it — the staged tenant-wide sequencing).
  const created = await withTenant(TENANT_B, () =>
    contracts.create({
      partnerId: PARTNER,
      projectId: CASE01,
      title: "Legal retainer 2026",
      titleAr: null,
      scope: "Monthly legal counsel",
      feeModel: "RETAINER",
      startDate: "2026-01-15",
      endDate: "2026-06-14",
      monthlyAmount: "1000",
      feeItemId: FEE_RET,
      milestones: null,
      currencyCode: null,
      note: "The §15 retainer chain",
      noteAr: null,
      actorId: ACTOR,
    }),
  );
  const activated = await withTenant(TENANT_B, () => contracts.activate(created.contract.id, ACTOR));
  C1 = activated.contract.id;
  expect(activated.contract.status).toBe("ACTIVE");

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

describe("the §15 retainer chain — drafts, idempotency, the full grid", () => {
  it("run asOf 2026-02-01 → exactly 2 drafts (Jan, Feb), each net 1000.0000 gross 1150.0000 (15% VAT)", async () => {
    const result = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-02-01", actorId: ACTOR }),
    );

    expect(result.contractsScanned).toBe(1);
    expect(result.draftsCreated).toHaveLength(2);
    expect(result.skippedLocked).toEqual([]);
    expect(result.skippedDuplicate).toEqual([]);
    expect(result.needsNarrative).toEqual([]);
    expect(result.draftsCreated.map((draft) => draft.periodKey)).toEqual(["2026-01", "2026-02"]);
    expect(result.draftsCreated.every((draft) => draft.status === "DRAFT")).toBe(true);

    for (const draft of result.draftsCreated) {
      C1_INVOICES.set(draft.periodKey!, draft.invoiceId);
      const invoice = await withTenant(TENANT_B, () => salesInvoices.find(draft.invoiceId));
      expect(invoice.kind).toBe("CREDIT");
      expect(invoice.status).toBe("DRAFT");
      expect(invoice.contractId).toBe(C1);
      expect(invoice.projectId).toBe(CASE01);
      expect(invoice.invoiceDate).toBe(draft.periodKey === "2026-01" ? "2026-01-15" : "2026-02-01");
      expect(invoice.totalNet).toBe("1000.0000");
      expect(invoice.totalTax).toBe("150.0000");
      expect(invoice.totalGross).toBe("1150.0000");
      // BR-034 substrate: the POLICY actor created the draft (it can never
      // self-approve); the approval policy (default TRUE) left it DRAFT.
      expect(invoice.createdBy).toBe(POLICY_ACTOR_ID);
      // §15: the 15% VAT via the standard resolution — the tax summary.
      const summary = invoice.taxSummary as {
        totalTax: string;
        groups: { treatment: string; taxableBase: string; taxAmount: string }[];
      };
      expect(summary.totalTax).toBe("150.0000");
      expect(summary.groups).toHaveLength(1);
      expect(summary.groups[0]!.treatment).toBe("STANDARD_RATED");
      expect(summary.groups[0]!.taxableBase).toBe("1000.0000");
      expect(summary.groups[0]!.taxAmount).toBe("150.0000");

      const lines = await withTenant(TENANT_B, () => salesStore.listSalesInvoiceLines(draft.invoiceId));
      expect(lines).toHaveLength(1);
      expect(lines[0]!.itemId).toBe(FEE_RET);
      expect(lines[0]!.qty).toBe("1.000000");
      expect(lines[0]!.unitPrice).toBe("1000.000000");
      expect(lines[0]!.taxCodeId).toBe(TAX_STD);
      expect(lines[0]!.description).toContain("retainer");
    }

    // The guard rows + the schedule flips.
    expect(await guardsOf(C1)).toEqual([
      { periodKey: "2026-01", milestoneScheduleId: null },
      { periodKey: "2026-02", milestoneScheduleId: null },
    ]);
    const grid = await gridOf(C1);
    expect(grid.filter((row) => row.status === "INVOICED").map((row) => row.key)).toEqual([
      "2026-01",
      "2026-02",
    ]);
    expect(grid.filter((row) => row.status === "PLANNED").map((row) => row.key)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    for (const row of grid.filter((row) => row.status === "INVOICED")) {
      expect(row.invoiceId).toBe(C1_INVOICES.get(row.key!));
    }

    // Audits: the summary run + one per generated invoice.
    const events = await withTenant(TENANT_B, () => audit.list({ action: "crm.billing_run", limit: 10 }));
    expect(events).toHaveLength(1);
    expect(events[0]!.after).toMatchObject({
      asOf: "2026-02-01",
      contractsScanned: 1,
      draftsCreated: 2,
    });
    const generated = await withTenant(TENANT_B, () =>
      audit.list({ action: "crm.contract_invoice_generated", limit: 10 }),
    );
    expect(generated).toHaveLength(2);
  });

  it("re-run → 0 new (the guard rows are the first idempotency net)", async () => {
    const result = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-02-01", actorId: ACTOR }),
    );
    expect(result.draftsCreated).toEqual([]);
    expect(result.skippedDuplicate).toEqual([]);
    expect(await guardsOf(C1)).toHaveLength(2);
  });

  it("run asOf 2026-07-01 → +4 (Mar..Jun) — the full 6-entry grid, 6 distinct periodKeys", async () => {
    const result = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-07-01", actorId: ACTOR }),
    );
    expect(result.draftsCreated.map((draft) => draft.periodKey)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    for (const draft of result.draftsCreated) {
      C1_INVOICES.set(draft.periodKey!, draft.invoiceId);
    }

    const guards = await guardsOf(C1);
    expect(guards).toHaveLength(6);
    expect(new Set(guards.map((row) => row.periodKey))).toEqual(
      new Set(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]),
    );
    const grid = await gridOf(C1);
    expect(grid.every((row) => row.status === "INVOICED" && row.invoiceId !== null)).toBe(true);
  });

  it("a run asOf before the contract start scans nothing; a malformed asOf is typed", async () => {
    const early = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2025-12-31", actorId: ACTOR }),
    );
    expect(early.contractsScanned).toBe(0);
    expect(early.draftsCreated).toEqual([]);
    await expect(
      withTenant(TENANT_B, () => billingRuns.run({ asOf: "2026-13-01", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "CONTRACT_INPUT_INVALID" });
  });
});

describe("the §15 milestone chain — dated lines, milestone-keyed guards", () => {
  it("run asOf 2026-03-01 → exactly 1 draft (Signing 5000.0000 + 15% VAT); re-run → 0; Delivery bills at its date", async () => {
    const created = await withTenant(TENANT_B, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Delivery project",
        titleAr: null,
        scope: null,
        feeModel: "MILESTONES",
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        monthlyAmount: null,
        feeItemId: FEE_MIL,
        milestones: [
          { label: "Signing", labelAr: null, dueDate: "2026-03-01", amount: "5000", feeItemId: null },
          { label: "Delivery", labelAr: null, dueDate: "2026-05-01", amount: "7000", feeItemId: null },
        ],
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_B, () => contracts.activate(created.contract.id, ACTOR));
    C2 = activated.contract.id;

    // Only the Signing milestone is due at 2026-03-01 (C1 fully guarded).
    const first = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-03-01", actorId: ACTOR }),
    );
    expect(first.draftsCreated).toHaveLength(1);
    expect(first.draftsCreated[0]!.contractId).toBe(C2);
    expect(first.draftsCreated[0]!.periodKey).toBeNull();
    const signingInvoice = await withTenant(TENANT_B, () =>
      salesInvoices.find(first.draftsCreated[0]!.invoiceId),
    );
    expect(signingInvoice.totalNet).toBe("5000.0000");
    expect(signingInvoice.totalTax).toBe("750.0000");
    expect(signingInvoice.totalGross).toBe("5750.0000");
    expect(signingInvoice.invoiceDate).toBe("2026-03-01");
    const signingLines = await withTenant(TENANT_B, () =>
      salesStore.listSalesInvoiceLines(signingInvoice.id),
    );
    expect(signingLines).toHaveLength(1);
    expect(signingLines[0]!.description).toBe("Signing");

    // The guard is MILESTONE-keyed (periodKey null + milestoneScheduleId).
    expect(await guardsOf(C2)).toEqual([
      { periodKey: null, milestoneScheduleId: expect.any(String) },
    ]);

    // Re-run → 0 (the milestone guard).
    const rerun = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-03-01", actorId: ACTOR }),
    );
    expect(rerun.draftsCreated).toEqual([]);

    // The second milestone bills at its own date.
    const second = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-05-01", actorId: ACTOR }),
    );
    expect(second.draftsCreated).toHaveLength(1);
    const deliveryInvoice = await withTenant(TENANT_B, () =>
      salesInvoices.find(second.draftsCreated[0]!.invoiceId),
    );
    expect(deliveryInvoice.totalNet).toBe("7000.0000");
    expect(deliveryInvoice.totalGross).toBe("8050.0000");
    expect(await guardsOf(C2)).toHaveLength(2);
  });
});

describe("the §15 hourly chain — the honest timeslip", () => {
  it("March period bills the 3.000000 h Research slip; April bills ONE line (Drafting) + lists the narrative-less slip", async () => {
    // The §9 mode gate: hourly contracts need the tenant's mode to name them.
    await setSetting("crm.contract_billing_mode", "hourly");
    const created = await withTenant(TENANT_B, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Hourly advisory 2026",
        titleAr: null,
        scope: null,
        feeModel: "HOURLY",
        startDate: "2026-03-01",
        endDate: "2026-04-30",
        monthlyAmount: null,
        feeItemId: FEE_HR,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_B, () => contracts.activate(created.contract.id, ACTOR));
    C3 = activated.contract.id;

    // The §15 slips (rates snapshotted at recording — the §15 value 250).
    const slips = await withTenant(TENANT_B, async () => {
      const e1 = await crmStore.insertTimeEntry({
        entryDate: "2026-04-03",
        hours: "2.000000",
        feeItemId: FEE_HR,
        projectId: CASE01,
        contractId: C3,
        feeEarnerUserId: ACTOR,
        unitRate: "250.000000",
        narrative: "Drafting",
        billable: true,
        actorId: ACTOR,
      });
      const e2 = await crmStore.insertTimeEntry({
        entryDate: "2026-04-10",
        hours: "1.500000",
        feeItemId: FEE_HR,
        projectId: CASE01,
        contractId: C3,
        feeEarnerUserId: ACTOR,
        unitRate: "250.000000",
        narrative: null,
        billable: true,
        actorId: ACTOR,
      });
      const e3 = await crmStore.insertTimeEntry({
        entryDate: "2026-03-28",
        hours: "3.000000",
        feeItemId: FEE_HR,
        projectId: CASE01,
        contractId: C3,
        feeEarnerUserId: ACTOR,
        unitRate: "250.000000",
        narrative: "Research",
        billable: true,
        actorId: ACTOR,
      });
      // The weekly review: only APPROVED entries are pullable.
      await crmStore.approveWeekTimeEntries("2026-03-23", "2026-03-29");
      await crmStore.approveWeekTimeEntries("2026-03-30", "2026-04-05");
      await crmStore.approveWeekTimeEntries("2026-04-06", "2026-04-12");
      return { e1: e1.id, e2: e2.id, e3: e3.id };
    });

    // March runs first (billDate 2026-03-31, arrears).
    const march = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-04-15", actorId: ACTOR }),
    );
    expect(march.draftsCreated).toHaveLength(1);
    expect(march.draftsCreated[0]!.periodKey).toBe("2026-03");
    const marchInvoice = await withTenant(TENANT_B, () =>
      salesInvoices.find(march.draftsCreated[0]!.invoiceId),
    );
    expect(marchInvoice.totalNet).toBe("750.0000"); // 3.000000 × 250.000000
    expect(marchInvoice.totalGross).toBe("862.5000");
    const marchLines = await withTenant(TENANT_B, () =>
      salesStore.listSalesInvoiceLines(marchInvoice.id),
    );
    expect(marchLines).toHaveLength(1);
    expect(marchLines[0]!.qty).toBe("3.000000");
    expect(marchLines[0]!.unitPrice).toBe("250.000000");
    expect(marchLines[0]!.description).toBe("Research");
    const e3After = await withTenant(TENANT_B, () => crmStore.findTimeEntryById(slips.e3));
    expect(e3After!.status).toBe("BILLED");
    expect(e3After!.billedInvoiceId).toBe(marchInvoice.id);

    // April: ONE line (Drafting) — the narrative-less slip is listed and
    // skipped, never silently billed (§5).
    const april = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-05-01", actorId: ACTOR }),
    );
    const aprilDraft = april.draftsCreated.find((draft) => draft.periodKey === "2026-04");
    expect(aprilDraft).toBeDefined();
    expect(april.needsNarrative).toHaveLength(1);
    expect(april.needsNarrative[0]!.timeEntryId).toBe(slips.e2);
    expect(april.needsNarrative[0]!.hours).toBe("1.500000");
    const aprilInvoice = await withTenant(TENANT_B, () => salesInvoices.find(aprilDraft!.invoiceId));
    expect(aprilInvoice.totalNet).toBe("500.0000"); // 2.000000 × 250.000000
    expect(aprilInvoice.totalGross).toBe("575.0000");
    const aprilLines = await withTenant(TENANT_B, () =>
      salesStore.listSalesInvoiceLines(aprilInvoice.id),
    );
    expect(aprilLines).toHaveLength(1);
    expect(aprilLines[0]!.description).toBe("Drafting");
    expect(aprilLines[0]!.qty).toBe("2.000000");
    expect(aprilLines[0]!.unitPrice).toBe("250.000000");

    // The narrative-less slip stays APPROVED + unbilled; the billed ones
    // are stamped.
    const e2After = await withTenant(TENANT_B, () => crmStore.findTimeEntryById(slips.e2));
    expect(e2After!.status).toBe("APPROVED");
    expect(e2After!.billedInvoiceId).toBeNull();
    const e1After = await withTenant(TENANT_B, () => crmStore.findTimeEntryById(slips.e1));
    expect(e1After!.status).toBe("BILLED");
    expect(e1After!.billedInvoiceId).toBe(aprilInvoice.id);
  });
});

describe("the duplicate guard — manual + scheduled overlap (INV-013)", () => {
  it("a second PLANNED entry claiming a guarded periodKey → per-entry savepoint rollback + skippedDuplicate", async () => {
    // Back to the mixed default mode for the retainer fixture contract.
    await setSetting("crm.contract_billing_mode", "retainer_or_milestones");

    // A direct duplicate guard insert is rejected by the constraint (the
    // net itself — 2026-01 is already guarded on C1).
    const anyInvoice = C1_INVOICES.get("2026-01")!;
    await expectUniqueViolation(() =>
      withTenant(TENANT_B, () =>
        crmStore.insertContractInvoice({
          contractId: C1,
          invoiceId: anyInvoice,
          periodKey: "2026-01",
          milestoneScheduleId: null,
          actorId: ACTOR,
        }),
      ),
    );

    // The concurrent-window simulation: one contract carrying TWO due
    // PLANNED entries with the SAME periodKey (a rogue HOURLY period beside
    // the retainer grid — only constructible through the store, exactly the
    // shape a racing second run produces mid-preview).
    const created = await withTenant(TENANT_B, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Overlap simulation",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        monthlyAmount: "100",
        feeItemId: FEE_RET,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_B, () => contracts.activate(created.contract.id, ACTOR));
    C_ROGUE = activated.contract.id;
    await withTenant(TENANT_B, async () => {
      await crmStore.insertScheduleEntry({
        contractId: C_ROGUE,
        entryType: "HOURLY_PERIOD",
        periodKey: "2026-05",
        periodStart: "2026-05-01",
        periodEnd: "2026-05-31",
        billDate: "2026-05-31",
        amount: null,
        feeItemId: FEE_HR,
        milestoneLabel: null,
        milestoneLabelAr: null,
      });
      await crmStore.insertTimeEntry({
        entryDate: "2026-05-10",
        hours: "1.000000",
        feeItemId: FEE_HR,
        projectId: CASE01,
        contractId: C_ROGUE,
        feeEarnerUserId: ACTOR,
        unitRate: "100.000000",
        narrative: "overlap window slip",
        billable: true,
        actorId: ACTOR,
      });
      await crmStore.approveWeekTimeEntries("2026-05-04", "2026-05-10");
    });

    const result = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-06-01", actorId: ACTOR }),
    );
    // The HOURLY entry drafts first (grid order), guarding 2026-05; the
    // retainer entry then hits the partial unique → recorded skip with
    // ZERO residue (its invoice row rolled back with the savepoint).
    expect(result.draftsCreated).toHaveLength(1);
    expect(result.draftsCreated[0]!.contractId).toBe(C_ROGUE);
    expect(result.skippedDuplicate).toHaveLength(1);
    expect(result.skippedDuplicate[0]!.contractId).toBe(C_ROGUE);
    expect(result.skippedDuplicate[0]!.periodKey).toBe("2026-05");

    const rogueGrid = await gridOf(C_ROGUE);
    const retainerRow = rogueGrid.find((row) => row.type === "RETAINER_PERIOD")!;
    expect(retainerRow.status).toBe("PLANNED"); // rolled back — not INVOICED
    expect(retainerRow.invoiceId).toBeNull();
    const hourlyRow = rogueGrid.find((row) => row.type === "HOURLY_PERIOD")!;
    expect(hourlyRow.status).toBe("INVOICED");

    // Zero residue: exactly ONE invoice exists for C_ROGUE.
    const rogueInvoices = await withTenant(TENANT_B, () =>
      salesInvoices.list({ customerId: PARTNER, limit: 200 }),
    );
    expect(rogueInvoices.filter((row) => row.contractId === C_ROGUE)).toHaveLength(1);

    // The second sequential run (the manual + scheduled overlap): the
    // guard now blocks BOTH entries at the preview level → 0 new.
    const rerun = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-06-01", actorId: ACTOR }),
    );
    expect(rerun.draftsCreated).toEqual([]);
    expect(rerun.skippedDuplicate).toEqual([]);
  });
});

describe("period locks — LOCKED billDates never draft (INV-011)", () => {
  it("lock 2026-06 → the June entry is skipped + periodLocked; reopen → it bills", async () => {
    // Soft-close then lock June 2026 (PC-04 gate passes — no BROKEN runs).
    const period = await withTenant(TENANT_B, () => accountingStore.findPeriodForDate("2026-06-15"));
    expect(period).toBeDefined();
    await withTenant(TENANT_B, async () => {
      await periods.softClose(ACTOR, period!.id);
      await periods.lock(ACTOR, period!.id);
    });

    const created = await withTenant(TENANT_B, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "June lock fixture",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-06-01",
        endDate: "2026-06-30",
        monthlyAmount: "100",
        feeItemId: FEE_RET,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_B, () => contracts.activate(created.contract.id, ACTOR));
    C_LOCK = activated.contract.id;

    const blocked = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-07-01", actorId: ACTOR }),
    );
    expect(blocked.draftsCreated).toEqual([]); // zero dead drafts
    expect(blocked.skippedLocked).toHaveLength(1);
    expect(blocked.skippedLocked[0]!).toMatchObject({
      contractId: C_LOCK,
      periodKey: "2026-06",
      periodStatus: "LOCKED",
    });
    expect(await guardsOf(C_LOCK)).toEqual([]); // no guard row either

    // Order independence: reopen → the same run bills it.
    await withTenant(TENANT_B, () => periods.reopen(ACTOR, period!.id, "billing catch-up"));
    const after = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-07-01", actorId: ACTOR }),
    );
    expect(after.draftsCreated).toHaveLength(1);
    expect(after.draftsCreated[0]!.periodKey).toBe("2026-06");
    expect(after.skippedLocked).toEqual([]);
  });
});

describe("posting the January draft — the ordinary J-INV chain (§1 row 1)", () => {
  it("approve + post → J-INV with the partner/project stamps, the subledger row same tx, the SAL number", async () => {
    JAN_INVOICE = C1_INVOICES.get("2026-01")!;
    // SoD: the POLICY actor's draft approves by the human actor.
    const approved = await withTenant(TENANT_B, () =>
      salesInvoices.approve(JAN_INVOICE, ACTOR, false),
    );
    expect(approved.status).toBe("APPROVED");
    const posted = await withTenant(TENANT_B, () => salesInvoices.post(JAN_INVOICE, ACTOR));

    expect(posted.invoice.status).toBe("POSTED");
    expect(posted.invoice.invoiceNo).toMatch(/^SAL-2026-\d{6}$/);
    expect(posted.invoice.postedJournalId).toBe(posted.journalEntryId);
    expect(posted.cogsJournalEntryId).toBeNull(); // SERVICE lines — no COGS

    // J-INV [DR AR 1150.0000 (partner, project) · CR SERVICE_REVENUE
    // 1000.0000 (project) · CR VAT_PAYABLE 150.0000 (project)].
    const entry = await withTenant(TENANT_B, () =>
      journal.findEntryBySourceKey("sales_invoice", JAN_INVOICE, "post"),
    );
    expect(entry).toBeDefined();
    expect(entry!.entryDate).toBe("2026-01-15");
    expect(await linesOf(entry!.id)).toEqual([
      { accountCode: "1130", direction: "DEBIT", amount: "1150.0000", partnerId: PARTNER, projectId: CASE01 },
      { accountCode: "4200", direction: "CREDIT", amount: "1000.0000", partnerId: null, projectId: CASE01 },
      { accountCode: "2120", direction: "CREDIT", amount: "150.0000", partnerId: null, projectId: CASE01 },
    ]);

    // The partner subledger row lands in the SAME transaction (INV-009).
    const client = await bClient();
    const subledger = await client.query<{
      direction: string;
      amount: string;
      source_type: string;
      source_id: string;
    }>(
      `SELECT direction, amount::text, source_type, source_id FROM partner_subledger_entries
       WHERE source_type = 'sales_invoice' AND source_id = $1`,
      [JAN_INVOICE],
    );
    await client.end();
    expect(subledger.rows).toHaveLength(1);
    expect(subledger.rows[0]).toEqual({
      direction: "DEBIT",
      amount: "1150.0000",
      source_type: "sales_invoice",
      source_id: JAN_INVOICE,
    });

    // The wired port fired with zero HELD advances — no release journals.
    const releaseEntries = await withTenant(TENANT_B, () =>
      journal.listEntries({ sourceType: "contract_advance", limit: 50 }),
    );
    expect(releaseEntries.rows).toEqual([]);

    // The posting is idempotent (INV-013): re-post replays.
    const replay = await withTenant(TENANT_B, () => salesInvoices.post(JAN_INVOICE, ACTOR));
    expect(replay.idempotentReplay).toBe(true);
  });
});

describe("credit-note cancellation — the net-zero pair; no regeneration", () => {
  it("the standard sales credit note nets the posted invoice to zero; the run never regenerates the period", async () => {
    const january = await withTenant(TENANT_B, () => salesInvoices.find(JAN_INVOICE));
    const invoiceLines = await withTenant(TENANT_B, () =>
      salesStore.listSalesInvoiceLines(JAN_INVOICE),
    );
    const created = await withTenant(TENANT_B, () =>
      creditNotes.create({
        branchId: january.branchId,
        salesRepId: null,
        invoiceId: JAN_INVOICE,
        noteDate: "2026-01-20", // inside the 14-day window
        note: "January retainer cancelled",
        noteAr: null,
        actorId: ACTOR,
        lines: invoiceLines.map((line) => ({
          invoiceLineId: line.id,
          qty: line.qty,
          unitPrice: null, // the invoice line's price
          discountAmount: null,
          taxCodeId: null, // the invoice line's tax code
          returnToStock: false,
          batchId: null,
          serialIds: null,
          description: line.description,
          descriptionAr: null,
          note: null,
        })),
      }),
    );
    await withTenant(TENANT_B, () => creditNotes.approve(created.id, ACTOR2));
    const posted = await withTenant(TENANT_B, () => creditNotes.post(created.id, ACTOR2));
    expect(posted.note.status).toBe("POSTED");

    // G-04: DR SALES_RETURNS 1000 · DR VAT_PAYABLE 150 · CR AR 1150
    // (partner). NOTE: the standard credit-note journal does NOT stamp
    // projectId (only the invoice posting chain does — §1 row 1; the
    // credit note is the standard sales path, unchanged).
    const entry = await withTenant(TENANT_B, () =>
      journal.findEntryBySourceKey("credit_note", created.id, "post"),
    );
    expect(entry).toBeDefined();
    expect(await linesOf(entry!.id)).toEqual([
      { accountCode: "4110", direction: "DEBIT", amount: "1000.0000", partnerId: null, projectId: null },
      { accountCode: "2120", direction: "DEBIT", amount: "150.0000", partnerId: null, projectId: null },
      { accountCode: "1130", direction: "CREDIT", amount: "1150.0000", partnerId: PARTNER, projectId: null },
    ]);

    // The net-zero pair on the partner balance: +1150 − 1150 = 0.
    const client = await bClient();
    const balance = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END), 0)::text AS total
       FROM partner_subledger_entries WHERE partner_id = $1`,
      [PARTNER],
    );
    await client.end();
    expect(balance.rows[0]!.total).toBe("0.0000");

    // The cancelled period never regenerates: the guard row persists.
    const result = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-02-01", actorId: ACTOR }),
    );
    expect(result.draftsCreated).toEqual([]);
    expect(await guardsOf(C1)).toHaveLength(6);
  });
});

describe("the auto-submit policy fixture (§9 crm.invoice_approval_required)", () => {
  it("policy false → the run's drafts land PENDING_APPROVAL (never posted)", async () => {
    await setSetting("crm.invoice_approval_required", false);
    const created = await withTenant(TENANT_B, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Auto-submit fixture",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        monthlyAmount: "100",
        feeItemId: FEE_RET,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_B, () => contracts.activate(created.contract.id, ACTOR));
    C_AUTO = activated.contract.id;
    expect(activated.contract.status).toBe("ACTIVE");

    const result = await withTenant(TENANT_B, () =>
      billingRuns.run({ asOf: "2026-09-01", actorId: ACTOR }),
    );
    expect(result.draftsCreated).toHaveLength(1);
    expect(result.draftsCreated[0]!.contractId).toBe(C_AUTO);
    expect(result.draftsCreated[0]!.status).toBe("PENDING_APPROVAL");
    const invoice = await withTenant(TENANT_B, () =>
      salesInvoices.find(result.draftsCreated[0]!.invoiceId),
    );
    expect(invoice.status).toBe("PENDING_APPROVAL");
    expect(invoice.createdBy).toBe(POLICY_ACTOR_ID); // never auto-posted (BR-034)

    // Restore the default posture (order independence).
    await clearSetting("crm.invoice_approval_required");
  });
});

describe("HTTP rows #30–#31 over the real AppModule pipeline", () => {
  it("GET billing-runs → the audit history; POST billing-runs → a fresh idempotent run", async () => {
    const history = await httpCall("GET", "/api/v1/crm/billing-runs?limit=50");
    expect(history.status).toBe(200);
    const rows = history.body.data as { at: string; summary: { asOf: string } }[];
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows[0]!.summary.asOf).toBeTruthy();

    const run = await httpCall("POST", "/api/v1/crm/billing-runs", { asOf: "2026-10-01" });
    expect(run.status).toBe(201);
    const result = run.body.data as {
      asOf: string;
      contractsScanned: number;
      draftsCreated: unknown[];
    };
    expect(result.asOf).toBe("2026-10-01");
    expect(result.contractsScanned).toBe(6); // C1, C2, C3, C_ROGUE, C_LOCK, C_AUTO
    expect(result.draftsCreated).toEqual([]); // everything guarded — idempotent

    // The zod body schema rejects a malformed asOf at the gate (the
    // service-level CONTRACT_INPUT_INVALID shape is pinned in the retainer
    // describe; the HTTP face is the standard validation error).
    const bad = await httpCall("POST", "/api/v1/crm/billing-runs", { asOf: "not-a-date" });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe("VALIDATION_ERROR");
  });
});
