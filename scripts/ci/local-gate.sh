#!/usr/bin/env bash
# Local CI-equivalent gate (mirrors .github/workflows/ci.yml + ci-db.yml jobs;
# gitleaks runs in CI only — a local binary dependency is not imposed).
set -euo pipefail
cd "$(dirname "$0")/../.."

run() {
  printf '\n=== %s ===\n' "$1"
  shift
  "$@"
}

run "typecheck" pnpm typecheck
run "lint (incl. module boundaries)" pnpm lint
run "lint:depcruise (dependency graph rules)" pnpm lint:depcruise
run "permissions docs-drift (seed ↔ AUTHORIZATION_MATRIX)" pnpm check:permissions-drift
run "unit + property tests" pnpm test
run "industry manifests validation (industries/README §3)" pnpm validate:manifests
run "db suite (embedded PostgreSQL 16: RLS attacks, identity flows, jobs, files, readiness)" pnpm test:db
run "build" pnpm build
run "design-token contrast gate (§16)" pnpm check:token-contrast
run "i18n key parity + negative proof" pnpm check:i18n-parity
run "ui catalog coverage (export ↔ row)" pnpm check:ui-catalog
run "design-system harness (storybook → visual/axe/coverage → perf)" pnpm test:visual-harness-run
run "web secure-headers/CSP probe (§8)" pnpm test:web-security
run "docs validation (29 checks)" pnpm docs:validate
run "negative boundary meta-test" pnpm boundary:negative-test
run "negative erp-ui lint meta-test" bash scripts/ci/negative-ui-rules-test.sh
run "i18n key parity (ar/en)" pnpm check:i18n-parity
run "negative i18n parity meta-test" pnpm boundary:negative-i18n-test

printf '\n=== ALL LOCAL GATES GREEN ===\n'
