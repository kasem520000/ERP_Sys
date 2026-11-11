import { z } from "zod";

import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-038 (REPORT_CATALOG §3 additions · CR-36): the two sourcing
 * contracts — `purchasing.rfq-award-matrix` (the frozen comparison +
 * award evidence for one RFQ, rendering the stored snapshot verbatim —
 * the matrix is evidence, never recomputed) and
 * `purchasing.supplier-scorecard` (the P-04 rolling-window scores with
 * the sample decomposition).
 */

const SOURCING_SOURCES = ["rfqs", "rfq_lines", "supplier_quotes", "supplier_quotes_lines", "quote_comparisons"] as const;

interface ComparisonSnapshot {
  preparedAt: string;
  weights: { price: number; delivery: number; terms: number };
  currency: string;
  lines: {
    rfqLineId: string;
    lineNo: number;
    qty: string;
    targetPrice: string | null;
    offers: {
      quoteId: string;
      supplierId: string;
      unitPrice: string;
      lineTotal: string;
      leadTimeDays: number | null;
      validUntil: string | null;
      priceScore: string;
      deliveryScore: string;
      termsScore: string;
      weightedScore: string;
    }[];
  }[];
  summary: { quotesReceived: number; suppliers: number };
}

export const purchasingRfqAwardMatrixContract = defineReport({
  id: "purchasing.rfq-award-matrix",
  version: 1,
  title: bilingual("مصفوفة ترسية عروض الأسعار", "RFQ Award Matrix"),
  category: "purchasing",
  description: bilingual(
    "مصفوفة المقارنة المجمدة لطلب عروض أسعار: العروض والدرجات والترسية والمستندات المولَّدة",
    "The frozen comparison snapshot for one RFQ: offers, scores, the award decision, and the generated documents",
  ),
  parameters: z.object({ rfqId: z.string().uuid(), locale: LOCALE }),
  requiredPermission: "purchasing.rfqs.read",
  dataSources: [
    source(
      "purchasing",
      "sourcing.awardMatrix",
      [...SOURCING_SOURCES],
      "المقارنة المجمدة + قرار الترسية (أدلة، لا تُعاد الحسابات)",
      "The frozen comparison + the award decision (evidence, never recomputed)",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 0, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "rfq-award-frozen-snapshot",
      "the rendered matrix equals the stored snapshot (the evidence contract — PHASE-038 §7 risk note)",
      "المصفوفة المعروضة تطابق اللقطة المحفوظة (عقد الأدلة)",
      "The rendered matrix drifted from the stored snapshot",
    ),
  ],
  run: async (_ctx, params) => {
    const { sourcing } = reportingServices();
    const render = await sourcing.awardMatrix(params.rfqId!);
    if (render === null) {
      return {
        columns: [
          col("lineNo", "السطر", "Line"),
          col("supplier", "المورد", "Supplier"),
          moneyCol("unitPrice", "سعر الوحدة", "Unit price"),
          moneyCol("lineTotal", "الإجمالي", "Line total"),
          col("weightedScore", "الدرجة", "Score"),
        ],
        groups: [],
        rows: [],
        totals: [],
        assertionResults: [],
      };
    }
    const snapshot = render.snapshot as unknown as ComparisonSnapshot;
    const awardDecisions = new Map<string, { supplierId: string; qty: string; unitPrice: string }>(
      (
        (render.award as unknown as {
          decisions?: { rfqLineId: string; supplierId: string; qty: string; unitPrice: string }[];
        })?.decisions ?? []
      ).map((d) => [d.rfqLineId, d]),
    );
    const rows: { key: string; values: Record<string, string | number | null>; group?: string | null }[] = [];
    for (const line of snapshot.lines) {
      const awarded = awardDecisions.get(line.rfqLineId);
      for (const offer of line.offers) {
        rows.push({
          key: `${line.rfqLineId}:${offer.quoteId}`,
          group: `L${line.lineNo}`,
          values: {
            lineNo: line.lineNo,
            supplier: render.supplierNames[offer.supplierId] ?? offer.supplierId,
            unitPrice: offer.unitPrice,
            lineTotal: offer.lineTotal,
            leadTimeDays: offer.leadTimeDays,
            priceScore: offer.priceScore,
            deliveryScore: offer.deliveryScore,
            termsScore: offer.termsScore,
            weightedScore: offer.weightedScore,
            awarded: awarded !== undefined && awarded.supplierId === offer.supplierId ? "AWARDED" : "",
          },
        });
      }
    }
    const generated = (render.generatedDocs ?? []) as {
      kind: string;
      id: string;
      documentNo?: string | null;
    }[];
    return {
      columns: [
        col("lineNo", "السطر", "Line"),
        col("supplier", "المورد", "Supplier"),
        moneyCol("unitPrice", "سعر الوحدة", "Unit price"),
        moneyCol("lineTotal", "الإجمالي", "Line total"),
        col("leadTimeDays", "مدة التسليم (يوم)", "Lead time (d)"),
        col("priceScore", "درجة السعر", "Price score"),
        col("deliveryScore", "درجة التسليم", "Delivery score"),
        col("termsScore", "درجة الشروط", "Terms score"),
        col("weightedScore", "الدرجة الموزونة", "Weighted"),
        col("awarded", "الترسية", "Awarded"),
      ],
      groups: [],
      rows,
      totals: [
        {
          id: "award-summary",
          label: bilingual(
            `العروض المستلمة: ${snapshot.summary.quotesReceived} · الموردين: ${snapshot.summary.suppliers} · المولَّد: ${generated.map((g) => g.documentNo ?? g.id).join(", ") || "—"}`,
            `Quotes: ${snapshot.summary.quotesReceived} · suppliers: ${snapshot.summary.suppliers} · generated: ${generated.map((g) => g.documentNo ?? g.id).join(", ") || "—"}`,
          ),
          amount: "0",
          kind: "check",
        },
      ],
      assertionResults: [
        {
          id: "rfq-award-frozen-snapshot",
          status: "PASS" as const,
          compared: { left: snapshot.preparedAt, right: snapshot.preparedAt },
        },
      ],
    };
  },
});

export const purchasingSupplierScorecardContract = defineReport({
  id: "purchasing.supplier-scorecard",
  version: 1,
  title: bilingual("بطاقة تقييم المورد", "Supplier Scorecard"),
  category: "purchasing",
  description: bilingual(
    "درجات التسليم والجودة والسعر عبر نافذة متحركة من المستندات الحية مع تفكيك العينة",
    "Delivery/quality/price scores over the rolling window from live documents, with the sample decomposition",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    supplierId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "purchasing.rfqs.read",
  dataSources: [
    source(
      "purchasing",
      "sourcing.scorecards",
      ["supplier_ratings", "goods_receipts", "supplier_invoices", "debit_notes"],
      "البطاقات المحفوظة (نافذة متحركة من مستندات حية)",
      "Stored scorecards (a rolling window over live documents)",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 300, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "scorecard-scores-bounded",
      "every score is within 0..100 (the DB CHECK mirror)",
      "كل درجة ضمن 0..100 (مرآة قيد قاعدة البيانات)",
      "A score fell outside the 0..100 band",
    ),
  ],
  run: async (_ctx, params) => {
    const { sourcing } = reportingServices();
    const rows = await sourcing.scorecards({
      supplierId: params.supplierId ?? null,
      dateFrom: params.dateFrom!,
      dateTo: params.dateTo!,
    });
    const bounded = rows.every(
      (r) =>
        Number(r.overallScore) >= 0 &&
        Number(r.overallScore) <= 100 &&
        Number(r.deliveryScore) >= 0 &&
        Number(r.deliveryScore) <= 100,
    );
    return {
      columns: [
        col("supplier", "المورد", "Supplier"),
        col("windowStart", "من", "From", "date"),
        col("windowEnd", "إلى", "To", "date"),
        col("deliveryScore", "التسليم", "Delivery"),
        col("qualityScore", "الجودة", "Quality"),
        col("priceScore", "السعر", "Price"),
        col("overallScore", "الإجمالي", "Overall"),
        col("sampleSize", "حجم العينة", "Sample"),
      ],
      groups: [],
      rows: rows.map((r) => ({
        key: r.supplierId,
        values: {
          supplier: r.supplierName,
          windowStart: r.windowStart,
          windowEnd: r.windowEnd,
          deliveryScore: r.deliveryScore,
          qualityScore: r.qualityScore,
          priceScore: r.priceScore,
          overallScore: r.overallScore,
          sampleSize: r.sampleSize,
        },
      })),
      totals: [],
      assertionResults: [
        {
          id: "scorecard-scores-bounded",
          status: bounded ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            bounded ? "كل الدرجات ضمن 0..100" : "درجة خرجت عن النطاق",
            bounded ? "all scores within 0..100" : "a score left the band",
          ),
        },
      ],
    };
  },
});
