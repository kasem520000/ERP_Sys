import { z } from "zod";

import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-041 (REPORT_CATALOG §7 addition · H-22): the outbound delivery log
 * — the send ledger as a report contract (status, provider, provider ref,
 * cost, attempts, the source that produced the send). One row per
 * outbound_messages row: QUEUED/SENT/DELIVERED/FAILED with the retry
 * ladder visible (attempts/max), the paid-channel cost fields, and the
 * channel mix filter. The delivery leg of N-06/N-07/N-08's audit story.
 */

const DELIVERY_SOURCES = ["outbound_messages", "partners"] as const;

export const communicationOutboundDeliveryLogContract = defineReport({
  id: "communication.outbound_delivery_log",
  version: 1,
  title: bilingual("سجل الإرسال الخارجي", "Outbound Delivery Log"),
  category: "platform",
  description: bilingual(
    "سجل التسليم: كل رسالة صادرة بصف مستقل — الحالة والمزوّد ومرجعه والتكلفة ومحاولات الإرسال والمصدر",
    "The delivery ledger: every outbound send as a row — status, provider, provider ref, cost, attempts, and the source that produced it",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]).optional(),
    status: z.enum(["QUEUED", "SENT", "DELIVERED", "FAILED"]).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "communication.outbox.read",
  dataSources: [
    source(
      "communication",
      "communication.outboundDeliveryLog",
      [...DELIVERY_SOURCES],
      "سجل الرسائل الخارجية مع ربط الجهات",
      "The outbound send ledger with the partner link",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "outbox-cost-shape",
      "every costed row carries amount AND currency (the ck_outbound_messages_cost_shape mirror)",
      "كل صف مكلف يحمل المبلغ والعملة معاً (مرآة قيد التكلفة)",
      "A costed row lost its currency",
    ),
    assertDecl(
      "outbox-status-vocabulary",
      "every status is one of QUEUED/SENT/DELIVERED/FAILED (the ledger vocabulary)",
      "كل حالة ضمن مفردات سجل الإرسال (QUEUED/SENT/DELIVERED/FAILED)",
      "An unknown send status appeared",
    ),
  ],
  run: async (_ctx, params) => {
    const { communication } = reportingServices();
    const rows = await communication.outboundDeliveryLog({
      dateFrom: params.dateFrom!,
      dateTo: params.dateTo!,
      // The zod enums above already validated the values before run().
      channel: params.channel as "EMAIL" | "WHATSAPP" | "SMS" | undefined,
      status: params.status as "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | undefined,
    });
    const costShapeOk = rows.every(
      (row) => (row.costAmount === null) === (row.costCurrency === null),
    );
    const statusVocabularyOk = rows.every((row) =>
      ["QUEUED", "SENT", "DELIVERED", "FAILED"].includes(row.status),
    );
    const delivered = rows.filter((row) => row.status === "DELIVERED").length;
    const failed = rows.filter((row) => row.status === "FAILED").length;
    const costed = rows.filter((row) => row.costAmount !== null);
    return {
      columns: [
        col("createdAt", "الإنشاء", "Created", "date"),
        col("channel", "القناة", "Channel"),
        col("status", "الحالة", "Status"),
        col("recipient", "المستلم", "Recipient"),
        col("partner", "الجهة", "Partner"),
        col("module", "الوحدة", "Module"),
        col("templateKey", "القالب", "Template"),
        col("provider", "المزوّد", "Provider"),
        col("providerRef", "مرجع المزوّد", "Provider ref"),
        moneyCol("costAmount", "التكلفة", "Cost"),
        col("costCurrency", "العملة", "Currency"),
        col("attempts", "المحاولات", "Attempts"),
        col("lastError", "آخر خطأ", "Last error"),
        col("sentAt", "الإرسال", "Sent", "date"),
        col("deliveredAt", "التسليم", "Delivered", "date"),
        col("sourceType", "المصدر", "Source"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.messageId,
        group: row.channel,
        values: {
          createdAt: row.createdAt,
          channel: row.channel,
          status: row.status,
          recipient: row.recipient,
          partner: row.partner ?? "—",
          module: row.module,
          templateKey: row.templateKey,
          provider: row.provider ?? "—",
          providerRef: row.providerRef ?? "—",
          costAmount: row.costAmount ?? "—",
          costCurrency: row.costCurrency ?? "—",
          attempts: `${row.attempts}/${row.maxAttempts}`,
          lastError: row.lastError ?? "—",
          sentAt: row.sentAt ?? "—",
          deliveredAt: row.deliveredAt ?? "—",
          sourceType: row.sourceType ?? "MANUAL",
        },
      })),
      totals: [
        {
          id: "delivery-summary",
          label: bilingual(
            `الرسائل: ${rows.length} · مسلّمة: ${delivered} · فاشلة: ${failed} · مكلفة: ${costed.length}`,
            `messages: ${rows.length} · delivered: ${delivered} · failed: ${failed} · costed: ${costed.length}`,
          ),
          amount: "0",
          kind: "check",
        },
      ],
      assertionResults: [
        {
          id: "outbox-cost-shape",
          status: costShapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            costShapeOk ? "المبلغ والعملة يسافران معاً" : "صف مكلف بلا عملة",
            costShapeOk ? "amount and currency travel together" : "a costed row lost its currency",
          ),
        },
        {
          id: "outbox-status-vocabulary",
          status: statusVocabularyOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            statusVocabularyOk ? "الحالات ضمن المفردات" : "حالة خارج المفردات",
            statusVocabularyOk ? "statuses within the vocabulary" : "a status outside the vocabulary",
          ),
        },
      ],
    };
  },
});
