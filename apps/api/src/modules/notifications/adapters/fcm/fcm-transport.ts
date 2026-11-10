import { createSign } from "node:crypto";

import { env } from "../../../../config/env";

/**
 * PHASE-022 · DR-P22-07 — the FCM transport seam (the SmtpTransport
 * precedent from infrastructure/smtp-mailer.ts): the ADAPTER builds the
 * real FCM v1 wire body; the TRANSPORT owns the HTTP + auth. Three
 * implementations:
 *
 * - `DisabledFcmTransport` — FCM_CREDENTIALS unset → the channel is
 *   disabled-by-default (the DisabledSmtpTransport pattern: no wire call,
 *   no throw — the adapter reports ok:false, the module init log surfaces
 *   the disabled flag; honest skeleton).
 * - `FcmHttpTransport` — the real HTTP shape to FCM v1
 *   (POST /v1/projects/{project}/messages:send, Bearer service-account
 *   OAuth2). Wire shape per the official docs (cited below); zero external
 *   dependencies — node fetch + node:crypto RS256 only, no firebase-admin
 *   (NO-FABRICATION §4: the shape is the documented one, not a guess — the
 *   sandbox carries no live FCM credentials, so live verification is an
 *   operations decision (handoff 4-a); the fake-FCM contract tests pin OUR
 *   side of the wire):
 *   - https://firebase.google.com/docs/cloud-messaging/send-message (v1)
 *   - https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages
 *   - https://developers.google.com/identity/protocols/oauth2/service-account
 * - `FakeFcmTransport` (adapters/fcm/fake-fcm.ts) — the test double for the
 *   db suite (records every wire call, configurable failures).
 */

/** The FCM v1 `messages:send` request body (projects.messages resource). */
export interface FcmMessage {
  readonly message: {
    readonly token: string;
    readonly notification: {
      readonly title: string;
      readonly body: string;
    };
    readonly data: Readonly<Record<string, string>>;
  };
}

/** One transport attempt's outcome (the adapter classifies + retries). */
export interface FcmResponse {
  /** HTTP status; 0 = never reached the provider (network/disabled). */
  readonly status: number;
  /** The provider message name (projects/…/messages/…) on 200 — the
   * ChannelSendResult's providerMessageId. */
  readonly name?: string;
  /** Provider/transport error text (no secrets — status + message only). */
  readonly error?: string;
  /** 429 + 5xx + network failures are retried by the adapter; 4xx are
   * permanent (a bad token/permission is not made better by retrying). */
  readonly transient: boolean;
}

/** The HTTP seam the FcmChannelAdapter is constructed over. */
export interface FcmTransport {
  /** True when this transport never reaches the wire (disabled mode). */
  readonly disabled: boolean;
  postMessage(message: FcmMessage): Promise<FcmResponse>;
}

/**
 * Disabled transport (FCM_CREDENTIALS unset): no-op resolve, never throws —
 * the SMTP precedent. The ADAPTER checks `disabled` first and reports
 * {ok:false, error:"fcm-disabled"} (the channel port carries a result, so
 * an honest skeleton reports NOT-delivered instead of fabricated success —
 * the one deliberate delta from the void-returning SMTP seam, recorded in
 * the module init log).
 */
export class DisabledFcmTransport implements FcmTransport {
  readonly disabled = true;

  postMessage(_message: FcmMessage): Promise<FcmResponse> {
    return Promise.resolve({ status: 0, transient: false, error: "fcm-disabled" });
  }
}

/** The parsed service-account shape FCM_CREDENTIALS carries. */
export interface FcmServiceAccount {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri?: string;
}

const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Refresh the cached access token this far before its expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * The real FCM v1 HTTP transport: OAuth2 service-account access token
 * (RS256 JWT grant, cached until near-expiry) + POST messages:send.
 * Network/token-endpoint failures report {status:0, transient:true} — the
 * adapter's bounded retry covers them; provider 4xx report transient:false.
 */
export class FcmHttpTransport implements FcmTransport {
  readonly disabled = false;
  private cached?: { token: string; expiresAt: number };

  constructor(private readonly account: FcmServiceAccount) {}

  private tokenUri(): string {
    return this.account.token_uri ?? DEFAULT_TOKEN_URI;
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.cached !== undefined && this.cached.expiresAt - TOKEN_EXPIRY_MARGIN_MS > now) {
      return this.cached.token;
    }
    const iat = (Date.now() / 1000) | 0; // ToInt32 unix seconds (the device-tokens precedent)
    const exp = iat + 3600; // the documented maximum grant lifetime
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        iss: this.account.client_email,
        scope: FCM_SCOPE,
        aud: this.tokenUri(),
        iat,
        exp,
      }),
    );
    const signingInput = `${header}.${payload}`;
    const signature = createSign("RSA-SHA256")
      .update(signingInput)
      .sign(this.account.private_key)
      .toString("base64url");
    const assertion = `${signingInput}.${signature}`;
    const response = await fetch(this.tokenUri(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (response.status !== 200) {
      const detail = await response.text().catch(() => "");
      throw new Error(`fcm oauth: token endpoint returned ${response.status} ${detail.slice(0, 200)}`);
    }
    const granted = (await response.json()) as { access_token?: string; expires_in?: number };
    if (typeof granted.access_token !== "string") {
      throw new Error("fcm oauth: token endpoint response carried no access_token");
    }
    this.cached = {
      token: granted.access_token,
      expiresAt: now + (granted.expires_in ?? 3600) * 1000,
    };
    return granted.access_token;
  }

  async postMessage(message: FcmMessage): Promise<FcmResponse> {
    try {
      const token = await this.accessToken();
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json; charset=UTF-8",
          },
          body: JSON.stringify(message),
        },
      );
      if (response.status === 200) {
        const delivered = (await response.json()) as { name?: string };
        return { status: 200, name: delivered.name, transient: false };
      }
      const errorText = (await response.text().catch(() => "")).slice(0, 300);
      return {
        status: response.status,
        error: `fcm-http-${response.status}: ${errorText || "(no body)"}`,
        transient: response.status === 429 || response.status >= 500,
      };
    } catch (error) {
      // Network / DNS / token-endpoint failures: transient by §3.5 (retry).
      return {
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        transient: true,
      };
    }
  }
}

/**
 * Parse FCM_CREDENTIALS into a service account. Unset/empty → undefined
 * (disabled mode); present-but-invalid → throws (fail-fast at module init —
 * never silently coerced, the env contract's own rule; an operator who set
 * garbage must see it, not silently dropped pushes).
 */
export function parseFcmCredentials(raw: string | undefined): FcmServiceAccount | undefined {
  if (raw === undefined || raw === "") {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("FCM_CREDENTIALS is set but is not valid JSON (a service-account object is expected)");
  }
  const candidate = parsed as Partial<FcmServiceAccount> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof candidate.project_id !== "string" ||
    typeof candidate.client_email !== "string" ||
    typeof candidate.private_key !== "string" ||
    candidate.project_id === "" ||
    candidate.client_email === "" ||
    candidate.private_key === ""
  ) {
    throw new Error(
      "FCM_CREDENTIALS is set but does not carry a service-account shape (project_id, client_email, private_key are required)",
    );
  }
  return {
    project_id: candidate.project_id,
    client_email: candidate.client_email,
    private_key: candidate.private_key,
    ...(candidate.token_uri !== undefined && candidate.token_uri !== ""
      ? { token_uri: candidate.token_uri }
      : {}),
  };
}

/** Transport factory from the environment (FCM_CREDENTIALS unset → disabled). */
export function fcmTransportFromEnv(): FcmTransport {
  const account = parseFcmCredentials(env.FCM_CREDENTIALS);
  if (account === undefined) {
    return new DisabledFcmTransport();
  }
  return new FcmHttpTransport(account);
}
