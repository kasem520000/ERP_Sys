import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { ResolveEffectiveConfigService } from "../../configuration/application/resolve/resolve-service";
import { RESOLVE_EFFECTIVE_CONFIG_SERVICE } from "../../configuration/application/resolve/resolve-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import { readEffectiveSetting, ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/crm.store";
import type { TimeEntryRow } from "../infrastructure/crm.store";
import {
  AdvanceInsufficientOnAccountError,
  AdvanceStateError,
  ContractInputInvalidError,
  ContractNotFoundError,
  ContractStateError,
  ContractTermInvalidError,
} from "../domain/crm-errors";

/**
 * Contract service (PHASE-019 T46; MASTER-PLAN §4): the service-contract
 * lifecycle DRAFT → ACTIVE (CT-{YYYY}-{SEQ:5} reserve+bind at ACTIVATION —
 * the PRD release / job-card creation pattern) → CANCELLED (reason) |
 * RENEWED (a new DRAFT copy + the renewedToContractId link). Expiry is
 * DERIVED (status ACTIVE && endDate < today ⇒ `isExpired` in reads — no
 * state-flip job). The contract itself posts NOTHING (CAPABILITY_MATRIX
 * §2.8) except the policy-gated advance reclass (§1 row 4).
 *
 * The billing schedule grid (contract_billing_schedule) is the FEE-ITEM HOME
 * (§18 lesson 1 — 0027 has no contract-level fee_item_id): the create/update
 * input's contract-level `feeItemId` persists into the grid rows at write
 * time, and the update-path validation resolves the effective default from
 * the STORED grid (`resolveStoredFeeItem`) whenever a patch omits it.
 *
 * Grid semantics (§4, binding): RETAINER = calendar months clipped to the
 * term, billDate = period start (in advance), the FULL monthlyAmount per
 * period — NO proration; MILESTONE rows = the dated milestone lines
 * (billDate = the milestone date); HOURLY = one HOURLY_PERIOD per calendar
 * month, billDate = period END (arrears — time must exist), amount NULL.
 * Expansion is ADDITIVE + reconciling: insert missing keys, update existing
 * PLANNED rows, flip removed keys (milestone labels AND out-of-term period
 * keys) to SKIPPED — never delete, never touch INVOICED rows. It runs at
 * create, at update, and idempotently at activate.
 */

const CT_FORMAT = { prefix: "CT", format: "CT-{YYYY}-{SEQ:5}", docType: "service_contract" } as const;

const MONEY4_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The §4 fee models. */
export type FeeModel = "RETAINER" | "MILESTONES" | "HOURLY";

/** A dated milestone line (the MILESTONES grid source; §4). */
export interface MilestoneLineInput {
  label: string;
  labelAr: string | null;
  dueDate: string;
  amount: string;
  /** NULL → the contract-level default (input or the STORED grid — lesson 1). */
  feeItemId: string | null;
}

export interface CreateContractInput {
  partnerId: string;
  projectId: string | null;
  title: string;
  titleAr: string | null;
  scope: string | null;
  feeModel: FeeModel;
  startDate: string;
  endDate: string;
  monthlyAmount: string | null;
  /** The contract-level default fee item — persisted into the grid rows. */
  feeItemId: string | null;
  milestones: readonly MilestoneLineInput[] | null;
  currencyCode: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export interface UpdateContractInput {
  title?: string;
  titleAr?: string | null;
  scope?: string | null;
  projectId?: string | null;
  startDate?: string;
  endDate?: string;
  monthlyAmount?: string | null;
  /** Omitted ⇒ resolve the STORED grid default (§18 lesson 1). */
  feeItemId?: string | null;
  /** Full-replace; undefined = unchanged (skip the array checks — lesson 1). */
  milestones?: readonly MilestoneLineInput[] | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

/** A contract read: the stored row + the DERIVED expiry flag (§4). */
export interface ContractRead {
  contract: store.ContractRow;
  isExpired: boolean;
}

// -- the billing-preview contract (EXPORTED — the T47 surface, §11 row 26) --

/** One would-be invoice line of a due schedule entry (the run's mirror). */
export interface PreviewInvoiceLine {
  feeItemId: string;
  qty: string;
  unitPrice: string | null;
  description: string | null;
}

/** One due PLANNED entry (billDate <= asOf, no contract_invoices guard row). */
export interface ContractBillingPreviewItem {
  entry: store.ScheduleEntryRow;
  /** What the billing run WOULD invoice for this entry (§5's line shapes). */
  wouldInvoice: readonly PreviewInvoiceLine[];
  /** HOURLY periods: the pullable entries (§5's pull criteria + billable). */
  pullableTimeEntries: readonly TimeEntryRow[];
  /** HOURLY + policy crm.narrative_required_on_time_billing: the skipped
   * narrative-less entries — listed, never silently billed (§5). */
  needsNarrative: readonly TimeEntryRow[];
  /** The entry's billDate fiscal period (PeriodService read); "NONE" = no
   * period covers the date (the run must skip — posting would fail). */
  periodStatus: "OPEN" | "SOFT_CLOSED" | "LOCKED" | "NONE";
  /** True iff periodStatus === "LOCKED" (INV-011 — dead drafts refused). */
  periodLocked: boolean;
}

export interface ContractBillingPreview {
  contractId: string;
  asOf: string;
  items: readonly ContractBillingPreviewItem[];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function canonicalDate(raw: string, what: string): string {
  if (!DATE_RE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new ContractTermInvalidError(`${what} must be an ISO calendar date (YYYY-MM-DD): ${raw}`);
  }
  return raw;
}

/** UTC day math (deterministic — never rides the host clock/timezone). */
function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole-day difference (dates are exact UTC midnights — no drift). */
function daysBetween(from: string, to: string): number {
  return Number((BigInt(Date.parse(`${to}T00:00:00Z`)) - BigInt(Date.parse(`${from}T00:00:00Z`))) / 86_400_000n);
}

/** The calendar months of [start, end], each clipped to the term (§4). */
function clippedCalendarMonths(
  startDate: string,
  endDate: string,
): Array<{ periodKey: string; periodStart: string; periodEnd: string }> {
  const months: Array<{ periodKey: string; periodStart: string; periodEnd: string }> = [];
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const termEnd = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= termEnd) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)); // the last day
    const periodStart =
      monthStart.getTime() <= Date.parse(`${startDate}T00:00:00Z`) ? startDate : monthStart.toISOString().slice(0, 10);
    const periodEnd = monthEnd > termEnd ? endDate : monthEnd.toISOString().slice(0, 10);
    months.push({
      periodKey: `${year}-${String(month + 1).padStart(2, "0")}`,
      periodStart,
      periodEnd,
    });
    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
  return months;
}

/** The fee models a billing-mode policy value allows (§9 — the mode names
 * the allowed set; enforced at create/update as the policy's consumer). */
function modelsAllowedByBillingMode(mode: string): readonly FeeModel[] {
  if (mode === "retainer") return ["RETAINER"];
  if (mode === "milestones") return ["MILESTONES"];
  if (mode === "hourly") return ["HOURLY"];
  return ["RETAINER", "MILESTONES"]; // retainer_or_milestones (the default)
}

/**
 * The validated fee-model state (the create/update shared core). §18 lesson
 * 1: `milestones === undefined` means "unchanged — skip the array checks";
 * the contract-level fee item resolves input-first, then the STORED grid.
 */
interface ValidatedFeeModel {
  feeModel: FeeModel;
  monthlyAmount: string | null;
  effectiveFeeItemId: string;
  /** Normalized milestone lines (fee items resolved) — undefined = unchanged. */
  milestones:
    | readonly {
        label: string;
        labelAr: string | null;
        dueDate: string;
        amount: string;
        feeItemId: string;
      }[]
    | undefined;
}

@Injectable()
export class ContractService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject — the vitest/esbuild
    // pipeline does not emit design:paramtypes (the JobCardService
    // silent-undefined precedent). All tokens are exported by the imported
    // modules (CrmModule imports Accounting/Configuration/Audit).
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(RESOLVE_EFFECTIVE_CONFIG_SERVICE)
    private readonly resolveConfig: ResolveEffectiveConfigService,
  ) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<ContractRead> {
    const contract = await store.findContractById(id);
    if (contract === undefined) throw new ContractNotFoundError(id);
    return withDerivedExpiry(contract);
  }

  async list(filter: { status?: string; partnerId?: string; limit: number }): Promise<ContractRead[]> {
    const rows = await store.listContracts(filter);
    return rows.map(withDerivedExpiry);
  }

  async listSchedule(contractId: string): Promise<store.ScheduleEntryRow[]> {
    await this.find(contractId);
    return store.listScheduleByContract(contractId);
  }

  async listAdvances(contractId: string): Promise<store.ContractAdvanceRow[]> {
    await this.find(contractId);
    return store.listContractAdvances(contractId);
  }

  async listContractInvoices(filter: {
    contractId?: string;
    status?: string;
    limit: number;
  }): Promise<store.ContractInvoiceRow[]> {
    return store.listContractInvoices(filter);
  }

  // -- create (DRAFT) ------------------------------------------------------------

  async create(input: CreateContractInput): Promise<ContractRead> {
    const title = input.title.trim();
    if (title.length < 1 || title.length > 200) {
      throw new ContractInputInvalidError("contract title is required (1..200 characters)");
    }
    const startDate = canonicalDate(input.startDate, "startDate");
    const endDate = canonicalDate(input.endDate, "endDate");
    if (endDate < startDate) {
      throw new ContractTermInvalidError(
        `contract end ${endDate} precedes start ${startDate} (end >= start required)`,
      );
    }

    // §9: the tenant's billing mode names the allowed fee-model set.
    const mode = await this.billingMode();
    if (!modelsAllowedByBillingMode(mode).includes(input.feeModel)) {
      throw new ContractInputInvalidError(
        `fee model ${input.feeModel} is not allowed by this tenant's crm.contract_billing_mode (${mode})`,
      );
    }

    // The partner: a live customer-ish partner (the §2 conversion target
    // shape — CUSTOMER|BOTH; the findPartnerForCrm §6 probe).
    const partner = await store.findPartnerForCrm(input.partnerId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new ContractInputInvalidError(`partner ${input.partnerId} does not exist in this tenant`);
    }
    if (partner.kind !== "CUSTOMER" && partner.kind !== "BOTH") {
      throw new ContractInputInvalidError(
        `partner ${input.partnerId} is a ${partner.kind} — service contracts attach to CUSTOMER/BOTH partners`,
      );
    }

    // The project: optional; OPEN only (the §8 dimension, engine parity).
    if (input.projectId !== null) {
      await this.requireOpenProject(input.projectId);
    }

    // v1: the tenant base currency only.
    const base = await ownTenantBaseCurrency();
    const currencyCode = input.currencyCode ?? base;
    if (currencyCode !== base) {
      throw new ContractInputInvalidError(
        `currency ${currencyCode} is not the tenant base ${base} (service contracts are base-currency only in v1)`,
      );
    }

    // The fee model (lesson 1: create carries the contract-level default).
    const validated = this.validateFeeModel({
      feeModel: input.feeModel,
      monthlyAmount: input.monthlyAmount,
      feeItemId: input.feeItemId,
      milestones: input.milestones ?? undefined,
      storedDefaultFeeItem: undefined,
    });

    const contract = await store.insertContract({
      partnerId: input.partnerId,
      projectId: input.projectId,
      title,
      titleAr: input.titleAr,
      scope: input.scope,
      feeModel: input.feeModel,
      startDate,
      endDate,
      monthlyAmount: validated.monthlyAmount,
      currencyCode,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });

    // The grid write at create: persists the contract-level fee item into
    // the rows (the lesson-1 substrate) + the §4 expansion.
    await this.applySchedule(contract, validated);

    await this.audit.record({
      action: "crm.contract.created",
      entityType: "service_contract",
      entityId: contract.id,
      actorId: input.actorId ?? undefined,
      after: {
        title: contract.title,
        partnerId: contract.partnerId,
        feeModel: contract.feeModel,
        status: contract.status,
        startDate: contract.startDate,
        endDate: contract.endDate,
      },
    });
    return withDerivedExpiry(contract);
  }

  // -- activate (number + grid — the §4 lifecycle step) ---------------------------

  async activate(id: string, actorId: string | null): Promise<ContractRead> {
    const contract = await this.requireContract(id);
    if (contract.status !== "DRAFT") {
      throw new ContractStateError(
        `contract ${id} is ${contract.status} — only DRAFT contracts activate`,
        { contractId: id, status: contract.status },
      );
    }

    // The official CT- number reserves at ACTIVATION (BR-029 boundary; the
    // CT- series is global per tenant-year — branchId null, periodKey the
    // activation year — the job-card creation precedent).
    const year = today().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: CT_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: CT_FORMAT.format,
      prefix: CT_FORMAT.prefix,
      year,
    });
    await store.patchContract({ id, status: "ACTIVE", contractNo: acquired.number, activatedAt: new Date() });
    await this.numbering.bind(CT_FORMAT.docType, acquired.number, id);

    // §4's "activate: number + schedule expansion" — the idempotent re-run
    // (the create-time grid persists the fee item; this reconciles the term).
    const stored = (await store.findContractById(id))!;
    await this.applySchedule(stored, await this.storedFeeModelState(stored));

    const after = (await store.findContractById(id))!;
    await this.audit.record({
      action: "crm.contract.activated",
      entityType: "service_contract",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: contract.status },
      after: { status: after.status, contractNo: after.contractNo, activatedAt: after.activatedAt },
    });
    return withDerivedExpiry(after);
  }

  // -- cancel (reason) ------------------------------------------------------------

  async cancel(id: string, reason: string, actorId: string | null): Promise<ContractRead> {
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      throw new ContractInputInvalidError("cancelling a contract requires a reason (1..500 characters)");
    }
    const contract = await this.requireContract(id);
    if (contract.status !== "DRAFT" && contract.status !== "ACTIVE") {
      throw new ContractStateError(
        `contract ${id} is ${contract.status} — only DRAFT/ACTIVE contracts cancel`,
        { contractId: id, status: contract.status },
      );
    }
    await store.patchContract({ id, status: "CANCELLED", cancelReason: trimmed, cancelledAt: new Date() });
    const after = (await store.findContractById(id))!;
    await this.audit.record({
      action: "crm.contract.cancelled",
      entityType: "service_contract",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: contract.status },
      after: { status: after.status, reason: trimmed },
    });
    return withDerivedExpiry(after);
  }

  // -- renew (a NEW DRAFT copy + the RENEWED link) ---------------------------------

  async renew(
    id: string,
    input: { startDate?: string; endDate?: string; note?: string | null; actorId: string | null },
  ): Promise<{ renewed: ContractRead; renewal: ContractRead }> {
    const old = await this.requireContract(id);
    if (old.status !== "ACTIVE") {
      throw new ContractStateError(
        `contract ${id} is ${old.status} — only ACTIVE contracts renew (an expired-but-ACTIVE contract still renews — expiry is derived)`,
        { contractId: id, status: old.status },
      );
    }

    // The fresh term: default start = the day after the old end; the same
    // length; explicit input wins.
    const termDays = daysBetween(old.startDate, old.endDate);
    const startDate = input.startDate !== undefined ? canonicalDate(input.startDate, "startDate") : addDaysIso(old.endDate, 1);
    const endDate =
      input.endDate !== undefined ? canonicalDate(input.endDate, "endDate") : addDaysIso(startDate, termDays);
    if (endDate < startDate) {
      throw new ContractTermInvalidError(`renewal end ${endDate} precedes start ${startDate}`);
    }

    // The copy: same partner/project/title/scope/fee model/monthly amount/
    // currency; DRAFT (no CT number until its own activation).
    const copy = await store.insertContract({
      partnerId: old.partnerId,
      projectId: old.projectId,
      title: old.title,
      titleAr: old.titleAr,
      scope: old.scope,
      feeModel: old.feeModel,
      startDate,
      endDate,
      monthlyAmount: old.monthlyAmount,
      currencyCode: old.currencyCode,
      note: input.note !== undefined ? input.note : old.note,
      noteAr: old.noteAr,
      actorId: input.actorId,
    });

    // Milestone carry-over: the old contract's LIVE (PLANNED) milestone
    // lines with dates shifted by the term offset (deterministic); the fee
    // item rides each row. RETAINER/HOURLY grids re-expand on the fresh
    // term through applySchedule below.
    const offset = daysBetween(old.startDate, startDate);
    const oldGrid = await store.listScheduleByContract(old.id);
    const carriedMilestones = oldGrid
      .filter((row) => row.entryType === "MILESTONE" && row.status === "PLANNED")
      .map((row) => ({
        label: row.milestoneLabel!,
        labelAr: row.milestoneLabelAr,
        dueDate: addDaysIso(row.billDate, offset),
        amount: row.amount ?? "0.0000",
        feeItemId: row.feeItemId,
      }));

    const validated: ValidatedFeeModel =
      old.feeModel === "MILESTONES"
        ? {
            feeModel: "MILESTONES",
            monthlyAmount: null,
            effectiveFeeItemId: carriedMilestones[0]?.feeItemId ?? "",
            milestones: carriedMilestones.length > 0 ? carriedMilestones : undefined,
          }
        : {
            feeModel: old.feeModel as "RETAINER" | "HOURLY",
            monthlyAmount: old.monthlyAmount,
            effectiveFeeItemId: oldGrid[0]?.feeItemId ?? "",
            milestones: undefined,
          };
    await this.applySchedule(copy, validated);

    // The link: old → RENEWED + renewedToContractId (provenance, forever).
    await store.patchContract({ id: old.id, status: "RENEWED", renewedToContractId: copy.id });

    const renewedAfter = (await store.findContractById(old.id))!;
    const copyAfter = (await store.findContractById(copy.id))!;
    await this.audit.record({
      action: "crm.contract.renewed",
      entityType: "service_contract",
      entityId: old.id,
      actorId: input.actorId ?? undefined,
      before: { status: old.status },
      after: { status: renewedAfter.status, renewedToContractId: copy.id },
    });
    await this.audit.record({
      action: "crm.contract.renewal_created",
      entityType: "service_contract",
      entityId: copy.id,
      actorId: input.actorId ?? undefined,
      after: {
        renewedFromContractId: old.id,
        renewedFromContractNo: old.contractNo,
        startDate: copyAfter.startDate,
        endDate: copyAfter.endDate,
      },
    });
    return { renewed: withDerivedExpiry(renewedAfter), renewal: withDerivedExpiry(copyAfter) };
  }

  // -- update (DRAFT only; the lesson-1 feeItem resolution) -------------------------

  async update(id: string, patch: UpdateContractInput): Promise<ContractRead> {
    const contract = await this.requireContract(id);
    if (contract.status !== "DRAFT") {
      throw new ContractStateError(
        `contract ${id} is ${contract.status} — only DRAFT contracts accept edits`,
        { contractId: id, status: contract.status },
      );
    }

    // Merge the patch over the stored state; validate the merged whole.
    const startDate = patch.startDate !== undefined ? canonicalDate(patch.startDate, "startDate") : contract.startDate;
    const endDate = patch.endDate !== undefined ? canonicalDate(patch.endDate, "endDate") : contract.endDate;
    if (endDate < startDate) {
      throw new ContractTermInvalidError(`contract end ${endDate} precedes start ${startDate}`);
    }
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title.length < 1 || title.length > 200) {
        throw new ContractInputInvalidError("contract title is required (1..200 characters)");
      }
    }
    if (patch.projectId !== undefined && patch.projectId !== null) {
      await this.requireOpenProject(patch.projectId);
    }

    // §18 lesson 1: the fee-item home is the SCHEDULE — when the patch
    // omits feeItemId, resolve the effective contract-level default from the
    // STORED grid (MILESTONES → the first stored MILESTONE row's feeItemId;
    // RETAINER/HOURLY → findScheduleGridFeeItem).
    const storedDefault = await resolveStoredFeeItem(contract);
    const validated = this.validateFeeModel({
      feeModel: contract.feeModel as FeeModel,
      monthlyAmount: patch.monthlyAmount !== undefined ? patch.monthlyAmount : contract.monthlyAmount,
      feeItemId: patch.feeItemId !== undefined ? patch.feeItemId : null,
      milestones: patch.milestones !== undefined && patch.milestones !== null ? patch.milestones : undefined,
      storedDefaultFeeItem: storedDefault,
    });

    await store.patchContract({
      id,
      title: patch.title !== undefined ? patch.title.trim() : undefined,
      titleAr: patch.titleAr,
      scope: patch.scope,
      projectId: patch.projectId,
      startDate: patch.startDate,
      endDate: patch.endDate,
      monthlyAmount: patch.monthlyAmount,
      note: patch.note,
      noteAr: patch.noteAr,
    });
    const after = (await store.findContractById(id))!;
    await this.applySchedule(after, validated);
    const afterGrid = (await store.findContractById(id))!;

    await this.audit.record({
      action: "crm.contract.updated",
      entityType: "service_contract",
      entityId: id,
      actorId: patch.actorId ?? undefined,
      before: { title: contract.title, startDate: contract.startDate, endDate: contract.endDate },
      after: {
        title: afterGrid.title,
        startDate: afterGrid.startDate,
        endDate: afterGrid.endDate,
        milestonesReplaced: patch.milestones !== undefined,
      },
    });
    return withDerivedExpiry(afterGrid);
  }

  // -- the schedule grid (§4 semantics — the binding expansion) ---------------------

  /**
   * The §4 grid expansion, ADDITIVE + reconciling, per the contract's
   * CURRENT stored state + the validated fee-model input:
   *
   *   RETAINER — one RETAINER_PERIOD per calendar month clipped to the
   *     term; billDate = periodStart (advance); amount = the FULL
   *     monthlyAmount per period (no proration).
   *   MILESTONES — the dated milestone lines (billDate = the milestone
   *     date, periodKey NULL, labels unique).
   *   HOURLY — one HOURLY_PERIOD per calendar month; billDate = periodEnd
   *     (arrears); amount NULL (computed at the run).
   *
   * Reconcile rules: insert rows whose key ((entry_type, period_key) or
   * milestone label) is absent; update existing PLANNED rows (amount/
   * windows/fee item); flip PLANNED rows whose key vanished (removed
   * milestone labels, shortened-term periods) to SKIPPED; NEVER delete;
   * NEVER touch INVOICED rows (posted history stays). Idempotent by
   * construction — re-runs converge (INV-013).
   */
  private async applySchedule(
    contract: store.ContractRow,
    state: ValidatedFeeModel,
  ): Promise<void> {
    const existing = await store.listScheduleByContract(contract.id);
    const feeItemId = state.effectiveFeeItemId;

    if (state.feeModel === "MILESTONES") {
      // §18 lesson 1: `milestones === undefined` = "unchanged" — the grid
      // stays exactly as stored (a field-only PATCH must never wipe it to
      // SKIPPED; the array checks were skipped in validation for the same
      // reason — the T46b spec pinned this after the first run wiped grids).
      if (state.milestones === undefined) return;
      const lines = state.milestones;
      const expected = new Map(
        lines.map((line) => [
          line.label,
          {
            billDate: line.dueDate,
            amount: line.amount,
            feeItemId: line.feeItemId,
            labelAr: line.labelAr,
          },
        ]),
      );
      const byLabel = new Map(
        existing
          .filter((row) => row.entryType === "MILESTONE")
          .map((row) => [row.milestoneLabel!, row]),
      );
      for (const [label, want] of expected) {
        const row = byLabel.get(label);
        if (row === undefined) {
          await store.insertScheduleEntry({
            contractId: contract.id,
            entryType: "MILESTONE",
            periodKey: null,
            periodStart: want.billDate,
            periodEnd: want.billDate,
            billDate: want.billDate,
            amount: want.amount,
            feeItemId: want.feeItemId,
            milestoneLabel: label,
            milestoneLabelAr: want.labelAr,
          });
        } else if (row.status === "PLANNED") {
          await store.patchScheduleEntry({
            id: row.id,
            billDate: want.billDate,
            periodStart: want.billDate,
            periodEnd: want.billDate,
            amount: want.amount,
            feeItemId: want.feeItemId,
            milestoneLabelAr: want.labelAr,
          });
        } else if (row.status === "SKIPPED") {
          // A REMOVED-THEN-RESTORED label re-PLANS with the new line data —
          // never a duplicate row (the partial unique on (tenant, contract,
          // milestone_label) holds the label forever; the T46b spec pinned
          // this after the first run left restores stuck at SKIPPED).
          await store.patchScheduleEntry({
            id: row.id,
            billDate: want.billDate,
            periodStart: want.billDate,
            periodEnd: want.billDate,
            amount: want.amount,
            feeItemId: want.feeItemId,
            milestoneLabelAr: want.labelAr,
            status: "PLANNED",
          });
        }
      }
      // Removed labels (still PLANNED) flip SKIPPED — no deletes (§4).
      for (const [label, row] of byLabel) {
        if (!expected.has(label) && row.status === "PLANNED") {
          await store.patchScheduleEntry({ id: row.id, status: "SKIPPED" });
        }
      }
      // Non-milestone PLANNED rows (a model change is impossible — feeModel
      // is immutable on update — but a stale row would flip defensively).
      return;
    }

    // RETAINER / HOURLY: the clipped calendar-month grid.
    const hourly = state.feeModel === "HOURLY";
    const entryType = hourly ? "HOURLY_PERIOD" : "RETAINER_PERIOD";
    const months = clippedCalendarMonths(contract.startDate, contract.endDate);
    const expected = new Map(
      months.map((month) => [
        month.periodKey,
        {
          periodStart: month.periodStart,
          periodEnd: month.periodEnd,
          billDate: hourly ? month.periodEnd : month.periodStart,
          amount: hourly ? null : state.monthlyAmount ?? "0.0000",
        },
      ]),
    );
    const byKey = new Map(
      existing
        .filter((row) => row.entryType === entryType)
        .map((row) => [row.periodKey!, row]),
    );
    for (const [periodKey, want] of expected) {
      const row = byKey.get(periodKey);
      if (row === undefined) {
        await store.insertScheduleEntry({
          contractId: contract.id,
          entryType,
          periodKey,
          periodStart: want.periodStart,
          periodEnd: want.periodEnd,
          billDate: want.billDate,
          amount: want.amount,
          feeItemId,
          milestoneLabel: null,
          milestoneLabelAr: null,
        });
      } else if (row.status === "PLANNED") {
        await store.patchScheduleEntry({
          id: row.id,
          periodStart: want.periodStart,
          periodEnd: want.periodEnd,
          billDate: want.billDate,
          amount: want.amount,
          feeItemId,
        });
      } else if (row.status === "SKIPPED") {
        // A shortened-then-re-lengthened term re-PLANS the restored period
        // (the milestone-restore discipline generalized — the T46b spec
        // pinned this after the first run left restores stuck at SKIPPED).
        await store.patchScheduleEntry({
          id: row.id,
          periodStart: want.periodStart,
          periodEnd: want.periodEnd,
          billDate: want.billDate,
          amount: want.amount,
          feeItemId,
          status: "PLANNED",
        });
      }
    }
    // Out-of-term PLANNED rows (a shortened DRAFT term) flip SKIPPED — the
    // milestone-flip discipline generalized (a stale PLANNED row would
    // generate a dead invoice; INVOICED rows never touch).
    for (const [periodKey, row] of byKey) {
      if (!expected.has(periodKey) && row.status === "PLANNED") {
        await store.patchScheduleEntry({ id: row.id, status: "SKIPPED" });
      }
    }
  }

  /**
   * The stored-state fee-model projection for the activation re-run: the
   * grid IS the milestone-line store, so MILESTONES re-reads its live rows
   * (a no-op reconcile); RETAINER/HOURLY re-derive from the stored term.
   */
  private async storedFeeModelState(contract: store.ContractRow): Promise<ValidatedFeeModel> {
    const grid = await store.listScheduleByContract(contract.id);
    if (contract.feeModel === "MILESTONES") {
      const live = grid.filter((row) => row.entryType === "MILESTONE" && row.status !== "SKIPPED");
      return {
        feeModel: "MILESTONES",
        monthlyAmount: null,
        effectiveFeeItemId: live[0]?.feeItemId ?? grid[0]?.feeItemId ?? "",
        milestones: live.map((row) => ({
          label: row.milestoneLabel!,
          labelAr: row.milestoneLabelAr,
          dueDate: row.billDate,
          amount: row.amount ?? "0.0000",
          feeItemId: row.feeItemId,
        })),
      };
    }
    return {
      feeModel: contract.feeModel as "RETAINER" | "HOURLY",
      monthlyAmount: contract.monthlyAmount,
      effectiveFeeItemId: grid[0]?.feeItemId ?? "",
      milestones: undefined,
    };
  }

  /**
   * The shared fee-model validation (create + update). §18 lesson 1:
   * `milestones === undefined` = "unchanged — skip the array checks";
   * the contract-level fee item resolves input-first, then the STORED grid
   * default (`storedDefaultFeeItem` — the caller resolved it).
   */
  private validateFeeModel(input: {
    feeModel: FeeModel;
    monthlyAmount: string | null | undefined;
    feeItemId: string | null | undefined;
    milestones:
      | readonly MilestoneLineInput[]
      | undefined;
    storedDefaultFeeItem: string | undefined;
  }): ValidatedFeeModel {
    const effectiveFeeItemId =
      input.feeItemId !== undefined && input.feeItemId !== null
        ? input.feeItemId
        : (input.storedDefaultFeeItem ?? "");

    if (input.feeModel === "MILESTONES") {
      if (input.milestones === undefined) {
        // Lesson 1: unchanged — skip the array checks; the effective fee
        // item still resolves (stored default) for grid re-writes.
        return { feeModel: "MILESTONES", monthlyAmount: null, effectiveFeeItemId, milestones: undefined };
      }
      if (input.milestones.length === 0) {
        throw new ContractInputInvalidError("a MILESTONES contract requires at least one milestone line");
      }
      const seenLabels = new Set<string>();
      const normalized = input.milestones.map((line, index) => {
        const label = line.label.trim();
        if (label.length < 1 || label.length > 200) {
          throw new ContractInputInvalidError(`milestone ${index + 1}: label is required (1..200 characters)`);
        }
        if (seenLabels.has(label)) {
          throw new ContractInputInvalidError(`milestone label "${label}" appears twice — labels are unique`);
        }
        seenLabels.add(label);
        const dueDate = canonicalDate(line.dueDate, `milestone ${index + 1} dueDate`);
        if (!MONEY4_RE.test(line.amount) || new Decimal(line.amount).lessThanOrEqualTo(0)) {
          throw new ContractInputInvalidError(
            `milestone ${label}: amount must be a positive decimal (≤ 4dp): ${line.amount}`,
          );
        }
        const lineFeeItem = line.feeItemId ?? (input.feeItemId ?? input.storedDefaultFeeItem ?? null);
        if (lineFeeItem === null || lineFeeItem === "") {
          // The exact first-execution symptom this guards: a line with no
          // fee item AND no resolvable default — the stored-grid resolution
          // above is the fix (§18 lesson 1).
          throw new ContractInputInvalidError(
            `milestone ${label} has no fee item — provide the line's feeItemId or the contract-level default`,
          );
        }
        return {
          label,
          labelAr: line.labelAr,
          dueDate,
          amount: new Decimal(line.amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
          feeItemId: lineFeeItem,
        };
      });
      return { feeModel: "MILESTONES", monthlyAmount: null, effectiveFeeItemId, milestones: normalized };
    }

    // RETAINER / HOURLY.
    if (input.feeModel === "RETAINER") {
      const amount = input.monthlyAmount ?? null;
      if (amount === null || !MONEY4_RE.test(amount) || new Decimal(amount).lessThanOrEqualTo(0)) {
        throw new ContractInputInvalidError(
          `a RETAINER contract requires monthlyAmount > 0 (≤ 4dp): ${String(input.monthlyAmount)}`,
        );
      }
      if (effectiveFeeItemId === "") {
        throw new ContractInputInvalidError(
          "the contract requires a fee item (feeItemId or the stored grid default) — the retainer grid cannot be written",
        );
      }
      return {
        feeModel: "RETAINER",
        monthlyAmount: new Decimal(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        effectiveFeeItemId,
        milestones: undefined,
      };
    }
    // HOURLY.
    if (effectiveFeeItemId === "") {
      throw new ContractInputInvalidError(
        "the contract requires a fee item (feeItemId or the stored grid default) — the hourly grid cannot be written",
      );
    }
    return { feeModel: "HOURLY", monthlyAmount: null, effectiveFeeItemId, milestones: undefined };
  }

  // -- advance tagging (§4/§1 row 4 — the J-DEF reclass) ----------------------------

  /**
   * Tag an on-account receipt amount to an ACTIVE contract: validates the
   * receipt carries ≥ amount of unallocated on-account credit (the treasury
   * onAccountRemainder formula — amount − allocated − already-tagged
   * advances, replicated read-only in the crm store probe), then with
   * policy `crm.defer_advance_recognition` ON posts the reclass journal
   *
   *   DR AR_CONTROL (partner, projectId-stamped — §18 lesson 2)
   *   CR DEFERRED_REVENUE          (NO project stamp — lesson 2)
   *
   * source {docType: "contract_advance", docId: <advance row>, operation:
   * "defer"} — ONE journal per advance row (source-key idempotency); the
   * AR line's partner subledger DEBIT row lands through the posting service
   * (INV-009). OFF = link-only (BR-027 pure — a plain on-account credit).
   * DEFERRED_REVENUE unmapped ⇒ PURPOSE_NOT_MAPPED, fail-closed, the whole
   * ambient UoW rolls back (zero residue).
   */
  async tagAdvance(input: {
    contractId: string;
    receiptId: string;
    amount: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<store.ContractAdvanceRow> {
    const contract = await this.requireContract(input.contractId);
    if (contract.status !== "ACTIVE") {
      throw new ContractStateError(
        `contract ${input.contractId} is ${contract.status} — advances attach to ACTIVE contracts only`,
        { contractId: input.contractId, status: contract.status },
      );
    }
    const amount = input.amount.trim();
    if (!MONEY4_RE.test(amount) || new Decimal(amount).lessThanOrEqualTo(0)) {
      throw new ContractInputInvalidError(`advance amount must be a positive decimal (≤ 4dp): ${input.amount}`);
    }
    const tagAmount = new Decimal(amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const receipt = await store.findReceiptForCrm(input.receiptId);
    if (receipt === undefined) {
      throw new AdvanceStateError(
        `receipt ${input.receiptId} does not exist in this tenant — the advance cannot be tagged`,
      );
    }
    if (receipt.status !== "POSTED") {
      throw new AdvanceStateError(
        `receipt ${input.receiptId} is ${receipt.status} — only POSTED receipts carry real on-account credit`,
      );
    }
    if (receipt.partnerId !== contract.partnerId) {
      throw new AdvanceStateError(
        `receipt ${input.receiptId} belongs to a different partner than contract ${input.contractId}`,
      );
    }
    if (receipt.currencyCode !== contract.currencyCode) {
      throw new AdvanceStateError(
        `receipt ${input.receiptId} is ${receipt.currencyCode} but the contract bills ${contract.currencyCode}`,
      );
    }

    // The duplicate-tag guard: the same (receipt, contract, amount) HELD
    // advance already exists (§4 + the store's listHeldAdvancesForReceipt).
    const held = await store.listHeldAdvancesForReceipt(input.receiptId);
    if (held.some((row) => row.contractId === input.contractId && row.amount === tagAmount)) {
      throw new AdvanceStateError(
        `an advance of ${tagAmount} from receipt ${input.receiptId} is already HELD on contract ${input.contractId}`,
      );
    }

    // Unallocated on-account credit (BR-027): the treasury formula minus
    // already-tagged advances (HELD holds the credit; RELEASED consumed it).
    const unallocated = new Decimal(receipt.amount).minus(new Decimal(receipt.allocatedAmount));
    const tagged = new Decimal(await store.sumTaggedAdvancesForReceipt(input.receiptId));
    const available = unallocated.minus(tagged).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (available.lessThan(new Decimal(tagAmount))) {
      throw new AdvanceInsufficientOnAccountError({
        receiptId: input.receiptId,
        available: available.toFixed(4),
        requested: tagAmount,
      });
    }

    // The HELD row first (its id is the journal's source docId).
    const advance = await store.insertContractAdvance({
      contractId: contract.id,
      receiptId: input.receiptId,
      amount: tagAmount,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });

    const defer = await readEffectiveSetting<boolean>("crm.defer_advance_recognition");
    let deferJournalId: string | null = null;
    if (defer === true) {
      const amount4 = tagAmount;
      // §18 lesson 2: the AR DEBIT line carries partner + projectId; the
      // DEFERRED_REVENUE CREDIT line carries neither project nor partner.
      const lines: JournalLineSpec[] = [
        {
          purpose: "AR_CONTROL",
          direction: "DEBIT",
          amount: amount4,
          partnerId: contract.partnerId,
          projectId: contract.projectId ?? undefined,
          memo: {
            en: `Contract advance deferral — ${contract.contractNo ?? contract.id}`,
            ar: `تأجيل دفعة عقد — ${contract.contractNo ?? contract.id}`,
          },
        },
        {
          purpose: "DEFERRED_REVENUE",
          direction: "CREDIT",
          amount: amount4,
          memo: {
            en: `Deferred revenue — contract ${contract.contractNo ?? contract.id}`,
            ar: `إيرادات مؤجلة — عقد ${contract.contractNo ?? contract.id}`,
          },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "contract_advance", docId: advance.id, operation: "defer" },
        entryDate: today(),
        description: {
          en: `Contract advance reclass — ${contract.contractNo ?? contract.id} (${tagAmount})`,
          ar: `إعادة تصنيف دفعة عقد — ${contract.contractNo ?? contract.id} (${tagAmount})`,
        },
        currency: contract.currencyCode,
        lines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      deferJournalId = result.journalEntryId;
      await store.patchContractAdvance({ id: advance.id, deferJournalId });
    }

    await this.audit.record({
      action: "crm.contract_advance.tagged",
      entityType: "contract_advance",
      entityId: advance.id,
      actorId: input.actorId ?? undefined,
      after: {
        contractId: contract.id,
        receiptId: input.receiptId,
        amount: tagAmount,
        deferred: defer === true,
        deferJournalId,
      },
    });
    return (await store.findContractAdvanceById(advance.id))!;
  }

  // -- the billing preview (§11 row 26 — the T47 contract, read-only) ---------------

  /**
   * What the billing run WOULD do as of a date (read-only — no rows
   * written): every PLANNED schedule entry with billDate <= asOf and NO
   * contract_invoices guard row, each with its would-invoice line(s); the
   * HOURLY periods additionally carry the pullable entries (§5's criteria +
   * billable), the needsNarrative list (skipped — never silently billed)
   * and the fiscal-period posture of the entry's billDate (LOCKED ⇒ the run
   * refuses dead drafts, INV-011; SOFT_CLOSED warns, BR-030).
   */
  async billingPreview(contractId: string, asOf: string): Promise<ContractBillingPreview> {
    const contract = await this.requireContract(contractId);
    const date = canonicalDate(asOf, "asOf");
    const grid = await store.listScheduleByContract(contractId);
    const guardRows = await store.listContractInvoices({ contractId, limit: 500 });
    const guardedPeriods = new Set(guardRows.map((row) => row.periodKey).filter((key): key is string => key !== null));
    const guardedMilestones = new Set(
      guardRows
        .map((row) => row.milestoneScheduleId)
        .filter((id): id is string => id !== null),
    );
    const narrativeRequired = await this.narrativeRequiredOnTimeBilling();

    const items: ContractBillingPreviewItem[] = [];
    for (const entry of grid) {
      if (entry.status !== "PLANNED" || entry.billDate > date) continue;
      if (entry.periodKey !== null && guardedPeriods.has(entry.periodKey)) continue;
      if (entry.entryType === "MILESTONE" && guardedMilestones.has(entry.id)) continue;

      const period = await accountingStore.findPeriodForDate(entry.billDate);
      const periodStatus = (period?.status ?? "NONE") as "OPEN" | "SOFT_CLOSED" | "LOCKED" | "NONE";

      let wouldInvoice: readonly PreviewInvoiceLine[] = [];
      let pullable: readonly TimeEntryRow[] = [];
      let needsNarrative: readonly TimeEntryRow[] = [];
      if (entry.entryType === "RETAINER_PERIOD") {
        wouldInvoice = [
          {
            feeItemId: entry.feeItemId,
            qty: "1.000000",
            unitPrice: entry.amount,
            description: `${contract.title} — retainer ${entry.periodKey}`,
          },
        ];
      } else if (entry.entryType === "MILESTONE") {
        wouldInvoice = [
          {
            feeItemId: entry.feeItemId,
            qty: "1.000000",
            unitPrice: entry.amount,
            description: entry.milestoneLabel,
          },
        ];
      } else {
        // HOURLY arrears: one line per pullable entry (the honest
        // timeslip — narrative as the description); narrative-less entries
        // surface in needsNarrative and are skipped (§5).
        pullable = await store.listPullableTimeEntries({
          contractId: contract.id,
          fromDate: entry.periodStart ?? entry.billDate,
          toDate: entry.periodEnd ?? entry.billDate,
        });
        needsNarrative = narrativeRequired
          ? pullable.filter((row) => row.narrative === null || row.narrative.trim() === "")
          : [];
        const billableSet = new Set(needsNarrative.map((row) => row.id));
        wouldInvoice = pullable
          .filter((row) => !billableSet.has(row.id))
          .map((row) => ({
            feeItemId: row.feeItemId,
            qty: row.hours,
            unitPrice: row.unitRate,
            description: row.narrative,
          }));
      }
      items.push({
        entry,
        wouldInvoice,
        pullableTimeEntries: pullable,
        needsNarrative,
        periodStatus,
        periodLocked: periodStatus === "LOCKED",
      });
    }
    return { contractId, asOf: date, items };
  }

  // -- policy reads (§9) ---------------------------------------------------------

  /** The tenant's billing-mode policy off `config.policies` (§9). */
  private async billingMode(): Promise<string> {
    const tenantId = requireTenantContext().tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    const mode = config.policies["crm.contract_billing_mode"];
    return typeof mode === "string" ? mode : "retainer_or_milestones";
  }

  /** Policy crm.narrative_required_on_time_billing (default true). */
  async narrativeRequiredOnTimeBilling(): Promise<boolean> {
    const tenantId = requireTenantContext().tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    return config.policies["crm.narrative_required_on_time_billing"] !== false;
  }

  // -- shared guards ---------------------------------------------------------------

  private async requireContract(id: string): Promise<store.ContractRow> {
    const contract = await store.findContractById(id);
    if (contract === undefined) throw new ContractNotFoundError(id);
    return contract;
  }

  /** The §8 project validation — the engine's typed errors, reused verbatim. */
  private async requireOpenProject(projectId: string): Promise<void> {
    const project = await accountingStore.findProjectById(projectId);
    if (project === undefined) {
      const { projectNotFound } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw projectNotFound({ projectId });
    }
    if (project.status !== "OPEN") {
      const { projectClosed } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw projectClosed({ projectId });
    }
  }
}

// ---------------------------------------------------------------------------
// module-local helpers
// ---------------------------------------------------------------------------

/** The derived expiry flag (§4): ACTIVE && endDate < today. */
function withDerivedExpiry(contract: store.ContractRow): ContractRead {
  return { contract, isExpired: contract.status === "ACTIVE" && contract.endDate < today() };
}

/**
 * §18 lesson 1's resolver: the effective contract-level fee-item default
 * from the STORED grid — MILESTONES → the first stored MILESTONE row's
 * feeItemId; RETAINER/HOURLY → findScheduleGridFeeItem (any grid row).
 */
export async function resolveStoredFeeItem(contract: store.ContractRow): Promise<string | undefined> {
  if (contract.feeModel === "MILESTONES") {
    return store.findScheduleGridFeeItem(contract.id, "MILESTONE");
  }
  return store.findScheduleGridFeeItem(contract.id);
}
