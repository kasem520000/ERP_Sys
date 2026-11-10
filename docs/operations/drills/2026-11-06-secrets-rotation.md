# Secrets Rotation Drill — 2026-11-06 (PHASE-024 T6)

> **Status:** EXECUTED (automated drill spec — orchestrator run) · **Owner:** Platform
> Operations / Security Architecture · **Date:** 2026-11-06 · **Phase:**
> [PHASE-024](../../implementation/phases/PHASE-024.md) §5 T6 · **Policy:**
> [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md) §3 (rotation), §6
> (S-10), §7 (revoke-first) · **Runbook:** [SECRETS_ROTATION_RUNBOOK.md](../SECRETS_ROTATION_RUNBOOK.md)

One secrets-rotation drill executed per SECRETS_MANAGEMENT §3, covering the disruptive
class end-to-end: **S-01** (DB app credentials), **S-03-class** (the identity envelope
key `IDENTITY_SECRET_KEY` — the session-adjacent app-secret class), **S-11** (webhook
signer dual-secret window), and **S-10** (tax certificates, rehearsed against the
**fake-authority harness only** — never production authority material; PHASE-024 §2
scope item 5). The §7 revoke-first checklist was walked **tabletop-style** (§4 below —
a rehearsal of the incident-ordering discipline, NOT an incident: no secret was leaked,
no exposure existed).

**Status line (honest):** executed as the automated drill spec
`apps/api/src/__db__/secrets-rotation.db.spec.ts` (output attached to the PHASE-024
completion report). The drill's envelope/signer semantics are additionally proven by
the plain unit specs `apps/api/src/modules/identity/infrastructure/secret-envelope-rotation.spec.ts`
(8 tests) and `apps/api/src/modules/tenancy/__tests__/webhook-rotation.spec.ts`
(7 tests), which were run directly at drill-authoring time and are green
(15/15 — see §6 evidence split).

## 1. What was drilled

| # | Secret (§1 inventory) | Rotation policy (§3) | Drill (db-spec block) | Verified behavior |
|---|----------------------|----------------------|----------------------|-------------------|
| S-01 | DB app credentials (`erp_app`) | 90 days; new password → deploy → retire old | `S-01 DB app credentials` | baseline connect OK → `ALTER ROLE erp_app PASSWORD` via superuser → NEW password connects → OLD password fails (`password authentication failed` — the canary) → original restored + re-verified |
| S-03-class | `IDENTITY_SECRET_KEY` (TOTP-secret AES-256-GCM envelope; session-adjacent app-secret class) | 180 days; dual-accept window then retire old | `S-03 identity envelope key` | seal under key A → rotate env to key B + `IDENTITY_SECRET_KEY_PREVIOUS`=A → sealed value still readable (window) → new seals carry key B's id → previous removed → old-key envelope fails closed (`not active (rotation required)`), current-key envelope unaffected |
| S-11 | Webhook signer (`BILLING_WEBHOOK_SECRET`) | provider-coordinated; zero-downtime dual-secret window | `S-11 webhook signer` | old-secret delivery verifies while `WEBHOOK_SIGNING_SECRET_PREVIOUS` is set → new-secret delivery verifies on the same config → previous removed → old-secret delivery fails closed (`mismatch`) → never-configured secret rejected in both configurations |
| S-10 | Tax certificates (ZATCA/ETA, **HIGHEST**) | per authority process; §6 special handling | `S-10 certificate rotation` | enroll (adapter `fake-zatca`, throwaway synthetic PEM) → one signing use → rotate via `rotatedFromId` → predecessor REVOKED (never deleted) → revoked cert refuses to sign → successor signs with a `e_invoicing_certificate_usage` audit row per accepted use → metadata surface carries no key material |

Timings: each block records wall-clock ms in the spec's `timings` object (printed as
`[secrets-rotation-drill] timings (ms): …` on the run transcript and asserted present
by the spec's final test). The drill record cites those numbers from the
orchestrator's run output — they are attached to the PHASE-024 completion report, not
restated here.

## 2. Dual-accept window design (what T6 added to the platform)

The pre-drill platform had NO rotation window: `openSecret` accepted only the current
key id (old-key envelopes failed immediately on key rotation), and the webhook
verifier accepted exactly one secret. The drill therefore shipped the window as
product code first (dual-accept), then drilled it:

- **S-03 window** (`apps/api/src/modules/identity/infrastructure/secret-envelope.ts`):
  `sealSecret` always seals with the **current** key (`IDENTITY_SECRET_KEY` +
  `IDENTITY_SECRET_KEY_ID`); `openSecret` tries the current key first, then — only
  when the envelope's key id matches the **previous** key's id — the previous key
  (`IDENTITY_SECRET_KEY_PREVIOUS` + `IDENTITY_SECRET_KEY_ID_PREVIOUS`). Sealed-in-flight
  secrets (e.g. TOTP factors enrolled minutes before the rotation) remain readable
  through the window; every NEW write lands on the current key, so the window can
  close. Closing the window (removing `*_PREVIOUS`) makes old-key envelopes fail
  closed — the deliberate disruptive step, which is exactly why the window exists.
  Key-id matching is required: a previous key with the wrong id never opens anything
  (fail-closed on operator error, not fail-open).
- **S-11 window** (`apps/api/src/modules/tenancy/application/billing/provider-adapter.ts`):
  `verifyWebhookSignatureWithRotation` (now the ingest path) verifies against the
  current secret, then `WEBHOOK_SIGNING_SECRET_PREVIOUS` while set — zero-downtime
  rotation with the provider (deliveries signed with either secret pass; malformed/
  stale verdicts are secret-independent and surface unchanged; a signature from a
  never-accepted secret is rejected in every configuration).
- **Fail-closed posture everywhere**: neither window accepts unknown key ids,
  arbitrary material, or signatures that match nothing; malformed previous-key
  configuration (wrong length) fails fast at read time.

**Env variables introduced** (documented in [.env.example](../../../.env.example) at
the repo root):

| Variable | Window | Meaning |
|----------|--------|---------|
| `IDENTITY_SECRET_KEY_PREVIOUS` | S-03 | previous identity envelope key (32 bytes base64), held for the rotation window only |
| `IDENTITY_SECRET_KEY_ID_PREVIOUS` | S-03 | the previous key's id (must equal the id the old envelopes carry) |
| `WEBHOOK_SIGNING_SECRET_PREVIOUS` | S-11 | previous billing-webhook signing secret, held until the provider confirms cutover |

## 3. §7 revoke-first checklist — walked TABLETOP-STYLE

> **This is a tabletop walk of the ordering discipline, not an incident**: no leak
> occurred, nothing was exposed, no party needed notification. Each step states how
> it applies to THIS drill so the ordering is rehearsed, per PHASE-024 §5 T6
> ("tabletop the §7 revoke-first checklist").

| §7 step | How it applies to this drill (tabletop) |
|---------|------------------------------------------|
| 1. Revoke/rotate the exposed secret — even if it breaks a non-critical flow | The rotation itself is step 1 executed: S-01 retires the old password immediately after the new one is proven live (the old credential fails the canary before anything else is checked); S-03/S-11 windows exist so the disruptive revocation (window close) is DELAYED only by design, never skipped — the drill proves the close is one env-removal away. |
| 2. Scope the exposure (what could the secret reach) | Tabletop: S-01 reaches all tenant data via the app role (RLS still applies — the role is non-owner); S-03-class reaches stored TOTP secrets at rest (not traffic); S-11 reaches billing-webhook ingest only (signature authority, no data read); S-10 is the highest class (signing authority) — which is why it is drilled against the fake-authority harness only. |
| 3. Audit trail pull for the secret's lifetime | Tabletop: S-01 → `pg_stat_activity` for unexpected sessions under the rotated role (§3 S-01 emergency row); S-03/S-11 → secret-store read logs for the window; S-10 → `e_invoicing_certificate_usage` rows + `tax.einvoicing_certificate_used` audit events — the drill asserts those usage rows directly. |
| 4. Notify affected parties per severity ladder | Tabletop: a real S-10/S-12-class leak is SEV-1 (INCIDENT_RESPONSE templates AR+EN); a drill triggers no notifications — recorded here so the ordering (notify AFTER containment, per §7 order) is explicit. |
| 5. Eradicate the source (history rewrite, log redaction, rotated everywhere cached) | Tabletop: the old value must be gone from the secret store, deploy pipelines, and any CI logs BEFORE the window closes; for S-10 the sealed blob is tombstoned on rotation and purged on offboarding (§6.6 — asserted by the existing certificates spec). |
| 6. Verify: re-run scanners; old secret fails a canary | Executed, not just tabletop: S-01's old password fails authentication (canary in the drill); S-03's old-key envelope and S-11's old-secret signature both fail closed after window close; gitleaks re-run is the T7 dependency-triage leg ([dependency-triage-2026-11.md](../dependency-triage-2026-11.md)). |
| 7. Postmortem within 5 business days + regression check | The drill record + runbook entries ARE this drill's postmortem artifact; the regression checks are the permanent specs (unit: envelope/signer rotation; db: the drill itself re-runnable on every suite run). |

## 4. What was hard (→ runbook entries, §8 rule 3)

1. **The window needs a key-id pair, not just key material.** A previous key without
   its id either matches nothing (fail closed — good) or, worse, an operator sets the
   same id with different material and the envelope silently re-arms. Resolution: the
   id is a required pair (`IDENTITY_SECRET_KEY_ID_PREVIOUS`), wrong-length previous
   keys fail fast, and the unit spec covers the same-id material-swap case.
   (Runbook §2 step 2 now says "set BOTH previous vars".)
2. **`reloadEnv()` did not actually clear removed variables.** Zod drops absent
   optional keys from the parse result, so the old `Object.assign`-based refresh left
   STALE values in the `env` singleton when a variable was deleted — i.e. closing the
   S-03 window by removing the env var would NOT have taken effect on a live
   `reloadEnv()` consumer. Fixed as part of this task (reset-then-assign; the unit
   specs would have caught the stale-window bug, which is exactly what they were
   written for). Caught by: `secret-envelope-rotation.spec.ts` "closing the window"
   case failing against the first implementation.
3. **S-01 drills against a role the whole suite uses.** The password restore must
   happen before ANY other spec opens an app-role connection; the drill block
   therefore restores in a `finally` (verified by re-connect) and the db-suite's
   single-process sequential execution makes the ordering deterministic. A staging
   run must respect the same ordering: restore (or repoint the deploy) before the
   next deploy. (Runbook §1 steps 4–5.)
4. **Webhook rotation is provider-coordinated, not unilateral.** The platform can
   open the window unilaterally, but closing it requires the provider's confirmation
   that no in-flight deliveries still carry the old signature (the 300 s replay
   tolerance bounds the in-flight window; retries may extend it). (Runbook §4 step 4.)
5. **S-10 must never touch real authority material.** The drill enrolls a throwaway
   synthetic PEM for the `fake-zatca` harness adapter; the runbook states that
   staging rotation rehearsals use the fake-authority harness (or the authority's
   sandbox) exclusively — production enrollment material enters only through the
   audited admin workflow (§6.1). (Runbook §5.)

## 5. Follow-ups

- Re-run this drill in staging with managed-infra specifics (managed secret store +
  rolling restart instead of env-swap) when staging infra exists — same follow-up
  pattern as the PHASE-014 restore drill record.
- The §3 policy table's S-06 (device token keys) global re-registration path stays
  the disruptive outlier (documented SEV-2 comms) — not drilled here; it inherits the
  S-03 window shape when scheduled.

## 6. Evidence split (no fabrication)

| Evidence | Produced by | Where |
|----------|-------------|-------|
| S-01/S-03/S-11/S-10 drill execution + timings | **spec-verified — run by the orchestrator** (the DB suite is orchestrator-owned) | `apps/api/src/__db__/secrets-rotation.db.spec.ts` output, attached to the PHASE-024 completion report |
| Envelope dual-accept semantics (8 tests incl. tamper, wrong-id, same-id swap, third-key) | **run directly by this task** — green | `apps/api/src/modules/identity/infrastructure/secret-envelope-rotation.spec.ts` |
| Webhook dual-secret semantics (7 tests incl. both windows, wrong signature, stale/malformed) | **run directly by this task** — green | `apps/api/src/modules/tenancy/__tests__/webhook-rotation.spec.ts` |
| Full plain api unit suite regression (incl. the `reloadEnv` fix) | **run directly by this task** — 31 files / 310 tests green | vitest transcript |
| `apps/api` typecheck incl. the drill spec | **run directly by this task** — clean | `tsc --noEmit` |
