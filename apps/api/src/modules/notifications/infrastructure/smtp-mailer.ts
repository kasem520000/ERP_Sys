import { connect as connectTls } from "node:tls";
import { connect as connectNet, type Socket } from "node:net";

import { env } from "../../../config/env";

/**
 * Minimal SMTP transport (PHASE-003 §2.8): greeting → EHLO → optional
 * STARTTLS → optional AUTH PLAIN → MAIL FROM / RCPT TO / DATA → QUIT. Dev
 * targets mailpit (compose, no auth, :1025); production SMTP provider
 * selection is an operations decision record (phase §7 — deliverability
 * explicitly out of budget). Zero external dependencies: the commands we
 * exercise are the contract, verified against real SMTP sessions in tests.
 */

export interface SmtpEnvelope {
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface SmtpTransport {
  send(envelope: SmtpEnvelope): Promise<void>;
}

/** Disabled transport: SMTP_HOST unset → emails logged + dropped (dev shape). */
export class DisabledSmtpTransport implements SmtpTransport {
  send(_envelope: SmtpEnvelope): Promise<void> {
    return Promise.resolve();
  }
}

interface SmtpReply {
  code: number;
  lines: string[];
}

class SmtpSocket {
  private buffer = "";
  private readonly waiters: ((reply: SmtpReply) => void)[] = [];

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      this.drain();
    });
  }

  private drain(): void {
    // A complete reply ends with a "NNN " line (RFC 5321 §4.2).
    while (true) {
      const match = /^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/.exec(this.buffer);
      if (match === null) {
        return;
      }
      this.buffer = this.buffer.slice(match[0].length);
      const lines = match[0].trim().split(/\r?\n/);
      const code = Number.parseInt(lines[lines.length - 1]!.slice(0, 3), 10);
      const waiter = this.waiters.shift();
      if (waiter !== undefined) {
        waiter({ code, lines });
      }
    }
  }

  read(): Promise<SmtpReply> {
    return new Promise<SmtpReply>((resolve) => {
      this.waiters.push(resolve);
      this.drain();
    });
  }

  write(line: string): void {
    this.socket.write(`${line}\r\n`);
  }

  end(): void {
    this.socket.end();
  }
}

class SmtpSession {
  constructor(
    private readonly io: SmtpSocket,
    private readonly logLabel: string,
  ) {}

  async expect(codes: readonly number[], label: string): Promise<SmtpReply> {
    const reply = await this.io.read();
    if (!codes.includes(reply.code)) {
      throw new Error(`SMTP ${this.logLabel}/${label}: expected ${codes.join("|")}, got ${reply.code} ${reply.lines.join(" / ")}`);
    }
    return reply;
  }

  async send(command: string, codes: readonly number[], label: string): Promise<SmtpReply> {
    this.io.write(command);
    return this.expect(codes, label);
  }
}

/** Plain-socket SMTP client with opportunistic STARTTLS + AUTH PLAIN. */
export class SmtpClientTransport implements SmtpTransport {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly credentials?: { user: string; pass: string },
  ) {}

  async send(envelope: SmtpEnvelope): Promise<void> {
    const socket = await new Promise<Socket>((resolve, reject) => {
      const connection = connectNet(this.port, this.host, () => resolve(connection));
      connection.once("error", reject);
    });
    let io = new SmtpSocket(socket);
    let session = new SmtpSession(io, this.host);
    try {
      await session.expect([220], "greeting");
      const ehlo = await session.send("EHLO erp.local", [250], "ehlo");
      if (ehlo.lines.some((line) => line.toUpperCase().includes("STARTTLS"))) {
        await session.send("STARTTLS", [220], "starttls");
        const plain = socket;
        const upgraded: Socket = await new Promise<Socket>((resolve, reject) => {
          const secure = connectTls(
            { socket: plain, servername: this.host, rejectUnauthorized: false },
            () => resolve(secure as unknown as Socket),
          );
          secure.once("error", reject);
        });
        io = new SmtpSocket(upgraded);
        session = new SmtpSession(io, this.host);
        await session.send("EHLO erp.local", [250], "ehlo-tls");
      }
      if (this.credentials !== undefined) {
        const token = Buffer.from(
          `\u0000${this.credentials.user}\u0000${this.credentials.pass}`,
          "utf8",
        ).toString("base64");
        await session.send(`AUTH PLAIN ${token}`, [235], "auth");
      }
      await session.send(`MAIL FROM:<${envelope.from}>`, [250], "mail-from");
      await session.send(`RCPT TO:<${envelope.to}>`, [250, 251], "rcpt-to");
      await session.send("DATA", [354], "data");
      // Dot-stuff the body per RFC 5321 §4.5.2, terminate with the lone dot.
      const stuffed = envelope.body.replace(/^\./gm, "..");
      const headers = [
        `From: ${envelope.from}`,
        `To: ${envelope.to}`,
        `Subject: ${saneHeader(envelope.subject)}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: 8bit",
        "",
      ].join("\r\n");
      io.write(`${headers}${stuffed}\r\n.`);
      await session.expect([250], "data-end");
      await session.send("QUIT", [221], "quit");
    } finally {
      io.end();
    }
  }
}

/** RFC 2047 for non-ASCII subjects (Arabic titles render correctly). */
function saneHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Transport factory from the environment (SMTP_HOST unset → disabled). */
export function smtpTransportFromEnv(): SmtpTransport {
  if (env.SMTP_HOST === undefined || env.SMTP_HOST === "") {
    return new DisabledSmtpTransport();
  }
  const credentials =
    env.SMTP_USER !== undefined && env.SMTP_PASS !== undefined
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined;
  return new SmtpClientTransport(env.SMTP_HOST, env.SMTP_PORT, credentials);
}
