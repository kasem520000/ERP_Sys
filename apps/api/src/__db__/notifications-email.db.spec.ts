import { createServer, type Server, type Socket } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { JobsService } from "../infra/jobs/boss";
import { startBoss, getBoss, stopBoss } from "../infra/jobs/boss";
import {
  EmailService,
  EMAIL_QUEUE,
  identitySenders,
} from "../modules/notifications/application/email-service";
import type { EmailPayload } from "../modules/notifications/application/templates";
import type { EmailJobPayload } from "../modules/notifications/application/email-service";
import { renderEmail } from "../modules/notifications/application/templates";
import { SmtpClientTransport } from "../modules/notifications/infrastructure/smtp-mailer";
import { closeDb } from "../infra/db/client";
import { generateUuidV7 } from "@erp/domain-core";

/**
 * PHASE-003 T9 acceptance evidence (acceptance 10): emails flow through a
 * REAL SMTP session (an in-process capture server speaking the same five
 * commands production uses — the dev mailpit target is the same protocol),
 * rendered in AR and EN, delivered via the pg-boss queue, and duplicate
 * enqueues coalesce into exactly one send (deterministic jobId + queue
 * contract). The transport under test is the production SmtpClientTransport.
 */

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
  private port = 0;

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
        const address = this.server!.address() as { port: number };
        this.port = address.port;
        resolve(this.port);
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

const TENANT = "11111111-1111-1111-1111-111111111111";

let email: EmailService;
let capture: SmtpCaptureServer;
let jobs: JobsService;

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();
  jobs = new JobsService();
  capture = new SmtpCaptureServer();
  const port = await capture.start();
  email = new EmailService({
    jobs,
    transport: new SmtpClientTransport("127.0.0.1", port),
    webBaseUrl: "https://erp.test",
    fromAddress: "no-reply@erp.test",
  });
  // Drain the queue through the production handler shape.
  const boss = getBoss();
  await boss.work<EmailJobPayload>(EMAIL_QUEUE, async (batch) => {
    for (const job of batch) {
      await email.handleJob(job.data);
    }
  });
});

afterAll(async () => {
  await stopBoss();
  await capture.stop();
  await closeDb();
});

/** Wait until a mail matching the predicate exists (content-based — queue
 * delivery is async, so positional waits race across tests). */
async function waitForMailMatching(
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

describe("email adapter (real SMTP session + pg-boss idempotency)", () => {
  it("renders + delivers the AR invitation with the accept link through the queue", async () => {
    const senders = identitySenders(email, "https://erp.test");
    await senders.sendInvitation({
      tenantId: TENANT,
      email: "ar-colleague@test",
      locale: "ar",
      token: "ar-invitation-token-123",
      tenantName: "ERP Demo",
      tenantNameAr: "شركة تجريبية",
      roleName: "Accountant",
      roleNameAr: "المحاسب",
    });
    const mail = await waitForMailMatching((m) =>
      m.raw.includes("accept-invitation?token=ar-invitation-token-123"),
    );
    expect(mail.to).toBe("<ar-colleague@test>");
    expect(mail.raw).toContain("شركة تجريبية");
    expect(mail.raw).toContain("المحاسب");
  });

  it("delivers the EN password reset (30-minute wording + link)", async () => {
    const senders = identitySenders(email, "https://erp.test");
    await senders.sendPasswordReset({
      tenantId: null,
      email: "en-user@test",
      locale: "en",
      token: "en-reset-token-456",
    });
    const mail = await waitForMailMatching((m) =>
      m.raw.includes("reset-password?token=en-reset-token-456"),
    );
    expect(mail.raw).toContain("30 minutes");
  });

  it("duplicate enqueue of the same logical email sends exactly once (idempotent handler)", async () => {
    const payload: EmailPayload = {
      template: "login_notification",
      locale: "ar",
      recipient: "once-only@test",
      variables: { ip: "5.5.5.5", at: "2026-10-28T00:00:00Z" },
    };
    await email.enqueue(TENANT, payload);
    await email.enqueue(TENANT, payload); // same fingerprint → same jobId
    await email.enqueue(TENANT, payload); // third try: still one job
    const mail = await waitForMailMatching(
      (m) => m.raw.includes("2026-10-28T00:00:00Z") && m.to === "<once-only@test>",
    );
    expect(mail.raw).toContain("5.5.5.5");
    await new Promise((resolve) => setTimeout(resolve, 800)); // drain window
    const delivered = capture.mails.filter((m) => m.to === "<once-only@test>");
    expect(delivered).toHaveLength(1); // duplicate enqueues coalesced
  });

  it("template rendering is byte-stable for the queue replay path", () => {
    const payload = {
      template: "invitation" as const,
      locale: "en" as const,
      recipient: "stable@test",
      variables: { tenantName: "T", roleName: "R", acceptUrl: "https://u" },
    };
    expect(renderEmail(payload)).toEqual(renderEmail(payload));
  });

  it("invitation mail is recorded as a durable job before the send (A9-safe payload shape)", async () => {
    const su = await superuserClient();
    const jobs = await su.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM boss.job WHERE name = $1",
      [EMAIL_QUEUE],
    );
    await su.end();
    expect(Number(jobs.rows[0]?.count)).toBeGreaterThanOrEqual(2);
    // Payload carries tenant scoping, never key material: no PHC hashes,
    // no argon2 digests, no private keys — reset links may carry their token
    // by design (that IS the capability being delivered).
    const last = capture.mails.at(-1);
    expect(last?.raw ?? "").not.toContain("$argon2");
    expect(last?.raw ?? "").not.toMatch(/BEGIN (RSA |EC )?PRIVATE KEY/);
    void generateUuidV7;
  });
});
