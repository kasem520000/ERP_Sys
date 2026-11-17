/**
 * /{locale}/payroll/eosb — the EOSB screen (PHASE-046 W-5 T-11,
 * PAGE_ARCHETYPES §11 Reconciliation/Health-Center shape — the hr-leave
 * pattern): the CALCULATIONS REGISTER (the computation evidence — the
 * kind/service-years/entitlement/provision/delta rows with their G-54
 * journal tie) + the BR-087 RECONCILIATION VIEW (computed entitlement ↔
 * provision balance ↔ settled at every row) + the TRUE-UP TRIGGER (the
 * G-54 delta-only act through the W-2 engine; the button renders only
 * when the session holds payroll.runs.post — the ledger act rides the
 * ledger key, matrix §3.24). The employee pool (the masked directory
 * read) joins the rows' employee ids to codes + names. 401 → login;
 * 403 → the honest forbidden state; a 403 on the pool degrades to the
 * honest id-only labels (the reads stand).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { EosbBoard } from "../../../../components/eosb-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  EmployeeListRow,
  EosbCalculationRow,
  EosbReconciliationRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function EosbPage({
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

  const [calculations, reconciliation, employees, session] = await Promise.all([
    fetchApi<readonly EosbCalculationRow[]>("payroll/eosb/calculations"),
    fetchApi<readonly EosbReconciliationRow[]>("payroll/eosb/reconciliation"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!calculations.ok && calculations.status === 401) ||
    (!reconciliation.ok && reconciliation.status === 401) ||
    (!employees.ok && employees.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!calculations.ok) {
    const forbidden = calculations.status === 403 || calculations.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, calculations.error, calculations.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <EosbBoard
        locale={localeValue}
        initialCalculations={calculations.data}
        initialReconciliation={reconciliation.ok ? reconciliation.data : []}
        employees={employees.ok ? employees.data : []}
        canTrueUp={permissions.includes("payroll.runs.post")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/eosb" title={d.payEosbTitle}>
      {content}
    </AppShell>
  );
}
