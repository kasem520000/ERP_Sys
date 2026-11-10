import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  encodeZatcaQrPayload,
  tlvDecode,
  tlvEncodeField,
  zatcaDocumentedSampleFields,
  ZATCA_QR_TAGS,
} from "../application/zatca/tlv";
import { GENESIS_PIH, invoiceHash, INVOICE_HASH_SPEC_VERSION } from "../application/zatca/hash-chain";
import { ZatcaGenerationAdapter, ZATCA_GENERATION_STATUS_VOCABULARY, ZATCA_UNMET_GATE_ITEMS } from "../adapters/zatca/zatca-stub";

/**
 * PHASE-037 T-01/T-06 — the PINNED Phase-1 vectors (acceptance 2 + 7):
 *
 *   1. TLV byte structure per mandated field (tag / length / UTF-8 value).
 *   2. The ZATCA-documented sample five-field set — the base64 payload is
 *      pinned BYTE-FOR-BYTE (deterministic encoding; recomputing it inline
 *      in the test would prove nothing).
 *   3. The genesis PIH convention: base64(SHA-256(ASCII "0")) — pinned
 *      against an independent re-computation AND the documented constant.
 *   4. The ARABIC seller name encodes as multi-byte UTF-8 (the length byte
 *      counts BYTES, never characters — a classic TLV bug).
 *   5. Fail-closed input validation (VAT shape, timestamp shape, money
 *      discipline 19,4).
 *   6. BR-061 adapter honesty: the vocabulary is GENERATED/FAILED only;
 *      the Phase-2 surface is a typed NOT_IMPLEMENTED; the GATE-1..4
 *      checklist is preserved.
 */

// The pinned base64 of the documented sample (independently derived from
// the TLV algorithm over the five documented fields — verified byte-by-byte
// in review; ANY change to the encoder changes this string).
const PINNED_SAMPLE_BASE64 =
  "AQ9Nb3RoZXIncyBNYXJrZXQCDzMxMDEyMjM5MzUwMDAwMwMUMjAxNS0xMi0xN1QxMjoxNzoyOFoEBzEwMDAuMDAFBjE1MC4wMA==";

// The genesis PIH constant (base64 of SHA-256 over the ASCII digit zero).
const PINNED_GENESIS_PIH = "X+zrZv/IbzjZUnhsbWlsecLbwjndTpG0ZynXOif7V+k=";

describe("TLV encoder — the five mandated fields (acceptance 2)", () => {
  it("encodes each field as [tag][len][utf8 value] with byte-accurate lengths", () => {
    const name = tlvEncodeField(ZATCA_QR_TAGS.SELLER_NAME, "Mother's Market");
    expect(name[0]).toBe(1);
    expect(name[1]).toBe(15); // "Mother's Market" = 15 bytes
    expect(name.subarray(2).toString("utf8")).toBe("Mother's Market");

    const vat = tlvEncodeField(ZATCA_QR_TAGS.VAT_REGISTRATION_NUMBER, "310122393500003");
    expect(vat[0]).toBe(2);
    expect(vat[1]).toBe(15); // 15 digits

    const ts = tlvEncodeField(ZATCA_QR_TAGS.TIMESTAMP, "2015-12-17T12:17:28Z");
    expect(ts[0]).toBe(3);
    expect(ts[1]).toBe(20); // 20 ASCII chars

    const total = tlvEncodeField(ZATCA_QR_TAGS.INVOICE_TOTAL, "1000.00");
    expect(total[0]).toBe(4);
    expect(total[1]).toBe(7);

    const vatTotal = tlvEncodeField(ZATCA_QR_TAGS.VAT_TOTAL, "150.00");
    expect(vatTotal[0]).toBe(5);
    expect(vatTotal[1]).toBe(6);
  });

  it("reproduces the documented sample payload byte-for-byte (pinned vector)", () => {
    const payload = encodeZatcaQrPayload(zatcaDocumentedSampleFields());
    expect(payload).toBe(PINNED_SAMPLE_BASE64);
    // And it round-trips through the decoder back to the exact fields.
    const decoded = tlvDecode(payload);
    expect(decoded.get(1)).toBe("Mother's Market");
    expect(decoded.get(2)).toBe("310122393500003");
    expect(decoded.get(3)).toBe("2015-12-17T12:17:28Z");
    expect(decoded.get(4)).toBe("1000.00");
    expect(decoded.get(5)).toBe("150.00");
  });

  it("counts UTF-8 BYTES, not characters, for the Arabic seller name", () => {
    // "مطحة" = 4 chars but 8 UTF-8 bytes; a char-count length byte is the
    // classic TLV bug the ZATCA reader cannot decode.
    const arabic = tlvEncodeField(ZATCA_QR_TAGS.SELLER_NAME, "مطحة");
    expect(arabic[1]).toBe(8);
    const payload = encodeZatcaQrPayload({
      sellerName: "مطحة الوقود",
      vatRegistrationNumber: "310122393500003",
      timestamp: "2015-12-17T12:17:28Z",
      invoiceTotal: "1000.00",
      vatTotal: "150.00",
    });
    const decoded = tlvDecode(payload);
    expect(decoded.get(1)).toBe("مطحة الوقود");
  });

  it("fails closed on vocabulary violations (VAT shape, timestamp, money, empty name)", () => {
    const valid = zatcaDocumentedSampleFields();
    expect(() => encodeZatcaQrPayload({ ...valid, vatRegistrationNumber: "1234" })).toThrow(
      /15 digits/,
    );
    expect(() =>
      encodeZatcaQrPayload({ ...valid, timestamp: "2015-12-17 12:17:28" }),
    ).toThrow(/ISO-8601 Z instant/);
    expect(() => encodeZatcaQrPayload({ ...valid, invoiceTotal: "1000.000001" })).toThrow(
      /19,4/,
    );
    expect(() => encodeZatcaQrPayload({ ...valid, invoiceTotal: "-5.00" })).toThrow(/19,4/);
    expect(() => encodeZatcaQrPayload({ ...valid, sellerName: "" })).toThrow(/empty/);
  });

  it("rejects a TLV value above the 255-byte length ceiling", () => {
    expect(() => tlvEncodeField(1, "x".repeat(256))).toThrow(/255 bytes/);
  });
});

describe("hash chain — genesis PIH + digest v1 (acceptance 2/4)", () => {
  it("pins the genesis PIH to base64(SHA-256(ASCII '0'))", () => {
    const recomputed = Buffer.from(createHash("sha256").update("0", "ascii").digest()).toString(
      "base64",
    );
    expect(GENESIS_PIH).toBe(recomputed);
    expect(GENESIS_PIH).toBe(PINNED_GENESIS_PIH);
  });

  it("produces a stable base64 digest with the code-level version marker", () => {
    const input = {
      invoiceNo: "SAL-2026-000001",
      issuedAtInstant: "2026-01-15T10:30:00Z",
      totalNet: "100.0000",
      totalTax: "15.0000",
      totalGross: "115.0000",
      currencyCode: "SAR",
      sellerVatRegistrationNumber: "310122393500003",
      icv: 1,
      deviceId: "d1d1d1d1-0000-4000-8000-000000000001",
      invoiceId: "a1a1a1a1-0000-4000-8000-000000000001",
    };
    const digest = invoiceHash(input);
    expect(digest).toBe(invoiceHash(input)); // deterministic
    expect(Buffer.from(digest, "base64").length).toBe(32); // SHA-256
    // A money-fact mutation changes the digest (the tamper signal).
    expect(invoiceHash({ ...input, totalGross: "116.0000" })).not.toBe(digest);
    expect(INVOICE_HASH_SPEC_VERSION).toBe("invoice-hash-v1");
  });
});

describe("adapter honesty — BR-061 (acceptance 7)", () => {
  it("produces GENERATED/FAILED only", () => {
    expect(ZATCA_GENERATION_STATUS_VOCABULARY).toEqual(["GENERATED", "FAILED"]);
    const adapter = new ZatcaGenerationAdapter();
    expect(adapter.generate({ qrPayload: PINNED_SAMPLE_BASE64 }).status).toBe("GENERATED");
    const failed = adapter.generate({});
    expect(failed.status).toBe("FAILED");
    if (failed.status === "FAILED") {
      expect(failed.reason).toContain("qrPayload");
    }
  });

  it("refuses submission with the typed Phase-2 NOT_IMPLEMENTED (never a guessed wire)", async () => {
    const adapter = new ZatcaGenerationAdapter();
    expect(adapter.regimeVerified).toBe(false);
    const outcome = await adapter.submit({
      countryCode: "SA",
      sourceType: "sales_invoice",
      sourceId: "00000000-0000-4000-8000-000000000001",
      document: {},
    });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("ZATCA_PHASE2_NOT_IMPLEMENTED");
    const error = outcome.error as { unmetGateItems: string[]; phase: string };
    expect(error.unmetGateItems).toEqual(ZATCA_UNMET_GATE_ITEMS.map((gate) => gate.item));
    expect(error.phase).toBe("054");
    expect(outcome.authorityReference).toBeNull();
  });
});
