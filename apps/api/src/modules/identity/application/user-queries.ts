import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { type TenantDb } from "../../../infra/db/client";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("query requires an ambient tenant scope");
  }
  return context.tx;
}

/**
 * PHASE-013 · user activity queries (REPORT_CATALOG §7
 * `platform.user-activity`): sessions + per-user audit event counts over
 * the window — composed from the identity + audit planes (the documented
 * userQueries.* surface the phase's prerequisites list expects).
 */

export interface UserActivityRow {
  userId: string;
  fullName: string;
  email: string;
  sessionCount: number;
  auditEventCount: number;
  lastActivityAt: string | null;
}

@Injectable()
export class UserQueriesService {
  /** Per-user activity summary inside the tenant for a window. */
  async activity(input: {
    fromDate: string;
    toDate: string;
  }): Promise<UserActivityRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH sess AS (
        SELECT user_id, COUNT(*)::int AS cnt, MAX(created_at)::text AS last_at
        FROM sessions
        WHERE created_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY user_id
      ), aud AS (
        SELECT actor_id, COUNT(*)::int AS cnt, MAX(at)::text AS last_at
        FROM audit_events
        WHERE actor_id IS NOT NULL
          AND at::date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY actor_id
      )
      SELECT u.id AS "userId", u.full_name AS "fullName", u.email,
             COALESCE(sess.cnt, 0)::int AS "sessionCount",
             COALESCE(aud.cnt, 0)::int AS "auditEventCount",
             GREATEST(sess.last_at, aud.last_at) AS "lastActivityAt"
      FROM users u
      LEFT JOIN sess ON sess.user_id = u.id
      LEFT JOIN aud ON aud.actor_id = u.id
      WHERE sess.user_id IS NOT NULL OR aud.actor_id IS NOT NULL
      ORDER BY GREATEST(COALESCE(sess.last_at, 'epoch'), COALESCE(aud.last_at, 'epoch')) DESC
      LIMIT 500
    `);
    return rows.rows as unknown as UserActivityRow[];
  }
}
