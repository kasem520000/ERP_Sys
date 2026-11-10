/**
 * PHASE-020 T14 — the sync health dashboard panels (server-renderable,
 * no client state): push stats cards, pull cursor lag per entity, the
 * conflict + rejection breakdowns (styled div bars — no chart library),
 * the outbox lag gauge, revoked pending ops, and the derived alerts.
 * Data comes from GET /api/v1/sync/admin/health through the BFF session
 * fetch; the wire type is hand-written (ADR-0003).
 */
import type { JSX } from "react";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import { formatDateTime, formatMessage } from "../lib/messages";

/** Hand-written wire type (ADR-0003): GET /api/v1/sync/admin/health. */
export interface SyncHealthReportWire {
  tenantId: string;
  generatedAt: string;
  windowDays: number;
  push: {
    total: number;
    accepted: number;
    rejected: number;
    deferred: number;
    successRate: number;
    p95LatencyMs: number | null;
  };
  pullLagByEntity: { entityType: string; maxLagMs: number | null; devices: number }[];
  conflictsByType: { key: string; count: number }[];
  rejectionsByReason: { key: string; count: number }[];
  outboxLagGauge: { bucket: string; devices: number }[];
  revokedPendingOps: { devices: number; pendingCommands: number; ownedDrafts: number };
  tombstones: number;
  alerts: {
    severity: "warning" | "critical";
    code: string;
    message: string;
    details?: Record<string, string | number>;
  }[];
}

/** Human lag rendering (minutes/hours/days, one decimal above an hour). */
function formatLag(ms: number, d: Dictionary): string {
  const minutes = ms / 60000;
  if (minutes < 60) {
    return `${Number(minutes.toFixed(0))} ${d.syncHealthLagMinutes}`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    return `${Number(hours.toFixed(1))} ${d.syncHealthLagHours}`;
  }
  return `${Number((hours / 24).toFixed(1))} ${d.syncHealthLagDays}`;
}

function statCard(label: string, value: string, hint?: string): JSX.Element {
  return (
    <div className="rounded-md border border-subtle bg-surface-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
        {value}
      </div>
      {hint !== undefined && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function breakdownBars(
  title: string,
  emptyLabel: string,
  rows: { key: string; count: number }[],
): JSX.Element {
  const max = rows.reduce((acc, row) => (row.count > acc ? row.count : acc), 0);
  return (
    <section className="rounded-md border border-subtle bg-surface-card p-4">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3">
              <span className="w-48 shrink-0 truncate font-mono text-xs text-gray-700" dir="ltr">
                {row.key}
              </span>
              <span className="h-2.5 min-w-0 grow overflow-hidden rounded-full bg-gray-100">
                <span
                  className="block h-full rounded-full bg-primary-600"
                  style={{ width: `${max === 0 ? 0 : (row.count / max) * 100}%` }}
                />
              </span>
              <span className="w-10 shrink-0 text-end font-mono text-xs text-gray-700" dir="ltr">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function alertMessage(d: Dictionary, alert: SyncHealthReportWire["alerts"][number]): string {
  if (alert.code === "SyncCursorStall" && alert.details !== undefined) {
    return formatMessage(d.syncHealthAlertSyncCursorStall, alert.details);
  }
  if (alert.code === "SyncPushFailSpike" && alert.details !== undefined) {
    return formatMessage(d.syncHealthAlertSyncPushFailSpike, alert.details);
  }
  return alert.message;
}

export function SyncHealthPanels({
  locale,
  report,
}: {
  locale: Locale;
  report: SyncHealthReportWire;
}): JSX.Element {
  const d = getDictionary(locale);
  const bucketLabels: Record<string, string> = {
    never: d.syncHealthOutboxNever,
    lt1h: d.syncHealthOutboxLt1h,
    lt6h: d.syncHealthOutboxLt6h,
    lt24h: d.syncHealthOutboxLt24h,
    lt7d: d.syncHealthOutboxLt7d,
    gt7d: d.syncHealthOutboxGt7d,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Push stats */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.syncHealthPushTitle}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {statCard(d.syncHealthPushTotal, String(report.push.total))}
          {statCard(d.syncHealthPushAccepted, String(report.push.accepted))}
          {statCard(d.syncHealthPushRejected, String(report.push.rejected))}
          {statCard(d.syncHealthPushDeferred, String(report.push.deferred))}
          {statCard(d.syncHealthPushSuccessRate, `${report.push.successRate}%`)}
          {statCard(
            d.syncHealthPushP95,
            report.push.p95LatencyMs === null ? d.syncHealthPushP95None : `${report.push.p95LatencyMs} ms`,
          )}
        </div>
      </section>

      {/* Pull cursor lag per entity */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.syncHealthPullLagTitle}</h2>
        {report.pullLagByEntity.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{d.syncHealthPullLagEmpty}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle text-muted-foreground">
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    {d.syncHealthPullLagEntity}
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    {d.syncHealthPullLagMaxLag}
                  </th>
                  <th scope="col" className="py-2 text-start font-medium">
                    {d.syncHealthPullLagDevices}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.pullLagByEntity.map((row) => (
                  <tr key={row.entityType} className="border-b border-subtle last:border-0">
                    <td className="py-2 pe-4 font-mono text-xs" dir="ltr">
                      {row.entityType}
                    </td>
                    <td className="py-2 pe-4" dir="ltr">
                      {row.maxLagMs === null ? d.syncHealthPullLagNeverAck : formatLag(row.maxLagMs, d)}
                    </td>
                    <td className="py-2" dir="ltr">
                      {row.devices}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Conflict + rejection breakdowns */}
      {breakdownBars(d.syncHealthConflictsTitle, d.syncHealthBreakdownEmpty, report.conflictsByType)}
      {breakdownBars(d.syncHealthRejectionsTitle, d.syncHealthBreakdownEmpty, report.rejectionsByReason)}

      {/* Outbox lag gauge */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.syncHealthOutboxTitle}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {report.outboxLagGauge.map((bucket) => (
            <div key={bucket.bucket} className="rounded-md border border-subtle p-3">
              <div className="text-xs text-muted-foreground">{bucketLabels[bucket.bucket] ?? bucket.bucket}</div>
              <div className="mt-1 text-lg font-semibold text-gray-900" dir="ltr">
                {bucket.devices} <span className="text-xs font-normal">{d.syncHealthOutboxDevices}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Revoked pending ops + tombstones */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.syncHealthRevokedTitle}</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statCard(d.syncHealthRevokedDevices, String(report.revokedPendingOps.devices))}
          {statCard(d.syncHealthRevokedPending, String(report.revokedPendingOps.pendingCommands))}
          {statCard(d.syncHealthRevokedDrafts, String(report.revokedPendingOps.ownedDrafts))}
          {statCard(d.syncHealthTombstones, String(report.tombstones))}
        </div>
      </section>

      {/* Alerts */}
      <section className="rounded-md border border-subtle bg-surface-card p-4">
        <h2 className="text-sm font-semibold text-gray-900">{d.syncHealthAlertsTitle}</h2>
        {report.alerts.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{d.syncHealthAlertsEmpty}</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {report.alerts.map((alert) => (
              <li
                key={`${alert.code}-${alert.message}`}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span
                  className={
                    alert.severity === "critical"
                      ? "inline-flex w-fit items-center rounded-sm border border-danger-border bg-danger-bg px-1.5 py-0.5 text-xs leading-4 text-danger-text"
                      : "inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text"
                  }
                >
                  {alert.severity === "critical" ? "Sev-2" : "Sev-3"}
                </span>
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                  {alert.code}
                </span>
                <span lang={locale} className="text-gray-800">
                  {alertMessage(d, alert)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground" dir="ltr">
          {d.syncHealthGeneratedAt} {formatDateTime(report.generatedAt, locale)}
        </p>
      </section>
    </div>
  );
}
