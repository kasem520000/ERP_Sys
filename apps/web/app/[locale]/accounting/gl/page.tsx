/**
 * /{locale}/accounting/gl — the GL browser (requires
 * accounting.journal_entries.view): trial-balance account list with drill
 * → account movements (running balance) → posted entry detail (lines +
 * source chain, INV-006) + the journal-register data feed. Statement
 * rendering arrives PHASE-013.
 *
 * PHASE-019 (T50): the browser gains the optional project filter (the T44
 * `projectId` query param on /gl/accounts, /gl/accounts/:id/movements and
 * /gl/journal-register) — an additive Select bound to accounting/projects
 * (the supporting read degrades to empty, hiding nothing when unavailable).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingGl } from "../../../../components/accounting-gl";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { AccountBalanceRow, JournalRegisterRow, ProjectRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function GlPage({
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

  const [balances, register, projects] = await Promise.all([
    fetchApi<readonly AccountBalanceRow[]>("accounting/gl/accounts"),
    fetchApi<readonly JournalRegisterRow[]>("accounting/gl/journal-register?limit=100"),
    // Supporting read (degrades to empty): the project filter pool.
    fetchApi<readonly ProjectRow[]>("accounting/projects"),
  ]);
  if (
    (!balances.ok && balances.status === 401) ||
    (!register.ok && register.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!balances.ok) {
    const forbidden = balances.status === 403 || balances.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, balances.error, balances.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <AccountingGl
        locale={localeValue}
        initialBalances={balances.data}
        initialRegister={register.ok ? register.data : []}
        projects={projects.ok ? projects.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/gl" title={d.accountingGlTitle}>
      {content}
    </AppShell>
  );
}
