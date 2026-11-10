/**
 * PHASE-022 · the i18n area barrel (MASTER-PLAN §2 layout: src/i18n —
 * dictionaries + runtime + digits + bidi). The package root (src/index.ts)
 * re-exports this module; the i18n modules import each other via RELATIVE
 * paths only, never through the root barrel (the constants leaf rule — a
 * module → root import would close a depcruise no-circular violation).
 */
export * from "./dictionaries";
export * from "./runtime";
export * from "./digits";
export * from "./bidi";
