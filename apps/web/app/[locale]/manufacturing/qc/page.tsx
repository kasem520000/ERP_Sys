/**
 * /{locale}/manufacturing/qc — the QC inspection log + entry (PHASE-018
 * T41, MASTER-PLAN §14 §4): pass/fail records against COMPLETED production
 * orders (their FG batch) or goods receipts, with sampled/sample-size and
 * the dispositions (accept/scrap/rework/return-to-supplier). A create
 * carries the gate's side effects (quarantine release — no journal;
 * FAIL+SCRAP — the qc_scrap journal). Inspections are the primary
 * resource — 403 renders the forbidden state; the COMPLETED orders pool
 * (inspection targets) and items degrade to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingQc } from "../../../../components/manufacturing-qc";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  InspectionRow,
  ItemRow,
  ProductionOrderRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingQcPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const [inspections, orders, items] = await Promise.all([
    fetchApi<readonly InspectionRow[]>("manufacturing/inspections?limit=200"),
    // Supporting pool: COMPLETED orders are the legal production_order
    // inspection targets (the FG batch exists only after completion).
    fetchApi<readonly ProductionOrderRow[]>("manufacturing/production-orders?limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
  ]);
  if (!inspections.ok && inspections.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!inspections.ok) {
    const forbidden = inspections.status === 403 || inspections.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, inspections.error, inspections.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingQc
        locale={localeValue}
        initialRows={inspections.data}
        orders={(orders.ok ? orders.data : []).filter((order) => order.status === "COMPLETED")}
        items={items.ok ? items.data : []}
        today={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/qc"
      title={d.mfgQcTitle}
    >
      {content}
    </AppShell>
  );
}
