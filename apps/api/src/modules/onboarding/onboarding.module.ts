import { Module } from "@nestjs/common";

import { InfrastructureModule } from "../../infra/infra.module";
import { AuditModule } from "../audit/audit.module";
import { FilesModule } from "../files/files.module";
import { IdentityModule } from "../identity/identity.module";
import { AccountingModule } from "../accounting/accounting.module";
import { PartnersModule } from "../partners/partners.module";
import { FixedAssetsModule } from "../fixed_assets/fixed_assets.module";
import { PayrollModule } from "../payroll/payroll.module";
import { ItemsModule } from "../items/items.module";
import { CrmModule } from "../crm/crm.module";
import { BudgetingModule } from "../budgeting/budgeting.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { ConfigurationModule } from "../configuration/configuration.module";
import { InventoryModule } from "../inventory/inventory.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { SalesModule } from "../sales/sales.module";
import { TaxModule } from "../tax/tax.module";
import { ImportToolkitService } from "./application/import-toolkit-service";
import { MappingsService } from "./application/mappings-service";
import { DemoDataService } from "./application/demo-data-service";
import { SandboxService } from "./application/sandbox-service";
import { ImportsController } from "./presentation/imports.controller";
import { DemoDataController } from "./presentation/demo-data.controller";
import { SandboxController } from "./presentation/sandbox.controller";

/**
 * PHASE-040 data onboarding & migration toolkit (§2): the seven-kind import
 * engine (COA, ACCOUNT_OPENING_BALANCES, FIXED_ASSETS, EMPLOYEES,
 * PRICE_LISTS, CONTRACTS, BUDGETS) with the BR-066 dry-run → atomic-commit
 * gate, the column-mapping wizard API, saved mappings (both directions),
 * the migration adapters (T-05), the demo-data loader (T-06) and sandbox
 * provisioning (T-07 — the platform-plane route lands with that task).
 *
 * The engines apply every row through the REAL module services (CoaService,
 * the partners opening engine, AssetService, EmployeeService,
 * PriceListService, ContractService, the PHASE-028 budgeting import; the
 * demo loader rides the workspace provisioning, the apply engine, the
 * posting engine, the sales/receipt lifecycles) — no raw inserts, no
 * journal bypass — which is why this module imports (and consumes exports
 * of) the owning modules.
 */
@Module({
  imports: [
    InfrastructureModule,
    AuditModule,
    FilesModule,
    // PHASE-040 T-07: the sandbox owner's one-time credential is hashed with
    // the identity module's PasswordService (the registration-service
    // precedent — the same password discipline as a real signup).
    IdentityModule,
    AccountingModule,
    PartnersModule,
    FixedAssetsModule,
    PayrollModule,
    ItemsModule,
    CrmModule,
    BudgetingModule,
    TenancyModule,
    ConfigurationModule,
    InventoryModule,
    TreasuryModule,
    SalesModule,
    TaxModule,
  ],
  controllers: [ImportsController, DemoDataController, SandboxController],
  providers: [ImportToolkitService, MappingsService, DemoDataService, SandboxService],
  exports: [ImportToolkitService, MappingsService, DemoDataService, SandboxService],
})
export class OnboardingModule {}
