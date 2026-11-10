import { z } from "zod";

import { registerContractSchema } from "../registry";
import { ISO_DATE_PATTERN, moneyAmountSchema, percentageSchema } from "../wire";

/**
 * PHASE-009 tax contracts (phase §2.6): the `tax_snapshot` JSONB shape and
 * the document tax-summary shape — PUBLISHED, FROZEN contracts. Consuming
 * document tables (sales_invoice_lines etc., PHASE-011/012) adopt these
 * columns then; this phase tests them at the service level. Posted
 * documents reuse their stored snapshots forever (BR-033).
 *
 * Determinism contract: identical inputs (date, code, amounts) produce
 * byte-identical snapshots and summaries (TAX_ENGINE §2 — golden datasets
 * per pack); the shapes below are ordered-object shapes (no maps), so
 * JSON.stringify stability is part of the contract.
 */

export const TAX_TREATMENT_KEYS = [
  "STANDARD_RATED",
  "ZERO_RATED",
  "EXEMPT",
  "OUT_OF_SCOPE",
  "REVERSE_CHARGE",
  "NOT_SUBJECT",
] as const;

export const taxTreatmentSchema = z.enum(TAX_TREATMENT_KEYS);

export const TAX_REGISTRATION_STATUSES = ["REGISTERED", "NOT_REGISTERED", "DEREGISTERED"] as const;
export const taxRegistrationStatusSchema = z.enum(TAX_REGISTRATION_STATUSES);

export const VAT_STATUSES = ["VAT_IN_FORCE", "VAT_PLANNED", "NO_VAT"] as const;
export const vatStatusSchema = z.enum(VAT_STATUSES);

/** Verification provenance (compliance-matrix protocol — RISK-005). */
export const TAX_VERIFICATION_STATUSES = ["REQUIRES_VERIFICATION", "VERIFIED"] as const;
export const taxVerificationStatusSchema = z.enum(TAX_VERIFICATION_STATUSES);

/**
 * The rate snapshot stamped on a document line at posting (TAX_ENGINE §1):
 * treatment + rate + jurisdiction + pack version + effective window +
 * verification status. Frozen forever once stamped (BR-033 — a pack
 * upgrade never rewrites it; only drafts spanning a boundary are warned).
 */
export const taxSnapshotSchema = z
  .object({
    treatment: taxTreatmentSchema,
    rate: percentageSchema,
    countryCode: z.string().length(2),
    packVersion: z.string().min(1).max(40),
    /** Pack window for rate-carried treatments; null for engine-semantic
     * treatments (ZERO_RATED is definitionally 0%; EXEMPT/OUT_OF_SCOPE/
     * NOT_SUBJECT compute no tax — TAX_ENGINE §1). */
    effectiveFrom: z.string().regex(ISO_DATE_PATTERN).nullable(),
    effectiveTo: z.string().regex(ISO_DATE_PATTERN).nullable(),
    verificationStatus: taxVerificationStatusSchema,
    taxCodeId: z.string().uuid().nullable(),
  })
  .strict();
export type TaxSnapshot = z.infer<typeof taxSnapshotSchema>;

/** One accumulated summary group: (treatment, rate, tax code) → base + tax. */
export const taxSummaryGroupSchema = z
  .object({
    direction: z.enum(["OUTPUT", "INPUT"]),
    treatment: taxTreatmentSchema,
    rate: percentageSchema,
    taxCodeId: z.string().uuid().nullable(),
    taxableBase: moneyAmountSchema,
    taxAmount: moneyAmountSchema,
    snapshot: taxSnapshotSchema,
  })
  .strict();
export type TaxSummaryGroup = z.infer<typeof taxSummaryGroupSchema>;

/**
 * The document tax summary (OUTPUT then INPUT order, deterministic):
 * recomputation of a draft matches the original computation byte-for-byte.
 */
export const documentTaxSummarySchema = z.object({
  groups: z.array(taxSummaryGroupSchema),
  totalTax: moneyAmountSchema,
});
export type DocumentTaxSummary = z.infer<typeof documentTaxSummarySchema>;

/** Pricing mode (phase §2.7): tenant default + per-document override. */
export const taxPricingModeSchema = z.enum(["EXCLUSIVE", "INCLUSIVE"]);

/**
 * Resolved line (the /resolve-lines preview + the stamped line contract):
 * the net (taxable base), the tax, and the snapshot. For inclusive pricing
 * the base is the extracted net (tax extracted from gross within the same
 * rounding rules).
 */
export const resolvedTaxLineSchema = z
  .object({
    taxCodeId: z.string().uuid(),
    treatment: taxTreatmentSchema,
    rate: percentageSchema,
    taxBase: moneyAmountSchema,
    taxAmount: moneyAmountSchema,
    gross: moneyAmountSchema,
    snapshot: taxSnapshotSchema,
    /** True when NOT_SUBJECT resolved — no VAT fields downstream (§2.8). */
    notSubject: z.boolean(),
  })
  .strict();
export type ResolvedTaxLine = z.infer<typeof resolvedTaxLineSchema>;

/** Register under stable contract keys (ADR-0002 registry). */
registerContractSchema("tax.snapshot.v1", taxSnapshotSchema);
registerContractSchema("tax.summary-group.v1", taxSummaryGroupSchema);
registerContractSchema("tax.document-summary.v1", documentTaxSummarySchema);
registerContractSchema("tax.resolved-line.v1", resolvedTaxLineSchema);
registerContractSchema("tax.pricing-mode.v1", taxPricingModeSchema);

/** VAT return statuses (tax.returns.* — the platform reports, humans file). */
export const VAT_RETURN_STATUSES = ["DRAFT", "READY", "FILED"] as const;
export const vatReturnStatusSchema = z.enum(VAT_RETURN_STATUSES);
