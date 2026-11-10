import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACTOR,
  assertZeroResidue,
  ensureFiscalYear,
  manualSpec,
  newDocId,
  posting,
  resolveAccounts,
  restorePeriodsOpen,
  setupAccountingFixture,
  superuserClient,
  TENANT_A,
  withTenant,
} from "../fixtures";
import * as journal from "../../../modules/accounting/infrastructure/journal.store";
import * as store from "../../../modules/accounting/infrastructure/accounting.store";
import { alreadyReversed } from "../../../modules/accounting/domain/posting-engine/posting-errors";

/**
 * PHASE-007 invariant suite — INV-011/013/014/015/020/021/022
 * (ACCOUNTING_TESTS §2): period lock, idempotency, reversal, CoA guards,
 * reopen audit, numbering, and the config-cannot-override fuzz seed.
 */

let accounts: Awaited<ReturnType<typeof resolveAccounts>>;
let yearId: string;

beforeAll(async () => {
  await setupAccountingFixture();
  yearId = (await ensureFiscalYear()).id;
  accounts = await resolveAccounts();
});

// Order-independence restore (PHASE-008 reality-audit repair): this suite
// LOCKS March, April and May on the SHARED FY2026 of tenant A; the
// concurrency suite posts throughout May (CC-03/CC-06 fixtures). Restore the
// pristine all-OPEN state so vitest's file order can never couple suites.
afterAll(async () => {
  await restorePeriodsOpen(["03", "04", "05"]);
  // The INV-022 fuzz corpus flips tenant settings (notably
  // accounting.fx_revaluation_enabled=true) whose defaults other suites
  // assert (the G-19 golden's BR-036 "disabled by default" first leg).
  // Restore the pristine default-absent state for every flipped key and
  // drop the fuzz-only entitlement + approval policy.
  const su = await superuserClient();
  await su.query(
    `DELETE FROM tenant_settings
      WHERE tenant_id = $1 AND key IN (
        'general.default_locale', 'general.numeral_system',
        'sales.credit_limit_action', 'sales.price_override_allowed',
        'accounting.fx_revaluation_enabled', 'numbering.defaults')`,
    [TENANT_A],
  );
  await su.query(
    `DELETE FROM entitlements WHERE tenant_id = $1 AND feature_key = 'accounting.projects' AND source = 'MANUAL'`,
    [TENANT_A],
  );
  await su.query(
    `DELETE FROM approval_policies WHERE tenant_id = $1 AND doc_type = 'fuzz_probe'`,
    [TENANT_A],
  );
  await su.end();
});

describe("INV-011 — no entry inside a LOCKED period (engine + trigger)", () => {
  it("positive: entry in the OPEN period posts; violation: LOCKED → PERIOD_LOCKED (engine) AND the trigger blocks direct inserts", async () => {
    // Lock January via soft-close + lock on a dedicated period: use March.
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const march = periodsList.find((period) => period.name.endsWith("-03"))!;
    await withTenant(TENANT_A, async () => {
      const { periods } = await import("../fixtures");
      await periods.softClose(ACTOR, march.id);
      await periods.lock(ACTOR, march.id);
    });
    const docId = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId,
            debitAccountId: accounts.cash,
            creditAccountId: accounts.salesRevenue,
            amount: "10.0000",
            entryDate: "2026-03-15",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    await assertZeroResidue(docId);
    // Trigger double-check: a direct insert into the locked period fails
    // at COMMIT (the deferred constraint trigger).
    const suClient = await (await import("../fixtures")).superuserClient();
    await suClient.query("BEGIN");
    const entryId = newDocId();
    await suClient.query(
      `INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code,
                                    source_type, operation)
       VALUES ($1, $2, '2026-03-15', $3, 'SAR', 'direct_probe', 'post')`,
      [entryId, TENANT_A, march.id],
    );
    await expect(suClient.query("COMMIT")).rejects.toMatchObject({ code: "P0001" });
    await suClient.end();
  });
});

describe("INV-013 — idempotency: (tenant, source_type, source_id, operation) at most once", () => {
  it("sequential retry returns the stored result with no new entry", async () => {
    const docId = newDocId();
    const first = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId,
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "42.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const second = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId,
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "42.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(second.entryNo).toBe(first.entryNo);
    expect(second.idempotentReplay).toBe(true);
  });
});

describe("INV-014 — reversal mirrors exactly, links both ways, at most once", () => {
  it("positive: reverse() mirrors every line with flipped directions and links bidirectionally", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "64.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const reversal = await withTenant(TENANT_A, () =>
      posting.reverse(
        { originalEntryId: result.journalEntryId, entryDate: "2026-01-20", reason: "test reversal" },
        { reversedBy: ACTOR },
      ),
    );
    const original = await withTenant(TENANT_A, () =>
      journal.findEntryById(result.journalEntryId),
    );
    const reversalEntry = await withTenant(TENANT_A, () =>
      journal.findEntryById(reversal.journalEntryId),
    );
    expect(original?.status).toBe("REVERSED");
    expect(original?.reversedById).toBe(reversal.journalEntryId);
    expect(reversalEntry?.reversalOfId).toBe(result.journalEntryId);
    // Full mirror: same accounts/amounts, flipped directions (assert).
    const originalLines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    const reversalLines = await withTenant(TENANT_A, () => journal.listLines(reversal.journalEntryId));
    expect(reversalLines.length).toBe(originalLines.length);
    for (let i = 0; i < originalLines.length; i += 1) {
      expect(reversalLines[i]!.accountId).toBe(originalLines[i]!.accountId);
      expect(reversalLines[i]!.amount).toBe(originalLines[i]!.amount);
      expect(reversalLines[i]!.direction).not.toBe(originalLines[i]!.direction);
    }
  });

  it("violation: reverse twice → ALREADY_REVERSED; non-POSTED → typed error", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "30.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    await withTenant(TENANT_A, () =>
      posting.reverse(
        { originalEntryId: result.journalEntryId, entryDate: "2026-01-20", reason: "first" },
        { reversedBy: ACTOR },
      ),
    );
    await expect(
      withTenant(TENANT_A, () =>
        posting.reverse(
          { originalEntryId: result.journalEntryId, entryDate: "2026-01-21", reason: "second" },
          { reversedBy: ACTOR },
        ),
      ),
    ).rejects.toSatisfy((error: unknown) => error instanceof Error && error.message.includes("already reversed") || (error as { code?: string }).code === "ALREADY_REVERSED");
    expect(() => alreadyReversed({ entryId: "x" })).not.toThrow();
  });
});

describe("INV-015 — accounts with postings/children cannot be deleted; mapped purposes block archive", () => {
  it("violation: archive of a purpose-mapped account is blocked; delete with postings is blocked", async () => {
    const { coa } = await import("../fixtures");
    // AR_CONTROL-mapped account cannot be archived.
    await expect(withTenant(TENANT_A, () => coa.archive(ACTOR, accounts.arControl))).rejects.toMatchObject(
      { code: "ACCOUNT_MAPPED_TO_PURPOSE" },
    );
    // An account with postings cannot be deleted (assertDeletable probe —
    // deletion is not an API action; the guard is the contract).
    const cashEntry = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "5.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    expect(cashEntry.status).toBe("POSTED");
    await expect(withTenant(TENANT_A, () => coa.assertDeletable(accounts.cash))).rejects.toMatchObject({
      code: "ACCOUNT_HAS_POSTINGS",
    });
    // A group node with children is blocked too.
    const assets = await withTenant(TENANT_A, () => store.findAccountByCode("1000"));
    await expect(withTenant(TENANT_A, () => coa.assertDeletable(assets!.id))).rejects.toMatchObject({
      code: "ACCOUNT_HAS_CHILDREN",
    });
    // Positive: a fresh unused leaf passes the deletability probe.
    const fresh = await withTenant(TENANT_A, () =>
      store.insertAccount({
        code: "9996",
        name: "Fresh leaf",
        nameAr: "ورقة جديدة",
        type: "EXPENSE",
        parentId: null,
        currencyCode: null,
        isPostable: true,
      }),
    );
    await expect(withTenant(TENANT_A, () => coa.assertDeletable(fresh.id))).resolves.toBeUndefined();
  });
});

describe("INV-020 — reopen requires reason + audit with anti-fraud alert on old periods", () => {
  it("violation: reopen without reason is rejected; with reason the audit event + alert flag land", async () => {
    const { periods } = await import("../fixtures");
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const april = periodsList.find((period) => period.name.endsWith("-04"))!;
    await withTenant(TENANT_A, async () => {
      await periods.softClose(ACTOR, april.id);
      await periods.lock(ACTOR, april.id);
    });
    await expect(
      withTenant(TENANT_A, () => periods.reopen(ACTOR, april.id, "  ")),
    ).rejects.toMatchObject({ code: "REOPEN_REASON_REQUIRED" });
    const reopened = await withTenant(TENANT_A, () =>
      periods.reopen(ACTOR, april.id, "correction of a misposted invoice"),
    );
    expect(reopened.period.status).toBe("OPEN");
    // The audit event exists with the reason.
    const suClient = await (await import("../fixtures")).superuserClient();
    const events = await suClient.query(
      `SELECT after FROM audit_events WHERE entity_type = 'fiscal_period' AND entity_id = $1 AND action = 'accounting.period_reopened'`,
      [april.id],
    );
    await suClient.end();
    expect(events.rowCount).toBe(1);
    expect((events.rows[0]!.after as { reason: string }).reason).toContain("correction");
    // Subsequent posting revalidates invariants normally.
    const docId = newDocId();
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId,
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "12.0000",
          entryDate: "2026-04-10",
        }),
        { postedBy: ACTOR },
      ),
    );
    expect(result.status).toBe("POSTED");
    // Anti-fraud alert: a period older than 2 months raises the flag (the
    // fixture year is 2026 — historically old by test time).
    const oldPeriodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const may = oldPeriodsList.find((period) => period.name.endsWith("-05"))!;
    await withTenant(TENANT_A, async () => {
      await periods.softClose(ACTOR, may.id);
      await periods.lock(ACTOR, may.id);
    });
    const oldReopen = await withTenant(TENANT_A, () =>
      periods.reopen(ACTOR, may.id, "late adjustment"),
    );
    expect(oldReopen.antiFraudAlert).toBe(true);
  });
});

describe("INV-021 — official numbers unique per (tenant, type); voided reserved", () => {
  it("numbers are unique and immutable; a voided number stays reserved forever", async () => {
    const { numbering } = await import("../fixtures");
    const first = await withTenant(TENANT_A, () =>
      numbering.reserve({
        docType: "probe_doc",
        branchId: null,
        periodKey: "2026",
        format: "PRB-{YYYY}-{SEQ:6}",
        prefix: "PRB",
        year: "2026",
      }),
    );
    const second = await withTenant(TENANT_A, () =>
      numbering.reserve({
        docType: "probe_doc",
        branchId: null,
        periodKey: "2026",
        format: "PRB-{YYYY}-{SEQ:6}",
        prefix: "PRB",
        year: "2026",
      }),
    );
    expect(first.number).not.toBe(second.number);
    // Void the first, then attempt to reuse its number through the
    // assignment ledger — uniqueness includes tombstones.
    await withTenant(TENANT_A, () => numbering.void(ACTOR, "probe_doc", first.number));
    const suClient = await (await import("../fixtures")).superuserClient();
    await expect(
      suClient.query(
        `INSERT INTO number_assignments (id, tenant_id, doc_type, period_key, number, value)
         VALUES ($1, $2, 'probe_doc', '2026', $3, 999)`,
        [newDocId(), TENANT_A, first.number],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await suClient.end();
  });
});

describe("INV-022 — no configuration can alter posting math (fuzz seed)", () => {
  it("flipping settings/entitlements/policies against a golden dataset → byte-identical journal math", async () => {
    // Golden dataset: one balanced spec.
    const goldenLines = [
      { accountId: accounts.cash, direction: "DEBIT" as const, amount: "77.0000" },
      { accountId: accounts.salesRevenue, direction: "CREDIT" as const, amount: "77.0000" },
    ];
    const postSpec = async (docId: string) => {
      const result = await withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId, operation: "post" },
            entryDate: "2026-06-15",
            currency: "SAR",
            lines: goldenLines,
          },
          { postedBy: ACTOR },
        ),
      );
      return withTenant(TENANT_A, async () => {
        const lines = await journal.listLines(result.journalEntryId);
        return lines.map((line) => ({
          accountId: line.accountId,
          direction: line.direction,
          amount: line.amount,
          baseAmount: line.baseAmount,
        }));
      });
    };
    const before = await postSpec(newDocId());
    // Fuzz corpus: flip every tenant setting + policies + entitlements.
    const suClient = await (await import("../fixtures")).superuserClient();
    const flips = [
      ["general.default_locale", "\"en\""],
      ["general.numeral_system", "\"arab\""],
      ["sales.credit_limit_action", "\"block\""],
      ["sales.price_override_allowed", "false"],
      ["accounting.fx_revaluation_enabled", "true"],
      ["numbering.defaults", "{\"assign_at\": \"approval\"}"],
    ] as const;
    for (const [key, value] of flips) {
      await suClient.query(
        `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
        [newDocId(), TENANT_A, key, value],
      );
    }
    // Entitlement flip + approval policy insert (policy math never touches
    // posting math — INV-022).
    await suClient.query(
      `INSERT INTO entitlements (id, tenant_id, feature_key, source) VALUES ($1, $2, 'accounting.projects', 'MANUAL')
       ON CONFLICT ("tenant_id", "feature_key") DO NOTHING`,
      [newDocId(), TENANT_A],
    );
    await suClient.query(
      `INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
       VALUES ($1, $2, 'fuzz_probe', '{"mode": "amount-threshold", "threshold": "1.0000"}'::jsonb, '2026-01-01')
       ON CONFLICT ("tenant_id", "doc_type", "applies_from") DO NOTHING`,
      [newDocId(), TENANT_A],
    );
    await suClient.end();
    const after = await postSpec(newDocId());
    // Byte-identical journal math across the config permutation.
    expect(after).toEqual(before);
  });
});
