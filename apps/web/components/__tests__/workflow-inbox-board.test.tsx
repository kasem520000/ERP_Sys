/**
 * PHASE-052 (W-48 — T-11) THE APPROVALS INBOX BOARD'S component tests
 * (the trade-lc-board pattern: jsdom + the bffFetch mock):
 *
 * - THE ENGINE-OUTPUT LAW: the aging figures (ageHours · overdue) are
 *   the DB's own clock's — rendered VERBATIM (zero client-side
 *   recomputation), the routed rows carry the delegation marker.
 * - THE QUICK ACTION posts the exact body (the approve act with the
 *   comment; the outcome's own figures render).
 * - THE TASKS PANE: the lane's due-first rows + the completion
 *   write-back posts the exact body.
 * - THE TYPED REFUSAL: the panel renders the code + the FULL payload.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { WorkflowApprovalView, WorkflowTaskView } from "../../lib/api-types";
import { WorkflowInboxBoard } from "../workflow-inbox-board";

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

function approval(overrides: Partial<WorkflowApprovalView> = {}): WorkflowApprovalView {
  return {
    stepInstanceId: "si-1",
    instanceId: "wi-1",
    triggerEntity: "purchase_order",
    documentId: "po-1",
    stepOrder: 2,
    stepName: "Finance approval",
    stepNameAr: "موافقة المالية",
    dueAt: "2026-11-29T08:00:00Z",
    assignedAt: "2026-11-27T08:00:00Z",
    overdue: true,
    ageHours: 36,
    documentNo: "PO-2026-000042",
    amountBase: "61250.0000",
    currency: "SAR",
    routedFromUserId: null,
    routedFromUserName: null,
    ...overrides,
  };
}

function task(overrides: Partial<WorkflowTaskView> = {}): WorkflowTaskView {
  return {
    taskStepId: "si-9",
    instanceId: "wi-2",
    triggerEntity: "manual_journal",
    documentId: "j-1",
    stepOrder: 3,
    stepName: "Attach evidence",
    stepNameAr: "إرفاق الأدلة",
    dueAt: "2026-11-30T08:00:00Z",
    assignedAt: "2026-11-27T08:00:00Z",
    documentNo: null,
    amountBase: "0.0000",
    currency: "BASE",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof WorkflowInboxBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <WorkflowInboxBoard
        locale={locale}
        initialApprovals={[approval()]}
        approvalsError={null}
        initialTasks={[task()]}
        tasksError={null}
        canAct={true}
        initialPane="approvals"
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-052 W-48 — the approvals inbox board", () => {
  it("(a) the aging figures render VERBATIM (the DB's own clock's ageHours + the overdue chip), the routed row carries the delegation marker", () => {
    renderBoard("en", {
      initialApprovals: [
        approval(),
        approval({
          stepInstanceId: "si-2",
          stepName: "Manager approval",
          stepNameAr: "موافقة المدير",
          overdue: false,
          ageHours: 4,
          routedFromUserId: "u-manager",
          routedFromUserName: "Sara Manager",
        }),
      ],
    });
    const grid = screen.getByRole("grid");
    // The engine's own figures VERBATIM — 36h + the overdue chip on the
    // first row; 4h and NO overdue chip on the second.
    expect(within(grid).getByText("36h")).toBeTruthy();
    expect(within(grid).getByText("4h")).toBeTruthy();
    expect(within(grid).getAllByText("Overdue").length).toBe(1);
    // The routed row's delegation marker (the absent assignee by name).
    expect(within(grid).getByText("Via Sara Manager's delegation")).toBeTruthy();
    // The document links by the engine's own doc facts.
    expect(within(grid).getAllByText("PO-2026-000042").length).toBeGreaterThanOrEqual(1);
    expect(within(grid).getAllByText("61250.0000").length).toBeGreaterThanOrEqual(1);
  });

  it("(b) THE QUICK ACTION posts the exact body and renders the outcome's own figures", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "workflow/approvals/si-1/act" && init?.method === "POST") {
        return {
          ok: true,
          data: { action: "approve", stepInstanceId: "si-1", completed: false, remaining: 1, currentStepOrder: 3, completedSteps: 1 },
        };
      }
      if (path.startsWith("workflow/approvals")) {
        return { ok: true, data: [] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // The quick action opens the approve dialog.
    const approveButtons = within(screen.getByRole("grid")).getAllByRole("button", { name: "Approve" });
    expect(approveButtons.length).toBeGreaterThan(0);
    fireEvent.click(approveButtons[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Comment/), {
      target: { value: "Approved from the inbox" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("workflow/approvals/si-1/act", {
        method: "POST",
        body: { verdict: "APPROVE", comment: "Approved from the inbox" },
      });
    });
    // The outcome's own figures (remaining = 1).
    expect(await screen.findByText(/1 steps remain./)).toBeTruthy();
  });

  it("(c) THE TASKS PANE — the lane's rows and the completion write-back post the exact body", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "workflow/tasks/si-9/complete" && init?.method === "POST") {
        return {
          ok: true,
          data: { taskStepId: "si-9", completed: true, remaining: 0, currentStepOrder: null },
        };
      }
      if (path.startsWith("workflow/tasks")) {
        return { ok: true, data: [task()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the tasks pane (the data-slot switch — never Tabs).
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "Tasks" }));
    const grid = await screen.findByRole("grid");
    expect(within(grid).getByText("Attach evidence")).toBeTruthy();
    // The completion write-back.
    fireEvent.click(within(grid).getByRole("button", { name: "Complete task" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Comment/), {
      target: { value: "Evidence attached" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Complete task" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("workflow/tasks/si-9/complete", {
        method: "POST",
        body: { comment: "Evidence attached" },
      });
    });
    expect((await screen.findAllByText("The task is completed.")).length).toBeGreaterThanOrEqual(1);
  });

  it("(d) the typed refusal renders the code + the FULL payload (the CAS replay class)", () => {
    renderBoard("en", {
      initialApprovals: null,
      approvalsError: {
        code: "WORKFLOW_STEP_ALREADY_ACTED",
        message: "workflow step si-1 is PENDING — the act is single-use",
        details: { stepInstanceId: "si-1", status: "PENDING" },
      },
    });
    const refusal = screen.getByRole("alert");
    expect(within(refusal).getByText("WORKFLOW_STEP_ALREADY_ACTED")).toBeTruthy();
    expect(within(refusal).getAllByText(/si-1/).length).toBeGreaterThanOrEqual(1);
  });

  it("(e) the AR arm — the aging figures + the ladder by the Arabic dictionary's own words (RTL)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("36 ساعة")).toBeTruthy();
    expect(within(grid).getAllByText("متأخر").length).toBe(1);
    expect(within(grid).getByText("موافقة المالية")).toBeTruthy();
    expect(within(grid).getByText("أمر شراء")).toBeTruthy();
  });
});
