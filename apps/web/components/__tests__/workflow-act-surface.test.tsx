/**
 * PHASE-052 (W-48 — T-06's web half, D-09) THE DEEP-LINK ACT SURFACE'S
 * component tests: the email leg's landing renders the token's own
 * preview (the doc facts, the step, the deadline, the awaiting flag),
 * the act posts the exact body (token + comment), the outcome renders
 * the chain's own figures, and the DEAD LINK previews as the typed
 * refusal (the expired class) — never a stale form.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { DeepLinkPreview } from "../../lib/api-types";
import { WorkflowActSurface } from "../workflow-act-surface";

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

function preview(overrides: Partial<DeepLinkPreview> = {}): DeepLinkPreview {
  return {
    action: "approve",
    stepInstanceId: "si-1",
    stepOrder: 2,
    stepName: "Finance approval",
    stepNameAr: "موافقة المالية",
    instanceId: "wi-1",
    triggerEntity: "purchase_order",
    documentId: "po-1",
    documentNo: "PO-2026-000042",
    amountBase: "61250.0000",
    currency: "SAR",
    deadline: "2026-12-01T08:00:00Z",
    awaiting: true,
    ...overrides,
  };
}

function renderSurface(locale: "ar" | "en") {
  return render(
    <ToastProvider>
      <WorkflowActSurface locale={locale} token="tok-1" />
    </ToastProvider>,
  );
}

describe("PHASE-052 W-48 — the deep-link act surface", () => {
  it("(a) the preview renders the token's own facts (the step, the doc, the amount, the deadline, the awaiting flag)", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: preview() });
    renderSurface("en");
    expect(await screen.findByText(/Finance approval/)).toBeTruthy();
    expect(screen.getByText(/PO-2026-000042/)).toBeTruthy();
    expect(screen.getByText(/61250.0000/)).toBeTruthy();
    expect(screen.getByText(/Purchase order/)).toBeTruthy();
    // The awaiting flag renders the deadline window.
    expect(screen.getByText(/Awaiting your action until/)).toBeTruthy();
  });

  it("(b) the act posts the exact body (token + comment) and renders the chain's outcome", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path === "workflow/act" && init?.method === "POST") {
        return {
          ok: true,
          data: { action: "approve", stepInstanceId: "si-1", completed: true, remaining: 0, currentStepOrder: null, completedSteps: 2 },
        };
      }
      return { ok: true, data: preview() };
    });
    renderSurface("en");
    await screen.findByText(/Finance approval/);
    fireEvent.change(screen.getByLabelText(/Comment/), {
      target: { value: "Approved from the email link" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("workflow/act", {
        method: "POST",
        body: { token: "tok-1", comment: "Approved from the email link" },
      });
    });
    // The chain completed with this act.
    expect(await screen.findByText(/The chain completed with this act./)).toBeTruthy();
  });

  it("(c) the DEAD LINK previews as the typed refusal (the expired class — never a stale form)", async () => {
    bffFetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      error: {
        code: "WORKFLOW_TOKEN_EXPIRED",
        message: "the token's deadline passed",
        details: { deadline: "2026-11-01T00:00:00Z" },
      },
    });
    renderSurface("en");
    const refusal = await screen.findByRole("alert");
    expect(within(refusal).getByText("WORKFLOW_TOKEN_EXPIRED")).toBeTruthy();
    expect(within(refusal).getAllByText(/deadline/).length).toBeGreaterThanOrEqual(1);
    // No act buttons on a dead link.
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("(d) the AR arm — the Arabic dictionary's own words (RTL)", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: preview() });
    renderSurface("ar");
    expect(await screen.findByText(/موافقة المالية/)).toBeTruthy();
    expect(screen.getByText("أمر شراء")).toBeTruthy();
    expect(screen.getByText(/بانتظار إجرائك حتى/)).toBeTruthy();
  });
});
