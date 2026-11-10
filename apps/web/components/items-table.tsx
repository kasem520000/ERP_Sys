"use client";

/**
 * P6-T11b — item master list (List+Search archetype): DataTable with mono
 * SKU, bilingual names, kind Badge, category, base price and status; kind +
 * category filters and debounced search re-fetch through the BFF wrapper
 * (paginated envelope meta drives the cursor buttons).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  SearchInput,
  Select,
  formatMoneyDisplay,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ItemCategoryRow, ItemRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError, localizedName, statusTone } from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const PAGE_LIMIT = 25;

export function ItemsTable({
  locale,
  initialRows,
  initialHasMore,
  initialNextCursor,
  categories,
}: {
  locale: Locale;
  initialRows: readonly ItemRow[];
  initialHasMore: boolean;
  initialNextCursor?: string;
  categories: readonly ItemCategoryRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly ItemRow[]>(initialRows);
  const [kind, setKind] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialNextCursor);
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const runRef = useRef(0);
  const skipInitialLoad = useRef(true);

  const loadPage = useCallback(
    async (cursor: string | undefined, options: { pushHistory: boolean }): Promise<void> => {
      const run = runRef.current + 1;
      runRef.current = run;
      setBusy(true);
      setError(null);
      const search = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (kind !== "") {
        search.set("kind", kind);
      }
      if (categoryId !== "") {
        search.set("categoryId", categoryId);
      }
      if (appliedQuery !== "") {
        search.set("q", appliedQuery);
      }
      if (cursor !== undefined && cursor !== "") {
        search.set("cursor", cursor);
      }
      const result = await bffFetch<readonly ItemRow[]>(`items/items?${search.toString()}`);
      if (run !== runRef.current) {
        return; // stale response — a newer filter/search superseded it
      }
      setBusy(false);
      if (!result.ok) {
        setError(localizedMasterDataError(d, result.error, result.retryAfterSeconds));
        return;
      }
      setRows(result.data);
      setHasMore(result.meta?.hasMore ?? false);
      setNextCursor(result.meta?.nextCursor);
      if (options.pushHistory) {
        setCursorStack((stack) => [...stack, cursor]);
      }
    },
    [d, kind, categoryId, appliedQuery],
  );

  // Filter/search changes reset to page one. The server page already fetched
  // the first page for the initial (empty) filters — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage(undefined, { pushHistory: false });
  }, [kind, categoryId, appliedQuery, loadPage]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={(debounced) => setAppliedQuery(debounced.trim())}
            placeholder={d.itemsSearchPlaceholder}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-44">
          <Select
            id="items-kind-filter"
            label={d.itemKindLabel}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "STOCK", label: d.kindStock },
              { value: "SERVICE", label: d.kindService },
              { value: "COMPOSITE", label: d.kindComposite },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="items-category-filter"
            label={d.itemsFilterCategoryLabel}
            value={categoryId}
            onValueChange={setCategoryId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...categories.map((category) => ({
                value: category.id,
                label: localizedName(category.name, category.nameAr, locale),
              })),
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/inventory/items/new`} variant="primary">
          {d.itemsNewButton}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "sku",
            header: activeLocaleHeader(d.itemsColSku),
            accessor: (row) => row.sku,
            mono: true,
            sortable: true,
            width: "10rem",
            render: (row) => (
              <a
                href={`/${locale}/inventory/items/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
              >
                {row.sku}
              </a>
            ),
          },
          {
            id: "name",
            header: activeLocaleHeader(d.colName),
            accessor: (row) => localizedName(row.name, row.nameAr, locale),
            sortable: true,
            render: (row) => (
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{localizedName(row.name, row.nameAr, locale)}</span>
                {locale === "en" && row.nameAr !== null && row.nameAr !== "" && (
                  <span lang="ar" dir="rtl" className="truncate text-xs text-gray-500">
                    {row.nameAr}
                  </span>
                )}
              </span>
            ),
          },
          {
            id: "kind",
            header: activeLocaleHeader(d.itemKindLabel),
            accessor: (row) => row.kind,
            render: (row) => (
              <Badge tone="neutral">
                {row.kind === "STOCK"
                  ? d.kindStock
                  : row.kind === "SERVICE"
                    ? d.kindService
                    : d.kindComposite}
              </Badge>
            ),
          },
          {
            id: "category",
            header: activeLocaleHeader(d.categoryLabel),
            accessor: (row) => {
              const category = categories.find((entry) => entry.id === row.categoryId);
              return category === undefined ? "" : localizedName(category.name, category.nameAr, locale);
            },
            render: (row) => {
              const category = categories.find((entry) => entry.id === row.categoryId);
              return category === undefined ? (
                <span className="text-gray-500">—</span>
              ) : (
                localizedName(category.name, category.nameAr, locale)
              );
            },
          },
          {
            id: "basePrice",
            header: activeLocaleHeader(d.itemsColBasePrice),
            accessor: (row) => row.basePrice ?? "",
            numeric: true,
            render: (row) =>
              row.basePrice === null || row.basePrice === "" ? (
                <span className="text-gray-500">—</span>
              ) : (
                formatMoneyDisplay(row.basePrice, 2)
              ),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.colStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={statusTone(row.status)}>
                {row.status === "ARCHIVED"
                  ? d.statusArchived
                  : row.status === "INACTIVE"
                    ? d.statusInactive
                    : d.statusActive}
              </Badge>
            ),
          },
        ]}
        rows={[...rows]}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        loading={busy && rows.length === 0}
        rowActions={[
          {
            id: "open",
            label: d.commonOpen,
            onSelect: (row) => router.push(`/${locale}/inventory/items/${row.id}`),
          },
        ]}
        empty={{ title: d.itemsEmpty }}
      />
      <div className="flex items-center justify-end gap-2">
        {cursorStack.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              const previous = cursorStack.slice(0, -1);
              setCursorStack(previous);
              void loadPage(previous[previous.length - 1], { pushHistory: false });
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
              void loadPage(nextCursor, { pushHistory: true });
            }}
          >
            {d.listNextPage}
          </Button>
        )}
      </div>
    </div>
  );
}
