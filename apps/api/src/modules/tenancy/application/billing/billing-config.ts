/**
 * PHASE-014 billing configuration (SUBSCRIPTION §7/§8): every duration and
 * threshold in this file is a PLACEHOLDER ⚠ pending the OQ-002 commercial
 * pass — the same discipline as the plan seeds (RISK-003: changing a number
 * here is configuration, never an architecture change). The proposal
 * defaults follow SUBSCRIPTION_AND_ENTITLEMENTS §7–§8.
 */

/** Trial duration in days ⚠ (§7 proposal: 14). */
export const TRIAL_DAYS = 14;
/** Read-only grace duration in days ⚠ (§8 proposal: 14). */
export const GRACE_DAYS = 14;
/** Dunning retries before grace ⚠ (provider adapter steps — §8). */
export const MAX_DUNNING_STEPS = 2;
/** Minimum hours between dunning warnings ⚠. */
export const DUNNING_INTERVAL_HOURS = 48;
/** Webhook timestamp tolerance in seconds (replay window, SECRETS §webhook). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
/** Invoice due days after issuance ⚠. */
export const INVOICE_DUE_DAYS = 7;

/** Soft-warning thresholds (§6 matrix: 80% and 100%). */
export const WARN_THRESHOLDS = [0.8, 1.0] as const;

/** Resolving-action copy (bilingual, ERROR_MODEL detail shape). */
export const RESOLVING_ACTIONS = {
  readOnly: {
    ar: "ادفع أو قم بترقية الخطة لاستعادة القدرة على الترحيل — تظل التقارير والتصدير والطباعة متاحة",
    en: "Pay or upgrade the plan to restore posting — reports, export, and printing stay available",
  },
  limitUsers: {
    ar: "قم بترقية الخطة أو قم بإنهاء عضوية مستخدم لتحرير مقعد",
    en: "Upgrade the plan or revoke a membership to free a seat",
  },
  limitBranches: {
    ar: "قم بترقية الخطة أو قم بتعطيل فرع لتحرير مقعد",
    en: "Upgrade the plan or deactivate a branch to free a slot",
  },
  limitWarehouses: {
    ar: "قم بترقية الخطة أو قم بتعطيل مستودعًا لتحرير مقعد",
    en: "Upgrade the plan or deactivate a warehouse to free a slot",
  },
} as const;

/** The current month period key for documents/month counters. */
export function currentMonthPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Add days to a date, ISO-string out (lifecycle arithmetic helper). */
export function plusDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Limit value shape from plan seeds: number | "unlimited" (§2 matrix). */
export type LimitValue = number | "unlimited";

export function limitOf(limits: Record<string, unknown>, key: string): LimitValue {
  const raw = limits[key];
  if (raw === "unlimited" || raw === "Unlimited") {
    return "unlimited";
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  // Unknown/missing limits are never enforced (fail-open documented: the
  // seeds are the only limit source and PLACEHOLDER values are numbers).
  return "unlimited";
}
