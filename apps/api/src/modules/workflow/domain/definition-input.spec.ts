import { describe, expect, it } from "vitest";

import { validateConditionTree, validateWorkflowDefinitionInput } from "./definition-input";
import type { DefinitionInput } from "./definition-input";
import { WorkflowConditionInvalidError, WorkflowInputInvalidError } from "./workflow-errors";

/**
 * PHASE-052 (W-48 — T-10, the unit-first law) THE DEFINITION-INPUT
 * FOLD'S OWN TESTS: the save-time validator proven BEFORE the editor
 * renders it — the mapping law (the event DERIVED, never sent), the
 * structural condition walk (the D-06 tree's own laws, naming BY
 * PATH), the step ladder's floors (the three types ONLY, the four
 * assignee rules, the SLA law, the 1-based contiguous order), and the
 * fail-closed law (every malformed input the typed refusal).
 */

const deriveEvent = (entity: "manual_journal" | "purchase_order" | "change_order" | "duty_drawback_claim") =>
  entity === "manual_journal" || entity === "purchase_order" ? ("PENDING_APPROVAL" as const) : ("SUBMITTED" as const);

function step(overrides: Partial<DefinitionInput["steps"][number]> = {}): DefinitionInput["steps"][number] {
  return {
    stepType: "APPROVAL",
    assigneeRule: "ROLE",
    assigneeValue: "owner",
    conditions: { all: [] },
    slaHours: null,
    name: "Manager approval",
    nameAr: "موافقة المدير",
    ...overrides,
  };
}

function definition(overrides: Partial<DefinitionInput> = {}): DefinitionInput {
  return {
    name: "PO chain",
    nameAr: "سلسلة أوامر الشراء",
    triggerEntity: "purchase_order",
    active: true,
    conditions: { all: [] },
    steps: [step()],
    ...overrides,
  };
}

describe("the mapping law (D-05 — the event DERIVED, never sent)", () => {
  it("journals and POs bind PENDING_APPROVAL; the change orders and the drawback claims bind SUBMITTED", () => {
    expect(validateWorkflowDefinitionInput(definition({ triggerEntity: "manual_journal" }), deriveEvent).triggerEvent).toBe("PENDING_APPROVAL");
    expect(validateWorkflowDefinitionInput(definition({ triggerEntity: "purchase_order" }), deriveEvent).triggerEvent).toBe("PENDING_APPROVAL");
    expect(validateWorkflowDefinitionInput(definition({ triggerEntity: "change_order" }), deriveEvent).triggerEvent).toBe("SUBMITTED");
    expect(validateWorkflowDefinitionInput(definition({ triggerEntity: "duty_drawback_claim" }), deriveEvent).triggerEvent).toBe("SUBMITTED");
  });

  it("an entity outside the ruled registry is the typed refusal (the out-of-scope prohibition)", () => {
    expect(() =>
      validateWorkflowDefinitionInput(definition({ triggerEntity: "sales_invoice" }), deriveEvent),
    ).toThrowError(WorkflowInputInvalidError);
  });
});

describe("the step ladder's floors", () => {
  it("the array order normalizes to the contiguous 1-based ladder", () => {
    const out = validateWorkflowDefinitionInput(
      definition({ steps: [step(), step({ name: "Finance", nameAr: "المالية" }), step({ name: "CEO", nameAr: "الرئيس" })] }),
      deriveEvent,
    );
    expect(out.steps.map((s) => s.stepOrder)).toEqual([1, 2, 3]);
  });

  it("the three step types ONLY (the W-10 scope note) — a fourth is the typed refusal", () => {
    expect(() =>
      validateWorkflowDefinitionInput(definition({ steps: [step({ stepType: "CUSTOM_ACTION" })] }), deriveEvent),
    ).toThrowError(/APPROVAL · NOTIFICATION · TASK/);
  });

  it("the four assignee rules; the value's own shape floor", () => {
    expect(() =>
      validateWorkflowDefinitionInput(definition({ steps: [step({ assigneeRule: "TEAM" })] }), deriveEvent),
    ).toThrowError(WorkflowInputInvalidError);
    expect(() =>
      validateWorkflowDefinitionInput(definition({ steps: [step({ assigneeValue: "" })] }), deriveEvent),
    ).toThrowError(WorkflowInputInvalidError);
  });

  it("the SLA is whole hours ≥ 1 or empty", () => {
    expect(() => validateWorkflowDefinitionInput(definition({ steps: [step({ slaHours: 0 })] }), deriveEvent)).toThrowError(WorkflowInputInvalidError);
    expect(() => validateWorkflowDefinitionInput(definition({ steps: [step({ slaHours: 1.5 })] }), deriveEvent)).toThrowError(WorkflowInputInvalidError);
    expect(() => validateWorkflowDefinitionInput(definition({ steps: [step({ slaHours: 48 })] }), deriveEvent)).not.toThrow();
  });

  it("an empty steps array is the typed refusal (the empty chain is the inactive flag)", () => {
    expect(() => validateWorkflowDefinitionInput(definition({ steps: [] }), deriveEvent)).toThrowError(WorkflowInputInvalidError);
  });

  it("more than 20 steps is the typed refusal (the editor's own bound)", () => {
    const many = Array.from({ length: 21 }, (_, index) => step({ name: `S${index}`, nameAr: `خ${index}` }));
    expect(() => validateWorkflowDefinitionInput(definition({ steps: many }), deriveEvent)).toThrowError(WorkflowInputInvalidError);
  });
});

describe("the structural condition walk (the D-06 tree's save-time face)", () => {
  it("the empty group passes (the legal vacuous default)", () => {
    expect(() => validateConditionTree({ all: [] })).not.toThrow();
    expect(() => validateConditionTree({ any: [] })).not.toThrow();
  });

  it("a well-formed amount threshold passes and a float value refuses (the no-coercion class)", () => {
    expect(() => validateConditionTree({ all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] })).not.toThrow();
    expect(() => validateConditionTree({ all: [{ field: "amountBase", op: "gt", value: 50000 }] })).toThrowError(WorkflowConditionInvalidError);
    expect(() => validateConditionTree({ all: [{ field: "amountBase", op: "gt", value: "50,000" }] })).toThrowError(WorkflowConditionInvalidError);
  });

  it("the amount ops bind amountBase ONLY (the compareExact law)", () => {
    expect(() =>
      validateConditionTree({ all: [{ field: "native.cost", op: "gt", value: "1.0000" }] }),
    ).toThrowError(/amount family's own/);
  });

  it("the group carries exactly ONE of all/any — both keys or foreign keys refuse BY PATH", () => {
    expect(() => validateConditionTree({ all: [], any: [] })).toThrowError(WorkflowConditionInvalidError);
    let caught: WorkflowConditionInvalidError | undefined;
    try {
      validateConditionTree({ all: [], extra: 1 });
    } catch (error) {
      caught = error as WorkflowConditionInvalidError;
    }
    expect(caught).toBeInstanceOf(WorkflowConditionInvalidError);
    expect(caught?.details?.path).toBe("$");
  });

  it("the unknown op refuses naming the condition BY PATH (the JSON-pointer shape)", () => {
    let caught: WorkflowConditionInvalidError | undefined;
    try {
      validateConditionTree({ all: [{ field: "departmentId", op: "contains", value: "x" }] });
    } catch (error) {
      caught = error as WorkflowConditionInvalidError;
    }
    expect(caught).toBeInstanceOf(WorkflowConditionInvalidError);
    expect(caught?.details?.path).toBe("$.all[0].op");
  });

  it("the nested group walks with the member path", () => {
    let caught: WorkflowConditionInvalidError | undefined;
    try {
      validateConditionTree({
        any: [
          { all: [{ field: "amountBase", op: "lte", value: "1000.0000" }] },
          { field: "customFields.", op: "eq", value: "HIGH" },
        ],
      });
    } catch (error) {
      caught = error as WorkflowConditionInvalidError;
    }
    expect(caught).toBeInstanceOf(WorkflowConditionInvalidError);
    expect(caught?.details?.path).toBe("$.any[1].field");
  });

  it("the in/between member laws (the typed value store's own shapes)", () => {
    expect(() => validateConditionTree({ all: [{ field: "departmentId", op: "in", value: ["a", "b"] }] })).not.toThrow();
    expect(() => validateConditionTree({ all: [{ field: "departmentId", op: "in", value: [] }] })).toThrowError(WorkflowConditionInvalidError);
    expect(() => validateConditionTree({ all: [{ field: "customFields.count", op: "between", value: [1, 5] }] })).not.toThrow();
    expect(() => validateConditionTree({ all: [{ field: "customFields.count", op: "between", value: [1] }] })).toThrowError(WorkflowConditionInvalidError);
  });

  it("the per-step branch conditions ride the same walk (a malformed step condition refuses at save)", () => {
    expect(() =>
      validateWorkflowDefinitionInput(
        definition({ steps: [step({ conditions: { all: [{ field: "amountBase", op: "gt", value: "x" }] } })] }),
        deriveEvent,
      ),
    ).toThrowError(WorkflowConditionInvalidError);
  });
});

describe("the definition's own floors", () => {
  it("the bilingual names are required (the AR-first law)", () => {
    expect(() => validateWorkflowDefinitionInput(definition({ name: "" }), deriveEvent)).toThrowError(WorkflowInputInvalidError);
    expect(() => validateWorkflowDefinitionInput(definition({ nameAr: "" }), deriveEvent)).toThrowError(WorkflowInputInvalidError);
  });

  it("the entry conditions ride the same walk", () => {
    expect(() =>
      validateWorkflowDefinitionInput(definition({ conditions: { all: [{ field: "unknown", op: "eq", value: 1 }] } }), deriveEvent),
    ).toThrowError(WorkflowConditionInvalidError);
  });
});
