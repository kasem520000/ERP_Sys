/**
 * PHASE-009 T12 — per-pack fixture suite: `EG` (compliance-matrix/eg.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "EG",
  vatStatus: "VAT_IN_FORCE",
  currentRate: "14.0000",
  currentFrom: "2017-01-01",
  priorWindow: undefined,
  minorUnits: 2,
  currency: "EGP",
  rounding: { base: "100.05", expectedTax: "14.01" },
});
