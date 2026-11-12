/**
 * PHASE-041 (T-09 · IN-17/IN-18) — the calendar provider port: the
 * OAuth connect + event-write + contacts-list seam for Google and
 * Outlook. The same discipline as the channel port (BR-067's spirit):
 * real adapters speak HTTP ONLY through the provider transport seam;
 * the STUB default (no env credentials) makes ZERO external calls —
 * the flows are exercised against it in tests (the phase doc's "flows
 * stubbed in tests").
 *
 * Minimal scopes only (the phase's OAuth scope-creep risk): Google
 * calendar.events; Outlook Calendars.ReadWrite + Contacts.Read. No
 * gmail, no drive, no profile beyond the account email.
 */

import type { ProviderHttpTransport } from "./providers/provider-http";
import { parseJsonBody } from "./providers/provider-http";

export type CalendarProviderId = "google" | "outlook";

/** The OAuth token set (sealed at rest by the service). */
export interface CalendarTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accountEmail: string;
  readonly expiresAt: string;
}

/** A calendar event to write (task/appointment shape). */
export interface CalendarEventInput {
  readonly title: string;
  readonly description?: string;
  /** ISO date-time (all-day tasks ride the date at 00:00). */
  readonly start: string;
  readonly end: string;
}

/** An external contact from the connected account. */
export interface ExternalContact {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
}

/** The calendar provider port (IN-17 + IN-18's contacts leg). */
export interface CalendarProviderPort {
  readonly id: CalendarProviderId;
  /** The consent URL (minimal scopes; the state carries the anti-CSRF nonce). */
  authorizationUrl(state: string, redirectUri: string): string;
  /** Exchange the authorization code for the token set. */
  exchangeCode(code: string, redirectUri: string): Promise<CalendarTokenSet>;
  /** Write an event onto the connected calendar. */
  writeEvent(accessToken: string, event: CalendarEventInput): Promise<{ providerEventId: string }>;
  /** List the account's contacts (the sync's IN pull). */
  listContacts(accessToken: string): Promise<readonly ExternalContact[]>;
}

// -- the stub (tests + unconfigured environments) ------------------------------

/**
 * The deterministic STUB: zero external calls — every flow completes
 * against fixed shapes (the token set, the event id, a small contact
 * directory) so the connect→write→sync battery runs hermetically. Bound
 * to the caller's connection by the accountEmail input (tests can stage
 * which directory the pull returns).
 */
export class StubCalendarProvider implements CalendarProviderPort {
  constructor(
    readonly id: CalendarProviderId,
    private readonly options: {
      readonly contactDirectory?: readonly ExternalContact[];
      readonly tokenEmailPrefix?: string;
    } = {},
  ) {}

  authorizationUrl(state: string, redirectUri: string): string {
    return `https://stub.${this.id}.test/oauth/consent?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  async exchangeCode(code: string): Promise<CalendarTokenSet> {
    const prefix = this.options.tokenEmailPrefix;
    return {
      accessToken: `stub-${this.id}-access-${code}`,
      refreshToken: `stub-${this.id}-refresh-${code}`,
      accountEmail:
        prefix !== undefined ? `${prefix}@stub.test` : `stub-user@${this.id}.test`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
  }

  async writeEvent(_accessToken: string, event: CalendarEventInput) {
    return { providerEventId: `stub-${this.id}-event-${Buffer.from(event.title).toString("base64url").slice(0, 12)}` };
  }

  async listContacts(): Promise<readonly ExternalContact[]> {
    return this.options.contactDirectory ?? [];
  }
}

// -- the real adapters (over the transport seam) --------------------------------

/** Google Calendar (OAuth 2.0 + the v3 REST surface), minimal scopes. */
export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

export class GoogleCalendarAdapter implements CalendarProviderPort {
  readonly id = "google" as const;

  constructor(
    private readonly credentials: { readonly clientId: string; readonly clientSecret: string },
    private readonly transport: ProviderHttpTransport,
  ) {}

  authorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      scope: GOOGLE_SCOPES.join(" "),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<CalendarTokenSet> {
    const params = new URLSearchParams({
      code,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const response = await this.transport({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (response.status !== 200) {
      throw new Error(`google token exchange failed: ${response.status}`);
    }
    const parsed = parseJsonBody(response.body);
    return {
      accessToken: String(parsed.access_token ?? ""),
      refreshToken: String(parsed.refresh_token ?? ""),
      accountEmail: String(parsed.scope ?? "unknown"),
      expiresAt: new Date(Date.now() + Number(parsed.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  async writeEvent(accessToken: string, event: CalendarEventInput) {
    const response = await this.transport({
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        summary: event.title,
        description: event.description,
        start: { dateTime: event.start },
        end: { dateTime: event.end },
      }),
    });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`google event write failed: ${response.status}`);
    }
    const parsed = parseJsonBody(response.body);
    return { providerEventId: String(parsed.id ?? "google-unknown") };
  }

  async listContacts(accessToken: string): Promise<readonly ExternalContact[]> {
    const response = await this.transport({
      url: "https://people.googleapis.com/v1/otherContacts?readMask=names,emailAddresses,phoneNumbers&pageSize=200",
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 200) {
      throw new Error(`google contacts list failed: ${response.status}`);
    }
    const parsed = parseJsonBody(response.body);
    const people = Array.isArray(parsed.otherContacts) ? (parsed.otherContacts as Record<string, unknown>[]) : [];
    return people.map((person) => ({
      name: Array.isArray(person.names)
        ? String((person.names as Record<string, unknown>[])[0]?.displayName ?? "")
        : undefined,
      email: Array.isArray(person.emailAddresses)
        ? String((person.emailAddresses as Record<string, unknown>[])[0]?.value ?? "")
        : undefined,
      phone: Array.isArray(person.phoneNumbers)
        ? String((person.phoneNumbers as Record<string, unknown>[])[0]?.value ?? "")
        : undefined,
    }));
  }
}

/** Microsoft Outlook (Graph v1.0), minimal scopes. */
export const OUTLOOK_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Calendars.ReadWrite",
  "https://graph.microsoft.com/Contacts.Read",
];

export class OutlookCalendarAdapter implements CalendarProviderPort {
  readonly id = "outlook" as const;

  constructor(
    private readonly credentials: { readonly clientId: string; readonly clientSecret: string },
    private readonly transport: ProviderHttpTransport,
  ) {}

  authorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.credentials.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: OUTLOOK_SCOPES.join(" "),
      state,
    });
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<CalendarTokenSet> {
    const params = new URLSearchParams({
      code,
      client_id: this.credentials.clientId,
      client_secret: this.credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: OUTLOOK_SCOPES.join(" "),
    });
    const response = await this.transport({
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    if (response.status !== 200) {
      throw new Error(`outlook token exchange failed: ${response.status}`);
    }
    const parsed = parseJsonBody(response.body);
    return {
      accessToken: String(parsed.access_token ?? ""),
      refreshToken: String(parsed.refresh_token ?? ""),
      accountEmail: "unknown@outlook.test",
      expiresAt: new Date(Date.now() + Number(parsed.expires_in ?? 3600) * 1000).toISOString(),
    };
  }

  async writeEvent(accessToken: string, event: CalendarEventInput) {
    const response = await this.transport({
      url: "https://graph.microsoft.com/v1.0/me/events",
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        subject: event.title,
        body: { contentType: "text", content: event.description ?? "" },
        start: { dateTime: event.start, timeZone: "UTC" },
        end: { dateTime: event.end, timeZone: "UTC" },
      }),
    });
    if (response.status !== 201 && response.status !== 200) {
      throw new Error(`outlook event write failed: ${response.status}`);
    }
    const parsed = parseJsonBody(response.body);
    return { providerEventId: String(parsed.id ?? "outlook-unknown") };
  }

  async listContacts(accessToken: string): Promise<readonly ExternalContact[]> {
    const response = await this.transport({
      url: "https://graph.microsoft.com/v1.0/me/contacts?$select=displayName,emailAddresses,mobilePhone&$top=100",
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (response.status !== 200) {
      throw new Error(`outlook contacts list failed: ${response.status}`);
    }
    const parsed = parseJsonBody(response.body);
    const people = Array.isArray(parsed.value) ? (parsed.value as Record<string, unknown>[]) : [];
    return people.map((person) => ({
      name: typeof person.displayName === "string" ? person.displayName : undefined,
      email: Array.isArray(person.emailAddresses)
        ? String((person.emailAddresses as Record<string, unknown>[])[0]?.address ?? "")
        : undefined,
      phone: typeof person.mobilePhone === "string" ? person.mobilePhone : undefined,
    }));
  }
}
