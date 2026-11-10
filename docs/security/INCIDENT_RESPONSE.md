# Incident Response

> **Status:** STABLE · **Owner:** Security Architecture · **Updated:** 2026-10-27

Severity ladder, on-call expectations, lifecycle, and playbooks for the security/data
incidents this platform can face. MVP staffing is a small engineering team — SLAs below
are calibrated to that reality and revised at GA (OQ-008 support SLA). Companion:
[THREAT_MODEL.md](THREAT_MODEL.md) (scenarios), [SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md)
§7 (leak response), [../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)
(restore paths), [../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md) (risk IDs).

## 1. Severity ladder

| Level | Definition | Examples | Response SLA (MVP staffing) |
|-------|------------|----------|------------------------------|
| **SEV-1** | Platform-wide security or integrity event: cross-tenant data access, data loss, **ledger integrity break** (any invariant failure in production — RISK-009), certificate compromise, ransomware | tenant isolation breach; ledger/subledger drift; posted-journal corruption; ZATCA cert theft | Ack ≤ 15 min (on-call), all-hands within 1 h, continuous work until contained; customer comms ≤ 4 h |
| **SEV-2** | Single-tenant outage or data corruption; recurring failed postings for one tenant; device-fleet sync failure | one tenant cannot post; one tenant's statements wrong; revoked-device data leaked pre-revocation | Ack ≤ 30 min, mitigation ≤ 4 h, tenant comms ≤ 4 h |
| **SEV-3** | Degraded service, no data integrity risk | slow reports; elevated 429s; delayed e-invoicing submissions; backup job failed once (retrying) | Next business day; comms as needed |
| **SEV-4** | Cosmetic/single-user issues with workaround | broken print layout for one tenant; one user locked out | Within 2 business days via support queue |

**Auto-SEV-1 triggers** (no triage debate): RLS denial counter > 0 in production traffic;
any reconciliation job reporting ledger-vs-subledger drift (RISK-009 rule); audit trail
integrity check failure; secret-store access anomaly on certificate paths; any evidence of
cross-tenant data in a tenant's view.

## 2. On-call roles (MVP)

| Role | Held by | Responsibilities |
|------|---------|------------------|
| Incident Commander (IC) | On-call engineer (rotating) | Runs the incident, declares severity, owns timeline, calls for reinforcements |
| Platform Operator | Second engineer (backup on-call) | Executes containment actions (deploys, suspensions, token revocations) |
| Communications Lead | IC delegates (product owner when available) | Status page, tenant comms (AR+EN), internal updates |
| Domain SME | Accountant-adjacent engineer / architect on ledger incidents | Decides posting-stop scope, validates fixes against invariants |
| Executive Sponsor | Founder/CTO | Legal/regulatory notification decisions, external authority posture |

Paging: alerts route from monitoring ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md))
→ on-call rotation; every alert links its runbook ([../operations/TROUBLESHOOTING.md](../operations/TROUBLESHOOTING.md)).

## 3. Incident lifecycle

1. **Detect** — monitoring alert, tenant report, support escalation, or proactive canary
   (RLS canary, reconciliation jobs, backup restore smoke).
2. **Triage** — classify severity (§1), assign IC, open the incident channel + timeline
   doc; when in doubt, round severity **up**.
3. **Communicate** — internal notice immediately; tenant-facing comms per §6 (within SLA);
   status page for platform-wide events.
4. **Contain** — stop the bleeding (§4 playbooks): freeze, revoke, suspend, roll back.
5. **Eradicate** — remove root cause; patch; rotate anything possibly exposed.
6. **Recover** — restore service/data; verify with tests (invariant smoke, reconciliation
   re-run, tenant spot-checks).
7. **Postmortem** — blameless, within 5 business days (§7); actions tracked to closure.

## 4. Playbooks

### P-01 Suspected cross-tenant data access (SEV-1)

1. **Freeze first**: suspend the involved source tenant(s) if a session/credential is
   implicated (`platform.tenants.suspend` — sessions die, sync stops); do NOT suspend the
   whole platform unless evidence says multiple tenants.
2. **Preserve evidence**: snapshot relevant `audit_events` ranges, API logs, RLS-denial
   metrics, session records to a forensics bucket **before** any cleanup; enable enhanced
   logging on affected routes.
3. **Scope with audit forensics**: which actor/session, which tenant pair, which entities,
   which window; enumerate every query/export/download in the window for the implicated
   principal; check exports + report runs (bulk exfil surfaces).
4. **Fix the hole**: if a code bug (missing scope, broken policy), ship the fix behind
   the attack-suite regression test; if a credential issue, revoke + rotate
   ([SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md) §7).
5. **Tenant notification posture**: affected tenants are informed factually (what data,
   what window, what we did, what they should do) in AR+EN — no speculation about the
   actor; regulatory notification decisions are made by the executive sponsor with
   counsel (never automated, never fabricated).
6. **Recovery**: unsuspend tenants once containment is proven; verify with the isolation
   attack suite + canary before resuming.

### P-02 Ledger/subledger drift (SEV-1 — RISK-009 rule)

1. Reconciliation job reports `BROKEN` (AR/AP/inventory/VAT/cash) → auto-page.
2. **Scoped posting stop**: the IC + SME decide the blast radius — default: block posting
   for the affected tenant (feature flag / tenant-level posting hold), NOT the platform;
   platform-wide stop only if multiple tenants or the posting engine itself is implicated.
3. **Quantify drift**: reconciliation record + offending rows; determine the earliest
   affected entry — never "force-balance" with UPDATEs
   ([../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md) §3).
4. **Root cause**: engine bug / migration / manual-datum corruption; fix forward with an
   invariant regression test (named after the incident).
5. **Repair**: additive documents only (reversals/adjustments) so history stays truthful;
   if the corruption cannot be corrected additively (e.g., a wrong posting rule), a
   PITR-restore decision tree run (P-03) is evaluated with the tenant's agreement.
6. **Communicate**: affected tenant informed; if invoices/tax summaries were wrong, tax
   implications are the tenant's accountant's call — platform provides corrected data.

### P-03 Backup restore decision tree

```
Data incident detected
├─ Logical corruption, bounded window (bad deploy/migration/bug)?
│   ├─ Yes → Can it be fixed additively (reversals)?  → prefer forward-fix (no data loss)
│   └─ No  → PITR to timestamp before event (RTO ≤ 1 h target):
│            confirm data-loss window with tenant → execute → verify invariants smoke
├─ Instance/region loss? → snapshot/WAL recovery (RTO ≤ 4 h; region path ≤ 8 h, P-025 tested)
└─ Ransomware/malicious deletion? → P-05 (WORM restore path)
```

Rules: restore is an incident-level decision (IC + exec) because it trades recent
transactions for integrity; every restore ends with the invariant smoke suite
([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md) §verification).

### P-04 E-invoicing certificate compromise (SEV-1)

1. **Revoke + rotate first**: remove the certificate's store access, rotate the signing
   job credentials, and follow the authority's revocation/re-enrollment process —
   platform posture only; **the platform makes no legal claims** about the validity of
   previously submitted invoices (that is a tenant–authority matter with counsel).
2. **Stop submissions** for the affected tenant(s) until re-enrolled; queue documents
   (registry holds `PENDING`) — do not drop them.
3. **Audit usage window**: every signing event in the exposure window listed from the
   audit trail; identify any invoice signed outside normal submission flows.
4. **Notify authority posture**: executive sponsor decides on informing the tax authority
   per the jurisdiction's process — content drafted with counsel, never by the on-call
   engineer; tenants informed in parallel.
5. **Postmortem** must answer: how key material left the signing-job boundary (S-10 rules,
   [SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md) §6).

### P-05 Ransomware / destructive attack (SEV-1)

1. Isolate: cut deployment access, rotate all S-01/S-02/S-12-class secrets
   ([SECRETS_MANAGEMENT.md](SECRETS_MANAGEMENT.md) §7), snapshot current state for
   forensics before anything is deleted.
2. **WORM restore path**: backups are object-locked — deletion requires ops approval, so
   restore from the nightly full + WAL PITR to a clean point; if the attacker had
   KMS-level access, escalate to provider incident support (this is why KMS is isolated
   from storage credentials).
3. Rebuild infrastructure from IaC + verified images (never restore executables).
4. Verify: nightly-restore invariant smoke + full reconciliation suite + isolation suite
   before reopening; staged tenant reactivation.
5. Comms: status page + all-tenant notice (attackers may have read tenant data if DB was
   accessed — treat as data-incident comms too).

## 5. Communication templates

**Internal** (incident channel, first message):

> 🚨 SEV-<N> declared: <one-line summary>. IC: <name>. Impact: <tenants/surfaces>.
> Next update in 30 min. Timeline doc: <link>. Do not post outside this channel.

**Tenant-facing (AR first, EN mirror)** — data-incident skeleton:

> AR: نتواصل معكم بخصوص حادثة أمنية أثرت على بياناتكم… (what happened, what data,
> window, containment actions, what we recommend you do, contact + reference id)
> EN: We are writing regarding a security incident affecting your data… (same structure)
> Facts only; no speculation; single reference id per tenant; sent via the communications
> lead, approved by exec sponsor.

**Status page**: predefined components (API, web, desktop sync, e-invoicing); states
(operational / degraded / partial outage / major outage); updates at fixed intervals
during SEV-1/2 until resolved; post-resolution summary links a public postmortem summary
within 10 business days.

## 6. Postmortem template (blameless)

1. Summary (2–4 sentences, user-impact first) + severity + duration + MTTD/MTTR.
2. Timeline (detection → each action → resolution), with timestamps.
3. Root cause (technical) + contributing factors (process).
4. What worked / what didn't (detection speed, comms, runbooks).
5. Action items: owner + due date; every item that can become a test/alert becomes one
   (regression named after the incident ticket —
   [../testing/REGRESSION_STRATEGY.md](../testing/REGRESSION_STRATEGY.md) §5).
6. Customer-impact accounting (tenants, records, windows) — feeds notification record.

## 7. Metrics (targets reviewed at GA)

| Metric | Target (MVP) | Notes |
|--------|--------------|-------|
| MTTD (SEV-1) | ≤ 15 min from first signal | monitoring coverage is the lever; canaries for silent failures |
| MTTA | ≤ 15 min | on-call ack |
| MTTR (SEV-1 containment) | ≤ 4 h | containment, not full fix |
| Postmortem on-time rate | 100% within 5 business days | tracked per incident |
| Action-item closure | ≥ 90% within 30 days | reviewed at phase boundaries |
| Repeat-incident rate | 0 for the same root cause | regression-test discipline |

## 8. Drills & maintenance

1. **Quarterly**: backup-restore cold drill (second engineer, runbook-only —
   [../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md) §verification).
2. **Per release tier**: tabletop of P-01 (cross-tenant) and P-05 (ransomware) — findings
   update this file.
3. **Annually before GA**: full incident simulation including comms (fake tenant notices
   drafted, AR+EN reviewed).
4. Any new auto-page trigger (monitoring change) updates §1 triggers list in the same PR.
5. Contact rota + escalation tree live in operations docs (kept out of this file to avoid
   drift); this file defines the process, not the people.
