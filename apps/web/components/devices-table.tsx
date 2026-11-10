"use client";

/**
 * PHASE-020 T14 — the device registry table (client interactions): the
 * /platform/devices list with row actions — revoke (confirm dialog +
 * reason), flag trust (jsonb merge via PATCH), set data expiry (DatePicker
 * → PATCH dataExpiresAt, ISO end-of-day UTC), and the per-device sync
 * state drawer (GET devices/:id → cursors per entity). Mutations merge
 * the API response into the local row state (the pos-terminals pattern).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, DatePicker, Dialog, Input, type DataTableSort } from "@erp/ui";

import { getDictionary, type Dictionary, type Locale } from "../i18n/dictionaries";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedApiError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Hand-written wire type (ADR-0003): GET /api/v1/devices rows. */
export interface DeviceRow {
  id: string;
  name: string | null;
  userId: string;
  platform: string;
  deviceClass: string | null;
  contractVersion: string | null;
  attested: boolean;
  trustFlags: Record<string, unknown>;
  revokedAt: string | null;
  dataExpiresAt: string | null;
  lastSeenAt: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  cursorEntities: number;
  pendingCommands: number;
}

/** GET /api/v1/devices/:id → the detail payload (sync-state drawer). */
interface DeviceDetailResult {
  device: DeviceRow & {
    attestationNonce: string | null;
    attestedAt: string | null;
    capabilities: unknown;
    createdAt: string;
  };
  cursors: { entityType: string; lastSeq: number; acknowledgedAt: string | null }[];
}

function classLabel(d: Dictionary, deviceClass: string | null): string {
  switch (deviceClass) {
    case "pos-terminal":
      return d.syncDevicesClassPosTerminal;
    case "tauri-desktop":
      return d.syncDevicesClassTauriDesktop;
    case "android-field":
      return d.syncDevicesClassAndroidField;
    case "android-personal":
      return d.syncDevicesClassAndroidPersonal;
    default:
      return "—";
  }
}

function trustFlagChips(d: Dictionary, flags: Record<string, unknown>): JSX.Element {
  const entries = Object.entries(flags);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{d.syncDevicesTrustFlagsNone}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <Badge key={key} mono bidiIsolate>
          {key}
          {typeof value === "boolean" ? (value ? ": ✓" : ": ✗") : typeof value === "string" ? `: ${value}` : ""}
        </Badge>
      ))}
    </span>
  );
}

/** ISO end-of-day UTC for the picked calendar date (the expiry watermark). */
function expiryIsoFromPick(pick: string): string {
  return `${pick}T23:59:59.000Z`;
}

export function DevicesTable({
  locale,
  rows,
}: {
  locale: Locale;
  rows: readonly DeviceRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [current, setCurrent] = useState<readonly DeviceRow[]>(rows);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Revoke dialog state.
  const [revokeRow, setRevokeRow] = useState<DeviceRow | null>(null);
  const [reason, setReason] = useState("");

  // Flag dialog state.
  const [flagRow, setFlagRow] = useState<DeviceRow | null>(null);
  const [flagKey, setFlagKey] = useState("");
  const [flagValue, setFlagValue] = useState("");

  // Expiry dialog state.
  const [expiryRow, setExpiryRow] = useState<DeviceRow | null>(null);
  const [expiryPick, setExpiryPick] = useState("");
  const [expiryClear, setExpiryClear] = useState(false);

  // Detail dialog state (fetch on open).
  const [detailRow, setDetailRow] = useState<DeviceRow | null>(null);
  const [detail, setDetail] = useState<DeviceDetailResult | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);

  async function openDetail(row: DeviceRow): Promise<void> {
    setDetailRow(row);
    setDetail(null);
    setDetailFailed(false);
    setBusy(`detail-${row.id}`);
    const result = await bffFetch<DeviceDetailResult>(`devices/${row.id}`);
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      setDetailFailed(true);
      return;
    }
    setDetail(result.data);
  }

  async function revoke(): Promise<void> {
    if (revokeRow === null) return;
    setBusy(`revoke-${revokeRow.id}`);
    setError(null);
    const result = await bffFetch<{ revokedAt: string }>(`devices/${revokeRow.id}/revoke`, {
      method: "POST",
      body: reason.trim() === "" ? {} : { reason: reason.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const revokedAt = result.data.revokedAt;
    setCurrent((existing) =>
      existing.map((row) => (row.id === revokeRow.id ? { ...row, revokedAt } : row)),
    );
    setRevokeRow(null);
    setReason("");
    setNotice(d.syncDevicesRevokedToast);
  }

  async function flag(): Promise<void> {
    if (flagRow === null || flagKey.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy(`flag-${flagRow.id}`);
    setError(null);
    const result = await bffFetch<{ trustFlags: Record<string, unknown> }>(`devices/${flagRow.id}`, {
      method: "PATCH",
      body: { trustFlags: { [flagKey.trim()]: flagValue.trim() === "" ? true : flagValue.trim() } },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const trustFlags = result.data.trustFlags;
    setCurrent((existing) =>
      existing.map((row) => (row.id === flagRow.id ? { ...row, trustFlags } : row)),
    );
    setFlagRow(null);
    setFlagKey("");
    setFlagValue("");
    setNotice(d.syncDevicesFlaggedToast);
  }

  async function expire(): Promise<void> {
    if (expiryRow === null || (!expiryClear && expiryPick === "")) {
      setError(d.errorsValidation);
      return;
    }
    setBusy(`expiry-${expiryRow.id}`);
    setError(null);
    const dataExpiresAt = expiryClear ? null : expiryIsoFromPick(expiryPick);
    const result = await bffFetch<{ dataExpiresAt: string | null }>(`devices/${expiryRow.id}`, {
      method: "PATCH",
      body: { dataExpiresAt },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const merged = result.data.dataExpiresAt;
    setCurrent((existing) =>
      existing.map((row) => (row.id === expiryRow.id ? { ...row, dataExpiresAt: merged } : row)),
    );
    setExpiryRow(null);
    setExpiryPick("");
    setExpiryClear(false);
    setNotice(expiryClear ? d.syncDevicesExpiryClearedToast : d.syncDevicesExpirySetToast);
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.syncDevicesTitle}>
        <DataTable
          columns={[
            {
              id: "name",
              header: activeLocaleHeader(d.syncDevicesColName),
              accessor: (row) => row.name ?? row.id,
              sortable: true,
              render: (row) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">
                    {row.name ?? "—"}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {row.id.slice(0, 8)}
                  </span>
                </span>
              ),
            },
            {
              id: "class",
              header: activeLocaleHeader(d.syncDevicesColClass),
              accessor: (row) => row.deviceClass ?? "",
              sortable: true,
              render: (row) => classLabel(d, row.deviceClass),
            },
            {
              id: "platform",
              header: activeLocaleHeader(d.syncDevicesColPlatform),
              accessor: (row) => row.platform,
              mono: true,
              sortable: true,
              render: (row) => (
                <span className="font-mono text-sm" dir="ltr">
                  {row.platform}
                </span>
              ),
            },
            {
              id: "contract",
              header: activeLocaleHeader(d.syncDevicesColContract),
              accessor: (row) => row.contractVersion ?? "",
              mono: true,
              render: (row) =>
                row.contractVersion === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.contractVersion}
                  </span>
                ),
            },
            {
              id: "attestation",
              header: activeLocaleHeader(d.syncDevicesColAttestation),
              accessor: (row) => (row.attested ? "attested" : "pending"),
              render: (row) =>
                row.attested ? (
                  <Badge tone="primary">{d.syncDevicesAttested}</Badge>
                ) : (
                  <Badge>{d.syncDevicesAttestationPending}</Badge>
                ),
            },
            {
              id: "trustFlags",
              header: activeLocaleHeader(d.syncDevicesColTrustFlags),
              accessor: (row) => JSON.stringify(row.trustFlags),
              render: (row) => trustFlagChips(d, row.trustFlags),
            },
            {
              id: "lastPull",
              header: activeLocaleHeader(d.syncDevicesColLastPull),
              accessor: (row) => row.lastPullAt ?? "",
              sortable: true,
              render: (row) => (
                <span dir="ltr">{formatDateTime(row.lastPullAt, locale)}</span>
              ),
            },
            {
              id: "lastPush",
              header: activeLocaleHeader(d.syncDevicesColLastPush),
              accessor: (row) => row.lastPushAt ?? "",
              sortable: true,
              render: (row) => (
                <span dir="ltr">{formatDateTime(row.lastPushAt, locale)}</span>
              ),
            },
            {
              id: "status",
              header: activeLocaleHeader(d.syncDevicesColStatus),
              accessor: (row) => (row.revokedAt === null ? "active" : "revoked"),
              sortable: true,
              render: (row) =>
                row.revokedAt === null ? (
                  <Badge tone="primary">{d.syncDevicesStatusActive}</Badge>
                ) : (
                  <Badge>{d.syncDevicesStatusRevoked}</Badge>
                ),
            },
            {
              id: "dataExpiry",
              header: activeLocaleHeader(d.syncDevicesColDataExpiry),
              accessor: (row) => row.dataExpiresAt ?? "",
              render: (row) => (
                <span dir="ltr">{formatDateTime(row.dataExpiresAt, locale)}</span>
              ),
            },
            {
              id: "pending",
              header: activeLocaleHeader(d.syncDevicesColPending),
              accessor: (row) => String(row.pendingCommands),
              sortable: true,
              render: (row) => formatMessage(d.syncDevicesPendingCommands, { count: row.pendingCommands }),
            },
          ]}
          rows={[...current]}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
          rowActions={[
            {
              id: "revoke",
              label: d.syncDevicesActionRevoke,
              danger: true,
              onSelect: (row: DeviceRow) => {
                if (row.revokedAt !== null) return;
                setReason("");
                setRevokeRow(row);
              },
            },
            {
              id: "flag",
              label: d.syncDevicesActionFlag,
              onSelect: (row: DeviceRow) => {
                setFlagKey("");
                setFlagValue("");
                setFlagRow(row);
              },
            },
            {
              id: "expiry",
              label: d.syncDevicesActionExpiry,
              onSelect: (row: DeviceRow) => {
                setExpiryPick("");
                setExpiryClear(false);
                setExpiryRow(row);
              },
            },
            {
              id: "detail",
              label: d.syncDevicesActionDetail,
              onSelect: (row: DeviceRow) => {
                void openDetail(row);
              },
            },
          ]}
          empty={{ title: d.syncDevicesEmpty }}
        />
      </Card>

      {/* -- revoke dialog (confirm + reason) -------------------------------- */}
      <Dialog
        open={revokeRow !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeRow(null);
        }}
        title={`${d.syncDevicesRevokeTitle} · ${revokeRow?.name ?? revokeRow?.id.slice(0, 8) ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-700">{d.syncDevicesRevokeConfirm}</p>
          <Input
            label={d.syncDevicesRevokeReason}
            placeholder={d.syncDevicesRevokeReasonPlaceholder}
            value={reason}
            onValueChange={setReason}
          />
          <div className="sticky bottom-0 mt-2 flex justify-end gap-2 border-t border-subtle pt-3">
            <Button variant="secondary" onClick={() => setRevokeRow(null)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="danger"
              loading={revokeRow !== null && busy === `revoke-${revokeRow.id}`}
              onClick={() => void revoke()}
            >
              {d.syncDevicesRevokeAction}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- trust flag dialog (jsonb merge) --------------------------------- */}
      <Dialog
        open={flagRow !== null}
        onOpenChange={(open) => {
          if (!open) setFlagRow(null);
        }}
        title={`${d.syncDevicesFlagTitle} · ${flagRow?.name ?? flagRow?.id.slice(0, 8) ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <Input
            label={d.syncDevicesFlagKey}
            value={flagKey}
            onValueChange={setFlagKey}
            mono
            bidiIsolate
            required
          />
          <Input
            label={d.syncDevicesFlagValue}
            value={flagValue}
            onValueChange={setFlagValue}
            hint={d.syncDevicesFlagHint}
          />
          <div className="sticky bottom-0 mt-2 flex justify-end gap-2 border-t border-subtle pt-3">
            <Button variant="secondary" onClick={() => setFlagRow(null)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={flagRow !== null && busy === `flag-${flagRow.id}`}
              disabled={flagKey.trim() === ""}
              onClick={() => void flag()}
            >
              {d.syncDevicesFlagAction}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- data expiry dialog ---------------------------------------------- */}
      <Dialog
        open={expiryRow !== null}
        onOpenChange={(open) => {
          if (!open) setExpiryRow(null);
        }}
        title={`${d.syncDevicesExpiryTitle} · ${expiryRow?.name ?? expiryRow?.id.slice(0, 8) ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <DatePicker
            locale={locale}
            label={d.syncDevicesExpiryAt}
            value={expiryPick}
            onSelect={setExpiryPick}
            disabled={expiryClear}
          />
          <div>
            <Button variant="secondary" onClick={() => setExpiryClear((value) => !value)}>
              {expiryClear ? d.syncDevicesExpiryAt : d.syncDevicesExpiryClear}
            </Button>
          </div>
          <div className="sticky bottom-0 mt-2 flex justify-end gap-2 border-t border-subtle pt-3">
            <Button variant="secondary" onClick={() => setExpiryRow(null)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={expiryRow !== null && busy === `expiry-${expiryRow.id}`}
              disabled={!expiryClear && expiryPick === ""}
              onClick={() => void expire()}
            >
              {d.syncDevicesExpiryAction}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* -- sync state drawer (cursors per entity) -------------------------- */}
      <Dialog
        open={detailRow !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDetailRow(null);
            setDetail(null);
            setDetailFailed(false);
          }
        }}
        title={`${d.syncDevicesDetailTitle} · ${detailRow?.name ?? detailRow?.id.slice(0, 8) ?? ""}`}
        size="lg"
      >
        {detailFailed ? (
          <p className="text-sm text-danger-text">{d.syncDevicesDetailLoadError}</p>
        ) : detail === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            {d.loading}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-900">{d.syncDevicesDetailCursors}</h2>
            {detail.cursors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{d.syncDevicesDetailNoCursors}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-subtle text-start text-muted-foreground">
                      <th scope="col" className="py-2 pe-4 text-start font-medium">
                        {d.syncDevicesDetailEntity}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-start font-medium">
                        {d.syncDevicesDetailLastSeq}
                      </th>
                      <th scope="col" className="py-2 text-start font-medium">
                        {d.syncDevicesDetailAckedAt}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.cursors.map((cursor) => (
                      <tr key={cursor.entityType} className="border-b border-subtle last:border-0">
                        <td className="py-2 pe-4 font-mono text-xs" dir="ltr">
                          {cursor.entityType}
                        </td>
                        <td className="py-2 pe-4 font-mono text-xs" dir="ltr">
                          {cursor.lastSeq}
                        </td>
                        <td className="py-2" dir="ltr">
                          {formatDateTime(cursor.acknowledgedAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
