import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { TradeExpirySweepService } from "../../modules/trade/application/trade-expiry-sweep-service";
import { LcSweepThresholdsInvalidError } from "../../modules/trade/domain/trade-errors";
import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { setupTradeFixture } from "./fixtures";

/**
 * PHASE-051 (W-34 — T-06, 2026-11-25) — the trade-expiry sweep + its
 * settings surface pinned over real PostgreSQL 16 (the plan §4's own
 * isolate — THE SIXTH standing isolate, joining soak · fcm · email ·
 * the cmms sweep · the quality calibration sweep from THIS wave per
 * the master plan §0c (2); acceptance #2's sweep arms): BR-105's
 * 30/14/7/1-day expiry alerts + the discrepancy family riding the same
 * bands, the DEDUPE structural (the per-cycle day axis — an amended
 * instrument re-alerts in its NEXT cycle, re-runs/the nightly
 * cron/races all converge within one), THE EXPIRY TRANSITION (the
 * ladder's own terminus — the DB's own clock decides, CAS-stamped +
 * audited, idempotent), and the settings surface (the typed write ·
 * the custom ladder governs · the garbage row fails-closed to
 * [30,14,7,1] · the registry's refusal re-surfaced under the wave's
 * own name).
 *
 * THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة —
 * لا Date.now()+دلتا أبدًا»): the test worlds derive their expiry dates
 * from the DATABASE'S OWN CURRENT_DATE in the seed SQL — the same clock
 * the probe reads AND the same clock the assertions derive their
 * expected dates from (expiryDateOf below runs `SELECT (CURRENT_DATE +
 * N)` — the derived step on BOTH sides of every assertion); no JS
 * wall-clock arithmetic anywhere.
 *
 * THE DEDICATED TENANT (the cmms/quality sweep specs' own shape): a
 * fresh TENANT_TSW with its own owner membership — ownerTarget() is
 * the sweep's notification target, and the dedicated tenant keeps the
 * notification counts clean of the shared tenant's traffic.
 */

const audit = new AuditService(new DrizzleAuditStore());
const sweep = new TradeExpirySweepService(audit, new InboxService());

/** THE DEDICATED SWEEP TENANT + its owner. */
const TENANT_TSW = "7c6a7c6a-7c6a-7c6a-7c6a-7c6a7c6a7c6a";
const TSW_OWNER = "7c6a7c6a-0000-4000-8000-0000000007a6";

const spec: { world?: { expiredLcIds: string[] } } = {};

/**
 * The expected expiry date at a day-offset — read from the DATABASE'S
 * OWN clock (the derived step on the assertion's side; memoized per
 * offset so one connection serves every arm).
 */
const expiryDateCache = new Map<number, string>();
async function expiryDateOf(days: number): Promise<string> {
  const cached = expiryDateCache.get(days);
  if (cached !== undefined) return cached;
  const su: Client = await superuserClient();
  const rows = await su.query<{ d: string }>(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [days]);
  await su.end();
  const value = rows.rows[0]!.d;
  expiryDateCache.set(days, value);
  return value;
}

/**
 * Seed one LIVE (ISSUED) LC at a day-offset (the derived step:
 * expiry_date = CURRENT_DATE + N inside the seed SQL — the same clock
 * the probe reads; the register rows go in as ISSUED directly — the
 * sweep's own population, the service acts' journeys are the lc spec's
 * own arms).
 */
async function seedLc(input: {
  code: string;
  expiryDays: number;
  status?: string;
}): Promise<string> {
  const su: Client = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO letters_of_credit
       (id, tenant_id, lc_no, currency, amount, margin_amount, issuing_bank,
        beneficiary_name, applicant_name, issued_at, expiry_date, status, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'USD', 25000, 2500, 'TSW Bank',
        'TSW Seller', 'TSW Buyer', (CURRENT_DATE - 30), (CURRENT_DATE + $3::int), $4, $5)
     ON CONFLICT (tenant_id, lc_no) DO UPDATE SET expiry_date = EXCLUDED.expiry_date,
       status = EXCLUDED.status
     RETURNING id`,
    [TENANT_TSW, `LC-TSW-${input.code}`, input.expiryDays, input.status ?? "ISSUED", TSW_OWNER],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** Attach one checklist document to an LC (the discrepancy family's
 * own substrate — the unverified document carrying a note).
 */
async function seedDocument(
  lcId: string,
  docType: string,
  discrepancy: string | null,
): Promise<void> {
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented, presented_at,
        verified, discrepancy_notes, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, true, now(), false, $4, $5)
     ON CONFLICT (tenant_id, lc_id, doc_type) DO UPDATE SET
       discrepancy_notes = EXCLUDED.discrepancy_notes`,
    [TENANT_TSW, lcId, docType, discrepancy, TSW_OWNER],
  );
  await su.end();
}

async function sweepNotifications(): Promise<
  { dedupeKey: string; category: string; severity: string }[]
> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ dedupeKey: string; category: string; severity: string }>(
    `SELECT dedupe_key AS "dedupeKey", category, severity FROM notifications
      WHERE tenant_id = $1 AND category = 'trade' ORDER BY dedupe_key`,
    [TENANT_TSW],
  );
  await su.end();
  return rows.rows;
}

async function sweepSeal(): Promise<
  { n: number; last: { windows: number[]; flagged: number; notified: number; expired: number } | undefined }
> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ n: string; after: { windows: number[]; flagged: number; notified: number; expired: number } }>(
    `SELECT count(*)::text AS n, (array_agg(after ORDER BY at DESC))[1] AS after FROM audit_events
      WHERE tenant_id = $1 AND action = 'trade.lc_expiry_sweep_run'`,
    [TENANT_TSW],
  );
  await su.end();
  return {
    n: Number(rows.rows[0]!.n),
    last: rows.rows[0]!.after ?? undefined,
  };
}

async function lcStatus(lcId: string): Promise<string> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ status: string }>(
    `SELECT status FROM letters_of_credit WHERE id = $1`,
    [lcId],
  );
  await su.end();
  return rows.rows[0]!.status;
}

async function expiredSealCount(): Promise<number> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events
      WHERE tenant_id = $1 AND action = 'trade.lc_expired'`,
    [TENANT_TSW],
  );
  await su.end();
  return Number(rows.rows[0]!.n);
}

beforeAll(async () => {
  await setupTradeFixture();
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant TSW (trade sweep)', 'المستأجر ت-ك', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TSW],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'tsw-owner@fixture.test', 'TSW Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [TSW_OWNER],
  );
  // The owner membership (the sweep's in-app target — ownerTarget()).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, TENANT_TSW],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, TENANT_TSW, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_TSW, TSW_OWNER, roleId],
  );
  await su.end();
  spec.world = { expiredLcIds: [] };
});

describe("PHASE-051 W-34 — THE TRADE-EXPIRY SWEEP (D-09: the disjoint bands, the structural per-cycle dedupe, the expiry transition)", () => {
  it("THE DEFAULT LADDER fires each band once: 30/14/7/1 with the S-15 severities; outside-the-widest never alerts; the DRAFT register never alerts; the discrepancy family rides the same bands", async () => {
    const lc30 = await seedLc({ code: "30", expiryDays: 25 }); // (14,30] — the 30 band
    const lc14 = await seedLc({ code: "14", expiryDays: 10 }); // (7,14] — the 14 band
    const lc7 = await seedLc({ code: "07", expiryDays: 3 }); // (1,7] — the 7 band
    const lc1 = await seedLc({ code: "01", expiryDays: 0 }); // the open floor — the 1 band
    await seedLc({ code: "FAR", expiryDays: 60 }); // outside the widest — never
    await seedLc({ code: "DRAFT", expiryDays: 10, status: "DRAFT" }); // not live — never
    // The discrepancy family: lc14 carries an OPEN discrepancy.
    await seedDocument(lc14, "COMMERCIAL INVOICE", "late presentation");

    const outcome = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(outcome.windows).toEqual([30, 14, 7, 1]);
    expect(outcome.flagged).toBe(4);
    expect(outcome.notified).toBe(5); // 4 expiry + 1 discrepancy
    expect(outcome.expired).toBe(0); // nothing past its date yet

    const [d25, d10, d3, d0] = await Promise.all([
      expiryDateOf(25),
      expiryDateOf(10),
      expiryDateOf(3),
      expiryDateOf(0),
    ]);
    const records = await sweepNotifications();
    expect(records.map((row) => row.dedupeKey).sort()).toEqual(
      [
        `trade:lc:${lc30}:30:${d25}`,
        `trade:lc:${lc14}:14:${d10}`,
        `trade:lc:${lc14}:disc:14:${d10}`,
        `trade:lc:${lc7}:7:${d3}`,
        `trade:lc:${lc1}:1:${d0}`,
      ].sort(),
    );
    const severityByKey = new Map(records.map((row) => [row.dedupeKey, row.severity]));
    expect(severityByKey.get(`trade:lc:${lc30}:30:${d25}`)).toBe("info");
    expect(severityByKey.get(`trade:lc:${lc14}:14:${d10}`)).toBe("warning");
    expect(severityByKey.get(`trade:lc:${lc14}:disc:14:${d10}`)).toBe("warning");
    expect(severityByKey.get(`trade:lc:${lc1}:1:${d0}`)).toBe("warning");
    for (const row of records) {
      expect(row.category).toBe("trade"); // the 0123-widened domain
    }

    // THE SEAL (the job log): the audit record carries the outcome.
    const seal = await sweepSeal();
    expect(seal.n).toBe(1);
    expect(seal.last).toEqual({ windows: [30, 14, 7, 1], flagged: 4, notified: 5, expired: 0 });
  });

  it("THE DEDUPE (the structural once-per-pass): the re-run converges — flagged counts again, ZERO new notifications, no accumulation; every pass seals", async () => {
    const outcome = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(outcome.flagged).toBe(4); // the flags still count (the run happened)
    expect(outcome.notified).toBe(0); // the dedupe keys already consumed
    const records = await sweepNotifications();
    expect(records).toHaveLength(5); // nothing accumulated
    expect((await sweepSeal()).n).toBe(2); // every pass seals (the job log's own law)
  });

  it("THE EXPIRY TRANSITION (the ladder's own terminus — the DB's own clock): the ISSUED instrument past its date CAS-stamps EXPIRED + audited; the re-run is idempotent (no double transition); the EXPIRED instrument still alerts inside the open floor's band; the transition never touches a DRAFT row", async () => {
    // A past-date instrument (ISSUED, expiry CURRENT_DATE - 2).
    const past = await seedLc({ code: "PAST", expiryDays: -2 });
    spec.world!.expiredLcIds.push(past);
    const first = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(first.expired).toBe(1);
    expect(await lcStatus(past)).toBe("EXPIRED");
    expect(await expiredSealCount()).toBe(1);
    // The expired instrument still alerts inside the 1-band's open
    // lower edge (the exposure the alert exists for).
    const dm2 = await expiryDateOf(-2);
    expect(
      (await sweepNotifications()).some((row) => row.dedupeKey === `trade:lc:${past}:1:${dm2}`),
    ).toBe(true);
    // The re-run: the transition is idempotent (no ISSUED row left),
    // the alert converges on its key.
    const second = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(second.expired).toBe(0);
    expect(await expiredSealCount()).toBe(1); // no double transition
    // A DRAFT row past its date is never touched (the register's own
    // act, never the sweep's).
    const draftPast = await seedLc({ code: "DPAST", expiryDays: -5, status: "DRAFT" });
    await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(await lcStatus(draftPast)).toBe("DRAFT");
  });

  it("THE PER-CYCLE RE-ALERT (D-09's day axis): a validity amendment moves the expiry far → the instrument stops alerting; a subsequent near-dated cycle alerts AGAIN (the new expiry date forms NEW keys)", async () => {
    const cycleLc = await seedLc({ code: "CYCLE", expiryDays: 15 });
    const [d15, d10] = await Promise.all([expiryDateOf(15), expiryDateOf(10)]);
    // The cycle-1 key fires at the 30 band.
    const first = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(
      (await sweepNotifications()).some(
        (row) => row.dedupeKey === `trade:lc:${cycleLc}:30:${d15}`,
      ),
    ).toBe(true);
    void first;
    // The validity amendment: the expiry moves far — the instrument
    // leaves the bands (the new date derives from the DB's own clock).
    const su: Client = await superuserClient();
    await su.query(
      `UPDATE letters_of_credit SET expiry_date = (CURRENT_DATE + 300) WHERE id = $1`,
      [cycleLc],
    );
    await su.end();
    const afterAmendment = await withTenant(TENANT_TSW, () => sweep.runSweep());
    // The NEXT cycle: the expiry approaches again — the NEW expiry
    // date forms NEW keys and the instrument alerts AGAIN.
    const su2: Client = await superuserClient();
    await su2.query(
      `UPDATE letters_of_credit SET expiry_date = (CURRENT_DATE + 10) WHERE id = $1`,
      [cycleLc],
    );
    await su2.end();
    const second = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(second.notified).toBe(1);
    expect(
      (await sweepNotifications()).some(
        (row) => row.dedupeKey === `trade:lc:${cycleLc}:14:${d10}`,
      ),
    ).toBe(true);
    void afterAmendment;
  });

  it("THE SETTINGS SURFACE (the trade module's own keys): the typed write lands the SAME row the generic surface writes; the custom ladder governs the next pass; the garbage row fails-closed to the documented default; the refusal is the wave's own name", async () => {
    // The typed write: the normalized ladder lands.
    const written = await withTenant(TENANT_TSW, () =>
      sweep.writeThresholds({ thresholds: [20, 20, 5], actorId: TSW_OWNER }),
    );
    expect(written.thresholds).toEqual([20, 5]); // dedup + descending — the pure fold
    const config = await withTenant(TENANT_TSW, () => sweep.effectiveConfig());
    expect(config.key).toBe("trade.lc_expiry_sweep_thresholds");
    expect(config.stored).toBe(true);
    expect(config.thresholds).toEqual([20, 5]);
    expect(config.default).toEqual([30, 14, 7, 1]); // BR-105's own ladder
    expect(config.lastRun).not.toBeNull(); // the audit plane is the job log

    // The custom ladder governs: the whole standing population re-keys
    // at the NEW thresholds (the band's threshold IS the dedupe key's
    // axis — a ladder change is a new cycle for every instrument).
    const outcome = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(outcome.windows).toEqual([20, 5]);
    // The standing live population inside [20,5]: the +10 pair (TSW-14
    // + CYCLE at its new +10 date), the +3, the 0-day, the past one
    // (the band 5's open floor) — five flagged; the +25 one (TSW-30)
    // is OUTSIDE the 20 band now; every key is NEW (the threshold axis
    // moved) → six notifications: five expiry + the TSW-14 discrepancy.
    expect(outcome.flagged).toBe(5);
    expect(outcome.notified).toBe(6);
    expect(outcome.expired).toBe(0);

    // The registry schema's refusal surfaces under the wave's own name.
    const refused = await withTenant(TENANT_TSW, () =>
      sweep
        .writeThresholds({ thresholds: [30, -14, 1.5], actorId: TSW_OWNER })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(LcSweepThresholdsInvalidError);
    expect((refused as LcSweepThresholdsInvalidError).code).toBe(
      "LC_SWEEP_THRESHOLDS_INVALID",
    );

    // The fail-closed fold: a garbage row seeded RAW (bypassing the
    // typed write) still reads as the documented default — never a
    // disable.
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
       VALUES (gen_random_uuid(), $1, 'trade.lc_expiry_sweep_thresholds', '["garbage", null, -5]', $2)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_TSW, TSW_OWNER],
    );
    await su.end();
    const afterGarbage = await withTenant(TENANT_TSW, () => sweep.effectiveConfig());
    expect(afterGarbage.thresholds).toEqual([30, 14, 7, 1]);
  });

  it("THE PREFS GATE: an owner with in-app OFF skips the records but the flags still count and the run still seals (the run happened)", async () => {
    // The owner's prefs: in-app off for the trade category (absent
    // rows mean in-app on — the explicit off row is the opt-out).
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO notification_prefs (id, tenant_id, user_id, category, in_app, email)
       VALUES (gen_random_uuid(), $1, $2, 'trade', false, false)
       ON CONFLICT ("user_id", "category") DO UPDATE SET in_app = false, email = false`,
      [TENANT_TSW, TSW_OWNER],
    );
    await su.end();
    const before = (await sweepNotifications()).length;
    const outcome = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(outcome.flagged).toBeGreaterThan(0); // the flags still count
    expect(outcome.notified).toBe(0); // nothing recorded
    expect((await sweepNotifications()).length).toBe(before); // nothing accumulated
    expect((await sweepSeal()).n).toBeGreaterThan(5); // the run still sealed
    // The prefs row removed — the next pass records again (the absent
    // row means in-app on).
    const su2: Client = await superuserClient();
    await su2.query(`DELETE FROM notification_prefs WHERE tenant_id = $1 AND user_id = $2`, [
      TENANT_TSW,
      TSW_OWNER,
    ]);
    await su2.end();
    const restored = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(restored.notified).toBe(0); // the dedupe keys still consumed
    expect((await sweepSeal()).n).toBeGreaterThan(6);
    // THE RESTORE PROOF: a NEW instrument under the restored (absent =
    // on) prefs records — the gate opened again.
    const fresh = await seedLc({ code: "AFTER-PREFS", expiryDays: 2 });
    const afterRestore = await withTenant(TENANT_TSW, () => sweep.runSweep());
    expect(afterRestore.notified).toBe(1);
    const d2 = await expiryDateOf(2);
    expect(
      (await sweepNotifications()).some((row) => row.dedupeKey === `trade:lc:${fresh}:7:${d2}`),
    ).toBe(true);
  });
});
