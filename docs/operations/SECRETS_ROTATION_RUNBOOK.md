# Secrets Rotation Runbook

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-06

Operational runbook for rotating the platform's disruptive secret classes per
[../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md) §3 (rotation
policy) — fed by the rotation drills (§6 drill log; SECRETS §8 rule 3: *any rotation
procedure executed in anger becomes a runbook entry*). Emergency (leak) rotations
follow the §7 **revoke-first** ordering — see §0 below — with
[../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) for severity and
comms. Related: [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md),
[DEPLOYMENT.md](DEPLOYMENT.md) §2 (rolling restart), the
[drill records](drills/) directory.

## 0. Revoke-first ordering (emergencies — §7)

For a LEAK (not routine rotation): **revoke before investigating** — an attacker with
a live secret erases traces while you read logs. Order: (1) rotate/withdraw the
exposed secret per the emergency column of §3, even if it breaks a non-critical flow
(availability < containment); (2) scope what it could reach; (3) pull audit trails
for its lifetime; (4) notify per severity ladder; (5) eradicate the source (store,
pipelines, caches, history); (6) verify — old value fails a canary, scanners re-run;
(7) postmortem ≤ 5 business days + regression check. Every routine procedure below
carries its emergency delta inline ("Emergency:").

## 1. S-01 — DB app credentials (`erp_app`)

Routine cadence: 90 days.

1. **Generate** the new password (`openssl rand -base64 24`, URL-safe it) — store it
   in the managed secret store under the deploy-scope path FIRST, marked
   `pending-cutover` (the running deploy still uses the old value).
2. **Verify the current state** — the API's `/health/live` is green and app-role
   connections work (baseline canary before touching anything).
3. **Set the new password** as the database superuser (deploy pipeline's migration
   scope — never the app role):
   `ALTER ROLE erp_app PASSWORD '<new>';`
4. **Deploy with the new value** (secret store → rolling restart per DEPLOYMENT §2).
   API + worker pick it up on reconnect; existing pooled connections survive until
   recycled — the restart forces the recycle.
5. **Verify**: new connections succeed (health checks green over a full restart
   cycle); a canary connection with the OLD password fails with
   `password authentication failed` (§7 step 6 — the proof the old credential is
   dead); `SELECT count(*) FROM pg_stat_activity WHERE usename = 'erp_app'` shows
   only expected connections.
6. **Retire**: remove the old value from the secret store's history scope and any
   pipeline caches. Never keep "the previous password" for S-01 — there is no
   dual-accept window for DB credentials (the cutover IS the restart).

**Rollback:** re-run `ALTER ROLE erp_app PASSWORD '<old>';` and re-deploy the old
value (step 3–4 reversed) — valid only if the old value was not yet retired from the
store. Emergency: rotate immediately (the steps above ARE the emergency procedure —
skip the 90-day clock), then audit `pg_stat_activity` for unexpected sessions and
check RLS denial counters for the exposure window.

## 2. S-03-class — app secrets with a dual-accept window (`IDENTITY_SECRET_KEY`)

Covers the AES-256-GCM envelope key for identity secrets (TOTP factors; the
session-adjacent app-secret class). Routine cadence: 180 days.

1. **Generate** the new key: `openssl rand -base64 32` (32 bytes exactly — the API
   fails fast on anything else) and pick a NEW key id (≤ 8 chars, e.g. `v2`).
2. **Open the window** — set, in the secret store, ALL FOUR values:
   `IDENTITY_SECRET_KEY` = new key, `IDENTITY_SECRET_KEY_ID` = new id,
   `IDENTITY_SECRET_KEY_PREVIOUS` = old key,
   `IDENTITY_SECRET_KEY_ID_PREVIOUS` = old id. The id pair is mandatory: a previous
   key whose id does not match the sealed envelopes' id opens nothing (fail closed),
   and omitting the id makes the window silently dead.
3. **Deploy** (rolling restart). During the window: `sealSecret` writes only the NEW
   key id; `openSecret` reads envelopes sealed under either key — secrets
   sealed-in-flight before the rotation (e.g. a TOTP enrollment minutes earlier)
   stay readable. No user-visible disruption.
4. **Verify**: new enrollments round-trip (enroll + verify TOTP); old factors still
   verify (the window is live — this is the drill's S-03 block); health green.
5. **Close the window** (after ≥ one full idle-timeout cycle, so nothing in flight
   still depends on old-key reads): REMOVE `IDENTITY_SECRET_KEY_PREVIOUS` and
   `IDENTITY_SECRET_KEY_ID_PREVIOUS` from the store, deploy again.
6. **Verify the close**: a pre-rotation sealed envelope now fails with
   `secret envelope key id <old> is not active (rotation required)` (fail closed —
   expected and wanted); current-key envelopes unaffected; old key material deleted
   from the store's history scope.

**Rollback:** reopen the window (step 2 with the roles swapped back) — the window is
bidirectional by construction. Emergency (leak): rotate + close the window in ONE
deploy (skip step 5's waiting period) and invalidate all sessions (users re-login,
audited — §3 S-03 emergency column); MFA re-enrollment self-serves through the
enrollment flow.

## 3. (reserved) — S-06 device token keys

Documented in §3 S-06: global device re-registration is the disruptive outlier
(SEV-2 comms required). When scheduled, it inherits the §2 window shape; not yet
drilled — see the drill record §5 follow-ups.

## 4. S-11 — webhook signers (`BILLING_WEBHOOK_SECRET`)

Provider-coordinated; the platform cannot rotate unilaterally. Routine: provider
portal policy.

1. **Generate** the new signing secret and register it with the provider per their
   portal's rotation flow (the provider decides when deliveries switch to it).
2. **Open the window**: set `BILLING_WEBHOOK_SECRET` = new secret AND
   `WEBHOOK_SIGNING_SECRET_PREVIOUS` = old secret in the store. Deploy.
   Verification now accepts deliveries signed with EITHER secret (current first) —
   zero-downtime cutover while the provider's delivery fleet rolls over.
3. **Verify**: monitor webhook ingest — both old-secret and new-secret deliveries
   process (200, no `WEBHOOK_SIGNATURE_INVALID`); replay-verify recent callbacks per
   §3 S-11 (the idempotency key `webhook:{eventId}` makes re-delivery a no-op).
4. **Close the window** only after the provider CONFIRMS full cutover (all retries
   and queued deliveries carry the new signature; the 300 s timestamp tolerance
   bounds in-flight deliveries, provider retry policy may extend it): remove
   `WEBHOOK_SIGNING_SECRET_PREVIOUS`, deploy.
5. **Verify the close**: an old-secret-signed delivery now fails with
   `WEBHOOK_SIGNATURE_INVALID (mismatch)`; new deliveries unaffected; old secret
   retired from the store.

**Rollback:** reopen the window (step 2). Emergency (leak): rotate with the provider
immediately, keep the window open for one full provider retry cycle to absorb
in-flight deliveries, then reconcile recent webhook events (billing_events rows vs.
provider dashboard) for the exposure window.

## 5. S-10 — tax certificates (enroll/rotate via the service — HIGHEST class)

Routine: per authority process + the 30/14/7-day expiry ladder (§6.4); NEVER
improvised. Staging drills use the **fake-authority harness only** — production
authority material never enters staging (PHASE-024 §2 scope item 5).

1. **Obtain the new certificate** through the authority's re-enrollment process
   (out-of-band; the platform never generates authority key material). The platform
   admin receives the PEM through the approval-separated workflow
   (AUTHORIZATION_MATRIX; the enroll endpoint is an admin TRIGGER).
2. **Enroll + rotate in one audited call**: `enrollCertificate` with
   `rotatedFromId` = the current certificate's id. The service seals the blob under
   `einvoicing/{jurisdiction}/{tenant}/…` (S3 store, encrypted), records the chain
   (`rotated_from_id`), marks the predecessor REVOKED (never deleted — history), and
   writes the `tax.einvoicing_certificate_enrolled` audit event.
3. **Verify**: the new cert is ACTIVE and signs (`useForSigning` returns the new key
   version); the predecessor is REVOKED and REFUSES to sign; a
   `e_invoicing_certificate_usage` row exists for every accepted signing use (the
   usage audit, §6.3); the metadata surface (list endpoint) carries NO key material.
4. **Rollback**: re-enroll the predecessor as a NEW rotation (rotate back via
   `rotatedFromId` = the just-enrolled cert) — certificate history is append-only;
   there is no un-rotate. The authority's portal remains the source of truth for
   which certificate is live.
5. **Never**: copy key material outside the secret store, export it in tenant
   packages, or restore it from DB dumps (§6.5 — the store is external to the DB).
   Offboarding purges the tenant's cert paths (§6.6).

Emergency (suspected key compromise): SEV-1 immediately (INCIDENT_RESPONSE P-04);
revoke at the authority, enroll the replacement per above, and pull the
usage-audit + secret-store access logs for the certificate's whole lifetime
(§6.3/§6.6 give the trail).

## 6. Drill log (append-only)

| Date | Scope | Type | Result | Record |
|------|-------|------|--------|--------|
| 2026-11-06 | S-01 + S-03 + S-11 + S-10 (fake-authority harness) — PHASE-024 T6 | Automated drill spec (`apps/api/src/__db__/secrets-rotation.db.spec.ts`), §7 checklist tabletop | **PASSED** — output attached to the PHASE-024 completion report; timings printed by the spec (`[secrets-rotation-drill] timings (ms)`) | [drills/2026-11-06-secrets-rotation.md](drills/2026-11-06-secrets-rotation.md) |

Cadence: the drill spec re-runs with every DB-suite execution (regression); a
staging-grade run with the managed secret store + rolling restart is the recorded
follow-up obligation (drill record §5).
