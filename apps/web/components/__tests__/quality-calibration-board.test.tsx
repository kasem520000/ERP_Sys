/**
 * PHASE-050 (W-29 — T-15) — the calibration board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the register renders the engine's own shapes
 *   VERBATIM — the record's own calibrationNo/calibratedAt/dueDate and the
 *   result vocabulary through the dictionary; the sweep config's thresholds
 *   ladder renders as the engine's own strings.
 * - THE SWEEP-CONFIG WRITE posts the exact body {thresholds}.
 * - THE RECORD ACT posts the exact body (the engine's own floor).
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  CalibrationRow,
  CalibrationSweepConfigRow,
  FixedAssetRow,
} from "../../lib/api-types";
import { QualityCalibrationBoard } from "../quality-calibration-board";

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

/** The standard Radix+jsdom workaround (the hr-training spec's own helper):
 * focus the trigger, Enter to open the listbox, click the option. */
function pickSelect(labelText: string | RegExp, optionName: string | RegExp): void {
  const trigger = screen.getByLabelText(labelText);
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ASSET: FixedAssetRow = {
  id: "asset-1",
  code: "CAL-100",
  name: "Micrometer",
  nameAr: "ميكرومتر",
  categoryId: "cat-1",
  acquisitionDate: "2026-01-01",
  cost: "5000",
  salvageValue: "0",
  openingAccumulated: "0",
  usefulLifeMonths: 60,
  depreciationMethod: "STRAIGHT_LINE",
  totalEstimatedUnits: null,
  branchId: "branch-1",
  custodianUserId: null,
  status: "ACTIVE",
  sourceType: null,
  sourceId: null,
  warrantyExpiry: null,
  insuranceExpiry: null,
  licenseExpiry: null,
  inspectionExpiry: null,
  costCenterId: null,
  parentAssetId: null,
  note: null,
  noteAr: null,
  disposedAt: null,
  writtenOffAt: null,
  createdBy: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

function calibration(overrides: Partial<CalibrationRow> = {}): CalibrationRow {
  return {
    id: "cal-1",
    calibrationNo: "CAL-2026-000031",
    assetId: "asset-1",
    standardUsed: "ISO 3611 gauge block",
    result: "PASS",
    calibratedAt: "2026-11-01T09:00:00Z",
    dueDate: "2027-05-01",
    providerId: null,
    certificateRef: "CERT-889",
    externalCost: "250.0000",
    journalEntryId: "journal-4",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-01T09:00:00Z",
    updatedAt: "2026-11-01T09:00:00Z",
    ...overrides,
  };
}

function sweepConfig(overrides: Partial<CalibrationSweepConfigRow> = {}): CalibrationSweepConfigRow {
  return {
    key: "quality.calibration_sweep_thresholds",
    thresholds: [30, 7, 0],
    default: [30, 7, 0],
    stored: true,
    lastRun: {
      at: "2026-11-22T04:00:00Z",
      outcome: { windows: [30, 7, 0], flagged: 3, notified: 3 },
    },
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof QualityCalibrationBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <QualityCalibrationBoard
        locale={locale}
        initialCalibrations={[calibration()]}
        calibrationsError={null}
        initialSweepConfig={sweepConfig()}
        sweepConfigError={null}
        assets={[ASSET]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-050 W-29 — the calibration board", () => {
  it("(a) the listing renders the engine's own shapes verbatim + the sweep ladder as the engine's strings", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    // The record's own figures (mono, verbatim).
    expect(within(grid).getByText("CAL-2026-000031")).toBeTruthy();
    expect(within(grid).getByText("2026-11-01T09:00:00Z")).toBeTruthy();
    expect(within(grid).getByText("2027-05-01")).toBeTruthy();
    expect(within(grid).getByText("250.0000")).toBeTruthy();
    expect(within(grid).getByText("CERT-889")).toBeTruthy();
    // The presentation join (never a bare uuid) + the result vocabulary.
    expect(within(grid).getByText("CAL-100 · Micrometer")).toBeTruthy();
    expect(within(grid).getByText("Pass")).toBeTruthy();
    // THE SWEEP LADDER — the engine's own strings, verbatim ([30,7,0] as
    // stored — the thresholds AND the default both carry it here, by
    // design — plus the last run's own seal).
    expect(screen.getAllByText("30, 7, 0").length).toBe(2);
    expect(screen.getByText("2026-11-22T04:00:00Z")).toBeTruthy();
  });

  it("(b) AR renders Arabic-first (the result vocabulary + the pane switch + the sweep title)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("اجتاز")).toBeTruthy();
    expect(within(grid).getByText("CAL-100 · ميكرومتر")).toBeTruthy();
    // The pane switch + the pane card both carry the pane label (by design).
    expect(screen.getAllByText("السجل").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("تسجيل معايرة")).toBeTruthy();
    expect(screen.getByText("إعدادات مسح المعايرة")).toBeTruthy();
  });

  it("(c) THE SWEEP-CONFIG WRITE posts the exact body {thresholds}", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/calibration/sweep-config" && init?.method === "PUT") {
        return { ok: true, data: sweepConfig({ thresholds: [45, 14, 3] }) };
      }
      if (path === "quality/calibration/sweep-config") {
        return { ok: true, data: sweepConfig() };
      }
      if (path === "quality/calibration") {
        return { ok: true, data: [calibration()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // The thresholds ladder's write door (the operator's own ladder).
    const input = screen.getByLabelText(/Thresholds \(days, descending\)/);
    fireEvent.change(input, { target: { value: "45, 14, 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save thresholds" }));
    // THE EXACT BODY — the parsed ladder, never an engine figure.
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/calibration/sweep-config", {
        method: "PUT",
        body: { thresholds: [45, 14, 3] },
      });
    });
    // The engine's own answer renders verbatim (the new ladder).
    await waitFor(() => {
      expect(screen.getByText("45, 14, 3")).toBeTruthy();
    });
  });

  it("(d) THE RECORD ACT posts the exact body (the engine's own floor)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/calibration" && init?.method === "POST") {
        return { ok: true, data: calibration({ id: "cal-2", calibrationNo: "CAL-2026-000032" }) };
      }
      if (path === "quality/calibration") {
        return { ok: true, data: [calibration()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the record pane (the data-slot switch — never Tabs).
    fireEvent.click(screen.getByRole("button", { name: "Record calibration" }));
    // The instrument select (the standard Radix+jsdom workaround; the
    // required asterisk rides an aria-hidden span — the anchored regex
    // keeps the pane switch's aria-label out of the match).
    pickSelect(/^Instrument \*$/, "CAL-100 · Micrometer");
    // The create form's own fields.
    fireEvent.change(screen.getByLabelText(/Standard used \*/), {
      target: { value: "ISO 3611 gauge block" },
    });
    fireEvent.change(screen.getByLabelText(/Calibrated at \*/), {
      target: { value: "2026-11-23T10:30" },
    });
    fireEvent.change(screen.getByLabelText(/Due date \*/), {
      target: { value: "2027-05-23" },
    });
    fireEvent.change(screen.getByLabelText(/External cost \(optional\)/), {
      target: { value: "300.0000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    // THE EXACT BODY — the engine's own contract.
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/calibration", {
        method: "POST",
        body: {
          assetId: "asset-1",
          standardUsed: "ISO 3611 gauge block",
          result: "PASS",
          calibratedAt: "2026-11-23T10:30",
          dueDate: "2027-05-23",
          externalCost: "300.0000",
        },
      });
    });
  });
});