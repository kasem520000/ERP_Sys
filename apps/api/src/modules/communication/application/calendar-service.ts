/**
 * PHASE-041 (T-09 · IN-17/IN-18) — the calendar service: OAuth connect
 * (minimal scopes; tokens SEALED in tenant_settings — the secret-store
 * discipline), task-event writes (source linkage CALENDAR on the outbox
 * when a notification rides along), and the OPT-IN two-way contacts sync
 * with the partner-directory matching rules:
 *
 * - EXACT — an external contact's email or phone matches exactly ONE
 *   partner contact → a LINK proposal (the partner gains the contact).
 * - FUZZY — name similarity surfaces CANDIDATES for review.
 * - NEVER auto-merge: every proposal waits in the bounded review queue
 *   (tenant_settings, capped 200 pending) for an explicit accept (the
 *   partner record updates through the partners store) or reject.
 */

import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { env } from "../../../config/env";
import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { sealSecret, openSecret } from "../../identity/infrastructure/secret-envelope";
import { CalendarError } from "../domain/communication-errors";
import {
  StubCalendarProvider,
  type CalendarProviderId,
  type CalendarProviderPort,
  type CalendarTokenSet,
  type ExternalContact,
  GoogleCalendarAdapter,
  OutlookCalendarAdapter,
} from "./calendar-port";
import { fetchProviderTransport } from "./providers/provider-http";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("calendar access requires an ambient tenant scope");
  }
  return context.tx;
}

export const CALENDAR_SETTINGS_KEY = "communication.calendar";
export const CONTACTS_SYNC_SETTINGS_KEY = "communication.contacts_sync";
/** The review queue's hard bound (a runaway sync never floods settings). */
export const PROPOSAL_QUEUE_CAP = 200;

interface CalendarConnection {
  readonly provider: CalendarProviderId;
  readonly accountEmail: string;
  readonly accessToken: string; // sealed
  readonly refreshToken: string; // sealed
  readonly expiresAt: string;
  readonly connectedAt: string;
}

interface CalendarSettings {
  readonly connections: Record<string, CalendarConnection>;
}

export interface SyncProposal {
  readonly id: string;
  readonly external: { readonly name?: string; readonly email?: string; readonly phone?: string };
  readonly match: { readonly type: "EXACT" | "FUZZY"; readonly partnerId?: string };
  readonly candidates: ReadonlyArray<{ readonly partnerId: string; readonly name: string; readonly score: number }>;
  readonly status: "PENDING" | "ACCEPTED" | "REJECTED";
  readonly proposedAt: string;
}

interface ContactsSyncSettings {
  readonly lastSyncAt: string | null;
  readonly proposals: SyncProposal[];
}

/** One pending-review candidate per the matching rules. */
export interface MatchOutcome {
  readonly type: "EXACT" | "FUZZY" | "NONE";
  readonly partnerId?: string;
  readonly candidates: ReadonlyArray<{ partnerId: string; name: string; score: number }>;
}

/**
 * The matching rules (IN-18): exact email/phone → LINK; otherwise fuzzy
 * name similarity (normalized Levenshtein ≥ 0.72 with length ≥ 4 — the
 * documented threshold) surfaces candidates, best-first, capped at 3.
 * Pure + unit-tested.
 */
export function matchContact(
  external: ExternalContact,
  directory: ReadonlyArray<{
    partnerId: string;
    name: string;
    contactEmails: readonly string[];
    contactPhones: readonly string[];
  }>,
): MatchOutcome {
  const normalizeEmail = (value: string): string => value.trim().toLowerCase();
  const normalizePhone = (value: string): string => value.replace(/[^\d+]/g, "");
  // EXACT: one partner contact matches the email OR the phone.
  if (external.email !== undefined && external.email.length > 0) {
    const email = normalizeEmail(external.email);
    const hits = directory.filter((partner) =>
      partner.contactEmails.some((candidate) => normalizeEmail(candidate) === email),
    );
    if (hits.length === 1) {
      return { type: "EXACT", partnerId: hits[0]!.partnerId, candidates: [] };
    }
  }
  if (external.phone !== undefined && external.phone.length > 0) {
    const phone = normalizePhone(external.phone);
    const hits = directory.filter((partner) =>
      partner.contactPhones.some((candidate) => normalizePhone(candidate) === phone),
    );
    if (hits.length === 1) {
      return { type: "EXACT", partnerId: hits[0]!.partnerId, candidates: [] };
    }
  }
  // FUZZY: normalized name similarity, best-first, capped at 3.
  const externalName = external.name;
  if (externalName !== undefined && externalName.trim().length >= 4) {
    const scored = directory
      .map((partner) => ({
        partnerId: partner.partnerId,
        name: partner.name,
        score: nameSimilarity(externalName, partner.name),
      }))
      .filter((entry) => entry.score >= 0.72)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (scored.length > 0) {
      return { type: "FUZZY", candidates: scored };
    }
  }
  return { type: "NONE", candidates: [] };
}

/** Normalized Levenshtein similarity (1 = identical; case/punct-folded). */
function nameSimilarity(a: string, b: string): number {
  const fold = (value: string): string =>
    value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  const left = fold(a);
  const right = fold(b);
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let col = 1; col < cols; col += 1) {
      const cost = left.charCodeAt(row - 1) === right.charCodeAt(col - 1) ? 0 : 1;
      current[col] = Math.min(
        current[col - 1]! + 1,
        previous[col]! + 1,
        previous[col - 1]! + cost,
      );
    }
    previous = current;
  }
  const distance = previous[right.length]!;
  return 1 - distance / Math.max(left.length, right.length);
}

export class CalendarService {
  constructor(private readonly portOverride?: Map<CalendarProviderId, CalendarProviderPort>) {}

  /** The provider port: the injected override (tests) or env-credentialed
   * real adapters — the STUB when unconfigured (zero external calls). */
  port(id: CalendarProviderId): CalendarProviderPort {
    const override = this.portOverride?.get(id);
    if (override !== undefined) {
      return override;
    }
    if (id === "google") {
      const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
      const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
      if (clientId !== undefined && clientSecret !== undefined && clientId !== "") {
        return new GoogleCalendarAdapter({ clientId, clientSecret }, fetchProviderTransport);
      }
      return new StubCalendarProvider("google");
    }
    const clientId = env.OUTLOOK_OAUTH_CLIENT_ID;
    const clientSecret = env.OUTLOOK_OAUTH_CLIENT_SECRET;
    if (clientId !== undefined && clientSecret !== undefined && clientId !== "") {
      return new OutlookCalendarAdapter({ clientId, clientSecret }, fetchProviderTransport);
    }
    return new StubCalendarProvider("outlook");
  }

  /** The connectable providers + the caller's connection state (masked). */
  async status(userId: string): Promise<{
    providers: ReadonlyArray<{ id: CalendarProviderId; live: boolean }>;
    connection: { provider: CalendarProviderId; accountEmail: string; connectedAt: string } | null;
  }> {
    const settings = await this.readSettings();
    const connection = settings.connections[userId] ?? null;
    return {
      providers: (["google", "outlook"] as const).map((id) => ({
        id,
        // Live = env-credentialed (the real adapter); the STUB still
        // connects (flows complete) but calls out to nothing.
        live:
          this.portOverride?.has(id) === true ||
          (id === "google"
            ? (env.GOOGLE_OAUTH_CLIENT_ID ?? "") !== ""
            : (env.OUTLOOK_OAUTH_CLIENT_ID ?? "") !== ""),
      })),
      connection:
        connection === null
          ? null
          : {
              provider: connection.provider,
              accountEmail: connection.accountEmail,
              connectedAt: connection.connectedAt,
            },
    };
  }

  /**
   * The consent URL + the anti-CSRF state (the state's digest is recorded
   * on the connection slot so the callback can verify it).
   */
  async beginConnect(
    userId: string,
    provider: CalendarProviderId,
    redirectUri: string,
  ): Promise<{ authorizationUrl: string; state: string }> {
    const state = randomUUID();
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'communication.calendar.state',
              ${JSON.stringify({ userId, provider, stateDigest: digest(state) })}::jsonb, ${userId})
      ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value,
        updated_at = now(), version = tenant_settings.version + 1`);
    return { authorizationUrl: this.port(provider).authorizationUrl(state, redirectUri), state };
  }

  /** The OAuth callback: verify the state, exchange the code, seal the tokens. */
  async completeConnect(
    userId: string,
    input: { code: string; state: string; redirectUri: string },
  ): Promise<{ provider: CalendarProviderId; accountEmail: string }> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT value FROM tenant_settings WHERE key = 'communication.calendar.state' LIMIT 1`);
    const pending = (
      rows.rows as unknown as { value: { userId: string; provider: CalendarProviderId; stateDigest: string } }[]
    )[0]?.value;
    if (pending === undefined || pending.userId !== userId) {
      throw new CalendarError(
        "communication/calendar-state-invalid",
        "no pending connect for this user — restart the connect flow",
      );
    }
    if (pending.stateDigest !== digest(input.state)) {
      throw new CalendarError(
        "communication/calendar-state-invalid",
        "the OAuth state does not match the pending connect (CSRF guard)",
      );
    }
    const tokenSet = await this.port(pending.provider).exchangeCode(input.code, input.redirectUri);
    await this.saveConnection(userId, pending.provider, tokenSet);
    return { provider: pending.provider, accountEmail: tokenSet.accountEmail };
  }

  /** Load a crm task by id + write its event (the route's shape). */
  async writeTaskEventFromId(
    userId: string,
    taskId: string,
  ): Promise<{ providerEventId: string }> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT id, title, due_date::text AS "dueDate", note FROM crm_tasks
      WHERE id = ${taskId} LIMIT 1`);
    const task = (rows.rows as unknown as {
      id: string;
      title: string;
      dueDate: string | null;
      note: string | null;
    }[])[0];
    if (task === undefined) {
      throw new CalendarError(
        "communication/calendar-task-not-found",
        `no crm task ${taskId}`,
      );
    }
    return this.writeTaskEvent(userId, task);
  }

  /** Write a task's event onto the caller's connected calendar. */
  async writeTaskEvent(
    userId: string,
    task: { id: string; title: string; dueDate: string | null; note: string | null },
  ): Promise<{ providerEventId: string }> {
    const connection = await this.connectionOf(userId);
    const startIso =
      task.dueDate !== null
        ? `${task.dueDate}T09:00:00Z`
        : new Date(Date.now() + 86_400_000).toISOString();
    return this.port(connection.provider).writeEvent(openSecret(connection.accessToken), {
      title: task.title,
      description: task.note ?? undefined,
      start: startIso,
      end: new Date(new Date(startIso).getTime() + 3_600_000).toISOString(),
    });
  }

  /**
   * The OPT-IN contacts sync: pull the connected account's contacts, match
   * against the partner directory, and queue proposals for review — NEVER
   * auto-merge. Returns the queue summary.
   */
  async syncContacts(userId: string): Promise<{
    pulled: number;
    exact: number;
    fuzzy: number;
    none: number;
    pending: number;
  }> {
    const connection = await this.connectionOf(userId);
    const external = await this.port(connection.provider).listContacts(
      openSecret(connection.accessToken),
    );
    const directory = await this.partnerDirectory();
    const sync = await this.readSyncSettings();
    // The FULL proposal list is carried (decisions preserved); the dedupe
    // is identity-aware across statuses — an accepted/rejected contact is
    // NEVER re-proposed (the queue never nags a decided identity).
    const proposals: SyncProposal[] = [...sync.proposals];
    const knownIdentities = new Set(
      proposals.map(
        (proposal) => proposal.external.email ?? proposal.external.phone ?? proposal.external.name ?? "",
      ),
    );
    let pending = proposals.filter((proposal) => proposal.status === "PENDING").length;
    let exact = 0;
    let fuzzy = 0;
    let none = 0;
    for (const contact of external) {
      const outcome = matchContact(contact, directory);
      if (outcome.type === "NONE") {
        none += 1;
        continue;
      }
      if (outcome.type === "EXACT") {
        exact += 1;
      } else {
        fuzzy += 1;
      }
      // Dedupe the queue: one proposal per external identity, ever.
      const identity = contact.email ?? contact.phone ?? contact.name ?? "";
      if (!knownIdentities.has(identity) && pending < PROPOSAL_QUEUE_CAP) {
        proposals.push({
          id: randomUUID(),
          external: contact,
          match: { type: outcome.type, partnerId: outcome.partnerId },
          candidates: outcome.candidates,
          status: "PENDING",
          proposedAt: new Date().toISOString(),
        });
        knownIdentities.add(identity);
        pending += 1;
      }
    }
    await this.persistSyncSettings({
      lastSyncAt: new Date().toISOString(),
      proposals: proposals.slice(-PROPOSAL_QUEUE_CAP),
    });
    return {
      pulled: external.length,
      exact,
      fuzzy,
      none,
      pending: proposals.filter((proposal) => proposal.status === "PENDING").length,
    };
  }

  /** The review queue (pending first, newest first). */
  async listProposals(): Promise<readonly SyncProposal[]> {
    const sync = await this.readSyncSettings();
    return [...sync.proposals]
      .sort((a, b) => (a.status === b.status ? b.proposedAt.localeCompare(a.proposedAt) : a.status === "PENDING" ? -1 : 1))
      .slice(0, 100);
  }

  /**
   * Accept a proposal: the EXACT link adds the external contact to the
   * partner's directory (through the partners store); the FUZZY pick
   * updates the CHOSEN partner with the external contact. Never a merge
   * of two partner records.
   */
  async acceptProposal(
    _actorId: string,
    proposalId: string,
    chosenPartnerId?: string,
  ): Promise<{ applied: boolean }> {
    const sync = await this.readSyncSettings();
    const proposal = sync.proposals.find((entry) => entry.id === proposalId);
    if (proposal === undefined || proposal.status !== "PENDING") {
      throw new CalendarError(
        "communication/calendar-proposal-invalid",
        `no pending proposal ${proposalId}`,
      );
    }
    const partnerId = proposal.match.type === "EXACT" ? proposal.match.partnerId : chosenPartnerId;
    if (partnerId === undefined) {
      throw new CalendarError(
        "communication/calendar-proposal-invalid",
        "a FUZZY proposal requires the chosen partnerId",
      );
    }
    // Idempotent accept: when the partner's directory ALREADY carries the
    // external contact's email or phone, the accept confirms the link
    // WITHOUT a duplicate insert (a stale/re-proposal never double-adds).
    const email = proposal.external.email ?? null;
    const phone = proposal.external.phone ?? null;
    const tx = tenantTx();
    const existing = await tx.execute(sql`
      SELECT 1 FROM partner_contacts
      WHERE partner_id = ${partnerId}
        AND ( (${email}::text IS NOT NULL AND email = ${email}::text)
           OR (${phone}::text IS NOT NULL AND phone = ${phone}::text) )
      LIMIT 1`);
    if ((existing.rows as unknown as unknown[]).length === 0) {
      const { insertPartnerContact } = await import(
        "../../partners/infrastructure/partners.store"
      );
      await insertPartnerContact({
        partnerId,
        name: proposal.external.name ?? proposal.external.email ?? " synced contact",
        phone: proposal.external.phone ?? null,
        email: proposal.external.email ?? null,
        role: null,
        isPrimary: false,
      });
    }
    await this.persistSyncSettings({
      ...sync,
      proposals: sync.proposals.map((entry) =>
        entry.id === proposalId ? { ...entry, status: "ACCEPTED" } : entry,
      ),
    });
    return { applied: true };
  }

  /** Reject a proposal (dismissed — never applied). */
  async rejectProposal(proposalId: string): Promise<{ applied: boolean }> {
    const sync = await this.readSyncSettings();
    if (!sync.proposals.some((entry) => entry.id === proposalId && entry.status === "PENDING")) {
      throw new CalendarError(
        "communication/calendar-proposal-invalid",
        `no pending proposal ${proposalId}`,
      );
    }
    await this.persistSyncSettings({
      ...sync,
      proposals: sync.proposals.map((entry) =>
        entry.id === proposalId ? { ...entry, status: "REJECTED" } : entry,
      ),
    });
    return { applied: false };
  }

  // -- settings plumbing ------------------------------------------------------

  private async connectionOf(userId: string): Promise<CalendarConnection> {
    const settings = await this.readSettings();
    const connection = settings.connections[userId];
    if (connection === undefined) {
      throw new CalendarError(
        "communication/calendar-not-connected",
        "no connected calendar for this user — complete the connect flow first",
      );
    }
    return connection;
  }

  private async saveConnection(
    userId: string,
    provider: CalendarProviderId,
    tokenSet: CalendarTokenSet,
  ): Promise<void> {
    const settings = await this.readSettings();
    const connections: Record<string, CalendarConnection> = {
      ...settings.connections,
      [userId]: {
        provider,
        accountEmail: tokenSet.accountEmail,
        accessToken: sealSecret(tokenSet.accessToken),
        refreshToken: sealSecret(tokenSet.refreshToken),
        expiresAt: tokenSet.expiresAt,
        connectedAt: new Date().toISOString(),
      },
    };
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${CALENDAR_SETTINGS_KEY},
              ${JSON.stringify({ connections })}::jsonb, ${userId})
      ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value,
        updated_at = now(), version = tenant_settings.version + 1`);
  }

  private async readSettings(): Promise<CalendarSettings> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT value FROM tenant_settings WHERE key = ${CALENDAR_SETTINGS_KEY} LIMIT 1`);
    const raw = (rows.rows as unknown as { value: unknown }[])[0]?.value;
    if (raw === undefined || typeof raw !== "object" || raw === null) {
      return { connections: {} };
    }
    const connections = (raw as { connections?: unknown }).connections;
    return {
      connections:
        typeof connections === "object" && connections !== null
          ? (connections as Record<string, CalendarConnection>)
          : {},
    };
  }

  private async readSyncSettings(): Promise<ContactsSyncSettings> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT value FROM tenant_settings WHERE key = ${CONTACTS_SYNC_SETTINGS_KEY} LIMIT 1`);
    const raw = (rows.rows as unknown as { value: unknown }[])[0]?.value;
    if (raw === undefined || typeof raw !== "object" || raw === null) {
      return { lastSyncAt: null, proposals: [] };
    }
    const parsed = raw as { lastSyncAt?: string | null; proposals?: SyncProposal[] };
    return {
      lastSyncAt: parsed.lastSyncAt ?? null,
      proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [],
    };
  }

  private async persistSyncSettings(settings: ContactsSyncSettings): Promise<void> {
    const tx = tenantTx();
    await tx.execute(sql`
      INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${CONTACTS_SYNC_SETTINGS_KEY},
              ${JSON.stringify(settings)}::jsonb, NULL)
      ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value,
        updated_at = now(), version = tenant_settings.version + 1`);
  }

  /** The partner directory slice the matching rules consume. */
  private async partnerDirectory(): Promise<
    ReadonlyArray<{
      partnerId: string;
      name: string;
      contactEmails: readonly string[];
      contactPhones: readonly string[];
    }>
  > {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT p.id AS "partnerId", p.name,
             COALESCE(array_agg(c.email) FILTER (WHERE c.email IS NOT NULL), '{}') AS "contactEmails",
             COALESCE(array_agg(c.phone) FILTER (WHERE c.phone IS NOT NULL), '{}') AS "contactPhones"
      FROM partners p
      LEFT JOIN partner_contacts c ON c.partner_id = p.id AND c.tenant_id = p.tenant_id
      GROUP BY p.id, p.name
      LIMIT 2000`);
    return rows.rows as unknown as {
      partnerId: string;
      name: string;
      contactEmails: string[];
      contactPhones: string[];
    }[];
  }
}

function digest(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}
