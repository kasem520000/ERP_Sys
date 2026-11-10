"use client";

/**
 * P5-T12 — issued invitations list (List+Search archetype): DataTable with
 * per-row revoke (destructive, per-row busy/error preserved by the button).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, DataTable, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { InvitationView } from "../lib/api-types";
import { formatDateTime, localizedStatus, localizedName, statusTone } from "../lib/messages";
import { RevokeInvitationButton } from "./revoke-invitation-button";
import { activeLocaleHeader } from "./table-header";

export function InvitationsTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly InvitationView[];
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
          id: "expires",
          header: activeLocaleHeader(d.usersColExpires),
          accessor: (row) => row.expiresAt,
          render: (row) => formatDateTime(row.expiresAt, locale),
        },
        {
          id: "actions",
          header: activeLocaleHeader(d.usersColActions),
          accessor: () => "",
          width: "9rem",
          render: (row) => <RevokeInvitationButton locale={locale} invitationId={row.invitationId} />,
        },
      ]}
      rows={[...rows]}
      rowKey={(row) => row.invitationId}
      sort={sort}
      onSortChange={setSort}
      empty={{ title: d.usersEmptyInvitations }}
    />
  );
}
