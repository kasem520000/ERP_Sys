/**
 * PHASE-022 · DR-P22-07 — the push channel port (integrations README §3.5,
 * "SMS / push FCM — NotificationChannelPort", the binding prescription).
 *
 * §3.5 reads verbatim: "`deliver(notification: ChannelMessage): Promise<
 * DeliveryReceipt>` — FCM device tokens come from the device registry
 * (opt-in per device); SMS providers TBD per market. Delivery is best-effort
 * with retry + per-tenant quota; template + locale (ar/en) resolved before
 * the call. Phase-gated with the Android app (PHASE-022+)."
 *
 * The reading implemented here (each clause mapped):
 * - "template + locale (ar/en) resolved before the call" → THE CALLER
 *   resolves the template registry per the device's locale BEFORE invoking
 *   the port. The port therefore receives the RESOLVED payload (title and
 *   body strings in exactly one locale) plus `renderedFor`, the locale the
 *   payload was rendered in. `templateId` is carried for trace/telemetry
 *   only — it is never a render instruction for the implementor.
 * - "FCM device tokens come from the device registry (opt-in per device)" →
 *   the caller resolves the token row (device_push_tokens, opted_in) from
 *   the registry; the port receives ONE resolved `deviceToken` per call.
 * - "best-effort with retry + per-tenant quota" → the IMPLEMENTOR owns
 *   bounded retry for transient transport failures and a per-tenant
 *   windowed quota; both report failures through the result ({ok:false}),
 *   never by throwing (best-effort).
 * - Method shape: `send(request: ChannelSendRequest): Promise<
 *   ChannelSendResult>` — the SmtpTransport seam convention (§3.4's sketch
 *   is likewise a sketch, not a literal mirror: the email side ships
 *   SmtpTransport.send(envelope)). §3.5's ChannelMessage ≡ ChannelSendRequest
 *   in its resolved-payload shape; DeliveryReceipt ≡ ChannelSendResult
 *   {ok, providerMessageId?, error?}.
 *
 * NO financial payloads: `data` carries only the safe mobile vocabulary —
 * document numbers, names, dates, trace keys (the adapters/fcm whitelist
 * enforces it at the wire; never an amount/price/balance key).
 */

/** The push channel's send request (the resolved per-device payload). */
export interface ChannelSendRequest {
  /** Per-tenant quota + trace scope (the quota is per-tenant by §3.5). */
  readonly tenantId: string;
  /** The device's user (trace; the device registry owns the linkage). */
  readonly userId?: string;
  /** The resolved FCM device token (opt-in per device — §3.5). */
  readonly deviceToken: string;
  /** The template that produced the payload below (trace only — the
   * payload is already locale-resolved; never a render instruction). */
  readonly templateId: string;
  /** §3.5: the locale the title/body were rendered in — resolved BEFORE
   * this call. The implementor renders nothing. */
  readonly renderedFor: "ar" | "en";
  /** Locale-resolved notification title (byte-stable pure rendering). */
  readonly title: string;
  /** Locale-resolved notification body (byte-stable pure rendering). */
  readonly body: string;
  /** The mobile app's data payload — the safe vocabulary only (document
   * numbers, names, dates, trace keys). Implementors sanitize at the wire
   * against their whitelist (never an amount/price/balance key). */
  readonly data: Readonly<Record<string, string>>;
  /** Notification category (the inbox vocabulary; trace + telemetry). */
  readonly category: string;
}

/** The push channel's delivery receipt (§3.5 DeliveryReceipt). */
export interface ChannelSendResult {
  /** false = not delivered (disabled / over quota / provider rejection) —
   * reported, never thrown (best-effort delivery). */
  readonly ok: boolean;
  /** The provider message id on success (FCM: the message `name`). */
  readonly providerMessageId?: string;
  /** Machine-readable refusal/failure reason (fcm-disabled /
   * fcm-quota-exceeded / fcm-http-<status> / …). */
  readonly error?: string;
}

/**
 * The push channel port (§3.5). One implementation ships in PHASE-022:
 * `FcmChannelAdapter` (apps/api/src/modules/notifications/adapters/fcm) —
 * disabled by default (the DisabledSmtpTransport pattern; enabled by
 * FCM_CREDENTIALS). SMS providers are TBD per market (§3.5) — a future
 * implementor satisfies this same port.
 */
export interface NotificationChannelPort {
  send(request: ChannelSendRequest): Promise<ChannelSendResult>;
}
