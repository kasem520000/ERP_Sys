/**
 * PHASE-041 (T-07 · PP-13/PP-15) — the daily digest + the proactive
 * nudge jobs.
 *
 * DIGEST (PP-13): the per-user "what needs attention today" — overdue
 * invoices, approvals pending, low stock, expiring warranties — rendered
 * from the builtin digest.daily template (AR/EN per the user's locale)
 * and dispatched through the PREFERENCE-AWARE resolver (module `digest`;
 * users opting out of digest×EMAIL receive nothing). The cron runs at
 * 03:30 UTC (06:30 Riyadh — the house timezone).
 *
 * NUDGES (PP-15): deadline-ahead reminders with per-event-type lead
 * times (tenant setting `communication.nudges`; code defaults
 * invoiceDue 3 / taskDue 1 / contractRenewal 30 days):
 * - invoice_due — customer-facing (the partner's contact email) through
 *   the outbox, EXACTLY-ONCE per invoice (the source-linkage probe:
 *   outbound_messages source_type NUDGE + source_id — early/late/
 *   duplicate firings fail the spec);
 * - task_due / contract_renewal — user-facing through the resolver
 *   (module crm; the assignee/owner honors their preferences).
 *
 * The cron runs at 04:00 UTC (07:00 Riyadh). Both jobs are idempotent
 * full passes (the reservation-sweep precedent) — one UoW per tenant.
 */

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { OutboxService } from "./outbox/outbox-service";
import { PreferencesService } from "./preferences-service";
import { TemplateService } from "./template-service";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("digest/nudge access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The tenant's nudge lead times (days). */
export interface NudgeLeadTimes {
  readonly invoiceDue: number;
  readonly taskDue: number;
  readonly contractRenewal: number;
}

export const DEFAULT_LEAD_TIMES: NudgeLeadTimes = {
  invoiceDue: 3,
  taskDue: 1,
  contractRenewal: 30,
};

export class DigestService {
  constructor(private readonly preferences: PreferencesService) {}

  /** The tenant's "needs attention today" aggregates (the digest body). */
  async attentionCounts(): Promise<{
    overdueInvoices: number;
    pendingApprovals: number;
    lowStockItems: number;
    expiringWarranties: number;
  }> {
    const tx = tenantTx();
    const query = async (text: string): Promise<number> => {
      const rows = await tx.execute(sql.raw(text));
      return Number((rows.rows as unknown as { n: string | number }[])[0]?.n ?? 0);
    };
    const overdueInvoices = await query(
      `SELECT count(*) AS n FROM sales_invoices
       WHERE status = 'POSTED' AND due_date < current_date`,
    );
    const pendingApprovals = await query(
      `SELECT
         (SELECT count(*) FROM sales_invoices WHERE status = 'PENDING_APPROVAL')
         + (SELECT count(*) FROM manual_journals WHERE status = 'PENDING_APPROVAL') AS n`,
    );
    const lowStockItems = await query(
      `SELECT count(*) AS n FROM item_warehouse_settings s
       JOIN item_stock st
         ON st.tenant_id = s.tenant_id AND st.item_id = s.item_id AND st.warehouse_id = s.warehouse_id
       WHERE s.reorder_level > 0 AND st.qty < s.reorder_level`,
    );
    const expiringWarranties = await query(
      `SELECT count(*) AS n FROM warranty_registrations
       WHERE status = 'ACTIVE' AND end_date <= current_date + 30`,
    );
    return { overdueInvoices, pendingApprovals, lowStockItems, expiringWarranties };
  }

  /**
   * The digest pass: every ACTIVE member with digest×EMAIL enabled gets
   * the rendered template through the resolver. Users opting out receive
   * NOTHING (the acceptance's preference-aware contract).
   */
  async runDigest(): Promise<{ users: number; delivered: number; suppressed: number }> {
    const counts = await this.attentionCounts();
    const tx = tenantTx();
    const members = await tx.execute(sql`
      SELECT DISTINCT m.user_id AS "userId", u.full_name AS "fullName", u.locale
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = erp.current_tenant_id() AND m.status = 'ACTIVE'`);
    let delivered = 0;
    let suppressed = 0;
    for (const member of members.rows as unknown as {
      userId: string;
      fullName: string;
    }[]) {
      const outcome = await this.preferences.dispatchUserNotification({
        userId: member.userId,
        module: "digest",
        templateKey: "digest.daily",
        severity: "info",
        dedupeKey: `digest:${member.userId}:${new Date().toISOString().slice(0, 10)}`,
        variables: {
          user_name: member.fullName,
          overdue_invoices: String(counts.overdueInvoices),
          pending_approvals: String(counts.pendingApprovals),
          low_stock_items: String(counts.lowStockItems),
          expiring_warranties: String(counts.expiringWarranties),
          body_ar: `ملخص اليوم: ${counts.overdueInvoices} فاتورة متأخرة، ${counts.pendingApprovals} موافقة معلّقة، ${counts.lowStockItems} صنف تحت حد الطلب، ${counts.expiringWarranties} ضمان ينتهي قريباً.`,
          body_en: `Today: ${counts.overdueInvoices} overdue invoices, ${counts.pendingApprovals} approvals pending, ${counts.lowStockItems} items below reorder, ${counts.expiringWarranties} warranties expiring soon.`,
        },
        sourceType: "DIGEST",
      });
      if (outcome.email === "enqueued") {
        delivered += 1;
      } else {
        suppressed += 1;
      }
    }
    return { users: members.rows.length, delivered, suppressed };
  }
}

export class NudgeService {
  constructor(
    private readonly preferences: PreferencesService,
    private readonly templates: TemplateService,
    private readonly outbox: OutboxService,
  ) {}

  /** The tenant's lead times (the setting overrides the code defaults). */
  async leadTimes(): Promise<NudgeLeadTimes> {
    const stored = await readEffectiveSetting<Partial<NudgeLeadTimes> | undefined>(
      "communication.nudges",
    );
    if (stored === undefined || stored === null) {
      return DEFAULT_LEAD_TIMES;
    }
    const pick = (value: unknown, fallback: number): number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 365
        ? value
        : fallback;
    return {
      invoiceDue: pick(stored.invoiceDue, DEFAULT_LEAD_TIMES.invoiceDue),
      taskDue: pick(stored.taskDue, DEFAULT_LEAD_TIMES.taskDue),
      contractRenewal: pick(stored.contractRenewal, DEFAULT_LEAD_TIMES.contractRenewal),
    };
  }

  /**
   * The invoice-due nudge (customer-facing, EXACTLY-ONCE per invoice):
   * posted credit invoices due in EXACTLY the configured lead days whose
   * partner has a contact email — the source-linkage probe dedupes (an
   * invoice nudged once never nudges again, whatever the lead config
   * later becomes).
   */
  async runInvoiceDueNudges(): Promise<{ fired: number; skipped: number }> {
    const lead = (await this.leadTimes()).invoiceDue;
    const tx = tenantTx();
    const due = await tx.execute(sql`
      SELECT i.id, i.invoice_no AS "invoiceNo", i.customer_id AS "partnerId",
             p.name AS "partnerName", i.total_gross AS "totalAmount",
             i.currency_code AS "currencyCode", i.due_date::text AS "dueDate",
             c.email AS "contactEmail"
      FROM sales_invoices i
      JOIN partners p ON p.id = i.customer_id AND p.tenant_id = i.tenant_id
      LEFT JOIN LATERAL (
        SELECT email FROM partner_contacts
        WHERE partner_id = i.customer_id AND email IS NOT NULL
        ORDER BY is_primary DESC, created_at LIMIT 1
      ) c ON true
      WHERE i.status = 'POSTED' AND i.kind = 'CREDIT'
        AND i.due_date = current_date + ${lead}::int
        AND c.email IS NOT NULL`);
    let fired = 0;
    let skipped = 0;
    for (const invoice of due.rows as unknown as {
      id: string;
      invoiceNo: string | null;
      partnerId: string;
      partnerName: string;
      totalAmount: string;
      currencyCode: string;
      dueDate: string;
      contactEmail: string;
    }[]) {
      // EXACTLY-ONCE (the source-linkage probe — early/late/duplicate
      // firings fail the spec).
      const existing = await tx.execute(sql`
        SELECT 1 FROM outbound_messages
        WHERE source_type = 'NUDGE' AND source_id = ${invoice.id} LIMIT 1`);
      if (existing.rows.length > 0) {
        skipped += 1;
        continue;
      }
      const rendered = await this.templates
        .render("nudge.invoice_due", "EMAIL", "ar", {
          customer_name: invoice.partnerName,
          invoice_number: invoice.invoiceNo ?? invoice.id,
          amount_due: `${invoice.totalAmount} ${invoice.currencyCode}`,
          due_date: invoice.dueDate,
        })
        .catch(() => null);
      if (rendered === null) {
        skipped += 1;
        continue;
      }
      await this.outbox.enqueue({
        channel: "EMAIL",
        recipient: invoice.contactEmail,
        locale: "ar",
        templateKey: "nudge.invoice_due",
        module: "invoice_overdue",
        subject: rendered.subject,
        body: rendered.body,
        partnerId: invoice.partnerId,
        sourceType: "NUDGE",
        sourceId: invoice.id,
      });
      fired += 1;
    }
    return { fired, skipped };
  }

  /** The task-due nudge (user-facing, preference-aware, once per task). */
  async runTaskDueNudges(): Promise<{ fired: number; skipped: number }> {
    const lead = (await this.leadTimes()).taskDue;
    const tx = tenantTx();
    const due = await tx.execute(sql`
      SELECT t.id, t.title, t.due_date::text AS "dueDate", t.assignee_user_id AS "assigneeUserId"
      FROM crm_tasks t
      WHERE t.status = 'OPEN' AND t.due_date = current_date + ${lead}::int
        AND t.assignee_user_id IS NOT NULL`);
    let fired = 0;
    let skipped = 0;
    for (const task of due.rows as unknown as {
      id: string;
      title: string;
      dueDate: string;
      assigneeUserId: string;
    }[]) {
      const existing = await tx.execute(sql`
        SELECT 1 FROM outbound_messages
        WHERE source_type = 'NUDGE' AND source_id = ${task.id} LIMIT 1`);
      if (existing.rows.length > 0) {
        skipped += 1;
        continue;
      }
      const outcome = await this.preferences.dispatchUserNotification({
        userId: task.assigneeUserId,
        module: "crm",
        templateKey: "nudge.task_due",
        severity: "info",
        dedupeKey: `nudge-task:${task.id}`,
        variables: {
          user_name: task.assigneeUserId,
          task_title: task.title,
          due_date: task.dueDate,
          body_ar: `المهمة «${task.title}» تستحق في ${task.dueDate}`,
          body_en: `Task "${task.title}" is due on ${task.dueDate}`,
        },
        sourceType: "NUDGE",
        sourceId: task.id,
      });
      if (outcome.email === "enqueued" || outcome.inApp) {
        fired += 1;
      } else {
        skipped += 1;
      }
    }
    return { fired, skipped };
  }

  /** The contract-renewal nudge (user-facing, preference-aware, once). */
  async runContractRenewalNudges(): Promise<{ fired: number; skipped: number }> {
    const lead = (await this.leadTimes()).contractRenewal;
    const tx = tenantTx();
    const due = await tx.execute(sql`
      SELECT c.id, c.contract_no AS "contractNo", p.name AS "partnerName",
             c.end_date::text AS "endDate", c.created_by AS "createdBy"
      FROM service_contracts c
      JOIN partners p ON p.id = c.partner_id AND p.tenant_id = c.tenant_id
      WHERE c.status = 'ACTIVE' AND c.end_date = current_date + ${lead}::int`);
    let fired = 0;
    let skipped = 0;
    for (const contract of due.rows as unknown as {
      id: string;
      contractNo: string | null;
      partnerName: string;
      endDate: string;
      createdBy: string | null;
    }[]) {
      const existing = await tx.execute(sql`
        SELECT 1 FROM outbound_messages
        WHERE source_type = 'NUDGE' AND source_id = ${contract.id} LIMIT 1`);
      if (existing.rows.length > 0) {
        skipped += 1;
        continue;
      }
      if (contract.createdBy === null) {
        skipped += 1;
        continue;
      }
      const outcome = await this.preferences.dispatchUserNotification({
        userId: contract.createdBy,
        module: "crm",
        templateKey: "nudge.contract_renewal",
        severity: "info",
        dedupeKey: `nudge-contract:${contract.id}`,
        variables: {
          user_name: contract.createdBy,
          contract_number: contract.contractNo ?? contract.id,
          partner_name: contract.partnerName,
          renewal_date: contract.endDate,
          body_ar: `العقد ${contract.contractNo ?? contract.id} مع ${contract.partnerName} ينتهي في ${contract.endDate}`,
          body_en: `Contract ${contract.contractNo ?? contract.id} with ${contract.partnerName} ends on ${contract.endDate}`,
        },
        sourceType: "NUDGE",
        sourceId: contract.id,
      });
      if (outcome.email === "enqueued" || outcome.inApp) {
        fired += 1;
      } else {
        skipped += 1;
      }
    }
    return { fired, skipped };
  }
}
