import { beforeAll, describe, expect, it } from "vitest";

import {
  ensureTestDb,
  seedTenants,
  superuserClient,
} from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { ZatcaPhase1Service } from "../../modules/tax/application/zatca/zatca-phase1-service";
import { GENESIS_PIH } from "../../modules/tax/application/zatca/hash-chain";
import { PosReceiptService } from "../../modules/pos/application/receipt-service";
import { TaxQueriesService } from "../../modules/tax/application/tax-queries";
import { syncFeed } from "../../modules/sync/application/change-log-writer";

/**
 * PHASE-037 · the ZATCA Phase-1 DB suite (acceptance 1/4/5/6/8): real
 * PostgreSQL through the app-role services — the chain stamp rides the
 * invoice post transaction, the verification walk re-derives every
 * digest from the stored rows, the tamper mutation fails closed, the
 * backfill is idempotent with the NEGATIVE LEDGER PROOF (zero journal
 * rows), and the BR-060 guard blocks the unstamped simplified issue and
 * print with zero residue.
 *
 * Dedicated tenant Z (SA/SAR, REGISTERED VAT 310000000000003) — the
 * suite owns it end to end (no shared pack-tenant state).
 *
 * File-level ordering (sequential, single fork):
 *   devices created → BR-060 deletes ALL devices (+ posts the two
 *   unstamped HISTORY invoices) → the chain device is recreated → live
 *   chain 1..3 → tamper → print guard (strip + byte-true restore) →
 *   backfill stamps the history (ICV continues) → report/sync/EXPLAIN.
 */

const Z_TENANT = "77777777-3703-7003-8000-000000000037";
const Z_ACTOR = "77777777-3703-7003-8000-0000000000a1";
/** The second user — BR-034 SoD: the creator can never approve (the
 * golden-spec approval pattern; a second fixture user approves). */
const Z_APPROVER = "77777777-3703-7003-8000-0000000000a2";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const zatca = new ZatcaPhase1Service(audit);
const registrations = new RegistrationService(audit);
const taxQueries = new TaxQueriesService();
const receiptService = new PosReceiptService();

interface ZFix {
  branchId: string;
  customerId: string;
  revenueAccountId: string;
  cashAccountId: string;
  taxCodeId: string;
}

let fix: ZFix;

async function createAndApprove(input: {
  classification?: "STANDARD" | "SIMPLIFIED";
  kind?: "CASH" | "CREDIT";
  amount?: string;
  date?: string;
}): Promise<string> {
  const created = await withTenant(Z_TENANT, () =>
    salesInvoices.create({
      branchId: fix.branchId,
      customerId: fix.customerId,
      salesRepId: null,
      kind: input.kind ?? "CREDIT",
      invoiceDate: input.date ?? "2026-02-10",
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: input.kind === "CASH" ? fix.cashAccountId : null,
      classification: input.classification,
      note: "zatca spec",
      noteAr: null,
      actorId: Z_ACTOR,
      lines: [
        {
          itemId: null,
          accountId: fix.revenueAccountId,
          deliveryLineId: null,
          description: "service revenue",
          descriptionAr: null,
          qty: "1",
          unitPrice: input.amount ?? "200.000000",
          discountAmount: null,
          taxCodeId: fix.taxCodeId,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(Z_TENANT, () => salesInvoices.submit(created.id, Z_ACTOR));
  await withTenant(Z_TENANT, () => salesInvoices.approve(created.id, Z_APPROVER, false));
  return created.id;
}

async function postInvoice(input: {
  classification?: "STANDARD" | "SIMPLIFIED";
  kind?: "CASH" | "CREDIT";
  amount?: string;
  date?: string;
}): Promise<{ id: string; invoiceNo: string }> {
  const id = await createAndApprove(input);
  const result = await withTenant(Z_TENANT, () => salesInvoices.post(id, Z_ACTOR));
  return { id: result.invoice.id, invoiceNo: result.invoiceNo! };
}

async function rawInvoice(id: string): Promise<Record<string, unknown>> {
  const su = await superuserClient();
  const row = await su.query(
    `SELECT status, icv, zatca_device_id AS "deviceId", previous_invoice_hash AS "pih",
            invoice_hash AS "hash", invoice_hash_version AS "hashVersion",
            qr_payload AS "qr", classification, total_net AS "net", total_tax AS "tax",
            total_gross AS "gross"
       FROM sales_invoices WHERE id = $1`,
    [id],
  );
  await su.end();
  return row.rows[0]!;
}

async function journalCount(): Promise<number> {
  const su = await superuserClient();
  const row = await su.query(`SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1`, [
    Z_TENANT,
  ]);
  await su.end();
  return row.rows[0]!.n;
}

async function deleteAllDevices(): Promise<void> {
  const su = await superuserClient();
  await su.query(`DELETE FROM zatca_devices WHERE tenant_id = $1`, [Z_TENANT]);
  await su.end();
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Zatca Spec Seller', 'بائع مواصفات الزاتكا', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [Z_TENANT],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'zatca-actor@fixture.test', 'Zatca Actor', 'x', 'ACTIVE'),
       ($2, 'zatca-approver@fixture.test', 'Zatca Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [Z_ACTOR, Z_APPROVER],
  );
  await su.end();

  await withTenant(Z_TENANT, async () => {
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    const { insertAccountPurpose } = tenancyStore;
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancyStore.seedMasterDataBasics();
    await tenancyStore.provisionCoaTemplate();

    const byCode = async (code: string) => {
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await accountingStore.findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    const revenue = await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("AR_CONTROL", "1130");
    await mapPurpose("VAT_PAYABLE", "2120");
    const cashGl = (await byCode("1111")).id;

    const periods = new PeriodService(audit);
    const year = await accountingStore.findFiscalYearByName("FY2026");
    if (year === undefined) {
      await periods.createYear(Z_ACTOR, {
        name: "FY2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      });
    }

    const branch =
      (await tenancyStore.listBranches(null)).find((b) => b.code === "MAIN") ??
      (await tenancyStore.insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    const customer = await partnersStore.insertPartner({
      kind: "CUSTOMER",
      code: "Z-CUST-001",
      name: "Zatca Customer",
      nameAr: "عميل الزاتكا",
      taxNumber: null,
      creditLimit: null,
      creditTermsId: null,
      priceListId: null,
    });
    const cash = await treasuryStore.insertCashAccount({
      name: "Main till",
      nameAr: "الدرج الرئيسي",
      type: "CASH",
      accountId: cashGl,
      branchId: branch.id,
      currencyCode: "SAR",
      createdBy: Z_ACTOR,
    });
    const taxCodes = await import("../../modules/tax/application/codes-service");
    const codesService = new taxCodes.TaxCodesService(audit);
    const existingCodes = await codesService.list({ countryCode: "SA" });
    const standard =
      existingCodes.find((row) => row.code === "STD") ??
      (await codesService.create({
        code: "STD",
        name: "Standard",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "STANDARD_RATED",
        actorId: Z_ACTOR,
      }));
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: Z_ACTOR,
        note: "zatca spec registration",
      });
    }
    fix = {
      branchId: branch.id,
      customerId: customer.id,
      revenueAccountId: revenue,
      cashAccountId: cash.id,
      taxCodeId: standard.id,
    };
  });
});

describe("device lifecycle (T-02/T-06 — the honest registry)", () => {
  it("creates the device with NOT_REGISTERED + a zeroed chain anchor", async () => {
    const device = await withTenant(Z_TENANT, () =>
      zatca.createDevice({
        name: "Counter EIAS",
        nameAr: "جهاز الكاونتر",
        solutionProviderName: "Solution Provider (placeholder)",
        solutionProviderVat: "311111111111113",
        note: "Phase-1 placeholder",
        actorId: Z_ACTOR,
      }),
    );
    expect(device.registrationStatus).toBe("NOT_REGISTERED");
    expect(device.icvCounter).toBe(0);
    expect(device.deviceUuid).toBeNull();
  });

  it("updates placeholder fields but never the registration status (BR-061 surface)", async () => {
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const device = devices[0]!;
    const updated = await withTenant(Z_TENANT, () =>
      zatca.updateDevice({
        id: device.id,
        deviceUuid: "f0e1d2c3-b4a5-4677-8899-001122334455",
        deviceSerial: "SN-ZATCA-0001",
        actorId: Z_ACTOR,
      }),
    );
    expect(updated.deviceUuid).toBe("f0e1d2c3-b4a5-4677-8899-001122334455");
    expect(updated.deviceSerial).toBe("SN-ZATCA-0001");
    expect(updated.registrationStatus).toBe("NOT_REGISTERED");
  });
});

describe("BR-060 fail-closed — the simplified path (acceptance 6)", () => {
  it("an UNENROLLED tenant (no device) posts a simplified invoice unstamped — no behavior change", async () => {
    await deleteAllDevices();
    const id = await createAndApprove({
      classification: "SIMPLIFIED",
      kind: "CASH",
      amount: "100.000000",
    });
    const result = await withTenant(Z_TENANT, () => salesInvoices.post(id, Z_ACTOR));
    const row = await rawInvoice(result.invoice.id);
    // Enrollment (the device registry) is the compliance switch: before
    // it, nothing stamps and nothing guards (the pre-037 behavior).
    expect(row.icv).toBeNull();
    expect(row.qr).toBeNull();
    expect(row.classification).toBe("SIMPLIFIED");

    // The two unstamped HISTORY invoices the backfill exists for
    // (STANDARD passes un-stamped without a device — BR-060 speaks only
    // for the enrolled simplified path).
    await postInvoice({ amount: "80.000000", date: "2026-01-20" });
    await postInvoice({ amount: "90.000000", date: "2026-01-21" });
  });

  it("an ENROLLED tenant whose QR cannot be built fails closed at the stamp boundary — typed, zero residue", async () => {
    await withTenant(Z_TENANT, () =>
      zatca.createDevice({ name: "Guard EIAS", nameAr: "جهاز الحارس", actorId: Z_ACTOR }),
    );
    const id = await createAndApprove({
      classification: "SIMPLIFIED",
      kind: "CASH",
      amount: "100.000000",
    });
    // The DB floor (ck_tax_registrations_number_shape) makes the
    // REGISTERED-but-numberless state impossible — the guard's branch is
    // the typed BACKSTOP for it. Prove the branch directly at the service
    // boundary (the exact code path the post would hit): no registration
    // row → the seller VAT number resolves null → the enrolled stamp
    // refuses typed. No post runs — zero residue by construction.
    const su = await superuserClient();
    await su.query(`DELETE FROM tax_registrations WHERE tenant_id = $1 AND country_code = 'SA'`, [
      Z_TENANT,
    ]);
    await su.end();
    await expect(
      withTenant(Z_TENANT, () =>
        zatca.stampForPost({
          invoice: {
            invoiceId: id,
            invoiceNo: "SAL-2026-000099",
            invoiceDate: "2026-02-10",
            postedAt: new Date().toISOString(),
            status: "POSTED",
            currencyCode: "SAR",
            totalNet: "100.0000",
            totalTax: "15.0000",
            totalGross: "115.0000",
            branchId: fix.branchId,
            classification: "SIMPLIFIED",
          },
          sellerName: "Zatca Spec Seller",
          sellerVatRegistrationNumber: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "ZATCA_QR_PAYLOAD_REQUIRED" });
    // ZERO residue: the invoice never posted — it stays APPROVED with no
    // stamp, no counter movement, no journal.
    const row = await rawInvoice(id);
    expect(row.status).toBe("APPROVED");
    expect(row.icv).toBeNull();
    expect(row.qr).toBeNull();
    // Restore the registration (the chain tests need it).
    await withTenant(Z_TENANT, () =>
      registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: Z_ACTOR,
        note: "zatca spec registration (restored)",
      }),
    );
    // Sanity: the restore is byte-visible before the next describes run.
    const su3 = await superuserClient();
    const reg = await su3.query(
      `SELECT status, registration_number AS "number" FROM tax_registrations
        WHERE tenant_id = $1 AND country_code = 'SA'`,
      [Z_TENANT],
    );
    await su3.end();
    expect(reg.rows[0]).toMatchObject({ status: "REGISTERED", number: "310000000000003" });
  });
});

describe("chain integrity (INV-027 — acceptance 4)", () => {
  it("issuing N invoices on one device yields ICV 1..N, genesis PIH, and linked hashes", async () => {
    // The enrolled tenant carries exactly one device (the Guard EIAS row
    // BR-060 created — counter 0, zero stamps); every subsequent post
    // stamps onto it (the oldest-device resolution).
    const a = await postInvoice({ amount: "200.000000", date: "2026-02-10" });
    const b = await postInvoice({ amount: "300.000000", date: "2026-02-11" });
    const c = await postInvoice({ amount: "115.000000", date: "2026-02-12", kind: "CASH" });
    const rowA = await rawInvoice(a.id);
    const rowB = await rawInvoice(b.id);
    const rowC = await rawInvoice(c.id);
    // ICV strictly monotonic 1..3.
    expect(rowA.icv).toBe(1);
    expect(rowB.icv).toBe(2);
    expect(rowC.icv).toBe(3);
    // The first invoice carries the documented genesis PIH.
    expect(rowA.pih).toBe(GENESIS_PIH);
    // Each PIH equals the predecessor's STORED hash.
    expect(rowB.pih).toBe(rowA.hash);
    expect(rowC.pih).toBe(rowB.hash);
    // The stamps cohere (the DB shape constraint's app-level mirror).
    for (const row of [rowA, rowB, rowC]) {
      expect(row.deviceId).not.toBeNull();
      expect(row.hash).not.toBeNull();
      expect(row.hashVersion).toBe("invoice-hash-v1");
      expect(row.qr).not.toBeNull();
    }
    // STANDARD invoices carry the QR as well (acceptance 6 tail).
    expect(rowA.classification).toBe("STANDARD");
    const verification = await withTenant(Z_TENANT, () =>
      zatca.verifyDeviceChain(rowA.deviceId as string),
    );
    expect(verification).toMatchObject({ ok: true, checked: 3, failures: [] });
  });
});

describe("tamper verification fails closed (acceptance 5)", () => {
  it("mutating a stored total breaks the walk with the typed failure pack", async () => {
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const deviceId = devices[0]!.id;
    const chain = await withTenant(Z_TENANT, () => zatca.deviceChain(deviceId));
    expect(chain.length).toBe(3);
    const victim = chain[1]!;
    const su = await superuserClient();
    // The totals CHECK (net + tax = gross) stays satisfied — the tamper
    // moves ALL THREE consistently (+0.0100 net/tax, +0.0200 gross),
    // which is exactly the "consistent-looking" forgery the digest
    // must catch (the CHECK cannot; only the chain can).
    await su.query(
      `UPDATE sales_invoices SET total_net = total_net + 0.0100,
              total_tax = total_tax + 0.0100, total_gross = total_gross + 0.0200
        WHERE id = $1 AND tenant_id = $2`,
      [victim.id, Z_TENANT],
    );
    await su.end();
    await expect(
      withTenant(Z_TENANT, () => zatca.verifyDeviceChain(deviceId)),
    ).rejects.toMatchObject({ code: "ZATCA_CHAIN_BROKEN" });
    // Restore — the negative evidence is the recorded failure above.
    const su2 = await superuserClient();
    await su2.query(
      `UPDATE sales_invoices SET total_net = total_net - 0.0100,
              total_tax = total_tax - 0.0100, total_gross = total_gross - 0.0200
        WHERE id = $1 AND tenant_id = $2`,
      [victim.id, Z_TENANT],
    );
    await su2.end();
    const restored = await withTenant(Z_TENANT, () => zatca.verifyDeviceChain(deviceId));
    expect(restored.ok).toBe(true);
  });
});

describe("BR-060 print guard + the scannable receipt (H-02)", () => {
  it("renders the stamped receipt with a real QR IMAGE; the stripped payload prints as typed refusal", async () => {
    // A dedicated SIMPLIFIED invoice (explicit classification — the B2C
    // path is not POS-only) — it stamps like any other post.
    const simplified = await postInvoice({
      classification: "SIMPLIFIED",
      kind: "CASH",
      amount: "115.000000",
      date: "2026-02-13",
    });
    const rendered = await withTenant(Z_TENANT, () =>
      receiptService.renderForInvoice({ invoiceId: simplified.id, locale: "ar" }),
    );
    // The print path carries the IMAGE (not the [QR] text placeholder).
    expect(rendered.html).toContain("data:image/png;base64,");
    expect(rendered.html).not.toContain("[QR]");

    // Capture the exact stamp, strip it (superuser), and expect the
    // print guard to fail closed on the simplified invoice.
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const deviceId = devices[0]!.id;
    const chain = await withTenant(Z_TENANT, () => zatca.deviceChain(deviceId));
    const stamp = chain.find((row) => row.id === simplified.id)!;
    const su = await superuserClient();
    await su.query(
      `UPDATE sales_invoices SET qr_payload = NULL, invoice_hash = NULL, invoice_hash_version = NULL,
              previous_invoice_hash = NULL, icv = NULL, zatca_device_id = NULL
        WHERE id = $1 AND tenant_id = $2`,
      [simplified.id, Z_TENANT],
    );
    await su.end();
    await expect(
      withTenant(Z_TENANT, () => receiptService.renderForInvoice({ invoiceId: simplified.id })),
    ).rejects.toMatchObject({ code: "ZATCA_QR_PAYLOAD_REQUIRED" });

    // Byte-true restore (the backfill's final chain walk is the oracle).
    const su2 = await superuserClient();
    await su2.query(
      `UPDATE sales_invoices SET qr_payload = $3, invoice_hash = $4, invoice_hash_version = $5,
              previous_invoice_hash = $6, icv = $7, zatca_device_id = $8
        WHERE id = $1 AND tenant_id = $2`,
      [
        simplified.id,
        Z_TENANT,
        stamp.qrPayload,
        stamp.invoiceHash,
        stamp.invoiceHashVersion,
        stamp.previousInvoiceHash,
        stamp.icv,
        stamp.zatcaDeviceId,
      ],
    );
    await su2.end();
  });
});

describe("backfill — issuance order, idempotent, zero journal rows (acceptance 1)", () => {
  it("dry-runs, stamps history in issuance order, and re-runs clean", async () => {
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const deviceId = devices[0]!.id;
    const counterBefore = (await withTenant(Z_TENANT, () => zatca.findDevice(deviceId))).icvCounter;
    // The live chain already minted counters monotonically (the chain
    // describe's three + the print describe's simplified one).
    expect(counterBefore).toBeGreaterThanOrEqual(4);

    // The unstamped history: the two January invoices + the unenrolled
    // SIMPLIFIED post (BR-060's no-behavior-change leg) — all POSTED
    // with icv NULL, all legitimately backfillable.
    const history = await withTenant(Z_TENANT, async () => {
      const su = await superuserClient();
      const rows = await su.query(
        `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND status = 'POSTED' AND icv IS NULL
          ORDER BY posted_at, created_at, id`,
        [Z_TENANT],
      );
      await su.end();
      return rows.rows.map((row) => row.id as string);
    });
    expect(history.length).toBeGreaterThanOrEqual(3);

    const plan = await withTenant(Z_TENANT, () => zatca.backfillPlan(deviceId, 200));
    expect(plan.stampableCount).toBe(history.length);
    // ISSUANCE order: the plan matches the raw workset query exactly.
    expect(plan.candidates.map((row) => row.invoiceId)).toEqual(history);

    const journalsBefore = await journalCount();
    const run = await withTenant(Z_TENANT, () =>
      zatca.backfillRun({ deviceId, limit: 200, sellerName: "Zatca Spec Seller", actorId: Z_ACTOR }),
    );
    expect(run.stamped).toBe(history.length);
    const rawOld = await rawInvoice(history[0]!);
    const rawOlder = await rawInvoice(history[1]!);
    // ICV continues the live chain, in ISSUANCE order.
    expect(rawOld.icv).toBe(counterBefore + 1);
    expect(rawOlder.icv).toBe(counterBefore + 2);
    expect(rawOld.qr).not.toBeNull();
    // The PIH links across the live/backfilled boundary.
    expect(rawOld.pih).not.toBe(GENESIS_PIH);

    // The NEGATIVE LEDGER PROOF: zero journal rows added by the backfill.
    expect(await journalCount()).toBe(journalsBefore);

    // Idempotent: the re-run finds nothing.
    const rerun = await withTenant(Z_TENANT, () =>
      zatca.backfillRun({ deviceId, limit: 200, sellerName: "Zatca Spec Seller", actorId: Z_ACTOR }),
    );
    expect(rerun.stamped).toBe(0);

    // The counter advanced exactly by the stamped count, monotonically.
    const counterAfter = (await withTenant(Z_TENANT, () => zatca.findDevice(deviceId))).icvCounter;
    expect(counterAfter).toBe(counterBefore + history.length);

    // The whole chain (live + backfilled) verifies — one ICV sequence.
    const verification = await withTenant(Z_TENANT, () => zatca.verifyDeviceChain(deviceId));
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBe(counterBefore + history.length);
  });
});

describe("the report extension (T-10 — the per-device filter + chain columns)", () => {
  it("enriches the submission log with device/ICV/PIH/QR columns and filters by device", async () => {
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const deviceId = devices[0]!.id;
    const chain = await withTenant(Z_TENANT, () => zatca.deviceChain(deviceId));
    const sample = chain[0]!;

    // Enqueue a submission whose source IS the stamped invoice (the
    // registry store — the operational write surface).
    const submissionsStore = await import("../../modules/tax/submissions/store");
    await withTenant(Z_TENANT, () =>
      submissionsStore.enqueueSubmission({
        countryCode: "SA",
        adapterId: "zatca",
        sourceType: "sales_invoice",
        sourceId: sample.id,
        payloadDigest: null,
        actorId: Z_ACTOR,
      }),
    );
    const rows = await withTenant(Z_TENANT, () =>
      taxQueries.submissionLog({ dateFrom: "2025-01-01", dateTo: "2027-01-01" }),
    );
    const enriched = rows.find((row) => row.sourceId === sample.id);
    expect(enriched).toBeDefined();
    expect(enriched!.zatcaDeviceName).toBe("Guard EIAS");
    expect(enriched!.icv).toBe(sample.icv);
    expect(enriched!.qrPresent).toBe(true);

    // The device filter keeps ONLY this device's stamped sources.
    const filtered = await withTenant(Z_TENANT, () =>
      taxQueries.submissionLog({
        dateFrom: "2025-01-01",
        dateTo: "2027-01-01",
        deviceId,
      }),
    );
    expect(filtered.length).toBeGreaterThan(0);
    for (const row of filtered) {
      expect(row.icv).not.toBeNull();
      expect(row.zatcaDeviceName).not.toBeNull();
    }
    // A foreign device id filters everything out (no existence leak).
    const empty = await withTenant(Z_TENANT, () =>
      taxQueries.submissionLog({
        dateFrom: "2025-01-01",
        dateTo: "2027-01-01",
        deviceId: "11111111-1111-4111-8111-111111111111",
      }),
    );
    expect(empty).toHaveLength(0);
  });
});

describe("sync feed additive columns (CR-36 g)", () => {
  it("the sales_invoices projection carries icv/qrPayload/classification", async () => {
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const deviceId = devices[0]!.id;
    const chain = await withTenant(Z_TENANT, () => zatca.deviceChain(deviceId));
    const sample = chain[0]!;
    await withTenant(Z_TENANT, () => syncFeed("sales_invoices"));
    const su = await superuserClient();
    const rows = await su.query(
      `SELECT payload FROM change_log WHERE tenant_id = $1 AND entity_type = 'sales_invoices'
        AND entity_id = $2 ORDER BY seq DESC LIMIT 1`,
      [Z_TENANT, sample.id],
    );
    await su.end();
    expect(rows.rows).toHaveLength(1);
    const payload = rows.rows[0]!.payload as Record<string, unknown>;
    expect(String(payload.icv)).toBe(String(sample.icv));
    expect(payload.qrPayload).not.toBeNull();
    expect(payload.classification).toBe("STANDARD");
  });
});

describe("the EXPLAIN-verified chain walk (acceptance 8 — OA-06)", () => {
  it("the chain-verification path uses the (tenant, device, icv) index", async () => {
    const devices = await withTenant(Z_TENANT, () => zatca.listDevices({ limit: 10 }));
    const su = await superuserClient();
    const plan = await su.query(
      `EXPLAIN SELECT id FROM sales_invoices
        WHERE tenant_id = $1 AND zatca_device_id = $2 AND icv IS NOT NULL
        ORDER BY icv`,
      [Z_TENANT, devices[0]!.id],
    );
    await su.end();
    const planText = plan.rows.map((row) => Object.values(row)[0]).join("\n");
    // The (tenant, device, icv) index family — the planner may pick the
    // partial UNIQUE (the same columns, stronger guarantee) or the plain
    // partial index; either is the EXPLAIN-verified chain-walk path.
    expect(planText).toMatch(/uq_sales_invoices_tenant_device_icv|ix_sales_invoices_tenant_device_icv/);
  });
});
