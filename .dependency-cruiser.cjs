/**
 * Dependency rules for the ERP monorepo.
 * Source of truth: docs/architecture/DEPENDENCY_RULES.md
 *
 * Client rules (§3) are enforced from PHASE-001. API module-layer rules (§1) match
 * zero files while no module folders exist and activate mechanically as the
 * `apps/api/src/modules/<module>/{domain,application,infrastructure,api,presentation}`
 * folders appear in later phases — no config change is needed then.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "DEPENDENCY_RULES.md §2.1 — no cycles; cyclic needs move responsibility down.",
      from: {},
      to: { circular: true },
    },
    {
      name: "clients-never-import-api-internals",
      severity: "error",
      comment: "§3 — clients may never import apps/api internals.",
      from: { path: "^(apps/web|apps/desktop|apps/mobile)" },
      to: { path: "^apps/api" },
    },
    {
      name: "clients-never-import-other-clients",
      severity: "error",
      comment: "§3 — client apps do not import each other.",
      from: { path: "^apps/web" },
      to: { path: "^apps/(desktop|mobile)" },
    },
    {
      name: "desktop-never-imports-other-clients",
      severity: "error",
      from: { path: "^apps/desktop" },
      to: { path: "^apps/(web|mobile)" },
    },
    {
      name: "mobile-never-imports-other-clients",
      severity: "error",
      from: { path: "^apps/mobile" },
      to: { path: "^apps/(web|desktop)" },
    },
    {
      name: "api-never-imports-clients",
      severity: "error",
      comment:
        "§3 — production API code never imports client apps. PHASE-021 exception " +
        "(MASTER-PLAN §9, the desktop chaos profile; recorded by T-P21-4a): the DB-suite " +
        "harness apps/api/src/__db__/sync/desktop/** — which drives the REAL @erp/desktop " +
        "runtime (ReferenceDevice over the real SQLite file store, SIGKILL children, " +
        "D-01/D-02/D-04/D-06, C-08 signed updates) — may import apps/desktop through the " +
        "sanctioned workspace devDependency (the T-P21-3-a brief's ONE ownership-boundary " +
        "exception). PHASE-022 exception (MASTER-PLAN §9, the expo chaos profile; " +
        "T-P22-3a): apps/api/src/__db__/sync/expo/** joins it — the same harness shape " +
        "driving the REAL @erp/mobile runtime (mobile store on a temp SQLite file via " +
        "the node driver, C-01…C-16 + D-01/D-02/D-04 + fault profiles). Test " +
        "directories only; every production API path keeps the blanket ban.",
      // PHASE-021: the sanctioned desktop-chaos-profile harness dir (T-P21-3-a)
      // is the only apps/api surface allowed to reach @erp/desktop.
      // PHASE-022: the expo chaos profile harness dir (T-P22-3-a) may reach
      // @erp/mobile the same way.
      from: {
        path: "^apps/api",
        pathNot: [
          "^apps/api/src/__db__/sync/desktop/",
          "^apps/api/src/__db__/sync/expo/",
        ],
      },
      to: { path: "^apps/(web|desktop|mobile)" },
    },
    {
      name: "packages-never-import-apps",
      severity: "error",
      comment: "Packages are lower layers than apps.",
      from: { path: "^packages" },
      to: { path: "^apps" },
    },
    {
      name: "domain-core-imports-nothing-first-party",
      severity: "error",
      comment: "domain-core is the shared kernel: it imports no first-party code (§1).",
      from: { path: "^packages/domain-core" },
      to: { path: "^(apps|packages/(contracts|ui|config))" },
    },
    {
      name: "contracts-imports-nothing-first-party",
      severity: "error",
      comment: "contracts is the single source of API truth (ADR-0002 rule 1): standalone.",
      from: { path: "^packages/contracts" },
      to: { path: "^(apps|packages/(domain-core|ui|config))" },
    },
    {
      name: "ui-imports-only-contracts-domain-core",
      severity: "error",
      comment:
        "PHASE-005 (DEPENDENCY_RULES §3): packages/ui may depend on contracts " +
        "(nav payload types) + domain-core (Money types) ONLY — never on apps " +
        "or the config tooling package; data flows via props/headless hooks.",
      from: { path: "^packages/ui" },
      to: { path: "^(apps|packages/config)" },
    },
    {
      name: "web-imports-only-ui-contracts-domain-core",
      severity: "error",
      comment: "§3 — web: ui + contracts + domain-core only (config is tooling).",
      from: { path: "^apps/web" },
      to: { path: "^packages/config" },
    },
    {
      name: "desktop-imports-only-ui-contracts-domain-core",
      severity: "error",
      comment: "§3 — desktop: ui + contracts + domain-core only.",
      from: { path: "^apps/desktop" },
      to: { path: "^packages/config" },
    },
    {
      name: "mobile-imports-only-contracts-domain-core",
      severity: "error",
      comment: "§3 — mobile: contracts + domain-core only; React Native never imports packages/ui.",
      from: { path: "^apps/mobile" },
      to: { path: "^packages/(ui|config)" },
    },
    // -- PHASE-021 desktop shell rules (MASTER-PLAN §8; DR-P21-07) ---------------
    {
      name: "desktop-no-api",
      severity: "error",
      comment:
        "PHASE-021 §8 — apps/desktop/src (the @erp/desktop runtime) never reaches the API " +
        "app directly: the bridge http seam (shell-side reqwest) and the BFF are the only " +
        "client→server paths. Narrower than clients-never-import-api-internals (src only, " +
        "so __tests__ fixtures keep their own conventions).",
      from: { path: "^apps/desktop/src" },
      to: { path: "^(apps/api|@erp/api)" },
    },
    {
      name: "web-shell-no-server",
      severity: "error",
      comment:
        "DR-P21-07 — the exported desktop shell subset (apps/web/app/[locale]/offline/**, " +
        "apps/web/app/[locale]/unlock/**, apps/web/components/offline/**, " +
        "apps/web/lib/shell/**) must stay free of server-only dependencies: no " +
        "apps/web/lib/bff*, no apps/web/lib/server-api* (the two server-only helper " +
        "modules in apps/web/lib — the only next/headers / node:crypto consumers), no " +
        "next/headers, no server-only. The static export has no Next server to run them " +
        "on; browser mode degrades to ONLINE-ONLY affordances instead.",
      from: {
        path:
          "^apps/web/(app/\\[locale\\]/(offline|unlock)|components/offline|lib/shell)",
      },
      to: {
        path:
          "(^apps/web/lib/(bff|server-api))|(node_modules/(next/headers|server-only))|^(next/headers|server-only)$",
      },
    },
    {
      name: "desktop-no-web",
      severity: "error",
      comment:
        "PHASE-021 §8 — apps/desktop/src never imports apps/web internals: the DesktopBridge " +
        "contract types are duplicated client-side (apps/web/lib/shell re-declares them), " +
        "so the desktop runtime stays buildable without the web app.",
      from: { path: "^apps/desktop/src" },
      to: { path: "^apps/web" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    // PHASE-005: boundary fixtures (meta-tested) + built harness artifacts
    // (storybook output, baselines) are not source-graph subjects.
    exclude: "(__boundary-violations__|__ui-violations__|dist-storybook|__image_snapshots__|\.playwright-artifacts)",
  },
};
