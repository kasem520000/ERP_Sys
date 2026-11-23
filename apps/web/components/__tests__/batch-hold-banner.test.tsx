/**
 * PHASE-050 (W-29 — T-15) — the batch-hold banner's component tests (the
 * shared presentational piece — INV-035's register surfacing on every
 * batch-bearing host surface):
 *
 * - A NULL hold renders NOTHING (the additive law: a tenant without the
 *   quality entitlement degrades to no banners).
 * - The held batch renders the banner with the register's own reason
 *   VERBATIM + role="status" (a product state, never an error page).
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { getDictionary } from "../../i18n/dictionaries";
import type { BatchQualityHoldRow } from "../../lib/api-types";
import { BatchHoldBanner } from "../batch-hold-banner";

afterEach(() => {
  cleanup();
});

function hold(overrides: Partial<BatchQualityHoldRow> = {}): BatchQualityHoldRow {
  return {
    id: "hold-1",
    batchId: "batch-1",
    reason: "Oxidation found in the picking sample",
    ncrId: "ncr-1",
    status: "ACTIVE",
    heldAt: "2026-11-22T09:30:00Z",
    releasedAt: null,
    releaseNote: null,
    note: null,
    noteAr: null,
    createdBy: "user-1",
    createdAt: "2026-11-22T09:30:00Z",
    ...overrides,
  };
}

describe("PHASE-050 W-29 — the batch-hold banner", () => {
  it("(a) a null hold renders nothing (the additive law)", () => {
    const { container } = render(
      <BatchHoldBanner hold={null} locale="en" d={getDictionary("en")} />,
    );
    expect(container.textContent).toBe("");
  });

  it("(b) the held batch renders the banner with the reason VERBATIM + role=status", () => {
    render(<BatchHoldBanner hold={hold()} locale="en" d={getDictionary("en")} />);
    const banner = screen.getByRole("status");
    // The register's own reason, VERBATIM (never a summary).
    expect(banner.textContent).toContain("Oxidation found in the picking sample");
    // The engine's own stamp as-is (LTR-mono isolation).
    expect(banner.textContent).toContain("2026-11-22T09:30:00Z");
    // The NCR link (the register's own id).
    expect(banner.textContent).toContain("ncr-1");
    // The warning-tone product-state labels.
    expect(banner.textContent).toContain("An active quality hold sits on this batch");
  });

  it("(c) AR renders Arabic-first (the banner's own labels)", () => {
    render(<BatchHoldBanner hold={hold()} locale="ar" d={getDictionary("ar")} />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("حجز جودة ساري على هذه المجموعة");
    expect(banner.textContent).toContain("حُجزت في");
    expect(banner.textContent).toContain("حالة عدم المطابقة المرتبطة");
    // The engine's own reason + stamp stay VERBATIM in both locales.
    expect(banner.textContent).toContain("Oxidation found in the picking sample");
    expect(banner.textContent).toContain("2026-11-22T09:30:00Z");
  });
});
