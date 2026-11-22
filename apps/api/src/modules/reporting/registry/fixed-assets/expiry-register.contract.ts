import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import type { FleetLightRow } from "../../../fixed_assets/infrastructure/cmms.store";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-049 (W-22 — T-16, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-049 row 4): `assets.expiry-register` — R-10's fleet-light
 * register as a report contract: the W-19 engine's own read VERBATIM
 * (every ACTIVE asset with its four expiry chips — warranty,
 * insurance, license, inspection — the days-to-expiry derived from
 * the DATABASE'S OWN CURRENT_DATE inside the statement, and the ONE
 * designated KM odometer's live snapshot). ZERO new tables, ZERO
 * parallel computation; the vehicle-class grouping is the caller's
 * category filter (tenant data — the platform never hard-codes which
 * category is a "vehicle"; the CR-50 light-only decision).
 *
 * The footer carries the register's binding law as the block-on-fail
 * assertion (`fleet-odometer-single-binding`): every asset appears
 * EXACTLY ONCE (the one-per-asset odometer law — a fanned-out join
 * would duplicate rows and the report surfaces it).
 *
 * Permission `assets.expiry.view` (matrix §3.27; the §12
 * module-register reuse rule — the same key the fleet register and
 * the sweep's renewal surfaces ride).
 */

const FLEET_SINGLE_BINDING = assertDecl(
  "fleet-odometer-single-binding",
  "The fleet register's binding law: every asset appears exactly once — the ONE designated KM odometer per asset (the one-per-asset law); a duplicated row is a join fan-out and blocks the export",
  "أصل مكرر في سجل الأسطول — انبساط ربط العداد الكيلومتري — التصدير محجوب",
  "A duplicated asset in the fleet register — an odometer-join fan-out — export blocked",
  "R-10",
);

function singleBindingResult(rows: readonly FleetLightRow[]): AssertionResult {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    if (seen.has(row.assetId)) {
      duplicates.push(row.code);
    }
    seen.add(row.assetId);
  }
  const ok = duplicates.length === 0;
  return {
    id: "fleet-odometer-single-binding",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `أصول مكررة: ${duplicates.slice(0, 5).join("، ")}`,
          `Duplicated asset(s): ${duplicates.slice(0, 5).join(", ")}`,
        ),
  };
}

/** One chip cell: the expiry date + the DB-derived days (the honest
 * absence — when the tenant tracks none). */
function chip(expiry: string | null, days: number | null): string {
  if (expiry === null) return "—";
  return `${expiry} (${days ?? "?"}d)`;
}

export const fixedAssetsExpiryRegisterContract = defineReport({
  id: "assets.expiry-register",
  version: 1,
  title: bilingual("سجل انتهاء صلاحية الأسطول", "Fleet Expiry Register"),
  category: "financial",
  description: bilingual(
    "سجل R-10 الخفيف للأسطول: كل أصل نشط برقائق انتهائه الأربع (الضمان والتأمين والترخيص والفحص — الأيام مشتقة من تاريخ قاعدة البيانات نفسها) مع لقطة العداد الكيلومتري المعيَّن — قراءة محرك W-19 نفسها حرفيًا، والتجميع حسب فئة المركبات فلتر المتصل",
    "R-10's fleet-light register: every ACTIVE asset with its four expiry chips (warranty, insurance, license, inspection — the days derived from the database's own date) and the designated KM odometer's snapshot — the W-19 engine's own read verbatim; the vehicle-class grouping is the caller's category filter",
  ),
  parameters: z.object({
    categoryIds: z.array(z.string().uuid()).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "assets.expiry.view",
  dataSources: [
    source(
      "fixed_assets",
      "CmmsQueriesService.expiryRegister → AssetExpirySweepService.fleetLight (the W-19 engine's own register — the four chips with the SQL-derived days + the odometer binding)",
      ["assets", "asset_categories", "branches", "asset_meters"],
      "سجل الأسطول الخفيف برقائق الانتهاء وربط العداد",
      "The fleet-light register with the expiry chips and the odometer binding",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  aggregation: {
    groupBy: ["category"],
    measures: [{ id: "assets", kind: "count" }],
    sorting: [{ by: "code", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "none", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 0,
    invalidationEvents: [],
  },
  assertions: [FLEET_SINGLE_BINDING],
  drillTargets: [
    drill("assetId", "/assets/meters", "لوحة العدادات وسجل الأسطول", "The meters + fleet board", "assets.expiry.view"),
  ],
  run: async (_ctx, params) => {
    const { cmmsQueries } = reportingServices();
    const rows = await cmmsQueries.expiryRegister({
      categoryIds: params.categoryIds as string[] | undefined,
    });

    const byCategory = new Map<string, { code: string; name: string; n: number }>();
    for (const row of rows) {
      const entry = byCategory.get(row.categoryId) ?? {
        code: row.categoryCode,
        name: row.categoryName,
        n: 0,
      };
      entry.n += 1;
      byCategory.set(row.categoryId, entry);
    }

    return {
      columns: [
        col("asset", "الأصل", "Asset"),
        col("category", "الفئة", "Category"),
        col("branch", "الفرع", "Branch"),
        col("status", "الحالة", "Status", "status"),
        col("warranty", "الضمان", "Warranty"),
        col("insurance", "التأمين", "Insurance"),
        col("license", "الترخيص", "License"),
        col("inspection", "الفحص", "Inspection"),
        qtyCol("odometer", "العداد الكيلومتري", "Odometer"),
      ],
      groups: [...byCategory.entries()].map(([key, entry]) => ({
        key,
        label: bilingual(`${entry.code} · ${entry.name} (${entry.n})`, `${entry.code} · ${entry.name} (${entry.n})`),
      })),
      rows: rows.map((row) => ({
        key: row.assetId,
        groupKey: row.categoryId,
        values: {
          asset: params.locale === "en" ? `${row.code} · ${row.name}` : `${row.code} · ${row.nameAr ?? row.name}`,
          category: row.categoryCode,
          branch: row.branchCode,
          status: row.status,
          warranty: chip(row.warrantyExpiry, row.warrantyDays),
          insurance: chip(row.insuranceExpiry, row.insuranceDays),
          license: chip(row.licenseExpiry, row.licenseDays),
          inspection: chip(row.inspectionExpiry, row.inspectionDays),
          odometer:
            row.odometerMeterId === null
              ? "—"
              : `${row.odometerValue ?? "?"} ${row.odometerUnit ?? ""}`.trim(),
        },
      })),
      totals: [
        {
          id: "assets",
          kind: "sum",
          label: bilingual("عدد الأصول", "Assets"),
          amount: String(rows.length),
        },
        {
          id: "withOdometer",
          kind: "sum",
          label: bilingual("بعداد كيلومتري معيَّن", "With a designated odometer"),
          amount: String(rows.filter((row) => row.odometerMeterId !== null).length),
        },
        {
          id: "warrantyTracked",
          kind: "sum",
          label: bilingual("يتتبع الضمان", "Tracking warranty"),
          amount: String(rows.filter((row) => row.warrantyExpiry !== null).length),
        },
        {
          id: "licenseTracked",
          kind: "sum",
          label: bilingual("يتتبع الترخيص", "Tracking license"),
          amount: String(rows.filter((row) => row.licenseExpiry !== null).length),
        },
      ],
      assertionResults: [singleBindingResult(rows)],
      notes: [
        bilingual(
          "الأيام المتبقية مشتقة من تاريخ قاعدة البيانات نفسها داخل الاستعلام (CURRENT_DATE) — نفس قانون خطوة الاشتقاق الذي يعمل به الكنس. الرقائق الأربع شأن بيانات المستأجر: الخلية (—) تعني أن المستأجر لا يتتبع هذا الانتهاء لهذا الأصل، وربط العداد الكيلومتري واحد لكل أصل (قانون العداد المعيَّن الواحد)",
          "The days-to-expiry derive from the database's own CURRENT_DATE inside the statement — the same derived-step law the sweep runs on. The four chips are tenant data: a (—) cell means the tenant tracks no such expiry for this asset, and the KM odometer binding is ONE per asset (the single designated-odometer law)",
        ),
      ],
    };
  },
});
