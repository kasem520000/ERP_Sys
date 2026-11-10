/**
 * PHASE-021 T8 · the updater manifest (Tauri v2 updater shape) + deterministic
 * staged-rollout cohort math + version/min-version gates (MASTER-PLAN §1
 * item 8 / §7; RELEASE_STRATEGY §Rollout; DEPLOYMENT_ARCHITECTURE client
 * distribution). Hand-rolled structural validation — @erp/desktop has no zod
 * dependency and gains none (add the field checks here instead).
 *
 * Cohort math (binding): `sha256(deviceId + ":" + channel + ":" + version)`,
 * first 8 bytes as a big-endian uint64 bucket. Selection is the EXACT
 * rational test `bucket/2^64 < stagePercent/100` — computed as
 * `bucket * 100 < stagePercent * 2^64` in BigInt so there is NO floating
 * point anywhere in the comparison (the plan's 2^256-spirit realized on the
 * first 8 bytes; identical inputs always hash to the same cohort, and the
 * distribution is even by SHA-256's avalanche).
 *
 * Manifest signatures — dual-trust key window (S-15 rotation, MASTER-PLAN
 * §1 item 8): during rotation the client carries up to TWO trusted public
 * keys and accepts a manifest/bundle signed by EITHER. Two publication
 * modes, both accepted by `verifyManifestSignature`:
 * - mode "manifest" — the signature field holds a REAL minisign signature
 *   over the canonical manifest JSON (this is what `signManifest` produces;
 *   manifest-level tests + the CI publish script use it);
 * - mode "bundle" — the signature field holds the minisign signature OF THE
 *   UPDATE BUNDLE (the stock Tauri v2 shape the Rust shell updater expects —
 *   `latest.json` must keep this form for the shell). The manifest stage
 *   binds it to a trusted key id and defers the full Ed25519 verification to
 *   the downloaded bundle (client.ts verifies the bundle bytes against this
 *   exact signature before install — D-06 is enforced there, with REAL
 *   crypto). Manifest transport is HTTPS per the updater-hosting runbook.
 */

import { createHash } from "node:crypto";

import {
  inspectMinisignSignature,
  parseMinisignPublicKey,
  signWithMinisignKey,
  verifyMinisign,
} from "./minisign";

/** The only desktop platform this phase ships (ADR-0013 Windows-first). */
export type UpdaterPlatform = "windows-x86_64";

export interface UpdaterManifest {
  readonly version: string;
  readonly pub_date: string;
  readonly platforms: {
    readonly "windows-x86_64": { readonly signature: string; readonly url: string };
  };
  /** Minimum acceptable CLIENT version — a client below this is blocked
   * with a forced-update screen (DR-P21-05 halt remedy rides this field). */
  readonly minVersion?: string;
  readonly rollout?: { readonly stagePercent: number; readonly cohortSeed?: string };
  readonly notes?: string;
}

export type ParseManifestResult =
  | { readonly ok: true; readonly manifest: UpdaterManifest }
  | { readonly ok: false; readonly error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Structural validation of an updater manifest (all fields checked; unknown
 * ADDITIVE fields are tolerated — forward compatibility, the Tauri updater
 * does the same). Returns a typed manifest or an honest field-named error.
 */
export function parseManifest(json: unknown): ParseManifestResult {
  if (!isPlainObject(json)) return { ok: false, error: "manifest: not a JSON object" };
  if (!nonEmptyString(json.version)) return { ok: false, error: "manifest.version: required non-empty string" };
  if (!nonEmptyString(json.pub_date)) return { ok: false, error: "manifest.pub_date: required non-empty string" };
  if (Number.isNaN(Date.parse(json.pub_date))) {
    return { ok: false, error: `manifest.pub_date: not a parseable date: ${json.pub_date}` };
  }
  const platforms = json.platforms;
  if (!isPlainObject(platforms)) return { ok: false, error: "manifest.platforms: required object" };
  const windows = platforms["windows-x86_64"];
  if (!isPlainObject(windows)) {
    return { ok: false, error: 'manifest.platforms["windows-x86_64"]: required object' };
  }
  if (!nonEmptyString(windows.signature)) {
    return { ok: false, error: 'manifest.platforms["windows-x86_64"].signature: required non-empty string' };
  }
  if (!nonEmptyString(windows.url)) {
    return { ok: false, error: 'manifest.platforms["windows-x86_64"].url: required non-empty string' };
  }
  if (json.minVersion !== undefined && !nonEmptyString(json.minVersion)) {
    return { ok: false, error: "manifest.minVersion: when present must be a non-empty string" };
  }
  if (json.rollout !== undefined) {
    if (!isPlainObject(json.rollout)) return { ok: false, error: "manifest.rollout: when present must be an object" };
    const stagePercent = json.rollout.stagePercent;
    if (typeof stagePercent !== "number" || !Number.isSafeInteger(stagePercent) || stagePercent < 0 || stagePercent > 100) {
      return { ok: false, error: "manifest.rollout.stagePercent: required integer in [0, 100]" };
    }
    if (json.rollout.cohortSeed !== undefined && !nonEmptyString(json.rollout.cohortSeed)) {
      return { ok: false, error: "manifest.rollout.cohortSeed: when present must be a non-empty string" };
    }
  }
  if (json.notes !== undefined && typeof json.notes !== "string") {
    return { ok: false, error: "manifest.notes: when present must be a string" };
  }
  return {
    ok: true,
    manifest: {
      version: json.version,
      pub_date: json.pub_date,
      platforms: {
        "windows-x86_64": { signature: windows.signature, url: windows.url },
      },
      ...(json.minVersion !== undefined ? { minVersion: json.minVersion } : {}),
      ...(json.rollout !== undefined
        ? {
            rollout: {
              stagePercent: json.rollout.stagePercent as number,
              ...(json.rollout.cohortSeed !== undefined ? { cohortSeed: json.rollout.cohortSeed as string } : {}),
            },
          }
        : {}),
      ...(json.notes !== undefined ? { notes: json.notes as string } : {}),
    },
  };
}

// -- staged-rollout cohort (deterministic, even, exact-integer math) ----------

/**
 * Deterministic cohort selection: `sha256(deviceId:channel:version)`, first
 * 8 bytes big-endian → bucket; selected iff `bucket/2^64 < stagePercent/100`
 * (exact BigInt rational comparison — no float rounding at all). 0% selects
 * nobody, 100% everybody; non-integer/negative percentages fail CLOSED
 * (nobody selected — a broken rollout config must never fan out).
 */
export function isCohortSelected(deviceId: string, channel: string, version: string, stagePercent: number): boolean {
  if (typeof stagePercent !== "number" || !Number.isFinite(stagePercent)) return false;
  if (stagePercent <= 0) return false;
  if (stagePercent >= 100) return true;
  if (!Number.isSafeInteger(stagePercent)) return false;
  const digest = createHash("sha256").update(`${deviceId}:${channel}:${version}`).digest();
  const bucket = digest.readBigUInt64BE(0);
  return bucket * 100n < BigInt(stagePercent) * 2n ** 64n;
}

// -- version comparison (semver + CalVer tolerance) ---------------------------

/**
 * Numeric segment-wise comparison, -1 | 0 | 1. Tolerates CalVer
 * (`2026.11.04` — leading zeros compare numerically, so `2026.11.4` equals
 * `2026.11.04`) and short forms (`109.0` vs `109.0.0.0` — missing segments
 * are zero). A NON-numeric segment sorts before a numeric one at the same
 * position, so `1.2.3-beta` < `1.2.3` (semver prerelease ordering). Two
 * non-numeric segments compare by code point (deterministic).
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const segmentsA = a.trim().split(".");
  const segmentsB = b.trim().split(".");
  const length = Math.max(segmentsA.length, segmentsB.length);
  for (let index = 0; index < length; index += 1) {
    const left = segmentsA[index] ?? "0";
    const right = segmentsB[index] ?? "0";
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      const leftValue = Number(left);
      const rightValue = Number(right);
      if (leftValue < rightValue) return -1;
      if (leftValue > rightValue) return 1;
    } else if (leftNumeric !== rightNumeric) {
      // Prerelease ordering: the tagged side ("3-beta") sorts BEFORE the
      // plain release ("3") — 1.2.3-beta < 1.2.3.
      return leftNumeric ? 1 : -1;
    } else if (left < right) {
      return -1;
    } else if (left > right) {
      return 1;
    }
  }
  return 0;
}

// -- version + min-version gates ----------------------------------------------

export type VersionGateDecision = "update-available" | "up-to-date" | "rejected" | "force-update";

export interface VersionGateResult {
  readonly decision: VersionGateDecision;
  readonly reason: string;
}

/**
 * Downgrade policy + minimum-version enforcement (client gate order —
 * MASTER-PLAN §7: version compare first, cohort gate, then the min-version
 * gate):
 * 1. `offered < current` ⇒ REJECTED (downgrade attack — never install an
 *    older build than the running one, whatever else the manifest claims);
 * 2. `offered === current` ⇒ UP-TO-DATE (the channel offers nothing newer —
 *    even when a minVersion is set, a ban cannot be enforced without a
 *    newer offering);
 * 3. `minVersion` set and `current < minVersion` ⇒ FORCE-UPDATE (the
 *    running build is banned; the client blocks with the update screen —
 *    DR-P21-05);
 * 4. otherwise an update is available.
 */
export function evaluateVersionGate(input: {
  readonly currentVersion: string;
  readonly offeredVersion: string;
  readonly minVersion?: string;
}): VersionGateResult {
  const offeredToCurrent = compareSemver(input.offeredVersion, input.currentVersion);
  if (offeredToCurrent < 0) {
    return {
      decision: "rejected",
      reason: `downgrade rejected: offered ${input.offeredVersion} is older than current ${input.currentVersion}`,
    };
  }
  if (offeredToCurrent === 0) {
    return { decision: "up-to-date", reason: `current ${input.currentVersion} matches the offered version` };
  }
  if (input.minVersion !== undefined && compareSemver(input.currentVersion, input.minVersion) < 0) {
    return {
      decision: "force-update",
      reason: `current ${input.currentVersion} is below manifest minimum ${input.minVersion} — update required`,
    };
  }
  return {
    decision: "update-available",
    reason: `offered ${input.offeredVersion} is newer than current ${input.currentVersion}`,
  };
}

// -- manifest signatures (dual-trust window; see module header) ---------------

/**
 * The canonical form that gets signed: the manifest JSON with a FIXED key
 * order and the signature field BLANKED (a signature cannot sign itself).
 * `signManifest` and `verifyManifestSignature` agree on exactly this string.
 */
export function canonicalManifestJson(manifest: UpdaterManifest): string {
  const platform = manifest.platforms["windows-x86_64"];
  return JSON.stringify({
    version: manifest.version,
    pub_date: manifest.pub_date,
    platforms: { "windows-x86_64": { signature: "", url: platform.url } },
    ...(manifest.minVersion !== undefined ? { minVersion: manifest.minVersion } : {}),
    ...(manifest.rollout !== undefined
      ? {
          rollout: {
            stagePercent: manifest.rollout.stagePercent,
            ...(manifest.rollout.cohortSeed !== undefined ? { cohortSeed: manifest.rollout.cohortSeed } : {}),
          },
        }
      : {}),
    ...(manifest.notes !== undefined ? { notes: manifest.notes } : {}),
  });
}

export type ManifestSignatureResult =
  | {
      readonly verified: true;
      /** "manifest": the field is a real signature over the manifest JSON.
       * "bundle": the field is the Tauri bundle signature — bound to a
       * trusted key id here, fully Ed25519-verified on the downloaded
       * bundle bytes by client.ts before install. */
      readonly mode: "manifest" | "bundle";
      readonly keyId: string;
      readonly reason: string;
    }
  | { readonly verified: false; readonly reason: string };

/**
 * Verify the manifest's signature against up to two trusted public keys
 * (S-15 rotation dual-trust window): VERIFIED when ANY trusted key verifies
 * (mode "manifest" — real Ed25519 over the canonical manifest JSON) or when
 * the field is a well-formed minisign signature whose key id binds to a
 * trusted key (mode "bundle" — stock Tauri shape; the bundle bytes are
 * verified later). Anything else fails closed with an honest reason.
 */
export function verifyManifestSignature(manifest: UpdaterManifest, trustedPublicKeys: readonly string[]): ManifestSignatureResult {
  const signature = manifest.platforms["windows-x86_64"].signature;
  const canonical = canonicalManifestJson(manifest);
  let manifestFailure = "no trusted key verified the manifest signature";
  for (const publicKeyFile of trustedPublicKeys) {
    const result = verifyMinisign({ content: canonical, signatureFile: signature, publicKeyFile });
    if (result.verified) {
      return {
        verified: true,
        mode: "manifest",
        keyId: result.keyId,
        reason: `manifest signature verified by trusted key ${result.keyId}`,
      };
    }
    manifestFailure = result.reason ?? manifestFailure;
  }
  // Tauri-shaped manifest: the field signs the BUNDLE. Bind it to a trusted
  // key id now; client.ts runs the full Ed25519 verification on the bundle.
  const inspection = inspectMinisignSignature(signature);
  if (!inspection.ok) {
    return { verified: false, reason: `signature field is not a valid minisign signature: ${inspection.error}` };
  }
  for (const publicKeyFile of trustedPublicKeys) {
    const key = parseMinisignPublicKey(publicKeyFile);
    if (key.ok && key.key.keyId === inspection.keyId) {
      return {
        verified: true,
        mode: "bundle",
        keyId: inspection.keyId,
        reason:
          `Tauri bundle signature bound to trusted key ${inspection.keyId} ` +
          "(full Ed25519 verification runs on the downloaded bundle)",
      };
    }
  }
  return {
    verified: false,
    reason: `${manifestFailure}; bundle-signature key id ${inspection.keyId} matches no trusted key`,
  };
}

/**
 * Sign the canonical manifest JSON with a minisign private key (base64 core
 * from generateMinisignKeyPair) and return the manifest carrying the
 * signature. CI/test helper — production signing happens only in the
 * Windows CI workflow with store-backed keys (S-15).
 */
export function signManifest(manifest: UpdaterManifest, privateKey: string): UpdaterManifest {
  const signature = signWithMinisignKey(privateKey, canonicalManifestJson(manifest));
  return {
    ...manifest,
    platforms: { "windows-x86_64": { ...manifest.platforms["windows-x86_64"], signature } },
  };
}
