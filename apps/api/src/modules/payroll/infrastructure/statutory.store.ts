import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { AppliesTo } from "../domain/statutory-math";

/**
 * PHASE-046 (W-2) statutory store: the ONLY writer of the four statutory
 * tables (statutory_contribution_profiles, payroll_tax_brackets,
 * eosb_rules, eosb_calculations — the 0089/0090 substrate, seeded 0092/
 * 0093). Every statement runs in the caller's ambient tenant UoW so a
 * failure anywhere rolls the whole business operation back.
 *
 * LEDGER WRITES GO THROUGH THE POSTING ENGINE ONLY (ADR-0007): the G-54
 * true-up journal is posted by the eosb service through PostingService;
 * this store never touches journal tables.
 *
 * The verification act (BR-085/D-10): the verify CAS runs as ONE
 * conditional UPDATE — `WHERE status = 'REQUIRES_VERIFICATION'` — so two
 * concurrent verifies collapse to one flip and the loser reads the
 * already-verified row back for its typed 409 (the W-6 duel shape).
 *
 * eosb_calculations discipline (the 0089 evidence law): INSERT + SELECT
 * (+ the status flip to POSTED after the G-54 journal commits in the
 * same UoW); no DELETE by construction.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("statutory access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- statutory contribution profiles --------------------------------------------------

export interface StatutoryProfileRow {
  id: string;
  jurisdictionCode: string;
  code: string;
  name: string;
  nameAr: string | null;
  employeeRate: string;
  employerRate: string;
  baseMin: string | null;
  baseMax: string | null;
  contributoryKeys: string[];
  appliesTo: AppliesTo;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "REQUIRES_VERIFICATION" | "VERIFIED" | "RETIRED";
  sourceName: string | null;
  sourceRef: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  reviewNote: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface ProfileSqlRow {
  id: string;
  jurisdiction_code: string;
  code: string;
  name: string;
  name_ar: string | null;
  employee_rate: string;
  employer_rate: string;
  base_min: string | null;
  base_max: string | null;
  contributory_keys: unknown;
  applies_to: AppliesTo;
  effective_from: string;
  effective_to: string | null;
  status: StatutoryProfileRow["status"];
  source_name: string | null;
  source_ref: string | null;
  verified_by: string | null;
  verified_at: string | null;
  review_note: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function mapProfile(row: ProfileSqlRow): StatutoryProfileRow {
  return {
    id: row.id,
    jurisdictionCode: row.jurisdiction_code,
    code: row.code,
    name: row.name,
    nameAr: row.name_ar,
    employeeRate: row.employee_rate,
    employerRate: row.employer_rate,
    baseMin: row.base_min,
    baseMax: row.base_max,
    contributoryKeys: Array.isArray(row.contributory_keys) ? (row.contributory_keys as string[]) : [],
    appliesTo: row.applies_to,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    sourceName: row.source_name,
    sourceRef: row.source_ref,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    reviewNote: row.review_note,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

const PROFILE_COLUMNS = sql`id, jurisdiction_code, code, name, name_ar, employee_rate, employer_rate,
  base_min, base_max, contributory_keys, applies_to, effective_from, effective_to, status,
  source_name, source_ref, verified_by, verified_at, review_note, updated_by, created_at, updated_at, version`;

/**
 * The effective-dated row-set (D-01): every profile of the jurisdiction
 * valid on `onDate` — effective_from ≤ onDate ≤ (effective_to | ∞) —
 * future and retired rows never match. Status-filtered by the caller's
 * law (the engine consumes VERIFIED rows; BR-085 refuses the blocked
 * surface with the row's own review note).
 */
export async function listProfiles(filter: {
  jurisdictionCode: string;
  onDate: string;
}): Promise<StatutoryProfileRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROFILE_COLUMNS} FROM statutory_contribution_profiles
    WHERE jurisdiction_code = ${filter.jurisdictionCode}
      AND effective_from <= ${filter.onDate}::date
      AND (effective_to IS NULL OR effective_to >= ${filter.onDate}::date)
    ORDER BY code
  `);
  return (rows.rows as unknown as ProfileSqlRow[]).map(mapProfile);
}

export async function findProfileById(id: string): Promise<StatutoryProfileRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROFILE_COLUMNS} FROM statutory_contribution_profiles WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as ProfileSqlRow[])[0];
  return row === undefined ? undefined : mapProfile(row);
}

/**
 * PHASE-046 (W-5, T-10 — D-16): the MANAGEMENT list — every profile of
 * the tenant (any status, any effective window — future and retired rows
 * included; the screen's effective-dates columns exist to show them),
 * optionally narrowed to one jurisdiction. Read-only; the verification
 * badges + the verify act ride the same rows the engine resolves.
 */
export async function listAllProfiles(filter: {
  jurisdictionCode?: string;
}): Promise<StatutoryProfileRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROFILE_COLUMNS} FROM statutory_contribution_profiles
    WHERE (${filter.jurisdictionCode ?? null}::text IS NULL
           OR jurisdiction_code = ${filter.jurisdictionCode ?? null})
    ORDER BY jurisdiction_code, code, effective_from
  `);
  return (rows.rows as unknown as ProfileSqlRow[]).map(mapProfile);
}

/**
 * The verify CAS (BR-085's flip + D-10): ONE conditional UPDATE — only a
 * REQUIRES_VERIFICATION row flips, stamping the verifier + the citation
 * the flip rests on (the 0089 VERIFIED⟺source CHECK) + the timestamp.
 * Returns the flipped row, or undefined when the CAS lost (already
 * verified — the caller re-reads for its typed 409) or the id is
 * unknown/foreign (A7 parity — indistinguishable).
 */
export async function verifyProfileCas(
  id: string,
  actorId: string,
  sourceName: string,
  sourceRef: string | null,
): Promise<StatutoryProfileRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE statutory_contribution_profiles
    SET status = 'VERIFIED', verified_by = ${actorId}, verified_at = now(),
        source_name = ${sourceName}, source_ref = ${sourceRef}, version = version + 1
    WHERE id = ${id} AND status = 'REQUIRES_VERIFICATION'
    RETURNING ${PROFILE_COLUMNS}
  `);
  const row = (rows.rows as unknown as ProfileSqlRow[])[0];
  return row === undefined ? undefined : mapProfile(row);
}

// -- PIT brackets ----------------------------------------------------------------------

export interface PitBracketRow {
  id: string;
  jurisdictionCode: string;
  code: string;
  floor: string;
  ceiling: string | null;
  rate: string;
  sort: number;
  personalAllowanceDefault: string;
  perDependentAllowance: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "REQUIRES_VERIFICATION" | "VERIFIED" | "RETIRED";
  reviewNote: string | null;
}

interface BracketSqlRow {
  id: string;
  jurisdiction_code: string;
  code: string;
  floor: string;
  ceiling: string | null;
  rate: string;
  sort: number;
  personal_allowance_default: string;
  per_dependent_allowance: string;
  effective_from: string;
  effective_to: string | null;
  status: PitBracketRow["status"];
  review_note: string | null;
}

function mapBracket(row: BracketSqlRow): PitBracketRow {
  return {
    id: row.id,
    jurisdictionCode: row.jurisdiction_code,
    code: row.code,
    floor: row.floor,
    ceiling: row.ceiling,
    rate: row.rate,
    sort: row.sort,
    personalAllowanceDefault: row.personal_allowance_default,
    perDependentAllowance: row.per_dependent_allowance,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    reviewNote: row.review_note,
  };
}

/** The effective-dated bracket set (D-03): rows of the jurisdiction
 * valid on `onDate`, sorted — one (code) set at a time by the caller. */
export async function listBrackets(filter: {
  jurisdictionCode: string;
  onDate: string;
}): Promise<PitBracketRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, jurisdiction_code, code, floor, ceiling, rate, sort,
           personal_allowance_default, per_dependent_allowance, effective_from, effective_to,
           status, review_note
    FROM payroll_tax_brackets
    WHERE jurisdiction_code = ${filter.jurisdictionCode}
      AND effective_from <= ${filter.onDate}::date
      AND (effective_to IS NULL OR effective_to >= ${filter.onDate}::date)
    ORDER BY code, sort
  `);
  return (rows.rows as unknown as BracketSqlRow[]).map(mapBracket);
}

export async function findBracketById(id: string): Promise<PitBracketRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, jurisdiction_code, code, floor, ceiling, rate, sort,
           personal_allowance_default, per_dependent_allowance, effective_from, effective_to,
           status, review_note
    FROM payroll_tax_brackets WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as BracketSqlRow[])[0];
  return row === undefined ? undefined : mapBracket(row);
}

/**
 * PHASE-046 (W-5, T-10 — D-16): the MANAGEMENT list — every bracket row
 * of the tenant (any status, any effective window), optionally narrowed
 * to one jurisdiction, in the set's own (code, sort) order so a set
 * reads as the progressive ladder it is.
 */
export async function listAllBrackets(filter: {
  jurisdictionCode?: string;
}): Promise<PitBracketRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, jurisdiction_code, code, floor, ceiling, rate, sort,
           personal_allowance_default, per_dependent_allowance, effective_from, effective_to,
           status, review_note
    FROM payroll_tax_brackets
    WHERE (${filter.jurisdictionCode ?? null}::text IS NULL
           OR jurisdiction_code = ${filter.jurisdictionCode ?? null})
    ORDER BY jurisdiction_code, code, sort, effective_from
  `);
  return (rows.rows as unknown as BracketSqlRow[]).map(mapBracket);
}

// -- EOSB rules -------------------------------------------------------------------------

export interface EosbRuleRow {
  id: string;
  jurisdictionCode: string;
  fromYears: string;
  toYears: string | null;
  daysPerYear: string;
  contractType: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "REQUIRES_VERIFICATION" | "VERIFIED" | "RETIRED";
  reviewNote: string | null;
}

interface EosbRuleSqlRow {
  id: string;
  jurisdiction_code: string;
  from_years: string;
  to_years: string | null;
  days_per_year: string;
  contract_type: string | null;
  effective_from: string;
  effective_to: string | null;
  status: EosbRuleRow["status"];
  review_note: string | null;
}

function mapEosbRule(row: EosbRuleSqlRow): EosbRuleRow {
  return {
    id: row.id,
    jurisdictionCode: row.jurisdiction_code,
    fromYears: row.from_years,
    toYears: row.to_years,
    daysPerYear: row.days_per_year,
    contractType: row.contract_type,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    status: row.status,
    reviewNote: row.review_note,
  };
}

/** The effective-dated tier rows (D-04): rows of the jurisdiction valid
 * on `onDate`, optionally narrowed to the employee's contract type (a
 * NULL contract_type row covers ALL types — the tenant-configurable
 * override the doc names). */
export async function listEosbRules(filter: {
  jurisdictionCode: string;
  onDate: string;
  contractType?: string | null;
}): Promise<EosbRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, jurisdiction_code, from_years, to_years, days_per_year, contract_type,
           effective_from, effective_to, status, review_note
    FROM eosb_rules
    WHERE jurisdiction_code = ${filter.jurisdictionCode}
      AND effective_from <= ${filter.onDate}::date
      AND (effective_to IS NULL OR effective_to >= ${filter.onDate}::date)
      AND (contract_type IS NULL OR contract_type = ${filter.contractType ?? null})
    ORDER BY from_years
  `);
  return (rows.rows as unknown as EosbRuleSqlRow[]).map(mapEosbRule);
}

export async function findEosbRuleById(id: string): Promise<EosbRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, jurisdiction_code, from_years, to_years, days_per_year, contract_type,
           effective_from, effective_to, status, review_note
    FROM eosb_rules WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as EosbRuleSqlRow[])[0];
  return row === undefined ? undefined : mapEosbRule(row);
}

/**
 * PHASE-046 (W-5, T-10 — D-16): the MANAGEMENT list — every EOSB tier
 * row of the tenant (any status, any effective window), optionally
 * narrowed to one jurisdiction, in tier (fromYears) order.
 */
export async function listAllEosbRules(filter: {
  jurisdictionCode?: string;
}): Promise<EosbRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, jurisdiction_code, from_years, to_years, days_per_year, contract_type,
           effective_from, effective_to, status, review_note
    FROM eosb_rules
    WHERE (${filter.jurisdictionCode ?? null}::text IS NULL
           OR jurisdiction_code = ${filter.jurisdictionCode ?? null})
    ORDER BY jurisdiction_code, from_years, effective_from
  `);
  return (rows.rows as unknown as EosbRuleSqlRow[]).map(mapEosbRule);
}

// -- EOSB calculations (the computation evidence) ---------------------------------------

export type EosbCalculationKind = "TERMINATION" | "PERIOD_TRUE_UP" | "OPENING";

export interface EosbCalculationRow {
  id: string;
  employeeId: string;
  kind: EosbCalculationKind;
  serviceYears: string;
  tierBreakdown: unknown;
  wageBaseSnapshot: unknown;
  entitlementAmount: string;
  provisionBalance: string;
  delta: string;
  journalEntryId: string | null;
  status: "COMPUTED" | "POSTED";
  runId: string | null;
  fiscalPeriodId: string | null;
  entryDate: string;
  note: string | null;
  createdAt: string;
}

interface EosbCalculationSqlRow {
  id: string;
  employee_id: string;
  kind: EosbCalculationKind;
  service_years: string;
  tier_breakdown: unknown;
  wage_base_snapshot: unknown;
  entitlement_amount: string;
  provision_balance: string;
  delta: string;
  journal_entry_id: string | null;
  status: EosbCalculationRow["status"];
  run_id: string | null;
  fiscal_period_id: string | null;
  entry_date: string;
  note: string | null;
  created_at: string;
}

function mapEosbCalculation(row: EosbCalculationSqlRow): EosbCalculationRow {
  return {
    id: row.id,
    employeeId: row.employee_id,
    kind: row.kind,
    serviceYears: row.service_years,
    tierBreakdown: row.tier_breakdown,
    wageBaseSnapshot: row.wage_base_snapshot,
    entitlementAmount: row.entitlement_amount,
    provisionBalance: row.provision_balance,
    delta: row.delta,
    journalEntryId: row.journal_entry_id,
    status: row.status,
    runId: row.run_id,
    fiscalPeriodId: row.fiscal_period_id,
    entryDate: row.entry_date,
    note: row.note,
    createdAt: row.created_at,
  };
}

/** Insert one computation-evidence row (the calculation's frozen
 * snapshot — the tier breakdown + the wage base). */
export async function insertEosbCalculation(input: {
  employeeId: string;
  kind: EosbCalculationKind;
  serviceYears: string;
  tierBreakdown: unknown;
  wageBaseSnapshot: unknown;
  entitlementAmount: string;
  provisionBalance: string;
  delta: string;
  runId?: string | null;
  fiscalPeriodId?: string | null;
  entryDate: string;
  note?: string | null;
  createdBy?: string | null;
}): Promise<EosbCalculationRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO eosb_calculations
      (id, tenant_id, employee_id, kind, service_years, tier_breakdown, wage_base_snapshot,
       entitlement_amount, provision_balance, delta, status, run_id, fiscal_period_id,
       entry_date, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.employeeId}, ${input.kind},
            ${input.serviceYears}, ${JSON.stringify(input.tierBreakdown)}::jsonb,
            ${JSON.stringify(input.wageBaseSnapshot)}::jsonb,
            ${input.entitlementAmount}, ${input.provisionBalance}, ${input.delta},
            'COMPUTED', ${input.runId ?? null}, ${input.fiscalPeriodId ?? null},
            ${input.entryDate}, ${input.note ?? null}, ${input.createdBy ?? null})
    RETURNING id, employee_id, kind, service_years, tier_breakdown, wage_base_snapshot,
              entitlement_amount, provision_balance, delta, journal_entry_id, status,
              run_id, fiscal_period_id, entry_date, note, created_at
  `);
  return mapEosbCalculation((rows.rows as unknown as EosbCalculationSqlRow[])[0]!);
}

/** Stamp the calculation POSTED with its G-54 journal — same UoW as the
 * posting (the evidence ties the delta to the journal id). */
export async function markEosbCalculationPosted(
  id: string,
  journalEntryId: string,
): Promise<EosbCalculationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE eosb_calculations
    SET status = 'POSTED', journal_entry_id = ${journalEntryId}, version = version + 1
    WHERE id = ${id}
    RETURNING id, employee_id, kind, service_years, tier_breakdown, wage_base_snapshot,
              entitlement_amount, provision_balance, delta, journal_entry_id, status,
              run_id, fiscal_period_id, entry_date, note, created_at
  `);
  const row = (rows.rows as unknown as EosbCalculationSqlRow[])[0];
  return row === undefined ? undefined : mapEosbCalculation(row);
}

export async function listEosbCalculations(filter: {
  employeeId?: string;
  kind?: EosbCalculationKind;
}): Promise<EosbCalculationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, employee_id, kind, service_years, tier_breakdown, wage_base_snapshot,
           entitlement_amount, provision_balance, delta, journal_entry_id, status,
           run_id, fiscal_period_id, entry_date, note, created_at
    FROM eosb_calculations
    WHERE (${filter.employeeId ?? null}::uuid IS NULL OR employee_id = ${filter.employeeId ?? null})
      AND (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null})
    ORDER BY created_at DESC, id DESC
  `);
  return (rows.rows as unknown as EosbCalculationSqlRow[]).map(mapEosbCalculation);
}

export async function findEosbCalculationById(id: string): Promise<EosbCalculationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, employee_id, kind, service_years, tier_breakdown, wage_base_snapshot,
           entitlement_amount, provision_balance, delta, journal_entry_id, status,
           run_id, fiscal_period_id, entry_date, note, created_at
    FROM eosb_calculations WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as EosbCalculationSqlRow[])[0];
  return row === undefined ? undefined : mapEosbCalculation(row);
}
