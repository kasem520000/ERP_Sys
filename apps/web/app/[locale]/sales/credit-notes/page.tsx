/**
 * /{locale}/sales/credit-notes — credit-note workspace (BR-004; G-04/W-3):
 * sales.credit_notes.view for the list; create/approve/post keys gate the
 * actions server-side (matrix §3.2 — post is risky).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { SalesCreditNotes } from "../../../../components/sales-credit-notes";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CreditNoteRow,
  CurrentSession,
  PartnerRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function SalesCreditNotesPage({
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

  const [notes, customers, branches, session] = await Promise.all([
    fetchApi<readonly CreditNoteRow[]>("sales/credit-notes?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if ((!notes.ok && notes.status === 401) || (!session.ok && session.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!notes.ok) {
    const forbidden = notes.status === 403 || notes.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, notes.error, notes.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <SalesCreditNotes
        locale={localeValue}
        initialNotes={notes.data}
        customers={customers.ok ? customers.data : []}
        branches={branches.ok ? branches.data : []}
        canCreate={permissions.includes("sales.credit_notes.create")}
        canApprove={permissions.includes("sales.credit_notes.approve")}
        canPost={permissions.includes("sales.credit_notes.post")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="sales/credit-notes" title={d.salesCreditNotesTitle}>
      {content}
    </AppShell>
  );
}
