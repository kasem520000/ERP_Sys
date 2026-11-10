/**
 * /{locale}/opening-balances — opening-balance workspace (requires
 * partners.view; 403 → "no permission" state). PHASE-006: the DRAFT capture
 * console (partner/item tabs). PHASE-007: the POST step — the server loads
 * the fiscal years + accounting opening drafts; the post panel runs the
 * once-only posting through the OPENING period (BR-035).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { OpeningBalancesPanel } from "../../../components/opening-balances-panel";
import { OpeningPostPanel } from "../../../components/opening-post-panel";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  FiscalYearRow,
  ItemRow,
  OpeningBalanceDocRow,
  PartnerRow,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

const PAGE_LIMIT = 25;
const REFERENCE_LIMIT = 100;

export default async function OpeningBalancesPage({
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

  const [drafts, partners, items, years, accountingDrafts] = await Promise.all([
    fetchApi<readonly OpeningBalanceDocRow[]>(`partners/opening-balances?kind=PARTNER&limit=${PAGE_LIMIT}`),
    fetchApi<readonly PartnerRow[]>(`partners/partners?limit=${REFERENCE_LIMIT}`),
    fetchApi<readonly ItemRow[]>(`items/items?limit=${REFERENCE_LIMIT}`),
    // PHASE-007 post step — best effort (viewers without the accounting
    // permission keep the PHASE-006 draft console).
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
    fetchApi<readonly OpeningBalanceDocRow[]>("accounting/opening-balances"),
  ]);
  if (
    (!drafts.ok && drafts.status === 401) ||
    (!partners.ok && partners.status === 401) ||
    (!items.ok && items.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!drafts.ok) {
    const forbidden = drafts.status === 403 || drafts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, drafts.error, drafts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        {years.ok && accountingDrafts.ok ? (
          <OpeningPostPanel
            locale={localeValue}
            years={years.data}
            initialDrafts={accountingDrafts.data}
          />
        ) : null}
        <OpeningBalancesPanel
          locale={localeValue}
          initialRows={drafts.data}
          initialHasMore={drafts.meta?.hasMore ?? false}
          initialNextCursor={drafts.meta?.nextCursor}
          partners={partners.ok ? partners.data : []}
          items={items.ok ? items.data : []}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="opening-balances" title={d.navOpeningBalances}>
      {content}
    </AppShell>
  );
}
