/**
 * The ID-ledger collision check (docs/planning/ID_LEDGER.md §5): parses the
 * three canon documents for the IMPLEMENTED inventory (G/INV/BR), the
 * ledger's reservation + cross-reference tables, and every phase document —
 * expanding shorthand ranges (G-47…G-50 and BR-068…070 alike), distinguishing
 * CLAIMS of new ids from legitimate REFERENCES to existing ones, and failing
 * on: stale claims (implemented ids claimed as new by a future phase),
 * reservation overlaps, claims outside their phase's reservation, and
 * unresolving cross-references.
 *
 * Usage:  pnpm check:id-ledger                  (the repo check)
 *         pnpm check:id-ledger -- --self-test   (also prove the classifier
 *         with a synthetic CONFLICTING claim + a LEGITIMATE reference)
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

/** Expand ONE token: a single id (G-47), a full-tail range (G-47…G-50), or a
 * short-tail range (BR-068…070). Ellipsis may be …, .., –, or —. */
function expandToken(token: string): string[] | null {
  const normalized = token
    .trim()
    .replace(/[–—]/g, "…")
    .replace(/\.\./g, "…");
  const range = normalized.match(/^(G|INV|BR)-(\d+)…(?:(?:G|INV|BR)-)?(\d+)$/);
  if (range !== null) {
    const family = range[1] as Family;
    const lo = Number(range[2]);
    const hi = Number(range[3]);
    if (hi <= lo || hi - lo > 200) return null;
    const out: string[] = [];
    for (let n = lo; n <= hi; n += 1) out.push(makeId(family, n));
    return out;
  }
  return ID_RE.test(normalized) ? [normalized] : null;
}

/** All id tokens in a text chunk (standalone ids and ranges, expanded). */
export function idsIn(text: string): string[] {
  const out: string[] = [];
  const tokenRe = /\b(?:G|INV|BR)-\d+(?:…(?:(?:G|INV|BR)-)?\d+)?/gu;
  for (const match of text.matchAll(tokenRe)) {
    const expanded = expandToken(match[0]);
    if (expanded !== null) out.push(...expanded);
  }
  return out;
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

function parseLedger(): { reservations: Reservation[]; crossRefs: CrossRef[] } {
  const ledger = readFileSync(join(DOCS, "planning", "ID_LEDGER.md"), "utf8");
  const reservations: Reservation[] = [];
  for (const match of ledger.matchAll(
    /^\| (PHASE-\d{3})[^|]*\|([^|]*)\|([^|]*)\|([^|]*)\|/gm,
  )) {
    const phase = match[1]!;
    if (/…/.test(match[0].split("|")[1] ?? "")) continue; // the "PHASE-065…068 none" row
    const cells = [match[2]!, match[3]!, match[4]!];
    const values = cells.map((cell) => idsIn(cell.replace(/—/g, " ")));
    reservations.push({
      phase,
      goldens: values[0]!.filter((id) => id.startsWith("G-")),
      invariants: values[1]!.filter((id) => id.startsWith("INV-")),
      rules: values[2]!.filter((id) => id.startsWith("BR-")),
    });
  }
  const crossRefs: CrossRef[] = [];
  for (const match of ledger.matchAll(/^\| (PHASE-\d{3}) \|([^|]*)\| (PHASE-\d{3}) \|/gm)) {
    crossRefs.push({ inPhase: match[1]!, refs: idsIn(match[2]!), ownedBy: match[3]! });
  }
  return { reservations, crossRefs };
}

const { reservations, crossRefs } = parseLedger();

const reservedBy: Map<string, string> = new Map();
for (const r of reservations) {
  for (const id of [...r.goldens, ...r.invariants, ...r.rules]) {
    const existing = reservedBy.get(id);
    if (existing !== undefined) {
      pushError("reservation-overlap", `${id} reserved by both ${existing} and ${r.phase}`);
      continue;
    }
    reservedBy.set(id, r.phase);
  }
}

// -- the claim/reference classifier ---------------------------------------------

const CLAIM_MARKERS =
  /(added to|gains\b|new golden|joins? `?JOURNAL_RULES|invariant .*added|Golden suites?)/i;
const REFERENCE_ONLY_MARKERS =
  /(reuses?|reuse|mirror(?:s|ed)?|the existing|already|precedent|predat(?:e|es|ed)|stays?|keep[s]? |consumed|was \(|the stale plan|original plan's)/i;

/** Is this phase-doc line a CLAIM that the phase adds these ids (vs a
 * reference to ids that exist elsewhere)? Exported for the self-test. */
export function isClaimLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("#") || trimmed.startsWith(">")) return false;
  if (!/\b(?:G|INV|BR)-\d+/.test(trimmed)) return false;
  if (!CLAIM_MARKERS.test(trimmed)) return false;
  return !REFERENCE_ONLY_MARKERS.test(trimmed);
}

/** Classify one line of a phase document against the ledger. Appends
 * findings. Exported for the self-test. */
export function classifyLine(line: string, phase: string, out: Finding[]): { claims: number; references: number } {
  const isFuture = reservedBy.has("") === false && reservationPhases.has(phase);
  let claims = 0;
  let references = 0;
  const claim = isClaimLine(line);
  for (const id of idsIn(line)) {
    const family = id.split("-")[0] as Family;
    const implementedOwner = implemented[family].get(id);
    if (claim) {
      claims += 1;
      if (implementedOwner !== undefined) {
        if (isFuture) {
          out.push({
            severity: "error",
            kind: "stale-claim",
            detail: `${phase} claims ${id} as new, but it is already implemented (${implementedOwner})`,
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
          detail: `${phase} claims ${id} but it is in no reservation (reserve it in ID_LEDGER §2 first)`,
        });
      } else if (owner !== phase) {
        out.push({
          severity: "error",
          kind: "claim-conflict",
          detail: `${phase} claims ${id}, but it is reserved for ${owner} (the conflicting-claim case)`,
        });
      }
    } else {
      references += 1;
      if (implementedOwner !== undefined) continue;
      if (reservedBy.has(id)) continue;
      out.push({
        severity: "warning",
        kind: "dangling-reference",
        detail: `${phase} mentions ${id} which is neither implemented nor reserved`,
      });
    }
  }
  return { claims, references };
}

const findings: Finding[] = [];
function pushError(kind: string, detail: string): void {
  findings.push({ severity: "error", kind, detail });
}

// Reservations must never collide with the implemented inventory.
for (const [id, phase] of reservedBy) {
  const family = id.split("-")[0] as Family;
  if (implemented[family].has(id)) {
    pushError(
      "reserved-but-implemented",
      `${id} is reserved for ${phase} but already implemented (${implemented[family].get(id)})`,
    );
  }
}

// The cross-reference table must resolve.
for (const ref of crossRefs) {
  for (const id of ref.refs) {
    const family = id.split("-")[0] as Family;
    if (implemented[family].has(id)) continue;
    const owner = reservedBy.get(id);
    if (owner === undefined) {
      pushError(
        "cross-ref-dangling",
        `${ref.inPhase}'s cross-reference ${id} is neither implemented nor reserved`,
      );
    } else if (owner !== ref.ownedBy) {
      pushError(
        "cross-ref-owner-mismatch",
        `${ref.inPhase}'s cross-reference ${id} is owned by ${owner}, not ${ref.ownedBy}`,
      );
    }
  }
}

// -- scan the phase documents ----------------------------------------------------

const reservationPhases = new Set(reservations.map((r) => r.phase));
const phaseDir = join(DOCS, "implementation", "phases");
const phaseFiles = readdirSync(phaseDir)
  .filter((f) => /^PHASE-\d{3}\.md$/.test(f))
  .sort();

let scannedClaims = 0;
let scannedReferences = 0;
for (const file of phaseFiles) {
  const phase = file.replace(".md", "");
  const text = readFileSync(join(phaseDir, file), "utf8");
  const seenErrorIds = new Set<string>();
  for (const line of text.split("\n")) {
    const result = classifyLine(line, phase, findings);
    scannedClaims += result.claims;
    scannedReferences += result.references;
  }
  void seenErrorIds;
}

// -- the self-test (the audit's demanded proof) -----------------------------------

function runSelfTest(): boolean {
  let ok = true;
  // (1) A CONFLICTING claim: PHASE-043's doc line claiming G-50 (which the
  // ledger reserves for PHASE-045) — the classifier must flag it.
  const conflictFindings: Finding[] = [];
  classifyLine(
    "| T-99 | Golden suites G-50…G-51 with failure packs; INV-031 suite | api |",
    "PHASE-043",
    conflictFindings,
  );
  const conflictDetected = conflictFindings.some((f) => f.kind === "claim-conflict");
  console.log(
    `[check-id-ledger] self-test (1) conflicting claim — PHASE-043 claiming G-50/G-51 (reserved for PHASE-045): ${conflictDetected ? "DETECTED ✓" : "MISSED ✗"}`,
  );
  if (!conflictDetected) ok = false;

  // (2) A LEGITIMATE reference: PHASE-046's doc line referencing the
  // IMPLEMENTED G-13/G-14 shapes — the classifier must pass it silently.
  const referenceFindings: Finding[] = [];
  classifyLine(
    "- The variance postings reuse the G-13/G-14 shapes with CYCLE_COUNT reasons.",
    "PHASE-046",
    referenceFindings,
  );
  const referenceClean =
    referenceFindings.length === 0 ||
    referenceFindings.every((f) => f.severity === "warning" && f.kind !== "stale-claim" && f.kind !== "claim-conflict");
  console.log(
    `[check-id-ledger] self-test (2) legitimate reference — PHASE-046 referencing the implemented G-13/G-14: ${referenceClean ? "PASSED ✓" : "FAILED ✗"}`,
  );
  if (!referenceClean) ok = false;

  // (3) Range expansion proof: BR-068…070 and G-47…G-50 both expand.
  const expandedShort = expandToken("BR-068…070");
  const expandedFull = expandToken("G-47…G-50");
  const rangesOk =
    JSON.stringify(expandedShort) === JSON.stringify(["BR-068", "BR-069", "BR-070"]) &&
    JSON.stringify(expandedFull) === JSON.stringify(["G-47", "G-48", "G-49", "G-50"]);
  console.log(
    `[check-id-ledger] self-test (3) shorthand ranges — BR-068…070 and G-47…G-50 both expand: ${rangesOk ? "OK ✓" : "BROKEN ✗"}`,
  );
  if (!rangesOk) ok = false;
  return ok;
}

// -- report -------------------------------------------------------------------------

const selfTestRequested = process.argv.includes("--self-test");
let selfTestOk = true;
if (selfTestRequested) {
  selfTestOk = runSelfTest();
  if (!selfTestOk) {
    pushError("self-test", "the self-test probes failed (see above)");
  }
}

const errors = findings.filter((f) => f.severity === "error");
const warnings = findings.filter((f) => f.severity === "warning");
console.log(
  `[check-id-ledger] implemented: G ${implemented.G.size} · INV ${implemented.INV.size} · BR ${implemented.BR.size}` +
    ` | reservations: ${reservations.length} phases, ${reservedBy.size} ids` +
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
