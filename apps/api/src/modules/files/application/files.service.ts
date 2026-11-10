import { Inject, Injectable } from "@nestjs/common";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { env } from "../../../config/env";

/**
 * Files application service (PHASE-002 §2.7): S3-compatible storage adapter
 * with signed URLs and upload constraints. No attachment UI yet — modules
 * receive URLs through this service. Keys are tenant-prefixed
 * (`${tenantId}/...`) so object storage inherits tenant scoping (A11).
 */
export interface UploadRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface IssuedUpload {
  key: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

/** Storage port; bound to the S3 adapter by FilesModule. */
export abstract class FilesStore {
  abstract presignPut(
    key: string,
    contentType: string,
    expiresInSeconds: number,
  ): Promise<string>;
  abstract presignGet(key: string, expiresInSeconds: number): Promise<string>;
  /** Server-side object read (PHASE-006 import/export usage). */
  abstract getObject(key: string): Promise<{ body: Buffer; contentType: string }>;
  /** Server-side object write (PHASE-006 export generation). */
  abstract putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void>;
  /** PHASE-024 T11: list every object key under a prefix (the purge). */
  abstract listPrefix(prefix: string): Promise<string[]>;
  /** PHASE-024 T11: bulk delete (the purge's storage wipe). */
  abstract deleteObjects(keys: string[]): Promise<void>;
}

export const FILES_STORE = Symbol("FILES_STORE");

export class UploadRejectedError extends DomainError {
  constructor(reason: string, details?: Readonly<Record<string, unknown>>) {
    super("files/upload-rejected", reason, details);
  }
}

export class CrossTenantObjectAccessError extends DomainError {
  constructor() {
    super(
      "files/cross-tenant-object",
      "Object keys are tenant-prefixed: access is confined to the issuing tenant (A11)",
    );
  }
}

/** Upload allow-list (§2.7 constraints): attachments the platform accepts. */
export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const MAX_FILENAME_LENGTH = 200;
const FILENAME_SAFE = /^[A-Za-z0-9._-]+$/;

@Injectable()
export class FilesService {
  constructor(@Inject(FILES_STORE) private readonly store: FilesStore) {}

  /**
   * Validate the request (size + type + filename), build a tenant-prefixed
   * object key, and issue a short-lived presigned PUT (A11: issuance carries
   * the session tenant; the key embeds it).
   */
  async issueUploadUrl(tenantId: string, request: UploadRequest): Promise<IssuedUpload> {
    if (!Number.isInteger(request.sizeBytes) || request.sizeBytes <= 0) {
      throw new UploadRejectedError("upload size must be a positive integer", {
        sizeBytes: request.sizeBytes,
      });
    }
    if (request.sizeBytes > env.MAX_UPLOAD_BYTES) {
      throw new UploadRejectedError(
        `upload exceeds the ${env.MAX_UPLOAD_BYTES}-byte ceiling`,
        { sizeBytes: request.sizeBytes, max: env.MAX_UPLOAD_BYTES },
      );
    }
    if (!ALLOWED_CONTENT_TYPES.has(request.contentType)) {
      throw new UploadRejectedError("content type is not allowed", {
        contentType: request.contentType,
      });
    }
    const safeName = sanitizeFilename(request.filename);
    if (safeName === undefined) {
      throw new UploadRejectedError("filename must be 1..200 chars of [A-Za-z0-9._-]", {
        filename: request.filename,
      });
    }
    const key = `${tenantId}/${generateUuidV7()}/${safeName}`;
    const uploadUrl = await this.store.presignPut(
      key,
      request.contentType,
      env.SIGNED_URL_TTL_SECONDS,
    );
    return { key, uploadUrl, expiresInSeconds: env.SIGNED_URL_TTL_SECONDS };
  }

  /**
   * Issue a download URL for an object owned by the tenant. A key outside
   * this tenant's prefix is rejected (A11: tenant A's URL can never fetch
   * tenant B's object).
   */
  async issueDownloadUrl(tenantId: string, key: string): Promise<string> {
    if (!key.startsWith(`${tenantId}/`)) {
      throw new CrossTenantObjectAccessError();
    }
    return this.store.presignGet(key, env.SIGNED_URL_TTL_SECONDS);
  }

  /**
   * Read an object owned by the tenant (PHASE-006 import worker + export
   * generation). Tenant-prefix check mirrors issueDownloadUrl (A11).
   */
  async readObject(
    tenantId: string,
    key: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    if (!key.startsWith(`${tenantId}/`)) {
      throw new CrossTenantObjectAccessError();
    }
    return this.store.getObject(key);
  }

  /** Write an object under the tenant prefix (PHASE-006 export files). */
  async writeObject(
    tenantId: string,
    filename: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string }> {
    const safeName = sanitizeFilename(filename);
    if (safeName === undefined) {
      throw new UploadRejectedError("filename must be 1..200 chars of [A-Za-z0-9._-]", {
        filename,
      });
    }
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new UploadRejectedError("content type is not allowed", { contentType });
    }
    const key = `${tenantId}/exports/${generateUuidV7()}/${safeName}`;
    await this.store.putObject(key, body, contentType);
    return { key };
  }

  /**
   * Write a SERVER-SIDE sealed artifact under the tenant prefix
   * (PHASE-023 e-invoicing payloads/responses/certificates — E_INVOICING
   * §6): `application/octet-stream` ciphertext, folder-scoped
   * (`einvoice_payload|einvoice_response|einvoicing_cert`). This path is
   * NEVER reachable from tenant uploads — the upload allow-list is not
   * widened; only server code holding the sealed bytes calls this (the
   * PHASE-006 export-write precedent).
   */
  async writeArtifact(
    tenantId: string,
    folder: string,
    filename: string,
    body: Buffer,
  ): Promise<string> {
    const safeName = sanitizeFilename(filename);
    if (safeName === undefined) {
      throw new UploadRejectedError("filename must be 1..200 chars of [A-Za-z0-9._-]", {
        filename,
      });
    }
    if (!/^[a-z0-9_]{4,40}$/.test(folder)) {
      throw new UploadRejectedError("artifact folder must be 4..40 chars of [a-z0-9_]", { folder });
    }
    const key = `${tenantId}/${folder}/${generateUuidV7()}/${safeName}`;
    await this.store.putObject(key, body, "application/octet-stream");
    return key;
  }

  /**
   * PHASE-024 T11: every object key under a prefix (the offboarding
   * purge's storage inventory — counted for the deletion certificate).
   */
  async listPrefix(prefix: string): Promise<string[]> {
    return this.store.listPrefix(prefix);
  }

  /** PHASE-024 T11: bulk storage delete (the purge's prefix wipe). */
  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.store.deleteObjects(keys);
    }
  }
}

/** Path-traversal-proof basename pass; undefined when the name is unusable. */
export function sanitizeFilename(filename: string): string | undefined {
  const trimmed = filename.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_FILENAME_LENGTH ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed === "." ||
    trimmed === ".." ||
    !FILENAME_SAFE.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}
