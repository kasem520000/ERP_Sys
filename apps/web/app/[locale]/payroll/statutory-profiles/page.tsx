/**
 * /{locale}/payroll/statutory-profiles — the statutory compliance screen
 * (PHASE-046 W-5 T-10, PAGE_ARCHETYPES §2 List+Search — the hr-leave
 * pattern): THREE TABS (contribution profiles / PIT brackets / EOSB
 * tiers), every row with its verification badge + the effective-dates
 * window + the citation. The verify act's button renders only when the
 * session holds payroll.statutory.verify (the runtime check — the
 * owner-only key, matrix §3.24); the citation body is mandatory. 401 →
 * login; 403 → the honest forbidden state; a 403 on the session read
 * degrades to canVerify=false (the button hides, the reads stand).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { StatutoryProfilesBoard } from "../../../../components/statutory-profiles-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  EosbRuleManagementRow,
  PitBracketManagementRow,
  StatutoryProfileManagementRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function StatutoryProfilesPage({
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

  const [profiles, brackets, rules, session] = await Promise.all([
    fetchApi<readonly StatutoryProfileManagementRow[]>("payroll/statutory/profiles"),
    fetchApi<readonly PitBracketManagementRow[]>("payroll/statutory/brackets"),
    fetchApi<readonly EosbRuleManagementRow[]>("payroll/statutory/eosb-rules"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!profiles.ok && profiles.status === 401) ||
    (!brackets.ok && brackets.status === 401) ||
    (!rules.ok && rules.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!profiles.ok) {
    const forbidden = profiles.status === 403 || profiles.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, profiles.error, profiles.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <StatutoryProfilesBoard
        locale={localeValue}
        initialProfiles={profiles.data}
        initialBrackets={brackets.ok ? brackets.data : []}
        initialRules={rules.ok ? rules.data : []}
        canVerify={permissions.includes("payroll.statutory.verify")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/statutory-profiles" title={d.payStatutoryTitle}>
      {content}
    </AppShell>
  );
}
