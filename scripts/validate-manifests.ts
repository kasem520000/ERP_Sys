/**
 * Industry-manifest validation gate (PHASE-015 T3; industries/README §8 #1:
 * "no manifest ships or upgrades without passing schema validation").
 *
 * Validates every manifest in SHIPPED_TEMPLATE_MANIFESTS against the §3 zod
 * mirror and asserts the registry invariants: unique ids, semver versions,
 * non-empty required_feature_keys. The five v1.0.0 templates are transcribed
 * from the normative docs (retail / grocery / restaurant) and the migration
 * 0025 registry seeds (automotive / distribution) — this gate is what keeps
 * the contracts constants and those sources from drifting (RISK-020).
 *
 * Usage: tsx scripts/validate-manifests.ts   (repo root; wired into the local
 * gate after the unit-test step and into CI).
 */
import {
  IndustryManifestValidationError,
  SHIPPED_TEMPLATE_MANIFESTS,
  hashManifestJson,
  parseIndustryTemplateManifest,
} from "../packages/contracts/src/industry";

const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export function main(): number {
  console.log(
    `== industry manifests validation (industries/README §3): ` +
      `${SHIPPED_TEMPLATE_MANIFESTS.length} shipped template(s) ==`,
  );
  const failures: string[] = [];
  const seenIds = new Set<string>();

  for (const manifest of SHIPPED_TEMPLATE_MANIFESTS) {
    const label = `${manifest.id}@${manifest.version}`;
    try {
      parseIndustryTemplateManifest(manifest);
      console.log(`OK   ${label} — schema valid (content hash ${hashManifestJson(manifest)})`);
    } catch (error) {
      const detail =
        error instanceof IndustryManifestValidationError
          ? error.message
          : `unexpected error: ${String(error)}`;
      failures.push(`${label}: schema validation failed\n${detail}`);
      continue;
    }

    // Registry invariants (§8 governance).
    if (seenIds.has(manifest.id)) {
      failures.push(`${label}: duplicate template id in the shipped registry: ${manifest.id}`);
    }
    seenIds.add(manifest.id);
    if (!SEMVER_PATTERN.test(manifest.version)) {
      failures.push(`${label}: version '${manifest.version}' is not semver MAJOR.MINOR.PATCH`);
    }
    if (manifest.required_feature_keys.length === 0) {
      failures.push(`${label}: required_feature_keys must not be empty`);
    }
  }

  if (failures.length > 0) {
    console.error("\nFAILED — industry manifests validation:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    return 1;
  }
  console.log(
    `\nOK — ${SHIPPED_TEMPLATE_MANIFESTS.length} manifest(s) valid against §3; ` +
      "ids unique; versions semver; required_feature_keys non-empty.",
  );
  return 0;
}

if (process.argv[1]?.endsWith("validate-manifests.ts")) {
  process.exit(main());
}
