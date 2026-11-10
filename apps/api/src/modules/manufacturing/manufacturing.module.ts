import { Module } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { InventoryModule } from "../inventory/inventory.module";
import { ItemsModule } from "../items/items.module";
import { ConfigurationModule } from "../configuration/configuration.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { BomService } from "./application/bom-service";
import { ProductionOrderService } from "./application/production-order-service";
import { ManufacturingReconciliationService } from "./application/wip-reconciliation-service";
import { InspectionService } from "./application/inspection-service";
import { GenealogyService } from "./application/genealogy-service";
import { BomsController } from "./presentation/boms.controller";
import { ProductionOrdersController } from "./presentation/production-orders.controller";
import { ReconciliationController } from "./presentation/reconciliation.controller";
import { InspectionsController } from "./presentation/inspections.controller";
import { GenealogyController } from "./presentation/genealogy.controller";

/**
 * Manufacturing module (PHASE-018 T38a — the BOM slice; T38b appends the
 * production-order services to this same module): versioned recipes per FG
 * item (DRAFT → ACTIVE → ARCHIVED, one ACTIVE per item, monotonic versionNo)
 * with the multi-level explosion (MASTER-PLAN §3, round6 per level, cycle/
 * depth-guarded), and the production-order lifecycle (DRAFT → RELEASED →
 * IN_PROGRESS → COMPLETED/CANCELLED) with the consume/scrap/complete posting
 * legs through the centralized engine (ADR-0007) and the movement core.
 *
 * Dependencies (DEPENDENCY_RULES §2): audit (transactional audit events) +
 * accounting (PostingService/NumberingService for the order posting legs) +
 * inventory (TrackingService — the QC quarantine hold + produced-batch
 * provenance; the movement core is reached via direct import like
 * job-card-posting does) + items (ItemService/UomService) + configuration
 * (ResolveEffectiveConfigService — the `config.policies` reads the order
 * service uses for the four manufacturing policy keys) + notifications
 * (InboxService — the §5 variance-review notification and the §11 WIP
 * reconciliation-broken notification).
 *
 * T38b-ii appends the WIP reconciliation slice (MASTER-PLAN §11, INV-010
 * extension): ManufacturingReconciliationService + the wip-check route (§9
 * row 18) — read-only analysis recording into the PHASE-007 reconciliation
 * framework; the run never writes a journal.
 *
 * T39 appends the QC + genealogy slice (MASTER-PLAN §4/§10, §9 rows 19–24):
 * InspectionService (the QC gate — releases via TrackingService, the
 * qc_scrap posting leg through the movement core + PostingService) with the
 * inspections routes under manufacturing.qc.manage / manufacturing.qc, and
 * the read-only GenealogyService with the recall-walk routes under
 * manufacturing.genealogy.read / manufacturing.batch_genealogy.
 */
@Module({
  imports: [AccountingModule, AuditModule, InventoryModule, ItemsModule, ConfigurationModule, NotificationsModule],
  controllers: [
    BomsController,
    ProductionOrdersController,
    ReconciliationController,
    InspectionsController,
    GenealogyController,
  ],
  providers: [
    BomService,
    ProductionOrderService,
    ManufacturingReconciliationService,
    InspectionService,
    GenealogyService,
  ],
  exports: [
    BomService,
    ProductionOrderService,
    ManufacturingReconciliationService,
    InspectionService,
    GenealogyService,
  ],
})
export class ManufacturingModule {}
