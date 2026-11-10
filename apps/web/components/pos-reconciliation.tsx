"use client";

/**
 * PHASE-016 T12+T10 — shift-end reconciliation: the Z report for a branch +
 * date (totals, by order type / tender / terminal / hour bars, the OFF- ⇄
 * official pairs) with print, the open-checks reminder, and the offline
 * outbox triage — rejected queued sales surface their typed reason with the
 * three SYNC_PROTOCOL actions: Edit & resend (counter), Accept server price
 * (re-fetch + re-submit), Cancel with reason (kept locally, never deleted).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, Select, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  BranchRow,
  ItemRow,
  PosCheckRow,
  PosOutboxEntry,
  PosSaleResult,
  PosTerminalRow,
  PosZReport,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedName, localizedPosError, localizedPosOfflineReason, localizedPosOrderType } from "../lib/messages";
import { compareExact, percentExact } from "../lib/exact-money";
import { readPosOutbox, updatePosOutboxEntry, writePosOutboxEditClientId } from "../lib/pos-outbox";
import { printHtmlDocument } from "../lib/print-frame";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function PosReconciliation({
  locale,
  branches,
  terminals,
  initialBranchId,
  initialChecks,
  initialReport,
  today,
}: {
  locale: Locale;
  branches: readonly BranchRow[];
  terminals: readonly PosTerminalRow[];
  initialBranchId: string;
  initialChecks: readonly PosCheckRow[];
  initialReport: PosZReport | null;
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [branchId, setBranchId] = useState(initialBranchId);
  const [date, setDate] = useState(DATE_RE.test(today) ? today : new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<PosZReport | null>(initialReport);
  const [checks, setChecks] = useState<readonly PosCheckRow[]>(initialChecks);
  const [outbox, setOutbox] = useState<PosOutboxEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelEntry, setCancelEntry] = useState<PosOutboxEntry | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const activeBranches = useMemo(() => branches.filter((b) => b.isActive), [branches]);
  const terminalLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const terminal of terminals) {
      map.set(terminal.id, terminal.code);
    }
    return map;
  }, [terminals]);
  const rejected = outbox.filter((entry) => entry.status === "REJECTED");

  useEffect(() => {
    setOutbox(readPosOutbox());
  }, []);

  const load = useCallback(
    async (nextBranchId: string, nextDate: string): Promise<void> => {
      if (nextBranchId === "" || !DATE_RE.test(nextDate)) {
        return;
      }
      setBusy("load");
      setError(null);
      const [zReport, openChecks] = await Promise.all([
        bffFetch<PosZReport>(`pos/z-report?branchId=${nextBranchId}&date=${nextDate}`),
        bffFetch<readonly PosCheckRow[]>(`pos/checks?branchId=${nextBranchId}&status=OPEN`),
      ]);
      setBusy(null);
      if (!zReport.ok) {
        setError(localizedPosError(d, zReport.error, zReport.retryAfterSeconds));
        return;
      }
      setReport(zReport.data);
      setChecks(openChecks.ok ? openChecks.data : []);
    },
    [d],
  );

  /** Accept-server-price: refresh item prices, then re-submit the queued sale. */
  async function acceptServerPrice(entry: PosOutboxEntry): Promise<void> {
    setBusy(`price-${entry.clientId}`);
    setError(null);
    const items = await bffFetch<readonly ItemRow[]>("items/items?limit=500");
    setBusy(null);
    if (!items.ok) {
      setError(localizedPosError(d, items.error, items.retryAfterSeconds));
      return;
    }
    const priceById = new Map<string, string>();
    for (const item of items.data) {
      if (item.basePrice !== null && item.basePrice !== "") {
        priceById.set(item.id, item.basePrice);
      }
    }
    const updated: PosOutboxEntry = {
      ...entry,
      kept: false,
      rejection: undefined,
      status: "PENDING_SYNC",
      sale: {
        ...entry.sale,
        lines: entry.sale.lines.map((line) => ({
          ...line,
          unitPrice: priceById.get(line.itemId) ?? line.unitPrice,
        })),
      },
    };
    updatePosOutboxEntry(updated);
    const result = await bffFetch<PosSaleResult>("pos/sales", {
      method: "POST",
      body: {
        terminalId: updated.terminalId,
        customerId: updated.sale.customerId,
        lines: updated.sale.lines,
        tenders: updated.sale.tenders,
        orderType: updated.sale.orderType,
        checkId: updated.sale.checkId ?? null,
        offlineReceiptNo: updated.offlineReceiptNo,
      },
    });
    if (result.ok) {
      updatePosOutboxEntry({ ...updated, status: "SYNCED" });
      setNotice(formatMessage(d.posOfflineSyncedToast, { n: 1 }));
    } else {
      updatePosOutboxEntry({
        ...updated,
        status: "REJECTED",
        rejection: { reason: result.error.code, message: result.error.message },
      });
      setError(localizedPosError(d, result.error, result.retryAfterSeconds));
    }
    setOutbox([...readPosOutbox()]);
    void load(branchId, date);
  }

  function cancelWithReason(): void {
    if (cancelEntry === null || cancelReason.trim() === "") {
      return;
    }
    updatePosOutboxEntry({ ...cancelEntry, kept: true, localCancelReason: cancelReason.trim() });
    setOutbox([...readPosOutbox()]);
    setCancelEntry(null);
    setCancelReason("");
    setNotice(d.posOfflineCancelledLocal);
  }

  /** The printable Z document (pt units, escaped, RTL-aware). */
  function buildZHtml(data: PosZReport): string {
    const dir = locale === "ar" ? "rtl" : "ltr";
    const row = (cells: readonly string[]): string =>
      `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    const orderRows = data.byOrderType
      .map((bucket) =>
        row([
          localizedPosOrderType(d, bucket.orderType),
          String(bucket.count),
          formatMoneyDisplay(bucket.net, 2),
          formatMoneyDisplay(bucket.tax, 2),
          formatMoneyDisplay(bucket.gross, 2),
        ]),
      )
      .join("");
    const tenderRows = data.byTender
      .map((bucket) => row([bucket.method === "CARD" ? d.posTenderCard : d.posTenderCash, formatMoneyDisplay(bucket.amount, 2)]))
      .join("");
    const terminalRows = data.byTerminal
      .map((bucket) =>
        row([terminalLabelById.get(bucket.terminalId) ?? bucket.terminalId.slice(0, 8), String(bucket.count), formatMoneyDisplay(bucket.gross, 2)]),
      )
      .join("");
    const offlineRows = data.offlineReconciliation
      .map((line) =>
        row([
          line.offlineReceiptNo ?? "—",
          line.invoiceNo ?? "—",
          localizedPosOrderType(d, line.orderType),
          formatMoneyDisplay(line.gross, 2),
        ]),
      )
      .join("");
    return `<!doctype html><html dir="${dir}" lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(
      data.zNumber,
    )}</title><style>body{font-family:monospace;font-size:10pt;margin:1em}h1{font-size:13pt}h2{font-size:11pt;margin-block-start:1em}table{width:100%;border-collapse:collapse}td,th{border-block-end:1pt solid silver;padding:2pt 4pt;text-align:start}th{font-weight:700}.t{font-size:12pt;font-weight:700}</style></head><body><h1>${escapeHtml(
      d.posReconciliationTitle,
    )} · ${escapeHtml(data.zNumber)}</h1><p>${escapeHtml(d.posReconciliationDate)}: ${escapeHtml(
      data.date,
    )}</p><h2>${escapeHtml(d.posReconciliationTotals)}</h2><table>${row([
      d.posReconciliationInvoiceCount,
      String(data.totals.invoiceCount),
    ])}${row([d.salesTotalNet, formatMoneyDisplay(data.totals.totalNet, 2)])}${row([
      d.posReconciliationColTax,
      formatMoneyDisplay(data.totals.totalTax, 2),
    ])}${row([d.salesTotalGross, formatMoneyDisplay(data.totals.totalGross, 2)])}</table><h2>${escapeHtml(
      d.posReconciliationByOrderType,
    )}</h2><table><thead><tr><th>${escapeHtml(d.posReconciliationColType)}</th><th>${escapeHtml(
      d.posReconciliationColCount,
    )}</th><th>${escapeHtml(d.salesTotalNet)}</th><th>${escapeHtml(
      d.posReconciliationColTax,
    )}</th><th>${escapeHtml(d.salesTotalGross)}</th></tr></thead><tbody>${orderRows}</tbody></table><h2>${escapeHtml(
      d.posReconciliationByTender,
    )}</h2><table>${tenderRows}</table><h2>${escapeHtml(
      d.posReconciliationByTerminal,
    )}</h2><table>${terminalRows}</table><h2>${escapeHtml(
      d.posReconciliationOfflinePairs,
    )}</h2><table>${offlineRows}</table></body></html>`;
  }

  const maxHourGross =
    report === null
      ? "0"
      : report.byHour.reduce((max, bucket) => (compareExact(bucket.gross, max) > 0 ? bucket.gross : max), "0");

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.posReconciliationTitle}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56">
            <Select
              label={d.posReconciliationBranch}
              value={branchId}
              onValueChange={setBranchId}
              options={activeBranches.map((branch) => ({
                value: branch.id,
                label: localizedName(branch.name, branch.nameAr, locale),
              }))}
            />
          </div>
          <DatePicker label={d.posReconciliationDate} value={date} onSelect={setDate} locale={locale} />
          <Button variant="primary" loading={busy === "load"} onClick={() => void load(branchId, date)}>
            {d.posReconciliationLoad}
          </Button>
          {report !== null && (
            <Button variant="secondary" onClick={() => printHtmlDocument(buildZHtml(report))}>
              {d.posReconciliationPrint}
            </Button>
          )}
        </div>
        {checks.length > 0 && (
          <div className="mt-3">
            <InfoNotice>
              {formatMessage(d.posReconciliationOpenChecks, { n: checks.length })} —{" "}
              <span className="font-mono" dir="ltr">
                {checks.map((check) => check.checkNo).join(" · ")}
              </span>
            </InfoNotice>
          </div>
        )}
      </Card>

      {report !== null && (
        <>
          <Card
            title={d.posReconciliationTotals}
            actions={
              <Badge tone="primary" mono bidiIsolate>
                {d.posReconciliationZNumber}: {report.zNumber}
              </Badge>
            }
          >
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-muted-foreground">{d.posReconciliationInvoiceCount}</dt>
                <dd className="font-mono text-xl font-semibold tabular-nums text-gray-900" dir="ltr">
                  {report.totals.invoiceCount}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{d.salesTotalNet}</dt>
                <dd className="font-mono text-xl font-semibold tabular-nums text-gray-900" dir="ltr">
                  {formatMoneyDisplay(report.totals.totalNet, 2)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{d.posReconciliationColTax}</dt>
                <dd className="font-mono text-xl font-semibold tabular-nums text-gray-900" dir="ltr">
                  {formatMoneyDisplay(report.totals.totalTax, 2)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">{d.salesTotalGross}</dt>
                <dd className="font-mono text-xl font-semibold tabular-nums text-gray-900" dir="ltr">
                  {formatMoneyDisplay(report.totals.totalGross, 2)}
                </dd>
              </div>
            </dl>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={d.posReconciliationByOrderType}>
              {report.byOrderType.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.posReconciliationEmpty}</p>
              ) : (
                <DataTable
                  columns={[
                    {
                      id: "type",
                      header: activeLocaleHeader(d.posReconciliationColType),
                      accessor: (row) => row.orderType,
                      render: (row) => localizedPosOrderType(d, row.orderType),
                    },
                    {
                      id: "count",
                      header: activeLocaleHeader(d.posReconciliationColCount),
                      accessor: (row) => String(row.count),
                      numeric: true,
                    },
                    {
                      id: "net",
                      header: activeLocaleHeader(d.salesTotalNet),
                      accessor: (row) => row.net,
                      numeric: true,
                      render: (row) => (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.net, 2)}
                        </span>
                      ),
                    },
                    {
                      id: "tax",
                      header: activeLocaleHeader(d.posReconciliationColTax),
                      accessor: (row) => row.tax,
                      numeric: true,
                      render: (row) => (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.tax, 2)}
                        </span>
                      ),
                    },
                    {
                      id: "gross",
                      header: activeLocaleHeader(d.salesTotalGross),
                      accessor: (row) => row.gross,
                      numeric: true,
                      render: (row) => (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.gross, 2)}
                        </span>
                      ),
                    },
                  ]}
                  rows={[...report.byOrderType]}
                  rowKey={(row) => row.orderType}
                  empty={{ title: d.posReconciliationEmpty }}
                />
              )}
            </Card>

            <Card title={d.posReconciliationByTender}>
              {report.byTender.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.posReconciliationEmpty}</p>
              ) : (
                <DataTable
                  columns={[
                    {
                      id: "method",
                      header: activeLocaleHeader(d.posTenderMethod),
                      accessor: (row) => row.method,
                      render: (row) => (row.method === "CARD" ? d.posTenderCard : d.posTenderCash),
                    },
                    {
                      id: "amount",
                      header: activeLocaleHeader(d.posTenderAmount),
                      accessor: (row) => row.amount,
                      numeric: true,
                      render: (row) => (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.amount, 2)}
                        </span>
                      ),
                    },
                  ]}
                  rows={[...report.byTender]}
                  rowKey={(row) => row.method}
                  empty={{ title: d.posReconciliationEmpty }}
                />
              )}
            </Card>

            <Card title={d.posReconciliationByTerminal}>
              {report.byTerminal.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.posReconciliationEmpty}</p>
              ) : (
                <DataTable
                  columns={[
                    {
                      id: "terminal",
                      header: activeLocaleHeader(d.posTerminalsCode),
                      accessor: (row) => terminalLabelById.get(row.terminalId) ?? row.terminalId,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {terminalLabelById.get(row.terminalId) ?? row.terminalId.slice(0, 8)}
                        </span>
                      ),
                    },
                    {
                      id: "count",
                      header: activeLocaleHeader(d.posReconciliationColCount),
                      accessor: (row) => String(row.count),
                      numeric: true,
                    },
                    {
                      id: "gross",
                      header: activeLocaleHeader(d.salesTotalGross),
                      accessor: (row) => row.gross,
                      numeric: true,
                      render: (row) => (
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.gross, 2)}
                        </span>
                      ),
                    },
                  ]}
                  rows={[...report.byTerminal]}
                  rowKey={(row) => row.terminalId}
                  empty={{ title: d.posReconciliationEmpty }}
                />
              )}
            </Card>

            <Card title={d.posReconciliationByHour}>
              {report.byHour.length === 0 ? (
                <p className="text-sm text-muted-foreground">{d.posReconciliationEmpty}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {report.byHour.map((bucket) => {
                    const pct = Math.max(2, percentExact(bucket.gross, maxHourGross));
                    return (
                      <div key={bucket.hour} className="flex items-center gap-2">
                        <span className="w-10 font-mono text-xs tabular-nums text-gray-600" dir="ltr">
                          {bucket.hour}:00
                        </span>
                        <div
                          className="h-4 flex-none rounded-sm border border-subtle bg-surface-sunken"
                          style={{ width: `${pct}%` }}
                          role="img"
                          aria-label={`${bucket.hour}:00 — ${formatMoneyDisplay(bucket.gross, 2)}`}
                        >
                          <div className="h-full w-full rounded-sm bg-primary-100" />
                        </div>
                        <span className="font-mono text-xs tabular-nums text-gray-900" dir="ltr">
                          {formatMoneyDisplay(bucket.gross, 2)} · {bucket.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <Card title={d.posReconciliationOfflinePairs}>
            {report.offlineReconciliation.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d.posReconciliationEmpty}</p>
            ) : (
              <DataTable
                columns={[
                  {
                    id: "offlineNo",
                    header: activeLocaleHeader(d.posReconciliationOfflineNo),
                    accessor: (row) => row.offlineReceiptNo ?? "—",
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.offlineReceiptNo ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "officialNo",
                    header: activeLocaleHeader(d.posReconciliationOfficialNo),
                    accessor: (row) => row.invoiceNo ?? "—",
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.invoiceNo ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "type",
                    header: activeLocaleHeader(d.posReconciliationColType),
                    accessor: (row) => row.orderType,
                    render: (row) => localizedPosOrderType(d, row.orderType),
                  },
                  {
                    id: "gross",
                    header: activeLocaleHeader(d.salesTotalGross),
                    accessor: (row) => row.gross,
                    numeric: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(row.gross, 2)}
                      </span>
                    ),
                  },
                ]}
                rows={[...report.offlineReconciliation]}
                rowKey={(row) => row.offlineReceiptNo ?? row.invoiceNo ?? row.createdAt}
                empty={{ title: d.posReconciliationEmpty }}
              />
            )}
          </Card>
        </>
      )}

      {rejected.length > 0 && (
        <Card title={d.posReconciliationRejections}>
          <div className="flex flex-col gap-3">
            {rejected.map((entry) => (
              <div key={entry.clientId} className="rounded-md border border-subtle p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm" dir="ltr">
                      {entry.offlineReceiptNo} · {entry.terminalCode}
                    </p>
                    <p className="text-xs text-danger-text">
                      {d.posOfflineRejectionReason}:{" "}
                      {entry.rejection === undefined
                        ? "—"
                        : `${localizedPosOfflineReason(d, entry.rejection.reason)}${
                            entry.localCancelReason !== undefined ? ` · ${entry.localCancelReason}` : ""
                          }`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {entry.localCancelReason === undefined && (
                      <>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            writePosOutboxEditClientId(entry.clientId);
                            router.push(`/${locale}/pos`);
                          }}
                        >
                          {d.posOfflineEditResend}
                        </Button>
                        <Button
                          variant="secondary"
                          loading={busy === `price-${entry.clientId}`}
                          onClick={() => void acceptServerPrice(entry)}
                        >
                          {d.posOfflineAcceptPrice}
                        </Button>
                        <Button variant="secondary" onClick={() => setCancelEntry(entry)}>
                          {d.posOfflineCancelWithReason}
                        </Button>
                      </>
                    )}
                    {entry.localCancelReason !== undefined && <Badge>{d.posOfflineKept}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={cancelEntry !== null} onOpenChange={(open) => !open && setCancelEntry(null)} title={d.posOfflineCancelWithReason}>
        <div className="flex flex-col gap-3">
          <Input label={d.posFloorCancelReason} value={cancelReason} onValueChange={setCancelReason} required />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelEntry(null)}>
              {d.commonCancel}
            </Button>
            <Button variant="danger" disabled={cancelReason.trim() === ""} onClick={cancelWithReason}>
              {d.posOfflineCancelWithReason}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
