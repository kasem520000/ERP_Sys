import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Tax store (PHASE-009): the ONLY writer of tax_codes, tax_registrations,
 * tax_pack_bindings, tax_document_summaries (append-only — the INV-012
 * substrate reached exclusively through the tax posting adapter inside the
 * posting transaction), vat_returns, and e_invoicing_submissions. Pack
 * tables (jurisdictions/jurisdiction_tax_rates/tax_treatments) are GLOBAL
 * read-only reference data — SELECT-only grants for erp_app; writes ship as
 * erp_migrate seed migrations (grant-asserted).
 *
* Every statement runs in the caller's tenant UoW (the stores-before
 * pattern) so a failure anywhere rolls the whole business operation back.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("tax access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- global reference reads (pack tables — no RLS by design) -------------------------

export interface JurisdictionPackRow {
  readonly id: string;
  readonly countryCode: string;
  readonly countryName: string;
  readonly countryNameAr: string;
  readonly currencyCode: string;
  readonly minorUnits: number;
  readonly vatStatus: "VAT_IN_FORCE" | "VAT_PLANNED" | "NO_VAT";
  readonly packVersion: string;
  readonly descriptor: Record<string, unknown>;
  readonly verificationStatus: "REQUIRES_VERIFICATION" | "VERIFIED";
  readonly sourceRef: string;
  readonly verifiedAt: string | null;
}

export async function listJurisdictions(): Promise<JurisdictionPackRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", country_name AS "countryName",
      country_name_ar AS "countryNameAr", currency_code AS "currencyCode",
      minor_units AS "minorUnits", vat_status AS "vatStatus",
      pack_version AS "packVersion", descriptor, verification_status AS "verificationStatus",
      source_ref AS "sourceRef", verified_at AS "verifiedAt"
    FROM jurisdictions WHERE is_active ORDER BY country_code
  `);
  return rows.rows as unknown as JurisdictionPackRow[];
}

export async function findJurisdictionByCountry(
  countryCode: string,
): Promise<JurisdictionPackRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", country_name AS "countryName",
      country_name_ar AS "countryNameAr", currency_code AS "currencyCode",
      minor_units AS "minorUnits", vat_status AS "vatStatus",
      pack_version AS "packVersion", descriptor, verification_status AS "verificationStatus",
      source_ref AS "sourceRef", verified_at AS "verifiedAt"
    FROM jurisdictions WHERE country_code = ${countryCode} LIMIT 1
  `);
  return (rows.rows as unknown as JurisdictionPackRow[])[0];
}

export interface PackRateRow {
  readonly id: string;
  readonly treatment: string;
  readonly rate: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly sourceRef: string;
  readonly verifiedAt: string | null;
}

export async function listJurisdictionRates(jurisdictionId: string): Promise<PackRateRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, treatment, rate::text AS rate, effective_from::text AS "effectiveFrom",
      effective_to::text AS "effectiveTo", source_ref AS "sourceRef", verified_at AS "verifiedAt"
    FROM jurisdiction_tax_rates WHERE jurisdiction_id = ${jurisdictionId}
    ORDER BY effective_from, treatment
  `);
  return rows.rows as unknown as PackRateRow[];
}

/** The rate row covering (treatment, date) — the resolver's read port. */
export async function findRateAt(
  countryCode: string,
  treatment: string,
  date: string,
): Promise<PackRateRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id, r.treatment, r.rate::text AS rate,
      r.effective_from::text AS "effectiveFrom", r.effective_to::text AS "effectiveTo",
      r.source_ref AS "sourceRef", r.verified_at AS "verifiedAt"
    FROM jurisdiction_tax_rates r
    JOIN jurisdictions j ON j.id = r.jurisdiction_id
    WHERE j.country_code = ${countryCode} AND r.treatment = ${treatment}
      AND r.effective_from <= ${date}
      AND (r.effective_to IS NULL OR r.effective_to >= ${date})
    ORDER BY r.effective_from DESC
    LIMIT 1
  `);
  return (rows.rows as unknown as PackRateRow[])[0];
}

/** The next boundary after date — draft-spanning warnings (BR-033). */
export async function findNextRateBoundary(
  countryCode: string,
  treatment: string,
  date: string,
): Promise<PackRateRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id, r.treatment, r.rate::text AS rate,
      r.effective_from::text AS "effectiveFrom", r.effective_to::text AS "effectiveTo",
      r.source_ref AS "sourceRef", r.verified_at AS "verifiedAt"
    FROM jurisdiction_tax_rates r
    JOIN jurisdictions j ON j.id = r.jurisdiction_id
    WHERE j.country_code = ${countryCode} AND r.treatment = ${treatment}
      AND r.effective_from > ${date}
    ORDER BY r.effective_from
    LIMIT 1
  `);
  return (rows.rows as unknown as PackRateRow[])[0];
}

// -- tax codes (T5) --------------------------------------------------------------------

export interface TaxCodeRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly countryCode: string;
  readonly defaultTreatment: string;
  readonly snapshotPolicy: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly usageCount: number;
}

const TAX_CODE_COLUMNS = sql`c.id, c.code, c.name, c.name_ar AS "nameAr", c.country_code AS "countryCode",
  c.default_treatment AS "defaultTreatment", c.snapshot_policy AS "snapshotPolicy", c.status,
  COALESCE(u.usage, 0) AS "usageCount"`;

const TAX_CODE_FROM = sql`tax_codes c
  LEFT JOIN (
    SELECT tax_code_id, COUNT(*) AS usage FROM (
      SELECT tax_code_id FROM items WHERE tax_code_id IS NOT NULL
      UNION ALL
      SELECT default_tax_code_id FROM item_categories WHERE default_tax_code_id IS NOT NULL
      UNION ALL
      SELECT tax_code_id FROM expenses WHERE tax_code_id IS NOT NULL
    ) refs GROUP BY tax_code_id
  ) u ON u.tax_code_id = c.id`;

export async function listTaxCodes(filter: {
  countryCode?: string;
  status?: string;
}): Promise<TaxCodeRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TAX_CODE_COLUMNS} FROM ${TAX_CODE_FROM}
    WHERE (${filter.countryCode ?? null}::text IS NULL OR c.country_code = ${filter.countryCode ?? null})
      AND (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
    ORDER BY c.country_code, c.code
  `);
  return rows.rows as unknown as TaxCodeRow[];
}

export async function findTaxCodeById(id: string): Promise<TaxCodeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TAX_CODE_COLUMNS} FROM ${TAX_CODE_FROM} WHERE c.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TaxCodeRow[])[0];
}

export async function insertTaxCode(input: {
  code: string;
  name: string;
  nameAr: string | null;
  countryCode: string;
  defaultTreatment: string;
  snapshotPolicy: string;
  createdBy: string | null;
}): Promise<TaxCodeRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO tax_codes (id, tenant_id, code, name, name_ar, country_code,
      default_treatment, snapshot_policy, status, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.code}, ${input.name},
      ${input.nameAr}, ${input.countryCode}, ${input.defaultTreatment}, ${input.snapshotPolicy},
      'ACTIVE', ${input.createdBy})
  `);
  const found = await findTaxCodeById(id);
  if (found === undefined) throw new Error("tax code insert failed");
  return found;
}

export async function archiveTaxCode(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE tax_codes SET status = 'ARCHIVED', updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

export async function countTaxCodeReferences(id: string): Promise<{ items: number; categories: number }> {
  const rows = await tenantTx().execute(sql`
    SELECT
      (SELECT COUNT(*) FROM items WHERE tax_code_id = ${id}) AS items,
      (SELECT COUNT(*) FROM item_categories WHERE default_tax_code_id = ${id}) AS categories
  `);
  const row = (rows.rows as unknown as { items: string; categories: string }[])[0];
  return { items: Number(row?.items ?? 0), categories: Number(row?.categories ?? 0) };
}

// -- tax registrations (T4) ---------------------------------------------------------------

export interface TaxRegistrationRow {
  readonly id: string;
  readonly countryCode: string;
  readonly status: "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";
  readonly registrationNumber: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly deregisteredAt: string | null;
  readonly note: string | null;
}

export async function listTaxRegistrations(): Promise<TaxRegistrationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", status, registration_number AS "registrationNumber",
      effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo",
      deregistered_at::text AS "deregisteredAt", note
    FROM tax_registrations ORDER BY country_code
  `);
  return rows.rows as unknown as TaxRegistrationRow[];
}

export async function findTaxRegistrationByCountry(
  countryCode: string,
): Promise<TaxRegistrationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", status, registration_number AS "registrationNumber",
      effective_from::text AS "effectiveFrom", effective_to::text AS "effectiveTo",
      deregistered_at::text AS "deregisteredAt", note
    FROM tax_registrations WHERE country_code = ${countryCode} LIMIT 1
  `);
  return (rows.rows as unknown as TaxRegistrationRow[])[0];
}

export async function upsertTaxRegistration(input: {
  countryCode: string;
  status: "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";
  registrationNumber: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  deregisteredAt: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<TaxRegistrationRow> {
  const existing = await findTaxRegistrationByCountry(input.countryCode);
  if (existing === undefined) {
    await tenantTx().execute(sql`
      INSERT INTO tax_registrations (id, tenant_id, country_code, status,
        registration_number, effective_from, effective_to, deregistered_at, note, created_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.countryCode},
        ${input.status}, ${input.registrationNumber}, ${input.effectiveFrom}, ${input.effectiveTo},
        ${input.deregisteredAt}, ${input.note}, ${input.createdBy})
    `);
  } else {
    await tenantTx().execute(sql`
      UPDATE tax_registrations SET status = ${input.status},
        registration_number = ${input.registrationNumber}, effective_from = ${input.effectiveFrom},
        effective_to = ${input.effectiveTo}, deregistered_at = ${input.deregisteredAt},
        note = ${input.note}, updated_at = now(), version = version + 1
      WHERE country_code = ${input.countryCode}
    `);
  }
  const found = await findTaxRegistrationByCountry(input.countryCode);
  if (found === undefined) throw new Error("tax registration upsert failed");
  return found;
}

// -- pack bindings (T13) --------------------------------------------------------------------

export interface TaxPackBindingRow {
  readonly id: string;
  readonly countryCode: string;
  readonly packVersion: string;
  readonly appliedAt: string;
  readonly appliedBy: string | null;
}

export async function findPackBinding(countryCode: string): Promise<TaxPackBindingRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", pack_version AS "packVersion",
      applied_at::text AS "appliedAt", applied_by AS "appliedBy"
    FROM tax_pack_bindings WHERE country_code = ${countryCode} LIMIT 1
  `);
  return (rows.rows as unknown as TaxPackBindingRow[])[0];
}

export async function upsertPackBinding(input: {
  countryCode: string;
  packVersion: string;
  appliedBy: string | null;
}): Promise<TaxPackBindingRow> {
  const existing = await findPackBinding(input.countryCode);
  if (existing === undefined) {
    await tenantTx().execute(sql`
      INSERT INTO tax_pack_bindings (id, tenant_id, country_code, pack_version, applied_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(),
        ${input.countryCode}, ${input.packVersion}, ${input.appliedBy})
    `);
  } else {
    await tenantTx().execute(sql`
      UPDATE tax_pack_bindings SET pack_version = ${input.packVersion},
        applied_at = now(), applied_by = ${input.appliedBy}, updated_at = now(), version = version + 1
      WHERE country_code = ${input.countryCode}
    `);
  }
  const found = await findPackBinding(input.countryCode);
  if (found === undefined) throw new Error("pack binding upsert failed");
  return found;
}

// -- document tax summaries (INV-012 substrate — append-only) ----------------------------------

export interface TaxSummaryInsert {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly documentDate: string;
  readonly fiscalPeriodId: string | null;
  readonly countryCode: string;
  readonly direction: "OUTPUT" | "INPUT";
  readonly treatment: string;
  readonly rate: string;
  readonly taxCodeId: string | null;
  readonly taxableBase: string;
  readonly taxAmount: string;
  readonly snapshot: Record<string, unknown>;
}

export async function insertTaxDocumentSummaries(rows: readonly TaxSummaryInsert[]): Promise<void> {
  if (rows.length === 0) return;
  for (const row of rows) {
    await tenantTx().execute(sql`
      INSERT INTO tax_document_summaries (id, tenant_id, source_type, source_id,
        document_date, fiscal_period_id, country_code, direction, treatment, rate,
        tax_code_id, taxable_base, tax_amount, snapshot)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(),
        ${row.sourceType}, ${row.sourceId}, ${row.documentDate}, ${row.fiscalPeriodId},
        ${row.countryCode}, ${row.direction}, ${row.treatment}, ${row.rate},
        ${row.taxCodeId}, ${row.taxableBase}, ${row.taxAmount}, ${JSON.stringify(row.snapshot)}::jsonb)
      ON CONFLICT ("tenant_id", "source_type", "source_id", "direction", "treatment", "rate", "tax_code_id")
      DO NOTHING
    `);
  }
}

export interface SummaryAggregateRow {
  readonly direction: "OUTPUT" | "INPUT";
  readonly treatment: string;
  readonly rate: string;
  readonly taxableBase: string;
  readonly taxAmount: string;
}

/** Aggregation for the VAT return + INV-012 (RC-06): Σ by (direction, treatment, rate). */
export async function aggregateSummaries(input: {
  countryCode: string;
  fromDate: string;
  toDate: string;
}): Promise<SummaryAggregateRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT direction, treatment, rate::text AS rate,
      SUM(taxable_base)::text AS "taxableBase", SUM(tax_amount)::text AS "taxAmount"
    FROM tax_document_summaries
    WHERE country_code = ${input.countryCode}
      AND document_date >= ${input.fromDate} AND document_date <= ${input.toDate}
    GROUP BY direction, treatment, rate
    ORDER BY direction, treatment, rate
  `);
  return rows.rows as unknown as SummaryAggregateRow[];
}

export async function countSummaries(input: {
  countryCode: string;
  fromDate: string;
  toDate: string;
}): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT COUNT(*) AS cnt FROM tax_document_summaries
    WHERE country_code = ${input.countryCode}
      AND document_date >= ${input.fromDate} AND document_date <= ${input.toDate}
  `);
  const row = (rows.rows as unknown as { cnt: string }[])[0];
  return Number(row?.cnt ?? 0);
}

/** Σ tax by (direction, treatment) across ALL jurisdictions up to asOf (the INV-012 check's document side). */
export async function aggregateAllSummaries(asOf: string): Promise<
  { direction: "OUTPUT" | "INPUT"; treatment: string; taxableBase: string; taxAmount: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT direction, treatment,
      SUM(taxable_base)::text AS "taxableBase", SUM(tax_amount)::text AS "taxAmount"
    FROM tax_document_summaries
    WHERE document_date <= ${asOf}
    GROUP BY direction, treatment
    ORDER BY direction, treatment
  `);
  return rows.rows as unknown as {
    direction: "OUTPUT" | "INPUT";
    treatment: string;
    taxableBase: string;
    taxAmount: string;
  }[];
}

// -- GL tax-account movements (the INV-012 GL side — read-only journal join) -------------------

export interface GlTaxMovementRow {
  readonly purposeKey: string;
  readonly accountId: string;
  readonly netMovement: string;
}

/**
 * Net signed movement per VAT purpose account over the period:
 * VAT_PAYABLE → credits − debits; VAT_RECOVERABLE/VAT_EXPENSED → debits −
 * credits (each account's natural direction — RC-06's comparison sides).
 */
export async function glTaxMovements(input: {
  fromDate: string;
  toDate: string;
}): Promise<GlTaxMovementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT p.purpose_key AS "purposeKey", p.account_id AS "accountId",
      SUM(
        CASE
          WHEN p.purpose_key = 'VAT_PAYABLE' AND l.direction = 'CREDIT' THEN l.base_amount
          WHEN p.purpose_key = 'VAT_PAYABLE' AND l.direction = 'DEBIT' THEN -l.base_amount
          WHEN p.purpose_key IN ('VAT_RECOVERABLE', 'VAT_EXPENSED') AND l.direction = 'DEBIT' THEN l.base_amount
          ELSE -l.base_amount
        END
      )::text AS "netMovement"
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
    JOIN account_purposes p ON p.account_id = l.account_id AND p.tenant_id = l.tenant_id
    WHERE p.active_to IS NULL
      AND p.purpose_key IN ('VAT_PAYABLE', 'VAT_RECOVERABLE', 'VAT_EXPENSED')
      AND e.status = 'POSTED'
      AND e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
    GROUP BY p.purpose_key, p.account_id
    ORDER BY p.purpose_key
  `);
  return rows.rows as unknown as GlTaxMovementRow[];
}

// -- VAT returns (T9) ---------------------------------------------------------------------------

export interface VatReturnRow {
  readonly id: string;
  readonly countryCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: "DRAFT" | "READY" | "FILED";
  readonly summary: Record<string, unknown>;
  readonly crossCheck: Record<string, unknown>;
  readonly crossCheckOk: boolean;
  readonly preparedAt: string | null;
  readonly preparedBy: string | null;
  readonly filedAt: string | null;
  readonly filedBy: string | null;
  readonly filingReference: string | null;
  readonly filingNote: string | null;
}

const VAT_RETURN_COLUMNS = sql`id, country_code AS "countryCode", period_start::text AS "periodStart",
  period_end::text AS "periodEnd", status, summary, cross_check AS "crossCheck",
  cross_check_ok AS "crossCheckOk", prepared_at::text AS "preparedAt", prepared_by::text AS "preparedBy",
  filed_at::text AS "filedAt", filed_by::text AS "filedBy", filing_reference AS "filingReference",
  filing_note AS "filingNote"`;

export async function listVatReturns(countryCode?: string): Promise<VatReturnRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VAT_RETURN_COLUMNS} FROM vat_returns
    WHERE (${countryCode ?? null}::text IS NULL OR country_code = ${countryCode ?? null})
    ORDER BY period_start DESC, country_code
  `);
  return rows.rows as unknown as VatReturnRow[];
}

export async function findVatReturnById(id: string): Promise<VatReturnRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VAT_RETURN_COLUMNS} FROM vat_returns WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as VatReturnRow[])[0];
}

export async function findVatReturnByWindow(
  countryCode: string,
  periodStart: string,
  periodEnd: string,
): Promise<VatReturnRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VAT_RETURN_COLUMNS} FROM vat_returns
    WHERE country_code = ${countryCode} AND period_start = ${periodStart} AND period_end = ${periodEnd}
    LIMIT 1
  `);
  return (rows.rows as unknown as VatReturnRow[])[0];
}

export async function insertVatReturn(input: {
  countryCode: string;
  periodStart: string;
  periodEnd: string;
  createdBy: string | null;
}): Promise<VatReturnRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO vat_returns (id, tenant_id, country_code, period_start, period_end,
      status, summary, cross_check, cross_check_ok, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.countryCode},
      ${input.periodStart}, ${input.periodEnd}, 'DRAFT', '{}'::jsonb, '{}'::jsonb, false, ${input.createdBy})
  `);
  const found = await findVatReturnById(id);
  if (found === undefined) throw new Error("vat return insert failed");
  return found;
}

export async function updateVatReturnPrepared(input: {
  id: string;
  summary: Record<string, unknown>;
  crossCheck: Record<string, unknown>;
  crossCheckOk: boolean;
  preparedBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE vat_returns SET summary = ${JSON.stringify(input.summary)}::jsonb,
      cross_check = ${JSON.stringify(input.crossCheck)}::jsonb,
      cross_check_ok = ${input.crossCheckOk},
      status = CASE
        WHEN ${input.crossCheckOk} AND status IN ('DRAFT', 'READY') THEN 'READY'
        WHEN NOT ${input.crossCheckOk} AND status = 'READY' THEN 'DRAFT'
        ELSE status
      END,
      prepared_at = now(), prepared_by = ${input.preparedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status <> 'FILED'
  `);
}

export async function updateVatReturnFiled(input: {
  id: string;
  filedBy: string | null;
  filingReference: string | null;
  filingNote: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE vat_returns SET status = 'FILED', filed_at = now(), filed_by = ${input.filedBy},
      filing_reference = ${input.filingReference}, filing_note = ${input.filingNote},
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'READY'
  `);
}

// -- e-invoicing submissions (T10 registry) -------------------------------------------------------

export interface EInvoicingSubmissionRow {
  readonly id: string;
  readonly countryCode: string;
  readonly adapterId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly status: string;
  readonly payloadDigest: string | null;
  readonly authorityReference: string | null;
  readonly submittedAt: string | null;
  readonly respondedAt: string | null;
  readonly errorDetail: Record<string, unknown> | null;
}

export async function listEInvoicingSubmissions(filter: {
  countryCode?: string;
  status?: string;
}): Promise<EInvoicingSubmissionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", adapter_id AS "adapterId", source_type AS "sourceType",
      source_id::text AS "sourceId", status, payload_digest AS "payloadDigest",
      authority_reference AS "authorityReference", submitted_at::text AS "submittedAt",
      responded_at::text AS "respondedAt", error_detail AS "errorDetail"
    FROM e_invoicing_submissions
    WHERE (${filter.countryCode ?? null}::text IS NULL OR country_code = ${filter.countryCode ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return rows.rows as unknown as EInvoicingSubmissionRow[];
}

export async function findEInvoicingSubmissionById(id: string): Promise<EInvoicingSubmissionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, country_code AS "countryCode", adapter_id AS "adapterId", source_type AS "sourceType",
      source_id::text AS "sourceId", status, payload_digest AS "payloadDigest",
      authority_reference AS "authorityReference", submitted_at::text AS "submittedAt",
      responded_at::text AS "respondedAt", error_detail AS "errorDetail"
    FROM e_invoicing_submissions WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as EInvoicingSubmissionRow[])[0];
}

export async function insertEInvoicingSubmission(input: {
  countryCode: string;
  adapterId: string;
  sourceType: string;
  sourceId: string;
  payloadDigest: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  // PHASE-023: the registry unique is (tenant, source, adapter) — 1:N per
  // adapter (RELATIONSHIPS.md); a re-react to the same doc×adapter is the
  // idempotent no-op that returns the EXISTING row's id.
  const inserted = await tenantTx().execute<{ id: string }>(sql`
    INSERT INTO e_invoicing_submissions (id, tenant_id, country_code, adapter_id,
      source_type, source_id, status, payload_digest)
    VALUES (${id}, erp.current_tenant_id(), ${input.countryCode},
      ${input.adapterId}, ${input.sourceType}, ${input.sourceId}, 'PENDING', ${input.payloadDigest})
    ON CONFLICT ("tenant_id", "source_type", "source_id", "adapter_id")
      WHERE "status" IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REPORTED')
    DO NOTHING
    RETURNING id
  `);
  if (inserted.rows.length > 0) {
    return inserted.rows[0]!.id;
  }
  const existing = await tenantTx().execute<{ id: string }>(sql`
    SELECT id FROM e_invoicing_submissions
    WHERE tenant_id = erp.current_tenant_id()
      AND source_type = ${input.sourceType}
      AND source_id = ${input.sourceId}
      AND adapter_id = ${input.adapterId}
  `);
  return existing.rows[0]?.id ?? id;
}

/** Registry state walker (test-only lifecycle states — the fake adapter's substrate). */
export async function updateSubmissionStatus(input: {
  id: string;
  status: string;
  authorityReference?: string | null;
  error?: Record<string, unknown> | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE e_invoicing_submissions SET status = ${input.status},
      authority_reference = ${input.authorityReference ?? null},
      error_detail = ${input.error ? JSON.stringify(input.error) : null}::jsonb,
      submitted_at = CASE WHEN ${input.status} IN ('SUBMITTED', 'ACCEPTED', 'REJECTED') THEN now() ELSE submitted_at END,
      responded_at = CASE WHEN ${input.status} IN ('ACCEPTED', 'REJECTED', 'FAILED') THEN now() ELSE responded_at END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

// -- settings reads (registration migration dual-read window) ----------------------------------------

/** The tenant's own country_code (the registration migration's anchor). */
export async function findTenantCountry(tenantId: string): Promise<string | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT country_code AS country FROM tenants WHERE id = ${tenantId} LIMIT 1
  `);
  const row = (rows.rows as unknown as { country: string }[])[0];
  return row?.country;
}

export async function readLegacyRegistrationSettings(): Promise<{
  status: string | null;
  number: string | null;
  binding: { country_code: string } | null;
}> {
  const rows = await tenantTx().execute(sql`
    SELECT
      (SELECT value#>>'{}' FROM tenant_settings WHERE key = 'tax.registration.status') AS status,
      (SELECT value#>>'{}' FROM tenant_settings WHERE key = 'tax.registration.number') AS number,
      (SELECT value->'country_code' FROM tenant_settings WHERE key = 'tax.jurisdiction.binding') AS binding
  `);
  const row = (rows.rows as unknown as { status: string | null; number: string | null; binding: { country_code?: unknown } | null }[])[0];
  return {
    status: row?.status ?? null,
    number: row?.number ?? null,
    binding: row?.binding ? { country_code: String(row.binding.country_code ?? "") } : null,
  };
}
