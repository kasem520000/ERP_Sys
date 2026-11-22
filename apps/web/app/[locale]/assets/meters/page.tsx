/**
 * /{locale}/assets/meters — the meters board (PHASE-049 W-21, T-14): the
 * meters register + the readings log + the R-10 odometer designation flows
 * + the fleet register (the four expiry columns with SQL-derived days).
 * assets.meters.view is the board's primary read key; assets.expiry.view
 * gates the fleet pane (the two-primary screen: a pane that refuses renders
 * its own typed-refusal state; a full 403 on BOTH renders the forbidden
 * state). The asset pool (the filters + the create dialog's select)
 * degrades to [] on its own 403 (the job-cards rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { AssetsMetersBoard } from "../../../../components/assets-meters-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  AssetMeterRow,
  FixedAssetRow,
  FleetLightRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function AssetsMetersPage({
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

  const [meters, fleet, assets] = await Promise.all([
    fetchApi<readonly AssetMeterRow[]>("assets/meters"),
    fetchApi<readonly FleetLightRow[]>("assets/fleet-light"),
    fetchApi<readonly FixedAssetRow[]>("fixed-assets/assets?limit=200"),
  ]);
  if ((!meters.ok && meters.status === 401) || (!fleet.ok && fleet.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const metersForbidden =
    !meters.ok && (meters.status === 403 || meters.error.code === "FORBIDDEN");
  const fleetForbidden =
    !fleet.ok && (fleet.status === 403 || fleet.error.code === "FORBIDDEN");

  let content: JSX.Element;
  if (metersForbidden && fleetForbidden) {
    content = <ErrorState title={d.errorsForbidden} />;
  } else {
    content = (
      <AssetsMetersBoard
        locale={localeValue}
        initialMeters={meters.ok ? meters.data : null}
        metersError={meters.ok ? null : meters.error}
        initialFleet={fleet.ok ? fleet.data : null}
        fleetError={fleet.ok ? null : fleet.error}
        assets={assets.ok ? assets.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="assets/meters" title={d.assetsMetersTitle}>
      {content}
    </AppShell>
  );
}
