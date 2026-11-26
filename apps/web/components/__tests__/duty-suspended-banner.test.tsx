/**
 * PHASE-051 (W-39 — T-14) — the duty-suspended banner's component tests
 * (the shared presentational piece — G-66's bonded register surfacing on
 * every bonded-bearing inventory host surface, D-17):
 *
 * - A NULL move renders NOTHING (the additive law: a tenant without the
 *   trade entitlement degrades to no banners).
 * - The suspended item renders the banner with the register's own figures
 *   VERBATIM (the moveNo, the line's own quantity under bond, the
 *   executedAt stamp) + role="status" (a product state, never an error
 *   page) — NEVER a recomputed suspended balance (the engine's bond
 *   ledger owns that figure).
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getDictionary } from "../../i18n/dictionaries";
import type { TradeBondedMoveRow } from "../../lib/api-types";
import { DutySuspendedBanner, DutySuspendedChip } from "../duty-suspended-banner";

afterEach(() => {
  cleanup();
});

/** The bonded register's own row (the EXECUTED IN_BOND move — G-66's
 * register; the lines carry the item's own quantity under bond). */
function move(overrides: Partial<TradeBondedMoveRow> = {}): TradeBondedMoveRow {
  return {
    id: "bonded-1",
    moveNo: "BM-2026-000003",
    moveKind: "IN_BOND",
    fromWarehouseId: null,
    toWarehouseId: "wh-1",
    declarationId: "decl-1",
    lines: [{ itemId: "item-1", qty: "500.000000" }],
    status: "EXECUTED",
    executedAt: "2026-11-24T11:15:00Z",
    dutyAmount: null,
    releaseRecognizedAt: null,
    releaseJournalEntryId: null,
    note: null,
    noteAr: null,
    createdAt: "2026-11-24T11:00:00Z",
    updatedAt: "2026-11-24T11:15:00Z",
    ...overrides,
  };
}

describe("PHASE-051 W-39 — the duty-suspended banner", () => {
  it("(a) a null move renders nothing (the additive law — 403 degrades to no banners)", () => {
    const { container } = render(
      <DutySuspendedBanner move={null} qty={null} locale="en" d={getDictionary("en")} />,
    );
    expect(container.textContent).toBe("");
  });

  it("(b) the suspended item renders the register's own figures VERBATIM + role=status", () => {
    render(
      <DutySuspendedBanner
        move={move()}
        qty="500.000000"
        locale="en"
        d={getDictionary("en")}
      />,
    );
    const banner = screen.getByRole("status");
    // The register's own moveNo, VERBATIM (never a summary).
    expect(banner.textContent).toContain("BM-2026-000003");
    // The line's own quantity under bond — the ENGINE'S string as-is (the
    // host hands the move line's own figure; never a client-side sum and
    // never a recomputed suspended balance).
    expect(banner.textContent).toContain("500.000000");
    // The engine's own executed stamp as-is (LTR-mono isolation).
    expect(banner.textContent).toContain("2026-11-24T11:15:00Z");
    // The warning-tone product-state title (G-66's own wording).
    expect(banner.textContent).toContain(
      "Duty-suspended stock under bond — customer issue is refused while suspended (G-66)",
    );
  });

  it("(c) AR renders Arabic-first (the banner's own labels; the figures stay VERBATIM)", () => {
    render(
      <DutySuspendedBanner move={move()} qty="500.000000" locale="ar" d={getDictionary("ar")} />,
    );
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain(
      "مخزون معلَّق تحت السند — يُمنع الصرف للعملاء ما دام معلَّقًا (G-66)",
    );
    expect(banner.textContent).toContain("حركة السند");
    expect(banner.textContent).toContain("الكمية تحت السند");
    // The register's own figures stay VERBATIM in both locales.
    expect(banner.textContent).toContain("BM-2026-000003");
    expect(banner.textContent).toContain("500.000000");
    expect(banner.textContent).toContain("2026-11-24T11:15:00Z");
  });

  it("(d) the row-level chip (the lean host wiring — the stock rows badge suspended items)", () => {
    const { container } = render(<DutySuspendedChip label="Duty-suspended" />);
    const chip = container.querySelector("span");
    expect(chip?.textContent).toBe("Duty-suspended");
  });
});
