import { Module } from "@nestjs/common";

import { InfrastructureModule } from "../../infra/infra.module";
import { AuditModule } from "../audit/audit.module";
import { FilesModule } from "../files/files.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PartnersModule } from "../partners/partners.module";
import { FixedAssetsModule } from "../fixed_assets/fixed_assets.module";
import { PayrollModule } from "../payroll/payroll.module";
import { ItemsModule } from "../items/items.module";
import { CrmModule } from "../crm/crm.module";
import { BudgetingModule } from "../budgeting/budgeting.module";
import { ImportToolkitService } from "./application/import-toolkit-service";
import { MappingsService } from "./application/mappings-service";
import { ImportsController } from "./presentation/imports.controller";

/**
 * PHASE-040 data onboarding & migration toolkit (§2): the seven-kind import
 * engine (COA, ACCOUNT_OPENING_BALANCES, FIXED_ASSETS, EMPLOYEES,
 * PRICE_LISTS, CONTRACTS, BUDGETS) with the BR-066 dry-run → atomic-commit
 * gate, the column-mapping wizard API, saved mappings (both directions),
 * the migration adapters (T-05), the demo-data loader (T-06) and sandbox
 * provisioning (T-07 — the platform-plane route lands with that task).
 *
 * The engine applies every row through the REAL module services (CoaService,
 * the partners opening engine, AssetService, EmployeeService,
 * PriceListService, ContractService, the PHASE-028 budgeting import) — no
 * raw inserts, no journal bypass — which is why this module imports (and
 * consumes exports of) the owning modules.
 */
@Module({
  imports: [
    InfrastructureModule,
    AuditModule,
    FilesModule,
    AccountingModule,
    PartnersModule,
    FixedAssetsModule,
    PayrollModule,
    ItemsModule,
    CrmModule,
    BudgetingModule,
  ],
  controllers: [ImportsController],
  providers: [ImportToolkitService, MappingsService],
  exports: [ImportToolkitService, MappingsService],
})
export class OnboardingModule {}
