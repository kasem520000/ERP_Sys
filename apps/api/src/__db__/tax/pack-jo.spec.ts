/**
 * PHASE-009 T12 — per-pack fixture suite: `JO` (compliance-matrix/jo.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "JO",
  vatStatus: "VAT_IN_FORCE",
  currentRate: "16.0000",
  currentFrom: "2018-01-01",
  priorWindow: undefined,
  minorUnits: 3,
  currency: "JOD",
  rounding: { base: "0.390625", expectedTax: "0.063" },
});
