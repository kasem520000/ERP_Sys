import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { FilesService } from "../../files/application/files.service";

/**
 * PHASE-023 T1 — submission artifact files (E_INVOICING §6): the sealed
 * payload/response bytes persist through the files module with owner rows
 * (`EINVOICE_PAYLOAD` / `EINVOICE_RESPONSE` — the file_objects owner CHECK
 * widened by migration 0035). Reads go back through the tenant-scoped
 * signed-URL path; the ciphertext NEVER carries key material around in
 * SQL payloads.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("artifact file access requires an ambient tenant scope");
  }
  return context.tx;
}

export type ArtifactOwnerType = "EINVOICE_PAYLOAD" | "EINVOICE_RESPONSE" | "EINVOICING_CERT";

/**
 * Write sealed artifact bytes under the tenant prefix and register the
 * owner row. Content type is `application/octet-stream` (a sealed envelope,
 * not tenant-uploadable — the upload allow-list is NOT widened; this path
 * is server-side only, like the PHASE-006 export writes).
 */
export async function registerArtifactFile(
  files: FilesService,
  input: {
    tenantId: string;
    ownerType: ArtifactOwnerType;
    ownerId: string;
    filename: string;
    body: Buffer;
  },
): Promise<string> {
  const key = await files.writeArtifact(input.tenantId, input.ownerType.toLowerCase(), input.filename, input.body);
  const id = generateUuidV7();
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO file_objects (id, tenant_id, owner_type, owner_id, storage_key, name,
      size_bytes, content_type, uploaded_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.ownerType}, ${input.ownerId}::uuid,
      ${key}, ${input.filename}, ${input.body.length}, 'application/octet-stream', NULL)
  `);
  return id;
}

/** Resolve an artifact file's storage key (the registry's read path). */
export async function findFileStorageKey(fileId: string): Promise<string> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT storage_key AS key FROM file_objects
    WHERE id = ${fileId} AND deleted_at IS NULL LIMIT 1
  `);
  const row = (rows.rows as unknown as { key: string }[])[0];
  if (row === undefined) {
    throw new Error(`artifact file ${fileId} not found`);
  }
  return row.key;
}
