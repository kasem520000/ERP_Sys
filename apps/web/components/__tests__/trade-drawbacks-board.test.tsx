/**
 * PHASE-052 (W-48 — the fourth bound surface) THE DRAWBACK CLAIMS
 * BOARD'S component tests (the trade-lc-board pattern): the register
 * renders the 051 engine's own shapes VERBATIM (the ladder chip, the
 * claim's own figures), the create act posts the exact body (BR-108's
 * evidence-note floor is server-side — the client sends the honest
 * nulls), the chain rowAction opens the timeline Card (the workflow
 * plane's own fourth bound surface), and the AR arm renders the ladder
 * by the Arabic dictionary's own words.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { TradeDrawbackClaimRow } from "../../lib/api-types";
import { TradeDrawbacksBoard } from "../trade-drawbacks-board";

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

function claim(overrides: Partial<TradeDrawbackClaimRow> = {}): TradeDrawbackClaimRow {
  return {
    id: "dc-1",
    claimNo: "DB-2026-000007",
    exportDeclarationId: null,
    exportBillOfLadingId: null,
    claimedAmount: "45000.0000",
    currency: "SAR",
    status: "UNDER_REVIEW",
    submittedAt: "2026-11-27T09:00:00Z",
    decidedAt: null,
    note: null,
    noteAr: null,
    createdAt: "2026-11-27T08:00:00Z",
    updatedAt: "2026-11-27T08:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof TradeDrawbacksBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <TradeDrawbacksBoard
        locale={locale}
        initialClaims={[claim()]}
        claimsError={null}
        canManage={true}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-052 W-48 — the drawback claims board (the fourth bound surface)", () => {
  it("(a) the register renders the 051 engine's own shapes VERBATIM (the ladder chip, the claim's own figures)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("DB-2026-000007")).toBeTruthy();
    expect(within(grid).getByText("45000.0000")).toBeTruthy();
    expect(within(grid).getByText("SAR")).toBeTruthy();
    expect(within(grid).getByText("Under review")).toBeTruthy();
  });

  it("(b) the create act posts the exact body (the honest nulls for the absent evidence links)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "trade/drawback/claims" && init?.method === "POST") {
        return { ok: true, data: claim({ id: "dc-2", claimNo: "DB-2026-000008", status: "DRAFT" }) };
      }
      return { ok: true, data: [claim()] };
    });
    renderBoard("en");
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "New drawback claim" }));
    fireEvent.change(await screen.findByLabelText(/Claimed amount/), { target: { value: "12500.0000" } });
    fireEvent.change(screen.getByLabelText(/Currency \(ISO code\)/), { target: { value: "USD" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Q1 export refunds" } });
    const createButtons = screen.getAllByRole("button", { name: "New drawback claim" });
    fireEvent.click(createButtons[createButtons.length - 1]!);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("trade/drawback/claims", {
        method: "POST",
        body: {
          claimedAmount: "12500.0000",
          currency: "USD",
          exportDeclarationId: null,
          exportBillOfLadingId: null,
          note: "Q1 export refunds",
        },
      });
    });
  });

  it("(c) the chain rowAction opens the timeline Card (the workflow plane's fourth bound surface)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path.startsWith("workflow/timeline")) {
        return {
          ok: true,
          data: {
            document: { docNo: "DB-2026-000007", amountBase: "45000.0000", currency: "SAR", status: "UNDER_REVIEW" },
            instance: {
              id: "wi-1",
              status: "ACTIVE",
              currentStepOrder: 1,
              completedAt: null,
              definitionName: "Drawback review chain",
              definitionNameAr: "سلسلة مراجعة الاسترداد",
            },
            steps: [
              {
                id: "si-1",
                stepOrder: 1,
                stepName: "Customs review",
                stepNameAr: "المراجعة الجمركية",
                stepType: "APPROVAL",
                assigneeUserId: "u-1",
                assigneeName: "Owner",
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
      return { ok: true, data: [claim()] };
    });
    renderBoard("en");
    const grid = screen.getByRole("grid");
    const kebab = within(grid).getAllByRole("button").find((button) => button.getAttribute("aria-haspopup") === "menu");
    expect(kebab).toBeDefined();
    fireEvent.keyDown(kebab!, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Approval timeline" }));
    // The timeline Card renders the chain (the timeline component's own
    // read — the fourth bound surface's chain view).
    expect(await screen.findByText(/Drawback review chain/)).toBeTruthy();
    expect(screen.getByText("Customs review")).toBeTruthy();
  });

  it("(d) the AR arm — the ladder renders by the Arabic dictionary's own words (RTL)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("DB-2026-000007")).toBeTruthy();
    expect(within(grid).getByText("قيد المراجعة")).toBeTruthy();
  });
});
