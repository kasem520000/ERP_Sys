"use client";

/**
 * PHASE-027 (wave F) — the notes register list (PAGE_ARCHETYPES §2,
 * List+Search — the fixed-assets-table pattern): kind/direction/status/
 * partner filters + the maturity-date range reload through the BFF (the
 * API's own filter set); the free-text box filters the loaded page
 * client-side (the notes list endpoint carries no search parameter — the
 * honest degrade, never a fabricated server param). Calendar drills land
 * here pre-filtered via /notes?maturityFrom=&maturityTo=. Amounts are
 * canonical decimal strings (formatMoneyDisplay); numeric cells stay
 * LTR-isolated inside the RTL grid.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  DataTable,
  DatePicker,
  SearchInput,
  Select,
  formatMoneyDisplay,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { NoteListRow, PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedNoteDirection,
  localizedNoteKind,
  localizedNoteStatus,
  localizedNotesError,
} from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const PAGE_LIMIT = 200;

export interface NotesTableInitialFilters {
  kind: string;
  direction: string;
  status: string;
  partnerId: string;
  maturityFrom: string;
  maturityTo: string;
}

const EMPTY_FILTERS: NotesTableInitialFilters = {
  kind: "",
  direction: "",
  status: "",
  partnerId: "",
  maturityFrom: "",
  maturityTo: "",
};

export function NotesTable({
  locale,
  initialRows,
  partners,
  initialFilters = EMPTY_FILTERS,
}: {
  locale: Locale;
  initialRows: readonly NoteListRow[];
  partners: readonly PartnerRow[];
  initialFilters?: NotesTableInitialFilters;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly NoteListRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState(initialFilters.kind);
  const [direction, setDirection] = useState(initialFilters.direction);
  const [status, setStatus] = useState(initialFilters.status);
  const [partnerId, setPartnerId] = useState(initialFilters.partnerId);
  const [maturityFrom, setMaturityFrom] = useState(initialFilters.maturityFrom);
  const [maturityTo, setMaturityTo] = useState(initialFilters.maturityTo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const runRef = useRef(0);
  const skipInitialLoad = useRef(
    initialFilters.kind === "" &&
      initialFilters.direction === "" &&
      initialFilters.status === "" &&
      initialFilters.partnerId === "" &&
      initialFilters.maturityFrom === "" &&
      initialFilters.maturityTo === "",
  );

  const loadPage = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1;
    runRef.current = run;
    setBusy(true);
    setError(null);
    const search = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (kind !== "") {
      search.set("kind", kind);
    }
    if (direction !== "") {
      search.set("direction", direction);
    }
    if (status !== "") {
      search.set("status", status);
    }
    if (partnerId !== "") {
      search.set("partnerId", partnerId);
    }
    if (maturityFrom !== "") {
      search.set("maturityFrom", maturityFrom);
    }
    if (maturityTo !== "") {
      search.set("maturityTo", maturityTo);
    }
    const result = await bffFetch<readonly NoteListRow[]>(`notes?${search.toString()}`);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedNotesError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, kind, direction, status, partnerId, maturityFrom, maturityTo]);

  // Filter changes reload the list. The server page already fetched the
  // initial rows — the first run is a no-op unless a drill-down pre-filter
  // arrived (then the page fetched with those filters and no refetch fires).
  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    void loadPage();
  }, [loadPage]);

  const partnerName = useCallback(
    (id: string): string => {
      const partner = partners.find((entry) => entry.id === id);
      return partner === undefined ? id : localizedName(partner.name, partner.nameAr, locale);
    },
    [partners, locale],
  );

  // Free-text search over the loaded page (number/bank/partner) — the API
  // list route has no search parameter; this never fabricates one.
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return rows;
    }
    return rows.filter(
      (row) =>
        (row.number ?? "").toLowerCase().includes(needle) ||
        (row.issuingBank ?? "").toLowerCase().includes(needle) ||
        partnerName(row.partnerId).toLowerCase().includes(needle),
    );
  }, [rows, query, partnerName]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={d.notesSearchPlaceholder}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-44">
          <Select
            id="notes-filter-kind"
            label={d.notesFilterKind}
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "CHEQUE", label: d.notesKindCheque },
              { value: "PROMISSORY_NOTE", label: d.notesKindPromissoryNote },
            ]}
          />
        </div>
        <div className="w-40">
          <Select
            id="notes-filter-direction"
            label={d.notesFilterDirection}
            value={direction}
            onValueChange={setDirection}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "RECEIVED", label: d.notesDirectionReceived },
              { value: "ISSUED", label: d.notesDirectionIssued },
            ]}
          />
        </div>
        <div className="w-48">
          <Select
            id="notes-filter-status"
            label={d.colStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.notesAllStatuses },
              { value: "IN_CUSTODY", label: d.notesStatusInCustody },
              { value: "ENDORSED_OUT", label: d.notesStatusEndorsedOut },
              { value: "DEPOSITED", label: d.notesStatusDeposited },
              { value: "COLLECTED", label: d.notesStatusCollected },
              { value: "DISHONORED", label: d.notesStatusDishonored },
              { value: "DISCOUNTED", label: d.notesStatusDiscounted },
              { value: "RETURNED", label: d.notesStatusReturned },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="notes-filter-partner"
            label={d.notesFilterPartner}
            value={partnerId}
            onValueChange={setPartnerId}
            options={[
              { value: "", label: d.kindFilterAll },
              ...partners.map((partner) => ({
                value: partner.id,
                label:
                  partner.code === ""
                    ? localizedName(partner.name, partner.nameAr, locale)
                    : `${partner.code} · ${localizedName(partner.name, partner.nameAr, locale)}`,
              })),
            ]}
          />
        </div>
        <div className="w-44">
          <DatePicker
            id="notes-filter-maturity-from"
            locale={locale}
            value={maturityFrom}
            onSelect={setMaturityFrom}
            label={`${d.notesFilterMaturityRange} — ${d.reportWorkspaceDateFrom}`}
          />
        </div>
        <div className="w-44">
          <DatePicker
            id="notes-filter-maturity-to"
            locale={locale}
            value={maturityTo}
            onSelect={setMaturityTo}
            label={d.reportWorkspaceDateTo}
          />
        </div>
        <LinkButton href={`/${locale}/notes/new`} variant="primary">
          {d.notesNewButton}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "number",
            header: activeLocaleHeader(d.notesFormNumber),
            accessor: (row) => row.number ?? "",
            mono: true,
            sortable: true,
            width: "10rem",
            render: (row) => (
              <a
                href={`/${locale}/notes/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
              >
                {row.number ?? "—"}
              </a>
            ),
          },
          {
            id: "kind",
            header: activeLocaleHeader(d.notesFilterKind),
            accessor: (row) => row.kind,
            render: (row) => localizedNoteKind(d, row.kind),
          },
          {
            id: "direction",
            header: activeLocaleHeader(d.notesFilterDirection),
            accessor: (row) => row.direction,
            render: (row) => localizedNoteDirection(d, row.direction),
          },
          {
            id: "partner",
            header: activeLocaleHeader(d.notesFilterPartner),
            accessor: (row) => partnerName(row.partnerId),
            sortable: true,
            render: (row) => partnerName(row.partnerId),
          },
          {
            id: "bank",
            header: activeLocaleHeader(d.notesFormBank),
            accessor: (row) => row.issuingBank ?? "",
            render: (row) =>
              row.issuingBank === null || row.issuingBank === "" ? (
                <span className="text-gray-500">—</span>
              ) : (
                row.issuingBank
              ),
          },
          {
            id: "amount",
            header: activeLocaleHeader(d.instColAmount),
            accessor: (row) => row.amount,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.amount, 2)}{" "}
                <span className="text-xs text-gray-500">{row.currency}</span>
              </span>
            ),
          },
          {
            id: "maturity",
            header: activeLocaleHeader(d.notesFormMaturityDate),
            accessor: (row) => row.maturityDate,
            mono: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono text-sm" dir="ltr">
                {row.maturityDate}
              </span>
            ),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.colStatus),
            accessor: (row) => row.status,
            render: (row) => (
              <Badge tone={row.status === "IN_CUSTODY" ? "primary" : "neutral"}>
                {localizedNoteStatus(d, row.status)}
              </Badge>
            ),
          },
        ]}
        rows={[...visibleRows]}
        rowKey={(row) => row.id}
        sort={sort}
        onSortChange={setSort}
        loading={busy && visibleRows.length === 0}
        rowActions={[
          {
            id: "open",
            label: d.commonOpen,
            onSelect: (row) => router.push(`/${locale}/notes/${row.id}`),
          },
        ]}
        empty={{ title: d.notesEmpty }}
      />
    </div>
  );
}
