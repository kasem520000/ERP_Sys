/**
 * /{locale}/assets/transfers — the transfers board (PHASE-049 W-21, T-14):
 * the branch-to-branch transfer register with its approval ladder
 * (DRAFT → SUBMITTED → APPROVED/REJECTED) and the G-61 NBV reclassification
 * verdict on approval. assets.transfer.view is the board's primary read key
 * (a full 403 renders the forbidden state). The supporting pools — the
 * asset register and the branches — degrade to [] on their own 403s (the
 * job-cards rule; the join falls back to short ids).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { AssetsTransfersBoard } from "../../../../components/assets-transfers-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AssetTransferRow,
  BranchRow,
  FixedAssetRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function AssetsTransfersPage({
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

  const [transfers, assets, branches] = await Promise.all([
    fetchApi<readonly AssetTransferRow[]>("assets/transfers"),
    fetchApi<readonly FixedAssetRow[]>("fixed-assets/assets?limit=200"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
  ]);
  if (!transfers.ok && transfers.status === 401) {
    redirect(`/${locale}/login`);
  }

  const transfersForbidden =
    !transfers.ok && (transfers.status === 403 || transfers.error.code === "FORBIDDEN");

  let content: JSX.Element;
  if (transfersForbidden) {
    content = <ErrorState title={d.errorsForbidden} />;
  } else {
    content = (
      <AssetsTransfersBoard
        locale={localeValue}
        initialTransfers={transfers.ok ? transfers.data : null}
        transfersError={transfers.ok ? null : transfers.error}
        assets={assets.ok ? assets.data : []}
        branches={branches.ok ? branches.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="assets/transfers" title={d.assetsTransfersTitle}>
      {content}
    </AppShell>
  );
}
