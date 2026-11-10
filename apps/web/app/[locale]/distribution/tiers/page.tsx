/**
 * /{locale}/distribution/tiers — customer tiers + free-goods rules
 * (PHASE-017 T14 9a-dist): BR-003 tier price lists (the tier's SALE price
 * list resolves between the customer's own list and the item base price
 * at sale time) and the compact BR-008 buy-X-get-Y FOC list (rules never
 * post anything — the sale-time application computes zero-price lines).
 * Partner ASSIGNMENT rides the partners screen (customerTierId), not here.
 * Tiers are the primary resource — 403 renders the forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DistributionTiers } from "../../../../components/distribution-tiers";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CustomerTierRow,
  FreeGoodsRuleRow,
  ItemRow,
  PriceListRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function DistributionTiersPage({
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

  const [tiers, rules, priceLists, items] = await Promise.all([
    fetchApi<readonly CustomerTierRow[]>("distribution/tiers"),
    fetchApi<readonly FreeGoodsRuleRow[]>("distribution/free-goods-rules"),
    fetchApi<readonly PriceListRow[]>("items/price-lists?kind=SALE"),
    fetchApi<readonly ItemRow[]>("items/items?limit=100"),
  ]);
  if (!tiers.ok && tiers.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!tiers.ok) {
    const forbidden = tiers.status === 403 || tiers.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, tiers.error, tiers.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <DistributionTiers
        locale={localeValue}
        initialTiers={tiers.data}
        initialRules={rules.ok ? rules.data : []}
        priceLists={(priceLists.ok ? priceLists.data : []).filter(
          (list) => list.status === "ACTIVE" && list.kind === "SALE",
        )}
        items={(items.ok ? items.data : []).filter(
          (item) => item.kind === "STOCK" && item.deletedAt === null,
        )}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="distribution/tiers" title={d.distributionTiersTitle}>
      {content}
    </AppShell>
  );
}
