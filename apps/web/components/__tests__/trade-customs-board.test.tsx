/**
 * PHASE-051 (W-39 — T-14) — the customs board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the declarations register renders the engine's
 *   own shapes VERBATIM (the declarationNo/type/office/status/currency —
 *   the row's own strings, the localized ladder chip).
 * - THE CREATE ACT posts the exact body (the lines editor's own shape).
 * - THE DETAIL CHAIN: the find's own output — the lines + THE FOLD'S
 *   TOTALS rendered from the LINES at every read (never a stored
 *   parallel figure).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { TradeDeclarationRow, TradeHsCodeRow } from "../../lib/api-types";
import { TradeCustomsBoard } from "../trade-customs-board";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const bffFetchMock = vi.mocked(bffFetch);

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
  vi.clearAllMocks();
});

function declaration(overrides: Partial<TradeDeclarationRow> = {}): TradeDeclarationRow {
  return {
    id: "decl-1",
    declarationNo: "CD-2026-000019",
    declarationType: "IMPORT",
    customsOffice: "Jeddah Customs",
    status: "ACCEPTED",
    submittedAt: "2026-11-24T08:00:00Z",
    acceptedAt: "2026-11-24T12:00:00Z",
    completedAt: null,
    receiptId: null,
    purchaseOrderId: "po-1",
    billOfLadingId: "bl-1",
    shipmentStatus: "ARRIVED",
    currency: "SAR",
    landedCostId: null,
    landedCostNo: null,
    note: null,
    noteAr: null,
    createdAt: "2026-11-24T08:00:00Z",
    updatedAt: "2026-11-24T12:00:00Z",
    ...overrides,
  };
}

const HS: readonly TradeHsCodeRow[] = [
  {
    id: "hs-1",
    hsCode: "7209160000",
    name: "Flat-rolled steel, cold rolled",
    nameAr: "فولاذ مسطّح مدرفل على البارد",
    isActive: true,
    note: null,
    noteAr: null,
    createdAt: "2026-11-24T00:00:00Z",
  },
];

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof TradeCustomsBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <TradeCustomsBoard
        locale={locale}
        initialDeclarations={[declaration()]}
        declarationsError={null}
        initialHs={HS}
        hsError={null}
        canManage={true}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-051 W-39 — the customs board", () => {
  it("(a) the declarations register renders the engine's own shapes VERBATIM", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("CD-2026-000019")).toBeTruthy();
    expect(within(grid).getByText("Jeddah Customs")).toBeTruthy();
    expect(within(grid).getByText("SAR")).toBeTruthy();
    // The ladder's chip + the type chip (the dictionary's own wording).
    expect(within(grid).getByText("Accepted")).toBeTruthy();
    expect(within(grid).getByText("Import")).toBeTruthy();
  });

  it("(b) THE CREATE ACT posts the exact body (the lines editor's own shape)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "trade/customs/declarations" && init?.method === "POST") {
        return { ok: true, data: declaration({ id: "decl-2", declarationNo: "CD-2026-000020" }) };
      }
      if (path === "trade/customs/declarations") {
        return { ok: true, data: [declaration()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the create pane (the data-slot switch — never Tabs).
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "New declaration" }));
    fireEvent.change(screen.getByLabelText(/Customs office/), { target: { value: "Jeddah Customs" } });
    fireEvent.change(screen.getByLabelText(/Currency \(ISO-4217\)/), { target: { value: "SAR" } });
    // The lines editor's first line.
    fireEvent.change(screen.getByLabelText(/HS code \(2…10 digits\)/), { target: { value: "7209160000" } });
    fireEvent.change(screen.getByLabelText(/Origin country \(ISO-3166\)/), { target: { value: "SA" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Cold rolled steel sheets" } });
    fireEvent.change(screen.getByLabelText(/Quantity \(≤ 6dp\)/), { target: { value: "1250.000000" } });
    fireEvent.change(screen.getByLabelText(/UoM/), { target: { value: "PKG" } });
    fireEvent.change(screen.getByLabelText(/Customs value/), { target: { value: "87500.0000" } });
    fireEvent.change(screen.getByLabelText(/Duty rate/), { target: { value: "0.0500" } });
    fireEvent.change(screen.getByLabelText(/Import VAT/), { target: { value: "4375.0000" } });
    const submit = screen.getAllByRole("button", { name: "Create" }).at(-1)!;
    await waitFor(() => {
      fireEvent.click(submit);
    });
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("trade/customs/declarations", {
        method: "POST",
        body: {
          declarationType: "IMPORT",
          customsOffice: "Jeddah Customs",
          currency: "SAR",
          lines: [
            {
              hsCode: "7209160000",
              originCountry: "SA",
              description: "Cold rolled steel sheets",
              quantity: "1250.000000",
              uom: "PKG",
              customsValue: "87500.0000",
              dutyRate: "0.0500",
              importVat: "4375.0000",
            },
          ],
        },
      });
    });
  });

  it("(c) THE DETAIL CHAIN — the find's own output (the lines + the fold's totals from the LINES)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "trade/customs/declarations/decl-1") {
        return {
          ok: true,
          data: {
            declaration: declaration(),
            lines: [
              {
                id: "line-1",
                declarationId: "decl-1",
                lineNo: 1,
                hsCode: "7209160000",
                originCountry: "SA",
                itemId: null,
                description: "Cold rolled steel sheets",
                quantity: "1250.000000",
                uom: "PKG",
                customsValue: "87500.0000",
                dutyRate: "0.0500",
                dutyAmount: "4375.0000",
                importVat: "4375.0000",
                note: null,
                noteAr: null,
              },
            ],
            totals: {
              totalCustomsValue: "87500.0000",
              totalDuty: "4375.0000",
              totalImportVat: "4375.0000",
              totalLandedAmount: "8750.0000",
            },
          },
        };
      }
      if (path === "trade/customs/declarations") {
        return { ok: true, data: [declaration()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Open the detail chain (the row action rides the DataTable's kebab
    // menu — the keyboard path opens it in jsdom).
    const kebab = within(screen.getByRole("grid")).getAllByRole("button", { name: "row actions" })[0]!;
    kebab.focus();
    fireEvent.keyDown(kebab, { key: "Enter" });
    const openItem = await waitFor(() => screen.getByRole("menuitem", { name: "Open" }));
    fireEvent.click(openItem);
    await waitFor(() => {
      // THE FOLD'S TOTALS — the find's own output (computed at every
      // read from the LINES; the board never recomputes).
      expect(screen.getByText("Total customs value")).toBeTruthy();
      expect(screen.getAllByText("87500.0000").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Total duty").length).toBeGreaterThan(0);
      expect(screen.getAllByText("4375.0000").length).toBeGreaterThan(0);
      expect(screen.getByText("Total import VAT")).toBeTruthy();
      expect(screen.getByText("Landed amount (duty + VAT)")).toBeTruthy();
      expect(screen.getAllByText("8750.0000").length).toBeGreaterThan(0);
      // The declaration's own line renders VERBATIM.
      expect(screen.getByText("Cold rolled steel sheets")).toBeTruthy();
      expect(screen.getByText("7209160000")).toBeTruthy();
    });
  });

  it("(d) the HS pane renders the registry + the no-fabrication disclaimer (D-16)", () => {
    renderBoard("en");
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "HS code registry" }));
    // The registry rows render VERBATIM.
    const hsText = screen.getByText("Flat-rolled steel, cold rolled");
    expect(hsText).toBeTruthy();
    expect(screen.getByText("7209160000")).toBeTruthy();
    // D-16's documented accuracy disclaimer rides the pane.
    expect(
      screen.getAllByText(
        /tenant-extensible data — the tenant owns the final classification; a missing code is MISSING, never invented/,
      ).length,
    ).toBeGreaterThan(0);
  });
});
