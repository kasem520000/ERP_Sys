import { beforeAll, describe, expect, it } from "vitest";

import {
  ACTOR,
  assertZeroResidue,
  ensureFiscalYear,
  manualSpec,
  newDocId,
  posting,
  resolveAccounts,
  setupAccountingFixture,
  TENANT_A,
  withTenant,
} from "../fixtures";
import * as journal from "../../../modules/accounting/infrastructure/journal.store";
import * as store from "../../../modules/accounting/infrastructure/accounting.store";

/**
 * PHASE-007 invariant suite — INV-001..009 (ACCOUNTING_TESTS §2): every
 * covered invariant's positive + violation scenario against real
 * PostgreSQL; violations assert the TYPED error code AND zero residue.
 * INV-011/013/014/015/020/021/022 live in their sibling files.
 */

let accounts: Awaited<ReturnType<typeof resolveAccounts>>;

beforeAll(async () => {
  await setupAccountingFixture();
  await ensureFiscalYear();
  accounts = await resolveAccounts();
});

describe("INV-001 — balanced in document currency, 0 tolerance", () => {
  it("positive: a balanced spec posts and Σdebit = Σcredit exactly", async () => {
    const docId = newDocId();
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId,
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "1000.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    expect(result.idempotentReplay).toBe(false);
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    const debit = lines.filter((l) => l.direction === "DEBIT").reduce((a, l) => a + Number(l.amount), 0);
    const credit = lines.filter((l) => l.direction === "CREDIT").reduce((a, l) => a + Number(l.amount), 0);
    expect(debit).toBe(credit);
  });

  it("violation: spec off by 0.0001 → ENTRY_NOT_BALANCED with zero residue", async () => {
    const docId = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId, operation: "post" },
            entryDate: "2026-01-15",
            currency: "SAR",
            lines: [
              { accountId: accounts.cash, direction: "DEBIT", amount: "100.0001" },
              { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "100.0000" },
            ],
          },
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_NOT_BALANCED" });
    await assertZeroResidue(docId);
  });
});

describe("INV-002 — balanced in base currency (per-line FX conversion)", () => {
  it("positive: FX entry balances in doc AND base", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "200.0000",
          currency: "USD",
          exchangeRate: "3.75000000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    const baseDebit = lines.filter((l) => l.direction === "DEBIT").reduce((a, l) => a + Number(l.baseAmount), 0);
    const baseCredit = lines.filter((l) => l.direction === "CREDIT").reduce((a, l) => a + Number(l.baseAmount), 0);
    expect(baseDebit).toBe(750);
    expect(baseCredit).toBe(750);
  });

  it("violation: line-level FX rounding drift → engine rejects (caller must pre-balance)", async () => {
    const docId = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId, operation: "post" },
            entryDate: "2026-01-15",
            currency: "USD",
            exchangeRate: "1.25000000",
            lines: [
              { accountId: accounts.cash, direction: "DEBIT", amount: "0.0001" },
              { accountId: accounts.cash, direction: "DEBIT", amount: "0.0001" },
              { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "0.0002" },
            ],
          },
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_NOT_BALANCED" });
    await assertZeroResidue(docId);
  });
});

describe("INV-003 — posted entries/lines immutable (guards + grants + triggers)", () => {
  it("positive: a posted entry exists; direct SQL UPDATE/DELETE as erp_app → 0 rows/trigger error", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "50.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    const { appClient } = await import("../fixtures");
    const app = await appClient();
    // Each rejection runs in its OWN transaction: a denied statement aborts
    // the surrounding transaction (25P02 would mask later codes) — the
    // same discipline as the PHASE-002 append-only proofs.
    const expectRejectedInTx = async (sql: string, values: unknown[]) => {
      await app.query("BEGIN");
      await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_A]);
      try {
        await app.query(sql, values);
        expect.unreachable("must be rejected");
      } catch (error) {
        expect((error as { code?: string }).code).toBe("42501");
      } finally {
        await app.query("ROLLBACK");
      }
    };
    // UPDATE on a line: grant-denied (no UPDATE grant at all).
    await expectRejectedInTx(`UPDATE journal_lines SET amount = 999 WHERE id = $1`, [lines[0]!.id]);
    // DELETE of the entry: grant-denied.
    await expectRejectedInTx(`DELETE FROM journal_entries WHERE id = $1`, [result.journalEntryId]);
    // UPDATE on the entry beyond the reversal pair: column-grant denies the
    // non-granted column outright.
    await expectRejectedInTx(`UPDATE journal_entries SET description = 'hacked' WHERE id = $1`, [
      result.journalEntryId,
    ]);
    await app.end();
    // The entry is intact.
    const entry = await withTenant(TENANT_A, () => journal.findEntryById(result.journalEntryId));
    expect(entry?.status).toBe("POSTED");
  });

  it("guard trigger: even a granted-column UPDATE with a non-reversal shape is rejected", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "50.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const suClient = await (await import("../fixtures")).superuserClient();
    await suClient.query("BEGIN");
    // Superuser bypasses grants but NOT the guard trigger: a bogus
    // status-only mutation is rejected (INV-003 belt-and-braces).
    await expect(
      suClient.query(
        `UPDATE journal_entries SET status = 'REVERSED', version = version + 1 WHERE id = $1`,
        [result.journalEntryId],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
    await suClient.query("ROLLBACK");
    await suClient.end();
  });
});

describe("INV-004 — lines target only active postable leaves", () => {
  it("positive: posting to an active leaf succeeds (covered by every test above)", () => {
    expect(accounts.cash).toBeTruthy();
  });

  it("violation: group node → ACCOUNT_NOT_POSTABLE; archived → ACCOUNT_ARCHIVED", async () => {
    const docIds = [newDocId(), newDocId()];
    const group = await withTenant(TENANT_A, () => store.findAccountByCode("1100"));
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: docIds[0]!,
            debitAccountId: group!.id,
            creditAccountId: accounts.salesRevenue,
            amount: "10.0000",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_POSTABLE" });
    const archived = await withTenant(TENANT_A, async () => {
      const created = await store.insertAccount({
        code: "9998",
        name: "Archived fixture",
        nameAr: "حساب مؤرشف",
        type: "EXPENSE",
        parentId: null,
        currencyCode: null,
        isPostable: true,
      });
      return store.setAccountStatus(created.id, "ARCHIVED");
    });
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: docIds[1]!,
            debitAccountId: archived!.id,
            creditAccountId: accounts.salesRevenue,
            amount: "10.0000",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_ARCHIVED" });
    await assertZeroResidue(docIds[0]!);
    await assertZeroResidue(docIds[1]!);
  });
});

describe("INV-005 — currency-restricted accounts reject foreign lines", () => {
  it("positive: SAR-restricted account accepts a SAR line; violation: USD line → CURRENCY_MISMATCH", async () => {
    const sarAccount = await withTenant(TENANT_A, async () => {
      const created = await store.insertAccount({
        code: "9997",
        name: "SAR only fixture",
        nameAr: "حساب بالريال فقط",
        type: "ASSET",
        parentId: null,
        currencyCode: "SAR",
        isPostable: true,
      });
      return created;
    });
    // Positive: SAR entry on the SAR-restricted account.
    const okResult = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: sarAccount.id,
          creditAccountId: accounts.salesRevenue,
          amount: "25.0000",
        }),
        { postedBy: ACTOR },
      ),
    );
    expect(okResult.status).toBe("POSTED");
    // Violation: USD entry on the same account.
    const docId = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId,
            debitAccountId: sarAccount.id,
            creditAccountId: accounts.salesRevenue,
            amount: "25.0000",
            currency: "USD",
            exchangeRate: "3.75000000",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    await assertZeroResidue(docId);
  });
});

describe("INV-006 — source chain complete both directions", () => {
  it("positive: posted draft ↔ journal entry reference each other; sabotage without entries is impossible via API", async () => {
    const { journals } = await import("../fixtures");
    const draft = await withTenant(TENANT_A, () =>
      journals.create(ACTOR, {
        entryDate: "2026-01-18",
        description: "chain probe",
        lines: [
          { accountId: accounts.cash, direction: "DEBIT", amount: "75.0000" },
          { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "75.0000" },
        ],
      }),
    );
    // Default policy (none): submit auto-approves — the DOCUMENT_LIFECYCLE
    // §2 "approve → post may be one user action" shape, recorded as such.
    const approved = await withTenant(TENANT_A, () => journals.submit(ACTOR, draft.id));
    expect(approved.status).toBe("APPROVED");
    const posted = await withTenant(TENANT_A, () => journals.post(ACTOR, draft.id));
    expect(posted.draft.status).toBe("POSTED");
    expect(posted.draft.postedJournalId).toBe(posted.result.journalEntryId);
    // Entry side: source_type/source_id point back at the draft (INV-006).
    const entry = await withTenant(TENANT_A, () =>
      journal.findEntryById(posted.result.journalEntryId),
    );
    expect(entry?.sourceType).toBe("journal_entry");
    expect(entry?.sourceId).toBe(draft.id);
    // GL drill-down resolves the source document both directions.
    const { gl } = await import("../fixtures");
    const detail = await withTenant(TENANT_A, () => gl.entryDetail(posted.result.journalEntryId));
    expect(detail.source.resolvable).toBe(true);
  });
});

describe("INV-007 — rounding residuals are never dropped", () => {
  it("violation: unbalanced residual → ENTRY_NOT_BALANCED (the residual must be an explicit line)", async () => {
    const docId = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId, operation: "post" },
            entryDate: "2026-01-15",
            currency: "SAR",
            lines: [
              { accountId: accounts.cash, direction: "DEBIT", amount: "33.3333" },
              { accountId: accounts.cash, direction: "DEBIT", amount: "33.3333" },
              { accountId: accounts.cash, direction: "DEBIT", amount: "33.3334" },
              { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "99.9999" },
            ],
          },
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "ENTRY_NOT_BALANCED" });
    await assertZeroResidue(docId);
  });

  it("positive: with the explicit residual line the entry posts exactly", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        {
          source: { docType: "journal_entry", docId: newDocId(), operation: "post" },
          entryDate: "2026-01-15",
          currency: "SAR",
          lines: [
            { accountId: accounts.cash, direction: "DEBIT", amount: "33.3333" },
            { accountId: accounts.cash, direction: "DEBIT", amount: "33.3333" },
            { accountId: accounts.cash, direction: "DEBIT", amount: "33.3334" },
            { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "99.9999" },
            { accountId: accounts.fxGain, direction: "CREDIT", amount: "0.0001" },
          ],
        },
        { postedBy: ACTOR },
      ),
    );
    expect(result.status).toBe("POSTED");
  });
});

describe("INV-008 — FX entries store rate > 0 and base = doc × rate as stored", () => {
  it("positive: re-read returns the stored values, no recomputation drift", async () => {
    const result = await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "123.4500",
          currency: "USD",
          exchangeRate: "3.76500000",
        }),
        { postedBy: ACTOR },
      ),
    );
    const entry = await withTenant(TENANT_A, () => journal.findEntryById(result.journalEntryId));
    expect(entry?.exchangeRate).toBe("3.76500000");
    const lines = await withTenant(TENANT_A, () => journal.listLines(result.journalEntryId));
    expect(lines[0]!.amount).toBe("123.4500");
    expect(lines[0]!.baseAmount).toBe("464.7893"); // 123.45 × 3.765 = 464.78925 → half-up 464.7893
  });

  it("violation: missing rate → MISSING_FX_RATE; rate ≤ 0 → INVALID_AMOUNT", async () => {
    const docIds = [newDocId(), newDocId()];
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: docIds[0]!,
            debitAccountId: accounts.cash,
            creditAccountId: accounts.salesRevenue,
            amount: "10.0000",
            currency: "USD",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "MISSING_FX_RATE" });
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          manualSpec({
            docId: docIds[1]!,
            debitAccountId: accounts.cash,
            creditAccountId: accounts.salesRevenue,
            amount: "10.0000",
            currency: "USD",
            exchangeRate: "0",
          }),
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await assertZeroResidue(docIds[0]!);
    await assertZeroResidue(docIds[1]!);
  });
});

describe("INV-009 — AR/AP lines carry partner; Σ subledger = control", () => {
  it("violation: AR line without partner → MISSING_PARTNER_ON_CONTROL", async () => {
    const docId = newDocId();
    await expect(
      withTenant(TENANT_A, () =>
        posting.post(
          {
            source: { docType: "journal_entry", docId, operation: "post" },
            entryDate: "2026-01-15",
            currency: "SAR",
            lines: [
              { purpose: "AR_CONTROL", direction: "DEBIT", amount: "50.0000" },
              { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "50.0000" },
            ],
          },
          { postedBy: ACTOR },
        ),
      ),
    ).rejects.toMatchObject({ code: "MISSING_PARTNER_ON_CONTROL" });
    await assertZeroResidue(docId);
  });

  it("positive: AR line with partner creates the subledger row and Σ matches the control (drift tests in reconciliation/RC-03)", async () => {
    const { PartnerService } = await import("../../../modules/partners/application/partner-service");
    const partners = new PartnerService(
      new (await import("../../../modules/audit/application/audit.service")).AuditService(
        new (await import("../../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
      ),
    );
    const partner = await withTenant(TENANT_A, () =>
      partners.create(ACTOR, {
        kind: "CUSTOMER",
        code: undefined,
        name: "عميل المحاسبة",
        nameAr: "عميل المحاسبة",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    const posted = await withTenant(TENANT_A, () =>
      posting.post(
        {
          source: { docType: "journal_entry", docId: newDocId(), operation: "post" },
          entryDate: "2026-01-15",
          currency: "SAR",
          description: { en: "AR probe", ar: "قيود عملاء" },
          lines: [
            { purpose: "AR_CONTROL", direction: "DEBIT", amount: "80.0000", partnerId: partner.id },
            { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "80.0000" },
          ],
        },
        { postedBy: ACTOR },
      ),
    );
    expect(posted.status).toBe("POSTED");
    // Subledger row exists for the partner, same transaction (INV-009).
    const rows = await withTenant(TENANT_A, () =>
      journal.listPartnersWithSubledger(),
    );
    const row = rows.find((candidate) => candidate.partnerId === partner.id);
    expect(row?.balance).toBe("80.0000");
    // Σ subledger (base) on AR control = control account balance.
    const control = await withTenant(TENANT_A, () =>
      journal.controlAccountBalance(accounts.arControl),
    );
    const onControl = await withTenant(TENANT_A, () =>
      journal.subledgerBalancesOnAccount(accounts.arControl),
    );
    const subledgerSum = onControl.reduce((acc, candidate) => acc + Number(candidate.balance), 0);
    expect(subledgerSum.toFixed(4)).toBe(control);
  });
});
