"use client";

/**
 * P5-T12 — roles table (List+Search archetype): tenant roles (read-only) and
 * system templates (clone action per row).
 */
import { useState } from "react";
import type { JSX } from "react";

import { DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { RoleRow } from "../lib/api-types";
import { localizedName } from "../lib/messages";
import { CloneTemplateButton } from "./clone-template-button";
import { activeLocaleHeader } from "./table-header";

export function RolesTable({
  locale,
  roles,
  withClone,
  emptyTitle,
}: {
  locale: Locale;
  roles: readonly RoleRow[];
  withClone: boolean;
  emptyTitle: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const [sort, setSort] = useState<DataTableSort[]>([]);

  return (
    <DataTable
      columns={[
        {
          id: "key",
          header: activeLocaleHeader(d.rolesColKey),
          accessor: (row) => row.key,
          mono: true,
          sortable: true,
        },
        {
          id: "name",
          header: activeLocaleHeader(d.rolesColName),
          accessor: (row) => localizedName(row.name, row.nameAr, locale),
          sortable: true,
        },
        {
          id: "system",
          header: activeLocaleHeader(d.rolesColSystem),
          accessor: (row) => (row.isSystem ? "1" : "0"),
          render: (row) => (row.isSystem ? d.rolesYes : d.rolesNo),
        },
        ...(withClone
          ? [
              {
                id: "actions",
                header: activeLocaleHeader(d.rolesColActions),
                accessor: () => "",
                width: "14rem",
                render: (row: RoleRow) => (
                  <CloneTemplateButton
                    locale={locale}
                    templateKey={row.key}
                    roleName={localizedName(row.name, row.nameAr, locale)}
                  />
                ),
              },
            ]
          : []),
      ]}
      rows={[...roles]}
      rowKey={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: emptyTitle }}
    />
  );
}
