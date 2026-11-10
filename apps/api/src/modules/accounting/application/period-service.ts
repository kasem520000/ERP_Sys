import { Inject, Injectable } from "@nestjs/common";

import { publishLedgerEvent } from "./ledger-events";
import { requireTenantContext } from "../../../infra/db/tenant-context";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/accounting.store";
import * as journal from "../infrastructure/journal.store";
import {
  FiscalYearExistsError,
  FiscalYearNotFoundError,
  FiscalYearOverlapError,
  PeriodNotFoundError,
  PeriodReopenReasonRequiredError,
  PeriodStateError,
  ReconciliationBrokenError,
} from "../domain/accounting-errors";

/**
 * Fiscal calendar service (PHASE-007 T4; PERIOD_CLOSING.md §1/§4): year
 * creation (12 REGULAR periods + OPENING/CLOSING special windows, idempotent
 * by name, N+1-while-N-open), state transitions OPEN → SOFT_CLOSED → LOCKED
 * with audit, the soft-close posting precondition, reopen (+ anti-fraud
 * alert on >2-month-old periods, INV-020), and the PC-04 lock gate over
 * core reconciliation checks.
 */

@Injectable()
export class PeriodService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async listYears() {
    return store.listFiscalYears();
  }

  async listPeriods(fiscalYearId?: string) {
    return store.listPeriods(fiscalYearId);
  }

  async getYear(id: string): Promise<store.FiscalYearRow> {
    const year = await store.findFiscalYearById(id);
    if (year === undefined) throw new FiscalYearNotFoundError(id);
    return year;
  }

  async getPeriod(id: string): Promise<store.FiscalPeriodRow> {
    const period = await store.findPeriodById(id);
    if (period === undefined) throw new PeriodNotFoundError(id);
    return period;
  }

  /**
   * Create a fiscal year + its periods. Idempotent by (tenant, name):
   * re-creating an existing year returns it (PERIOD_CLOSING §4 — "period
   * creation is idempotent and generates no journal effects"). Creating
   * N+1 while N is still open is normal business (§4). REGULAR periods are
   * the 12 calendar months; OPENING = the day before the year starts
   * (opening balances post there); CLOSING = the year-end date itself (the
   * year-end close entry posts there explicitly while regular periods are
   * locked — date resolution still prefers REGULAR).
   */
  async createYear(
    actorId: string,
    input: { name: string; startDate: string; endDate: string },
  ): Promise<store.FiscalYearRow> {
    const existing = await store.findFiscalYearByName(input.name);
    if (existing !== undefined) {
      // Idempotent replay — same window expected, otherwise a hard error.
      if (existing.startDate !== input.startDate || existing.endDate !== input.endDate) {
        throw new FiscalYearExistsError(input.name);
      }
      return existing;
    }
    // Overlap guard among REGULAR months (the exclusion constraint also
    // enforces it at the DB level — this is the friendly typed error).
    for (const year of await store.listFiscalYears()) {
      const overlaps = input.startDate <= year.endDate && input.endDate >= year.startDate;
      if (overlaps) throw new FiscalYearOverlapError(input.name);
    }
    const created = await store.insertFiscalYear(input);
    const start = new Date(`${input.startDate}T00:00:00Z`);
    const end = new Date(`${input.endDate}T00:00:00Z`);
    if (end < start) throw new PeriodStateError("year end precedes year start");
    // OPENING: the day before the year (G-16's posting window).
    const openingDate = new Date(start);
    openingDate.setUTCDate(openingDate.getUTCDate() - 1);
    await store.insertPeriod({
      fiscalYearId: created.id,
      name: `${input.name}-OPENING`,
      kind: "OPENING",
      startDate: openingDate.toISOString().slice(0, 10),
      endDate: openingDate.toISOString().slice(0, 10),
    });
    // 12 REGULAR months.
    const cursor = new Date(start);
    let index = 0;
    while (cursor <= end && index < 12) {
      index += 1;
      const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      const sliceEnd = monthEnd <= end ? monthEnd : end;
      await store.insertPeriod({
        fiscalYearId: created.id,
        name: `${input.name}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
        kind: "REGULAR",
        startDate: monthStart.toISOString().slice(0, 10),
        endDate: sliceEnd.toISOString().slice(0, 10),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    if (index !== 12) {
      throw new PeriodStateError(`a fiscal year must span 12 monthly periods (got ${index})`);
    }
    // CLOSING: the year-end adjustment window (year-end close posts here).
    await store.insertPeriod({
      fiscalYearId: created.id,
      name: `${input.name}-CLOSING`,
      kind: "CLOSING",
      startDate: input.endDate,
      endDate: input.endDate,
    });
    await this.audit.record({
      action: "accounting.fiscal_year_created",
      entityType: "fiscal_year",
      entityId: created.id,
      actorId,
      after: { name: created.name, start: created.startDate, end: created.endDate },
    });
    return created;
  }

  /** OPEN → SOFT_CLOSED (warning state; posting needs permission + reason). */
  async softClose(actorId: string, periodId: string): Promise<store.FiscalPeriodRow> {
    const period = await store.findPeriodById(periodId);
    if (period === undefined) throw new PeriodNotFoundError(periodId);
    if (period.status !== "OPEN") {
      throw new PeriodStateError(`period ${period.name} is ${period.status}, not OPEN`);
    }
    const updated = await store.setPeriodStatus(periodId, "SOFT_CLOSED", actorId);
    await this.audit.record({
      action: "accounting.period_soft_closed",
      entityType: "fiscal_period",
      entityId: periodId,
      actorId,
      before: { status: "OPEN" },
      after: { status: "SOFT_CLOSED" },
    });
    return updated!;
  }

  /**
   * SOFT_CLOSED → LOCKED. PC-04: the lock is refused while a CORE
   * reconciliation check (AR/AP at this phase) is BROKEN.
   */
  async lock(actorId: string, periodId: string): Promise<store.FiscalPeriodRow> {
    const period = await store.findPeriodById(periodId);
    if (period === undefined) throw new PeriodNotFoundError(periodId);
    if (period.status === "LOCKED") return period;
    if (period.status !== "SOFT_CLOSED") {
      throw new PeriodStateError(
        `period ${period.name} must be SOFT_CLOSED before LOCK (got ${period.status})`,
      );
    }
    const runs = await journal.latestReconciliationRuns(period.endDate);
    for (const run of runs) {
      // PC-04: BROKEN core checks block LOCK — AR/AP (PHASE-007) + CASH
      // (PHASE-008 INV-019/RC-08 — treasury registers its check here) + VAT
      // (PHASE-009 INV-012/RC-06 — the tax module registers its check here)
      // + GRNI (PHASE-011 RC-09 — the purchasing module registers its check
      // here) + WIP (PHASE-018 §11 — the manufacturing module registers its
      // INV-010 extension here) + FIXED_ASSETS (PHASE-026 RC-10 — the
      // fixed-assets register reconciliation registers here) + NOTES
      // (PHASE-027 RC-11 — the notes register reconciliation registers here).
      if (
        run.status === "BROKEN" &&
        (run.kind === "AR" ||
          run.kind === "AP" ||
          run.kind === "CASH" ||
          run.kind === "VAT" ||
          run.kind === "INVENTORY" ||
          run.kind === "GRNI" ||
          run.kind === "WIP" ||
          run.kind === "FIXED_ASSETS" ||
          run.kind === "NOTES")
      ) {
        throw new ReconciliationBrokenError({ kind: run.kind, diffCount: run.diffCount });
      }
    }
    const updated = await store.setPeriodStatus(periodId, "LOCKED", actorId);
    // PHASE-013: ledger event for reporting cache invalidation.
    publishLedgerEvent({
      type: "period.locked",
      tenantId: requireTenantContext().tenantId,
      periodId,
    });
    await this.audit.record({
      action: "accounting.period_locked",
      entityType: "fiscal_period",
      entityId: periodId,
      actorId,
      before: { status: "SOFT_CLOSED" },
      after: { status: "LOCKED" },
    });
    return updated!;
  }

  /**
   * Reopen (INV-020): permission `accounting.periods.reopen` is enforced at
   * the route; the service demands the reason + writes the audit event and
   * raises the anti-fraud alert flag when the period is older than 2 months
   * (PERIOD_CLOSING §2).
   */
  async reopen(
    actorId: string,
    periodId: string,
    reason: string,
  ): Promise<{ period: store.FiscalPeriodRow; antiFraudAlert: boolean }> {
    if (reason === undefined || reason.trim() === "") {
      throw new PeriodReopenReasonRequiredError();
    }
    const period = await store.findPeriodById(periodId);
    if (period === undefined) throw new PeriodNotFoundError(periodId);
    if (period.status === "OPEN") {
      throw new PeriodStateError(`period ${period.name} is already OPEN`);
    }
    const updated = await store.recordPeriodReopen(periodId, actorId, reason.trim());
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2);
    const antiFraudAlert = new Date(`${period.endDate}T00:00:00Z`) < twoMonthsAgo;
    await this.audit.record({
      action: "accounting.period_reopened",
      entityType: "fiscal_period",
      entityId: periodId,
      actorId,
      before: { status: period.status },
      after: { status: "OPEN", reason: reason.trim(), antiFraudAlert },
    });
    return { period: updated!, antiFraudAlert };
  }
}
