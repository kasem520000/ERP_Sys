import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { BridgeService } from "../application/bridge-service";
import { TalentRecruitmentService } from "../application/talent-recruitment-service";
import { SelfNotLinkedError } from "../domain/self-service-errors";

/**
 * PHASE-047 (W-3 — T-07) — the recruitment routes: the vacancy
 * lifecycle (the typed CAS transitions), the applicant pipeline
 * (BR-088's monotonic stages + the ONE recorded reopen + the hire act
 * with its written-once employee link), and the interview scorecards
 * (one row per panelist per round — the scorecard write resolves the
 * acting user's OWN linked employee through the identity bridge,
 * never a client-supplied panelist id). Keys per matrix §3.25: the
 * reads = hr.recruitment.view · the writes (vacancies, applicants,
 * the stage/reopen/hire acts, interview scheduling) =
 * hr.recruitment.manage · the panelist's own scorecard =
 * hr.recruitment.interview.
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
const TEXT = z.string().max(4_000).nullable();
const CODE = z.string().min(1).max(64);
const STAGE = z.enum(["NEW", "SCREEN", "INTERVIEW", "OFFER", "HIRED", "REJECTED"]);
const MODE = z.enum(["ONSITE", "VIDEO", "PHONE"]);
const TIMESTAMP = z.string().min(10).max(40);

const vacancyBody = z.object({
  code: CODE,
  positionId: UUID.nullable().optional(),
  title: z.string().min(1).max(160),
  titleAr: z.string().max(160).nullable().optional(),
  headcount: z.number().int().min(1),
  notes: TEXT.optional(),
});

const vacancyTransitionBody = z.object({
  action: z.enum(["hold", "resume", "fill", "cancel"]),
});

const applicantBody = z.object({
  vacancyId: UUID,
  fullName: z.string().min(1).max(160),
  fullNameAr: z.string().max(160).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  notes: TEXT.optional(),
});

const stageBody = z.object({ to: STAGE });

const hireBody = z.object({ employeeId: UUID });

const interviewBody = z.object({
  applicantId: UUID,
  round: z.number().int().min(1),
  panelistEmployeeId: UUID,
  scheduledStart: TIMESTAMP,
  scheduledEnd: TIMESTAMP,
  mode: MODE,
});

const scorecardBody = z.object({
  scorecard: z.record(z.string(), z.unknown()),
  verdict: z.enum(["STRONG_HIRE", "HIRE", "NO_HIRE", "STRONG_NO_HIRE"]).nullable(),
  comments: TEXT.optional(),
});

@Controller("api/v1/hr")
export class TalentRecruitmentController {
  constructor(
    @Inject(TalentRecruitmentService) private readonly recruitment: TalentRecruitmentService,
    @Inject(BridgeService) private readonly bridge: BridgeService,
  ) {}

  private async requireOwnEmployeeId(userId: string): Promise<string> {
    const linked = await this.bridge.resolveByUser(userId);
    if (linked === undefined) throw new SelfNotLinkedError();
    return linked.id;
  }

  // ── vacancies ────────────────────────────────────────────────────────────

  @Post("recruitment/vacancies")
  @RequirePermissions("hr.recruitment.manage")
  async createVacancy(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = vacancyBody.parse(body);
    return envelope(
      await this.recruitment.createVacancy({
        code: input.code,
        positionId: input.positionId ?? null,
        title: input.title,
        titleAr: input.titleAr ?? null,
        headcount: input.headcount,
        notes: input.notes ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("recruitment/vacancies")
  @RequirePermissions("hr.recruitment.view")
  async listVacancies(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.recruitment.listVacancies({
        ...(status === undefined ? {} : { status }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Get("recruitment/vacancies/:id")
  @RequirePermissions("hr.recruitment.view")
  async getVacancy(@Param("id") id: string) {
    return envelope(await this.recruitment.getVacancy(id));
  }

  @Post("recruitment/vacancies/:id/transition")
  @RequirePermissions("hr.recruitment.manage")
  async transitionVacancy(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = vacancyTransitionBody.parse(body);
    return envelope(await this.recruitment.transitionVacancy(id, input.action, identity.userId));
  }

  // ── applicants (BR-088's pipeline) ───────────────────────────────────────

  @Post("recruitment/applicants")
  @RequirePermissions("hr.recruitment.manage")
  async createApplicant(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = applicantBody.parse(body);
    return envelope(
      await this.recruitment.createApplicant({
        vacancyId: input.vacancyId,
        fullName: input.fullName,
        fullNameAr: input.fullNameAr ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        source: input.source ?? null,
        notes: input.notes ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("recruitment/applicants")
  @RequirePermissions("hr.recruitment.view")
  async listApplicants(
    @Query("vacancyId") vacancyId?: string,
    @Query("stage") stage?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.recruitment.listApplicants({
        ...(vacancyId === undefined ? {} : { vacancyId }),
        ...(stage === undefined ? {} : { stage }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's source record): the
   * hire link's applicant row for THIS employee, or null (the honest
   * common case — most employees were never applicants; A7's
   * indistinguishability rides null, never a 404).
   */
  @Get("recruitment/applicants/by-employee/:employeeId")
  @RequirePermissions("hr.recruitment.view")
  async applicantByEmployee(@Param("employeeId") employeeId: string) {
    return envelope(await this.recruitment.getApplicantByHiredEmployee(employeeId));
  }

  @Get("recruitment/applicants/:id")
  @RequirePermissions("hr.recruitment.view")
  async getApplicant(@Param("id") id: string) {
    return envelope(await this.recruitment.getApplicant(id));
  }

  @Post("recruitment/applicants/:id/stage")
  @RequirePermissions("hr.recruitment.manage")
  async advanceStage(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = stageBody.parse(body);
    return envelope(await this.recruitment.advanceStage(id, input.to, identity.userId));
  }

  @Post("recruitment/applicants/:id/reopen")
  @RequirePermissions("hr.recruitment.manage")
  async reopenApplicant(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.recruitment.reopenApplicant(id, identity.userId));
  }

  @Post("recruitment/applicants/:id/hire")
  @RequirePermissions("hr.recruitment.manage")
  async hireApplicant(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = hireBody.parse(body);
    return envelope(await this.recruitment.hireApplicant(id, input.employeeId, identity.userId));
  }

  // ── interviews (the panel scorecards) ────────────────────────────────────

  @Post("recruitment/interviews")
  @RequirePermissions("hr.recruitment.manage")
  async scheduleInterview(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = interviewBody.parse(body);
    return envelope(
      await this.recruitment.scheduleInterview({
        applicantId: input.applicantId,
        round: input.round,
        panelistEmployeeId: input.panelistEmployeeId,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        mode: input.mode,
        actorId: identity.userId,
      }),
    );
  }

  @Get("recruitment/interviews")
  @RequirePermissions("hr.recruitment.view")
  async listInterviews(
    @Query("applicantId") applicantId?: string,
    @Query("panelistEmployeeId") panelistEmployeeId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.recruitment.listInterviews({
        ...(applicantId === undefined ? {} : { applicantId }),
        ...(panelistEmployeeId === undefined ? {} : { panelistEmployeeId }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Put("recruitment/interviews/:id/scorecard")
  @RequirePermissions("hr.recruitment.interview")
  async recordScorecard(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = scorecardBody.parse(body);
    // THE OWN-ROWS LAW: the panelist is ALWAYS the acting user's
    // linked employee (the identity bridge, never a client-supplied
    // id) — the store's guarded UPDATE enforces it structurally.
    const panelistEmployeeId = await this.requireOwnEmployeeId(identity.userId);
    return envelope(
      await this.recruitment.recordScorecard({
        interviewId: id,
        panelistEmployeeId,
        scorecard: input.scorecard,
        verdict: input.verdict,
        comments: input.comments ?? null,
      }),
    );
  }
}
