import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { PartnerSubledgerService } from "../partners/application/subledger-service";
import { CoaService } from "./application/coa-service";
import { PeriodService } from "./application/period-service";
import { FxService } from "./application/fx-service";
import { PostingService } from "./application/posting-service";
import { JournalService } from "./application/journal-service";
import { GlQueries } from "./application/gl-queries";
import { NumberingService } from "./application/numbering-service";
import { OpeningBalancesPostingService } from "./application/opening-balances-service";
import { YearEndService } from "./application/year-end-service";
import { ReconciliationService } from "./application/reconciliation-service";
import { AccountingController } from "./presentation/accounting.controller";
import { JournalsController } from "./presentation/journals.controller";
import { GlController } from "./presentation/gl.controller";
import { PARTNER_SUBLEDGER_PORT } from "./application/partner-subledger-port";

/**
 * Accounting module (PHASE-007): the posting engine + fiscal calendar + GL.
 * The partner-subledger port (declared in THIS module's application layer)
 * is bound here to the partners module's implementation — the sanctioned
 * MODULE_BOUNDARIES seam (partners owns the subledger table; the posting
 * transaction calls the port so entry + subledger rows commit atomically,
 * INV-009). The engine itself imports nothing (ADR-0007); no accounting
 * layer file imports any business module (DEPENDENCY_RULES §2 — this
 * binding is the module's composition point, above the layers).
 */
@Module({
  imports: [AuditModule],
  controllers: [AccountingController, JournalsController, GlController],
  providers: [
    { provide: PARTNER_SUBLEDGER_PORT, useClass: PartnerSubledgerService },
    CoaService,
    PeriodService,
    FxService,
    PostingService,
    JournalService,
    GlQueries,
    NumberingService,
    OpeningBalancesPostingService,
    YearEndService,
    ReconciliationService,
  ],
  exports: [
    CoaService,
    PeriodService,
    FxService,
    PostingService,
    JournalService,
    GlQueries,
    NumberingService,
    OpeningBalancesPostingService,
    YearEndService,
    ReconciliationService,
  ],
})
export class AccountingModule {}
