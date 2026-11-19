import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { TalentOrgService } from "../application/talent-org-service";

/**
 * PHASE-047 (W-3 — T-08, the org half) — the org routes: the org
 * tree's units (the D-09 cycle-safe moves — the guarded API, never
 * client-side reordering) and the bilingual positions (grade, org
 * unit, reports_to with the same guard). Keys per matrix §3.25: the
 * reads = hr.org.view · the writes (creates, patches, moves) =
 * hr.org.manage.
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
const ORG_CODE = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

const orgUnitBody = z.object({
  code: ORG_CODE,
  name: z.string().min(1).max(160),
  nameAr: z.string().max(160).nullable().optional(),
  parentId: UUID.nullable().optional(),
});

const orgUnitPatch = z.object({
  name: z.string().min(1).max(160).optional(),
  nameAr: z.string().max(160).nullable().optional(),
  active: z.boolean().optional(),
  /** Tri-state: undefined = keep, null = move to root, uuid = re-parent. */
  parentId: UUID.nullable().optional(),
});

const positionBody = z.object({
  code: ORG_CODE,
  title: z.string().min(1).max(160),
  titleAr: z.string().max(160).nullable().optional(),
  grade: z.string().max(32).nullable().optional(),
  orgUnitId: UUID.nullable().optional(),
  reportsTo: UUID.nullable().optional(),
});

const positionPatch = z.object({
  title: z.string().min(1).max(160).optional(),
  titleAr: z.string().max(160).nullable().optional(),
  grade: z.string().max(32).nullable().optional(),
  orgUnitId: UUID.nullable().optional(),
  reportsTo: UUID.nullable().optional(),
  status: z.enum(["ACTIVE", "RETIRED"]).optional(),
});

@Controller("api/v1/hr")
export class TalentOrgController {
  constructor(@Inject(TalentOrgService) private readonly org: TalentOrgService) {}

  // ── org units (the cycle-safe tree) ──────────────────────────────────────

  @Post("org/units")
  @RequirePermissions("hr.org.manage")
  async createOrgUnit(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = orgUnitBody.parse(body);
    return envelope(
      await this.org.createOrgUnit({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        parentId: input.parentId ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("org/units")
  @RequirePermissions("hr.org.view")
  async listOrgUnits() {
    return envelope(await this.org.listOrgUnits());
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's placement read): the
   * employee's D-01 placement axes (position + org unit + probation
   * end) or null axes — a position-less employee is a valid state.
   */
  @Get("org/placement/:employeeId")
  @RequirePermissions("hr.org.view")
  async placement(@Param("employeeId") employeeId: string) {
    return envelope(await this.org.getPlacement(employeeId));
  }

  @Patch("org/units/:id")
  @RequirePermissions("hr.org.manage")
  async patchOrgUnit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = orgUnitPatch.parse(body);
    return envelope(
      await this.org.patchOrgUnit({
        id,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
        actorId: identity.userId,
      }),
    );
  }

  // ── positions (the bilingual slots) ──────────────────────────────────────

  @Post("positions")
  @RequirePermissions("hr.org.manage")
  async createPosition(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = positionBody.parse(body);
    return envelope(
      await this.org.createPosition({
        code: input.code,
        title: input.title,
        titleAr: input.titleAr ?? null,
        grade: input.grade ?? null,
        orgUnitId: input.orgUnitId ?? null,
        reportsTo: input.reportsTo ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("positions")
  @RequirePermissions("hr.org.view")
  async listPositions(@Query("orgUnitId") orgUnitId?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.org.listPositions({
        ...(orgUnitId === undefined ? {} : { orgUnitId }),
        ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
      }),
    );
  }

  @Patch("positions/:id")
  @RequirePermissions("hr.org.manage")
  async patchPosition(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = positionPatch.parse(body);
    return envelope(
      await this.org.patchPosition({
        id,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }),
        ...(input.grade === undefined ? {} : { grade: input.grade }),
        ...(input.orgUnitId === undefined ? {} : { orgUnitId: input.orgUnitId }),
        ...(input.reportsTo === undefined ? {} : { reportsTo: input.reportsTo }),
        ...(input.status === undefined ? {} : { status: input.status }),
        actorId: identity.userId,
      }),
    );
  }
}
