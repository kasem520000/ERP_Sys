import { generateUuidV7 } from "@erp/domain-core";
import { beforeAll, describe, expect, it } from "vitest";

import {
  accumulateSummary,
  outputTaxLines,
  recordDocumentTaxSummary,
} from "../../modules/tax/application/posting-adapter";
import { taxFromGross, taxFromNet } from "../../modules/tax/domain/resolver";
import type { ResolvedLine } from "../../modules/tax/domain/resolver";
import { withTenant } from "../../infra/db/tenant-context";
import * as journalStore from "../../modules/accounting/infrastructure/journal.store";
import { registrations, tPosting, taxCodes, vatReturns } from "./fixtures";
import type { PackTenant } from "./fixtures";

/**
 * PHASE-009 T12 — the per-pack fixture engine (ACCOUNTING_TESTS §8: every
 * pack ships the scenario suite before it can be enabled for tenants). One
 * shared, deterministic runner executes the seven engine-level scenario
 * classes + the rounding worked example per pack; each pack spec calls it
 * with its seeded rates/windows so the expected values always come from the
 * compliance-matrix facts (never re-typed literals).
 */

export interface PackScenarioProfile {
  readonly country: string;
  readonly vatStatus: "VAT_IN_FORCE" | "VAT_PLANNED" | "NO_VAT";
  /** The seeded standard-rate window covering 2026 documents (VAT packs). */
  readonly currentRate?: string;
  readonly currentFrom?: string;
  /** BH-style history: the asserted prior window (undefined = none recorded). */
  readonly priorWindow?: { rate: string; from: string; to: string };
  /** Currency minor units (2-dp or 3-dp — the rounding fixture's scale). */
  readonly minorUnits: 2 | 3;
  readonly currency: string;
  /**
   * The worked rounding example (one per minor-unit count per pack): the
   * base whose × rate product needs a REAL half-up decision at the
   * currency's minor units, with the hand-computed expected tax — the
   * inclusive mirror (gross = base + tax) must extract the same tax back.
   */
  readonly rounding?: { base: string; expectedTax: string };
}

export function runPackFixtureSuite(profile: PackScenarioProfile): void {
  beforeAll(async () => {
    const { setupPackTenant } = await import("./fixtures");
    void (await setupPackTenant(profile.country));
  });

  const pack = profile;
  const DOC_DATE = "2026-02-15"; // inside the seeded window + FY2026

  async function tenantOf(): Promise<PackTenant> {
    const { setupPackTenant } = await import("./fixtures");
    return setupPackTenant(pack.country);
  }

  /** Resolve + assert the canonical standard-sale line. */
  async function resolveStandard(
    tenant: PackTenant,
    amount: string,
    documentDate = DOC_DATE,
  ): Promise<ResolvedLine> {
    const { taxResolver } = await import("./fixtures");
    return withTenant(tenant.tenantId, () =>
      taxResolver.resolveOne({
        documentDate,
        pricingModeOverride: "EXCLUSIVE",
        line: { amount, taxCodeId: tenant.taxCodeIds.standard, currencyCode: tenant.currencyCode },
      }),
    );
  }

  /** Post a synthetic OUTPUT document through the engine + record summaries. */
  async function postSale(
    tenant: PackTenant,
    lines: readonly ResolvedLine[],
    sourceKey: string,
  ): Promise<string> {
    const { groups } = accumulateSummary("OUTPUT", lines);
    const grossSum = lines.reduce((sum, line) => sum + Number(line.gross), 0);
    const netSum = lines.reduce((sum, line) => sum + Number(line.taxBase), 0);
    const taxLines = outputTaxLines({ groups });
    const journalLines = [
      {
        purpose: "AR_CONTROL",
        direction: "DEBIT" as const,
        amount: grossSum.toFixed(4),
        partnerId: tenant.partnerIds.customer,
      },
      { purpose: "SALES_REVENUE", direction: "CREDIT" as const, amount: netSum.toFixed(4) },
      ...taxLines,
    ];
    // ONE ambient transaction: the journal AND the INV-012 summary rows
    // commit atomically (the production consumer pattern — the expense
    // service's flow).
    const result = await withTenant(tenant.tenantId, async () => {
      const posted = await tPosting.post(
        {
          source: { docType: "tax_fixture", docId: sourceKey, operation: "post" },
          entryDate: DOC_DATE,
          description: { en: `pack fixture ${pack.country}`, ar: `اختبار الحزمة ${pack.country}` },
          currency: tenant.currencyCode,
          lines: journalLines,
        },
        { postedBy: null },
      );
      await recordDocumentTaxSummary({
        sourceType: "tax_fixture",
        sourceId: sourceKey,
        documentDate: DOC_DATE,
        fiscalPeriodId: null,
        direction: "OUTPUT",
        lines,
      });
      return posted;
    });
    return result.journalEntryId;
  }


  /** Minimal journal-line tuples (the golden comparisons' shape). */
  async function linesOf(entryId: string) {
    return (await withTenant((await tenantOf()).tenantId, () => journalStore.listLines(entryId))).map(
      (line) => ({
        accountId: line.accountId,
        direction: line.direction as "DEBIT" | "CREDIT",
        amount: line.amount,
        partnerId: line.partnerId,
        taxCodeId: line.taxCodeId,
      }),
    );
  }

  if (pack.vatStatus === "VAT_IN_FORCE") {
    const currentRate = profile.currentRate as string;
    const currentFrom = profile.currentFrom as string;
    describe(`golden/pack-${pack.country.toLowerCase()} — VAT_IN_FORCE scenarios`, () => {
      it("standard-rated sale: line tax, snapshot, summary, journal lines", async () => {
        const tenant = await tenantOf();
        const expectedTax = taxFromNet("100.0000", currentRate, pack.currency);
        const line = await resolveStandard(tenant, "100.0000");
        expect(line.treatment).toBe("STANDARD_RATED");
        expect(line.rate).toBe(currentRate);
        expect(line.taxAmount).toBe(`${Number(expectedTax).toFixed(4)}`);
        expect(line.snapshot.effectiveFrom).toBe(currentFrom);
        expect(line.snapshot.verificationStatus).toBe("REQUIRES_VERIFICATION");
        expect(line.snapshot.countryCode).toBe(pack.country);
        expect(line.snapshot.packVersion).toBe("1.0.0-baseline");
        expect(line.notSubject).toBe(false);

        const sourceKey = generateUuidV7();
        const entryId = await postSale(tenant, [line], sourceKey);
        const lines = await linesOf(entryId);
        const gross = (Number(line.taxBase) + Number(line.taxAmount)).toFixed(4);
        expect(lines).toEqual([
          { accountId: tenant.accountIds.arControl, direction: "DEBIT", amount: gross, partnerId: tenant.partnerIds.customer, taxCodeId: null },
          { accountId: tenant.accountIds.salesRevenue, direction: "CREDIT", amount: line.taxBase, partnerId: null, taxCodeId: null },
          { accountId: tenant.accountIds.vatPayable, direction: "CREDIT", amount: line.taxAmount, partnerId: null, taxCodeId: tenant.taxCodeIds.standard },
        ]);
        // The INV-012 substrate row (OUTPUT summary group).
        const suClient = await (await import("./fixtures")).su();
        const summaries = await suClient.query(
          `SELECT direction, treatment, rate::text AS rate, taxable_base::text AS base,
                  tax_amount::text AS tax FROM tax_document_summaries
           WHERE tenant_id = $1 AND source_id = $2`,
          [tenant.tenantId, sourceKey],
        );
        await suClient.end();
        expect(summaries.rows).toEqual([
          {
            direction: "OUTPUT",
            treatment: "STANDARD_RATED",
            rate: currentRate,
            base: line.taxBase,
            tax: line.taxAmount,
          },
        ]);
      });

      it("zero-rated sale: 0% in the correct box — never exempt, no VAT line", async () => {
        const tenant = await tenantOf();
        const { taxResolver } = await import("./fixtures");
        const line = await withTenant(tenant.tenantId, () =>
          taxResolver.resolveOne({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            line: { amount: "80.0000", taxCodeId: tenant.taxCodeIds.zero, currencyCode: tenant.currencyCode },
          }),
        );
        expect(line.treatment).toBe("ZERO_RATED");
        expect(line.taxAmount).toBe("0.0000");
        expect(line.notSubject).toBe(false);
        const sourceKey = generateUuidV7();
        const entryId = await postSale(tenant, [line], sourceKey);
        const lines = await linesOf(entryId);
        // gross = net (no VAT leg — zero-rated carries no VAT line).
        expect(lines).toHaveLength(2);
        const suClient = await (await import("./fixtures")).su();
        const summaries = await suClient.query(
          `SELECT treatment, tax_amount::text AS tax FROM tax_document_summaries
           WHERE tenant_id = $1 AND source_id = $2`,
          [tenant.tenantId, sourceKey],
        );
        await suClient.end();
        expect(summaries.rows).toEqual([{ treatment: "ZERO_RATED", tax: "0.0000" }]);
      });

      it("exempt supply: its own return box, no input-recovery assumption", async () => {
        const tenant = await tenantOf();
        const { taxResolver } = await import("./fixtures");
        const line = await withTenant(tenant.tenantId, () =>
          taxResolver.resolveOne({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            line: { amount: "60.0000", taxCodeId: tenant.taxCodeIds.exempt, currencyCode: tenant.currencyCode },
          }),
        );
        expect(line.treatment).toBe("EXEMPT");
        expect(line.taxAmount).toBe("0.0000");
        const sourceKey = generateUuidV7();
        const entryId = await postSale(tenant, [line], sourceKey);
        const lines = await linesOf(entryId);
        expect(lines).toHaveLength(2);
        const suClient = await (await import("./fixtures")).su();
        const summaries = await suClient.query(
          `SELECT treatment FROM tax_document_summaries WHERE tenant_id = $1 AND source_id = $2`,
          [tenant.tenantId, sourceKey],
        );
        await suClient.end();
        expect(summaries.rows).toEqual([{ treatment: "EXEMPT" }]);
      });

      it("mixed basket: treatment-grouped summary on one document", async () => {
        const tenant = await tenantOf();
        const { taxResolver } = await import("./fixtures");
        const lines = await withTenant(tenant.tenantId, async () => [
          await taxResolver.resolveOne({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            line: { amount: "100.0000", taxCodeId: tenant.taxCodeIds.standard, currencyCode: tenant.currencyCode },
          }),
          await taxResolver.resolveOne({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            line: { amount: "80.0000", taxCodeId: tenant.taxCodeIds.zero, currencyCode: tenant.currencyCode },
          }),
          await taxResolver.resolveOne({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            line: { amount: "60.0000", taxCodeId: tenant.taxCodeIds.exempt, currencyCode: tenant.currencyCode },
          }),
        ]);
        const { groups } = accumulateSummary("OUTPUT", lines);
        expect(groups.map((group) => group.treatment)).toEqual([
          "STANDARD_RATED",
          "ZERO_RATED",
          "EXEMPT",
        ]);
        const sourceKey = generateUuidV7();
        const entryId = await postSale(tenant, lines, sourceKey);
        const journalLines = await linesOf(entryId);
        // AR gross · SR net Σ · VAT_PAYABLE std tax only (zero/exempt carry none).
        expect(journalLines).toHaveLength(3);
      });

      it("credit note: negative amounts mirror the treatment exactly", async () => {
        const tenant = await tenantOf();
        const positive = await resolveStandard(tenant, "100.0000");
        const negative = await resolveStandard(tenant, "-100.0000");
        expect(negative.taxAmount).toBe(`-${positive.taxAmount.replace("-", "")}`);
        expect(negative.treatment).toBe("STANDARD_RATED");
        expect(negative.gross.startsWith("-")).toBe(true);
      });

      it("rate boundary: snapshots pin the correct rate for the document date", async () => {
        const tenant = await tenantOf();
        if (pack.priorWindow !== undefined) {
          // BH-style history: the day before the increase resolves the prior
          // window; the day after resolves the new one (BR-033 boundary).
          const before = await resolveStandard(
            tenant,
            "100.0000",
            dayBefore(currentFrom),
          );
          expect(before.rate).toBe(pack.priorWindow.rate);
          expect(before.snapshot.effectiveFrom).toBe(pack.priorWindow.from);
          expect(before.snapshot.effectiveTo).toBe(pack.priorWindow.to);
          const after = await resolveStandard(tenant, "100.0000", currentFrom);
          expect(after.rate).toBe(currentRate);
          expect(after.snapshot.effectiveTo).toBe(null);
        } else {
          // Window start without an asserted prior rate (SA et al.): the
          // day before the window fails CLOSED — the compliance files
          // record no rate for that window and the engine never guesses.
          await expect(resolveStandard(tenant, "100.0000", dayBefore(currentFrom))).rejects.toMatchObject(
            { code: "NO_RATE_FOR_DATE" },
          );
          const after = await resolveStandard(tenant, "100.0000", currentFrom);
          expect(after.rate).toBe(currentRate);
        }
      });

      it("unregistered tenant: NOT_SUBJECT, no VAT fields, clean transition", async () => {
        const tenant = await tenantOf();
        const posted = await resolveStandard(tenant, "100.0000");
        // Flip to NOT_REGISTERED: new resolutions are NOT_SUBJECT.
        await withTenant(tenant.tenantId, () =>
          registrations.upsert({
            countryCode: pack.country,
            status: "NOT_REGISTERED",
            registrationNumber: null,
            effectiveFrom: "2020-01-01",
            effectiveTo: null,
            actorId: null,
            note: "transition fixture",
          }),
        );
        const unregistered = await resolveStandard(tenant, "100.0000");
        expect(unregistered.treatment).toBe("NOT_SUBJECT");
        expect(unregistered.notSubject).toBe(true);
        expect(unregistered.taxAmount).toBe("0.0000");
        expect(unregistered.snapshot.effectiveFrom).toBe(null);
        // NOT_SUBJECT documents post with NO VAT line (gross = base).
        const sourceKey = generateUuidV7();
        const entryId = await postSale(tenant, [unregistered], sourceKey);
        const lines = await linesOf(entryId);
        expect(lines).toHaveLength(2);
        const suClient = await (await import("./fixtures")).su();
        const summaries = await suClient.query(
          `SELECT COUNT(*)::int AS n FROM tax_document_summaries WHERE tenant_id = $1 AND source_id = $2`,
          [tenant.tenantId, sourceKey],
        );
        await suClient.end();
        expect(summaries.rows[0].n).toBe(0);
        // Flip back: the transition is clean; the earlier posted snapshot is
        // frozen (BR-033) — its object never changed.
        await withTenant(tenant.tenantId, () =>
          registrations.upsert({
            countryCode: pack.country,
            status: "REGISTERED",
            registrationNumber: "310000000000003",
            effectiveFrom: "2016-01-01",
            effectiveTo: null,
            actorId: null,
            note: "transition fixture back",
          }),
        );
        const again = await resolveStandard(tenant, "100.0000");
        expect(again.taxAmount).toBe(posted.taxAmount);
        expect(JSON.stringify(again.snapshot)).toBe(JSON.stringify(posted.snapshot));
      });

      it("rounding worked example: half-up at the currency's minor units", async () => {
        const { base, expectedTax } = pack.rounding!;
        expect(taxFromNet(base, currentRate, pack.currency)).toBe(expectedTax);
        // Inclusive extraction ties out on the same basket (sa.md §10 class):
        // gross = base + tax extracts the identical tax within the rounding
        // rules — exclusive and inclusive meet in the middle.
        const gross = (Number(base) + Number(expectedTax)).toFixed(pack.minorUnits);
        expect(taxFromGross(gross, currentRate, pack.currency)).toBe(expectedTax);
      });

      it("determinism: byte-identical snapshots + summaries across recomputation", async () => {
        const tenant = await tenantOf();
        const { taxResolver } = await import("./fixtures");
        const once = await withTenant(tenant.tenantId, () =>
          taxResolver.resolve({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            lines: [
              { amount: "100.0000", taxCodeId: tenant.taxCodeIds.standard, currencyCode: tenant.currencyCode },
              { amount: "80.0000", taxCodeId: tenant.taxCodeIds.zero, currencyCode: tenant.currencyCode },
              { amount: "60.0000", taxCodeId: tenant.taxCodeIds.exempt, currencyCode: tenant.currencyCode },
            ],
          }),
        );
        const twice = await withTenant(tenant.tenantId, () =>
          taxResolver.resolve({
            documentDate: DOC_DATE,
            pricingModeOverride: "EXCLUSIVE",
            lines: [
              { amount: "100.0000", taxCodeId: tenant.taxCodeIds.standard, currencyCode: tenant.currencyCode },
              { amount: "80.0000", taxCodeId: tenant.taxCodeIds.zero, currencyCode: tenant.currencyCode },
              { amount: "60.0000", taxCodeId: tenant.taxCodeIds.exempt, currencyCode: tenant.currencyCode },
            ],
          }),
        );
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      });

      it("VAT return prepare: cross-check green → READY (INV-012 per pack)", async () => {
        const tenant = await tenantOf();
        const line = await resolveStandard(tenant, "100.0000");
        const sourceKey = generateUuidV7();
        await postSale(tenant, [line], sourceKey);
        const created = await withTenant(tenant.tenantId, () =>
          vatReturns.createDraft({
            countryCode: pack.country,
            periodStart: "2026-02-01",
            periodEnd: "2026-02-28",
            actorId: null,
          }),
        );
        const prepared = await withTenant(tenant.tenantId, () =>
          vatReturns.prepare(created.id, null),
        );
        expect(prepared.status).toBe("READY");
        expect(prepared.crossCheckOk).toBe(true);
      });
    });
    return;
  }

  // -- NO_VAT / VAT_PLANNED packs ------------------------------------------------
  describe(`golden/pack-${pack.country.toLowerCase()} — ${pack.vatStatus} mode`, () => {
    it("resolves NOT_SUBJECT with no VAT fields, whatever the registration", async () => {
      const tenant = await tenantOf();
      const line = await resolveStandard(tenant, "100.0000");
      expect(line.treatment).toBe("NOT_SUBJECT");
      expect(line.notSubject).toBe(true);
      expect(line.taxAmount).toBe("0.0000");
      expect(line.snapshot.rate).toBe("0.0000");
      expect(line.snapshot.effectiveFrom).toBe(null);
      // The NS tax code resolves identically (same honest record).
      const { taxResolver } = await import("./fixtures");
      const nsLine = await withTenant(tenant.tenantId, () =>
        taxResolver.resolveOne({
          documentDate: DOC_DATE,
          pricingModeOverride: "EXCLUSIVE",
          line: { amount: "100.0000", taxCodeId: tenant.taxCodeIds.notSubject, currencyCode: tenant.currencyCode },
        }),
      );
      expect(nsLine.notSubject).toBe(true);
    });

    it("documents post with NO VAT lines and NO summaries (absence of VAT ≠ absence of obligations)", async () => {
      const tenant = await tenantOf();
      const line = await resolveStandard(tenant, "100.0000");
      const sourceKey = generateUuidV7();
      const entryId = await postSale(tenant, [line], sourceKey);
      const lines = await linesOf(entryId);
      expect(lines).toHaveLength(2);
      const suClient = await (await import("./fixtures")).su();
      const summaries = await suClient.query(
        `SELECT COUNT(*)::int AS n FROM tax_document_summaries WHERE tenant_id = $1 AND source_id = $2`,
        [tenant.tenantId, sourceKey],
      );
      // No VAT postings at all in the GL: the VAT purpose accounts carry
      // zero movements for this tenant.
      const vatMovement = await suClient.query(
        `SELECT COUNT(*)::int AS n FROM journal_lines l
           JOIN account_purposes p ON p.account_id = l.account_id AND p.tenant_id = l.tenant_id
          WHERE l.tenant_id = $1 AND p.purpose_key LIKE 'VAT%' AND p.active_to IS NULL`,
        [tenant.tenantId],
      );
      await suClient.end();
      expect(summaries.rows[0].n).toBe(0);
      expect(vatMovement.rows[0].n).toBe(0);
    });

    it("the pack ships fully: formats + identifiers apply even without VAT", async () => {
      const tenant = await tenantOf();
      const packView = await withTenant(tenant.tenantId, () =>
        (async () => {
          const { packs } = await import("./fixtures");
          return packs.findPack(pack.country);
        })(),
      );
      const descriptor = packView.descriptor as Record<string, unknown>;
      expect(descriptor.date_format).toBe("dd/MM/yyyy");
      expect(descriptor.number_format).toBeDefined();
      expect(descriptor.address_format).toBeDefined();
      expect(descriptor.tax_scheme_label).toBeDefined();
      expect((descriptor.e_invoicing as { status: string }).status).toBe("NONE");
      expect(packView.verificationStatus).toBe("REQUIRES_VERIFICATION");
      expect(packView.vatStatus).toBe(pack.vatStatus);
      // NO rate rows exist to assert — the versions view is empty.
      const versions = await withTenant(tenant.tenantId, () =>
        (async () => {
          const { packs } = await import("./fixtures");
          return packs.versions(pack.country);
        })(),
      );
      expect(versions.windows).toEqual([]);
    });
  });
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Shared: the five tax codes provision (used by spoof + invariants suites). */
export async function assertFiveCodesProvisioned(tenant: PackTenant): Promise<void> {
  const codes = await withTenant(tenant.tenantId, () => taxCodes.list({}));
  expect(codes).toHaveLength(5);
}
