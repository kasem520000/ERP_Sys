import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { FilesService } from "../../files/application/files.service";
import { InboxService } from "../../notifications/application/inbox-service";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { sealArtifact } from "../submissions/secret-artifact";
import { registerArtifactFile } from "../submissions/artifact-files";

/**
 * PHASE-023 T5 — e-invoicing certificate handling (SECRETS_MANAGEMENT §6,
 * S-10 HIGHEST):
 *
 * 1. Encrypted at rest: the PEM blob is SEALED (AES-256-GCM envelope) and
 *    stored through the files module under einvoicing/{jurisdiction}/{tenant}/
 *    paths; the DB row carries the PATH + metadata ONLY.
 * 2. Signing-job-only access: `useForSigning` is the ONLY read path for key
 *    material and it is called exclusively from the sign job context —
 *    there is NO API surface that returns key bytes (asserted by the §6
 *    handling tests: the API role cannot read key material).
 * 3. Usage audit: every decrypt/sign writes an
 *    e_invoicing_certificate_usage row (tenant, cert, submission, key
 *    version) + an audit event; sign_count/last_used_at feed the
 *    signing-volume dashboard.
 * 4. Expiry monitoring: evaluateExpiry walks ACTIVE certs and alerts at
 *    30/14/7 days (CertExpiry, MONITORING §3) with escalation recorded on
 *    the row (expires_alerted_at) so each threshold fires exactly once.
 * 5. Never in exports/backups: the sealed blob lives in the files store
 *    (excluded from tenant export packages by owner-type — export packs
 *    only PARTNER/ITEM attachments); offboarding purge removes cert paths
 *    (DATA_PROTECTION §4 step 6) — `purgeTenantCertificates`.
 *
 * Enrollment/rotation are admin TRIGGER workflows (approval-separated per
 * AUTHORIZATION_MATRIX): the endpoint enrolls metadata + the sealed blob
 * the platform admin supplies through the out-of-band authority process —
 * the platform never generates authority key material itself.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("certificate access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface CertificateRow {
  readonly id: string;
  readonly countryCode: string;
  readonly adapterId: string;
  readonly label: string;
  readonly keyVersion: string;
  readonly secretPath: string;
  readonly fingerprint: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly status: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | "REVOKED";
  readonly enrolledAt: string;
  readonly rotatedFromId: string | null;
  readonly signCount: number;
  readonly lastUsedAt: string | null;
}

const CERT_COLUMNS = sql`id, country_code AS "countryCode", adapter_id AS "adapterId", label,
  key_version AS "keyVersion", secret_path AS "secretPath", fingerprint,
  not_before::text AS "notBefore", not_after::text AS "notAfter", status,
  enrolled_at::text AS "enrolledAt", rotated_from_id::text AS "rotatedFromId",
  sign_count, last_used_at::text AS "lastUsedAt"`;

export class CertificateError extends DomainError {
  constructor(reason: string, details?: Readonly<Record<string, unknown>>) {
    super("tax/certificate", reason, details);
  }
}

/** The metadata list (admin surface): NO key material ever leaves. */
export async function listCertificates(): Promise<CertificateRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${CERT_COLUMNS} FROM e_invoicing_certificates
    ORDER BY enrolled_at DESC
  `);
  return rows.rows as unknown as CertificateRow[];
}

export async function findCertificate(id: string): Promise<CertificateRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${CERT_COLUMNS} FROM e_invoicing_certificates WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as CertificateRow[])[0];
  if (row === undefined) {
    throw new CertificateError(`certificate ${id} not found`);
  }
  return row;
}

export interface EnrollCertificateInput {
  readonly countryCode: string;
  readonly adapterId: string;
  readonly label: string;
  readonly keyVersion: string;
  /** The PEM blob supplied out-of-band (authority-issued). Sealed at rest. */
  readonly pem: string;
  readonly notBefore: string;
  readonly notAfter: string;
  readonly actorId: string;
  readonly rotatedFromId?: string | null;
}

/**
 * Enrollment (admin trigger, audited): seal the blob, persist through the
 * files module under einvoicing/{jurisdiction}/{tenant}/…, record the
 * metadata row. Rotation chains via rotatedFromId and marks the previous
 * cert REVOKED (the authority's re-enrollment process — SECRETS §6.4).
 */
export async function enrollCertificate(
  files: FilesService,
  input: EnrollCertificateInput,
): Promise<CertificateRow> {
  const tenantId = requireTenantContext().tenantId;
  if (new Date(input.notAfter).getTime() <= new Date(input.notBefore).getTime()) {
    throw new CertificateError("notAfter must be after notBefore");
  }
  const fingerprint = `sha256-${createHash("sha256").update(input.pem, "utf8").digest("hex").slice(0, 32)}`;
  const sealed = sealArtifact(Buffer.from(input.pem, "utf8"));
  const secretPath = `einvoicing/${input.countryCode.toLowerCase()}/${tenantId}/${input.keyVersion}`;
  const id = generateUuidV7();
  await registerArtifactFile(files, {
    tenantId,
    ownerType: "EINVOICING_CERT",
    ownerId: id,
    filename: `certificate-${input.keyVersion}.pem.sealed`,
    body: sealed,
  });
  const tx = tenantTx();
  // Rotation: the previous cert is REVOKED (never deleted — history).
  if (input.rotatedFromId !== undefined && input.rotatedFromId !== null) {
    await tx.execute(sql`
      UPDATE e_invoicing_certificates SET status = 'REVOKED', updated_at = now(), version = version + 1
      WHERE id = ${input.rotatedFromId} AND status IN ('ACTIVE', 'EXPIRING_SOON')
    `);
  }
  const rows = await tx.execute(sql`
    INSERT INTO e_invoicing_certificates (id, tenant_id, country_code, adapter_id, label,
      key_version, secret_path, fingerprint, not_before, not_after, status, enrolled_by, rotated_from_id)
    VALUES (${id}, erp.current_tenant_id(), ${input.countryCode}, ${input.adapterId}, ${input.label},
      ${input.keyVersion}, ${secretPath}, ${fingerprint}, ${input.notBefore}::timestamptz,
      ${input.notAfter}::timestamptz, 'ACTIVE', ${input.actorId}, ${input.rotatedFromId ?? null})
    RETURNING ${CERT_COLUMNS}
  `);
  const audit = new AuditService(new DrizzleAuditStore());
  await audit.record({
    action: "tax.einvoicing_certificate_enrolled",
    entityType: "e_invoicing_certificate",
    entityId: id,
    actorId: input.actorId,
    after: { adapterId: input.adapterId, keyVersion: input.keyVersion, fingerprint, rotatedFrom: input.rotatedFromId ?? null },
  });
  return (rows.rows as unknown as CertificateRow[])[0]!;
}

/**
 * The SIGNING-JOB-ONLY read path (SECRETS §6.2): decrypts the blob for a
 * signing operation, writes the usage row + audit event, and bumps the
 * volume counters. There is no API route that calls this — the §6 test
 * asserts the API surface exposes nothing that returns key material.
 */
export async function useForSigning(files: FilesService, input: {
  certificateId: string;
  submissionId: string;
}): Promise<{ pem: string; keyVersion: string }> {
  const cert = await findCertificate(input.certificateId);
  if (cert.status !== "ACTIVE" && cert.status !== "EXPIRING_SOON") {
    throw new CertificateError(`certificate ${cert.id} is ${cert.status} — signing refused`);
  }
  const tenantId = requireTenantContext().tenantId;
  const keyRows = await tenantTx().execute(sql`
    SELECT storage_key AS key FROM file_objects
    WHERE owner_type = 'EINVOICING_CERT' AND owner_id = ${cert.id} AND deleted_at IS NULL
    LIMIT 1
  `);
  const key = (keyRows.rows as unknown as { key: string }[])[0]?.key;
  if (key === undefined) {
    throw new CertificateError(`certificate ${cert.id} sealed blob is missing (store drift)`);
  }
  const { openArtifact } = await import("../submissions/secret-artifact");
  const bytes = await files.readObject(tenantId, key);
  const pem = openArtifact(bytes.body).toString("utf8");
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO e_invoicing_certificate_usage (id, tenant_id, certificate_id, submission_id,
      operation, key_version)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${cert.id}, ${input.submissionId}::uuid,
      'SIGN', ${cert.keyVersion})
  `);
  await tx.execute(sql`
    UPDATE e_invoicing_certificates SET sign_count = sign_count + 1, last_used_at = now(),
      updated_at = now(), version = version + 1 WHERE id = ${cert.id}
  `);
  const audit = new AuditService(new DrizzleAuditStore());
  await audit.record({
    action: "tax.einvoicing_certificate_used",
    entityType: "e_invoicing_certificate",
    entityId: cert.id,
    after: { submissionId: input.submissionId, keyVersion: cert.keyVersion, operation: "SIGN" },
  });
  return { pem, keyVersion: cert.keyVersion };
}

/** The signing-volume aggregate (dashboard): last 30 days per certificate. */
export async function signingVolume(): Promise<
  { certificateId: string; keyVersion: string; operations: number; lastUsedAt: string | null }[]
> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT c.id AS "certificateId", c.key_version AS "keyVersion",
      count(u.id)::int AS operations, max(u.used_at)::text AS "lastUsedAt"
    FROM e_invoicing_certificates c
    LEFT JOIN e_invoicing_certificate_usage u
      ON u.certificate_id = c.id AND u.used_at > now() - interval '30 days'
    GROUP BY c.id, c.key_version
    ORDER BY c.enrolled_at DESC
  `);
  return rows.rows as unknown as {
    certificateId: string;
    keyVersion: string;
    operations: number;
    lastUsedAt: string | null;
  }[];
}

/**
 * CertExpiry evaluation (MONITORING §3: 30/14/7-day alerts, Sev-3 → Sev-2
 * at 7): walks ACTIVE/EXPIRING_SOON certificates, flips EXPIRING_SOON
 * under 30 days and EXPIRED past the window, and fires each threshold's
 * inbox notification exactly once (expires_alerted_at bookkeeping). The
 * 7-day threshold escalates to critical.
 */
export async function evaluateExpiry(now: Date = new Date()): Promise<{
  checked: number;
  alerted: { certificateId: string; daysLeft: number; threshold: 30 | 14 | 7 }[];
}> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, label, status, not_after::text AS "notAfter",
      expires_alerted_at AS "alertedAt"
    FROM e_invoicing_certificates
    WHERE status IN ('ACTIVE', 'EXPIRING_SOON')
  `);
  const inbox = new InboxService();
  const alerted: { certificateId: string; daysLeft: number; threshold: 30 | 14 | 7 }[] = [];
  for (const cert of rows.rows as unknown as {
    id: string;
    label: string;
    status: string;
    notAfter: string;
    alertedAt: Record<string, unknown> | null;
  }[]) {
    // Integer ceiling division via the house pattern (cf. rate-limiter.ts):
    // Math.ceil is banned by the ADR-0009 floating-math lint rule.
    const msLeft = new Date(cert.notAfter).getTime() - now.getTime();
    const daysLeft = (msLeft + 86_400_000 - 1) / 86_400_000 | 0;
    const alertedAt = (cert.alertedAt ?? {}) as Record<string, boolean>;
    let nextStatus: string | null = null;
    if (daysLeft <= 0) {
      nextStatus = "EXPIRED";
    } else if (daysLeft <= 30 && cert.status === "ACTIVE") {
      nextStatus = "EXPIRING_SOON";
    }
    for (const threshold of [30, 14, 7] as const) {
      if (daysLeft <= threshold && daysLeft > 0 && alertedAt[String(threshold)] !== true) {
        await inbox.record({
          category: "einvoicing",
          severity: threshold === 7 ? "critical" : "warning",
          title: {
            ar: `شهادة فوترة إلكترونية تنتهي خلال ${threshold} يومًا`,
            en: `E-invoicing certificate expires within ${threshold} days`,
          },
          body: {
            ar: `الشهادة «${cert.label}» تنتهي بعد ${daysLeft} يومًا — جدّد عبر عملية إعادة القيد لدى الجهة`,
            en: `Certificate "${cert.label}" expires in ${daysLeft} days — renew through the authority re-enrollment process`,
          },
          actionUrl: `/settings/tax/einvoicing`,
          dedupeKey: `einvoicing:cert-expiry:${cert.id}:${threshold}`,
        });
        alertedAt[String(threshold)] = true;
        alerted.push({ certificateId: cert.id, daysLeft, threshold });
      }
    }
    await tx.execute(sql`
      UPDATE e_invoicing_certificates SET
        status = COALESCE(${nextStatus}::text, status),
        expires_alerted_at = ${JSON.stringify(alertedAt)}::jsonb,
        updated_at = now(), version = version + 1
      WHERE id = ${cert.id}
    `);
  }
  return { checked: rows.rows.length, alerted };
}

/**
 * Tenant offboarding purge (DATA_PROTECTION §4 step 6): certificate paths
 * + metadata rows are purged by the offboarding job. The sealed blobs are
 * tombstoned in the files store (deleted_at) — key material never survives
 * offboarding (SECRETS §6.6).
 */
export async function purgeTenantCertificates(): Promise<{ purged: number }> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, secret_path AS path FROM e_invoicing_certificates
  `);
  const certs = rows.rows as unknown as { id: string; path: string }[];
  if (certs.length === 0) {
    return { purged: 0 };
  }
  await tx.execute(sql`
    UPDATE file_objects SET deleted_at = now(), updated_at = now(), version = version + 1
    WHERE owner_type = 'EINVOICING_CERT' AND deleted_at IS NULL
  `);
  // Usage rows first (the FK), then the certificate rows — offboarding purges
  // the tenant's S-10 data completely (key material never survives).
  await tx.execute(sql`DELETE FROM e_invoicing_certificate_usage`);
  await tx.execute(sql`DELETE FROM e_invoicing_certificates`);
  const audit = new AuditService(new DrizzleAuditStore());
  await audit.record({
    action: "tax.einvoicing_certificates_purged",
    entityType: "e_invoicing_certificate",
    entityId: generateUuidV7(), // the purge is tenant-scoped, not row-scoped
    after: { purged: certs.length, paths: certs.map((cert) => cert.path) },
  });
  return { purged: certs.length };
}
