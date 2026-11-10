/**
 * PHASE-022 · the financial-screens screenshot policy (T2-b;
 * MASTER-PLAN §1 DR-P22-09 — "FLAG_SECURE-style screenshot block on
 * financial screens via the port"; SECURITY_AND_DEVICE_MANAGEMENT §3:
 * "Screenshots/screen recording are disabled in the Android app for
 * financial screens").
 *
 * `SecureScreenPort` is the ONLY seam: the DEVICE implementation
 * (`apps/mobile/native/drivers/secure-screen.ts`) maps `setFlagSecure`
 * onto the Android FLAG_SECURE surface (expo's
 * `ScreenCapture.preventScreenCaptureAsync` /
 * `allowScreenCaptureAsync` — the native author's exact call, the
 * desktop's port-first convention); tests inject a fake that records
 * the calls.
 *
 * The policy is a LIST + a pure function (the screens wave 2-e/3-b
 * consumes): a screen in {@link FINANCIAL_SCREENS} enables the flag on
 * mount and the flag is RELEASED when navigating away (a
 * non-financial screen disables it — the block is scoped to the
 * financial surfaces, never the whole app; the screen NAMES are the
 * DR-P22-11 registry keys, owned finally by the screens wave).
 */

/** The screenshot-block seam (Android FLAG_SECURE). */
export interface SecureScreenPort {
  /** Enable/disable screen capture + recording for the CURRENT screen. */
  setFlagSecure(enabled: boolean): void | Promise<void>;
}

/**
 * The screens that render account balances, statement lines, invoice
 * amounts, or capture money (SECURITY §3's "financial screens" — the
 * DR-P22-11 screen-set names). Screens NOT on this list (Home
 * dashboard chrome, Settings, Notifications, Onboarding/Login,
 * DeviceRegistration, Unlock, RouteVisits, CountLines,
 * ParkedRejections' non-amount views) keep capture enabled — the
 * policy is scoped, never blanket.
 */
export const FINANCIAL_SCREENS: readonly string[] = [
  "VanSaleCapture",
  "Collection",
  "VanLoadUnload",
  "ReturnsDraft",
  "Statements",
  "InvoiceList",
  "InvoiceView",
  "PersonalHome",
] as const;

/** Whether a screen is on the financial list. */
export function isFinancialScreen(screenName: string): boolean {
  return FINANCIAL_SCREENS.includes(screenName);
}

/** The outcome of applying the policy on one screen transition. */
export interface SecureScreenOutcome {
  /** The screen the policy was applied to. */
  readonly screen: string;
  /** Whether the flag ended ENABLED (a financial screen). */
  readonly secured: boolean;
}

/**
 * Apply the screenshots policy for one screen transition: financial →
 * `setFlagSecure(true)`; every other screen → `setFlagSecure(false)`
 * (release the block when leaving a financial surface). Returns the
 * outcome (the honest report the Settings screen can render).
 */
export async function applySecureScreenPolicy(
  port: SecureScreenPort,
  screenName: string,
): Promise<SecureScreenOutcome> {
  const secured = isFinancialScreen(screenName);
  await port.setFlagSecure(secured);
  return { screen: screenName, secured };
}
