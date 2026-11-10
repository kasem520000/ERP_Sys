import { describe, expect, it } from "vitest";

import {
  ALLOWED_CONTENT_TYPES,
  CrossTenantObjectAccessError,
  FilesService,
  FilesStore,
  UploadRejectedError,
} from "./files.service";

/** Deterministic fake store: returns the key inside the "signed" URL. */
class FakeStore extends FilesStore {
  presignPut(key: string): Promise<string> {
    return Promise.resolve(`https://files.example/${key}?sig=put`);
  }
  presignGet(key: string): Promise<string> {
    return Promise.resolve(`https://files.example/${key}?sig=get`);
  }
  getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    return Promise.resolve({ body: Buffer.from(`bytes:${key}`), contentType: "text/csv" });
  }
  putObject(): Promise<void> {
    return Promise.resolve();
  }
  listPrefix(): Promise<string[]> {
    return Promise.resolve([]);
  }
  deleteObjects(): Promise<void> {
    return Promise.resolve();
  }
}

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

function service(): FilesService {
  return new FilesService(new FakeStore());
}

describe("FilesService constraints (PHASE-002 §2.7)", () => {
  it("issues a tenant-prefixed key with a UUIDv7 segment and signed URL", async () => {
    const issued = await service().issueUploadUrl(TENANT_A, {
      filename: "invoice.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });
    expect(issued.key.startsWith(`${TENANT_A}/`)).toBe(true);
    const segments = issued.key.split("/");
    expect(segments[1]).toMatch(
      // UUIDv7: unix-ts-ms high bits + version nibble 7 + RFC variant
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(segments.at(-1)).toBe("invoice.pdf");
    expect(issued.uploadUrl).toContain(`files.example/${issued.key}`);
    expect(issued.expiresInSeconds).toBeGreaterThan(0);
  });

  it("rejects oversized uploads with the documented ceiling", async () => {
    await expect(
      service().issueUploadUrl(TENANT_A, {
        filename: "huge.bin",
        contentType: "application/pdf",
        sizeBytes: 25 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ code: "files/upload-rejected" });
  });

  it("rejects non-positive sizes and disallowed content types", async () => {
    await expect(
      service().issueUploadUrl(TENANT_A, {
        filename: "a.pdf",
        contentType: "application/pdf",
        sizeBytes: 0,
      }),
    ).rejects.toBeInstanceOf(UploadRejectedError);
    await expect(
      service().issueUploadUrl(TENANT_A, {
        filename: "a.exe",
        contentType: "application/x-msdownload",
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: "files/upload-rejected" });
    expect(ALLOWED_CONTENT_TYPES.has("application/pdf")).toBe(true);
  });

  it("rejects unsafe filenames (traversal, separators, control chars)", async () => {
    for (const filename of ["../escape.pdf", "a/b.pdf", "b\\c.pdf", "", "."]) {
      await expect(
        service().issueUploadUrl(TENANT_A, {
          filename,
          contentType: "application/pdf",
          sizeBytes: 10,
        }),
      ).rejects.toBeInstanceOf(UploadRejectedError);
    }
  });

  it("A11: download URLs stay confined to the issuing tenant's prefix", async () => {
    const files = service();
    const issued = await files.issueUploadUrl(TENANT_A, {
      filename: "doc.pdf",
      contentType: "application/pdf",
      sizeBytes: 10,
    });
    const url = await files.issueDownloadUrl(TENANT_A, issued.key);
    expect(url).toContain(issued.key);
    await expect(files.issueDownloadUrl(TENANT_B, issued.key)).rejects.toBeInstanceOf(
      CrossTenantObjectAccessError,
    );
  });
});
