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
import { AccountService } from "../../modules/treasury/application/account-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { PasswordService } from "../../modules/identity/application/password-service";
import { ContractService } from "../../modules/crm/application/contract-service";
import {
  AdvanceInsufficientOnAccountError,
  AdvanceStateError,
  ContractInputInvalidError,
  ContractNotFoundError,
  ContractStateError,
  ContractTermInvalidError,
} from "../../modules/crm/domain/crm-errors";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as crmStore from "../../modules/crm/infrastructure/crm.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import type { Server } from "node:net";
import type { Client } from "pg";

/**
 * PHASE-019 T46b db evidence (MASTER-PLAN §4 + §15 + §18 lessons 1–2): the
 * service-contract lifecycle (DRAFT → ACTIVE/CANCELLED/RENEWED; CT-{YYYY}-
 * {SEQ:5} at activation), the §4 billing-schedule grid semantics pinned to
 * the §15 golden numbers (retainer clipped calendar months in advance,
 * milestone dated lines, hourly arrears with amount NULL), the §18 lesson-1
 * fee-item home (the STORED grid resolves defaults for patches that omit
 * feeItemId), the policy-gated advance reclass J-DEF (§1 row 4 + lesson 2 —
 * the AR line carries partner + project, the DEFERRED_REVENUE line carries
 * neither), and the read-only billing preview (§11 row 26 — the T47
 * contract). Dedicated tenant 6a6a6a6a (SAR; verified unused across the repo
 * before adoption — 66666666 is TENANT_M). Row 29 (contract-invoices
 * listing) rides the preview describe + the HTTP smoke.
 */

const TENANT_C = "6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a";
const ACTOR = "6a6a6a6a-0000-4000-8000-0000000006a1";
const HTTP_PASSWORD = "contracts-t46-strong-passphrase-9";
const HTTP_EMAIL = "c46-contracts@fixture.test";

// -- the service graph (constructed manually — §18 lesson 6) ----------------

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const contracts = new ContractService(audit, posting, numbering, resolveConfig);
const periods = new PeriodService(audit);
const treasuryAccounts = new AccountService(audit);
const receipts = new ReceiptService(audit, new SettlementCore(audit, posting, numbering));

// -- fixture ids (resolved in beforeAll) --------------------------------------

let PARTNER = "";
let CASE01 = "";
let CASE02 = "";
let FEE_RET = "";
let FEE_MIL = "";
let FEE_HR = "";
let CASH_ACCOUNT = "";
let GL_CASH = "";

// contract ids across the describes (sequential state — §16 order discipline)
let C1 = ""; // the §15 retainer chain (Jan 15 → Jun 14)
let C2 = ""; // the §15 milestone chain + the lesson-1 PATCH dance
let C3 = ""; // the 2028 leap-day fixture
let C4 = ""; // the month-edge clip fixture (stays DRAFT — the advance DRAFT guard)
let C5 = ""; // the hourly grid fixture (cancelled at the end)
let C7 = ""; // the renew fixture (MILESTONES)
let C7_RENEWAL = "";
let HTTP_CONTRACT = "";

// The on-account receipts of the advance describe (sequential state).
let R1: { id: string; journalEntryId: string; allocatedAmount: string } | undefined;
let R2: { id: string; journalEntryId: string; allocatedAmount: string } | undefined;

// -- helpers -------------------------------------------------------------------

/** The tenant-scoped app client (RLS world) for read assertions. */
async function cClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_C]);
  return client;
}

/**
 * Upsert a tenant setting with `updated_at = now()` — the resolve cache's
 * fingerprint hashes `key || ':' || updated_at`, so the bump is what makes
 * a mid-suite value flip visible (a bare value-only UPDATE would serve the
 * stale cached static config — the setting-reader quirk).
 */
async function setSetting(key: string, value: string | boolean): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TENANT_C, key, JSON.stringify(value)],
  );
  await su.end();
}

async function clearSetting(key: string): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [TENANT_C, key]);
  await su.end();
}

/** The zero-residue probe: advances + journal counts for the tenant. */
async function residueCounts(): Promise<{ advances: number; journals: number }> {
  const su = await superuserClient();
  const result = await su.query<{ a: number; j: number }>(
    `SELECT (SELECT count(*) FROM contract_advances WHERE tenant_id = $1)::int AS a,
            (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::int AS j`,
    [TENANT_C],
  );
  await su.end();
  return { advances: result.rows[0]!.a, journals: result.rows[0]!.j };
}

/** A posted on-account receipt (no allocations — the full amount stays credit). */
async function seedOnAccountReceipt(
  amount: string,
  valueDate: string,
  description: string,
): Promise<{ id: string; journalEntryId: string; allocatedAmount: string }> {
  const created = await withTenant(TENANT_C, () =>
    receipts.create({
      cashAccountId: CASH_ACCOUNT,
      partnerId: PARTNER,
      method: "CASH",
      payerName: "Client P-000001",
      currencyCode: "SAR",
      amount,
      exchangeRate: null,
      valueDate,
      reference: null,
      description,
      descriptionAr: null,
      actorId: ACTOR,
    }),
  );
  const posted = await withTenant(TENANT_C, () => receipts.post(created.id, ACTOR));
  return {
    id: created.id,
    journalEntryId: posted.journalEntryId,
    allocatedAmount: posted.allocatedAmount,
  };
}

/** The schedule grid mapped to a plain comparable shape (stable order). */
async function gridOf(contractId: string): Promise<
  Array<{
    key: string | null;
    type: string;
    start: string | null;
    end: string | null;
    billDate: string;
    amount: string | null;
    feeItemId: string;
    label: string | null;
    labelAr: string | null;
    status: string;
  }>
> {
  const rows = await withTenant(TENANT_C, () => contracts.listSchedule(contractId));
  return rows.map((row) => ({
    key: row.periodKey,
    type: row.entryType,
    start: row.periodStart,
    end: row.periodEnd,
    billDate: row.billDate,
    amount: row.amount,
    feeItemId: row.feeItemId,
    label: row.milestoneLabel,
    labelAr: row.milestoneLabelAr,
    status: row.status,
  }));
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

// -- the HTTP pipeline (the projects.spec real-AppModule pattern) --------------

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
     VALUES ($1, 'Tenant C46 (contracts)', 'المستأجر س٤٦', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_C],
  );
  const passwords = new PasswordService();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, $2, 'C46 Contracts Owner', $3, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR, HTTP_EMAIL, await passwords.hashFromNewPassword(HTTP_PASSWORD)],
  );
  // The owner role over the global template's permission set (0027 seeded
  // crm.contracts.manage for it) + the BR-039 feature entitlements — the
  // FULL BR-040 dependency closure for crm.service_contracts (a single-key
  // grant fails the resolve-layer validation: the template-prerequisites
  // spec's closure rule).
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, 'owner', 'Owner', 'المالك')`,
    [roleId, TENANT_C],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
    [roleId, TENANT_C, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_C, ACTOR, roleId],
  );
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES (gen_random_uuid(), $1, 'crm.service_contracts', 'MANUAL'),
            (gen_random_uuid(), $1, 'partners.directory', 'MANUAL'),
            (gen_random_uuid(), $1, 'platform.onboarding', 'MANUAL'),
            (gen_random_uuid(), $1, 'platform.registration', 'MANUAL')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [TENANT_C],
  );
  await su.end();

  await withTenant(TENANT_C, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate(); // maps AR_CONTROL→1130, DEFERRED_REVENUE→2130, …

    // FY2025 + FY2026: the receipt value dates (2025-12-15, the §15 deferral
    // chain) AND today's J-DEF entry dates (2026-11) both need OPEN periods.
    if ((await accountingStore.findFiscalYearByName("FY2025")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2025", startDate: "2025-01-01", endDate: "2025-12-31" });
    }
    if ((await accountingStore.findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    // §15: Partner P-000001 (CUSTOMER, credit terms 30d) + projects CASE-01/02.
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    const partner = await partnersStore.insertPartner({
      kind: "CUSTOMER",
      code: "P-000001",
      name: "Gulf Advisory Group",
      nameAr: "مجموعة الخليج للاستشارات",
      taxNumber: null,
      creditLimit: null,
      creditTermsId: net30.id,
      priceListId: null,
    });
    PARTNER = partner.id;
    CASE01 = (await accountingStore.insertProject({ code: "CASE-01", name: "Advisory case 1", nameAr: null, parentId: null })).id;
    CASE02 = (await accountingStore.insertProject({ code: "CASE-02", name: "Advisory case 2", nameAr: null, parentId: null })).id;

    // §15 fee items (SERVICE): FEE-RET / FEE-MIL / FEE-HR.
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
        taxCodeId: null,
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

    // The treasury cash account on GL 1111 (the receipts' cash leg).
    GL_CASH = (await accountingStore.findAccountByCode("1111"))!.id;
    CASH_ACCOUNT = (
      await treasuryAccounts.open({
        name: "C46 main cash",
        nameAr: null,
        type: "CASH",
        accountId: GL_CASH,
        branchId: null,
        currencyCode: "SAR",
        actorId: ACTOR,
      })
    ).id;
  });

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

describe("contract lifecycle + grid semantics (§4 + §15 + §18 lesson 1)", () => {
  it("create → DRAFT (no number yet); the §15 retainer grid is written at CREATE", async () => {
    const created = await withTenant(TENANT_C, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Legal retainer 2026",
        titleAr: "عقد أتعاب ٢٠٢٦",
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
    C1 = created.contract.id;
    expect(created.contract.status).toBe("DRAFT");
    expect(created.contract.contractNo).toBeNull();
    expect(created.contract.activatedAt).toBeNull();
    expect(created.isExpired).toBe(false);
    expect(await auditActions("service_contract", C1)).toEqual(["crm.contract.created"]);

    // The grid at CREATE (the lesson-1 substrate: the contract-level fee
    // item persists into the rows here — there is no contract-level column).
    expect(await gridOf(C1)).toEqual([
      { key: "2026-01", type: "RETAINER_PERIOD", start: "2026-01-15", end: "2026-01-31", billDate: "2026-01-15", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-02", type: "RETAINER_PERIOD", start: "2026-02-01", end: "2026-02-28", billDate: "2026-02-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-03", type: "RETAINER_PERIOD", start: "2026-03-01", end: "2026-03-31", billDate: "2026-03-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-04", type: "RETAINER_PERIOD", start: "2026-04-01", end: "2026-04-30", billDate: "2026-04-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-05", type: "RETAINER_PERIOD", start: "2026-05-01", end: "2026-05-31", billDate: "2026-05-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-06", type: "RETAINER_PERIOD", start: "2026-06-01", end: "2026-06-14", billDate: "2026-06-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
    ]);

    // Typed shape guards (the 422 policy class).
    await expect(
      withTenant(TENANT_C, () =>
        contracts.create({
          partnerId: PARTNER,
          projectId: null,
          title: "Bad term",
          titleAr: null,
          scope: null,
          feeModel: "RETAINER",
          startDate: "2026-06-14",
          endDate: "2026-01-15", // end before start
          monthlyAmount: "1000",
          feeItemId: FEE_RET,
          milestones: null,
          currencyCode: null,
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ContractTermInvalidError);
    await expect(
      withTenant(TENANT_C, () => contracts.find("99999999-9999-4999-8999-999999999993")),
    ).rejects.toBeInstanceOf(ContractNotFoundError);
  });

  it("DRAFT edits + idempotent re-expansion (an update touching the same term stays at 6)", async () => {
    const retitled = await withTenant(TENANT_C, () =>
      contracts.update(C1, { title: "Legal retainer 2026 (amended)", actorId: ACTOR }),
    );
    expect(retitled.contract.title).toBe("Legal retainer 2026 (amended)");
    expect((await gridOf(C1)).length).toBe(6);

    // Touching the same term (same explicit value) re-runs the expansion —
    // idempotent by construction: still exactly 6, no duplicates.
    await withTenant(TENANT_C, () =>
      contracts.update(C1, { monthlyAmount: "1000", endDate: "2026-06-14", actorId: ACTOR }),
    );
    expect((await gridOf(C1)).length).toBe(6);
    expect(await auditActions("service_contract", C1)).toContain("crm.contract.updated");

    // Editing while DRAFT only: the number/stamps stay untouched.
    const read = await withTenant(TENANT_C, () => contracts.find(C1));
    expect(read.contract.status).toBe("DRAFT");
    expect(read.contract.contractNo).toBeNull();
  });

  it("activate → CT-2026-00001 + audit; the §15 grid holds after the idempotent re-run", async () => {
    const activated = await withTenant(TENANT_C, () => contracts.activate(C1, ACTOR));
    expect(activated.contract.status).toBe("ACTIVE");
    expect(activated.contract.contractNo).toBe("CT-2026-00001"); // the first reserve in this tenant
    expect(activated.contract.activatedAt).toBeTruthy();
    // §4: expiry is DERIVED — the term ended before today, the status stays.
    expect(activated.isExpired).toBe(true);
    expect(await auditActions("service_contract", C1)).toContain("crm.contract.activated");

    const grid = await gridOf(C1);
    expect(grid.length).toBe(6); // the activation re-run added nothing
    expect(grid.map((row) => row.key)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
    for (const row of grid) {
      expect(row.amount).toBe("1000.0000"); // the FULL monthlyAmount — no proration
      expect(row.billDate).toBe(row.start); // billing in advance
      expect(row.feeItemId).toBe(FEE_RET);
      expect(row.status).toBe("PLANNED");
    }

    // The list read (row 18) + the partner filter.
    const byStatus = await withTenant(TENANT_C, () => contracts.list({ status: "ACTIVE", limit: 50 }));
    expect(byStatus.map((row) => row.contract.id)).toContain(C1);
    const byPartner = await withTenant(TENANT_C, () => contracts.list({ partnerId: PARTNER, limit: 50 }));
    expect(byPartner.map((row) => row.contract.id)).toContain(C1);
  });

  it("illegal transitions → typed CONTRACT_STATE (A7 not-found parity)", async () => {
    await expect(
      withTenant(TENANT_C, () => contracts.update(C1, { title: "nope", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "CONTRACT_STATE" });
    await expect(
      withTenant(TENANT_C, () => contracts.update(C1, { title: "nope", actorId: ACTOR })),
    ).rejects.toBeInstanceOf(ContractStateError);
    await expect(withTenant(TENANT_C, () => contracts.activate(C1, ACTOR))).rejects.toBeInstanceOf(
      ContractStateError,
    );
    await expect(
      withTenant(TENANT_C, () => contracts.activate("99999999-9999-4999-8999-999999999992", ACTOR)),
    ).rejects.toBeInstanceOf(ContractNotFoundError);
    // Zero residue: the refused edits changed nothing.
    const read = await withTenant(TENANT_C, () => contracts.find(C1));
    expect(read.contract.title).toBe("Legal retainer 2026 (amended)");
    expect(read.contract.status).toBe("ACTIVE");
  });

  it("§18 lesson 1: MILESTONES full-replace PATCH omitting feeItemId; removed→SKIPPED, restored→re-PLANNED; a field-only PATCH never wipes the grid", async () => {
    // Create with the contract-level fee item + null-fee milestone lines —
    // the EXACT first-execution shape that threw "milestone has no fee item".
    const created = await withTenant(TENANT_C, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Delivery project 2026",
        titleAr: null,
        scope: "Fixed-scope delivery",
        feeModel: "MILESTONES",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        monthlyAmount: null,
        feeItemId: FEE_MIL,
        milestones: [
          { label: "Signing", labelAr: "التوقيع", dueDate: "2026-03-01", amount: "5000", feeItemId: null },
          { label: "Delivery", labelAr: "التسليم", dueDate: "2026-05-01", amount: "7000", feeItemId: null },
        ],
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    C2 = created.contract.id;
    expect((await gridOf(C2)).map((row) => row.feeItemId)).toEqual([FEE_MIL, FEE_MIL]);

    // PATCH #1 — full-replace (feeItemId OMITTED, the dropped label goes
    // SKIPPED). This is the mandatory lesson-1 shape: it must SUCCEED.
    await withTenant(TENANT_C, () =>
      contracts.update(C2, {
        milestones: [
          { label: "Signing", labelAr: "التوقيع", dueDate: "2026-04-01", amount: "5500", feeItemId: null },
        ],
        actorId: ACTOR,
      }),
    );
    let grid = await gridOf(C2);
    expect(grid.find((row) => row.label === "Signing")).toMatchObject({
      status: "PLANNED",
      billDate: "2026-04-01",
      amount: "5500.0000",
      feeItemId: FEE_MIL,
    });
    expect(grid.find((row) => row.label === "Delivery")).toMatchObject({ status: "SKIPPED" });

    // PATCH #2 — restore the removed label: it re-PLANS (never a duplicate
    // row — the partial unique on (tenant, contract, milestone_label)).
    await withTenant(TENANT_C, () =>
      contracts.update(C2, {
        milestones: [
          { label: "Signing", labelAr: "التوقيع", dueDate: "2026-04-01", amount: "5500", feeItemId: null },
          { label: "Delivery", labelAr: "التسليم", dueDate: "2026-06-01", amount: "7500", feeItemId: null },
        ],
        actorId: ACTOR,
      }),
    );
    grid = await gridOf(C2);
    expect(grid.length).toBe(2);
    expect(grid.find((row) => row.label === "Delivery")).toMatchObject({
      status: "PLANNED",
      billDate: "2026-06-01",
      amount: "7500.0000",
      feeItemId: FEE_MIL,
    });

    // PATCH #3 — a field-only PATCH (milestones omitted = unchanged): the
    // grid must stay intact (a stale full-replace would wipe it to SKIPPED).
    await withTenant(TENANT_C, () =>
      contracts.update(C2, { title: "Delivery project 2026 (amended)", actorId: ACTOR }),
    );
    grid = await gridOf(C2);
    expect(grid.map((row) => row.status)).toEqual(["PLANNED", "PLANNED"]);
    expect(grid.length).toBe(2);

    // PATCH #4 — back to the §15 canonical numbers, then activate.
    await withTenant(TENANT_C, () =>
      contracts.update(C2, {
        milestones: [
          { label: "Signing", labelAr: "التوقيع", dueDate: "2026-03-01", amount: "5000", feeItemId: null },
          { label: "Delivery", labelAr: "التسليم", dueDate: "2026-05-01", amount: "7000", feeItemId: null },
        ],
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_C, () => contracts.activate(C2, ACTOR));
    expect(activated.contract.status).toBe("ACTIVE");
    expect(activated.contract.contractNo).toMatch(/^CT-2026-\d{5}$/);
    // listSchedule orders MILESTONE rows by label (COALESCE(period_key,
    // milestone_label)) — Delivery sorts before Signing.
    expect(await gridOf(C2)).toEqual([
      { key: null, type: "MILESTONE", start: "2026-05-01", end: "2026-05-01", billDate: "2026-05-01", amount: "7000.0000", feeItemId: FEE_MIL, label: "Delivery", labelAr: "التسليم", status: "PLANNED" },
      { key: null, type: "MILESTONE", start: "2026-03-01", end: "2026-03-01", billDate: "2026-03-01", amount: "5000.0000", feeItemId: FEE_MIL, label: "Signing", labelAr: "التوقيع", status: "PLANNED" },
    ]);
  });

  it("leap-day (2028-02-29) + month-edge clip grids", async () => {
    // The 2028 leap-day fixture: term 2028-02-01 → 2028-03-31.
    const leap = await withTenant(TENANT_C, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: null,
        title: "Leap-year retainer",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2028-02-01",
        endDate: "2028-03-31",
        monthlyAmount: "1000",
        feeItemId: FEE_RET,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    C3 = leap.contract.id;
    expect(await gridOf(C3)).toEqual([
      { key: "2028-02", type: "RETAINER_PERIOD", start: "2028-02-01", end: "2028-02-29", billDate: "2028-02-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2028-03", type: "RETAINER_PERIOD", start: "2028-03-01", end: "2028-03-31", billDate: "2028-03-01", amount: "1000.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
    ]);

    // Month-edge: a term ending mid-month clips the last period at endDate.
    const clipped = await withTenant(TENANT_C, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: null,
        title: "Clipped retainer",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-01-10",
        endDate: "2026-03-15",
        monthlyAmount: "800",
        feeItemId: FEE_RET,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    C4 = clipped.contract.id; // stays DRAFT (the advance DRAFT guard below)
    expect(await gridOf(C4)).toEqual([
      { key: "2026-01", type: "RETAINER_PERIOD", start: "2026-01-10", end: "2026-01-31", billDate: "2026-01-10", amount: "800.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-02", type: "RETAINER_PERIOD", start: "2026-02-01", end: "2026-02-28", billDate: "2026-02-01", amount: "800.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-03", type: "RETAINER_PERIOD", start: "2026-03-01", end: "2026-03-15", billDate: "2026-03-01", amount: "800.0000", feeItemId: FEE_RET, label: null, labelAr: null, status: "PLANNED" },
    ]);

    // A DRAFT term shortening flips the removed period keys SKIPPED (the
    // milestone-flip discipline generalized) — and restoring re-PLANS.
    await withTenant(TENANT_C, () =>
      contracts.update(C4, { endDate: "2026-02-28", actorId: ACTOR }),
    );
    let grid = await gridOf(C4);
    expect(grid.find((row) => row.key === "2026-03")).toMatchObject({ status: "SKIPPED" });
    await withTenant(TENANT_C, () =>
      contracts.update(C4, { endDate: "2026-03-15", actorId: ACTOR }),
    );
    grid = await gridOf(C4);
    expect(grid.find((row) => row.key === "2026-03")).toMatchObject({ status: "PLANNED" });
    expect(grid.length).toBe(3); // never deleted, never duplicated
  });

  it("the billing-mode gate (§9): hourly allowed only when the tenant mode names it; the HOURLY grid bills in arrears with amount NULL", async () => {
    // Default mode retainer_or_milestones: HOURLY is refused (typed 422 class).
    await expect(
      withTenant(TENANT_C, () =>
        contracts.create({
          partnerId: PARTNER,
          projectId: CASE02,
          title: "Hourly advisory",
          titleAr: null,
          scope: null,
          feeModel: "HOURLY",
          startDate: "2026-03-01",
          endDate: "2026-06-30",
          monthlyAmount: null,
          feeItemId: FEE_HR,
          milestones: null,
          currencyCode: null,
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_INPUT_INVALID" });

    // Flip the L5 setting (the fingerprint's updated_at bump re-resolves).
    await setSetting("crm.contract_billing_mode", "hourly");
    const created = await withTenant(TENANT_C, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE02,
        title: "Hourly advisory",
        titleAr: null,
        scope: null,
        feeModel: "HOURLY",
        startDate: "2026-03-01",
        endDate: "2026-06-30",
        monthlyAmount: null,
        feeItemId: FEE_HR,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    C5 = created.contract.id;
    expect(await gridOf(C5)).toEqual([
      { key: "2026-03", type: "HOURLY_PERIOD", start: "2026-03-01", end: "2026-03-31", billDate: "2026-03-31", amount: null, feeItemId: FEE_HR, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-04", type: "HOURLY_PERIOD", start: "2026-04-01", end: "2026-04-30", billDate: "2026-04-30", amount: null, feeItemId: FEE_HR, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-05", type: "HOURLY_PERIOD", start: "2026-05-01", end: "2026-05-31", billDate: "2026-05-31", amount: null, feeItemId: FEE_HR, label: null, labelAr: null, status: "PLANNED" },
      { key: "2026-06", type: "HOURLY_PERIOD", start: "2026-06-01", end: "2026-06-30", billDate: "2026-06-30", amount: null, feeItemId: FEE_HR, label: null, labelAr: null, status: "PLANNED" },
    ]);

    // Under mode=hourly the retainer family is now the refused one.
    await expect(
      withTenant(TENANT_C, () =>
        contracts.create({
          partnerId: PARTNER,
          projectId: null,
          title: "No retainer under hourly",
          titleAr: null,
          scope: null,
          feeModel: "RETAINER",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          monthlyAmount: "100",
          feeItemId: FEE_RET,
          milestones: null,
          currencyCode: null,
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ContractInputInvalidError);

    // Flip back (order independence for the rest of the suite).
    await clearSetting("crm.contract_billing_mode");
  });

  it("renew: old → RENEWED + renewedToContractId; new DRAFT copy (carried milestones + fresh term); the renewal PATCH is lesson-1 shape (b)", async () => {
    const old = await withTenant(TENANT_C, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Delivery project 2026 (renewal host)",
        titleAr: null,
        scope: null,
        feeModel: "MILESTONES",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
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
    C7 = old.contract.id;
    await withTenant(TENANT_C, () => contracts.activate(C7, ACTOR));

    const { renewed, renewal } = await withTenant(TENANT_C, () =>
      contracts.renew(C7, { actorId: ACTOR }),
    );
    C7_RENEWAL = renewal.contract.id;
    expect(renewed.contract.status).toBe("RENEWED");
    expect(renewed.contract.renewedToContractId).toBe(renewal.contract.id);
    expect(renewal.contract.status).toBe("DRAFT"); // no CT number until its own activation
    expect(renewal.contract.contractNo).toBeNull();
    // The fresh term defaults: start = old end + 1d, same length (364d).
    expect(renewal.contract.startDate).toBe("2027-01-01");
    expect(renewal.contract.endDate).toBe("2027-12-31");
    expect(renewal.contract.partnerId).toBe(PARTNER);
    expect(renewal.contract.feeModel).toBe("MILESTONES");

    // The carried milestones: PLANNED rows shifted by the term offset (365d) —
    // listSchedule orders MILESTONE rows by label (Delivery before Signing).
    expect(await gridOf(C7_RENEWAL)).toEqual([
      { key: null, type: "MILESTONE", start: "2027-05-01", end: "2027-05-01", billDate: "2027-05-01", amount: "7000.0000", feeItemId: FEE_MIL, label: "Delivery", labelAr: null, status: "PLANNED" },
      { key: null, type: "MILESTONE", start: "2027-03-01", end: "2027-03-01", billDate: "2027-03-01", amount: "5000.0000", feeItemId: FEE_MIL, label: "Signing", labelAr: null, status: "PLANNED" },
    ]);
    // The OLD contract's grid stays as posted history (the copy is additive).
    expect((await gridOf(C7)).length).toBe(2);

    expect(await auditActions("service_contract", C7)).toContain("crm.contract.renewed");
    expect(await auditActions("service_contract", C7_RENEWAL)).toContain("crm.contract.renewal_created");

    // Lesson-1 shape (b): PATCH the RENEWAL DRAFT (milestones only, feeItemId
    // omitted) — the renewal copy's grid resolves the stored default.
    await withTenant(TENANT_C, () =>
      contracts.update(C7_RENEWAL, {
        milestones: [
          { label: "Signing", labelAr: null, dueDate: "2027-03-01", amount: "5000", feeItemId: null },
          { label: "Delivery", labelAr: null, dueDate: "2027-05-01", amount: "7500", feeItemId: null },
        ],
        actorId: ACTOR,
      }),
    );
    expect(await gridOf(C7_RENEWAL)).toEqual([
      { key: null, type: "MILESTONE", start: "2027-05-01", end: "2027-05-01", billDate: "2027-05-01", amount: "7500.0000", feeItemId: FEE_MIL, label: "Delivery", labelAr: null, status: "PLANNED" },
      { key: null, type: "MILESTONE", start: "2027-03-01", end: "2027-03-01", billDate: "2027-03-01", amount: "5000.0000", feeItemId: FEE_MIL, label: "Signing", labelAr: null, status: "PLANNED" },
    ]);

    // Only ACTIVE contracts renew: DRAFT and RENEWED both refuse.
    await expect(
      withTenant(TENANT_C, () => contracts.renew(C7_RENEWAL, { actorId: ACTOR })),
    ).rejects.toBeInstanceOf(ContractStateError);
    await expect(
      withTenant(TENANT_C, () => contracts.renew(C7, { actorId: ACTOR })),
    ).rejects.toBeInstanceOf(ContractStateError);
  });

  it("cancel (reason): DRAFT/ACTIVE → CANCELLED; the reason is required; terminal states refuse", async () => {
    await expect(
      withTenant(TENANT_C, () => contracts.cancel(C5, "   ", ACTOR)),
    ).rejects.toBeInstanceOf(ContractInputInvalidError);
    const cancelled = await withTenant(TENANT_C, () =>
      contracts.cancel(C5, "Client moved to a fixed-fee arrangement", ACTOR),
    );
    expect(cancelled.contract.status).toBe("CANCELLED");
    expect(cancelled.contract.cancelReason).toBe("Client moved to a fixed-fee arrangement");
    expect(cancelled.contract.cancelledAt).toBeTruthy();
    expect(await auditActions("service_contract", C5)).toContain("crm.contract.cancelled");

    // Terminal: every further guarded operation refuses.
    await expect(
      withTenant(TENANT_C, () => contracts.cancel(C5, "again", ACTOR)),
    ).rejects.toBeInstanceOf(ContractStateError);
    await expect(withTenant(TENANT_C, () => contracts.activate(C5, ACTOR))).rejects.toBeInstanceOf(
      ContractStateError,
    );
    await expect(
      withTenant(TENANT_C, () => contracts.update(C5, { title: "nope", actorId: ACTOR })),
    ).rejects.toBeInstanceOf(ContractStateError);
    await expect(
      withTenant(TENANT_C, () => contracts.renew(C5, { actorId: ACTOR })),
    ).rejects.toBeInstanceOf(ContractStateError);
  });
});

describe("advance tagging — the J-DEF reclass (§4 + §1 row 4 + §18 lesson 2)", () => {
  it("a posted on-account receipt posts J-RCP [DR cash · CR AR] with zero allocations", async () => {
    R1 = await seedOnAccountReceipt("500.0000", "2025-12-15", "On-account advance funding");
    expect(R1.allocatedAmount).toBe("0.0000"); // fully on-account (BR-027)

    const entry = await withTenant(TENANT_C, () =>
      journal.findEntryBySourceKey("receipt", R1!.id, "post"),
    );
    expect(entry).toBeDefined();
    const lines = await withTenant(TENANT_C, () => journal.listLines(entry!.id));
    expect(lines.map((line) => [line.accountCode, line.direction, line.amount])).toEqual([
      ["1111", "DEBIT", "500.0000"],
      ["1130", "CREDIT", "500.0000"],
    ]);
    expect(lines[1]!.partnerId).toBe(PARTNER);
  });

  it("policy ON: tag → J-DEF [DR AR_CONTROL (partner+project) · CR DEFERRED_REVENUE (neither)] + the AR subledger row + HELD + audit", async () => {
    await setSetting("crm.defer_advance_recognition", true);
    const before = await residueCounts();

    const advance = await withTenant(TENANT_C, () =>
      contracts.tagAdvance({
        contractId: C1,
        receiptId: R1!.id,
        amount: "500",
        note: "Advance against the retainer",
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    expect(advance.status).toBe("HELD");
    expect(advance.amount).toBe("500.0000");
    expect(advance.deferJournalId).toBeTruthy();

    // J-DEF — asserted through the journal store (the findEntryBySourceKey
    // read pattern); §18 lesson 2: ONLY the AR line carries the stamps.
    const entry = await withTenant(TENANT_C, () =>
      journal.findEntryBySourceKey("contract_advance", advance.id, "defer"),
    );
    expect(entry).toBeDefined();
    expect(entry!.sourceType).toBe("contract_advance");
    const lines = await withTenant(TENANT_C, () => journal.listLines(entry!.id));
    expect(lines.map((line) => [line.accountCode, line.direction])).toEqual([
      ["1130", "DEBIT"],
      ["2130", "CREDIT"],
    ]);
    const arLine = lines[0]!;
    expect(arLine.amount).toBe("500.0000");
    expect(arLine.partnerId).toBe(PARTNER);
    expect(arLine.projectId).toBe(CASE01); // §18 lesson 2: the AR line's project stamp
    const deferredLine = lines[1]!;
    expect(deferredLine.amount).toBe("500.0000");
    expect(deferredLine.partnerId).toBeNull();
    expect(deferredLine.projectId).toBeNull(); // lesson 2: NO project on the credit leg

    // The AR line's partner subledger row (the posting service's INV-009 leg).
    const client = await cClient();
    const subledger = await client.query<{
      partner_id: string;
      direction: string;
      amount: string;
      source_type: string;
      source_id: string;
    }>(
      `SELECT partner_id, direction, amount, source_type, source_id FROM partner_subledger_entries
        WHERE journal_entry_id = $1`,
      [entry!.id],
    );
    await client.end();
    expect(subledger.rows).toHaveLength(1);
    expect(subledger.rows[0]).toMatchObject({
      partner_id: PARTNER,
      direction: "DEBIT",
      amount: "500.0000",
      source_type: "contract_advance",
      source_id: advance.id,
    });

    expect(await auditActions("contract_advance", advance.id)).toEqual(["crm.contract_advance.tagged"]);
    const after = await residueCounts();
    expect(after.advances).toBe(before.advances + 1);
    expect(after.journals).toBe(before.journals + 1);

    // The listing read (row 28).
    const listed = await withTenant(TENANT_C, () => contracts.listAdvances(C1));
    expect(listed.map((row) => row.id)).toContain(advance.id);
  });

  it("insufficient on-account → typed ADVANCE_INSUFFICIENT_ON_ACCOUNT, zero residue", async () => {
    const before = await residueCounts();
    // R1 is fully held (500 tagged of 500) — a 600 tag can never fit.
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C1,
          receiptId: R1!.id,
          amount: "600",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ADVANCE_INSUFFICIENT_ON_ACCOUNT" });
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C1,
          receiptId: R1!.id,
          amount: "600",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(AdvanceInsufficientOnAccountError);
    const after = await residueCounts();
    expect(after).toEqual(before); // no journal, no advance row
  });

  it("duplicate tag (same receipt+contract+amount HELD) → typed ADVANCE_STATE", async () => {
    const before = await residueCounts();
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C1,
          receiptId: R1!.id,
          amount: "500",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ADVANCE_STATE" });
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C1,
          receiptId: R1!.id,
          amount: "500",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(AdvanceStateError);
    expect(await residueCounts()).toEqual(before);
  });

  it("policy OFF → link-only: a HELD row with NO journal (BR-027 pure)", async () => {
    await clearSetting("crm.defer_advance_recognition");
    R2 = await seedOnAccountReceipt("250.0000", "2026-01-20", "Second funding");
    const before = await residueCounts();

    const advance = await withTenant(TENANT_C, () =>
      contracts.tagAdvance({
        contractId: C1,
        receiptId: R2!.id,
        amount: "250",
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    expect(advance.status).toBe("HELD");
    expect(advance.deferJournalId).toBeNull(); // link-only
    expect(await residueCounts()).toEqual({ ...before, advances: before.advances + 1 });
    expect((await residueCounts()).journals).toBe(before.journals); // ZERO new journals
  });

  it("DEFERRED_REVENUE unmapped → typed PURPOSE_NOT_MAPPED, fail-closed zero residue (mapping restored)", async () => {
    await setSetting("crm.defer_advance_recognition", true);
    // Drop the tenant's DEFERRED_REVENUE mapping (the fresh-tenant posture).
    const su = await superuserClient();
    await su.query(
      `DELETE FROM account_purposes WHERE tenant_id = $1 AND purpose_key = 'DEFERRED_REVENUE'`,
      [TENANT_C],
    );
    await su.end();

    const r3 = await seedOnAccountReceipt("100.0000", "2026-02-05", "Third funding");
    const before = await residueCounts();
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C1,
          receiptId: r3.id,
          amount: "100",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PURPOSE_NOT_MAPPED" });
    // The whole ambient UoW rolled back — zero residue.
    expect(await residueCounts()).toEqual(before);

    // Restore the mapping (order independence for T47's suites).
    const restore = await superuserClient();
    const account = await withTenant(TENANT_C, () => accountingStore.findAccountByCode("2130"));
    await restore.query(
      `INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
       VALUES (gen_random_uuid(), $1, 'DEFERRED_REVENUE', $2, '2025-12-01')`,
      [TENANT_C, account!.id],
    );
    await restore.end();
    const mapped = await withTenant(TENANT_C, () => accountingStore.findActivePurpose("DEFERRED_REVENUE"));
    expect(mapped?.accountId).toBe(account!.id);
  });

  it("DRAFT contract → CONTRACT_STATE; unknown receipt → ADVANCE_STATE (the stable shipped contract)", async () => {
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C4, // DRAFT (the month-edge fixture never activated)
          receiptId: R2!.id,
          amount: "50",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONTRACT_STATE" });
    await expect(
      withTenant(TENANT_C, () =>
        contracts.tagAdvance({
          contractId: C1,
          receiptId: generateUuidV7(), // a well-formed uuid that exists nowhere
          amount: "50",
          note: null,
          noteAr: null,
          actorId: ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(AdvanceStateError);
    // Zero residue on both.
    const listed = await withTenant(TENANT_C, () => contracts.listAdvances(C4));
    expect(listed).toHaveLength(0);
  });
});

describe("billing preview (§11 row 26 — the T47 contract, read-only)", () => {
  it("wouldInvoice per PLANNED entry with billDate ≤ asOf; the boundary is inclusive-by-date", async () => {
    const preview = await withTenant(TENANT_C, () => contracts.billingPreview(C1, "2026-02-01"));
    expect(preview.asOf).toBe("2026-02-01");
    expect(preview.items.map((item) => item.entry.periodKey)).toEqual(["2026-01", "2026-02"]);

    const jan = preview.items[0]!;
    expect(jan.entry.billDate).toBe("2026-01-15");
    expect(jan.wouldInvoice).toEqual([
      {
        feeItemId: FEE_RET,
        qty: "1.000000",
        unitPrice: "1000.0000",
        description: `Legal retainer 2026 (amended) — retainer 2026-01`,
      },
    ]);
    expect(jan.pullableTimeEntries).toEqual([]);
    expect(jan.needsNarrative).toEqual([]);
    expect(jan.periodStatus).toBe("OPEN");
    expect(jan.periodLocked).toBe(false);

    // The date boundary: Feb 1 bills at asOf Feb 1, not at Jan 31.
    const janOnly = await withTenant(TENANT_C, () => contracts.billingPreview(C1, "2026-01-31"));
    expect(janOnly.items.map((item) => item.entry.periodKey)).toEqual(["2026-01"]);
    const none = await withTenant(TENANT_C, () => contracts.billingPreview(C1, "2026-01-14"));
    expect(none.items).toEqual([]);
  });

  it("an entry with a contract_invoices row is skipped (both guard keys: periodKey + milestoneScheduleId)", async () => {
    // Seed the FK targets (a branch + a minimal sales invoice row) + the
    // guard rows through the store (the T47 run's writer surface).
    const su = await superuserClient();
    await su.query(
      `INSERT INTO branches (id, tenant_id, code, name) VALUES (gen_random_uuid(), $1, 'MAIN', 'Main branch')
       ON CONFLICT DO NOTHING`,
      [TENANT_C],
    );
    const branch = (await su.query<{ id: string }>(`SELECT id FROM branches WHERE tenant_id = $1 AND code = 'MAIN'`, [TENANT_C])).rows[0]!;
    const invoiceId = generateUuidV7();
    await su.query(
      `INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date, due_date, currency_code)
       VALUES ($1, $2, $3, $4, 'CREDIT', '2026-01-20', '2026-02-19', 'SAR')`,
      [invoiceId, TENANT_C, branch.id, PARTNER],
    );
    await su.end();

    const c2Grid = await withTenant(TENANT_C, () => contracts.listSchedule(C2));
    const signingEntry = c2Grid.find((row) => row.milestoneLabel === "Signing")!;
    await withTenant(TENANT_C, () =>
      crmStore.insertContractInvoice({
        contractId: C1,
        invoiceId,
        periodKey: "2026-01",
        milestoneScheduleId: null,
        actorId: ACTOR,
      }),
    );
    await withTenant(TENANT_C, () =>
      crmStore.insertContractInvoice({
        contractId: C2,
        invoiceId,
        periodKey: null,
        milestoneScheduleId: signingEntry.id,
        actorId: ACTOR,
      }),
    );

    // C1: January is guarded → only February remains.
    const c1Preview = await withTenant(TENANT_C, () => contracts.billingPreview(C1, "2026-02-01"));
    expect(c1Preview.items.map((item) => item.entry.periodKey)).toEqual(["2026-02"]);

    // C2: Signing is guarded → only Delivery remains (asOf past both dates).
    const c2Preview = await withTenant(TENANT_C, () => contracts.billingPreview(C2, "2026-06-01"));
    expect(c2Preview.items.map((item) => item.entry.milestoneLabel)).toEqual(["Delivery"]);
    expect(c2Preview.items[0]!.wouldInvoice).toEqual([
      { feeItemId: FEE_MIL, qty: "1.000000", unitPrice: "7000.0000", description: "Delivery" },
    ]);

    // Row 29 (the listing) sees both guard rows.
    const guardRows = await withTenant(TENANT_C, () =>
      contracts.listContractInvoices({ contractId: C1, limit: 50 }),
    );
    expect(guardRows.map((row) => row.periodKey)).toEqual(["2026-01"]);
    expect(guardRows[0]!.invoiceId).toBe(invoiceId);
    expect(guardRows[0]!.status).toBe("GENERATED");
  });

  it("periodLocked: a LOCKED billDate period flags the entry (PeriodService lock → reopen)", async () => {
    const february = await withTenant(TENANT_C, () =>
      accountingStore.findPeriodForDate("2026-02-15"),
    );
    expect(february?.status).toBe("OPEN");
    await withTenant(TENANT_C, () => periods.softClose(ACTOR, february!.id));
    await withTenant(TENANT_C, () => periods.lock(ACTOR, february!.id));

    const preview = await withTenant(TENANT_C, () => contracts.billingPreview(C1, "2026-02-01"));
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0]!.entry.periodKey).toBe("2026-02");
    expect(preview.items[0]!.periodStatus).toBe("LOCKED");
    expect(preview.items[0]!.periodLocked).toBe(true); // the T47 run refuses dead drafts (INV-011)

    // Reopen (§16 order independence — no PERIOD_LOCKED packs left behind).
    await withTenant(TENANT_C, () => periods.reopen(ACTOR, february!.id, "T46 preview fixture reopen"));
    const reopened = await withTenant(TENANT_C, () => contracts.billingPreview(C1, "2026-02-01"));
    expect(reopened.items[0]!.periodStatus).toBe("OPEN");
    expect(reopened.items[0]!.periodLocked).toBe(false);
  });
});

describe("HTTP surface (§11 rows 18–29 — the real pipeline)", () => {
  it("create → activate → schedule → preview → advances → contract-invoices; PUT 409; mode 422; cancel 200; unknown 404", async () => {
    // Row 19 — POST create (DRAFT, bilingual, project-linked).
    const created = await httpCall("POST", "/api/v1/crm/contracts", {
      partnerId: PARTNER,
      projectId: CASE01,
      title: "HTTP retainer",
      titleAr: "عقد اختبار",
      scope: null,
      feeModel: "RETAINER",
      startDate: "2026-01-15",
      endDate: "2026-06-14",
      monthlyAmount: "1000",
      feeItemId: FEE_RET,
      currencyCode: "SAR",
      note: null,
      noteAr: null,
    });
    expect(created.status).toBe(201);
    const createdData = created.body.data as {
      contract: { id: string; status: string; contractNo: string | null; titleAr: string | null };
      isExpired: boolean;
    };
    expect(createdData.contract.status).toBe("DRAFT");
    expect(createdData.contract.contractNo).toBeNull();
    expect(createdData.contract.titleAr).toBe("عقد اختبار");
    HTTP_CONTRACT = createdData.contract.id;

    // Rows 20/21 — the read + the DRAFT edit, then row 22 activation.
    const edited = await httpCall("PUT", `/api/v1/crm/contracts/${HTTP_CONTRACT}`, {
      scope: "Amended over HTTP while DRAFT",
    });
    expect(edited.status).toBe(200);
    expect((edited.body.data as { contract: { scope: string | null } }).contract.scope).toBe(
      "Amended over HTTP while DRAFT",
    );

    const activated = await httpCall("POST", `/api/v1/crm/contracts/${HTTP_CONTRACT}/activate`);
    expect(activated.status).toBe(201); // the action-POST convention (no @HttpCode override — the T45 shape)
    const activatedData = activated.body.data as {
      contract: { status: string; contractNo: string | null };
    };
    expect(activatedData.contract.status).toBe("ACTIVE");
    expect(activatedData.contract.contractNo).toMatch(/^CT-2026-\d{5}$/);

    // Row 25 — the schedule through HTTP: the §15 six entries.
    const schedule = await httpCall("GET", `/api/v1/crm/contracts/${HTTP_CONTRACT}/schedule`);
    expect(schedule.status).toBe(200);
    const scheduleRows = schedule.body.data as { periodKey: string | null; amount: string | null }[];
    expect(scheduleRows.map((row) => row.periodKey)).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    ]);
    expect(scheduleRows.every((row) => row.amount === "1000.0000")).toBe(true);

    // Row 26 — the preview through HTTP.
    const preview = await httpCall(
      "GET",
      `/api/v1/crm/contracts/${HTTP_CONTRACT}/billing-preview?asOf=2026-02-01`,
    );
    expect(preview.status).toBe(200);
    const previewData = preview.body.data as {
      items: { entry: { periodKey: string | null }; periodStatus: string }[];
    };
    expect(previewData.items.map((item) => item.entry.periodKey)).toEqual(["2026-01", "2026-02"]);
    expect(previewData.items.every((item) => item.periodStatus === "OPEN")).toBe(true);

    // Rows 27/28 — advances (empty) via HTTP.
    const advances = await httpCall("GET", `/api/v1/crm/contracts/${HTTP_CONTRACT}/advances`);
    expect(advances.status).toBe(200);
    expect(advances.body.data).toEqual([]);

    // Row 29 — the contract-invoices listing via HTTP.
    const guardList = await httpCall(
      "GET",
      `/api/v1/crm/contract-invoices?contractId=${HTTP_CONTRACT}&status=GENERATED`,
    );
    expect(guardList.status).toBe(200);
    expect(guardList.body.data).toEqual([]);

    // Row 18 — the filtered list.
    const listed = await httpCall("GET", "/api/v1/crm/contracts?status=ACTIVE&limit=10");
    expect(listed.status).toBe(200);
    const listRows = listed.body.data as { contract: { id: string; status: string } }[];
    expect(listRows.some((row) => row.contract.id === HTTP_CONTRACT)).toBe(true);

    // The error shapes through the real filter: PUT on ACTIVE → 409
    // CONTRACT_STATE; a mode-refused create → 422 CONTRACT_INPUT_INVALID;
    // the unknown id → 404 CONTRACT_NOT_FOUND (A7).
    const putActive = await httpCall("PUT", `/api/v1/crm/contracts/${HTTP_CONTRACT}`, {
      title: "nope",
    });
    expect(putActive.status).toBe(409);
    expect(putActive.body.error?.code).toBe("CONTRACT_STATE");

    const modeRefused = await httpCall("POST", "/api/v1/crm/contracts", {
      partnerId: PARTNER,
      title: "HTTP hourly refusal",
      feeModel: "HOURLY",
      startDate: "2026-03-01",
      endDate: "2026-06-30",
      feeItemId: FEE_HR,
    });
    expect(modeRefused.status).toBe(422);
    expect(modeRefused.body.error?.code).toBe("CONTRACT_INPUT_INVALID");

    const unknown = await httpCall("GET", "/api/v1/crm/contracts/99999999-9999-4999-8999-999999999991");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe("CONTRACT_NOT_FOUND");

    // Row 24 — cancel through HTTP; the cancelled contract leaves the ACTIVE list.
    const cancelled = await httpCall("POST", `/api/v1/crm/contracts/${HTTP_CONTRACT}/cancel`, {
      reason: "HTTP smoke cancellation",
    });
    expect(cancelled.status).toBe(201); // the action-POST convention
    expect((cancelled.body.data as { contract: { status: string } }).contract.status).toBe("CANCELLED");
    const activeAfter = await httpCall("GET", "/api/v1/crm/contracts?status=ACTIVE&limit=10");
    const activeRows = activeAfter.body.data as { contract: { id: string } }[];
    expect(activeRows.some((row) => row.contract.id === HTTP_CONTRACT)).toBe(false);
  });
});
