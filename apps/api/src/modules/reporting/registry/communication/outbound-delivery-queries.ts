import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-041 T-11 · the communications query surface for the report
 * contracts (REPORT_CATALOG §7 addition): `communication.outbound_delivery
 * _log` — the outbound ledger as a report (every send is a row: status,
 * provider, provider ref, cost, attempts, the source that produced it).
 * Read-only over the ambient tenant transaction (the registry query-service
 * convention).
 */

export interface OutboundDeliveryRow {
  messageId: string;
  channel: string;
  status: string;
  module: string;
  templateKey: string;
  locale: string;
  recipient: string;
  partner: string | null;
  subject: string | null;
  provider: string | null;
  providerRef: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  sourceType: string | null;
}

export class CommunicationQueriesService {
  /**
   * The delivery log: one row per outbound message, windowed by the send
   * date, filtered by channel/status; the recipient resolves to the
   * partner's localized name when linked. Newest first.
   */
  async outboundDeliveryLog(params: {
    dateFrom: string;
    dateTo: string;
    channel?: "EMAIL" | "WHATSAPP" | "SMS";
    status?: "QUEUED" | "SENT" | "DELIVERED" | "FAILED";
  }): Promise<OutboundDeliveryRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("communication report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT m.id AS "messageId", m.channel, m.status, m.module,
             m.template_key AS "templateKey", m.locale, m.recipient,
             CASE WHEN m.partner_id IS NULL THEN NULL
                  ELSE coalesce(p.name_ar, p.name) END AS partner,
             m.subject, m.provider, m.provider_ref AS "providerRef",
             m.cost_amount::text AS "costAmount", m.cost_currency AS "costCurrency",
             m.attempts, m.max_attempts AS "maxAttempts", m.last_error AS "lastError",
             m.sent_at::text AS "sentAt", m.delivered_at::text AS "deliveredAt",
             m.created_at::text AS "createdAt", m.source_type AS "sourceType"
      FROM outbound_messages m
      LEFT JOIN partners p ON p.id = m.partner_id AND p.tenant_id = m.tenant_id
      WHERE m.created_at >= ${params.dateFrom}::timestamptz
        AND m.created_at < (${params.dateTo}::timestamptz + interval '1 day')
        AND (${params.channel ?? null}::text IS NULL OR m.channel = ${params.channel ?? null}::text)
        AND (${params.status ?? null}::text IS NULL OR m.status = ${params.status ?? null}::text)
      ORDER BY m.created_at DESC
      LIMIT 5000`);
    return rows.rows as unknown as OutboundDeliveryRow[];
  }
}
