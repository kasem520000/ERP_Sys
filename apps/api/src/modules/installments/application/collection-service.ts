import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { findPlanById, findLineById, listLinesByPlan, postedAllocationsForItems, sourceOpenItemIdsForPlan, updateLine, updatePlanStatus, type InstallmentLineRow, type InstallmentPlanRow } from "../infrastructure/installments.store";
import {
  LateFeeNotChargeableError,
  LineNotFoundError,
  WaiveReasonRequiredError,
} from "../domain/installments-errors";

/**
 * PHASE-027 T10/T11 — collections, WAIVE, and the G-28 late fee.
 *
 * COLLECTIONS are ordinary sales receipts allocated to the invoice — the
 * plan is a collection overlay (BR-048): the AR open item remains the
 * invoice. Attribution is DERIVED (recomputed from the invoice's posted
 * allocations; the down-payment portion — the first collected slice up to
 * down_payment — is excluded; Σ line collections ≤ invoice settled, INV-016
 * tie). OVERDUE is job-derived only; WAIVED is the sole manual transition
 * (permission + reason + audit, sticky under the sweep).
 *
 * The LATE FEE posts ONLY via the engine (G-28: `DR AR_CONTROL (a new open
 * item against the partner — allocatable and reversible like any AR item) ·
 * CR LATE_FEE_INCOME`) — FLAT fees only (DR-003: no interest computation, no
 * compounding — fee = min(rate × line amount, cap), once per line, INV-013
 * source installment_line/late_fee).
 */
@Injectable()
export class InstallmentCollectionService {
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /** WAIVE — the sole manual line transition (permission at the route). */
  async waiveLine(input: {
    lineId: string;
    reason: string;
    actorId: string | null;
  }): Promise<InstallmentLineRow> {
    const line = await findLineById(input.lineId);
    if (line === undefined) {
      throw new LineNotFoundError(input.lineId);
    }
    if (input.reason.trim().length === 0) {
      throw new WaiveReasonRequiredError(input.lineId);
    }
    if (line.status === "WAIVED") {
      return line;
    }
    const updated = await updateLine({
      id: line.id,
      status: "WAIVED",
      waivedAt: new Date().toISOString(),
      waivedBy: input.actorId,
      waiveReason: input.reason,
    });
    await this.audit.record({
      action: "installments.line_waived",
      entityType: "installment_line",
      entityId: line.id,
      actorId: input.actorId ?? undefined,
      before: { status: line.status, collectedAmount: line.collectedAmount },
      after: { status: "WAIVED", reason: input.reason, waivedBy: input.actorId },
    });
    return updated ?? line;
  }

  /** The G-28 charge (manual endpoint or the sweep's auto-charge leg). */
  async chargeLateFee(input: {
    lineId: string;
    actorId: string | null;
  }): Promise<{ line: InstallmentLineRow; journalEntryId: string; fee: string }> {
    const line = await findLineById(input.lineId);
    if (line === undefined) {
      throw new LineNotFoundError(input.lineId);
    }
    if (line.status !== "OVERDUE" || line.lateFeeEntryId !== null) {
      throw new LateFeeNotChargeableError({
        lineId: line.id,
        status: line.status,
        alreadyCharged: line.lateFeeEntryId !== null,
      });
    }
    const plan = await findPlanById(line.planId);
    if (plan === undefined) {
      throw new LineNotFoundError(line.id);
    }
    const policy = plan.lateFeePolicy;
    const base = await ownTenantBaseCurrency();
    // FLAT only: fee = min(rate × amount, cap) — no interest, no compounding.
    const raw = new Decimal(line.amount).times(new Decimal(policy.rate)).toDecimalPlaces(4).toFixed(4);
    const fee = compareExact(raw, policy.cap) <= 0 ? raw : policy.cap;
    if (compareExact(fee, "0.0000") <= 0) {
      // A zero policy (rate 0 and cap 0) charges nothing — nothing posts.
      const unchanged = await updateLine({ id: line.id });
      return { line: unchanged ?? line, journalEntryId: "", fee: "0.0000" };
    }

    const lines: JournalLineSpec[] = [
      {
        purpose: "AR_CONTROL",
        direction: "DEBIT",
        amount: fee,
        partnerId: plan.partnerId,
        memo: {
          en: `Late fee on installment ${line.seq} of plan ${plan.sourceNo ?? plan.id} (G-28)`,
          ar: `رسوم تأخير على القسط ${line.seq} من الخطة ${plan.sourceNo ?? plan.id} (G-28)`,
        },
      },
      {
        purpose: "LATE_FEE_INCOME",
        direction: "CREDIT",
        amount: fee,
        memo: {
          en: "Late fee income — flat, never interest (DR-003)",
          ar: "إيرادات رسوم التأخير — مقطوعة وليست فائدة (DR-003)",
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "installment_line", docId: line.id, operation: "late_fee" },
      entryDate: new Date().toISOString().slice(0, 10),
      description: {
        en: `Late fee ${fee} on installment line ${line.seq} (G-28)`,
        ar: `رسوم تأخير ${fee} على القسط ${line.seq} (G-28)`,
      },
      currency: base,
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    const updated = await updateLine({
      id: line.id,
      lateFeeAmount: fee,
      lateFeeEntryId: posted.journalEntryId,
    });
    await this.audit.record({
      action: "installments.late_fee_charged",
      entityType: "installment_line",
      entityId: line.id,
      actorId: input.actorId ?? undefined,
      before: { status: line.status, amount: line.amount },
      after: {
        fee,
        rate: policy.rate,
        cap: policy.cap,
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
      },
    });
    return { line: updated ?? line, journalEntryId: posted.journalEntryId, fee };
  }

  /**
   * The attribution recompute (the sweep's core; idempotent by rebuild):
   * re-derive every line's receipt_refs + collected + PAID flips from the
   * source document's POSTED receipt allocations. The down-payment portion
   * (the first collected slice up to down_payment) is excluded; WAIVED
   * lines are skipped (sticky — the sweep never touches them); attribution
   * never exceeds what was actually settled (INV-016 tie).
   */
  async recomputePlanCollections(plan: InstallmentPlanRow): Promise<{
    changedLines: InstallmentLineRow[];
    allDone: boolean;
  }> {
    const itemIds = await sourceOpenItemIdsForPlan(plan);
    const allocations = await postedAllocationsForItems(itemIds);
    let settledTotal = "0.0000";
    for (const allocation of allocations) {
      settledTotal = addExact(settledTotal, allocation.amount);
    }
    // The down-payment slice: the first collected portion up to down_payment.
    let lineAssignable = subExact(settledTotal, plan.downPayment);
    if (compareExact(lineAssignable, "0.0000") < 0) {
      lineAssignable = "0.0000";
    }

    const lines = await listLinesByPlan(plan.id);
    const changed: InstallmentLineRow[] = [];
    const perLine: { receipts: NonNullable<InstallmentLineRow["receiptRefs"]>; collected: string }[] = [];
    for (const _ of lines) {
      perLine.push({ receipts: [], collected: "0.0000" });
    }
    // Walk the settled stream once: the leading `downPayment` slice is the
    // down payment; the rest flows into lines (seq order, WAIVED skipped,
    // capped by the line's outstanding and the global assignable remaining).
    let downRemaining = plan.downPayment;
    let assignableRemaining = lineAssignable;
    for (const allocation of allocations) {
      let remaining = allocation.amount;
      // First: absorb into the down slice.
      if (compareExact(downRemaining, "0.0000") > 0) {
        const intoDown = compareExact(remaining, downRemaining) <= 0 ? remaining : downRemaining;
        downRemaining = subExact(downRemaining, intoDown);
        remaining = subExact(remaining, intoDown);
      }
      if (compareExact(remaining, "0.0000") === 0) continue;
      // Then: flow the rest into lines (seq order, WAIVED skipped, capped by
      // the line's outstanding and the global assignable remaining).
      for (let index = 0; index < lines.length && compareExact(remaining, "0.0000") > 0; index += 1) {
        const line = lines[index]!;
        const bucket = perLine[index]!;
        if (line.status === "WAIVED") continue;
        const alreadyCollected = bucket.collected;
        const lineOutstanding = subExact(line.amount, alreadyCollected);
        if (compareExact(lineOutstanding, "0.0000") <= 0) continue;
        const applied =
          compareExact(remaining, lineOutstanding) <= 0 ? remaining : lineOutstanding;
        if (compareExact(assignableRemaining, "0.0000") <= 0) break;
        const granted = compareExact(applied, assignableRemaining) <= 0 ? applied : assignableRemaining;
        if (compareExact(granted, "0.0000") <= 0) break;
        bucket.collected = addExact(bucket.collected, granted);
        bucket.receipts.push({
          receiptId: allocation.receiptId,
          receiptNo: allocation.receiptNo,
          amount: granted,
          valueDate: allocation.valueDate,
        });
        remaining = subExact(remaining, granted);
        assignableRemaining = subExact(assignableRemaining, granted);
      }
    }

    let allDone = true;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const bucket = perLine[index]!;
      if (line.status === "WAIVED") continue;
      const collected = bucket.collected;
      const fullyCollected = compareExact(collected, line.amount) >= 0;
      if (!fullyCollected) allDone = false;
      if (
        line.collectedAmount !== collected ||
        (line.receiptRefs ?? []).length !== bucket.receipts.length ||
        JSON.stringify(line.receiptRefs ?? []) !== JSON.stringify(bucket.receipts) ||
        (fullyCollected && line.status !== "PAID")
      ) {
        const nextStatus: InstallmentLineRow["status"] = fullyCollected ? "PAID" : line.status;
        const updated = await updateLine({
          id: line.id,
          status: nextStatus,
          collectedAmount: collected,
          receiptRefs: bucket.receipts,
        });
        if (updated !== undefined) {
          changed.push(updated);
        }
      }
    }
    return { changedLines: changed, allDone };
  }

  /** The sweep tail: DEFAULTED flip + dunning, then close on residual zero. */
  async applyPlanPolicyOutcome(
    plan: InstallmentPlanRow,
    lines: readonly InstallmentLineRow[],
    today: string,
  ): Promise<void> {
    // DUE / OVERDUE date rules + DEFAULTED consecutive flip.
    const graceDays = plan.lateFeePolicy.grace_days;
    let runOverdue = 0;
    let maxConsecutive = 0;
    for (const line of lines) {
      if (line.status === "WAIVED") continue;
      if (line.status === "PAID" || compareExact(line.collectedAmount, line.amount) >= 0) continue;
      const overdueDays = dayDiff(line.dueDate, today);
      if (overdueDays > graceDays) {
        runOverdue += 1;
        if (line.status !== "OVERDUE") {
          await updateLine({ id: line.id, status: "OVERDUE" });
        }
      } else if (overdueDays >= 0) {
        if (line.status !== "DUE") {
          await updateLine({ id: line.id, status: "DUE" });
        }
        runOverdue = 0;
      } else {
        runOverdue = 0;
      }
      if (runOverdue > maxConsecutive) maxConsecutive = runOverdue;
    }

    if (plan.status === "ACTIVE" && maxConsecutive >= plan.lateFeePolicy.defaulted_after_lines) {
      await updatePlanStatus(plan.id, "DEFAULTED");
      await this.inbox.record({
        category: "installments",
        severity: "warning",
        title: {
          en: "An installment plan flipped DEFAULTED",
          ar: "تحولت خطة أقساط إلى التعثر",
        },
        body: {
          en: `Plan ${plan.sourceNo ?? plan.id} (${plan.totalAmount}) has ${maxConsecutive} consecutive overdue installment(s) after the ${plan.lateFeePolicy.grace_days}-day grace — dunning follows the late-fee policy (rate ${plan.lateFeePolicy.rate}, cap ${plan.lateFeePolicy.cap}).`,
          ar: `الخطة ${plan.sourceNo ?? plan.id} (${plan.totalAmount}) بها ${maxConsecutive} قسطًا متأخرًا متتاليًا بعد سماح ${plan.lateFeePolicy.grace_days} يومًا — تتبع التحصيل سياسة الرسوم (نسبة ${plan.lateFeePolicy.rate}، سقف ${plan.lateFeePolicy.cap}).`,
        },
        actionUrl: "/installments",
        dedupeKey: `installments-defaulted:${plan.id}`,
      });
    }

    // Residual zero closes the plan (all lines PAID/WAIVED + collected).
    const allResolved = lines.every(
      (line) => line.status === "WAIVED" || compareExact(line.collectedAmount, line.amount) >= 0,
    );
    if (allResolved && lines.length > 0 && plan.status !== "CLOSED") {
      await updatePlanStatus(plan.id, "CLOSED");
    }
  }
}

function dayDiff(dueDate: string, today: string): number {
  const dueMs = new Date(`${dueDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  return ((todayMs - dueMs) / 86_400_000) | 0;
}
