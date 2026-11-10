/**
 * Design-token contrast gate (DESIGN_TOKENS §16, VISUAL_TESTING, PHASE-005 T1).
 * Recomputes WCAG 2.1 AA ratios on the §16 matrix from tokens.ts (the CSS/TS
 * pair is byte-matched by the unit suite) — fails on any regression.
 * Run via `pnpm check:token-contrast` (local gate + CI).
 */
import { colors as c } from "../packages/ui/src/tokens/tokens";

/** WCAG 2.1 relative luminance + contrast ratio. */
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channel = (raw: string): number => {
    const v = Number.parseInt(raw, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(clean.slice(0, 2));
  const g = channel(clean.slice(2, 4));
  const b = channel(clean.slice(4, 6));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

const WHITE = "#FFFFFF";

/** §16 matrix — pair, documented approx ratio, requirement. */
const MATRIX: Array<{ pair: string; fg: string; bg: string; requirement: number; label: string }> = [
  { pair: "gray-900 on white", fg: c.gray[900], bg: WHITE, requirement: 4.5, label: "body text" },
  { pair: "gray-600 on white", fg: c.gray[600], bg: WHITE, requirement: 4.5, label: "secondary text" },
  { pair: "gray-500 on white", fg: c.gray[500], bg: WHITE, requirement: 4.5, label: "secondary text (borderline — keep)" },
  { pair: "primary-600 on white", fg: c.primary[600], bg: WHITE, requirement: 4.5, label: "text · 3:1 UI" },
  { pair: "success-700 on white", fg: c.success.solid, bg: WHITE, requirement: 4.5, label: "POSTED" },
  { pair: "warning-700 on white", fg: c.warning.solid, bg: WHITE, requirement: 4.5, label: "PENDING_APPROVAL" },
  { pair: "danger-700 on white", fg: c.danger.solid, bg: WHITE, requirement: 4.5, label: "errors / REVERSED" },
  { pair: "info-700 on white", fg: c.info.solid, bg: WHITE, requirement: 4.5, label: "DRAFT / hints" },
  { pair: "white on primary-600", fg: WHITE, bg: c.primary[600], requirement: 4.5, label: "primary buttons" },
  { pair: "success tint text on tint bg", fg: c.success.tintText, bg: c.success.tintBg, requirement: 4.5, label: "POSTED badge" },
  { pair: "warning tint text on tint bg", fg: c.warning.tintText, bg: c.warning.tintBg, requirement: 4.5, label: "PENDING badge" },
  { pair: "danger tint text on tint bg", fg: c.danger.tintText, bg: c.danger.tintBg, requirement: 4.5, label: "error badge" },
  { pair: "info tint text on tint bg", fg: c.info.tintText, bg: c.info.tintBg, requirement: 4.5, label: "DRAFT badge" },
  { pair: "success-info tint text on tint bg", fg: c.successInfo.tintText, bg: c.successInfo.tintBg, requirement: 4.5, label: "APPROVED badge" },
  { pair: "finance-negative on white", fg: c.finance.negative, bg: WHITE, requirement: 4.5, label: "negative amounts" },
];

/** Documented approximation — a big drift from the doc's own numbers is a
 *  token change and needs a design decision record even if still passing. */
const DOCUMENTED_APPROX: Record<string, number> = {
  "gray-900 on white": 17.4,
  "gray-600 on white": 7.6,
  "gray-500 on white": 4.8,
  "primary-600 on white": 5.5,
  "success-700 on white": 4.9,
  "warning-700 on white": 4.7,
  "danger-700 on white": 5.9,
  "info-700 on white": 6.3,
  "white on primary-600": 5.5,
  "success tint text on tint bg": 6.8,
};

/** Placeholder is exempt as inactive UI (§16) — but meaning-carrying text may
 *  never use gray-400; asserted separately as a floor sanity check. */
const PLACEHOLDER = { fg: c.gray[400], bg: WHITE, documented: 2.8, exempt: true };

export function main(): number {
  let failures = 0;
  console.log("== design-token contrast gate (DESIGN_TOKENS §16) ==");
  for (const entry of MATRIX) {
    const ratio = contrastRatio(entry.fg, entry.bg);
    const ok = ratio >= entry.requirement;
    if (!ok) failures += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${entry.pair.padEnd(42)} ${String(ratio).padStart(6)}:1  (need ≥ ${entry.requirement}:1 — ${entry.label})`,
    );
    const approx = DOCUMENTED_APPROX[entry.pair];
    if (approx !== undefined && Math.abs(ratio - approx) > 0.35) {
      console.log(
        `WARN  ${entry.pair}: computed ${ratio} vs documented ~${approx} — token drift needs a decision record if intended`,
      );
    }
  }
  const ph = contrastRatio(PLACEHOLDER.fg, PLACEHOLDER.bg);
  const phNote = ph >= 3 ? "WARN placeholder ≥3:1 — exemption still scoped to inactive UI only" : "ok (exempt, inactive)";
  console.log(`EXEMPT gray-400 placeholder on white ${String(ph).padStart(5)}:1  (${phNote})`);
  if (failures > 0) {
    console.error(`\n${failures} contrast regression(s) — AA floor violated.`);
    return 1;
  }
  console.log("\nall §16 pairs pass the AA floor.");
  return 0;
}

if (process.argv[1]?.endsWith("check-token-contrast.ts")) {
  process.exit(main());
}
