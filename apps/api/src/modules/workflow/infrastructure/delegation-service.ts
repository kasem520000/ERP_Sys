import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  assertAcyclic,
  effectiveActor,
  type DelegationEdge,
} from "../domain/delegation-graph";
import { WorkflowInputInvalidError } from "../domain/workflow-errors";
import * as store from "./workflow.store";

/**
 * PHASE-052 (W-45 — T-04, dated 2026-11-27) THE DELEGATION SERVICE (D-07
 * — the absence windows, the scope law, the act-time resolution). The
 * pure delegation-graph fold (W-43's domain layer) renders every walk;
 * this service is the IO shell: the windows' own CRUD with the
 * SAVE-TIME CIRCULARITY LAW (assertAcyclic over the standing ACTIVE
 * windows — the typed refusal names the full closed cycle), the scope
 * pair law (ALL carries no value; MODULE/ENTITY carry exactly one —
 * the DB floor's own CHECK, defended here typed), and the ACT-TIME
 * RESOLUTION (the ACTIVE in-scope windows at the moment of the act —
 * the DB's own clock decides, never Date.now()).
 *
 * THE SCOPE LAW (the declared interpretation, W-45): the MODULE scope
 * value is the bound surface's MODULE (accounting · purchasing · crm ·
 * trade — the four exemplar surfaces' own homes); the ENTITY scope
 * value is the trigger registry's member (manual_journal ·
 * purchase_order · change_order · duty_drawback_claim). A window
 * covers a step when its scope covers the step's trigger entity:
 * ALL covers everything; MODULE covers the entity's module; ENTITY
 * covers exactly that entity.
 */

/** The trigger entity → its owning module (the MODULE scope's map —
 *  the four exemplar surfaces' own homes). */
const TRIGGER_ENTITY_MODULE: Record<string, string> = {
  manual_journal: "accounting",
  purchase_order: "purchasing",
  change_order: "crm",
  duty_drawback_claim: "trade",
};

export type DelegationScopeKind = "ALL" | "MODULE" | "ENTITY";

export interface DelegationWindowRow {
  readonly id: string;
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly scopeKind: DelegationScopeKind;
  readonly scopeValue: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly note: string | null;
}

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the delegation service requires an ambient tenant scope");
  }
  return context.tx;
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create one absence window (the save-time circularity law runs
 *  FIRST — the typed refusal names the full cycle the candidate would
 *  close). The window bounds are validated typed (a strictly-positive
 *  window — the DB floor's own law, defended here with the caller's
 *  values). */
export async function createDelegationWindow(input: {
  actorId: string;
  fromUserId: string;
  toUserId: string;
  scopeKind: DelegationScopeKind;
  scopeValue: string | null;
  startsAt: string;
  endsAt: string;
  note?: string | null;
}): Promise<DelegationWindowRow> {
  if (!UUID_SHAPE.test(input.fromUserId) || !UUID_SHAPE.test(input.toUserId)) {
    throw new WorkflowInputInvalidError({
      field: "fromUserId/toUserId",
      reason: "the delegation window's endpoints must be user ids",
    });
  }
  if (input.fromUserId === input.toUserId) {
    throw new WorkflowInputInvalidError({
      field: "toUserId",
      reason: "the trivial cycle is refused (the no-self floor — the delegate is the absent user)",
    });
  }
  // THE SCOPE PAIR LAW: ALL carries none; MODULE/ENTITY carry exactly one.
  if (input.scopeKind === "ALL" && input.scopeValue !== null) {
    throw new WorkflowInputInvalidError({
      field: "scopeValue",
      reason: "the ALL scope carries no value (the pair law)",
    });
  }
  if (input.scopeKind !== "ALL" && (input.scopeValue === null || input.scopeValue.length === 0)) {
    throw new WorkflowInputInvalidError({
      field: "scopeValue",
      reason: `the ${input.scopeKind} scope carries exactly one value (the pair law)`,
    });
  }
  if (input.scopeKind === "ENTITY" && !(input.scopeValue! in TRIGGER_ENTITY_MODULE)) {
    throw new WorkflowInputInvalidError({
      field: "scopeValue",
      reason: `the ENTITY scope names a trigger registry member (${Object.keys(TRIGGER_ENTITY_MODULE).join(" · ")})`,
    });
  }
  if (input.scopeKind === "MODULE" && !Object.values(TRIGGER_ENTITY_MODULE).includes(input.scopeValue!)) {
    throw new WorkflowInputInvalidError({
      field: "scopeValue",
      reason: `the MODULE scope names one of the bound modules (${[...new Set(Object.values(TRIGGER_ENTITY_MODULE))].join(" · ")})`,
    });
  }
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new WorkflowInputInvalidError({
      field: "endsAt",
      reason: "the window is strictly positive (ends after it starts — an empty or inverted window is never an absence)",
    });
  }

  // THE SAVE-TIME CIRCULARITY LAW over the standing ACTIVE windows (the
  // DB's own clock — the windows active NOW are the live graph).
  const active = await listActiveWindowsEdges();
  assertAcyclic(active, { fromUserId: input.fromUserId, toUserId: input.toUserId });

  const rows = await tenantTx().execute(sql`
    INSERT INTO delegations
      (id, tenant_id, from_user_id, to_user_id, scope_kind, scope_value, starts_at, ends_at, note, created_by)
    VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.fromUserId}, ${input.toUserId},
      ${input.scopeKind}, ${input.scopeValue}, ${input.startsAt}::timestamptz, ${input.endsAt}::timestamptz,
      ${input.note ?? null}, ${input.actorId}
    )
    RETURNING id, from_user_id AS "fromUserId", to_user_id AS "toUserId",
      scope_kind AS "scopeKind", scope_value AS "scopeValue",
      starts_at AS "startsAt", ends_at AS "endsAt", note
  `);
  return (rows.rows as unknown as DelegationWindowRow[])[0]!;
}

/** List a user's own windows (the delegate plane's own register). */
export async function listWindowsForUser(fromUserId: string): Promise<readonly DelegationWindowRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, from_user_id AS "fromUserId", to_user_id AS "toUserId",
           scope_kind AS "scopeKind", scope_value AS "scopeValue",
           starts_at AS "startsAt", ends_at AS "endsAt", note
    FROM delegations
    WHERE from_user_id = ${fromUserId}
    ORDER BY starts_at
  `);
  return rows.rows as unknown as DelegationWindowRow[];
}

/** End a window early (the absence cut short — the row's bounds narrow;
 *  the window is tenant DATA, editable, never deleted). */
export async function endDelegationWindow(input: {
  actorId: string;
  windowId: string;
  endsAt: string;
}): Promise<DelegationWindowRow | undefined> {
  const end = new Date(input.endsAt);
  if (Number.isNaN(end.getTime())) {
    throw new WorkflowInputInvalidError({ field: "endsAt", reason: "the early end is a timestamp" });
  }
  const rows = await tenantTx().execute(sql`
    UPDATE delegations
    SET ends_at = ${input.endsAt}::timestamptz, updated_by = ${input.actorId}, updated_at = now()
    WHERE id = ${input.windowId} AND starts_at < ${input.endsAt}::timestamptz
    RETURNING id, from_user_id AS "fromUserId", to_user_id AS "toUserId",
      scope_kind AS "scopeKind", scope_value AS "scopeValue",
      starts_at AS "startsAt", ends_at AS "endsAt", note
  `);
  return (rows.rows as unknown as DelegationWindowRow[])[0];
}

/** The ACTIVE windows' edge set — the DB's OWN CLOCK decides (now()
 *  between the bounds; never a JS Date.now() — the owner's standing
 *  clock law). */
export async function listActiveWindowsEdges(): Promise<readonly DelegationEdge[]> {
  const rows = await tenantTx().execute(sql`
    SELECT from_user_id AS "fromUserId", to_user_id AS "toUserId"
    FROM delegations
    WHERE starts_at <= now() AND now() < ends_at
  `);
  return rows.rows as unknown as DelegationEdge[];
}

/** THE ACT-TIME RESOLUTION (D-07): the ACTIVE, IN-SCOPE windows at the
 *  moment of the act, as the resolution plane's edge set — the scope
 *  law filters (ALL covers everything; MODULE covers the entity's
 *  module; ENTITY covers exactly that entity), the DB's own clock
 *  bounds (now() between the window's bounds), and the effective-actor
 *  walk (the pure fold) walks the filtered set to the terminal. */
export async function resolveEffectiveActor(input: {
  triggerEntity: string;
  assigneeUserId: string;
}): Promise<{
  effectiveActorId: string;
  chain: readonly string[];
  activeWindowCount: number;
  edges: readonly DelegationEdge[];
}> {
  const entity = input.triggerEntity;
  const module = TRIGGER_ENTITY_MODULE[entity];
  const rows = await tenantTx().execute(sql`
    SELECT from_user_id AS "fromUserId", to_user_id AS "toUserId"
    FROM delegations
    WHERE starts_at <= now() AND now() < ends_at
      AND (
        scope_kind = 'ALL'
        OR (scope_kind = 'MODULE' AND scope_value = ${module ?? null})
        OR (scope_kind = 'ENTITY' AND scope_value = ${entity})
      )
  `);
  const edges = rows.rows as unknown as DelegationEdge[];
  const walk = effectiveActor(edges, input.assigneeUserId);
  return { ...walk, activeWindowCount: edges.length, edges };
}

/** Does the ACTIVE, in-scope window set re-route this assignee at all?
 *  (The DELEGATED stamp's own probe — the assignment plane's read.) */
export async function hasActiveDelegation(input: {
  triggerEntity: string;
  assigneeUserId: string;
}): Promise<boolean> {
  const resolution = await resolveEffectiveActor(input);
  return resolution.effectiveActorId !== input.assigneeUserId;
}

export { TRIGGER_ENTITY_MODULE };
export { store as workflowStore };
