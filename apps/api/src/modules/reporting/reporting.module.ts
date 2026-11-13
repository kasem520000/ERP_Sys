import { Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { FilesModule } from "../files/files.module";
import { IdentityModule } from "../identity/identity.module";
import { PartnersModule } from "../partners/partners.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { SalesModule } from "../sales/sales.module";
import { TaxModule } from "../tax/tax.module";
import { TenancyModule } from "../tenancy/tenancy.module";
import { TreasuryModule } from "../treasury/treasury.module";
import { JobsService } from "../../infra/jobs/boss";
import { getBoss } from "../../infra/jobs/boss";
import { effectivePermissions } from "../identity/infrastructure/identity.store";
import {
  RunService,
  REPORT_JOB_QUEUE,
  REPORT_JOB_ENQUEUER_TOKEN,
  type ReportJobEnqueuer,
} from "./application/run-service";
import { ExportService } from "./application/export/export-service";
import { ReportingController } from "./presentation/reporting.controller";
import { REPORT_CONTRACTS } from "./registry";
import { validateRegistry } from "./registry/runtime";
import { ContractValidationError } from "./domain/reporting-errors";
import { setRenderEngine, getRenderEngine } from "./application/render/engine-holder";
import { ChromiumRenderEngine } from "./application/render/render-engine";
import { withTenant } from "../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../infra/settings/setting-reader";

/**
 * PHASE-013 · the reporting module (ADR-0011; REPORTING_ARCHITECTURE §1):
 * the contract registry + execution orchestration + exports + print
 * templates. It owns ONLY report_runs/print_templates (migration 0020) —
 * all business truth is read through the imported modules' published
 * query services (RISK-016); nothing depends on reporting except the UI.
 *
 * Boot rule (§2): the registry validates every contract at boot — a
 * malformed contract fails startup (meta-tested). The known-permission
 * set is asserted against the seeded catalog by the registry meta-tests
 * (permissions-drift keeps the seed ↔ matrix parity).
 */

const KNOWN_PERMISSION_KEYS: ReadonlySet<string> = new Set([
  "reporting.reports.run",
  "reporting.reports.export",
  "reporting.templates.manage",
  "reports.financial.tb.read",
  "reports.financial.gl.read",
  "reports.financial.is.read",
  "reports.financial.bs.read",
  "reports.financial.cf.read",
  "reports.financial.close.read",
  "reports.accounting.cost-centers.read",
  "accounting.journals.read",
  "reports.ar.aging.read",
  "reports.ap.aging.read",
  "sales.statements.read",
  "purchasing.statements.read",
  "reports.ar-alloc.read",
  "partners.balances.read",
  "reports.sales.by-item.read",
  "reports.sales.by-customer.read",
  "reports.sales.by-rep.read",
  "reports.sales.by-paymethod.read",
  "reports.sales.pipeline.read",
  "reports.sales.by-branch.read",
  "reports.sales.profitability.read",
  "reports.purchasing.by-supplier.read",
  "reports.purchasing.by-item.read",
  "reports.purchasing.grni.read",
  "purchasing.po.read",
  "reports.purchasing.matching.read",
  "inventory.stock.read",
  "inventory.moves.read",
  "inventory.valuation.read",
  "inventory.batches.read",
  "inventory.counts.read",
  "inventory.serials.read",
  "treasury.cash.read",
  "treasury.receipts.read",
  "treasury.payments.read",
  "treasury.petty.read",
  "treasury.expenses.read",
  "treasury.shifts.read",
  "treasury.bankrec.read",
  "reports.treasury.fx.read",
  "reports.tax.vat-return.read",
  "reports.tax.summary.read",
  // PHASE-035 T-06: the e-invoicing submission-log report rides the module's
  // existing e-invoicing permission (the §12 module-register convention —
  // same key as every /tax/einvoicing route; zero-drift stays 245=245).
  "tax.einvoicing.manage",
  // PHASE-036 (recorded 034-tree repair): the restored-lineage consolidation
  // report contracts (consolidated TB/IS/BS + the eliminations log) ride
  // consolidation.reports.view — seeded by 0004 §x since PHASE-034 but
  // missing from this boot-time known set (the 035 evidence run covered
  // only its spec subset, so the boot rule never fired on a full-suite
  // boot; crm/billing and the other AppModule-booting specs surfaced it).
  "consolidation.reports.view",
  "platform.audit.read",
  "platform.users.read",
  "platform.reporting.read",
  "platform.tenants.read",
  // PHASE-018 (0026 seed): the manufacturing report keys
  "manufacturing.costing.read",
  "manufacturing.genealogy.read",
  "manufacturing.qc.manage",
  // PHASE-042 (0065 seed): the OEE reports' key (the work-center
  // utilization + downtime-analysis contracts)
  "manufacturing.oee.read",
  // PHASE-019 (0027 seed): the CRM services report key
  "crm.contracts.manage",
  // PHASE-026 (0037 seed): the fixed-assets report keys
  "fixed_assets.reports.view",
  // PHASE-027 (0038 seed): the notes/installments report keys
  "notes.notes.view",
  "installments.plans.view",
  // PHASE-028 (0004 pre-seeded §3.13): the budgeting report key
  "budgeting.reports.view",
  // PHASE-029 (0004 pre-seeded §3.14): the payroll report key
  "payroll.reports.view",
  // PHASE-038 (0051 §9 seed): the sourcing report keys ride the RFQ read
  // permission (the §12 module-register convention — both contracts gate on
  // the same `purchasing.rfqs.read` key as the /purchasing/rfq routes).
  "purchasing.rfqs.read",
  // PHASE-039 (0056 §9 seed): the returns + collections report keys ride
  // their route permissions (the same §12 convention — the RMA register
  // gates on sales.rma.read like the /sales/returns routes; the dunning
  // status worklist on sales.dunning.manage like the dunning routes).
  "sales.rma.read",
  "sales.dunning.manage",
  // PHASE-041 (0064 seed): the communications report key — the delivery
  // log gates on communication.outbox.read (the same §12 convention —
  // the key the outbox ledger's read surface rides).
  "communication.outbox.read",
  // PHASE-042 (0065 seed): the manufacturing-execution report keys — the
  // utilization/OEE + downtime-analysis contracts gate on the OEE read key
  // the /manufacturing/oee route rides (the same §12 convention); the
  // rework-cost + cost-variance contracts ride the 0026 costing key.
  "manufacturing.oee.read",
  // PHASE-044 (0071 seed, matrix §3.21): the WMS intelligence report keys
  // — bin-contents rides the locations key, the cycle-count variance the
  // cycle_counts key, and the ABC classification the analysis-tier abc key
  // (the same §12 convention — the keys the /inventory/wms routes ride).
  "inventory.wms.locations",
  "inventory.cycle_counts",
  "inventory.abc",
]);

@Module({
  imports: [
    AccountingModule,
    AuditModule,
    FilesModule,
    IdentityModule,
    InventoryModule,
    PartnersModule,
    PurchasingModule,
    SalesModule,
    TaxModule,
    TenancyModule,
    TreasuryModule,
  ],
  controllers: [ReportingController],
  providers: [
    RunService,
    ExportService,
    {
      provide: REPORT_JOB_ENQUEUER_TOKEN,
      useFactory: (jobs: JobsService): ReportJobEnqueuer => {
        return async (input) => {
          await jobs.publish(input.queue, input.payload as never, { jobId: input.jobId });
        };
      },
      inject: [JobsService],
    },
    {
      provide: "REPORTING_RUN_SERVICE",
      useExisting: RunService,
    },
    {
      provide: "REPORTING_EXPORT_SERVICE",
      useExisting: ExportService,
    },
  ],
  exports: [RunService, ExportService, "REPORTING_RUN_SERVICE", "REPORTING_EXPORT_SERVICE"],
})
export class ReportingModule implements OnModuleDestroy, OnModuleInit {
  private jobsBound = false;

  onModuleInit(): void {
    // Boot-time registry validation (§2.1): a malformed contract, an
    // unknown permission, or a duplicate id fails startup.
    const result = validateRegistry([...REPORT_CONTRACTS], {
      knownPermissions: KNOWN_PERMISSION_KEYS,
    });
    if (!result.ok) {
      throw new ContractValidationError(
        "registry",
        `${result.errors.length} contract problems: ${result.errors.slice(0, 5).join("; ")}`,
      );
    }
    setRenderEngine(new ChromiumRenderEngine());
    void this.subscribeReportJobs();
  }

  async onModuleDestroy(): Promise<void> {
    const engine = getRenderEngine();
    if (engine instanceof ChromiumRenderEngine) {
      await engine.close().catch(() => undefined);
    }
  }

  /** The pg-boss worker subscription (both API and WORKER_MODE entries). */
  private async subscribeReportJobs(): Promise<void> {
    if (this.jobsBound) {
      return;
    }
    this.jobsBound = true;
    const boss = getBoss();
    await boss.createQueue(REPORT_JOB_QUEUE);
    await boss.work<{ tenantId: string; runId: string; reportKey: string; userId: string | null }>(
      REPORT_JOB_QUEUE,
      async (jobs) => {
        for (const job of jobs) {
          await this.handleReportJob(job.data);
        }
      },
    );
  }

  /** The job handler: permission re-resolution at execution (no TOCTOU). */
  private async handleReportJob(payload: {
    tenantId: string;
    runId: string;
    reportKey: string;
    userId: string | null;
  }): Promise<void> {
    const runs = new RunService(async (input) => {
      const boss = getBoss();
      await boss.send(input.queue, input.payload as never, { jobId: input.jobId } as never);
    });
    await withTenant(payload.tenantId, async () => {
      const permissions = await effectivePermissions(
        payload.userId ?? "00000000-0000-0000-0000-000000000000",
        payload.tenantId,
      );
      await runs.executeJob({
        runId: payload.runId,
        reportKey: payload.reportKey,
        permissions,
        tenantId: payload.tenantId,
        userId: payload.userId,
        baseCurrency: await ownTenantBaseCurrency(),
        effectiveBranchIds: null,
      });
    });
  }
}
