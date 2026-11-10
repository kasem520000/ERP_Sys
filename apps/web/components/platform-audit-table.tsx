"use client";

/**
 * P5-T12 — platform audit events (List+Search archetype): mono action/actor/
 * tenant columns, the via-platform-admin badge, and the URL-encoded cursor
 * next-page link rendered by the server page.
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { PlatformAuditEvent } from "../lib/api-types";
import { formatDateTime } from "../lib/messages";
import { activeLocaleHeader } from "./table-header";

export function PlatformAuditTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly PlatformAuditEvent[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "at",
          header: activeLocaleHeader(d.platformAuditColAt),
          accessor: (row) => row.at,
          render: (row) => formatDateTime(row.at, locale),
        },
        {
          id: "tenant",
          header: activeLocaleHeader(d.platformColTenant),
          accessor: (row) => row.tenantId ?? "",
          mono: true,
          render: (row) => row.tenantId ?? "—",
        },
        {
          id: "action",
          header: activeLocaleHeader(d.platformAuditColAction),
          accessor: (row) => row.action,
          mono: true,
          sortable: true,
        },
        {
          id: "actor",
          header: activeLocaleHeader(d.platformAuditColActor),
          accessor: (row) => row.actorId ?? "",
          mono: true,
          render: (row) => row.actorId ?? "—",
        },
        {
          id: "via",
          header: activeLocaleHeader(d.platformAuditViaPlatform),
          accessor: (row) => (row.viaPlatformAdmin ? "1" : "0"),
          render: (row) =>
            row.viaPlatformAdmin ? <Badge tone="primary">{d.platformAuditViaPlatform}</Badge> : "—",
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.platformAuditEmpty }}
    />
  );
}
