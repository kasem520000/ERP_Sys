/**
 * PHASE-050 (W-29 — T-15) — the NCR board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the register renders the engine's own shapes
 *   VERBATIM — the record's own ncrNo/affectedQty/problem/createdAt and
 *   the status/severity/source/disposition vocabularies through the
 *   dictionary.
 * - THE DISPOSITION ACT posts the exact body {disposition} and the ROW
 *   REFETCHES — the write-off figures render via the row's own fields
 *   only (the disposition pair + the journal entry's own id), the
 *   engine's own advanced row, never a client-side report.
 * - THE CLOSE ACT rides the POST with no body (BR-102's ladder top).
 * - THE TYPED REFUSAL renders the FULL payload on a refused read.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { ItemRow, NcrDispositionResult, NcrRow } from "../../lib/api-types";
import { QualityNcrBoard } from "../quality-ncr-board";

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

function ncr(overrides: Partial<NcrRow> = {}): NcrRow {
  return {
    id: "ncr-1",
    ncrNo: "NCR-2026-000042",
    source: "INSPECTION",
    severity: "HIGH",
    itemId: "item-1",
    batchId: "batch-1",
    inspectionId: null,
    partnerId: null,
    problem: "Surface oxidation",
    problemAr: null,
    affectedQty: "12.500000",
    status: "OPEN",
    disposition: null,
    dispositionAt: null,
    closedAt: null,
    journalEntryId: null,
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T08:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof QualityNcrBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <QualityNcrBoard
        locale={locale}
        initialNcrs={[ncr()]}
        ncrsError={null}
        items={[ITEM]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-050 W-29 — the NCR board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the mono figures + the vocabularies)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    // The record's own figures (mono, verbatim).
    expect(within(grid).getByText("NCR-2026-000042")).toBeTruthy();
    expect(within(grid).getByText("12.500000")).toBeTruthy();
    expect(within(grid).getByText("2026-11-20T08:00:00Z")).toBeTruthy();
    // The presentation join (never a bare uuid).
    expect(within(grid).getByText("SKU-100 · Steel sheet")).toBeTruthy();
    // The vocabularies (dictionary-driven, never the raw enum). The
    // "Open" word carries thrice by design: the status chip, the row
    // action button and the actions column header.
    expect(within(grid).getAllByText("Open").length).toBe(3);
    expect(within(grid).getByText("High")).toBeTruthy();
    expect(within(grid).getByText("Inspection")).toBeTruthy();
    expect(within(grid).getByText("Surface oxidation")).toBeTruthy();
    // The honest dash for the unset disposition.
    expect(within(grid).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("(b) AR renders Arabic-first (the status/severity/source vocabularies + the pane switch)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("مفتوحة")).toBeTruthy();
    expect(within(grid).getByText("عالية")).toBeTruthy();
    expect(within(grid).getByText("فحص")).toBeTruthy();
    expect(within(grid).getByText("SKU-100 · صفيحة فولاذ")).toBeTruthy();
    // The pane switch + the pane card both carry the pane label (by design).
    expect(screen.getAllByText("السجل").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("تسجيل حالة")).toBeTruthy();
  });

  it("(c) THE DISPOSITION ACT posts the exact body and the row refetches (the write-off figures via the row's own fields)", async () => {
    const dispositioned = ncr({
      status: "DISPOSITIONED",
      disposition: "SCRAP",
      dispositionAt: "2026-11-22T09:00:00Z",
      journalEntryId: "journal-9",
    });
    const result: NcrDispositionResult = {
      ncr: dispositioned,
      journalEntryId: "journal-9",
      writeOff: {
        totalValue: "4500.0000",
        perWarehouse: [
          { warehouseId: "wh-1", qty: "10.000000", valueAmount: "3600.0000" },
          { warehouseId: "wh-2", qty: "2.500000", valueAmount: "900.0000" },
        ],
      },
    };
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/ncr/ncr-1/disposition" && init?.method === "POST") {
        return { ok: true, data: result };
      }
      if (path === "quality/ncr") {
        // The REFETCHED register — the engine's own advanced row (the
        // write-off figures ride the row's own fields).
        return { ok: true, data: [dispositioned] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByText("Surface oxidation")).toBeTruthy();
    });
    // Open the disposition dialog (the default kind is REWORK).
    fireEvent.click(screen.getByRole("button", { name: "Disposition" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Record the disposition" }));
    // THE EXACT BODY — the engine's own contract.
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/ncr/ncr-1/disposition", {
        method: "POST",
        body: { disposition: "REWORK" },
      });
    });
    // THE ROW REFETCHES — the register read runs again after the act.
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/ncr");
    });
    // THE WRITE-OFF FIGURES VIA THE ROW'S OWN FIELDS ONLY — the journal
    // entry's own id and the disposition pair, the refetched row's own
    // strings (never the act's separate report).
    await waitFor(() => {
      expect(screen.getAllByText("journal-9").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("2026-11-22T09:00:00Z").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Scrap").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Dispositioned").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("(d) the typed refusal panel renders the FULL payload on a refused read", () => {
    renderBoard("en", {
      initialNcrs: null,
      ncrsError: {
        code: "NCR_AFFECTED_QTY_ABOVE_ON_HAND",
        message: "the affected quantity is above the batch on-hand",
        details: { ncrId: "ncr-1", affectedQty: "12.500000", onHand: "3.000000" },
      },
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("NCR_AFFECTED_QTY_ABOVE_ON_HAND")).toBeTruthy();
    expect(within(panel).getByText(/above the batch on-hand/)).toBeTruthy();
    expect(within(panel).getByText("affectedQty")).toBeTruthy();
    expect(within(panel).getByText("12.500000")).toBeTruthy();
    expect(within(panel).getByText("onHand")).toBeTruthy();
    expect(within(panel).getByText("3.000000")).toBeTruthy();
  });

  it("(e) THE CLOSE ACT rides the POST (BR-102's ladder top) and renders the toast", async () => {
    const closed = ncr({
      status: "CLOSED",
      disposition: "SCRAP",
      dispositionAt: "2026-11-22T09:00:00Z",
      closedAt: "2026-11-23T10:00:00Z",
    });
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/ncr/ncr-1/close" && init?.method === "POST") {
        return { ok: true, data: closed };
      }
      return { ok: true, data: [ncr({ status: "DISPOSITIONED", disposition: "SCRAP", dispositionAt: "2026-11-22T09:00:00Z" })] };
    });
    renderBoard("en", {
      initialNcrs: [ncr({ status: "DISPOSITIONED", disposition: "SCRAP", dispositionAt: "2026-11-22T09:00:00Z" })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/ncr/ncr-1/close", { method: "POST" });
    });
    // The toast + the notices line both carry the same word (by design) —
    // and the advanced row's own closed stamp renders verbatim.
    await waitFor(() => {
      expect(screen.getAllByText("The record is closed.").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("2026-11-23T10:00:00Z")).toBeTruthy();
    });
  });
});
