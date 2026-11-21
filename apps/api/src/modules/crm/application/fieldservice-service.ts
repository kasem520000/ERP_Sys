import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import * as crmStore from "../infrastructure/crm.store";
import * as store from "../infrastructure/fieldservice.store";
import {
  escalationDecisions,
  evaluateSlaClocks,
  hoursToMs,
  pauseIntervals,
  type PauseHistoryEvent,
  type SlaClockKind,
  type SlaClockReading,
  type SlaTargets,
} from "../domain/fieldservice-math";
import {
  FieldserviceInputInvalidError,
  ServiceOrderCancelledError,
  ServiceVisitNotFoundError,
  ServiceVisitStateError,
  ServiceVisitTechnicianRequiredError,
  SlaRegisterMalformedError,
} from "../domain/projects-errors";
import { ServiceOrderPosting } from "./service-order-posting";

/**
 * PHASE-048 (W-12 — T-13, D-12/BR-096) — THE SINGLE CLOCK SERVICE: the
 * field-service dispatch plane on the EXISTING service_orders (never a
 * new order surface). Three laws rule the service:
 *
 * 1. THE STATUS MACHINE (0103's own floors): NEW → SCHEDULED →
 *    DISPATCHED → IN_PROGRESS → COMPLETED → CLOSED, one CAS per move,
 *    the stamps landing in the same guarded statement. The technician is
 *    required from DISPATCHED on (the board's law); the response event
 *    (first_responded_at) is the SLA response clock's own stamp —
 *    idempotent when already responded, and force-stamped by the START
 *    transition's catch-up (starting the work IS a response).
 * 2. THE SINGLE CLOCK (the phase doc's risk mitigation — ONE
 *    implementation): both SLA clocks (response: dispatched → first
 *    response; resolution: dispatched → completion) read the SAME pure
 *    fold (`fieldservice-math.evaluateSlaClocks`) over the 0103 stamps +
 *    the pause history — the pause state rides the row, the pause
 *    HISTORY rides the append-only audit trail (the manufacturing
 *    operation precedent: `crm.service_visit.paused` / `.resumed`), and
 *    a pause opened and never resumed is closed by the window's own
 *    clamp (completing while paused releases the flag in the same CAS
 *    and writes the history's closing RESUMED at the same instant).
 * 3. BR-096's ESCALATION (fail-closed, red line 5): the targets come
 *    from the tenant's settings register
 *    (`projects.fieldservice_sla_targets` — hours, tenant-entered); when
 *    unset the evaluation reports the honest NO_TARGET absence (never a
 *    fabricated target, never a breach claim); when set, every breached
 *    clock escalates through the notifications inbox ONCE per
 *    (visit, clock) — the dedupe key is the single-escalation proof —
 *    evaluated on the SLA read surface (the dedicated endpoint; the
 *    board listing stays a pure read).
 *
 * Completion records the notes on the visit and the parts used THROUGH
 * THE SERVICE-ORDER LINE ISSUE PATH (the existing posting port — the WMS
 * movement core + the COGS journal, zero duplicate columns and zero
 * parallel stock writes; `issuePartsImmediate` is idempotent, skipping
 * already-ISSUED lines). The completion + the parts issue land in ONE
 * ambient transaction — all-or-nothing (INV-018, the service-order
 * approve precedent): an INSUFFICIENT_STOCK refusal rolls the completion
 * back with it.
 */

/** The pause-history audit actions (the clock's raw input). */
const PAUSE_ACTION = "crm.service_visit.paused";
const RESUME_ACTION = "crm.service_visit.resumed";

/** The settings register's planted shape (settings-schema.ts, W-12). */
interface SlaTargetsRegister {
  response_target_hours: number;
  resolution_target_hours: number;
}

export interface CreateVisitInput {
  serviceOrderId: string;
  technicianEmployeeId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export interface ScheduleVisitInput {
  scheduledStart: string;
  scheduledEnd: string;
  technicianEmployeeId: string | null;
  actorId: string | null;
}

export interface CompleteVisitInput {
  completionNotes: string | null;
  completionNotesAr: string | null;
  /** Issue the order's pending PARTS lines through the service-order
   * line issue path at completion (the WMS movement core). */
  issueParts: boolean;
  actorId: string | null;
}

/** The SLA evaluation's shape (the endpoint's payload). */
export interface SlaEvaluation {
  readonly visitId: string;
  readonly targets: { readonly responseHours: number; readonly resolutionHours: number } | null;
  readonly response: SlaClockReading;
  readonly resolution: SlaClockReading;
  readonly escalations: readonly {
    readonly clock: SlaClockKind;
    readonly overMs: number;
    readonly dedupeKey: string;
    /** False when the dedupe key already fired (the once-per-event law). */
    readonly notified: boolean;
  }[];
}

/** PHASE-048 (W-14 — T-17, dated 2026-11-22): the PURE SLA readout the
 * `projects.fieldservice-sla` report rides — the SAME single fold
 * (the 0103 stamps + the audit-trail pause history + the tenant's
 * register), with BR-096's escalation decisions surfaced as
 * `pendingEscalations` and NOTHING recorded: a report is NEVER the
 * evaluation act (the W-12 design law — the deduped inbox notification
 * fires only through the operator's per-visit evaluation surface, the
 * one write path). */
export interface SlaReadout {
  readonly visitId: string;
  readonly targets: { readonly responseHours: number; readonly resolutionHours: number } | null;
  readonly response: SlaClockReading;
  readonly resolution: SlaClockReading;
  /** The would-escalate decisions (BR-096's pure fold — no inbox write
   * ever happens through this read). */
  readonly pendingEscalations: readonly {
    readonly clock: SlaClockKind;
    readonly overMs: number;
    readonly dedupeKey: string;
  }[];
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

@Injectable()
export class FieldserviceService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
    // The service-order line issue path (the parts-used record — the
    // existing port, never a parallel stock write). Explicit @Inject —
    // the vitest/esbuild pipeline does not emit design:paramtypes (the
    // ContractService note).
    @Inject(ServiceOrderPosting) private readonly postings: ServiceOrderPosting,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string) {
    const visit = await store.findServiceVisitById(id);
    if (visit === undefined) throw new ServiceVisitNotFoundError(id);
    return visit;
  }

  /** The dispatch board's listing (a PURE read — the SLA evaluation and
   * its escalation side effects live on the dedicated SLA surface). */
  async board(filter: {
    serviceOrderId?: string;
    technicianEmployeeId?: string;
    status?: string;
    limit?: number;
  }) {
    const limit = filter.limit ?? 200;
    if (limit < 1 || limit > 500) {
      throw new FieldserviceInputInvalidError(`limit must be between 1 and 500: ${limit}`);
    }
    if (filter.status !== undefined && !VISIT_STATUSES.has(filter.status)) {
      throw new FieldserviceInputInvalidError(
        `unknown visit status ${filter.status} — the machine is NEW → SCHEDULED → DISPATCHED → IN_PROGRESS → COMPLETED → CLOSED`,
      );
    }
    return store.listServiceVisits({ ...filter, limit });
  }

  // -- the machine (D-12's status ladder — one CAS per move) --------------------

  async createVisit(input: CreateVisitInput) {
    const order = await this.requireLiveOrder(input.serviceOrderId);
    this.validateWindow(input.scheduledStart, input.scheduledEnd);
    if (input.technicianEmployeeId !== null) {
      await this.requireTechnician(input.technicianEmployeeId);
    }
    const created = await store.insertServiceVisit({
      serviceOrderId: order.id,
      technicianEmployeeId: input.technicianEmployeeId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "crm.service_visit.created",
      entityType: "service_visit",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        serviceOrderId: order.id,
        orderNo: order.orderNo,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        technicianEmployeeId: input.technicianEmployeeId,
      },
    });
    return created;
  }

  /** NEW → SCHEDULED (the window + an optional technician); a SCHEDULED
   * visit may re-schedule (the planning plane — pre-dispatch only). */
  async schedule(id: string, input: ScheduleVisitInput) {
    const visit = await this.find(id);
    if (visit.status !== "NEW" && visit.status !== "SCHEDULED") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only NEW/SCHEDULED visits schedule (the planning plane ends at dispatch)`,
        { visitId: id, from: visit.status, to: "SCHEDULED" },
      );
    }
    this.validateWindow(input.scheduledStart, input.scheduledEnd);
    if (input.technicianEmployeeId !== null) {
      await this.requireTechnician(input.technicianEmployeeId);
    }
    const updated = await store.scheduleServiceVisit({
      id,
      toScheduled: visit.status === "NEW",
      technicianEmployeeId: input.technicianEmployeeId,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while scheduling (was ${visit.status}) — reload the board and retry`,
        { visitId: id, from: visit.status, to: "SCHEDULED" },
      );
    }
    await this.audit.record({
      action: "crm.service_visit.scheduled",
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: visit.status },
      after: {
        status: updated.status,
        scheduledStart: updated.scheduledStart,
        scheduledEnd: updated.scheduledEnd,
        technicianEmployeeId: updated.technicianEmployeeId,
      },
    });
    return updated;
  }

  /** → DISPATCHED — the technician becomes REQUIRED (0103's own CHECK,
   * surfaced typed before it ever fires). */
  async dispatch(id: string, input: { technicianEmployeeId: string | null; actorId: string | null }) {
    const visit = await this.find(id);
    if (visit.status !== "NEW" && visit.status !== "SCHEDULED") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only NEW/SCHEDULED visits dispatch`,
        { visitId: id, from: visit.status, to: "DISPATCHED" },
      );
    }
    const technicianId = input.technicianEmployeeId ?? visit.technicianEmployeeId;
    if (technicianId === null) {
      throw new ServiceVisitTechnicianRequiredError(
        `service visit ${id} cannot dispatch without a technician — the board's law (the technician is required from DISPATCHED on)`,
        { visitId: id },
      );
    }
    await this.requireTechnician(technicianId);
    await this.requireLiveOrder(visit.serviceOrderId);
    const updated = await store.casVisitStatus({
      id,
      from: visit.status,
      to: "DISPATCHED",
      actorId: input.actorId,
      technicianEmployeeId: technicianId,
    });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while dispatching (was ${visit.status}) — reload the board and retry`,
        { visitId: id, from: visit.status, to: "DISPATCHED" },
      );
    }
    await this.audit.record({
      action: "crm.service_visit.dispatched",
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: visit.status },
      after: { status: "DISPATCHED", technicianEmployeeId: technicianId },
    });
    return updated;
  }

  /** The SLA response event — DISPATCHED only, idempotent (an already
   * responded visit returns unchanged, zero writes). */
  async respond(id: string, input: { actorId: string | null }) {
    const visit = await this.find(id);
    if (visit.status !== "DISPATCHED") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — the response event lands on DISPATCHED visits only (the clock starts at dispatch)`,
        { visitId: id, status: visit.status },
      );
    }
    if (visit.firstRespondedAt !== null) return visit; // idempotent replay
    const updated = await store.stampFirstResponse({ id, actorId: input.actorId });
    if (updated === undefined) throw new ServiceVisitNotFoundError(id);
    await this.audit.record({
      action: "crm.service_visit.responded",
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { firstRespondedAt: updated.firstRespondedAt },
    });
    return updated;
  }

  /** DISPATCHED → IN_PROGRESS — stamps started_at AND the response
   * catch-up (first_responded_at when still NULL: starting the work IS
   * a response — the never-unstamped-clock law). */
  async start(id: string, input: { actorId: string | null }) {
    const visit = await this.find(id);
    if (visit.status !== "DISPATCHED") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only DISPATCHED visits start`,
        { visitId: id, from: visit.status, to: "IN_PROGRESS" },
      );
    }
    const updated = await store.casVisitStatus({
      id,
      from: "DISPATCHED",
      to: "IN_PROGRESS",
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while starting (was DISPATCHED) — reload the board and retry`,
        { visitId: id, from: "DISPATCHED", to: "IN_PROGRESS" },
      );
    }
    await this.audit.record({
      action: "crm.service_visit.started",
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: "DISPATCHED" },
      after: { status: "IN_PROGRESS", startedAt: updated.startedAt },
    });
    return updated;
  }

  /** The pause — IN_PROGRESS only (0103's CHECK), idempotent; the event
   * lands on the append-only audit trail (the clock's raw input). */
  async pause(id: string, input: { actorId: string | null }) {
    const visit = await this.find(id);
    if (visit.status !== "IN_PROGRESS") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only IN_PROGRESS visits pause (the clock exists on the in-progress plane)`,
        { visitId: id, status: visit.status },
      );
    }
    if (visit.isPaused) return visit; // idempotent replay
    const updated = await store.setVisitPaused({ id, paused: true, actorId: input.actorId });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while pausing (was IN_PROGRESS) — reload the board and retry`,
        { visitId: id, status: visit.status },
      );
    }
    await this.audit.record({
      action: PAUSE_ACTION,
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { isPaused: false },
      after: { isPaused: true },
    });
    return updated;
  }

  async resume(id: string, input: { actorId: string | null }) {
    const visit = await this.find(id);
    if (visit.status !== "IN_PROGRESS") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only IN_PROGRESS visits resume`,
        { visitId: id, status: visit.status },
      );
    }
    if (!visit.isPaused) return visit; // idempotent replay
    const updated = await store.setVisitPaused({ id, paused: false, actorId: input.actorId });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while resuming (was IN_PROGRESS) — reload the board and retry`,
        { visitId: id, status: visit.status },
      );
    }
    await this.audit.record({
      action: RESUME_ACTION,
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { isPaused: true },
      after: { isPaused: false },
    });
    return updated;
  }

  /** IN_PROGRESS → COMPLETED — the notes land on the visit; the parts
   * used ride THE SERVICE-ORDER LINE ISSUE PATH (the existing port, the
   * WMS movement core) in the SAME ambient transaction — all-or-nothing
   * with the completion (INV-018). A paused visit completes by releasing
   * the flag in the same CAS and closing the pause history at the same
   * instant (the window's own clamp ends the interval at completed_at). */
  async complete(id: string, input: CompleteVisitInput) {
    const visit = await this.find(id);
    if (visit.status !== "IN_PROGRESS") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only IN_PROGRESS visits complete`,
        { visitId: id, from: visit.status, to: "COMPLETED" },
      );
    }
    for (const [notes, field] of [
      [input.completionNotes, "completionNotes"],
      [input.completionNotesAr, "completionNotesAr"],
    ] as const) {
      if (notes !== null && notes.length > 4000) {
        throw new FieldserviceInputInvalidError(
          `${field} must be at most 4000 characters: ${notes.length}`,
        );
      }
    }
    const order = await this.requireLiveOrder(visit.serviceOrderId);
    const updated = await store.casVisitStatus({
      id,
      from: "IN_PROGRESS",
      to: "COMPLETED",
      actorId: input.actorId,
      completionNotes: input.completionNotes,
      completionNotesAr: input.completionNotesAr,
    });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while completing (was IN_PROGRESS) — reload the board and retry`,
        { visitId: id, from: "IN_PROGRESS", to: "COMPLETED" },
      );
    }
    // The honest history close: a visit completed while paused ends its
    // open pause at this same transaction instant (completed_at and the
    // audit's now() are the same transaction_timestamp — the interval
    // closes exactly at the window's end).
    if (visit.isPaused) {
      await this.audit.record({
        action: RESUME_ACTION,
        entityType: "service_visit",
        entityId: id,
        actorId: input.actorId ?? undefined,
        before: { isPaused: true },
        after: { isPaused: false, closingEvent: "COMPLETED" },
      });
    }
    await this.audit.record({
      action: "crm.service_visit.completed",
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: "IN_PROGRESS" },
      after: {
        status: "COMPLETED",
        completedAt: updated.completedAt,
        issueParts: input.issueParts,
      },
    });
    // THE PARTS-USED RECORD — the service-order line issue path (the
    // existing WMS issue + COGS journal; idempotent, skipping ISSUED
    // lines). Inside the same ambient UoW: a stock refusal rolls the
    // completion back with it (the service-order approve precedent).
    let issueJournalId: string | null = null;
    if (input.issueParts) {
      await this.postings.issuePartsImmediate(order.id, input.actorId);
      const lines = await crmStore.listServiceOrderLines(order.id);
      for (const line of lines) {
        if (line.issueJournalId !== null) issueJournalId = line.issueJournalId;
      }
    }
    return { visit: updated, issueJournalId };
  }

  /** COMPLETED → CLOSED — terminal (the evidence discipline: no DELETE,
   * no reopen). */
  async close(id: string, input: { actorId: string | null }) {
    const visit = await this.find(id);
    if (visit.status !== "COMPLETED") {
      throw new ServiceVisitStateError(
        `service visit ${id} is ${visit.status} — only COMPLETED visits close (CLOSED is terminal)`,
        { visitId: id, from: visit.status, to: "CLOSED" },
      );
    }
    const updated = await store.casVisitStatus({
      id,
      from: "COMPLETED",
      to: "CLOSED",
      actorId: input.actorId,
    });
    if (updated === undefined) {
      throw new ServiceVisitStateError(
        `service visit ${id} moved on while closing (was COMPLETED) — reload the board and retry`,
        { visitId: id, from: "COMPLETED", to: "CLOSED" },
      );
    }
    await this.audit.record({
      action: "crm.service_visit.closed",
      entityType: "service_visit",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: "COMPLETED" },
      after: { status: "CLOSED", closedAt: updated.closedAt },
    });
    return updated;
  }

  // -- the single clock (BR-096) ------------------------------------------------

  /**
   * THE SLA EVALUATION SURFACE — the pure fold over the 0103 stamps +
   * the audit-trail pause history, the tenant's register (the honest
   * NO_TARGET absence while unset), and BR-096's escalation: every
   * breached clock with a configured target fires the deduped inbox
   * notification (once per (visit, clock) ever — the key is the proof).
   */
  async slaEvaluation(id: string): Promise<SlaEvaluation> {
    const { visit, targets, clocks, decisions } = await this.evaluateVisit(id);
    const escalations: {
      readonly clock: SlaClockKind;
      readonly overMs: number;
      readonly dedupeKey: string;
      readonly notified: boolean;
    }[] = [];
    for (const decision of decisions) {
      const order = await crmStore.findServiceOrderById(visit.serviceOrderId);
      const orderLabel = order?.orderNo ?? visit.serviceOrderId;
      const clockLabel =
        decision.clock === "RESPONSE"
          ? { ar: "ساعة الاستجابة", en: "response clock" }
          : { ar: "ساعة الإنجاز", en: "resolution clock" };
      const overHours = (decision.overMs / 3_600_000).toFixed(2);
      // The tenant owner's operational signal (the dispatch key is
      // owner-granted — matrix §3.26); the in-app channel only (the
      // email templates are the notifications module's own fixed set).
      const owner = await this.inbox.ownerTarget();
      const outcome = await this.inbox.record({
        category: "crm",
        severity: "warning",
        title: {
          ar: `تجاوز SLA (${clockLabel.ar}) — أمر الخدمة ${orderLabel}`,
          en: `SLA breach (${clockLabel.en}) — service order ${orderLabel}`,
        },
        body: {
          ar: `تجاوزت ${clockLabel.ar} الحد المستهدف بمقدار ${overHours} ساعة (BR-096). راجع لوحة الخدمة الميدانية.`,
          en: `The ${clockLabel.en} exceeded its target by ${overHours} hours (BR-096). Review the field-service dispatch board.`,
        },
        actionLabel: { ar: "مراجعة الخدمة الميدانية", en: "Review field service" },
        actionUrl: "/projects/fieldservice",
        dedupeKey: decision.dedupeKey,
        userId: owner?.userId ?? null,
      });
      escalations.push({ ...decision, notified: outcome.inserted });
    }
    return {
      visitId: id,
      targets:
        targets === null
          ? null
          : {
              responseHours: targets.responseTargetMs / 3_600_000,
              resolutionHours: targets.resolutionTargetMs / 3_600_000,
            },
      response: clocks.response,
      resolution: clocks.resolution,
      escalations,
    };
  }

  /**
   * PHASE-048 (W-14 — T-17, dated 2026-11-22): the PURE SLA readout —
   * the SAME fold `slaEvaluation` rides, with the escalation decisions
   * surfaced and NOTHING recorded (a report is never the evaluation
   * act; BR-096's inbox notification fires only through the operator's
   * evaluation surface). Additive: `slaEvaluation`'s behavior is
   * byte-identical (its spec unchanged is the proof).
   */
  async slaReadout(id: string): Promise<SlaReadout> {
    const { targets, clocks, decisions } = await this.evaluateVisit(id);
    return {
      visitId: id,
      targets:
        targets === null
          ? null
          : {
              responseHours: targets.responseTargetMs / 3_600_000,
              resolutionHours: targets.resolutionTargetMs / 3_600_000,
            },
      response: clocks.response,
      resolution: clocks.resolution,
      pendingEscalations: decisions,
    };
  }

  /** The shared single fold (the W-12 engine's own read): the visit's
   * stamps + the pause history + the tenant register → the two clocks'
   * readings + BR-096's pure escalation decisions. NO side effects —
   * the recording is the callers' own concern (the evaluation act
   * records; the readout never does). */
  private async evaluateVisit(id: string) {
    const visit = await this.find(id);
    const targets = await this.readTargets();
    const events = await this.pauseHistory(id);
    const clocks = evaluateSlaClocks({
      dispatchedAt: visit.dispatchedAt,
      firstRespondedAt: visit.firstRespondedAt,
      completedAt: visit.completedAt,
      pauses: pauseIntervals(events, Date.now()),
      now: Date.now(),
      targets,
    });
    return { visit, targets, clocks, decisions: escalationDecisions(id, clocks) };
  }

  // -- the shared guards --------------------------------------------------------

  /** The register read (the W-8 planted-key pattern): null = unset (the
   * honest NO_TARGET absence); a malformed shape is the typed refusal. */
  private async readTargets(): Promise<SlaTargets | null> {
    const stored = await readEffectiveSetting<SlaTargetsRegister | null>(
      "projects.fieldservice_sla_targets",
    );
    if (stored === null || stored === undefined) return null;
    if (
      typeof stored !== "object" ||
      typeof stored.response_target_hours !== "number" ||
      typeof stored.resolution_target_hours !== "number" ||
      !Number.isFinite(stored.response_target_hours) ||
      !Number.isFinite(stored.resolution_target_hours) ||
      stored.response_target_hours <= 0 ||
      stored.resolution_target_hours <= 0
    ) {
      throw new SlaRegisterMalformedError(
        "the field-service SLA targets register is malformed (projects.fieldservice_sla_targets requires { response_target_hours, resolution_target_hours } — positive hours); the evaluation refuses rather than fabricate a target",
      );
    }
    return {
      responseTargetMs: hoursToMs(stored.response_target_hours),
      resolutionTargetMs: hoursToMs(stored.resolution_target_hours),
    };
  }

  /** The pause history from the append-only audit trail (the clock's raw
   * input — two precise action-filtered reads, the W-12 engine's own
   * storage law: no table of our own). */
  private async pauseHistory(visitId: string): Promise<readonly PauseHistoryEvent[]> {
    const [paused, resumed] = await Promise.all([
      this.audit.list({
        entityType: "service_visit",
        entityId: visitId,
        action: PAUSE_ACTION,
        limit: 500,
      }),
      this.audit.list({
        entityType: "service_visit",
        entityId: visitId,
        action: RESUME_ACTION,
        limit: 500,
      }),
    ]);
    const events: PauseHistoryEvent[] = [];
    for (const row of [...paused, ...resumed]) {
      events.push({
        at: Date.parse(row.at),
        kind: row.action === PAUSE_ACTION ? "PAUSED" : "RESUMED",
      });
    }
    return events;
  }

  /** Visits ride LIVE service orders — a CANCELLED order accepts no
   * visit writes (the typed refusal at every write site). */
  private async requireLiveOrder(orderId: string) {
    const order = await crmStore.findServiceOrderById(orderId);
    if (order === undefined) {
      throw new FieldserviceInputInvalidError(
        `service order ${orderId} does not exist in this tenant — service visits ride the existing service orders`,
        { serviceOrderId: orderId },
      );
    }
    if (order.status === "CANCELLED") {
      throw new ServiceOrderCancelledError(
        `service order ${order.orderNo ?? orderId} is CANCELLED — cancelled orders accept no visit writes`,
        { serviceOrderId: orderId, orderNo: order.orderNo },
      );
    }
    return order;
  }

  /** The technician must be a live employee (the crm.store foreign-read
   * precedent — a guarded SELECT on employees, never a payroll write). */
  private async requireTechnician(employeeId: string) {
    const technician = await store.findTechnicianForFieldservice(employeeId);
    if (technician === undefined) {
      throw new FieldserviceInputInvalidError(
        `technician ${employeeId} does not exist in this tenant`,
        { technicianEmployeeId: employeeId },
      );
    }
    if (technician.status !== "ACTIVE" || technician.terminationDate !== null) {
      throw new FieldserviceInputInvalidError(
        `technician ${technician.code} is ${technician.terminationDate !== null ? "terminated" : technician.status} — dispatch boards carry live technicians only`,
        { technicianEmployeeId: employeeId, status: technician.status },
      );
    }
  }

  private validateWindow(start: string, end: string): void {
    if (!ISO_TIMESTAMP.test(start) || !ISO_TIMESTAMP.test(end)) {
      throw new FieldserviceInputInvalidError(
        `the scheduled window must be ISO-8601 timestamps with offset (got ${start} … ${end})`,
        { scheduledStart: start, scheduledEnd: end },
      );
    }
    const startDate = Date.parse(start);
    const endDate = Date.parse(end);
    if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || endDate <= startDate) {
      throw new FieldserviceInputInvalidError(
        `the scheduled window must end after it starts (got ${start} … ${end} — the 0103 CHECK's own law, surfaced typed)`,
        { scheduledStart: start, scheduledEnd: end },
      );
    }
  }
}

const VISIT_STATUSES = new Set([
  "NEW",
  "SCHEDULED",
  "DISPATCHED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
]);
