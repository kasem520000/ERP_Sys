/**
 * Token snapshot gate (PHASE-005 acceptance #1): every value in tokens.css /
 * tokens.ts byte-matches docs/ui/DESIGN_TOKENS.md. The expected table below is
 * transcribed from the doc — drift in either direction fails the suite.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as tokens from "../tokens";

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(join(here, "../../tokens/tokens.css"), "utf8");

/** DESIGN_TOKENS.md §1–§13 transcribed verbatim (the normative table). */
const EXPECTED: Record<string, string> = {
  // §1 brand primary (teal)
  "--erp-color-primary-50": "#F0FDFA",
  "--erp-color-primary-100": "#CCFBF1",
  "--erp-color-primary-200": "#99F6E4",
  "--erp-color-primary-300": "#5EEAD4",
  "--erp-color-primary-400": "#2DD4BF",
  "--erp-color-primary-500": "#14B8A6",
  "--erp-color-primary-600": "#0F766E",
  "--erp-color-primary-700": "#115E59",
  "--erp-color-primary-800": "#134E4A",
  "--erp-color-primary-900": "#042F2E",
  "--erp-color-primary-950": "#032726",
  // §2 neutrals
  "--erp-color-gray-50": "#F9FAFB",
  "--erp-color-gray-100": "#F3F4F6",
  "--erp-color-gray-200": "#E5E7EB",
  "--erp-color-gray-300": "#D1D5DB",
  "--erp-color-gray-400": "#9CA3AF",
  "--erp-color-gray-500": "#6B7280",
  "--erp-color-gray-600": "#4B5563",
  "--erp-color-gray-700": "#374151",
  "--erp-color-gray-800": "#1F2937",
  "--erp-color-gray-900": "#111827",
  "--erp-color-gray-950": "#030712",
  // §3 semantic states — solid anchors + badge tint pairs
  "--erp-color-success-700": "#15803D",
  "--erp-color-success-tint-bg": "#DCFCE7",
  "--erp-color-success-tint-text": "#166534",
  "--erp-color-success-tint-border": "#BBF7D0",
  "--erp-color-success-info-700": "#0E7490",
  "--erp-color-success-info-tint-bg": "#CFFAFE",
  "--erp-color-success-info-tint-text": "#155E75",
  "--erp-color-success-info-tint-border": "#A5F3FC",
  "--erp-color-warning-700": "#B45309",
  "--erp-color-warning-tint-bg": "#FEF3C7",
  "--erp-color-warning-tint-text": "#92400E",
  "--erp-color-warning-tint-border": "#FDE68A",
  "--erp-color-danger-700": "#B91C1C",
  "--erp-color-danger-tint-bg": "#FEE2E2",
  "--erp-color-danger-tint-text": "#991B1B",
  "--erp-color-danger-tint-border": "#FECACA",
  "--erp-color-info-700": "#1D4ED8",
  "--erp-color-info-tint-bg": "#DBEAFE",
  "--erp-color-info-tint-text": "#1E40AF",
  "--erp-color-info-tint-border": "#BFDBFE",
  // §4 financial sign semantics
  "--erp-color-finance-positive": "#15803D",
  "--erp-color-finance-negative": "#B91C1C",
  "--erp-color-finance-neutral": "inherit",
  // §5 surfaces, borders, elevation
  "--erp-surface-page": "#F9FAFB",
  "--erp-surface-card": "#FFFFFF",
  "--erp-surface-sunken": "#F3F4F6",
  "--erp-surface-overlay": "rgba(3, 7, 18, 0.45)",
  "--erp-surface-pos": "#032726",
  "--erp-surface-pos-raised": "#042F2E",
  "--erp-border-subtle": "#E5E7EB",
  "--erp-border-default": "#D1D5DB",
  "--erp-border-strong": "#9CA3AF",
  "--erp-shadow-e1": "0 1px 2px rgba(3, 7, 18, 0.06)",
  "--erp-shadow-e2": "0 2px 4px rgba(3, 7, 18, 0.07)",
  "--erp-shadow-e3": "0 4px 12px rgba(3, 7, 18, 0.10)",
  "--erp-shadow-e4": "0 8px 24px rgba(3, 7, 18, 0.14)",
  // §6 typography
  "--erp-font-ar": '"IBM Plex Sans Arabic", "Inter", system-ui, sans-serif',
  "--erp-font-latin": '"Inter", "IBM Plex Sans Arabic", system-ui, sans-serif',
  "--erp-font-mono": '"IBM Plex Mono", ui-monospace, monospace',
  "--erp-text-xs": "0.75rem",
  "--erp-text-sm": "0.8125rem",
  "--erp-text-base": "0.875rem",
  "--erp-text-md": "0.9375rem",
  "--erp-text-lg": "1.125rem",
  "--erp-text-xl": "1.375rem",
  "--erp-text-2xl": "1.75rem",
  "--erp-leading-tight": "1.2",
  "--erp-leading-normal": "1.45",
  "--erp-leading-relaxed": "1.7",
  // §7 spacing (4px grid)
  "--erp-space-0": "0px",
  "--erp-space-1": "4px",
  "--erp-space-2": "8px",
  "--erp-space-3": "12px",
  "--erp-space-4": "16px",
  "--erp-space-5": "20px",
  "--erp-space-6": "24px",
  "--erp-space-8": "32px",
  "--erp-space-12": "48px",
  "--erp-space-16": "64px",
  // §8 radii
  "--erp-radius-sm": "4px",
  "--erp-radius-md": "6px",
  "--erp-radius-lg": "8px",
  "--erp-radius-full": "9999px",
  // §10 z-index
  "--erp-z-base": "0",
  "--erp-z-raised": "10",
  "--erp-z-banner": "150",
  "--erp-z-dropdown": "1000",
  "--erp-z-drawer": "1100",
  "--erp-z-overlay": "1200",
  "--erp-z-dialog": "1300",
  "--erp-z-popover": "1400",
  "--erp-z-tooltip": "1500",
  "--erp-z-toast": "1600",
  // §11 focus ring
  "--erp-focus-ring": "#0F766E",
  "--erp-focus-ring-brand": "#99F6E4",
  "--erp-focus-ring-pos": "#5EEAD4",
  "--erp-focus-ring-danger": "#B91C1C",
  // §12 breakpoints
  "--erp-breakpoint-sm": "640px",
  "--erp-breakpoint-md": "768px",
  "--erp-breakpoint-lg": "1024px",
  "--erp-breakpoint-xl": "1280px",
  "--erp-breakpoint-2xl": "1536px",
  "--erp-width-journal-grid": "960px",
  // §13 motion
  "--erp-duration-instant": "0ms",
  "--erp-duration-fast": "120ms",
  "--erp-duration-base": "150ms",
  "--erp-ease-standard": "cubic-bezier(0.2, 0, 0, 1)",
  "--erp-ease-enter": "cubic-bezier(0, 0, 0.2, 1)",
  "--erp-ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
  // §6 numerals policy
  "--erp-numerals": "latin",
};

function parseCssCustomProps(css: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--erp-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) map.set(name, value.trim());
  }
  return map;
}

describe("token layer byte-matches DESIGN_TOKENS.md", () => {
  const css = parseCssCustomProps(tokensCss);

  it("tokens.css declares every documented token with the documented value", () => {
    const missing: string[] = [];
    const drifted: string[] = [];
    for (const [name, value] of Object.entries(EXPECTED)) {
      const actual = css.get(name);
      if (actual === undefined) missing.push(name);
      else if (actual !== value) drifted.push(`${name}: expected ${value}, got ${actual}`);
    }
    expect(missing, `missing tokens: ${missing.join(", ")}`).toEqual([]);
    expect(drifted, `drifted tokens:\n${drifted.join("\n")}`).toEqual([]);
  });

  it("tokens.css declares no undocumented --erp-* token (additions need a doc change first)", () => {
    const extras = [...css.keys()].filter((name) => !(name in EXPECTED));
    expect(extras).toEqual([]);
  });

  it("tokens.ts (the RN/charts mirror) matches tokens.css value-for-value", () => {
    const expectEqual = (cssName: string, actual: unknown): void => {
      expect(String(actual), `tokens.ts drift at ${cssName}`).toBe(css.get(cssName));
    };
    // §1/§2 palettes
    for (const stop of Object.keys(tokens.colors.primary) as unknown as Array<keyof typeof tokens.colors.primary>) {
      expectEqual(`--erp-color-primary-${stop}`, tokens.colors.primary[stop]);
    }
    for (const stop of Object.keys(tokens.colors.gray) as unknown as Array<keyof typeof tokens.colors.gray>) {
      expectEqual(`--erp-color-gray-${stop}`, tokens.colors.gray[stop]);
    }
    // §3 semantic pairs
    const semantic: Array<[string, Record<string, string>]> = [
      ["success", tokens.colors.success],
      ["success-info", tokens.colors.successInfo],
      ["warning", tokens.colors.warning],
      ["danger", tokens.colors.danger],
      ["info", tokens.colors.info],
    ];
    for (const [name, family] of semantic) {
      expectEqual(`--erp-color-${name}-700`, family.solid);
      expectEqual(`--erp-color-${name}-tint-bg`, family.tintBg);
      expectEqual(`--erp-color-${name}-tint-text`, family.tintText);
      expectEqual(`--erp-color-${name}-tint-border`, family.tintBorder);
    }
    // §4 finance
    expectEqual("--erp-color-finance-positive", tokens.colors.finance.positive);
    expectEqual("--erp-color-finance-negative", tokens.colors.finance.negative);
    // §5 surfaces/borders/shadows
    expectEqual("--erp-surface-page", tokens.surfaces.page);
    expectEqual("--erp-surface-card", tokens.surfaces.card);
    expectEqual("--erp-surface-sunken", tokens.surfaces.sunken);
    expectEqual("--erp-surface-overlay", tokens.surfaces.overlay);
    expectEqual("--erp-surface-pos", tokens.surfaces.pos);
    expectEqual("--erp-surface-pos-raised", tokens.surfaces.posRaised);
    expectEqual("--erp-border-subtle", tokens.borders.subtle);
    expectEqual("--erp-border-default", tokens.borders.default);
    expectEqual("--erp-border-strong", tokens.borders.strong);
    for (const [name, value] of Object.entries(tokens.shadows)) {
      expectEqual(`--erp-shadow-${name}`, value);
    }
    // §6 typography
    expectEqual("--erp-font-ar", tokens.fonts.ar.replace(/'/g, '"'));
    expectEqual("--erp-font-latin", tokens.fonts.latin.replace(/'/g, '"'));
    expectEqual("--erp-font-mono", tokens.fonts.mono.replace(/'/g, '"'));
    expectEqual("--erp-text-xs", tokens.text.xs);
    expectEqual("--erp-text-sm", tokens.text.sm);
    expectEqual("--erp-text-base", tokens.text.base);
    expectEqual("--erp-text-md", tokens.text.md);
    expectEqual("--erp-text-lg", tokens.text.lg);
    expectEqual("--erp-text-xl", tokens.text.xl);
    expectEqual("--erp-text-2xl", tokens.text.xl2);
    // §7 spacing
    for (const [stop, value] of Object.entries(tokens.spacing) as Array<[string, string]>) {
      expectEqual(`--erp-space-${stop}`, value);
    }
    // §8 radii
    expectEqual("--erp-radius-sm", tokens.radii.sm);
    expectEqual("--erp-radius-md", tokens.radii.md);
    expectEqual("--erp-radius-lg", tokens.radii.lg);
    expectEqual("--erp-radius-full", tokens.radii.full);
    // §10 z-index
    const zNames: Record<string, string> = {
      base: "base",
      raised: "raised",
      banner: "banner",
      dropdown: "dropdown",
      drawer: "drawer",
      overlay: "overlay",
      dialog: "dialog",
      popover: "popover",
      tooltip: "tooltip",
      toast: "toast",
    };
    for (const [tsKey, cssKey] of Object.entries(zNames) as Array<[keyof typeof tokens.z, string]>) {
      expectEqual(`--erp-z-${cssKey}`, tokens.z[tsKey]);
    }
    // §11 focus ring
    expectEqual("--erp-focus-ring", tokens.focusRing.light);
    expectEqual("--erp-focus-ring-brand", tokens.focusRing.brand);
    expectEqual("--erp-focus-ring-pos", tokens.focusRing.pos);
    expectEqual("--erp-focus-ring-danger", tokens.focusRing.invalid);
    // §13 motion
    expectEqual("--erp-duration-instant", tokens.motion.durationInstant);
    expectEqual("--erp-duration-fast", tokens.motion.durationFast);
    expectEqual("--erp-duration-base", tokens.motion.durationBase);
    expectEqual("--erp-ease-standard", tokens.motion.easeStandard);
    expectEqual("--erp-ease-enter", tokens.motion.easeEnter);
    expectEqual("--erp-ease-exit", tokens.motion.easeExit);
  });

  it("§9 density measurements match the documented compact/comfortable table", () => {
    expect(tokens.density.compact.rowHeight).toBe(32);
    expect(tokens.density.compact.controlHeight).toBe(32);
    expect(tokens.density.comfortable.rowHeight).toBe(40);
    expect(tokens.density.comfortable.controlHeight).toBe(40);
    expect(tokens.density.compact.cellPaddingY).toBe(6);
    expect(tokens.density.compact.cellPaddingX).toBe(12);
    expect(tokens.density.comfortable.cellPaddingY).toBe(10);
    expect(tokens.density.comfortable.cellPaddingX).toBe(16);
    expect(tokens.density.compact.cellFont).toBe("0.8125rem");
    expect(tokens.density.comfortable.cellFont).toBe("0.875rem");
  });
});
