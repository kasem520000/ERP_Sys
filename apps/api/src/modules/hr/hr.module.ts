import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { AttendanceImportService } from "./application/attendance-import-service";
import { AttendanceService } from "./application/attendance-service";
import { ShiftService } from "./application/shift-service";
import { AttendanceImportController } from "./presentation/attendance-import.controller";
import { AttendanceController } from "./presentation/attendance.controller";
import { HrController } from "./presentation/hr.controller";

/**
 * HR module (PHASE-045 — HR Core: attendance, leaves & shifts). T-03
 * delivers the shift templates + the roster grid + the rotation pattern
 * generator (HR-04); T-04 adds the attendance service — punch-session
 * capture, the derived daily status (roster + holiday + leave), the
 * exception computation, and BR-082's immutability window; T-05 adds
 * the device-agnostic CSV import — preview/commit with the file
 * fingerprint, the anomaly quarantine, and the mapping setting; the
 * overtime/leave services (T-06/T-07) land in this module as the phase
 * proceeds.
 *
 * Dependencies (DEPENDENCY_RULES §2): audit only — attendance, shifts,
 * and rosters are operational rows, NEVER ledger documents (the posting
 * canon's note); the employees substrate (the 029 payroll baseline) is
 * READ under RLS (the hr store, the manufacturing-store cross-module-
 * read precedent).
 */
@Module({
  imports: [AuditModule],
  controllers: [HrController, AttendanceController, AttendanceImportController],
  providers: [ShiftService, AttendanceService, AttendanceImportService],
  exports: [ShiftService, AttendanceService, AttendanceImportService],
})
export class HrModule {}
