import { randomInt } from "node:crypto";

import { ensureTestDb, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PasswordService } from "../../modules/identity/api/identity";
import { RegistrationService } from "../../modules/tenancy/application/registration-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService as TaxRegistrationService } from "../../modules/tax/application/registration-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { TemplateApplyService } from "../../modules/configuration/application/apply/apply-service";
import { TemplateSwitchService } from "../../modules/configuration/application/switch/switch-service";
import { TemplateDriftService } from "../../modules/configuration/application/closure/drift-service";

/**
 * PHASE-015 T5–T7 db-suite fixtures: fresh business-plan tenants through the
 * REAL registration service (mirroring engine.db.spec.ts), a minimal
 * posting substrate for back-office invoice proofs (the golden NS
 * service-line shape from the sales suite — CoA + purposes + FY + branch +
 * customer + SA tax registration + NOT_SUBJECT code), and the template
 * services wired exactly as the module registers them.
 *
 * Every tenant this file provisions is PRIVATE to the configuration specs
 * (unique emails + own tenant rows) — no cross-suite ordering couplings.
 */

const audit = new AuditService(new DrizzleAuditStore());
const repository = new ConfigRepository();

export const applyService = new TemplateApplyService(repository, audit);
export const switchService = new TemplateSwitchService(repository, audit);
export const driftService = new TemplateDriftService(
  repository,
  new InboxService(),
  audit,
);
export const resolver = new ResolveEffectiveConfigService(repository);

/** Provision a fresh SA tenant on the business TRIAL plan (real flow). */
export async function provisionBusinessTenant(
  slug: string,
  templateKey = "industry.retail",
): Promise<{ tenantId: string; ownerId: string }> {
  ensureTestDb();
  resetConfigurationCache();
  const passwords = new PasswordService();
  const email = { enqueue: async () => undefined } as never;
  const registration = new RegistrationService(passwords, audit, email);
  const provisioned = await registration.register({
    businessName: `Template Co ${slug}`,
    businessNameAr: `شركة القوالب ${slug}`,
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: templateKey,
    taxRegistrationStatus: "REGISTERED",
    taxRegistrationNumber: "310000000000003",
    ownerEmail: `tpl-${slug}-${Date.now()}-${randomInt(1, 10_000)}@provision.test`,
    ownerFullName: `Template Owner ${slug}`,
    ownerPassword: "an-extremely-strong-passphrase-7",
    ip: `10.41.${randomInt(1, 250)}.1`,
  });
  resetConfigurationCache();
  return { tenantId: provisioned.tenantId, ownerId: provisioned.ownerUserId };
}

/** The minimal back-office posting substrate (service-line invoices). */
export interface PostingSubstrate {
  readonly tenantId: string;
  readonly ownerId: string;
  /** SoD (BR-034): the owner cannot approve their own invoice — a second
   *  tenant user approves while the owner creates/submits/posts. */
  readonly approverId: string;
  readonly fiscalYearId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly arControlId: string;
  readonly salesRevenueId: string;
  readonly serviceAccountId: string;
  readonly notSubjectTaxCodeId: string;
}

export async function seedPostingSubstrate(
  tenantId: string,
  ownerId: string,
  slug: string,
): Promise<PostingSubstrate> {
  return withTenant(tenantId, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertBranch, listBranches, findAccountByCode, findActivePurpose, insertAccountPurpose } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const taxCodes = new TaxCodesService(audit);
    const registrations = new TaxRegistrationService(audit);
    const periods = new PeriodService(audit);

    await seedMasterDataBasics();
    await provisionCoaTemplate();

    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await findAccountByCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account!.id, activeFrom: "2025-12-01" });
      return account!.id;
    };
    const arControlId = await mapPurpose("AR_CONTROL", "1130");
    const salesRevenueId = await mapPurpose("SALES_REVENUE", "4100");
    const serviceAccount = await findAccountByCode("5210");

    const fiscalYear = await periods.createYear(ownerId, {
      name: `FY-${slug}`,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });

    const branches = await listBranches(null);
    const main =
      branches.find((branch) => branch.code === "MAIN") ??
      (await insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));

    // A second ACTIVE user for the approval leg (SoD: the creator of a
    // document may never approve it — same shape as the sales fixtures).
    const approverId = await (async () => {
      const su = await superuserClient();
      const row = await su.query<{ id: string }>(
        `INSERT INTO users (id, email, full_name, password_hash, status)
         VALUES (gen_random_uuid(), $1, 'Template Approver ${slug}', 'x', 'ACTIVE')
         RETURNING id::text`,
        [`tpl-approver-${slug.toLowerCase()}-${Date.now()}-${randomInt(1, 10_000)}@provision.test`],
      );
      await su.end();
      return row.rows[0]!.id;
    })();

    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((term) => term.days === 30)!;
    const customer = await partnersStore.insertPartner({
      kind: "CUSTOMER",
      code: `CUST-${slug}`,
      name: "عميل القوالب",
      nameAr: null,
      taxNumber: null,
      creditLimit: null,
      creditTermsId: net30.id,
      priceListId: null,
    });

    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: ownerId,
        note: "template fixture registration",
      });
    }
    const codes = await taxCodes.list({ countryCode: "SA" });
    const notSubject =
      codes.find((row) => row.code === "NS") ??
      (await taxCodes.create({
        code: "NS",
        name: "Not subject",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "NOT_SUBJECT",
        actorId: ownerId,
      }));

    return {
      tenantId,
      ownerId,
      approverId,
      fiscalYearId: fiscalYear.id,
      branchId: main.id,
      customerId: customer.id,
      arControlId,
      salesRevenueId,
      serviceAccountId: serviceAccount!.id,
      notSubjectTaxCodeId: notSubject.id,
    };
  });
}

/**
 * Post one back-office service invoice through the REAL sales flow
 * (create → submit → approve → post): DR AR 100 / CR service 100, no VAT
 * (NOT_SUBJECT) — the golden NS shape from the sales suite. PHASE-031:
 * the optional insured/claimRef pair rides the same flow (a claim invoice
 * is an ordinary CREDIT invoice whose only difference is the external
 * claim_ref marker — migration 0042; the journals are byte-identical).
 */
export async function postServiceInvoice(
  substrate: PostingSubstrate,
  note: string,
  invoiceDate = "2026-02-15",
  claim?: { insured: boolean; claimRef: string | null },
): Promise<{ invoiceId: string; invoiceNo: string; journalEntryId: string }> {
  const posting = new PostingService(audit, new PartnerSubledgerService());
  const numbering = new NumberingService(audit);
  const invoices = new SalesInvoiceService(audit, posting, numbering, new TaxResolverService());
  return withTenant(substrate.tenantId, async () => {
    const created = await invoices.create({
      branchId: substrate.branchId,
      customerId: substrate.customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      insured: claim?.insured ?? false,
      claimRef: claim?.claimRef ?? null,
      note,
      noteAr: null,
      actorId: substrate.ownerId,
      lines: [
        {
          itemId: null,
          accountId: substrate.serviceAccountId,
          deliveryLineId: null,
          description: "service",
          descriptionAr: null,
          qty: "1",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: substrate.notSubjectTaxCodeId,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    });
    await invoices.submit(created.id, substrate.ownerId);
    // BR-034 SoD: approve as the SECOND user (the owner created the draft).
    await invoices.approve(created.id, substrate.approverId, false);
    const result = await invoices.post(created.id, substrate.ownerId);
    return {
      invoiceId: created.id,
      invoiceNo: result.invoiceNo!,
      journalEntryId: result.journalEntryId!,
    };
  });
}

/** Grant a tenant the full business-plan key set (MANUAL, no expiry). */
export async function grantBusinessEntitlements(tenantId: string): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source, expires_at)
     SELECT gen_random_uuid(), $1, key, 'MANUAL', NULL
     FROM plans p, unnest(p.feature_keys) AS key
     WHERE p.key = 'business'
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [tenantId],
  );
  await su.end();
  resetConfigurationCache();
}

/** Revoke one feature key from a tenant (plan-downgrade simulation). */
export async function revokeEntitlement(tenantId: string, featureKey: string): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM entitlements WHERE tenant_id = $1 AND feature_key = $2`, [
    tenantId,
    featureKey,
  ]);
  await su.end();
  resetConfigurationCache();
}

/** Grant one feature key (plan-upgrade / repair simulation). */
export async function grantEntitlement(tenantId: string, featureKey: string): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source, expires_at)
     VALUES (gen_random_uuid(), $1, $2, 'MANUAL', NULL)
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [tenantId, featureKey],
  );
  await su.end();
  resetConfigurationCache();
}

/** The tenant-level series registry rows the apply/switch registered. */
export async function tenantLevelSeries(
  tenantId: string,
): Promise<{ docType: string; format: string; nextValue: string }[]> {
  const su = await superuserClient();
  const rows = await su.query<{ docType: string; format: string; nextValue: string }>(
    `SELECT doc_type AS "docType", format, next_value::text AS "nextValue"
     FROM numbering_sequences
     WHERE tenant_id = $1 AND branch_id IS NULL AND period_key IS NULL
     ORDER BY doc_type`,
    [tenantId],
  );
  await su.end();
  return rows.rows;
}

/** Audit actions recorded for a tenant (the mutation evidence). */
export async function auditActions(tenantId: string, action: string): Promise<number> {
  const su = await superuserClient();
  const rows = await su.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events WHERE tenant_id = $1 AND action = $2`,
    [tenantId, action],
  );
  await su.end();
  return Number(rows.rows[0]!.n);
}
