"use client";

/**
 * P4-T12a — platform support-session console (§7): open a time-boxed session
 * (reason required; ticketRef OR tenant opt-in decides access — 403
 * tenancy/support-access-denied otherwise), close ACTIVE sessions (reason
 * required), and the enumerated read-data quick views (§7 rule 4) rendered
 * as raw JSON in a scrollable <pre>.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { Badge, Button, DataTable, Input, Select } from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import type { SupportSessionRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, localizedStatus, localizedTenancyError, statusTone } from "../lib/messages";
import { SUPPORT_READ_RESOURCES, type SupportReadResource } from "../lib/constants";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const MIN_REASON_LENGTH = 3;
const MAX_HOURS: readonly number[] = [1, 2, 3, 4];

const RESOURCE_LABEL_KEYS: Record<SupportReadResource, keyof Dictionary> = {
  users: "resourceUsers",
  memberships: "resourceMemberships",
  roles: "resourceRoles",
  branches: "resourceBranches",
  settings: "resourceSettings",
  entitlements: "resourceEntitlements",
  subscription: "resourceSubscription",
  accounts: "resourceAccounts",
  "audit-events": "resourceAuditEvents",
};

export function PlatformSupportConsole({
  locale,
  tenantId,
  sessions,
}: {
  locale: Locale;
  tenantId: string;
  sessions: readonly SupportSessionRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();

  const [reason, setReason] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [maxHours, setMaxHours] = useState("4");
  const [openBusy, setOpenBusy] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const activeSessions = sessions.filter((session) => session.status === "ACTIVE");
  const [sessionId, setSessionId] = useState<string>("");
  const effectiveSessionId =
    activeSessions.find((session) => session.id === sessionId)?.id ?? activeSessions[0]?.id ?? null;

  const [resource, setResource] = useState<SupportReadResource>("users");
  const [readBusy, setReadBusy] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [readPayload, setReadPayload] = useState<string | null>(null);

  async function onOpen(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setOpenError(null);
    if (reason.trim().length < MIN_REASON_LENGTH) {
      setOpenError(d.errorsValidation);
      return;
    }
    const body: Record<string, unknown> = {
      reason: reason.trim(),
      maxHours: Number.parseInt(maxHours, 10),
    };
    if (ticketRef.trim() !== "") {
      body.ticketRef = ticketRef.trim();
    }
    setOpenBusy(true);
    const result = await bffFetch<SupportSessionRow>(
      `platform/tenants/${encodeURIComponent(tenantId)}/support-sessions`,
      { method: "POST", body },
    );
    setOpenBusy(false);
    if (!result.ok) {
      setOpenError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReason("");
    setTicketRef("");
    setReadPayload(null);
    router.refresh();
  }

  async function onRead(): Promise<void> {
    if (effectiveSessionId === null) {
      setReadError(d.platformNoActiveSession);
      return;
    }
    setReadBusy(true);
    setReadError(null);
    setReadPayload(null);
    const result = await bffFetch<unknown>(
      `platform/tenants/${encodeURIComponent(tenantId)}/support-sessions/${encodeURIComponent(
        effectiveSessionId,
      )}/tenant-data/${resource}`,
    );
    setReadBusy(false);
    if (!result.ok) {
      setReadError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setReadPayload(
      typeof result.data === "string"
        ? result.data
        : JSON.stringify(result.data ?? null, null, 2),
    );
  }

  return (
    <Card title={d.platformSupportTitle} ariaLabel={d.platformSupportTitle}>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{d.platformSupportOpenTitle}</h3>
      <form onSubmit={onOpen} noValidate className="flex max-w-2xl flex-col gap-3">
        <Input
          id={`support-reason-${tenantId}`}
          label={d.platformSupportReasonLabel}
          value={reason}
          onValueChange={setReason}
        />
        <Input
          id={`support-ticket-${tenantId}`}
          label={d.platformSupportTicketLabel}
          value={ticketRef}
          onValueChange={setTicketRef}
          mono
          bidiIsolate
        />
        <div className="w-full max-w-32">
          <Select
            id={`support-hours-${tenantId}`}
            label={d.platformSupportHoursLabel}
            value={maxHours}
            onValueChange={setMaxHours}
            options={MAX_HOURS.map((hours) => ({ value: String(hours), label: String(hours) }))}
          />
        </div>
        <div>
          <Button type="submit" variant="primary" loading={openBusy}>
            {d.platformSupportOpenSubmit}
          </Button>
        </div>
        {openError !== null && <ErrorNotice>{openError}</ErrorNotice>}
      </form>

      <div className="mt-4 border-t border-subtle pt-4">
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
              id: "actions",
              header: activeLocaleHeader(d.usersColActions),
              accessor: () => "",
              width: "22rem",
              render: (row) =>
                row.status === "ACTIVE" ? (
                  <CloseControl locale={locale} tenantId={tenantId} session={row} />
                ) : (
                  <span className="text-gray-500">—</span>
                ),
            },
          ]}
          rows={[...sessions]}
          rowKey={(row) => row.id}
          empty={{ title: d.supportEmpty }}
        />
      </div>

      <div className="mt-4 border-t border-subtle pt-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">{d.platformReadDataTitle}</h3>
        {effectiveSessionId === null ? (
          <InfoNotice>{d.platformNoActiveSession}</InfoNotice>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full max-w-56">
                <Select
                  id={`read-session-${tenantId}`}
                  label={d.platformSupportSessionLabel}
                  value={effectiveSessionId}
                  onValueChange={setSessionId}
                  options={activeSessions.map((session) => ({
                    value: session.id,
                    label: formatDateTime(session.openedAt, locale),
                  }))}
                />
              </div>
              <div className="w-full max-w-56">
                <Select
                  id={`read-resource-${tenantId}`}
                  label={d.platformReadResourceLabel}
                  value={resource}
                  onValueChange={(value) => setResource(value as SupportReadResource)}
                  options={SUPPORT_READ_RESOURCES.map((value) => ({
                    value,
                    label: d[RESOURCE_LABEL_KEYS[value]],
                  }))}
                />
              </div>
              <Button variant="secondary" loading={readBusy} onClick={() => void onRead()}>
                {d.platformReadSubmit}
              </Button>
            </div>
            {readError !== null && <ErrorNotice>{readError}</ErrorNotice>}
            {readPayload !== null && (
              <pre
                aria-label={d.platformReadDataTitle}
                className="max-h-96 overflow-auto rounded-md border border-subtle bg-surface-sunken p-3 font-mono text-xs text-gray-800"
              >
                {readPayload}
              </pre>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function CloseControl({
  locale,
  tenantId,
  session,
}: {
  locale: Locale;
  tenantId: string;
  session: SupportSessionRow;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();
  const [closeReason, setCloseReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClose(): Promise<void> {
    if (closeReason.trim().length < MIN_REASON_LENGTH) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bffFetch<unknown>(
      `platform/tenants/${encodeURIComponent(tenantId)}/support-sessions/${encodeURIComponent(
        session.id,
      )}/close`,
      { method: "POST", body: { reason: closeReason.trim() } },
    );
    setBusy(false);
    if (!result.ok) {
      setError(localizedTenancyError(d, result.error, result.retryAfterSeconds));
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-wrap items-end gap-2">
      <div className="w-full max-w-56">
        <Input
          aria-label={d.platformSupportCloseReasonLabel}
          value={closeReason}
          onValueChange={setCloseReason}
        />
      </div>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void onClose()}>
        {d.platformSupportClose}
      </Button>
      {error !== null && (
        <span role="alert" className="w-full text-xs text-danger-700">
          {error}
        </span>
      )}
    </span>
  );
}
