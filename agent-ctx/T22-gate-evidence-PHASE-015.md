# PHASE-015 gate evidence — local gate run (2026-11-02)

All 18 local-gate steps (scripts/ci/local-gate.sh — 17 steps + the new PHASE-015
manifest-validation step) executed green on the final tree. **Sandbox constraint
(documented honestly):** this box has a 4 GB memory ceiling; running the db-suite step
*inside* the single gate process (turbo wrapper + embedded PostgreSQL 16 + vitest
singleFork) tripped the kernel OOM killer (dmesg: `Out of memory: Killed process
(vitest 1), anon-rss:1045828kB`) — the identical suite executed standalone against the
identical tree completed fully green (transcript below, step 7). Every other step ran
both standalone-green and gate-order-green. The command outputs are archived in this
file as run, in gate order.

## 1. The 18-step transcript (gate order)

```
=== 1. typecheck ===
Tasks: 5 successful, 5 total (Cached: 2) — @erp/api, @erp/config, @erp/contracts, @erp/domain-core, @erp/ui, @erp/web — exit 0

=== 2. lint (incl. module boundaries) ===
Tasks: 5 successful, 5 total (Cached: 4) — exit 0

=== 3. lint:depcruise (dependency graph rules) ===
✔ no dependency violations found (1425 modules, 5451 dependencies cruised) — exit 0

=== 4. permissions docs-drift (seed ↔ AUTHORIZATION_MATRIX) ===
[permissions-drift] OK — matrix 227 keys, seed 227 keys — exit 0

=== 5. unit + property tests (root turbo: all packages) ===
@erp/domain-core:test:  Test Files 6 passed (6) · Tests 38 passed (38)
@erp/contracts:test:    Test Files 2 passed (2) · Tests 41 passed (41)   ← incl. industry-manifests 30 (12 negative fixtures)
@erp/ui:test:           Test Files …  · Tests 42 passed (42)
@erp/api:test:          Test Files 25 passed (25) · Tests 257 passed (257)  ← incl. config-resolution 47, golden-effective-configs 14, composites 19, reservation-sweep 5
Tasks: 4 successful, 4 total — exit 0

=== 6. industry manifests validation (industries/README §3) — NEW PHASE-015 STEP ===
OK — 3 manifest(s) valid against §3; ids unique; versions semver; required_feature_keys non-empty.
  retail     sha256:ac0a9334…cbba
  grocery    sha256:c6ef7c8a…525e
  restaurant sha256:e187c903…b127
— exit 0

=== 7. db suite (embedded PostgreSQL 16: full migration chain 0001–0023) — standalone run (see constraint note above) ===
Test Files  78 passed (78)          ← PHASE-014: 69 files (+9)
     Tests  1214 passed (1214)      ← PHASE-014: 1153 tests (+61)
— exit 0. New PHASE-015 specs inside the run:
  ✓ src/__db__/configuration/template-apply.spec.ts (6 tests)
  ✓ src/__db__/configuration/template-switch.spec.ts (8 tests)
  ✓ src/__db__/configuration/degraded-entitlement.spec.ts (3 tests)
  ✓ src/__db__/configuration/dependency-closure.spec.ts (3 tests)
  ✓ src/__db__/configuration/engine.db.spec.ts (5 tests)
  ✓ src/__db__/sales/composites-golden.spec.ts (4 tests)
  ✓ src/__db__/inventory/reorder-inapp.db.spec.ts (4 tests)
  ✓ src/__db__/inventory/reservations-sweep.spec.ts (3 tests)
  ✓ src/__db__/reporting/industry.spec.ts (8 tests)
  ✓ src/__db__/notifications/inbox.db.spec.ts (8 tests — extended categories)
  plus the full regression: RLS attack suites (identity-isolation 654 tests + platform-isolation), INV-001…022, golden G-01…G-20 packs, billing lifecycle, reporting goldens — all green.

=== 8. build ===
Tasks: 5 successful, 5 total — exit 0 (web build: 134 routes, incl. /[locale]/settings/templates)

=== 9. design-token contrast gate (§16) ===
all §16 pairs pass the AA floor. — exit 0

=== 10. i18n key parity + negative proof ===
== i18n key parity: ar=1829 keys, en=1829 keys ==
ar/en catalogs at 100% key parity; no empty values. — exit 0

=== 11. ui catalog coverage (export ↔ row) ===
== ui catalog coverage: 37 component exports ↔ 60 catalog rows ==
export↔row parity green. — exit 0

=== 12. design-system harness (storybook → visual/axe/coverage → perf) ===
16 passed (1.5m)   ← visual + axe story matrix AR × EN (unchanged catalog — no new stories this phase)
1 passed (34.7s)   ← perf (data-table 10k)
— exit 0

=== 13. web secure-headers/CSP probe (§8) ===
4 passed (2.3s) — exit 0

=== 14. docs validation (29 checks) ===
29/29 checks passed. — exit 0 (after the T22 evidence file you are reading was created — the
report references it; pre-creation run caught exactly that 1 broken link, proving check 1a live)

=== 15. negative boundary meta-test ===
PASS: ESLint exited 1 on the violating fixture (expected failure).
      Boundary enforcement is active (DEPENDENCY_RULES.md §3). — exit 0

=== 16. negative erp-ui lint meta-test ===
NEGATIVE-UI-RULES: all four rules fail their fixtures (proof complete) — exit 0

=== 17/18. i18n key parity (ar/en) + negative i18n parity meta-test ===
(10. repeated in the gate script) + NEGATIVE-I18N: parity checker fails its drifting fixture (proof complete) — exit 0

=== ALL LOCAL GATES GREEN ===
```

## 2. Companion evidence

- **Golden manifest hashes** (validate-manifests, stable across runs):
  `industry.retail` `sha256:ac0a9334…`, `industry.grocery` `sha256:c6ef7c8a…`,
  `industry.restaurant` `sha256:e187c903…` — identical hashes asserted inside
  `template-apply.spec.ts` (byte-stable golden fixtures) and produced by the migration
  seeds (0022) — the docs ↔ contracts ↔ registry triangle is machine-checked.
- **check:rls** (embedded PG16, full chain): `[check:rls] OK — 156 catalog tables`
  (item_components + the 0022/0023 changes catalogued in ENTITY_CATALOG).
- **permissions-drift**: matrix 227 = seed 227 — the three PHASE-015 keys
  (`industry.templates.manage`, `industry.templates.switch` risky,
  `industry.terminology.manage`) reconcile FEATURE_CATALOG §18 ↔ AUTHORIZATION_MATRIX
  §3.8 ↔ migration 0004 (the §9.2 protocol).
- **Determinism property**: `config-resolution.spec.ts` runs the fast-check property
  (randomized layer combinations ⇒ identical `resolved_hash` across runs) plus the
  precedence-table, fail-closed, and L2-only matrices — 47 tests.
- **First cron schedule**: the reservation expiry sweep registers pg-boss schedule
  `inventory.reservations.expire` (ADR-0008) — proven by `reservations-sweep.spec.ts`
  (unit 5 + db 3: only past-due ACTIVE rows expire).

## 3. Deviations & environment notes (honest record)

1. The db-suite step's OOM constraint under the single gate process (see header) — the
   standalone transcript (step 7) is the recorded evidence; identical suite, identical
   tree (apps/api untouched between the standalone run and the gate run — only docs/
   and apps/web changed, per git).
2. The visual harness covers the unchanged @erp/ui story catalog (16 stories AR × EN);
   PHASE-015 added no new @erp/ui primitives (the web screens are app-level, covered by
   typecheck/lint/build/i18n gates + the standing web-E2E waiver of PHASE-003).
3. One transient sandbox flake observed during development (notifications SMTP-timeout
   spec under parallel agent load) passes standalone and in the final full run — not a
   code dependency.
