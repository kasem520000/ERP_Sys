import { DomainError } from "@erp/domain-core";

/**
 * PHASE-040 typed error pack — the data-onboarding & migration toolkit
 * (ERROR_MODEL: one typed error per failure mode, AR+EN messages at the
 * edge). HTTP mapping lands in infra/http/error.filter.ts (422 family —
 * validation surfaces; 404/409 for the job lifecycle).
 */

/** A job referenced by id does not exist in this tenant (404). */
export class ImportJobNotFoundError extends DomainError {
  constructor(id: string) {
    super("ONBOARDING_IMPORT_JOB_NOT_FOUND", `import job ${id} does not exist`);
  }
}

/** Concurrent duplicate commit lost the atomic claim (409). */
export class ImportCommitConflictError extends DomainError {
  constructor(id: string) {
    super("ONBOARDING_IMPORT_COMMIT_CONFLICT", `import job ${id} is already committing`);
  }
}

/** Commit before a successful dry-run preview, or with zero applicable rows (422). */
export class ImportNotPreviewedError extends DomainError {
  constructor(id: string) {
    super("ONBOARDING_IMPORT_NOT_PREVIEWED", `import job ${id} has no previewed rows to commit`);
  }
}

/**
 * BR-066's "clean or EXPLICITLY-ACKNOWLEDGED dry-run": a file with
 * invalid/duplicate rows commits only when the caller acknowledges the
 * issues (the wizard shows the report and passes acknowledged: true —
 * the audit event records it).
 */
export class ImportAcknowledgementRequiredError extends DomainError {
  constructor(id: string, invalid: number, duplicates: number) {
    super(
      "ONBOARDING_IMPORT_ACK_REQUIRED",
      `import job ${id} carries ${invalid} invalid and ${duplicates} duplicate rows — commit requires acknowledged: true (BR-066)`,
      { invalid, duplicates },
    );
  }
}

/** The file failed shape/bounds parsing (422 — the items-engine family). */
export class ImportFileInvalidError extends DomainError {
  constructor(message: string) {
    super("ONBOARDING_IMPORT_FILE_INVALID", message);
  }
}

/** An unknown import kind / mapping / adapter key (422). */
export class ImportKindUnknownError extends DomainError {
  constructor(kind: string) {
    super("ONBOARDING_IMPORT_KIND_UNKNOWN", `unknown import kind ${kind}`);
  }
}

export class ImportMappingNotFoundError extends DomainError {
  constructor(id: string) {
    super("ONBOARDING_IMPORT_MAPPING_NOT_FOUND", `import mapping ${id} does not exist`);
  }
}

export class ImportMappingConflictError extends DomainError {
  constructor(name: string, kind: string) {
    super(
      "ONBOARDING_IMPORT_MAPPING_CONFLICT",
      `a saved mapping named "${name}" already exists for kind ${kind} in this direction`,
    );
  }
}

/** A saved mapping's column map references unknown canonical columns (422). */
export class ImportMappingInvalidError extends DomainError {
  constructor(message: string) {
    super("ONBOARDING_IMPORT_MAPPING_INVALID", message);
  }
}

/** BUDGETS imports require the target budget option (422). */
export class ImportOptionsMissingError extends DomainError {
  constructor(kind: string, option: string) {
    super("ONBOARDING_IMPORT_OPTIONS_MISSING", `kind ${kind} requires the "${option}" option`);
  }
}

/** The referenced budget does not exist / is not DRAFT (422 family). */
export class ImportBudgetInvalidError extends DomainError {
  constructor(message: string) {
    super("ONBOARDING_IMPORT_BUDGET_INVALID", message);
  }
}

/**
 * The commit's re-validation diverged from the preview (data changed
 * underneath — e.g. a referenced account archived between preview and
 * commit). Zero writes happened (BR-066); the caller re-runs the preview.
 */
export class ImportPreviewStaleError extends DomainError {
  constructor(jobId: string, detail: string) {
    super(
      "ONBOARDING_IMPORT_PREVIEW_STALE",
      `import job ${jobId}: the data changed since the preview (${detail}) — zero rows were written; re-run the preview`,
      { detail },
    );
  }
}
