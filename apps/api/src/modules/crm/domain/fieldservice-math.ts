/**
 * PHASE-048 (W-12 — T-13, D-12/BR-096) — the single clock service's PURE
 * arithmetic: the pause-aware SLA clocks. THE UNIT-FIRST LAW opened the
 * wave here (the plan §4's "the SLA clock's pause-aware arithmetic")
 * — every consumer (the fieldservice service's evaluation, the board's
 * reads, the escalation) lands on THIS fold, never a parallel one.
 *
 * THE CLOCK MODEL (D-12's own wording: "a SINGLE clock service for SLA
 * response/resolution with pause states"):
 *
 * - BOTH clocks start at dispatched_at — the moment the visit becomes the
 *   technician's responsibility (the dispatch board's own law; the 0103
 *   stamps are the raw inputs, and dispatched_at is the earliest of them).
 * - The RESPONSE clock ends at first_responded_at (the SLA response
 *   event). It is pending while the visit is DISPATCHED; the start
 *   transition's catch-up law stamps it at started_at when the work
 *   starts (starting the work IS a response — the honest catch-up, never
 *   an unstamped clock).
 * - The RESOLUTION clock ends at completed_at — it freezes at completion.
 * - PAUSES subtract from BOTH clocks, clamped to each clock's own window
 *   (an interval outside the window subtracts nothing — the mathematical
 *   floor, no special cases). A pause opened and never resumed (the
 *   visit completed while paused) closes at `now`; the window's clamp
 *   ends it at completed_at — the paused remainder never counts.
 *
 * Durations are INTEGER milliseconds (epoch-ms doubles are exact well
 * beyond day-scale windows — ADR-0009 governs MONEY, never wall time).
 * The single float boundary is Date.parse at the service's edge.
 */

import { Decimal } from "@erp/domain-core";

/** A half-open wall-clock interval [start, end) in epoch milliseconds. */
export interface WallInterval {
  readonly start: number;
  readonly end: number;
}

/** One pause-history event as the audit trail records it (the engine's
 * own raw input — `crm.service_visit.paused` / `crm.service_visit.resumed`). */
export interface PauseHistoryEvent {
  readonly at: number;
  readonly kind: "PAUSED" | "RESUMED";
}

/**
 * Fold the pause HISTORY into closed intervals: a PAUSED opens, a RESUMED
 * closes; an open pause closes at `now` (the still-paused clock — or the
 * completed-while-paused visit, whose window clamp ends the interval at
 * completed_at downstream). Duplicate opens and orphan closes are ignored
 * (defensive — the service writes exactly one open and one close per
 * pause, but the fold never trusts the writer for its arithmetic).
 */
export function pauseIntervals(
  events: readonly PauseHistoryEvent[],
  now: number,
): readonly WallInterval[] {
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const out: WallInterval[] = [];
  let open: number | null = null;
  for (const event of ordered) {
    if (event.kind === "PAUSED") {
      if (open === null) open = event.at;
    } else if (open !== null) {
      if (event.at > open) out.push({ start: open, end: event.at });
      open = null;
    }
  }
  if (open !== null && now > open) out.push({ start: open, end: now });
  return out;
}

/** The overlap of two intervals in milliseconds (0 when disjoint). */
export function overlapMs(a: WallInterval, b: WallInterval): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? end - start : 0;
}

/**
 * The pause-aware elapsed time of a clock window: (end − start) minus
 * every pause interval's overlap with the window, never negative. This
 * is the ONE fold every clock reads (zero parallel computation).
 */
export function elapsedMs(
  start: number,
  end: number,
  pauses: readonly WallInterval[],
): number {
  if (end <= start) return 0;
  const window: WallInterval = { start, end };
  let paused = 0;
  for (const pause of pauses) paused += overlapMs(pause, window);
  return Math.max(0, end - start - paused);
}

/** The tenant's SLA targets (milliseconds — the service converts the
 * settings register's hours at its edge; the pure layer never parses). */
export interface SlaTargets {
  readonly responseTargetMs: number;
  readonly resolutionTargetMs: number;
}

export type SlaClockKind = "RESPONSE" | "RESOLUTION";

/** One clock's pause-aware reading. `targetMs === null` is the honest
 * NO_TARGET absence (the register is unset — fail-closed, never a
 * fabricated target, red line 5); `breached` is false in that state. */
export interface SlaClockReading {
  readonly kind: SlaClockKind;
  /** False while the visit is undispatched — the clock never started. */
  readonly running: boolean;
  /** The window's own bounds (epoch ms; end = the frozen/pending edge). */
  readonly startedAt: number | null;
  readonly endedAt: number | null;
  /** The pause time that fell INSIDE this clock's window. */
  readonly pausedMs: number;
  readonly elapsedMs: number;
  readonly targetMs: number | null;
  readonly breached: boolean;
  /** elapsedMs − targetMs when breached (0 otherwise). */
  readonly overMs: number;
}

/** The visit's raw clock inputs — exactly the 0103 stamps + the pause
 * history (epoch ms at the service's edge). */
export interface SlaClockInputs {
  readonly dispatchedAt: string | null;
  readonly firstRespondedAt: string | null;
  readonly completedAt: string | null;
  readonly pauses: readonly WallInterval[];
  readonly now: number;
  readonly targets: SlaTargets | null;
}

function readClock(
  kind: SlaClockKind,
  start: number | null,
  end: number | null,
  pendingEdge: number,
  pauses: readonly WallInterval[],
  targetMs: number | null,
): SlaClockReading {
  if (start === null) {
    return {
      kind,
      running: false,
      startedAt: null,
      endedAt: null,
      pausedMs: 0,
      elapsedMs: 0,
      targetMs,
      breached: false,
      overMs: 0,
    };
  }
  const windowEnd = end ?? pendingEdge;
  const pausedMs = pauses.reduce(
    (sum, pause) => sum + overlapMs(pause, { start, end: windowEnd }),
    0,
  );
  const elapsed = elapsedMs(start, windowEnd, pauses);
  const breached = targetMs !== null && elapsed > targetMs;
  return {
    kind,
    running: true,
    startedAt: start,
    endedAt: end,
    pausedMs,
    elapsedMs: elapsed,
    targetMs,
    breached,
    overMs: breached ? elapsed - targetMs! : 0,
  };
}

/**
 * THE SINGLE CLOCK EVALUATION (BR-096's own substrate): both clocks from
 * one input set — the response window [dispatched, firstResponded ?? now]
 * and the resolution window [dispatched, completed ?? now], each minus
 * its own clamped pause overlap. The `endedAt: null` readings are the
 * still-pending edges (the response pending on a DISPATCHED visit; the
 * resolution pending until completion).
 */
export function evaluateSlaClocks(input: SlaClockInputs): {
  readonly response: SlaClockReading;
  readonly resolution: SlaClockReading;
} {
  const dispatched =
    input.dispatchedAt === null ? null : Date.parse(input.dispatchedAt);
  const firstResponded =
    input.firstRespondedAt === null ? null : Date.parse(input.firstRespondedAt);
  const completed =
    input.completedAt === null ? null : Date.parse(input.completedAt);
  return {
    response: readClock(
      "RESPONSE",
      dispatched,
      firstResponded,
      input.now,
      input.pauses,
      input.targets === null ? null : input.targets.responseTargetMs,
    ),
    resolution: readClock(
      "RESOLUTION",
      dispatched,
      completed,
      input.now,
      input.pauses,
      input.targets === null ? null : input.targets.resolutionTargetMs,
    ),
  };
}

/**
 * BR-096's escalation decision (pure): the breached clocks with targets
 * configured, in the deterministic order the escalation notification
 * records them. The dedupe key's shape is the ONCE-PER-EVENT discipline
 * (`uq_notifications_dedupe`): one escalation per (visit, clock) EVER —
 * a clock's elapsed only grows until it freezes, so a breach is
 * permanent; the dedupe key proves the single escalation.
 */
export function escalationDecisions(
  visitId: string,
  clocks: { readonly response: SlaClockReading; readonly resolution: SlaClockReading },
): readonly { clock: SlaClockKind; overMs: number; dedupeKey: string }[] {
  const out: { clock: SlaClockKind; overMs: number; dedupeKey: string }[] = [];
  for (const reading of [clocks.response, clocks.resolution]) {
    if (reading.breached && reading.targetMs !== null) {
      out.push({
        clock: reading.kind,
        overMs: reading.overMs,
        dedupeKey: `fieldservice-sla-breach:${visitId}:${reading.kind}`,
      });
    }
  }
  return out;
}

/** The settings register's hours → milliseconds (the single conversion —
 * fractional hours exact in ms: 0.5h = 1,800,000ms). ADR-0009's law:
 * the multiply runs in exact decimal (never float math), Number() only
 * at the integer-ms boundary (max 8,760h ≈ 3.15e10ms ≪ 2^53). */
export function hoursToMs(hours: number): number {
  return Number(new Decimal(hours).times(3_600_000).toFixed(0));
}
