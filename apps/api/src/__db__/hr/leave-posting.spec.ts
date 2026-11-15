import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { LeavePostingService } from "../../modules/hr/application/leave-posting-service";
import { LeaveService } from "../../modules/hr/application/leave-service";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as treasury from "../../modules/treasury/infrastructure/treasury.store";
import * as tenancy from "../../modules/tenancy/infrastructure/tenancy.store";
import { H_ACTOR, setupHrFixture, superuserClient } from "./fixtures";

/**
 * PHASE-045 (T-11) — the goldens G-50/G-51 pinned:
 *
 * - G-50 (the period-end leave-accrual posting, policy-gated): the
 *   BR-055 discipline — OFF by default (the typed refusal while the
 *   hr.leave_accrual_posting policy is unset); with 'post' the monthly
 *   slice's earned-leave value posts EXACTLY (DR SALARIES_EXPENSE · CR
 *   SALARIES_PAYABLE — the payroll family's canonical pair, no new
 *   purposes) at Σ (accrual_days/12 × basic/30); the roster law (the
 *   mid-period joiner earns the month — the hire-month convention; the
 *   pre-period-terminated employee skips); the monthly law (a
 *   multi-month period is the typed refusal); INV-013 exactly-once per
 *   (type, period month);
 * - G-51 (the leave encashment settlement through the payroll payout
 *   machinery): INV-031 AT THE ENCASH BOUNDARY (days ≤ remaining — the
 *   typed refusal BEFORE the decrement, the balance untouched on
 *   refusal); the settlement posts DR SALARIES_PAYABLE · CR CASH + the
 *   treasury movement (source 'payroll_payout', the existing kind —
 *   INV-019 exact: movement.base == the journal's cash line); the
 *   same-transaction decrement lands on the entry date's year cell.
 *
 * The golden world runs on a DEDICATED tenant (LP) with the provisioned
 * CoA template (the 0040/0043 purpose markers — the payroll fixtures'
 * shape) so the postings resolve real purpose mappings and never touch
 * the shared tenants' books.
 */

const TENANT_LP = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7d1d";
const FY_LP = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7d2d";
const PERIOD_LP_MARCH = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7d3d"; // 2026-03-01…31
const FY_LP_FULL = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7d5d"; // a separate year for the multi-month arm
const PERIOD_LP_YEAR = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7d4d"; // 2027-01-01…12-31 (multi-month)

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const leaveSvc = new LeaveService(audit);
const postingSvc = new LeavePostingService(
  audit,
  posting,
  new ResolveEffectiveConfigService(new ConfigRepository()),
);

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

interface PostingFixture {
  employeeE1Id: string;
  employeeE2Id: string;
  leaveTypeId: string;
  bankAccountId: string;
  salariesExpenseAccountId: string;
  salariesPayableAccountId: string;
}

const spec: { fixture?: PostingFixture } = {};

async function setLpSetting(key: string, value: string): Promise<void> {
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_LP, key, JSON.stringify(value)],
  );
  await su.end();
}

async function clearLpSetting(key: string): Promise<void> {
  const su: Client = await superuserClient();
  await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [
    TENANT_LP,
    key,
  ]);
  await su.end();
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await withTenant(TENANT_LP, () => journal.listLines(entryId));
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

beforeAll(async () => {
  await setupHrFixture();
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant LP (leave posting goldens)', 'مستأجر ترحيل الإجازات', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_LP],
  );
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES
       ($1, $2, 'FY2026-LP', '2026-01-01', '2026-12-31'),
       ($3, $2, 'FY2027-LP (the multi-month arm)', '2027-01-01', '2027-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [FY_LP, TENANT_LP, FY_LP_FULL],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status) VALUES
       ($1, $2, $3, 'FY2026-LP-03', 'REGULAR', '2026-03-01', '2026-03-31', 'OPEN'),
       ($4, $2, $5, 'FY2027-LP-FULL', 'REGULAR', '2027-01-01', '2027-12-31', 'OPEN')
     ON CONFLICT (id) DO NOTHING`,
    [PERIOD_LP_MARCH, TENANT_LP, FY_LP, PERIOD_LP_YEAR, FY_LP_FULL],
  );
  // The roster: E1 hired 2026-01-01 (basic 9,000); E2 hired 2026-03-15
  // (the MID-PERIOD JOINER — the hire month counts fully; basic 6,000);
  // E3 terminated 2026-02-10 (BEFORE the period start — skips).
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, status, termination_date, created_by) VALUES
       (gen_random_uuid(), $1, 'LP-E1', 'Layla Al-Posting', '2026-01-01', 'FULL_TIME', 9000, 'ACTIVE', NULL, $2),
       (gen_random_uuid(), $1, 'LP-E2', 'Mona Al-March', '2026-03-15', 'FULL_TIME', 6000, 'ACTIVE', NULL, $2),
       (gen_random_uuid(), $1, 'LP-E3', 'Nabil Al-Gone', '2024-05-01', 'FULL_TIME', 7000, 'TERMINATED', '2026-02-10', $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_LP, H_ACTOR],
  );
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));
  await su.end();

  const { salariesExpenseAccountId, salariesPayableAccountId, bankGlAccountId } =
    await withTenant(TENANT_LP, async () => {
      // The CoA template (the payroll fixtures' provisioning shape) —
      // the 0043 purpose markers map 5270/2170 + the 1121 bank account.
      await tenancy.provisionCoaTemplate();
      const accounts = await tenancy.listAccounts();
      const byCode = new Map(accounts.map((row) => [row.code, row.id]));
      return {
        salariesExpenseAccountId: byCode.get("5270")!,
        salariesPayableAccountId: byCode.get("2170")!,
        bankGlAccountId: byCode.get("1121")!,
      };
    });

  const bank = await withTenant(TENANT_LP, () =>
    treasury.insertCashAccount({
      name: "LP Payout Bank",
      nameAr: "بنك تسديد الإجازات",
      type: "BANK",
      accountId: bankGlAccountId,
      branchId: null,
      currencyCode: "SAR",
      createdBy: H_ACTOR,
    }),
  );

  const leaveType = await withTenant(TENANT_LP, () =>
    leaveSvc.createType({
      code: "LV-LP-ANNUAL",
      name: "Annual leave (G-50/G-51)",
      nameAr: "إجازة سنوية (G-50/G-51)",
      paid: true,
      accrualDaysPerYear: "24.00",
      monthlyGrant: false,
      prorateJoiners: true,
      carryOverCapDays: "0.00",
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  // The 2026 entitlements (the T-07 recompute — E1 24.00, E2 hired March
  // → 10 months × 2.00 = 20.00, E3 terminated → the recompute's own law).
  await withTenant(TENANT_LP, () =>
    leaveSvc.runAccrual({ leaveTypeId: leaveType.id, year: 2026, actorId: H_ACTOR }),
  );

  spec.fixture = {
    employeeE1Id: byCode.get("LP-E1")!,
    employeeE2Id: byCode.get("LP-E2")!,
    leaveTypeId: leaveType.id,
    bankAccountId: bank.id,
    salariesExpenseAccountId,
    salariesPayableAccountId,
  };
});

describe("PHASE-045 T-11 — the goldens: G-50 (the policy-gated accrual posting) + G-51 (the encashment settlement)", () => {
  it("(a) G-50's BR-055 GATE — the policy OFF is the typed refusal; the multi-month period law; the zero-accrual type never posts", async () => {
    const f = spec.fixture!;
    // The policy is UNSET (the registry default 'off') — the typed refusal.
    await clearLpSetting("hr.leave_accrual_posting");
    await expect(
      withTenant(TENANT_LP, () =>
        postingSvc.postAccrual({
          leaveTypeId: f.leaveTypeId,
          periodId: PERIOD_LP_MARCH,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ACCRUAL_POSTING_DISABLED" });

    // Enable the policy — the multi-month period is the typed refusal
    // (the slice is monthly, never a prorated guess).
    await setLpSetting("hr.leave_accrual_posting", "post");
    await expect(
      withTenant(TENANT_LP, () =>
        postingSvc.postAccrual({
          leaveTypeId: f.leaveTypeId,
          periodId: PERIOD_LP_YEAR,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ACCRUAL_PERIOD_INVALID" });

    // A 0-accrual type never posts (the BR-055 law at the posting
    // boundary).
    const zeroType = await withTenant(TENANT_LP, () =>
      leaveSvc.createType({
        code: "LV-LP-ZERO",
        name: "Unconfigured (G-50)",
        nameAr: null,
        paid: true,
        accrualDaysPerYear: "0.00",
        monthlyGrant: false,
        prorateJoiners: false,
        carryOverCapDays: "0.00",
        note: null,
        noteAr: null,
        actorId: H_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_LP, () =>
        postingSvc.postAccrual({
          leaveTypeId: zeroType.id,
          periodId: PERIOD_LP_MARCH,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ACCRUAL_INVALID" });
  });

  it("(b) G-50 GREEN — the exact journal at the monthly slice × daily rate; the roster law; INV-013 exactly-once", async () => {
    const f = spec.fixture!;
    // Monthly slice = 24/12 = 2.00 days; E1 9,000 → 600.0000; E2 (the
    // mid-March joiner — the hire month counts fully) 6,000 → 400.0000;
    // E3 (terminated 2026-02-10, before the period start) skips.
    // Total = 1,000.0000.
    const posted = await withTenant(TENANT_LP, () =>
      postingSvc.postAccrual({
        leaveTypeId: f.leaveTypeId,
        periodId: PERIOD_LP_MARCH,
        actorId: H_ACTOR,
      }),
    );
    expect(posted.employees).toBe(2);
    expect(posted.monthSliceDays).toBe("2.0000");
    expect(posted.amount).toBe("1000.0000");
    expect(await journalLinesOf(posted.journalEntryId)).toEqual([
      { accountId: f.salariesExpenseAccountId, direction: "DEBIT", amount: "1000.0000" },
      { accountId: f.salariesPayableAccountId, direction: "CREDIT", amount: "1000.0000" },
    ]);

    // INV-013 exactly-once: the same (type, March) never posts twice —
    // the engine's CC-01 replay path returns the STORED result (the
    // first posting's journal), never a second journal.
    const replay = await withTenant(TENANT_LP, () =>
      postingSvc.postAccrual({
        leaveTypeId: f.leaveTypeId,
        periodId: PERIOD_LP_MARCH,
        actorId: H_ACTOR,
      }),
    );
    expect(replay.journalEntryId).toBe(posted.journalEntryId);
    expect(replay.amount).toBe("1000.0000");
    const su: Client = await superuserClient();
    const journals = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries
        WHERE tenant_id = $1 AND source_type = 'leave_accrual_run' AND source_id = $2`,
      [TENANT_LP, f.leaveTypeId],
    );
    expect(Number(journals.rows[0]!.n)).toBe(1);

    // The audit trail (the replay posts nothing and audits nothing).
    const events = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.leave_accrual_posted' AND entity_id = $2`,
      [TENANT_LP, f.leaveTypeId],
    );
    await su.end();
    expect(Number(events.rows[0]!.n)).toBe(1);
  });

  it("(c) G-51 GREEN — the encashment settles through the payout machinery (DR SALARIES_PAYABLE · CR CASH + the movement); INV-031 at the boundary", async () => {
    const f = spec.fixture!;
    // E1's 2026 cell: entitlement 24.00, used 0 → remaining 24.00.
    // INV-031's refusal arm FIRST: 30.00 > 24.00 — the typed refusal,
    // the balance untouched.
    await expect(
      withTenant(TENANT_LP, () =>
        postingSvc.encash({
          employeeId: f.employeeE1Id,
          leaveTypeId: f.leaveTypeId,
          days: "30.00",
          cashAccountId: f.bankAccountId,
          entryDate: "2026-03-20",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAVE_ENCASHMENT_INSUFFICIENT" });
    const balancesAfterRefusal = await withTenant(TENANT_LP, () =>
      leaveSvc.balances({ employeeId: f.employeeE1Id, year: 2026 }),
    );
    expect(
      balancesAfterRefusal.find((row) => row.leaveTypeId === f.leaveTypeId)!.usedDays,
    ).toBe("0.00");

    // The settlement: 2.50 days × 9,000/30 = 750.0000.
    const encashed = await withTenant(TENANT_LP, () =>
      postingSvc.encash({
        employeeId: f.employeeE1Id,
        leaveTypeId: f.leaveTypeId,
        days: "2.50",
        cashAccountId: f.bankAccountId,
        entryDate: "2026-03-20",
        actorId: H_ACTOR,
      }),
    );
    expect(encashed.amount).toBe("750.0000");
    expect(encashed.remainingDays).toBe("21.50");
    const bankAccount = await withTenant(TENANT_LP, () =>
      treasury.findCashAccountById(f.bankAccountId),
    );
    expect(await journalLinesOf(encashed.journalEntryId)).toEqual([
      { accountId: f.salariesPayableAccountId, direction: "DEBIT", amount: "750.0000" },
      { accountId: bankAccount!.accountId, direction: "CREDIT", amount: "750.0000" },
    ]);

    // The treasury movement rides the payroll-payout machinery: source
    // 'payroll_payout' (the existing kind), INV-019 exact (base == the
    // journal's cash line).
    const su: Client = await superuserClient();
    const movements = await su.query<{ source_type: string; source_id: string; base_amount: string; direction: string }>(
      `SELECT source_type, source_id::text, base_amount::text, direction FROM cash_movements
        WHERE tenant_id = $1 AND source_id = $2`,
      [TENANT_LP, encashed.encashmentId],
    );
    await su.end();
    expect(movements.rows).toHaveLength(1);
    expect(movements.rows[0]!.source_type).toBe("payroll_payout");
    expect(movements.rows[0]!.direction).toBe("OUT");
    expect(movements.rows[0]!.base_amount).toBe("750.0000");

    // The balance decremented (the same-transaction INV-031 charge).
    const balances = await withTenant(TENANT_LP, () =>
      leaveSvc.balances({ employeeId: f.employeeE1Id, year: 2026 }),
    );
    const cell = balances.find((row) => row.leaveTypeId === f.leaveTypeId)!;
    expect(cell.usedDays).toBe("2.50");
    expect(cell.entitlementDays).toBe("24.00");

    // The terminated employee never encashes (the honest lifecycle —
    // TERMINATED employees settle through the 029 EOS machinery).
    const su2: Client = await superuserClient();
    const terminated = await su2.query<{ id: string }>(
      `SELECT id FROM employees WHERE tenant_id = $1 AND code = 'LP-E3'`,
      [TENANT_LP],
    );
    await su2.end();
    await expect(
      withTenant(TENANT_LP, () =>
        postingSvc.encash({
          employeeId: terminated.rows[0]!.id,
          leaveTypeId: f.leaveTypeId,
          days: "1.00",
          cashAccountId: f.bankAccountId,
          entryDate: "2026-03-20",
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "HR_EMPLOYEE_NOT_FOUND" });

    // The audit trail.
    const su3: Client = await superuserClient();
    const events = await su3.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'hr.leave_encashed' AND entity_id = $2`,
      [TENANT_LP, f.employeeE1Id],
    );
    await su3.end();
    expect(Number(events.rows[0]!.n)).toBe(1);
  });
});
