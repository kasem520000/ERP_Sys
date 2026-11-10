/**
 * PHASE-009 T12 — per-pack fixture suite: `SA` (compliance-matrix/sa.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "SA",
  vatStatus: "VAT_IN_FORCE",
  currentRate: "15.0000",
  currentFrom: "2020-07-01",
  priorWindow: undefined,
  minorUnits: 2,
  currency: "SAR",
  rounding: { base: "123.45", expectedTax: "18.52" },
});
