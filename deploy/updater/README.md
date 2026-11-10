# deploy/updater — the desktop updater manifest service (PHASE-021 T8/T12)

> Static-JSON hosting for the ERP Desktop signed auto-update channel
> ([ADR-0013]; PHASE-021 §2.7; DEPLOYMENT §7 client distribution). There is no
> server process: the "service" is a CDN-hosted directory layout plus the
> `scripts/updater-manifest.ts` CLI that signs and publishes it. The updater
> clients (the Tauri v2 Rust shell updater + the `@erp/desktop` TS client)
> fetch `latest.json` from this layout, verify the minisign signature
> (Ed25519 — SECRETS_MANAGEMENT **S-15**), and only then download/install.

## Layout

```
<cdn-root>/
  stable/                       ← one directory per channel (stable today)
    latest.json                 ← THE ONLY MUTABLE OBJECT — the live pointer
    1.0.0/
      manifest.json             ← immutable, identical to latest.json at publish
      ERP-Desktop_1.0.0_x64-setup.exe        (nsis artifact)
      ERP-Desktop_1.0.0_x64-setup.exe.sig    (tauri signer minisign signature)
      ERP-Desktop_1.0.0_x64_en-US.msi        (msi artifact)
    <version>/…                 ← every released version stays forever
```

- The updater endpoint template
  (`apps/desktop/src-tauri/tauri.conf.json` → `plugins.updater.endpoints`) is
  `https://updates.erp.example/stable/{{target}}/{{current_version}}` — the
  CDN maps `{{target}}/{{current_version}}` requests to `stable/latest.json`
  (a redirect or a rewrite both work; the clients follow them over HTTPS
  only).
- `latest.json` / `manifest.json` shape = `UpdaterManifest`
  (`apps/desktop/src/updater/manifest.ts`): `{version, pub_date,
  platforms: {"windows-x86_64": {signature, url}}, minVersion?, rollout?:
  {stagePercent, cohortSeed}, notes?}`.
  - `platforms.signature` carries the **minisign signature of the BUNDLE**
    (the stock Tauri v2 shape the Rust shell updater requires). The TS client
    re-verifies the downloaded bundle bytes against this exact signature
    before install (D-06 — the install boundary never trusts the transport).
  - `rollout.stagePercent` drives the deterministic cohort
    (`sha256(deviceId:channel:version)` — 10% → 50% → 100%, RELEASE_STRATEGY
    §Rollout). Manifests without a `rollout` block update everyone (backward
    compatible with plain Tauri manifests).

## Immutability rules

1. A versioned directory (`stable/<version>/`) is **written once, never
   modified, never deleted** — a client that already verified a version's
   signature must be able to re-download identical bytes forever (the updater
   caches aggressively; changing bytes under a live version breaks D-06 for
   every device that re-verifies).
2. `latest.json` is the only mutable file. Publishing a release = uploading
   the versioned dir, then atomically replacing `latest.json` (CDN object
   replace; no in-place edits).
3. The CDN serves HTTPS only (the clients reject non-https bundle URLs);
   cache `latest.json` for a SHORT TTL (≤ 5 min), versioned dirs for eternity.

## Publishing (the runbook)

```bash
# 1. (CI) assemble the manifest for the release — platforms.signature = the
#    tauri signer's .sig content for the nsis bundle (produced by
#    `cargo tauri build` with TAURI_SIGNING_PRIVATE_KEY set).
# 2. Sign the manifest with the channel key (S-15, CI secret — this repo's
#    script; mode "bundle" re-signs over the bundle bytes, mode default signs
#    the canonical manifest JSON):
pnpm tsx scripts/updater-manifest.ts sign \
  --manifest artifacts/manifest.json --key $UPDATE_SIGNING_KEY_FILE \
  --content artifacts/ERP-Desktop_1.0.0_x64-setup.exe
# 3. Publish the layout (dry-run locally; writes deploy/updater/dist by
#    default, or --out for the staging mount) + print these steps:
pnpm tsx scripts/updater-manifest.ts publish \
  --channel stable --version 1.0.0 --artifacts-dir artifacts \
  --pubkey $UPDATE_SIGNING_PUBKEY_FILE
# 4. Upload stable/1.0.0/ to the CDN (immutable), then swap stable/latest.json.
# 5. Verify the endpoint:
curl -fsSL https://updates.erp.example/stable/windows-x86_64/0.9.9
```

`--self-test` runs the REAL crypto round-trip (generated Ed25519 keypair →
manifest sign → verify → bundle sign → tamper-rejection → fixture parse →
cohort sanity) and is asserted by
`apps/desktop/__tests__/updater-manifest.test.ts`.

## The halt path (DR-P21-05)

When the crash-free-session rate drops below **98.5%** (trailing 24 h, ≥ 50
sessions — the `CRASH_FREE_GATES.halt` constant in `@erp/desktop`), the
rollout service emits the halt remedy: publish a `latest.json` whose
`minVersion` is the last-known-good version. Clients below `minVersion`
enter the blocked/force-update screen (the update installs through the same
verified path — no bypass). The remedy publishes at `stagePercent: 100`
(`haltRemedy` in `@erp/desktop/src/updater/rollout.ts`).

## Fixtures

`fixtures/stable/latest.json` + `fixtures/stable/1.0.0/manifest.json` pin the
schema for staging: version 1.0.0, platform `windows-x86_64`, rollout
`{stagePercent: 10, cohortSeed: "staging"}`, bilingual notes. Their
`signature` is a REAL minisign signature produced with a **throwaway keypair
whose private half was discarded at authoring time** — the fixtures are
format-exemplars and schema gates (`parseManifest` must accept them;
`--self-test` asserts it), NOT trust anchors: no client ships their key. The
production channel key lives only in CI secret storage (S-15).

## Rotation (S-15 dual-trust window)

Key rotation = publish a client update carrying BOTH pubkeys (old + new),
wait for adoption, then start signing with the new key. The TS client
accepts either trusted key (`verifyManifestSignature` dual-trust window);
the Rust shell's pubkey rides `plugins.updater.pubkey` in `tauri.conf.json`
(injected by CI — the `<set-by-CI>` placeholder is validated by
`scripts/check-desktop-shell.ts`).
