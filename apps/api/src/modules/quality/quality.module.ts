import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
// PHASE-050 (W-26 — T-08): the sweep's inbox writer rides the
// NotificationsModule export (the asset-expiry-sweep wiring precedent).
import { NotificationsModule } from "../notifications/notifications.module";
import { NcrService } from "./application/ncr-service";
import { SpecificationService } from "./application/specification-service";
// PHASE-050 (W-26 — T-07 + T-08): the CAPA + calibration engines.
import { CapaService } from "./application/capa-service";
import { CalibrationService } from "./application/calibration-service";
import { QualityCalibrationSweepService } from "./application/quality-calibration-sweep-service";
// PHASE-050 (W-27 — T-09 + T-10 + T-11): the SPC + supplier-score + COA
// engines (the pure layers FIRST — the unit-first law — then the services
// that feed them; the 038 feed contract's consumer side lives in the
// purchasing scorecards, which read this module's store).
import { SpcService } from "./application/spc-service";
import { SupplierScoreService } from "./application/supplier-score-service";
import { CoaService } from "./application/coa-service";
import { registerQualityCalibrationJob } from "./infrastructure/calibration-sweep.job";
import { getBoss } from "../../infra/jobs/boss";
import {
  QualityCalibrationController,
  QualityCapaController,
  QualityCoaController,
  QualityNcrController,
  QualitySpecificationsController,
  QualitySpcController,
  QualitySupplierScoresController,
} from "./presentation/quality.controller";

/**
 * PHASE-050 (W-25 → W-26, 2026-11-23) THE QUALITY MODULE (QMS, CR-20):
 * the specifications plane (the per-item parameter register + the
 * inspection-result mapping contract) and the NCR engine (BR-102's
 * closure gate + G-62's SCRAP write-off through the REAL posting
 * engine) — W-25; the CAPA engine (BR-103's effectiveness gate + G-63's
 * external-cost posting) and the calibration register (D-08's
 * instrument-asset binding + the `quality-calibration-due` sweep — the
 * pg-boss daily queue registered on boot, the cmms registration shape)
 * — W-26. The PostingService + NumberingService ride the
 * AccountingModule import (the G-59/G-61/G-62/G-63 wiring precedent);
 * the asset card read is consumed through the fixed-assets store's own
 * surface (the documented contract — zero parallel computation); the
 * sweep's inbox writer rides the NotificationsModule export. The SPC
 * plane (W-27) computes its charts through the PURE module
 * (spc-statistics — the only SPC arithmetic), the supplier rolling
 * fold stores its rows for the 038 scorecards' documented feed read
 * (D-13 — the consumer reads, never re-computes), and the COA gate
 * composes the tolerance fold (BR-104 — the only evaluator); the
 * remaining planes (complaints/holds/recall W-28) extend THIS module
 * with their own services and stores on the same keys.
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [
    QualitySpecificationsController,
    QualityNcrController,
    QualityCapaController,
    QualityCalibrationController,
    // PHASE-050 (W-27 — T-09 + T-10 + T-11): the three new planes' routes.
    QualitySpcController,
    QualitySupplierScoresController,
    QualityCoaController,
  ],
  providers: [
    SpecificationService,
    NcrService,
    // PHASE-050 (W-26 — T-07 + T-08): the CAPA + calibration planes.
    CapaService,
    CalibrationService,
    QualityCalibrationSweepService,
    // PHASE-050 (W-27 — T-09 + T-10 + T-11): the SPC + supplier-score +
    // COA planes.
    SpcService,
    SupplierScoreService,
    CoaService,
  ],
  exports: [SpecificationService, NcrService, CapaService, CalibrationService],
})
export class QualityModule implements OnModuleInit {
  constructor(private readonly calibrationSweep: QualityCalibrationSweepService) {}

  /**
   * PHASE-050 (W-26 — T-08): the quality-calibration-due sweep's daily
   * queue registers on boot (the named schedule is idempotent — NO
   * DOUBLE LAUNCH; the structural dedupe makes raced passes converge;
   * the asset-expiry-sweep precedent's registration shape — the sweep
   * joins the standing isolate set from this wave).
   */
  async onModuleInit(): Promise<void> {
    await registerQualityCalibrationJob(getBoss(), this.calibrationSweep).catch((error) => {
      void error;
    });
  }
}
