/**
 * PHASE-048 (W-12 — T-14) — the projects WBS board's component tests
 * (the statutory-board pattern: jsdom + the bffFetch mock + the Radix
 * idiom):
 *
 * - THE TABS NO-AGGRAVATION PROOF (the owner's W-12 clause 8): the
 *   board rides the DATA-SLOT shape exclusively — all THREE panes
 *   render their content after switching (the 045 self-board defect —
 *   conditional-expression children rendering EMPTY except the last —
 *   cannot reach this board; the defect is NOT touched here, and this
 *   test is the recorded proof).
 * - The engine-output law: the tree renders the W-9 engine's own
 *   rolledPercent/leafCount figures VERBATIM (the P1 world's 56.44 · 5
 *   leaves) — zero client-side recomputation.
 * - The EVM tab renders the W-10 snapshot's figures incl. the four AC
 *   legs; display-only rounding (2dp) with the exact engine string in
 *   the title attribute.
 * - The typed-refusal panel renders the code + message + the FULL
 *   details payload (the cycle path) — never a generic error.
 * - The EVM 403 degrades to the honest no-permission notice.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { EvmSnapshot, ProjectPoolRow, WbsTreeNode } from "../../lib/api-types";
import { ProjectsWbsBoard } from "../projects-wbs-board";

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

const PROJECTS: readonly ProjectPoolRow[] = [
  { id: "0194a000-0000-7000-8000-00000000p001", code: "PJW-PRJ-1", name: "Coherent world project", nameAr: "مشروع العالم المتسق", status: "OPEN" },
  { id: "0194a000-0000-7000-8000-00000000p002", code: "PJW-PRJ-2", name: "Second project", nameAr: "المشروع الثاني", status: "OPEN" },
];

/** The P1 world's root (the engine's own tree output — the W-9 fixture
 * shape): two children, the leaf-recomputed rollup 56.44 over 5 leaves. */
const TREE: WbsTreeNode[] = [
  {
    id: "root",
    projectId: "p1",
    parentTaskId: null,
    predecessorTaskId: null,
    wbsCode: "R",
    name: "Root",
    nameAr: "الجذر",
    isMilestone: false,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    weight: null,
    percentComplete: "0.00",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    rolledPercent: "56.44",
    leafCount: 5,
    weightSum: "101.0000",
    children: [
      {
        id: "leaf-a",
        projectId: "p1",
        parentTaskId: "root",
        predecessorTaskId: null,
        wbsCode: "R.A",
        name: "Task A",
        nameAr: "المهمة أ",
        isMilestone: false,
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        weight: "60.0000",
        percentComplete: "50.00",
        note: null,
        noteAr: null,
        version: 1,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        rolledPercent: "50.00",
        leafCount: 1,
        weightSum: "60.0000",
        children: [],
      },
      {
        id: "leaf-m",
        projectId: "p1",
        parentTaskId: "root",
        predecessorTaskId: "leaf-a",
        wbsCode: "R.M",
        name: "Handover",
        nameAr: "التسليم",
        isMilestone: true,
        startDate: "2026-12-31",
        endDate: "2026-12-31",
        weight: null,
        percentComplete: "100.00",
        note: null,
        noteAr: null,
        version: 1,
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
        rolledPercent: "100.00",
        leafCount: 1,
        weightSum: "1.0000",
        children: [],
      },
    ],
  },
];

const EVM: EvmSnapshot = {
  projectId: "p1",
  asOf: "2026-11-20",
  budget: {
    budgetId: "b1",
    approvedTotal: "4100.0000",
    approvedChangeOrders: 1,
    priceDeltaSum: "250.0000",
    bac: "4350.0000",
  },
  pv: "2600.0000",
  ev: {
    structural: { percent: "56.44", value: "2313.8614" },
    certificate: {
      certificateId: "c1",
      certificateNo: "PC-001",
      kind: "PROGRESS",
      cumulativePercent: "55.00",
      value: "2255.0000",
    },
    delta: "58.8614",
    signal: "STRUCTURAL_AHEAD",
  },
  ac: {
    labor: "820.3125",
    materials: "500.0000",
    subcontract: "9000.0000",
    overhead: "625.0000",
    total: "10945.3125",
    unpricedCount: 0,
    degradedMaterials: false,
    degradedOverhead: false,
  },
  indices: { cpi: "0.211285", spi: "0.889947" },
  forecast: { etc: "5181.0886", eac: "16126.4011", method: "CPI_BASED" },
  nodes: [
    {
      wbsTaskId: "leaf-a",
      wbsCode: "R.A",
      name: "Task A",
      planned: "2400.0000",
      pv: "2400.0000",
      rolledPercent: "50.00",
      ev: "1200.0000",
      acLabor: "820.3125",
      cpi: null,
      spi: null,
    },
  ],
  disclosures: ["AC includes 0 unpriced labor entries."],
};

function renderBoard(locale: "ar" | "en", overrides: Partial<Parameters<typeof ProjectsWbsBoard>[0]> = {}) {
  return render(
    <ToastProvider>
      <ProjectsWbsBoard
        locale={locale}
        initialProjects={PROJECTS}
        initialProjectId={PROJECTS[0]!.id}
        initialTree={TREE}
        initialTreeError={null}
        initialEvm={EVM}
        initialEvmError={null}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-048 W-12 — the projects WBS board", () => {
  it("(a) the tree renders the engine's own figures verbatim (the rollup badge + the dependency code + the milestone)", () => {
    renderBoard("en");
    // The engine's rolledPercent + leafCount ride the root's badge.
    expect(screen.getByText("56.44 · 5 leaves")).toBeTruthy();
    // The leaf's own percent (the engine string, LTR mono).
    expect(screen.getByText("50.00")).toBeTruthy();
    // The milestone badge + the dependency rendered BY CODE (the code
    // column and the dependency column both carry R.A — the length).
    expect(screen.getByText("Milestone")).toBeTruthy();
    expect(screen.getAllByText("R.A").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Depends on")).toBeTruthy();
  });

  it("(b) AR renders Arabic-first (the localized name + the AR column headers)", () => {
    renderBoard("ar");
    expect(screen.getByText("الجذر")).toBeTruthy();
    expect(screen.getByText("المهمة أ")).toBeTruthy();
    expect(screen.getByText("يعتمد على")).toBeTruthy();
    expect(screen.getByText("معلم")).toBeTruthy();
  });

  it("(c) THE TABS NO-AGGRAVATION PROOF — all three panes render after switching (the data-slot shape)", () => {
    renderBoard("en");
    // The tree pane is visible initially (the rollup badge).
    expect(screen.getByText("56.44 · 5 leaves")).toBeTruthy();

    // Switch to the timeline pane: the Gantt-ish bars render (the plan
    // range + the task codes on the track).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Timeline" }));
    expect(screen.getByText(/Plan range/)).toBeTruthy();
    expect(screen.getByText("R.M")).toBeTruthy();

    // Switch to the EVM pane: the engine's figures render — the four AC
    // legs, the CPI, the disclosures.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Earned value" }));
    expect(screen.getByText("Labor")).toBeTruthy();
    expect(screen.getByText("Materials")).toBeTruthy();
    expect(screen.getByText("Subcontract")).toBeTruthy();
    expect(screen.getByText("Overhead")).toBeTruthy();
    expect(screen.getByText("9,000.00 SAR")).toBeTruthy(); // display-only rounding
    expect(screen.getByText("Engine disclosures")).toBeTruthy();

    // Back to the tree pane — the pane still renders (the slots map
    // routes every pane; the 045 defect's null-overwrite never runs).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Tree" }));
    expect(screen.getByText("56.44 · 5 leaves")).toBeTruthy();
  });

  it("(d) the typed refusal renders WITH ITS PAYLOAD (the cycle path + the figures), never a generic error", () => {
    renderBoard("en", {
      initialTree: null,
      initialTreeError: {
        code: "WBS_CYCLE",
        message: "moving task R.B.2 under R.B.2.1 would create a dependency cycle",
        details: { path: ["R.B.2", "R.B.2.1", "R.B.2"], taskId: "leaf-b2" },
      },
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("WBS_CYCLE")).toBeTruthy();
    expect(
      within(panel).getByText(/would create a dependency cycle/),
    ).toBeTruthy();
    // The payload rows (the cycle path included).
    expect(within(panel).getByText("path")).toBeTruthy();
    expect(within(panel).getByText('["R.B.2","R.B.2.1","R.B.2"]')).toBeTruthy();
    expect(within(panel).getByText("taskId")).toBeTruthy();
  });

  it("(e) the EVM 403 degrades to the honest no-permission notice (its own key)", () => {
    renderBoard("en", {
      initialEvm: null,
      initialEvmError: { code: "FORBIDDEN", message: "projects.evm.view required" },
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Earned value" }));
    expect(
      screen.getByText(/projects\.evm\.view key — nothing is shown here/),
    ).toBeTruthy();
    expect(screen.queryByTestId("typed-refusal")).toBeNull();
  });

  it("(f) switching projects re-fetches the tree + the EVM through the BFF", async () => {
    bffFetchMock.mockResolvedValue({ ok: true, data: [] } as never);
    renderBoard("en");
    const select = screen.getByLabelText("Project");
    fireEvent.change(select, { target: { value: PROJECTS[1]!.id } });
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/wbs`);
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/evm`);
    });
  });

  it("(g) the empty pool renders the honest no-projects notice", () => {
    renderBoard("en", {
      initialProjects: [],
      initialProjectId: null,
      initialTree: null,
      initialEvm: null,
    });
    expect(screen.getByText(/No projects in this tenant yet/)).toBeTruthy();
  });
});
