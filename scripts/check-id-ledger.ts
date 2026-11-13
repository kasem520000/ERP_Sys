/**
 * The ID-ledger collision check (docs/planning/ID_LEDGER.md §5): parses the
 * three canon documents for the IMPLEMENTED inventory (G/INV/BR), the
 * ledger's reservation + cross-reference tables, and every phase document —
 * expanding shorthand ranges (G-47…G-50 and BR-068…070 alike, the …, ..,
 * – and — separators all normalized), distinguishing CLAIMS of new ids from
 * legitimate REFERENCES to existing ones (including claims that WRAP across
 * physical lines — scanned as logical blocks, never a per-line miss), and
 * failing on: stale claims (implemented ids claimed as new by a future
 * phase), reservation overlaps, claims outside their phase's reservation,
 * unresolving cross-references, and INVALID ranges (inverted like
 * BR-078…063, family-mismatched like G-47…INV-50, or absurdly wide) —
 * each diagnosed BY NAME at its file:line instead of silently dropped.
 *
 * Usage:  pnpm check:id-ledger                  (the repo check)
 *         pnpm check:id-ledger -- --self-test   (also prove the classifier:
 *         the conflicting claim, the legitimate reference, the wrapped
 *         multi-line claim, the range extraction from real text with every
 *         supported separator, the inverted/mixed/wide range diagnoses,
 *         the reservation-overlap detection (a Finding, never the TDZ
 *         crash), and the cross-ref owner mismatch)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const DOCS = join(ROOT, "docs");

type Family = "G" | "INV" | "BR";
type IdSet = Map<string, string>; // id -> owner ("PHASE-0xx" for canon rows)

interface Finding {
  severity: "error" | "warning";
  kind: string;
  detail: string;
}

// -- id/range parsing ---------------------------------------------------------

const ID_RE = /^(G|INV|BR)-(\d+)$/;

function makeId(family: Family, n: number): string {
  return `${family}-${String(n).padStart(family === "G" ? 2 : 3, "0")}`;
}

/** Normalize the RANGE SEPARATORS a doc may use to the canonical ellipsis:
 * the Unicode ellipsis …, an ASCII "..." or "..", and the en/em dashes – —.
 * (A plain hyphen is deliberately NOT a range separator — it is the id
 * syntax's own character; "G-47-50" stays two tokens by design.) */
export function normalizeRangeSeparators(text: string): string {
  return text.replace(/\.{3,}/g, "…").replace(/\.\./g, "…").replace(/[–—]/g, "…");
}

/** Expand ONE token: a single id (G-47), a full-tail range (G-47…G-50), or a
 * short-tail range (BR-068…070). Ellipsis may be …, .., –, or — (normalized
 * by the caller or by hand). INVALID shapes return a diagnosis instead of a
 * silent null: inverted (hi < lo), family-mismatched (G-47…INV-50), or wider
 * than the 200-id sanity bound. */
export function expandTokenDetailed(
  token: string,
): { ids: string[] } | { invalid: string; kind: "inverted-range" | "range-family-mismatch" | "range-too-wide" } {
  const normalized = normalizeRangeSeparators(token.trim());
  const range = normalized.match(/^(G|INV|BR)-(\d+)…(?:(G|INV|BR)-)?(\d+)$/);
  if (range !== null) {
    const family = range[1] as Family;
    const hiFamily = (range[3] ?? family) as Family;
    const lo = Number(range[2]);
    const hi = Number(range[4]);
    if (hiFamily !== family) {
      return { invalid: normalized, kind: "range-family-mismatch" };
    }
    if (hi < lo) {
      return { invalid: normalized, kind: "inverted-range" };
    }
    if (hi === lo) {
      return { ids: [makeId(family, lo)] };
    }
    if (hi - lo > 200) {
      return { invalid: normalized, kind: "range-too-wide" };
    }
    const out: string[] = [];
    for (let n = lo; n <= hi; n += 1) out.push(makeId(family, n));
    return { ids: out };
  }
  return ID_RE.test(normalized) ? { ids: [normalized] } : { ids: [] };
}

/** @deprecated kept for the legacy self-test surface — returns null on
 * invalid ranges; prefer expandTokenDetailed / idsInDetailed. */
export function expandToken(token: string): string[] | null {
  const result = expandTokenDetailed(token);
  return "ids" in result ? result.ids : null;
}

/** All id tokens in a text chunk (standalone ids and ranges, expanded,
 * separators normalized). INVALID ranges are skipped silently here — use
 * idsInDetailed to have them DIAGNOSED instead of dropped. */
export function idsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of normalizeRangeSeparators(text).matchAll(
    /\b(?:G|INV|BR)-\d+(?:…(?:(?:G|INV|BR)-)?\d+)?/gu,
  )) {
    const result = expandTokenDetailed(match[0]);
    if ("ids" in result) out.push(...result.ids);
  }
  return out;
}

/** idsIn + the honest diagnosis: every INVALID range token in the text
 * becomes an ERROR finding naming `where` (file:line / table cell) — never
 * a silent drop. Returns the valid ids. */
export function idsInDetailed(text: string, where: string, out: Finding[]): string[] {
  const ids: string[] = [];
  for (const match of normalizeRangeSeparators(text).matchAll(
    /\b(?:G|INV|BR)-\d+(?:…(?:(?:G|INV|BR)-)?\d+)?/gu,
  )) {
    const result = expandTokenDetailed(match[0]);
    if ("ids" in result) {
      ids.push(...result.ids);
    } else {
      out.push({
        severity: "error",
        kind: result.kind,
        detail: `${where}: the range ${match[0]} (read as ${result.invalid}) is ${
          result.kind === "inverted-range"
            ? "inverted — the upper bound is lower than the lower bound (a renumbering regression?)"
            : result.kind === "range-family-mismatch"
              ? "family-mismatched — the two bounds belong to different id families"
              : "wider than the 200-id sanity bound"
        }`,
      });
    }
  }
  return ids;
}

// -- the implemented inventory (the canon docs) --------------------------------

function parseCanon(file: string, rowRe: RegExp): IdSet {
  const set: IdSet = new Map();
  const text = readFileSync(join(DOCS, file), "utf8");
  for (const match of text.matchAll(rowRe)) {
    set.set(match[1]!, match[2] ?? "implemented");
  }
  return set;
}

const implemented: Record<Family, IdSet> = {
  // The golden canon is split: G-01…G-20 are DEFINED in ACCOUNTING_TESTS §3
  // (the golden battery table); G-21…G-46 live in JOURNAL_RULES §7 (the
  // financial-depth rows, each ending with its PHASE-0xx cell). The union is
  // the implemented inventory.
  G: (() => {
    const set = parseCanon("testing/ACCOUNTING_TESTS.md", /^\| (G-\d{2}) \|/gmu);
    for (const [id, owner] of parseCanon(
      "accounting/JOURNAL_RULES.md",
      /^\| (G-\d{2}) \|.*\|\s*(PHASE-\d{3})\s*\|$/gmu,
    )) {
      set.set(id, owner);
    }
    return set;
  })(),
  INV: parseCanon("accounting/ACCOUNTING_INVARIANTS.md", /^\| (INV-\d{3}) \|/gmu),
  BR: parseCanon("product/BUSINESS_RULES.md", /^\| (BR-\d{3}) \|/gmu),
};

// -- the ledger's reservation + cross-reference tables --------------------------

interface Reservation {
  phase: string;
  goldens: string[];
  invariants: string[];
  rules: string[];
}

interface CrossRef {
  inPhase: string;
  refs: string[];
  ownedBy: string;
}

function parseLedger(): { reservations: Reservation[]; crossRefs: CrossRef[]; findings: Finding[] } {
  const findings: Finding[] = [];
  const ledger = readFileSync(join(DOCS, "planning", "ID_LEDGER.md"), "utf8");
  const reservations: Reservation[] = [];
  for (const match of ledger.matchAll(
    /^\| (PHASE-\d{3})[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm,
  )) {
    const phase = match[1]!;
    if (/…/.test(match[0].split("|")[1] ?? "")) continue; // the "PHASE-065…068 none" row
    const cells = [match[2]!, match[3]!, match[4]!];
    const values = cells.map((cell, i) =>
      idsInDetailed(cell.replace(/—/g, " "), `ID_LEDGER.md §2 ${phase} ${["goldens", "invariants", "rules"][i]}`, findings),
    );
    reservations.push({
      phase,
      goldens: values[0]!.filter((id) => id.startsWith("G-")),
      invariants: values[1]!.filter((id) => id.startsWith("INV-")),
      rules: values[2]!.filter((id) => id.startsWith("BR-")),
    });
  }
  const crossRefs: CrossRef[] = [];
  for (const match of ledger.matchAll(/^\| (PHASE-\d{3}) \|([^|]*)\| (PHASE-\d{3}) \|/gm)) {
    crossRefs.push({
      inPhase: match[1]!,
      refs: idsInDetailed(match[2]!, `ID_LEDGER.md §3 ${match[1]!} cross-ref`, findings),
      ownedBy: match[3]!,
    });
  }
  return { reservations, crossRefs, findings };
}

/**
 * The reservation-overlap check (§2: NO id may be reserved by two phases).
 * Extracted so the self-test can prove the DIAGNOSIS — pre-fix this loop
 * called pushError before `const findings` was initialized (a TDZ
 * ReferenceError crash: a real overlap killed the checker instead of being
 * reported).
 */
export function detectReservationOverlaps(reservations: Reservation[]): {
  reservedBy: Map<string, string>;
  findings: Finding[];
} {
  const reservedBy = new Map<string, string>();
  const findings: Finding[] = [];
  for (const r of reservations) {
    for (const id of [...r.goldens, ...r.invariants, ...r.rules]) {
      const existing = reservedBy.get(id);
      if (existing !== undefined) {
        findings.push({
          severity: "error",
          kind: "reservation-overlap",
          detail: `${id} reserved by both ${existing} and ${r.phase}`,
        });
        continue;
      }
      reservedBy.set(id, r.phase);
    }
  }
  return { reservedBy, findings };
}

/** Reservations must never collide with the implemented inventory. */
function detectReservedButImplemented(
  reservedBy: Map<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const [id, phase] of reservedBy) {
    const family = id.split("-")[0] as Family;
    if (implemented[family].has(id)) {
      findings.push({
        severity: "error",
        kind: "reserved-but-implemented",
        detail: `${id} is reserved for ${phase} but already implemented (${implemented[family].get(id)})`,
      });
    }
  }
  return findings;
}

/** The §3 cross-reference table must resolve — and each reference must name
 * the id's actual OWNER (a reference to an existing id "for a different
 * owner" is the owner-mismatch finding, never a pass). */
export function checkCrossRefs(
  crossRefs: CrossRef[],
  reservedBy: Map<string, string>,
): Finding[] {
  const findings: Finding[] = [];
  for (const ref of crossRefs) {
    for (const id of ref.refs) {
      const family = id.split("-")[0] as Family;
      if (implemented[family].has(id)) continue;
      const owner = reservedBy.get(id);
      if (owner === undefined) {
        findings.push({
          severity: "error",
          kind: "cross-ref-dangling",
          detail: `${ref.inPhase}'s cross-reference ${id} is neither implemented nor reserved`,
        });
      } else if (owner !== ref.ownedBy) {
        findings.push({
          severity: "error",
          kind: "cross-ref-owner-mismatch",
          detail: `${ref.inPhase}'s cross-reference ${id} is owned by ${owner}, not ${ref.ownedBy}`,
        });
      }
    }
  }
  return findings;
}

// -- the claim/reference classifier ---------------------------------------------

const CLAIM_MARKERS =
  /(added to|new golden|joins? `?JOURNAL_RULES|invariant .*added|Golden suites?)/i;
/** `gains` claims by PROXIMITY only: "the register gains BR-xx" claims the id,
 * but "journal_lines gains dedicated columns … (A-11 — BR-051 advisory… )" is a
 * UI/schema gain with an unrelated id REFERENCE later in the same logical
 * block (the PHASE-053 case — the naive join misclassified it). The id must
 * sit within 80 chars of the gain (same clause-ish). */
const CLAIM_GAINS_RE = /\bgains\b[^.;]{0,80}\b(?:G|INV|BR)-\d/i;
const REFERENCE_ONLY_MARKERS =
  /(reuses?|reuse|mirror(?:s|ed)?|the existing|already|precedent|predat(?:e|es|ed)|stays?|keep[s]? |consumed|was \(|the stale plan|original plan's)/i;

/** Is this text a CLAIM that the phase adds these ids (vs a reference to ids
 * that exist elsewhere)? Operates on a LOGICAL UNIT (a table row, or a
 * joined wrapped paragraph / list item) — a claim whose marker and ids sit
 * on different physical lines is still detected. Exported for the
 * self-test. */
export function isClaimLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith(">")) return false;
  if (!/\b(?:G|INV|BR)-\d+/.test(trimmed)) return false;
  if (REFERENCE_ONLY_MARKERS.test(trimmed)) return false;
  return CLAIM_MARKERS.test(trimmed) || CLAIM_GAINS_RE.test(trimmed);
}

/** Classify one logical unit of a phase document against the ledger.
 * Appends findings (invalid ranges diagnosed at `where`). Exported for the
 * self-test. */
export function classifyText(
  text: string,
  phase: string,
  out: Finding[],
  where: string,
  reservedBy: Map<string, string>,
  reservationPhases: Set<string>,
): { claims: number; references: number } {
  const isFuture = reservationPhases.has(phase);
  let claims = 0;
  let references = 0;
  const claim = isClaimLine(text);
  for (const id of idsInDetailed(text, where, out)) {
    const family = id.split("-")[0] as Family;
    const implementedOwner = implemented[family].get(id);
    if (claim) {
      claims += 1;
      if (implementedOwner !== undefined) {
        if (isFuture) {
          out.push({
            severity: "error",
            kind: "stale-claim",
            detail: `${phase} (${where}) claims ${id} as new, but it is already implemented (${implementedOwner}) — a different meaning under an existing id`,
          });
        }
        continue;
      }
      if (!isFuture) continue; // a completed phase's historical plan text
      const owner = reservedBy.get(id);
      if (owner === undefined) {
        out.push({
          severity: "error",
          kind: "claim-unreserved",
          detail: `${phase} (${where}) claims ${id} but it is in no reservation (reserve it in ID_LEDGER §2 first)`,
        });
      } else if (owner !== phase) {
        out.push({
          severity: "error",
          kind: "claim-conflict",
          detail: `${phase} (${where}) claims ${id}, but it is reserved for ${owner} (the conflicting-claim case)`,
        });
      }
    } else {
      references += 1;
      if (implementedOwner !== undefined) continue;
      if (reservedBy.has(id)) continue;
      out.push({
        severity: "warning",
        kind: "dangling-reference",
        detail: `${phase} (${where}) mentions ${id} which is neither implemented nor reserved`,
      });
    }
  }
  return { claims, references };
}

/** The one-line wrapper (the legacy self-test surface). */
export function classifyLine(line: string, phase: string, out: Finding[]): { claims: number; references: number } {
  return classifyText(line, phase, out, `${phase}.md`, RESERVED_BY, RESERVATION_PHASES);
}

// -- the logical-block scanner (multi-line claims) --------------------------------

export interface TextBlock {
  text: string;
  /** 1-based line of the unit's FIRST physical line (the finding anchor). */
  line: number;
  kind: "prose" | "table" | "heading" | "quote" | "code";
}

/**
 * Group a document into LOGICAL UNITS so a claim WRAPPED across physical
 * lines is still one classification unit (the audit fix: per-line scanning
 * missed claims whose marker and ids sat on different lines, and could not
 * be distinguished from legitimate references).
 *
 * Rules: fenced code blocks are skipped entirely; a table row, heading, or
 * blockquote is its own single-line unit (well-formed markdown never wraps
 * them); a list item starts a unit and ABSORBS its indented/plain
 * continuation lines; a plain prose line continues the open unit or starts
 * one; a blank line closes the unit. Two adjacent list items NEVER merge
 * (a claim item followed by a reference-only item keeps each honest).
 */
export function buildBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const lines = text.split("\n");
  let inCode = false;
  let current: { text: string; line: number } | null = null;
  const flush = (): void => {
    if (current !== null) {
      blocks.push({ text: current.text, line: current.line, kind: "prose" });
      current = null;
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (trimmed === "") {
      flush();
      continue;
    }
    if (trimmed.startsWith("|")) {
      flush();
      blocks.push({ text: trimmed, line: i + 1, kind: "table" });
      continue;
    }
    if (trimmed.startsWith("#")) {
      flush();
      blocks.push({ text: trimmed, line: i + 1, kind: "heading" });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      blocks.push({ text: trimmed, line: i + 1, kind: "quote" });
      continue;
    }
    const isListItem = /^\s*(?:[-*+]|\d+\.)\s+/.test(raw);
    if (current === null || isListItem) {
      flush();
      current = { text: trimmed, line: i + 1 };
      continue;
    }
    current.text += ` ${trimmed}`; // a wrapped continuation line joins
  }
  flush();
  return blocks;
}

// -- the main scan ----------------------------------------------------------------

const { reservations, crossRefs, findings: ledgerFindings } = parseLedger();
const { reservedBy: RESERVED_BY, findings: overlapFindings } = detectReservationOverlaps(reservations);
const RESERVATION_PHASES = new Set(reservations.map((r) => r.phase));

const findings: Finding[] = [...ledgerFindings, ...overlapFindings];
findings.push(...detectReservedButImplemented(RESERVED_BY));
findings.push(...checkCrossRefs(crossRefs, RESERVED_BY));

const phaseDir = join(DOCS, "implementation", "phases");
const phaseFiles = readdirSync(phaseDir)
  .filter((f) => /^PHASE-\d{3}\.md$/.test(f))
  .sort();

let scannedClaims = 0;
let scannedReferences = 0;
for (const file of phaseFiles) {
  const phase = file.replace(".md", "");
  const text = readFileSync(join(phaseDir, file), "utf8");
  for (const block of buildBlocks(text)) {
    if (block.kind === "heading" || block.kind === "quote" || block.kind === "code") continue;
    const result = classifyText(
      block.text,
      phase,
      findings,
      `${file}:${block.line}`,
      RESERVED_BY,
      RESERVATION_PHASES,
    );
    scannedClaims += result.claims;
    scannedReferences += result.references;
  }
}

// -- the self-test (the audit's demanded proof) -----------------------------------

function runSelfTest(): boolean {
  let ok = true;
  const check = (label: string, pass: boolean): void => {
    console.log(`[check-id-ledger] self-test ${label}: ${pass ? "OK ✓" : "BROKEN ✗"}`);
    if (!pass) ok = false;
  };

  // (1) A CONFLICTING claim: PHASE-043's doc line claiming G-50 (which the
  // ledger reserves for PHASE-045) — the classifier must flag it.
  const conflictFindings: Finding[] = [];
  classifyLine(
    "| T-99 | Golden suites G-50…G-51 with failure packs; INV-031 suite | api |",
    "PHASE-043",
    conflictFindings,
  );
  check(
    "(1) conflicting claim — PHASE-043 claiming G-50/G-51 (reserved for PHASE-045)",
    conflictFindings.some((f) => f.kind === "claim-conflict"),
  );

  // (2) A LEGITIMATE reference: PHASE-046's doc line referencing the
  // IMPLEMENTED G-13/G-14 shapes — the classifier must pass it silently.
  const referenceFindings: Finding[] = [];
  classifyLine(
    "- The variance postings reuse the G-13/G-14 shapes with CYCLE_COUNT reasons.",
    "PHASE-046",
    referenceFindings,
  );
  check(
    "(2) legitimate reference — PHASE-046 referencing the implemented G-13/G-14",
    referenceFindings.every(
      (f) => f.severity === "warning" && f.kind !== "stale-claim" && f.kind !== "claim-conflict",
    ),
  );

  // (3) Range expansion from REAL TEXT with EVERY supported separator —
  // not just the expansion function: "BR-068..BR-070", "G-47–G-49" (en
  // dash), "INV-001—INV-003" (em dash), and the canonical "G-47…G-50" must
  // all expand to their full spans out of the actual scanned text.
  check(
    "(3) range extraction from actual text — .., en-dash, em-dash, and … all expand",
    JSON.stringify(idsIn("guards BR-068..BR-070 and G-47–G-49 plus INV-001—INV-003 and G-47…G-50")) ===
      JSON.stringify([
        "BR-068",
        "BR-069",
        "BR-070",
        "G-47",
        "G-48",
        "G-49",
        "INV-001",
        "INV-002",
        "INV-003",
        "G-47",
        "G-48",
        "G-49",
        "G-50",
      ]),
  );

  // (4) INVALID ranges are DIAGNOSED, never silently dropped: an inverted
  // range (BR-078…063 — the renumbering-regression shape), a family
  // mismatch (G-47…INV-50), and an absurdly wide one each produce their
  // NAMED error kind out of real text.
  const invalidFindings: Finding[] = [];
  idsInDetailed("guards BR-078…063 here", "PHASE-043.md:170", invalidFindings);
  idsInDetailed("and G-47…INV-50 there", "PHASE-045.md:166", invalidFindings);
  idsInDetailed("plus BR-001…999 wide", "PHASE-046.md:165", invalidFindings);
  check(
    "(4) invalid ranges diagnosed by name — inverted / family-mismatch / too-wide (no silent drops)",
    invalidFindings.length === 3 &&
      invalidFindings[0]!.kind === "inverted-range" &&
      invalidFindings[0]!.detail.includes("PHASE-043.md:170") &&
      invalidFindings[1]!.kind === "range-family-mismatch" &&
      invalidFindings[2]!.kind === "range-too-wide",
  );

  // (5) A CLAIM WRAPPED ACROSS LINES: the marker ("Golden suites … added
  // to") on one physical line, the ids on the next — the block scanner must
  // join them into one unit and classify the CLAIM (a per-line scan saw a
  // bare id line and treated it as a reference).
  const wrappedText = [
    "PHASE-090 adds the leave goldens",
    "G-60…G-62 added to JOURNAL_RULES §7 with failure packs.",
  ].join("\n");
  const wrappedBlocks = buildBlocks(wrappedText);
  const wrappedFindings: Finding[] = [];
  let wrappedClaims = 0;
  for (const block of wrappedBlocks) {
    if (block.kind === "heading" || block.kind === "quote" || block.kind === "code") continue;
    const result = classifyText(
      block.text,
      "PHASE-043",
      wrappedFindings,
      `synthetic:${block.line}`,
      RESERVED_BY,
      RESERVATION_PHASES,
    );
    wrappedClaims += result.claims;
  }
  check(
    "(5) multi-line claim — the wrapped marker+ids join into one claimed unit (vs a legitimate wrapped reference)",
    wrappedBlocks.length === 1 &&
      wrappedClaims === 3 &&
      wrappedFindings.some((f) => f.kind === "claim-conflict" && f.detail.includes("G-60")),
  );

  // (5b) The DISTINCTION holds for wrapped references too: a wrapped
  // "reuse the G-13 shapes" line pair must classify as a REFERENCE and pass
  // silently (never a false claim).
  const wrappedRefText = [
    "- The encashment postings reuse",
    "  the G-13/G-14 shapes with their own reasons.",
  ].join("\n");
  const wrappedRefFindings: Finding[] = [];
  for (const block of buildBlocks(wrappedRefText)) {
    if (block.kind === "heading" || block.kind === "quote" || block.kind === "code") continue;
    classifyText(block.text, "PHASE-046", wrappedRefFindings, `synthetic:${block.line}`, RESERVED_BY, RESERVATION_PHASES);
  }
  check(
    "(5b) wrapped legitimate reference stays a reference (the distinction holds across lines)",
    wrappedRefFindings.length === 0,
  );

  // (5c) The marker/REFERENCE distinction under join: a schema gain
  // ("journal_lines gains columns") with an IMPLEMENTED id referenced later
  // in the same block stays a REFERENCE (the PHASE-053 case — the naive
  // join misread it as a stale claim).
  const gainRefFindings: Finding[] = [];
  classifyLine(
    "journal_lines gains dedicated indexed columns for the hot dimensions; the option at posting (A-11 — BR-051 advisory becomes enforceable when configured).",
    "PHASE-053",
    gainRefFindings,
  );
  check(
    "(5c) a non-id 'gains' never claims a distant reference (the PHASE-053 shape)",
    gainRefFindings.length === 0,
  );

  // (6) The RESERVATION-OVERLAP diagnosis — pre-fix, a real overlap crashed
  // the checker (pushError ran before `const findings` — the TDZ
  // ReferenceError). A synthetic overlapping pair must produce the named
  // FINDING, never an exception.
  let overlapDiagnosed = false;
  try {
    const overlap = detectReservationOverlaps([
      { phase: "PHASE-098", goldens: ["G-90", "G-91"], invariants: [], rules: [] },
      { phase: "PHASE-099", goldens: ["G-91"], invariants: [], rules: [] },
    ]);
    overlapDiagnosed =
      overlap.reservedBy.size === 2 &&
      overlap.findings.length === 1 &&
      overlap.findings[0]!.kind === "reservation-overlap" &&
      overlap.findings[0]!.detail.includes("both PHASE-098 and PHASE-099");
  } catch {
    overlapDiagnosed = false;
  }
  check("(6) reservation-overlap produces the diagnosis (a Finding, never the TDZ crash)", overlapDiagnosed);

  // (7) A reference to an EXISTING id under a DIFFERENT OWNER: the ledger's
  // cross-ref table row claiming G-51 for PHASE-046 while §2 reserves it
  // for PHASE-045 — the owner-mismatch finding, never a pass.
  const ownerMismatch = checkCrossRefs(
    [{ inPhase: "PHASE-047", refs: ["G-51"], ownedBy: "PHASE-046" }],
    RESERVED_BY,
  );
  check(
    "(7) existing id referenced under a different owner — the cross-ref owner mismatch is flagged",
    ownerMismatch.length === 1 &&
      ownerMismatch[0]!.kind === "cross-ref-owner-mismatch" &&
      ownerMismatch[0]!.detail.includes("owned by PHASE-045"),
  );

  // (8) A claim of an IMPLEMENTED id under a different meaning — the
  // stale-claim finding (an existing number re-claimed as new).
  const staleFindings: Finding[] = [];
  classifyLine(
    "| T-98 | PHASE-090 gains the new golden G-13 (a totally different entitlement meaning) | api |",
    "PHASE-043",
    staleFindings,
  );
  check(
    "(8) implemented id re-claimed under a different meaning — the stale-claim finding",
    staleFindings.some((f) => f.kind === "stale-claim" && f.detail.includes("G-13")),
  );

  return ok;
}

// -- report -------------------------------------------------------------------------

const selfTestRequested = process.argv.includes("--self-test");
let selfTestOk = true;
if (selfTestRequested) {
  selfTestOk = runSelfTest();
  if (!selfTestOk) {
    findings.push({ severity: "error", kind: "self-test", detail: "the self-test probes failed (see above)" });
  }
}

const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");
console.log(
  `[check-id-ledger] implemented: G ${implemented.G.size} · INV ${implemented.INV.size} · BR ${implemented.BR.size}` +
    ` | reservations: ${reservations.length} phases, ${RESERVED_BY.size} ids` +
    ` | phase docs scanned: ${phaseFiles.length} (${scannedClaims} claim ids, ${scannedReferences} reference ids)`,
);
for (const f of errors) {
  console.log(`FAIL  ${f.kind}: ${f.detail}`);
}
for (const f of warnings.slice(0, 40)) {
  console.log(`WARN  ${f.kind}: ${f.detail}`);
}
if (warnings.length > 40) {
  console.log(`WARN  … and ${warnings.length - 40} more warnings`);
}
if (errors.length > 0) {
  console.log(`[check-id-ledger] ${errors.length} error(s), ${warnings.length} warning(s) — FAILED`);
  process.exit(1);
}
console.log(`[check-id-ledger] 0 errors, ${warnings.length} warning(s) — OK`);
