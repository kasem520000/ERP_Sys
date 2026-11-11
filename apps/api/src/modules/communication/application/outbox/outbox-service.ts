/**
 * PHASE-041 (T-05 · CR-11) — the outbound send pipeline: queue → provider
 * → status transitions. Every send is a ROW (outbound_messages) with the
 * rendered snapshot, source linkage, and the retry policy; the worker
 * resolves the channel port per BR-067 (selection + COMPLETE credentials
 * → the real adapter; anything else → SANDBOX, zero external calls) and
 * drives the transitions:
 *
 *   QUEUED ── ok+delivered ──▶ DELIVERED (sent_at + delivered_at)
 *   QUEUED ── ok ────────────▶ SENT      (sent_at)
 *   QUEUED ── !ok, retryable, attempts < max ──▶ QUEUED (next_attempt_at
 *            backoff: 1 / 5 / 25 minutes — 5^attempt, capped at 25)
 *   QUEUES ── !ok, final or exhausted ────▶ FAILED (last_error)
 *
 * The status-evidence CHECK pins coherence (SENT carries sent_at; DELIVERED
 * carries both timestamps; FAILED carries last_error) — the ledger never
 * lies about delivery. Terminal transitions fire the per-source-type
 * handlers (the dunning-letter hook: SENT/DELIVERED marks the letter SENT;
 * FAILED leaves it QUEUED with the error on the ledger row — retries
 * continue, the register never fabricates a send).
 *
 * Send-cost control (the phase's risk register): the enqueue enforces the
 * per-tenant daily hard cap (messages per UTC day across channels) and
 * records the 80% advisory threshold as an in-app notification (once per
 * day, dedupe-keyed).
 *
 * At-least-once semantics (documented): a worker crash mid-batch rolls the
 * batch back — the rows stay QUEUED and re-send on the next sweep; a
 * duplicate send on crash-recovery is the honest tradeoff (the
 * EmailService precedent; provider refs make duplicates visible).
 */

import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { Inject } from "@nestjs/common";

import type { TenantDb } from "../../../../infra/db/client";
import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { childLogger } from "../../../../infra/observability/logger";
import { getCorrelationId } from "../../../../infra/observability/request-context";
import { InboxService } from "../../../notifications/application/inbox-service";
import {
  OutboxError,
  OutboxRecipientInvalidError,
} from "../../domain/communication-errors";
import {
  isE164Phone,
  isEmailShape,
  type OutboundChannel,
  type OutboundChannelPort,
} from "../../domain/channel-port";
import { ProviderConfigService } from "../provider-config.service";

const log = childLogger({ module: "communication" });

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("outbox access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The source-type vocabulary (mirrors the migration CHECK). */
export type OutboxSourceType =
  | "DUNNING_LETTER"
  | "DIGEST"
  | "NUDGE"
  | "MANUAL"
  | "CALENDAR"
  | "NOTIFICATION";

/** The enqueue input: everything RESOLVED (the caller renders templates). */
export interface OutboxEnqueueInput {
  readonly channel: OutboundChannel;
  readonly recipient: string;
  readonly locale: "ar" | "en";
  readonly templateKey: string;
  readonly module: string;
  readonly subject?: string | null;
  readonly body: string;
  readonly partnerId?: string | null;
  readonly recipientUserId?: string | null;
  readonly sourceType?: OutboxSourceType;
  readonly sourceId?: string | null;
  readonly correlationId?: string | null;
  /** WhatsApp template-message sends (fail-closed without a name). */
  readonly whatsappTemplateName?: string | null;
  readonly whatsappTemplateParams?: readonly string[] | null;
  /** The safe data payload (the whitelist discipline). */
  readonly data?: Readonly<Record<string, string>> | null;
  /** The caller-resolved per-market sender identity (T-03). */
  readonly senderId?: string | null;
  /** Retry budget (1..10; default 3). */
  readonly maxAttempts?: number;
}

/** The terminal transition a source handler observes. */
export interface OutboxTerminalEvent {
  readonly outboundId: string;
  readonly sourceType: OutboxSourceType;
  readonly sourceId: string | null;
  readonly status: "SENT" | "DELIVERED" | "FAILED";
  readonly recipient: string;
  readonly providerRef: string | null;
  readonly lastError: string | null;
}

export type OutboxSourceHandler = (event: OutboxTerminalEvent) => Promise<void>;

/** Exponential backoff in minutes: 5^attempt capped (1 → 5 → 25). */
export function backoffMinutes(attempts: number): number {
  return Math.min(5 ** attempts, 25);
}

export class OutboxService {
  private readonly sourceHandlers = new Map<OutboxSourceType, OutboxSourceHandler>();

  constructor(
    @Inject(ProviderConfigService) private readonly providers: ProviderConfigService,
    @Inject(InboxService) private readonly inbox: InboxService | null,
  ) {}

  /** Register the terminal hook for a source type (the dunning wiring). */
  registerSourceHandler(type: OutboxSourceType, handler: OutboxSourceHandler): void {
    this.sourceHandlers.set(type, handler);
  }

  /**
   * Enqueue a send: validations → the daily cap → the ledger row → the
   * communication_log projection (the unified inbox's timeline entry).
   */
  async enqueue(input: OutboxEnqueueInput): Promise<{ id: string }> {
    if (input.channel === "EMAIL") {
      if (!isEmailShape(input.recipient)) {
        throw new OutboxRecipientInvalidError(input.channel, input.recipient);
      }
      if (input.subject === undefined || input.subject === null || input.subject.length === 0) {
        throw new OutboxError(
          "communication/outbox-subject-required",
          "EMAIL sends require a rendered subject",
        );
      }
    } else {
      if (!isE164Phone(input.recipient)) {
        throw new OutboxRecipientInvalidError(input.channel, input.recipient);
      }
      if (input.channel === "WHATSAPP" && (input.whatsappTemplateName ?? "").length === 0) {
        throw new OutboxError(
          "communication/outbox-whatsapp-template-required",
          "WHATSAPP sends ride approved template messages — whatsappTemplateName is required",
        );
      }
    }
    if (input.body.length === 0 || input.body.length > 20_000) {
      throw new OutboxError("communication/outbox-body-invalid", "body must be 1..20000 chars");
    }
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new OutboxError(
        "communication/outbox-attempts-invalid",
        "maxAttempts must be an integer 1..10",
      );
    }

    // The send-cost hard cap (messages per UTC day, across channels).
    const tx = tenantTx();
    const today = await tx.execute(sql`
      SELECT count(*)::int AS n FROM outbound_messages
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`);
    const sentToday = (today.rows as unknown as { n: number }[])[0]?.n ?? 0;
    const cap = await this.providers.dailySendCap();
    if (cap !== undefined && sentToday >= cap) {
      await this.inbox?.record({
        category: "collections",
        severity: "critical",
        title: {
          ar: "تم بلوغ سقف الإرسال اليومي",
          en: "Daily send cap reached",
        },
        body: {
          ar: `تم إيقاف الإرسال الخارجي عند السقف المُعد (${cap} رسالة يومياً). راجع إعدادات الاتصالات.`,
          en: `Outbound sending stopped at the configured cap (${cap} messages/day). Review the communication settings.`,
        },
        dedupeKey: `communication-send-cap:${new Date().toISOString().slice(0, 10)}`,
      });
      throw new OutboxError(
        "communication/send-cap-exceeded",
        `the daily send cap (${cap}) is reached — no new sends today`,
      );
    }
    if (cap !== undefined && sentToday * 5 >= cap * 4 && sentToday < cap) {
      // Integer arithmetic (ADR-0009 — no floating point): 80% = 5:4.
      // The advisory threshold (once per day, dedupe-keyed).
      await this.inbox?.record({
        category: "collections",
        severity: "warning",
        title: {
          ar: "اقتراب سقف الإرسال اليومي",
          en: "Approaching the daily send cap",
        },
        body: {
          ar: `تم إرسال ${sentToday} من ${cap} رسالة (٨٠٪ من السقف اليومي).`,
          en: `${sentToday} of ${cap} messages sent (80% of the daily cap).`,
        },
        dedupeKey: `communication-send-threshold:${new Date().toISOString().slice(0, 10)}`,
      });
    }

    const id = generateUuidV7();
    const payload = {
      senderId: input.senderId ?? null,
      whatsappTemplateName: input.whatsappTemplateName ?? null,
      whatsappTemplateParams: input.whatsappTemplateParams ?? null,
      data: input.data ?? null,
    };
    await tx.execute(sql`
      INSERT INTO outbound_messages
        (id, tenant_id, channel, status, recipient, recipient_user_id, partner_id,
         module, template_key, locale, subject, body_snapshot, attempts, max_attempts,
         source_type, source_id, correlation_id, payload)
      VALUES (${id}, erp.current_tenant_id(), ${input.channel}, 'QUEUED',
              ${input.recipient}, ${input.recipientUserId ?? null}, ${input.partnerId ?? null},
              ${input.module}, ${input.templateKey}, ${input.locale},
              ${input.channel === "EMAIL" ? (input.subject ?? null) : null},
              ${input.body}, 0, ${maxAttempts},
              ${input.sourceType ?? null}, ${input.sourceId ?? null},
              ${input.correlationId ?? getCorrelationId() ?? null},
              ${JSON.stringify(payload)}::jsonb)`);

    // The communication_log projection (UX-14): the unified inbox's
    // timeline entry for partner-facing messages.
    if (input.partnerId !== undefined && input.partnerId !== null) {
      await tx.execute(sql`
        INSERT INTO communication_log
          (id, tenant_id, kind, direction, channel, at, partner_id, user_id,
           summary, body, outbound_message_id)
        VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'MESSAGE', 'OUTBOUND',
                ${input.channel}, now(), ${input.partnerId}, ${input.recipientUserId ?? null},
                ${input.channel === "EMAIL"
                  ? (input.subject ?? input.body.slice(0, 200))
                  : input.body.slice(0, 200)},
                ${input.body}, ${id})`);
    }
    return { id };
  }

  /**
   * Process the tenant's DUE queue (the sweep's per-tenant core; tests call
   * it directly inside withTenant). One batch per transaction — a crash
   * rolls the batch back (at-least-once, documented above).
   */
  async processDue(limit = 50): Promise<{
    processed: number;
    delivered: number;
    sent: number;
    requeued: number;
    failed: number;
  }> {
    const tx = tenantTx();
    const tenantId = requireTenantContext().tenantId;
    const due = await tx.execute(sql`
      SELECT id FROM outbound_messages
      WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at LIMIT ${limit}`);
    const ids = (due.rows as unknown as { id: string }[]).map((row) => row.id);
    let delivered = 0;
    let sent = 0;
    let requeued = 0;
    let failed = 0;

    // Resolve the ports ONCE per batch (provider config reads hit
    // tenant_settings; the SANDBOX default is free).
    const ports = new Map<OutboundChannel, OutboundChannelPort>();
    const portFor = async (channel: OutboundChannel): Promise<OutboundChannelPort> => {
      const existing = ports.get(channel);
      if (existing !== undefined) {
        return existing;
      }
      const port = await this.providers.resolveChannelPort(channel);
      ports.set(channel, port);
      return port;
    };

    for (const id of ids) {
      const rows = await tx.execute(sql`
        SELECT id, channel, status, recipient, module, template_key AS "templateKey",
               locale, subject, body_snapshot AS "bodySnapshot", attempts,
               max_attempts AS "maxAttempts", source_type AS "sourceType",
               source_id AS "sourceId", payload
        FROM outbound_messages WHERE id = ${id} FOR UPDATE`);
      const row = (rows.rows as unknown as WorkerRow[])[0];
      if (row === undefined || row.status !== "QUEUED") {
        continue; // raced to terminal by a concurrent worker
      }
      const payload = (row.payload ?? {}) as {
        senderId?: string | null;
        whatsappTemplateName?: string | null;
        whatsappTemplateParams?: readonly string[] | null;
        data?: Readonly<Record<string, string>> | null;
      };
      const port = await portFor(row.channel as OutboundChannel);
      const attempts = row.attempts + 1;
      let outcome: { status: "SENT" | "DELIVERED" | "QUEUED" | "FAILED"; error?: string };
      try {
        const result = await port.send({
          tenantId,
          channel: row.channel as OutboundChannel,
          to: row.recipient,
          renderedFor: row.locale === "en" ? "en" : "ar",
          subject: row.subject ?? undefined,
          body: row.bodySnapshot,
          senderId: payload.senderId ?? undefined,
          whatsappTemplateName: payload.whatsappTemplateName ?? undefined,
          whatsappTemplateParams: payload.whatsappTemplateParams ?? undefined,
          data: payload.data ?? undefined,
        });
        if (result.ok) {
          outcome = result.delivered === true ? { status: "DELIVERED" } : { status: "SENT" };
          const costAmount = result.cost?.amount ?? null;
          const costCurrency = result.cost?.currency ?? null;
          const providerRef = result.providerMessageId ?? null;
          if (outcome.status === "DELIVERED") {
            await tx.execute(sql`
              UPDATE outbound_messages SET status = 'DELIVERED', attempts = ${attempts},
                provider = ${port.id}, provider_ref = ${providerRef},
                cost_amount = ${costAmount}, cost_currency = ${costCurrency},
                sent_at = now(), delivered_at = now(), last_error = NULL, updated_at = now()
              WHERE id = ${id}`);
            delivered += 1;
          } else {
            await tx.execute(sql`
              UPDATE outbound_messages SET status = 'SENT', attempts = ${attempts},
                provider = ${port.id}, provider_ref = ${providerRef},
                cost_amount = ${costAmount}, cost_currency = ${costCurrency},
                sent_at = now(), last_error = NULL, updated_at = now()
              WHERE id = ${id}`);
            sent += 1;
          }
        } else if (result.retryable === true && attempts < row.maxAttempts) {
          outcome = { status: "QUEUED", error: result.error };
          const nextMinutes = backoffMinutes(attempts);
          await tx.execute(sql`
            UPDATE outbound_messages SET attempts = ${attempts},
              next_attempt_at = now() + (${nextMinutes} * interval '1 minute'),
              last_error = ${result.error ?? "unspecified"}, updated_at = now()
            WHERE id = ${id}`);
          requeued += 1;
        } else {
          outcome = { status: "FAILED", error: result.error };
          await tx.execute(sql`
            UPDATE outbound_messages SET status = 'FAILED', attempts = ${attempts},
              provider = ${port.id}, last_error = ${result.error ?? "unspecified"},
              updated_at = now()
            WHERE id = ${id}`);
          failed += 1;
        }
      } catch (error) {
        // A provider must never crash the sweep: a thrown error is a
        // retryable network shape (the port contract says report, never
        // throw — this is the belt on top).
        outcome = { status: attempts < row.maxAttempts ? "QUEUED" : "FAILED", error: `worker:${String(error)}` };
        if (outcome.status === "QUEUED") {
          const nextMinutes = backoffMinutes(attempts);
          await tx.execute(sql`
            UPDATE outbound_messages SET attempts = ${attempts},
              next_attempt_at = now() + (${nextMinutes} * interval '1 minute'),
              last_error = ${outcome.error}, updated_at = now()
            WHERE id = ${id}`);
          requeued += 1;
        } else {
          await tx.execute(sql`
            UPDATE outbound_messages SET status = 'FAILED', attempts = ${attempts},
              last_error = ${outcome.error}, updated_at = now()
            WHERE id = ${id}`);
          failed += 1;
        }
      }

      if (outcome.status !== "QUEUED" && row.sourceType !== null) {
        const handler = this.sourceHandlers.get(row.sourceType as OutboxSourceType);
        if (handler !== undefined) {
          try {
            await handler({
              outboundId: id,
              sourceType: row.sourceType as OutboxSourceType,
              sourceId: row.sourceId,
              status: outcome.status,
              recipient: row.recipient,
              providerRef: null,
              lastError: outcome.error ?? null,
            });
          } catch (error) {
            // A handler failure never poisons the batch: the ledger row is
            // the source of truth; the hook is a projection.
            log.warn(
              { outbound_id: id, err: error },
              "outbox source handler failed (ledger row is the truth)",
            );
          }
        }
      }
    }
    return { processed: ids.length, delivered, sent, requeued, failed };
  }

  /** The outbound ledger read (the delivery-log report's data path). */
  async list(
    filter: {
      status?: string;
      channel?: string;
      partnerId?: string;
      fromAt?: string;
      toAt?: string;
      limit?: number;
    } = {},
  ): Promise<readonly OutboxRow[]> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT id, channel, status, recipient, recipient_user_id AS "recipientUserId",
             partner_id AS "partnerId", module, template_key AS "templateKey", locale,
             subject, body_snapshot AS "bodySnapshot", provider, provider_ref AS "providerRef",
             cost_amount AS "costAmount", cost_currency AS "costCurrency",
             attempts, max_attempts AS "maxAttempts", next_attempt_at AS "nextAttemptAt",
             last_error AS "lastError", sent_at AS "sentAt", delivered_at AS "deliveredAt",
             source_type AS "sourceType", source_id AS "sourceId", correlation_id AS "correlationId",
             created_at AS "createdAt"
      FROM outbound_messages
      WHERE (${filter.status ?? null} IS NULL OR status = ${filter.status ?? null})
        AND (${filter.channel ?? null} IS NULL OR channel = ${filter.channel ?? null})
        AND (${filter.partnerId ?? null} IS NULL OR partner_id = ${filter.partnerId ?? null})
        AND (${filter.fromAt ?? null} IS NULL OR created_at >= ${filter.fromAt ?? null}::timestamptz)
        AND (${filter.toAt ?? null} IS NULL OR created_at <= ${filter.toAt ?? null}::timestamptz)
      ORDER BY created_at DESC LIMIT ${filter.limit ?? 100}`);
    return rows.rows as unknown as OutboxRow[];
  }
}

/** The worker's locked row shape (aliased camelCase in the FOR UPDATE). */
interface WorkerRow {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly recipient: string;
  readonly module: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly subject: string | null;
  readonly bodySnapshot: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly payload: unknown;
}

/** The ledger row shape (the list read + the worker's raw shape). */
export interface OutboxRow {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly recipient: string;
  readonly recipientUserId: string | null;
  readonly partnerId: string | null;
  readonly module: string;
  readonly templateKey: string;
  readonly locale: string;
  readonly subject: string | null;
  readonly bodySnapshot: string;
  readonly provider: string | null;
  readonly providerRef: string | null;
  readonly costAmount: string | null;
  readonly costCurrency: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly sourceType: string | null;
  readonly sourceId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
  readonly payload?: unknown;
}
