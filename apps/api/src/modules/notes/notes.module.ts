import { Module, type OnModuleInit } from "@nestjs/common";
import { Inject } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { getBoss } from "../../infra/jobs/boss";
import { NoteService } from "./application/note-service";
import { ReceiveService } from "./application/receive-service";
import { IssueService } from "./application/issue-service";
import { CollectionService } from "./application/collection-service";
import { DishonorService } from "./application/dishonor-service";
import { EndorsementService } from "./application/endorsement-service";
import { DiscountService } from "./application/discount-service";
import { NotesReconciliationService } from "./application/notes-reconciliation";
import { registerNotesJobs } from "./infrastructure/pdc-calendar.job";
import { NotesController } from "./presentation/notes.controller";

/**
 * Notes module (PHASE-027; DR-003/ED-03 option A): the notes register with
 * the custody state machine (BR-047), the append-only 🔒 custody log, the
 * G-24/G-25/G-26/G-27 money moments, the PDC maturity calendar read model,
 * and the RC-11 subledger check.
 *
 * Dependencies (DEPENDENCY_RULES §2; phase §4): accounting (the posting
 * engine owns every journal — ADR-0007) + audit + notifications (dishonor
 * surfacing). Cross-module READ refs: partners, sales/purchasing invoices,
 * treasury open items + cash accounts. notes NEVER writes journal/stock/
 * partner tables; cash_movements is written ONLY through the treasury store
 * API (treasury-owned).
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [NotesController],
  providers: [
    NoteService,
    ReceiveService,
    IssueService,
    CollectionService,
    DishonorService,
    EndorsementService,
    DiscountService,
    NotesReconciliationService,
  ],
  exports: [
    NoteService,
    ReceiveService,
    IssueService,
    CollectionService,
    DishonorService,
    NotesReconciliationService,
  ],
})
export class NotesModule implements OnModuleInit {
  constructor(
    @Inject(NotesReconciliationService)
    private readonly notesReconciliation: NotesReconciliationService,
  ) {}

  /**
   * The daily jobs (ADR-0008 — the crm sweep registration shape): the PDC
   * calendar refresh (2:20 UTC) + the RC-11 nightly check (2:30).
   * Degrade-the-feature-never-the-platform.
   */
  async onModuleInit(): Promise<void> {
    await registerNotesJobs(getBoss(), this.notesReconciliation).catch((error) => {
      void error;
    });
  }
}
