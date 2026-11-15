import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AttendanceImportService } from "./application/attendance-import-service";
import { LeaveService } from "./application/leave-service";
import { AttendanceService } from "./application/attendance-service";
import { OvertimeService } from "./application/overtime-service";
import { ShiftService } from "./application/shift-service";
import { AttendanceImportController } from "./presentation/attendance-import.controller";
import { AttendanceController } from "./presentation/attendance.controller";
import { HrController } from "./presentation/hr.controller";
import { LeaveController } from "./presentation/leave.controller";
import { OvertimeController } from "./presentation/overtime.controller";

/**
 * HR module (PHASE-045 — HR Core: attendance, leaves & shifts). T-03
 * delivers the shift templates + the roster grid + the rotation pattern
 * generator (HR-04); T-04 adds the attendance service — punch-session
 * capture, the derived daily status (roster + holiday + leave), the
 * exception computation, and BR-082's immutability window; T-05 adds
 * the device-agnostic CSV import — preview/commit with the file
 * fingerprint, the anomaly quarantine, and the mapping setting; T-06
 * adds the overtime engine — the multiplier-tier rules, the tier
 * matching (the tenant's weekend setting — never a fabricated
 * default), BR-084's pre-approval enforcement, and the per-day cap;
 * T-07 adds the leave engine — the type catalog, the per-year balance cells (INV-031 at the approve boundary), the request lifecycle with the simple approval, the accrual policy runs, and the carry-over rollover.
 *
 * Dependencies (DEPENDENCY_RULES §2): audit only — attendance, shifts,
 * and rosters are operational rows, NEVER ledger documents (the posting
 * canon's note); the employees substrate (the 029 payroll baseline) is
 * READ under RLS (the hr store, the manufacturing-store cross-module-
 * read precedent).
 */
@Module({
  imports: [AuditModule],
  controllers: [HrController, AttendanceController, AttendanceImportController, OvertimeController, LeaveController],
  providers: [ShiftService, AttendanceService, AttendanceImportService, OvertimeService, LeaveService],
  exports: [ShiftService, AttendanceService, AttendanceImportService, OvertimeService, LeaveService],
})
export class HrModule {}
