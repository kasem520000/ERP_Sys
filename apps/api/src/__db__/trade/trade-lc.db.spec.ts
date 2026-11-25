import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  ensureTradeLcPostingWorld,
  setupTradeFixture,
  TR_ACTOR,
  TENANT_TRADE,
} from "./fixtures";
import { LcService } from "../../modules/trade/application/lc-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  LcAmendmentInvalidError,
  LcBankAccountInvalidError,
  LcChecklistStateError,
  LcMarginShapeError,
  LcRecordNotFoundError,
  LcStateError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25) `trade-lc.db.spec` — THE LC
 * ENGINE over real PG16 (the plan §4's own arm; acceptance #2's LC arms):
 * the lifecycle end-to-end (issue → amend → the checklist → the fee →
 * retire) with G-64's postings proven at the JOURNAL LINE level (the
 * exact DR/CR pairs, the FX ride's rate capture, the INV-019-exact
 * treasury movements), G-64's exactly-once (the single-use source keys +
 * the CAS stamps + the ladder's refusals naming the record), the
 * unmapped-purpose fail-closed with the ZERO RESIDUE and the
 * flip-and-restore re-run, the amendment windows (the typed-change law +
 * the freshness law + the G-64 margin adjustment both directions), the
 * checklist monotone law (the 0119 floors' fold rendered VERBATIM), the
 * fee's financial-charges discipline (the `fee_{seq}` INV-028-precedent
 * source keys — two fees, two keys), and the margin exit law (the
 * margined cancellation refused; the margin-free retirement refused).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * rejection arm builds its own LC with its own unique natural key — a
 * rejection arm never shares mutable rows with another arm.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const lcs = new LcService(audit, posting, numbering);

const world: {
  usdBankId?: string;
  sarBankId?: string;
  glUsdBankCode?: string;
  glSarBankCode?: string;
  marginAccountCode?: string;
  bankChargesAccountCode?: string;
} = {};

beforeAll(async () => {
  await setupTradeFixture();
  const postingWorld = await ensureTradeLcPostingWorld();
  world.usdBankId = postingWorld.usdBankId;
  world.sarBankId = postingWorld.sarBankId;
  world.glUsdBankCode = postingWorld.glUsdBankCode;
  world.glSarBankCode = postingWorld.glSarBankCode;
  world.marginAccountCode = postingWorld.marginAccountCode;
  world.bankChargesAccountCode = postingWorld.bankChargesAccountCode;
});

/** The journal lines of a source key (the golden read's own shape). */
async function journalLines(docType: string, docId: string, operation?: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
    currency: string;
    exchangeRate: string | null;
  }>(sql`
    SELECT jl.direction, a.code, jl.amount::text AS amount, je.currency_code AS currency,
           je.exchange_rate::text AS "exchangeRate"
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
      AND (${operation ?? null}::text IS NULL OR je.operation = ${operation ?? null})
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

/** The treasury movements of a source (the INV-019-exactness read). */
async function movementsOf(sourceType: string, sourceId: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    amount: string;
    currencyCode: string;
    exchangeRate: string;
    baseAmount: string;
  }>(sql`
    SELECT direction, amount::text AS amount, currency_code AS "currencyCode",
           exchange_rate::text AS "exchangeRate", base_amount::text AS "baseAmount"
    FROM cash_movements WHERE source_type = ${sourceType} AND source_id = ${sourceId}
    ORDER BY id
  `);
  return rows.rows;
}

/** Count a source key's entries (the INV-013 idempotency proof). */
async function entryCount(docType: string, docId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId}
  `);
  return rows.rows[0]!.n;
}

/** The flip-and-restore idiom (the quality goldens' own): supersede an
 * active purpose mapping through the tenant's runtime surface. */
async function supersedePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  expect(active).toBeDefined();
  await accounting.supersedePurpose(active!.id, active!.activeFrom);
}

async function restorePurposeKey(purposeKey: string, code: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  if (active === undefined) {
    const account = await tenancy.findAccountByCode(code);
    expect(account).toBeDefined();
    await tenancy.insertAccountPurpose({
      purposeKey,
      accountId: account!.id,
      activeFrom: new Date().toISOString().slice(0, 10),
    });
  }
}

/** THE GOLDEN-CLASS LIFECYCLE: create → issue → amend (VALUE + margin
 * increase) → checklist → fee → retire — every G-64 surface proven. */
async function goldenLifecycle(): Promise<string> {
  const created = await lcs.create({
    currency: "USD",
    amount: "100000.0000",
    marginAmount: "20000.0000",
    exchangeRate: "3.75000000",
    issuingBank: "Emirates Trade Bank",
    beneficiaryName: "Overseas Seller SARL",
    applicantName: "TR Trading Co",
    expiryDate: "2027-03-31",
    actorId: TR_ACTOR,
  });
  expect(created.status).toBe("DRAFT");
  expect(created.lcNo).toMatch(/^LC-2026-\d{6}$/);

  // ── THE ISSUE (the G-64 margin deposit, the FX ride at 3.75) ──────
  const issued = await lcs.issue(created.id, {
    bankAccountId: world.usdBankId!,
    exchangeRate: "3.75000000",
    actorId: TR_ACTOR,
  });
  expect(issued.lc.status).toBe("ISSUED");
  expect(issued.journalEntryId).not.toBeNull();
  const issueLines = await journalLines("letters_of_credit", created.id, "issue");
  expect(issueLines).toEqual([
    {
      direction: "DEBIT",
      code: world.marginAccountCode!,
      amount: "20000.0000",
      currency: "USD",
      exchangeRate: "3.75000000",
    },
    {
      direction: "CREDIT",
      code: world.glUsdBankCode!,
      amount: "20000.0000",
      currency: "USD",
      exchangeRate: "3.75000000",
    },
  ]);
  // INV-019 exact: the OUT movement's base equals the journal line's
  // base (20000 × 3.75 = 75000, the 4dp half-up capture).
  const issueMovements = await movementsOf("letters_of_credit", created.id);
  expect(issueMovements).toEqual([
    {
      direction: "OUT",
      amount: "20000.0000",
      currencyCode: "USD",
      exchangeRate: "3.75000000",
      baseAmount: "75000.0000",
    },
  ]);
  return created.id;
}

describe("PHASE-051 W-34 — THE LC LIFECYCLE (T-05: the G-64 pairs at the journal-line level)", () => {
  it("THE GOLDEN-CLASS ARM: issue → the margin deposit (DR LC_MARGIN_DEPOSIT · CR the bank, FX at the contract rate, INV-019 exact) → the amendment's G-64 adjustment → the checklist stamps → the fee's bank-charge pair → the retirement reversal (the settled pair + the journal stamps TOGETHER)", async () => {
    const lcId = await withTenant(TENANT_TRADE, () => goldenLifecycle());

    // ── THE AMENDMENT (VALUE + the margin increase on the same pair) ─
    const amended = await withTenant(TENANT_TRADE, () =>
      lcs.amend(lcId, {
        changeType: "VALUE",
        valueFrom: "100000.0000",
        valueTo: "120000.0000",
        marginTo: "30000.0000",
        bankAccountId: world.usdBankId!,
        exchangeRate: "3.75000000",
        actorId: TR_ACTOR,
      }),
    );
    expect(amended.amendment.amendmentNo).toBe(1);
    expect(amended.lc.amount).toBe("120000.0000");
    expect(amended.lc.marginAmount).toBe("30000.0000");
    const amendmentLines = await withTenant(TENANT_TRADE, () =>
      journalLines("lc_amendment", amended.amendment.id),
    );
    expect(amendmentLines).toEqual([
      {
        direction: "DEBIT",
        code: world.marginAccountCode!,
        amount: "10000.0000",
        currency: "USD",
        exchangeRate: "3.75000000",
      },
      {
        direction: "CREDIT",
        code: world.glUsdBankCode!,
        amount: "10000.0000",
        currency: "USD",
        exchangeRate: "3.75000000",
      },
    ]);
    const amendmentMovements = await withTenant(TENANT_TRADE, () =>
      movementsOf("lc_amendment", amended.amendment.id),
    );
    expect(amendmentMovements).toHaveLength(1);
    expect(amendmentMovements[0]!.direction).toBe("OUT");
    expect(amendmentMovements[0]!.baseAmount).toBe("37500.0000");

    // ── THE CHECKLIST (the bank's ceremony + the discrepancy note) ──
    const invoice = await withTenant(TENANT_TRADE, () =>
      lcs.recordDocument(lcId, {
        docType: "COMMERCIAL INVOICE",
        presented: true,
        actorId: TR_ACTOR,
      }),
    );
    expect(invoice.presented).toBe(true);
    expect(invoice.presentedAt).not.toBeNull();
    expect(invoice.verified).toBe(false);
    const noted = await withTenant(TENANT_TRADE, () =>
      lcs.recordDocument(lcId, {
        docType: "COMMERCIAL INVOICE",
        discrepancyNotes: "late presentation — 3 days past the window",
        actorId: TR_ACTOR,
      }),
    );
    expect(noted.discrepancyNotes).toContain("late presentation");
    const verified = await withTenant(TENANT_TRADE, () =>
      lcs.recordDocument(lcId, {
        docType: "COMMERCIAL INVOICE",
        verified: true,
        actorId: TR_ACTOR,
      }),
    );
    expect(verified.verified).toBe(true);
    expect(verified.verifiedAt).not.toBeNull();

    // ── THE FEE (the financial-charges discipline — fee_1) ──────────
    const fee = await withTenant(TENANT_TRADE, () =>
      lcs.fee(lcId, {
        amount: "450.0000",
        bankAccountId: world.usdBankId!,
        exchangeRate: "3.75000000",
        actorId: TR_ACTOR,
      }),
    );
    expect(fee.feeSequence).toBe(1);
    const feeLines = await withTenant(TENANT_TRADE, () =>
      journalLines("letters_of_credit", lcId, "fee_1"),
    );
    expect(feeLines).toEqual([
      {
        direction: "DEBIT",
        code: world.bankChargesAccountCode!,
        amount: "450.0000",
        currency: "USD",
        exchangeRate: "3.75000000",
      },
      {
        direction: "CREDIT",
        code: world.glUsdBankCode!,
        amount: "450.0000",
        currency: "USD",
        exchangeRate: "3.75000000",
      },
    ]);
    // A SECOND fee lands on its OWN key (fee_2 — the INV-028 precedent).
    const secondFee = await withTenant(TENANT_TRADE, () =>
      lcs.fee(lcId, {
        amount: "120.0000",
        bankAccountId: world.usdBankId!,
        exchangeRate: "3.75000000",
        actorId: TR_ACTOR,
      }),
    );
    expect(secondFee.feeSequence).toBe(2);
    // Three entries so far: issue + fee_1 + fee_2 (the retirement
    // adds the fourth below).
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", lcId))).toBe(3);

    // ── THE RETIREMENT (the G-64 reversal of the CURRENT margin) ────
    const retired = await withTenant(TENANT_TRADE, () =>
      lcs.retire(lcId, {
        bankAccountId: world.usdBankId!,
        exchangeRate: "3.75000000",
        actorId: TR_ACTOR,
      }),
    );
    expect(retired.lc.status).toBe("RETIRED");
    expect(retired.lc.settledAt).not.toBeNull();
    expect(retired.lc.retirementJournalEntryId).toBe(retired.journalEntryId);
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", lcId))).toBe(4);
    const retirementLines = await withTenant(TENANT_TRADE, () =>
      journalLines("letters_of_credit", lcId, "retirement"),
    );
    expect(retirementLines).toEqual([
      {
        direction: "DEBIT",
        code: world.glUsdBankCode!,
        amount: "30000.0000",
        currency: "USD",
        exchangeRate: "3.75000000",
      },
      {
        direction: "CREDIT",
        code: world.marginAccountCode!,
        amount: "30000.0000",
        currency: "USD",
        exchangeRate: "3.75000000",
      },
    ]);
    // The margin release returns to the bank (INV-019 exact). The
    // register-sourced movements: the deposit OUT and the release IN
    // (the fees source their own events — 'lc_fee' keyed by the fee
    // journals, the one-movement-per-source-side law).
    const movements = await withTenant(TENANT_TRADE, () =>
      movementsOf("letters_of_credit", lcId),
    );
    expect(movements).toHaveLength(2);
    expect(movements[0]!.direction).toBe("OUT");
    expect(movements[0]!.amount).toBe("20000.0000");
    expect(movements[1]!.direction).toBe("IN");
    expect(movements[1]!.amount).toBe("30000.0000");
    // THE FEE MOVEMENTS: each fee event its own row (INV-019 exact).
    const feeMovements = await withTenant(TENANT_TRADE, async () => {
      const rows = await requireTenantContext().tx!.execute<{
        direction: string;
        amount: string;
        baseAmount: string;
      }>(sql`
        SELECT direction, amount::text AS amount, base_amount::text AS "baseAmount"
        FROM cash_movements WHERE source_type = 'lc_fee' AND tenant_id = ${TENANT_TRADE}
        ORDER BY amount DESC`);
      return rows.rows;
    });
    expect(feeMovements.map((row) => [row.direction, row.amount])).toEqual([
      ["OUT", "450.0000"],
      ["OUT", "120.0000"],
    ]);
    // THE LEDGER ARITHMETIC: the margin asset's net over the whole
    // lifecycle is ZERO (deposited 20000 + 10000 − released 30000).
    const marginNet = await withTenant(TENANT_TRADE, async () => {
      const rows = await requireTenantContext().tx!.execute<{ n: string }>(sql`
        SELECT COALESCE(SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.base_amount
                                  ELSE -jl.base_amount END), 0)::text AS n
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.tenant_id = ${TENANT_TRADE} AND a.code = ${world.marginAccountCode!}
          AND je.source_type IN ('letters_of_credit', 'lc_amendment')`);
      return rows.rows[0]!.n;
    });
    expect(marginNet).toBe("0.0000");
    // The bank account's movement ledger ties (INV-019): the
    // register-sourced OUT 20000 + IN 30000 and the fee events' OUT 450
    // + OUT 120 — the movements' bases equal the journal lines' bases
    // by construction (asserted above), so the tie is exact.
  });

  it("THE ZERO-MARGIN ISSUE (the 0119 floor's own shape): no deposit journal, the stamp stays NULL, the register still issues — and the retirement REFUSES (the reversal has nothing to reverse)", async () => {
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "50000.0000",
        marginAmount: "0.0000",
        issuingBank: "Al Rajhi",
        beneficiaryName: "Domestic Seller",
        applicantName: "TR Trading Co",
        expiryDate: "2027-06-30",
        actorId: TR_ACTOR,
      });
      const issued = await lcs.issue(created.id, { actorId: TR_ACTOR });
      expect(issued.lc.status).toBe("ISSUED");
      expect(issued.journalEntryId).toBeNull();
      expect(issued.lc.marginJournalEntryId).toBeNull();
      return created.id;
    });
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.retire(lcId, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LcMarginShapeError);
  });

  it("G-64'S EXACTLY-ONCE (INV-013 + the CAS): the second issue is refused by the ladder NAMING the record; the source key's entry count stays ONE; the journal-level replay is ALREADY_POSTED", async () => {
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "10000.0000",
        marginAmount: "2000.0000",
        issuingBank: "SNB",
        beneficiaryName: "B",
        applicantName: "A",
        expiryDate: "2027-06-30",
        actorId: TR_ACTOR,
      });
      await lcs.issue(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR });
      return created.id;
    });
    const second = await withTenant(TENANT_TRADE, () =>
      lcs.issue(lcId, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR }).catch((e: unknown) => e),
    );
    expect(second).toBeInstanceOf(LcStateError);
    expect((second as LcStateError).details).toMatchObject({ lcId, from: "ISSUED" });
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", lcId))).toBe(1);
    // INV-013's own surface at the service level: a duplicate delivery
    // of the consumed source key returns the STORED result —
    // idempotentReplay: true, ZERO new ledger effects.
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const glBank = await withTenant(TENANT_TRADE, () => tenancy.findAccountByCode("1121"));
    expect(glBank).toBeDefined();
    const engineReplay = await withTenant(TENANT_TRADE, () =>
      posting.post(
        {
          source: { docType: "letters_of_credit", docId: lcId, operation: "issue" },
          entryDate: "2026-11-20",
          currency: "SAR",
          lines: [
            { purpose: "LC_MARGIN_DEPOSIT", direction: "DEBIT", amount: "1.0000" },
            { accountId: glBank!.id, direction: "CREDIT", amount: "1.0000" },
          ],
        },
        { postedBy: TR_ACTOR },
      ),
    );
    expect(engineReplay.idempotentReplay).toBe(true);
    expect(engineReplay.journalEntryId).not.toBeNull();
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", lcId))).toBe(1);
  });

  it("THE UNMAPPED-PURPOSE FAIL-CLOSED (G-64's own law): LC_MARGIN_DEPOSIT superseded → PURPOSE_NOT_MAPPED with ZERO RESIDUE (no journal, no movement, the row stays DRAFT); restored → the re-run GREEN", async () => {
    await withTenant(TENANT_TRADE, () => supersedePurposeKey("LC_MARGIN_DEPOSIT"));
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "8000.0000",
        marginAmount: "1600.0000",
        issuingBank: "Riyad Bank",
        beneficiaryName: "C",
        applicantName: "A",
        expiryDate: "2027-06-30",
        actorId: TR_ACTOR,
      });
      const refused = await lcs
        .issue(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR })
        .catch((error: unknown) => error);
      // The engine's own refusal (fail-closed — no fallback account),
      // through the `purpose:` line.
      expect((refused as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
      return created.id;
    });
    // ZERO RESIDUE: no journal, no movement, the row stays DRAFT.
    expect(await withTenant(TENANT_TRADE, () => entryCount("letters_of_credit", lcId))).toBe(0);
    expect(await withTenant(TENANT_TRADE, () => movementsOf("letters_of_credit", lcId))).toEqual([]);
    const stayedDraft = await withTenant(TENANT_TRADE, async () => {
      const rows = await requireTenantContext().tx!.execute<{ status: string }>(sql`
        SELECT status FROM letters_of_credit WHERE id = ${lcId}`);
      return rows.rows[0]!.status;
    });
    expect(stayedDraft).toBe("DRAFT");
    // THE FLIP-AND-RESTORE: the mapping restored → the re-run GREEN.
    await withTenant(TENANT_TRADE, () => restorePurposeKey("LC_MARGIN_DEPOSIT", "1180"));
    const reRun = await withTenant(TENANT_TRADE, () =>
      lcs.issue(lcId, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR }),
    );
    expect(reRun.lc.status).toBe("ISSUED");
    expect(reRun.journalEntryId).not.toBeNull();
  });

  it("THE AMENDMENT WINDOWS (the typed-change law + the freshness law + the margin decrease's release): every refusal names the shape; the decrease posts the REVERSED pair with the IN movement", async () => {
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "5000.0000",
        marginAmount: "1000.0000",
        issuingBank: "Bank AlJazira",
        beneficiaryName: "D",
        applicantName: "A",
        expiryDate: "2027-05-31",
        actorId: TR_ACTOR,
      });
      await lcs.issue(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR });
      return created.id;
    });
    // A DRAFT amendment world: the typed-change law's missing pair.
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.amend(lcId, { changeType: "VALUE", valueTo: "6000.0000", actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LcAmendmentInvalidError);
    // The freshness law: the unchanged pair refused.
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.amend(lcId, {
          changeType: "VALUE",
          valueFrom: "5000.0000",
          valueTo: "5000.0000",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(LcAmendmentInvalidError);
    // The from-value must equal the live register.
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.amend(lcId, {
          changeType: "VALUE",
          valueFrom: "4000.0000",
          valueTo: "6000.0000",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(LcAmendmentInvalidError);
    // The VALIDITY floor: the new expiry precedes the issuance.
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.amend(lcId, {
          changeType: "VALIDITY",
          expiryFrom: "2027-05-31",
          expiryTo: "2025-01-01",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(LcAmendmentInvalidError);
    // THE MARGIN DECREASE: the reversed pair + the IN movement.
    const decreased = await withTenant(TENANT_TRADE, () =>
      lcs.amend(lcId, {
        changeType: "VALIDITY",
        expiryFrom: "2027-05-31",
        expiryTo: "2027-08-31",
        marginTo: "600.0000",
        bankAccountId: world.sarBankId!,
        actorId: TR_ACTOR,
      }),
    );
    expect(decreased.lc.marginAmount).toBe("600.0000");
    const lines = await withTenant(TENANT_TRADE, () =>
      journalLines("lc_amendment", decreased.amendment.id),
    );
    expect(lines.map((line) => [line.direction, line.code, line.amount])).toEqual([
      ["DEBIT", world.glSarBankCode!, "400.0000"],
      ["CREDIT", world.marginAccountCode!, "400.0000"],
    ]);
    const movements = await withTenant(TENANT_TRADE, () =>
      movementsOf("lc_amendment", decreased.amendment.id),
    );
    expect(movements).toHaveLength(1);
    expect(movements[0]!.direction).toBe("IN");
  });

  it("THE CHECKLIST MONOTONE LAW (the 0119 floors' fold VERBATIM): the unpresented verification refused; the regressing stamps refused; the unpresented document never verified; the closed register refuses the act", async () => {
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "3000.0000",
        marginAmount: "600.0000",
        issuingBank: "ANB",
        beneficiaryName: "E",
        applicantName: "A",
        expiryDate: "2027-04-30",
        actorId: TR_ACTOR,
      });
      await lcs.issue(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR });
      return created.id;
    });
    // The unpresented document is never verified.
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.recordDocument(lcId, { docType: "BILL OF LADING", verified: true, actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LcChecklistStateError);
    // Presented, then the regressing stamp refused.
    await withTenant(TENANT_TRADE, () =>
      lcs.recordDocument(lcId, { docType: "BILL OF LADING", presented: true, actorId: TR_ACTOR }),
    );
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.recordDocument(lcId, { docType: "BILL OF LADING", presented: false, actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LcChecklistStateError);
    const verified = await withTenant(TENANT_TRADE, () =>
      lcs.recordDocument(lcId, { docType: "BILL OF LADING", verified: true, actorId: TR_ACTOR }),
    );
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.recordDocument(lcId, { docType: "BILL OF LADING", verified: false, actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LcChecklistStateError);
    expect(verified.verified).toBe(true);
    // The checklist rides the live instrument only: a DRAFT register
    // row refuses the act.
    const draftLc = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "100.0000",
        marginAmount: "20.0000",
        issuingBank: "Bank",
        beneficiaryName: "F",
        applicantName: "A",
        expiryDate: "2027-04-30",
        actorId: TR_ACTOR,
      });
      return created.id;
    });
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.recordDocument(draftLc, { docType: "INVOICE", presented: true, actorId: TR_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LcStateError);
  });

  it("THE MARGIN EXIT LAW: the margined cancellation refused (the deposit's exit is the retirement pair); the margin-free ISSUED row cancels freely; the DRAFT row cancels freely", async () => {
    // The margined instrument: the cancellation refuses.
    const marginedId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "9000.0000",
        marginAmount: "1800.0000",
        issuingBank: "Bank",
        beneficiaryName: "G",
        applicantName: "A",
        expiryDate: "2027-07-31",
        actorId: TR_ACTOR,
      });
      await lcs.issue(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR });
      return created.id;
    });
    const refused = await withTenant(TENANT_TRADE, () =>
      lcs.cancel(marginedId, { actorId: TR_ACTOR }).catch((e: unknown) => e),
    );
    expect(refused).toBeInstanceOf(LcMarginShapeError);
    // The margin-free ISSUED row cancels freely.
    const freeIssuedId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "700.0000",
        marginAmount: "0.0000",
        issuingBank: "Bank",
        beneficiaryName: "H",
        applicantName: "A",
        expiryDate: "2027-07-31",
        actorId: TR_ACTOR,
      });
      await lcs.issue(created.id, { actorId: TR_ACTOR });
      return created.id;
    });
    const cancelled = await withTenant(TENANT_TRADE, () =>
      lcs.cancel(freeIssuedId, { actorId: TR_ACTOR }),
    );
    expect(cancelled.status).toBe("CANCELLED");
    // The DRAFT row cancels freely (nothing exists at the bank yet).
    const draftId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "300.0000",
        marginAmount: "60.0000",
        issuingBank: "Bank",
        beneficiaryName: "I",
        applicantName: "A",
        expiryDate: "2027-07-31",
        actorId: TR_ACTOR,
      });
      return created.id;
    });
    expect((await withTenant(TENANT_TRADE, () => lcs.cancel(draftId, { actorId: TR_ACTOR }))).status).toBe("CANCELLED");
  });

  it("THE BANK-ACCOUNT FLOOR (the treasury discipline's trade face): a wrong-currency account refused with the typed name; an unknown id refused (A7-shaped); the fee on a DRAFT register refused (no instrument at the bank yet)", async () => {
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "USD",
        amount: "2000.0000",
        marginAmount: "400.0000",
        exchangeRate: "3.75000000",
        issuingBank: "Bank",
        beneficiaryName: "J",
        applicantName: "A",
        expiryDate: "2027-09-30",
        actorId: TR_ACTOR,
      });
      return created.id;
    });
    // The wrong-currency account: the SAR bank against a USD LC.
    const wrongCurrency = await withTenant(TENANT_TRADE, () =>
      lcs
        .issue(lcId, {
          bankAccountId: world.sarBankId!,
          exchangeRate: "3.75000000",
          actorId: TR_ACTOR,
        })
        .catch((e: unknown) => e),
    );
    expect(wrongCurrency).toBeInstanceOf(LcBankAccountInvalidError);
    // The unknown account (A7-shaped: unknown == foreign).
    const unknown = await withTenant(TENANT_TRADE, () =>
      lcs
        .issue(lcId, {
          bankAccountId: "00000000-0000-0000-0000-0000000000aa",
          exchangeRate: "3.75000000",
          actorId: TR_ACTOR,
        })
        .catch((e: unknown) => e),
    );
    expect(unknown).toBeInstanceOf(LcBankAccountInvalidError);
    // The fee on a DRAFT register: no instrument at the bank yet.
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.fee(lcId, {
          amount: "10.0000",
          bankAccountId: world.usdBankId!,
          exchangeRate: "3.75000000",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(LcStateError);
  });

  it("THE TERMINAL REGISTER: the retired row refuses every act; the unknown id is the typed 404 shape", async () => {
    const lcId = await withTenant(TENANT_TRADE, async () => {
      const created = await lcs.create({
        currency: "SAR",
        amount: "4000.0000",
        marginAmount: "800.0000",
        issuingBank: "Bank",
        beneficiaryName: "K",
        applicantName: "A",
        expiryDate: "2027-02-28",
        actorId: TR_ACTOR,
      });
      await lcs.issue(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR });
      await lcs.retire(created.id, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR });
      return created.id;
    });
    const acts: (() => Promise<unknown>)[] = [
      () => lcs.issue(lcId, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR }),
      () =>
        lcs.amend(lcId, {
          changeType: "OTHER",
          summary: "after the fact",
          actorId: TR_ACTOR,
        }),
      () => lcs.retire(lcId, { bankAccountId: world.sarBankId!, actorId: TR_ACTOR }),
      () => lcs.cancel(lcId, { actorId: TR_ACTOR }),
      () =>
        lcs.fee(lcId, { amount: "1.0000", bankAccountId: world.sarBankId!, actorId: TR_ACTOR }),
      () => lcs.recordDocument(lcId, { docType: "INVOICE", presented: true, actorId: TR_ACTOR }),
    ];
    for (const act of acts) {
      await expect(withTenant(TENANT_TRADE, () => act())).rejects.toBeInstanceOf(LcStateError);
    }
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.find("00000000-0000-0000-0000-0000000000cc"),
      ),
    ).rejects.toBeInstanceOf(LcRecordNotFoundError);
  });

  it("THE REGISTER'S OWN FLOORS (the service-level typed pre-checks before the DB): the foreign-currency LC without the contract rate refused up front; the provisional numbering reserves uniquely", async () => {
    await expect(
      withTenant(TENANT_TRADE, () =>
        lcs.create({
          currency: "EUR",
          amount: "1000.0000",
          marginAmount: "200.0000",
          exchangeRate: null,
          issuingBank: "Bank",
          beneficiaryName: "L",
          applicantName: "A",
          expiryDate: "2027-10-31",
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toThrow(/contract rate is required/);
    const first = await withTenant(TENANT_TRADE, () =>
      lcs.create({
        currency: "SAR",
        amount: "100.0000",
        marginAmount: "20.0000",
        issuingBank: "Bank",
        beneficiaryName: "M",
        applicantName: "A",
        expiryDate: "2027-10-31",
        actorId: TR_ACTOR,
      }),
    );
    const second = await withTenant(TENANT_TRADE, () =>
      lcs.create({
        currency: "SAR",
        amount: "100.0000",
        marginAmount: "20.0000",
        issuingBank: "Bank",
        beneficiaryName: "N",
        applicantName: "A",
        expiryDate: "2027-10-31",
        actorId: TR_ACTOR,
      }),
    );
    expect(first.lcNo).not.toEqual(second.lcNo);
  });
});
