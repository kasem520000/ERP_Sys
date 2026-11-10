import { createServer, type Server, type Socket } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient, appClient } from "../test-db";
import { reloadEnv, env } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss, getBoss, JobsService } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import {
  EmailService,
  EMAIL_QUEUE,
  type EmailJobPayload,
} from "../../modules/notifications/application/email-service";
import { SmtpClientTransport } from "../../modules/notifications/infrastructure/smtp-mailer";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { PartnerService } from "../../modules/partners/application/partner-service";
import { LeadService } from "../../modules/crm/application/lead-service";
import { TaskService } from "../../modules/crm/application/task-service";
import { PartnerNotFoundError } from "../../modules/partners/domain/partner-errors";
import type { Client } from "pg";

/**
 * PHASE-019 T45 db evidence (MASTER-PLAN §3): the task lifecycle (OPEN →
 * DONE/CANCELLED with the INV-013 legal replays; cross-terminal transitions
 * are typed TASK_STATE), the related-anchor validation (LEAD/PARTNER
 * probes; CONTRACT/SERVICE_ORDER land with T46/T48), and the reminder
 * sweep — the pg-boss `crm.task-reminders-sweep` handler's per-tenant pass:
 * due remindAt → the owner-facing notification (in-app row, category
 * `crm`) + the `task_reminder` email through a REAL SMTP session (the
 * notifications-email pattern) + the notifiedAt stamp; idempotent by the
 * stamp + the dedupe key (re-run notifies nothing); the boundary
 * (remindAt == now bills, future doesn't); CLOSED tasks never sweep; a
 * postponed remindAt re-arms under a fresh dedupe key.
 *
 * Dedicated tenant 65656565 (SAR): the tasks suite owns it end to end
 * (verified unused across the repo before adoption).
 */

const TENANT_TASKS = "65656565-6565-6565-6565-656565656565";
const TASKS_ACTOR = "65656565-0000-4000-8000-000000000651";
const TASKS_OWNER = "65656565-0000-4000-8000-000000000652";

const WEB_BASE = "https://erp.test";

// -- the SMTP capture server (notifications-email.db.spec.ts pattern) -------

interface SmtpSessionState {
  buffer: string;
  inData: boolean;
  mail: { from: string; to: string; raw: string };
}

interface CapturedMail {
  from: string;
  to: string;
  raw: string;
}

class SmtpCaptureServer {
  readonly mails: CapturedMail[] = [];
  private server: Server | undefined;

  async start(): Promise<number> {
    this.server = createServer((socket: Socket) => {
      const state = { buffer: "", inData: false, mail: { from: "", to: "", raw: "" } };
      socket.write("220 capture ESMTP\r\n");
      socket.on("data", (chunk: Buffer) => {
        state.buffer += chunk.toString("utf8");
        if (state.inData) {
          const end = state.buffer.indexOf("\r\n.\r\n");
          if (end === -1) {
            return;
          }
          state.mail.raw = state.buffer.slice(0, end);
          state.buffer = state.buffer.slice(end + 5);
          state.inData = false;
          this.mails.push({ ...state.mail, raw: state.mail.raw });
          state.mail = { from: "", to: "", raw: "" };
          socket.write("250 queued\r\n");
          this.drainRest(socket, state);
          return;
        }
        this.handleLines(socket, state);
      });
    });
    return await new Promise<number>((resolve) => {
      this.server!.listen(0, "127.0.0.1", () => {
        resolve((this.server!.address() as { port: number }).port);
      });
    });
  }

  private drainRest(socket: Socket, state: SmtpSessionState): void {
    if (state.buffer.length > 0) {
      this.handleLines(socket, state);
    }
  }

  private handleLines(socket: Socket, state: SmtpSessionState): void {
    let index: number;
    while ((index = state.buffer.indexOf("\r\n")) !== -1) {
      const line = state.buffer.slice(0, index);
      state.buffer = state.buffer.slice(index + 2);
      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO")) {
        socket.write("250-capture\r\n250 8BITMIME\r\n");
      } else if (upper.startsWith("MAIL FROM:")) {
        state.mail.from = line.slice(10).trim();
        socket.write("250 ok\r\n");
      } else if (upper.startsWith("RCPT TO:")) {
        state.mail.to = line.slice(8).trim();
        socket.write("250 ok\r\n");
      } else if (upper === "DATA") {
        socket.write("354 go\r\n");
        state.inData = true;
        return;
      } else if (upper === "QUIT") {
        socket.write("221 bye\r\n");
        socket.end();
      } else if (upper.startsWith("AUTH")) {
        socket.write("235 ok\r\n");
      } else if (upper.startsWith("STARTTLS")) {
        socket.write("454 TLS not available\r\n");
      } else {
        socket.write("250 ok\r\n");
      }
    }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (this.server === undefined) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }
}

/** Wait until a mail matching the predicate exists (queue delivery is async). */
async function waitForMailMatching(
  capture: SmtpCaptureServer,
  predicate: (mail: CapturedMail) => boolean,
  deadlineMs = 10_000,
): Promise<CapturedMail> {
  const started = Date.now();
  for (;;) {
    const match = capture.mails.find(predicate);
    if (match !== undefined) {
      return match;
    }
    if (Date.now() - started > deadlineMs) {
      throw new Error(`no matching mail captured (${capture.mails.length} total)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Wait until N mails match the predicate (the re-arm pass's second leg). */
async function waitForMailCount(
  capture: SmtpCaptureServer,
  predicate: (mail: CapturedMail) => boolean,
  expected: number,
  deadlineMs = 10_000,
): Promise<void> {
  const started = Date.now();
  for (;;) {
    if (capture.mails.filter(predicate).length >= expected) {
      return;
    }
    if (Date.now() - started > deadlineMs) {
      throw new Error(
        `expected ${expected} matching mails, got ${capture.mails.filter(predicate).length} (${capture.mails.length} total)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// -- the service graph (constructed manually — §18 lesson 6) ----------------

const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();
const partners = new PartnerService(audit);
const leadService = new LeadService(audit, partners);

let email: EmailService;
let tasks: TaskService;
let capture: SmtpCaptureServer;

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tasksClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_TASKS]);
  return client;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();
  const jobs = new JobsService();
  capture = new SmtpCaptureServer();
  const port = await capture.start();
  email = new EmailService({
    jobs,
    transport: new SmtpClientTransport("127.0.0.1", port),
    webBaseUrl: WEB_BASE,
    fromAddress: "no-reply@erp.test",
  });
  // Drain the email queue through the production handler shape.
  const boss = getBoss();
  await boss.work<EmailJobPayload>(EMAIL_QUEUE, async (batch) => {
    for (const job of batch) {
      await email.handleJob(job.data);
    }
  });
  tasks = new TaskService(audit, inbox, email);

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant C45T (crm tasks)', 'المستأجر ت', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TASKS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale) VALUES
       ($1, 'c45-tasks@fixture.test', 'C45 Tasks Actor', 'x', 'ACTIVE', 'en'),
       ($2, 'c45-owner@fixture.test', 'C45 Tasks Owner', 'x', 'ACTIVE', 'en')
     ON CONFLICT (id) DO NOTHING`,
    [TASKS_ACTOR, TASKS_OWNER],
  );
  // The owner membership (notifyOwner's target): a tenant owner role with
  // the owner template's permission set (the inbox-spec seeding pattern).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, TENANT_TASKS],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, TENANT_TASKS, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_TASKS, TASKS_OWNER, roleId],
  );
  await su.end();
});

afterAll(async () => {
  await stopBoss();
  await capture.stop();
  await closeDb();
});

describe("task CRUD + state machine (MASTER-PLAN §3)", () => {
  it("create → OPEN; the related anchors are validated (LEAD crm-side, PARTNER via the partners read)", async () => {
    const lead = await withTenant(TENANT_TASKS, () =>
      leadService.create({
        name: "Task Anchor Lead",
        nameAr: null,
        phone: "+966503334455",
        email: "anchor@tasks.test",
        company: null,
        source: "REFERRAL",
        ownerUserId: TASKS_ACTOR,
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    anchorLeadGlobal = lead.id;

    const task = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Call back the anchor lead",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: TASKS_ACTOR,
        dueDate: "2026-03-05",
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
        note: "First follow-up",
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    expect(task.status).toBe("OPEN");
    expect(task.notifiedAt).toBeNull();

    const client = await tasksClient();
    const events = await client.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE entity_type = 'crm_task' AND entity_id = $1`,
      [task.id],
    );
    await client.end();
    expect(events.rows.map((row) => row.action)).toEqual(["crm.task.created"]);

    // Dangling anchors are the typed not-founds; bad enums/shapes the 422
    // policy class.
    await expect(
      withTenant(TENANT_TASKS, () =>
        tasks.create({
          title: "dangling",
          relatedType: "LEAD",
          relatedId: "99999999-9999-4999-8999-999999999995",
          assigneeUserId: null,
          dueDate: null,
          remindAt: null,
          note: null,
          noteAr: null,
          actorId: TASKS_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    await expect(
      withTenant(TENANT_TASKS, () =>
        tasks.create({
          title: "dangling partner",
          relatedType: "PARTNER",
          relatedId: "99999999-9999-4999-8999-999999999994",
          assigneeUserId: null,
          dueDate: null,
          remindAt: null,
          note: null,
          noteAr: null,
          actorId: TASKS_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(PartnerNotFoundError);
    await expect(
      withTenant(TENANT_TASKS, () =>
        tasks.create({
          title: "bad enum",
          relatedType: "INVOICE",
          relatedId: anchorLeadGlobal,
          assigneeUserId: null,
          dueDate: null,
          remindAt: null,
          note: null,
          noteAr: null,
          actorId: TASKS_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TASK_INPUT_INVALID" });
    await expect(
      withTenant(TENANT_TASKS, () =>
        tasks.create({
          title: "   ",
          relatedType: "LEAD",
          relatedId: anchorLeadGlobal,
          assigneeUserId: null,
          dueDate: null,
          remindAt: null,
          note: null,
          noteAr: null,
          actorId: TASKS_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "TASK_INPUT_INVALID" });

    // The documented T46/T48 gap: CONTRACT/SERVICE_ORDER anchors are
    // accepted as uuid-shaped ids until their services land (no probes).
    const contractAnchored = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Renewal check (contract anchor — probe lands with T46)",
        relatedType: "CONTRACT",
        relatedId: generateUuidV7(),
        assigneeUserId: null,
        dueDate: null,
        remindAt: null,
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    expect(contractAnchored.status).toBe("OPEN");
  });

  it("list filters: status + relatedType/relatedId", async () => {
    const byRelated = await withTenant(TENANT_TASKS, () =>
      tasks.list({ relatedType: "LEAD", relatedId: anchorLeadGlobal, limit: 50 }),
    );
    expect(byRelated.length).toBeGreaterThanOrEqual(1);
    expect(
      byRelated.every((row) => row.relatedType === "LEAD" && row.relatedId === anchorLeadGlobal),
    ).toBe(true);

    const byStatus = await withTenant(TENANT_TASKS, () => tasks.list({ status: "OPEN", limit: 200 }));
    expect(byStatus.every((row) => row.status === "OPEN")).toBe(true);
    expect(byStatus.find((row) => row.title === "Call back the anchor lead")).toBeTruthy();
  });

  it("update while OPEN; carrying remindAt re-arms the sweep; terminal PUT → TASK_STATE", async () => {
    const created = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Prepare the quote",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: "2026-03-10",
        remindAt: new Date(Date.now() - 3_600_000).toISOString(),
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    const updated = await withTenant(TENANT_TASKS, () =>
      tasks.update(created.id, { title: "Prepare the revised quote", dueDate: "2026-03-12" }, TASKS_ACTOR),
    );
    expect(updated.title).toBe("Prepare the revised quote");
    expect(updated.dueDate).toBe("2026-03-12");

    // Re-arm: a carried remindAt clears notifiedAt (the postpone contract).
    const rearmed = await withTenant(TENANT_TASKS, () =>
      tasks.update(
        created.id,
        { remindAt: new Date(Date.now() + 7_200_000).toISOString() },
        TASKS_ACTOR,
      ),
    );
    expect(rearmed.remindAt).not.toBe(created.remindAt);

    // Terminal tasks are frozen.
    await withTenant(TENANT_TASKS, () => tasks.complete(created.id, TASKS_ACTOR));
    await expect(
      withTenant(TENANT_TASKS, () => tasks.update(created.id, { title: "nope" }, TASKS_ACTOR)),
    ).rejects.toMatchObject({ code: "TASK_STATE" });
  });

  it("complete: OPEN → DONE; replay is the stored row; cancel-on-DONE → TASK_STATE", async () => {
    const task = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Send the proposal",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: null,
        remindAt: null,
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    const done = await withTenant(TENANT_TASKS, () => tasks.complete(task.id, TASKS_ACTOR));
    expect(done.status).toBe("DONE");
    const replay = await withTenant(TENANT_TASKS, () => tasks.complete(task.id, TASKS_ACTOR));
    expect(replay.status).toBe("DONE");
    expect(replay.updatedAt).toBe(done.updatedAt);
    await expect(
      withTenant(TENANT_TASKS, () => tasks.cancel(task.id, TASKS_ACTOR)),
    ).rejects.toMatchObject({ code: "TASK_STATE" });
  });

  it("cancel: OPEN → CANCELLED; replay is the stored row; complete-on-CANCELLED → TASK_STATE", async () => {
    const task = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Cold outreach (will cancel)",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: null,
        remindAt: null,
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    const cancelled = await withTenant(TENANT_TASKS, () => tasks.cancel(task.id, TASKS_ACTOR));
    expect(cancelled.status).toBe("CANCELLED");
    const replay = await withTenant(TENANT_TASKS, () => tasks.cancel(task.id, TASKS_ACTOR));
    expect(replay.status).toBe("CANCELLED");
    expect(replay.updatedAt).toBe(cancelled.updatedAt);
    await expect(
      withTenant(TENANT_TASKS, () => tasks.complete(task.id, TASKS_ACTOR)),
    ).rejects.toMatchObject({ code: "TASK_STATE" });
  });
});

describe("reminder sweep (§3 — the crm.task-reminders-sweep handler)", () => {
  let remindedTask: { id: string; remindAt: string; title: string };

  it("due remindAt → owner notification (crm) + email + notifiedAt stamp + system audit", async () => {
    const task = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Follow up with the anchor lead",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: TASKS_ACTOR,
        dueDate: "2026-03-05",
        remindAt: new Date(Date.now() - 1_800_000).toISOString(),
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    remindedTask = { id: task.id, remindAt: task.remindAt!, title: task.title };

    const outcome = await withTenant(TENANT_TASKS, () => tasks.sweepReminders());
    expect(outcome.notified).toBe(1);

    // notifiedAt stamped (the sweep's own idempotency).
    const after = await withTenant(TENANT_TASKS, () => tasks.find(task.id));
    expect(after.notifiedAt).toBeTruthy();

    // The in-app leg: category crm, owner-targeted, the documented action
    // URL, exactly once for the dedupe key.
    const client = await tasksClient();
    const rows = await client.query<{
      category: string;
      severity: string;
      action_url: string;
      user_id: string;
      title: { en: string };
    }>(
      `SELECT category, severity, action_url, user_id, title FROM notifications
        WHERE dedupe_key = $1`,
      [`crm-task-reminder:${task.id}:${task.remindAt}`],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.category).toBe("crm");
    expect(rows.rows[0]!.severity).toBe("info");
    expect(rows.rows[0]!.action_url).toBe("/crm/tasks");
    expect(rows.rows[0]!.user_id).toBe(TASKS_OWNER);
    expect(rows.rows[0]!.title.en).toBe(`Task reminder due: ${task.title}`);

    // The system audit (actor NULL — no user drove the pass).
    const swept = await client.query<{ actor_id: string | null }>(
      `SELECT actor_id FROM audit_events
        WHERE action = 'crm.task_reminders_swept' AND entity_id = $1`,
      [task.id],
    );
    await client.end();
    expect(swept.rows).toHaveLength(1);
    expect(swept.rows[0]!.actor_id).toBeNull();

    // The email leg: the task_reminder template through a REAL SMTP
    // session (EN owner locale) — the body carries the template variables
    // contract (title + due date + the tasks URL); the subject's em dash
    // makes it a base64 RFC-2047 header (non-ASCII), so the raw match is
    // on the body.
    const mail = await waitForMailMatching(
      capture,
      (m) => m.raw.includes("Task: Follow up with the anchor lead"),
    );
    expect(mail.to).toBe("<c45-owner@fixture.test>");
    expect(mail.raw).toContain("Due date: 2026-03-05");
    // tasksUrl rides env.WEB_BASE_URL (the usage-service URL precedent).
    expect(mail.raw).toContain(`${env.WEB_BASE_URL}/crm/tasks`);
    const subject = /Subject: (.*)\r/.exec(mail.raw)?.[1] ?? "";
    expect(subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(Buffer.from(subject.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, ""), "base64").toString("utf8")).toContain(
      "Task reminder: Follow up with the anchor lead",
    );
  });

  it("re-run notifies nothing (notifiedAt + dedupe key are the nets)", async () => {
    const outcome = await withTenant(TENANT_TASKS, () => tasks.sweepReminders());
    expect(outcome.notified).toBe(0);

    const client = await tasksClient();
    const rows = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE dedupe_key = $1`,
      [`crm-task-reminder:${remindedTask.id}:${remindedTask.remindAt}`],
    );
    await client.end();
    expect(rows.rows[0]!.n).toBe(1);
    // Exactly one mail for the title (the re-run enqueued nothing).
    expect(capture.mails.filter((m) => m.raw.includes(remindedTask.title))).toHaveLength(1);
  });

  it("boundary: remindAt == now bills (inclusive); future does not", async () => {
    const boundary = new Date();
    const task = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Boundary probe task",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: null,
        remindAt: boundary.toISOString(),
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    // The scan predicate is inclusive: remind_at <= now.
    const { listDueTaskReminders } = await import("../../modules/crm/infrastructure/crm.store");
    const due = await withTenant(TENANT_TASKS, () => listDueTaskReminders(boundary));
    expect(due.find((row) => row.id === task.id)).toBeTruthy();

    // A future reminder never bills.
    const future = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Future reminder probe",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: null,
        remindAt: new Date(Date.now() + 86_400_000).toISOString(),
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    const swept = await withTenant(TENANT_TASKS, () => tasks.sweepReminders());
    expect(swept.notified).toBe(1); // only the boundary probe
    const futureAfter = await withTenant(TENANT_TASKS, () => tasks.find(future.id));
    expect(futureAfter.notifiedAt).toBeNull();
  });

  it("CLOSED tasks never sweep; a postponed remindAt re-arms under a fresh dedupe key", async () => {
    // DONE with a due, unnotified reminder → skipped.
    const doneTask = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "Completed before the sweep",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: null,
        remindAt: new Date(Date.now() - 600_000).toISOString(),
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    await withTenant(TENANT_TASKS, () => tasks.complete(doneTask.id, TASKS_ACTOR));
    const beforeSweep = await withTenant(TENANT_TASKS, () => tasks.sweepReminders());
    expect(beforeSweep.notified).toBe(0);
    expect((await withTenant(TENANT_TASKS, () => tasks.find(doneTask.id))).notifiedAt).toBeNull();

    // Re-arm: carrying a new (due) remindAt clears notifiedAt → the sweep
    // notifies again under a fresh dedupe key (postponement semantics).
    // The dueDate moves too — the email layer coalesces content-identical
    // sends by fingerprint (the notifications-email contract), so the
    // second mail needs the genuinely-new variables the postponement
    // produces.
    const rearmed = await withTenant(TENANT_TASKS, () =>
      tasks.update(
        remindedTask.id,
        { remindAt: new Date(Date.now() - 300_000).toISOString(), dueDate: "2026-03-06" },
        TASKS_ACTOR,
      ),
    );
    expect(rearmed.notifiedAt).toBeNull();
    const outcome = await withTenant(TENANT_TASKS, () => tasks.sweepReminders());
    expect(outcome.notified).toBe(1);
    const after = await withTenant(TENANT_TASKS, () => tasks.find(remindedTask.id));
    expect(after.notifiedAt).toBeTruthy();

    const client = await tasksClient();
    const rows = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
        WHERE dedupe_key LIKE $1`,
      [`crm-task-reminder:${remindedTask.id}:%`],
    );
    await client.end();
    expect(rows.rows[0]!.n).toBe(2); // the original + the re-armed pass
    await waitForMailCount(
      capture,
      (m) => m.raw.includes("Task: Follow up with the anchor lead"),
      2,
    );
    const secondMail = capture.mails.filter((m) =>
      m.raw.includes("Task: Follow up with the anchor lead"),
    );
    expect(secondMail.some((m) => m.raw.includes("Due date: 2026-03-06"))).toBe(true);
  });

  it("the system job (sweepAllReminders) iterates ACTIVE tenants outside any tenant scope", async () => {
    const due = await withTenant(TENANT_TASKS, () =>
      tasks.create({
        title: "System job probe task",
        relatedType: "LEAD",
        relatedId: anchorLeadGlobal,
        assigneeUserId: null,
        dueDate: null,
        remindAt: new Date(Date.now() - 120_000).toISOString(),
        note: null,
        noteAr: null,
        actorId: TASKS_ACTOR,
      }),
    );
    // No withTenant here: the pg-boss handler's world — it enumerates
    // ACTIVE tenants itself and sweeps each in its own UoW.
    const result = await tasks.sweepAllReminders();
    expect(result.tenants).toBeGreaterThanOrEqual(1);
    expect(result.notified).toBeGreaterThanOrEqual(1);
    const after = await withTenant(TENANT_TASKS, () => tasks.find(due.id));
    expect(after.notifiedAt).toBeTruthy();
  });
});

/** The anchor lead id (created in the first test; shared by the sweep pack). */
let anchorLeadGlobal = "";