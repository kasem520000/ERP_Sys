"use client";

/**
 * PHASE-026 (T13-UI) — the asset register list (PAGE_ARCHETYPES §2,
 * List+Search — the items-table pattern): debounced search (code/name),
 * category/branch/status/custodian filters, the register table (code, name,
 * category, acquisition date, cost, accumulated, NBV, status badge) with
 * row-open navigation to the asset detail. All amounts are canonical
 * decimal strings through formatMoneyDisplay (ADR-0009); numeric cells stay
 * LTR-isolated inside the RTL grid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  DataTable,
  SearchInput,
  Select,
  formatMoneyDisplay,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BranchRow, FixedAssetCategoryRow, FixedAssetListRow, TenantUserRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedAssetStatus,
  localizedFixedAssetsError,
} from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const PAGE_LIMIT = 25;

export function FixedAssetsTable({
  locale,
  initialRows,
  categories,
  branches,
  users,
}: {
  locale: Locale;
  initialRows: readonly FixedAssetListRow[];
  categories: readonly FixedAssetCategoryRow[];
  branches: readonly BranchRow[];
  users: readonly TenantUserRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly FixedAssetListRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");
  const [custodianUserId, setCustodianUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const runRef = useRef(0);
  const skipInitialLoad = useRef(true);

  const loadPage = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    setBusy(true);
    setError(null);
    const search = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (appliedQuery !== "") {
      search.set("search", appliedQuery);
    }
    if (categoryId !== "") {
      search.set("categoryId", categoryId);
    }
    if (branchId !== "") {
      search.set("branchId", branchId);
    }
    if (status !== "") {
      search.set("status", status);
    }
    if (custodianUserId !== "") {
      search.set("custodianUserId", custodianUserId);
    }
    const result = await bffFetch<readonly FixedAssetListRow[]>(
      `fixed-assets/assets?${search.toString()}`,
    );
    if (run !== runRef.current) {
      return; // stale response — a newer filter/search superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedFixedAssetsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, appliedQuery, categoryId, branchId, status, custodianUserId]);

  // Filter/search changes reload the first page. The server page already
  // fetched the initial (empty-filter) rows — the first run is a no-op.
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  const categoryById = (id: string): FixedAssetCategoryRow | undefined =>
    categories.find((category) => category.id === id);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            onDebouncedChange={(debounced) => setAppliedQuery(debounced.trim())}
            placeholder={d.faSearchPlaceholder}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-52">
          <Select
            id="fa-filter-category"
            label={d.faFilterCategory}
            value={categoryId}
            onValueChange={setCategoryId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...categories.map((category) => ({
                value: category.id,
                label: `${category.code} · ${localizedName(category.name, category.nameAr, locale)}`,
              })),
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            id="fa-filter-branch"
            label={d.faFilterBranch}
            value={branchId}
            onValueChange={setBranchId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...branches
                .filter((branch) => branch.isActive)
                .map((branch) => ({
                  value: branch.id,
                  label: localizedName(branch.name, branch.nameAr, locale),
                })),
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            id="fa-filter-status"
            label={d.colStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.faAllStatuses },
              { value: "ACTIVE", label: d.faStatusActive },
              { value: "FULLY_DEPRECIATED", label: d.faStatusFullyDepreciated },
              { value: "DISPOSED", label: d.faStatusDisposed },
              { value: "WRITTEN_OFF", label: d.faStatusWrittenOff },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="fa-filter-custodian"
            label={d.faFilterCustodian}
            value={custodianUserId}
            onValueChange={setCustodianUserId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...users.map((user) => ({
                value: user.userId,
                label: user.fullName,
              })),
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/fixed-assets/new`} variant="primary">
          {d.faAssetsNewButton}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "code",
            header: activeLocaleHeader(d.faColCode),
            accessor: (row) => row.code,
            mono: true,
            sortable: true,
            width: "9rem",
            render: (row) => (
              <a
                href={`/${locale}/fixed-assets/${row.id}`}
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
            id: "category",
            header: activeLocaleHeader(d.faFilterCategory),
            accessor: (row) => {
              const category = categoryById(row.categoryId);
              return category === undefined ? "" : category.code;
            },
            render: (row) => {
              const category = categoryById(row.categoryId);
              return category === undefined ? (
                <span className="text-gray-500">—</span>
              ) : (
                localizedName(category.name, category.nameAr, locale)
              );
            },
          },
          {
            id: "acquisition",
            header: activeLocaleHeader(d.faColAcquisitionDate),
            accessor: (row) => row.acquisitionDate,
            mono: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono text-sm" dir="ltr">
                {row.acquisitionDate}
              </span>
            ),
          },
          {
            id: "cost",
            header: activeLocaleHeader(d.faColCost),
            accessor: (row) => row.cost,
            numeric: true,
            sortable: true,
            render: (row) => <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.cost, 2)}</span>,
          },
          {
            id: "accumulated",
            header: activeLocaleHeader(d.faColAccumulated),
            accessor: (row) => row.accumulatedToDate,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.accumulatedToDate, 2)}</span>
            ),
          },
          {
            id: "nbv",
            header: activeLocaleHeader(d.faColNbv),
            accessor: (row) => row.nbv,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">{formatMoneyDisplay(row.nbv, 2)}</span>
            ),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.colStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                {localizedAssetStatus(d, row.status)}
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
            onSelect: (row) => router.push(`/${locale}/fixed-assets/${row.id}`),
          },
          {
            id: "edit",
            label: d.commonEdit,
            onSelect: (row) => router.push(`/${locale}/fixed-assets/${row.id}/edit`),
          },
        ]}
        empty={{ title: d.faAssetsEmpty }}
      />
    </div>
  );
}
