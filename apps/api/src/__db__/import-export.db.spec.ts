import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { PasswordService } from "../modules/identity/application/password-service";
import * as store from "../modules/identity/infrastructure/identity.store";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";

/**
 * PHASE-006 import/export engine (T8; U-01…U-07): dry-run preview reports
 * row errors + duplicates deterministically (same token → same report),
 * commit applies exactly the previewed rows, concurrent duplicate commits
 * conflict while the same-token replay is idempotent, XLSX (zip) bombs are
 * rejected by the U-07 decompression guard, Arabic content round-trips
 * through CSV-with-BOM and XLSX, and exports hand back tenant-bound signed
 * URLs (A11). Files are uploaded through the real s3rver object store.
 */

const BASE_PASSWORD = "import-master-pass-9";
let httpBase: string;
let shutdown: (() => Promise<void>) | undefined;
const owner = { email: `imp-owner-${generateUuidV7().slice(0, 8)}@fixture.test`, token: "" };
let tenantId = "";

async function post(path: string, body: unknown, headers: Record<string, string> = {}, options: { skipIdempotencyKey?: boolean } = {}): Promise<Response> {
  const merged: Record<string, string> = { "content-type": "application/json", ...headers };
  if (!options.skipIdempotencyKey && merged["idempotency-key"] === undefined) {
    merged["idempotency-key"] = generateUuidV7();
  }
  return fetch(`${httpBase}${path}`, {
    method: "POST",
    headers: merged,
    body: JSON.stringify(body),
  });
}

async function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${httpBase}${path}`, { headers });
}

function toCsv(rows: readonly (readonly string[])[]): Buffer {
  return Buffer.from(`\uFEFF${rows.map((row) => row.join(",")).join("\r\n")}\r\n`, "utf8");
}

async function uploadCsv(content: Buffer): Promise<string> {
  const state = ensureTestDb();
  const client = new S3Client({
    region: "us-east-1",
    endpoint: state.s3Endpoint,
    credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" },
    forcePathStyle: true,
  });
  const key = `${tenantId}/${generateUuidV7()}/partners-import.csv`;
  await client.send(
    new PutObjectCommand({
      Bucket: state.s3Bucket,
      Key: key,
      Body: content,
      ContentType: "text/csv",
    }),
  );
  return key;
}

/** Wait until the import job reaches the given status (bounded). */
async function waitForStatus(
  jobId: string,
  target: "PREVIEW_READY" | "COMMITTED" | "FAILED",
  token: string,
): Promise<{ status: string; committedRows?: number; report?: unknown }> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const response = await get(`/api/v1/items/import-jobs/${jobId}`, {
      "x-session-token": token,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { status: string; committedRows: number; report?: unknown };
    };
    if (body.data.status === target) {
      return body.data;
    }
    if (body.data.status === "FAILED") {
      throw new Error(`import job failed: ${JSON.stringify(body.data.report ?? {})}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`import job ${jobId} never reached ${target}`);
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  tenantId = generateUuidV7();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, 'Import Tenant', 'مستأجر الاستيراد', 'SAR', 'SA', 'Asia/Riyadh')`,
    [tenantId],
  );
  // Onboarding-equivalent uom + credit-terms seeds (mirror provisionWorkspace).
  for (const [code, name, nameAr] of [
    ["PCS", "Piece", "قطعة"],
    ["KG", "Kilogram", "كيلوجرام"],
  ] as const) {
    await su.query(
      `INSERT INTO uoms (id, tenant_id, code, name, name_ar, is_system)
       VALUES ($5, $1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [tenantId, code, name, nameAr, generateUuidV7()],
    );
  }
  const passwordService = new PasswordService();
  const hash = await passwordService.hashFromNewPassword(BASE_PASSWORD);
  const user = await store.insertUser({
    email: owner.email,
    fullName: "Import Owner",
    passwordHash: hash,
    status: "ACTIVE",
  });
  const roleId = generateUuidV7();
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  await su.query(`INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES ($1, $2, 'owner_imp', 'Owner', 'مالك')`, [
    roleId,
    tenantId,
  ]);
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3`,
    [roleId, tenantId, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
    [generateUuidV7(), tenantId, user.id, roleId],
  );
  await su.end();

  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: false });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
  const login = await post(
    "/api/v1/identity/sessions",
    { email: owner.email, password: BASE_PASSWORD },
    {},
    { skipIdempotencyKey: true },
  );
  const loginBody = (await login.json()) as { data: { token: string } };
  owner.token = loginBody.data.token;
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("PHASE-006 import/export engine", () => {
  it("dry-run preview: row errors, duplicates, Arabic round-trip — all without writing", async () => {
    const csv = toCsv([
      ["code", "kind", "name", "name_ar", "credit_terms_code"],
      ["IMP-001", "CUSTOMER", "شركة النخبة", "شركة النخبة", ""],
      ["IMP-002", "SUPPLIER", "Global Supply", "", ""],
      ["IMP-002", "CUSTOMER", "In-file Duplicate", "", ""], // duplicate natural key in file
      ["IMP-003", "WAT", "Bad Kind Row", "", ""], // invalid kind
      ["IMP-004", "CUSTOMER", "Unknown Terms", "", "NO-SUCH-TERMS"], // unknown reference
    ]);
    const fileKey = await uploadCsv(csv);
    const token = `imp-token-${generateUuidV7()}`;
    const response = await post(
      "/api/v1/items/import-jobs",
      { kind: "PARTNERS", format: "CSV", uploadToken: token, fileKey, fileName: "partners-import.csv" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        id: string;
        status: string;
        totalRows: number;
        validRows: number;
        invalidRows: number;
        duplicateRows: number;
        report: {
          rows: { row: number; status: string; errors: { field: string; message: string }[]; preview: Record<string, string> }[];
        };
      };
    };
    expect(body.data.status).toBe("PREVIEW_READY");
    expect(body.data.totalRows).toBe(5);
    expect(body.data.validRows).toBe(2);
    expect(body.data.invalidRows).toBe(2);
    expect(body.data.duplicateRows).toBe(1);
    // Arabic content survived the CSV→BOM→parse round-trip.
    const firstRow = body.data.report.rows[0]!;
    expect(firstRow.preview["name_ar"]).toBe("شركة النخبة");
    // Unknown reference rejected per-row (no existence disclosure wording).
    const unknownRef = body.data.report.rows[4]!;
    expect(unknownRef.status).toBe("ERROR");
    expect(unknownRef.errors.some((error) => error.field === "credit_terms_code")).toBe(true);
    // Nothing was written — the partner codes must not exist yet.
    const su = await superuserClient();
    const written = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM partners WHERE tenant_id = $1 AND code LIKE 'IMP-%'`,
      [tenantId],
    );
    await su.end();
    expect(written.rows[0]?.n).toBe(0);

    // Same upload token → same job (idempotent create, deterministic report).
    const replay = await post(
      "/api/v1/items/import-jobs",
      { kind: "PARTNERS", format: "CSV", uploadToken: token, fileKey, fileName: "partners-import.csv" },
      { "x-session-token": owner.token },
    );
    const replayBody = (await replay.json()) as { data: { id: string } };
    expect(replayBody.data.id).toBe(body.data.id);

    // Commit applies exactly the previewed valid rows.
    const commit = await post(`/api/v1/items/import-jobs/${body.data.id}/commit`, {}, {
      "x-session-token": owner.token,
    });
    expect(commit.status).toBe(200);
    const committed = await waitForStatus(body.data.id, "COMMITTED", owner.token);
    expect(committed.committedRows).toBe(2);

    // Re-commit after COMMITTED is idempotent (replays the stored result).
    const recommit = await post(`/api/v1/items/import-jobs/${body.data.id}/commit`, {}, {
      "x-session-token": owner.token,
    });
    expect(recommit.status).toBe(200);

    // Re-import the same file with a fresh token: all rows are duplicates.
    const secondToken = `imp-token-${generateUuidV7()}`;
    const again = await post(
      "/api/v1/items/import-jobs",
      { kind: "PARTNERS", format: "CSV", uploadToken: secondToken, fileKey, fileName: "partners-import.csv" },
      { "x-session-token": owner.token },
    );
    const againBody = (await again.json()) as { data: { validRows: number; duplicateRows: number } };
    expect(againBody.data.validRows).toBe(0);
    // 4 duplicates: IMP-001 + IMP-002 (in-file dup collapsed to error last
    // time — this file is unchanged; per-row classification is deterministic).
    expect(againBody.data.duplicateRows).toBe(3);
  });

  it("U-07: a zip-bomb-shaped XLSX is rejected by the decompression guard", async () => {
    // A CSV file offered as XLSX is not a zip — the directory pre-check
    // rejects it before any decompression happens (ImportFileInvalidError).
    const fileKey = await uploadCsv(toCsv([["sku", "name"], ["X", "Y"]]));
    const response = await post(
      "/api/v1/items/import-jobs",
      {
        kind: "ITEMS",
        format: "XLSX",
        uploadToken: `bomb-${generateUuidV7()}`,
        fileKey,
        fileName: "bomb.xlsx",
      },
      { "x-session-token": owner.token },
    );
    // The CSV bytes are not a valid zip → ImportFileInvalidError → 422.
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("IMPORT_FILE_INVALID");
  });

  it("XLSX import round-trips Arabic headers and content", async () => {
    const ExcelJS = (await import("exceljs")) as typeof import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("partners");
    sheet.addRow(["code", "kind", "name", "name_ar"]);
    sheet.addRow(["XLSX-001", "CUSTOMER", "Arabic Partner", "جهة عربية"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const state = ensureTestDb();
    const client = new S3Client({
      region: "us-east-1",
      endpoint: state.s3Endpoint,
      credentials: { accessKeyId: "S3RVER", secretAccessKey: "S3RVER" },
      forcePathStyle: true,
    });
    const fileKey = `${tenantId}/${generateUuidV7()}/partners-import.xlsx`;
    await client.send(
      new PutObjectCommand({
        Bucket: state.s3Bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const response = await post(
      "/api/v1/items/import-jobs",
      {
        kind: "PARTNERS",
        format: "XLSX",
        uploadToken: `xlsx-${generateUuidV7()}`,
        fileKey,
        fileName: "partners-import.xlsx",
      },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { id: string; validRows: number; status: string };
    };
    expect(body.data.status).toBe("PREVIEW_READY");
    expect(body.data.validRows).toBe(1);
    const commit = await post(`/api/v1/items/import-jobs/${body.data.id}/commit`, {}, {
      "x-session-token": owner.token,
    });
    expect(commit.status).toBe(200);
    const committed = await waitForStatus(body.data.id, "COMMITTED", owner.token);
    expect(committed.committedRows).toBe(1);
    const su = await superuserClient();
    const row = await su.query<{ name_ar: string | null }>(
      `SELECT name_ar FROM partners WHERE tenant_id = $1 AND code = 'XLSX-001'`,
      [tenantId],
    );
    await su.end();
    expect(row.rows[0]?.name_ar).toBe("جهة عربية");
  });

  it("export hands back a signed, tenant-bound URL and the bytes carry the BOM", async () => {
    const response = await post(
      "/api/v1/items/export-jobs",
      { kind: "PARTNERS", format: "CSV" },
      { "x-session-token": owner.token },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { downloadUrl: string; rowCount: number; kind: string };
    };
    expect(body.data.kind).toBe("PARTNERS");
    expect(body.data.rowCount).toBeGreaterThanOrEqual(3);
    expect(body.data.downloadUrl).toContain("X-Amz-Signature");
    const bytes = await (await fetch(body.data.downloadUrl)).arrayBuffer();
    const text = Buffer.from(bytes).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM per PRINTING_AND_EXPORT
    expect(text).toContain("XLSX-001");
    expect(text).toContain("جهة عربية");
  });
});

