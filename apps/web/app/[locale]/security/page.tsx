/**
 * /{locale}/security — PUBLIC (PHASE-024 T14): the security disclosure
 * policy page (AR+EN via the dictionary — every string localized; i18n
 * parity gate). Structure follows the public-page pattern (login/pricing):
 * PublicShell with the wide "page" layout — no app shell, no session, no
 * navigation fetch. Content per SECURITY_TEST_PLAN §12 (the security@
 * contact + published disclosure policy that any future bug-bounty program
 * requires as its prerequisite) and the INCIDENT_RESPONSE §1 severity
 * ladder for the triage note. The contact address is the documented
 * PLACEHOLDER (`security@erp.example`) — configured at deployment; no
 * fabricated real domain (the no-fabrication discipline).
 */
import { notFound } from "next/navigation";
import type { JSX } from "react";

import { InfoNotice } from "../../../components/notices";
import { PublicShell } from "../../../components/public-shell";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";

export default async function SecurityDisclosurePage({
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

  return (
    <PublicShell locale={localeValue} pagePath="security" title={d.disclosureTitle} layout="page">
      <p className="max-w-2xl text-sm text-gray-600">{d.disclosureIntro}</p>

      <section aria-labelledby="disclosure-contact-heading" className="flex flex-col gap-3">
        <h2 id="disclosure-contact-heading" className="text-lg font-semibold text-gray-900">
          {d.disclosureContactHeading}
        </h2>
        <p className="max-w-2xl text-sm text-gray-700">{d.disclosureContactBody}</p>
        <p className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className="rounded-sm border border-subtle bg-gray-100 px-2 py-1 font-mono text-sm text-gray-900">
            {d.disclosureContactAddress}
          </span>
        </p>
        <InfoNotice>{d.disclosureContactPlaceholderNote}</InfoNotice>
      </section>

      <section aria-labelledby="disclosure-commitment-heading" className="flex flex-col gap-3">
        <h2 id="disclosure-commitment-heading" className="text-lg font-semibold text-gray-900">
          {d.disclosureCommitmentHeading}
        </h2>
        <ul className="flex max-w-2xl flex-col gap-2 text-sm text-gray-700">
          <li className="flex gap-2">
            <span aria-hidden="true">✓</span>
            <span>{d.disclosureCommitmentAck}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">✓</span>
            <span>{d.disclosureCommitmentUpdates}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">✓</span>
            <span>{d.disclosureCommitmentCoordinated}</span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="disclosure-safeharbor-heading" className="flex flex-col gap-3">
        <h2 id="disclosure-safeharbor-heading" className="text-lg font-semibold text-gray-900">
          {d.disclosureSafeHarborHeading}
        </h2>
        <p className="max-w-2xl text-sm text-gray-700">{d.disclosureSafeHarborBody}</p>
      </section>

      <section aria-labelledby="disclosure-guidelines-heading" className="flex flex-col gap-3">
        <h2 id="disclosure-guidelines-heading" className="text-lg font-semibold text-gray-900">
          {d.disclosureGuidelinesHeading}
        </h2>
        <ul className="flex max-w-2xl flex-col gap-2 text-sm text-gray-700">
          <li className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{d.disclosureGuidelineTesting}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{d.disclosureGuidelineNoDegrade}</span>
          </li>
          <li className="flex gap-2">
            <span aria-hidden="true">•</span>
            <span>{d.disclosureGuidelineReport}</span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="disclosure-scope-heading" className="flex flex-col gap-3">
        <h2 id="disclosure-scope-heading" className="text-lg font-semibold text-gray-900">
          {d.disclosureScopeHeading}
        </h2>
        <p className="max-w-2xl text-sm text-gray-700">{d.disclosureScopeBody}</p>
      </section>

      <section aria-labelledby="disclosure-triage-heading" className="flex flex-col gap-3">
        <h2 id="disclosure-triage-heading" className="text-lg font-semibold text-gray-900">
          {d.disclosureTriageHeading}
        </h2>
        <p className="max-w-2xl text-sm text-gray-700">{d.disclosureTriageBody}</p>
        <p className="max-w-2xl border-t border-subtle pt-4 text-sm text-gray-600">
          {d.disclosureBountyNote}
        </p>
      </section>
    </PublicShell>
  );
}
