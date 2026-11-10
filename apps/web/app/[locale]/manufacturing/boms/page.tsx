/**
 * /{locale}/manufacturing/boms — the BOM registry (PHASE-018 T41,
 * MASTER-PLAN §14): versioned recipes per FG item (DRAFT → ACTIVE →
 * ARCHIVED; one active per item), the component-lines editor (qty per
 * output unit, scrap %, yield), activate/archive transitions and the
 * multi-level explosion preview (planning data only — a BOM never posts a
 * journal). BOMs are the primary resource — 403 renders the forbidden
 * state; the STOCK items pool (component/FG selects) degrades to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ManufacturingBoms } from "../../../../components/manufacturing-boms";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { BomRow, ItemRow, UomRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function ManufacturingBomsPage({
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

  const [boms, items, uoms] = await Promise.all([
    fetchApi<readonly BomRow[]>("manufacturing/boms?limit=200"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
    // Supporting read: uom codes for the output-unit display (the create
    // dialog sends the item's base uom as outputUomId — the user sees it).
    fetchApi<readonly UomRow[]>("items/uoms"),
  ]);
  if (!boms.ok && boms.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!boms.ok) {
    const forbidden = boms.status === 403 || boms.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, boms.error, boms.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ManufacturingBoms
        locale={localeValue}
        initialRows={boms.data}
        items={(items.ok ? items.data : []).filter((item) => item.kind === "STOCK")}
        uoms={uoms.ok ? uoms.data : []}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="manufacturing/boms"
      title={d.mfgBomsTitle}
    >
      {content}
    </AppShell>
  );
}
