"use client";

/**
 * PHASE-050 (W-29 — T-15) — the NCR board (the /quality/ncr screen body):
 * the nonconformity register + the intake form + the disposition act (the
 * G-62 write-off's door) + the close, cloned from the W-21 meters-board
 * pattern — the data-slot shape immune to the 045 Tabs defect (two panes on
 * a segmented switch, never the Tabs primitive).
 *
 * THE ENGINE-OUTPUT LAW (carried from the W-12/W-13/W-20/W-21 boards):
 * every figure is an ENGINE OUTPUT rendered VERBATIM — the record's own
 * affectedQty, its own disposition pair stamps, and the write-off figures
 * (the journal entry's own id) via the ROW's own fields only: after the
 * disposition act the register REFETCHES and the row's own advanced shape
 * is the report. Zero client-side recomputation of any engine number.
 *
 * THE TYPED-REFUSAL PANEL (the shared piece): a refused act renders the
 * code + the message + the FULL details payload through the notices line's
 * localized summary; a refused list read renders the whole
 * TypedRefusalPanel — never a generic error.
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
import type {
  ApiErrorBody,
  ItemRow,
  NcrDispositionResult,
  NcrRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedNcrDisposition,
  localizedNcrSource,
  localizedNcrStatus,
  localizedQualityError,
  localizedQualitySeverity,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** Quantities ≤ 6dp (ADR-0009 — the engine's own regex). */
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NCR_SOURCES = ["INSPECTION", "PRODUCTION", "COMPLAINT", "SUPPLIER"] as const;
const NCR_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const NCR_DISPOSITIONS = ["REWORK", "SCRAP", "ACCEPT", "RETURN_TO_SUPPLIER"] as const;
const NCR_STATUSES = ["OPEN", "DISPOSITIONED", "CLOSED"] as const;

type NcrSource = (typeof NCR_SOURCES)[number];
type NcrSeverity = (typeof NCR_SEVERITIES)[number];
type NcrDisposition = (typeof NCR_DISPOSITIONS)[number];

/** The intake draft (the engine's own floor: a problem text + a qty). */
interface NcrDraft {
  source: NcrSource;
  severity: NcrSeverity;
  itemId: string;
  batchId: string;
  inspectionId: string;
  partnerId: string;
  problem: string;
  problemAr: string;
  affectedQty: string;
  note: string;
  noteAr: string;
}

const EMPTY_NCR: NcrDraft = {
  source: "INSPECTION",
  severity: "MEDIUM",
  itemId: "",
  batchId: "",
  inspectionId: "",
  partnerId: "",
  problem: "",
  problemAr: "",
  affectedQty: "",
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
  if (status === "DISPOSITIONED") return "info";
  return "warning";
}

function severityTone(severity: string): ChipTone {
  if (severity === "CRITICAL") return "danger";
  if (severity === "HIGH") return "warning";
  return "neutral";
}

export function QualityNcrBoard({
  locale,
  initialNcrs,
  ncrsError,
  items,
}: {
  locale: Locale;
  initialNcrs: readonly NcrRow[] | null;
  ncrsError: ApiErrorBody | null;
  items: readonly ItemRow[];
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
  const [ncrs, setNcrs] = useState<readonly NcrRow[] | null>(initialNcrs);
  const [ncrsRefusal, setNcrsRefusal] = useState<ApiErrorBody | null>(ncrsError);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [dispositionKind, setDispositionKind] = useState<NcrDisposition>("REWORK");

  // -- the intake pane ---------------------------------------------------------
  const [draft, setDraft] = useState<NcrDraft>({ ...EMPTY_NCR });

  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const selected = useMemo(
    () => (selectedId === null ? null : ncrs?.find((row) => row.id === selectedId) ?? null),
    [ncrs, selectedId],
  );

  const intakeReady =
    draft.itemId !== "" &&
    draft.problem.trim().length >= 1 &&
    QTY_RE.test(draft.affectedQty) &&
    (draft.batchId === "" || UUID_RE.test(draft.batchId.trim())) &&
    (draft.inspectionId === "" || UUID_RE.test(draft.inspectionId.trim())) &&
    (draft.partnerId === "" || UUID_RE.test(draft.partnerId.trim()));

  // -- the register list ------------------------------------------------------

  async function loadNcrs(): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "") params.set("status", statusFilter);
    if (sourceFilter !== "") params.set("source", sourceFilter);
    if (itemFilter !== "") params.set("itemId", itemFilter);
    const query = params.size === 0 ? "" : `?${params.toString()}`;
    const result = await bffFetch<readonly NcrRow[]>(`quality/ncr${query}`);
    setListLoading(false);
    if (!result.ok) {
      setNcrsRefusal(result.error);
      setNcrs(null);
      return;
    }
    setNcrsRefusal(null);
    setNcrs(result.data);
  }

  /** THE G-62 ACT'S DOOR: the disposition (BR-102's ladder step + the SCRAP
   * write-off through the REAL engine — the board only opens the door). */
  async function recordDisposition(): Promise<void> {
    if (selected === null) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("disposition");
    setError(null);
    const result = await bffFetch<NcrDispositionResult>(
      `quality/ncr/${selected.id}/disposition`,
      { method: "POST", body: { disposition: dispositionKind } },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDispositionOpen(false);
    setNotice(d.qualityNcrDispositionedToast);
    toast({ tone: "success", title: d.qualityNcrDispositionedToast });
    // THE ROW REFETCHES — the write-off figures render via the row's own
    // fields only (the disposition pair + the journal entry's own id), the
    // engine's own advanced row, never a client-side report.
    await loadNcrs();
    setSelectedId(result.data.ncr.id);
  }

  /** BR-102's ladder top: DISPOSITIONED → CLOSED. */
  async function closeNcr(): Promise<void> {
    if (selected === null) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("close");
    setError(null);
    const result = await bffFetch<NcrRow>(`quality/ncr/${selected.id}/close`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.qualityNcrClosedToast);
    toast({ tone: "success", title: d.qualityNcrClosedToast });
    setNcrs((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  // -- the intake act -----------------------------------------------------------

  async function createNcr(): Promise<void> {
    if (!intakeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<NcrRow>("quality/ncr", {
      method: "POST",
      body: {
        source: draft.source,
        severity: draft.severity,
        itemId: draft.itemId,
        ...(draft.batchId.trim() !== "" ? { batchId: draft.batchId.trim() } : {}),
        ...(draft.inspectionId.trim() !== "" ? { inspectionId: draft.inspectionId.trim() } : {}),
        ...(draft.partnerId.trim() !== "" ? { partnerId: draft.partnerId.trim() } : {}),
        problem: draft.problem.trim(),
        ...(draft.problemAr.trim() !== "" ? { problemAr: draft.problemAr.trim() } : {}),
        affectedQty: draft.affectedQty,
        ...(draft.note.trim() !== "" ? { note: draft.note.trim() } : {}),
        ...(draft.noteAr.trim() !== "" ? { noteAr: draft.noteAr.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDraft({ ...EMPTY_NCR });
    setNotice(d.qualityNcrCreatedToast);
    toast({ tone: "success", title: d.qualityNcrCreatedToast });
    // The register refetches (the new row's own place is the engine's).
    await loadNcrs();
  }

  // -- the register table -------------------------------------------------------

  const ncrColumns: DataTableColumn<NcrRow>[] = [
    {
      id: "ncrNo",
      header: activeLocaleHeader(d.qualityNcrColNo),
      accessor: (row) => row.ncrNo,
      render: (row) => monoCell(row.ncrNo),
    },
    {
      id: "item",
      header: activeLocaleHeader(d.qualityNcrColItem),
      accessor: (row) => itemLabelById.get(row.itemId) ?? shortId(row.itemId),
    },
    {
      id: "status",
      header: activeLocaleHeader(d.qualityNcrColStatus),
      accessor: (row) => localizedNcrStatus(d, row.status),
      render: (row) => <Chip tone={statusTone(row.status)}>{localizedNcrStatus(d, row.status)}</Chip>,
    },
    {
      id: "severity",
      header: activeLocaleHeader(d.qualityNcrColSeverity),
      accessor: (row) => localizedQualitySeverity(d, row.severity),
      render: (row) => (
        <Chip tone={severityTone(row.severity)}>{localizedQualitySeverity(d, row.severity)}</Chip>
      ),
    },
    {
      id: "source",
      header: activeLocaleHeader(d.qualityNcrColSource),
      accessor: (row) => localizedNcrSource(d, row.source),
    },
    {
      id: "affectedQty",
      header: activeLocaleHeader(d.qualityNcrColQty),
      accessor: (row) => row.affectedQty,
      render: (row) => monoCell(row.affectedQty),
    },
    {
      id: "problem",
      header: activeLocaleHeader(d.qualityNcrColProblem),
      accessor: (row) => localizedName(row.problem, row.problemAr, locale),
    },
    {
      id: "disposition",
      header: activeLocaleHeader(d.qualityNcrColDisposition),
      accessor: (row) => row.disposition ?? "—",
      render: (row) =>
        row.disposition === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          <Chip tone="info">{localizedNcrDisposition(d, row.disposition)}</Chip>
        ),
    },
    {
      id: "createdAt",
      header: activeLocaleHeader(d.qualityNcrColCreated),
      accessor: (row) => row.createdAt,
      render: (row) => monoCell(row.createdAt),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.qualityNcrOpen),
      accessor: () => d.qualityNcrOpen,
      render: (row) => (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setSelectedId(row.id)}
        >
          {d.qualityNcrOpen}
        </Button>
      ),
    },
  ];

  // -- the render -----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.qualityNcrTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.qualityNcrPaneRegister}
        </Button>
        <Button
          variant={pane === "intake" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "intake"}
          onClick={() => setPane("intake")}
        >
          {d.qualityNcrPaneIntake}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.qualityNcrPaneRegister}
            description={d.qualityNcrSubtitle}
            actions={
              <Button variant="secondary" size="sm" loading={listLoading} onClick={() => void loadNcrs()}>
                {d.qualityRefresh}
              </Button>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label={d.qualityNcrColStatus}
                value={statusFilter}
                onValueChange={setStatusFilter}
                placeholder="—"
                options={NCR_STATUSES.map((status) => ({
                  value: status,
                  label: localizedNcrStatus(d, status),
                }))}
              />
              <Select
                label={d.qualityNcrColSource}
                value={sourceFilter}
                onValueChange={setSourceFilter}
                placeholder="—"
                options={NCR_SOURCES.map((source) => ({
                  value: source,
                  label: localizedNcrSource(d, source),
                }))}
              />
              <Select
                label={d.qualityNcrColItem}
                value={itemFilter}
                onValueChange={setItemFilter}
                placeholder="—"
                options={items.map((item) => ({
                  value: item.id,
                  label: itemLabelById.get(item.id) ?? item.sku,
                }))}
              />
            </div>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {ncrsRefusal !== null ? (
            <TypedRefusalPanel
              error={ncrsRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {ncrsRefusal === null && ncrs !== null ? (
            ncrs.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualityNcrEmpty}</p>
            ) : (
              <DataTable columns={ncrColumns} rows={[...ncrs]} rowKey={(row) => row.id} />
            )
          ) : null}

          {selected !== null ? (
            <Card title={`${selected.ncrNo} · ${localizedName(selected.problem, selected.problemAr, locale)}`}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={statusTone(selected.status)}>{localizedNcrStatus(d, selected.status)}</Chip>
                  <Chip tone={severityTone(selected.severity)}>
                    {localizedQualitySeverity(d, selected.severity)}
                  </Chip>
                  <span className="text-sm text-gray-600">
                    {itemLabelById.get(selected.itemId) ?? shortId(selected.itemId)}
                  </span>
                  {selected.disposition !== null ? (
                    <Chip tone="info">{localizedNcrDisposition(d, selected.disposition)}</Chip>
                  ) : null}
                </div>

                <DefList
                  items={[
                    {
                      term: d.qualityNcrColQty,
                      children: monoCell(selected.affectedQty),
                    },
                    {
                      term: d.qualityNcrColSource,
                      children: localizedNcrSource(d, selected.source),
                    },
                    {
                      term: d.qualityNcrColCreated,
                      children: monoCell(selected.createdAt),
                    },
                    ...(selected.batchId !== null
                      ? [{ term: d.qualityNcrIntakeBatch, children: monoCell(selected.batchId) }]
                      : []),
                    ...(selected.inspectionId !== null
                      ? [{ term: d.qualityNcrIntakeInspection, children: monoCell(selected.inspectionId) }]
                      : []),
                    ...(selected.partnerId !== null
                      ? [{ term: d.qualityNcrIntakePartner, children: monoCell(selected.partnerId) }]
                      : []),
                    ...(selected.dispositionAt !== null
                      ? [{ term: d.qualityNcrColDisposition, children: monoCell(selected.dispositionAt) }]
                      : []),
                    ...(selected.closedAt !== null
                      ? [{ term: d.qualityNcrCloseAct, children: monoCell(selected.closedAt) }]
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
                        setDispositionKind("REWORK");
                        setDispositionOpen(true);
                      }}
                    >
                      {d.qualityNcrColDisposition}
                    </Button>
                  ) : null}
                  {selected.status === "DISPOSITIONED" ? (
                    <Button
                      variant="secondary"
                      loading={busy === "close"}
                      onClick={() => void closeNcr()}
                    >
                      {d.qualityNcrCloseAct}
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setSelectedId(null)}>
                    {d.commonClear}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      ) : (
        <Card title={d.qualityNcrIntakeTitle} description={d.qualityNcrSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.qualityNcrColSource}
              value={draft.source}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, source: value as NcrSource }))}
              placeholder="INSPECTION"
              options={NCR_SOURCES.map((source) => ({
                value: source,
                label: localizedNcrSource(d, source),
              }))}
            />
            <Select
              label={d.qualityNcrColSeverity}
              value={draft.severity}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, severity: value as NcrSeverity }))}
              placeholder="MEDIUM"
              options={NCR_SEVERITIES.map((severity) => ({
                value: severity,
                label: localizedQualitySeverity(d, severity),
              }))}
            />
            <div className="sm:col-span-2">
              <Select
                label={d.qualityNcrColItem}
                value={draft.itemId}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, itemId: value }))}
                placeholder="—"
                options={items.map((item) => ({
                  value: item.id,
                  label: itemLabelById.get(item.id) ?? item.sku,
                }))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityNcrIntakeProblem}
                value={draft.problem}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, problem: value }))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityNcrIntakeProblemAr}
                value={draft.problemAr}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, problemAr: value }))}
              />
            </div>
            <Input
              label={d.qualityNcrIntakeQty}
              value={draft.affectedQty}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, affectedQty: value }))}
              inputMode="decimal"
              mono
              required
            />
            <Input
              label={d.qualityNcrIntakeBatch}
              value={draft.batchId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, batchId: value }))}
              mono
              bidiIsolate
            />
            <Input
              label={d.qualityNcrIntakeInspection}
              value={draft.inspectionId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, inspectionId: value }))}
              mono
              bidiIsolate
            />
            <Input
              label={d.qualityNcrIntakePartner}
              value={draft.partnerId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, partnerId: value }))}
              mono
              bidiIsolate
            />
            <div className="sm:col-span-2">
              <Input
                label={d.qualityNcrIntakeNote}
                value={draft.note}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, note: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityNcrIntakeNoteAr}
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
              onClick={() => void createNcr()}
            >
              {d.qualityNcrCreate}
            </Button>
          </div>
        </Card>
      )}

      {/* -- the disposition dialog (the G-62 act's door) ------------------------ */}
      <Dialog open={dispositionOpen} onOpenChange={setDispositionOpen} title={d.qualityNcrDispositionTitle}>
        <div className="flex flex-col gap-3">
          <Select
            label={d.qualityNcrColDisposition}
            value={dispositionKind}
            onValueChange={(value) => setDispositionKind(value as NcrDisposition)}
            placeholder="REWORK"
            options={NCR_DISPOSITIONS.map((kind) => ({
              value: kind,
              label: localizedNcrDisposition(d, kind),
            }))}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDispositionOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "disposition"}
            onClick={() => void recordDisposition()}
          >
            {d.qualityNcrDispositionTitle}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
