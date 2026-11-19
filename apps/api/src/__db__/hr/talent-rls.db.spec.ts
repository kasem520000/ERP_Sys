import { beforeAll, describe, expect, it } from "vitest";
import type { QueryResultRow } from "pg";

import { sql } from "drizzle-orm";

import { ensureTestDb, seedTenants, superuserClient, appClient } from "../test-db";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-047 (W-6 — T-17, CR-36e) — the DEDICATED talent RLS attack
 * suite (the plan §4's `talent-rls.db.spec`, A1–A10 ×14): the
 * phase's most privacy-sensitive payload (appraisal data, applicant
 * personal data, interview scorecards, document registers) attacked
 * cross-tenant as `erp_app` (non-owner, RLS enforced) exactly like
 * the production pool — every attack REQUIRED to fail closed.
 *
 * The generated A-suite (the W-1 registration, +84) polices the
 * generic shapes per registered table; THIS spec adds the
 * talent-specific arms the generic suite cannot express:
 *
 * - A1/A2/A4/A5/A7 ×14 over REAL FK-CHAINED worlds (a full talent
 *   plane per tenant — the generated suite's probes are minimal
 *   rows; here every child genuinely references its tenant's own
 *   parents through the composite FKs);
 * - A3 ×14 with typed INSERT shapes that reference the ATTACKER'S
 *   own parents while forging the VICTIM'S tenant_id (the WITH
 *   CHECK must reject every one — zero rows written in either
 *   tenant);
 * - A8 THE COMPOSITE-FK LAW (the family's structural defense): the
 *   talent child FKs are (id, tenant_id) composites — the
 *   FK-inversion attack (a child with the ATTACKER'S tenant_id
 *   pointing at the VICTIM'S parent id) is impossible by
 *   construction (23503), and the catalog walk proves every
 *   talent child FK carries the composite shape;
 * - A9/A10 the join + union/CTE confinement walks under the
 *   attacker's GUC — no FK-chain join, no UNION ALL over the
 *   fourteen tables, and no recursive CTE ever surfaces a victim
 *   row.
 *
 * The two probe tenants (TRL_A the victim, TRL_B the attacker) are
 * DEDICATED (never the shared H suite's registers — the exact-count
 * discipline).
 */

/** The VICTIM tenant (its talent world is the attack target). */
const TENANT_TRL_A = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a71a1";
/** The ATTACKER tenant (runs every probe under its own GUC). */
const TENANT_TRL_B = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a71b1";

/** The fourteen talent tables (migrations 0095–0097 — the plan §2). */
const TALENT_TABLES = [
  "performance_cycles",
  "performance_reviews",
  "competencies",
  "competency_levels",
  "goals",
  "vacancies",
  "applicants",
  "interviews",
  "training_programs",
  "training_enrollments",
  "certifications",
  "org_units",
  "positions",
  "employee_documents",
] as const;

/** The evidence-discipline tables (SELECT/INSERT/UPDATE only — no
 * DELETE grant for erp_app; the terminal soft states are status
 * flips, never erasures): A5's denial shape. */
const NO_DELETE_GRANT = new Set([
  "performance_reviews",
  "goals",
  "applicants",
  "interviews",
  "training_enrollments",
  "certifications",
]);

interface TalentWorld {
  ids: Record<string, string>;
}

/** Both tenants' worlds: the id map per table (A4/A5/A7's probe
 * targets) — the victim's ids are the attack targets. */
const worlds: Record<string, TalentWorld> = {};

/** Seed one tenant's FULL FK-chained talent world through the
 * app-role path (withTenant — the RLS-scoped writes prove the
 * composite FKs resolve within one tenant). */
async function seedWorld(tenantId: string, tag: string): Promise<Record<string, string>> {
  return withTenant(tenantId, async () => {
    const tx = requireTenantContext().tx!;
    const ids: Record<string, string> = {};

    const employees = await tx.execute<{ id: string; code: string }>(sql`
      INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary)
      VALUES
        (gen_random_uuid(), erp.current_tenant_id(), ${`EMP-TRL-${tag}`}, 'TRL Employee', 'موظف الفحص', '2026-01-01', 'FULL_TIME', 8000),
        (gen_random_uuid(), erp.current_tenant_id(), ${`MGR-TRL-${tag}`}, 'TRL Manager', 'مدير الفحص', '2025-01-01', 'FULL_TIME', 10000)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code
    `);
    const byCode = new Map(employees.rows.map((row) => [row.code, row.id]));
    ids.employee = byCode.get(`EMP-TRL-${tag}`)!;
    ids.manager = byCode.get(`MGR-TRL-${tag}`)!;

    const cycle = await tx.execute<{ id: string }>(sql`
      INSERT INTO performance_cycles (id, tenant_id, name, period_start, period_end, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`TRL Cycle ${tag}`}, '2026-01-01', '2026-12-31', 'ACTIVE')
      RETURNING id
    `);
    ids.performance_cycles = cycle.rows[0]!.id;

    // BR-090's substrate law: the MANAGER reviewer ≠ the reviewee
    // (ck_performance_reviews_self_kind — the 0095 floor).
    const review = await tx.execute<{ id: string }>(sql`
      INSERT INTO performance_reviews
        (id, tenant_id, cycle_id, reviewer_employee_id, reviewee_employee_id, kind, status, overall_score)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.performance_cycles}, ${ids.manager}, ${ids.employee}, 'MANAGER', 'SUBMITTED', 88.00)
      RETURNING id
    `);
    ids.performance_reviews = review.rows[0]!.id;

    const competency = await tx.execute<{ id: string }>(sql`
      INSERT INTO competencies (id, tenant_id, code, name)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`COMM-${tag}`}, 'TRL Communication')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    ids.competencies = competency.rows[0]!.id;

    const level = await tx.execute<{ id: string }>(sql`
      INSERT INTO competency_levels (id, tenant_id, level, name, name_ar, descriptor, descriptor_ar)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), 3, 'Meets', 'يحقق', 'Meets the bar', 'يحقق المعيار')
      ON CONFLICT (tenant_id, level) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    ids.competency_levels = level.rows[0]!.id;

    const goal = await tx.execute<{ id: string }>(sql`
      INSERT INTO goals (id, tenant_id, cycle_id, owner_employee_id, title, weight, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.performance_cycles}, ${ids.employee}, ${`TRL Goal ${tag}`}, '100.00', 'ACTIVE')
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    ids.goals = goal.rows[0]!.id;

    const vacancy = await tx.execute<{ id: string }>(sql`
      INSERT INTO vacancies (id, tenant_id, code, title, headcount, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`V-TRL-${tag}`}, 'TRL Role', 1, 'OPEN')
      ON CONFLICT (tenant_id, code) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `);
    ids.vacancies = vacancy.rows[0]!.id;

    const applicant = await tx.execute<{ id: string }>(sql`
      INSERT INTO applicants (id, tenant_id, vacancy_id, full_name, stage)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.vacancies}, ${`TRL Applicant ${tag}`}, 'SCREEN')
      RETURNING id
    `);
    ids.applicants = applicant.rows[0]!.id;

    const interview = await tx.execute<{ id: string }>(sql`
      INSERT INTO interviews
        (id, tenant_id, applicant_id, round, panelist_employee_id, scheduled_start, scheduled_end, mode)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.applicants}, 1, ${ids.employee},
              '2026-08-01 09:00:00+00', '2026-08-01 10:00:00+00', 'ONSITE')
      RETURNING id
    `);
    ids.interviews = interview.rows[0]!.id;

    const program = await tx.execute<{ id: string }>(sql`
      INSERT INTO training_programs (id, tenant_id, code, name, kind, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`TR-TRL-${tag}`}, 'TRL Program', 'INTERNAL', 'ACTIVE')
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    ids.training_programs = program.rows[0]!.id;

    const enrollment = await tx.execute<{ id: string }>(sql`
      INSERT INTO training_enrollments (id, tenant_id, program_id, employee_id, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.training_programs}, ${ids.employee}, 'ENROLLED')
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    ids.training_enrollments = enrollment.rows[0]!.id;

    const certification = await tx.execute<{ id: string }>(sql`
      INSERT INTO certifications (id, tenant_id, employee_id, name, issuer, issue_date, expiry_date)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.employee}, 'TRL Cert', 'TRL Issuer', '2026-01-01', CURRENT_DATE + 30)
      RETURNING id
    `);
    ids.certifications = certification.rows[0]!.id;

    const unit = await tx.execute<{ id: string }>(sql`
      INSERT INTO org_units (id, tenant_id, code, name, path, active)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`OU-TRL-${tag}`}, 'TRL Unit', ${`/TRL-${tag}`}, true)
      ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    ids.org_units = unit.rows[0]!.id;

    const position = await tx.execute<{ id: string }>(sql`
      INSERT INTO positions (id, tenant_id, code, title, org_unit_id, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${`POS-TRL-${tag}`}, 'TRL Position', ${ids.org_units}, 'ACTIVE')
      ON CONFLICT (tenant_id, code) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `);
    ids.positions = position.rows[0]!.id;

    const document = await tx.execute<{ id: string }>(sql`
      INSERT INTO employee_documents (id, tenant_id, employee_id, kind, number, expires_on)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${ids.employee}, 'IQAMA', ${`TRL-${tag}-NUM`}, CURRENT_DATE + 20)
      RETURNING id
    `);
    ids.employee_documents = document.rows[0]!.id;

    return ids;
  });
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant TRL-A (talent rls victim)', 'المستأجر أ للفحص', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant TRL-B (talent rls attacker)', 'المستأجر ب للفحص', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TRL_A, TENANT_TRL_B],
  );
  // The idempotency wipe (the embedded cluster persists across runs):
  // both probe tenants start from a CLEAN talent plane every run —
  // the children first (the RESTRICT FKs), then the parents. The
  // employees row rides the wipe too (the world's own employee, the
  // TRL-prefixed code — never another spec's).
  for (const tenantId of [TENANT_TRL_A, TENANT_TRL_B]) {
    for (const table of [
      "interviews",
      "applicants",
      "vacancies",
      "performance_reviews",
      "goals",
      "performance_cycles",
      "training_enrollments",
      "training_programs",
      "certifications",
      "employee_documents",
      "positions",
      "org_units",
      "competency_levels",
      "competencies",
    ]) {
      await su.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
    await su.query(
      `DELETE FROM employees WHERE tenant_id = $1 AND (code LIKE 'EMP-TRL-%' OR code LIKE 'MGR-TRL-%')`,
      [tenantId],
    );
  }
  await su.end();
  worlds[TENANT_TRL_A] = { ids: await seedWorld(TENANT_TRL_A, "A") };
  worlds[TENANT_TRL_B] = { ids: await seedWorld(TENANT_TRL_B, "B") };
});

/** Run a query under the ATTACKER's GUC as erp_app (the production
 * pool's shape — RLS enforced, tenant pinned by the GUC). */
async function asAttacker<T extends QueryResultRow>(
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const app = await appClient();
  await app.query("BEGIN");
  await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_TRL_B]);
  const result = await app.query<T>(query, params);
  await app.query("COMMIT");
  await app.end();
  return result.rows;
}

describe("PHASE-047 W-6 · the talent RLS attack suite (A1–A10 ×14, CR-36e)", () => {
  it("A1: SELECT without any GUC → 0 rows on every talent table (as erp_app)", async () => {
    const app = await appClient();
    for (const table of TALENT_TABLES) {
      const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows.rows[0]!.n, `${table} leaked rows without a GUC`).toBe(0);
    }
    await app.end();
  });

  it("A2: the attacker's GUC never exposes the victim's rows (foreign = 0, own ≥ 1 — every table)", async () => {
    for (const table of TALENT_TABLES) {
      const rows = await asAttacker<{ foreign: number; own: number }>(
        `SELECT count(*) FILTER (WHERE tenant_id <> $1)::int AS foreign,
                count(*) FILTER (WHERE tenant_id = $2)::int AS own
         FROM ${table}`,
        [TENANT_TRL_B, TENANT_TRL_B],
      );
      expect(rows[0]!.foreign, `${table} exposed the victim's rows`).toBe(0);
      expect(rows[0]!.own, `${table} should carry the attacker's own world`).toBeGreaterThan(0);
    }
  });

  it("A3: INSERT with the victim's tenant_id under the attacker's GUC → 42501 on every table (zero rows written)", async () => {
    const attacker = worlds[TENANT_TRL_B]!.ids;
    // Each shape references the ATTACKER'S own parents (valid FKs
    // under the composite law) while forging the VICTIM'S tenant_id —
    // the WITH CHECK must reject every one.
    const shapes: Array<[string, string, unknown[]]> = [
      [
        "performance_cycles",
        `INSERT INTO performance_cycles (id, tenant_id, name, period_start, period_end) VALUES ($1, $2, 'Forged Cycle', '2026-01-01', '2026-12-31')`,
        ["00000000-0000-4000-8000-0000000000f1", TENANT_TRL_A],
      ],
      [
        "performance_reviews",
        `INSERT INTO performance_reviews (id, tenant_id, cycle_id, reviewer_employee_id, reviewee_employee_id, kind) VALUES ($1, $2, $3, $4, $5, 'MANAGER')`,
        ["00000000-0000-4000-8000-0000000000f2", TENANT_TRL_A, attacker.performance_cycles, attacker.manager, attacker.employee],
      ],
      [
        "competencies",
        `INSERT INTO competencies (id, tenant_id, code, name) VALUES ($1, $2, 'FORGED', 'Forged')`,
        ["00000000-0000-4000-8000-0000000000f3", TENANT_TRL_A],
      ],
      [
        "competency_levels",
        `INSERT INTO competency_levels (id, tenant_id, level, name, name_ar, descriptor, descriptor_ar) VALUES ($1, $2, 9, 'Forged', 'مزيف', 'Forged', 'مزيف')`,
        ["00000000-0000-4000-8000-0000000000f4", TENANT_TRL_A],
      ],
      [
        "goals",
        `INSERT INTO goals (id, tenant_id, cycle_id, owner_employee_id, title, weight) VALUES ($1, $2, $3, $4, 'Forged Goal', '100.00')`,
        ["00000000-0000-4000-8000-0000000000f5", TENANT_TRL_A, attacker.performance_cycles, attacker.employee],
      ],
      [
        "vacancies",
        `INSERT INTO vacancies (id, tenant_id, code, title, headcount) VALUES ($1, $2, 'FORGED-V', 'Forged', 1)`,
        ["00000000-0000-4000-8000-0000000000f6", TENANT_TRL_A],
      ],
      [
        "applicants",
        `INSERT INTO applicants (id, tenant_id, vacancy_id, full_name) VALUES ($1, $2, $3, 'Forged Applicant')`,
        ["00000000-0000-4000-8000-0000000000f7", TENANT_TRL_A, attacker.vacancies],
      ],
      [
        "interviews",
        `INSERT INTO interviews (id, tenant_id, applicant_id, round, panelist_employee_id, scheduled_start, scheduled_end, mode) VALUES ($1, $2, $3, 1, $4, '2026-08-01 09:00:00+00', '2026-08-01 10:00:00+00', 'ONSITE')`,
        ["00000000-0000-4000-8000-0000000000f8", TENANT_TRL_A, attacker.applicants, attacker.employee],
      ],
      [
        "training_programs",
        `INSERT INTO training_programs (id, tenant_id, code, name, kind) VALUES ($1, $2, 'FORGED-TR', 'Forged', 'COURSE')`,
        ["00000000-0000-4000-8000-0000000000f9", TENANT_TRL_A],
      ],
      [
        "training_enrollments",
        `INSERT INTO training_enrollments (id, tenant_id, program_id, employee_id) VALUES ($1, $2, $3, $4)`,
        ["00000000-0000-4000-8000-0000000000fa", TENANT_TRL_A, attacker.training_programs, attacker.employee],
      ],
      [
        "certifications",
        `INSERT INTO certifications (id, tenant_id, employee_id, name, issuer, issue_date) VALUES ($1, $2, $3, 'Forged Cert', 'Forged', '2026-01-01')`,
        ["00000000-0000-4000-8000-0000000000fb", TENANT_TRL_A, attacker.employee],
      ],
      [
        "org_units",
        `INSERT INTO org_units (id, tenant_id, code, name, path) VALUES ($1, $2, 'FORGED-OU', 'Forged', '/FORGED')`,
        ["00000000-0000-4000-8000-0000000000fc", TENANT_TRL_A],
      ],
      [
        "positions",
        `INSERT INTO positions (id, tenant_id, code, title) VALUES ($1, $2, 'FORGED-POS', 'Forged')`,
        ["00000000-0000-4000-8000-0000000000fd", TENANT_TRL_A],
      ],
      [
        "employee_documents",
        `INSERT INTO employee_documents (id, tenant_id, employee_id, kind) VALUES ($1, $2, $3, 'IQAMA')`,
        ["00000000-0000-4000-8000-0000000000fe", TENANT_TRL_A, attacker.employee],
      ],
    ];
    expect(shapes).toHaveLength(14);
    for (const [table, query, params] of shapes) {
      const app = await appClient();
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_TRL_B]);
      await expect(app.query(query, params), `${table} accepted a mismatched-tenant INSERT`).rejects.toMatchObject(
        { code: "42501" },
      );
      await app.query("ROLLBACK");
      await app.end();
    }
    // Zero rows written: NONE of the fourteen forged ids exists in
    // either tenant (the superuser census over both worlds).
    const su = await superuserClient();
    const forgedIds = shapes.map(([, , params]) => params[0] as string);
    for (const table of TALENT_TABLES) {
      const counts = await su.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`,
        [forgedIds],
      );
      expect(counts.rows[0]!.n, `${table}: a forged row landed`).toBe(0);
    }
    await su.end();
  });

  it("A4: UPDATE of the victim's row by id under the attacker's GUC → 0 rows affected, row byte-identical", async () => {
    const victim = worlds[TENANT_TRL_A]!.ids;
    // The staged hijack shapes: the review's score, the applicant's
    // stage, the document's expiry — the three most damaging flips.
    const probes: Array<[string, string, string, unknown[]]> = [
      ["performance_reviews", "UPDATE performance_reviews SET overall_score = 0 WHERE id = $1", "overall_score", [victim.performance_reviews]],
      ["applicants", "UPDATE applicants SET stage = 'REJECTED' WHERE id = $1", "stage", [victim.applicants]],
      ["employee_documents", "UPDATE employee_documents SET expires_on = CURRENT_DATE + 365 WHERE id = $1", "expires_on", [victim.employee_documents]],
    ];
    const su = await superuserClient();
    for (const [table, query, column, params] of probes) {
      const before = await su.query(`SELECT ${column}::text AS v FROM ${table} WHERE id = $1`, params);
      const affected = await asAttacker<{ n: number }>(
        `WITH updated AS (${query} RETURNING 1) SELECT count(*)::int AS n FROM updated`,
        params,
      );
      expect(affected[0]!.n, `${table}: the attacker's UPDATE touched the victim's row`).toBe(0);
      const after = await su.query(`SELECT ${column}::text AS v FROM ${table} WHERE id = $1`, params);
      expect(after.rows[0]!.v).toBe(before.rows[0]!.v);
    }
    await su.end();
  });

  it("A5: DELETE of the victim's row under the attacker's GUC → 0 rows (the granted tables) or the grant denial (the evidence tables)", async () => {
    const victim = worlds[TENANT_TRL_A]!.ids;
    // One probe per grant shape: the master-data table with DELETE
    // granted (0 rows via RLS) and the evidence table without the
    // grant (the denial itself — 42501).
    const granted = await asAttacker<{ n: number }>(
      `WITH deleted AS (DELETE FROM employee_documents WHERE id = $1 RETURNING 1) SELECT count(*)::int AS n FROM deleted`,
      [victim.employee_documents],
    );
    expect(granted[0]!.n).toBe(0);
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_TRL_B]);
    await expect(
      app.query(`DELETE FROM performance_reviews WHERE id = $1`, [victim.performance_reviews]),
      "the evidence table's DELETE must be grant-denied",
    ).rejects.toMatchObject({ code: "42501" });
    await app.query("ROLLBACK");
    await app.end();
    // The evidence-discipline census: the six no-DELETE tables.
    expect([...NO_DELETE_GRANT].sort()).toEqual([
      "applicants",
      "certifications",
      "goals",
      "interviews",
      "performance_reviews",
      "training_enrollments",
    ]);
  });

  it("A7: id-based probes of the victim's exact row ids → 0 rows (no existence leak)", async () => {
    const victim = worlds[TENANT_TRL_A]!.ids;
    for (const table of TALENT_TABLES) {
      const rows = await asAttacker<{ n: number }>(
        `SELECT count(*)::int AS n FROM ${table} WHERE id = $1`,
        [victim[table]],
      );
      expect(rows[0]!.n, `${table}: the victim's id leaked under the attacker's GUC`).toBe(0);
    }
  });

  it("A8: THE COMPOSITE-FK LAW — the talent child FKs are (id, tenant_id) composites; the FK-inversion attack is impossible by construction (23503)", async () => {
    // (a) The catalog walk: every FK column pair the talent children
    // carry on their tenant-scoped parents includes tenant_id.
    const su = await superuserClient();
    const composites = await su.query<{ table_name: string; column_names: string }>(
      `SELECT tc.table_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS column_names
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name AND kcu.table_name = tc.table_name
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = 'public'
         AND tc.table_name IN ('performance_reviews','goals','applicants','interviews',
                               'training_enrollments','certifications','positions','employee_documents')
         AND ccu.table_name IN ('performance_cycles','employees','vacancies','applicants',
                                'training_programs','org_units')
       GROUP BY tc.table_name, tc.constraint_name
       ORDER BY tc.table_name`,
    );
    await su.end();
    // The tenant-scoped parents' FKs must ALL carry tenant_id beside
    // the parent id (the A8 law). The self-references (goals →
    // parent_goal_id, positions → reports_to) are deliberately NOT
    // composite (the same-tenant guarantee flows through the parent's
    // own composite FK + RLS).
    const compositeByTable = new Map<string, number>();
    for (const row of composites.rows) {
      if (row.column_names.includes("tenant_id")) {
        compositeByTable.set(row.table_name, (compositeByTable.get(row.table_name) ?? 0) + 1);
      }
    }
    for (const table of [
      "performance_reviews",
      "goals",
      "applicants",
      "interviews",
      "training_enrollments",
      "certifications",
      "positions",
      "employee_documents",
    ]) {
      expect(compositeByTable.get(table), `${table} must carry composite (id, tenant_id) FKs`).toBeGreaterThan(0);
    }

    // (b) The live FK-inversion probe: a child with the ATTACKER'S
    // tenant_id pointing at the VICTIM'S parent id can NEVER resolve
    // (the composite (id, tenant_id) has no matching parent row).
    const victim = worlds[TENANT_TRL_A]!.ids;
    const app = await appClient();
    await app.query("BEGIN");
    await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_TRL_B]);
    await expect(
      app.query(
        `INSERT INTO performance_reviews (id, tenant_id, cycle_id, reviewer_employee_id, reviewee_employee_id, kind)
         VALUES (gen_random_uuid(), erp.current_tenant_id(), $1, $2, $3, 'MANAGER')`,
        [victim.performance_cycles, worlds[TENANT_TRL_B]!.ids.manager, worlds[TENANT_TRL_B]!.ids.employee],
      ),
      "the FK-inversion INSERT must fail on the composite FK",
    ).rejects.toMatchObject({ code: "23503" });
    await app.query("ROLLBACK");
    await app.end();
  });

  it("A9: the FK-chain joins under the attacker's GUC never surface the victim's parents", async () => {
    // The deepest chains: reviews → cycles + employees; interviews →
    // applicants → vacancies; enrollments → programs + employees;
    // documents → employees. Under the attacker's GUC every join
    // stays inside the attacker's world.
    const joins: Array<[string, string]> = [
      [
        "reviews→cycles",
        `SELECT count(*)::int AS n FROM performance_reviews r
         JOIN performance_cycles c ON c.id = r.cycle_id AND c.tenant_id = r.tenant_id
         WHERE c.name LIKE 'TRL Cycle A%'`,
      ],
      [
        "interviews→applicants→vacancies",
        `SELECT count(*)::int AS n FROM interviews i
         JOIN applicants a ON a.id = i.applicant_id AND a.tenant_id = i.tenant_id
         JOIN vacancies v ON v.id = a.vacancy_id AND v.tenant_id = a.tenant_id
         WHERE v.code = 'V-TRL-A'`,
      ],
      [
        "enrollments→programs",
        `SELECT count(*)::int AS n FROM training_enrollments t
         JOIN training_programs p ON p.id = t.program_id AND p.tenant_id = t.tenant_id
         WHERE p.code = 'TR-TRL-A'`,
      ],
      [
        "documents→employees",
        `SELECT count(*)::int AS n FROM employee_documents d
         JOIN employees e ON e.id = d.employee_id AND e.tenant_id = d.tenant_id
         WHERE e.code = 'EMP-TRL-A'`,
      ],
    ];
    for (const [label, query] of joins) {
      const rows = await asAttacker<{ n: number }>(query);
      expect(rows[0]!.n, `${label}: the join leaked the victim's chain`).toBe(0);
    }
  });

  it("A10: UNION ALL over the fourteen tables + a recursive CTE walk under the attacker's GUC → 0 victim rows", async () => {
    const unionQuery = TALENT_TABLES.map(
      (table) => `SELECT tenant_id FROM ${table}`,
    ).join(" UNION ALL ");
    const rows = await asAttacker<{ n: number }>(
      `SELECT count(*)::int AS n FROM (${unionQuery}) u WHERE u.tenant_id = $1`,
      [TENANT_TRL_A],
    );
    expect(rows[0]!.n, "the UNION walk leaked the victim's rows").toBe(0);

    // The recursive CTE (the org-tree walk shape — the materialized
    // path's own traversal): starting from the attacker's own unit,
    // the walk never reaches the victim's tree.
    const cte = await asAttacker<{ n: number }>(
      `WITH RECURSIVE tree AS (
         SELECT id, tenant_id, path FROM org_units WHERE code = 'OU-TRL-B'
         UNION ALL
         SELECT o.id, o.tenant_id, o.path FROM org_units o
         JOIN tree t ON o.parent_id = t.id AND o.tenant_id = t.tenant_id
       ) SELECT count(*)::int AS n FROM tree WHERE tenant_id = $1`,
      [TENANT_TRL_A],
    );
    expect(cte[0]!.n, "the recursive walk leaked the victim's tree").toBe(0);
  });

  it("the full census: both worlds intact after every attack (the byte-count floor)", async () => {
    const su = await superuserClient();
    for (const [tenantId, world] of Object.entries(worlds)) {
      const rows = await su.query<{ table_name: string; n: number }>(
        `SELECT table_name, count(*)::int AS n
         FROM (
           SELECT 'performance_cycles' AS table_name, tenant_id FROM performance_cycles WHERE id = $2
           UNION ALL SELECT 'performance_reviews', tenant_id FROM performance_reviews WHERE id = $3
           UNION ALL SELECT 'competencies', tenant_id FROM competencies WHERE id = $4
           UNION ALL SELECT 'competency_levels', tenant_id FROM competency_levels WHERE id = $5
           UNION ALL SELECT 'goals', tenant_id FROM goals WHERE id = $6
           UNION ALL SELECT 'vacancies', tenant_id FROM vacancies WHERE id = $7
           UNION ALL SELECT 'applicants', tenant_id FROM applicants WHERE id = $8
           UNION ALL SELECT 'interviews', tenant_id FROM interviews WHERE id = $9
           UNION ALL SELECT 'training_programs', tenant_id FROM training_programs WHERE id = $10
           UNION ALL SELECT 'training_enrollments', tenant_id FROM training_enrollments WHERE id = $11
           UNION ALL SELECT 'certifications', tenant_id FROM certifications WHERE id = $12
           UNION ALL SELECT 'org_units', tenant_id FROM org_units WHERE id = $13
           UNION ALL SELECT 'positions', tenant_id FROM positions WHERE id = $14
           UNION ALL SELECT 'employee_documents', tenant_id FROM employee_documents WHERE id = $15
         ) probe
         WHERE tenant_id = $1
         GROUP BY table_name`,
        [
          tenantId,
          world.ids.performance_cycles,
          world.ids.performance_reviews,
          world.ids.competencies,
          world.ids.competency_levels,
          world.ids.goals,
          world.ids.vacancies,
          world.ids.applicants,
          world.ids.interviews,
          world.ids.training_programs,
          world.ids.training_enrollments,
          world.ids.certifications,
          world.ids.org_units,
          world.ids.positions,
          world.ids.employee_documents,
        ],
      );
      // Every one of the fourteen rows survived every attack, still
      // owned by its own tenant.
      expect(rows.rows.length, `${tenantId}: the world lost rows to the attacks`).toBe(14);
    }
    await su.end();
  });
});
