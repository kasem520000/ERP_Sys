/**
 * PHASE-041 (CR-11 · H-22/N-06/N-07/N-08) — the OUTBOUND channel port.
 *
 * BR-067 (channel-port isolation, BUSINESS_RULES.md): EVERY outbound send
 * goes through this port; no provider is ever invoked outside it; the
 * SANDBOX provider is the default until a real provider is configured AND
 * credentialed — zero external calls before that (the network-blocked
 * proof pins it).
 *
 * This is the OUTBOUND business-messaging port (WhatsApp/SMS/email to
 * customers and users) — distinct from the PHASE-022 PUSH channel port
 * (NotificationChannelPort, FCM device push), which stays untouched in the
 * notifications module. The §3.5 discipline carries over verbatim:
 *
 * - The CALLER resolves the template + locale BEFORE the call — the port
 *   receives the RESOLVED body/subject (byte-stable pure rendering), never
 *   a render instruction. `templateKey` travels on the ledger row for
 *   trace, not on the wire contract.
 * - Best-effort with retry: the IMPLEMENTOR reports failures through the
 *   result ({ok:false, retryable}), never by throwing (transient transport
 *   failures are retryable; rejections are not). The LEDGER owns the
 *   bounded retry policy with backoff (attempts/max_attempts/
 *   next_attempt_at on outbound_messages) — the implementor only labels
 *   retryability.
 * - Cost: providers that report per-message cost return it; the pipeline
 *   stamps it on the ledger row (advisory data — never a posting).
 * - NO financial payloads: `data` carries the safe vocabulary only
 *   (document numbers, names, dates, trace keys — never an
 *   amount/price/balance key); the adapters sanitize at the wire.
 */

/** The outbound channel vocabulary (the ledger's channel CHECK). */
export type OutboundChannel = "EMAIL" | "WHATSAPP" | "SMS";

/** A send request with everything resolved by the caller. */
export interface OutboundSendRequest {
  /** Quota + trace scope (the outbound ledger row's tenant). */
  readonly tenantId: string;
  readonly channel: OutboundChannel;
  /**
   * The recipient — an email address (EMAIL) or an E.164 phone
   * (+9665…) (WHATSAPP/SMS). Shape-checked by the adapters.
   */
  readonly to: string;
  /** The locale the payload was rendered in (resolved BEFORE the call). */
  readonly renderedFor: "ar" | "en";
  /** EMAIL subject (rendered; required for EMAIL — the pipeline enforces). */
  readonly subject?: string;
  /** The locale-resolved message body (byte-stable pure rendering). */
  readonly body: string;
  /**
   * The provider-specific sender identity resolved by the CALLER from the
   * per-market configuration (T-03): the WhatsApp phone-number id, the
   * SMS sender name, the email envelope-from override. Optional —
   * providers fall back to their configured default.
   */
  readonly senderId?: string;
  /**
   * WhatsApp Business template-message sends (the ONLY shape WhatsApp
   * allows for business-initiated conversations outside the 24h window —
   * the phase's "template messages" scope): the approved template name +
   * its language + the ordered body parameters.
   */
  readonly whatsappTemplateName?: string;
  readonly whatsappTemplateLanguage?: string;
  readonly whatsappTemplateParams?: readonly string[];
  /**
   * The safe mobile/data vocabulary (document numbers, names, dates,
   * trace keys). Providers sanitize at the wire; never an
   * amount/price/balance key.
   */
  readonly data?: Readonly<Record<string, string>>;
}

/** A provider's delivery receipt (BR-067's result contract). */
export interface OutboundSendResult {
  /** false = not delivered — reported, never thrown (best-effort). */
  readonly ok: boolean;
  /** The provider's message id (traceability onto the ledger row). */
  readonly providerMessageId?: string;
  /** Provider-reported per-message cost (advisory; never a posting). */
  readonly cost?: { readonly amount: string; readonly currency: string };
  /**
   * Provider-reported INSTANT delivery confirmation (the SANDBOX adapter
   * and synchronous SMTP acceptances set this; WhatsApp/SMS delivery
   * receipts arrive via webhooks — out of scope, the row stays SENT).
   */
  readonly delivered?: boolean;
  /** Machine-readable failure reason (provider-<status> / network / …). */
  readonly error?: string;
  /** The LEDGER's retry policy consumes this label (transient vs rejection). */
  readonly retryable?: boolean;
}

/**
 * The outbound channel port (BR-067). Implementations:
 * `sandbox` (the default — zero external calls), `whatsapp-business`,
 * `unifonic`, `msegat`, `twilio`, `smtp`, `sendgrid`, `ses`, `mailgun`.
 */
export interface OutboundChannelPort {
  /** The provider id recorded on the ledger row + settings selection. */
  readonly id: string;
  readonly kind: OutboundChannel;
  send(request: OutboundSendRequest): Promise<OutboundSendResult>;
}

/** The safe data vocabulary — the §3.5 whitelist discipline (never money). */
const SAFE_DATA_KEY = /^[a-z][a-z0-9_]{0,40}$/;
const FORBIDDEN_DATA_KEYS = new Set([
  "amount",
  "price",
  "balance",
  "total",
  "subtotal",
  "vat",
  "tax",
  "payment",
  "credit",
  "debit",
]);

/** Whitelist-check a data payload at the wire (adapters call this). */
export function sanitizeSafeData(
  data: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (data === undefined) {
    return {};
  }
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!SAFE_DATA_KEY.test(key) || FORBIDDEN_DATA_KEYS.has(key)) {
      // Never throw (best-effort): drop the unsafe pair silently — the
      // payload is auxiliary telemetry, not the message itself.
      continue;
    }
    if (typeof value === "string" && value.length <= 500) {
      safe[key] = value;
    }
  }
  return safe;
}

/** E.164 shape (WHATSAPP/SMS recipients). */
export function isE164Phone(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

/** Loose email shape (the SMTP envelope seam does the real work). */
export function isEmailShape(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;
}
