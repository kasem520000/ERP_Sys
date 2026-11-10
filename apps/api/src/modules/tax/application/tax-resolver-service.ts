import { Injectable } from "@nestjs/common";

import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/tax.store";
import {
  resolveDocument,
  type BoundaryWarning,
  type PricingMode,
  type ResolveLineInput,
  type ResolvedLine,
  type ResolutionResult,
  type TaxReadModel,
} from "../domain/resolver";

/**
 * PHASE-009 T3/T7 — the application wrapper around the pure resolver: loads
 * the tenant's codes, registrations (with the PHASE-004 legacy-settings
 * dual-read window), pack data, and the inclusive/exclusive pricing policy
 * (tenant setting `tax.pricing_inclusive_default`, default false), then
 * delegates to the side-effect-free domain function. Determinism holds end
 * to end: identical inputs produce byte-identical outputs.
 */
@Injectable()
export class TaxResolverService {
  /** The pure resolver's read port, wired to this tenant's scope. */
  private model(): TaxReadModel {
    return {
      findJurisdiction: async (countryCode) => {
        const row = await store.findJurisdictionByCountry(countryCode);
        return row === undefined
          ? undefined
          : {
              countryCode: row.countryCode,
              vatStatus: row.vatStatus,
              packVersion: row.packVersion,
              verificationStatus: row.verificationStatus,
            };
      },
      findRateAt: async (countryCode, treatment, date) => {
        const row = await store.findRateAt(countryCode, treatment, date);
        return row === undefined
          ? undefined
          : {
              treatment: row.treatment as "STANDARD_RATED",
              rate: row.rate,
              effectiveFrom: row.effectiveFrom,
              effectiveTo: row.effectiveTo,
            };
      },
      findNextRateBoundary: async (countryCode, treatment, date) => {
        const row = await store.findNextRateBoundary(countryCode, treatment, date);
        return row === undefined
          ? undefined
          : {
              treatment: row.treatment as "STANDARD_RATED",
              rate: row.rate,
              effectiveFrom: row.effectiveFrom,
              effectiveTo: row.effectiveTo,
            };
      },
      findTaxCode: async (taxCodeId) => {
        const row = await store.findTaxCodeById(taxCodeId);
        return row === undefined
          ? undefined
          : {
              id: row.id,
              code: row.code,
              countryCode: row.countryCode,
              defaultTreatment: row.defaultTreatment as "STANDARD_RATED",
              status: row.status,
            };
      },
      findRegistrationAt: async (countryCode, date) => {
        const row = await store.findTaxRegistrationByCountry(countryCode);
        if (row === undefined) return undefined;
        if (date < row.effectiveFrom) return undefined;
        if (row.effectiveTo !== null && date > row.effectiveTo) return undefined;
        return {
          countryCode: row.countryCode,
          status: row.status,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
        };
      },
    };
  }

  /** The effective pricing mode (tenant default + per-document override). */
  async pricingMode(override?: "EXCLUSIVE" | "INCLUSIVE"): Promise<PricingMode> {
    if (override !== undefined) return override;
    const inclusive = await readEffectiveSetting<boolean>("tax.pricing_inclusive_default");
    return inclusive === true ? "INCLUSIVE" : "EXCLUSIVE";
  }

  /** Deterministic resolution preview for draft documents (§4 API). */
  async resolve(input: {
    documentDate: string;
    pricingModeOverride?: "EXCLUSIVE" | "INCLUSIVE";
    lines: readonly ResolveLineInput[];
  }): Promise<ResolutionResult & { pricingMode: PricingMode }> {
    const pricingMode = await this.pricingMode(input.pricingModeOverride);
    const result = await resolveDocument(
      { documentDate: input.documentDate, pricingMode, lines: input.lines },
      this.model(),
    );
    return { ...result, pricingMode };
  }

  /** Single-line resolution (the expense G-11 wiring consumes this). */
  async resolveOne(input: {
    documentDate: string;
    pricingModeOverride?: "EXCLUSIVE" | "INCLUSIVE";
    line: ResolveLineInput;
  }): Promise<ResolvedLine> {
    const pricingMode = await this.pricingMode(input.pricingModeOverride);
    const { resolveLine } = await import("../domain/resolver");
    return resolveLine(
      { documentDate: input.documentDate, pricingMode, line: input.line },
      this.model(),
    );
  }

  /** Draft-spanning boundary info (BR-033 open-draft warning). */
  async boundaryWarning(input: {
    countryCode: string;
    date: string;
  }): Promise<BoundaryWarning | null> {
    const next = await store.findNextRateBoundary(input.countryCode, "STANDARD_RATED", input.date);
    if (next === undefined) return null;
    return {
      countryCode: input.countryCode,
      treatment: "STANDARD_RATED",
      effectiveFrom: next.effectiveFrom,
      rate: next.rate,
    };
  }
}
