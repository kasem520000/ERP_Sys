/**
 * PHASE-009 T12 — per-pack fixture suite: `QA` (compliance-matrix/qa.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "QA",
  vatStatus: "VAT_PLANNED",
  currentRate: undefined,
  currentFrom: undefined,
  priorWindow: undefined,
  minorUnits: 2,
  currency: "QAR",
  rounding: undefined,
});
