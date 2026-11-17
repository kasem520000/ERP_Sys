import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import {
  P_ACTOR,
  P_APPROVER,
  calculation,
  employees,
  periods,
  runPosting,
  setupPayrollFixture,
  su,
  withTenant,
  workflow,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { StructureService } from "../../modules/payroll/application/structure-service";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import {
  AR_HEADERS,
  EN_HEADERS,
} from "../../modules/payroll/infrastructure/remittance-export-file";
import { reloadEnv } from "../../config/env";
import { AppModule } from "../../app.module";
import { closeDb } from "../../infra/db/client";
import { stopBoss } from "../../infra/jobs/boss";
import { PasswordService } from "../../modules/identity/application/password-service";
import * as identityStore from "../../modules/identity/infrastructure/identity.store";

/**
 * PHASE-046 (W-4) — THE ROUTE-LEVEL SPEC (T-08 + T-09, the identity-http
 * idiom: the FULL Nest pipeline — middleware → session → permission guard
 * → controller → ERROR_MODEL filter — against the real PostgreSQL stack):
 *
 * (a) THE VERIFY ROUTE (`POST /payroll/statutory/profiles/:id/verify` on
 *     `payroll.statutory.verify`): the permission gate (anonymous 401,
 *     viewer 403 — the owner-only seed), the flip + the audit trail
 *     (`payroll.statutory_verified` carrying the citation), the SoD law
 *     (the verifier ≠ the row's last editor — the typed 409), the CAS
 *     (a second verify is the typed STATUTORY_ALREADY_VERIFIED 409; a
 *     CONCURRENT pair collapses to exactly one 200 + one 409 + ONE audit
 *     event + one flip — the D-09/D-10 law at the HTTP surface), and the
 *     A7 404 (unknown == foreign). Zero residue on every refusal.
 *
 * (b) THE REMITTANCE EXPORT ROUTE (`GET /payroll/runs/:id/remittance-export`
 *     on `payroll.statutory`): POSTED-only (a DRAFT is the typed
 *     IMMUTABLE_DOCUMENT 409 — the remittance settlement's own law), the
 *     A7 404, the streamed bytes with Content-Disposition, and THE
 *     ROUND-TRIP over the KSA worked example (the owner's corrected
 *     schedule, both arms active):
 *
 *       Saudi EMP-RM-001 basic 10,000 + housing 2,000 → PENSION 1,080/1,080
 *       + SANED 90/90 + OH 0/240 = employee 1,170 / employer 1,410;
 *       non-Saudi EMP-RM-002 (EG) → OH-only 0/240;
 *       run: employee 1,170 · employer 1,650 · PIT 0 (the honest no-bracket
 *       zero) · grand total 2,820; the frozen statutory_summary:
 *       GOSI-OH 480 · GOSI-PENSION 2,160 · GOSI-SANED 180 — the export's
 *       per-code totals tie THESE rows exactly.
 *
 *     The XLSX parse-back (exceljs): the RTL view at locale=ar, the Arabic
 *     header set, the tabular `#,##0.0000` formats, the per-employee
 *     breakdown rows, the bold totals, the summary block; the CSV
 *     parse-back: the UTF-8 BOM, RFC-4180, the frozen exact 4dp strings.
 *     The locale law (en → LTR + EN_HEADERS). The establishment readiness
 *     arm (unset → the honest not-configured note; set → the number
 *     rides the file). THE AUDIT (`payroll.remittance_exported` per
 *     generation). THE NEGATIVE LEDGER PROOF (BR-086): through every
 *     export the run row and the journal registers stay byte-identical —
 *     the export is a read-only audited artifact.
 *
 * Isolation — THE DEDICATED TENANT (the eosb/run-statutory precedent):
 * tenant REMIT carries its own CoA + FY2026 + structure + the canonical
 * statutory set + its own login users (owner + viewer, cloned templates),
 * never the PAY world's registers (whose censuses the 029 spec pins).
 */

const TENANT_REMIT = "8b8b8b8b-8b8b-8b8b-8b8b-8b8b8b8b8b8b";
const SPEC_PASSWORD = "route-strong-passphrase-7";

const audit = new AuditService(new DrizzleAuditStore());
const structuresService = new StructureService(audit);

interface RemitWorld {
  structureId: string;
  periodIds: Record<string, string>;
  postedRunId: string;
  draftRunId: string;
  ksaEmployeeCode: string;
  nsEmployeeCode: string;
  /** The negative-ledger baseline (BR-086): the run row + the journal
   *  registers captured AFTER the world build — every export must leave
   *  them byte-identical. */
  runRowBefore: Record<string, unknown>;
  journalCountsBefore: { entries: number; lines: number };
}

let world: RemitWorld;
let httpBase: string;
let shutdown: (() => Promise<void>) | undefined;

const owner = { email: `remit-owner-${generateUuidV7().slice(0, 8)}@fixture.test`, userId: "", token: "" };
const viewer = { email: `remit-viewer-${generateUuidV7().slice(0, 8)}@fixture.test`, userId: "", token: "" };

/** Insert a spec-owned REQUIRES_VERIFICATION profile row (the statutory.spec
 * pattern — the route's own attack target, independent of the canonical set). */
async function insertProfileRow(input: {
  code: string;
  status?: string;
  updatedBy?: string | null;
}): Promise<string> {
  const client = await su();
  const result = await client.query<{ id: string }>(
    `INSERT INTO statutory_contribution_profiles
       (id, tenant_id, jurisdiction_code, code, name, employee_rate, employer_rate,
        contributory_keys, applies_to, effective_from, status, updated_by)
     VALUES (gen_random_uuid(), $1, 'ZZ', $2, $2, 0, 0, '["HOUSING"]'::jsonb, 'ALL', '2020-01-01', $3, $4)
     RETURNING id`,
    [TENANT_REMIT, input.code, input.status ?? "REQUIRES_VERIFICATION", input.updatedBy ?? null],
  );
  await client.end();
  return result.rows[0]!.id;
}

async function readAuditEvents(
  action: string,
  entityId?: string,
): Promise<{ action: string; actor_id: string | null; after: unknown }[]> {
  const client = await su();
  const result = await client.query(
    `SELECT action, actor_id, after FROM audit_events
      WHERE tenant_id = $1 AND action = $2 AND ($3::uuid IS NULL OR entity_id = $3)
      ORDER BY at DESC`,
    [TENANT_REMIT, action, entityId ?? null],
  );
  await client.end();
  return result.rows as { action: string; actor_id: string | null; after: unknown }[];
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const merged: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": generateUuidV7(),
    ...headers,
  };
  return fetch(`${httpBase}${path}`, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${httpBase}${path}`, { headers });
}

beforeAll(async () => {
  reloadEnv();
  await setupPayrollFixture(); // the DB harness + the shared services

  // The dedicated REMIT tenant + its two login users (cloned templates —
  // the identity-http pattern: owner carries every tenant-plane key incl.
  // payroll.statutory.verify; viewer carries neither statutory key).
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant REMIT (046 routes)', 'المستأجر لمسارات القانونية', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_REMIT],
  );
  const passwordService = new PasswordService();
  async function seedUserWithRole(
    account: { email: string; userId: string },
    templateKey: "owner" | "viewer",
  ): Promise<string> {
    const hash = await passwordService.hashFromNewPassword(SPEC_PASSWORD);
    const user = await identityStore.insertUser({
      email: account.email,
      fullName: `Remit ${templateKey}`,
      passwordHash: hash,
      status: "ACTIVE",
    });
    account.userId = user.id;
    const roleId = generateUuidV7();
    const template = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1`,
      [templateKey],
    );
    await client.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, $3, $4, $5)`,
      [roleId, TENANT_REMIT, `${templateKey}_remit`, templateKey, "دور"],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
      [roleId, TENANT_REMIT, template.rows[0]!.id],
    );
    await client.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), TENANT_REMIT, user.id, roleId],
    );
    return user.id;
  }
  await seedUserWithRole(owner, "owner");
  await seedUserWithRole(viewer, "viewer");
  await client.end();

  // The REMIT world: CoA + FY2026 + the canonical statutory set + the
  // two-arm structure + the posted golden run (the run-statutory idiom).
  world = await withTenant(TENANT_REMIT, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const salariesExpenseAccount = (
      await accounting.findActivePurpose("SALARIES_EXPENSE")
    )!.accountId;

    const structure =
      (await structuresService.list(50)).find((row) => row.code === "ST-RM") ??
      (await structuresService.create({
        code: "ST-RM",
        name: "Route spec structure",
        nameAr: "هيكل مواصفة المسارات",
        actorId: P_ACTOR,
      }));
    const { countComponents } = await import("../../modules/payroll/infrastructure/payroll.store");
    if ((await countComponents(structure.id)) === 0) {
      await structuresService.replaceComponents(
        structure.id,
        [
          {
            key: "HOUSING",
            name: "Housing allowance",
            nameAr: "بدل السكن",
            kind: "ALLOWANCE",
            calc: "FIXED",
            amount: "2000.0000",
            glAccountId: salariesExpenseAccount,
            isEosBase: false,
            seq: 1,
          },
        ],
        P_ACTOR,
      );
    }

    const year = await periods.createYear(P_ACTOR, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const periodIds: Record<string, string> = {};
    for (const period of await accounting.listPeriods(year.id)) {
      if (period.kind === "REGULAR") periodIds[period.name] = period.id;
    }

    await materializeCanonicalStatutorySet();

    const list = await employees.list({ limit: 100 });
    const ksa =
      list.find((row) => row.code === "EMP-RM-001") ??
      (await employees.create({
        code: "EMP-RM-001",
        name: "Route Saudi Employee",
        nameAr: "موظف المسار السعودي",
        nationality: "SA",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }));
    const ns =
      list.find((row) => row.code === "EMP-RM-002") ??
      (await employees.create({
        code: "EMP-RM-002",
        name: "Route Non-Saudi Employee",
        nameAr: "موظف المسار غير السعودي",
        nationality: "EG",
        hireDate: "2021-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }));

    // The posted golden run (both arms active).
    const run = await calculation.createRun({
      fiscalPeriodId: periodIds["FY2026-01"]!,
      actorId: P_ACTOR,
    });
    await calculation.calculate(run.id, { actorId: P_ACTOR });
    await workflow.submit(run.id, P_ACTOR);
    await workflow.approve(run.id, P_APPROVER);
    const posted = await runPosting.post(run.id, P_ACTOR);
    expect(posted.status).toBe("POSTED");

    // The DRAFT run (the POSTED-only refusal arm).
    const draft = await calculation.createRun({
      fiscalPeriodId: periodIds["FY2026-02"]!,
      actorId: P_ACTOR,
    });

    return {
      structureId: structure.id,
      periodIds,
      postedRunId: run.id,
      draftRunId: draft.id,
      ksaEmployeeCode: ksa.code,
      nsEmployeeCode: ns.code,
      runRowBefore: {},
      journalCountsBefore: { entries: 0, lines: 0 },
    };
  });

  // THE NEGATIVE-LEDGER BASELINE (BR-086): captured after the world build —
  // the exports must leave the run row + the journal registers identical.
  const ledgerClient = await su();
  const runBefore = await ledgerClient.query(
    `SELECT status, version, gross_total, deductions_total, net_total,
            statutory_employee_total, statutory_employer_total, pit_total, statutory_summary
       FROM payroll_runs WHERE id = $1`,
    [world.postedRunId],
  );
  const journalsBefore = await ledgerClient.query<{ entries: number; lines: number }>(
    `SELECT (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::int AS entries,
            (SELECT count(*) FROM journal_lines WHERE tenant_id = $1)::int AS lines`,
    [TENANT_REMIT],
  );
  await ledgerClient.end();
  world.runRowBefore = runBefore.rows[0]! as Record<string, unknown>;
  world.journalCountsBefore = journalsBefore.rows[0]!;
  // The posted run's ONE G-29-extended journal: SALARIES 24,000 ·
  // EMPLOYER_CONTRIBUTIONS 1,650 · DEDUCTIONS_PAYABLE 2,820 ·
  // SALARIES_PAYABLE 22,830 (EOS off — the zero groups never form).
  expect(world.journalCountsBefore).toEqual({ entries: 1, lines: 4 });

  // Boot the real application (HTTP + guards + the error filter).
  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: false });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };

  // Logins (the rotating session tokens).
  for (const account of [owner, viewer]) {
    const response = await post("/api/v1/identity/sessions", {
      email: account.email,
      password: SPEC_PASSWORD,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { token: string } };
    account.token = body.data.token;
  }
}, 180_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("PHASE-046 W-4 T-09 — the verify route (payroll.statutory.verify)", () => {
  it("(a) the permission gate: anonymous 401, viewer 403 FORBIDDEN naming the key, owner passes the guard", async () => {
    const profileId = await insertProfileRow({ code: "ZZ-GATE" });
    const anonymous = await post(`/api/v1/payroll/statutory/profiles/${profileId}/verify`, {
      sourceName: "x",
    });
    expect(anonymous.status).toBe(401);

    const denied = await post(
      `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
      { sourceName: "x" },
      { "x-session-token": viewer.token },
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as {
      error: { code: string; details: { permissionKey: string } };
    };
    expect(deniedBody.error.code).toBe("FORBIDDEN");
    expect(deniedBody.error.details.permissionKey).toBe("payroll.statutory.verify");

    // ZERO RESIDUE: the refusal never touched the row.
    const client = await su();
    const row = await client.query(`SELECT status FROM statutory_contribution_profiles WHERE id = $1`, [
      profileId,
    ]);
    await client.end();
    expect(row.rows[0]!.status).toBe("REQUIRES_VERIFICATION");
  });

  it("(b) THE FLIP + THE AUDIT TRAIL: owner verifies against a citation; the row flips exactly once carrying the source", async () => {
    const profileId = await insertProfileRow({ code: "ZZ-FLIP" });
    const response = await post(
      `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
      { sourceName: "The official ZZ schedule", sourceRef: "zz-authority.gov/2026" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Record<string, unknown> };
    expect(body.data.status).toBe("VERIFIED");
    expect(body.data.verifiedBy).toBe(owner.userId);
    expect(body.data.sourceName).toBe("The official ZZ schedule");
    expect(body.data.sourceRef).toBe("zz-authority.gov/2026");

    const client = await su();
    const row = await client.query(
      `SELECT status, verified_by, source_name, source_ref FROM statutory_contribution_profiles WHERE id = $1`,
      [profileId],
    );
    await client.end();
    expect(row.rows[0]).toMatchObject({
      status: "VERIFIED",
      verified_by: owner.userId,
      source_name: "The official ZZ schedule",
    });

    const events = await readAuditEvents("payroll.statutory_verified", profileId);
    expect(events).toHaveLength(1);
    expect(events[0]!.actor_id).toBe(owner.userId);
    expect(events[0]!.after).toMatchObject({ status: "VERIFIED", code: "ZZ-FLIP" });
  });

  it("(c) THE SoD LAW: the row's last editor cannot verify it — the typed 409, zero residue", async () => {
    const profileId = await insertProfileRow({
      code: "ZZ-SOD",
      updatedBy: owner.userId, // the owner is the row's last editor
    });
    const response = await post(
      `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
      { sourceName: "x" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STATUTORY_VERIFY_SOD");

    const client = await su();
    const row = await client.query(`SELECT status, verified_by FROM statutory_contribution_profiles WHERE id = $1`, [
      profileId,
    ]);
    await client.end();
    expect(row.rows[0]!.status).toBe("REQUIRES_VERIFICATION"); // zero residue
    const events = await readAuditEvents("payroll.statutory_verified", profileId);
    expect(events).toHaveLength(0); // no flip, no audit event
  });

  it("(d) THE CAS: a second verify of a VERIFIED row is the typed STATUTORY_ALREADY_VERIFIED 409", async () => {
    const profileId = await insertProfileRow({ code: "ZZ-CAS" });
    const first = await post(
      `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
      { sourceName: "the source" },
      { "x-session-token": owner.token },
    );
    expect(first.status).toBe(200);

    const second = await post(
      `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
      { sourceName: "the source again" },
      { "x-session-token": owner.token },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; details: { verifiedBy: string } } };
    expect(body.error.code).toBe("STATUTORY_ALREADY_VERIFIED");
    expect(body.error.details.verifiedBy).toBe(owner.userId); // the loser names the winner

    // Exactly ONE flip + ONE audit event across the pair.
    const events = await readAuditEvents("payroll.statutory_verified", profileId);
    expect(events).toHaveLength(1);
  });

  it("(e) THE CONCURRENT PAIR: two verifies in flight collapse to exactly one 200 + one typed 409 + one audit event", async () => {
    const profileId = await insertProfileRow({ code: "ZZ-RACE" });
    const [a, b] = await Promise.all([
      post(
        `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
        { sourceName: "concurrent A" },
        { "x-session-token": owner.token },
      ),
      post(
        `/api/v1/payroll/statutory/profiles/${profileId}/verify`,
        { sourceName: "concurrent B" },
        { "x-session-token": owner.token },
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const loserBody = (await loser.json()) as { error: { code: string } };
    expect(loserBody.error.code).toBe("STATUTORY_ALREADY_VERIFIED");

    // The row flipped EXACTLY ONCE (one verifier, one citation — the
    // winner's; the loser's citation never landed).
    const client = await su();
    const row = await client.query(
      `SELECT status, verified_by, source_name, version FROM statutory_contribution_profiles WHERE id = $1`,
      [profileId],
    );
    await client.end();
    expect(row.rows[0]!.status).toBe("VERIFIED");
    expect(row.rows[0]!.verified_by).toBe(owner.userId);
    expect(["concurrent A", "concurrent B"]).toContain(row.rows[0]!.source_name);

    const events = await readAuditEvents("payroll.statutory_verified", profileId);
    expect(events).toHaveLength(1); // exactly one audit event
  });

  it("(f) A7: an unknown profile id is the typed 404 (unknown == foreign)", async () => {
    const response = await post(
      `/api/v1/payroll/statutory/profiles/00000000-0000-4000-8000-00000000dea1/verify`,
      { sourceName: "x" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("STATUTORY_PROFILE_NOT_FOUND");
  });
});

describe("PHASE-046 W-4 T-08 — the remittance export route (payroll.statutory)", () => {
  it("(a) the permission gate + the POSTED-only law + A7", async () => {
    const denied = await get(
      `/api/v1/payroll/runs/${world.postedRunId}/remittance-export`,
      { "x-session-token": viewer.token },
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as {
      error: { code: string; details: { permissionKey: string } };
    };
    expect(deniedBody.error.details.permissionKey).toBe("payroll.statutory");

    const anonymous = await get(`/api/v1/payroll/runs/${world.postedRunId}/remittance-export`);
    expect(anonymous.status).toBe(401);

    // POSTED-only: a DRAFT run carries no frozen liability — the typed
    // IMMUTABLE_DOCUMENT 409 (the remittance settlement's own law).
    const draft = await get(`/api/v1/payroll/runs/${world.draftRunId}/remittance-export`, {
      "x-session-token": owner.token,
    });
    expect(draft.status).toBe(409);
    const draftBody = (await draft.json()) as { error: { code: string } };
    expect(draftBody.error.code).toBe("IMMUTABLE_DOCUMENT");

    // A7: an unknown run id is the typed 404.
    const unknown = await get(
      `/api/v1/payroll/runs/00000000-0000-4000-8000-00000000dea2/remittance-export`,
      { "x-session-token": owner.token },
    );
    expect(unknown.status).toBe(404);
    const unknownBody = (await unknown.json()) as { error: { code: string } };
    expect(unknownBody.error.code).toBe("PAYROLL_RUN_NOT_FOUND");
  });

  it("(b) THE XLSX ROUND-TRIP at locale=ar: RTL view, Arabic headers, tabular 4dp formats, the per-employee breakdown + totals tying the frozen statutory_summary", async () => {
    const response = await get(
      `/api/v1/payroll/runs/${world.postedRunId}/remittance-export?format=xlsx&locale=ar`,
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="statutory-remittance-.+\.xlsx"$/,
    );
    const bytes = Buffer.from(await response.arrayBuffer());

    const ExcelJS = (await import("exceljs")) as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;

    // THE LOCALE LAW: the RTL sheet view at locale=ar (column A on the
    // right) + the Arabic header set + the frozen header row.
    expect(sheet.views?.[0]?.rightToLeft).toBe(true);
    expect(sheet.views?.[0]?.state).toBe("frozen");
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map((cell) => String(cell));
    expect(header).toEqual([...AR_HEADERS]);

    // The tabular-nums law: every money/rate column carries the 4dp
    // tabular format (INV-032's exactness rendered).
    for (let column = 5; column <= 11; column += 1) {
      expect(sheet.getColumn(column).numFmt).toBe("#,##0.0000");
    }

    // The per-employee breakdown rows (the KSA worked example, both arms):
    // Saudi ×3 (PENSION 1,080/1,080 · SANED 90/90 · OH 0/240) + non-Saudi
    // ×1 (OH-only 0/240).
    const dataRows: (string | number)[][] = [];
    let rowNo = 2;
    for (;;) {
      const values = (sheet.getRow(rowNo).values as unknown[]).slice(1);
      const first = values[0] === null || values[0] === undefined ? "" : String(values[0]);
      if (first === "الإجمالي") break;
      dataRows.push(
        values.map((cell) =>
          cell === null || cell === undefined ? "" : (cell as string | number),
        ),
      );
      rowNo += 1;
    }
    expect(dataRows).toHaveLength(4);
    const byKey = new Map(dataRows.map((row) => [`${row[0]}|${row[2]}`, row]));
    const pension = byKey.get(`${world.ksaEmployeeCode}|GOSI-PENSION`)!;
    expect(pension[0]).toBe(world.ksaEmployeeCode);
    expect(pension[3]).toBe("CONTRIBUTION");
    expect(pension[4]).toBe(12000); // the wage base rides the frozen fold (basic + housing)
    expect(pension[5]).toBe(12000);
    expect(pension[6]).toBe(9); // employee rate 9.0000
    expect(pension[7]).toBe(9); // employer rate 9.0000
    expect(pension[8]).toBe(1080);
    expect(pension[9]).toBe(1080);
    expect(pension[10]).toBe(2160);
    const saned = byKey.get(`${world.ksaEmployeeCode}|GOSI-SANED`)!;
    expect(saned[8]).toBe(90);
    expect(saned[9]).toBe(90);
    expect(saned[10]).toBe(180);
    const ksaOh = byKey.get(`${world.ksaEmployeeCode}|GOSI-OH`)!;
    expect(ksaOh[8]).toBe(0);
    expect(ksaOh[9]).toBe(240);
    expect(ksaOh[10]).toBe(240);
    const nsOh = byKey.get(`${world.nsEmployeeCode}|GOSI-OH`)!;
    expect(nsOh[8]).toBe(0);
    expect(nsOh[9]).toBe(240);
    expect(nsOh[10]).toBe(240);
    expect(byKey.has(`${world.nsEmployeeCode}|GOSI-PENSION`)).toBe(false); // OH-only (the applies-to split)

    // The bold totals row: employee 1,170 · employer 1,650 · grand 2,820.
    const totalsRow = sheet.getRow(rowNo);
    const totals = (totalsRow.values as unknown[]).slice(1);
    expect(totals[0]).toBe("الإجمالي");
    expect(totals[8]).toBe(1170);
    expect(totals[9]).toBe(1650);
    expect(totals[10]).toBe(2820);
    expect(totalsRow.font?.bold).toBe(true);

    // The summary block ties the frozen statutory_summary exactly:
    // GOSI-OH 480 · GOSI-PENSION 2,160 · GOSI-SANED 180 (accrued /
    // remitted 0 / outstanding).
    const allRows: unknown[][] = [];
    sheet.eachRow((row, number) => {
      allRows[number] = (row.values as unknown[]).slice(1);
    });
    const summaryHeaderIndex = allRows.findIndex(
      (row) => Array.isArray(row) && row[0] === "البند" && row[2] === "المستحق",
    );
    expect(summaryHeaderIndex).toBeGreaterThan(0);
    const summaryRows = allRows.slice(summaryHeaderIndex + 1, summaryHeaderIndex + 4);
    expect(summaryRows.map((row) => row[0])).toEqual(["GOSI-OH", "GOSI-PENSION", "GOSI-SANED"]);
    expect(summaryRows.map((row) => row[2])).toEqual([480, 2160, 180]);
    expect(summaryRows.map((row) => row[3])).toEqual([0, 0, 0]);
    expect(summaryRows.map((row) => row[4])).toEqual([480, 2160, 180]);
    // The run-totals row: the run's own frozen statutory columns.
    const runTotals = allRows[summaryHeaderIndex + 4]!;
    expect(runTotals[0]).toBe("إجماليات المسير");
    expect(runTotals[2]).toBe(1170);
    expect(runTotals[3]).toBe(1650);
    expect(runTotals[4]).toBe(0); // PIT — the honest no-bracket zero

    // The footer: the honest not-configured establishment note (the
    // readiness surface, IN-06 — the setting is unset for this tenant).
    const flat = allRows.map((row) => (Array.isArray(row) ? row.join("|") : ""));
    expect(flat.some((line) => line.includes("غير مضبوط"))).toBe(true);
    expect(flat.some((line) => line.includes("لا يوجد تكامل حكومي مباشر"))).toBe(true);
  });

  it("(c) THE CSV ROUND-TRIP at locale=en: BOM, RFC-4180, the frozen exact 4dp strings, LTR view law + EN_HEADERS through the XLSX arm", async () => {
    const response = await get(
      `/api/v1/payroll/runs/${world.postedRunId}/remittance-export?format=csv&locale=en`,
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const body = Buffer.from(await response.arrayBuffer());

    // UTF-8 BOM first (Excel Arabic — PRINTING_AND_EXPORT §5).
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = body.toString("utf8").replace(/^\uFEFF/, "");
    expect(text).toContain("\r\n");
    const lines = text.split("\r\n");
    expect(lines[0]!.split(",")).toEqual([...EN_HEADERS]);

    // The frozen exact 4dp strings ride the CSV verbatim (round-trip
    // safe — never a re-formatted number).
    expect(text).toContain(`${world.ksaEmployeeCode},Route Saudi Employee,GOSI-PENSION,CONTRIBUTION,12000.0000,12000.0000,9.0000,9.0000,1080.0000,1080.0000,2160.0000`);
    expect(text).toContain(`${world.nsEmployeeCode},Route Non-Saudi Employee,GOSI-OH,CONTRIBUTION,12000.0000,12000.0000,0.0000,2.0000,0.0000,240.0000,240.0000`);

    // The totals row + the summary block tying the frozen summary.
    expect(lines.some((line) => line.startsWith("Total,") && line.endsWith(",1170.0000,1650.0000,2820.0000"))).toBe(true);
    expect(text).toContain("GOSI-OH,CONTRIBUTION,480.0000,0.0000,480.0000");
    expect(text).toContain("GOSI-PENSION,CONTRIBUTION,2160.0000,0.0000,2160.0000");
    expect(text).toContain("GOSI-SANED,CONTRIBUTION,180.0000,0.0000,180.0000");
    expect(text).toContain("Run totals,,1170.0000,1650.0000,0.0000");

    // The locale law through the XLSX arm: locale=en renders LTR with the
    // English header set.
    const xlsxResponse = await get(
      `/api/v1/payroll/runs/${world.postedRunId}/remittance-export?format=xlsx&locale=en`,
      { "x-session-token": owner.token },
    );
    expect(xlsxResponse.status).toBe(200);
    const ExcelJS = (await import("exceljs")) as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await xlsxResponse.arrayBuffer()) as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.views?.[0]?.rightToLeft).toBe(false);
    const header = (sheet.getRow(1).values as unknown[]).slice(1).map((cell) => String(cell));
    expect(header).toEqual([...EN_HEADERS]);
  });

  it("(d) THE READINESS ARM: the configured establishment number rides the file (the settings surface, IN-06)", async () => {
    const client = await su();
    await client.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
         (gen_random_uuid(), $1, 'payroll.statutory.gosi_establishment_no', $2::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_REMIT, JSON.stringify("70012345")],
    );
    await client.end();

    const response = await get(
      `/api/v1/payroll/runs/${world.postedRunId}/remittance-export?format=csv&locale=en`,
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    const text = Buffer.from(await response.arrayBuffer()).toString("utf8");
    expect(text).toContain("Establishment No.,70012345");
  });

  it("(e) THE AUDIT + THE NEGATIVE LEDGER PROOF: every generation audited; the run row + the journal registers byte-identical through the exports (BR-086)", async () => {
    // The audit trail: one payroll.remittance_exported per generation —
    // this spec made four before this arm (b, c ×2, d), each carrying the
    // shape it stated.
    const events = await readAuditEvents("payroll.remittance_exported", world.postedRunId);
    expect(events.length).toBe(4);
    expect(events.every((event) => event.actor_id === owner.userId)).toBe(true);
    expect(
      events.some((event) => {
        const after = event.after as {
          format: string;
          rowCount: number;
          employeeCount: number;
          totals: { grandTotal: string };
        };
        return (
          after.rowCount === 4 &&
          after.employeeCount === 2 &&
          after.totals.grandTotal === "2820.0000"
        );
      }),
    ).toBe(true);

    // THE NEGATIVE LEDGER PROOF (BR-086): the export is read-only — the
    // run row and the journal registers stay byte-identical through every
    // export of this spec (compared against the beforeAll baseline).
    const client = await su();
    const runAfter = await client.query(
      `SELECT status, version, gross_total, deductions_total, net_total,
              statutory_employee_total, statutory_employer_total, pit_total, statutory_summary
         FROM payroll_runs WHERE id = $1`,
      [world.postedRunId],
    );
    const journalsAfter = await client.query<{ entries: number; lines: number }>(
      `SELECT (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::int AS entries,
              (SELECT count(*) FROM journal_lines WHERE tenant_id = $1)::int AS lines`,
      [TENANT_REMIT],
    );
    await client.end();
    expect(runAfter.rows[0]!).toEqual(world.runRowBefore); // byte-identical
    expect(journalsAfter.rows[0]!).toEqual(world.journalCountsBefore); // 1 entry · 4 lines
  });
});

// -- PHASE-046 (W-5, D-16): the compliance lists + the EOSB views + the
// true-up trigger ----------------------------------------------------------
// The web plane's read surface + the one posting act, at the HTTP layer:
// the three management lists (any status, any effective window — the
// screen's badges ride the rows' own status/citation fields), the EOSB
// calculations register + the BR-087 reconciliation view, and the G-54
// true-up trigger riding the LEDGER key (payroll.runs.post — never the
// payroll.eosb management key, matrix §3.24's guarded-routes law).

interface ManagerSeed {
  email: string;
  userId: string;
  token: string;
}

describe("PHASE-046 W-5 T-10/T-11 — the compliance lists + the EOSB views + the true-up trigger", () => {
  it("(a) THE THREE MANAGEMENT LISTS: the gates (anonymous 401, viewer 403 naming payroll.statutory) + the canonical rows + the jurisdiction narrowing + the honest no-PIT state", async () => {
    // The gates — all three lists, the same management key.
    for (const path of [
      "/api/v1/payroll/statutory/profiles",
      "/api/v1/payroll/statutory/brackets",
      "/api/v1/payroll/statutory/eosb-rules",
    ]) {
      const anonymous = await get(path);
      expect(anonymous.status).toBe(401);
      const denied = await get(path, { "x-session-token": viewer.token });
      expect(denied.status).toBe(403);
      const deniedBody = (await denied.json()) as {
        error: { details: { permissionKey: string } };
      };
      expect(deniedBody.error.details.permissionKey).toBe("payroll.statutory");
    }

    // The owner's profiles list: the canonical KSA rows carry the owner's
    // corrected schedule VERIFIED (the GOSI codes with the exact rates);
    // the blocked jurisdictions' rows carry their REQUIRES_VERIFICATION
    // badges (the BR-085 surface the screen renders).
    const profilesResponse = await get("/api/v1/payroll/statutory/profiles", {
      "x-session-token": owner.token,
    });
    expect(profilesResponse.status).toBe(200);
    const profiles = (
      (await profilesResponse.json()) as { data: { jurisdictionCode: string; code: string; employeeRate: string; employerRate: string; status: string }[] }
    ).data;
    const pension = profiles.find((row) => row.jurisdictionCode === "SA" && row.code === "GOSI-PENSION");
    const saned = profiles.find((row) => row.jurisdictionCode === "SA" && row.code === "GOSI-SANED");
    const oh = profiles.find((row) => row.jurisdictionCode === "SA" && row.code === "GOSI-OH");
    expect(pension).toMatchObject({ employeeRate: "9.0000", employerRate: "9.0000", status: "VERIFIED" });
    expect(saned).toMatchObject({ employeeRate: "0.7500", employerRate: "0.7500", status: "VERIFIED" });
    expect(oh).toMatchObject({ employeeRate: "0.0000", employerRate: "2.0000", status: "VERIFIED" });
    expect(
      profiles.some(
        (row) => row.jurisdictionCode !== "SA" && row.status === "REQUIRES_VERIFICATION",
      ),
    ).toBe(true);

    // The jurisdiction narrowing: SA returns ONLY SA rows.
    const saResponse = await get("/api/v1/payroll/statutory/profiles?jurisdiction=SA", {
      "x-session-token": owner.token,
    });
    expect(saResponse.status).toBe(200);
    const saProfiles = (
      (await saResponse.json()) as { data: { jurisdictionCode: string }[] }
    ).data;
    expect(saProfiles.length).toBeGreaterThan(0);
    expect(saProfiles.every((row) => row.jurisdictionCode === "SA")).toBe(true);

    // The brackets list: the honest no-PIT state for SA (no KSA bracket
    // rows exist — the 0092 law), the blocked jurisdictions' bracket sets
    // present with their REQUIRES_VERIFICATION badges.
    const bracketsResponse = await get("/api/v1/payroll/statutory/brackets", {
      "x-session-token": owner.token,
    });
    expect(bracketsResponse.status).toBe(200);
    const brackets = (
      (await bracketsResponse.json()) as { data: { jurisdictionCode: string; status: string }[] }
    ).data;
    expect(brackets.some((row) => row.jurisdictionCode === "SA")).toBe(false); // no-PIT
    expect(
      brackets.some((row) => row.status === "REQUIRES_VERIFICATION"),
    ).toBe(true);

    // The EOSB tiers list: the SA ladder (15 days < 5y, 30 days after)
    // VERIFIED.
    const rulesResponse = await get("/api/v1/payroll/statutory/eosb-rules", {
      "x-session-token": owner.token,
    });
    expect(rulesResponse.status).toBe(200);
    const rules = (
      (await rulesResponse.json()) as { data: { jurisdictionCode: string; fromYears: string; daysPerYear: string; status: string }[] }
    ).data;
    const firstTier = rules.find((row) => row.jurisdictionCode === "SA" && row.fromYears === "0.00");
    const secondTier = rules.find((row) => row.jurisdictionCode === "SA" && row.fromYears === "5.00");
    expect(firstTier).toMatchObject({ daysPerYear: "15.00", status: "VERIFIED" });
    expect(secondTier).toMatchObject({ daysPerYear: "30.00", status: "VERIFIED" });
  });

  it("(b) THE EOSB VIEWS: the gates (viewer 403 naming payroll.eosb) + the honest empty register before any true-up", async () => {
    for (const path of [
      "/api/v1/payroll/eosb/calculations",
      "/api/v1/payroll/eosb/reconciliation",
    ]) {
      const anonymous = await get(path);
      expect(anonymous.status).toBe(401);
      const denied = await get(path, { "x-session-token": viewer.token });
      expect(denied.status).toBe(403);
      const deniedBody = (await denied.json()) as {
        error: { details: { permissionKey: string } };
      };
      expect(deniedBody.error.details.permissionKey).toBe("payroll.eosb");
    }

    const calculations = await get("/api/v1/payroll/eosb/calculations", {
      "x-session-token": owner.token,
    });
    expect(calculations.status).toBe(200);
    expect(((await calculations.json()) as { data: unknown[] }).data).toEqual([]);

    const reconciliation = await get("/api/v1/payroll/eosb/reconciliation", {
      "x-session-token": owner.token,
    });
    expect(reconciliation.status).toBe(200);
    expect(((await reconciliation.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it("(c) THE TRUE-UP KEY LAW: the management key does NOT carry the posting act — a statutory manager (both management keys, no ledger key) reads the views but takes the 403 naming payroll.runs.post", async () => {
    // Seed a management-only user: both §3.24 management keys, NEVER
    // payroll.runs.post (the ledger act rides the ledger key — the
    // G-50/G-51 law).
    const manager: ManagerSeed = {
      email: `remit-manager-${generateUuidV7().slice(0, 8)}@fixture.test`,
      userId: "",
      token: "",
    };
    const client = await su();
    const passwordService = new PasswordService();
    const hash = await passwordService.hashFromNewPassword(SPEC_PASSWORD);
    const user = await identityStore.insertUser({
      email: manager.email,
      fullName: "Remit statutory manager",
      passwordHash: hash,
      status: "ACTIVE",
    });
    manager.userId = user.id;
    const roleId = generateUuidV7();
    await client.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, 'statutory_manager_remit', 'statutory manager', 'مدير قانوني')`,
      [roleId, TENANT_REMIT],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, p."key" FROM permissions p WHERE p."key" IN ('payroll.statutory', 'payroll.eosb')`,
      [roleId, TENANT_REMIT],
    );
    await client.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), TENANT_REMIT, user.id, roleId],
    );
    await client.end();
    const login = await post("/api/v1/identity/sessions", {
      email: manager.email,
      password: SPEC_PASSWORD,
    });
    expect(login.status).toBe(200);
    manager.token = ((await login.json()) as { data: { token: string } }).data.token;

    // The same user reads the EOSB views…
    const views = await get("/api/v1/payroll/eosb/reconciliation", {
      "x-session-token": manager.token,
    });
    expect(views.status).toBe(200);

    // …but the true-up trigger is the typed 403 naming the LEDGER key —
    // the management key must not carry a posting act.
    const ksa = await withTenant(TENANT_REMIT, async () => {
      const list = await employees.list({ limit: 100 });
      return list.find((row) => row.code === world.ksaEmployeeCode)!;
    });
    const denied = await post(
      "/api/v1/payroll/eosb/true-up",
      { employeeId: ksa.id, kind: "OPENING", onDate: "2026-11-17" },
      { "x-session-token": manager.token },
    );
    expect(denied.status).toBe(403);
    const deniedBody = (await denied.json()) as {
      error: { details: { permissionKey: string } };
    };
    expect(deniedBody.error.details.permissionKey).toBe("payroll.runs.post");

    // Zero residue: no calculation row, no journal, no audit event.
    const check = await su();
    const calcCount = await check.query(
      `SELECT count(*)::int AS n FROM eosb_calculations WHERE tenant_id = $1`,
      [TENANT_REMIT],
    );
    expect(calcCount.rows[0]!.n).toBe(0);
    await check.end();
  });

  it("(d) THE TRUE-UP ACT: the owner's OPENING true-up through real HTTP — the G-54 delta journal + the audit trail + both views reflect it", async () => {
    const ksa = await withTenant(TENANT_REMIT, async () => {
      const list = await employees.list({ limit: 100 });
      return list.find((row) => row.code === world.ksaEmployeeCode)!;
    });

    const response = await post(
      "/api/v1/payroll/eosb/true-up",
      { employeeId: ksa.id, kind: "OPENING", onDate: "2026-11-17", note: "W-5 route spec opening" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        calculation: {
          employeeId: string;
          kind: string;
          entitlementAmount: string;
          provisionBalance: string;
          delta: string;
          journalEntryId: string | null;
          status: string;
        };
        journalEntryId: string | null;
        delta: string;
      };
    };
    // The provision stood at 0 (EOS off in this world) — the opening
    // true-up accrues the full entitlement: the delta is the positive
    // entitlement, and the G-54 journal posts (delta ≠ 0).
    expect(body.data.calculation.provisionBalance).toBe("0.0000");
    expect(body.data.delta).toBe(body.data.calculation.entitlementAmount);
    expect(Number(body.data.delta)).toBeGreaterThan(0);
    expect(body.data.journalEntryId).not.toBeNull();
    expect(body.data.calculation.status).toBe("POSTED");

    // THE AUDIT TRAIL: the act is audited with the actor.
    const events = await readAuditEvents("payroll.eosb_true_up");
    expect(events.length).toBe(1);
    expect(events[0]!.actor_id).toBe(owner.userId);

    // The G-54 journal: one new entry, the DR/CR pair (EOS_PROVISION_EXPENSE
    // / EOS_PROVISION) — the register moved from 1 entry · 4 lines to
    // 2 · 6.
    const client = await su();
    const journals = await client.query<{ entries: number; lines: number }>(
      `SELECT (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::int AS entries,
              (SELECT count(*) FROM journal_lines WHERE tenant_id = $1)::int AS lines`,
      [TENANT_REMIT],
    );
    await client.end();
    expect(journals.rows[0]!).toEqual({ entries: 2, lines: 6 });

    // Both views reflect the act: the register lists the row; the
    // reconciliation row ties (the aligned delta is exactly 0 — the
    // opening true-up aligned the provision to the entitlement).
    const calculations = await get("/api/v1/payroll/eosb/calculations", {
      "x-session-token": owner.token,
    });
    const register = (
      (await calculations.json()) as { data: { employeeId: string; kind: string }[] }
    ).data;
    expect(register.some((row) => row.employeeId === ksa.id && row.kind === "OPENING")).toBe(true);

    const reconciliation = await get(
      `/api/v1/payroll/eosb/reconciliation?employeeId=${ksa.id}`,
      { "x-session-token": owner.token },
    );
    expect(reconciliation.status).toBe(200);
    const rows = (
      (await reconciliation.json()) as { data: { employeeId: string; alignedDelta: string }[] }
    ).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.alignedDelta).toBe("0.0000");
  });

  it("(e) THE INVALID SHAPE: a TERMINATION true-up on an ACTIVE employee is the typed EOSB_TRUE_UP_INVALID 422, zero residue", async () => {
    const ksa = await withTenant(TENANT_REMIT, async () => {
      const list = await employees.list({ limit: 100 });
      return list.find((row) => row.code === world.ksaEmployeeCode)!;
    });

    const anonymous = await post("/api/v1/payroll/eosb/true-up", {
      employeeId: ksa.id,
      kind: "PERIOD_TRUE_UP",
      onDate: "2026-11-17",
    });
    expect(anonymous.status).toBe(401);

    const refused = await post(
      "/api/v1/payroll/eosb/true-up",
      { employeeId: ksa.id, kind: "TERMINATION", onDate: "2026-11-17" },
      { "x-session-token": owner.token },
    );
    expect(refused.status).toBe(422);
    const refusedBody = (await refused.json()) as { error: { code: string } };
    expect(refusedBody.error.code).toBe("EOSB_TRUE_UP_INVALID");

    // Zero residue: still exactly ONE calculation (the (d) opening), one
    // true-up audit event, 2 entries · 6 lines.
    const client = await su();
    const counts = await client.query<{ calcs: number; journals: number }>(
      `SELECT (SELECT count(*) FROM eosb_calculations WHERE tenant_id = $1)::int AS calcs,
              (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::int AS journals`,
      [TENANT_REMIT],
    );
    await client.end();
    expect(counts.rows[0]!.calcs).toBe(1);
    expect(counts.rows[0]!.journals).toBe(2);
    expect((await readAuditEvents("payroll.eosb_true_up")).length).toBe(1);
  });
});
