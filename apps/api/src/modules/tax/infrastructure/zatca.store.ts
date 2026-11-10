import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-037 T-03 · the ZATCA Phase-1 store: the ONLY writer of
 * zatca_devices and of the sales_invoices chain columns (zatca_device_id,
 * icv, previous_invoice_hash, invoice_hash, invoice_hash_version,
 * qr_payload). Every statement runs in the caller's tenant UoW
 * (stores-before pattern) so a mint failure rolls the whole invoice post
 * back — a chain stamp is never a partial write (INV-027).
 *
 * Minting discipline: `mintInvoiceStamp` reads the device row
 * FOR UPDATE (serialize concurrent posts on one device), increments
 * icv_counter, computes the PIH from the predecessor row by ICV, and
 * updates the invoice — the partial unique (tenant, device, icv) is the
 * DB-level backstop for any race the row lock somehow misses.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("zatca access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- devices -------------------------------------------------------------------------

export interface ZatcaDeviceRow {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly name: string;
  readonly nameAr: string | null;
  readonly deviceUuid: string | null;
  readonly deviceSerial: string | null;
  readonly solutionProviderName: string | null;
  readonly solutionProviderVat: string | null;
  readonly registrationStatus: string;
  readonly icvCounter: number;
  readonly branchId: string | null;
  readonly note: string | null;
}

const DEVICE_COLUMNS = sql`id, created_at AS "createdAt", updated_at AS "updatedAt", version,
  name, name_ar AS "nameAr", device_uuid AS "deviceUuid", device_serial AS "deviceSerial",
  solution_provider_name AS "solutionProviderName", solution_provider_vat AS "solutionProviderVat",
  registration_status AS "registrationStatus", icv_counter AS "icvCounter",
  branch_id AS "branchId", note`;

export async function insertZatcaDevice(input: {
  name: string;
  nameAr: string | null;
  deviceUuid: string | null;
  deviceSerial: string | null;
  solutionProviderName: string | null;
  solutionProviderVat: string | null;
  branchId: string | null;
  note: string | null;
  actorId: string | null;
}): Promise<ZatcaDeviceRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO zatca_devices (id, tenant_id, name, name_ar, device_uuid, device_serial,
                               solution_provider_name, solution_provider_vat,
                               registration_status, icv_counter, branch_id, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.name}, ${input.nameAr}, ${input.deviceUuid},
            ${input.deviceSerial}, ${input.solutionProviderName}, ${input.solutionProviderVat},
            'NOT_REGISTERED', 0, ${input.branchId}, ${input.note}, ${input.actorId})
  `);
  return (await findZatcaDeviceById(id))!;
}

export async function findZatcaDeviceById(id: string): Promise<ZatcaDeviceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DEVICE_COLUMNS} FROM zatca_devices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ZatcaDeviceRow[])[0];
}

export async function listZatcaDevices(filter: {
  registrationStatus?: string;
  limit: number;
}): Promise<ZatcaDeviceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DEVICE_COLUMNS} FROM zatca_devices
    WHERE (${filter.registrationStatus ?? null}::text IS NULL
            OR registration_status = ${filter.registrationStatus ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ZatcaDeviceRow[];
}

/**
 * Update the solution-provider placeholder fields / descriptive columns.
 * Registration status is deliberately NOT writable here: Phase-1 never
 * registers (BR-061) — the column is the documented Phase-2 placeholder.
 */
export async function updateZatcaDevice(input: {
  id: string;
  name?: string | null;
  nameAr?: string | null;
  deviceUuid?: string | null;
  deviceSerial?: string | null;
  solutionProviderName?: string | null;
  solutionProviderVat?: string | null;
  branchId?: string | null;
  note?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE zatca_devices SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = ${input.nameAr === undefined ? sql`name_ar` : sql`${input.nameAr}`},
      device_uuid = ${input.deviceUuid === undefined ? sql`device_uuid` : sql`${input.deviceUuid}`},
      device_serial = ${input.deviceSerial === undefined ? sql`device_serial` : sql`${input.deviceSerial}`},
      solution_provider_name = ${input.solutionProviderName === undefined ? sql`solution_provider_name` : sql`${input.solutionProviderName}`},
      solution_provider_vat = ${input.solutionProviderVat === undefined ? sql`solution_provider_vat` : sql`${input.solutionProviderVat}`},
      branch_id = ${input.branchId === undefined ? sql`branch_id` : sql`${input.branchId}`},
      note = ${input.note === undefined ? sql`note` : sql`${input.note}`},
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- chain reads ---------------------------------------------------------------------

export interface InvoiceChainRow {
  readonly id: string;
  readonly invoiceNo: string | null;
  readonly invoiceDate: string;
  readonly postedAt: string | null;
  readonly status: string;
  readonly currencyCode: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
  readonly classification: string | null;
  readonly zatcaDeviceId: string | null;
  readonly icv: number | null;
  readonly previousInvoiceHash: string | null;
  readonly invoiceHash: string | null;
  readonly invoiceHashVersion: string | null;
  readonly qrPayload: string | null;
}

/**
 * The device's stamped invoices in ICV order — the verification walk and
 * the backfill share this read. Ordering: ICV ASC (the mint order); the
 * backfill path orders by issuance (posted_at, created_at, id) instead.
 */
export async function listDeviceChain(deviceId: string): Promise<InvoiceChainRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, invoice_no AS "invoiceNo", invoice_date::text AS "invoiceDate",
           to_char(posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "postedAt",
           status, currency_code AS "currencyCode",
           total_net::text AS "totalNet", total_tax::text AS "totalTax",
           total_gross::text AS "totalGross", classification,
           zatca_device_id AS "zatcaDeviceId", icv,
           previous_invoice_hash AS "previousInvoiceHash", invoice_hash AS "invoiceHash",
           invoice_hash_version AS "invoiceHashVersion", qr_payload AS "qrPayload"
    FROM sales_invoices
    WHERE zatca_device_id = ${deviceId} AND icv IS NOT NULL
    ORDER BY icv
  `);
  return rows.rows as unknown as InvoiceChainRow[];
}

/**
 * All POSTED invoices not yet stamped, tenant-wide, in ISSUANCE order
 * (posted_at, created_at, id — the deterministic tie-breaker, phase §7
 * risk 3). The backfill stamps these in order so the resulting ICV
 * sequence matches the issue order.
 */
export async function listUnstampedPostedInvoicesTenantWide(limit: number): Promise<
  {
    readonly id: string;
    readonly branchId: string;
    readonly invoiceNo: string | null;
    readonly invoiceDate: string;
    readonly postedAt: string | null;
    readonly createdAt: string;
    readonly currencyCode: string;
    readonly totalNet: string;
    readonly totalTax: string;
    readonly totalGross: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", invoice_no AS "invoiceNo",
           invoice_date::text AS "invoiceDate",
           to_char(posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "postedAt",
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
           currency_code AS "currencyCode",
           total_net::text AS "totalNet", total_tax::text AS "totalTax",
           total_gross::text AS "totalGross"
    FROM sales_invoices
    WHERE status = 'POSTED' AND icv IS NULL
    ORDER BY posted_at NULLS LAST, created_at, id
    LIMIT ${limit}
  `);
  return rows.rows as unknown as {
    id: string;
    branchId: string;
    invoiceNo: string | null;
    invoiceDate: string;
    postedAt: string | null;
    createdAt: string;
    currencyCode: string;
    totalNet: string;
    totalTax: string;
    totalGross: string;
  }[];
}

// -- minting -------------------------------------------------------------------------

export interface MintResult {
  readonly icv: number;
  readonly previousInvoiceHash: string;
}

/**
 * Atomically reserve the next ICV for the device and return the PIH:
 * the device row is locked FOR UPDATE (per-device serialization), the
 * counter increments, and the predecessor's stored hash becomes the
 * PIH (GENESIS_PIH when the chain is empty). The caller computes the
 * digest + payload from the minted counter and writes the stamp with
 * `writeInvoiceStamp` — all inside the caller's transaction.
 */
export async function reserveNextIcv(deviceId: string): Promise<MintResult> {
  const rows = await tenantTx().execute(sql`
    WITH locked AS (
      SELECT icv_counter FROM zatca_devices WHERE id = ${deviceId} FOR UPDATE
    ), bumped AS (
      UPDATE zatca_devices SET icv_counter = icv_counter + 1, updated_at = now(), version = version + 1
      WHERE id = ${deviceId}
      RETURNING icv_counter
    ), predecessor AS (
      SELECT invoice_hash FROM sales_invoices
      WHERE zatca_device_id = ${deviceId} AND icv = (SELECT icv_counter FROM bumped) - 1
        AND invoice_hash IS NOT NULL
      ORDER BY icv DESC LIMIT 1
    )
    SELECT (SELECT icv_counter FROM bumped) AS icv,
           COALESCE((SELECT invoice_hash FROM predecessor LIMIT 1), ${""}::text) AS predecessor_hash
  `);
  const row = (rows.rows as unknown as { icv: number; predecessor_hash: string | null }[])[0];
  return {
    icv: Number(row!.icv),
    previousInvoiceHash: row!.predecessor_hash ?? "",
  };
}

/** Write the computed stamp onto the invoice (the mint's second half). */
export async function writeInvoiceStamp(input: {
  invoiceId: string;
  deviceId: string;
  icv: number;
  previousInvoiceHash: string;
  invoiceHash: string;
  invoiceHashVersion: string;
  qrPayload: string;
  classification: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_invoices SET
      zatca_device_id = ${input.deviceId},
      icv = ${input.icv},
      previous_invoice_hash = ${input.previousInvoiceHash},
      invoice_hash = ${input.invoiceHash},
      invoice_hash_version = ${input.invoiceHashVersion},
      qr_payload = ${input.qrPayload},
      classification = ${input.classification},
      updated_at = now(), version = version + 1
    WHERE id = ${input.invoiceId}
  `);
}

/**
 * Set/clear the classification alone (create-time capture; the stamp
 * overwrites it coherently at post).
 */
export async function updateInvoiceClassification(input: {
  invoiceId: string;
  classification: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_invoices SET classification = ${input.classification}, updated_at = now(), version = version + 1
    WHERE id = ${input.invoiceId}
  `);
}

/** The stamped invoice rows for a document set (the report's batched read). */
export async function listInvoiceStamps(invoiceIds: readonly string[]): Promise<
  Map<
    string,
    {
      readonly invoiceId: string;
      readonly deviceId: string | null;
      readonly deviceName: string | null;
      readonly icv: number | null;
      readonly previousInvoiceHash: string | null;
      readonly invoiceHash: string | null;
      readonly qrPresent: boolean;
    }
  >
> {
  if (invoiceIds.length === 0) {
    return new Map();
  }
  const idList = sql.join(
    invoiceIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT v.id AS "invoiceId", v.zatca_device_id AS "deviceId", d.name AS "deviceName", v.icv,
           v.previous_invoice_hash AS "previousInvoiceHash",
           v.invoice_hash AS "invoiceHash",
           (v.qr_payload IS NOT NULL) AS "qrPresent"
    FROM sales_invoices v
    LEFT JOIN zatca_devices d ON d.id = v.zatca_device_id AND d.tenant_id = v.tenant_id
    WHERE v.id IN (${idList})
  `);
  const map = new Map<
    string,
    {
      invoiceId: string;
      deviceId: string | null;
      deviceName: string | null;
      icv: number | null;
      previousInvoiceHash: string | null;
      invoiceHash: string | null;
      qrPresent: boolean;
    }
  >();
  for (const row of rows.rows as unknown as {
    invoiceId: string;
    deviceId: string | null;
    deviceName: string | null;
    icv: number | null;
    previousInvoiceHash: string | null;
    invoiceHash: string | null;
    qrPresent: boolean;
  }[]) {
    map.set(row.invoiceId, row);
  }
  return map;
}
