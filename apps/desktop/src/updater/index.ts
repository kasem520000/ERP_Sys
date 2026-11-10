/**
 * PHASE-021 W1 · updater barrel (MASTER-PLAN §2): real minisign (Ed25519)
 * verification, the Tauri v2 manifest schema + cohort/version gates, the
 * check→verify→gate→download→verify→apply client state machine, and the
 * crash-free-gated staged-rollout service logic. Consumed by the W2 sync
 * host / shell UI and the deploy-side manifest service (W2-c).
 */

export * from "./minisign";
export * from "./manifest";
export * from "./client";
export * from "./rollout";
