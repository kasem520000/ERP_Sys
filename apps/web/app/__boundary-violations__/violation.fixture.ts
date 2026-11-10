/**
 * DELIBERATE BOUNDARY VIOLATION — negative meta-test fixture (PHASE-001 §6).
 *
 * This file imports `apps/api` internals from the web app, which
 * docs/architecture/DEPENDENCY_RULES.md §3 forbids. The boundary lint MUST fail
 * on it; scripts/ci/negative-boundary-test.sh asserts exactly that (ESLint runs
 * with --no-ignore on this file). It is excluded from the normal lint run,
 * from typecheck, and from all builds, and it exports nothing used by the app.
 */
import { AppModule } from "../../../api/src/app.module";

export const boundaryViolation = AppModule;
