import { EventEmitter } from "node:events";

/**
 * PHASE-052 (W-44 — T-07's bus half, dated 2026-11-27) THE WORKFLOW
 * EVENT BUS (D-10 — the WorkflowEvent family, the 055 handoff
 * surface). The config-events pattern VERBATIM (the tiny typed
 * `node:events` EventEmitter — no persistence; the consumers act
 * INSIDE the emitting request's envelope; durable fan-out is 055's
 * platform, never this bus):
 *
 *   workflow.instance.started   — the chain opened (the definition
 *                                 snapshot captured, the first step
 *                                 assigned)
 *   workflow.step.assigned      — the pointer reached a step (the
 *                                 assignee's inbox record rides the
 *                                 same envelope)
 *   workflow.step.approved      — a step's APPROVE act landed
 *   workflow.step.rejected      — a step's REJECT act landed
 *   workflow.step.delegated     — the absence re-route recorded (W-45)
 *   workflow.step.escalated     — the SLA breach escalated (W-45)
 *   workflow.instance.completed — the chain reached its terminal
 *                                 COMPLETED verdict (the document's
 *                                 own approve act proceeds — the
 *                                 gateway's contract)
 *   workflow.instance.cancelled — the chain cancelled (the document's
 *                                 own cancellation-class verdict — the
 *                                 gateway mirrors the module, never
 *                                 invents one)
 *
 * THE 055 HANDOFF (the phase doc §2.12 + the master plan's D-10):
 * these eight topics are the ingestion surface PHASE-055 turns into
 * public webhooks — the topic list is recorded in the completion
 * report as the declared contract; the rules-engine alert adapters
 * (UX-13 — W-47) are BUS CONSUMERS (threshold/condition rules raising
 * configurable alerts into the notifications inbox — never a parallel
 * evaluation path).
 *
 * The bus is deliberately tiny (the config-events law): anything that
 * must survive a crash belongs to a queue, not here. The emitter is
 * the engine; the consumers are wired by the WorkflowModule (and the
 * specs directly — the test surface below).
 */

export type WorkflowEvent =
  | {
      readonly type: "workflow.instance.started";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly triggerEntity: string;
      readonly triggerEntityId: string;
      readonly definitionId: string;
    }
  | {
      readonly type: "workflow.step.assigned";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly stepInstanceId: string;
      readonly stepOrder: number;
      readonly assigneeUserId: string;
    }
  | {
      readonly type: "workflow.step.approved";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly stepInstanceId: string;
      readonly stepOrder: number;
      readonly actorId: string;
    }
  | {
      readonly type: "workflow.step.rejected";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly stepInstanceId: string;
      readonly stepOrder: number;
      readonly actorId: string;
    }
  | {
      readonly type: "workflow.step.delegated";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly stepInstanceId: string;
      readonly stepOrder: number;
      readonly fromUserId: string;
      readonly toUserId: string;
    }
  | {
      readonly type: "workflow.step.escalated";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly stepInstanceId: string;
      readonly stepOrder: number;
      readonly kind: string;
    }
  | {
      readonly type: "workflow.instance.completed";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly triggerEntity: string;
      readonly triggerEntityId: string;
      readonly verdict: "APPROVED" | "REJECTED";
    }
  | {
      readonly type: "workflow.instance.cancelled";
      readonly tenantId: string;
      readonly instanceId: string;
      readonly triggerEntity: string;
      readonly triggerEntityId: string;
    };

/** The topic list — the 055 handoff contract (D-10's own eight). */
export const WORKFLOW_EVENT_TOPICS: readonly string[] = Object.freeze([
  "workflow.instance.started",
  "workflow.step.assigned",
  "workflow.step.approved",
  "workflow.step.rejected",
  "workflow.step.delegated",
  "workflow.step.escalated",
  "workflow.instance.completed",
  "workflow.instance.cancelled",
]);

const BUS = new EventEmitter();
BUS.setMaxListeners(50); // per-process consumers; leak-safe for the phase scope

/** Publish a workflow lifecycle event to every in-process consumer. */
export function publishWorkflowEvent(event: WorkflowEvent): void {
  BUS.emit(event.type, event);
}

/** Subscribe (returns the unsubscribe handle). Test/audit surface. */
export function onWorkflowEvent(
  type: WorkflowEvent["type"],
  listener: (event: WorkflowEvent) => void,
): () => void {
  BUS.on(type, listener as (event: WorkflowEvent) => void);
  return () => {
    BUS.off(type, listener as (event: WorkflowEvent) => void);
  };
}
