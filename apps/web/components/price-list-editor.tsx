"use client";

/**
 * P6-T11b — price-list workbench (two-pane List+Editor): the left pane owns
 * the lists table (SALE/PURCHASE filter + create form; currency is the
 * tenant base SAR at this phase), the right pane edits the selected list's
 * rows — ItemPicker + uom + unitPrice + minQty → POST price-lists/:id/items.
 * Existing rows label through the id→name map seeded from the server-fetched
 * first item page and extended by every picker search.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Input,
  ItemPicker,
  MoneyInput,
  NumberInput,
  Select,
  useToast,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemRow, PriceListItemRow, PriceListRow, UomRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice } from "./notices";
import { useItemPickerOptions } from "./picker-data";
import { activeLocaleHeader } from "./table-header";

export function PriceListEditor({
  locale,
  initialLists,
  initialHasMore,
  initialNextCursor,
  uoms,
  items,
}: {
  locale: Locale;
  initialLists: readonly PriceListRow[];
  initialHasMore: boolean;
  initialNextCursor?: string;
  uoms: readonly UomRow[];
  items: readonly ItemRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();
  const picker = useItemPickerOptions(locale, 100);

  // -- left pane: lists table ------------------------------------------------
  const [lists, setLists] = useState<readonly PriceListRow[]>(initialLists);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialNextCursor);

  // -- create form -----------------------------------------------------------
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [kind, setKind] = useState<string>("SALE");
  const [validFrom, setValidFrom] = useState<string | undefined>(undefined);
  const [validTo, setValidTo] = useState<string | undefined>(undefined);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // -- right pane: rows editor ------------------------------------------------
  const [selected, setSelected] = useState<PriceListRow | null>(null);
  const [rows, setRows] = useState<readonly PriceListItemRow[]>([]);
  const [rowsBusy, setRowsBusy] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowItemId, setRowItemId] = useState<string>("");
  const [rowUomId, setRowUomId] = useState<string>("");
  const [rowUnitPrice, setRowUnitPrice] = useState("");
  const [rowMinQty, setRowMinQty] = useState("1");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // id → display label, seeded from the server-fetched item page and grown
  // by every picker search result (rows can reference items outside page 1).
  const labelsRef = useRef(new Map<string, string>());
  useEffect(() => {
    for (const item of items) {
      labelsRef.current.set(
        item.id,
        `${localizedName(item.name, item.nameAr, locale)} · ${item.sku}`,
      );
    }
    for (const option of picker.options) {
      if (option.meta !== undefined) {
        labelsRef.current.set(option.id, `${option.label} · ${option.meta}`);
      }
    }
  }, [items, picker.options, locale]);
  const itemLabels = labelsRef.current;

  const loadLists = useCallback(
    async (kindValue: string, cursor?: string): Promise<void> => {
      setListBusy(true);
      setListError(null);
      const search = new URLSearchParams();
      if (kindValue !== "") {
        search.set("kind", kindValue);
      }
      if (cursor !== undefined && cursor !== "") {
        search.set("cursor", cursor);
      }
      const suffix = search.toString() === "" ? "" : `?${search.toString()}`;
      const result = await bffFetch<readonly PriceListRow[]>(`items/price-lists${suffix}`);
      setListBusy(false);
      if (!result.ok) {
        setListError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setLists(result.data);
      setHasMore(result.meta?.hasMore ?? false);
      setNextCursor(result.meta?.nextCursor);
    },
    [d],
  );

  const loadRows = useCallback(
    async (listId: string): Promise<void> => {
      setRowsBusy(true);
      setRowsError(null);
      const result = await bffFetch<readonly PriceListItemRow[]>(`items/price-lists/${listId}/items`);
      setRowsBusy(false);
      if (!result.ok) {
        setRowsError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setRows(result.data);
    },
    [d],
  );

  function onSelectList(list: PriceListRow): void {
    setSelected(list);
    setRows([]);
    setRowItemId("");
    setRowUomId("");
    setRowUnitPrice("");
    setRowMinQty("1");
    setAddError(null);
    void loadRows(list.id);
  }

  async function onCreateList(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError(null);
    if (name.trim() === "") {
      setCreateError(d.errorsValidation);
      return;
    }
    setCreateBusy(true);
    const body: Record<string, unknown> = {
      name: name.trim(),
      kind,
      currencyCode: "SAR",
    };
    if (nameAr.trim() !== "") body.nameAr = nameAr.trim();
    if (validFrom !== undefined) body.validFrom = validFrom;
    if (validTo !== undefined) body.validTo = validTo;
    const created = await bffFetch<PriceListRow>("items/price-lists", { method: "POST", body });
    setCreateBusy(false);
    if (!created.ok) {
      setCreateError(localizedMasterDataError(d, created.error, created.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.priceListCreatedToast });
    setName("");
    setNameAr("");
    setValidFrom(undefined);
    setValidTo(undefined);
    await loadLists(kindFilter);
    onSelectList(created.data);
  }

  async function onAddRow(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (selected === null) return;
    setAddError(null);
    if (rowItemId === "" || rowUomId === "" || rowUnitPrice.trim() === "") {
      setAddError(d.errorsValidation);
      return;
    }
    setAddBusy(true);
    const body: Record<string, unknown> = {
      itemId: rowItemId,
      uomId: rowUomId,
      unitPrice: rowUnitPrice.trim(),
    };
    if (rowMinQty.trim() !== "") body.minQty = rowMinQty.trim();
    const added = await bffFetch<PriceListItemRow>(`items/price-lists/${selected.id}/items`, {
      method: "POST",
      body,
    });
    setAddBusy(false);
    if (!added.ok) {
      setAddError(localizedMasterDataError(d, added.error, added.retryAfterSeconds));
      return;
    }
    toast({ tone: "success", title: d.priceListRowAddedToast });
    setRowItemId("");
    setRowUnitPrice("");
    setRowMinQty("1");
    await loadRows(selected.id);
  }

  const uomLabel = useCallback(
    (uomId: string): string => {
      const uom = uoms.find((entry) => entry.id === uomId);
      return uom === undefined ? "—" : `${localizedName(uom.name, uom.nameAr, locale)} (${uom.code})`;
    },
    [uoms, locale],
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <Card title={d.priceListsListTitle} ariaLabel={d.priceListsListTitle}>
          <div className="w-44">
            <Select
              id="price-lists-kind-filter"
              label={d.priceListKindLabel}
              value={kindFilter}
              onValueChange={(value) => {
                setKindFilter(value);
                void loadLists(value);
              }}
              options={[
                { value: "", label: d.kindFilterAll },
                { value: "SALE", label: d.priceListKindSale },
                { value: "PURCHASE", label: d.priceListKindPurchase },
              ]}
            />
          </div>
          {listError !== null && <ErrorNotice className="mt-3">{listError}</ErrorNotice>}
          <DataTable
            columns={[
              {
                id: "name",
                header: activeLocaleHeader(d.colName),
                accessor: (row) => localizedName(row.name, row.nameAr, locale),
              },
              {
                id: "kind",
                header: activeLocaleHeader(d.priceListKindLabel),
                accessor: (row) => row.kind,
                render: (row) => (
                  <Badge tone="neutral">
                    {row.kind === "SALE" ? d.priceListKindSale : d.priceListKindPurchase}
                  </Badge>
                ),
              },
              {
                id: "valid",
                header: activeLocaleHeader(d.priceListColValidLabel),
                accessor: (row) => `${row.validFrom ?? ""}…${row.validTo ?? ""}`,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-xs">
                    {row.validFrom ?? "—"} → {row.validTo ?? "—"}
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.colStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone="neutral">
                    {row.status === "ACTIVE" ? d.statusActive : d.statusInactive}
                  </Badge>
                ),
              },
            ]}
            rows={[...lists]}
            rowKey={(row) => row.id}
            loading={listBusy && lists.length === 0}
            rowActions={[
              {
                id: "open",
                label: d.commonOpen,
                onSelect: (row) => onSelectList(row),
              },
            ]}
            empty={{ title: d.priceListsEmpty }}
          />
          {hasMore && (
            <div className="mt-3 flex items-center justify-end">
              <Button
                variant="secondary"
                size="sm"
                disabled={listBusy}
                onClick={() => {
                  void loadLists(kindFilter, nextCursor);
                }}
              >
                {d.listNextPage}
              </Button>
            </div>
          )}
        </Card>
        <Card title={d.priceListCreateTitle} ariaLabel={d.priceListCreateTitle}>
          <form onSubmit={onCreateList} noValidate className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-4">
                <Input
                  id="price-list-name"
                  label={d.priceListNameLabel}
                  value={name}
                  onValueChange={setName}
                  required
                />
                <Input
                  id="price-list-name-ar"
                  label={d.priceListNameArLabel}
                  value={nameAr}
                  onValueChange={setNameAr}
                />
              </div>
              <div className="flex flex-col gap-4">
                <Select
                  id="price-list-kind"
                  label={d.priceListKindLabel}
                  value={kind}
                  onValueChange={setKind}
                  options={[
                    { value: "SALE", label: d.priceListKindSale },
                    { value: "PURCHASE", label: d.priceListKindPurchase },
                  ]}
                  required
                />
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium text-gray-700">{d.priceListCurrencyLabel}</span>
                  <Badge tone="neutral" mono bidiIsolate>
                    {d.priceListCurrencySar}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DatePicker
                id="price-list-valid-from"
                locale={locale}
                label={d.priceListValidFromLabel}
                value={validFrom}
                onSelect={setValidFrom}
              />
              <DatePicker
                id="price-list-valid-to"
                locale={locale}
                label={d.priceListValidToLabel}
                value={validTo}
                onSelect={setValidTo}
                min={validFrom}
              />
            </div>
            {(validFrom !== undefined || validTo !== undefined) && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setValidFrom(undefined);
                    setValidTo(undefined);
                  }}
                >
                  {d.commonClear}
                </Button>
              </div>
            )}
            {createError !== null && <ErrorNotice>{createError}</ErrorNotice>}
            <div className="flex items-center justify-end border-t border-subtle pt-3">
              <Button type="submit" variant="primary" loading={createBusy}>
                {d.priceListCreateSubmit}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card
        title={d.priceListRowsTitle}
        ariaLabel={d.priceListRowsTitle}
      >
        {selected === null ? (
          <p className="text-sm text-gray-600">{d.priceListSelectHint}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <DefList
              items={[
                {
                  term: d.colName,
                  children: localizedName(selected.name, selected.nameAr, locale),
                },
                {
                  term: d.priceListKindLabel,
                  children: (
                    <Badge tone="neutral">
                      {selected.kind === "SALE" ? d.priceListKindSale : d.priceListKindPurchase}
                    </Badge>
                  ),
                },
                {
                  term: d.priceListCurrencyLabel,
                  children: <Badge tone="neutral" mono bidiIsolate>{selected.currencyCode}</Badge>,
                },
                {
                  term: d.priceListColValidLabel,
                  children: (
                    <span className="font-mono text-xs">
                      {selected.validFrom ?? "—"} → {selected.validTo ?? "—"}
                    </span>
                  ),
                },
              ]}
            />
            {rowsError !== null && <ErrorNotice>{rowsError}</ErrorNotice>}
            <DataTable
              columns={[
                {
                  id: "item",
                  header: activeLocaleHeader(d.priceListRowItemLabel),
                  accessor: (row) => itemLabels.get(row.itemId) ?? "",
                  render: (row) => itemLabels.get(row.itemId) ?? <span className="text-gray-500">—</span>,
                },
                {
                  id: "uom",
                  header: activeLocaleHeader(d.priceListRowUomLabel),
                  accessor: (row) => uomLabel(row.uomId),
                },
                {
                  id: "unitPrice",
                  header: activeLocaleHeader(d.priceListRowPriceLabel),
                  accessor: (row) => row.unitPrice,
                  numeric: true,
                  mono: true,
                },
                {
                  id: "minQty",
                  header: activeLocaleHeader(d.priceListRowMinQtyLabel),
                  accessor: (row) => row.minQty,
                  numeric: true,
                  mono: true,
                },
              ]}
              rows={[...rows]}
              rowKey={(row) => row.id}
              loading={rowsBusy && rows.length === 0}
              empty={{ title: d.priceListRowsEmpty }}
            />
            <form onSubmit={onAddRow} noValidate className="flex flex-col gap-3 border-t border-subtle pt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <ItemPicker
                  label={d.priceListRowItemLabel}
                  items={picker.options}
                  value={rowItemId}
                  onSelect={setRowItemId}
                  onSearch={picker.onSearch}
                  loading={picker.loading}
                  placeholder={d.itemPickerPlaceholder}
                  emptyText={d.pickerEmptyText}
                  required
                />
                <Select
                  id="price-row-uom"
                  label={d.priceListRowUomLabel}
                  value={rowUomId}
                  onValueChange={setRowUomId}
                  options={uoms.map((uom) => ({
                    value: uom.id,
                    label: `${localizedName(uom.name, uom.nameAr, locale)} (${uom.code})`,
                  }))}
                  required
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MoneyInput
                  id="price-row-unit-price"
                  label={d.priceListRowPriceLabel}
                  amount={rowUnitPrice}
                  onAmountChange={setRowUnitPrice}
                  currency="SAR"
                  required
                />
                <NumberInput
                  id="price-row-min-qty"
                  label={d.priceListRowMinQtyLabel}
                  value={rowMinQty}
                  onValueChange={setRowMinQty}
                  min={0}
                />
              </div>
              {addError !== null && <ErrorNotice>{addError}</ErrorNotice>}
              <div className="flex items-center justify-end">
                <Button type="submit" variant="primary" loading={addBusy}>
                  {d.priceListRowAdd}
                </Button>
              </div>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
}
