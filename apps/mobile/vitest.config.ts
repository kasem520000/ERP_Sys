import { defineConfig } from "vitest/config";
import { reactNativeBridge } from "./vitest.rn-bridge.mjs";

export default defineConfig({
  // PHASE-022 T-P22-1b: the react-native Flow bridge — a pre-transform that
  // answers every react-native / @react-native module vite asks about with a
  // passthrough into the Node CJS loader, where vitest.setup.rn.mjs has
  // installed the @react-native/babel-preset require-hook (the
  // T-P22-1a deviation 4 deferral, resolved — see vitest.rn-bridge.mjs).
  plugins: [reactNativeBridge()],
  esbuild: {
    // RN screens/primitives are .tsx — esbuild transforms JSX with the
    // automatic runtime (react/jsx-runtime), matching tsconfig's
    // "jsx": "react-jsx": test files never need a React import.
    jsx: "automatic",
  },
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    // RN globals + the Flow require-hook — before every test file.
    setupFiles: ["./vitest.setup.rn.mjs"],
    // Vitest maps server.deps.inline onto vite's ssr.noExternal: these two
    // anchored patterns make vite route react-native (and only react-native —
    // NOT @testing-library/react-native) through the transform pipeline,
    // where the bridge plugin answers with the passthrough. Without this,
    // the externalized path would `import()` react-native and Node's ESM
    // syntax detection would die on `import typeof` (the T-P22-1a finding).
    server: {
      deps: {
        inline: [/^react-native$/, /^@react-native\//],
      },
    },
    // PHASE-022 (the desktop vitest shape): real file-backed SQLite suites can
    // be slow on cold CI disks — generous per-test timeout, still far under the
    // §9 wall budgets (expo dir ≤ 10 min, whole sync suite ≤ 15 min).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
