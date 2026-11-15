import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import {
  OvertimeEntryInvalidError,
  OvertimeEntryNotFoundError,
  OvertimeEntryResolvedError,
  OvertimeRuleInactiveError,
  OvertimeRuleInvalidError,
  OvertimeRuleNotFoundError,
  OvertimeTierAmbiguousError,
  OvertimeTierUnavailableError,
} from "../domain/overtime-errors";
import { EmployeeNotFoundError } from "../domain/hr-errors";
import * as store from "../infrastructure/overtime.store";
import { employeeExists } from "../infrastructure/hr.store";

/**
 * PHASE-045 (T-06) — the overtime engine: the multiplier-tier rules
 * (HR-03), the tier matching, the multiplier application, and the
 * pre-approval enforcement (BR-084).
 *
 * THE TIER-MATCHING LAW (a work date resolves to exactly ONE tier):
 *   HOLIDAY  the tenant-jurisdiction calendar has a holiday on the
 *            date (the attendance derivation's law — the same query);
 *   WEEKEND  the date's ISO weekday (Monday=0…Sunday=6, the rotation
 *            pattern's index convention) is in the tenant's
 *            `hr.overtime.weekend_days` setting — a setting with NO
 *            fabricated default (empty until configured: the BR-055
 *            discipline — inventing "Sat/Sun" would be wrong for
 *            Saudi and wrong for others; the jurisdiction regime is
 *            PHASE-046's verification world). While empty the WEEKEND
 *            tier never auto-matches;
 *   WEEKDAY  the complement — neither a holiday nor a configured
 *            weekend day.
 * More than one ACTIVE rule on the resolved tier is an AMBIGUITY —
 * the typed refusal, never a silent first-pick; NO active rule on the
 * tier is the typed unavailability. The entry's rule may ALSO be
 * named EXPLICITLY (the schema's law — rule_id is the entry's own
 * fact; the suggestion is a convenience, never a guess written
 * silently).
 *
 * BR-084 (the pre-approval enforcement): a pre-approval-required
 * rule's PENDING entry carries is_exception = true (the exception
 * board's feed — unapproved required time is NEVER silently fed); the
 * APPROVE decision clears it (the time is sanctioned); the REJECT
 * decision clears it too (the time is refused — a decided verdict,
 * not an open exception). A rule WITHOUT the pre-approval requirement
 * records post-hoc worked time: PENDING is not an exception (the
 * entry feeds; REJECTED never feeds).
 *
 * THE PER-DAY CAP: a rule's max_hours_per_day bounds the employee's
 * SANCTIONABLE day-total under THAT rule (PENDING + APPROVED entries
 * — REJECTED time never counts), enforced typed BEFORE any write; the
 * 16h-per-entry bound is the DB's CHECK floor.
 *
 * THE MULTIPLIER APPLICATION: hours × multiplier is computed in SQL
 * numeric math (exact — the pay-relevant product never rides float;
 * ADR-0009).
 *
 * Overtime is NOT a ledger document (the posting canon's note — the
 * payroll variable feeds, T-10, consume the approved rows as PHASE-
 * 046's variable lines).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[\w\-. ]{1,32}$/;

/** hours/multiplier bounds as decimal STRINGS (exact — never float). */
const HOURS_RE = /^\d{1,3}(\.\d{1,2})?$/;
const MULTIPLIER_RE = /^\d(\.\d{1,2})?$/;

function isoDate(date: string, what: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new OvertimeEntryInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${date}`);
  }
  return date;
}

/** ISO weekday: Monday = 0 … Sunday = 6 (the pattern index). */
function isoWeekday(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function intParam(value: number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/** A non-negative decimal-hours string within a bound — exact string
 * validation, never Number() float parsing (ADR-0009's law). */
function decimalHours(value: unknown, what: string, max: number): string {
  if (typeof value !== "string" || !HOURS_RE.test(value)) {
    throw new OvertimeEntryInvalidError(`${what} must be a decimal string like "2.50": ${String(value)}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
  if (scaled <= 0 || scaled > max * 100) {
    throw new OvertimeEntryInvalidError(`${what} must be within (0 … ${max}]: ${value}`);
  }
  return value;
}

function multiplierString(value: unknown): string {
  if (typeof value !== "string" || !MULTIPLIER_RE.test(value)) {
    throw new OvertimeRuleInvalidError(`multiplier must be a decimal string like "1.50" (1–5): ${String(value)}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
  if (scaled < 100 || scaled > 500) {
    throw new OvertimeRuleInvalidError(`multiplier must be within [1 … 5]: ${value}`);
  }
  return value;
}

@Injectable()
export class OvertimeService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- the rules ------------------------------------------------------------------------

  async createRule(input: {
    code: string;
    name: string;
    nameAr: string | null;
    tier: "WEEKDAY" | "WEEKEND" | "HOLIDAY";
    multiplier: string;
    preApprovalRequired: boolean;
    maxHoursPerDay: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<store.OvertimeRuleRow> {
    if (!CODE_RE.test(input.code)) {
      throw new OvertimeRuleInvalidError(`rule code must be 1–32 chars (letters, digits, dash, dot, space): ${input.code}`);
    }
    if (input.name.length < 1 || input.name.length > 120) {
      throw new OvertimeRuleInvalidError(`rule name must be 1–120 chars: ${input.name}`);
    }
    const multiplier = multiplierString(input.multiplier);
    if (input.maxHoursPerDay !== null) {
      // The rule-side cap bounds (the 0082 CHECKs surfaced as the RULE
      // error family — never the entry family).
      if (typeof input.maxHoursPerDay !== "string" || !HOURS_RE.test(input.maxHoursPerDay)) {
        throw new OvertimeRuleInvalidError(
          `maxHoursPerDay must be a decimal string like "4.00": ${String(input.maxHoursPerDay)}`,
        );
      }
      const [whole, fraction = ""] = input.maxHoursPerDay.split(".");
      const scaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
      if (scaled <= 0 || scaled > 1600) {
        throw new OvertimeRuleInvalidError(`maxHoursPerDay must be within (0 … 16]: ${input.maxHoursPerDay}`);
      }
    }
    if ((await store.findOvertimeRuleByCode(input.code)) !== undefined) {
      throw new OvertimeRuleInvalidError(`rule code ${input.code} is already used in this tenant`);
    }
    const created = await store.insertOvertimeRule({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      tier: input.tier,
      multiplier,
      preApprovalRequired: input.preApprovalRequired,
      maxHoursPerDay: input.maxHoursPerDay,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.overtime_rule_created",
      entityType: "overtime_rule",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, tier: created.tier, multiplier: created.multiplier, preApprovalRequired: created.preApprovalRequired },
    });
    return created;
  }

  async listRules(filter: { active?: boolean; limit: number }): Promise<store.OvertimeRuleRow[]> {
    return store.listOvertimeRules(filter);
  }

  async updateRule(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      multiplier?: string;
      preApprovalRequired?: boolean;
      maxHoursPerDay?: string | null;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.OvertimeRuleRow> {
    const current = await store.findOvertimeRuleById(id);
    if (current === undefined) throw new OvertimeRuleNotFoundError(id);
    const multiplier = patch.multiplier === undefined ? undefined : multiplierString(patch.multiplier);
    if (patch.maxHoursPerDay !== undefined && patch.maxHoursPerDay !== null) {
      if (typeof patch.maxHoursPerDay !== "string" || !HOURS_RE.test(patch.maxHoursPerDay)) {
        throw new OvertimeRuleInvalidError(
          `maxHoursPerDay must be a decimal string like "4.00": ${String(patch.maxHoursPerDay)}`,
        );
      }
      const [whole, fraction = ""] = patch.maxHoursPerDay.split(".");
      const scaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
      if (scaled <= 0 || scaled > 1600) {
        throw new OvertimeRuleInvalidError(`maxHoursPerDay must be within (0 … 16]: ${patch.maxHoursPerDay}`);
      }
    }
    if (patch.name !== undefined && (patch.name.length < 1 || patch.name.length > 120)) {
      throw new OvertimeRuleInvalidError(`rule name must be 1–120 chars: ${patch.name}`);
    }
    const updated = await store.patchOvertimeRule({
      id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
      ...(multiplier === undefined ? {} : { multiplier }),
      ...(patch.preApprovalRequired === undefined ? {} : { preApprovalRequired: patch.preApprovalRequired }),
      ...(patch.maxHoursPerDay === undefined ? {} : { maxHoursPerDay: patch.maxHoursPerDay }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
      ...(patch.noteAr === undefined ? {} : { noteAr: patch.noteAr }),
    });
    if (patch.maxHoursPerDay === null) {
      await store.clearOvertimeRuleCap(id);
    }
    const refreshed = updated === undefined ? undefined : await store.findOvertimeRuleById(id);
    if (refreshed === undefined) throw new OvertimeRuleNotFoundError(id);
    await this.audit.record({
      action: "hr.overtime_rule_updated",
      entityType: "overtime_rule",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { code: current.code, multiplier: current.multiplier, preApprovalRequired: current.preApprovalRequired },
      after: { code: refreshed.code, multiplier: refreshed.multiplier, preApprovalRequired: refreshed.preApprovalRequired },
    });
    return refreshed;
  }

  async setRuleActive(id: string, active: boolean, actorId: string | null): Promise<store.OvertimeRuleRow> {
    const current = await store.findOvertimeRuleById(id);
    if (current === undefined) throw new OvertimeRuleNotFoundError(id);
    const updated = await store.setOvertimeRuleActive(id, active);
    if (updated === undefined) throw new OvertimeRuleNotFoundError(id);
    await this.audit.record({
      action: active ? "hr.overtime_rule_activated" : "hr.overtime_rule_deactivated",
      entityType: "overtime_rule",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { code: updated.code, active },
    });
    return updated;
  }

  // -- the tier matching ------------------------------------------------------------------

  /** Resolve a work date to its tier + the matching ACTIVE rule (the
   * ambiguity and the unavailability are typed refusals — never a
   * silent pick). */
  async resolveTier(workDate: string): Promise<{
    tier: "WEEKDAY" | "WEEKEND" | "HOLIDAY";
    rule: store.OvertimeRuleRow;
    weekendDays: number[];
  }> {
    const date = isoDate(workDate, "workDate");
    const holidays = await store.holidaysBetween(date, date);
    const weekendDays = await store.readWeekendSetting();
    let tier: "WEEKDAY" | "WEEKEND" | "HOLIDAY";
    if (holidays.has(date)) {
      tier = "HOLIDAY";
    } else if (weekendDays.includes(isoWeekday(date))) {
      tier = "WEEKEND";
    } else {
      tier = "WEEKDAY";
    }
    const candidates = await store.listActiveRulesByTier(tier);
    if (candidates.length === 0) {
      throw new OvertimeTierUnavailableError(
        `no ACTIVE ${tier} overtime rule exists in this tenant (the date ${date} resolves to the ${tier} tier) — configure the tier's rule first`,
      );
    }
    if (candidates.length > 1) {
      throw new OvertimeTierAmbiguousError(
        `${candidates.length} ACTIVE ${tier} overtime rules exist (${candidates.map((rule) => rule.code).join(", ")}) — the tier match must be unambiguous; deactivate all but one`,
      );
    }
    return { tier, rule: candidates[0]!, weekendDays };
  }

  // -- the weekend setting -----------------------------------------------------------------

  async weekendDays(): Promise<{ weekendDays: number[]; configured: boolean }> {
    const days = await store.readWeekendSetting();
    return { weekendDays: days, configured: days.length > 0 };
  }

  async saveWeekendDays(days: readonly number[], actorId: string | null): Promise<{ weekendDays: number[] }> {
    const distinct = [...new Set(days)];
    if (distinct.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw new OvertimeRuleInvalidError(
        "weekendDays must be ISO weekday integers 0–6 (Monday=0 … Sunday=6), unique",
      );
    }
    await store.saveWeekendSetting(distinct, actorId);
    await this.audit.record({
      action: "hr.overtime_weekend_saved",
      entityType: "overtime_rule",
      entityId: generateUuidV7(),
      actorId: actorId ?? undefined,
      after: { weekendDays: distinct },
    });
    return { weekendDays: distinct };
  }

  // -- the entries ---------------------------------------------------------------------------

  async createEntry(input: {
    employeeId: string;
    workDate: string;
    hours: string;
    ruleId: string | null;
    note: string | null;
    actorId: string | null;
  }): Promise<store.OvertimeEntryRow> {
    const workDate = isoDate(input.workDate, "workDate");
    const hours = decimalHours(input.hours, "hours", 16);
    if (!(await employeeExists(input.employeeId))) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    // The rule: explicit, or the tier match (never a silent guess —
    // the typed tier errors surface).
    let rule: store.OvertimeRuleRow | undefined;
    if (input.ruleId !== null) {
      rule = await store.findOvertimeRuleById(input.ruleId);
      if (rule === undefined) throw new OvertimeRuleNotFoundError(input.ruleId);
    } else {
      rule = (await this.resolveTier(workDate)).rule;
    }
    if (!rule.active) {
      throw new OvertimeRuleInactiveError(rule.id);
    }
    // THE PER-DAY CAP (typed, before any write): the sanctionable
    // day-total under this rule (PENDING + APPROVED).
    if (rule.maxHoursPerDay !== null) {
      const [whole, fraction = ""] = hours.split(".");
      const newScaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
      const dayTotal = await store.dayTotalHoursUnderRule(input.employeeId, workDate, rule.id);
      const [tWhole, tFraction = ""] = dayTotal.split(".");
      const totalScaled = Number.parseInt(tWhole + tFraction.padEnd(2, "0"), 10);
      const [cWhole, cFraction = ""] = rule.maxHoursPerDay.split(".");
      const capScaled = Number.parseInt(cWhole + cFraction.padEnd(2, "0"), 10);
      if (totalScaled + newScaled > capScaled) {
        throw new OvertimeEntryInvalidError(
          `the per-day cap: the day's overtime total under rule ${rule.code} would reach ${hours} + ${dayTotal} = beyond the rule's max ${rule.maxHoursPerDay} hours`,
        );
      }
    }
    const entry = await store.insertOvertimeEntry({
      employeeId: input.employeeId,
      workDate,
      hours,
      ruleId: rule.id,
      status: "PENDING",
      // BR-084: a pre-approval-required rule's PENDING time is the
      // exception (never silently fed); a rule without the requirement
      // records post-hoc worked time — PENDING is not an exception.
      isException: rule.preApprovalRequired,
      note: input.note,
      requestedBy: input.actorId,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.overtime_entry_created",
      entityType: "overtime_entry",
      entityId: entry.id,
      actorId: input.actorId ?? undefined,
      after: { employeeId: input.employeeId, workDate, hours, rule: rule.code, tier: rule.tier, preApprovalRequired: rule.preApprovalRequired },
    });
    return entry;
  }

  /** The simple-approval decision: PENDING → APPROVED / REJECTED (the
   * decided stamps; BR-084's exception cleared — a decided verdict is
   * not an open exception). A decided entry never re-decides. */
  async decide(
    entryId: string,
    decision: { approve: boolean; note: string | null; actorId: string | null },
  ): Promise<store.OvertimeEntryRow> {
    const entry = await store.findOvertimeEntryById(entryId);
    if (entry === undefined) throw new OvertimeEntryNotFoundError(entryId);
    if (entry.status !== "PENDING") {
      throw new OvertimeEntryResolvedError(entryId, entry.status);
    }
    const decided = await store.decideOvertimeEntry({
      id: entryId,
      status: decision.approve ? "APPROVED" : "REJECTED",
      decidedBy: decision.actorId,
      decisionNote: decision.note,
      isException: false,
    });
    if (decided === undefined) throw new OvertimeEntryResolvedError(entryId, entry.status);
    await this.audit.record({
      action: decision.approve ? "hr.overtime_entry_approved" : "hr.overtime_entry_rejected",
      entityType: "overtime_entry",
      entityId: entryId,
      actorId: decision.actorId ?? undefined,
      before: { status: "PENDING", hours: entry.hours, rule: entry.ruleCode },
      after: { status: decided.status, hours: decided.hours, multipliedHours: decided.multipliedHours, note: decision.note },
    });
    return decided;
  }

  async listEntries(filter: {
    from: string;
    to: string;
    employeeIds?: readonly string[];
    status?: string;
    onlyExceptions?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{
    rows: store.OvertimeEntryRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const from = isoDate(filter.from, "from");
    const to = isoDate(filter.to, "to");
    if (to < from) {
      throw new OvertimeEntryInvalidError(`the range is inverted: ${from} → ${to}`);
    }
    if (filter.status !== undefined && !["PENDING", "APPROVED", "REJECTED"].includes(filter.status)) {
      throw new OvertimeEntryInvalidError(`unknown status filter: ${filter.status}`);
    }
    const page = Math.max(intParam(filter.page, 1), 1);
    const pageSize = Math.min(Math.max(intParam(filter.pageSize, 500), 1), 5000);
    const rows = await store.listOvertimeEntries({
      from,
      to,
      employeeIds: filter.employeeIds,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.onlyExceptions === undefined ? {} : { onlyExceptions: filter.onlyExceptions }),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = await store.countOvertimeEntries({
      from,
      to,
      employeeIds: filter.employeeIds,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.onlyExceptions === undefined ? {} : { onlyExceptions: filter.onlyExceptions }),
    });
    return { rows, page, pageSize, total, hasMore: page * pageSize < total };
  }
}
