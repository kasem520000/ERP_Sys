/**
 * PHASE-051 (W-39 — T-14) — the certificates board's component tests (the
 * 050 COA board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the certificates register renders the engine's
 *   own shapes VERBATIM (the certificateNo/certType/issuedAt + the frozen
 *   snapshot's links).
 * - THE ISSUE ACT posts the exact body (the goods lines with their
 *   origins + the exporter/consignee + the links).
 * - THE PRINT PREVIEW opens the SAME html the paper prints (ADR-0011) —
 *   the payload builder's own output carrying the frozen snapshot
 *   VERBATIM.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { TradeCertificateRow } from "../../lib/api-types";
import { TradeCertificatesBoard } from "../trade-certificates-board";

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

/** The frozen snapshot the issue act stores (the chamber certificate's
 * own data — the goods lines with their origins, the linked figures as
 * copied at issuance). */
function certificate(overrides: Partial<TradeCertificateRow> = {}): TradeCertificateRow {
  return {
    id: "cert-1",
    certificateNo: "CERT-2026-000007",
    certType: "ORIGIN",
    billOfLadingId: "bl-1",
    declarationId: "decl-1",
    snapshot: {
      certType: "ORIGIN",
      exporterName: "Test Trading Company",
      consigneeName: "Gulf Importers LLC",
      goods: [
        {
          description: "Steel sheets, cold rolled",
          originCountry: "SA",
          hsCode: "7209160000",
          quantity: "1250.000000",
          uom: "PKG",
        },
      ],
      billOfLading: {
        id: "bl-1",
        blNo: "BL-2026-000042",
        docType: "SEA",
        carrierName: "Maersk Sealand",
        portOfLoading: "Jeddah Islamic Port",
        portOfDischarge: "Rotterdam",
        shipmentStatus: "DEPARTED",
      },
      declaration: {
        id: "decl-1",
        declarationNo: "CD-2026-000019",
        status: "ACCEPTED",
      },
    },
    issuedAt: "2026-11-25T16:30:00Z",
    issuedBy: "user-1",
    note: null,
    noteAr: null,
    createdAt: "2026-11-25T16:30:00Z",
    updatedAt: "2026-11-25T16:30:00Z",
    ...overrides,
  };
}

function renderBoard(
  locale: "ar" | "en",
  overrides: Partial<Parameters<typeof TradeCertificatesBoard>[0]> = {},
) {
  return render(
    <ToastProvider>
      <TradeCertificatesBoard
        locale={locale}
        initialCertificates={[certificate()]}
        certificatesError={null}
        canManage={true}
        {...overrides}
      />
    </ToastProvider>,
  );
}

describe("PHASE-051 W-39 — the certificates board", () => {
  it("(a) the register renders the engine's own shapes VERBATIM", () => {
    renderBoard("en");
    const grid = screen.getByRole("grid");
    expect(within(grid).getByText("CERT-2026-000007")).toBeTruthy();
    expect(within(grid).getByText("2026-11-25T16:30:00Z")).toBeTruthy();
    // The type chip (the dictionary's own wording — ORIGIN).
    expect(within(grid).getByText("Certificate of origin")).toBeTruthy();
    // The linked figures' presentation short ids (the chain's anchors).
    expect(within(grid).getAllByText("bl-1").length).toBeGreaterThan(0);
    expect(within(grid).getAllByText("decl-1").length).toBeGreaterThan(0);
  });

  it("(b) THE ISSUE ACT posts the exact body (the goods lines + the parties + the links)", async () => {
    bffFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "trade/certificates" && init?.method === "POST") {
        return { ok: true, data: certificate({ id: "cert-2", certificateNo: "CERT-2026-000008" }) };
      }
      if (path === "trade/certificates") {
        return { ok: true, data: [certificate()] };
      }
      return { ok: true, data: [] };
    });
    renderBoard("en");
    // Switch to the issue pane (the data-slot switch — never Tabs).
    fireEvent.click(screen.getByRole("button", { name: "Issue a certificate" }));
    // Fill the parties.
    fireEvent.change(screen.getByLabelText(/Exporter/), { target: { value: "Test Trading Company" } });
    fireEvent.change(screen.getByLabelText(/Consignee/), { target: { value: "Gulf Importers LLC" } });
    // Fill the first goods line.
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Steel sheets, cold rolled" } });
    fireEvent.change(screen.getByLabelText(/Origin \(ISO-3166\)/), { target: { value: "SA" } });
    fireEvent.change(screen.getByLabelText(/HS code \(optional\)/), { target: { value: "7209160000" } });
    fireEvent.change(screen.getByLabelText(/Quantity \(optional\)/), { target: { value: "1250.000000" } });
    fireEvent.change(screen.getByLabelText(/UoM \(optional\)/), { target: { value: "PKG" } });
    // The linked ids (UUID shapes — the issue's own link floor).
    fireEvent.change(screen.getByLabelText(/Linked bill of lading/), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.change(screen.getByLabelText(/Linked declaration/), {
      target: { value: "22222222-2222-4222-8222-222222222222" },
    });
    await waitFor(() => {
      fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    });
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith("trade/certificates", {
        method: "POST",
        body: {
          certType: "ORIGIN",
          exporterName: "Test Trading Company",
          consigneeName: "Gulf Importers LLC",
          billOfLadingId: "11111111-1111-4111-8111-111111111111",
          declarationId: "22222222-2222-4222-8222-222222222222",
          goods: [
            {
              description: "Steel sheets, cold rolled",
              originCountry: "SA",
              hsCode: "7209160000",
              quantity: "1250.000000",
              uom: "PKG",
            },
          ],
        },
      });
    });
  });

  it("(c) THE PRINT PREVIEW — the frozen snapshot's own html (ADR-0011: the preview IS the paper)", () => {
    renderBoard("en");
    fireEvent.click(within(screen.getByRole("grid")).getAllByRole("button", { name: "Print preview" })[0]!);
    // The preview dialog opens with the payload builder's own html —
    // the frozen snapshot's figures VERBATIM (the builder's spec proves
    // the full print law; this arm proves the board hands the ROW in).
    const dialog = screen.getByRole("dialog");
    const frame = dialog.querySelector("iframe");
    expect(frame).not.toBeNull();
    const srcDoc = frame?.getAttribute("srcdoc") ?? "";
    expect(srcDoc).toContain("CERT-2026-000007");
    expect(srcDoc).toContain("2026-11-25T16:30:00Z");
    expect(srcDoc).toContain("Steel sheets, cold rolled");
    expect(srcDoc).toContain("1250.000000");
    expect(srcDoc).toContain("BL-2026-000042");
    expect(srcDoc).toContain("CD-2026-000019");
    expect(srcDoc).toContain("<thead>");
    // The print-now act rides the same html (no divergence).
    expect(within(dialog).getByRole("button", { name: "Print now" })).toBeTruthy();
  });

  it("(d) the typed refusal panel renders the FULL payload (the register's own 403)", () => {
    renderBoard("en", {
      initialCertificates: null,
      certificatesError: {
        code: "FORBIDDEN",
        message: "the trade module is not enabled for this tenant",
        details: { feature: "trade" },
      },
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Typed refusal");
    expect(alert.textContent).toContain("the trade module is not enabled for this tenant");
  });
});
