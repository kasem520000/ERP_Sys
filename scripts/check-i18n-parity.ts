/**
 * i18n key-parity gate (PHASE-005 T8; LOCALIZATION_ARCHITECTURE — "the
 * key-parity check fails the build when ar and en key sets differ").
 *
 * Structurally walks the AR/EN dictionaries (nested namespaces) and fails on:
 *   - a key present in one locale but missing in the other;
 *   - a key present in both but with an EMPTY string in either locale
 *     (missing string ≠ missing key — both are release blockers).
 *
 * Usage: tsx scripts/check-i18n-parity.ts [fixture-module]
 * The optional fixture argument is the negative-proof hook —
 * scripts/ci/negative-i18n-parity-test.sh points it at a deliberately
 * drifting fixture and asserts a non-zero exit (PHASE-001 meta-test pattern).
 */
import { resolve } from "node:path";
import { getDictionary } from "../apps/web/i18n/dictionaries";

interface FlatEntry {
  key: string;
  value: string;
}

function flatten(value: unknown, prefix: string): FlatEntry[] {
  if (typeof value === "string") return [{ key: prefix, value }];
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => flatten(item, `${prefix}[${i}]`));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flatten(v, prefix === "" ? k : `${prefix}.${k}`),
    );
  }
  return [];
}

export function parityReport(
  ar: unknown,
  en: unknown,
): { missingInEn: string[]; missingInAr: string[]; empty: string[]; arKeys: number; enKeys: number } {
  const flatAr = flatten(ar, "");
  const flatEn = flatten(en, "");
  const setAr = new Set(flatAr.map((e) => e.key));
  const setEn = new Set(flatEn.map((e) => e.key));
  const empty = [...flatAr, ...flatEn].filter((e) => e.value.trim() === "").map((e) => e.key);
  return {
    missingInEn: [...setAr].filter((k) => !setEn.has(k)),
    missingInAr: [...setEn].filter((k) => !setAr.has(k)),
    empty: [...new Set(empty)],
    arKeys: setAr.size,
    enKeys: setEn.size,
  };
}

export function main(argv: string[]): number {
  const fixture = argv[2] as string | undefined;
  const ar = fixture !== undefined ? (requireOrImport(fixture) as { ar: unknown }).ar : getDictionary("ar");
  const en = fixture !== undefined ? (requireOrImport(fixture) as { en: unknown }).en : getDictionary("en");
  const report = parityReport(ar, en);
  console.log(`== i18n key parity: ar=${report.arKeys} keys, en=${report.enKeys} keys ==`);
  let failures = 0;
  if (report.missingInEn.length > 0) {
    console.error(`FAIL  missing in en: ${report.missingInEn.join(", ")}`);
    failures += report.missingInEn.length;
  }
  if (report.missingInAr.length > 0) {
    console.error(`FAIL  missing in ar: ${report.missingInAr.join(", ")}`);
    failures += report.missingInAr.length;
  }
  if (report.empty.length > 0) {
    console.error(`FAIL  empty values: ${report.empty.join(", ")}`);
    failures += report.empty.length;
  }
  if (failures > 0) {
    console.error(`\n${failures} parity violation(s) — a feature ships only when both locales cover every string (NFR-001).`);
    return 1;
  }
  console.log("ar/en catalogs at 100% key parity; no empty values.");
  return 0;
}

function requireOrImport(modulePath: string): unknown {
  const resolved = resolve(process.cwd(), modulePath);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- fixture hook for the negative meta-test
  const mod = require(resolved) as unknown;
  return mod;
}

if (process.argv[1]?.endsWith("check-i18n-parity.ts")) {
  process.exit(main(process.argv));
}
