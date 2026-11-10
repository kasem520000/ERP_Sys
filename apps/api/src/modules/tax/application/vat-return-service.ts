import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { FilesService } from "../../files/api/files";
import * as store from "../infrastructure/tax.store";
import {
  JurisdictionNotFoundError,
  VatReturnAlreadyFiledError,
  VatReturnCrossCheckFailedError,
  VatReturnNotFoundError,
  VatReturnStateError,
  VatReturnWindowTakenError,
} from "../domain/tax-errors";

/**
 * PHASE-009 T9 — the VAT return v1 (TAX_ENGINE §4; REPORT_CATALOG
 * `tax.vat_return` + `tax.summary-by-treatment`): aggregates the posted
 * documents' tax summaries by (direction, treatment, rate) for a period +
 * jurisdiction, computes the INV-012 side-by-side cross-check against GL
 * tax-account movements, and gates the ready-to-file status on an exact
 * match (RC-06). RC-07's seeded drift (a mutated summary row) surfaces as
 * the mismatch banner + blocked READY — asserted by test.
 *
 * Determinism: re-running prepare over the same data is byte-identical
 * (canonical ordering + exact decimal strings, no timestamps inside the
 * summary JSON). Filing is a HUMAN action recorded with metadata
 * (`tax.returns.mark_filed`, audited — the platform reports, humans file).
 * Exports (CSV/XLSX) ride the files module like the PHASE-006 exports.
 */
@Injectable()
export class VatReturnService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  async list(countryCode?: string) {
    return store.listVatReturns(countryCode);
  }

  async find(id: string) {
    const row = await store.findVatReturnById(id);
    if (row === undefined) throw new VatReturnNotFoundError(id);
    return row;
  }

  async createDraft(input: {
    countryCode: string;
    periodStart: string;
    periodEnd: string;
    actorId: string | null;
  }) {
    const jurisdiction = await store.findJurisdictionByCountry(input.countryCode);
    if (jurisdiction === undefined) throw new JurisdictionNotFoundError(input.countryCode);
    const existing = await store.findVatReturnByWindow(
      input.countryCode,
      input.periodStart,
      input.periodEnd,
    );
    if (existing !== undefined) {
      throw new VatReturnWindowTakenError({
        countryCode: input.countryCode,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      });
    }
    const created = await store.insertVatReturn({
      countryCode: input.countryCode,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "tax.return_created",
      entityType: "vat_return",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { countryCode: input.countryCode, period: `${input.periodStart}..${input.periodEnd}` },
    });
    return created;
  }

  /**
   * The INV-012 cross-check core (RC-06): Σ summaries by direction vs GL
   * net movements on the three VAT purpose accounts over the window.
   * Exported for the reconciliation service (the PC-04 check reuses it).
   */
  async computeCrossCheck(input: {
    countryCode: string;
    periodStart: string;
    periodEnd: string;
  }) {
    const aggregates = await store.aggregateSummaries({
      countryCode: input.countryCode,
      fromDate: input.periodStart,
      toDate: input.periodEnd,
    });
    const gl = await store.glTaxMovements({
      fromDate: input.periodStart,
      toDate: input.periodEnd,
    });
    let outputTotal = "0";
    let inputRecoverable = "0";
    let inputExpensed = "0";
    for (const row of aggregates) {
      if (row.direction === "OUTPUT") {
        outputTotal = addExact(outputTotal, row.taxAmount);
      } else if (row.treatment === "EXEMPT") {
        inputExpensed = addExact(inputExpensed, row.taxAmount);
      } else {
        inputRecoverable = addExact(inputRecoverable, row.taxAmount);
      }
    }
    const payable = gl.find((row) => row.purposeKey === "VAT_PAYABLE")?.netMovement ?? "0";
    const recoverable = gl.find((row) => row.purposeKey === "VAT_RECOVERABLE")?.netMovement ?? "0";
    const expensed = gl.find((row) => row.purposeKey === "VAT_EXPENSED")?.netMovement ?? "0";
    const normalize = (value: string) => (Number(value) === 0 ? "0.0000" : Number(value).toFixed(4));
    const crossCheck = {
      documentSide: {
        outputTax: normalize(outputTotal),
        inputTaxRecoverable: normalize(inputRecoverable),
        inputTaxExpensed: normalize(inputExpensed),
      },
      glSide: {
        vatPayableNetCredit: normalize(payable),
        vatRecoverableNetDebit: normalize(recoverable),
        vatExpensedNetDebit: normalize(expensed),
      },
    };
    const ok =
      crossCheck.documentSide.outputTax === crossCheck.glSide.vatPayableNetCredit &&
      crossCheck.documentSide.inputTaxRecoverable === crossCheck.glSide.vatRecoverableNetDebit &&
      crossCheck.documentSide.inputTaxExpensed === crossCheck.glSide.vatExpensedNetDebit;
    return { aggregates, crossCheck, ok, summaryRowCount: await store.countSummaries({ countryCode: input.countryCode, fromDate: input.periodStart, toDate: input.periodEnd }) };
  }

  /**
   * Prepare (DRAFT → READY): aggregate + cross-check; READY only when both
   * sides agree exactly (a mismatch throws the typed cross-check error AND
   * blocks the status). Re-runs are byte-identical (deterministic JSON).
   */
  async prepare(id: string, actorId: string | null) {
    const row = await this.find(id);
    if (row.status === "FILED") throw new VatReturnAlreadyFiledError(id);
    const { aggregates, crossCheck, ok, summaryRowCount } = await this.computeCrossCheck({
      countryCode: row.countryCode,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    });
    // Deterministic summary shape (byte-identical re-runs — golden test).
    const summary = {
      period: { start: row.periodStart, end: row.periodEnd },
      countryCode: row.countryCode,
      groups: aggregates.map((group) => ({
        direction: group.direction,
        treatment: group.treatment,
        rate: group.rate,
        taxableBase: group.taxableBase,
        taxAmount: group.taxAmount,
      })),
      totals: crossCheck.documentSide,
      summaryRowCount,
    };
    await store.updateVatReturnPrepared({
      id,
      summary,
      crossCheck: { ...crossCheck, ok },
      crossCheckOk: ok,
      preparedBy: actorId,
    });
    await this.audit.record({
      action: "tax.return_prepared",
      entityType: "vat_return",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { crossCheckOk: ok, ...crossCheck.documentSide },
    });
    const updated = await this.find(id);
    if (!ok) {
      // Ready blocked (and revoked when previously READY): surface the typed
      // error to the caller (the row keeps the mismatch banner data for the
      // screen — both sides side-by-side).
      throw new VatReturnCrossCheckFailedError({
        outputDiff: diff(crossCheck.documentSide.outputTax, crossCheck.glSide.vatPayableNetCredit),
        inputDiff: diff(
          crossCheck.documentSide.inputTaxRecoverable,
          crossCheck.glSide.vatRecoverableNetDebit,
        ),
        expensedDiff: diff(
          crossCheck.documentSide.inputTaxExpensed,
          crossCheck.glSide.vatExpensedNetDebit,
        ),
      });
    }
    return updated;
  }

  /** tax.returns.mark_filed (risky, audited — the platform never files). */
  async markFiled(input: {
    id: string;
    filingReference: string | null;
    filingNote: string | null;
    actorId: string | null;
  }) {
    const row = await this.find(input.id);
    if (row.status === "FILED") throw new VatReturnAlreadyFiledError(input.id);
    if (row.status !== "READY") {
      throw new VatReturnStateError(
        `VAT return ${input.id} is ${row.status} — only READY returns can be marked filed (INV-012 gates READY)`,
      );
    }
    if (row.crossCheckOk !== true) {
      throw new VatReturnCrossCheckFailedError({
        outputDiff: "unknown",
        inputDiff: "unknown",
        expensedDiff: "unknown",
      });
    }
    await store.updateVatReturnFiled({ ...input, filedBy: input.actorId });
    await this.audit.record({
      action: "tax.return_marked_filed",
      entityType: "vat_return",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: {
        filingReference: input.filingReference,
        filingNote: input.filingNote,
        filedByHuman: true,
      },
    });
    return this.find(input.id);
  }

  /** CSV/XLSX export via the files module (signed URL, tenant-prefixed). */
  async export(input: { id: string; format: "CSV" | "XLSX"; actorId: string | null }) {
    const row = await this.find(input.id);
    const summary = row.summary as {
      groups?: { direction: string; treatment: string; rate: string; taxableBase: string; taxAmount: string }[];
      totals?: Record<string, string>;
      period?: { start: string; end: string };
    };
    const headers = ["direction", "treatment", "rate", "taxable_base", "tax_amount"];
    const rows = (summary.groups ?? []).map((group) => [
      group.direction,
      group.treatment,
      group.rate,
      group.taxableBase,
      group.taxAmount,
    ]);
    const stamp = row.periodStart;
    const bytes =
      input.format === "CSV" ? toCsv(headers, rows) : await toXlsx(headers, rows);
    const contentType =
      input.format === "CSV"
        ? "text/csv"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const tenantId = (await import("../../../infra/db/tenant-context")).requireTenantContext().tenantId;
    const extension = input.format === "CSV" ? "csv" : "xlsx";
    const { key } = await this.files.writeObject(
      tenantId,
      `vat-return-${row.countryCode}-${stamp}.${extension}`,
      bytes,
      contentType,
    );
    const downloadUrl = await this.files.issueDownloadUrl(tenantId, key);
    await this.audit.record({
      action: "tax.return_exported",
      entityType: "vat_return",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { format: input.format, rowCount: rows.length },
    });
    return { downloadUrl, rowCount: rows.length, format: input.format, expiresInSeconds: 900 };
  }
}

function addExact(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toFixed(4);
}

function diff(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toFixed(4);
}

/** CSV per PRINTING_AND_EXPORT: UTF-8 BOM + RFC-4180 quoting. */
function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): Buffer {
  const quote = (value: string): string => {
    const escaped = value.replace(/"/g, '""');
    return /[",;\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
  };
  const lines = [headers.map(quote).join(","), ...rows.map((row) => row.map(quote).join(","))];
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function toXlsx(headers: readonly string[], rows: readonly (readonly string[])[]): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")) as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("vat-return");
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const written = await workbook.xlsx.writeBuffer();
  return Buffer.from(written);
}
