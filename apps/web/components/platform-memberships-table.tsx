"use client";

/**
 * P5-T12 — platform tenant-detail memberships (List+Search archetype):
 * DataTable with mono emails/role keys and membership-status badges.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ConsoleMembership } from "../lib/api-types";
import { localizedStatus, statusTone } from "../lib/messages";
import { activeLocaleHeader } from "./table-header";

export function PlatformMembershipsTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly ConsoleMembership[];
}): JSX.Element {
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
          accessor: (row) => row.roleKey,
          mono: true,
        },
        {
          id: "status",
          header: activeLocaleHeader(d.usersColStatus),
          accessor: (row) => row.membershipStatus,
          render: (row) => (
            <Badge tone={statusTone(row.membershipStatus)}>
              {localizedStatus(d, row.membershipStatus)}
            </Badge>
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
