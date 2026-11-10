/**
 * PHASE-022 T-P22-1b · the theme area barrel (MASTER-PLAN §2 layout:
 * src/theme — tokens.ts + theme.ts + primitives/). The package root
 * (src/index.ts) re-exports this module; the theme modules import each other
 * via RELATIVE paths only, never through the root barrel (the constants leaf
 * rule — a module → root import would close a depcruise no-circular
 * violation).
 */
export * from "./tokens";
export * from "./theme";
export * from "./primitives";
