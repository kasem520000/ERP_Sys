/**
 * Mobile design-token parity gate (PHASE-022 T-P22-1b; MASTER-PLAN §4 +
 * DR-P22-02 — "imports BOTH (scripts/ live outside the depcruise-forbidden
 * paths — the check:i18n-parity precedent) and asserts byte-parity").
 *
 * 1. MIRROR PARITY — flattens every family of the canonical export
 *    (packages/ui/src/tokens/tokens.ts — DESIGN_TOKENS §17's TS object) and
 *    asserts every canonical leaf has a mobile twin
 *    (apps/mobile/src/theme/tokens.ts) with the SAME value. The mobile
 *    mirror may carry EXTRA exports (the RN adaptations + the binding
 *    maps) — canonical ⊆ mobile is the contract.
 *
 * 2. DERIVATION PARITY — the mobile RN adaptations must DERIVE from the
 *    canonical values they adapt: space/radius/durations parse out of the
 *    canonical px/ms strings, typeScale px = rem × 16, the elevation objects
 *    parse back out of the canonical box-shadow strings, fontFamily takes
 *    each canonical stack's first family, financeSign links the §4 palette
 *    to the semantic solids + gray-600.
 *
 * Prints `== mobile token parity: N/N ==` (+ the derivation line) and exits
 * 1 with a diff on any mismatch. Usage: `pnpm check:mobile-tokens`.
 */
import * as canonical from "../packages/ui/src/tokens/tokens";
import * as mobile from "../apps/mobile/src/theme/tokens";

interface FlatToken {
  key: string;
  value: string | number;
}

function flatten(value: unknown, prefix: string): FlatToken[] {
  if (value === null || typeof value !== "object") {
    return [{ key: prefix, value: value as string | number }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) =>
    flatten(nested, prefix === "" ? key : `${prefix}.${key}`),
  );
}

/** Resolve a flattened canonical key against the mobile module. */
function lookupMobileExport(family: string, path: string): { found: boolean; value: unknown } {
  const mobileFamily = (mobile as unknown as Record<string, unknown>)[family];
  if (mobileFamily === undefined) {
    return { found: false, value: undefined };
  }
  let current: unknown = mobileFamily;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: current !== undefined, value: current };
}

export function mirrorReport(): { total: number; ok: number; failures: string[] } {
  const failures: string[] = [];
  let total = 0;
  let ok = 0;
  for (const family of Object.keys(canonical)) {
    for (const leaf of flatten((canonical as unknown as Record<string, unknown>)[family], family)) {
      total += 1;
      const twin = lookupMobileExport(family, leaf.key.slice(family.length + 1));
      if (!twin.found) {
        failures.push(`MISSING mobile twin for canonical ${leaf.key} (${JSON.stringify(leaf.value)})`);
      } else if (twin.value !== leaf.value) {
        failures.push(
          `DRIFT   ${leaf.key}: canonical ${JSON.stringify(leaf.value)} ≠ mobile ${JSON.stringify(twin.value)}`,
        );
      } else {
        ok += 1;
      }
    }
  }
  return { total, ok, failures };
}

export function derivationReport(): { total: number; ok: number; failures: string[] } {
  const failures: string[] = [];
  const checks: Array<[string, boolean]> = [];

  const check = (key: string, condition: boolean): void => {
    checks.push([key, condition]);
  };

  // §7 spacing → space (RN numbers), stop for stop.
  for (const [stop, value] of Object.entries(canonical.spacing)) {
    check(`space.${stop}`, mobile.space[stop as keyof typeof mobile.space] === Number.parseInt(value, 10));
  }
  // §8 radii → radius.
  for (const [name, value] of Object.entries(canonical.radii)) {
    check(`radius.${name}`, mobile.radius[name as keyof typeof mobile.radius] === Number.parseInt(value, 10));
  }
  // §13 motion durations → durations (ms).
  check("durations.instant", mobile.durations.instant === Number.parseInt(canonical.motion.durationInstant, 10));
  check("durations.fast", mobile.durations.fast === Number.parseInt(canonical.motion.durationFast, 10));
  check("durations.base", mobile.durations.base === Number.parseInt(canonical.motion.durationBase, 10));
  // §6 type scale: px = rem × 16.
  for (const [step, value] of Object.entries(canonical.text)) {
    const px = Number.parseFloat(value) * 16;
    check(`typeScale.${step}.fontSize`, mobile.typeScale[step as keyof typeof mobile.typeScale].fontSize === px);
  }
  // §5 shadows → elevation objects (offsetY/blur/opacity parsed, color =
  // the canonical rgba base, elevation = offsetY).
  const SHADOW_FORM = /^0 (\d+)px (\d+)px rgba\((\d+), (\d+), (\d+), (0\.\d+)\)$/;
  for (const [level, css] of Object.entries(canonical.shadows)) {
    const match = SHADOW_FORM.exec(css);
    if (match === null) {
      check(`shadows.${level} parses`, false);
      continue;
    }
    const [, offsetY, blur, r, g, b, alpha] = match;
    const shadow = mobile.elevation[level as keyof typeof mobile.elevation];
    check(`elevation.${level}.offsetY`, shadow.shadowOffset.height === Number(offsetY));
    check(`elevation.${level}.blur`, shadow.shadowRadius === Number(blur));
    check(`elevation.${level}.opacity`, shadow.shadowOpacity === Number(alpha));
    check(`elevation.${level}.elevation`, shadow.elevation === Number(offsetY));
    check(
      `elevation.${level}.color`,
      shadow.shadowColor === canonical.colors.gray[950] &&
        shadow.shadowColor ===
          `#${[r, g, b].map((channel) => Number(channel).toString(16).padStart(2, "0").toUpperCase()).join("")}`,
    );
  }
  // §6 fonts → fontFamily takes each canonical stack's first family.
  for (const key of ["ar", "latin", "mono"] as const) {
    const firstFamily = canonical.fonts[key].split(",")[0]?.trim().replace(/^'|'$/g, "");
    check(`fontFamily.${key}`, mobile.fontFamily[key] === firstFamily);
  }
  // §4 finance signs: RN-usable palette links the canonical finance values
  // + the semantic solids; neutral is gray-600 ("zero renders gray-600").
  check("financeSign.positive = canonical finance.positive", mobile.financeSign.positive === canonical.colors.finance.positive);
  check("financeSign.negative = canonical finance.negative", mobile.financeSign.negative === canonical.colors.finance.negative);
  check("financeSign.neutral = gray-600", mobile.financeSign.neutral === canonical.colors.gray[600]);

  const ok = checks.filter(([, condition]) => condition).length;
  for (const [key, condition] of checks) {
    if (!condition) {
      failures.push(`DERIVATION FAIL  ${key}`);
    }
  }
  return { total: checks.length, ok, failures };
}

export function main(): number {
  const mirror = mirrorReport();
  const derivations = derivationReport();

  console.log(`== mobile token parity: ${mirror.ok}/${mirror.total} ==`);
  console.log(`== mobile token derivations: ${derivations.ok}/${derivations.total} ==`);

  let failures = 0;
  for (const line of mirror.failures) {
    console.error(`FAIL  ${line}`);
    failures += 1;
  }
  for (const line of derivations.failures) {
    console.error(`FAIL  ${line}`);
    failures += 1;
  }
  if (failures > 0) {
    console.error(
      `\n${failures} parity violation(s) — the mobile theme mirror must stay byte-identical to packages/ui/src/tokens (DR-P22-02; DESIGN_TOKENS §17 governance).`,
    );
    return 1;
  }
  console.log("canonical ⊆ mobile on every token family; RN adaptations derive from the canonical values.");
  return 0;
}

if (process.argv[1]?.endsWith("check-mobile-tokens.ts")) {
  process.exit(main());
}
