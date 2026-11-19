import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-047 (W-6 — T-17, D-14) — the acceptance evidence: the OA-06
 * EXPLAIN budgets for the phase's two hot probe families (the plan's
 * §5 T-17 row): THE APPLICANT PIPELINE READ (the board's
 * listApplicants driving shape — the tenant's vacancy, newest first —
 * and the W-6 pipeline report's per-vacancy stage fold over the LEFT
 * JOIN) and THE REVIEW-AGGREGATION FOLD (the 360 aggregate's driving
 * read — the reviewee's submitted rows by kind, BR-090's substrate —
 * and the cycle's whole review set the calibration view reads).
 *
 * The EXPLAIN method follows the PHASE-041/044/045/046 recorded
 * precedent verbatim: representative rows seeded first and ANALYZEd
 * so the planner's index choice is meaningful; `enable_seqscan = off`
 * isolates the index proof from the planner's volume-dependent cost
 * choice — the budget under test is the INDEX SHAPE servicing the hot
 * path. Every probe's plan is LOGGED verbatim (the suite output kept
 * in the gate evidence).
 *
 * THE OA-06 ASSERTION LAW (the W-9 ruling, D-14's own text): the
 * probes assert the stable INDEX-DRIVEN law — no seq-scan — accepting
 * the planner's legitimate index-driven paths (the P3/W-9 precedent's
 * regex shape); the rejected alternatives, per the ruling:
 * enable_bitmapscan=off / planner hints would make the probe testify
 * about a FORCED plan, and isolating the probe hides the shared-table
 * context it exists to police. Never a forced plan, never an isolated
 * probe context.
 *
 * THE ISOLATION LAW (the suite's serial discipline): the corpus lives
 * on a DEDICATED tenant (`TENANT_H_XB` — the H hex family's explain
 * arm, never the shared H suite's registers) so no other spec's
 * tenant-wide reads can ever observe it, and this spec's own probes
 * stay RLS-scoped to its world alone.
 */

/** The dedicated OA-06 tenant (the H hex family's explain arm). */
const TENANT_H_XB = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7e47";

let probeEmployee = "";
let probeVacancy = "";
let probeCycle = "";

beforeAll(async () => {
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant H-XB (explain budgets)', 'المستأجر هـ للميزانيات', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_H_XB],
  );
  await suClient.end();

  // The idempotency wipe (the embedded cluster persists across runs).
  const wipe = await superuserClient();
  for (const table of [
    "interviews",
    "applicants",
    "vacancies",
    "performance_reviews",
    "goals",
    "performance_cycles",
  ]) {
    await wipe.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT_H_XB]);
  }
  await wipe.query(`DELETE FROM employees WHERE tenant_id = $1 AND code LIKE 'EMP-XB%'`, [
    TENANT_H_XB,
  ]);
  await wipe.end();

  await withTenant(TENANT_H_XB, async () => {
    const tx = requireTenantContext().tx!;

    // -- 60 employees (EMP-XB01…60 — the explain prefix, distinct from
    //    every other spec's employee codes).
    const employees = await tx.execute<{ id: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             'EMP-XB' || lpad(g::text, 2, '0'),
             'Explain Employee ' || g, 'موظف الميزانية ' || g,
             '2026-01-01', 'FULL_TIME', 8000 + (g * 50), NULL
      FROM generate_series(1, 60) AS g
      RETURNING id
    `);
    const ids = employees.rows.map((row) => row.id);
    probeEmployee = ids[0]!;

    // ── THE REVIEW-AGGREGATION CORPUS: one ACTIVE cycle carrying the
    //    full 360 substrate — per reviewee, the MANAGER review plus
    //    the three 360 input kinds (SELF + 2 PEERS), every kind
    //    SUBMITTED (the aggregate's visible universe): 60 × 4 = 240
    //    rows through the service's own write path shape.
    const cycle = await tx.execute<{ id: string }>(sql`
      INSERT INTO performance_cycles (id, tenant_id, name, period_start, period_end, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 'XB FY2026 Cycle', '2026-01-01', '2026-12-31', 'ACTIVE')
      RETURNING id
    `);
    probeCycle = cycle.rows[0]!.id;

    await tx.execute(sql`
      INSERT INTO performance_reviews
        (id, tenant_id, cycle_id, reviewer_employee_id, reviewee_employee_id, kind, status, overall_score)
      SELECT gen_random_uuid(), erp.current_tenant_id(), ${probeCycle},
             k.reviewer_id, base.reviewee_id, k.kind, 'SUBMITTED', 70 + (base.g % 25)
      FROM (
        SELECT e.id AS reviewee_id, e.g,
               -- The wrap-safe distinct-peer mapping (g → g+1, g+2, g+3
               -- mod 60): every mapped peer differs from the reviewee
               -- AND from each other — BR-090's substrate law
               -- (ck_performance_reviews_self_kind) plus the natural
               -- uniqueness hold on every row.
               (SELECT e2.id FROM employees e2
                 WHERE e2.tenant_id = erp.current_tenant_id()
                   AND e2.code = 'EMP-XB' || lpad((((e.g) % 60) + 1)::text, 2, '0')) AS peer1,
               (SELECT e3.id FROM employees e3
                 WHERE e3.tenant_id = erp.current_tenant_id()
                   AND e3.code = 'EMP-XB' || lpad((((e.g + 1) % 60) + 1)::text, 2, '0')) AS peer2,
               (SELECT e4.id FROM employees e4
                 WHERE e4.tenant_id = erp.current_tenant_id()
                   AND e4.code = 'EMP-XB' || lpad((((e.g + 2) % 60) + 1)::text, 2, '0')) AS peer3
        FROM (SELECT id, row_number() OVER (ORDER BY code) AS g FROM employees
              WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'EMP-XB%') e
      ) base
      CROSS JOIN LATERAL (VALUES
        (base.peer1, 'MANAGER'),
        (base.reviewee_id, 'SELF'),
        (base.peer2, 'PEER'),
        (base.peer3, 'PEER')
      ) AS k(reviewer_id, kind)
    `);

    // ── THE APPLICANT-PIPELINE CORPUS: 20 vacancies × 30 applicants
    //    = 600 rows, the stages spread over the FIXED ladder
    //    (every sixth applicant advances one rung — NEW → HIRED).
    const vacancies = await tx.execute<{ id: string }>(sql`
      INSERT INTO vacancies (id, tenant_id, code, title, headcount, status)
      SELECT gen_random_uuid(), erp.current_tenant_id(),
             'V-XB' || lpad(g::text, 2, '0'), 'Explain Role ' || g, 2, 'OPEN'
      FROM generate_series(1, 20) AS g
      RETURNING id
    `);
    const vacancyIds = vacancies.rows.map((row) => row.id);
    probeVacancy = vacancyIds[0]!;

    await tx.execute(sql`
      INSERT INTO applicants (id, tenant_id, vacancy_id, full_name, stage, created_at)
      SELECT gen_random_uuid(), erp.current_tenant_id(), v.id,
             'Explain Applicant ' || v.g || '-' || a.g,
             (ARRAY['NEW','SCREEN','INTERVIEW','OFFER','HIRED','REJECTED'])[1 + ((v.g + a.g) % 6)],
             now() - (interval '1 hour' * (300 - a.g))
      FROM (SELECT id, row_number() OVER (ORDER BY code) AS g FROM vacancies
            WHERE tenant_id = erp.current_tenant_id() AND code LIKE 'V-XB%') v
      CROSS JOIN generate_series(1, 30) AS a(g)
    `);
  });

  // ANALYZE — the planner's index choice must be informed.
  const client = await superuserClient();
  await client.query("ANALYZE performance_reviews");
  await client.query("ANALYZE applicants");
  await client.query("ANALYZE vacancies");
  await client.query("ANALYZE employees");
  await client.end();
});

async function explain(label: string, query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_H_XB, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  const text = plan.join("\n");
  // The plans are LOGGED (the OA-06 explain plans log — the evidence
  // keeps the suite output verbatim).
  process.stdout.write(`[talent-explain-budgets] ${label}:\n${text}\n`);
  return text;
}

describe("PHASE-047 W-6 — OA-06 EXPLAIN budgets (the applicant pipeline + the review-aggregation fold)", () => {
  it("P1 the applicant pipeline board read (tenant + vacancy, newest first) rides ix_applicants_tenant_vacancy — no seq-scan", async () => {
    // listApplicants' driving shape: the board's per-vacancy
    // register, the newest applicants leading.
    const text = await explain(
      "P1 the pipeline board read",
      sql`
      SELECT id, full_name, stage, created_at
      FROM applicants
      WHERE tenant_id = erp.current_tenant_id()
        AND vacancy_id = ${probeVacancy}::uuid
      ORDER BY created_at DESC, full_name
      LIMIT 200`,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_applicants_tenant_vacancy|uq_applicants_id_tenant|ix_applicants_tenant_stage)|Bitmap (Heap )?Scan on (ix_applicants_tenant_vacancy|uq_applicants_id_tenant|ix_applicants_tenant_stage)|Bitmap Index Scan on (ix_applicants_tenant_vacancy|uq_applicants_id_tenant|ix_applicants_tenant_stage)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 the pipeline report's per-vacancy stage fold (the LEFT JOIN + the FILTER counts) is INDEX-DRIVEN — no seq-scan", async () => {
    // The W-6 recruitment-pipeline contract's driving shape: one row
    // per vacancy with BR-088's FIXED ladder as FILTER counts. The
    // assertion accepts every legitimate index-driven path over the
    // two tables (the P3/W-9 shape): the vacancies' tenant-status or
    // code index, the applicants' tenant-vacancy or tenant-stage
    // index, bitmap or index scan alike.
    const text = await explain(
      "P2 the pipeline report fold",
      sql`
      SELECT v.id, v.code, v.status,
             COUNT(a.id) FILTER (WHERE a.stage = 'NEW')::int,
             COUNT(a.id) FILTER (WHERE a.stage = 'SCREEN')::int,
             COUNT(a.id) FILTER (WHERE a.stage = 'INTERVIEW')::int,
             COUNT(a.id) FILTER (WHERE a.stage = 'OFFER')::int,
             COUNT(a.id) FILTER (WHERE a.stage = 'HIRED')::int,
             COUNT(a.id) FILTER (WHERE a.stage = 'REJECTED')::int,
             COUNT(a.id)::int
      FROM vacancies v
      LEFT JOIN applicants a ON a.vacancy_id = v.id AND a.tenant_id = v.tenant_id
      WHERE v.tenant_id = erp.current_tenant_id()
      GROUP BY v.id, v.code, v.status
      ORDER BY v.code`,
    );
    expect(text).not.toMatch(/Seq Scan/);
    expect(text).toMatch(/Index|Bitmap/);
  });

  it("P3 the 360 aggregation's driving read (tenant + reviewee + kind IN, SUBMITTED only) rides ix_performance_reviews_tenant_reviewee — no seq-scan", async () => {
    // aggregate360's driving shape (BR-090's substrate): the
    // reviewee's submitted 360 input rows by kind — the index's own
    // (tenant, reviewee, kind) shape.
    const text = await explain(
      "P3 the 360 aggregation fold",
      sql`
      SELECT kind, reviewer_employee_id, overall_score
      FROM performance_reviews
      WHERE tenant_id = erp.current_tenant_id()
        AND reviewee_employee_id = ${probeEmployee}::uuid
        AND kind IN ('SELF', 'PEER', 'SUBORDINATE')
        AND status IN ('SUBMITTED', 'CALIBRATED')`,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_performance_reviews_tenant_reviewee|ix_performance_reviews_tenant_cycle|uq_performance_reviews_cycle_reviewer_reviewee_kind)|Bitmap (Heap )?Scan on (ix_performance_reviews_tenant_reviewee|ix_performance_reviews_tenant_cycle|uq_performance_reviews_cycle_reviewer_reviewee_kind)|Bitmap Index Scan on (ix_performance_reviews_tenant_reviewee|ix_performance_reviews_tenant_cycle|uq_performance_reviews_cycle_reviewer_reviewee_kind)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P4 the cycle's whole review set (the calibration view / the report's read) rides ix_performance_reviews_tenant_cycle — no seq-scan", async () => {
    // The calibration view's driving shape: a cycle's whole review
    // set (the W-6 performance-cycle-results contract's universe
    // narrowed to the MANAGER outcomes).
    const text = await explain(
      "P4 the cycle review-set read",
      sql`
      SELECT r.reviewee_employee_id, r.kind, r.status, r.overall_score, r.goal_rollup
      FROM performance_reviews r
      WHERE r.tenant_id = erp.current_tenant_id()
        AND r.cycle_id = ${probeCycle}::uuid
        AND r.kind = 'MANAGER'
        AND r.status IN ('SUBMITTED', 'CALIBRATED')
      ORDER BY r.reviewee_employee_id`,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using (ix_performance_reviews_tenant_cycle|uq_performance_reviews_cycle_reviewer_reviewee_kind|ix_performance_reviews_tenant_reviewee)|Bitmap (Heap )?Scan on (ix_performance_reviews_tenant_cycle|uq_performance_reviews_cycle_reviewer_reviewee_kind|ix_performance_reviews_tenant_reviewee)|Bitmap Index Scan on (ix_performance_reviews_tenant_cycle|uq_performance_reviews_cycle_reviewer_reviewee_kind|ix_performance_reviews_tenant_reviewee)/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("the corpus is real (the planner's choice was informed): 240 reviews + 600 applicants on the dedicated tenant", async () => {
    const su = await superuserClient();
    const counts = await su.query<{ reviews: number; applicants: number }>(
      `SELECT
         (SELECT count(*)::int FROM performance_reviews WHERE tenant_id = $1) AS reviews,
         (SELECT count(*)::int FROM applicants WHERE tenant_id = $1) AS applicants`,
      [TENANT_H_XB],
    );
    await su.end();
    expect(counts.rows[0]!.reviews).toBe(240);
    expect(counts.rows[0]!.applicants).toBe(600);
  });
});
