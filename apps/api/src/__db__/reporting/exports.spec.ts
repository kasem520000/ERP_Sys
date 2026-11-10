import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  fullContext,
  newRunService,
  R_ACTOR,
  setupReportingFixture,
  su,
  TENANT_R,
  UNBALANCED_ENTRY_ID,
  withTenant,
  findPeriodId,
  type ReportingFixture,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../../modules/files/application/files.service";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";
import { RunService } from "../../modules/reporting/application/run-service";
import { ExportService } from "../../modules/reporting/application/export/export-service";
import { inspectWorkbook } from "../../modules/reporting/application/export/xlsx";
import {
  AssertionFailedExportBlockedError,
  ReportRunNotFoundError,
} from "../../modules/reporting/domain/reporting-errors";

/**
 * PHASE-013 exports (PRINTING_AND_EXPORT §6 + REPORT_RECONCILIATION §1.3):
 * artifacts stored through the real FilesService (s3rver) with sha256 +
 * artifact registry on the run row, every issuance audited
 * (`report.exported`), CSV bytes BOM-first, XLSX inspectable (single Report
 * sheet, LTR for en, no formulas) — and the binding server-side block: a
 * result with a FAILED assertion can never be exported. The FAIL path is
 * driven by a superuser-seeded unbalanced posted entry (the only sanctioned
 * way past the ENTRY_NOT_BALANCED constraint trigger — replica session mode,
 * exactly the data-repair tooling pattern of the tax suite), cleaned up in
 * afterAll.
 */

let fx: ReportingFixture;
let runs: RunService;
let exportsSvc: ExportService;
let tbRunId: string;

beforeAll(async () => {
  fx = await setupReportingFixture();
  runs = newRunService();
  exportsSvc = new ExportService(
    new AuditService(new DrizzleAuditStore()),
    new FilesService(new S3FilesStore()),
    runs,
  );
  // A PASSing TB run (January window) to export from.
  const outcome = await withTenant(TENANT_R, () =>
    runs.run({
      reportKey: "financial.trial-balance",
      params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
      ctx: fullContext(),
    }),
  );
  expect(outcome.status).toBe("SUCCEEDED");
  expect(outcome.result!.assertions.every((a) => a.status === "PASS")).toBe(true);
  tbRunId = outcome.runId;
});

describe("csv export", () => {
  it("issues a signed URL + sha256, registers the artifact, audits the issuance", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      exportsSvc.exportRun({ runId: tbRunId, format: "csv", actorId: R_ACTOR }),
    );
    expect(outcome.url).toMatch(/^http/);
    expect(outcome.expiresInSeconds).toBe(900);
    expect(outcome.sha256).toMatch(/^[0-9a-f]{64}$/);

    // The bytes behind the URL: UTF-8 BOM first (Excel Arabic, §5).
    const response = await fetch(outcome.url);
    expect(response.status).toBe(200);
    const body = Buffer.from(await response.arrayBuffer());
    expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(body.toString("utf8")).toContain("Account code");
    expect(body.toString("utf8")).toContain("tb-debits-equal-credits,PASS");

    // Artifact registry entry on the run row + the audited issuance.
    const client = await su();
    const row = await client.query(
      `SELECT artifacts FROM report_runs WHERE tenant_id = $1 AND id = $2`,
      [TENANT_R, tbRunId],
    );
    const audited = await client.query(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'report.exported' AND entity_id = $2`,
      [TENANT_R, tbRunId],
    );
    await client.end();
    const artifacts = row.rows[0]!.artifacts as { format: string; sha256: string; bytes: number }[];
    const csvArtifact = artifacts.find((entry) => entry.format === "csv");
    expect(csvArtifact).toBeDefined();
    expect(csvArtifact!.sha256).toBe(outcome.sha256);
    expect(csvArtifact!.bytes).toBe(body.byteLength);
    expect(audited.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });
});

describe("xlsx export", () => {
  it("renders a single LTR 'Report' sheet with no formulas (en locale)", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      exportsSvc.exportRun({ runId: tbRunId, format: "xlsx", actorId: R_ACTOR }),
    );
    const response = await fetch(outcome.url);
    expect(response.status).toBe(200);
    const workbook = await inspectWorkbook(Buffer.from(await response.arrayBuffer()));
    expect(workbook.sheetNames).toEqual(["Report"]);
    expect(workbook.rightToLeft).toBe(false);
    expect(workbook.formulas).toEqual([]);

    // The artifact registry now carries both formats on the same run.
    const client = await su();
    const row = await client.query(
      `SELECT artifacts FROM report_runs WHERE tenant_id = $1 AND id = $2`,
      [TENANT_R, tbRunId],
    );
    await client.end();
    const formats = (row.rows[0]!.artifacts as { format: string }[]).map((a) => a.format).sort();
    expect(formats).toEqual(["csv", "xlsx"]);
  });
});

describe("format refusal", () => {
  it("a format outside the contract's exportFormats is refused", async () => {
    // fiscal-close-pack exports pdf/xlsx only — a completed pack run + csv.
    const packRuns = newRunService();
    const pack = await withTenant(TENANT_R, () =>
      packRuns.run({
        reportKey: "financial.fiscal-close-pack",
        params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "ar" },
        ctx: fullContext(),
      }),
    );
    await withTenant(TENANT_R, () =>
      packRuns.executeJob({
        runId: pack.runId,
        reportKey: "financial.fiscal-close-pack",
        permissions: fullContext().permissions,
        tenantId: TENANT_R,
        userId: R_ACTOR,
        baseCurrency: "SAR",
        effectiveBranchIds: null,
      }),
    );
    await expect(
      withTenant(TENANT_R, () =>
        exportsSvc.exportRun({ runId: pack.runId, format: "csv", actorId: R_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(ReportRunNotFoundError);
  });
});

describe("assertion block (REPORT_RECONCILIATION §1.3 — binding)", () => {
  it("an unbalanced posted entry fails the TB assertions and blocks every export", async () => {
    // Seed the drift: 2 debit lines (100 + 50) on cash, no credits — dated
    // 2026-02-05 inside the Feb window. Replica session mode is the
    // superuser data-repair path past the deferred balance trigger.
    const client = await su();
    const februaryPeriod = await findPeriodId(TENANT_R, "FY2026", "FY2026-02");
    await client.query(`SET session_replication_role = replica`);
    await client.query(
      `INSERT INTO journal_entries (id, tenant_id, entry_date, fiscal_period_id, currency_code,
                                    source_type, operation, posted_at)
       VALUES ($1, $2, '2026-02-05', $3, 'SAR', 'reporting_seed', 'post', now())`,
      [UNBALANCED_ENTRY_ID, TENANT_R, februaryPeriod],
    );
    await client.query(
      `INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id,
                                  direction, amount, base_amount)
       VALUES
         ('46464646-0000-4000-8000-00000000d0b1', $1, $2, 1, $3, 'DEBIT', 100, 100),
         ('46464646-0000-4000-8000-00000000d0b2', $1, $2, 2, $3, 'DEBIT', 50, 50)`,
      [TENANT_R, UNBALANCED_ENTRY_ID, fx.accounts.cash],
    );
    await client.query(`SET session_replication_role = DEFAULT`);

    try {
      // The run itself SUCCEEDS — the FAIL is the assertion outcome, stored
      // with the result (the viewer must render the banner, not a 500).
      const failRuns = newRunService();
      const outcome = await withTenant(TENANT_R, () =>
        failRuns.run({
          reportKey: "financial.trial-balance",
          params: { dateFrom: "2026-01-01", dateTo: "2026-02-28", locale: "en" },
          ctx: fullContext(),
        }),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      const debitCheck = outcome.result!.assertions.find((a) => a.id === "tb-debits-equal-credits");
      const closingCheck = outcome.result!.assertions.find((a) => a.id === "tb-closing-net-zero");
      expect(debitCheck?.status).toBe("FAIL");
      expect(closingCheck?.status).toBe("FAIL");
      // The compared values are persisted for audit review (§1.5) — the
      // drift is exactly the seeded 150 unbalanced debit (order-robust:
      // whichever golden entries are posted at this point, debits exceed
      // credits by 150.0000 and only by that).
      const left = Number(debitCheck?.compared?.left);
      const right = Number(debitCheck?.compared?.right);
      expect(Number((left - right).toFixed(4))).toBe(150);
      const closingLeft = Number(closingCheck?.compared?.left);
      const closingRight = Number(closingCheck?.compared?.right);
      expect(Number((closingLeft - closingRight).toFixed(4))).toBe(150);

      const row = await client.query(
        `SELECT status, assertion_status, error_code, (result IS NOT NULL) AS has_result
           FROM report_runs WHERE tenant_id = $1 AND id = $2`,
        [TENANT_R, outcome.runId],
      );
      expect(row.rows[0]!.status).toBe("SUCCEEDED");
      expect(row.rows[0]!.assertion_status).toBe("FAIL");
      expect(row.rows[0]!.has_result).toBe(true);
      expect(row.rows[0]!.error_code).toBe(null);

      // Server-side block: every format is refused with the failed ids.
      await expect(
        withTenant(TENANT_R, () =>
          exportsSvc.exportRun({ runId: outcome.runId, format: "csv", actorId: R_ACTOR }),
        ),
      ).rejects.toBeInstanceOf(AssertionFailedExportBlockedError);
      await expect(
        withTenant(TENANT_R, () =>
          exportsSvc.exportRun({ runId: outcome.runId, format: "pdf", actorId: R_ACTOR }),
        ),
      ).rejects.toBeInstanceOf(AssertionFailedExportBlockedError);
    } finally {
      // Restore the pristine golden book (append-only guards bypassed the
      // same sanctioned way — the probe row never outlives this spec).
      await client.query(`SET session_replication_role = replica`);
      await client.query(`DELETE FROM journal_lines WHERE journal_entry_id = $1 AND tenant_id = $2`, [
        UNBALANCED_ENTRY_ID,
        TENANT_R,
      ]);
      await client.query(`DELETE FROM journal_entries WHERE id = $1 AND tenant_id = $2`, [
        UNBALANCED_ENTRY_ID,
        TENANT_R,
      ]);
      await client.query(`SET session_replication_role = DEFAULT`);
      await client.end();
    }
  });
});

afterAll(async () => {
  // Defense in depth: guarantee the probe entry is gone even if the test
  // body above threw before its own cleanup.
  const client = await su();
  await client.query(`SET session_replication_role = replica`);
  await client.query(`DELETE FROM journal_lines WHERE journal_entry_id = $1 AND tenant_id = $2`, [
    UNBALANCED_ENTRY_ID,
    TENANT_R,
  ]);
  await client.query(`DELETE FROM journal_entries WHERE id = $1 AND tenant_id = $2`, [
    UNBALANCED_ENTRY_ID,
    TENANT_R,
  ]);
  await client.query(`SET session_replication_role = DEFAULT`);
  await client.end();
});
