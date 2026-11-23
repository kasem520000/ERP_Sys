/**
 * PHASE-050 (W-29 — T-15) — the COA board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the certificates register renders the engine's
 *   own shapes VERBATIM (the docNo/docType/issuedAt).
 * - THE GENERATE ACT posts the exact body (the full-coverage parameters).
 * - THE PRINT PREVIEW invokes the payload builder — the SAME html the paper
 *   prints (ADR-0011), carrying the frozen parameter values VERBATIM and a
 *   real <thead>.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { CoaDocumentRow, ItemRow, QualitySpecRow } from "../../lib/api-types";
import { QualityCoaBoard } from "../quality-coa-board";

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

const ITEM: ItemRow = {
  id: "item-1",
  sku: "SKU-100",
  name: "Steel sheet",
  nameAr: "صفيحة فولاذ",
  kind: "STOCK",
  uomId: "uom-1",
  categoryId: null,
  taxCodeId: null,
  costingMethod: "WAC",
  trackBatch: true,
  trackSerial: false,
  trackImei: false,
  hasExpiry: true,
  reorderLevel: null,
  reorderQty: null,
  basePrice: null,
  status: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

function specRow(id: string, parameter: string, parameterAr: string, unit: string): QualitySpecRow {
  return {
    id,
    itemId: "item-1",
    parameter,
    parameterAr,
    unit,
    targetValue: "2.500000",
    ucl: "2.600000",
    lcl: "2.400000",
    isActive: true,
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };
}

const SPECS: readonly QualitySpecRow[] = [
  specRow("spec-1", "Thickness", "السماكة", "mm"),
  specRow("spec-2", "Coating", "الطلاء", "g/m2"),
];

/** The frozen snapshot the engine stores (the gate fold's own entries). */
function certificate(overrides: Partial<CoaDocumentRow> = {}): CoaDocumentRow {
  return {
    id: "coa-1",
    docNo: "COA-2026-000011",
    docType: "COA",
    itemId: "item-1",
    batchId: "batch-1",
    inspectionId: null,
    parameters: [
      {
        specId: "spec-1",
        parameter: "Thickness",
        parameterAr: "السماكة",
        unit: "mm",
        targetValue: "2.500000",
        ucl: "2.600000",
        lcl: "2.400000",
        value: "2.512000",
        toleranceVerdict: "WITHIN",
        gate: "PASS",
        breachedLimit: null,
        ncrId: null,
      },
      {
        specId: "spec-2",
        parameter: "Coating",
        parameterAr: "الطلاء",
        unit: "g/m2",
        targetValue: "120.000000",
        ucl: "140.000000",
        lcl: "100.000000",
        value: "142.500000",
        toleranceVerdict: "ABOVE_UCL",
        gate: "PASS_DEVIATION_ACCEPTED",
        breachedLimit: "140.000000",
        ncrId: "ncr-1",
      },
    ],
    issuedAt: "2026-11-22T14:00:00Z",
    issuedBy: "user-1",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-22T14:00:00Z",
    updatedAt: "2026-11-22T14:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof QualityCoaBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <QualityCoaBoard
        locale={locale}
        initialCertificates={[certificate()]}
        certificatesError={null}
        items={[ITEM]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-050 W-29 — the COA board", () => {
  it("(a) the certificates listing renders the engine's own shapes verbatim", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("COA-2026-000011")).toBeTruthy();
    expect(within(grid).getByText("2026-11-22T14:00:00Z")).toBeTruthy();
    // The type chip + the item join + the batch's presentation short id.
    expect(within(grid).getByText("COA")).toBeTruthy();
    expect(within(grid).getByText("SKU-100 · Steel sheet")).toBeTruthy();
    expect(within(grid).getByText("batch-1")).toBeTruthy();
  });

  it("(b) THE GENERATE ACT posts the exact body (the full-coverage parameters)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/specifications?itemId=item-1&activeOnly=true") {
        return { ok: true, data: SPECS };
      }
      if (path === "quality/coa" && init?.method === "POST") {
        return { ok: true, data: certificate({ id: "coa-2", docNo: "COA-2026-000012" }) };
      }
      if (path === "quality/coa") {
        return { ok: true, data: [certificate()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the generate pane (the data-slot switch — never Tabs).
    fireEvent.click(screen.getByRole("button", { name: "Generate certificate" }));
    // Pick the item (the standard Radix+jsdom workaround) — the coverage
    // law's own register read follows.
    const trigger = screen.getByLabelText(/Item \*/);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "SKU-100 · Steel sheet" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/specifications?itemId=item-1&activeOnly=true");
    });
    // Every ACTIVE spec measured exactly once (the coverage law's form).
    const valueInputs = await screen.findAllByLabelText(/Measured value \*/);
    expect(valueInputs.length).toBe(2);
    fireEvent.change(valueInputs[0]!, { target: { value: "2.512000" } });
    fireEvent.change(valueInputs[1]!, { target: { value: "138.000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    // THE EXACT BODY — the engine's own contract.
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/coa", {
        method: "POST",
        body: {
          docType: "COA",
          itemId: "item-1",
          parameters: [
            { specId: "spec-1", value: "2.512000" },
            { specId: "spec-2", value: "138.000000" },
          ],
        },
      });
    });
  });

  it("(c) THE PRINT PREVIEW invokes the builder — the frozen values VERBATIM + a real thead", async () => {
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Print preview" }));
    // The preview iframe carries the payload builder's own html (the same
    // document the paper prints — ADR-0011).
    const frame = await screen.findByTitle("Certificate preview");
    const html = frame.getAttribute("srcdoc") ?? "";
    expect(html).toContain("<thead>");
    // THE FROZEN PARAMETER VALUES — the engine's own strings, VERBATIM.
    expect(html).toContain("2.512000");
    expect(html).toContain("142.500000");
    // The parameters' own names (the active locale's side).
    expect(html).toContain("Thickness");
    expect(html).toContain("Coating");
    // The LTR-mono numeric isolation (the value column rides .num).
    expect(html).toContain('class="numeric num"');
    // The certificate's own docNo/docDate (the determinism law's inputs).
    expect(html).toContain("COA-2026-000011");
    expect(html).toContain("2026-11-22T14:00:00Z");
  });
});
