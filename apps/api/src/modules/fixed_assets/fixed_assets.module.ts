import { Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
// P26-C (T10 — RC-10 BROKEN notification): InboxService is exported by
// NotificationsModule (the manufacturing WIP-check wiring precedent).
import { NotificationsModule } from "../notifications/notifications.module";
import { CategoryService } from "./application/category-service";
import { AssetService } from "./application/asset-service";
import { CapitalizationService } from "./application/capitalization-service";
import { PurchaseCapitalizationService } from "./application/purchase-capitalization";
// P26-B (T6/T7 — depreciation runs): the calculation/assembly service, the
// G-22 post/reverse service, and the bounded pg-boss assembly job.
import { DepreciationService } from "./application/depreciation-service";
import { RunService } from "./application/run-service";
// P26-C (T8/T9/T10 — lifecycle tail): revaluation (BR-044), disposal
// (G-23 + SoD approval + asset lock), and the RC-10 register↔GL check.
import { RevaluationService } from "./application/revaluation-service";
import { DisposalService } from "./application/disposal-service";
import { FixedAssetsReconciliationService } from "./application/fixed-assets-reconciliation";
// PHASE-049 (W-17 — T-05/T-06/T-07): the CMMS plane — the work-order
// engine (the status machine + the cost collectors + G-59's fused
// completion act) and the plans API (BR-097's single-open window + the
// checklist carry-over). PostingService + NumberingService ride the
// AccountingModule import; the parts issue rides the inventory movement
// core's plain functions (the service-order-posting precedent).
import { MaintenanceWorkOrderService } from "./application/maintenance-work-order-service";
import { MaintenancePlanService } from "./application/maintenance-plan-service";
// PHASE-049 (W-18 — T-08/T-09/T-10): the meters + spares + transfers plane.
import { AssetMetersService } from "./application/asset-meters-service";
import { AssetSparesService } from "./application/asset-spares-service";
import { AssetTransfersService } from "./application/asset-transfers-service";
import { registerDepreciationJobs } from "./infrastructure/depreciation-assembly.job";
import { getBoss } from "../../infra/jobs/boss";
import { FixedAssetsController } from "./presentation/fixed-assets.controller";
import { MaintenanceController } from "./presentation/maintenance.controller";
import { MaintenancePlansController } from "./presentation/maintenance-plans.controller";
// PHASE-049 (W-18 — T-08/T-09/T-10).
import { AssetMetersController } from "./presentation/asset-meters.controller";
import { AssetSparesController } from "./presentation/asset-spares.controller";
import { AssetTransfersController } from "./presentation/asset-transfers.controller";

/**
 * Fixed-assets module (PHASE-026; DR-002 option A): purpose-linked asset
 * categories (BR-041), the asset register (statuses + custodian), and
 * acquisition via the direct-capitalization journal G-21 (credit / cash /
 * opening variants) plus the purchasing capitalization hook (port +
 * direct invoice-side acquisition). Depreciation runs (G-22), revaluation
 * (BR-044), disposal (G-23), and the report contracts are added by the
 * later P26 waves against the same store + controller seams.
 *
 * Dependencies (DEPENDENCY_RULES §2; phase §4): accounting (posting
 * engine — every journal flows through PostingService.post, ADR-0007;
 * purpose-resolution read model; journal source-key read model) + audit.
 * Cross-module READ refs (sanctioned §4 "read refs"): tenancy (branches),
 * identity (custodian memberships), partners (credit-funding partner),
 * purchasing (supplier invoices on the purchase path) — none of them are
 * written here. fixed_assets NEVER writes journal_entries/journal_lines
 * or any purchasing/partner/identity table.
 */
@Module({
  imports: [AccountingModule, AuditModule, NotificationsModule],
  controllers: [
    FixedAssetsController,
    MaintenanceController,
    MaintenancePlansController,
    // PHASE-049 (W-18): the meters + spares + transfers routes.
    AssetMetersController,
    AssetSparesController,
    AssetTransfersController,
  ],
  providers: [
    CategoryService,
    AssetService,
    CapitalizationService,
    PurchaseCapitalizationService,
    // P26-B (T6/T7): depreciation assembly + run post/reverse.
    DepreciationService,
    RunService,
    // P26-C (T8/T9/T10): revaluation, disposal, RC-10 reconciliation.
    RevaluationService,
    DisposalService,
    FixedAssetsReconciliationService,
    // PHASE-049 (W-17): the CMMS plane.
    MaintenanceWorkOrderService,
    MaintenancePlanService,
    // PHASE-049 (W-18 — T-08/T-09/T-10): the meters + spares + transfers
    // plane (the meters service consumes the plan-evaluation fold through
    // the plan service; the transfers service posts G-61 through the REAL
    // engine; the spares BOM never writes inventory — the consumption is
    // the W-17 completion act's REAL WMS path).
    AssetMetersService,
    AssetSparesService,
    AssetTransfersService,
  ],
  exports: [
    CategoryService,
    AssetService,
    CapitalizationService,
    PurchaseCapitalizationService,
    // P26-B (T6/T7).
    DepreciationService,
    RunService,
    // P26-C (T8/T9/T10).
    RevaluationService,
    DisposalService,
    FixedAssetsReconciliationService,
    // PHASE-049 (W-17): the CMMS plane (W-18's meters API consumes the
    // plan-evaluation fold through the plan service).
    MaintenanceWorkOrderService,
    MaintenancePlanService,
    // PHASE-049 (W-18): the meters + spares + transfers plane.
    AssetMetersService,
    AssetSparesService,
    AssetTransfersService,
  ],
})
export class FixedAssetsModule implements OnModuleInit {
  /**
   * P26-B (T6, ADR-0008): the bounded depreciation-assembly queue registers
   * on boot — serial createQueue, degrade-the-feature-never-the-platform
   * (registration failure is caught; the synchronous surface stays up).
   */
  async onModuleInit(): Promise<void> {
    await registerDepreciationJobs(getBoss()).catch((error) => {
      void error;
    });
  }
}
