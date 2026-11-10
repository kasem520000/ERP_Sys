/**
 * /{locale}/notes/new — note registration (PAGE_ARCHETYPES §3, Create/Edit):
 * the direction picker drives the source-document set — receive-against-
 * invoice lists POSTED CREDIT sales invoices, issue-against-supplier-invoice
 * lists POSTED supplier invoices (the exact sets the API validates; no
 * manual UUID fallback needed — both list endpoints exist with those
 * filters). Reference lists are fetched server-side; the client form owns
 * the inputs and the create POST through the BFF.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { NoteForm } from "../../../../components/note-form";
import { NotesTabs } from "../../../../components/notes-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { PartnerRow, SalesInvoiceRow, SupplierInvoiceRow, TenantProfile } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function NewNotePage({
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

  const [partners, salesInvoices, supplierInvoices, profile] = await Promise.all([
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    // The receive-against-invoice picker: POSTED credit invoices only.
    fetchApi<readonly SalesInvoiceRow[]>("sales/sales-invoices?status=POSTED&kind=CREDIT&limit=50"),
    // The issue-against-supplier-invoice picker: POSTED supplier invoices.
    fetchApi<readonly SupplierInvoiceRow[]>("purchasing/supplier-invoices?status=POSTED&limit=50"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!partners.ok && partners.status === 401) ||
    (!salesInvoices.ok && salesInvoices.status === 401) ||
    (!supplierInvoices.ok && supplierInvoices.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!partners.ok) {
    const forbidden = partners.status === 403 || partners.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="notes" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, partners.error, partners.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <NotesTabs locale={localeValue} active="notes" />
        <NoteForm
          locale={localeValue}
          partners={partners.data}
          salesInvoices={salesInvoices.ok ? salesInvoices.data : []}
          supplierInvoices={supplierInvoices.ok ? supplierInvoices.data : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="notes/new" title={d.notesNewTitle}>
      {content}
    </AppShell>
  );
}
