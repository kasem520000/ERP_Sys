import { describe, expect, it } from "vitest";

import {
  WORKFLOW_TRIGGER_ENTITIES,
  evaluateConditions,
  type WorkflowDocumentContext,
} from "./condition-evaluator";
import { WorkflowConditionInvalidError } from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law) THE CONDITION EVALUATOR'S
 * PROPERTY TESTS (the lc-sweep-math precedent: the pure layer proven
 * BEFORE the engine renders it — D-06's every law: the group shapes,
 * the short-circuit AND/OR, the compareExact amount law, the
 * department equality, the custom-field shapes, and THE FAIL-CLOSED
 * LAW — every malformed condition a typed refusal naming the path,
 * never a silent pass).
 */

const ctx = (overrides: Partial<WorkflowDocumentContext> = {}): WorkflowDocumentContext => ({
  docType: "purchase_order",
  amountBase: "50000.0000",
  departmentId: "dept-finance",
  customFields: { priority: "HIGH", unitPrice: "12.5000", count: 3, verified: true },
  native: { warehouse: "WH-1", supplierTier: "A" },
  ...overrides,
});

describe("the closed trigger registry (D-05 — the ruling (ج))", () => {
  it("exactly the FOUR exemplar surfaces, frozen", () => {
    expect(WORKFLOW_TRIGGER_ENTITIES).toEqual([
      "manual_journal",
      "purchase_order",
      "change_order",
      "duty_drawback_claim",
    ]);
  });
});

describe("the group shapes", () => {
  it("the legal default passes vacuously", () => {
    expect(evaluateConditions({ all: [] }, ctx())).toBe(true);
    expect(evaluateConditions({ any: [] }, ctx())).toBe(false);
  });

  it("the short-circuit AND: the first failing member settles the group", () => {
    expect(
      evaluateConditions(
        { all: [{ field: "amountBase", op: "gte", value: "1.0000" }, { field: "departmentId", op: "eq", value: "dept-other" }] },
        ctx(),
      ),
    ).toBe(false);
    expect(
      evaluateConditions(
        { all: [{ field: "amountBase", op: "gte", value: "1.0000" }, { field: "departmentId", op: "eq", value: "dept-finance" }] },
        ctx(),
      ),
    ).toBe(true);
  });

  it("the short-circuit OR: the first passing member settles the group", () => {
    expect(
      evaluateConditions(
        { any: [{ field: "departmentId", op: "eq", value: "dept-finance" }, { field: "amountBase", op: "lt", value: "1.0000" }] },
        ctx(),
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        { any: [{ field: "departmentId", op: "eq", value: "dept-other" }, { field: "amountBase", op: "lt", value: "1.0000" }] },
        ctx(),
      ),
    ).toBe(false);
  });

  it("the nested groups compose", () => {
    expect(
      evaluateConditions(
        {
          all: [
            { any: [{ field: "departmentId", op: "eq", value: "dept-finance" }, { field: "departmentId", op: "eq", value: "dept-proc" }] },
            { field: "amountBase", op: "gt", value: "10000.0000" },
          ],
        },
        ctx(),
      ),
    ).toBe(true);
  });

  it("BOTH keys refuse BY PATH; extra keys refuse; non-array members refuse", () => {
    expect(() => evaluateConditions({ all: [], any: [] }, ctx())).toThrow(WorkflowConditionInvalidError);
    expect(() => evaluateConditions({ all: [] , extra: 1 }, ctx())).toThrow(/no other keys/);
    expect(() => evaluateConditions({ all: "nope" }, ctx())).toThrow(WorkflowConditionInvalidError);
    expect(() => evaluateConditions([1, 2], ctx())).toThrow(WorkflowConditionInvalidError);
    expect(() => evaluateConditions("nope", ctx())).toThrow(WorkflowConditionInvalidError);
    expect(() => evaluateConditions(null, ctx())).toThrow(WorkflowConditionInvalidError);
  });
});

describe("THE COMPAREEXACT AMOUNT LAW (the BR-034 at-limit law)", () => {
  it("the at-limit passes; +0.01 fails — the exact 4-dp comparison", () => {
    const at = (op: string, value: string) =>
      evaluateConditions({ all: [{ field: "amountBase", op, value }] }, ctx({ amountBase: "50000.0000" }));
    expect(at("gte", "50000.0000")).toBe(true);
    expect(at("gt", "50000.0000")).toBe(false);
    expect(at("gt", "49999.9900")).toBe(true);
    expect(at("lte", "50000.0000")).toBe(true);
    expect(at("lt", "50000.0000")).toBe(false);
    expect(at("lt", "50000.0100")).toBe(true);
  });

  it("THE EXEMPLAR SCENARIO (the acceptance #2 fold): > 50,000 routes the long chain, ≤ 50,000 stops at the manager", () => {
    const aboveThreshold = evaluateConditions(
      { all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] },
      ctx({ amountBase: "50000.0100" }),
    );
    const atThreshold = evaluateConditions(
      { all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] },
      ctx({ amountBase: "50000.0000" }),
    );
    const belowThreshold = evaluateConditions(
      { all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] },
      ctx({ amountBase: "49999.9900" }),
    );
    expect(aboveThreshold).toBe(true);
    expect(atThreshold).toBe(false);
    expect(belowThreshold).toBe(false);
  });

  it("THE NO-COERCION CLASS: floats refuse (never a silent Number cast near money)", () => {
    expect(() =>
      evaluateConditions({ all: [{ field: "amountBase", op: "gt", value: 50000 }] }, ctx()),
    ).toThrow(/floats refuse/);
    expect(() =>
      evaluateConditions({ all: [{ field: "amountBase", op: "gt", value: "50,000.00" }] }, ctx()),
    ).toThrow(WorkflowConditionInvalidError);
    expect(() =>
      evaluateConditions({ all: [{ field: "amountBase", op: "gt", value: "50000.00001" }] }, ctx()),
    ).toThrow(WorkflowConditionInvalidError);
  });

  it("the amount ops bind amountBase ONLY — a wrong field refuses BY PATH", () => {
    expect(() =>
      evaluateConditions({ all: [{ field: "departmentId", op: "gt", value: "1.0000" }] }, ctx()),
    ).toThrow(/the amount family's own/);
  });

  it("the malformed amount context refuses (the context itself must be canonical)", () => {
    expect(() =>
      evaluateConditions(
        { all: [{ field: "amountBase", op: "gt", value: "1.0000" }] },
        ctx({ amountBase: 50000 as unknown as string }),
      ),
    ).toThrow(WorkflowConditionInvalidError);
  });
});

describe("the department + custom-field + native operands", () => {
  it("department equality (and the null department)", () => {
    expect(evaluateConditions({ all: [{ field: "departmentId", op: "eq", value: "dept-finance" }] }, ctx())).toBe(true);
    expect(evaluateConditions({ all: [{ field: "departmentId", op: "neq", value: "dept-finance" }] }, ctx())).toBe(false);
    expect(
      evaluateConditions({ all: [{ field: "departmentId", op: "eq", value: null }] }, ctx({ departmentId: null })),
    ).toBe(true);
  });

  it("THE PHASE-036 CUSTOM-FIELD BRANCH (the acceptance #2's second fold): a different chain on the custom field", () => {
    const urgentChain = evaluateConditions(
      { all: [{ field: "customFields.priority", op: "eq", value: "HIGH" }] },
      ctx({ customFields: { priority: "HIGH" } }),
    );
    const normalChain = evaluateConditions(
      { all: [{ field: "customFields.priority", op: "eq", value: "HIGH" }] },
      ctx({ customFields: { priority: "NORMAL" } }),
    );
    expect(urgentChain).toBe(true);
    expect(normalChain).toBe(false);
  });

  it("the custom-field shapes: eq/neq/in/between over the typed value store's own scalars", () => {
    expect(evaluateConditions({ all: [{ field: "customFields.count", op: "eq", value: 3 }] }, ctx())).toBe(true);
    expect(evaluateConditions({ all: [{ field: "customFields.verified", op: "eq", value: true }] }, ctx())).toBe(true);
    expect(
      evaluateConditions({ all: [{ field: "customFields.priority", op: "in", value: ["HIGH", "URGENT"] }] }, ctx()),
    ).toBe(true);
    expect(
      evaluateConditions({ all: [{ field: "customFields.count", op: "between", value: [2, 4] }] }, ctx()),
    ).toBe(true);
    expect(
      evaluateConditions({ all: [{ field: "customFields.unitPrice", op: "between", value: ["10.0000", "15.0000"] }] }, ctx()),
    ).toBe(true);
  });

  it("an UNSET custom field: eq null passes, between never coerces null to 0", () => {
    const empty = ctx({ customFields: {} });
    expect(evaluateConditions({ all: [{ field: "customFields.priority", op: "eq", value: null }] }, empty)).toBe(true);
    expect(
      evaluateConditions({ all: [{ field: "customFields.count", op: "between", value: [0, 10] }] }, empty),
    ).toBe(false);
  });

  it("the native operands ride the same family", () => {
    expect(evaluateConditions({ all: [{ field: "native.warehouse", op: "eq", value: "WH-1" }] }, ctx())).toBe(true);
    expect(evaluateConditions({ any: [{ field: "native.supplierTier", op: "in", value: ["A", "B"] }] }, ctx())).toBe(true);
  });
});

describe("THE FAIL-CLOSED LAW (every malformed condition a typed refusal naming the path)", () => {
  it("the refusal names the condition BY PATH — the JSON-pointer shape", () => {
    try {
      evaluateConditions({ all: [{ field: "amountBase", op: "gte", value: "1.0000" }, { field: "nope", op: "eq", value: "x" }] }, ctx());
      expect.unreachable("the malformed condition must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowConditionInvalidError);
      expect((error as WorkflowConditionInvalidError).details?.path).toBe("$.all[1].field");
    }
  });

  it("unknown ops refuse naming the path; non-object conditions refuse", () => {
    expect(() =>
      evaluateConditions({ any: [{ field: "departmentId", op: "contains", value: "x" }] }, ctx()),
    ).toThrow(WorkflowConditionInvalidError);
    expect(() => evaluateConditions({ all: ["nope"] }, ctx())).toThrow(WorkflowConditionInvalidError);
    expect(() => evaluateConditions({ all: [42] }, ctx())).toThrow(/\$\.all\[0\]/);
  });

  it("the empty fieldKey / native key refuse (the family shapes are exact)", () => {
    expect(() => evaluateConditions({ all: [{ field: "customFields.", op: "eq", value: "x" }] }, ctx())).toThrow(
      WorkflowConditionInvalidError,
    );
    expect(() => evaluateConditions({ all: [{ field: "native.", op: "eq", value: "x" }] }, ctx())).toThrow(
      WorkflowConditionInvalidError,
    );
  });

  it("the in operand refuses the empty/non-scalar arrays; between refuses the wrong arity", () => {
    expect(() =>
      evaluateConditions({ all: [{ field: "customFields.priority", op: "in", value: [] }] }, ctx()),
    ).toThrow(WorkflowConditionInvalidError);
    expect(() =>
      evaluateConditions({ all: [{ field: "customFields.count", op: "in", value: [1, "x", {}] }] }, ctx()),
    ).toThrow(WorkflowConditionInvalidError);
    expect(() =>
      evaluateConditions({ all: [{ field: "customFields.count", op: "between", value: [1] }] }, ctx()),
    ).toThrow(WorkflowConditionInvalidError);
  });
});
