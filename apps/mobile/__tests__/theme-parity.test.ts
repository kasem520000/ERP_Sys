/**
 * PHASE-022 T-P22-1b · the in-package token consistency suite (MASTER-PLAN
 * §4, DR-P22-02). The CROSS-PACKAGE byte-parity (mobile mirror vs the
 * canonical packages/ui export) lives ONLY in the root gate
 * `pnpm check:mobile-tokens` (scripts/check-mobile-tokens.ts) — a test file
 * under apps/mobile importing packages/ui would violate the depcruise
 * `mobile-imports-only-contracts-domain-core` boundary, so THIS suite
 * proves the mobile layer's INTERNAL consistency instead:
 *
 *   - the §3 status-badge map: complete over the six documented lifecycle
 *     states, every value a semantic family, every family used;
 *   - the §4 finance sign palette: byte-equal to the semantic solids and
 *     gray-600 for zero;
 *   - the §7 4px spacing grid + the RN numeric derivations (space/radius/
 *     typeScale/durations) parsed from the canonical-form strings;
 *   - the §5 elevation objects parsed from the canonical shadow strings;
 *   - the §6 numerals/type-scale table (px = rem × 16, weights, line
 *     heights) and the single-family RN font rule;
 *   - the §16 AA contrast floor on the mobile-relevant pairs (the same WCAG
 *     2.1 math as scripts/check-token-contrast.ts, reimplemented in-package
 *     because scripts/ is outside the mobile import boundary).
 */
import { describe, expect, it } from "vitest";

import {
  colors,
  durations,
  easings,
  elevation,
  financeSign,
  focusRing,
  focusRingGeometry,
  fontFamily,
  fonts,
  iconography,
  motion,
  radius,
  radii,
  shadows,
  space,
  spacing,
  statusBadge,
  surfaces,
  text,
  typeScale,
  type SemanticFamily,
} from "../src/theme/tokens";

// -- §3 — the document-status badge binding ------------------------------------

describe("theme tokens — §3 status-badge binding (DESIGN_TOKENS §3, binding)", () => {
  it("maps exactly the six documented lifecycle states", () => {
    expect(Object.fromEntries(Object.entries(statusBadge))).toEqual({
      DRAFT: "info",
      PENDING_APPROVAL: "warning",
      APPROVED: "successInfo",
      POSTED: "success",
      VOIDED: "danger",
      CANCELLED: "danger",
    });
  });

  it("every map value is a complete semantic family (solid + tint triple)", () => {
    const families: readonly SemanticFamily[] = ["success", "successInfo", "warning", "danger", "info"];
    for (const family of families) {
      const set = colors[family];
      expect(Object.keys(set).sort(), `${family} must be complete`).toEqual(["solid", "tintBg", "tintBorder", "tintText"]);
      for (const [key, value] of Object.entries(set)) {
        expect(value, `${family}.${key} must be a hex color`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("every semantic family is reachable from the map (no dead tone)", () => {
    const used = new Set(Object.values(statusBadge));
    for (const family of ["success", "successInfo", "warning", "danger", "info"] as const) {
      expect(used.has(family), `${family} unused by the status map`).toBe(true);
    }
  });
});

// -- §4 — finance sign semantics ------------------------------------------------

describe("theme tokens — §4 finance signs (binding)", () => {
  it("positive/negative are byte-equal to the canonical finance + semantic solid anchors", () => {
    expect(financeSign.positive).toBe(colors.finance.positive);
    expect(financeSign.positive).toBe(colors.success.solid);
    expect(financeSign.negative).toBe(colors.finance.negative);
    expect(financeSign.negative).toBe(colors.danger.solid);
  });

  it("zero renders gray-600 — the RN-usable neutral (canonical spells it 'inherit')", () => {
    expect(financeSign.neutral).toBe(colors.gray[600]);
    expect(colors.finance.neutral).toBe("inherit"); // the mirrored CSS keyword
  });
});

// -- §7/§8 — the 4px grid + RN numeric derivations -------------------------------

describe("theme tokens — spacing/radii derivations (the 4dp grid)", () => {
  it("spacing stays on the allowed 4px-grid stops", () => {
    const allowed = new Set([0, 1, 2, 3, 4, 5, 6, 8, 12, 16]);
    expect(Object.keys(spacing).map(Number).sort((a, b) => a - b)).toEqual([...allowed].sort((a, b) => a - b));
    for (const [stop, value] of Object.entries(spacing)) {
      expect(Number.parseInt(value, 10), `spacing.${stop} must be px`).toBe(stop === "0" ? 0 : Number(stop) * 4);
    }
  });

  it("space (RN numbers) derives from spacing (canonical strings), stop for stop", () => {
    expect(Object.keys(space)).toEqual(Object.keys(spacing));
    for (const [stop, value] of Object.entries(spacing)) {
      expect(space[stop as keyof typeof space], `space.${stop}`).toBe(Number.parseInt(value, 10));
    }
  });

  it("radius (RN numbers) derives from radii (canonical strings)", () => {
    expect(Object.keys(radius)).toEqual(Object.keys(radii));
    for (const [name, value] of Object.entries(radii)) {
      expect(radius[name as keyof typeof radius], `radius.${name}`).toBe(Number.parseInt(value, 10));
    }
    expect(radius.full).toBe(9999);
  });
});

// -- §6 — the type scale, weights, fonts ------------------------------------------

describe("theme tokens — §6 typography", () => {
  it("typeScale px = rem × 16 for every step, with the documented weights and line heights", () => {
    const expected: Record<string, { fontSize: number; fontWeight: string; lineHeight: number }> = {
      xs: { fontSize: 12, fontWeight: "400", lineHeight: 16 },
      sm: { fontSize: 13, fontWeight: "400", lineHeight: 20 },
      base: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
      md: { fontSize: 15, fontWeight: "500", lineHeight: 24 },
      lg: { fontSize: 18, fontWeight: "600", lineHeight: 28 },
      xl: { fontSize: 22, fontWeight: "600", lineHeight: 30 },
      xl2: { fontSize: 28, fontWeight: "700", lineHeight: 36 },
    };
    expect(Object.keys(typeScale)).toEqual(Object.keys(text));
    for (const [step, exp] of Object.entries(expected)) {
      expect(typeScale[step as keyof typeof typeScale], `typeScale.${step}`).toEqual(exp);
      expect(`${(exp.fontSize / 16).toFixed(4).replace(/0+$/, "")}rem`, `text.${step} rem form`).toBe(text[step as keyof typeof text]);
    }
  });

  it("fontFamily takes each canonical stack's FIRST family (RN single-family rule)", () => {
    for (const key of ["ar", "latin", "mono"] as const) {
      const firstFamily = fonts[key].split(",")[0]!.trim().replace(/^'|'$/g, "");
      expect(fontFamily[key], `fontFamily.${key}`).toBe(firstFamily);
    }
  });

  it("iconography: Lucide, stroke 1.5, sizes 16/20/24", () => {
    expect(iconography.library).toBe("lucide");
    expect(iconography.stroke).toBe(1.5);
    expect(iconography.sizes).toEqual({ table: 16, toolbar: 20, pos: 24 });
  });
});

// -- §5 — elevation objects parsed from the canonical shadow strings ----------------

describe("theme tokens — §5 elevation derivation", () => {
  it("each elevation object parses back out of its canonical box-shadow string", () => {
    const pattern = /^0 (\d+)px (\d+)px rgba\((\d+), (\d+), (\d+), (0\.\d+)\)$/;
    for (const [level, css] of Object.entries(shadows)) {
      const match = pattern.exec(css);
      expect(match, `shadows.${level} must be the canonical form`).not.toBeNull();
      const [, offsetY, blur, r, g, b, alpha] = match!;
      const shadow = elevation[level as keyof typeof elevation];
      expect(shadow.shadowOffset.height, `${level} offsetY`).toBe(Number(offsetY));
      expect(shadow.shadowOffset.width, `${level} offsetX`).toBe(0);
      expect(shadow.shadowRadius, `${level} blur`).toBe(Number(blur));
      expect(shadow.shadowOpacity, `${level} alpha`).toBe(Number(alpha));
      expect(shadow.elevation, `${level} elevation = offsetY`).toBe(Number(offsetY));
      // the rgba base must equal the gray-950 mirror value
      const expectedColor = `#${[r, g, b].map((channel) => Number(channel).toString(16).padStart(2, "0").toUpperCase()).join("")}`;
      expect(shadow.shadowColor, `${level} color = gray-950`).toBe(colors.gray[950]);
      expect(shadow.shadowColor).toBe(expectedColor);
    }
  });
});

// -- §11/§13 — focus ring geometry + motion derivations -----------------------------

describe("theme tokens — §11 focus ring + §13 motion", () => {
  it("focus ring geometry is 2dp solid at 2dp offset with the four context colors", () => {
    expect(focusRingGeometry).toEqual({ width: 2, offset: 2 });
    expect(focusRing).toEqual({ light: colors.primary[600], brand: colors.primary[200], pos: colors.primary[300], invalid: colors.danger.solid });
  });

  it("durations (RN ms) derive from motion (canonical ms strings)", () => {
    expect(durations.instant).toBe(Number.parseInt(motion.durationInstant, 10));
    expect(durations.fast).toBe(Number.parseInt(motion.durationFast, 10));
    expect(durations.base).toBe(Number.parseInt(motion.durationBase, 10));
    expect(durations.base).toBeLessThanOrEqual(150); // §13 absolute maximum
  });

  it("easings carry the canonical bezier control points", () => {
    expect([...easings.standard]).toEqual([0.2, 0, 0, 1]);
    expect([...easings.enter]).toEqual([0, 0, 0.2, 1]);
    expect([...easings.exit]).toEqual([0.4, 0, 1, 1]);
    expect(motion.easeStandard).toBe(`cubic-bezier(${[...easings.standard].join(", ")})`);
  });
});

// -- §16 — the AA contrast floor (mobile-relevant pairs) ------------------------------

/** WCAG 2.1 relative luminance + contrast ratio — the same math as
 *  scripts/check-token-contrast.ts (reimplemented in-package: scripts/ is
 *  outside the apps/mobile import boundary). */
function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channel = (raw: string): number => {
    const v = Number.parseInt(raw, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(clean.slice(0, 2)) + 0.7152 * channel(clean.slice(2, 4)) + 0.0722 * channel(clean.slice(4, 6));
}

function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

describe("theme tokens — §16 AA contrast floor", () => {
  const CARD = surfaces.card;
  const pairs: Array<[string, string, string]> = [
    ["gray-900 body on card", colors.gray[900], CARD],
    ["gray-600 secondary on card", colors.gray[600], CARD],
    ["primary-600 on card", colors.primary[600], CARD],
    ["success solid on card", colors.success.solid, CARD],
    ["successInfo solid on card", colors.successInfo.solid, CARD],
    ["warning solid on card", colors.warning.solid, CARD],
    ["danger solid on card", colors.danger.solid, CARD],
    ["info solid on card", colors.info.solid, CARD],
    ["card text on primary-600 (buttons)", CARD, colors.primary[600]],
    ["success tint pair", colors.success.tintText, colors.success.tintBg],
    ["successInfo tint pair", colors.successInfo.tintText, colors.successInfo.tintBg],
    ["warning tint pair", colors.warning.tintText, colors.warning.tintBg],
    ["danger tint pair", colors.danger.tintText, colors.danger.tintBg],
    ["info tint pair", colors.info.tintText, colors.info.tintBg],
    ["finance positive on card", financeSign.positive, CARD],
    ["finance negative on card", financeSign.negative, CARD],
  ];

  it("every meaningful text pair clears the 4.5:1 AA floor", () => {
    for (const [name, fg, bg] of pairs) {
      const ratio = contrastRatio(fg, bg);
      expect(ratio, `${name}: ${ratio}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gray-400 stays excluded from meaningful text (the §16 scoped exemption)", () => {
    expect(contrastRatio(colors.gray[400], CARD)).toBeLessThan(4.5);
    // ...and the theme's meaningful-TEXT slots never use it (borders may —
    // gray-400 IS the documented disabled-border/strong-border value, §2/§5):
    expect(financeSign.neutral).not.toBe(colors.gray[400]);
    for (const family of Object.values(statusBadge)) {
      const set = colors[family];
      expect(set.tintText).not.toBe(colors.gray[400]);
      expect(set.solid).not.toBe(colors.gray[400]);
    }
  });
});
