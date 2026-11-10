/**
 * PHASE-021 T10 · raw ESC-POS receipt rendering (MASTER-PLAN §1 item 9 / §7;
 * matrix row 32: reprint of already-POSTED documents from local cache):
 * pure byte builders (Uint8Array, zero dependencies) for 80 mm / 58 mm
 * thermal rolls, with BILINGUAL (AR/EN) templates in field parity with the
 * PHASE-013/016 print templates (store name ar+en, doc no + date, qty ×
 * name lines, subtotal/VAT/total, thank-you footer) — money is embedded as
 * DECIMAL STRINGS only, never parsed to floats (ADR-0009).
 *
 * Documented assumptions (honest notes):
 * - Column widths: 80 mm ≈ 48 columns, 58 mm ≈ 32 columns (12 dots/mm
 *   paper, font A 6 dots/char ≈ 0.71 mm — the common ESC-POS default).
 * - ARABIC WRAPPING, NOT SHAPING: we wrap on spaces and NEVER split an
 *   Arabic token mid-word; the raw UTF-8 bytes go to the printer AS-IS —
 *   the Windows print driver / printer firmware owns shaping + RTL layout
 *   (the shell's raw-ESC-POS path targets Arabic-capable POS printers).
 * - Each code point (Arabic or Latin) is counted as ONE column — without
 *   driver-side shaping feedback this is the deterministic choice; golden
 *   fixtures pin the exact bytes.
 * - A token containing ANY Arabic character is treated as an Arabic token:
 *   unbreakable even when wider than the roll (the driver renders the
 *   overflow); Latin tokens wider than the roll hard-break at the width.
 */

export const ESC = 0x1b;
export const GS = 0x1d;

/** Paper widths (mm) and their assumed column counts. */
export type ReceiptWidth = 80 | 58;

export const RECEIPT_COLUMNS: Readonly<Record<ReceiptWidth, number>> = { 80: 48, 58: 32 };

const ARABIC = /[\u0600-\u06ff\u0750-\u077f]/;

const encoder = new TextEncoder();

function bytes(...parts: number[]): Uint8Array {
  return Uint8Array.from(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

// -- primitive ESC-POS commands -----------------------------------------------

/** Initialize the printer (clears print buffer + modes). */
export function init(): Uint8Array {
  return bytes(ESC, 0x40);
}

/** Horizontal justification: 0 = left, 1 = center, 2 = right. */
export function justify(align: "left" | "center" | "right"): Uint8Array {
  const code = align === "left" ? 0 : align === "center" ? 1 : 2;
  return bytes(ESC, 0x61, code);
}

/** Feed + cut. `partial` uses the partial cut command (for printers that
 * require it when a paper edge is present); default is a full cut. */
export function cut(partial?: boolean): Uint8Array {
  return bytes(GS, 0x56, partial === true ? 1 : 0);
}

/** Print and feed n lines. */
export function feedLines(n: number): Uint8Array {
  const lines = Number.isSafeInteger(n) && n >= 0 && n <= 255 ? n : 1;
  return bytes(ESC, 0x64, lines);
}

export interface Code128Options {
  /** Bar height in dots (default 64). */
  readonly height?: number;
  /** Module width in dots (default 2). */
  readonly width?: number;
  /** Print the human-readable interpretation below the barcode (default
   * false — receipt doc numbers are already printed as text). */
  readonly hri?: boolean;
}

/** CODE128 barcode (GS k m=73, new syntax with explicit length). */
export function code128(barcodeData: string, options: Code128Options = {}): Uint8Array {
  const height = options.height ?? 64;
  const width = options.width ?? 2;
  const data = utf8(barcodeData);
  return concat([
    bytes(GS, 0x68, height), // GS h — barcode height
    bytes(GS, 0x77, width), // GS w — module width
    bytes(GS, 0x48, options.hri === true ? 2 : 0), // GS H — HRI position (0/none, 2/below)
    bytes(GS, 0x6b, 73, data.length), // GS k 73 — CODE128 + length
    data,
  ]);
}

// -- Arabic-aware line wrapping ------------------------------------------------

function isArabicToken(token: string): boolean {
  return ARABIC.test(token);
}

function hardBreakLatin(token: string, columns: number): string[] {
  const chunks: string[] = [];
  // Walk by code points (never split a surrogate pair).
  const characters = Array.from(token);
  for (let offset = 0; offset < characters.length; offset += columns) {
    chunks.push(characters.slice(offset, offset + columns).join(""));
  }
  return chunks;
}

/**
 * Wrap `content` to `columns`, Arabic-aware: wrap on whitespace; an Arabic
 * token is NEVER split mid-word (tokens wider than the roll go out whole —
 * the driver owns shaping/overflow); Latin tokens wider than the roll are
 * hard-broken at the column width. Existing newlines are honored.
 */
export function wrapText(content: string, columns: number): string[] {
  const lines: string[] = [];
  for (const paragraph of content.split("\n")) {
    const tokens = paragraph.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const token of tokens) {
      if (token.length > columns) {
        if (current !== "") {
          lines.push(current);
          current = "";
        }
        if (isArabicToken(token)) {
          lines.push(token); // never split an Arabic token
        } else {
          lines.push(...hardBreakLatin(token, columns));
        }
        continue;
      }
      if (current === "") {
        current = token;
      } else if (current.length + 1 + token.length <= columns) {
        current = `${current} ${token}`;
      } else {
        lines.push(current);
        current = token;
      }
    }
    if (current !== "") lines.push(current);
  }
  return lines;
}

/**
 * Render a text line (wrapped to the paper width, each wrapped row
 * terminated with LF 0x0a). `content` may itself contain newlines.
 */
export function textLine(content: string, options: { readonly width: ReceiptWidth }): Uint8Array {
  const columns = RECEIPT_COLUMNS[options.width];
  const wrapped = wrapText(content, columns);
  return utf8(`${wrapped.join("\n")}\n`);
}

// -- the bilingual receipt template (field parity with 013/016) ----------------

export interface BilingualText {
  readonly ar: string;
  readonly en: string;
}

export interface ReceiptLine {
  /** Item name — Arabic, English, or both (both print as two rows). */
  readonly name: { readonly ar?: string; readonly en?: string };
  /** Quantity / unit price / line total — decimal strings (ADR-0009). */
  readonly qty: string;
  readonly unitPrice: string;
  readonly lineTotal: string;
}

export interface ReceiptTemplate {
  readonly storeName: BilingualText;
  readonly docNo: string;
  readonly docDate?: string;
  readonly vatRegNo?: string;
  readonly lines: readonly ReceiptLine[];
  /** Totals in print order — subtotal / VAT / total (decimal strings). */
  readonly totals: readonly { readonly label: BilingualText; readonly amount: string }[];
  readonly footer?: BilingualText;
  /** Optional extra centered lines (e.g. the REPRINT marker) after the doc
   * header — used by print/reprint for the bilingual marker + timestamp. */
  readonly headerExtra?: readonly string[];
}

/**
 * Render the bilingual receipt to ESC-POS bytes. Deterministic: same
 * template + width ⇒ identical bytes (golden-fixture tested). Layout:
 * centered store name (ar, en), optional VAT reg no, doc no + date,
 * headerExtra lines; left-justified item rows (name rows then
 * `qty × unitPrice = lineTotal`); right-justified totals; centered footer;
 * feed 3 + full cut.
 */
export function renderReceipt(template: ReceiptTemplate, options: { readonly width: ReceiptWidth }): Uint8Array {
  const parts: Uint8Array[] = [init(), justify("center")];
  parts.push(textLine(template.storeName.ar, options));
  parts.push(textLine(template.storeName.en, options));
  if (template.vatRegNo !== undefined && template.vatRegNo !== "") {
    parts.push(textLine(`الرقم الضريبي / VAT: ${template.vatRegNo}`, options));
  }
  parts.push(textLine(`رقم الفاتورة / Invoice No: ${template.docNo}`, options));
  if (template.docDate !== undefined && template.docDate !== "") {
    parts.push(textLine(`التاريخ / Date: ${template.docDate}`, options));
  }
  for (const extra of template.headerExtra ?? []) {
    parts.push(textLine(extra, options));
  }
  parts.push(textLine("", options));
  parts.push(justify("left"));
  for (const line of template.lines) {
    const nameRows = [line.name.ar, line.name.en].filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    );
    for (const nameRow of nameRows.length > 0 ? nameRows : ["-"]) {
      parts.push(textLine(nameRow, options));
    }
    parts.push(textLine(`${line.qty} × ${line.unitPrice} = ${line.lineTotal}`, options));
  }
  parts.push(textLine("", options));
  parts.push(justify("right"));
  for (const total of template.totals) {
    parts.push(textLine(`${total.label.ar} / ${total.label.en}: ${total.amount}`, options));
  }
  parts.push(textLine("", options));
  if (template.footer !== undefined) {
    parts.push(justify("center"));
    parts.push(textLine(template.footer.ar, options));
    parts.push(textLine(template.footer.en, options));
  }
  parts.push(feedLines(3));
  parts.push(cut(false));
  return concat(parts);
}
