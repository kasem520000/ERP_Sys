"use client";

/**
 * PHASE-026 (T13-UI) — depreciation runs + the run workspace (PAGE_ARCHETYPES
 * §4, the transaction-entry archetype — the journal-workspace pattern): the
 * fiscal-period picker (year → period; degrades to raw ids when the fiscal
 * calendar route is not granted), the runs list (period, status + reversed
 * badge, asset count, total, posted journal), the assembly grid (per-asset
 * lines: code, method, EDITABLE period units for UNITS_OF_PRODUCTION rows
 * with live exact-math preview — never floats, ADR-0009; the server
 * re-assembly stays the authority), the sticky MoneySummaryBar live totals
 * (Σdebit/Σcredit/Δ — the G-22 one-journal mirror), explicit post with a
 * confirm dialog, and engine-reversal with a mandatory reason (lines stay).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DocumentStatusBadge,
  Input,
  MoneySummaryBar,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  DepreciationRunDetailRow,
  DepreciationRunListRow,
  FiscalPeriodRow,
  FiscalYearRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { addExact, subtractExact } from "../lib/exact-money";
import {
  formatMessage,
  localizedDocumentStatus,
  localizedFixedAssetsError,
  localizedPeriodStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Parse a decimal string at a fixed dp into BigInt minor units. */
function toMinorAt(value: string, dp: bigint): bigint {
  const [int = "0", frac = ""] = (value === "" ? "0" : value).split(".");
  return BigInt(int === "" ? "0" : int) * 10n ** dp + BigInt(frac.slice(0, Number(dp)).padEnd(Number(dp), "0"));
}

/** Render BigInt minor units at a fixed dp back to a canonical decimal string. */
function fromMinorAt(minor: bigint, dp: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 10n ** dp;
  const frac = (abs % 10n ** dp).toString().padStart(Number(dp), "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/**
 * Exact UoP preview: (cost − salvage) × units / totalEstimatedUnits, rounded
 * half-up to 4dp — BigInt only, never floats. A PREVIEW: the server's
 * re-assembly (final-period residual, salvage floor) is the authority.
 */
function uopPreview(base: string, units: string, total: string): string {
  const unitsMinor = toMinorAt(units.trim() === "" ? "0" : units, 6n);
  const totalMinor = toMinorAt(total, 6n);
  if (totalMinor <= 0n || unitsMinor < 0n) {
    return "0.0000";
  }
  const baseMinor = toMinorAt(base, 4n);
  // (4dp × 6dp) = 10dp product; target 4dp → multiply by 10^4 then ÷ total(6dp)
  const numerator = baseMinor * unitsMinor * 10_000n;
  const quotient = numerator / totalMinor;
  const remainder = numerator % totalMinor;
  const rounded = remainder * 2n >= totalMinor ? quotient + 1n : quotient;
  return fromMinorAt(rounded, 4n);
}

export function DepreciationRuns({
  locale,
  baseCurrency,
  initialRuns,
  initialYears,
}: {
  locale: Locale;
  baseCurrency: string;
  initialRuns: readonly DepreciationRunListRow[];
  initialYears: readonly FiscalYearRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const currency = baseCurrency === "" ? "SAR" : baseCurrency;

  const [runs, setRuns] = useState<readonly DepreciationRunListRow[]>(initialRuns);
  const [years] = useState<readonly FiscalYearRow[]>(initialYears);
  const [yearId, setYearId] = useState(initialYears[0]?.id ?? "");
  const [periodsByYear, setPeriodsByYear] = useState<Record<string, readonly FiscalPeriodRow[]>>({});
  const [periodId, setPeriodId] = useState("");

  const [detail, setDetail] = useState<DepreciationRunDetailRow | null>(null);
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [postOpen, setPostOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState("");

  const periodLabel = useCallback(
    (id: string): string => {
      for (const list of Object.values(periodsByYear)) {
        const period = list.find((row) => row.id === id);
        if (period !== undefined) {
          return `${period.name} (${period.startDate} → ${period.endDate})`;
        }
      }
      return id;
    },
    [periodsByYear],
  );

  // Load the selected year's periods (picker + run-row labels). The fiscal
  // calendar route needs accounting.journal_entries.view — a 403 degrades
  // the picker to raw period ids (the module routes still work).
  useEffect(() => {
    if (yearId === "" || periodsByYear[yearId] !== undefined) {
      return;
    }
    let cancelled = false;
    void (async (): Promise<void> => {
      const fetched = await bffFetch<readonly FiscalPeriodRow[]>(
        `accounting/fiscal-years/${yearId}/periods`,
      );
      if (cancelled) {
        return;
      }
      if (!fetched.ok) {
        setPickerError(localizedFixedAssetsError(d, fetched.error, fetched.retryAfterSeconds));
        setPeriodsByYear((prev) => ({ ...prev, [yearId]: [] }));
        return;
      }
      setPeriodsByYear((prev) => ({ ...prev, [yearId]: fetched.data }));
    })();
    return () => {
      cancelled = true;
    };
  }, [yearId, periodsByYear, d]);

  const periods = periodsByYear[yearId] ?? [];
  const selectedPeriod = periods.find((period) => period.id === periodId) ?? null;
  const run = detail?.run ?? null;
  const lines = detail?.lines ?? [];
  const isDraft = run?.status === "DRAFT";
  const posted = run?.status === "POSTED";

  /** The per-line view the grid renders — the live UoP preview included. */
  const gridRows = useMemo(() => {
    return lines.map((line) => {
      if (line.method !== "UNITS_OF_PRODUCTION") {
        return {
          line,
          units: line.periodUnits ?? "",
          amount: line.periodAmount,
          accumAfter: line.accumulatedAmount,
          nbvAfter: line.nbvAfter,
          live: false,
        };
      }
      const units = usage[line.assetId] ?? line.periodUnits ?? "";
      const base = subtractExact(line.cost, line.salvageValue);
      const amount = isDraft ? uopPreview(base, units, line.totalEstimatedUnits ?? "0") : line.periodAmount;
      const delta = subtractExact(amount, line.periodAmount);
      const accumAfter = isDraft ? addExact(line.accumulatedAmount, delta) : line.accumulatedAmount;
      const nbvAfter = isDraft
        ? subtractExact(subtractExact(subtractExact(line.cost, line.salvageValue), line.openingAccumulated), accumAfter)
        : line.nbvAfter;
      return { line, units, amount, accumAfter, nbvAfter, live: isDraft };
    });
  }, [lines, usage, isDraft]);

  const totalAmount = useMemo(
    () => gridRows.reduce((sum, row) => addExact(sum, row.amount), "0"),
    [gridRows],
  );

  async function refreshRuns(): Promise<void> {
    const refreshed = await bffFetch<readonly DepreciationRunListRow[]>(
      "fixed-assets/depreciation-runs?limit=50",
    );
    if (refreshed.ok) {
      setRuns(refreshed.data);
    }
  }

  async function loadRun(id: string): Promise<void> {
    setError(null);
    setBusy(`open-${id}`);
    const fetched = await bffFetch<DepreciationRunDetailRow>(`fixed-assets/depreciation-runs/${id}`);
    setBusy(null);
    if (!fetched.ok) {
      setError(localizedFixedAssetsError(d, fetched.error, fetched.retryAfterSeconds));
      return;
    }
    setDetail(fetched.data);
    setUsage(
      Object.fromEntries(
        fetched.data.lines
          .filter((line) => line.method === "UNITS_OF_PRODUCTION" && line.periodUnits !== null)
          .map((line) => [line.assetId, line.periodUnits ?? ""]),
      ),
    );
    // The picker follows the opened run's period (and its year when loaded).
    setPeriodId(fetched.data.run.fiscalPeriodId);
    for (const [yId, list] of Object.entries(periodsByYear)) {
      if (list.some((period) => period.id === fetched.data.run.fiscalPeriodId)) {
        setYearId(yId);
        break;
      }
    }
  }

  async function assemble(withUsage: boolean): Promise<void> {
    setError(null);
    setNotice(null);
    if (periodId === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(withUsage ? "apply" : "assemble");
    const body: Record<string, unknown> = { fiscalPeriodId: periodId };
    if (withUsage) {
      const unitsByAssetId: Record<string, string> = {};
      for (const row of gridRows) {
        if (row.line.method === "UNITS_OF_PRODUCTION" && row.units.trim() !== "") {
          unitsByAssetId[row.line.assetId] = row.units.trim();
        }
      }
      body.unitsByAssetId = unitsByAssetId;
    }
    const assembled = await bffFetch<DepreciationRunListRow>("fixed-assets/depreciation-runs/assemble", {
      method: "POST",
      body,
    });
    setBusy(null);
    if (!assembled.ok) {
      setError(localizedFixedAssetsError(d, assembled.error, assembled.retryAfterSeconds));
      return;
    }
    setNotice(d.faDepAssembledToast);
    await loadRun(assembled.data.id);
    await refreshRuns();
  }

  async function postRun(): Promise<void> {
    if (run === null) {
      return;
    }
    setPostOpen(false);
    setError(null);
    setNotice(null);
    setBusy("post");
    const posted = await bffFetch<DepreciationRunListRow>(
      `fixed-assets/depreciation-runs/${run.id}/post`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!posted.ok) {
      setError(localizedFixedAssetsError(d, posted.error, posted.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.faDepPostedToast, { entry: posted.data.journalEntryId ?? posted.data.id }),
    );
    await loadRun(run.id);
    await refreshRuns();
  }

  async function reverseRun(): Promise<void> {
    if (run === null) {
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("reverse");
    const reversed = await bffFetch<DepreciationRunListRow>(
      `fixed-assets/depreciation-runs/${run.id}/reverse`,
      { method: "POST", body: { reason: reverseReason.trim() } },
    );
    setBusy(null);
    if (!reversed.ok) {
      setError(localizedFixedAssetsError(d, reversed.error, reversed.retryAfterSeconds));
      return;
    }
    setNotice(d.faDepReversedToast);
    setReverseReason("");
    await loadRun(run.id);
    await refreshRuns();
  }

  const summaryLabels = {
    debit: d.accountingColDebit,
    credit: d.accountingColCredit,
    difference: d.accountingDifference,
    balanced: d.accountingBalanced,
    unbalanced: d.accountingUnbalanced,
  };

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {pickerError !== null && <InfoNotice>{pickerError}</InfoNotice>}

      <Card title={d.faDepPeriodLabel}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            id="fa-dep-year"
            label={d.faDepPeriodYear}
            value={yearId}
            onValueChange={(value) => {
              setYearId(value);
              setPeriodId("");
            }}
            options={[
              { value: "", label: "—" },
              ...years.map((year) => ({ value: year.id, label: year.name })),
            ]}
          />
          <Select
            id="fa-dep-period"
            label={d.faDepPeriodPeriod}
            value={periodId}
            onValueChange={setPeriodId}
            options={[
              { value: "", label: "—" },
              ...periods
                .filter((period) => period.kind === "REGULAR")
                .map((period) => ({
                  value: period.id,
                  label: `${period.name} · ${localizedPeriodStatus(d, period.status)}`,
                })),
            ]}
          />
          <div className="flex items-end">
            <p className="text-xs text-gray-600">{d.faDepAssembleHint}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
          <Button
            variant="primary"
            onClick={() => void assemble(false)}
            loading={busy === "assemble"}
            disabled={periodId === ""}
          >
            {d.faDepAssembleButton}
          </Button>
          {selectedPeriod !== null && selectedPeriod.status === "LOCKED" && (
            <InfoNotice>{d.faErrPeriodLocked}</InfoNotice>
          )}
        </div>
      </Card>

      <Card title={d.faDepTitle}>
        <DataTable
          columns={[
            {
              id: "period",
              header: activeLocaleHeader(d.faDepColPeriod),
              accessor: (row) => periodLabel(row.fiscalPeriodId),
              render: (row) => (
                <span className="flex flex-col">
                  <span className="truncate">{periodLabel(row.fiscalPeriodId)}</span>
                </span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.colStatus),
              accessor: (row) => row.status,
              render: (row) => (
                <span className="flex flex-wrap items-center gap-2">
                  <DocumentStatusBadge status={row.status} label={localizedDocumentStatus(d, row.status)} />
                  {row.reversedAt !== null && <Badge tone="neutral">{d.faReversedBadge}</Badge>}
                </span>
              ),
            },
            {
              id: "assets",
              header: activeLocaleHeader(d.faDepColAssets),
              accessor: (row) => String(row.assetCount),
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {row.assetCount}
                </span>
              ),
            },
            {
              id: "total",
              header: activeLocaleHeader(d.faDepColTotal),
              accessor: (row) => row.totalAmount,
              numeric: true,
              render: (row) => (
                <span className="font-mono tabular-nums" dir="ltr">
                  {formatMoneyDisplay(row.totalAmount, 2)}
                </span>
              ),
            },
            {
              id: "postedAt",
              header: activeLocaleHeader(d.faDepColPostedAt),
              accessor: (row) => row.postedAt ?? "",
              mono: true,
              render: (row) =>
                row.postedAt === null ? (
                  <span className="text-gray-500">—</span>
                ) : (
                  <span className="font-mono text-xs" dir="ltr">
                    {row.postedAt.slice(0, 16).replace("T", " ")}
                  </span>
                ),
            },
          ]}
          rows={[...runs]}
          rowKey={(row) => row.id}
          rowActions={[
            {
              id: "open",
              label: d.commonOpen,
              onSelect: (row) => void loadRun(row.id),
            },
          ]}
          empty={{ title: d.faDepEmpty }}
        />
      </Card>

      {run !== null && (
        <Card
          title={d.faDepWorkspaceTitle}
          description={periodLabel(run.fiscalPeriodId)}
          actions={
            <span className="flex flex-wrap items-center gap-2">
              <DocumentStatusBadge status={run.status} label={localizedDocumentStatus(d, run.status)} />
              {run.reversedAt !== null && <Badge tone="neutral">{d.faReversedBadge}</Badge>}
            </span>
          }
        >
          {lines.length === 0 ? (
            <p className="text-sm text-gray-600">{d.faDepNoLines}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-subtle">
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.faColCode} · {d.colName}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.faDepColMethod}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.faDepColUnits}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.faDepColPeriodAmount}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.faDepColAccumAfter}
                      </th>
                      <th scope="col" className="px-2 py-2 text-start font-medium">
                        {d.faDepColNbvAfter}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => (
                      <tr key={row.line.id} className="border-b border-subtle/60">
                        <td className="px-2 py-2">
                          <span className="flex min-w-0 flex-col">
                            <span className="font-mono text-xs" dir="ltr">
                              {row.line.assetCode}
                            </span>
                            <span className="truncate text-xs text-gray-600">
                              {locale === "ar" ? row.line.assetNameAr || row.line.assetName : row.line.assetName}
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {row.line.method === "UNITS_OF_PRODUCTION"
                            ? d.faMethodUop
                            : row.line.method === "DECLINING_BALANCE"
                              ? d.faMethodDb
                              : d.faMethodSl}
                        </td>
                        <td className="px-2 py-2">
                          {row.line.method === "UNITS_OF_PRODUCTION" ? (
                            isDraft ? (
                              <Input
                                id={`fa-dep-units-${row.line.assetId}`}
                                aria-label={`${d.faDepColUnits} — ${row.line.assetCode}`}
                                value={row.units}
                                onValueChange={(value) =>
                                  setUsage((prev) => ({ ...prev, [row.line.assetId]: value }))
                                }
                                inputMode="decimal"
                                mono
                                bidiIsolate
                                className="w-28"
                              />
                            ) : (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {row.line.periodUnits ?? "—"}
                              </span>
                            )
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.amount, 2)}
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.accumAfter, 2)}
                        </td>
                        <td className="px-2 py-2 font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(row.nbvAfter, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-gray-600">{d.faDepUopHint}</p>
              <div className="mt-3">
                <MoneySummaryBar
                  debit={totalAmount}
                  credit={totalAmount}
                  currency={currency}
                  labels={summaryLabels}
                />
              </div>
              {isDraft && (
                <p className="mt-2 text-xs text-gray-600">{d.faDepPreviewNote}</p>
              )}
              <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
                {isDraft && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => void assemble(true)}
                      loading={busy === "apply"}
                    >
                      {d.faDepApplyUsage}
                    </Button>
                    <Button variant="primary" onClick={() => setPostOpen(true)} loading={busy === "post"}>
                      {d.faDepPostButton}
                    </Button>
                  </>
                )}
                {posted && run.reversedAt === null && (
                  <>
                    <Input
                      id="fa-dep-reverse-reason"
                      label={d.faDepReverseReason}
                      value={reverseReason}
                      onValueChange={setReverseReason}
                      required
                      className="w-64"
                    />
                    <Button
                      variant="danger"
                      onClick={() => void reverseRun()}
                      loading={busy === "reverse"}
                      disabled={reverseReason.trim().length < 3}
                    >
                      {d.faDepReverseButton}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </Card>
      )}

      <Dialog
        open={postOpen}
        onOpenChange={setPostOpen}
        title={d.faDepPostConfirmTitle}
        size="sm"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700">
            {formatMessage(d.faDepPostConfirmBody, { amount: formatMoneyDisplay(totalAmount, 2) })}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPostOpen(false)}>
              {d.commonCancel}
            </Button>
            <Button variant="primary" onClick={() => void postRun()}>
              {d.accountingPost}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
