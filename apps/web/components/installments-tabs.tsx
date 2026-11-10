/**
 * PHASE-027 (wave F) — the installments module tab strip: the registry
 * carries ONE nav item (NAVIGATION_MODEL §1.1 `sales.installment-plans`),
 * so the module's sibling surfaces (plans / reports) navigate through this
 * in-page strip — the fixed-assets one-item-many-screens shape. Pure
 * presentational server component; the active tab carries aria-current.
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../i18n/dictionaries";

export function InstallmentsTabs({
  locale,
  active,
}: {
  locale: Locale;
  active: "plans" | "reports";
}): JSX.Element {
  const d = getDictionary(locale);
  const tabs: Array<{ id: typeof active; href: string; label: string }> = [
    { id: "plans", href: `/${locale}/installments`, label: d.instTitle },
    { id: "reports", href: `/${locale}/installments/reports`, label: d.instReportsTitle },
  ];
  return (
    <nav aria-label={d.navInstallmentPlans} className="flex flex-wrap items-center gap-2">
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
