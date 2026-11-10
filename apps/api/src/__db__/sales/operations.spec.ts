import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import * as treasuryStore from "../../modules/treasury/infrastructure/treasury.store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { OpeningBalancesPostingService } from "../../modules/accounting/application/opening-balances-service";
import type { EmailService } from "../../modules/notifications/application/email-service";
import { InvoiceOverdueService } from "../../modules/sales/application/reps";
import {
  S_ACTOR,
  S_CASHIER,
  S_JAN,
  S_MAR,
  S_SALES,
  TENANT_S,
  allocations,
  arQueries,
  clearSalesSetting,
  creditNotes,
  quotations,
  receipts,
  salesInvoices,
  salesOrders,
  salesReallocations,
  sOpeningDrafts,
  sPeriods,
  sPosting,
  sReconciliation,
  setSalesSetting,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-012 operations packs (the phase §6 requirements beyond the golden
 * posting suite): the BR-001 credit-limit matrix at approval (block/warn/
 * allow × limit/overdue + the audited override), BR-004 return-window
 * boundaries (day 14 ok, day 16 cited, 0 disables dates but never the
 * reference), BR-006 quotation expiry (send boundary + the sweep), the G-16
 * AR side (opening balances are allocatable open items from entry #1,
 * INV-009 exact), RC-01 (20 randomized AR operations reconcile exactly),
 * RC-03 (seeded drift → BROKEN + PC-04 lock block + the documented repair),
 * RC-10 (aging/statement determinism — byte-identical re-runs, bucket sums,
 * the INV-009 statement footer), the invoice.overdue exactly-once job,
 * INV-016 allocation bounds with on-account remainders (BR-027), CC-02
 * concurrent receipts on one invoice, the audited re-allocation documents
 * (INSERT-only grants), and CC-03/INV-021 numbering under 50-way parallel
 * posts.
 */

let fixture: SalesFixture;

beforeAll(async () => {
  fixture = await setupSalesFixture();
});

/** A one-line NS-tax service invoice body (no VAT legs, fast packs). */
function serviceInvoice(note: string, unitPrice: string, customerId: string) {
  return {
    branchId: fixture.branchId,
    customerId,
    salesRepId: null as string | null,
    kind: "CREDIT" as const,
    invoiceDate: S_JAN,
    dueDate: null as string | null,
    currencyCode: "SAR",
    exchangeRate: null as string | null,
    orderId: null as string | null,
    deliveryId: null as string | null,
    warehouseId: null as string | null,
    cashAccountId: null as string | null,
    note,
    noteAr: null as string | null,
    actorId: S_SALES,
    lines: [
      {
        itemId: null,
        accountId: fixture.gl.serviceAccount,
        deliveryLineId: null,
        description: "operations pack line",
        descriptionAr: null,
        qty: "1",
        unitPrice,
        discountAmount: null,
        taxCodeId: fixture.taxCodeIds.notSubject,
        batchId: null,
        serialIds: null,
        note: null,
      },
    ],
  };
}

async function createSubmitApprove(note: string, unitPrice: string, customerId: string) {
  const invoice = await withTenant(TENANT_S, () =>
    salesInvoices.create(serviceInvoice(note, unitPrice, customerId)),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
  return invoice.id;
}

// ---------------------------------------------------------------------------
// BR-001 — the credit-limit matrix (T10)
// ---------------------------------------------------------------------------

describe("BR-001 — credit-limit enforcement at approval (block / warn / allow / override)", () => {
  const limited = () => fixture.limitedCustomerId;
  let overLimitId = "";

  it("block: the over-limit approval is refused with the exact math (8,200 + 2,500 > 10,000)", async () => {
    // Invoice 1 (8,200): 0 + 8,200 ≤ 10,000 → approves + posts even in block.
    await setSalesSetting("sales.credit_limit_action", "block");
    const firstId = await createSubmitApprove("BR-001 invoice 1 (8,200)", "8200.000000", limited());
    await withTenant(TENANT_S, () => salesInvoices.post(firstId, S_ACTOR));

    // Invoice 2 (2,500): open 8,200 + 2,500 = 10,700 > 10,000 → BLOCK.
    const second = await withTenant(TENANT_S, () =>
      salesInvoices.create(serviceInvoice("BR-001 invoice 2 (2,500)", "2500.000000", limited())),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(second.id, S_SALES));
    overLimitId = second.id;

    let caught: unknown;
    try {
      await withTenant(TENANT_S, () => salesInvoices.approve(second.id, S_ACTOR, false));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "CREDIT_LIMIT_EXCEEDED" });
    // The typed payload carries the exact math (BR-001's worked example).
    expect((caught as Error).message).toContain("8200.0000 + 2500.0000 > 10000.0000");
    expect((caught as Error).message).toContain("overdue invoices: 1"); // invoice 1 is past due

    // Zero residue: the document stays PENDING_APPROVAL, nothing posted.
    const row = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(second.id));
    expect(row!.status).toBe("PENDING_APPROVAL");
    expect(row!.postedJournalId).toBeNull();
  });

  it("warn: the same document approves with the decision + math recorded on it", async () => {
    await setSalesSetting("sales.credit_limit_action", "warn");
    const approved = await withTenant(TENANT_S, () =>
      salesInvoices.approve(overLimitId, S_ACTOR, false),
    );
    const check = approved.creditCheck as { decision: string; posture: string; math: string };
    expect(check.decision).toBe("WARN");
    expect(check.posture).toBe("warn");
    expect(check.math).toContain("8200.0000 + 2500.0000 > 10000.0000");
    // Warn never blocks the post path.
    await withTenant(TENANT_S, () => salesInvoices.post(overLimitId, S_ACTOR));
    const posted = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(overLimitId));
    expect(posted!.status).toBe("POSTED");
  });

  it("allow: no check runs at all (posture allow — the ignore posture)", async () => {
    await setSalesSetting("sales.credit_limit_action", "allow");
    const thirdId = await createSubmitApprove("BR-001 invoice 3 (5,000)", "5000.000000", limited());
    const approved = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(thirdId));
    const check = approved!.creditCheck as { decision: string; math: string } | null;
    expect(check).not.toBeNull();
    expect(check!.decision).toBe("ALLOW");
    expect(check!.math).toBe("posture allow — no check");
    await withTenant(TENANT_S, () => salesInvoices.post(thirdId, S_ACTOR));
  });

  it("override: sales.credit_check.override converts BLOCK to WARN, audited, then posts", async () => {
    await setSalesSetting("sales.credit_limit_action", "block");
    const fourth = await withTenant(TENANT_S, () =>
      salesInvoices.create(serviceInvoice("BR-001 invoice 4 (2,000)", "2000.000000", limited())),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(fourth.id, S_SALES));

    const approved = await withTenant(TENANT_S, () =>
      salesInvoices.approve(fourth.id, S_ACTOR, true),
    );
    const check = approved.creditCheck as { decision: string; override: boolean; math: string };
    expect(check.decision).toBe("WARN");
    expect(check.override).toBe(true);
    expect(check.math).toContain("overridden");

    // The override is its own audit event (risky action, never silent).
    const su = await superuserClient();
    const audited = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'sales.credit_check_overridden' AND entity_id = $2`,
      [TENANT_S, fourth.id],
    );
    await su.end();
    expect(audited.rows[0]!.n).toBe(1);

    await withTenant(TENANT_S, () => salesInvoices.post(fourth.id, S_ACTOR));
    await clearSalesSetting("sales.credit_limit_action");
  });
});

// ---------------------------------------------------------------------------
// BR-004 — return-window boundaries (T7)
// ---------------------------------------------------------------------------

describe("BR-004 — the return window (day 14 ok, day 16 cited, 0 disables dates, never the reference)", () => {
  it("a note 14 days after the invoice posts; day 16 is rejected citing the window", async () => {
    const invoiceId = await (await import("./fixtures")).quickPostedInvoice("BR-004 window target");
    const lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invoiceId));
    const line = lines[0]!;
    const noteBody = (noteDate: string) => ({
      branchId: fixture.branchId,
      salesRepId: null,
      invoiceId,
      noteDate,
      note: "BR-004 boundary",
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          invoiceLineId: line.id,
          qty: "1",
          unitPrice: null,
          discountAmount: null,
          taxCodeId: null,
          returnToStock: false,
          batchId: null,
          serialIds: null,
          description: null,
          descriptionAr: null,
          note: null,
        },
      ],
    });

    // Day 14 (2026-01-15 + 14): exactly at the boundary → allowed.
    const atBoundary = await withTenant(TENANT_S, () => creditNotes.create(noteBody("2026-01-29")));
    await withTenant(TENANT_S, () => creditNotes.submit(atBoundary.id, S_SALES));
    await withTenant(TENANT_S, () => creditNotes.approve(atBoundary.id, S_ACTOR));
    const posted = await withTenant(TENANT_S, () => creditNotes.post(atBoundary.id, S_ACTOR));
    expect(posted.noteNo).toMatch(/^CRN-2026-\d{6}$/);

    // Day 16: beyond the window → typed rejection with the window cited.
    let caught: unknown;
    try {
      await withTenant(TENANT_S, () => creditNotes.create(noteBody("2026-01-31")));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "RETURN_WINDOW_EXCEEDED" });
    expect((caught as Error).message).toContain("14");
  });

  it("return_window_days = 0 disables the date check but NEVER the reference requirement", async () => {
    await setSalesSetting("sales.return_window_days", 0);
    const invoiceId = await (await import("./fixtures")).quickPostedInvoice("BR-004 unlimited target");
    const lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invoiceId));

    // Months later — dates disabled, the note creates cleanly.
    const late = await withTenant(TENANT_S, () =>
      creditNotes.create({
        branchId: fixture.branchId,
        salesRepId: null,
        invoiceId,
        noteDate: "2026-06-01",
        note: "BR-004 window disabled",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            invoiceLineId: lines[0]!.id,
            qty: "1",
            unitPrice: null,
            discountAmount: null,
            taxCodeId: null,
            returnToStock: false,
            batchId: null,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    expect(late.status).toBe("DRAFT");
    await clearSalesSetting("sales.return_window_days");

    // The reference requirement is structural: a DRAFT (unposted) invoice
    // can never be referenced (CreditNoteRefInvalidError).
    const draft = await withTenant(TENANT_S, () =>
      salesInvoices.create(serviceInvoice("BR-004 unposted ref target", "5.000000", fixture.customerId)),
    );
    await expect(
      withTenant(TENANT_S, () =>
        creditNotes.create({
          branchId: fixture.branchId,
          salesRepId: null,
          invoiceId: draft.id,
          noteDate: S_JAN,
          note: "BR-004 bad reference",
          noteAr: null,
          actorId: S_SALES,
          lines: [
            {
              invoiceLineId: "00000000-0000-0000-0000-000000000000",
              qty: "1",
              unitPrice: null,
              discountAmount: null,
              taxCodeId: null,
              returnToStock: false,
              batchId: null,
              serialIds: null,
              description: null,
              descriptionAr: null,
              note: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "CREDIT_NOTE_REF_INVALID" });
  });
});

// ---------------------------------------------------------------------------
// BR-006 — quotation validity (T2)
// ---------------------------------------------------------------------------

describe("BR-006 — quotation validity (expired quotes cannot send/accept/convert)", () => {
  it("a lapsed quote refuses to send; the sweep flips lapsed SENT quotes to EXPIRED; accept refuses", async () => {
    const body = (quoteDate: string, validUntil: string) => ({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      salesRepId: null,
      quoteDate,
      validUntil,
      currencyCode: "SAR",
      exchangeRate: null,
      note: "BR-006 pack",
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          itemId: fixture.items.a,
          description: null,
          descriptionAr: null,
          qty: "1",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: fixture.taxCodeIds.notSubject,
          note: null,
        },
      ],
    });

    // A quote whose validity already lapsed → send is refused (BR-006).
    const stale = await withTenant(TENANT_S, () => quotations.create(body("2026-01-01", "2026-01-20")));
    await expect(withTenant(TENANT_S, () => quotations.send(stale.id, S_SALES))).rejects.toMatchObject(
      { code: "QUOTATION_EXPIRED" },
    );

    // A live quote sends (validity well in the future).
    const live = await withTenant(TENANT_S, () => quotations.create(body("2026-01-01", "2027-12-31")));
    await withTenant(TENANT_S, () => quotations.send(live.id, S_SALES));
    const sent = await withTenant(TENANT_S, () => quotations.find(live.id));
    expect(sent.status).toBe("SENT");
    expect(sent.quoteNo).toMatch(/^QOT-\d{4}-\d{6}$/);

    // The sweep: seed one lapsed SENT quote directly (send refuses lapsed
    // drafts, so the lapsed-SENT state is reached by time passing — the
    // superuser seed mirrors exactly that), sweep flips it to EXPIRED.
    const su = await superuserClient();
    const lapsedId = "7e7e7e7e-0000-4000-8000-0000000000b6";
    await su.query(
      `INSERT INTO quotations (id, tenant_id, branch_id, customer_id, quote_date, valid_until,
                               currency_code, status, quote_no, sent_at, sent_by,
                               total_net, total_tax, total_gross)
       VALUES ($1, $2, $3, $4, '2026-01-01', '2026-01-31', 'SAR', 'SENT', 'QOT-2026-900001',
               now() - interval '300 days', $5, 100, 0, 100)
       ON CONFLICT (id) DO NOTHING`,
      [lapsedId, TENANT_S, fixture.branchId, fixture.customerId, S_SALES],
    );
    await su.end();

    const flipped = await withTenant(TENANT_S, () => quotations.sweepExpired(S_ACTOR));
    expect(flipped).toBe(1);
    const expired = await withTenant(TENANT_S, () => quotations.find(lapsedId));
    expect(expired.status).toBe("EXPIRED");

    // An EXPIRED quote cannot be accepted/converted — re-issue as new (BR-006).
    await expect(
      withTenant(TENANT_S, () =>
        salesOrders.acceptQuotation({
          quotationId: lapsedId,
          warehouseId: fixture.warehouseId,
          expectedDate: null,
          note: null,
          actorId: S_SALES,
          reserve: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "SALES_DOCUMENT_STATE" });
  });
});

// ---------------------------------------------------------------------------
// G-16 AR side — opening balances (INV-009 from entry #1)
// ---------------------------------------------------------------------------

describe("G-16 AR side — opening balances settle like any invoice (INV-009 from entry #1)", () => {
  it("the customer's opening balance is an allocatable open item a receipt settles exactly", async () => {
    // Opening AR draft (+1,000 = the customer owes us).
    const existing = await withTenant(TENANT_S, () => sOpeningDrafts.list("PARTNER", undefined, 100));
    const openingRows = existing.rows as unknown as { partnerId: string | null }[];
    if (!openingRows.some((row) => row.partnerId === fixture.customerId)) {
      await withTenant(TENANT_S, () =>
        sOpeningDrafts.create(S_ACTOR, {
          kind: "PARTNER",
          partnerId: fixture.customerId,
          amount: "1000.0000",
          note: "opening AR (G-16 customer side)",
        }),
      );
    }
    const audit = new AuditService(new DrizzleAuditStore());
    const openingPost = new OpeningBalancesPostingService(audit, sPosting);
    await withTenant(TENANT_S, () => openingPost.post(S_ACTOR, fixture.fiscalYearId));

    // INV-009 exact from the first entry: Σ subledger = AR_CONTROL.
    const verification = await withTenant(TENANT_S, () => arQueries.verifyInv009({ asOf: S_JAN }));
    expect(verification.ok).toBe(true);
    expect(verification.diff).toBe("0.0000");
    expect(verification.openingItems).toBeGreaterThan(0);

    // The opening item is open and allocatable.
    const items = await withTenant(TENANT_S, () => arQueries.openItems({ customerId: fixture.customerId }));
    const opening = items.find((row) => row.sourceType === "opening_balances");
    expect(opening).toBeDefined();
    expect(opening!.outstanding).toBe("1000.0000");

    // A receipt settles it exactly (the settlement proof).
    const receipt = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "1000.0000",
        exchangeRate: null,
        valueDate: S_MAR,
        reference: "opening settlement",
        description: "G-16 AR side settlement",
        descriptionAr: null,
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receipt.id,
        allocations: [{ openItemId: opening!.id, amount: "1000.0000" }],
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () => receipts.post(receipt.id, S_CASHIER));

    const after = await withTenant(TENANT_S, () => arQueries.openItems({ customerId: fixture.customerId }));
    expect(after.find((row) => row.sourceType === "opening_balances")).toBeUndefined();
    const reverified = await withTenant(TENANT_S, () => arQueries.verifyInv009({ asOf: S_MAR }));
    expect(reverified.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RC-01 / RC-03 — the AR subledger ties to AR_CONTROL; drift is detected
// ---------------------------------------------------------------------------

describe("RC-01/RC-03 — AR subledger = AR_CONTROL exact, drift detected", () => {
  it("RC-01: 20 randomized AR operations reconcile exactly (OK run)", async () => {
    let seed = 4242;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    for (let i = 0; i < 20; i += 1) {
      const amount = (rand(900) + 100).toFixed(2);
      const id = await createSubmitApprove(
        `RC-01 randomized op ${i}`,
        `${amount}`,
        fixture.customerId,
      );
      await withTenant(TENANT_S, () => salesInvoices.post(id, S_ACTOR));
    }
    const run = await withTenant(TENANT_S, () =>
      sReconciliation.runArCheck({ asOf: S_MAR, runMode: "ON_DEMAND", checkedBy: S_ACTOR }),
    );
    expect(run.status).toBe("OK");
    expect(run.controlBalance).toBe(run.subledgerBalance);
    expect(run.diffCount).toBe(0);
  });

  it("RC-03: seeded subledger drift → BROKEN + PC-04 blocks the period lock, then repairs green", async () => {
    // Seed drift via superuser tooling (the documented repair path — the
    // subledger is append-only for erp_app): capture one AR subledger row's
    // full contents, delete it, then repair by re-inserting it.
    const su = await superuserClient();
    const captured = await su.query(
      `SELECT s.* FROM partner_subledger_entries s
       WHERE s.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM treasury_allocations a WHERE a.open_item_id = s.id)
       ORDER BY s.entry_date, s.id LIMIT 1`,
      [TENANT_S],
    );
    expect(captured.rows.length).toBe(1);
    const victim = captured.rows[0]!;
    await su.query(`ALTER TABLE partner_subledger_entries DISABLE TRIGGER trg_partner_subledger_guard`);
    await su.query(`DELETE FROM partner_subledger_entries WHERE id = $1`, [victim.id]);
    await su.query(`ALTER TABLE partner_subledger_entries ENABLE TRIGGER trg_partner_subledger_guard`);
    await su.end();

    const run = await withTenant(TENANT_S, () =>
      sReconciliation.runArCheck({ asOf: S_MAR, runMode: "ON_DEMAND", checkedBy: S_ACTOR }),
    );
    expect(run.status).toBe("BROKEN");

    // PC-04: the LOCK is refused while a core check is BROKEN.
    const { findPeriodForDate } = await import("../../modules/accounting/infrastructure/accounting.store");
    const period = await withTenant(TENANT_S, () => findPeriodForDate(S_MAR));
    await withTenant(TENANT_S, () => sPeriods.softClose(S_ACTOR, period!.id));
    try {
      await expect(
        withTenant(TENANT_S, () => sPeriods.lock(S_ACTOR, period!.id)),
      ).rejects.toMatchObject({ code: "RECONCILIATION_BROKEN" });
    } finally {
      await withTenant(TENANT_S, () => sPeriods.reopen(S_ACTOR, period!.id, "RC-03 pack reopen"));
    }

    // Repair (the documented superuser-tooling drift repair): restore the
    // exact row, then re-run green.
    const su2 = await superuserClient();
    await su2.query(`ALTER TABLE partner_subledger_entries DISABLE TRIGGER trg_partner_subledger_guard`);
    await su2.query(
      `INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id, journal_line_id,
         entry_date, direction, amount, base_amount, currency_code, source_type, source_id, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [victim.id, victim.tenant_id, victim.partner_id, victim.journal_entry_id, victim.journal_line_id,
       victim.entry_date, victim.direction, victim.amount, victim.base_amount, victim.currency_code,
       victim.source_type, victim.source_id, victim.memo],
    );
    await su2.query(`ALTER TABLE partner_subledger_entries ENABLE TRIGGER trg_partner_subledger_guard`);
    await su2.end();

    const repaired = await withTenant(TENANT_S, () =>
      sReconciliation.runArCheck({ asOf: S_MAR, runMode: "ON_DEMAND", checkedBy: S_ACTOR }),
    );
    expect(repaired.status).toBe("OK");
  });
});

// ---------------------------------------------------------------------------
// RC-10 — aging + statements are deterministic as-of recomputations
// ---------------------------------------------------------------------------

describe("RC-10 — aging + statements are deterministic as-of recomputations", () => {
  it("re-running at the same as-of yields byte-identical results", async () => {
    const first = await withTenant(TENANT_S, () => arQueries.aging({ asOf: S_MAR }));
    const second = await withTenant(TENANT_S, () => arQueries.aging({ asOf: S_MAR }));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.length).toBeGreaterThan(0);

    const s1 = await withTenant(TENANT_S, () =>
      arQueries.statement({ customerId: fixture.customerId, asOf: S_MAR }),
    );
    const s2 = await withTenant(TENANT_S, () =>
      arQueries.statement({ customerId: fixture.customerId, asOf: S_MAR }),
    );
    expect(JSON.stringify(s2)).toBe(JSON.stringify(s1));
  });

  it("aging buckets sum to the total exactly; the statement footer ties (INV-009, BR-028)", async () => {
    const rows = await withTenant(TENANT_S, () => arQueries.aging({ asOf: S_MAR }));
    const customer = rows.find((row) => row.customerId === fixture.customerId);
    expect(customer).toBeDefined();
    const bucketSum = (
      Number(customer!.notDue) +
      Number(customer!.b1_30) +
      Number(customer!.b31_60) +
      Number(customer!.b61_90) +
      Number(customer!.b90Plus)
    ).toFixed(4);
    expect(bucketSum).toBe(customer!.total);

    const statement = await withTenant(TENANT_S, () =>
      arQueries.statement({ customerId: fixture.customerId, asOf: S_MAR }),
    );
    // BR-028: document currency + base totals both present.
    expect(statement.currencyCode).toBe("SAR");
    expect(statement.closingBalanceBase).toBeDefined();
    // The INV-009 footer: statement closing = the partner's subledger sum.
    expect(statement.subledgerTie.ok).toBe(true);
    expect(statement.subledgerTie.statementBalance).toBe(statement.closingBalance);
    // The opening entry is part of the deterministic statement (G-16 AR side).
    expect(statement.entries.some((entry) => entry.sourceType === "opening_balances")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// invoice.overdue — the exactly-once notification job (T11)
// ---------------------------------------------------------------------------

describe("invoice.overdue — the scan fires exactly once per invoice (audit dedupe)", () => {
  it("the first scan alerts every overdue open invoice; the re-run alerts none", async () => {
    const audit = new AuditService(new DrizzleAuditStore());
    const email = { enqueue: async () => undefined } as unknown as EmailService;
    const job = new InvoiceOverdueService(audit, email);

    const first = await withTenant(TENANT_S, () =>
      job.runOverdueScan({ runMode: "ON_DEMAND", checkedBy: S_ACTOR }),
    );
    expect(first.overdue).toBeGreaterThan(0);

    const su = await superuserClient();
    const stamped = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'sales.invoice_overdue'`,
      [TENANT_S],
    );

    // Exactly-once: the candidates query excludes already-stamped invoices.
    const second = await withTenant(TENANT_S, () =>
      job.runOverdueScan({ runMode: "NIGHTLY", checkedBy: S_ACTOR }),
    );
    const restamped = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'sales.invoice_overdue'`,
      [TENANT_S],
    );
    await su.end();

    expect(second.overdue).toBe(0);
    expect(restamped.rows[0]!.n).toBe(stamped.rows[0]!.n);
    expect(stamped.rows[0]!.n).toBe(first.overdue);
  });
});

// ---------------------------------------------------------------------------
// INV-016 — allocation bounds + on-account (BR-027); CC-02 concurrency
// ---------------------------------------------------------------------------

describe("INV-016 — allocation bounds with on-account remainders (BR-027)", () => {
  it("partial allocation is exact; over-allocation on the item is rejected at post with zero residue", async () => {
    const invoiceId = await (await import("./fixtures")).quickPostedInvoice("INV-016 target (10)");
    const items = await withTenant(TENANT_S, () => arQueries.openItems({ customerId: fixture.customerId }));
    const target = items.find((row) => row.sourceId === invoiceId)!;
    expect(target.outstanding).toBe("10.0000");

    // Receipt 10, allocate 6 → outstanding 4 (partial allocation).
    const receiptA = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "10.0000",
        exchangeRate: null,
        valueDate: S_MAR,
        reference: null,
        description: "INV-016 partial",
        descriptionAr: null,
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receiptA.id,
        allocations: [{ openItemId: target.id, amount: "6.0000" }],
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () => receipts.post(receiptA.id, S_CASHIER));
    const mid = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(target.id));
    expect(mid!.outstanding).toBe("4.0000");

    // Receipt B 10 allocated 5 → 6 + 5 = 11 > 10: the post is the
    // authoritative bound (INV-016), rejected with zero residue on BOTH sides.
    const receiptB = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "10.0000",
        exchangeRate: null,
        valueDate: S_MAR,
        reference: null,
        description: "INV-016 over-allocate",
        descriptionAr: null,
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receiptB.id,
        allocations: [{ openItemId: target.id, amount: "5.0000" }],
        actorId: S_CASHIER,
      }),
    );
    await expect(withTenant(TENANT_S, () => receipts.post(receiptB.id, S_CASHIER))).rejects.toMatchObject(
      { code: "ALLOCATION_EXCEEDS_OPEN_ITEM" },
    );
    // Zero residue: receipt B stays DRAFT, the item keeps settled 6.
    const receiptBRow = await withTenant(TENANT_S, () => treasuryStore.findReceiptById(receiptB.id));
    expect(receiptBRow!.status).toBe("DRAFT");
    const unchanged = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(target.id));
    expect(unchanged!.settledAmount).toBe("6.0000");

    // Correct the allocation to 4 → posts; the receipt keeps a 6 on-account
    // remainder (BR-027 — explicit, never silently netted).
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receiptB.id,
        allocations: [{ openItemId: target.id, amount: "4.0000" }],
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () => receipts.post(receiptB.id, S_CASHIER));
    const settled = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(target.id));
    expect(settled!.outstanding).toBe("0.0000");
    const receiptBPosted = await withTenant(TENANT_S, () => treasuryStore.findReceiptById(receiptB.id));
    expect(receiptBPosted!.allocatedAmount).toBe("4.0000"); // 10 − 4 = 6 on-account

    // Never silently netted (BR-027): the receipt posts its control side as
    // EXPLICIT settlement + on-account lines (4 settled + 6 on-account for
    // receipt B; the mirror 6+4 for receipt A) — all visible on the
    // statement, each with its own memo.
    const statement = await withTenant(TENANT_S, () =>
      arQueries.statement({ customerId: fixture.customerId, asOf: S_MAR }),
    );
    const receiptCredits = statement.entries
      .filter((entry) => entry.sourceType === "receipt")
      .map((entry) => entry.credit);
    expect(receiptCredits).toContain("4.0000"); // the settlement legs
    expect(receiptCredits).toContain("6.0000"); // the on-account legs
    // The invoice's 10.0000 debit is equally explicit (never netted away).
    expect(
      statement.entries.some(
        (entry) => entry.sourceType === "sales_invoice" && entry.debit === "10.0000",
      ),
    ).toBe(true);
  });
});

describe("CC-02 — concurrent receipts allocating to one invoice", () => {
  it("two parallel posts serialize on the row lock: final ≤ invoice total, zero loser residue", async () => {
    // A fresh 1,000 open invoice.
    const invoiceId = await createSubmitApprove("CC-02 racer target (1,000)", "1000.000000", fixture.customerId);
    await withTenant(TENANT_S, () => salesInvoices.post(invoiceId, S_ACTOR));
    const items = await withTenant(TENANT_S, () => arQueries.openItems({ customerId: fixture.customerId }));
    const ccItem = items.find((row) => row.sourceId === invoiceId)!;
    expect(ccItem.outstanding).toBe("1000.0000");

    const mkReceipt = () =>
      withTenant(TENANT_S, async () => {
        const created = await receipts.create({
          cashAccountId: fixture.cashAccountId,
          partnerId: fixture.customerId,
          method: "CASH",
          payerName: null,
          currencyCode: "SAR",
          amount: "600.0000",
          exchangeRate: null,
          valueDate: S_MAR,
          reference: null,
          description: "CC-02 racer",
          descriptionAr: null,
          actorId: S_CASHIER,
        });
        await allocations.setAllocations({
          docType: "receipt",
          docId: created.id,
          allocations: [{ openItemId: ccItem.id, amount: "600.0000" }],
          actorId: S_CASHIER,
        });
        return receipts.post(created.id, S_CASHIER);
      });

    const outcomes = await Promise.allSettled([mkReceipt(), mkReceipt()]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (rejected[0]!.status === "rejected") {
      expect((rejected[0]!.reason as { code?: string }).code).toBe("ALLOCATION_EXCEEDS_OPEN_ITEM");
    }
    // Final state: settled 600 ≤ 1,000; outstanding never negative.
    const item = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(ccItem.id));
    expect(item!.settledAmount).toBe("600.0000");
    expect(item!.outstanding).toBe("400.0000");
  });
});

// ---------------------------------------------------------------------------
// Re-allocations — audited documents (BR-027/INV-016)
// ---------------------------------------------------------------------------

describe("Re-allocations — audited post-allocation documents (BR-027/INV-016)", () => {
  it("moves a settled amount between open items as an audited document; the trail is INSERT-only", async () => {
    // Invoice A (10, settled by a receipt) + invoice B (20, open).
    const invoiceA = await (await import("./fixtures")).quickPostedInvoice("RAL source invoice (10)");
    const invoiceBId = await createSubmitApprove("RAL target invoice (20)", "20.000000", fixture.customerId);
    await withTenant(TENANT_S, () => salesInvoices.post(invoiceBId, S_ACTOR));

    const items = await withTenant(TENANT_S, () => arQueries.openItems({ customerId: fixture.customerId }));
    const itemA = items.find((row) => row.sourceId === invoiceA)!;
    const itemB = items.find((row) => row.sourceId === invoiceBId)!;

    const receipt = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "CASH",
        payerName: null,
        currencyCode: "SAR",
        amount: "10.0000",
        exchangeRate: null,
        valueDate: S_MAR,
        reference: null,
        description: "RAL settled receipt",
        descriptionAr: null,
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receipt.id,
        allocations: [{ openItemId: itemA.id, amount: "10.0000" }],
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () => receipts.post(receipt.id, S_CASHIER));

    // Move 6 of the settled 10 from A to B — an audited document.
    const doc = await withTenant(TENANT_S, () =>
      salesReallocations.execute({
        receiptId: receipt.id,
        reason: "RAL pack: move 6 to the later invoice",
        actorId: S_ACTOR,
        lines: [{ fromOpenItemId: itemA.id, toOpenItemId: itemB.id, amount: "6.0000" }],
      }),
    );
    expect(doc.docNo).toMatch(/^SRA-\d{4}-\d{6}$/);
    const afterA = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(itemA.id));
    const afterB = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(itemB.id));
    expect(afterA!.outstanding).toBe("6.0000");
    expect(afterB!.outstanding).toBe("14.0000");

    // INV-016 bounds: moving beyond the settled amount is refused.
    await expect(
      withTenant(TENANT_S, () =>
        salesReallocations.execute({
          receiptId: receipt.id,
          reason: "RAL pack: beyond settled",
          actorId: S_ACTOR,
          lines: [{ fromOpenItemId: itemA.id, toOpenItemId: itemB.id, amount: "5.0000" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "REALLOCATION_SOURCE_INVALID" });

    // BR-027: return-to-on-account (to NULL) un-allocates explicitly.
    const onAccount = await withTenant(TENANT_S, () =>
      salesReallocations.execute({
        receiptId: receipt.id,
        reason: "RAL pack: return 4 to on-account",
        actorId: S_ACTOR,
        lines: [{ fromOpenItemId: itemA.id, toOpenItemId: null, amount: "4.0000" }],
      }),
    );
    // POSTED-at-create: the document IS the audited effect (the audit trail).
    expect(onAccount.docNo).toMatch(/^SRA-\d{4}-\d{6}$/);
    const finalA = await withTenant(TENANT_S, () => treasuryStore.findOpenItemById(itemA.id));
    expect(finalA!.outstanding).toBe("10.0000"); // fully un-settled again
    const receiptFinal = await withTenant(TENANT_S, () => treasuryStore.findReceiptById(receipt.id));
    expect(receiptFinal!.allocatedAmount).toBe("6.0000"); // 10 − 6 moved out, 4 returned on-account

    // The audit trail is append-only by grants: UPDATE as erp_app is denied.
    const { appClient } = await import("../test-db");
    const app = await appClient();
    await app.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_S]);
    await expect(
      app.query(`UPDATE sales_reallocations SET reason = 'tamper' WHERE id = $1`, [doc.id]),
    ).rejects.toMatchObject({ code: "42501" });
    await app.end();
  });
});

// ---------------------------------------------------------------------------
// CC-03 / INV-021 — official numbering under parallel posts
// ---------------------------------------------------------------------------

describe("CC-03 / INV-021 — 50 parallel posts → 50 unique official numbers", () => {
  it("consumes 50 distinct contiguous SAL numbers with no gaps or collisions", async () => {
    const targets: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const invoice = await withTenant(TENANT_S, () =>
        salesInvoices.create(serviceInvoice(`CC-03 racer ${i}`, "1.000000", fixture.customerId)),
      );
      await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
      await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
      targets.push(invoice.id);
    }

    const results = await Promise.all(
      targets.map((id) => withTenant(TENANT_S, () => salesInvoices.post(id, S_ACTOR))),
    );
    const numbers = results.map((result) => result.invoiceNo);
    expect(numbers.every((no) => no !== null)).toBe(true);
    for (const no of numbers) {
      expect(no).toMatch(/^SAL-2026-\d{6}$/);
    }
    // Uniqueness under race (INV-021).
    expect(new Set(numbers).size).toBe(50);
    // Contiguity: the 50 reservations form one gap-free block.
    const seqs = numbers
      .map((no) => Number(no!.split("-")[2]))
      .sort((a, b) => a - b);
    expect(seqs[49]! - seqs[0]!).toBe(49);
  });
});
