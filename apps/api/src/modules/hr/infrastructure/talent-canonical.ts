import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-047 (W-1 — the competency scale's canonical source, T-04): the
 * ONE shipped default (red line 5's law — the scale is tenant-configurable
 * DATA with a documented default, never a fabricated compliance fact).
 * The descriptors are generic professional-development language; a tenant
 * edits them freely (the descriptors are the tenant's own calibration).
 *
 * One source, both paths (the materializeCanonicalStatutorySet precedent,
 * 046): 0098 §4 sweeps EXISTING tenants through the 0093-gated
 * migration-plane gate; the onboarding hook materializes NEW tenants via
 * THIS function — idempotent on the (tenant, level) natural key, so the
 * two paths never conflict and never duplicate.
 */

export interface CanonicalCompetencyLevelRow {
  readonly level: 1 | 2 | 3 | 4 | 5;
  readonly name: string;
  readonly nameAr: string;
  readonly descriptor: string;
  readonly descriptorAr: string;
}

const LEVEL_1 = Object.freeze({
  level: 1,
  name: "Beginner",
  nameAr: "مبتدئ",
  descriptor:
    "Initial familiarity with the competency — performs simple tasks with structured guidance.",
  descriptorAr: "إلمام مبدئي بالكفاءة — يؤدي المهام البسيطة بإرشاد منظم.",
} as const);
const LEVEL_2 = Object.freeze({
  level: 2,
  name: "Developing",
  nameAr: "في طور التطور",
  descriptor:
    "Applies the competency in routine situations — needs support on non-routine cases.",
  descriptorAr: "يطبّق الكفاءة في المواقف الاعتيادية — يحتاج دعماً في الحالات غير الاعتيادية.",
} as const);
const LEVEL_3 = Object.freeze({
  level: 3,
  name: "Proficient",
  nameAr: "متمكن",
  descriptor:
    "Applies the competency independently across normal scope — a reliable performer.",
  descriptorAr: "يطبّق الكفاءة باستقلال في النطاق المعتاد — مؤدٍّ موثوق.",
} as const);
const LEVEL_4 = Object.freeze({
  level: 4,
  name: "Advanced",
  nameAr: "متقدم",
  descriptor:
    "Handles complex and non-routine cases — coaches others on the competency.",
  descriptorAr: "يتعامل مع الحالات المعقدة وغير الاعتيادية — يوجّه الآخرين في الكفاءة.",
} as const);
const LEVEL_5 = Object.freeze({
  level: 5,
  name: "Expert",
  nameAr: "خبير",
  descriptor:
    "The reference point: shapes practice, resolves the hardest cases, grows the capability in others.",
  descriptorAr: "نقطة المرجع: يطوّر الممارسة ويحل أصعب الحالات وينمّي القدرة لدى الآخرين.",
} as const);

export const CANONICAL_COMPETENCY_LEVEL_ROWS: readonly CanonicalCompetencyLevelRow[] =
  Object.freeze([LEVEL_1, LEVEL_2, LEVEL_3, LEVEL_4, LEVEL_5]);

/**
 * Materialize the canonical 1–5 scale for the CURRENT tenant (the ambient
 * UoW) — idempotent on (tenant_id, level): the 0098 §4 seed's INSERT … ON
 * CONFLICT DO NOTHING shape, one source for the seed migration's
 * existing-tenant sweep and the onboarding flow's new-tenant step.
 */
export async function materializeCanonicalCompetencyScale(): Promise<number> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the competency-scale materialization requires an ambient tenant scope");
  }
  const tx = context.tx;
  for (const row of CANONICAL_COMPETENCY_LEVEL_ROWS) {
    await tx.execute(sql`
      INSERT INTO "competency_levels"
        ("id", "tenant_id", "level", "name", "name_ar", "descriptor", "descriptor_ar")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.level}, ${row.name},
              ${row.nameAr}, ${row.descriptor}, ${row.descriptorAr})
      ON CONFLICT ("tenant_id", "level") DO NOTHING
    `);
  }
  return CANONICAL_COMPETENCY_LEVEL_ROWS.length;
}
