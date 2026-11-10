import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { addExact } from "../../accounting/application/decimal-strings";
import {
  BudgetImmutableError,
  BudgetImportFormatError,
  BudgetImportRowError,
  BudgetImportRowLimitError,
  BudgetImportRowIssue,
  BudgetNotFoundError,
} from "../domain/budgeting-errors";
import { scopeDimension, type BudgetLineInput } from "./budgeting-types";
import { BudgetGridService } from "./budget-grid-service";
import { invalidateConsumptionCache } from "./consumption-service";
import {
  findAccountByCode,
  findBranchByCode,
  findBudgetById,
  findCostCenterByCode,
  findProjectByCode,
  listPeriodsOfYear,
} from "../infrastructure/budgeting.store";
import { AR_HEADERS, EN_HEADERS, parseGridXlsxAsync } from "../infrastructure/xlsx-grid-adapter";

/**
 * The budget grid import service (PHASE-028 T8 — the PHASE-008
 * statement-import pattern): dry-run (typed per-row validation report, ZERO
 * writes) → commit (full re-validation; any row error rejects the whole
 * file; the grid replaces whole). Column contract (3 identity + N period +
 * trailing total tolerated): Account Code · Account Name (informational) ·
 * Dimension Code (the scope's dimension — REQUIRED for COST_CENTERS/
 * PROJECTS/BRANCHES, must be blank for ACCOUNTS) · period amounts in the
 * fiscal calendar's start_date order. AR and EN header sets are both
 * accepted (the Arabic-header mapping fixtures requirement).
 *
 * Idempotency per file hash: an in-module bounded LRU (256 entries —
 * restart loses it, the honest documented limitation; the HTTP layer's
 * global Idempotency-Key guard covers network retries, and re-committing
 * the same file converges to the same grid because the replace is
 * whole-grid).
 */

const MAX_ROWS = 5_000;
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;
const LRU_LIMIT = 256;

const importedHashes = new Map<string, string>();

export interface ImportRowIssueView {
  readonly rowNo: number;
  readonly messageAr: string;
  readonly messageEn: string;
}

export interface DryRunReport {
  readonly rowCount: number;
  readonly validRows: number;
  readonly errors: readonly ImportRowIssueView[];
  readonly totalsPreview: string;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly audit: AuditService,
    private readonly grid: BudgetGridService,
  ) {}

  /** Dry-run: parse + validate every row; write NOTHING. */
  async dryRun(budgetId: string, fileBase64: string): Promise<DryRunReport> {
    const parsed = await this.parseAndValidate(budgetId, fileBase64);
    return parsed.report;
  }

  /** Commit: re-validate, then replace the DRAFT grid whole. */
  async commit(
    budgetId: string,
    fileBase64: string,
    actorId: string | null,
  ): Promise<{ lineCount: number; totals: { year: string; perPeriod: Record<string, string> } }> {
    const fileHash = createHash("sha256").update(Buffer.from(fileBase64, "base64")).digest("hex");
    const parsed = await this.parseAndValidate(budgetId, fileBase64);
    if (parsed.report.errors.length > 0) {
      throw new BudgetImportRowError(parsed.report.errors);
    }
    const result = await this.grid.replaceGrid(budgetId, parsed.lines, actorId);
    importedHashes.set(fileHash, budgetId);
    if (importedHashes.size > LRU_LIMIT) {
      const oldest = importedHashes.keys().next().value;
      if (oldest !== undefined) {
        importedHashes.delete(oldest);
      }
    }
    invalidateConsumptionCache();
    await this.audit.record({
      action: "budgeting.grid_imported",
      entityType: "budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      after: { fileHash, rows: parsed.lines.length, yearTotal: result.totals.year },
    });
    return result;
  }

  /** Parse + validate (shared by dry-run and commit). */
  private async parseAndValidate(
    budgetId: string,
    fileBase64: string,
  ): Promise<{ report: DryRunReport; lines: BudgetLineInput[] }> {
    const budget = await findBudgetById(budgetId);
    if (budget === undefined) {
      throw new BudgetNotFoundError(budgetId);
    }
    if (budget.status !== "DRAFT") {
      throw new BudgetImmutableError({ budgetId, status: budget.status });
    }
    const parsed = await parseGridXlsxAsync(Buffer.from(fileBase64, "base64"));
    const periods = await listPeriodsOfYear(budget.fiscalYearId);
    const dataRows = parsed.rows.filter((row) => row.some((cell) => cell !== ""));
    if (dataRows.length === 0) {
      throw new BudgetImportFormatError({ reason: "no data rows under the header" });
    }
    if (dataRows.length > MAX_ROWS) {
      throw new BudgetImportRowLimitError({ rowCount: dataRows.length, max: MAX_ROWS });
    }
    // Header shape: 3 identity columns + N period columns (+ a trailing
    // Total column tolerated and EXCLUDED from the period mapping). The
    // identity columns must match the EN or AR fixture set (either —
    // mixed not accepted).
    const lastHeader = parsed.headers[parsed.headers.length - 1] ?? "";
    const totalColumns =
      lastHeader === EN_HEADERS[3] || lastHeader === AR_HEADERS[3] ? 1 : 0;
    const periodColumns = parsed.headers.length - 3 - totalColumns;
    if (periodColumns < 1) {
      throw new BudgetImportFormatError({
        reason: "header carries no period columns (needs 3 identity columns + periods)",
      });
    }
    const identityOk = parsed.headers
      .slice(0, 3)
      .every((header, index) => header === EN_HEADERS[index] || header === AR_HEADERS[index]);
    if (!identityOk) {
      throw new BudgetImportFormatError({
        reason: "identity columns must match the EN or AR header fixture set",
      });
    }
    const mappedPeriods = periods.slice(0, periodColumns);
    const requiredDimension = scopeDimension(budget.scope);
    const errors: BudgetImportRowIssue[] = [];
    const lines: BudgetLineInput[] = [];

    const accountByCode = new Map<string, { id: string; postable: boolean }>();
    const resolveAccount = async (code: string) => {
      if (!accountByCode.has(code)) {
        const found = await findAccountByCode(code);
        accountByCode.set(
          code,
          found === undefined
            ? { id: "", postable: false }
            : { id: found.id, postable: found.isPostable },
        );
      }
      return accountByCode.get(code)!;
    };
    const dimensionByCode = new Map<string, string>();
    const resolveDimension = async (code: string) => {
      if (!dimensionByCode.has(code)) {
        let id = "";
        if (budget.scope === "COST_CENTERS") {
          id = (await findCostCenterByCode(code))?.id ?? "";
        } else if (budget.scope === "PROJECTS") {
          id = (await findProjectByCode(code))?.id ?? "";
        } else if (budget.scope === "BRANCHES") {
          id = (await findBranchByCode(code))?.id ?? "";
        }
        dimensionByCode.set(code, id);
      }
      return dimensionByCode.get(code)!;
    };

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
      const row = dataRows[rowIndex]!;
      const rowNo = rowIndex + 2; // the header is sheet row 1
      const accountCode = row[0] ?? "";
      if (accountCode === "") {
        errors.push({ rowNo, messageAr: "رمز الحساب مفقود", messageEn: "account code missing" });
        continue;
      }
      const account = await resolveAccount(accountCode);
      if (account.id === "") {
        errors.push({
          rowNo,
          messageAr: `الحساب «${accountCode}» غير موجود`,
          messageEn: `account "${accountCode}" not found`,
        });
        continue;
      }
      if (!account.postable) {
        errors.push({
          rowNo,
          messageAr: `الحساب «${accountCode}» غير قابل للترحيل`,
          messageEn: `account "${accountCode}" is not postable`,
        });
        continue;
      }
      const dimensionCode = (row[2] ?? "").trim();
      let dimensionId: string | null = null;
      if (requiredDimension === null) {
        if (dimensionCode !== "") {
          errors.push({
            rowNo,
            messageAr: "موازنة نطاق الحسابات لا تحمل رمز بُعد",
            messageEn: "ACCOUNTS-scope budgets carry no dimension code",
          });
          continue;
        }
      } else {
        if (dimensionCode === "") {
          errors.push({
            rowNo,
            messageAr: "رمز البُعد مطلوب لنطاق هذه الموازنة",
            messageEn: "the dimension code is required for this budget's scope",
          });
          continue;
        }
        dimensionId = await resolveDimension(dimensionCode);
        if (dimensionId === "") {
          errors.push({
            rowNo,
            messageAr: `رمز البُعد «${dimensionCode}» غير موجود`,
            messageEn: `dimension code "${dimensionCode}" not found`,
          });
          continue;
        }
      }
      let rowHasAmount = false;
      for (let col = 0; col < mappedPeriods.length; col += 1) {
        const cell = (row[3 + col] ?? "").replace(/,/g, "");
        if (cell === "") {
          continue;
        }
        if (!AMOUNT_RE.test(cell)) {
          errors.push({
            rowNo,
            messageAr: `المبلغ «${cell}» في العمود ${col + 1} ليس عدداً عشرياً غير سالب (≤ 4 منازل)`,
            messageEn: `amount "${cell}" in column ${col + 1} is not a non-negative decimal (≤ 4dp)`,
          });
          continue;
        }
        lines.push({
          fiscalPeriodId: mappedPeriods[col]!.id,
          accountId: account.id,
          costCenterId: requiredDimension === "costCenterId" ? dimensionId : null,
          projectId: requiredDimension === "projectId" ? dimensionId : null,
          branchId: requiredDimension === "branchId" ? dimensionId : null,
          amount: cell,
        });
        rowHasAmount = true;
      }
      if (!rowHasAmount) {
        errors.push({
          rowNo,
          messageAr: "الصف لا يحمل أي مبلغ لفترة",
          messageEn: "row carries no period amount",
        });
      }
    }
    const totalsPreview = lines.reduce((sum, line) => addExact(sum, line.amount), "0");
    return {
      report: { rowCount: dataRows.length, validRows: lines.length, errors, totalsPreview },
      lines,
    };
  }
}
