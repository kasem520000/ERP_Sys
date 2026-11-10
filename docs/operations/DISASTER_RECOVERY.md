# Disaster Recovery

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-06

Scenario-driven recovery plan for the worst days: region loss, database corruption,
ransomware, a migration gone wrong at scale, or a multi-service outage. Backup mechanics
live in [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md); incident command and
severity handling in [../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md).
Targets (NFR-007): RPO ≤ 15 min / RTO ≤ 4 h — per-scenario values below. DR readiness is a
GA gate: the PHASE-025 drill (§5) must pass before GA release
([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) §Release gates).

## 1. Scenario register

| # | Scenario | Definition / example trigger | Recovery path | RTO target | RPO target | First tested |
|---|----------|------------------------------|---------------|-----------|-----------|--------------|
| S1 | Region loss | Cloud region unavailable (network/power/provider incident) | Cross-region restore ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §7) | ≤ 8 h | ≤ 15 min (backup replication lag) | PHASE-025 rehearsal (2026-11-06 — local tier; the hosted recovery-region re-run is the follow-up obligation) |
| S2 | DB instance loss | Instance deleted/failed, storage intact elsewhere | Snapshot + WAL recovery on new instance ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §6) | ≤ 4 h | ≤ 15 min (WAL archive interval) | First staging drill (MVP gate) |
| S3 | Logical corruption | Bad migration/bug corrupts ledger data at scale | PITR to timestamp + re-post salvageable work ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §5) | ≤ 1 h to read-only recovery; ≤ 4 h full | Point-in-time (minutes before event) | Quarterly drills |
| S4 | Ransomware / malicious destruction | Backup bucket tampering attempts, encrypted hosts | WORM backups are the lifeline: cross-region restore from locked objects (§6) | ≤ 8 h | ≤ 24 h (last nightly) with PITR option to ≤ 15 min | Per-release-tier P-05 tabletop ([../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md) §8.2); the 2026-11-06 PHASE-025 tabletop walked S1 only |
| S5 | Erroneous migration at scale | Deploy applied a migration producing wrong data shape/values | Freeze posting → forward-fix vs PITR decision tree ([DEPLOYMENT.md](DEPLOYMENT.md) §5) | Per incident (decision ≤ 1 h) | 0 if forward-fix; PITR window if restore | Quarterly drills |
| S6 | Multi-service outage | One bad release breaks api + web + worker simultaneously | Application rollback of previous image ([DEPLOYMENT.md](DEPLOYMENT.md) §4; [CI_CD.md](CI_CD.md) §7) | ≤ 30 min | 0 (no data loss) | Every staging deploy exercises gates |

## 2. Recovery priorities (what comes back first, and in what order)

1. **PostgreSQL** — everything depends on the ledger; a restored DB with the app down is
   better than the reverse (writes can't corrupt what can't run).
2. **api** — health endpoints first (LB gates), then authenticated routes; enables support
   access + tenant status checks.
3. **web** — user-facing recovery; LB serves web health.
4. **worker** — restarted **last**, deliberately: jobs (reports, recurring journals, sync,
   e-invoicing submissions) must not run against a half-recovered data layer, and a worker
   restart storm against a cold DB causes pool exhaustion
   ([TROUBLESHOOTING.md](TROUBLESHOOTING.md) §jobs).
5. **Client channels** (PHASE-021/022) — desktop/Android resume sync automatically; do not
   force-update clients during recovery unless the server contract changed.

**Tenant read-only mode.** During S3/S5 deliberations the incident commander may switch
tenants to read-only: reads and reports stay available, posting/approval endpoints return
a maintenance error, offline clients queue locally (POS sales queue per A-011; other
documents honestly refuse — [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4).
This bounds further ledger damage while preserving evidence. Read-only mode is a platform
flag (ops-controlled), announced per §3, and its activation writes an audit event.

## 3. Communications plan

| Channel | During | After |
|---------|--------|-------|
| Status page | Incident banner within 15 min of Sev-1 declaration; updates every 30 min | Root-cause summary within 72 h |
| Tenant email/notice (AR + EN) | For S1/S3/S4/S5 with user-visible impact: disruption notice + read-only notice where applicable | All-clear + data-restoration statement (what was lost, what tenants should re-check) |
| Ops channel | Live timeline, decisions, timestamps (source for the review) | Drill-log / post-mortem links |

Templates (kept short on purpose; the status page carries the detail):

- **Disruption notice** — AR: «نواجه اضطرابًا في الخدمة حاليًا، ونعمل على استعادتها. سيتم
  تحديث هذه الصفحة كل ٣٠ دقيقة.» / EN: "We are experiencing a service disruption and are
  working on recovery. This page is updated every 30 minutes."
- **Read-only mode** — AR: «النظام في وضع القراءة فقط مؤقتًا لحماية بياناتكم أثناء
  المعالجة.» / EN: "The system is temporarily in read-only mode to protect your data
  during recovery."
- **All-clear + restoration statement** — AR: «تمت استعادة الخدمة. المعلومات المسجلة
  خلال الفترة (التوقيت المذكور) قد تحتاج لإعادة الإدخال.» / EN: "Service is restored.
  Entries recorded during the affected window (time noted) may need to be re-entered."

## 4. Dependencies — WORM backups are the last line

- The ransomware path (S4) assumes the backup bucket's **object-lock (WORM) + versioning**
  is intact and credentials are isolated from app roles
  ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §1, §9). WORM config is checked
  quarterly and attested monthly ([BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §8).
- Cross-region replication of backup objects is configured from MVP for the S1 path
  ([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md) §Restore design);
  application-level multi-region failover is explicitly **not** an MVP capability
  (A-012: single region at MVP).

## 5. GA DR drill (PHASE-025 — mandatory gate)

1. **Tabletop**: region-loss scenario (S1) walked through by on-call + engineering lead +
   product owner, cold, using only written runbooks; gaps recorded as actions.
2. **One cross-region restore rehearsal**: execute
   [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §7 end-to-end in the recovery
   region, timed — the recorded wall time is the evidence for the RTO ≤ 8 h claim.
3. **Evidence**: drill records appended to the runbook §8 log + GA release checklist
   ([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) §GA gate: "DR drill
   completed within RTO; restore-from-backup proven").
4. **Failure** of either part blocks the GA release until repeated successfully.

**Drill execution (2026-11-06).** The **tabletop is COMPLETE** — the S1 region-loss walk
executed cold from the written runbooks; record:
[dr-drill-2026-11-06.md](dr-drill-2026-11-06.md) (decision walk + the gap list G1–G11
with owners; two doc fixes applied in-flight). The **cross-region restore rehearsal runs
at local tier via `pnpm --filter @erp/api restore:drill-ga`**
([`apps/api/scripts/restore-drill-ga.ts`](../../apps/api/scripts/restore-drill-ga.ts))
in the PHASE-025 serial gate — the orchestrator executes it (embedded-PG exclusivity:
subagents do not boot instances) and fills the runbook §8 row's timings (the ORCH-FILL
markers): two fresh embedded PostgreSQL 16 instances standing in for the primary +
recovery regions, the recovery instance bootstrapped from virgin (full migration chain
0001→0036), a nightly-shaped dump restored timed, §3 step 4 invariant smoke + row-count
parity. **The recovery-region wall time (the full RTO ≤ 8 h clock) is infra-gated**: §7
step 2's recorded IaC + `deploy/compose.prod.yml` provisioning and the step 4 DNS/LB
cutover are the hosted legs — the hosted-tier re-run is the standing follow-up obligation
recorded with the drill (gap G4 of the tabletop record).

## 6. Post-incident review (required for S1–S5; recommended for S6)

- Held within **5 business days** of closure, blameless, run by someone who was not the
  incident commander.
- Required inputs: ops-channel timeline, audit events around the window, drill/restore
  logs, tenant comms.
- Required outputs: root cause, detection-time (alert fired vs incident start), action
  items with owners and phases (new alerts → [MONITORING.md](MONITORING.md) §3; new
  runbook steps → the owning runbook; new risks →
  [../planning/RISK_REGISTER.md](../planning/RISK_REGISTER.md) update protocol).
- Review record filed with the incident record; recurring-cause items get roadmap or
  phase-document updates — "be more careful" is not an action item.

## 7. Readiness inventory (what must exist for this plan to work)

Reviewed quarterly (with the backup drill) and at each phase gate:

| Readiness item | Owner | Verified by |
|----------------|-------|-------------|
| WORM backup bucket + cross-region replication current | Ops | [BACKUP_RESTORE_RUNBOOK.md](BACKUP_RESTORE_RUNBOOK.md) §8 attestation — local-tier restore mechanics proven at the 2026-11-01 drill + re-run by the 2026-11-06 drills (§8 log rows — orchestrator-run, timings ORCH-FILL); the WORM/replication inspection itself is the hosted §8-attestation leg (tabletop gap G3) |
| Infrastructure-as-code for re-provisioning LB/nodes/DB (recorded at provisioning) | Ops | Cold re-provision exercise at PHASE-025 rehearsal — exercised at local tier by `restore:drill-ga` (2026-11-06, orchestrator-run in the serial gate: fresh instance + full migration chain 0001→0036 + nightly-shaped restore); the IaC + `deploy/compose.prod.yml` provisioning leg remains hosted (tabletop gap G4) |
| Status page + tenant notice templates (AR/EN) reachable and pre-drafted | Product + Ops | §3 templates reviewed each release — exercised in the 2026-11-06 S1 tabletop (AR+EN quoted verbatim); the status-page service itself is a hosted artifact (tabletop gap G6) |
| On-call roster with escalation contacts current | Ops lead | Rotation handoff notes |
| Tenant read-only mode flag tested (staging) | Engineering | PHASE-014+ staging exercise — tenant-scope enforcement proven in-platform (the PHASE-014 full-route read-only sweep); the ops-controlled platform-wide switch + its activation audit event are the open decision record (tabletop gap G5) |
| Incident severity ladder rehearsed (tabletop) | All | PHASE-025 GA drill §5 — executed 2026-11-06 ([dr-drill-2026-11-06.md](dr-drill-2026-11-06.md)) |
