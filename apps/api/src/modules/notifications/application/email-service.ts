import { createHash } from "node:crypto";

import { childLogger } from "../../../infra/observability/logger";
import { getCorrelationId } from "../../../infra/observability/request-context";
import { JobsService } from "../../../infra/jobs/boss";
import { renderEmail, type EmailPayload } from "./templates";
import type { SmtpTransport } from "../infrastructure/smtp-mailer";
import { smtpTransportFromEnv } from "../infrastructure/smtp-mailer";

/**
 * Email service (PHASE-003 §2.8; ADR-0008): sends run as pg-boss jobs —
 * tenant-scoped payloads (tenantId + correlationId per the PHASE-002 job
 * contract), no secrets in the queue, handlers idempotent by a
 * deterministic jobId derived from (template, recipient, token digest): a
 * duplicate enqueue coalesces into the single send the queue already
 * guarantees (proven by the db suite).
 */

const log = childLogger({ module: "notifications" });

export const EMAIL_QUEUE = "notifications-email";

export interface EmailServiceDeps {
  readonly jobs: JobsService;
  readonly transport?: SmtpTransport;
  /** Base URL for links inside emails (BFF origin). */
  readonly webBaseUrl: string;
  /** Envelope sender (env SMTP_FROM; dev default documented in .env.example). */
  readonly fromAddress: string;
}

interface EmailJobPayload {
  tenantId: string;
  correlationId?: string;
  email: EmailPayload;
}

export type { EmailJobPayload };

export class EmailService {
  private readonly transport: SmtpTransport;

  constructor(private readonly deps: EmailServiceDeps) {
    this.transport = deps.transport ?? smtpTransportFromEnv();
  }

  /** Enqueue a templated email — returns once the job is durable. */
  async enqueue(tenantId: string, payload: EmailPayload): Promise<void> {
    const fingerprint = createHash("sha256")
      .update(`${payload.template}:${payload.recipient}:${JSON.stringify(payload.variables)}`)
      .digest("hex");
    // Same logical email → same jobId → pg-boss executes it exactly once
    // even when two flows race to enqueue (e.g. double-clicked invite).
    // pg-boss validates job ids as UUIDs: shape the fingerprint as one
    // (deterministic derivation, still unique per logical email).
    const hex = fingerprint.slice(0, 32);
    const jobId = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
    await this.deps.jobs.publish<EmailJobPayload>(
      EMAIL_QUEUE,
      {
        tenantId,
        correlationId: getCorrelationId(),
        email: payload,
      },
      { jobId, maxAttempts: 3 },
    );
  }

  /** Job handler (registered by NotificationsModule in api + worker modes). */
  async handleJob(payload: EmailJobPayload): Promise<void> {
    const rendered = renderEmail(payload.email);
    await this.transport.send({
      from: this.deps.fromAddress,
      to: payload.email.recipient,
      subject: rendered.subject,
      body: rendered.body,
    });
    log.info(
      { template: payload.email.template, correlation_id: payload.correlationId },
      "email delivered",
    );
  }
}

// -- convenience senders used by the identity flows -------------------------

export interface IdentityEmailSenders {
  readonly sendInvitation: (input: {
    tenantId: string;
    email: string;
    locale: string;
    token: string;
    tenantName: string;
    tenantNameAr: string | null;
    roleName: string;
    roleNameAr: string | null;
  }) => Promise<void>;
  readonly sendPasswordReset: (input: {
    tenantId: string | null;
    email: string;
    locale: string;
    token: string;
  }) => Promise<void>;
  readonly sendLoginNotification: (input: {
    tenantId: string | null;
    email: string;
    locale: string;
    ip: string;
    at: string;
  }) => Promise<void>;
}

/** Bind the identity senders to an EmailService + base URL. */
export function identitySenders(
  email: EmailService,
  webBaseUrl: string,
): IdentityEmailSenders {
  const localeOf = (locale: string): "ar" | "en" => (locale === "en" ? "en" : "ar");
  return {
    sendInvitation: (input) =>
      email.enqueue(input.tenantId, {
        template: "invitation",
        locale: localeOf(input.locale),
        recipient: input.email,
        variables: {
          tenantName:
            input.locale === "en" ? input.tenantName : (input.tenantNameAr ?? input.tenantName),
          roleName:
            input.locale === "en" ? input.roleName : (input.roleNameAr ?? input.roleName),
          acceptUrl: `${webBaseUrl}/accept-invitation?token=${encodeURIComponent(input.token)}`,
        },
      }),
    sendPasswordReset: (input) =>
      email.enqueue(input.tenantId ?? "00000000-0000-0000-0000-000000000000", {
        template: "password_reset",
        locale: localeOf(input.locale),
        recipient: input.email,
        variables: {
          resetUrl: `${webBaseUrl}/reset-password?token=${encodeURIComponent(input.token)}`,
        },
      }),
    sendLoginNotification: (input) =>
      email.enqueue(input.tenantId ?? "00000000-0000-0000-0000-000000000000", {
        template: "login_notification",
        locale: localeOf(input.locale),
        recipient: input.email,
        variables: { ip: input.ip, at: input.at },
      }),
  };
}
