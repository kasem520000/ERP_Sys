/**
 * PHASE-046 (W-5, T-10) — the statutory compliance board's component
 * tests (the atp-promise-point pattern: jsdom + the bffFetch mock):
 * the three tabs render their management lists with the verification
 * badges; the jurisdiction narrowing filters client-side; the honest
 * empty state; THE VERIFY BUTTON'S RUNTIME GATE (hidden without
 * payroll.statutory.verify — the owner-only key, matrix §3.24) and the
 * citation dialog's law (an empty source never flips a row — the 0089
 * VERIFIED⟺source CHECK at the surface).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@erp/ui";

import { bffFetch } from "../../lib/client-api";
import type { StatutoryProfileManagementRow } from "../../lib/api-types";
import { StatutoryProfilesBoard } from "../statutory-profiles-board";

vi.mock("../../lib/client-api", () => ({
  bffFetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const bffFetchMock = vi.mocked(bffFetch);

// jsdom lacks the PointerEvent + pointer-capture APIs Radix Select needs
// to open its listbox (the standard Radix+jsdom workaround — documented
// upstream); without these the trigger's pointerDown never opens.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      value: () => false,
      writable: true,
      configurable: true,
    });
  }
  if (!Element.prototype.setPointerCapture) {
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
  if (!Element.prototype.releasePointerCapture) {
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      value: () => {},
      writable: true,
      configurable: true,
    });
  }
});


function profileRow(overrides: Partial<StatutoryProfileManagementRow> = {}): StatutoryProfileManagementRow {
  return {
    id: "0193f000-0000-7000-8000-00000000p001",
    jurisdictionCode: "SA",
    code: "GOSI-PENSION",
    name: "GOSI pension",
    nameAr: "التقاعد",
    employeeRate: "9.0000",
    employerRate: "9.0000",
    baseMin: "1500.0000",
    baseMax: "45000.0000",
    contributoryKeys: ["HOUSING"],
    appliesTo: "CITIZEN",
    effectiveFrom: "2020-01-01",
    effectiveTo: null,
    status: "VERIFIED",
    sourceName: "PwC KSA 2026",
    sourceRef: "pwc/ksa/gosi",
    verifiedBy: "0193f000-0000-7000-8000-00000000u001",
    verifiedAt: "2026-11-16T00:00:00Z",
    reviewNote: null,
    updatedAt: "2026-11-16T00:00:00Z",
    version: 1,
    ...overrides,
  };
}

function renderBoard(props: Partial<Parameters<typeof StatutoryProfilesBoard>[0]> = {}): void {
  render(
    <ToastProvider>
      <StatutoryProfilesBoard
        locale="en"
        initialProfiles={[
          profileRow(),
          profileRow({
            id: "0193f000-0000-7000-8000-00000000p002",
            jurisdictionCode: "AE",
            code: "AE-PENSION",
            status: "REQUIRES_VERIFICATION",
            sourceName: null,
            sourceRef: null,
            verifiedBy: null,
            verifiedAt: null,
            employeeRate: "5.0000",
            employerRate: "12.5000",
          }),
        ]}
        initialBrackets={[]}
        initialRules={[]}
        canVerify={false}
        {...props}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  bffFetchMock.mockReset();
});

afterEach(cleanup);

describe("PHASE-046 W-5 T-10 — the statutory compliance board", () => {
  it("renders the three tabs and the profiles list with the verification badges (VERIFIED vs REQUIRES_VERIFICATION)", () => {
    renderBoard();
    expect(screen.getByText("Contribution profiles")).toBeTruthy();
    expect(screen.getByText("PIT brackets")).toBeTruthy();
    expect(screen.getByText("EOSB tiers")).toBeTruthy();
    expect(screen.getByText("GOSI-PENSION")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Requires verification")).toBeTruthy();
    // The citation the badge rests on renders with the row.
    expect(screen.getByText(/PwC KSA 2026/)).toBeTruthy();
  });

  it("the jurisdiction narrowing filters client-side (SA hides the AE row)", () => {
    renderBoard();
    expect(screen.getByText("AE-PENSION")).toBeTruthy();
    // Radix selects + tabs activate on MOUSEDOWN (fireEvent.click alone
    // never triggers them — the jsdom law).
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "SA" }));
    expect(screen.queryByText("AE-PENSION")).toBeNull();
    expect(screen.getByText("GOSI-PENSION")).toBeTruthy();
  });

  it("the honest empty state: a jurisdiction with no rows renders the honest empty notice", () => {
    renderBoard({ initialProfiles: [] });
    expect(screen.getByText(/No statutory rows yet/i)).toBeTruthy();
  });

  it("THE VERIFY BUTTON'S RUNTIME GATE: hidden without payroll.statutory.verify; rendered on REQUIRES_VERIFICATION rows with it", () => {
    // The first render: no permission — the button never renders (even on
    // an unverified row).
    const { unmount } = render(
      <ToastProvider>
        <StatutoryProfilesBoard
          locale="en"
          initialProfiles={[profileRow({ status: "REQUIRES_VERIFICATION", sourceName: null })]}
          initialBrackets={[]}
          initialRules={[]}
          canVerify={false}
        />
      </ToastProvider>,
    );
    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    unmount();

    // The second render: the permission held — the unverified row carries
    // the button (the runtime check the D-16 law names).
    render(
      <ToastProvider>
        <StatutoryProfilesBoard
          locale="en"
          initialProfiles={[profileRow({ status: "REQUIRES_VERIFICATION", sourceName: null })]}
          initialBrackets={[]}
          initialRules={[]}
          canVerify={true}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole("button", { name: "Verify" })).toBeTruthy();
  });

  it("THE CITATION LAW: an empty source never flips a row — the dialog demands the source name; a filled citation posts and flips the badge", async () => {
    bffFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {},
    } as Awaited<ReturnType<typeof bffFetch>>);
    render(
      <ToastProvider>
        <StatutoryProfilesBoard
          locale="en"
          initialProfiles={[profileRow({ status: "REQUIRES_VERIFICATION", sourceName: null })]}
          initialBrackets={[]}
          initialRules={[]}
          canVerify={true}
        />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    // The dialog opens with the row's own identity.
    expect(screen.getByText("Verify the statutory row")).toBeTruthy();

    // An empty source name refuses locally — the 0089 law at the surface.
    // (Two Verify buttons exist while the dialog is open — the row's and
    // the dialog's confirm; the confirm is the LAST one in DOM order.)
    const verifyButtons = screen.getAllByRole("button", { name: "Verify" });
    fireEvent.click(verifyButtons[verifyButtons.length - 1]!);
    await waitFor(() => {
      expect(bffFetchMock).not.toHaveBeenCalled();
    });

    // A filled citation posts the verify act.
    const nameInput = screen.getByLabelText(/Source name/);
    fireEvent.change(nameInput, { target: { value: "PwC KSA 2026" } });
    const confirmButtons = screen.getAllByRole("button", { name: "Verify" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);
    await waitFor(() => {
      expect(bffFetchMock).toHaveBeenCalledWith(
        "payroll/statutory/profiles/0193f000-0000-7000-8000-00000000p001/verify",
        { method: "POST", body: { sourceName: "PwC KSA 2026" } },
      );
    });
    // The badge flips in place.
    await waitFor(() => {
      expect(screen.getByText("Verified")).toBeTruthy();
    });
  });
});
