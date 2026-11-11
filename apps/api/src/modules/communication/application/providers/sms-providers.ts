/**
 * PHASE-041 (T-02 · N-07/IN-14) — the MENA SMS adapters: Unifonic and
 * Msegat (the regional defaults) plus Twilio (the international fallback).
 * All three ride the SAME OutboundChannelPort through the HTTP seam; per-
 * market selection is the T-03 configuration decision, never code.
 *
 * Wire contracts (versioned, pinned):
 * - Unifonic: REST gateway — AppSid + Recipient + Body (+ SenderName) →
 *   { success, MessageID, Code } (docs.unifonic.com, 2025-11 snapshot).
 * - Msegat: JSON gateway — username + password + senderName + numbers +
 *   msg → { code, messageID, status } (msegat.com, 2025-11 snapshot).
 * - Twilio: classic Messages.json — Basic auth + form body → { sid, status }
 *   (2010-04-01 API, the long-stable surface).
 *
 * REQUIRES_VERIFICATION: all three carry the flag (sender-name
 * registration per operator; the checklist ships with T-12's guide).
 */

import {
  isE164Phone,
  type OutboundChannelPort,
  type OutboundSendRequest,
  type OutboundSendResult,
} from "../../domain/channel-port";
import { parseJsonBody, type ProviderHttpTransport } from "./provider-http";

// -- Unifonic ----------------------------------------------------------------

export interface UnifonicCredentials {
  readonly appSid: string;
  /** The registered sender name (optional — the account default applies). */
  readonly senderName?: string;
}

const UNIFONIC_BASE_URL = "https://api.unifonic.com/v1/gateway/Messages/Send";

export class UnifonicAdapter implements OutboundChannelPort {
  readonly id = "unifonic";
  readonly kind = "SMS" as const;

  constructor(
    private readonly credentials: UnifonicCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "SMS") {
      return { ok: false, error: "unifonic-channel-mismatch" };
    }
    if (!isE164Phone(request.to)) {
      return { ok: false, error: `unifonic-invalid-recipient:${request.to}` };
    }
    const sender = request.senderId ?? this.credentials.senderName;
    // Unifonic's REST gateway takes a form-encoded body: AppSid,
    // Recipient (E.164 without the +), Body, optional SenderName.
    const params = new URLSearchParams({
      AppSid: this.credentials.appSid,
      Recipient: request.to.replace(/^\+/, ""),
      Body: request.body,
    });
    if (sender !== undefined && sender.length > 0) {
      params.set("SenderName", sender);
    }
    try {
      const response = await this.transport({
        url: UNIFONIC_BASE_URL,
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        timeoutMs: 10_000,
      });
      const parsed = parseJsonBody(response.body);
      const success = parsed.success === true || parsed.success === "true";
      const messageId =
        typeof parsed.MessageID === "string"
          ? parsed.MessageID
          : typeof parsed.messageID === "string"
            ? parsed.messageID
            : undefined;
      if (success && messageId !== undefined) {
        return { ok: true, providerMessageId: messageId };
      }
      return {
        ok: false,
        error: `unifonic-rejected:${String(parsed.Code ?? response.status)}`,
        retryable: response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        error: `unifonic-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

// -- Msegat ------------------------------------------------------------------

export interface MsegatCredentials {
  readonly username: string;
  readonly password: string;
  readonly senderName: string;
}

const MSEGAT_URL = "https://www.msegat.com/gw/sendsms.php";

export class MsegatAdapter implements OutboundChannelPort {
  readonly id = "msegat";
  readonly kind = "SMS" as const;

  constructor(
    private readonly credentials: MsegatCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "SMS") {
      return { ok: false, error: "msegat-channel-mismatch" };
    }
    if (!isE164Phone(request.to)) {
      return { ok: false, error: `msegat-invalid-recipient:${request.to}` };
    }
    const payload = {
      username: this.credentials.username,
      password: this.credentials.password,
      // The caller-resolved per-market sender name overrides the default.
      senderName: request.senderId ?? this.credentials.senderName,
      numbers: request.to.replace(/^\+/, ""),
      msg: request.body,
      // Unicode (Arabic) content — Msegat's encoding flag for non-GSM text.
      msgEncoding: "UTF-8",
    };
    try {
      const response = await this.transport({
        url: MSEGAT_URL,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      });
      const parsed = parseJsonBody(response.body);
      // Msegat's shape: { code: "1" | number, messageID, status } — code 1
      // is success; everything else is a rejection (their vocabulary).
      const code = String(parsed.code ?? "");
      const messageId =
        typeof parsed.messageID === "string" ? parsed.messageID : undefined;
      if (code === "1" && messageId !== undefined) {
        return { ok: true, providerMessageId: messageId };
      }
      return {
        ok: false,
        error: `msegat-rejected:${code || response.status}`,
        retryable: response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        error: `msegat-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

// -- Twilio ------------------------------------------------------------------

export interface TwilioCredentials {
  readonly accountSid: string;
  readonly authToken: string;
  /** The default E.164 from-number (senderId overrides per market). */
  readonly fromNumber: string;
}

export class TwilioAdapter implements OutboundChannelPort {
  readonly id = "twilio";
  readonly kind = "SMS" as const;

  constructor(
    private readonly credentials: TwilioCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "SMS") {
      return { ok: false, error: "twilio-channel-mismatch" };
    }
    if (!isE164Phone(request.to)) {
      return { ok: false, error: `twilio-invalid-recipient:${request.to}` };
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.credentials.accountSid}/Messages.json`;
    const params = new URLSearchParams({
      To: request.to,
      From: request.senderId ?? this.credentials.fromNumber,
      Body: request.body,
    });
    const basic = Buffer.from(
      `${this.credentials.accountSid}:${this.credentials.authToken}`,
    ).toString("base64");
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
      const parsed = parseJsonBody(response.body);
      if (response.status >= 200 && response.status < 300) {
        const sid = typeof parsed.sid === "string" ? parsed.sid : undefined;
        if (sid !== undefined) {
          return { ok: true, providerMessageId: sid };
        }
        return { ok: false, error: "twilio-malformed-success-response" };
      }
      return {
        ok: false,
        error: `twilio-http-${response.status}:${String(parsed.code ?? "")}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    } catch (error) {
      return {
        ok: false,
        error: `twilio-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}
