import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { ConfigurationModule } from "../configuration/configuration.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AttendanceImportService } from "./application/attendance-import-service";
import { BridgeService } from "./application/bridge-service";
import { FeedService } from "./application/feed-service";
import { LeavePostingService } from "./application/leave-posting-service";
import { LeaveService } from "./application/leave-service";
import { HolidayService } from "./application/holiday-service";
import { AttendanceService } from "./application/attendance-service";
import { OvertimeService } from "./application/overtime-service";
import { SelfServiceService } from "./application/self-service-service";
import { ShiftService } from "./application/shift-service";
import { TalentAlertsService } from "./application/talent-alerts-service";
import { TalentBridgesService } from "./application/talent-bridges-service";
import { TalentGoalsService } from "./application/talent-goals-service";
import { TalentOrgService } from "./application/talent-org-service";
import { TalentPerformanceService } from "./application/talent-performance-service";
import { TalentRecruitmentService } from "./application/talent-recruitment-service";
import { TalentTrainingService } from "./application/talent-training-service";
import { getBoss } from "../../infra/jobs/boss";
import { registerHrExpiryJob } from "./infrastructure/hr-expiry-sweep.job";
import { AttendanceImportController } from "./presentation/attendance-import.controller";
import { AttendanceController } from "./presentation/attendance.controller";
import { BridgeController } from "./presentation/bridge.controller";
import { FeedController } from "./presentation/feed.controller";
import { HrController } from "./presentation/hr.controller";
import { LeavePostingController } from "./presentation/leave-posting.controller";
import { LeaveController } from "./presentation/leave.controller";
import { HolidayController } from "./presentation/holiday.controller";
import { OvertimeController } from "./presentation/overtime.controller";
import { SelfServiceController } from "./presentation/self-service.controller";
import { TalentDocumentsController } from "./presentation/talent-documents.controller";
import { TalentGoalsController } from "./presentation/talent-goals.controller";
import { TalentBridgesController } from "./presentation/talent-bridges.controller";
import { TalentOrgController } from "./presentation/talent-org.controller";
import { TalentPerformanceController } from "./presentation/talent-performance.controller";
import { TalentRecruitmentController } from "./presentation/talent-recruitment.controller";
import { TalentTrainingController } from "./presentation/talent-training.controller";

/**
 * HR module (PHASE-045 — HR Core: attendance, leaves & shifts). T-03
 * delivers the shift templates + the roster grid + the rotation pattern
 * generator (HR-04); T-04 adds the attendance service — punch-session
 * capture, the derived daily status (roster + holiday + leave), the
 * exception computation, and BR-082's immutability window; T-05 adds the
 * device-agnostic CSV import — preview/commit with the file
 * fingerprint, the anomaly quarantine, and the mapping setting; T-06
 * adds the overtime engine — the multiplier-tier rules, the tier
 * matching (the tenant's weekend setting — never a fabricated
 * default), BR-084's pre-approval enforcement, and the per-day cap;
 * T-07 adds the leave engine — the type catalog, the per-year balance cells (INV-031 at the approve boundary), the request lifecycle with the simple approval, the accrual policy runs, and the carry-over rollover; T-08 adds the holiday calendars — the per-jurisdiction master data feeding the attendance derivation and the overtime HOLIDAY tier; T-09 adds the employee ↔ user identity bridge (HR-13) — the one-to-one link with the uniqueness guard, the audit trail, and the SoD law (linking grants nothing); T-10 adds the payroll variable feeds + the leave balance snapshots (PHASE-046's inputs); T-11 adds the goldens G-50/G-51; T-12/T-13 add the web screens; T-14 adds the self-service plane (the OWN-ROWS reads + the two narrow writes, `hr.self_service` runtime-granted with the bridge as the ownership boundary) — and with it THE ENVELOPE LAW REPAIR (the dated 2026-11-16 note, found by T-14's HTTP-level test): every hr controller site now awaits its service call INSIDE envelope(...) — the pre-T-14 shape `return envelope(this.svc.method(...))` handed Express a Promise NESTED in the data field, which serializes as `{}` (and a service rejection became an unhandled promise AFTER a 200 was already sent — the error filter never saw it). The hr routes were never exercised at the HTTP layer before T-14 (the __db__ specs call the services directly), so the defect was invisible to every earlier gate; the SAME latent pattern exists in the shipped modules' unawaited sites (sales/inventory/purchasing/sourcing/wms/tax/…) — out of this phase's scope, recorded for the owner's dispatch (the parallel-work protocol: no cross-phase edits without the owner's direction).
 *
 * Dependencies (DEPENDENCY_RULES §2): audit only — attendance, shifts,
 * and rosters are operational rows, NEVER ledger documents (the posting
 * canon's note); the employees substrate (the 029 payroll baseline) is
 * READ under RLS (the hr store, the manufacturing-store cross-module-
 * read precedent). T-11's G-50/G-51 goldens add the ACCOUNTING +
 * CONFIGURATION imports (PostingService + the effective-config policy
 * seam) — the plan's posting-canon extension (JOURNAL_RULES §7), the
 * payroll module's own dependency shape; the leave family's ONLY
 * ledger surfaces.
 *
 * PHASE-047 (W-2 — T-05 + T-06): the talent engines join the module —
 * TalentPerformanceService (the cycle lifecycle CAS, the review
 * submission, the BR-090 aggregate read, the calibration, the
 * competency framework) + TalentGoalsService (the cascade tree with
 * the D-09 guard, BR-089's check, the KRI triage) and their two
 * controllers (matrix §3.25's keys). Ledger-free by design (D-05): the
 * talent plane adds no ledger surface — the accounting imports above
 * stay the leave family's alone.
 *
 * PHASE-047 (W-3 — T-07 + T-08 + T-09): the growth engines join —
 * TalentRecruitmentService (BR-088's monotonic pipeline + the recorded
 * reopen + the hire act's written-once employee link + the panel
 * scorecards), TalentTrainingService (the programs/enrollments/
 * certifications registers), TalentOrgService (the D-09 cycle-safe org
 * tree + positions + the HR-10 document register) and
 * TalentAlertsService (the hr-expiry-sweep — D-06's four probes, the
 * BR-091 structural dedupe, the 044-pattern config row) + their four
 * controllers (matrix §3.25's keys) + the NOTIFICATIONS import (the
 * sweep's InboxService target — the inventory module's dependency
 * shape) + the module's FIRST OnModuleInit (the pg-boss registration,
 * the warranty-expiry job's shape: degraded-boot — a registration
 * failure never blocks module init). Still ledger-free (D-05) and
 * still never a payroll write (D-01: the hire LINKS an existing
 * employee, the employees table stays read-only to the talent plane).
 * PHASE-047 (W-4 — T-10): the external bridges join — TalentBridgesService
 * (the three export contracts over the 046 remittance-export precedent
 * + the two import paths with row-level validation reports riding the
 * W-2/W-3 engines' own acts) + its controller (5 routes on the matrix
 * §3.25 keys: payroll.employees.view ×2 · hr.performance.view ×1 ·
 * hr.performance.manage ×1 · hr.training.manage ×1 — no new keys, drift
 * stays 312 = 312). Amendment A-4's PII cross-check is structural
 * (domain/talent-bridge.ts's forbidden-axes list + the unit spec);
 * still ledger-free (D-05) and still never a payroll write (D-01: the
 * exports READ the employees substrate under RLS, that is all).
 */
@Module({
  imports: [AuditModule, AccountingModule, ConfigurationModule, NotificationsModule],
  controllers: [HrController, AttendanceController, AttendanceImportController, OvertimeController, LeaveController, HolidayController, BridgeController, FeedController, LeavePostingController, SelfServiceController, TalentPerformanceController, TalentGoalsController, TalentRecruitmentController, TalentTrainingController, TalentOrgController, TalentDocumentsController, TalentBridgesController],
  providers: [ShiftService, AttendanceService, AttendanceImportService, OvertimeService, LeaveService, HolidayService, BridgeService, FeedService, LeavePostingService, SelfServiceService, TalentPerformanceService, TalentGoalsService, TalentRecruitmentService, TalentTrainingService, TalentOrgService, TalentAlertsService, TalentBridgesService],
  exports: [ShiftService, AttendanceService, AttendanceImportService, OvertimeService, LeaveService, HolidayService, BridgeService, FeedService, LeavePostingService, SelfServiceService, TalentPerformanceService, TalentGoalsService, TalentRecruitmentService, TalentTrainingService, TalentOrgService, TalentAlertsService, TalentBridgesService],
})
export class HrModule implements OnModuleInit {
  /** The hr-expiry-sweep's registration (D-06 — the pg-boss queue
   * `hr-expiry-sweep`, daily 04:15 UTC; degraded-boot: the .catch
   * keeps a boss-less boot (the DB specs) green — the sales module's
   * warranty precedent). */
  async onModuleInit(): Promise<void> {
    await registerHrExpiryJob(getBoss(), this.alerts).catch(() => undefined);
  }

  constructor(private readonly alerts: TalentAlertsService) {}
}
