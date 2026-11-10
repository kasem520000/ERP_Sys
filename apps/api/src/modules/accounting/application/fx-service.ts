import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/accounting.store";
import { ExchangeRateInvalidError } from "../domain/accounting-errors";

/**
 * Exchange-rate service (PHASE-007 T5; CURRENCY_AND_PRECISION §5;
 * JOURNAL_RULES §4): dated MANUAL|IMPORTED rates (base per 1 foreign,
 * rate > 0 — INV-008), dated lookup (latest row on or before the date),
 * and the manual document-level override contract (recorded on the entry
 * by the posting service). Rate rows supersede by update — never delete.
 */

@Injectable()
export class FxService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter?: { currencyCode?: string; fromDate?: string; toDate?: string }) {
    return store.listExchangeRates(filter);
  }

  async upsert(
    actorId: string,
    input: { currencyCode: string; rateDate: string; rate: string },
  ): Promise<store.ExchangeRateRow> {
    if (!/^[0-9]+(\.[0-9]+)?$/.test(input.rate) || Number(input.rate) <= 0) {
      throw new ExchangeRateInvalidError(`rate must be a positive decimal (got ${input.rate})`);
    }
    if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
      throw new ExchangeRateInvalidError(`currency code must be ISO-4217 (got ${input.currencyCode})`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.rateDate)) {
      throw new ExchangeRateInvalidError("rateDate must be an ISO calendar date");
    }
    const saved = await store.upsertExchangeRate({ ...input, source: "MANUAL" });
    await this.audit.record({
      action: "accounting.exchange_rate_upserted",
      entityType: "exchange_rate",
      entityId: saved.id,
      actorId,
      after: { currency: saved.currencyCode, date: saved.rateDate, rate: saved.rate },
    });
    return saved;
  }

  /**
   * Dated lookup for posting: the latest rate on or before `date`. Throws
   * the typed engine error shape when absent (the caller maps it to
   * MISSING_FX_RATE at spec-build time).
   */
  async rateFor(currencyCode: string, date: string): Promise<string | undefined> {
    const row = await store.findRateForDate(currencyCode, date);
    return row?.rate;
  }
}
