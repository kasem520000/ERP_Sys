# P24-DOCS-C — PHASE-024 T13 / T14 / T10(docs leg) / T4 WebAuthn record

**Task ID:** P24-DOCS-C · **Repo:** `/home/z/phase017_work` · **Scope:** docs +
one public web page. Spec: `docs/implementation/phases/PHASE-024.md` items 9 (T10),
13 (T13), 14 (T14) + the T4 WebAuthn decision-record item; master plan
`agent-ctx/PHASE-024-MASTER-PLAN.md` §9. Predecessors in this phase:
`P24-SEC-B.md` (rate-limit/headers), `P24-WEB-A-web.md` (MFA UX + audit console).

## Files created

| Path | What |
|------|------|
| `docs/decisions/DR-024-01-webauthn-passkeys.md` | T4 roadmap decision record: **ACCEPTED (decision: DEFER to post-GA)**. Rationale: ADR-0015 §4 says not launch-blocking; TOTP + recovery codes satisfy M-06/M-07 and are now policy-enforceable per role/plan; WebAuthn needs platform-attestation strategy + device matrix + fallback policy (own phase). Revisit triggers: post-GA product decision, ADR-0015's regional-passkey-adoption trigger, any credential-phishing SEV-1/2 class. Cross-refs THREAT_MODEL S-02. |
| `docs/decisions/DR-024-02-privacy-retention-oq009.md` | OQ-009 record: **BLOCKED-EXTERNAL** — legal review requires the client's legal counsel (unreachable from this delivery environment; no-fabrication rule forbids inventing a jurisdictional retention number). Working assumption (90-day-then-hard-delete + 14-day read-only grace) REMAINS in force; constants ship as named PLACEHOLDERs (`OFFBOARDING_RETENTION_DAYS`, `OFFBOARDING_GRACE_DAYS` in `purge-service.ts`). Owner: platform security owner (role). Revisit: before GA — the PHASE-025 gate re-reads the BLOCKED status. Includes the required Options table + the honest Option-B recommendation. |
| `docs/legal/PRIVACY_NOTICES.md` | AR+EN **DRAFT** privacy notices (header: "preparation draft, not legal advice"; marked DRAFT — pending legal review per DR-024-02). Sections both languages: who we are, what data is processed (tenant business data / user account data / device data / audit events), retention (working assumption + placeholders), user rights (export + deletion via Journey H), security & sharing, contact (deployment-time placeholder). Ends with a 7-row counsel-review checklist. `docs/legal/` did not exist before — created. |
| `apps/web/app/[locale]/security/page.tsx` | T14 PUBLIC page `/{locale}/security` — PublicShell `layout="page"` (the pricing-page pattern; no app shell, no session). 7 sections from the dictionary: contact (address rendered `dir="ltr"` mono + InfoNotice placeholder note), commitment (48h ack / keep informed / coordinated disclosure), safe harbor (no legal action vs good-faith research), researcher guidelines (avoid production tenant data, no DoS/social engineering, report promptly + embargo), scope (web+BFF/API/desktop/Android/sync endpoints/e-invoicing sandbox), triage (on-call path follows the INCIDENT_RESPONSE §1 severity ladder SEV-1..4), bounty note (post-GA decision per SECURITY_TEST_PLAN §12). Server component, zero client state, semantic sections + aria-labelledby. |

## Files modified (additive; parallel agents' files untouched)

| Path | Change |
|------|--------|
| `docs/security/THREAT_MODEL.md` | **T13 update cycle** — full list below. |
| `docs/security/DATA_PROTECTION.md` | §4 step 5 cell: + "Record filed: DR-024-02 — BLOCKED-EXTERNAL…" pointer (constants named); §5: + retention-decision pointer line under the table (90-day + 14-day grace governed by DR-024-02; notice-drafts pointer). Header Updated → 2026-11-06. |
| `docs/ASSUMPTIONS_AND_OPEN_QUESTIONS.md` | Pointer line under the OQ table: OQ-009 → DR-024-02 (BLOCKED-EXTERNAL; working assumption remains; revisit before GA). OQ row itself NOT rewritten. Header Updated → 2026-11-06. |
| `apps/web/i18n/dictionaries.ts` | +22 keys in the `Dictionary` interface AND both `ar` and `en` (21 `disclosure*` + `loginSecurityLink`). Counts **3321 → 3343 per locale**; parity green. Diff purely additive (verified). |
| `apps/web/app/[locale]/login/page.tsx` | Discreet link line under the login card (below forgot-password): `/{locale}/security` with the localized `loginSecurityLink` label + PHASE-024 T14 comment. |

## THREAT_MODEL.md additions (T13 traceability)

- **§1**: System state → MAINTAINED (cycle note; implemented-controls reading for shipped surfaces).
- **§2 assets**: AS-2 extended (opt-in device push tokens); AS-6 extended (offboarding state, deletion certificates, purge grants); **AS-12 NEW** (e-invoicing submission evidence: registry + sealed artifacts + usage log).
- **§4 NEW rows (9)**: B0 "Malicious client update via updater channel" (S-15 key class); B1 "MFA enrollment bootstrap abuse" (incl. the documented residual: pre-existing device tokens NOT retroactively MFA-gated; admin reset + session/device revocation is the operational answer); B2 "Audit anonymization abuse via the purge path" (nonce+grant+GUC triple gate; privacy-vs-forensics trade-off recorded); B3 "Offboarding purge-path abuse" (migration-scope connection + `purge_path_*` policies as a NEW insider-risk surface: two-person, legal hold, GUC-scoped RLS, no INSERT policy, deletion certificate); B4 "Submission registry tampering / sealed-artifact disclosure", "Poisoned commerce channel import", "Bank statement parser abuse", "Payout reconciliation poisoning"; B6 "Push-token exfiltration / spam".
- **§4 extended rows (4)**: B1 "Rate-limit evasion" (R-04 per-tenant burst limiter + R-05 note + T9 security headers + in-memory caveat); B4 "Callback/webhook spoofing" (billing ingress HMAC/staleness/idempotency + the **S-11 dual-secret rotation window** — residual M only during the bounded window); B4 "E-invoicing certificate theft" (PHASE-023 path-only registry, no API key-material read, usage audit, 30/14/7 ladder); S-12 scenario controls (R-04/R-05 hardening).
- **§5 scenarios NEW (3)**: **S-14** e-invoicing submission pipeline compromise; **S-15** offboarding purge-path insider abuse; **S-16** MFA enforcement gates + bootstrap (with the device-token residual + operational answer). S-02 residual re-pointed at DR-024-01 (defer, post-GA).
- **§6 re-scored**: M bucket gains purge-path (S-15), submission pipeline (S-14), updater channel; L bucket gains bootstrap abuse, audit-anonymization abuse, commerce import, bank parser, payout drift, push tokens, the S-11 window note; re-score notes paragraph records the cycle's citations (no pre-cycle rating silently moved; ZATCA/payment stubs keep L–M honest per DR-001/DR-002 OPEN).
- **§7 watchlist**: gained an **Owner (role)** column on every row (Security owner / Platform on-call / Identity module owner / Offline-sync module owner / Release engineering owner / Platform operations owner / Tax module owner — no personal names) + **4 new items** (e-invoicing submission evidence; offboarding purge path; client updater channel/signing keys; MFA enforcement residuals).
- **§8**: "PHASE-024 update cycle (T13 — executed 2026-11-06)" note listing everything above + the verified-present list (offline devices/B6, sync endpoints, native clients, updater channels, e-invoicing certificates, webhook ingress).
- Header Updated → 2026-11-06 (PHASE-024 update cycle — §8).

## Verification (all executed; NO db suite touched)

- `pnpm run check:i18n-parity` → **ar=3343, en=3343** ("100% key parity; no empty values") — before **3321=3321**.
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json` → **clean** (exit 0).
- `pnpm exec eslint` on the 3 touched web files → clean.
- `python3 scripts/validate_docs.py` → **29/29 PASS** (after all doc edits).
- All relative doc links verified to resolve (18 targets checked, incl. `docs/legal/` created).
- THREAT_MODEL table integrity: every STRIDE row exactly 6 cols, watchlist 5 cols, assets 5 cols (awk check).
- `grep Math.` over new/modified code files → none (ADR-0009 house rule).

## Deviations / judgment calls (report, don't hide)

1. **DR status labels**: house README lists OPEN/ACCEPTED/REJECTED/SUPERSEDED; DR-024-02 uses **BLOCKED-EXTERNAL** (task-mandated; the honest per-criterion-9 branch, explained in Context) and DR-024-01 uses "ACCEPTED (decision: DEFER to post-GA)". Both keep the mandatory Options/Context/Consequences/Approval shape.
2. **`docs/decisions/README.md` §5 still says OQ-009 "to be opened under `compliance/`"** and DR-024-01/02 are not yet indexed there — the README is outside this task's file list (house rule: don't modify beyond deliverables). Orchestrator propagation step (README §4 process) should add the two root records to the §5 table/§2 list.
3. **ADR-0015 §4 roadmap-note pointer + `docs/handoff/CHANGELOG.md` entries** named in DR-024-01's approval requirements are likewise left to the phase-completion propagation (outside my file list).
4. **Disclosure-page contact** is the documented PLACEHOLDER `security@erp.example` with an on-page InfoNotice saying the live address is configured at deployment — per the no-fabrication rule (no invented real domain).
5. The `(marketing)` route group exists for public pages, but the task specified the exact path `apps/web/app/[locale]/security/page.tsx`; route groups don't change URLs, so `/{locale}/security` resolves identically. Followed the task path.
6. Threat-model §6 keeps "malicious update via updater channel" in M (not H) — S-13 already treats supply-chain as M with reduced blast radius; signing-key theft is contained by min-version + staged rollout. Consistent with the pre-cycle S-13 posture.

## Handoff notes

- THREAT_MODEL S-02 now cites DR-024-01; if a post-GA WebAuthn phase supersedes that record, re-point S-02 + §6 M-bucket wording.
- The DR-024-02 revisit trigger is hard-dated at the GA gate: the PHASE-025 GA checklist must re-read its BLOCKED-EXTERNAL status (acceptance criterion 9's honest-BLOCKED branch).
- Privacy-notice drafts inherit DR-024-02's status; counsel sign-off amends the DR (never edits it in place) and flips the notice header from DRAFT.
