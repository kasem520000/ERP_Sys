"use client";

/**
 * PHASE-047 (W-5, T-13) — the training & certifications board
 * (PAGE_ARCHETYPES §2 + §8, the hr-leave-board pattern): THREE TABS —
 * the program catalog (create + retire/reactivate; the cost field is
 * money — ADR-0009's exact-decimal law), the enrollments register
 * (create + the status ladder patch: the COMPLETED edge stamps
 * completed_at with the result in the same write and never re-stamps;
 * WITHDRAWN is the soft terminal), and the certification register
 * (create + the renewal patch — the issuer and expiry feed the sweep
 * intact). Expiry chips badge the certifications against today. Typed
 * refusals render through the localized talent mirror.
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
  MoneyInput,
  Select,
  Tabs,
  Textarea,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  CertificationRow,
  EmployeeListRow,
  TrainingEnrollmentRow,
  TrainingProgramRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedName,
  localizedTalentEnrollmentStatus,
  localizedTalentError,
  localizedTalentProgramKind,
  localizedTalentProgramStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const MONEY_SHAPE = /^\d+(\.\d{1,4})?$/;

type TrainTab = "programs" | "enrollments" | "certifications";
type EnrollmentStatus = "ENROLLED" | "IN_PROGRESS" | "COMPLETED" | "WITHDRAWN";
type EnrollmentResult = "PENDING" | "PASSED" | "FAILED";

/** The days from today to an ISO date (negative = already expired). */
/** The whole days between today and an ISO date (negative = expired) —
 * both anchors are midnight-UTC so the division is EXACT (never a
 * rounded float; the money rule's spirit, applied to day counts). */
function daysUntil(date: string): number {
  return (
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) /
    86_400_000
  );
}

function programLabel(program: TrainingProgramRow, locale: Locale): string {
  return locale === "ar" && program.nameAr !== null ? program.nameAr : program.name;
}

export function HrTrainingBoard({
  locale,
  initialPrograms,
  initialEnrollments,
  initialCertifications,
  employees,
  currency,
}: {
  locale: Locale;
  initialPrograms: readonly TrainingProgramRow[];
  initialEnrollments: readonly TrainingEnrollmentRow[];
  initialCertifications: readonly CertificationRow[];
  employees: readonly EmployeeListRow[];
  currency: string;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const tabItems = useMemo(
    () => [
      { value: "programs" as const, label: d.talTabPrograms },
      { value: "enrollments" as const, label: d.talTabEnrollments },
      { value: "certifications" as const, label: d.talTabCertifications },
    ],
    [d],
  );
  const [tab, setTab] = useState<TrainTab>("programs");

  const employeeLabel = useCallback(
    (id: string): string => {
      const found = employees.find((employee) => employee.id === id);
      return found === undefined
        ? "—"
        : `${found.code} · ${localizedName(found.name, found.nameAr, locale)}`;
    },
    [employees, locale],
  );

  // ── programs ─────────────────────────────────────────────────────────────
  const [programs, setPrograms] = useState<readonly TrainingProgramRow[]>(initialPrograms);

  const programLabelFor = useCallback(
    (id: string): string => {
      const found = programs.find((program) => program.id === id);
      return found === undefined ? "—" : `${found.code} · ${programLabel(found, locale)}`;
    },
    [programs, locale],
  );

  const [progCreateOpen, setProgCreateOpen] = useState(false);
  const [pCode, setPCode] = useState("");
  const [pName, setPName] = useState("");
  const [pNameAr, setPNameAr] = useState("");
  const [pKind, setPKind] = useState<"INTERNAL" | "EXTERNAL">("INTERNAL");
  const [pProvider, setPProvider] = useState("");
  const [pCost, setPCost] = useState("");
  const [pNotes, setPNotes] = useState("");
  const [progSort, setProgSort] = useState<DataTableSort[]>([]);

  async function createProgram(): Promise<void> {
    setError(null);
    if (pCode.trim() === "" || pName.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    if (pCost !== "" && !MONEY_SHAPE.test(pCost)) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("prog-create");
    const result = await bffFetch<TrainingProgramRow>("hr/training/programs", {
      method: "POST",
      body: {
        code: pCode.trim(),
        name: pName.trim(),
        nameAr: pNameAr.trim() === "" ? null : pNameAr.trim(),
        kind: pKind,
        provider: pProvider.trim() === "" ? null : pProvider.trim(),
        cost: pCost === "" ? null : pCost,
        notes: pNotes.trim() === "" ? null : pNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPrograms([result.data, ...programs]);
    setProgCreateOpen(false);
    setPCode(""); setPName(""); setPNameAr(""); setPKind("INTERNAL"); setPProvider(""); setPCost(""); setPNotes("");
    toast({ tone: "success", title: d.talProgramCreatedToast });
  }

  async function patchProgram(
    program: TrainingProgramRow,
    patch: { status?: "ACTIVE" | "RETIRED" },
  ): Promise<void> {
    setError(null);
    setBusy(`prog-${program.id}`);
    const result = await bffFetch<TrainingProgramRow>(`hr/training/programs/${program.id}`, {
      method: "PATCH",
      body: patch,
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPrograms(programs.map((row) => (row.id === result.data.id ? result.data : row)));
    toast({ tone: "success", title: d.talProgramSavedToast });
  }

  // ── enrollments ──────────────────────────────────────────────────────────
  const [enrollments, setEnrollments] = useState<readonly TrainingEnrollmentRow[]>(initialEnrollments);
  const [eFilterProgram, setEFilterProgram] = useState("");
  const [eFilterEmployee, setEFilterEmployee] = useState("");
  const [eBusy, setEBusy] = useState(false);
  const [eError, setEError] = useState<string | null>(null);
  const [eSort, setESort] = useState<DataTableSort[]>([]);
  const [enrollCreateOpen, setEnrollCreateOpen] = useState(false);
  const [nProgram, setNProgram] = useState("");
  const [nEmployee, setNEmployee] = useState("");
  const [nNotes, setNNotes] = useState("");
  const [patchTarget, setPatchTarget] = useState<TrainingEnrollmentRow | null>(null);
  const [uStatus, setUStatus] = useState<EnrollmentStatus | "">("");
  const [uAttendance, setUAttendance] = useState("");
  const [uCompletion, setUCompletion] = useState("");
  const [uResult, setUResult] = useState<EnrollmentResult | "">("");

  async function loadEnrollments(): Promise<void> {
    setEBusy(true); setEError(null);
    const search = new URLSearchParams({ limit: "200" });
    if (eFilterProgram !== "") {
      search.set("programId", eFilterProgram);
    }
    if (eFilterEmployee !== "") {
      search.set("employeeId", eFilterEmployee);
    }
    const result = await bffFetch<readonly TrainingEnrollmentRow[]>(`hr/training/enrollments?${search.toString()}`);
    setEBusy(false);
    if (!result.ok) {
      setEError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEnrollments(result.data);
  }

  async function createEnrollment(): Promise<void> {
    setEError(null);
    if (nProgram === "" || nEmployee === "") {
      setEError(d.budgetFormInvalid);
      return;
    }
    setBusy("enroll-create");
    const result = await bffFetch<TrainingEnrollmentRow>("hr/training/enrollments", {
      method: "POST",
      body: {
        programId: nProgram,
        employeeId: nEmployee,
        notes: nNotes.trim() === "" ? null : nNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setEError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEnrollments([result.data, ...enrollments]);
    setEnrollCreateOpen(false);
    setNProgram(""); setNEmployee(""); setNNotes("");
    toast({ tone: "success", title: d.talEnrolledToast });
  }

  async function patchEnrollment(): Promise<void> {
    if (patchTarget === null) {
      return;
    }
    setEError(null);
    if (uAttendance !== "" && !PCT_RE.test(uAttendance)) {
      setEError(d.budgetFormInvalid);
      return;
    }
    if (uCompletion !== "" && !PCT_RE.test(uCompletion)) {
      setEError(d.budgetFormInvalid);
      return;
    }
    setBusy("enroll-patch");
    const result = await bffFetch<TrainingEnrollmentRow>(`hr/training/enrollments/${patchTarget.id}`, {
      method: "PATCH",
      body: {
        ...(uStatus === "" ? {} : { status: uStatus }),
        attendancePct: uAttendance === "" ? null : uAttendance,
        completionPct: uCompletion === "" ? null : uCompletion,
        result: uResult === "" ? null : uResult,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setEError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEnrollments(enrollments.map((row) => (row.id === result.data.id ? result.data : row)));
    setPatchTarget(null);
    setUStatus(""); setUAttendance(""); setUCompletion(""); setUResult("");
    toast({ tone: "success", title: d.talEnrollSavedToast });
  }

  // ── certifications ───────────────────────────────────────────────────────
  const [certifications, setCertifications] = useState<readonly CertificationRow[]>(initialCertifications);
  const [cFilterEmployee, setCFilterEmployee] = useState("");
  const [cBusy, setCBusy] = useState(false);
  const [cError, setCError] = useState<string | null>(null);
  const [cSort, setCSort] = useState<DataTableSort[]>([]);
  const [certCreateOpen, setCertCreateOpen] = useState(false);
  const [tEmployee, setTEmployee] = useState("");
  const [tName, setTName] = useState("");
  const [tNameAr, setTNameAr] = useState("");
  const [tIssuer, setTIssuer] = useState("");
  const [tIssueDate, setTIssueDate] = useState("");
  const [tExpiry, setTExpiry] = useState("");
  const [tNumber, setTNumber] = useState("");
  const [tNotes, setTNotes] = useState("");
  const [renewTarget, setRenewTarget] = useState<CertificationRow | null>(null);
  const [rIssuer, setRIssuer] = useState("");
  const [rIssueDate, setRIssueDate] = useState("");
  const [rExpiry, setRExpiry] = useState("");
  const [rNumber, setRNumber] = useState("");

  async function loadCertifications(): Promise<void> {
    setCBusy(true); setCError(null);
    const search = new URLSearchParams({ limit: "500" });
    if (cFilterEmployee !== "") {
      search.set("employeeId", cFilterEmployee);
    }
    const result = await bffFetch<readonly CertificationRow[]>(`hr/training/certifications?${search.toString()}`);
    setCBusy(false);
    if (!result.ok) {
      setCError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCertifications(result.data);
  }

  async function createCertification(): Promise<void> {
    setCError(null);
    if (tEmployee === "" || tName.trim() === "" || tIssuer.trim() === "" || !DATE_RE.test(tIssueDate)) {
      setCError(d.budgetFormInvalid);
      return;
    }
    if (tExpiry !== "" && !DATE_RE.test(tExpiry)) {
      setCError(d.budgetFormInvalid);
      return;
    }
    setBusy("cert-create");
    const result = await bffFetch<CertificationRow>("hr/training/certifications", {
      method: "POST",
      body: {
        employeeId: tEmployee,
        name: tName.trim(),
        nameAr: tNameAr.trim() === "" ? null : tNameAr.trim(),
        issuer: tIssuer.trim(),
        issueDate: tIssueDate,
        expiryDate: tExpiry === "" ? null : tExpiry,
        certificateNumber: tNumber.trim() === "" ? null : tNumber.trim(),
        notes: tNotes.trim() === "" ? null : tNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setCError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCertifications([result.data, ...certifications]);
    setCertCreateOpen(false);
    setTEmployee(""); setTName(""); setTNameAr(""); setTIssuer(""); setTIssueDate(""); setTExpiry(""); setTNumber(""); setTNotes("");
    toast({ tone: "success", title: d.talCertCreatedToast });
  }

  async function renewCertification(): Promise<void> {
    if (renewTarget === null) {
      return;
    }
    setCError(null);
    if (rIssuer.trim() === "" || !DATE_RE.test(rIssueDate)) {
      setCError(d.budgetFormInvalid);
      return;
    }
    if (rExpiry !== "" && !DATE_RE.test(rExpiry)) {
      setCError(d.budgetFormInvalid);
      return;
    }
    setBusy("cert-renew");
    const result = await bffFetch<CertificationRow>(`hr/training/certifications/${renewTarget.id}`, {
      method: "PATCH",
      body: {
        issuer: rIssuer.trim(),
        issueDate: rIssueDate,
        expiryDate: rExpiry === "" ? null : rExpiry,
        ...(rNumber.trim() === "" ? {} : { certificateNumber: rNumber.trim() }),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setCError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCertifications(certifications.map((row) => (row.id === result.data.id ? result.data : row)));
    setRenewTarget(null);
    setRIssuer(""); setRIssueDate(""); setRExpiry(""); setRNumber("");
    toast({ tone: "success", title: d.talCertSavedToast });
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs items={tabItems} value={tab} onValueChange={(value) => setTab(value as TrainTab)}>
        <div data-slot="programs" className="flex flex-col gap-4">
            <Card
              title={d.talProgramsCard}
              actions={
                <Button variant="primary" onClick={() => setProgCreateOpen(true)}>
                  {d.talProgramNew}
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
                    id: "name",
                    header: activeLocaleHeader(d.talLabelName),
                    accessor: (row) => programLabel(row, locale),
                  },
                  {
                    id: "kind",
                    header: activeLocaleHeader(d.talProgramKind),
                    accessor: (row) => localizedTalentProgramKind(d, row.kind),
                  },
                  {
                    id: "provider",
                    header: activeLocaleHeader(d.talProvider),
                    accessor: (row) => row.provider ?? "—",
                  },
                  {
                    id: "cost",
                    header: activeLocaleHeader(d.talCost),
                    accessor: (row) => row.cost ?? "—",
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm tabular-nums" dir="ltr">
                        {row.cost ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.talLabelStatus),
                    accessor: (row) => localizedTalentProgramStatus(d, row.status),
                    render: (row) => (
                      <Badge tone={row.status === "ACTIVE" ? "primary" : "neutral"}>
                        {localizedTalentProgramStatus(d, row.status)}
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
                        onClick={() =>
                          void patchProgram(row, { status: row.status === "ACTIVE" ? "RETIRED" : "ACTIVE" })
                        }
                        loading={busy === `prog-${row.id}`}
                      >
                        {row.status === "ACTIVE" ? d.talRetire : d.talReactivate}
                      </Button>
                    ),
                  },
                ]}
                rows={[...programs]}
                rowKey={(row) => row.id}
                sort={progSort}
                onSortChange={setProgSort}
                empty={{ title: d.talEmptyRows }}
              />
            </Card>

            <Dialog open={progCreateOpen} onOpenChange={setProgCreateOpen} title={d.talProgramNew}>
              <div className="flex flex-col gap-3">
                <Input id="tal-prog-code" label={d.hrColCode} value={pCode} onValueChange={setPCode} required />
                <Input id="tal-prog-name" label={d.talLabelName} value={pName} onValueChange={setPName} required />
                <Input id="tal-prog-name-ar" label={d.talLabelNameAr} value={pNameAr} onValueChange={setPNameAr} />
                <Select
                  id="tal-prog-kind"
                  label={d.talProgramKind}
                  value={pKind}
                  onValueChange={(value) => {
                    if (value === "INTERNAL" || value === "EXTERNAL") {
                      setPKind(value);
                    }
                  }}
                  options={[
                    { value: "INTERNAL", label: d.talProgramInternal },
                    { value: "EXTERNAL", label: d.talProgramExternal },
                  ]}
                  required
                />
                <Input id="tal-prog-provider" label={d.talProvider} value={pProvider} onValueChange={setPProvider} />
                <MoneyInput
                  id="tal-prog-cost"
                  label={d.talCost}
                  amount={pCost}
                  onAmountChange={setPCost}
                  currency={currency}
                />
                <Textarea id="tal-prog-notes" label={d.talLabelNotes} value={pNotes} onValueChange={setPNotes} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createProgram()} loading={busy === "prog-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="enrollments" className="flex flex-col gap-4">
            <Card
              title={d.talEnrollmentsCard}
              actions={
                <Button variant="primary" onClick={() => setEnrollCreateOpen(true)}>
                  {d.talEnrollNew}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.talEnrollStatusHint}</InfoNotice>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <Select
                      id="tal-enr-filter-program"
                      label={d.talProgram}
                      value={eFilterProgram}
                      onValueChange={setEFilterProgram}
                      options={[
                        { value: "", label: d.talFilterAll },
                        ...programs.map((program) => ({
                          value: program.id,
                          label: `${program.code} · ${programLabel(program, locale)}`,
                        })),
                      ]}
                    />
                  </div>
                  <div className="w-64">
                    <Select
                      id="tal-enr-filter-employee"
                      label={d.hrColEmployee}
                      value={eFilterEmployee}
                      onValueChange={setEFilterEmployee}
                      options={[
                        { value: "", label: d.talFilterAll },
                        ...employees.map((employee) => ({
                          value: employee.id,
                          label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                        })),
                      ]}
                    />
                  </div>
                  <Button onClick={() => void loadEnrollments()} disabled={eBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {eError !== null && <ErrorNotice>{eError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "program",
                      header: activeLocaleHeader(d.talProgram),
                      accessor: (row) => programLabelFor(row.programId),
                    },
                    {
                      id: "employee",
                      header: activeLocaleHeader(d.hrColEmployee),
                      accessor: (row) => employeeLabel(row.employeeId),
                    },
                    {
                      id: "status",
                      header: activeLocaleHeader(d.talLabelStatus),
                      accessor: (row) => localizedTalentEnrollmentStatus(d, row.status),
                      render: (row) => (
                        <Badge tone={row.status === "COMPLETED" ? "primary" : "neutral"}>
                          {localizedTalentEnrollmentStatus(d, row.status)}
                        </Badge>
                      ),
                    },
                    {
                      id: "attendance",
                      header: activeLocaleHeader(d.talAttendancePct),
                      accessor: (row) => row.attendancePct ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm tabular-nums" dir="ltr">
                          {row.attendancePct ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "completion",
                      header: activeLocaleHeader(d.talCompletionPct),
                      accessor: (row) => row.completionPct ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm tabular-nums" dir="ltr">
                          {row.completionPct ?? "—"}
                        </span>
                      ),
                    },
                    {
                      id: "result",
                      header: activeLocaleHeader(d.talResult),
                      accessor: (row) => row.result ?? "—",
                    },
                    {
                      id: "completedAt",
                      header: activeLocaleHeader(d.talCompletedAt),
                      accessor: (row) => row.completedAt ?? "—",
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.completedAt ?? "—"}
                        </span>
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
                            setPatchTarget(row);
                            setUStatus("");
                            setUAttendance(row.attendancePct ?? "");
                            setUCompletion(row.completionPct ?? "");
                            setUResult("");
                          }}
                        >
                          {d.talEditBtn}
                        </Button>
                      ),
                    },
                  ]}
                  rows={[...enrollments]}
                  rowKey={(row) => row.id}
                  sort={eSort}
                  onSortChange={setESort}
                  loading={eBusy}
                  empty={{ title: d.talEmptyRows }}
                />
              </div>
            </Card>

            <Dialog open={enrollCreateOpen} onOpenChange={setEnrollCreateOpen} title={d.talEnrollNew}>
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-enr-program"
                  label={d.talSelectProgram}
                  value={nProgram}
                  onValueChange={setNProgram}
                  options={programs
                    .filter((program) => program.status === "ACTIVE")
                    .map((program) => ({
                      value: program.id,
                      label: `${program.code} · ${programLabel(program, locale)}`,
                    }))}
                  required
                />
                <Select
                  id="tal-enr-employee"
                  label={d.talSelectEmployee}
                  value={nEmployee}
                  onValueChange={setNEmployee}
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                  }))}
                  required
                />
                <Textarea id="tal-enr-notes" label={d.talLabelNotes} value={nNotes} onValueChange={setNNotes} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createEnrollment()} loading={busy === "enroll-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={patchTarget !== null}
              onOpenChange={(open) => {
                if (!open) setPatchTarget(null);
              }}
              title={patchTarget === null ? d.talEditBtn : `${d.talEditBtn} — ${programLabelFor(patchTarget.programId)}`}
            >
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-enr-status"
                  label={d.talLabelStatus}
                  value={uStatus}
                  onValueChange={(value) => {
                    if (
                      value === "" ||
                      value === "ENROLLED" ||
                      value === "IN_PROGRESS" ||
                      value === "COMPLETED" ||
                      value === "WITHDRAWN"
                    ) {
                      setUStatus(value);
                    }
                  }}
                  options={[
                    { value: "", label: "—" },
                    { value: "ENROLLED", label: d.talEnrollEnrolled },
                    { value: "IN_PROGRESS", label: d.talEnrollInProgress },
                    { value: "COMPLETED", label: d.talEnrollCompleted },
                    { value: "WITHDRAWN", label: d.talEnrollWithdrawn },
                  ]}
                />
                <Input
                  id="tal-enr-attendance"
                  label={d.talAttendancePct}
                  value={uAttendance}
                  onValueChange={setUAttendance}
                  hint={d.talPctFormat}
                  mono
                  bidiIsolate
                />
                <Input
                  id="tal-enr-completion"
                  label={d.talCompletionPct}
                  value={uCompletion}
                  onValueChange={setUCompletion}
                  hint={d.talPctFormat}
                  mono
                  bidiIsolate
                />
                <Select
                  id="tal-enr-result"
                  label={d.talResult}
                  value={uResult}
                  onValueChange={(value) => {
                    if (value === "" || value === "PENDING" || value === "PASSED" || value === "FAILED") {
                      setUResult(value);
                    }
                  }}
                  options={[
                    { value: "", label: "—" },
                    { value: "PENDING", label: d.talResultPending },
                    { value: "PASSED", label: d.talResultPassed },
                    { value: "FAILED", label: d.talResultFailed },
                  ]}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void patchEnrollment()} loading={busy === "enroll-patch"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="certifications" className="flex flex-col gap-4">
            <Card
              title={d.talCertificationsCard}
              actions={
                <Button variant="primary" onClick={() => setCertCreateOpen(true)}>
                  {d.talCertNew}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <Select
                      id="tal-cert-filter-employee"
                      label={d.hrColEmployee}
                      value={cFilterEmployee}
                      onValueChange={setCFilterEmployee}
                      options={[
                        { value: "", label: d.talFilterAll },
                        ...employees.map((employee) => ({
                          value: employee.id,
                          label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                        })),
                      ]}
                    />
                  </div>
                  <Button onClick={() => void loadCertifications()} disabled={cBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {cError !== null && <ErrorNotice>{cError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "employee",
                      header: activeLocaleHeader(d.hrColEmployee),
                      accessor: (row) => employeeLabel(row.employeeId),
                    },
                    {
                      id: "name",
                      header: activeLocaleHeader(d.talLabelName),
                      accessor: (row) => localizedName(row.name, row.nameAr, locale),
                    },
                    {
                      id: "issuer",
                      header: activeLocaleHeader(d.talIssuer),
                      accessor: (row) => row.issuer,
                    },
                    {
                      id: "issueDate",
                      header: activeLocaleHeader(d.talIssueDate),
                      accessor: (row) => row.issueDate,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-sm" dir="ltr">
                          {row.issueDate}
                        </span>
                      ),
                    },
                    {
                      id: "expiry",
                      header: activeLocaleHeader(d.talExpiryDate),
                      accessor: (row) => row.expiryDate ?? "—",
                      mono: true,
                      render: (row) =>
                        row.expiryDate === null ? (
                          <span className="font-mono text-sm" dir="ltr">
                            {d.talNoExpiry}
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-sm" dir="ltr">
                              {row.expiryDate}
                            </span>
                            {daysUntil(row.expiryDate) <= 30 && (
                              <Badge tone="primary">
                                {daysUntil(row.expiryDate) < 0
                                  ? d.talExpiredChip
                                  : formatMessage(d.talDaysLeft, { days: String(daysUntil(row.expiryDate)) })}
                              </Badge>
                            )}
                          </span>
                        ),
                    },
                    {
                      id: "number",
                      header: activeLocaleHeader(d.talCertificateNumber),
                      accessor: (row) => row.certificateNumber ?? "—",
                      mono: true,
                    },
                    {
                      id: "actions",
                      header: activeLocaleHeader(d.talEditBtn),
                    accessor: () => "",
                      render: (row) => (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setRenewTarget(row);
                            setRIssuer(row.issuer);
                            setRIssueDate(row.issueDate);
                            setRExpiry(row.expiryDate ?? "");
                            setRNumber(row.certificateNumber ?? "");
                          }}
                        >
                          {d.talEditBtn}
                        </Button>
                      ),
                    },
                  ]}
                  rows={[...certifications]}
                  rowKey={(row) => row.id}
                  sort={cSort}
                  onSortChange={setCSort}
                  loading={cBusy}
                  empty={{ title: d.talEmptyRows }}
                />
              </div>
            </Card>

            <Dialog open={certCreateOpen} onOpenChange={setCertCreateOpen} title={d.talCertNew}>
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-cert-employee"
                  label={d.talSelectEmployee}
                  value={tEmployee}
                  onValueChange={setTEmployee}
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                  }))}
                  required
                />
                <Input id="tal-cert-name" label={d.talLabelName} value={tName} onValueChange={setTName} required />
                <Input id="tal-cert-name-ar" label={d.talLabelNameAr} value={tNameAr} onValueChange={setTNameAr} />
                <Input id="tal-cert-issuer" label={d.talIssuer} value={tIssuer} onValueChange={setTIssuer} required />
                <DatePicker
                  id="tal-cert-issue"
                  locale={locale}
                  label={d.talIssueDate}
                  value={tIssueDate}
                  onSelect={setTIssueDate}
                />
                <DatePicker
                  id="tal-cert-expiry"
                  locale={locale}
                  label={d.talExpiryDate}
                  value={tExpiry}
                  onSelect={setTExpiry}
                />
                <Input
                  id="tal-cert-number"
                  label={d.talCertificateNumber}
                  value={tNumber}
                  onValueChange={setTNumber}
                  mono
                  bidiIsolate
                />
                <Textarea id="tal-cert-notes" label={d.talLabelNotes} value={tNotes} onValueChange={setTNotes} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createCertification()} loading={busy === "cert-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={renewTarget !== null}
              onOpenChange={(open) => {
                if (!open) setRenewTarget(null);
              }}
              title={renewTarget === null ? d.talEditBtn : `${d.talEditBtn} — ${renewTarget.name}`}
            >
              <div className="flex flex-col gap-3">
                <Input id="tal-renew-issuer" label={d.talIssuer} value={rIssuer} onValueChange={setRIssuer} required />
                <DatePicker
                  id="tal-renew-issue"
                  locale={locale}
                  label={d.talIssueDate}
                  value={rIssueDate}
                  onSelect={setRIssueDate}
                />
                <DatePicker
                  id="tal-renew-expiry"
                  locale={locale}
                  label={d.talExpiryDate}
                  value={rExpiry}
                  onSelect={setRExpiry}
                />
                <Input
                  id="tal-renew-number"
                  label={d.talCertificateNumber}
                  value={rNumber}
                  onValueChange={setRNumber}
                  mono
                  bidiIsolate
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void renewCertification()} loading={busy === "cert-renew"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>
      </Tabs>
    </div>
  );
}
