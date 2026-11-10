/**
 * PHASE-021 T8 · REAL minisign signature verification (Ed25519) for the
 * signed auto-update channel (MASTER-PLAN §1 item 8 / §7; SECURITY_TEST_PLAN
 * D-06: unsigned, tampered, downgraded updates are rejected — the verifier is
 * NEVER mocked; every test generates real Ed25519 keypairs and signs real
 * content).
 *
 * Format notes (jedisct1/minisign, studied + followed byte-for-byte):
 * - Signature file: line 1 `untrusted comment: <text>`, line 2 base64 of
 *   [algo(2, big-endian "Ed" = 0x4564) | key id(8) | Ed25519 signature(64)]
 *   = 74 bytes; optionally line 3 `trusted comment: <text>` and line 4
 *   base64 of the RAW 64-byte global signature (no algo/key-id prefix) —
 *   the global signature is Ed25519 over (trusted-comment || signature64).
 * - Public key file: line 1 `untrusted comment: <text>`, line 2 base64 of
 *   [algo(2) | key id(8) | public key(32)] = 42 bytes.
 * - Private key (this module's TEST/CI helper): base64 of
 *   [algo(2) | key id(8) | seed(32) || public key(32)] = 74 bytes. This is
 *   the minisign secret-key CORE, deliberately UNENCRYPTED — the production
 *   .key file wraps it in scrypt+XOR layers that only matter on developer
 *   machines; CI keeps raw material in secret storage (SECRETS_MANAGEMENT
 *   S-15: signing occurs only in CI, never here).
 *
 * Recorded deviations (→ completion-report DR list):
 * - Key-id derivation for GENERATED keys = first 8 bytes of SHA-512(public)
 *   (minisign proper uses unkeyed BLAKE2b-8). The verifier treats key ids as
 *   opaque routing metadata and never gates on them — signature verification
 *   is always the full Ed25519 check — so this changes no verification
 *   semantics.
 * - Base64 decoding is canonical-strict (standard alphabet, correct padding,
 *   zero trailing bits); anything else is `verified: false` with a reason,
 *   never a throw (D-06 posture: malformed input fails closed, quietly).
 */

import {
  createHash,
  createPublicKey,
  createPrivateKey,
  generateKeyPairSync,
  sign as ed25519Sign,
  verify as ed25519Verify,
  type KeyObject,
} from "node:crypto";

/** The only accepted signature algorithm: "Ed" (0x4564) — Ed25519. */
const SIG_ALGO_ED = Buffer.from([0x45, 0x64]);

const SIG_BLOB_LENGTH = 74; // algo(2) + key id(8) + signature(64)
const PUBLIC_KEY_BLOB_LENGTH = 42; // algo(2) + key id(8) + public key(32)
const PRIVATE_KEY_CORE_LENGTH = 74; // algo(2) + key id(8) + seed(32)||public(32)
const GLOBAL_SIGNATURE_LENGTH = 64; // raw Ed25519 signature over comment||sig

/** Fixed DER wrappers for raw Ed25519 material (same pattern as the device
 * registry's importEd25519 — raw 32-byte keys carry no SPKI/PKCS8 header). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface VerifyMinisignInput {
  /** The signed content (update bundle bytes / canonical manifest JSON). */
  readonly content: Buffer | string;
  /** Full minisign signature FILE content (untrusted comment + base64 …). */
  readonly signatureFile: string;
  /** Full minisign public key FILE content (untrusted comment + base64 …). */
  readonly publicKeyFile: string;
}

export interface VerifyMinisignResult {
  readonly verified: boolean;
  /** Hex key id from the signature blob (16 lowercase hex chars). */
  readonly keyId: string;
  /** The trusted comment, present and verified (global signature checked). */
  readonly trustedComment?: string;
  /** Honest machine-readable rejection reason (always set when !verified). */
  readonly reason?: string;
}

interface ParsedSignature {
  readonly signature: Buffer; // 64-byte Ed25519 signature
  readonly keyId: string;
  readonly trustedComment?: string;
  readonly globalSignature?: Buffer;
}

interface ParsedPublicKey {
  readonly publicKey: Buffer; // raw 32-byte Ed25519 public key
  readonly keyId: string;
}

// -- strict base64 (canonical standard-alphabet decode; null on any malform) --

function strictBase64Decode(text: string): Buffer | null {
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.length === 0 || cleaned.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
  const decoded = Buffer.from(cleaned, "base64");
  // Canonical re-encode must round-trip (rejects non-zero trailing bits).
  if (decoded.toString("base64") !== cleaned) return null;
  return decoded;
}

function toHex(bytes: Buffer): string {
  return bytes.toString("hex").toLowerCase();
}

// -- file parsing (never throws; callers convert errors to verified:false) ----

function splitLines(file: string): string[] {
  const lines = file.split(/\r?\n/).map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function parseSignatureFile(file: string): { ok: true; parsed: ParsedSignature } | { ok: false; error: string } {
  const lines = splitLines(file);
  if (lines.length < 2) return { ok: false, error: "signature file: fewer than 2 lines" };
  if (!/^untrusted comment:/i.test(lines[0]!)) {
    return { ok: false, error: "signature file: line 1 is not an untrusted comment" };
  }
  const blob = strictBase64Decode(lines[1]!);
  if (blob === null) return { ok: false, error: "signature file: line 2 is not canonical base64" };
  if (blob.length !== SIG_BLOB_LENGTH) {
    return { ok: false, error: `signature file: decoded blob is ${blob.length} bytes, expected ${SIG_BLOB_LENGTH}` };
  }
  if (!blob.subarray(0, 2).equals(SIG_ALGO_ED)) {
    return {
      ok: false,
      error: `signature file: unsupported signature algorithm ${toHex(blob.subarray(0, 2))} (expected "Ed" = 4564)`,
    };
  }
  const parsed: ParsedSignature = {
    signature: blob.subarray(10),
    keyId: toHex(blob.subarray(2, 10)),
  };
  if (lines.length === 2) return { ok: true, parsed };
  if (lines.length === 3) {
    return { ok: false, error: "signature file: trusted comment without a global signature line" };
  }
  if (lines.length > 4) return { ok: false, error: "signature file: more than 4 lines" };
  if (!/^trusted comment:/i.test(lines[2]!)) {
    return { ok: false, error: "signature file: line 3 is not a trusted comment" };
  }
  const globalSignature = strictBase64Decode(lines[3]!);
  if (globalSignature === null) {
    return { ok: false, error: "signature file: line 4 is not canonical base64" };
  }
  if (globalSignature.length !== GLOBAL_SIGNATURE_LENGTH) {
    return {
      ok: false,
      error: `signature file: global signature is ${globalSignature.length} bytes, expected ${GLOBAL_SIGNATURE_LENGTH}`,
    };
  }
  return {
    ok: true,
    parsed: {
      ...parsed,
      trustedComment: lines[2]!.slice("trusted comment:".length).replace(/^\s+/, ""),
      globalSignature,
    },
  };
}

/** Inspect a minisign signature file WITHOUT verifying it (format + key id
 * only) — the manifest layer uses this to bind Tauri-shaped signatures
 * (signature-of-the-BUNDLE) to a trusted key id before the bundle download;
 * the full Ed25519 verification still runs on the downloaded bundle. */
export function inspectMinisignSignature(file: string): { ok: true; keyId: string } | { ok: false; error: string } {
  const parsed = parseSignatureFile(file);
  return parsed.ok ? { ok: true, keyId: parsed.parsed.keyId } : { ok: false, error: parsed.error };
}

/** Parse a minisign public key file → raw key material (used by the
 * manifest dual-trust key window and by verification). Never throws. */
export function parseMinisignPublicKey(
  file: string,
): { ok: true; key: ParsedPublicKey } | { ok: false; error: string } {
  const lines = splitLines(file);
  if (lines.length < 2) return { ok: false, error: "public key file: fewer than 2 lines" };
  if (!/^untrusted comment:/i.test(lines[0]!)) {
    return { ok: false, error: "public key file: line 1 is not an untrusted comment" };
  }
  const blob = strictBase64Decode(lines[1]!);
  if (blob === null) return { ok: false, error: "public key file: line 2 is not canonical base64" };
  if (blob.length !== PUBLIC_KEY_BLOB_LENGTH) {
    return {
      ok: false,
      error: `public key file: decoded blob is ${blob.length} bytes, expected ${PUBLIC_KEY_BLOB_LENGTH}`,
    };
  }
  if (!blob.subarray(0, 2).equals(SIG_ALGO_ED)) {
    return {
      ok: false,
      error: `public key file: unsupported signature algorithm ${toHex(blob.subarray(0, 2))} (expected "Ed" = 4564)`,
    };
  }
  return {
    ok: true,
    key: { publicKey: blob.subarray(10), keyId: toHex(blob.subarray(2, 10)) },
  };
}

function importPublicEd25519(raw: Buffer): KeyObject {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

function importPrivateEd25519(seed: Buffer): KeyObject {
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_SEED_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

// -- verification (the D-06 boundary — REAL Ed25519, never mocked) ------------

/**
 * Verify a minisign signature over `content` with the given public key file.
 * Checks, in order: signature-file shape, base64 canonicity, algorithm "Ed",
 * Ed25519 signature over the content, and — when a trusted comment + global
 * signature are present — the global signature over (trusted comment ||
 * signature). Any failure ⇒ `{ verified: false, reason }` — this function
 * NEVER throws on malformed input.
 */
export function verifyMinisign(input: VerifyMinisignInput): VerifyMinisignResult {
  const fail = (keyId: string, reason: string): VerifyMinisignResult => ({ verified: false, keyId, reason });
  try {
    const signature = parseSignatureFile(input.signatureFile);
    if (!signature.ok) return fail("", `invalid signature: ${signature.error}`);
    const publicKey = parseMinisignPublicKey(input.publicKeyFile);
    if (!publicKey.ok) return fail(signature.parsed.keyId, `invalid public key: ${publicKey.error}`);

    const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, "utf8");
    const signatureVerified = ed25519Verify(
      null,
      content,
      importPublicEd25519(publicKey.key.publicKey),
      signature.parsed.signature,
    );
    if (!signatureVerified) {
      return fail(
        signature.parsed.keyId,
        "Ed25519 signature does not match the content (tampered content or wrong key)",
      );
    }
    if (signature.parsed.trustedComment !== undefined && signature.parsed.globalSignature !== undefined) {
      const globalData = Buffer.concat([
        Buffer.from(signature.parsed.trustedComment, "utf8"),
        signature.parsed.signature,
      ]);
      const globalVerified = ed25519Verify(
        null,
        globalData,
        importPublicEd25519(publicKey.key.publicKey),
        signature.parsed.globalSignature,
      );
      if (!globalVerified) {
        return fail(signature.parsed.keyId, "global signature over the trusted comment is invalid");
      }
      return { verified: true, keyId: signature.parsed.keyId, trustedComment: signature.parsed.trustedComment };
    }
    return { verified: true, keyId: signature.parsed.keyId };
  } catch (error) {
    return fail("", `verification error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// -- signing (TEST-ONLY helpers: specs + CI scripts — production signing
//    happens only in the Windows CI workflow with store-backed keys, S-15) ----

export interface MinisignKeyPair {
  /** Full minisign public key file content (what verifyMinisign consumes). */
  readonly publicKeyFile: string;
  /** File-shaped UNENCRYPTED private key (comment + base64 core). */
  readonly privateKeyFile: string;
  /** base64 of [algo | key id | seed || public] — what signWithMinisignKey
   * and manifest.signManifest consume. */
  readonly privateKey: string;
  readonly keyId: string;
  /** Sign content → full minisign signature FILE content. */
  sign(content: Buffer | string, options?: { readonly trustedComment?: string }): string;
}

function keyIdFor(publicKey: Buffer): string {
  // See header note: SHA-512/first-8 derivation for generated keys (minisign
  // proper uses BLAKE2b-8); key ids are opaque metadata, never a gate.
  return toHex(createHash("sha512").update(publicKey).digest().subarray(0, 8));
}

function buildSignatureFile(
  privateKeyObject: KeyObject,
  keyId: string,
  content: Buffer | string,
  options?: { readonly trustedComment?: string },
): string {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const signature = ed25519Sign(null, data, privateKeyObject);
  const blob = Buffer.concat([SIG_ALGO_ED, Buffer.from(keyId, "hex"), signature]);
  const untrusted = "untrusted comment: signature from @erp/desktop minisign key";
  const trustedComment = options?.trustedComment;
  if (trustedComment === undefined) {
    return `${untrusted}\n${blob.toString("base64")}\n`;
  }
  const globalSignature = ed25519Sign(
    null,
    Buffer.concat([Buffer.from(trustedComment, "utf8"), signature]),
    privateKeyObject,
  );
  return `${untrusted}\n${blob.toString("base64")}\ntrusted comment: ${trustedComment}\n${globalSignature.toString("base64")}\n`;
}

/** Parse the UNENCRYPTED private-key core (base64) back into a KeyObject.
 * Test/CI helper — the production .key file's scrypt layers are out of scope
 * here by design (see module header). Structured result, never throws. */
export function minisignPrivateKeyObject(
  privateKey: string,
): { ok: true; key: KeyObject; keyId: string } | { ok: false; error: string } {
  const blob = strictBase64Decode(privateKey.trim());
  if (blob === null) return { ok: false, error: "private key: not canonical base64" };
  if (blob.length !== PRIVATE_KEY_CORE_LENGTH) {
    return {
      ok: false,
      error: `private key: decoded core is ${blob.length} bytes, expected ${PRIVATE_KEY_CORE_LENGTH}`,
    };
  }
  if (!blob.subarray(0, 2).equals(SIG_ALGO_ED)) {
    return { ok: false, error: `private key: unsupported algorithm ${toHex(blob.subarray(0, 2))} (expected "Ed")` };
  }
  return {
    ok: true,
    key: importPrivateEd25519(blob.subarray(10, 42)),
    keyId: toHex(blob.subarray(2, 10)),
  };
}

/** Sign content with a minisign private-key core (base64) → full signature
 * file content. TEST/CI helper (real Ed25519 — same crypto as verification). */
export function signWithMinisignKey(
  privateKey: string,
  content: Buffer | string,
  options?: { readonly trustedComment?: string },
): string {
  const parsed = minisignPrivateKeyObject(privateKey);
  if (!parsed.ok) throw new Error(parsed.error);
  return buildSignatureFile(parsed.key, parsed.keyId, content, options);
}

/**
 * Generate a REAL Ed25519 minisign keypair (node:crypto). TEST-ONLY helper
 * exported for specs + CI scripts; production update keys are generated and
 * stored per SECRETS_MANAGEMENT S-15, never on this path.
 */
export function generateMinisignKeyPair(): MinisignKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const keyId = keyIdFor(rawPublic);
  const core = Buffer.concat([SIG_ALGO_ED, Buffer.from(keyId, "hex"), seed, rawPublic]);
  const privateKeyBase64 = core.toString("base64");
  const publicBlob = Buffer.concat([SIG_ALGO_ED, Buffer.from(keyId, "hex"), rawPublic]);
  return {
    publicKeyFile: `untrusted comment: minisign public key ${keyId}\n${publicBlob.toString("base64")}\n`,
    privateKeyFile: `untrusted comment: minisign UNENCRYPTED secret key (test/CI only)\n${privateKeyBase64}\n`,
    privateKey: privateKeyBase64,
    keyId,
    sign: (content, options) => buildSignatureFile(privateKey, keyId, content, options),
  };
}
