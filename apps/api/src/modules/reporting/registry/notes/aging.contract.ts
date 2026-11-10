import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import type { NoteAgingBucket, NotesTieSide } from "./notes-queries";
import { tieSideBroken } from "./notes-queries";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-027 wave E · `notes.aging` (REPORT_CATALOG §9 row 232 — the report
 * key the catalog pins verbatim): the uncollected notes aged by maturity
 * bucket vs asOf — one row per note LIVE as-of (the same as-of
 * reconstruction as the maturity calendar: notes created ≤ asOf, the status
 * rebuilt from the custody log — the latest event with event_date ≤ asOf,
 * RECLASSIFY never changes custody BR-047, no event yet ⇒ IN_CUSTODY).
 *
 * PHASE-031 (§2 item 8 — the group-by-claim parameter extension): the
 * OPTIONAL `groupByClaim` boolean groups the rows by the SOURCE invoice's
 * claim_ref (the note→invoice source join; claim dunning runs per claim
 * مطالبة, not only per insurer) — a parameter on the EXISTING contract,
 * never a new report key (register §J stays closed). With the parameter on
 * OR off, the footer tie `Σ open notes = NOTES_RECEIVABLE` is unchanged
 * (the grouping never narrows the ledger check — the same display-filter
 * discipline as direction/partner).
 *
 * Buckets are the ar-queries convention (fixed shape): notDue / 1–30 /
 * 31–60 / 61–90 / 90+ days overdue — integral day difference
 * ((asOfMs − dueMs) / 86_400_000 | 0). Bucket columns carry BASE amounts
 * (amount × the effective stored rate, INV-008) so the bucket totals and the
 * tie currency agree; the note's own amount + currency ride along per row.
 *
 * The footer carries BOTH block-on-fail ties, always present (the RC-11
 * register fold date-anchored to asOf): `notes-open-tie` (the received side
 * ties the NOTES_RECEIVABLE balance as-of) and `notes-payable-tie` (the
 * issued mirror ties NOTES_PAYABLE, credit-positive). INV-024: a
 * resolved-as-of note carries zero balance on both sides. The ties are WHOLE
 * TENANT — the direction/partner display filters never narrow the ledger
 * check. Tolerance 0 (exact-decimal compare).
 *
 * Permission `notes.notes.view`. As-of deterministic.
 */

const NOTES_OPEN_TIE = assertDecl(
  "notes-open-tie",
  "Σ open notes (as-of live, amount × stored rate) == NOTES_RECEIVABLE balance as-of",
  "إجمالي أوراق القبض المفتوحة حتى التاريخ (المبلغ × السعر المخزن) لا يطابق رصيد حساب أوراق القبض",
  "Open notes (as-of live, amount × stored rate) do not tie to the NOTES_RECEIVABLE balance as-of",
  "RC-11",
);

const NOTES_PAYABLE_TIE = assertDecl(
  "notes-payable-tie",
  "Σ open issued notes (as-of live, amount × stored rate) == NOTES_PAYABLE balance as-of (credit-positive)",
  "إجمالي أوراق الدفع المفتوحة حتى التاريخ لا يطابق رصيد حساب أوراق الدفع",
  "Open issued notes (as-of live, amount × stored rate) do not tie to the NOTES_PAYABLE balance as-of",
  "RC-11",
);

/** One side's tie result with the account codes in the detail. */
function sideTieResult(id: string, side: NotesTieSide): AssertionResult {
  const ok = !tieSideBroken(side);
  return {
    id,
    status: ok ? "PASS" : "FAIL",
    compared: { left: side.registerTotal, right: side.glTotal },
    detail: ok
      ? undefined
      : {
          ar: `${side.purposeKey} (سجل ${side.registerTotal} / أستاذ ${side.glTotal} على ${side.accountCodes.join("، ") || "بلا حساب مخطط"})`,
          en: `${side.purposeKey} (register ${side.registerTotal} / GL ${side.glTotal} on ${side.accountCodes.join(", ") || "no mapped account"})`,
        },
  };
}

const AGING_BUCKETS: readonly NoteAgingBucket[] = ["notDue", "1_30", "31_60", "61_90", "90_plus"];

const BUCKET_FIELD: Readonly<Record<NoteAgingBucket, string>> = {
  notDue: "notDue",
  "1_30": "b1_30",
  "31_60": "b31_60",
  "61_90": "b61_90",
  "90_plus": "b90Plus",
};

const ASOF_RULE_NOTE = bilingual(
  "الأعمار على الأوراق غير المحصلة الحية حتى التاريخ — نفس إعادة بناء التقويم: الأوراق المنشأة ≤ التاريخ وحالتها من سجل العهدة (آخر حدث بتاريخ ≤ التاريخ؛ إعادة التصنيف لا تغيّر العهدة، BR-047)؛ الدلاء بالعملة الأساسية بالمخزنة (INV-008) ليتطابق مجاميع الدلاء مع المطابقة",
  "The aging is over the uncollected notes live as-of — the same reconstruction as the calendar: notes created ≤ asOf with the status from the custody log (latest event ≤ asOf; RECLASSIFY never changes custody, BR-047); bucket columns are BASE at the stored rate (INV-008) so the bucket totals agree with the tie",
);

const TIE_SCOPE_NOTE = bilingual(
  "مطابقتا notes-open-tie و notes-payable-tie على مستوى المستأجر كاملاً حتى التاريخ (الاتجاه والشريك مرشحات عرض لا تضيّق فحص دفتر الأستاذ)، وكلاهما موجود دائماً — جانب القبض يطابق أوراق القبض وجانب الدفع يطابق أوراق الدفع",
  "The notes-open-tie / notes-payable-tie checks are whole-tenant as-of (direction/partner are display filters that never narrow the ledger check), and BOTH are always present — the received side ties NOTES_RECEIVABLE, the issued side ties NOTES_PAYABLE",
);

export const notesAgingContract = defineReport({
  id: "notes.aging",
  version: 1,
  title: bilingual("أعمار الأوراق التجارية", "Notes Aging"),
  category: "financial",
  description: bilingual(
    "أعمار الأوراق التجارية المفتوحة حتى تاريخ: كل ورقة حية في دلو استحقاقها (غير مستحق/1–30/31–60/61–90/أكثر من 90) مع الإجماليات لكل دلو وعملة — يحمل مطابقتي notes-open-tie و notes-payable-tie اللتين تمنعان التصدير عند الفشل",
    "Open notes aging as of a date: each live note in its maturity bucket (notDue/1–30/31–60/61–90/90+) with per-bucket and per-currency totals — carrying the notes-open-tie / notes-payable-tie ledger checks that block exports on failure",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    direction: z.enum(["RECEIVED", "ISSUED"]).optional(),
    partnerId: z.string().uuid().optional(),
    buckets: z.array(z.enum(["notDue", "1_30", "31_60", "61_90", "90_plus"])).optional(),
    /** PHASE-031 (§2 item 8): group the rows by the source invoice's claim
     * ref (claim dunning per claim) — display-only, the ties stay whole-tenant. */
    groupByClaim: z.boolean().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "notes.notes.view",
  dataSources: [
    source(
      "notes",
      "notesQueries.aging (the as-of live register with maturity buckets)",
      ["notes", "note_events"],
      "سجل الأوراق وسجل العهدة — الأوراق الحية بأعمار الاستحقاق",
      "The notes register + custody log — live notes with maturity ages",
    ),
    source(
      "accounting",
      "journal (as-of NOTES_RECEIVABLE/NOTES_PAYABLE balances for the footer ties)",
      ["journal_entries", "journal_lines", "account_purposes"],
      "أرصدة حسابات أوراق القبض والدفع حتى التاريخ للمطابقتين",
      "The notes-purpose account balances as-of for the footer ties",
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
    measures: [{ id: "baseTotal", kind: "sum" }],
    sorting: [{ by: "maturityDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "period.locked"],
  },
  assertions: [NOTES_OPEN_TIE, NOTES_PAYABLE_TIE],
  run: async (_ctx, params) => {
    const { notes } = reportingServices();
    const rows = await notes.aging({
      asOf: params.asOf!,
      direction: params.direction === "RECEIVED" || params.direction === "ISSUED" ? params.direction : null,
      partnerId: params.partnerId ?? null,
    });

    // The optional bucket filter narrows the displayed rows (display-only —
    // never the ties); absent/empty ⇒ the full fixed shape.
    const selected =
      params.buckets !== undefined && params.buckets.length > 0
        ? new Set(
            params.buckets.filter((bucket): bucket is NoteAgingBucket =>
              AGING_BUCKETS.includes(bucket as NoteAgingBucket),
            ),
          )
        : null;

    const bucketTotals: Record<NoteAgingBucket, string> = {
      notDue: "0.0000",
      "1_30": "0.0000",
      "31_60": "0.0000",
      "61_90": "0.0000",
      "90_plus": "0.0000",
    };
    const currencyTotals = new Map<string, string>();
    const claimGroupTotals = new Map<string, string>();
    let baseTotal = "0.0000";
    const reportRows = [];
    for (const row of rows) {
      if (selected !== null && !selected.has(row.bucket)) continue;
      bucketTotals[row.bucket] = addExact(bucketTotals[row.bucket], row.baseAmount);
      baseTotal = addExact(baseTotal, row.baseAmount);
      currencyTotals.set(row.currency, addExact(currencyTotals.get(row.currency) ?? "0.0000", row.baseAmount));
      const claimGroupKey = row.claimRef ?? "(no-claim)";
      claimGroupTotals.set(
        claimGroupKey,
        addExact(claimGroupTotals.get(claimGroupKey) ?? "0.0000", row.baseAmount),
      );

      const values: Record<string, string | number | null> = {
        number: row.number,
        direction: row.direction,
        partner: params.locale === "ar" ? row.partnerNameAr ?? row.partnerName : row.partnerName,
        currency: row.currency,
        amount: row.amount,
        maturityDate: row.maturityDate,
        status: row.statusAsOf,
        claimRef: row.claimRef,
      };
      for (const bucket of AGING_BUCKETS) {
        values[BUCKET_FIELD[bucket]] = bucket === row.bucket ? row.baseAmount : "0.0000";
      }
      values.baseTotal = row.baseAmount;
      reportRows.push({
        key: row.noteId,
        // PHASE-031: with groupByClaim on, each row carries its claim group
        // key (the source invoice's claim_ref; "(no-claim)" for non-claim
        // notes — never dropped, so the group subtotal ties to the footer).
        ...(params.groupByClaim === true ? { groupKey: claimGroupKey } : {}),
        values,
      });
    }

    // PHASE-031 (§2 item 8): the claim groups — one per distinct claim ref
    // present in the DISPLAYED rows (sorted; the no-claim bucket last), each
    // with its base subtotal. Σ group subtotals == baseTotal exactly (the
    // partition property the claim-lifecycle spec asserts).
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
              subtotal: { baseTotal: claimGroupTotals.get(claimGroupKey)! },
            }))
        : [];

    const ties = await notes.maturityCalendarTies({ asOf: params.asOf! });

    const totals = [
      {
        id: "openNotes",
        kind: "sum" as const,
        label: bilingual("عدد الأوراق المفتوحة", "Open notes"),
        amount: String(reportRows.length),
      },
      ...AGING_BUCKETS.map((bucket) => ({
        id: BUCKET_FIELD[bucket],
        kind: "sum" as const,
        label: bilingual(
          `إجمالي ${bucket === "notDue" ? "غير المستحق" : bucket === "1_30" ? "1–30 يوم" : bucket === "31_60" ? "31–60 يوم" : bucket === "61_90" ? "61–90 يوم" : "أكثر من 90"} (أساس)`,
          `Total ${bucket === "notDue" ? "not due" : bucket === "1_30" ? "1–30 days" : bucket === "31_60" ? "31–60 days" : bucket === "61_90" ? "61–90 days" : "90+ days"} (base)`,
        ),
        amount: bucketTotals[bucket],
      })),
      {
        id: "baseTotal",
        kind: "sum" as const,
        label: bilingual("الإجمالي (العملة الأساسية)", "Total (base)"),
        amount: baseTotal,
      },
      // Per-currency totals (the base contribution of each currency's open
      // notes — Σ over currencies == the register side of the footer ties).
      ...[...currencyTotals.keys()].sort().map((currency) => ({
        id: `cur:${currency}`,
        kind: "sum" as const,
        label: bilingual(`إجمالي العملة ${currency} (أساس)`, `${currency} total (base)`),
        amount: currencyTotals.get(currency)!,
      })),
    ];

    return {
      columns: [
        col("number", "رقم الورقة", "Note no"),
        col("direction", "الاتجاه", "Direction", "status"),
        col("partner", "الشريك", "Partner"),
        col("currency", "العملة", "Currency"),
        moneyCol("amount", "المبلغ", "Amount"),
        col("maturityDate", "الاستحقاق", "Maturity", "date"),
        col("status", "الحالة حتى التاريخ", "Status (as-of)", "status"),
        // PHASE-031 (0042): the source invoice's claim ref — the group-by-claim
        // key (مطالبة تأمينية; null renders the no-claim group).
        col("claimRef", "المطالبة", "Claim"),
        moneyCol("notDue", "غير مستحق", "Not due"),
        moneyCol("b1_30", "1–30 يوم", "1–30 days"),
        moneyCol("b31_60", "31–60 يوم", "31–60 days"),
        moneyCol("b61_90", "61–90 يوم", "61–90 days"),
        moneyCol("b90Plus", "أكثر من 90", "90+ days"),
        moneyCol("baseTotal", "الإجمالي (أساس)", "Total (base)"),
      ],
      groups,
      rows: reportRows,
      totals,
      assertionResults: [
        sideTieResult("notes-open-tie", ties.received),
        sideTieResult("notes-payable-tie", ties.issued),
      ],
      notes: [ASOF_RULE_NOTE, TIE_SCOPE_NOTE],
    };
  },
});
