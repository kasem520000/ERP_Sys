import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ProgressBillingService } from "../application/progress-billing-service";
import { RetentionService } from "../application/retention-service";
import { SubcontractService } from "../application/subcontract-service";

/**
 * PHASE-048 (W-11 — T-10 + T-11 + T-12; W-13 — T-15) — the contracting
 * routes (D-08
 * + D-09 + D-10): the subcontracting plane (the agreements' lifecycle +
 * the sub certificates + THE APPROVAL GATE that drives the AP linkage
 * and G-55's sub-side hold), the retention ledger (the CUSTOMER
 * register — the contract's commercial spine — + G-56's release), and
 * the progress-certificate billing (BR-092/093 + G-57 + the generated
 * invoice + the advance amortization).
 *
 * Permissions (matrix §3.26 — the W-10 gate's own reading): the
 * authoring + read plane rides projects.contracting.view (a DRAFT
 * author moves nothing until an approver acts — BR-094's own safety
 * argument); THE APPROVAL GATES (the sub certificate's approve and the
 * progress certificate's approve — the acts that post through the
 * engine) ride projects.certificates.approve; the lifecycle moves +
 * the voids + the register's authoring/schedule + the release ride
 * projects.contracting.manage / projects.retention.manage. The
 * entitlement plane rides the projects.contracting feature flag
 * (D-16).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const agreementCreateSchema = z.object({
  partnerId: z.string().uuid(),
  agreementNo: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200).nullish(),
  scope: z.string().max(4000).nullish(),
  agreementValue: z.string().regex(/^\d+(\.\d{1,4})?$/, "a positive decimal with ≤ 4dp"),
  currencyCode: z.string().length(3),
  retentionPercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "a decimal within [0, 100] with ≤ 2dp"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().max(2000).nullish(),
  noteAr: z.string().max(2000).nullish(),
});

const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const subCertificateCreateSchema = z.object({
  certificateNo: z.string().trim().min(1).max(40).nullish(),
  certificateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  progressPercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "a decimal within [0, 100] with ≤ 2dp"),
  grossValue: z.string().regex(/^\d+(\.\d{1,4})?$/, "a non-negative decimal with ≤ 4dp"),
  note: z.string().max(2000).nullish(),
  noteAr: z.string().max(2000).nullish(),
});

const registerCreateSchema = z.object({
  customerId: z.string().uuid(),
  contractValue: z.string().regex(/^\d+(\.\d{1,4})?$/, "a positive decimal with ≤ 4dp"),
  currencyCode: z.string().length(3),
  holdPercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "a decimal within [0, 100] with ≤ 2dp"),
  takingOverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  defectLiabilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().max(2000).nullish(),
  noteAr: z.string().max(2000).nullish(),
});

const registerScheduleSchema = z.object({
  holdPercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "a decimal within [0, 100] with ≤ 2dp").optional(),
  takingOverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  defectLiabilityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  note: z.string().max(2000).nullish(),
  noteAr: z.string().max(2000).nullish(),
});

const certificateCreateSchema = z.object({
  certificateNo: z.string().trim().min(1).max(40).nullish(),
  certificateDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(["PROGRESS", "ADVANCE", "FINAL"]),
  cumulativePercent: z.string().regex(/^\d+(\.\d{1,2})?$/, "a decimal within [0, 100] with ≤ 2dp"),
  grossValue: z.string().regex(/^\d+(\.\d{1,4})?$/, "a non-negative decimal with ≤ 4dp"),
  note: z.string().max(2000).nullish(),
  noteAr: z.string().max(2000).nullish(),
});

const fxSchema = z.object({
  exchangeRate: z.string().regex(/^\d+(\.\d{1,8})?$/, "a positive decimal FX rate").optional(),
});

@Controller("api/v1/projects")
export class ProjectsContractingController {
  constructor(
    @Inject(SubcontractService) private readonly subcontracts: SubcontractService,
    @Inject(RetentionService) private readonly retention: RetentionService,
    @Inject(ProgressBillingService) private readonly billing: ProgressBillingService,
  ) {}

  // -- T-10: the subcontracting plane (D-08) --------------------------------

  /** PHASE-048 (W-13 — T-15): the contracting screen's project pool —
   * the SAME one-store read the WBS board's pool rides, on THIS plane's
   * own viewer key (the W-12 step-2 precedent, mirrored: the screen
   * renders for contracting-only sessions; the accounting module's
   * project list keeps its own key). */
  @Get("contracting/pool")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async contractingPool() {
    return envelope(await this.subcontracts.listProjects());
  }

  @Get(":projectId/subcontracts")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async listSubcontracts(@Param("projectId") projectId: string) {
    return envelope(await this.subcontracts.listAgreements(projectId));
  }

  @Post(":projectId/subcontracts")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async createSubcontract(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = agreementCreateSchema.parse(body);
    return envelope(
      await this.subcontracts.createAgreement({
        projectId,
        partnerId: input.partnerId,
        agreementNo: input.agreementNo,
        title: input.title,
        titleAr: input.titleAr ?? null,
        scope: input.scope ?? null,
        agreementValue: input.agreementValue,
        currencyCode: input.currencyCode,
        retentionPercent: input.retentionPercent,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("subcontracts/:id")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async getSubcontract(@Param("id") id: string) {
    return envelope(await this.subcontracts.getAgreement(id));
  }

  /** The lifecycle move that opens the agreement's sub retention row
   * (the SAME retention ledger — D-08's law). */
  @Post("subcontracts/:id/activate")
  @RequirePermissions("projects.contracting.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async activateSubcontract(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.subcontracts.activateAgreement(id, identity.userId));
  }

  @Post("subcontracts/:id/close")
  @RequirePermissions("projects.contracting.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async closeSubcontract(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.subcontracts.closeAgreement(id, identity.userId));
  }

  @Post("subcontracts/:id/cancel")
  @RequirePermissions("projects.contracting.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async cancelSubcontract(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.subcontracts.cancelAgreement(id, input.reason, identity.userId));
  }

  @Get("subcontracts/:id/certificates")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async listSubCertificates(@Param("id") id: string) {
    return envelope(await this.subcontracts.listCertificates(id));
  }

  /** The sub مستخلص's authoring: the amounts DERIVED from the
   * agreement's own retention terms (BR-092 per agreement). */
  @Post("subcontracts/:id/certificates")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async createSubCertificate(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = subCertificateCreateSchema.parse(body);
    return envelope(
      await this.subcontracts.createCertificate({
        agreementId: id,
        certificateNo: input.certificateNo ?? null,
        certificateDate: input.certificateDate,
        progressPercent: input.progressPercent,
        grossValue: input.grossValue,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** THE SUB GATE — approval drives the AP linkage + G-55's sub-side
   * hold through the engine (all-or-nothing with the single-use AP
   * stamp); the accountant's approval key. */
  @Post("sub-certificates/:id/approve")
  @RequirePermissions("projects.certificates.approve")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async approveSubCertificate(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = fxSchema.parse(body ?? {});
    return envelope(
      await this.subcontracts.approveCertificate({
        id,
        exchangeRate: input.exchangeRate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("sub-certificates/:id/void")
  @RequirePermissions("projects.contracting.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async voidSubCertificate(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.subcontracts.voidCertificate(id, input.reason, identity.userId));
  }

  // -- T-11: the retention ledger (D-09) ------------------------------------

  /** The whole ledger view: the CUSTOMER register + every sub row. */
  @Get(":projectId/retention")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async retentionLedger(@Param("projectId") projectId: string) {
    return envelope(await this.retention.ledger(projectId));
  }

  /** The CUSTOMER register's authoring — the contract's commercial
   * spine (ONE per project; the value/currency/customer are immutable
   * — the change-order gate is the only re-planning path). */
  @Post(":projectId/retention/register")
  @RequirePermissions("projects.retention.manage")
  @RequireFeature("projects.contracting")
  async createRetentionRegister(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = registerCreateSchema.parse(body);
    return envelope(
      await this.retention.createRegister({
        projectId,
        customerId: input.customerId,
        contractValue: input.contractValue,
        currencyCode: input.currencyCode,
        holdPercent: input.holdPercent,
        takingOverDate: input.takingOverDate ?? null,
        defectLiabilityDate: input.defectLiabilityDate ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** The patchable terms ONLY (the hold % + the release schedule + the
   * notes) — the immutable core is the typed refusal. */
  @Post("retention/:id/schedule")
  @RequirePermissions("projects.retention.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async patchRetentionRegister(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = registerScheduleSchema.parse(body);
    return envelope(
      await this.retention.patchRegister({
        id,
        holdPercent: input.holdPercent,
        takingOverDate: input.takingOverDate ?? undefined,
        defectLiabilityDate: input.defectLiabilityDate ?? undefined,
        note: input.note ?? undefined,
        noteAr: input.noteAr ?? undefined,
        actorId: identity.userId,
      }),
    );
  }

  /** G-56 — the release at final acceptance (the schedule's gates +
   * the single-use CAS + the posting, all-or-nothing). */
  @Post("retention/:id/release")
  @RequirePermissions("projects.retention.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async releaseRetention(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = fxSchema.parse(body ?? {});
    return envelope(
      await this.retention.release({
        id,
        exchangeRate: input.exchangeRate,
        actorId: identity.userId,
      }),
    );
  }

  // -- T-12: the progress-certificate billing (D-10) -------------------------

  /** The cumulative billing state (the ceiling's own read, surfaced). */
  @Get(":projectId/billing")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async billingState(@Param("projectId") projectId: string) {
    return envelope(await this.billing.billingState(projectId));
  }

  @Get(":projectId/certificates")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async listCertificates(@Param("projectId") projectId: string) {
    return envelope(await this.billing.list(projectId));
  }

  /** The certificate's authoring: the retention/net pair DERIVED from
   * the register's hold % (BR-092 — the contract's own terms). */
  @Post(":projectId/certificates")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  async createCertificate(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = certificateCreateSchema.parse(body);
    return envelope(
      await this.billing.createCertificate({
        projectId,
        certificateNo: input.certificateNo ?? null,
        certificateDate: input.certificateDate,
        kind: input.kind,
        cumulativePercent: input.cumulativePercent,
        grossValue: input.grossValue,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("certificates/:id/submit")
  @RequirePermissions("projects.contracting.view")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async submitCertificate(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.billing.submit(id, identity.userId));
  }

  /** THE BILLING GATE — approval enforces BR-093's ceiling (the typed
   * refusal, no truncation), posts G-57 + the advance amortization,
   * generates the invoice in-transaction, and stamps it
   * single-use; the accountant's approval key. */
  @Post("certificates/:id/approve")
  @RequirePermissions("projects.certificates.approve")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async approveCertificate(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = fxSchema.parse(body ?? {});
    return envelope(
      await this.billing.approve({
        id,
        exchangeRate: input.exchangeRate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("certificates/:id/void")
  @RequirePermissions("projects.contracting.manage")
  @RequireFeature("projects.contracting")
  @HttpCode(HttpStatus.OK)
  async voidCertificate(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.billing.void(id, input.reason, identity.userId));
  }
}
