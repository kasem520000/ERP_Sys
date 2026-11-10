import { createHash } from "node:crypto";

/**
 * PHASE-037 T-01 · the invoice hash chain (INV-027): every issued invoice
 * on a device carries its hash digest, and links to its predecessor via
 * PIH (previous invoice hash) — a per-device append-only chain the
 * verification service can re-walk and that fails closed on tamper.
 *
 * Hash serialization (phase §7 risk 2): the digest depends on a canonical
 * serialization that PHASE-054 finalizes with UBL 2.1 (the official
 * ZATCA hash hashes the UBL XML, which Phase-1 does not produce). This
 * builder therefore carries a CODE-LEVEL VERSION MARKER
 * (INVOICE_HASH_SPEC_VERSION) and documents the re-derive path: 054
 * swaps the digest implementation and re-derives ALL stored hashes in
 * issuance order — PIH links remain valid (every PIH is recomputed from
 * the same walk), no chain row is rewritten selectively.
 */

/** Code-level version marker of this digest implementation (phase §7). */
export const INVOICE_HASH_SPEC_VERSION = "invoice-hash-v1";

/**
 * The genesis PIH convention: base64(SHA-256(ASCII "0")) — the first
 * invoice on every device chain links to this documented sentinel (there
 * is no real predecessor).
 */
export const GENESIS_PIH: string = Buffer.from(
  createHash("sha256").update("0", "ascii").digest(),
).toString("base64");

/**
 * The canonical serialization for digest v1: a newline-joined field
 * vector over the invoice's immutable identity + money facts (the
 * columns the tamper spec mutates to prove fail-closed). Fixed field
 * order, explicit empty marker, no locale/format ambiguity.
 */
export function canonicalInvoiceSerialization(input: {
  invoiceNo: string;
  issuedAtInstant: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  currencyCode: string;
  sellerVatRegistrationNumber: string | null;
  icv: number;
  deviceId: string;
  invoiceId: string;
}): string {
  return [
    "zatca:invoice-hash:v1",
    input.deviceId,
    String(input.icv),
    input.invoiceId,
    input.invoiceNo,
    input.issuedAtInstant,
    input.currencyCode,
    input.totalNet,
    input.totalTax,
    input.totalGross,
    input.sellerVatRegistrationNumber ?? "",
  ].join("\n");
}

/** The invoice hash digest (base64 SHA-256 over the canonical v1 form). */
export function invoiceHash(input: Parameters<typeof canonicalInvoiceSerialization>[0]): string {
  return Buffer.from(
    createHash("sha256").update(canonicalInvoiceSerialization(input), "utf8").digest(),
  ).toString("base64");
}

/** Re-derive the digest from a stored row (verification walk). */
export function rederiveInvoiceHash(row: {
  invoiceHashVersion: string | null;
  invoiceId: string;
  invoiceNo: string | null;
  issuedAtInstant: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  currencyCode: string;
  sellerVatRegistrationNumber: string | null;
  icv: number;
  deviceId: string;
}): string {
  // v1 is the only digest this build can re-derive; an unknown marker
  // (future 054 rewrite) fails closed at verification, never "verifies".
  if (row.invoiceHashVersion !== INVOICE_HASH_SPEC_VERSION) {
    throw new Error(`unsupported invoice-hash version: ${String(row.invoiceHashVersion)}`);
  }
  return invoiceHash({
    invoiceNo: row.invoiceNo ?? row.invoiceId,
    issuedAtInstant: row.issuedAtInstant,
    totalNet: row.totalNet,
    totalTax: row.totalTax,
    totalGross: row.totalGross,
    currencyCode: row.currencyCode,
    sellerVatRegistrationNumber: row.sellerVatRegistrationNumber,
    icv: row.icv,
    deviceId: row.deviceId,
    invoiceId: row.invoiceId,
  });
}
