import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { PurchaseOrderService } from "./orders";
import { BlanketService } from "./blanket";
import * as store from "../infrastructure/sourcing.store";
import * as collab from "../infrastructure/collaboration.store";
import {
  scoreOffers,
  threeBidDecision,
  type ScoredOffer,
} from "./sourcing-math";
import {
  AwardDecisionInvalidError,
  ComparisonNotFoundError,
  ComparisonStateError,
  NoQuotesToCompareError,
  RfqNotFoundError,
  RfqStateError,
  ThreeBidRuleViolatedError,
} from "../domain/sourcing-errors";

/**
 * Comparison / award-matrix service (PHASE-038 T-04; P-02/P-08; BR-062/
 * BR-063): the FROZEN comparison snapshot — per-line offers + scores +
 * supplier totals, written ONCE at prepare and never recomputed (the
 * phase §7 risk note: the matrix is evidence) — and the award decision:
 * line-level winners, the 3-bid floor (BR-062, advisory/enforced), the
 * BR-063 one-award-per-round rule, and the generation of the awarded
 * documents (purchase orders grouped per supplier, or a blanket release
 * when the award targets a standing agreement). Every generated document
 * stays traceable through generated_docs + the PO line notes.
 */

interface ComparisonLineSnapshot {
  rfqLineId: string;
  lineNo: number;
  itemId: string;
  qty: string;
  targetPrice: string | null;
  offers: ScoredOffer[];
}

export interface AwardDecisionLine {
  rfqLineId: string;
  quoteId: string;
  supplierId: string;
  qty: string;
  unitPrice: string;
}

@Injectable()
export class AwardService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly inbox: InboxService,
    private readonly orders: PurchaseOrderService,
    private readonly blanket: BlanketService,
  ) {}

  /**
   * Prepare the frozen comparison snapshot for an ISSUED/QUOTED RFQ. The
   * snapshot folds the submitted quotes' offers through the documented
   * scoring (price 60% · delivery 30% · terms 10%); ONE live comparison
   * per RFQ (BR-063's DB floor).
   */
  async prepare(input: { rfqId: string; actorId: string | null }) {
    const rfq = await store.findRfqById(input.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(input.rfqId);
    if (rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new RfqStateError(
        `RFQ ${input.rfqId} is ${rfq.status} — comparisons prepare on ISSUED/QUOTED rounds only`,
      );
    }
    const live = await store.findLiveComparisonByRfq(input.rfqId);
    if (live !== undefined) {
      throw new ComparisonStateError(
        `RFQ ${input.rfqId} already carries a live comparison (${live.id}, ${live.status}) — BR-063: one award round at a time; cancel it first`,
      );
    }
    const quotes = (await store.listSupplierQuotes(input.rfqId)).filter(
      (q) => q.status === "SUBMITTED",
    );
    if (quotes.length === 0) throw new NoQuotesToCompareError(input.rfqId);

    const rfqLines = await store.listRfqLines(input.rfqId);
    const linesByQuote = new Map<string, Awaited<ReturnType<typeof store.listQuoteLines>>>();
    for (const quote of quotes) {
      linesByQuote.set(quote.id, await store.listQuoteLines(quote.id));
    }

    const asOf = new Date().toISOString().slice(0, 10);
    const lines: ComparisonLineSnapshot[] = rfqLines.map((rfqLine) => {
      const offers: ScoredOffer[] = [];
      for (const quote of quotes) {
        const quoteLine = linesByQuote.get(quote.id)?.find((l) => l.rfqLineId === rfqLine.id);
        if (quoteLine === undefined) continue;
        offers.push(
          ...scoreOffers(rfqLine.qty, [
            {
              quoteId: quote.id,
              supplierId: quote.supplierId,
              unitPrice: quoteLine.unitPrice,
              leadTimeDays: quoteLine.leadTimeDays ?? quote.leadTimeDays,
              validUntil: quote.validUntil,
              asOf,
            },
          ]),
        );
      }
      return {
        rfqLineId: rfqLine.id,
        lineNo: rfqLine.lineNo,
        itemId: rfqLine.itemId,
        qty: rfqLine.qty,
        targetPrice: rfqLine.targetPrice,
        offers,
      };
    });

    // Supplier totals across ALL their offered lines (the value view).
    const supplierTotals = new Map<string, { supplierId: string; total: string; lines: number }>();
    for (const line of lines) {
      for (const offer of line.offers) {
        const prior = supplierTotals.get(offer.supplierId);
        const next = new Decimal(prior?.total ?? "0").plus(new Decimal(offer.lineTotal));
        supplierTotals.set(offer.supplierId, {
          supplierId: offer.supplierId,
          total: next.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
          lines: (prior?.lines ?? 0) + 1,
        });
      }
    }

    const snapshot = {
      preparedAt: new Date().toISOString(),
      preparedBy: input.actorId,
      weights: { price: 0.6, delivery: 0.3, terms: 0.1 },
      currency: rfq.currencyCode,
      lines,
      summary: {
        quotesReceived: quotes.length,
        suppliers: [...new Set(quotes.map((q) => q.supplierId))].length,
        supplierTotals: [...supplierTotals.values()],
      },
    };
    const comparisonId = await store.insertComparison({
      rfqId: input.rfqId,
      snapshot: snapshot as unknown as Record<string, unknown>,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "purchasing.comparison_prepared",
      entityType: "quote_comparison",
      entityId: comparisonId,
      actorId: input.actorId ?? undefined,
      after: { rfqId: input.rfqId, quotes: quotes.length },
    });
    const comparison = await store.findComparisonById(comparisonId);
    if (comparison === undefined) throw new ComparisonNotFoundError(comparisonId);
    return comparison;
  }

  async find(id: string) {
    const comparison = await store.findComparisonById(id);
    if (comparison === undefined) throw new ComparisonNotFoundError(id);
    return comparison;
  }

  async findLiveByRfq(rfqId: string) {
    const comparison = await store.findLiveComparisonByRfq(rfqId);
    if (comparison === undefined) throw new ComparisonNotFoundError("(rfq)");
    return comparison;
  }

  async cancel(id: string, actorId: string | null) {
    const comparison = await this.find(id);
    if (comparison.status === "AWARDED") {
      throw new ComparisonStateError(
        `comparison ${id} is AWARDED — awarded evidence never cancels (INV-003; the round closed)`,
      );
    }
    await store.cancelComparison(id);
    await this.audit.record({
      action: "purchasing.comparison_cancelled",
      entityType: "quote_comparison",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  /**
   * Award: the line-level decisions land on the frozen comparison, the
   * 3-bid floor evaluates (BR-062: ENFORCED rejects typed / ADVISORY
   * warns once), BR-063 closes the round, and the awarded documents
   * generate: purchase orders grouped per supplier (the default) or a
   * blanket release when the award targets a standing agreement (single
   * supplier only — the release is per-agreement).
   */
  async award(input: {
    comparisonId: string;
    decisions: readonly AwardDecisionLine[];
    blanketOrderId?: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const comparison = await this.find(input.comparisonId);
    if (comparison.status !== "PREPARED") {
      throw new ComparisonStateError(
        `comparison ${input.comparisonId} is ${comparison.status} — awards land on PREPARED matrices only (BR-063: one award per round)`,
      );
    }
    const rfq = await store.findRfqById(comparison.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(comparison.rfqId);

    // -- decision validation against the FROZEN snapshot ------------------
    const snapshot = comparison.snapshot as unknown as {
      lines: ComparisonLineSnapshot[];
    };
    const snapshotLines = new Map(snapshot.lines.map((l) => [l.rfqLineId, l]));
    if (input.decisions.length === 0) {
      throw new AwardDecisionInvalidError("an award must decide at least one line");
    }
    for (const decision of input.decisions) {
      const line = snapshotLines.get(decision.rfqLineId);
      if (line === undefined) {
        throw new AwardDecisionInvalidError(
          `decision references an RFQ line outside this comparison: ${decision.rfqLineId}`,
        );
      }
      const offer = line.offers.find((o) => o.quoteId === decision.quoteId);
      if (offer === undefined) {
        throw new AwardDecisionInvalidError(
          `decision references a quote that carries no offer on line ${decision.rfqLineId}: ${decision.quoteId}`,
        );
      }
      if (offer.supplierId !== decision.supplierId) {
        throw new AwardDecisionInvalidError(
          `decision supplier ${decision.supplierId} does not match the offer's supplier ${offer.supplierId}`,
        );
      }
      if (
        new Decimal(decision.qty).lte(0) ||
        new Decimal(decision.qty).comparedTo(new Decimal(line.qty)) > 0
      ) {
        throw new AwardDecisionInvalidError(
          `decision qty ${decision.qty} exceeds the requested ${line.qty} on line ${decision.rfqLineId}`,
        );
      }
      if (new Decimal(decision.unitPrice).comparedTo(new Decimal(offer.unitPrice)) !== 0) {
        throw new AwardDecisionInvalidError(
          `decision unit price ${decision.unitPrice} must equal the frozen offer ${offer.unitPrice} — the matrix is the evidence; renegotiation opens a new round`,
        );
      }
    }

    // -- the 3-bid floor (BR-062) -----------------------------------------
    const submittedQuotes = await store.countSubmittedQuotes(rfq.id);
    const mode = (await store.readSetting<string>("purchasing.rfq.three_bid_mode")) ?? "OFF";
    const minQuoteCount =
      (await store.readSetting<number>("purchasing.rfq.min_quote_count")) ?? 0;
    const verdict = threeBidDecision({ mode, minQuoteCount, submittedQuotes });
    if (verdict === "reject") {
      throw new ThreeBidRuleViolatedError({ minQuotes: minQuoteCount, received: submittedQuotes });
    }
    if (verdict === "warn") {
      await this.inbox.record({
        category: "purchasing",
        severity: "warning",
        title: { ar: "قاعدة العروض الثلاثة", en: "3-bid rule advisory" },
        body: {
          ar: `الترسية على الطلب «${rfq.rfqNo ?? rfq.id}» تمت بـ ${submittedQuotes} عرضاً فقط مقابل حد ${minQuoteCount} (BR-062 استشاري)`,
          en: `The award on RFQ "${rfq.rfqNo ?? rfq.id}" proceeds with ${submittedQuotes} quotes against the ${minQuoteCount} floor (BR-062 advisory)`,
        },
        dedupeKey: `three-bid-warn:${rfq.id}`,
      });
      await this.audit.record({
        action: "purchasing.three_bid_warning",
        entityType: "rfq",
        entityId: rfq.id,
        actorId: input.actorId ?? undefined,
        after: { minQuoteCount, submittedQuotes, mode },
      });
    }

    // -- generation: POs grouped per supplier, or the blanket release ------
    const generatedDocs: { kind: string; id: string; supplierId: string; documentNo?: string | null }[] = [];
    const awardLineRefs: {
      rfqLineId: string;
      quoteId: string;
      supplierId: string;
      poId?: string;
      poLineNo?: number;
      releaseId?: string;
    }[] = [];
    const rfqLines = await store.listRfqLines(rfq.id);
    const rfqLineById = new Map(rfqLines.map((l) => [l.id, l]));
    const quoteLineByQuote = new Map<string, Map<string, { lineNo: number; unitPrice: string }>>();
    for (const quote of await store.listSupplierQuotes(rfq.id)) {
      const lines = await store.listQuoteLines(quote.id);
      quoteLineByQuote.set(
        quote.id,
        new Map(lines.map((l) => [l.rfqLineId, { lineNo: l.lineNo, unitPrice: l.unitPrice }])),
      );
    }

    const suppliers = [...new Set(input.decisions.map((d) => d.supplierId))];
    const decisionLines = new Map<string, AwardDecisionLine[]>();
    for (const decision of input.decisions) {
      const list = decisionLines.get(decision.supplierId) ?? [];
      list.push(decision);
      decisionLines.set(decision.supplierId, list);
    }

    if (input.blanketOrderId !== undefined && input.blanketOrderId !== null) {
      if (suppliers.length !== 1) {
        throw new AwardDecisionInvalidError(
          "a blanket-release award requires a single winning supplier (the release is per-agreement)",
        );
      }
      const blanket = await collab.findBlanketOrderById(input.blanketOrderId);
      if (blanket === undefined) {
        throw new AwardDecisionInvalidError(`blanket order ${input.blanketOrderId} does not exist in this tenant`);
      }
      if (blanket.supplierId !== suppliers[0]) {
        throw new AwardDecisionInvalidError(
          `blanket order ${input.blanketOrderId} belongs to supplier ${blanket.supplierId}, not the awarded ${suppliers[0]}`,
        );
      }
      const lines = (decisionLines.get(suppliers[0]!) ?? []).map((d) => ({
        itemId: rfqLineById.get(d.rfqLineId)!.itemId,
        qty: d.qty,
        unitPrice: d.unitPrice,
      }));
      const release = await this.blanket.releaseFromAward({
        blanketId: input.blanketOrderId,
        lines,
        rfqNo: rfq.rfqNo,
        actorId: input.actorId,
      });
      generatedDocs.push({
        kind: "BLANKET_RELEASE",
        id: release.releaseId,
        supplierId: suppliers[0]!,
        documentNo: release.releaseNo,
      });
      for (const decision of decisionLines.get(suppliers[0]!) ?? []) {
        awardLineRefs.push({ ...decision, releaseId: release.releaseId });
      }
    } else {
      // One PO per awarded supplier; each line's note carries the RFQ/quote
      // traceability (the human-visible leg; generated_docs carries the
      // machine leg).
      for (const supplierId of suppliers) {
        const decisions = decisionLines.get(supplierId) ?? [];
        const created = await this.orders.create({
          branchId: rfq.branchId,
          supplierId,
          orderDate: new Date().toISOString().slice(0, 10),
          expectedDate: null,
          currencyCode: rfq.currencyCode,
          exchangeRate: null,
          note: `RFQ award ${rfq.rfqNo ?? rfq.id}`,
          noteAr: `ترسية طلب عروض ${rfq.rfqNo ?? rfq.id}`,
          actorId: input.actorId,
          lines: decisions.map((d) => {
            const quoteLine = quoteLineByQuote.get(d.quoteId)?.get(d.rfqLineId);
            const rfqLine = rfqLineById.get(d.rfqLineId)!;
            const quoteNo = rfq.rfqNo ?? rfq.id;
            return {
              itemId: rfqLine.itemId,
              qty: d.qty,
              unitPrice: d.unitPrice,
              taxCodeId: null,
              note: `RFQ ${quoteNo} award / quote line ${quoteLine?.lineNo ?? "?"}`,
            };
          }),
        });
        generatedDocs.push({
          kind: "PURCHASE_ORDER",
          id: created.id,
          supplierId,
          documentNo: created.orderNo,
        });
        for (const decision of decisions) {
          const poLineNo =
            decisions.findIndex((d) => d.rfqLineId === decision.rfqLineId) + 1;
          awardLineRefs.push({ ...decision, poId: created.id, poLineNo });
        }
        await this.audit.record({
          action: "purchasing.award_generated_po",
          entityType: "purchase_order",
          entityId: created.id,
          actorId: input.actorId ?? undefined,
          after: { rfqId: rfq.id, lines: decisions.length, totalNet: created.totalNet },
        });
      }
    }

    // -- commit the award (BR-063: the round closes) -----------------------
    await store.awardComparison(input.comparisonId, {
      award: {
        awardedAt: new Date().toISOString(),
        decisions: awardLineRefs,
        blanketOrderId: input.blanketOrderId ?? null,
      },
      awardedBy: input.actorId,
      awardNote: input.note,
      awardNoteAr: input.noteAr,
      generatedDocs,
    });
    await store.updateRfq(rfq.id, {
      status: "AWARDED",
      awardedAt: new Date().toISOString(),
      awardedBy: input.actorId,
    });
    await this.audit.record({
      action: "purchasing.rfq_awarded",
      entityType: "rfq",
      entityId: rfq.id,
      actorId: input.actorId ?? undefined,
      after: {
        comparisonId: input.comparisonId,
        lines: input.decisions.length,
        suppliers,
        threeBid: { mode, minQuoteCount, submittedQuotes, verdict },
        generatedDocs,
      },
    });
    return this.find(input.comparisonId);
  }
}
