"use client";

/**
 * PHASE-017 T14 (9a-dist) — rep settlements workspace:
 *
 *   expected cash = opening + cash sales + collections − refunds − expenses
 *   variance      = counted − expected   (BR-021: always posts, approval-
 *                                        gated, never netted)
 *
 * - the list with a status filter + the open dialog (rep, CASH account,
 *   optional van, date, opening float);
 * - the selected settlement's detail: the expected-cash component lines
 *   (signed; Σ = expected), the count form with a LIVE variance preview
 *   (exact string arithmetic — the reason input enables on a non-zero
 *   preview), approve (only when the server marks approvalRequired),
 *   the post dialog (optional deposit account + amount, never above the
 *   counted cash) and cancel. Money stays canonical decimal strings.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  MoneyInput,
  Select,
  formatMoneyDisplay,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CashAccountRow,
  RepSettlementRow,
  RepSettlementWithLines,
  SalesRepRow,
  VanRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { isZeroExact, subtractExact, compareExact } from "../lib/exact-money";
import {
  formatMessage,
  localizedName,
  localizedDistributionError,
  localizedSettlementComponent,
  localizedSettlementStatus,
  localizedVarianceDirection,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

function moneyCell(value: string | null): JSX.Element {
  if (value === null) {
    return <span className="text-gray-500">—</span>;
  }
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {formatMoneyDisplay(value, 2)}
    </span>
  );
}

export function DistributionSettlements({
  locale,
  initialRows,
  reps,
  cashAccounts,
  vans,
  today,
}: {
  locale: Locale;
  initialRows: readonly RepSettlementRow[];
  reps: readonly SalesRepRow[];
  cashAccounts: readonly CashAccountRow[];
  vans: readonly VanRow[];
  today: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly RepSettlementRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List filter.
  const [statusFilter, setStatusFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Open dialog state.
  const [openOpen, setOpenOpen] = useState(false);
  const [repId, setRepId] = useState("");
  const [cashAccountId, setCashAccountId] = useState("");
  const [vanWarehouseId, setVanWarehouseId] = useState("");
  const [settlementDate, setSettlementDate] = useState(today);
  const [openingCash, setOpeningCash] = useState("");

  // Detail workspace state.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RepSettlementWithLines | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [varianceReason, setVarianceReason] = useState("");

  // Post dialog state.
  const [postOpen, setPostOpen] = useState(false);
  const [depositAccountId, setDepositAccountId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");

  // Cancel dialog state.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const activeReps = useMemo(() => reps.filter((rep) => rep.status === "ACTIVE"), [reps]);
  const repCashAccounts = useMemo(
    () => cashAccounts.filter((account) => account.status === "ACTIVE" && account.type === "CASH"),
    [cashAccounts],
  );
  const depositAccounts = useMemo(
    () => cashAccounts.filter((account) => account.status === "ACTIVE"),
    [cashAccounts],
  );
  const activeVans = useMemo(() => vans.filter((van) => van.isActive), [vans]);
  const currencyByAccount = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of cashAccounts) {
      map.set(account.id, account.currencyCode);
    }
    return map;
  }, [cashAccounts]);
  const repLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const rep of reps) {
      map.set(rep.id, `${localizedName(rep.name, rep.nameAr, locale)} · ${rep.code}`);
    }
    return map;
  }, [reps, locale]);

  const repCurrency = useMemo(
    () =>
      currencyByAccount.get(
        detail?.lines.find((line) => line.component === "OPENING_CASH")?.sourceId ?? "",
      ) ?? "SAR",
    [currencyByAccount, detail],
  );
  const openReady =
    repId !== "" && cashAccountId !== "" && settlementDate !== "" && countedValid(openingCash);
  // The LIVE variance preview needs the server-computed expectation — only
  // a settlement that has counted once carries a real expectedCash (a DRAFT's
  // expected is computed at count time from the ledgers). First counts send
  // blind; the typed SETTLEMENT_VARIANCE_REASON_REQUIRED error then renders
  // localized, and the recount path gets the preview.
  const canPreview = detail !== null && detail.countedCash !== null;
  const countedPreview =
    canPreview && countedCash !== "" && countedValid(countedCash) && detail.expectedCash !== ""
      ? subtractExact(countedCash, detail.expectedCash)
      : null;
  const previewDirection =
    countedPreview === null ? "NONE" : compareExact(countedPreview, "0") < 0 ? "SHORTAGE" : "SURPLUS";
  const previewNonZero = countedPreview !== null && !isZeroExact(countedPreview);
  const countReady =
    countedCash !== "" &&
    countedValid(countedCash) &&
    (!previewNonZero || varianceReason.trim() !== "");
  const depositValid = depositAmount === "" || countedValid(depositAmount);
  const postReady = depositValid && (depositAccountId === "" ? depositAmount === "" : depositAmount !== "");

  // -- list ------------------------------------------------------------------------------

  async function loadList(status: string): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly RepSettlementRow[]>(
      `distribution/settlements${status === "" ? "" : `?status=${status}`}`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onStatusFilterChange(status: string): void {
    setStatusFilter(status);
    void loadList(status);
  }

  // -- open ------------------------------------------------------------------------------

  async function openSettlement(): Promise<void> {
    if (!openReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("open");
    setError(null);
    const result = await bffFetch<RepSettlementRow>("distribution/settlements", {
      method: "POST",
      body: {
        salesRepId: repId,
        cashAccountId,
        vanWarehouseId: vanWarehouseId === "" ? null : vanWarehouseId,
        settlementDate,
        openingCash: openingCash === "" ? "0" : openingCash,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setOpenOpen(false);
    setRepId("");
    setCashAccountId("");
    setVanWarehouseId("");
    setOpeningCash("");
    setNotice(
      formatMessage(d.distSettlementsOpenedToast, {
        rep: result.data.salesRepName ?? repId,
        date: result.data.settlementDate,
      }),
    );
    await selectSettlement(result.data.id);
  }

  // -- detail ------------------------------------------------------------------------------

  async function selectSettlement(id: string): Promise<void> {
    setSelectedId(id);
    setDetailLoading(true);
    const result = await bffFetch<RepSettlementWithLines>(`distribution/settlements/${id}`);
    setDetailLoading(false);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    applyDetail(result.data);
  }

  function applyDetail(next: RepSettlementWithLines): void {
    setDetail(next);
    setCountedCash(next.countedCash ?? "");
    setVarianceReason(next.varianceReason ?? "");
  }

  async function refreshAfterAction(id: string, toast: string): Promise<void> {
    const result = await bffFetch<RepSettlementWithLines>(`distribution/settlements/${id}`);
    if (result.ok) {
      applyDetail(result.data);
      setRows((current) => current.map((row) => (row.id === id ? result.data : row)));
      setNotice(toast);
    }
  }

  async function countSettlement(): Promise<void> {
    if (selectedId === null || detail === null || !countReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("count");
    setError(null);
    const result = await bffFetch<RepSettlementRow>(`distribution/settlements/${selectedId}/count`, {
      method: "POST",
      body: {
        countedCash: countedCash === "" ? "0" : countedCash,
        varianceReason: previewNonZero ? varianceReason.trim() : undefined,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await refreshAfterAction(
      selectedId,
      formatMessage(d.distSettlementCountedToast, {
        variance: result.data.variance ?? "0",
        direction: localizedVarianceDirection(d, result.data.varianceDirection),
      }),
    );
  }

  async function approveSettlement(): Promise<void> {
    if (selectedId === null) return;
    setBusy("approve");
    setError(null);
    const result = await bffFetch<RepSettlementRow>(
      `distribution/settlements/${selectedId}/approve`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    await refreshAfterAction(selectedId, d.distSettlementApprovedToast);
  }

  async function postSettlement(): Promise<void> {
    if (selectedId === null || !postReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("post");
    setError(null);
    const result = await bffFetch<RepSettlementRow>(`distribution/settlements/${selectedId}/post`, {
      method: "POST",
      body: {
        depositAccountId: depositAccountId === "" ? null : depositAccountId,
        depositAmount: depositAmount === "" ? null : depositAmount,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPostOpen(false);
    setDepositAccountId("");
    setDepositAmount("");
    await refreshAfterAction(
      selectedId,
      formatMessage(d.distSettlementPostedToast, { no: result.data.settlementNo ?? result.data.id.slice(0, 8) }),
    );
  }

  async function cancelSettlement(): Promise<void> {
    if (selectedId === null || cancelReason.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("cancel");
    setError(null);
    const result = await bffFetch<RepSettlementRow>(
      `distribution/settlements/${selectedId}/cancel`,
      { method: "POST", body: { reason: cancelReason.trim() } },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedDistributionError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCancelOpen(false);
    setCancelReason("");
    await refreshAfterAction(selectedId, d.distSettlementCancelledToast);
  }

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.distributionSettlementsTitle}
        actions={
          <Button variant="primary" onClick={() => setOpenOpen(true)}>
            {d.distSettlementsOpen}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={[
              { value: "", label: d.distSettlementAllStatuses },
              { value: "DRAFT", label: d.distSettlementDraft },
              { value: "COUNTED", label: d.distSettlementCounted },
              { value: "APPROVED", label: d.distSettlementApproved },
              { value: "POSTED", label: d.distSettlementPosted },
              { value: "CANCELLED", label: d.distSettlementCancelled },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "no",
                header: activeLocaleHeader(d.distSettlementsNo),
                accessor: (row) => row.settlementNo ?? "",
                mono: true,
                sortable: true,
                render: (row) =>
                  row.settlementNo === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.settlementNo}
                    </span>
                  ),
              },
              {
                id: "rep",
                header: activeLocaleHeader(d.distSettlementsRep),
                accessor: (row) => row.salesRepName ?? row.salesRepId,
              },
              {
                id: "date",
                header: activeLocaleHeader(d.distSettlementsDate),
                accessor: (row) => row.settlementDate,
                mono: true,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.settlementDate}
                  </span>
                ),
              },
              {
                id: "opening",
                header: activeLocaleHeader(d.distSettlementsOpening),
                accessor: (row) => row.openingCash,
                numeric: true,
                render: (row) => moneyCell(row.openingCash),
              },
              {
                id: "expected",
                header: activeLocaleHeader(d.distSettlementExpected),
                accessor: (row) => row.expectedCash,
                numeric: true,
                render: (row) => moneyCell(row.expectedCash === "" ? null : row.expectedCash),
              },
              {
                id: "counted",
                header: activeLocaleHeader(d.distSettlementCountedCash),
                accessor: (row) => row.countedCash ?? "",
                numeric: true,
                render: (row) => moneyCell(row.countedCash),
              },
              {
                id: "variance",
                header: activeLocaleHeader(d.distSettlementVariance),
                accessor: (row) => row.variance ?? "",
                numeric: true,
                render: (row) =>
                  row.variance === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Badge tone={row.varianceDirection === "SHORTAGE" ? undefined : "primary"}>
                        {localizedVarianceDirection(d, row.varianceDirection)}
                      </Badge>
                      <span className="font-mono tabular-nums" dir="ltr">
                        {formatMoneyDisplay(row.variance, 2)}
                      </span>
                    </span>
                  ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "DRAFT" ? "primary" : undefined}>
                    {localizedSettlementStatus(d, row.status)}
                  </Badge>
                ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "open",
                label: d.commonOpen,
                onSelect: (row) => {
                  void selectSettlement(row.id);
                },
              },
            ]}
            empty={{ title: d.distSettlementsEmpty }}
          />
        </div>
      </Card>

      {detail !== null && (
        <Card
          title={`${d.distSettlementDetail} · ${detail.salesRepName ?? detail.salesRepId} · ${detail.settlementDate}`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={detail.status === "DRAFT" ? "primary" : undefined}>
                {localizedSettlementStatus(d, detail.status)}
              </Badge>
              {detail.approvalRequired && <Badge tone="primary">{d.distSettlementApprovalBadge}</Badge>}
              {detail.vanWarehouseCode !== null && (
                <span className="text-sm text-gray-600" dir="ltr">
                  {detail.vanWarehouseCode}
                </span>
              )}
              {detail.shiftNo !== null && (
                <span className="text-sm text-gray-600">
                  {d.distSettlementShift}: <span dir="ltr">{detail.shiftNo}</span>
                </span>
              )}
            </div>

            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                [d.distSettlementsOpening, detail.openingCash],
                [d.distSettlementCashSales, detail.cashSales],
                [d.distSettlementCollections, detail.collections],
                [d.distSettlementRefunds, detail.cashRefunds],
                [d.distSettlementExpenses, detail.repExpenses],
                [d.distSettlementExpected, detail.expectedCash],
                [d.distSettlementCountedCash, detail.countedCash ?? "—"],
                [d.distSettlementVariance, detail.variance ?? "—"],
                [d.distSettlementVarianceReason, detail.varianceReason ?? "—"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-md border border-subtle bg-surface-sunken px-3 py-2"
                >
                  <dt className="text-xs text-gray-600">{label}</dt>
                  <dd className="mt-0.5 font-mono tabular-nums" dir="ltr">
                    {formatMoneyDisplay(String(value), 2)}
                  </dd>
                </div>
              ))}
            </dl>

            <div>
              <h3 className="text-sm font-semibold text-gray-900">{d.distSettlementLines}</h3>
              {detail.lines.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">—</p>
              ) : (
                <table className="mt-2 w-full text-sm" aria-label={d.distSettlementLines}>
                  <thead>
                    <tr className="border-b border-subtle text-xs text-gray-600">
                      <th scope="col" className="px-2 py-1 text-start">{d.distSettlementLineNo}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.distSettlementComponent}</th>
                      <th scope="col" className="px-2 py-1 text-start">{d.distSettlementDescription}</th>
                      <th scope="col" className="px-2 py-1 text-end">{d.distSettlementAmount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr key={line.id} className="border-b border-subtle">
                        <td className="px-2 py-1.5 font-mono" dir="ltr">
                          {line.lineNo}
                        </td>
                        <td className="px-2 py-1.5">
                          {localizedSettlementComponent(d, line.component)}
                        </td>
                        <td className="px-2 py-1.5">
                          {locale === "ar" && line.descriptionAr !== null
                            ? line.descriptionAr
                            : (line.description ?? "—")}
                        </td>
                        <td className="px-2 py-1.5 text-end font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(line.amount, 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {(detail.status === "DRAFT" || detail.status === "COUNTED") && (
              <fieldset className="rounded-md border border-subtle p-3">
                <legend className="text-sm font-semibold text-gray-900">
                  {d.distSettlementCountAction}
                </legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <MoneyInput
                    label={d.distSettlementCountedCash}
                    amount={countedCash}
                    onAmountChange={setCountedCash}
                    currency={repCurrency}
                  />
                  <Input
                    label={d.distSettlementVarianceReason}
                    value={varianceReason}
                    onValueChange={setVarianceReason}
                    error={previewNonZero && varianceReason.trim() === "" ? d.distErrSettlementVarianceReason : undefined}
                  />
                </div>
                {countedPreview !== null && (
                  <p className="mt-2 flex items-center gap-2 text-sm" aria-live="polite">
                    <span className="text-gray-600">{d.distSettlementVariance}:</span>
                    <Badge tone={previewDirection === "SHORTAGE" ? undefined : "primary"}>
                      {localizedVarianceDirection(d, previewDirection)}
                    </Badge>
                    <span className="font-mono tabular-nums" dir="ltr">
                      {formatMoneyDisplay(countedPreview, 2)}
                    </span>
                  </p>
                )}
                <div className="mt-3">
                  <Button
                    variant="primary"
                    loading={busy === "count"}
                    disabled={!countReady}
                    onClick={() => void countSettlement()}
                  >
                    {d.distSettlementCountAction}
                  </Button>
                </div>
              </fieldset>
            )}

            <div className="flex flex-wrap gap-2">
              {detail.status === "COUNTED" && detail.approvalRequired && (
                <Button
                  variant="primary"
                  loading={busy === "approve"}
                  onClick={() => void approveSettlement()}
                >
                  {d.distSettlementApproveAction}
                </Button>
              )}
              {(detail.status === "COUNTED" || detail.status === "APPROVED") && (
                <Button variant="primary" onClick={() => setPostOpen(true)}>
                  {d.distSettlementPostAction}
                </Button>
              )}
              {detail.status !== "POSTED" && detail.status !== "CANCELLED" && (
                <Button variant="danger" onClick={() => setCancelOpen(true)}>
                  {d.distSettlementCancelAction}
                </Button>
              )}
              <Button variant="ghost" onClick={() => { setDetail(null); setSelectedId(null); }}>
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {detailLoading && selectedId !== null && detail === null && (
        <Card title={d.distSettlementDetail}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      {/* -- open settlement dialog -------------------------------------------------- */}
      <Dialog open={openOpen} onOpenChange={setOpenOpen} title={d.distSettlementsOpen}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.distSettlementsRep}
            value={repId}
            onValueChange={setRepId}
            placeholder="—"
            options={activeReps.map((rep) => ({
              value: rep.id,
              label: repLabelById.get(rep.id) ?? rep.code,
            }))}
            required
          />
          <Select
            label={d.distSettlementsCashAccount}
            value={cashAccountId}
            onValueChange={setCashAccountId}
            placeholder="—"
            options={repCashAccounts.map((account) => ({
              value: account.id,
              label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
            }))}
            required
          />
          <Select
            label={d.distSettlementsVan}
            value={vanWarehouseId}
            onValueChange={setVanWarehouseId}
            placeholder="—"
            options={activeVans.map((van) => ({
              value: van.id,
              label: `${localizedName(van.name, van.nameAr, locale)} · ${van.code}`,
            }))}
          />
          <DatePicker
            locale={locale}
            label={d.distSettlementsDate}
            value={settlementDate}
            onSelect={setSettlementDate}
            required
          />
          <MoneyInput
            label={d.distSettlementsOpening}
            amount={openingCash}
            onAmountChange={setOpeningCash}
            currency={currencyByAccount.get(cashAccountId) ?? "SAR"}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpenOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "open"}
            disabled={!openReady}
            onClick={() => void openSettlement()}
          >
            {d.commonOpen}
          </Button>
        </div>
      </Dialog>

      {/* -- post dialog ------------------------------------------------------------- */}
      <Dialog open={postOpen} onOpenChange={setPostOpen} title={d.distSettlementPostAction}>
        <p className="text-sm text-gray-600">{d.distSettlementDepositHint}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Select
            label={d.distSettlementDepositAccount}
            value={depositAccountId}
            onValueChange={setDepositAccountId}
            placeholder="—"
            options={depositAccounts.map((account) => ({
              value: account.id,
              label: `${localizedName(account.name, account.nameAr, locale)} · ${account.currencyCode}`,
            }))}
          />
          <MoneyInput
            label={d.distSettlementDepositAmount}
            amount={depositAmount}
            onAmountChange={setDepositAmount}
            currency={repCurrency}
            error={depositValid ? undefined : d.errorsValidation}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPostOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "post"}
            disabled={!postReady}
            onClick={() => void postSettlement()}
          >
            {d.distSettlementPostAction}
          </Button>
        </div>
      </Dialog>

      {/* -- cancel dialog ------------------------------------------------------------ */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title={d.distSettlementCancelAction}>
        <Input
          label={d.distSettlementCancelReason}
          value={cancelReason}
          onValueChange={setCancelReason}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCancelOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "cancel"}
            disabled={cancelReason.trim() === ""}
            onClick={() => void cancelSettlement()}
          >
            {d.distSettlementCancelAction}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

/** A canonical non-negative decimal (≤ 4dp) — the MONEY wire shape. */
function countedValid(value: string): boolean {
  return value === "" || /^\d+(\.\d{1,4})?$/.test(value);
}
