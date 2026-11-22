/**
 * /{locale}/fixed-assets/[id] — asset detail (PAGE_ARCHETYPES §5): the
 * overview + financial DefLists, the append-only depreciation history
 * (reversed runs marked), and the lifecycle actions (capitalize G-21 while
 * the source is missing, revaluate, dispose → the wizard). 404 → notFound;
 * 401 → login; reference 403s degrade.
 *
 * PHASE-049 (W-21 — T-15 — the honest repair of the 044 wire drift): the
 * detail endpoint returns the NESTED FixedAssetDetailPayload (asset +
 * accumulated + netBookValue + depreciationHistory + components); the page
 * maps it ONCE to the card's FixedAssetDetailRow (one mapping, one place,
 * the engine's own figures verbatim). The pools: the cost centers (the
 * 0108 grouping label + the edit dialog's select) and the asset register
 * (the parent-asset link + the edit dialog's select) degrade to [] on
 * their own 403s; the branches feed the service-history transfer labels.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { FixedAssetDetail } from "../../../../components/fixed-asset-detail";
import { FixedAssetsTabs } from "../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  BranchRow,
  CostCenterRow,
  FixedAssetDetailPayload,
  FixedAssetDetailRow,
  FixedAssetRow,
  PartnerRow,
  TenantProfile,
  TenantUserRow,
} from "../../../../lib/api-types";
import { localizedName, localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function FixedAssetDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const detail = await fetchApi<FixedAssetDetailPayload>(`fixed-assets/assets/${id}`);
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`fixed-assets/${id}`} title={d.faTitle}>
        <div className="flex flex-col gap-4">
          <FixedAssetsTabs locale={localeValue} active="assets" />
          <ErrorState
            title={
              forbidden
                ? d.errorsForbidden
                : localizedApiError(d, detail.error, detail.retryAfterSeconds)
            }
            retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
          />
        </div>
      </AppShell>
    );
  }

  // THE ONE MAPPING (the nested payload flattened once at the page
  // boundary — the engine's own figures verbatim, never recomputed).
  const payload = detail.data;
  const row: FixedAssetDetailRow = {
    ...payload.asset,
    accumulatedToDate: payload.accumulated,
    nbv: payload.netBookValue,
    history: payload.depreciationHistory,
    components: payload.components,
  };
  const category = payload.category;

  const [users, partners, profile, branch, costCenters, assets] = await Promise.all([
    fetchApi<readonly TenantUserRow[]>("identity/users"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=200"),
    fetchApi<TenantProfile>("tenancy/profile"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly CostCenterRow[]>("accounting/cost-centers"),
    fetchApi<readonly FixedAssetRow[]>("fixed-assets/assets?limit=200"),
  ]);
  if (
    (!users.ok && users.status === 401) ||
    (!partners.ok && partners.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const custodian = users.ok
    ? users.data.find((entry) => entry.userId === row.custodianUserId) ?? null
    : null;
  const branchRow = branch.ok
    ? branch.data.find((entry) => entry.id === row.branchId) ?? null
    : null;
  // The parent-asset link: the page resolves the parent row from the asset
  // pool (the card renders the parent's own code — never a bare uuid).
  const parentAsset =
    assets.ok && row.parentAssetId !== null
      ? assets.data.find((asset) => asset.id === row.parentAssetId) ?? null
      : null;
  // The cost-center grouping label (the 0108 family's own join).
  const costCenter =
    costCenters.ok && row.costCenterId !== null
      ? costCenters.data.find((center) => center.id === row.costCenterId) ?? null
      : null;
  const costCenterLabel =
    costCenter === null ? null : `${costCenter.code} · ${localizedName(costCenter.name, costCenter.nameAr, localeValue)}`;

  return (
    <AppShell
      locale={localeValue}
      pagePath={`fixed-assets/${id}`}
      title={localizedName(row.name, row.nameAr, localeValue)}
    >
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="assets" />
        <FixedAssetDetail
          locale={localeValue}
          detail={row}
          category={category}
          branch={branchRow}
          custodian={custodian}
          partners={partners.ok ? partners.data : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          parentAsset={parentAsset}
          costCenterLabel={costCenterLabel}
          costCenters={costCenters.ok ? costCenters.data : []}
          assets={assets.ok ? assets.data : []}
          branches={branch.ok ? branch.data : []}
        />
      </div>
    </AppShell>
  );
}
