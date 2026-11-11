/**
 * PHASE-041 (T-02) — AWS Signature Version 4 (the official algorithm,
 * AWS General Reference "Signature Calculations for Authorization Header")
 * as a dependency-free, transport-agnostic signer over the provider HTTP
 * seam — so the SES adapter stays uniformly fake-transport testable.
 *
 * The spec pins the signer against the AWS documentation's COMPLETE
 * worked example (the iam ListUsers GET — service iam, us-east-1,
 * AKIDEXAMPLE): the canonical request, the string-to-sign, the derived
 * signing key, and the final signature all reproduce the documented
 * values, proving the algorithm without a live AWS call.
 */

import { createHash, createHmac } from "node:crypto";

export interface SigV4Input {
  readonly method: string;
  /** The full URL (query included — it joins the canonical request). */
  readonly url: URL;
  /**
   * The headers to sign: exactly these appear (sorted, lowercased,
   * trimmed) in the canonical headers + SignedHeaders. The caller pins
   * the set (SES: content-type, host, x-amz-content-sha256, x-amz-date).
   */
  readonly headers: Readonly<Record<string, string>>;
  readonly payload: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
  /** Format 20150830T123600Z (ISO basic). */
  readonly amzDate: string;
  /** Format 20150830 (the amzDate's date part). */
  readonly dateStamp: string;
}

/** hex(sha256(value)) — the hash helper the algorithm builds on. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** The canonical string-to-sign pieces (exported for the spec's pins). */
export function canonicalRequest(input: SigV4Input): string {
  const sortedHeaders = Object.keys(input.headers)
    .map((name) => name.toLowerCase().trim())
    .sort();
  const canonicalHeaders = sortedHeaders
    .map((name) => `${name}:${input.headers[name]!.trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaders.join(";");
  const payloadHash = sha256Hex(input.payload);
  // The canonical query string: sorted by key (then value), RFC 3986
  // encoded. URLSearchParams handles the pair extraction; sorting is ours.
  const params = [...input.url.searchParams.entries()].map(
    ([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const,
  );
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQuery = params.map(([key, value]) => `${key}=${value}`).join("&");
  return [
    input.method,
    input.url.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
}

/** RFC 3986 (the SigV4 flavor — URLSearchParams leaves !'()* unescaped). */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function stringToSign(input: SigV4Input, requestHash: string): string {
  const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  return ["AWS4-HMAC-SHA256", input.amzDate, scope, requestHash].join("\n");
}

/** The derived signing key (kDate → kRegion → kService → kSigning). */
export function signingKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(region).digest();
  const kService = createHmac("sha256", kRegion).update(service).digest();
  return createHmac("sha256", kService).update("aws4_request").digest();
}

/** The complete Authorization header value (the adapter's wire artifact). */
export function sigV4Authorization(input: SigV4Input): string {
  const requestHash = sha256Hex(canonicalRequest(input));
  const toSign = stringToSign(input, requestHash);
  const key = signingKey(input.secretAccessKey, input.dateStamp, input.region, input.service);
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  const signedHeaders = Object.keys(input.headers)
    .map((name) => name.toLowerCase().trim())
    .sort()
    .join(";");
  const scope = `${input.dateStamp}/${input.region}/${input.service}/aws4_request`;
  return (
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
  );
}
