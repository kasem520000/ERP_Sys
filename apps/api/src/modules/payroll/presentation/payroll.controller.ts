import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ApprovalWorkflow } from "../application/approval-workflow";
import { EmployeeService, toEmployeeView } from "../application/employee-service";
import { EosService } from "../application/eos-service";
import { LoanService } from "../application/loan-service";
import { PayoutService } from "../application/payout-service";
import { RunCalculationService } from "../application/run-calculation-service";
import { RunPostingService } from "../application/run-posting-service";
import { StructureService } from "../application/structure-service";

/**
 * Payroll routes (PHASE-029 §4; matrix §3.14): every route
 * permission-guarded with the exact seeded keys, Idempotency-Key-guarded
 * by the global POST guard (IDEMPOTENCY §1.1), success envelope
 * throughout. Foreign/unknown ids are 404-shaped (A7 — RLS makes them
 * indistinguishable).
 *
 * PII discipline on the employee surface: reads audit (the service does
 * it — payroll.employee_read on EVERY read); responses MASK national_id +
 * bank fields by construction (toEmployeeView — the restricted
 * payroll.employees.view gates the ROUTE, the masked shape is the only
 * shape that leaves); no payroll payload field ever enters a log line.
 *
 * Permission mapping (§3.14): payroll.employees.view/manage guard the
 * employee file; payroll.salary_structures.manage owns the builder;
 * payroll.runs.view reads runs; payroll.runs.create owns create +
 * calculate + submit (draft-state moves); payroll.runs.approve is the SoD
 * approval key; payroll.runs.post owns post + reverse + payout (the
 * ledger-touching actions); payroll.loans.manage owns loans + waive +
 * write-off + EOS settlement.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const CODE = z.string().regex(/^[A-Za-z0-9._/-]{1,40}$/, "tenant-scoped natural code");
const NAME = z.string().min(1).max(200);
const TEXT = z.string().min(1).max(2000).nullable().optional();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const RATE = z.string().regex(/^\d+(\.\d{1,4})?$/, "percent rate (≤ 4dp)");
const REASON = z.string().min(1).max(500);
const ENUM_STATUS = z.enum(["ACTIVE", "SUSPENDED", "TERMINATED"]);
const CONTRACT = z.enum(["FULL_TIME", "PART_TIME", "CONTRACTOR"]);
const KIND = z.enum(["ALLOWANCE", "DEDUCTION", "EMPLOYER_CONTRIBUTION"]);
const CALC = z.enum(["FIXED", "PERCENT_OF_BASIC", "PERCENT_OF_GROSS"]);
const LOCALE = z.enum(["ar", "en"]).default("ar");

const createEmployeeSchema = z.object({
  code: CODE,
  name: NAME,
  nameAr: TEXT,
  nationalId: z.string().min(3).max(60).nullable().optional(),
  hireDate: DATE,
  contractType: CONTRACT,
  basicSalary: MONEY,
  salaryStructureId: UUID.nullable().optional(),
  branchId: UUID.nullable().optional(),
  costCenterId: UUID.nullable().optional(),
  projectId: UUID.nullable().optional(),
  bankName: TEXT,
  bankIban: TEXT,
  bankAccount: TEXT,
  note: TEXT,
  noteAr: TEXT,
});

const updateEmployeeSchema = createEmployeeSchema.partial().omit({ code: true, hireDate: true });

const createStructureSchema = z.object({
  code: CODE,
  name: NAME,
  nameAr: TEXT,
  currency: z.string().length(3).optional(),
  note: TEXT,
  noteAr: TEXT,
});

const componentSchema = z.object({
  key: CODE,
  name: NAME,
  nameAr: TEXT,
  kind: KIND,
  calc: CALC,
  amount: MONEY.nullable().optional(),
  rate: RATE.nullable().optional(),
  glAccountId: UUID,
  isEosBase: z.boolean().optional(),
  seq: z.number().int().min(1).max(200).optional(),
});

const replaceComponentsSchema = z.object({
  components: z.array(componentSchema).max(100),
});

const createVersionSchema = z.object({
  code: CODE,
  name: NAME.nullable().optional(),
  components: z.array(componentSchema).max(100).optional(),
});

const createRunSchema = z.object({
  fiscalPeriodId: UUID,
  note: TEXT,
  noteAr: TEXT,
});

const calculateSchema = z.object({
  strictCap: z.boolean().optional(),
});

const payoutSchema = z.object({
  cashAccountId: UUID,
  amount: MONEY.optional(),
  entryDate: DATE.optional(),
});

const reverseSchema = z.object({
  reason: REASON,
  entryDate: DATE,
});

const createLoanSchema = z.object({
  code: CODE,
  employeeId: UUID,
  amount: MONEY,
  installmentsCount: z.number().int().min(1).max(120),
  startPeriodId: UUID,
  cashAccountId: UUID,
  valueDate: DATE.optional(),
  note: TEXT,
  noteAr: TEXT,
});

const waiveSchema = z.object({ reason: REASON });
const writeOffSchema = z.object({ reason: REASON });

const terminateSchema = z.object({
  terminationDate: DATE,
  reason: TEXT,
});

const eosSettleSchema = z.object({
  settledAmount: MONEY,
  cashAccountId: UUID,
  entryDate: DATE.optional(),
});

@Controller("api/v1/payroll")
export class PayrollController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly structures: StructureService,
    private readonly calculation: RunCalculationService,
    private readonly workflow: ApprovalWorkflow,
    private readonly posting: RunPostingService,
    private readonly payouts: PayoutService,
    private readonly loans: LoanService,
    private readonly eos: EosService,
  ) {}

  // -- employees (PII-restricted surface) --------------------------------------

  @Get("employees")
  @RequirePermissions("payroll.employees.view")
  async listEmployees(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("branchId") branchId?: string,
  ) {
    requireIdentity(request);
    const filter: { status?: "ACTIVE" | "SUSPENDED" | "TERMINATED"; branchId?: string } = {};
    if (status !== undefined && status !== "") filter.status = ENUM_STATUS.parse(status);
    if (branchId !== undefined && branchId !== "") filter.branchId = UUID.parse(branchId);
    // The register renders MASKED by construction (C-PII).
    const rows = await this.employees.list(filter);
    return envelope(rows.map(toEmployeeView));
  }

  @Post("employees")
  @RequirePermissions("payroll.employees.manage")
  async createEmployee(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createEmployeeSchema.parse(body);
    const created = await this.employees.create({ ...input, actorId: identity.userId });
    return envelope(toEmployeeView(created));
  }

  @Get("employees/:id")
  @RequirePermissions("payroll.employees.view")
  async getEmployee(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    const employee = await this.employees.get(UUID.parse(id), identity.userId);
    return envelope(toEmployeeView(employee));
  }

  @Put("employees/:id")
  @RequirePermissions("payroll.employees.manage")
  async updateEmployee(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateEmployeeSchema.parse(body);
    const updated = await this.employees.update(UUID.parse(id), input, identity.userId);
    return envelope(toEmployeeView(updated));
  }

  @Post("employees/:id/suspend")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.employees.manage")
  async suspendEmployee(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(toEmployeeView(await this.employees.suspend(UUID.parse(id), identity.userId)));
  }

  @Post("employees/:id/reactivate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.employees.manage")
  async reactivateEmployee(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      toEmployeeView(await this.employees.reactivate(UUID.parse(id), identity.userId)),
    );
  }

  @Post("employees/:id/terminate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.employees.manage")
  async terminateEmployee(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = terminateSchema.parse(body);
    return envelope(
      toEmployeeView(
        await this.employees.terminate(UUID.parse(id), { ...input, actorId: identity.userId }),
      ),
    );
  }

  // -- salary structures (the builder surface) ---------------------------------

  @Get("salary-structures")
  @RequirePermissions("payroll.employees.view")
  async listStructures(@Req() request: Request) {
    requireIdentity(request);
    return envelope(await this.structures.list());
  }

  @Post("salary-structures")
  @RequirePermissions("payroll.salary_structures.manage")
  async createStructure(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createStructureSchema.parse(body);
    return envelope(
      await this.structures.create({ ...input, actorId: identity.userId }),
    );
  }

  @Get("salary-structures/:id")
  @RequirePermissions("payroll.employees.view")
  async getStructure(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.structures.get(UUID.parse(id)));
  }

  @Put("salary-structures/:id/components")
  @RequirePermissions("payroll.salary_structures.manage")
  async replaceComponents(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = replaceComponentsSchema.parse(body);
    return envelope(
      await this.structures.replaceComponents(UUID.parse(id), input.components, identity.userId),
    );
  }

  @Post("salary-structures/:id/version")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.salary_structures.manage")
  async createVersion(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createVersionSchema.parse(body);
    return envelope(
      await this.structures.createVersion(UUID.parse(id), { ...input, actorId: identity.userId }),
    );
  }

  // -- runs (the G-29 workspace surface) ----------------------------------------

  @Get("runs")
  @RequirePermissions("payroll.runs.view")
  async listRuns(
    @Req() request: Request,
    @Query("fiscalYearId") fiscalYearId?: string,
    @Query("status") status?: string,
  ) {
    requireIdentity(request);
    const filter: { fiscalYearId?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "POSTED" } = {};
    if (fiscalYearId !== undefined && fiscalYearId !== "") {
      filter.fiscalYearId = UUID.parse(fiscalYearId);
    }
    if (status !== undefined && status !== "") {
      filter.status = z.enum(["DRAFT", "PENDING_APPROVAL", "POSTED"]).parse(status);
    }
    return envelope(await this.calculation.listRuns(filter));
  }

  @Post("runs")
  @RequirePermissions("payroll.runs.create")
  async createRun(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRunSchema.parse(body);
    return envelope(
      await this.calculation.createRun({ ...input, actorId: identity.userId }),
    );
  }

  @Get("runs/:id")
  @RequirePermissions("payroll.runs.view")
  async getRun(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.calculation.getRun(UUID.parse(id)));
  }

  @Post("runs/:id/calculate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.create")
  async calculateRun(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = calculateSchema.parse(body === undefined || body === null ? {} : body);
    const result = await this.calculation.calculate(UUID.parse(id), {
      actorId: identity.userId,
      strictCap: input.strictCap,
    });
    return envelope({
      run: result.run,
      lineCount: result.lines.length,
      warnings: result.warnings,
    });
  }

  @Post("runs/:id/submit")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.create")
  async submitRun(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.workflow.submit(UUID.parse(id), identity.userId));
  }

  @Post("runs/:id/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.approve")
  async approveRun(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.workflow.approve(UUID.parse(id), identity.userId));
  }

  @Post("runs/:id/post")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.post")
  async postRun(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.posting.post(UUID.parse(id), identity.userId));
  }

  @Post("runs/:id/reverse")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.post")
  async reverseRun(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reverseSchema.parse(body);
    return envelope(
      await this.posting.reverse(UUID.parse(id), { ...input, actorId: identity.userId }),
    );
  }

  @Post("runs/:id/payout")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.post")
  async payoutRun(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = payoutSchema.parse(body);
    return envelope(
      await this.payouts.payout(UUID.parse(id), { ...input, actorId: identity.userId }),
    );
  }

  @Get("runs/:id/payslips")
  @RequirePermissions("payroll.employees.view")
  async payslips(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("locale") locale?: string,
  ) {
    requireIdentity(request);
    const resolved = LOCALE.parse(locale === undefined || locale === "" ? "ar" : locale);
    return envelope(await this.payouts.payslips(UUID.parse(id), resolved));
  }

  // -- loans ---------------------------------------------------------------------

  @Get("loans")
  @RequirePermissions("payroll.employees.view")
  async listLoans(
    @Req() request: Request,
    @Query("employeeId") employeeId?: string,
    @Query("status") status?: string,
  ) {
    requireIdentity(request);
    const filter: { employeeId?: string; status?: "ACTIVE" | "CLOSED" | "WRITE_OFF" } = {};
    if (employeeId !== undefined && employeeId !== "") filter.employeeId = UUID.parse(employeeId);
    if (status !== undefined && status !== "") {
      filter.status = z.enum(["ACTIVE", "CLOSED", "WRITE_OFF"]).parse(status);
    }
    return envelope(await this.loans.list(filter));
  }

  @Post("loans")
  @RequirePermissions("payroll.loans.manage")
  async createLoan(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createLoanSchema.parse(body);
    return envelope(await this.loans.create({ ...input, actorId: identity.userId }));
  }

  @Get("loans/:id")
  @RequirePermissions("payroll.employees.view")
  async getLoan(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.loans.get(UUID.parse(id)));
  }

  @Post("loans/lines/:lineId/waive")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.loans.manage")
  async waiveLoanLine(
    @Req() request: Request,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = waiveSchema.parse(body);
    return envelope(
      await this.loans.waiveLine(UUID.parse(lineId), { ...input, actorId: identity.userId }),
    );
  }

  @Post("loans/:id/write-off")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.loans.manage")
  async writeOffLoan(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = writeOffSchema.parse(body);
    return envelope(
      await this.loans.writeOff(UUID.parse(id), { ...input, actorId: identity.userId }),
    );
  }

  // -- EOS -----------------------------------------------------------------------

  @Get("eos/employees/:id/balance")
  @RequirePermissions("payroll.employees.view")
  async eosBalance(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.eos.balanceFor(UUID.parse(id)));
  }

  @Get("eos/policy")
  @RequirePermissions("payroll.employees.view")
  async eosPolicy(@Req() request: Request) {
    requireIdentity(request);
    return envelope(await this.eos.policy());
  }

  @Post("eos/employees/:id/settle")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.loans.manage")
  async eosSettle(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = eosSettleSchema.parse(body);
    return envelope(
      await this.eos.settle(UUID.parse(id), { ...input, actorId: identity.userId }),
    );
  }
}
