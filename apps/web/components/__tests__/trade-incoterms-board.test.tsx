/**
 * PHASE-051 (W-39 — T-14) — the Incoterms reference board's component
 * tests (the meters-board pattern: jsdom + the bffFetch mock):
 *
 * - THE ENGINE-OUTPUT LAW: the registry renders the row's OWN data
 *   VERBATIM (the code, the localized name, the five ownership axes'
 *   seller/buyer sides) and THE RISK-HINT MATRIX renders the API's own
 *   output VERBATIM (zero parallel computation — the active locale's
 *   side).
 * - THE TENANT-ADDITION ACT posts the exact body (BR-106's registry
 *   discipline: the tenant extends).
 * - D-16's documented accuracy disclaimer rides the page.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { TradeIncotermRow } from "../../lib/api-types";
import { TradeIncotermsBoard } from "../trade-incoterms-board";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const bffFetchMock = vi.mocked(bffFetch);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function incoterm(overrides: Partial<TradeIncotermRow> = {}): TradeIncotermRow {
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
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof TradeIncotermsBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <TradeIncotermsBoard
        locale={locale}
        initialIncoterms={[incoterm()]}
        incotermsError={null}
        canManage={true}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-051 W-39 — the Incoterms reference board", () => {
  it("(a) the registry renders the row's OWN data VERBATIM (the ownership axes' sides)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("CIF")).toBeTruthy();
    expect(within(grid).getByText("Cost, insurance and freight")).toBeTruthy();
    // The five ownership axes — the row's own booleans rendered as the
    // seller/buyer sides (the dictionary's own wording).
    expect(within(grid).getAllByText("Seller").length).toBe(3);
    expect(within(grid).getAllByText("Buyer").length).toBe(2);
  });

  it("(b) THE RISK-HINT MATRIX renders the API's own output VERBATIM (the active locale's side)", () => {
    renderBoard("en");
    const matrix = screen.getByRole("status");
    expect(matrix.textContent).toContain("CIF · Cost, insurance and freight");
    expect(matrix.textContent).toContain("Main carriage: the SELLER arranges it");
    expect(matrix.textContent).toContain("Import duty: the BUYER bears it");
    // The AR locale renders the AR side (Arabic-first parity).
    cleanup();
    renderBoard("ar");
    const arMatrix = screen.getByRole("status");
    expect(arMatrix.textContent).toContain("CIF · التكلفة والتأمين والشحن");
    expect(arMatrix.textContent).toContain("النقل الرئيسي: البائع يرتّبه");
    expect(arMatrix.textContent).toContain("رسوم الاستيراد: يتحمّلها المشتري");
  });

  it("(c) THE TENANT-ADDITION ACT posts the exact body", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "trade/incoterms" && init?.method === "POST") {
        return { ok: true, data: incoterm({ id: "incoterm-2", code: "DAP" }) };
      }
      if (path === "trade/incoterms") {
        return { ok: true, data: [incoterm()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.change(screen.getByLabelText(/Code \(2…8 uppercase\/digits\)/), { target: { value: "DAP" } });
    fireEvent.change(screen.getByLabelText(/Name \(English\)/), { target: { value: "Delivered at place" } });
    fireEvent.change(screen.getByLabelText(/Name \(Arabic\)/), { target: { value: "التسليم في المكان" } });
    fireEvent.click(screen.getByLabelText(/Carriage by seller\?/));
    fireEvent.click(screen.getByLabelText(/Import clearance by seller\?/));
    fireEvent.click(screen.getByLabelText(/Import duty by seller\?/));
    await waitFor(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Create" }).at(-1)!);
    });
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("trade/incoterms", {
        method: "POST",
        body: {
          code: "DAP",
          name: "Delivered at place",
          nameAr: "التسليم في المكان",
          carriageBySeller: true,
          insuranceBySeller: false,
          exportClearanceBySeller: false,
          importClearanceBySeller: true,
          importDutyBySeller: true,
        },
      });
    });
  });

  it("(d) D-16's documented accuracy disclaimer rides the page (the BR-055 family)", () => {
    renderBoard("en");
    expect(
      screen.getAllByText(
        /tenant-extensible seed data — the final classification's accuracy is the tenant's/,
      ).length,
    ).toBeGreaterThan(0);
  });
});

