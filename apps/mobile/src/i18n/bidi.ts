/**
 * PHASE-022 · the bidi isolation helpers (MASTER-PLAN §5 + DR-P22-03):
 * embedded LTR runs inside Arabic text — doc numbers, IBANs, serials, phone
 * numbers — MUST be isolated so the Unicode bidi algorithm cannot reorder
 * the sentence (RTL_DESIGN_RULES §5). Code points (the “bidi() helper” of
 * the master plan, split into named helpers):
 *
 *   U+2068 FSI … U+2069 PDI  — first-strong isolate (direction from the
 *                               first strong character of the run);
 *   U+2066 LRI … U+2069 PDI  — forced-LTR isolate (identifier order is LTR
 *                               by definition, RTL §3.2 “never mirrors”).
 *
 * Punctuation between Arabic and an isolated run stays OUTSIDE the isolate
 * so it renders on the correct side (the classic «فاتورة رقم INV-0001:»
 * corruption case, RTL §5). Pure TS — no react-native imports.
 */

const FSI = "\u2068";
const LRI = "\u2066";
const PDI = "\u2069";

/**
 * First-strong isolation: the run's direction is decided by its first strong
 * character (an Arabic-led run renders RTL inside an LTR paragraph and vice
 * versa) — use for genuinely mixed display fragments.
 */
export function bidiIsolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}

/**
 * Forced-LTR isolation: the run renders LTR regardless of the surrounding
 * paragraph — the shape for IDENTIFIERS (doc numbers, IBANs, serials, phone
 * numbers), whose order is physical and never mirrors (RTL §3.2).
 */
export function bidiIsolateStrong(ltr: string): string {
  return `${LRI}${ltr}${PDI}`;
}

/** Doc numbers (`INV-2026-0001`) — always an LTR run inside Arabic labels. */
export function bidiDocNumber(docNo: string): string {
  return bidiIsolateStrong(docNo);
}

/** IBANs (`SA4420000001234567890000`) — group order is physical. */
export function bidiIban(iban: string): string {
  return bidiIsolateStrong(iban);
}

/** Serial / IMEI codes — physical order. */
export function bidiSerial(serial: string): string {
  return bidiIsolateStrong(serial);
}

/** Phone numbers (`+96650…`) — identifier order is LTR, never mirrored. */
export function bidiPhone(phone: string): string {
  return bidiIsolateStrong(phone);
}

/**
 * Strip every bidi CONTROL character from mixed content before it is
 * embedded or re-isolated: RLM/LRM/ALM (U+200E/U+200F/U+061C), the
 * embedding/override controls (U+202A–U+202E — including the dangerous
 * LRO/RLO), and the isolate controls (U+2066–U+2069). User-typed or
 * server-provided strings never get to smuggle a direction override into a
 * render; the caller then wraps deliberately with the bidiIsolate / compose
 * helpers. Returns the trimmed visible text.
 */
export function sanitizeBidi(text: string): string {
  return text.replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").trim();
}
