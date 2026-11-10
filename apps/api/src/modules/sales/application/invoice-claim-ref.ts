import { DomainError } from "@erp/domain-core";

/**
 * PHASE-031 T4 — the healthcare claim-reference light extension (ED-07):
 * policy-gated capture of `sales_invoices.claim_ref` (migration 0042 — the
 * phase's SINGLE schema change; an external insurer claim reference
 * مطالبة تأمينية, never an official document number per ADR-0006).
 *
 * Semantics (the manifest's bold boundary, §2 item 2):
 * - a `claimRef`-carrying invoice is a CLAIM (insured) invoice billed to the
 *   insurance-company partner;
 * - a null one is SELF-PAY (دفع مباشر) billed to the patient partner;
 * - "insurance billing selected" is the request-scoped `insured` payer
 *   selection — the UI's payer picker; the DURABLE marker is claim_ref
 *   itself (no partner classification enum exists or is added).
 *
 * Enforcement is POLICY-DRIVEN through the existing settings-surface
 * resolution (§2 item 3): with `sales.claim_ref_required_for_insured`
 * resolved true (the platform default; the industry.healthcare manifest
 * ships the same true as its L1 default; L5 may relax), an insured invoice
 * cannot save without its claim ref — the typed CLAIM_REF_REQUIRED error,
 * bilingual, zero residue (the create path validates BEFORE the insert).
 * Self-pay invoices save the field null. Toggling the policy changes only
 * the capture behavior, never posting (INV-022 — claim_ref is metadata
 * that never enters a journal line; the negative ledger proof asserts it).
 */

/** The claim-ref varchar(64) bound (migration 0042). */
export const CLAIM_REF_MAX_LENGTH = 64;

/** An insured invoice cannot save without its external claim reference. */
export class ClaimRefRequiredError extends DomainError {
  constructor(details: { policyKey: string } = { policyKey: "sales.claim_ref_required_for_insured" }) {
    super(
      "CLAIM_REF_REQUIRED",
      "an insurance-billed invoice requires its claim reference (مطالبة تأمينية) — " +
        "self-pay invoices save the field null (PHASE-031 healthcare; the capture policy is tenant-configurable)",
      { ...details, bilingual: { ar: "فاتورة التأمين تتطلب رقم المطالبة — فواتير الدفع المباشر تُحفظ بدون مطالبة", en: "an insurance-billed invoice requires its claim reference — self-pay invoices save the field null" } },
    );
  }
}

/** A claim ref rides insured invoices exactly — self-pay saves null. */
export class ClaimRefOnSelfPayError extends DomainError {
  constructor(claimRef: string) {
    super(
      "CLAIM_REF_ON_SELF_PAY",
      `claim reference "${claimRef}" only rides insured (insurance-billed) invoices — a self-pay invoice saves the field null (PHASE-031 healthcare)`,
      { claimRef },
    );
  }
}

/** A claim ref violates the varchar(64)/shape bound. */
export class ClaimRefInvalidError extends DomainError {
  constructor(reason: string) {
    super("CLAIM_REF_INVALID", `invalid claim reference: ${reason} (PHASE-031 healthcare — varchar(64), trimmed, non-blank)`, { reason });
  }
}

/**
 * Normalize + shape-validate a request claim ref: trimmed, non-blank, at
 * most CLAIM_REF_MAX_LENGTH characters. Returns null for absent/blank
 * (self-pay). Throws the typed ClaimRefInvalidError on shape violations.
 */
export function normalizeClaimRef(claimRef: string | null | undefined): string | null {
  if (claimRef === null || claimRef === undefined) {
    return null;
  }
  const trimmed = claimRef.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > CLAIM_REF_MAX_LENGTH) {
    throw new ClaimRefInvalidError(`length ${trimmed.length} exceeds the varchar(64) bound`);
  }
  return trimmed;
}

/**
 * The policy-gated save-path check (pure — the caller resolves the policy):
 * with `required` true, an insurance-selected invoice with an empty claim
 * ref is rejected with the typed CLAIM_REF_REQUIRED error; a claim ref on a
 * self-pay invoice is rejected with the typed CLAIM_REF_ON_SELF_PAY error
 * (the durable marker is claim_ref itself — the two states stay disjoint).
 */
export function assertClaimRefCapture(input: {
  insured: boolean;
  claimRef: string | null;
  required: boolean;
}): void {
  if (input.insured) {
    if (input.claimRef === null && input.required) {
      throw new ClaimRefRequiredError();
    }
    return;
  }
  if (input.claimRef !== null) {
    throw new ClaimRefOnSelfPayError(input.claimRef);
  }
}
