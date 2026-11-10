/**
 * PHASE-025 T9d — the SLO/error-budget dashboard panels (server-renderable,
 * no client state; the sync-health-panels pattern): the six finalized SLO
 * cards (target, observed, budget bar, burn state), the per-SLO detail
 * tables (route groups, report tiers), the SLOBurn alert list, and the
 * data-source note. Data comes from GET /api/v1/platform/slo through the
 * BFF session fetch; the wire type is hand-written (ADR-0003).
 */
import type { JSX } from "react";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import { formatDateTime, formatMessage } from "../lib/messages";

/** Hand-written wire type (ADR-0003): GET /api/v1/platform/slo (envelope
 * payload — the API-side SloSnapshot mirrored client-side). */
export interface SloSnapshotWire {
  generatedAt: string;
  substrate: string;
  window: { kind: string; startedAt: string };
  slos: {
    id:
      | "api_availability"
      | "api_latency"
      | "posting_success"
      | "backup_restore_smoke"
      | "sync_push_success"
      | "report_render_sla";
    title: string;
    target: string;
    observed: string | null;
    budgetRemaining: number | null;
    burnRate: number | null;
    state: "OK" | "BURNING_2X" | "BURNING_4X" | "NO_DATA";
    detail: {
      kind: string;
      totalRequests?: number;
      errors5xx?: number;
      groups?: {
        group: string;
        requests: number;
        overBudget: number;
        overBudgetFraction: number;
        budgetMs: number;
        stats: { n: number; p50: number; p95: number; p99: number; max: number };
        state: string;
      }[];
      attempts?: number;
      successes?: number;
      failuresByCode?: { code: string; value: number }[];
      invariantFailures?: number;
      latency?: { n: number; p50: number; p95: number; p99: number; max: number };
      noDataReason?: string | null;
      deferred?: number;
      classes?: {
        executionClass: string;
        attempts: number;
        successes: number;
        overBudget: number;
        withinBudgetFraction: number;
        budgetMs: number;
        state: string;
      }[];
      templates?: { template: string; stats: { n: number; p95: number } }[];
    };
  }[];
  burnAlerts: {
    name: string;
    severity: "sev-1" | "sev-2";
    slo: string;
    message: string;
    runbook: string;
    burnRate: number | null;
  }[];
}

const STATE_STYLES: Record<string, string> = {
  OK: "border-success-border bg-success-bg text-success-text",
  BURNING_2X: "border-warning-border bg-warning-bg text-warning-text",
  BURNING_4X: "border-danger-border bg-danger-bg text-danger-text",
  NO_DATA: "border-subtle bg-surface-sunken text-muted-foreground",
};

const CARD_TITLES: Record<SloSnapshotWire["slos"][number]["id"], keyof Dictionary> = {
  api_availability: "sloCardApiAvailability",
  api_latency: "sloCardApiLatency",
  posting_success: "sloCardPosting",
  backup_restore_smoke: "sloCardBackup",
  sync_push_success: "sloCardSync",
  report_render_sla: "sloCardReport",
};

const GROUP_LABELS: Record<string, keyof Dictionary> = {
  identity: "sloRouteGroupIdentity",
  accounting: "sloRouteGroupAccounting",
  sales: "sloRouteGroupSales",
  purchasing: "sloRouteGroupPurchasing",
  treasury: "sloRouteGroupTreasury",
  inventory: "sloRouteGroupInventory",
  sync: "sloRouteGroupSync",
  platform: "sloRouteGroupPlatform",
};

function stateLabel(d: Dictionary, state: string): string {
  if (state === "BURNING_2X") return d.sloStateBurning2x;
  if (state === "BURNING_4X") return d.sloStateBurning4x;
  if (state === "NO_DATA") return d.sloStateNoData;
  return d.sloStateOk;
}

/** The error-budget bar (clamped 0–100% for the visual; the numbers stay honest). */
function budgetBar(
  d: Dictionary,
  remaining: number | null,
): JSX.Element {
  if (remaining === null) {
    return <p className="mt-2 text-xs text-muted-foreground">{d.sloNoDataNote}</p>;
  }
  const percent = remaining <= 0 ? 0 : remaining >= 1 ? 100 : remaining * 100;
  const barColor =
    remaining <= 0 ? "bg-danger-700" : percent < 25 ? "bg-warning-700" : "bg-success-700";
  return (
    <div
      className="mt-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Number(percent.toFixed(0))}
      aria-label={`${d.sloBudgetLabel}: ${percent.toFixed(0)}%`}
    >
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground" dir="ltr">
        <span>
          {d.sloBudgetLabel}: {remaining <= 0 ? "0" : percent.toFixed(0)}%
        </span>
        <span aria-hidden="true">{remaining < 0 ? d.sloBudgetExhausted : ""}</span>
      </div>
    </div>
  );
}

function sloCard(d: Dictionary, slo: SloSnapshotWire["slos"][number]): JSX.Element {
  const burnText =
    slo.burnRate === null
      ? d.sloNoDataNote
      : `${slo.burnRate >= 999 ? "≥ 999" : slo.burnRate.toFixed(1)}×`;
  return (
    <section className="flex flex-col rounded-md border border-subtle bg-surface-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">{d[CARD_TITLES[slo.id]]}</h3>
        <span
          className={`inline-flex w-fit shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${STATE_STYLES[slo.state] ?? STATE_STYLES.NO_DATA}`}
        >
          {stateLabel(d, slo.state)}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{slo.target}</p>
      <p lang="en" dir="ltr" className="mt-2 grow text-xs text-gray-700">
        {slo.observed ?? d.sloNoDataNote}
      </p>
      {budgetBar(d, slo.budgetRemaining)}
      <p className="mt-2 text-xs text-muted-foreground">
        {d.sloBurnLabel}: <span dir="ltr">{burnText}</span>
      </p>
    </section>
  );
}

function latencyTable(d: Dictionary, groups: NonNullable<SloSnapshotWire["slos"][number]["detail"]["groups"]>): JSX.Element {
  return (
    <section className="rounded-md border border-subtle bg-surface-card p-4">
      <h2 className="text-sm font-semibold text-gray-900">{d.sloCardApiLatency}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle text-muted-foreground">
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloLatencyColGroup}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloLatencyColP50}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloLatencyColP95}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloLatencyColP99}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloLatencyColBudget}</th>
              <th scope="col" className="py-2 text-start font-medium">{d.sloLatencyColOverBudget}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((row) => (
              <tr key={row.group} className="border-b border-subtle last:border-0">
                <th scope="row" className="py-2 pe-4 text-start font-normal">
                  {d[GROUP_LABELS[row.group] ?? "sloRouteGroupPlatform"]}
                </th>
                <td className="py-2 pe-4 font-mono text-xs" dir="ltr">{row.stats.n === 0 ? "—" : `${row.stats.p50} ms`}</td>
                <td className="py-2 pe-4 font-mono text-xs" dir="ltr">{row.stats.n === 0 ? "—" : `${row.stats.p95} ms`}</td>
                <td className="py-2 pe-4 font-mono text-xs" dir="ltr">{row.stats.n === 0 ? "—" : `${row.stats.p99} ms`}</td>
                <td className="py-2 pe-4 font-mono text-xs" dir="ltr">{row.budgetMs} ms</td>
                <td className="py-2 font-mono text-xs" dir="ltr">
                  {row.requests === 0 ? "—" : `${(row.overBudgetFraction * 100).toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function reportTable(
  d: Dictionary,
  classes: NonNullable<SloSnapshotWire["slos"][number]["detail"]["classes"]>,
  templates: NonNullable<SloSnapshotWire["slos"][number]["detail"]["templates"]>,
): JSX.Element {
  const topTemplates = templates.slice(0, 8);
  return (
    <section className="rounded-md border border-subtle bg-surface-card p-4">
      <h2 className="text-sm font-semibold text-gray-900">{d.sloCardReport}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle text-muted-foreground">
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloReportColClass}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloReportColRenders}</th>
              <th scope="col" className="py-2 pe-4 text-start font-medium">{d.sloReportColBudget}</th>
              <th scope="col" className="py-2 text-start font-medium">{d.sloReportColOverBudget}</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((row) => (
              <tr key={row.executionClass} className="border-b border-subtle last:border-0">
                <th scope="row" className="py-2 pe-4 text-start font-normal">
                  {row.executionClass === "job" ? d.sloReportClassJob : d.sloReportClassInline}
                </th>
                <td className="py-2 pe-4 font-mono text-xs" dir="ltr">
                  {row.attempts} ({row.successes} ✓)
                </td>
                <td className="py-2 pe-4 font-mono text-xs" dir="ltr">{row.budgetMs} ms</td>
                <td className="py-2 font-mono text-xs" dir="ltr">
                  {row.attempts === 0
                    ? "—"
                    : `${((1 - row.withinBudgetFraction) * 100).toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {topTemplates.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold text-gray-900">{d.sloReportTemplatesTitle}</h3>
          <ul className="mt-2 flex flex-col gap-1">
            {topTemplates.map((row) => (
              <li key={row.template} className="flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-mono text-gray-700" dir="ltr">{row.template}</span>
                <span className="shrink-0 font-mono text-muted-foreground" dir="ltr">p95 {row.stats.p95} ms</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function alertMessageOf(
  d: Dictionary,
  alert: SloSnapshotWire["burnAlerts"][number],
  sloTitle: string,
): string {
  if (alert.name === "PostingInvariantFail") {
    const count = /(\d+) time/.exec(alert.message)?.[1] ?? "1";
    return formatMessage(d.sloAlertPostingInvariant, { count });
  }
  const burn = alert.burnRate === null ? "—" : alert.burnRate >= 999 ? "999" : alert.burnRate.toFixed(1);
  return formatMessage(d.sloAlertSloBurn, { slo: sloTitle, burn });
}

export function SloPanels({ locale, snapshot }: { locale: Locale; snapshot: SloSnapshotWire }): JSX.Element {
  const d = getDictionary(locale);
  const titleById = new Map(snapshot.slos.map((slo) => [slo.id, slo.title] as const));
  const latency = snapshot.slos.find((slo) => slo.id === "api_latency");
  const report = snapshot.slos.find((slo) => slo.id === "report_render_sla");
  const backup = snapshot.slos.find((slo) => slo.id === "backup_restore_smoke");
  const posting = snapshot.slos.find((slo) => slo.id === "posting_success");
  const sync = snapshot.slos.find((slo) => slo.id === "sync_push_success");
  const availability = snapshot.slos.find((slo) => slo.id === "api_availability");

  return (
    <div className="flex flex-col gap-4">
      {/* The six SLO cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {snapshot.slos.map((slo) => (
          <div key={slo.id}>{sloCard(d, slo)}</div>
        ))}
      </div>

      {/* Per-plane summary (the golden-signal counts behind the cards) */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.sloSummaryTitle}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-md border border-subtle p-3">
            <dt className="text-xs text-muted-foreground">{d.sloAvailabilityRequests}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
              {availability?.detail.totalRequests ?? 0}
            </dd>
          </div>
          <div className="rounded-md border border-subtle p-3">
            <dt className="text-xs text-muted-foreground">{d.sloAvailabilityErrors}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
              {availability?.detail.errors5xx ?? 0}
            </dd>
          </div>
          <div className="rounded-md border border-subtle p-3">
            <dt className="text-xs text-muted-foreground">{d.sloPostingAttempts}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
              {posting?.detail.attempts ?? 0}
            </dd>
          </div>
          <div className="rounded-md border border-subtle p-3">
            <dt className="text-xs text-muted-foreground">{d.sloPostingInvariantFailures}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
              {posting?.detail.invariantFailures ?? 0}
            </dd>
          </div>
          <div className="rounded-md border border-subtle p-3">
            <dt className="text-xs text-muted-foreground">{d.sloSyncDeferred}</dt>
            <dd className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
              {sync?.detail.deferred ?? 0}
            </dd>
          </div>
        </dl>
      </section>

      {/* Route-group latency (the golden-signals panel) */}
      {latency !== undefined && latency.detail.groups !== undefined && (
        <div className="flex flex-col gap-4">{latencyTable(d, latency.detail.groups)}</div>
      )}

      {/* Report render tiers (per class + top templates) */}
      {report !== undefined && report.detail.classes !== undefined && (
        <div className="flex flex-col gap-4">
          {reportTable(d, report.detail.classes, report.detail.templates ?? [])}
        </div>
      )}

      {/* Backup cadence note (the honest NO_DATA leg) */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.sloBackupNoteTitle}</h2>
        <p lang={locale} className="mt-2 text-sm text-gray-700">
          {backup !== undefined && backup.detail.noDataReason != null
            ? d.sloBackupExternalCadence
            : d.sloBackupNoFailuresNote}
        </p>
      </section>

      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.sloBurnAlertsTitle}</h2>
        {snapshot.burnAlerts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{d.sloBurnAlertsEmpty}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {snapshot.burnAlerts.map((alert) => (
              <li
                key={`${alert.name}-${alert.slo}`}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span
                  className={
                    alert.severity === "sev-1"
                      ? "inline-flex w-fit items-center rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-xs leading-4 text-danger-text"
                      : "inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text"
                  }
                >
                  {alert.severity === "sev-1" ? d.sloAlertSev1 : d.sloAlertSev2}
                </span>
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                  {alert.name}
                </span>
                <span lang={locale} className="text-gray-800">
                  {alertMessageOf(d, alert, titleById.get(alert.slo as SloSnapshotWire["slos"][number]["id"]) ?? alert.slo)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Data source + window note */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.sloDataSourceTitle}</h2>
        <p lang={locale} className="mt-2 text-sm text-gray-700">
          {d.sloDataSourceNote}
        </p>
        <p lang={locale} className="mt-1 text-sm text-gray-700">
          {d.sloWindowNote}
        </p>
        <p className="mt-3 text-xs text-muted-foreground" dir="ltr">
          {d.sloGeneratedAt} {formatDateTime(snapshot.generatedAt, locale)}
        </p>
      </section>
    </div>
  );
}
