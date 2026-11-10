import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { GroupService } from "./application/group-service";
import { EliminationService } from "./application/elimination-service";
import { RunService } from "./application/run-service";
import { ConsolidationReaderService } from "./application/reader-service";
import { registerConsolidationJobs } from "./infrastructure/consolidation-run.job";
import { getBoss } from "../../infra/jobs/boss";
import { ConsolidationController } from "./presentation/consolidation.controller";

/**
 * Consolidation module (PHASE-034; ADR-0018 + DR-006 option A — the FINAL
 * roadmap phase, stage 11 / the Enterprise Depth gate): consolidation
 * groups as configuration in the owner tenant's plane, elimination entries
 * posted via the engine into the PARENT's consolidation books (G-32,
 * source CONSOLIDATION_ELIMINATION, reversal-only per BR-056), runs as
 * read-only aggregations over member books through the ONE audited
 * platform-plane reader (zero cross-tenant writes — INV-026), FX
 * translation at dated stored rates (INV-008; the OQ-V2-2 decision
 * DR-P34-FX-1: CLOSING_RATE default, per-group fx_translation_method),
 * and consolidated statements as PHASE-013 report contracts reading
 * immutable run snapshots.
 *
 * Dependencies (DEPENDENCY_RULES §2; phase §4): accounting (posting engine
 * — eliminations flow through PostingService.post, ADR-0007; the owner's
 * fiscal periods + dated rates + numbering) + audit (every maintenance
 * action, every elimination transition, every member-book read). The
 * cross-tenant edge is READ-ONLY and named in DEPENDENCY_RULES rule 5 —
 * the reader service is the ONLY sanctioned consumer of the
 * platform-plane grant (RISK-016: dependency-cruiser rules keep it that
 * way; no other module imports the reader seam). The module writes only
 * its own four tables plus the parent tenant's journals VIA the engine.
 */
@Module({
  imports: [AccountingModule, AuditModule],
  controllers: [ConsolidationController],
  providers: [
    GroupService,
    EliminationService,
    RunService,
    ConsolidationReaderService,
  ],
  exports: [GroupService, EliminationService, RunService, ConsolidationReaderService],
})
export class ConsolidationModule implements OnModuleInit {
  /**
   * ADR-0008: the bounded consolidation-run queue registers on boot —
   * serial createQueue, degrade-the-feature-never-the-platform
   * (registration failure is caught; the synchronous execute path stays
   * up — the depreciation-assembly precedent).
   */
  async onModuleInit(): Promise<void> {
    await registerConsolidationJobs(getBoss()).catch((error) => {
      void error;
    });
  }
}
