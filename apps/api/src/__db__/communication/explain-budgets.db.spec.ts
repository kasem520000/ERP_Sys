import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { TENANT_S, setupSalesFixture } from "../sales/fixtures";

/**
 * PHASE-041 OA-06 EXPLAIN budgets (acceptance §6.9): the three hot paths
 * the communications hub adds — the outbox queue scan (the worker's
 * every-tick claim query, verbatim), the per-partner inbox list, and the
 * delivery-log report window. Representative rows are seeded first and
 * ANALYZEd so the planner's index choice is meaningful (an empty or
 * unstatistic'd table lets it pick arbitrarily); enable_seqscan=off then
 * isolates the index proof from the planner's volume-dependent cost choice
 * (the budget under test is the INDEX SHAPE servicing the hot path — the
 * migration 0064 §2/§5 indexes).
 *
 * The queue assertion follows the PHASE-037 recorded precedent: the planner
 * may ride EITHER tenant-leading message index that carries the status
 * predicate — the budget is the index-driven claim scan, never a seq-scan.
 */

const PARTNER = "72727272-0000-4000-8000-0000000000e1";
/** Out-of-window noise rows (2021) make the report window selective. */
const NOISE_PARTNERS = ["72727272-0000-4000-8000-0000000000f1"] as const;

beforeAll(async () => {
  await setupSalesFixture();
  await withTenant(TENANT_S, async (tx) => {
    // 250 QUEUED rows spread over next_attempt_at (the worker's backlog).
    for (let batch = 0; batch < 25; batch += 1) {
      await tx.execute(sql`
        INSERT INTO outbound_messages
          (id, tenant_id, channel, status, recipient, module, template_key, locale,
           body_snapshot, attempts, max_attempts, next_attempt_at, created_at, source_type)
        SELECT gen_random_uuid(), erp.current_tenant_id(),
               (ARRAY['EMAIL','WHATSAPP','SMS'])[1 + (g % 3)], 'QUEUED',
               'dest' || g || '@example.test', 'collections', 'dunning.step1.email', 'en',
               'body', 0, 3,
               now() - (g * interval '1 minute'), now() - (g * interval '2 minutes'),
               'DUNNING_LETTER'
        FROM generate_series(${batch * 10}::int, ${batch * 10 + 9}::int) AS g`);
    }
    // 50 DELIVERED rows (recent — inside the report window).
    await tx.execute(sql`
      INSERT INTO outbound_messages
        (id, tenant_id, channel, status, recipient, module, template_key, locale,
         body_snapshot, provider, provider_ref, cost_amount, cost_currency,
         attempts, max_attempts, sent_at, delivered_at, source_type, created_at)
      SELECT gen_random_uuid(), erp.current_tenant_id(), 'EMAIL', 'DELIVERED',
             'done' || g || '@example.test', 'collections', 'dunning.step1.email', 'en',
             'body', 'sendgrid', 'sg-' || g, 0.0025, 'USD', 1, 3, now(), now(),
             'DUNNING_LETTER', now() - (g * interval '5 minutes')
      FROM generate_series(0::int, 49::int) AS g`);
    // 300 out-of-window noise rows (2021) — the report window's selectivity.
    await tx.execute(sql`
      INSERT INTO outbound_messages
        (id, tenant_id, channel, status, recipient, module, template_key, locale,
         body_snapshot, attempts, max_attempts, created_at, source_type, last_error)
      SELECT gen_random_uuid(), erp.current_tenant_id(), 'EMAIL', 'FAILED',
             'old' || g || '@example.test', 'collections', 'dunning.step1.email', 'en',
             'body', 3, 3, TIMESTAMPTZ '2021-06-01' + (g * interval '1 day'),
             'DUNNING_LETTER', 'expired backfill noise'
      FROM generate_series(0::int, 299::int) AS g`);
    // The inbox: 50 rows for PARTNER + 450 spread across a second partner —
    // the per-partner predicate is genuinely selective.
    await tx.execute(sql`
      INSERT INTO communication_log
        (id, tenant_id, kind, direction, channel, at, partner_id, summary, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             'MESSAGE', 'OUTBOUND', 'EMAIL', now() - (g * interval '3 minutes'),
             ${PARTNER}, 'entry ' || g, NULL
      FROM generate_series(0::int, 49::int) AS g`);
    await tx.execute(sql`
      INSERT INTO communication_log
        (id, tenant_id, kind, direction, channel, at, partner_id, summary, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             'MESSAGE', 'OUTBOUND', 'EMAIL', now() - (g * interval '3 minutes'),
             ${NOISE_PARTNERS[0]}, 'noise ' || g, NULL
      FROM generate_series(0::int, 449::int) AS g`);
  });
  // Fresh inserts carry no statistics — the planner would estimate rows=1
  // and pick an arbitrary index. ANALYZE (superuser) makes the choice
  // reflect the seeded shape.
  const client = await superuserClient();
  await client.query("ANALYZE outbound_messages");
  await client.query("ANALYZE communication_log");
  await client.end();
});

async function explain(query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_S, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  return plan.join("\n");
}

describe("PHASE-041 OA-06 EXPLAIN budgets (acceptance 9)", () => {
  it("the outbox queue scan (the worker's claim query) is index-driven — no seq-scan", async () => {
    const text = await explain(sql`
      SELECT id FROM outbound_messages
      WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at LIMIT 50`);
    // The claim predicate (status + next_attempt_at under the tenant) is
    // serviced by the tenant-leading message indexes — the PHASE-037
    // recorded precedent (either predicate-matching index satisfies the
    // budget; the created_at order may add a sort node).
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_outbound_messages_(queue|report|partner|source)|Bitmap Index Scan on ix_outbound_messages_(queue|report|partner|source)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the per-partner inbox list rides ix_communication_log_partner (index scan, no seq-scan)", async () => {
    const text = await explain(sql`
      SELECT id, kind, direction, channel, at, summary, outcome, duration_minutes
      FROM communication_log
      WHERE tenant_id = erp.current_tenant_id() AND partner_id = ${PARTNER}
      ORDER BY at DESC
      LIMIT 50`);
    // The planner may serve the predicate as a plain index scan or a
    // bitmap index scan on the partner index — both are the budget.
    expect(text).toMatch(
      /Index (Only )?Scan using ix_communication_log_partner|Bitmap Index Scan on ix_communication_log_partner/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the tenant-wide inbox timeline rides ix_communication_log_tenant_at (index scan, no seq-scan)", async () => {
    const text = await explain(sql`
      SELECT id, kind, direction, channel, at, summary
      FROM communication_log
      WHERE tenant_id = erp.current_tenant_id()
      ORDER BY at DESC
      LIMIT 100`);
    expect(text).toMatch(/Index (Only )?Scan using ix_communication_log_tenant_at/);
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the delivery-log report window is index-driven over the message indexes — no seq-scan", async () => {
    // The current-month window (a typical run): recent rows in, the 2021
    // noise out — the range rides the tenant-leading indexes.
    const text = await explain(sql`
      SELECT id, channel, status, provider, cost_amount
      FROM outbound_messages
      WHERE tenant_id = erp.current_tenant_id()
        AND created_at >= date_trunc('month', now())
        AND created_at < date_trunc('month', now()) + interval '1 month'
      ORDER BY created_at DESC
      LIMIT 5000`);
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_outbound_messages_(report|queue|partner|source)|Bitmap Index Scan on ix_outbound_messages_(report|queue|partner|source)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
