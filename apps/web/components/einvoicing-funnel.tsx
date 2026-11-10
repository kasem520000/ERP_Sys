"use client";
/**
 * PHASE-023 T10 — the e-invoicing funnel panels (MONITORING §1 PHASE-023):
 * submissions by state, latency p50/p95, rejection reasons by code, the
 * dead-letter count, and the 15-minute rejection rate (the
 * EInvoiceRejectSpike gauge). Server-fetched; read-only.
 */
import type { JSX } from "react";

import type { Dictionary, Locale } from "../i18n/dictionaries";
import type { EInvoicingFunnelWire } from "../lib/api-types";

const STATE_ORDER = [
  "PENDING",
  "GENERATED",
  "SIGNED",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "REPORTED",
  "FAILED",
] as const;

const STATE_KEY: Record<(typeof STATE_ORDER)[number], keyof Dictionary> = {
  PENDING: "einvoicingStatusPending",
  GENERATED: "einvoicingStatusGenerated",
  SIGNED: "einvoicingStatusSigned",
  SUBMITTED: "einvoicingStatusSubmitted",
  ACCEPTED: "einvoicingStatusAccepted",
  REJECTED: "einvoicingStatusRejected",
  REPORTED: "einvoicingStatusReported",
  FAILED: "einvoicingStatusFailed",
};

function formatMs(value: number | null): string {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function EInvoicingFunnel({
  locale,
  d,
  funnel,
}: {
  locale: Locale;
  d: Dictionary;
  funnel: EInvoicingFunnelWire;
}): JSX.Element {
  const dir = locale === "ar" ? "rtl" : "ltr";
  const total = STATE_ORDER.reduce((sum, state) => sum + (funnel.byStatus[state] ?? 0), 0);
  const maxByState = Math.max(1, ...STATE_ORDER.map((state) => funnel.byStatus[state] ?? 0));

  return (
    <div dir={dir} className="space-y-6">
      {total === 0 && funnel.deadLetter === 0 ? (
        <p className="text-sm text-slate-500">{d.einvoicingFunnelNoData}</p>
      ) : null}

      <section aria-labelledby="funnel-states" className="rounded-lg border p-4">
        <h2 id="funnel-states" className="mb-3 text-base font-semibold">
          {d.einvoicingFunnelByState}
        </h2>
        <ul className="space-y-2">
          {STATE_ORDER.map((state) => {
            const count = funnel.byStatus[state] ?? 0;
            return (
              <li key={state} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0">{d[STATE_KEY[state]] as string}</span>
                <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100">
                  <div
                    className={
                      state === "ACCEPTED" || state === "REPORTED"
                        ? "h-full bg-emerald-400"
                        : state === "REJECTED" || state === "FAILED"
                          ? "h-full bg-red-400"
                          : "h-full bg-amber-400"
                    }
                    style={{
                      width: `${maxByState === 0 ? 0 : (count / maxByState) * 100}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-end tabular-nums">{count}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        <section className="rounded-lg border p-4">
          <h3 className="text-sm font-medium text-slate-600">{d.einvoicingFunnelLatency}</h3>
          <p className="mt-2 text-lg font-semibold tabular-nums">
            p50 {formatMs(funnel.latencyMs.p50)}
          </p>
          <p className="text-sm text-slate-500 tabular-nums">p95 {formatMs(funnel.latencyMs.p95)}</p>
        </section>
        <section className="rounded-lg border p-4">
          <h3 className="text-sm font-medium text-slate-600">{d.einvoicingFunnelDeadLetter}</h3>
          <p
            className={`mt-2 text-lg font-semibold tabular-nums ${funnel.deadLetter > 0 ? "text-red-700" : ""}`}
          >
            {funnel.deadLetter}
          </p>
        </section>
        <section className="rounded-lg border p-4">
          <h3 className="text-sm font-medium text-slate-600">{d.einvoicingFunnelRejectRate}</h3>
          <p
            className={`mt-2 text-lg font-semibold tabular-nums ${
              (funnel.rejectionWindow.ratePct ?? 0) > 5 ? "text-red-700" : ""
            }`}
          >
            {funnel.rejectionWindow.ratePct === null ? "—" : `${funnel.rejectionWindow.ratePct}%`}
          </p>
          <p className="text-sm text-slate-500 tabular-nums">
            {funnel.rejectionWindow.rejected}/{funnel.rejectionWindow.total}
          </p>
        </section>
      </div>

      <section aria-labelledby="funnel-reasons" className="rounded-lg border p-4">
        <h2 id="funnel-reasons" className="mb-3 text-base font-semibold">
          {d.einvoicingFunnelRejectionReasons}
        </h2>
        {funnel.rejectionReasons.length === 0 ? (
          <p className="text-sm text-slate-500">{d.einvoicingFunnelNoData}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {funnel.rejectionReasons.map((reason) => (
              <li key={reason.code} className="flex items-center justify-between">
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{reason.code}</code>
                <span className="tabular-nums">{reason.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
