import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { generateUuidV7 } from "@erp/domain-core";

/**
 * PHASE-046 (D-11) — THE CANONICAL STATUTORY SET: the ONE versioned
 * source of the platform-carried jurisdiction facts (the rates are NOT
 * tenant policy — the platform carries the verified schedule, the 0086
 * lesson applied the other way). The seed migration 0092 materializes
 * this set for every EXISTING tenant; the tenancy onboarding flow
 * (the provisionCoaTemplate site) materializes the SAME set for NEW
 * tenants — one source, auditable, never a second hand-typed copy.
 *
 * THE OWNER'S CORRECTED SCHEDULE (the PHASE-046 approval dispatch,
 * 2026-11-16) — the GOSI row-set:
 *   GOSI-PENSION  CITIZEN   employee 9.0000%  employer  9.0000%  base 1,500…45,000
 *   GOSI-SANED    CITIZEN   employee 0.7500%  employer  0.7500%  base 1,500…15,000
 *   GOSI-OH       ALL       employee 0.0000%  employer  2.0000%  base 1,500…45,000
 * → Saudi totals: employer 11.75% (9% + 0.75% + 2%), employee 9.75%;
 *   the non-Saudi arm is OH-only (employer 2%, employee 0).
 *
 * THE CITATION RECORD (0093, the reserved slot — the audit-reconciliation
 * round, 2026-11-16): CITATION = the PwC source "Saudi Arabia: Individual —
 * Other taxes" (https://taxsummaries.pwc.com/saudi-arabia/individual/
 * other-taxes, fetched 2026-11-16 21:34 UTC by the owner's verifier), which
 * independently corroborates the corrected schedule — OH on ALL (inside
 * the Saudi employer's 11.75%), non-Saudi OH-only, employee 9.75%, the
 * SAR 45,000 ceiling on basic + housing. DECISION RECORD = the owner's
 * PHASE-046 approval dispatch (2026-11-16) — why the correction happened,
 * no longer presented as the citation itself. The STATUTORY VERIFICATION
 * REGISTER's open items are EXACTLY TWO: the SANED-specific 15,000 ceiling
 * (PwC does not state it; the owner's confirmation pending — the D-01
 * dual-cap basis) and the EOSB official text (Labor Law M/51 Art. 84 —
 * the 15/30-days tiers; unreachable from both environments, all Saudi gov
 * domains TCP-blocked). The GOSI rates and the 45,000 ceiling are CLOSED.
 * The KSA EOSB tiers carry the labor-law award (the per-year fold).
 * AE/EG/JO seed as 0-rate REQUIRES_VERIFICATION placeholders — the
 * blocked-state surface, never a guessed rate (BR-085/BR-055).
 */

export interface CanonicalContributionRow {
  readonly jurisdictionCode: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly employeeRate: string;
  readonly employerRate: string;
  readonly baseMin: string | null;
  readonly baseMax: string | null;
  readonly contributoryKeys: readonly string[];
  readonly appliesTo: "ALL" | "CITIZEN" | "NON_CITIZEN";
  readonly effectiveFrom: string;
  readonly status: "REQUIRES_VERIFICATION" | "VERIFIED";
  readonly sourceName: string | null;
  readonly sourceRef: string | null;
  readonly reviewNote: string | null;
}

export interface CanonicalBracketRow {
  readonly jurisdictionCode: string;
  readonly code: string;
  readonly floor: string;
  readonly ceiling: string | null;
  readonly rate: string;
  readonly sort: number;
  readonly personalAllowanceDefault: string;
  readonly perDependentAllowance: string;
  readonly effectiveFrom: string;
  readonly status: "REQUIRES_VERIFICATION" | "VERIFIED";
  readonly reviewNote: string | null;
}

export interface CanonicalEosbRuleRow {
  readonly jurisdictionCode: string;
  readonly fromYears: string;
  readonly toYears: string | null;
  readonly daysPerYear: string;
  readonly effectiveFrom: string;
  readonly status: "REQUIRES_VERIFICATION" | "VERIFIED";
  readonly sourceName: string | null;
  readonly sourceRef: string | null;
  readonly reviewNote: string | null;
}

const GOSI_CITATION_NAME =
  'PwC Worldwide Tax Summaries — Saudi Arabia: Individual — Other taxes (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner\'s verifier; page title "Saudi Arabia - Individual - Other taxes")';
const GOSI_CITATION_VERBATIM =
  'Verbatim: "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000, are computed at 2% for non-Saudi employees (note that this is not social insurance, it is occupational hazard), and are paid by the employer. For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])."';
const GOSI_DECISION_RECORD =
  "DECISION RECORD: the owner's PHASE-046 approval dispatch (2026-11-16) is why the schedule was corrected (the GOSI-OH row on ALL at 0%/2%; the Saudi employer total 11.75% / employee 9.75%; the non-Saudi arm OH-only) — recorded as the decision record, no longer presented as the citation (0093, the reserved slot: the PwC source independently corroborates the corrected schedule).";
const GOSI_OPEN_ITEMS_NOTE =
  "The statutory verification register's open items are exactly two: the SANED-specific 15,000 ceiling (PwC does not state it; the owner's confirmation pending — the plan's D-01 dual-cap basis) and the EOSB official text (Labor Law M/51 Art. 84 — the 15/30-days tiers; unreachable from both environments, all Saudi gov domains TCP-blocked).";
const EOSB_SOURCE_NAME =
  "Saudi Labor Law (Royal Decree M/51, as amended) — the end-of-service award";
const EOSB_SOURCE_REF =
  "The phase doc's own worked shape: half a month's wage per year for the first five years, a full month thereafter (the per-year tier fold)";
const PENDING_JURISDICTION_NOTE =
  "No rate seeded — the jurisdiction's official schedule is the owner's open item (the statutory verification register). The row exists to surface the blocked state, never a guessed rate (BR-085/BR-055).";

export const CANONICAL_CONTRIBUTION_ROWS: readonly CanonicalContributionRow[] = Object.freeze([
  Object.freeze({
    jurisdictionCode: "SA",
    code: "GOSI-PENSION",
    name: "GOSI Pension (Annuities)",
    nameAr: "التأمينات الاجتماعية — المعاشات",
    employeeRate: "9.0000",
    employerRate: "9.0000",
    baseMin: "1500.0000",
    baseMax: "45000.0000",
    contributoryKeys: Object.freeze(["HOUSING"]),
    appliesTo: "CITIZEN",
    effectiveFrom: "2020-01-01",
    status: "VERIFIED",
    sourceName: GOSI_CITATION_NAME,
    sourceRef: `${GOSI_CITATION_VERBATIM} — the pension arm: employee 9% + employer 9% of the monthly basic + housing, ceiling SAR 45,000`,
    reviewNote: `CITATION CLOSED (0093): the GOSI rates and the 45,000 contributory-wage ceiling are CLOSED by the PwC source. ${GOSI_DECISION_RECORD} ${GOSI_OPEN_ITEMS_NOTE}`,
  }),
  Object.freeze({
    jurisdictionCode: "SA",
    code: "GOSI-SANED",
    name: "GOSI SANED (Unemployment)",
    nameAr: "ساند — التأمين ضد التعطل",
    employeeRate: "0.7500",
    employerRate: "0.7500",
    baseMin: "1500.0000",
    baseMax: "15000.0000",
    contributoryKeys: Object.freeze(["HOUSING"]),
    appliesTo: "CITIZEN",
    effectiveFrom: "2020-01-01",
    status: "VERIFIED",
    sourceName: GOSI_CITATION_NAME,
    sourceRef: `${GOSI_CITATION_VERBATIM} — the SANED arm: employee 0.75% + employer 0.75% (the unemployment insurance inside the 21.5% Saudi total)`,
    reviewNote: `CITATION CLOSED for the RATES (0093): PwC corroborates 0.75% + 0.75% and states the general SAR 45,000 contributory ceiling — but does NOT state the SANED-specific 15,000 ceiling, the row's one open item (the owner's confirmation pending). The dual-cap law's SANED arm — the reason the schedule is a ROW-SET. ${GOSI_DECISION_RECORD} ${GOSI_OPEN_ITEMS_NOTE}`,
  }),
  Object.freeze({
    jurisdictionCode: "SA",
    code: "GOSI-OH",
    name: "GOSI Occupational Hazards",
    nameAr: "التأمين ضد الأخطار المهنية",
    employeeRate: "0.0000",
    employerRate: "2.0000",
    baseMin: "1500.0000",
    baseMax: "45000.0000",
    contributoryKeys: Object.freeze(["HOUSING"]),
    appliesTo: "ALL",
    effectiveFrom: "2020-01-01",
    status: "VERIFIED",
    sourceName: GOSI_CITATION_NAME,
    sourceRef: `${GOSI_CITATION_VERBATIM} — the occupational-hazard arm: 2% computed for non-Saudi employees and paid by the employer (OH-only for the non-Saudi arm); the 2% inside the Saudi employer's 11.75%; the SAR 45,000 upper limit on basic + housing`,
    reviewNote: `CITATION CLOSED (0093): the OH rate (employer-only 2%, on ALL) and the 45,000 ceiling are CLOSED by the PwC source. ${GOSI_DECISION_RECORD} ${GOSI_OPEN_ITEMS_NOTE}`,
  }),
  // The AE/EG/JO blocked-state placeholders (one row per jurisdiction).
  ...(["AE", "EG", "JO"] as const).map((code) =>
    Object.freeze({
      jurisdictionCode: code,
      code: "SOCIAL-INSURANCE",
      name: `Social insurance (${code}) — pending official verification`,
      nameAr: "التأمينات الاجتماعية — بانتظار التحقق الرسمي",
      employeeRate: "0.0000",
      employerRate: "0.0000",
      baseMin: null,
      baseMax: null,
      contributoryKeys: Object.freeze([]),
      appliesTo: "ALL" as const,
      effectiveFrom: "2020-01-01",
      status: "REQUIRES_VERIFICATION" as const,
      sourceName: null,
      sourceRef: null,
      reviewNote: PENDING_JURISDICTION_NOTE,
    }),
  ),
]);

export const CANONICAL_BRACKET_ROWS: readonly CanonicalBracketRow[] = Object.freeze(
  (["AE", "EG", "JO"] as const).map((code) =>
    Object.freeze({
      jurisdictionCode: code,
      code: "PIT-STANDARD",
      floor: "0.0000",
      ceiling: null,
      rate: "0.0000",
      sort: 1,
      personalAllowanceDefault: "0.0000",
      perDependentAllowance: "0.0000",
      effectiveFrom: "2020-01-01",
      status: "REQUIRES_VERIFICATION" as const,
      reviewNote: PENDING_JURISDICTION_NOTE,
    }),
  ),
);

export const CANONICAL_EOSB_RULE_ROWS: readonly CanonicalEosbRuleRow[] = Object.freeze([
  Object.freeze({
    jurisdictionCode: "SA",
    fromYears: "0.00",
    toYears: "5.00",
    daysPerYear: "15.00",
    effectiveFrom: "2020-01-01",
    status: "VERIFIED",
    sourceName: EOSB_SOURCE_NAME,
    sourceRef: EOSB_SOURCE_REF,
    reviewNote: "The first tier of the per-year fold (0–5 years × 15 days).",
  }),
  Object.freeze({
    jurisdictionCode: "SA",
    fromYears: "5.00",
    toYears: null,
    daysPerYear: "30.00",
    effectiveFrom: "2020-01-01",
    status: "VERIFIED",
    sourceName: EOSB_SOURCE_NAME,
    sourceRef: EOSB_SOURCE_REF,
    reviewNote: "The open-top tier (> 5 years × 30 days — 7 years → 5×15 + 2×30 = 135 days).",
  }),
  ...(["AE", "EG", "JO"] as const).map((code) =>
    Object.freeze({
      jurisdictionCode: code,
      fromYears: "0.00",
      toYears: null,
      daysPerYear: "0.00",
      effectiveFrom: "2020-01-01",
      status: "REQUIRES_VERIFICATION" as const,
      sourceName: null,
      sourceRef: null,
      reviewNote: PENDING_JURISDICTION_NOTE,
    }),
  ),
]);

/**
 * Materialize the canonical set for the CURRENT tenant (the ambient UoW)
 * — idempotent on every natural key (the 0092 seed's INSERT … ON
 * CONFLICT DO NOTHING shape, one source for the seed migration's
 * existing-tenant sweep and the onboarding flow's new-tenant step).
 */
export async function materializeCanonicalStatutorySet(): Promise<{
  profiles: number;
  brackets: number;
  eosbRules: number;
}> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the statutory materialization requires an ambient tenant scope");
  }
  const tx = context.tx;
  for (const row of CANONICAL_CONTRIBUTION_ROWS) {
    await tx.execute(sql`
      INSERT INTO "statutory_contribution_profiles"
        ("id", "tenant_id", "jurisdiction_code", "code", "name", "name_ar",
         "employee_rate", "employer_rate", "base_min", "base_max",
         "contributory_keys", "applies_to", "effective_from", "status",
         "source_name", "source_ref", "verified_at", "review_note")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.jurisdictionCode}, ${row.code},
              ${row.name}, ${row.nameAr}, ${row.employeeRate}, ${row.employerRate},
              ${row.baseMin}, ${row.baseMax}, ${JSON.stringify(row.contributoryKeys)}::jsonb,
              ${row.appliesTo}, ${row.effectiveFrom}, ${row.status},
              ${row.sourceName}, ${row.sourceRef},
              ${row.status === "VERIFIED" ? sql`now()` : sql`NULL`}, ${row.reviewNote})
      ON CONFLICT ("tenant_id", "jurisdiction_code", "code") DO NOTHING
    `);
  }
  for (const row of CANONICAL_BRACKET_ROWS) {
    await tx.execute(sql`
      INSERT INTO "payroll_tax_brackets"
        ("id", "tenant_id", "jurisdiction_code", "code", "floor", "ceiling",
         "rate", "sort", "personal_allowance_default", "per_dependent_allowance",
         "effective_from", "status", "review_note")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.jurisdictionCode}, ${row.code},
              ${row.floor}, ${row.ceiling}, ${row.rate}, ${row.sort},
              ${row.personalAllowanceDefault}, ${row.perDependentAllowance},
              ${row.effectiveFrom}, ${row.status}, ${row.reviewNote})
      ON CONFLICT ("tenant_id", "jurisdiction_code", "code", "effective_from", "sort") DO NOTHING
    `);
  }
  for (const row of CANONICAL_EOSB_RULE_ROWS) {
    await tx.execute(sql`
      INSERT INTO "eosb_rules"
        ("id", "tenant_id", "jurisdiction_code", "from_years", "to_years",
         "days_per_year", "effective_from", "status",
         "source_name", "source_ref", "verified_at", "review_note")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.jurisdictionCode}, ${row.fromYears},
              ${row.toYears}, ${row.daysPerYear}, ${row.effectiveFrom}, ${row.status},
              ${row.sourceName}, ${row.sourceRef},
              ${row.status === "VERIFIED" ? sql`now()` : sql`NULL`}, ${row.reviewNote})
      ON CONFLICT DO NOTHING
    `);
  }
  return {
    profiles: CANONICAL_CONTRIBUTION_ROWS.length,
    brackets: CANONICAL_BRACKET_ROWS.length,
    eosbRules: CANONICAL_EOSB_RULE_ROWS.length,
  };
}
