/**
 * PHASE-009 T12 — per-pack fixture suite: `KW` (compliance-matrix/kw.md).
 * The scenario classes execute through the shared pack runner; every
 * expected rate/window comes from the seeded pack (the compliance-matrix
 * facts — REQUIRES_VERIFICATION provenance, directive §1.12–1.13).
 */
import { runPackFixtureSuite } from "./pack-scenarios";

runPackFixtureSuite({
  country: "KW",
  vatStatus: "NO_VAT",
  currentRate: undefined,
  currentFrom: undefined,
  priorWindow: undefined,
  minorUnits: 3,
  currency: "KWD",
  rounding: undefined,
});
