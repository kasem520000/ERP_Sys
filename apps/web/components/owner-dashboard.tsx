"use client";

/**
 * T19-WEB (PHASE-014) — the owner/CEO dashboard (PAGE_ARCHETYPES §1; PHASE-014
 * §2.7): four KPI widgets bound to PHASE-013 report contracts with PINNED
 * parameters (REPORT_CATALOG §12 — widgets are LINKS, never parallel
 * implementations). Every number on this page comes from the bound
 * contract's run result envelope: the KPI is extracted from the envelope
 * (totals/rows) with exact decimal string math (lib/exact-money — ADR-0009);
 * NO side-channel math, no parallel queries. Clicking a card opens the
 * report workspace with those exact parameters (drill-down deep link).
 *
 * Honesty rules: a failed run or a FAIL reconciliation assertion renders
 * the widget's failure state (the workspace's chip vocabulary) — never a
 * fake number. Loading skeleton per widget; aria-live for async states.
 * Sparklines are SKIPPED by decision: all four widgets are pinned to a
 * single day/as-of snapshot, so the result rows carry no time series — a
 * chart across cash accounts would misrepresent single-day data (noted in
 * the worklog; multi-day windows arrive with PHASE-015's ChartCard).
 *
 * The local KPIStatCard shells use @erp/ui design tokens only (no ad-hoc
 * colors) — the catalog's KPIStatCard/ChartCard land in the design system
 * proper at PHASE-015.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { JSX } from "react";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  CrmDashboardSummary,
  ReportResultEnvelope,
  ReportRunOutcome,
  ReportRunStatus,
  UsageSnapshotData,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { addExact, subtractExact } from "../lib/exact-money";
import {
  formatDateTime,
  formatMessage,
  localizedApiError,
  localizedStatus,
} from "../lib/messages";
import { useReadOnly } from "../lib/read-only";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Dashboard-scoped report error localization (workspace vocabulary). */
function localizedReportError(
  d: Dictionary,
  error: ApiErrorBody,
  retryAfterSeconds?: number,
): string {
  if (error.code === "PARAMS_INVALID" || error.code === "CONTRACT_VERSION_MISMATCH") {
    return d.errorsValidation;
  }
  return localizedApiError(d, error, retryAfterSeconds);
}

interface WidgetData {
  kpi: string;
  secondary: string | null;
  /** Stock alerts only: first 5 rows (sku · warehouse · qty vs reorder). */
  preview: ReadonlyArray<{ id: string; sku: string; warehouse: string; qty: string; reorder: string }> | null;
}

interface WidgetState {
  status: "loading" | "ok" | "error";
  data: WidgetData | null;
  failedAssertions: string[];
  error: string | null;
}

const LOADING_STATE: WidgetState = {
  status: "loading",
  data: null,
  failedAssertions: [],
  error: null,
};

interface WidgetConfig {
  id: string;
  titleKey: "dashboardSalesToday" | "dashboardCashPosition" | "dashboardArOverdue" | "dashboardStockAlerts";
  reportKey: string;
  params: Record<string, unknown>;
  drillHref: string;
  /** Extract the KPI from the SAME result envelope (no side-channel math). */
  extract: (envelope: ReportResultEnvelope) => WidgetData;
}

/** Σ over integer row values (counts — not money; plain integers are safe). */
function sumInts(values: ReadonlyArray<string | number | null>): number {
  let total = 0;
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      total += parsed;
    }
  }
  return total;
}

function cellOf(row: ReportResultEnvelope["rows"][number], id: string): string {
  const value = row.values[id];
  return value === null || value === undefined ? "0" : String(value);
}

/**
 * Run one bound contract (POST reporting/report-runs), polling queued runs
 * like the workspace (2s up to 60s). The extraction runs on the SAME result
 * envelope the report workspace renders — identical numbers by construction.
 */
async function runWidgetReport(
  d: Dictionary,
  config: WidgetConfig,
  onState: (state: WidgetState) => void,
): Promise<void> {
  onState(LOADING_STATE);
  const outcome = await bffFetch<ReportRunOutcome>("reporting/report-runs", {
    method: "POST",
    body: { reportKey: config.reportKey, params: config.params },
  });
  if (!outcome.ok) {
    onState({
      status: "error",
      data: null,
      failedAssertions: [],
      error: localizedReportError(d, outcome.error, outcome.retryAfterSeconds),
    });
    return;
  }
  let envelope: ReportResultEnvelope | null = outcome.data.result ?? null;
  if (envelope === null && outcome.data.queued === true) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const status = await bffFetch<ReportRunStatus | null>(
        `reporting/report-runs/${outcome.data.runId}`,
      );
      if (!status.ok || status.data === null) {
        continue; // transient poll miss — retry until the deadline
      }
      if (status.data.status === "SUCCEEDED") {
        const fetched = await bffFetch<ReportResultEnvelope | null>(
          `reporting/report-runs/${outcome.data.runId}/result`,
        );
        if (fetched.ok) {
          envelope = fetched.data;
        }
        break;
      }
      if (status.data.status === "FAILED") {
        onState({
          status: "error",
          data: null,
          failedAssertions: [],
          error: status.data.errorCode ?? "FAILED",
        });
        return;
      }
    }
  }
  if (envelope === null) {
    onState({
      status: "error",
      data: null,
      failedAssertions: [],
      error: d.errorsGeneric,
    });
    return;
  }
  onState({
    status: "ok",
    data: config.extract(envelope),
    failedAssertions: envelope.assertions
      .filter((assertion) => assertion.status === "FAIL")
      .map((assertion) => assertion.id),
    error: null,
  });
}

export function OwnerDashboard({
  locale,
  today,
  usage,
  canCrm,
}: {
  locale: Locale;
  /** Server-computed YYYY-MM-DD (pinned parameter for every binding). */
  today: string;
  usage: UsageSnapshotData | null;
  /** PHASE-019 (T50): the session holds crm.leads.manage — gates the CRM card. */
  canCrm: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const { readOnly } = useReadOnly();
  const subscription = usage?.subscription ?? null;

  const [sales, setSales] = useState<WidgetState>(LOADING_STATE);
  const [cash, setCash] = useState<WidgetState>(LOADING_STATE);
  const [arOverdue, setArOverdue] = useState<WidgetState>(LOADING_STATE);
  const [stock, setStock] = useState<WidgetState>(LOADING_STATE);

  // PHASE-019 (T50): the permission-gated CRM summary card — operational
  // counts (GET /crm/dashboard-summary), a card not a widget framework; a
  // failed fetch renders the honest unavailable note, never a fake number.
  const [crmSummary, setCrmSummary] = useState<{
    status: "loading" | "ok" | "error";
    data: CrmDashboardSummary | null;
  }>({ status: "loading", data: null });

  const configs: readonly WidgetConfig[] = [
    {
      id: "sales-today",
      titleKey: "dashboardSalesToday",
      reportKey: "sales.daily-revenue",
      params: { dateFrom: today, dateTo: today, locale },
      drillHref: `/${locale}/reports?report=${encodeURIComponent("sales.daily-revenue")}&dateFrom=${today}&dateTo=${today}`,
      extract: (envelope) => {
        const total = envelope.totals.find((entry) => entry.id === "netSales");
        const invoiceCount = sumInts(envelope.rows.map((row) => row.values.invoiceCount ?? null));
        return {
          kpi: total?.amount ?? "0.0000",
          secondary: formatMessage(d.dashboardInvoicesCount, { count: invoiceCount }),
          preview: null,
        };
      },
    },
    {
      id: "cash-position",
      titleKey: "dashboardCashPosition",
      reportKey: "treasury.daily-cash",
      params: { dateFrom: today, dateTo: today, locale },
      drillHref: `/${locale}/reports?report=${encodeURIComponent("treasury.daily-cash")}&dateFrom=${today}&dateTo=${today}`,
      extract: (envelope) => ({
        // Σ of the rows' `net` column — exact string addition (ADR-0009).
        kpi: envelope.rows.reduce((acc, row) => addExact(acc, cellOf(row, "net")), "0.0000"),
        secondary:
          envelope.rows.length > 0
            ? formatMessage(d.dashboardAccountsCount, { count: envelope.rows.length })
            : d.reportWorkspaceEmpty,
        preview: null,
      }),
    },
    {
      id: "ar-overdue",
      titleKey: "dashboardArOverdue",
      reportKey: "ar.aging",
      params: { asOf: today, locale },
      drillHref: `/${locale}/reports?report=${encodeURIComponent("ar.aging")}&asOf=${today}`,
      extract: (envelope) => ({
        // Σ over rows of (baseTotal − notDue) — exact string math.
        kpi: envelope.rows.reduce(
          (acc, row) => addExact(acc, subtractExact(cellOf(row, "baseTotal"), cellOf(row, "notDue"))),
          "0.0000",
        ),
        secondary:
          envelope.rows.length > 0
            ? formatMessage(d.dashboardCustomersCount, { count: envelope.rows.length })
            : d.reportWorkspaceEmpty,
        preview: null,
      }),
    },
    {
      id: "stock-alerts",
      titleKey: "dashboardStockAlerts",
      reportKey: "inventory.reorder-alerts",
      params: { locale },
      drillHref: `/${locale}/reports?report=${encodeURIComponent("inventory.reorder-alerts")}`,
      extract: (envelope) => ({
        kpi: String(envelope.rows.length),
        secondary: envelope.rows.length > 0 ? d.dashboardStockPreviewHeading : d.reportWorkspaceEmpty,
        preview: envelope.rows.slice(0, 5).map((row) => ({
          id: row.key,
          sku: String(row.values.itemSku ?? "—"),
          warehouse: String(row.values.warehouseCode ?? "—"),
          qty: String(row.values.qtyOnHand ?? "—"),
          reorder: String(row.values.reorderLevel ?? "—"),
        })),
      }),
    },
  ];

  // One run per binding on mount (configs are stable for the page visit —
  // today is a server-computed prop, locale never changes mid-page).
  useEffect(() => {
    const setters: ReadonlyArray<(state: WidgetState) => void> = [
      setSales,
      setCash,
      setArOverdue,
      setStock,
    ];
    configs.forEach((config, index) => {
      void runWidgetReport(d, config, setters[index] ?? setSales);
    });
  }, []);

  // PHASE-019 (T50): the CRM summary loads only when the session gate is on.
  useEffect(() => {
    if (!canCrm) {
      return;
    }
    setCrmSummary({ status: "loading", data: null });
    void (async () => {
      const result = await bffFetch<CrmDashboardSummary>("crm/dashboard-summary");
      setCrmSummary(
        result.ok
          ? { status: "ok", data: result.data }
          : { status: "error", data: null },
      );
    })();
  }, [canCrm]);

  const states: readonly WidgetState[] = [sales, cash, arOverdue, stock];
  const trialDays =
    subscription?.status === "TRIAL" && subscription.trialEndsAt !== null
      ? // Integer day arithmetic — |0 truncation per the rate-limiter
        // convention (day counts, never money; ADR-0009 targets money).
        (Math.max(0, new Date(subscription.trialEndsAt).getTime() - Date.now()) + 86_399_999) /
          86_400_000 |
        0
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-gray-600">{formatMessage(d.dashboardFreshness, { date: today })}</p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {configs.map((config, index) => {
          const state = states[index] ?? LOADING_STATE;
          return (
            <Link
              key={config.id}
              href={config.drillHref}
              aria-label={`${d[config.titleKey]} — ${d.dashboardDrillAria}`}
              className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-card p-4 shadow-e1 outline-none transition-colors duration-150 ease-standard hover:border-strong hover:bg-surface-sunken"
            >
              <h2 className="text-sm font-semibold text-gray-900">{d[config.titleKey]}</h2>
              {state.status === "loading" ? (
                <div aria-live="polite" className="flex flex-col gap-2">
                  <span className="sr-only">{d.loading}</span>
                  <span className="block h-8 w-3/4 animate-pulse rounded bg-gray-100" />
                  <span className="block h-4 w-1/2 animate-pulse rounded bg-gray-100" />
                </div>
              ) : state.status === "error" ? (
                <div className="flex flex-col gap-2">
                  <span className="inline-flex w-fit items-center rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-xs leading-4 text-danger-text">
                    {d.dashboardWidgetFailed}
                  </span>
                  <span dir="ltr" className="font-mono text-xs text-gray-500">
                    {state.error}
                  </span>
                </div>
              ) : (
                <>
                  <span dir="ltr" className="font-mono text-2xl tabular-nums text-gray-900">
                    {state.data?.kpi ?? "—"}
                  </span>
                  {state.data?.secondary != null && (
                    <span className="text-xs text-gray-600">{state.data.secondary}</span>
                  )}
                  {state.failedAssertions.length > 0 && (
                    <span className="inline-flex w-fit items-center rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-xs leading-4 text-danger-text">
                      {formatMessage(d.dashboardAssertionFailed, {
                        ids: state.failedAssertions.join(", "),
                      })}
                    </span>
                  )}
                  {state.data?.preview != null && state.data.preview.length > 0 && (
                    <ul className="flex flex-col gap-1" aria-label={d.dashboardStockPreviewHeading}>
                      {state.data.preview.map((row) => (
                        <li
                          key={row.id}
                          dir="ltr"
                          className="font-mono text-xs text-gray-600"
                        >
                          {row.sku} · {row.warehouse} — {row.qty} / {row.reorder}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Link>
          );
        })}
      </div>

      {/* PHASE-019 (T50): the permission-gated CRM summary card — a card,
          not a widget framework; the link opens the lead pipeline. */}
      {canCrm && (
        <section
          aria-labelledby="dashboard-crm-heading"
          className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-card p-4 shadow-e1"
        >
          <h2 id="dashboard-crm-heading" className="text-md font-semibold text-gray-900">
            {d.dashboardCrmTitle}
          </h2>
          {crmSummary.status === "loading" ? (
            <div aria-live="polite" className="flex flex-col gap-2">
              <span className="sr-only">{d.loading}</span>
              <span className="block h-4 w-3/4 animate-pulse rounded bg-gray-100" />
              <span className="block h-4 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          ) : crmSummary.status === "error" || crmSummary.data === null ? (
            <span className="text-xs text-gray-500">{d.dashboardUsageUnavailable}</span>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-gray-700">
              <li>
                {formatMessage(d.dashboardCrmPipeline, {
                  newCount: crmSummary.data.pipeline.NEW,
                  qualifiedCount: crmSummary.data.pipeline.QUALIFIED,
                })}
              </li>
              <li>
                {formatMessage(d.dashboardCrmFollowUps, {
                  dueToday: crmSummary.data.followUpsDueToday,
                  overdue: crmSummary.data.followUpsOverdue,
                })}
              </li>
              <li>
                {formatMessage(d.dashboardCrmExpiring, {
                  count: crmSummary.data.contractsExpiringIn30d,
                })}
              </li>
              <li>
                {formatMessage(d.dashboardCrmUpcoming, {
                  count: crmSummary.data.upcomingBillingEntries,
                })}
              </li>
            </ul>
          )}
          <Link
            href={`/${locale}/crm/pipeline`}
            className="inline-flex w-fit min-h-11 items-center rounded-md border border-default bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:border-strong hover:underline"
          >
            {d.dashboardCrmOpen}
          </Link>
        </section>
      )}

      {/* PHASE-021 (T2-b, DR-P21-06): the Offline Console quick action —
          the dashboard entry affordance (always offered; in a browser the
          console opens in its honest ONLINE-ONLY mode). */}
      <section
        aria-labelledby="dashboard-offline-heading"
        className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-card p-4 shadow-e1"
      >
        <h2 id="dashboard-offline-heading" className="text-md font-semibold text-gray-900">
          {d.offlineConsoleTitle}
        </h2>
        <p className="text-sm text-gray-600">{d.dashboardOfflineNote}</p>
        <Link
          href={`/${locale}/offline`}
          className="inline-flex w-fit min-h-11 items-center rounded-md border border-default bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:border-strong hover:underline"
        >
          {d.unlockGoOffline}
        </Link>
      </section>

      {usage === null && <p className="text-xs text-gray-500">{d.dashboardUsageUnavailable}</p>}

      {usage !== null && (
        <section aria-labelledby="dashboard-usage-heading" className="flex flex-col gap-3">
          <h2 id="dashboard-usage-heading" className="text-md font-semibold text-gray-900">
            {d.dashboardUsageHeading}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {usage.counters.map((counter) => (
              <li
                key={counter.key}
                className="inline-flex items-center gap-2 rounded-md border border-subtle bg-surface-card px-3 py-1.5 text-sm"
              >
                <span className="text-gray-700">{counter.label[locale]}</span>
                <span dir="ltr" className="font-mono tabular-nums text-gray-900">
                  {counter.usage} / {counter.limit === "unlimited" ? "∞" : counter.limit}
                </span>
                {counter.warn100 ? (
                  <span className="rounded-sm bg-danger-bg px-1.5 py-0.5 text-xs text-danger-text">
                    {d.billingWarn100}
                  </span>
                ) : counter.warn80 ? (
                  <span className="rounded-sm bg-warning-bg px-1.5 py-0.5 text-xs text-warning-text">
                    {d.billingWarn80}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {subscription !== null && subscription.status === "TRIAL" && (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-info-border bg-info-bg px-3 py-2 text-sm text-info-text"
        >
          <span>
            {formatMessage(d.dashboardTrialBanner, { days: trialDays })}
            {subscription.trialEndsAt !== null
              ? ` — ${formatDateTime(subscription.trialEndsAt, locale)}`
              : ""}
          </span>
          <a
            href={`/${locale}/billing`}
            className="inline-flex min-h-11 items-center rounded-md border border-info-border bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:underline"
          >
            {d.dashboardGoBilling}
          </a>
        </p>
      )}

      {subscription !== null && subscription.status === "PAST_DUE" && (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
        >
          <span>
            {d.dashboardPastDueBanner} — {localizedStatus(d, subscription.status)}
          </span>
          <a
            href={`/${locale}/billing`}
            className="inline-flex min-h-11 items-center rounded-md border border-warning-border bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:underline"
          >
            {d.readOnlyPayNow}
          </a>
        </p>
      )}

      {readOnly && <p className="text-xs text-gray-500">{d.dashboardGraceNote}</p>}
    </div>
  );
}
