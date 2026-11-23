/**
 * /{locale}/quality/spc — the SPC board (PHASE-050 W-29, T-15): the
 * specification sample store + the X-bar/R chart read (the pure module's
 * output VERBATIM — D-12's zero-parallel-computation law). quality.spc.view
 * is the measurements read's own key.
 *
 * THE PAGE'S OWN READS: the specifications pool (quality/specifications
 * ?activeOnly=true — the spec picker's pool) and the FIRST spec's own
 * measurements (the primary read, server-side). Both degrade like the
 * genealogy page's pools: a 401 redirects to login, any other refusal
 * renders the board's own typed-refusal slots (the measurements read) or
 * the empty picker (the specs pool — the pasted-UUID path still works).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { AppShell } from "../../../../components/app-shell";
import { QualitySpcBoard } from "../../../../components/quality-spc-board";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ApiErrorBody,
  QualitySpecRow,
  SpcMeasurementRow,
} from "../../../../lib/api-types";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function QualitySpcPage({
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

  const specs = await fetchApi<readonly QualitySpecRow[]>(
    "quality/specifications?activeOnly=true",
  );
  if (!specs.ok && specs.status === 401) {
    redirect(`/${locale}/login`);
  }

  // The first spec's own measurements (the primary read, server-side) — the
  // sequential dependent read the picker's own shape demands (the
  // measurements route requires specId).
  const specPool = specs.ok ? specs.data : [];
  const firstSpecId = specPool.length > 0 ? specPool[0]!.id : null;
  let measurements: readonly SpcMeasurementRow[] | null = null;
  let measurementsError: ApiErrorBody | null = null;
  if (firstSpecId !== null) {
    const read = await fetchApi<readonly SpcMeasurementRow[]>(
      `quality/spc/measurements?specId=${firstSpecId}`,
    );
    if (!read.ok && read.status === 401) {
      redirect(`/${locale}/login`);
    }
    measurements = read.ok ? read.data : null;
    measurementsError = read.ok ? null : read.error;
  }

  return (
    <AppShell locale={localeValue} pagePath="quality/spc" title={d.qualitySpcTitle}>
      <QualitySpcBoard
        locale={localeValue}
        specs={specPool}
        initialSpecId={firstSpecId}
        initialMeasurements={measurements}
        measurementsError={measurementsError}
      />
    </AppShell>
  );
}
