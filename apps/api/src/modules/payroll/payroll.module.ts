import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { getBoss } from "../../infra/jobs/boss";
import { ApprovalWorkflow } from "./application/approval-workflow";
import { EmployeeService } from "./application/employee-service";
import { EosService } from "./application/eos-service";
import { LoanService } from "./application/loan-service";
import { PayoutService } from "./application/payout-service";
import { RunCalculationService } from "./application/run-calculation-service";
import { RunPostingService } from "./application/run-posting-service";
import { StructureService } from "./application/structure-service";
import { registerPayrollJobs } from "./infrastructure/run-calculation.job";
import { PayrollController } from "./presentation/payroll.controller";

/**
 * Payroll module (PHASE-029; DR-005/ED-05 — financial scope only): the
 * PII-restricted employee financial file, versioned salary structures
 * (BR-052), monthly runs posting exactly one G-29 journal through the
 * PHASE-007 engine (BR-053 engine-only payroll accounts; INV-025
 * totals law; INV-013 idempotency), G-30 payouts + treasury movements
 * (INV-019), BR-054-capped employee loans against the tenant-mapped
 * control account, and the BR-055 tenant-policy EOS provision with the
 * G-31 termination settlement.
 *
 * Dependencies (DEPENDENCY_RULES §2; phase §4): accounting (the posting
 * engine owns every journal — ADR-0007; periods, numbering, purposes) +
 * audit. Cross-module READ refs: tenancy branches, cost centers,
 * projects, treasury cash accounts. cash_movements is written ONLY
 * through the treasury store API (treasury-owned). Nothing writes the
 * payroll tables but payroll services (MODULE_BOUNDARIES write matrix);
 * no other module reads employee PII.
 *
 * The bounded run-calculation job (ADR-0008 — ids-only payloads, no PII
 * in jobs per TENANT_ISOLATION §3) registers tolerant at boot
 * (degrade-the-feature-never-the-platform).
 */
@Module({
  imports: [AccountingModule, AuditModule],
  controllers: [PayrollController],
  providers: [
    EmployeeService,
    StructureService,
    RunCalculationService,
    ApprovalWorkflow,
    RunPostingService,
    PayoutService,
    LoanService,
    EosService,
  ],
  exports: [EmployeeService, RunCalculationService, EosService],
})
export class PayrollModule implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await registerPayrollJobs(getBoss()).catch((error) => {
      void error;
    });
  }
}
