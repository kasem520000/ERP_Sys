import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { effectivePermissions } from "../../identity/infrastructure/identity.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { envelope } from "../../../infra/http/envelope";
import { withTenant } from "../../../infra/db/tenant-context";
import type { RunContext } from "../application/contract";
import type { RunService } from "../application/run-service";
import type { ExportService, ExportFormat } from "../application/export/export-service";
import * as store from "../infrastructure/reporting.store";
import { registrySnapshot } from "../registry";
import { intersectBranchScope } from "../application/scope";

/**
 * PHASE-013 reporting routes (PHASE-013 §4): the registry snapshot, run
 * execution + polling, result envelopes, exports via signed URLs, and the
 * print-preview payload. Every route is permission-guarded (the seeded
 * matrix keys), feature-gated per surface class, and runs inside the
 * tenant transaction (RLS + explicit tenant_id).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const runRequestSchema = z.object({
  reportKey: z.string().min(1).max(120),
  params: z.record(z.string(), z.unknown()).default({}),
  contractVersion: z.number().int().optional(),
});

const exportRequestSchema = z.object({
  format: z.enum(["pdf", "xlsx", "csv"]),
});

@Controller("api/v1/reporting")
export class ReportingController {
  constructor(
    @Inject("REPORTING_RUN_SERVICE") private readonly runs: RunService,
    @Inject("REPORTING_EXPORT_SERVICE") private readonly exports: ExportService,
  ) {}

  /** Registry snapshot (navigation + command menu; §2). */
  @Get("reports")
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.engine")
  async listReports() {
    return envelope(registrySnapshot(this.runs.contracts()));
  }

  /** Execute a report (inline returns the envelope; heavy returns a run id). */
  @Post("report-runs")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.engine")
  async createRun(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = runRequestSchema.parse(body);
    const ctx = await this.runContext(identity);
    const outcome = await withTenant(ctx.tenantId, () => this.runs.run({ ...input, ctx }));
    return envelope(outcome);
  }

  /** Run status polling (job path: QUEUED → RUNNING → terminal). */
  @Get("report-runs/:id")
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.engine")
  async getRun(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    const row = await withTenantOf(request, () => store.findRunById(id));
    return envelope(
      row === undefined
        ? null
        : {
            runId: row.id,
            reportKey: row.reportKey,
            status: row.status,
            stage: row.stage,
            assertionStatus: row.assertionStatus,
            errorCode: row.errorCode,
            durationMs: row.durationMs,
          },
    );
  }

  /** The stored result envelope (the export source of truth). */
  @Get("report-runs/:id/result")
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.engine")
  async getResult(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    const row = await withTenantOf(request, () => store.findRunById(id));
    return envelope(row === undefined ? null : row.result);
  }

  /** Run history (the run-list surface; approval-style states). */
  @Get("report-runs")
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.engine")
  async listRuns(
    @Req() request: Request,
    @Query("reportKey") reportKey?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    const rows = await withTenantOf(request, () =>
      store.listRuns({
        reportKey,
        status,
        limit: limit === undefined ? undefined : Math.min(Number(limit) || 50, 200),
      }),
    );
    return envelope(
      rows.map((row) => ({
        runId: row.id,
        reportKey: row.reportKey,
        status: row.status,
        stage: row.stage,
        assertionStatus: row.assertionStatus,
        executionClass: row.executionClass,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
      })),
    );
  }

  /**
   * Export a completed run (PDF/XLSX/CSV via the files module + a signed
   * URL, audited). Export permission is separate from run permission
   * (§Permission tests: `reporting.reports.export`).
   */
  @Post("report-runs/:id/exports")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("reporting.reports.export")
  @RequireFeature("reporting.exports")
  async exportRun(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = exportRequestSchema.parse(body);
    const outcome = await withTenantOf(request, () =>
      this.exports.exportRun({ runId: id, format: input.format as ExportFormat, actorId: identity.userId }),
    );
    return envelope(outcome);
  }

  /** The print-preview payload (the same HTML the renderer prints). */
  @Get("print-preview/:id")
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.print_templates")
  async printPreview(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    const { renderA4Report, pageFooterTemplate } = await import("@erp/ui/print");
    const row = await withTenantOf(request, () => store.findRunById(id));
    if (row === undefined || row.result === null) {
      return envelope(null);
    }
    const result = row.result as {
      reportId: string;
      formatting: { locale: "ar" | "en" };
      paramsEcho: Record<string, unknown>;
      columns: { id: string; label: { ar: string; en: string }; numeric?: boolean }[];
      groups: { key: string; label: { ar: string; en: string } }[];
      rows: { values: Record<string, string | number | null>; groupKey?: string }[];
      totals: { label: { ar: string; en: string }; amount: string; kind: string }[];
      assertions: { id: string; status: string }[];
      freshness: { asOf?: string; computedAt: string };
    };
    const html = renderA4Report({
      template: "a4-report",
      locale: result.formatting.locale,
      title: { ar: `تقرير ${result.reportId}`, en: `Report ${result.reportId}` },
      parameterSummary: Object.entries(result.paramsEcho)
        .filter(([key]) => key !== "locale")
        .slice(0, 6)
        .map(([key, value]) => `${key}=${String(value)}`),
      branding: { tenantName: "ERP" },
      columns: result.columns.map((column) => ({
        label: column.label,
        numeric: column.numeric === true,
      })),
      groups: result.groups,
      rows: result.rows.map((row) => ({
        values: result.columns.map((column) => {
          const value = row.values[column.id];
          return value === null || value === undefined ? null : String(value);
        }),
        groupKey: row.groupKey,
      })),
      totals: result.totals.map((total) => ({
        label: total.label,
        amount: total.amount,
        isCheck: total.kind === "check",
      })),
      assertions: result.assertions.map((assertion) => ({
        id: assertion.id,
        status: assertion.status === "FAIL" ? "FAIL" : "PASS",
      })),
      asOf: result.freshness.asOf,
      computedAt: result.freshness.computedAt,
    });
    return envelope({ html, footerTemplate: pageFooterTemplate(result.formatting.locale) });
  }

  /** The print-template registry (versioned; templates.manage surface). */
  @Get("print-templates")
  @RequirePermissions("reporting.reports.run")
  @RequireFeature("reporting.print_templates")
  async listPrintTemplates(@Req() request: Request) {
    requireIdentity(request);
    const rows = await withTenantOf(request, () => store.listPrintTemplates());
    return envelope(rows);
  }

  /** The RunContext from the session (scope intersection applied). */
  private async runContext(identity: SessionContext): Promise<RunContext> {
    const tenantId = identity.activeTenantId;
    if (tenantId === null) {
      throw new UnauthenticatedError();
    }
    const permissions =
      identity.permissions ?? (await effectivePermissions(identity.userId, tenantId));
    const scope = intersectBranchScope(
      { effectiveBranchIds: identity.activeTenant?.branchScope ?? null },
      {},
    );
    const baseCurrency = await withTenant(tenantId, () => ownTenantBaseCurrency());
    return {
      tenantId,
      userId: identity.userId,
      effectiveBranchIds: scope.branchIds,
      baseCurrency,
      permissions,
    };
  }
}

async function withTenantOf<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  const identity = identityOf(request);
  const tenantId = identity?.activeTenantId;
  if (tenantId === null || tenantId === undefined) {
    throw new UnauthenticatedError();
  }
  return withTenant(tenantId, fn);
}
