import { WORKFLOW_TRIGGER_ENTITIES, type WorkflowTriggerEntity } from "./condition-evaluator";
import { WorkflowConditionInvalidError, WorkflowInputInvalidError } from "./workflow-errors";

/**
 * PHASE-052 (W-48 — T-10, dated 2026-11-28) THE DEFINITION-INPUT FOLD (a
 * PURE fold: no clock, no store, no IO — the unit-first law): the chain
 * editor's save-time validator. The D-06 evaluator stays the conditions'
 * ONE runtime law (the W-47 alert-rules precedent: the conditions are
 * passed VERBATIM and validated at evaluation time); THIS fold is the
 * same tree's STRUCTURAL face at save time — a tenant who saves a
 * malformed chain gets the typed refusal BEFORE the definition ever
 * gates a document (fail-closed at the editor, never an ungated doc —
 * the D-06 law's own save-time floor).
 *
 * THE MAPPING LAW (D-05): the editor NEVER sends the trigger event —
 * the event is DERIVED from the entity (each doc type's OWN
 * submit-transition status, never a parallel vocabulary); the fold
 * takes the entity alone and returns the derived event.
 *
 * THE STEPS (D-02/D-14): 1…20 ordered steps (the order is data, 1-based
 * contiguous — the form-first editor's visual ordering writes exactly
 * this shape); the three step types ONLY (the W-10 scope note —
 * free-form custom actions OUT); the ROLE/USER/FIELD/FORMULA assignee
 * rule with the value's own DB CHECK shape; the per-step SLA in whole
 * hours ≥ 1 (or null); the branch conditions the same D-06 tree.
 */

/** The editor's step input (the order is the array index — normalized
 * to the contiguous 1-based ladder here). */
export interface DefinitionStepInput {
  readonly stepType: string;
  readonly assigneeRule: string;
  readonly assigneeValue: string;
  readonly conditions: unknown;
  readonly slaHours: number | null;
  readonly name: string;
  readonly nameAr: string;
}

/** The editor's definition input (the trigger event DERIVED, never
 * sent — the mapping law). */
export interface DefinitionInput {
  readonly name: string;
  readonly nameAr: string;
  readonly triggerEntity: string;
  readonly active: boolean;
  readonly conditions: unknown;
  readonly steps: readonly DefinitionStepInput[];
}

/** The normalized write shape (what the store inserts). */
export interface ValidatedDefinition {
  readonly name: string;
  readonly nameAr: string;
  readonly triggerEntity: WorkflowTriggerEntity;
  readonly triggerEvent: "PENDING_APPROVAL" | "SUBMITTED";
  readonly active: boolean;
  readonly conditions: unknown;
  readonly steps: readonly {
    stepOrder: number;
    stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
    assigneeRule: "ROLE" | "USER" | "FIELD" | "FORMULA";
    assigneeValue: string;
    conditions: unknown;
    slaHours: number | null;
    name: string;
    nameAr: string;
  }[];
}

const STEP_TYPES: readonly string[] = ["APPROVAL", "NOTIFICATION", "TASK"];
const ASSIGNEE_RULES: readonly string[] = ["ROLE", "USER", "FIELD", "FORMULA"];
const NAME_RE = /^[^\n\r\t]{1,200}$/;
const ASSIGNEE_VALUE_RE = /^[A-Za-z0-9_.:@ -]{1,200}$/;
const CANONICAL_4DP = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;
const AMOUNT_OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte"]);
const ALL_OPS: readonly string[] = ["gt", "gte", "lt", "lte", "eq", "neq", "in", "between"];
const MAX_STEPS = 20;

function isScalar(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** The field families (the D-06 evaluator's own four — the structural
 * face never invents a fifth). */
function validFieldReference(field: unknown): boolean {
  if (typeof field !== "string" || field.length === 0) {
    return false;
  }
  if (field === "amountBase" || field === "departmentId") {
    return true;
  }
  if (field.startsWith("customFields.")) {
    return field.length > "customFields.".length;
  }
  if (field.startsWith("native.")) {
    return field.length > "native.".length;
  }
  return false;
}

/** Validate ONE operand condition's STRUCTURE (no context — the value
 * laws the shape carries: the amount family's canonical 4-dp strings,
 * the in/between member laws). Names the node BY PATH (the evaluator's
 * own JSON-pointer shape). */
function validateOperandStructure(condition: unknown, path: string): void {
  if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
    throw new WorkflowConditionInvalidError({ path, reason: "an operand condition must be an object" });
  }
  const record = condition as Record<string, unknown>;
  const op = record.op;
  if (typeof op !== "string" || !ALL_OPS.includes(op)) {
    throw new WorkflowConditionInvalidError({
      path: `${path}.op`,
      reason: `unknown op ${JSON.stringify(op)} — the vocabulary is ${ALL_OPS.join(" · ")}`,
    });
  }
  if (!validFieldReference(record.field)) {
    throw new WorkflowConditionInvalidError({
      path: `${path}.field`,
      reason: `the field reference must be one of the families amountBase · departmentId · customFields.<fieldKey> · native.<key>, got ${JSON.stringify(record.field)}`,
    });
  }
  if (AMOUNT_OPS.has(op)) {
    if (record.field !== "amountBase") {
      throw new WorkflowConditionInvalidError({
        path: `${path}.field`,
        reason: `the ${op} op is the amount family's own — it binds amountBase (the compareExact law)`,
      });
    }
    if (typeof record.value !== "string" || !CANONICAL_4DP.test(record.value)) {
      throw new WorkflowConditionInvalidError({
        path: `${path}.value`,
        reason: `the amount threshold needs the canonical 4-dp string shape (ADR-0009), got ${JSON.stringify(record.value)} — floats refuse (the no-coercion class)`,
      });
    }
    return;
  }
  if (op === "in") {
    if (!Array.isArray(record.value) || record.value.length === 0 || !record.value.every(isScalar)) {
      throw new WorkflowConditionInvalidError({
        path: `${path}.value`,
        reason: "the in operand needs a non-empty array of scalar values (the typed value store's own shapes)",
      });
    }
    return;
  }
  if (op === "between") {
    if (
      !Array.isArray(record.value) ||
      record.value.length !== 2 ||
      !isScalar(record.value[0]) ||
      !isScalar(record.value[1])
    ) {
      throw new WorkflowConditionInvalidError({
        path: `${path}.value`,
        reason: "the between operand needs exactly two scalar endpoints (inclusive)",
      });
    }
    return;
  }
  // eq/neq — any scalar (the typed value store's own shapes; a missing
  // key reads as undefined and refuses: the editor sends explicit
  // values only).
  if (!isScalar(record.value)) {
    throw new WorkflowConditionInvalidError({
      path: `${path}.value`,
      reason: "the comparison operand needs a scalar value (string | number | boolean | null)",
    });
  }
}

function isGroupShape(member: unknown): boolean {
  if (typeof member !== "object" || member === null || Array.isArray(member)) {
    return false;
  }
  const record = member as Record<string, unknown>;
  return (
    Object.prototype.hasOwnProperty.call(record, "all") ||
    Object.prototype.hasOwnProperty.call(record, "any")
  );
}

/** Validate a condition tree's STRUCTURE (the group shape — exactly one
 * of all/any, no other keys, array members; the empty group is the
 * legal vacuous default). The D-06 runtime fold stays the ONE
 * evaluator; this is its save-time structural face. */
export function validateConditionTree(conditions: unknown): void {
  validateGroup(conditions, "$");
}

function validateGroup(conditions: unknown, path: string): void {
  if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
    throw new WorkflowConditionInvalidError({
      path,
      reason: 'a condition group must be an object ({"all":[…]} / {"any":[…]})',
    });
  }
  const record = conditions as Record<string, unknown>;
  const hasAll = Object.prototype.hasOwnProperty.call(record, "all");
  const hasAny = Object.prototype.hasOwnProperty.call(record, "any");
  if (hasAll === hasAny) {
    throw new WorkflowConditionInvalidError({
      path,
      reason: "a condition group carries exactly ONE of the keys: all (AND) or any (OR)",
    });
  }
  const unknownKeys = Object.keys(record).filter((key) => key !== "all" && key !== "any");
  if (unknownKeys.length > 0) {
    throw new WorkflowConditionInvalidError({
      path,
      reason: `a condition group carries no other keys (unknown: ${unknownKeys.map((key) => `"${key}"`).join(", ")})`,
    });
  }
  const members = hasAll ? record.all : record.any;
  if (!Array.isArray(members)) {
    throw new WorkflowConditionInvalidError({
      path: hasAll ? `${path}.all` : `${path}.any`,
      reason: "the group's member list must be an array",
    });
  }
  for (let index = 0; index < members.length; index += 1) {
    const memberPath = `${path}.${hasAll ? "all" : "any"}[${index}]`;
    const member = members[index];
    if (isGroupShape(member)) {
      validateGroup(member, memberPath);
    } else {
      validateOperandStructure(member, memberPath);
    }
  }
}

/** THE FOLD: validate the editor's definition input → the normalized
 * write shape (the trigger event DERIVED per the mapping law; the
 * steps' 1-based contiguous ladder from the array order). Every
 * malformed input is the typed refusal naming the field — fail-closed
 * at the editor, never an ungated document. */
export function validateWorkflowDefinitionInput(
  input: DefinitionInput,
  deriveEvent: (entity: WorkflowTriggerEntity) => "PENDING_APPROVAL" | "SUBMITTED",
): ValidatedDefinition {
  if (typeof input.name !== "string" || !NAME_RE.test(input.name)) {
    throw new WorkflowInputInvalidError({
      field: "name",
      reason: "the definition's English name is required (1–200 characters, no line breaks)",
    });
  }
  if (typeof input.nameAr !== "string" || !NAME_RE.test(input.nameAr)) {
    throw new WorkflowInputInvalidError({
      field: "nameAr",
      reason: "the definition's Arabic name is required (1–200 characters, no line breaks)",
    });
  }
  if (
    typeof input.triggerEntity !== "string" ||
    !WORKFLOW_TRIGGER_ENTITIES.includes(input.triggerEntity as WorkflowTriggerEntity)
  ) {
    throw new WorkflowInputInvalidError({
      field: "triggerEntity",
      reason: `the trigger entity must be one of the bound registry (the owner's ruling (ج): ${WORKFLOW_TRIGGER_ENTITIES.join(" · ")})`,
    });
  }
  const triggerEntity = input.triggerEntity as WorkflowTriggerEntity;
  if (typeof input.active !== "boolean") {
    throw new WorkflowInputInvalidError({
      field: "active",
      reason: "the active flag is a boolean (deactivation is the path — definitions are never deleted)",
    });
  }
  validateConditionTree(input.conditions);
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new WorkflowInputInvalidError({
      field: "steps",
      reason: "a chain carries at least one step (the empty chain is the inactive flag, never a zero-step definition)",
    });
  }
  if (input.steps.length > MAX_STEPS) {
    throw new WorkflowInputInvalidError({
      field: "steps",
      reason: `a chain carries at most ${MAX_STEPS} steps (the form-first editor's own bound)`,
    });
  }
  const steps = input.steps.map((step, index) => {
    const at = `steps[${index}]`;
    if (typeof step !== "object" || step === null) {
      throw new WorkflowInputInvalidError({ field: at, reason: "a step must be an object" });
    }
    if (!STEP_TYPES.includes(step.stepType)) {
      throw new WorkflowInputInvalidError({
        field: `${at}.stepType`,
        reason: `the step type must be one of APPROVAL · NOTIFICATION · TASK (the W-10 scope note — free-form custom actions are OUT)`,
      });
    }
    if (!ASSIGNEE_RULES.includes(step.assigneeRule)) {
      throw new WorkflowInputInvalidError({
        field: `${at}.assigneeRule`,
        reason: "the assignee rule must be one of ROLE · USER · FIELD · FORMULA",
      });
    }
    if (typeof step.assigneeValue !== "string" || !ASSIGNEE_VALUE_RE.test(step.assigneeValue)) {
      throw new WorkflowInputInvalidError({
        field: `${at}.assigneeValue`,
        reason: "the assignee value is required (1–200 characters; the ROLE rule carries the role key, the USER rule the user id)",
      });
    }
    if (step.slaHours !== null) {
      if (typeof step.slaHours !== "number" || !Number.isInteger(step.slaHours) || step.slaHours < 1) {
        throw new WorkflowInputInvalidError({
          field: `${at}.slaHours`,
          reason: "the per-step SLA is whole hours ≥ 1 (or empty — the escalation sweep's own clock substrate)",
        });
      }
    }
    if (typeof step.name !== "string" || !NAME_RE.test(step.name)) {
      throw new WorkflowInputInvalidError({
        field: `${at}.name`,
        reason: "the step's English label is required (1–200 characters, no line breaks)",
      });
    }
    if (typeof step.nameAr !== "string" || !NAME_RE.test(step.nameAr)) {
      throw new WorkflowInputInvalidError({
        field: `${at}.nameAr`,
        reason: "the step's Arabic label is required (1–200 characters, no line breaks)",
      });
    }
    validateConditionTree(step.conditions);
    return {
      stepOrder: index + 1,
      stepType: step.stepType as "APPROVAL" | "NOTIFICATION" | "TASK",
      assigneeRule: step.assigneeRule as "ROLE" | "USER" | "FIELD" | "FORMULA",
      assigneeValue: step.assigneeValue,
      conditions: step.conditions,
      slaHours: step.slaHours,
      name: step.name,
      nameAr: step.nameAr,
    };
  });
  return {
    name: input.name,
    nameAr: input.nameAr,
    triggerEntity,
    triggerEvent: deriveEvent(triggerEntity),
    active: input.active,
    conditions: input.conditions,
    steps,
  };
}
