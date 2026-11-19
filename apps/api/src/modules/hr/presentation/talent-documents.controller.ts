import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { TalentAlertsService } from "../application/talent-alerts-service";
import { TalentOrgService } from "../application/talent-org-service";

/**
 * PHASE-047 (W-3 — T-09) — the documents + alert-config routes: the
 * employee document register (HR-10 — the Gulf compliance exposure;
 * reads AND writes ride hr.documents.manage — the register's own
 * permission plane, the PII inventory's law: the numbers surface only
 * here, masked everywhere else) and the hr-expiry-sweep's
 * registration surface (the tenant-configurable thresholds — the
 * upsert never disables the sweep silently: is_active is the
 * explicit off switch). Keys per matrix §3.25: hr.documents.manage
 * for both families (no separate view key — the register IS the
 * manage plane).
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const KIND = z.enum(["PASSPORT", "IQAMA", "VISA", "CONTRACT", "CERTIFICATE", "OTHER"]);

const documentBody = z.object({
  employeeId: UUID,
  kind: KIND,
  number: z.string().max(128).nullable().optional(),
  issuedOn: DATE.nullable().optional(),
  expiresOn: DATE.nullable().optional(),
  notes: TEXT.optional(),
});

const documentPatch = z.object({
  number: z.string().max(128).nullable().optional(),
  issuedOn: DATE.nullable().optional(),
  expiresOn: DATE.nullable().optional(),
  notes: TEXT.optional(),
});

const alertJobBody = z.object({
  thresholds: z.array(z.number().int().min(0)).min(1),
  isActive: z.boolean(),
  note: TEXT.optional(),
});

@Controller("api/v1/hr")
export class TalentDocumentsController {
  constructor(
    @Inject(TalentOrgService) private readonly org: TalentOrgService,
    @Inject(TalentAlertsService) private readonly alerts: TalentAlertsService,
  ) {}

  // ── the document register (HR-10) ────────────────────────────────────────

  @Post("documents")
  @RequirePermissions("hr.documents.manage")
  async createDocument(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = documentBody.parse(body);
    return envelope(
      await this.org.createDocument({
        employeeId: input.employeeId,
        kind: input.kind,
        number: input.number ?? null,
        issuedOn: input.issuedOn ?? null,
        expiresOn: input.expiresOn ?? null,
        notes: input.notes ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("documents")
  @RequirePermissions("hr.documents.manage")
  async listDocuments(
    @Query("employeeId") employeeId?: string,
    @Query("kind") kind?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.org.listDocuments({
        ...(employeeId === undefined ? {} : { employeeId }),
        ...(kind === undefined ? {} : { kind }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Patch("documents/:id")
  @RequirePermissions("hr.documents.manage")
  async patchDocument(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = documentPatch.parse(body);
    return envelope(
      await this.org.patchDocument({
        id,
        ...(input.number === undefined ? {} : { number: input.number }),
        ...(input.issuedOn === undefined ? {} : { issuedOn: input.issuedOn }),
        ...(input.expiresOn === undefined ? {} : { expiresOn: input.expiresOn }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        actorId: identity.userId,
      }),
    );
  }

  @Delete("documents/:id")
  @RequirePermissions("hr.documents.manage")
  async deleteDocument(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.org.deleteDocument(id, identity.userId));
  }

  // ── the sweep's registration surface (the tenant-configurable
  // thresholds — red line 5's law: DATA, not constants) ─────────────────────

  @Get("alerts/expiry-sweep")
  @RequirePermissions("hr.documents.manage")
  async listAlertJobs() {
    return envelope(await this.alerts.listJobs());
  }

  @Put("alerts/expiry-sweep")
  @RequirePermissions("hr.documents.manage")
  async upsertAlertJob(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = alertJobBody.parse(body);
    return envelope(
      await this.alerts.upsertJob({
        thresholds: input.thresholds,
        isActive: input.isActive,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
