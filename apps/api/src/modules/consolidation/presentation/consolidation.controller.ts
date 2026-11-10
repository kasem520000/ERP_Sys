import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { GroupService } from "../application/group-service";
import { EliminationService } from "../application/elimination-service";
import { RunService } from "../application/run-service";
import { ConsolidationReaderService } from "../application/reader-service";
import { enqueueRunExecution } from "../infrastructure/consolidation-run.job";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { EliminationLine } from "../application/elimination-lines";

/**
 * Consolidation routes (PHASE-034 §4; matrix §3.15): every route
 * permission-guarded with the exact seeded keys, Idempotency-Key-guarded
 * by the global POST guard (IDEMPOTENCY §1.1), success envelope
 * throughout. Foreign/unknown ids are 404-shaped (A7 — the owner-scoped
 * store makes them indistinguishable). Tenant-plane scoping only — never
 * branch-scoped (matrix §5 row).
 *
 * Permission mapping (the §3.15 set, 5 keys):
 *   - groups + members     → consolidation.groups.manage (audited);
 *   - eliminations create  → consolidation.eliminations.create;
 *   - approve/post/reverse → consolidation.eliminations.post (the §4
 *                            approval-gated risky row; SoD creator ≠
 *                            approver is service-enforced + audited);
 *   - runs execute         → consolidation.runs.execute (audited);
 *   - reads (groups list, eliminations list, runs list, suggestions,
 *     snapshots)           → the surface's own read shape rides the
 *                            manage/execute keys; consolidated STATEMENTS
 *                            render through the PHASE-013 report viewer
 *                            under consolidation.reports.view (the four
 *                            contracts — NOT bespoke routes here).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const CURRENCY = z.string().regex(/^[A-Z]{3}$/, "ISO currency");
const PERCENT = z.string().regex(/^\d+(\.\d{1,4})?$/, "decimal percent (≤ 4dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const FX_METHOD = z.enum(["CLOSING_RATE", "TEMPORARY"]);
const ELIMINATION_KIND = z.enum(["INTERCOMPANY", "INVESTMENT_EQUITY"]);
const DIRECTION = z.enum(["DEBIT", "CREDIT"]);

const createGroupSchema = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  baseCurrency: CURRENCY,
  fxTranslationMethod: FX_METHOD.optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).optional(),
  fxTranslationMethod: FX_METHOD.optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const addMemberSchema = z.object({
  memberTenantId: UUID,
  ownershipPercent: PERCENT,
  includeFrom: DATE.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const updateMemberSchema = z.object({
  ownershipPercent: PERCENT.optional(),
  includeFrom: DATE.nullable().optional(),
  status: z.enum(["ACTIVE", "REMOVED"]).optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const eliminationLineSchema = z.object({
  purposeKey: z.string().min(1).max(60),
  direction: DIRECTION,
  amount: MONEY,
  memberTenantId: UUID.nullable().optional(),
  memoEn: z.string().max(300).optional(),
  memoAr: z.string().max(300).optional(),
});

const createEliminationSchema = z.object({
  groupId: UUID,
  fiscalPeriodId: UUID,
  kind: ELIMINATION_KIND,
  description: z.string().min(1).max(500),
  memberATenantId: UUID.nullable().optional(),
  memberBTenantId: UUID.nullable().optional(),
  lines: z.array(eliminationLineSchema).min(1).max(50),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const updateEliminationSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  lines: z.array(eliminationLineSchema).min(1).max(50).optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const createRunSchema = z.object({
  groupId: UUID,
  fiscalPeriodId: UUID,
});

@Controller("api/v1/consolidation")
export class ConsolidationController {
  constructor(
    private readonly groups: GroupService,
    private readonly eliminations: EliminationService,
    private readonly runs: RunService,
    private readonly reader: ConsolidationReaderService,
  ) {}

  // -- groups & membership (Settings §8; consolidation.groups.manage) ------

  @Post("groups")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("consolidation.groups.manage")
  async createGroup(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createGroupSchema.parse(body);
    const group = await this.groups.createGroup({
      ...input,
      actorId: identity.userId,
    });
    return envelope(group);
  }

  @Get("groups")
  @RequirePermissions("consolidation.groups.manage")
  async listGroups() {
    return envelope(await this.groups.listGroups());
  }

  @Get("groups/:id")
  @RequirePermissions("consolidation.groups.manage")
  async getGroup(@Param("id") id: string) {
    return envelope(await this.groups.getGroup(UUID.parse(id)));
  }

  @Put("groups/:id")
  @RequirePermissions("consolidation.groups.manage")
  async updateGroup(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateGroupSchema.parse(body);
    return envelope(await this.groups.updateGroup(UUID.parse(id), input, identity.userId));
  }

  @Get("groups/:id/members")
  @RequirePermissions("consolidation.groups.manage")
  async listMembers(@Param("id") id: string) {
    return envelope(await this.groups.listMembers(UUID.parse(id)));
  }

  @Post("groups/:id/members")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("consolidation.groups.manage")
  async addMember(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = addMemberSchema.parse(body);
    const member = await this.groups.addMember({
      groupId: UUID.parse(id),
      ...input,
      actorId: identity.userId,
    });
    return envelope(member);
  }

  @Put("groups/:id/members/:memberTenantId")
  @RequirePermissions("consolidation.groups.manage")
  async updateMember(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("memberTenantId") memberTenantId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = updateMemberSchema.parse(body);
    return envelope(
      await this.groups.updateMember(UUID.parse(id), UUID.parse(memberTenantId), input, identity.userId),
    );
  }

  // -- eliminations (Transaction Entry §4; create ≠ post, SoD) -------------

  @Post("eliminations")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("consolidation.eliminations.create")
  async createElimination(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createEliminationSchema.parse(body);
    const row = await this.eliminations.createDraft({
      ...input,
      lines: input.lines as EliminationLine[],
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Get("eliminations")
  @RequirePermissions("consolidation.eliminations.create")
  async listEliminations(
    @Query("groupId") groupId?: string,
    @Query("fiscalPeriodId") fiscalPeriodId?: string,
    @Query("status") status?: string,
  ) {
    return envelope(
      await this.eliminations.list({
        groupId: groupId === undefined || groupId === "" ? undefined : UUID.parse(groupId),
        fiscalPeriodId:
          fiscalPeriodId === undefined || fiscalPeriodId === "" ? undefined : UUID.parse(fiscalPeriodId),
        status,
      }),
    );
  }

  @Get("eliminations/:id")
  @RequirePermissions("consolidation.eliminations.create")
  async getElimination(@Param("id") id: string) {
    return envelope(await this.eliminations.find(UUID.parse(id)));
  }

  @Put("eliminations/:id")
  @RequirePermissions("consolidation.eliminations.create")
  async updateElimination(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateEliminationSchema.parse(body);
    return envelope(
      await this.eliminations.updateDraft(
        UUID.parse(id),
        input.lines === undefined
          ? { description: input.description, note: input.note, noteAr: input.noteAr }
          : {
              description: input.description,
              lines: input.lines as EliminationLine[],
              note: input.note,
              noteAr: input.noteAr,
            },
        identity.userId,
      ),
    );
  }

  @Post("eliminations/:id/approve")
  @RequirePermissions("consolidation.eliminations.post")
  async approveElimination(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.eliminations.approve(UUID.parse(id), identity.userId));
  }

  @Post("eliminations/:id/post")
  @RequirePermissions("consolidation.eliminations.post")
  async postElimination(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.eliminations.post(UUID.parse(id), identity.userId));
  }

  @Post("eliminations/:id/reverse")
  @RequirePermissions("consolidation.eliminations.post")
  async reverseElimination(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({ note: z.string().max(2000).nullable().optional(), noteAr: z.string().max(2000).nullable().optional() })
      .parse(body ?? {});
    return envelope(
      await this.eliminations.reverse({
        eliminationId: UUID.parse(id),
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  /** The authoring workspace's pairing SUGGESTIONS (human-confirmed; the
   * automatic matcher is out of scope). Audited per read. */
  @Get("groups/:id/intercompany-suggestions")
  @RequirePermissions("consolidation.eliminations.create")
  async suggestIntercompanyPairs(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("memberTenantId") memberTenantId: string,
    @Query("asOf") asOf: string,
  ) {
    const identity = requireIdentity(request);
    return envelope(
      await this.eliminations.suggestIntercompanyPairs({
        groupId: UUID.parse(id),
        memberTenantId: UUID.parse(memberTenantId),
        asOf: DATE.parse(asOf),
        actorId: identity.userId,
      }),
    );
  }

  // -- runs (Report Page §7; consolidation.runs.execute — audited) ---------

  @Post("runs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("consolidation.runs.execute")
  async createRun(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRunSchema.parse(body);
    const run = await this.runs.createRun({
      ...input,
      actorId: identity.userId,
    });
    // Enqueue the bounded execution job (ADR-0008). The job id rides the
    // response; a worker-less dev shape falls back to the synchronous
    // execute endpoint below.
    void enqueueRunExecution(requireTenantContext().tenantId, run.id, identity.userId).catch(
      () => undefined,
    );
    return envelope(run);
  }

  @Get("runs")
  @RequirePermissions("consolidation.runs.execute")
  async listRuns(@Query("groupId") groupId?: string, @Query("status") status?: string) {
    return envelope(
      await this.runs.list({
        groupId: groupId === undefined || groupId === "" ? undefined : UUID.parse(groupId),
        status,
      }),
    );
  }

  @Get("runs/:id")
  @RequirePermissions("consolidation.runs.execute")
  async getRun(@Param("id") id: string) {
    return envelope(await this.runs.find(UUID.parse(id)));
  }

  @Post("runs/:id/execute")
  @RequirePermissions("consolidation.runs.execute")
  async executeRun(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.runs.executeRun({ runId: UUID.parse(id), actorId: identity.userId }));
  }

  /** The statement substrate: the LATEST COMPLETED snapshot for a (group,
   * period) — the report contracts consume the same lookup. */
  @Get("runs/:id/snapshots")
  @RequirePermissions("consolidation.runs.execute")
  async getRunSnapshot(@Param("id") id: string) {
    const run = await this.runs.find(UUID.parse(id));
    return envelope({ runId: run.id, status: run.status, snapshot: run.snapshot });
  }

  @Get("runs/:id/statements")
  @RequirePermissions("consolidation.runs.execute")
  async getRunStatements(@Param("id") id: string) {
    const run = await this.runs.find(UUID.parse(id));
    return envelope({
      runId: run.id,
      status: run.status,
      statementsAvailable: run.status === "COMPLETED" && run.snapshot !== null,
      // The full statement renders flow through the PHASE-013 report
      // viewer (the four contracts under consolidation.reports.view).
    });
  }

  // -- the reader's health surface (isolation-suite probe; read-only) ------

  @Get("reader/status")
  @RequirePermissions("consolidation.runs.execute")
  async readerStatus() {
    return envelope({
      plane: "platform",
      grant: "SELECT-only (erp_consolidation_reader — NOLOGIN, BYPASSRLS)",
      functions: [
        "erp.consolidation_read_member_gl",
        "erp.consolidation_member_periods",
        "erp.consolidation_read_member_ar_ap",
      ],
      crossTenantWrites: "none (INV-026 — grant level + audit level)",
    });
  }
}
