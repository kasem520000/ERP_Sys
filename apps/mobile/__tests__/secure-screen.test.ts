import { describe, expect, it } from "vitest";

import {
  FINANCIAL_SCREENS,
  applySecureScreenPolicy,
  isFinancialScreen,
  type SecureScreenPort,
} from "../src/device";
import { createMobileDriverRegistry, type MobileDrivers } from "../src/device/drivers-registry";

/**
 * PHASE-022 T2-b unit evidence (MASTER-PLAN §1 DR-P22-09; SECURITY_AND_
 * DEVICE_MANAGEMENT §3 — "Screenshots/screen recording are disabled in
 * the Android app for financial screens"): the secure-screen policy —
 * the FINANCIAL_SCREENS list + the port wiring (which screens enable
 * the FLAG_SECURE-style block, and that it is RELEASED when leaving).
 */

/** A recording SecureScreenPort (the device impl calls the native
 * flag; the policy wiring is what this suite proves). */
function recordingSecureScreen(): { port: SecureScreenPort; calls: boolean[] } {
  const calls: boolean[] = [];
  const port: SecureScreenPort = {
    setFlagSecure: (enabled) => {
      calls.push(enabled);
    },
  };
  return { port, calls };
}

describe("secure-screen policy (DR-P22-09)", () => {
  it("FINANCIAL_SCREENS: the money surfaces — capture/invoice/statement screens, never the whole app", () => {
    expect(FINANCIAL_SCREENS).toEqual([
      "VanSaleCapture",
      "Collection",
      "VanLoadUnload",
      "ReturnsDraft",
      "Statements",
      "InvoiceList",
      "InvoiceView",
      "PersonalHome",
    ]);
    // The money surfaces are financial.
    for (const screen of FINANCIAL_SCREENS) {
      expect(isFinancialScreen(screen)).toBe(true);
    }
    // The non-financial surfaces keep capture enabled (the policy is
    // scoped — Settings, Onboarding, RouteVisits, CountLines, the
    // unlock gate…).
    expect(isFinancialScreen("Settings")).toBe(false);
    expect(isFinancialScreen("Onboarding")).toBe(false);
    expect(isFinancialScreen("RouteVisits")).toBe(false);
    expect(isFinancialScreen("CountLines")).toBe(false);
  });

  it("a financial screen ENABLES the flag; navigating to a non-financial screen RELEASES it (the per-transition wiring)", async () => {
    const { port, calls } = recordingSecureScreen();

    const vanSale = await applySecureScreenPolicy(port, "VanSaleCapture");
    expect(vanSale).toEqual({ screen: "VanSaleCapture", secured: true });

    const statements = await applySecureScreenPolicy(port, "Statements");
    expect(statements.secured).toBe(true);

    const settings = await applySecureScreenPolicy(port, "Settings");
    expect(settings).toEqual({ screen: "Settings", secured: false });

    expect(calls).toEqual([true, true, false]); // enable, enable, release
  });

  it("the drivers registry wires the port alongside every other device seam (a missing driver is a boot bug, fail loud)", () => {
    const secureScreen = recordingSecureScreen();
    const fakeDrivers = {
      http: { request: async () => ({ status: 200, text: "{}", json: () => ({}) }) },
      secureStore: {
        getItem: async () => null,
        setItem: async () => undefined,
        deleteItem: async () => undefined,
      },
      crypto: {
        generateKeypair: async () => ({ publicKey: "pk", privateKey: "sk" }),
        sign: async () => "sig",
      },
      unlock: {
        isBiometricAvailable: async () => false,
        authenticateBiometric: async () => false,
        verifyPin: async () => false,
      },
      trust: { collectTrustSignals: async () => ({}) },
      secureScreen: secureScreen.port,
    } satisfies MobileDrivers;

    const registry = createMobileDriverRegistry(fakeDrivers);
    expect(registry.secureScreen).toBe(secureScreen.port);
    void registry;

    // A missing slot throws AT BOOT with the slot's name (never a deep
    // undefined in the auth flow).
    const { secureScreen: _omit, ...incomplete } = fakeDrivers;
    void _omit;
    expect(() => createMobileDriverRegistry(incomplete as MobileDrivers)).toThrow(/secureScreen/);
  });
});
