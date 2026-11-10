import { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { VatReturnService } from "../../modules/tax/application/vat-return-service";
import { PackService } from "../../modules/tax/application/pack-service";
import { EInvoicingService } from "../../modules/tax/application/einvoicing-service";
import { TaxReconciliationService } from "../../modules/tax/application/tax-reconciliation-service";
import { ExpenseService } from "../../modules/treasury/application/expense-service";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { FilesService } from "../../modules/files/api/files";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";

/**
 * PHASE-009 tax db-suite fixtures (ACCOUNTING_TESTS §1/§8): real PostgreSQL
 * 16 through the app-role services exactly as production paths run — every
 * tax-carrying posting flows through PostingEngine.post, every summary row
 * through the tax posting adapter, nothing inserts GL rows directly.
 *
 * Per-pack tenants: each jurisdiction's suite provisions its own tenant
 * (country + currency per the pack: SA/SAR, AE/AED, BH/BHD, OM/OMR, EG/EGP,
 * JO/JOD for the VAT packs; KW/KWD, QA/QAR, YE/YER, IQ/IQD for the NO_VAT /
 * planned packs) with the onboarding-shaped CoA substrate + the purpose
 * mappings the template deliberately leaves unmapped (VAT_RECOVERABLE,
 * VAT_EXPENSED) — the fail-closed posture this phase's fixtures exercise.
 */

const audit = new AuditService(new DrizzleAuditStore());
const subledgerPort = new PartnerSubledgerService();
const posting = new PostingService(audit, subledgerPort);
const numbering = new NumberingService(audit);
const pettyCash = new PettyCashGuard(audit);
export const taxResolver = new TaxResolverService();
const files = new FilesService(new S3FilesStore());

export const taxCodes = new TaxCodesService(audit);
export const registrations = new RegistrationService(audit);
export const vatReturns = new VatReturnService(audit, files);
export const packs = new PackService(audit);
export const einvoicing = new EInvoicingService(audit);
export const taxReconciliation = new TaxReconciliationService(audit);
export const expenses = new ExpenseService(audit, posting, numbering, pettyCash, taxResolver);
export const tPosting = posting;
export const tPeriods = new PeriodService(audit);
export const tCoa = new CoaService(audit);

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export type { Client };

export const X_ACTOR = "99999999-0000-4000-8000-000000000099";

export interface PackTenant {
  readonly tenantId: string;
  readonly countryCode: string;
  readonly currencyCode: string;
  readonly accountIds: {
    cash: string;
    arControl: string;
    apControl: string;
    salesRevenue: string;
    vatPayable: string;
    vatRecoverable: string;
    vatExpensed: string;
    rentExpense: string;
  };
  readonly taxCodeIds: {
    standard: string;
    zero: string;
    exempt: string;
    reverseCharge: string;
    notSubject: string;
  };
  readonly partnerIds: { customer: string; supplier: string };
}

const PACK_IDS: Readonly<Record<string, string>> = Object.freeze({
  SA: "55555555-0000-4000-8000-0000000055a1",
  AE: "55555555-0000-4000-8000-0000000055a2",
  BH: "55555555-0000-4000-8000-0000000055a3",
  KW: "55555555-0000-4000-8000-0000000055a4",
  OM: "55555555-0000-4000-8000-0000000055a5",
  QA: "55555555-0000-4000-8000-0000000055a6",
  YE: "55555555-0000-4000-8000-0000000055a7",
  EG: "55555555-0000-4000-8000-0000000055a8",
  JO: "55555555-0000-4000-8000-0000000055a9",
  IQ: "55555555-0000-4000-8000-0000000055aa",
});

const PACK_CURRENCIES: Readonly<Record<string, string>> = Object.freeze({
  SA: "SAR", AE: "AED", BH: "BHD", KW: "KWD", OM: "OMR",
  QA: "QAR", YE: "YER", EG: "EGP", JO: "JOD", IQ: "IQD",
});

const provisioned = new Map<string, PackTenant>();

/**
 * Provision (idempotently) a full per-pack tenant: CoA template + purpose
 * mappings (incl. the deliberately-unmapped VAT purposes via dedicated
 * accounts), FY2026, partners, a REGISTERED tax registration, and the
 * canonical five tax codes.
 */
export async function setupPackTenant(
  countryCode: string,
  options: { registrationStatus?: "REGISTERED" | "NOT_REGISTERED" } = {},
): Promise<PackTenant> {
  const country = countryCode.toUpperCase();
  const cached = provisioned.get(country);
  if (cached !== undefined) return cached;
  ensureTestDb();
  const currency = PACK_CURRENCIES[country] ?? "SAR";
  const tenantId = PACK_IDS[country] ?? PACK_IDS.SA!;

  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, $2, 'مستأجر الحزمة', $3, $4, 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, `Pack Tenant ${country}`, currency, country],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, $2, 'Tax Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [X_ACTOR, `tax-actor-${country.toLowerCase()}@fixture.test`],
  );
  await superuser.end();

  const accountIds = {} as PackTenant["accountIds"];
  const taxCodeIds = {} as PackTenant["taxCodeIds"];
  const partnerIds = {} as PackTenant["partnerIds"];

  await withTenant(tenantId, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // The tenant setup step: map the purposes the template leaves unmapped —
    // VAT_RECOVERABLE gains a dedicated child account; VAT_EXPENSED uses the
    // template's 5290 (the fail-closed PURPOSE_NOT_MAPPED posture is
    // exercised by the failure packs, not by fixture luck).
    const byCode = async (code: string) => {
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    accountIds.arControl = await mapPurpose("AR_CONTROL", "1130");
    accountIds.apControl = await mapPurpose("AP_CONTROL", "2110");
    accountIds.salesRevenue = await mapPurpose("SALES_REVENUE", "4100");
    accountIds.vatPayable = await mapPurpose("VAT_PAYABLE", "2120");
    accountIds.vatExpensed = await mapPurpose("VAT_EXPENSED", "5290");
    accountIds.rentExpense = (await byCode("5210")).id;
    // Dedicated VAT input-tax account (child of 1150) + purpose mapping.
    let vatRecoverableAccount = await findAccountByCode("1155");
    if (vatRecoverableAccount === undefined) {
      const parent = await byCode("1150");
      vatRecoverableAccount = await tCoa.create(X_ACTOR, {
        code: "1155",
        name: "VAT input tax (recoverable)",
        nameAr: "ض.ق.م المدخلات (قابلة للخصم)",
        type: "ASSET",
        parentId: parent.id,
        currencyCode: null,
        isGroup: false,
      });
    }
    accountIds.vatRecoverable = await mapPurpose("VAT_RECOVERABLE", "1155");
    accountIds.cash = await mapPurpose("CASH", "1111");

    // Fiscal year spanning the whole pack timeline.
    const existingYear = await findFiscalYearByName(`FY2026-${country}`);
    if (existingYear === undefined) {
      await tPeriods.createYear(X_ACTOR, {
        name: `FY2026-${country}`,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
    }

    // Partners (the sale/purchase scenario counterparties).
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const ensurePartner = async (code: string, name: string, kind: "CUSTOMER" | "SUPPLIER") => {
      const existing = await partnersStore.findPartnerByCode(code);
      if (existing !== undefined) return existing;
      return partnersStore.insertPartner({
        kind,
        code,
        name: `${name} (${country})`,
        nameAr: `${name} (${country})`,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
    };
    partnerIds.customer = (await ensurePartner(`TAX-CUST-${country}`, "Tax Customer", "CUSTOMER")).id;
    partnerIds.supplier = (await ensurePartner(`TAX-SUPP-${country}`, "Tax Supplier", "SUPPLIER")).id;

    // Registration: REGISTERED by default (per-pack scenarios flip it).
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: country,
        status: options.registrationStatus ?? "REGISTERED",
        registrationNumber:
          (options.registrationStatus ?? "REGISTERED") === "REGISTERED" ? "310000000000003" : null,
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: X_ACTOR,
        note: "pack fixture registration",
      });
    }

    // The canonical five tax codes.
    const ensureCode = async (
      code: string,
      name: string,
      treatment: "STANDARD_RATED" | "ZERO_RATED" | "EXEMPT" | "REVERSE_CHARGE" | "NOT_SUBJECT",
    ) => {
      const existing = (await taxCodes.list({ countryCode: country })).find((row) => row.code === code);
      if (existing !== undefined) return existing.id;
      return (
        await taxCodes.create({
          code,
          name,
          nameAr: null,
          countryCode: country,
          defaultTreatment: treatment,
          actorId: X_ACTOR,
        })
      ).id;
    };
    taxCodeIds.standard = await ensureCode("STD", `Standard (${country})`, "STANDARD_RATED");
    taxCodeIds.zero = await ensureCode("ZERO", "Zero-rated", "ZERO_RATED");
    taxCodeIds.exempt = await ensureCode("EXEMPT", "Exempt", "EXEMPT");
    taxCodeIds.reverseCharge = await ensureCode("RC", "Reverse charge", "REVERSE_CHARGE");
    taxCodeIds.notSubject = await ensureCode("NS", "Not subject", "NOT_SUBJECT");
  });

  const tenant: PackTenant = {
    tenantId,
    countryCode: country,
    currencyCode: currency,
    accountIds,
    taxCodeIds,
    partnerIds,
  };
  provisioned.set(country, tenant);
  return tenant;
}

/** Fresh superuser client bound at call time. */
export async function su(): Promise<Client> {
  return superuserClient();
}
