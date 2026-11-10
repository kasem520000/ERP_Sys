import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { stopBoss } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { AppModule } from "../../app.module";
import { PasswordService } from "../../modules/identity/application/password-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { GlQueries } from "../../modules/accounting/application/gl-queries";
import { addExact } from "../../modules/accounting/application/decimal-strings";
import * as store from "../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import { S_ACTOR, S_JAN, S_SALES, TENANT_S, salesInvoices, setupSalesFixture } from "../sales/fixtures";

/**
 * PHASE-019 T44 db evidence (§8): the projects dimension end to end —
 * (a) the controller trio (cost-centers mirror) over the REAL HTTP pipeline
 *     incl. the typed duplicate-code 409 + the A7 404 parity on PATCH and
 *     the audited OPEN↔CLOSED cycle (project_updated + project_reopened);
 * (b) manual-journal projectId wiring — the draft substrate
 *     (manual_journal_lines.project_id) AND the posted lines
 *     (journal_lines.project_id) both persist the stamp;
 * (c) fail-closed stamps at post — PROJECT_CLOSED / PROJECT_NOT_FOUND,
 *     zero posting residue;
 * (d) project-filtered GL totals equal the unfiltered slice sums (balances +
 *     movements + register + the threaded HTTP query param);
 * (e) a sales invoice with header projectId stamps EVERY line of BOTH the
 *     settlement journal and the COGS journal (the sales fixture substrate
 *     reused for the tenant bootstrap, the established cross-suite pattern).
 *
 * Dedicated tenant P44; the sales case rides TENANT_S via setupSalesFixture
 * (idempotent, drawn from like every other sales-fixture consumer).
 */

const TENANT_P44 = "63636363-6363-6363-6363-636363636363";
const ACTOR_P44 = "63636363-0000-4000-8000-0000000006e1";
const PASSWORD = "projects-t44-strong-passphrase-4";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const journals = new JournalService(audit, posting);
const periods = new PeriodService(audit);
const gl = new GlQueries();

let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let token = "";

let case01Id = ""; // OPEN — the J1/stamping host
let case02Id = ""; // OPEN after the audited CLOSE→OPEN cycle — the J2 host
let case03Id = ""; // the closed-rejection subject
let salesProjectId = ""; // the TENANT_S invoice-stamping case
let j1EntryNo = "";
const accounts: { cash: string; revenue: string; rent: string } = { cash: "", revenue: "", rent: "" };

interface ApiReply {
  status: number;
  body: { data?: unknown; error?: { code: string; message: string } };
}

async function call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<ApiReply> {
  const hasBody = body !== undefined && method !== "GET";
  const headers: Record<string, string> = { "x-session-token": token };
  if (hasBody) headers["content-type"] = "application/json";
  if (method === "POST") headers["idempotency-key"] = generateUuidV7();
  const response = await fetch(`${httpBase}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : (JSON.parse(text) as ApiReply["body"]) };
}

async function login(email: string, password: string): Promise<string> {
  const response = await fetch(`${httpBase}/api/v1/identity/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(response.status).toBe(200);
  const parsed = (await response.json()) as { data: { token: string } };
  return parsed.data.token;
}

interface AuditEventRow {
  action: string;
  entity_id: string;
  after: { status?: string; name?: string } | null;
}

async function projectAuditEvents(): Promise<AuditEventRow[]> {
  const su = await superuserClient();
  const result = await su.query(
    `SELECT action, entity_id, after FROM audit_events
      WHERE tenant_id = $1 AND action LIKE 'accounting.project_%' ORDER BY at`,
    [TENANT_P44],
  );
  await su.end();
  return result.rows as AuditEventRow[];
}

async function journalEntryCount(): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1`,
    [TENANT_P44],
  );
  await su.end();
  return result.rows[0]!.n;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant P44 (projects)', 'المستأجر ب٤٤', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_P44],
  );
  const passwords = new PasswordService();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'projects-owner@fixture.test', 'Projects Owner', $2, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR_P44, await passwords.hashFromNewPassword(PASSWORD)],
  );
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك')`,
    [roleId, TENANT_P44],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
    [roleId, TENANT_P44, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_P44, ACTOR_P44, roleId],
  );
  await su.end();

  // The accounting substrate for P44 (the setupAccountingFixture shape):
  // template CoA + master data + FY2026 spanning the whole test timeline.
  await withTenant(TENANT_P44, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();
    if ((await store.findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR_P44, {
        name: "FY2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
    }
    accounts.cash = (await store.findAccountByCode("1111"))!.id; // Cash — main
    accounts.revenue = (await store.findAccountByCode("4100"))!.id; // Sales revenue
    accounts.rent = (await store.findAccountByCode("5210"))!.id; // Rent (expense leaf)
  });

  // (e)'s substrate: the sales fixture tenant + one project row in it.
  await setupSalesFixture();
  await withTenant(TENANT_S, async () => {
    const created = await store.insertProject({
      code: "INV-01",
      name: "Stamped invoice case",
      nameAr: null,
      parentId: null,
    });
    salesProjectId = created.id;
  });

  // The real pipeline: full AppModule + HTTP listener on a free port.
  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
  token = await login("projects-owner@fixture.test", PASSWORD);
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("T44 (a) — the projects trio over the real HTTP pipeline", () => {
  it("POST creates (bilingual + parent link + OPEN default), GET lists ordered by code, the code shape is enforced at the edge", async () => {
    const first = await call("POST", "/api/v1/accounting/projects", {
      code: "CASE-01",
      name: "Consulting case 1",
      nameAr: "القضية ١",
    });
    expect(first.status).toBe(200);
    const firstData = first.body.data as {
      id: string;
      code: string;
      nameAr: string | null;
      parentId: string | null;
      status: string;
    };
    expect(firstData.code).toBe("CASE-01");
    expect(firstData.nameAr).toBe("القضية ١");
    expect(firstData.parentId).toBeNull();
    expect(firstData.status).toBe("OPEN");
    case01Id = firstData.id;

    const second = await call("POST", "/api/v1/accounting/projects", {
      code: "CASE-02",
      name: "Consulting case 2",
    });
    expect(second.status).toBe(200);
    case02Id = (second.body.data as { id: string }).id;

    // The parent link (composite FK; the child references the parent row).
    const child = await call("POST", "/api/v1/accounting/projects", {
      code: "CASE-01-A",
      name: "Sub case",
      parentId: case01Id,
    });
    expect(child.status).toBe(200);
    expect((child.body.data as { parentId: string | null }).parentId).toBe(case01Id);

    // The DB CHECK's shape (^[A-Za-z0-9_-]{1,20}$) is a zod edge too.
    const badShape = await call("POST", "/api/v1/accounting/projects", {
      code: "CASE 01!",
      name: "Bad shape",
    });
    expect(badShape.status).toBe(422);
    expect(badShape.body.error?.code).toBe("VALIDATION_ERROR");

    const listed = await call("GET", "/api/v1/accounting/projects");
    expect(listed.status).toBe(200);
    const rows = listed.body.data as { code: string; parentId: string | null; status: string }[];
    expect(rows.map((row) => row.code)).toEqual(["CASE-01", "CASE-01-A", "CASE-02"]);
    expect(rows.find((row) => row.code === "CASE-01-A")?.parentId).toBe(case01Id);
  });

  it("duplicate code → typed 409 PROJECT_CODE_TAKEN; unknown vs foreign PATCH ids → identical 404 PROJECT_NOT_FOUND (A7 parity)", async () => {
    const duplicate = await call("POST", "/api/v1/accounting/projects", {
      code: "CASE-01",
      name: "Duplicate case",
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe("PROJECT_CODE_TAKEN");

    const unknownId = "11111111-2222-4333-8444-555555555555";
    const unknown = await call("PATCH", `/api/v1/accounting/projects/${unknownId}`, {
      name: "No such project",
    });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error?.code).toBe("PROJECT_NOT_FOUND");

    // A7 404-parity: a REAL id that exists — but in another tenant — renders
    // the identical shape (RLS confines the read; no existence disclosure).
    const foreign = await call("PATCH", `/api/v1/accounting/projects/${salesProjectId}`, {
      name: "Foreign project probe",
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("PROJECT_NOT_FOUND");
    expect(foreign.body.error?.code).toBe(unknown.body.error?.code);
  });

  it("PATCH lifecycle: rename + OPEN→CLOSED + CLOSED→OPEN, all audited (project_updated + the reopen event)", async () => {
    const renamed = await call("PATCH", `/api/v1/accounting/projects/${case02Id}`, {
      name: "Renamed case",
    });
    expect(renamed.status).toBe(200);
    const renamedData = renamed.body.data as { name: string; status: string };
    expect(renamedData.name).toBe("Renamed case");
    expect(renamedData.status).toBe("OPEN");

    const closed = await call("PATCH", `/api/v1/accounting/projects/${case02Id}`, {
      status: "CLOSED",
    });
    expect(closed.status).toBe(200);
    expect((closed.body.data as { status: string }).status).toBe("CLOSED");

    // Reopening is allowed (flip-only lifecycle; no DELETE anywhere).
    const reopened = await call("PATCH", `/api/v1/accounting/projects/${case02Id}`, {
      status: "OPEN",
    });
    expect(reopened.status).toBe(200);
    expect((reopened.body.data as { status: string }).status).toBe("OPEN");

    const events = await projectAuditEvents();
    const created = events.filter((event) => event.action === "accounting.project_created");
    expect(created.length).toBeGreaterThanOrEqual(3); // CASE-01, CASE-02, CASE-01-A
    const updates = events.filter(
      (event) => event.action === "accounting.project_updated" && event.entity_id === case02Id,
    );
    expect(updates.length).toBe(3); // rename, close, reopen
    expect(updates.filter((event) => event.after?.status === "CLOSED").length).toBe(1);
    const reopenedEvents = events.filter((event) => event.action === "accounting.project_reopened");
    expect(reopenedEvents.length).toBe(1);
    expect(reopenedEvents[0]!.entity_id).toBe(case02Id);
    expect(reopenedEvents[0]!.after?.status).toBe("OPEN");
  });
});

describe("T44 (b) — manual-journal projectId persists on the draft substrate AND the posted lines", () => {
  it("create → submit → post carries the stamp through both layers", async () => {
    const draft = await withTenant(TENANT_P44, () =>
      journals.create(ACTOR_P44, {
        entryDate: "2026-03-05",
        description: "project-stamped manual journal",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "300.0000", projectId: case01Id },
          { accountId: accounts.revenue, direction: "CREDIT", amount: "300.0000", projectId: case01Id },
        ],
      }),
    );
    // The draft substrate: manual_journal_lines.project_id (T42's column).
    const draftLines = await withTenant(TENANT_P44, () =>
      journal.listManualJournalLines(draft.id),
    );
    expect(draftLines.length).toBe(2);
    for (const line of draftLines) {
      expect(line.projectId).toBe(case01Id);
    }

    // Policy "none" (fresh tenant) → submit auto-approves → post.
    const posted = await withTenant(TENANT_P44, async () => {
      await journals.submit(ACTOR_P44, draft.id);
      return journals.post(ACTOR_P44, draft.id);
    });
    expect(posted.result.entryNo).toMatch(/^JE-2026-\d{6}$/);
    j1EntryNo = posted.result.entryNo!;

    // The posted lines: journal_lines.project_id.
    const lines = await withTenant(TENANT_P44, () =>
      journal.listLines(posted.result.journalEntryId!),
    );
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.projectId).toBe(case01Id);
    }
  });
});

describe("T44 (c) — stamps fail closed at post: typed errors, zero residue", () => {
  it("CLOSED project → PROJECT_CLOSED; unknown id → PROJECT_NOT_FOUND; no journal rows appear", async () => {
    // case03: created, then closed (the store path — the (a) trio already
    // proved the HTTP surface; this is the engine's substrate).
    await withTenant(TENANT_P44, async () => {
      const created = await store.insertProject({
        code: "CASE-03",
        name: "Closing case",
        nameAr: null,
        parentId: null,
      });
      case03Id = created.id;
      await store.updateProject(case03Id, { status: "CLOSED" });
    });

    const before = await journalEntryCount();

    const closedDraft = await withTenant(TENANT_P44, () =>
      journals.create(ACTOR_P44, {
        entryDate: "2026-03-20",
        description: "must fail closed",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "10.0000", projectId: case03Id },
          { accountId: accounts.revenue, direction: "CREDIT", amount: "10.0000", projectId: case03Id },
        ],
      }),
    );
    await withTenant(TENANT_P44, () => journals.submit(ACTOR_P44, closedDraft.id));
    await expect(
      withTenant(TENANT_P44, () => journals.post(ACTOR_P44, closedDraft.id)),
    ).rejects.toMatchObject({ code: "PROJECT_CLOSED" });
    // Zero residue: no entry for the source key.
    expect(
      await withTenant(TENANT_P44, () =>
        journal.findEntryBySourceKey("journal_entry", closedDraft.id, "post"),
      ),
    ).toBeUndefined();

    // The unknown-id case: the DRAFT substrate cannot even carry it
    // (manual_journal_lines.project_id is composite-FK'd to projects — the
    // DB-level backstop rejects the insert), so the engine's typed
    // PROJECT_NOT_FOUND is exercised the way the engine goldens do: a
    // direct spec post (the fixtures' manualSpec pattern).
    const unknownDocId = generateUuidV7();
    await expect(
      withTenant(TENANT_P44, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId: unknownDocId, operation: "post" },
            entryDate: "2026-03-21",
            description: { en: "unknown-project stamp" },
            currency: "SAR",
            lines: [
              {
                accountId: accounts.cash,
                direction: "DEBIT",
                amount: "10.0000",
                projectId: "12345678-1234-4123-8123-123456789012",
              },
              {
                accountId: accounts.revenue,
                direction: "CREDIT",
                amount: "10.0000",
                projectId: "12345678-1234-4123-8123-123456789012",
              },
            ],
          },
          { postedBy: ACTOR_P44 },
        ),
      ),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(
      await withTenant(TENANT_P44, () =>
        journal.findEntryBySourceKey("journal_entry", unknownDocId, "post"),
      ),
    ).toBeUndefined();

    expect(await journalEntryCount()).toBe(before); // nothing landed
  });
});

describe("T44 (d) — project-filtered GL totals equal the unfiltered slice sums", () => {
  it("2 journals (different projects) + 1 unstamped: every feed slices exactly", async () => {
    // J2 on CASE-02 (still OPEN after the (a) cycle) + J3 with no stamp.
    await withTenant(TENANT_P44, async () => {
      const j2 = await journals.create(ACTOR_P44, {
        entryDate: "2026-03-10",
        description: "case-02 journal",
        lines: [
          { accountId: accounts.rent, direction: "DEBIT", amount: "120.0000", projectId: case02Id },
          { accountId: accounts.cash, direction: "CREDIT", amount: "120.0000", projectId: case02Id },
        ],
      });
      await journals.submit(ACTOR_P44, j2.id);
      await journals.post(ACTOR_P44, j2.id);

      const j3 = await journals.create(ACTOR_P44, {
        entryDate: "2026-03-15",
        description: "unstamped journal",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "50.0000" },
          { accountId: accounts.revenue, direction: "CREDIT", amount: "50.0000" },
        ],
      });
      await journals.submit(ACTOR_P44, j3.id);
      await journals.post(ACTOR_P44, j3.id);
    });

    const unfiltered = await withTenant(TENANT_P44, () => gl.accountBalances());
    const byId = new Map(unfiltered.map((row) => [row.accountId, row]));
    // (The debit/credit "0" vs "0.0000" formatting follows trialBalances'
    // CASE ELSE 0 — an integer sum when no row of the account took the
    // base_amount branch on that side; the amounts themselves are exact.)
    expect(byId.get(accounts.cash)).toMatchObject({
      debit: "350.0000",
      credit: "120.0000",
      balance: "230.0000",
    });
    expect(byId.get(accounts.revenue)).toMatchObject({
      debit: "0",
      credit: "350.0000",
      balance: "-350.0000",
    });
    expect(byId.get(accounts.rent)).toMatchObject({
      debit: "120.0000",
      credit: "0",
      balance: "120.0000",
    });

    const slice01 = await withTenant(TENANT_P44, () => gl.accountBalances({ projectId: case01Id }));
    expect(slice01.map((row) => row.code)).toEqual(["1111", "4100"]); // no rent row
    const s01 = new Map(slice01.map((row) => [row.accountId, row]));
    expect(s01.get(accounts.cash)).toMatchObject({
      debit: "300.0000",
      credit: "0",
      balance: "300.0000",
    });
    expect(s01.get(accounts.revenue)).toMatchObject({
      debit: "0",
      credit: "300.0000",
      balance: "-300.0000",
    });

    const slice02 = await withTenant(TENANT_P44, () => gl.accountBalances({ projectId: case02Id }));
    expect(slice02.map((row) => row.code)).toEqual(["1111", "5210"]); // no revenue row
    const s02 = new Map(slice02.map((row) => [row.accountId, row]));
    expect(s02.get(accounts.cash)).toMatchObject({
      debit: "0",
      credit: "120.0000",
      balance: "-120.0000",
    });
    expect(s02.get(accounts.rent)).toMatchObject({
      debit: "120.0000",
      credit: "0",
      balance: "120.0000",
    });

    // The identity, per account and side: unfiltered = slice01 + slice02 +
    // J3's own unstamped lines (cash DR 50, revenue CR 50).
    const un = byId;
    const a = s01.get(accounts.cash)!;
    const b = s02.get(accounts.cash)!;
    expect(addExact(addExact(a.debit, b.debit), "50.0000")).toBe(un.get(accounts.cash)!.debit);
    expect(addExact(addExact(a.credit, b.credit), "0.0000")).toBe(un.get(accounts.cash)!.credit);
    const ra = s01.get(accounts.revenue)!;
    const rb = s02.get(accounts.revenue) ?? { debit: "0.0000", credit: "0.0000" };
    expect(addExact(addExact(ra.credit, rb.credit), "50.0000")).toBe(
      un.get(accounts.revenue)!.credit,
    );
    const ea = s01.get(accounts.rent) ?? { debit: "0.0000" };
    const eb = s02.get(accounts.rent)!;
    expect(addExact(addExact(ea.debit, eb.debit), "0.0000")).toBe(un.get(accounts.rent)!.debit);

    // Movements feed: one movement, project column present, slice balance.
    const movements = await withTenant(TENANT_P44, () =>
      gl.accountMovements({ accountId: accounts.cash, projectId: case01Id, limit: 100 }),
    );
    expect(movements.movements.length).toBe(1);
    expect(movements.movements[0]!.projectId).toBe(case01Id);
    expect(movements.movements[0]!.amount).toBe("300.0000");
    expect(movements.movements[0]!.balanceAfter).toBe("300.0000");

    // Register: the project slice keeps only entries carrying its lines,
    // with totals summed over those lines alone.
    const register = await withTenant(TENANT_P44, () =>
      gl.journalRegister({ projectId: case01Id, limit: 100 }),
    );
    expect(register.length).toBe(1);
    expect(register[0]!.entryNo).toBe(j1EntryNo);
    expect(register[0]!.totalDebit).toBe("300.0000");
    expect(register[0]!.totalCredit).toBe("300.0000");
    const registerAll = await withTenant(TENANT_P44, () => gl.journalRegister({ limit: 100 }));
    expect(registerAll.length).toBe(3);

    // The threaded HTTP surface (query params — not registry rows).
    const httpBalances = await call(
      "GET",
      `/api/v1/accounting/gl/accounts?projectId=${case01Id}`,
    );
    expect(httpBalances.status).toBe(200);
    const httpRows = httpBalances.body.data as { code: string; debit: string }[];
    expect(httpRows.map((row) => row.code)).toEqual(["1111", "4100"]);
    expect(httpRows.find((row) => row.code === "1111")?.debit).toBe("300.0000");

    const httpMovements = await call(
      "GET",
      `/api/v1/accounting/gl/accounts/${accounts.cash}/movements?projectId=${case01Id}`,
    );
    expect(httpMovements.status).toBe(200);
    const httpMovementRows = (httpMovements.body.data as { movements: { projectId: string | null }[] })
      .movements;
    expect(httpMovementRows.length).toBe(1);
    expect(httpMovementRows[0]!.projectId).toBe(case01Id);

    const httpRegister = await call(
      "GET",
      `/api/v1/accounting/gl/journal-register?projectId=${case01Id}`,
    );
    expect(httpRegister.status).toBe(200);
    const httpRegisterRows = httpRegister.body.data as { entryNo: string | null }[];
    expect(httpRegisterRows.length).toBe(1);
    expect(httpRegisterRows[0]!.entryNo).toBe(j1EntryNo);
  });
});

describe("T44 (e) — a sales invoice with header projectId stamps EVERY line of BOTH journals", () => {
  it("settlement + COGS journals carry the stamp on all lines (the sales fixture substrate)", async () => {
    const fx = await setupSalesFixture();
    const invoice = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fx.branchId,
        customerId: fx.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        // Flow B (invoice_then_delivery): the invoice itself issues stock —
        // that is what produces the COGS journal alongside the settlement.
        warehouseId: fx.warehouseId,
        cashAccountId: null,
        projectId: salesProjectId,
        note: "project-stamped invoice",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: fx.items.a, // STOCK, WAC 60.0000 in S-WH
            accountId: null,
            deliveryLineId: null,
            description: "Case goods",
            descriptionAr: null,
            qty: "2",
            unitPrice: "100.000000",
            discountAmount: null,
            taxCodeId: fx.taxCodeIds.standard, // 15% STANDARD_RATED
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
    const posted = await withTenant(TENANT_S, () => salesInvoices.post(invoice.id, S_ACTOR));

    // The invoice row itself carries the header stamp.
    const postedInvoice = posted.invoice as { projectId: string | null };
    expect(postedInvoice.projectId).toBe(salesProjectId);
    expect(posted.journalEntryId).toBeTruthy();
    expect(posted.cogsJournalEntryId).toBeTruthy();

    // Settlement journal (sales_invoice:post): DR AR 230.0000 (partner) ·
    // CR sales revenue 200.0000 · CR VAT payable 30.0000 — ALL stamped.
    const settlement = await withTenant(TENANT_S, () =>
      journal.listLines(posted.journalEntryId!),
    );
    expect(settlement.length).toBe(3);
    for (const line of settlement) {
      expect(line.projectId).toBe(salesProjectId);
    }
    const arLine = settlement.find((line) => line.direction === "DEBIT")!;
    expect(arLine.amount).toBe("230.0000"); // 2 × 100 × 1.15
    expect(arLine.partnerId).toBe(fx.customerId);
    const vatLine = settlement.find(
      (line) => line.accountId === fx.gl.vatPayable,
    )!;
    expect(vatLine.amount).toBe("30.0000");

    // COGS journal (sales_invoice:cogs): DR COGS 120.0000 · CR inventory
    // 120.0000 (WAC 60 × 2) — ALL stamped.
    const cogs = await withTenant(TENANT_S, () =>
      journal.listLines(posted.cogsJournalEntryId!),
    );
    expect(cogs.length).toBe(2);
    for (const line of cogs) {
      expect(line.projectId).toBe(salesProjectId);
    }
    const cogsDebit = cogs.find((line) => line.direction === "DEBIT")!;
    expect(cogsDebit.accountId).toBe(fx.gl.cogs);
    expect(cogsDebit.amount).toBe("120.0000");
    const inventoryCredit = cogs.find((line) => line.direction === "CREDIT")!;
    expect(inventoryCredit.accountId).toBe(fx.gl.inventory);
    expect(inventoryCredit.amount).toBe("120.0000");
  });
});
