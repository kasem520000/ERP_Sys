import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ResolveEffectiveConfigService } from "../../configuration/application/resolve/resolve-service";
import { RESOLVE_EFFECTIVE_CONFIG_SERVICE } from "../../configuration/application/resolve/resolve-service";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import { resolveSalesPrice } from "../../sales/application/pricing";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/crm.store";
import {
  ContractStateError,
  TimeEntryCaseRequiredError,
  TimeEntryInputInvalidError,
  TimeEntryNotFoundError,
  TimeEntryStateError,
  TimesheetEmptyError,
} from "../domain/crm-errors";

/**
 * Time-entry service (PHASE-019 T46; MASTER-PLAN §6): timeslips feed
 * contract billing ONLY (no payroll, no staff cost — the documented
 * limitation: profitability is fee-based). unitRate is SNAPSHOTTED at
 * recording (the contract partner's price-list price when resolvable via
 * the sales pricing seam, else manual input) and never recomputed —
 * determinism. Status DRAFT → APPROVED (the weekly review, batch) → BILLED
 * (the T47 billing run stamps billedInvoiceId) | VOID (DRAFT/APPROVED
 * only). Policy `crm.time_entries_require_case` makes projectId mandatory
 * (typed TIME_ENTRY_CASE_REQUIRED; the project must be OPEN — the §8
 * dimension's engine-parity errors).
 */

const HOURS_RE = /^\d+(\.\d{1,6})?$/;
const RATE_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateTimeEntryInput {
  entryDate: string;
  hours: string;
  /** A SERVICE item (the job-card LABOR mirror). */
  feeItemId: string;
  projectId: string | null;
  contractId: string | null;
  feeEarnerUserId: string | null;
  /** NULL ⇒ resolve the contract partner's price-list price; manual input
   * is required when no price resolves (§6 determinism). */
  unitRate: string | null;
  narrative: string | null;
  billable: boolean;
  actorId: string | null;
}

export interface UpdateTimeEntryInput {
  entryDate?: string;
  hours?: string;
  feeItemId?: string;
  projectId?: string | null;
  contractId?: string | null;
  feeEarnerUserId?: string | null;
  unitRate?: string;
  narrative?: string | null;
  billable?: boolean;
  actorId: string | null;
}

function canonicalDate(raw: string, what: string): string {
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new TimeEntryInputInvalidError(`${what} must be an ISO calendar date (YYYY-MM-DD): ${raw}`);
  }
  return raw;
}

/** The Monday of an ISO week (day 1 = Monday per ISO-8601). */
function isMonday(date: string): boolean {
  return new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

@Injectable()
export class TimeEntryService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: explicit @Inject — the vitest/esbuild pipeline does not emit
    // design:paramtypes (the JobCardService silent-undefined precedent).
    @Inject(RESOLVE_EFFECTIVE_CONFIG_SERVICE)
    private readonly resolveConfig: ResolveEffectiveConfigService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<store.TimeEntryRow> {
    const entry = await store.findTimeEntryById(id);
    if (entry === undefined) throw new TimeEntryNotFoundError(id);
    return entry;
  }

  async list(filter: {
    fromDate?: string;
    toDate?: string;
    projectId?: string;
    contractId?: string;
    /** The acting fee earner (the controller's `mine` resolved to the identity). */
    feeEarnerUserId?: string;
    limit: number;
  }): Promise<store.TimeEntryRow[]> {
    return store.listTimeEntries({
      fromDate: filter.fromDate,
      toDate: filter.toDate,
      projectId: filter.projectId,
      contractId: filter.contractId,
      feeEarnerUserId: filter.feeEarnerUserId,
      limit: filter.limit,
    });
  }

  // -- create (DRAFT) ------------------------------------------------------------

  async create(input: CreateTimeEntryInput): Promise<store.TimeEntryRow> {
    const entryDate = canonicalDate(input.entryDate, "entryDate");
    if (!HOURS_RE.test(input.hours) || new Decimal(input.hours).lessThanOrEqualTo(0)) {
      throw new TimeEntryInputInvalidError(
        `hours must be a positive decimal (≤ 6dp): ${input.hours}`,
      );
    }
    const hours = new Decimal(input.hours).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);

    // SERVICE items only — the job-card LABOR mirror (kind SERVICE).
    const item = await store.findItemForCrm(input.feeItemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new TimeEntryInputInvalidError(`fee item ${input.feeItemId} does not exist in this tenant`);
    }
    if (item.kind !== "SERVICE") {
      throw new TimeEntryInputInvalidError(
        `time entries reference SERVICE items — ${item.sku} is ${item.kind}`,
      );
    }

    // Policy crm.time_entries_require_case: projectId mandatory (§6) + the
    // project must be OPEN (the §8 dimension).
    const requireCase = await this.timeEntriesRequireCase();
    if (requireCase && input.projectId === null) {
      throw new TimeEntryCaseRequiredError();
    }
    if (input.projectId !== null) {
      const project = await accountingStore.findProjectById(input.projectId);
      if (project === undefined) {
        const { projectNotFound } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw projectNotFound({ projectId: input.projectId });
      }
      if (project.status !== "OPEN") {
        const { projectClosed } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw projectClosed({ projectId: input.projectId });
      }
    }

    // The optional contract link: ACTIVE only (§6).
    let contractPartnerId: string | null = null;
    if (input.contractId !== null) {
      const contract = await store.findContractById(input.contractId);
      if (contract === undefined) {
        throw new TimeEntryInputInvalidError(`contract ${input.contractId} does not exist in this tenant`);
      }
      if (contract.status !== "ACTIVE") {
        throw new ContractStateError(
          `contract ${input.contractId} is ${contract.status} — time entries link to ACTIVE contracts only`,
          { contractId: input.contractId, status: contract.status },
        );
      }
      contractPartnerId = contract.partnerId;
    }

    // The rate snapshot (§6): manual input wins; else the contract
    // partner's price resolution (sales/application/pricing — the BR-003
    // chain); a MANUAL source = unresolvable ⇒ manual input REQUIRED.
    let unitRate: string;
    if (input.unitRate !== null) {
      if (!RATE_RE.test(input.unitRate) || new Decimal(input.unitRate).lessThan(0)) {
        throw new TimeEntryInputInvalidError(
          `unit rate must be a non-negative decimal (≤ 6dp): ${input.unitRate}`,
        );
      }
      unitRate = new Decimal(input.unitRate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
    } else if (contractPartnerId !== null) {
      const resolved = await resolveSalesPrice({
        customerId: contractPartnerId,
        itemId: input.feeItemId,
        qty: hours,
      });
      if (resolved.source === "MANUAL") {
        throw new TimeEntryInputInvalidError(
          `no price-list price resolves for item ${item.sku} on the contract partner — a manual unitRate is required (the rate is snapshotted at recording)`,
        );
      }
      unitRate = new Decimal(resolved.unitPrice).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
    } else {
      throw new TimeEntryInputInvalidError(
        "a unitRate is required when the entry carries no contract (nothing to resolve a price-list price against)",
      );
    }

    const entry = await store.insertTimeEntry({
      entryDate,
      hours,
      feeItemId: input.feeItemId,
      projectId: input.projectId,
      contractId: input.contractId,
      feeEarnerUserId: input.feeEarnerUserId,
      unitRate,
      narrative: input.narrative,
      billable: input.billable,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "crm.time_entry.created",
      entityType: "time_entry",
      entityId: entry.id,
      actorId: input.actorId ?? undefined,
      after: {
        entryDate,
        hours,
        feeItemId: input.feeItemId,
        projectId: input.projectId,
        contractId: input.contractId,
        unitRate,
        billable: input.billable,
        status: entry.status,
      },
    });
    return entry;
  }

  // -- update (DRAFT only) ---------------------------------------------------------

  async update(id: string, patch: UpdateTimeEntryInput): Promise<store.TimeEntryRow> {
    const before = await this.find(id);
    if (before.status !== "DRAFT") {
      throw new TimeEntryStateError(
        `time entry ${id} is ${before.status} — only DRAFT entries accept edits`,
        { timeEntryId: id, status: before.status },
      );
    }
    if (patch.entryDate !== undefined) canonicalDate(patch.entryDate, "entryDate");
    if (patch.hours !== undefined) {
      if (!HOURS_RE.test(patch.hours) || new Decimal(patch.hours).lessThanOrEqualTo(0)) {
        throw new TimeEntryInputInvalidError(`hours must be a positive decimal (≤ 6dp): ${patch.hours}`);
      }
    }
    if (patch.feeItemId !== undefined) {
      const item = await store.findItemForCrm(patch.feeItemId);
      if (item === undefined || item.deletedAt !== null || item.kind !== "SERVICE") {
        throw new TimeEntryInputInvalidError(
          `time entries reference SERVICE items — ${patch.feeItemId} is not usable`,
        );
      }
    }
    if (patch.projectId !== undefined && patch.projectId !== null) {
      const project = await accountingStore.findProjectById(patch.projectId);
      if (project === undefined) {
        const { projectNotFound } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw projectNotFound({ projectId: patch.projectId });
      }
      if (project.status !== "OPEN") {
        const { projectClosed } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw projectClosed({ projectId: patch.projectId });
      }
    }
    if (patch.unitRate !== undefined) {
      if (!RATE_RE.test(patch.unitRate) || new Decimal(patch.unitRate).lessThan(0)) {
        throw new TimeEntryInputInvalidError(
          `unit rate must be a non-negative decimal (≤ 6dp): ${patch.unitRate}`,
        );
      }
    }
    // The case policy re-checks against the MERGED state (a patch that
    // clears the project on a case-required tenant is refused).
    const effectiveProjectId =
      patch.projectId !== undefined ? patch.projectId : before.projectId;
    const requireCase = await this.timeEntriesRequireCase();
    if (requireCase && effectiveProjectId === null) {
      throw new TimeEntryCaseRequiredError();
    }

    await store.patchTimeEntry({
      id,
      entryDate: patch.entryDate,
      hours:
        patch.hours !== undefined
          ? new Decimal(patch.hours).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6)
          : undefined,
      feeItemId: patch.feeItemId,
      projectId: patch.projectId,
      contractId: patch.contractId,
      feeEarnerUserId: patch.feeEarnerUserId,
      unitRate:
        patch.unitRate !== undefined
          ? new Decimal(patch.unitRate).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6)
          : undefined,
      narrative: patch.narrative,
      billable: patch.billable,
    });
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.time_entry.updated",
      entityType: "time_entry",
      entityId: id,
      actorId: patch.actorId ?? undefined,
      before: { hours: before.hours, narrative: before.narrative, billable: before.billable },
      after: { hours: after.hours, narrative: after.narrative, billable: after.billable },
    });
    return after;
  }

  // -- void (DRAFT/APPROVED only — §6) ----------------------------------------------

  async void(id: string, actorId: string | null): Promise<store.TimeEntryRow> {
    const before = await this.find(id);
    if (before.status !== "DRAFT" && before.status !== "APPROVED") {
      throw new TimeEntryStateError(
        `time entry ${id} is ${before.status} — only DRAFT/APPROVED entries void (BILLED entries are invoice history)`,
        { timeEntryId: id, status: before.status },
      );
    }
    await store.patchTimeEntry({ id, status: "VOID" });
    const after = await this.find(id);
    await this.audit.record({
      action: "crm.time_entry.voided",
      entityType: "time_entry",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: before.status },
      after: { status: after.status },
    });
    return after;
  }

  // -- the weekly review (§6 — the batch APPROVED flip) ------------------------------

  /**
   * `weekStart` is a Monday ISO date; the week is [weekStart, weekStart+6].
   * Flips the week's DRAFT entries → APPROVED (any fee earner — the
   * reviewer holds crm.contracts.manage); an empty week (no DRAFT entries)
   * is the typed TIMESHEET_EMPTY. Audited once as a batch.
   */
  async reviewTimesheet(input: { weekStart: string; actorId: string | null }): Promise<{
    weekStart: string;
    weekEnd: string;
    reviewed: number;
  }> {
    const weekStart = canonicalDate(input.weekStart, "weekStart");
    if (!isMonday(weekStart)) {
      throw new TimeEntryInputInvalidError(`weekStart must be a Monday (ISO-8601): ${weekStart}`);
    }
    const weekEnd = addDaysIso(weekStart, 6);
    const reviewedIds = await store.approveWeekTimeEntries(weekStart, weekEnd);
    if (reviewedIds.length === 0) {
      throw new TimesheetEmptyError(weekStart);
    }
    await this.audit.record({
      action: "crm.timesheet_reviewed",
      entityType: "time_entry",
      // Batch event — entity_id is a NOT NULL uuid, so the anchor is the
      // FIRST flipped row (the reservations-swept precedent); the window +
      // the full id list + the count ride the after-state.
      entityId: reviewedIds[0]!,
      actorId: input.actorId ?? undefined,
      after: { weekStart, weekEnd, reviewed: reviewedIds.length, timeEntryIds: reviewedIds },
    });
    return { weekStart, weekEnd, reviewed: reviewedIds.length };
  }

  // -- policy reads (§9) ---------------------------------------------------------

  /** Policy crm.time_entries_require_case (default true — §9). */
  async timeEntriesRequireCase(): Promise<boolean> {
    const tenantId = requireTenantContext().tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    return config.policies["crm.time_entries_require_case"] !== false;
  }
}
