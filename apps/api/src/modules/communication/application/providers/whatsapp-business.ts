/**
 * PHASE-041 (T-02 · H-22/N-06/IN-13) — the WhatsApp Business Cloud API
 * adapter (versioned: Graph v21.0 — pinned per the phase's external-API
 * volatility risk).
 *
 * Scope (the phase doc's "template messages"): business-initiated sends
 * ride ONLY approved templates (WhatsApp's own discipline — free-form text
 * is not allowed outside a 24h customer-service window, which this phase
 * does not consume). A non-template send fails closed with the typed
 * error, never a silent text fallback.
 *
 * REQUIRES_VERIFICATION (the phase's risk register): template approvals
 * and per-market number provisioning are WhatsApp-console operations —
 * the adapter surfaces provider errors verbatim (code + message on the
 * result); the registry metadata flags the approval dependency so the
 * settings UI can show the verification checklist (T-12's guide).
 *
 * Per-market sender numbers (T-03 config): the CALLER resolves the
 * phone-number id (senderId) from the tenant's market→number map; the
 * adapter falls back to the configured default number.
 */

import {
  isE164Phone,
  sanitizeSafeData,
  type OutboundChannelPort,
  type OutboundSendRequest,
  type OutboundSendResult,
} from "../../domain/channel-port";
import {
  parseJsonBody,
  type ProviderHttpTransport,
} from "./provider-http";

/** The Graph API version this adapter speaks (pinned — volatility risk). */
export const WHATSAPP_GRAPH_VERSION = "v21.0";

export interface WhatsappBusinessCredentials {
  /** The permanent system-user access token. */
  readonly accessToken: string;
  /** The default phone-number id (caller-resolved per-market ids override). */
  readonly phoneNumberId: string;
}

/** Transient Graph statuses worth a retry (the ledger's backoff consumes). */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class WhatsappBusinessAdapter implements OutboundChannelPort {
  readonly id = "whatsapp-business";
  readonly kind = "WHATSAPP" as const;

  constructor(
    private readonly credentials: WhatsappBusinessCredentials,
    private readonly transport: ProviderHttpTransport,
  ) {}

  async send(request: OutboundSendRequest): Promise<OutboundSendResult> {
    if (request.channel !== "WHATSAPP") {
      return { ok: false, error: "whatsapp-channel-mismatch" };
    }
    if (!isE164Phone(request.to)) {
      return { ok: false, error: `whatsapp-invalid-recipient:${request.to}` };
    }
    if (
      request.whatsappTemplateName === undefined ||
      request.whatsappTemplateName.length === 0
    ) {
      // WhatsApp's own rule: business-initiated sends ride approved
      // templates only — fail closed, never a free-form text fallback.
      return { ok: false, error: "whatsapp-template-required" };
    }
    const phoneNumberId = request.senderId ?? this.credentials.phoneNumberId;
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: request.to,
      type: "template",
      template: {
        name: request.whatsappTemplateName,
        language: { code: request.whatsappTemplateLanguage ?? request.renderedFor },
        components: [
          {
            type: "body",
            parameters: (request.whatsappTemplateParams ?? []).map((text) => ({
              type: "text",
              text,
            })),
          },
        ],
      },
    };
    try {
      const response = await this.transport({
        url,
        method: "POST",
        headers: {
          authorization: `Bearer ${this.credentials.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000,
      });
      if (response.status === 200) {
        const parsed = parseJsonBody(response.body);
        const messages = parsed.messages as { id?: string }[] | undefined;
        const id = Array.isArray(messages) ? messages[0]?.id : undefined;
        if (id !== undefined) {
          // WhatsApp reports no per-message cost on the send call — the
          // pricing arrives on the business-management API (out of scope);
          // cost stays unset (the ledger allows NULL).
          return { ok: true, providerMessageId: id };
        }
        return { ok: false, error: "whatsapp-malformed-success-response" };
      }
      const errorBody = parseJsonBody(response.body);
      const err = errorBody.error as { message?: string; code?: number } | undefined;
      return {
        ok: false,
        error: `whatsapp-http-${response.status}:${err?.message ?? "unspecified"}`,
        retryable: RETRYABLE_STATUSES.has(response.status),
      };
    } catch (error) {
      return {
        ok: false,
        error: `whatsapp-network:${error instanceof Error ? error.message : String(error)}`,
        retryable: true,
      };
    }
  }
}

/** The safe-payload discipline re-export (the adapter sanitizes at the wire). */
export { sanitizeSafeData };
