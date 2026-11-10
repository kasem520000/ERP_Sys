import { DomainError } from "@erp/domain-core";

/**
 * PHASE-026 fixed_assets module domain errors. Codes are stable API
 * contracts (ERROR_MODEL §4) — the HTTP layer maps each to its status;
 * A7-sensitive not-founds render identically for unknown-vs-foreign ids
 * (no existence disclosure: every lookup is tenant-scoped by RLS, so a
 * foreign id is indistinguishable from an unknown one). Money travels as
 * canonical decimal strings (ADR-0009); no Math.* anywhere (ADR-0009).
 */

// -- asset categories (T2 — BR-041) -------------------------------------------------

export class AssetCategoryNotFoundError extends DomainError {
  constructor(id: string) {
    super("ASSET_CATEGORY_NOT_FOUND", `asset category ${id} does not exist in this tenant`);
  }
}

export class AssetCategoryCodeConflictError extends DomainError {
  constructor(details: { code: string; existingId: string }) {
    super(
      "ASSET_CATEGORY_CODE_CONFLICT",
      `asset category code ${details.code} is already used in this tenant (category ${details.existingId}) — codes are tenant-scoped natural keys (ADR-0006)`,
      details,
    );
  }
}

/**
 * BR-041: a category is unusable until all three posting purposes resolve
 * to ACTIVE accounts. The message names the missing purpose keys and is
 * bilingual (EN message + AR detail) so the block reason renders in both
 * locales without a catalog lookup.
 */
export class CategoryNotUsableError extends DomainError {
  constructor(details: { code: string; missingPurposeKeys: readonly string[] }) {
    super(
      "CATEGORY_NOT_USABLE",
      `asset category ${details.code} is unusable (BR-041): purpose(s) ${details.missingPurposeKeys.join(
        ", ",
      )} have no active account mapping — map every purpose to an active account before registering or posting assets / فئة الأصول ${details.code} غير قابلة للاستخدام: الأغراض ${details.missingPurposeKeys.join(
        ", ",
      )} غير مربوطة بحسابات نشطة — اربط كل الأغراض بحسابات نشطة قبل تسجيل الأصول أو ترحيلها`,
      { code: details.code, missingPurposeKeys: [...details.missingPurposeKeys] },
    );
  }
}

// -- asset register (T3) -------------------------------------------------------------

export class AssetNotFoundError extends DomainError {
  constructor(id: string) {
    super("ASSET_NOT_FOUND", `asset ${id} does not exist in this tenant`);
  }
}

export class AssetCodeConflictError extends DomainError {
  constructor(details: { code: string; existingId: string }) {
    super(
      "ASSET_CODE_CONFLICT",
      `asset code ${details.code} is already used in this tenant (asset ${details.existingId}) — codes are tenant-scoped natural keys (ADR-0006)`,
      details,
    );
  }
}

/** Register input validation (INVALID_AMOUNT failure-pack class): negative
 * cost, salvage > cost, life outside 1..1200, UoP without
 * total_estimated_units, malformed decimal strings. */
export class InvalidAssetInputError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INVALID_AMOUNT", message, details);
  }
}

/** Illegal asset-status transitions (asset_status §9 machine). */
export class AssetStatusError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ASSET_STATUS_INVALID", message, details);
  }
}

// -- foreign-key bindings (A7: foreign id === unknown id, typed 404) -----------------

export class BranchNotFoundError extends DomainError {
  constructor(id: string) {
    super("BRANCH_NOT_FOUND", `branch ${id} does not exist in this tenant`);
  }
}

export class UserNotFoundError extends DomainError {
  constructor(id: string) {
    super("USER_NOT_FOUND", `user ${id} does not exist in this tenant`);
  }
}

export class PartnerNotFoundError extends DomainError {
  constructor(id: string) {
    super("PARTNER_NOT_FOUND", `partner ${id} does not exist in this tenant`);
  }
}

// -- capitalization (T4/T5 — G-21) ---------------------------------------------------

/** Funding-shape failures: unknown funding kind, non-supplier/inactive
 * partner on credit funding, zero-cost capitalization, non-POSTED source
 * invoice on the purchasing path. */
export class CapitalizationError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CAPITALIZATION_INVALID", message, details);
  }
}

/** The asset already carries a capitalization source (one G-21 per asset,
 * INV-013 source-scoped; corrections are engine reversal + a new asset). */
export class AlreadyCapitalizedError extends DomainError {
  constructor(details: { assetId: string; sourceType: string; sourceId: string | null }) {
    super(
      "ALREADY_CAPITALIZED",
      `asset ${details.assetId} is already capitalized via ${details.sourceType} ${details.sourceId ?? ""} — one capitalization journal per asset (INV-013); correction is an engine reversal`,
      details,
    );
  }
}
