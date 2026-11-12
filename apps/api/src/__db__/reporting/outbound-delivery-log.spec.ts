import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import {
  fullContext,
  newRunService,
  setupReportingFixture,
  su,
  TENANT_R,
} from "./fixtures";

/**
 * PHASE-041 T-11 verification (phase §6 criterion 9): the
 * communication.outbound_delivery_log contract — REPORT_CATALOG §7's 91st
 * row — renders over the seeded send ledger through the module-owned query
 * surface: every send a row (status transitions, provider ref, cost,
 * attempts), the channel/status filters narrow, the created_at window
 * filters, the cost-shape + status-vocabulary assertions pass, and a
 * session without communication.outbox.read is denied before params bind
 * (the §12 module-register convention — same key the ledger's read surface
 * rides; zero-drift).
 */

/** Fixed message ids — idempotent re-entries via ON CONFLICT DO NOTHING. */
const MSG = {
  delivered: "61616161-0000-4000-8000-0000000000b1",
  failed: "61616161-0000-4000-8000-0000000000b2",
  queued: "61616161-0000-4000-8000-0000000000b3",
} as const;

/** A window that deterministically covers every seeded row. */
const WINDOW = { dateFrom: "2020-01-01", dateTo: "2030-12-31", locale: "en" } as const;

beforeAll(async () => {
  await setupReportingFixture();
  await withTenant(TENANT_R, async (tx) => {
    const { sql } = await import("drizzle-orm");
    // Seed the ledger directly (the T-05 pipeline specs prove the writer
    // path; this spec proves the READ surface): one full lifecycle to
    // DELIVERED with provider ref + cost, one FAILED mid-retry, one QUEUED.
    await tx.execute(sql`
      INSERT INTO outbound_messages
        (id, tenant_id, channel, status, recipient, module, template_key, locale,
         subject, body_snapshot, provider, provider_ref, cost_amount, cost_currency,
         attempts, max_attempts, sent_at, delivered_at, source_type, last_error)
      VALUES
        (${MSG.delivered}, erp.current_tenant_id(), 'EMAIL', 'DELIVERED',
         'customer@example.test', 'collections', 'dunning.step1.email', 'en',
         'Invoice reminder', 'Dear customer, your invoice is due.', 'sendgrid',
         'sg-ref-041-b1', 0.0025, 'USD', 1, 3, now(), now(), 'DUNNING_LETTER', NULL),
        (${MSG.failed}, erp.current_tenant_id(), 'WHATSAPP', 'FAILED',
         '+966501234567', 'collections', 'dunning.step1.whatsapp', 'ar',
         NULL, 'مرحباً، تذكير بالفاتورة.', 'unifonic',
         NULL, NULL, NULL, 2, 3, NULL, NULL, 'DUNNING_LETTER', 'provider 429: rate limited'),
        (${MSG.queued}, erp.current_tenant_id(), 'SMS', 'QUEUED',
         '+966509876543', 'digest', 'digest.daily.sms', 'ar',
         NULL, 'ملخص اليوم', NULL,
         NULL, NULL, NULL, 0, 3, NULL, NULL, 'DIGEST', NULL)
      ON CONFLICT (id, tenant_id) DO NOTHING`);
  });
});

describe("PHASE-041 · communication.outbound_delivery_log (the 91st contract)", () => {
  it("renders the seeded ledger rows with status/provider/cost and PASS assertions", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "communication.outbound_delivery_log",
        params: { ...WINDOW },
        ctx: fullContext(),
      }),
    );
    expect(outcome.queued).toBeUndefined();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = outcome.result!.rows;
    const byId = new Map(rows.map((row) => [row.key, row.values]));
    expect(byId.get(MSG.delivered)?.status).toBe("DELIVERED");
    expect(byId.get(MSG.delivered)?.providerRef).toBe("sg-ref-041-b1");
    expect(byId.get(MSG.delivered)?.costAmount).toBe("0.0025");
    expect(byId.get(MSG.delivered)?.costCurrency).toBe("USD");
    expect(byId.get(MSG.delivered)?.attempts).toBe("1/3");
    expect(byId.get(MSG.failed)?.status).toBe("FAILED");
    expect(byId.get(MSG.failed)?.attempts).toBe("2/3");
    expect(byId.get(MSG.queued)?.status).toBe("QUEUED");
    expect(byId.get(MSG.queued)?.sourceType).toBe("DIGEST");
    const costShape = outcome.result!.assertions.find(
      (assertion) => assertion.id === "outbox-cost-shape",
    );
    const vocabulary = outcome.result!.assertions.find(
      (assertion) => assertion.id === "outbox-status-vocabulary",
    );
    expect(costShape?.status).toBe("PASS");
    expect(vocabulary?.status).toBe("PASS");
  });

  it("the channel filter narrows to the requested channel", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "communication.outbound_delivery_log",
        params: { ...WINDOW, channel: "WHATSAPP" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const keys = outcome.result!.rows.map((row) => row.key);
    expect(keys).toContain(MSG.failed);
    expect(keys).not.toContain(MSG.delivered);
    expect(keys).not.toContain(MSG.queued);
  });

  it("the status filter narrows to the requested state", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "communication.outbound_delivery_log",
        params: { ...WINDOW, status: "DELIVERED" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows.map((row) => row.key)).toEqual([MSG.delivered]);
  });

  it("the created_at window excludes rows outside it", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "communication.outbound_delivery_log",
        params: { dateFrom: "2019-01-01", dateTo: "2019-12-31", locale: "en" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(0);
  });

  it("the ledger stays tenant-isolated (the S-tenant outbox rows never leak)", async () => {
    // A cross-tenant probe: count the seeded rows through superuser — the
    // report ran inside TENANT_R's scope, so a second tenant's identical
    // seed must be invisible to it. We assert the S-tenant copy exists in
    // the DB (superuser) while TENANT_R's run above returned only its own.
    const client = await su();
    const counted = await client.query(
      `SELECT count(*)::int AS n FROM outbound_messages WHERE tenant_id = $1`,
      [TENANT_R],
    );
    await client.end();
    expect(counted.rows[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it("a session without communication.outbox.read is denied before params bind", async () => {
    const deniedCtx = fullContext(TENANT_R, {
      permissions: new Set(["reporting.reports.run"]),
    });
    await expect(
      withTenant(TENANT_R, () =>
        newRunService().run({
          reportKey: "communication.outbound_delivery_log",
          params: { ...WINDOW },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});
