"use client";

/**
 * P5-T12 — active tenant sessions (List+Search archetype): DataTable with
 * mono user/IP columns and per-row revoke. tokenHash never rendered.
 */
import { useState } from "react";
import type { JSX } from "react";

import { DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { TenantSessionRow } from "../lib/api-types";
import { formatDateTime } from "../lib/messages";
import { RevokeSessionButton } from "./revoke-session-button";
import { activeLocaleHeader } from "./table-header";

export function SessionsTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly TenantSessionRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "user",
          header: activeLocaleHeader(d.sessionsColUser),
          accessor: (row) => row.userId,
          mono: true,
          sortable: true,
        },
        {
          id: "created",
          header: activeLocaleHeader(d.sessionsColCreated),
          accessor: (row) => row.createdAt,
          render: (row) => formatDateTime(row.createdAt, locale),
        },
        {
          id: "expires",
          header: activeLocaleHeader(d.sessionsColExpires),
          accessor: (row) => row.expiresAt,
          render: (row) => formatDateTime(row.expiresAt, locale),
        },
        {
          id: "lastSeen",
          header: activeLocaleHeader(d.sessionsColLastSeen),
          accessor: (row) => row.lastSeenAt,
          render: (row) => formatDateTime(row.lastSeenAt, locale),
        },
        {
          id: "ip",
          header: activeLocaleHeader(d.sessionsColIp),
          accessor: (row) => row.ip ?? "",
          mono: true,
          render: (row) => row.ip ?? "—",
        },
        {
          id: "actions",
          header: activeLocaleHeader(d.usersColActions),
          accessor: () => "",
          width: "10rem",
          render: (row) => <RevokeSessionButton locale={locale} sessionId={row.id} />,
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.sessionsEmpty }}
    />
  );
}
