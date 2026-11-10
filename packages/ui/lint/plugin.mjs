/**
 * @erp/ui/lint — the four PHASE-005 design-system lint rules
 * (PHASE-005 §2 T2; DESIGN_SYSTEM §4; RTL_DESIGN_RULES §1/§4).
 *
 *   erp-ui/no-physical-direction  — physical direction utilities banned in
 *                                   packages/ui + shared/app components;
 *                                   sanctioned exception: `// rtl-exempt: reason`
 *                                   + both-direction visual tests.
 *   erp-ui/no-raw-radix           — raw @radix-ui imports allowed ONLY in
 *                                   packages/ui/src/primitives (the single
 *                                   legal Radix import site).
 *   erp-ui/no-raw-design-values   — hex/px literals banned outside the token
 *                                   layer (tokens/ is the ONLY raw-value site).
 *   erp-ui/import-path            — apps consume the @erp/ui surface only
 *                                   (exports map); deep src/ imports banned.
 *
 * Wired at the root eslint.config.mjs; negative proof:
 * scripts/ci/negative-ui-rules-test.sh lints the committed violating fixtures
 * with --no-ignore and asserts a non-zero exit (PHASE-001 meta-test pattern).
 */

/** Full banned list per RTL_DESIGN_RULES §1 (error severity from this phase).
 *  Token-level: variant prefixes (hover:, md:, data-[state=open]:) are stripped
 *  before matching, then these forms are physical (and therefore banned):
 *  pl-* pr-* ml-* mr-* text-left text-right border-l-* border-r-* left-* right-*
 */
const PHYSICAL_FORMS = [
  /^(pl|pr|ml|mr)(-\[[^]]*\]|-\d+(?:\.\d+)?%?)?$/,
  /^text-(left|right)$/,
  /^(border-l|border-r)(-\d+)?$/,
  /^(left|right)(-\[[^]]*\]|-\d+(?:\.\d+)?%?)?$/,
];

function isRtlExempt(context, node) {
  const source = context.sourceCode ?? context.getSourceCode();
  const line = node.loc?.start.line ?? source.getLine(node);
  // sanctioned exception: same-line or immediately-preceding `// rtl-exempt:` comment
  for (const offset of [0, -1]) {
    const text = source.lines[line - 1 + offset];
    if (text !== undefined && text.includes("// rtl-exempt:")) return true;
  }
  return false;
}

export const erpUiPlugin = {
  meta: { name: "@erp/ui/lint", version: "1.0.0" },
  rules: {
    "no-physical-direction": {
      meta: {
        type: "problem",
        docs: { description: "Forbid physical-direction utilities (RTL_DESIGN_RULES §1) — use logical start/end." },
        schema: [],
        messages: {
          physical:
            "Physical direction utility '{{match}}' is forbidden in design-system and shared component code. Use logical utilities (ms-/me-/ps-/pe-/text-start/text-end/start-*/end-*) or add a sanctioned `// rtl-exempt:` exception with both-direction visual tests.",
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const applies = filename.includes("packages/ui/src") || filename.includes("apps/web/components") || filename.includes("apps/web/app");
        if (!applies) return {};
        function check(node, value) {
          if (typeof value !== "string") return;
          const classes = value.split(/\s+/);
          for (const cls of classes) {
            if (cls === "") continue;
            const candidate = cls.replace(/^.*:/, ""); // strip variant prefixes (hover:, md:, data-…:)
            if (PHYSICAL_FORMS.some((form) => form.test(candidate)) && !isRtlExempt(context, node)) {
              context.report({ node, messageId: "physical", data: { match: cls } });
              return;
            }
          }
        }
        return {
          Literal: (node) => {
            if (typeof node.value === "string") check(node, node.value);
          },
          TemplateElement: (node) => check(node, node.value.raw),
          JSXAttribute: (node) => {
            if (node.name?.name === "className" && node.value?.type === "Literal") check(node.value, node.value.value);
          },
        };
      },
    },
    "no-raw-radix": {
      meta: {
        type: "problem",
        docs: { description: "Raw Radix imports are legal only inside packages/ui/src/primitives (DESIGN_SYSTEM §2)." },
        schema: [],
        messages: {
          rawRadix:
            "Raw '@radix-ui' import is forbidden outside packages/ui/src/primitives. Import the catalog component from '@erp/ui' instead (DESIGN_SYSTEM §4; the primitive layer is the only legal Radix site).",
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const inPrimitives = filename.includes("packages/ui/src/primitives");
        return {
          ImportDeclaration(node) {
            if (inPrimitives) return;
            const source = node.source?.value;
            if (typeof source === "string" && source.startsWith("@radix-ui/")) {
              context.report({ node, messageId: "rawRadix" });
            }
          },
        };
      },
    },
    "no-raw-design-values": {
      meta: {
        type: "problem",
        docs: { description: "No hex/px literals outside the token layer (DESIGN_TOKENS §17; tokens are the only raw values)." },
        schema: [],
        messages: {
          rawValue:
            "Raw design value '{{match}}' is forbidden outside packages/ui/src/tokens — read a token (CSS custom property / theme utility) instead. Value changes need the DESIGN_TOKENS governance path.",
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const inTokens =
          filename.includes("packages/ui/src/tokens") ||
          filename.includes("packages/ui/src/testing") ||
          // PHASE-013: print templates carry their own paper-color palette
          // (CMYK-safe print CSS) — values are part of the versioned template
          // artifact (PRINTING_AND_EXPORT §2), governed by template versioning
          // rather than the screen design tokens.
          filename.includes("packages/ui/print/") ||
          // harness fixtures (perf probes replicate grid geometry for
          // comparison — measurement rigs, not component styling)
          filename.includes("packages/ui/tests/") ||
          // PHASE-022 (DR-P22-02): apps/mobile/src/theme/tokens is the MOBILE
          // token layer — the RN mirror of the canonical export
          // (packages/ui/src/tokens). Raw values are legal there and ONLY
          // there (byte-parity-gated by scripts/check-mobile-tokens.ts); all
          // other mobile modules read tokens, exactly like packages/ui.
          filename.includes("apps/mobile/src/theme/tokens");
        const HEX = /#[0-9a-fA-F]{3,8}\b/;
        const PX = /(?<![\w-])(\d+(?:\.\d+)?)px(?![\w-])/;
        function check(node, value) {
          if (typeof value !== "string" || inTokens) return;
          const hex = HEX.exec(value);
          if (hex) {
            context.report({ node, messageId: "rawValue", data: { match: hex[0] } });
            return;
          }
          const px = PX.exec(value);
          if (px) context.report({ node, messageId: "rawValue", data: { match: px[0] } });
        }
        return {
          Literal: (node) => {
            if (typeof node.value === "string") check(node, node.value);
          },
          TemplateElement: (node) => check(node, node.value.raw),
        };
      },
    },
    "import-path": {
      meta: {
        type: "problem",
        docs: { description: "Apps consume the @erp/ui export surface only (DESIGN_SYSTEM §2 — no deep imports)." },
        schema: [],
        messages: {
          deepImport:
            "Deep import from '@erp/ui' ('{{source}}') is forbidden — import the public surface ('@erp/ui', '@erp/ui/print', '@erp/ui/tokens', '@erp/ui/tokens.css', '@erp/ui/theme.css', '@erp/ui/fonts.css', '@erp/ui/density.css', '@erp/ui/lint', '@erp/ui/fixtures').",
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const inUiPackage = filename.includes("packages/ui/");
        return {
          ImportDeclaration(node) {
            if (inUiPackage) return; // internal package code uses relative paths
            const source = node.source?.value;
            if (typeof source !== "string") return;
            if (
              /^@erp\/ui\/(src|components|primitives|utils|patterns)(\/|$)/.test(source) ||
              /^@erp\/ui\/print\//.test(source)
            ) {
              context.report({ node, messageId: "deepImport", data: { source } });
            }
          },
        };
      },
    },
  },
};

export default erpUiPlugin;
