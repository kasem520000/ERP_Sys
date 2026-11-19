"use client";

/**
 * PHASE-047 (W-5, T-13 + T-14's alert surfaces) — the org-structure board
 * (PAGE_ARCHETYPES §8, the hr-leave-board pattern): THREE TABS — the
 * org-unit TREE (create + rename + the cycle-safe MOVE: every move calls
 * the guarded API, never client-side reordering — D-09's law), the
 * position register (create + edit incl. the reports_to re-parent under
 * the same cycle guard), and the DOCUMENTS & ALERTS plane (HR-10's
 * register — the tenant-wide alert list with the 30/7/0-style expiry
 * chips + create/patch/delete per employee, and the sweep's
 * registration surface: the tenant-configurable thresholds + the
 * explicit off switch). Typed refusals render through the localized
 * talent mirror.
 */
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
  Dialog,
  Input,
  Select,
  Switch,
  Tabs,
  Textarea,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  EmployeeDocumentRow,
  EmployeeListRow,
  HrAlertJobRow,
  OrgUnitRow,
  PositionRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedTalentDocumentKind,
  localizedTalentError,
  localizedTalentPositionStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DOC_KINDS = ["PASSPORT", "IQAMA", "VISA", "CONTRACT", "CERTIFICATE", "OTHER"] as const;
type DocKind = (typeof DOC_KINDS)[number];

type OrgTab = "units" | "positions" | "documents";

/** The whole days between today and an ISO date (negative = expired) —
 * both anchors are midnight-UTC so the division is EXACT (never a
 * rounded float; the money rule's spirit, applied to day counts). */
function daysUntil(date: string): number {
  return (
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
    86_400_000
  );
}

export function HrOrgBoard({
  locale,
  initialUnits,
  initialPositions,
  initialDocuments,
  initialAlertJob,
  employees,
}: {
  locale: Locale;
  initialUnits: readonly OrgUnitRow[];
  initialPositions: readonly PositionRow[];
  /** null = the session lacks hr.documents.manage (the tab renders the
   * honest no-permission notice). */
  initialDocuments: readonly EmployeeDocumentRow[] | null;
  initialAlertJob: HrAlertJobRow | null;
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const tabItems = useMemo(
    () => [
      { value: "units" as const, label: d.talTabOrgUnits },
      { value: "positions" as const, label: d.talTabPositions },
      { value: "documents" as const, label: d.talTabDocsAlerts },
    ],
    [d],
  );
  const [tab, setTab] = useState<OrgTab>("units");

  const employeeLabel = useCallback(
    (id: string): string => {
      const found = employees.find((employee) => employee.id === id);
      return found === undefined
        ? "—"
        : `${found.code} · ${localizedName(found.name, found.nameAr, locale)}`;
    },
    [employees, locale],
  );

  // ── the org-unit tree ────────────────────────────────────────────────────
  const [units, setUnits] = useState<readonly OrgUnitRow[]>(initialUnits);
  const [unitCreateOpen, setUnitCreateOpen] = useState(false);
  const [uCode, setUCode] = useState("");
  const [uName, setUName] = useState("");
  const [uNameAr, setUNameAr] = useState("");
  const [uParent, setUParent] = useState("");
  const [renameTarget, setRenameTarget] = useState<OrgUnitRow | null>(null);
  const [rName, setRName] = useState("");
  const [rNameAr, setRNameAr] = useState("");
  const [moveTarget, setMoveTarget] = useState<OrgUnitRow | null>(null);
  const [mParent, setMParent] = useState("");

  /** The tree rows ordered by path (the materialized path IS the order). */
  const orderedUnits = useMemo(
    () => [...units].sort((a, b) => a.path.localeCompare(b.path)),
    [units],
  );

  const unitLabel = useCallback(
    (unit: OrgUnitRow): string => localizedName(unit.name, unit.nameAr, locale),
    [locale],
  );

  async function createUnit(): Promise<void> {
    setError(null);
    if (uCode.trim() === "" || uName.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("unit-create");
    const result = await bffFetch<OrgUnitRow>("hr/org/units", {
      method: "POST",
      body: {
        code: uCode.trim(),
        name: uName.trim(),
        nameAr: uNameAr.trim() === "" ? null : uNameAr.trim(),
        parentId: uParent === "" ? null : uParent,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setUnits([result.data, ...units]);
    setUnitCreateOpen(false);
    setUCode(""); setUName(""); setUNameAr(""); setUParent("");
    toast({ tone: "success", title: d.talUnitSavedToast });
  }

  async function renameUnit(): Promise<void> {
    if (renameTarget === null) {
      return;
    }
    setError(null);
    if (rName.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("unit-rename");
    const result = await bffFetch<OrgUnitRow>(`hr/org/units/${renameTarget.id}`, {
      method: "PATCH",
      body: {
        name: rName.trim(),
        nameAr: rNameAr.trim() === "" ? null : rNameAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setUnits(units.map((row) => (row.id === result.data.id ? result.data : row)));
    setRenameTarget(null);
    toast({ tone: "success", title: d.talUnitSavedToast });
  }

  async function moveUnit(): Promise<void> {
    if (moveTarget === null) {
      return;
    }
    setError(null);
    setBusy("unit-move");
    const result = await bffFetch<OrgUnitRow>(`hr/org/units/${moveTarget.id}`, {
      method: "PATCH",
      // Tri-state law: null = move to root, uuid = re-parent.
      body: { parentId: mParent === "" ? null : mParent },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    // The move re-pathed the subtree — the honest refresh re-reads the tree.
    const refreshed = await bffFetch<readonly OrgUnitRow[]>("hr/org/units");
    if (refreshed.ok) {
      setUnits(refreshed.data);
    } else {
      setUnits(units.map((row) => (row.id === result.data.id ? result.data : row)));
    }
    setMoveTarget(null);
    toast({ tone: "success", title: d.talUnitMovedToast });
  }

  // ── positions ────────────────────────────────────────────────────────────
  const [positions, setPositions] = useState<readonly PositionRow[]>(initialPositions);
  const [posCreateOpen, setPosCreateOpen] = useState(false);
  const [sCode, setSCode] = useState("");
  const [sTitle, setSTitle] = useState("");
  const [sTitleAr, setSTitleAr] = useState("");
  const [sGrade, setSGrade] = useState("");
  const [sUnit, setSUnit] = useState("");
  const [sReportsTo, setSReportsTo] = useState("");
  const [posSort, setPosSort] = useState<DataTableSort[]>([]);
  const [editTarget, setEditTarget] = useState<PositionRow | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eGrade, setEGrade] = useState("");
  const [eUnit, setEUnit] = useState("");
  const [eReportsTo, setEReportsTo] = useState("");

  const positionLabel = useCallback(
    (position: PositionRow): string => localizedName(position.title, position.titleAr, locale),
    [locale],
  );

  async function createPosition(): Promise<void> {
    setError(null);
    if (sCode.trim() === "" || sTitle.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("pos-create");
    const result = await bffFetch<PositionRow>("hr/positions", {
      method: "POST",
      body: {
        code: sCode.trim(),
        title: sTitle.trim(),
        titleAr: sTitleAr.trim() === "" ? null : sTitleAr.trim(),
        grade: sGrade.trim() === "" ? null : sGrade.trim(),
        orgUnitId: sUnit === "" ? null : sUnit,
        reportsTo: sReportsTo === "" ? null : sReportsTo,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPositions([result.data, ...positions]);
    setPosCreateOpen(false);
    setSCode(""); setSTitle(""); setSTitleAr(""); setSGrade(""); setSUnit(""); setSReportsTo("");
    toast({ tone: "success", title: d.talPositionSavedToast });
  }

  async function savePosition(retire: boolean): Promise<void> {
    if (editTarget === null) {
      return;
    }
    setError(null);
    setBusy("pos-edit");
    const result = await bffFetch<PositionRow>(`hr/positions/${editTarget.id}`, {
      method: "PATCH",
      body: {
        ...(retire ? { status: "RETIRED" } : {}),
        ...(!retire ? { title: eTitle.trim() } : {}),
        ...(retire || eGrade.trim() !== "" ? { grade: eGrade.trim() === "" ? null : eGrade.trim() } : {}),
        orgUnitId: eUnit === "" ? null : eUnit,
        reportsTo: eReportsTo === "" ? null : eReportsTo,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPositions(positions.map((row) => (row.id === result.data.id ? result.data : row)));
    setEditTarget(null);
    toast({ tone: "success", title: d.talPositionSavedToast });
  }

  // ── documents & alerts (HR-10 + the sweep's registration surface) ───────
  const [documents, setDocuments] = useState<readonly EmployeeDocumentRow[] | null>(initialDocuments);
  const [docFilterKind, setDocFilterKind] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [docSort, setDocSort] = useState<DataTableSort[]>([]);
  const [docCreateOpen, setDocCreateOpen] = useState(false);
  const [oEmployee, setOEmployee] = useState("");
  const [oKind, setOKind] = useState<DocKind>("IQAMA");
  const [oNumber, setONumber] = useState("");
  const [oIssued, setOIssued] = useState("");
  const [oExpires, setOExpires] = useState("");
  const [oNotes, setONotes] = useState("");
  const [docEditTarget, setDocEditTarget] = useState<EmployeeDocumentRow | null>(null);
  const [xNumber, setXNumber] = useState("");
  const [xIssued, setXIssued] = useState("");
  const [xExpires, setXExpires] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmployeeDocumentRow | null>(null);

  const [alertJob, setAlertJob] = useState<HrAlertJobRow | null>(initialAlertJob);
  const [thresholds, setThresholds] = useState(
    initialAlertJob === null ? "30, 7, 0" : (initialAlertJob.thresholds as readonly number[]).join(", "),
  );
  const [sweepActive, setSweepActive] = useState(initialAlertJob === null ? true : initialAlertJob.isActive);
  const [sweepNote, setSweepNote] = useState(initialAlertJob?.note ?? "");

  const visibleDocuments = useMemo(
    () =>
      documents === null
        ? []
        : docFilterKind === ""
          ? documents
          : documents.filter((document) => document.kind === docFilterKind),
    [documents, docFilterKind],
  );

  async function loadDocuments(): Promise<void> {
    setDocBusy(true); setDocError(null);
    const search = new URLSearchParams({ limit: "500" });
    if (docFilterKind !== "") {
      search.set("kind", docFilterKind);
    }
    const result = await bffFetch<readonly EmployeeDocumentRow[]>(`hr/documents?${search.toString()}`);
    setDocBusy(false);
    if (!result.ok) {
      setDocError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setDocuments(result.data);
  }

  async function createDocument(): Promise<void> {
    setDocError(null);
    if (oEmployee === "") {
      setDocError(d.budgetFormInvalid);
      return;
    }
    if (oIssued !== "" && !DATE_RE.test(oIssued)) {
      setDocError(d.budgetFormInvalid);
      return;
    }
    if (oExpires !== "" && !DATE_RE.test(oExpires)) {
      setDocError(d.budgetFormInvalid);
      return;
    }
    setBusy("doc-create");
    const result = await bffFetch<EmployeeDocumentRow>("hr/documents", {
      method: "POST",
      body: {
        employeeId: oEmployee,
        kind: oKind,
        number: oNumber.trim() === "" ? null : oNumber.trim(),
        issuedOn: oIssued === "" ? null : oIssued,
        expiresOn: oExpires === "" ? null : oExpires,
        notes: oNotes.trim() === "" ? null : oNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setDocError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (documents !== null) {
      setDocuments([result.data, ...documents]);
    }
    setDocCreateOpen(false);
    setOEmployee(""); setOKind("IQAMA"); setONumber(""); setOIssued(""); setOExpires(""); setONotes("");
    toast({ tone: "success", title: d.talDocSavedToast });
  }

  async function patchDocument(): Promise<void> {
    if (docEditTarget === null) {
      return;
    }
    setDocError(null);
    if (xIssued !== "" && !DATE_RE.test(xIssued)) {
      setDocError(d.budgetFormInvalid);
      return;
    }
    if (xExpires !== "" && !DATE_RE.test(xExpires)) {
      setDocError(d.budgetFormInvalid);
      return;
    }
    setBusy("doc-patch");
    const result = await bffFetch<EmployeeDocumentRow>(`hr/documents/${docEditTarget.id}`, {
      method: "PATCH",
      body: {
        number: xNumber.trim() === "" ? null : xNumber.trim(),
        issuedOn: xIssued === "" ? null : xIssued,
        expiresOn: xExpires === "" ? null : xExpires,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setDocError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (documents !== null) {
      setDocuments(documents.map((row) => (row.id === result.data.id ? result.data : row)));
    }
    setDocEditTarget(null);
    toast({ tone: "success", title: d.talDocSavedToast });
  }

  async function deleteDocument(): Promise<void> {
    if (deleteTarget === null) {
      return;
    }
    setDocError(null);
    setBusy("doc-delete");
    const result = await bffFetch<EmployeeDocumentRow>(`hr/documents/${deleteTarget.id}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!result.ok) {
      setDocError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (documents !== null) {
      setDocuments(documents.filter((row) => row.id !== deleteTarget.id));
    }
    setDeleteTarget(null);
    toast({ tone: "success", title: d.talDocDeletedToast });
  }

  async function saveAlertJob(): Promise<void> {
    setDocError(null);
    const parsed = thresholds
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((value) => Number.isInteger(value) && value >= 0);
    if (parsed.length === 0) {
      setDocError(d.budgetFormInvalid);
      return;
    }
    setBusy("alert-save");
    const result = await bffFetch<HrAlertJobRow>("hr/alerts/expiry-sweep", {
      method: "PUT",
      body: {
        thresholds: parsed,
        isActive: sweepActive,
        note: sweepNote.trim() === "" ? null : sweepNote.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setDocError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAlertJob(result.data);
    toast({ tone: "success", title: d.talAlertJobSavedToast });
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs items={tabItems} value={tab} onValueChange={(value) => setTab(value as OrgTab)}>
        <div data-slot="units" className="flex flex-col gap-4">
            <Card
              title={d.talOrgUnitsCard}
              actions={
                <Button variant="primary" onClick={() => setUnitCreateOpen(true)}>
                  {d.talOrgUnitNew}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.talMoveHint}</InfoNotice>
                {orderedUnits.length === 0 ? (
                  <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {orderedUnits.map((unit) => (
                      <div
                        key={unit.id}
                        className="flex flex-wrap items-center gap-3 rounded-md border border-subtle px-3 py-2"
                        style={{ marginInlineStart: `${Math.max(0, unit.path.split(".").length - 1) * 1.25}rem` }}
                      >
                        <span className="text-sm font-medium">{unitLabel(unit)}</span>
                        <span className="font-mono text-xs text-gray-500" dir="ltr">
                          {unit.code}
                        </span>
                        <Badge tone={unit.active ? "primary" : "neutral"}>
                          {unit.active ? d.talActiveBadge : d.talInactiveBadge}
                        </Badge>
                        <span className="font-mono text-xs text-gray-400" dir="ltr">
                          {unit.path}
                        </span>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setRenameTarget(unit);
                            setRName(unit.name);
                            setRNameAr(unit.nameAr ?? "");
                          }}
                        >
                          {d.talEditBtn}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setMoveTarget(unit);
                            setMParent(unit.parentId ?? "");
                          }}
                        >
                          {d.talMoveUnit}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Dialog open={unitCreateOpen} onOpenChange={setUnitCreateOpen} title={d.talOrgUnitNew}>
              <div className="flex flex-col gap-3">
                <Input id="tal-unit-code" label={d.hrColCode} value={uCode} onValueChange={setUCode} hint={d.talOrgCodeHint} required />
                <Input id="tal-unit-name" label={d.talLabelName} value={uName} onValueChange={setUName} required />
                <Input id="tal-unit-name-ar" label={d.talLabelNameAr} value={uNameAr} onValueChange={setUNameAr} />
                <Select
                  id="tal-unit-parent"
                  label={d.talLabelParent}
                  value={uParent}
                  onValueChange={setUParent}
                  options={[
                    { value: "", label: d.talRootOption },
                    ...orderedUnits.map((unit) => ({ value: unit.id, label: `${unitLabel(unit)} (${unit.path})` })),
                  ]}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createUnit()} loading={busy === "unit-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={renameTarget !== null}
              onOpenChange={(open) => {
                if (!open) setRenameTarget(null);
              }}
              title={renameTarget === null ? d.talEditBtn : `${d.talEditBtn} — ${unitLabel(renameTarget)}`}
            >
              <div className="flex flex-col gap-3">
                <Input id="tal-unit-rename" label={d.talLabelName} value={rName} onValueChange={setRName} required />
                <Input id="tal-unit-rename-ar" label={d.talLabelNameAr} value={rNameAr} onValueChange={setRNameAr} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void renameUnit()} loading={busy === "unit-rename"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={moveTarget !== null}
              onOpenChange={(open) => {
                if (!open) setMoveTarget(null);
              }}
              title={moveTarget === null ? d.talMoveUnit : `${d.talMoveUnit} — ${unitLabel(moveTarget)}`}
            >
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-unit-move-parent"
                  label={d.talLabelParent}
                  value={mParent}
                  onValueChange={setMParent}
                  options={[
                    { value: "", label: d.talRootOption },
                    ...orderedUnits
                      .filter((unit) => moveTarget === null || unit.id !== moveTarget.id)
                      .map((unit) => ({ value: unit.id, label: `${unitLabel(unit)} (${unit.path})` })),
                  ]}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void moveUnit()} loading={busy === "unit-move"}>
                    {d.talMoveUnit}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="positions" className="flex flex-col gap-4">
            <Card
              title={d.talPositionsCard}
              actions={
                <Button variant="primary" onClick={() => setPosCreateOpen(true)}>
                  {d.talPositionNew}
                </Button>
              }
            >
              <DataTable
                columns={[
                  {
                    id: "code",
                    header: activeLocaleHeader(d.hrColCode),
                    accessor: (row) => row.code,
                    mono: true,
                  },
                  {
                    id: "title",
                    header: activeLocaleHeader(d.talLabelTitle),
                    accessor: (row) => positionLabel(row),
                  },
                  {
                    id: "grade",
                    header: activeLocaleHeader(d.talLabelGrade),
                    accessor: (row) => row.grade ?? "—",
                  },
                  {
                    id: "unit",
                    header: activeLocaleHeader(d.talTabOrgUnits),
                    accessor: (row) =>
                      row.orgUnitId === null
                        ? "—"
                        : (units.find((unit) => unit.id === row.orgUnitId)?.path ?? "—"),
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-xs" dir="ltr">
                        {row.orgUnitId === null
                          ? "—"
                          : (units.find((unit) => unit.id === row.orgUnitId)?.path ?? "—")}
                      </span>
                    ),
                  },
                  {
                    id: "reportsTo",
                    header: activeLocaleHeader(d.talReportsTo),
                    accessor: (row) =>
                      row.reportsTo === null
                        ? "—"
                        : (positions.find((position) => position.id === row.reportsTo)?.code ?? "—"),
                    mono: true,
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.talLabelStatus),
                    accessor: (row) => localizedTalentPositionStatus(d, row.status),
                    render: (row) => (
                      <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                        {localizedTalentPositionStatus(d, row.status)}
                      </Badge>
                    ),
                  },
                  {
                    id: "actions",
                    header: activeLocaleHeader(d.talEditBtn),
                    accessor: () => "",
                    render: (row) => (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditTarget(row);
                          setETitle(row.title);
                          setEGrade(row.grade ?? "");
                          setEUnit(row.orgUnitId ?? "");
                          setEReportsTo(row.reportsTo ?? "");
                        }}
                      >
                        {d.talEditBtn}
                      </Button>
                    ),
                  },
                ]}
                rows={[...positions]}
                rowKey={(row) => row.id}
                sort={posSort}
                onSortChange={setPosSort}
                empty={{ title: d.talEmptyRows }}
              />
            </Card>

            <Dialog open={posCreateOpen} onOpenChange={setPosCreateOpen} title={d.talPositionNew}>
              <div className="flex flex-col gap-3">
                <Input id="tal-pos-code" label={d.hrColCode} value={sCode} onValueChange={setSCode} required />
                <Input id="tal-pos-title" label={d.talLabelTitle} value={sTitle} onValueChange={setSTitle} required />
                <Input id="tal-pos-title-ar" label={d.talLabelTitleAr} value={sTitleAr} onValueChange={setSTitleAr} />
                <Input id="tal-pos-grade" label={d.talLabelGrade} value={sGrade} onValueChange={setSGrade} />
                <Select
                  id="tal-pos-unit"
                  label={d.talSelectOrgUnit}
                  value={sUnit}
                  onValueChange={setSUnit}
                  options={[
                    { value: "", label: "—" },
                    ...orderedUnits.map((unit) => ({ value: unit.id, label: `${unitLabel(unit)} (${unit.path})` })),
                  ]}
                />
                <Select
                  id="tal-pos-reports"
                  label={d.talReportsTo}
                  value={sReportsTo}
                  onValueChange={setSReportsTo}
                  options={[
                    { value: "", label: d.talNoReportsTo },
                    ...positions.map((position) => ({
                      value: position.id,
                      label: `${position.code} · ${positionLabel(position)}`,
                    })),
                  ]}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createPosition()} loading={busy === "pos-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={editTarget !== null}
              onOpenChange={(open) => {
                if (!open) setEditTarget(null);
              }}
              title={editTarget === null ? d.talEditBtn : `${d.talEditBtn} — ${editTarget.code}`}
            >
              <div className="flex flex-col gap-3">
                <Input id="tal-pos-edit-title" label={d.talLabelTitle} value={eTitle} onValueChange={setETitle} />
                <Input id="tal-pos-edit-grade" label={d.talLabelGrade} value={eGrade} onValueChange={setEGrade} />
                <Select
                  id="tal-pos-edit-unit"
                  label={d.talSelectOrgUnit}
                  value={eUnit}
                  onValueChange={setEUnit}
                  options={[
                    { value: "", label: "—" },
                    ...orderedUnits.map((unit) => ({ value: unit.id, label: `${unitLabel(unit)} (${unit.path})` })),
                  ]}
                />
                <Select
                  id="tal-pos-edit-reports"
                  label={d.talReportsTo}
                  value={eReportsTo}
                  onValueChange={setEReportsTo}
                  options={[
                    { value: "", label: d.talNoReportsTo },
                    ...positions
                      .filter((position) => editTarget === null || position.id !== editTarget.id)
                      .map((position) => ({
                        value: position.id,
                        label: `${position.code} · ${positionLabel(position)}`,
                      })),
                  ]}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => void savePosition(true)} loading={busy === "pos-edit"}>
                    {d.talPositionRetired}
                  </Button>
                  <Button variant="primary" onClick={() => void savePosition(false)} loading={busy === "pos-edit"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="documents" className="flex flex-col gap-4">
            {documents === null ? (
              <Card title={d.talDocsCard}>
                <ErrorNotice>{d.errorsForbidden}</ErrorNotice>
              </Card>
            ) : (
              <>
                <Card
                  title={d.talAlertsCard}
                  description={d.talAlertsHint}
                >
                  <div className="flex flex-col gap-3">
                    <InfoNotice>{d.talAlertsCoverNote}</InfoNotice>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        id="tal-alert-thresholds"
                        label={d.talThresholds}
                        value={thresholds}
                        onValueChange={setThresholds}
                        hint={d.talThresholdsHint}
                        mono
                        bidiIsolate
                      />
                      <div className="flex items-end gap-3">
                        <Switch checked={sweepActive} onCheckedChange={setSweepActive} label={d.talSweepActive} />
                      </div>
                      <Input id="tal-alert-note" label={d.talLabelNotes} value={sweepNote} onValueChange={setSweepNote} />
                      <div className="flex items-end">
                        <Button variant="primary" onClick={() => void saveAlertJob()} loading={busy === "alert-save"}>
                          {d.talSaveBtn}
                        </Button>
                      </div>
                    </div>
                    {alertJob !== null && (
                      <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                        <span dir="ltr">
                          {d.talLastRun}: {alertJob.lastRunAt ?? d.talNeverRun}
                        </span>
                        <span dir="ltr">
                          {d.talLastFlagged}: {alertJob.lastFlagged}
                        </span>
                      </div>
                    )}
                  </div>
                </Card>

                <Card
                  title={d.talDocsCard}
                  description={d.talDocPiiNote}
                  actions={
                    <Button variant="primary" onClick={() => setDocCreateOpen(true)}>
                      {d.talDocNew}
                    </Button>
                  }
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-44">
                        <Select
                          id="tal-doc-filter-kind"
                          label={d.talDocKind}
                          value={docFilterKind}
                          onValueChange={setDocFilterKind}
                          options={[
                            { value: "", label: d.talFilterAll },
                            ...DOC_KINDS.map((kind) => ({
                              value: kind,
                              label: localizedTalentDocumentKind(d, kind),
                            })),
                          ]}
                        />
                      </div>
                      <Button onClick={() => void loadDocuments()} disabled={docBusy}>
                        {d.hrApplyBtn}
                      </Button>
                    </div>
                    {docError !== null && <ErrorNotice>{docError}</ErrorNotice>}
                    <DataTable
                      columns={[
                        {
                          id: "employee",
                          header: activeLocaleHeader(d.hrColEmployee),
                          accessor: (row) => employeeLabel(row.employeeId),
                        },
                        {
                          id: "kind",
                          header: activeLocaleHeader(d.talDocKind),
                          accessor: (row) => localizedTalentDocumentKind(d, row.kind),
                        },
                        {
                          id: "number",
                          header: activeLocaleHeader(d.talDocNumber),
                          accessor: (row) => row.number ?? "—",
                          mono: true,
                          render: (row) => (
                            <span className="font-mono text-sm" dir="ltr">
                              {row.number ?? "—"}
                            </span>
                          ),
                        },
                        {
                          id: "issuedOn",
                          header: activeLocaleHeader(d.talIssuedOn),
                          accessor: (row) => row.issuedOn ?? "—",
                          mono: true,
                          render: (row) => (
                            <span className="font-mono text-sm" dir="ltr">
                              {row.issuedOn ?? "—"}
                            </span>
                          ),
                        },
                        {
                          id: "expiresOn",
                          header: activeLocaleHeader(d.talExpiresOn),
                          accessor: (row) => row.expiresOn ?? "—",
                          mono: true,
                          render: (row) =>
                            row.expiresOn === null ? (
                              <span className="font-mono text-sm" dir="ltr">
                                {d.talNoExpiry}
                              </span>
                            ) : (
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-sm" dir="ltr">
                                  {row.expiresOn}
                                </span>
                                {daysUntil(row.expiresOn) <= 30 && (
                                  <Badge tone="primary">
                                    {daysUntil(row.expiresOn) < 0
                                      ? d.talExpiredChip
                                      : formatMessage(d.talDaysLeft, {
                                          days: String(daysUntil(row.expiresOn)),
                                        })}
                                  </Badge>
                                )}
                              </span>
                            ),
                        },
                        {
                          id: "actions",
                          header: activeLocaleHeader(d.talEditBtn),
                    accessor: () => "",
                          render: (row) => (
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setDocEditTarget(row);
                                  setXNumber(row.number ?? "");
                                  setXIssued(row.issuedOn ?? "");
                                  setXExpires(row.expiresOn ?? "");
                                }}
                              >
                                {d.talEditBtn}
                              </Button>
                              <Button variant="secondary" onClick={() => setDeleteTarget(row)}>
                                {d.talDeleteBtn}
                              </Button>
                            </div>
                          ),
                        },
                      ]}
                      rows={[...visibleDocuments]}
                      rowKey={(row) => row.id}
                      sort={docSort}
                      onSortChange={setDocSort}
                      loading={docBusy}
                      empty={{ title: d.talEmptyRows }}
                    />
                  </div>
                </Card>
              </>
            )}
          </div>
      </Tabs>

      <Dialog open={docCreateOpen} onOpenChange={setDocCreateOpen} title={d.talDocNew}>
        <div className="flex flex-col gap-3">
          <Select
            id="tal-doc-employee"
            label={d.talSelectEmployee}
            value={oEmployee}
            onValueChange={setOEmployee}
            options={employees.map((employee) => ({
              value: employee.id,
              label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
            }))}
            required
          />
          <Select
            id="tal-doc-kind"
            label={d.talDocKind}
            value={oKind}
            onValueChange={(value) => {
              if ((DOC_KINDS as readonly string[]).includes(value)) {
                setOKind(value as DocKind);
              }
            }}
            options={DOC_KINDS.map((kind) => ({
              value: kind,
              label: localizedTalentDocumentKind(d, kind),
            }))}
            required
          />
          <Input
            id="tal-doc-number"
            label={d.talDocNumber}
            value={oNumber}
            onValueChange={setONumber}
            mono
            bidiIsolate
          />
          <DatePicker id="tal-doc-issued" locale={locale} label={d.talIssuedOn} value={oIssued} onSelect={setOIssued} />
          <DatePicker id="tal-doc-expires" locale={locale} label={d.talExpiresOn} value={oExpires} onSelect={setOExpires} />
          <Textarea id="tal-doc-notes" label={d.talLabelNotes} value={oNotes} onValueChange={setONotes} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void createDocument()} loading={busy === "doc-create"}>
              {d.talSaveBtn}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={docEditTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDocEditTarget(null);
        }}
        title={docEditTarget === null ? d.talEditBtn : `${d.talEditBtn} — ${employeeLabel(docEditTarget.employeeId)}`}
      >
        <div className="flex flex-col gap-3">
          <Input
            id="tal-doc-edit-number"
            label={d.talDocNumber}
            value={xNumber}
            onValueChange={setXNumber}
            mono
            bidiIsolate
          />
          <DatePicker id="tal-doc-edit-issued" locale={locale} label={d.talIssuedOn} value={xIssued} onSelect={setXIssued} />
          <DatePicker id="tal-doc-edit-expires" locale={locale} label={d.talExpiresOn} value={xExpires} onSelect={setXExpires} />
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void patchDocument()} loading={busy === "doc-patch"}>
              {d.talSaveBtn}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget === null ? d.talDeleteBtn : d.talConfirmDelete}
      >
        <div className="flex flex-col gap-3">
          <ErrorNotice>{d.talConfirmDelete}</ErrorNotice>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              {d.talCancelBtn}
            </Button>
            <Button variant="danger" onClick={() => void deleteDocument()} loading={busy === "doc-delete"}>
              {d.talDeleteBtn}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
