import { describe, expect, it } from "vitest";

import {
  actOnStep,
  advancePointer,
  cancelInstance,
  completeInstance,
  delegateStep,
  skipStep,
  type InstanceShape,
  type StepInstanceShape,
} from "./instance-state-machine";
import {
  WorkflowInstanceImmutableError,
  WorkflowStepAlreadyActedError,
  WorkflowStepStateError,
} from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law) THE INSTANCE/STEP STATE
 * MACHINE'S PROPERTY TESTS (the D-13 fold proven BEFORE the engine
 * renders it): the ladder's stamp law, the CAS single-use, the
 * pointer fold, and INV-037's terminal immutability floor.
 */

const step = (overrides: Partial<StepInstanceShape> = {}): StepInstanceShape => ({
  stepInstanceId: "step-1",
  stepOrder: 1,
  stepType: "APPROVAL",
  assigneeUserId: "user-assignee",
  status: "PENDING",
  delegatedTo: null,
  actedAt: null,
  actedBy: null,
  comment: null,
  ...overrides,
});

const instance = (overrides: Partial<InstanceShape> = {}): InstanceShape => ({
  instanceId: "inst-1",
  status: "ACTIVE",
  currentStepOrder: 1,
  completedAt: null,
  ...overrides,
});

describe("THE LADDER'S STAMP LAW (the 0128 declared interpretation)", () => {
  it("PENDING carries no act and no delegation — the legal floor", () => {
    const pending = step();
    expect(pending.actedAt).toBeNull();
    expect(pending.actedBy).toBeNull();
    expect(pending.delegatedTo).toBeNull();
  });

  it("THE ACT PAIR: APPROVED/REJECTED carry acted_at + acted_by TOGETHER, the comment with the act", () => {
    const approved = actOnStep(step(), { actorId: "user-actor", at: "2026-11-27T09:00:00Z", verdict: "APPROVE", comment: "LGTM" });
    expect(approved.status).toBe("APPROVED");
    expect(approved.actedAt).toBe("2026-11-27T09:00:00Z");
    expect(approved.actedBy).toBe("user-actor");
    expect(approved.comment).toBe("LGTM");

    const rejected = actOnStep(step(), { actorId: "user-actor", at: "2026-11-27T09:00:00Z", verdict: "REJECT", comment: "nope" });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.actedBy).toBe("user-actor");
  });

  it("DELEGATED: the re-route recorded, the act NOT yet landed; the act through the window RETAINS the provenance", () => {
    const delegated = delegateStep(step(), { delegateUserId: "user-delegate" });
    expect(delegated.status).toBe("DELEGATED");
    expect(delegated.delegatedTo).toBe("user-delegate");
    expect(delegated.actedAt).toBeNull();
    expect(delegated.actedBy).toBeNull();

    // the delegate acts: the pair lands, delegated_to STAYS as the
    // provenance (the 0128 law verbatim).
    const acted = actOnStep(delegated, { actorId: "user-delegate", at: "2026-11-27T10:00:00Z", verdict: "APPROVE" });
    expect(acted.status).toBe("APPROVED");
    expect(acted.actedBy).toBe("user-delegate");
    expect(acted.delegatedTo).toBe("user-delegate");
  });

  it("SKIPPED: the skip stamp with NO actor (the branch's own verdict, never a user act)", () => {
    const skipped = skipStep(step(), { at: "2026-11-27T09:30:00Z" });
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.actedAt).toBe("2026-11-27T09:30:00Z");
    expect(skipped.actedBy).toBeNull();
    expect(skipped.delegatedTo).toBeNull();
  });

  it("THE TASK COMPLETION WRITE-BACK IS THE STEP'S OWN ACT PAIR (D-11 — no seventh table)", () => {
    const task = step({ stepType: "TASK" });
    const done = actOnStep(task, { actorId: "user-assignee", at: "2026-11-27T11:00:00Z", verdict: "APPROVE", comment: "done" });
    expect(done.stepType).toBe("TASK");
    expect(done.status).toBe("APPROVED");
    expect(done.actedAt).toBe("2026-11-27T11:00:00Z");
  });
});

describe("THE CAS SINGLE-USE (D-09's replay law — the acted_at stamp is the ledger)", () => {
  it("a replayed act meets a non-PENDING step and takes the typed ALREADY_ACTED refusal", () => {
    const acted = actOnStep(step(), { actorId: "user-actor", at: "2026-11-27T09:00:00Z", verdict: "APPROVE" });
    expect(() =>
      actOnStep(acted, { actorId: "user-actor", at: "2026-11-27T09:05:00Z", verdict: "APPROVE" }),
    ).toThrow(WorkflowStepAlreadyActedError);
    expect(() =>
      actOnStep(acted, { actorId: "user-actor", at: "2026-11-27T09:05:00Z", verdict: "REJECT" }),
    ).toThrow(WorkflowStepAlreadyActedError);
  });

  it("the refusal names the step and its status (the typed payload)", () => {
    const skipped = skipStep(step(), { at: "2026-11-27T09:00:00Z" });
    try {
      actOnStep(skipped, { actorId: "user-actor", at: "2026-11-27T09:05:00Z", verdict: "APPROVE" });
      expect.unreachable("the skipped step must refuse the act");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowStepAlreadyActedError);
      expect((error as WorkflowStepAlreadyActedError).details?.status).toBe("SKIPPED");
    }
  });

  it("an empty actor refuses (the act needs its actor)", () => {
    expect(() =>
      actOnStep(step(), { actorId: "", at: "2026-11-27T09:00:00Z", verdict: "APPROVE" }),
    ).toThrow(WorkflowStepStateError);
  });
});

describe("the delegation + skip rungs' own floors", () => {
  it("only a PENDING step records the absence re-route", () => {
    const delegated = delegateStep(step(), { delegateUserId: "user-delegate" });
    expect(() => delegateStep(delegated, { delegateUserId: "user-other" })).toThrow(WorkflowStepStateError);
    const acted = actOnStep(step(), { actorId: "u", at: "2026-11-27T09:00:00Z", verdict: "APPROVE" });
    expect(() => delegateStep(acted, { delegateUserId: "user-delegate" })).toThrow(WorkflowStepStateError);
  });

  it("the delegate is never the assignee (the no-self floor)", () => {
    expect(() => delegateStep(step(), { delegateUserId: "user-assignee" })).toThrow(WorkflowStepStateError);
  });

  it("only a step not yet acted can be skipped (the branch excludes ahead, never behind)", () => {
    const acted = actOnStep(step(), { actorId: "u", at: "2026-11-27T09:00:00Z", verdict: "APPROVE" });
    expect(() => skipStep(acted, { at: "2026-11-27T09:05:00Z" })).toThrow(WorkflowStepStateError);
  });
});

describe("the pointer fold", () => {
  const steps: readonly StepInstanceShape[] = [
    step({ stepInstanceId: "s1", stepOrder: 1 }),
    step({ stepInstanceId: "s2", stepOrder: 2 }),
    step({ stepInstanceId: "s3", stepOrder: 3 }),
  ];

  it("advances to the next order; null past the last (the terminal signal)", () => {
    expect(advancePointer(steps, 1)).toBe(2);
    expect(advancePointer(steps, 2)).toBe(3);
    expect(advancePointer(steps, 3)).toBeNull();
  });

  it("the SKIPPED rungs never receive the pointer (the branch's own exclusion)", () => {
    const withSkip = [
      steps[0]!,
      skipStep(steps[1]!, { at: "2026-11-27T09:00:00Z" }),
      steps[2]!,
    ];
    expect(advancePointer(withSkip, 1)).toBe(3);
  });
});

describe("INV-037 — THE TERMINAL IMMUTABILITY FLOOR (the reserved wording)", () => {
  it("COMPLETED: the pointer NULLs and the stamp lands TOGETHER", () => {
    const done = completeInstance(instance(), { at: "2026-11-27T12:00:00Z" });
    expect(done.status).toBe("COMPLETED");
    expect(done.currentStepOrder).toBeNull();
    expect(done.completedAt).toBe("2026-11-27T12:00:00Z");
  });

  it("CANCELLED: the same terminal law (the document's own cancellation mirrored)", () => {
    const cancelled = cancelInstance(instance(), { at: "2026-11-27T12:00:00Z" });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.currentStepOrder).toBeNull();
    expect(cancelled.completedAt).toBe("2026-11-27T12:00:00Z");
  });

  it("A TERMINAL INSTANCE REFUSES EVERY MUTATION — the typed WORKFLOW_INSTANCE_IMMUTABLE refusal", () => {
    const done = completeInstance(instance(), { at: "2026-11-27T12:00:00Z" });
    expect(() => completeInstance(done, { at: "2026-11-27T13:00:00Z" })).toThrow(WorkflowInstanceImmutableError);
    expect(() => cancelInstance(done, { at: "2026-11-27T13:00:00Z" })).toThrow(WorkflowInstanceImmutableError);
    const cancelled = cancelInstance(instance(), { at: "2026-11-27T12:00:00Z" });
    expect(() => completeInstance(cancelled, { at: "2026-11-27T13:00:00Z" })).toThrow(WorkflowInstanceImmutableError);
  });

  it("the refusal names the instance, the terminal state, and the stamp (the frozen history's own evidence)", () => {
    const done = completeInstance(instance({ instanceId: "inst-9" }), { at: "2026-11-27T12:00:00Z" });
    try {
      cancelInstance(done, { at: "2026-11-27T13:00:00Z" });
      expect.unreachable("the terminal instance must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowInstanceImmutableError);
      const details = (error as WorkflowInstanceImmutableError).details;
      expect(details?.instanceId).toBe("inst-9");
      expect(details?.status).toBe("COMPLETED");
      expect(details?.completedAt).toBe("2026-11-27T12:00:00Z");
      expect((error as Error).message).toContain("INV-037");
    }
  });
});
