import { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import {
  appClient,
  ensureTestDb,
  seedTenants,
  superuserClient,
} from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { FxService } from "../../modules/accounting/application/fx-service";
import { GlQueries } from "../../modules/accounting/application/gl-queries";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { OpeningBalancesPostingService } from "../../modules/accounting/application/opening-balances-service";
import { YearEndService } from "../../modules/accounting/application/year-end-service";
import { ReconciliationService } from "../../modules/accounting/application/reconciliation-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";

/**
 * PHASE-007 accounting db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production code
 * paths do — no direct journal inserts outside the explicitly-labeled
 * trigger/guard proofs. The CoA substrate is instantiated exactly like
 * onboarding does (template accounts + purpose markers), so purpose
 * resolution matches the production shape.
 */

export const ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";

/** Dedicated accounting-suite tenant (SAR base): keeps the PHASE-006
 * suites' exact-code assertions (P-000001…, draft matrices) intact —
 * the accounting flows consume their own isolated tenant. */
export const TENANT_A = "33333333-3333-3333-3333-333333333333";

const audit = new AuditService(new DrizzleAuditStore());
export const posting = new PostingService(audit, new PartnerSubledgerService());
export const journals = new JournalService(audit, posting);
export const coa = new CoaService(audit);
export const periods = new PeriodService(audit);
export const fx = new FxService(audit);
export const gl = new GlQueries();
export const numbering = new NumberingService(audit);
export const opening = new OpeningBalancesPostingService(audit, posting);
export const yearEnd = new YearEndService(audit, posting);
export const reconciliation = new ReconciliationService(audit);

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export type { Client };

/** Boots the suite db + the accounting substrate for the dedicated tenant. */
export async function setupAccountingFixture(): Promise<void> {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant C (accounting)', 'المستأجر ج', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'accounting-actor@fixture.test', 'Accounting Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR],
  );
  await su.end();
  await withTenant(TENANT_A, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();
    // Tenant setup step (the fail-closed gap the 0008 header documents):
    // map the §2 purposes the template deliberately leaves unmarked —
    // CASH → 1111 (Cash — main) and OPENING_EQUITY → 3100 (Capital) —
    // exactly the production flow the opening-balances workspace requires
    // (unmapped → PURPOSE_NOT_MAPPED, proven in the golden failure pack).
    const { findAccountByCode, findActivePurpose } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const { insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    for (const [purposeKey, code] of [
      ["CASH", "1111"],
      ["OPENING_EQUITY", "3100"],
    ] as const) {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) continue;
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      await insertAccountPurpose({
        purposeKey,
        accountId: account.id,
        activeFrom: new Date().toISOString().slice(0, 10),
      });
    }
  });
}

/** Fresh superuser client bound at call time. */
export async function su(): Promise<Client> {
  return superuserClient();
}

export const APPROVER = "aaaaaaaa-0000-4000-8000-00000000000b";

/** The distinct SoD approver (BR-034: creator ≠ approver by default). */
export async function ensureApprover(): Promise<string> {
  const client = await superuserClient();
  await client.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'accounting-approver@fixture.test', 'Accounting Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [APPROVER],
  );
  await client.end();
  return APPROVER;
}

/** Deterministic ISO date helpers over the fixture year 2026. */
export const YEAR_START = "2026-01-01";
export const YEAR_END = "2026-12-31";
export const OPENING_DATE = "2025-12-31";

export interface AccountIds {
  cash: string;
  arControl: string;
  apControl: string;
  salesRevenue: string;
  retainedEarnings: string;
  openingEquity: string;
  closing: string;
  fxGain: string;
  fxLoss: string;
  rentExpense: string;
}

/** Resolve the template's purpose-mapped accounts (production resolution). */
export async function resolveAccounts(): Promise<AccountIds> {
  return withTenant(TENANT_A, resolveAccountsInTenant);
}

async function resolveAccountsInTenant(): Promise<AccountIds> {
  const { findActivePurpose, findAccountByCode } = await import(
    "../../modules/accounting/infrastructure/accounting.store"
  );
  const ids = {} as Record<keyof AccountIds, string>;
  const map: Record<keyof AccountIds, string> = {
    cash: "CASH",
    arControl: "AR_CONTROL",
    apControl: "AP_CONTROL",
    salesRevenue: "SALES_REVENUE",
    retainedEarnings: "RETAINED_EARNINGS",
    openingEquity: "OPENING_EQUITY",
    closing: "CLOSING",
    fxGain: "FX_GAIN",
    fxLoss: "FX_LOSS",
    rentExpense: "5210",
  };
  for (const [key, purposeOrCode] of Object.entries(map)) {
    if (/^\d+$/.test(purposeOrCode)) {
      const account = await findAccountByCode(purposeOrCode);
      if (account === undefined) throw new Error(`fixture account ${purposeOrCode} missing`);
      ids[key as keyof AccountIds] = account.id;
      continue;
    }
    const mapping = await findActivePurpose(purposeOrCode);
    if (mapping === undefined) throw new Error(`fixture purpose ${purposeOrCode} unmapped`);
    ids[key as keyof AccountIds] = mapping.accountId;
  }
  return ids as AccountIds;
}

/** Create the fixture fiscal year (idempotent — returns the existing row). */
export async function ensureFiscalYear(name = "FY2026"): Promise<{ id: string }> {
  return withTenant(TENANT_A, async () => {
    const { findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const existing = await findFiscalYearByName(name);
    if (existing !== undefined) return { id: existing.id };
    const created = await periods.createYear(ACTOR, {
      name,
      startDate: YEAR_START,
      endDate: YEAR_END,
    });
    return { id: created.id };
  });
}

/**
 * Cross-suite order-independence restore (PHASE-008 reality-audit repair of a
 * PHASE-007 latent defect): the suites that exercise the PC state machine
 * soft-close/lock shared FY2026 months of tenant A, while every other suite
 * posts into those months assuming OPEN (gl-perf → September, FX-reval golden
 * → September + October reversal, concurrency → May, recurring goldens →
 * July/November). Whether the scheduler runs a mutating suite first used to
 * decide if a later suite crashed with PERIOD_LOCKED — observed live after
 * the five treasury spec files perturbed the vitest file order. Mutating
 * suites call this in afterAll to restore the pristine all-OPEN state, so no
 * cross-file order can couple two suites. Reopen is the public INV-020 flow
 * (audited); the extra reopen audit rows are inert for every other suite.
 */
export async function restorePeriodsOpen(months: string[], name = "FY2026"): Promise<void> {
  await withTenant(TENANT_A, async () => {
    const store = await import("../../modules/accounting/infrastructure/accounting.store");
    const year = await store.findFiscalYearByName(name);
    if (year === undefined) return;
    for (const period of await store.listPeriods(year.id)) {
      if (period.kind !== "REGULAR" || period.status === "OPEN") continue;
      if (!months.some((month) => period.name.endsWith(`-${month}`))) continue;
      await periods.reopen(ACTOR, period.id, "cross-suite state restore (order independence)");
    }
  });
}

/** A balanced two-line journal spec against arbitrary accounts. */
export function manualSpec(input: {
  docId: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  entryDate?: string;
  currency?: string;
  exchangeRate?: string;
  debitPartnerId?: string;
  creditPartnerId?: string;
  fiscalPeriodId?: string;
}): Parameters<typeof posting.post>[0] {
  return {
    source: { docType: "journal_entry", docId: input.docId, operation: "post" },
    entryDate: input.entryDate ?? "2026-01-15",
    description: { en: "fixture journal", ar: "قيد تجريبي" },
    currency: input.currency ?? "SAR",
    exchangeRate: input.exchangeRate,
    fiscalPeriodId: input.fiscalPeriodId,
    lines: [
      {
        accountId: input.debitAccountId,
        direction: "DEBIT",
        amount: input.amount,
        partnerId: input.debitPartnerId,
      },
      {
        accountId: input.creditAccountId,
        direction: "CREDIT",
        amount: input.amount,
        partnerId: input.creditPartnerId,
      },
    ],
  };
}

export function newDocId(): string {
  return generateUuidV7();
}

/** Zero-residue probe: no journal rows for the source key (ACCOUNTING_TESTS §1). */
export async function assertZeroResidue(docId: string): Promise<void> {
  await withTenant(TENANT_A, async () => {
    const { findEntryBySourceKey } = await import(
      "../../modules/accounting/infrastructure/journal.store"
    );
    const entry = await findEntryBySourceKey("journal_entry", docId, "post");
    if (entry !== undefined) {
      throw new Error(`zero-residue violated: entry ${entry.id} exists for ${docId}`);
    }
  });
}
