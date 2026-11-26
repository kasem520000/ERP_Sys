/**
 * PHASE-051 (W-39 — T-14) — the Incoterm selector's component tests (the
 * shared piece embedded in the PO/SO create forms — D-17; acceptance #6's
 * selector surface arm):
 *
 * - THE RISK-HINT MATRIX renders at selection time VERBATIM — the API's
 *   own renderIncotermMatrix output (zero parallel computation; the AR
 *   side on the Arabic locale, the EN side on the English one).
 * - An EMPTY registry renders the bare select (the additive law: a
 *   tenant without the trade entitlement degrades to [] on its own 403
 *   — the PO/SO forms stand unaffected).
 * - BR-106's mandate hint rides the selector (the reading, never the
 *   enforcement — the gate is server-side at the order's own posting).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { TradeIncotermRow } from "../../lib/api-types";
import { IncotermSelector } from "../incoterm-selector";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
  if (!Element.prototype.setPointerCapture) {
    Object.defineProperty(Element.prototype, "setPointerCapture", { value: () => {}, writable: true, configurable: true });
  }
  if (!Element.prototype.releasePointerCapture) {
    Object.defineProperty(Element.prototype, "releasePointerCapture", { value: () => {}, writable: true, configurable: true });
  }
});

afterEach(() => {
  cleanup();
});

/** The registry row WITH the matrix hints (the API's own output — the
 * five ownership axes rendered AR/EN from the row's OWN data). */
function incoterm(): TradeIncotermRow {
  return {
    id: "incoterm-1",
    code: "CIF",
    name: "Cost, insurance and freight",
    nameAr: "التكلفة والتأمين والشحن",
    carriageBySeller: true,
    insuranceBySeller: true,
    exportClearanceBySeller: true,
    importClearanceBySeller: false,
    importDutyBySeller: false,
    isActive: true,
    note: null,
    noteAr: null,
    matrix: {
      en: [
        "Main carriage: the SELLER arranges it",
        "Insurance: the SELLER procures it",
        "Export clearance: the SELLER's obligation",
        "Import clearance: the BUYER's obligation",
        "Import duty: the BUYER bears it",
      ],
      ar: [
        "النقل الرئيسي: البائع يرتّبه",
        "التأمين: البائع يوفّره",
        "تخليص التصدير: التزام البائع",
        "تخليص الاستيراد: التزام المشتري",
        "رسوم الاستيراد: يتحمّلها المشتري",
      ],
    },
    createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
  };
}

function renderSelector(
  locale: "ar" | "en",
  incoterms: readonly TradeIncotermRow[],
  value: string,
  onValueChange: (code: string) => void = () => {},
) {
  return render(
    <IncotermSelector locale={locale} incoterms={incoterms} value={value} onValueChange={onValueChange} />,
  );
}

describe("PHASE-051 W-39 — the Incoterm selector (the PO/SO forms' embedded piece)", () => {
  it("(a) THE RISK-HINT MATRIX renders at selection time VERBATIM (the API's own output, EN locale)", () => {
    renderSelector("en", [incoterm()], "CIF");
    const matrix = screen.getByRole("status");
    // The API's own EN lines, byte-for-byte (zero parallel computation).
    expect(matrix.textContent).toContain("Ownership matrix — CIF");
    expect(matrix.textContent).toContain("Main carriage: the SELLER arranges it");
    expect(matrix.textContent).toContain("Insurance: the SELLER procures it");
    expect(matrix.textContent).toContain("Export clearance: the SELLER's obligation");
    expect(matrix.textContent).toContain("Import clearance: the BUYER's obligation");
    expect(matrix.textContent).toContain("Import duty: the BUYER bears it");
  });

  it("(b) the AR locale renders the matrix's AR side (Arabic-first, the same output VERBATIM)", () => {
    renderSelector("ar", [incoterm()], "CIF");
    const matrix = screen.getByRole("status");
    expect(matrix.textContent).toContain("مصفوفة الملكية — CIF");
    expect(matrix.textContent).toContain("النقل الرئيسي: البائع يرتّبه");
    expect(matrix.textContent).toContain("تخليص الاستيراد: التزام المشتري");
    expect(matrix.textContent).toContain("رسوم الاستيراد: يتحمّلها المشتري");
  });

  it("(c) no selection — no matrix (the matrix renders at selection time only)", () => {
    const { queryByRole } = renderSelector("en", [incoterm()], "");
    expect(queryByRole("status")).toBeNull();
    // BR-106's mandate hint rides the selector either way (the reading,
    // never the enforcement — the gate is server-side at the posting).
    expect(screen.getByText(/Orders in a non-base currency or carrying the import\/export marker require an incoterm at posting/)).toBeTruthy();
  });

  it("(d) an empty registry renders the bare select (the additive law — 403 degrades to [])", () => {
    const { queryByRole, container } = renderSelector("en", [], "");
    expect(queryByRole("status")).toBeNull();
    // The select itself stands (the placeholder option).
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("(e) the selection flows to the host (the code string, the registry's own identity)", () => {
    let picked = "";
    renderSelector("en", [incoterm()], "", (code) => {
      picked = code;
    });
    const trigger = screen.getByLabelText(/Incoterm/);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const option = screen.getByRole("option", { name: "CIF · Cost, insurance and freight" });
    fireEvent.click(option);
    expect(picked).toBe("CIF");
  });
});
