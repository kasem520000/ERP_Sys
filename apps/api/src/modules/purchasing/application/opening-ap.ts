import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import * as store from "../infrastructure/purchasing.store";

/**
 * Opening-AP settlement verification (PHASE-011 T12; G-16 AP side; INV-009):
 * the PHASE-007 opening partner balances (supplier side, posted through the
 * OPENING period) are ordinary allocatable open items on the AP subledger —
 * payments settle them like any invoice, statements/aging include them
 * deterministically, and Σ open items = AP_CONTROL from the first entry.
 * This service exposes the verification (used by the test suite + the
 * close checklist evidence), not a new posting path.
 */
@Injectable()
export class OpeningApService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * INV-009 verification at an as-of date: Σ signed subledger base amounts
   * (AP control side) must equal the AP_CONTROL account's GL balance
   * exactly — from the first entry (G-16 AP side included).
   */
  async verifyInv009(input: { asOf: string }): Promise<{
    ok: boolean;
    subledgerTotal: string;
    glBalance: string;
    openingItems: number;
    diff: string;
  }> {
    const apMapping = await accountingStore.findActivePurpose("AP_CONTROL");
    const glBalance = apMapping
      ? await store.glBalanceAsOf(apMapping.accountId, input.asOf)
      : "0.0000";

    const items = await store.apOpenItemsAsOf({
      asOf: input.asOf,
      openOnly: false,
      limit: 100000,
      side: "ALL",
    });
    let subledgerTotal = new Decimal(0);
    for (const item of items) {
      const signed = new Decimal(item.baseAmount).times(item.direction === "DEBIT" ? 1 : -1);
      subledgerTotal = subledgerTotal.plus(signed);
    }
    const opening = await store.openingApItems();
    const diff = subledgerTotal.minus(new Decimal(glBalance)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const result = {
      ok: diff === "0.0000",
      subledgerTotal: subledgerTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      glBalance,
      openingItems: opening.length,
      diff,
    };
    if (!result.ok) {
      await this.audit.record({
        action: "purchasing.opening_ap_verification_failed",
        entityType: "reconciliation_run",
        entityId: "00000000-0000-0000-0000-000000000000",
        after: result,
      });
    }
    return result;
  }

  /** The opening AP items (allocatable from entry #1). */
  async openingItems() {
    return store.openingApItems();
  }
}

/** Journal-entry read port for the test suite (isolated import surface). */
export function journalEntryById(id: string) {
  return journalStore.findEntryById(id);
}
