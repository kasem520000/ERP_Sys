/**
 * PHASE-050 (W-29 — T-15) — the complaints board's component tests (the
 * meters-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the register renders the engine's own shapes
 *   VERBATIM — the record's own complaintNo/subject/status and the
 *   channel/severity vocabularies through the dictionary.
 * - THE TRIAGE ACT posts the exact body carrying the NCR link (the link
 *   window's own floor).
 * - THE RESOLVE ACT posts the exact body {resolution} (the 0114 pair).
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { ComplaintRow, ItemRow, NcrRow, PartnerRow } from "../../lib/api-types";
import { QualityComplaintsBoard } from "../quality-complaints-board";

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

const CUSTOMER: PartnerRow = {
  id: "customer-1",
  tenantId: "tenant-1",
  kind: "CUSTOMER",
  code: "C-200",
  name: "Gulf Foods",
  nameAr: "أغذية الخليج",
  taxNumber: null,
  creditLimit: null,
  creditTermsId: null,
  priceListId: null,
  status: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

const ITEM: ItemRow = {
  id: "item-1",
  sku: "SKU-100",
  name: "Steel sheet",
  nameAr: "صفيحة فولاذ",
  kind: "STOCK",
  uomId: "uom-1",
  categoryId: null,
  taxCodeId: null,
  costingMethod: "WAC",
  trackBatch: true,
  trackSerial: false,
  trackImei: false,
  hasExpiry: true,
  reorderLevel: null,
  reorderQty: null,
  basePrice: null,
  status: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

const NCR: NcrRow = {
  id: "ncr-1",
  ncrNo: "NCR-2026-000042",
  source: "COMPLAINT",
  severity: "HIGH",
  itemId: "item-1",
  batchId: null,
  inspectionId: null,
  partnerId: null,
  problem: "Surface oxidation",
  problemAr: null,
  affectedQty: "12.500000",
  status: "OPEN",
  disposition: null,
  dispositionAt: null,
  closedAt: null,
  journalEntryId: null,
  note: null,
  noteAr: null,
  version: 1,
  createdAt: "2026-11-20T08:00:00Z",
  updatedAt: "2026-11-20T08:00:00Z",
};

function complaint(overrides: Partial<ComplaintRow> = {}): ComplaintRow {
  return {
    id: "complaint-1",
    complaintNo: "CMP-2026-000019",
    channel: "PHONE",
    severity: "HIGH",
    customerId: "customer-1",
    itemId: "item-1",
    batchId: null,
    ncrId: null,
    subject: "Rust on delivered sheets",
    details: "Three sheets arrived oxidized",
    detailsAr: null,
    status: "NEW",
    resolution: null,
    resolvedAt: null,
    note: null,
    noteAr: null,
    createdBy: null,
    createdAt: "2026-11-22T10:00:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof QualityComplaintsBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <QualityComplaintsBoard
        locale={locale}
        initialComplaints={[complaint()]}
        complaintsError={null}
        customers={[CUSTOMER]}
        items={[ITEM]}
        ncrs={[NCR]}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-050 W-29 — the complaints board", () => {
  it("(a) the listing renders the engine's own shapes verbatim (the mono figures + the vocabularies)", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    // The record's own figures (mono, verbatim).
    expect(within(grid).getByText("CMP-2026-000019")).toBeTruthy();
    expect(within(grid).getByText("2026-11-22T10:00:00Z")).toBeTruthy();
    expect(within(grid).getByText("Rust on delivered sheets")).toBeTruthy();
    // The presentation join (never a bare uuid).
    expect(within(grid).getByText("C-200 · Gulf Foods")).toBeTruthy();
    // The vocabularies (dictionary-driven, never the raw enum).
    expect(within(grid).getByText("Phone")).toBeTruthy();
    expect(within(grid).getByText("High")).toBeTruthy();
    expect(within(grid).getByText("New")).toBeTruthy();
  });

  it("(b) THE TRIAGE ACT posts the exact body carrying the NCR link", async () => {
    const triaged = complaint({
      status: "TRIAGED",
      ncrId: "ncr-1",
    });
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/complaints/complaint-1/triage" && init?.method === "POST") {
        return { ok: true, data: triaged };
      }
      return { ok: true, data: [complaint()] };
    });
    renderBoard("en");
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByText("Rust on delivered sheets")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Triage" }));
    const dialog = screen.getByRole("dialog");
    // Pick the NCR link (the standard Radix+jsdom workaround; the listbox
    // portals outside the dialog's own DOM).
    const trigger = within(dialog).getByLabelText(/Link a nonconformity/);
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: /NCR-2026-000042/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Triage" }));
    // THE EXACT BODY — the engine's own contract (the link's own floor).
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/complaints/complaint-1/triage", {
        method: "POST",
        body: { ncrId: "ncr-1" },
      });
    });
    // The advanced row's own link (the register's own number, verbatim — in
    // the workspace AND the row's own cell, by design); the toast and the
    // notices line both carry the toast word (by design).
    await waitFor(() => {
      expect(screen.getAllByText("Complaint triaged.").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("NCR-2026-000042").length).toBeGreaterThanOrEqual(2);
    });
  });

  it("(c) THE RESOLVE ACT posts the exact body {resolution} (the 0114 pair)", async () => {
    const resolved = complaint({
      status: "IN_PROGRESS",
      ncrId: "ncr-1",
    });
    const resolvedAfter = complaint({
      status: "RESOLVED",
      ncrId: "ncr-1",
      resolution: "Replaced the three sheets and credited the freight",
      resolvedAt: "2026-11-23T12:00:00Z",
    });
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "quality/complaints/complaint-1/resolve" && init?.method === "POST") {
        return { ok: true, data: resolvedAfter };
      }
      return { ok: true, data: [resolved] };
    });
    renderBoard("en", { initialComplaints: [resolved] });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Resolve" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Resolution text \*/), {
      target: { value: "Replaced the three sheets and credited the freight" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Resolve" }));
    // THE EXACT BODY — the engine's own contract (the pair lands together).
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("quality/complaints/complaint-1/resolve", {
        method: "POST",
        body: { resolution: "Replaced the three sheets and credited the freight" },
      });
    });
    // The resolution pair renders verbatim (the text + the engine's stamp);
    // the toast and the notices line both carry the toast word (by design).
    await waitFor(() => {
      expect(screen.getAllByText("Complaint resolved.").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Replaced the three sheets and credited the freight")).toBeTruthy();
      expect(screen.getByText("2026-11-23T12:00:00Z")).toBeTruthy();
    });
  });

  it("(d) AR renders Arabic-first (the channel/status vocabularies + the pane switch)", () => {
    renderBoard("ar");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("هاتف")).toBeTruthy();
    expect(within(grid).getByText("عالية")).toBeTruthy();
    expect(within(grid).getByText("جديدة")).toBeTruthy();
    expect(within(grid).getByText("C-200 · أغذية الخليج")).toBeTruthy();
    // The pane switch + the pane card both carry the pane label (by design).
    expect(screen.getAllByText("السجل").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("تسجيل شكوى")).toBeTruthy();
  });
});
