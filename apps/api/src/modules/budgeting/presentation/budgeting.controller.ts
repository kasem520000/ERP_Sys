import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ApprovalWorkflow } from "../application/approval-workflow";
import { BudgetGridService } from "../application/budget-grid-service";
import { BudgetVersionService } from "../application/budget-version-service";
import { ControlGuard } from "../application/control-guard";
import { ImportService } from "../application/import-service";
import { BUDGET_SCOPES, type BudgetScope, type BudgetStatus } from "../application/budgeting-types";

/**
 * Budgeting routes (PHASE-028 §4; matrix §3.13): every route
 * permission-guarded with the exact seeded keys, Idempotency-Key-guarded
 * by the global POST guard (IDEMPOTENCY §1.1), success envelope
 * throughout. Foreign/unknown ids are 404-shaped (A7 — RLS makes them
 * indistinguishable). Budgets post NOTHING — these routes never touch the
 * journal (DR-004).
 *
 * Permission mapping notes (the §3.13 set): view keys guard the reads;
 * `budgeting.budgets.create` is the doc-surface owner for create + grid
 * edits + submit/supersede (draft-state moves); `budgeting.budgets.approve`
 * is the SoD approval key; `budgeting.budgets.activate` guards activation
 * + close (the audited owner actions).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const SCOPE = z.enum(["ACCOUNTS", "COST_CENTERS", "PROJECTS", "BRANCHES"]);
const STATUS = z.enum(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "REVISED", "CLOSED"]);
const LOCALE = z.enum(["ar", "en"]).default("ar");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const NAME = z.string().min(1).max(200);
const TEXT = z.string().min(1).max(2000).nullable().optional();
const BASE64 = z.string().min(1).max(20_000_000); // ~15MB file ceiling

const createBudgetSchema = z.object({
  fiscalYearId: UUID,
  scope: SCOPE,
  name: NAME,
  nameAr: TEXT,
  note: TEXT,
  noteAr: TEXT,
});

const lineSchema = z.object({
  fiscalPeriodId: UUID,
  accountId: UUID,
  costCenterId: UUID.nullable().optional(),
  projectId: UUID.nullable().optional(),
  branchId: UUID.nullable().optional(),
  amount: MONEY,
});

const replaceGridSchema = z.object({
  lines: z.array(lineSchema).max(20_000),
});

const importSchema = z.object({
  fileBase64: BASE64,
});

const controlEvaluateSchema = z.object({
  documentRef: z.object({
    type: z.string().min(1).max(60),
    id: UUID,
    label: z.string().min(1).max(200),
  }),
  fiscalPeriodId: UUID,
  lines: z
    .array(
      z.object({
        accountId: UUID,
        costCenterId: UUID.nullable().optional(),
        projectId: UUID.nullable().optional(),
        branchId: UUID.nullable().optional(),
        projectedAmount: MONEY,
      }),
    )
    .max(200),
});

@Controller("api/v1/budgeting")
export class BudgetingController {
  constructor(
    private readonly versions: BudgetVersionService,
    private readonly grid: BudgetGridService,
    private readonly workflow: ApprovalWorkflow,
    private readonly guard: ControlGuard,
    private readonly imports: ImportService,
  ) {}

  @Get("budgets")
  @RequirePermissions("budgeting.budgets.view")
  async list(
    @Req() request: Request,
    @Query("fiscalYearId") fiscalYearId?: string,
    @Query("scope") scope?: string,
    @Query("status") status?: string,
  ) {
    requireIdentity(request);
    const filter: {
      fiscalYearId?: string;
      scope?: BudgetScope;
      status?: BudgetStatus;
    } = {};
    if (fiscalYearId !== undefined && fiscalYearId !== "") {
      filter.fiscalYearId = UUID.parse(fiscalYearId);
    }
    if (scope !== undefined && scope !== "") {
      filter.scope = SCOPE.parse(scope);
    }
    if (status !== undefined && status !== "") {
      filter.status = STATUS.parse(status);
    }
    return envelope(await this.versions.list(filter));
  }

  @Post("budgets")
  @RequirePermissions("budgeting.budgets.create")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createBudgetSchema.parse(body);
    return envelope(
      await this.versions.create(input, identity.userId),
    );
  }

  @Get("budgets/:id")
  @RequirePermissions("budgeting.budgets.view")
  async get(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.versions.get(UUID.parse(id)));
  }

  @Get("budgets/:id/grid")
  @RequirePermissions("budgeting.budgets.view")
  async gridOf(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.grid.getGrid(UUID.parse(id)));
  }

  @Put("budgets/:id/grid")
  @RequirePermissions("budgeting.budgets.create")
  async replaceGrid(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = replaceGridSchema.parse(body);
    return envelope(await this.grid.replaceGrid(UUID.parse(id), input.lines, identity.userId));
  }

  @Get("budgets/:id/consumption")
  @RequirePermissions("budgeting.budgets.view")
  async consumption(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.grid.consumption(UUID.parse(id)));
  }

  @Get("budgets/:id/export")
  @RequirePermissions("budgeting.budgets.view")
  async exportGrid(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("locale") locale?: string,
  ) {
    requireIdentity(request);
    const resolved = LOCALE.parse(locale === undefined || locale === "" ? "ar" : locale);
    const { buffer, filename } = await this.grid.exportGrid(UUID.parse(id), resolved);
    return envelope({
      filename,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileBase64: buffer.toString("base64"),
      bytes: buffer.byteLength,
    });
  }

  @Post("budgets/:id/submit")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.create")
  async submit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.workflow.submit(UUID.parse(id), identity.userId));
  }

  @Post("budgets/:id/approve")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.approve")
  async approve(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.workflow.approve(UUID.parse(id), identity.userId));
  }

  @Post("budgets/:id/activate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.activate")
  async activate(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.workflow.activate(UUID.parse(id), identity.userId));
  }

  @Post("budgets/:id/supersede")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.create")
  async supersede(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.workflow.supersede(UUID.parse(id), identity.userId));
  }

  @Post("budgets/:id/close")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.activate")
  async close(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.versions.close(UUID.parse(id), identity.userId));
  }

  @Post("budgets/:id/import/dry-run")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.create")
  async importDryRun(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    requireIdentity(request);
    const input = importSchema.parse(body);
    return envelope(await this.imports.dryRun(UUID.parse(id), input.fileBase64));
  }

  @Post("budgets/:id/import/commit")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.create")
  async importCommit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = importSchema.parse(body);
    return envelope(await this.imports.commit(UUID.parse(id), input.fileBase64, identity.userId));
  }

  /**
   * The declared-edge guard API (DEPENDENCY_RULES §2 — trade-document
   * DRAFT-save flows may call this surface when budgeting.controls is
   * entitled). ADVISORY by default: warnings return, the save proceeds;
   * ENFORCE_DRAFT: the typed BUDGET_EXCEEDED rejection (BR-051).
   */
  @Post("control/evaluate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("budgeting.budgets.create")
  async controlEvaluate(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = controlEvaluateSchema.parse(body);
    return envelope(
      await this.guard.evaluateDraftSave({
        actorId: identity.userId,
        documentRef: input.documentRef,
        fiscalPeriodId: input.fiscalPeriodId,
        lines: input.lines,
      }),
    );
  }
}

export { BUDGET_SCOPES };
