/**
 * THE PROMISE POINT COMPONENT TEST (the owner's independent review of
 * 81f09e9): the panel renders the ATP answer AND — the round's fix —
 * the LINE'S STAMP REFRESHES after a check. The backend's checkLineAtp
 * PERSISTS the stamp at check time (updateOrderLineAtp: atpStatus +
 * promised date + suggested date) and the answer carries the FRESH line
 * row; pre-fix the panel kept rendering the stamp loaded with the order,
 * so a line stamped OK beside a freshly computed SHORT verdict stayed
 * "OK" until a full reload — the badge now reads what the check just
 * recorded.
 *
 * Also pinned here: the bilingual advisory note renders verbatim in BOTH
 * languages (EN ltr + AR rtl), the verdict/protection badges, the five
 * quantities, and the advisory rule on the card's description — nothing
 * in the panel blocks anything (no ATP gate exists at issue).
 *
 * THE c537113 ROUND (the owner's independent review): the five
 * quantities are now verified EACH UNDER ITS OWN LABEL (a value floating
 * anywhere in the DOM proves nothing — the label↔value pairing is the
 * contract), and ALL THREE protection standings are pinned at the
 * promise point (UNPROTECTED / PARTIALLY_PROTECTED / FULLY_PROTECTED,
 * each on its own line). The consultative rule is re-pinned WITH a
 * fresh SHORT verdict on the surface: a shortage NEVER gates issuing —
 * no blocking action renders, by the owner's decided policy.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type {
  ItemRow,
  SalesOrderLineAtpResult,
  SalesOrderLineRow,
  SalesOrderRow,
  SalesOrderWithLines,
} from "../../lib/api-types";
import { AtpPromisePoint } from "../atp-promise-point";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
}));

const bffFetchMock = vi.mocked(bffFetch);

const ORDER: SalesOrderRow = {
  id: "0192f000-0000-7000-8000-000000000001",
  branchId: "0192f000-0000-7000-8000-0000000000b1",
  customerId: "0192f000-0000-7000-8000-0000000000c1",
  salesRepId: null,
  warehouseId: "0192f000-0000-7000-8000-0000000000d1",
  quotationId: null,
  orderNo: "SO-203",
  orderDate: "2026-11-10",
  expectedDate: "2026-11-18",
  currencyCode: "SAR",
  exchangeRate: "1.000000",
  status: "ISSUED",
  totalNet: "1000.000000",
  totalTax: "150.000000",
  totalGross: "1150.000000",
  note: null,
  noteAr: null,
  createdBy: null,
};

/** The line AS LOADED with the order: a stale OK stamp from an earlier check. */
const LINE_STALE: SalesOrderLineRow = {
  id: "0192f000-0000-7000-8000-000000000011",
  lineNo: 1,
  itemId: "0192f000-0000-7000-8000-0000000000e1",
  description: "Promised item",
  descriptionAr: null,
  qty: "10.000000",
  unitPrice: "100.000000",
  discountAmount: "0.000000",
  taxCodeId: null,
  netAmount: "1000.000000",
  taxAmount: "150.000000",
  reservationId: null,
  promisedDate: "2026-11-18",
  atpStatus: "OK",
  atpSuggestedDate: null,
};

/** The check's answer: a SHORT verdict on an UNPROTECTED line — and the
 * FRESH line row carrying the newly recorded stamp (what the backend's
 * updateOrderLineAtp just persisted). */
const ATP_RESULT: SalesOrderLineAtpResult = {
  line: { ...LINE_STALE, atpStatus: "SHORT", atpSuggestedDate: "2026-11-24" },
  verdict: "SHORT",
  availableNow: "4.000000",
  suggestedDate: "2026-11-24",
  protection: "UNPROTECTED",
  remainingQty: "10.000000",
  reservedForLineQty: "0.000000",
  protectedQty: "0.000000",
  unprotectedQty: "10.000000",
  advisoryNote: {
    en: "Advisory only — unprotected: no allocation protects this line yet (EN test note).",
    ar: "استرشادي فقط — غير محمي: لا يوجد تخصيص يحمي هذا البند بعد (ملاحظة اختبار عربية).",
  },
};

const ITEM: ItemRow = {
  id: LINE_STALE.itemId,
  sku: "SKU-PROMISE-1",
  name: "Promised item",
  nameAr: "صنف موعود",
  kind: "STOCK",
  uomId: "0192f000-0000-7000-8000-0000000000f1",
  categoryId: null,
  taxCodeId: null,
  costingMethod: "WAC",
  trackBatch: false,
  trackSerial: false,
  trackImei: false,
  hasExpiry: false,
  reorderLevel: null,
  reorderQty: null,
  basePrice: "100.000000",
  status: "ACTIVE",
  deletedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  version: 1,
};

const ADVISORY_EN = ATP_RESULT.advisoryNote.en;
const ADVISORY_AR = ATP_RESULT.advisoryNote.ar;

beforeEach(() => {
  bffFetchMock.mockReset();
  bffFetchMock.mockImplementation(async (path: string) => {
    if (path === `sales/sales-orders/${ORDER.id}`) {
      return { ok: true as const, data: { ...ORDER, lines: [LINE_STALE] } as SalesOrderWithLines };
    }
    if (path === `sales/sales-orders/${ORDER.id}/lines/${LINE_STALE.id}/atp`) {
      return { ok: true as const, data: ATP_RESULT };
    }
    throw new Error(`unexpected bffFetch path in the test: ${path}`);
  });
});

afterEach(cleanup);

describe("AtpPromisePoint — the line's stamp refreshes after the check (the 81f09e9 review fix)", () => {
  it("renders the stale OK stamp with the loaded line, then the check's SHORT verdict REPLACES the stamp — the badge reads what the check just recorded, not what the order load carried", async () => {
    render(
      <ToastProvider>
        <AtpPromisePoint
          locale="en"
          order={ORDER}
          items={[ITEM]}
          onClose={() => undefined}
        />
      </ToastProvider>,
    );

    // The line loads with its STALE stamp: "Last line check: OK".
    expect(await screen.findByText("SKU-PROMISE-1")).toBeTruthy();
    expect(screen.getByText("Last line check: OK")).toBeTruthy();

    // Run the check.
    fireEvent.click(screen.getByRole("button", { name: "Check ATP" }));

    // The result panel renders: the SHORT verdict, the UNPROTECTED
    // standing, the availableNow quantity, and the bilingual advisory
    // note verbatim — EN ltr + AR rtl.
    expect(await screen.findByText(ADVISORY_EN)).toBeTruthy();
    expect(screen.getByText("Short")).toBeTruthy();
    expect(screen.getByText("Unprotected")).toBeTruthy();
    expect(screen.getByText("4.000000")).toBeTruthy();
    const arabicNote = screen.getByText(ADVISORY_AR);
    expect(arabicNote.getAttribute("dir")).toBe("rtl");
    const englishNote = screen.getByText(ADVISORY_EN);
    expect(englishNote.getAttribute("dir")).toBe("ltr");

    // THE STAMP REFRESH (this round's fix): the line's badge now reads
    // the FRESH verdict the check just persisted — "Last line check:
    // Short" — and the stale OK stamp is GONE. Pre-fix the badge kept
    // rendering "Last line check: OK" beside the fresh SHORT verdict.
    expect(await screen.findByText("Last line check: Short")).toBeTruthy();
    expect(screen.queryByText("Last line check: OK")).toBeNull();
  });

  it("keeps the panel consultative — the advisory rule is on the surface and nothing blocks (no gate renders)", async () => {
    const { container } = render(
      <ToastProvider>
        <AtpPromisePoint
          locale="en"
          order={ORDER}
          items={[ITEM]}
          onClose={() => undefined}
        />
      </ToastProvider>,
    );
    await screen.findByText("SKU-PROMISE-1");
    // The card's description carries the standing rule itself.
    expect(container.textContent).toContain(
      "The unreserved portion is advisory only — another order can take the stock first and a backorder remains possible; a shortage never blocks issuing a sales order.",
    );
    // The only actions are the per-line check and the panel's close —
    // no gate, no block, no "reserve now or else" action.
    expect(screen.queryByRole("button", { name: /reserve/i })).toBeNull();
  });
});

/** The line's panel in the DOM (the div.rounded-md that carries one
 * order line + its ATP answer) — scoped by the line's SKU. */
function linePanel(sku: string): HTMLElement {
  const skuNode = screen.getByText(sku);
  const panel = skuNode.closest("div.rounded-md");
  expect(panel, `the line panel for ${sku} must render`).toBeTruthy();
  return panel as HTMLElement;
}

/** The qty value rendered UNDER its dt label inside a panel — the
 * label↔value pairing is the contract (a bare value floating anywhere
 * in the DOM proves nothing). */
function qtyUnderLabel(panel: HTMLElement, label: string): string {
  const dt = within(panel).getByText(label);
  const cell = dt.parentElement;
  const dd = cell?.querySelector("dd");
  expect(dd, `the quantity for "${label}" must render under its label`).toBeTruthy();
  return dd?.textContent ?? "";
}

describe("AtpPromisePoint — the c537113 round: the five quantities under their labels, the three protection standings, still no gate", () => {
  it("renders the FIVE quantities each UNDER ITS OWN LABEL — availableNow, remaining, allocated-to-the-line, protected, unprotected (the label↔value pairing, not a bare value anywhere in the DOM)", async () => {
    render(
      <ToastProvider>
        <AtpPromisePoint
          locale="en"
          order={ORDER}
          items={[ITEM]}
          onClose={() => undefined}
        />
      </ToastProvider>,
    );
    await screen.findByText("SKU-PROMISE-1");
    fireEvent.click(screen.getByRole("button", { name: "Check ATP" }));
    await screen.findByText(ADVISORY_EN);

    const panel = linePanel("SKU-PROMISE-1");
    // THE FIVE QUANTITIES, each under its exact label (the ATP_RESULT
    // fixture: availableNow 4, remaining 10, allocated 0, protected 0,
    // unprotected 10).
    expect(qtyUnderLabel(panel, "Available to promise at the requested date")).toBe("4.000000");
    expect(qtyUnderLabel(panel, "Remaining qty")).toBe("10.000000");
    expect(qtyUnderLabel(panel, "Allocated to the line")).toBe("0.000000");
    expect(qtyUnderLabel(panel, "Protected qty")).toBe("0.000000");
    expect(qtyUnderLabel(panel, "Unprotected qty")).toBe("10.000000");

    // The line's own qty (10) and the verdict badges ride the same
    // panel — the five labeled quantities are a closed set, each paired.
    expect(within(panel).getByText("Short")).toBeTruthy();
  });

  it("renders ALL THREE protection standings at the promise point — UNPROTECTED, PARTIALLY_PROTECTED, FULLY_PROTECTED, each on its own line with its own quantities", async () => {
    // Three lines, three items, three answers: one line fully exposed,
    // one partially protected, one fully protected.
    const lines: SalesOrderLineRow[] = [
      { ...LINE_STALE, id: "0192f000-0000-7000-8000-000000000021", lineNo: 1, itemId: "0192f000-0000-7000-8000-0000000000e1", qty: "10.000000" },
      { ...LINE_STALE, id: "0192f000-0000-7000-8000-000000000022", lineNo: 2, itemId: "0192f000-0000-7000-8000-0000000000e2", qty: "8.000000" },
      { ...LINE_STALE, id: "0192f000-0000-7000-8000-000000000023", lineNo: 3, itemId: "0192f000-0000-7000-8000-0000000000e3", qty: "6.000000" },
    ];
    const items: ItemRow[] = [
      { ...ITEM, id: lines[0]!.itemId, sku: "SKU-UNPROTECTED" },
      { ...ITEM, id: lines[1]!.itemId, sku: "SKU-PARTIAL" },
      { ...ITEM, id: lines[2]!.itemId, sku: "SKU-FULL" },
    ];
    const results = new Map<string, SalesOrderLineAtpResult>([
      [
        lines[0]!.id,
        {
          line: { ...lines[0]!, atpStatus: "SHORT", atpSuggestedDate: "2026-11-24" },
          verdict: "SHORT",
          availableNow: "4.000000",
          suggestedDate: "2026-11-24",
          protection: "UNPROTECTED",
          remainingQty: "10.000000",
          reservedForLineQty: "0.000000",
          protectedQty: "0.000000",
          unprotectedQty: "10.000000",
          advisoryNote: ATP_RESULT.advisoryNote,
        },
      ],
      [
        lines[1]!.id,
        {
          line: { ...lines[1]!, atpStatus: "SHORT", atpSuggestedDate: "2026-11-20" },
          verdict: "SHORT",
          availableNow: "6.000000",
          suggestedDate: "2026-11-20",
          protection: "PARTIALLY_PROTECTED",
          remainingQty: "8.000000",
          reservedForLineQty: "3.000000",
          protectedQty: "3.000000",
          unprotectedQty: "5.000000",
          advisoryNote: ATP_RESULT.advisoryNote,
        },
      ],
      [
        lines[2]!.id,
        {
          line: { ...lines[2]!, atpStatus: "OK", atpSuggestedDate: null },
          verdict: "OK",
          availableNow: "9.000000",
          suggestedDate: null,
          protection: "FULLY_PROTECTED",
          remainingQty: "6.000000",
          reservedForLineQty: "6.000000",
          protectedQty: "6.000000",
          unprotectedQty: "0.000000",
          advisoryNote: ATP_RESULT.advisoryNote,
        },
      ],
    ]);
    bffFetchMock.mockImplementation(async (path: string) => {
      if (path === `sales/sales-orders/${ORDER.id}`) {
        return { ok: true as const, data: { ...ORDER, lines } as SalesOrderWithLines };
      }
      const match = /^sales\/sales-orders\/[^/]+\/lines\/([^/]+)\/atp$/.exec(path);
      if (match !== null && results.has(match[1]!)) {
        return { ok: true as const, data: results.get(match[1]!)! };
      }
      throw new Error(`unexpected bffFetch path in the test: ${path}`);
    });

    render(
      <ToastProvider>
        <AtpPromisePoint
          locale="en"
          order={ORDER}
          items={items}
          onClose={() => undefined}
        />
      </ToastProvider>,
    );
    await screen.findByText("SKU-UNPROTECTED");
    await screen.findByText("SKU-PARTIAL");
    await screen.findByText("SKU-FULL");

    // Check each line — each panel's own button, each answer its own.
    for (const sku of ["SKU-UNPROTECTED", "SKU-PARTIAL", "SKU-FULL"]) {
      fireEvent.click(within(linePanel(sku)).getByRole("button", { name: "Check ATP" }));
    }
    // Wait until EVERY panel's answer has rendered — each answer block
    // carries the advisory note, so three copies = three answers on the
    // surface (never assert against a partially-rendered set).
    await waitFor(() => {
      expect(screen.getAllByText(ADVISORY_EN)).toHaveLength(3);
    });

    // THE THREE STANDINGS, each badge on its own line panel.
    const exposed = linePanel("SKU-UNPROTECTED");
    expect(within(exposed).getByText("Unprotected")).toBeTruthy();
    expect(qtyUnderLabel(exposed, "Protected qty")).toBe("0.000000");
    expect(qtyUnderLabel(exposed, "Unprotected qty")).toBe("10.000000");

    const partial = linePanel("SKU-PARTIAL");
    expect(within(partial).getByText("Partially protected")).toBeTruthy();
    expect(qtyUnderLabel(partial, "Protected qty")).toBe("3.000000");
    expect(qtyUnderLabel(partial, "Unprotected qty")).toBe("5.000000");

    const full = linePanel("SKU-FULL");
    expect(within(full).getByText("Fully protected")).toBeTruthy();
    expect(qtyUnderLabel(full, "Protected qty")).toBe("6.000000");
    expect(qtyUnderLabel(full, "Unprotected qty")).toBe("0.000000");

    // AND STILL NO GATE: two of the three lines carry a fresh SHORT
    // verdict on the surface — and no blocking action renders anywhere
    // (the owner's decided policy: the unreserved portion is advisory
    // and a shortage NEVER gates issuing; no ATP gate exists at issue).
    expect(within(exposed).getByText("Short")).toBeTruthy();
    expect(within(partial).getByText("Short")).toBeTruthy();
    expect(within(full).getByText("OK")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /reserve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /block|prevent|hold/i })).toBeNull();
    expect(screen.queryByText(/cannot issue|blocked|gate/i)).toBeNull();
  });
});
