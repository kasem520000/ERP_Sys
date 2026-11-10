import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { AuditService } from "../../audit/api/audit";
import { EMAIL_SERVICE } from "../../notifications/notifications.module";
import { type EmailService } from "../../notifications/application/email-service";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/sales.store";
import { SalesRepNotFoundError } from "../domain/sales-errors";

/**
 * Sales-rep service (PHASE-012 T12; §2.10): the rep registry + attribution
 * surface. Commissions are explicitly PHASE-017 scope — NO commission
 * computation exists here (the phase's grep-clean scope guard). Rep
 * attribution travels on the documents (sales_rep_id) and into the journal
 * memos at post time (each posting service reads the rep for the memo).
 */

@Injectable()
export class SalesRepService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { status?: string; limit: number }) {
    return store.listSalesReps(filter);
  }

  async find(id: string) {
    const rep = await store.findSalesRepById(id);
    if (rep === undefined) throw new SalesRepNotFoundError(id);
    return rep;
  }

  async create(input: {
    code: string;
    name: string;
    nameAr: string | null;
    email: string | null;
    phone: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const created = await store.insertSalesRep(input);
    await this.audit.record({
      action: "sales.rep_created",
      entityType: "sales_rep",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, name: created.name },
    });
    return created;
  }

  async activate(id: string, actorId: string | null) {
    await this.find(id);
    await store.updateSalesRepStatus({ id, status: "ACTIVE", actorId });
    await this.audit.record({
      action: "sales.rep_activated",
      entityType: "sales_rep",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return store.findSalesRepById(id);
  }

  async deactivate(id: string, actorId: string | null) {
    await this.find(id);
    await store.updateSalesRepStatus({ id, status: "INACTIVE", actorId });
    await this.audit.record({
      action: "sales.rep_deactivated",
      entityType: "sales_rep",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return store.findSalesRepById(id);
  }
}

/**
 * The invoice.overdue job (PHASE-012 T11; §2.9): the nightly scan over
 * POSTED credit invoices past due with outstanding AR — each fires ONE
 * `sales.invoice_overdue` notification per invoice (the exactly-once
 * discipline rides the audit_events existence check) + the per-tenant
 * digest email to the owner. Alert, NOT dunning: no documents are created.
 */
@Injectable()
export class InvoiceOverdueService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {}

  async runOverdueScan(input: {
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }): Promise<{ overdue: number; alerted: number; recipient: string | null }> {
    const today = new Date().toISOString().slice(0, 10);
    const candidates = await store.overdueInvoiceCandidates(today);
    if (candidates.length === 0) {
      return { overdue: 0, alerted: 0, recipient: null };
    }

    const context = requireTenantContext();
    const recipient = await this.ownerEmail();

    const items = candidates
      .slice(0, 50)
      .map(
        (row) =>
          `${row.invoiceNo ?? row.invoiceId} — ${row.outstanding} ${row.currencyCode} (due ${row.dueDate})`,
      )
      .join("\n");
    if (recipient !== null) {
      await this.email.enqueue(context.tenantId, {
        template: "invoice_overdue",
        locale: "ar",
        recipient,
        variables: { tenantName: context.tenantId, items },
      });
    }

    // Exactly-once per invoice: the audit event is the dedupe stamp
    // (overdueInvoiceCandidates excludes already-alerted invoices).
    for (const candidate of candidates) {
      await this.audit.record({
        action: "sales.invoice_overdue",
        entityType: "sales_invoice",
        entityId: candidate.invoiceId,
        actorId: input.checkedBy ?? undefined,
        after: {
          invoiceNo: candidate.invoiceNo,
          dueDate: candidate.dueDate,
          outstanding: candidate.outstanding,
          currencyCode: candidate.currencyCode,
          runMode: input.runMode,
        },
      });
    }
    return { overdue: candidates.length, alerted: candidates.length, recipient };
  }

  /** The tenant owner's email (first owner-role membership — read-only). */
  private async ownerEmail(): Promise<string | null> {
    const context = requireTenantContext();
    const rows = await store.salesTx().execute(sql`
      SELECT u.email
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
      WHERE m.tenant_id = ${context.tenantId} AND r.key = 'owner'
      ORDER BY m.created_at
      LIMIT 1
    `);
    return (rows.rows as unknown as { email: string }[])[0]?.email ?? null;
  }
}
