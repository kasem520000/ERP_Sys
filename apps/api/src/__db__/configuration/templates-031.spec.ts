import { beforeAll, describe, expect, it } from "vitest";

import {
  HEALTHCARE_TEMPLATE_MANIFEST,
  RETAIL_MANIFEST,
  hashManifestJson,
} from "@erp/contracts";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import {
  findAppliedStateRow,
  parseAppliedOverrides,
} from "../../modules/configuration/application/apply/applied-state.store";
import { TemplatePrerequisitesBlockedError } from "../../modules/configuration/application/apply/prerequisites";
import {
  applyService,
  auditActions,
  grantEntitlement,
  postServiceInvoice,
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
  seedPostingSubstrate,
  switchService,
  tenantLevelSeries,
  type PostingSubstrate,
} from "./template-fixtures";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";

/**
 * PHASE-031 T7 db spec — the healthcare commercial shell through the
 * UNMODIFIED PHASE-015 engine (industries/README §8; the seven
 * per-template governance requirements; BR-038 additive-only; INV-022 —
 * the negative-ledger gate; ED-07's zero-clinical boundary enforced by the
 * machine-check in healthcare-no-clinical-surfaces.spec):
 *
 * - `industry.healthcare` v1.0.0 applies cleanly to a fresh business-plan
 *   tenant (the 0038 notes grants + the 0027 crm.service_orders grant + the
 *   base grants cover its REQUIRED chain at CURRENT_SHIPPED_PHASE 31, and
 *   the shell's OWN insurance_claim_billing capability —
 *   available_from_phase PHASE-031 ≤ 031 — resolves LIVE on its release
 *   day): the applied row pins the KNOWN migration-0043 content hash, the
 *   append-only series registry lands (INV- / CN- / RCP- / GRN-), report
 *   pins (notes.aging / notes.maturity-calendar / ar.aging — the §J
 *   reconciliation — / inventory.expiry_list — the PHASE-015 industry
 *   contract, verbatim) + the bilingual onboarding checklist (first_claim
 *   VISIBLE on notes.received; the patients step carries the honest
 *   "no clinical data" framing) + enabled modules (notes + crm ON)
 *   materialize, the apply is audited, and the derived billing/pharmacy
 *   navigation + terminology (المريض (الملف المالي) / مطالبة تأمينية /
 *   دفع مباشر) + the six bare workflow policies + the settings-mapped
 *   claim-ref capture policy (sales.claim_ref_required_for_insured TRUE)
 *   resolve live — the pharmacy_fefo_enforced key rides
 *   inventory.fefo_for_expiry_items TRUE via the inventory defaults.
 * - The T4 claim-capture legs on the template tenant: an insurance-selected
 *   invoice without its claim ref is rejected with the typed
 *   CLAIM_REF_REQUIRED error and ZERO residue (no invoice row); a self-pay
 *   invoice saves the field null; a claim ref on a self-pay invoice is
 *   rejected with the typed CLAIM_REF_ON_SELF_PAY error (the two states
 *   stay disjoint — the durable marker is claim_ref itself).
 * - Re-apply is idempotent (zero writes).
 * - Switch safety (BR-038): retail → healthcare is additive-only — the
 *   posted CLAIM invoice (insured, claimRef CLM-031-A) survives
 *   byte-identical WITH its claim_ref retained and readable (posted claim
 *   invoices are immutable ordinary documents; the shell never destroys
 *   data), the series registry is the union (retail rows untouched,
 *   goods_receipt + receipt appended; sales_invoice / credit_note collide
 *   on existing doc types so no row mutates), archived_* snapshots hold the
 *   retail set (read-only), switching BACK always succeeds, and every
 *   switch is audited.
 * - Degraded entitlement (§8 #7, fail-closed): healthcare without
 *   `notes.received` blocks with the typed TemplatePrerequisitesBlockedError
 *   and the exact missing chain (notes.received feeds BOTH the
 *   insurance_claim_billing and pdc_notes REQUIRED capabilities) — never a
 *   silent back-office apply, zero rows written — and granting the key BACK
 *   recovers the apply with the SAME manifest (activation is entitlement
 *   state, never a manifest edit).
 * - L5 beats L1 (BR-038 R8): an explicit sales.claim_ref_required_for_insured
 *   tenant setting (false) overrides the manifest's true default — and the
 *   SAVE PATH follows (an insured invoice without a claim ref then saves —
 *   capture behavior only, never posting).
 * - THE NEGATIVE LEDGER PROOF (INV-022): applying, re-applying, switching,
 *   re-switching, capturing, blocking, and granting produce ZERO journal
 *   rows — templates and their claim metadata are configuration, never a
 *   fork. The consolidated final gate re-proves the whole file.
 */

/** KNOWN hash — `pnpm validate:manifests` on the ten-template set (the
 *  constant is byte-identical to the migration 0043 registry seed and the
 *  docs mirror docs/industries/templates/manifests/manifest.healthcare.json
 *  with the ar.aging pin reconciliation). */
const KNOWN_HASHES: Readonly<Record<string, string>> = Object.freeze({
  "industry.healthcare": "sha256:f8b707e6981379e392038849853a7a6b1d8312fe140ced388e83fc910510947e",
});

// -- tenant A: the healthcare apply + the claim-capture legs ------------------
let hcTenant = "";
let hcOwner = "";
let hcSubstrate!: PostingSubstrate;

// -- tenant B: switch safety (retail → healthcare → retail) -------------------
let switchHcTenant = "";
let switchHcOwner = "";
let switchHcInvoice!: {
  invoiceId: string;
  invoiceNo: string;
  journalEntryId: string;
};

// -- tenant C: degraded entitlement (fail-closed + grant-back recovery) -------
let hcDegradedTenant = "";
let hcDegradedOwner = "";

/** The post-posting ledger baseline captured in beforeAll — the posted claim
 *  invoice's OWN journal rows and nothing more; every apply/switch/capture
 *  operation this spec performs must leave it byte-identical (INV-022). */
let switchHcLedger!: JournalCounters;

beforeAll(async () => {
  const healthcare = await provisionBusinessTenant("hc-031", "industry.healthcare");
  hcTenant = healthcare.tenantId;
  hcOwner = healthcare.ownerId;

  // The healthcare switch-safety tenant: retail (back-office counter)
  // applied over a REAL posted CLAIM invoice — the insured leg of the
  // templates-019 switch-tenant shape (a posted CREDIT service invoice
  // through the real sales flow carrying the external claim reference; the
  // journals are byte-identical to the self-pay shape, G-01).
  const switchedHc = await provisionBusinessTenant("switch-hc", "industry.retail");
  switchHcTenant = switchedHc.tenantId;
  switchHcOwner = switchedHc.ownerId;
  const hcSubstrateForSwitch = await seedPostingSubstrate(switchHcTenant, switchHcOwner, "SW031H");
  switchHcInvoice = await postServiceInvoice(
    hcSubstrateForSwitch,
    "pre-switch healthcare claim invoice",
    "2026-02-15",
    { insured: true, claimRef: "CLM-031-A" },
  );
  const hcLedgerAfterPosting = await journalCounters(switchHcTenant);
  expect(hcLedgerAfterPosting.entries).toBeGreaterThan(0); // the proof object exists
  const appliedRetailHc = await withTenant(switchHcTenant, () =>
    applyService.apply(switchHcOwner, { templateKey: "industry.retail", mode: "initial" }),
  );
  expect(appliedRetailHc.applied).toBe(true);
  // INV-022: the retail apply over posted history wrote ZERO journal rows —
  // this baseline is what every later switch must match byte-for-byte.
  switchHcLedger = await journalCounters(switchHcTenant);
  expect(switchHcLedger).toEqual(hcLedgerAfterPosting);

  // The degraded tenant: the claim-settlement chain key revoked (0038
  // granted notes.received to business; the revoke simulates the pre-grant
  // / downgraded plan — the fail-closed §8 #7 leg).
  const hcDegraded = await provisionBusinessTenant("hc-degraded", "industry.healthcare");
  hcDegradedTenant = hcDegraded.tenantId;
  hcDegradedOwner = hcDegraded.ownerId;
  await revokeEntitlement(hcDegradedTenant, "notes.received");
});

describe("templates-031 — the healthcare commercial shell through the PHASE-015 engine", () => {
  it("industry.healthcare v1.0.0 applies cleanly to a fresh business tenant", async () => {
    // INV-022: the ledger snapshot the whole apply must not move.
    const ledgerBefore = await journalCounters(hcTenant);

    const result = await withTenant(hcTenant, () =>
      applyService.apply(hcOwner, { templateKey: "industry.healthcare", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.templateKey).toBe("industry.healthcare");
    expect(result.version).toBe("1.0.0");
    expect(result.manifestHash).toBe(hashManifestJson(HEALTHCARE_TEMPLATE_MANIFEST));
    expect(result.manifestHash).toBe(KNOWN_HASHES["industry.healthcare"]);

    // The four REQUIRED capabilities resolve LIVE — including the shell's
    // OWN insurance_claim_billing (available_from_phase PHASE-031 ≤ 31,
    // keys granted: sales.invoices + notes.received + partners.statements)
    // and the REQUIRED pdc_notes (0038 grants — claims settle by cheque/PDC,
    // so 027 is a prereq of this template, no phase-gating fallback needed).
    for (const capabilityId of [
      "insurance_claim_billing",
      "pdc_notes",
      "expiry_tracking_fefo",
      "job_cards",
    ]) {
      const capability = result.prerequisiteCheck.capabilities.find(
        (candidate) => candidate.capabilityId === capabilityId,
      );
      expect(capability, capabilityId).toMatchObject({ status: "included" });
    }
    expect(result.prerequisiteCheck.status).toBe("ok");
    expect(result.prerequisiteCheck.requiresAcknowledgement).toBe(false);

    // -- the applied row: key / version / KNOWN 0043 seed hash --------------
    const row = await withTenant(hcTenant, () => findAppliedStateRow());
    expect(row).toBeDefined();
    expect(row!.templateKey).toBe("industry.healthcare");
    expect(row!.appliedVersion).toBe("1.0.0");
    expect(row!.status).toBe("ACTIVE");
    expect(row!.appliedBy).toBe(hcOwner);
    expect(row!.appliedManifestHash).toBe(hashManifestJson(HEALTHCARE_TEMPLATE_MANIFEST));
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.healthcare"]);

    // -- series registry: the four billing/pharmacy doc types ----------------
    const series = await tenantLevelSeries(hcTenant);
    expect(series.map((entry) => entry.docType)).toEqual(
      Object.keys(HEALTHCARE_TEMPLATE_MANIFEST.document_numbering_defaults).sort(),
    );
    expect(series.every((entry) => entry.nextValue === "1")).toBe(true); // acquisition-inert registry rows (R5)
    expect(series.find((entry) => entry.docType === "sales_invoice")?.format).toBe(
      "INV-{yyyy}-{seq:6}",
    );
    expect(series.find((entry) => entry.docType === "credit_note")?.format).toBe("CN-{yyyy}-{seq:5}");
    expect(series.find((entry) => entry.docType === "receipt")?.format).toBe("RCP-{yyyy}-{seq:6}");
    expect(series.find((entry) => entry.docType === "goods_receipt")?.format).toBe(
      "GRN-{yyyy}-{seq:6}",
    );

    // -- overrides: report pins + checklist + modules ------------------------
    const overrides = parseAppliedOverrides(row!.overrides);
    expect(overrides.report_pins.map((pin) => pin.report_key)).toEqual([
      "notes.aging",
      "notes.maturity-calendar",
      "ar.aging", // the §J reconciliation (partners.ar_aging → live registry key)
      "inventory.expiry_list", // the PHASE-015 industry contract — verbatim
    ]);
    expect(overrides.report_pins[0]).toMatchObject({
      report_key: "notes.aging",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.report_pins[1]).toMatchObject({
      report_key: "notes.maturity-calendar",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    });
    expect(overrides.report_pins[2]).toMatchObject({
      report_key: "ar.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    });
    expect(overrides.report_pins[3]).toMatchObject({
      report_key: "inventory.expiry_list",
      pinned: true,
      dashboard: false,
      default_period: "this_week",
    });
    expect(overrides.onboarding_checklist.map((step) => step.id)).toEqual(
      HEALTHCARE_TEMPLATE_MANIFEST.onboarding_steps.map((step) => step.id),
    );
    // first_claim carries feature_key notes.received → VISIBLE (entitled at
    // 031 and its owning phase 027 already shipped); every step resolves
    // visible — no coming-soon label anywhere. The patients step carries the
    // honest "no clinical data" framing (the ED-07/ED-11 boundary).
    expect(overrides.onboarding_checklist.find((step) => step.id === "first_claim")).toMatchObject({
      featureKey: "notes.received",
      status: "visible",
    });
    expect(overrides.onboarding_checklist.find((step) => step.id === "patients")).toMatchObject({
      title: {
        en: "Patient financial files (no clinical data)",
        ar: "الملفات المالية للمرضى (بيانات مالية فقط)",
      },
      status: "visible",
    });
    expect(overrides.onboarding_checklist.every((step) => step.status === "visible")).toBe(true);
    expect(overrides.enabled_modules).toEqual(HEALTHCARE_TEMPLATE_MANIFEST.default_modules_enabled);
    expect(overrides.enabled_modules).toContain("notes");
    expect(overrides.enabled_modules).toContain("crm");

    // -- audited --------------------------------------------------------------
    expect(await auditActions(hcTenant, "industry.template.applied")).toBe(1);

    // -- INV-022: the apply wrote ZERO journal rows --------------------------
    await expectZeroJournalDelta(hcTenant, ledgerBefore);

    // -- the derived config: billing/pharmacy live, terminology AR + EN -----
    resetConfigurationCache();
    const config = await withTenant(hcTenant, () => resolver.resolveTenantStatic(hcTenant));
    expect(config.layers.l1_template?.key).toBe("industry.healthcare");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
    expect(config.ui.navigation).toEqual(["billing", "pharmacy"]);
    const billing = config.ui.navigation_tree.find((group) => group.id === "billing")!;
    expect(billing.items.map((item) => item.id)).toEqual(["visits", "invoices", "claims"]);
    expect(billing.items.every((item) => item.phase_gated === undefined)).toBe(true);
    expect(
      config.ui.navigation_tree.find((group) => group.id === "pharmacy")!.items.map((item) => item.id),
    ).toEqual(["expiry", "counter", "pdc"]);
    expect(config.ui.terminology["partner.patient"]).toEqual({
      en: "Patient (financial file)",
      ar: "المريض (الملف المالي)",
    });
    expect(config.ui.terminology["claim.ref"]).toEqual({
      en: "Insurance claim",
      ar: "مطالبة تأمينية",
    });
    expect(config.ui.terminology["billing.self_pay"]).toEqual({
      en: "Self-pay",
      ar: "دفع مباشر",
    });
    expect(config.ui.terminology["svc.visit"]).toEqual({
      en: "Visit",
      ar: "الزيارة",
    });
    // The notes + crm modules are INSTALLED (L8 from default_modules_enabled).
    expect(config.layers.l8_installed.notes).toBe(true);
    expect(config.layers.l8_installed.crm).toBe(true);
    // The six PHASE-031 healthcare workflow policies land as bare L1
    // defaults (registry-only keys); the claim-ref capture policy lands on
    // its SETTINGS_REGISTRY mapping (sales.claim_ref_required_for_insured —
    // L5 may override, see the leg at the end).
    expect(config.policies["patient_file_financial_only"]).toBe(true);
    expect(config.policies["insurance_invoice_billed_to_company_partner"]).toBe(true);
    expect(config.policies["pharmacy_fefo_enforced"]).toBe(true);
    expect(config.policies["dunning_by_claim_enabled"]).toBe(true);
    expect(config.policies["insurance_credit_limit_per_company"]).toBe(true);
    expect(config.policies["sales.claim_ref_required_for_insured"]).toBe(true);
    // pharmacy_fefo_enforced rides the inventory defaults surface too (the
    // grocery/restaurant precedent — FEFO is the L1 source for
    // inventory.fefo_for_expiry_items).
    expect(config.policies["inventory.fefo_for_expiry_items"]).toBe(true);

    // Seed the posting substrate for the claim-capture legs below (after the
    // apply — the substrate needs no template interaction).
    hcSubstrate = await seedPostingSubstrate(hcTenant, hcOwner, "HC031");
  });

  it("claim capture (T4): CLAIM_REF_REQUIRED is typed, bilingual, and leaves zero residue; self-pay saves null", async () => {
    // The capture policy resolves TRUE on the template tenant (the platform
    // default; the manifest ships the same true as its L1 default).
    const invoices = invoiceServiceFor(hcSubstrate);
    const ledgerBefore = await journalCounters(hcTenant);
    const su = await superuserClient();
    const countBefore = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales_invoices WHERE tenant_id = $1`,
      [hcTenant],
    );
    await su.end();

    // -- the typed rejection: insurance billing selected, no claim ref ------
    const rejected = await withTenant(hcTenant, () =>
      invoices
        .create({
          ...claimInvoiceInput(hcSubstrate, "claim rejection probe"),
          insured: true,
          claimRef: null,
        })
        .catch((error: unknown) => error),
    );
    expect(rejected).toBeInstanceOf(Error);
    expect((rejected as { code?: string }).code).toBe("CLAIM_REF_REQUIRED");
    expect((rejected as { message?: string }).message).toContain("claim reference");
    expect((rejected as { details?: { bilingual?: { ar: string; en: string } } }).details?.bilingual
      ?.ar).toContain("المطالبة");

    // Zero residue: no invoice row was written, no journal row moved.
    const su2 = await superuserClient();
    const countAfter = await su2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sales_invoices WHERE tenant_id = $1`,
      [hcTenant],
    );
    await su2.end();
    expect(countAfter.rows[0]!.n).toBe(countBefore.rows[0]!.n);
    await expectZeroJournalDelta(hcTenant, ledgerBefore);

    // -- the disjoint-state rejection: a claim ref on a SELF-PAY invoice ----
    const selfPayRejected = await withTenant(hcTenant, () =>
      invoices
        .create({
          ...claimInvoiceInput(hcSubstrate, "self-pay rejection probe"),
          insured: false,
          claimRef: "CLM-SELF-PAY-PROBE",
        })
        .catch((error: unknown) => error),
    );
    expect(selfPayRejected).toBeInstanceOf(Error);
    expect((selfPayRejected as { code?: string }).code).toBe("CLAIM_REF_ON_SELF_PAY");

    // -- the happy legs: a claim invoice saves WITH its ref ------------------
    const claim = await postServiceInvoice(
      hcSubstrate,
      "insured visit invoice",
      "2026-02-20",
      { insured: true, claimRef: "CLM-031-B" },
    );
    // The number renders from the sales service's own SAL series (the
    // template's INV rows are the acquisition-inert registry proposals —
    // R5; the numbering uniqueness rides the assignment table).
    expect(claim.invoiceNo).toMatch(/^SAL-/);
    const su3 = await superuserClient();
    const stored = await su3.query<{ claim_ref: string | null }>(
      `SELECT claim_ref FROM sales_invoices WHERE id = $1`,
      [claim.invoiceId],
    );
    await su3.end();
    expect(stored.rows[0]!.claim_ref).toBe("CLM-031-B");

    // A self-pay invoice saves the field NULL (the durable marker semantics).
    const selfPay = await postServiceInvoice(hcSubstrate, "self-pay visit invoice", "2026-02-21");
    const su4 = await superuserClient();
    const storedSelfPay = await su4.query<{ claim_ref: string | null }>(
      `SELECT claim_ref FROM sales_invoices WHERE id = $1`,
      [selfPay.invoiceId],
    );
    await su4.end();
    expect(storedSelfPay.rows[0]!.claim_ref).toBeNull();
  });

  it("re-apply of the healthcare template is idempotent (zero writes)", async () => {
    const before = await withTenant(hcTenant, () => findAppliedStateRow());
    const seriesBefore = await tenantLevelSeries(hcTenant);
    const ledgerBefore = await journalCounters(hcTenant);

    const second = await withTenant(hcTenant, () =>
      applyService.apply(hcOwner, { templateKey: "industry.healthcare", mode: "reapply" }),
    );
    expect(second.applied).toBe(false);
    expect(second.reason).toBe("already-applied");

    const after = await withTenant(hcTenant, () => findAppliedStateRow());
    expect(after!.appliedAt).toBe(before!.appliedAt);
    expect(after!.appliedManifestHash).toBe(KNOWN_HASHES["industry.healthcare"]);
    expect(await tenantLevelSeries(hcTenant)).toHaveLength(seriesBefore.length);
    expect(await auditActions(hcTenant, "industry.template.applied")).toBe(1);
    await expectZeroJournalDelta(hcTenant, ledgerBefore);
  });

  it("switch safety (BR-038): retail → healthcare is additive-only, the posted CLAIM invoice survives with its claim_ref, and back again", async () => {
    // The pre-switch registry: retail's own series (the posted invoice's
    // number row is branch-scoped — the tenant-level rows are the registry;
    // sales_invoice carries only the acquisition row, so the retail apply
    // skipped it exactly like templates-019/030's switch tenants).
    const seriesBefore = await tenantLevelSeries(switchHcTenant);
    expect(seriesBefore.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "pos_sale",
      "stock_transfer",
    ]);

    // The pre-switch posted-claim-history snapshot (byte-level, INCLUDING the
    // claim_ref column — the phase's zero-data-loss contract) + the ledger
    // baseline both switches must not move.
    const historyBefore = await invoiceHistorySnapshot(switchHcTenant, switchHcInvoice);
    const ledgerBefore = await journalCounters(switchHcTenant);

    // The grants cover healthcare's REQUIRED chain on business — the switch
    // needs no acknowledgement (nothing REQUIRED is unshipped at 031,
    // including insurance_claim_billing at its own release phase).
    const switched = await withTenant(switchHcTenant, () =>
      switchService.switch(switchHcOwner, { targetTemplateKey: "industry.healthcare" }),
    );
    expect(switched.applied).toBe(true);
    await expectZeroJournalDelta(switchHcTenant, ledgerBefore); // INV-022

    const row = await withTenant(switchHcTenant, () => findAppliedStateRow());
    expect(row!.templateKey).toBe("industry.healthcare");
    expect(row!.appliedManifestHash).toBe(KNOWN_HASHES["industry.healthcare"]);

    // -- ZERO data loss: the posted CLAIM invoice is intact BYTE-IDENTICAL,
    //    its claim_ref RETAINED and readable (an archived claim view reads
    //    it read-only; posted claim invoices are immutable ordinary docs) --
    expect(await invoiceHistorySnapshot(switchHcTenant, switchHcInvoice)).toEqual(historyBefore);
    const su = await superuserClient();
    const invoice = await su.query<{
      invoice_no: string;
      status: string;
      channel: string;
      claim_ref: string | null;
    }>(
      `SELECT invoice_no, status, channel, claim_ref FROM sales_invoices WHERE id = $1`,
      [switchHcInvoice.invoiceId],
    );
    await su.end();
    expect(invoice.rows[0]).toEqual({
      invoice_no: switchHcInvoice.invoiceNo,
      status: "POSTED",
      channel: "STANDARD",
      claim_ref: "CLM-031-A", // retained through the switch — never destroyed
    });

    // -- BR-038 archives: the retail snapshot is present, read-only ---------
    expect(row!.archivedTerminology).toHaveLength(1);
    expect(row!.archivedTerminology[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedTerminology[0]!.terminology["doc.sales_invoice_pos"]).toEqual({
      en: "POS sale",
      ar: "بيع نقطة البيع",
    });
    expect(row!.archivedNavigation[0]).toMatchObject({
      templateKey: "industry.retail",
      version: "1.0.0",
    });
    expect(row!.archivedNavigation[0]!.groups).toHaveLength(2); // selling + stock
    expect(row!.archivedCapabilities[0]).toMatchObject({ templateKey: "industry.retail" });

    // -- additive-only numbering: the retail rows untouched, the new
    //    healthcare doc types appended (receipt + goods_receipt); the
    //    sales_invoice / credit_note doc types already carry series (the
    //    branch-scoped acquisition + the retail tenant row), so no row
    //    mutates (R5 append-only) ------------------------------------------
    const seriesAfter = await tenantLevelSeries(switchHcTenant);
    expect(seriesAfter.map((entry) => entry.docType)).toEqual([
      "credit_note",
      "goods_receipt",
      "pos_sale",
      "receipt",
      "stock_transfer",
    ]);
    expect(seriesAfter.find((entry) => entry.docType === "receipt")?.format).toBe(
      "RCP-{yyyy}-{seq:6}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "goods_receipt")?.format).toBe(
      "GRN-{yyyy}-{seq:6}",
    );
    expect(seriesAfter.find((entry) => entry.docType === "credit_note")?.format).toBe(
      "CN-{yyyy}-{seq:5}",
    ); // the retail row, byte-for-byte
    expect(seriesAfter.find((entry) => entry.docType === "pos_sale")?.format).toBe(
      "POS-{branch}-{yy}{MM}-{seq:5}",
    ); // the retail row, byte-for-byte
    expect(seriesAfter.find((entry) => entry.docType === "stock_transfer")?.format).toBe(
      "TRF-{yyyy}-{seq:5}",
    ); // the retail row, byte-for-byte

    // -- the audited switch + the effective config ---------------------------
    expect(await auditActions(switchHcTenant, "industry.template.switched")).toBe(1);
    resetConfigurationCache();
    const config = await withTenant(switchHcTenant, () =>
      resolver.resolveTenantStatic(switchHcTenant),
    );
    expect(config.layers.l1_template?.key).toBe("industry.healthcare");
    expect(config.ui.navigation).toEqual(["billing", "pharmacy"]); // derived from healthcare now
    expect(config.ui.terminology["claim.ref"]).toEqual({
      en: "Insurance claim",
      ar: "مطالبة تأمينية",
    });

    // -- switching BACK always succeeds (nothing was destroyed) -------------
    const back = await withTenant(switchHcTenant, () =>
      switchService.switch(switchHcOwner, { targetTemplateKey: "industry.retail" }),
    );
    expect(back.applied).toBe(true);
    await expectZeroJournalDelta(switchHcTenant, ledgerBefore); // INV-022 — both switches
    const restored = await withTenant(switchHcTenant, () => findAppliedStateRow());
    expect(restored!.templateKey).toBe("industry.retail");
    expect(restored!.appliedManifestHash).toBe(hashManifestJson(RETAIL_MANIFEST));
    // The archives hold BOTH template sets (append-only history, R2/R6).
    expect(restored!.archivedTerminology.map((entry) => entry.templateKey)).toEqual([
      "industry.retail",
      "industry.healthcare",
    ]);
    // The healthcare series REMAIN (append-only — R5).
    const seriesBack = await tenantLevelSeries(switchHcTenant);
    expect(seriesBack.map((entry) => entry.docType)).toContain("receipt");
    expect(seriesBack.map((entry) => entry.docType)).toContain("goods_receipt");
    // The posted CLAIM invoice is STILL untouched — claim_ref included.
    expect(await invoiceHistorySnapshot(switchHcTenant, switchHcInvoice)).toEqual(historyBefore);
    const suBack = await superuserClient();
    const invoiceBack = await suBack.query<{ claim_ref: string | null }>(
      `SELECT claim_ref FROM sales_invoices WHERE id = $1`,
      [switchHcInvoice.invoiceId],
    );
    await suBack.end();
    expect(invoiceBack.rows[0]!.claim_ref).toBe("CLM-031-A");
    expect(await auditActions(switchHcTenant, "industry.template.switched")).toBe(2);
  });

  it("degraded entitlement (fail-closed): the typed claim chain blocks, and a grant-back recovers activation", async () => {
    const ledgerBefore = await journalCounters(hcDegradedTenant);

    // notes.received feeds TWO REQUIRED capabilities (insurance_claim_billing
    // + pdc_notes) AND the required_feature_keys backstop — the missing chain
    // names it once, honestly.
    const blocked = await withTenant(hcDegradedTenant, () =>
      applyService
        .apply(hcDegradedOwner, { templateKey: "industry.healthcare", mode: "initial" })
        .catch((error: unknown) => error),
    );
    expect(blocked).toBeInstanceOf(TemplatePrerequisitesBlockedError);
    expect((blocked as TemplatePrerequisitesBlockedError).missingChain).toContain("notes.received");
    expect((blocked as TemplatePrerequisitesBlockedError).guidance?.ar).toContain("notes.received");
    expect((blocked as TemplatePrerequisitesBlockedError).guidance?.en).toContain("notes.received");

    // Zero rows written — never a silent back-office apply.
    const row = await withTenant(hcDegradedTenant, () => findAppliedStateRow());
    expect(row).toBeUndefined();
    await expectZeroJournalDelta(hcDegradedTenant, ledgerBefore);

    // Granting the key BACK recovers the apply with the SAME manifest —
    // activation is entitlement state, never a manifest edit (§2 item 5).
    await grantEntitlement(hcDegradedTenant, "notes.received");
    const recovered = await withTenant(hcDegradedTenant, () =>
      applyService.apply(hcDegradedOwner, { templateKey: "industry.healthcare", mode: "initial" }),
    );
    expect(recovered.applied).toBe(true);
    expect(recovered.manifestHash).toBe(KNOWN_HASHES["industry.healthcare"]);
    expect(recovered.prerequisiteCheck.status).toBe("ok");
    await expectZeroJournalDelta(hcDegradedTenant, ledgerBefore); // INV-022 — the whole leg
  });

  it("L5 tenant setting beats the L1 manifest default (BR-038 R8): sales.claim_ref_required_for_insured off — and the save path follows", async () => {
    // The healthcare manifest ships the capture policy true as its L1 default
    // (proven in the first test); an explicit tenant_settings row wins per
    // the §3 precedence table (L10 > L5 > L1 > platform default). The write
    // mirrors the templates-018/019/030 precedent (the configuration db
    // specs seed L5 rows through the superuser surface).
    const ledgerBefore = await journalCounters(hcTenant);
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (gen_random_uuid(), $1, 'sales.claim_ref_required_for_insured', 'false'::jsonb, now())
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [hcTenant],
    );
    await su.end();
    resetConfigurationCache();
    const config = await withTenant(hcTenant, () => resolver.resolveTenantStatic(hcTenant));
    expect(config.layers.l1_template?.key).toBe("industry.healthcare");
    expect(config.policies["sales.claim_ref_required_for_insured"]).toBe(false); // L5 wins
    // The untouched healthcare policies keep their L1 defaults.
    expect(config.policies["patient_file_financial_only"]).toBe(true);
    expect(config.policies["dunning_by_claim_enabled"]).toBe(true);

    // The SAVE PATH follows the resolved policy: an insured invoice without
    // its claim ref now SAVES (capture behavior only, never posting — the
    // journals are the same G-01 shape either way).
    const invoices = invoiceServiceFor(hcSubstrate);
    const relaxed = await withTenant(hcTenant, () =>
      invoices.create({
        ...claimInvoiceInput(hcSubstrate, "insured invoice under relaxed capture"),
        insured: true,
        claimRef: null,
      }),
    );
    expect(relaxed.status).toBe("DRAFT"); // saved — the L5 posture allowed it
    // Capture only, never posting: the draft carries ZERO journal rows and
    // the typed error machinery stays silent.
    await expectZeroJournalDelta(hcTenant, ledgerBefore); // a settings write + a draft are never journal writes

    // Restore the capture posture (the L5 row removed ⇒ the L1/platform true
    // default resumes) — the probe leaves the spec's tenant state clean for
    // the consolidated gate.
    const su2 = await superuserClient();
    await su2.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'sales.claim_ref_required_for_insured'`, [
      hcTenant,
    ]);
    await su2.end();
    resetConfigurationCache();
  });

  it("the negative ledger proof (INV-022): every apply/switch/re-apply/capture/grant-back wrote zero journal rows", async () => {
    // Each operation above already asserted its own ZERO delta; this is the
    // consolidated gate. The healthcare tenant carries ONLY the claim-capture
    // legs' posted invoices (the insured + self-pay proofs — their OWN
    // journals, nothing the configuration wrote); the degraded-then-recovered
    // tenant carries NO journal rows at all (provisioning, applying,
    // blocking, granting, and re-applying are configuration, never posting).
    // The switch tenant carries exactly its posted pre-switch claim invoice
    // rows (the beforeAll baseline) — unchanged through two switches.
    expect(await journalCounters(hcDegradedTenant)).toEqual({ entries: 0, lines: 0 });
    expect(await journalCounters(switchHcTenant)).toEqual(switchHcLedger);
    const hcCounters = await journalCounters(hcTenant);
    expect(hcCounters.entries).toBeGreaterThan(0); // the posted claim/self-pay proofs exist
    // Templates are configuration, never a fork (INV-022).
  });
});

// -- local helpers ---------------------------------------------------------------

/** A fresh SalesInvoiceService wired exactly as the sales module registers it. */
function invoiceServiceFor(substrate: PostingSubstrate): SalesInvoiceService {
  void substrate;
  const audit = new AuditService(new DrizzleAuditStore());
  return new SalesInvoiceService(
    audit,
    new PostingService(audit, new PartnerSubledgerService()),
    new NumberingService(audit),
    new TaxResolverService(),
  );
}

/** The golden NS service-line input shape (the postServiceInvoice line). */
function claimInvoiceInput(substrate: PostingSubstrate, note: string) {
  return {
    branchId: substrate.branchId,
    customerId: substrate.customerId,
    salesRepId: null as string | null,
    kind: "CREDIT" as const,
    invoiceDate: "2026-03-01",
    dueDate: null as string | null,
    currencyCode: "SAR",
    exchangeRate: null as string | null,
    orderId: null as string | null,
    deliveryId: null as string | null,
    warehouseId: null as string | null,
    cashAccountId: null as string | null,
    note,
    noteAr: null as string | null,
    actorId: substrate.ownerId,
    lines: [
      {
        itemId: null as string | null,
        accountId: substrate.serviceAccountId,
        deliveryLineId: null as string | null,
        description: "consultation",
        descriptionAr: null as string | null,
        qty: "1",
        unitPrice: "100.000000",
        discountAmount: null as string | null,
        taxCodeId: substrate.notSubjectTaxCodeId,
        batchId: null as string | null,
        serialIds: null as string[] | null,
        note: null as string | null,
      },
    ],
  };
}

/** The INV-022 proof object: per-tenant journal row counters. */
interface JournalCounters {
  readonly entries: number;
  readonly lines: number;
}

/** Count the tenant's journal rows (superuser read — the ledger oracle). */
async function journalCounters(tenantId: string): Promise<JournalCounters> {
  const su = await superuserClient();
  const rows = await su.query<{ entries: string; lines: string }>(
    `SELECT (SELECT count(*) FROM journal_entries WHERE tenant_id = $1)::text AS entries,
            (SELECT count(*) FROM journal_lines WHERE tenant_id = $1)::text AS lines`,
    [tenantId],
  );
  await su.end();
  return { entries: Number(rows.rows[0]!.entries), lines: Number(rows.rows[0]!.lines) };
}

/** INV-022: the operation between `before` and now wrote ZERO journal rows. */
async function expectZeroJournalDelta(tenantId: string, before: JournalCounters): Promise<void> {
  expect(await journalCounters(tenantId)).toEqual(before);
}

/** Byte-level snapshot of the posted claim-invoice history (invoice row
 *  INCLUDING the claim_ref column + journal lines with the partner stamp) —
 *  the proof object BR-038's zero-data-loss contract. */
async function invoiceHistorySnapshot(
  tenantId: string,
  posted: { invoiceId: string; journalEntryId: string },
): Promise<{
  invoice: { invoiceNo: string; status: string; channel: string; claimRef: string | null };
  journal: {
    direction: string;
    amount: string;
    accountId: string;
    partnerId: string | null;
  }[];
}> {
  const su = await superuserClient();
  const invoice = await su.query<{
    invoice_no: string;
    status: string;
    channel: string;
    claim_ref: string | null;
  }>(
    `SELECT invoice_no, status, channel, claim_ref FROM sales_invoices WHERE id = $1`,
    [posted.invoiceId],
  );
  await su.end();
  const lines = await withTenant(tenantId, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    return journal.listLines(posted.journalEntryId);
  });
  return {
    invoice: {
      invoiceNo: invoice.rows[0]!.invoice_no,
      status: invoice.rows[0]!.status,
      channel: invoice.rows[0]!.channel,
      claimRef: invoice.rows[0]!.claim_ref,
    },
    journal: lines.map((line) => ({
      direction: line.direction,
      amount: line.amount,
      accountId: line.accountId,
      partnerId: line.partnerId,
    })),
  };
}
