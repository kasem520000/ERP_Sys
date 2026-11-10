import { beforeAll, describe, expect, it } from "vitest";

import {
  FilesService,
  CrossTenantObjectAccessError,
} from "../modules/files/application/files.service";
import { S3FilesStore } from "../modules/files/infrastructure/s3-files.store";
import { ensureTestDb, TENANT_A, TENANT_B } from "./test-db";

/**
 * Files module against the s3rver-backed S3-compatible endpoint (PHASE-002
 * §2.7): constraint enforcement is unit-tested; here the SIGNED URLs are
 * exercised end-to-end — upload through the issued URL, download back the
 * exact bytes, A11 cross-tenant confinement, and the signed-URL expiry
 * parameter contract.
 */

const PAYLOAD = "PHASE-002 files test payload";

describe("files module (S3 adapter + signed URLs)", () => {
  let files: FilesService;

  beforeAll(() => {
    ensureTestDb();
    files = new FilesService(new S3FilesStore());
  });

  it("issue → PUT via signed URL → GET via signed URL → identical bytes", async () => {
    const issued = await files.issueUploadUrl(TENANT_A, {
      filename: "round-trip.txt",
      contentType: "text/csv",
      sizeBytes: PAYLOAD.length,
    });
    const put = await fetch(issued.uploadUrl, {
      method: "PUT",
      body: PAYLOAD,
      headers: { "content-type": "text/csv" },
    });
    expect(put.status).toBe(200);

    const getUrl = await files.issueDownloadUrl(TENANT_A, issued.key);
    const downloaded = await fetch(getUrl);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe(PAYLOAD);
  });

  it("A11: another tenant cannot obtain a download URL for this tenant's key", async () => {
    const issued = await files.issueUploadUrl(TENANT_A, {
      filename: "private.txt",
      contentType: "text/csv",
      sizeBytes: PAYLOAD.length,
    });
    await expect(files.issueDownloadUrl(TENANT_B, issued.key)).rejects.toBeInstanceOf(
      CrossTenantObjectAccessError,
    );
  });

  it("signed URLs carry the expiry parameter (X-Amz-Expires) and stay unguessable", async () => {
    const issued = await files.issueUploadUrl(TENANT_A, {
      filename: "expiry.txt",
      contentType: "text/csv",
      sizeBytes: 4,
    });
    const url = new URL(issued.uploadUrl);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(issued.expiresInSeconds));
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
    // The key path embeds the tenant prefix + uuidv7 segment (A11 substrate).
    expect(url.pathname.startsWith(`/${process.env.S3_BUCKET}/${TENANT_A}/`)).toBe(true);
  });

  it("expired signed URLs are rejected by the storage server", async () => {
    const issued = await files.issueUploadUrl(TENANT_A, {
      filename: "expired.txt",
      contentType: "text/csv",
      sizeBytes: 4,
    });
    // Tamper the expiry to a negative window: the server must refuse.
    const tampered = new URL(issued.uploadUrl);
    tampered.searchParams.set("X-Amz-Expires", "-1");
    const response = await fetch(tampered, {
      method: "PUT",
      body: "x",
      headers: { "content-type": "text/csv" },
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
