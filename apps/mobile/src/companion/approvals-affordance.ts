/**
 * PHASE-022 T-P22-3-b · the ONLINE-ONLY approvals affordance (MASTER-PLAN
 * §8 row 16 + §6.6; OFFLINE_CAPABILITIES_MATRIX: approvals are
 * ONLINE-ONLY — never queued, never faked). Pure state, no react-native
 * imports (DR-P22-01): the screen renders this; the shell links out.
 *
 * The binding rule: state = online ? link-out ENABLED : disabled WITH
 * REASON — an offline approvals tap is never queued, never silently
 * dropped; the disabled control carries the honest reason string (the
 * `onlineOnlyReason` catalog key).
 */

/** Why an ONLINE-ONLY affordance is disabled. */
export type OnlineOnlyDisableReason = "offline";

/** The approvals affordance state (row 16). */
export type ApprovalsAffordance =
  | { readonly enabled: true; readonly reason: null }
  | { readonly enabled: false; readonly reason: OnlineOnlyDisableReason };

/**
 * Resolve the approvals affordance for a connectivity state. ONLINE → the
 * link-out is enabled (the shell navigates to the approvals surface);
 * OFFLINE → disabled with the honest reason — NEVER queued (approvals are
 * §6.6 ONLINE_ONLY entities; a queued approval would be a lie about a
 * decision that cannot be made offline).
 */
export function approvalsAffordance(online: boolean): ApprovalsAffordance {
  return online
    ? { enabled: true, reason: null }
    : { enabled: false, reason: "offline" };
}

/**
 * The generic ONLINE-ONLY gate (the same rule for the §3
 * request-approval-online action): online → allowed; offline → refused
 * with the reason, never queued.
 */
export function onlineOnlyGate(online: boolean): { allowed: boolean; reason: OnlineOnlyDisableReason | null } {
  return online ? { allowed: true, reason: null } : { allowed: false, reason: "offline" };
}
