// PHASE-022 (DR-P22-01) — source-only Metro config for the Expo native
// workspace. The pnpm workspace never installs expo (apps/mobile/native is
// excluded), so this file deliberately imports NOTHING — EAS CI
// (mobile-release.yml, task 4-a) owns the real monorepo wiring:
// getDefaultConfig + watchFolders (repo root) + nodeModulesPaths so Metro can
// follow the pnpm layout and bundle @erp/mobile + @erp/contracts +
// @erp/domain-core + @erp/sync-core from the workspace. Kept here per the
// MASTER-PLAN §2 layout so the native dir has its bundler entry from day one.
export default {
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
};
