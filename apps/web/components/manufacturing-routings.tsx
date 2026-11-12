"use client";

/**
 * PHASE-042 T-10 — the routing editor (the BOM workspace's exact shape):
 *
 * - the version registry table (item, v{n}, status badge, output UoM,
 *   activated-at) with item + status filters (server-refetched);
 * - the selected version's workspace: header chips, the operations table
 *   (sequence, work center, setup/run hours, the rate-override pair,
 *   bilingual descriptions), DRAFT-only edit (PATCH full-replace through
 *   the multi-row operation editor — the reorder is the sequence numbers
 *   themselves), activate (archives the item's previous ACTIVE version in
 *   the same call — the confirm dialog carries the warning) and
 *   copy-to-new-draft (any status);
 * - the create dialog: STOCK item, output UoM (defaults to the item's base
 *   unit) and the first operation rows.
 *
 * Times and rate overrides stay canonical decimal strings ≤ 6dp
 * (ADR-0009); overrides travel as a pair or not at all (NULL = inherit the
 * work center's rates).
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ItemRow,
  RoutingDetail,
  RoutingRow,
  UomRow,
  WorkCenterRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedManufacturingError,
  localizedRoutingStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Hours ≤ 6dp (setup/run + the rate-override pair share the shape). */
const TIME_RE = /^\d+(\.\d{1,6})?$/;
const SEQ_RE = /^\d{1,3}$/;

/** One editable operation draft (create + DRAFT full-replace share it). */
interface OperationDraft {
  sequence: string;
  workCenterId: string;
  setupTime: string;
  runTime: string;
  fixedCostRate: string;
  varCostRate: string;
  description: string;
  descriptionAr: string;
}

const EMPTY_OP: OperationDraft = {
  sequence: "",
  workCenterId: "",
  setupTime: "",
  runTime: "",
  fixedCostRate: "",
  varCostRate: "",
  description: "",
  descriptionAr: "",
};

function opValid(op: OperationDraft): boolean {
  if (!SEQ_RE.test(op.sequence) || Number(op.sequence) < 1) return false;
  if (op.workCenterId === "") return false;
  if (!TIME_RE.test(op.setupTime) || !TIME_RE.test(op.runTime)) return false;
  if (op.fixedCostRate !== "" && !TIME_RE.test(op.fixedCostRate)) return false;
  if (op.varCostRate !== "" && !TIME_RE.test(op.varCostRate)) return false;
  return true;
}

/** Sequences are unique per routing (the 0065 CHECK floor). */
function opsValid(ops: readonly OperationDraft[]): boolean {
  if (ops.length === 0) return false;
  if (!ops.every(opValid)) return false;
  const sequences = new Set(ops.map((op) => Number(op.sequence)));
  return sequences.size === ops.length;
}

function draftsOf(detail: RoutingDetail): OperationDraft[] {
  return detail.operations.map((op) => ({
    sequence: String(op.sequence),
    workCenterId: op.workCenterId,
    setupTime: op.setupTime,
    runTime: op.runTime,
    fixedCostRate: op.fixedCostRate ?? "",
    varCostRate: op.varCostRate ?? "",
    description: op.description ?? "",
    descriptionAr: op.descriptionAr ?? "",
  }));
}

/** A canonical decimal cell (the exact server string, LTR). */
function decCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

export function ManufacturingRoutings({
  locale,
  initialRows,
  items,
  uoms,
  workCenters,
}: {
  locale: Locale;
  initialRows: readonly RoutingRow[];
  items: readonly ItemRow[];
  uoms: readonly UomRow[];
  workCenters: readonly WorkCenterRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly RoutingRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List filters (server-side refetch).
  const [itemFilter, setItemFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createItemId, setCreateItemId] = useState("");
  const [createUomId, setCreateUomId] = useState("");
  const [createOps, setCreateOps] = useState<OperationDraft[]>([{ ...EMPTY_OP }]);

  // Selected version workspace.
  const [selected, setSelected] = useState<RoutingDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Edit dialog state (DRAFT full-replace).
  const [editOpen, setEditOpen] = useState(false);
  const [editOps, setEditOps] = useState<OperationDraft[]>([{ ...EMPTY_OP }]);

  // Activate confirm dialog state.
  const [activateOpen, setActivateOpen] = useState(false);

  const stockItems = useMemo(
    () => items.filter((item) => item.kind === "STOCK" && item.deletedAt === null),
    [items],
  );
  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);
  const uomLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const uom of uoms) {
      map.set(uom.id, uom.code);
    }
    return map;
  }, [uoms]);
  const workCenterLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const wc of workCenters) {
      map.set(wc.id, `${wc.code} · ${localizedName(wc.name, wc.nameAr, locale)}`);
    }
    return map;
  }, [workCenters, locale]);

  const createReady =
    createItemId !== "" &&
    createUomId !== "" &&
    opsValid(createOps);
  const editReady = selected !== null && opsValid(editOps);

  // -- list ------------------------------------------------------------------------------

  async function loadList(itemId: string, status: string): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (itemId !== "") params.set("itemId", itemId);
    if (status !== "") params.set("status", status);
    const result = await bffFetch<readonly RoutingRow[]>(
      `manufacturing/routings?${params.toString()}`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onFilterChange(itemId: string, status: string): void {
    setItemFilter(itemId);
    setStatusFilter(status);
    void loadList(itemId, status);
  }

  // -- create ----------------------------------------------------------------------------

  async function createRouting(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<RoutingRow>("manufacturing/routings", {
      method: "POST",
      body: {
        itemId: createItemId,
        outputUomId: createUomId,
        operations: createOps.map((op) => ({
          sequence: Number(op.sequence),
          workCenterId: op.workCenterId,
          setupTime: op.setupTime,
          runTime: op.runTime,
          fixedCostRate: op.fixedCostRate === "" ? null : op.fixedCostRate,
          varCostRate: op.varCostRate === "" ? null : op.varCostRate,
          description: op.description.trim() === "" ? null : op.description.trim(),
          descriptionAr: op.descriptionAr.trim() === "" ? null : op.descriptionAr.trim(),
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setCreateOpen(false);
    setCreateItemId("");
    setCreateUomId("");
    setCreateOps([{ ...EMPTY_OP }]);
    setNotice(formatMessage(d.mfgRoutingSavedToast, { version: `v${result.data.versionNo}` }));
    await selectRouting(result.data.id);
  }

  // -- selected workspace ------------------------------------------------------------------

  async function selectRouting(id: string): Promise<void> {
    setDetailLoading(true);
    setError(null);
    const result = await bffFetch<RoutingDetail>(`manufacturing/routings/${id}`);
    setDetailLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setSelected(result.data);
  }

  async function refreshAfterAction(id: string, toast?: string): Promise<void> {
    const result = await bffFetch<RoutingDetail>(`manufacturing/routings/${id}`);
    if (result.ok) {
      setSelected(result.data);
      setRows((current) => current.map((row) => (row.id === id ? result.data : row)));
      if (toast !== undefined) setNotice(toast);
    }
  }

  function openEdit(): void {
    if (selected === null) return;
    setEditOps(draftsOf(selected));
    setEditOpen(true);
  }

  async function saveEdit(): Promise<void> {
    if (selected === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<RoutingRow>(`manufacturing/routings/${selected.id}`, {
      method: "PATCH",
      body: {
        operations: editOps.map((op) => ({
          sequence: Number(op.sequence),
          workCenterId: op.workCenterId,
          setupTime: op.setupTime,
          runTime: op.runTime,
          fixedCostRate: op.fixedCostRate === "" ? null : op.fixedCostRate,
          varCostRate: op.varCostRate === "" ? null : op.varCostRate,
          description: op.description.trim() === "" ? null : op.description.trim(),
          descriptionAr: op.descriptionAr.trim() === "" ? null : op.descriptionAr.trim(),
        })),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEditOpen(false);
    await refreshAfterAction(
      result.data.id,
      formatMessage(d.mfgRoutingSavedToast, { version: `v${result.data.versionNo}` }),
    );
  }

  async function activateRouting(): Promise<void> {
    if (selected === null) return;
    setBusy("activate");
    setError(null);
    const result = await bffFetch<RoutingRow>(`manufacturing/routings/${selected.id}/activate`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setActivateOpen(false);
    await refreshAfterAction(result.data.id, d.mfgRoutingActivatedToast);
    // Another version may have been archived by the activation — refetch list.
    await loadList(itemFilter, statusFilter);
  }

  async function copyRouting(): Promise<void> {
    if (selected === null) return;
    setBusy("copy");
    setError(null);
    const result = await bffFetch<RoutingRow>(`manufacturing/routings/${selected.id}/copy`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows((current) => [result.data, ...current]);
    setNotice(d.mfgRoutingCopiedToast);
    await selectRouting(result.data.id);
  }

  // -- render ------------------------------------------------------------------------------

  const operationsEditor = (
    ops: OperationDraft[],
    setOps: (next: OperationDraft[]) => void,
  ): JSX.Element => (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-gray-900">{d.mfgRoutingOperations}</h3>
      <div className="mt-2 flex flex-col gap-2">
        {ops.map((op, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border border-subtle bg-surface-sunken p-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div className="w-24">
              <Input
                aria-label={d.mfgRoutingSequence}
                label={d.mfgRoutingSequence}
                value={op.sequence}
                onValueChange={(value) =>
                  setOps(ops.map((row, i) => (i === index ? { ...row, sequence: value } : row)))
                }
                mono
                required
                inputMode="numeric"
              />
            </div>
            <Select
              aria-label={d.mfgRoutingWorkCenter}
              label={d.mfgRoutingWorkCenter}
              value={op.workCenterId}
              onValueChange={(value) =>
                setOps(ops.map((row, i) => (i === index ? { ...row, workCenterId: value } : row)))
              }
              placeholder="—"
              options={workCenters.map((wc) => ({
                value: wc.id,
                label: workCenterLabelById.get(wc.id) ?? wc.code,
              }))}
              required
            />
            <div className="w-32">
              <Input
                aria-label={d.mfgRoutingSetupTime}
                label={d.mfgRoutingSetupTime}
                value={op.setupTime}
                onValueChange={(value) =>
                  setOps(ops.map((row, i) => (i === index ? { ...row, setupTime: value } : row)))
                }
                mono
                required
              />
            </div>
            <div className="w-32">
              <Input
                aria-label={d.mfgRoutingRunTime}
                label={d.mfgRoutingRunTime}
                value={op.runTime}
                onValueChange={(value) =>
                  setOps(ops.map((row, i) => (i === index ? { ...row, runTime: value } : row)))
                }
                mono
                required
              />
            </div>
            <div className="w-36">
              <Input
                aria-label={d.mfgRoutingFixedRateOverride}
                label={d.mfgRoutingFixedRateOverride}
                value={op.fixedCostRate}
                onValueChange={(value) =>
                  setOps(
                    ops.map((row, i) => (i === index ? { ...row, fixedCostRate: value } : row)),
                  )
                }
                mono
              />
            </div>
            <div className="w-36">
              <Input
                aria-label={d.mfgRoutingVarRateOverride}
                label={d.mfgRoutingVarRateOverride}
                value={op.varCostRate}
                onValueChange={(value) =>
                  setOps(ops.map((row, i) => (i === index ? { ...row, varCostRate: value } : row)))
                }
                mono
              />
            </div>
            <Input
              aria-label={d.mfgRoutingDescription}
              label={d.mfgRoutingDescription}
              value={op.description}
              onValueChange={(value) =>
                setOps(ops.map((row, i) => (i === index ? { ...row, description: value } : row)))
              }
            />
            <div className="flex items-end justify-between gap-2">
              <Input
                aria-label={d.mfgRoutingDescriptionAr}
                label={d.mfgRoutingDescriptionAr}
                value={op.descriptionAr}
                onValueChange={(value) =>
                  setOps(ops.map((row, i) => (i === index ? { ...row, descriptionAr: value } : row)))
                }
              />
              <Button
                variant="ghost"
                disabled={ops.length <= 1}
                onClick={() => setOps(ops.filter((_, i) => i !== index))}
              >
                {d.mfgRoutingRemoveOperation}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <Button
          variant="secondary"
          disabled={ops.length >= 200}
          onClick={() => setOps([...ops, { ...EMPTY_OP }])}
        >
          {d.mfgRoutingAddOperation}
        </Button>
      </div>
      <p className="mt-2 text-xs text-gray-500">{d.mfgRoutingRateOverrides}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.mfgRoutingsTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.mfgRoutingNew}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.mfgRoutingItem}
            value={itemFilter}
            onValueChange={(value) => onFilterChange(value, statusFilter)}
            placeholder="—"
            options={[
              { value: "", label: d.mfgBomFilterItem },
              ...stockItems.map((item) => ({
                value: item.id,
                label: itemLabelById.get(item.id) ?? item.sku,
              })),
            ]}
          />
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={(value) => onFilterChange(itemFilter, value)}
            options={[
              { value: "", label: d.mfgOrdersAllStatuses },
              { value: "DRAFT", label: d.mfgBomStatusDraft },
              { value: "ACTIVE", label: d.mfgBomStatusActive },
              { value: "ARCHIVED", label: d.mfgBomStatusArchived },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "item",
                header: activeLocaleHeader(d.mfgRoutingItem),
                accessor: (row) => items.find((item) => item.id === row.itemId)?.sku ?? row.itemId,
                render: (row) => itemLabelById.get(row.itemId) ?? row.itemId,
              },
              {
                id: "version",
                header: activeLocaleHeader(d.mfgRoutingVersion),
                accessor: (row) => String(row.versionNo),
                mono: true,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    v{row.versionNo}
                  </span>
                ),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "ACTIVE" ? "primary" : undefined}>
                    {localizedRoutingStatus(d, row.status)}
                  </Badge>
                ),
              },
              {
                id: "uom",
                header: activeLocaleHeader(d.mfgRoutingOutputUom),
                accessor: (row) => uomLabelById.get(row.outputUomId) ?? row.outputUomId,
                mono: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {uomLabelById.get(row.outputUomId) ?? row.outputUomId.slice(0, 8)}
                  </span>
                ),
              },
              {
                id: "activatedAt",
                header: activeLocaleHeader(d.mfgBomEffectiveFrom),
                accessor: (row) => row.activatedAt?.slice(0, 10) ?? "",
                mono: true,
                render: (row) =>
                  row.activatedAt === null ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span className="font-mono text-sm" dir="ltr">
                      {row.activatedAt.slice(0, 10)}
                    </span>
                  ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "open",
                label: d.commonOpen,
                onSelect: (row) => {
                  void selectRouting(row.id);
                },
              },
            ]}
            empty={{ title: d.mfgRoutingsEmpty }}
          />
        </div>
      </Card>

      {/* -- selected version workspace --------------------------------------------- */}
      {selected !== null && (
        <Card
          title={`${d.mfgRoutingsTitle} · ${itemLabelById.get(selected.itemId) ?? selected.itemId} · v${selected.versionNo}`}
          description={selected.status === "DRAFT" ? d.mfgRoutingDraftOnlyHint : undefined}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={selected.status === "ACTIVE" ? "primary" : undefined}>
                {localizedRoutingStatus(d, selected.status)}
              </Badge>
              <span className="text-sm text-gray-600">
                {d.mfgRoutingOutputUom}:{" "}
                <span className="font-mono text-sm" dir="ltr">
                  {uomLabelById.get(selected.outputUomId) ?? selected.outputUomId.slice(0, 8)}
                </span>
              </span>
              {selected.activatedAt !== null && (
                <span className="text-sm text-gray-600">
                  {d.mfgBomEffectiveFrom}:{" "}
                  <span className="font-mono text-sm" dir="ltr">
                    {selected.activatedAt.slice(0, 10)}
                  </span>
                </span>
              )}
            </div>

            <table className="w-full text-sm" aria-label={d.mfgRoutingOperations}>
              <thead>
                <tr className="border-b border-subtle text-xs text-gray-600">
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgRoutingSequence}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgRoutingWorkCenter}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.mfgRoutingSetupTime}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.mfgRoutingRunTime}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.mfgRoutingFixedRateOverride}</th>
                  <th scope="col" className="px-2 py-1 text-end">{d.mfgRoutingVarRateOverride}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgRoutingDescription}</th>
                  <th scope="col" className="px-2 py-1 text-start">{d.mfgRoutingDescriptionAr}</th>
                </tr>
              </thead>
              <tbody>
                {selected.operations.map((op) => (
                  <tr key={op.id} className="border-b border-subtle">
                    <td className="px-2 py-1.5 font-mono" dir="ltr">
                      {op.sequence}
                    </td>
                    <td className="px-2 py-1.5">
                      {workCenterLabelById.get(op.workCenterId) ?? op.workCenterId}
                    </td>
                    <td className="px-2 py-1.5 text-end">{decCell(op.setupTime)}</td>
                    <td className="px-2 py-1.5 text-end">{decCell(op.runTime)}</td>
                    <td className="px-2 py-1.5 text-end">
                      {op.fixedCostRate === null ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        decCell(op.fixedCostRate)
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-end">
                      {op.varCostRate === null ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        decCell(op.varCostRate)
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {op.description === null || op.description === "" ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        op.description
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {op.descriptionAr === null || op.descriptionAr === "" ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <span lang="ar">{op.descriptionAr}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-wrap gap-2">
              {selected.status === "DRAFT" && (
                <>
                  <Button variant="primary" onClick={openEdit}>
                    {d.commonEdit}
                  </Button>
                  <Button variant="primary" onClick={() => setActivateOpen(true)}>
                    {d.mfgRoutingActivate}
                  </Button>
                </>
              )}
              <Button variant="secondary" loading={busy === "copy"} onClick={() => void copyRouting()}>
                {d.mfgRoutingCopy}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setSelected(null);
                }}
              >
                {d.commonClear}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {detailLoading && selected === null && (
        <Card title={d.mfgRoutingsTitle}>
          <p className="text-sm text-gray-500">…</p>
        </Card>
      )}

      {/* -- create dialog -------------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.mfgRoutingNew}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.mfgRoutingItem}
            value={createItemId}
            onValueChange={(value) => {
              setCreateItemId(value);
              // Default the output UoM to the item's base unit (the BOM rule).
              const item = stockItems.find((row) => row.id === value);
              setCreateUomId(item !== undefined ? item.uomId : "");
            }}
            placeholder="—"
            options={stockItems.map((item) => ({
              value: item.id,
              label: itemLabelById.get(item.id) ?? item.sku,
            }))}
            required
          />
          <Select
            label={d.mfgRoutingOutputUom}
            value={createUomId}
            onValueChange={setCreateUomId}
            placeholder="—"
            options={uoms.map((uom) => ({ value: uom.id, label: uom.code }))}
            required
          />
        </div>
        {operationsEditor(createOps, setCreateOps)}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createRouting()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog (DRAFT full-replace) --------------------------------------------- */}
      <Dialog open={editOpen} onOpenChange={setEditOpen} title={d.mfgRoutingOperations}>
        {operationsEditor(editOps, setEditOps)}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "edit"}
            disabled={!editReady}
            onClick={() => void saveEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- activate confirm dialog ----------------------------------------------------- */}
      <Dialog
        open={activateOpen}
        onOpenChange={setActivateOpen}
        title={d.mfgRoutingActivate}
      >
        <p className="text-sm text-gray-600">{d.mfgRoutingArchiveWarning}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setActivateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "activate"}
            onClick={() => void activateRouting()}
          >
            {d.mfgRoutingActivate}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
