"use client";

/**
 * P5-T12 — support sessions list (tenant plane, List+Search archetype):
 * status badges, reason/ticket columns and the terminate action for ACTIVE
 * opt-in sessions.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { SupportSessionRow } from "../lib/api-types";
import { formatDateTime, localizedStatus, statusTone } from "../lib/messages";
import { SupportSessionTerminateButton } from "./support-session-terminate-button";
import { activeLocaleHeader } from "./table-header";

export function SupportSessionsTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly SupportSessionRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "status",
          header: activeLocaleHeader(d.usersColStatus),
          accessor: (row) => row.status,
          render: (row) => (
            <Badge tone={statusTone(row.status)}>{localizedStatus(d, row.status)}</Badge>
          ),
        },
        {
          id: "reason",
          header: activeLocaleHeader(d.supportColReason),
          accessor: (row) => row.reason,
          sortable: true,
        },
        {
          id: "ticket",
          header: activeLocaleHeader(d.supportColTicket),
          accessor: (row) => row.ticketRef ?? "",
          mono: true,
          render: (row) => row.ticketRef ?? "—",
        },
        {
          id: "optIn",
          header: activeLocaleHeader(d.supportColOptIn),
          accessor: (row) => (row.optIn ? "1" : "0"),
          render: (row) => (row.optIn ? d.rolesYes : d.rolesNo),
        },
        {
          id: "opened",
          header: activeLocaleHeader(d.supportColOpened),
          accessor: (row) => row.openedAt,
          render: (row) => formatDateTime(row.openedAt, locale),
        },
        {
          id: "expires",
          header: activeLocaleHeader(d.usersColExpires),
          accessor: (row) => row.expiresAt,
          render: (row) => formatDateTime(row.expiresAt, locale),
        },
        {
          id: "closed",
          header: activeLocaleHeader(d.supportColClosed),
          accessor: (row) => row.closedAt ?? "",
          render: (row) => formatDateTime(row.closedAt, locale),
        },
        {
          id: "actions",
          header: activeLocaleHeader(d.usersColActions),
          accessor: () => "",
          width: "11rem",
          render: (row) =>
            row.status === "ACTIVE" && row.optIn ? (
              <SupportSessionTerminateButton locale={locale} sessionId={row.id} />
            ) : (
              <span className="text-gray-500">—</span>
            ),
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.supportEmpty }}
    />
  );
}
