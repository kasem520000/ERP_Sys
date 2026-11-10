"use client";

/**
 * PHASE-027 (wave F) — the PDC maturity calendar workspace (§1 dashboard
 * variant, BR-045): the two-sided bucket fold (received vs issued ×
 * overdue/this-week/30/60/90/beyond) over the LIVE note set, the staleness
 * labeling (NEVER STALE-SILENT — snapshot.stale renders the warning chip +
 * computedAt + the staleAfterHours hint), and the partner/bank/live-note
 * drill lists. Every bucket card drills to the register pre-filtered by
 * maturity range (/notes?maturityFrom=&maturityTo= — the API's own filter
 * vocabulary); bank rows carry no drill (the notes list route exposes no
 * bank filter — never a fabricated param). Pure presentational — the
 * snapshot arrives server-fetched; no posting can originate from here.
 *
 * "use client" (the client-ui bridge rule): this renders money through
 * formatMoneyDisplay, a VALUE import of the @erp/ui barrel — server
 * components must not value-import the barrel (createContext in
 * utils/direction breaks the Turbopack RSC graph), so money rendering lives
 * on the client side exactly like every other formatMoneyDisplay consumer.
 */
import type { JSX } from "react";

import { formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PdcCalendarSnapshot, PdcDirectionBuckets } from "../lib/api-types";
import { cx } from "../lib/cx";
import { formatMessage, localizedNoteDirection, localizedNoteStatus } from "../lib/messages";
import { Card } from "./card";

/** Integral day shift on an ISO date (UTC string math, no locale). */
function shiftIsoDate(iso: string, days: number): string {
  const ms = new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function PdcCalendar({ locale, snapshot }: { locale: Locale; snapshot: PdcCalendarSnapshot }): JSX.Element {
  const d = getDictionary(locale);
  const asOf = snapshot.asOf;

  /** Bucket → register drill range (the BR-045 day windows from asOf). */
  const bucketRange = (bucket: keyof PdcDirectionBuckets): { from: string; to: string } => {
    switch (bucket) {
      case "overdue":
        return { from: "1900-01-01", to: shiftIsoDate(asOf, -1) };
      case "thisWeek":
        return { from: asOf, to: shiftIsoDate(asOf, 6) };
      case "d30":
        return { from: shiftIsoDate(asOf, 7), to: shiftIsoDate(asOf, 29) };
      case "d60":
        return { from: shiftIsoDate(asOf, 30), to: shiftIsoDate(asOf, 59) };
      case "d90":
        return { from: shiftIsoDate(asOf, 60), to: shiftIsoDate(asOf, 89) };
      default:
        return { from: shiftIsoDate(asOf, 90), to: "9999-12-31" };
    }
  };

  const buckets: { key: keyof PdcDirectionBuckets; label: string; overdue: boolean }[] = [
    { key: "overdue", label: d.pdcBucketOverdue, overdue: true },
    { key: "thisWeek", label: d.pdcBucketThisWeek, overdue: false },
    { key: "d30", label: d.pdcBucket30, overdue: false },
    { key: "d60", label: d.pdcBucket60, overdue: false },
    { key: "d90", label: d.pdcBucket90, overdue: false },
    { key: "beyond", label: d.pdcBucketBeyond, overdue: false },
  ];

  const registerHref = (params: Record<string, string>): string => {
    const search = new URLSearchParams(params);
    return `/${locale}/notes?${search.toString()}`;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-600">
          {d.pdcAsOfLabel}: <span className="font-mono" dir="ltr">{asOf}</span>
        </span>
        <span className="text-sm text-gray-600">
          {d.pdcComputedAtLabel}: <span className="font-mono" dir="ltr">{snapshot.computedAt}</span>
        </span>
        {snapshot.stale && (
          <span
            role="status"
            className="inline-flex items-center gap-1 rounded-sm border border-warning-border bg-warning-bg px-2 py-1 text-xs font-medium text-warning-text"
          >
            {d.pdcStaleWarning}
          </span>
        )}
      </div>
      {snapshot.stale && (
        <p className="text-xs text-warning-text">
          {formatMessage(d.pdcStaleHint, { hours: snapshot.staleAfterHours })}
        </p>
      )}

      <Card title={d.notesCalendarTitle}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-3xl text-sm">
            <caption className="sr-only">{d.notesCalendarTitle}</caption>
            <thead>
              <tr className="border-b border-subtle">
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.notesFilterMaturityRange}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.pdcReceivedSide}
                </th>
                <th scope="col" className="px-2 py-2 text-start font-medium">
                  {d.pdcIssuedSide}
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => {
                const range = bucketRange(bucket.key);
                const received = snapshot.buckets.received[bucket.key];
                const issued = snapshot.buckets.issued[bucket.key];
                return (
                  <tr key={bucket.key} className="border-b border-subtle">
                    <th
                      scope="row"
                      className={cx("px-2 py-2 text-start font-medium", bucket.overdue && "text-danger-text")}
                    >
                      {bucket.label}
                    </th>
                    {[received, issued].map((cell, index) => (
                      <td key={index} className="px-2 py-2">
                        <a
                          href={registerHref({ maturityFrom: range.from, maturityTo: range.to })}
                          className={cx(
                            "flex flex-col rounded-md border px-3 py-2 hover:border-strong",
                            bucket.overdue && cell.count > 0
                              ? "border-danger-border bg-danger-bg"
                              : "border-default bg-surface-card",
                          )}
                        >
                          <span>
                            {d.pdcCountLabel}:{" "}
                            <span className="font-mono tabular-nums" dir="ltr">
                              {cell.count}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums" dir="ltr">
                            {formatMoneyDisplay(cell.amountBase, 2)}
                          </span>
                        </a>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card title={d.pdcByPartnerTitle}>
          {snapshot.drill.byPartner.length === 0 ? (
            <p className="text-sm text-gray-600">{d.pdcEmpty}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFilterPartner}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.pdcCountLabel}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.pdcAmountBaseLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.drill.byPartner.slice(0, 10).map((row) => (
                  <tr key={row.partnerId} className="border-b border-subtle">
                    <td className="px-2 py-2">
                      <a
                        href={registerHref({ partnerId: row.partnerId })}
                        className="text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                      >
                        {row.partnerName ?? row.partnerId}
                      </a>
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {row.count}
                    </td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(row.amountBase, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title={d.pdcByBankTitle}>
          {snapshot.drill.byBank.length === 0 ? (
            <p className="text-sm text-gray-600">{d.pdcEmpty}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFormBank}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.pdcCountLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.drill.byBank.slice(0, 10).map((row) => (
                  <tr key={row.bank ?? "(unspecified)"} className="border-b border-subtle">
                    <td className="px-2 py-2">{row.bank ?? d.pdcBankUnspecified}</td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {row.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title={d.pdcNotesTitle}>
        {snapshot.drill.notes.length === 0 ? (
          <p className="text-sm text-gray-600">{d.pdcEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFormNumber}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFilterDirection}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFilterPartner}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFormBank}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.instColAmount}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.notesFormMaturityDate}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.colStatus}
                  </th>
                </tr>
              </thead>
              <tbody>
                {snapshot.drill.notes.slice(0, 50).map((row) => (
                  <tr key={row.id} className="border-b border-subtle">
                    <td className="px-2 py-2">
                      <a
                        href={`/${locale}/notes/${row.id}`}
                        className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                      >
                        {row.number ?? row.id.slice(0, 8)}
                      </a>
                    </td>
                    <td className="px-2 py-2">{localizedNoteDirection(d, row.direction)}</td>
                    <td className="px-2 py-2">{row.partnerName ?? row.partnerId}</td>
                    <td className="px-2 py-2">{row.issuingBank ?? d.pdcBankUnspecified}</td>
                    <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(row.amount, 2)}{" "}
                      <span className="text-xs text-gray-500">{row.currency}</span>
                    </td>
                    <td className="px-2 py-2 font-mono text-sm" dir="ltr">
                      {row.maturityDate}
                    </td>
                    <td className="px-2 py-2">{localizedNoteStatus(d, row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
