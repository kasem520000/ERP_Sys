import { describe, expect, it } from "vitest";

import { PostingEngine, type PostingReadModel } from "./posting-engine";
import type { JournalSpec, JournalLineSpec } from "./journal-spec";
import {
  PostingError,
} from "./posting-errors";

/**
 * PHASE-007 T6 unit suite (POSTING_ENGINE.md §2; ACCOUNTING_TESTS §1/§2):
 * the validation pipeline 1–8 IN ORDER with first-failure abort, each
 * step's positive + negative scenario, typed error codes, and zero
 * residue by construction (the pure engine writes nothing — the plan is
 * produced only when every step passes).
 */

const ACCOUNTS = {
  cash: { id: "a-cash", code: "1111", status: "ACTIVE", isPostable: true, currencyCode: null },
  revenue: { id: "a-rev", code: "4100", status: "ACTIVE", isPostable: true, currencyCode: null },
  arControl: { id: "a-ar", code: "1130", status: "ACTIVE", isPostable: true, currencyCode: null },
  apControl: { id: "a-ap", code: "2110", status: "ACTIVE", isPostable: true, currencyCode: null },
  group: { id: "a-group", code: "1100", status: "ACTIVE", isPostable: false, currencyCode: null },
  archived: { id: "a-arch", code: "1300", status: "ARCHIVED", isPostable: true, currencyCode: null },
  sarOnly: { id: "a-sar", code: "1121", status: "ACTIVE", isPostable: true, currencyCode: "SAR" },
} as const;

const PERIODS = {
  open: { id: "p-open", status: "OPEN", startDate: "2026-01-01", endDate: "2026-01-31" },
  soft: { id: "p-soft", status: "SOFT_CLOSED", startDate: "2026-02-01", endDate: "2026-02-28" },
  locked: { id: "p-locked", status: "LOCKED", startDate: "2026-03-01", endDate: "2026-03-31" },
} as const;

const PROJECTS = {
  open: { id: "prj-open", status: "OPEN" as const },
  closed: { id: "prj-closed", status: "CLOSED" as const },
} as const;

interface ModelOverrides {
  existingEntry?: { id: string; entryNo: string | null; status: "POSTED" | "REVERSED" };
  purposes?: Record<string, string>;
  base?: string;
}

function model(overrides: ModelOverrides = {}): PostingReadModel {
  const purposes: Record<string, string> = {
    AR_CONTROL: ACCOUNTS.arControl.id,
    AP_CONTROL: ACCOUNTS.apControl.id,
    SALES_REVENUE: ACCOUNTS.revenue.id,
    ...overrides.purposes,
  };
  return {
    findEntryBySourceKey: async () => overrides.existingEntry,
    findPeriodForDate: async (date: string) => {
      if (date >= "2026-03-01" && date <= "2026-03-31") return PERIODS.locked;
      if (date >= "2026-02-01" && date <= "2026-02-28") return PERIODS.soft;
      if (date >= "2026-01-01" && date <= "2026-01-31") return PERIODS.open;
      return undefined;
    },
    findPeriodById: async (id: string) =>
      id === PERIODS.open.id ? PERIODS.open : id === PERIODS.soft.id ? PERIODS.soft : undefined,
    findAccount: async (id: string) => Object.values(ACCOUNTS).find((a) => a.id === id),
    findActivePurposeAccount: async (key: string) =>
      purposes[key] === undefined ? undefined : { accountId: purposes[key] },
    findProject: async (id: string) =>
      id === PROJECTS.open.id
        ? { id: PROJECTS.open.id, status: PROJECTS.open.status }
        : id === PROJECTS.closed.id
          ? { id: PROJECTS.closed.id, status: PROJECTS.closed.status }
          : undefined,
    findArApControlAccounts: async () => ({
      arControlAccountId: ACCOUNTS.arControl.id,
      apControlAccountId: ACCOUNTS.apControl.id,
    }),
    // PHASE-029 (BR-053): empty by default — specs inject payroll account
    // ids through overrides.purposes to exercise the manual-journal guard.
    findPayrollPurposeAccounts: async () => {
      const ids = new Set<string>();
      for (const key of [
        "SALARIES_EXPENSE",
        "SALARIES_PAYABLE",
        "DEDUCTIONS_PAYABLE",
        "EMPLOYER_CONTRIBUTIONS",
        "EOS_PROVISION",
        "EOS_PROVISION_EXPENSE",
      ]) {
        if (purposes[key] !== undefined) {
          ids.add(purposes[key]);
        }
      }
      return ids;
    },
    baseCurrency: async () => overrides.base ?? "SAR",
  };
}

function balancedSpec(overrides: Partial<JournalSpec> = {}): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: "11111111-1111-4111-8111-111111111111", operation: "post" },
    entryDate: "2026-01-15",
    currency: "SAR",
    lines: [
      { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "100.0000" },
      { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "100.0000" },
    ],
    ...overrides,
  };
}

const engine = new PostingEngine();

async function expectPostingError(spec: JournalSpec, code: string): Promise<void> {
  await expect(engine.post(spec, model())).rejects.toMatchObject({ code });
}

describe("PHASE-007 posting engine — validation pipeline (T6)", () => {
  it("(1) idempotency: existing source key aborts with ALREADY_POSTED before any other check", async () => {
    // Pipeline ORDER proof: an unbalanced spec with an existing source key
    // fails on idempotency FIRST (INV-013), not on balance.
    const spec = balancedSpec({
      lines: [{ accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "50.0000" }],
    });
    await expect(
      engine.post(spec, model({ existingEntry: { id: "e-1", entryNo: "JE-2026-000001", status: "POSTED" } })),
    ).rejects.toMatchObject({ code: "ALREADY_POSTED" });
  });

  it("(2) schema-level: < 2 lines, all-debit, and non-positive amounts reject typed", async () => {
    await expectPostingError(
      balancedSpec({ lines: [{ accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "10.0000" }] }),
      "ENTRY_NOT_BALANCED",
    );
    await expectPostingError(
      balancedSpec({
        lines: [
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "10.0000" },
          { accountId: ACCOUNTS.revenue.id, direction: "DEBIT", amount: "10.0000" },
        ],
      }),
      "ENTRY_NOT_BALANCED",
    );
    await expectPostingError(
      balancedSpec({
        lines: [
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "0.0000" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "0.0000" },
        ],
      }),
      "INVALID_AMOUNT",
    );
  });

  it("(2) a line with neither purpose nor accountId fails typed", async () => {
    const lines: JournalLineSpec[] = [
      { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "10.0000" },
      { direction: "CREDIT", amount: "10.0000" },
    ];
    await expectPostingError(balancedSpec({ lines }), "PURPOSE_NOT_MAPPED");
  });

  it("(3) FX: foreign currency without rate → MISSING_FX_RATE; rate ≤ 0 → INVALID_AMOUNT", async () => {
    await expectPostingError(balancedSpec({ currency: "USD" }), "MISSING_FX_RATE");
    await expectPostingError(
      balancedSpec({ currency: "USD", exchangeRate: "0" }),
      "INVALID_AMOUNT",
    );
  });

  it("(3) FX: base amounts computed at the stored rate and balance holds in base (INV-002/008)", async () => {
    const plan = await engine.post(
      balancedSpec({
        currency: "USD",
        exchangeRate: "3.75000000",
        lines: [
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "200.0000" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "200.0000" },
        ],
      }),
      model(),
    );
    expect(plan.lines[0]!.baseAmount).toBe("750.0000");
    expect(plan.exchangeRate).toBe("3.75000000");
  });

  it("(3) FX: line-level rounding drift that unbalances base is rejected (caller must pre-balance)", async () => {
    // Doc-currency balanced (0.0001 + 0.0001 = 0.0002) but per-line
    // half-up conversion at rate 1.25 gives base 0.0001 + 0.0001 = 0.0002
    // vs 0.0003 — the residual must be an explicit line, never dropped.
    await expectPostingError(
      balancedSpec({
        currency: "USD",
        exchangeRate: "1.25000000",
        lines: [
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "0.0001" },
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "0.0001" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "0.0002" },
        ],
      }),
      "ENTRY_NOT_BALANCED",
    );
  });

  it("(4) period: LOCKED → PERIOD_LOCKED; no period → PERIOD_NOT_FOUND (INV-011)", async () => {
    await expectPostingError(balancedSpec({ entryDate: "2026-03-15" }), "PERIOD_LOCKED");
    await expectPostingError(balancedSpec({ entryDate: "2025-06-15" }), "PERIOD_NOT_FOUND");
  });

  it("(4) period: SOFT_CLOSED without reason → PERIOD_LOCKED; with reason → passes (PC-02)", async () => {
    await expectPostingError(balancedSpec({ entryDate: "2026-02-15" }), "PERIOD_LOCKED");
    const plan = await engine.post(
      balancedSpec({ entryDate: "2026-02-15", softCloseReason: "audit adjustment" }),
      model(),
    );
    expect(plan.fiscalPeriodId).toBe(PERIODS.soft.id);
  });

  it("(5) account resolution: group node → ACCOUNT_NOT_POSTABLE; archived → ACCOUNT_ARCHIVED (INV-004)", async () => {
    await expectPostingError(
      balancedSpec({
        lines: [
          { accountId: ACCOUNTS.group.id, direction: "DEBIT", amount: "10.0000" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "10.0000" },
        ],
      }),
      "ACCOUNT_NOT_POSTABLE",
    );
    await expectPostingError(
      balancedSpec({
        lines: [
          { accountId: ACCOUNTS.archived.id, direction: "DEBIT", amount: "10.0000" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "10.0000" },
        ],
      }),
      "ACCOUNT_ARCHIVED",
    );
  });

  it("(5) currency restriction: SAR-only account rejects a USD line (INV-005)", async () => {
    await expectPostingError(
      balancedSpec({
        currency: "USD",
        exchangeRate: "3.75",
        lines: [
          { accountId: ACCOUNTS.sarOnly.id, direction: "DEBIT", amount: "10.0000" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "10.0000" },
        ],
      }),
      "CURRENCY_MISMATCH",
    );
  });

  it("(5) purposes resolve to the mapped account; unmapped purpose fails closed (no fallback)", async () => {
    const plan = await engine.post(
      balancedSpec({
        lines: [
          { purpose: "AR_CONTROL", direction: "DEBIT", amount: "50.0000", partnerId: "partner-1" },
          { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "50.0000" },
        ],
      }),
      model(),
    );
    expect(plan.lines[0]!.accountId).toBe(ACCOUNTS.arControl.id);
    expect(plan.lines[0]!.isArApControl).toBe(true);
    await expectPostingError(
      balancedSpec({
        lines: [
          { purpose: "VAT_PAYABLE", direction: "CREDIT", amount: "15.0000" },
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "15.0000" },
        ],
      }),
      "PURPOSE_NOT_MAPPED",
    );
  });

  it("(6) subledger consistency: AR/AP control line without partner → MISSING_PARTNER_ON_CONTROL (INV-009)", async () => {
    await expectPostingError(
      balancedSpec({
        lines: [
          { purpose: "AR_CONTROL", direction: "DEBIT", amount: "50.0000" },
          { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "50.0000" },
        ],
      }),
      "MISSING_PARTNER_ON_CONTROL",
    );
  });

  it("(7) balanced: off by 0.0001 in document currency → ENTRY_NOT_BALANCED (INV-001, 0 tolerance)", async () => {
    await expectPostingError(
      balancedSpec({
        lines: [
          { accountId: ACCOUNTS.cash.id, direction: "DEBIT", amount: "100.0001" },
          { accountId: ACCOUNTS.revenue.id, direction: "CREDIT", amount: "100.0000" },
        ],
      }),
      "ENTRY_NOT_BALANCED",
    );
  });

  it("(8) a fully valid spec produces the write plan (line numbers, base amounts, period)", async () => {
    const plan = await engine.post(balancedSpec(), model());
    expect(plan.fiscalPeriodId).toBe(PERIODS.open.id);
    expect(plan.exchangeRate).toBe("1");
    expect(plan.lines.map((line) => line.lineNo)).toEqual([1, 2]);
    expect(plan.lines[0]!.amount).toBe("100.0000");
    expect(plan.lines[0]!.baseAmount).toBe("100.0000");
  });

  it("explicit period override: entry date must fall inside the period (OPENING/CLOSING windows)", async () => {
    await expectPostingError(
      balancedSpec({ fiscalPeriodId: PERIODS.open.id, entryDate: "2026-02-10" }),
      "PERIOD_NOT_FOUND",
    );
    const plan = await engine.post(
      balancedSpec({ fiscalPeriodId: PERIODS.open.id, entryDate: "2026-01-20" }),
      model(),
    );
    expect(plan.fiscalPeriodId).toBe(PERIODS.open.id);
  });

  it("isDatePostable mirrors period openness without posting", async () => {
    expect(await engine.isDatePostable("2026-01-15", model())).toBe(true);
    expect(await engine.isDatePostable("2026-02-15", model())).toBe(false);
    expect(await engine.isDatePostable("2026-03-15", model())).toBe(false);
    expect(await engine.isDatePostable("2030-01-01", model())).toBe(false);
  });

  it("every taxonomy error is a typed PostingError with the stable code (never a string)", async () => {
    const promise = engine.post(balancedSpec({ entryDate: "2026-03-15" }), model());
    await expect(promise).rejects.toBeInstanceOf(PostingError);
    await expect(promise).rejects.toMatchObject({ name: "PostingError" });
  });
});
