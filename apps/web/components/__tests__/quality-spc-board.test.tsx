/**
 * PHASE-050 (W-29 — T-15) — the SPC board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW (D-12's zero-parallel-computation core): the
 *   measurements listing renders the store's own rows VERBATIM, and the
 *   chart read renders the PURE module's own figures as STRINGS — the
 *   grand mean, R̄, both charts' limits, σ̂, Cp, Cpk, the excluded count
 *   and the out-of-control flag (a chip) — never a recomputation.
 * - THE INGEST ACT posts the exact body (the 0113 store's ONLY writer).
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  QualitySpecRow,
  SpcChartRow,
  SpcMeasurementRow,
} from "../../lib/api-types";
import { QualitySpcBoard } from "../quality-spc-board";

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

function spec(overrides: Partial<QualitySpecRow> = {}): QualitySpecRow {
  return {
    id: "spec-1",
    itemId: "item-1",
    parameter: "Thickness",
    parameterAr: "السماكة",
    unit: "mm",
    targetValue: "2.500000",
    ucl: "2.600000",
    lcl: "2.400000",
    isActive: true,
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...overrides,
  };
}

function measurement(overrides: Partial<SpcMeasurementRow> = {}): SpcMeasurementRow {
  return {
    id: "sm-1",
    specId: "spec-1",
    value: "2.512000",
    sampledAt: "2026-11-22T08:00:00Z",
    source: "PRODUCTION",
    batchId: "batch-1",
    note: "line 2",
    version: 1,
    createdAt: "2026-11-22T08:00:00Z",
    updatedAt: "2026-11-22T08:00:00Z",
    ...overrides,
  };
}

/** A pinned chart read — the PURE module's own output shape with figures
 * the property tests themselves pin (6dp strings, verbatim). */
function chartRead(): SpcChartRow {
  return {
    spec: spec(),
    chart: {
      subgroupSize: 5,
      subgroups: [
        {
          values: ["2.512000", "2.500000", "2.488000", "2.520000", "2.495000"],
          mean: "2.503000",
          range: "0.032000",
          xOutOfControl: false,
          rOutOfControl: false,
        },
        {
          values: ["2.712000", "2.700000", "2.688000", "2.720000", "2.695000"],
          mean: "2.703000",
          range: "0.032000",
          xOutOfControl: true,
          rOutOfControl: false,
        },
      ],
      excludedCount: 2,
      grandMean: "2.603000",
      rBar: "0.032000",
      xChart: { ucl: "2.521464", lcl: "2.484536" },
      rChart: { ucl: "0.067648", lcl: "0.000000" },
      sigmaHat: "0.013751",
      cp: "2.424089",
      cpk: "0.000000",
      outOfControl: true,
    },
    sampleCount: 12,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof QualitySpcBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <QualitySpcBoard
        locale={locale}
        specs={[spec()]}
        initialSpecId="spec-1"
        initialMeasurements={[measurement()]}
        measurementsError={null}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-050 W-29 — the SPC board", () => {
  it("(a) the measurements listing renders the store's own rows verbatim", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("2.512000")).toBeTruthy();
    expect(within(grid).getByText("2026-11-22T08:00:00Z")).toBeTruthy();
    expect(within(grid).getByText("Production")).toBeTruthy();
    expect(within(grid).getByText("line 2")).toBeTruthy();
    // The batch provenance renders as the presentation short id (mono).
    expect(within(grid).getByText("batch-1")).toBeTruthy();
    // The spec band's own figures (the spec picker's DefList).
    expect(screen.getByText("2.500000")).toBeTruthy();
    expect(screen.getByText("2.600000")).toBeTruthy();
    expect(screen.getByText("2.400000")).toBeTruthy();
  });

  it("(b) THE CHART READ renders the pinned figures VERBATIM as strings (incl. the out-of-control chip + the subgroups table)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "quality/spc/charts/spec-1?subgroupSize=5") {
        return { ok: true, data: chartRead() };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the chart pane (the data-slot switch — never Tabs).
    fireEvent.click(screen.getByRole("button", { name: "Chart" }));
    fireEvent.click(screen.getByRole("button", { name: "Compute the chart" }));
    // THE PINNED FIGURES — the pure module's own strings, VERBATIM (R̄
    // carries in every subgroup row too — by design).
    await waitFor(() => {
      expect(screen.getByText("2.603000")).toBeTruthy(); // grand mean
      expect(screen.getAllByText("0.032000").length).toBeGreaterThanOrEqual(3); // R̄ + the ranges
      expect(screen.getByText("2.521464")).toBeTruthy(); // X UCL
      expect(screen.getByText("2.484536")).toBeTruthy(); // X LCL
      expect(screen.getByText("0.067648")).toBeTruthy(); // R UCL
      expect(screen.getAllByText("0.000000").length).toBeGreaterThanOrEqual(2); // R LCL + Cpk
      expect(screen.getByText("0.013751")).toBeTruthy(); // σ̂
      expect(screen.getByText("2.424089")).toBeTruthy(); // Cp
      expect(screen.getByText("12")).toBeTruthy(); // sample count
    });
    // THE OUT-OF-CONTROL FLAG — the chip (the engine's own boolean).
    expect(screen.getAllByText("Out of control").length).toBeGreaterThanOrEqual(1);
    // THE SUBGROUPS TABLE — the values/mean/range verbatim + the flags.
    expect(screen.getByText("2.512000, 2.500000, 2.488000, 2.520000, 2.495000")).toBeTruthy();
    expect(screen.getByText("2.503000")).toBeTruthy();
    expect(screen.getByText("2.703000")).toBeTruthy();
    // The second subgroup's X flag fires (the chip again) and the first
    // stays in control.
    expect(screen.getAllByText("Out of control").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("In control").length).toBeGreaterThanOrEqual(2);
  });

  it("(c) AR renders Arabic-first (the source vocabulary + the pane switch + the spec labels)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("إنتاج")).toBeTruthy();
    // The pane switch carries the pane label (the screen's own card rides
    // the screen title, not the pane word).
    expect(screen.getAllByText("العينات").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("الخريطة")).toBeTruthy();
    // The spec band's own labels + the ingest title (the definition list's
    // terms and the form's own words).
    expect(screen.getByText("القيمة المستهدفة")).toBeTruthy();
    expect(screen.getByText("الحد الأعلى")).toBeTruthy();
    expect(screen.getByText("الحد الأدنى")).toBeTruthy();
    expect(screen.getByText("تسجيل عينة")).toBeTruthy();
  });

  it("(d) THE INGEST ACT posts the exact body (the 0113 store's ONLY writer)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/spc/measurements" && init?.method === "POST") {
        return { ok: true, data: measurement({ id: "sm-2", value: "2.505000" }) };
      }
      if (path === "quality/spc/measurements?specId=spec-1") {
        return { ok: true, data: [measurement()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.change(screen.getByLabelText(/Value \*/), {
      target: { value: "2.505000" },
    });
    fireEvent.change(screen.getByLabelText(/Sampled at \*/), {
      target: { value: "2026-11-23T08:30" },
    });
    fireEvent.change(screen.getByLabelText(/Batch/), {
      target: { value: "0193f000-0000-7000-8000-00000000b001" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    // THE EXACT BODY — the engine's own contract (source MANUAL, the batch
    // provenance optional but carried).
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/spc/measurements", {
        method: "POST",
        body: {
          specId: "spec-1",
          value: "2.505000",
          sampledAt: "2026-11-23T08:30",
          source: "MANUAL",
          batchId: "0193f000-0000-7000-8000-00000000b001",
        },
      });
    });
    // The store's read refetches (the chart's own history).
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/spc/measurements?specId=spec-1");
    });
  });
});
