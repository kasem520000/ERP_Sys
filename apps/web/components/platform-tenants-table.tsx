"use client";

/**
 * P5-T12 — platform console tenant list (List+Search archetype): DataTable
 * with row links into the tenant detail screen and tenant-status badges
 * (PENDING/ACTIVE/SUSPENDED/OFFBOARDED → Badge tones).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ConsoleTenantSummary } from "../lib/api-types";
import { formatDateTime, localizedStatus, localizedName, statusTone } from "../lib/messages";
import { activeLocaleHeader } from "./table-header";

export function PlatformTenantsTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly ConsoleTenantSummary[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "tenant",
          header: activeLocaleHeader(d.platformColTenant),
          accessor: (row) => localizedName(row.name, row.nameAr, locale),
          sortable: true,
          render: (row) => (
            <span className="flex min-w-0 items-center gap-2">
              <a
                href={`/${locale}/platform/tenants/${row.id}`}
                className="truncate font-medium text-primary-700 underline-offset-2 hover:underline"
              >
                {localizedName(row.name, row.nameAr, locale)}
              </a>
              {row.isPlatformTenant && <Badge tone="primary">{d.platformTenantBadge}</Badge>}
            </span>
          ),
        },
        {
          id: "country",
          header: activeLocaleHeader(d.platformColCountry),
          accessor: (row) => row.countryCode,
          mono: true,
          sortable: true,
        },
        {
          id: "status",
          header: activeLocaleHeader(d.usersColStatus),
          accessor: (row) => row.status,
          render: (row) => (
            <Badge tone={statusTone(row.status)}>{localizedStatus(d, row.status)}</Badge>
          ),
        },
        {
          id: "created",
          header: activeLocaleHeader(d.platformColCreated),
          accessor: (row) => row.createdAt,
          render: (row) => formatDateTime(row.createdAt, locale),
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.platformEmpty }}
    />
  );
}
