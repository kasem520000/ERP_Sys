# DR-016-03 — pos-terminal devices ride the identity `devices` table with session transport

> **Status:** ACCEPTED · **Owner:** Offline & API Architecture · **Date:** 2026-11-02
> (decided in-phase) · **Approver:** Architecture Owner · **Related:**
> [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §1 (device registration) + §11,
> [../architecture/ADR/ADR-0015-authentication.md](../architecture/ADR/ADR-0015-authentication.md),
> PHASE-003 (`devices` schema), PHASE-020 (Offline Sync Foundation)

## Context

SYNC_PROTOCOL §1 specifies scoped device credentials (rotating refresh + short-lived
access tokens bound to the capability subset) issued at registration — the generalized
device registry is **PHASE-020** scope. PHASE-016's terminals are browser terminals
operated by an authenticated cashier session (web BFF); §11 permits `pos-terminal`
devices with manual admin enrollment and attestation-lite optional. The terminal still
needs a device identity for revocation and per-device cursor bookkeeping
(`sync_cursors`).

## Options

| Option | Consequences |
|--------|--------------|
| **A. Build the full device-token plane now** | Scope growth past the §11 boundary — an explicit review blocker (RISK-004); duplicates PHASE-020 |
| **B. No device rows; sync on the operator session alone** | Loses per-device cursors and the revocation kill-switch (`DEVICE_REVOKED` pre-execution) |
| **C. Enroll pos-terminal `devices` rows manually; authenticate sync with the operator session; enforce revocation pre-execution** | Stays inside §11; the PHASE-003 identity schema absorbs the slice with additive columns |

## Decision

**Option C.** `pos-terminal` devices ride the identity `devices` table (migration 0024
adds the `pos-terminal` platform value + `capabilities`/`tenant_id`/`terminal_id`
columns; the full registry with self-enrollment, attestation, and device tokens is
PHASE-020). Enrollment is manual by an admin (`pos.terminals.manage` +
`sync.devices.register`); pulls/pushes authenticate via the operator's user session;
revocation rejects pushes with `DEVICE_REVOKED` **before any command executes** (tested,
zero effects) and one terminal = one device with no cross-terminal draft visibility.

## Consequences

- A terminal's sync identity is its operator's session — suspending the user or
  revoking the device kills that terminal's sync path; revocation remains the
  documented kill-switch for a stolen terminal.
- Per-device pull positions (`sync_cursors`) work from day one, so PHASE-020's
  contract-version gate can accept a PHASE-016 terminal on day one (§11 rule 3).
- **PHASE-020 reconciliation:** replace session transport with real device tokens
  (ADR-0015) and absorb the additive device columns into the generalized registry —
  the wire contracts (§2/§3) do not change; only the transport/auth plane does.

## Approval requirements

Architecture owner signature; recorded as a standing §11 deviation until PHASE-020
reconciles it (referenced from SYNC_PROTOCOL §11's shipped note and the PHASE-016
completion report).
