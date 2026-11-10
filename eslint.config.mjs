// Root ESLint entry point. The shared, source-of-truth config lives in
// packages/config/eslint (per ADR-0002 "shared eslint config" rule).
// PHASE-005 wires the @erp/ui design-system rules (packages/ui/lint) on top:
// no-physical-direction (full banned list + rtl-exempt protocol),
// no-raw-radix, no-raw-design-values, import-path.
import { createEslintConfig } from "./packages/config/eslint/index.mjs";
import { erpUiPlugin } from "./packages/ui/lint/plugin.mjs";

export default createEslintConfig({
  extraPlugins: { "erp-ui": erpUiPlugin },
  extraRules: {
    "erp-ui/no-physical-direction": "error",
    "erp-ui/no-raw-radix": "error",
    "erp-ui/no-raw-design-values": "error",
    "erp-ui/import-path": "error",
  },
});
