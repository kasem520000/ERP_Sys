import { sql } from "drizzle-orm";

import { childLogger } from "../../../infra/observability/logger";
import { getDb } from "../../../infra/db/client";
import type {
  ChannelSendResult,
  NotificationChannelPort,
} from "./channel-port";
import {
  renderPushMessage,
  type PushTemplate,
  type PushTemplateVars,
} from "./fcm-templates";

/**
 * PHASE-022 · DR-P22-07 — the push channel orchestrator: the caller that
 * resolves EVERYTHING §3.5 demands before the port call —
 *
 * - the device's FCM token from the registry (device_push_tokens, opted_in
 *   per device — the table the opt-in surface writes; default OFF);
 * - the device's notification locale → template + locale resolved BEFORE
 *   the channel call (the port receives the rendered title/body and the
 *   `renderedFor` marker, never a render instruction);
 * - the safe data payload (template variables + trace keys — the adapter
 *   whitelists again at the wire; no financial fields by construction).
 *
 * Reads are context-less (devices/device_push_tokens are service-mediated —
 * the findDeviceUser precedent in the devices controller): the ambient
 * tenant never gates them, the callers pass tenantId explicitly for the
 * quota + trace scope. Outcomes are REPORTED, never thrown (best-effort):
 * {sent:false, reason} for the pre-wire refusals.
 *
 * The production fan-out wiring (which events push to which devices) lands
 * with the client-side contract consumers (handoff 3-b/4-x); the service is
 * DI-ready through NOTIFICATION_CHANNEL + this provider.
 */

const log = childLogger({ module: "notifications" });

/** Why a push did not reach the wire (all pre-port refusals). */
export type PushRefusal =
  | "unknown-device"
  | "device-revoked"
  | "no-token-registered"
  | "opted-out";

export interface PushOutcome {
  readonly sent: boolean;
  readonly refusal?: PushRefusal;
  /** The channel receipt when the wire was reached (ok or not). */
  readonly result?: ChannelSendResult;
}

export interface PushToDeviceInput {
  readonly tenantId: string;
  readonly deviceId: string;
  /** The device's user (trace; defaults to the registry row's user). */
  readonly userId?: string;
  readonly template: PushTemplate;
  readonly category: string;
  readonly vars: PushTemplateVars;
}

interface DeviceWithToken {
  readonly userId: string;
  readonly revokedAt: Date | null;
  readonly token: string | null;
  readonly optedIn: boolean | null;
  readonly locale: "ar" | "en" | null;
}

/** Pick the defined string values into a flat payload (the safe vocabulary —
 * the adapter whitelists again at the wire; never a financial field). */
function compactVars(vars: PushTemplateVars): Record<string, string> {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value === "string") {
      payload[key] = value;
    }
  }
  return payload;
}

export class PushChannelService {
  constructor(private readonly channel: NotificationChannelPort) {}

  async sendToDevice(input: PushToDeviceInput): Promise<PushOutcome> {
    const rows = await getDb().execute(sql`
      SELECT d.user_id AS "userId", d.revoked_at AS "revokedAt",
             t.token AS "token", t.opted_in AS "optedIn", t.locale AS "locale"
      FROM devices d
      LEFT JOIN device_push_tokens t ON t.device_id = d.id
      WHERE d.id = ${input.deviceId}
      LIMIT 1
    `);
    const device = (rows.rows as unknown as DeviceWithToken[])[0];
    if (device === undefined) {
      return { sent: false, refusal: "unknown-device" };
    }
    if (device.revokedAt !== null) {
      // Belt: revocation also clears the token rows — a stale row that
      // somehow survives still never reaches the wire.
      return { sent: false, refusal: "device-revoked" };
    }
    if (device.token === null || device.optedIn === null) {
      return { sent: false, refusal: "no-token-registered" };
    }
    if (!device.optedIn) {
      return { sent: false, refusal: "opted-out" };
    }

    // §3.5: template + locale resolved BEFORE the call — the port receives
    // the rendered payload + the locale it was rendered for.
    const locale = device.locale ?? "ar";
    const rendered = renderPushMessage(input.template, locale, input.vars);
    const result = await this.channel.send({
      tenantId: input.tenantId,
      userId: input.userId ?? device.userId,
      deviceToken: device.token,
      templateId: input.template,
      renderedFor: locale,
      title: rendered.title,
      body: rendered.body,
      // The data payload rides the template's safe vocabulary; the adapter
      // whitelists again at the wire (a poisoned key never reaches FCM).
      data: {
        ...compactVars(input.vars),
        templateId: input.template,
        renderedFor: locale,
        category: input.category,
      },
      category: input.category,
    });
    log.info(
      {
        channel: "fcm",
        template: input.template,
        rendered_for: locale,
        ok: result.ok,
        ...(result.providerMessageId === undefined ? {} : { provider_message_id: result.providerMessageId }),
      },
      "fcm send resolved",
    );
    return { sent: true, result };
  }
}
