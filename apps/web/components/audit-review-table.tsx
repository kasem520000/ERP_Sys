"use client";

/**
 * PHASE-024 T8 — tenant audit-review events (List+Search archetype, the
 * platform-audit-table pattern): mono columns, `dir="ltr"` id runs (RTL §5 —
 * uuids and correlation ids are LTR data), and the localized `at` rendering.
 * The house DataTable ships its own scroll container (max-h + overflow-auto),
 * so long result sets scroll under the sticky header.
 */
import { useState } from "react";
import type { JSX } from "react";

import { DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { TenantAuditEvent } from "../lib/api-types";
import { formatDateTime } from "../lib/messages";
import { activeLocaleHeader } from "./table-header";

/** LTR-isolated id/uuid run (ids are never localized data). */
function ltrId(value: string | null): JSX.Element {
  if (value === null || value === "") {
    return <span>—</span>;
  }
  return (
    <span dir="ltr" className="block truncate">
      {value}
    </span>
  );
}

export function AuditReviewTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly TenantAuditEvent[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "at",
          header: activeLocaleHeader(d.auditColAt),
          accessor: (row) => row.at,
          render: (row) => formatDateTime(row.at, locale),
        },
        {
          id: "action",
          header: activeLocaleHeader(d.auditColAction),
          accessor: (row) => row.action,
          mono: true,
          sortable: true,
        },
        {
          id: "entityType",
          header: activeLocaleHeader(d.auditColEntityType),
          accessor: (row) => row.entityType,
          mono: true,
          sortable: true,
        },
        {
          id: "entityId",
          header: activeLocaleHeader(d.auditColEntityId),
          accessor: (row) => row.entityId,
          mono: true,
          render: (row) => ltrId(row.entityId),
        },
        {
          id: "actorId",
          header: activeLocaleHeader(d.auditColActor),
          accessor: (row) => row.actorId ?? "",
          mono: true,
          render: (row) => ltrId(row.actorId),
        },
        {
          id: "correlationId",
          header: activeLocaleHeader(d.auditColCorrelation),
          accessor: (row) => row.correlationId ?? "",
          mono: true,
          render: (row) => ltrId(row.correlationId),
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.auditEmpty }}
    />
  );
}
