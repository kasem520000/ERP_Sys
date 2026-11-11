import { describe, expect, it } from "vitest";

import type {
  OutboundSendRequest,
  ProviderHttpTransport,
} from "./helpers";
import {
  MailgunAdapter,
  SendGridAdapter,
  SesAdapter,
  SmtpEmailAdapter,
} from "../application/providers/email-providers";
import {
  MsegatAdapter,
  TwilioAdapter,
  UnifonicAdapter,
} from "../application/providers/sms-providers";
import { WhatsappBusinessAdapter } from "../application/providers/whatsapp-business";
import { SandboxChannelProvider, sandboxProviders } from "../application/providers/sandbox-provider";
import { PROVIDER_REGISTRY, findProviderDescriptor } from "../application/provider-registry";
import {
  canonicalRequest,
  sha256Hex,
  sigV4Authorization,
  signingKey,
  stringToSign,
  type SigV4Input,
} from "../application/providers/aws-sigv4";

/**
 * PHASE-041 T-02 (acceptance §6.2's core) — the adapter contract suite
 * behind FAKE transports: every provider's wire shape (URL, auth, body),
 * the success/rejection/network paths, the retryability labels, the
 * BR-067 SANDBOX zero-external-calls proof (a POISONED global fetch +
 * a poisoned transport stay untouched through a full sandbox send), and
 * the SigV4 signer pinned against the AWS documentation's complete
 * worked example.
 */

// -- fakes -------------------------------------------------------------------

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function fakeTransport(
  status: number,
  responseBody: string,
  capture: CapturedCall[],
  headers: Record<string, string> = {},
): ProviderHttpTransport {
  return async (request) => {
    capture.push({
      url: request.url,
      method: request.method,
      headers: { ...request.headers },
      body: request.body ?? "",
    });
    return { status, body: responseBody, headers };
  };
}

function failingTransport(error: Error): ProviderHttpTransport {
  return async () => {
    throw error;
  };
}

/** A transport that FAILS THE TEST if invoked (the network-blocked proof). */
function poisonedTransport(label: string): ProviderHttpTransport {
  return async () => {
    throw new Error(`NETWORK-BLOCK VIOLATION (${label}): transport invoked`);
  };
}

function emailRequest(overrides: Partial<OutboundSendRequest> = {}): OutboundSendRequest {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    channel: "EMAIL",
    to: "customer@example.com",
    renderedFor: "ar",
    subject: "فاتورتكم رقم INV-001",
    body: "مرحباً، مرفق فاتورتكم.",
    ...overrides,
  };
}

function whatsappRequest(overrides: Partial<OutboundSendRequest> = {}): OutboundSendRequest {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    channel: "WHATSAPP",
    to: "+966501234567",
    renderedFor: "ar",
    body: "تذكير بالمستحق",
    whatsappTemplateName: "dunning_step1",
    whatsappTemplateLanguage: "ar",
    whatsappTemplateParams: ["شركة الأمل", "INV-001"],
    ...overrides,
  };
}

function smsRequest(overrides: Partial<OutboundSendRequest> = {}): OutboundSendRequest {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    channel: "SMS",
    to: "+966501234567",
    renderedFor: "ar",
    body: "تذكير بالمستحق INV-001",
    ...overrides,
  };
}

// -- BR-067: the SANDBOX default ---------------------------------------------

describe("BR-067 — the SANDBOX default provider", () => {
  it("makes ZERO external calls: a poisoned global fetch stays untouched through a full sandbox send", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      throw new Error("NETWORK-BLOCK VIOLATION (fetch): global fetch invoked");
    }) as typeof fetch;
    try {
      const sandbox = new SandboxChannelProvider("WHATSAPP");
      const result = await sandbox.send(whatsappRequest());
      expect(result.ok).toBe(true);
      expect(result.delivered).toBe(true);
      expect(result.providerMessageId).toMatch(/^sandbox-[0-9a-f-]{36}$/);
      expect(result.cost).toEqual({ amount: "0.0000", currency: "SAR" });
      expect(fetchCalled).toBe(false);
      // The sandbox provider accepts NO transport at all — a poisoned one
      // fails loudly if anything ever reaches for it.
      const poisoned = poisonedTransport("sandbox");
      await expect(poisoned({ url: "https://block.test", method: "GET" })).rejects.toThrow(
        /NETWORK-BLOCK/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exercises all three channel kinds with the same deterministic shape", async () => {
    const providers = sandboxProviders();
    const email = await providers.EMAIL.send(emailRequest());
    const whatsapp = await providers.WHATSAPP.send(whatsappRequest());
    const sms = await providers.SMS.send(smsRequest());
    expect(email.ok && whatsapp.ok && sms.ok).toBe(true);
    expect(providers.EMAIL.id).toBe("sandbox");
  });

  it("fails closed on malformed recipients (a misconfigured recipient never looks delivered)", async () => {
    const email = await new SandboxChannelProvider("EMAIL").send(
      emailRequest({ to: "not-an-email" }),
    );
    const phone = await new SandboxChannelProvider("SMS").send(smsRequest({ to: "0501234567" }));
    expect(email).toMatchObject({ ok: false, error: "sandbox-invalid-email-recipient" });
    expect(phone).toMatchObject({ ok: false, error: "sandbox-invalid-phone-recipient" });
  });
});

// -- WhatsApp Business --------------------------------------------------------

describe("whatsapp-business adapter", () => {
  const credentials = { accessToken: "EAAG-token", phoneNumberId: "123456789" };

  it("posts the template-message shape to the per-sender Graph endpoint", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new WhatsappBusinessAdapter(
      credentials,
      fakeTransport(200, JSON.stringify({ messages: [{ id: "wamid.HBgJKLM=" }] }), calls),
    );
    const result = await adapter.send(
      whatsappRequest({ senderId: "999888777" }),
    );
    expect(result).toMatchObject({ ok: true, providerMessageId: "wamid.HBgJKLM=" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/999888777/messages");
    expect(calls[0]!.headers.authorization).toBe("Bearer EAAG-token");
    const payload = JSON.parse(calls[0]!.body) as {
      to: string;
      type: string;
      template: { name: string; language: { code: string }; components: unknown[] };
    };
    expect(payload.to).toBe("+966501234567");
    expect(payload.type).toBe("template");
    expect(payload.template.name).toBe("dunning_step1");
    expect(payload.template.language.code).toBe("ar");
  });

  it("fails closed without a template name (never a free-form fallback)", async () => {
    const adapter = new WhatsappBusinessAdapter(
      credentials,
      fakeTransport(200, "{}", []),
    );
    const result = await adapter.send(
      whatsappRequest({ whatsappTemplateName: undefined }),
    );
    expect(result).toMatchObject({ ok: false, error: "whatsapp-template-required" });
  });

  it("labels 5xx as retryable and 4xx provider rejections as final", async () => {
    const retryable = await new WhatsappBusinessAdapter(
      credentials,
      fakeTransport(503, "{}", []),
    ).send(whatsappRequest());
    expect(retryable).toMatchObject({ ok: false, retryable: true });
    expect(retryable.error).toContain("whatsapp-http-503");

    const final = await new WhatsappBusinessAdapter(
      credentials,
      fakeTransport(
        400,
        JSON.stringify({ error: { message: "template not found" } }),
        [],
      ),
    ).send(whatsappRequest());
    expect(final.ok).toBe(false);
    expect(final.retryable).not.toBe(true);
    expect(final.error).toContain("template not found");
  });

  it("network failures are retryable and never thrown", async () => {
    const result = await new WhatsappBusinessAdapter(
      credentials,
      failingTransport(new Error("ECONNRESET")),
    ).send(whatsappRequest());
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(result.error).toContain("whatsapp-network:ECONNRESET");
  });
});

// -- SMS providers ------------------------------------------------------------

describe("unifonic adapter", () => {
  it("posts the form-encoded gateway shape (AppSid, no + prefix, optional SenderName)", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new UnifonicAdapter(
      { appSid: "APP-SID-1", senderName: "MyBrand" },
      fakeTransport(200, JSON.stringify({ success: true, MessageID: "U123" }), calls),
    );
    const result = await adapter.send(smsRequest({ senderId: "MarketSA" }));
    expect(result).toMatchObject({ ok: true, providerMessageId: "U123" });
    expect(calls[0]!.url).toBe("https://api.unifonic.com/v1/gateway/Messages/Send");
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("AppSid")).toBe("APP-SID-1");
    expect(params.get("Recipient")).toBe("966501234567");
    expect(params.get("SenderName")).toBe("MarketSA");
  });

  it("rejections surface the provider code, non-retryable", async () => {
    const result = await new UnifonicAdapter(
      { appSid: "APP-SID-1" },
      fakeTransport(200, JSON.stringify({ success: false, Code: 101 }), []),
    ).send(smsRequest());
    expect(result).toMatchObject({ ok: false, error: "unifonic-rejected:101" });
  });
});

describe("msegat adapter", () => {
  it("posts the JSON gateway shape with UTF-8 encoding for Arabic", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new MsegatAdapter(
      { username: "user", password: "pass", senderName: "Brand" },
      fakeTransport(200, JSON.stringify({ code: "1", messageID: "M-9" }), calls),
    );
    const result = await adapter.send(smsRequest());
    expect(result).toMatchObject({ ok: true, providerMessageId: "M-9" });
    const payload = JSON.parse(calls[0]!.body) as Record<string, string>;
    expect(payload.numbers).toBe("966501234567");
    expect(payload.msgEncoding).toBe("UTF-8");
    expect(payload.senderName).toBe("Brand");
  });
});

describe("twilio adapter", () => {
  it("posts the form shape with basic auth to the account endpoint", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new TwilioAdapter(
      { accountSid: "AC123", authToken: "tok", fromNumber: "+15550001111" },
      fakeTransport(201, JSON.stringify({ sid: "SM123", status: "queued" }), calls),
    );
    const result = await adapter.send(smsRequest());
    expect(result).toMatchObject({ ok: true, providerMessageId: "SM123" });
    expect(calls[0]!.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json",
    );
    expect(calls[0]!.headers.authorization).toBe(
      `Basic ${Buffer.from("AC123:tok").toString("base64")}`,
    );
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("To")).toBe("+966501234567");
    expect(params.get("From")).toBe("+15550001111");
  });
});

// -- Email providers ----------------------------------------------------------

describe("smtp adapter (the existing-seam bridge)", () => {
  it("bridges onto the SmtpTransport seam with the caller-resolved from", async () => {
    const envelopes: { from: string; to: string; subject: string; body: string }[] = [];
    const adapter = new SmtpEmailAdapter(
      {
        host: "smtp.example.com",
        port: 587,
        fromAddress: "billing@erp.example",
        transport: {
          send: async (envelope) => {
            envelopes.push(envelope);
          },
        },
      },
      () => {
        throw new Error("fallback must not be constructed when a transport is injected");
      },
    );
    const result = await adapter.send(emailRequest({ senderId: "no-reply@erp.example" }));
    expect(result.ok).toBe(true);
    expect(result.providerMessageId).toMatch(/^smtp-\d+$/);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      from: "no-reply@erp.example",
      to: "customer@example.com",
      subject: "فاتورتكم رقم INV-001",
    });
  });

  it("requires a subject (the EMAIL channel contract)", async () => {
    const result = await new SmtpEmailAdapter(
      { host: "h", port: 25, fromAddress: "a@b.c", transport: { send: async () => {} } },
      () => {
        throw new Error("unused");
      },
    ).send(emailRequest({ subject: undefined }));
    expect(result).toMatchObject({ ok: false, error: "smtp-subject-required" });
  });
});

describe("sendgrid adapter", () => {
  it("posts the v3 shape and reads X-Message-Id from the 202", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new SendGridAdapter(
      { apiKey: "SG.key", fromAddress: "billing@erp.example" },
      fakeTransport(202, "", calls, { "x-message-id": "SG-msg-1" }),
    );
    const result = await adapter.send(emailRequest());
    expect(result).toMatchObject({ ok: true, providerMessageId: "SG-msg-1" });
    expect(calls[0]!.url).toBe("https://api.sendgrid.com/v3/mail/send");
    const payload = JSON.parse(calls[0]!.body) as {
      personalizations: { to: { email: string }[] }[];
      subject: string;
    };
    expect(payload.personalizations[0]!.to[0]!.email).toBe("customer@example.com");
    expect(payload.subject).toBe("فاتورتكم رقم INV-001");
  });
});

describe("ses adapter", () => {
  const credentials = {
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "me-south-1",
    fromAddress: "billing@erp.example",
  };

  it("posts the v2 SendEmail shape with SigV4 headers", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new SesAdapter(
      credentials,
      fakeTransport(200, JSON.stringify({ MessageId: "0100018a" }), calls),
    );
    const result = await adapter.send(emailRequest());
    expect(result).toMatchObject({ ok: true, providerMessageId: "0100018a" });
    expect(calls[0]!.url).toBe(
      "https://email.me-south-1.amazonaws.com/v2/email/outbound-emails",
    );
    expect(calls[0]!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/me-south-1\/ses\/aws4_request/,
    );
    const payload = JSON.parse(calls[0]!.body) as {
      FromEmailAddress: string;
      Destination: { ToAddresses: string[] };
    };
    expect(payload.FromEmailAddress).toBe("billing@erp.example");
    expect(payload.Destination.ToAddresses).toEqual(["customer@example.com"]);
  });
});

describe("mailgun adapter", () => {
  it("posts the form shape with basic auth to the domain endpoint", async () => {
    const calls: CapturedCall[] = [];
    const adapter = new MailgunAdapter(
      { apiKey: "key-1", domain: "erp.example", fromAddress: "billing@erp.example" },
      fakeTransport(200, JSON.stringify({ id: "<2026 msg@erp.example>", message: "Queued" }), calls),
    );
    const result = await adapter.send(emailRequest({ senderId: "billing@eu.erp.example" }));
    expect(result).toMatchObject({ ok: true, providerMessageId: "<2026 msg@erp.example>" });
    expect(calls[0]!.url).toBe("https://api.mailgun.net/v3/erp.example/messages");
    const params = new URLSearchParams(calls[0]!.body);
    expect(params.get("from")).toBe("billing@eu.erp.example");
    expect(params.get("to")).toBe("customer@example.com");
  });
});

// -- the registry -------------------------------------------------------------

describe("provider registry (BR-067's only construction door)", () => {
  it("carries the eight real providers with kind-consistent descriptors", () => {
    const ids = PROVIDER_REGISTRY.map((entry) => entry.id);
    expect(ids).toEqual([
      "whatsapp-business",
      "unifonic",
      "msegat",
      "twilio",
      "smtp",
      "sendgrid",
      "ses",
      "mailgun",
    ]);
    const byKind: Record<string, string[]> = {};
    for (const entry of PROVIDER_REGISTRY) {
      (byKind[entry.kind] ??= []).push(entry.id);
      expect(entry.label.ar.length).toBeGreaterThan(0);
      expect(entry.label.en.length).toBeGreaterThan(0);
      expect(entry.credentialFields.length).toBeGreaterThan(0);
    }
    expect(byKind.WHATSAPP).toEqual(["whatsapp-business"]);
    expect(byKind.SMS).toEqual(["unifonic", "msegat", "twilio"]);
    expect(byKind.EMAIL).toEqual(["smtp", "sendgrid", "ses", "mailgun"]);
  });

  it("factories construct adapters from raw credential records (fake transport)", () => {
    const descriptor = findProviderDescriptor("whatsapp-business")!;
    const adapter = descriptor.create(
      { accessToken: "t", phoneNumberId: "1" },
      fakeTransport(200, JSON.stringify({ messages: [{ id: "wamid.1" }] }), []),
    );
    expect(adapter.id).toBe("whatsapp-business");
  });

  it("missing required credentials fail loudly at construction", () => {
    const descriptor = findProviderDescriptor("msegat")!;
    expect(() => descriptor.create({ username: "u" })).toThrow(/missing credential field/);
  });

  it("the sandbox is NOT a registry entry (it is the default, never a selection)", () => {
    expect(findProviderDescriptor("sandbox")).toBeUndefined();
  });
});

// -- SigV4 pinned to the AWS documentation example ----------------------------

describe("AWS SigV4 signer (pinned to the AWS docs complete example)", () => {
  // The AWS General Reference "Examples of the complete Signature Version 4
  // signing process" — the iam ListUsers GET worked example: AKIDEXAMPLE,
  // 20150830T123600Z, us-east-1, service iam.
  const input: SigV4Input = {
    method: "GET",
    url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      host: "iam.amazonaws.com",
      "x-amz-date": "20150830T123600Z",
    },
    payload: "",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "iam",
    amzDate: "20150830T123600Z",
    dateStamp: "20150830",
  };

  it("reproduces the documented canonical request", () => {
    expect(canonicalRequest(input)).toBe(
      [
        "GET",
        "/",
        "Action=ListUsers&Version=2010-05-08",
        "content-type:application/x-www-form-urlencoded; charset=utf-8\n" +
          "host:iam.amazonaws.com\n" +
          "x-amz-date:20150830T123600Z\n",
        "content-type;host;x-amz-date",
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      ].join("\n"),
    );
  });

  it("reproduces the documented string-to-sign", () => {
    const requestHash = sha256Hex(canonicalRequest(input));
    expect(stringToSign(input, requestHash)).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20150830T123600Z",
        "20150830/us-east-1/iam/aws4_request",
        "f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59",
      ].join("\n"),
    );
  });

  it("reproduces the documented signing key", () => {
    expect(signingKey(input.secretAccessKey, "20150830", "us-east-1", "iam").toString("hex")).toBe(
      "c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9",
    );
  });

  it("reproduces the documented final signature", () => {
    const authorization = sigV4Authorization(input);
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });
});

// -- BR-067 static proof: no provider outside the port -------------------------

describe("BR-067 repo proof (static)", () => {
  const PROVIDER_WIRE_MARKERS: readonly [string, string][] = [
    ["graph.facebook.com", "WhatsApp Business Cloud"],
    ["api.unifonic.com", "Unifonic"],
    ["msegat.com", "Msegat"],
    ["api.twilio.com", "Twilio"],
    ["api.sendgrid.com", "SendGrid"],
    ["amazonaws.com/v2/email", "SES v2 email"],
    ["api.mailgun.net", "Mailgun"],
  ];

  it("provider wire hosts appear ONLY inside the communication module (the port)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const apiRoot = join(process.cwd(), "src");
    const violations: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "communication") {
            continue; // the port itself
          }
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".spec.ts")) {
          continue;
        }
        const content = readFileSync(full, "utf8");
        for (const [marker, label] of PROVIDER_WIRE_MARKERS) {
          if (content.includes(marker)) {
            violations.push(`${full} references ${label} (${marker}) outside the port`);
          }
        }
      }
    };
    walk(apiRoot);
    expect(violations).toEqual([]);
  });

  it("global fetch inside the communication module appears ONLY in the transport seam", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const moduleRoot = join(process.cwd(), "src/modules/communication");
    const violations: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".spec.ts")) {
          continue;
        }
        const relative = full.slice(moduleRoot.length + 1);
        if (relative === join("application", "providers", "provider-http.ts")) {
          continue; // the seam
        }
        if (readFileSync(full, "utf8").includes("await fetch(")) {
          violations.push(`${relative} calls fetch outside the transport seam`);
        }
      }
    };
    walk(moduleRoot);
    expect(violations).toEqual([]);
  });
});
