import { childLogger } from "../../../../infra/observability/logger";
import type {
  ChannelSendRequest,
  ChannelSendResult,
  NotificationChannelPort,
} from "../../application/channel-port";
import type { FcmMessage, FcmTransport } from "./fcm-transport";

/**
 * PHASE-022 · DR-P22-07 — the FCM channel adapter over the injected
 * FcmTransport seam (the EmailService-over-SmtpTransport pattern). Owns the
 * three §3.5 delivery semantics the port documents:
 *
 * 1. NO financial payloads: the `data` payload is whitelisted to the safe
 *    mobile vocabulary below — document numbers, names, dates, trace keys.
 *    Any other key (amount/price/balance/…) is DROPPED at the wire with a
 *    warning log, and a post-sanitize assertion guarantees the wire body
 *    can never carry a non-whitelisted key (the db suite proves an amount
 *    key injected by a caller never reaches the fake transport).
 * 2. Per-tenant quota: a sliding-window send budget per tenant. Over quota
 *    → {ok:false, error:"fcm-quota-exceeded"} — the over-quota attempt is
 *    COUNTED (a caller hammering the channel gains nothing), never thrown.
 * 3. Bounded retry with backoff for TRANSIENT transport failures (429/5xx/
 *    network — the transport classifies); permanent 4xx fail fast.
 *
 * Disabled mode (FCM_CREDENTIALS unset): the adapter checks the transport's
 * `disabled` flag first — no wire call, no throw, one init-log line, and an
 * honest {ok:false, error:"fcm-disabled"} receipt (the port carries a
 * result, so disabled reports NOT-delivered rather than the void-shaped
 * SMTP seam's implicit success).
 */

const log = childLogger({ module: "notifications" });

/**
 * The safe mobile data vocabulary — the whitelist. The push template
 * registry's variable set (application/fcm-templates.ts) + the trace keys.
 * Financial fields (amount/price/balance/qty/…) are structurally absent:
 * anything not listed here is dropped at the wire.
 */
const PUSH_DATA_KEY_WHITELIST = new Set([
  // template variables (the registry's vocabulary)
  "docNo",
  "customerName",
  "dueDate",
  "deviceName",
  "at",
  // trace keys (the port's own fields mirrored into the app payload)
  "templateId",
  "renderedFor",
  "category",
]);

/** A belt-and-brushes assertion shape for tests + the self-check below. */
export function isWhitelistedDataKey(key: string): boolean {
  return PUSH_DATA_KEY_WHITELIST.has(key);
}

/** In-memory sliding-window counter: per-tenant send attempts per window. */
class QuotaWindow {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  /**
   * Record THIS attempt and return the in-window count after recording —
   * over-quota attempts are counted (never free), the caller decides.
   */
  record(tenantId: string, now: number): number {
    const cutoff = now - this.windowMs;
    const history = (this.attempts.get(tenantId) ?? []).filter((at) => at > cutoff);
    history.push(now);
    this.attempts.set(tenantId, history);
    return history.length;
  }
}

export interface FcmChannelOptions {
  /** The HTTP seam (DisabledFcmTransport / FcmHttpTransport / the fake). */
  readonly transport: FcmTransport;
  /**
   * Per-tenant send budget per sliding window (§3.5 "retry + per-tenant
   * quota"). Constructor-configurable (operators tune with the release
   * wiring, handoff 4-a); dev/test default below.
   */
  readonly quota?: { readonly limit: number; readonly windowMs: number };
  /**
   * Bounded retry for transient transport failures: total attempts per
   * send (1 = no retry), linear backoff (backoffMs × attempt) between them.
   */
  readonly retry?: { readonly attempts: number; readonly backoffMs: number };
  /** Clock injection for the quota window (tests slide windows fast). */
  readonly now?: () => number;
}

const DEFAULT_QUOTA = { limit: 100, windowMs: 60_000 } as const;
const DEFAULT_RETRY = { attempts: 3, backoffMs: 200 } as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The FCM v1 channel adapter (disabled-by-default wiring in the module). */
export class FcmChannelAdapter implements NotificationChannelPort {
  private readonly transport: FcmTransport;
  private readonly quota: QuotaWindow;
  private readonly quotaLimit: number;
  private readonly retry: { attempts: number; backoffMs: number };
  private readonly now: () => number;
  private disabledLogged = false;

  constructor(options: FcmChannelOptions) {
    this.transport = options.transport;
    const quota = options.quota ?? DEFAULT_QUOTA;
    this.quota = new QuotaWindow(quota.windowMs);
    this.quotaLimit = quota.limit;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.now = options.now ?? Date.now;
  }

  /** Surface for module init logs + tests (the honest-skeleton flag). */
  get disabled(): boolean {
    return this.transport.disabled;
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    // 1. Disabled mode first: no wire call, no throw, one log line ever.
    if (this.transport.disabled) {
      if (!this.disabledLogged) {
        this.disabledLogged = true;
        log.warn(
          { channel: "fcm", disabled: true },
          "fcm channel disabled (FCM_CREDENTIALS unset) — sends are no-ops reported as ok:false",
        );
      }
      return { ok: false, error: "fcm-disabled" };
    }

    // 2. Per-tenant quota: the attempt is COUNTED, refusal is reported.
    const inWindow = this.quota.record(request.tenantId, this.now());
    if (inWindow > this.quotaLimit) {
      log.warn(
        { channel: "fcm", tenant_id: request.tenantId, inWindow, limit: this.quotaLimit },
        "fcm send over per-tenant quota — reported ok:false (counted, not thrown)",
      );
      return { ok: false, error: "fcm-quota-exceeded" };
    }

    // 3. Whitelist the data payload at the wire — NO financial keys ride.
    const wireData: Record<string, string> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(request.data)) {
      if (PUSH_DATA_KEY_WHITELIST.has(key) && typeof value === "string") {
        wireData[key] = value;
      } else {
        dropped.push(key);
      }
    }
    if (dropped.length > 0) {
      log.warn(
        { channel: "fcm", dropped, tenant_id: request.tenantId },
        "fcm data keys dropped (not in the safe mobile whitelist)",
      );
    }
    // The ASSERT half of the contract: the wire body can never carry a
    // non-whitelisted key even if the sanitizer above regresses.
    for (const key of Object.keys(wireData)) {
      if (!PUSH_DATA_KEY_WHITELIST.has(key)) {
        throw new Error(`fcm wire data key "${key}" escaped the whitelist — refusing to send`);
      }
    }

    // 4. The real FCM v1 body: message{token, notification{title, body},
    //    data{…}} — the adapter builds it, the transport carries it.
    const message: FcmMessage = {
      message: {
        token: request.deviceToken,
        notification: { title: request.title, body: request.body },
        data: wireData,
      },
    };

    // 5. Bounded retry with linear backoff for TRANSIENT failures only.
    let lastFailure: ChannelSendResult = { ok: false, error: "fcm-unreachable" };
    for (let attempt = 1; attempt <= this.retry.attempts; attempt += 1) {
      if (attempt > 1) {
        await sleep(this.retry.backoffMs * (attempt - 1));
      }
      const response = await this.transport.postMessage(message);
      if (response.status === 200) {
        return { ok: true, ...(response.name === undefined ? {} : { providerMessageId: response.name }) };
      }
      lastFailure = { ok: false, error: response.error ?? `fcm-http-${response.status}` };
      if (!response.transient) {
        return lastFailure; // permanent (4xx): retrying cannot help
      }
    }
    return lastFailure;
  }
}
