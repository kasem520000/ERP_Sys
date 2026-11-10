import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { memoryAdapter } from "@erp/sync-core";

import {
  code128,
  cut,
  feedLines,
  init,
  justify,
  renderReceipt,
  textLine,
  wrapText,
  type ReceiptTemplate,
} from "../src/print/escpos";
import { renderReprintFromCache } from "../src/print/reprint";

/**
 * PHASE-021 T10 · ESC-POS receipt rendering (80/58 mm bilingual templates —
 * field parity with the PHASE-013/016 print templates) + reprint-from-cache
 * (row 32: never re-numbers, honest NOT_POSTED/NOT_CACHED refusals).
 *
 * Golden fixtures: `fixtures/receipt-80.b64` / `fixtures/receipt-58.b64`
 * hold the checked-in base64 of the canonical bilingual template rendered at
 * each width — deterministic byte-for-byte output (same template + width ⇒
 * identical bytes). Regenerate deliberately with
 * `UPDATE_FIXTURES=1 pnpm --filter @erp/desktop test` after ANY intentional
 * template/layout change (the diff is the review artifact).
 */

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

const GOLDEN_TEMPLATE: ReceiptTemplate = {
  storeName: { ar: "مؤسسة النور للتجارة", en: "Al-Noor Trading Est." },
  docNo: "INV-2026-000123",
  docDate: "2026-11-05",
  vatRegNo: "310123456700003",
  lines: [
    { name: { ar: "أرز بسمتي ٥ كجم", en: "Basmati Rice 5kg" }, qty: "2", unitPrice: "75.00", lineTotal: "150.00" },
    { name: { ar: "زيت زيتون بكر ١ لتر" }, qty: "1", unitPrice: "7.50", lineTotal: "7.50" },
    { name: { en: "Bottle Water 500ml" }, qty: "12", unitPrice: "1.25", lineTotal: "15.00" },
  ],
  totals: [
    { label: { ar: "الإجمالي قبل الضريبة", en: "Net" }, amount: "157.50" },
    { label: { ar: "الضريبة", en: "VAT" }, amount: "7.88" },
    { label: { ar: "الإجمالي", en: "Total" }, amount: "165.38" },
  ],
  footer: { ar: "شكراً لزيارتكم", en: "Thank you" },
};

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function golden(name: string, bytes: Uint8Array): string {
  const path = `${FIXTURES_DIR}${name}`;
  if (process.env.UPDATE_FIXTURES === "1" || !existsSync(path)) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    writeFileSync(path, `${base64(bytes)}\n`);
    return base64(bytes);
  }
  return readFileSync(path, "utf8").trim();
}

describe("ESC-POS primitives (pure byte builders)", () => {
  it("init / justify / cut / feedLines emit the documented command bytes", () => {
    expect(Array.from(init())).toEqual([0x1b, 0x40]);
    expect(Array.from(justify("left"))).toEqual([0x1b, 0x61, 0x00]);
    expect(Array.from(justify("center"))).toEqual([0x1b, 0x61, 0x01]);
    expect(Array.from(justify("right"))).toEqual([0x1b, 0x61, 0x02]);
    expect(Array.from(cut(false))).toEqual([0x1d, 0x56, 0x00]);
    expect(Array.from(cut(true))).toEqual([0x1d, 0x56, 0x01]);
    expect(Array.from(feedLines(3))).toEqual([0x1b, 0x64, 0x03]);
    expect(Array.from(feedLines(-1))).toEqual([0x1b, 0x64, 0x01]); // defensive clamp
  });

  it("code128 emits GS h/w/H then GS k 73 + length + data", () => {
    const bytes = Array.from(code128("INV-123", { height: 80, width: 3, hri: true }));
    expect(bytes.slice(0, 3)).toEqual([0x1d, 0x68, 80]);
    expect(bytes.slice(3, 6)).toEqual([0x1d, 0x77, 3]);
    expect(bytes.slice(6, 9)).toEqual([0x1d, 0x48, 2]);
    expect(bytes.slice(9, 13)).toEqual([0x1d, 0x6b, 73, 7]);
    expect(decode(Uint8Array.from(bytes.slice(13)))).toBe("INV-123");
    expect(Array.from(code128("X"))[8]).toBe(0); // HRI hidden by default
  });

  it("textLine UTF-8 encodes + terminates with LF", () => {
    expect(Array.from(textLine("hello", { width: 80 }))).toEqual([...Array.from(Buffer.from("hello", "utf8")), 0x0a]);
  });
});

describe("Arabic-aware line wrapping (wrap on spaces — never split an Arabic token)", () => {
  it("wraps Arabic text at the column width without breaking any token", () => {
    const text = "مؤسسة النور للتجارة الأعمال التجارية والتجزئة في مدينة الرياض فرع رئيسي";
    const lines = wrapText(text, 32);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(32);
    // No Arabic word is ever split: every input token appears intact within
    // exactly one output line.
    for (const token of text.split(" ")) {
      expect(lines.some((line) => line.split(" ").includes(token))).toBe(true);
    }
  });

  it("an Arabic token wider than the roll is emitted WHOLE (driver owns shaping/overflow)", () => {
    const longToken = "هذهكلمةعربيةطويلةجدالاجزاءهامنهاولاتقسمابدا";
    expect(wrapText(longToken, 10)).toEqual([longToken]);
  });

  it("a token containing ANY Arabic character is unbreakable (mixed token)", () => {
    const mixed = "product-عربي-12345678901234567890";
    expect(wrapText(mixed, 8)).toEqual([mixed]);
  });

  it("Latin tokens wider than the roll hard-break at the width", () => {
    expect(wrapText("abcdefghijklmnopqrstuvwxyz", 10)).toEqual(["abcdefghij", "klmnopqrst", "uvwxyz"]);
  });

  it("honors explicit newlines and drops redundant whitespace", () => {
    expect(wrapText("one two\nthree", 80)).toEqual(["one two", "three"]);
    expect(wrapText("   ", 80)).toEqual([""]);
  });
});

describe("renderReceipt (bilingual golden fixtures — deterministic bytes)", () => {
  it("80 mm rendering matches the checked-in golden fixture byte-for-byte", () => {
    const bytes = renderReceipt(GOLDEN_TEMPLATE, { width: 80 });
    expect(base64(bytes)).toBe(golden("receipt-80.b64", bytes));
  });

  it("58 mm rendering matches the checked-in golden fixture byte-for-byte", () => {
    const bytes = renderReceipt(GOLDEN_TEMPLATE, { width: 58 });
    expect(base64(bytes)).toBe(golden("receipt-58.b64", bytes));
  });

  it("deterministic: re-rendering the same template produces identical bytes", () => {
    for (const width of [80, 58] as const) {
      expect(base64(renderReceipt(GOLDEN_TEMPLATE, { width }))).toBe(
        base64(renderReceipt(GOLDEN_TEMPLATE, { width })),
      );
    }
  });

  it("the two widths render DIFFERENT bytes and wrap within their column budgets", () => {
    const wide = decode(renderReceipt(GOLDEN_TEMPLATE, { width: 80 }));
    const narrow = decode(renderReceipt(GOLDEN_TEMPLATE, { width: 58 }));
    expect(wide).not.toBe(narrow);
    for (const line of narrow.split("\n")) {
      if (line.length > 0) expect(line.length).toBeLessThanOrEqual(32);
    }
    for (const line of wide.split("\n")) {
      if (line.length > 0) expect(line.length).toBeLessThanOrEqual(48);
    }
  });

  it("embeds the bilingual header fields, item rows, and money as decimal strings", () => {
    const text = decode(renderReceipt(GOLDEN_TEMPLATE, { width: 80 }));
    expect(text).toContain("مؤسسة النور للتجارة");
    expect(text).toContain("Al-Noor Trading Est.");
    expect(text).toContain("رقم الفاتورة / Invoice No: INV-2026-000123");
    expect(text).toContain("التاريخ / Date: 2026-11-05");
    expect(text).toContain("الرقم الضريبي / VAT: 310123456700003");
    expect(text).toContain("أرز بسمتي ٥ كجم");
    expect(text).toContain("2 × 75.00 = 150.00");
    expect(text).toContain("الإجمالي قبل الضريبة / Net: 157.50");
    expect(text).toContain("الضريبة / VAT: 7.88");
    expect(text).toContain("الإجمالي / Total: 165.38");
    expect(text).toContain("شكراً لزيارتكم");
    expect(text).toContain("Thank you");
  });

  it("ends with feed 3 + full cut", () => {
    const bytes = renderReceipt(GOLDEN_TEMPLATE, { width: 80 });
    expect(Array.from(bytes.slice(-6))).toEqual([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x00]);
  });
});

describe("renderReprintFromCache (row 32 — reprint NEVER re-numbers)", () => {
  const PAYLOAD = JSON.stringify({
    storeName: { ar: "مؤسسة النور للتجارة", en: "Al-Noor Trading Est." },
    vatRegNo: "310123456700003",
    subtotal: "157.50",
    lines: [
      { nameAr: "أرز بسمتي ٥ كجم", name: "Basmati Rice 5kg", qty: "2", unitPrice: "75.00", lineTotal: "150.00" },
    ],
  });

  function seededAdapter(status: string, payload: string = PAYLOAD) {
    const adapter = memoryAdapter();
    adapter.run(
      "INSERT INTO sales_invoices (id, doc_no, status, payload, issue_date, total_gross, total_tax) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["inv-1", "INV-2026-000123", status, payload, "2026-11-05", "165.3800", "7.8800"],
    );
    return adapter;
  }

  it("reprints a POSTED invoice with the CACHED doc_no VERBATIM, exactly once", () => {
    const result = renderReprintFromCache(seededAdapter("POSTED"), { invoiceId: "inv-1", width: 80 });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.docNo).toBe("INV-2026-000123");
    const text = decode(result.bytes);
    // The original number appears EXACTLY ONCE (in the doc-no header line)…
    expect(text.split("INV-2026-000123")).toHaveLength(2);
    expect(text).toContain("رقم الفاتورة / Invoice No: INV-2026-000123");
    // …and the REPRINT marker is a SEPARATE line carrying the timestamp.
    expect(text).toContain("REPRINT");
    expect(text).toContain("إعادة طباعة");
    expect(text).toContain(result.printedAt);
    expect(result.printedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("renders the cached lines and column-level totals (decimal strings, verbatim)", () => {
    const result = renderReprintFromCache(seededAdapter("POSTED"), { invoiceId: "inv-1", width: 80 });
    if ("error" in result) throw new Error("expected a reprint");
    const text = decode(result.bytes);
    expect(text).toContain("أرز بسمتي ٥ كجم");
    expect(text).toContain("2 × 75.00 = 150.00");
    expect(text).toContain("الإجمالي قبل الضريبة / Net: 157.50");
    expect(text).toContain("الضريبة / VAT: 7.8800");
    expect(text).toContain("الإجمالي / Total: 165.3800");
  });

  it("refuses a non-POSTED invoice honestly (NOT_POSTED)", () => {
    const result = renderReprintFromCache(seededAdapter("DRAFT"), { invoiceId: "inv-1", width: 80 });
    expect(result).toEqual({ error: "NOT_POSTED" });
  });

  it("refuses an unknown invoice honestly (NOT_CACHED)", () => {
    const result = renderReprintFromCache(seededAdapter("POSTED"), { invoiceId: "missing", width: 80 });
    expect(result).toEqual({ error: "NOT_CACHED" });
  });

  it("refuses when the sales_invoices table does not exist at all (NOT_CACHED)", () => {
    const throwingAdapter = {
      ...memoryAdapter(),
      get: () => {
        throw new Error("no such table: sales_invoices");
      },
    };
    const result = renderReprintFromCache(throwingAdapter, { invoiceId: "inv-1", width: 80 });
    expect(result).toEqual({ error: "NOT_CACHED" });
  });

  it("degrades defensively on a corrupt cached payload: doc no + column totals still print, never re-numbered", () => {
    const result = renderReprintFromCache(seededAdapter("POSTED", "not-json{{corrupt"), { invoiceId: "inv-1", width: 58 });
    if ("error" in result) throw new Error("expected a degraded reprint");
    const text = decode(result.bytes);
    expect(text.split("INV-2026-000123")).toHaveLength(2);
    expect(text).toContain("الضريبة / VAT: 7.8800");
    expect(text).toContain("الإجمالي / Total: 165.3800");
    expect(text).not.toContain("75.00"); // no item rows without a parseable payload
    expect(text).toContain("REPRINT");
  });
});
