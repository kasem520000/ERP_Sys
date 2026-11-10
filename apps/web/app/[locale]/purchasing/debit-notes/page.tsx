/**
 * /{locale}/purchasing/debit-notes — debit-note workspace (G-09):
 * debit_notes.view for the list; create/approve/post keys gate the
 * actions (matrix §3.3 — approve/post are risky).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { PurchasingDebitNotes } from "../../../../components/purchasing-debit-notes";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  DebitNoteRow,
  ItemRow,
  PartnerRow,
  SupplierInvoiceRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PurchasingDebitNotesPage({
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

  const [notes, invoices, suppliers, items, session] = await Promise.all([
    fetchApi<readonly DebitNoteRow[]>("purchasing/debit-notes?limit=200"),
    fetchApi<readonly SupplierInvoiceRow[]>("purchasing/supplier-invoices?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly ItemRow[]>("inventory/items?limit=500"),
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
      <PurchasingDebitNotes
        locale={localeValue}
        initialNotes={notes.data}
        postedInvoices={(invoices.ok ? invoices.data : []).filter((invoice) => invoice.status === "POSTED")}
        suppliers={suppliers.ok ? suppliers.data : []}
        items={items.ok ? items.data : []}
        canCreate={permissions.includes("purchasing.debit_notes.create")}
        canApprove={permissions.includes("purchasing.debit_notes.approve")}
        canPost={permissions.includes("purchasing.debit_notes.post")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/debit-notes" title={d.purchasingDebitNotesTitle}>
      {content}
    </AppShell>
  );
}
