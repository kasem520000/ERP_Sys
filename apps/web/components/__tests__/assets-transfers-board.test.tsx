/**
 * PHASE-049 (W-21 — T-14) — the transfers board's component tests (the
 * statutory-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the listing renders the W-18 engine's own
 *   shapes VERBATIM — the asset/branch joins, the ladder's own stamps,
 *   the journal link; THE APPROVAL renders the G-61 verdict's OWN figures
 *   (nbv + journalEntryId + both branch accounts exactly as the approval
 *   act returned them); the zero-NBV case renders the engine's own honest
 *   note — no fabricated entry.
 * - The ladder rides the machine's own moves (one POST per move — the
 *   submit transition's endpoint proven).
 * - The typed refusal renders with its FULL payload.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  AssetTransferRow,
  BranchRow,
  FixedAssetRow,
  TransferApprovalResult,
} from "../../lib/api-types";
import { AssetsTransfersBoard } from "../assets-transfers-board";

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

const ASSET: FixedAssetRow = {
  id: "asset-1",
  code: "A-100",
  name: "Generator",
  nameAr: "",
  categoryId: "cat-1",
  acquisitionDate: "2026-01-01",
  cost: "50000",
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

function branch(overrides: Partial<BranchRow> = {}): BranchRow {
  return {
    id: "branch-1",
    tenantId: "tenant-1",
    code: "RUH",
    name: "Riyadh HQ",
    nameAr: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const BRANCHES: readonly BranchRow[] = [
  branch(),
  branch({ id: "branch-2", code: "JED", name: "Jeddah depot" }),
];

function transfer(overrides: Partial<AssetTransferRow> = {}): AssetTransferRow {
  return {
    id: "transfer-1",
    assetId: "asset-1",
    fromBranchId: "branch-1",
    toBranchId: "branch-2",
    reason: "Site relocation",
    reasonAr: null,
    status: "SUBMITTED",
    submittedAt: "2026-11-20T09:00:00Z",
    submittedBy: "user-1",
    approvedAt: null,
    approvedBy: null,
    rejectedAt: null,
    rejectedBy: null,
    rejectReason: null,
    journalEntryId: null,
    note: null,
    noteAr: null,
    createdBy: "user-1",
    createdAt: "2026-11-20T08:00:00Z",
    updatedAt: "2026-11-20T09:00:00Z",
    version: 2,
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof AssetsTransfersBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <AssetsTransfersBoard
        locale={locale}
        initialTransfers={[transfer()]}
        transfersError={null}
        assets={[ASSET]}
        branches={BRANCHES}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-049 W-21 — the transfers board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the joins + the ladder's own stamps)", () => {
    renderBoard("en");
    // The presentation joins (never bare uuids).
    expect(screen.getAllByText("A-100 · Generator").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("RUH · Riyadh HQ").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("JED · Jeddah depot").length).toBeGreaterThanOrEqual(1);
    const grid = screen.getByRole("grid");
    // The machine's own stamp + the status chip (the submittedAt column
    // header carries the same English word by design — header + chip).
    expect(within(grid).getByText("2026-11-20T09:00:00Z")).toBeTruthy();
    expect(within(grid).getAllByText("Submitted").length).toBe(2);
  });

  it("(b) AR renders Arabic-first (the localized status + the AR labels)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("مُرسل")).toBeTruthy();
    expect(screen.getByText("نقل الأصول")).toBeTruthy();
    expect(screen.getByText("طلب نقل جديد")).toBeTruthy();
  });

  it("(c) the submit flow rides the machine's own move (one POST)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/transfers/transfer-1/submit" && init?.method === "POST") {
        return { ok: true, data: transfer() };
      }
      if (path === "assets/transfers") {
        return { ok: true, data: [transfer()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en", { initialTransfers: [transfer({ status: "DRAFT", submittedAt: null, submittedBy: null, version: 1 })] });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("Site relocation")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for approval" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/transfers/transfer-1/submit", {
        method: "POST",
        body: {},
      });
    });
    await waitFor(() => {
      expect(screen.getByText("Transfer submitted for approval.")).toBeTruthy();
    });
  });

  it("(d) THE APPROVAL renders the G-61 verdict's own figures (nbv + journal + both accounts) verbatim", async () => {
    const approved = transfer({
      status: "APPROVED",
      approvedAt: "2026-11-21T10:00:00Z",
      approvedBy: "user-2",
      journalEntryId: "journal-1",
      version: 3,
    });
    const verdict: TransferApprovalResult = {
      transfer: approved,
      journalEntryId: "journal-1",
      nbv: "15000",
      fromAccountId: "account-from-1",
      toAccountId: "account-to-1",
    };
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/transfers/transfer-1/approve" && init?.method === "POST") {
        return { ok: true, data: verdict };
      }
      if (path === "assets/transfers") {
        return { ok: true, data: [transfer()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("Site relocation")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("assets/transfers/transfer-1/approve", {
        method: "POST",
        body: {},
      });
    });
    // THE G-61 VERDICT — the approval act's own figures, verbatim: the
    // fold's NBV (money-formatted, the exact engine string in the title),
    // the journal link (BOTH surfaces — the workspace DefList AND the
    // verdict card — one figure), and both branch accounts (short ids,
    // full ids in the titles).
    await waitFor(() => {
      expect(screen.getByText("15,000.0000")).toBeTruthy();
      expect(screen.getByTitle("15000")).toBeTruthy();
      expect(screen.getAllByText("journal-1").length).toBe(2);
      expect(screen.getByTitle("account-from-1")).toBeTruthy();
      expect(screen.getByTitle("account-to-1")).toBeTruthy();
      expect(screen.getAllByText("account-").length).toBe(2);
    });
  });

  it("(e) the zero-NBV note renders the engine's own honest verdict + the typed refusal carries its FULL payload", async () => {
    const approved = transfer({
      status: "APPROVED",
      approvedAt: "2026-11-21T10:00:00Z",
      approvedBy: "user-2",
      journalEntryId: null,
      version: 3,
    });
    const verdict: TransferApprovalResult = {
      transfer: approved,
      journalEntryId: null,
      nbv: "0",
      fromAccountId: null,
      toAccountId: null,
    };
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "assets/transfers/transfer-1/approve" && init?.method === "POST") {
        return { ok: true, data: verdict };
      }
      if (path === "assets/transfers") {
        return { ok: true, data: [transfer()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("Site relocation")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    // THE ZERO-NBV NOTE — the engine's own honest verdict (no fabricated entry).
    await waitFor(() => {
      expect(screen.getByText("Zero NBV — no entry (the branch flips only).")).toBeTruthy();
    });

    // The typed refusal: the list read's refusal renders the FULL payload.
    cleanup();
    renderBoard("en", {
      initialTransfers: null,
      transfersError: {
        code: "TRANSFER_SELF_APPROVAL_BLOCKED",
        message: "the creator neither approves nor rejects their own request",
        details: { transferId: "transfer-1", creatorId: "user-1" },
      },
    });
    const panel = screen.getByTestId("typed-refusal");
    expect(within(panel).getByText("TRANSFER_SELF_APPROVAL_BLOCKED")).toBeTruthy();
    expect(within(panel).getByText(/creator neither approves/)).toBeTruthy();
    expect(within(panel).getByText("transferId")).toBeTruthy();
    expect(within(panel).getByText("creatorId")).toBeTruthy();
  });
});
