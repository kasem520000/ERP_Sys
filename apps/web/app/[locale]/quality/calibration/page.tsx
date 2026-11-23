/**
 * /{locale}/quality/calibration — the calibration board (PHASE-050 W-29,
 * T-15): the instrument-calibration register + the record form + the sweep
 * config's read/write. quality.view gates the register; the sweep config
 * rides quality.calibration.manage (a viewer's 403 renders that slot's own
 * typed refusal — the register still works); the asset pool degrades to []
 * on its own 403 (the job-cards rule).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { QualityCalibrationBoard } from "../../../../components/quality-calibration-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CalibrationRow,
  CalibrationSweepConfigRow,
  FixedAssetRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function QualityCalibrationPage({
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

  const [calibrations, assets, sweepConfig] = await Promise.all([
    fetchApi<readonly CalibrationRow[]>("quality/calibration"),
    fetchApi<readonly FixedAssetRow[]>("fixed-assets/assets?limit=200"),
    fetchApi<CalibrationSweepConfigRow>("quality/calibration/sweep-config"),
  ]);
  if (!calibrations.ok && calibrations.status === 401) {
    redirect(`/${locale}/login`);
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="quality/calibration"
      title={d.qualityCalibrationTitle}
    >
      <QualityCalibrationBoard
        locale={localeValue}
        initialCalibrations={calibrations.ok ? calibrations.data : null}
        calibrationsError={calibrations.ok ? null : calibrations.error}
        initialSweepConfig={sweepConfig.ok ? sweepConfig.data : null}
        sweepConfigError={sweepConfig.ok ? null : sweepConfig.error}
        assets={assets.ok ? assets.data : []}
      />
    </AppShell>
  );
}
