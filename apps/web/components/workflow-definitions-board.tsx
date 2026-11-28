"use client";

/**
 * PHASE-052 (W-48 — T-10, D-14) THE CHAIN EDITOR — the form-first
 * editor with visual ordering, NEVER a free canvas (the phase doc §7's
 * own scope mitigation, recorded at DR-052-02): the definitions
 * register + the create/edit form whose steps carry the ordered
 * ladder's own fields (the three step types ONLY — the W-10 scope
 * note; the four assignee rules; the SLA whole hours; the branch
 * conditions in the D-06 tree's structured face — one group, one
 * combiner, the operand rows). The order is DATA: the up/down buttons
 * rewrite the array, the submit posts the contiguous 1-based ladder.
 *
 * THE MAPPING LAW (D-05): the editor never sends the trigger event —
 * the API derives it from the entity (each doc type's OWN
 * submit-transition status). THE LIFECYCLE LAW: definitions are never
 * deleted — the active flag is the path (deactivation); the trigger
 * binding is immutable after create (a re-bind is a new definition).
 *
 * THE ENGINE-OUTPUT LAW: the typed refusals render with their FULL
 * payloads (the validation fold names the field/condition BY PATH —
 * the editor shows exactly what the fold refused).
 */
import { useState } from "react";
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
import type { ApiErrorBody, WorkflowDefinitionView } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName, workflowDocLabel } from "../lib/messages";
import { Card } from "./card";
import { ErrorNotice, SuccessNotice } from "./notices";
import { activeLocaleHeader } from "./table-header";
import { TypedRefusalPanel } from "./typed-refusal-panel";

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

const TRIGGER_ENTITIES = [
  "manual_journal",
  "purchase_order",
  "change_order",
  "duty_drawback_claim",
] as const;
const STEP_TYPES = ["APPROVAL", "NOTIFICATION", "TASK"] as const;
const ASSIGNEE_RULES = ["ROLE", "USER", "FIELD", "FORMULA"] as const;
const CONDITION_OPS = [
  { value: "gt", labelKey: "workflowCondOpGt" },
  { value: "gte", labelKey: "workflowCondOpGte" },
  { value: "lt", labelKey: "workflowCondOpLt" },
  { value: "lte", labelKey: "workflowCondOpLte" },
  { value: "eq", labelKey: "workflowCondOpEq" },
  { value: "neq", labelKey: "workflowCondOpNeq" },
  { value: "in", labelKey: "workflowCondOpIn" },
  { value: "between", labelKey: "workflowCondOpBetween" },
] as const;
type ConditionOp = (typeof CONDITION_OPS)[number]["value"];

/** One editor condition row (the structured face — the D-06 fold is the
 * ONE validator; the editor serializes to the operand shape). */
type ConditionRow = {
  field: string;
  op: ConditionOp;
  value: string;
};

/** The editor's condition group: one combiner + the operand rows. */
type ConditionGroupForm = {
  combiner: "all" | "any";
  rows: ConditionRow[];
};

function emptyGroup(): ConditionGroupForm {
  return { combiner: "all", rows: [] };
}

function serializeGroup(group: ConditionGroupForm): unknown {
  if (group.rows.length === 0) {
    return { [group.combiner]: [] };
  }
  return {
    [group.combiner]: group.rows.map((row) => {
      let value: unknown = row.value;
      if (row.op === "in" || row.op === "between") {
        value = row.value
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
      }
      return { field: row.field.trim(), op: row.op, value };
    }),
  };
}

function parseGroup(conditions: unknown): ConditionGroupForm {
  if (typeof conditions !== "object" || conditions === null) {
    return emptyGroup();
  }
  const record = conditions as Record<string, unknown>;
  const hasAll = Object.prototype.hasOwnProperty.call(record, "all");
  const members = (hasAll ? record.all : record.any) as unknown[] | undefined;
  if (!Array.isArray(members)) {
    return emptyGroup();
  }
  const rows: ConditionRow[] = [];
  for (const member of members) {
    if (typeof member !== "object" || member === null) {
      continue;
    }
    const operand = member as Record<string, unknown>;
    if (typeof operand.field !== "string" || typeof operand.op !== "string") {
      continue;
    }
    if (!CONDITION_OPS.some((op) => op.value === operand.op)) {
      continue;
    }
    let value = "";
    if (Array.isArray(operand.value)) {
      value = operand.value.map((part) => String(part)).join(", ");
    } else if (operand.value !== null && operand.value !== undefined) {
      value = String(operand.value);
    }
    rows.push({ field: operand.field, op: operand.op as ConditionOp, value });
  }
  return { combiner: hasAll ? "all" : "any", rows };
}

/** One editor step row (the visual ordering's own unit). */
type StepForm = {
  stepType: (typeof STEP_TYPES)[number];
  assigneeRule: (typeof ASSIGNEE_RULES)[number];
  assigneeValue: string;
  slaHours: string;
  name: string;
  nameAr: string;
  conditions: ConditionGroupForm;
};

function emptyStep(order: number): StepForm {
  return {
    stepType: "APPROVAL",
    assigneeRule: "ROLE",
    assigneeValue: "owner",
    slaHours: "",
    name: `Step ${order}`,
    nameAr: `خطوة ${order}`,
    conditions: emptyGroup(),
  };
}

function stepFromView(step: WorkflowDefinitionView["steps"][number]): StepForm {
  return {
    stepType: step.stepType,
    assigneeRule: step.assigneeRule,
    assigneeValue: step.assigneeValue,
    slaHours: step.slaHours === null ? "" : String(step.slaHours),
    name: step.name,
    nameAr: step.nameAr,
    conditions: parseGroup(step.conditions),
  };
}

type EditorState = {
  definitionId: string | null;
  name: string;
  nameAr: string;
  triggerEntity: (typeof TRIGGER_ENTITIES)[number];
  active: boolean;
  conditions: ConditionGroupForm;
  steps: StepForm[];
};

function editorFromView(definition: WorkflowDefinitionView): EditorState {
  return {
    definitionId: definition.id,
    name: definition.name,
    nameAr: definition.nameAr,
    triggerEntity: definition.triggerEntity,
    active: definition.active,
    conditions: parseGroup(definition.conditions),
    steps: definition.steps.map(stepFromView),
  };
}

function freshEditor(): EditorState {
  return {
    definitionId: null,
    name: "",
    nameAr: "",
    triggerEntity: "purchase_order",
    active: true,
    conditions: emptyGroup(),
    steps: [emptyStep(1)],
  };
}

function conditionGroupEditor(
  locale: Locale,
  group: ConditionGroupForm,
  setGroup: (group: ConditionGroupForm) => void,
  keyPrefix: string,
): JSX.Element {
  const d = getDictionary(locale);
  const opLabel = (op: ConditionOp): string => {
    const entry = CONDITION_OPS.find((candidate) => candidate.value === op);
    return entry === undefined ? op : d[entry.labelKey];
  };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-subtle p-3" data-testid={`${keyPrefix}-conditions`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">{d.workflowCondGroupHint}</span>
        <Select
          label={d.workflowCondCombiner}
          value={group.combiner}
          onValueChange={(value) => setGroup({ ...group, combiner: value === "any" ? "any" : "all" })}
          options={[
            { value: "all", label: d.workflowCondAll },
            { value: "any", label: d.workflowCondAny },
          ]}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setGroup({ ...group, rows: [...group.rows, { field: "amountBase", op: "gt", value: "" }] })}
        >
          {d.workflowCondAdd}
        </Button>
      </div>
      {group.rows.map((row, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
          <Input
            label={index === 0 ? d.workflowCondField : ""}
            value={row.field}
            onValueChange={(value) => {
              const rows = [...group.rows];
              rows[index] = { ...row, field: value };
              setGroup({ ...group, rows });
            }}
          />
          <Select
            label={index === 0 ? d.workflowCondOp : ""}
            value={row.op}
            onValueChange={(value) => {
              const rows = [...group.rows];
              rows[index] = { ...row, op: value as ConditionOp };
              setGroup({ ...group, rows });
            }}
            options={CONDITION_OPS.map((op) => ({ value: op.value, label: opLabel(op.value) }))}
          />
          <Input
            label={index === 0 ? d.workflowCondValue : ""}
            value={row.value}
            onValueChange={(value) => {
              const rows = [...group.rows];
              rows[index] = { ...row, value };
              setGroup({ ...group, rows });
            }}
          />
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setGroup({ ...group, rows: group.rows.filter((_, at) => at !== index) })}
            >
              {d.workflowCondRemove}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function WorkflowDefinitionsBoard({
  locale,
  initialDefinitions,
  definitionsError,
}: {
  locale: Locale;
  initialDefinitions: readonly WorkflowDefinitionView[] | null;
  definitionsError: ApiErrorBody | null;
}): JSX.Element {
  const d = getDictionary(locale);
  const { toast } = useToast();

  // -- the pane switch (the data-slot shape — never the Tabs primitive) ----
  const [pane, setPane] = useState<"register" | "edit">("register");

  // -- the shared feedback ---------------------------------------------------
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<ApiErrorBody | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // -- the register pane -------------------------------------------------------
  const [definitions, setDefinitions] = useState<readonly WorkflowDefinitionView[] | null>(
    initialDefinitions,
  );
  const [definitionsRefusal, setDefinitionsRefusal] = useState<ApiErrorBody | null>(definitionsError);
  const [listLoading, setListLoading] = useState(false);

  // -- the editor pane -----------------------------------------------------------
  const [editor, setEditor] = useState<EditorState>(freshEditor());
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  async function loadDefinitions(): Promise<void> {
    setListLoading(true);
    const result = await bffFetch<readonly WorkflowDefinitionView[]>("workflow/definitions");
    setListLoading(false);
    if (!result.ok) {
      setDefinitionsRefusal(result.error);
      setDefinitions(null);
      return;
    }
    setDefinitionsRefusal(null);
    setDefinitions(result.data);
  }

  function openCreate(): void {
    setEditor(freshEditor());
    setError(null);
    setPane("edit");
  }

  function openEdit(definition: WorkflowDefinitionView): void {
    setEditor(editorFromView(definition));
    setError(null);
    setPane("edit");
  }

  function submitReady(): boolean {
    if (editor.name.trim().length === 0 || editor.nameAr.trim().length === 0) {
      return false;
    }
    return editor.steps.every(
      (step) =>
        step.name.trim().length > 0 &&
        step.nameAr.trim().length > 0 &&
        step.assigneeValue.trim().length > 0 &&
        (step.slaHours === "" || /^\d+$/.test(step.slaHours)),
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const body = {
      name: editor.name.trim(),
      nameAr: editor.nameAr.trim(),
      triggerEntity: editor.triggerEntity,
      active: editor.active,
      conditions: serializeGroup(editor.conditions),
      steps: editor.steps.map((step) => ({
        stepType: step.stepType,
        assigneeRule: step.assigneeRule,
        assigneeValue: step.assigneeValue.trim(),
        conditions: serializeGroup(step.conditions),
        slaHours: step.slaHours === "" ? null : Number(step.slaHours),
        name: step.name.trim(),
        nameAr: step.nameAr.trim(),
      })),
    };
    const result =
      editor.definitionId === null
        ? await bffFetch<WorkflowDefinitionView>("workflow/definitions", { method: "POST", body })
        : await bffFetch<WorkflowDefinitionView>(`workflow/definitions/${editor.definitionId}`, {
            method: "PUT",
            body,
          });
    setBusy(false);
    if (!result.ok) {
      setRefusal(result.error);
      setError(null);
      return;
    }
    setRefusal(null);
    setNotice(editor.definitionId === null ? d.workflowEditorCreatedToast : d.workflowEditorUpdatedToast);
    toast({ tone: "success", title: editor.definitionId === null ? d.workflowEditorCreatedToast : d.workflowEditorUpdatedToast });
    setPane("register");
    await loadDefinitions();
  }

  async function submitDeactivate(): Promise<void> {
    if (editor.definitionId === null) {
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: editor.name.trim(),
      nameAr: editor.nameAr.trim(),
      triggerEntity: editor.triggerEntity,
      active: !editor.active,
      conditions: serializeGroup(editor.conditions),
      steps: editor.steps.map((step) => ({
        stepType: step.stepType,
        assigneeRule: step.assigneeRule,
        assigneeValue: step.assigneeValue.trim(),
        conditions: serializeGroup(step.conditions),
        slaHours: step.slaHours === "" ? null : Number(step.slaHours),
        name: step.name.trim(),
        nameAr: step.nameAr.trim(),
      })),
    };
    const result = await bffFetch<WorkflowDefinitionView>(`workflow/definitions/${editor.definitionId}`, {
      method: "PUT",
      body,
    });
    setBusy(false);
    setDeactivateOpen(false);
    if (!result.ok) {
      setRefusal(result.error);
      setError(null);
      return;
    }
    setRefusal(null);
    setEditor({ ...editor, active: !editor.active });
    setNotice(d.workflowEditorUpdatedToast);
    toast({ tone: "success", title: d.workflowEditorUpdatedToast });
    setPane("register");
    await loadDefinitions();
  }

  const columns: DataTableColumn<WorkflowDefinitionView>[] = [
    {
      id: "name",
      header: activeLocaleHeader(d.workflowEditorColName),
      accessor: (row) => localizedName(row.name, row.nameAr, locale),
      render: (row) => <span className="text-sm">{localizedName(row.name, row.nameAr, locale)}</span>,
    },
    {
      id: "trigger",
      header: activeLocaleHeader(d.workflowEditorColTrigger),
      accessor: (row) => `${row.triggerEntity} · ${row.triggerEvent}`,
      render: (row) => (
        <div className="flex flex-col">
          <Chip tone="neutral">{workflowDocLabel(d, row.triggerEntity)}</Chip>
          <span className="mt-1 font-mono text-xs text-gray-500" dir="ltr">
            {row.triggerEvent}
          </span>
        </div>
      ),
    },
    {
      id: "active",
      header: activeLocaleHeader(d.workflowEditorColActive),
      accessor: (row) => (row.active ? "1" : "0"),
      render: (row) =>
        row.active ? <Chip tone="success">{d.workflowEditorColActive}</Chip> : <Chip tone="neutral">—</Chip>,
    },
    {
      id: "steps",
      header: activeLocaleHeader(d.workflowEditorColSteps),
      accessor: (row) => String(row.steps.length),
      numeric: true,
      render: (row) => <span className="font-mono tabular-nums" dir="ltr">{row.steps.length}</span>,
    },
    {
      id: "origin",
      header: activeLocaleHeader(d.workflowEditorColOrigin),
      accessor: (row) => (row.originPolicyId === null ? "manual" : "bridge"),
      render: (row) =>
        row.originPolicyId === null ? (
          <Chip tone="info">{d.workflowEditorOriginManual}</Chip>
        ) : (
          <Chip tone="warning">{d.workflowEditorOriginBridge}</Chip>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={d.workflowSettingsTitle}>
        <Button
          variant={pane === "register" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "register"}
          onClick={() => setPane("register")}
        >
          {d.workflowEditorPaneRegister}
        </Button>
        <Button
          variant={pane === "edit" ? "primary" : "secondary"}
          size="sm"
          aria-current={pane === "edit"}
          onClick={openCreate}
        >
          {d.workflowEditorPaneCreate}
        </Button>
      </div>

      {error !== null ? <ErrorNotice>{error}</ErrorNotice> : null}
      {refusal !== null ? (
        <TypedRefusalPanel
          error={refusal}
          title={d.workflowRefusalTitle}
          detailsLabel={d.workflowRefusalDetails}
        />
      ) : null}
      {notice !== null ? <SuccessNotice>{notice}</SuccessNotice> : null}

      {pane === "register" ? (
        <Card
          title={d.workflowSettingsTitle}
          description={d.workflowSettingsSubtitle}
          actions={
            <Button variant="secondary" size="sm" loading={listLoading} onClick={() => void loadDefinitions()}>
              {d.workflowRefresh}
            </Button>
          }
        >
          {listLoading ? <p className="text-sm text-gray-600">{d.workflowTimelineLoading}</p> : null}
          {definitionsRefusal !== null ? (
            <TypedRefusalPanel
              error={definitionsRefusal}
              title={d.workflowRefusalTitle}
              detailsLabel={d.workflowRefusalDetails}
            />
          ) : null}
          {definitions !== null && definitionsRefusal === null ? (
            definitions.length === 0 ? (
              <p className="text-sm text-gray-600">{d.workflowEditorEmpty}</p>
            ) : (
              <DataTable
                columns={columns}
                rows={[...definitions]}
                rowKey={(row) => row.id}
                rowActions={[
                  {
                    id: "edit",
                    label: d.workflowEditorOpenAct,
                    onSelect: (row) => openEdit(row),
                  },
                ]}
              />
            )
          ) : null}
        </Card>
      ) : (
        <Card
          title={editor.definitionId === null ? d.workflowEditorPaneCreate : d.workflowEditorEditingTitle}
          description={d.workflowEditorConditionsHint}
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={d.workflowEditorNameEn} value={editor.name} onValueChange={(value) => setEditor({ ...editor, name: value })} />
              <Input label={d.workflowEditorNameAr} value={editor.nameAr} onValueChange={(value) => setEditor({ ...editor, nameAr: value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={d.workflowEditorTrigger}
                value={editor.triggerEntity}
                onValueChange={(value) => setEditor({ ...editor, triggerEntity: value as EditorState["triggerEntity"] })}
                options={TRIGGER_ENTITIES.map((entity) => ({ value: entity, label: workflowDocLabel(d, entity) }))}
              />
              <Select
                label={d.workflowEditorActive}
                value={editor.active ? "yes" : "no"}
                onValueChange={(value) => setEditor({ ...editor, active: value === "yes" })}
                options={[
                  { value: "yes", label: d.workflowEditorColActive },
                  { value: "no", label: "—" },
                ]}
              />
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{d.workflowEditorEntryConditions}</p>
              {conditionGroupEditor(locale, editor.conditions, (conditions) => setEditor({ ...editor, conditions }), "entry")}
            </div>

            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">{d.workflowEditorSteps}</p>
              {editor.steps.map((step, index) => (
                <div key={index} className="flex flex-col gap-3 rounded-md border border-subtle p-3" data-testid={`step-${index + 1}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-gray-500" dir="ltr">
                      {index + 1}.
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => {
                        const steps = [...editor.steps];
                        const [moved] = steps.splice(index, 1);
                        steps.splice(index - 1, 0, moved!);
                        setEditor({ ...editor, steps });
                      }}
                    >
                      {d.workflowEditorMoveUp}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === editor.steps.length - 1}
                      onClick={() => {
                        const steps = [...editor.steps];
                        const [moved] = steps.splice(index, 1);
                        steps.splice(index + 1, 0, moved!);
                        setEditor({ ...editor, steps });
                      }}
                    >
                      {d.workflowEditorMoveDown}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={editor.steps.length === 1}
                      onClick={() => setEditor({ ...editor, steps: editor.steps.filter((_, at) => at !== index) })}
                    >
                      {d.workflowEditorRemoveStep}
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label={d.workflowEditorStepNameEn} value={step.name} onValueChange={(value) => {
                      const steps = [...editor.steps];
                      steps[index] = { ...step, name: value };
                      setEditor({ ...editor, steps });
                    }} />
                    <Input label={d.workflowEditorStepNameAr} value={step.nameAr} onValueChange={(value) => {
                      const steps = [...editor.steps];
                      steps[index] = { ...step, nameAr: value };
                      setEditor({ ...editor, steps });
                    }} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Select
                      label={d.workflowEditorStepType}
                      value={step.stepType}
                      onValueChange={(value) => {
                        const steps = [...editor.steps];
                        steps[index] = { ...step, stepType: value as StepForm["stepType"] };
                        setEditor({ ...editor, steps });
                      }}
                      options={STEP_TYPES.map((type) => ({ value: type, label: workflowStepTypeLabelOf(d, type) }))}
                    />
                    <Select
                      label={d.workflowEditorAssigneeRule}
                      value={step.assigneeRule}
                      onValueChange={(value) => {
                        const steps = [...editor.steps];
                        steps[index] = { ...step, assigneeRule: value as StepForm["assigneeRule"] };
                        setEditor({ ...editor, steps });
                      }}
                      options={ASSIGNEE_RULES.map((rule) => ({ value: rule, label: rule }))}
                    />
                    <Input label={d.workflowEditorAssigneeValue} value={step.assigneeValue} onValueChange={(value) => {
                      const steps = [...editor.steps];
                      steps[index] = { ...step, assigneeValue: value };
                      setEditor({ ...editor, steps });
                    }} />
                    <Input label={d.workflowEditorSlaHours} value={step.slaHours} onValueChange={(value) => {
                      const steps = [...editor.steps];
                      steps[index] = { ...step, slaHours: value };
                      setEditor({ ...editor, steps });
                    }} />
                  </div>
                  <p className="text-xs text-gray-500">{d.workflowEditorAssigneeHint}</p>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm">{d.workflowEditorBranchConditions}</p>
                    {conditionGroupEditor(locale, step.conditions, (conditions) => {
                      const steps = [...editor.steps];
                      steps[index] = { ...step, conditions };
                      setEditor({ ...editor, steps });
                    }, `step-${index + 1}`)}
                  </div>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setEditor({ ...editor, steps: [...editor.steps, emptyStep(editor.steps.length + 1)] })}
              >
                {d.workflowEditorAddStep}
              </Button>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="primary" loading={busy} disabled={!submitReady()} onClick={() => void submit()}>
                {editor.definitionId === null ? d.workflowEditorSubmitCreate : d.workflowEditorSubmitUpdate}
              </Button>
              {editor.definitionId !== null ? (
                <Button variant="secondary" onClick={() => setDeactivateOpen(true)}>
                  {d.workflowEditorActive}
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setPane("register")}>
                {d.workflowActCancel}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {deactivateOpen ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDeactivateOpen(false);
            }
          }}
          title={d.workflowEditorActive}
        >
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="primary" loading={busy} onClick={() => void submitDeactivate()}>
              {d.workflowEditorSubmitUpdate}
            </Button>
            <Button variant="ghost" onClick={() => setDeactivateOpen(false)}>
              {d.workflowActCancel}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

function workflowStepTypeLabelOf(
  d: ReturnType<typeof getDictionary>,
  stepType: string,
): string {
  switch (stepType) {
    case "APPROVAL":
      return d.workflowTypeApproval;
    case "NOTIFICATION":
      return d.workflowTypeNotification;
    case "TASK":
      return d.workflowTypeTask;
    default:
      return stepType;
  }
}
