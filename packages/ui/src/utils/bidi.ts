/**
 * Bidi isolation helpers (RTL_DESIGN_RULES §5, RTL_AND_LTR §3).
 *
 * Mixed-script content (Latin codes/emails/IBANs/numbers inside Arabic) is
 * isolated with Unicode isolates — LRI/PDI, or FSI/PDI when direction should
 * auto-detect. Legacy embeddings (LRE/RLE) are forbidden. Values are stored
 * UNMARKED; isolation is applied at render time only.
 */
export const LRI = "\u2068"; // LEFT-TO-RIGHT ISOLATE
export const RLI = "\u2067"; // RIGHT-TO-LEFT ISOLATE
export const FSI = "\u206B"; // FIRST STRONG ISOLATE
export const PDI = "\u2069"; // POP DIRECTIONAL ISOLATE

/** Wraps a Latin run (code, email, IBAN, document number) in LRI…PDI. */
export function isolateLTR(value: string): string {
  return `${LRI}${value}${PDI}`;
}

/** Wraps an embedded run with auto-detected direction (FSI…PDI). */
export function isolateAuto(value: string): string {
  return `${FSI}${value}${PDI}`;
}

/**
 * Builds a display-only mixed-script string in LOGICAL order from segments —
 * never "typed visually" (§5). Segments render in logical (reading) order;
 * each embedded run is isolated so the bidi algorithm cannot reorder it.
 *
 *   bidi([
 *     { text: "فاتورة " },
 *     { text: "INV-000123", isolate: "ltr" },
 *     { text: " من 2026-01-02 لـ " },
 *     { text: "john@example.com", isolate: "ltr" },
 *   ])
 */
export type BidiSegment = { text: string; isolate?: "ltr" | "auto" };

export function bidi(segments: BidiSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.isolate === "ltr") return isolateLTR(segment.text);
      if (segment.isolate === "auto") return isolateAuto(segment.text);
      return segment.text;
    })
    .join("");
}

/** CSS isolation for element-level runs (Input/Badge bidiIsolate prop). */
export const bidiIsolateStyle = { unicodeBidi: "isolate", direction: "ltr" } as const;
