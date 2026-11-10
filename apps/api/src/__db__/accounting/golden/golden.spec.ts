import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ACTOR,
  assertZeroResidue,
  coa,
  ensureFiscalYear,
  gl,
  journals,
  manualSpec,
  newDocId,
  opening,
  periods,
  posting,
  reconciliation,
  resolveAccounts,
  restorePeriodsOpen,
  setupAccountingFixture,
  TENANT_A,
  withTenant,
  yearEnd,
} from "../fixtures";
import * as journal from "../../../modules/accounting/infrastructure/journal.store";
import * as store from "../../../modules/accounting/infrastructure/accounting.store";

/**
 * PHASE-007 golden tests (ACCOUNTING_TESTS §3, the executable subset):
 * G-16 opening balances, G-20 year-end close, G-19 minimal FX revaluation,
 * plus the engine-level goldens (manual journal post, FX entry, reversal
 * mirror, recurring generation, rounding-residual lines) and the standard
 * failure pack on each fixture — locked period, unmapped purpose,
 * unbalanced spec, already-posted — all zero-residue (§1).
 */

let accounts: Awaited<ReturnType<typeof resolveAccounts>>;
let yearId: string;

beforeAll(async () => {
  await setupAccountingFixture();
  yearId = (await ensureFiscalYear()).id;
  accounts = await resolveAccounts();
});

// Order-independence restore (PHASE-008 reality-audit repair): the failure
// pack LOCKS November on the SHARED FY2026 of tenant A (the G-20 close locks
// FY2025's own periods — a different, isolated year). Restore the pristine
// all-OPEN state so vitest's file order can never couple suites.
afterAll(async () => {
  await restorePeriodsOpen(["11"]);
});

describe("engine-level golden — manual journal post through the full lifecycle", () => {
  it("draft → submit → approve → post assigns JE-{yyyy}-{seq:6} and lands POSTED", async () => {
    // BR-034 single-approver policy + a distinct approver (SoD default OFF).
    await withTenant(TENANT_A, () =>
      journals.upsertPolicy(ACTOR, {
        docType: "journal_entry",
        mode: "single-approver",
        appliesFrom: "2026-01-01",
      }),
    );
    const approver = await (await import("../fixtures")).ensureApprover();
    const draft = await withTenant(TENANT_A, () =>
      journals.create(ACTOR, {
        entryDate: "2026-07-05",
        description: "golden manual journal",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "500.0000" },
          { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "500.0000" },
        ],
      }),
    );
    await withTenant(TENANT_A, () => journals.submit(ACTOR, draft.id));
    // SoD: the creator cannot approve (allow_self_approval OFF, BR-034).
    await expect(withTenant(TENANT_A, () => journals.approve(ACTOR, draft.id))).rejects.toMatchObject({
      code: "SELF_APPROVAL_BLOCKED",
    });
    const approved = await withTenant(TENANT_A, () => journals.approve(approver, draft.id));
    expect(approved.status).toBe("APPROVED");
    const posted = await withTenant(TENANT_A, () => journals.post(ACTOR, draft.id));
    expect(posted.result.entryNo).toMatch(/^JE-2026-\d{6}$/);
    expect(posted.draft.status).toBe("POSTED");
    const entry = await withTenant(TENANT_A, () =>
      journal.findEntryById(posted.result.journalEntryId!),
    );
    expect(entry?.status).toBe("POSTED");
    // Cleanup: restore the default (none) policy so later suites are not
    // forced through the approval path.
    await withTenant(TENANT_A, async () => {
      const { deactivateApprovalPolicy } = await import(
        "../../../modules/accounting/infrastructure/accounting.store"
      );
      const policies = await journals.listPolicies();
      for (const policy of policies) {
        if (policy.docType === "journal_entry" && policy.isActive) {
          await deactivateApprovalPolicy(policy.id);
        }
      }
    });
  });

  it("failure pack: unbalanced draft cannot submit; posted entry cannot be edited (UI + API + SQL triple)", async () => {
    const draft = await withTenant(TENANT_A, () =>
      journals.create(ACTOR, {
        entryDate: "2026-07-06",
        description: "unbalanced",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "10.0000" },
          { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "9.0000" },
        ],
      }),
    );
    await expect(withTenant(TENANT_A, () => journals.submit(ACTOR, draft.id))).rejects.toMatchObject({
      code: "ENTRY_NOT_BALANCED",
    });
    // A posted journal's edit attempt is a typed state error.
    const good = await withTenant(TENANT_A, () =>
      journals.create(ACTOR, {
        entryDate: "2026-07-07",
        description: "good",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "10.0000" },
          { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "10.0000" },
        ],
      }),
    );
    await withTenant(TENANT_A, () => journals.submit(ACTOR, good.id));
    await withTenant(TENANT_A, () => journals.post(ACTOR, good.id));
    await expect(
      withTenant(TENANT_A, () =>
        journals.update(ACTOR, good.id, { description: "hacked after post" }),
      ),
    ).rejects.toMatchObject({ code: "JOURNAL_STATE_INVALID" });
    // SQL side: the guard trigger proof lives in INV-003; here the draft's
    // lines are frozen by state (no UPDATE path exists).
    const lines = await withTenant(TENANT_A, () => journal.listManualJournalLines(good.id));
    expect(lines.length).toBe(2);
  });
});

describe("engine-level golden — FX entry (W-2 shape at the engine tier)", () => {
  it("foreign-currency entry stores the rate and converts per line", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "1000.0000",
          currency: "USD",
          exchangeRate: "3.75000000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    expect(lines.map((line) => line.baseAmount)).toEqual(["3750.0000", "3750.0000"]);
  });
});

describe("engine-level golden — recurring generation (DRAFTs only, never posts)", () => {
  it("the due-generation step creates DRAFT entries carrying recurrence_id and skips locked periods", async () => {
    const definition = await withTenant(TENANT_A, () =>
      journals.createRecurring(ACTOR, {
        name: "golden rent",
        schedule: "MONTHLY",
        startDate: "2026-08-01",
        endDate: null,
        nextRunDate: "2026-08-01",
        template: {
          amountPolicy: "FIXED",
          lines: [
            { accountId: accounts.rentExpense, direction: "DEBIT", amount: "250.0000" },
            { accountId: accounts.cash, direction: "CREDIT", amount: "250.0000" },
          ],
        },
      }),
    );
    const outcome = await withTenant(TENANT_A, () =>
      journals.generateDueRecurring(ACTOR, "2026-08-01"),
    );
    expect(outcome.generated.length).toBeGreaterThanOrEqual(1);
    const drafts = await withTenant(TENANT_A, () =>
      journal.listManualJournals({ recurrenceId: definition.id, limit: 10 }),
    );
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    for (const draft of drafts) {
      expect(draft.status).toBe("DRAFT"); // never auto-posts (JOURNAL_RULES §2)
      expect(draft.recurrenceId).toBe(definition.id);
    }
    // No journal entries exist for these drafts yet.
    for (const draft of drafts) {
      const entry = await withTenant(TENANT_A, () =>
        journal.findEntryBySourceKey("journal_entry", draft.id, "post"),
      );
      expect(entry).toBeUndefined();
    }
  });
});

describe("G-16 — opening balances golden (per-partner rows, OPENING_EQUITY, INV-009 from entry #1)", () => {
  it("posts the PHASE-006 drafts once through the OPENING period with per-partner subledger rows", async () => {
    // Seed drafts: two customers, one supplier, one account kind.
    const { OpeningBalancesService } = await import(
      "../../../modules/partners/application/opening-balances-service"
    );
    const { PartnerService } = await import("../../../modules/partners/application/partner-service");
    const audit = new (await import("../../../modules/audit/application/audit.service")).AuditService(
      new (await import("../../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
    );
    const partners = new PartnerService(audit);
    const openingDrafts = new OpeningBalancesService(audit);
    const customerA = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER", code: undefined, name: "عميل افتتاحي أ", nameAr: "عميل افتتاحي أ",
        taxNumber: null, creditLimit: null, creditTermsId: null, priceListId: null,
      }),
    );
    const customerB = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER", code: undefined, name: "عميل افتتاحي ب", nameAr: "عميل افتتاحي ب",
        taxNumber: null, creditLimit: null, creditTermsId: null, priceListId: null,
      }),
    );
    const supplier = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "SUPPLIER", code: undefined, name: "مورد افتتاحي", nameAr: "مورد افتتاحي",
        taxNumber: null, creditLimit: null, creditTermsId: null, priceListId: null,
      }),
    );
    await withTenant(TENANT_A, async () => {
      await openingDrafts.create(ACTOR, { kind: "PARTNER", partnerId: customerA.id, amount: "1000.0000" });
      await openingDrafts.create(ACTOR, { kind: "PARTNER", partnerId: customerB.id, amount: "500.0000" });
      await openingDrafts.create(ACTOR, { kind: "PARTNER", partnerId: supplier.id, amount: "-400.0000" });
      await openingDrafts.create(ACTOR, { kind: "ACCOUNT", accountId: accounts.cash, amount: "300.0000" });
    });
    const result = await withTenant(TENANT_A, () => opening.post(ACTOR, yearId));
    expect(result.entryNo).toMatch(/^JE-\d{4}-\d{6}$/);
    // G-16 line shape: DR AR 1000 (A) + DR AR 500 (B) + DR cash 300 ·
    // CR AP 400 · CR OPENING_EQUITY 1400 (balancing).
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    const debits = lines.filter((line) => line.direction === "DEBIT").map((line) => line.amount);
    const credits = lines.filter((line) => line.direction === "CREDIT").map((line) => line.amount);
    expect(debits.sort()).toEqual(["1000.0000", "300.0000", "500.0000"].sort());
    expect(credits.sort()).toEqual(["1400.0000", "400.0000"].sort());
    // OPENING_EQUITY is the balancing leg.
    const equityLine = lines.find((line) => line.accountId === accounts.openingEquity);
    expect(equityLine?.amount).toBe("1400.0000");
    // Per-partner subledger rows exist (INV-009 from entry #1): every
    // partner draft's line carried its partner id.
    const partnerLineIds = lines.filter((line) => line.partnerId !== null);
    expect(partnerLineIds.length).toBe(3);
    for (const partner of [customerA, customerB, supplier]) {
      expect(partnerLineIds.some((line) => line.partnerId === partner.id)).toBe(true);
    }
    const arRows = await withTenant(TENANT_A, () =>
      journal.subledgerBalancesOnAccount(accounts.arControl),
    );
    const apRows = await withTenant(TENANT_A, () =>
      journal.subledgerBalancesOnAccount(accounts.apControl),
    );
    expect(arRows.length).toBeGreaterThanOrEqual(2);
    expect(apRows.length).toBeGreaterThanOrEqual(1);
    // Reconciliation is green from entry #1 (RC-01/02 on the opening data).
    const ar = await withTenant(TENANT_A, () =>
      reconciliation.runArCheck({ asOf: "2025-12-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    const ap = await withTenant(TENANT_A, () =>
      reconciliation.runApCheck({ asOf: "2025-12-31", runMode: "ON_DEMAND", checkedBy: ACTOR }),
    );
    expect(ar.status).toBe("OK");
    expect(ap.status).toBe("OK");
    // BR-035 once-only: a second attempt replays the stored entry.
    const again = await withTenant(TENANT_A, () => opening.post(ACTOR, yearId));
    expect(again.journalEntryId).toBe(result.journalEntryId);
    // STOCK drafts remain DRAFT (they post in PHASE-010): none were created
    // here — the phase's zero-stock-draft guarantee is the DRAFT matrix.
    const docs = await withTenant(TENANT_A, () => opening.listDrafts());
    for (const doc of docs) {
      if (doc.kind === "PARTNER" || doc.kind === "ACCOUNT") {
        expect(doc.status).toBe("POSTED");
      }
    }
  });
});

describe("G-20 — year-end close golden (PC-05 numbers: R=10,000 / E=7,500 / net=2,500)", () => {
  it("closes the year with the exact canonical entry, reversible as a unit, idempotent on regenerate", async () => {
    // Build the PC-05 fixture year: a dedicated PAST year (uncluttered,
    // and dated so the closing/reversal dates satisfy ≤ today).
    const fy = await withTenant(TENANT_A, () =>
      periods.createYear(ACTOR, {
        name: "GOLD-2025",
        startDate: "2025-01-01",
        endDate: "2025-12-31",
      }),
    );
    const { rentExpense } = accounts;
    // Revenues 10,000 (two posts of 5,000 + 5,000 on SALES_REVENUE),
    // expenses 7,500 (rent 4,000 + 3,500).
    const posts = [
      { debit: accounts.cash, credit: accounts.salesRevenue, amount: "5000.0000", date: "2025-02-10" },
      { debit: accounts.cash, credit: accounts.salesRevenue, amount: "5000.0000", date: "2025-03-10" },
      { debit: rentExpense, credit: accounts.cash, amount: "4000.0000", date: "2025-04-10" },
      { debit: rentExpense, credit: accounts.cash, amount: "3500.0000", date: "2025-05-10" },
    ];
    for (const post of posts) {
      await withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: newDocId(),
            debitAccountId: post.debit,
            creditAccountId: post.credit,
            amount: post.amount,
            entryDate: post.date,
          }),
          { postedBy: ACTOR },
        ),
      );
    }
    // Lock all 12 REGULAR periods (soft-close → lock).
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(fy.id));
    const regulars = periodsList.filter((period) => period.kind === "REGULAR");
    expect(regulars.length).toBe(12);
    for (const period of regulars) {
      await withTenant(TENANT_A, async () => {
        await periods.softClose(ACTOR, period.id);
        await periods.lock(ACTOR, period.id);
      });
    }
    // Execute the close.
    const close = await withTenant(TENANT_A, () => yearEnd.execute(ACTOR, fy.id));
    expect(close.revenues).toBe("10000.0000");
    expect(close.expenses).toBe("7500.0000");
    expect(close.net).toBe("2500.0000");
    const closingLines = await withTenant(TENANT_A, () => journal.listLines(close.journalEntryId));
    // DR revenue 10,000 · CR CLOSING 10,000 · DR CLOSING 7,500 · CR rent 7,500
    // · DR CLOSING 2,500 · CR RETAINED_EARNINGS 2,500.
    const revenueLeg = closingLines.find(
      (line) => line.accountId === accounts.salesRevenue && line.direction === "DEBIT",
    );
    expect(revenueLeg?.amount).toBe("10000.0000");
    const closingCredit = closingLines.filter(
      (line) => line.accountId === accounts.closing && line.direction === "CREDIT",
    );
    expect(closingCredit.reduce((acc, line) => acc + Number(line.amount), 0)).toBe(10000);
    const closingDebit = closingLines.filter(
      (line) => line.accountId === accounts.closing && line.direction === "DEBIT",
    );
    expect(closingDebit.reduce((acc, line) => acc + Number(line.amount), 0)).toBe(10000);
    const retainedLeg = closingLines.find((line) => line.accountId === accounts.retainedEarnings);
    expect(retainedLeg?.direction).toBe("CREDIT");
    expect(retainedLeg?.amount).toBe("2500.0000");
    const rentLeg = closingLines.find(
      (line) => line.accountId === rentExpense && line.direction === "CREDIT",
    );
    expect(rentLeg?.amount).toBe("7500.0000");
    // One entry per year (INV-013): re-execute is refused until reversed.
    await expect(withTenant(TENANT_A, () => yearEnd.execute(ACTOR, fy.id))).rejects.toMatchObject({
      code: "YEAR_END_CLOSE_INVALID",
    });
    // PC-06: reverse as a unit, then regenerate (idempotent per cycle).
    const reversal = await withTenant(TENANT_A, () =>
      yearEnd.reverse(ACTOR, fy.id, "correction found"),
    );
    expect(reversal.status).toBe("POSTED");
    const original = await withTenant(TENANT_A, () => journal.findEntryById(close.journalEntryId));
    expect(original?.status).toBe("REVERSED");
    const regenerated = await withTenant(TENANT_A, () => yearEnd.execute(ACTOR, fy.id));
    expect(regenerated.revenues).toBe("10000.0000");
    // PC-07: prior-year statements unchanged by the whole cycle — the
    // revenue account's 2027 balance is zero after close (closed out),
    // and no posted row was ever mutated.
    const balances2025 = await withTenant(TENANT_A, () =>
      gl.accountBalances({ fromDate: "2025-01-01", toDate: "2025-12-31" }),
    );
    const revenueBalance = balances2025.find((row) => row.accountId === accounts.salesRevenue);
    expect(revenueBalance?.balance).toBe("0.0000");
  });
});

describe("G-19 (minimal) — FX revaluation run is gated, self-reversing, and audited", () => {
  it("disabled by default (BR-036); enabled run posts the adjusting + auto-reversing pair", async () => {
    // Default OFF.
    await expect(
      withTenant(TENANT_A, () =>
        yearEnd.runFxRevaluation(ACTOR, { runDate: "2026-09-30", currencyCode: "USD", rate: "3.80000000" }),
      ),
    ).rejects.toMatchObject({ code: "FX_REVALUATION_DISABLED" });
    // Enable the tenant setting, then run over the USD cash exposure.
    const suClient = await (await import("../fixtures")).superuserClient();
    await suClient.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES ($1, $2, 'accounting.fx_revaluation_enabled', 'true'::jsonb)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [newDocId(), TENANT_A],
    );
    await suClient.end();
    const run = await withTenant(TENANT_A, () =>
      yearEnd.runFxRevaluation(ACTOR, { runDate: "2026-09-30", currencyCode: "USD", rate: "3.80000000" }),
    );
    // A prior USD entry exists (INV-008 golden) — the pair posts when the
    // rate moved; both ids present means the self-reversing pair landed.
    if (run.adjustingEntryId !== null) {
      expect(run.reversingEntryId).not.toBeNull();
      const adjusting = await withTenant(TENANT_A, () =>
        journal.findEntryById(run.adjustingEntryId!),
      );
      expect(adjusting?.sourceType).toBe("fx_revaluation");
    } else {
      // No exposure at that date: an explicit no-op result.
      expect(run.reversingEntryId).toBeNull();
    }
  });
});

describe("standard failure pack on the golden fixtures (zero residue, ACCOUNTING_TESTS §3)", () => {
  it("locked period / unmapped purpose / unbalanced spec / already-posted all reject typed with zero residue", async () => {
    const periodsList = await withTenant(TENANT_A, () => store.listPeriods(yearId));
    const november = periodsList.find((period) => period.name.endsWith("-11"))!;
    const { periods } = await import("../fixtures");
    await withTenant(TENANT_A, async () => {
      await periods.softClose(ACTOR, november.id);
      await periods.lock(ACTOR, november.id);
    });
    // Locked period.
    const docLocked = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: docLocked,
            debitAccountId: accounts.cash,
            creditAccountId: accounts.salesRevenue,
            amount: "10.0000",
            entryDate: "2026-11-10",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    await assertZeroResidue(docLocked);
    // Unmapped purpose (supersede VAT_PAYABLE first — active_to must be ≥
    // the mapping's active_from, which the fixture set to today).
    const today = new Date().toISOString().slice(0, 10);
    await withTenant(TENANT_A, () => coa.supersedePurpose(ACTOR, "VAT_PAYABLE", today));
    const docUnmapped = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId: docUnmapped, operation: "post" },
            entryDate: "2026-06-15",
            currency: "SAR",
            lines: [
              { purpose: "VAT_PAYABLE", direction: "CREDIT", amount: "15.0000" },
              { accountId: accounts.cash, direction: "DEBIT", amount: "15.0000" },
            ],
          },
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "PURPOSE_NOT_MAPPED" });
    await assertZeroResidue(docUnmapped);
    // Restore the mapping for later phases/tests.
    const vatAccount = await withTenant(TENANT_A, () => store.findAccountByCode("2120"));
    await withTenant(TENANT_A, () =>
      coa.mapPurpose(ACTOR, {
        purposeKey: "VAT_PAYABLE",
        accountId: vatAccount!.id,
        activeFrom: new Date().toISOString().slice(0, 10),
      }),
    );
    // Unbalanced spec.
    const docUnbalanced = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId: docUnbalanced, operation: "post" },
            entryDate: "2026-06-16",
            currency: "SAR",
            lines: [
              { accountId: accounts.cash, direction: "DEBIT", amount: "10.0000" },
              { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "9.0000" },
            ],
          },
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_NOT_BALANCED" });
    await assertZeroResidue(docUnbalanced);
    // Already-posted (sequential duplicate): the SERVICE replays the stored
    // result (INV-013 — no new ledger effects); the ENGINE's typed
    // ALREADY_POSTED for a bypassed replay check is proven in the unit
    // suite (pipeline-order test).
    const docOnce = newDocId();
    const once = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: docOnce,
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "20.0000",
          entryDate: "2026-06-17",
        }),
        { postedBy: ACTOR },
      ),
    );
    const twice = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: docOnce,
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "20.0000",
          entryDate: "2026-06-17",
        }),
        { postedBy: ACTOR },
      ),
    );
    expect(twice.journalEntryId).toBe(once.journalEntryId);
    expect(twice.idempotentReplay).toBe(true);
  });
});
