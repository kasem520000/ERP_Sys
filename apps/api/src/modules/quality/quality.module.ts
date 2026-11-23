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
import { registerQualityCalibrationJob } from "./infrastructure/calibration-sweep.job";
import { getBoss } from "../../infra/jobs/boss";
import {
  QualityCalibrationController,
  QualityCapaController,
  QualityNcrController,
  QualitySpecificationsController,
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
 * sweep's inbox writer rides the NotificationsModule export. The
 * remaining planes (SPC/supplier/COA W-27 · complaints/holds/recall
 * W-28) extend THIS module with their own services and stores on the
 * same keys.
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [
    QualitySpecificationsController,
    QualityNcrController,
    QualityCapaController,
    QualityCalibrationController,
  ],
  providers: [
    SpecificationService,
    NcrService,
    // PHASE-050 (W-26 — T-07 + T-08): the CAPA + calibration planes.
    CapaService,
    CalibrationService,
    QualityCalibrationSweepService,
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
