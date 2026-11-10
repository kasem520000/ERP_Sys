/**
 * /{locale}/inventory/import — import & export console (requires
 * items.import.run; 403 → "no permission" state). The server fetches the
 * recent jobs page for the history card; the wizard owns the upload seam
 * (carrier attachment slot → presigned PUT → import job) and the commit
 * polling.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ImportWizard } from "../../../../components/import-wizard";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ImportJobRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const JOBS_LIMIT = 10;

export default async function ImportPage({
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

  const jobs = await fetchApi<readonly ImportJobRow[]>(`items/import-jobs?limit=${JOBS_LIMIT}`);
  if (!jobs.ok && jobs.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!jobs.ok) {
    const forbidden = jobs.status === 403 || jobs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden ? d.errorsForbidden : localizedApiError(d, jobs.error, jobs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = <ImportWizard locale={localeValue} initialJobs={jobs.data} />;
  }

  return (
    <AppShell locale={localeValue} pagePath="inventory/import" title={d.navImport}>
      {content}
    </AppShell>
  );
}
