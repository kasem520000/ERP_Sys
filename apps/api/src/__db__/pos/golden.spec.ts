import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as treasuryStore from "../../modules/treasury/infrastructure/treasury.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PosSaleService } from "../../modules/sales/application/pos-channel/pos-sale-service";
import { setupSalesFixture, S_CASHIER, S_JAN, S_DEC, TENANT_S, type SalesFixture } from "../sales/fixtures";

/**
 * PHASE-016 posting goldens (the phase §6 required set, DB-backed): a POS
 * sale IS a sales invoice — the settlement journal splits by tenders (DR
 * till cash · DR CARD_RECEIVABLE · CR revenue · CR VAT), the COGS journal
 * rides the same posting transaction (INV-013/018), the POS- number series
 * is server-side per branch (INV-021), the offline replay is exactly-once
 * (the §11 three dedupe layers), and the failure packs leave ZERO residue.
 */

let fixture: SalesFixture;
let posSales: PosSaleService;
let terminalId = "";
let cardAccountId = "";

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const { SalesInvoiceService } = await import("../../modules/sales/application/invoices");
  const { CreditNoteService } = await import("../../modules/sales/application/credit-notes");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
  const { TaxResolverService } = await import("../../modules/tax/application/tax-resolver-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const subledger = new PartnerSubledgerService();
  const posting = new PostingService(audit, subledger);
  const numbering = new NumberingService(audit);
  const resolver = new TaxResolverService();
  posSales = new PosSaleService(
    audit,
    new SalesInvoiceService(audit, posting, numbering, resolver),
    new CreditNoteService(audit, posting, numbering, resolver),
  );

  await withTenant(TENANT_S, async () => {
    // The CARD_RECEIVABLE purpose (0024 template marker 1151) + a POS
    // terminal bound to the fixture till + warehouse.
    const existing = await accountingStore.findActivePurpose("CARD_RECEIVABLE");
    if (existing === undefined) {
      const account = await accountingStore.findAccountByCode("1151");
      if (account === undefined) throw new Error("1151 Card receivable missing — 0024 template row");
      const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
      await tenancyStore.insertAccountPurpose({
        purposeKey: "CARD_RECEIVABLE",
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
      cardAccountId = account.id;
    } else {
      cardAccountId = existing.accountId;
    }

    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const tx = requireTenantContext().tx!;
    const id = "dddddddd-0000-4000-8000-000000000001";
    await tx.execute(sql`
      INSERT INTO pos_terminals (id, tenant_id, code, name, branch_id, cash_account_id,
                                 warehouse_id, receipt_size, status)
      VALUES (${id}, erp.current_tenant_id(), 'T1', 'POS Terminal 1', ${fixture.branchId},
              ${fixture.cashAccountId}, ${fixture.warehouseId}, '80mm', 'ACTIVE')
      ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'
    `);
    terminalId = id;
  });
});

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

async function movementsFor(sourceId: string) {
  const movements = await withTenant(TENANT_S, () =>
    treasuryStore.listMovements({ cashAccountId: fixture.cashAccountId, limit: 100 }),
  );
  return movements.filter((row) => row.sourceId === sourceId);
}

describe("POS channel posting goldens (G-02 split + COGS + INV-019/021)", () => {
  it("cash sale: DR till · CR revenue · CR VAT + COGS journal + cash movement + POS- number", async () => {
    const result = await withTenant(TENANT_S, () =>
      posSales.submit({
        terminalId,
        customerId: null, // the walk-in cash customer (auto-created once)
        lines: [
          {
            itemId: fixture.items.a,
            qty: "2",
            unitPrice: "100.000000",
            taxCodeId: fixture.taxCodeIds.standard,
          },
        ],
        tenders: [{ method: "CASH", amount: "230.0000" }],
        orderType: "COUNTER",
        actorId: S_CASHIER,
      }),
    );
    const invoice = result.invoice;
    expect(invoice.status).toBe("POSTED");
    expect(invoice.channel).toBe("POS");
    expect(invoice.orderType).toBe("COUNTER");
    expect(invoice.totalGross).toBe("230.0000"); // 200 net + 30 VAT (15%)
    expect(invoice.invoiceNo).toMatch(/^POS-[A-Z0-9]+-\d{4}-\d{5}$/);

    // Settlement journal: DR till (cash 230) · CR revenue 200 · CR VAT 30.
    const settlement = await withTenant(TENANT_S, () => journalLinesOf(invoice.postedJournalId!));
    expect(settlement).toEqual([
      { accountId: fixture.gl.cashGl, direction: "DEBIT", amount: "230.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "200.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "30.0000" },
    ]);

    // COGS journal: DR COGS 120 (2 × WAC 60) · CR INVENTORY 120 (G-03).
    const cogs = await withTenant(TENANT_S, () => journalLinesOf(invoice.postedCogsJournalId!));
    expect(cogs).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "120.0000" },
    ]);

    // INV-019: the till's cash movement for the full gross (cash tender).
    const saleMovements = await movementsFor(invoice.id);
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0]).toMatchObject({ direction: "IN", amount: "230.0000" });

    // The walk-in customer exists as a partner with the reserved code.
    const walkIn = await withTenant(TENANT_S, async () => {
      const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
      return partnersStore.findPartnerByCode("POS-WALKIN");
    });
    expect(walkIn?.id).toBe(invoice.customerId);
  });

  it("split tender (cash + card): DR till (cash part) · DR CARD_RECEIVABLE (card part)", async () => {
    const result = await withTenant(TENANT_S, () =>
      posSales.submit({
        terminalId,
        customerId: null,
        lines: [
          {
            itemId: fixture.items.a,
            qty: "1",
            unitPrice: "100.000000",
            taxCodeId: fixture.taxCodeIds.standard,
          },
        ],
        tenders: [
          { method: "CASH", amount: "50.0000" },
          { method: "CARD", amount: "65.0000", reference: "AUTH-77" },
        ],
        orderType: "COUNTER",
        actorId: S_CASHIER,
      }),
    );
    const invoice = result.invoice;
    expect(invoice.totalGross).toBe("115.0000");
    const settlement = await withTenant(TENANT_S, () => journalLinesOf(invoice.postedJournalId!));
    expect(settlement).toEqual([
      { accountId: fixture.gl.cashGl, direction: "DEBIT", amount: "50.0000" },
      { accountId: cardAccountId, direction: "DEBIT", amount: "65.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "100.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "15.0000" },
    ]);
    // INV-019: the movement records the CASH tender only (card never sits
    // in the drawer).
    const saleMovements = await movementsFor(invoice.id);
    expect(saleMovements).toHaveLength(1);
    expect(saleMovements[0]).toMatchObject({ direction: "IN", amount: "50.0000" });
  });

  it("offline replay: the same client id + OFF- number posts ONCE (INV-013 + §11 layers)", async () => {
    const clientId = "dddddddd-0000-4000-8000-00000000aa01";
    const offlineNo = "OFF-T1-00001";
    const submit = () =>
      withTenant(TENANT_S, () =>
        posSales.submitOffline({
          terminalId,
          customerId: null,
          lines: [
            {
              itemId: fixture.items.b,
              qty: "1",
              unitPrice: "40.000000",
              taxCodeId: fixture.taxCodeIds.standard,
            },
          ],
          tenders: [{ method: "CASH", amount: "46.0000" }],
          orderType: "COUNTER",
          offlineReceiptNo: offlineNo,
          clientId,
          invoiceDate: S_JAN,
          actorId: null,
          idempotencyKey: `pos_sale:${clientId}`,
        }),
      );
    const first = await submit();
    expect(first.replay).toBe(false);
    const replay = await submit();
    expect(replay.replay).toBe(true);
    expect(replay.invoice.id).toBe(first.invoice.id);
    // The official number is identical across replays — zero additional
    // ledger effects (the journals are keyed on the client id).
    expect(replay.invoice.invoiceNo).toBe(first.invoice.invoiceNo);
    expect(replay.invoice.postedJournalId).toBe(first.invoice.postedJournalId);

    // The OFF- ⇄ official 1:1 reconciliation pair is queryable.
    const found = await withTenant(TENANT_S, () =>
      sStore.findPosInvoiceByOfflineNo(terminalId, offlineNo),
    );
    expect(found?.invoiceNo).toBe(first.invoice.invoiceNo);
    expect(found?.offlineReceiptNo).toBe(offlineNo);
  });

  it("PERIOD_LOCKED: an offline sale dated in a locked month leaves ZERO residue", async () => {
    const countInvoices = async (): Promise<number> => {
      return withTenant(TENANT_S, async () => {
        const { sql } = await import("drizzle-orm");
        const { requireTenantContext } = await import("../../infra/db/tenant-context");
        const rows = await requireTenantContext().tx!.execute(
          sql`SELECT count(*)::int AS n FROM sales_invoices`,
        );
        return (rows.rows as unknown as { n: number }[])[0]!.n;
      });
    };
    const before = await countInvoices();
    // Lock the December period (the sales-suite PERIOD_LOCKED shape).
    const periodStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const periodService = await import("../../modules/accounting/application/period-service");
    const periods = new periodService.PeriodService(
      new (await import("../../modules/audit/api/audit")).AuditService(
        new (await import("../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
      ),
    );
    const period = await withTenant(TENANT_S, () => periodStore.findPeriodForDate(S_DEC));
    expect(period).toBeDefined();
    await withTenant(TENANT_S, () => periods.softClose(S_CASHIER, period!.id));
    try {
      await withTenant(TENANT_S, () => periods.lock(S_CASHIER, period!.id));
      await expect(
        withTenant(TENANT_S, () =>
          posSales.submitOffline({
            terminalId,
            customerId: null,
            lines: [
              {
                itemId: fixture.items.a,
                qty: "1",
                unitPrice: "100.000000",
                taxCodeId: fixture.taxCodeIds.standard,
              },
            ],
            tenders: [{ method: "CASH", amount: "115.0000" }],
            orderType: "COUNTER",
            offlineReceiptNo: "OFF-T1-00002",
            clientId: "dddddddd-0000-4000-8000-00000000aa02",
            invoiceDate: S_DEC,
            actorId: null,
            idempotencyKey: "pos_sale:locked-1",
          }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      const after = await countInvoices();
      expect(after).toBe(before);
    } finally {
      await withTenant(TENANT_S, () =>
        periods.reopen(S_CASHIER, period!.id, "PHASE-016 POS PERIOD_LOCKED pack reopen"),
      );
    }
  });

  it("return: a POS credit note posts the G-04 mirror at original cost (W-3)", async () => {
    // POS cash returns are standalone notes by shape (a cash invoice
    // settled at the counter — outstanding 0): the tenant enables the
    // documented policy flag, exactly as the back office would.
    await withTenant(TENANT_S, async () => {
      const { sql } = await import("drizzle-orm");
      const { requireTenantContext } = await import("../../infra/db/tenant-context");
      await requireTenantContext().tx!.execute(sql`
        INSERT INTO tenant_settings (id, tenant_id, key, value)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), 'sales.credit_note_standalone_allowed', 'true'::jsonb)
        ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = 'true'::jsonb
      `);
    });
    // Sell first, then return one line.
    const sold = await withTenant(TENANT_S, () =>
      posSales.submit({
        terminalId,
        customerId: null,
        lines: [
          {
            itemId: fixture.items.a,
            qty: "2",
            unitPrice: "100.000000",
            taxCodeId: fixture.taxCodeIds.standard,
          },
        ],
        tenders: [{ method: "CASH", amount: "230.0000" }],
        orderType: "COUNTER",
        actorId: S_CASHIER,
      }),
    );
    const lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(sold.invoice.id));
    const posted = await withTenant(TENANT_S, () =>
      posSales.returnSale({
        terminalId,
        invoiceId: sold.invoice.id,
        lines: [{ invoiceLineId: lines[0]!.id, qty: "1", reason: "damaged" }],
        actorId: S_CASHIER,
      }),
    );
    expect(posted.note.status).toBe("POSTED");
    // The G-04 mirror: SALES_RETURNS 100 DR · VAT 15 DR · cash 115 CR
    // (cash returns refund the till) + INVENTORY 60 DR · COGS 60 CR.
    const noteLines = await withTenant(TENANT_S, () =>
      journalLinesOf(posted.note.postedJournalId!),
    );
    // The G-04 note entry: SALES_RETURNS 100 DR · VAT 15 DR · AR_CONTROL
    // 115 CR (the §3.4 explicit-allocation model — the note is its own
    // open item; the counter cash refund rides treasury).
    expect(noteLines).toEqual([
      { accountId: fixture.gl.salesReturns, direction: "DEBIT", amount: "100.0000" },
      { accountId: fixture.gl.vatPayable, direction: "DEBIT", amount: "15.0000" },
      { accountId: fixture.gl.arControl, direction: "CREDIT", amount: "115.0000" },
    ]);
    // The W-3 stock re-entry rides its own journal (credit_note:reentry):
    // INVENTORY 60 DR · COGS 60 CR at the ORIGINAL issue cost.
    const reentry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", posted.note.id, "reentry"),
    );
    expect(reentry).toBeDefined();
    const reentryLines = await withTenant(TENANT_S, () => journalLinesOf(reentry!.id));
    expect(reentryLines).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "60.0000" },
      { accountId: fixture.gl.cogs, direction: "CREDIT", amount: "60.0000" },
    ]);
  });
});
