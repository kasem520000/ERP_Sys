/**
 * PHASE-022 · the @erp/mobile public surface (MASTER-PLAN §1 DR-P22-01: ALL
 * application logic is pure TS under src/**, rendered by RN screens that
 * import only react/react-native + this package's internals, hosted by the
 * thin Expo glue dir in native/). The per-area barrels append here as their
 * waves land.
 */

// -- golden constants (MASTER-PLAN §0) -------------------------------------------

// ZERO-IMPORT leaf: imported by area modules via "./constants" /
// "../constants", never through this barrel (depcruise no-circular).
export * from "./constants";

// PHASE-022 T-P22-3-b: exact decimal math (ADR-0009 — the READ-CACHED
// view-models + the §3 executors' recompute; ZERO-IMPORT leaf too).

export * from "./exact-decimal";

// -- i18n: dictionaries + runtime + digits + bidi (MASTER-PLAN §5, DR-P22-04) ----

export * from "./i18n";

// -- theme: token mirror + Theme aggregator + primitives (MASTER-PLAN §4, DR-P22-02) --

export * from "./theme";

// -- store: driver port + Node driver + migrations + store + prune + corruption (§7, DR-P22-08/08b) --

export * from "./store";

// -- sync: HTTP port + transport + host + triggers + revocation (§7, DR-P22-08) --

export * from "./sync";

// -- auth: secure-store + crypto ports, enroll, memory session, refresh rotation, unlock (§7, DR-P22-09) --

export * from "./auth";

// -- device: trust plane + watermark policy + registration orchestrator + secure screen (§7, DR-P22-09) --

export * from "./device";

// -- fieldsales: the flow state machines + LOCAL-VALID† pre-validation + the device ports (§8, T-P22-2-e) --

export * from "./fieldsales";

// -- companion: the READ-CACHED† dashboards/statements/invoice views + the ONLINE-ONLY approvals affordance + master-data search (§8, T-P22-3-b) --

export * from "./companion";

// -- personal: the READ-ONLY personal-account view-models (§8, T-P22-3-b) --

export * from "./personal";

// -- reconciliation: the parked-rejection surface — the FULL CONFLICT_RESOLUTION §3 table (§8, T-P22-3-b) --

export * from "./reconciliation";

// -- screens: the RN screens + the navigation registry (§1 DR-P22-11, T-P22-2-e) --

export * from "./screens";

// -- release: the minimum-version policy + the staged-rollout gates (§10, DR-P22-10, T-P22-4-a) --

export * from "./release";
