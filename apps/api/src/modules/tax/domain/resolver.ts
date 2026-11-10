import { Decimal } from "@erp/domain-core";

import type { TaxSnapshot } from "@erp/contracts";

import {
  CurrencyMinorUnitsUnknownError,
  NoRateForDateError,
  TaxLineInvalidError,
} from "./tax-errors";

/**
 * PHASE-009 T3 — the tax resolution domain service (TAX_ENGINE §2): a PURE,
 * side-effect-free resolver. Determinism is the contract: identical inputs
 * (date, code, amounts) always produce identical snapshots and summaries —
 * recomputation of a draft matches the original computation byte-for-byte
 * (golden datasets per pack). Every read flows through the `TaxReadModel`
 * port wired to the caller's tenant scope by the application layer.
 *
 * Fail-closed rules (directive §1.12–1.13, RISK-005):
 * - A STANDARD_RATED / REVERSE_CHARGE line at a date no seeded rate row
 *   covers throws NO_RATE_FOR_DATE — the engine NEVER guesses a rate.
 * - Unregistered tenants and NO_VAT / VAT_PLANNED jurisdictions resolve
 *   NOT_SUBJECT (honest absence — absence of VAT ≠ absence of obligations).
 *
 * Rounding (ADR-0009, CURRENCY_AND_PRECISION §3): line tax =
 * round(base × rate, currency minor units, half-up) — the resolver receives
 * the DOCUMENT currency's minor units from the reference table.
 */

// -- read port --------------------------------------------------------------------

export interface TaxCodeRow {
  readonly id: string;
  readonly code: string;
  readonly countryCode: string;
  readonly defaultTreatment: TaxTreatment;
  readonly status: "ACTIVE" | "ARCHIVED";
}

export interface JurisdictionRow {
  readonly countryCode: string;
  readonly vatStatus: "VAT_IN_FORCE" | "VAT_PLANNED" | "NO_VAT";
  readonly packVersion: string;
  readonly verificationStatus: "REQUIRES_VERIFICATION" | "VERIFIED";
}

export interface RateRow {
  readonly treatment: "STANDARD_RATED" | "ZERO_RATED" | "REVERSE_CHARGE";
  readonly rate: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

export interface RegistrationRow {
  readonly countryCode: string;
  readonly status: "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
}

/** The engine's ONLY window to data (mirrors the PostingReadModel pattern). */
export interface TaxReadModel {
  findJurisdiction(countryCode: string): Promise<JurisdictionRow | undefined>;
  /** The rate row covering (treatment, date) in the pack — undefined when none. */
  findRateAt(countryCode: string, treatment: RateRow["treatment"], date: string): Promise<RateRow | undefined>;
  /** The next boundary AFTER date (same treatment) — draft warnings (BR-033). */
  findNextRateBoundary(countryCode: string, treatment: RateRow["treatment"], date: string): Promise<RateRow | undefined>;
  findTaxCode(taxCodeId: string): Promise<TaxCodeRow | undefined>;
  findRegistrationAt(countryCode: string, date: string): Promise<RegistrationRow | undefined>;
}

// -- types -------------------------------------------------------------------------

export type TaxTreatment =
  | "STANDARD_RATED"
  | "ZERO_RATED"
  | "EXEMPT"
  | "OUT_OF_SCOPE"
  | "REVERSE_CHARGE"
  | "NOT_SUBJECT";

export type PricingMode = "EXCLUSIVE" | "INCLUSIVE";

export interface ResolveLineInput {
  /** The document line's money quantum (net for EXCLUSIVE, gross for INCLUSIVE). */
  readonly amount: string;
  readonly taxCodeId: string;
  /** Document currency ISO-4217 — its minor units drive the rounding. */
  readonly currencyCode: string;
}

export interface ResolvedLine {
  readonly taxCodeId: string;
  readonly code: string;
  readonly treatment: TaxTreatment;
  readonly rate: string;
  readonly taxBase: string;
  readonly taxAmount: string;
  readonly gross: string;
  readonly snapshot: TaxSnapshot;
  /** NOT_SUBJECT resolution — no VAT fields downstream (§2.8). */
  readonly notSubject: boolean;
}

export interface BoundaryWarning {
  readonly countryCode: string;
  readonly treatment: string;
  readonly effectiveFrom: string;
  readonly rate: string;
}

export interface ResolutionResult {
  readonly lines: readonly ResolvedLine[];
  readonly notSubject: boolean;
  readonly boundaryWarning: BoundaryWarning | null;
}

// -- pure helpers --------------------------------------------------------------------

/** canonical money at the currency's minor units, half-up (ADR-0009). */
function minorUnits(value: Decimal, places: number): string {
  return value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

/** canonical 4-dp journal money (identical half-up semantics to the engine). */
function money4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

const MINOR_UNITS: Readonly<Record<string, number>> = Object.freeze({
  SAR: 2, AED: 2, BHD: 3, KWD: 3, OMR: 3, JOD: 3, IQD: 3,
  QAR: 2, YER: 2, EGP: 2, USD: 2, EUR: 2, GBP: 2,
});

export function minorUnitsOf(currencyCode: string): number {
  const places = MINOR_UNITS[currencyCode];
  if (places === undefined) {
    throw new CurrencyMinorUnitsUnknownError(currencyCode);
  }
  return places;
}

/**
 * Line tax for EXCLUSIVE pricing: round(base × rate%, minor units, half-up).
 * Credit notes pass negative bases — the mirror rounds symmetrically
 * (decimal.js HALF_UP is away-from-zero at the tie, so sign flips mirror).
 */
export function taxFromNet(net: string, ratePercent: string, currencyCode: string): string {
  const places = minorUnitsOf(currencyCode);
  const raw = new Decimal(net).times(new Decimal(ratePercent)).dividedBy(100);
  return minorUnits(raw, places);
}

/**
 * Extraction for INCLUSIVE pricing (phase §2.7): tax extracted from gross
 * within the same rounding rules — tax = round(gross × r/(100+r)), base =
 * gross − tax. The extraction never re-rounds the base (it is the exact
 * subtraction), so inclusive/exclusive on the same basket tie out.
 */
export function taxFromGross(gross: string, ratePercent: string, currencyCode: string): string {
  const places = minorUnitsOf(currencyCode);
  const rate = new Decimal(ratePercent);
  const raw = new Decimal(gross).times(rate).dividedBy(rate.plus(100));
  return minorUnits(raw, places);
}

/** canonical 4-dp normalization for contracts/journal composition. */
export function toMoney4(amount: string): string {
  return money4(new Decimal(amount));
}

// -- the resolver ---------------------------------------------------------------------

function engineSnapshot(
  treatment: TaxTreatment,
  countryCode: string,
  packVersion: string,
  verificationStatus: JurisdictionRow["verificationStatus"],
  taxCodeId: string,
): TaxSnapshot {
  return {
    treatment,
    rate: "0.0000",
    countryCode,
    packVersion,
    effectiveFrom: null,
    effectiveTo: null,
    verificationStatus,
    taxCodeId,
  };
}

/**
 * Deterministic, side-effect-free line→tax resolution (TAX_ENGINE §2 order):
 * tax code → treatment → jurisdiction gate → registration gate → rate at
 * document date (fail-closed) → rounding → snapshot. The function is pure:
 * same read-model answers + same inputs → byte-identical outputs.
 */
export async function resolveLine(
  input: {
    readonly documentDate: string;
    readonly pricingMode: PricingMode;
    readonly line: ResolveLineInput;
  },
  model: TaxReadModel,
): Promise<ResolvedLine> {
  const { documentDate, pricingMode, line } = input;
  const code = await model.findTaxCode(line.taxCodeId);
  if (code === undefined) {
    throw new TaxLineInvalidError(`tax code ${line.taxCodeId} does not exist in this tenant`);
  }
  if (code.status === "ARCHIVED") {
    throw new TaxLineInvalidError(`tax code ${code.code} is ARCHIVED and cannot resolve new lines`);
  }
  const jurisdiction = await model.findJurisdiction(code.countryCode);
  if (jurisdiction === undefined) {
    throw new TaxLineInvalidError(`jurisdiction pack ${code.countryCode} is not seeded`);
  }

  const amount = new Decimal(line.amount);
  if (!amount.isFinite() || amount.isZero()) {
    throw new TaxLineInvalidError(`line amount must be a non-zero decimal, got "${line.amount}"`);
  }

  // §2.8 mode gate: NO_VAT / VAT_PLANNED jurisdictions run the whole tenant
  // without VAT fields — treatments record NOT_SUBJECT honestly.
  if (jurisdiction.vatStatus !== "VAT_IN_FORCE") {
    return {
      taxCodeId: code.id,
      code: code.code,
      treatment: "NOT_SUBJECT",
      rate: "0.0000",
      taxBase: toMoney4(line.amount),
      taxAmount: "0.0000",
      gross: toMoney4(line.amount),
      snapshot: engineSnapshot("NOT_SUBJECT", code.countryCode, jurisdiction.packVersion, jurisdiction.verificationStatus, code.id),
      notSubject: true,
    };
  }

  // §2.8 registration gate: not registered at the document date → NOT_SUBJECT
  // (documents show no VAT; the later registration transition is clean).
  const registration = await model.findRegistrationAt(code.countryCode, documentDate);
  if (registration === undefined || registration.status !== "REGISTERED") {
    return {
      taxCodeId: code.id,
      code: code.code,
      treatment: "NOT_SUBJECT",
      rate: "0.0000",
      taxBase: toMoney4(line.amount),
      taxAmount: "0.0000",
      gross: toMoney4(line.amount),
      snapshot: engineSnapshot("NOT_SUBJECT", code.countryCode, jurisdiction.packVersion, jurisdiction.verificationStatus, code.id),
      notSubject: true,
    };
  }

  // Engine-semantic treatments: no pack row, no tax (TAX_ENGINE §1 — a
  // zero-rated supply is taxable at 0%; exempt is outside scope by law;
  // out-of-scope is not a supply; each keeps its distinct return box).
  if (code.defaultTreatment === "ZERO_RATED" || code.defaultTreatment === "EXEMPT" || code.defaultTreatment === "OUT_OF_SCOPE") {
    return {
      taxCodeId: code.id,
      code: code.code,
      treatment: code.defaultTreatment,
      rate: "0.0000",
      taxBase: toMoney4(line.amount),
      taxAmount: "0.0000",
      gross: toMoney4(line.amount),
      snapshot: engineSnapshot(code.defaultTreatment, code.countryCode, jurisdiction.packVersion, jurisdiction.verificationStatus, code.id),
      notSubject: false,
    };
  }

  if (code.defaultTreatment === "NOT_SUBJECT") {
    return {
      taxCodeId: code.id,
      code: code.code,
      treatment: "NOT_SUBJECT",
      rate: "0.0000",
      taxBase: toMoney4(line.amount),
      taxAmount: "0.0000",
      gross: toMoney4(line.amount),
      snapshot: engineSnapshot("NOT_SUBJECT", code.countryCode, jurisdiction.packVersion, jurisdiction.verificationStatus, code.id),
      notSubject: true,
    };
  }

  // Pack-rate treatments: STANDARD_RATED reads its own window; REVERSE_CHARGE
  // self-accounts at the STANDARD rate (baseline-research behavior recorded in
  // the pack notes — sa.md §3 "scope not asserted"; no RC rate row invented).
  const rateRow = await model.findRateAt(code.countryCode, "STANDARD_RATED", documentDate);
  if (rateRow === undefined) {
    // Fail-closed: the compliance files record no rate for that window.
    throw new NoRateForDateError({
      countryCode: code.countryCode,
      treatment: code.defaultTreatment,
      documentDate,
    });
  }

  const rate = new Decimal(rateRow.rate).toFixed(4);
  const places = minorUnitsOf(line.currencyCode);
  let taxAmount: string;
  let taxBase: string;
  let gross: string;
  if (pricingMode === "INCLUSIVE") {
    const grossDecimal = new Decimal(line.amount);
    const tax = new Decimal(taxFromGross(line.amount, rateRow.rate, line.currencyCode));
    taxAmount = tax.toFixed(places);
    taxBase = grossDecimal.minus(tax).toFixed(places);
    gross = grossDecimal.toFixed(places);
  } else {
    const base = new Decimal(line.amount);
    const tax = new Decimal(taxFromNet(line.amount, rateRow.rate, line.currencyCode));
    taxAmount = tax.toFixed(places);
    taxBase = base.toFixed(places);
    gross = base.plus(tax).toFixed(places);
  }
  return {
    taxCodeId: code.id,
    code: code.code,
    treatment: code.defaultTreatment,
    rate,
    taxBase: toMoney4(taxBase),
    taxAmount: toMoney4(taxAmount),
    gross: toMoney4(gross),
    snapshot: {
      treatment: code.defaultTreatment,
      rate,
      countryCode: code.countryCode,
      packVersion: jurisdiction.packVersion,
      effectiveFrom: rateRow.effectiveFrom,
      effectiveTo: rateRow.effectiveTo,
      verificationStatus: jurisdiction.verificationStatus,
      taxCodeId: code.id,
    },
    notSubject: false,
  };
}

/**
 * Resolve a document's lines and surface the draft-spanning boundary
 * warning (BR-033): when a rate boundary lies after the document date, a
 * draft opened across it is warned on open — posted snapshots never move.
 */
export async function resolveDocument(
  input: {
    readonly documentDate: string;
    readonly pricingMode: PricingMode;
    readonly lines: readonly ResolveLineInput[];
  },
  model: TaxReadModel,
): Promise<ResolutionResult> {
  const lines: ResolvedLine[] = [];
  for (const line of input.lines) {
    lines.push(await resolveLine({ documentDate: input.documentDate, pricingMode: input.pricingMode, line }, model));
  }
  let boundaryWarning: BoundaryWarning | null = null;
  if (lines.length > 0) {
    const standard = lines.find((line) => line.treatment === "STANDARD_RATED" || line.treatment === "REVERSE_CHARGE");
    if (standard !== undefined) {
      const next = await model.findNextRateBoundary(standard.snapshot.countryCode, "STANDARD_RATED", input.documentDate);
      if (next !== undefined) {
        boundaryWarning = {
          countryCode: standard.snapshot.countryCode,
          treatment: "STANDARD_RATED",
          effectiveFrom: next.effectiveFrom,
          rate: new Decimal(next.rate).toFixed(4),
        };
      }
    }
  }
  return {
    lines,
    notSubject: lines.every((line) => line.notSubject),
    boundaryWarning,
  };
}
