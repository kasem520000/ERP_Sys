/**
 * PHASE-052 (W-48 — T-10) THE CHAIN EDITOR'S component tests (the
 * trade-lc-board pattern): the ORDERING LAW (the up/down buttons
 * rewrite the array — the contiguous 1-based ladder posts in the new
 * order; the order is DATA, never a canvas), THE EXACT CREATE BODY
 * (the trigger event NEVER sent — the mapping law derives it; the
 * conditions serialize to the D-06 tree's operand shape; the SLA
 * serializes to whole hours or null), and THE TYPED REFUSAL (the
 * validation fold's own payload renders with its FULL details — the
 * condition named BY PATH).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { WorkflowDefinitionView } from "../../lib/api-types";
import { WorkflowDefinitionsBoard } from "../workflow-definitions-board";

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

function definition(overrides: Partial<WorkflowDefinitionView> = {}): WorkflowDefinitionView {
  return {
    id: "wd-1",
    name: "PO conditional chain",
    nameAr: "سلسلة أوامر الشراء الشرطية",
    triggerEntity: "purchase_order",
    triggerEvent: "PENDING_APPROVAL",
    active: true,
    conditions: { all: [] },
    originPolicyId: null,
    steps: [
      {
        id: "ws-1",
        stepOrder: 1,
        stepType: "APPROVAL",
        assigneeRule: "ROLE",
        assigneeValue: "owner",
        conditions: { all: [] },
        slaHours: null,
        name: "Manager approval",
        nameAr: "موافقة المدير",
      },
      {
        id: "ws-2",
        stepOrder: 2,
        stepType: "APPROVAL",
        assigneeRule: "ROLE",
        assigneeValue: "finance",
        conditions: { all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] },
        slaHours: 48,
        name: "Finance approval",
        nameAr: "موافقة المالية",
      },
    ],
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof WorkflowDefinitionsBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <WorkflowDefinitionsBoard
        locale={locale}
        initialDefinitions={[definition()]}
        definitionsError={null}
        {...overrides}
      />
    </ToastProvider>,
  );
}

async function openEditorForFirstRow(): Promise<void> {
  const grid = screen.getByRole("grid");
  const kebab = within(grid).getAllByRole("button").find((button) => button.getAttribute("aria-haspopup") === "menu");
  expect(kebab).toBeDefined();
  fireEvent.keyDown(kebab!, { key: "Enter" });
  const editItem = await screen.findByRole("menuitem", { name: "Edit" });
  fireEvent.click(editItem);
  await screen.findByTestId("step-1");
}

describe("PHASE-052 W-48 — the chain editor (the form-first law)", () => {
  it("(a) the register renders the definitions' own shapes (the trigger chip, the step count, the origin marker)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("PO conditional chain")).toBeTruthy();
    expect(within(grid).getByText("Purchase order")).toBeTruthy();
    expect(within(grid).getByText("PENDING_APPROVAL")).toBeTruthy();
    expect(within(grid).getByText("2")).toBeTruthy();
    expect(within(grid).getByText("Manual")).toBeTruthy();
  });

  it("(b) THE ORDERING LAW — the up/down buttons rewrite the array and the update posts the contiguous 1-based ladder in the new order", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: [definition()] });
    renderBoard("en");
    await openEditorForFirstRow();
    // Move step 2 (Finance approval) UP — the array rewrites, the second
    // step card becomes the first.
    const secondStep = screen.getByTestId("step-2");
    const upButtons = within(secondStep).getAllByRole("button");
    const up = upButtons.find((button) => button.textContent === "Up");
    expect(up).toBeDefined();
    fireEvent.click(up!);
    // The first card now carries Finance approval's name.
    await waitFor(() => {
      const input = within(screen.getByTestId("step-1")).getByLabelText(
        /Step name \(English\)/,
      ) as HTMLInputElement;
      expect(input.value).toBe("Finance approval");
    });
    // Submit — the PUT posts the reordered contiguous ladder.
    fireEvent.click(screen.getByRole("button", { name: "Save definition" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("workflow/definitions/wd-1", {
        method: "PUT",
        body: expect.objectContaining({
          triggerEntity: "purchase_order",
          steps: [
            expect.objectContaining({ name: "Finance approval", slaHours: 48 }),
            expect.objectContaining({ name: "Manager approval", slaHours: null }),
          ],
        }),
      });
    });
  });

  it("(c) THE EXACT CREATE BODY — the trigger event NEVER sent (the mapping law), the conditions in the D-06 operand shape, the SLA whole-hours or null", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: [] });
    renderBoard("en");
    // Open the create pane.
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "New definition" }));
    const nameInputs = await screen.findAllByLabelText(/Name/);
    fireEvent.change(nameInputs[0]!, { target: { value: "Journal two-step" } });
    fireEvent.change(nameInputs[1]!, { target: { value: "قيد بخطوتين" } });
    // The first step's own names.
    const stepOne = screen.getByTestId("step-1");
    fireEvent.change(within(stepOne).getByLabelText(/Step name \(English\)/), {
      target: { value: "Owner approval" },
    });
    fireEvent.change(within(stepOne).getByLabelText(/Step name \(Arabic\)/), {
      target: { value: "موافقة المالك" },
    });
    // Submit the create.
    fireEvent.click(screen.getByRole("button", { name: "Create definition" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("workflow/definitions", {
        method: "POST",
        body: expect.objectContaining({
          name: "Journal two-step",
          nameAr: "قيد بخطوتين",
          triggerEntity: "purchase_order",
          active: true,
          conditions: { all: [] },
          steps: [
            expect.objectContaining({
              stepType: "APPROVAL",
              assigneeRule: "ROLE",
              assigneeValue: "owner",
              slaHours: null,
              name: "Owner approval",
              nameAr: "موافقة المالك",
            }),
          ],
        }),
      });
    });
    // THE MAPPING LAW: no triggerEvent key ever leaves the editor.
    const calls = bffFetchMock.mock.calls;
    for (const call of calls) {
      const body = (call[1] as { body?: Record<string, unknown> } | undefined)?.body;
      if (body !== undefined) {
        expect(Object.prototype.hasOwnProperty.call(body, "triggerEvent")).toBe(false);
      }
    }
  });

  it("(d) the typed refusal renders the validation fold's own payload (the condition named BY PATH)", async () => {
    bffFetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      error: {
        code: "WORKFLOW_CONDITION_INVALID",
        message: "workflow condition invalid at $.all[0].value: the amount threshold needs the canonical 4-dp string shape",
        details: { path: "$.all[0].value", reason: "the amount threshold needs the canonical 4-dp string shape (ADR-0009)" },
      },
    });
    renderBoard("en");
    fireEvent.click(within(screen.getByRole("tablist")).getByRole("button", { name: "New definition" }));
    const nameInputs = await screen.findAllByLabelText(/Name/);
    fireEvent.change(nameInputs[0]!, { target: { value: "X" } });
    fireEvent.change(nameInputs[1]!, { target: { value: "س" } });
    const stepOne = screen.getByTestId("step-1");
    fireEvent.change(within(stepOne).getByLabelText(/Step name \(English\)/), { target: { value: "S" } });
    fireEvent.change(within(stepOne).getByLabelText(/Step name \(Arabic\)/), { target: { value: "خ" } });
    fireEvent.click(screen.getByRole("button", { name: "Create definition" }));
    const refusal = await screen.findByRole("alert");
    expect(within(refusal).getByText("WORKFLOW_CONDITION_INVALID")).toBeTruthy();
    expect(within(refusal).getAllByText(/\$\.all\[0\]\.value/).length).toBeGreaterThanOrEqual(1);
  });

  it("(e) the AR arm — the editor renders by the Arabic dictionary's own words (RTL)", async () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("سلسلة أوامر الشراء الشرطية")).toBeTruthy();
    expect(within(grid).getByText("أمر شراء")).toBeTruthy();
    expect(within(grid).getByText("يدوي")).toBeTruthy();
  });
});
