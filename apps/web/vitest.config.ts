import { defineConfig } from "vitest/config";

/**
 * PHASE-021 T2-b — the apps/web component-test stack (mirrors
 * packages/ui/vitest.config.ts: jsdom, css off, explicit vitest imports —
 * `globals: false`): covers the browser-safe shell layer
 * (lib/shell/__tests__), the offline components
 * (components/offline/__tests__), and the schema-parity guard at the
 * package root (__tests__/local-schema-parity.test.ts, a Node test that
 * imports `@erp/desktop` as a devDependency). The include glob covers
 * every nested suite directory.
 */
export default defineConfig({
  // apps/web's tsconfig uses Next's `jsx: "preserve"`; vitest's esbuild
  // needs an explicit transform — the automatic runtime matches packages/ui
  // (react-jsx): no `React` in scope required.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: false,
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    css: false,
  },
});
