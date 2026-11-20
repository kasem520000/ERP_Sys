/**
 * PHASE-048 (W-13 — T-16) — the field-service dispatch board's component
 * tests (the statutory-board pattern: jsdom + the bffFetch mock + the
 * Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the visits table renders the W-12 listing's
 *   own shapes VERBATIM — the machine's stamps, the pause badge, the
 *   presentation join (the parent order's own number + the technician's
 *   own names); the SLA panel renders the pure fold's own readings
 *   (elapsedMs/pausedMs/targetMs/overMs) with the hours view DISPLAY-ONLY
 *   (one 3,600,000 division — the exact ms in the title attributes).
 * - The SLA evaluation rides the DEDICATED endpoint (the pure-read law:
 *   the listing never escalates; the evaluation act is the operator's).
 * - The escalation renders with its dedupe key + the notified flag.
 * - The typed refusal renders with its FULL payload.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 * - The status filter re-fetches through the BFF with the query param.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { ServiceVisitRow, SlaEvaluation } from "../../lib/api-types";
import { ProjectsFieldserviceBoard } from "../projects-fieldservice-board";

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

const HOUR = 3_600_000;

function visit(overrides: Partial<ServiceVisitRow> = {}): ServiceVisitRow {
  return {
    id: "visit-1",
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T08:00:00Z",
    createdBy: null,
    updatedBy: null,
    serviceOrderId: "order-1",
    technicianEmployeeId: "tech-1",
    scheduledStart: "2026-11-20T08:00:00Z",
    scheduledEnd: "2026-11-20T12:00:00Z",
    status: "IN_PROGRESS",
    dispatchedAt: "2026-11-20T08:30:00Z",
    firstRespondedAt: "2026-11-20T09:00:00Z",
    startedAt: "2026-11-20T09:15:00Z",
    completedAt: null,
    closedAt: null,
    isPaused: true,
    completionNotes: null,
    completionNotesAr: null,
    note: "the visit",
    noteAr: "الزيارة",
    version: 3,
    orderNo: "SO-2026-000042",
    technicianName: "Lina Al-Muhandisa",
    technicianNameAr: "لينا المهندسة",
    ...overrides,
  };
}

const SLA: SlaEvaluation = {
  visitId: "visit-1",
  targets: { responseHours: 2, resolutionHours: 8 },
  response: {
    kind: "RESPONSE",
    running: false,
    startedAt: 1,
    endedAt: 2,
    pausedMs: 0,
    elapsedMs: 30 * 60 * 1000, // 0.50h
    targetMs: 2 * HOUR,
    breached: false,
    overMs: 0,
  },
  resolution: {
    kind: "RESOLUTION",
    running: true,
    startedAt: 1,
    endedAt: null,
    pausedMs: 3 * HOUR, // the pause subtraction (the W-12 golden's shape)
    elapsedMs: 6 * HOUR - 3 * HOUR, // 6h wall − 3h paused = 3h
    targetMs: 2 * HOUR,
    breached: true,
    overMs: 1 * HOUR,
  },
  escalations: [
    {
      clock: "RESOLUTION",
      overMs: 1 * HOUR,
      dedupeKey: "fieldservice-sla-breach:visit-1:RESOLUTION",
      notified: true,
    },
  ],
};

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof ProjectsFieldserviceBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <ProjectsFieldserviceBoard
        locale={locale}
        initialVisits={[visit()]}
        initialError={null}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-048 W-13 — the field-service dispatch board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the join's handles + the stamps + the pause badge)", () => {
    renderBoard("en");
    // The presentation join's handles (never bare uuids).
    expect(screen.getByText("SO-2026-000042")).toBeTruthy();
    expect(screen.getByText("Lina Al-Muhandisa")).toBeTruthy();
    // The machine's own stamps (mono, verbatim).
    expect(screen.getByText("2026-11-20T08:30:00Z")).toBeTruthy();
    expect(screen.getByText("2026-11-20T09:15:00Z")).toBeTruthy();
    // The status + the pause badge (scoped to the grid — the filter's
    // <option> carries the same vocabulary label by design).
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("In progress")).toBeTruthy();
    expect(screen.getByText("Paused")).toBeTruthy();
  });

  it("(b) AR renders Arabic-first (the localized technician + the AR labels)", () => {
    renderBoard("ar");
    expect(screen.getByText("لينا المهندسة")).toBeTruthy();
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("قيد التنفيذ")).toBeTruthy();
    expect(screen.getByText("متوقف مؤقتًا")).toBeTruthy();
    expect(screen.getByText("أمر الخدمة")).toBeTruthy();
  });

  it("(c) the SLA evaluation rides the DEDICATED endpoint and renders the fold's own readings (the hours view display-only, the exact ms in the titles)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "projects/fieldservice/visits/visit-1/sla") {
        return { ok: true, data: SLA };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Evaluate SLA" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("projects/fieldservice/visits/visit-1/sla");
    });
    // The panel: the registered targets + both clocks + the escalation
    // with its dedupe key + the notified flag.
    await waitFor(() => {
      expect(screen.getByText("The single clock's reading")).toBeTruthy();
      expect(screen.getByText("2 / 8")).toBeTruthy();
      expect(screen.getByText("Response clock")).toBeTruthy();
      // The resolution card's title + the escalation chip carry the same
      // clock label — BOTH are the proof (the fold + BR-096's own kind).
      expect(screen.getAllByText("Resolution clock").length).toBeGreaterThanOrEqual(2);
      // 6h wall − 3h paused = 3h (the W-12 golden's own figures; the
      // exact ms ride the titles) — the elapsed cell AND the paused cell
      // both carry 3.00 (the subtraction's two sides).
      expect(screen.getAllByText("3.00 hours").length).toBe(2);
      expect(screen.getAllByTitle(String(3 * HOUR)).length).toBe(2);
      // Over by 1h — the clock's own over cell + the escalation's chip.
      expect(screen.getAllByText("1.00 hours").length).toBe(2);
      expect(screen.getByText(/fieldservice-sla-breach:visit-1:RESOLUTION/)).toBeTruthy();
      expect(screen.getByText("true")).toBeTruthy(); // notified
    });
  });

  it("(d) the typed refusal renders WITH ITS PAYLOAD (the malformed register's refusal), never a generic error", () => {
    renderBoard("en", {
      initialVisits: null,
      initialError: {
        code: "SLA_REGISTER_MALFORMED",
        message: "the tenant's SLA-target register is malformed",
        details: { register: "{\"response_target_hours\": \"two\"}", hint: "expected positive numbers" },
      },
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("SLA_REGISTER_MALFORMED")).toBeTruthy();
    expect(within(panel).getByText(/register is malformed/)).toBeTruthy();
    expect(within(panel).getByText("register")).toBeTruthy();
    expect(within(panel).getByText("hint")).toBeTruthy();
  });

  it("(e) the NO_TARGET absence renders the honest notice (never a fabricated target)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "projects/fieldservice/visits/visit-1/sla") {
        return {
          ok: true,
          data: {
            ...SLA,
            targets: null,
            response: { ...SLA.response, targetMs: null },
            resolution: { ...SLA.resolution, targetMs: null, breached: false, overMs: 0 },
            escalations: [],
          } satisfies SlaEvaluation,
        };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Evaluate SLA" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(
        screen.getByText(/No SLA-target register for this tenant/),
      ).toBeTruthy();
      // BOTH clocks carry the honest NO_TARGET absence (one per clock).
      expect(screen.getAllByText("No target").length).toBe(2);
      expect(screen.getByText("No escalations.")).toBeTruthy();
    });
  });

  it("(f) the status filter re-fetches through the BFF with the query param", async () => {
    bffFetchMock.mockImplementation(async () => ({ ok: true, data: [] }));
    renderBoard("en");
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "DISPATCHED" },
    });
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("projects/fieldservice/visits?status=DISPATCHED");
    });
    // The listing settles to the honest empty notice.
    await waitFor(() => {
      expect(screen.getByText(/No matching visits/)).toBeTruthy();
    });
  });

  it("(g) the empty listing renders the honest no-visits notice", () => {
    renderBoard("en", { initialVisits: [] });
    expect(screen.getByText(/No matching visits/)).toBeTruthy();
  });
});
