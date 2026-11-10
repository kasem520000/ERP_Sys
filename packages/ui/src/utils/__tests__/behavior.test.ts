/**
 * PHASE-005 component/unit behavior gates: money semantics (ADR-0009/§4),
 * bidi isolation, icon mirroring, status tone map, i18n-independent contracts,
 * navigation resolution (BR-039 derived-only), list-state encoding.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_STATUS_STYLE, DOCUMENT_TRANSITIONS } from "../status";
import { bidi, isolateLTR, FSI, LRI, PDI } from "../bidi";
import { DIRECTIONAL } from "../icons";
import {
  formatMoneyDisplay,
  moneyColorClass,
  moneySign,
  sanitizeMoneyInput,
  stripMoneyGrouping,
  currencyChipLabel,
} from "../money";
import { hijriCaption, isoFromYMD, monthGrid, presetRange, ymdFromIso } from "../dates";
import { resolveNavigation, NAV_GROUPS, NAV_ITEMS, type NavItem } from "@erp/contracts";

describe("money semantics (ADR-0009 + DESIGN_TOKENS §4)", () => {
  it("formats grouping on blur with fixed minor units", () => {
    expect(formatMoneyDisplay("12500", 2)).toBe("12,500.00");
    expect(formatMoneyDisplay("12500.5", 2)).toBe("12,500.50");
    expect(formatMoneyDisplay("-1250", 2)).toBe("-1,250.00");
    expect(formatMoneyDisplay("1250", 3)).toBe("1,250.000");
    expect(formatMoneyDisplay("1250", 0)).toBe("1,250");
  });
  it("sanitizes pasted junk to digits/dot/leading-minus only", () => {
    expect(sanitizeMoneyInput("1a2b3", 2)).toBe("123");
    expect(sanitizeMoneyInput("1-2-3", 2)).toBe("123");
    expect(sanitizeMoneyInput("-12.99", 2)).toBe("-12.99");
    expect(sanitizeMoneyInput("12..99", 2)).toBe("12.99");
    expect(sanitizeMoneyInput("1.234", 2)).toBe("1.23");
  });
  it("strips grouping for raw editing on focus", () => {
    expect(stripMoneyGrouping("12,500.00")).toBe("12500.00");
  });
  it("classifies sign BY VALUE — never by debit/credit context (§4)", () => {
    expect(moneySign("-1.00")).toBe("negative");
    expect(moneySign("0.00")).toBe("zero");
    expect(moneySign("42.10")).toBe("positive");
    expect(moneyColorClass("-5")).toBe("text-finance-negative");
    expect(moneyColorClass("0")).toBe("text-gray-600");
    expect(moneyColorClass("5")).toBe("");
  });
  it("renders the SAR chip as ISO + Arabic symbol", () => {
    expect(currencyChipLabel("SAR")).toBe("SAR ر.س");
  });
});

describe("bidi isolation (RTL_DESIGN_RULES §5)", () => {
  it("wraps LTR runs in LRI…PDI isolates", () => {
    expect(isolateLTR("INV-000123")).toBe(`${LRI}INV-000123${PDI}`);
  });
  it("builds logical-order mixed strings with isolated embeds", () => {
    const out = bidi([
      { text: "فاتورة " },
      { text: "INV-000123", isolate: "ltr" },
      { text: " من 2026-01-02" },
    ]);
    expect(out).toBe(`فاتورة ${LRI}INV-000123${PDI} من 2026-01-02`);
  });
  it("auto isolation uses FSI", () => {
    expect(bidi([{ text: "x", isolate: "auto" }])).toBe(`${FSI}x${PDI}`);
  });
});

describe("icon direction registry (RTL §4)", () => {
  it("keeps the verbatim DIRECTIONAL set", () => {
    expect(DIRECTIONAL.has("arrow-start")).toBe(true);
    expect(DIRECTIONAL.has("undo-2")).toBe(true);
    expect(DIRECTIONAL.has("panel-left")).toBe(true);
    // non-directional icons never mirror
    expect(DIRECTIONAL.has("barcode")).toBe(false);
    expect(DIRECTIONAL.has("qr-code")).toBe(false);
    expect(DIRECTIONAL.has("home")).toBe(false);
    expect(DIRECTIONAL.has("ledger")).toBe(false);
  });
});

describe("document lifecycle vocabulary (§6.4 fixed tone map)", () => {
  it("maps the 7 statuses to their binding tones", () => {
    expect(DOCUMENT_STATUS_STYLE.DRAFT.tone).toBe("info");
    expect(DOCUMENT_STATUS_STYLE.PENDING_APPROVAL.tone).toBe("warning");
    expect(DOCUMENT_STATUS_STYLE.APPROVED.tone).toBe("success-info");
    expect(DOCUMENT_STATUS_STYLE.POSTED.tone).toBe("success");
    expect(DOCUMENT_STATUS_STYLE.REVERSED.tone).toBe("danger");
    expect(DOCUMENT_STATUS_STYLE.CANCELLED.tone).toBe("neutral");
    expect(DOCUMENT_STATUS_STYLE.CANCELLED.strikethrough).toBe(true);
    expect(DOCUMENT_STATUS_STYLE.PENDING_SYNC.tone).toBe("info");
  });
  it("derives DocumentActions transitions from the same table (§2)", () => {
    expect(DOCUMENT_TRANSITIONS.DRAFT).toEqual(["submit", "approve", "cancel"]);
    expect(DOCUMENT_TRANSITIONS.PENDING_APPROVAL).toEqual(["approve", "reject", "cancel"]);
    expect(DOCUMENT_TRANSITIONS.APPROVED).toEqual(["post"]);
    expect(DOCUMENT_TRANSITIONS.POSTED).toEqual(["reverse"]);
    expect(DOCUMENT_TRANSITIONS.REVERSED).toEqual([]);
    expect(DOCUMENT_TRANSITIONS.PENDING_SYNC).toEqual([]);
  });
});

describe("date helpers (Gregorian canonical + Hijri display)", () => {
  it("round-trips ISO ↔ YMD canonically", () => {
    expect(ymdFromIso("2026-10-27")).toEqual({ year: 2026, month: 10, day: 27 });
    expect(ymdFromIso("2026-13-40")).toBeNull();
    expect(ymdFromIso("not-a-date")).toBeNull();
    expect(isoFromYMD({ year: 2026, month: 1, day: 5 })).toBe("2026-01-05");
  });
  it("month grid keeps 6×7 stable geometry with the week start first", () => {
    const cells = monthGrid({ year: 2026, month: 11, day: 1 }, true);
    expect(cells).toHaveLength(42);
    // Nov 1 2026 is a Sunday → the Saturday-first column begins at Oct 31
    expect(cells[0]?.ymd.day).toBe(31);
    const october = monthGrid({ year: 2026, month: 10, day: 1 }, true);
    expect(october[0]?.ymd.day).toBe(26); // Sep 26 is the first Saturday cell
  });
  it("renders Hijri captions via islamic-umalqura (display-only)", () => {
    const caption = hijriCaption(new Date(Date.UTC(2026, 9, 27)), "ar");
    expect(caption.length).toBeGreaterThan(0);
    expect(caption).not.toContain("2026");
  });
  it("preset ranges: this month / quarter / fiscal year", () => {
    const today = new Date(Date.UTC(2026, 9, 27));
    const month = presetRange("this-month", today);
    expect(isoFromYMD(month.start)).toBe("2026-10-01");
    expect(isoFromYMD(month.end)).toBe("2026-10-31");
    const quarter = presetRange("this-quarter", today);
    expect(isoFromYMD(quarter.start)).toBe("2026-10-01");
    expect(isoFromYMD(quarter.end)).toBe("2026-12-31");
    const fiscal = presetRange("fiscal-year", today, 1);
    expect(isoFromYMD(fiscal.start)).toBe("2026-01-01");
    expect(isoFromYMD(fiscal.end)).toBe("2026-12-31");
  });
});

describe("navigation resolution (NAVIGATION_MODEL §2 — server-only)", () => {
  const allKeys = new Set(NAV_ITEMS.map((i) => i.featureKey).filter((k): k is string => k !== undefined));
  const allPerms = new Set(NAV_ITEMS.map((i) => i.permission).filter((k): k is string => k !== undefined));

  it("renders everything when entitled and permitted, in binding group order", () => {
    const resolved = resolveNavigation(NAV_ITEMS, { featureKeys: allKeys, permissions: allPerms });
    // PHASE-008: the treasury group (الخزينة) went live; PHASE-009: the
    // reports group (التقارير) gained its first item (the VAT return);
    // PHASE-011: the purchasing group (المشتريات); PHASE-012: the sales
    // group (المبيعات); PHASE-029: the hr group (الموظفون والرواتب) —
    // the shipped-item set is now home, sales, purchasing, inventory,
    // accounting, treasury, reports, partners, settings, hr (binding
    // group order — hr ships last by NAVIGATION_MODEL §1).
    expect(resolved.groups.map((g) => g.id)).toEqual([
      "home",
      "sales",
      "purchasing",
      "inventory",
      "accounting",
      "treasury",
      "reports",
      "partners",
      "settings",
      "hr",
    ]);
    const order = NAV_GROUPS.map((g) => g.id);
    const indices = resolved.groups.map((g) => order.indexOf(g.id));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it("hides items the entitlement lacks (derived-only visibility)", () => {
    // platform.* console items are permission-gated (matrix §3.10) — the
    // entitlement gate is proven on the tenant-plane featureKey items.
    const noUsersRoles = new Set([...allKeys].filter((k) => k !== "platform.users_roles"));
    const resolved = resolveNavigation(NAV_ITEMS, { featureKeys: noUsersRoles, permissions: allPerms });
    expect(resolved.groups.flatMap((g) => g.items).some((i) => i.id === "settings.users")).toBe(false);
    expect(resolved.groups.flatMap((g) => g.items).some((i) => i.id === "settings.roles")).toBe(false);
  });

  it("hides items the permission lacks (404-opaque discipline)", () => {
    const noBranches = new Set([...allPerms].filter((p) => p !== "tenancy.branches.manage"));
    const resolved = resolveNavigation(NAV_ITEMS, { featureKeys: allKeys, permissions: noBranches });
    expect(resolved.groups.flatMap((g) => g.items).some((i) => i.id === "settings.branches")).toBe(false);
  });

  it("never renders an empty group", () => {
    const resolved = resolveNavigation(NAV_ITEMS, { featureKeys: new Set(), permissions: new Set() });
    // core items (no featureKey) still need their permission — with zero perms, most vanish
    for (const group of resolved.groups) expect(group.items.length).toBeGreaterThan(0);
  });

  it("collects g-prefix shortcuts into the registry", () => {
    const resolved = resolveNavigation(NAV_ITEMS, { featureKeys: allKeys, permissions: allPerms });
    expect(resolved.shortcuts["g h"]?.id).toBe("home.dashboard");
  });

  it("a fully-entitled future registry renders all 10 groups in binding order (structural proof)", () => {
    const synthetic: NavItem[] = [...NAV_ITEMS];
    for (const group of NAV_GROUPS) {
      if (group.id === "home" || group.id === "settings") continue;
      synthetic.push({
        id: `${group.id}.placeholder`,
        parentGroup: group.id,
        label: group.label,
        icon: group.icon,
        route: `/${group.id}`,
        featureKey: "platform.registration",
        branchScoped: false,
        archetype: "list-search",
        order: 10,
      });
    }
    const resolved = resolveNavigation(synthetic, {
      featureKeys: new Set(["platform.registration", ...allKeys]),
      permissions: allPerms,
    });
    expect(resolved.groups).toHaveLength(10);
    expect(resolved.groups.map((g) => g.id)).toEqual(NAV_GROUPS.map((g) => g.id));
  });
});
