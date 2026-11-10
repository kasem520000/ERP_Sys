"use client";

/**
 * WEB-037 (PHASE-037) — the ZATCA Phase-1 device registry manager
 * (/settings/tax/zatca-devices; settings archetype, 12-template
 * discipline): three tabs over the tax/zatca/devices routes —
 *
 * 1. Devices (BR-061): the EIAS device registry with the create/edit
 *    dialogs over the descriptive + placeholder fields. registrationStatus
 *    is the honest NOT_REGISTERED placeholder — Phase-2 CSID is 054's.
 *    There is NO delete anywhere: each device is the anchor of an ICV
 *    stamp chain, so the delete-disabled hint stays on the tab.
 * 2. Chain & verification (INV-027): the device's stamped invoices in
 *    ICV order (PIH/hash truncated for display) plus the walk verdict —
 *    the walk FAILS CLOSED, so a broken chain arrives as a 422
 *    ZATCA_CHAIN_BROKEN error envelope carrying the failure pack in
 *    error.details; POST verify re-runs it.
 * 3. Backfill (§2.7): the DRY-RUN plan first (GET backfill/plan), then
 *    the explicit run (POST backfill) — issuance-ordered, idempotent,
 *    resumable; already-stamped rows are skipped on re-run.
 *
 * Writes gate in-screen on tax.einvoicing.devices.manage (the page passes
 * the session-derived flag); every API failure renders localized.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  NumberInput,
  Select,
  Tabs,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  BranchRow,
  ZatcaBackfillPlan,
  ZatcaBackfillResult,
  ZatcaChainFailure,
  ZatcaChainRow,
  ZatcaChainVerification,
  ZatcaDeviceRow,
} from "../lib/api-types";
import { isRecord } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { formatMessage, localizedApiError, localizedName } from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, InfoNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

type ManagerTab = "devices" | "chain" | "backfill";

/** The solution-provider VAT is exactly 15 digits (the server's rule). */
const VAT_RE = /^\d{15}$/;

/** Hashes render truncated (BR display rule) — the full value stays in the record. */
const HASH_SIZE = 12;

const BACKFILL_LIMIT_DEFAULT = 200;
const BACKFILL_LIMIT_MAX = 1000;

/** The create/edit device form draft (all inputs are strings). */
interface DeviceDraft {
  name: string;
  nameAr: string;
  deviceUuid: string;
  deviceSerial: string;
  solutionProviderName: string;
  solutionProviderVat: string;
  branchId: string;
  note: string;
}

function emptyDeviceDraft(): DeviceDraft {
  return {
    name: "",
    nameAr: "",
    deviceUuid: "",
    deviceSerial: "",
    solutionProviderName: "",
    solutionProviderVat: "",
    branchId: "",
    note: "",
  };
}

function draftFromDevice(row: ZatcaDeviceRow): DeviceDraft {
  return {
    name: row.name,
    nameAr: row.nameAr ?? "",
    deviceUuid: row.deviceUuid ?? "",
    deviceSerial: row.deviceSerial ?? "",
    solutionProviderName: row.solutionProviderName ?? "",
    solutionProviderVat: row.solutionProviderVat ?? "",
    branchId: row.branchId ?? "",
    note: row.note ?? "",
  };
}

/** The wire body — empty optional strings become explicit nulls (clears on PATCH). */
function draftBody(draft: DeviceDraft): Record<string, string | null> {
  const trimOrNull = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };
  return {
    name: draft.name.trim(),
    nameAr: trimOrNull(draft.nameAr),
    deviceUuid: trimOrNull(draft.deviceUuid),
    deviceSerial: trimOrNull(draft.deviceSerial),
    solutionProviderName: trimOrNull(draft.solutionProviderName),
    solutionProviderVat: trimOrNull(draft.solutionProviderVat),
    branchId: draft.branchId === "" ? null : draft.branchId,
    note: trimOrNull(draft.note),
  };
}

function deviceDraftReady(draft: DeviceDraft): boolean {
  if (draft.name.trim() === "") {
    return false;
  }
  return draft.solutionProviderVat.trim() === "" || VAT_RE.test(draft.solutionProviderVat.trim());
}

function truncateHash(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.length <= HASH_SIZE ? value : `${value.slice(0, HASH_SIZE)}…`;
}

/**
 * INV-027 fails closed: a broken chain surfaces as ZATCA_CHAIN_BROKEN with
 * the failure pack in error.details ({ deviceId, atIcv, reason, failures }).
 * Narrow it defensively — the honest verdict is the UI's job, never an
 * inference from local state.
 */
function chainFailuresOf(error: ApiErrorBody): readonly ZatcaChainFailure[] {
  if (!isRecord(error.details) || !Array.isArray(error.details.failures)) {
    return [];
  }
  return (error.details.failures as unknown[]).filter(isRecord).map((row) => ({
    icv: typeof row.icv === "number" ? row.icv : null,
    invoiceId: typeof row.invoiceId === "string" ? row.invoiceId : "",
    reason: typeof row.reason === "string" ? row.reason : "",
  }));
}

export function ZatcaDevicesManager({
  locale,
  initialDevices,
  branches,
  canManage,
}: {
  locale: Locale;
  initialDevices: readonly ZatcaDeviceRow[];
  branches: readonly BranchRow[];
  canManage: boolean;
}): JSX.Element {
  const d = getDictionary(locale);
  const router = useRouter();

  const [tab, setTab] = useState<ManagerTab>("devices");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- devices tab state --------------------------------------------------------
  const [devices, setDevices] = useState<readonly ZatcaDeviceRow[]>(initialDevices);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<DeviceDraft>(emptyDeviceDraft);
  const [editTarget, setEditTarget] = useState<ZatcaDeviceRow | null>(null);
  const [editDraft, setEditDraft] = useState<DeviceDraft>(emptyDeviceDraft);

  // -- chain tab state ----------------------------------------------------------
  const [chainDeviceId, setChainDeviceId] = useState("");
  const [chain, setChain] = useState<readonly ZatcaChainRow[]>([]);
  const [verification, setVerification] = useState<ZatcaChainVerification | null>(null);
  const [chainFailures, setChainFailures] = useState<readonly ZatcaChainFailure[]>([]);
  const [chainLoading, setChainLoading] = useState(false);

  // -- backfill tab state ---------------------------------------------------------
  const [backfillDeviceId, setBackfillDeviceId] = useState("");
  const [backfillLimit, setBackfillLimit] = useState(String(BACKFILL_LIMIT_DEFAULT));
  const [plan, setPlan] = useState<ZatcaBackfillPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [runResult, setRunResult] = useState<ZatcaBackfillResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deviceOptions = useMemo(
    () =>
      devices.map((device) => ({
        value: device.id,
        label: localizedName(device.name, device.nameAr, locale),
      })),
    [devices, locale],
  );

  /**
   * The branch registry is a separate permission (tenancy.branches.manage);
   * devices referencing unreadable branches stay selectable with the honest
   * raw id (the custom-fields entities fallback).
   */
  const branchOptions = useMemo(() => {
    const options = branches.map((branch) => ({
      value: branch.id,
      label: localizedName(branch.name, branch.nameAr, locale),
    }));
    for (const device of devices) {
      if (device.branchId === null || options.some((option) => option.value === device.branchId)) {
        continue;
      }
      options.push({ value: device.branchId, label: device.branchId });
    }
    return options;
  }, [branches, devices, locale]);

  function branchLabel(branchId: string | null): string {
    if (branchId === null) {
      return "—";
    }
    const found = branches.find((branch) => branch.id === branchId);
    return found === undefined ? branchId : localizedName(found.name, found.nameAr, locale);
  }

  /** Stable ZATCA error family → honest messages (localizedApiError covers the rest). */
  function zatcaError(failure: { error: ApiErrorBody; retryAfterSeconds?: number }): string {
    if (failure.error.code === "ZATCA_DEVICE_NOT_FOUND") {
      return d.errorsNotFound;
    }
    if (failure.error.code.startsWith("ZATCA_")) {
      return d.zatcaDevicesErrorsGeneric;
    }
    return localizedApiError(d, failure.error, failure.retryAfterSeconds);
  }

  function openCreate(): void {
    setCreateDraft(emptyDeviceDraft());
    setCreateOpen(true);
  }

  function openEdit(row: ZatcaDeviceRow): void {
    setEditTarget(row);
    setEditDraft(draftFromDevice(row));
  }

  // -- devices actions ------------------------------------------------------------

  async function createDevice(): Promise<void> {
    if (!deviceDraftReady(createDraft)) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("device-create");
    setError(null);
    setNotice(null);
    const created = await bffFetch<ZatcaDeviceRow>("tax/zatca/devices", {
      method: "POST",
      body: draftBody(createDraft),
    });
    setBusy(null);
    if (!created.ok) {
      setError(zatcaError(created));
      return;
    }
    setDevices((rows) => [...rows, created.data]);
    setCreateOpen(false);
    setNotice(d.zatcaDevicesCreateSuccess);
    router.refresh();
  }

  async function saveEdit(): Promise<void> {
    if (editTarget === null) {
      return;
    }
    if (!deviceDraftReady(editDraft)) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("device-edit");
    setError(null);
    setNotice(null);
    const updated = await bffFetch<ZatcaDeviceRow>(`tax/zatca/devices/${editTarget.id}`, {
      method: "PATCH",
      body: draftBody(editDraft),
    });
    setBusy(null);
    if (!updated.ok) {
      setError(zatcaError(updated));
      return;
    }
    setDevices((rows) => rows.map((row) => (row.id === editTarget.id ? updated.data : row)));
    setEditTarget(null);
    setNotice(d.zatcaDevicesUpdateSuccess);
    router.refresh();
  }

  // -- chain actions ----------------------------------------------------------------

  async function loadChain(deviceId: string): Promise<void> {
    setChainLoading(true);
    setError(null);
    setNotice(null);
    setChain([]);
    setVerification(null);
    setChainFailures([]);
    const loaded = await bffFetch<{
      chain: readonly ZatcaChainRow[];
      verification: ZatcaChainVerification;
    }>(`tax/zatca/devices/${deviceId}/chain`);
    setChainLoading(false);
    if (!loaded.ok) {
      // The walk fails closed — the chain view itself refuses to serve.
      if (loaded.error.code === "ZATCA_CHAIN_BROKEN") {
        setChainFailures(chainFailuresOf(loaded.error));
        return;
      }
      setError(zatcaError(loaded));
      return;
    }
    setChain(loaded.data.chain);
    setVerification(loaded.data.verification);
  }

  async function verifyNow(): Promise<void> {
    if (chainDeviceId === "") {
      return;
    }
    setBusy("chain-verify");
    setError(null);
    setNotice(null);
    const outcome = await bffFetch<ZatcaChainVerification>(
      `tax/zatca/devices/${chainDeviceId}/verify`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!outcome.ok) {
      setVerification(null);
      if (outcome.error.code === "ZATCA_CHAIN_BROKEN") {
        setChainFailures(chainFailuresOf(outcome.error));
        return;
      }
      setError(zatcaError(outcome));
      return;
    }
    setChainFailures([]);
    setVerification(outcome.data);
    // The walk held — the chain view can now serve the rows (loadChain
    // clears the notice slot, so the verdict lands after the refresh).
    await loadChain(chainDeviceId);
    setNotice(d.zatcaDevicesVerifyDone);
  }

  // -- backfill actions ---------------------------------------------------------------

  function limitValue(): number {
    const parsed = Number(backfillLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return BACKFILL_LIMIT_DEFAULT;
    }
    return Math.min(parsed, BACKFILL_LIMIT_MAX);
  }

  async function loadPlan(deviceId: string, limit: number): Promise<void> {
    setPlanLoading(true);
    setError(null);
    setNotice(null);
    setPlan(null);
    setRunResult(null);
    const loaded = await bffFetch<ZatcaBackfillPlan>(
      `tax/zatca/devices/${deviceId}/backfill/plan?limit=${limit}`,
    );
    setPlanLoading(false);
    if (!loaded.ok) {
      setError(zatcaError(loaded));
      return;
    }
    setPlan(loaded.data);
  }

  async function runBackfill(): Promise<void> {
    if (backfillDeviceId === "" || plan === null) {
      return;
    }
    setBusy("backfill-run");
    setError(null);
    setNotice(null);
    const outcome = await bffFetch<ZatcaBackfillResult>(
      `tax/zatca/devices/${backfillDeviceId}/backfill`,
      { method: "POST", body: { limit: limitValue() } },
    );
    setBusy(null);
    setConfirmOpen(false);
    if (!outcome.ok) {
      if (outcome.error.code === "ZATCA_QR_PAYLOAD_REQUIRED") {
        setError(d.zatcaDevicesBackfillRequiresVat);
        return;
      }
      setError(zatcaError(outcome));
      return;
    }
    setRunResult(outcome.data);
    // The plan is consumed — a fresh dry-run is required before the next
    // run (the dry-run-first rule holds for every write).
    setPlan(null);
    setNotice(d.zatcaDevicesBackfillSuccess);
    // The device icvCounter moved — refresh the registry (and the shell).
    const refreshed = await bffFetch<{ devices: readonly ZatcaDeviceRow[] }>("tax/zatca/devices");
    if (refreshed.ok) {
      setDevices(refreshed.data.devices);
    }
    router.refresh();
  }

  // -- render --------------------------------------------------------------------------

  const deviceDialogBody = (
    draft: DeviceDraft,
    setDraft: (next: DeviceDraft) => void,
    isEdit: boolean,
  ): JSX.Element => (
    <div className="flex flex-col gap-4">
      {isEdit && (
        <DefList
          items={[
            {
              term: d.zatcaDevicesColStatus,
              children: <Badge tone="neutral">{d.zatcaDevicesStatusPlaceholder}</Badge>,
            },
            {
              term: d.zatcaDevicesIcvCounter,
              children: (
                <span className="font-mono tabular-nums" dir="ltr">
                  {editTarget?.icvCounter ?? 0}
                </span>
              ),
            },
          ]}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={d.zatcaDevicesDeviceName}
          value={draft.name}
          onValueChange={(value) => setDraft({ ...draft, name: value })}
          error={draft.name.trim() === "" ? d.zatcaDevicesNameRequired : undefined}
          required
        />
        <Input
          label={`${d.zatcaDevicesDeviceNameAr} (${d.zatcaDevicesOptional})`}
          value={draft.nameAr}
          onValueChange={(value) => setDraft({ ...draft, nameAr: value })}
        />
        <Input
          label={d.zatcaDevicesDeviceUuid}
          hint={d.zatcaDevicesDeviceUuidHint}
          value={draft.deviceUuid}
          onValueChange={(value) => setDraft({ ...draft, deviceUuid: value })}
          mono
          bidiIsolate
        />
        <Input
          label={d.zatcaDevicesDeviceSerial}
          value={draft.deviceSerial}
          onValueChange={(value) => setDraft({ ...draft, deviceSerial: value })}
          mono
          bidiIsolate
        />
        <Input
          label={d.zatcaDevicesProviderName}
          value={draft.solutionProviderName}
          onValueChange={(value) => setDraft({ ...draft, solutionProviderName: value })}
        />
        <Input
          label={d.zatcaDevicesProviderVat}
          hint={d.zatcaDevicesProviderVatHint}
          value={draft.solutionProviderVat}
          onValueChange={(value) => setDraft({ ...draft, solutionProviderVat: value })}
          error={
            draft.solutionProviderVat.trim() !== "" &&
            !VAT_RE.test(draft.solutionProviderVat.trim())
              ? d.zatcaDevicesProviderVatInvalid
              : undefined
          }
          mono
          bidiIsolate
        />
        <Select
          label={d.zatcaDevicesBranch}
          value={draft.branchId}
          onValueChange={(value) => setDraft({ ...draft, branchId: value })}
          options={[{ value: "", label: d.zatcaDevicesBranchAny }, ...branchOptions]}
        />
        <Input
          label={`${d.zatcaDevicesNote} (${d.zatcaDevicesOptional})`}
          value={draft.note}
          onValueChange={(value) => setDraft({ ...draft, note: value })}
        />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Tabs
        items={[
          { value: "devices", label: d.zatcaDevicesDevicesTab },
          { value: "chain", label: d.zatcaDevicesChainTab },
          { value: "backfill", label: d.zatcaDevicesBackfillTab },
        ]}
        value={tab}
        onValueChange={(value) => setTab(value as ManagerTab)}
      >
        {tab === "devices" && (
          <div className="flex flex-col gap-4">
            <InfoNotice>{d.zatcaDevicesPhase2Note}</InfoNotice>
            {canManage && (
              <div className="flex justify-end">
                <Button variant="primary" onClick={openCreate}>
                  {d.zatcaDevicesCreateDevice}
                </Button>
              </div>
            )}
            <Card title={d.zatcaDevicesDevicesTab}>
              <DataTable
                columns={[
                  {
                    id: "name",
                    header: activeLocaleHeader(d.zatcaDevicesColName),
                    accessor: (row) => localizedName(row.name, row.nameAr, locale),
                    sortable: true,
                    render: (row) => (
                      <span className="flex flex-col">
                        <span>{row.name}</span>
                        {row.nameAr !== null && (
                          <span className="text-xs text-gray-600">{row.nameAr}</span>
                        )}
                      </span>
                    ),
                  },
                  {
                    id: "registrationStatus",
                    header: activeLocaleHeader(d.zatcaDevicesColStatus),
                    accessor: (row) => row.registrationStatus,
                    render: (row) => (
                      <span className="flex flex-col items-start gap-0.5">
                        <Badge tone="neutral" mono bidiIsolate>
                          {row.registrationStatus}
                        </Badge>
                        <span className="text-xs text-gray-600">
                          {d.zatcaDevicesStatusPlaceholder}
                        </span>
                      </span>
                    ),
                  },
                  {
                    id: "icvCounter",
                    header: activeLocaleHeader(d.zatcaDevicesColCounter),
                    accessor: (row) => String(row.icvCounter),
                    numeric: true,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono tabular-nums" dir="ltr">
                        {row.icvCounter}
                      </span>
                    ),
                  },
                  {
                    id: "deviceUuid",
                    header: activeLocaleHeader(d.zatcaDevicesColDeviceUuid),
                    accessor: (row) => row.deviceUuid ?? "",
                    mono: true,
                    render: (row) =>
                      row.deviceUuid === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.deviceUuid}
                        </span>
                      ),
                  },
                  {
                    id: "deviceSerial",
                    header: activeLocaleHeader(d.zatcaDevicesColSerial),
                    accessor: (row) => row.deviceSerial ?? "",
                    mono: true,
                    render: (row) =>
                      row.deviceSerial === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.deviceSerial}
                        </span>
                      ),
                  },
                  {
                    id: "branch",
                    header: activeLocaleHeader(d.zatcaDevicesColBranch),
                    accessor: (row) => branchLabel(row.branchId),
                    render: (row) =>
                      row.branchId === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        branchLabel(row.branchId)
                      ),
                  },
                  {
                    id: "createdAt",
                    header: activeLocaleHeader(d.zatcaDevicesColCreatedAt),
                    accessor: (row) => row.createdAt,
                    sortable: true,
                    render: (row) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.createdAt.slice(0, 10)}
                      </span>
                    ),
                  },
                ]}
                rows={[...devices]}
                rowKey={(row) => row.id}
                rowActions={
                  canManage
                    ? [
                        {
                          id: "edit",
                          label: d.commonEdit,
                          onSelect: (row: ZatcaDeviceRow) => openEdit(row),
                        },
                      ]
                    : undefined
                }
                empty={{ title: d.zatcaDevicesEmpty }}
              />
            </Card>
            <InfoNotice>{d.zatcaDevicesDeleteDisabled}</InfoNotice>
          </div>
        )}

        {tab === "chain" && (
          <div className="flex flex-col gap-4">
            <div className="w-72">
              <Select
                label={d.zatcaDevicesPickDevice}
                value={chainDeviceId}
                onValueChange={(value) => {
                  setChainDeviceId(value);
                  if (value === "") {
                    setChain([]);
                    setVerification(null);
                    setChainFailures([]);
                  } else {
                    void loadChain(value);
                  }
                }}
                placeholder={d.zatcaDevicesPickDevice}
                options={deviceOptions}
              />
            </div>

            {chainDeviceId === "" ? (
              <p className="text-sm text-gray-600">{d.zatcaDevicesPickDeviceFirst}</p>
            ) : (
              <>
                <Card title={d.zatcaDevicesVerificationTitle}>
                  <div className="flex flex-col gap-3">
                    {chainFailures.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <ErrorNotice>{d.zatcaDevicesVerificationFailed}</ErrorNotice>
                        <ul className="flex flex-col gap-1">
                          {chainFailures.map((failure, index) => (
                            <li
                              key={`${failure.invoiceId}-${index}`}
                              className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-subtle px-2 py-1 text-sm"
                            >
                              <span className="font-mono text-xs" dir="ltr">
                                {d.zatcaDevicesVerificationFailureIcv}: {failure.icv ?? "—"}
                              </span>
                              <span className="font-mono text-xs" dir="ltr">
                                {failure.invoiceId.slice(0, 8)}
                              </span>
                              <span className="text-gray-700">
                                {d.zatcaDevicesVerificationFailureReason}: {failure.reason}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verification !== null && verification.ok && (
                      <div className="flex flex-col gap-2">
                        <SuccessNotice>{d.zatcaDevicesVerificationOk}</SuccessNotice>
                        <p className="text-sm text-gray-700">
                          {formatMessage(d.zatcaDevicesVerificationChecked, {
                            checked: verification.checked,
                          })}
                        </p>
                        <DefList
                          items={[
                            {
                              term: d.zatcaDevicesChainHead,
                              children: (
                                <span className="font-mono tabular-nums" dir="ltr">
                                  {devices.find((row) => row.id === chainDeviceId)?.icvCounter ?? 0}
                                </span>
                              ),
                            },
                          ]}
                        />
                      </div>
                    )}
                    {chainLoading && <p className="text-sm text-gray-600">{d.loading}</p>}
                    {canManage && (
                      <Button
                        variant="secondary"
                        className="self-start"
                        loading={busy === "chain-verify"}
                        onClick={() => void verifyNow()}
                      >
                        {d.zatcaDevicesVerifyNow}
                      </Button>
                    )}
                  </div>
                </Card>

                {chainFailures.length === 0 && (
                  <Card title={d.zatcaDevicesChainTitle}>
                    {chain.length === 0 ? (
                      <p className="text-sm text-gray-600">{d.zatcaDevicesChainEmpty}</p>
                    ) : (
                      <DataTable
                        columns={[
                          {
                            id: "invoice",
                            header: activeLocaleHeader(d.zatcaDevicesChainColInvoice),
                            accessor: (row) => row.invoiceNo ?? row.id,
                            sortable: true,
                            render: (row) => (
                              <span className="font-mono text-sm" dir="ltr">
                                {row.invoiceNo ?? row.id.slice(0, 8)}
                              </span>
                            ),
                          },
                          {
                            id: "icv",
                            header: activeLocaleHeader(d.zatcaDevicesChainColIcv),
                            accessor: (row) => String(row.icv ?? 0),
                            numeric: true,
                            sortable: true,
                            render: (row) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {row.icv ?? "—"}
                              </span>
                            ),
                          },
                          {
                            id: "classification",
                            header: activeLocaleHeader(d.zatcaDevicesChainColClassification),
                            accessor: (row) => row.classification ?? "",
                            render: (row) =>
                              row.classification === "STANDARD" ? (
                                <Badge tone="primary">{d.zatcaDevicesClassificationStandard}</Badge>
                              ) : row.classification === "SIMPLIFIED" ? (
                                <Badge tone="neutral">
                                  {d.zatcaDevicesClassificationSimplified}
                                </Badge>
                              ) : (
                                <span className="text-xs text-gray-600">
                                  {d.zatcaDevicesClassificationNone}
                                </span>
                              ),
                          },
                          {
                            id: "posted",
                            header: activeLocaleHeader(d.zatcaDevicesChainColPosted),
                            accessor: (row) => row.postedAt ?? row.invoiceDate,
                            sortable: true,
                            render: (row) => (
                              <span className="font-mono text-xs" dir="ltr">
                                {(row.postedAt ?? row.invoiceDate).slice(0, 19).replace("T", " ")}
                              </span>
                            ),
                          },
                          {
                            id: "amount",
                            header: activeLocaleHeader(d.zatcaDevicesChainColAmount),
                            accessor: (row) => row.totalGross,
                            numeric: true,
                            render: (row) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {row.totalGross} {row.currencyCode}
                              </span>
                            ),
                          },
                          {
                            id: "pih",
                            header: activeLocaleHeader(d.zatcaDevicesChainColPih),
                            accessor: (row) => row.previousInvoiceHash ?? "",
                            mono: true,
                            render: (row) => {
                              const truncated = truncateHash(row.previousInvoiceHash);
                              return truncated === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span
                                  className="font-mono text-xs"
                                  dir="ltr"
                                  title={
                                    row.icv === 1
                                      ? d.zatcaDevicesGenesisPih
                                      : d.zatcaDevicesHashTruncated
                                  }
                                >
                                  {truncated}
                                </span>
                              );
                            },
                          },
                          {
                            id: "invoiceHash",
                            header: activeLocaleHeader(d.zatcaDevicesChainColHash),
                            accessor: (row) => row.invoiceHash ?? "",
                            mono: true,
                            render: (row) => {
                              const truncated = truncateHash(row.invoiceHash);
                              return truncated === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span
                                  className="font-mono text-xs"
                                  dir="ltr"
                                  title={`${d.zatcaDevicesChainColHashVersion}: ${row.invoiceHashVersion ?? "—"} · ${d.zatcaDevicesHashTruncated}`}
                                >
                                  {truncated}
                                </span>
                              );
                            },
                          },
                          {
                            id: "qr",
                            header: activeLocaleHeader(d.zatcaDevicesChainColQr),
                            accessor: (row) => (row.qrPayload === null ? "0" : "1"),
                            render: (row) =>
                              row.qrPayload === null ? (
                                <Badge tone="neutral">{d.zatcaDevicesQrMissing}</Badge>
                              ) : (
                                <Badge tone="primary">{d.zatcaDevicesQrPresent}</Badge>
                              ),
                          },
                        ]}
                        rows={[...chain]}
                        rowKey={(row) => row.id}
                        empty={{ title: d.zatcaDevicesChainEmpty }}
                      />
                    )}
                  </Card>
                )}
              </>
            )}
          </div>
        )}

        {tab === "backfill" && (
          <div className="flex flex-col gap-4">
            <Card title={d.zatcaDevicesBackfillTitle}>
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.zatcaDevicesBackfillDryRunNote}</InfoNotice>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-72">
                    <Select
                      label={d.zatcaDevicesPickDevice}
                      value={backfillDeviceId}
                      onValueChange={(value) => {
                        setBackfillDeviceId(value);
                        setPlan(null);
                        setRunResult(null);
                        if (value !== "") {
                          void loadPlan(value, limitValue());
                        }
                      }}
                      placeholder={d.zatcaDevicesPickDevice}
                      options={deviceOptions}
                    />
                  </div>
                  <div className="w-36">
                    <NumberInput
                      label={d.zatcaDevicesBackfillLimit}
                      value={backfillLimit}
                      onValueChange={setBackfillLimit}
                      min={1}
                      max={BACKFILL_LIMIT_MAX}
                    />
                  </div>
                  {canManage && (
                    <Button
                      variant="secondary"
                      disabled={backfillDeviceId === ""}
                      loading={planLoading}
                      onClick={() => void loadPlan(backfillDeviceId, limitValue())}
                    >
                      {d.zatcaDevicesBackfillPlan}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-gray-600">
                  {d.zatcaDevicesIssuanceOrder} {d.zatcaDevicesIdempotentNote}
                </p>

                {plan !== null && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-gray-900">
                      {formatMessage(d.zatcaDevicesBackfillStampable, { count: plan.stampableCount })}
                    </p>
                    <p className="text-xs text-gray-600">{d.zatcaDevicesBackfillPlanNote}</p>
                    {plan.stampableCount === 0 ? (
                      <p className="text-sm text-gray-600">{d.zatcaDevicesBackfillEmpty}</p>
                    ) : (
                      <>
                        <p className="text-sm text-gray-600">{d.zatcaDevicesBackfillCandidates}</p>
                        <DataTable
                          columns={[
                            {
                              id: "invoice",
                              header: activeLocaleHeader(d.zatcaDevicesBackfillColInvoice),
                              accessor: (row) => row.invoiceNo ?? row.invoiceId,
                              sortable: true,
                              render: (row) => (
                                <span className="font-mono text-sm" dir="ltr">
                                  {row.invoiceNo ?? row.invoiceId.slice(0, 8)}
                                </span>
                              ),
                            },
                            {
                              id: "posted",
                              header: activeLocaleHeader(d.zatcaDevicesBackfillColPosted),
                              accessor: (row) => row.postedAt ?? "",
                              sortable: true,
                              render: (row) => (
                                <span className="font-mono text-xs" dir="ltr">
                                  {row.postedAt === null
                                    ? "—"
                                    : row.postedAt.slice(0, 19).replace("T", " ")}
                                </span>
                              ),
                            },
                            {
                              id: "gross",
                              header: activeLocaleHeader(d.zatcaDevicesBackfillColGross),
                              accessor: (row) => row.totalGross,
                              numeric: true,
                              render: (row) => (
                                <span className="font-mono tabular-nums" dir="ltr">
                                  {row.totalGross}
                                </span>
                              ),
                            },
                          ]}
                          rows={[...plan.candidates]}
                          rowKey={(row) => row.invoiceId}
                          empty={{ title: d.zatcaDevicesBackfillEmpty }}
                        />
                        {canManage && (
                          <Button
                            variant="primary"
                            className="self-start"
                            loading={busy === "backfill-run"}
                            onClick={() => setConfirmOpen(true)}
                          >
                            {d.zatcaDevicesBackfillRun}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {runResult !== null && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-gray-700">
                      {formatMessage(d.zatcaDevicesBackfillStamped, { stamped: runResult.stamped })}{" "}
                      · {formatMessage(d.zatcaDevicesBackfillSkipped, { skipped: runResult.skipped })}
                    </p>
                    <Card title={d.zatcaDevicesBackfillResults}>
                      <DataTable
                        columns={[
                          {
                            id: "invoice",
                            header: activeLocaleHeader(d.zatcaDevicesBackfillColInvoice),
                            accessor: (row) => row.invoiceId,
                            render: (row) => (
                              <span className="font-mono text-xs" dir="ltr">
                                {row.invoiceId}
                              </span>
                            ),
                          },
                          {
                            id: "icv",
                            header: activeLocaleHeader(d.zatcaDevicesBackfillColIcv),
                            accessor: (row) => String(row.icv),
                            numeric: true,
                            render: (row) => (
                              <span className="font-mono tabular-nums" dir="ltr">
                                {row.icv}
                              </span>
                            ),
                          },
                        ]}
                        rows={[...runResult.results]}
                        rowKey={(row) => row.invoiceId}
                        empty={{ title: d.zatcaDevicesBackfillEmpty }}
                      />
                    </Card>
                  </div>
                )}
              </div>
            </Card>

            {/* -- backfill: run confirm ------------------------------------------------ */}
            <Dialog
              open={confirmOpen}
              onOpenChange={(open) => {
                if (!open) setConfirmOpen(false);
              }}
              title={d.zatcaDevicesBackfillRun}
              description={
                plan === null
                  ? undefined
                  : formatMessage(d.zatcaDevicesConfirmBackfill, { count: plan.stampableCount })
              }
            >
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                  {d.commonCancel}
                </Button>
                <Button
                  variant="primary"
                  loading={busy === "backfill-run"}
                  onClick={() => void runBackfill()}
                >
                  {d.zatcaDevicesBackfillRun}
                </Button>
              </div>
            </Dialog>
          </div>
        )}
      </Tabs>

      {/* -- devices: create dialog --------------------------------------------------- */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) setCreateOpen(false);
        }}
        title={d.zatcaDevicesCreateDevice}
        size="lg"
      >
        {deviceDialogBody(createDraft, setCreateDraft, false)}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "device-create"}
            disabled={!deviceDraftReady(createDraft)}
            onClick={() => void createDevice()}
          >
            {d.zatcaDevicesSaveDevice}
          </Button>
        </div>
      </Dialog>

      {/* -- devices: edit dialog (no delete — chain anchor) --------------------------- */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        title={d.zatcaDevicesEditDevice}
        size="lg"
      >
        {deviceDialogBody(editDraft, setEditDraft, true)}
        <p className="mt-3 text-xs text-gray-600">{d.zatcaDevicesDeleteDisabled}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditTarget(null)}>
            {d.zatcaDevicesCancelEdit}
          </Button>
          <Button
            variant="primary"
            loading={busy === "device-edit"}
            disabled={!deviceDraftReady(editDraft)}
            onClick={() => void saveEdit()}
          >
            {d.zatcaDevicesSaveDevice}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
