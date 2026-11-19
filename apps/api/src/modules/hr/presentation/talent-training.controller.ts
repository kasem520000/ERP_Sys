import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { TalentTrainingService } from "../application/talent-training-service";

/**
 * PHASE-047 (W-3 — T-08, the training half) — the training routes:
 * the program catalog (internal/external, the exact-decimal cost —
 * ADR-0009), the enrollments (the (program, employee) natural key +
 * the status ladder + the completion act), and the certification
 * register (the renewal UPDATE — the sweep's probe). Keys per matrix
 * §3.25: the reads = hr.training.view · the writes (programs,
 * enrollments, certifications — the family-cluster mapping: the view
 * key names all three surfaces, the manage key owns the family) =
 * hr.training.manage.
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MONEY = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/);
const PCT = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/);

const programBody = z.object({
  code: CODE,
  name: z.string().min(1).max(160),
  nameAr: z.string().max(160).nullable().optional(),
  kind: z.enum(["INTERNAL", "EXTERNAL"]),
  provider: z.string().max(160).nullable().optional(),
  cost: MONEY.nullable().optional(),
  notes: TEXT.optional(),
});

const programPatch = z.object({
  name: z.string().min(1).max(160).optional(),
  nameAr: z.string().max(160).nullable().optional(),
  provider: z.string().max(160).nullable().optional(),
  cost: MONEY.nullable().optional(),
  status: z.enum(["ACTIVE", "RETIRED"]).optional(),
  notes: TEXT.optional(),
});

const enrollmentBody = z.object({
  programId: UUID,
  employeeId: UUID,
  notes: TEXT.optional(),
});

const enrollmentPatch = z.object({
  status: z.enum(["ENROLLED", "IN_PROGRESS", "COMPLETED", "WITHDRAWN"]).optional(),
  attendancePct: PCT.nullable().optional(),
  completionPct: PCT.nullable().optional(),
  result: z.enum(["PENDING", "PASSED", "FAILED"]).nullable().optional(),
  notes: TEXT.optional(),
});

const certificationBody = z.object({
  employeeId: UUID,
  name: z.string().min(1).max(160),
  nameAr: z.string().max(160).nullable().optional(),
  issuer: z.string().min(1).max(160),
  issueDate: DATE,
  expiryDate: DATE.nullable().optional(),
  certificateNumber: z.string().max(128).nullable().optional(),
  notes: TEXT.optional(),
});

const certificationPatch = z.object({
  issuer: z.string().min(1).max(160).optional(),
  issueDate: DATE.optional(),
  expiryDate: DATE.nullable().optional(),
  certificateNumber: z.string().max(128).nullable().optional(),
  notes: TEXT.optional(),
});

@Controller("api/v1/hr")
export class TalentTrainingController {
  constructor(@Inject(TalentTrainingService) private readonly training: TalentTrainingService) {}

  // ── programs ─────────────────────────────────────────────────────────────

  @Post("training/programs")
  @RequirePermissions("hr.training.manage")
  async createProgram(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = programBody.parse(body);
    return envelope(
      await this.training.createProgram({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        kind: input.kind,
        provider: input.provider ?? null,
        cost: input.cost ?? null,
        notes: input.notes ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("training/programs")
  @RequirePermissions("hr.training.view")
  async listPrograms(@Query("status") status?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.training.listPrograms({
        ...(status === undefined ? {} : { status }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Get("training/programs/:id")
  @RequirePermissions("hr.training.view")
  async getProgram(@Param("id") id: string) {
    return envelope(await this.training.getProgram(id));
  }

  @Patch("training/programs/:id")
  @RequirePermissions("hr.training.manage")
  async updateProgram(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = programPatch.parse(body);
    return envelope(
      await this.training.updateProgram({
        id,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.cost === undefined ? {} : { cost: input.cost }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        actorId: identity.userId,
      }),
    );
  }

  // ── enrollments ──────────────────────────────────────────────────────────

  @Post("training/enrollments")
  @RequirePermissions("hr.training.manage")
  async enroll(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = enrollmentBody.parse(body);
    return envelope(
      await this.training.enroll({
        programId: input.programId,
        employeeId: input.employeeId,
        notes: input.notes ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("training/enrollments")
  @RequirePermissions("hr.training.view")
  async listEnrollments(
    @Query("programId") programId?: string,
    @Query("employeeId") employeeId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.training.listEnrollments({
        ...(programId === undefined ? {} : { programId }),
        ...(employeeId === undefined ? {} : { employeeId }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Patch("training/enrollments/:id")
  @RequirePermissions("hr.training.manage")
  async updateEnrollment(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = enrollmentPatch.parse(body);
    return envelope(
      await this.training.updateEnrollment({
        id,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.attendancePct === undefined ? {} : { attendancePct: input.attendancePct }),
        ...(input.completionPct === undefined ? {} : { completionPct: input.completionPct }),
        ...(input.result === undefined ? {} : { result: input.result }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        actorId: identity.userId,
      }),
    );
  }

  // ── certifications (the register + the sweep's probe) ────────────────────

  @Post("training/certifications")
  @RequirePermissions("hr.training.manage")
  async registerCertification(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = certificationBody.parse(body);
    return envelope(
      await this.training.registerCertification({
        employeeId: input.employeeId,
        name: input.name,
        nameAr: input.nameAr ?? null,
        issuer: input.issuer,
        issueDate: input.issueDate,
        expiryDate: input.expiryDate ?? null,
        certificateNumber: input.certificateNumber ?? null,
        notes: input.notes ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("training/certifications")
  @RequirePermissions("hr.training.view")
  async listCertifications(@Query("employeeId") employeeId?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.training.listCertifications({
        ...(employeeId === undefined ? {} : { employeeId }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Patch("training/certifications/:id")
  @RequirePermissions("hr.training.manage")
  async renewCertification(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = certificationPatch.parse(body);
    return envelope(
      await this.training.renewCertification({
        id,
        ...(input.issuer === undefined ? {} : { issuer: input.issuer }),
        ...(input.issueDate === undefined ? {} : { issueDate: input.issueDate }),
        ...(input.expiryDate === undefined ? {} : { expiryDate: input.expiryDate }),
        ...(input.certificateNumber === undefined ? {} : { certificateNumber: input.certificateNumber }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        actorId: identity.userId,
      }),
    );
  }
}
