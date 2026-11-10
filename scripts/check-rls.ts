/**
 * PHASE-002 CI checker CLI (thin wrapper): RLS presence + catalog drift.
 * Library lives in apps/api/src/infra/db/check-rls.ts (typed, unit-tested,
 * imported by the DB suite); this entry exists at the documented path for CI
 * and the local gate (PHASE-002 task table T4).
 */
import { main } from "../apps/api/src/infra/db/check-rls";

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
