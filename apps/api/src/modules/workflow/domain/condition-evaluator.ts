import { compareExact } from "../../accounting/application/decimal-strings";
import { WorkflowConditionInvalidError } from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law, 2026-11-27) THE CONDITION
 * EVALUATOR (D-06 — a PURE fold: no clock, no store, no IO; the
 * entry-conditions and the per-step branch conditions share this one
 * evaluator, the 0105 typed-change precedent's single-fold shape).
 *
 * THE DOCUMENT CONTEXT (zero parallel computation — the readers are the
 * modules' own rows + the PHASE-036 findValuesForEntity readers):
 * `{docType, amountBase (the ADR-0009 canonical 4-dp string — never a
 * float), departmentId, customFields (the PHASE-036 typed value store's
 * own shapes keyed by fieldKey), native (the registry-declared native
 * fields)}`. The engine (W-44) assembles the context ONCE per trigger;
 * the evaluator never re-reads anything.
 *
 * THE GROUP SHAPE (the shallow floor the DB pins at
 * ck_workflow_definitions_conditions_shape): a group object is exactly
 * `{"all":[…]}` (short-circuit AND) or `{"any":[…]}` (short-circuit
 * OR); the empty group passes vacuously (the legal default
 * `'{"all":[]}'`). A group with BOTH keys, with extra keys, or with a
 * non-array member is a typed refusal naming the path — FAIL-CLOSED,
 * never a silent pass (a tenant who saves a malformed chain never gets
 * an ungated document).
 *
 * THE OPERANDS (D-06's own three families):
 * - the AMOUNT thresholds on `amountBase` — the compareExact law (the
 *   BR-034 at-limit law: gt/gte/lt/lte compare the canonical 4-dp
 *   strings EXACTLY, +0.01 fails where the at-limit passes; floats are
 *   REFUSED — the no-coercion class, ADR-0009's own law extended to the
 *   condition side);
 * - the DEPARTMENT equality on `departmentId`;
 * - the CUSTOM-FIELD equality/range on `customFields.<fieldKey>` — the
 *   typed value store's own shapes (string | number | boolean | null);
 *   eq/neq on every shape, in on the scalar shapes, between on the
 *   numeric shape (the endpoints inclusive, the 4-dp string law when
 *   both endpoints are strings);
 * - the NATIVE-field operands on `native.<key>` — the registry's own
 *   declared fields, the same operand family.
 *
 * Every malformed condition — unknown field, wrong operand type, bad
 * op, non-object condition — is a WorkflowConditionInvalidError naming
 * the condition BY PATH (the JSON-pointer shape `$.all[2].value`).
 */

/** The closed trigger registry (D-05 — the owner's ruling (ج)): the
 * FOUR exemplar surfaces; widenings are dated additive migrations. */
export const WORKFLOW_TRIGGER_ENTITIES: readonly string[] = Object.freeze([
  "manual_journal",
  "purchase_order",
  "change_order",
  "duty_drawback_claim",
]);

/** The document context the evaluator folds over (assembled ONCE per
 * trigger by the W-44 engine; the custom fields arrive through the
 * PHASE-036 readers keyed by fieldKey — zero parallel computation). */
export interface WorkflowDocumentContext {
  readonly docType: string;
  /** The canonical ADR-0009 4-dp base-currency amount string. */
  readonly amountBase: string;
  readonly departmentId: string | null;
  readonly customFields: Readonly<Record<string, string | number | boolean | null>>;
  /** The registry-declared native fields (the module's own row values). */
  readonly native: Readonly<Record<string, string | number | boolean | null>>;
}

/** The custom-field / native scalar shapes (the typed value store's
 * own — valueText | valueNumber | valueBoolean | null; numbers arrive
 * as the store's numeric or its 19,6 string). */
type Scalar = string | number | boolean | null;

const AMOUNT_OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte"]);
const ALL_OPS: readonly string[] = ["gt", "gte", "lt", "lte", "eq", "neq", "in", "between"];

const CANONICAL_4DP = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Resolve a field reference to its scalar — the three families:
 * `amountBase` · `departmentId` · `customFields.<key>` ·
 * `native.<key>`. Unknown shapes refuse BY PATH (fail-closed). */
function resolveField(
  field: unknown,
  ctx: WorkflowDocumentContext,
  path: string,
): Scalar {
  if (typeof field !== "string" || field.length === 0) {
    throw new WorkflowConditionInvalidError({ path: `${path}.field`, reason: "the field reference must be a non-empty string" });
  }
  if (field === "amountBase") {
    return ctx.amountBase;
  }
  if (field === "departmentId") {
    return ctx.departmentId;
  }
  if (field.startsWith("customFields.")) {
    const key = field.slice("customFields.".length);
    if (key.length === 0) {
      throw new WorkflowConditionInvalidError({ path: `${path}.field`, reason: "customFields.<fieldKey> needs the fieldKey" });
    }
    return ctx.customFields[key] ?? null;
  }
  if (field.startsWith("native.")) {
    const key = field.slice("native.".length);
    if (key.length === 0) {
      throw new WorkflowConditionInvalidError({ path: `${path}.field`, reason: "native.<key> needs the key" });
    }
    return ctx.native[key] ?? null;
  }
  throw new WorkflowConditionInvalidError({
    path: `${path}.field`,
    reason: `unknown field "${field}" — the families are amountBase · departmentId · customFields.<fieldKey> · native.<key>`,
  });
}

/** The numeric comparison on the canonical 4-dp strings (the
 * compareExact law — BR-034's at-limit semantics); non-strings on the
 * amount family REFUSE (the no-coercion class: a float near money is
 * the bug ADR-0009 exists to prevent, extended to the condition side). */
function amountCompare(
  actual: Scalar,
  op: string,
  expected: unknown,
  path: string,
): boolean {
  if (typeof actual !== "string" || !CANONICAL_4DP.test(actual)) {
    throw new WorkflowConditionInvalidError({
      path: path,
      reason: `the amount operand needs the canonical 4-dp string shape (ADR-0009), got ${JSON.stringify(actual)}`,
    });
  }
  if (typeof expected !== "string" || !CANONICAL_4DP.test(expected)) {
    throw new WorkflowConditionInvalidError({
      path: `${path}.value`,
      reason: `the amount threshold needs the canonical 4-dp string shape (ADR-0009), got ${JSON.stringify(expected)} — floats refuse (the no-coercion class)`,
    });
  }
  const order = compareExact(actual, expected);
  switch (op) {
    case "gt":
      return order > 0;
    case "gte":
      return order >= 0;
    case "lt":
      return order < 0;
    case "lte":
      return order <= 0;
    default:
      return false;
  }
}

/** The scalar equality / membership / range family — the typed value
 * store's own shapes; `in` over a scalar array, `between` the inclusive
 * numeric range (the 4-dp string law when both sides are strings). */
function scalarCompare(
  actual: Scalar,
  op: string,
  expected: unknown,
  path: string,
): boolean {
  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "in": {
      if (!Array.isArray(expected) || expected.length === 0 || !expected.every(isScalar)) {
        throw new WorkflowConditionInvalidError({
          path: `${path}.value`,
          reason: "the in operand needs a non-empty array of scalar values (the typed value store's own shapes)",
        });
      }
      return (expected as Scalar[]).includes(actual);
    }
    case "between": {
      if (
        !Array.isArray(expected) ||
        expected.length !== 2 ||
        !isScalar(expected[0]) ||
        !isScalar(expected[1])
      ) {
        throw new WorkflowConditionInvalidError({
          path: `${path}.value`,
          reason: "the between operand needs exactly two scalar endpoints (inclusive)",
        });
      }
      const [low, high] = expected as [Scalar, Scalar];
      // An UNSET value (null) is a legitimate document state, never a
      // coercion: it satisfies no range (the no-fabrication law — null
      // never reads as 0).
      if (actual === null) {
        return false;
      }
      if (typeof actual === "string" && typeof low === "string" && typeof high === "string") {
        return compareExact(actual, low) >= 0 && compareExact(actual, high) <= 0;
      }
      if (typeof actual === "number" && typeof low === "number" && typeof high === "number") {
        return actual >= low && actual <= high;
      }
      throw new WorkflowConditionInvalidError({
        path: `${path}.value`,
        reason: "the between operand needs the numeric shape on both sides (or the canonical 4-dp strings)",
      });
    }
    default:
      return false;
  }
}

/** Evaluate ONE operand condition `{field, op, value}` against the
 * document context. */
function evaluateOperand(
  condition: unknown,
  ctx: WorkflowDocumentContext,
  path: string,
): boolean {
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
  const actual = resolveField(record.field, ctx, path);
  if (AMOUNT_OPS.has(op)) {
    if (record.field !== "amountBase") {
      throw new WorkflowConditionInvalidError({
        path: `${path}.field`,
        reason: `the ${op} op is the amount family's own — it binds amountBase (the compareExact law)`,
      });
    }
    return amountCompare(actual, op, record.value, path);
  }
  return scalarCompare(actual, op, record.value, path);
}

/** Evaluate a condition tree (the group shape) against the document
 * context — the entry conditions and the per-step branch conditions
 * share this ONE fold. FAIL-CLOSED: every malformed shape is the typed
 * refusal naming the condition BY PATH; the empty group passes
 * vacuously (the legal default). Short-circuit: the first deciding
 * operand settles the group (the phase doc §7's own mitigation). */
export function evaluateConditions(
  conditions: unknown,
  ctx: WorkflowDocumentContext,
): boolean {
  return evaluateGroup(conditions, ctx, "$");
}

function evaluateGroup(
  conditions: unknown,
  ctx: WorkflowDocumentContext,
  path: string,
): boolean {
  if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
    throw new WorkflowConditionInvalidError({
      path,
      reason: "a condition group must be an object ({\"all\":[…]} / {\"any\":[…]})",
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
    const verdict = isGroupShape(member)
      ? evaluateGroup(member, ctx, memberPath)
      : evaluateOperand(member, ctx, memberPath);
    if (hasAll && !verdict) {
      return false; // short-circuit AND
    }
    if (!hasAll && verdict) {
      return true; // short-circuit OR
    }
  }
  return hasAll; // AND: every member held; OR: none held
}

/** A member is itself a group when it carries the group keys (the
 * nested-group law: one level of shape-probing, the evaluation decides
 * the rest — the operand objects never carry all/any keys). */
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
