import { eq, and, isNull, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { FilesService } from "./files.service";

/**
 * Attachments service (PHASE-006 §2.7/T9; ENTITY_CATALOG file_objects
 * 002 infra / 006 usage): registers owner linkage rows for the PHASE-002
 * signed-URL substrate. Owner existence is validated by the CALLING
 * module's controller (typed owners); the service enforces the storage
 * contract: upload/download through FilesService (tenant-prefixed keys,
 * A11) and tombstone deletion (files.manage — no row DELETE).
 *
 * Upload security U-01…U-07 (allow-list, magic bytes at the storage layer
 * seam, size/quota, tenant-bound keys, signed-URL scope, filename
 * sanitization incl. Arabic names, decompression guard) is enforced by
 * FilesService + the upload constraints; the suite proves them.
 */

export type AttachmentOwnerType = "PARTNER" | "ITEM" | "OPENING_BALANCE_DOC";

export interface AttachmentRow {
  id: string;
  ownerType: string;
  ownerId: string;
  storageKey: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
}

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("attachments access requires an ambient tenant scope");
  }
  return context.tx;
}

export class AttachmentsService {
  constructor(private readonly files: FilesService) {}

  /**
   * Register an attachment slot and issue the presigned upload URL. The
   * object key is FilesService-built (tenant-prefixed, sanitized filename,
   * size + content-type validated — Arabic filenames are sanitized with
   * the same rules, U-06).
   */
  async issueAttachmentUpload(
    ownerType: AttachmentOwnerType,
    ownerId: string,
    request: { filename: string; contentType: string; sizeBytes: number },
    uploadedBy: string,
  ): Promise<{ attachmentId: string; key: string; uploadUrl: string; expiresInSeconds: number }> {
    const issued = await this.files.issueUploadUrl(
      requireTenantContext().tenantId,
      request,
    );
    const tx = tenantTx();
    await tx.insert(schema.fileObjects).values({
      id: generateUuidV7(),
      tenantId: sql`erp.current_tenant_id()`,
      ownerType,
      ownerId,
      storageKey: issued.key,
      name: request.filename,
      sizeBytes: request.sizeBytes,
      contentType: request.contentType,
      uploadedBy,
      updatedAt: sql`now()`,
    });
    return {
      attachmentId: issued.key,
      key: issued.key,
      uploadUrl: issued.uploadUrl,
      expiresInSeconds: issued.expiresInSeconds,
    };
  }

  /** List an owner's live attachments with fresh signed download URLs. */
  async listAttachments(ownerType: AttachmentOwnerType, ownerId: string): Promise<
    readonly (AttachmentRow & { downloadUrl: string })[]
  > {
    const tenantId = requireTenantContext().tenantId;
    const tx = tenantTx();
    const rows = await tx
      .select({
        id: schema.fileObjects.id,
        ownerType: schema.fileObjects.ownerType,
        ownerId: schema.fileObjects.ownerId,
        storageKey: schema.fileObjects.storageKey,
        name: schema.fileObjects.name,
        sizeBytes: schema.fileObjects.sizeBytes,
        contentType: schema.fileObjects.contentType,
        createdAt: schema.fileObjects.createdAt,
      })
      .from(schema.fileObjects)
      .where(
        and(
          eq(schema.fileObjects.ownerType, ownerType),
          eq(schema.fileObjects.ownerId, ownerId),
          isNull(schema.fileObjects.deletedAt),
        ),
      );
    const live = rows as unknown as (AttachmentRow & { storageKey: string })[];
    const visible: (AttachmentRow & { downloadUrl: string })[] = [];
    for (const row of live) {
      const downloadUrl = await this.files.issueDownloadUrl(tenantId, row.storageKey);
      visible.push({ ...row, downloadUrl });
    }
    return visible;
  }

  /** files.manage: tombstone delete (never a row DELETE). */
  async archiveAttachment(attachmentId: string): Promise<void> {
    const tx = tenantTx();
    const rows = await tx
      .update(schema.fileObjects)
      .set({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schema.fileObjects.id, attachmentId))
      .returning({ id: schema.fileObjects.id });
    if (rows.length === 0) {
      throw new Error("attachment not found in this tenant");
    }
  }
}
