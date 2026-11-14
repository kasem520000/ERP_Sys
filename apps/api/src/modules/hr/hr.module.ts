import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module";
import { ShiftService } from "./application/shift-service";
import { HrController } from "./presentation/hr.controller";

/**
 * HR module (PHASE-045 — HR Core: attendance, leaves & shifts). T-03
 * delivers the shift templates + the roster grid + the rotation pattern
 * generator (HR-04); the attendance/overtime/leave services (T-04…T-07)
 * land in this module as the phase proceeds.
 *
 * Dependencies (DEPENDENCY_RULES §2): audit only — shifts and rosters
 * are planning rows, NEVER ledger documents (the posting canon's note);
 * the employees substrate (the 029 payroll baseline) is READ under RLS
 * (the hr store, the manufacturing-store cross-module-read precedent).
 */
@Module({
  imports: [AuditModule],
  controllers: [HrController],
  providers: [ShiftService],
  exports: [ShiftService],
})
export class HrModule {}
