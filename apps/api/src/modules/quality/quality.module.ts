import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { NcrService } from "./application/ncr-service";
import { SpecificationService } from "./application/specification-service";
import { QualityNcrController, QualitySpecificationsController } from "./presentation/quality.controller";

/**
 * PHASE-050 (W-25 — T-05 + T-06, 2026-11-23) THE QUALITY MODULE (QMS,
 * CR-20): the specifications plane (the per-item parameter register +
 * the inspection-result mapping contract) and the NCR engine (BR-102's
 * closure gate + G-62's SCRAP write-off through the REAL posting
 * engine). The PostingService + NumberingService ride the
 * AccountingModule import (the G-59/G-61 wiring precedent); the
 * inventory/manufacturing reads are consumed through the owning
 * stores' own surfaces (the documented contracts — zero parallel
 * computation), never through re-provided providers. The remaining
 * planes (CAPA/calibration W-26 · SPC/supplier/COA W-27 · complaints/
 * holds/recall W-28) extend THIS module with their own services and
 * stores on the same keys.
 */
@Module({
  imports: [AccountingModule, AuditModule],
  controllers: [QualitySpecificationsController, QualityNcrController],
  providers: [SpecificationService, NcrService],
  exports: [SpecificationService, NcrService],
})
export class QualityModule {}
