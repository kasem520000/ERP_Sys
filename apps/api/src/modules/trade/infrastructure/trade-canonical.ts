import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-051 (W-35 — T-08, 2026-11-25) THE TRADE CANONICAL SOURCE (D-16
 * — «البذور بإقرار الدقة», the BR-055 family): the Incoterms-2020 set
 * and the HS chapter-level starter set as ONE shipped source, the same
 * rows the 0122 §6 seed materialized for every EXISTING tenant through
 * the 0098 migration-plane gate.
 *
 * One source, both paths (the materializeCanonicalStatutorySet
 * precedent 046, the competency scale 047): 0122 §6 sweeps EXISTING
 * tenants at the migration plane; the onboarding hook materializes NEW
 * tenants via THESE functions — idempotent on the natural keys ((tenant,
 * code) and (tenant, hs_code)), so the two paths never conflict and
 * never duplicate.
 *
 * THE ACCURACY DISCLAIMER rides every starter row VERBATIM (the 0122
 * §6 wording, one source both paths): the tenant owns the final
 * applicability/classification; a missing HS code is MISSING, never
 * invented; NO duty rates anywhere on the seeds (the rates live on the
 * declaration lines as tenant DATA, the phase doc §7's own
 * mitigation).
 */

export interface CanonicalIncotermRow {
  readonly code: string;
  readonly name: string;
  readonly nameAr: string;
  readonly carriageBySeller: boolean;
  readonly insuranceBySeller: boolean;
  readonly exportClearanceBySeller: boolean;
  readonly importClearanceBySeller: boolean;
  readonly importDutyBySeller: boolean;
}

const DISCLAIMER =
  "STARTER SET (Incoterms 2020) — the tenant owns the final applicability; verify against the contract and jurisdiction before use / مجموعة استهلالية (إنكوترمز 2020) — التحقق من الملاءمة النهائية مسؤولية المستأجر";

/** THE INCOTERMS-2020 SET (11 rules — the ICC 2020 edition's own
 * ownership matrix as registry DATA; the 0122 §6 VALUE rows VERBATIM,
 * one source both paths). */
export const CANONICAL_INCOTERM_ROWS: readonly CanonicalIncotermRow[] = Object.freeze([
  { code: "EXW", name: "Ex Works", nameAr: "تسليم المصنع", carriageBySeller: false, insuranceBySeller: false, exportClearanceBySeller: false, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "FCA", name: "Free Carrier", nameAr: "تسليم للناقل", carriageBySeller: false, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "FAS", name: "Free Alongside Ship", nameAr: "تسليم بجانب السفينة", carriageBySeller: false, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "FOB", name: "Free on Board", nameAr: "تسليم على متن السفينة", carriageBySeller: false, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "CFR", name: "Cost and Freight", nameAr: "التكلفة والنولون", carriageBySeller: true, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "CIF", name: "Cost, Insurance and Freight", nameAr: "التكلفة والتأمين والنولون", carriageBySeller: true, insuranceBySeller: true, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "CPT", name: "Carriage Paid To", nameAr: "النولون مدفوع إلى", carriageBySeller: true, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "CIP", name: "Carriage and Insurance Paid To", nameAr: "النولون والتأمين مدفوعان إلى", carriageBySeller: true, insuranceBySeller: true, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "DPU", name: "Delivered at Place Unloaded", nameAr: "التسليم مع التفريغ مدفوعة", carriageBySeller: true, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "DAP", name: "Delivered at Place", nameAr: "التسليم في المكان", carriageBySeller: true, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: false, importDutyBySeller: false },
  { code: "DDP", name: "Delivered Duty Paid", nameAr: "التسليم الرسوم مدفوعة", carriageBySeller: true, insuranceBySeller: false, exportClearanceBySeller: true, importClearanceBySeller: true, importDutyBySeller: true },
] as const);

export interface CanonicalHsStarterRow {
  readonly hsCode: string;
  readonly name: string;
  readonly nameAr: string;
}

const HS_DISCLAIMER =
  "STARTER SET (HS chapter level) — REQUIRES_VERIFICATION: the tenant owns the final classification (HS edition and jurisdiction); a missing code is MISSING, never invented / مجموعة استهلالية (مستوى الفصول) — التصنيف النهائي مسؤولية المستأجر";

/** THE HS STARTER SET (14 chapter-level headings — the 0122 §6 VALUE
 * rows VERBATIM, one source both paths; NO duty rates, ever). */
export const CANONICAL_HS_STARTER_ROWS: readonly CanonicalHsStarterRow[] = Object.freeze([
  { hsCode: "03", name: "Fish, crustaceans, molluscs, aquatic invertebrates", nameAr: "الأسماك والقشريات والرخويات واللافقاريات المائية" },
  { hsCode: "08", name: "Edible fruit and nuts; citrus peel", nameAr: "الفواكه والمكسرات الصالحة للأكل وقشور الحمضيات" },
  { hsCode: "10", name: "Cereals", nameAr: "الحبوب" },
  { hsCode: "27", name: "Mineral fuels, mineral oils and products", nameAr: "الوقود المعدني والزيوت المعدنية ومنتجاتها" },
  { hsCode: "30", name: "Pharmaceutical products", nameAr: "المنتجات الصيدلانية" },
  { hsCode: "39", name: "Plastics and articles thereof", nameAr: "اللدائن ومنتجاتها" },
  { hsCode: "40", name: "Rubber and articles thereof", nameAr: "المطاط ومنتجاته" },
  { hsCode: "52", name: "Cotton", nameAr: "القطن" },
  { hsCode: "61", name: "Apparel, knitted or crocheted", nameAr: "الملابس المحبوكة أو المزركشة" },
  { hsCode: "62", name: "Apparel, not knitted or crocheted", nameAr: "الملابس غير المحبوكة" },
  { hsCode: "72", name: "Iron and steel", nameAr: "الحديد والفولاذ" },
  { hsCode: "84", name: "Machinery and mechanical appliances", nameAr: "الآلات والأجهزة الميكانيكية" },
  { hsCode: "85", name: "Electrical machinery and equipment", nameAr: "الآلات والأجهزة الكهربائية" },
  { hsCode: "87", name: "Vehicles other than railway rolling stock", nameAr: "المركبات عدا عربات السكك الحديدية" },
] as const);

/**
 * Materialize the canonical Incoterms-2020 set for the CURRENT tenant
 * (the ambient UoW) — idempotent on (tenant_id, code): the 0122 §6
 * seed's INSERT … ON CONFLICT DO NOTHING shape, one source for the
 * seed migration's existing-tenant sweep and the onboarding flow's
 * new-tenant step (the 0098 competency-scale precedent's own shape).
 */
export async function materializeCanonicalIncoterms(): Promise<number> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the incoterms materialization requires an ambient tenant scope");
  }
  const tx = context.tx;
  for (const row of CANONICAL_INCOTERM_ROWS) {
    await tx.execute(sql`
      INSERT INTO "incoterms"
        ("id", "tenant_id", "code", "name", "name_ar",
         "carriage_by_seller", "insurance_by_seller",
         "export_clearance_by_seller", "import_clearance_by_seller",
         "import_duty_by_seller", "note")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.code}, ${row.name},
              ${row.nameAr}, ${row.carriageBySeller}, ${row.insuranceBySeller},
              ${row.exportClearanceBySeller}, ${row.importClearanceBySeller},
              ${row.importDutyBySeller}, ${DISCLAIMER})
      ON CONFLICT ("tenant_id", "code") DO NOTHING
    `);
  }
  return CANONICAL_INCOTERM_ROWS.length;
}

/**
 * Materialize the canonical HS chapter-level starter set for the
 * CURRENT tenant (the ambient UoW) — idempotent on (tenant_id,
 * hs_code), the same one-source shape; the disclaimer rides every row,
 * NO duty rates anywhere (D-16's own law).
 */
export async function materializeCanonicalHsStarterSet(): Promise<number> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the HS starter materialization requires an ambient tenant scope");
  }
  const tx = context.tx;
  for (const row of CANONICAL_HS_STARTER_ROWS) {
    await tx.execute(sql`
      INSERT INTO "hs_code_registry"
        ("id", "tenant_id", "hs_code", "name", "name_ar", "note")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.hsCode}, ${row.name},
              ${row.nameAr}, ${HS_DISCLAIMER})
      ON CONFLICT ("tenant_id", "hs_code") DO NOTHING
    `);
  }
  return CANONICAL_HS_STARTER_ROWS.length;
}
