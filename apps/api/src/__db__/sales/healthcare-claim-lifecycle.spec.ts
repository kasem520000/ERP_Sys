import { beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService as TaxRegistrationService } from "../../modules/tax/application/registration-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { ArQueriesService } from "../../modules/sales/application/ar-queries";
import { ServiceOrderService } from "../../modules/crm/application/service-order-service";
import { ReceiveService } from "../../modules/notes/application/receive-service";
import { CollectionService } from "../../modules/notes/application/collection-service";
import { DishonorService } from "../../modules/notes/application/dishonor-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { NotesQueriesService } from "../../modules/reporting/registry/notes/notes-queries";
import { notesAgingContract } from "../../modules/reporting/registry/notes/aging.contract";
import { partnerStatementContract } from "../../modules/reporting/registry/operational/ar-ap";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import { randomInt } from "node:crypto";
import { PasswordService } from "../../modules/identity/api/identity";
import { RegistrationService } from "../../modules/tenancy/application/registration-service";
import { TemplateApplyService } from "../../modules/configuration/application/apply/apply-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ClaimRefRequiredError } from "../../modules/sales/application/invoice-claim-ref";

/**
 * PHASE-031 T8 db spec — the claim-lifecycle end-to-end on a template
 * tenant (the acceptance-defining suite; industry-workflows (i) — the
 * signature flow this phase proves):
 *
 * visit (crm.service_orders — the visit document, no ledger) → self-pay
 * invoice (patient billed, claim_ref NULL — دفع مباشر) → insured invoice
 * (insurer billed, claim_ref CLM-HL-A; service + dispensed pharmacy lines)
 * with BR-001 enforcement proven (over-limit insurer blocked with zero
 * residue) → per-claim open items visible as their own (insurer, claim_ref)
 * slices that partition the AR subledger (INV-009) → per-insurer statement
 * with claim grouping (the group_by_claim parameter) → claim cheque into
 * PDC custody (G-24 — the claim ref rides the note→invoice source
 * reference) → dunning per claim on the group-by-claim aging → maturity
 * deposit + collect (G-25) → dishonor restores the claim EXACTLY (G-26,
 * BR-046, INV-024 — amount, partner, claim reference) → the claim
 * reconciliation holds at every step (Σ slices + self-pay + non-invoice
 * open items = the partner's AR open total; the notes aging footer tie
 * holds with group_by_claim on and off).
 *
 * Every journal is line-asserted to the existing goldens: G-01 (visit
 * invoice: DR AR_CONTROL · CR service/item revenue — no VAT under the NS
 * fixture code), G-03 (dispensed-items COGS: DR COGS · CR INVENTORY at
 * WAC — the FEFO pick is proven on the moves: the nearest-expiry batch is
 * issued first, BR-017), G-24/G-25/G-26 (the PHASE-027 notes chain,
 * consumed UNMODIFIED). Failure paths leave zero residue: the over-limit
 * approve writes no journal row; the insufficient on-hand dispensing
 * rejects with the typed batch error and rolls back the whole post.
 *
 * The pharmacy legs REUSE inventory.batch_tracking unchanged (no
 * notes-module change, no new tables — the 0042 column is the only schema
 * object this phase adds).
 */

// -- the service graph (constructed manually — the §18 lesson 6) ----------

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const arQueries = new ArQueriesService();
const visits = new ServiceOrderService(audit, numbering);
const receive = new ReceiveService(posting, audit);
const collection = new CollectionService(posting, audit);
const dishonor = new DishonorService(posting, audit, new InboxService());
const treasuryAccounts = new AccountService(audit);
const stock = new StockService(audit, posting);
const notesQueries = new NotesQueriesService();
const periods = new PeriodService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new TaxRegistrationService(audit);
const applyService = new TemplateApplyService(new ConfigRepository(), audit);

// -- the world (resolved in beforeAll) --------------------------------------

let tenantId = "";
let ownerId = "";
let approverId = "";
let branchId = "";
let pharmacyWarehouseId = "";
let consultationItemId = "";
let medicationItemId = "";
let patientId = "";
let insurerId = "";
let nsTaxCodeId = "";
let bankCashAccountId = "";
const gl = {
  arControl: "",
  salesRevenue: "",
  serviceAccount: "",
  notesReceivable: "",
  cogs: "",
  inventory: "",
};

/** The posted documents + notes this spec's legs share (set in order). */
let selfPayInvoice!: { id: string; invoiceNo: string; journalEntryId: string };
let insuredInvoice!: {
  id: string;
  invoiceNo: string;
  journalEntryId: string;
  cogsJournalEntryId: string;
};
let claimChequeId = "";

beforeAll(async () => {
  ensureTestDb();
  resetConfigurationCache();
  const passwords = new PasswordService();
  const email = { enqueue: async () => undefined } as never;
  const registration = new RegistrationService(passwords, audit, email);
  const provisioned = await registration.register({
    businessName: "Claim Lifecycle Clinic",
    businessNameAr: "عيادة دورة المطالبات",
    countryCode: "SA",
    baseCurrency: "SAR",
    industryTemplateKey: "industry.healthcare",
    taxRegistrationStatus: "REGISTERED",
    taxRegistrationNumber: "310000000000003",
    ownerEmail: `hc-life-${Date.now()}-${randomInt(1, 10_000)}@provision.test`,
    ownerFullName: "Claim Lifecycle Owner",
    ownerPassword: "an-extremely-strong-passphrase-7",
    ip: "10.41.9.1",
  });
  tenantId = provisioned.tenantId;
  ownerId = provisioned.ownerUserId;
  resetConfigurationCache();

  // Apply the healthcare shell through the engine (the registration records
  // the preference; the apply is the audited engine transaction).
  const applied = await withTenant(tenantId, () =>
    applyService.apply(ownerId, { templateKey: "industry.healthcare", mode: "initial" }),
  );
  expect(applied.applied).toBe(true);

  await withTenant(tenantId, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const accountingPurposes = await import("../../modules/tenancy/infrastructure/tenancy.store");

    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();

    const byCode = async (code: string): Promise<string> => {
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account.id;
    };
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await accountingPurposes.findActivePurpose(key);
      if (mapping === undefined) throw new Error(`fixture purpose ${key} unmapped`);
      return mapping.accountId;
    };
    gl.arControl = await byPurpose("AR_CONTROL");
    gl.salesRevenue = await byPurpose("SALES_REVENUE");
    gl.notesReceivable = await byPurpose("NOTES_RECEIVABLE");
    gl.cogs = await byPurpose("COGS");
    gl.inventory = await byPurpose("INVENTORY");
    gl.serviceAccount = await byCode("5210");

    // The manual-receipt counter leg needs INVENTORY_APPRECIATION mapped
    // (the 0008 fail-closed gap — the inventory-fixture convention: host
    // 4920, created if the CoA template lacks it).
    const { findAccountByCode, findActivePurpose, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    if ((await findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      let appreciationId = (await findAccountByCode("4920"))?.id;
      if (appreciationId === undefined) {
        const { CoaService } = await import("../../modules/accounting/application/coa-service");
        const coa = new CoaService(audit);
        appreciationId = (
          await coa.create(ownerId, {
            code: "4920",
            name: "Inventory appreciation",
            nameAr: "زيادة قيمة المخزون",
            type: "REVENUE",
            parentId: (await findAccountByCode("4000"))!.id,
            currencyCode: null,
            isGroup: false,
          })
        ).id;
      }
      await insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciationId,
        activeFrom: "2025-12-01",
      });
    }

    await periods.createYear(ownerId, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });

    const branches = await tenancy.listBranches(null);
    const main =
      branches.find((branch) => branch.code === "MAIN") ??
      (await tenancy.insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    branchId = main.id;

    // The SoD approver (BR-034 — the owner cannot approve their own invoice).
    approverId = await (async () => {
      const su = await superuserClient();
      const row = await su.query<{ id: string }>(
        `INSERT INTO users (id, email, full_name, password_hash, status)
         VALUES (gen_random_uuid(), $1, 'Claim Approver', 'x', 'ACTIVE')
         RETURNING id::text`,
        [`hc-approver-${Date.now()}-${randomInt(1, 10_000)}@provision.test`],
      );
      await su.end();
      return row.rows[0]!.id;
    })();

    // The patient financial file + the insurer (an ordinary customer-kind
    // partner with a per-partner credit limit — the BR-001 fixture: limit
    // 1,000 keeps the over-limit leg provable with a 900 document).
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((term) => term.days === 30)!;
    const patient = await partnersStore.insertPartner({
      kind: "CUSTOMER",
      code: "HC-PAT-001",
      name: "Ahmad the patient (financial file)",
      nameAr: "أحمد — المريض (الملف المالي)",
      taxNumber: null,
      creditLimit: null,
      creditTermsId: net30.id,
      priceListId: null,
    });
    patientId = patient.id;
    const insurer = await partnersStore.insertPartner({
      kind: "CUSTOMER",
      code: "HC-INS-001",
      name: "GulfCare Insurance",
      nameAr: "تأمين الخليج",
      taxNumber: null,
      creditLimit: "1000.0000",
      creditTermsId: net30.id,
      priceListId: null,
    });
    insurerId = insurer.id;

    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: ownerId,
        note: "claim lifecycle fixture registration",
      });
    }
    const codes = await taxCodes.list({ countryCode: "SA" });
    const notSubject =
      codes.find((row) => row.code === "NS") ??
      (await taxCodes.create({
        code: "NS",
        name: "Not subject",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "NOT_SUBJECT",
        actorId: ownerId,
      }));
    nsTaxCodeId = notSubject.id;

    // The pharmacy store (inventory.batch_tracking reused unchanged).
    const { WarehouseService: Warehouses } = await import(
      "../../modules/inventory/application/warehouse-service"
    );
    const warehouses = new Warehouses(audit);
    pharmacyWarehouseId = (
      await warehouses.create({
        branchId,
        code: "PHARM",
        name: "Pharmacy store",
        nameAr: "مخزن الصيدلية",
        inventoryAccountId: null,
        note: null,
        actorId: ownerId,
      })
    ).id;

    // The service item (consultation) + the pharmacy item (batch + expiry).
    const uoms = await itemsStore.listUoms();
    const hr = uoms.find((uom) => uom.code === "HR") ?? uoms[0]!;
    const pcs = uoms.find((uom) => uom.code === "PCS") ?? uoms[0]!;
    consultationItemId = (
      await itemsStore.insertItem({
        sku: "HC-CONSULT",
        name: "Consultation",
        nameAr: "استشارة",
        kind: "SERVICE",
        uomId: hr.id,
        categoryId: null,
        taxCodeId: nsTaxCodeId,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "100.000000",
      })
    ).id;
    medicationItemId = (
      await itemsStore.insertItem({
        sku: "HC-MED-A",
        name: "Medication A",
        nameAr: "دواء أ",
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: nsTaxCodeId,
        costingMethod: "WAC",
        trackBatch: true,
        trackSerial: false,
        trackImei: false,
        hasExpiry: true,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "3.000000",
      })
    ).id;

    // The pharmacy stock: two batches — B-LATE (2027) then B-EARLY (2026);
    // WAC = (10×1 + 10×2)/20 = 1.50 (the tracking-fixture convention).
    await stock.manualReceipt({
      itemId: medicationItemId,
      warehouseId: pharmacyWarehouseId,
      qty: "10",
      unitCost: "1.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-02-01",
      batchNo: "HC-B-LATE",
      batchExpiry: "2027-06-30",
      actorId: ownerId,
    });
    await stock.manualReceipt({
      itemId: medicationItemId,
      warehouseId: pharmacyWarehouseId,
      qty: "10",
      unitCost: "2.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-02-02",
      batchNo: "HC-B-EARLY",
      batchExpiry: "2026-05-30",
      actorId: ownerId,
    });

    // The settlement bank (the G-25 collection leg).
    const bankGl = await byCode("1121");
    const bank = await treasuryAccounts.open({
      name: "Claim Settlement Bank",
      nameAr: "بنك تسوية المطالبات",
      type: "BANK",
      accountId: bankGl,
      branchId: null,
      currencyCode: "SAR",
      actorId: ownerId,
    });
    bankCashAccountId = bank.id;
  });
});

/** One line-assertion helper: the journal's lines as (direction, accountId,
 *  amount, partnerId) tuples — the exact golden shape. */
async function journalLinesOf(entryId: string) {
  const lines = await withTenant(tenantId, () => journal.listLines(entryId));
  return lines.map((line) => ({
    direction: line.direction,
    accountId: line.accountId,
    amount: line.amount,
    partnerId: line.partnerId,
  }));
}

/** The claim slices (the T4 read model) — filtered to one partner. */
async function claimSlicesOf(partnerId: string) {
  return withTenant(tenantId, () =>
    arQueries.claimSlices({ asOf: "2026-12-31", customerId: partnerId }),
  );
}

/** The partner's open AR items (the partition oracle). */
async function openItemsOf(partnerId: string) {
  return withTenant(tenantId, () =>
    arQueries.openItems({ customerId: partnerId, limit: 200 }),
  );
}

describe("healthcare claim lifecycle — visit → invoices → claim cheque → collect → dishonor (T8)", () => {
  it("the visit (crm.service_orders) holds NO ledger — the billing document is the invoice", async () => {
    const ledgerBefore = await withTenant(tenantId, async () => {
      const page = await journal.listEntries({ limit: 1_000_000 });
      return page.rows.length;
    });

    const visit = await withTenant(tenantId, () =>
      visits.create({
        branchId,
        partnerId: patientId,
        contractId: null,
        warehouseId: pharmacyWarehouseId,
        note: "first visit",
        noteAr: "الزيارة الأولى",
        actorId: ownerId,
        lines: [
          {
            lineType: "SERVICE",
            itemId: consultationItemId,
            qty: null,
            unitPrice: "100.000000",
            estimatedHours: "1",
            description: "Consultation",
            descriptionAr: "استشارة",
            note: null,
          },
        ],
      }),
    );
    expect(visit.status).toBe("DRAFT");
    expect(visit.orderNo).toMatch(/^SO-/);

    // The visit itself is provenance only — zero journal rows (the invoice
    // chain carries every ledger effect).
    const ledgerAfter = await withTenant(tenantId, async () => {
      const page = await journal.listEntries({ limit: 1_000_000 });
      return page.rows.length;
    });
    expect(ledgerAfter).toBe(ledgerBefore);
  });

  it("the SELF-PAY invoice (patient billed, claim_ref NULL) posts G-01 exactly", async () => {
    const created = await withTenant(tenantId, () =>
      invoices.create({
        branchId,
        customerId: patientId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: "2026-03-01",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        insured: false,
        claimRef: null,
        note: "self-pay visit invoice",
        noteAr: null,
        actorId: ownerId,
        lines: [serviceLine("100.000000")],
      }),
    );
    await withTenant(tenantId, () => invoices.submit(created.id, ownerId));
    await withTenant(tenantId, () => invoices.approve(created.id, approverId, false));
    const posted = await withTenant(tenantId, () => invoices.post(created.id, ownerId));
    selfPayInvoice = {
      id: created.id,
      invoiceNo: posted.invoice.invoiceNo!,
      journalEntryId: posted.journalEntryId!,
    };
    // The number renders from the sales service's own SAL series (the
    // template's INV rows are the acquisition-inert registry proposals —
    // R5; the numbering uniqueness rides the assignment table).
    expect(selfPayInvoice.invoiceNo).toMatch(/^SAL-/);

    // G-01 exact: DR AR_CONTROL 100 (partner = the PATIENT) · CR service 100.
    expect(await journalLinesOf(selfPayInvoice.journalEntryId)).toEqual([
      { direction: "DEBIT", accountId: gl.arControl, amount: "100.0000", partnerId: patientId },
      { direction: "CREDIT", accountId: gl.serviceAccount, amount: "100.0000", partnerId: null },
    ]);

    // The claim_ref is NULL (self-pay — the durable marker semantics) and
    // the patient's open item exists with NO claim slice (partition base).
    const su = await superuserClient();
    const stored = await su.query<{ claim_ref: string | null }>(
      `SELECT claim_ref FROM sales_invoices WHERE id = $1`,
      [created.id],
    );
    await su.end();
    expect(stored.rows[0]!.claim_ref).toBeNull();
    expect(await claimSlicesOf(patientId)).toEqual([]);
    expect((await openItemsOf(patientId)).length).toBe(1);
  });

  it("the INSURED invoice (insurer billed, claim_ref) posts G-01 + G-03 with the FEFO pick — the claim open item is its own slice", async () => {
    // The visit whose invoice this is (the service-order provenance).
    const visit = await withTenant(tenantId, () =>
      visits.create({
        branchId,
        partnerId: insurerId,
        contractId: null,
        warehouseId: pharmacyWarehouseId,
        note: "insured visit",
        noteAr: null,
        actorId: ownerId,
        lines: [
          {
            lineType: "SERVICE",
            itemId: consultationItemId,
            qty: null,
            unitPrice: "100.000000",
            estimatedHours: "1",
            description: "Consultation",
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );

    const created = await withTenant(tenantId, () =>
      invoices.create({
        branchId,
        customerId: insurerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: "2026-03-02",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: pharmacyWarehouseId, // flow B: dispensing at the invoice
        cashAccountId: null,
        insured: true,
        claimRef: "CLM-HL-A",
        serviceOrderId: visit.id,
        note: "insured visit invoice",
        noteAr: null,
        actorId: ownerId,
        lines: [
          serviceLine("100.000000"),
          {
            itemId: medicationItemId,
            accountId: null,
            deliveryLineId: null,
            description: "Dispensed medication",
            descriptionAr: null,
            qty: "10",
            unitPrice: "3.000000",
            discountAmount: null,
            taxCodeId: nsTaxCodeId,
            batchId: null, // FEFO auto-pick (BR-017) — the nearest-expiry batch
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(tenantId, () => invoices.submit(created.id, ownerId));
    await withTenant(tenantId, () => invoices.approve(created.id, approverId, false));
    const posted = await withTenant(tenantId, () => invoices.post(created.id, ownerId));
    insuredInvoice = {
      id: created.id,
      invoiceNo: posted.invoice.invoiceNo!,
      journalEntryId: posted.journalEntryId!,
      cogsJournalEntryId: posted.cogsJournalEntryId!,
    };

    // G-01 exact: DR AR_CONTROL 130 (partner = the INSURER) · CR service 100
    // · CR item revenue 30 — the two revenue natures on one visit invoice.
    expect(await journalLinesOf(insuredInvoice.journalEntryId)).toEqual([
      { direction: "DEBIT", accountId: gl.arControl, amount: "130.0000", partnerId: insurerId },
      { direction: "CREDIT", accountId: gl.salesRevenue, amount: "30.0000", partnerId: null },
      { direction: "CREDIT", accountId: gl.serviceAccount, amount: "100.0000", partnerId: null },
    ]);

    // G-03 exact: DR COGS 15 · CR INVENTORY 15 (WAC 1.50 × 10 — the
    // costing–picking decoupling, INVENTORY_ACCOUNTING §5).
    expect(insuredInvoice.cogsJournalEntryId).not.toBeNull();
    expect(await journalLinesOf(insuredInvoice.cogsJournalEntryId!)).toEqual([
      { direction: "DEBIT", accountId: gl.cogs, amount: "15.0000", partnerId: null },
      { direction: "CREDIT", accountId: gl.inventory, amount: "15.0000", partnerId: null },
    ]);

    // The FEFO proof: the OUT moves picked HC-B-EARLY (nearest expiry);
    // the late batch is untouched.
    const moves = await withTenant(tenantId, () =>
      inventoryStore.listStockMoves({ itemId: medicationItemId, limit: 20 }),
    );
    const issueMoves = moves.filter(
      (move) =>
        move.direction === "OUT" &&
        move.sourceType === "sales_invoice" &&
        move.sourceId === insuredInvoice.id,
    );
    expect(issueMoves).toHaveLength(1);
    expect(issueMoves[0]!.batchNo).toBe("HC-B-EARLY");

    // The claim open item is its own (insurer, CLM-HL-A) slice — and the
    // slices PARTITION the partner's open items (INV-009: Σ slices + the
    // non-claim items = the partner's open total).
    const slices = await claimSlicesOf(insurerId);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({
      customerId: insurerId,
      claimRef: "CLM-HL-A",
      currencyCode: "SAR",
      itemCount: 1,
      outstandingTotal: "130.0000",
    });
    const openInsurer = await openItemsOf(insurerId);
    expect(openInsurer).toHaveLength(1); // exactly the claim invoice's item
    expect(openInsurer[0]!.outstanding).toBe("130.0000");
  });

  it("BR-001 enforcement: an over-limit insured invoice is blocked at approve with zero residue", async () => {
    // The block posture (L5 — the platform default is warn).
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (gen_random_uuid(), $1, 'sales.credit_limit_action', '"block"'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [tenantId],
    );
    await su.end();
    resetConfigurationCache();

    const ledgerBefore = await withTenant(tenantId, async () => {
      const page = await journal.listEntries({ limit: 1_000_000 });
      return page.rows.length;
    });

    // A 900 claim invoice over the insurer's 1,000 limit with 130 already
    // open (130 + 900 = 1,030 > 1,000) — the BR-001 machinery (PHASE-012,
    // consumed unchanged; insurance_credit_limit_per_company sets the
    // template's enforcement posture, never new mathematics).
    const created = await withTenant(tenantId, () =>
      invoices.create({
        branchId,
        customerId: insurerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: "2026-03-03",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        insured: true,
        claimRef: "CLM-HL-OVER",
        note: "over-limit probe",
        noteAr: null,
        actorId: ownerId,
        lines: [serviceLine("900.000000")],
      }),
    );
    await withTenant(tenantId, () => invoices.submit(created.id, ownerId));
    await expect(
      withTenant(tenantId, () => invoices.approve(created.id, approverId, false)),
    ).rejects.toMatchObject({ code: "CREDIT_LIMIT_EXCEEDED" });

    // Zero residue: no journal row moved; the draft stays unapproved; the
    // claim slice set is unchanged.
    const ledgerAfter = await withTenant(tenantId, async () => {
      const page = await journal.listEntries({ limit: 1_000_000 });
      return page.rows.length;
    });
    expect(ledgerAfter).toBe(ledgerBefore);
    expect(await claimSlicesOf(insurerId)).toHaveLength(1); // still only CLM-HL-A

    // Clean up: cancel the draft probe (never posted, never journaled) and
    // restore the warn posture.
    await withTenant(tenantId, () =>
      invoices.cancel(created.id, "over-limit probe cancelled", ownerId),
    );
    const su2 = await superuserClient();
    await su2.query(
      `DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'sales.credit_limit_action'`,
      [tenantId],
    );
    await su2.end();
    resetConfigurationCache();
  });

  it("the per-insurer statement groups by claim (group_by_claim) and ties to the subledger (INV-009)", async () => {
    // The query surface: the insurer's statement entries carry the claim ref.
    const statement = await withTenant(tenantId, () =>
      arQueries.statement({ customerId: insurerId, asOf: "2026-03-31" }),
    );
    expect(statement.subledgerTie.ok).toBe(true);
    expect(statement.closingBalance).toBe("130.0000");
    const invoiceEntry = statement.entries.find(
      (entry) => entry.sourceType === "sales_invoice" && entry.docRef === insuredInvoice.invoiceNo,
    );
    expect(invoiceEntry).toBeDefined();
    expect(invoiceEntry!.claimRef).toBe("CLM-HL-A");

    // The report contract: the group_by_claim parameter on the EXISTING
    // partner.statement contract renders the claim groups (no new key).
    const content = await withTenant(tenantId, () =>
      partnerStatementContract.run(
        {
          tenantId,
          userId: ownerId,
          effectiveBranchIds: null,
          baseCurrency: "SAR",
          permissions: new Set(["sales.statements.read"]),
        },
        { partnerId: insurerId, asOf: "2026-03-31", groupByClaim: true, locale: "en" },
      ),
    );
    expect(content.groups.map((group) => group.key)).toEqual(["CLM-HL-A"]);
    expect(content.groups[0]!.label.en).toBe("Claim CLM-HL-A");
    expect(content.groups[0]!.subtotal).toEqual({ debit: "130.0000", credit: "0.0000" });
    // The claim column rides every row; the group key matches the entry.
    const claimRow = content.rows.find((row) => row.values.claimRef === "CLM-HL-A")!;
    expect(claimRow.groupKey).toBe("CLM-HL-A");
    // With the parameter OFF the groups are empty (the default shape).
    const ungrouped = await withTenant(tenantId, () =>
      partnerStatementContract.run(
        {
          tenantId,
          userId: ownerId,
          effectiveBranchIds: null,
          baseCurrency: "SAR",
          permissions: new Set(["sales.statements.read"]),
        },
        { partnerId: insurerId, asOf: "2026-03-31", locale: "en" },
      ),
    );
    expect(ungrouped.groups).toEqual([]);
    expect(ungrouped.rows[0]!.groupKey).toBeUndefined();
  });

  it("the claim cheque into custody (G-24) settles the claim open item — the ref rides the note→invoice source", async () => {
    const note = await withTenant(tenantId, () =>
      receive.receiveNote({
        partnerId: insurerId,
        kind: "CHEQUE",
        number: "CHQ-CLM-HL-A",
        issuingBank: "Gulf Bank",
        amount: "130.0000",
        currency: "SAR",
        issueDate: "2026-03-05",
        maturityDate: "2026-04-15",
        sourceInvoiceId: insuredInvoice.id,
        eventDate: "2026-03-05",
        actorId: ownerId,
      }),
    );
    claimChequeId = note.id;
    expect(note.status).toBe("IN_CUSTODY");

    // G-24 exact: DR NOTES_RECEIVABLE 130 · CR AR_CONTROL 130 (partner —
    // the claim open item settles through the allocation machinery).
    expect(await journalLinesOf(note.journalEntryId!)).toEqual([
      { direction: "DEBIT", accountId: gl.notesReceivable, amount: "130.0000", partnerId: null },
      { direction: "CREDIT", accountId: gl.arControl, amount: "130.0000", partnerId: insurerId },
    ]);

    // The claim slice is SETTLED (outstanding 0 → the slice disappears) and
    // the insurer's AR is fully collected: per-claim tracking reconciles.
    expect(await claimSlicesOf(insurerId)).toEqual([]);
    expect(await openItemsOf(insurerId)).toEqual([]);

    // INV-009 at the settlement point: the subledger ties to AR control.
    const verify = await withTenant(tenantId, () => arQueries.verifyInv009({ asOf: "2026-03-31" }));
    expect(verify.ok).toBe(true);
  });

  it("dunning per claim: the group-by-claim aging carries the claim ref with the footer tie unchanged", async () => {
    // The aging query surface: the live claim cheque row carries its claim
    // ref (the note→invoice source join).
    // The as-of register filters created_at <= asOf (the wall clock — the
    // note was created "now"), so the dunning asOf postdates the creation
    // AND the G-24 entry while the cheque is still in custody.
    const agingRows = await withTenant(tenantId, () =>
      notesQueries.aging({ asOf: "2026-12-31", direction: null, partnerId: null }),
    );
    const claimNoteRow = agingRows.find((row) => row.noteId === claimChequeId);
    expect(claimNoteRow).toBeDefined();
    expect(claimNoteRow!.claimRef).toBe("CLM-HL-A");

    // The ties (the aging footer): Σ live notes = NOTES_RECEIVABLE — the
    // grouping never narrows the ledger check.
    const ties = await withTenant(tenantId, () =>
      notesQueries.maturityCalendarTies({ asOf: "2026-12-31" }),
    );
    expect(ties.received.registerTotal).toBe("130.0000");
    expect(ties.received.glTotal).toBe("130.0000");

    // The report contract with groupByClaim: one claim group, subtotal 130.
    const content = await withTenant(tenantId, () =>
      notesAgingContract.run(
        {
          tenantId,
          userId: ownerId,
          effectiveBranchIds: null,
          baseCurrency: "SAR",
          permissions: new Set(["notes.notes.view"]),
        },
        { asOf: "2026-12-31", groupByClaim: true, locale: "en" },
      ),
    );
    expect(content.groups.map((group) => group.key)).toEqual(["CLM-HL-A"]);
    expect(content.groups[0]!.subtotal).toEqual({ baseTotal: "130.0000" });
    // The footer tie PASSES with the parameter ON (INV-024 discipline).
    const openTie = content.assertionResults.find((result) => result.id === "notes-open-tie")!;
    expect(openTie.status).toBe("PASS");
    // With the parameter OFF: no groups, the row still carries the claim ref.
    const ungrouped = await withTenant(tenantId, () =>
      notesAgingContract.run(
        {
          tenantId,
          userId: ownerId,
          effectiveBranchIds: null,
          baseCurrency: "SAR",
          permissions: new Set(["notes.notes.view"]),
        },
        { asOf: "2026-12-31", locale: "en" },
      ),
    );
    expect(ungrouped.groups).toEqual([]);
    const row = ungrouped.rows.find((r) => r.values.claimRef === "CLM-HL-A");
    expect(row).toBeDefined();
  });

  it("maturity deposit + collect (G-25) closes the claim cheque", async () => {
    await withTenant(tenantId, () =>
      collection.deposit({
        noteId: claimChequeId,
        cashAccountId: bankCashAccountId,
        eventDate: "2026-04-14",
        actorId: ownerId,
      }),
    );
    const collected = await withTenant(tenantId, () =>
      collection.collect({
        noteId: claimChequeId,
        eventDate: "2026-04-15",
        actorId: ownerId,
      }),
    );
    expect(collected.note.status).toBe("COLLECTED");

    // G-25 exact: DR CASH 130 · CR NOTES_RECEIVABLE 130 (the bank GL account
    // is the cash account's accountId — read via the treasury store).
    const bankGl = await withTenant(tenantId, async () => {
      const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
      const account = await treasuryStore.findCashAccountById(bankCashAccountId);
      return account!.accountId;
    });
    expect(await journalLinesOf(collected.journalEntryId)).toEqual([
      { direction: "DEBIT", accountId: bankGl, amount: "130.0000", partnerId: null },
      { direction: "CREDIT", accountId: gl.notesReceivable, amount: "130.0000", partnerId: null },
    ]);

    // The register is empty and the NOTES_RECEIVABLE side ties to zero.
    const ties = await withTenant(tenantId, () =>
      notesQueries.maturityCalendarTies({ asOf: "2026-04-30" }),
    );
    expect(ties.received.registerTotal).toBe("0.0000");
    expect(ties.received.glTotal).toBe("0.0000");
  });

  it("dishonor restores the claim EXACTLY (G-26, BR-046, INV-024) — amount, partner, claim reference", async () => {
    // A second claim invoice + cheque to dishonor: 200 ≤ the insurer's
    // 1,000 limit (the first claim is fully collected — open 0).
    const created = await withTenant(tenantId, () =>
      invoices.create({
        branchId,
        customerId: insurerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: "2026-05-02",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        insured: true,
        claimRef: "CLM-HL-B",
        note: "second claim invoice",
        noteAr: null,
        actorId: ownerId,
        lines: [serviceLine("200.000000")],
      }),
    );
    await withTenant(tenantId, () => invoices.submit(created.id, ownerId));
    await withTenant(tenantId, () => invoices.approve(created.id, approverId, false));
    await withTenant(tenantId, () => invoices.post(created.id, ownerId));

    // The claim slice appears for CLM-HL-B.
    let slices = await claimSlicesOf(insurerId);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({ claimRef: "CLM-HL-B", outstandingTotal: "200.0000" });

    // The claim cheque into custody (G-24) — then the dishonor.
    const note = await withTenant(tenantId, () =>
      receive.receiveNote({
        partnerId: insurerId,
        kind: "CHEQUE",
        number: "CHQ-CLM-HL-B",
        issuingBank: "Gulf Bank",
        amount: "200.0000",
        currency: "SAR",
        issueDate: "2026-05-03",
        maturityDate: "2026-06-15",
        sourceInvoiceId: created.id,
        eventDate: "2026-05-03",
        actorId: ownerId,
      }),
    );
    expect(await claimSlicesOf(insurerId)).toEqual([]); // settled

    const dishonored = await withTenant(tenantId, () =>
      dishonor.dishonor({
        noteId: note.id,
        reason: "bounced at the bank",
        eventDate: "2026-06-16",
        actorId: ownerId,
      }),
    );
    expect(dishonored.note.status).toBe("DISHONORED");

    // G-26 exact: DR AR_CONTROL 200 (partner — the claim RESTORED) ·
    // CR NOTES_RECEIVABLE 200.
    expect(await journalLinesOf(dishonored.journalEntryId)).toEqual([
      { direction: "DEBIT", accountId: gl.arControl, amount: "200.0000", partnerId: insurerId },
      { direction: "CREDIT", accountId: gl.notesReceivable, amount: "200.0000", partnerId: null },
    ]);

    // The claim open item is restored EXACTLY — the slice reappears with the
    // original amount, partner, and claim reference (INV-024).
    slices = await claimSlicesOf(insurerId);
    expect(slices).toHaveLength(1);
    expect(slices[0]).toMatchObject({
      customerId: insurerId,
      claimRef: "CLM-HL-B",
      currencyCode: "SAR",
      itemCount: 1,
      outstandingTotal: "200.0000",
    });

    // The register ties to zero again (the dishonored note is terminal) and
    // the insurer's AR is exactly the restored claim.
    const ties = await withTenant(tenantId, () =>
      notesQueries.maturityCalendarTies({ asOf: "2026-06-30" }),
    );
    expect(ties.received.glTotal).toBe("0.0000");
    const statement = await withTenant(tenantId, () =>
      arQueries.statement({ customerId: insurerId, asOf: "2026-06-30" }),
    );
    expect(statement.subledgerTie.ok).toBe(true);
    expect(statement.closingBalance).toBe("200.0000");
    const verify = await withTenant(tenantId, () => arQueries.verifyInv009({ asOf: "2026-06-30" }));
    expect(verify.ok).toBe(true);
  });

  it("failure paths leave zero residue: CLAIM_REF_REQUIRED and the insufficient on-hand dispensing", async () => {
    // (a) The typed claim-ref capture failure (the T4 leg against the real
    // save path — the templates-031 governance spec proves the L1/L5
    // toggling; this is the end-to-end residue proof).
    const ledgerBefore = await withTenant(tenantId, async () => {
      const page = await journal.listEntries({ limit: 1_000_000 });
      return page.rows.length;
    });
    const su = await superuserClient();
    const invoicesBefore = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales_invoices WHERE tenant_id = $1`,
      [tenantId],
    );
    await su.end();

    const rejected = await withTenant(tenantId, () =>
      invoices
        .create({
          branchId,
          customerId: insurerId,
          salesRepId: null,
          kind: "CREDIT",
          invoiceDate: "2026-07-01",
          dueDate: null,
          currencyCode: "SAR",
          exchangeRate: null,
          orderId: null,
          deliveryId: null,
          warehouseId: null,
          cashAccountId: null,
          insured: true,
          claimRef: null,
          note: "capture probe",
          noteAr: null,
          actorId: ownerId,
          lines: [serviceLine("50.000000")],
        })
        .catch((error: unknown) => error),
    );
    expect(rejected).toBeInstanceOf(ClaimRefRequiredError);

    // (b) The insufficient on-hand dispensing: the pharmacy has 10 left
    // (B-LATE); dispensing 100 rejects at POST with the typed batch error
    // and the WHOLE post rolls back (zero journal rows, zero moves).
    const created = await withTenant(tenantId, () =>
      invoices.create({
        branchId,
        customerId: patientId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: "2026-07-02",
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: pharmacyWarehouseId,
        cashAccountId: null,
        insured: false,
        claimRef: null,
        note: "over-dispensing probe",
        noteAr: null,
        actorId: ownerId,
        lines: [
          {
            itemId: medicationItemId,
            accountId: null,
            deliveryLineId: null,
            description: "Dispensed medication",
            descriptionAr: null,
            qty: "100",
            unitPrice: "3.000000",
            discountAmount: null,
            taxCodeId: nsTaxCodeId,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(tenantId, () => invoices.submit(created.id, ownerId));
    await withTenant(tenantId, () => invoices.approve(created.id, approverId, false));
    await expect(
      withTenant(tenantId, () => invoices.post(created.id, ownerId)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    // Zero residue across BOTH failure paths: no new invoices, no journals.
    const su2 = await superuserClient();
    const invoicesAfter = await su2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales_invoices WHERE tenant_id = $1`,
      [tenantId],
    );
    await su2.end();
    expect(Number(invoicesAfter.rows[0]!.n)).toBe(Number(invoicesBefore.rows[0]!.n) + 1); // only the rolled-back draft
    const ledgerAfter = await withTenant(tenantId, async () => {
      const page = await journal.listEntries({ limit: 1_000_000 });
      return page.rows.length;
    });
    expect(ledgerAfter).toBe(ledgerBefore);
    // The on-hand is UNTOUCHED by the failed dispensing (B-LATE still 10).
    const moves = await withTenant(tenantId, () =>
      inventoryStore.listStockMoves({ itemId: medicationItemId, limit: 50 }),
    );
    const failedIssues = moves.filter(
      (move) => move.sourceType === "sales_invoice" && move.sourceId === created.id,
    );
    expect(failedIssues).toEqual([]);
  });
});

/** The golden NS service-line shape (the postServiceInvoice convention). */
function serviceLine(unitPrice: string) {
  return {
    itemId: null as string | null,
    accountId: gl.serviceAccount,
    deliveryLineId: null as string | null,
    description: "consultation",
    descriptionAr: null as string | null,
    qty: "1",
    unitPrice,
    discountAmount: null as string | null,
    taxCodeId: nsTaxCodeId,
    batchId: null as string | null,
    serialIds: null as string[] | null,
    note: null as string | null,
  };
}
