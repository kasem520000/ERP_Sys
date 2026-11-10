import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { SalesModule } from "../sales/sales.module";
import { PosTerminalService } from "./application/terminal-service";
import { PosShiftFlowService } from "./application/shift-flow-service";
import { PosFloorService } from "./application/floor-service";
import { PosReceiptService } from "./application/receipt-service";
import { PosZReportService } from "./application/zreport-service";
import { PosController } from "./presentation/pos.controller";

/**
 * POS module (PHASE-016): the terminal layer over sales — terminal
 * registry + device enrollment, POS-grade shift UX over the treasury
 * shift model, the table-service floor (ledger-free until payment),
 * receipts through the PHASE-013 print templates, and the Z report.
 *
 * The SALE itself posts through the sales module's PosSaleService
 * (`sales/application/pos-channel` — a POS sale IS a sales invoice);
 * this module imports SalesModule for that service and exposes the
 * terminal/floor/receipt surfaces. The narrow sync slice lives in
 * SyncModule (same phase; §11 boundary).
 */
@Module({
  imports: [AccountingModule, AuditModule, TreasuryModule, SalesModule],
  controllers: [PosController],
  providers: [
    PosTerminalService,
    PosShiftFlowService,
    PosFloorService,
    PosReceiptService,
    PosZReportService,
  ],
  exports: [PosTerminalService, PosShiftFlowService, PosFloorService, PosZReportService],
})
export class PosModule {}
