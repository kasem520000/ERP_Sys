import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { EmailService } from "./email-service";

/**
 * PHASE-014 in-app notifications center (PHASE-014 §2.8 — the
 * billing-critical subset), generalized at PHASE-015 T10
 * (FEATURE_CATALOG `platform.notifications` — the in-app leg beyond
 * billing): in-app inbox rows + per-user channel preferences. The
 * PHASE-015 categories: `stock` (reorder alerts — the BR-019 scan's
 * in-app leg) and `templates` (industry template upgrade offers — the
 * configuration module's drift job; offers are recorded, never
 * auto-applied). Everything else is unchanged: dedupe, prefs, RLS.
 *
 * Rows are tenant-scoped (RLS); a user's inbox shows rows targeted at them
 * (user_id) plus tenant broadcast rows (user_id IS NULL). Preferences
 * suppress: in-app off → the row is not created for that user; email off →
 * the email is not sent. Prefs never fabricate events.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("inbox access requires an ambient tenant scope");
  }
  return context.tx;
}

/**
 * Notification categories: the PHASE-014 billing-critical set, the
 * PHASE-015 generalization (stock reorder alerts; industry template
 * upgrade offers), the PHASE-019 crm set (task reminders — the 05:30
 * sweep's in-app leg), the PHASE-023 einvoicing set (submission
 * failures/rejections + certificate expiry + reject spikes), and the
 * PHASE-027 notes/installments set (dishonor surfacing, DEFAULTED dunning).
 */
export type NotificationCategory =
  | "limits"
  | "subscription"
  | "reconciliation"
  | "invoice_overdue"
  | "stock"
  | "templates"
  | "crm"
  | "einvoicing"
  // PHASE-027 (0038 category widening): dishonor surfacing (BR-046) and
  // installment dunning/DEFAULTED (BR-049 family).
  | "notes"
  | "installments"
  // PHASE-028 (0039 category widening): the advisory overspend warnings
  // (BR-051 — notification + banner at/over budget) and the
  // at/over-threshold sweep surface.
  | "budgeting";
export type NotificationSeverity = "info" | "warning" | "critical";

export interface BilingualText {
  readonly ar: string;
  readonly en: string;
}

export interface RecordNotificationInput {
  readonly category: NotificationCategory;
  readonly severity: NotificationSeverity;
  readonly title: BilingualText;
  readonly body: BilingualText;
  readonly actionLabel?: BilingualText;
  readonly actionUrl?: string;
  /** Once-per-event discipline (uq_notifications_dedupe). */
  readonly dedupeKey?: string;
  readonly userId?: string | null;
}

export interface InboxRow {
  id: string;
  tenantId: string;
  userId: string | null;
  category: string;
  severity: string;
  title: BilingualText;
  body: BilingualText;
  actionLabel: BilingualText | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

const INBOX_COLUMNS = sql`id, tenant_id AS "tenantId", user_id AS "userId", category, severity,
  title::jsonb AS "title", body::jsonb AS "body", action_label::jsonb AS "actionLabel",
  action_url AS "actionUrl", read_at AS "readAt", created_at AS "createdAt"`;

export class InboxService {
  /**
   * Insert one inbox row (dedupe-aware). Returns { inserted: false } when
   * the dedupe key already fired — callers treat that as success.
   */
  async record(input: RecordNotificationInput): Promise<{ inserted: boolean; row?: InboxRow }> {
    const tx = tenantTx();
    if (input.dedupeKey !== undefined) {
      const existing = await tx.execute(sql`
        SELECT ${INBOX_COLUMNS} FROM notifications
        WHERE dedupe_key = ${input.dedupeKey} LIMIT 1
      `);
      const prior = (existing.rows as unknown as InboxRow[])[0];
      if (prior !== undefined) {
        return { inserted: false, row: prior };
      }
    }
    const rows = await tx.execute(sql`
      INSERT INTO notifications (
        id, tenant_id, user_id, category, severity, title, body,
        action_label, action_url, dedupe_key
      ) VALUES (
        ${generateUuidV7()}, erp.current_tenant_id(), ${input.userId ?? null},
        ${input.category}, ${input.severity},
        ${JSON.stringify(input.title)}::jsonb, ${JSON.stringify(input.body)}::jsonb,
        ${input.actionLabel === undefined ? null : JSON.stringify(input.actionLabel)}::jsonb,
        ${input.actionUrl ?? null}, ${input.dedupeKey ?? null}
      )
      ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
      RETURNING ${INBOX_COLUMNS}
    `);
    const row = (rows.rows as unknown as InboxRow[])[0];
    return row === undefined ? { inserted: false } : { inserted: true, row };
  }

  /** The tenant owner's user id + email + locale (first owner membership). */
  async ownerTarget(): Promise<{ userId: string; email: string; locale: string } | null> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT u.id AS "userId", u.email, u.locale
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
      WHERE m.tenant_id = erp.current_tenant_id() AND r.key = 'owner'
        AND m.status = 'ACTIVE'
      ORDER BY m.created_at
      LIMIT 1
    `);
    const row = (rows.rows as unknown as { userId: string; email: string; locale: string }[])[0];
    return row ?? null;
  }

  /** Per-user prefs for a category (absent rows = both channels on). */
  async prefsFor(userId: string, category: NotificationCategory): Promise<{ inApp: boolean; email: boolean }> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT in_app AS "inApp", email FROM notification_prefs
      WHERE user_id = ${userId} AND category = ${category} LIMIT 1
    `);
    const row = (rows.rows as unknown as { inApp: boolean; email: boolean }[])[0];
    return row ?? { inApp: true, email: true };
  }

  /**
   * The owner-facing emit: inbox row (in-app channel) + email (email
   * channel) — each suppressed independently by the owner's prefs. The
   * email rides the pg-boss queue through EmailService (AR/EN per the
   * owner's locale).
   */
  async notifyOwner(
    email: EmailService | null,
    input: RecordNotificationInput & {
      emailTemplate:
        | "limit_warning"
        | "subscription_state"
        | "invoice_overdue"
        /** PHASE-019 (§3): the task-reminder sweep's email leg. */
        | "task_reminder";
      emailVariables: Record<string, string>;
    },
  ): Promise<{ inbox: boolean; email: boolean }> {
    const target = await this.ownerTarget();
    let inboxInserted = false;
    let emailSent = false;
    if (target !== null) {
      const prefs = await this.prefsFor(target.userId, input.category);
      if (prefs.inApp) {
        const outcome = await this.record({ ...input, userId: target.userId });
        inboxInserted = outcome.inserted;
      }
      if (prefs.email && email !== null) {
        const locale: "ar" | "en" = target.locale === "en" ? "en" : "ar";
        await email.enqueue(erpTenantIdOrZero(), {
          template: input.emailTemplate,
          locale,
          recipient: target.email,
          variables: input.emailVariables,
        });
        emailSent = true;
      }
    }
    return { inbox: inboxInserted, email: emailSent };
  }

  /** Inbox list for a user (own rows + tenant broadcasts). */
  async listForUser(
    userId: string,
    options: { unreadOnly?: boolean; limit?: number } = {},
  ): Promise<InboxRow[]> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT ${INBOX_COLUMNS} FROM notifications
      WHERE (user_id IS NULL OR user_id = ${userId})
        AND (${options.unreadOnly ?? false} = false OR read_at IS NULL)
      ORDER BY created_at DESC
      LIMIT ${options.limit ?? 50}
    `);
    return rows.rows as unknown as InboxRow[];
  }

  async unreadCount(userId: string): Promise<number> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT count(*)::int AS n FROM notifications
      WHERE (user_id IS NULL OR user_id = ${userId}) AND read_at IS NULL
    `);
    return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
  }

  async markRead(id: string, userId: string): Promise<boolean> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      UPDATE notifications SET read_at = now()
      WHERE id = ${id} AND (user_id IS NULL OR user_id = ${userId}) AND read_at IS NULL
      RETURNING id
    `);
    return rows.rows.length > 0;
  }

  /** All prefs rows for a user (absent categories = both channels on). */
  async prefsForUser(userId: string): Promise<
    ReadonlyArray<{ category: string; inApp: boolean; email: boolean }>
  > {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT category, in_app AS "inApp", email FROM notification_prefs
      WHERE user_id = ${userId} ORDER BY category
    `);
    return rows.rows as unknown as { category: string; inApp: boolean; email: boolean }[];
  }

  /** Upsert the caller's preference for a category (self plane). */
  async upsertPref(
    userId: string,
    input: { category: NotificationCategory; inApp: boolean; email: boolean },
  ): Promise<void> {
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO notification_prefs (id, tenant_id, user_id, category, in_app, email)
      VALUES (
        ${generateUuidV7()}, erp.current_tenant_id(), ${userId},
        ${input.category}, ${input.inApp}, ${input.email}
      )
      ON CONFLICT (user_id, category) DO UPDATE
        SET in_app = EXCLUDED.in_app, email = EXCLUDED.email,
            updated_at = now(), version = notification_prefs.version + 1
    `);
  }
}

/** Ambient tenant id for email enqueue payloads (jobs are tenant-scoped). */
function erpTenantIdOrZero(): string {
  const context = requireTenantContext();
  return context.tenantId;
}
