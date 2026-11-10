/**
 * /{locale}/purchasing/ap — payables views (list archetype §2): AP aging,
 * supplier statements, and the GRNI register — module-owned lists over
 * apQueries.* (report contracts register in PHASE-013).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { PurchasingAp } from "../../../../components/purchasing-ap";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ApAgingRow, GrniRegisterRow, PartnerRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PurchasingApPage({
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

  const [aging, grni, suppliers] = await Promise.all([
    fetchApi<readonly ApAgingRow[]>("purchasing/ap/aging"),
    fetchApi<readonly GrniRegisterRow[]>("purchasing/grni"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
  ]);
  if (!aging.ok && aging.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!aging.ok) {
    const forbidden = aging.status === 403 || aging.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, aging.error, aging.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PurchasingAp
        locale={localeValue}
        initialAging={aging.data}
        initialGrni={grni.ok ? grni.data : []}
        suppliers={
          (suppliers.ok ? suppliers.data : [])
            .filter((p) => p.kind === "SUPPLIER" || p.kind === "BOTH")
            .map((p) => ({ id: p.id, code: p.code, name: p.name, nameAr: p.nameAr }))
        }
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="purchasing/ap" title={d.purchasingApTitle}>
      {content}
    </AppShell>
  );
}
