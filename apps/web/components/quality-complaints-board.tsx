"use client";

/**
 * PHASE-050 (W-29 — T-15) — the complaints board (the /quality/complaints
 * screen body): the customer-complaint register + the intake form + the
 * lifecycle acts (triage with the optional NCR link, progress, resolve with
 * the resolution text, close) — cloned from the W-21 meters-board pattern
 * (the data-slot shape, two panes on a segmented switch, never the Tabs
 * primitive).
 *
 * THE ENGINE-OUTPUT LAW: every figure is an ENGINE OUTPUT rendered VERBATIM
 * — the record's own official complaintNo, its own status ladder, the NCR
 * link's own id, and the resolution pair (resolution + resolvedAt). Zero
 * client-side recomputation.
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
  ComplaintRow,
  ItemRow,
  NcrRow,
  PartnerRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedComplaintChannel,
  localizedComplaintStatus,
  localizedQualityError,
  localizedQualitySeverity,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPLAINT_STATUSES = ["NEW", "TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const COMPLAINT_CHANNELS = ["PHONE", "EMAIL", "WALK_IN", "PORTAL", "SOCIAL", "OTHER"] as const;
const COMPLAINT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];
type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number];

/** The intake draft (the engine's own floor). */
interface ComplaintDraft {
  channel: ComplaintChannel;
  severity: ComplaintSeverity;
  customerId: string;
  itemId: string;
  batchId: string;
  subject: string;
  details: string;
  detailsAr: string;
  note: string;
  noteAr: string;
}

const EMPTY_COMPLAINT: ComplaintDraft = {
  channel: "PHONE",
  severity: "MEDIUM",
  customerId: "",
  itemId: "",
  batchId: "",
  subject: "",
  details: "",
  detailsAr: "",
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
  if (status === "RESOLVED") return "info";
  if (status === "IN_PROGRESS") return "info";
  return "warning";
}

function severityTone(severity: string): ChipTone {
  if (severity === "CRITICAL") return "danger";
  if (severity === "HIGH") return "warning";
  return "neutral";
}

export function QualityComplaintsBoard({
  locale,
  initialComplaints,
  complaintsError,
  customers,
  items,
  ncrs,
}: {
  locale: Locale;
  initialComplaints: readonly ComplaintRow[] | null;
  complaintsError: ApiErrorBody | null;
  customers: readonly PartnerRow[];
  items: readonly ItemRow[];
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
  const [complaints, setComplaints] = useState<readonly ComplaintRow[] | null>(
    initialComplaints,
  );
  const [complaintsRefusal, setComplaintsRefusal] = useState<ApiErrorBody | null>(
    complaintsError,
  );
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triageOpen, setTriageOpen] = useState(false);
  const [triageNcrId, setTriageNcrId] = useState("");
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState("");

  // -- the intake pane ---------------------------------------------------------
  const [draft, setDraft] = useState<ComplaintDraft>({ ...EMPTY_COMPLAINT });

  const customerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      map.set(
        customer.id,
        `${customer.code} · ${localizedName(customer.name, customer.nameAr, locale)}`,
      );
    }
    return map;
  }, [customers, locale]);

  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const ncrLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ncr of ncrs) {
      map.set(ncr.id, ncr.ncrNo);
    }
    return map;
  }, [ncrs]);

  const selected = useMemo(
    () => (selectedId === null ? null : complaints?.find((row) => row.id === selectedId) ?? null),
    [complaints, selectedId],
  );

  const intakeReady =
    draft.customerId !== "" &&
    draft.subject.trim().length >= 1 &&
    (draft.batchId === "" || UUID_RE.test(draft.batchId.trim()));

  const resolveReady = resolution.trim().length >= 1;

  // -- the register list ------------------------------------------------------

  async function loadComplaints(): Promise<void> {
    setListLoading(true);
    const query = statusFilter === "" ? "" : `?status=${encodeURIComponent(statusFilter)}`;
    const result = await bffFetch<readonly ComplaintRow[]>(`quality/complaints${query}`);
    setListLoading(false);
    if (!result.ok) {
      setComplaintsRefusal(result.error);
      setComplaints(null);
      return;
    }
    setComplaintsRefusal(null);
    setComplaints(result.data);
  }

  /** THE TRIAGE ACT — the NCR link's window (TRIAGED/IN_PROGRESS only; the
   * first link may land with the triage itself). */
  async function triageComplaint(): Promise<void> {
    if (selected === null) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("triage");
    setError(null);
    const result = await bffFetch<ComplaintRow>(`quality/complaints/${selected.id}/triage`, {
      method: "POST",
      body:
        triageNcrId === ""
          ? {}
          : { ncrId: triageNcrId },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTriageOpen(false);
    setTriageNcrId("");
    setNotice(d.qualityComplaintsTriageToast);
    toast({ tone: "success", title: d.qualityComplaintsTriageToast });
    setComplaints((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  /** The ladder's rung: TRIAGED → IN_PROGRESS. */
  async function progressComplaint(): Promise<void> {
    if (selected === null) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("progress");
    setError(null);
    const result = await bffFetch<ComplaintRow>(`quality/complaints/${selected.id}/progress`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.qualityComplaintsProgressToast);
    toast({ tone: "success", title: d.qualityComplaintsProgressToast });
    setComplaints((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  /** THE RESOLUTION PAIR (the 0114 CHECK's both-sides shape — the text and
   * the stamp land together). */
  async function resolveComplaint(): Promise<void> {
    if (selected === null || !resolveReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("resolve");
    setError(null);
    const result = await bffFetch<ComplaintRow>(`quality/complaints/${selected.id}/resolve`, {
      method: "POST",
      body: { resolution: resolution.trim() },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setResolveOpen(false);
    setResolution("");
    setNotice(d.qualityComplaintsResolveToast);
    toast({ tone: "success", title: d.qualityComplaintsResolveToast });
    setComplaints((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  /** The ladder top: RESOLVED → CLOSED. */
  async function closeComplaint(): Promise<void> {
    if (selected === null) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("close");
    setError(null);
    const result = await bffFetch<ComplaintRow>(`quality/complaints/${selected.id}/close`, {
      method: "POST",
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.qualityComplaintsCloseToast);
    toast({ tone: "success", title: d.qualityComplaintsCloseToast });
    setComplaints((current) =>
      current === null ? current : current.map((row) => (row.id === result.data.id ? result.data : row)),
    );
    setSelectedId(result.data.id);
  }

  // -- the intake act -----------------------------------------------------------

  async function createComplaint(): Promise<void> {
    if (!intakeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<ComplaintRow>("quality/complaints", {
      method: "POST",
      body: {
        channel: draft.channel,
        severity: draft.severity,
        customerId: draft.customerId,
        ...(draft.itemId !== "" ? { itemId: draft.itemId } : {}),
        ...(draft.batchId.trim() !== "" ? { batchId: draft.batchId.trim() } : {}),
        subject: draft.subject.trim(),
        ...(draft.details.trim() !== "" ? { details: draft.details.trim() } : {}),
        ...(draft.detailsAr.trim() !== "" ? { detailsAr: draft.detailsAr.trim() } : {}),
        ...(draft.note.trim() !== "" ? { note: draft.note.trim() } : {}),
        ...(draft.noteAr.trim() !== "" ? { noteAr: draft.noteAr.trim() } : {}),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedQualityError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDraft({ ...EMPTY_COMPLAINT });
    setNotice(d.qualityComplaintsCreatedToast);
    toast({ tone: "success", title: d.qualityComplaintsCreatedToast });
    await loadComplaints();
  }

  // -- the register table -------------------------------------------------------

  const complaintColumns: DataTableColumn<ComplaintRow>[] = [
    {
      id: "complaintNo",
      header: activeLocaleHeader(d.qualityComplaintsColNo),
      accessor: (row) => row.complaintNo,
      render: (row) => monoCell(row.complaintNo),
    },
    {
      id: "customer",
      header: activeLocaleHeader(d.qualityComplaintsColCustomer),
      accessor: (row) => customerLabelById.get(row.customerId) ?? shortId(row.customerId),
    },
    {
      id: "channel",
      header: activeLocaleHeader(d.qualityComplaintsColChannel),
      accessor: (row) => localizedComplaintChannel(d, row.channel),
    },
    {
      id: "severity",
      header: activeLocaleHeader(d.qualityComplaintsColSeverity),
      accessor: (row) => localizedQualitySeverity(d, row.severity),
      render: (row) => (
        <Chip tone={severityTone(row.severity)}>
          {localizedQualitySeverity(d, row.severity)}
        </Chip>
      ),
    },
    {
      id: "subject",
      header: activeLocaleHeader(d.qualityComplaintsColSubject),
      accessor: (row) => row.subject,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.qualityComplaintsColStatus),
      accessor: (row) => localizedComplaintStatus(d, row.status),
      render: (row) => (
        <Chip tone={statusTone(row.status)}>{localizedComplaintStatus(d, row.status)}</Chip>
      ),
    },
    {
      id: "ncr",
      header: activeLocaleHeader(d.qualityComplaintsColNcr),
      accessor: (row) => row.ncrId ?? "—",
      render: (row) =>
        row.ncrId === null ? (
          <span className="text-xs text-gray-500">—</span>
        ) : (
          monoCell(ncrLabelById.get(row.ncrId) ?? shortId(row.ncrId), row.ncrId)
        ),
    },
    {
      id: "createdAt",
      header: activeLocaleHeader(d.qualityComplaintsColCreated),
      accessor: (row) => row.createdAt,
      render: (row) => monoCell(row.createdAt),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.qualityComplaintsOpen),
      accessor: () => d.qualityComplaintsOpen,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => setSelectedId(row.id)}>
          {d.qualityComplaintsOpen}
        </Button>
      ),
    },
  ];

  // -- the render -----------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="tablist"
        aria-label={d.qualityComplaintsTitle}
      >
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.qualityComplaintsPaneRegister}
        </Button>
        <Button
          variant={pane === "intake" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "intake"}
          onClick={() => setPane("intake")}
        >
          {d.qualityComplaintsPaneIntake}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <>
          <Card
            title={d.qualityComplaintsPaneRegister}
            description={d.qualityComplaintsSubtitle}
            actions={
              <Button
                variant="secondary"
                size="sm"
                loading={listLoading}
                onClick={() => void loadComplaints()}
              >
                {d.qualityRefresh}
              </Button>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <Select
                label={d.qualityComplaintsColStatus}
                value={statusFilter}
                onValueChange={setStatusFilter}
                placeholder="—"
                options={COMPLAINT_STATUSES.map((status) => ({
                  value: status,
                  label: localizedComplaintStatus(d, status),
                }))}
              />
            </div>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {complaintsRefusal !== null ? (
            <TypedRefusalPanel
              error={complaintsRefusal}
              title={d.qualityRefusalTitle}
              detailsLabel={d.qualityRefusalDetails}
            />
          ) : null}

          {complaintsRefusal === null && complaints !== null ? (
            complaints.length === 0 ? (
              <p className="text-sm text-gray-600">{d.qualityComplaintsEmpty}</p>
            ) : (
              <DataTable
                columns={complaintColumns}
                rows={[...complaints]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}

          {selected !== null ? (
            <Card title={`${selected.complaintNo} · ${selected.subject}`}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={statusTone(selected.status)}>
                    {localizedComplaintStatus(d, selected.status)}
                  </Chip>
                  <Chip tone={severityTone(selected.severity)}>
                    {localizedQualitySeverity(d, selected.severity)}
                  </Chip>
                  <span className="text-sm text-gray-600">
                    {customerLabelById.get(selected.customerId) ?? shortId(selected.customerId)}
                  </span>
                  <span className="text-sm text-gray-600">
                    {localizedComplaintChannel(d, selected.channel)}
                  </span>
                </div>

                <DefList
                  items={[
                    ...(selected.itemId !== null
                      ? [
                          {
                            term: d.qualityComplaintsIntakeItem,
                            children:
                              itemLabelById.get(selected.itemId) ?? shortId(selected.itemId),
                          },
                        ]
                      : []),
                    ...(selected.batchId !== null
                      ? [
                          {
                            term: d.qualityComplaintsIntakeBatch,
                            children: monoCell(selected.batchId),
                          },
                        ]
                      : []),
                    ...(selected.ncrId !== null
                      ? [
                          {
                            term: d.qualityComplaintsColNcr,
                            children: monoCell(
                              ncrLabelById.get(selected.ncrId) ?? shortId(selected.ncrId),
                              selected.ncrId,
                            ),
                          },
                        ]
                      : []),
                    ...(selected.resolvedAt !== null
                      ? [
                          {
                            term: d.qualityComplaintsResolvedAt,
                            children: monoCell(selected.resolvedAt),
                          },
                        ]
                      : []),
                  ]}
                />

                {selected.details !== null || selected.detailsAr !== null ? (
                  <p className="text-sm text-gray-700">
                    {localizedName(selected.details ?? "—", selected.detailsAr, locale)}
                  </p>
                ) : null}

                {selected.resolution !== null ? (
                  <p className="text-sm text-gray-700">{selected.resolution}</p>
                ) : null}

                {/* THE LIFECYCLE ACTS — the board opens the door, the engine
                    decides (the total status × move matrix). */}
                <div className="flex flex-wrap gap-2">
                  {selected.status === "NEW" ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setTriageNcrId("");
                        setTriageOpen(true);
                      }}
                    >
                      {d.qualityComplaintsTriageAct}
                    </Button>
                  ) : null}
                  {selected.status === "TRIAGED" ? (
                    <Button
                      variant="secondary"
                      loading={busy === "progress"}
                      onClick={() => void progressComplaint()}
                    >
                      {d.qualityComplaintsProgressAct}
                    </Button>
                  ) : null}
                  {selected.status === "IN_PROGRESS" ? (
                    <Button
                      variant="primary"
                      onClick={() => {
                        setResolution("");
                        setResolveOpen(true);
                      }}
                    >
                      {d.qualityComplaintsResolveAct}
                    </Button>
                  ) : null}
                  {selected.status === "RESOLVED" ? (
                    <Button
                      variant="secondary"
                      loading={busy === "close"}
                      onClick={() => void closeComplaint()}
                    >
                      {d.qualityComplaintsCloseAct}
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
        <Card title={d.qualityComplaintsIntakeTitle} description={d.qualityComplaintsSubtitle}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label={d.qualityComplaintsColChannel}
              value={draft.channel}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, channel: value as ComplaintChannel }))
              }
              placeholder="PHONE"
              options={COMPLAINT_CHANNELS.map((channel) => ({
                value: channel,
                label: localizedComplaintChannel(d, channel),
              }))}
            />
            <Select
              label={d.qualityComplaintsColSeverity}
              value={draft.severity}
              onValueChange={(value) =>
                setDraft((prev) => ({ ...prev, severity: value as ComplaintSeverity }))
              }
              placeholder="MEDIUM"
              options={COMPLAINT_SEVERITIES.map((severity) => ({
                value: severity,
                label: localizedQualitySeverity(d, severity),
              }))}
            />
            <div className="sm:col-span-2">
              <Select
                label={d.qualityComplaintsIntakeCustomer}
                value={draft.customerId}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, customerId: value }))}
                placeholder="—"
                options={customers.map((customer) => ({
                  value: customer.id,
                  label: customerLabelById.get(customer.id) ?? customer.code,
                }))}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityComplaintsIntakeSubject}
                value={draft.subject}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, subject: value }))}
                required
              />
            </div>
            <Select
              label={d.qualityComplaintsIntakeItem}
              value={draft.itemId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, itemId: value }))}
              placeholder="—"
              options={items.map((item) => ({
                value: item.id,
                label: itemLabelById.get(item.id) ?? item.sku,
              }))}
            />
            <Input
              label={d.qualityComplaintsIntakeBatch}
              value={draft.batchId}
              onValueChange={(value) => setDraft((prev) => ({ ...prev, batchId: value }))}
              mono
              bidiIsolate
            />
            <div className="sm:col-span-2">
              <Input
                label={d.qualityComplaintsIntakeDetails}
                value={draft.details}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, details: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityComplaintsIntakeDetailsAr}
                value={draft.detailsAr}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, detailsAr: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityComplaintsIntakeNote}
                value={draft.note}
                onValueChange={(value) => setDraft((prev) => ({ ...prev, note: value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={d.qualityComplaintsIntakeNoteAr}
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
              onClick={() => void createComplaint()}
            >
              {d.qualityComplaintsCreate}
            </Button>
          </div>
        </Card>
      )}

      {/* -- the triage dialog (the NCR link's window) --------------------------- */}
      <Dialog open={triageOpen} onOpenChange={setTriageOpen} title={d.qualityComplaintsTriageTitle}>
        <div className="flex flex-col gap-3">
          <Select
            label={d.qualityComplaintsTriageNcr}
            value={triageNcrId}
            onValueChange={setTriageNcrId}
            placeholder="—"
            options={ncrs.map((ncr) => ({
              value: ncr.id,
              label: `${ncr.ncrNo} · ${ncr.problem}`,
            }))}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTriageOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "triage"}
            onClick={() => void triageComplaint()}
          >
            {d.qualityComplaintsTriageAct}
          </Button>
        </div>
      </Dialog>

      {/* -- the resolve dialog (the resolution pair) ---------------------------- */}
      <Dialog open={resolveOpen} onOpenChange={setResolveOpen} title={d.qualityComplaintsResolveTitle}>
        <div className="flex flex-col gap-3">
          <Input
            label={d.qualityComplaintsResolution}
            value={resolution}
            onValueChange={setResolution}
            required
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setResolveOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "resolve"}
            disabled={!resolveReady}
            onClick={() => void resolveComplaint()}
          >
            {d.qualityComplaintsResolveAct}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
