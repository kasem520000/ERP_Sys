import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient } from "../test-db";
import { withTenant, requireTenantContext } from "../../infra/db/tenant-context";
import { computePdcCalendar, foldPdcCalendar } from "../../modules/notes/application/pdc-calendar-queries";
import type { CalendarNoteView } from "../../modules/notes/infrastructure/notes.store";

/**
 * PHASE-027 §6 performance bound: a 100k-note tenant's calendar refresh is
 * p95 < 30 s (the phase's target; measured, never guessed). The fixture
 * bulk-inserts 100,000 live notes via generate_series (one statement — the
 * embedded PG handles it in seconds), then times the compute fold across 5
 * runs; p95 of the 5 run times is asserted < 30,000 ms with the measured
 * value reported in the completion evidence.
 */

const TENANT_P = "b1b1c0de-0270-4000-8000-0000000000f1";
const PARTNER_P = "b1b1c0de-0270-4000-8000-0000000000f2";

describe("PDC calendar volume bound (100k notes, p95 < 30 s)", () => {
  beforeAll(async () => {
    ensureTestDb();
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ($1, 'Calendar Volume Tenant', 'مستأجر حجم التقويم', 'SAR', 'SA', 'Asia/Riyadh')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_P],
    );
    await su.query(
      `INSERT INTO partners (id, tenant_id, code, name, kind, created_at, updated_at)
       VALUES ($2, $1, 'VOL', 'Volume Partner', 'CUSTOMER', now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_P, PARTNER_P],
    );
    // 100,000 live notes in ONE statement: maturity dates spread over ±1 year;
    // 60% RECEIVED / 40% ISSUED; amounts 100..1,000; rate 1.
    await su.query(
      `INSERT INTO notes (id, tenant_id, kind, direction, partner_id, number, issuing_bank,
         amount, currency, exchange_rate, issue_date, maturity_date, status)
       SELECT gen_random_uuid(), $1,
         CASE WHEN g % 3 = 0 THEN 'CHEQUE' ELSE 'PROMISSORY_NOTE' END,
         CASE WHEN g % 5 < 3 THEN 'RECEIVED' ELSE 'ISSUED' END,
         $2,
         'VOL-' || g,
         CASE WHEN g % 4 = 0 THEN 'Bank A' WHEN g % 4 = 1 THEN 'Bank B' ELSE NULL END,
         (100 + (g % 900))::numeric,
         'SAR', 1,
         (DATE '2026-01-01' + (g % 90))::date,
         (DATE '2026-01-01' + (g % 720))::date,
         'IN_CUSTODY'
       FROM generate_series(1, 100000) AS g`,
      [TENANT_P, PARTNER_P],
    );
    await su.end();
  });

  afterAll(async () => {
    const su = await superuserClient();
    await su.query(`DELETE FROM notes WHERE tenant_id = $1`, [TENANT_P]);
    await su.query(`DELETE FROM partners WHERE tenant_id = $1`, [TENANT_P]);
    await su.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_P]);
    await su.end();
  });

  it("computePdcCalendar folds 100k notes with p95 < 30 s", { timeout: 120_000 }, async () => {
    await withTenant(TENANT_P, async () => {
      void requireTenantContext();
      const timings: number[] = [];
      let snapshot: ReturnType<typeof foldPdcCalendar> | undefined;
      for (let run = 0; run < 5; run += 1) {
        const startedAt = Date.now();
        snapshot = await computePdcCalendar({ tenantId: TENANT_P, asOf: "2026-06-01" });
        timings.push(Date.now() - startedAt);
      }
      // p95 over 5 runs (integral sort — no Math.*).
      const ordered = [...timings].sort((a, b) => a - b);
      const p95 = ordered[4]!;
      expect(p95).toBeLessThan(30_000);
      // Sanity: the fold actually saw the population (all live, spread over
      // the buckets) — Σ counts == 100,000 across both directions.
      const total =
        snapshot!.buckets.received.overdue.count +
        snapshot!.buckets.received.thisWeek.count +
        snapshot!.buckets.received.d30.count +
        snapshot!.buckets.received.d60.count +
        snapshot!.buckets.received.d90.count +
        snapshot!.buckets.received.beyond.count +
        snapshot!.buckets.issued.overdue.count +
        snapshot!.buckets.issued.thisWeek.count +
        snapshot!.buckets.issued.d30.count +
        snapshot!.buckets.issued.d60.count +
        snapshot!.buckets.issued.d90.count +
        snapshot!.buckets.issued.beyond.count;
      expect(total).toBe(100_000);
      expect(snapshot!.drill.byBank.length).toBeGreaterThan(0);
      void (undefined as unknown as CalendarNoteView);
    });
  });
});
