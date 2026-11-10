"use client";

/**
 * P6-T11b — opening-balance console (DRAFT capture only): tabs by kind
 * (PARTNER / ACCOUNT / STOCK), each with the drafts list (target label via
 * the server-seeded id→name maps) and the create form — PARTNER →
 * PartnerPicker + amount; ACCOUNT → account UUID input (the account tree
 * lands with accounting — no fetch is invented); STOCK → ItemPicker + qty +
 * unit cost. POST `partners/opening-balances`; duplicates (one draft per
 * target) surface the localized error. No posting at this phase.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Input,
  ItemPicker,
  MoneyInput,
  NumberInput,
  PartnerPicker,
  Tabs,
  formatMoneyDisplay,
  useToast,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemRow, OpeningBalanceDocRow, OpeningBalanceKind, PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedMasterDataError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice } from "./notices";
import { useItemPickerOptions, usePartnerPickerOptions } from "./picker-data";
import { activeLocaleHeader } from "./table-header";

const PAGE_LIMIT = 25;

export function OpeningBalancesPanel({
  locale,
  initialRows,
  initialHasMore,
  initialNextCursor,
  partners,
  items,
}: {
  locale: Locale;
  initialRows: readonly OpeningBalanceDocRow[];
  initialHasMore: boolean;
  initialNextCursor?: string;
  partners: readonly PartnerRow[];
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const partnerPicker = usePartnerPickerOptions(locale, 100);
  const itemPicker = useItemPickerOptions(locale, 100);

  const [kind, setKind] = useState<OpeningBalanceKind>("PARTNER");
  const [rows, setRows] = useState<readonly OpeningBalanceDocRow[]>(initialRows);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialNextCursor);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef(0);
  const skipTabLoad = useRef(true);

  // -- create form state (shared across kinds) ------------------------------
  const [partnerId, setPartnerId] = useState<string>("");
  const [accountId, setAccountId] = useState<string>("");
  const [itemId, setItemId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Server-seeded id → label maps (target column never flashes "unknown").
  const partnerLabels = new Map(
    partners.map((partner) => [
      partner.id,
      `${localizedName(partner.name, partner.nameAr, locale)} · ${partner.code}`,
    ]),
  );
  const itemLabels = new Map(
    items.map((item) => [item.id, `${localizedName(item.name, item.nameAr, locale)} · ${item.sku}`]),
  );

  const loadPage = useCallback(
    async (kindValue: OpeningBalanceKind, cursor: string | undefined): Promise<void> => {
      const run = runRef.current + 1;
      runRef.current = run;
      setBusy(true);
      setError(null);
      const search = new URLSearchParams({ kind: kindValue, limit: String(PAGE_LIMIT) });
      if (cursor !== undefined && cursor !== "") {
        search.set("cursor", cursor);
      }
      const result = await bffFetch<readonly OpeningBalanceDocRow[]>(
        `partners/opening-balances?${search.toString()}`,
      );
      if (run !== runRef.current) {
        return; // stale response — a newer tab/page superseded it
      }
      setBusy(false);
      if (!result.ok) {
        setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setRows(result.data);
      setHasMore(result.meta?.hasMore ?? false);
      setNextCursor(result.meta?.nextCursor);
    },
    [d],
  );

  // Tab changes reset to page one for that kind. The server page already
  // fetched the initial tab's first page — the first run is a no-op.
  useEffect(() => {
    if (skipTabLoad.current) {
      skipTabLoad.current = false;
      return;
    }
    setCursorStack([]);
    void loadPage(kind, undefined);
  }, [kind, loadPage]);

  function targetLabel(row: OpeningBalanceDocRow): string {
    if (row.kind === "PARTNER" && row.partnerId !== null) {
      return partnerLabels.get(row.partnerId) ?? d.obTargetUnknown;
    }
    if (row.kind === "ACCOUNT" && row.accountId !== null) {
      return row.accountId;
    }
    if (row.kind === "STOCK" && row.itemId !== null) {
      return itemLabels.get(row.itemId) ?? d.obTargetUnknown;
    }
    return d.obTargetUnknown;
  }

  async function onCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError(null);
    const body: Record<string, unknown> = { kind };
    if (kind === "PARTNER") {
      if (partnerId === "" || amount.trim() === "") {
        setCreateError(d.errorsValidation);
        return;
      }
      body.partnerId = partnerId;
      body.amount = amount.trim();
    } else if (kind === "ACCOUNT") {
      if (accountId.trim() === "" || amount.trim() === "") {
        setCreateError(d.errorsValidation);
        return;
      }
      body.accountId = accountId.trim();
      body.amount = amount.trim();
    } else {
      if (itemId === "" || qty.trim() === "" || unitCost.trim() === "") {
        setCreateError(d.errorsValidation);
        return;
      }
      body.itemId = itemId;
      body.qty = qty.trim();
      body.unitCost = unitCost.trim();
    }
    if (note.trim() !== "") body.note = note.trim();
    setCreateBusy(true);
    const created = await bffFetch<OpeningBalanceDocRow>("partners/opening-balances", {
      method: "POST",
      body,
    });
    setCreateBusy(false);
    if (!created.ok) {
      setCreateError(localizedMasterDataError(d, created.error, created.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.obCreatedToast });
    setAmount("");
    setQty("");
    setUnitCost("");
    setNote("");
    setCursorStack([]);
    await loadPage(kind, undefined);
  }

  return (
    <Tabs
      value={kind}
      onValueChange={(value) => {
        const next = value === "ACCOUNT" || value === "STOCK" ? value : "PARTNER";
        setKind(next as OpeningBalanceKind);
      }}
      items={[
        { value: "PARTNER", label: d.obTabPartner },
        { value: "ACCOUNT", label: d.obTabAccount },
        { value: "STOCK", label: d.obTabStock },
      ]}
      className="flex flex-col gap-4"
    >
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title={d.obListTitle} ariaLabel={d.obListTitle}>
          {error !== null && <ErrorNotice>{error}</ErrorNotice>}
          <DataTable
            columns={[
              {
                id: "target",
                header: activeLocaleHeader(d.obColTarget),
                accessor: (row) => targetLabel(row),
                render: (row) =>
                  row.kind === "ACCOUNT" ? (
                    <span className="font-mono text-xs">{targetLabel(row)}</span>
                  ) : (
                    targetLabel(row)
                  ),
              },
              {
                id: "amount",
                header: activeLocaleHeader(d.obColAmount),
                accessor: (row) => row.amount ?? "",
                numeric: true,
                render: (row) =>
                  row.amount === null || row.amount === "" ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono">{formatMoneyDisplay(row.amount, 2)}</span>
                  ),
              },
              {
                id: "qty",
                header: activeLocaleHeader(d.obColQty),
                accessor: (row) => row.qty ?? "",
                numeric: true,
                render: (row) => {
                  if (row.qty === null || row.qty === "") {
                    return <span className="text-gray-500">—</span>;
                  }
                  const costSuffix =
                    row.unitCost !== null && row.unitCost !== ""
                      ? formatMessage(d.obQtyAtCostLabel, { qty: row.qty, cost: row.unitCost })
                      : row.qty;
                  return <span className="font-mono">{costSuffix}</span>;
                },
              },
              {
                id: "note",
                header: activeLocaleHeader(d.obColNote),
                accessor: (row) => row.note ?? "",
                render: (row) =>
                  row.note === null || row.note === "" ? <span className="text-gray-500">—</span> : row.note,
              },
              {
                id: "status",
                header: activeLocaleHeader(d.colStatus),
                accessor: (row) => row.status,
                render: () => <Badge tone="neutral">{d.statusDraft}</Badge>,
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            loading={busy && rows.length === 0}
            empty={{ title: d.obEmpty }}
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            {cursorStack.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const previous = cursorStack.slice(0, -1);
                  setCursorStack(previous);
                  void loadPage(kind, previous[previous.length - 1]);
                }}
              >
                {d.listPrevPage}
              </Button>
            )}
            {hasMore && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setCursorStack((stack) => [...stack, nextCursor]);
                  void loadPage(kind, nextCursor);
                }}
              >
                {d.listNextPage}
              </Button>
            )}
          </div>
        </Card>

        <Card title={d.obCreateTitle} ariaLabel={d.obCreateTitle}>
          <form onSubmit={onCreate} noValidate className="flex flex-col gap-4">
            {kind === "PARTNER" && (
              <PartnerPicker
                label={d.obTabPartner}
                items={partnerPicker.options}
                value={partnerId}
                onSelect={setPartnerId}
                onSearch={partnerPicker.onSearch}
                loading={partnerPicker.loading}
                placeholder={d.partnerPickerPlaceholder}
                emptyText={d.pickerEmptyText}
                required
              />
            )}
            {kind === "ACCOUNT" && (
              <Input
                id="ob-account-id"
                label={d.obAccountLabel}
                hint={d.obAccountHint}
                value={accountId}
                onValueChange={setAccountId}
                mono
                bidiIsolate
                required
              />
            )}
            {kind === "STOCK" && (
              <ItemPicker
                label={d.priceListRowItemLabel}
                items={itemPicker.options}
                value={itemId}
                onSelect={setItemId}
                onSearch={itemPicker.onSearch}
                loading={itemPicker.loading}
                placeholder={d.itemPickerPlaceholder}
                emptyText={d.pickerEmptyText}
                required
              />
            )}
            {(kind === "PARTNER" || kind === "ACCOUNT") && (
              <MoneyInput
                id="ob-amount"
                label={d.obAmountLabel}
                amount={amount}
                onAmountChange={setAmount}
                currency="SAR"
                required
              />
            )}
            {kind === "STOCK" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberInput
                  id="ob-qty"
                  label={d.obQtyLabel}
                  value={qty}
                  onValueChange={setQty}
                  min={0}
                  required
                />
                <MoneyInput
                  id="ob-unit-cost"
                  label={d.obUnitCostLabel}
                  amount={unitCost}
                  onAmountChange={setUnitCost}
                  currency="SAR"
                  required
                />
              </div>
            )}
            <Input
              id="ob-note"
              label={d.obNoteLabel}
              value={note}
              onValueChange={setNote}
            />
            {createError !== null && <ErrorNotice>{createError}</ErrorNotice>}
            <div className="flex items-center justify-end border-t border-subtle pt-3">
              <Button type="submit" variant="primary" loading={createBusy}>
                {d.obCreateSubmit}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </Tabs>
  );
}
