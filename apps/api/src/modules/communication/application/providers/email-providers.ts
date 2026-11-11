/**
 * PHASE-041 (T-02 · N-08/IN-15) — the email provider adapters: SMTP (the
 * bridge onto the EXISTING notifications-module SmtpTransport seam), plus
 * the API providers (SendGrid, SES, Mailgun). Environment-selectable per
 * provider kind — the T-03 selection; deliverability (DKIM/SPF/DMARC) is
 * the T-12 operations guide, not adapter code.
 *
 * Wire contracts (versioned, pinned):
 * - SMTP: the PHASE-003 socket client (smtp-mailer.ts) — zero new surface.
 * - SendGrid: v3/mail/send — Bearer key, JSON body, 202 + X-Message-Id.
 * - SES: the v2 SendEmail API (email.<region>.amazonaws.com/v2/email/
 *   outbound-emails) with inline AWS SigV4 signing over the HTTP seam —
 *   zero new dependencies, uniform fake-transport testability; the signing
 *   spec pins the OFFICIAL AWS SigV4 test vector.
 * - Mailgun: v3/<domain>/messages — Basic auth (api:key), form body →
 *   { id, message }.
 *
 * REQUIRES_VERIFICATION: SES + Mailgun carry the flag until a live send is
 * verified per environment (the T-12 checklist).
 */

import {
  isEmailShape,
  type OutboundChannelPort,
  type OutboundSendRequest,
  type OutboundSendResult,
} from "../../domain/channel-port";
import { parseJsonBody, type ProviderHttpTransport } from "./provider-http";
import { sha256Hex, sigV4Authorization } from "./aws-sigv4";
import type { SmtpTransport } from "../../../notifications/infrastructure/smtp-mailer";

// -- SMTP (the bridge onto the existing seam) --------------------------------

export interface SmtpProviderConfig {
  readonly host: string;
  readonly port: number;
  readonly user?: string;
  readonly pass?: string;
  /** The envelope sender (DKIM-aligned From — the T-12 guide). */
  readonly fromAddress: string;
  /** An injected transport (tests); undefined → the socket client. */
  readonly transport?: SmtpTransport;
}

export class SmtpEmailAdapter implements OutboundChannelPort {
  readonly id = "smtp";
  readonly kind = "EMAIL" as const;

  constructor(
    private readonly config: SmtpProviderConfig,
    private readonly fallbackTransport: () => SmtpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "EMAIL") {
      return { ok: false, error: "smtp-channel-mismatch" };
    }
    if (!isEmailShape(request.to)) {
      return { ok: false, error: `smtp-invalid-recipient:${request.to}` };
    }
    const subject = request.subject ?? "";
    if (subject.length === 0) {
      return { ok: false, error: "smtp-subject-required" };
    }
    const transport = this.config.transport ?? this.fallbackTransport();
    try {
      await transport.send({
        from: request.senderId ?? this.config.fromAddress,
        to: request.to,
        subject,
        body: request.body,
      });
      // Synchronous SMTP acceptance = the message is in flight (the 250
      // ok); delivery confirmations are the receiving server's business —
      // the ledger row walks QUEUED → SENT.
      return { ok: true, providerMessageId: `smtp-${Date.now()}` };
    } catch (error) {
      return {
        ok: false,
        error: `smtp-failed:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

// -- SendGrid ----------------------------------------------------------------

export interface SendGridCredentials {
  readonly apiKey: string;
  readonly fromAddress: string;
  readonly fromName?: string;
}

export class SendGridAdapter implements OutboundChannelPort {
  readonly id = "sendgrid";
  readonly kind = "EMAIL" as const;

  constructor(
    private readonly credentials: SendGridCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "EMAIL") {
      return { ok: false, error: "sendgrid-channel-mismatch" };
    }
    if (!isEmailShape(request.to)) {
      return { ok: false, error: `sendgrid-invalid-recipient:${request.to}` };
    }
    const subject = request.subject ?? "";
    if (subject.length === 0) {
      return { ok: false, error: "sendgrid-subject-required" };
    }
    const payload = {
      personalizations: [{ to: [{ email: request.to }] }],
      from: {
        email: this.credentials.fromAddress,
        name: this.credentials.fromName,
      },
      subject,
      content: [{ type: "text/plain", value: request.body }],
    };
    try {
      const response = await this.transport({
        url: "https://api.sendgrid.com/v3/mail/send",
        method: "POST",
        headers: {
          authorization: `Bearer ${this.credentials.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      });
      if (response.status === 202) {
        // SendGrid's message id rides the X-Message-Id header.
        const messageId = response.headers?.["x-message-id"];
        return {
          ok: true,
          providerMessageId:
            typeof messageId === "string" && messageId.length > 0
              ? messageId
              : `sendgrid-${Date.now()}`,
        };
      }
      const parsed = parseJsonBody(response.body);
      const errors = parsed.errors as { message?: string }[] | undefined;
      return {
        ok: false,
        error: `sendgrid-http-${response.status}:${errors?.[0]?.message ?? "unspecified"}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        error: `sendgrid-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

// -- SES (v2 SendEmail + inline SigV4) ---------------------------------------

export interface SesCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly fromAddress: string;
}

export class SesAdapter implements OutboundChannelPort {
  readonly id = "ses";
  readonly kind = "EMAIL" as const;

  constructor(
    private readonly credentials: SesCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "EMAIL") {
      return { ok: false, error: "ses-channel-mismatch" };
    }
    if (!isEmailShape(request.to)) {
      return { ok: false, error: `ses-invalid-recipient:${request.to}` };
    }
    const subject = request.subject ?? "";
    if (subject.length === 0) {
      return { ok: false, error: "ses-subject-required" };
    }
    const body = JSON.stringify({
      FromEmailAddress: request.senderId ?? this.credentials.fromAddress,
      Destination: { ToAddresses: [request.to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: request.body, Charset: "UTF-8" } },
        },
      },
    });
    const now = new Date();
    const amzDate = `${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
    const dateStamp = amzDate.slice(0, 8);
    const url = new URL(
      `https://email.${this.credentials.region}.amazonaws.com/v2/email/outbound-emails`,
    );
    // The SES v2 signed header set: content-type, host, payload hash, date.
    const headers = {
      "content-type": "application/json",
      host: url.host,
      "x-amz-content-sha256": sha256Hex(body),
      "x-amz-date": amzDate,
    };
    const authorization = sigV4Authorization({
      method: "POST",
      url,
      headers,
      payload: body,
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      region: this.credentials.region,
      service: "ses",
      amzDate,
      dateStamp,
    });
    const signedHeaders = {
      "x-amz-date": amzDate,
      "x-amz-content-sha256": headers["x-amz-content-sha256"]!,
      authorization,
    };
    try {
      const response = await this.transport({
        url: url.toString(),
        method: "POST",
        headers: { "content-type": "application/json", ...signedHeaders },
        body,
        timeoutMs: 10_000,
      });
      if (response.status === 200) {
        const parsed = parseJsonBody(response.body);
        const messageId =
          typeof parsed.MessageId === "string" ? parsed.MessageId : undefined;
        return {
          ok: true,
          providerMessageId: messageId ?? `ses-${Date.now()}`,
        };
      }
      return {
        ok: false,
        error: `ses-http-${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        error: `ses-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

// -- Mailgun -----------------------------------------------------------------

export interface MailgunCredentials {
  readonly apiKey: string;
  /** The verified sending domain (DKIM — the T-12 checklist). */
  readonly domain: string;
  readonly fromAddress: string;
  /** The regional base (api.eu.mailgun.net for the EU region). */
  readonly baseUrl?: string;
}

export class MailgunAdapter implements OutboundChannelPort {
  readonly id = "mailgun";
  readonly kind = "EMAIL" as const;

  constructor(
    private readonly credentials: MailgunCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "EMAIL") {
      return { ok: false, error: "mailgun-channel-mismatch" };
    }
    if (!isEmailShape(request.to)) {
      return { ok: false, error: `mailgun-invalid-recipient:${request.to}` };
    }
    const subject = request.subject ?? "";
    if (subject.length === 0) {
      return { ok: false, error: "mailgun-subject-required" };
    }
    const base = this.credentials.baseUrl ?? "https://api.mailgun.net";
    const url = `${base}/v3/${this.credentials.domain}/messages`;
    const params = new URLSearchParams({
      from: request.senderId ?? this.credentials.fromAddress,
      to: request.to,
      subject,
      text: request.body,
    });
    const basic = Buffer.from(`api:${this.credentials.apiKey}`).toString("base64");
    try {
      const response = await this.transport({
        url,
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
        timeoutMs: 10_000,
      });
      if (response.status === 200) {
        const parsed = parseJsonBody(response.body);
        const messageId = typeof parsed.id === "string" ? parsed.id : undefined;
        return { ok: true, providerMessageId: messageId ?? `mailgun-${Date.now()}` };
      }
      return {
        ok: false,
        error: `mailgun-http-${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        error: `mailgun-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}
