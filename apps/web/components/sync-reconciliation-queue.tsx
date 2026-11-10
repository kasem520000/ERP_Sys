"use client";

/**
 * PHASE-020 T14 — the revoked-device reconciliation queue (client
 * interactions): the pending-ops table with the reassign-drafts action.
 * The dialog prefills the revoked source device and offers the active
 * devices as targets — when the device list could not be loaded (no
 * identity.devices.manage permission), the target falls back to a manual
 * device-id input (honest degrade, never a silent failure).
 *
 * NOTE: the dismiss action is deliberately NOT offered here — no
 * `POST /api/v1/sync/admin/reconciliation/dismiss` row exists in
 * route-permissions (the registry is the source of truth; see the T14
 * evidence file).
 */
import { useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select, type DataTableSort } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import { bffFetch } from "../lib/client-api";
import { formatDateTime, formatMessage, localizedApiError } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Hand-written wire type (ADR-0003): GET /api/v1/sync/admin/reconciliation. */
export interface ReconciliationRowWire {
  deviceId: string;
  name: string | null;
  revokedAt: string;
  pendingCommands: number;
  ownedDrafts: number;
  oldestPendingAt: string | null;
}

/** A device list entry for the reassign target select (active devices only). */
export interface QueueDeviceOption {
  id: string;
  name: string | null;
  revokedAt: string | null;
}

export function SyncReconciliationQueue({
  locale,
  rows,
  devices,
}: {
  locale: Locale;
  rows: readonly ReconciliationRowWire[];
  devices: readonly QueueDeviceOption[] | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const [current, setCurrent] = useState<readonly ReconciliationRowWire[]>(rows);
  const [sort, setSort] = useState<DataTableSort[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Reassign dialog state.
  const [reassignRow, setReassignRow] = useState<ReconciliationRowWire | null>(null);
  const [toDeviceId, setToDeviceId] = useState("");

  const activeDevices = devices?.filter((device) => device.revokedAt === null) ?? null;

  async function reassign(): Promise<void> {
    if (reassignRow === null || toDeviceId.trim() === "") {
      setError(d.errorsValidation);
      return;
    }
    setBusy("reassign");
    setError(null);
    const result = await bffFetch<{ count: number }>("sync/admin/drafts/reassign", {
      method: "POST",
      body: { fromDeviceId: reassignRow.deviceId, toDeviceId: toDeviceId.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedApiError(d, result.error, result.retryAfterSeconds));
      return;
    }
    const count = result.data.count;
    // The drafts moved off the source device; its un-acked inbox rows stay
    // by design (never silently dropped) — the row stays on the queue with
    // pendingCommands until an explicit dismissal lands (see the file note).
    setCurrent((existing) =>
      existing.map((row) => (row.deviceId === reassignRow.deviceId ? { ...row, ownedDrafts: 0 } : row)),
    );
    setReassignRow(null);
    setToDeviceId("");
    setNotice(formatMessage(d.syncReconciliationReassignedToast, { count }));
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card title={d.syncReconciliationTitle}>
        <DataTable
          columns={[
            {
              id: "device",
              header: activeLocaleHeader(d.syncReconciliationColDevice),
              accessor: (row) => row.deviceId,
              render: (row) => (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-gray-900">{row.name ?? "—"}</span>
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {row.deviceId.slice(0, 8)}
                  </span>
                </span>
              ),
            },
            {
              id: "revokedAt",
              header: activeLocaleHeader(d.syncReconciliationColRevokedAt),
              accessor: (row) => row.revokedAt,
              sortable: true,
              render: (row) => (
                <span dir="ltr">{formatDateTime(row.revokedAt, locale)}</span>
              ),
            },
            {
              id: "pending",
              header: activeLocaleHeader(d.syncReconciliationColPending),
              accessor: (row) => String(row.pendingCommands),
              sortable: true,
              render: (row) =>
                row.pendingCommands > 0 ? (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.pendingCommands}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                ),
            },
            {
              id: "drafts",
              header: activeLocaleHeader(d.syncReconciliationColDrafts),
              accessor: (row) => String(row.ownedDrafts),
              sortable: true,
              render: (row) =>
                row.ownedDrafts > 0 ? (
                  <Badge tone="primary">{row.ownedDrafts}</Badge>
                ) : (
                  <span className="text-muted-foreground">0</span>
                ),
            },
            {
              id: "oldest",
              header: activeLocaleHeader(d.syncReconciliationColOldest),
              accessor: (row) => row.oldestPendingAt ?? "",
              sortable: true,
              render: (row) => (
                <span dir="ltr">{formatDateTime(row.oldestPendingAt, locale)}</span>
              ),
            },
          ]}
          rows={[...current]}
          rowKey={(row) => row.deviceId}
          sort={sort}
          onSortChange={setSort}
          rowActions={[
            {
              id: "reassign",
              label: d.syncReconciliationReassign,
              onSelect: (row: ReconciliationRowWire) => {
                setToDeviceId("");
                setReassignRow(row);
              },
            },
          ]}
          empty={{ title: d.syncReconciliationEmpty }}
        />
      </Card>

      {/* -- reassign dialog -------------------------------------------------- */}
      <Dialog
        open={reassignRow !== null}
        onOpenChange={(open) => {
          if (!open) setReassignRow(null);
        }}
        title={`${d.syncReconciliationReassignTitle} · ${reassignRow?.name ?? reassignRow?.deviceId.slice(0, 8) ?? ""}`}
      >
        <div className="flex flex-col gap-3">
          <Input
            label={d.syncReconciliationReassignFrom}
            value={reassignRow?.deviceId ?? ""}
            readOnly
            mono
            bidiIsolate
          />
          {activeDevices === null ? (
            <div className="flex flex-col gap-2">
              <Input
                label={d.syncReconciliationReassignTo}
                value={toDeviceId}
                onValueChange={setToDeviceId}
                placeholder={d.syncReconciliationReassignToPlaceholder}
                mono
                bidiIsolate
                required
              />
              <p className="text-xs text-muted-foreground">{d.syncReconciliationReassignNoTargets}</p>
            </div>
          ) : (
            <Select
              label={d.syncReconciliationReassignTo}
              value={toDeviceId}
              onValueChange={setToDeviceId}
              placeholder={d.syncReconciliationReassignToPlaceholder}
              required
              options={activeDevices.map((device) => ({
                value: device.id,
                label: `${device.name ?? device.id} · ${device.id.slice(0, 8)}`,
              }))}
            />
          )}
          <div className="sticky bottom-0 mt-2 flex justify-end gap-2 border-t border-subtle pt-3">
            <Button variant="secondary" onClick={() => setReassignRow(null)}>
              {d.commonCancel}
            </Button>
            <Button
              variant="primary"
              loading={busy === "reassign"}
              disabled={toDeviceId.trim() === ""}
              onClick={() => void reassign()}
            >
              {d.syncReconciliationReassignAction}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
