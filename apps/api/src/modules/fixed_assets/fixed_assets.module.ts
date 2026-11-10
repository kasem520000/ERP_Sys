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
import { registerDepreciationJobs } from "./infrastructure/depreciation-assembly.job";
import { getBoss } from "../../infra/jobs/boss";
import { FixedAssetsController } from "./presentation/fixed-assets.controller";

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
  controllers: [FixedAssetsController],
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
