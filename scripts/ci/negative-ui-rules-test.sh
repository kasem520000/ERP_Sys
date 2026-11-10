#!/usr/bin/env bash
# PHASE-005 T2 negative meta-test: each erp-ui lint rule MUST fail its
# committed violating fixture. Mirrors the PHASE-001 boundary meta-test:
# __ui-violations__/ is ignored by the normal lint run and linted here with
# --no-ignore; a zero exit from any fixture = the rule is dead = gate fails.
set -euo pipefail
cd "$(dirname "$0")/../.."

FIXTURE_UI="packages/ui/src/__ui-violations__/ui-rule-fixtures.tsx"
FIXTURE_APP="apps/web/app/__ui-violations__/app-rule-fixtures.ts"

fail() { printf 'NEGATIVE-UI-RULES: %s\n' "$1" >&2; exit 1; }

for fixture in "$FIXTURE_UI" "$FIXTURE_APP"; do
  [ -f "$fixture" ] || fail "missing fixture $fixture"
done

ui_out="$(pnpm exec eslint --no-ignore "$FIXTURE_UI" 2>&1)" && fail "ui fixture passed lint — a rule is not enforcing:\n$ui_out" || true
app_out="$(pnpm exec eslint --no-ignore "$FIXTURE_APP" 2>&1)" && fail "app fixture passed lint — import-path is not enforcing:\n$app_out" || true

# each rule must fire on its fixture
printf '%s' "$ui_out" | grep -q "erp-ui/no-physical-direction" || fail "no-physical-direction did not fire"
printf '%s' "$ui_out" | grep -q "erp-ui/no-raw-radix" || fail "no-raw-radix did not fire"
printf '%s' "$ui_out" | grep -q "erp-ui/no-raw-design-values" || fail "no-raw-design-values did not fire"
printf '%s' "$app_out" | grep -q "erp-ui/import-path" || fail "import-path did not fire"

printf 'NEGATIVE-UI-RULES: all four rules fail their fixtures (proof complete)\n'
