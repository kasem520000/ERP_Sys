/**
 * PHASE-021 T10 · reprint of already-POSTED sales invoices from the local
 * cache (OFFLINE_CAPABILITIES_MATRIX row 32; MASTER-PLAN §6 "Reprint:
 * cached POSTED sales invoices … Never re-numbers"): reads the
 * desktop-migration-v4 `sales_invoices` row through the sync-core
 * StorageAdapter and renders it with print/escpos — the CACHED doc_no is
 * used VERBATIM (a reprint is a copy of an official document, never a new
 * one; INV-021), with a bilingual REPRINT marker + print timestamp so the
 * paper copy is distinguishable from the original.
 *
 * Documented columns (desktop migrations v4 — another agent authors the
 * migration; this module programs against the frozen shape): id, doc_no,
 * status, payload (JSON: storeName?/lines?/subtotal?/vatRegNo?), issue_date,
 * total_gross, total_tax. The payload parse is DEFENSIVE: an unparseable or
 * shape-missing payload degrades to the column-level totals (doc no +
 * VAT + gross) with zero item rows rather than throwing — the doc number
 * still prints, still exactly once, still never re-numbered.
 *
 * Honest refusals: NOT_CACHED when the row (or the whole table — a store
 * without the v4 migration) is absent; NOT_POSTED when status !== POSTED
 * (only official, posted documents may be reprinted).
 */

import type { StorageAdapter } from "@erp/sync-core";

import { renderReceipt, type ReceiptTemplate, type ReceiptWidth } from "./escpos";

export type ReprintResult =
  | { readonly bytes: Uint8Array; readonly docNo: string; readonly printedAt: string }
  | { readonly error: "NOT_CACHED" | "NOT_POSTED" };

/** The cached payload JSON's expected (all-optional) shape — the sync
 * applier writes decimal-string money; unexpected shapes degrade. */
interface CachedInvoicePayload {
  storeName?: { ar?: unknown; en?: unknown };
  vatRegNo?: unknown;
  subtotal?: unknown;
  lines?: unknown;
}

interface CachedLine {
  nameAr?: unknown;
  name?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  lineTotal?: unknown;
}

function asDecimalString(value: unknown): string | undefined {
  // Money/qty are embedded VERBATIM, never computed with (ADR-0009); the
  // cache writes TEXT decimal strings — anything else is stringified for
  // display only.
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function parsePayload(raw: unknown): CachedInvoicePayload {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as CachedInvoicePayload;
    }
    return {};
  } catch {
    return {}; // defensive: a corrupt cached payload must not break reprint
  }
}

/**
 * Render a reprint from the cached POSTED sales invoice. REPRINT NEVER
 * RE-NUMBERS: the cached doc_no goes to the paper verbatim, exactly once,
 * and the only addition is the bilingual REPRINT marker line carrying the
 * print timestamp (kept as a separate line from the doc-number header).
 */
export function renderReprintFromCache(
  adapter: StorageAdapter,
  input: { readonly invoiceId: string; readonly width: ReceiptWidth },
): ReprintResult {
  let row: Record<string, unknown> | undefined;
  try {
    row = adapter.get("SELECT * FROM sales_invoices WHERE id = ?", [input.invoiceId]);
  } catch {
    // A store without the v4 table has nothing cached — honest NOT_CACHED.
    return { error: "NOT_CACHED" };
  }
  if (row === undefined) return { error: "NOT_CACHED" };
  if (String(row.status ?? "").toUpperCase() !== "POSTED") {
    return { error: "NOT_POSTED" };
  }

  const payload = parsePayload(row.payload);
  const docNo = row.doc_no === null || row.doc_no === undefined ? "" : String(row.doc_no);
  const printedAt = new Date().toISOString();

  const storeAr = typeof payload.storeName?.ar === "string" && payload.storeName.ar.length > 0 ? payload.storeName.ar : "المتجر";
  const storeEn = typeof payload.storeName?.en === "string" && payload.storeName.en.length > 0 ? payload.storeName.en : "Store";

  const lines = Array.isArray(payload.lines)
    ? (payload.lines as CachedLine[]).map((line) => ({
        name: {
          ...(typeof line.nameAr === "string" && line.nameAr.length > 0 ? { ar: line.nameAr } : {}),
          ...(typeof line.name === "string" && line.name.length > 0 ? { en: line.name } : {}),
        },
        qty: asDecimalString(line.qty) ?? "1",
        unitPrice: asDecimalString(line.unitPrice) ?? "0.00",
        lineTotal: asDecimalString(line.lineTotal) ?? "0.00",
      }))
    : [];

  const totals: { label: { ar: string; en: string }; amount: string }[] = [];
  const subtotal = asDecimalString(payload.subtotal);
  if (subtotal !== undefined) {
    totals.push({ label: { ar: "الإجمالي قبل الضريبة", en: "Net" }, amount: subtotal });
  }
  const vat = asDecimalString(row.total_tax);
  if (vat !== undefined) {
    totals.push({ label: { ar: "الضريبة", en: "VAT" }, amount: vat });
  }
  const gross = asDecimalString(row.total_gross);
  if (gross !== undefined) {
    totals.push({ label: { ar: "الإجمالي", en: "Total" }, amount: gross });
  }

  const template: ReceiptTemplate = {
    storeName: { ar: storeAr, en: storeEn },
    docNo,
    ...(row.issue_date === null || row.issue_date === undefined ? {} : { docDate: String(row.issue_date) }),
    ...(typeof payload.vatRegNo === "string" && payload.vatRegNo.length > 0 ? { vatRegNo: payload.vatRegNo } : {}),
    lines,
    totals,
    footer: { ar: "شكراً لزيارتكم", en: "Thank you" },
    headerExtra: [`*** إعادة طباعة / REPRINT · ${printedAt} ***`],
  };

  return { bytes: renderReceipt(template, { width: input.width }), docNo, printedAt };
}
