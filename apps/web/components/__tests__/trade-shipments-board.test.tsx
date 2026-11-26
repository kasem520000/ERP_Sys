/**
 * PHASE-051 (W-39 — T-14) — the shipments board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW (D-14): the B/L register renders the fold's
 *   driven shipment_status VERBATIM through the localized ladder chip —
 *   the status is NEVER writable from this board (no status input
 *   anywhere in the create forms).
 * - THE APPEND EVENT ACT posts the exact body (the carrier milestone
 *   log's own append — the fold runs server-side on the linked B/L).
 * - THE B/L DETAIL CHAIN: the find's own output (the B/L + its packing
 *   lists + its events — acceptance #8's navigable link).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { TradeBlRow, TradePackingListRow, TradeTrackingEventRow } from "../../lib/api-types";
import { TradeShipmentsBoard } from "../trade-shipments-board";

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

function bl(overrides: Partial<TradeBlRow> = {}): TradeBlRow {
  return {
    id: "bl-1",
    blNo: "BL-2026-000042",
    docType: "SEA",
    carrierName: "Maersk Sealand",
    portOfLoading: "Jeddah Islamic Port",
    portOfDischarge: "Rotterdam",
    containerRefs: ["MSCU1234567"],
    purchaseOrderId: "po-1",
    deliveryNoteId: null,
    shipmentStatus: "DEPARTED",
    issuedAt: "2026-11-21T09:00:00Z",
    note: null,
    noteAr: null,
    createdAt: "2026-11-21T09:00:00Z",
    updatedAt: "2026-11-24T10:00:00Z",
    ...overrides,
  };
}

const PACKING_LISTS: readonly TradePackingListRow[] = [
  {
    id: "packlist-1",
    plNo: "PL-2026-000031",
    billOfLadingId: "bl-1",
    receiptId: null,
    lines: [{ description: "Steel sheets", packages: 50, grossKg: "51000.000", netKg: "50000.000" }],
    shipmentStatus: "DEPARTED",
    issuedAt: "2026-11-21T09:30:00Z",
    note: null,
    noteAr: null,
    createdAt: "2026-11-21T09:30:00Z",
    updatedAt: "2026-11-24T10:00:00Z",
  },
];

const EVENTS: readonly TradeTrackingEventRow[] = [
  {
    id: "event-1",
    billOfLadingId: "bl-1",
    declarationId: null,
    milestone: "BOOKED",
    eventAt: "2026-11-21T09:00:00Z",
    carrierRef: "MRKU-001",
    location: "Jeddah Islamic Port",
    note: null,
    noteAr: null,
    createdAt: "2026-11-21T09:00:00Z",
  },
  {
    id: "event-2",
    billOfLadingId: "bl-1",
    declarationId: null,
    milestone: "DEPARTED",
    eventAt: "2026-11-24T10:00:00Z",
    carrierRef: "MRKU-001",
    location: "Jeddah Islamic Port",
    note: null,
    noteAr: null,
    createdAt: "2026-11-24T10:00:00Z",
  },
];

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof TradeShipmentsBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <TradeShipmentsBoard
        locale={locale}
        initialBls={[bl()]}
        blsError={null}
        initialPackingLists={PACKING_LISTS}
        packingListsError={null}
        initialEvents={EVENTS}
        eventsError={null}
        canManage={true}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-051 W-39 — the shipments board", () => {
  it("(a) the B/L register renders the fold's driven status VERBATIM (the localized ladder chip)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("BL-2026-000042")).toBeTruthy();
    expect(within(grid).getByText("Maersk Sealand")).toBeTruthy();
    expect(within(grid).getByText("Jeddah Islamic Port")).toBeTruthy();
    // THE FOLD'S DRIVEN STATUS — the dictionary's own ladder wording; the
    // board NEVER offers a status write (D-14's own law: the fold drives
    // the documents' shipment_status, never a manual write).
    expect(within(grid).getByText("Departed")).toBeTruthy();
  });

  it("(b) THE APPEND EVENT ACT posts the exact body (the fold runs server-side on the linked B/L)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "trade/shipments/events" && init?.method === "POST") {
        return {
          ok: true,
          data: {
            event: EVENTS[0],
            drive: { verdicts: [], documents: [] },
          },
        };
      }
      if (path === "trade/shipments/events") {
        return { ok: true, data: EVENTS };
      }
      if (path === "trade/transport/bl") {
        return { ok: true, data: [bl()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the events pane (the data-slot switch — never Tabs).
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "Event log" }));
    fireEvent.change(screen.getByLabelText(/Bill of lading \(UUID\)/), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText(/Event at \(ISO\)/), { target: { value: "2026-11-26T08:00:00Z" } });
    fireEvent.change(screen.getByLabelText(/Carrier ref \(optional\)/), { target: { value: "MRKU-001" } });
    fireEvent.change(screen.getByLabelText(/Location \(optional\)/), { target: { value: "Suez Canal" } });
    const submit = screen.getAllByRole("button", { name: "Append event" }).at(-1)!;
    await waitFor(() => {
      fireEvent.click(submit);
    });
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("trade/shipments/events", {
        method: "POST",
        body: {
          billOfLadingId: "11111111-1111-4111-8111-111111111111",
          milestone: "BOOKED",
          eventAt: "2026-11-26T08:00:00Z",
          carrierRef: "MRKU-001",
          location: "Suez Canal",
        },
      });
    });
  });

  it("(c) THE B/L DETAIL CHAIN — the find's own output (the packing lists + the events, acceptance #8's link)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "trade/transport/bl/bl-1") {
        return { ok: true, data: { bl: bl(), packingLists: PACKING_LISTS, events: EVENTS } };
      }
      if (path === "trade/transport/bl") {
        return { ok: true, data: [bl()] };
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
      // The find's own chain: the B/L's carrier + ports line and the
      // packing lists/events counts.
      expect(screen.getByText("Maersk Sealand · Jeddah Islamic Port → Rotterdam")).toBeTruthy();
      expect(screen.getByText(/Packing lists: 1/)).toBeTruthy();
      expect(screen.getByText(/Event log: 2/)).toBeTruthy();
    });
  });

  it("(d) the typed refusal panel renders the FULL payload (the register's own refusal)", () => {
    renderBoard("en", {
      initialBls: null,
      blsError: {
        code: "FORBIDDEN",
        message: "the trade module is not enabled for this tenant",
        details: { feature: "trade" },
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Typed refusal");
    expect(alert.textContent).toContain("the trade module is not enabled for this tenant");
  });
});
