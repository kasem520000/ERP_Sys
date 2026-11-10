/**
 * PHASE-037 T-01 · the ZATCA Phase-1 QR payload codec (pure computation —
 * ZERO external calls; the audit verdict "Phase 1 (QR) needs no outside
 * access; it is pure mathematical encoding").
 *
 * The five mandated fields (E_INVOICING Phase-1 §3.2 — the ZATCA "security
 * features implementation standards" QR TLV schema):
 *
 *   tag 1  seller name            UTF-8 text (the tenant legal name)
 *   tag 2  VAT registration number  15-digit string
 *   tag 3  timestamp              ISO-8601 instant (…Z)
 *   tag 4  invoice total including VAT  decimal string (SAR discipline 19,4)
 *   tag 5  VAT total              decimal string (SAR discipline 19,4)
 *
 * Encoding: TLV — [tag: 1 byte][length: 1 byte][value: length bytes UTF-8],
 * fields concatenated in tag order, then base64. This is the payload the
 * ZATCA reader app scans on the printed invoice (H-01 Phase-1).
 *
 * REQUIRES_VERIFICATION discipline (phase §7): the wire format below is the
 * documented stable Phase-1 schema; any later ZATCA sample divergence
 * resolves in PHASE-054 with the UBL 2.1 work (the payload builder is
 * version-marked via PAYLOAD_SPEC_VERSION so the re-derive path is explicit).
 */

/** The TLV tags of the five mandated Phase-1 fields, in encoding order. */
export const ZATCA_QR_TAGS = {
  SELLER_NAME: 1,
  VAT_REGISTRATION_NUMBER: 2,
  TIMESTAMP: 3,
  INVOICE_TOTAL: 4,
  VAT_TOTAL: 5,
} as const;

/** Code-level version marker of this payload builder (phase §7 risk 1). */
export const PAYLOAD_SPEC_VERSION = "phase1-tlv-v1";

/** One QR field, validated before encoding. */
export interface ZatcaQrFields {
  readonly sellerName: string;
  readonly vatRegistrationNumber: string;
  /** ISO-8601 instant ending in Z (the ZATCA sample discipline). */
  readonly timestamp: string;
  /** Invoice total INCLUDING VAT — canonical decimal string (19,4). */
  readonly invoiceTotal: string;
  /** VAT total — canonical decimal string (19,4). */
  readonly vatTotal: string;
}

const ISO_Z_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const VAT_NUMBER = /^\d{15}$/;
/** 19,4 decimal-string discipline (ADR-0009; non-negative — invoice money). */
const SAR_DECIMAL = /^\d{1,15}(\.\d{1,4})?$/;

/** Encode ONE TLV field: tag byte + length byte + UTF-8 value bytes. */
export function tlvEncodeField(tag: number, value: string): Buffer {
  const valueBytes = Buffer.from(value, "utf8");
  if (valueBytes.length > 255) {
    throw new RangeError(`TLV value for tag ${tag} exceeds 255 bytes (got ${valueBytes.length})`);
  }
  return Buffer.concat([Buffer.from([tag, valueBytes.length]), valueBytes]);
}

/** Decode a TLV stream back to its fields (verification/backfill/debug tool). */
export function tlvDecode(payload: string): Map<number, string> {
  const bytes = Buffer.from(payload, "base64");
  const fields = new Map<number, string>();
  let offset = 0;
  while (offset < bytes.length) {
    const tag = bytes[offset]!;
    const length = bytes[offset + 1]!;
    if (offset + 2 + length > bytes.length) {
      throw new RangeError(`TLV stream truncated at tag ${tag}`);
    }
    fields.set(tag, bytes.subarray(offset + 2, offset + 2 + length).toString("utf8"));
    offset += 2 + length;
  }
  return fields;
}

/** The QR payload spec: TLV in tag order over the five mandated fields. */
export function encodeZatcaQrPayload(fields: ZatcaQrFields): string {
  if (!VAT_NUMBER.test(fields.vatRegistrationNumber)) {
    throw new RangeError(
      `ZATCA VAT registration number must be 15 digits (got "${fields.vatRegistrationNumber}")`,
    );
  }
  if (!ISO_Z_INSTANT.test(fields.timestamp)) {
    throw new RangeError(
      `ZATCA QR timestamp must be an ISO-8601 Z instant (got "${fields.timestamp}")`,
    );
  }
  if (!SAR_DECIMAL.test(fields.invoiceTotal) || !SAR_DECIMAL.test(fields.vatTotal)) {
    throw new RangeError(
      `ZATCA QR amounts must carry the SAR 19,4 decimal discipline (got "${fields.invoiceTotal}", "${fields.vatTotal}")`,
    );
  }
  if (fields.sellerName.length === 0) {
    throw new RangeError("ZATCA QR seller name must not be empty");
  }
  const stream = Buffer.concat([
    tlvEncodeField(ZATCA_QR_TAGS.SELLER_NAME, fields.sellerName),
    tlvEncodeField(ZATCA_QR_TAGS.VAT_REGISTRATION_NUMBER, fields.vatRegistrationNumber),
    tlvEncodeField(ZATCA_QR_TAGS.TIMESTAMP, fields.timestamp),
    tlvEncodeField(ZATCA_QR_TAGS.INVOICE_TOTAL, fields.invoiceTotal),
    tlvEncodeField(ZATCA_QR_TAGS.VAT_TOTAL, fields.vatTotal),
  ]);
  return stream.toString("base64");
}

/**
 * The canonical Phase-1 sample (the five-field set the ZATCA
 * documentation walks through; pinned in the unit spec): seller
 * "Mother's Market", VAT 310122393500003, 2015-12-17T12:17:28Z,
 * total 1000.00, VAT 150.00. Exported for the spec's pinned vector —
 * the expected base64 is asserted in tests, never recomputed inline.
 */
export function zatcaDocumentedSampleFields(): ZatcaQrFields {
  return {
    sellerName: "Mother's Market",
    vatRegistrationNumber: "310122393500003",
    timestamp: "2015-12-17T12:17:28Z",
    invoiceTotal: "1000.00",
    vatTotal: "150.00",
  };
}
