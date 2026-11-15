import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-06) — the overtime store: the multiplier-tier rules
 * (WEEKDAY/WEEKEND/HOLIDAY, the pre-approval flag, the per-day cap)
 * and the worked-overtime entries (the PENDING → APPROVED/REJECTED
 * simple-approval lifecycle, BR-084's exception surfacing). The
 * MULTIPLIED hours are computed in SQL numeric math (exact — never
 * float; ADR-0009's law applies to the pay-relevant product).
 *
 * The weekend definition is a TENANT SETTING (`hr.overtime.weekend_days`,
 * ISO weekday numbers Monday=0…Sunday=6 — the rotation pattern's index
 * convention) with NO fabricated default: the setting starts empty and
 * while empty the WEEKEND tier never auto-matches (inventing "Sat/Sun"
 * would be wrong for Saudi and wrong for others — the BR-055
 * discipline; the jurisdiction regime is PHASE-046's verification
 * world).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface OvertimeRuleRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  tier: "WEEKDAY" | "WEEKEND" | "HOLIDAY";
  multiplier: string;
  preApprovalRequired: boolean;
  maxHoursPerDay: string | null;
  active: boolean;
  note: string | null;
  noteAr: string | null;
}

export interface OvertimeEntryRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workDate: string;
  hours: string;
  ruleId: string;
  ruleCode: string;
  tier: string;
  multiplier: string;
  /** hours × multiplier — computed in SQL numeric math (exact). */
  multipliedHours: string;
  status: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  isException: boolean;
  note: string | null;
}

const RULE_COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", tier,
  multiplier::text AS "multiplier", pre_approval_required AS "preApprovalRequired",
  max_hours_per_day::text AS "maxHoursPerDay", active, note, note_ar AS "noteAr"
`;

const ENTRY_COLUMNS = sql`
  e.id, e.employee_id AS "employeeId", emp.code AS "employeeCode", emp.name AS "employeeName",
  e.work_date::text AS "workDate", e.hours::text AS "hours",
  e.rule_id AS "ruleId", r.code AS "ruleCode", r.tier, r.multiplier::text AS "multiplier",
  (e.hours * r.multiplier)::numeric(7,2)::text AS "multipliedHours",
  e.status, e.requested_by::text AS "requestedBy", e.decided_by::text AS "decidedBy",
  e.decided_at::text AS "decidedAt", e.decision_note AS "decisionNote",
  e.is_exception AS "isException", e.note
`;

// -- the rules ------------------------------------------------------------------------

export async function insertOvertimeRule(input: {
  code: string;
  name: string;
  nameAr: string | null;
  tier: "WEEKDAY" | "WEEKEND" | "HOLIDAY";
  multiplier: string;
  preApprovalRequired: boolean;
  maxHoursPerDay: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<OvertimeRuleRow> {
  await tenantTx().execute(sql`
    INSERT INTO overtime_rules (id, tenant_id, code, name, name_ar, tier, multiplier,
                                pre_approval_required, max_hours_per_day, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr},
            ${input.tier}::text, ${input.multiplier}::numeric(5,2), ${input.preApprovalRequired},
            ${input.maxHoursPerDay === null ? null : sql`${input.maxHoursPerDay}::numeric(5,2)`},
            ${input.note}, ${input.noteAr}, ${input.createdBy})
  `);
  const found = await findOvertimeRuleByCode(input.code);
  return found!;
}

export async function findOvertimeRuleById(id: string): Promise<OvertimeRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RULE_COLUMNS} FROM overtime_rules WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as OvertimeRuleRow[])[0];
}

export async function findOvertimeRuleByCode(code: string): Promise<OvertimeRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RULE_COLUMNS} FROM overtime_rules WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as OvertimeRuleRow[])[0];
}

export async function listOvertimeRules(filter: {
  active?: boolean;
  limit: number;
}): Promise<OvertimeRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RULE_COLUMNS} FROM overtime_rules
    WHERE (${filter.active ?? null}::boolean IS NULL OR active = ${filter.active ?? null})
    ORDER BY tier, code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as OvertimeRuleRow[];
}

export async function patchOvertimeRule(input: {
  id: string;
  code?: string;
  name?: string;
  nameAr?: string | null;
  multiplier?: string;
  preApprovalRequired?: boolean;
  maxHoursPerDay?: string | null;
  note?: string | null;
  noteAr?: string | null;
}): Promise<OvertimeRuleRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE overtime_rules SET
      code = COALESCE(${input.code ?? null}, code),
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      multiplier = COALESCE(${input.multiplier === undefined ? null : sql`${input.multiplier}::numeric(5,2)`}, multiplier),
      pre_approval_required = COALESCE(${input.preApprovalRequired ?? null}, pre_approval_required),
      max_hours_per_day = COALESCE(${input.maxHoursPerDay === undefined ? null : sql`${input.maxHoursPerDay}::numeric(5,2)`}, max_hours_per_day),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findOvertimeRuleById(input.id);
}

export async function setOvertimeRuleActive(id: string, active: boolean): Promise<OvertimeRuleRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE overtime_rules SET active = ${active}, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
  return findOvertimeRuleById(id);
}

/** Clear the per-day cap (an explicit null in the patch — COALESCE
 * cannot express "set to NULL", so the clear is its own statement). */
export async function clearOvertimeRuleCap(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE overtime_rules SET max_hours_per_day = NULL, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/** The active rules of ONE tier (the tier-matching candidates — more
 * than one active rule per tier is an ambiguity the service refuses
 * typed, never a silent first-pick). */
export async function listActiveRulesByTier(
  tier: "WEEKDAY" | "WEEKEND" | "HOLIDAY",
): Promise<OvertimeRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RULE_COLUMNS} FROM overtime_rules
    WHERE tier = ${tier}::text AND active
    ORDER BY code
  `);
  return rows.rows as unknown as OvertimeRuleRow[];
}

// -- the tier resolution ---------------------------------------------------------------

/** The tenant-jurisdiction holidays between two dates (the attendance
 * derivation's law — an ACTIVE calendar whose jurisdiction matches the
 * tenant's country). */
export async function holidaysBetween(from: string, to: string): Promise<Set<string>> {
  const rows = await tenantTx().execute<{ holidayDate: string }>(sql`
    SELECT h.holiday_date::text AS "holidayDate"
    FROM holidays h
    JOIN holiday_calendars c ON c.id = h.calendar_id
    WHERE c.active AND c.jurisdiction_code = (SELECT country_code FROM tenants WHERE id = erp.current_tenant_id())
      AND h.holiday_date >= ${from}::date AND h.holiday_date <= ${to}::date
  `);
  return new Set(rows.rows.map((row) => row.holidayDate));
}

export const WEEKEND_SETTING_KEY = "hr.overtime.weekend_days";

/** The tenant's weekend days (ISO weekday numbers, Monday=0…Sunday=6)
 * — EMPTY until configured (no fabricated default). */
export async function readWeekendSetting(): Promise<number[]> {
  const rows = await tenantTx().execute<{ value: { weekendDays?: unknown[] } }>(sql`
    SELECT value FROM tenant_settings
    WHERE key = ${WEEKEND_SETTING_KEY} AND tenant_id = erp.current_tenant_id()
    LIMIT 1
  `);
  const raw = rows.rows[0]?.value?.weekendDays;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6,
  );
}

export async function saveWeekendSetting(days: number[], updatedBy: string | null): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${WEEKEND_SETTING_KEY},
            ${JSON.stringify({ weekendDays: days })}::jsonb, ${updatedBy})
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
          updated_at = now(), version = tenant_settings.version + 1
  `);
}

// -- the entries ------------------------------------------------------------------------

export async function insertOvertimeEntry(input: {
  employeeId: string;
  workDate: string;
  hours: string;
  ruleId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  isException: boolean;
  note: string | null;
  requestedBy: string | null;
  createdBy: string | null;
}): Promise<OvertimeEntryRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO overtime_entries (id, tenant_id, employee_id, work_date, hours, rule_id,
                                  status, is_exception, note, requested_by, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.employeeId}, ${input.workDate}::date,
            ${input.hours}::numeric(7,2), ${input.ruleId}, ${input.status}::text,
            ${input.isException}, ${input.note}, ${input.requestedBy}, ${input.createdBy})
  `);
  const found = await findOvertimeEntryById(id);
  return found!;
}

export async function findOvertimeEntryById(id: string): Promise<OvertimeEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENTRY_COLUMNS}
    FROM overtime_entries e
    JOIN employees emp ON emp.id = e.employee_id
    JOIN overtime_rules r ON r.id = e.rule_id
    WHERE e.id = ${id}
    LIMIT 1
  `);
  const found = (rows.rows as unknown as OvertimeEntryRow[])[0];
  return found;
}

/** The day-total under ONE rule (PENDING + APPROVED — REJECTED time
 * never counts against the cap; the cap bounds the SANCTIONABLE day). */
export async function dayTotalHoursUnderRule(
  employeeId: string,
  workDate: string,
  ruleId: string,
): Promise<string> {
  const rows = await tenantTx().execute<{ total: string }>(sql`
    SELECT COALESCE(sum(hours), 0)::text AS total FROM overtime_entries
    WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date
      AND rule_id = ${ruleId} AND status <> 'REJECTED'
  `);
  return rows.rows[0]!.total;
}

export async function decideOvertimeEntry(input: {
  id: string;
  status: "APPROVED" | "REJECTED";
  decidedBy: string | null;
  decisionNote: string | null;
  isException: boolean;
}): Promise<OvertimeEntryRow | undefined> {
  const rows = await tenantTx().execute<{ id: string }>(sql`
    UPDATE overtime_entries SET
      status = ${input.status}::text, decided_by = ${input.decidedBy}, decided_at = now(),
      decision_note = ${input.decisionNote}, is_exception = ${input.isException},
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'PENDING'
    RETURNING id
  `);
  if ((rows.rows as unknown as { id: string }[])[0] === undefined) return undefined;
  return findOvertimeEntryById(input.id);
}

export async function listOvertimeEntries(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
  status?: string;
  onlyExceptions?: boolean;
  limit: number;
  offset: number;
}): Promise<OvertimeEntryRow[]> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`e.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const statusFilter = filter.status === undefined ? sql`true` : sql`e.status = ${filter.status}::text`;
  const exceptionFilter = filter.onlyExceptions === true ? sql`e.is_exception` : sql`true`;
  const rows = await tenantTx().execute(sql`
    SELECT ${ENTRY_COLUMNS}
    FROM overtime_entries e
    JOIN employees emp ON emp.id = e.employee_id
    JOIN overtime_rules r ON r.id = e.rule_id
    WHERE e.work_date >= ${filter.from}::date AND e.work_date <= ${filter.to}::date
      AND ${employeeFilter} AND ${statusFilter} AND ${exceptionFilter}
    ORDER BY e.work_date, emp.code
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);
  return rows.rows as unknown as OvertimeEntryRow[];
}

export async function countOvertimeEntries(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
  status?: string;
  onlyExceptions?: boolean;
}): Promise<number> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`e.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const statusFilter = filter.status === undefined ? sql`true` : sql`e.status = ${filter.status}::text`;
  const exceptionFilter = filter.onlyExceptions === true ? sql`e.is_exception` : sql`true`;
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM overtime_entries e
    WHERE e.work_date >= ${filter.from}::date AND e.work_date <= ${filter.to}::date
      AND ${employeeFilter} AND ${statusFilter} AND ${exceptionFilter}
  `);
  return rows.rows[0]!.n;
}
