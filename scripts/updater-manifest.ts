/**
 * PHASE-021 T8/T12 · `scripts/updater-manifest.ts` — the updater manifest
 * service CLI (MASTER-PLAN §1 item 8 / §8; DEPLOYMENT §7 updater hosting).
 * Signs and publishes the Tauri v2 updater manifests using the REAL minisign
 * implementation from @erp/desktop (apps/desktop/src/updater) — Ed25519 via
 * node:crypto, never mocked. Real signing keys exist only in CI secrets
 * (SECRETS_MANAGEMENT S-15); tests + --self-test generate throwaway REAL
 * keypairs.
 *
 * Modes:
 *   sign --manifest <path> --key <minisign-privkey-path> [--out <path>]
 *        Sign the manifest in "manifest" mode: a real minisign signature
 *        over the canonical manifest JSON (signature field blanked, fixed
 *        key order — canonicalManifestJson) written back into
 *        platforms["windows-x86_64"].signature. The TS updater client
 *        verifies this directly (verifyManifestSignature mode "manifest").
 *   sign --manifest <path> --key <…> --content <bundle-file>
 *        Sign in "bundle" mode instead: the signature over the BUNDLE bytes
 *        (the stock Tauri v2 shape — the Rust shell updater consumes this
 *        from latest.json; the TS client re-verifies the downloaded bundle
 *        bytes against the same signature before install, D-06).
 *        Both modes are round-trip VERIFIED immediately after signing.
 *   publish --channel stable --version <v> --artifacts-dir <dir>
 *          [--manifest <path>] [--out <dir>] [--url-base <base>]
 *          [--pubkey <minisign-pubkey-path>]
 *        Writes the hosting layout (deploy/updater/README.md):
 *          <out>/<channel>/<version>/manifest.json   (immutable, versioned)
 *          <out>/<channel>/<version>/<artifacts…>    (copied installers + sigs)
 *          <out>/<channel>/latest.json               (the live pointer)
 *        and prints the CDN runbook steps. Dry-run by design: no network
 *        access — uploading to the CDN is a documented human/CI step.
 *   --self-test
 *        REAL crypto end-to-end: generates an Ed25519 minisign keypair,
 *        builds a fixture manifest, signs it (manifest mode), verifies it,
 *        signs a bundle (bundle mode) and verifies the bytes, and parses the
 *        checked-in fixtures. Used by
 *        apps/desktop/__tests__/updater-manifest.test.ts (REAL round-trip,
 *        no mocks). Exit ≠ 0 on any failure.
 *
 * Key file format accepted by --key: the full minisign secret-key file shape
 * ("untrusted comment: …" line + base64 core) or a bare base64 core line —
 * the base64 of [algo(2) | key id(8) | seed(32) || public(32)]. This is the
 * UNENCRYPTED test/CI core (S-15: production keys live only in CI secret
 * storage; the scrypt-wrapped .key files are unwrapped by the signer
 * service, out of scope here by design — see @erp/desktop minisign docs).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  generateMinisignKeyPair,
  signWithMinisignKey,
  verifyMinisign,
  type MinisignKeyPair,
} from "../apps/desktop/src/updater/minisign";
import {
  canonicalManifestJson,
  isCohortSelected,
  parseManifest,
  signManifest,
  verifyManifestSignature,
  type UpdaterManifest,
} from "../apps/desktop/src/updater/manifest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// -- key helpers ----------------------------------------------------------------

/** Extracts the base64 secret-key core from a minisign secret-key file (or a
 * bare base64 line). Throws with an honest message on junk. */
export function readPrivateKeyCore(path: string): string {
  const contents = readFileSync(path, "utf8");
  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const base64Line =
    lines.find((line) => /^[A-Za-z0-9+/]+={0,2}$/.test(line) && !line.includes(":")) ?? "";
  if (base64Line.length === 0) {
    throw new Error(`${path}: no minisign secret-key core (expected a base64 line)`);
  }
  return base64Line;
}

/** Rebuilds the minisign PUBLIC key file from a secret-key core (the core
 * carries algo + key id + seed || public — the public blob is the last 32
 * bytes) so a sign run can immediately round-trip verify its own output. */
export function publicKeyFileFromCore(core: string): string {
  const blob = Buffer.from(core, "base64");
  if (blob.length !== 74) {
    throw new Error(`secret-key core is ${blob.length} bytes, expected 74`);
  }
  const publicBlob = Buffer.concat([blob.subarray(0, 10), blob.subarray(42, 74)]);
  const keyId = blob.subarray(2, 10).toString("hex");
  return `untrusted comment: minisign public key ${keyId}\n${publicBlob.toString("base64")}\n`;
}

// -- sign -------------------------------------------------------------------------

export interface SignOptions {
  manifestPath: string;
  keyPath: string;
  contentPath?: string;
  outPath?: string;
}

/** Signs a manifest (manifest mode, or bundle mode with contentPath) and
 * round-trip verifies the written signature. Returns the signed manifest. */
export function signManifestCli(options: SignOptions): UpdaterManifest {
  const manifestJson: unknown = JSON.parse(readFileSync(options.manifestPath, "utf8"));
  const parsed = parseManifest(manifestJson);
  if (!parsed.ok) throw new Error(`${options.manifestPath}: ${parsed.error}`);
  const core = readPrivateKeyCore(options.keyPath);
  const publicKeyFile = publicKeyFileFromCore(core);

  let signed: UpdaterManifest;
  let verification: ReturnType<typeof verifyManifestSignature>;
  if (options.contentPath !== undefined) {
    // Bundle mode: the signature covers the BUNDLE bytes (Tauri shape).
    const bundle = readFileSync(options.contentPath);
    const signature = signWithMinisignKey(core, bundle);
    signed = {
      ...parsed.manifest,
      platforms: { "windows-x86_64": { ...parsed.manifest.platforms["windows-x86_64"], signature } },
    };
    verification = verifyManifestSignature(signed, [publicKeyFile]);
    if (verification.verified) {
      // The manifest stage binds the key id; prove the BUNDLE bytes verify too.
      const bundleVerified = verifyMinisign({
        content: bundle,
        signatureFile: signature,
        publicKeyFile,
      });
      if (!bundleVerified.verified) {
        throw new Error(`bundle signature round-trip FAILED: ${bundleVerified.reason}`);
      }
    }
  } else {
    signed = signManifest(parsed.manifest, core);
    verification = verifyManifestSignature(signed, [publicKeyFile]);
  }
  if (!verification.verified) {
    throw new Error(`signature round-trip FAILED: ${verification.reason}`);
  }
  const outPath = options.outPath ?? options.manifestPath;
  writeFileSync(outPath, `${JSON.stringify(signed, null, 2)}\n`);
  console.log(
    `signed ${outPath} (${verification.verified ? `mode ${verification.mode}, key ${verification.keyId}` : "?"})`,
  );
  return signed;
}

// -- publish -----------------------------------------------------------------------

export interface PublishOptions {
  channel: string;
  version: string;
  artifactsDir: string;
  manifestPath?: string;
  outDir?: string;
  urlBase?: string;
  pubkeyPath?: string;
}

/** Publishes the hosting layout (dry-run: writes the local tree + prints the
 * CDN runbook; no network access by design). */
export function publishCli(options: PublishOptions): string {
  const manifestPath =
    options.manifestPath ?? join(options.artifactsDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest not found: ${manifestPath} (sign first, or pass --manifest)`);
  }
  const parsed = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!parsed.ok) throw new Error(`${manifestPath}: ${parsed.error}`);
  if (parsed.manifest.version !== options.version) {
    throw new Error(
      `manifest version ${parsed.manifest.version} ≠ --version ${options.version} (the immutable versioned dir must match)`,
    );
  }
  const trusted = options.pubkeyPath !== undefined ? [readFileSync(options.pubkeyPath, "utf8")] : [];
  if (trusted.length > 0) {
    const verification = verifyManifestSignature(parsed.manifest, trusted);
    if (!verification.verified) {
      throw new Error(`manifest signature verification failed: ${verification.reason}`);
    }
    console.log(`verified manifest signature (mode ${verification.mode}, key ${verification.keyId})`);
  } else {
    console.log("note: --pubkey not given — signature NOT verified (CI always passes it)");
  }

  const outRoot = resolve(options.outDir ?? join(repoRoot, "deploy/updater/dist"));
  const versionDir = join(outRoot, options.channel, options.version);
  mkdirSync(versionDir, { recursive: true });
  const manifestOut = join(versionDir, "manifest.json");
  writeFileSync(manifestOut, `${JSON.stringify(parsed.manifest, null, 2)}\n`);
  const latestOut = join(outRoot, options.channel, "latest.json");
  writeFileSync(latestOut, `${JSON.stringify(parsed.manifest, null, 2)}\n`);

  let copied = 0;
  if (existsSync(options.artifactsDir)) {
    for (const entry of readdirSync(options.artifactsDir)) {
      if (entry === "manifest.json") continue;
      cpSync(join(options.artifactsDir, entry), join(versionDir, entry));
      copied += 1;
    }
  }
  const urlBase = options.urlBase ?? "https://updates.erp.example";
  console.log(`published layout under ${versionDir} (${copied} artifact(s) copied)`);
  console.log(publishRunbook(urlBase, options.channel, options.version));
  return versionDir;
}

/** The human/CI steps after a publish run (deploy/updater/README.md §layout). */
export function publishRunbook(urlBase: string, channel: string, version: string): string {
  return [
    "",
    "Runbook — finish the release (deploy/updater/README.md):",
    `  1. Upload ${channel}/${version}/ (manifest + artifacts) to the CDN — IMMUTABLE (never overwrite a versioned dir).`,
    `  2. Point ${channel}/latest.json at this release (the file above) — this is the ONLY mutable object.`,
    `  3. Verify: curl ${urlBase}/${channel}/{{target}}/{{current_version}} returns the manifest (the updater endpoint template).`,
    `  4. Rollout: keep rollout.stagePercent from the manifest (10 → 50 → 100, crash-free gates; ${channel} channel).`,
    `  5. HALT path (crash-free < 98.5%): publish a latest.json with minVersion = ${version} (force-update remedy, DR-P21-05).`,
    "",
  ].join("\n");
}

// -- self-test -----------------------------------------------------------------------

export interface SelfTestResult {
  readonly manifestMode: { verified: true; keyId: string };
  readonly bundleMode: { verified: true; keyId: string };
  readonly fixturesParsed: string[];
  readonly cohortSampled: number;
}

/** REAL crypto end-to-end: keypair → manifest sign → verify → bundle sign →
 * byte-verify → fixture parse → cohort sanity. Throws on any failure. */
export function runSelfTest(): SelfTestResult {
  const pair: MinisignKeyPair = generateMinisignKeyPair();
  const fixture: UpdaterManifest = {
    version: "1.0.0",
    pub_date: "2026-11-04T12:00:00Z",
    platforms: {
      "windows-x86_64": { signature: "", url: "https://updates.erp.example/stable/1.0.0/ERP-Desktop_1.0.0_x64-setup.exe" },
    },
    rollout: { stagePercent: 10, cohortSeed: "staging" },
    notes: "self-test fixture",
  };

  // Manifest mode: canonical JSON signed + verified.
  const signed = signManifest(fixture, pair.privateKey);
  const manifestVerification = verifyManifestSignature(signed, [pair.publicKeyFile]);
  if (!manifestVerification.verified || manifestVerification.mode !== "manifest") {
    throw new Error(`self-test manifest mode failed: ${manifestVerification.reason}`);
  }
  // D3 nuance, asserted honestly: content tampering WITH the signature kept
  // fails manifest mode, but may still pass the manifest STAGE via bundle-mode
  // key-id binding (by design — the real D-06 enforcement happens on the
  // downloaded bundle bytes, client.ts). Two proofs the crypto is real:
  //   (a) tampered manifest content no longer verifies in manifest mode,
  //   (b) a FOREIGN key's signature on any manifest binds to no trusted key.
  const tampered = { ...signed, version: "9.9.9" };
  const tamperedVerification = verifyManifestSignature(tampered, [pair.publicKeyFile]);
  if (tamperedVerification.verified && tamperedVerification.mode === "manifest") {
    throw new Error("self-test: tampered manifest content verified in manifest mode — verifier broken");
  }
  const foreignPair = generateMinisignKeyPair();
  const foreignSigned = signManifest(tampered, foreignPair.privateKey);
  if (verifyManifestSignature(foreignSigned, [pair.publicKeyFile]).verified) {
    throw new Error("self-test: a foreign-key signature verified — trust boundary broken");
  }

  // Bundle mode: real bytes signed, verified against the same key material —
  // and TAMPERED bytes rejected (the D-06 install boundary).
  const bundle = Buffer.from("ERP Desktop self-test bundle — fake nsis payload", "utf8");
  const bundleSignature = pair.sign(bundle);
  const bundleVerification = verifyMinisign({
    content: bundle,
    signatureFile: bundleSignature,
    publicKeyFile: pair.publicKeyFile,
  });
  if (!bundleVerification.verified) {
    throw new Error(`self-test bundle mode failed: ${bundleVerification.reason}`);
  }
  const tamperedBundle = Buffer.concat([bundle, Buffer.from("tampered")]);
  if (
    verifyMinisign({ content: tamperedBundle, signatureFile: bundleSignature, publicKeyFile: pair.publicKeyFile })
      .verified
  ) {
    throw new Error("self-test: tampered bundle bytes verified — the D-06 boundary is broken");
  }
  const bundleManifest: UpdaterManifest = {
    ...signed,
    platforms: { "windows-x86_64": { ...signed.platforms["windows-x86_64"], signature: bundleSignature } },
  };
  const bundleManifestVerification = verifyManifestSignature(bundleManifest, [pair.publicKeyFile]);
  if (!bundleManifestVerification.verified || bundleManifestVerification.mode !== "bundle") {
    throw new Error(`self-test bundle-shaped manifest failed: ${bundleManifestVerification.reason}`);
  }

  // The checked-in fixtures must parse (structural parity with the schema).
  const fixturesDir = join(repoRoot, "deploy/updater/fixtures/stable");
  const fixturesParsed: string[] = [];
  const fixtureFiles = ["latest.json", "1.0.0/manifest.json"];
  for (const file of fixtureFiles) {
    const parsed = parseManifest(JSON.parse(readFileSync(join(fixturesDir, file), "utf8")));
    if (!parsed.ok) throw new Error(`fixture ${file}: ${parsed.error}`);
    fixturesParsed.push(file);
  }

  // Cohort sanity: a deterministic sample near the configured percentage.
  let cohortSampled = 0;
  const devices = Array.from({ length: 1000 }, (_, index) => `self-test-device-${index}`);
  for (const deviceId of devices) {
    if (isCohortSelected(deviceId, "stable", "1.0.0", 10)) cohortSampled += 1;
  }
  if (cohortSampled < 50 || cohortSampled > 150) {
    throw new Error(`self-test cohort distribution broken: ${cohortSampled}/1000 at 10%`);
  }

  return {
    manifestMode: { verified: true, keyId: manifestVerification.keyId },
    bundleMode: { verified: true, keyId: bundleVerification.keyId },
    fixturesParsed,
    cohortSampled,
  };
}

// -- CLI ------------------------------------------------------------------------------

function usage(): never {
  console.log(
    [
      "usage:",
      "  tsx scripts/updater-manifest.ts sign --manifest <path> --key <privkey-file> [--content <bundle>] [--out <path>]",
      "  tsx scripts/updater-manifest.ts publish --channel stable --version <v> --artifacts-dir <dir>",
      "    [--manifest <path>] [--out <dir>] [--url-base <base>] [--pubkey <pubkey-file>]",
      "  tsx scripts/updater-manifest.ts --self-test",
    ].join("\n"),
  );
  process.exit(1);
}

function readFlag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv: string[]): void {
  const mode = argv[0];
  if (mode === "--self-test") {
    const result = runSelfTest();
    console.log(
      `self-test PASS — manifest mode verified (key ${result.manifestMode.keyId}), ` +
        `bundle mode verified (key ${result.bundleMode.keyId}), fixtures parsed ` +
        `[${result.fixturesParsed.join(", ")}], cohort sample ${result.cohortSampled}/1000 at 10%`,
    );
    return;
  }
  if (mode === "sign") {
    const manifestPath = readFlag(argv, "--manifest");
    const keyPath = readFlag(argv, "--key");
    if (manifestPath === undefined || keyPath === undefined) usage();
    signManifestCli({
      manifestPath,
      keyPath,
      contentPath: readFlag(argv, "--content"),
      outPath: readFlag(argv, "--out"),
    });
    return;
  }
  if (mode === "publish") {
    const channel = readFlag(argv, "--channel");
    const version = readFlag(argv, "--version");
    const artifactsDir = readFlag(argv, "--artifacts-dir");
    if (channel === undefined || version === undefined || artifactsDir === undefined) usage();
    publishCli({
      channel,
      version,
      artifactsDir,
      manifestPath: readFlag(argv, "--manifest"),
      outDir: readFlag(argv, "--out"),
      urlBase: readFlag(argv, "--url-base"),
      pubkeyPath: readFlag(argv, "--pubkey"),
    });
    return;
  }
  usage();
}

const invokedAsScript =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`updater-manifest: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
