import { Controller, Get, Inject, Param } from "@nestjs/common";

import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ProjectActualsService } from "../application/project-actuals-service";

/**
 * PHASE-048 (W-9 — T-07) — the actual-collector routes (D-05): the
 * four-leg AC breakdown (labor from the approved-class WBS-dimensioned
 * time entries × the payroll cost rates; materials from the WMS issue
 * paths; subcontract from the APPROVED certificates' nets; overhead
 * from the tenant-configured distributor) and the INV-033 typed
 * reconciliation — the service REFUSES to report at any residual
 * against the GL project dimension. Permission: matrix §3.26's
 * projects.evm.view (AC is the EVM plane's cost figure — the W-10
 * engine's input; the finance-read key the accountant holds); the
 * entitlement plane rides the projects.wbs feature flag (D-16).
 *
 * The envelope law (the T-14 repair): every site awaits its service
 * call INSIDE envelope(...). No identity needed — pure reads.
 */

@Controller("api/v1/projects")
export class ProjectsActualsController {
  constructor(@Inject(ProjectActualsService) private readonly actuals: ProjectActualsService) {}

  /** The four-leg AC breakdown — each leg names its own source; the
   * degraded/unpriced states are the honest disclosures (never a
   * fabricated zero). */
  @Get(":projectId/actuals")
  @RequirePermissions("projects.evm.view")
  @RequireFeature("projects.wbs")
  async breakdown(@Param("projectId") projectId: string) {
    return envelope(await this.actuals.breakdown(projectId));
  }

  /** INV-033 (acceptance #3): AC = labor + materials + subcontract +
   * allocated overhead, reconciling to the GL project dimension TO THE
   * CENT — any residual is the typed refusal carrying the breakdown. */
  @Get(":projectId/inv033")
  @RequirePermissions("projects.evm.view")
  @RequireFeature("projects.wbs")
  async inv033(@Param("projectId") projectId: string) {
    return envelope(await this.actuals.inv033(projectId));
  }
}
