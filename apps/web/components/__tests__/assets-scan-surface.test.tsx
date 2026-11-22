/**
 * PHASE-049 (W-21 — T-14) — the scan surface's component tests (the
 * statutory-board pattern: jsdom + the bffFetch mock + the Radix idiom):
 *
 * - THE ENGINE-OUTPUT LAW: the resolve renders the engine's OWN resolution
 *   payload VERBATIM — the register brief, the four expiry chips (null →
 *   the honest dash), the maintenance-context counts, and the odometer
 *   binding; the "open the full card" link rides the payload's own asset
 *   id.
 * - The typed refusal (TAG_CODE_INVALID — the forged-code case: refused at
 *   the signature, never at a lookup) renders the code + the message + the
 *   FULL details payload — never a generic error.
 * - AR/EN parity: the labels render in both locales (Arabic-first).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { AssetScanPayload } from "../../lib/api-types";
import { AssetsScanSurface } from "../assets-scan-surface";

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

function scanPayload(overrides: Partial<AssetScanPayload> = {}): AssetScanPayload {
  return {
    tag: {
      id: "tag-1",
      assetId: "asset-1",
      code: "tg_v1_abc123",
      printedAt: null,
      note: null,
      noteAr: null,
      createdBy: null,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
      version: 1,
    },
    asset: {
      id: "asset-1",
      code: "A-100",
      name: "Generator",
      nameAr: "",
      categoryId: "cat-1",
      categoryCode: "GEN",
      categoryName: "Generators",
      branchId: "branch-1",
      branchCode: "RUH",
      branchName: "Riyadh",
      status: "ACTIVE",
      custodianUserId: null,
      warrantyExpiry: "2027-01-01",
      insuranceExpiry: null,
      licenseExpiry: "2026-12-15",
      inspectionExpiry: null,
      parentAssetId: null,
      costCenterId: null,
    },
    openWorkOrders: 2,
    activePlans: 1,
    odometer: {
      meterId: "meter-1",
      name: "Trip counter",
      nameAr: null,
      unit: "km",
      lastValue: "123456",
    },
    ...overrides,
  };
}

function renderSurface(locale: "ar" | "en") {
  return render(
    <ToastProvider>
      <AssetsScanSurface locale={locale} />
    </ToastProvider>,
  );
}

function resolveWith(payload: AssetScanPayload, locale: "ar" | "en", code = "tg_v1_abc123"): void {
  bffFetchMock.mockImplementation(async (path: string) => {
    if (path === `assets/scan/${encodeURIComponent(code)}`) {
      return { ok: true, data: payload };
    }
    return { ok: false, status: 404, error: { code: "NOT_FOUND", message: "unmocked path" } };
  });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: code } });
  fireEvent.click(
    screen.getByRole("button", { name: locale === "ar" ? "تحليل" : "Resolve" }),
  );
}

describe("PHASE-049 W-21 — the scan surface", () => {
  it("(a) the resolve renders the card (the brief + the four expiry chips + the maintenance context + the odometer binding)", async () => {
    renderSurface("en");
    resolveWith(scanPayload(), "en");
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      // The register brief — the resolution payload's own fields.
      expect(screen.getByText("A-100")).toBeTruthy();
      expect(screen.getByText("Generator")).toBeTruthy();
      expect(screen.getByText("Generators")).toBeTruthy();
      expect(screen.getByText("Riyadh")).toBeTruthy();
      expect(screen.getByText("Active")).toBeTruthy();
      // THE FOUR EXPIRY CHIPS — the engine's own dates (null → dash).
      expect(screen.getByText("Warranty expiry: 2027-01-01")).toBeTruthy();
      expect(screen.getByText("Insurance expiry: —")).toBeTruthy();
      expect(screen.getByText("License expiry: 2026-12-15")).toBeTruthy();
      expect(screen.getByText("Inspection expiry: —")).toBeTruthy();
      // THE MAINTENANCE CONTEXT — the engine's own counts (mono).
      expect(screen.getByText("Open work orders")).toBeTruthy();
      expect(screen.getByText("Active preventive plans")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
      expect(screen.getByText("1")).toBeTruthy();
      // THE ODOMETER BINDING — the engine's own snapshot (label + name +
      // value + unit).
      expect(screen.getByText("Odometer")).toBeTruthy();
      expect(screen.getByText("Trip counter")).toBeTruthy();
      expect(screen.getByText("123456")).toBeTruthy();
      expect(screen.getByText("km")).toBeTruthy();
      // The full card's link rides the payload's own asset id.
      expect(screen.getByRole("link", { name: "Open the full card" }).getAttribute("href")).toBe(
        "/en/fixed-assets/asset-1",
      );
    });
  });

  it("(b) the TAG_CODE_INVALID typed refusal renders WITH ITS PAYLOAD (the forged-code case), never a generic error", async () => {
    bffFetchMock.mockImplementation(async () => ({
      ok: false as const,
      status: 422,
      error: {
        code: "TAG_CODE_INVALID",
        message: "the code is not validly signed",
        details: { code: "tg_v1_forged", reason: "signature mismatch" },
      },
    }));
    renderSurface("en");
    fireEvent.change(screen.getByLabelText("Tag code"), {
      target: { value: "tg_v1_forged" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      const panel = screen.getByTestId("typed-refusal");
      expect(within(panel).getByText("TAG_CODE_INVALID")).toBeTruthy();
      expect(within(panel).getByText(/not validly signed/)).toBeTruthy();
      expect(within(panel).getByText("code")).toBeTruthy();
      expect(within(panel).getByText("reason")).toBeTruthy();
      expect(within(panel).getByText("signature mismatch")).toBeTruthy();
    });
  });

  it("(c) AR renders Arabic-first (the localized card labels + the expiry chips)", async () => {
    renderSurface("ar");
    resolveWith(scanPayload(), "ar");
    const { waitFor } = await import("@testing-library/react");
    await waitFor(() => {
      expect(screen.getByText("بطاقة الأصل")).toBeTruthy();
      expect(screen.getByText("أوامر صيانة مفتوحة")).toBeTruthy();
      expect(screen.getByText("خطط وقائية نشطة")).toBeTruthy();
      expect(screen.getByText("نشط")).toBeTruthy();
      // THE EXPIRY CHIPS — the AR labels with the engine's own dates.
      expect(screen.getByText("انتهاء الضمان: 2027-01-01")).toBeTruthy();
      expect(screen.getByText("انتهاء التأمين: —")).toBeTruthy();
      // The full card's link rides the AR locale prefix.
      expect(screen.getByRole("link", { name: "فتح البطاقة الكاملة" }).getAttribute("href")).toBe(
        "/ar/fixed-assets/asset-1",
      );
    });
  });
});
