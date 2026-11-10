import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ResolveEffectiveConfigService } from "../../configuration/application/resolve/resolve-service";
import { RESOLVE_EFFECTIVE_CONFIG_SERVICE } from "../../configuration/application/resolve/resolve-service";
import { SalesInvoiceService, POLICY_ACTOR_ID } from "../../sales/application/invoices";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { ContractService } from "./contract-service";
import { ContractInputInvalidError } from "../domain/crm-errors";
import * as store from "../infrastructure/crm.store";

/**
 * Billing-run service (PHASE-019 T47; MASTER-PLAN §5 — the phase's
 * correctness core): the recurring DRAFT generator over ACTIVE contracts.
 * Per due PLANNED schedule entry (billDate ≤ asOf, NO contract_invoices
 * guard row) it drafts ONE sales invoice through the ordinary
 * SalesInvoiceService.create (kind CREDIT, the §11 provenance trio, the
 * POLICY actor), inserts the guard row (the two partial uniques make
 * concurrent double-fire a graceful duplicate skip — INV-013), flips the
 * schedule entry INVOICED, stamps pulled time entries BILLED, and honors
 * the approval policy: crm.invoice_approval_required false ⇒ auto-SUBMIT
 * (PENDING_APPROVAL), true ⇒ stays DRAFT — **NEVER auto-post** (BR-034 SoD;
 * the run's POLICY_ACTOR drafts cannot self-approve).
 *
 * Period locks (INV-011): entries whose billDate sits in a LOCKED period —
 * or in NO period at all — are skipped + listed as `periodLocked` (the run
 * refuses to create dead drafts); SOFT_CLOSED drafts are created and carry
 * their periodStatus in the result (the BR-030 posture, noted not blocked).
 *
 * Idempotency nets (INV-013): the contract_invoices partial uniques at
 * generation (per-entry SAVEPOINT — a concurrent duplicate rolls back to
 * the savepoint, discarding just that draft, and is recorded) + the
 * sales_invoice:post source key at posting. Run history rides audit_events
 * (`crm.billing_run`) — migration 0027 is frozen, NO billing_runs table
 * (the documented §5 choice); the summary audit's entity anchors on the
 * first draft, else the first scanned contract, else a fresh uuid (the
 * NOT-NULL entity_id discipline — the reservations-swept precedent).
 *
 * The tax posture: the create flow resolves VAT ONLY from an explicit line
 * taxCodeId, so the run resolves each fee line's tax code from the fee
 * ITEM's stored tax_code_id (the job-card pattern — the source row's tax
 * code rides the generated line; §15's 15% golden). An item with no tax
 * code bills VAT-free (the honest absence).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

/** One generated draft of a run result (the §5 result shape). */
export interface BillingRunDraft {
  contractId: string;
  invoiceId: string;
  entryId: string;
  periodKey: string | null;
  milestoneScheduleId: string | null;
  status: string;
  periodStatus: string;
}

export interface BillingRunResult {
  asOf: string;
  contractsScanned: number;
  draftsCreated: BillingRunDraft[];
  skippedLocked: readonly {
    contractId: string;
    entryId: string;
    periodKey: string | null;
    billDate: string;
    periodStatus: string;
  }[];
  skippedDuplicate: readonly { contractId: string; entryId: string; periodKey: string | null }[];
  needsNarrative: readonly {
    contractId: string;
    entryId: string;
    timeEntryId: string;
    entryDate: string;
    hours: string;
  }[];
}

/** The tenant-wide dry-run (§5 preview — read-only, no rows written). */
export interface BillingPreviewResult {
  asOf: string;
  contracts: readonly {
    contractId: string;
    items: readonly import("./contract-service").ContractBillingPreviewItem[];
  }[];
}

@Injectable()
export class BillingRunService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(RESOLVE_EFFECTIVE_CONFIG_SERVICE)
    private readonly resolveConfig: ResolveEffectiveConfigService,
  ) {}

  /**
   * The recurring run (§5): iterates ACTIVE contracts (startDate ≤ asOf);
   * per due PLANNED entry with NO guard row → one DRAFT invoice + guard +
   * INVOICED flip + (HOURLY) BILLED stamps + per-invoice audit
   * `crm.contract_invoice_generated`; the summary audit `crm.billing_run`
   * rides at the end. Runs inside the caller's ambient tenant UoW (the
   * HTTP interceptor's or the sweep job's withTenant) — per-entry
   * SAVEPOINTs isolate duplicates; any other failure rolls the whole run
   * back (fail-closed, zero partial residue).
   */
  async run(input: { asOf: string; actorId: string | null }): Promise<BillingRunResult> {
    const asOf = input.asOf;
    if (!DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw new ContractInputInvalidError(`asOf must be an ISO calendar date (YYYY-MM-DD): ${asOf}`);
    }
    const ctx = requireTenantContext();
    const tx = ctx.tx;
    if (tx === undefined) {
      throw new Error("billing run requires an ambient tenant transaction");
    }

    const branch = await store.findMainBranchForCrm();
    if (branch === undefined) {
      throw new ContractInputInvalidError(
        "the tenant has no active branch — the billing run cannot draft invoices (resolve a MAIN branch first)",
      );
    }

    const tenantId = ctx.tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    const approvalRequired = config.policies["crm.invoice_approval_required"] !== false;

    const draftsCreated: BillingRunDraft[] = [];
    const skippedLocked: {
      contractId: string;
      entryId: string;
      periodKey: string | null;
      billDate: string;
      periodStatus: string;
    }[] = [];
    const skippedDuplicate: { contractId: string; entryId: string; periodKey: string | null }[] = [];
    const needsNarrative: {
      contractId: string;
      entryId: string;
      timeEntryId: string;
      entryDate: string;
      hours: string;
    }[] = [];
    let contractsScanned = 0;
    let firstDraftId: string | undefined;
    let firstContractId: string | undefined;

    const active = await store.listContracts({ status: "ACTIVE", limit: 1000 });
    for (const contract of active) {
      if (contract.startDate > asOf) continue;
      contractsScanned += 1;
      firstContractId ??= contract.id;

      // The preview IS the run's decision substrate (§5 + the T46 handoff):
      // due PLANNED entries (billDate ≤ asOf, no guard row) with their
      // would-invoice lines, pullable sets, needsNarrative + period posture.
      const preview = await this.contracts.billingPreview(contract.id, asOf);
      for (const item of preview.items) {
        const entry = item.entry;
        const periodKeyLabel = entry.periodKey ?? entry.milestoneLabel ?? entry.billDate;

        // INV-011 discipline: LOCKED (or uncovered) billDates never draft.
        if (item.periodLocked || item.periodStatus === "NONE") {
          skippedLocked.push({
            contractId: contract.id,
            entryId: entry.id,
            periodKey: entry.periodKey,
            billDate: entry.billDate,
            periodStatus: item.periodStatus,
          });
          continue;
        }

        // Narrative-less pullable entries are listed, never silently billed
        // (§5); they stay APPROVED for a later run once narrated.
        for (const slip of item.needsNarrative) {
          needsNarrative.push({
            contractId: contract.id,
            entryId: entry.id,
            timeEntryId: slip.id,
            entryDate: slip.entryDate,
            hours: slip.hours,
          });
        }

        // HOURLY periods with nothing billable now create no empty drafts —
        // the entry stays PLANNED and is retried by the next run (time may
        // still land or get its narrative).
        if (item.wouldInvoice.length === 0) continue;

        const lines = [];
        for (const would of item.wouldInvoice) {
          lines.push({
            itemId: would.feeItemId,
            accountId: null,
            deliveryLineId: null,
            description: would.description,
            descriptionAr: null,
            qty: would.qty,
            unitPrice: would.unitPrice ?? "0",
            discountAmount: null,
            taxCodeId: (await store.findItemTaxCodeForCrm(would.feeItemId)) ?? null,
            batchId: null,
            serialIds: null,
            note: null,
          });
        }

        // Per-entry SAVEPOINT: a concurrent duplicate (the guard's partial
        // uniques) rolls back to here — discarding exactly this draft — and
        // is recorded; any other failure rethrows (fail-closed run).
        await tx.execute(sql`SAVEPOINT crm_billing_entry`);
        try {
          const invoice = await this.invoices.create({
            branchId: branch.id,
            customerId: contract.partnerId,
            salesRepId: null,
            kind: "CREDIT",
            invoiceDate: entry.billDate,
            dueDate: null, // BR-026: the customer's terms from the invoice date
            currencyCode: contract.currencyCode,
            exchangeRate: null,
            orderId: null,
            deliveryId: null,
            warehouseId: null,
            cashAccountId: null,
            contractId: contract.id,
            projectId: contract.projectId,
            note: `Contract ${contract.contractNo ?? contract.id} period ${periodKeyLabel}`,
            noteAr: null,
            actorId: POLICY_ACTOR_ID,
            lines,
          });
          await store.insertContractInvoice({
            contractId: contract.id,
            invoiceId: invoice.id,
            periodKey: entry.periodKey,
            milestoneScheduleId: entry.entryType === "MILESTONE" ? entry.id : null,
            actorId: POLICY_ACTOR_ID,
          });
          await store.patchScheduleEntry({ id: entry.id, status: "INVOICED", invoiceId: invoice.id });
          if (entry.entryType === "HOURLY_PERIOD") {
            const skippedSlips = new Set(item.needsNarrative.map((slip) => slip.id));
            for (const slip of item.pullableTimeEntries) {
              if (skippedSlips.has(slip.id)) continue;
              await store.markTimeEntryBilled({ id: slip.id, billedInvoiceId: invoice.id });
            }
          }
          let status = invoice.status;
          if (!approvalRequired) {
            const submitted = await this.invoices.submit(invoice.id, POLICY_ACTOR_ID);
            status = submitted.status;
          }
          await this.audit.record({
            action: "crm.contract_invoice_generated",
            entityType: "sales_invoice",
            entityId: invoice.id,
            actorId: input.actorId ?? undefined,
            after: {
              contractId: contract.id,
              scheduleEntryId: entry.id,
              periodKey: entry.periodKey,
              milestoneScheduleId: entry.entryType === "MILESTONE" ? entry.id : null,
              totalNet: invoice.totalNet,
              totalGross: invoice.totalGross,
              submitted: !approvalRequired,
            },
          });
          firstDraftId ??= invoice.id;
          draftsCreated.push({
            contractId: contract.id,
            invoiceId: invoice.id,
            entryId: entry.id,
            periodKey: entry.periodKey,
            milestoneScheduleId: entry.entryType === "MILESTONE" ? entry.id : null,
            status,
            periodStatus: item.periodStatus,
          });
        } catch (error) {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT crm_billing_entry`);
          if (isUniqueViolation(error)) {
            skippedDuplicate.push({
              contractId: contract.id,
              entryId: entry.id,
              periodKey: entry.periodKey,
            });
            continue;
          }
          throw error;
        }
        await tx.execute(sql`RELEASE SAVEPOINT crm_billing_entry`);
      }
    }

    await this.audit.record({
      action: "crm.billing_run",
      entityType: "billing_run",
      entityId: firstDraftId ?? firstContractId ?? generateUuidV7(),
      actorId: input.actorId ?? undefined,
      after: {
        asOf,
        contractsScanned,
        draftsCreated: draftsCreated.length,
        skippedLocked: skippedLocked.length,
        skippedDuplicate: skippedDuplicate.length,
        needsNarrative: needsNarrative.length,
        drafts: draftsCreated.map((draft) => draft.invoiceId),
      },
    });

    return { asOf, contractsScanned, draftsCreated, skippedLocked, skippedDuplicate, needsNarrative };
  }

  /**
   * The tenant-wide dry-run (§5): ContractService.billingPreview across
   * every ACTIVE contract (startDate ≤ asOf) — read-only, no rows written.
   */
  async preview(input: { asOf: string }): Promise<BillingPreviewResult> {
    const asOf = input.asOf;
    if (!DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw new ContractInputInvalidError(`asOf must be an ISO calendar date (YYYY-MM-DD): ${asOf}`);
    }
    const contracts: BillingPreviewResult["contracts"][number][] = [];
    for (const contract of await store.listContracts({ status: "ACTIVE", limit: 1000 })) {
      if (contract.startDate > asOf) continue;
      const preview = await this.contracts.billingPreview(contract.id, asOf);
      contracts.push({ contractId: contract.id, items: preview.items });
    }
    return { asOf, contracts };
  }

  /**
   * Run history (§5 rows #30): the `crm.billing_run` audit events, newest
   * first (NO billing_runs table — the documented choice over audit_events).
   */
  async listRuns(limit: number): Promise<
    readonly { id: string; at: string; actorId: string | null; summary: unknown }[]
  > {
    const rows = await this.audit.list({ action: "crm.billing_run", limit });
    // The store lists ascending — the history surface is newest-first.
    return rows
      .map((row) => ({ id: row.id, at: row.at, actorId: row.actorId, summary: row.after }))
      .reverse();
  }

  /**
   * The monthly sweep (§5 + the pg-boss job `crm.contract-billing-run`, cron
   * 0 3 1 * *): one run per ACTIVE tenant with asOf = today, actorId = null
   * (the sweepAllReminders contract — per-tenant UoW so each tenant's run
   * commits atomically; idempotent by the contract_invoices guards, so a
   * retried sweep re-runs tenants harmlessly).
   */
  async sweepAllTenants(): Promise<{ tenants: number; drafts: number }> {
    const tenantIds = await listActiveTenantIds();
    let drafts = 0;
    for (const tenantId of tenantIds) {
      const result = await withTenant(tenantId, async () =>
        this.run({ asOf: today(), actorId: null }),
      );
      drafts += result.draftsCreated.length;
    }
    return { tenants: tenantIds.length, drafts };
  }
}
