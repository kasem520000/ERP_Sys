import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as distributionStore from "../../modules/distribution/infrastructure/distribution.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import * as dunningStore from "../../modules/sales/infrastructure/dunning.store";
import { DunningService } from "../../modules/sales/application/dunning";
import { enforceAtApproval, runCreditCheck } from "../../modules/sales/application/credit-limits";
import { AgencyPortalController } from "../../modules/sales/presentation/agency-portal.controller";
import {
  S_ACTOR,
  S_SALES,
  TENANT_S,
  arQueries,
  clearSalesSetting,
  salesAppClient,
  salesInvoices,
  sCoa,
  setSalesSetting,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-039 · the dunning DB suite (task 7-API-B; migrations 0056/0057/0058):
 * the collections ladder over real PostgreSQL through the app-role services —
 * BR-065 monotonic sweeps (one step per run; a 200-day overdue item still
 * STARTS at step 1), the L1-12 late-fee register with its fee invoice through
 * SalesInvoiceService itself (VAT through the invoice's own tax machinery),
 * the L1-10 credit-class block in the BR-001 check, the L1-11 agency chain
 * with its G-39 commission through PostingEngine.post, and the public
 * agency-callback port (pre-GUC projection + withTenant re-validation).
 *
 * Runs on the shared sales tenant S, but every dunning-touching partner is
 * DEDICATED (S-CUST-DUN/S-CUST-CLS/S-AGENCY-01/02) and the sweep's policy is
 * TIER-SCOPED (never a standing ACTIVE default), so the shared family
 * tenants' rows stay invisible to the ladder — additive letters only, the
 * fixtures' documented discipline. Deterministic dates sit in FY2026 (April
 * invoice → 200 days overdue at the November sweep date; outside every
 * PERIOD_LOCKED pack — March/December).
 */

const D_INVOICE_DATE = "2026-04-01";
const D_DUE_DATE = "2026-04-25";
const D_AS_OF = "2026-11-11"; // 200 days after the due date
const D_COMMISSION_DATE = "2026-11-11";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const inbox = new InboxService();
const dunning = new DunningService(audit, posting, inbox, salesInvoices);
// The PUBLIC callback port, exercised in-process (the route is PUBLIC — the
// token IS the credential; the controller resolves the tenant pre-GUC).
const agencyPortal = new AgencyPortalController(dunning);

let fixture: SalesFixture;
let dunCustomerId = "";
let clsCustomerId = "";
let agencyPartnerId = "";
let agency2PartnerId = "";
let tierId = "";
let feeItemId = "";
let commissionAccountId = "";
/** The (e)-created agency — (f) builds its callback battery on it. */
let agencyId = "";

interface ExpectedLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<ExpectedLine[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

/** The AP_CONTROL purpose's account (the G-39 credit leg target). */
async function apControlAccountId(): Promise<string> {
  const mapping = await accountingStore.findActivePurpose("AP_CONTROL");
  if (mapping === undefined) throw new Error("AP_CONTROL unmapped in the fixture");
  return mapping.accountId;
}

/** A freshly POSTED overdue credit invoice: one NS-tax account line (net =
 * amount, no VAT) — the dunning substrate (explicit BR-026 due date). */
async function postedOverdueInvoice(note: string, amount: string): Promise<string> {
  const created = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: dunCustomerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: D_INVOICE_DATE,
      dueDate: D_DUE_DATE,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          itemId: null,
          accountId: fixture.gl.serviceAccount,
          deliveryLineId: null,
          description: "dunning substrate charge",
          descriptionAr: null,
          qty: "1",
          unitPrice: amount,
          discountAmount: null,
          taxCodeId: fixture.taxCodeIds.notSubject,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
  await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
  return created.id;
}

/** The canonical 3-step test ladder (EMAIL throughout; the final step is the
 * escalation + agency-handoff terminal). */
function ladderSteps(): Record<string, unknown>[] {
  return [
    { stepNo: 1, daysOverdue: 7, channel: "EMAIL", templateKey: "dunning.reminder.1" },
    { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.reminder.2" },
    { stepNo: 3, daysOverdue: 60, channel: "EMAIL", templateKey: "dunning.final", escalate: true, referToAgency: true },
  ];
}

const tierPolicyInput = (over: Record<string, unknown> = {}) => ({
  name: "Dunning — collections tier",
  nameAr: "تحصيل — فئة العملاء",
  partnerTierIds: [tierId],
  isDefault: false,
  steps: ladderSteps(),
  lateFeeMode: "CONTRACT_RATE",
  lateFeeRatePct: "2.50",
  lateFeeGraceDays: 0,
  lateFeeMaxAmount: null,
  lateFeeSource: null,
  note: null,
  noteAr: null,
  actorId: S_ACTOR,
  ...over,
});

beforeAll(async () => {
  fixture = await setupSalesFixture();
  await withTenant(TENANT_S, async () => {
    // The G-39 commission expense account (find-or-create, root, postable) —
    // the sales.collection_commission_account target.
    let commission = await accountingStore.findAccountByCode("5290");
    if (commission === undefined) {
      commission = await sCoa.create(S_ACTOR, {
        code: "5290",
        name: "Collection agency commissions",
        nameAr: "عمولات وكالات التحصيل",
        type: "EXPENSE",
        parentId: null,
        currencyCode: null,
        isGroup: false,
      });
    }
    commissionAccountId = commission.id;

    // AP_CONTROL (the G-39 credit leg's purpose) — 2110 in the SA template;
    // mapped defensively like every fixture purpose.
    if ((await accountingStore.findActivePurpose("AP_CONTROL")) === undefined) {
      const ap = await accountingStore.findAccountByCode("2110");
      const { insertAccountPurpose } = await import("../../modules/tenancy/infrastructure/tenancy.store");
      await insertAccountPurpose({
        purposeKey: "AP_CONTROL",
        accountId: ap!.id,
        activeFrom: "2025-12-01",
      });
    }

    // The L1-12 fee item: a SERVICE item carrying the STD 15% tax code, so
    // the fee invoice's single line flows VAT through the invoice machinery.
    let feeItem = await itemsStore.findItemBySku("S-FEE");
    if (feeItem === undefined) {
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      feeItem = await itemsStore.insertItem({
        sku: "S-FEE",
        name: "Late payment fee",
        nameAr: "غرامة تأخير سداد",
        kind: "SERVICE",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: fixture.taxCodeIds.standard,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
    }
    feeItemId = feeItem.id;

    // The dedicated dunning partners (the shared family tenants stay
    // untouched): the tiered dunning customer, the credit-class probe, and
    // the two agency payables.
    const ensurePartner = async (code: string, name: string, kind: "CUSTOMER" | "SUPPLIER") => {
      const existing = await partnersStore.findPartnerByCode(code);
      if (existing !== undefined) return existing.id;
      const created = await partnersStore.insertPartner({
        kind,
        code,
        name,
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
      return created.id;
    };
    dunCustomerId = await ensurePartner("S-CUST-DUN", "Dunning Customer", "CUSTOMER");
    clsCustomerId = await ensurePartner("S-CUST-CLS", "Credit Class Customer", "CUSTOMER");
    agencyPartnerId = await ensurePartner("S-AGENCY-01", "Falcon Collections", "SUPPLIER");
    agency2PartnerId = await ensurePartner("S-AGENCY-02", "Desert Recovery", "SUPPLIER");
    await partnersStore.insertPartnerContact({
      partnerId: dunCustomerId,
      name: "Dunning accounts payable",
      phone: null,
      email: "ap@dunning-customer.test",
      role: null,
      isPrimary: true,
    });

    // The tier-scoped policy's attachment scope (fresh — only S-CUST-DUN).
    const existingTier = await distributionStore.findTierByCode("S-TIER-DUN");
    tierId =
      existingTier?.id ??
      (
        await distributionStore.insertTier({
          code: "S-TIER-DUN",
          name: "Dunning test tier",
          nameAr: "فئة اختبار التحصيل",
          priceListId: null,
          discountCapPct: null,
          visitFrequencyDays: null,
          note: null,
          noteAr: null,
          createdBy: S_ACTOR,
        })
      ).id;
    await partnersStore.updatePartnerTier(dunCustomerId, tierId);
  });
});

afterAll(async () => {
  // Leave the shared tenant on its registry defaults.
  await clearSalesSetting("sales.late_fee_item");
  await clearSalesSetting("sales.collection_commission_account");
  await clearSalesSetting("sales.credit_limit_action");
});

// -- (a) policy validation: the ladder + the late-fee rules -------------------------------

describe("PHASE-039 dunning — policy validation (the typed ladder gate)", () => {
  it("rejects every bad ladder shape with DunningPolicyStepsInvalidError", async () => {
    const badLadders: Record<string, unknown>[][] = [
      [],
      [{ stepNo: 2, daysOverdue: 7, channel: "EMAIL", templateKey: "dunning.reminder.1" }],
      [
        { stepNo: 1, daysOverdue: 10, channel: "EMAIL", templateKey: "dunning.reminder.1" },
        { stepNo: 2, daysOverdue: 5, channel: "EMAIL", templateKey: "dunning.reminder.2" },
      ],
      [
        { stepNo: 1, daysOverdue: 0, channel: "EMAIL", templateKey: "dunning.reminder.1" },
        { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.reminder.2" },
      ],
      [
        { stepNo: 1, daysOverdue: 7, channel: "FAX", templateKey: "dunning.reminder.1" },
        { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.reminder.2" },
      ],
      [
        { stepNo: 1, daysOverdue: 7, channel: "EMAIL", templateKey: "   " },
        { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.reminder.2" },
      ],
      [
        { stepNo: 1, daysOverdue: 7, channel: "EMAIL", templateKey: "dunning.reminder.1", referToAgency: true },
        { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.reminder.2" },
      ],
    ];
    for (const steps of badLadders) {
      await expect(
        withTenant(TENANT_S, () => dunning.createPolicy(tierPolicyInput({ steps }))),
      ).rejects.toMatchObject({ code: "DUNNING_POLICY_STEPS_INVALID" });
    }
    // The late-fee rate shape (CONTRACT_RATE without its rate).
    await expect(
      withTenant(TENANT_S, () =>
        dunning.createPolicy(tierPolicyInput({ lateFeeRatePct: null, steps: ladderSteps() })),
      ),
    ).rejects.toMatchObject({ code: "LATE_FEE_CONFIG_INVALID" });
  });
});

// -- (b) the sweep: BR-065 monotonic --------------------------------------------------------

describe("PHASE-039 dunning — the BR-065 monotonic sweep", () => {
  let invoiceId = "";

  it("resolves tier-scoped over default, then advances ONE step per run — never skips, never re-fires", async () => {
    // The tier-scoped ACTIVE policy (NEVER a standing default — the shared
    // family tenants stay invisible to the ladder).
    const created = await withTenant(TENANT_S, () => dunning.createPolicy(tierPolicyInput()));
    expect(created.status).toBe("DRAFT");
    const activated = await withTenant(TENANT_S, () => dunning.activatePolicy(created.id, S_ACTOR));
    expect(activated.status).toBe("ACTIVE");

    // Resolution: the tier match wins for the tiered partner; the plain
    // customer falls back to the ACTIVE default (and to nothing without one).
    expect(
      await withTenant(TENANT_S, () => dunning.resolvePolicyForPartner(dunCustomerId)),
    ).toMatchObject({ id: created.id });
    expect(await withTenant(TENANT_S, () => dunning.resolvePolicyForPartner(fixture.customerId))).toBeNull();
    const fallback = await withTenant(TENANT_S, () =>
      dunning.createPolicy(
        tierPolicyInput({
          name: "Dunning — tenant default",
          partnerTierIds: [],
          isDefault: true,
          steps: [
            { stepNo: 1, daysOverdue: 7, channel: "EMAIL", templateKey: "dunning.reminder.1" },
          ],
        }),
      ),
    );
    await withTenant(TENANT_S, () => dunning.activatePolicy(fallback.id, S_ACTOR));
    expect(await withTenant(TENANT_S, () => dunning.resolvePolicyForPartner(fixture.customerId))).toMatchObject({
      id: fallback.id,
    });
    // The tier match STILL wins for the tiered partner.
    expect(
      await withTenant(TENANT_S, () => dunning.resolvePolicyForPartner(dunCustomerId)),
    ).toMatchObject({ id: created.id });
    // Archive the default before any sweep (no standing ACTIVE default).
    await withTenant(TENANT_S, () => dunning.archivePolicy(fallback.id, S_ACTOR));

    // The substrate: 200 days overdue at the sweep date.
    invoiceId = await postedOverdueInvoice("dunning sweep invoice", "1000.000000");

    // Run 1: BR-065 — the 200-day overdue item still STARTS at step 1.
    const run1 = await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    expect(run1).toMatchObject({ asOf: D_AS_OF, lettersFired: 1 });
    let letters = await withTenant(TENANT_S, () => dunning.listLetters({ invoiceId, limit: 50 }));
    expect(letters.map((row) => row.stepNo)).toEqual([1]);
    expect(letters[0]).toMatchObject({
      status: "SENT",
      daysOverdue: 200,
      templateKey: "dunning.reminder.1",
      emailTo: "ap@dunning-customer.test",
      letterDate: D_AS_OF,
    });
    // The deterministic bilingual snapshot (register = delivery evidence).
    expect(letters[0]!.subject).toContain("Payment reminder");
    expect(letters[0]!.bodySnapshot).toContain("200 day(s) overdue");

    // Runs 2 + 3: ONE step per run — 1→2, then 2→3 (no skips).
    await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    letters = await withTenant(TENANT_S, () => dunning.listLetters({ invoiceId, limit: 50 }));
    expect(letters.map((row) => row.stepNo).sort((a, b) => a - b)).toEqual([1, 2]);
    const run3 = await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    expect(run3.lettersFired).toBe(1);
    letters = await withTenant(TENANT_S, () => dunning.listLetters({ invoiceId, limit: 50 }));
    expect(letters.map((row) => row.stepNo).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(letters.find((row) => row.stepNo === 3)).toMatchObject({
      templateKey: "dunning.final",
      status: "SENT",
    });

    // Run 4: at the ladder's top — nothing re-fires (the UNIQUE backstop).
    const run4 = await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    expect(run4.lettersFired).toBe(0);
    letters = await withTenant(TENANT_S, () => dunning.listLetters({ invoiceId, limit: 50 }));
    expect(letters).toHaveLength(3);

    // The escalation step raised the collections inbox notification once.
    const client = await salesAppClient();
    const notif = await client.query(
      `SELECT category, severity FROM notifications WHERE dedupe_key = $1`,
      [`dunning-escalation:${invoiceId}:3`],
    );
    await client.end();
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0]).toMatchObject({ category: "collections", severity: "warning" });
  });

  it("exposes the ladder position on the aging surface (dunningStep, additive)", async () => {
    const aging = await withTenant(TENANT_S, () =>
      arQueries.aging({ asOf: D_AS_OF, customerId: dunCustomerId }),
    );
    expect(aging).toHaveLength(1);
    expect(aging[0]!.dunningStep).toBe(3);
  });
});

// -- (c) the late fee (L1-12): the fee invoice + the waiver trio ---------------------------

describe("PHASE-039 dunning — late fees (L1-12)", () => {
  let invoiceId = "";
  let letterId = "";

  it("charges the fee invoice with VAT through SalesInvoiceService, then rejects re-charges; the waiver stamps its trio", async () => {
    // State from (b): the 3-letter invoice under the CONTRACT_RATE 2.50% policy.
    const overdue = await withTenant(TENANT_S, () =>
      dunningStore.overdueArItems({ asOf: D_AS_OF, limit: 200 }),
    );
    const mine = overdue.find((row) => row.partnerId === dunCustomerId);
    expect(mine).toMatchObject({ outstanding: "1000.0000", currencyCode: "SAR" });
    invoiceId = mine!.invoiceId;

    const letters = await withTenant(TENANT_S, () => dunning.listLetters({ invoiceId, limit: 50 }));
    letterId = letters.find((row) => row.stepNo === 3)!.id;
    const policyId = letters[0]!.policyId;

    // The grace window: 200 days inside a 365-day grace → typed, nothing charged.
    await withTenant(TENANT_S, () =>
      dunning.updatePolicy(policyId, { lateFeeGraceDays: 365 }, S_ACTOR),
    );
    await expect(
      withTenant(TENANT_S, () => dunning.chargeLateFee({ invoiceId, actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "LATE_FEE_CONFIG_INVALID" });
    await withTenant(TENANT_S, () => dunning.updatePolicy(policyId, { lateFeeGraceDays: 0 }, S_ACTOR));

    // Fail-closed on the unmapped fee item: typed, ZERO partial (no stray
    // invoice, the letter unstamped).
    await clearSalesSetting("sales.late_fee_item");
    await expect(
      withTenant(TENANT_S, () => dunning.chargeLateFee({ invoiceId, actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "LATE_FEE_CONFIG_INVALID" });
    const unstamped = await withTenant(TENANT_S, () => dunningStore.findLetterById(letterId));
    expect(unstamped!.feeAmount).toBeNull();
    const client0 = await salesAppClient();
    const invoiceCount = await client0.query(
      `SELECT count(*)::int AS n FROM sales_invoices WHERE customer_id = $1`,
      [dunCustomerId],
    );
    await client0.end();
    expect(invoiceCount.rows[0]!.n).toBe(1); // the substrate only

    // Mapped: the fee = 1000 × 2.50% = 25.0000, invoiced through the
    // invoice service with VAT on the fee item (STD 15% → 3.7500).
    await setSalesSetting("sales.late_fee_item", feeItemId);
    const charged = await withTenant(TENANT_S, () =>
      dunning.chargeLateFee({ invoiceId, actorId: S_ACTOR }),
    );
    expect(charged).toMatchObject({
      letterId,
      stepNo: 3,
      feeAmount: "25.0000",
      totalGross: "28.7500",
    });
    expect(charged.feeInvoiceNo).toMatch(/^SAL-2026-\d{6}$/);

    // The fee invoice itself: POSTED, ONE line on the fee item, VAT included.
    const feeInvoice = await withTenant(TENANT_S, () => salesInvoices.find(charged.feeInvoiceId));
    expect(feeInvoice.status).toBe("POSTED");
    expect(feeInvoice.totalNet).toBe("25.0000");
    expect(feeInvoice.totalTax).toBe("3.7500");
    expect(feeInvoice.totalGross).toBe("28.7500");
    const feeLines = await withTenant(TENANT_S, () =>
      sStore.listSalesInvoiceLines(charged.feeInvoiceId),
    );
    expect(feeLines).toHaveLength(1);
    expect(feeLines[0]).toMatchObject({
      itemId: feeItemId,
      qty: "1.000000",
      unitPrice: "25.000000",
      taxAmount: "3.7500",
    });

    // G-04 through the invoice's own machinery: DR AR (28.75) · CR
    // SERVICE_REVENUE (25 — the fee item is SERVICE kind) · CR VAT (3.75).
    const arEntry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("sales_invoice", charged.feeInvoiceId, "post"),
    );
    expect(arEntry).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(arEntry!.id))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "28.7500" },
      { accountId: fixture.gl.serviceRevenue, direction: "CREDIT", amount: "25.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "3.7500" },
    ]);

    // The register stamp on the charging letter.
    const stamped = await withTenant(TENANT_S, () => dunningStore.findLetterById(letterId));
    expect(stamped).toMatchObject({ feeAmount: "25.0000", feeInvoiceId: charged.feeInvoiceId });
    expect(stamped!.feeWaivedAt).toBeNull();

    // One fee per invoice (L1-12): the re-charge is typed.
    await expect(
      withTenant(TENANT_S, () => dunning.chargeLateFee({ invoiceId, actorId: S_ACTOR })),
    ).rejects.toMatchObject({
      code: "LATE_FEE_ALREADY_CHARGED",
      details: { invoiceId, letterId, feeAmount: "25.0000" },
    });

    // The waiver trio (the waiver path marks, never posts).
    const waived = await withTenant(TENANT_S, () =>
      dunning.waiveFee({ letterId, reason: "goodwill — long-standing account", actorId: S_ACTOR }),
    );
    expect(waived!.feeWaivedAt).not.toBeNull();
    expect(waived!.feeWaivedBy).toBe(S_ACTOR);
    expect(waived!.feeWaiverReason).toBe("goodwill — long-standing account");
    expect(waived!.feeAmount).toBe("25.0000"); // the charge stays as evidence
    await expect(
      withTenant(TENANT_S, () =>
        dunning.waiveFee({ letterId, reason: "double waiver attempt", actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "LATE_FEE_NOT_WAIVABLE" });
  });

  it("STATUTORY_CAP without its verified source is refused by the DB CHECK (REQUIRES_VERIFICATION)", async () => {
    // The service accepts the rate shape; 0056's
    // ck_dunning_policies_late_fee_shape refuses the row itself — a
    // statutory cap without source evidence never exists to charge from.
    await expect(
      withTenant(TENANT_S, () =>
        dunning.createPolicy(
          tierPolicyInput({
            name: "Dunning — statutory (no source)",
            lateFeeMode: "STATUTORY_CAP",
            lateFeeRatePct: "5.00",
            lateFeeSource: null,
          }),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

// -- (d) the credit-class block (L1-10) ----------------------------------------------------

describe("PHASE-039 dunning — the credit-class block in BR-001 (L1-10)", () => {
  it("records the review, blocks class D with reason CREDIT_CLASS_BLOCKED, and sweeps the review clock", async () => {
    // The review outcome: class D on a clean partner (the ONLY trigger).
    const reviewed = await withTenant(TENANT_S, () =>
      dunning.recordReview({
        partnerId: clsCustomerId,
        scoreClass: "D",
        nextReviewAt: null,
        note: "watch list — slow payer",
        actorId: S_ACTOR,
      }),
    );
    expect(reviewed).toMatchObject({
      creditScoreClass: "D",
      lastCreditReviewBy: S_ACTOR,
      creditReviewNote: "watch list — slow payer",
    });
    expect(reviewed!.lastCreditReviewAt).toBe(new Date().toISOString().slice(0, 10));

    // Invalid classes / a next date without a frequency: typed.
    await expect(
      withTenant(TENANT_S, () =>
        dunning.recordReview({
          partnerId: clsCustomerId,
          scoreClass: "E",
          nextReviewAt: null,
          note: null,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CREDIT_REVIEW_INVALID" });
    await expect(
      withTenant(TENANT_S, () =>
        dunning.recordReview({
          partnerId: clsCustomerId,
          scoreClass: "C",
          nextReviewAt: "2026-12-01",
          note: null,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CREDIT_REVIEW_INVALID" });

    // The blocked-class notification (category collections).
    const client = await salesAppClient();
    const notif = await client.query(
      `SELECT category, severity FROM notifications WHERE dedupe_key = $1`,
      [`credit-class-blocked:${clsCustomerId}:D`],
    );
    await client.end();
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0]).toMatchObject({ category: "collections", severity: "warning" });

    // BR-001 under the BLOCK posture: the class alone triggers — the SAME
    // block posture shape, reason CREDIT_CLASS_BLOCKED (the DEFAULT blocked
    // class D — no sales.credit_block_class row set).
    await setSalesSetting("sales.credit_limit_action", "block");
    const check = await withTenant(TENANT_S, () =>
      runCreditCheck({ customerId: clsCustomerId, documentAmountBase: "100.0000" }),
    );
    expect(check.decision).toBe("BLOCK");
    expect(check.wouldExceed).toBe(false); // no limit set
    expect(check.overdueCount).toBe(0); // no open items — the CLASS is the trigger
    expect(check.math).toContain("CREDIT_CLASS_BLOCKED");
    await expect(
      withTenant(TENANT_S, () =>
        enforceAtApproval({
          customerId: clsCustomerId,
          documentAmountBase: "100.0000",
          override: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "CREDIT_LIMIT_EXCEEDED" });
    // The override arm converts BLOCK to WARN (the fee invoice's path).
    const overridden = await withTenant(TENANT_S, () =>
      enforceAtApproval({
        customerId: clsCustomerId,
        documentAmountBase: "100.0000",
        override: true,
      }),
    );
    expect(overridden.decision).toBe("WARN");
    expect(overridden.math).toContain("overridden");

    // A non-blocked class never triggers on its own.
    await withTenant(TENANT_S, () =>
      dunning.recordReview({
        partnerId: clsCustomerId,
        scoreClass: "B",
        nextReviewAt: null,
        note: null,
        actorId: S_ACTOR,
      }),
    );
    const cleanCheck = await withTenant(TENANT_S, () =>
      runCreditCheck({ customerId: clsCustomerId, documentAmountBase: "100.0000" }),
    );
    expect(cleanCheck.decision).toBe("ALLOW");

    // The review clock: a due partner notifies once per (partner, as-of).
    await withTenant(TENANT_S, () =>
      dunningStore.setPartnerCreditRisk(clsCustomerId, {
        creditReviewFrequencyDays: 30,
        nextCreditReviewAt: "2026-11-01",
      }),
    );
    const sweep1 = await withTenant(TENANT_S, () =>
      dunning.runCreditReviewSweep({ asOf: D_AS_OF }),
    );
    expect(sweep1).toMatchObject({ asOf: D_AS_OF, due: 1, notified: 1 });
    const sweep2 = await withTenant(TENANT_S, () =>
      dunning.runCreditReviewSweep({ asOf: D_AS_OF }),
    );
    expect(sweep2.notified).toBe(0); // the dedupe key holds
  });
});

// -- (e) the agency chain (L1-11): refer → settle → G-39 → close ----------------------------

describe("PHASE-039 dunning — the collection-agency chain (L1-11, G-39)", () => {
  let referralId = "";

  it("registers the agency, issues the token once, walks the referral ladder with the fail-closed G-39 mapping", async () => {
    // Register (commission 10% of collected).
    const agency = await withTenant(TENANT_S, () =>
      dunning.createAgency({
        partnerId: agencyPartnerId,
        contactName: "Falcon desk",
        email: "desk@falcon.test",
        phone: null,
        commissionMode: "PCT_OF_COLLECTED",
        commissionPct: "10.00",
        flatFee: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(agency).toMatchObject({ status: "ACTIVE", commissionMode: "PCT_OF_COLLECTED" });
    agencyId = agency.id;

    // The token: 256-bit hex, shown ONCE — only sha256(token) persists.
    const issued = await withTenant(TENANT_S, () => dunning.issueAgencyToken(agencyId, S_ACTOR));
    expect(issued.token).toMatch(/^[a-f0-9]{64}$/);
    const afterIssue = await withTenant(TENANT_S, () => dunning.findAgency(agencyId));
    expect(afterIssue!.portalTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(afterIssue!.portalTokenHash).not.toBe(issued.token);
    expect(afterIssue!.tokenIssuedAt).not.toBeNull();
    expect(afterIssue!.portalTokenHash).toBe(createHash("sha256").update(issued.token).digest("hex"));

    // A SUSPENDED agency receives no referrals; reactivation restores it.
    await withTenant(TENANT_S, () => dunning.setAgencyStatus(agencyId, "SUSPENDED", S_ACTOR));
    await expect(
      withTenant(TENANT_S, () =>
        dunning.referToAgency({
          agencyId,
          partnerId: dunCustomerId,
          invoiceId: null,
          referredAmount: "1000.0000",
          referralDate: D_AS_OF,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SALES_DOCUMENT_STATE" });
    await withTenant(TENANT_S, () => dunning.setAgencyStatus(agencyId, "ACTIVE", S_ACTOR));

    // Refer the delinquent balance: the referral snapshots the commission
    // terms and logs the AGENCY_REFERRAL action.
    const referred = await withTenant(TENANT_S, () =>
      dunning.referToAgency({
        agencyId,
        partnerId: dunCustomerId,
        invoiceId: null,
        referredAmount: "1000.0000",
        referralDate: D_AS_OF,
        note: "escalated after the final notice",
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(referred).toMatchObject({
      status: "REFERRED",
      agencyId,
      partnerId: dunCustomerId,
      currencyCode: "SAR",
      referredAmount: "1000.0000",
      commissionMode: "PCT_OF_COLLECTED",
      commissionPct: "10.00",
      settledAmount: "0.0000",
    });
    referralId = referred.id;
    const actions = await withTenant(TENANT_S, () =>
      dunning.listActions({ partnerId: dunCustomerId, limit: 50 }),
    );
    expect(
      actions.some((row) => row.actionType === "AGENCY_REFERRAL" && row.outcome === "ESCALATED"),
    ).toBe(true);

    // Partial settlement.
    const partial = await withTenant(TENANT_S, () =>
      dunning.settleReferral({ referralId, settledAmount: "400.0000", actorId: S_ACTOR }),
    );
    expect(partial).toMatchObject({ status: "PARTIAL", settledAmount: "400.0000" });

    // G-39 fail-closed: unmapped commission account → typed rejection with
    // ZERO partial writes (no journal, the referral stays PARTIAL).
    await clearSalesSetting("sales.collection_commission_account");
    await expect(
      withTenant(TENANT_S, () => dunning.postCommission({ referralId, actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "COMMISSION_ACCOUNT_UNMAPPED" });
    const stayed = await withTenant(TENANT_S, () => dunning.findReferral(referralId));
    expect(stayed).toMatchObject({ status: "PARTIAL", commissionJournalId: null });
    expect(
      await withTenant(TENANT_S, () =>
        journal.findEntryBySourceKey("collection_referral", referralId, "commission"),
      ),
    ).toBeUndefined();

    // Full settlement, then the G-39 posting with the mapped account.
    await setSalesSetting("sales.collection_commission_account", commissionAccountId);
    const settled = await withTenant(TENANT_S, () =>
      dunning.settleReferral({ referralId, settledAmount: "1000.0000", actorId: S_ACTOR }),
    );
    expect(settled).toMatchObject({ status: "SETTLED", settledAmount: "1000.0000" });

    const commissioned = await withTenant(TENANT_S, () =>
      dunning.postCommission({ referralId, actorId: S_ACTOR, entryDate: D_COMMISSION_DATE }),
    );
    expect(commissioned).toMatchObject({
      status: "COMMISSION_POSTED",
      commissionAmount: "100.0000", // 1000 × 10%
    });
    expect(commissioned!.commissionJournalId).not.toBeNull();
    expect(commissioned!.commissionEntryNo).toMatch(/^JE-2026-\d{6}$/);

    // G-39 exactly: DR the mapped commission expense · CR AP_CONTROL on the
    // AGENCY's partner (INV-013 — the source key makes it exactly-once).
    const apControlId = await withTenant(TENANT_S, () => apControlAccountId());
    const g39 = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("collection_referral", referralId, "commission"),
    );
    expect(g39).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(g39!.id))).toEqual([
      { accountId: commissionAccountId, direction: "DEBIT", amount: "100.0000" },
      { accountId: apControlId, direction: "CREDIT", amount: "100.0000" },
    ]);
    const g39PartnerLines = await withTenant(TENANT_S, () => journal.listLines(g39!.id));
    expect(g39PartnerLines.find((line) => line.direction === "CREDIT")!.partnerId).toBe(
      agencyPartnerId,
    );

    // Exactly-once (INV-013): the service gate refuses the re-post with the
    // typed state error — the referral is COMMISSION_POSTED; the engine's
    // source-key unique would backstop any concurrent racer the same way.
    await expect(
      withTenant(TENANT_S, () =>
        dunning.postCommission({ referralId, actorId: S_ACTOR, entryDate: D_COMMISSION_DATE }),
      ),
    ).rejects.toMatchObject({
      code: "REFERRAL_STATE_INVALID",
      details: { current: "COMMISSION_POSTED", attempted: "post-commission" },
    });

    // The terminal bookkeeping state; a settle after commission is typed.
    const closed = await withTenant(TENANT_S, () =>
      dunning.closeReferral({ referralId, actorId: S_ACTOR }),
    );
    expect(closed).toMatchObject({ status: "CLOSED" });
    expect(closed!.closedAt).not.toBeNull();
    await expect(
      withTenant(TENANT_S, () =>
        dunning.settleReferral({ referralId, settledAmount: "1000.0000", actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({
      code: "REFERRAL_STATE_INVALID",
      details: { current: "CLOSED", attempted: "settle" },
    });
  });
});

// -- (f) the public agency callback ---------------------------------------------------------

describe("PHASE-039 dunning — the public agency callback (L1-11)", () => {
  it("authenticates the agency by its token alone and updates the referral; a bad token is the typed 401-shaped rejection", async () => {
    // A second agency (flat fee) with its own live referral — the
    // cross-agency battery below.
    const agency2 = await withTenant(TENANT_S, () =>
      dunning.createAgency({
        partnerId: agency2PartnerId,
        contactName: null,
        email: null,
        phone: null,
        commissionMode: "FLAT_FEE",
        commissionPct: null,
        flatFee: "50.0000",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    const otherReferral = await withTenant(TENANT_S, () =>
      dunning.referToAgency({
        agencyId: agency2.id,
        partnerId: dunCustomerId,
        invoiceId: null,
        referredAmount: "200.0000",
        referralDate: D_AS_OF,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(otherReferral.status).toBe("REFERRED");

    // The (e) agency's live referral + a fresh token (rotation re-issues).
    const referral = await withTenant(TENANT_S, () =>
      dunning.referToAgency({
        agencyId,
        partnerId: dunCustomerId,
        invoiceId: null,
        referredAmount: "500.0000",
        referralDate: D_AS_OF,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(referral.status).toBe("REFERRED");
    const token = (await withTenant(TENANT_S, () => dunning.issueAgencyToken(agencyId, S_ACTOR))).token;

    // Bad token (before any valid call warms the real hash's window): the
    // pre-GUC projection resolves nothing → the SAME typed rejection as a
    // suspended agency or a revoked token (no oracle, 401-shaped).
    await expect(
      agencyPortal.callback({
        token: "not-a-real-agency-token-0123456789abcdef",
        referralId: referral.id,
        status: "ACKNOWLEDGED",
        settledAmount: null,
      }),
    ).rejects.toMatchObject({ code: "AGENCY_TOKEN_INVALID" });

    // Valid: ACKNOWLEDGED, then a PARTIAL settlement report (the route's
    // envelope shape — { data, meta }).
    const acked = await agencyPortal.callback({
      token,
      referralId: referral.id,
      status: "ACKNOWLEDGED",
      settledAmount: null,
    });
    expect(acked).toMatchObject({ data: { referralId: referral.id, status: "ACKNOWLEDGED" } });
    const partial = await agencyPortal.callback({
      token,
      referralId: referral.id,
      status: "PARTIAL",
      settledAmount: "250.0000",
    });
    expect(partial.data).toMatchObject({ status: "PARTIAL" });
    const row = await withTenant(TENANT_S, () => dunning.findReferral(referral.id));
    expect(row).toMatchObject({ status: "PARTIAL", settledAmount: "250.0000" });

    // The callback that over-reports is typed (never above the referred).
    await expect(
      agencyPortal.callback({
        token,
        referralId: referral.id,
        status: "SETTLED",
        settledAmount: "999.0000",
      }),
    ).rejects.toMatchObject({ code: "SALES_DOCUMENT_STATE" });

    // A valid token cannot touch ANOTHER agency's referral — the agency
    // identity comes ONLY from the token hash (the same no-oracle rejection).
    await expect(
      agencyPortal.callback({
        token,
        referralId: otherReferral.id,
        status: "ACKNOWLEDGED",
        settledAmount: null,
      }),
    ).rejects.toMatchObject({ code: "AGENCY_TOKEN_INVALID" });
  });
});
