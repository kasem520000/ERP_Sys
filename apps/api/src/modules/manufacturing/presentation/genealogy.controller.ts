import { Controller, Get, Inject, Param } from "@nestjs/common";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { GenealogyService } from "../application/genealogy-service";

/**
 * Genealogy routes (PHASE-018 §9 rows 19–21; MASTER-PLAN §10): the recall
 * walks — upstream materials, downstream productions + sales, and the batch
 * summary. Every route is a READ under the seeded
 * `manufacturing.genealogy.read` key, BR-039 feature-gated on
 * `manufacturing.batch_genealogy`, and returns the success envelope (the
 * permission guard itself demands an authenticated session, like every
 * other GET surface). Foreign or unknown batch ids are 404-shaped (A7 — no
 * existence disclosure). The walks never mutate anything.
 */

@Controller("api/v1/manufacturing/genealogy")
export class GenealogyController {
  constructor(@Inject(GenealogyService) private readonly genealogy: GenealogyService) {}

  @Get("upstream/:batchId")
  @RequirePermissions("manufacturing.genealogy.read")
  @RequireFeature("manufacturing.batch_genealogy")
  async upstream(@Param("batchId") batchId: string) {
    return envelope(await this.genealogy.upstream(batchId));
  }

  @Get("downstream/:batchId")
  @RequirePermissions("manufacturing.genealogy.read")
  @RequireFeature("manufacturing.batch_genealogy")
  async downstream(@Param("batchId") batchId: string) {
    return envelope(await this.genealogy.downstream(batchId));
  }

  @Get("batch/:batchId")
  @RequirePermissions("manufacturing.genealogy.read")
  @RequireFeature("manufacturing.batch_genealogy")
  async batchSummary(@Param("batchId") batchId: string) {
    return envelope(await this.genealogy.batchSummary(batchId));
  }
}
