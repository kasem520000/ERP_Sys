import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

import { HealthController } from "./health/health.controller";
import { ReadinessService } from "./health/readiness.service";
import { InfrastructureModule } from "./infra/infra.module";
import { RequestIdMiddleware } from "./infra/observability/request-id.middleware";
import { SessionMiddleware } from "./infra/auth/session.middleware";
import { SecurityHeadersMiddleware } from "./infra/http/security-headers.middleware";
import { TenantRateLimitMiddleware } from "./infra/http/tenant-rate-limit.middleware";
import { MetricsMiddleware } from "./infra/http/metrics.middleware";
import { PermissionsGuard } from "./infra/auth/permissions.guard";
import { TenantContextInterceptor } from "./infra/context/tenant-context.interceptor";
import { ErrorModelFilter } from "./infra/http/error.filter";
import { IdempotencyKeyGuard } from "./infra/http/idempotency.guard";
import { AuditModule } from "./modules/audit/audit.module";
import { FilesModule } from "./modules/files/files.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ConfigurationModule } from "./modules/configuration/configuration.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";
import { PartnersModule } from "./modules/partners/partners.module";
import { ItemsModule } from "./modules/items/items.module";
import { AccountingModule } from "./modules/accounting/accounting.module";
import { TreasuryModule } from "./modules/treasury/treasury.module";
import { TaxModule } from "./modules/tax/tax.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { PurchasingModule } from "./modules/purchasing/purchasing.module";
import { FixedAssetsModule } from "./modules/fixed_assets/fixed_assets.module";
import { NotesModule } from "./modules/notes/notes.module";
import { InstallmentsModule } from "./modules/installments/installments.module";
// PHASE-028/029 (restored lineage): the budgeting + payroll modules.
import { BudgetingModule } from "./modules/budgeting/budgeting.module";
import { PayrollModule } from "./modules/payroll/payroll.module";
// PHASE-034: the consolidation module (ADR-0018 / DR-006 option A — the
// final roadmap phase, stage 11 / the Enterprise Depth gate).
import { ConsolidationModule } from "./modules/consolidation/consolidation.module";
import { SalesModule } from "./modules/sales/sales.module";
import { DistributionModule } from "./modules/distribution/distribution.module";
import { ManufacturingModule } from "./modules/manufacturing/manufacturing.module";
import { CrmModule } from "./modules/crm/crm.module";
import { CommissionsModule } from "./modules/sales/commissions.module";
import { ReportingModule } from "./modules/reporting/reporting.module";
import { PosModule } from "./modules/pos/pos.module";
import { SyncModule } from "./modules/sync/sync.module";
import { AuditEventsController } from "./modules/audit/presentation/audit-events.controller";
import { FeatureEntitlementsGuard } from "./infra/auth/feature-entitlements.guard";
import { UsageLimitGuard } from "./infra/auth/usage-limit.guard";

/**
 * PHASE-007 module graph: the previous substrates + the accounting core —
 * the posting engine (ADR-0007), fiscal calendar, GL queries, manual +
 * recurring journals with approvals, numbering, opening-balances posting,
 * year-end close, and the AR/AP reconciliation framework. The
 * partner-subledger port binding lives in AccountingModule (Nest module
 * scoping) — see there for the seam rationale.
 */
@Module({
  imports: [
    InfrastructureModule,
    AuditModule,
    FilesModule,
    IdentityModule,
    NotificationsModule,
    ConfigurationModule,
    TenancyModule,
    PartnersModule,
    ItemsModule,
    AccountingModule,
    TreasuryModule,
    TaxModule,
    InventoryModule,
    PurchasingModule,
    FixedAssetsModule,
    NotesModule,
    InstallmentsModule,
    BudgetingModule,
    PayrollModule,
    ConsolidationModule,
    SalesModule,
    DistributionModule,
    ManufacturingModule,
    CrmModule,
    CommissionsModule,
    ReportingModule,
    PosModule,
    SyncModule,
  ],
  controllers: [HealthController, AuditEventsController],
  providers: [
    ReadinessService,
    { provide: APP_FILTER, useClass: ErrorModelFilter },
    { provide: APP_GUARD, useClass: IdempotencyKeyGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureEntitlementsGuard },
    { provide: APP_GUARD, useClass: UsageLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * PHASE-024 (SECURITY_TEST_PLAN §3): the RLS denial canary — every 5
   * minutes, known-bad no-GUC counts over the crown-jewel tables; the
   * erp_rls_denials_total counter must stay 0 (any breach is auto-SEV-1).
   */
  async onModuleInit(): Promise<void> {
    try {
      const { getBoss } = await import("./infra/jobs/boss");
      const {
        SECURITY_RLS_CANARY_CRON,
        SECURITY_RLS_CANARY_QUEUE,
        runRlsCanary,
      } = await import("./infra/security/rls-canary");
      const boss = getBoss();
      await boss.createQueue(SECURITY_RLS_CANARY_QUEUE).catch(() => undefined);
      await boss.work(SECURITY_RLS_CANARY_QUEUE, async (jobs) => {
        for (let index = 0; index < jobs.length; index += 1) {
          await runRlsCanary();
        }
      });
      await boss
        .schedule(SECURITY_RLS_CANARY_QUEUE, SECURITY_RLS_CANARY_CRON, { system: true })
        .catch(() => undefined);
    } catch {
      // Worker-mode / no-queue environments: the canary also runs inside
      // the DB suite (the spec asserts 0 breaches on a seeded stack).
    }
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes("*")
      // PHASE-025 T9b: the API golden-signals source (MONITORING §1) —
      // request/error counters + latency samples per route group into the
      // in-process registry (SF-024-021 substrate; the OTel exporter swap
      // picks the names up). Mounted right after the request-id scope so
      // both span the same requests; it never short-circuits.
      .apply(MetricsMiddleware)
      .forRoutes("*")
      // PHASE-024 T9: security headers run BEFORE anything that can
      // short-circuit a response (the session 423 gate, the tenant 429
      // below) — headers set before next() ride along on those too.
      .apply(SecurityHeadersMiddleware)
      .forRoutes("*")
      .apply(SessionMiddleware)
      .forRoutes("*")
      // PHASE-024 T5 (R-04): the per-tenant burst limiter. Registered
      // AFTER the session middleware block on purpose: it resolves the
      // tenant with its OWN indexed lookup (token-hash → active tenant),
      // so it is functionally order-independent of SessionMiddleware —
      // this slot just keeps the throttle as the last gate before the
      // guards, wrapping every tenant-scoped request with quota headers.
      .apply(TenantRateLimitMiddleware)
      .forRoutes("*");
  }
}
