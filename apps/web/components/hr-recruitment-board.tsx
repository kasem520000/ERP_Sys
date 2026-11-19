"use client";

/**
 * PHASE-047 (W-5, T-12) — the recruitment board (PAGE_ARCHETYPES §2 + §8,
 * the hr-leave-board pattern): THREE TABS — the vacancy register (create
 * + the OPEN↔ON_HOLD / →FILLED/CANCELLED lifecycle acts), the applicant
 * pipeline (the BR-088 monotonic ladder: forward-only stage moves, the
 * recorded REOPEN (REJECTED → SCREEN), and the hire act that links the
 * 045 employee master — the link is written once), and the panel
 * interviews (scheduling one row per panelist per round + the OWN-slot
 * scorecard: the verdict + the competency ratings; the panelist is the
 * session's linked employee, never a form field). Typed refusals render
 * through the localized talent mirror.
 */
import { useCallback, useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  Tabs,
  Textarea,
  useToast,
  type DataTableSort,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApplicantRow,
  CompetencyRow,
  EmployeeListRow,
  InterviewRow,
  PositionRow,
  VacancyRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedTalentApplicantStage,
  localizedTalentError,
  localizedTalentInterviewMode,
  localizedTalentVacancyStatus,
  localizedTalentVerdict,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const FORWARD_STAGES = ["SCREEN", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
const STAGES = ["NEW", "SCREEN", "INTERVIEW", "OFFER", "HIRED", "REJECTED"] as const;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

type RecTab = "vacancies" | "applicants" | "interviews";

function vacancyLabel(vacancy: VacancyRow, locale: Locale): string {
  return locale === "ar" && vacancy.titleAr !== null ? vacancy.titleAr : vacancy.title;
}

function applicantLabel(applicant: ApplicantRow, locale: Locale): string {
  return locale === "ar" && applicant.fullNameAr !== null ? applicant.fullNameAr : applicant.fullName;
}

export function HrRecruitmentBoard({
  locale,
  initialVacancies,
  initialApplicants,
  initialInterviews,
  positions,
  employees,
  activeCompetencies,
}: {
  locale: Locale;
  initialVacancies: readonly VacancyRow[];
  initialApplicants: readonly ApplicantRow[];
  initialInterviews: readonly InterviewRow[];
  positions: readonly PositionRow[];
  employees: readonly EmployeeListRow[];
  activeCompetencies: readonly CompetencyRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const tabItems = useMemo(
    () => [
      { value: "vacancies" as const, label: d.talTabVacancies },
      { value: "applicants" as const, label: d.talTabApplicants },
      { value: "interviews" as const, label: d.talTabInterviews },
    ],
    [d],
  );
  const [tab, setTab] = useState<RecTab>("vacancies");

  const employeeLabel = useCallback(
    (id: string): string => {
      const found = employees.find((employee) => employee.id === id);
      return found === undefined
        ? "—"
        : `${found.code} · ${localizedName(found.name, found.nameAr, locale)}`;
    },
    [employees, locale],
  );

  const positionLabel = useCallback(
    (id: string | null): string => {
      if (id === null) {
        return "—";
      }
      const found = positions.find((position) => position.id === id);
      return found === undefined ? "—" : `${found.code} · ${localizedName(found.title, found.titleAr, locale)}`;
    },
    [positions, locale],
  );

  // ── vacancies ────────────────────────────────────────────────────────────
  const [vacancies, setVacancies] = useState<readonly VacancyRow[]>(initialVacancies);
  const [vacCreateOpen, setVacCreateOpen] = useState(false);
  const [vCode, setVCode] = useState("");
  const [vPosition, setVPosition] = useState("");
  const [vTitle, setVTitle] = useState("");
  const [vTitleAr, setVTitleAr] = useState("");
  const [vHeadcount, setVHeadcount] = useState("1");
  const [vNotes, setVNotes] = useState("");
  const [vacSort, setVacSort] = useState<DataTableSort[]>([]);

  async function createVacancy(): Promise<void> {
    setError(null);
    const headcount = Number.parseInt(vHeadcount, 10);
    if (vCode.trim() === "" || vTitle.trim() === "" || !Number.isInteger(headcount) || headcount < 1) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("vac-create");
    const result = await bffFetch<VacancyRow>("hr/recruitment/vacancies", {
      method: "POST",
      body: {
        code: vCode.trim(),
        positionId: vPosition === "" ? null : vPosition,
        title: vTitle.trim(),
        titleAr: vTitleAr.trim() === "" ? null : vTitleAr.trim(),
        headcount,
        notes: vNotes.trim() === "" ? null : vNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setVacancies([result.data, ...vacancies]);
    setVacCreateOpen(false);
    setVCode(""); setVPosition(""); setVTitle(""); setVTitleAr(""); setVHeadcount("1"); setVNotes("");
    toast({ tone: "success", title: d.talVacancyCreatedToast });
  }

  async function transitionVacancy(
    vacancy: VacancyRow,
    action: "hold" | "resume" | "fill" | "cancel",
  ): Promise<void> {
    setError(null);
    setBusy(`vac-${vacancy.id}`);
    const result = await bffFetch<VacancyRow>(`hr/recruitment/vacancies/${vacancy.id}/transition`, {
      method: "POST",
      body: { action },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setVacancies(vacancies.map((row) => (row.id === result.data.id ? result.data : row)));
    toast({ tone: "success", title: d.talVacancyTransitionedToast });
  }

  // ── applicants ───────────────────────────────────────────────────────────
  const [applicants, setApplicants] = useState<readonly ApplicantRow[]>(initialApplicants);
  const [filterVacancy, setFilterVacancy] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [appBusy, setAppBusy] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [appSort, setAppSort] = useState<DataTableSort[]>([]);
  const [appCreateOpen, setAppCreateOpen] = useState(false);
  const [aVacancy, setAVacancy] = useState("");
  const [aName, setAName] = useState("");
  const [aNameAr, setANameAr] = useState("");
  const [aEmail, setAEmail] = useState("");
  const [aPhone, setAPhone] = useState("");
  const [aSource, setASource] = useState("");
  const [aNotes, setANotes] = useState("");
  const [stageTarget, setStageTarget] = useState<ApplicantRow | null>(null);
  const [stageTo, setStageTo] = useState("");
  const [hireTarget, setHireTarget] = useState<ApplicantRow | null>(null);
  const [hireEmployee, setHireEmployee] = useState("");

  async function loadApplicants(): Promise<void> {
    setAppBusy(true); setAppError(null);
    const search = new URLSearchParams();
    if (filterVacancy !== "") {
      search.set("vacancyId", filterVacancy);
    }
    if (filterStage !== "") {
      search.set("stage", filterStage);
    }
    search.set("limit", "200");
    const result = await bffFetch<readonly ApplicantRow[]>(`hr/recruitment/applicants?${search.toString()}`);
    setAppBusy(false);
    if (!result.ok) {
      setAppError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setApplicants(result.data);
  }

  async function createApplicant(): Promise<void> {
    setAppError(null);
    if (aVacancy === "" || aName.trim() === "") {
      setAppError(d.budgetFormInvalid);
      return;
    }
    setBusy("app-create");
    const result = await bffFetch<ApplicantRow>("hr/recruitment/applicants", {
      method: "POST",
      body: {
        vacancyId: aVacancy,
        fullName: aName.trim(),
        fullNameAr: aNameAr.trim() === "" ? null : aNameAr.trim(),
        email: aEmail.trim() === "" ? null : aEmail.trim(),
        phone: aPhone.trim() === "" ? null : aPhone.trim(),
        source: aSource.trim() === "" ? null : aSource.trim(),
        notes: aNotes.trim() === "" ? null : aNotes.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setAppError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setApplicants([result.data, ...applicants]);
    setAppCreateOpen(false);
    setAVacancy(""); setAName(""); setANameAr(""); setAEmail(""); setAPhone(""); setASource(""); setANotes("");
    toast({ tone: "success", title: d.talApplicantCreatedToast });
  }

  function applyApplicant(next: ApplicantRow): void {
    setApplicants(applicants.map((row) => (row.id === next.id ? next : row)));
  }

  async function advanceStage(): Promise<void> {
    if (stageTarget === null || stageTo === "") {
      return;
    }
    setAppError(null);
    setBusy("stage");
    const result = await bffFetch<ApplicantRow>(`hr/recruitment/applicants/${stageTarget.id}/stage`, {
      method: "POST",
      body: { to: stageTo },
    });
    setBusy(null);
    if (!result.ok) {
      setAppError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    applyApplicant(result.data);
    setStageTarget(null); setStageTo("");
    toast({ tone: "success", title: d.talStageAdvancedToast });
  }

  async function reopen(applicant: ApplicantRow): Promise<void> {
    setAppError(null);
    setBusy(`reopen-${applicant.id}`);
    const result = await bffFetch<ApplicantRow>(`hr/recruitment/applicants/${applicant.id}/reopen`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setAppError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    applyApplicant(result.data);
    toast({ tone: "success", title: d.talReopenedToast });
  }

  async function hire(): Promise<void> {
    if (hireTarget === null || hireEmployee === "") {
      return;
    }
    setAppError(null);
    setBusy("hire");
    const result = await bffFetch<ApplicantRow>(`hr/recruitment/applicants/${hireTarget.id}/hire`, {
      method: "POST",
      body: { employeeId: hireEmployee },
    });
    setBusy(null);
    if (!result.ok) {
      setAppError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    applyApplicant(result.data);
    setHireTarget(null); setHireEmployee("");
    toast({ tone: "success", title: d.talHiredToast });
  }

  // ── interviews ───────────────────────────────────────────────────────────
  const [interviews, setInterviews] = useState<readonly InterviewRow[]>(initialInterviews);
  const [intFilterApplicant, setIntFilterApplicant] = useState("");
  const [intBusy, setIntBusy] = useState(false);
  const [intError, setIntError] = useState<string | null>(null);
  const [intSort, setIntSort] = useState<DataTableSort[]>([]);
  const [intCreateOpen, setIntCreateOpen] = useState(false);
  const [iApplicant, setIApplicant] = useState("");
  const [iRound, setIRound] = useState("1");
  const [iPanelist, setIPanelist] = useState("");
  const [iStart, setIStart] = useState("");
  const [iEnd, setIEnd] = useState("");
  const [iMode, setIMode] = useState<"ONSITE" | "VIDEO" | "PHONE">("ONSITE");
  const [scoreTarget, setScoreTarget] = useState<InterviewRow | null>(null);
  const [sVerdict, setSVerdict] = useState("");
  const [sComments, setSComments] = useState("");
  const [sScores, setSScores] = useState<Record<string, number>>({});

  async function loadInterviews(): Promise<void> {
    setIntBusy(true); setIntError(null);
    const search = new URLSearchParams({ limit: "500" });
    if (intFilterApplicant !== "") {
      search.set("applicantId", intFilterApplicant);
    }
    const result = await bffFetch<readonly InterviewRow[]>(`hr/recruitment/interviews?${search.toString()}`);
    setIntBusy(false);
    if (!result.ok) {
      setIntError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setInterviews(result.data);
  }

  async function scheduleInterview(): Promise<void> {
    setIntError(null);
    const round = Number.parseInt(iRound, 10);
    if (
      iApplicant === "" ||
      iPanelist === "" ||
      !Number.isInteger(round) ||
      round < 1 ||
      !DATETIME_RE.test(iStart) ||
      !DATETIME_RE.test(iEnd)
    ) {
      setIntError(d.budgetFormInvalid);
      return;
    }
    setBusy("int-create");
    const result = await bffFetch<InterviewRow>("hr/recruitment/interviews", {
      method: "POST",
      body: {
        applicantId: iApplicant,
        round,
        panelistEmployeeId: iPanelist,
        scheduledStart: iStart,
        scheduledEnd: iEnd,
        mode: iMode,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setIntError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setInterviews([result.data, ...interviews]);
    setIntCreateOpen(false);
    setIApplicant(""); setIRound("1"); setIPanelist(""); setIStart(""); setIEnd(""); setIMode("ONSITE");
    toast({ tone: "success", title: d.talInterviewScheduledToast });
  }

  async function recordScorecard(): Promise<void> {
    if (scoreTarget === null) {
      return;
    }
    setIntError(null);
    setBusy("scorecard");
    const result = await bffFetch<InterviewRow>(`hr/recruitment/interviews/${scoreTarget.id}/scorecard`, {
      method: "PUT",
      body: {
        scorecard: sScores,
        verdict: sVerdict === "" ? null : sVerdict,
        comments: sComments.trim() === "" ? null : sComments.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setIntError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setInterviews(interviews.map((row) => (row.id === result.data.id ? result.data : row)));
    setScoreTarget(null); setSVerdict(""); setSComments(""); setSScores({});
    toast({ tone: "success", title: d.talScorecardSavedToast });
  }

  const applicantOptions = applicants.map((applicant) => ({
    value: applicant.id,
    label: applicantLabel(applicant, locale),
  }));

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs items={tabItems} value={tab} onValueChange={(value) => setTab(value as RecTab)}>
        <div data-slot="vacancies" className="flex flex-col gap-4">
            <Card
              title={d.talVacanciesCard}
              actions={
                <Button variant="primary" onClick={() => setVacCreateOpen(true)}>
                  {d.talVacancyNew}
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
                    accessor: (row) => vacancyLabel(row, locale),
                  },
                  {
                    id: "position",
                    header: activeLocaleHeader(d.talPosition),
                    accessor: (row) => positionLabel(row.positionId),
                  },
                  {
                    id: "headcount",
                    header: activeLocaleHeader(d.talHeadcount),
                    accessor: (row) => String(row.headcount),
                    numeric: true,
                    render: (row) => <span dir="ltr">{row.headcount}</span>,
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.talLabelStatus),
                    accessor: (row) => localizedTalentVacancyStatus(d, row.status),
                    render: (row) => (
                      <Badge tone={row.status === "OPEN" ? "primary" : "neutral"}>
                        {localizedTalentVacancyStatus(d, row.status)}
                      </Badge>
                    ),
                  },
                  {
                    id: "actions",
                    header: activeLocaleHeader(d.talEditBtn),
                    accessor: () => "",
                    render: (row) => (
                      <div className="flex flex-wrap gap-2">
                        {row.status === "OPEN" && (
                          <Button
                            variant="secondary"
                            onClick={() => void transitionVacancy(row, "hold")}
                            loading={busy === `vac-${row.id}`}
                          >
                            {d.talHold}
                          </Button>
                        )}
                        {row.status === "ON_HOLD" && (
                          <Button
                            variant="secondary"
                            onClick={() => void transitionVacancy(row, "resume")}
                            loading={busy === `vac-${row.id}`}
                          >
                            {d.talResume}
                          </Button>
                        )}
                        {(row.status === "OPEN" || row.status === "ON_HOLD") && (
                          <>
                            <Button
                              variant="secondary"
                              onClick={() => void transitionVacancy(row, "fill")}
                              loading={busy === `vac-${row.id}`}
                            >
                              {d.talFill}
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => void transitionVacancy(row, "cancel")}
                              loading={busy === `vac-${row.id}`}
                            >
                              {d.talCancelBtn}
                            </Button>
                          </>
                        )}
                      </div>
                    ),
                  },
                ]}
                rows={[...vacancies]}
                rowKey={(row) => row.id}
                sort={vacSort}
                onSortChange={setVacSort}
                empty={{ title: d.talEmptyRows }}
              />
            </Card>

            <Dialog open={vacCreateOpen} onOpenChange={setVacCreateOpen} title={d.talVacancyNew}>
              <div className="flex flex-col gap-3">
                <Input id="tal-vac-code" label={d.hrColCode} value={vCode} onValueChange={setVCode} required />
                <Input id="tal-vac-title" label={d.talLabelTitle} value={vTitle} onValueChange={setVTitle} required />
                <Input
                  id="tal-vac-title-ar"
                  label={d.talLabelTitleAr}
                  value={vTitleAr}
                  onValueChange={setVTitleAr}
                />
                <Select
                  id="tal-vac-position"
                  label={d.talSelectPosition}
                  value={vPosition}
                  onValueChange={setVPosition}
                  options={[
                    { value: "", label: "—" },
                    ...positions.map((position) => ({
                      value: position.id,
                      label: `${position.code} · ${localizedName(position.title, position.titleAr, locale)}`,
                    })),
                  ]}
                />
                <Input
                  id="tal-vac-headcount"
                  label={d.talHeadcount}
                  value={vHeadcount}
                  onValueChange={setVHeadcount}
                  mono
                  bidiIsolate
                  required
                />
                <Textarea id="tal-vac-notes" label={d.talLabelNotes} value={vNotes} onValueChange={setVNotes} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createVacancy()} loading={busy === "vac-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="applicants" className="flex flex-col gap-4">
            <Card
              title={d.talApplicantsCard}
              actions={
                <Button variant="primary" onClick={() => setAppCreateOpen(true)}>
                  {d.talApplicantNew}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <Select
                      id="tal-app-filter-vacancy"
                      label={d.talFilterVacancy}
                      value={filterVacancy}
                      onValueChange={setFilterVacancy}
                      options={[
                        { value: "", label: d.talFilterAll },
                        ...vacancies.map((vacancy) => ({
                          value: vacancy.id,
                          label: `${vacancy.code} · ${vacancyLabel(vacancy, locale)}`,
                        })),
                      ]}
                    />
                  </div>
                  <div className="w-44">
                    <Select
                      id="tal-app-filter-stage"
                      label={d.talFilterStage}
                      value={filterStage}
                      onValueChange={setFilterStage}
                      options={[
                        { value: "", label: d.talFilterAll },
                        ...STAGES.map((stage) => ({
                          value: stage,
                          label: localizedTalentApplicantStage(d, stage),
                        })),
                      ]}
                    />
                  </div>
                  <Button onClick={() => void loadApplicants()} disabled={appBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {appError !== null && <ErrorNotice>{appError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "name",
                      header: activeLocaleHeader(d.talFullName),
                      accessor: (row) => applicantLabel(row, locale),
                    },
                    {
                      id: "vacancy",
                      header: activeLocaleHeader(d.talFilterVacancy),
                      accessor: (row) =>
                        vacancyLabel(
                          vacancies.find((vacancy) => vacancy.id === row.vacancyId) ?? {
                            code: row.vacancyId,
                            title: row.vacancyId,
                            titleAr: null,
                          } as VacancyRow,
                          locale,
                        ),
                    },
                    {
                      id: "stage",
                      header: activeLocaleHeader(d.talStage),
                      accessor: (row) => localizedTalentApplicantStage(d, row.stage),
                      render: (row) => (
                        <Badge tone={row.stage === "HIRED" ? "primary" : "neutral"}>
                          {localizedTalentApplicantStage(d, row.stage)}
                        </Badge>
                      ),
                    },
                    {
                      id: "source",
                      header: activeLocaleHeader(d.talSource),
                      accessor: (row) => row.source ?? "—",
                    },
                    {
                      id: "hired",
                      header: activeLocaleHeader(d.talHiredLink),
                      accessor: (row) => (row.hiredEmployeeId === null ? "—" : employeeLabel(row.hiredEmployeeId)),
                      render: (row) =>
                        row.hiredEmployeeId === null ? (
                          "—"
                        ) : (
                          <Badge tone="primary">{employeeLabel(row.hiredEmployeeId)}</Badge>
                        ),
                    },
                    {
                      id: "actions",
                      header: activeLocaleHeader(d.talEditBtn),
                      accessor: () => "",
                      render: (row) => (
                        <div className="flex flex-wrap gap-2">
                          {row.stage !== "HIRED" && row.stage !== "REJECTED" && (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setStageTarget(row);
                                setStageTo("");
                              }}
                            >
                              {d.talAdvance}
                            </Button>
                          )}
                          {row.stage === "REJECTED" && (
                            <Button
                              variant="secondary"
                              onClick={() => void reopen(row)}
                              loading={busy === `reopen-${row.id}`}
                            >
                              {d.talReopen}
                            </Button>
                          )}
                          {row.stage === "OFFER" && (
                            <Button
                              variant="primary"
                              onClick={() => {
                                setHireTarget(row);
                                setHireEmployee("");
                              }}
                            >
                              {d.talHire}
                            </Button>
                          )}
                        </div>
                      ),
                    },
                  ]}
                  rows={[...applicants]}
                  rowKey={(row) => row.id}
                  sort={appSort}
                  onSortChange={setAppSort}
                  loading={appBusy}
                  empty={{ title: d.talEmptyRows }}
                />
              </div>
            </Card>

            <Dialog open={appCreateOpen} onOpenChange={setAppCreateOpen} title={d.talApplicantNew}>
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-app-vacancy"
                  label={d.talSelectVacancy}
                  value={aVacancy}
                  onValueChange={setAVacancy}
                  options={vacancies.map((vacancy) => ({
                    value: vacancy.id,
                    label: `${vacancy.code} · ${vacancyLabel(vacancy, locale)}`,
                  }))}
                  required
                />
                <Input id="tal-app-name" label={d.talFullName} value={aName} onValueChange={setAName} required />
                <Input id="tal-app-name-ar" label={d.talFullNameAr} value={aNameAr} onValueChange={setANameAr} />
                <Input id="tal-app-email" label={d.talEmail} value={aEmail} onValueChange={setAEmail} mono bidiIsolate />
                <Input id="tal-app-phone" label={d.talPhone} value={aPhone} onValueChange={setAPhone} mono bidiIsolate />
                <Input id="tal-app-source" label={d.talSource} value={aSource} onValueChange={setASource} />
                <Textarea id="tal-app-notes" label={d.talLabelNotes} value={aNotes} onValueChange={setANotes} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createApplicant()} loading={busy === "app-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={stageTarget !== null}
              onOpenChange={(open) => {
                if (!open) setStageTarget(null);
              }}
              title={stageTarget === null ? d.talAdvance : `${d.talAdvance} — ${applicantLabel(stageTarget, locale)}`}
            >
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-stage-to"
                  label={d.talStage}
                  value={stageTo}
                  onValueChange={setStageTo}
                  options={FORWARD_STAGES.map((stage) => ({
                    value: stage,
                    label: localizedTalentApplicantStage(d, stage),
                  }))}
                  required
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void advanceStage()} loading={busy === "stage"}>
                    {d.talAdvance}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={hireTarget !== null}
              onOpenChange={(open) => {
                if (!open) setHireTarget(null);
              }}
              title={hireTarget === null ? d.talHire : `${d.talHire} — ${applicantLabel(hireTarget, locale)}`}
            >
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.talHireNote}</InfoNotice>
                <Select
                  id="tal-hire-employee"
                  label={d.talHireEmployee}
                  value={hireEmployee}
                  onValueChange={setHireEmployee}
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                  }))}
                  required
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void hire()} loading={busy === "hire"}>
                    {d.talHire}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="interviews" className="flex flex-col gap-4">
            <Card
              title={d.talInterviewsCard}
              actions={
                <Button variant="primary" onClick={() => setIntCreateOpen(true)}>
                  {d.talInterviewNew}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-64">
                    <Select
                      id="tal-int-filter-applicant"
                      label={d.talApplicant}
                      value={intFilterApplicant}
                      onValueChange={setIntFilterApplicant}
                      options={[{ value: "", label: d.talFilterAll }, ...applicantOptions]}
                    />
                  </div>
                  <Button onClick={() => void loadInterviews()} disabled={intBusy}>
                    {d.hrApplyBtn}
                  </Button>
                </div>
                {intError !== null && <ErrorNotice>{intError}</ErrorNotice>}
                <DataTable
                  columns={[
                    {
                      id: "applicant",
                      header: activeLocaleHeader(d.talApplicant),
                      accessor: (row) =>
                        applicantLabel(
                          applicants.find((applicant) => applicant.id === row.applicantId) ?? {
                            fullName: row.applicantId,
                            fullNameAr: null,
                          } as ApplicantRow,
                          locale,
                        ),
                    },
                    {
                      id: "round",
                      header: activeLocaleHeader(d.talRound),
                      accessor: (row) => String(row.round),
                      numeric: true,
                      render: (row) => <span dir="ltr">{row.round}</span>,
                    },
                    {
                      id: "panelist",
                      header: activeLocaleHeader(d.talPanelist),
                      accessor: (row) => employeeLabel(row.panelistEmployeeId),
                    },
                    {
                      id: "window",
                      header: activeLocaleHeader(d.talScheduledStart),
                      accessor: (row) => `${row.scheduledStart} → ${row.scheduledEnd}`,
                      mono: true,
                      render: (row) => (
                        <span className="font-mono text-xs" dir="ltr">
                          {row.scheduledStart} → {row.scheduledEnd}
                        </span>
                      ),
                    },
                    {
                      id: "mode",
                      header: activeLocaleHeader(d.talMode),
                      accessor: (row) => localizedTalentInterviewMode(d, row.mode),
                    },
                    {
                      id: "verdict",
                      header: activeLocaleHeader(d.talVerdict),
                      accessor: (row) => (row.verdict === null ? "—" : localizedTalentVerdict(d, row.verdict)),
                      render: (row) =>
                        row.verdict === null ? (
                          "—"
                        ) : (
                          <Badge tone={row.verdict === "HIRE" || row.verdict === "STRONG_HIRE" ? "primary" : "neutral"}>
                            {localizedTalentVerdict(d, row.verdict)}
                          </Badge>
                        ),
                    },
                    {
                      id: "actions",
                      header: activeLocaleHeader(d.talScorecard),
                      accessor: () => "",
                      render: (row) => (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setScoreTarget(row);
                            setSVerdict(row.verdict ?? "");
                            setSComments(row.comments ?? "");
                            const scores: Record<string, number> = {};
                            for (const [key, value] of Object.entries(row.scorecard)) {
                              if (typeof value === "number") {
                                scores[key] = value;
                              }
                            }
                            setSScores(scores);
                          }}
                        >
                          {d.talRecordScorecard}
                        </Button>
                      ),
                    },
                  ]}
                  rows={[...interviews]}
                  rowKey={(row) => row.id}
                  sort={intSort}
                  onSortChange={setIntSort}
                  loading={intBusy}
                  empty={{ title: d.talEmptyRows }}
                />
              </div>
            </Card>

            <Dialog open={intCreateOpen} onOpenChange={setIntCreateOpen} title={d.talInterviewNew}>
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-int-applicant"
                  label={d.talSelectApplicant}
                  value={iApplicant}
                  onValueChange={setIApplicant}
                  options={applicantOptions}
                  required
                />
                <Input
                  id="tal-int-round"
                  label={d.talRound}
                  value={iRound}
                  onValueChange={setIRound}
                  mono
                  bidiIsolate
                  required
                />
                <Select
                  id="tal-int-panelist"
                  label={d.talPanelist}
                  value={iPanelist}
                  onValueChange={setIPanelist}
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                  }))}
                  required
                />
                <Input
                  id="tal-int-start"
                  label={d.talScheduledStart}
                  value={iStart}
                  onValueChange={setIStart}
                  hint={d.talDateTimeHint}
                  mono
                  bidiIsolate
                  required
                />
                <Input
                  id="tal-int-end"
                  label={d.talScheduledEnd}
                  value={iEnd}
                  onValueChange={setIEnd}
                  hint={d.talDateTimeHint}
                  mono
                  bidiIsolate
                  required
                />
                <Select
                  id="tal-int-mode"
                  label={d.talMode}
                  value={iMode}
                  onValueChange={(value) => {
                    if (value === "ONSITE" || value === "VIDEO" || value === "PHONE") {
                      setIMode(value);
                    }
                  }}
                  options={[
                    { value: "ONSITE", label: d.talInterviewOnsite },
                    { value: "VIDEO", label: d.talInterviewVideo },
                    { value: "PHONE", label: d.talInterviewPhone },
                  ]}
                  required
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void scheduleInterview()} loading={busy === "int-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={scoreTarget !== null}
              onOpenChange={(open) => {
                if (!open) setScoreTarget(null);
              }}
              title={scoreTarget === null ? d.talScorecard : d.talRecordScorecard}
            >
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.talScorecardHint}</InfoNotice>
                {activeCompetencies.length === 0 ? (
                  <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                ) : (
                  <div className="grid max-h-52 gap-2 overflow-y-auto rounded-md border border-subtle p-2 sm:grid-cols-2">
                    {activeCompetencies.map((competency) => (
                      <Select
                        key={competency.id}
                        id={`tal-int-score-${competency.id}`}
                        label={localizedName(competency.name, competency.nameAr, locale)}
                        value={sScores[competency.id] === undefined ? "" : String(sScores[competency.id])}
                        onValueChange={(value) => {
                          const next = { ...sScores };
                          if (value === "") {
                            delete next[competency.id];
                          } else {
                            next[competency.id] = Number.parseInt(value, 10);
                          }
                          setSScores(next);
                        }}
                        options={[
                          { value: "", label: "—" },
                          ...[1, 2, 3, 4, 5].map((level) => ({ value: String(level), label: String(level) })),
                        ]}
                      />
                    ))}
                  </div>
                )}
                <Select
                  id="tal-int-verdict"
                  label={d.talVerdict}
                  value={sVerdict}
                  onValueChange={setSVerdict}
                  options={[
                    { value: "", label: "—" },
                    { value: "STRONG_HIRE", label: d.talVerdictStrongHire },
                    { value: "HIRE", label: d.talVerdictHire },
                    { value: "NO_HIRE", label: d.talVerdictNoHire },
                    { value: "STRONG_NO_HIRE", label: d.talVerdictStrongNoHire },
                  ]}
                />
                <Textarea
                  id="tal-int-comments"
                  label={d.talLabelNotes}
                  value={sComments}
                  onValueChange={setSComments}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void recordScorecard()} loading={busy === "scorecard"}>
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
