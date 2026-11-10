/**
 * PHASE-003 docs-drift checker (thin CLI wrapper): permissions seed ↔
 * AUTHORIZATION_MATRIX §3. Library lives in the identity module
 * (typed, unit-tested, imported by the DB suite); this entry exists at the
 * documented path for CI and the local gate (PHASE-003 task table T2).
 */
import { main } from "../apps/api/src/modules/identity/infrastructure/permissions-drift";

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
