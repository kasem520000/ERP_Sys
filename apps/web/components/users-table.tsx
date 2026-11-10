"use client";

/**
 * P5-T12 — tenant users list (List+Search archetype): DataTable columns with
 * mono email, localized role names, Badge statuses and formatted last-login.
 * Client-side sort on email/name; rows arrive server-fetched.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { TenantUserRow } from "../lib/api-types";
import { formatDateTime, localizedStatus, localizedName, statusTone } from "../lib/messages";
import { activeLocaleHeader } from "./table-header";

export function UsersTable({ locale, rows }: { locale: Locale; rows: readonly TenantUserRow[] }): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "email",
          header: activeLocaleHeader(d.usersColEmail),
          accessor: (row) => row.email,
          mono: true,
          sortable: true,
        },
        {
          id: "name",
          header: activeLocaleHeader(d.usersColName),
          accessor: (row) => row.fullName,
          sortable: true,
        },
        {
          id: "role",
          header: activeLocaleHeader(d.usersColRole),
          accessor: (row) => localizedName(row.roleName, row.roleNameAr, locale),
          render: (row) => (
            <span>
              {localizedName(row.roleName, row.roleNameAr, locale)}{" "}
              <span className="font-mono text-xs text-gray-500">({row.roleKey})</span>
            </span>
          ),
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
          id: "lastLogin",
          header: activeLocaleHeader(d.usersColLastLogin),
          accessor: (row) => row.lastLoginAt ?? "",
          render: (row) =>
            row.lastLoginAt === null ? (
              <span className="text-gray-500">{d.usersNever}</span>
            ) : (
              formatDateTime(row.lastLoginAt, locale)
            ),
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.membershipId}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.usersEmpty }}
    />
  );
}
