import { describe, expect, it } from "vitest";

import {
  elapsedMs,
  escalationDecisions,
  evaluateSlaClocks,
  hoursToMs,
  overlapMs,
  pauseIntervals,
  type PauseHistoryEvent,
} from "../domain/fieldservice-math";

/**
 * PHASE-048 (W-12 — the plan §4's unit-first law, D-12/BR-096): the PURE
 * pause-aware SLA clock folds proven BEFORE any consumer lands — every
 * example HAND-COMPUTED in integer milliseconds (the W-9/W-10 lesson:
 * state the arithmetic in the arm, never trust the fold to prove itself).
 *
 * THE HAND-COMPUTED WORLD: one visit dispatched 2026-11-20T08:00:00Z
 * (T0), responded 09:00 (T0+1h), started 09:30 (T0+1.5h), paused
 * 10:00–11:00 (T0+2h..T0+3h — 3,600,000ms) then 13:00–13:30
 * (T0+5h..T0+5.5h — 1,800,000ms), completed 15:00 (T0+7h), evaluated
 * at 16:00 (T0+8h).
 *
 *   RESPONSE   window [08:00, 09:00]  = 3,600,000ms; no pause overlaps
 *              (both pauses open after 09:00) → elapsed 3,600,000ms.
 *   RESOLUTION window [08:00, 15:00]  = 25,200,000ms; pauses inside
 *              3,600,000 + 1,800,000 = 5,400,000ms → elapsed
 *              19,800,000ms.
 */

const T0 = Date.parse("2026-11-20T08:00:00Z");
const HOUR = 3_600_000;
const at = (hours: number): string =>
  new Date(T0 + hours * HOUR).toISOString();

const PAUSES: readonly PauseHistoryEvent[] = [
  { at: T0 + 2 * HOUR, kind: "PAUSED" },
  { at: T0 + 3 * HOUR, kind: "RESUMED" },
  { at: T0 + 5 * HOUR, kind: "PAUSED" },
  { at: T0 + 5.5 * HOUR, kind: "RESUMED" },
];

describe("W-12 fieldservice-math — pauseIntervals (the history fold)", () => {
  it("(a) pairs PAUSED→RESUMED in order and closes an open pause at now", () => {
    const now = T0 + 8 * HOUR;
    const intervals = pauseIntervals(PAUSES, now);
    expect(intervals).toEqual([
      { start: T0 + 2 * HOUR, end: T0 + 3 * HOUR },
      { start: T0 + 5 * HOUR, end: T0 + 5.5 * HOUR },
    ]);
    // The open pause (still paused) closes at now — the live clock's law.
    const open = pauseIntervals(
      [{ at: T0 + 6 * HOUR, kind: "PAUSED" }],
      now,
    );
    expect(open).toEqual([{ start: T0 + 6 * HOUR, end: now }]);
  });

  it("(b) unsorted input folds by time; duplicate opens and orphan closes are ignored", () => {
    const now = T0 + 8 * HOUR;
    const messy: readonly PauseHistoryEvent[] = [
      { at: T0 + 3 * HOUR, kind: "RESUMED" }, // closes the 2h pause (sorted first pair)
      { at: T0 + 2 * HOUR, kind: "PAUSED" },
      { at: T0 + 2.5 * HOUR, kind: "PAUSED" }, // duplicate open — ignored
      { at: T0 + 9 * HOUR, kind: "RESUMED" }, // orphan (before any open) — ignored
    ];
    expect(pauseIntervals(messy, now)).toEqual([
      { start: T0 + 2 * HOUR, end: T0 + 3 * HOUR },
    ]);
    // An orphan RESUMED alone yields nothing.
    expect(pauseIntervals([{ at: now, kind: "RESUMED" }], now)).toEqual([]);
  });

  it("(c) the pause after the window's end still closes (the completed-while-paused visit clamps downstream)", () => {
    // Pause opened, never resumed, evaluated later than `now` seen by the
    // fold: the interval closes at the fold's now — the WINDOW's clamp
    // (elapsedMs) is what ends it at completed_at.
    const now = T0 + 8 * HOUR;
    const intervals = pauseIntervals([{ at: T0 + 6 * HOUR, kind: "PAUSED" }], now);
    expect(intervals).toEqual([{ start: T0 + 6 * HOUR, end: now }]);
  });
});

describe("W-12 fieldservice-math — overlapMs / elapsedMs (the window clamp)", () => {
  it("(a) disjoint intervals overlap zero; containment clamps", () => {
    expect(overlapMs({ start: 0, end: 10 }, { start: 20, end: 30 })).toBe(0);
    expect(overlapMs({ start: 0, end: 10 }, { start: 5, end: 30 })).toBe(5);
    expect(overlapMs({ start: 0, end: 10 }, { start: 2, end: 4 })).toBe(2);
    expect(overlapMs({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(0);
  });

  it("(b) the hand-computed resolution window: 7h wall − 1.5h paused = 5.5h", () => {
    const pauses = pauseIntervals(PAUSES, T0 + 8 * HOUR);
    // [08:00, 15:00] = 25,200,000ms; both pauses fully inside → −5,400,000.
    expect(elapsedMs(T0, T0 + 7 * HOUR, pauses)).toBe(
      25_200_000 - 5_400_000,
    );
  });

  it("(c) pauses outside the window subtract nothing (the response window closes before any pause)", () => {
    const pauses = pauseIntervals(PAUSES, T0 + 8 * HOUR);
    // [08:00, 09:00] — both pauses open after 09:00 → the full hour counts.
    expect(elapsedMs(T0, T0 + 1 * HOUR, pauses)).toBe(HOUR);
  });

  it("(d) a pause straddling the window's end clamps at the end (the completed-while-paused law)", () => {
    // Paused 10:00→11:00 (closed), paused again 14:00 and NEVER resumed;
    // the window ends at 15:00 (completion), the fold's now is 16:00.
    // The open pause closes at now (16:00) but the WINDOW's clamp ends
    // it at 15:00: window [08:00, 15:00] = 7h wall; pause1 −1h (fully
    // inside); pause2 6h→8h clamps to 6h→7h = −1h → elapsed 5h.
    const pauses = pauseIntervals(
      [
        { at: T0 + 2 * HOUR, kind: "PAUSED" },
        { at: T0 + 3 * HOUR, kind: "RESUMED" },
        { at: T0 + 6 * HOUR, kind: "PAUSED" }, // never resumed
      ],
      T0 + 8 * HOUR,
    );
    expect(pauses).toEqual([
      { start: T0 + 2 * HOUR, end: T0 + 3 * HOUR },
      { start: T0 + 6 * HOUR, end: T0 + 8 * HOUR },
    ]);
    expect(elapsedMs(T0, T0 + 7 * HOUR, pauses)).toBe(5 * HOUR);
  });

  it("(e) inverted/empty windows and never-negative floors", () => {
    expect(elapsedMs(T0 + HOUR, T0, [])).toBe(0);
    expect(elapsedMs(T0, T0, [])).toBe(0);
    // A pause covering more than the window never yields a negative.
    expect(elapsedMs(T0, T0 + HOUR, [{ start: T0 - HOUR, end: T0 + 3 * HOUR }])).toBe(0);
  });
});

describe("W-12 fieldservice-math — evaluateSlaClocks (the single clock)", () => {
  const NOW = T0 + 8 * HOUR;
  const pauses = pauseIntervals(PAUSES, NOW);
  const base = {
    dispatchedAt: at(0),
    firstRespondedAt: at(1),
    completedAt: at(7),
    pauses,
    now: NOW,
  };

  it("(a) the hand-computed world: response 1h, resolution 5.5h, pausedMs split per window", () => {
    const clocks = evaluateSlaClocks({ ...base, targets: null });
    expect(clocks.response.running).toBe(true);
    expect(clocks.response.elapsedMs).toBe(HOUR);
    expect(clocks.response.pausedMs).toBe(0);
    expect(clocks.response.endedAt).toBe(T0 + HOUR);
    expect(clocks.resolution.running).toBe(true);
    expect(clocks.resolution.elapsedMs).toBe(19_800_000);
    expect(clocks.resolution.pausedMs).toBe(5_400_000);
    expect(clocks.resolution.endedAt).toBe(T0 + 7 * HOUR);
  });

  it("(b) targets: within → not breached; over → breached with the exact overage", () => {
    // Response target 1h: elapsed exactly 1h → AT target, not over
    // (breach is strict inequality — the honest boundary).
    const atTarget = evaluateSlaClocks({
      ...base,
      targets: { responseTargetMs: HOUR, resolutionTargetMs: 6 * HOUR },
    });
    expect(atTarget.response.breached).toBe(false);
    expect(atTarget.response.overMs).toBe(0);
    expect(atTarget.resolution.breached).toBe(false);
    // Resolution target 5h: elapsed 5.5h → breached by 0.5h.
    const over = evaluateSlaClocks({
      ...base,
      targets: { responseTargetMs: HOUR, resolutionTargetMs: 5 * HOUR },
    });
    expect(over.resolution.breached).toBe(true);
    expect(over.resolution.overMs).toBe(HOUR / 2);
    // The response clock is independent: still at target.
    expect(over.response.breached).toBe(false);
  });

  it("(c) NO_TARGET (null register) is the honest absence — never a fabricated breach", () => {
    const clocks = evaluateSlaClocks({ ...base, targets: null });
    expect(clocks.response.targetMs).toBeNull();
    expect(clocks.response.breached).toBe(false);
    expect(clocks.resolution.targetMs).toBeNull();
    expect(clocks.resolution.breached).toBe(false);
  });

  it("(d) undispatched visits never start a clock (running false, zero elapsed)", () => {
    const clocks = evaluateSlaClocks({
      dispatchedAt: null,
      firstRespondedAt: null,
      completedAt: null,
      pauses: [],
      now: NOW,
      targets: { responseTargetMs: HOUR, resolutionTargetMs: HOUR },
    });
    expect(clocks.response.running).toBe(false);
    expect(clocks.response.elapsedMs).toBe(0);
    expect(clocks.resolution.running).toBe(false);
    expect(clocks.resolution.elapsedMs).toBe(0);
    expect(clocks.response.breached).toBe(false);
  });

  it("(e) pending edges read to now: response pending on a DISPATCHED visit, resolution pending pre-completion", () => {
    // Dispatched at T0, neither responded nor completed, no pauses, now +2h.
    const clocks = evaluateSlaClocks({
      dispatchedAt: at(0),
      firstRespondedAt: null,
      completedAt: null,
      pauses: [],
      now: T0 + 2 * HOUR,
      targets: { responseTargetMs: HOUR, resolutionTargetMs: 10 * HOUR },
    });
    expect(clocks.response.endedAt).toBeNull();
    expect(clocks.response.elapsedMs).toBe(2 * HOUR);
    expect(clocks.response.breached).toBe(true); // 2h > 1h target
    expect(clocks.resolution.elapsedMs).toBe(2 * HOUR);
    expect(clocks.resolution.breached).toBe(false);
  });

  it("(f) a live pause freezes both pending clocks", () => {
    // Dispatched T0, paused T0+1h, STILL paused at now T0+3h: the open
    // pause closes at now → the interval [1h, 3h] = 2h of pause inside
    // each 3h window → each pending clock reads 3h − 2h = 1h (the clock
    // ran T0→T0+1h then froze — THE HAND-SLIP CORRECTED AT THE CLAIM
    // SITE: the first draft of this arm mis-stated the pause as one
    // hour; it lasts from the pause event to now, two hours).
    const live = pauseIntervals([{ at: T0 + HOUR, kind: "PAUSED" }], T0 + 3 * HOUR);
    expect(live).toEqual([{ start: T0 + HOUR, end: T0 + 3 * HOUR }]);
    const clocks = evaluateSlaClocks({
      dispatchedAt: at(0),
      firstRespondedAt: null,
      completedAt: null,
      pauses: live,
      now: T0 + 3 * HOUR,
      targets: null,
    });
    expect(clocks.response.elapsedMs).toBe(HOUR);
    expect(clocks.resolution.elapsedMs).toBe(HOUR);
    expect(clocks.response.pausedMs).toBe(2 * HOUR);
    expect(clocks.resolution.pausedMs).toBe(2 * HOUR);
  });

  it("(g) the completed clock is FROZEN — a later now never moves a frozen reading", () => {
    const frozenAt8 = evaluateSlaClocks({ ...base, targets: null });
    const frozenAt12 = evaluateSlaClocks({
      ...base,
      pauses: pauseIntervals(PAUSES, T0 + 12 * HOUR),
      now: T0 + 12 * HOUR,
      targets: null,
    });
    expect(frozenAt12.response.elapsedMs).toBe(frozenAt8.response.elapsedMs);
    expect(frozenAt12.resolution.elapsedMs).toBe(frozenAt8.resolution.elapsedMs);
    expect(frozenAt12.resolution.pausedMs).toBe(frozenAt8.resolution.pausedMs);
  });
});

describe("W-12 fieldservice-math — escalationDecisions (BR-096)", () => {
  it("(a) lists exactly the breached-with-target clocks, response first, with the once-per-event dedupe keys", () => {
    const clocks = evaluateSlaClocks({
      dispatchedAt: at(0),
      firstRespondedAt: at(2), // 2h response — target 1h → breached
      completedAt: null,
      pauses: [],
      now: T0 + 4 * HOUR,
      targets: { responseTargetMs: HOUR, resolutionTargetMs: 10 * HOUR },
    });
    const decisions = escalationDecisions("visit-1", clocks);
    expect(decisions).toEqual([
      {
        clock: "RESPONSE",
        overMs: HOUR,
        dedupeKey: "fieldservice-sla-breach:visit-1:RESPONSE",
      },
    ]);
    // Both clocks breached → both listed, response first.
    const both = escalationDecisions(
      "visit-1",
      evaluateSlaClocks({
        dispatchedAt: at(0),
        firstRespondedAt: at(2),
        completedAt: null,
        pauses: [],
        now: T0 + 12 * HOUR,
        targets: { responseTargetMs: HOUR, resolutionTargetMs: 10 * HOUR },
      }),
    );
    expect(both.map((d) => d.clock)).toEqual(["RESPONSE", "RESOLUTION"]);
  });

  it("(b) no targets → no escalations (the fail-closed register)", () => {
    const clocks = evaluateSlaClocks({
      dispatchedAt: at(0),
      firstRespondedAt: at(2),
      completedAt: null,
      pauses: [],
      now: T0 + 4 * HOUR,
      targets: null,
    });
    expect(escalationDecisions("visit-1", clocks)).toEqual([]);
  });
});

describe("W-12 fieldservice-math — hoursToMs (the register's single conversion)", () => {
  it("converts fractional hours exactly", () => {
    expect(hoursToMs(1)).toBe(HOUR);
    expect(hoursToMs(0.5)).toBe(1_800_000);
    expect(hoursToMs(48)).toBe(48 * HOUR);
    expect(hoursToMs(1.25)).toBe(4_500_000);
  });
});
