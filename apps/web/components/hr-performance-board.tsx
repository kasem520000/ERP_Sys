"use client";

/**
 * PHASE-047 (W-5, T-11) — the performance board (PAGE_ARCHETYPES §2 +
 * §8, the hr-leave-board pattern): FIVE TABS — the cycle register
 * (create + the one-way lifecycle acts DRAFT→ACTIVE→CALIBRATION→
 * CLOSED), MY REVIEWS (the own-rows submission plane — the reviewer is
 * the session's linked employee, never a form field; the 360 kinds'
 * overallScore is REQUIRED, the manager's may ride the scorecard), the
 * CALIBRATION view (a cycle's reviews + BR-090's aggregate panel — the
 * ≥ 3 relationships only, never an attributed source — and the
 * calibrate act on the manager review), the GOALS cascade (the tree +
 * BR-089's explicit weight check + the own-goals KRI triage), and the
 * COMPETENCY framework (the register + the tenant's 1–5 scale
 * descriptors). Every act is the W-2 engine's own endpoint; typed
 * errors render through the localized talent mirror.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  DatePicker,
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
  Aggregate360View,
  CompetencyLevelRow,
  CompetencyRow,
  EmployeeListRow,
  GoalRow,
  GoalTreeNode,
  GoalWeightCheck,
  OrgUnitRow,
  PerformanceCycleRow,
  PerformanceReviewRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  localizedName,
  localizedTalentCycleStatus,
  localizedTalentError,
  localizedTalentGoalStatus,
  localizedTalentReviewKind,
  localizedTalentReviewStatus,
} from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, InfoNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;

type PerfTab = "cycles" | "myReviews" | "calibration" | "goals" | "competencies";
type ReviewKind = "MANAGER" | "SELF" | "PEER" | "SUBORDINATE";

function cycleLabel(cycle: PerformanceCycleRow, locale: Locale): string {
  return locale === "ar" && cycle.nameAr !== null ? cycle.nameAr : cycle.name;
}

function goalLabel(goal: GoalRow, locale: Locale): string {
  return locale === "ar" && goal.titleAr !== null ? goal.titleAr : goal.title;
}

/** The nested cascade rows (indent by depth). */
function GoalNodes({
  nodes,
  depth,
  locale,
  d,
}: {
  nodes: readonly GoalTreeNode[];
  depth: number;
  locale: Locale;
  d: ReturnType<typeof getDictionary>;
}): JSX.Element {
  return (
    <>
      {nodes.map((node) => (
        <div key={node.id} className="flex flex-col gap-1">
          <div
            className="flex flex-wrap items-center gap-3 rounded-md border border-subtle px-3 py-2"
            style={{ marginInlineStart: `${depth * 1.5}rem` }}
          >
            <span className="text-sm font-medium">{goalLabel(node, locale)}</span>
            <Badge tone="neutral" >
              <span dir="ltr">{node.weight}%</span>
            </Badge>
            <Badge tone={node.status === "ACTIVE" || node.status === "AT_RISK" ? "primary" : "neutral"}>
              {localizedTalentGoalStatus(d, node.status)}
            </Badge>
            {node.progressPct !== null && (
              <span className="font-mono text-sm tabular-nums" dir="ltr">
                {d.talProgressPct}: {node.progressPct}%
              </span>
            )}
            {node.kriTarget !== null && (
              <span className="text-xs text-gray-600" dir="ltr">
                KRI: {node.kriTarget}
                {node.kriActual === null ? "" : ` → ${node.kriActual}`}
              </span>
            )}
            {node.dueDate !== null && (
              <span className="font-mono text-xs text-gray-600" dir="ltr">
                {d.talDueDate}: {node.dueDate}
              </span>
            )}
          </div>
          {node.children.length > 0 && (
            <GoalNodes nodes={node.children} depth={depth + 1} locale={locale} d={d} />
          )}
        </div>
      ))}
    </>
  );
}

export function HrPerformanceBoard({
  locale,
  initialCycles,
  initialCompetencies,
  initialLevels,
  initialOwnReviews,
  initialOwnGoals,
  orgUnits,
  employees,
}: {
  locale: Locale;
  initialCycles: readonly PerformanceCycleRow[];
  initialCompetencies: readonly CompetencyRow[];
  initialLevels: readonly CompetencyLevelRow[];
  /** null = the acting session lacks hr.performance.review (the honest
   * no-permission notice renders; the other tabs stay usable). */
  initialOwnReviews: readonly PerformanceReviewRow[] | null;
  /** null = the session lacks hr.performance.review (the own planes
   * render the honest no-permission notice). */
  initialOwnGoals: readonly GoalRow[] | null;
  orgUnits: readonly OrgUnitRow[];
  employees: readonly EmployeeListRow[];
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const tabItems = useMemo(
    () => [
      { value: "cycles" as const, label: d.talTabCycles },
      { value: "myReviews" as const, label: d.talTabMyReviews },
      { value: "calibration" as const, label: d.talTabCalibration },
      { value: "goals" as const, label: d.talTabGoals },
      { value: "competencies" as const, label: d.talTabCompetencies },
    ],
    [d],
  );
  const [tab, setTab] = useState<PerfTab>("cycles");

  const employeeLabel = useCallback(
    (id: string): string => {
      const found = employees.find((employee) => employee.id === id);
      return found === undefined
        ? "—"
        : `${found.code} · ${localizedName(found.name, found.nameAr, locale)}`;
    },
    [employees, locale],
  );

  const activeCompetencies = useMemo(
    () => initialCompetencies.filter((competency) => competency.active),
    [initialCompetencies],
  );

  // ── cycles: the register + the lifecycle acts ────────────────────────────
  const [cycles, setCycles] = useState<readonly PerformanceCycleRow[]>(initialCycles);
  const [cycleCreateOpen, setCycleCreateOpen] = useState(false);
  const [cName, setCName] = useState("");
  const [cNameAr, setCNameAr] = useState("");
  const [cStart, setCStart] = useState("");
  const [cEnd, setCEnd] = useState("");
  const [cDue, setCDue] = useState("");
  const [cScope, setCScope] = useState<ReadonlySet<string>>(new Set());
  const [cycleSort, setCycleSort] = useState<DataTableSort[]>([]);

  async function createCycle(): Promise<void> {
    setError(null);
    if (cName.trim() === "" || !DATE_RE.test(cStart) || !DATE_RE.test(cEnd) || cEnd < cStart) {
      setError(d.budgetFormInvalid);
      return;
    }
    if (cDue !== "" && !DATE_RE.test(cDue)) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("cycle-create");
    const result = await bffFetch<PerformanceCycleRow>("hr/performance/cycles", {
      method: "POST",
      body: {
        name: cName.trim(),
        nameAr: cNameAr.trim() === "" ? null : cNameAr.trim(),
        periodStart: cStart,
        periodEnd: cEnd,
        reviewDueDate: cDue === "" ? null : cDue,
        scopeOrgUnitIds: [...cScope],
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCycles([result.data, ...cycles]);
    setCycleCreateOpen(false);
    setCName(""); setCNameAr(""); setCStart(""); setCEnd(""); setCDue(""); setCScope(new Set());
    toast({ tone: "success", title: d.talCycleCreatedToast });
  }

  async function transitionCycle(
    cycle: PerformanceCycleRow,
    action: "activate" | "calibrate" | "close",
  ): Promise<void> {
    setError(null);
    setBusy(`cycle-${cycle.id}`);
    const result = await bffFetch<PerformanceCycleRow>(`hr/performance/cycles/${cycle.id}/${action}`, {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCycles(cycles.map((row) => (row.id === result.data.id ? result.data : row)));
    toast({ tone: "success", title: d.talCycleTransitionedToast });
  }

  // ── my reviews: the own-rows submission plane ────────────────────────────
  const [ownReviews, setOwnReviews] = useState<readonly PerformanceReviewRow[] | null>(initialOwnReviews);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rCycle, setRCycle] = useState("");
  const [rReviewee, setRReviewee] = useState("");
  const [rKind, setRKind] = useState<ReviewKind>("MANAGER");
  const [rOverall, setROverall] = useState("");
  const [rComments, setRComments] = useState("");
  const [rScores, setRScores] = useState<Record<string, number>>({});
  const [ownSort, setOwnSort] = useState<DataTableSort[]>([]);

  async function submitReview(mode: "draft" | "submit"): Promise<void> {
    setError(null);
    if (rCycle === "" || rReviewee === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    // The 360 kinds REQUIRE the overall score (the 0095 contract law);
    // the manager input may omit it (the scorecard carries the detail).
    if (rKind !== "MANAGER" && !PCT_RE.test(rOverall)) {
      setError(d.budgetFormInvalid);
      return;
    }
    if (rOverall !== "" && !PCT_RE.test(rOverall)) {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy(`review-${mode}`);
    const result = await bffFetch<PerformanceReviewRow>(`hr/performance/reviews/${mode}`, {
      method: "POST",
      body: {
        cycleId: rCycle,
        revieweeEmployeeId: rReviewee,
        kind: rKind,
        overallScore: rOverall === "" ? null : rOverall,
        competencyScores: rScores,
        comments: rComments.trim() === "" ? null : rComments.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (ownReviews !== null) {
      setOwnReviews([result.data, ...ownReviews.filter((row) => row.id !== result.data.id)]);
    }
    setReviewOpen(false);
    setRCycle(""); setRReviewee(""); setRKind("MANAGER"); setROverall(""); setRComments(""); setRScores({});
    toast({ tone: "success", title: mode === "draft" ? d.talReviewSavedToast : d.talReviewSubmittedToast });
  }

  // ── calibration: the cycle's reviews + the 360 aggregate + the act ───────
  const [calCycle, setCalCycle] = useState("");
  const [calReviews, setCalReviews] = useState<readonly PerformanceReviewRow[] | null>(null);
  const [calBusy, setCalBusy] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<Aggregate360View | null>(null);
  const [calTarget, setCalTarget] = useState<PerformanceReviewRow | null>(null);
  const [calScore, setCalScore] = useState("");
  const [calComments, setCalComments] = useState("");
  const [calSort, setCalSort] = useState<DataTableSort[]>([]);
  const calRunRef = useRef(0);

  const calCycleRow = cycles.find((cycle) => cycle.id === calCycle);

  const loadCalibration = useCallback(
    async (cycleId: string): Promise<void> => {
      if (cycleId === "") {
        setCalReviews(null); setAggregate(null);
        return;
      }
      const run = calRunRef.current + 1;
      calRunRef.current = run;
      setCalBusy(true); setCalError(null);
      const result = await bffFetch<readonly PerformanceReviewRow[]>(
        `hr/performance/cycles/${cycleId}/reviews`,
      );
      if (run !== calRunRef.current) {
        return;
      }
      setCalBusy(false);
      if (!result.ok) {
        setCalError(localizedTalentError(d, result.error, result.retryAfterSeconds));
        setCalReviews(null);
        return;
      }
      setCalReviews(result.data);
    },
    [d],
  );

  async function loadAggregate(cycleId: string, revieweeId: string): Promise<void> {
    const result = await bffFetch<Aggregate360View>(
      `hr/performance/cycles/${cycleId}/reviews/${revieweeId}/aggregate-360`,
    );
    if (!result.ok) {
      setAggregate(null);
      setCalError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAggregate(result.data);
  }

  function selectCalibrationRow(revieweeId: string): void {
    setAggregate(null);
    const managerRow = calReviews?.find(
      (row) => row.revieweeEmployeeId === revieweeId && row.kind === "MANAGER",
    );
    setCalTarget(managerRow ?? null);
    void loadAggregate(calCycle, revieweeId);
  }

  async function calibrate(): Promise<void> {
    if (calTarget === null) {
      return;
    }
    setCalError(null);
    if (calScore !== "" && !PCT_RE.test(calScore)) {
      setCalError(d.budgetFormInvalid);
      return;
    }
    setBusy("calibrate");
    const result = await bffFetch<PerformanceReviewRow>("hr/performance/reviews/calibrate", {
      method: "POST",
      body: {
        cycleId: calTarget.cycleId,
        revieweeEmployeeId: calTarget.revieweeEmployeeId,
        overallScore: calScore === "" ? null : calScore,
        comments: calComments.trim() === "" ? null : calComments.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setCalError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (calReviews !== null) {
      setCalReviews(calReviews.map((row) => (row.id === result.data.id ? result.data : row)));
    }
    setCalTarget(result.data);
    setCalScore(""); setCalComments("");
    toast({ tone: "success", title: d.talCalibratedToast });
  }

  // ── goals: the cascade + the weight check + the own triage ───────────────
  const [goalCycle, setGoalCycle] = useState("");
  const [goalTree, setGoalTree] = useState<readonly GoalTreeNode[] | null>(null);
  const [goalBusy, setGoalBusy] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalCreateOpen, setGoalCreateOpen] = useState(false);
  const [gOwner, setGOwner] = useState("");
  const [gParent, setGParent] = useState("");
  const [gTitle, setGTitle] = useState("");
  const [gTitleAr, setGTitleAr] = useState("");
  const [gWeight, setGWeight] = useState("");
  const [gKri, setGKri] = useState("");
  const [gDue, setGDue] = useState("");
  const [ownGoals, setOwnGoals] = useState<readonly GoalRow[] | null>(initialOwnGoals);
  const [checkEmployee, setCheckEmployee] = useState("");
  const [weightCheck, setWeightCheck] = useState<GoalWeightCheck | null>(null);
  const [progressTarget, setProgressTarget] = useState<GoalRow | null>(null);
  const [pKri, setPKri] = useState("");
  const [pPct, setPPct] = useState("");

  const loadGoals = useCallback(
    async (cycleId: string): Promise<void> => {
      if (cycleId === "") {
        setGoalTree(null);
        return;
      }
      setGoalBusy(true); setGoalError(null);
      const treeResult = await bffFetch<{ cycleId: string; roots: readonly GoalTreeNode[] }>(
        `hr/goals/tree?cycleId=${cycleId}`,
      );
      setGoalBusy(false);
      if (!treeResult.ok) {
        setGoalError(localizedTalentError(d, treeResult.error, treeResult.retryAfterSeconds));
        setGoalTree(null);
        return;
      }
      setGoalTree(treeResult.data.roots);
    },
    [d],
  );

  async function createGoal(): Promise<void> {
    setGoalError(null);
    if (goalCycle === "" || gOwner === "" || gTitle.trim() === "" || !PCT_RE.test(gWeight)) {
      setGoalError(d.budgetFormInvalid);
      return;
    }
    if (gDue !== "" && !DATE_RE.test(gDue)) {
      setGoalError(d.budgetFormInvalid);
      return;
    }
    setBusy("goal-create");
    const result = await bffFetch<GoalRow>("hr/goals", {
      method: "POST",
      body: {
        cycleId: goalCycle,
        ownerEmployeeId: gOwner,
        parentGoalId: gParent === "" ? null : gParent,
        title: gTitle.trim(),
        titleAr: gTitleAr.trim() === "" ? null : gTitleAr.trim(),
        weight: gWeight,
        kriTarget: gKri.trim() === "" ? null : gKri.trim(),
        dueDate: gDue === "" ? null : gDue,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setGoalError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setGoalCreateOpen(false);
    setGOwner(""); setGParent(""); setGTitle(""); setGTitleAr(""); setGWeight(""); setGKri(""); setGDue("");
    toast({ tone: "success", title: d.talGoalCreatedToast });
    await loadGoals(goalCycle);
    if (weightCheck !== null && weightCheck.employeeId === gOwner) {
      await runWeightCheck(goalCycle, gOwner);
    }
  }

  async function runWeightCheck(cycleId: string, employeeId: string): Promise<void> {
    setWeightCheck(null);
    const search = new URLSearchParams({ cycleId, employeeId });
    const result = await bffFetch<GoalWeightCheck>(`hr/goals/validate?${search.toString()}`);
    if (!result.ok) {
      setGoalError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setWeightCheck(result.data);
  }

  async function updateProgress(): Promise<void> {
    if (progressTarget === null) {
      return;
    }
    setGoalError(null);
    if (!PCT_RE.test(pPct)) {
      setGoalError(d.budgetFormInvalid);
      return;
    }
    setBusy("progress");
    const result = await bffFetch<GoalRow>(`hr/goals/${progressTarget.id}/progress`, {
      method: "POST",
      body: {
        kriActual: pKri.trim() === "" ? null : pKri.trim(),
        progressPct: pPct,
      },
    });
    setBusy(null);
    if (!result.ok) {
      setGoalError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    if (ownGoals !== null) {
      setOwnGoals(ownGoals.map((row) => (row.id === result.data.id ? result.data : row)));
    }
    setProgressTarget(null);
    setPKri(""); setPPct("");
    toast({ tone: "success", title: d.talProgressUpdatedToast });
    await loadGoals(goalCycle);
  }

  // ── competencies: the framework + the scale ──────────────────────────────
  const [competencies, setCompetencies] = useState<readonly CompetencyRow[]>(initialCompetencies);
  const [compCreateOpen, setCompCreateOpen] = useState(false);
  const [kCode, setKCode] = useState("");
  const [kName, setKName] = useState("");
  const [kNameAr, setKNameAr] = useState("");
  const [kCategory, setKCategory] = useState("");
  const [compSort, setCompSort] = useState<DataTableSort[]>([]);
  const [levels, setLevels] = useState<readonly CompetencyLevelRow[]>(initialLevels);
  const [levelTarget, setLevelTarget] = useState<CompetencyLevelRow | null>(null);
  const [lName, setLName] = useState("");
  const [lNameAr, setLNameAr] = useState("");
  const [lDescriptor, setLDescriptor] = useState("");
  const [lDescriptorAr, setLDescriptorAr] = useState("");

  async function createCompetency(): Promise<void> {
    setError(null);
    if (kCode.trim() === "" || kName.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("comp-create");
    const result = await bffFetch<CompetencyRow>("hr/competencies", {
      method: "POST",
      body: {
        code: kCode.trim(),
        name: kName.trim(),
        nameAr: kNameAr.trim() === "" ? null : kNameAr.trim(),
        category: kCategory.trim() === "" ? null : kCategory.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCompetencies([result.data, ...competencies]);
    setCompCreateOpen(false);
    setKCode(""); setKName(""); setKNameAr(""); setKCategory("");
    toast({ tone: "success", title: d.talCompetencySavedToast });
  }

  async function toggleCompetency(competency: CompetencyRow, next: boolean): Promise<void> {
    setError(null);
    setBusy(`comp-${competency.id}`);
    const result = await bffFetch<CompetencyRow>(
      `hr/competencies/${competency.id}/${next ? "activate" : "deactivate"}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCompetencies(competencies.map((row) => (row.id === result.data.id ? result.data : row)));
  }

  async function saveLevel(): Promise<void> {
    if (levelTarget === null) {
      return;
    }
    setError(null);
    if (lName.trim() === "" || lNameAr.trim() === "" || lDescriptor.trim() === "" || lDescriptorAr.trim() === "") {
      setError(d.budgetFormInvalid);
      return;
    }
    setBusy("level");
    const result = await bffFetch<CompetencyLevelRow>(`hr/competencies/levels/${levelTarget.level}`, {
      method: "PUT",
      body: {
        name: lName.trim(),
        nameAr: lNameAr.trim(),
        descriptor: lDescriptor.trim(),
        descriptorAr: lDescriptorAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedTalentError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setLevels(levels.map((row) => (row.level === result.data.level ? result.data : row)));
    setLevelTarget(null);
    toast({ tone: "success", title: d.talLevelSavedToast });
  }

  const cycleOptions = cycles.map((cycle) => ({
    value: cycle.id,
    label: `${cycleLabel(cycle, locale)} (${cycle.periodStart} → ${cycle.periodEnd})`,
  }));

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}

      <Tabs items={tabItems} value={tab} onValueChange={(value) => setTab(value as PerfTab)}>
        <div data-slot="cycles" className="flex flex-col gap-4">
            <Card
              title={d.talCyclesCard}
              actions={
                <Button variant="primary" onClick={() => setCycleCreateOpen(true)}>
                  {d.talCycleNew}
                </Button>
              }
            >
              <DataTable
                columns={[
                  {
                    id: "name",
                    header: activeLocaleHeader(d.hrColName),
                    accessor: (row) => cycleLabel(row, locale),
                  },
                  {
                    id: "period",
                    header: activeLocaleHeader(d.talCyclePeriod),
                    accessor: (row) => `${row.periodStart} → ${row.periodEnd}`,
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.periodStart} → {row.periodEnd}
                      </span>
                    ),
                  },
                  {
                    id: "status",
                    header: activeLocaleHeader(d.talLabelStatus),
                    accessor: (row) => localizedTalentCycleStatus(d, row.status),
                    render: (row) => (
                      <Badge
                        tone={row.status === "ACTIVE" || row.status === "CALIBRATION" ? "primary" : "neutral"}
                      >
                        {localizedTalentCycleStatus(d, row.status)}
                      </Badge>
                    ),
                  },
                  {
                    id: "reviewDue",
                    header: activeLocaleHeader(d.talCycleReviewDue),
                    accessor: (row) => row.reviewDueDate ?? "—",
                    mono: true,
                    render: (row) => (
                      <span className="font-mono text-sm" dir="ltr">
                        {row.reviewDueDate ?? "—"}
                      </span>
                    ),
                  },
                  {
                    id: "actions",
                    header: activeLocaleHeader(d.talEditBtn),
                    accessor: () => "",
                    render: (row) => (
                      <div className="flex flex-wrap gap-2">
                        {row.status === "DRAFT" && (
                          <Button
                            variant="secondary"
                            onClick={() => void transitionCycle(row, "activate")}
                            loading={busy === `cycle-${row.id}`}
                          >
                            {d.talActivate}
                          </Button>
                        )}
                        {row.status === "ACTIVE" && (
                          <Button
                            variant="secondary"
                            onClick={() => void transitionCycle(row, "calibrate")}
                            loading={busy === `cycle-${row.id}`}
                          >
                            {d.talOpenCalibration}
                          </Button>
                        )}
                        {row.status === "CALIBRATION" && (
                          <Button
                            variant="secondary"
                            onClick={() => void transitionCycle(row, "close")}
                            loading={busy === `cycle-${row.id}`}
                          >
                            {d.talCloseCycle}
                          </Button>
                        )}
                      </div>
                    ),
                  },
                ]}
                rows={[...cycles]}
                rowKey={(row) => row.id}
                sort={cycleSort}
                onSortChange={setCycleSort}
                empty={{ title: d.talEmptyRows }}
              />
            </Card>

            <Dialog open={cycleCreateOpen} onOpenChange={setCycleCreateOpen} title={d.talCycleNew}>
              <div className="flex flex-col gap-3">
                <Input
                  id="tal-cycle-name"
                  label={d.talLabelName}
                  value={cName}
                  onValueChange={setCName}
                  required
                />
                <Input
                  id="tal-cycle-name-ar"
                  label={d.talLabelNameAr}
                  value={cNameAr}
                  onValueChange={setCNameAr}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <DatePicker
                    id="tal-cycle-start"
                    locale={locale}
                    label={d.talCyclePeriodStart}
                    value={cStart}
                    onSelect={setCStart}
                  />
                  <DatePicker
                    id="tal-cycle-end"
                    locale={locale}
                    label={d.talCyclePeriodEnd}
                    value={cEnd}
                    onSelect={setCEnd}
                  />
                </div>
                <DatePicker
                  id="tal-cycle-due"
                  locale={locale}
                  label={d.talCycleReviewDue}
                  value={cDue}
                  onSelect={setCDue}
                />
                <div>
                  <p className="mb-2 text-sm font-medium">{d.talCycleScope}</p>
                  {orgUnits.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                  ) : (
                    <div className="flex max-h-44 flex-col gap-1 overflow-y-auto rounded-md border border-subtle p-2">
                      {orgUnits.map((unit) => (
                        <label key={unit.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={cScope.has(unit.id)}
                            onChange={(event) => {
                              const next = new Set(cScope);
                              if (event.target.checked) {
                                next.add(unit.id);
                              } else {
                                next.delete(unit.id);
                              }
                              setCScope(next);
                            }}
                          />
                          {localizedName(unit.name, unit.nameAr, locale)}{" "}
                          <span className="font-mono text-xs text-gray-500" dir="ltr">
                            {unit.path}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createCycle()} loading={busy === "cycle-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="myReviews" className="flex flex-col gap-4">
            <Card
              title={d.talMyReviewsCard}
              actions={
                ownReviews !== null ? (
                  <Button variant="primary" onClick={() => setReviewOpen(true)}>
                    {d.talReviewNew}
                  </Button>
                ) : undefined
              }
            >
              <InfoNotice>{d.talReviewerNote}</InfoNotice>
              {ownReviews === null ? (
                <div className="mt-3">
                  <ErrorNotice>{d.errorsForbidden}</ErrorNotice>
                </div>
              ) : (
                <div className="mt-3">
                  <DataTable
                    columns={[
                      {
                        id: "cycle",
                        header: activeLocaleHeader(d.talReviewCycle),
                        accessor: (row) =>
                          cycleLabel(
                            cycles.find((cycle) => cycle.id === row.cycleId) ?? {
                              name: row.cycleId,
                              nameAr: null,
                            } as PerformanceCycleRow,
                            locale,
                          ),
                      },
                      {
                        id: "reviewee",
                        header: activeLocaleHeader(d.talReviewReviewee),
                        accessor: (row) => employeeLabel(row.revieweeEmployeeId),
                      },
                      {
                        id: "kind",
                        header: activeLocaleHeader(d.talReviewKind),
                        accessor: (row) => localizedTalentReviewKind(d, row.kind),
                      },
                      {
                        id: "status",
                        header: activeLocaleHeader(d.talLabelStatus),
                        accessor: (row) => localizedTalentReviewStatus(d, row.status),
                        render: (row) => (
                          <Badge tone={row.status === "DRAFT" ? "neutral" : "primary"}>
                            {localizedTalentReviewStatus(d, row.status)}
                          </Badge>
                        ),
                      },
                      {
                        id: "overall",
                        header: activeLocaleHeader(d.talOverallScore),
                        accessor: (row) => row.overallScore ?? "—",
                        mono: true,
                        render: (row) => (
                          <span className="font-mono text-sm tabular-nums" dir="ltr">
                            {row.overallScore ?? "—"}
                          </span>
                        ),
                      },
                    ]}
                    rows={[...ownReviews]}
                    rowKey={(row) => row.id}
                    sort={ownSort}
                    onSortChange={setOwnSort}
                    empty={{ title: d.talEmptyRows }}
                  />
                </div>
              )}
            </Card>

            <Dialog open={reviewOpen} onOpenChange={setReviewOpen} title={d.talReviewNew}>
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-review-cycle"
                  label={d.talReviewCycle}
                  value={rCycle}
                  onValueChange={setRCycle}
                  options={cycleOptions}
                  required
                />
                <Select
                  id="tal-review-reviewee"
                  label={d.talReviewReviewee}
                  value={rReviewee}
                  onValueChange={setRReviewee}
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                  }))}
                  required
                />
                <Select
                  id="tal-review-kind"
                  label={d.talReviewKind}
                  value={rKind}
                  onValueChange={(value) => {
                    if (value === "MANAGER" || value === "SELF" || value === "PEER" || value === "SUBORDINATE") {
                      setRKind(value);
                    }
                  }}
                  options={[
                    { value: "MANAGER", label: d.talKindManager },
                    { value: "SELF", label: d.talKindSelf },
                    { value: "PEER", label: d.talKindPeer },
                    { value: "SUBORDINATE", label: d.talKindSubordinate },
                  ]}
                  required
                />
                <Input
                  id="tal-review-overall"
                  label={d.talOverallScore}
                  value={rOverall}
                  onValueChange={setROverall}
                  hint={d.talOverallOptional}
                  mono
                  bidiIsolate
                />
                <div>
                  <p className="mb-2 text-sm font-medium">{d.talCompetencyScores}</p>
                  {activeCompetencies.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                  ) : (
                    <div className="grid max-h-52 gap-2 overflow-y-auto rounded-md border border-subtle p-2 sm:grid-cols-2">
                      {activeCompetencies.map((competency) => (
                        <Select
                          key={competency.id}
                          id={`tal-review-score-${competency.id}`}
                          label={localizedName(competency.name, competency.nameAr, locale)}
                          value={rScores[competency.id] === undefined ? "" : String(rScores[competency.id])}
                          onValueChange={(value) => {
                            const next = { ...rScores };
                            if (value === "") {
                              delete next[competency.id];
                            } else {
                              next[competency.id] = Number.parseInt(value, 10);
                            }
                            setRScores(next);
                          }}
                          options={[
                            { value: "", label: "—" },
                            ...[1, 2, 3, 4, 5].map((level) => ({
                              value: String(level),
                              label: String(level),
                            })),
                          ]}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <Textarea
                  id="tal-review-comments"
                  label={d.hrColNote}
                  value={rComments}
                  onValueChange={setRComments}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => void submitReview("draft")} loading={busy === "review-draft"}>
                    {d.talSaveDraft}
                  </Button>
                  <Button variant="primary" onClick={() => void submitReview("submit")} loading={busy === "review-submit"}>
                    {d.talSubmit}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="calibration" className="flex flex-col gap-4">
            <Card title={d.talCalibrationCard}>
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.talCalibrationHint}</InfoNotice>
                <div className="max-w-md">
                  <Select
                    id="tal-cal-cycle"
                    label={d.talSelectCycle}
                    value={calCycle}
                    onValueChange={(value) => {
                      setCalCycle(value);
                      setCalReviews(null);
                      setAggregate(null);
                      setCalTarget(null);
                      void loadCalibration(value);
                    }}
                    options={cycleOptions}
                  />
                </div>
                {calError !== null && <ErrorNotice>{calError}</ErrorNotice>}
                {calReviews !== null && (
                  <DataTable
                    columns={[
                      {
                        id: "reviewee",
                        header: activeLocaleHeader(d.talReviewReviewee),
                        accessor: (row) => employeeLabel(row.revieweeEmployeeId),
                      },
                      {
                        id: "kind",
                        header: activeLocaleHeader(d.talReviewKind),
                        accessor: (row) => localizedTalentReviewKind(d, row.kind),
                      },
                      {
                        id: "status",
                        header: activeLocaleHeader(d.talLabelStatus),
                        accessor: (row) => localizedTalentReviewStatus(d, row.status),
                      },
                      {
                        id: "overall",
                        header: activeLocaleHeader(d.talOverallScore),
                        accessor: (row) => row.overallScore ?? "—",
                        mono: true,
                        render: (row) => (
                          <span className="font-mono text-sm tabular-nums" dir="ltr">
                            {row.overallScore ?? "—"}
                          </span>
                        ),
                      },
                      {
                        id: "rollup",
                        header: activeLocaleHeader(d.talGoalRollup),
                        accessor: (row) => row.goalRollup ?? "—",
                        mono: true,
                        render: (row) => (
                          <span className="font-mono text-sm tabular-nums" dir="ltr">
                            {row.goalRollup ?? "—"}
                          </span>
                        ),
                      },
                      {
                        id: "select",
                        header: activeLocaleHeader(d.talRunCheck),
                        accessor: () => "",
                        render: (row) => (
                          <Button variant="secondary" onClick={() => selectCalibrationRow(row.revieweeEmployeeId)}>
                            {d.talAggregate360}
                          </Button>
                        ),
                      },
                    ]}
                    rows={[...calReviews]}
                    rowKey={(row) => row.id}
                    sort={calSort}
                    onSortChange={setCalSort}
                    loading={calBusy}
                    empty={{ title: d.talEmptyRows }}
                  />
                )}
              </div>
            </Card>

            {calTarget !== null && (
              <Card title={`${d.talAggregate360} — ${employeeLabel(calTarget.revieweeEmployeeId)}`}>
                <div className="flex flex-col gap-3">
                  <InfoNotice>{d.talAggregateHint}</InfoNotice>
                  {aggregate === null ? (
                    <p className="text-sm text-gray-600">{d.talBelowThresholdNote}</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(["SELF", "PEER", "SUBORDINATE"] as const).map((kind) => {
                        const block = aggregate.aggregates[kind];
                        return (
                          <div key={kind} className="rounded-md border border-subtle p-3">
                            <p className="mb-2 text-sm font-semibold">
                              {localizedTalentReviewKind(d, kind)}
                            </p>
                            {block === null ? (
                              <p className="text-sm text-gray-600">{d.talBelowThresholdNote}</p>
                            ) : (
                              <div className="flex flex-col gap-1 text-sm">
                                <span dir="ltr">
                                  {d.talAggregateCount}: {block.count}
                                </span>
                                <span className="font-mono tabular-nums" dir="ltr">
                                  {d.talAggregateMean}: {block.mean}
                                </span>
                                <span className="font-mono tabular-nums" dir="ltr">
                                  {d.talAggregateMin}: {block.min} · {d.talAggregateMax}: {block.max}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {calCycleRow?.status === "CALIBRATION" && (
                    <div className="grid gap-3 rounded-md border border-gray-200 p-4 sm:grid-cols-2">
                      <Input
                        id="tal-cal-score"
                        label={d.talOverallScore}
                        value={calScore}
                        onValueChange={setCalScore}
                        hint={d.talPctFormat}
                        mono
                        bidiIsolate
                      />
                      <Input
                        id="tal-cal-comments"
                        label={d.hrColNote}
                        value={calComments}
                        onValueChange={setCalComments}
                      />
                      <div className="sm:col-span-2 flex justify-end">
                        <Button variant="primary" onClick={() => void calibrate()} loading={busy === "calibrate"}>
                          {d.talCalibrate}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

        <div data-slot="goals" className="flex flex-col gap-4">
            <Card
              title={d.talGoalsCard}
              actions={
                <Button variant="primary" onClick={() => setGoalCreateOpen(true)} disabled={goalCycle === ""}>
                  {d.talGoalNew}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="max-w-md">
                  <Select
                    id="tal-goal-cycle"
                    label={d.talSelectCycle}
                    value={goalCycle}
                    onValueChange={(value) => {
                      setGoalCycle(value);
                      void loadGoals(value);
                    }}
                    options={cycleOptions}
                  />
                </div>
                {goalError !== null && <ErrorNotice>{goalError}</ErrorNotice>}
                {goalBusy ? (
                  <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                ) : goalTree === null ? (
                  <p className="text-sm text-gray-600">{d.talSelectCycle}</p>
                ) : goalTree.length === 0 ? (
                  <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <GoalNodes nodes={goalTree} depth={0} locale={locale} d={d} />
                  </div>
                )}
              </div>
            </Card>

            <Card title={d.talWeightCheck}>
              <div className="flex flex-col gap-3">
                <div className="max-w-md">
                  <Select
                    id="tal-check-employee"
                    label={d.talGoalOwner}
                    value={checkEmployee}
                    onValueChange={setCheckEmployee}
                    options={employees.map((employee) => ({
                      value: employee.id,
                      label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                    }))}
                  />
                </div>
                <div>
                  <Button
                    variant="secondary"
                    disabled={goalCycle === "" || checkEmployee === ""}
                    onClick={() => void runWeightCheck(goalCycle, checkEmployee)}
                  >
                    {d.talRunCheck}
                  </Button>
                </div>
                {weightCheck !== null && (
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <Badge tone={weightCheck.valid ? "primary" : "neutral"}>
                      {weightCheck.valid ? d.talWeightValid : d.talWeightInvalid}
                    </Badge>
                    <span className="font-mono tabular-nums" dir="ltr">
                      {d.talWeightSum}: {weightCheck.sum}%
                    </span>
                    <span dir="ltr">
                      {d.talActiveGoalsCount}: {weightCheck.activeGoals}
                    </span>
                  </div>
                )}
              </div>
            </Card>

            <Card title={d.talMyGoals}>
              <div className="flex flex-col gap-3">
                <InfoNotice>{d.talMyGoalsHint}</InfoNotice>
                {ownGoals === null ? (
                  <ErrorNotice>{d.errorsForbidden}</ErrorNotice>
                ) : ownGoals.length === 0 ? (
                  <p className="text-sm text-gray-600">{d.talEmptyRows}</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {ownGoals.map((goal) => (
                      <div
                        key={goal.id}
                        className="flex flex-wrap items-center gap-3 rounded-md border border-subtle px-3 py-2"
                      >
                        <span className="text-sm font-medium">{goalLabel(goal, locale)}</span>
                        <Badge tone="neutral">
                          <span dir="ltr">{goal.weight}%</span>
                        </Badge>
                        <Badge tone={goal.status === "ACTIVE" || goal.status === "AT_RISK" ? "primary" : "neutral"}>
                          {localizedTalentGoalStatus(d, goal.status)}
                        </Badge>
                        {goal.progressPct !== null && (
                          <span className="font-mono text-sm tabular-nums" dir="ltr">
                            {d.talProgressPct}: {goal.progressPct}%
                          </span>
                        )}
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setProgressTarget(goal);
                            setPKri(goal.kriActual ?? "");
                            setPPct(goal.progressPct ?? "");
                          }}
                        >
                          {d.talUpdateProgress}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Dialog open={goalCreateOpen} onOpenChange={setGoalCreateOpen} title={d.talGoalNew}>
              <div className="flex flex-col gap-3">
                <Select
                  id="tal-goal-owner"
                  label={d.talGoalOwner}
                  value={gOwner}
                  onValueChange={setGOwner}
                  options={employees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.code} · ${localizedName(employee.name, employee.nameAr, locale)}`,
                  }))}
                  required
                />
                <Select
                  id="tal-goal-parent"
                  label={d.talGoalParent}
                  value={gParent}
                  onValueChange={setGParent}
                  options={[
                    { value: "", label: d.talLabelRoot },
                    ...(goalTree ?? []).map((node) => ({ value: node.id, label: goalLabel(node, locale) })),
                  ]}
                />
                <Input id="tal-goal-title" label={d.talGoalTitle} value={gTitle} onValueChange={setGTitle} required />
                <Input
                  id="tal-goal-title-ar"
                  label={d.talGoalTitleAr}
                  value={gTitleAr}
                  onValueChange={setGTitleAr}
                />
                <Input
                  id="tal-goal-weight"
                  label={d.talGoalWeight}
                  value={gWeight}
                  onValueChange={setGWeight}
                  hint={d.talPctFormat}
                  mono
                  bidiIsolate
                  required
                />
                <Input id="tal-goal-kri" label={d.talKriTarget} value={gKri} onValueChange={setGKri} />
                <DatePicker
                  id="tal-goal-due"
                  locale={locale}
                  label={d.talDueDate}
                  value={gDue}
                  onSelect={setGDue}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createGoal()} loading={busy === "goal-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={progressTarget !== null}
              onOpenChange={(open) => {
                if (!open) setProgressTarget(null);
              }}
              title={progressTarget === null ? d.talUpdateProgress : goalLabel(progressTarget, locale)}
            >
              <div className="flex flex-col gap-3">
                <Input id="tal-progress-kri" label={d.talKriActual} value={pKri} onValueChange={setPKri} />
                <Input
                  id="tal-progress-pct"
                  label={d.talProgressPct}
                  value={pPct}
                  onValueChange={setPPct}
                  hint={d.talPctFormat}
                  mono
                  bidiIsolate
                  required
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void updateProgress()} loading={busy === "progress"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>
          </div>

        <div data-slot="competencies" className="flex flex-col gap-4">
            <Card
              title={d.talCompetenciesCard}
              actions={
                <Button variant="primary" onClick={() => setCompCreateOpen(true)}>
                  {d.talCompetencyNew}
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
                    header: activeLocaleHeader(d.hrColName),
                    accessor: (row) => localizedName(row.name, row.nameAr, locale),
                  },
                  {
                    id: "category",
                    header: activeLocaleHeader(d.talCategory),
                    accessor: (row) => row.category ?? "—",
                  },
                  {
                    id: "active",
                    header: activeLocaleHeader(d.talLabelStatus),
                    accessor: (row) => (row.active ? d.talActiveBadge : d.talInactiveBadge),
                    render: (row) => (
                      <Badge tone={row.active ? "primary" : "neutral"}>
                        {row.active ? d.talActiveBadge : d.talInactiveBadge}
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
                        onClick={() => void toggleCompetency(row, !row.active)}
                        loading={busy === `comp-${row.id}`}
                      >
                        {row.active ? d.talDeactivate : d.talActivate}
                      </Button>
                    ),
                  },
                ]}
                rows={[...competencies]}
                rowKey={(row) => row.id}
                sort={compSort}
                onSortChange={setCompSort}
                empty={{ title: d.talEmptyRows }}
              />
            </Card>

            <Card title={d.talScaleCard} description={d.talScaleHint}>
              <div className="flex flex-col gap-2">
                {levels.map((level) => (
                  <div key={level.level} className="rounded-md border border-subtle p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {d.talLevel} {level.level} — {localizedName(level.name, level.nameAr, locale)}
                      </p>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setLevelTarget(level);
                          setLName(level.name);
                          setLNameAr(level.nameAr);
                          setLDescriptor(level.descriptor);
                          setLDescriptorAr(level.descriptorAr);
                        }}
                      >
                        {d.talEditLevel}
                      </Button>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {locale === "ar" ? level.descriptorAr : level.descriptor}
                    </p>
                  </div>
                ))}
              </div>
            </Card>

            <Dialog open={compCreateOpen} onOpenChange={setCompCreateOpen} title={d.talCompetencyNew}>
              <div className="flex flex-col gap-3">
                <Input id="tal-comp-code" label={d.hrColCode} value={kCode} onValueChange={setKCode} required />
                <Input id="tal-comp-name" label={d.talLabelName} value={kName} onValueChange={setKName} required />
                <Input id="tal-comp-name-ar" label={d.talLabelNameAr} value={kNameAr} onValueChange={setKNameAr} />
                <Input id="tal-comp-category" label={d.talCategory} value={kCategory} onValueChange={setKCategory} />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void createCompetency()} loading={busy === "comp-create"}>
                    {d.talSaveBtn}
                  </Button>
                </div>
              </div>
            </Dialog>

            <Dialog
              open={levelTarget !== null}
              onOpenChange={(open) => {
                if (!open) setLevelTarget(null);
              }}
              title={levelTarget === null ? d.talEditLevel : `${d.talEditLevel} ${levelTarget.level}`}
            >
              <div className="flex flex-col gap-3">
                <Input id="tal-level-name" label={d.talLabelName} value={lName} onValueChange={setLName} required />
                <Input
                  id="tal-level-name-ar"
                  label={d.talLabelNameAr}
                  value={lNameAr}
                  onValueChange={setLNameAr}
                  required
                />
                <Textarea
                  id="tal-level-descriptor"
                  label={d.talDescriptor}
                  value={lDescriptor}
                  onValueChange={setLDescriptor}
                />
                <Textarea
                  id="tal-level-descriptor-ar"
                  label={d.talDescriptorAr}
                  value={lDescriptorAr}
                  onValueChange={setLDescriptorAr}
                />
                <div className="flex justify-end">
                  <Button variant="primary" onClick={() => void saveLevel()} loading={busy === "level"}>
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
