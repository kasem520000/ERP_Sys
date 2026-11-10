/**
 * /{locale}/fixed-assets/disposals — the disposals list + the disposal
 * wizard (PAGE_ARCHETYPES §9): disposals + register snapshot server-seeded;
 * `?asset=:id` (the asset-detail lifecycle action) lands preselected. The
 * branding for the posted a4-document voucher rides the tenant profile.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { AssetDisposals } from "../../../../components/asset-disposals";
import { FixedAssetsTabs } from "../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AssetDisposalRow,
  FixedAssetListRow,
  TenantProfile,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function FixedAssetDisposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ asset?: string | string[] }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const { asset } = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);
  const preselected = typeof asset === "string" && asset !== "" ? asset : null;

  await requireSessionToken(localeValue);

  const [disposals, assets, profile] = await Promise.all([
    fetchApi<readonly AssetDisposalRow[]>("fixed-assets/disposals?limit=100"),
    fetchApi<readonly FixedAssetListRow[]>("fixed-assets/assets?limit=200"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (!disposals.ok && disposals.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!assets.ok && assets.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!profile.ok && profile.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!disposals.ok) {
    const forbidden = disposals.status === 403 || disposals.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="disposals" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, disposals.error, disposals.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="disposals" />
        <AssetDisposals
          locale={localeValue}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          initialDisposals={disposals.data}
          assets={assets.ok ? assets.data : []}
          preselectedAssetId={preselected}
          branding={{
            tenantName: profile.ok ? profile.data.name : "",
            tenantNameAr: profile.ok ? profile.data.nameAr ?? undefined : undefined,
          }}
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="fixed-assets/disposals" title={d.faDisposalsTitle}>
      {content}
    </AppShell>
  );
}
