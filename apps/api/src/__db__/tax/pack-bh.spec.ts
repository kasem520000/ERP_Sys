/**
 * PHASE-009 T12 — per-pack fixture suite: `BH` (compliance-matrix/bh.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "BH",
  vatStatus: "VAT_IN_FORCE",
  currentRate: "10.0000",
  currentFrom: "2022-01-01",
  priorWindow: { rate: "5.0000", from: "2019-01-01", to: "2021-12-31" },
  minorUnits: 3,
  currency: "BHD",
  rounding: { base: "25.5555", expectedTax: "2.556" },
});
