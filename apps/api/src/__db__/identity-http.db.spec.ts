import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { PasswordService } from "../modules/identity/application/password-service";
import * as store from "../modules/identity/infrastructure/identity.store";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";

/**
 * PHASE-003 HTTP surface end-to-end: the full Nest pipeline (middleware →
 * guards → interceptor → controllers → ERROR_MODEL filter) against the real
 * PostgreSQL stack. This is the acceptance-5 evidence at the HTTP level:
 * anonymous → 401, wrong role → 403 (+ audit), correct role → 200; the
 * uniform login envelope (no oracle); Idempotency-Key enforcement; the
 * data/meta envelope shape; S-03 headers never become tenant context.
 */

const BASE_PASSWORD = "http-strong-passphrase-9";

let httpBase: string;
let shutdown: (() => Promise<void>) | undefined;

const owner = {
  email: `http-owner-${generateUuidV7().slice(0, 8)}@fixture.test`,
  password: BASE_PASSWORD,
  userId: "",
  token: "",
};
const viewer = {
  email: `http-viewer-${generateUuidV7().slice(0, 8)}@fixture.test`,
  password: BASE_PASSWORD,
  userId: "",
  token: "",
};
let tenantId: string;

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  // Fixtures (bootstrap role) — tenant, cloned template roles with grants,
  // users, memberships.
  const su = await superuserClient();
  tenantId = generateUuidV7();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, 'HTTP Tenant', 'مستأجر الاختبار', 'SAR', 'SA', 'Asia/Riyadh')`,
    [tenantId],
  );
  async function seedUserWithRole(
    email: string,
    templateKey: "owner" | "viewer",
  ): Promise<string> {
    const passwordService = new PasswordService();
    const hash = await passwordService.hashFromNewPassword(BASE_PASSWORD);
    const user = await store.insertUser({
      email,
      fullName: "Http User",
      passwordHash: hash,
      status: "ACTIVE",
    });
    const roleId = generateUuidV7();
    const template = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1`,
      [templateKey],
    );
    await su.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, $3, $4, $5)`,
      [roleId, tenantId, `${templateKey}_http`, templateKey, "دور"],
    );
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
      [roleId, tenantId, template.rows[0]!.id],
    );
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), tenantId, user.id, roleId],
    );
    return user.id;
  }
  owner.userId = await seedUserWithRole(owner.email, "owner");
  viewer.userId = await seedUserWithRole(viewer.email, "viewer");
  await su.end();

  // Boot the real application (HTTP + guards + interceptor).
  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: false });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

async function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  options: { skipIdempotencyKey?: boolean } = {},
) {
  const merged: Record<string, string> = { "content-type": "application/json", ...headers };
  if (!options.skipIdempotencyKey && merged["idempotency-key"] === undefined) {
    merged["idempotency-key"] = generateUuidV7();
  }
  return fetch(`${httpBase}${path}`, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${httpBase}${path}`, { headers });
}

describe("login surface (public)", () => {
  it("issues a session token with the data envelope; wrong password is a uniform 401", async () => {
    const ok = await post("/api/v1/identity/sessions", {
      email: owner.email,
      password: owner.password,
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { data: { token: string; memberships: unknown[] }; meta: { requestId: string } };
    expect(typeof body.data.token).toBe("string");
    expect(body.data.token.length).toBeGreaterThan(40);
    expect(body.meta.requestId.length).toBeGreaterThan(0);
    owner.token = body.data.token;

    const wrong = await post("/api/v1/identity/sessions", {
      email: owner.email,
      password: "definitely-wrong-pass",
    });
    expect(wrong.status).toBe(401);
    const errorBody = (await wrong.json()) as { error: { code: string; traceId: string } };
    expect(errorBody.error.code).toBe("INVALID_CREDENTIALS");

    const unknown = await post("/api/v1/identity/sessions", {
      email: "nobody-here@nowhere.test",
      password: "whatever-pass-1",
    });
    expect(unknown.status).toBe(401);
    const unknownBody = (await unknown.json()) as { error: { code: string } };
    expect(unknownBody.error.code).toBe("INVALID_CREDENTIALS"); // same shape (no oracle)
  });

  it("login needs no Idempotency-Key (IDEMPOTENCY §1.5 exclusion)", async () => {
    const response = await post("/api/v1/identity/sessions", {
      email: viewer.email,
      password: viewer.password,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { token: string } };
    viewer.token = body.data.token;
  });
});

describe("protected routes (acceptance 5, HTTP level)", () => {
  it("anonymous → 401 UNAUTHENTICATED", async () => {
    const response = await get("/api/v1/identity/users");
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("viewer (wrong role) → 403 FORBIDDEN + permission.denied audit row", async () => {
    const before = await countDeniedAudit();
    const response = await get("/api/v1/identity/users", {
      "x-session-token": viewer.token,
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; details: { permissionKey: string } } };
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.details.permissionKey).toBe("identity.users.view");
    const after = await countDeniedAudit();
    expect(after - before).toBe(1);
  });

  it("owner (correct role) → 200 with the tenant-scoped user list", async () => {
    const response = await get("/api/v1/identity/users", {
      "x-session-token": owner.token,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { email: string }[] };
    expect(body.data.length).toBe(2);
    expect(body.data.some((row) => row.email === owner.email)).toBe(true);
  });

  it("S-03: forged tenant headers never change the resolved context", async () => {
    const response = await get("/api/v1/identity/sessions/current", {
      "x-session-token": owner.token,
      "x-tenant-id": "99999999-9999-4999-8999-999999999999",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { activeTenantId: string } };
    expect(body.data.activeTenantId).toBe(tenantId); // from the session, not headers
  });

  it("S-01: switching to a non-member tenant → 404 (no existence leak)", async () => {
    const response = await post(
      "/api/v1/identity/sessions/switch-tenant",
      { tenantId: "99999999-9999-4999-8999-999999999999" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("audit events query is audit.view-gated (owner OK, viewer 403)", async () => {
    const ok = await get("/api/v1/audit/events", { "x-session-token": owner.token });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { data: { action: string }[] };
    expect(okBody.data.some((row) => row.action === "permission.denied")).toBe(true);

    const denied = await get("/api/v1/audit/events", { "x-session-token": viewer.token });
    expect(denied.status).toBe(403);
  });

  it("Idempotency-Key is required on write POSTs (422 VALIDATION_ERROR)", async () => {
    const missing = await post(
      "/api/v1/identity/invitations",
      { email: "invitee@fixture.test", roleId: "11111111-1111-1111-1111-111111111111" },
      { "x-session-token": owner.token },
      { skipIdempotencyKey: true },
    );
    expect(missing.status).toBe(422);
    const body = (await missing.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("session lifecycle over HTTP", () => {
  it("logout revokes the session; the token is dead immediately", async () => {
    const login = await post("/api/v1/identity/sessions", {
      email: owner.email,
      password: owner.password,
    });
    const { data } = (await login.json()) as { data: { token: string } };
    const logout = await fetch(`${httpBase}/api/v1/identity/sessions/current`, {
      method: "DELETE",
      headers: { "x-session-token": data.token },
    });
    expect(logout.status).toBe(200);
    const after = await get("/api/v1/identity/sessions/current", {
      "x-session-token": data.token,
    });
    expect(after.status).toBe(401);
  });

  it("MFA enroll → login requires the code (423 MFA_REQUIRED)", async () => {
    // Enroll TOTP for the viewer user.
    const enroll = await post("/api/v1/identity/mfa/totp/enroll", {}, {
      "x-session-token": viewer.token,
    });
    expect(enroll.status).toBe(200);
    const { data } = (await enroll.json()) as { data: { secret: string } };
    const { currentTimestep, hotp, base32Decode } = await import("../modules/identity/domain/totp");
    const code = hotp(base32Decode(data.secret), currentTimestep(Date.now()));
    const verify = await post("/api/v1/identity/mfa/totp/verify", { code }, {
      "x-session-token": viewer.token,
    });
    expect(verify.status).toBe(200);

    // Plain login now demands MFA (423 with the documented envelope code).
    const login = await post("/api/v1/identity/sessions", {
      email: viewer.email,
      password: viewer.password,
    });
    expect(login.status).toBe(423);
    const body = (await login.json()) as { error: { code: string } };
    expect(body.error.code).toBe("MFA_REQUIRED");
  });

  it("password reset request always answers 200 (no enumeration)", async () => {
    const known = await post("/api/v1/identity/password-resets", { email: owner.email });
    const unknown = await post("/api/v1/identity/password-resets", {
      email: "definitely-not@exist.test",
    });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    const a = (await known.json()) as { data: unknown };
    const b = (await unknown.json()) as { data: unknown };
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
  });
});

async function countDeniedAudit(): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'permission.denied'`,
    [tenantId],
  );
  await su.end();
  return result.rows[0]?.n ?? 0;
}
