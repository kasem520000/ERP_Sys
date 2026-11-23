/**
 * PHASE-050 (W-29 — T-15) — the CAPA board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the register renders the engine's own shapes
 *   VERBATIM — the record's own capaNo/externalCost/dueDate and the
 *   status vocabulary through the dictionary.
 * - THE ROOT-CAUSE ACT posts the exact body {rootCause}.
 * - THE TYPED REFUSAL renders the FULL payload on a refused read.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { CapaRow, NcrRow } from "../../lib/api-types";
import { QualityCapaBoard } from "../quality-capa-board";

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

const NCR: NcrRow = {
  id: "ncr-1",
  ncrNo: "NCR-2026-000042",
  source: "INSPECTION",
  severity: "HIGH",
  itemId: "item-1",
  batchId: null,
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
};

function capa(overrides: Partial<CapaRow> = {}): CapaRow {
  return {
    id: "capa-1",
    capaNo: "CAPA-2026-000007",
    ncrId: "ncr-1",
    title: "Rework the drying stage",
    ownerEmployeeId: null,
    rootCause: null,
    rootCauseAt: null,
    actions: [
      { title: "Replace the filter", ownerEmployeeId: null, dueDate: "2026-12-01", completedAt: null },
    ],
    dueDate: "2026-12-15",
    status: "OPEN",
    effectiveness: null,
    externalCost: "0",
    journalEntryId: null,
    closedAt: null,
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-21T08:00:00Z",
    updatedAt: "2026-11-21T08:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof QualityCapaBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <QualityCapaBoard
        locale={locale}
        initialCapas={[capa()]}
        capasError={null}
        ncrs={[NCR]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-050 W-29 — the CAPA board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the mono figures + the vocabulary)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    // The record's own figures (mono, verbatim).
    expect(within(grid).getByText("CAPA-2026-000007")).toBeTruthy();
    expect(within(grid).getByText("2026-12-15")).toBeTruthy();
    expect(within(grid).getByText("2026-11-21T08:00:00Z")).toBeTruthy();
    expect(within(grid).getByText("0")).toBeTruthy();
    // The register's own title + the NCR join (the register's own number).
    expect(within(grid).getByText("Rework the drying stage")).toBeTruthy();
    expect(within(grid).getByText("NCR-2026-000042")).toBeTruthy();
    // The status vocabulary (dictionary-driven, never the raw enum). The
    // "Open" word carries thrice by design: the status chip, the row
    // action button and the actions column header.
    expect(within(grid).getAllByText("Open").length).toBe(3);
  });

  it("(b) AR renders Arabic-first (the status vocabulary + the pane switch + the join)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("مفتوح")).toBeTruthy();
    expect(within(grid).getByText("NCR-2026-000042")).toBeTruthy();
    // The pane switch + the pane card both carry the pane label (by design).
    expect(screen.getAllByText("السجل").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("إجراء جديد")).toBeTruthy();
  });

  it("(c) THE ROOT-CAUSE ACT posts the exact body and advances the row", async () => {
    const inProgress = capa({
      status: "IN_PROGRESS",
      rootCause: "The filter clogged after 400 hours",
      rootCauseAt: "2026-11-22T09:00:00Z",
    });
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/capa/capa-1/root-cause" && init?.method === "POST") {
        return { ok: true, data: inProgress };
      }
      return { ok: true, data: [capa()] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByText("Rework the drying stage")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Record the root cause" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Root cause *"), {
      target: { value: "The filter clogged after 400 hours" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Record the root cause" }));
    // THE EXACT BODY — the engine's own contract.
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/capa/capa-1/root-cause", {
        method: "POST",
        body: { rootCause: "The filter clogged after 400 hours" },
      });
    });
    // The advanced row's own stamp + the actions array (the jsonb verbatim).
    await waitFor(() => {
      expect(screen.getByText("2026-11-22T09:00:00Z")).toBeTruthy();
      expect(screen.getByText("Replace the filter")).toBeTruthy();
      expect(screen.getByText("2026-12-01")).toBeTruthy();
    });
  });

  it("(d) the typed refusal panel renders the FULL payload on a refused read", () => {
    renderBoard("en", {
      initialCapas: null,
      capasError: {
        code: "CAPA_ACTIONS_PENDING",
        message: "the close refuses: open action windows remain",
        details: { capaId: "capa-1", pending: 2, earliestDueDate: "2026-12-01" },
      },
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("CAPA_ACTIONS_PENDING")).toBeTruthy();
    expect(within(panel).getByText(/open action windows remain/)).toBeTruthy();
    expect(within(panel).getByText("capaId")).toBeTruthy();
    expect(within(panel).getByText("pending")).toBeTruthy();
    expect(within(panel).getByText("earliestDueDate")).toBeTruthy();
    expect(within(panel).getByText("2026-12-01")).toBeTruthy();
  });
});
