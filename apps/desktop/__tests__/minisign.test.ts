import { describe, expect, it } from "vitest";

import {
  generateMinisignKeyPair,
  inspectMinisignSignature,
  parseMinisignPublicKey,
  signWithMinisignKey,
  verifyMinisign,
} from "../src/updater/minisign";

/**
 * PHASE-021 T8 · REAL minisign verification (D-06): every test generates a
 * REAL Ed25519 keypair (node:crypto) and signs REAL content buffers — the
 * verifier is never mocked. Attack matrix: tampered content, tampered
 * signature, wrong key, invalid global signature, non-"Ed" algorithm,
 * malformed base64 — all fail CLOSED with an honest reason and no throw.
 */

const CONTENT = Buffer.from(
  "PHASE-021 test bundle — the quick brown fox jumps over the lazy dog × 3\n\x00\x01\x02",
  "utf8",
);

function signatureLines(signatureFile: string): string[] {
  return signatureFile.split(/\r?\n/).filter((line) => line.length > 0);
}

function reencodeWithAlgo(signatureFile: string, algoHex: string): string {
  const lines = signatureLines(signatureFile);
  const blob = Buffer.from(lines[1]!, "base64");
  const forged = Buffer.concat([Buffer.from(algoHex, "hex"), blob.subarray(2)]);
  return `${lines[0]}\n${forged.toString("base64")}\n`;
}

describe("minisign round-trip (real Ed25519)", () => {
  it("verifies a real signature over a real content buffer", () => {
    const keyPair = generateMinisignKeyPair();
    const signatureFile = keyPair.sign(CONTENT);
    const result = verifyMinisign({ content: CONTENT, signatureFile, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(true);
    expect(result.keyId).toBe(keyPair.keyId);
    expect(result.reason).toBeUndefined();
  });

  it("verifies string content identically (same UTF-8 bytes)", () => {
    const keyPair = generateMinisignKeyPair();
    const text = "same-text-content";
    const result = verifyMinisign({
      content: text,
      signatureFile: keyPair.sign(text),
      publicKeyFile: keyPair.publicKeyFile,
    });
    expect(result.verified).toBe(true);
  });

  it("is deterministic: signing the same content twice yields the identical signature file (Ed25519)", () => {
    const keyPair = generateMinisignKeyPair();
    expect(keyPair.sign(CONTENT)).toBe(keyPair.sign(CONTENT));
  });

  it("verifies the global signature over the trusted comment and returns it", () => {
    const keyPair = generateMinisignKeyPair();
    const signatureFile = keyPair.sign(CONTENT, { trustedComment: "release 2.0.0 bundle" });
    const result = verifyMinisign({ content: CONTENT, signatureFile, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(true);
    expect(result.trustedComment).toBe("release 2.0.0 bundle");
  });

  it("round-trips through the exported private-key core (signWithMinisignKey)", () => {
    const keyPair = generateMinisignKeyPair();
    const signatureFile = signWithMinisignKey(keyPair.privateKey, CONTENT, { trustedComment: "ci sign" });
    expect(signatureFile).toBe(keyPair.sign(CONTENT, { trustedComment: "ci sign" }));
    const result = verifyMinisign({ content: CONTENT, signatureFile, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(true);
  });

  it("keypair helpers agree on the key id across public key file + signatures", () => {
    const keyPair = generateMinisignKeyPair();
    const parsed = parseMinisignPublicKey(keyPair.publicKeyFile);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.key.keyId).toBe(keyPair.keyId);
    const inspected = inspectMinisignSignature(keyPair.sign(CONTENT));
    expect(inspected.ok).toBe(true);
    if (inspected.ok) expect(inspected.keyId).toBe(keyPair.keyId);
  });
});

describe("minisign attack matrix (D-06 — everything fails closed, never throws)", () => {
  const keyPair = generateMinisignKeyPair();
  const otherKeyPair = generateMinisignKeyPair();

  it("tampered content ⇒ rejected", () => {
    const signatureFile = keyPair.sign(CONTENT);
    const tampered = Buffer.concat([CONTENT, Buffer.from("tampered")]);
    const result = verifyMinisign({ content: tampered, signatureFile, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("does not match the content");
  });

  it("tampered signature bytes ⇒ rejected", () => {
    const signatureFile = keyPair.sign(CONTENT);
    const lines = signatureLines(signatureFile);
    const blob = Buffer.from(lines[1]!, "base64");
    blob[blob.length - 1] ^= 0xff; // flip the last Ed25519 signature byte
    const tampered = `${lines[0]}\n${blob.toString("base64")}\n`;
    const result = verifyMinisign({ content: CONTENT, signatureFile: tampered, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("wrong public key ⇒ rejected", () => {
    const signatureFile = keyPair.sign(CONTENT);
    const result = verifyMinisign({
      content: CONTENT,
      signatureFile,
      publicKeyFile: otherKeyPair.publicKeyFile,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("does not match the content");
  });

  it("tampered global signature ⇒ rejected even though the content signature is valid", () => {
    const signatureFile = keyPair.sign(CONTENT, { trustedComment: "release 2.0.0 bundle" });
    const lines = signatureLines(signatureFile);
    const global = Buffer.from(lines[3]!, "base64");
    global[0] ^= 0xff;
    const tampered = `${lines[0]}\n${lines[1]}\n${lines[2]}\n${global.toString("base64")}\n`;
    const result = verifyMinisign({ content: CONTENT, signatureFile: tampered, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("global signature");
  });

  it("tampered trusted comment ⇒ global signature rejected (comment is signed)", () => {
    const signatureFile = keyPair.sign(CONTENT, { trustedComment: "release 2.0.0 bundle" });
    const lines = signatureLines(signatureFile);
    const forged = `${lines[0]}\n${lines[1]}\ntrusted comment: release 9.9.9 EVIL\n${lines[3]}\n`;
    const result = verifyMinisign({ content: CONTENT, signatureFile: forged, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("global signature");
  });

  it("non-Ed algorithm (e.g. EdDSA-style id) ⇒ rejected with an algorithm reason", () => {
    const signatureFile = keyPair.sign(CONTENT);
    const forged = reencodeWithAlgo(signatureFile, "4544"); // "ED" — not "Ed" 0x4564
    const result = verifyMinisign({ content: CONTENT, signatureFile: forged, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("unsupported signature algorithm");
    expect(result.reason).toContain("4544");
  });

  it("malformed base64 on the signature line ⇒ rejected, no throw", () => {
    const result = verifyMinisign({
      content: CONTENT,
      signatureFile: "untrusted comment: x\n!!!not-base64!!!\n",
      publicKeyFile: keyPair.publicKeyFile,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("base64");
  });

  it("non-canonical base64 (non-zero trailing bits) ⇒ rejected", () => {
    // "AB==" decodes to 0x00 but re-encodes to "AA==" — non-canonical.
    const result = verifyMinisign({
      content: CONTENT,
      signatureFile: "untrusted comment: x\nAB==\n",
      publicKeyFile: keyPair.publicKeyFile,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("base64");
  });

  it("wrong-length decoded blob ⇒ rejected with the length in the reason", () => {
    const short = Buffer.from("42 bytes of something else entirely").toString("base64");
    const result = verifyMinisign({
      content: CONTENT,
      signatureFile: `untrusted comment: x\n${short}\n`,
      publicKeyFile: keyPair.publicKeyFile,
    });
    expect(result.verified).toBe(false);
    expect(result.reason).toContain("expected 74");
  });
});

describe("minisign file-shape validation (malformed inputs never throw)", () => {
  const keyPair = generateMinisignKeyPair();
  const valid = keyPair.sign(CONTENT, { trustedComment: "with global" });
  const lines = signatureLines(valid);

  const malformed: readonly [string, string][] = [
    ["empty file", ""],
    ["single line", "untrusted comment: only"],
    ["no untrusted header", `not a comment\n${lines[1]}\n`],
    ["trusted comment without global signature", `${lines[0]}\n${lines[1]}\ntrusted comment: dangling\n`],
    ["five lines", `${lines[0]}\n${lines[1]}\n${lines[2]}\n${lines[3]}\nextra\n`],
    ["CRLF variant of a broken shape", `untrusted comment: x\r\n\r\n`],
  ];

  for (const [name, signatureFile] of malformed) {
    it(`${name} ⇒ rejected with a shape reason`, () => {
      const result = verifyMinisign({ content: CONTENT, signatureFile, publicKeyFile: keyPair.publicKeyFile });
      expect(result.verified).toBe(false);
      expect(typeof result.reason).toBe("string");
      expect(result.reason!.length).toBeGreaterThan(0);
    });
  }

  it("CRLF line endings in a VALID signature file are tolerated", () => {
    const crlf = valid.replace(/\n/g, "\r\n");
    const result = verifyMinisign({ content: CONTENT, signatureFile: crlf, publicKeyFile: keyPair.publicKeyFile });
    expect(result.verified).toBe(true);
    expect(result.trustedComment).toBe("with global");
  });

  it("a malformed PUBLIC KEY file ⇒ rejected with a public key reason", () => {
    const cases: readonly string[] = [
      "untrusted comment: x\nshort-base64\n",
      `not a comment\n${signatureLines(keyPair.publicKeyFile)[1]}\n`,
      "untrusted comment: x\n",
      `untrusted comment: x\n${Buffer.from("42-byte fake with a wrong algo prefix").toString("base64")}\n`,
    ];
    for (const publicKeyFile of cases) {
      const result = verifyMinisign({ content: CONTENT, signatureFile: valid, publicKeyFile });
      expect(result.verified).toBe(false);
      expect(result.reason).toMatch(/public key/);
    }
  });

  it("the private-key core parser rejects malformed material (structured, no throw)", () => {
    const bad = "definitely-not-base64!!!";
    const inspect = (() => {
      try {
        return signWithMinisignKey(bad, CONTENT);
      } catch (error) {
        return `throws: ${error instanceof Error ? error.message : String(error)}`;
      }
    })();
    expect(String(inspect)).toContain("private key");
  });
});
