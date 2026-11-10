"use client";

/**
 * T14-UI (PHASE-008) — the allocation panel (INV-016): after the partner is
 * chosen the editor loads that partner's open items (AR for receipts / AP
 * for payments), offers the FIFO suggestion (GET allocations/suggest), and
 * keeps an editable checkbox + amount row per item with the live totals bar
 * (allocated vs amount vs on-account remainder — exact string math). Shared
 * by the new-document form (in-memory draft the parent saves after create)
 * and the document detail (PUT treasury/{kind}/:id/allocations).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, Checkbox, MoneyInput, formatMoneyDisplay } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { AllocationRow, OpenItemRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedTreasuryError } from "../lib/messages";
import { addExact, compareExact, isZeroExact, subtractExact } from "../lib/exact-money";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

export interface AllocationDraft {
  openItemId: string;
  amount: string;
}

export function TreasuryAllocationEditor({
  locale,
  docKind,
  side,
  partnerId,
  docId,
  amount,
  currency,
  onAllocationsChange,
  onSaved,
  readOnly = false,
}: {
  locale: Locale;
  /** "receipts" | "payments" — the wire path segment. */
  docKind: "receipts" | "payments";
  /** AR for receipts, AP for payments. */
  side: "AR" | "AP";
  partnerId: string;
  /** Present in detail mode — existing allocations load + the save action. */
  docId?: string;
  amount: string;
  currency: string;
  /** Draft-mode callback (the parent saves after the document is created). */
  onAllocationsChange?: (allocations: AllocationDraft[]) => void;
  /** Detail-mode callback after a successful PUT. */
  onSaved?: (rows: readonly AllocationRow[]) => void;
  readOnly?: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const [openItems, setOpenItems] = useState<readonly OpenItemRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationDraft[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadItems = useCallback(
    async (withDocAllocations: boolean) => {
      if (partnerId === "") {
        setOpenItems([]);
        setAllocations([]);
        return;
      }
      setLoading(true);
      setError(null);
      const items = await bffFetch<readonly OpenItemRow[]>(
        `treasury/open-items?partnerId=${partnerId}&side=${side}`,
      );
      if (!items.ok) {
        setLoading(false);
        setError(localizedTreasuryError(d, items.error, items.retryAfterSeconds));
        return;
      }
      setOpenItems(items.data);
      if (withDocAllocations && docId !== undefined) {
        const existing = await bffFetch<readonly AllocationRow[]>(
          `treasury/${docKind}/${docId}/allocations`,
        );
        if (existing.ok) {
          const outstandingById = new Map(items.data.map((item) => [item.id, item.outstanding]));
          setAllocations(
            existing.data
              .map((row) => ({
                openItemId: row.openItemId,
                amount: row.amount,
              }))
              .filter((row) => outstandingById.has(row.openItemId)),
          );
        }
      }
      setLoading(false);
    },
    [d, docId, docKind, partnerId, side],
  );

  // Auto-load on partner change (draft mode) / first render (detail mode).
  // partnerId/side are the only changing inputs; docId is constant per page
  // (loadItems closes over the rest from this render).
  useEffect(() => {
    void loadItems(docId !== undefined);
  }, [partnerId, side]);

  const allocatedTotal = useMemo(
    () => addExact(allocations.reduce((sum, row) => addExact(sum, row.amount), "0"), "0"),
    [allocations],
  );
  const remainder = useMemo(
    () => subtractExact(amount === "" ? "0" : amount, allocatedTotal),
    [amount, allocatedTotal],
  );
  const overAllocated = compareExact(allocatedTotal, amount === "" ? "0" : amount) > 0;

  function updateAllocations(next: AllocationDraft[]): void {
    setAllocations(next);
    onAllocationsChange?.(next);
  }

  function toggleItem(item: OpenItemRow, checked: boolean): void {
    if (readOnly) {
      return;
    }
    const next = checked
      ? [...allocations, { openItemId: item.id, amount: item.outstanding }]
      : allocations.filter((row) => row.openItemId !== item.id);
    updateAllocations(next);
  }

  function setAmount(openItemId: string, value: string): void {
    updateAllocations(
      allocations.map((row) => (row.openItemId === openItemId ? { ...row, amount: value } : row)),
    );
  }

  async function applySuggestion(): Promise<void> {
    if (partnerId === "" || isZeroExact(amount === "" ? "0" : amount)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const suggested = await bffFetch<readonly { openItemId: string; amount: string }[]>(
      `treasury/allocations/suggest?partnerId=${partnerId}&side=${side}&amount=${amount}`,
    );
    setBusy(false);
    if (!suggested.ok) {
      setError(localizedTreasuryError(d, suggested.error, suggested.retryAfterSeconds));
      return;
    }
    updateAllocations(
      suggested.data.map((row) => ({ openItemId: row.openItemId, amount: row.amount })),
    );
    const count = suggested.data.filter((row) => !isZeroExact(row.amount)).length;
    setNotice(formatMessage(d.treasuryAllocationSuggestToast, { count }));
  }

  async function save(): Promise<void> {
    if (docId === undefined) {
      return;
    }
    setBusy(true);
    setError(null);
    const saved = await bffFetch<readonly AllocationRow[]>(
      `treasury/${docKind}/${docId}/allocations`,
      {
        method: "PUT",
        body: { allocations: allocations.map((row) => ({ openItemId: row.openItemId, amount: row.amount })) },
      },
    );
    setBusy(false);
    if (!saved.ok) {
      setError(localizedTreasuryError(d, saved.error, saved.retryAfterSeconds));
      return;
    }
    setNotice(d.treasuryAllocationSavedToast);
    onSaved?.(saved.data);
  }

  const amountOf = (openItemId: string): string =>
    allocations.find((row) => row.openItemId === openItemId)?.amount ?? "";

  return (
    <Card
      title={d.treasuryAllocationsTitle}
      description={d.treasuryAllocationsHint}
      ariaLabel={d.treasuryAllocationsTitle}
    >
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}
      {partnerId === "" ? (
        <p className="text-sm text-muted-foreground">{d.treasuryDocPartner} —</p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {d.loading}…
        </p>
      ) : openItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">{d.treasuryAllocationsEmpty}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void applySuggestion()}
                loading={busy}
                disabled={isZeroExact(amount === "" ? "0" : amount)}
              >
                {d.treasuryAllocationSuggestBtn}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void loadItems(docId !== undefined)}>
                {d.treasuryAllocationReloadBtn}
              </Button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-sm" aria-label={d.treasuryOpenItemsTitle}>
              <thead>
                <tr className="border-b text-start text-xs text-muted-foreground">
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {d.treasuryOpenItemsTitle}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {activeLocaleHeader(d.treasuryColValueDate).en}
                  </th>
                  <th scope="col" className="px-2 py-2 text-start font-medium">
                    {activeLocaleHeader(d.treasuryAllocationColOutstanding).en}
                  </th>
                  <th scope="col" className="px-2 py-2 text-end font-medium">
                    {activeLocaleHeader(d.treasuryColAmount).en}
                  </th>
                </tr>
              </thead>
              <tbody>
                {openItems.map((item) => {
                  const rowAmount = amountOf(item.id);
                  const included = rowAmount !== "";
                  const exceeds =
                    included && compareExact(rowAmount, item.outstanding) > 0;
                  return (
                    <tr key={item.id} className="border-b border-subtle last:border-0">
                      <td className="px-2 py-2">
                        {readOnly ? (
                          included ? (
                            <Badge tone="primary">{d.treasuryBankRecMatched}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : (
                          <Checkbox
                            checked={included}
                            onCheckedChange={(checked) => toggleItem(item, checked === true)}
                            label={
                              <span className="sr-only">{`${d.treasuryOpenItemsTitle}: ${item.memo ?? item.sourceType} ${item.entryDate}`}</span>
                            }
                          />
                        )}
                        <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
                          {item.sourceType}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-mono text-xs" dir="ltr">{item.entryDate}</span>
                      </td>
                      <td className="px-2 py-2 text-end">
                        <span className="font-mono tabular-nums" dir="ltr">
                          {formatMoneyDisplay(item.outstanding, 2)}{" "}
                          <span className="text-xs text-muted-foreground">{item.currencyCode}</span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-end">
                        {included ? (
                          readOnly ? (
                            <span className="font-mono tabular-nums" dir="ltr">
                              {formatMoneyDisplay(rowAmount, 2)}
                            </span>
                          ) : (
                            <div className="w-40 ms-auto">
                              <MoneyInput
                                amount={rowAmount}
                                onAmountChange={(value) => setAmount(item.id, value)}
                                currency={item.currencyCode}
                                max={item.outstanding}
                                error={exceeds ? d.treasuryErrAllocationExceedsItem : undefined}
                                ariaLabel={`${d.treasuryColAmount}: ${item.memo ?? item.sourceType}`}
                              />
                            </div>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-6">
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">{d.treasuryDocAmount}</span>
                <span className="font-mono text-sm tabular-nums" dir="ltr">
                  {formatMoneyDisplay(amount === "" ? "0" : amount, 2)} {currency}
                </span>
              </span>
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">{d.treasuryAllocationTotalAllocated}</span>
                <span
                  className={`font-mono text-sm tabular-nums ${overAllocated ? "text-finance-negative" : ""}`}
                  dir="ltr"
                >
                  {formatMoneyDisplay(allocatedTotal, 2)} {currency}
                </span>
              </span>
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">{d.treasuryDocOnAccount}</span>
                <span
                  className={`font-mono text-sm tabular-nums ${overAllocated ? "text-finance-negative" : ""}`}
                  dir="ltr"
                >
                  {formatMoneyDisplay(overAllocated ? "0" : remainder, 2)} {currency}
                </span>
              </span>
            </div>
            <span className="max-w-[16rem] text-xs text-muted-foreground">
              {overAllocated ? d.treasuryAllocationOverError : d.treasuryAllocationOnAccountHint}
            </span>
          </div>

          {docId !== undefined && !readOnly && (
            <Button
              variant="primary"
              onClick={() => void save()}
              loading={busy}
              disabled={overAllocated}
              className="self-start"
            >
              {d.treasuryAllocationSaveBtn}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
