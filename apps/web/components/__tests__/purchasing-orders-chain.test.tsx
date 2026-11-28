/**
 * PHASE-052 (W-48 — T-12) THE PO CHAIN VIEW'S embed tests (the second
 * bound surface): the ?doc= landing renders the timeline Card for the
 * linked purchase order (the engine's docDetailPath law lands the
 * assignee here), and the register's own rowAction opens the same
 * chain view for any row.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { ItemRow, PartnerRow, PurchaseOrderRow, PurchaseRequestRow, TradeIncotermRow } from "../../lib/api-types";
import { PurchasingOrders } from "../purchasing-orders";

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

function order(overrides: Partial<PurchaseOrderRow> = {}): PurchaseOrderRow {
  return {
    id: "po-1",
    orderNo: "PO-2026-000042",
    supplierId: "p-1",
    orderDate: "2026-11-20",
    expectedDate: null,
    branchId: null,
    currency: "SAR",
    incotermCode: null,
    status: "PENDING_APPROVAL",
    grossAmount: "61250.0000",
    lines: [],
    note: null,
    noteAr: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    ...overrides,
  } as PurchaseOrderRow;
}

function renderWorkspace(initialChainDocId?: string | null) {
  return render(
    <ToastProvider>
      <PurchasingOrders
        locale="en"
        initialRequests={[] as readonly PurchaseRequestRow[]}
        initialOrders={[order()]}
        suppliers={[] as readonly PartnerRow[]}
        items={[] as readonly ItemRow[]}
        incoterms={[] as readonly TradeIncotermRow[]}
        canCreate={false}
        canApprove={false}
        initialChainDocId={initialChainDocId ?? null}
      />
    </ToastProvider>,
  );
}

function mockTimeline(): void {
  bffFetchMock.mockImplementation(async (path: string) => {
    if (path.startsWith("workflow/timeline")) {
      return {
        ok: true,
        data: {
          document: { docNo: "PO-2026-000042", amountBase: "61250.0000", currency: "SAR", status: "PENDING_APPROVAL" },
          instance: {
            id: "wi-1",
            status: "ACTIVE",
            currentStepOrder: 2,
            completedAt: null,
            definitionName: "PO conditional chain",
            definitionNameAr: "سلسلة أوامر الشراء الشرطية",
          },
          steps: [
            {
              id: "si-1",
              stepOrder: 1,
              stepName: "Manager approval",
              stepNameAr: "موافقة المدير",
              stepType: "APPROVAL",
              assigneeUserId: "u-manager",
              assigneeName: "Sara Manager",
              status: "APPROVED",
              delegatedTo: null,
              delegatedToName: null,
              actedAt: "2026-11-28T08:15:00Z",
              actedBy: "u-manager",
              actedByName: "Sara Manager",
              comment: null,
              dueAt: null,
            },
            {
              id: "si-2",
              stepOrder: 2,
              stepName: "Finance approval",
              stepNameAr: "موافقة المالية",
              stepType: "APPROVAL",
              assigneeUserId: "u-finance",
              assigneeName: "Faisal Finance",
              status: "PENDING",
              delegatedTo: null,
              delegatedToName: null,
              actedAt: null,
              actedBy: null,
              actedByName: null,
              comment: null,
              dueAt: null,
            },
          ],
        },
      };
    }
    return { ok: true, data: [] };
  });
}

describe("PHASE-052 W-48 — the PO chain view (the second bound surface)", () => {
  it("(a) the ?doc= landing renders the timeline Card for the linked purchase order", async () => {
    mockTimeline();
    renderWorkspace("po-1");
    expect(await screen.findByText(/PO conditional chain/)).toBeTruthy();
    // The full history renders on the register page's own chain view.
    expect(screen.getByText("Manager approval")).toBeTruthy();
    expect(screen.getByText("Finance approval")).toBeTruthy();
  });

  it("(b) the register's own rowAction opens the same chain view for any row", async () => {
    mockTimeline();
    renderWorkspace(null);
    expect(screen.queryByText(/PO conditional chain/)).toBeNull();
    const grid = screen.getByRole("grid");
    const kebab = within(grid).getAllByRole("button").find((button) => button.getAttribute("aria-haspopup") === "menu");
    expect(kebab).toBeDefined();
    fireEvent.keyDown(kebab!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Approval timeline" }));
    await waitFor(() => {
      expect(screen.getByText(/PO conditional chain/)).toBeTruthy();
    });
  });

  it("(c) no chain view renders without the ?doc= param or the rowAction (the honest default)", () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: [] });
    renderWorkspace(null);
    expect(screen.queryByText(/PO conditional chain/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
