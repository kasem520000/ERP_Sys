import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import {
  ownTenantBaseCurrency,
  ownTenantCountryCode,
  ownTenantName,
  readEffectiveSetting,
} from "../../../infra/settings/setting-reader";
import { RunImmutableError, RunNotFoundError } from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { EmployeeRow } from "../infrastructure/payroll.store";
import {
  buildRemittanceXlsx,
  renderRemittanceCsv,
  type RemittanceExportLocale,
  type RemittanceExportFileInput,
  type RemittanceRowModel,
  type RemittanceSummaryRowModel,
} from "../infrastructure/remittance-export-file";

/**
 * The statutory remittance export service (PHASE-046 W-4, T-08 — IN-06):
 * the run's FROZEN statutory liability (the per-line breakdowns + the
 * `statutory_summary`, D-05) rendered as the remittance-ready XLSX/CSV —
 * the per-employee contribution breakdown + totals, the 028 exceljs
 * pattern (RTL at locale=ar, tabular 4dp), generation AUDITED
 * (`payroll.remittance_exported`).
 *
 * THE LAWS:
 * - BR-086 — READ-ONLY + AUDITED: the export writes NOTHING but its audit
 *   event (no register reads/writes, no new machinery, no journals — the
 *   settlement itself is the G-52 remittance act only); the file is a
 *   statement of what the run already posted, never a financial act.
 * - POSTED-ONLY: only a POSTED run carries the frozen liability the file
 *   states (the remittance settlement's own law — a DRAFT's numbers can be
 *   recalculated under it; the authority-facing file must state the
 *   posted ones). The typed IMMUTABLE_DOCUMENT refusal otherwise.
 * - THE FROZEN-SNAPSHOT LAW: amounts come VERBATIM from the frozen line
 *   breakdowns + the run's statutory columns + the summary — the export
 *   never recomputes, never re-resolves profiles, never rounds (INV-032's
 *   exact strings ride the file untouched).
 * - THE TOTALS TIE: Σ per (code, kind) of the export rows ==
 *   statutory_summary.accrued — asserted here so a malformed file can
 *   never leave the service.
 * - PII (the payslips precedent): the employee CODE + name pair ride the
 *   file; national_id/bank fields NEVER do (the masked shape is the only
 *   shape that leaves — the official GOSI submission file format is the
 *   owner's open item, listed in the readiness register).
 * - IN-06 — READINESS ONLY: no live-government-API claim exists anywhere;
 *   the establishment number is the tenant's own setting (unset = the
 *   honest not-configured note in the footer, never a refusal).
 */
@Injectable()
export class RemittanceExportService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async exportRun(input: {
    runId: string;
    format: "xlsx" | "csv";
    locale: RemittanceExportLocale;
    actorId: string | null;
  }): Promise<{
    format: "xlsx" | "csv";
    locale: RemittanceExportLocale;
    contentType: string;
    filename: string;
    bytes: Buffer;
    employeeCount: number;
    rowCount: number;
    establishmentNo: string | null;
    totals: { employeeShare: string; employerShare: string; pit: string; grandTotal: string };
  }> {
    const run = await store.findRunById(input.runId);
    if (run === undefined) throw new RunNotFoundError(input.runId);
    if (run.status !== "POSTED") {
      throw new RunImmutableError({
        runId: input.runId,
        status: run.status,
        action:
          "remittance export (only POSTED runs carry the frozen statutory liability — the numbers a remittance file states are the posted ones)",
      });
    }
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new RunNotFoundError(input.runId);

    const lines = await store.listRunLines(input.runId);
    const employeeCache = new Map<string, EmployeeRow>();
    const rows: RemittanceRowModel[] = [];
    for (const line of lines) {
      let employee = employeeCache.get(line.employeeId);
      if (employee === undefined) {
        employee = await store.findEmployeeById(line.employeeId);
        if (employee === undefined) continue;
        employeeCache.set(employee.id, employee);
      }
      const employeeName =
        input.locale === "ar"
          ? (employee.nameAr ?? employee.name)
          : employee.name;
      for (const entry of line.statutoryBreakdown ?? []) {
        rows.push({
          employeeCode: employee.code,
          employeeName,
          code: entry.code,
          kind: "CONTRIBUTION",
          base: entry.base ?? "0.0000",
          clampedBase: entry.clampedBase ?? "0.0000",
          clampedBy: entry.clampedBy ?? null,
          employeeRate: entry.employeeRate ?? null,
          employerRate: entry.employerRate ?? null,
          employeeAmount: entry.employeeAmount,
          employerAmount: entry.employerAmount,
          rowTotal: addExact(entry.employeeAmount, entry.employerAmount),
        });
      }
      if (compareExact(line.pitWithheld, "0.0000") > 0) {
        rows.push({
          employeeCode: employee.code,
          employeeName,
          code: "PIT",
          kind: "PIT",
          base: line.grossAmount,
          clampedBase: line.grossAmount,
          clampedBy: null,
          employeeRate: null,
          employerRate: null,
          employeeAmount: line.pitWithheld,
          employerAmount: "0.0000",
          rowTotal: line.pitWithheld,
        });
      }
    }

    // The totals + THE TIE: per (code, kind) the export rows must fold
    // exactly the frozen summary's accruals (the invariant the round-trip
    // spec pins from the file side; asserted here so a malformed file can
    // never leave).
    let employeeShare = "0.0000";
    let employerShare = "0.0000";
    let pit = "0.0000";
    const byCode = new Map<string, string>();
    for (const row of rows) {
      if (row.kind === "PIT") {
        pit = addExact(pit, row.employeeAmount);
      } else {
        employeeShare = addExact(employeeShare, row.employeeAmount);
      }
      employerShare = addExact(employerShare, row.employerAmount);
      const key = `${row.kind}|${row.code}`;
      byCode.set(key, addExact(byCode.get(key) ?? "0.0000", addExact(row.employeeAmount, row.employerAmount)));
    }
    const summary: RemittanceSummaryRowModel[] = (run.statutorySummary ?? []).map((row) => {
      const folded = byCode.get(`${row.kind}|${row.code}`);
      if (folded !== undefined && folded !== row.accrued) {
        throw new Error(
          `remittance export totals tie failed for ${row.code}: rows fold ${folded}, the frozen summary accrues ${row.accrued}`,
        );
      }
      return {
        code: row.code,
        kind: row.kind,
        accrued: row.accrued,
        remitted: row.remitted,
        outstanding: subExact(row.accrued, row.remitted),
      };
    });
    const grandTotal = addExact(addExact(employeeShare, employerShare), pit);

    const establishmentNo = await readEffectiveSetting<string | null>(
      "payroll.statutory.gosi_establishment_no",
    );
    const [currency, jurisdictionCode, tenantName] = await Promise.all([
      ownTenantBaseCurrency(),
      ownTenantCountryCode(),
      ownTenantName(),
    ]);

    const fileInput: RemittanceExportFileInput = {
      locale: input.locale,
      runNo: run.runNo,
      periodName: period.name,
      asOf: new Date().toISOString().slice(0, 10),
      currency,
      jurisdictionCode,
      employerName:
        input.locale === "ar" ? (tenantName.nameAr ?? tenantName.name) : tenantName.name,
      establishmentNo,
      rows,
      totals: { employeeShare, employerShare, pit, grandTotal },
      summary,
      runTotals: {
        employeeShare: run.statutoryEmployeeTotal,
        employerShare: run.statutoryEmployerTotal,
        pit: run.pitTotal,
      },
    };
    const bytes =
      input.format === "csv"
        ? renderRemittanceCsv(fileInput)
        : await buildRemittanceXlsx(fileInput);
    const contentType =
      input.format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const stamp = fileInput.asOf;
    const filename = `statutory-remittance-${run.runNo ?? run.id.slice(0, 8)}-${stamp}.${input.format}`;

    // The generation is audited (BR-086's audited-artifact law): the run,
    // the shape, and the totals it stated — the evidence an authority-facing
    // file left the platform.
    await this.audit.record({
      action: "payroll.remittance_exported",
      entityType: "payroll_run",
      entityId: input.runId,
      actorId: input.actorId ?? undefined,
      after: {
        format: input.format,
        locale: input.locale,
        rowCount: rows.length,
        employeeCount: employeeCache.size,
        totals: { employeeShare, employerShare, pit, grandTotal },
        establishmentConfigured: establishmentNo !== null,
      },
    });

    return {
      format: input.format,
      locale: input.locale,
      contentType,
      filename,
      bytes,
      employeeCount: employeeCache.size,
      rowCount: rows.length,
      establishmentNo,
      totals: { employeeShare, employerShare, pit, grandTotal },
    };
  }
}
