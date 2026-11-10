import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import { drillRoute } from "../../application/scope";
import {
  ISO_DATE,
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  drill,
  moneyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-027 wave E · `notes.dishonored-register` (REPORT_CATALOG §9 row 233 —
 * the report key the catalog pins verbatim): the DISHONOR events in a window
 * — rows from `note_events` WHERE event_kind = 'DISHONOR' (the economic
 * event_date anchor), joined to their notes + partners — each carrying its
 * G-26 restore provenance: the reason (refs.reason — BR-046 requires one),
 * the bank fee (refs.bankFee — base currency) and the journal entry no
 * (refs.entryNo, drilled to the journal for holders of the read permission).
 *
 * No GL assertion (a provenance register — REPORT_CATALOG §9 rule 2/the
 * movements precedent): instead the block-on-fail `dishonor-provenance`
 * sanity — every row MUST carry a journalEntryId (the append-only shape
 * enforces it: money events carry journals, ck_note_events_journal_shape);
 * a null surfaces as drift, never silently.
 *
 * Permission `notes.notes.view`. Deterministic over the window.
 */

const DISHONOR_PROVENANCE = assertDecl(
  "dishonor-provenance",
  "every DISHONOR row carries its G-26 journal entry (journalEntryId never null)",
  "صف ارتداد بلا قيده المحاسبي (G-26) — سجل المصدر مكسور",
  "A dishonored row without its G-26 journal entry — the provenance register is broken",
  "G-26",
);

/** The provenance result: rows vs rows-with-journal (FAIL names the count). */
function provenanceResult(rows: readonly { journalEntryId: string | null }[]): AssertionResult {
  const missing = rows.filter((row) => row.journalEntryId === null || row.journalEntryId === "").length;
  const ok = missing === 0;
  return {
    id: "dishonor-provenance",
    status: ok ? "PASS" : "FAIL",
    compared: { left: String(rows.length), right: String(rows.length - missing) },
    detail: ok
      ? undefined
      : {
          ar: `${missing} صف ارتداد بلا قيد G-26 — سجل الأحداث الملحق لا يسمح بذلك (شكل القيد الإلزامي)؛ يرجى التحقق من سجل المصدر`,
          en: `${missing} dishonored row(s) carry no G-26 journal entry — the append-only event shape requires one; investigate the source register`,
        },
  };
}

export const notesDishonoredRegisterContract = defineReport({
  id: "notes.dishonored-register",
  version: 1,
  title: bilingual("سجل الأوراق المرتجعة", "Dishonored Notes Register"),
  category: "financial",
  description: bilingual(
    "سجل أحداث الارتداد في فترة: كل حدث ارتداد مع ورقته وشريكه والسبب والرسوم البنكية ومرجعه المحاسبي (G-26) مع رابط القيد — يحمل فحص dishonor-provenance الذي يمنع التصدير عند فقد المرجع",
    "The dishonor events in a window: every DISHONOR event with its note, partner, reason, bank fee and G-26 journal provenance (with the drill link) — carrying the dishonor-provenance check that blocks exports when the provenance is missing",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    partnerId: z.string().uuid().optional(),
    reason: z.string().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "notes.notes.view",
  dataSources: [
    source(
      "notes",
      "notesQueries.dishonoredRegister (the DISHONOR window over the append-only custody log)",
      ["note_events", "notes"],
      "أحداث الارتداد من سجل العهدة الملحق مع سجل الأوراق",
      "DISHONOR events from the append-only custody log joined to the notes register",
    ),
    source(
      "accounting",
      "journal_entries (the G-26 restore entries — per-row provenance)",
      ["journal_entries"],
      "قيود الاستعادة G-26 لكل صف — المرجع والرقم",
      "The G-26 restore entries — per-row provenance (id + entry no)",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  drillTargets: [
    drill(
      "journalEntryNo",
      "/{locale}/accounting/journals/{journalEntryId}",
      "القيد المحاسبي",
      "Journal entry",
      "accounting.journals.read",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "bankFee", kind: "sum" }],
    sorting: [{ by: "eventDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "journal.reversed"],
  },
  assertions: [DISHONOR_PROVENANCE],
  run: async (ctx, params) => {
    const { notes } = reportingServices();
    const rows = await notes.dishonoredRegister({
      dateFrom: params.dateFrom!,
      dateTo: params.dateTo!,
      partnerId: params.partnerId ?? null,
      reasonContains: typeof params.reason === "string" && params.reason.length > 0 ? params.reason : null,
    });

    let bankFeeTotal = "0.0000";
    for (const row of rows) {
      if (row.bankFee !== null) {
        bankFeeTotal = addExact(bankFeeTotal, row.bankFee);
      }
    }

    return {
      columns: [
        col("eventDate", "تاريخ الارتداد", "Event date", "date"),
        col("number", "رقم الورقة", "Note no"),
        col("partner", "الشريك", "Partner"),
        moneyCol("amount", "المبلغ", "Amount"),
        col("currency", "العملة", "Currency"),
        col("reason", "سبب الارتداد", "Reason"),
        moneyCol("bankFee", "الرسوم البنكية", "Bank fee"),
        col("journalEntryNo", "القيد (G-26)", "Journal entry (G-26)"),
      ],
      groups: [],
      rows: rows.map((row) => {
        const drillLinks: { label: { ar: string; en: string }; route: string }[] = [];
        if (row.journalEntryId !== null) {
          const route = drillRoute(
            ctx,
            `/${params.locale}/accounting/journals/${row.journalEntryId}`,
            "accounting.journals.read",
          );
          if (route !== null) {
            drillLinks.push({
              label: bilingual("القيد المحاسبي", "Journal entry"),
              route,
            });
          }
        }
        return {
          key: row.eventId,
          values: {
            eventDate: row.eventDate,
            number: row.number,
            partner: row.partnerName,
            amount: row.amount,
            currency: row.currency,
            reason: row.reason,
            bankFee: row.bankFee,
            journalEntryNo: row.entryNo,
          },
          drillLinks,
        };
      }),
      totals: [
        {
          id: "dishonorCount",
          kind: "sum",
          label: bilingual("عدد أحداث الارتداد", "Dishonor events"),
          amount: String(rows.length),
        },
        {
          id: "bankFeeTotal",
          kind: "sum",
          label: bilingual("إجمالي الرسوم البنكية (أساس)", "Total bank fees (base)"),
          amount: bankFeeTotal,
        },
      ],
      assertionResults: [provenanceResult(rows)],
      notes: [
        bilingual(
          "كل صف حدث ارتداد من سجل العهدة الملحق بتاريخه الاقتصادي، ومرجعه المحاسبي من refs (السبب refs.reason والرسوم refs.bankFee ورقم القيد refs.entryNo) — الاستعادة G-26 تعيد البند الأصلي كما كان تماماً (repoint-restore) مع رسوم بنكية اختيارية على BANK_CHARGES",
          "Every row is a DISHONOR event from the append-only custody log at its economic date, with its provenance from refs (reason = refs.reason, fee = refs.bankFee, entry no = refs.entryNo) — the G-26 restore brings the original open item back exactly (repoint-restore) with an optional bank fee on BANK_CHARGES",
        ),
        bilingual(
          "السبب مطلوب (BR-046) والرسوم بالعملة الأساسية؛ المبلغ بعملة الورقة — لذا الإجماليات المجمعة على الرسوم فقط",
          "The reason is mandatory (BR-046) and fees are base-currency; the amount is the note's own currency — hence only the fees carry a summed total",
        ),
      ],
    };
  },
});
