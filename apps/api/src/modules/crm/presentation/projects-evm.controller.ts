import { Controller, Get, Inject, Param, Query } from "@nestjs/common";

import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { EvmService } from "../application/evm-service";

/**
 * PHASE-048 (W-10 — T-08) — the EVM routes (D-06): the point-in-time
 * EVM snapshot per project — PV exclusively from the APPROVED curve,
 * the two EV disciplines (the weighted structural rollup + the
 * certificate-gated figure, their delta the management signal), AC
 * from the T-07 collectors alone, CPI/SPI/ETC/EAC with the documented
 * fallback law, and the per-node arm (the node's own planned cells +
 * the labor leg — the honest node-dimensioned shape). Permission:
 * matrix §3.26's projects.evm.view (the W-9 finance-read key's second
 * binding — the EVM plane's own surface); the entitlement plane rides
 * the projects.wbs feature flag (D-16).
 *
 * The envelope law (the T-14 repair): every site awaits its service
 * call INSIDE envelope(...). No identity needed — a pure read.
 */
@Controller("api/v1/projects")
export class ProjectsEvmController {
  constructor(@Inject(EvmService) private readonly evm: EvmService) {}

  /** The EVM snapshot at asOf (the point-in-time PV/EV/AC read — the
   * forecast surface's data; the W-12 tab renders the trend from
   * snapshots at its own probe dates). */
  @Get(":projectId/evm")
  @RequirePermissions("projects.evm.view")
  @RequireFeature("projects.wbs")
  async snapshot(
    @Param("projectId") projectId: string,
    @Query("asOf") asOf?: string,
  ) {
    return envelope(
      await this.evm.snapshot(projectId, asOf ?? new Date().toISOString().slice(0, 10)),
    );
  }
}
