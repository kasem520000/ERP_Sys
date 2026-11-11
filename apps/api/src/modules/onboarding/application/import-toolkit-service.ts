import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { FilesService } from "../../files/api/files";
import { getBoss, JobsService, type JobPayloadBase } from "../../../infra/jobs/boss";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { CoaService } from "../../accounting/application/coa-service";
import { OpeningBalancesService } from "../../partners/application/opening-balances-service";
import { AssetService } from "../../fixed_assets/application/asset-service";
import { EmployeeService } from "../../payroll/application/employee-service";
import { PriceListService } from "../../items/application/price-list-service";
import { ContractService } from "../../crm/application/contract-service";
import { ImportService as BudgetGridImportService } from "../../budgeting/application/import-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import * as partnersStore from "../../partners/infrastructure/partners.store";
import * as fixedAssetsStore from "../../fixed_assets/infrastructure/fixed-assets.store";
import * as payrollStore from "../../payroll/infrastructure/payroll.store";
import * as itemsStore from "../../items/infrastructure/items.store";
import * as tenancyStore from "../../tenancy/infrastructure/tenancy.store";
import * as budgetingStore from "../../budgeting/infrastructure/budgeting.store";
import * as crmStore from "../../crm/infrastructure/crm.store";
import {
  ImportAcknowledgementRequiredError,
  ImportBudgetInvalidError,
  ImportCommitConflictError,
  ImportFileInvalidError,
  ImportJobNotFoundError,
  ImportKindUnknownError,
  ImportNotPreviewedError,
  ImportOptionsMissingError,
  ImportPreviewStaleError,
} from "../domain/onboarding-errors";
import {
  autoDetectMapping,
  isImportKind,
  KIND_SPECS,
  normalizeAccountType,
  normalizeContractType,
  normalizeFeeModel,
  parseBool,
  type ImportKind,
  type RowIssue,
} from "./kinds";
import { openSheet } from "./sheet-reader";
import * as store from "../infrastructure/onboarding.store";
import * as jobStore from "../../items/infrastructure/items.store";

/**
 * PHASE-040 generalized import engine (§2.1–§2.4): dry-run → commit for the
 * SEVEN new kinds, generalizing the PHASE-006 preview-gate and the PHASE-028
 * XLSX discipline into the platform's standard import path.
 *
 * BR-066 (BUSINESS_RULES): an import commits only after a clean or
 * EXPLICITLY-ACKNOWLEDGED dry-run, atomically — no partial commits, no
 * mid-run residue. Mechanically:
 *
 * - `createJob` runs the synchronous DRY-RUN: parse + validate + resolve
 *   references + duplicate-classify every row. No tenant business data is
 *   written (the zero-write proof is the DB suite's before/after count
 *   assertion around the dry-run call).
 * - `commit` (a) refuses when the report carries invalid/duplicate rows
 *   without `acknowledged: true`, (b) atomically claims PREVIEW_READY →
 *   COMMITTING (concurrent losers get the typed conflict), (c) enqueues the
 *   bounded pg-boss job (payload = ids only, ADR-0008).
 * - `runCommit` re-parses + re-validates + applies INSIDE ONE `withTenant`
 *   UoW: if re-validation diverges from the preview (data moved underneath),
 *   the whole transaction rolls back — zero rows — and the job returns to
 *   PREVIEW_READY with the failure recorded (a re-commit re-validates from
 *   scratch and converges; acceptance 6). Any mid-run throw rolls back
 *   everything the same way. Only a fully-applied file flips the job to
 *   COMMITTED.
 *
 * Bounded memory (OA-06): rows stream one at a time through the reader; the
 * retained validation outcome is bounded by the 100k-row cap (the applicable
 * rows must be materialized for the atomic apply — the documented
 * compromise), and the stored report keeps the summary + the first 200
 * issues; the full bilingual error pack is exportable as a CSV artifact
 * (`errorReportUrl`).
 */

const ONBOARDING_IMPORT_QUEUE = "onboarding-import-commit";

/** The stored-report issue sample cap (bounded memory; export for the rest). */
const MAX_REPORT_ISSUES = 200;

interface OnboardingImportJobPayload extends JobPayloadBase {
  readonly jobId: string;
}

export interface ToolkitReport {
  readonly kind: string;
  readonly headers: readonly string[];
  readonly mapping: Record<string, string>;
  readonly unmappedColumns: readonly string[];
  readonly summary: {
    readonly total: number;
    readonly valid: number;
    readonly invalid: number;
    readonly duplicates: number;
    readonly warnings: number;
  };
  readonly issues: readonly {
    readonly row: number;
    readonly field: string;
    readonly en: string;
    readonly ar: string;
    readonly duplicate: boolean;
  }[];
}

export interface CreateToolkitJobInput {
  kind: string;
  format: string;
  uploadToken: string;
  fileKey: string;
  fileName: string | null;
  mappingId?: string | null;
  options?: Record<string, unknown> | null;
  /** The wizard's explicit column map (canonical → header text). */
  columnMap?: Record<string, string> | null;
}

interface ValidatedRow {
  readonly rowNo: number;
  readonly values: Record<string, string>;
}

interface ValidationOutcome {
  readonly report: ToolkitReport;
  readonly applicable: number;
  readonly rows: readonly ValidatedRow[];
  /** BUDGETS carries its file through (the grid commits from base64). */
  readonly budgetFileBase64?: string;
  readonly budgetId?: string;
}

@Injectable()
export class ImportToolkitService implements OnModuleInit {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(CoaService) private readonly coa: CoaService,
    @Inject(OpeningBalancesService) private readonly openingDrafts: OpeningBalancesService,
    @Inject(AssetService) private readonly assets: AssetService,
    @Inject(EmployeeService) private readonly employeesSvc: EmployeeService,
    @Inject(PriceListService) private readonly priceLists: PriceListService,
    @Inject(ContractService) private readonly contracts: ContractService,
    @Inject(BudgetGridImportService) private readonly budgetGrid: BudgetGridImportService,
  ) {}

  async onModuleInit(): Promise<void> {
    const boss = getBoss();
    await boss.work<OnboardingImportJobPayload>(ONBOARDING_IMPORT_QUEUE, async (jobs) => {
      for (const job of jobs) {
        await this.runCommit(job.data);
      }
    });
  }

  // -- wizard surface -----------------------------------------------------------

  /** The kind catalog for the wizard (columns, types, formats, options). */
  listKinds(): unknown[] {
    return Object.values(KIND_SPECS).map((spec) => ({
      kind: spec.kind,
      label: spec.label,
      description: spec.description,
      formats: spec.formats,
      requiredOptions: spec.requiredOptions ?? [],
      gridFormat: spec.gridFormat === true,
      columns: spec.columns.map((column) => ({
        name: column.name,
        label: column.label,
        required: column.required,
        type: column.type,
        enumValues: column.enumValues ?? [],
        pii: column.pii === true,
      })),
    }));
  }

  /**
   * Wizard step 1→2 (the FD-18 leverage): parse a file's headers + sample
   * rows and auto-detect the column mapping for an optional kind. Zero
   * writes (read-only).
   */
  async previewHeaders(input: {
    fileKey: string;
    format: string;
    kind?: string;
  }): Promise<unknown> {
    const tenantId = requireTenantContext().tenantId;
    const object = await this.files.readObject(tenantId, input.fileKey);
    const format = input.format === "XLSX" ? "XLSX" : "CSV";
    const sheet = await openSheet(object.body, format);
    const sample: string[][] = [];
    for await (const row of sheet.rows) {
      sample.push([...row.cells]);
      if (sample.length >= 5) break;
    }
    const mapping =
      input.kind !== undefined && isImportKind(input.kind)
        ? autoDetectMapping(sheet.headers, input.kind)
        : {};
    return { headers: sheet.headers, sample, mapping };
  }

  // -- job lifecycle --------------------------------------------------------------

  /** Idempotent per upload-token; runs the synchronous dry-run. */
  async createJob(actorId: string, input: CreateToolkitJobInput): Promise<jobStore.ImportJobRow> {
    if (!isImportKind(input.kind)) {
      throw new ImportKindUnknownError(input.kind);
    }
    const spec = KIND_SPECS[input.kind];
    if (!(spec.formats as readonly string[]).includes(input.format)) {
      throw new ImportFileInvalidError(
        `kind ${input.kind} accepts ${spec.formats.join(" | ")} files only`,
      );
    }
    const options = input.options ?? {};
    for (const option of spec.requiredOptions ?? []) {
      if (typeof options[option] !== "string" || (options[option] as string) === "") {
        throw new ImportOptionsMissingError(input.kind, option);
      }
    }
    const existing = await jobStore.findImportJobByToken(input.uploadToken);
    if (existing !== undefined) {
      return existing;
    }
    let mapping: Record<string, string> | null = null;
    if (input.mappingId !== undefined && input.mappingId !== null) {
      const saved = await store.findImportMappingById(input.mappingId);
      if (saved !== undefined && saved.direction === "IMPORT" && saved.kind === input.kind) {
        mapping = saved.columnMap as Record<string, string>;
      }
    }
    if (input.columnMap !== undefined && input.columnMap !== null) {
      mapping = input.columnMap;
    }
    const job = await jobStore.insertImportJob({
      kind: input.kind,
      format: input.format,
      uploadToken: input.uploadToken,
      fileKey: input.fileKey,
      fileName: input.fileName,
      createdBy: actorId,
    });
    await store.stampImportJobExtras(job.id, {
      mappingId: input.mappingId ?? null,
      options,
    });
    const tenantId = requireTenantContext().tenantId;
    try {
      const outcome = await this.validateFile(tenantId, job, mapping, options);
      const updated = await jobStore.updateImportJob(job.id, {
        status: "PREVIEW_READY",
        totalRows: outcome.report.summary.total,
        validRows: outcome.report.summary.valid,
        invalidRows: outcome.report.summary.invalid,
        duplicateRows: outcome.report.summary.duplicates,
        report: outcome.report as unknown as Record<string, unknown>,
      });
      await this.audit.record({
        action: "onboarding.import_previewed",
        entityType: "import_job",
        entityId: job.id,
        actorId,
        after: {
          kind: input.kind,
          total: outcome.report.summary.total,
          valid: outcome.report.summary.valid,
          invalid: outcome.report.summary.invalid,
          duplicates: outcome.report.summary.duplicates,
        },
      });
      return updated ?? job;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await jobStore.updateImportJob(job.id, { status: "FAILED", error: message });
      throw error;
    }
  }

  async getJob(id: string): Promise<jobStore.ImportJobRow> {
    const job = await jobStore.findImportJobById(id);
    if (job === undefined) {
      throw new ImportJobNotFoundError(id);
    }
    return job;
  }

  async listJobs(
    cursor: string | undefined,
    limit: number,
  ): Promise<{ rows: jobStore.ImportJobRow[]; hasMore: boolean; nextCursor: string | null }> {
    return jobStore.listImportJobs(cursor, limit);
  }

  /** BR-066 gate: clean or explicitly-acknowledged dry-run → atomic claim → enqueue. */
  async commit(actorId: string, id: string, acknowledged: boolean): Promise<jobStore.ImportJobRow> {
    const job = await jobStore.findImportJobById(id);
    if (job === undefined) {
      throw new ImportJobNotFoundError(id);
    }
    if (job.status === "COMMITTED") {
      return job; // idempotent replay
    }
    if (job.status === "COMMITTING") {
      throw new ImportCommitConflictError(id);
    }
    if (job.status !== "PREVIEW_READY" || job.validRows <= 0) {
      throw new ImportNotPreviewedError(id);
    }
    const report = job.report as ToolkitReport | null;
    if (
      report !== null &&
      acknowledged !== true &&
      (report.summary.invalid > 0 || report.summary.duplicates > 0)
    ) {
      throw new ImportAcknowledgementRequiredError(
        id,
        report.summary.invalid,
        report.summary.duplicates,
      );
    }
    const claimed = await jobStore.claimImportJobForCommit(id);
    if (claimed === undefined) {
      throw new ImportCommitConflictError(id);
    }
    const tenantId = requireTenantContext().tenantId;
    await this.jobs.publish(ONBOARDING_IMPORT_QUEUE, {
      tenantId,
      jobId: id,
    });
    await this.audit.record({
      action: "onboarding.import_commit_requested",
      entityType: "import_job",
      entityId: id,
      actorId,
      after: { kind: job.kind, acknowledged },
    });
    return claimed;
  }

  /**
   * The BR-066 worker: re-validate + apply inside ONE tenant UoW. A failure
   * rolls the UoW back (zero partial state); AFTER the rollback the job
   * returns to PREVIEW_READY with the failure recorded — a re-commit
   * re-validates from scratch and converges (acceptance 6).
   */
  async runCommit(payload: OnboardingImportJobPayload): Promise<void> {
    let failure: unknown = null;
    await withTenant(payload.tenantId, async () => {
      const job = await jobStore.findImportJobById(payload.jobId);
      if (job === undefined || job.status !== "COMMITTING") {
        return; // claim already consumed (retry/replay safety)
      }
      const report = job.report as ToolkitReport | null;
      if (report === null) {
        await jobStore.updateImportJob(job.id, {
          status: "FAILED",
          error: "commit reached the worker without a stored preview report",
        });
        return;
      }
      try {
        const extras = await store.findImportJobExtras(job.id);
        const outcome = await this.validateFile(
          payload.tenantId,
          job,
          extras?.mapping ?? null,
          extras?.options ?? {},
        );
        // Stale-preview guard (BR-066): the re-validation must apply at
        // least the previewed applicable rows — rows that were valid and
        // now fail moved the file out from under the acknowledgment.
        if (outcome.applicable < job.validRows) {
          throw new ImportPreviewStaleError(
            job.id,
            `re-validation applies ${outcome.applicable} rows, the preview promised ${job.validRows}`,
          );
        }
        if (outcome.applicable === 0) {
          throw new ImportNotPreviewedError(job.id);
        }
        await this.applyRows(job.kind, outcome, job.createdBy);
        await jobStore.updateImportJob(job.id, {
          status: "COMMITTED",
          committedRows: outcome.applicable,
          report: {
            ...(outcome.report as unknown as Record<string, unknown>),
          },
          committedAt: new Date().toISOString(),
          error: null,
        });
        await this.audit.record({
          action: "onboarding.import_committed",
          entityType: "import_job",
          entityId: job.id,
          actorId: job.createdBy ?? undefined,
          after: { kind: job.kind, rows: outcome.applicable },
        });
      } catch (error) {
        failure = error;
        throw error; // rethrow → the UoW rolls back (zero partial state)
      }
    }).catch((error: unknown) => {
      failure ??= error;
    });
    if (failure !== null) {
      // AFTER the rollback: record the failure and return the job to
      // PREVIEW_READY — the honest BR-066 "re-run converges" state.
      const message = failure instanceof Error ? failure.message : String(failure);
      await withTenant(payload.tenantId, async () => {
        await jobStore.updateImportJob(payload.jobId, {
          status: "PREVIEW_READY",
          error: message,
        });
      }).catch(() => undefined);
    }
  }

  /**
   * The bilingual error-report export: the full issue pack as a CSV artifact
   * (BOM; row,field,en,ar,duplicate) with a signed download URL.
   */
  async errorReportUrl(id: string): Promise<{ url: string }> {
    const tenantId = requireTenantContext().tenantId;
    const job = await jobStore.findImportJobById(id);
    if (job === undefined) {
      throw new ImportJobNotFoundError(id);
    }
    const report = job.report as ToolkitReport | null;
    const rows = [["row", "field", "message_en", "message_ar", "duplicate"]];
    for (const issue of report?.issues ?? []) {
      rows.push([
        String(issue.row),
        issue.field,
        issue.en,
        issue.ar,
        issue.duplicate ? "true" : "false",
      ]);
    }
    const csv = `\uFEFF${rows
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\r\n")}`;
    const key = await this.files.writeArtifact(
      tenantId,
      "import_error_reports",
      `import-${id}.csv`,
      Buffer.from(csv, "utf8"),
    );
    const url = await this.files.issueDownloadUrl(tenantId, key);
    return { url };
  }

  // -- validation pipeline ---------------------------------------------------------

  private async validateFile(
    tenantId: string,
    job: jobStore.ImportJobRow,
    mapping: Record<string, string> | null,
    options: Record<string, unknown>,
  ): Promise<ValidationOutcome> {
    const kind = job.kind as ImportKind;
    if (kind === "BUDGETS") {
      return this.validateBudgetGrid(tenantId, job, options);
    }
    const spec = KIND_SPECS[kind];
    const object = await this.files.readObject(tenantId, job.fileKey);
    const format = job.format === "XLSX" ? ("XLSX" as const) : ("CSV" as const);
    const sheet = await openSheet(object.body, format);

    // Column map resolution: explicit/saved mapping first, auto-detect second.
    const effective =
      mapping !== null && Object.keys(mapping).length > 0
        ? mapping
        : autoDetectMapping(sheet.headers, kind);
    const index: Record<string, number> = {};
    const unmapped: string[] = [];
    const mappedPositions = new Set<number>();
    for (const column of spec.columns) {
      const header = effective[column.name];
      if (header === undefined) continue;
      const position = sheet.headers.findIndex(
        (candidate, i) => candidate === header && !mappedPositions.has(i),
      );
      if (position >= 0) {
        index[column.name] = position;
        mappedPositions.add(position);
      }
    }
    for (let position = 0; position < sheet.headers.length; position += 1) {
      if (!mappedPositions.has(position)) {
        unmapped.push(sheet.headers[position]!);
      }
    }
    for (const column of spec.columns) {
      if (column.required && index[column.name] === undefined) {
        throw new ImportFileInvalidError(
          `missing required column "${column.name}" (${column.label.en}) for a ${kind} import`,
        );
      }
    }

    // COA: a pre-pass collects the file's own account codes so in-file
    // parents validate (the tree applies parents first at commit).
    const inFileCodes = new Set<string>();
    if (kind === "COA") {
      const codeColumn = index["code"];
      if (codeColumn !== undefined) {
        const prepass = await openSheet(object.body, format);
        for await (const row of prepass.rows) {
          const code = (row.cells[codeColumn] ?? "").trim();
          if (code !== "") inFileCodes.add(code);
        }
      }
    }

    const resolver = new ReferenceResolver(inFileCodes);
    const issues: ToolkitReport["issues"][number][] = [];
    const validRows: ValidatedRow[] = [];
    const seenKeys = new Map<string, number>();
    let total = 0;
    let valid = 0;
    let invalid = 0;
    let duplicates = 0;

    for await (const row of sheet.rows) {
      total += 1;
      const values: Record<string, string> = {};
      for (const [canonical, position] of Object.entries(index)) {
        values[canonical] = row.cells[position] ?? "";
      }
      const rowIssues: RowIssue[] = [];
      spec.validateRow(values, rowIssues);
      let duplicateOnly = false;
      const naturalKey = spec.naturalKey.map((field) => values[field] ?? "").join("|");
      if (naturalKey !== "") {
        const inFile = seenKeys.get(naturalKey);
        if (inFile !== undefined) {
          rowIssues.push({
            field: spec.naturalKey[0] ?? "row",
            en: `duplicate of row ${inFile} within the file`,
            ar: `تكرار للصف ${inFile} داخل الملف`,
          });
          duplicateOnly = true;
        } else {
          seenKeys.set(naturalKey, row.rowNo);
        }
      }
      rowIssues.push(...(await resolver.checkReferences(kind, values)));
      if (rowIssues.length === 0) {
        valid += 1;
        validRows.push({ rowNo: row.rowNo, values });
      } else if (duplicateOnly && rowIssues.length === 1) {
        duplicates += 1;
        if (issues.length < MAX_REPORT_ISSUES) {
          issues.push({
            row: row.rowNo,
            field: rowIssues[0]!.field,
            en: rowIssues[0]!.en,
            ar: rowIssues[0]!.ar,
            duplicate: true,
          });
        }
      } else {
        invalid += 1;
        for (const rowIssue of rowIssues) {
          if (issues.length < MAX_REPORT_ISSUES) {
            issues.push({
              row: row.rowNo,
              field: rowIssue.field,
              en: rowIssue.en,
              ar: rowIssue.ar,
              duplicate: false,
            });
          }
        }
      }
    }

    // File-level checks (balanced-by-nature, cycles, list consistency).
    const fileIssues: { en: string; ar: string }[] = [];
    if (spec.validateFile !== undefined) {
      spec.validateFile(validRows, fileIssues);
    }
    const fileInvalid = fileIssues.length > 0;
    if (fileInvalid) {
      invalid += validRows.length; // file-level failures block the whole commit
      valid = 0;
      for (const fileIssue of fileIssues) {
        if (issues.length < MAX_REPORT_ISSUES) {
          issues.push({
            row: 0,
            field: "file",
            en: fileIssue.en,
            ar: fileIssue.ar,
            duplicate: false,
          });
        }
      }
    }

    return {
      report: {
        kind,
        headers: sheet.headers,
        mapping: effective,
        unmappedColumns: unmapped,
        summary: { total, valid, invalid, duplicates, warnings: 0 },
        issues,
      },
      applicable: fileInvalid ? 0 : valid,
      rows: fileInvalid ? [] : validRows,
    };
  }

  /** BUDGETS rides the PHASE-028 budgeting import service (grid contract). */
  private async validateBudgetGrid(
    tenantId: string,
    job: jobStore.ImportJobRow,
    options: Record<string, unknown>,
  ): Promise<ValidationOutcome> {
    const budgetId = typeof options["budgetId"] === "string" ? options["budgetId"] : "";
    if (budgetId === "") {
      throw new ImportOptionsMissingError("BUDGETS", "budgetId");
    }
    const budget = await budgetingStore.findBudgetById(budgetId);
    if (budget === undefined) {
      throw new ImportBudgetInvalidError(`budget ${budgetId} does not exist in this tenant`);
    }
    if (budget.status !== "DRAFT") {
      throw new ImportBudgetInvalidError(
        `budget ${budget.id} is ${budget.status} — grid imports replace DRAFT grids only`,
      );
    }
    const object = await this.files.readObject(tenantId, job.fileKey);
    const fileBase64 = object.body.toString("base64");
    const dry = await this.budgetGrid.dryRun(budgetId, fileBase64);
    const issues = dry.errors.map((rowIssue) => ({
      row: rowIssue.rowNo,
      field: "grid",
      en: rowIssue.messageEn,
      ar: rowIssue.messageAr,
      duplicate: false,
    }));
    return {
      report: {
        kind: "BUDGETS",
        headers: ["Account Code", "Account Name", "Dimension Code", "…periods"],
        mapping: {},
        unmappedColumns: [],
        summary: {
          total: dry.rowCount,
          valid: dry.validRows,
          invalid: dry.errors.length,
          duplicates: 0,
          warnings: 0,
        },
        issues: issues.slice(0, MAX_REPORT_ISSUES),
      },
      applicable: dry.validRows,
      rows: [],
      budgetFileBase64: fileBase64,
      budgetId,
    };
  }

  // -- application (per kind — through the REAL services, never raw inserts) -------

  private async applyRows(
    kind: string,
    outcome: ValidationOutcome,
    createdBy: string | null,
  ): Promise<void> {
    const actorId = createdBy ?? "__import__";
    if (kind === "BUDGETS") {
      if (outcome.budgetFileBase64 === undefined || outcome.budgetId === undefined) {
        throw new ImportBudgetInvalidError("the budget grid was not carried through validation");
      }
      // The budgeting commit re-validates and replaces the DRAFT grid whole
      // (the PHASE-028 atomic path) inside this same UoW.
      await this.budgetGrid.commit(outcome.budgetId, outcome.budgetFileBase64, createdBy);
      return;
    }
    const rows = outcome.rows;
    if (kind === "COA") {
      // Parents before children (validation proved acyclicity + presence —
      // db or in-file; the deferred loop waits for in-file parents).
      const byCode = new Map(rows.map((row) => [row.values["code"] ?? "", row]));
      const applied = new Set<string>();
      const deferred: ValidatedRow[] = [...rows];
      let progress = true;
      while (deferred.length > 0 && progress) {
        progress = false;
        for (let i = deferred.length - 1; i >= 0; i -= 1) {
          const row = deferred[i]!;
          const parentCode = row.values["parent_code"] ?? "";
          const parent =
            parentCode === "" ? undefined : await accountingStore.findAccountByCode(parentCode);
          if (parentCode !== "" && parent === undefined && byCode.has(parentCode) && !applied.has(parentCode)) {
            continue; // the in-file parent applies first
          }
          if (parentCode !== "" && parent === undefined && !byCode.has(parentCode)) {
            throw new ImportPreviewStaleError("apply", `parent account ${parentCode} vanished since validation`);
          }
          await this.coa.create(actorId, {
            code: row.values["code"] ?? "",
            name: row.values["name"] ?? "",
            nameAr: row.values["name_ar"] === "" ? null : (row.values["name_ar"] ?? null),
            type: normalizeAccountType(row.values["type"] ?? "") ?? "ASSET",
            parentId: parent?.id ?? null,
            currencyCode: row.values["currency"] === "" ? null : (row.values["currency"] ?? null),
            isGroup: parseBool(row.values["is_group"] ?? "") === true,
          });
          applied.add(row.values["code"] ?? "");
          deferred.splice(i, 1);
          progress = true;
        }
      }
      if (deferred.length > 0) {
        throw new ImportFileInvalidError(
          `${deferred.length} account rows could not be ordered (unsatisfied parents)`,
        );
      }
      return;
    }
    if (kind === "ACCOUNT_OPENING_BALANCES") {
      for (const row of rows) {
        const accountId = await partnersStore.accountIdByCode(row.values["account_code"] ?? "");
        if (accountId === undefined) {
          throw new ImportPreviewStaleError(
            "apply",
            `account ${row.values["account_code"]} vanished since validation`,
          );
        }
        const debit = row.values["debit"] ?? "0";
        const credit = row.values["credit"] ?? "0";
        const net = (Number(debit) - Number(credit)).toFixed(4);
        if (net === "0.0000") {
          continue; // a zero-net row carries no balance
        }
        try {
          await this.openingDrafts.create(actorId, {
            kind: "ACCOUNT",
            accountId,
            amount: net,
            note: row.values["note"] === "" ? null : (row.values["note"] ?? null),
          });
        } catch (error) {
          // The one-DRAFT-per-target rule (or the currency rule) diverged
          // from validation — surface as a stale preview, zero rows written.
          throw new ImportPreviewStaleError("apply", String((error as Error).message));
        }
      }
      return;
    }
    if (kind === "FIXED_ASSETS") {
      for (const row of rows) {
        const category = await fixedAssetsStore.findAssetCategoryByCode(
          row.values["category_code"] ?? "",
        );
        const branch = await tenancyStore.findBranchByCode(row.values["branch_code"] ?? "");
        if (category === undefined || branch === undefined) {
          throw new ImportPreviewStaleError("apply", "category/branch vanished since validation");
        }
        await this.assets.create({
          code: row.values["code"] ?? "",
          name: row.values["name"] ?? "",
          nameAr: row.values["name_ar"] ?? "",
          categoryId: category.id,
          branchId: branch.id,
          acquisitionDate: row.values["acquisition_date"] ?? "",
          cost: row.values["cost"] ?? "0",
          salvageValue: row.values["salvage_value"] === "" ? undefined : row.values["salvage_value"],
          openingAccumulated:
            row.values["opening_accumulated"] === "" ? undefined : row.values["opening_accumulated"],
          usefulLifeMonths:
            row.values["useful_life_months"] === ""
              ? undefined
              : Number(row.values["useful_life_months"]),
          depreciationMethod:
            row.values["depreciation_method"] === "" ? undefined : row.values["depreciation_method"],
          note: row.values["note"] === "" ? null : (row.values["note"] ?? null),
          actorId,
        });
      }
      return;
    }
    if (kind === "EMPLOYEES") {
      for (const row of rows) {
        const branch =
          row.values["branch_code"] === ""
            ? undefined
            : await tenancyStore.findBranchByCode(row.values["branch_code"] ?? "");
        const costCenter =
          row.values["cost_center_code"] === ""
            ? undefined
            : await budgetingStore.findCostCenterByCode(row.values["cost_center_code"] ?? "");
        const structure =
          row.values["structure_code"] === ""
            ? undefined
            : await payrollStore.findStructureByCode(row.values["structure_code"] ?? "");
        await this.employeesSvc.create({
          code: row.values["code"] ?? "",
          name: row.values["name"] ?? "",
          nameAr: row.values["name_ar"] === "" ? null : (row.values["name_ar"] ?? null),
          nationalId: row.values["national_id"] === "" ? null : (row.values["national_id"] ?? null),
          hireDate: row.values["hire_date"] ?? "",
          contractType: (normalizeContractType(row.values["contract_type"] ?? "") ??
            "FULL_TIME") as Parameters<typeof this.employeesSvc.create>[0]["contractType"],
          basicSalary: row.values["basic_salary"] ?? "0",
          branchId: branch?.id ?? null,
          costCenterId: costCenter?.id ?? null,
          salaryStructureId: structure?.id ?? null,
          bankName: row.values["bank_name"] === "" ? null : (row.values["bank_name"] ?? null),
          bankIban: row.values["bank_iban"] === "" ? null : (row.values["bank_iban"] ?? null),
          bankAccount: row.values["bank_account"] === "" ? null : (row.values["bank_account"] ?? null),
          note: row.values["note"] === "" ? null : (row.values["note"] ?? null),
          actorId,
        });
      }
      return;
    }
    if (kind === "PRICE_LISTS") {
      const createdLists = new Map<string, string>();
      const base = await ownTenantBaseCurrency();
      for (const row of rows) {
        const listCode = row.values["list_code"] ?? "";
        let priceListId = createdLists.get(listCode);
        if (priceListId === undefined) {
          const created = await this.priceLists.create(actorId, {
            name: row.values["list_name"] ?? "",
            nameAr: row.values["list_name_ar"] === "" ? null : (row.values["list_name_ar"] ?? null),
            kind:
              (row.values["kind"] ?? "SALE").trim().toUpperCase() === "PURCHASE"
                ? "PURCHASE"
                : "SALE",
            currencyCode: row.values["currency"] === "" ? base : (row.values["currency"] ?? base),
            validFrom: row.values["valid_from"] === "" ? null : (row.values["valid_from"] ?? null),
            validTo: row.values["valid_to"] === "" ? null : (row.values["valid_to"] ?? null),
          });
          priceListId = created.id;
          createdLists.set(listCode, created.id);
        }
        const item = await itemsStore.findItemBySku(row.values["item_sku"] ?? "");
        if (item === undefined) {
          throw new ImportPreviewStaleError("apply", `item ${row.values["item_sku"]} vanished since validation`);
        }
        const uom =
          row.values["uom_code"] === ""
            ? undefined
            : await itemsStore.findUomByCode(row.values["uom_code"] ?? "");
        await this.priceLists.upsertRow(actorId, priceListId, {
          itemId: item.id,
          uomId: uom?.id ?? item.uomId,
          unitPrice: row.values["unit_price"] ?? "0",
          minQty: row.values["min_qty"] === "" ? "1" : (row.values["min_qty"] ?? "1"),
        });
      }
      return;
    }
    if (kind === "CONTRACTS") {
      for (const row of rows) {
        const partner = await partnersStore.findPartnerByCode(row.values["partner_code"] ?? "");
        if (partner === undefined) {
          throw new ImportPreviewStaleError(
            "apply",
            `partner ${row.values["partner_code"]} vanished since validation`,
          );
        }
        const project =
          row.values["project_code"] === ""
            ? null
            : ((await budgetingStore.findProjectByCode(row.values["project_code"] ?? ""))?.id ??
              null);
        const feeItem =
          row.values["fee_item_sku"] === ""
            ? null
            : ((await itemsStore.findItemBySku(row.values["fee_item_sku"] ?? ""))?.id ?? null);
        await this.contracts.create({
          partnerId: partner.id,
          projectId: project,
          title: row.values["title"] ?? "",
          titleAr: row.values["title_ar"] === "" ? null : (row.values["title_ar"] ?? null),
          scope: null,
          feeModel: (normalizeFeeModel(row.values["fee_model"] ?? "") ??
            "RETAINER") as Parameters<typeof this.contracts.create>[0]["feeModel"],
          startDate: row.values["start_date"] ?? "",
          endDate: row.values["end_date"] ?? "",
          monthlyAmount:
            row.values["monthly_amount"] === "" ? null : (row.values["monthly_amount"] ?? null),
          feeItemId: feeItem,
          milestones: null,
          currencyCode: null,
          note: row.values["note"] === "" ? null : (row.values["note"] ?? null),
          noteAr: null,
          actorId,
        });
      }
      return;
    }
    throw new ImportKindUnknownError(kind);
  }
}

/**
 * Batched, cached natural-key resolution (OA-06: the first lookup per code
 * caches — no per-row reference queries; the dry-run scan and the commit's
 * re-validation share the same resolver shape).
 */
class ReferenceResolver {
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly inFileAccountCodes: ReadonlySet<string>) {}

  private async cached<T>(key: string, load: () => Promise<T | undefined>): Promise<T | undefined> {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T | undefined;
    }
    const value = await load();
    this.cache.set(key, value);
    return value;
  }

  async checkReferences(kind: ImportKind, values: Record<string, string>): Promise<RowIssue[]> {
    const issues: RowIssue[] = [];
    if (kind === "COA") {
      const parentCode = values["parent_code"] ?? "";
      if (parentCode !== "") {
        const parent = await this.cached(`account:${parentCode}`, () =>
          accountingStore.findAccountByCode(parentCode),
        );
        if (parent === undefined) {
          if (!this.inFileAccountCodes.has(parentCode)) {
            issues.push({
              field: "parent_code",
              en: `parent account "${parentCode}" does not exist (in the file or this tenant)`,
              ar: `الحساب الأب «${parentCode}» غير موجود (لا في الملف ولا في المستأجر)`,
            });
          }
        } else {
          const type = normalizeAccountType(values["type"] ?? "");
          if (type !== null && parent.type !== type) {
            issues.push({
              field: "parent_code",
              en: `parent ${parentCode} is ${parent.type} — trees stay homogeneous (V3)`,
              ar: `الحساب الأب ${parentCode} من نوع ${parent.type} — الشجرة متجانسة`,
            });
          }
        }
      }
      return issues;
    }
    if (kind === "ACCOUNT_OPENING_BALANCES") {
      const code = values["account_code"] ?? "";
      const account = await this.cached(`account:${code}`, () => accountingStore.findAccountByCode(code));
      if (account === undefined) {
        issues.push({
          field: "account_code",
          en: `account "${code}" does not exist in this tenant`,
          ar: `الحساب «${code}» غير موجود في هذا المستأجر`,
        });
      } else if (!account.isPostable) {
        issues.push({
          field: "account_code",
          en: `account "${code}" is not postable (group node)`,
          ar: `الحساب «${code}» غير قابل للترحيل (عقدة مجموعة)`,
        });
      } else {
        const existingDoc = await this.cached(`obd:account:${account.id}`, () =>
          partnersStore.findOpeningBalanceDocForAccount(account!.id),
        );
        if (existingDoc !== undefined && existingDoc.status === "DRAFT") {
          issues.push({
            field: "account_code",
            en: `account "${code}" already carries a DRAFT opening balance`,
            ar: `الحساب «${code}» يحمل رصيداً افتتاحياً مسودّة بالفعل`,
          });
        }
      }
      return issues;
    }
    if (kind === "FIXED_ASSETS") {
      const categoryCode = values["category_code"] ?? "";
      const category = await this.cached(`fa-category:${categoryCode}`, () =>
        fixedAssetsStore.findAssetCategoryByCode(categoryCode),
      );
      if (category === undefined) {
        issues.push({
          field: "category_code",
          en: `asset category "${categoryCode}" does not exist`,
          ar: `فئة الأصل «${categoryCode}» غير موجودة`,
        });
      }
      const branchCode = values["branch_code"] ?? "";
      const branch = await this.cached(`branch:${branchCode}`, () =>
        tenancyStore.findBranchByCode(branchCode),
      );
      if (branch === undefined) {
        issues.push({
          field: "branch_code",
          en: `branch "${branchCode}" does not exist`,
          ar: `الفرع «${branchCode}» غير موجود`,
        });
      }
      return issues;
    }
    if (kind === "EMPLOYEES") {
      const branchCode = values["branch_code"] ?? "";
      if (branchCode !== "") {
        const branch = await this.cached(`branch:${branchCode}`, () =>
          tenancyStore.findBranchByCode(branchCode),
        );
        if (branch === undefined) {
          issues.push({
            field: "branch_code",
            en: `branch "${branchCode}" does not exist`,
            ar: `الفرع «${branchCode}» غير موجود`,
          });
        }
      }
      const costCenterCode = values["cost_center_code"] ?? "";
      if (costCenterCode !== "") {
        const costCenter = await this.cached(`cost-center:${costCenterCode}`, () =>
          budgetingStore.findCostCenterByCode(costCenterCode),
        );
        if (costCenter === undefined) {
          issues.push({
            field: "cost_center_code",
            en: `cost center "${costCenterCode}" does not exist`,
            ar: `مركز التكلفة «${costCenterCode}» غير موجود`,
          });
        }
      }
      const structureCode = values["structure_code"] ?? "";
      if (structureCode !== "") {
        const structure = await this.cached(`structure:${structureCode}`, () =>
          payrollStore.findStructureByCode(structureCode),
        );
        if (structure === undefined) {
          issues.push({
            field: "structure_code",
            en: `salary structure "${structureCode}" does not exist`,
            ar: `هيكل الرواتب «${structureCode}» غير موجود`,
          });
        }
      }
      return issues;
    }
    if (kind === "PRICE_LISTS") {
      const itemSku = values["item_sku"] ?? "";
      const item = await this.cached(`item:${itemSku}`, () => itemsStore.findItemBySku(itemSku));
      if (item === undefined) {
        issues.push({
          field: "item_sku",
          en: `item "${itemSku}" does not exist in this tenant`,
          ar: `الصنف «${itemSku}» غير موجود في هذا المستأجر`,
        });
      }
      const uomCode = values["uom_code"] ?? "";
      if (uomCode !== "") {
        const uom = await this.cached(`uom:${uomCode}`, () => itemsStore.findUomByCode(uomCode));
        if (uom === undefined) {
          issues.push({
            field: "uom_code",
            en: `unit of measure "${uomCode}" does not exist`,
            ar: `وحدة القياس «${uomCode}» غير موجودة`,
          });
        }
      }
      const listName = values["list_name"] ?? "";
      if (listName !== "") {
        const existing = await this.cached(`price-list-name:${listName}`, async () => {
          const lists = await itemsStore.listPriceLists(undefined);
          return lists.find((row) => row.name === listName);
        });
        if (existing !== undefined) {
          issues.push({
            field: "list_name",
            en: `a price list named "${listName}" already exists`,
            ar: `توجد قائمة أسعار باسم «${listName}» بالفعل`,
          });
        }
      }
      return issues;
    }
    if (kind === "CONTRACTS") {
      const partnerCode = values["partner_code"] ?? "";
      const partner = await this.cached(`partner:${partnerCode}`, () =>
        partnersStore.findPartnerByCode(partnerCode),
      );
      if (partner === undefined) {
        issues.push({
          field: "partner_code",
          en: `partner "${partnerCode}" does not exist in this tenant`,
          ar: `العميل «${partnerCode}» غير موجود في هذا المستأجر`,
        });
      } else {
        const title = values["title"] ?? "";
        const existing = await this.cached(`contract:${partner.id}:${title}`, async () => {
          const contracts = await crmStore.listContracts({ partnerId: partner!.id, limit: 200 });
          return contracts.find((row) => row.title === title);
        });
        if (existing !== undefined) {
          issues.push({
            field: "title",
            en: `partner ${partnerCode} already carries a contract titled "${title}"`,
            ar: `العميل ${partnerCode} لديه عقد بنفس العنوان «${title}»`,
          });
        }
      }
      const projectCode = values["project_code"] ?? "";
      if (projectCode !== "") {
        const project = await this.cached(`project:${projectCode}`, () =>
          budgetingStore.findProjectByCode(projectCode),
        );
        if (project === undefined) {
          issues.push({
            field: "project_code",
            en: `project "${projectCode}" does not exist`,
            ar: `المشروع «${projectCode}» غير موجود`,
          });
        }
      }
      const feeItemSku = values["fee_item_sku"] ?? "";
      if (feeItemSku !== "") {
        const item = await this.cached(`item:${feeItemSku}`, () =>
          itemsStore.findItemBySku(feeItemSku),
        );
        if (item === undefined) {
          issues.push({
            field: "fee_item_sku",
            en: `fee item "${feeItemSku}" does not exist`,
            ar: `صنف الأجور «${feeItemSku}» غير موجود`,
          });
        }
      }
      return issues;
    }
    return issues;
  }
}
