import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { ReportResult } from "../contract";
import {
  AssertionFailedExportBlockedError,
  ReportRunNotFoundError,
} from "../../domain/reporting-errors";
import * as store from "../../infrastructure/reporting.store";
import { AuditService } from "../../../audit/api/audit";
import { FilesService } from "../../../files/api/files";
import { renderCsv } from "./csv";
import { renderXlsx } from "./xlsx";
import { renderReportPdf } from "./pdf-print";
import type { RunService } from "../run-service";

/**
 * PHASE-013 T13 · the export service (PRINTING_AND_EXPORT §6, §8):
 * artifacts are stored through the files module with metadata (template
 * version, sha256), delivered via short-lived signed URLs (15 min
 * default), every download-issuance audited, and — binding — a result
 * with a FAILED assertion can never be exported or printed: the block is
 * server-side, not a hidden button (REPORT_RECONCILIATION §1.3).
 *
 * Exports always render from the STORED run envelope — the PDF you print
 * is the result you saw (assertions included; PRINTING_AND_EXPORT §8.3).
 */

export type ExportFormat = "pdf" | "xlsx" | "csv";

@Injectable()
export class ExportService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(FilesService) private readonly files: FilesService,
    @Inject("REPORTING_RUN_SERVICE") private readonly runs: RunService,
  ) {}

  /**
   * Render + store one artifact for a completed run and issue its signed
   * URL. Re-exports replace the artifact entry for the format (idempotent
   * by run id — no duplicates).
   */
  async exportRun(input: {
    runId: string;
    format: ExportFormat;
    actorId: string | null;
  }): Promise<{ url: string; expiresInSeconds: number; sha256: string; bytes: number }> {
    const run = await store.findRunById(input.runId);
    if (run === undefined || run.status !== "SUCCEEDED" || run.result === null) {
      throw new ReportRunNotFoundError(input.runId);
    }
    const contract = this.runs.contract(run.reportKey);
    if (!contract.exportFormats.includes(input.format)) {
      throw new ReportRunNotFoundError(input.runId);
    }
    // Server-side export block on failed assertions (§8.1 — binding).
    if (run.assertionStatus === "FAIL") {
      const failed = (run.assertions as { id: string; status: string }[] | null)
        ?.filter((a) => a.status === "FAIL")
        .map((a) => a.id) ?? [];
      throw new AssertionFailedExportBlockedError(run.reportKey, failed);
    }
    const envelope = run.result as unknown as ReportResult;
    const buffer = await this.render(envelope, input.format, contract.printTemplate);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const filename = `${run.reportKey.replace(/[^a-z0-9.-]/g, "-")}-${input.runId}.${input.format}`;
    const { key } = await this.files.writeObject(envelope.runId, filename, buffer, contentTypeOf(input.format));
    const url = await this.files.issueDownloadUrl(envelope.runId, key);
    // Audit the export issuance (who, which run, which format).
    await this.audit.record({
      action: "report.exported",
      entityType: "report_run",
      entityId: input.runId,
      actorId: input.actorId ?? undefined,
      after: { reportKey: run.reportKey, format: input.format, sha256, bytes: buffer.byteLength },
    });
    // Artifact registry on the run row (replaces the same-format entry).
    const artifacts = ((run.artifacts as ArtifactEntry[] | null) ?? []).filter(
      (entry) => entry.format !== input.format,
    );
    artifacts.push({
      format: input.format,
      key,
      sha256,
      bytes: buffer.byteLength,
      contentType: contentTypeOf(input.format),
      templateVersion: PRINT_TEMPLATE_VERSION,
      createdAt: new Date().toISOString(),
    });
    await store.storeArtifacts(input.runId, artifacts);
    return { url, expiresInSeconds: 900, sha256, bytes: buffer.byteLength };
  }

  private async render(
    envelope: ReportResult,
    format: ExportFormat,
    template: "a4-report" | "a4-document" | undefined,
  ): Promise<Buffer> {
    if (format === "csv") {
      return renderCsv(envelope);
    }
    if (format === "xlsx") {
      return renderXlsx(envelope);
    }
    return renderReportPdf(envelope, template ?? "a4-report");
  }
}

export interface ArtifactEntry {
  format: ExportFormat;
  key: string;
  sha256: string;
  bytes: number;
  contentType: string;
  templateVersion: number;
  createdAt: string;
}

function contentTypeOf(format: ExportFormat): string {
  if (format === "pdf") {
    return "application/pdf";
  }
  if (format === "xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  return "text/csv";
}

const PRINT_TEMPLATE_VERSION = 1;
