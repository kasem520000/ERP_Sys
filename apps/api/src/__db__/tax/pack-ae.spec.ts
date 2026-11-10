/**
 * PHASE-009 T12 — per-pack fixture suite: `AE` (compliance-matrix/ae.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "AE",
  vatStatus: "VAT_IN_FORCE",
  currentRate: "5.0000",
  currentFrom: "2018-01-01",
  priorWindow: undefined,
  minorUnits: 2,
  currency: "AED",
  rounding: { base: "123.45", expectedTax: "6.17" },
});
