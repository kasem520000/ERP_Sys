import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../../audit/api/audit";
import {
  ZatcaChainBrokenError,
  ZatcaClassificationInvalidError,
  ZatcaDeviceNotFoundError,
  ZatcaQrPayloadRequiredError,
} from "../../domain/zatca/zatca-errors";
import { findTaxRegistrationByCountry, findTenantCountry } from "../../infrastructure/tax.store";
import * as store from "../../infrastructure/zatca.store";
import type { InvoiceChainRow, ZatcaDeviceRow } from "../../infrastructure/zatca.store";
import { INVOICE_HASH_SPEC_VERSION, GENESIS_PIH, invoiceHash } from "./hash-chain";
import { encodeZatcaQrPayload, type ZatcaQrFields } from "./tlv";

/**
 * PHASE-037 · the ZATCA Phase-1 GENERATION service — pure computation +
 * local persistence, ZERO external calls (the audit verdict this phase
 * implements: "Phase 1 (QR) needs no outside access"). Three duties:
 *
 *   1. DEVICE REGISTRY — create/view EIAS device rows. Registration is
 *      the honest NOT_REGISTERED placeholder (BR-061): the Phase-2 CSID
 *      lifecycle is a typed NOT_IMPLEMENTED surface (PHASE-054).
 *
 *   2. STAMPING — inside the invoice post transaction: mint the device's
 *      next ICV (FOR UPDATE serialization), link PIH to the predecessor's
 *      stored hash (GENESIS_PIH for the first invoice), compute the
 *      invoice hash (v1 marker) and the TLV-base64 QR payload, and write
 *      the stamp. A stamp failure rolls the post back — never a partial
 *      chain (INV-027).
 *
 *   3. VERIFICATION + BACKFILL — re-walk a device's chain (re-derive
 *      every digest, check ICV monotonicity + PIH links, fail closed on
 *      tamper) and backfill history in issuance order (dry-run first,
 *      idempotent, resumable — stamped rows are skipped on re-run).
 *
 * BR-060 (fail-closed): a KSA-VAT tenant cannot issue or print a
 * SIMPLIFIED invoice without a QR payload. The post guard runs here; the
 * print guard runs in the receipt service. "KSA-VAT tenant" = the
 * tenant's country is SA AND its SA tax registration is REGISTERED —
 * tenants outside the VAT regime are untouched by the guard (and by
 * stamping, which is opt-in per device).
 */

export type InvoiceClassification = "STANDARD" | "SIMPLIFIED";

/** The QR field vector for one invoice (the seller + money facts). */
interface InvoiceQrSource {
  readonly invoiceId: string;
  readonly invoiceNo: string | null;
  readonly invoiceDate: string;
  readonly postedAt: string | null;
  readonly status: string;
  readonly currencyCode: string;
  readonly totalNet: string;
  readonly totalTax: string;
  readonly totalGross: string;
}

/** The stamp computed for one invoice, ready to persist. */
export interface InvoiceStamp {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly icv: number;
  readonly previousInvoiceHash: string;
  readonly invoiceHash: string;
  readonly invoiceHashVersion: string;
  readonly qrPayload: string;
  readonly classification: InvoiceClassification;
}

const DEVICE_LIMIT = 200;
const CHAIN_LIMIT = 50_000;

@Injectable()
export class ZatcaPhase1Service {
  /**
   * Optional injection (the SalesInvoiceService pattern — explicit
   * @Inject because the vitest/esbuild pipeline does not emit
   * design:paramtypes; the 20+ specs constructing that service manually
   * keep working with the standalone fallback below).
   */
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- devices -----------------------------------------------------------------------

  async createDevice(input: {
    name: string;
    nameAr?: string | null;
    deviceUuid?: string | null;
    deviceSerial?: string | null;
    solutionProviderName?: string | null;
    solutionProviderVat?: string | null;
    branchId?: string | null;
    note?: string | null;
    actorId: string | null;
  }): Promise<ZatcaDeviceRow> {
    const device = await store.insertZatcaDevice({
      name: input.name,
      nameAr: input.nameAr ?? null,
      deviceUuid: input.deviceUuid ?? null,
      deviceSerial: input.deviceSerial ?? null,
      solutionProviderName: input.solutionProviderName ?? null,
      solutionProviderVat: input.solutionProviderVat ?? null,
      branchId: input.branchId ?? null,
      note: input.note ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "tax.zatca_device_created",
      entityType: "zatca_device",
      entityId: device.id,
      actorId: input.actorId ?? undefined,
      after: { name: device.name, registrationStatus: device.registrationStatus },
    });
    return device;
  }

  async listDevices(filter: { registrationStatus?: string; limit?: number }) {
    return store.listZatcaDevices({
      registrationStatus: filter.registrationStatus,
      limit: Math.min(filter.limit ?? DEVICE_LIMIT, DEVICE_LIMIT),
    });
  }

  async findDevice(id: string): Promise<ZatcaDeviceRow> {
    const device = await store.findZatcaDeviceById(id);
    if (device === undefined) throw new ZatcaDeviceNotFoundError(id);
    return device;
  }

  async updateDevice(input: {
    id: string;
    name?: string | null;
    nameAr?: string | null;
    deviceUuid?: string | null;
    deviceSerial?: string | null;
    solutionProviderName?: string | null;
    solutionProviderVat?: string | null;
    branchId?: string | null;
    note?: string | null;
    actorId: string | null;
  }): Promise<ZatcaDeviceRow> {
    await this.findDevice(input.id);
    // BR-061: the device_uuid/serial may only be shaped, never claimed as
    // registered — the status column stays NOT_REGISTERED in Phase-1.
    await store.updateZatcaDevice({
      id: input.id,
      name: input.name ?? null,
      nameAr: input.nameAr,
      deviceUuid: input.deviceUuid,
      deviceSerial: input.deviceSerial,
      solutionProviderName: input.solutionProviderName,
      solutionProviderVat: input.solutionProviderVat,
      branchId: input.branchId,
      note: input.note,
    });
    await this.audit.record({
      action: "tax.zatca_device_updated",
      entityType: "zatca_device",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: { registrationStatus: "NOT_REGISTERED", note: "Phase-1 placeholder" },
    });
    return this.findDevice(input.id);
  }

  // -- stamping ----------------------------------------------------------------------

  /**
   * The issuing device for an invoice: the branch-bound device wins,
   * then the oldest tenant device (single-device tenants). No device →
   * null — stamping is opt-in (a tenant without EIAS devices never
   * stamps and the BR-060 guard decides below).
   */
  private async resolveIssuingDevice(branchId: string): Promise<ZatcaDeviceRow | null> {
    const devices = await store.listZatcaDevices({ limit: DEVICE_LIMIT });
    if (devices.length === 0) return null;
    const bound = devices.find((device) => device.branchId === branchId);
    return bound ?? devices[devices.length - 1]!;
  }

  /** The seller VAT registration number for the QR (REGISTERED SA row). */
  private async sellerVatNumber(countryCode: string): Promise<string | null> {
    const registration = await findTaxRegistrationByCountry(countryCode);
    return registration !== undefined &&
      registration.status === "REGISTERED" &&
      registration.registrationNumber !== null
      ? registration.registrationNumber
      : null;
  }

  /**
   * "KSA-VAT tenant" (the BR-060 subject): tenant country SA + an
   * SA REGISTERED registration. Resolved once per invoice operation.
   */
  async isKsaVatTenant(): Promise<boolean> {
    const { requireTenantContext } = await import("../../../../infra/db/tenant-context");
    const country = (await findTenantCountry(requireTenantContext().tenantId)) ?? "SA";
    if (country !== "SA") return false;
    return (await this.sellerVatNumber("SA")) !== null;
  }

  /**
   * Build the five mandated QR fields for a posted invoice. The seller
   * name is the tenant's (Arabic-first); the VAT number comes from the
   * SA registration; the timestamp is the ISSUE instant (posted_at,
   * ISO-8601 Z); the amounts are the document's canonical 19,4 strings.
   * REQUIRES_VERIFICATION note (phase §7): non-SAR invoice currencies
   * carry their document amounts verbatim — the currency-conversion
   * semantics resolve with UBL 2.1 in PHASE-054.
   */
  async buildQrFields(input: {
    invoice: InvoiceQrSource;
    sellerVatRegistrationNumber: string;
    sellerName: string;
  }): Promise<ZatcaQrFields> {
    if (input.invoice.postedAt === null) {
      throw new ZatcaQrPayloadRequiredError({
        invoiceId: input.invoice.invoiceId,
        surface: "post",
        classification: "unposted",
      });
    }
    const timestamp = new Date(input.invoice.postedAt)
      .toISOString()
      .replace(/\.\d+Z$/, "Z");
    return encodeQrFields({
      sellerName: input.sellerName,
      vatRegistrationNumber: input.sellerVatRegistrationNumber,
      timestamp,
      invoiceTotal: input.invoice.totalGross,
      vatTotal: input.invoice.totalTax,
    });
  }

  /**
   * The post-time stamp step (called by the sales invoice service INSIDE
   * the post transaction, after the numbering bind). Returns null when
   * the tenant is NOT ENROLLED (no EIAS device — Phase-1 is opt-in via
   * the device registry; unenrolled tenants keep their exact pre-037
   * behavior). BR-060 engages WITH enrollment: an enrolled KSA-VAT
   * tenant posting a SIMPLIFIED invoice that cannot carry a QR payload
   * (the VAT registration vanished under an enrolled tenant) fails
   * closed HERE — typed, zero residue (the transaction aborts).
   */
  async stampForPost(input: {
    invoice: InvoiceQrSource & {
      readonly branchId: string;
      readonly classification: InvoiceClassification;
    };
    sellerName: string;
    sellerVatRegistrationNumber: string | null;
  }): Promise<InvoiceStamp | null> {
    assertClassification(input.invoice.classification);
    const device = await this.resolveIssuingDevice(input.invoice.branchId);
    if (device === null) {
      // Not enrolled: no EIAS device exists — the compliance surface is
      // off (the settings screen's device registry is the enrollment
      // act). No guard, no stamp, no behavior change.
      return null;
    }
    const vatNumber =
      input.sellerVatRegistrationNumber ?? (await this.sellerVatNumber("SA"));
    if (vatNumber === null) {
      // BR-060 fail-closed: ENROLLED (a device exists) but the QR cannot
      // be built honestly (no REGISTERED SA VAT number) — a simplified
      // issuance would ship payload-less. Typed rejection, zero residue.
      throw new ZatcaQrPayloadRequiredError({
        invoiceId: input.invoice.invoiceId,
        surface: "post",
        classification: input.invoice.classification,
      });
    }
    return this.mintAndWrite({
      invoice: input.invoice,
      device,
      sellerName: input.sellerName,
      sellerVatRegistrationNumber: vatNumber,
    });
  }

  /**
   * Mint + write the stamp for one invoice (must run inside the caller's
   * transaction). Exported for the backfill job.
   */
  async mintAndWrite(input: {
    invoice: InvoiceQrSource & { readonly classification?: InvoiceClassification };
    device: ZatcaDeviceRow;
    sellerName: string;
    sellerVatRegistrationNumber: string;
  }): Promise<InvoiceStamp> {
    const fields = await this.buildQrFields({
      invoice: input.invoice,
      sellerName: input.sellerName,
      sellerVatRegistrationNumber: input.sellerVatRegistrationNumber,
    });
    const mint = await store.reserveNextIcv(input.device.id);
    const digest = invoiceHash({
      invoiceNo: input.invoice.invoiceNo ?? input.invoice.invoiceId,
      issuedAtInstant: fields.timestamp,
      totalNet: input.invoice.totalNet,
      totalTax: input.invoice.totalTax,
      totalGross: input.invoice.totalGross,
      currencyCode: input.invoice.currencyCode,
      sellerVatRegistrationNumber: input.sellerVatRegistrationNumber,
      icv: mint.icv,
      deviceId: input.device.id,
      invoiceId: input.invoice.invoiceId,
    });
    const previousInvoiceHash =
      mint.icv === 1 ? GENESIS_PIH : mint.previousInvoiceHash;
    if (previousInvoiceHash.length === 0) {
      // The predecessor row exists but carries no hash — a chain gap the
      // backfill must close first (fail closed, never mint onto a hole).
      throw new ZatcaChainBrokenError({
        deviceId: input.device.id,
        atIcv: mint.icv - 1,
        reason: "predecessor invoice_hash missing — run the backfill first",
        failures: [],
      });
    }
    const stamp: InvoiceStamp = {
      deviceId: input.device.id,
      deviceName: input.device.name,
      icv: mint.icv,
      previousInvoiceHash,
      invoiceHash: digest,
      invoiceHashVersion: INVOICE_HASH_SPEC_VERSION,
      qrPayload: encodeZatcaQrPayload(fields),
      classification: input.invoice.classification ?? "STANDARD",
    };
    await store.writeInvoiceStamp({
      invoiceId: input.invoice.invoiceId,
      deviceId: stamp.deviceId,
      icv: stamp.icv,
      previousInvoiceHash: stamp.previousInvoiceHash,
      invoiceHash: stamp.invoiceHash,
      invoiceHashVersion: stamp.invoiceHashVersion,
      qrPayload: stamp.qrPayload,
      classification: stamp.classification,
    });
    return stamp;
  }

  // -- verification ------------------------------------------------------------------

  /**
   * Re-walk a device's chain (INV-027): ICV strictly 1..N monotonic with
   * zero gaps, every PIH equals the predecessor's stored hash (the first
   * carries the genesis sentinel), and every digest re-derives from the
   * stored facts. FAILS CLOSED — any break is a typed ZatcaChainBrokenError
   * carrying the failure pack (the tamper evidence).
   */
  async verifyDeviceChain(deviceId: string): Promise<{
    ok: boolean;
    checked: number;
    failures: readonly { icv: number | null; invoiceId: string; reason: string }[];
  }> {
    const device = await this.findDevice(deviceId);
    const chain = await store.listDeviceChain(device.id);
    const failures: { icv: number | null; invoiceId: string; reason: string }[] = [];
    if (chain.length > CHAIN_LIMIT) {
      throw new ZatcaChainBrokenError({
        deviceId: device.id,
        atIcv: null,
        reason: `chain exceeds the verification bound (${CHAIN_LIMIT})`,
        failures: [],
      });
    }
    const registration = await findTaxRegistrationByCountry("SA");
    const sellerVatRegistrationNumber =
      registration?.status === "REGISTERED" ? registration.registrationNumber : null;
    for (let index = 0; index < chain.length; index += 1) {
      const row = chain[index]!;
      const expectedIcv = index + 1;
      if (row.icv !== expectedIcv) {
        failures.push({
          icv: row.icv,
          invoiceId: row.id,
          reason: `ICV sequence broken — expected ${expectedIcv}, found ${String(row.icv)}`,
        });
        continue;
      }
      const expectedPih = index === 0 ? GENESIS_PIH : chain[index - 1]!.invoiceHash;
      if (row.previousInvoiceHash !== expectedPih) {
        failures.push({
          icv: row.icv,
          invoiceId: row.id,
          reason: "PIH does not equal the predecessor's stored hash",
        });
        continue;
      }
      let rederived: string;
      try {
        rederived = invoiceHash({
          invoiceNo: row.invoiceNo ?? row.id,
          issuedAtInstant: zInstantOf(row.postedAt ?? row.invoiceDate),
          totalNet: row.totalNet,
          totalTax: row.totalTax,
          totalGross: row.totalGross,
          currencyCode: row.currencyCode,
          sellerVatRegistrationNumber,
          icv: row.icv!,
          deviceId: device.id,
          invoiceId: row.id,
        });
      } catch {
        failures.push({
          icv: row.icv,
          invoiceId: row.id,
          reason: `unsupported digest version ${String(row.invoiceHashVersion)}`,
        });
        continue;
      }
      if (rederived !== row.invoiceHash) {
        failures.push({
          icv: row.icv,
          invoiceId: row.id,
          reason: "stored invoice_hash does not match the re-derived digest (tamper or digest drift)",
        });
      }
    }
    if (failures.length > 0) {
      const first = failures[0]!;
      throw new ZatcaChainBrokenError({
        deviceId: device.id,
        atIcv: first.icv,
        reason: first.reason,
        failures,
      });
    }
    return { ok: true, checked: chain.length, failures: [] };
  }

  // -- backfill ----------------------------------------------------------------------

  /**
   * The backfill plan (dry-run report): the POSTED invoices not yet
   * stamped, in issuance order, with the device they would attach to.
   * Pure read — the job shows this BEFORE any write (phase §2.7).
   */
  async backfillPlan(deviceId: string, limit: number): Promise<{
    deviceId: string;
    deviceName: string;
    candidates: {
      invoiceId: string;
      invoiceNo: string | null;
      postedAt: string | null;
      totalGross: string;
    }[];
    stampableCount: number;
  }> {
    const device = await this.findDevice(deviceId);
    const candidates = await store.listUnstampedPostedInvoicesTenantWide(limit);
    return {
      deviceId: device.id,
      deviceName: device.name,
      candidates: candidates.map((row) => ({
        invoiceId: row.id,
        invoiceNo: row.invoiceNo,
        postedAt: row.postedAt,
        totalGross: row.totalGross,
      })),
      stampableCount: candidates.length,
    };
  }

  /**
   * The backfill execution: stamp the plan's candidates in issuance
   * order onto the device. Idempotent (only unstamped rows are read,
   * so a re-run finds nothing) and resumable (bounded per run; the next
   * run continues the issuance order). Returns the run's outcome rows.
   */
  async backfillRun(input: {
    deviceId: string;
    limit: number;
    sellerName: string;
    actorId: string | null;
  }): Promise<{
    stamped: number;
    skipped: number;
    results: { invoiceId: string; icv: number }[];
  }> {
    const device = await this.findDevice(input.deviceId);
    const registration = await findTaxRegistrationByCountry("SA");
    const sellerVatRegistrationNumber =
      registration?.status === "REGISTERED" ? registration.registrationNumber : null;
    if (sellerVatRegistrationNumber === null) {
      throw new ZatcaQrPayloadRequiredError({
        invoiceId: "backfill",
        surface: "post",
        classification: "STANDARD",
      });
    }
    const candidates = await store.listUnstampedPostedInvoicesTenantWide(
      Math.min(input.limit, 1000),
    );
    const results: { invoiceId: string; icv: number }[] = [];
    for (const candidate of candidates) {
      const stamp = await this.mintAndWrite({
        invoice: {
          invoiceId: candidate.id,
          invoiceNo: candidate.invoiceNo,
          invoiceDate: candidate.invoiceDate,
          postedAt: candidate.postedAt,
          status: "POSTED",
          currencyCode: candidate.currencyCode,
          totalNet: candidate.totalNet,
          totalTax: candidate.totalTax,
          totalGross: candidate.totalGross,
          classification: "STANDARD",
        },
        device,
        sellerName: input.sellerName,
        sellerVatRegistrationNumber,
      });
      results.push({ invoiceId: candidate.id, icv: stamp.icv });
    }
    await this.audit.record({
      action: "tax.zatca_backfill_run",
      entityType: "zatca_device",
      entityId: device.id,
      actorId: input.actorId ?? undefined,
      after: { stamped: results.length, skipped: candidates.length - results.length },
    });
    return { stamped: results.length, skipped: candidates.length - results.length, results };
  }

  /** The chain read for the UI/report surface (rows in ICV order). */
  async deviceChain(deviceId: string): Promise<readonly InvoiceChainRow[]> {
    await this.findDevice(deviceId);
    return store.listDeviceChain(deviceId);
  }

  /**
   * The BR-060 print guard: for an ENROLLED tenant (an EIAS device
   * exists — the enrollment act), a simplified invoice without a stored
   * payload cannot print (typed refusal). Unenrolled tenants keep
   * printing their legacy receipts unchanged.
   */
  assertPrintGuard(input: {
    invoiceId: string;
    classification: string | null;
    qrPayload: string | null;
    channel: string;
    sellerVatRegistered: boolean;
    enrolled: boolean;
  }): void {
    const simplified =
      input.classification === "SIMPLIFIED" ||
      (input.classification === null && input.channel === "POS");
    if (simplified && input.enrolled && input.sellerVatRegistered && input.qrPayload === null) {
      throw new ZatcaQrPayloadRequiredError({
        invoiceId: input.invoiceId,
        surface: "print",
        classification: "SIMPLIFIED",
      });
    }
  }
}

function assertClassification(classification: InvoiceClassification): void {
  if (classification !== "STANDARD" && classification !== "SIMPLIFIED") {
    throw new ZatcaClassificationInvalidError(String(classification));
  }
}

/** Encode the fields (thin wrapper keeps the service's import surface tight). */
function encodeQrFields(fields: ZatcaQrFields): ZatcaQrFields {
  // encodeZatcaQrPayload validates + serializes; the fields are returned
  // for the digest's timestamp normalization (already Z-normalized).
  encodeZatcaQrPayload(fields);
  return fields;
}

/** PG timestamptz text → ISO-8601 Z instant (the QR timestamp discipline). */
export function zInstantOf(pgTimestamp: string): string {
  return new Date(pgTimestamp.endsWith("Z") || pgTimestamp.includes("+") ? pgTimestamp : `${pgTimestamp}Z`)
    .toISOString()
    .replace(/\.\d+Z$/, "Z");
}
