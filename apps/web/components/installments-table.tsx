"use client";

/**
 * PHASE-027 (wave F) — the installment plans list (PAGE_ARCHETYPES §2,
 * List+Search — the fixed-assets-table pattern): partner/status/source-type
 * filters reload through the BFF (the API's own filter set — status=DRAFT
 * maps to the NULL-status draft plans); the free-text box filters the
 * loaded page client-side (the plans list endpoint carries no search
 * parameter — the honest degrade). The status column renders NULL as the
 * "مسودة / draft" chip (the wizard's pre-activation state). Amounts are
 * canonical decimal strings (formatMoneyDisplay).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { InstallmentPlanRow, PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedInstallmentFrequency,
  localizedInstallmentSource,
  localizedInstallmentStatus,
  localizedInstallmentsError,
} from "../lib/messages";
import { LinkButton } from "./link-button";
import { ErrorNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const PAGE_LIMIT = 200;

export function InstallmentsTable({
  locale,
  initialRows,
  partners,
}: {
  locale: Locale;
  initialRows: readonly InstallmentPlanRow[];
  partners: readonly PartnerRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [rows, setRows] = useState<readonly InstallmentPlanRow[]>(initialRows);
  const [query, setQuery] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [status, setStatus] = useState("");
  const [sourceType, setSourceType] = useState("");
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
    if (partnerId !== "") {
      search.set("partnerId", partnerId);
    }
    if (status !== "") {
      search.set("status", status);
    }
    if (sourceType !== "") {
      search.set("sourceType", sourceType);
    }
    const result = await bffFetch<readonly InstallmentPlanRow[]>(`installment-plans?${search.toString()}`);
    if (run !== runRef.current) {
      return; // stale response — a newer filter change superseded it
    }
    setBusy(false);
    if (!result.ok) {
      setError(localizedInstallmentsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }, [d, partnerId, status, sourceType]);

  // Filter changes reload the list; the server page already fetched the
  // initial (empty-filter) rows — the first run is a no-op.
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

  // Free-text search over the loaded page (source no / partner name) — the
  // API list route has no search parameter; this never fabricates one.
  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
      return rows;
    }
    return rows.filter(
      (row) =>
        (row.sourceNo ?? "").toLowerCase().includes(needle) ||
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
            placeholder={d.instSearchPlaceholder}
            label={d.listSearchLabel}
          />
        </div>
        <div className="w-52">
          <Select
            id="inst-filter-partner"
            label={d.instFilterPartner}
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
          <Select
            id="inst-filter-status"
            label={d.instFilterStatus}
            value={status}
            onValueChange={setStatus}
            options={[
              { value: "", label: d.instAllStatuses },
              { value: "DRAFT", label: d.instStatusDraft },
              { value: "ACTIVE", label: d.instStatusActive },
              { value: "CLOSED", label: d.instStatusClosed },
              { value: "DEFAULTED", label: d.instStatusDefaulted },
            ]}
          />
        </div>
        <div className="w-52">
          <Select
            id="inst-filter-source"
            label={d.instFilterSource}
            value={sourceType}
            onValueChange={setSourceType}
            options={[
              { value: "", label: d.kindFilterAll },
              { value: "sales_invoice", label: d.instSourceSalesInvoice },
              { value: "service_contract", label: d.instSourceServiceContract },
            ]}
          />
        </div>
        <LinkButton href={`/${locale}/installments/new`} variant="primary">
          {d.instNewButton}
        </LinkButton>
      </div>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <DataTable
        columns={[
          {
            id: "source",
            header: activeLocaleHeader(d.instColSource),
            accessor: (row) => row.sourceNo ?? row.sourceId,
            mono: true,
            sortable: true,
            width: "14rem",
            render: (row) => (
              <a
                href={`/${locale}/installments/${row.id}`}
                className="font-mono text-primary-700 underline decoration-primary-200 hover:text-primary-800"
                dir="ltr"
              >
                {row.sourceNo ?? row.sourceId.slice(0, 8)}
              </a>
            ),
          },
          {
            id: "sourceType",
            header: activeLocaleHeader(d.instFilterSource),
            accessor: (row) => row.sourceType,
            render: (row) => localizedInstallmentSource(d, row.sourceType),
          },
          {
            id: "partner",
            header: activeLocaleHeader(d.instFilterPartner),
            accessor: (row) => partnerName(row.partnerId),
            sortable: true,
            render: (row) => partnerName(row.partnerId),
          },
          {
            id: "total",
            header: activeLocaleHeader(d.instColTotal),
            accessor: (row) => row.totalAmount,
            numeric: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.totalAmount, 2)}
              </span>
            ),
          },
          {
            id: "down",
            header: activeLocaleHeader(d.instWizDownPayment),
            accessor: (row) => row.downPayment,
            numeric: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {formatMoneyDisplay(row.downPayment, 2)}
              </span>
            ),
          },
          {
            id: "lines",
            header: activeLocaleHeader(d.instWizCount),
            accessor: (row) => String(row.lineCount),
            sortable: true,
            render: (row) => (
              <span className="font-mono tabular-nums" dir="ltr">
                {row.lineCount}
              </span>
            ),
          },
          {
            id: "start",
            header: activeLocaleHeader(d.instWizStartDate),
            accessor: (row) => row.startDate,
            mono: true,
            sortable: true,
            render: (row) => (
              <span className="font-mono text-sm" dir="ltr">
                {row.startDate}
              </span>
            ),
          },
          {
            id: "frequency",
            header: activeLocaleHeader(d.instWizFrequency),
            accessor: (row) => row.frequency,
            render: (row) => localizedInstallmentFrequency(d, row.frequency),
          },
          {
            id: "status",
            header: activeLocaleHeader(d.colStatus),
            accessor: (row) => row.status ?? "DRAFT",
            render: (row) => (
              <Badge tone={row.status === null ? "neutral" : "primary"}>
                {localizedInstallmentStatus(d, row.status)}
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
            onSelect: (row) => router.push(`/${locale}/installments/${row.id}`),
          },
        ]}
        empty={{ title: d.instEmpty }}
      />
    </div>
  );
}
