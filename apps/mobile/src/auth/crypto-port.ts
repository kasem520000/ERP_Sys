import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from "node:crypto";

/**
 * PHASE-022 · the device-keypair crypto port (T2-b; MASTER-PLAN §1
 * DR-P22-09 + §7; SECURITY_AND_DEVICE_MANAGEMENT §2.2 — attestation
 * lite: the device registers a public key and proves possession of the
 * private half by signing the server's nonce; DR-P21-01's desktop
 * enrollment used real Ed25519 end-to-end and so does this port).
 *
 * `CryptoPort` is the seam; two implementations:
 *
 * - **Device** (`apps/mobile/native/drivers/crypto.ts`): Ed25519 over
 *   the platform's WebCrypto-style surface (expo-crypto /
 *   react-native-quick-crypto — the exact bridging is the native
 *   author's, documented there; the REQUIREMENTS on any implementation
 *   are pinned by this port's contract and the test driver below):
 *   - `publicKey`  — base64 DER SPKI (or raw 32-byte base64 — the
 *     registry's `importEd25519` accepts both, device-registry-service
 *     attest verification);
 *   - `privateKey` — base64 PKCS8 (opaque to every consumer; handed to
 *     `SecureStorePort` for keystore storage, never to the DB/logs);
 *   - `sign`       — base64 Ed25519 signature over the payload's UTF-8
 *     bytes (the registry's `attest` verification shape, byte-for-byte
 *     the desktop test's `ed25519Sign(null, Buffer.from(nonce), key)`).
 * - **Tests + harness**: `NodeCryptoDriver` below — REAL node:crypto
 *   Ed25519 (the desktop auth suite's precedent: the verifier is never
 *   mocked; every test generates a real keypair and signs real
 *   nonces, and the signature verifies against the registered public
 *   key with `ed25519Verify`).
 */

/** A generated device keypair: both halves base64. The PRIVATE half is
 * keystore material — it may flow to `SecureStorePort` and to
 * `CryptoPort.sign`, nowhere else (SECURITY §3). */
export interface DeviceKeypair {
  /** base64 DER SPKI (or raw 32-byte) public key — registered with the
   * server at POST /api/v1/devices (`deviceKeyPublic`). */
  readonly publicKey: string;
  /** base64 PKCS8 private key — SecureStore-held on device. */
  readonly privateKey: string;
}

/**
 * The Ed25519 device-keypair seam. `sign` is keyed by the base64
 * private key (the device impl may hold the key hardware-backed and
 * treat the string as an opaque handle — the signature contract is
 * what matters, never the key's resting place).
 */
export interface CryptoPort {
  /** Generate a fresh Ed25519 keypair for device registration. */
  generateKeypair(): Promise<DeviceKeypair>;
  /** Sign `payload`'s UTF-8 bytes with the private key → base64
   * signature (the attest route's verification shape). */
  sign(payload: string, privateKey: string): Promise<string>;
}

/** Verify a base64 signature against a base64 public key over a
 * payload's UTF-8 bytes — the TEST-side mirror of the server's
 * `attest` verification (used by the auth suite to prove the nonce
 * signature is real Ed25519, never a stub). */
export function verifyEd25519Signature(
  payload: string,
  publicKeyBase64: string,
  signatureBase64: string,
): boolean {
  try {
    return ed25519Verify(
      null,
      Buffer.from(payload, "utf8"),
      importEd25519Public(publicKeyBase64),
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    // Unparseable key/signature material → not verified (fail closed,
    // quietly — the server's ATTESTATION_FAILED shape).
    return false;
  }
}

/** Import a base64 public key (DER SPKI or raw 32-byte — the registry
 * accepts both, so the test mirror does too). */
function importEd25519Public(publicKeyBase64: string): ReturnType<typeof createPublicKey> {
  const der = Buffer.from(publicKeyBase64, "base64");
  if (der.length === 32) {
    // Raw 32-byte Ed25519 public key → wrap in the SPKI prefix the
    // node importer understands (302a300506032b6570032100 || key).
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), der]);
    return createPublicKey({ key: spki, format: "der", type: "spki" });
  }
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/**
 * The Node test/harness driver: REAL Ed25519 via node:crypto (the
 * desktop auth suite's exact keypair/sign shapes —
 * `generateKeyPairSync("ed25519")`, SPKI/PKCS8 DER base64, and
 * `sign(null, payload, key)`). The W3 chaos harness (T-P22-3-a) reuses
 * this driver to drive attestation against the REAL server surface.
 */
export const NodeCryptoDriver: CryptoPort = {
  async generateKeypair(): Promise<DeviceKeypair> {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    return {
      publicKey: (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64"),
      privateKey: (privateKey.export({ type: "pkcs8", format: "der" }) as Buffer).toString("base64"),
    };
  },

  async sign(payload: string, privateKey: string): Promise<string> {
    const key = createPrivateKey({
      key: Buffer.from(privateKey, "base64"),
      format: "der",
      type: "pkcs8",
    });
    return ed25519Sign(null, Buffer.from(payload, "utf8"), key).toString("base64");
  },
};
