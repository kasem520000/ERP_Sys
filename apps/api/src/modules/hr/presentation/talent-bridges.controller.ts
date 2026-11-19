import { Body, Controller, Get, Inject, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { TalentBridgesService } from "../application/talent-bridges-service";
import { BRIDGE_IMPORT_MAX_ROWS } from "../domain/talent-bridge";

/**
 * PHASE-047 (W-4 — T-10, D-07) — the external HR bridges' routes: the
 * three export contracts (CSV/JSON — the 046 remittance-export
 * precedent: the file STREAMS under @Res(), bytes not envelope; the
 * generation is read-only + audited) + the two import paths (the
 * row-level validation report under the envelope).
 *
 * THE KEYS (matrix §3.25's family-cluster mapping — the W-3 precedent;
 * no new keys this wave, drift stays 312 = 312):
 * - `hr.employee-master` + `hr.employment-org-snapshot` ride
 *   `payroll.employees.view` — the employment master's own read plane
 *   (the 045 bridge-read precedent; the org axes are D-01's documented
 *   extensions riding the master, the placement columns of the
 *   employment record).
 * - `hr.appraisal-results` rides `hr.performance.view` — the
 *   performance plane's read key.
 * - The appraisal-results IMPORT rides `hr.performance.manage` — the
 *   manage-side bulk act (the reviewer identity is the DATA's own, the
 *   external system's manager; the acting user is the importing
 *   administrator — the own-rows law is the in-app /review surface's,
 *   enforced there by the session bridge).
 * - The training-completions IMPORT rides `hr.training.manage` — the
 *   family's write key.
 *
 * The envelope law (the T-14 repair): the import sites await their
 * service call INSIDE envelope(...); the export sites stream @Res()
 * bytes (the remittance precedent — no envelope on a file).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const exportQuery = z.object({
  format: z.enum(["csv", "json"]).default("csv"),
  locale: z.enum(["ar", "en"]).default("ar"),
});

const appraisalExportQuery = exportQuery.extend({
  cycleId: z.string().uuid().optional(),
});

const appraisalImportBody = z.object({
  cycleId: z.string().uuid(),
  rows: z.array(z.unknown()).min(1).max(BRIDGE_IMPORT_MAX_ROWS),
});

const trainingImportBody = z.object({
  rows: z.array(z.unknown()).min(1).max(BRIDGE_IMPORT_MAX_ROWS),
});

@Controller("api/v1/hr")
export class TalentBridgesController {
  constructor(@Inject(TalentBridgesService) private readonly bridges: TalentBridgesService) {}

  // ── the three export contracts (CSV/JSON, streamed) ──────────────────────

  @Get("bridges/exports/employee-master")
  @RequirePermissions("payroll.employees.view")
  async exportEmployeeMaster(
    @Req() request: Request,
    @Res() response: Response,
    @Query("format") format?: string,
    @Query("locale") locale?: string,
  ) {
    const identity = requireIdentity(request);
    const input = exportQuery.parse({
      format: format === undefined || format === "" ? undefined : format,
      locale: locale === undefined || locale === "" ? undefined : locale,
    });
    const result = await this.bridges.exportContract({
      contract: "hr.employee-master",
      format: input.format,
      locale: input.locale,
      actorId: identity.userId,
    });
    response.header("Content-Type", result.contentType);
    response.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.status(200).send(result.bytes);
  }

  @Get("bridges/exports/employment-org-snapshot")
  @RequirePermissions("payroll.employees.view")
  async exportEmploymentOrgSnapshot(
    @Req() request: Request,
    @Res() response: Response,
    @Query("format") format?: string,
    @Query("locale") locale?: string,
  ) {
    const identity = requireIdentity(request);
    const input = exportQuery.parse({
      format: format === undefined || format === "" ? undefined : format,
      locale: locale === undefined || locale === "" ? undefined : locale,
    });
    const result = await this.bridges.exportContract({
      contract: "hr.employment-org-snapshot",
      format: input.format,
      locale: input.locale,
      actorId: identity.userId,
    });
    response.header("Content-Type", result.contentType);
    response.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.status(200).send(result.bytes);
  }

  @Get("bridges/exports/appraisal-results")
  @RequirePermissions("hr.performance.view")
  async exportAppraisalResults(
    @Req() request: Request,
    @Res() response: Response,
    @Query("format") format?: string,
    @Query("locale") locale?: string,
    @Query("cycleId") cycleId?: string,
  ) {
    const identity = requireIdentity(request);
    const input = appraisalExportQuery.parse({
      format: format === undefined || format === "" ? undefined : format,
      locale: locale === undefined || locale === "" ? undefined : locale,
      cycleId: cycleId === undefined || cycleId === "" ? undefined : cycleId,
    });
    const result = await this.bridges.exportContract({
      contract: "hr.appraisal-results",
      format: input.format,
      locale: input.locale,
      ...(input.cycleId === undefined ? {} : { cycleId: input.cycleId }),
      actorId: identity.userId,
    });
    response.header("Content-Type", result.contentType);
    response.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    response.status(200).send(result.bytes);
  }

  // ── the two import paths (the row-level validation report) ───────────────

  @Post("bridges/imports/appraisal-results")
  @RequirePermissions("hr.performance.manage")
  async importAppraisalResults(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = appraisalImportBody.parse(body);
    return envelope(
      await this.bridges.importAppraisalResults({
        cycleId: input.cycleId,
        rows: input.rows,
        actorId: identity.userId,
      }),
    );
  }

  @Post("bridges/imports/training-completions")
  @RequirePermissions("hr.training.manage")
  async importTrainingCompletions(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = trainingImportBody.parse(body);
    return envelope(
      await this.bridges.importTrainingCompletions({
        rows: input.rows,
        actorId: identity.userId,
      }),
    );
  }
}
