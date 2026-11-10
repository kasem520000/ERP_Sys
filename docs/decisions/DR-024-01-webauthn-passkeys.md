# DR-024-01 — WebAuthn/passkeys MFA deferred to post-GA

> **Status:** ACCEPTED (decision: DEFER to post-GA) · **Date:** 2026-11-06 (decided
> in-phase, PHASE-024 T4) · **Approver:** Product Owner (architecture owner
> counter-sign — technical impact on the identity module) · **Related:**
> [../architecture/ADR/ADR-0015-authentication.md](../architecture/ADR/ADR-0015-authentication.md) §4
> (the roadmap item this record resolves) and its Revisit-triggers note,
> [PHASE-024](../implementation/phases/PHASE-024.md) §T4 + acceptance criterion 3
> ("the WebAuthn/passkeys decision record exists either way"),
> [../security/THREAT_MODEL.md](../security/THREAT_MODEL.md) S-02 (stolen-session
> residual explicitly pending this record), MFA gate evidence M-06/M-07
> ([../security/SECURITY_TEST_PLAN.md](../security/SECURITY_TEST_PLAN.md) §6)

## Context

ADR-0015 §4 specifies **TOTP (RFC 6238) with recovery codes** as the MFA factor and
lists WebAuthn/passkeys as "a roadmap item for PHASE-024+ (decision record), **not
launch-blocking**". PHASE-024 T4 is the phase that had to record the decision either
way. The context as of this phase:

- TOTP + recovery codes are shipped, tested (M-06 enrollment/verification, M-07
  recovery-code single-use — both green in the PHASE-024 gate re-run), and now
  **enforceable per role/plan** (plan-level `plans.mfa_required_role_keys`, tenant-level
  `identity.mfa.policy`, login-time 423 `MFA_REQUIRED` / enrollment bootstrap —
  PHASE-024 T4). The ADR-0015 §4 "mandatory-able per role/plan policy later" sentence
  is closed by that work — without WebAuthn.
- THREAT_MODEL S-02 (stolen live session) carries residual **M "until
  passkeys/WebAuthn land (PHASE-024+ decision record)"** — this record is the
  referenced decision: the residual stays M at GA, honestly, with phishing-resistant
  authentication as the post-GA improvement path.
- ADR-0015's own revisit trigger: "Passkey adoption in the region matures → promote
  WebAuthn to first-class."

## Options

| Option | Consequences |
|--------|--------------|
| **A. Implement WebAuthn/passkeys before GA** | Launch-blocking scope growth inside the security-hardening phase (which explicitly excludes "new product surface" and "any architecture change" — PHASE-024 §2 out-of-scope); requires a platform-attestation strategy (platform authenticators vs roaming keys vs both), a per-OS device matrix (web + Tauri desktop + Expo Android), a fallback policy when no authenticator is available (TOTP remains the fallback — so TOTP can never be removed anyway), and tenant-facing enrollment UX in AR+EN — a phase of work by itself |
| **B. Defer to post-GA; record the decision + revisit triggers now** | TOTP + recovery codes (both tested, now policy-enforceable) satisfy the MFA requirements at GA; S-02 residual honestly stays M; WebAuthn gets the dedicated phase its attestation/device-matrix/fallback questions deserve; matches ADR-0015 §4's own "not launch-blocking" and the "promote when regional adoption matures" note |
| **C. Reject WebAuthn permanently** | Closes the improvement path ADR-0015 itself keeps open; forecloses phishing-resistant authentication for a region where passkey adoption is actively growing; contradicts the ADR's revisit trigger — a product decision this record has no evidence to make |

## Decision

**Option B — DEFER to post-GA.** WebAuthn/passkeys are not implemented for GA. The
GA authentication surface is: passwords (argon2id, progressive lockout), TOTP MFA
with hashed recovery codes, per-role/per-plan MFA enforcement (PHASE-024 T4), and
rotating device tokens for the offline clients (ADR-0015 §1). This is the decision
ADR-0015 §4 deferred to "PHASE-024+ (decision record)": taken, recorded, and it
defers.

## Consequences

- The S-02 (stolen live session) residual stays **M** through GA; the compensating
  controls are the documented set (httpOnly cookies, 12h/30min expiry, server-side
  revocation, MFA step-up per policy, login notifications, reused-refresh
  revocation) — THREAT_MODEL §5 S-02 updated to point here instead of "PHASE-024+
  decision record".
- No WebAuthn code, schema, or contract ships in PHASE-024; the identity module's
  MFA substrate (factors, recovery codes, policy enforcement, admin reset
  `identity.mfa.admin_reset`) is the extension point a post-GA WebAuthn phase
  builds on.
- A post-GA WebAuthn phase must decide (its own record/ADR): platform-attestation
  strategy, the supported-authenticator device matrix (web/desktop/Android),
  fallback policy (TOTP remains the fallback), and enrollment/lockout UX in AR+EN.
- **Revisit triggers:** (1) a post-GA product decision to invest the phase (demand
  signal: enterprise tenants requiring phishing-resistant MFA in procurement); (2)
  ADR-0015's own trigger — regional passkey adoption maturing in the KSA/UAE
  target market (A-001); (3) any SEV-1/SEV-2 incident class whose root cause is
  credential phishing that TOTP does not mitigate.
- Superseding this record requires a new record (the decisions README rule — status
  changes never rewrite history).

## Approval requirements

- Product-owner signature (scope commitment) + architecture-owner counter-sign
  (identity-module impact). Evidence attached: PHASE-024 MFA gate re-run output
  (M-01…M-10 green under the new enforcement policies, including the enrollment
  bootstrap flow) proving TOTP + recovery codes meet the GA MFA requirement this
  decision relies on.
- On acceptance: THREAT_MODEL S-02 residual pointer updated (done in the PHASE-024
  T13 update cycle); ADR-0015 §4's roadmap note gains the "decided: deferred,
  post-GA" pointer; `CHANGELOG.md` entry per the decision process
  ([README.md](README.md) §4).
