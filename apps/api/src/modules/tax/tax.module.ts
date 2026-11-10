import { Inject, Module, type OnModuleInit } from "@nestjs/common";

import { AccountingModule } from "../accounting/accounting.module";
import { AuditModule } from "../audit/audit.module";
import { FilesModule } from "../files/files.module";
import { TaxCodesService } from "./application/codes-service";
import { RegistrationService } from "./application/registration-service";
import { TaxResolverService } from "./application/tax-resolver-service";
import { VatReturnService } from "./application/vat-return-service";
import { PackService } from "./application/pack-service";
import { EInvoicingService } from "./application/einvoicing-service";
import { TaxReconciliationService } from "./application/tax-reconciliation-service";
import { ZatcaPhase1Service } from "./application/zatca/zatca-phase1-service";
import { SubmissionRegistryService } from "./submissions/registry-service";
import { registerSubmissionJobs } from "./submissions/jobs";
import { registerZatcaBackfillJob } from "./infrastructure/zatca-backfill.job";
import { getBoss } from "../../infra/jobs/boss";
import { TaxController } from "./presentation/tax.controller";

/**
 * Tax module (PHASE-009): the six-treatment engine, jurisdiction packs
 * (global read-only reference data — ADR-0010/ADR-0005 §3), tenant tax
 * codes + registrations, deterministic line→tax resolution with rate
 * snapshots (BR-033), the inclusive/exclusive pricing policy, the
 * NOT_REGISTERED / NO_VAT modes, the VAT return v1 with the INV-012
 * cross-check, and the EInvoicingAdapter port + fake adapter.
 *
 * PHASE-023 additions: the OPERATIONAL submission registry (state machine
 * + encrypted artifacts + pg-boss pipeline + monitoring —
 * submissions/registry-service), the certificate S-10 registry
 * (certs/certificate-service), the per-tenant rollout flags
 * (rollout/adapter-settings, default OFF), and the ZATCA UNVERIFIED
 * refusing stub (adapters/zatca — the RISK-005 discipline: no adapter
 * ships against unverified official specs; DR-001 OPEN).
 *
 * PHASE-037 additions: the ZATCA Phase-1 GENERATION service
 * (application/zatca — the TLV QR payload, the ICV/PIH chain, the
 * verification walk, the backfill) — ZERO external calls; the adapter
 * file evolves to the honest GENERATION mode (BR-061) while the
 * Phase-2 submission surface stays a typed NOT_IMPLEMENTED (054).
 *
 * Dependencies (DEPENDENCY_RULES §2; the phase §4): accounting (posting
 * engine, purposes — tax posts only via the engine, ADR-0007) + audit +
 * files (encrypted submission artifacts + VAT return exports). Consumed BY
 * treasury (the G-11 expense leg), then sales/purchasing from their
 * phases via the published resolver + snapshot/summary contracts. Pack
 * tables are seed-only: the module NEVER writes
 * jurisdictions/jurisdiction_tax_rates.
 */
@Module({
  imports: [AccountingModule, AuditModule, FilesModule],
  controllers: [TaxController],
  providers: [
    TaxResolverService,
    TaxCodesService,
    RegistrationService,
    VatReturnService,
    PackService,
    EInvoicingService,
    TaxReconciliationService,
    SubmissionRegistryService,
    // PHASE-037: the ZATCA Phase-1 GENERATION service (devices + chain
    // stamping + verification + backfill) — exported for the sales module
    // (the invoice post stamps through it) and the controller routes.
    ZatcaPhase1Service,
  ],
  exports: [
    TaxResolverService,
    TaxCodesService,
    RegistrationService,
    VatReturnService,
    PackService,
    EInvoicingService,
    TaxReconciliationService,
    SubmissionRegistryService,
    ZatcaPhase1Service,
  ],
})
export class TaxModule implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // PHASE-023 T2/T13: the submission pipeline + monitoring jobs register
    // on module boot (the ZATCA stub is registered by the registry service
    // itself — T4). Registration failure degrades the async pipeline,
    // never module boot (the API surface stays up — circuit-breaker
    // discipline); the queue schedules are idempotent replaces.
    await registerSubmissionJobs().catch((error) => {
      void error;
    });
    // PHASE-037 T-08: the daily chain backfill sweep (3:15 UTC) — the
    // same degraded-boot discipline (registration failure never takes
    // the module down; schedules are idempotent replaces).
    await registerZatcaBackfillJob(getBoss(), this.zatca).catch((error) => {
      void error;
    });
  }

  constructor(@Inject(ZatcaPhase1Service) private readonly zatca: ZatcaPhase1Service) {}
}
