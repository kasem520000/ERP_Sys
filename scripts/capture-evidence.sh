#!/usr/bin/env bash
#
# PHASE-047 W-2 — THE EVIDENCE-CAPTURE WRAPPER (the NF-3/NF-4 repair,
# 2026-11-18): every evidence log's exit stamp must read the RUN
# COMMAND'S OWN exit code — never the tee's.
#
# THE FINDING (the owner's W-1 verification, NF-4): both preserved RED
# logs (W-0 db-suite/chunk-02.log — "failed 1 | passed 481" — and W-1
# db-suite/chunk-01.log — "failed 1 | passed 2,070") carry a FALSE
# `VITEST_EXIT=0` stamp: the inline capture pipeline ran the command
# through `| tee` WITHOUT `set -o pipefail`, so `$?` read tee's 0 and
# the stamp lied about a red run. The NF-3 convention said "under set
# -o pipefail" but nothing enforced it at the capture site.
#
# THE FIX (structural, this script): a run command is piped through
# tee ONLY inside this wrapper, which (a) always runs under
# `set -o pipefail`, (b) reads the run command's own exit code from
# PIPESTATUS[0] (pipefail's per-segment truth — belt and suspenders
# for pipelines of more than two segments), and (c) stamps the label
# with THAT code. A future red run CANNOT stamp 0 through this
# wrapper: vitest exits 1 and the stamp says 1.
#
# Usage:
#   scripts/capture-evidence.sh <label> <log-file> <run-command> [args...]
#
#   label      VITEST_EXIT for vitest runs, EXIT for everything else
#              (the NF-3 convention's two stamp shapes)
#   log-file   the destination (created; parent dirs made as needed)
#
# The stamp line is the LAST line of the log: `<label>=<code>`.
# The wrapper exits with the run command's own code (never the tee's).

set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <VITEST_EXIT|EXIT> <log-file> <run-command> [args...]" >&2
  exit 64
fi

LABEL="$1"
LOG_FILE="$2"
shift 2

case "$LABEL" in
  VITEST_EXIT|EXIT) ;;
  *)
    echo "capture-evidence: label must be VITEST_EXIT or EXIT (got '$LABEL')" >&2
    exit 64
    ;;
esac

mkdir -p "$(dirname "$LOG_FILE")"

# Run the command, tee everything to the log, and keep the run
# command's OWN exit code. pipefail makes $? the pipeline's worst
# code; PIPESTATUS[0] is the run command's exact code even when a
# later segment (the tee) would otherwise mask it.
set +e
"$@" 2>&1 | tee "$LOG_FILE"
RUN_CODE="${PIPESTATUS[0]}"
set -e

# THE VITEST SUMMARY GUARD (2026-11-19, W-6 — the second NF-4-class
# repair, discovered honestly during this wave's reporting-folder
# run): vitest 3.2.7 under the DB config (forks pool + globalSetup)
# exits 0 on SUITE-LEVEL failures — a beforeAll crash reported as
# "Test Files  1 failed" leaves the process code at 0, so the exit
# stamp alone can lie about a red run exactly the way NF-4's tee
# masking did. The summary lines never lie: when the log's own
# vitest summary reports failures (or an Unhandled Error), the stamp
# is forced red regardless of the process code. The stamp is the
# MAX of the two truths — process code and summary verdict.
if [ "$LABEL" = "VITEST_EXIT" ] && [ "$RUN_CODE" -eq 0 ]; then
  if grep -qE "Test Files +[0-9]+ failed|Tests +[0-9]+ failed|Unhandled Error" "$LOG_FILE"; then
    RUN_CODE=1
  fi
fi

# The stamp: the run command's own exit code, as the last line.
echo "${LABEL}=${RUN_CODE}" | tee -a "$LOG_FILE" >/dev/null

exit "$RUN_CODE"
