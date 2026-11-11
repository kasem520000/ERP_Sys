/**
 * WEB-039 (PHASE-039) — /{locale}/sales/dunning: the collections workspace
 * (matrix §3.2). The letters register load is gated by the seeded matrix key
 * sales.dunning.manage (a 403 renders the honest forbidden state); the
 * policies/sweep/actions/reviews writes carry the same key, the late-fee
 * pair carries sales.late-fees.manage, and the agencies/referrals layer
 * carries sales.collection-agencies.manage — all enforced server-side; the
 * workspace re-checks the session-derived flags for every write (the
 * agencies tab only renders for holders of its own key).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DunningWorkspace } from "../../../../components/dunning-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CollectionActionRow,
  CollectionAgencyRow,
  CollectionReferralRow,
  CreditReviewRow,
  CurrentSession,
  DunningLetterRow,
  DunningPolicyRow,
  PartnerRow,
  SalesInvoiceRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesDunningPage({
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

  const [letters, policies, actions, reviews, agencies, referrals, customers, suppliers, invoices, session] =
    await Promise.all([
      fetchApi<readonly DunningLetterRow[]>("sales/dunning/letters?limit=200"),
      fetchApi<readonly DunningPolicyRow[]>("sales/dunning/policies"),
      fetchApi<readonly CollectionActionRow[]>("sales/dunning/actions?limit=200"),
      fetchApi<readonly CreditReviewRow[]>("sales/credit-reviews?due=1"),
      // The agencies/referrals layer rides its own manage key; on failure
      // the tab degrades away (canAgencies=false hides it entirely).
      fetchApi<readonly CollectionAgencyRow[]>("sales/collection-agencies"),
      fetchApi<readonly CollectionReferralRow[]>("sales/collection-referrals"),
      // The partner registry is cursor-paginated with a 100-row page cap —
      // customers feed the letters/actions/reviews/refer pickers, suppliers
      // feed the agency register (both degrade to [] on failure; the pos
      // reference-data idiom).
      fetchApi<readonly PartnerRow[]>("partners/partners?kind=CUSTOMER&limit=100"),
      fetchApi<readonly PartnerRow[]>("partners/partners?kind=SUPPLIER&limit=100"),
      fetchApi<readonly SalesInvoiceRow[]>(
        "sales/sales-invoices?status=POSTED&kind=CREDIT&limit=100",
      ),
      fetchApi<CurrentSession>("identity/sessions/current"),
    ]);
  if ((!letters.ok && letters.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!letters.ok) {
    const forbidden = letters.status === 403 || letters.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, letters.error, letters.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    // BOTH-kind partners ride both kind pages — dedupe by id before the
    // pickers (a partner listed twice is a lie about the register).
    const partnersById = new Map<string, PartnerRow>();
    for (const row of [
      ...(customers.ok ? customers.data : []),
      ...(suppliers.ok ? suppliers.data : []),
    ]) {
      partnersById.set(row.id, row);
    }
    content = (
      <DunningWorkspace
        locale={localeValue}
        initialLetters={letters.data}
        initialPolicies={policies.ok ? policies.data : []}
        initialActions={actions.ok ? actions.data : []}
        initialReviews={reviews.ok ? reviews.data : []}
        initialAgencies={agencies.ok ? agencies.data : []}
        initialReferrals={referrals.ok ? referrals.data : []}
        partners={[...partnersById.values()]}
        invoices={invoices.ok ? invoices.data : []}
        canDun={permissions.includes("sales.dunning.manage")}
        canFees={permissions.includes("sales.late-fees.manage")}
        canAgencies={permissions.includes("sales.collection-agencies.manage")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/dunning" title={d.dunningTitle}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{d.dunningSubtitle}</p>
        {content}
      </div>
    </AppShell>
  );
}
