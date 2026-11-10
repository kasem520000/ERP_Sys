/**
 * PHASE-021 T8 · the updater client state machine (MASTER-PLAN §1 item 8 /
 * §7): check → verify manifest signature (REAL minisign) → version gates
 * (downgrade REJECT, up-to-date) → staged-rollout cohort gate → minimum-
 * version gate (blocked + force-update flag) → download → verify the BUNDLE
 * signature (REAL Ed25519, D-06) → install (injected port) → relaunch.
 *
 * Ports are injected (UpdaterPorts) so the bridge HTTP wiring (W2) and the
 * specs can substitute transport/install fakes — the CRYPTO is never faked:
 * every signature check in this file runs the real minisign verifier.
 *
 * State semantics (W2-b UI surface): runUpdateCheck returns the TERMINAL
 * outcome; the transient states ("checking"/"available"/"downloading"/
 * "verifying"/"ready"/"installing") exist for the shell UI's own progress
 * modelling. "rejected" = a validity/security refusal (unsigned, tampered,
 * malformed, downgrade — D-06 fails closed); "failed" = an operational
 * error (fetch/transport/install); "blocked-min-version" = the running build
 * is below the manifest minimum — the app blocks with the update screen
 * (client concern) and drives the mandatory install via
 * downloadAndInstallUpdate (the same verified tail this module uses).
 *
 * Gate order is binding (MASTER-PLAN §7): a below-minimum device that is
 * NOT cohort-selected reports "not-selected" — force-update remedies
 * therefore publish at stagePercent 100 (see rollout.haltRemedy).
 */

import {
  evaluateVersionGate,
  isCohortSelected,
  parseManifest,
  verifyManifestSignature,
  type UpdaterManifest,
} from "./manifest";
import { verifyMinisign } from "./minisign";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "not-selected"
  | "up-to-date"
  | "downloading"
  | "verifying"
  | "ready"
  | "installing"
  | "relaunch"
  | "blocked-min-version"
  | "rejected"
  | "failed";

/** Transport + install seams, injected by the host (bridge http lands in
 * W2; specs inject fakes — ports may be fake, the crypto never is). */
export interface UpdaterPorts {
  /** Fetch the channel's manifest JSON (unknown — parseManifest validates). */
  fetchManifest(channel: string): Promise<unknown>;
  /** Download the signed update bundle bytes from the manifest URL. */
  fetchBundle(url: string): Promise<Buffer>;
  /** Install a VERIFIED bundle (the shell's updater install command). */
  install(bundle: Buffer, manifest: UpdaterManifest): Promise<void>;
}

export interface UpdateOutcome {
  readonly state: UpdateState;
  readonly manifest?: UpdaterManifest;
  /** Honest, human-readable reason — audit + UX surface for every refusal. */
  readonly reason?: string;
  /** true when the outcome is a minimum-version block (forced update). */
  readonly forceUpdate?: boolean;
}

export interface RunUpdateCheckInput {
  readonly currentVersion: string;
  readonly deviceId: string;
  readonly channel: string;
  /** Trusted minisign public keys — up to TWO during the S-15 rotation
   * dual-trust window; a bundle signed by EITHER is accepted. */
  readonly trustedPublicKeys: readonly string[];
  readonly ports: UpdaterPorts;
}

const BUNDLE_URL_PREFIX = "https://";

/** The verified tail shared by the happy path and the blocked-min-version
 * screen: https-enforce the bundle URL, download, verify the bundle
 * signature against EVERY trusted key (any verifies — dual-trust window),
 * install, relaunch. */
export async function downloadAndInstallUpdate(
  manifest: UpdaterManifest,
  trustedPublicKeys: readonly string[],
  ports: UpdaterPorts,
): Promise<UpdateOutcome> {
  const platform = manifest.platforms["windows-x86_64"];
  if (!platform.url.startsWith(BUNDLE_URL_PREFIX)) {
    return {
      state: "rejected",
      manifest,
      reason: `insecure bundle url rejected (https required): ${platform.url}`,
    };
  }
  let bundle: Buffer;
  try {
    bundle = await ports.fetchBundle(platform.url);
  } catch (error) {
    return {
      state: "failed",
      manifest,
      reason: `bundle download failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let firstReason = "no trusted public keys were provided";
  let verified = false;
  for (const publicKeyFile of trustedPublicKeys) {
    const result = verifyMinisign({
      content: bundle,
      signatureFile: platform.signature,
      publicKeyFile,
    });
    if (result.verified) {
      verified = true;
      break;
    }
    firstReason = result.reason ?? firstReason;
  }
  if (!verified) {
    return { state: "rejected", manifest, reason: `bundle signature verification failed: ${firstReason}` };
  }
  try {
    await ports.install(bundle, manifest);
  } catch (error) {
    return {
      state: "failed",
      manifest,
      reason: `install failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return {
    state: "relaunch",
    manifest,
    reason: `update ${manifest.version} installed — relaunch required`,
  };
}

/**
 * Run the full update check for one device. The outcome is terminal and
 * carries an honest reason for every non-happy path (D-06 evidence surface).
 */
export async function runUpdateCheck(input: RunUpdateCheckInput): Promise<UpdateOutcome> {
  let raw: unknown;
  try {
    raw = await input.ports.fetchManifest(input.channel);
  } catch (error) {
    return {
      state: "failed",
      reason: `manifest fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parsed = parseManifest(raw);
  if (!parsed.ok) {
    return { state: "rejected", reason: `invalid manifest: ${parsed.error}` };
  }
  const manifest = parsed.manifest;

  const signature = verifyManifestSignature(manifest, input.trustedPublicKeys);
  if (!signature.verified) {
    return { state: "rejected", manifest, reason: `manifest signature rejected: ${signature.reason}` };
  }

  const gate = evaluateVersionGate({
    currentVersion: input.currentVersion,
    offeredVersion: manifest.version,
    ...(manifest.minVersion !== undefined ? { minVersion: manifest.minVersion } : {}),
  });
  if (gate.decision === "rejected" || gate.decision === "up-to-date") {
    return { state: gate.decision === "rejected" ? "rejected" : "up-to-date", manifest, reason: gate.reason };
  }

  const stagePercent = manifest.rollout?.stagePercent ?? 100;
  if (!isCohortSelected(input.deviceId, input.channel, manifest.version, stagePercent)) {
    return {
      state: "not-selected",
      manifest,
      reason: `device not in the ${stagePercent}% rollout cohort for ${manifest.version} (channel ${input.channel})`,
    };
  }

  if (gate.decision === "force-update") {
    return {
      state: "blocked-min-version",
      manifest,
      reason: gate.reason,
      forceUpdate: true,
    };
  }

  return downloadAndInstallUpdate(manifest, input.trustedPublicKeys, input.ports);
}
