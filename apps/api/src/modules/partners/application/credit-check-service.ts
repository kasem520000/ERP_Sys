import { Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/partners.store";
import { PartnerNotFoundError } from "../domain/partner-errors";

/**
 * Credit-check service interface (PHASE-006 §2.4/T6; BR-001): the seam
 * sales (PHASE-012) plugs into at document approval. `action` reads the
 * tenant policy `sales.credit_limit_action` (default `warn`).
 *
 * At this phase the exposure math runs over opening-balance DRAFT sums
 * only (the read model's draft_balance); open/overdue stay 0 until the
 * posting engine (PHASE-007) and documents (PHASE-008/012) exist — the
 * response labels the basis honestly.
 */

export interface CreditCheckResult {
  readonly partnerId: string;
  /** Signed open balance (tenant perspective); drafts only at this phase. */
  readonly openBalance: string;
  /** NULL = unlimited (BR-001). */
  readonly creditLimit: string | null;
  readonly overdueAmount: string;
  /** openBalance + amountDelta (the exposure the caller is about to add). */
  readonly projectedExposure: string;
  readonly limitExceeded: boolean;
  readonly hasOverdue: boolean;
  /** warn | block | allow per the tenant policy. */
  readonly action: "warn" | "block" | "allow";
  readonly basis: "DRAFTS_ONLY";
}

@Injectable()
export class CreditCheckService {
  /** Stateless interface call — sales approval (PHASE-012) enforces it. */
  async checkCredit(partnerId: string, amountDelta: string): Promise<CreditCheckResult> {
    const partner = await store.findPartnerById(partnerId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new PartnerNotFoundError(partnerId);
    }
    const balance = await store.findPartnerBalance(partnerId);
    const openBalance = balance?.openBalance ?? "0";
    const draftBalance = balance?.draftBalance ?? "0";
    const overdue = balance?.overdueAmount ?? "0";

    // At this phase the visible exposure is the draft sum; posted rows are
    // the read model's open_balance (0 until PHASE-007 posts anything).
    const exposureBase = new Decimal(draftBalance).add(new Decimal(openBalance));
    const projected = exposureBase.add(new Decimal(amountDelta));
    const overdueAmount = overdue;
    const hasOverdue = new Decimal(overdue).greaterThan(0);

    const policy = await readEffectiveSetting<"warn" | "block" | "allow">(
      "sales.credit_limit_action",
    );
    const limit = partner.creditLimit;
    const limitExceeded = limit !== null && projected.greaterThan(new Decimal(limit));

    const action: CreditCheckResult["action"] =
      limitExceeded || hasOverdue ? (policy ?? "warn") : "allow";

    return {
      partnerId,
      openBalance: exposureBase.toString(),
      creditLimit: limit,
      overdueAmount,
      projectedExposure: projected.toString(),
      limitExceeded,
      hasOverdue,
      action,
      basis: "DRAFTS_ONLY",
    };
  }
}
