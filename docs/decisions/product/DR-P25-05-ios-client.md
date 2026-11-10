# DR-P25-05 — iOS Client Decision Slot

> **Status:** PROPOSED (post-GA decision slot — PHASE-025 T14; the record ADR-0014 says
> this decision requires) · **Date:** 2026-11-06 (opened) · **Approver:** Product Owner
> (architecture owner counter-sign — client-platform impact) · **Related:**
> [ADR-0014](../../architecture/ADR/ADR-0014-android-expo.md) ("iOS later = mostly
> config + review of RN iOS specifics; not a rewrite (but out of scope until a decision
> record)" — this is that record) and its two-capability model,
> [PHASE-022](../../implementation/phases/PHASE-022.md) (the Android precedent: ONE
> app, TWO capability experiences — tenant field sales + personal accounts; the
> release-policy/rollout gates; the device-farm deferral pattern),
> [ADR-0013](../../architecture/ADR/ADR-0013-tauri-desktop.md) (the desktop sibling),
> [GA-RELEASE-CHECKLIST.md](../../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
> criterion 10

## Context

ADR-0014 scoped the mobile client to Android ("iOS is not in the initial market
scope") and explicitly left the iOS question to a future decision record. The PHASE-022
Android delivery is the precedent any iOS leg inherits: one Expo/React Native codebase
serving **both capability experiences** (tenant field-sales writes through sync; personal
accounts read-only), SecureStore credentials + biometric unlock, the byte-budgeted
background sync, the staged rollout 10/50/100 with crash-rate gates + `minVersion`
force-update, and the honest device-farm deferral for on-device evidence. ADR-0014's
own note says the iOS lift is "mostly config + review of RN iOS specifics; not a
rewrite" — the decision is therefore **commercial** (is there demand worth the release
engineering?) more than architectural.

## Options (sketch)

| Option | Shape | Consequences |
|--------|-------|--------------|
| **A. Defer until demand signal (status quo)** | No iOS work; this slot re-read at each post-GA review | Zero cost; honest (the release notes say iOS is not included); demand may never materialize in the KSA/UAE-first segment |
| **B. Full iOS client (both capabilities)** | RN/Expo iOS build of the same two-capability app: Keychain + SecureStore iOS semantics, Face ID/Touch ID, APNs push (the FCM adapter's counterpart), EAS iOS builds, App Store review + staged rollout, iOS device matrix | Broadest reach; a full release-engineering workstream (signing, review process, on-device matrix — the device-farm pattern extends); the RN iOS specifics review ADR-0014 names |
| **C. iOS personal-accounts only (narrower first step)** | Ship only the read-mostly personal-account experience on iOS | Smaller surface (no field-sales write flows to certify), App Store review simpler; splits the client story — two apps or a capability gate at build time (a deviation from the ONE-app precedent that would need its own note) |

## Recommendation (lean, to be tested at the trigger)

**A** until a concrete demand signal exists (target-market tenants or their customers
on iOS in meaningful volume); then **B** (the one-app precedent holds — capability
gating at device registration, not build variants, per ADR-0014 rule 1 / the PHASE-022
DR-P22-01 pattern).

## Decision

**NOT YET MADE — this record is the owning slot.** The v1.1.0 release notes state the
current posture ("iOS: not included at this time; the decision is documented").

## Consequences

- Until decided: no iOS target, no App Store presence, no iOS-specific code paths; the
  Android + desktop channels carry the client story at GA.
- When decided (option B/C): an ADR-0014 amendment or a new ADR-level note for the
  iOS specifics (push channel, keychain semantics, App Store release engineering), a
  PHASE-022-shaped phase plan with its own device-farm evidence obligations, AR+EN
  parity maintained, and `CHANGELOG.md` per the decision process
  ([../README.md](../README.md) §4).
- **Trigger:** demand signal in the KSA/UAE target market (A-001) — e.g. personal-account
  users or tenant staff on iOS reaching a material share — or an enterprise procurement
  requirement naming iOS. **Owner:** product owner.

## Approval requirements

- Product-owner signature (market/scope commitment); architecture-owner counter-sign
  (client-platform impact); evidence attached at decision time: the demand data + the
  RN iOS specifics review scope (the ADR-0014 note) + the release-engineering estimate
  (EAS iOS, App Store review, on-device matrix).
