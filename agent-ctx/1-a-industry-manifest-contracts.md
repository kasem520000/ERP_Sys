# Task 1-a — Industry-template manifest contract package (PHASE-015 T3)

**Agent:** 1-a (contracts) · **Date:** 2026-11-01 · **Scope:** `packages/contracts/src/industry/**`,
`scripts/validate-manifests.ts`, root `package.json` script, one `scripts/ci/local-gate.sh` step.
**Not touched (per constraints):** `apps/api/**`, migrations, docs, web/ui.

## What shipped

| File | Content |
|---|---|
| `packages/contracts/src/industry/manifest.ts` | zod v4 mirror of the normative JSON Schema (`docs/industries/README.md` §3): `IndustryTemplateManifestSchema` (+ all `$defs` sub-schemas and inferred types), `IndustryManifestValidationError`, `parseIndustryTemplateManifest()` (fail-closed), `canonicalManifestJson()` + `hashManifestJson()` (`sha256:<hex>` over key-sorted, whitespace-free canonical JSON — the `applied_manifest_hash` input), exported patterns/enums (`INDUSTRY_TEMPLATE_ID_PATTERN`, `INDUSTRY_FEATURE_KEY_PATTERN`, `INDUSTRY_SEMVER_PATTERN`, `MODULE_NAMES` (20), `DOCUMENT_TYPES` (21)). Registered under contract key `industry.template-manifest.v1` (ADR-0002 registry, same pattern as `tax/*`). |
| `packages/contracts/src/industry/templates.ts` | `RETAIL_MANIFEST`, `GROCERY_MANIFEST`, `RESTAURANT_MANIFEST` (typed `IndustryTemplateManifest`, deep-frozen) + `SHIPPED_TEMPLATE_MANIFESTS`. **Transcription verified byte-exact** against the ```json fences in `docs/industries/templates/{retail,grocery-supermarket,restaurant-cafe}.md` via a temporary deep-diff script (key-order-insensitive; 3/3 identical, then deleted). |
| `packages/contracts/src/industry/index.ts` | Re-exports of the manifest surface + shipped templates. |
| `packages/contracts/src/index.ts` | One additive export block from `./industry` (no existing exports changed). |
| `packages/contracts/src/__tests__/industry-manifests.test.ts` | 30 tests: 3 shipped manifests parse + round-trip; frozen-ness; registry contract key; 13 negative fixtures (a)–(m) each asserting EXACTLY ONE issue with expected path + zod code (+ message where meaningful) — bad costing enum, orphan module, `allow_negative_stock: true` (const false), bad id, bad version, extra property (unrecognized_keys), lowercase prefix, 2 onboarding steps (too_small ≥3), level `SUGGESTED`, `logistics.trucks` feature key, empty nav group items, terminology missing `ar`, duplicate entries (uniqueItems); typed-error shape; hash determinism across key-order permutations + node:crypto cross-check (Arabic content included); registry invariants (§8: unique ids, semver, non-empty/unique feature keys, unique modules/report keys/step ids). |
| `scripts/validate-manifests.ts` | CLI gate (tsx, `main()` + argv guard like `check-i18n-parity.ts`): parses every shipped manifest, prints `sha256:` content hash per template, asserts registry invariants, exit 1 on failure. Negative path proven live (bad version → exit 1 with precise issues). |
| root `package.json` | `"validate:manifests": "tsx scripts/validate-manifests.ts"` (inserted after the last `check:*` script; all existing scripts intact). |
| `scripts/ci/local-gate.sh` | ONE new step after `run "unit + property tests" pnpm test`: `run "industry manifests validation (industries/README §3)" pnpm validate:manifests`. Nothing else changed. |

## Verification (all green)

```
pnpm --filter @erp/contracts test        → Test Files 2 passed (2) · Tests 41 passed (41)
pnpm --filter @erp/contracts typecheck   → tsc --noEmit clean
pnpm --filter @erp/contracts lint        → eslint clean
pnpm validate:manifests                  → OK — 3 manifest(s) valid against §3; ids unique; versions semver; required_feature_keys non-empty. (exit 0)
bash -n scripts/ci/local-gate.sh         → syntax OK
root pnpm typecheck / pnpm lint (turbo)  → 5/5 tasks successful each
prettier --check (my files)              → clean
```

Content hashes (drift-detection baseline for T4):

```
industry.retail     sha256:ac0a93342ae85cd9b870c96b2bf63cb13e5e815477ebd9d9679f08700080cbba
industry.grocery    sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e
industry.restaurant sha256:e187c90342250bf0a99497c27e7cb97ec7ce0b7420f76e1b3d1aab1b6954b127
```

## Design decisions / deviations (with justification)

1. **`z.partialRecord(z.enum(DOCUMENT_TYPES), …)` for `document_numbering_defaults`.** Probed
   zod 4.6.7: `z.record(z.enum([...]), v)` requires ALL enum keys present (partial manifests fail),
   which contradicts §3 `propertyNames` semantics (any subset of series-bearing document types).
   `z.partialRecord` matches §3 exactly: unknown keys → `unrecognized_keys`, any subset valid.
2. **`uniqueItems` via `.refine(hasUniqueItems)`** with canonical (key-sorted) fingerprints, so
   two entries differing only in key order are duplicates — JSON-Schema deep-equality semantics.
3. **Pure-TS SHA-256 + UTF-8 in the contracts package** (no `node:crypto`, no `TextEncoder`):
   `@erp/contracts` is consumed by web/desktop/mobile (DEPENDENCY_RULES §3) and has no
   `@types/node`; a top-level `node:crypto` import would break browser bundling. The
   implementation is the standard FIPS 180-4 algorithm, cross-checked byte-for-byte against
   `node:crypto` in the tests (Arabic strings included). Canonical JSON can never contain lone
   surrogates (ES2019 well-formed `JSON.stringify`), so the UTF-8 encoder is exactly equivalent
   to TextEncoder for this input.
4. **`report_defaults[].dashboard` mirrored as optional** — §3's `"default": false` is a JSON-Schema
   annotation, not a validation constraint; the T5 apply service materializes it.
5. **`allow_negative_stock: z.literal(false, { error: … })`** with the governance message
   (templates may never enable negative stock; tenant-level exception only).
6. Registered the schema as contract `industry.template-manifest.v1` following the `tax/*`
   precedent; the pre-existing "registry starts empty" test still passes (its `beforeEach`
   resets import-time registrations).

## Cross-agent finding (NOT mine — needs an owner)

`pnpm test` at repo root currently fails **outside my scope**:

```
apps/api src/modules/identity/infrastructure/permissions-drift.spec.ts
  × current docs ↔ seed is drift-free (matrix §9.1 CI contract)
    expected [ 'industry.templates.manage', …(2) ] to deeply equal []
```

`apps/api/migrations/0004_permissions_seed.sql` (§3.8 industry templates, PHASE-015 — modified
2026-11-01 23:39, after my session began, by a concurrent agent) seeds
`industry.templates.manage`, `industry.templates.switch`, `industry.terminology.manage`, but
`docs/security/AUTHORIZATION_MATRIX.md` does not list them yet. The seed agent (T12/T4) and the
docs agent need to reconcile; I touched neither file. Everything else in the api suite passes
(152/153).

Pre-existing cosmetic note: `packages/contracts/src/navigation.ts` is not prettier-formatted
(mtime predates this task; prettier is not a gate step). Left untouched.

## Handoff notes for T4/T5 consumers

- `parseIndustryTemplateManifest(input)` throws `IndustryManifestValidationError` with
  `issues: readonly z.core.$ZodIssue[]` + `manifestId?` — use for registry publish-time
  fail-closed validation and the apply service.
- Store `hashManifestJson(manifest)` as `applied_manifest_hash`; recompute via
  `canonicalManifestJson()` for the drift-detection job (key-order independent).
- The 13 negative fixtures in `industry-manifests.test.ts` document the exact rejection paths
  for adversarial manifests (PHASE-015 §6 test hook "industry-manifests.spec").
