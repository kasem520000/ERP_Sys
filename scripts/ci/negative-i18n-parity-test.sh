#!/usr/bin/env bash
# PHASE-005 T8 negative proof: the parity checker MUST fail a deliberately
# drifting fixture (missing key in en + empty string in ar). Mirrors the
# PHASE-001 boundary meta-test pattern.
set -euo pipefail
cd "$(dirname "$0")/../.."

FIXTURE="scripts/ci/fixtures/i18n-drift-fixture.ts"
[ -f "$FIXTURE" ] || { printf 'NEGATIVE-I18N: missing fixture %s\n' "$FIXTURE" >&2; exit 1; }

out="$(pnpm exec tsx scripts/check-i18n-parity.ts "$FIXTURE" 2>&1)" && {
  printf 'NEGATIVE-I18N: checker passed a drifting fixture — the gate is dead\n' >&2
  exit 1
} || true

printf '%s' "$out" | grep -q "missing in en" || { printf 'NEGATIVE-I18N: missing-in-en drift not detected\n' >&2; exit 1; }
printf '%s' "$out" | grep -q "empty values" || { printf 'NEGATIVE-I18N: empty-value drift not detected\n' >&2; exit 1; }

printf 'NEGATIVE-I18N: parity checker fails its drifting fixture (proof complete)\n'
