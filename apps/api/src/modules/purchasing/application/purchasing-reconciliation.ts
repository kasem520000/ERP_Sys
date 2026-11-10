import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as store from "../infrastructure/purchasing.store";

/**
 * GRNI reconciliation (PHASE-011; RECONCILIATION map row 8; RC-09): the
 * GRNI register — Σ (received value − invoiced value) over POSTED GRN
 * lines, per the deterministic as-of recomputation — must equal the GRNI
 * account's GL balance exactly, at every step (GRN → invoice → partial
 * invoice). BROKEN blocks the period lock via the PHASE-007 framework
 * (kind 'GRNI' + PC-04) and fires the notification record.
 */
@Injectable()
export class PurchasingReconciliationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * RC-09 green path + drift: GRNI register vs GRNI account balance as-of.
   * SIGN CONVENTION: the register's outstanding accrual (received −
   * invoiced) is CREDIT-positive (a liability); the GL read returns
   * DEBIT−CREDIT — the comparison negates the GL side. No GRNI mapping →
   * NOT_APPLICABLE-shaped OK (nothing posts CR GRNI in that tenant);
   * zero-activity runs are OK with zero counts.
   */
  async runGrniCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }) {
    const mapping = await store.findActiveGrniAccount();
    const register = await store.grniRegister(input.asOf);
    let registerValue = new Decimal(0);
    for (const row of register) {
      registerValue = registerValue
        .plus(new Decimal(row.receivedValue))
        .minus(new Decimal(row.invoicedValue));
    }
    const glBalance = mapping ? await store.glBalanceAsOf(mapping.accountId, input.asOf) : "0.0000";
    // GL (DEBIT−CREDIT) vs register (credit-positive): diff = register + GL.
    const diff = registerValue.plus(new Decimal(glBalance)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const status = !mapping
      ? register.length === 0
        ? "OK"
        : "BROKEN"
      : diff === "0.0000"
        ? "OK"
        : "BROKEN";

    const run = await journalStore.insertReconciliationRun({
      kind: "GRNI",
      asOf: input.asOf,
      status,
      controlBalance: new Decimal(glBalance).times(-1).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      subledgerBalance: registerValue.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      diffCount: status === "OK" ? 0 : 1,
      diff: {
        lines: register.length,
        grniMapped: mapping !== undefined,
        diff,
      },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (status === "BROKEN") {
      await this.audit.record({
        action: "purchasing.grni_reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: {
          kind: "GRNI",
          register: registerValue.toFixed(4),
          gl: glBalance,
          diff,
        },
      });
    }
    return run;
  }
}
