"use client";

/**
 * P6-T11a — partner directory list (List+Search archetype): DataTable with
 * mono codes, bilingual names, kind Badge, formatted credit limit and status.
 * The server page fetches page one; the kind filter, debounced search and
 * cursor pagination re-fetch through the BFF client wrapper
 * (meta.hasMore/nextCursor from the paginated envelope).
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
import type { PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedMasterDataError, localizedName, statusTone } from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const PAGE_LIMIT = 25;

export function PartnersTable({
  locale,
  initialRows,
  initialHasMore,
  initialNextCursor,
}: {
  locale: Locale;
  initialRows: readonly PartnerRow[];
  initialHasMore: boolean;
  initialNextCursor?: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly PartnerRow[]>(initialRows);
  const [kind, setKind] = useState<string>("");
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
      if (appliedQuery !== "") {
        search.set("q", appliedQuery);
      }
      if (cursor !== undefined && cursor !== "") {
        search.set("cursor", cursor);
      }
      const result = await bffFetch<readonly PartnerRow[]>(`partners/partners?${search.toString()}`);
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
    [d, kind, appliedQuery],
  );

  // Filter/search changes reset to page one. The server page already fetched
  // the first page for the initial (empty) filters — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage(undefined, { pushHistory: false });
  }, [kind, appliedQuery, loadPage]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={(debounced) => setAppliedQuery(debounced.trim())}
            placeholder={d.partnersSearchPlaceholder}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-44">
          <Select
            id="partners-kind-filter"
            label={d.partnersKindLabel}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "CUSTOMER", label: d.kindCustomer },
              { value: "SUPPLIER", label: d.kindSupplier },
              { value: "BOTH", label: d.kindBoth },
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/partners/new`} variant="primary">
          {d.partnersNewButton}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.partnersColCode),
            accessor: (row) => row.code,
            mono: true,
            sortable: true,
            width: "9rem",
            render: (row) => (
              <a
                href={`/${locale}/partners/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
              >
                {row.code}
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
            header: activeLocaleHeader(d.kindLabel),
            accessor: (row) => row.kind,
            render: (row) => (
              <Badge tone="neutral">
                {row.kind === "CUSTOMER"
                  ? d.kindCustomer
                  : row.kind === "SUPPLIER"
                    ? d.kindSupplier
                    : d.kindBoth}
              </Badge>
            ),
          },
          {
            id: "creditLimit",
            header: activeLocaleHeader(d.partnersColCreditLimit),
            accessor: (row) => row.creditLimit ?? "",
            numeric: true,
            render: (row) =>
              row.creditLimit === null || row.creditLimit === "" ? (
                <span className="text-gray-500">—</span>
              ) : (
                formatMoneyDisplay(row.creditLimit, 2)
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
            onSelect: (row) => router.push(`/${locale}/partners/${row.id}`),
          },
        ]}
        empty={{ title: d.partnersEmpty }}
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
