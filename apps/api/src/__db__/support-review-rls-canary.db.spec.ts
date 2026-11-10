import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { closeDb } from "../infra/db/client";
import { AuditService } from "../modules/audit/application/audit.service";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { SupportAccessService } from "../modules/tenancy/application/support-access-service";
import { PasswordService } from "../modules/identity/application/password-service";
import * as identityStore from "../modules/identity/infrastructure/identity.store";
import { runRlsCanary } from "../infra/security/rls-canary";
import { withPlatformScope } from "../infra/db/tenant-context";

/**
 * PHASE-024 T12 + the RLS canary (SECURITY_TEST_PLAN §3):
 * - the support-access review report over a staged window — every session
 *   with grant + end + proxied-read counts + the explicit gap list
 *   (an expired-unclosed session and a zero-action session are staged on
 *   purpose; the report must name both);
 * - the no-GUC canary run against a SEEDED stack — 0 rows on every
 *   crown-jewel probe (the erp_rls_denials_total contract).
 */

const audit = new AuditService(new DrizzleAuditStore());
const support = new SupportAccessService(audit);

let tenantId: string;
let platformAdminId: string;

async function seedSupportSession(input: {
  optIn: boolean;
  ticketRef: string | null;
  expiresAt: Date;
  closed: boolean;
}): Promise<string> {
  const su = await superuserClient();
  const id = generateUuidV7();
  await su.query(
    `INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, ticket_ref, reason,
        opened_at, expires_at, closed_at, closed_by, status)
     VALUES ($1, $2, $3, $4, $5, 'review drill fixture', now() - interval '2 hours', $6,
        $7, $8, $9)`,
    [
      id,
      tenantId,
      platformAdminId,
      input.optIn,
      input.ticketRef,
      input.expiresAt.toISOString(),
      input.closed ? new Date().toISOString() : null,
      input.closed ? platformAdminId : null,
      input.closed ? "CLOSED" : "ACTIVE",
    ],
  );
  await su.end();
  return id;
}

async function stageProxyRead(sessionId: string): Promise<void> {
  await withPlatformScope(async () => {
    await audit.recordPlatform({
      action: "support.session.action",
      entityType: "support_session",
      entityId: sessionId,
      actorId: platformAdminId,
      after: { resource: "users", via: "support-proxy" },
    });
  });
}

/** What SupportAccessService.open() itself records — the discovery index. */
async function stageOpenedEvent(sessionId: string): Promise<void> {
  const { withTenant } = await import("../infra/db/tenant-context");
  await withTenant(tenantId, async () => {
    await audit.record({
      action: "support.session.opened",
      entityType: "support_session",
      entityId: sessionId,
      actorId: platformAdminId,
      after: { via: "review-drill-fixture" },
    });
  });
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  tenantId = generateUuidV7();
  await su.query(
    `INSERT INTO tenants (id, name, base_currency, country_code, timezone) VALUES ($1, 'Support Review Tenant', 'SAR', 'SA', 'Asia/Riyadh')`,
    [tenantId],
  );
  await su.end();
  // A platform-admin user for the support grant rows (this spec runs in
  // isolation — no other spec's users exist).
  const password = new PasswordService();
  const hash = await password.hashFromNewPassword("support-review-pass-9");
  const admin = await identityStore.insertUser({
    email: `support-review-${generateUuidV7().slice(0, 8)}@fixture.test`,
    fullName: "Support Review Admin",
    passwordHash: hash,
    status: "ACTIVE",
  });
  platformAdminId = admin.id;
});

afterAll(async () => {
  await closeDb();
});

describe("support-access review report over a staged window (T12; matrix §7)", () => {
  it("names the grant, the end, the read counts — and the staged gaps", async () => {
    // Session 1: closed ticket session WITH proxied reads (clean).
    const clean = await seedSupportSession({
      optIn: false,
      ticketRef: "REVIEW-1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      closed: true,
    });
    await stageOpenedEvent(clean);
    await stageProxyRead(clean);
    await stageProxyRead(clean);

    // Session 2: opened, never closed, already expired (the gap class the
    // lazy write-back should have caught).
    const expired = await seedSupportSession({
      optIn: true,
      ticketRef: null,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      closed: false,
    });
    await stageOpenedEvent(expired);

    // Session 3: opt-in, live, but never proxied a read (zero-action gap).
    const zeroAction = await seedSupportSession({
      optIn: true,
      ticketRef: null,
      expiresAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
      closed: false,
    });
    await stageOpenedEvent(zeroAction);

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 1000).toISOString();
    const report = await support.reviewReport({ fromAt: from, toAt: to });

    expect(report.sessions.length).toBeGreaterThanOrEqual(3);
    const cleanRow = report.sessions.find((row) => row.id === clean);
    expect(cleanRow).toBeDefined();
    expect(cleanRow!.proxiedReads).toBe(2);
    expect(cleanRow!.status).toBe("CLOSED");

    const gapKinds = report.gaps.map((gap) => gap.kind).sort();
    expect(gapKinds).toContain("expired-unclosed");
    expect(gapKinds).toContain("zero-action");
    expect(report.fullyAudited).toBe(false);
  });
});

describe("RLS denial canary (SECURITY_TEST_PLAN §3; RISK-010)", () => {
  it("no-GUC probes return 0 rows on a seeded stack — erp_rls_denials_total stays 0", async () => {
    // Seed tenant-owned rows the probes must NOT see.
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES ($1, $2, 'general.default_locale', '"ar"'::jsonb)`,
      [generateUuidV7(), tenantId],
    );
    await su.end();

    const result = await runRlsCanary();
    expect(result.checked).toBeGreaterThanOrEqual(12);
    expect(result.breaches).toEqual([]);
    expect(result.rlsDenialsTotal).toBe(0);
  });
});
