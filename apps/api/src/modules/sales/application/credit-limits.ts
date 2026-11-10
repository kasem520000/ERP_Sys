import { Decimal } from "@erp/domain-core";

import * as store from "../infrastructure/sales.store";
import {
  CustomerNotFoundError,
  CreditLimitExceededError,
} from "../domain/sales-errors";

/**
 * Credit-limit service (PHASE-012 T10; BR-001; RECEIVABLES_AND_PAYABLES
 * §4 credit management): server-side enforcement at sales-invoice APPROVAL
 * with the no-TOCTOU re-verification at post. The check composes:
 *
 *   exposure = partner open AR balance (base) + this document (base)
 *   breach   = limit !== null && exposure > limit
 *   overdue  = open AR items past due (count > 0 factors in)
 *
 * Postures (sales.credit_limit_action, BR-001): warn (default — the
 * document proceeds with the decision + math recorded on it), block
 * (approval refused; override requires sales.credit_check.override —
 * risky, audited), allow (no check at all). The per-partner override is
 * the partner's own credit_limit (NULL = unlimited). The UI only reflects
 * the server decision — never decides.
 */

export interface CreditCheckResult {
  readonly posture: "warn" | "block" | "allow";
  readonly partnerId: string;
  readonly openBalance: string;
  readonly documentAmount: string;
  readonly limit: string | null;
  readonly wouldExceed: boolean;
  readonly overdueCount: number;
  readonly decision: "ALLOW" | "WARN" | "BLOCK";
  readonly math: string;
}

export async function runCreditCheck(input: {
  customerId: string;
  documentAmountBase: string;
}): Promise<CreditCheckResult> {
  const customer = await store.findCustomerById(input.customerId);
  if (customer === undefined) throw new CustomerNotFoundError(input.customerId);

  const posture =
    (await store.readSetting<"warn" | "block" | "allow">("sales.credit_limit_action")) ?? "warn";
  if (posture === "allow") {
    return {
      posture,
      partnerId: input.customerId,
      openBalance: "0.0000",
      documentAmount: input.documentAmountBase,
      limit: customer.creditLimit,
      wouldExceed: false,
      overdueCount: 0,
      decision: "ALLOW",
      math: "posture allow — no check",
    };
  }

  const openBalance = await store.partnerArOpenBalanceBase(input.customerId);
  const today = new Date().toISOString().slice(0, 10);
  const openItems = await store.arOpenItemsAsOf({
    customerId: input.customerId,
    asOf: today,
    openOnly: true,
    limit: 10000,
  });
  const overdueCount = openItems.filter(
    (item) => item.dueDate !== null && item.dueDate < today,
  ).length;

  const exposure = new Decimal(openBalance).plus(new Decimal(input.documentAmountBase));
  const limit = customer.creditLimit;
  const wouldExceed = limit !== null && exposure.comparedTo(new Decimal(limit)) > 0;
  const math = `${new Decimal(openBalance).toFixed(4)} + ${new Decimal(input.documentAmountBase).toFixed(4)} ${
    wouldExceed ? ">" : "<="
  } ${limit ?? "∞"}`;
  // BR-001: over-limit OR overdue triggers the posture.
  const triggered = wouldExceed || overdueCount > 0;
  return {
    posture,
    partnerId: input.customerId,
    openBalance: new Decimal(openBalance).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    documentAmount: input.documentAmountBase,
    limit,
    wouldExceed,
    overdueCount,
    decision: triggered ? (posture === "block" ? "BLOCK" : "WARN") : "ALLOW",
    math,
  };
}

/**
 * The approval-time enforcement: block posture + triggered → typed
 * CREDIT_LIMIT_EXCEEDED (with the math in the payload); warn → the result
 * (recorded on the document); allow → the result. override=true (the
 * caller verified sales.credit_check.override) converts BLOCK to WARN and
 * stamps the override on the result.
 */
export async function enforceAtApproval(input: {
  customerId: string;
  documentAmountBase: string;
  override: boolean;
}): Promise<CreditCheckResult> {
  const check = await runCreditCheck(input);
  if (check.decision === "BLOCK") {
    if (input.override) {
      return { ...check, decision: "WARN", math: `${check.math} — overridden` };
    }
    throw new CreditLimitExceededError({
      partnerId: check.partnerId,
      openBalance: check.openBalance,
      documentAmount: check.documentAmount,
      limit: check.limit,
      overdueCount: check.overdueCount,
      posture: check.posture,
      math: check.math,
    });
  }
  return check;
}

/** The published preview (POST /partners/partners/:id/credit-check). */
export async function creditCheckPreview(input: {
  customerId: string;
  documentAmountBase: string;
}): Promise<CreditCheckResult> {
  return runCreditCheck(input);
}
