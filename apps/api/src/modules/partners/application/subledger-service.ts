import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type {
  PartnerSubledgerEffect,
  PartnerSubledgerPort,
} from "../../accounting/application/partner-subledger-port";

/**
 * Partner subledger service (PHASE-007 T14; INV-009): the partners module's
 * implementation of the accounting-declared port — the ONLY writer of
 * `partner_subledger_entries` (MODULE_BOUNDARIES write matrix: `partners*`
 * tables belong to partners). Called inside the posting transaction; every
 * append recomputes the affected partners' `partner_balances.open_balance`
 * so the read model never drifts from the subledger.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("partner subledger access requires an ambient tenant scope");
  }
  return context.tx;
}

export class PartnerSubledgerService implements PartnerSubledgerPort {
  async recordJournalEffects(effects: readonly PartnerSubledgerEffect[]): Promise<void> {
    if (effects.length === 0) return;
    const tx = tenantTx();
    for (const effect of effects) {
      await tx.execute(sql`
        INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id,
                                               journal_line_id, entry_date, direction, amount,
                                               base_amount, currency_code, source_type, source_id, memo)
        VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${effect.partnerId},
                ${effect.journalEntryId}, ${effect.journalLineId}, ${effect.entryDate},
                ${effect.direction}, ${effect.amount}, ${effect.baseAmount}, ${effect.currencyCode},
                ${effect.sourceType}, ${effect.sourceId}, ${effect.memo})
      `);
    }
    const partners = [...new Set(effects.map((effect) => effect.partnerId))];
    for (const partnerId of partners) {
      await recomputePartnerOpenBalance(partnerId);
    }
  }
}

/** open_balance = signed base sum of the partner's subledger (INV-009 view). */
export async function recomputePartnerOpenBalance(partnerId: string): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO partner_balances (id, tenant_id, partner_id, open_balance, last_recomputed_at)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${partnerId},
            COALESCE((SELECT SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END)
                      FROM partner_subledger_entries WHERE partner_id = ${partnerId}), 0), now())
    ON CONFLICT ("tenant_id", "partner_id")
    DO UPDATE SET open_balance = EXCLUDED.open_balance, last_recomputed_at = now(),
                  version = partner_balances.version + 1, updated_at = now()
  `);
}
