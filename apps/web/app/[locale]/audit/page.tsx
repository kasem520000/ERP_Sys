/**
 * PHASE-024 T8 — /{locale}/audit (session, audit.view): the tenant-admin
 * audit review console (the platform/audit structure, tenant plane). Filters
 * (action, actorId, entityType, entityId, correlationId, fromAt/toAt,
 * limit ≤ 500) submit through the router so they stay URL-encoded and
 * shareable; the server page re-runs the same filter set against
 * GET /audit/events (RLS-confined, ordered by `at` ASC) and renders the
 * table plus the "Export CSV" anchor to the dedicated BFF download route
 * (same query params — the export re-audits itself server-side, E-04).
 *
 * Viewers (no audit.view) get the localized permission ErrorState — the
 * same 403 pattern the settings/support-sessions pages use.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_LIMIT_OPTIONS,
  AuditReviewFilterForm,
} from "../../../components/audit-review-filter-form";
import { AuditReviewTable } from "../../../components/audit-review-table";
import { LinkButton } from "../../../components/link-button";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { TenantAuditEvent } from "../../../lib/api-types";
import { formatMessage, localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

function single(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && AUDIT_LIMIT_OPTIONS.includes(parsed)
    ? parsed
    : AUDIT_DEFAULT_LIMIT;
}

export default async function AuditReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const query = await searchParams;
  const action = single(query.action);
  const actorId = single(query.actorId);
  const entityType = single(query.entityType);
  const entityId = single(query.entityId);
  const correlationId = single(query.correlationId);
  const fromAt = single(query.fromAt);
  const toAt = single(query.toAt);
  const limit = parseLimit(single(query.limit));

  const search = new URLSearchParams({ limit: String(limit) });
  if (action !== "") {
    search.set("action", action);
  }
  if (actorId !== "") {
    search.set("actorId", actorId);
  }
  if (entityType !== "") {
    search.set("entityType", entityType);
  }
  if (entityId !== "") {
    search.set("entityId", entityId);
  }
  if (correlationId !== "") {
    search.set("correlationId", correlationId);
  }
  if (fromAt !== "") {
    search.set("fromAt", fromAt);
  }
  if (toAt !== "") {
    search.set("toAt", toAt);
  }

  const events = await fetchApi<readonly TenantAuditEvent[]>(`audit/events?${search.toString()}`);
  if (!events.ok && events.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!events.ok) {
    const forbidden = events.status === 403 || events.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, events.error, events.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-600">{d.auditReviewHint}</p>
        <AuditReviewFilterForm
          locale={localeValue}
          initial={{ action, actorId, entityType, entityId, correlationId, fromAt, toAt, limit }}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600" aria-live="polite">
            {formatMessage(d.auditResultCount, { count: events.data.length })}
            <span className="ms-2 text-xs">{d.auditOrderHint}</span>
          </p>
          {/* Same-origin anchor → the session cookie rides along; the dedicated
              BFF route streams the CSV attachment through. */}
          <LinkButton href={`/api/bff/audit/events/export?${search.toString()}`}>
            {d.auditExportCsv}
          </LinkButton>
        </div>
        <AuditReviewTable locale={localeValue} rows={events.data} />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="audit" title={d.auditReviewTitle}>
      {content}
    </AppShell>
  );
}
