import { sql } from "drizzle-orm";

import type { StatementLite } from "@erp/contracts";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { ArQueriesService } from "../../sales/application/ar-queries";
import { PosSyncEntityInvalidError } from "../../pos/domain/pos-errors";
import { decodeCursor, encodeCursor } from "./cursor-tokens";

/**
 * PHASE-022 · DR-P22-05 — the `statements` feed (MASTER-PLAN §0 golden
 * constants + §6): per-partner statement snapshots served to the field and
 * personal classes. NOT table-backed — the PHASE-12/13 statement read model
 * is a deterministic as-of recompute over the AR subledger (RC-10), so the
 * feed follows the `permissions` snapshot precedent (./permission-snapshot):
 * a content-diff catch-up that runs at pull time and appends a change_log
 * row (entity_type 'statements', entity_id = the PARTNER id) only when the
 * partner's statement content changed — or when the last snapshot is going
 * stale (kept comfortably inside the client-side D-04 watermark, exactly
 * like the permissions refresh cadence).
 *
 * The single source of truth for statement CONTENT is the sales module's
 * ArQueriesService (BR-028; re-implementing the running balance would be a
 * second source of truth for the same fact — the permission snapshot's
 * `erp.user_effective_permissions` precedent). The service is stateless
 * (constructor-injected nothing); the pull path instantiates it directly,
 * the spec-harness pattern. Money stays TEXT canonical decimal strings
 * (ADR-0009); `version` is null on the wire (synthetic snapshot — the
 * permissions-entity precedent).
 *
 * Scope (server-enforced, LOCAL_DATABASE §1.1 rule 2 — a tampered device
 * cannot pull other partners' rows):
 *  - android-personal: the linked partner ONLY (devices.linked_partner_id,
 *    migration 0033); no linkage → an EMPTY scope (fail closed).
 *  - android-field: the route customers (ACTIVE routes' customer lists) —
 *    "the field statements feed serves route customers" (MASTER-PLAN §6).
 *
 * The serve filters change_log to the device's partner set; rows for other
 * partners may exist in the tenant ledger (another device computed them)
 * but are never served outside the scope, whatever cursor is presented.
 */

/** The entity type this module owns (the wire vocabulary; contracts literal). */
export const STATEMENTS_ENTITY_TYPE = "statements";

/** How fresh a statement snapshot must stay: refreshed when older than 6
 * days — comfortably inside the 7-day read-only watermark (D-04) with
 * bounded growth, the permissions-snapshot cadence. */
const STATEMENT_REFRESH_MS = 6 * 24 * 60 * 60 * 1000;

/** The statement service (stateless — the direct-instantiation precedent). */
const arQueries = new ArQueriesService();

/** The change row served to the pull envelope (the permissions shape). */
export interface StatementFeedChange {
  id: string;
  seq: number;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
  changedAt: string;
  version: number | null;
}

/** The pull-facing result (the pullPermissionSnapshot shape). */
export interface StatementFeedPage {
  changes: StatementFeedChange[];
  hasMore: boolean;
  nextCursorToken: string;
  resync?: boolean;
}

// -- scope ------------------------------------------------------------------------

/** The route customers' partner ids (ACTIVE routes only — an INACTIVE
 * route's customers drop out of the field statements scope). */
export async function routeCustomerPartnerIds(): Promise<string[]> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT DISTINCT rc.customer_id AS "partnerId"
    FROM route_customers rc
    JOIN routes r ON r.id = rc.route_id AND r.tenant_id = rc.tenant_id
    WHERE r.status = 'ACTIVE'
    ORDER BY 1
  `);
  return (rows.rows as unknown as { partnerId: string }[]).map((row) => row.partnerId);
}

/** The partner scope for a device pulling statements. Only the field and
 * personal groups contain the entity (the pull service's group gate has
 * already passed); personal resolves the linked partner, everything else
 * (field) resolves the route customers. */
export async function statementPartnerIds(input: {
  deviceClass: string;
  linkedPartnerId: string | null;
}): Promise<string[]> {
  if (input.deviceClass === "android-personal") {
    return input.linkedPartnerId !== null ? [input.linkedPartnerId] : [];
  }
  return routeCustomerPartnerIds();
}

// -- the content-diff catch-up -----------------------------------------------------

/** The content key of a statement payload: everything except `generatedAt`
 * (which advances on every compute — the permissions comparison separates
 * the key set from snapshotAt the same way). The comparison is
 * CANONICALIZED (keys sorted recursively): the candidate is a fresh JS
 * object (insertion order) while the last-fed payload round-trips through
 * jsonb (PostgreSQL stores object keys in its own sorted order), so a raw
 * JSON.stringify would flag every re-compute as "changed" — the key order
 * is not content. */
function contentKey(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return "none";
  }
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonical);
    }
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, nested]) => [key, canonical(nested)]),
      );
    }
    return value;
  };
  const { generatedAt: _drop, ...content } = payload as { generatedAt?: unknown };
  void _drop;
  return JSON.stringify(canonical(content));
}

/** Map the module statement (ArQueriesService shape) onto the LITE payload
 * (contracts StatementLite): drops the INV-009 diagnostic footer — the
 * subledger tie is server-side verification, not client display. */
function toLitePayload(statement: {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr: string | null;
  asOf: string;
  currencyCode: string;
  openingBalance: string;
  entries: {
    entryDate: string;
    docRef: string | null;
    sourceType: string;
    currencyCode: string;
    debit: string;
    credit: string;
    balance: string;
    outstanding: string;
  }[];
  closingBalance: string;
  closingBalanceBase: string;
  aging: Record<string, string>;
}): StatementLite {
  return {
    partnerId: statement.customerId,
    customerCode: statement.customerCode,
    customerName: statement.customerName,
    customerNameAr: statement.customerNameAr,
    asOf: statement.asOf,
    currencyCode: statement.currencyCode,
    openingBalance: statement.openingBalance,
    entries: statement.entries.map((entry) => ({
      entryDate: entry.entryDate,
      docRef: entry.docRef,
      sourceType: entry.sourceType,
      currencyCode: entry.currencyCode,
      debit: entry.debit,
      credit: entry.credit,
      balance: entry.balance,
      outstanding: entry.outstanding,
    })),
    closingBalance: statement.closingBalance,
    closingBalanceBase: statement.closingBalanceBase,
    aging: {
      not_due: statement.aging.not_due ?? "0.0000",
      "1_30": statement.aging["1_30"] ?? "0.0000",
      "31_60": statement.aging["31_60"] ?? "0.0000",
      "61_90": statement.aging["61_90"] ?? "0.0000",
      "90_plus": statement.aging["90_plus"] ?? "0.0000",
    },
    generatedAt: "",
  };
}

/** The last change_log payload for one partner's statement (or null). */
async function lastStatementPayload(partnerId: string): Promise<Record<string, unknown> | null> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT payload FROM change_log
    WHERE entity_type = ${STATEMENTS_ENTITY_TYPE} AND entity_id = ${partnerId}
    ORDER BY seq DESC LIMIT 1
  `);
  return (rows.rows as unknown as { payload: Record<string, unknown> | null }[])[0]?.payload ?? null;
}

/** Insert one statement snapshot row. */
async function appendStatementRow(
  partnerId: string,
  payload: object,
  generatedAt: string,
): Promise<void> {
  const tx = requireTenantContext().tx!;
  await tx.execute(sql`
    INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload, changed_at)
    VALUES (erp.current_tenant_id(), ${STATEMENTS_ENTITY_TYPE}, ${partnerId}, 'UPSERT',
            ${JSON.stringify(payload)}::jsonb, ${generatedAt}::timestamptz)
  `);
}

/**
 * The content-diff catch-up: for every partner in the device's scope,
 * compute the statement as of today; append a change_log row only when the
 * content changed (or the last snapshot is going stale). Cost is bounded by
 * the scope size (the linked partner, or the tenant's route customers) —
 * the permissions-snapshot trade-off, per pull.
 */
export async function syncStatements(partnerIds: readonly string[]): Promise<void> {
  const asOf = new Date().toISOString().slice(0, 10);
  for (const partnerId of partnerIds) {
    const last = await lastStatementPayload(partnerId);
    let statement;
    try {
      statement = await arQueries.statement({ customerId: partnerId, asOf });
    } catch {
      // The partner vanished mid-cycle (RC-10 guards) — skip; the next pull
      // retries (fail-soft: no row is ever served for a partner that has
      // no statement).
      continue;
    }
    const candidate = toLitePayload(statement);
    const changed = contentKey(candidate) !== contentKey(last);
    const lastGeneratedAt =
      last !== null && typeof last.generatedAt === "string"
        ? Date.parse(String(last.generatedAt))
        : Number.NaN;
    const stale =
      !Number.isNaN(lastGeneratedAt) && Date.now() - lastGeneratedAt > STATEMENT_REFRESH_MS;
    if (!changed && !stale) {
      continue;
    }
    const generatedAt = new Date().toISOString();
    await appendStatementRow(partnerId, { ...candidate, generatedAt }, generatedAt);
  }
}

// -- the serve ---------------------------------------------------------------------

/**
 * Serve the statements feed through the standard cursor mechanics (the
 * pullPermissionSnapshot shape): guarantees the scope's snapshots exist
 * (first pull forces the projection), then serves change_log rows for the
 * partner set strictly by seq. A cursor beyond the scope's head returns the
 * C-12 bounded-restart directive. The partner-set filter is the scope
 * itself — a cursor issued to ANOTHER device never widens it.
 */
export async function pullStatementsFeed(input: {
  partnerIds: readonly string[];
  cursor: string | null;
  limit: number;
}): Promise<StatementFeedPage> {
  const tx = requireTenantContext().tx!;
  let afterSeq = 0;
  if (input.cursor !== null && input.cursor !== "") {
    const decoded = decodeCursor(input.cursor);
    if (decoded === undefined) {
      // The 016 message contract for rejected cursors (restart from null).
      throw new PosSyncEntityInvalidError(
        `${STATEMENTS_ENTITY_TYPE} (cursor rejected — restart from null)`,
      );
    }
    if (decoded.entityType !== STATEMENTS_ENTITY_TYPE) {
      throw new PosSyncEntityInvalidError(
        `${STATEMENTS_ENTITY_TYPE} (cursor belongs to ${decoded.entityType})`,
      );
    }
    afterSeq = decoded.seq;
  }

  // Bootstrap: a partner never pulled before gets the initial projection.
  await syncStatements(input.partnerIds);

  const partnerIds = [...input.partnerIds];
  // change_log.entity_id is TEXT (the 0029 wire shape — every entity id rides
  // as its string form), so the partner ids bind as text, never ::uuid.
  const scopeFilter =
    partnerIds.length > 0
      ? sql`AND entity_id IN (${sql.join(partnerIds.map((id) => sql`${id}`), sql`, `)})`
      : sql`AND false`;

  // C-12: cursor beyond the scope's head → bounded restart from 0.
  const headRows = await tx.execute(sql`
    SELECT max(seq) AS "max" FROM change_log
    WHERE entity_type = ${STATEMENTS_ENTITY_TYPE} ${scopeFilter}
  `);
  const head = Number((headRows.rows as unknown as { max: string | number | null }[])[0]?.max ?? 0);
  const issuedAt = new Date().toISOString();
  if (afterSeq > head) {
    return {
      changes: [],
      hasMore: false,
      nextCursorToken: encodeCursor({ entityType: STATEMENTS_ENTITY_TYPE, seq: 0, issuedAt }),
      resync: true,
    };
  }

  const rows = await tx.execute(sql`
    SELECT seq, entity_id AS "entityId", op, payload, changed_at AS "changedAt",
           payload->>'version' AS "version"
    FROM change_log
    WHERE entity_type = ${STATEMENTS_ENTITY_TYPE} ${scopeFilter}
      AND seq > ${afterSeq}
    ORDER BY seq ASC
    LIMIT ${input.limit + 1}
  `);
  const all = rows.rows as unknown as {
    seq: number | string;
    entityId: string;
    op: "UPSERT" | "DELETE";
    payload: Record<string, unknown> | null;
    changedAt: string;
    version: string | null;
  }[];
  const hasMore = all.length > input.limit;
  const batch = hasMore ? all.slice(0, input.limit) : all;
  const lastSeq = batch.length > 0 ? Number(batch[batch.length - 1]!.seq) : afterSeq;
  const changes: StatementFeedChange[] = batch.map((row) => ({
    id: row.entityId,
    seq: Number(row.seq),
    op: row.op,
    // Statement rows are UPSERTs; the mapping keeps the generic DELETE
    // semantics (null payload/version) for shape parity.
    payload: row.op === "DELETE" ? null : row.payload,
    changedAt: row.changedAt,
    version: row.op === "DELETE" || row.version === null ? null : Number(row.version),
  }));
  return {
    changes,
    hasMore,
    nextCursorToken: encodeCursor({ entityType: STATEMENTS_ENTITY_TYPE, seq: lastSeq, issuedAt }),
  };
}
