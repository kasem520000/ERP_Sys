"use client";

/**
 * PHASE-042 T-10 — the work-center registry:
 *
 * - the list (code, bilingual name, capacity/shift, shifts/day, the two
 *   cost rates, status badge) with the status filter (server-refetched);
 * - the create dialog: code (^[A-Za-z][A-Za-z0-9_-]{1,39}$), the bilingual
 *   names, per-shift capacity (≤ 2dp), shifts/day (1..6) and the optional
 *   fixed/variable cost rates (≤ 6dp, base currency per hour);
 * - the edit dialog (PATCH — COALESCE semantics server-side, the full form
 *   travels);
 * - activate/deactivate via POST :id/status; the deactivate confirm dialog
 *   carries the two-guard warning (the server still answers
 *   WORK_CENTER_IN_USE when ACTIVE routings or live operations point at
 *   the center).
 *
 * Rates and capacities stay canonical decimal strings (ADR-0009); the code
 * column renders LTR-mono in both locales.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import { Badge, Button, DataTable, Dialog, Input, Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { WorkCenterRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedManufacturingError,
  localizedWorkCenterStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

/** Capacities ≤ 2dp; rates ≤ 6dp (numeric(7,2) / numeric(19,6) mirrors). */
const CAPACITY_RE = /^\d+(\.\d{1,2})?$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const CODE_RE = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;

/** One editable work-center draft (create + edit share the shape). */
interface WorkCenterDraft {
  code: string;
  name: string;
  nameAr: string;
  capacityPerShift: string;
  shiftsPerDay: string;
  fixedCostRate: string;
  varCostRate: string;
}

const EMPTY_DRAFT: WorkCenterDraft = {
  code: "",
  name: "",
  nameAr: "",
  capacityPerShift: "8",
  shiftsPerDay: "1",
  fixedCostRate: "",
  varCostRate: "",
};

function draftOf(row: WorkCenterRow): WorkCenterDraft {
  return {
    code: row.code,
    name: row.name,
    nameAr: row.nameAr ?? "",
    capacityPerShift: row.capacityPerShift,
    shiftsPerDay: String(row.shiftsPerDay),
    fixedCostRate: row.fixedCostRate,
    varCostRate: row.varCostRate,
  };
}

function draftValid(draft: WorkCenterDraft): boolean {
  if (!CODE_RE.test(draft.code.trim())) return false;
  if (draft.name.trim() === "") return false;
  if (!CAPACITY_RE.test(draft.capacityPerShift) || Number(draft.capacityPerShift) <= 0) return false;
  const shifts = Number(draft.shiftsPerDay);
  if (!Number.isInteger(shifts) || shifts < 1 || shifts > 6) return false;
  if (draft.fixedCostRate !== "" && !RATE_RE.test(draft.fixedCostRate)) return false;
  if (draft.varCostRate !== "" && !RATE_RE.test(draft.varCostRate)) return false;
  return true;
}

/** A canonical decimal cell (display: the exact server string, LTR). */
function decCell(value: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr">
      {value}
    </span>
  );
}

export function ManufacturingWorkCenters({
  locale,
  initialRows,
}: {
  locale: Locale;
  initialRows: readonly WorkCenterRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const [rows, setRows] = useState<readonly WorkCenterRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // List filter (server-side refetch).
  const [statusFilter, setStatusFilter] = useState("");
  const [listLoading, setListLoading] = useState(false);

  // Create dialog state.
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<WorkCenterDraft>({ ...EMPTY_DRAFT });

  // Edit dialog state.
  const [editRow, setEditRow] = useState<WorkCenterRow | null>(null);
  const [editDraft, setEditDraft] = useState<WorkCenterDraft>({ ...EMPTY_DRAFT });

  // Deactivate confirm dialog state.
  const [deactivateRow, setDeactivateRow] = useState<WorkCenterRow | null>(null);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      map.set(row.id, `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`);
    }
    return map;
  }, [rows, locale]);

  const createReady = draftValid(createDraft);
  const editReady = editRow !== null && draftValid(editDraft);

  // -- list ------------------------------------------------------------------------------

  async function loadList(status: string): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly WorkCenterRow[]>(
      `manufacturing/work-centers?limit=200${status === "" ? "" : `&status=${status}`}`,
    );
    setListLoading(false);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRows(result.data);
  }

  function onStatusFilterChange(status: string): void {
    setStatusFilter(status);
    void loadList(status);
  }

  function upsertRow(next: WorkCenterRow): void {
    setRows((current) => {
      const exists = current.some((row) => row.id === next.id);
      return exists ? current.map((row) => (row.id === next.id ? next : row)) : [next, ...current];
    });
  }

  // -- create ---------------------------------------------------------------------------

  async function createWorkCenter(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<WorkCenterRow>("manufacturing/work-centers", {
      method: "POST",
      body: {
        code: createDraft.code.trim(),
        name: createDraft.name.trim(),
        nameAr: createDraft.nameAr.trim() === "" ? null : createDraft.nameAr.trim(),
        capacityPerShift: createDraft.capacityPerShift,
        shiftsPerDay: Number(createDraft.shiftsPerDay),
        fixedCostRate: createDraft.fixedCostRate === "" ? null : createDraft.fixedCostRate,
        varCostRate: createDraft.varCostRate === "" ? null : createDraft.varCostRate,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    upsertRow(result.data);
    setCreateOpen(false);
    setCreateDraft({ ...EMPTY_DRAFT });
    setNotice(d.mfgWcSavedToast);
  }

  // -- edit (PATCH full form) -------------------------------------------------------------

  async function saveEdit(): Promise<void> {
    if (editRow === null || !editReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("edit");
    setError(null);
    const result = await bffFetch<WorkCenterRow>(`manufacturing/work-centers/${editRow.id}`, {
      method: "PATCH",
      body: {
        name: editDraft.name.trim(),
        nameAr: editDraft.nameAr.trim() === "" ? null : editDraft.nameAr.trim(),
        capacityPerShift: editDraft.capacityPerShift,
        shiftsPerDay: Number(editDraft.shiftsPerDay),
        fixedCostRate: editDraft.fixedCostRate === "" ? null : editDraft.fixedCostRate,
        varCostRate: editDraft.varCostRate === "" ? null : editDraft.varCostRate,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    upsertRow(result.data);
    setEditRow(null);
    setNotice(d.mfgWcSavedToast);
  }

  // -- status flip ------------------------------------------------------------------------

  async function setStatus(row: WorkCenterRow, status: "ACTIVE" | "INACTIVE"): Promise<void> {
    setBusy(`status:${row.id}`);
    setError(null);
    const result = await bffFetch<WorkCenterRow>(`manufacturing/work-centers/${row.id}/status`, {
      method: "POST",
      body: { status },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedManufacturingError(d, result.error, result.retryAfterSeconds));
      return;
    }
    upsertRow(result.data);
    setDeactivateRow(null);
    setNotice(d.mfgWcSavedToast);
  }

  // -- render ------------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      {notice !== null && <SuccessNotice>{notice}</SuccessNotice>}

      <Card
        title={d.mfgWcTitle}
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {d.mfgWcCreate}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label={d.accountingColStatus}
            value={statusFilter}
            onValueChange={onStatusFilterChange}
            options={[
              { value: "", label: d.mfgOrdersAllStatuses },
              { value: "ACTIVE", label: d.mfgWcStatusActive },
              { value: "INACTIVE", label: d.mfgWcStatusInactive },
            ]}
          />
        </div>
        <div className="mt-3">
          <DataTable
            loading={listLoading}
            columns={[
              {
                id: "code",
                header: activeLocaleHeader(d.mfgWcCode),
                accessor: (row) => row.code,
                mono: true,
                sortable: true,
                render: (row) => (
                  <span className="font-mono text-sm" dir="ltr">
                    {row.code}
                  </span>
                ),
              },
              {
                id: "name",
                header: activeLocaleHeader(d.mfgWcName),
                accessor: (row) => row.name,
                render: (row) => localizedName(row.name, row.nameAr, locale),
              },
              {
                id: "nameAr",
                header: activeLocaleHeader(d.mfgWcNameAr),
                accessor: (row) => row.nameAr ?? "",
                render: (row) =>
                  row.nameAr === null || row.nameAr === "" ? (
                    <span className="text-gray-500">—</span>
                  ) : (
                    <span lang="ar">{row.nameAr}</span>
                  ),
              },
              {
                id: "capacity",
                header: activeLocaleHeader(d.mfgWcCapacity),
                accessor: (row) => row.capacityPerShift,
                numeric: true,
                render: (row) => decCell(row.capacityPerShift),
              },
              {
                id: "shifts",
                header: activeLocaleHeader(d.mfgWcShifts),
                accessor: (row) => String(row.shiftsPerDay),
                numeric: true,
                render: (row) => decCell(String(row.shiftsPerDay)),
              },
              {
                id: "fixedRate",
                header: activeLocaleHeader(d.mfgWcFixedRate),
                accessor: (row) => row.fixedCostRate,
                numeric: true,
                render: (row) => decCell(row.fixedCostRate),
              },
              {
                id: "varRate",
                header: activeLocaleHeader(d.mfgWcVarRate),
                accessor: (row) => row.varCostRate,
                numeric: true,
                render: (row) => decCell(row.varCostRate),
              },
              {
                id: "status",
                header: activeLocaleHeader(d.accountingColStatus),
                accessor: (row) => row.status,
                render: (row) => (
                  <Badge tone={row.status === "ACTIVE" ? "primary" : undefined}>
                    {localizedWorkCenterStatus(d, row.status)}
                  </Badge>
                ),
              },
            ]}
            rows={[...rows]}
            rowKey={(row) => row.id}
            rowActions={[
              {
                id: "edit",
                label: d.commonEdit,
                onSelect: (row) => {
                  setEditRow(row);
                  setEditDraft(draftOf(row));
                },
              },
              {
                id: "deactivate",
                label: d.mfgWcDeactivate,
                onSelect: (row) => {
                  if (row.status === "INACTIVE") {
                    void setStatus(row, "ACTIVE");
                    return;
                  }
                  setDeactivateRow(row);
                },
              },
            ]}
            empty={{ title: d.mfgWcEmpty }}
          />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {nameById.size} · {d.mfgWcDeactivateWarning}
        </p>
      </Card>

      {/* -- create dialog ------------------------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.mfgWcCreate}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="w-44">
            <Input
              label={d.mfgWcCode}
              value={createDraft.code}
              onValueChange={(value) => setCreateDraft({ ...createDraft, code: value })}
              mono
              required
              error={createDraft.code !== "" && !CODE_RE.test(createDraft.code.trim()) ? d.errorsValidation : undefined}
            />
          </div>
          <Input
            label={d.mfgWcName}
            value={createDraft.name}
            onValueChange={(value) => setCreateDraft({ ...createDraft, name: value })}
            required
          />
          <Input
            label={d.mfgWcNameAr}
            value={createDraft.nameAr}
            onValueChange={(value) => setCreateDraft({ ...createDraft, nameAr: value })}
          />
          <div className="w-40">
            <Input
              label={d.mfgWcCapacity}
              value={createDraft.capacityPerShift}
              onValueChange={(value) => setCreateDraft({ ...createDraft, capacityPerShift: value })}
              mono
              required
              error={
                createDraft.capacityPerShift !== "" &&
                (!CAPACITY_RE.test(createDraft.capacityPerShift) ||
                  Number(createDraft.capacityPerShift) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-32">
            <Input
              label={d.mfgWcShifts}
              value={createDraft.shiftsPerDay}
              onValueChange={(value) => setCreateDraft({ ...createDraft, shiftsPerDay: value })}
              mono
              required
              inputMode="numeric"
              error={
                !Number.isInteger(Number(createDraft.shiftsPerDay)) ||
                Number(createDraft.shiftsPerDay) < 1 ||
                Number(createDraft.shiftsPerDay) > 6
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgWcFixedRate}
              value={createDraft.fixedCostRate}
              onValueChange={(value) => setCreateDraft({ ...createDraft, fixedCostRate: value })}
              mono
              error={
                createDraft.fixedCostRate !== "" && !RATE_RE.test(createDraft.fixedCostRate)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgWcVarRate}
              value={createDraft.varCostRate}
              onValueChange={(value) => setCreateDraft({ ...createDraft, varCostRate: value })}
              mono
              error={
                createDraft.varCostRate !== "" && !RATE_RE.test(createDraft.varCostRate)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "create"}
            disabled={!createReady}
            onClick={() => void createWorkCenter()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- edit dialog ------------------------------------------------------------------ */}
      <Dialog
        open={editRow !== null}
        onOpenChange={(open) => {
          if (!open) setEditRow(null);
        }}
        title={`${d.commonEdit} · ${editRow?.code ?? ""}`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.mfgWcName}
            value={editDraft.name}
            onValueChange={(value) => setEditDraft({ ...editDraft, name: value })}
            required
          />
          <Input
            label={d.mfgWcNameAr}
            value={editDraft.nameAr}
            onValueChange={(value) => setEditDraft({ ...editDraft, nameAr: value })}
          />
          <div className="w-40">
            <Input
              label={d.mfgWcCapacity}
              value={editDraft.capacityPerShift}
              onValueChange={(value) => setEditDraft({ ...editDraft, capacityPerShift: value })}
              mono
              required
              error={
                editDraft.capacityPerShift !== "" &&
                (!CAPACITY_RE.test(editDraft.capacityPerShift) ||
                  Number(editDraft.capacityPerShift) <= 0)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-32">
            <Input
              label={d.mfgWcShifts}
              value={editDraft.shiftsPerDay}
              onValueChange={(value) => setEditDraft({ ...editDraft, shiftsPerDay: value })}
              mono
              required
              inputMode="numeric"
              error={
                !Number.isInteger(Number(editDraft.shiftsPerDay)) ||
                Number(editDraft.shiftsPerDay) < 1 ||
                Number(editDraft.shiftsPerDay) > 6
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgWcFixedRate}
              value={editDraft.fixedCostRate}
              onValueChange={(value) => setEditDraft({ ...editDraft, fixedCostRate: value })}
              mono
              error={
                editDraft.fixedCostRate !== "" && !RATE_RE.test(editDraft.fixedCostRate)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
          <div className="w-40">
            <Input
              label={d.mfgWcVarRate}
              value={editDraft.varCostRate}
              onValueChange={(value) => setEditDraft({ ...editDraft, varCostRate: value })}
              mono
              error={
                editDraft.varCostRate !== "" && !RATE_RE.test(editDraft.varCostRate)
                  ? d.errorsValidation
                  : undefined
              }
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditRow(null)}>
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

      {/* -- deactivate confirm dialog ------------------------------------------------------ */}
      <Dialog
        open={deactivateRow !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivateRow(null);
        }}
        title={`${d.mfgWcDeactivate} · ${deactivateRow?.code ?? ""}`}
      >
        <p className="text-sm text-gray-600">{d.mfgWcDeactivateWarning}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeactivateRow(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === `status:${deactivateRow?.id ?? ""}`}
            onClick={() => {
              if (deactivateRow !== null) void setStatus(deactivateRow, "INACTIVE");
            }}
          >
            {d.mfgWcDeactivate}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
