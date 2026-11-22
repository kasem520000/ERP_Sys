"use client";

/**
 * PHASE-049 (W-20 — T-13) — the maintenance board (the
 * /assets/maintenance screen body): the work-order board + the plans
 * admin + the checklist entry, cloned from the 048 board patterns
 * (crm-service-orders' workspace + projects-fieldservice-board's engine
 * surfaces) — the data-slot shape immune to the 045 Tabs defect (two
 * panes on a segmented switch, never the Tabs primitive).
 *
 * THE ENGINE-OUTPUT LAW (carried as-is from the W-12/W-13 boards): every
 * figure is an ENGINE OUTPUT rendered VERBATIM — the order totals, the
 * completion's reconciliation verdict (INV-034's own balanced/labor/
 * parts/external/sourceTotal/glExpenseDebit/difference), the stamps, the
 * evaluation's NAMED skips: zero client-side recomputation of any engine
 * number. The cost-line amount column renders the engine's own amount
 * (the labor snapshot hours×rate lands engine-side; the board never
 * multiplies).
 *
 * THE EVALUATION SURFACE (W-17's own design): the listing stays a PURE
 * read; the per-plan Evaluate/Generate-now actions and the bulk
 * evaluate-all call the DEDICATED endpoints — the skips surface as the
 * engine's own report rows (BR-097's named vocabulary), never as errors.
 *
 * THE TYPED-REFUSAL PANEL (the shared piece): a refused action renders
 * the code + the message + the FULL details payload through the notices
 * line's localized summary; a refused list/evaluation renders the whole
 * TypedRefusalPanel — never a generic error.
 */
import { useMemo, useState } from "react";
import type { JSX } from "react";

import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Input,
  Select,
  formatMoneyDisplay,
  type DataTableColumn,
} from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type {
  ApiErrorBody,
  AssetMeterRow,
  EmployeeListRow,
  FixedAssetRow,
  ItemRow,
  MaintenanceCompletionResult,
  MaintenanceCostLineRow,
  MaintenancePlanEvaluationRow,
  MaintenancePlanRow,
  MaintenancePlanTaskRow,
  MaintenanceStepRow,
  MaintenanceWorkOrderRow,
  PartnerRow,
  WarehouseRow,
} from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import {
  formatMessage,
  localizedCmmsError,
  localizedMaintenanceLegType,
  localizedMaintenancePriority,
  localizedMaintenanceSkipReason,
  localizedMaintenanceStatus,
  localizedMaintenanceStepResult,
  localizedMaintenanceTriggerType,
  localizedName,
} from "../lib/messages";
import { Card } from "./card";
import { DefList } from "./def-list";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

/** Hours/qty/rates ≤ 6dp; money ≤ 4dp (ADR-0009 — the engine's own regexes). */
const QTY_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_RE = /^\d+$/;

const STATUS_VALUES = [
  "REQUESTED",
  "PLANNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
] as const;

const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** A cost-line draft (the per-leg XOR shape — the engine's own law). */
interface LineDraft {
  legType: "LABOR" | "PARTS" | "EXTERNAL";
  employeeId: string;
  hours: string;
  unitRate: string;
  itemId: string;
  warehouseId: string;
  qty: string;
  partnerId: string;
  amount: string;
  description: string;
  descriptionAr: string;
}

const EMPTY_LINE: LineDraft = {
  legType: "LABOR",
  employeeId: "",
  hours: "",
  unitRate: "",
  itemId: "",
  warehouseId: "",
  qty: "",
  partnerId: "",
  amount: "",
  description: "",
  descriptionAr: "",
};

/** The plan draft (CALENDAR carries interval+nextDue; METER carries meter+threshold). */
interface PlanDraft {
  assetId: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  triggerType: "CALENDAR" | "METER";
  intervalDays: string;
  nextDueDate: string;
  meterId: string;
  thresholdDelta: string;
  note: string;
  noteAr: string;
}

const EMPTY_PLAN: PlanDraft = {
  assetId: "",
  name: "",
  nameAr: "",
  description: "",
  descriptionAr: "",
  triggerType: "CALENDAR",
  intervalDays: "",
  nextDueDate: "",
  meterId: "",
  thresholdDelta: "",
  note: "",
  noteAr: "",
};

/** The checklist-step draft (the template admin). */
interface TaskDraft {
  seq: string;
  title: string;
  titleAr: string;
  instruction: string;
  instructionAr: string;
}

const EMPTY_TASK: TaskDraft = { seq: "", title: "", titleAr: "", instruction: "", instructionAr: "" };

/** The workspace's three-fetch assembly (the engine has no combined
 * detail endpoint — the board composes order + lines + steps reads). */
interface WorkspaceState {
  order: MaintenanceWorkOrderRow;
  lines: readonly MaintenanceCostLineRow[];
  steps: readonly MaintenanceStepRow[];
}

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

function moneyCell(value: string | null, unpricedLabel: string, isParts = false): JSX.Element {
  if (value === null) {
    // A PARTS line's amount is derived by the WMS issue at completion — a
    // null pre-completion is the pending state (—), never "unpriced"; only
    // LABOR (rate unset) and EXTERNAL (amount unknown) are UNPRICED.
    if (isParts) {
      return <span className="text-xs text-gray-500">—</span>;
    }
    return <span className="text-xs italic text-gray-500">{unpricedLabel}</span>;
  }
  return monoCell(formatMoneyDisplay(value, 4), value);
}

/** The semantic-tone chip (the fieldservice-board precedent). */
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

function statusChipTone(status: string): ChipTone {
  if (status === "COMPLETED") return "success";
  if (status === "ON_HOLD") return "warning";
  if (status === "IN_PROGRESS") return "info";
  return "neutral";
}

function priorityChipTone(priority: string): ChipTone {
  if (priority === "CRITICAL") return "danger";
  if (priority === "HIGH") return "warning";
  return "neutral";
}

export function AssetsMaintenanceBoard({
  locale,
  initialOrders,
  ordersError,
  initialPlans,
  plansError,
  assets,
  employees,
  items,
  warehouses,
  partners,
  meters,
}: {
  locale: Locale;
  initialOrders: readonly MaintenanceWorkOrderRow[] | null;
  ordersError: ApiErrorBody | null;
  initialPlans: readonly MaintenancePlanRow[] | null;
  plansError: ApiErrorBody | null;
  assets: readonly FixedAssetRow[];
  employees: readonly EmployeeListRow[];
  items: readonly ItemRow[];
  warehouses: readonly WarehouseRow[];
  partners: readonly PartnerRow[];
  meters: readonly AssetMeterRow[];
}): JSX.Element {
  const d = getDictionary(locale);

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ------
  const [pane, setPane] = useState<"orders" | "plans">("orders");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // -- the orders pane -------------------------------------------------------
  const [orders, setOrders] = useState<readonly MaintenanceWorkOrderRow[] | null>(initialOrders);
  const [ordersRefusal, setOrdersRefusal] = useState<ApiErrorBody | null>(ordersError);
  const [listLoading, setListLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [assetFilter, setAssetFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createAssetId, setCreateAssetId] = useState("");
  const [createProblem, setCreateProblem] = useState("");
  const [createProblemAr, setCreateProblemAr] = useState("");
  const [createPriority, setCreatePriority] = useState("MEDIUM");
  const [createTechnicianId, setCreateTechnicianId] = useState("");
  const [createNote, setCreateNote] = useState("");
  const [createNoteAr, setCreateNoteAr] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [lineDraft, setLineDraft] = useState<LineDraft>({ ...EMPTY_LINE });
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceLineId, setPriceLineId] = useState("");
  const [priceValue, setPriceValue] = useState("");
  const [removeLineId, setRemoveLineId] = useState<string | null>(null);
  const [stepResultOpen, setStepResultOpen] = useState(false);
  const [stepTarget, setStepTarget] = useState<MaintenanceStepRow | null>(null);
  const [stepResult, setStepResult] = useState("PASS");
  const [stepResultNote, setStepResultNote] = useState("");
  const [stepResultNoteAr, setStepResultNoteAr] = useState("");
  const [completeOpen, setCompleteOpen] = useState(false);
  const [solution, setSolution] = useState("");
  const [solutionAr, setSolutionAr] = useState("");
  const [completion, setCompletion] = useState<MaintenanceCompletionResult | null>(null);

  // -- the plans pane --------------------------------------------------------
  const [plans, setPlans] = useState<readonly MaintenancePlanRow[] | null>(initialPlans);
  const [plansRefusal, setPlansRefusal] = useState<ApiErrorBody | null>(plansError);
  const [plansLoading, setPlansLoading] = useState(false);
  const [activeOnly, setActiveOnly] = useState(false);
  const [planCreateOpen, setPlanCreateOpen] = useState(false);
  const [planDraft, setPlanDraft] = useState<PlanDraft>({ ...EMPTY_PLAN });
  const [planEditOpen, setPlanEditOpen] = useState(false);
  const [planEditId, setPlanEditId] = useState("");
  const [planEditName, setPlanEditName] = useState("");
  const [planEditNameAr, setPlanEditNameAr] = useState("");
  const [planEditDescription, setPlanEditDescription] = useState("");
  const [planEditDescriptionAr, setPlanEditDescriptionAr] = useState("");
  const [planWorkspace, setPlanWorkspace] = useState<MaintenancePlanRow | null>(null);
  const [tasks, setTasks] = useState<readonly MaintenancePlanTaskRow[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskDialog, setTaskDialog] = useState<"add" | "edit" | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>({ ...EMPTY_TASK });
  const [taskEditId, setTaskEditId] = useState("");
  const [taskDeleteId, setTaskDeleteId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<readonly MaintenancePlanEvaluationRow[] | null>(null);

  // -- the derived pools -------------------------------------------------------
  const assetLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const asset of assets) {
      map.set(asset.id, `${asset.code} · ${localizedName(asset.name, asset.nameAr, locale)}`);
    }
    return map;
  }, [assets, locale]);

  const employeeLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees) {
      if (employee.status !== "ACTIVE") continue;
      map.set(employee.id, localizedName(employee.name, employee.nameAr, locale));
    }
    return map;
  }, [employees, locale]);

  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) {
      map.set(item.id, `${item.sku} · ${localizedName(item.name, item.nameAr, locale)}`);
    }
    return map;
  }, [items, locale]);

  const warehouseLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const warehouse of warehouses) {
      map.set(warehouse.id, localizedName(warehouse.name, warehouse.nameAr, locale));
    }
    return map;
  }, [warehouses, locale]);

  const partnerLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const partner of partners) {
      if (partner.deletedAt !== null) continue;
      if (partner.kind !== "SUPPLIER" && partner.kind !== "BOTH") continue;
      map.set(partner.id, localizedName(partner.name, partner.nameAr, locale));
    }
    return map;
  }, [partners, locale]);

  const meterLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const meter of meters) {
      map.set(
        meter.id,
        `${localizedName(meter.name, meter.nameAr, locale)} (${meter.unit})`,
      );
    }
    return map;
  }, [meters, locale]);

  const stockItems = useMemo(() => items.filter((item) => item.kind === "STOCK"), [items]);
  /** The plans dialog's meter pool — only the selected asset's own meters. */
  const metersForAsset = useMemo(
    () => (planDraft.assetId === "" ? [] : meters.filter((meter) => meter.assetId === planDraft.assetId)),
    [meters, planDraft.assetId],
  );

  const createReady =
    createAssetId !== "" && createProblem.trim().length >= 1 && createProblem.trim().length <= 2000;

  const addLineReady = useMemo(() => {
    if (lineDraft.legType === "LABOR") {
      return (
        lineDraft.employeeId !== "" &&
        QTY_RE.test(lineDraft.hours) &&
        Number(lineDraft.hours) > 0 &&
        (lineDraft.unitRate === "" || QTY_RE.test(lineDraft.unitRate))
      );
    }
    if (lineDraft.legType === "PARTS") {
      return (
        lineDraft.itemId !== "" &&
        lineDraft.warehouseId !== "" &&
        QTY_RE.test(lineDraft.qty) &&
        Number(lineDraft.qty) > 0
      );
    }
    return (
      lineDraft.partnerId !== "" && (lineDraft.amount === "" || MONEY_RE.test(lineDraft.amount))
    );
  }, [lineDraft]);

  const priceReady =
    priceLineId !== "" && QTY_RE.test(priceValue) && Number(priceValue) >= 0;
  const priceIsAmount = useMemo(() => {
    if (workspace === null || priceLineId === "") return false;
    const line = workspace.lines.find((row) => row.id === priceLineId);
    return line?.legType === "EXTERNAL";
  }, [workspace, priceLineId]);

  const stepReady = stepTarget !== null && (stepResultNote === "" || stepResultNote.length <= 2000);
  const completeReady = solution.trim().length >= 1 && solution.trim().length <= 2000;

  const planCreateReady = useMemo(() => {
    if (planDraft.assetId === "" || planDraft.name.trim().length < 1) return false;
    if (planDraft.triggerType === "CALENDAR") {
      if (!INT_RE.test(planDraft.intervalDays) || Number(planDraft.intervalDays) < 1) return false;
      if (planDraft.nextDueDate !== "" && !DATE_RE.test(planDraft.nextDueDate)) return false;
      return true;
    }
    return planDraft.meterId !== "" && QTY_RE.test(planDraft.thresholdDelta) && Number(planDraft.thresholdDelta) > 0;
  }, [planDraft]);

  const planEditReady = planEditName.trim().length >= 1 && planEditName.trim().length <= 200;
  const taskReady =
    taskDraft.title.trim().length >= 1 &&
    taskDraft.title.trim().length <= 300 &&
    (taskDraft.seq === "" || (INT_RE.test(taskDraft.seq) && Number(taskDraft.seq) >= 1));

  // -- the orders list --------------------------------------------------------

  async function loadOrders(): Promise<void> {
    setListLoading(true);
    const params = new URLSearchParams();
    if (statusFilter !== "") params.set("status", statusFilter);
    if (assetFilter !== "") params.set("assetId", assetFilter);
    const query = params.size === 0 ? "" : `?${params.toString()}`;
    const result = await bffFetch<readonly MaintenanceWorkOrderRow[]>(`assets/maintenance/orders${query}`);
    setListLoading(false);
    if (!result.ok) {
      setOrdersRefusal(result.error);
      setOrders(null);
      return;
    }
    setOrdersRefusal(null);
    setOrders(result.data);
  }

  async function createOrder(): Promise<void> {
    if (!createReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("create");
    setError(null);
    const result = await bffFetch<MaintenanceWorkOrderRow>("assets/maintenance/orders", {
      method: "POST",
      body: {
        assetId: createAssetId,
        problem: createProblem.trim(),
        problemAr: createProblemAr.trim() === "" ? null : createProblemAr.trim(),
        priority: createPriority,
        technicianEmployeeId: createTechnicianId === "" ? null : createTechnicianId,
        note: createNote.trim() === "" ? null : createNote.trim(),
        noteAr: createNoteAr.trim() === "" ? null : createNoteAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCreateOpen(false);
    setCreateAssetId("");
    setCreateProblem("");
    setCreateProblemAr("");
    setCreatePriority("MEDIUM");
    setCreateTechnicianId("");
    setCreateNote("");
    setCreateNoteAr("");
    setNotice(formatMessage(d.assetsMaintenanceCreatedToast, { no: result.data.orderNo }));
    await openWorkspace(result.data.id);
    await loadOrders();
  }

  // -- the workspace (three reads composed) ------------------------------------

  async function openWorkspace(id: string): Promise<void> {
    setWorkspaceLoading(true);
    setError(null);
    setCompletion(null);
    const [orderResult, linesResult, stepsResult] = await Promise.all([
      bffFetch<MaintenanceWorkOrderRow>(`assets/maintenance/orders/${id}`),
      bffFetch<readonly MaintenanceCostLineRow[]>(`assets/maintenance/orders/${id}/lines`),
      bffFetch<readonly MaintenanceStepRow[]>(`assets/maintenance/orders/${id}/steps`),
    ]);
    setWorkspaceLoading(false);
    if (!orderResult.ok) {
      setError(localizedCmmsError(d, orderResult.error, orderResult.retryAfterSeconds));
      return;
    }
    setWorkspace({
      order: orderResult.data,
      lines: linesResult.ok ? linesResult.data : [],
      steps: stepsResult.ok ? stepsResult.data : [],
    });
  }

  async function refreshWorkspace(id: string): Promise<void> {
    const [orderResult, linesResult, stepsResult] = await Promise.all([
      bffFetch<MaintenanceWorkOrderRow>(`assets/maintenance/orders/${id}`),
      bffFetch<readonly MaintenanceCostLineRow[]>(`assets/maintenance/orders/${id}/lines`),
      bffFetch<readonly MaintenanceStepRow[]>(`assets/maintenance/orders/${id}/steps`),
    ]);
    if (!orderResult.ok) return;
    const next: WorkspaceState = {
      order: orderResult.data,
      lines: linesResult.ok ? linesResult.data : [],
      steps: stepsResult.ok ? stepsResult.data : [],
    };
    setWorkspace(next);
    setOrders((current) =>
      current === null ? current : current.map((row) => (row.id === next.order.id ? next.order : row)),
    );
  }

  async function transition(verb: "plan" | "start" | "hold" | "resume"): Promise<void> {
    if (workspace === null) return;
    setBusy(verb);
    setError(null);
    const result = await bffFetch<MaintenanceWorkOrderRow>(
      `assets/maintenance/orders/${workspace.order.id}/${verb}`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(
      formatMessage(d.assetsMaintenanceTransitionToast, {
        status: localizedMaintenanceStatus(d, result.data.status),
      }),
    );
    await refreshWorkspace(workspace.order.id);
    await loadOrders();
  }

  async function completeOrder(): Promise<void> {
    if (workspace === null || !completeReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("complete");
    setError(null);
    const result = await bffFetch<MaintenanceCompletionResult>(
      `assets/maintenance/orders/${workspace.order.id}/complete`,
      {
        method: "POST",
        body: {
          solution: solution.trim(),
          solutionAr: solutionAr.trim() === "" ? null : solutionAr.trim(),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setCompleteOpen(false);
    setSolution("");
    setSolutionAr("");
    setCompletion(result.data);
    setNotice(
      formatMessage(d.assetsMaintenanceCompletedToast, { journal: shortId(result.data.journalEntryId) }),
    );
    await refreshWorkspace(workspace.order.id);
    await loadOrders();
  }

  async function addLine(): Promise<void> {
    if (workspace === null || !addLineReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("addLine");
    setError(null);
    const result = await bffFetch<MaintenanceCostLineRow>(
      `assets/maintenance/orders/${workspace.order.id}/lines`,
      {
        method: "POST",
        body: {
          legType: lineDraft.legType,
          employeeId: lineDraft.legType === "LABOR" ? lineDraft.employeeId : undefined,
          hours: lineDraft.legType === "LABOR" ? lineDraft.hours : undefined,
          unitRate:
            lineDraft.legType === "LABOR" && lineDraft.unitRate !== "" ? lineDraft.unitRate : undefined,
          itemId: lineDraft.legType === "PARTS" ? lineDraft.itemId : undefined,
          warehouseId: lineDraft.legType === "PARTS" ? lineDraft.warehouseId : undefined,
          qty: lineDraft.legType === "PARTS" ? lineDraft.qty : undefined,
          partnerId: lineDraft.legType === "EXTERNAL" ? lineDraft.partnerId : undefined,
          amount:
            lineDraft.legType === "EXTERNAL" && lineDraft.amount !== "" ? lineDraft.amount : undefined,
          description: lineDraft.description.trim() === "" ? null : lineDraft.description.trim(),
          descriptionAr: lineDraft.descriptionAr.trim() === "" ? null : lineDraft.descriptionAr.trim(),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setAddLineOpen(false);
    setLineDraft({ ...EMPTY_LINE });
    setNotice(d.assetsMaintenanceLineAddedToast);
    await refreshWorkspace(workspace.order.id);
  }

  async function priceLine(): Promise<void> {
    if (workspace === null || !priceReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("price");
    setError(null);
    const body = priceIsAmount ? { amount: priceValue } : { unitRate: priceValue };
    const result = await bffFetch<MaintenanceCostLineRow>(
      `assets/maintenance/orders/${workspace.order.id}/lines/${priceLineId}`,
      { method: "PATCH", body },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPriceOpen(false);
    setPriceLineId("");
    setPriceValue("");
    setNotice(d.assetsMaintenanceLinePricedToast);
    await refreshWorkspace(workspace.order.id);
  }

  async function removeLine(lineId: string): Promise<void> {
    if (workspace === null) return;
    setBusy("removeLine");
    setError(null);
    const result = await bffFetch<undefined>(
      `assets/maintenance/orders/${workspace.order.id}/lines/${lineId}`,
      { method: "DELETE" },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setRemoveLineId(null);
    setNotice(d.assetsMaintenanceLineRemovedToast);
    await refreshWorkspace(workspace.order.id);
  }

  async function recordStep(): Promise<void> {
    if (workspace === null || stepTarget === null || !stepReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("step");
    setError(null);
    const result = await bffFetch<MaintenanceStepRow>(
      `assets/maintenance/orders/${workspace.order.id}/steps/${stepTarget.id}/result`,
      {
        method: "POST",
        body: {
          result: stepResult,
          resultNote: stepResultNote.trim() === "" ? null : stepResultNote.trim(),
          resultNoteAr: stepResultNoteAr.trim() === "" ? null : stepResultNoteAr.trim(),
        },
      },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setStepResultOpen(false);
    setStepTarget(null);
    setStepResultNote("");
    setStepResultNoteAr("");
    setNotice(d.assetsMaintenanceStepToast);
    await refreshWorkspace(workspace.order.id);
  }

  // -- the plans pane -----------------------------------------------------------

  async function loadPlans(): Promise<void> {
    setPlansLoading(true);
    const query = activeOnly ? "?active=true" : "";
    const result = await bffFetch<readonly MaintenancePlanRow[]>(`assets/plans${query}`);
    setPlansLoading(false);
    if (!result.ok) {
      setPlansRefusal(result.error);
      setPlans(null);
      return;
    }
    setPlansRefusal(null);
    setPlans(result.data);
  }

  async function createPlan(): Promise<void> {
    if (!planCreateReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("planCreate");
    setError(null);
    const result = await bffFetch<MaintenancePlanRow>("assets/plans", {
      method: "POST",
      body: {
        assetId: planDraft.assetId,
        name: planDraft.name.trim(),
        nameAr: planDraft.nameAr.trim() === "" ? null : planDraft.nameAr.trim(),
        description: planDraft.description.trim() === "" ? null : planDraft.description.trim(),
        descriptionAr: planDraft.descriptionAr.trim() === "" ? null : planDraft.descriptionAr.trim(),
        triggerType: planDraft.triggerType,
        intervalDays: planDraft.triggerType === "CALENDAR" ? Number(planDraft.intervalDays) : null,
        nextDueDate: planDraft.triggerType === "CALENDAR" && planDraft.nextDueDate !== "" ? planDraft.nextDueDate : null,
        meterId: planDraft.triggerType === "METER" ? planDraft.meterId : null,
        thresholdDelta: planDraft.triggerType === "METER" ? planDraft.thresholdDelta : null,
        note: planDraft.note.trim() === "" ? null : planDraft.note.trim(),
        noteAr: planDraft.noteAr.trim() === "" ? null : planDraft.noteAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPlanCreateOpen(false);
    setPlanDraft({ ...EMPTY_PLAN });
    setNotice(d.assetsMaintenancePlanCreatedToast);
    await loadPlans();
  }

  async function savePlanEdit(): Promise<void> {
    if (planEditId === "" || !planEditReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("planEdit");
    setError(null);
    const result = await bffFetch<MaintenancePlanRow>(`assets/plans/${planEditId}`, {
      method: "PATCH",
      body: {
        name: planEditName.trim(),
        nameAr: planEditNameAr.trim() === "" ? null : planEditNameAr.trim(),
        description: planEditDescription.trim() === "" ? null : planEditDescription.trim(),
        descriptionAr: planEditDescriptionAr.trim() === "" ? null : planEditDescriptionAr.trim(),
      },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setPlanEditOpen(false);
    setNotice(d.assetsMaintenancePlanSavedToast);
    if (planWorkspace?.id === planEditId) {
      setPlanWorkspace(result.data);
    }
    await loadPlans();
  }

  async function togglePlanActive(plan: MaintenancePlanRow): Promise<void> {
    setBusy(`planToggle:${plan.id}`);
    setError(null);
    const result = await bffFetch<MaintenancePlanRow>(`assets/plans/${plan.id}`, {
      method: "PATCH",
      body: { isActive: !plan.isActive },
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(d.assetsMaintenancePlanSavedToast);
    if (planWorkspace?.id === plan.id) {
      setPlanWorkspace(result.data);
    }
    await loadPlans();
  }

  async function openPlanWorkspace(plan: MaintenancePlanRow): Promise<void> {
    setPlanWorkspace(plan);
    setTasksLoading(true);
    const result = await bffFetch<readonly MaintenancePlanTaskRow[]>(`assets/plans/${plan.id}/tasks`);
    setTasksLoading(false);
    setTasks(result.ok ? result.data : []);
    setEvaluation(null);
  }

  async function refreshTasks(planId: string): Promise<void> {
    const result = await bffFetch<readonly MaintenancePlanTaskRow[]>(`assets/plans/${planId}/tasks`);
    if (result.ok) {
      setTasks(result.data);
    }
  }

  async function saveTask(): Promise<void> {
    if (planWorkspace === null || !taskReady) {
      setError(d.errorsValidation);
      return;
    }
    setBusy("task");
    setError(null);
    const body = {
      ...(taskDialog === "add" && taskDraft.seq !== "" ? { seq: Number(taskDraft.seq) } : {}),
      title: taskDraft.title.trim(),
      titleAr: taskDraft.titleAr.trim() === "" ? null : taskDraft.titleAr.trim(),
      instruction: taskDraft.instruction.trim() === "" ? null : taskDraft.instruction.trim(),
      instructionAr: taskDraft.instructionAr.trim() === "" ? null : taskDraft.instructionAr.trim(),
    };
    const result =
      taskDialog === "add"
        ? await bffFetch<MaintenancePlanTaskRow>(`assets/plans/${planWorkspace.id}/tasks`, {
            method: "POST",
            body,
          })
        : await bffFetch<MaintenancePlanTaskRow>(
            `assets/plans/${planWorkspace.id}/tasks/${taskEditId}`,
            { method: "PATCH", body },
          );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTaskDialog(null);
    setTaskDraft({ ...EMPTY_TASK });
    setNotice(d.assetsMaintenanceTaskSavedToast);
    await refreshTasks(planWorkspace.id);
  }

  async function deleteTask(taskId: string): Promise<void> {
    if (planWorkspace === null) return;
    setBusy("taskDelete");
    setError(null);
    const result = await bffFetch<undefined>(`assets/plans/${planWorkspace.id}/tasks/${taskId}`, {
      method: "DELETE",
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setTaskDeleteId(null);
    setNotice(d.assetsMaintenanceTaskDeletedToast);
    await refreshTasks(planWorkspace.id);
  }

  async function evaluatePlan(): Promise<void> {
    if (planWorkspace === null) return;
    setBusy("evaluate");
    setError(null);
    const result = await bffFetch<MaintenancePlanEvaluationRow>(
      `assets/plans/${planWorkspace.id}/evaluate`,
      { method: "POST", body: {} },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEvaluation([result.data]);
    if (result.data.generated) {
      setNotice(formatMessage(d.assetsMaintenanceGeneratedToast, { no: result.data.orderNo ?? "—" }));
    }
    await loadPlans();
  }

  async function generateNow(): Promise<void> {
    if (planWorkspace === null) return;
    setBusy("generate");
    setError(null);
    const result = await bffFetch<{ orderId: string; orderNo: string }>(
      `assets/plans/${planWorkspace.id}/generate`,
      { method: "POST", body: { force: false } },
    );
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setNotice(formatMessage(d.assetsMaintenanceGeneratedToast, { no: result.data.orderNo }));
    await loadPlans();
  }

  async function evaluateAll(): Promise<void> {
    setBusy("evaluateAll");
    setError(null);
    const result = await bffFetch<readonly MaintenancePlanEvaluationRow[]>("assets/plans/evaluate", {
      method: "POST",
      body: {},
    });
    setBusy(null);
    if (!result.ok) {
      setError(localizedCmmsError(d, result.error, result.retryAfterSeconds));
      return;
    }
    setEvaluation(result.data);
    setNotice(formatMessage(d.assetsMaintenanceEvaluatedAllToast, { count: result.data.length }));
    await loadPlans();
  }

  // -- the orders table -----------------------------------------------------------

  const orderColumns: DataTableColumn<MaintenanceWorkOrderRow>[] = [
    {
      id: "orderNo",
      header: activeLocaleHeader(d.assetsMaintenanceColOrderNo),
      accessor: (row) => row.orderNo,
      render: (row) => monoCell(row.orderNo),
    },
    {
      id: "asset",
      header: activeLocaleHeader(d.assetsMaintenanceColAsset),
      accessor: (row) => assetLabelById.get(row.assetId) ?? shortId(row.assetId),
    },
    {
      id: "problem",
      header: activeLocaleHeader(d.assetsMaintenanceColProblem),
      accessor: (row) => localizedName(row.problem, row.problemAr, locale),
    },
    {
      id: "priority",
      header: activeLocaleHeader(d.assetsMaintenanceColPriority),
      accessor: (row) => localizedMaintenancePriority(d, row.priority),
      render: (row) => <Chip tone={priorityChipTone(row.priority)}>{localizedMaintenancePriority(d, row.priority)}</Chip>,
    },
    {
      id: "status",
      header: activeLocaleHeader(d.assetsMaintenanceColStatus),
      accessor: (row) => localizedMaintenanceStatus(d, row.status),
      render: (row) => <Badge tone="neutral">{localizedMaintenanceStatus(d, row.status)}</Badge>,
    },
    {
      id: "technician",
      header: activeLocaleHeader(d.assetsMaintenanceColTechnician),
      accessor: (row) =>
        row.technicianEmployeeId === null
          ? "—"
          : employeeLabelById.get(row.technicianEmployeeId) ?? shortId(row.technicianEmployeeId),
    },
    {
      id: "createdAt",
      header: activeLocaleHeader(d.assetsMaintenanceColCreatedAt),
      accessor: (row) => row.createdAt,
      render: (row) => monoCell(row.createdAt),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.assetsMaintenanceColActions),
      accessor: () => d.assetsMaintenanceOpen,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => void openWorkspace(row.id)}>
          {d.assetsMaintenanceOpen}
        </Button>
      ),
    },
  ];

  // -- the plans table ------------------------------------------------------------

  const planColumns: DataTableColumn<MaintenancePlanRow>[] = [
    {
      id: "name",
      header: activeLocaleHeader(d.assetsMaintenanceColPlanName),
      accessor: (row) => localizedName(row.name, row.nameAr, locale),
    },
    {
      id: "asset",
      header: activeLocaleHeader(d.assetsMaintenanceColAsset),
      accessor: (row) => assetLabelById.get(row.assetId) ?? shortId(row.assetId),
    },
    {
      id: "trigger",
      header: activeLocaleHeader(d.assetsMaintenanceColTrigger),
      accessor: (row) => localizedMaintenanceTriggerType(d, row.triggerType),
      render: (row) => <Badge tone="neutral">{localizedMaintenanceTriggerType(d, row.triggerType)}</Badge>,
    },
    {
      id: "cadence",
      header: activeLocaleHeader(d.assetsMaintenanceColIntervalDays),
      accessor: (row) =>
        row.triggerType === "CALENDAR"
          ? `${row.intervalDays ?? "—"}`
          : meterLabelById.get(row.meterId ?? "") ?? "—",
      render: (row) =>
        row.triggerType === "CALENDAR" ? (
          monoCell(String(row.intervalDays ?? "—"))
        ) : (
          <span className="flex flex-col">
            <span>{meterLabelById.get(row.meterId ?? "") ?? shortId(row.meterId ?? "—")}</span>
            <span className="text-xs text-gray-600">
              {d.assetsMaintenanceColThreshold}: {monoCell(row.thresholdDelta ?? "—")}
            </span>
          </span>
        ),
    },
    {
      id: "nextDue",
      header: activeLocaleHeader(d.assetsMaintenanceColNextDue),
      accessor: (row) => row.nextDueDate ?? row.lastAnchorValue ?? "—",
      render: (row) =>
        row.triggerType === "CALENDAR"
          ? row.nextDueDate === null
            ? "—"
            : monoCell(row.nextDueDate)
          : row.lastAnchorValue === null
            ? "—"
            : monoCell(row.lastAnchorValue),
    },
    {
      id: "active",
      header: activeLocaleHeader(d.assetsMaintenanceColActive),
      accessor: (row) => (row.isActive ? d.assetsMaintenancePlanActiveBadge : d.assetsMaintenancePlanInactiveBadge),
      render: (row) => (
        <Chip tone={row.isActive ? "success" : "neutral"}>
          {row.isActive ? d.assetsMaintenancePlanActiveBadge : d.assetsMaintenancePlanInactiveBadge}
        </Chip>
      ),
    },
    {
      id: "lastGenerated",
      header: activeLocaleHeader(d.assetsMaintenanceColLastGenerated),
      accessor: (row) => row.lastGeneratedAt ?? "—",
      render: (row) => (row.lastGeneratedAt === null ? "—" : monoCell(row.lastGeneratedAt)),
    },
    {
      id: "actions",
      header: activeLocaleHeader(d.assetsMaintenanceColActions),
      accessor: () => d.assetsMaintenanceOpen,
      render: (row) => (
        <Button variant="secondary" size="sm" onClick={() => void openPlanWorkspace(row)}>
          {d.assetsMaintenanceOpen}
        </Button>
      ),
    },
  ];

  // -- the lines table (the workspace's shared piece) -------------------------------

  function linesTable(lines: readonly MaintenanceCostLineRow[]): JSX.Element {
    return (
      <div className="overflow-x-auto">
        <table aria-label={d.assetsMaintenanceLinesTitle} className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle text-start">
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColLineNo}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColLegType}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColDescription}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColAmount}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColIssuedAt}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColActions}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const subject =
                line.legType === "LABOR"
                  ? `${employeeLabelById.get(line.employeeId ?? "") ?? shortId(line.employeeId ?? "—")} · ${line.hours ?? "—"} ${d.assetsMaintenanceColHours} @ ${line.unitRate ?? "—"}`
                  : line.legType === "PARTS"
                    ? `${itemLabelById.get(line.itemId ?? "") ?? shortId(line.itemId ?? "—")} · ${line.qty ?? "—"} × ${warehouseLabelById.get(line.warehouseId ?? "") ?? ""}`
                    : partnerLabelById.get(line.partnerId ?? "") ?? shortId(line.partnerId ?? "—");
              const canPrice =
                workspace !== null && workspace.order.status !== "COMPLETED" && line.amount === null;
              const canRemove = workspace !== null && workspace.order.status !== "COMPLETED";
              return (
                <tr key={line.id} className="border-b border-subtle/60">
                  <td className="px-2 py-1.5">{monoCell(String(line.lineNo))}</td>
                  <td className="px-2 py-1.5">{localizedMaintenanceLegType(d, line.legType)}</td>
                  <td className="px-2 py-1.5">
                    <span className="flex flex-col">
                      <span>{line.description ?? "—"}</span>
                      <span className="text-xs text-gray-600" dir="auto">
                        {subject}
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {moneyCell(line.amount, d.assetsMaintenanceUnpricedHint, line.legType === "PARTS")}
                    {line.issueUnitCost !== null ? (
                      <span className="ms-1 text-xs text-gray-600" title={d.assetsMaintenanceColIssueUnitCost}>
                        ({monoCell(line.issueUnitCost)})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-1.5">
                    {line.issuedAt === null ? "—" : monoCell(line.issuedAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    {canPrice ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPriceLineId(line.id);
                          setPriceValue("");
                          setPriceOpen(true);
                        }}
                      >
                        {d.assetsMaintenancePriceLine}
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoveLineId(line.id)}
                      >
                        {d.assetsMaintenanceRemoveLine}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // -- the steps table (the checklist entry) ------------------------------------------

  function stepsTable(steps: readonly MaintenanceStepRow[]): JSX.Element {
    const canRecord = workspace !== null && workspace.order.status !== "COMPLETED";
    return (
      <div className="overflow-x-auto">
        <table aria-label={d.assetsMaintenanceStepsTitle} className="w-full text-sm">
          <thead>
            <tr className="border-b border-subtle">
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColSeq}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColStepTitle}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColInstruction}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColResult}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColRecordedAt}</th>
              <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColActions}</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.id} className="border-b border-subtle/60">
                <td className="px-2 py-1.5">{monoCell(String(step.seq))}</td>
                <td className="px-2 py-1.5">{localizedName(step.title, step.titleAr, locale)}</td>
                <td className="px-2 py-1.5 text-xs text-gray-600">
                  {localizedName(step.instruction ?? "—", step.instructionAr, locale)}
                </td>
                <td className="px-2 py-1.5">
                  <Chip
                    tone={
                      step.result === "PASS" ? "success" : step.result === "FAIL" ? "danger" : "warning"
                    }
                  >
                    {localizedMaintenanceStepResult(d, step.result)}
                  </Chip>
                </td>
                <td className="px-2 py-1.5">
                  {step.recordedAt === null ? "—" : monoCell(step.recordedAt)}
                </td>
                <td className="px-2 py-1.5">
                  {canRecord ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setStepTarget(step);
                        setStepResult(step.result ?? "PASS");
                        setStepResultNote(step.resultNote ?? "");
                        setStepResultNoteAr(step.resultNoteAr ?? "");
                        setStepResultOpen(true);
                      }}
                    >
                      {d.assetsMaintenanceRecordResult}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // -- the render ------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      {/* the pane switch — the data-slot shape (no Tabs primitive) */}
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.assetsMaintenanceTitle}>
        <Button
          variant={pane === "orders" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "orders"}
          onClick={() => setPane("orders")}
        >
          {d.assetsMaintenancePaneOrders}
        </Button>
        <Button
          variant={pane === "plans" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "plans"}
          onClick={() => setPane("plans")}
        >
          {d.assetsMaintenancePanePlans}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "orders" ? (
        <>
          <Card
            title={d.assetsMaintenancePaneOrders}
            description={d.assetsMaintenanceSubtitle}
            actions={
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
                {d.assetsMaintenanceCreate}
              </Button>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {d.assetsMaintenanceFilterStatus}
                <select
                  className="rounded-md border border-default bg-surface-card px-3 py-2"
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                  }}
                >
                  <option value="">{d.assetsMaintenanceStatusAll}</option>
                  {STATUS_VALUES.map((status) => (
                    <option key={status} value={status}>
                      {localizedMaintenanceStatus(d, status)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                {d.assetsMaintenanceFilterAsset}
                <select
                  className="rounded-md border border-default bg-surface-card px-3 py-2"
                  value={assetFilter}
                  onChange={(event) => {
                    setAssetFilter(event.target.value);
                  }}
                >
                  <option value="">{d.assetsMaintenanceAssetAll}</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {assetLabelById.get(asset.id) ?? asset.code}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="secondary" onClick={() => void loadOrders()}>
                {d.assetsMaintenanceRefresh}
              </Button>
            </div>
          </Card>

          {listLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {ordersRefusal !== null ? (
            <TypedRefusalPanel
              error={ordersRefusal}
              title={d.assetsMaintenanceRefusalTitle}
              detailsLabel={d.assetsMaintenanceRefusalDetails}
            />
          ) : null}

          {ordersRefusal === null && orders !== null ? (
            orders.length === 0 ? (
              <p className="text-sm text-gray-600">{d.assetsMaintenanceOrdersEmpty}</p>
            ) : (
              <DataTable
                columns={orderColumns}
                rows={[...orders]}
                rowKey={(row) => row.id}
              />
            )
          ) : null}

          {workspaceLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {workspace !== null ? (
            <Card
              title={formatMessage(d.assetsMaintenanceWorkspaceTitle, {
                no: workspace.order.orderNo,
              })}
            >
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={statusChipTone(workspace.order.status)}>
                    {localizedMaintenanceStatus(d, workspace.order.status)}
                  </Chip>
                  <Chip tone={priorityChipTone(workspace.order.priority)}>
                    {localizedMaintenancePriority(d, workspace.order.priority)}
                  </Chip>
                  <span className="text-sm text-gray-600">
                    {assetLabelById.get(workspace.order.assetId) ?? shortId(workspace.order.assetId)}
                  </span>
                  {workspace.order.technicianEmployeeId !== null ? (
                    <span className="text-sm text-gray-600">
                      {d.assetsMaintenanceColTechnician}:{" "}
                      {employeeLabelById.get(workspace.order.technicianEmployeeId) ??
                        shortId(workspace.order.technicianEmployeeId)}
                    </span>
                  ) : null}
                </div>

                <DefList
                  items={[
                    {
                      term: d.assetsMaintenanceColProblem,
                      children: localizedName(workspace.order.problem, workspace.order.problemAr, locale),
                    },
                    ...(workspace.order.solution !== null
                      ? [
                          {
                            term: d.assetsMaintenanceSolution,
                            children: localizedName(
                              workspace.order.solution,
                              workspace.order.solutionAr,
                              locale,
                            ),
                          },
                        ]
                      : []),
                    ...(workspace.order.plannedAt !== null
                      ? [
                          {
                            term: d.assetsMaintenancePlannedAt,
                            children: monoCell(workspace.order.plannedAt),
                          },
                        ]
                      : []),
                    ...(workspace.order.startedAt !== null
                      ? [
                          {
                            term: d.assetsMaintenanceStartedAt,
                            children: monoCell(workspace.order.startedAt),
                          },
                        ]
                      : []),
                    ...(workspace.order.completedAt !== null
                      ? [
                          {
                            term: d.assetsMaintenanceCompletedAt,
                            children: monoCell(workspace.order.completedAt),
                          },
                        ]
                      : []),
                    ...(workspace.order.journalEntryId !== null
                      ? [
                          {
                            term: d.assetsMaintenanceJournalEntry,
                            children: monoCell(workspace.order.journalEntryId),
                          },
                        ]
                      : []),
                  ]}
                />

                {/* THE ENGINE'S OWN TOTALS — rendered verbatim */}
                <Card title={d.assetsMaintenanceEngineTotals}>
                  <DefList
                    items={[
                      {
                        term: d.assetsMaintenanceLaborTotal,
                        children: moneyCell(workspace.order.laborTotal, d.assetsMaintenanceUnpricedHint),
                      },
                      {
                        term: d.assetsMaintenancePartsTotal,
                        children: moneyCell(workspace.order.partsTotal, d.assetsMaintenanceUnpricedHint),
                      },
                      {
                        term: d.assetsMaintenanceExternalTotal,
                        children: moneyCell(workspace.order.externalTotal, d.assetsMaintenanceUnpricedHint),
                      },
                    ]}
                  />
                </Card>

                {/* THE COMPLETION'S OWN RECONCILIATION VERDICT (INV-034) */}
                {completion !== null ? (
                  <Card title={d.assetsMaintenanceInvTitle}>
                    <DefList
                      items={[
                        {
                          term: d.assetsMaintenanceJournalEntry,
                          children: monoCell(completion.journalEntryId),
                        },
                        {
                          term: d.assetsMaintenanceInvSource,
                          children: moneyCell(
                            completion.reconciliation.sourceTotal,
                            d.assetsMaintenanceUnpricedHint,
                          ),
                        },
                        {
                          term: d.assetsMaintenanceInvGlDebit,
                          children: moneyCell(
                            completion.reconciliation.glExpenseDebit,
                            d.assetsMaintenanceUnpricedHint,
                          ),
                        },
                        {
                          term: d.assetsMaintenanceInvDifference,
                          children: monoCell(completion.reconciliation.difference),
                        },
                        {
                          term: d.assetsMaintenanceInvBalanced,
                          children: (
                            <Chip tone={completion.reconciliation.balanced ? "success" : "danger"}>
                              {String(completion.reconciliation.balanced)}
                            </Chip>
                          ),
                        },
                      ]}
                    />
                  </Card>
                ) : null}

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{d.assetsMaintenanceLinesTitle}</h3>
                  {workspace.lines.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.assetsMaintenanceLinesEmpty}</p>
                  ) : (
                    linesTable(workspace.lines)
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold">{d.assetsMaintenanceStepsTitle}</h3>
                  {workspace.steps.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.assetsMaintenanceStepsEmpty}</p>
                  ) : (
                    stepsTable(workspace.steps)
                  )}
                </div>

                {/* the lifecycle bar — the machine's own ladder */}
                <div className="flex flex-wrap gap-2">
                  {workspace.order.status === "REQUESTED" ? (
                    <>
                      <Button
                        variant="primary"
                        loading={busy === "plan"}
                        onClick={() => void transition("plan")}
                      >
                        {d.assetsMaintenanceActionPlan}
                      </Button>
                      <Button variant="secondary" onClick={() => setAddLineOpen(true)}>
                        {d.assetsMaintenanceAddLine}
                      </Button>
                    </>
                  ) : null}
                  {workspace.order.status === "PLANNED" ? (
                    <>
                      <Button
                        variant="primary"
                        loading={busy === "start"}
                        onClick={() => void transition("start")}
                      >
                        {d.assetsMaintenanceActionStart}
                      </Button>
                      <Button variant="secondary" onClick={() => setAddLineOpen(true)}>
                        {d.assetsMaintenanceAddLine}
                      </Button>
                    </>
                  ) : null}
                  {workspace.order.status === "IN_PROGRESS" ? (
                    <>
                      <Button
                        variant="secondary"
                        loading={busy === "hold"}
                        onClick={() => void transition("hold")}
                      >
                        {d.assetsMaintenanceActionHold}
                      </Button>
                      <Button variant="secondary" onClick={() => setAddLineOpen(true)}>
                        {d.assetsMaintenanceAddLine}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => {
                          setSolution(workspace.order.solution ?? "");
                          setSolutionAr(workspace.order.solutionAr ?? "");
                          setCompleteOpen(true);
                        }}
                      >
                        {d.assetsMaintenanceActionComplete}
                      </Button>
                    </>
                  ) : null}
                  {workspace.order.status === "ON_HOLD" ? (
                    <>
                      <Button
                        variant="secondary"
                        loading={busy === "resume"}
                        onClick={() => void transition("resume")}
                      >
                        {d.assetsMaintenanceActionResume}
                      </Button>
                      <Button variant="secondary" onClick={() => setAddLineOpen(true)}>
                        {d.assetsMaintenanceAddLine}
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => {
                          setSolution(workspace.order.solution ?? "");
                          setSolutionAr(workspace.order.solutionAr ?? "");
                          setCompleteOpen(true);
                        }}
                      >
                        {d.assetsMaintenanceActionComplete}
                      </Button>
                    </>
                  ) : null}
                  <Button variant="ghost" onClick={() => setWorkspace(null)}>
                    {d.commonClear}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card
            title={d.assetsMaintenancePanePlans}
            actions={
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => void evaluateAll()} loading={busy === "evaluateAll"}>
                  {d.assetsMaintenanceEvaluateAll}
                </Button>
                <Button variant="primary" size="sm" onClick={() => setPlanCreateOpen(true)}>
                  {d.assetsMaintenancePlanCreate}
                </Button>
              </div>
            }
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {d.assetsMaintenanceColActive}
                <select
                  className="rounded-md border border-default bg-surface-card px-3 py-2"
                  value={activeOnly ? "active" : "all"}
                  onChange={(event) => {
                    setActiveOnly(event.target.value === "active");
                  }}
                >
                  <option value="all">{d.assetsMaintenancePlanAll}</option>
                  <option value="active">{d.assetsMaintenancePlanActiveOnly}</option>
                </select>
              </label>
              <Button variant="secondary" onClick={() => void loadPlans()}>
                {d.assetsMaintenanceRefresh}
              </Button>
            </div>
          </Card>

          {plansLoading ? <p className="text-sm text-gray-600">…</p> : null}

          {plansRefusal !== null ? (
            <TypedRefusalPanel
              error={plansRefusal}
              title={d.assetsMaintenanceRefusalTitle}
              detailsLabel={d.assetsMaintenanceRefusalDetails}
            />
          ) : null}

          {plansRefusal === null && plans !== null ? (
            plans.length === 0 ? (
              <p className="text-sm text-gray-600">{d.assetsMaintenancePlansEmpty}</p>
            ) : (
              <DataTable columns={planColumns} rows={[...plans]} rowKey={(row) => row.id} />
            )
          ) : null}

          {planWorkspace !== null ? (
            <Card title={localizedName(planWorkspace.name, planWorkspace.nameAr, locale)}>
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">{localizedMaintenanceTriggerType(d, planWorkspace.triggerType)}</Badge>
                  <Chip tone={planWorkspace.isActive ? "success" : "neutral"}>
                    {planWorkspace.isActive
                      ? d.assetsMaintenancePlanActiveBadge
                      : d.assetsMaintenancePlanInactiveBadge}
                  </Chip>
                  <span className="text-sm text-gray-600">
                    {assetLabelById.get(planWorkspace.assetId) ?? shortId(planWorkspace.assetId)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPlanEditId(planWorkspace.id);
                      setPlanEditName(planWorkspace.name);
                      setPlanEditNameAr(planWorkspace.nameAr ?? "");
                      setPlanEditDescription(planWorkspace.description ?? "");
                      setPlanEditDescriptionAr(planWorkspace.descriptionAr ?? "");
                      setPlanEditOpen(true);
                    }}
                  >
                    {d.assetsMaintenancePlanEdit}
                  </Button>
                  <Button
                    variant="secondary"
                    loading={busy === `planToggle:${planWorkspace.id}`}
                    onClick={() => void togglePlanActive(planWorkspace)}
                  >
                    {planWorkspace.isActive
                      ? d.assetsMaintenancePlanToggleInactive
                      : d.assetsMaintenancePlanToggleActive}
                  </Button>
                  <Button variant="secondary" loading={busy === "evaluate"} onClick={() => void evaluatePlan()}>
                    {d.assetsMaintenanceEvaluate}
                  </Button>
                  <Button variant="primary" loading={busy === "generate"} onClick={() => void generateNow()}>
                    {d.assetsMaintenanceGenerateNow}
                  </Button>
                  <Button variant="ghost" onClick={() => setPlanWorkspace(null)}>
                    {d.commonClear}
                  </Button>
                </div>

                {evaluation !== null ? (
                  <Card title={d.assetsMaintenanceEvaluationTitle}>
                    {evaluation.length === 0 ? (
                      <p className="text-sm text-gray-600">{d.assetsMaintenancePlansEmpty}</p>
                    ) : (
                      <ul className="flex flex-col gap-2 text-sm">
                        {evaluation.map((row) => (
                          <li
                            key={row.planId}
                            className="flex flex-col gap-1 rounded-md border border-subtle px-3 py-2"
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <Chip tone={row.generated ? "success" : "neutral"}>
                                {row.generated
                                  ? formatMessage(d.assetsMaintenanceEvaluationGenerated, {
                                      no: row.orderNo ?? "—",
                                    })
                                  : `${d.assetsMaintenanceEvaluationSkipped} ${localizedMaintenanceSkipReason(d, row.skipReason ?? "")}`}
                              </Chip>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                ) : null}

                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{d.assetsMaintenanceTasksTitle}</h3>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setTaskDraft({ ...EMPTY_TASK });
                        setTaskDialog("add");
                      }}
                    >
                      {d.assetsMaintenanceTaskAdd}
                    </Button>
                  </div>
                  {tasksLoading ? (
                    <p className="text-sm text-gray-600">…</p>
                  ) : tasks.length === 0 ? (
                    <p className="text-sm text-gray-600">{d.assetsMaintenanceTasksEmpty}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table aria-label={d.assetsMaintenanceTasksTitle} className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-subtle">
                            <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceTaskSeq}</th>
                            <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceTaskTitle}</th>
                            <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceTaskInstruction}</th>
                            <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColActive}</th>
                            <th className="px-2 py-1.5 text-start font-medium">{d.assetsMaintenanceColActions}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tasks.map((task) => (
                            <tr key={task.id} className="border-b border-subtle/60">
                              <td className="px-2 py-1.5">{monoCell(String(task.seq))}</td>
                              <td className="px-2 py-1.5">{localizedName(task.title, task.titleAr, locale)}</td>
                              <td className="px-2 py-1.5 text-xs text-gray-600">
                                {localizedName(task.instruction ?? "—", task.instructionAr, locale)}
                              </td>
                              <td className="px-2 py-1.5">
                                <Chip tone={task.isActive ? "success" : "neutral"}>
                                  {task.isActive
                                    ? d.assetsMaintenancePlanActiveBadge
                                    : d.assetsMaintenancePlanInactiveBadge}
                                </Chip>
                              </td>
                              <td className="px-2 py-1.5">
                                <span className="flex flex-wrap gap-1">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setTaskEditId(task.id);
                                      setTaskDraft({
                                        seq: String(task.seq),
                                        title: task.title,
                                        titleAr: task.titleAr ?? "",
                                        instruction: task.instruction ?? "",
                                        instructionAr: task.instructionAr ?? "",
                                      });
                                      setTaskDialog("edit");
                                    }}
                                  >
                                    {d.assetsMaintenanceTaskEdit}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setTaskDeleteId(task.id)}
                                  >
                                    {d.assetsMaintenanceTaskDelete}
                                  </Button>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : null}
        </>
      )}

      {/* -- the create-order dialog --------------------------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen} title={d.assetsMaintenanceCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsMaintenanceColAsset}
            value={createAssetId}
            onValueChange={setCreateAssetId}
            placeholder="—"
            options={assets.map((asset) => ({
              value: asset.id,
              label: assetLabelById.get(asset.id) ?? asset.code,
            }))}
            required
          />
          <Select
            label={d.assetsMaintenanceColPriority}
            value={createPriority}
            onValueChange={setCreatePriority}
            placeholder="MEDIUM"
            options={PRIORITY_VALUES.map((priority) => ({
              value: priority,
              label: localizedMaintenancePriority(d, priority),
            }))}
          />
          <Select
            label={d.assetsMaintenanceColTechnician}
            value={createTechnicianId}
            onValueChange={setCreateTechnicianId}
            placeholder="—"
            options={[
              { value: "", label: d.assetsMaintenanceTechnicianNone },
              ...[...employeeLabelById.entries()].map(([id, label]) => ({ value: id, label })),
            ]}
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceProblem}
              value={createProblem}
              onValueChange={setCreateProblem}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input label={d.assetsMaintenanceProblemAr} value={createProblemAr} onValueChange={setCreateProblemAr} />
          </div>
          <div className="sm:col-span-2">
            <Input label={d.assetsMaintenanceNote} value={createNote} onValueChange={setCreateNote} />
          </div>
          <div className="sm:col-span-2">
            <Input label={d.assetsMaintenanceNoteAr} value={createNoteAr} onValueChange={setCreateNoteAr} />
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
            onClick={() => void createOrder()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- the add-line dialog (the per-leg XOR shape) ----------------------------- */}
      <Dialog open={addLineOpen} onOpenChange={setAddLineOpen} title={d.assetsMaintenanceAddLineTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsMaintenanceColLegType}
            value={lineDraft.legType}
            onValueChange={(value) =>
              setLineDraft({ ...EMPTY_LINE, legType: value as LineDraft["legType"] })
            }
            placeholder="LABOR"
            options={[
              { value: "LABOR", label: d.assetsMaintenanceLegLabor },
              { value: "PARTS", label: d.assetsMaintenanceLegParts },
              { value: "EXTERNAL", label: d.assetsMaintenanceLegExternal },
            ]}
          />
          {lineDraft.legType === "LABOR" ? (
            <>
              <Select
                label={d.assetsMaintenanceLineEmployee}
                value={lineDraft.employeeId}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, employeeId: value }))}
                placeholder="—"
                options={[...employeeLabelById.entries()].map(([id, label]) => ({ value: id, label }))}
                required
              />
              <Input
                label={d.assetsMaintenanceColHours}
                value={lineDraft.hours}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, hours: value }))}
                inputMode="decimal"
                mono
                required
              />
              <Input
                label={d.assetsMaintenanceColUnitRate}
                value={lineDraft.unitRate}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, unitRate: value }))}
                inputMode="decimal"
                mono
                hint={d.assetsMaintenanceUnpricedHint}
              />
            </>
          ) : null}
          {lineDraft.legType === "PARTS" ? (
            <>
              <Select
                label={d.assetsMaintenanceColItem}
                value={lineDraft.itemId}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, itemId: value }))}
                placeholder="—"
                options={stockItems.map((item) => ({
                  value: item.id,
                  label: itemLabelById.get(item.id) ?? item.sku,
                }))}
                required
              />
              <Select
                label={d.assetsMaintenanceColWarehouse}
                value={lineDraft.warehouseId}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, warehouseId: value }))}
                placeholder="—"
                options={warehouses.map((warehouse) => ({
                  value: warehouse.id,
                  label: warehouseLabelById.get(warehouse.id) ?? warehouse.code,
                }))}
                required
              />
              <Input
                label={d.assetsMaintenanceColQty}
                value={lineDraft.qty}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, qty: value }))}
                inputMode="decimal"
                mono
                required
              />
            </>
          ) : null}
          {lineDraft.legType === "EXTERNAL" ? (
            <>
              <Select
                label={d.assetsMaintenanceColPartner}
                value={lineDraft.partnerId}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, partnerId: value }))}
                placeholder="—"
                options={[...partnerLabelById.entries()].map(([id, label]) => ({ value: id, label }))}
                required
              />
              <Input
                label={d.assetsMaintenanceColAmount}
                value={lineDraft.amount}
                onValueChange={(value) => setLineDraft((prev) => ({ ...prev, amount: value }))}
                inputMode="decimal"
                mono
                hint={d.assetsMaintenanceUnpricedHint}
              />
            </>
          ) : null}
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceColDescription}
              value={lineDraft.description}
              onValueChange={(value) => setLineDraft((prev) => ({ ...prev, description: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={`${d.assetsMaintenanceColDescription} (AR)`}
              value={lineDraft.descriptionAr}
              onValueChange={(value) => setLineDraft((prev) => ({ ...prev, descriptionAr: value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setAddLineOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "addLine"}
            disabled={!addLineReady}
            onClick={() => void addLine()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- the price-line dialog --------------------------------------------------- */}
      <Dialog open={priceOpen} onOpenChange={setPriceOpen} title={d.assetsMaintenancePriceLineTitle}>
        <Input
          label={priceIsAmount ? d.assetsMaintenanceColAmount : d.assetsMaintenanceColUnitRate}
          value={priceValue}
          onValueChange={setPriceValue}
          inputMode="decimal"
          mono
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPriceOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "price"}
            disabled={!priceReady}
            onClick={() => void priceLine()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- the remove-line confirm -------------------------------------------------- */}
      <Dialog
        open={removeLineId !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveLineId(null);
        }}
        title={d.assetsMaintenanceRemoveLineTitle}
      >
        <p className="text-sm text-gray-600">{d.assetsMaintenanceRemoveLineTitle}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRemoveLineId(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "removeLine"}
            onClick={() => removeLineId !== null && void removeLine(removeLineId)}
          >
            {d.assetsMaintenanceRemoveLine}
          </Button>
        </div>
      </Dialog>

      {/* -- the step-result dialog (BR-098's entry surface) ----------------------------- */}
      <Dialog open={stepResultOpen} onOpenChange={setStepResultOpen} title={d.assetsMaintenanceRecordResultTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsMaintenanceColResult}
            value={stepResult}
            onValueChange={setStepResult}
            placeholder="PASS"
            options={[
              { value: "PASS", label: d.assetsMaintenanceResultPass },
              { value: "FAIL", label: d.assetsMaintenanceResultFail },
            ]}
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceResultNote}
              value={stepResultNote}
              onValueChange={setStepResultNote}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={`${d.assetsMaintenanceResultNote} (AR)`}
              value={stepResultNoteAr}
              onValueChange={setStepResultNoteAr}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setStepResultOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "step"}
            disabled={!stepReady}
            onClick={() => void recordStep()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- the complete dialog (the G-59 act's door) ------------------------------------ */}
      <Dialog open={completeOpen} onOpenChange={setCompleteOpen} title={d.assetsMaintenanceCompleteTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceSolution}
              value={solution}
              onValueChange={setSolution}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceSolutionAr}
              value={solutionAr}
              onValueChange={setSolutionAr}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setCompleteOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "complete"}
            disabled={!completeReady}
            onClick={() => void completeOrder()}
          >
            {d.assetsMaintenanceCompleteConfirm}
          </Button>
        </div>
      </Dialog>

      {/* -- the plan create dialog ------------------------------------------------------ */}
      <Dialog open={planCreateOpen} onOpenChange={setPlanCreateOpen} title={d.assetsMaintenancePlanCreateTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={d.assetsMaintenanceColAsset}
            value={planDraft.assetId}
            onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, assetId: value }))}
            placeholder="—"
            options={assets.map((asset) => ({
              value: asset.id,
              label: assetLabelById.get(asset.id) ?? asset.code,
            }))}
            required
          />
          <Select
            label={d.assetsMaintenanceColTrigger}
            value={planDraft.triggerType}
            onValueChange={(value) =>
              setPlanDraft((prev) => ({ ...prev, triggerType: value as PlanDraft["triggerType"] }))
            }
            placeholder="CALENDAR"
            options={[
              { value: "CALENDAR", label: d.assetsMaintenanceTriggerCalendar },
              { value: "METER", label: d.assetsMaintenanceTriggerMeter },
            ]}
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanName}
              value={planDraft.name}
              onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, name: value }))}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanNameAr}
              value={planDraft.nameAr}
              onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, nameAr: value }))}
            />
          </div>
          {planDraft.triggerType === "CALENDAR" ? (
            <>
              <Input
                label={d.assetsMaintenancePlanIntervalDays}
                value={planDraft.intervalDays}
                onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, intervalDays: value }))}
                inputMode="numeric"
                mono
                required
              />
              <Input
                label={d.assetsMaintenancePlanNextDue}
                value={planDraft.nextDueDate}
                onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, nextDueDate: value }))}
                mono
                bidiIsolate
                hint="YYYY-MM-DD"
              />
            </>
          ) : (
            <>
              <Select
                label={d.assetsMaintenancePlanMeter}
                value={planDraft.meterId}
                onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, meterId: value }))}
                placeholder="—"
                hint={d.assetsMaintenancePlanMeterHint}
                options={metersForAsset.map((meter) => ({
                  value: meter.id,
                  label: meterLabelById.get(meter.id) ?? meter.id,
                }))}
                required
              />
              <Input
                label={d.assetsMaintenancePlanThreshold}
                value={planDraft.thresholdDelta}
                onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, thresholdDelta: value }))}
                inputMode="decimal"
                mono
                required
              />
            </>
          )}
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanDescription}
              value={planDraft.description}
              onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, description: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanDescriptionAr}
              value={planDraft.descriptionAr}
              onValueChange={(value) => setPlanDraft((prev) => ({ ...prev, descriptionAr: value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPlanCreateOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "planCreate"}
            disabled={!planCreateReady}
            onClick={() => void createPlan()}
          >
            {d.commonCreate}
          </Button>
        </div>
      </Dialog>

      {/* -- the plan edit dialog -------------------------------------------------------- */}
      <Dialog open={planEditOpen} onOpenChange={setPlanEditOpen} title={d.assetsMaintenancePlanEditTitle}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanName}
              value={planEditName}
              onValueChange={setPlanEditName}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanNameAr}
              value={planEditNameAr}
              onValueChange={setPlanEditNameAr}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanDescription}
              value={planEditDescription}
              onValueChange={setPlanEditDescription}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenancePlanDescriptionAr}
              value={planEditDescriptionAr}
              onValueChange={setPlanEditDescriptionAr}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPlanEditOpen(false)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "planEdit"}
            disabled={!planEditReady}
            onClick={() => void savePlanEdit()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- the task add/edit dialog ------------------------------------------------------ */}
      <Dialog
        open={taskDialog !== null}
        onOpenChange={(open) => {
          if (!open) setTaskDialog(null);
        }}
        title={taskDialog === "add" ? d.assetsMaintenanceTaskAddTitle : d.assetsMaintenanceTaskEditTitle}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={d.assetsMaintenanceTaskSeq}
            value={taskDraft.seq}
            onValueChange={(value) => setTaskDraft((prev) => ({ ...prev, seq: value }))}
            inputMode="numeric"
            mono
          />
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceTaskTitle}
              value={taskDraft.title}
              onValueChange={(value) => setTaskDraft((prev) => ({ ...prev, title: value }))}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceTaskTitleAr}
              value={taskDraft.titleAr}
              onValueChange={(value) => setTaskDraft((prev) => ({ ...prev, titleAr: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceTaskInstruction}
              value={taskDraft.instruction}
              onValueChange={(value) => setTaskDraft((prev) => ({ ...prev, instruction: value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label={d.assetsMaintenanceTaskInstructionAr}
              value={taskDraft.instructionAr}
              onValueChange={(value) => setTaskDraft((prev) => ({ ...prev, instructionAr: value }))}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTaskDialog(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="primary"
            loading={busy === "task"}
            disabled={!taskReady}
            onClick={() => void saveTask()}
          >
            {d.commonSave}
          </Button>
        </div>
      </Dialog>

      {/* -- the task delete confirm --------------------------------------------------------- */}
      <Dialog
        open={taskDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setTaskDeleteId(null);
        }}
        title={d.assetsMaintenanceTaskDeleteTitle}
      >
        <p className="text-sm text-gray-600">{d.assetsMaintenanceTaskDeleteTitle}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setTaskDeleteId(null)}>
            {d.commonCancel}
          </Button>
          <Button
            variant="danger"
            loading={busy === "taskDelete"}
            onClick={() => taskDeleteId !== null && void deleteTask(taskDeleteId)}
          >
            {d.assetsMaintenanceTaskDelete}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
