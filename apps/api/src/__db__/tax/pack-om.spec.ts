/**
 * PHASE-009 T12 — per-pack fixture suite: `OM` (compliance-matrix/om.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "OM",
  vatStatus: "VAT_IN_FORCE",
  currentRate: "5.0000",
  currentFrom: "2021-04-01",
  priorWindow: undefined,
  minorUnits: 3,
  currency: "OMR",
  rounding: { base: "25.5555", expectedTax: "1.278" },
});
