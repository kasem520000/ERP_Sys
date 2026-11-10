import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { LeadService } from "../application/lead-service";

/**
 * Lead routes (PHASE-019 §11 rows 4–9 + row 17; matrix §3.8): the intake
 * pipeline — list/create/read/edit, the qualify/lose/convert transitions,
 * and the CRM dashboard summary. Every route is permission-guarded (the
 * seeded `crm.leads.manage` key), BR-039 feature-gated on `crm.leads`,
 * Idempotency-Key'd by the global POST guard, and returns the success
 * envelope. Foreign or unknown ids are 404-shaped (A7 — no existence
 * disclosure). Leads are not documents: no numbering, no money fields, no
 * ledger effects (MASTER-PLAN §2).
 *
 * Both crm controllers share the `api/v1/crm` prefix so the registered
 * route-permissions rows match byte-for-byte (dashboard-summary lives here
 * — its crm.leads.manage permission is the leads surface).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const LIMIT = z.coerce.number().int().min(1).max(500);
const NOTE = z.string().min(1).max(500).nullable().optional();
const SOURCE = z.enum(["WALK_IN", "REFERRAL", "WEBSITE", "CAMPAIGN", "CALL", "OTHER"]);

const createSchema = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullable().optional(),
  phone: z.string().min(1).max(60).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  company: z.string().min(1).max(200).nullable().optional(),
  source: SOURCE.default("OTHER"),
  ownerUserId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullable().optional(),
  phone: z.string().min(1).max(60).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  company: z.string().min(1).max(200).nullable().optional(),
  source: SOURCE.optional(),
  ownerUserId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

/** §2: {mode: NEW_PARTNER|MERGE, partnerId?, kind} — MERGE requires the
 * target partner id (the discriminated union makes its absence a 422). */
const convertSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("NEW_PARTNER"),
    kind: z.enum(["CUSTOMER", "BOTH"]),
  }),
  z.object({
    mode: z.literal("MERGE"),
    partnerId: UUID,
    kind: z.enum(["CUSTOMER", "BOTH"]),
  }),
]);

const loseSchema = z.object({ reason: z.string().min(1).max(200) });

@Controller("api/v1/crm")
export class LeadsController {
  constructor(@Inject(LeadService) private readonly leads: LeadService) {}

  @Get("leads")
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async list(
    @Query("status") status?: string,
    @Query("ownerUserId") ownerUserId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.leads.list({
        status,
        ownerUserId: ownerUserId && UUID.safeParse(ownerUserId).success ? ownerUserId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("leads")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.leads.create({
        name: input.name,
        nameAr: input.nameAr ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        company: input.company ?? null,
        source: input.source,
        ownerUserId: input.ownerUserId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("leads/:id")
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async get(@Param("id") id: string) {
    return envelope(await this.leads.find(id));
  }

  @Put("leads/:id")
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.leads.update(
        id,
        {
          name: input.name,
          nameAr: input.nameAr,
          phone: input.phone,
          email: input.email,
          company: input.company,
          source: input.source,
          ownerUserId: input.ownerUserId,
          note: input.note,
          noteAr: input.noteAr,
        },
        identity.userId,
      ),
    );
  }

  @Post("leads/:id/convert")
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async convert(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = convertSchema.parse(body);
    return envelope(
      await this.leads.convert(id, {
        mode: input.mode,
        partnerId: input.mode === "MERGE" ? input.partnerId : undefined,
        kind: input.kind,
        actorId: identity.userId,
      }),
    );
  }

  @Post("leads/:id/lose")
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async lose(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = loseSchema.parse(body);
    return envelope(await this.leads.lose(id, reason, identity.userId));
  }

  /** §11 row 17 / §13: pipeline counts + follow-ups + expiry/billing
   * previews — operational counts for the CRM dashboard section. */
  @Get("dashboard-summary")
  @RequirePermissions("crm.leads.manage")
  @RequireFeature("crm.leads")
  async dashboardSummary() {
    return envelope(await this.leads.dashboardSummary());
  }
}
