/**
 * PHASE-048 (W-13 — T-15) — the projects contracting board's component
 * tests (the statutory-board pattern: jsdom + the bffFetch mock + the
 * Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the ceiling card renders the billing engine's
 *   own BR-093 figures (approvedCertificates/cumulativeGross/effective/
 *   remaining) VERBATIM — display-only rounding (2dp) with the exact
 *   engine strings in the title attributes; the certificates' retention/
 *   net pair is the engine's BR-092 derivation, rendered as emitted.
 * - THE TABS NO-AGGRAVATION PROOF (the owner's standing clause, the
 *   W-12 precedent): the board rides the DATA-SLOT shape exclusively —
 *   all FOUR panes render their content after switching (the 045
 *   self-board defect cannot reach this board; not touched, not
 *   aggravated — this test is the recorded proof).
 * - The typed-refusal panel renders the code + message + the FULL
 *   details payload — never a generic error.
 * - The change-orders tab rides its OWN key and degrades to the honest
 *   no-permission notice on 403 (the EVM-tab precedent).
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 * - The project-switch re-fetches all six surfaces through the BFF; the
 *   agreement selection loads the sub certificates through the BFF.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  ChangeOrderCeiling,
  ChangeOrderRow,
  ContractingBillingState,
  ProgressCertificateRow,
  ProjectPoolRow,
  RetentionAccountRow,
  SubcontractAgreementRow,
} from "../../lib/api-types";
import {
  ProjectsContractingBoard,
  type ContractingSurfaces,
} from "../projects-contracting-board";

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

const CUSTOMER_REGISTER: RetentionAccountRow = {
  id: "ret-cust",
  projectId: PROJECTS[0]!.id,
  kind: "CUSTOMER",
  subcontractorAgreementId: null,
  customerId: "cust-1",
  contractValue: "115000.0000",
  currencyCode: "SAR",
  holdPercent: "5.00",
  accruedBalance: "4500.0000",
  releasedAmount: "0.0000",
  takingOverDate: "2027-01-15",
  defectLiabilityDate: "2027-10-15",
  status: "ACTIVE",
  releasedAt: null,
  note: null,
  noteAr: null,
  version: 1,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};

const BILLING: ContractingBillingState = {
  register: CUSTOMER_REGISTER,
  approvedCertificates: 2,
  cumulativeGross: "90000.0000",
  effectiveContractValue: "120000.0000",
  remaining: "30000.0000",
};

const CERTIFICATES: readonly ProgressCertificateRow[] = [
  {
    id: "cert-1",
    projectId: PROJECTS[0]!.id,
    certificateNo: "PC-001",
    certificateDate: "2026-10-31",
    kind: "PROGRESS",
    cumulativePercent: "45.00",
    grossValue: "45000.0000",
    retentionAmount: "2250.0000",
    netValue: "42750.0000",
    currencyCode: "SAR",
    status: "APPROVED",
    submittedAt: "2026-10-31T10:00:00Z",
    approvedAt: "2026-11-01T09:00:00Z",
    voidedAt: null,
    voidReason: null,
    salesInvoiceId: "inv-1",
    advanceAppliedAmount: "0.0000",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  },
  {
    id: "cert-2",
    projectId: PROJECTS[0]!.id,
    certificateNo: "PC-002",
    certificateDate: "2026-11-30",
    kind: "FINAL",
    cumulativePercent: "100.00",
    grossValue: "55000.0000",
    retentionAmount: "2750.0000",
    netValue: "52250.0000",
    currencyCode: "SAR",
    status: "DRAFT",
    submittedAt: null,
    approvedAt: null,
    voidedAt: null,
    voidReason: null,
    salesInvoiceId: null,
    advanceAppliedAmount: "5000.0000",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-30T00:00:00Z",
    updatedAt: "2026-11-30T00:00:00Z",
  },
];

const RETENTION: readonly RetentionAccountRow[] = [
  CUSTOMER_REGISTER,
  {
    id: "ret-sub",
    projectId: PROJECTS[0]!.id,
    kind: "SUBCONTRACTOR",
    subcontractorAgreementId: "sub-1",
    customerId: null,
    contractValue: "30000.0000",
    currencyCode: "SAR",
    holdPercent: "10.00",
    accruedBalance: "1200.0000",
    releasedAmount: "0.0000",
    takingOverDate: null,
    defectLiabilityDate: null,
    status: "ACTIVE",
    releasedAt: null,
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  },
];

const CHANGE_ORDERS: readonly ChangeOrderRow[] = [
  {
    id: "co-1",
    projectId: PROJECTS[0]!.id,
    coNo: "CO-001",
    title: "Additional podium level",
    titleAr: "دور إضافي",
    scopeDelta: "One more podium level",
    scopeDeltaAr: null,
    priceDelta: "5000.0000",
    scheduleDeltaDays: 7,
    status: "APPROVED",
    submittedAt: "2026-11-05T10:00:00Z",
    approvedAt: "2026-11-06T10:00:00Z",
    rejectedAt: null,
    rejectionReason: null,
    effectAppliedAt: "2026-11-06T10:00:01Z",
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-11-05T00:00:00Z",
    updatedAt: "2026-11-06T00:00:00Z",
  },
];

const CEILING: ChangeOrderCeiling = {
  projectId: PROJECTS[0]!.id,
  contractBase: {
    contractValue: "115000.0000",
    currencyCode: "SAR",
    holdPercent: "5.00",
  },
  approvedChangeOrders: 1,
  priceDeltaSum: "5000.0000",
  effectiveContractValue: "120000.0000",
  scheduleDeltaDaysSum: 7,
  approvedBudgetTotal: "100000.0000",
  budgetCeiling: "105000.0000",
};

const SUBCONTRACTS: readonly SubcontractAgreementRow[] = [
  {
    id: "sub-1",
    projectId: PROJECTS[0]!.id,
    partnerId: "0194a000-0000-7000-8000-00000000part",
    agreementNo: "SUB-001",
    title: "Electrical works package",
    titleAr: "حزمة الأعمال الكهربائية",
    scope: null,
    agreementValue: "30000.0000",
    currencyCode: "SAR",
    retentionPercent: "10.00",
    startDate: "2026-06-01",
    endDate: "2026-12-31",
    status: "ACTIVE",
    activatedAt: "2026-06-01T00:00:00Z",
    closedAt: null,
    cancelReason: null,
    note: null,
    noteAr: null,
    version: 1,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
  },
];

function surfaces(overrides: Partial<ContractingSurfaces> = {}): ContractingSurfaces {
  return {
    billing: BILLING,
    billingError: null,
    certificates: CERTIFICATES,
    certificatesError: null,
    retention: RETENTION,
    retentionError: null,
    changeOrders: CHANGE_ORDERS,
    changeOrdersError: null,
    ceiling: CEILING,
    ceilingError: null,
    subcontracts: SUBCONTRACTS,
    subcontractsError: null,
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof ProjectsContractingBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <ProjectsContractingBoard
        locale={locale}
        initialProjects={PROJECTS}
        initialProjectId={PROJECTS[0]!.id}
        initialSurfaces={surfaces()}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-048 W-13 — the projects contracting board", () => {
  it("(a) the ceiling card renders the billing engine's BR-093 figures verbatim (display-only rounding, the exact string in the title)", () => {
    renderBoard("en");
    // The engine's own counts + figures (2dp display, exact in title).
    expect(screen.getByText("2")).toBeTruthy(); // approvedCertificates
    expect(screen.getByText("90,000.00 SAR")).toBeTruthy();
    expect(screen.getByText("120,000.00 SAR")).toBeTruthy();
    expect(screen.getByText("30,000.00 SAR")).toBeTruthy();
    const exact = screen.getByTitle("90000.0000");
    expect(exact).toBeTruthy();
    // The certificates table renders the engine's BR-092 pair + the kind.
    expect(screen.getAllByText("PC-001").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("45,000.00 SAR")).toBeTruthy();
    expect(screen.getByText("2,250.00 SAR")).toBeTruthy();
    expect(screen.getByText("42,750.00 SAR")).toBeTruthy();
    expect(screen.getByText("Progress")).toBeTruthy();
    expect(screen.getByText("Final")).toBeTruthy();
    expect(screen.getByText("APPROVED")).toBeTruthy();
    expect(screen.getByText("DRAFT")).toBeTruthy();
  });

  it("(b) AR renders Arabic-first (the AR labels + the kind vocabulary)", () => {
    renderBoard("ar");
    expect(screen.getByText("تعاقدات المشاريع")).toBeTruthy();
    expect(screen.getByText("المستخلصات")).toBeTruthy();
    expect(screen.getByText("مستخلص نهائي")).toBeTruthy();
    expect(screen.getByText("المتبقي تحت السقف")).toBeTruthy();
  });

  it("(c) THE TABS NO-AGGRAVATION PROOF — all four panes render after switching (the data-slot shape)", () => {
    renderBoard("en");
    // The certificates pane is visible initially (the ceiling card).
    expect(screen.getByText(/Cumulative billing state/)).toBeTruthy();

    // Retention pane: the ledger rows (the customer register + the sub row).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Retention" }));
    expect(screen.getByText("Customer (contract register)")).toBeTruthy();
    expect(screen.getByText("Subcontractor")).toBeTruthy();
    expect(screen.getByText("1,200.00 SAR")).toBeTruthy();

    // Change-orders pane: the re-baselined ceilings + the engine's rows.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Change orders" }));
    expect(screen.getByText(/Re-baselined ceilings/)).toBeTruthy();
    expect(screen.getByText("105,000.00 SAR")).toBeTruthy(); // budgetCeiling
    expect(screen.getByText("CO-001")).toBeTruthy();
    expect(screen.getByText("Additional podium level")).toBeTruthy();

    // Subcontracts pane: the agreements + the certificates selector card.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Subcontracts" }));
    expect(screen.getByText("SUB-001")).toBeTruthy();
    expect(screen.getByText("Electrical works package")).toBeTruthy();
    expect(screen.getByText(/Select an agreement to load its certificates/)).toBeTruthy();

    // Back to the certificates pane — the pane still renders (the slots
    // map routes every pane; the 045 defect's null-overwrite never runs).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Certificates" }));
    expect(screen.getByText(/Cumulative billing state/)).toBeTruthy();
  });

  it("(d) the typed refusal renders WITH ITS PAYLOAD (the ceiling's own figures), never a generic error", () => {
    renderBoard("en", {
      initialSurfaces: surfaces({
        billing: null,
        billingError: {
          code: "BILLING_CEILING_EXCEEDED",
          message: "cumulative billing would exceed the approved contract value including approved change orders",
          details: {
            cumulativeGross: "125000.0000",
            effectiveContractValue: "120000.0000",
            excess: "5000.0000",
          },
        },
      }),
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("BILLING_CEILING_EXCEEDED")).toBeTruthy();
    expect(
      within(panel).getByText(/would exceed the approved contract value/),
    ).toBeTruthy();
    expect(within(panel).getByText("cumulativeGross")).toBeTruthy();
    expect(within(panel).getByText("125000.0000")).toBeTruthy();
    expect(within(panel).getByText("excess")).toBeTruthy();
  });

  it("(e) the change-orders 403 degrades to the honest no-permission notice (its own key)", () => {
    renderBoard("en", {
      initialSurfaces: surfaces({
        changeOrders: null,
        changeOrdersError: { code: "FORBIDDEN", message: "projects.change_order.view required" },
        ceiling: null,
        ceilingError: { code: "FORBIDDEN", message: "projects.change_order.view required" },
      }),
    });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Change orders" }));
    const notices = screen.getAllByText(
      /projects\.change_order\.view key — nothing is shown here/,
    );
    expect(notices.length).toBe(2); // the ceiling card + the table
    expect(screen.queryByTestId("typed-refusal")).toBeNull();
  });

  it("(f) switching projects re-fetches all six surfaces through the BFF", async () => {
    bffFetchMock.mockImplementation(async () => ({ ok: true, data: null }));
    renderBoard("en");
    const select = screen.getByLabelText("Project");
    fireEvent.change(select, { target: { value: PROJECTS[1]!.id } });
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/billing`);
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/certificates`);
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/retention`);
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/change-orders`);
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/change-orders/ceiling`);
      expect(bffFetchMock).toHaveBeenCalledWith(`projects/${PROJECTS[1]!.id}/subcontracts`);
    });
    // Wait for the load to SETTLE inside the test (the honest no-data
    // notices render) — the continuation never leaks past cleanup.
    await waitFor(() => {
      expect(screen.getAllByText(/No data\./).length).toBeGreaterThanOrEqual(2);
    });
  });

  it("(g) the empty pool renders the honest no-projects notice", () => {
    renderBoard("en", {
      initialProjects: [],
      initialProjectId: null,
      initialSurfaces: surfaces({
        billing: null,
        certificates: null,
        retention: null,
        changeOrders: null,
        ceiling: null,
        subcontracts: null,
      }),
    });
    expect(screen.getByText(/No projects available for your session/)).toBeTruthy();
  });

  it("(h) selecting an agreement loads its certificates through the BFF (the engine's sub مستخلص rows)", async () => {
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === "projects/subcontracts/sub-1/certificates") {
        return {
          ok: true,
          data: [
            {
              id: "subcert-1",
              agreementId: "sub-1",
              certificateNo: "SC-001",
              certificateDate: "2026-09-30",
              progressPercent: "40.00",
              grossValue: "12000.0000",
              retentionWithheld: "1200.0000",
              netPayable: "10800.0000",
              status: "APPROVED",
              approvedAt: "2026-10-01T09:00:00Z",
              apJournalEntryId: "je-1",
              note: null,
              noteAr: null,
              version: 1,
              createdAt: "2026-09-30T00:00:00Z",
              updatedAt: "2026-10-01T00:00:00Z",
            },
          ],
        };
      }
      return { ok: true, data: null };
    });
    renderBoard("en");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Subcontracts" }));
    const selector = screen.getByLabelText("Agreement certificates");
    fireEvent.change(selector, { target: { value: "sub-1" } });
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("projects/subcontracts/sub-1/certificates");
      expect(screen.getByText("SC-001")).toBeTruthy();
      expect(screen.getByText("10,800.00 SAR")).toBeTruthy();
    });
  });
});
