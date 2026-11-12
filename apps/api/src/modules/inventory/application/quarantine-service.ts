import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency, readEffectiveSetting } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/inventory.store";
import * as wmsStore from "../infrastructure/wms-store";
import { WmsService } from "./wms.service";
import { applyIssue, planIssue, resolveInventoryAccount } from "./movement-core";
import {
  BinContentNotFoundError,
  BinContentStateError,
} from "../domain/inventory-errors";

/**
 * Quarantine / HOLD board (PHASE-044 T-08; §2.8, I-24/I-21): the control
 * surface over held bin_contents rows — the board view, the policy-gated
 * G-43 posting around every AVAILABLE ↔ QUARANTINE transition, and the
 * three dispositions (RELEASE / RETURN_TO_VENDOR / SCRAP).
 *
 * G-43 (BR-077, the G-15 policy mirror): under the default
 * `inventory.quarantine_posting = "off"` a status transition is a pure
 * structural slot move — NO journal (the same-account default posts
 * nothing, exactly G-15's law). Under "distinct" every transition posts
 * the quarantine leg at qty × avg cost (DR 1290 QUARANTINE_INVENTORY · CR
 * the warehouse INVENTORY on quarantine; the exact mirror on release),
 * fail-closed PURPOSE_NOT_MAPPED until the tenant maps 1290 (the 0070
 * marker; the 038 discipline). HOLD never posts — it is a legal/custom
 * hold, not a valuation state.
 *
 * Dispositions (§2.8): RELEASE returns the row to AVAILABLE (structural +
 * the policy mirror); SCRAP issues the row out through the movement core
 * (G-13 shrinkage shape — DR INVENTORY_SHRINKAGE · CR the stock-carrying
 * account) with the SCRAP serial-ledger event; RETURN_TO_VENDOR issues
 * the row against an EXPLICIT counter account (the manual-issue OTHER
 * discipline — the vendor-clearing leg is the caller's named account) with
 * the RETURN event. The issues ride `directedTakes` on the held row —
 * INV-029's same-transaction law holds at every disposition.
 *
 * PHASE-050 integration point: quality holds bind HERE — the Q-board's
 * transition surface is where inspection holds will pin rows (the board
 * row set + the disposition flows stay the single control surface).
 */
type Disposition = "RELEASE" | "RETURN_TO_VENDOR" | "SCRAP";

@Injectable()
export class QuarantineService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    @Inject(WmsService) private readonly wms: WmsService,
  ) {}

  /** The board: held rows (QUARANTINE + HOLD by default). */
  async board(filter: { status?: string; warehouseId?: string; limit?: number }) {
    const status = filter.status ?? "QUARANTINE";
    return this.wms.listBinContents({
      status,
      warehouseId: filter.warehouseId,
      limit: filter.limit ?? 200,
    });
  }

  /** The policy seam (BR-077): "off" (default) | "distinct". */
  private async postingPolicy(): Promise<"off" | "distinct"> {
    const value = await readEffectiveSetting<string>("inventory.quarantine_posting");
    return value === "distinct" ? "distinct" : "off";
  }

  /**
   * A status transition WITH its G-43 policy leg. The structural move is
   * the wms.service primitive (T-03); this wrapper posts the journal
   * FIRST when the policy demands it (ADR-0007's economic-effect-first
   * order — the structural apply follows in the same transaction).
   */
  async transition(
    contentId: string,
    toStatus: "AVAILABLE" | "QUARANTINE" | "HOLD",
    input: { note: string | null; actorId: string | null },
  ): Promise<{
    content: wmsStore.BinContentRow;
    journalEntryId: string | null;
    policy: "off" | "distinct";
  }> {
    const row = await this.requireRow(contentId);
    const policy = await this.postingPolicy();
    // The G-43 leg fires only on the QUARANTINE boundary (HOLD is never a
    // valuation state — a legal hold, not an accounting one).
    const crossesQuarantine =
      (row.status === "AVAILABLE" && toStatus === "QUARANTINE") ||
      (row.status === "QUARANTINE" && toStatus === "AVAILABLE");
    let journalEntryId: string | null = null;
    if (policy === "distinct" && crossesQuarantine) {
      journalEntryId = await this.postQuarantineLeg({
        contentId,
        row,
        direction: toStatus === "QUARANTINE" ? "TO_QUARANTINE" : "FROM_QUARANTINE",
        actorId: input.actorId,
      });
    }
    const moved = await this.wms.transitionStatus(contentId, toStatus, input);
    await this.audit.record({
      action: "inventory.quarantine_transition",
      entityType: "bin_content",
      entityId: contentId,
      actorId: input.actorId ?? undefined,
      after: { from: row.status, to: toStatus, policy, qty: row.qty, itemId: row.itemId },
    });
    return { content: moved!, journalEntryId, policy };
  }

  /**
   * A disposition over a held row (§2.8): RELEASE / RETURN_TO_VENDOR /
   * SCRAP. Only QUARANTINE/HOLD rows dispose — available stock's exits
   * are the issue/adjustment surfaces, not the board.
   */
  async dispose(input: {
    contentId: string;
    disposition: Disposition;
    note: string | null;
    /** Required for RETURN_TO_VENDOR: the vendor-clearing account
     * (DR side) — the manual-issue OTHER discipline. */
    counterAccountId: string | null;
    actorId: string | null;
  }) {
    const row = await this.requireRow(input.contentId);
    if (row.status === "AVAILABLE") {
      throw new BinContentStateError(
        `bin_contents ${input.contentId} is AVAILABLE — dispositions act on held rows (use the issue surfaces for available stock)`,
      );
    }
    if (row.ownerPartnerId !== null) {
      throw new BinContentStateError(
        `consignment rows (owner set) dispose through the consignment service (BR-076)`,
      );
    }
    if (input.disposition === "RELEASE") {
      const released = await this.transition(input.contentId, "AVAILABLE", {
        note: input.note,
        actorId: input.actorId,
      });
      return {
        disposition: "RELEASE" as const,
        contentId: released.content.id,
        journalEntryId: released.journalEntryId,
        entryNo: null,
        valueAmount: null,
        moveIds: [],
        policy: released.policy,
      };
    }
    if (input.disposition === "RETURN_TO_VENDOR" && (input.counterAccountId ?? null) === null) {
      throw new BinContentStateError(
        "RETURN_TO_VENDOR requires an explicit counter account (the vendor-clearing leg)",
      );
    }
    if (row.serialId !== null && Number(row.qty) !== 1) {
      throw new BinContentStateError(
        `a serialized row carries one unit (qty ${row.qty}) — dispose serials one by one`,
      );
    }

    const policy = await this.postingPolicy();

    // PLAN: the directed issue over the held row exactly.
    const plan = await planIssue({
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      qty: row.qty,
      movedAt: today(),
      moveKind: "issue",
      sourceType: "quarantine_disposition",
      sourceId: input.contentId,
      reason: input.disposition === "SCRAP" ? "SCRAP" : "RETURN_TO_VENDOR",
      batchId: row.batchId,
      serialIds: row.serialId !== null ? [row.serialId] : undefined,
      allowQuarantinedBatch: true,
      memo: input.note,
      memoAr: null,
      directedTakes: [{ contentId: input.contentId, qty: row.qty }],
      binStatuses: [row.status],
      serialEvent: input.disposition === "SCRAP" ? "SCRAP" : "RETURN",
    });

    // POST: the disposition journal. The stock-carrying credit leg: under
    // "distinct" a quarantined row's value sits in 1290 (G-43 moved it) —
    // the CREDIT names the PURPOSE so the posting engine fails closed
    // (PURPOSE_NOT_MAPPED) until mapped (the 038 discipline); under "off"
    // it never left the warehouse INVENTORY account. HOLD rows always
    // credit INVENTORY (HOLD never carried a G-43 leg).
    const memoEn =
      input.disposition === "SCRAP"
        ? `Quarantine disposition — scrap (${row.itemSku ?? row.itemId})`
        : `Quarantine disposition — return to vendor (${row.itemSku ?? row.itemId})`;
    const memoAr =
      input.disposition === "SCRAP"
        ? "تصرف حجر صحي — إتلاف"
        : "تصرف حجر صحي — إرجاع للمورد";
    // POST: the disposition journal. The stock-carrying credit leg: under
    // "distinct" a quarantined row's value sits in 1290 (G-43 moved it) —
    // the CREDIT names the PURPOSE so the posting engine fails closed
    // (PURPOSE_NOT_MAPPED) until mapped (the 038 discipline); under "off"
    // it never left the warehouse INVENTORY account. HOLD rows always
    // credit INVENTORY (HOLD never carried a G-43 leg).
    const creditLeg: JournalLineSpec =
      policy === "distinct" && row.status === "QUARANTINE"
        ? {
            purpose: "QUARANTINE_INVENTORY",
            direction: "CREDIT",
            amount: plan.valueAmount,
            memo: { en: memoEn, ar: memoAr },
          }
        : {
            accountId: await resolveInventoryAccount(row.warehouseId),
            direction: "CREDIT",
            amount: plan.valueAmount,
            memo: { en: memoEn, ar: memoAr },
          };
    const lines: JournalLineSpec[] = [
      input.disposition === "SCRAP"
        ? {
            purpose: "INVENTORY_SHRINKAGE",
            direction: "DEBIT",
            amount: plan.valueAmount,
            memo: { en: memoEn, ar: memoAr },
          }
        : {
            accountId: input.counterAccountId!,
            direction: "DEBIT",
            amount: plan.valueAmount,
            memo: { en: memoEn, ar: memoAr },
          },
      creditLeg,
    ];
    const spec: JournalSpec = {
      source: { docType: "bin_content", docId: input.contentId, operation: "dispose" },
      entryDate: today(),
      description: { en: memoEn, ar: memoAr },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // APPLY: the economic rows + the bin decrement in the SAME transaction.
    const moveIds = await applyIssue(plan, result.journalEntryId);
    await this.audit.record({
      action: "inventory.quarantine_disposition",
      entityType: "bin_content",
      entityId: input.contentId,
      actorId: input.actorId ?? undefined,
      after: {
        disposition: input.disposition,
        itemId: row.itemId,
        qty: row.qty,
        status: row.status,
        policy,
        journalEntryId: result.journalEntryId,
        moveIds,
      },
    });
    return {
      disposition: input.disposition,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      valueAmount: plan.valueAmount,
      moveIds,
    };
  }

  // -- internals -----------------------------------------------------------------------

  private async requireRow(contentId: string) {
    const row = await wmsStore.findBinContentById(contentId);
    if (row === undefined) throw new BinContentNotFoundError(contentId);
    return row;
  }

  /** The G-43 leg at qty × avg cost (the mirror on release) — returns the
   * journal id (null when the honest zero-value floor skips the journal). */
  private async postQuarantineLeg(input: {
    contentId: string;
    row: { itemId: string; warehouseId: string; qty: string; itemSku: string | null };
    direction: "TO_QUARANTINE" | "FROM_QUARANTINE";
    actorId: string | null;
  }): Promise<string | null> {
    const stockRow = await store.findItemStock(input.row.itemId, input.row.warehouseId);
    const amount = new Decimal(input.row.qty)
      .times(new Decimal(stockRow?.avgCost ?? "0"))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    if (Number(amount) <= 0) {
      // The honest zero-value floor: a zero-cost position journals nothing.
      return null;
    }
    const inventoryAccount = await resolveInventoryAccount(input.row.warehouseId);
    const memoEn =
      input.direction === "TO_QUARANTINE"
        ? `Quarantine hold — ${input.row.itemSku ?? input.row.itemId}`
        : `Quarantine release — ${input.row.itemSku ?? input.row.itemId}`;
    const memoAr =
      input.direction === "TO_QUARANTINE" ? "تحويل إلى الحجر الصحي" : "إخلاء من الحجر الصحي";
    const spec: JournalSpec = {
      source: {
        docType: "bin_content",
        docId: input.contentId,
        operation: input.direction === "TO_QUARANTINE" ? "quarantine" : "release",
      },
      entryDate: today(),
      description: { en: memoEn, ar: memoAr },
      currency: await ownTenantBaseCurrency(),
      lines:
        input.direction === "TO_QUARANTINE"
          ? [
              { purpose: "QUARANTINE_INVENTORY", direction: "DEBIT", amount, memo: { en: memoEn, ar: memoAr } },
              { accountId: inventoryAccount, direction: "CREDIT", amount, memo: { en: memoEn, ar: memoAr } },
            ]
          : [
              { accountId: inventoryAccount, direction: "DEBIT", amount, memo: { en: memoEn, ar: memoAr } },
              { purpose: "QUARANTINE_INVENTORY", direction: "CREDIT", amount, memo: { en: memoEn, ar: memoAr } },
            ],
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });
    return result.journalEntryId;
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
