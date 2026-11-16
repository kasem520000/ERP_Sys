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
 * The verification records carry the honest provenance (the dispatch +
 * the corroborating published implementations of the Social Insurance
 * Law, Royal Decree M/33 — the contributory-wage cap 45,000 per Part 1
 * Art. 8(2)); the official-table citations are the STATUTORY
 * VERIFICATION REGISTER's open item for the owner's at-review
 * confirmation (gosi.gov.sa was unreachable from the delivery sandbox —
 * the fetch attempts are recorded there). The KSA EOSB tiers carry the
 * labor-law award (the per-year fold). AE/EG/JO seed as 0-rate
 * REQUIRES_VERIFICATION placeholders — the blocked-state surface, never
 * a guessed rate (BR-085/BR-055).
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

const GOSI_SOURCE_NAME =
  "GOSI official contribution schedule — the Social Insurance Law (Royal Decree M/33, as amended)";
const GOSI_SOURCE_REF =
  "The owner's PHASE-046 approval dispatch (2026-11-16): the corrected OH row on ALL (0%/2%), the Saudi split employer 11.75% (9% pension + 0.75% SANED + 2% OH) / employee 9.75%; corroborated by published implementations of the schedule (the contributory-wage cap 45,000 per the Law Part 1 Art. 8(2))";
const GOSI_OPEN_ITEM_NOTE =
  "gosi.gov.sa unreachable from the delivery sandbox — the official-table citation is the statutory verification register's open item; any correction lands as a seed edit before the gates (the plan §7(c) law).";
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
    sourceName: GOSI_SOURCE_NAME,
    sourceRef: GOSI_SOURCE_REF,
    reviewNote: `The dual-cap law's pension arm. ${GOSI_OPEN_ITEM_NOTE}`,
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
    sourceName: GOSI_SOURCE_NAME,
    sourceRef: `${GOSI_SOURCE_REF}; the SANED 15,000 ceiling per the plan's dual-cap basis (D-01)`,
    reviewNote: `The dual-cap law's SANED arm — the reason the schedule is a ROW-SET. ${GOSI_OPEN_ITEM_NOTE}`,
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
    sourceName: GOSI_SOURCE_NAME,
    sourceRef:
      "The owner's PHASE-046 approval dispatch (2026-11-16), verbatim: the GOSI-OH row applies to ALL — employee share zero, employer share 2%; the non-Saudi arm is OH-only; the Saudi employer total 11.75% includes this 2%",
    reviewNote: `The OH wage cap pinned at 45,000 (the owner's expected value; corroborated — the same contributory-wage ceiling as the pension arm per the Law Part 1 Art. 8(2)). ${GOSI_OPEN_ITEM_NOTE}`,
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
