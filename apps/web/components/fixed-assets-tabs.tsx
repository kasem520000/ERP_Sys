/**
 * PHASE-026 (T13-UI) — the fixed-assets module tab strip: the registry
 * carries ONE nav item (NAVIGATION_MODEL §1.1 `accounting.fixed-assets`),
 * so the module's sibling surfaces (register / categories / depreciation /
 * disposals / reports) navigate through this in-page strip — the same
 * one-item-many-screens shape the manufacturing module uses for its
 * template-derived group. Pure presentational server component; the active
 * tab carries aria-current.
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";

export function FixedAssetsTabs({ locale, active }: { locale: Locale; active: "assets" | "categories" | "depreciation" | "disposals" | "reports" }): JSX.Element {
  const d = getDictionary(locale);
  const tabs: Array<{ id: typeof active; href: string; label: string }> = [
    { id: "assets", href: `/${locale}/fixed-assets`, label: d.faTitle },
    { id: "categories", href: `/${locale}/fixed-assets/categories`, label: d.faCategoriesTitle },
    { id: "depreciation", href: `/${locale}/fixed-assets/depreciation`, label: d.faDepTitle },
    { id: "disposals", href: `/${locale}/fixed-assets/disposals`, label: d.faDisposalsTitle },
    { id: "reports", href: `/${locale}/fixed-assets/reports`, label: d.faReportsTitle },
  ];
  return (
    <nav aria-label={d.navFixedAssets} className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) =>
        tab.id === active ? (
          <span
            key={tab.id}
            aria-current="page"
            className="rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-800"
          >
            {tab.label}
          </span>
        ) : (
          <a
            key={tab.id}
            href={tab.href}
            className="rounded-md border border-default bg-surface-card px-3 py-1.5 text-sm text-gray-700 outline-none hover:border-strong"
          >
            {tab.label}
          </a>
        ),
      )}
    </nav>
  );
}
