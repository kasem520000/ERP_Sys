# Backup & Restore Runbook

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-06

Operational runbook for [../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)
(the storage-level design). Targets (NFR-007): **RPO ≤ 15 min, RTO ≤ 4 h — unproven until
the first successful restore drill**. Directive §16: *backups do not exist until they have
been restored*; success of a backup job is not evidence. Escalation anchor: RISK-018
([../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md)). Incident interface:
[../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) and
[DISASTER_RECOVERY.md](DISASTER_RECOVERY.md).

## 1. Backup jobs

| Job | What runs | When | Where it lands | Retention | WORM | Verified by |
|-----|-----------|------|----------------|-----------|------|-------------|
| `wal-archive` | Managed PostgreSQL WAL archiving (provider-managed, KMS-encrypted) | Continuous | Provider storage | 7-day PITR window | Provider-managed immutability settings | Quarterly PITR drill (§4) |
| `nightly-dump` | `pg_dump --format=custom --compress=9 --exclude-schema=boss --no-owner` run with `erp_migrate`-level credentials, **client-side AES-256 encrypted before upload** | 02:00 platform time, from the worker host | `s3://erp-backups/<env>/nightly/<YYYY-MM-DD>/erp-<env>.dump.enc` | 35 days | Yes — object-lock, versioning; deletion requires ops approval | Nightly restore-smoke (§3) |
| `weekly-snapshot` | Storage-level full snapshot of the DB instance | Sunday 03:00 | Provider snapshot store | 8 weeks | Provider retention lock | Quarterly drill uses a snapshot as fallback path |
| `monthly-archive` | Copy of the monthly full dump to the archive prefix | 1st of month | `s3://erp-backups/<env>/monthly/…` | 12 months (per legal review) | Yes | Quarterly drill samples one monthly archive |

Rules:

- The dump **excludes the `boss` schema** — queue state is reconstructable; financial data
  is not ([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)).
- The backup bucket is **separate** from the app bucket; app roles have **no write/delete**
  on it. WORM (object-lock + versioning) is verified as part of §8 attestation.
- Backup credentials are distinct from app credentials (`erp_migrate`-level), stored in the
  secret store, rotated quarterly.
- `nightly-dump` failure **pages** (§9); `weekly-snapshot`/`monthly-archive` failures alert
  Sev-2.

Example nightly job (cron on the ops host; CI never holds these credentials):

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
pg_dump --format=custom --compress=9 --no-owner --exclude-schema=boss \
  --file "/tmp/erp-prod-${STAMP}.dump" \
  "$MIGRATE_DATABASE_URL"
openssl enc -aes-256-cbc -pbkdf2 -in "/tmp/erp-prod-${STAMP}.dump" \
  -out "/tmp/erp-prod-${STAMP}.dump.enc" -pass env:BACKUP_ENC_KEY
object-storage cp "/tmp/erp-prod-${STAMP}.dump.enc" \
  "s3://erp-backups/prod/nightly/${STAMP}/erp-prod.dump.enc"
rm -f "/tmp/erp-prod-${STAMP}.dump"*
```

## 2. Verification protocol (mandatory)

1. **Nightly automated restore-smoke** (§3) — proves the dump is restorable and the data
   inside it satisfies core invariants.
2. **Quarterly cold drill** (§4) — a second engineer executes PITR using only this runbook,
   timed, with a signed drill record (§8).
3. **GA gate (PHASE-025)** — region-loss tabletop + one cross-region restore rehearsal
   ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §5).

## 3. Nightly restore-and-invariant-smoke (automated)

Runs at 04:30, one hour after the dump, on a dedicated ephemeral environment:

```bash
# 1. Start an ephemeral PostgreSQL 16 container (never reuse a shared dev DB)
docker run -d --name restore-verify -e POSTGRES_PASSWORD=verify -p 127.0.0.1:55432:5432 postgres:16

# 2. Fetch + decrypt the freshest nightly dump
object-storage cp "s3://erp-backups/prod/nightly/$(date +%F)/erp-prod.dump.enc" ./erp.dump.enc
openssl enc -d -aes-256-cbc -pbkdf2 -in erp.dump.enc -out erp.dump -pass env:BACKUP_ENC_KEY

# 3. Restore (roles from the dump are not used; --no-owner keeps it self-contained)
pg_restore -h 127.0.0.1 -p 55432 -U verify -d postgres --no-owner --jobs=4 erp.dump

# 4. Run the invariant smoke suite against the restored copy:
pnpm --filter api verify:restore-smoke -- --url postgresql://verify@127.0.0.1:55432/postgres
#    which asserts, per run:
#    a. random tenant GL balances:  SUM(debits) = SUM(credits) per journal entry      (INV-001/002)
#    b. RLS guard: SELECT as erp_app without tenant GUC on audit_events -> 0 rows    (isolation)
#    c. audit_events row count > 0 and monotonically increasing by 'at'              (audit trail)
#    d. posted documents all have >= 1 journal entry                                  (INV-006)
#    e. posting idempotency uniqueness intact: no dup (tenant,source_type,source_id,operation) (INV-013)

# 5. Record result (backup_verifications row: dump path, restore seconds, checks passed)
#    and emit metric erp_backups_restore_smoke_success / failure.

# 6. Teardown ALWAYS (also on failure paths)
docker rm -f restore-verify && rm -f erp.dump erp.dump.enc
```

Failure of any check = alert (§9) + RISK-018 trigger; the on-call must treat the latest
good dump as the effective RPO boundary until fixed.

## 4. Quarterly drill (cold run, timed)

Executed by a **second engineer** — someone who did not write the recent changes — using
only this runbook (no tribal knowledge). Record every step's wall time.

1. **Choose a restore point**: any timestamp inside the last 24 h (within the PITR window).
2. **Create the ephemeral restore environment**: new managed PG instance (drill scope) or,
   for the staging-attached variant, a fresh container per §3 pattern.
3. **PITR restore to the chosen timestamp** via the managed provider's point-in-time
   restore (the provider-specific invocation is recorded in the ops vault appendix at
   provisioning time and must be in the drill record). For container drills, simulate with
   `pg_restore` of the closest nightly + note the delta as measured RPO.
4. **Run the full invariant smoke suite** (§3 step 4) — all five assertions.
5. **Compare row counts** against the source production reads taken at the same timestamp:

   ```sql
   -- run on BOTH production (as of drill time, via erp_readonly) and the restored copy:
   SELECT 'journal_entries' t, count(*) FROM journal_entries
   UNION ALL SELECT 'journal_lines', count(*) FROM journal_lines
   UNION ALL SELECT 'sales_invoices', count(*) FROM sales_invoices
   UNION ALL SELECT 'stock_moves',   count(*) FROM stock_moves
   UNION ALL SELECT 'audit_events',  count(*) FROM audit_events;
   ```

   Expected: restored counts ≤ source counts and explainable by the timestamp delta.
6. **Measure**: time-to-restore (start → queries answering) vs RTO ≤ 4 h; data-loss window
   (last WAL/tx before restore point) vs RPO ≤ 15 min.
7. **Record the drill log** (append to §8) with: date, engineer, restore point, timings,
   row-count comparison, failures, corrective actions, signature.
8. **Teardown** the ephemeral instance; confirm no orphaned resources (cost + hygiene).
9. A failed drill = RISK-018 materialized: fix, then repeat the drill within 2 weeks — a
   drill is not "passed" until a complete successful run exists.

## 5. Restore procedure A — logical corruption (PITR to timestamp)

Use when a bad migration or bug corrupted data at scale (decision tree:
[DEPLOYMENT.md](DEPLOYMENT.md) §5; incident must be declared first).

1. **Declare incident** (Sev-1 if ledger integrity is affected — RISK-009); incident
   commander owns the clock; freeze deploys.
2. **Stop the bleeding**: roll back / disable the offending feature via rollout flag; if
   postings continue writing on top of corrupted state, enable **tenant read-only mode**
   ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §3).
3. **Identify the corruption timestamp** from logs/audit (`audit_events`, deploy log,
   migration job log). Choose restore target = last clean instant **before** the event.
4. **Snapshot current state** (preserve evidence + the option to extract data written after
   the restore point for re-posting): trigger an immediate `pg_dump` + snapshot.
5. **Restore**: point-in-time restore to the target into a fresh instance (provider
   invocation from the vault appendix). Never restore "in place".
6. **Verify** on the restored instance: §3 step 4 suite + targeted checks for the reported
   corruption + compare key counts.
7. **Cutover decision** (incident commander + product owner):
   - Data written after restore point is **lost** on cutover — estimate affected tenants
     and documents from step 4's evidence dump; decide cutover vs forward-fix per scale.
   - Cutover = repoint `DATABASE_URL` secret → rolling restart api/web → worker last
     ([DEPLOYMENT.md](DEPLOYMENT.md) §2 steps 3–5) → health + smoke tests.
8. **Re-post recoverable data** from the evidence dump via normal document flows (never
   raw INSERTs into the ledger — INV-003).
9. **Tenant notices** (AR/EN templates: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §3)
   + post-incident review.

## 6. Restore procedure B — instance loss

DB instance unreachable/destroyed (no corruption assumed):

1. Provision a replacement managed instance from the **weekly snapshot** (fast path) and
   replay WAL to the latest available point (provider PITR on the snapshot).
2. Verify §3 suite; repoint secrets; rolling restart; smoke tests.
3. Target: **RTO ≤ 4 h** from declaration to queries answering; record actuals in §8.

## 7. Restore procedure C — cross-region restore (GA)

For region loss ([DISASTER_RECOVERY.md](DISASTER_RECOVERY.md) §2):

1. Confirm backup-bucket **cross-region replication** is current (object-lock preserved on
   the replica — verified quarterly, §8 attestation).
2. Provision the new environment in the recovery region: managed PG + app nodes from the
   recorded infrastructure-as-code + `deploy/compose.prod.yml`.
3. Restore: nightly dump restore (or snapshot+PITR where the provider supports
   cross-region) → seeds not needed (data intact) → role bootstrap per
   [DEPLOYMENT.md](DEPLOYMENT.md) §6 steps 2.
4. Verify + cutover DNS/LB; target **RTO ≤ 8 h**; rehearsed at PHASE-025 with timing
   evidence (GA gate).

## 8. Drill log & attestation (append-only)

| Date | Type (nightly-smoke audit / quarterly PITR / cross-region) | Engineer | Restore point | Restore time (vs RTO) | Data window (vs RPO) | Result | Actions |
|------|------------------------------|----------|---------------|----------------------|---------------------|--------|----------|
| 2026-11-01 | First recorded restore rehearsal (PHASE-014 T13 — MVP gate item; sandbox tier: embedded PostgreSQL 16, real `pg_dump -Fc` / `pg_restore --no-owner --jobs=4` tooling, `pnpm --filter @erp/api restore:drill`) | AI coding agent (PHASE-014 session; recorded for the second-engineer re-run in staging) | pg_dump custom-format artifact of the fully-migrated (0001–0021) + seeded database (tenant + FY + 2 balanced posted entries + audit trail; 707 KiB) | 0.7 s restore / 0.1 s dump (RTO 4 h — GREEN) | 0 rows lost — dump-restore drill, no writes between dump and drop (RPO 15 min — GREEN; PITR window is the managed tier) | **PASSED** — post-restore invariant smoke: (a) INV-001/002 per-entry balance at tolerance 0 GREEN; (b) RLS guard through a real `erp_app` connection on the restored copy: 0 rows without tenant GUC GREEN; (c) audit trail 3 events, insert-ordered GREEN; (d) posted-doc ↔ journal-entry tie 0 orphans GREEN; (e) INV-013 posting-key uniqueness 0 duplicates GREEN; (f) INV-003 mutation attempt (`UPDATE journal_lines` as `erp_app`) grant-denied GREEN; row-count parity 5/5 tables identical (journal_entries/journal_lines/sales_invoices/stock_moves/audit_events) | Repeat on real staging with the managed-PITR path per §4 when infra is available (follow-up obligation); roles are cluster-level and survived the logical drop — the managed-instance drill must additionally verify the out-of-band role provisioning path |
| 2026-11-06 | Quarterly cold drill (§4 shape — PHASE-025 T7 second-engineer cold re-proof of the MVP-gate drill; sandbox tier: embedded PostgreSQL 16, `pnpm --filter @erp/api restore:drill` run from this runbook only, no tribal knowledge) | AI coding agent #2 (PHASE-025 session, cold run from this runbook only) | pg_dump custom-format artifact of the fully-migrated + seeded database (tenant + FY2026/01 + 2 balanced posted entries + 3 audit events; 1107 KiB) | 0.2 s dump / 1.3 s restore (RTO 4 h — GREEN) | 0 rows lost — no writes between dump and drop (RPO 15 min — GREEN; drill semantics, PITR window is the managed tier) | **PASSED** — a–f invariant smoke ALL GREEN (INV-001/002 balance, RLS guard via real erp_app connection, audit ordering, posted-doc tie, INV-013 uniqueness, INV-003 mutation grant-denied); row-count parity 5/5 identical | Expectation vs §4: all five §3 step 4 assertions + INV-003 mutation attempt green, row counts ≤ source and explainable, RTO ≤ 4 h / RPO ≤ 15 min measured; any failure = RISK-018 materialized, repeat within 2 weeks (§4 step 9). Actions: record actuals here; the managed-PITR provider invocation (§4 step 3) remains the hosted leg — same follow-up obligation as the 2026-11-01 row |
| 2026-11-06 | Cross-region restore rehearsal (PHASE-025 T6 — GA gate leg, DISASTER_RECOVERY §5 item 2 / this runbook §7; LOCAL tier: two fresh embedded PostgreSQL 16 instances standing in for primary + recovery regions — the §7 step-2 IaC + `deploy/compose.prod.yml` provisioning and the step-4 DNS/LB cutover are the hosted follow-up obligation; `pnpm --filter @erp/api restore:drill-ga`) | AI coding agent #2 (PHASE-025 session, cold run from this runbook only) | Nightly-shaped pg_dump artifact (--format=custom --compress=9 --no-owner --exclude-schema=boss; 1106 KiB) of the fully-migrated (0001–0036) + seeded source; recovery instance bootstrapped from virgin (full chain re-applied in 2.3 s per DEPLOYMENT §6) | 1.1 s restore leg / 2.3 s recovery bootstrap / 7.0 s total wall (RTO 8 h — GREEN, restore leg measured; provisioning + cutover hosted) | 0 rows lost — no writes between dump and restore (RPO 15 min — GREEN, drill semantics; replication lag is the managed-tier claim) | **PASSED** — invariant smoke a–f ALL GREEN + boss-schema exclusion shape GREEN on the restored recovery copy; row-count parity 5/5 identical (the script printed the complete row + JSON summary; orchestrator-captured 2026-11-06) | Expectation vs §7/DISASTER_RECOVERY §5: timed restore within RTO ≤ 8 h, §3 step 4 smoke green on the restored recovery copy, parity 5/5; the tabletop companion record is [dr-drill-2026-11-06.md](dr-drill-2026-11-06.md) (gap list G1–G11). Actions: hosted-tier re-run of §7 end-to-end (IaC provisioning + cross-region fetch + cutover) when the recovery region exists — the recovery-region wall time remains the infra-gated RTO evidence |

**Attestation (directive §16).** A monthly attestation line is appended here, signed by
the on-call lead: *"I attest that for <month>: the nightly restore-smoke succeeded ≥ 27/30
days (every failure has an incident record), the last quarterly drill passed within RTO
and RPO, and the WORM configuration on the backup bucket was inspected and intact."*
A missed attestation blocks the next production release at pre-flight
([DEPLOYMENT.md](DEPLOYMENT.md) §1 row 3).

<!-- ORCH-CONFIRM resolved 2026-11-06: the 27/30 evidence basis does NOT hold in this
     environment (nightly-smoke-as-script, not 30 calendar days of scheduled runs) —
     the honest first-attestation-due date stands: 2026-12-01, the first full
     calendar month post-GA, per the paragraph below. -->

**2026-11 (PHASE-025 session) — NOT SIGNED, honestly.** No November attestation is
recorded: this environment has the §3 nightly-smoke as an executable procedure + the
drill log above (2026-11-01, 2026-11-06), **not 30 calendar days of scheduled
restore-smoke runs**, and no WORM bucket to inspect (provider-infra — the DR tabletop
gap G3). The first attestable month is **2026-12** (the first full calendar month with
the hosted cadence live): the on-call lead signs on **2026-12-01**, covering December.
Until the first signed line exists, the GA release checklist carries this gap
explicitly rather than a fabricated attestation.

## 9. Failure alerts & escalation

| Signal | Severity | Immediate action | Escalation if not fixed |
|--------|----------|------------------|------------------------|
| `nightly-dump` job failed | Sev-2 | Inspect job log; retry once; check credentials/storage quota | 2 consecutive failures → **page on-call lead**; RISK-018 opened |
| Restore-smoke failed (restore or invariant step) | Sev-2 → Sev-1 if repeated | Treat newest good dump as RPO boundary; debug §3 step failing; do not touch prod | Page; incident record; release pre-flight blocked |
| PITR window unhealthy (oldest restore point < 7 days) | Sev-2 | Check WAL archiving status on the instance | Page DB owner; provider ticket |
| WORM/lock config drift detected | **Sev-1** | Assume anti-ransomware posture broken until re-verified; rotate backup credentials | Immediate page + security review ([../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md)) |
| Quarterly drill overdue > 2 weeks | Sev-3 | Schedule within the sprint | Escalate to product owner at release gate |
