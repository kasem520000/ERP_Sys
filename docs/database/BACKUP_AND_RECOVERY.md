# Backup and Recovery (Database Strategy)

> **Status:** STABLE · **Owner:** Database & Operations Architecture · **Updated:** 2026-10-27

Storage-level strategy. The operational runbook (commands, drills, responsibilities)
lives in [../operations/BACKUP_RESTORE_RUNBOOK.md](../operations/BACKUP_RESTORE_RUNBOOK.md).
Targets (NFR-007): RPO ≤ 15 min, RTO ≤ 4 h — **unproven until the first successful
restore drill** (directive §16: never claim backups work until restoration has been
tested).

## Backup design

| Layer | Mechanism | Retention | Encryption |
|-------|-----------|-----------|------------|
| Continuous | Managed PostgreSQL WAL archiving / PITR | 7 days PITR window | Provider-managed KMS |
| Nightly full | `pg_dump` (custom format, compressed) + object storage | 35 days | Client-side AES-256 before upload |
| Weekly baseline | Full snapshot (storage level) | 8 weeks | KMS |
| Monthly archive | Monthly full kept for compliance window (12 months) | per legal review | KMS |

- Backups run from the `erp_migrate`-level credentials; dump excludes the `boss` schema
  (queue state is reconstructable).
- Object-storage uploads are versioned + object-lock (WORM) on the backup bucket;
  deletion requires ops approval (anti-ransomware).
- Backup job health is monitored: failure alerts (RISK-018); success is NOT sufficient —
  restores prove it.

## Restore design

| Scenario | Path | Target |
|----------|------|--------|
| Logical corruption (bad migration/bug) | PITR to timestamp before event | RTO ≤ 1 h (staging rehearsal measured) |
| Instance loss | Snapshot/WAL recovery on new instance | RTO ≤ 4 h |
| Region loss (MVP: same-region backups only) | Bucket replication cross-region for backup objects only; restore into new environment | RTO ≤ 8 h (documented, tested in P-025) |

## Verification protocol (mandatory)

1. **Automated**: nightly restore of the previous full dump into an ephemeral container +
   invariant smoke suite (balance a random tenant's GL, run RLS guard, count audit rows).
   Failure = alert + RISK-018 escalation.
2. **Quarterly drill**: full PITR drill executed by a second engineer "cold" (runbook
   only, no tribal knowledge), timed, with a signed drill record appended to
   [../operations/BACKUP_RESTORE_RUNBOOK.md](../operations/BACKUP_RESTORE_RUNBOOK.md).
3. **GA gate (P-025)**: region-loss tabletop + one cross-region restore rehearsal.

## Data export (product-level, distinct from backups)

Tenant offboarding export ([../security/DATA_PROTECTION.md](../security/DATA_PROTECTION.md))
produces tenant-scoped datasets (documents, ledger, contacts, attachments) — audited,
rate-limited, and stored with expiry. This is a product feature; it does NOT replace
platform backups and is never used for tenant-level restore.
