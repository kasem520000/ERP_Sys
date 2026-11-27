/**
 * PHASE-052 (W-43 — the unit-first law, 2026-11-27) THE SLA FOLD
 * (D-08 — a PURE fold: no Date.now() anywhere in this path — the
 * owner's standing clock law «ساعة مثبتة أو خطوة مشتقة — لا
 * Date.now()+دلتا أبدًا»: every instant is a FIXED INPUT (the step's
 * own assignedAt, the sweep's DB-clock now), every date is a DERIVED
 * STEP from those inputs; the W-45 sweep derives its now from the
 * database's own clock in SQL, never from JS wall-clock arithmetic).
 *
 * THE DUE DATE (the derived step): `slaDueAt(assignedAt, slaHours)` —
 * the step's own assignment instant + the WHOLE hours (the 0127 floor:
 * sla_hours ≥ 1; the epoch math is absolute — no DST drift, the
 * timestamptz law).
 *
 * THE BREACH DETECTION: `isBreached(dueAt, now)` — the sweep's own
 * verdict over the PENDING/DELEGATED steps (the 0128 partial index's
 * own plane).
 *
 * THE STRUCTURAL DEDUPE (the 0111/0123 axes law — the 0129 floor's
 * uq_escalation_events_dedupe is its structural face):
 * `workflow:sla:{stepInstanceId}:{kind}:{dueDate}` — THE DAY AXIS IS
 * THE DUE DATE (never the current day — the convergence law: re-runs,
 * the nightly cron, and a raced concurrent pass all CONVERGE within a
 * cycle; one event per step + kind + day, EVER).
 *
 * THE REMINDER CADENCE (the settings registry's typed key
 * `workflow.escalation_reminder_hours` — fail-closed defaults): the
 * normalize fold keeps integer hours ≥ 1 (actual numbers plus STRICT
 * integer strings only — null/bool/floats/garbage all DROP, never
 * coerce: Number(null) === 0 would FABRICATE an immediate reminder —
 * the honest fold refuses the coercion class entirely); an empty or
 * garbage residue reads as the documented default (a tenant who
 * registers garbage never silently disables the reminders — the
 * fail-closed direction, the lc-sweep-math precedent verbatim).
 */

/** The documented default reminder cadence — ONE reminder per breached
 * step, one day (24h) after the due instant; the settings registry key
 * `workflow.escalation_reminder_hours` carries the same default (one
 * source, two declarations, the 0099 precedent's constant law); this
 * constant is what a tenant with NO stored row fails closed to. */
export const DEFAULT_ESCALATION_REMINDER_HOURS = 24;

/** The escalation event kinds (the 0129 floor's own vocabulary). */
export type EscalationKind = "REASSIGN" | "ADD_LEVEL" | "NOTIFY" | "REMINDER";

const INTEGER_RE = /^(0|[1-9][0-9]*)$/;

function parseHoursValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value === "string" && INTEGER_RE.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed >= 1 ? parsed : null;
  }
  return null;
}

/** Normalize a configured reminder cadence into the sweep's hour set
 * (the normalizeLcSweepWindows precedent's own copy — this module's
 * own home): keep integer hours ≥ 1, drop duplicates, sort ASCENDING.
 * Garbage never disables (an empty residue reads as the documented
 * default — the fail-closed direction). */
export function normalizeReminderHours(input: readonly unknown[]): number[] {
  const hours = [
    ...new Set(
      input
        .map((value) => parseHoursValue(value))
        .filter((hours): hours is number => hours !== null),
    ),
  ].sort((a, b) => a - b);
  return hours.length > 0 ? hours : [DEFAULT_ESCALATION_REMINDER_HOURS];
}

/** THE DUE DATE (the derived step): the assignment instant + whole
 * hours — absolute epoch math, no DST drift. The inputs are fixed
 * instants (the step's own stamps); no wall clock touches this fold. */
export function slaDueAt(assignedAt: string, slaHours: number): string {
  if (!Number.isInteger(slaHours) || slaHours < 1) {
    throw new RangeError("sla_hours must be a whole number ≥ 1 (the 0127 floor)");
  }
  return new Date(new Date(assignedAt).getTime() + slaHours * 3_600_000).toISOString();
}

/** THE BREACH VERDICT: the step's due instant has passed at the
 * sweep's own now (the DB clock — a fixed input here). */
export function isBreached(dueAt: string, now: string): boolean {
  return new Date(now).getTime() > new Date(dueAt).getTime();
}

/** Whether the reminder threshold has been crossed (the cadence hours
 * after the due instant — one reminder per cadence member, the dedupe
 * key below pins each). */
export function reminderDue(
  dueAt: string,
  now: string,
  reminderHours: readonly number[],
): boolean {
  const cadence = reminderHours.length > 0 ? reminderHours : [DEFAULT_ESCALATION_REMINDER_HOURS];
  const nowMs = new Date(now).getTime();
  const dueMs = new Date(dueAt).getTime();
  return cadence.some((hours) => nowMs >= dueMs + hours * 3_600_000);
}

/** THE DAY AXIS (the dedupe's own axis): the due instant's UTC date —
 * `YYYY-MM-DD` (the DB date law; the sweep writes the due_date column
 * from this fold, the 0129 row's own value). */
export function dueDateAxis(dueAt: string): string {
  return new Date(dueAt).toISOString().slice(0, 10);
}

/** THE STRUCTURAL DEDUPE KEY (the 0111/0123 axes law — the 0129
 * uq_escalation_events_dedupe's own key):
 * `workflow:sla:{stepInstanceId}:{kind}:{dueDate}` — the day axis the
 * DUE DATE (never the current day — the convergence law). */
export function escalationDedupeKey(
  stepInstanceId: string,
  kind: EscalationKind,
  dueAt: string,
): string {
  return `workflow:sla:${stepInstanceId}:${kind}:${dueDateAxis(dueAt)}`;
}
