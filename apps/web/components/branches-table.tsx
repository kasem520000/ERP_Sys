"use client";

/**
 * P5-T12 — branches list (List+Search archetype): DataTable with mono codes,
 * bilingual names and activate/deactivate per row (tenant plane only — the
 * platform detail view renders the same table read-only).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { BranchRow } from "../lib/api-types";
import { localizedName } from "../lib/messages";
import { BranchToggleButton } from "./branch-toggle-button";
import { activeLocaleHeader } from "./table-header";

export function BranchesTable({
  locale,
  rows,
  interactive,
}: {
  locale: Locale;
  rows: readonly BranchRow[];
  /** Tenant plane renders the activate/deactivate action; platform is read-only. */
  interactive: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "code",
          header: activeLocaleHeader(d.branchesColCode),
          accessor: (row) => row.code,
          mono: true,
          sortable: true,
        },
        {
          id: "name",
          header: activeLocaleHeader(d.branchesColName),
          accessor: (row) => localizedName(row.name, row.nameAr, locale),
          sortable: true,
        },
        {
          id: "nameAr",
          header: activeLocaleHeader(d.branchesColNameAr),
          accessor: (row) => row.nameAr ?? "",
          render: (row) =>
            row.nameAr === null ? <span className="text-gray-500">—</span> : <span lang="ar">{row.nameAr}</span>,
        },
        {
          id: "status",
          header: activeLocaleHeader(d.usersColStatus),
          accessor: (row) => (row.isActive ? "ACTIVE" : "INACTIVE"),
          render: (row) => (
            <Badge tone={row.isActive ? "primary" : "neutral"}>
              {row.isActive ? d.statusActive : d.statusInactive}
            </Badge>
          ),
        },
        ...(interactive
          ? [
              {
                id: "actions",
                header: activeLocaleHeader(d.usersColActions),
                accessor: () => "",
                width: "10rem",
                render: (row: BranchRow) => (
                  <BranchToggleButton locale={locale} branchId={row.id} isActive={row.isActive} />
                ),
              },
            ]
          : []),
      ]}
      rows={[...rows]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.branchesEmpty }}
    />
  );
}
