/**
 * PHASE-052 (W-48 — T-12, PP-17) THE WORKFLOW TIMELINE'S component
 * tests (the trade-lc-board pattern: jsdom + the bffFetch mock):
 *
 * - THE FULL STEP HISTORY VERBATIM: the frozen history renders the
 *   row's own strings — the step names (AR/EN), the assignee, the
 *   delegated_to, the acted_at with its actor, the comment, the states
 *   by their own words (acceptance #7's own arm).
 * - THE NO-CHAIN STATE: the unbound document renders its honest
 *   no-chain notice (never an error).
 * - THE TYPED REFUSAL: the panel renders the code + the FULL payload.
 * - THE AR ARM: the Arabic dictionary renders the ladder by its own
 *   words (the RTL verification — the AR-first law).
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { WorkflowTimelineView } from "../../lib/api-types";
import { WorkflowTimeline } from "../workflow-timeline";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
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

function timeline(overrides: Partial<WorkflowTimelineView> = {}): WorkflowTimelineView {
  return {
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
        comment: "Within budget",
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
        delegatedTo: "u-delegate",
        delegatedToName: "Dana Delegate",
        actedAt: null,
        actedBy: null,
        actedByName: null,
        comment: null,
        dueAt: "2026-11-29T08:00:00Z",
      },
    ],
    ...overrides,
  };
}

function renderTimeline(locale: "ar" | "en") {
  return render(
    <ToastProvider>
      <WorkflowTimeline locale={locale} triggerEntity="purchase_order" documentId="po-1" />
    </ToastProvider>,
  );
}

describe("PHASE-052 W-48 — the workflow timeline (PP-17)", () => {
  it("(a) the FULL step history renders VERBATIM (state, assignee, delegated_to, acted_at, comment)", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: timeline() });
    renderTimeline("en");
    const grid = await screen.findByRole("grid");
    // The frozen history's own strings — the step names by order.
    expect(within(grid).getByText("Manager approval")).toBeTruthy();
    expect(within(grid).getByText("Finance approval")).toBeTruthy();
    // The assignees by name, the delegated_to with its own name (the
    // acted_by sub-label repeats the actor's name — the count is the
    // honest assertion, the frozen history carries it twice).
    expect(within(grid).getAllByText("Sara Manager").length).toBeGreaterThanOrEqual(1);
    expect(within(grid).getByText("Faisal Finance")).toBeTruthy();
    expect(within(grid).getByText("Dana Delegate")).toBeTruthy();
    // The states by their own words + the CURRENT chip on the pointer's step.
    expect(within(grid).getByText("Approved")).toBeTruthy();
    expect(within(grid).getAllByText("Pending").length).toBeGreaterThan(0);
    expect(within(grid).getByText("Current step")).toBeTruthy();
    // The comment VERBATIM.
    expect(within(grid).getByText("Within budget")).toBeTruthy();
    // The chain's own name (the frozen snapshot's member).
    expect(await screen.findByText(/PO conditional chain/)).toBeTruthy();
  });

  it("(b) the no-chain document renders its honest no-chain notice (never an error)", async () => {
    bffFetchMock.mockResolvedValue({
      ok: true,
      data: timeline({ instance: null, steps: [] }),
    });
    renderTimeline("en");
    expect(await screen.findByText("No approval chain on this document.")).toBeTruthy();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("(c) the typed refusal renders the code + the FULL payload", async () => {
    bffFetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      error: {
        code: "FORBIDDEN",
        message: "You lack workflow.history.view",
        details: { permission: "workflow.history.view" },
      },
    });
    renderTimeline("en");
    const refusal = await screen.findByRole("alert");
    expect(within(refusal).getByText("FORBIDDEN")).toBeTruthy();
    expect(within(refusal).getAllByText(/workflow\.history\.view/).length).toBeGreaterThanOrEqual(1);
  });

  it("(d) the AR arm — the ladder renders by the Arabic dictionary's own words (RTL)", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: timeline() });
    renderTimeline("ar");
    const grid = await screen.findByRole("grid");
    expect(within(grid).getByText("موافقة المدير")).toBeTruthy();
    expect(within(grid).getByText("موافقة المالية")).toBeTruthy();
    expect(within(grid).getByText("معتمدة")).toBeTruthy();
    expect(within(grid).getAllByText("بانتظار").length).toBeGreaterThan(0);
    expect(await screen.findByText(/سلسلة أوامر الشراء الشرطية/)).toBeTruthy();
  });
});
