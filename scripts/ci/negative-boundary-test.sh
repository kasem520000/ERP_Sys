#!/usr/bin/env bash
# PHASE-001 negative meta-test (docs/implementation/phases/PHASE-001.md §6):
# a deliberately boundary-violating fixture MUST fail lint. CI asserts the
# failure; if lint ever accepts the violation, this script fails the pipeline.
set -euo pipefail
cd "$(dirname "$0")/../.."

FIXTURE="apps/web/app/__boundary-violations__/violation.fixture.ts"
if [[ ! -f "$FIXTURE" ]]; then
  echo "FAIL: fixture missing: ${FIXTURE}"
  exit 1
fi

echo "[negative-boundary-test] linting deliberate violation with --no-ignore..."
set +e
pnpm exec eslint --no-ignore --no-warn-ignored "${FIXTURE}"
status=$?
set -e

if [[ ${status} -eq 0 ]]; then
  echo "FAIL: ESLint accepted a forbidden cross-boundary import (web -> api)."
  echo "      Boundary enforcement is broken (eslint-plugin-boundaries misconfiguration?)."
  exit 1
fi

echo "PASS: ESLint exited ${status} on the violating fixture (expected failure)."
echo "      Boundary enforcement is active (DEPENDENCY_RULES.md §3)."
exit 0
