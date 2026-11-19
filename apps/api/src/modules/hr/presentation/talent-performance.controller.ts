import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { BridgeService } from "../application/bridge-service";
import { TalentPerformanceService } from "../application/talent-performance-service";
import { SelfNotLinkedError } from "../domain/self-service-errors";

/**
 * PHASE-047 (W-2 — T-05) — the performance routes: the cycle lifecycle
 * (the one-way CAS ladder), the review submission (the reviewer is
 * ALWAYS the acting user's linked employee — the own-rows law, the
 * self-service precedent; a client-supplied reviewer id would be
 * someone else's evidence), the BR-090 aggregate read, the calibration
 * act, and the competency framework (the performance cluster's master
 * data). Keys per matrix §3.25: manage = hr.performance.manage ·
 * review = hr.performance.review (the own rows) · view =
 * hr.performance.view (the reads + the scorecard's framework data) ·
 * the competency writes = hr.competency.manage.
 *
 * The envelope law (the T-14 repair): every site awaits its service
 * call INSIDE envelope(...).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
/** The 2-dp decimal-string law (exact, never float — ADR-0009's
 * discipline extended to the percent fields). */
const PCT = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'a decimal string like "87.50"');
const TEXT = z.string().min(1).max(2_000).nullable().optional();
const CODE = z.string().regex(/^[\w\-. ]{1,64}$/, "1–64 chars (letters, digits, dash, dot, space)");

const cycleBody = z.object({
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  periodStart: DATE,
  periodEnd: DATE,
  reviewDueDate: DATE.nullable(),
  scopeOrgUnitIds: z.array(UUID).max(50),
});

const reviewBody = z.object({
  cycleId: UUID,
  revieweeEmployeeId: UUID,
  kind: z.enum(["MANAGER", "SELF", "PEER", "SUBORDINATE"]),
  overallScore: PCT.nullable(),
  competencyScores: z.record(z.string().uuid(), z.number().int().min(1).max(5)),
  comments: TEXT,
});

const calibrateBody = z.object({
  cycleId: UUID,
  revieweeEmployeeId: UUID,
  overallScore: PCT.nullable(),
  comments: TEXT,
});

const competencyBody = z.object({
  code: CODE,
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  category: TEXT,
});

const competencyPatch = z.object({
  name: z.string().min(1).max(120).optional(),
  nameAr: TEXT,
  category: TEXT,
});

const levelPatch = z.object({
  name: z.string().min(1).max(64).optional(),
  nameAr: z.string().min(1).max(64).optional(),
  descriptor: z.string().min(1).max(500).optional(),
  descriptorAr: z.string().min(1).max(500).optional(),
});

@Controller("api/v1/hr")
export class TalentPerformanceController {
  constructor(
    @Inject(TalentPerformanceService) private readonly performance: TalentPerformanceService,
    @Inject(BridgeService) private readonly bridge: BridgeService,
  ) {}

  /** The own-employee resolver (the own-rows law's service-boundary
   * half: the reviewer/owner identity comes from the identity bridge,
   * never from the body). */
  private async requireOwnEmployeeId(userId: string): Promise<string> {
    const linked = await this.bridge.resolveByUser(userId);
    if (linked === undefined) throw new SelfNotLinkedError();
    return linked.id;
  }

  // -- the cycle lifecycle ------------------------------------------------------------

  @Post("performance/cycles")
  @RequirePermissions("hr.performance.manage")
  async createCycle(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cycleBody.parse(body);
    return envelope(
      await this.performance.createCycle({
        name: input.name,
        nameAr: input.nameAr ?? null,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        reviewDueDate: input.reviewDueDate ?? null,
        scopeOrgUnitIds: input.scopeOrgUnitIds,
        actorId: identity.userId,
      }),
    );
  }

  @Get("performance/cycles")
  @RequirePermissions("hr.performance.view")
  async listCycles(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      await this.performance.listCycles({
        ...(status === undefined || status === "" ? {} : { status }),
        ...(limit === undefined || limit === "" ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Get("performance/cycles/:id")
  @RequirePermissions("hr.performance.view")
  async getCycle(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.performance.getCycle(id));
  }

  @Post("performance/cycles/:id/activate")
  @RequirePermissions("hr.performance.manage")
  async activate(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.performance.transitionCycle(id, "activate", identity.userId));
  }

  @Post("performance/cycles/:id/calibrate")
  @RequirePermissions("hr.performance.manage")
  async openCalibration(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.performance.transitionCycle(id, "calibrate", identity.userId));
  }

  @Post("performance/cycles/:id/close")
  @RequirePermissions("hr.performance.manage")
  async close(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.performance.transitionCycle(id, "close", identity.userId));
  }

  // -- the reviews (the own-rows submission plane) ------------------------------------

  @Post("performance/reviews/draft")
  @RequirePermissions("hr.performance.review")
  async saveDraft(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reviewBody.parse(body);
    const reviewerEmployeeId = await this.requireOwnEmployeeId(identity.userId);
    return envelope(
      await this.performance.saveReviewDraft({
        reviewerEmployeeId,
        cycleId: input.cycleId,
        revieweeEmployeeId: input.revieweeEmployeeId,
        kind: input.kind,
        overallScore: input.overallScore ?? null,
        competencyScores: input.competencyScores,
        comments: input.comments ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("performance/reviews/submit")
  @RequirePermissions("hr.performance.review")
  async submit(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reviewBody.parse(body);
    const reviewerEmployeeId = await this.requireOwnEmployeeId(identity.userId);
    return envelope(
      await this.performance.submitReview({
        reviewerEmployeeId,
        cycleId: input.cycleId,
        revieweeEmployeeId: input.revieweeEmployeeId,
        kind: input.kind,
        overallScore: input.overallScore ?? null,
        competencyScores: input.competencyScores,
        comments: input.comments ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("performance/reviews/own")
  @RequirePermissions("hr.performance.review")
  async ownReviews(@Req() request: Request, @Query("cycleId") cycleId?: string) {
    const identity = requireIdentity(request);
    const reviewerEmployeeId = await this.requireOwnEmployeeId(identity.userId);
    return envelope(
      await this.performance.listOwnReviews(
        reviewerEmployeeId,
        cycleId === undefined || cycleId === "" ? undefined : cycleId,
      ),
    );
  }

  /** The manage-side read: a cycle's whole review set (the calibration
   * view's data). */
  @Get("performance/cycles/:id/reviews")
  @RequirePermissions("hr.performance.view")
  async cycleReviews(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.performance.listCycleReviews(id));
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's trend read): the
   * employee's MANAGER reviews across cycles with the cycle metadata.
   * BR-090 by construction — the 360 input rows never ride this
   * surface (the aggregate-360 read is their only plane).
   */
  @Get("performance/reviews/for-employee/:employeeId")
  @RequirePermissions("hr.performance.view")
  async reviewsForEmployee(@Req() request: Request, @Param("employeeId") employeeId: string) {
    requireIdentity(request);
    return envelope(await this.performance.listReviewsForEmployee(employeeId));
  }

  /**
   * THE 360 AGGREGATE READ (BR-090): the per-relationship aggregates —
   * only the ≥ 3 relationships, count + stats, never an attributed
   * source. The optional `kind` query is the EXPLICIT request whose
   * below-threshold answer is the typed 422 refusal.
   */
  @Get("performance/cycles/:id/reviews/:revieweeId/aggregate-360")
  @RequirePermissions("hr.performance.view")
  async aggregate360(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("revieweeId") revieweeId: string,
    @Query("kind") kind?: string,
  ) {
    requireIdentity(request);
    const requestKind =
      kind === undefined || kind === ""
        ? undefined
        : z.enum(["SELF", "PEER", "SUBORDINATE"]).parse(kind);
    return envelope(
      await this.performance.getAggregate360(id, revieweeId, requestKind),
    );
  }

  // -- the calibration act ------------------------------------------------------------

  @Post("performance/reviews/calibrate")
  @RequirePermissions("hr.performance.manage")
  async calibrate(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = calibrateBody.parse(body);
    return envelope(
      await this.performance.calibrateReview({
        cycleId: input.cycleId,
        revieweeEmployeeId: input.revieweeEmployeeId,
        overallScore: input.overallScore ?? null,
        comments: input.comments ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- the competency framework -------------------------------------------------------

  @Post("competencies")
  @RequirePermissions("hr.competency.manage")
  async createCompetency(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = competencyBody.parse(body);
    return envelope(
      await this.performance.createCompetency({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        category: input.category ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("competencies")
  @RequirePermissions("hr.performance.view")
  async listCompetencies(
    @Req() request: Request,
    @Query("active") active?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      await this.performance.listCompetencies({
        ...(active === undefined || active === "" ? {} : { active: active === "true" }),
        ...(limit === undefined || limit === "" ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Put("competencies/:id")
  @RequirePermissions("hr.competency.manage")
  async updateCompetency(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = competencyPatch.parse(body);
    return envelope(
      await this.performance.updateCompetency({
        id,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
        ...(input.category === undefined ? {} : { category: input.category }),
        actorId: identity.userId,
      }),
    );
  }

  @Post("competencies/:id/activate")
  @RequirePermissions("hr.competency.manage")
  async activateCompetency(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.performance.setCompetencyActive(id, true, identity.userId));
  }

  @Post("competencies/:id/deactivate")
  @RequirePermissions("hr.competency.manage")
  async deactivateCompetency(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.performance.setCompetencyActive(id, false, identity.userId));
  }

  @Get("competencies/levels")
  @RequirePermissions("hr.performance.view")
  async listLevels(@Req() request: Request) {
    requireIdentity(request);
    return envelope(await this.performance.listCompetencyLevels());
  }

  /** The scale is tenant DATA (BR-055): the descriptors are the
   * tenant's own calibration; the 1–5 band is the floor. */
  @Put("competencies/levels/:level")
  @RequirePermissions("hr.competency.manage")
  async updateLevel(
    @Req() request: Request,
    @Param("level") level: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = levelPatch.parse(body);
    const parsed = Number.parseInt(level, 10);
    return envelope(
      await this.performance.updateCompetencyLevel({
        level: parsed,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
        ...(input.descriptor === undefined ? {} : { descriptor: input.descriptor }),
        ...(input.descriptorAr === undefined ? {} : { descriptorAr: input.descriptorAr }),
        actorId: identity.userId,
      }),
    );
  }
}
