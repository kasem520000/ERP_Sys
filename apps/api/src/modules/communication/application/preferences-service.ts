/**
 * PHASE-041 (T-06 · TB-23) — the notification-preference matrix: the user ×
 * module × channel resolution (user row → tenant-default row → the code
 * default; the paid-channels-off discipline: IN_APP on, EMAIL on, SMS off,
 * WHATSAPP off) + the lazy materialization of tenant defaults for tenants
 * provisioned after migration 0064 §8 seeded the EXISTING ones.
 *
 * The DISPATCH RESOLVER (the acceptance's end-to-end): dispatching a
 * user-targeted event consults the matrix per channel — a user opted OUT
 * of module×channel receives NOTHING on that channel while identical
 * events still deliver on opted-in channels. IN_APP rides the existing
 * notifications inbox (InboxService.record — the module vocabulary IS the
 * category vocabulary); EMAIL/SMS/WHATSAPP ride the outbound pipeline
 * (rendered from the template substrate, BR-067).
 */

import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { InboxService, type NotificationCategory } from "../../notifications/application/inbox-service";
import type { OutboundChannel } from "../domain/channel-port";
import { OutboxError } from "../domain/communication-errors";
import { OutboxService } from "./outbox/outbox-service";
import { TemplateService, type RenderedTemplate } from "./template-service";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("preference access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The module vocabulary (the in-app categories + digest — ONE vocabulary). */
export const PREFERENCE_MODULES: readonly string[] = [
  "limits",
  "subscription",
  "reconciliation",
  "invoice_overdue",
  "stock",
  "templates",
  "crm",
  "einvoicing",
  "notes",
  "installments",
  "budgeting",
  "purchasing",
  "collections",
  "warranties",
  "digest",
];

export const PREFERENCE_CHANNELS: readonly ["IN_APP", "EMAIL", "SMS", "WHATSAPP"] = [
  "IN_APP",
  "EMAIL",
  "SMS",
  "WHATSAPP",
];

/** The code default (the migration seed's twin — the paid channels off). */
export const CODE_DEFAULTS: Readonly<Record<string, boolean>> = Object.freeze({
  IN_APP: true,
  EMAIL: true,
  SMS: false,
  WHATSAPP: false,
});

/** The matrix channels for a user × module. */
export interface ChannelDecision {
  readonly IN_APP: boolean;
  readonly EMAIL: boolean;
  readonly SMS: boolean;
  readonly WHATSAPP: boolean;
}

/** The categories the in-app inbox accepts (everything but digest). */
const INBOX_CATEGORIES = new Set<string>(PREFERENCE_MODULES.filter((m) => m !== "digest"));

export class PreferencesService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly templates: TemplateService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * Materialize the tenant-default rows lazily (tenants provisioned after
   * 0064; idempotent — ON CONFLICT DO NOTHING). Called on first read.
   */
  async ensureDefaults(): Promise<void> {
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO notification_preferences (id, tenant_id, user_id, module, channel, enabled)
      SELECT gen_random_uuid(), erp.current_tenant_id(), NULL, m.module, c.channel, c.enabled
      FROM (VALUES
        ('limits'), ('subscription'), ('reconciliation'), ('invoice_overdue'),
        ('stock'), ('templates'), ('crm'), ('einvoicing'), ('notes'),
        ('installments'), ('budgeting'), ('purchasing'), ('collections'),
        ('warranties'), ('digest')
      ) AS m(module)
      CROSS JOIN (VALUES
        ('IN_APP', true), ('EMAIL', true), ('SMS', false), ('WHATSAPP', false)
      ) AS c(channel, enabled)
      ON CONFLICT (tenant_id, user_id, module, channel) DO NOTHING`);
  }

  /** The effective matrix for a user × module (user → default → code). */
  async resolveChannels(userId: string, module: string): Promise<ChannelDecision> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT channel, enabled FROM notification_preferences
      WHERE (user_id = ${userId} OR user_id IS NULL)
        AND module = ${module}
      ORDER BY user_id NULLS LAST`);
    const byChannel = new Map<string, { enabled: boolean; isUserRow: boolean }>();
    for (const raw of rows.rows as unknown as { channel: string; enabled: boolean }[]) {
      // user_id NULLS LAST: the first row per channel in the ordering is
      // the USER row when present, else the tenant default.
      if (!byChannel.has(raw.channel)) {
        byChannel.set(raw.channel, { enabled: raw.enabled, isUserRow: true });
      }
    }
    const decision = {} as Record<string, boolean>;
    for (const channel of PREFERENCE_CHANNELS) {
      decision[channel] = byChannel.get(channel)?.enabled ?? CODE_DEFAULTS[channel]!;
    }
    return decision as unknown as ChannelDecision;
  }

  /** The full matrix read for the UI (per module × channel booleans). */
  async matrixForUser(userId: string): Promise<readonly {
    module: string;
    channels: { IN_APP: boolean; EMAIL: boolean; SMS: boolean; WHATSAPP: boolean };
    explicit: boolean;
  }[]> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT module, channel, enabled FROM notification_preferences
      WHERE user_id = ${userId} ORDER BY module, channel`);
    const explicit = new Map<string, boolean>();
    for (const raw of rows.rows as unknown as { module: string; channel: string; enabled: boolean }[]) {
      explicit.set(`${raw.module}|${raw.channel}`, raw.enabled);
    }
    const matrix: {
      module: string;
      channels: { IN_APP: boolean; EMAIL: boolean; SMS: boolean; WHATSAPP: boolean };
      explicit: boolean;
    }[] = [];
    for (const module of PREFERENCE_MODULES) {
      const decision = await this.resolveChannels(userId, module);
      const hasAny = PREFERENCE_CHANNELS.some((channel) =>
        explicit.has(`${module}|${channel}`),
      );
      matrix.push({ module, channels: decision, explicit: hasAny });
    }
    return matrix;
  }

  /** The self plane: a user upserts their OWN row. */
  async upsertSelf(
    userId: string,
    input: { module: string; channel: string; enabled: boolean },
  ): Promise<void> {
    this.validateMatrixKey(input.module, input.channel);
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO notification_preferences (id, tenant_id, user_id, module, channel, enabled, updated_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${userId},
              ${input.module}, ${input.channel}, ${input.enabled}, ${userId})
      ON CONFLICT (tenant_id, user_id, module, channel) DO UPDATE
        SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by,
            updated_at = now(), version = notification_preferences.version + 1`);
  }

  /** The tenant-default rows (the defaults plane's read). */
  async listDefaults(): Promise<
    ReadonlyArray<{
      module: string;
      channel: string;
      enabled: boolean;
    }>
  > {
    await this.ensureDefaults();
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT module, channel, enabled FROM notification_preferences
      WHERE user_id IS NULL ORDER BY module, channel`);
    return rows.rows as unknown as { module: string; channel: string; enabled: boolean }[];
  }

  /** The tenant-default plane (communication.preferences.manage). */
  async upsertDefault(
    actorId: string,
    input: { module: string; channel: string; enabled: boolean },
  ): Promise<void> {
    this.validateMatrixKey(input.module, input.channel);
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO notification_preferences (id, tenant_id, user_id, module, channel, enabled, updated_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), NULL,
              ${input.module}, ${input.channel}, ${input.enabled}, ${actorId})
      ON CONFLICT (tenant_id, user_id, module, channel) DO UPDATE
        SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by,
            updated_at = now(), version = notification_preferences.version + 1`);
  }

  private validateMatrixKey(module: string, channel: string): void {
    if (!PREFERENCE_MODULES.includes(module)) {
      throw new PreferencesErrorWrapper(`unknown module ${module}`);
    }
    if (!PREFERENCE_CHANNELS.includes(channel as "IN_APP")) {
      throw new PreferencesErrorWrapper(`unknown channel ${channel}`);
    }
  }

  // -- the dispatch resolver (the acceptance's end-to-end) -------------------

  /**
   * Dispatch a templated USER notification honoring the matrix: IN_APP
   * rides the existing inbox (the category vocabulary); EMAIL/SMS/WHATSAPP
   * ride the outbound pipeline (rendered from the template substrate —
   * the caller passes the template key + variables; the WHATSAPP leg
   * carries the approved-template name + positional params).
   *
   * Returns the per-channel outcomes (delivered/enqueued/suppressed).
   */
  async dispatchUserNotification(input: {
    userId: string;
    module: string;
    templateKey: string;
    severity?: "info" | "warning" | "critical";
    title?: { ar: string; en: string };
    actionUrl?: string;
    dedupeKey?: string;
    variables: Readonly<Record<string, string>>;
    sourceType?: "DIGEST" | "NUDGE" | "NOTIFICATION" | "MANUAL";
    sourceId?: string | null;
  }): Promise<{
    inApp: boolean;
    email: "suppressed" | "enqueued" | "no-recipient";
    sms: "suppressed" | "enqueued" | "no-recipient";
    whatsapp: "suppressed" | "enqueued" | "no-recipient" | "no-template";
  }> {
    this.validateMatrixKey(input.module, "IN_APP");
    const decision = await this.resolveChannels(input.userId, input.module);

    // The user's email + locale through the ACTIVE-membership join (the
    // inbox ownerTarget discipline — a user outside this tenant resolves
    // to nothing and every channel degrades to no-recipient).
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT u.email, u.locale FROM users u
      JOIN memberships m ON m.user_id = u.id
        AND m.tenant_id = erp.current_tenant_id() AND m.status = 'ACTIVE'
      WHERE u.id = ${input.userId} LIMIT 1`);
    const user = (rows.rows as unknown as { email: string; locale: string }[])[0];
    const locale: "ar" | "en" = user?.locale === "en" ? "en" : "ar";

    // IN_APP (digest has no in-app leg — it is an email surface by design).
    let inApp = false;
    if (decision.IN_APP && INBOX_CATEGORIES.has(input.module)) {
      const title = input.title ?? { ar: input.templateKey, en: input.templateKey };
      const outcome = await this.inbox.record({
        category: input.module as NotificationCategory,
        severity: input.severity ?? "info",
        title,
        body: { ar: input.variables["body_ar"] ?? input.templateKey, en: input.variables["body_en"] ?? input.templateKey },
        actionUrl: input.actionUrl,
        dedupeKey: input.dedupeKey,
        userId: input.userId,
      });
      inApp = outcome.inserted;
    }

    const render = async (channel: OutboundChannel): Promise<RenderedTemplate | null> =>
      this.templates.render(input.templateKey, channel, locale, input.variables).catch(() => null);

    // EMAIL
    let email: "suppressed" | "enqueued" | "no-recipient" = "suppressed";
    if (decision.EMAIL) {
      if (user === undefined || user.email.length === 0) {
        email = "no-recipient";
      } else {
        const rendered = await render("EMAIL");
        if (rendered !== null) {
          await this.outbox.enqueue({
            channel: "EMAIL",
            recipient: user.email,
            locale,
            templateKey: input.templateKey,
            module: input.module,
            subject: rendered.subject,
            body: rendered.body,
            recipientUserId: input.userId,
            sourceType: input.sourceType ?? "NOTIFICATION",
            sourceId: input.sourceId ?? null,
          });
          email = "enqueued";
        } else {
          email = "no-recipient";
        }
      }
    }

    // SMS
    let sms: "suppressed" | "enqueued" | "no-recipient" = "suppressed";
    if (decision.SMS && user !== undefined) {
      const phone = await this.userPhone(input.userId);
      if (phone === null) {
        sms = "no-recipient";
      } else {
        const rendered = await render("SMS");
        if (rendered !== null) {
          await this.outbox.enqueue({
            channel: "SMS",
            recipient: phone,
            locale,
            templateKey: input.templateKey,
            module: input.module,
            body: rendered.body,
            recipientUserId: input.userId,
            sourceType: input.sourceType ?? "NOTIFICATION",
            sourceId: input.sourceId ?? null,
          });
          sms = "enqueued";
        } else {
          sms = "no-recipient";
        }
      }
    }

    // WHATSAPP (template messages only — the adapter fails closed without
    // an approved template; a missing WHATSAPP template degrades honestly).
    let whatsapp: "suppressed" | "enqueued" | "no-recipient" | "no-template" = "suppressed";
    if (decision.WHATSAPP && user !== undefined) {
      const phone = await this.userPhone(input.userId);
      if (phone === null) {
        whatsapp = "no-recipient";
      } else {
        const rendered = await render("WHATSAPP");
        if (rendered === null) {
          whatsapp = "no-template";
        } else {
          await this.outbox.enqueue({
            channel: "WHATSAPP",
            recipient: phone,
            locale,
            templateKey: input.templateKey,
            module: input.module,
            body: rendered.body,
            recipientUserId: input.userId,
            sourceType: input.sourceType ?? "NOTIFICATION",
            sourceId: input.sourceId ?? null,
            whatsappTemplateName: input.templateKey,
            whatsappTemplateParams: rendered.whatsappParams,
          });
          whatsapp = "enqueued";
        }
      }
    }

    return { inApp, email, sms, whatsapp };
  }

  private async userPhone(userId: string): Promise<string | null> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT u.phone FROM users u
      JOIN memberships m ON m.user_id = u.id
        AND m.tenant_id = erp.current_tenant_id() AND m.status = 'ACTIVE'
      WHERE u.id = ${userId} AND u.phone IS NOT NULL LIMIT 1`);
    const phone = (rows.rows as unknown as { phone: string }[])[0]?.phone ?? null;
    if (phone === null) {
      return null;
    }
    return phone.startsWith("+") ? phone : `+${phone}`;
  }
}

/** Local error wrapper (keeps the typed-error contract). */
class PreferencesErrorWrapper extends OutboxError {
  constructor(detail: string) {
    super("communication/preferences-invalid", detail);
  }
}
