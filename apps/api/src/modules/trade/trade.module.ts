import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { LcService } from "./application/lc-service";
import { CollectionsService } from "./application/collections-service";
import { IncotermsService } from "./application/incoterms-service";
import { TransportService } from "./application/transport-service";
import { TrackingService } from "./application/tracking-service";
import { CustomsService } from "./application/customs-service";
import { BondedService } from "./application/bonded-service";
import { DrawbackService } from "./application/drawback-service";
import { CertificateService } from "./application/certificate-service";
import { TradeExpirySweepService } from "./application/trade-expiry-sweep-service";
import { registerTradeExpiryJob } from "./infrastructure/trade-expiry-sweep.job";
import { getBoss } from "../../infra/jobs/boss";
import { TradeLcController } from "./presentation/trade.controller";
import {
  TradeCollectionsController,
  TradeIncotermsController,
} from "./presentation/trade-collections.controller";
import {
  TradeTrackingController,
  TradeTransportController,
} from "./presentation/trade-transport.controller";
import { TradeCustomsController } from "./presentation/trade-customs.controller";
import { TradeBondedController } from "./presentation/trade-bonded.controller";
import { TradeCertificatesController } from "./presentation/trade-certificates.controller";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25; W-35 — T-07 + T-08,
 * 2026-11-25; W-36 — T-09 + T-13, 2026-11-25; W-37 — T-10, 2026-11-25)
 * THE TRADE MODULE (FTL, CR-21 — the LC engine + the expiry sweep + the
 * collections + the Incoterms registry + the transport documents + the
 * shipment tracking + THE CUSTOMS ENGINE): the LC
 * lifecycle (issue → the typed amendments with the G-64 margin
 * adjustments → the documents checklist with the discrepancy notes →
 * retire) with G-64's postings through the REAL posting engine (D-05)
 * and the LC fees on the EXISTING financial-charges discipline (the
 * bank-charge pattern — zero new machinery, zero new identifier) +
 * BR-105's `trade-expiry-sweep` (D-09 — the 0111/calibration pattern
 * verbatim, the 30/14/7/1 ladder + the discrepancy alerts + the
 * ladder's own terminus, THE SIXTH STANDING ISOLATE) + the
 * documentary collections register (T-07 — the D/P and D/A fold
 * VERBATIM, the settlement linkage, NO GL entry by design — the
 * non-ledger-document law's trade face) + the Incoterms registry
 * (T-08 — the tenant-extensible rows with the risk-hint matrix from
 * the row's OWN data, the onboarding materialization through the
 * trade-canonical one-source shape, and BR-106's shared order gate
 * consumed by the purchasing/sales issue acts through the documented
 * contract — the plain-function surface, never a module coupling).
 * The PostingService + NumberingService ride the AccountingModule
 * import (the G-62/G-63 wiring precedent; the collections register
 * reserves its official numbers through the same surface); the
 * sweep's inbox writer rides the NotificationsModule export (the
 * asset-expiry-sweep wiring precedent); the tenant's chosen bank
 * accounts are consumed through the treasury store's own surface
 * (the documented contract — zero parallel computation) + the customs
 * engine (T-10 — the declarations ladder with the D-06 duty/VAT line
 * fold and THE G-65 COMPLETION through the REAL LandedCostService
 * VERBATIM — D-15(a)'s documented contract: the PurchasingModule
 * import is one-directional (purchasing consumes the trade gates
 * through PLAIN FUNCTIONS — the order gate + the customs landed-cost
 * floor; the trade module consumes the landed-cost SERVICE through
 * the module import — never a cycle)) + **THE BONDED ENGINE (W-38 —
 * T-11, 2026-11-25: G-66's in-bond transfer through the REAL movement
 * core with NO duty entry + BR-107's exactly-once release recognition
 * through the revaluation discipline + THE SHARED GATE at the movement
 * core's planIssue — the bonded-gate plain function, the hold-gate
 * precedent's own shape) + THE DRAWBACK ENGINE (W-38 — T-12: BR-108's
 * export-evidence gate + the honest no-GL workflow — the claim is a
 * registry record, the refund lands when treasury records it, 053's
 * surface)**. The bonded engine's revaluation ride goes through the
 * InventoryModule import (the RevaluationService export — the
 * purchasing module's own wiring precedent; one-directional, never a
 * cycle: the movement core consumes the trade gate through the plain
 * function, the bonded service consumes the movement core and the
 * revaluation service through the module's exported surface). The
 * remaining plane (web W-39) extends the screens on the same keys.
 */
@Module({
  imports: [AccountingModule, AuditModule, InventoryModule, NotificationsModule, PurchasingModule],
  controllers: [
    TradeLcController,
    TradeCollectionsController,
    TradeIncotermsController,
    TradeTransportController,
    TradeTrackingController,
    TradeCustomsController,
    TradeBondedController,
    TradeCertificatesController,
  ],
  providers: [
    LcService,
    CollectionsService,
    IncotermsService,
    TransportService,
    TrackingService,
    CustomsService,
    BondedService,
    DrawbackService,
    CertificateService,
    TradeExpirySweepService,
  ],
  exports: [
    LcService,
    CollectionsService,
    IncotermsService,
    TransportService,
    TrackingService,
    CustomsService,
    BondedService,
    DrawbackService,
    CertificateService,
    TradeExpirySweepService,
  ],
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
