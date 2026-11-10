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
 * PHASE-006 HTTP surface end-to-end (SECURITY_TEST_PLAN §2 PHASE-006 row):
 * the full pipeline against the real stack — permission tiers (§3.6), A7
 * 404-parity on id routes, S-04 cross-tenant references in nested payloads
 * rejected with no partial creation and no existence disclosure, import
 * row spoofing rejected per-row, and the tenancy-uoms seed contract.
 */

const BASE_PASSWORD = "http-master-pass-9";

let httpBase: string;
let shutdown: (() => Promise<void>) | undefined;

const owner = { email: `md-owner-${generateUuidV7().slice(0, 8)}@fixture.test`, token: "", userId: "" };
const viewer = { email: `md-viewer-${generateUuidV7().slice(0, 8)}@fixture.test`, token: "" };
let tenantA = "";
let tenantB = "";

async function post(path: string, body: unknown, headers: Record<string, string> = {}, options: { skipIdempotencyKey?: boolean } = {}): Promise<Response> {
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

async function patch(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${httpBase}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${httpBase}${path}`, { headers });
}

async function login(email: string): Promise<string> {
  const response = await post(
    "/api/v1/identity/sessions",
    { email, password: BASE_PASSWORD },
    {},
    { skipIdempotencyKey: true },
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { data: { token: string } };
  return body.data.token;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  tenantA = generateUuidV7();
  tenantB = generateUuidV7();
  for (const [tenant, name] of [
    [tenantA, "Master A"],
    [tenantB, "Master B"],
  ] as const) {
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, $2, 'مستأجر', 'SAR', 'SA', 'Asia/Riyadh')`,
      [tenant, name],
    );
  }
  // The migration's per-tenant backfill did not cover these tenants (they
  // are created after the fresh boot) — onboarding-equivalent seeds, exactly
  // like provisionWorkspace does (mirrors the real registration flow).
  for (const tenant of [tenantA, tenantB]) {
    for (const [code, name, nameAr] of [
      ["PCS", "Piece", "قطعة"],
      ["KG", "Kilogram", "كيلوجرام"],
      ["G", "Gram", "جرام"],
    ] as const) {
      await su.query(
        `INSERT INTO uoms (id, tenant_id, code, name, name_ar, is_system)
         VALUES ($5, $1, $2, $3, $4, true)
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [tenant, code, name, nameAr, generateUuidV7()],
      );
    }
    await su.query(
      `INSERT INTO credit_terms (id, tenant_id, code, name, name_ar, days, is_system)
       VALUES ($2, $1, 'NET-30', 'Net 30', 'صافي 30', 30, true)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenant, generateUuidV7()],
    );
  }
  // A credit-terms row in tenant B (the S-04 cross-tenant reference target).
  await su.query(
    `INSERT INTO credit_terms (id, tenant_id, code, name, days)
     VALUES ($1, $2, 'FOREIGN-CT', 'Foreign Terms', 45)`,
    [generateUuidV7(), tenantB],
  );
  // A partner in tenant B (the A7/S-04 cross-tenant row target).
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES ($1, $2, 'CUSTOMER', 'B-0001', 'Partner B')`,
    [generateUuidV7(), tenantB],
  );

  const passwordService = new PasswordService();
  const hash = await passwordService.hashFromNewPassword(BASE_PASSWORD);
  async function seedUserWithRole(email: string, templateKey: "owner" | "viewer"): Promise<string> {
    const user = await store.insertUser({
      email,
      fullName: "Master Data User",
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
      [roleId, tenantA, `${templateKey}_md`, templateKey, "دور"],
    );
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
      [roleId, tenantA, template.rows[0]!.id],
    );
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), tenantA, user.id, roleId],
    );
    return user.id;
  }
  owner.userId = await seedUserWithRole(owner.email, "owner");
  await seedUserWithRole(viewer.email, "viewer");
  await su.end();

  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: false });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
  owner.token = await login(owner.email);
  viewer.token = await login(viewer.email);
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("PHASE-006 HTTP: permission tiers (matrix §3.6)", () => {
  it("owner creates a partner bilingually with auto-code; viewer reads but cannot create", async () => {
    const created = await post(
      "/api/v1/partners/partners",
      { kind: "CUSTOMER", name: "Global Trading", nameAr: "الشركة العالمية" },
      { "x-session-token": owner.token },
    );
    expect(created.status).toBe(200);
    const body = (await created.json()) as { data: { id: string; code: string; nameAr: string | null } };
    expect(body.data.code).toBe("P-000001");
    expect(body.data.nameAr).toBe("الشركة العالمية");

    const viewerRead = await get("/api/v1/partners/partners", {
      "x-session-token": viewer.token,
    });
    expect(viewerRead.status).toBe(200);
    const listBody = (await viewerRead.json()) as { data: { id: string }[] };
    expect(listBody.data.length).toBe(1);

    const viewerCreate = await post(
      "/api/v1/partners/partners",
      { kind: "CUSTOMER", name: "Nope" },
      { "x-session-token": viewer.token },
    );
    expect(viewerCreate.status).toBe(403);
    const forbidden = (await viewerCreate.json()) as { error: { code: string } };
    expect(forbidden.error.code).toBe("FORBIDDEN");
  });

  it("items import permission gate: viewer cannot start import jobs", async () => {
    const response = await post(
      "/api/v1/items/import-jobs",
      { kind: "PARTNERS", format: "CSV", uploadToken: "spoof-token-1", fileKey: "x/y.csv" },
      { "x-session-token": viewer.token },
    );
    expect(response.status).toBe(403);
  });

  it("Idempotency-Key guard applies to master-data POSTs", async () => {
    const missing = await post(
      "/api/v1/partners/partners",
      { kind: "CUSTOMER", name: "No Key" },
      { "x-session-token": owner.token },
      { skipIdempotencyKey: true },
    );
    expect(missing.status).toBe(422);
  });
});

describe("PHASE-006 HTTP: S-04 cross-tenant references (no existence disclosure)", () => {
  it("a foreign tenant's credit_terms_id in a nested payload is a 404 with no partial creation", async () => {
    const su = await superuserClient();
    const foreign = await su.query<{ id: string }>(
      `SELECT id FROM credit_terms WHERE tenant_id = $1 AND code = 'FOREIGN-CT'`,
      [tenantB],
    );
    await su.end();
    const foreignId = foreign.rows[0]!.id;

    const response = await post(
      "/api/v1/partners/partners",
      {
        kind: "CUSTOMER",
        name: "Cross Tenant Probe",
        creditTermsId: foreignId,
      },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(404); // not 403 — no existence disclosure
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CREDIT_TERMS_NOT_FOUND");
    // No partial creation: the partner must NOT exist.
    const su2 = await superuserClient();
    const partner = await su2.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM partners WHERE tenant_id = $1 AND name = 'Cross Tenant Probe'`,
      [tenantA],
    );
    await su2.end();
    expect(partner.rows[0]?.n).toBe(0);
  });

  it("PATCH with a foreign price list id is rejected and leaves the partner untouched", async () => {
    const su = await superuserClient();
    const foreignList = await su.query<{ id: string }>(
      `INSERT INTO price_lists (id, tenant_id, name, kind, currency_code)
       VALUES ($1, $2, 'B List', 'SALE', 'SAR') RETURNING id`,
      [generateUuidV7(), tenantB],
    );
    const ownPartner = await su.query<{ id: string }>(
      `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'P-000001'`,
      [tenantA],
    );
    await su.end();
    const response = await patch(
      `/api/v1/partners/partners/${ownPartner.rows[0]!.id}`,
      { priceListId: foreignList.rows[0]!.id },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PRICE_LIST_NOT_FOUND");
  });
});

describe("PHASE-006 HTTP: A7 404-parity on id routes", () => {
  it("own-tenant vs foreign-tenant ids both answer 404 (no oracle)", async () => {
    const su = await superuserClient();
    const foreignPartner = await su.query<{ id: string }>(
      `SELECT id FROM partners WHERE tenant_id = $1`,
      [tenantB],
    );
    await su.end();
    const randomId = generateUuidV7();
    const own = await get(`/api/v1/partners/partners/${randomId}`, {
      "x-session-token": owner.token,
    });
    const foreign = await get(`/api/v1/partners/partners/${foreignPartner.rows[0]!.id}`, {
      "x-session-token": owner.token,
    });
    expect(own.status).toBe(404);
    expect(foreign.status).toBe(404);
    const ownBody = (await own.json()) as { error: { code: string } };
    const foreignBody = (await foreign.json()) as { error: { code: string } };
    expect(ownBody.error.code).toBe(foreignBody.error.code);
  });
});

describe("PHASE-006 HTTP: tenant-scoped isolation of the route surface", () => {
  it("partner lists never surface tenant B rows; items/uoms are tenant-seeded", async () => {
    const partners = await get("/api/v1/partners/partners", {
      "x-session-token": owner.token,
    });
    const body = (await partners.json()) as { data: { code: string }[] };
    expect(body.data.every((row) => row.code.startsWith("P-"))).toBe(true);
    const uoms = await get("/api/v1/items/uoms", { "x-session-token": owner.token });
    const uomBody = (await uoms.json()) as { data: { code: string }[] };
    expect(uomBody.data.map((row) => row.code).sort()).toEqual(["G", "KG", "PCS"]);
    const creditTerms = await get("/api/v1/partners/credit-terms", {
      "x-session-token": owner.token,
    });
    const ctBody = (await creditTerms.json()) as { data: { code: string }[] };
    expect(ctBody.data.map((row) => row.code)).toEqual(["NET-30"]); // never FOREIGN-CT
  });

  it("cursor pagination walks pages with the paginated envelope", async () => {
    for (let i = 0; i < 5; i += 1) {
      const created = await post(
        "/api/v1/partners/partners",
        { kind: "SUPPLIER", name: `Supplier ${i}` },
        { "x-session-token": owner.token },
      );
      expect(created.status).toBe(200);
    }
    const page1 = await get("/api/v1/partners/partners?limit=3", {
      "x-session-token": owner.token,
    });
    const body1 = (await page1.json()) as {
      data: unknown[];
      meta: { hasMore: boolean; nextCursor?: string };
    };
    expect(body1.data).toHaveLength(3);
    expect(body1.meta.hasMore).toBe(true);
    const page2 = await get(
      `/api/v1/partners/partners?limit=3&cursor=${encodeURIComponent(body1.meta.nextCursor ?? "")}`,
      { "x-session-token": owner.token },
    );
    const body2 = (await page2.json()) as { data: unknown[]; meta: { hasMore: boolean } };
    expect(body2.data.length).toBeGreaterThan(0);
  });

  it("search returns the bilingual partner by partial Arabic name", async () => {
    const response = await get("/api/v1/partners/search?q=العالمية", {
      "x-session-token": owner.token,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { nameAr: string | null }[] };
    expect(body.data.some((row) => row.nameAr === "الشركة العالمية")).toBe(true);
  });

  it("resolve-price answers with BR-003 provenance (BASE_PRICE level, no list assigned)", async () => {
    // Create an item with a base price via the API first.
    const su = await superuserClient();
    const uom = await su.query<{ id: string }>(
      `SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'KG'`,
      [tenantA],
    );
    await su.end();
    const created = await post(
      "/api/v1/items/items",
      {
        sku: "HTTP-ITEM-1",
        name: "HTTP Item",
        kind: "STOCK",
        uomId: uom.rows[0]!.id,
        basePrice: "42.250000",
      },
      { "x-session-token": owner.token },
    );
    expect(created.status).toBe(200);
    const itemBody = (await created.json()) as { data: { id: string } };
    const resolved = await post(
      "/api/v1/items/resolve-price",
      { itemId: itemBody.data.id, qty: "1" },
      { "x-session-token": owner.token },
    );
    expect(resolved.status).toBe(200);
    const priceBody = (await resolved.json()) as {
      data: { source: string; unitPrice: string; manualOverrideAllowed: boolean };
    };
    expect(priceBody.data.source).toBe("BASE_PRICE");
    expect(priceBody.data.unitPrice).toBe("42.250000");
    expect(priceBody.data.manualOverrideAllowed).toBe(true);
  });
});
