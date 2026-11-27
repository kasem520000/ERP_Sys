import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  ChangeOrderEffectAlreadyAppliedError,
  ChangeOrderInputInvalidError,
  ChangeOrderNotFoundError,
  ChangeOrderStateError,
  ProjectPlaneNotFoundError,
} from "../domain/projects-errors";
import * as store from "../infrastructure/change-order.store";
// PHASE-052 (W-44, dated 2026-11-27): the workflow gateway — the
// documented plain-function contract (the trade-order-gate pattern:
// zero module coupling; the engine binds at boot, unbound = the legacy
// path byte-identical).
import {
  onDocumentSubmitted,
  recordApprovalThroughChain,
  recordRejectionThroughChain,
} from "../../workflow/infrastructure/workflow-gateway";
import type { ChangeOrderRow } from "../infrastructure/change-order.store";
import {
  findProjectPlane,
  listApprovedBudgetLines,
  listProjectBudgets,
} from "../infrastructure/projects.store";

/**
 * PHASE-048 (W-10 — T-09) — the change-order approval gate (BR-094 /
 * G-58 / D-07): `change_orders` are INERT UNTIL APPROVED — the approval
 * gate precedes any budget, billing or contract-value effect, and the
 * approval applies G-58's delta EXACTLY ONCE.
 *
 * THE LAWS:
 *
 * - **BR-094 (the gate)**: DRAFT → SUBMITTED → APPROVED / REJECTED (the
 *   045 simple-approval shape — 0102's approval-link CHECK pins exactly
 *   one terminal verdict with its stamps, the rejection reason
 *   mandatory). Only the APPROVED orders enter any ceiling — the
 *   recompute reads `status = 'APPROVED'` alone (the 0102 partial
 *   index is that read path); DRAFT/SUBMITTED/REJECTED are inert.
 * - **G-58 (the exactly-once effects)**: approval posts the price
 *   delta through the REAL PostingService (ADR-0007) — source
 *   { change_order, id, apply_effect }, INV-013 idempotent (a retried
 *   post converges on one entry) — DR/CR per the delta's sign on the
 *   mapped contract-WIP/revise accounts, resolved by the ENGINE
 *   fail-closed PURPOSE_NOT_MAPPED until the tenant maps them (the
 *   038/0077 discipline: existing tenants map once; zero migration —
 *   the account_purposes register is tenant data). A ZERO price delta
 *   (a scope-only order) posts NOTHING — the honest shape — and still
 *   consumes its stamp. THE STAMP (`effect_applied_at`) is SINGLE-USE:
 *   written only after the posting succeeded, in the SAME ambient
 *   transaction — all-or-nothing (a failed posting rolls the approval
 *   back to SUBMITTED); a second application is the typed refusal.
 * - **THE ONLY RE-PLANNING PATH (the owner's W-10 ruling)**: the
 *   budget/billing ceilings move ONLY through approved change orders —
 *   never a second APPROVED budget (the W-9 one-approved law), never a
 *   stored sum. `ceiling()` RECOMPUTES on every read: the retention
 *   register's contract value (the 0103 CUSTOMER row — the customer
 *   contract's commercial spine) + Σ the APPROVED price deltas; the
 *   budget ceiling BAC = the approved curve's total + the same deltas.
 * - **THE PROJECT DIMENSION STAYS THE COST CARRY**: the G-58 posting
 *   deliberately carries NO project stamp — the change-order delta
 *   revalues the CONTRACT (a commercial revaluation between the WIP
 *   and revise accounts), it does not consume cost, so INV-033's
 *   reconciliation (the four collectors = the GL project dimension) is
 *   untouched by construction (the db spec pins this).
 * - **NO DELETE** (0102's evidence discipline — the contract history
 *   is audited evidence; REJECTED stays readable).
 * - Money is numeric(19,4) EXCLUSIVELY; the delta is SIGNED (a
 *   credit-side change order is legal — no fabricated positivity).
 */

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const SIGNED_MONEY_RE = /^-?\d+(\.\d{1,4})?$/;

/** 23505 = unique_violation (the bridge precedent's unwrapping). */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new ChangeOrderInputInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

export interface ChangeOrderCeiling {
  readonly projectId: string;
  /** The customer contract's commercial register (the 0103 CUSTOMER
   * retention row) — the contract-value base; null when no register
   * row exists (the honest absence, never a fabricated 0). */
  readonly contractBase: {
    readonly contractValue: string;
    readonly currencyCode: string;
    readonly holdPercent: string;
  } | null;
  /** The APPROVED orders ONLY (BR-094 — the inert states never count). */
  readonly approvedChangeOrders: number;
  /** Σ the APPROVED price deltas (SIGNED — a credit-side order reduces). */
  readonly priceDeltaSum: string;
  /** contractBase.contractValue + priceDeltaSum — null while the base is
   * absent (the billing ceiling's shape once the register lands). */
  readonly effectiveContractValue: string | null;
  /** Σ the APPROVED schedule deltas (days) — the recorded schedule
   * effect; the WBS re-planning itself stays the planner's act through
   * the WBS API (recorded data, never an automatic rewrite). */
  readonly scheduleDeltaDaysSum: number;
  /** The approved budget's total planned (null while none stands). */
  readonly approvedBudgetTotal: string | null;
  /** BAC — the re-baselined budget ceiling: approved total + deltas. */
  readonly budgetCeiling: string | null;
}

@Injectable()
export class ChangeOrderService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  // -- the authoring plane (inert until approved — BR-094) -------------------

  async create(input: {
    projectId: string;
    coNo: string | null;
    title: string;
    titleAr: string | null;
    scopeDelta: string | null;
    scopeDeltaAr: string | null;
    priceDelta: string;
    scheduleDeltaDays: number | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<ChangeOrderRow> {
    const projectId = requireUuid(input.projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    if (input.title.trim().length < 1 || input.title.length > 200) {
      throw new ChangeOrderInputInvalidError("title must be 1…200 characters");
    }
    if (!SIGNED_MONEY_RE.test(input.priceDelta)) {
      throw new ChangeOrderInputInvalidError(
        `priceDelta must be a SIGNED decimal (≤ 4dp — a credit-side change order is legal): ${input.priceDelta}`,
      );
    }
    if (input.scheduleDeltaDays !== null) {
      if (!Number.isInteger(input.scheduleDeltaDays) || input.scheduleDeltaDays === 0) {
        throw new ChangeOrderInputInvalidError(
          "scheduleDeltaDays must be a non-zero integer number of days (0102's CHECK) or null",
        );
      }
    }
    if (input.coNo !== null && (input.coNo.trim().length < 1 || input.coNo.length > 40)) {
      throw new ChangeOrderInputInvalidError("coNo must be 1…40 characters when provided");
    }
    let created: ChangeOrderRow;
    try {
      created = await store.insertChangeOrder({
        projectId,
        coNo: input.coNo,
        title: input.title,
        titleAr: input.titleAr,
        scopeDelta: input.scopeDelta,
        scopeDeltaAr: input.scopeDeltaAr,
        priceDelta: input.priceDelta,
        scheduleDeltaDays: input.scheduleDeltaDays,
        note: input.note,
        noteAr: input.noteAr,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ChangeOrderInputInvalidError(
          `a change order numbered "${input.coNo}" already exists on this project — co_no is unique per project`,
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.change_order_created",
      entityType: "change_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { projectId, title: created.title, priceDelta: created.priceDelta, status: created.status },
    });
    return created;
  }

  async list(projectId: string): Promise<ChangeOrderRow[]> {
    await requireUuid(projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    return store.listChangeOrders(projectId);
  }

  async get(id: string): Promise<ChangeOrderRow> {
    const order = await store.findChangeOrderById(requireUuid(id, "changeOrderId"));
    if (order === undefined) throw new ChangeOrderNotFoundError(id);
    return order;
  }

  /** DRAFT → SUBMITTED (the gate's queue; 0102's submission CHECK
   * stamps submitted_at in the same CAS). */
  async submit(id: string, actorId: string | null): Promise<ChangeOrderRow> {
    const orderId = requireUuid(id, "changeOrderId");
    const current = await store.findChangeOrderById(orderId);
    if (current === undefined) throw new ChangeOrderNotFoundError(orderId);
    if (current.status !== "DRAFT") {
      throw new ChangeOrderStateError(
        `change order ${orderId} is ${current.status} — only DRAFT orders submit`,
        { changeOrderId: orderId, status: current.status },
      );
    }
    const moved = await store.casChangeOrderStatus({
      id: orderId,
      from: "DRAFT",
      to: "SUBMITTED",
      actorId,
    });
    if (moved === undefined) {
      throw new ChangeOrderStateError(
        `change order ${orderId} left DRAFT concurrently — reload and retry (the CAS guard)`,
        { changeOrderId: orderId },
      );
    }
    await this.audit.record({
      action: "projects.change_order_submitted",
      entityType: "change_order",
      entityId: orderId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "SUBMITTED" },
    });
    // PHASE-052 (W-44): the workflow chain opens AFTER the module's own
    // submit transition (the vocabulary mapping law — SUBMITTED is the
    // change order's own submit-transition status); an unresolvable
    // chain (a typed refusal) surfaces — a chain that cannot open NEVER
    // silently ungates the document.
    await onDocumentSubmitted({ triggerEntity: "change_order", documentId: orderId, actorId });
    return moved;
  }

  /** SUBMITTED → REJECTED (the reason is mandatory — 0102's CHECK). */
  async reject(id: string, reason: string, actorId: string | null): Promise<ChangeOrderRow> {
    const orderId = requireUuid(id, "changeOrderId");
    if (reason.trim().length < 3 || reason.length > 500) {
      throw new ChangeOrderInputInvalidError("a rejection carries its reason (3…500 characters) — 0102's CHECK");
    }
    const current = await store.findChangeOrderById(orderId);
    if (current === undefined) throw new ChangeOrderNotFoundError(orderId);
    if (current.status !== "SUBMITTED") {
      throw new ChangeOrderStateError(
        `change order ${orderId} is ${current.status} — only SUBMITTED orders reject`,
        { changeOrderId: orderId, status: current.status },
      );
    }
    // PHASE-052 (W-44): THE CHAIN GATE FIRST — with a live chain the
    // rejection routes INTO the current step (the actor must be its
    // assignee), the chain COMPLETES (a rejection is a terminal
    // verdict), and the module's own rejection proceeds; no chain = the
    // legacy path byte-identical.
    await recordRejectionThroughChain({
      triggerEntity: "change_order",
      documentId: orderId,
      actorId,
      comment: reason,
    });
    const moved = await store.casChangeOrderStatus({
      id: orderId,
      from: "SUBMITTED",
      to: "REJECTED",
      actorId,
      rejectionReason: reason,
    });
    if (moved === undefined) {
      throw new ChangeOrderStateError(
        `change order ${orderId} left SUBMITTED concurrently — reload and retry (the CAS guard)`,
        { changeOrderId: orderId },
      );
    }
    await this.audit.record({
      action: "projects.change_order_rejected",
      entityType: "change_order",
      entityId: orderId,
      actorId: actorId ?? undefined,
      before: { status: "SUBMITTED" },
      after: { status: "REJECTED", rejectionReason: reason },
    });
    return moved;
  }

  // -- THE GATE (approval = the CAS + G-58's effects, all-or-nothing) --------

  /**
   * SUBMITTED → APPROVED + G-58's exactly-once effects in ONE ambient
   * transaction: the verdict CAS, the price-delta posting through the
   * REAL engine (INV-013 idempotent; a zero delta posts nothing), and
   * the single-use stamp — a posting failure rolls the whole approval
   * back to SUBMITTED (the all-or-nothing law; the db spec proves it).
   */
  async approve(id: string, actorId: string | null): Promise<{
    order: ChangeOrderRow;
    /** The G-58 journal entry (null on a zero price delta — the honest
     * shape: nothing to post, the stamp still applies). */
    journalEntryId: string | null;
    effectAppliedAt: string;
  }> {
    const orderId = requireUuid(id, "changeOrderId");
    const current = await store.findChangeOrderById(orderId);
    if (current === undefined) throw new ChangeOrderNotFoundError(orderId);
    if (current.status !== "SUBMITTED") {
      throw new ChangeOrderStateError(
        `change order ${orderId} is ${current.status} — only SUBMITTED orders approve (the gate precedes every effect, BR-094)`,
        { changeOrderId: orderId, status: current.status },
      );
    }
    if (current.effectAppliedAt !== null) {
      throw new ChangeOrderEffectAlreadyAppliedError(
        `change order ${orderId}'s G-58 effect was already applied at ${current.effectAppliedAt} — the stamp is single-use (D-07)`,
        { changeOrderId: orderId, effectAppliedAt: current.effectAppliedAt },
      );
    }
    // PHASE-052 (W-44): THE CHAIN GATE FIRST — with a live chain the
    // approval routes INTO the current step (the actor must be its
    // assignee; the step stamp commits with THIS act's own envelope).
    // The mid-chain shape (chainOpened && !completed): the approval
    // landed on the chain and the document's own verdict is NOT yet
    // due — the module SKIPS its transition and returns the current
    // row (G-58's effects never fire early; the chain's step stamp +
    // audit + timeline are the approval's proof). The legacy BR-094
    // path below runs only when the chain just completed or no chain
    // exists (the compatibility mode — byte-identical).
    const chain = await recordApprovalThroughChain({
      triggerEntity: "change_order",
      documentId: orderId,
      actorId,
    });
    if (chain.chainOpened && !chain.completed) {
      return { order: current, journalEntryId: null, effectAppliedAt: current.effectAppliedAt ?? "" };
    }

    // The verdict CAS — one guarded UPDATE (a raced move refuses).
    const approved = await store.casChangeOrderStatus({
      id: orderId,
      from: "SUBMITTED",
      to: "APPROVED",
      actorId,
    });
    if (approved === undefined) {
      throw new ChangeOrderStateError(
        `change order ${orderId} left SUBMITTED concurrently — reload and retry (the CAS guard)`,
        { changeOrderId: orderId },
      );
    }

    // G-58's posting — the price delta through the REAL engine, DR/CR
    // per the delta's sign on the mapped contract-WIP/revise accounts
    // (the ENGINE resolves them fail-closed PURPOSE_NOT_MAPPED until
    // the tenant maps the pair — the 038/0077 discipline). A zero
    // delta posts nothing (a scope-only order).
    const delta = new Decimal(current.priceDelta);
    let journalEntryId: string | null = null;
    if (!delta.isZero()) {
      const amount = delta.abs().toFixed(4);
      const positive = delta.greaterThan(0);
      const entryDate = new Date().toISOString().slice(0, 10);
      const result = await this.posting.post(
        {
          source: { docType: "change_order", docId: orderId, operation: "apply_effect" },
          entryDate,
          description: {
            en: `Change order ${current.coNo ?? orderId} — G-58 price delta ${current.priceDelta}`,
            ar: `أمر التغيير ${current.coNo ?? orderId} — فرق القيمة G-58 ${current.priceDelta}`,
          },
          currency: await ownTenantBaseCurrency(),
          lines: [
            {
              purpose: positive ? "CONTRACT_WIP" : "CONTRACT_REVISE",
              direction: "DEBIT",
              amount,
              memo: { en: "G-58 change-order delta", ar: "فرق أمر التغيير G-58" },
            },
            {
              purpose: positive ? "CONTRACT_REVISE" : "CONTRACT_WIP",
              direction: "CREDIT",
              amount,
              memo: { en: "G-58 change-order delta", ar: "فرق أمر التغيير G-58" },
            },
          ],
        },
        { postedBy: actorId },
      );
      journalEntryId = result.journalEntryId;
    }

    // THE SINGLE-USE STAMP — written only after the posting succeeded,
    // in the same ambient transaction (all-or-nothing with the verdict
    // and the journal; the guarded UPDATE refuses a second consumption).
    const effectAppliedAt = await store.stampChangeOrderEffect(orderId);
    if (effectAppliedAt === undefined) {
      throw new ChangeOrderEffectAlreadyAppliedError(
        `change order ${orderId}'s G-58 effect was already applied — the stamp is single-use (D-07)`,
        { changeOrderId: orderId, effectAppliedAt: current.effectAppliedAt ?? "unknown" },
      );
    }

    await this.audit.record({
      action: "projects.change_order_approved",
      entityType: "change_order",
      entityId: orderId,
      actorId: actorId ?? undefined,
      before: { status: "SUBMITTED" },
      after: {
        status: "APPROVED",
        priceDelta: current.priceDelta,
        journalEntryId,
        effectAppliedAt,
      },
    });

    const after = await store.findChangeOrderById(orderId);
    return {
      order: after ?? approved,
      journalEntryId,
      effectAppliedAt,
    };
  }

  // -- THE CEILING (the recompute read — never a stored sum) ------------------

  /**
   * The re-baselined ceilings, RECOMPUTED on every read: the contract
   * register's value + Σ the APPROVED price deltas (the effective
   * contract value — BR-092/093's billing ceiling base) and the
   * approved budget's total + the same deltas (BAC — the EVM engine's
   * budget ceiling). The gate is the ONLY path that moves either
   * ceiling: inert orders never enter the sums, and no stored total
   * exists to go stale.
   */
  async ceiling(projectId: string): Promise<ChangeOrderCeiling> {
    await requireUuid(projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    const deltas = await store.approvedDeltaSum(projectId);
    const register = await store.findCustomerRetentionAccount(projectId);

    // The budget side: the APPROVED curve's total (the budget engine's
    // own law — at most one APPROVED budget stands; none → the honest
    // null, never a fabricated zero).
    const budgets = await listProjectBudgets(projectId);
    const approvedBudget = budgets.find((row) => row.status === "APPROVED");
    let approvedBudgetTotal: string | null = null;
    if (approvedBudget !== undefined) {
      const lines = await listApprovedBudgetLines(projectId);
      approvedBudgetTotal = lines
        .reduce((acc, line) => new Decimal(acc).plus(line.plannedAmount), new Decimal("0.0000"))
        .toFixed(4);
    }
    const budgetCeiling =
      approvedBudgetTotal === null
        ? null
        : new Decimal(approvedBudgetTotal).plus(deltas.priceDeltaSum).toFixed(4);

    const effectiveContractValue =
      register === undefined
        ? null
        : new Decimal(register.contractValue).plus(deltas.priceDeltaSum).toFixed(4);

    return {
      projectId,
      contractBase:
        register === undefined
          ? null
          : {
              contractValue: register.contractValue,
              currencyCode: register.currencyCode,
              holdPercent: register.holdPercent,
            },
      approvedChangeOrders: deltas.count,
      priceDeltaSum: deltas.priceDeltaSum,
      effectiveContractValue,
      scheduleDeltaDaysSum: deltas.scheduleDeltaDaysSum,
      approvedBudgetTotal,
      budgetCeiling,
    };
  }
}
