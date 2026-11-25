import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { LcService } from "./application/lc-service";
import { TradeExpirySweepService } from "./application/trade-expiry-sweep-service";
import { registerTradeExpiryJob } from "./infrastructure/trade-expiry-sweep.job";
import { getBoss } from "../../infra/jobs/boss";
import { TradeLcController } from "./presentation/trade.controller";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25) THE TRADE MODULE (FTL, CR-21
 * — the LC engine + the expiry sweep): the LC lifecycle (issue → the
 * typed amendments with the G-64 margin adjustments → the documents
 * checklist with the discrepancy notes → retire) with G-64's postings
 * through the REAL posting engine (D-05) and the LC fees on the EXISTING
 * financial-charges discipline (the bank-charge pattern — zero new
 * machinery, zero new identifier) + BR-105's `trade-expiry-sweep`
 * (D-09 — the 0111/calibration pattern verbatim, the 30/14/7/1 ladder +
 * the discrepancy alerts + the ladder's own terminus, THE SIXTH
 * STANDING ISOLATE). The PostingService + NumberingService ride the
 * AccountingModule import (the G-62/G-63 wiring precedent); the sweep's
 * inbox writer rides the NotificationsModule export (the
 * asset-expiry-sweep wiring precedent); the tenant's chosen bank
 * accounts are consumed through the treasury store's own surface (the
 * documented contract — zero parallel computation). The remaining
 * planes (collections/incoterms W-35 · transport/tracking W-36 ·
 * customs W-37 · bonded/drawback W-38) extend THIS module with their
 * own services and stores on the same keys.
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [TradeLcController],
  providers: [LcService, TradeExpirySweepService],
  exports: [LcService, TradeExpirySweepService],
})
export class TradeModule implements OnModuleInit {
  constructor(private readonly expirySweep: TradeExpirySweepService) {}

  /**
   * PHASE-051 (W-34 — T-06): the trade-expiry-sweep's daily queue
   * registers on boot (the named schedule is idempotent — NO DOUBLE
   * LAUNCH; the structural dedupe makes raced passes converge; the
   * quality calibration registration shape — the sweep joins the
   * standing isolate set from this wave, the SIXTH).
   */
  async onModuleInit(): Promise<void> {
    await registerTradeExpiryJob(getBoss(), this.expirySweep).catch((error) => {
      void error;
    });
  }
}
