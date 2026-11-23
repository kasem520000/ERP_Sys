"use client";

/**
 * PHASE-050 (W-29 — T-15) — the CAPA board (the /quality/capa screen body):
 * the corrective/preventive register + the intake form + the root-cause act
 * (OPEN → IN_PROGRESS) + the G-63 external-cost door + the close with
 * BR-103's effectiveness check — cloned from the W-21 meters-board pattern
 * (the data-slot shape, two panes on a segmented switch, never the Tabs
 * primitive).
 *
 * THE ENGINE-OUTPUT LAW: every figure is an ENGINE OUTPUT rendered VERBATIM
 * — the record's own externalCost, its own actions array (the jsonb stored
 * verbatim), its own effectiveness payload, and the typed refusals' own
 * figures (BR-103's elapsed windows). Zero client-side recomputation.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  useToast,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { ApiErrorBody, CapaRow, NcrRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedCapaStatus,
  localizedQualityError,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Money ≤ 4dp (the engine's own floor — G-63's amount). */
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

const CAPA_STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;

/** The intake draft. */
interface CapaDraft {
  title: string;
  ncrId: string;
  ownerEmployeeId: string;
  dueDate: string;
  note: string;
  noteAr: string;
}

const EMPTY_CAPA: CapaDraft = {
  title: "",
  ncrId: "",
  ownerEmployeeId: "",
  dueDate: "",
  note: "",
  noteAr: "",
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

function monoCell(value: string, title?: string): JSX.Element {
  return (
    <span className="font-mono tabular-nums" dir="ltr" title={title ?? value}>
      {value}
    </span>
  );
}

/** The semantic-tone chip (the meters-board precedent). */
type ChipTone = "success" | "danger" | "warning" | "info" | "neutral";
const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  success: "border-success-border bg-success-bg text-success-text",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  warning: "border-warning-border bg-warning-bg text-warning-text",
  info: "border-info-border bg-info-bg text-info-text",
  neutral: "border-subtle bg-gray-100 text-gray-600",
};
function Chip({ tone, children }: { tone: ChipTone; children: string }): JSX.Element {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-sm border px-1.5 py-0.5 text-xs leading-4 ${CHIP_TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

function statusTone(status: string): ChipTone {
  if (status === "CLOSED") return "success";
  if (status === "IN_PROGRESS") return "info";
  return "warning";
}

/** The effectiveness payload's own shape (the 0114 jsonb stored verbatim) —
 * read defensively off the wire record, never fabricated. */
function effectivenessOf(row: CapaRow): { summary: string; effective: string; checkedAt: string } | null {
  const payload = row.effectiveness;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const summary = (payload as Record<string, unknown>).summary;
  const effective = (payload as Record<string, unknown>).effective;
  const checkedAt = (payload as Record<string, unknown>).checkedAt;
  if (typeof summary !== "string" || typeof checkedAt !== "string") {
    return null;
  }
  return {
    summary,
    effective:
      effective === true
        ? "true"
        : effective === false
          ? "false"
          : typeof effective === "string"
            ? effective
            : "—",
    checkedAt,
  };
}

export function QualityCapaBoard({
  locale,
  initialCapas,
  capasError,
  ncrs,
}: {
  locale: Locale;
  initialCapas: readonly CapaRow[] | null;
  capasError: ApiErrorBody | null;
  ncrs: readonly NcrRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ------
  const [pane, setPane] = useState<"register" | "intake">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the register pane -----------------------------------------------------
  const [capas, setCapas] = useState<readonly CapaRow[] | null>(initialCapas);
  const [capasRefusal, setCapasRefusal] = useState<ApiErrorBody | null>(capasError);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rootCauseOpen, setRootCauseOpen] = useState(false);
  const [rootCauseText, setRootCauseText] = useState("");
  const [costOpen, setCostOpen] = useState(false);
  const [costAmount, setCostAmount] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeSummary, setCloseSummary] = useState("");
  const [closeEffective, setCloseEffective] = useState("yes");
  const [closeCheckedAt, setCloseCheckedAt] = useState("");

  // -- the intake pane ---------------------------------------------------------
  const [draft, setDraft] = useState<CapaDraft>({ ...EMPTY_CAPA });

  const ncrLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ncr of ncrs) {
      map.set(ncr.id, ncr.ncrNo);
    }
    return map;
  }, [ncrs]);

  const selected = useMemo(
    () => (selectedId === null ? null : capas?.find((row) => row.id === selectedId) ?? null),
    [capas, selectedId],
  );

  const intakeReady =
    draft.title.trim().length >= 1 &&
    (draft.ownerEmployeeId === "" || UUID_RE.test(draft.ownerEmployeeId.trim())) &&
    (draft.dueDate === "" || DATE_RE.test(draft.dueDate));

  const rootCauseReady = rootCauseText.trim().length >= 1;
  const costReady = AMOUNT_RE.test(costAmount);
  const closeReady = closeSummary.trim().length >= 1 && STAMP_RE.test(closeCheckedAt);

  // -- the register list ------------------------------------------------------

  async function loadCapas(): Promise<void> {
    setListLoading(true);
    const query = statusFilter === "" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
    const result = await bffFetch<readonly CapaRow[]>(`quality/capa${query}`);
    setListLoading(false);
    if (!result.ok) {
      setCapasRefusal(result.error);
      setCapas(null);
      return;
    }
    setCapasRefusal(null);
    setCapas(result.data);
  }

  /** THE START ACT: the root-cause analysis (OPEN → IN_PROGRESS in the same
   * CAS — the declared W-26 interpretation). */
  async function recordRootCause(): Promise<void> {
    if (selected === null || !rootCauseReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("root-cause");
    setError(null);
    const result = await bffFetch<CapaRow>(`quality/capa/${selected.id}/root-cause`, {
      method: "POST",
      body: { rootCause: rootCauseText.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRootCauseOpen(false);
    setRootCauseText("");
    setNotice(d.qualityCapaRootCauseToast);
    toast({ tone: "success", title: d.qualityCapaRootCauseToast });
    setCapas((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  /** THE G-63 ACT: the external service cost (DR QUALITY_EXPENSE · CR
   * EXTERNAL_ACCRUAL through the REAL engine, exactly once). */
  async function recordExternalCost(): Promise<void> {
    if (selected === null || !costReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("cost");
    setError(null);
    const result = await bffFetch<CapaRow>(`quality/capa/${selected.id}/external-cost`, {
      method: "POST",
      body: { amount: costAmount },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCostOpen(false);
    setCostAmount("");
    setNotice(d.qualityCapaCostToast);
    toast({ tone: "success", title: d.qualityCapaCostToast });
    setCapas((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  /** BR-103's own door: the close with the effectiveness check (every open
   * window elapsed — the typed refusals carry the figures). */
  async function closeCapa(): Promise<void> {
    if (selected === null || !closeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("close");
    setError(null);
    const result = await bffFetch<CapaRow>(`quality/capa/${selected.id}/close`, {
      method: "POST",
      body: {
        summary: closeSummary.trim(),
        effective: closeEffective === "yes",
        checkedAt: closeCheckedAt,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCloseOpen(false);
    setCloseSummary("");
    setCloseEffective("yes");
    setCloseCheckedAt("");
    setNotice(d.qualityCapaCloseToast);
    toast({ tone: "success", title: d.qualityCapaCloseToast });
    setCapas((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  // -- the intake act -----------------------------------------------------------

  async function createCapa(): Promise<void> {
    if (!intakeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<CapaRow>("quality/capa", {
      method: "POST",
      body: {
        title: draft.title.trim(),
        ...(draft.ncrId !== "" ? { ncrId: draft.ncrId } : {}),
        ...(draft.ownerEmployeeId.trim() !== ""
          ? { ownerEmployeeId: draft.ownerEmployeeId.trim() }
          : {}),
        ...(draft.dueDate !== "" ? { dueDate: draft.dueDate } : {}),
        ...(draft.note.trim() !== "" ? { note: draft.note.trim() } : {}),
        ...(draft.noteAr.trim() !== "" ? { noteAr: draft.noteAr.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDraft({ ...EMPTY_CAPA });
    setNotice(d.qualityCapaCreatedToast);
    toast({ tone: "success", title: d.qualityCapaCreatedToast });
    await loadCapas();
  }

  // -- the register table -------------------------------------------------------

  const capaColumns: DataTableColumn<CapaRow>[] = [
    {
      id: "capaNo",
      header: activeLocaleHeader(d.qualityCapaColNo),
      accessor: (row) => row.capaNo,
      render: (row) => monoCell(row.capaNo),
    },
    {
      id: "title",
      header: activeLocaleHeader(d.qualityCapaColTitle),
      accessor: (row) => row.title,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.qualityCapaColStatus),
      accessor: (row) => localizedCapaStatus(d, row.status),
      render: (row) => <Chip tone={statusTone(row.status)}>{localizedCapaStatus(d, row.status)}</Chip>,
    },
    {
      id: "ncr",
      header: activeLocaleHeader(d.qualityCapaColNcr),
      accessor: (row) => row.ncrId ?? "—",
      render: (row) =>
        row.ncrId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(ncrLabelById.get(row.ncrId) ?? shortId(row.ncrId), row.ncrId)
        ),
    },
    {
      id: "owner",
      header: activeLocaleHeader(d.qualityCapaColOwner),
      accessor: (row) => row.ownerEmployeeId ?? "—",
      render: (row) =>
        row.ownerEmployeeId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(shortId(row.ownerEmployeeId), row.ownerEmployeeId)
        ),
    },
    {
      id: "due",
      header: activeLocaleHeader(d.qualityCapaColDue),
      accessor: (row) => row.dueDate ?? "—",
      render: (row) =>
        row.dueDate === null ? <span className="text-xs text-gray-500">—</span> : monoCell(row.dueDate),
    },
    {
      id: "rootCause",
      header: activeLocaleHeader(d.qualityCapaColRootCause),
      accessor: (row) => row.rootCause ?? "—",
      render: (row) =>
        row.rootCause === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <span className="text-xs text-gray-600">{row.rootCause}</span>
        ),
    },
    {
      id: "cost",
      header: activeLocaleHeader(d.qualityCapaColCost),
      accessor: (row) => row.externalCost,
      render: (row) => monoCell(row.externalCost),
    },
    {
      id: "createdAt",
      header: activeLocaleHeader(d.qualityCapaColCreated),
      accessor: (row) => row.createdAt,
      render: (row) => monoCell(row.createdAt),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.qualityCapaOpen),
      accessor: () => d.qualityCapaOpen,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
          {d.qualityCapaOpen}
        </Button>
      ),
    },
  ];

  // -- the render -----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.qualityCapaTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.qualityCapaPaneRegister}
        </Button>
        <Button
          variant={pane === "intake" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "intake"}
          onClick={() => setPane("intake")}
        >
          {d.qualityCapaPaneIntake}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.qualityCapaPaneRegister}
            description={d.qualityCapaSubtitle}
            actions={
              <Button variant="secondary" size="sm" loading={listLoading} onClick={() => void loadCapas()}>
                {d.qualityRefresh}
              </Button>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label={d.qualityCapaColStatus}
                value={statusFilter}
                onValueChange={setStatusFilter}
                placeholder="—"
                options={CAPA_STATUSES.map((status) => ({
                  value: status,
                  label: localizedCapaStatus(d, status),
                }))}
              />
            </div>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {capasRefusal !== null ? (
            <TypedRefusalPanel
              error={capasRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {capasRefusal === null && capas !== null ? (
            capas.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualityCapaEmpty}</p>
            ) : (
              <DataTable columns={capaColumns} rows={[...capas]} rowKey={(row) => row.id} />
            )
          ) : null}

          {selected !== null ? (
            <Card title={`${selected.capaNo} · ${selected.title}`}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={statusTone(selected.status)}>{localizedCapaStatus(d, selected.status)}</Chip>
                  {selected.ncrId !== null ? (
                    <span className="text-sm text-gray-600">
                      {d.qualityCapaColNcr}:{" "}
                      {monoCell(ncrLabelById.get(selected.ncrId) ?? shortId(selected.ncrId), selected.ncrId)}
                    </span>
                  ) : null}
                </div>

                <DefList
                  items={[
                    {
                      term: d.qualityCapaColCost,
                      children: monoCell(selected.externalCost),
                    },
                    ...(selected.dueDate !== null
                      ? [{ term: d.qualityCapaColDue, children: monoCell(selected.dueDate) }]
                      : []),
                    ...(selected.rootCauseAt !== null
                      ? [{ term: d.qualityCapaColRootCause, children: monoCell(selected.rootCauseAt) }]
                      : []),
                    ...(selected.journalEntryId !== null
                      ? [{ term: d.qualityJournal, children: monoCell(selected.journalEntryId) }]
                      : []),
                  ]}
                />

                {/* THE ACTS — the board opens the door, the engine decides. */}
                <div className="flex flex-wrap gap-2">
                  {selected.status === "OPEN" ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setRootCauseText("");
                        setRootCauseOpen(true);
                      }}
                    >
                      {d.qualityCapaRootCauseAct}
                    </Button>
                  ) : null}
                  {selected.status !== "CLOSED" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCostAmount("");
                        setCostOpen(true);
                      }}
                    >
                      {d.qualityCapaCostAct}
                    </Button>
                  ) : null}
                  {selected.status === "IN_PROGRESS" ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCloseSummary("");
                        setCloseEffective("yes");
                        setCloseCheckedAt("");
                        setCloseOpen(true);
                      }}
                    >
                      {d.qualityCapaCloseAct}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setSelectedId(null)}>
                    {d.commonClear}
                  </Button>
                </div>

                {/* THE ACTIONS ARRAY — the engine's own jsonb, verbatim. */}
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{d.qualityCapaActionsTitle}</h3>
                  {selected.actions.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.qualityCapaActionsEmpty}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table aria-label={d.qualityCapaActionsTitle} className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-subtle">
                            <th className="px-2 py-1.5 text-start font-medium">
                              {d.qualityCapaIntakeTitleField}
                            </th>
                            <th className="px-2 py-1.5 text-start font-medium">
                              {d.qualityCapaActionDue}
                            </th>
                            <th className="px-2 py-1.5 text-start font-medium">
                              {d.qualityCapaActionCompletedAt}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.actions.map((action, index) => (
                            <tr key={`${action.title}:${index}`} className="border-b border-subtle/60">
                              <td className="px-2 py-1.5">{action.title}</td>
                              <td className="px-2 py-1.5">
                                {action.dueDate === null ? (
                                  <span className="text-xs text-gray-500">—</span>
                                ) : (
                                  monoCell(action.dueDate)
                                )}
                              </td>
                              <td className="px-2 py-1.5">
                                {action.completedAt === null ? (
                                  <span className="text-xs text-gray-500">—</span>
                                ) : (
                                  monoCell(action.completedAt)
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* THE EFFECTIVENESS RECORD — the engine's own payload. */}
                {effectivenessOf(selected) !== null ? (
                  <Card title={d.qualityCapaEffectivenessTitle}>
                    <DefList
                      items={[
                        { term: d.qualityCapaEffectivenessSummary, children: effectivenessOf(selected)!.summary },
                        {
                          term: d.qualityCapaEffectivenessEffective,
                          children: effectivenessOf(selected)!.effective,
                        },
                        {
                          term: d.qualityCapaEffectivenessCheckedAt,
                          children: monoCell(effectivenessOf(selected)!.checkedAt),
                        },
                      ]}
                    />
                  </Card>
                ) : null}
              </div>
            </Card>
          ) : null}
        </>
      ) : (
        <Card title={d.qualityCapaIntakeTitle} description={d.qualityCapaSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label={d.qualityCapaIntakeTitleField}
                value={draft.title}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, title: value }))}
                required
              />
            </div>
            <Select
              label={d.qualityCapaIntakeNcr}
              value={draft.ncrId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, ncrId: value }))}
              placeholder="—"
              options={ncrs.map((ncr) => ({
                value: ncr.id,
                label: `${ncr.ncrNo} · ${ncr.problem}`,
              }))}
            />
            <Input
              label={d.qualityCapaIntakeOwner}
              value={draft.ownerEmployeeId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, ownerEmployeeId: value }))}
              mono
              bidiIsolate
            />
            <Input
              label={d.qualityCapaIntakeDue}
              value={draft.dueDate}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, dueDate: value }))}
              mono
              bidiIsolate
              hint="YYYY-MM-DD"
            />
            <div className="sm:col-span-2">
              <Input
                label={d.qualityCapaIntakeNote}
                value={draft.note}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, note: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityCapaIntakeNoteAr}
                value={draft.noteAr}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, noteAr: value }))}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="primary"
              loading={busy === "create"}
              disabled={!intakeReady}
              onClick={() => void createCapa()}
            >
              {d.qualityCapaCreate}
            </Button>
          </div>
        </Card>
      )}

      {/* -- the root-cause dialog (the start act's door) ------------------------ */}
      <Dialog open={rootCauseOpen} onOpenChange={setRootCauseOpen} title={d.qualityCapaRootCauseTitle}>
        <div className="flex flex-col gap-3">
          <Input
            label={d.qualityCapaRootCauseText}
            value={rootCauseText}
            onValueChange={setRootCauseText}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRootCauseOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "root-cause"}
            disabled={!rootCauseReady}
            onClick={() => void recordRootCause()}
          >
            {d.qualityCapaRootCauseAct}
          </Button>
        </div>
      </Dialog>

      {/* -- the external-cost dialog (the G-63 door) ---------------------------- */}
      <Dialog open={costOpen} onOpenChange={setCostOpen} title={d.qualityCapaCostTitle}>
        <div className="flex flex-col gap-3">
          <Input
            label={d.qualityCapaCostAmount}
            value={costAmount}
            onValueChange={setCostAmount}
            inputMode="decimal"
            mono
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCostOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "cost"}
            disabled={!costReady}
            onClick={() => void recordExternalCost()}
          >
            {d.qualityCapaCostAct}
          </Button>
        </div>
      </Dialog>

      {/* -- the close dialog (BR-103's effectiveness gate) ---------------------- */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen} title={d.qualityCapaCloseTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label={d.qualityCapaCloseSummary}
              value={closeSummary}
              onValueChange={setCloseSummary}
              required
            />
          </div>
          <Select
            label={d.qualityCapaCloseEffective}
            value={closeEffective}
            onValueChange={setCloseEffective}
            placeholder="yes"
            options={[
              { value: "yes", label: d.qualityCapaCloseEffectiveYes },
              { value: "no", label: d.qualityCapaCloseEffectiveNo },
            ]}
          />
          <Input
            label={d.qualityCapaCloseCheckedAt}
            value={closeCheckedAt}
            onValueChange={setCloseCheckedAt}
            mono
            bidiIsolate
            hint="YYYY-MM-DDTHH:mm"
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCloseOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "close"}
            disabled={!closeReady}
            onClick={() => void closeCapa()}
          >
            {d.qualityCapaCloseAct}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
