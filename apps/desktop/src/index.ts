/**
 * PHASE-021 · the @erp/desktop public surface (MASTER-PLAN §1: the desktop
 * runtime is TypeScript, not Rust). W1 consolidation: the per-area barrels
 * (store/auth/updater/system/telemetry/print/bridge) re-export through here;
 * the W2 sync host appends its barrel. apps/web NEVER imports this package —
 * the bridge contract types are duplicated client-side in `lib/shell`
 * (MASTER-PLAN §8 depcruise rule `desktop-no-web`).
 */

// -- golden constants (MASTER-PLAN §0) -------------------------------------------

export * from "./constants";


// -- W1 area barrels (MASTER-PLAN §2 package layout) ------------------------------

export * from "./store";
export * from "./auth";
export * from "./updater";
export * from "./print";
export * from "./system/webview2";
export * from "./telemetry/crash";
export * from "./bridge/contract";
export * from "./sync";
