import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import {
  ISO_DATE,
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  moneyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";
import { tieSideBroken, type NotesTieSides } from "./notes-queries";

/**
 * PHASE-027 wave E · `notes.maturity-calendar` (REPORT_CATALOG §9 row 231 —
 * the report key the catalog pins verbatim): the PDC maturity calendar
 * auto-derived from `maturity_date` (BR-045 — no calendar table exists; the
 * register §C lists none). Every row is a note LIVE as-of —
 * IN_CUSTODY/ENDORSED_OUT/DEPOSITED reconstructed at the as-of date:
 *
 * - AS-OF RULE: the population is the notes rows WHERE created_at::date ≤
 *   asOf, and the as-of STATUS is rebuilt from the append-only custody log —
 *   the latest note_events row with event_date ≤ asOf determines the as-of
 *   status (RECLASSIFY never changes custody, BR-047); a note with no event
 *   yet at asOf was IN_CUSTODY (its G-24/G-27 creation state). The live
 *   `notes.status` column (current state) is never the as-of answer.
 * - buckets: OVERDUE (< asOf), THIS_WEEK [0,7), D30 [7,30), D60 [30,60),
 *   D90 [60,90), BEYOND [90,∞) — integral day arithmetic, the PDC fold
 *   convention.
 *
 * The footer carries the `inv024-custody-tie` block-on-fail assertion
 * (REPORT_CATALOG §9 note): Σ live notes (amount × the effective stored
 * rate, INV-008) == the NOTES_RECEIVABLE + NOTES_PAYABLE account balances
 * as-of (the RC-11 register fold, date-anchored). INV-024: custody equals
 * journal effects — a resolved-as-of note carries zero balance on both the
 * register and the GL sides. The tie is WHOLE TENANT — display filters
 * (direction/partner/bank) never narrow the ledger check. Tolerance 0.
 *
 * Permission `notes.notes.view` (the module's register read key — the
 * catalog §12 reuse rule). As-of deterministic: same (scope, asOf) →
 * byte-identical output.
 */

const INV024_CUSTODY_TIE = assertDecl(
  "inv024-custody-tie",
  "Σ live notes (amount × stored rate) == NOTES_RECEIVABLE + NOTES_PAYABLE account balances as-of (per purpose key)",
  "إجمالي الأوراق الحية حتى التاريخ (المبلغ × السعر المخزن) لا يطابق رصيدي حسابي أوراق القبض وأوراق الدفع",
  "Live notes (amount × stored rate) do not tie to the NOTES_RECEIVABLE + NOTES_PAYABLE account balances as-of",
  "INV-024",
);

/** The BR-045 derivation note (REPORT_CATALOG §9 note under row 231). */
const BR045_NOTE = bilingual(
  "التقويم مشتق آلياً من تاريخ الاستحقاق (BR-045) — لا يوجد جدول تقويم؛ الدلاء: متأخر (قبل التاريخ)، هذا الأسبوع [0،7)، 30 يوم [7،30)، 60 يوم [30،60)، 90 يوم [60،90)، أبعد [90،∞) — حساب الأيام صحيح بدون كسور",
  "The calendar is auto-derived from maturity_date (BR-045) — there is no calendar table; buckets: OVERDUE (before asOf), THIS_WEEK [0,7), D30 [7,30), D60 [30,60), D90 [60,90), BEYOND [90,∞) — integral day arithmetic",
);

const ASOF_RULE_NOTE = bilingual(
  "إعادة البناء حتى التاريخ: مجتمع السجل هو الأوراق التي أُنشئت بتاريخ ≤ التاريخ، والحالة حتى التاريخ تُستخرج من سجل العهدة الملحق — آخر حدث بتاريخ حدث ≤ التاريخ يحدد الحالة (إعادة التصنيف لا تغيّر العهدة، BR-047)، وورقة بلا أحداث بعد كانت في العهدة (حالة الإنشاء G-24/G-27)؛ عمود الحالة الجاري لا يُقرأ أبداً كإجابة حتى التاريخ",
  "The as-of reconstruction: the population is the notes created ≤ asOf, and the as-of status is rebuilt from the append-only custody log — the latest event with event_date ≤ asOf determines the status (RECLASSIFY never changes custody, BR-047); a note with no event yet was IN_CUSTODY (its G-24/G-27 creation state). The current status column is never the as-of answer",
);

const TIE_SCOPE_NOTE = bilingual(
  "فحص inv024-custody-tie على مستوى المستأجر كاملاً حتى التاريخ (كل الاتجاهات والشركاء والبنوك) — مرشحات العرض لا تضيّق فحص دفتر الأستاذ، والغرض غير المخطط يُطوى على رصيد أستاذ صفري فيكشف الانحراف",
  "The inv024-custody-tie check is whole-tenant as-of (all directions, partners and banks) — display filters never narrow the ledger check, and an unmapped purpose folds to a zero GL side so its drift surfaces",
);

/** The combined inv024-custody-tie result (both sides; the broken side(s) named). */
function custodyTieResult(ties: NotesTieSides): AssertionResult {
  const broken = [
    { side: ties.received, label: "RECEIVED/NOTES_RECEIVABLE" },
    { side: ties.issued, label: "ISSUED/NOTES_PAYABLE" },
  ].filter((entry) => tieSideBroken(entry.side));
  const ok = broken.length === 0;
  return {
    id: "inv024-custody-tie",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: addExact(ties.received.registerTotal, ties.issued.registerTotal),
      right: addExact(ties.received.glTotal, ties.issued.glTotal),
    },
    detail: ok
      ? undefined
      : {
          ar: `جانب/جوانب غير مطابقة: ${broken
            .map(
              (entry) =>
                `${entry.label} (سجل ${entry.side.registerTotal} / أستاذ ${entry.side.glTotal} على ${entry.side.accountCodes.join("، ") || "بلا حساب مخطط"})`,
            )
            .join("، ")}`,
          en: `Broken side(s): ${broken
            .map(
              (entry) =>
                `${entry.label} (register ${entry.side.registerTotal} / GL ${entry.side.glTotal} on ${entry.side.accountCodes.join(", ") || "no mapped account"})`,
            )
            .join(", ")}`,
        },
  };
}

export const notesMaturityCalendarContract = defineReport({
  id: "notes.maturity-calendar",
  version: 1,
  title: bilingual("تقويم الاستحقاق", "Maturity Calendar"),
  category: "financial",
  description: bilingual(
    "تقويم استحقاق الأوراق التجارية الحية حتى تاريخ: دلاء الاستحقاق (متأخر/هذا الأسبوع/30/60/90/أبعد) مع الاتجاه والشريك والبنك والحالة حتى التاريخ — يحمل فحص inv024-custody-tie الذي يمنع التصدير عند الفشل",
    "The maturity calendar of live notes as of a date: maturity buckets (OVERDUE/THIS_WEEK/D30/D60/D90/BEYOND) with direction, partner, bank and the as-of status — carrying the inv024-custody-tie ledger check that blocks exports on failure",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    direction: z.enum(["RECEIVED", "ISSUED"]).optional(),
    partnerId: z.string().uuid().optional(),
    bank: z.string().optional(),
    /** PHASE-031 (§2 item 8): group the rows by the source invoice's claim
     * ref (claim cheques per claim) — display-only, the custody tie stays
     * whole-tenant. */
    groupByClaim: z.boolean().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "notes.notes.view",
  dataSources: [
    source(
      "notes",
      "notesQueries.maturityCalendar (the as-of live register — BR-045 auto-derived)",
      ["notes", "note_events"],
      "سجل الأوراق وسجل أحداث العهدة — إعادة بناء الحالة حتى التاريخ",
      "The notes register + the append-only custody log — the as-of status reconstruction",
    ),
    source(
      "accounting",
      "journal (as-of NOTES_RECEIVABLE/NOTES_PAYABLE balances for the custody tie)",
      ["journal_entries", "journal_lines", "account_purposes"],
      "أرصدة حسابات أوراق القبض والدفع حتى التاريخ للمطابقة",
      "The notes-purpose account balances as-of for the tie-out",
    ),
    source(
      "sales",
      "sales_invoices.claim_ref (the source invoice's insurer claim reference — the PHASE-031 group-by-claim key)",
      ["sales_invoices"],
      "مرجع المطالبة على الفاتورة المصدر للتجميع حسب المطالبة",
      "The source invoice's claim reference for the group-by-claim view",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "both",
  aggregation: {
    groupBy: [],
    measures: [{ id: "baseAmount", kind: "sum" }],
    sorting: [{ by: "maturityDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "period.locked"],
  },
  assertions: [INV024_CUSTODY_TIE],
  run: async (_ctx, params) => {
    const { notes } = reportingServices();
    const rows = await notes.maturityCalendar({
      asOf: params.asOf!,
      direction: params.direction === "RECEIVED" || params.direction === "ISSUED" ? params.direction : null,
      partnerId: params.partnerId ?? null,
      bank: typeof params.bank === "string" && params.bank.length > 0 ? params.bank : null,
    });

    let baseTotal = "0.0000";
    let receivedTotal = "0.0000";
    let issuedTotal = "0.0000";
    const claimGroupTotals = new Map<string, string>();
    for (const row of rows) {
      baseTotal = addExact(baseTotal, row.baseAmount);
      if (row.direction === "RECEIVED") {
        receivedTotal = addExact(receivedTotal, row.baseAmount);
      } else {
        issuedTotal = addExact(issuedTotal, row.baseAmount);
      }
      const claimGroupKey = row.claimRef ?? "(no-claim)";
      claimGroupTotals.set(
        claimGroupKey,
        addExact(claimGroupTotals.get(claimGroupKey) ?? "0.0000", row.baseAmount),
      );
    }

    // PHASE-031 (§2 item 8): the claim groups — one per distinct claim ref
    // present in the displayed rows (sorted; the no-claim bucket last), each
    // with its base subtotal. Σ group subtotals == baseTotal exactly.
    const groups =
      params.groupByClaim === true
        ? [...claimGroupTotals.keys()]
            .sort((a, b) => (a === "(no-claim)" ? 1 : b === "(no-claim)" ? -1 : a.localeCompare(b)))
            .map((claimGroupKey) => ({
              key: claimGroupKey,
              label: bilingual(
                claimGroupKey === "(no-claim)" ? "بدون مطالبة" : `المطالبة ${claimGroupKey}`,
                claimGroupKey === "(no-claim)" ? "(no claim)" : `Claim ${claimGroupKey}`,
              ),
              subtotal: { baseAmount: claimGroupTotals.get(claimGroupKey)! },
            }))
        : [];

    const ties = await notes.maturityCalendarTies({ asOf: params.asOf! });

    return {
      columns: [
        col("bucket", "دلو الاستحقاق", "Maturity bucket", "status"),
        col("direction", "الاتجاه", "Direction", "status"),
        col("partner", "الشريك", "Partner"),
        col("number", "رقم الورقة", "Note no"),
        col("issuingBank", "البنك", "Issuing bank"),
        moneyCol("amount", "المبلغ", "Amount"),
        col("currency", "العملة", "Currency"),
        col("status", "الحالة حتى التاريخ", "Status (as-of)", "status"),
        col("maturityDate", "تاريخ الاستحقاق", "Maturity", "date"),
        // PHASE-031 (0042): the source invoice's claim ref — the group-by-claim
        // key (مطالبة تأمينية; null renders the no-claim group).
        col("claimRef", "المطالبة", "Claim"),
      ],
      groups,
      rows: rows.map((row) => ({
        key: row.noteId,
        // PHASE-031: with groupByClaim on, each row carries its claim group
        // key (the source invoice's claim_ref; "(no-claim)" for non-claim
        // notes — never dropped, so the group subtotal ties to the footer).
        ...(params.groupByClaim === true ? { groupKey: row.claimRef ?? "(no-claim)" } : {}),
        values: {
          bucket: row.bucket,
          direction: row.direction,
          partner: params.locale === "ar" ? row.partnerNameAr ?? row.partnerName : row.partnerName,
          number: row.number,
          issuingBank: row.issuingBank,
          amount: row.amount,
          currency: row.currency,
          status: row.statusAsOf,
          maturityDate: row.maturityDate,
          claimRef: row.claimRef,
        },
      })),
      totals: [
        {
          id: "liveNotes",
          kind: "sum",
          label: bilingual("عدد الأوراق الحية", "Live notes"),
          amount: String(rows.length),
        },
        {
          id: "baseTotal",
          kind: "sum",
          label: bilingual("الإجمالي (العملة الأساسية)", "Total (base)"),
          amount: baseTotal,
        },
        {
          id: "receivedTotal",
          kind: "sum",
          label: bilingual("إجمالي أوراق القبض (أساس)", "Received total (base)"),
          amount: receivedTotal,
        },
        {
          id: "issuedTotal",
          kind: "sum",
          label: bilingual("إجمالي أوراق الدفع (أساس)", "Issued total (base)"),
          amount: issuedTotal,
        },
      ],
      assertionResults: [custodyTieResult(ties)],
      notes: [
        BR045_NOTE,
        ASOF_RULE_NOTE,
        TIE_SCOPE_NOTE,
        bilingual(
          "المبلغ بعملة الورقة والإجماليات بالعملة الأساسية بالمخزنة (INV-008 — لا يعاد حساب السعر أبداً)",
          "Amounts are the note's own currency; totals are base at the stored rate (INV-008 — the rate is never recomputed)",
        ),
      ],
    };
  },
});
