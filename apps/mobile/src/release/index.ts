/**
 * PHASE-022 T-P22-4-a · the release area barrel (MASTER-PLAN §2 layout:
 * src/release/ — DR-P22-10): the client-side release policy (minimum-version
 * force-update) + the staged-rollout gate calculator. Pure TS on Node — the
 * force-update SCREEN consumer and the CI manifest live elsewhere (the
 * navigation glue TODO in native/App.tsx; .github/workflows/
 * mobile-release.yml).
 */
export * from "./release-policy";
export * from "./rollout";
