/**
 * PHASE-051 (W-39 — T-14) — the LC board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the register renders the engine's own shapes
 *   VERBATIM (the lcNo/status/currency/amount/margin/expiry — the row's
 *   own strings, the localized ladder chip).
 * - THE CREATE ACT posts the exact body.
 * - THE DETAIL CHAIN (the find's own output): the amendments register +
 *   the documents checklist with the discrepancy notes render VERBATIM.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { TradeLcRow } from "../../lib/api-types";
import { TradeLcBoard } from "../trade-lc-board";

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

function lc(overrides: Partial<TradeLcRow> = {}): TradeLcRow {
  return {
    id: "lc-1",
    lcNo: "LC-2026-000005",
    purchaseOrderId: null,
    currency: "USD",
    amount: "120000.0000",
    marginAmount: "12000.0000",
    issuingBank: "Saudi British Bank",
    beneficiaryName: "Euro Steel GmbH",
    applicantName: "Test Trading Company",
    issuedAt: "2026-11-20T10:00:00Z",
    expiryDate: "2027-02-20",
    status: "ISSUED",
    marginJournalEntryId: "je-1",
    settledAt: null,
    retirementJournalEntryId: null,
    note: null,
    noteAr: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof TradeLcBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <TradeLcBoard
        locale={locale}
        initialLcs={[lc()]}
        lcsError={null}
        canManage={true}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-051 W-39 — the LC board", () => {
  it("(a) the register renders the engine's own shapes VERBATIM (the localized ladder chip)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("LC-2026-000005")).toBeTruthy();
    expect(within(grid).getByText("USD")).toBeTruthy();
    expect(within(grid).getByText("120000.0000")).toBeTruthy();
    expect(within(grid).getByText("12000.0000")).toBeTruthy();
    expect(within(grid).getByText("2027-02-20")).toBeTruthy();
    // The ladder's chip — the dictionary's own wording.
    expect(within(grid).getByText("Issued")).toBeTruthy();
  });

  it("(b) THE CREATE ACT posts the exact body", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "trade/lc" && init?.method === "POST") {
        return { ok: true, data: lc({ id: "lc-2", lcNo: "LC-2026-000006" }) };
      }
      if (path === "trade/lc") {
        return { ok: true, data: [lc()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the create pane (the data-slot switch — never Tabs; the
    // switch and the submit share the label, so the switch is scoped to
    // the tablist).
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "Create" }));
    fireEvent.change(screen.getByLabelText(/Currency \(ISO-4217\)/), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText(/Amount \(≤ 4dp\)/), { target: { value: "120000.0000" } });
    fireEvent.change(screen.getByLabelText(/Margin amount \(optional\)/), { target: { value: "12000.0000" } });
    fireEvent.change(screen.getByLabelText(/Issuing bank/), { target: { value: "Saudi British Bank" } });
    fireEvent.change(screen.getByLabelText(/Beneficiary name/), { target: { value: "Euro Steel GmbH" } });
    fireEvent.change(screen.getByLabelText(/Applicant name/), { target: { value: "Test Trading Company" } });
    fireEvent.change(screen.getByLabelText(/Expiry date/), { target: { value: "2027-02-20" } });
    fireEvent.change(screen.getByLabelText(/Linked purchase order/), {
      target: { value: "33333333-3333-4333-8333-333333333333" },
    });
    // The submit (the second "Create" — the pane switch keeps its own).
    const submit = screen.getAllByRole("button", { name: "Create" }).at(-1)!;
    await waitFor(() => {
      fireEvent.click(submit);
    });
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("trade/lc", {
        method: "POST",
        body: {
          currency: "USD",
          amount: "120000.0000",
          marginAmount: "12000.0000",
          issuingBank: "Saudi British Bank",
          beneficiaryName: "Euro Steel GmbH",
          applicantName: "Test Trading Company",
          expiryDate: "2027-02-20",
          purchaseOrderId: "33333333-3333-4333-8333-333333333333",
        },
      });
    });
  });

  it("(c) THE DETAIL CHAIN — the find's own output (the amendments + the documents checklist VERBATIM)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "trade/lc/lc-1") {
        return {
          ok: true,
          data: {
            lc: lc(),
            amendments: [
              {
                id: "amend-1",
                lcId: "lc-1",
                amendmentNo: 1,
                changeType: "VALUE",
                valueFrom: "100000.0000",
                valueTo: "120000.0000",
                expiryFrom: null,
                expiryTo: null,
                documentsNote: null,
                summary: null,
                effectiveAt: "2026-11-22T09:00:00Z",
                note: null,
                createdAt: "2026-11-22T09:00:00Z",
              },
            ],
            documents: [
              {
                id: "doc-1",
                lcId: "lc-1",
                docType: "BILL_OF_LADING",
                presented: true,
                presentedAt: "2026-11-23T08:00:00Z",
                verified: false,
                verifiedAt: null,
                discrepancyNotes: "the consignee name differs from the application",
                note: null,
              },
            ],
          },
        };
      }
      if (path === "trade/lc") {
        return { ok: true, data: [lc()] };
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
      // The amendments register — the find's own output, VERBATIM.
      expect(screen.getByText("The amendments register")).toBeTruthy();
      expect(screen.getByText("1")).toBeTruthy();
      expect(screen.getByText("VALUE")).toBeTruthy();
      expect(screen.getByText("2026-11-22T09:00:00Z")).toBeTruthy();
      // The documents checklist — the discrepancy note rides the row.
      expect(screen.getByText("The documents checklist")).toBeTruthy();
      expect(screen.getByText("BILL_OF_LADING")).toBeTruthy();
      expect(screen.getByText("the consignee name differs from the application")).toBeTruthy();
    });
  });

  it("(d) the typed refusal panel renders the FULL payload (the register's own refusal)", () => {
    renderBoard("en", {
      initialLcs: null,
      lcsError: {
        code: "FORBIDDEN",
        message: "the trade.lc plane is not enabled for this tenant",
        details: { feature: "trade.lc" },
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Typed refusal");
    expect(alert.textContent).toContain("the trade.lc plane is not enabled for this tenant");
  });
});
