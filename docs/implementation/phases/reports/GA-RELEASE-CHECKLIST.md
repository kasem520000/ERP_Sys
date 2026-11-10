# GA Release Checklist — v1.1.0 (General Availability)

> **Tier:** **GA** (PHASE-023…025 per
> [RELEASE_STRATEGY.md](../../../planning/RELEASE_STRATEGY.md) §Release tiers) ·
> **Date:** 2026-11-06 · **Phase:** [PHASE-025](../PHASE-025.md) §2 items 10–12 / §6 ·
> **Gate clause:** [MASTER_ROADMAP.md](../../../planning/MASTER_ROADMAP.md) §Release gates → GA gate
>
> **Release identity:** semver-style tag **`release/v1.1.0`** + CalVer alias
> **`v1.26.11.0`** (`v1.YY.MM.patch`, per §Branching & versioning — the MVP precedent:
> `release/v1.0.0` + `v1.26.10.0`). Tags are created by the orchestrator at commit time
> (this repo carries `.git` — unlike the MVP zip handover, the tags are real repository
> objects): `release/v1.1.0`, `v1.26.11.0`, `phase/025`.
>
> **GA-candidate SHA:** `af473f8` (PHASE-024 base) + the PHASE-025 working tree — the release commit carrying this checklist; the tags `release/v1.1.0` + `v1.26.11.0` + `phase/025` point at it (see `git describe --tags`)
>
> **Status legend:** `CLOSED` (evidenced, no gating leg) · `CLOSED-LOCAL-TIER` (executed
> and evidenced at the local/sandbox tier; the hosted leg is a named follow-up obligation,
> not a quiet pass) · `INFRA-GATED` (the gate-closing leg requires hosted/production-class
> infrastructure; local-equivalent evidence + the standing waiver recorded) ·
> `OPEN`/`BLOCKED-EXTERNAL` (not closed; owner + record named).

## Honest-marker preamble (read before any status is quoted outward)

The phase's split discipline
([master plan](../../../../agent-ctx/PHASE-025-MASTER-PLAN.md) — same as PHASE-023/024):
everything buildable, drillable, and provable in this delivery environment is EXECUTED
with evidence; the genuinely hosted legs carry the **standing owner-directive waiver
(2026-10-28, the
[v1.0.0 notes](../../../planning/RELEASE_STRATEGY.md) pattern)** — local-equivalent
evidence recorded, named follow-up obligations, **a missed item = a documented INCOMPLETE,
never a quiet pass**. The load-gate rule is quoted verbatim from
[PERFORMANCE_TEST_PLAN.md](../../../testing/PERFORMANCE_TEST_PLAN.md) §8:

> "a FAIL verdict requires (1) root-cause analysis within 5 business days, (2) application
> of at least one documented option, (3) a full-load re-run that passes before the GA gate
> closes; **passing on a weaker hardware profile than §6 production-class does not close
> the gate**."

Decided up front (the master plan's honest markers, encoded here as statuses):

| Hosted leg | Status carried below |
|---|---|
| Production-class hosted k6 full-load run | **INFRA-GATED** (criterion 1) — local-equivalent at the documented §3 volumes; §8 rule quoted above |
| 12 h staging soak | **INFRA-GATED** (criterion 1) — the compressed soak proves the no-drift assertion machinery at sandbox scale |
| Cross-region recovery-region wall time | Hosted number; §7 procedure **executed at local tier** (criterion 2 = CLOSED-LOCAL-TIER) |
| External pen-test firm engagement | **INFRA-GATED waiver** (criterion 4) — internal §11 re-verification green over the full scope list |
| T-03 client-hardware measurement | **Device-farm deferral** (criterion 1) — the PHASE-022 record; local SQLite-read substrate timing recorded where measurable |
| Report-run quota (MULTI_TENANCY §5) | **Open GA note** (criterion 1) — the PERF-A finding; owning slot [DR-P25-07](../../../decisions/technical/DR-P25-07-report-quota.md) |
| OQ-009 retention legal review | **BLOCKED-EXTERNAL unchanged** (criterion 7) — [DR-024-02](../../../decisions/DR-024-02-privacy-retention-oq009.md); the 90-day working assumption governs; no compliance claim |

## Summary ledger — PHASE-025 §6 acceptance criteria (the 11)

| # | Criterion (short form — full text in the section) | Status |
|---|---|---|
| 1 | Load evidence (full-load 10×, T-01…T-08, DB baselines, spike, soak) | **INFRA-GATED** (local-tier evidence recorded; §8 rule) |
| 2 | DR drill evidence (S1 tabletop + timed cross-region rehearsal, RTO ≤ 8 h) | **CLOSED-LOCAL-TIER** (recovery-region wall time hosted) |
| 3 | Restore evidence (second-engineer cold PITR, RTO ≤ 4 h / RPO ≤ 15 min, 27/30 smoke) | **CLOSED-LOCAL-TIER** (attestation month honestly 2026-12) |
| 4 | Pen-test closure + scoped GA re-test green + regressions in CI | **CLOSED-LOCAL-TIER** (external-firm leg the standing INFRA-GATED waiver) |
| 5 | Runbooks validated (cold runs + fixes; every alert links a runbook) | **CLOSED** (agent-role attribution noted) |
| 6 | Error-budget process live (SLOs, burn alerts, policy recorded, 2× headroom) | **CLOSED-LOCAL-TIER** (pipeline-backed panels = DR-P25-06) |
| 7 | Compliance status honest (DR-001 clause; no claim without evidence) | **CLOSED** (ZATCA honestly UNVERIFIED; OQ-009 BLOCKED-EXTERNAL noted) |
| 8 | Docs-drift final validation green on the release tag | **CLOSED** — gate run 2026-11-06: docs:validate 29/29 · permissions-drift 244=244 · check:rls in-suite green · capabilities-matrix agree · i18n 3399=3399 · depcruise 0 violations/2209 modules (full battery in §8's evidence block) |
| 9 | Release process executed per RELEASE_STRATEGY | **CLOSED-LOCAL-TIER** (artifacts + tags real; cohort rollout is the post-tag operational plan) |
| 10 | Post-GA pointer recorded (owning decision-record slots) | **CLOSED** (DR-P25-01…07 filed + indexed) |
| 11 | Criteria copied into PHASE_ACCEPTANCE_CRITERIA.md + this checklist | **CLOSED** |

---

## 1. Load evidence

> **Criterion (PHASE-025 §6.1, quoted):** "full-load 10× run PASSES on the
> production-class profile with all T-01…T-08 within budget (or a decision-record waiver
> naming the compensating option); DB baselines asserted; spike degrades gracefully; soak
> clean; report attached."

**Status: INFRA-GATED.** The gate-closing leg is the production-class hosted k6 run
([PERFORMANCE_TEST_PLAN.md](../../../testing/PERFORMANCE_TEST_PLAN.md) §6 profile); per
the §8 rule quoted in the preamble, the local-harness tier (embedded PostgreSQL 16, same
major as compose) cannot close it. Local-equivalent evidence, executed at the documented
§3 volumes (1 large ≈ 100k docs / 50 users + 50 mid ≈ 10k / 5–10 users + 500 small ≈ 1k /
1–2 users; 1.1M documents; 60/25/15 sales/purchases/treasury; RLS on; deterministic seed):

- **T1 volume generator**: `apps/api/src/__db__/performance/ga-fixtures.ts` (deterministic
  tenant-mix generator; counts/distributions validated in-spec).
- **T2 full load**: `ga-full-load.db.spec.ts` — T-01…T-08 assertions + the §4 DB baselines
  (pool saturation, timeout classification, **top-10 hot queries EXPLAIN-verified with the
  RLS predicate present and index-driven**, slow-query budget, queue health, no
  cross-tenant lock waits).
- **T4a spike**: `ga-spike.db.spec.ts` — 429-before-collapse via the R-04 per-tenant
  limiter (SF-024-001's mechanism) + recovery < 5 min.
- **T4b report hammer**: `report-hammer.db.spec.ts` — noisy-neighbor isolation proven
  (the large tenant's heaviest concurrent report runs leave the small tenant within its
  budgets); **quota gap honestly recorded** (see Open GA note A below).
- **T5 soak**: `soak-shaped.db.spec.ts` — the compressed soak with no-drift slope
  assertions (heap/queue-depth/budget sampling); the **12 h staging soak is the gated
  leg** — the compressed run proves the assertion machinery, not the 12 h wall time.
- **T-03 client hardware**: `< 2 s scan-to-cart on mid-range reference hardware` — the
  on-device leg is the **PHASE-022 device-farm deferral** (the recorded
  `device-farm` CI job); the network-free local SQLite-read substrate timing is recorded
  where measurable.

GATE RUN 2026-11-06 (local harness tier — embedded PostgreSQL 16, sandbox scale ≈ 12% of the §3 1.1M-doc cohort; hosted production-class = the infra-gated obligation, §8 quoted):
  - `[ga-full-load] T1 volume large=100000 (sales=60000/purchases=25000/treasury=15000, lines=200000) mid=30000 small=5000`
  - T-01 document-list p95=**8ms** (p50=6 p99=8, n=20, 100k rows) budget 500ms — PASS
  - T-02 posting p95=**23ms** (p50=5 p99=30, n=30) budget 300ms — PASS
  - T-04 interactive-tier p95=**1ms** cached (compute-first-pass tb=343ms daily-revenue=31ms daily-cash=7ms reorder=5ms) budget 2s — PASS; standard-statement-tier p95=**1576ms** (TB/IS/BS compute @100k, distinct params) budget 10s — PASS
  - T-05 sync push p95=**119ms** (batches of 10) + pull p95=**3ms** (batches of 100) round-trip p95=**122ms** budget 3s — PASS
  - T-06 login+shell p95=**183ms AR / 177ms EN** budget 1.5s — PASS
  - T-07 5xx=**0/305 (0.000%)** budget <0.1% — PASS
  - T-08 posting-throughput **111.3 posts/s** (n=64, 8 lanes) budget ≥20 — PASS
  - DB baselines: pool maxInUse=8/20 (**40%**) maxWaiting=0 budget <70% — PASS; EXPLAIN top-10 **10/10 tenantPredicate=present**, seqScan=none on every indexed table — PASS; slow-queries interactive-plane 0/62 (budget 6.2) — PASS; pg-boss load-depth (non-system) draining 1→6→stable-≤50 + failed-delta 0 — PASS; cross-tenant-lock concurrent-elapsed=86ms vs sequential-equivalent=664ms (overlap proven, no lock waits) — PASS
  - `[ga-spike]` first-429 at attempt ≤1001 (ceiling 1000/10s): code=TENANT_RATE_LIMITED, X-RateLimit-Limit=1000, Remaining=0, Retry-After=7s; A/B isolation B=998/1000 while A saturated; recovery via 10s window expiry, X-RateLimit-Remaining=90; requests=1014 5xx=0 transportErrors=0 — graceful degradation PASS (recovery well inside <5min)
  - `[report-hammer]` 3 waves × 4 concurrent TB computes @100k all SUCCEEDED (max wave 17.9s); noisy-neighbor: small-tenant TB compute p95=**14ms** + list p95=**15ms** inside budgets — PASS; honest marker: NO per-tenant report-run quota exists at PHASE-025 HEAD (MULTI_TENANCY §5 gap → DR-P25-07)
  - `[soak-shaped]` retained heap (post-forced-GC) first-third 123.7MB vs last-third 123.3MB (**ratio 0.996 — no drift**); queue depth 0/stable, failed 0; error-budget 5xx=0/460 reads + 190 posts + 114 reports (764 ops/200s) — PASS (compressed window; 12 h staging = gated)
  - Production-bug findings fixed in-phase: SF-025-001 (PushService DI paramtypes — found by T-05), SF-025-002 (pool-before-limiter collapse mode at 8×-ceiling loopback storms — recorded, mechanism documented)

**Options-ladder state:** no target miss has been routed through O-1…O-5 as of this
checklist's authoring; the gate run above is the authority
([PERFORMANCE_TEST_PLAN.md](../../../testing/PERFORMANCE_TEST_PLAN.md) §8).

## 2. DR drill evidence

> **Criterion (PHASE-025 §6.2, quoted):** "region-loss tabletop executed with recorded
> actions; the cross-region restore rehearsal completed end-to-end with recorded wall time
> within RTO ≤ 8 h — or GA is blocked until repeated successfully."

**Status: CLOSED-LOCAL-TIER.**

- **S1 tabletop (§5 item 1)** — EXECUTED cold (written runbooks only, no tribal
  knowledge): [dr-drill-2026-11-06.md](../../../operations/dr-drill-2026-11-06.md) —
  the decision-point walk (declaration, recovery-priority order, comms templates,
  readiness inventory) with the **gap list recorded as actions** (G1–G11, e.g. the
  alerting-stack-region finding F1, the severity-ladder wording F2). Participants: the
  AI-agent session walking the IC/engineering-lead/product-owner seats per the recorded
  role pattern — the walk proves the runbooks execute from cold text, not human
  coordination (honestly stated in the record).
- **Cross-region restore rehearsal (§5 item 2)** — EXECUTED at local tier:
  `restore:drill-ga` (`apps/api/scripts/restore-drill-ga.ts`) — fresh embedded
  environment + **full migration chain re-apply** + nightly-shaped dump restore + timed
  execution + the §3 invariant smoke + row-count parity, per
  [BACKUP_RESTORE_RUNBOOK.md](../../../operations/BACKUP_RESTORE_RUNBOOK.md) §7. The
  §8 drill-log row: [BACKUP_RESTORE_RUNBOOK.md](../../../operations/BACKUP_RESTORE_RUNBOOK.md) §8
  (2026-11-06 cross-region row). **Hosted legs (named follow-ups):** the §7 step-2 IaC
  provisioning, the cross-region artifact fetch, and the step-4 DNS/LB cutover — the
  **recovery-region wall time remains the infra-gated RTO evidence**; the local tier
  proves the procedure and its timing machinery end-to-end.

GATE RUN 2026-11-06: recovery bootstrap (full chain 0001–0036 re-applied) 2.3s; pg_restore --no-owner --jobs=4 **1.1s** (RTO 8 h — GREEN, restore leg measured; provisioning + cutover hosted); RPO 0 rows (drill semantics; replication lag = managed-tier claim); invariant smoke a–f ALL GREEN + boss-schema exclusion shape GREEN; row-count parity 5/5 identical; total wall 7.0s; **DRILL PASSED** (runbook §8 row 2026-11-06 cross-region, filled).

## 3. Restore evidence

> **Criterion (PHASE-025 §6.3, quoted):** "second-engineer cold PITR restore within
> RTO ≤ 4 h and measured RPO ≤ 15 min, invariant smoke green, signed drill record in
> runbook §8; nightly restore-smoke ≥ 27/30 days in the attestation month."

**Status: CLOSED-LOCAL-TIER.**

- **Second-engineer cold PITR drill** — EXECUTED 2026-11-06: the §4-shaped quarterly
  cold drill run from the runbook only, by agent #2 (the PHASE-025 session — not the
  runbook's authoring session; the second-engineer property holds at session level,
  honestly stated). The signed row lives in
  [BACKUP_RESTORE_RUNBOOK.md](../../../operations/BACKUP_RESTORE_RUNBOOK.md) §8 (the
  2026-11-06 quarterly row; the MVP-gate precedent row 2026-11-01 PASSED with RTO 0.7 s /
  5/5 parity / a–f smoke green).
- **Attestation clause (27/30), honestly:** **NOT SIGNED for 2026-11** — this environment
  has the §3 nightly-smoke as an executable procedure + the drill log, **not 30 calendar
  days of scheduled runs**, and no WORM bucket to inspect (DR tabletop gap G3). The first
  attestable month is **2026-12** (on-call lead signs 2026-12-01). The gap is carried
  here explicitly rather than a fabricated attestation
  ([BACKUP_RESTORE_RUNBOOK.md](../../../operations/BACKUP_RESTORE_RUNBOOK.md) §8
  attestation block).

GATE RUN 2026-11-06: pg_dump -Fc 0.2s (1107 KiB); DROP/CREATE + pg_restore **1.3s** (RTO 4 h — GREEN); RPO 0 rows (drill semantics); invariant smoke a–f ALL GREEN; row-count parity 5/5 identical; **DRILL PASSED** (runbook §8 row 2026-11-06 quarterly, filled).

## 4. Pen-test closure + the GA re-test slice (T12)

> **Criterion (PHASE-025 §6.4, quoted):** "PHASE-024 findings closed per SLA (no open
> Critical; High closed or waiver-recorded); the scoped GA re-test is green; regression
> tests for every fixed finding remain in CI."

**Status: CLOSED-LOCAL-TIER** — the internal leg is closed with evidence; the
external-firm leg carries the standing INFRA-GATED waiver.

**Closure state (from [security-findings.md](../../../operations/security-findings.md),
re-read 2026-11-06):**

- **Critical open: 0** — the release-blocking rule holds.
- **High open: 3, none release-blocking** (the §11 rule is Critical-only blocks):
  - SF-024-016 `image-size@1.2.1` (2 HIGH advisories) — build-time-only exposure
    (bundler path, not in any shipped runtime bundle); **SLA 30 d, clock started
    2026-11-06**; rides the next mobile dependency pass.
  - SF-024-017 `multer@2.4.0` (1 HIGH advisory) — **unreachable**: 0 multipart routes in
    the API surface, re-verified by search; **SLA 30 d**; removal ticketed with the next
    express-stack pass.
  - SF-024-022 pre-existing device tokens not retroactively MFA-gated — documented
    residual (THREAT_MODEL B1/S-16) with the operational answer (admin reset
    `identity.mfa.admin_reset` + session revocation; re-attestation at next enrollment).
- **Medium open: 2** (90-day clocks): SF-024-018 `uuid@8.3.2` transitive (test/doc paths);
  SF-024-021 in-process metrics substrate (the OTel exporter swap — owning slot
  [DR-P25-06](../../../decisions/technical/DR-P25-06-observability-exporter.md); no
  waiver needed: the counter + fatal logging exist).
- **Every other finding FIXED in-phase** (SF-024-001…015, 019, 020) with **fix +
  regression-test links per row** — the named specs (e.g. `tenant-rate-limit.spec.ts` 7
  tests, `mfa-policy.db.spec.ts` 9, `offboarding-purge.db.spec.ts` 7,
  `secrets-rotation` 15/15 + the drill, `security-headers.spec.ts`, the audit-console
  and support-review assertions) run inside the standing suites; their green re-run on
  the GA-candidate SHA is the regression claim's proof.
- **External-firm leg:** the recorded infra-gated waiver — no external firm reachable
  from the delivery environment; the **internal re-verification EXECUTED over the full
  §11 scope list** (web+BFF probes incl. CSP/M-03, full API route × role surface, the
  multi-tenancy/RLS spine with tenant-pair fixtures A1–A11 over the 156-table registry,
  POS, sync, file/export, native clients, the e-invoicing sandbox surface, CI/CD review).
  A partial-scope external report would be an INCOMPLETE marker, not a pass — the
  engagement record says exactly that
  ([security-findings.md](../../../operations/security-findings.md) §Pen-test engagement
  record). **Re-engage the firm at first hosted availability; the §11 cadence still
  requires the external leg before/with the next major tier.**

**GA re-test slice basis (the "scoped re-runs before GA" per
[SECURITY_TEST_PLAN.md](../../../security/SECURITY_TEST_PLAN.md) §11):** the
orchestrator's full serial gate on the GA-candidate SHA — the DB suite **including** the
isolation/attack suites (tenant isolation A1–A11, the RLS attack suite, the
headers-CSP/M-03 probe suite, the MFA-policy matrix, the offboarding-purge drill, the
secrets-rotation drill, the support-review/RLS-canary specs) + the security probe suites
of web — i.e. the same suites that constituted the internal §11 re-verification, re-run
green on the release SHA.

GATE RUN 2026-11-06: DB suite **143 files / 2035 tests ALL PASS** (139/2019 at PHASE-024 + 4 perf files +16) — including isolation (rls-attacks + isolation/ 2 files), MFA policy, offboarding-purge, secrets-rotation, support-review+rls-canary, master-data/identity/tenancy HTTP probes; unit api 32/334 · web 5/73 · desktop 16/274 · mobile 27/393; permissions-drift 244=244; findings log 0 Critical open (17 fixed w/ regression links; SF-024-016/017 High 30-day clocks + SF-024-018/021 Medium 90-day + SF-024-022 residual — all with rationale/owners).

## 5. Runbooks validated

> **Criterion (PHASE-025 §6.5, quoted):** "deployment + backup/DR runbooks cold-run by
> second engineers with fixes landed; every alert links a runbook (audit output)."

**Status: CLOSED.**

- **Deployment runbook cold validation (T8)** —
  [deployment-cold-run-2026-11-06.md](../../../operations/deployment-cold-run-2026-11-06.md):
  PASS with **fixes applied** — three §2 smoke-block code-drift bugs, one §6 wording
  drift, one command-convention ambiguity, one cross-doc reference error, all fixed in
  [DEPLOYMENT.md](../../../operations/DEPLOYMENT.md); hosted legs recorded with owners
  (§9 of the record). Second-engineer property at session level (the DR-C session did
  not author the §7 additions it validated).
- **Backup/DR runbooks cold-run** — the §4 quarterly drill (criterion 3) + the §7
  rehearsal (criterion 2) were both run **from the written runbooks only**;
  tabletop gaps G1–G11 are recorded as actions in
  [dr-drill-2026-11-06.md](../../../operations/dr-drill-2026-11-06.md).
- **Every alert links a runbook (T10 audit)** — `pnpm check:observability`: every
  [MONITORING.md](../../../operations/MONITORING.md) §3 alert → runbook anchor exists;
  §1 dashboards enumerated; `erp_<module>_<name>_<unit>` naming; retention config
  presence; redaction fail-closed spot checks.

GATE RUN 2026-11-06: `observability audit: 19 alerts linked / 11 dashboards / 35 metrics conformant / retention documented / redaction fail-closed` — GREEN (scripts/check-observability.ts; every §3 alert's runbook section verified present).

## 6. Error-budget process live

> **Criterion (PHASE-025 §6.6, quoted):** "SLO dashboards populated, burn alerts wired,
> the freeze-on-exhaustion policy recorded in the GA release checklist, load-run burn
> evidence shows 2× headroom."

**Status: CLOSED-LOCAL-TIER.** The SLO substrate is live in-process; pipeline-backed
panels/30-day windows are the exporter follow-up
([DR-P25-06](../../../decisions/technical/DR-P25-06-observability-exporter.md)).

- **SLOs live (finalized 2026-11-06)** — the six
  [MONITORING.md](../../../operations/MONITORING.md) §5 SLOs (API availability 99.9%
  monthly; API latency p95 within NFR-006/T budgets; posting success ≥ 99.99% with **zero**
  invariant failures — any occurrence Sev-1 regardless of budget; backup + restore-smoke
  100% of scheduled runs; sync push ≥ 99.5%/24 h; report render SLA per T-04 tier),
  measured by the in-process registry (`apps/api/src/infra/observability/metrics.ts` +
  `metrics.middleware.ts`, names `erp_<module>_<name>_<unit>`) and evaluated at
  `GET /api/v1/platform/slo` + the `/[locale]/platform/slo` screen. Honest window
  semantics recorded (§5): the in-process window is process lifetime; **NO_DATA never
  shows green** — the backup leg lives there until the pipeline lands (only the
  `recordRestoreSmokeOutcome` seam exists).
- **Burn alerts wired** — `SLOBurn` (burn = observed ÷ allowed error rate): ≥ 2× pages
  Sev-2, ≥ 4× pages Sev-1 ([MONITORING.md](../../../operations/MONITORING.md) §3 row);
  the evaluator (`slo.ts`) is proven by the seeded-burn spec `slo.burn.spec.ts` (2× and
  4× seeded rates fire the right severities).
- **Error-budget policy (recorded verbatim as a checklist row):**

| Policy statement (verbatim) | Source |
|---|---|
| "Budget exhausted → **feature releases pause; fixes only**" — feature releases pause on budget exhaustion | [MONITORING.md](../../../operations/MONITORING.md) §5 (API-availability row) + [RELEASE_STRATEGY.md](../../../planning/RELEASE_STRATEGY.md) (the release tier this checklist executes) |
| Any posting-invariant failure (`ENTRY_NOT_BALANCED` — INV-001/002) is **Sev-1 regardless of budget** | [MONITORING.md](../../../operations/MONITORING.md) §5 (posting-success row) |
| A missed restore-smoke **blocks the next release pre-flight**; missed backup budget = single miss exhausts | [MONITORING.md](../../../operations/MONITORING.md) §5 + [DEPLOYMENT.md](../../../operations/DEPLOYMENT.md) §1 row 3 |

- **Load-run burn evidence (2× headroom)** — from the GA gate load run
  ([PERFORMANCE_TEST_PLAN.md](../../../testing/PERFORMANCE_TEST_PLAN.md) §5):
  GATE RUN 2026-11-06 (local tier): observed 5xx across every load scenario = **0** (T-07 0/305; soak 0/460; spike 0/1014) → observed error rate 0.000% vs the 0.1% monthly availability budget = **zero burn, ≥ 2× headroom trivially intact at this tier**; the SLOBurn machinery itself proven by the seeded-burn spec (24/24: fires at 2× Sev-2 / 4× Sev-1; NO_DATA never green). The hosted-tier burn evidence re-reads at the production-class run.

## 7. Compliance status honest — the e-invoicing clause

> **Criterion (PHASE-025 §6.7, quoted):** "the e-invoicing clause resolves exactly as
> [MASTER_ROADMAP.md](../../../planning/MASTER_ROADMAP.md) §GA gate requires — ZATCA
> adapter certified per official requirements **or** the launch segment explicitly
> excludes e-invoicing-requiring taxpayers via the documented decision
> ([DR-001](../../../decisions/compliance/DR-001-zatca-scope-and-timing.md)); every
> compliance statement in docs/release notes traces to verification-log evidence — **no
> compliance claims without evidence anywhere**."

**Status: CLOSED** — the clause resolves via the documented decision (the second arm of
the gate's "or").

- **The ZATCA adapter is the `UNVERIFIED` refuse-to-submit stub** (PHASE-023): the
  verification gate GATE-1..GATE-4 is honestly NOT_VERIFIED (no external access; nothing
  fabricated) — every regulated action refuses, naming the unmet items. **No e-invoicing
  compliance is claimed anywhere.**
- **DR-001 clause resolution (option C — quoted):** the record is OPEN with option C
  recommended, and its consequences section states exactly:
  > "**If C is accepted**: the GA gate clause resolves as 'launch segment excludes
  > integration-wave taxpayers, documented here; integration adapter ships certified in
  > the first post-GA release with its own checklist'"
  and its no-decision default:
  > "**No decision by the deadline**: option A behavior applies by default (most
  > conservative), and the GA gate records the exclusion explicitly."

  Either way the gate clause's second arm holds: **the launch segment excludes
  e-invoicing-requiring (integration-wave) taxpayers**, per
  [DR-001](../../../decisions/compliance/DR-001-zatca-scope-and-timing.md); generation-phase
  features (serialized numbering, QR/TLV, invoice hash, anti-tampering) are the shipped
  surface. Sales/onboarding copy must not market to wave-mandated taxpayers — the
  release notes
  ([v1.1.0.md](../../../operations/release-notes/v1.1.0.md)) carry the user-readable
  wording.
- **OQ-009 (retention), honestly:** **BLOCKED-EXTERNAL unchanged**
  ([DR-024-02](../../../decisions/DR-024-02-privacy-retention-oq009.md)) — the
  90-day-then-hard-delete + 14-day-grace working assumption governs (named PLACEHOLDER
  constants in the purge service); GA materials present the retention period as pending
  legal review — **no compliance claim**. This checklist re-reads the BLOCKED status per
  the record's hard revisit trigger.
- Every other compliance statement traces to the compliance-matrix verification log
  ([compliance-matrix](../../../localization/compliance-matrix/README.md) — the CD-05
  marketing rule: no copy may claim what the verification log does not evidence).

## 8. Docs-drift final validation green

> **Criterion (PHASE-025 §6.8, quoted):** "schema catalog, permissions, invariants
> mapping, capabilities matrix, phase tables — all CI checks green on the release tag;
> IMPLEMENTATION_STATUS reflects every phase (and every INCOMPLETE gated item) honestly."

**Status: CLOSED** (on the gate outputs below — the release-tag re-run is the record).

- The drift battery: `docs:validate` (link/section checks), `check:permissions-drift`
  (244=244 at PHASE-024 exit — no new permission keys this phase, per the §4 constraint),
  `check:rls`, `check:capabilities-matrix`, `check:i18n-parity`, `lint:depcruise`,
  `check:deps`, unit suites (api/web/desktop/mobile).
- PHASE-025 is tuning-only: no migrations, no tables, no permission keys (§4) — the
  catalogs are unchanged from PHASE-024's green state; the re-run proves no drift was
  introduced.

GATE RUN 2026-11-06: docs:validate **29/29** · permissions-drift **244=244** (zero new keys) · check:rls **in-suite green** (migrations.db.spec) · capabilities-matrix **agree** (25 PASS rows) · i18n parity **3399=3399** (+56/locale) · depcruise **0 violations / 2209 modules** · check:deps **0 prod violations** · typecheck 8/8 · lint 8/8 · unit api 32/334 · web 5/73 · desktop 16/274 · mobile 27/393.

## 9. Release process executed per RELEASE_STRATEGY

> **Criterion (PHASE-025 §6.9, quoted):** "CalVer tag, quality gates, cohort rollout
> with staged client channels, bilingual release notes; no partially verified phase
> shipped."

**Status: CLOSED-LOCAL-TIER** — the release artifacts + tags are real (created at commit
time by the orchestrator; this repo has `.git`); the hosted cohort rollout is the
post-tag operational plan recorded here.

- **CalVer tags (created at commit time):** `release/v1.1.0` + `v1.26.11.0` + `phase/025`
  — the execution-log row:
  [RELEASE_STRATEGY.md](../../../planning/RELEASE_STRATEGY.md) §Release execution log.
- **Quality gates re-run** (the serial gate): GATE RUN 2026-11-06 (serial, orchestrator-executed): typecheck 8/8 GREEN · lint 8/8 GREEN · depcruise 0/2209 GREEN · DB suite 143/2035 GREEN (chunked serial execution — embedded-PG exclusivity) · restore:drill PASSED · restore:drill-ga PASSED · check:observability GREEN · docs:validate 29/29 GREEN · permissions-drift 244=244 GREEN · capabilities GREEN · i18n 3399=3399 GREEN · check:deps GREEN · unit suites GREEN — **every step green on the GA-candidate tree**.
- **No partially verified phase shipped:** PHASE-023/024 COMPLETE with evidence; their
  INCOMPLETE gated items (ZATCA GATE-1..4 unmet; payment production cutover per DR-002
  OPEN; ETA NOT_STARTED) ship as **honest UNVERIFIED/NOT_STARTED states**, not claims —
  the substrate is complete, the unverified legs are named.
- **Bilingual release notes:**
  [docs/operations/release-notes/v1.1.0.md](../../../operations/release-notes/v1.1.0.md)
  (AR first, EN second — Arabic-first platform), generated from
  [CHANGELOG.md](../../../handoff/CHANGELOG.md) entries per §Communication.
- **Cohort rollout plan (recorded — §Rollout):**
  1. **Internal dogfood tenant** →
  2. **5–10 design-partner tenants** (staging data isolation) →
  3. **GA cohorts** (general availability by cohort).
  - Feature flags + entitlement gating for staged exposure.
  - **Client channels staged 10% → 50% → 100% with crash-rate gates** (desktop per
    PHASE-021, Android per PHASE-022 — `ClientCrashRate` halt < 98.5% publishes the
    `minVersion` force-update at any sample size; the gates read the live
    client-stability panels).
  - Migrations expand-contract; never a destructive step in a serving deploy; never break
    lagging offline clients mid-rollout.
  - **Actual-rollout record (infra-gated):** the hosted cohort progression, its gate
    readings, and any halts are appended post-GA by operations as the rollout proceeds —
    Infra-gated (the standing waiver pattern): the hosted rollout proceeds per the
    cohort plan above when the production environment exists; the client channels'
    staged gates (10/50/100 + crash-free ≥ 99.5/99.7, halt < 98.5% → minVersion)
    are LIVE mechanisms (PHASE-021/022) reading the client-stability dashboard —
    the GA cohort readings land there at rollout. The release tags
    (release/v1.1.0 + v1.26.11.0 + phase/025) are created in this repository at
    the GA commit — the recordable rollout step executed here.

## 10. Post-GA pointer recorded

> **Criterion (PHASE-025 §6.10, quoted):** "open items (bug bounty, OQ-008 SLAs, OQ-007
> payments, ETA/UAE follow-ups, iOS) each have an owning decision-record slot."

**Status: CLOSED** — every open item has a filed, indexed owning record (the phase's "no
vague aspirations" rule):

| Open item | Owning record (filed 2026-11-06, STATUS: PROPOSED — trigger + owner recorded) |
|---|---|
| Bug-bounty launch | [decisions/security/DR-P25-01-bug-bounty.md](../../../decisions/security/DR-P25-01-bug-bounty.md) |
| Support SLA commitments (OQ-008) | [decisions/product/DR-P25-02-support-sla.md](../../../decisions/product/DR-P25-02-support-sla.md) |
| Personal-account payments (OQ-007) | [decisions/product/DR-P25-03-personal-payments.md](../../../decisions/product/DR-P25-03-personal-payments.md) |
| Egypt ETA / UAE adapter follow-ups | [decisions/compliance/DR-P25-04-eta-uae-followup.md](../../../decisions/compliance/DR-P25-04-eta-uae-followup.md) |
| iOS client decision slot | [decisions/product/DR-P25-05-ios-client.md](../../../decisions/product/DR-P25-05-ios-client.md) |
| OTel observability exporter swap (SF-024-021) | [decisions/technical/DR-P25-06-observability-exporter.md](../../../decisions/technical/DR-P25-06-observability-exporter.md) |
| Per-tenant report-run quota (MULTI_TENANCY §5) | [decisions/technical/DR-P25-07-report-quota.md](../../../decisions/technical/DR-P25-07-report-quota.md) |

Also standing (filed earlier, read at this gate): WebAuthn/passkeys DEFER post-GA
([DR-024-01](../../../decisions/DR-024-01-webauthn-passkeys.md)); OQ-009 BLOCKED-EXTERNAL
([DR-024-02](../../../decisions/DR-024-02-privacy-retention-oq009.md)); read-replica /
Redis triggers remain per
[ADR-0008](../../../architecture/ADR/ADR-0008-jobs-redis.md) + the
[O-3/O-4 options ladder](../../../testing/PERFORMANCE_TEST_PLAN.md) §8.

## 11. Criteria copied into PHASE_ACCEPTANCE_CRITERIA.md and this checklist

> **Criterion (PHASE-025 §6.11, quoted):** "Criteria copied into
> [PHASE_ACCEPTANCE_CRITERIA.md](../../../planning/PHASE_ACCEPTANCE_CRITERIA.md) and the
> GA release checklist."

**Status: CLOSED.** The §025 row exists in
[PHASE_ACCEPTANCE_CRITERIA.md](../../../planning/PHASE_ACCEPTANCE_CRITERIA.md) (per-phase
criteria table); this document is the enumerated GA release checklist — the 11 criteria
above mirror PHASE-025 §6 verbatim-quoted.

---

## Open GA notes (recorded, owned — never silent)

| # | Note | Owning slot |
|---|---|---|
| A | **Per-tenant report-run quota does not exist at GA** — MULTI_TENANCY §5 specifies "report job concurrency quotas" as an MVP fairness measure; as of PHASE-025 HEAD no per-tenant report-run quota/concurrency cap exists. The report-hammer (criterion 1) proved noisy-neighbor **isolation** under the heaviest concurrent large-tenant report load; the mechanisms that exist are the R-04 per-tenant API burst window (429-before-collapse proven), the global Chromium render-pool semaphore (RISK-013), and the ADR-0011 execution-class split. The quota **mechanism** (concurrency cap vs rolling budget vs queue; flat vs plan-tiered) is the open decision. | [DR-P25-07](../../../decisions/technical/DR-P25-07-report-quota.md) |
| B | Hosted legs with the standing waiver: production-class k6 full-load, 12 h staging soak, recovery-region wall time, external pen-test firm, nightly restore-smoke cadence (first attestable month 2026-12), device-farm on-device matrix (T-03/C-06/C-07/C-13). | This checklist (preamble) + [NEXT_ACTION.md](../../../handoff/NEXT_ACTION.md) follow-ups |
| C | OQ-009 retention legal review BLOCKED-EXTERNAL; DR-002 payment provider OPEN (sandbox hardened, production cutover is the follow-up); DR-001 OPEN (option C) — the first post-GA release carries the ZATCA certification checklist. | [DR-024-02](../../../decisions/DR-024-02-privacy-retention-oq009.md) · [product/DR-002](../../../decisions/product/DR-002-payment-provider-selection.md) · [compliance/DR-001](../../../decisions/compliance/DR-001-zatca-scope-and-timing.md) |

**Definition of Done check (PHASE-025 §8):** the release tag is public (ORCH), cohorts
roll per the recorded plan, SLOs and error budgets govern ongoing work, the
drill/attestation cadences continue as living processes, and every open thread has a
named decision-record home — this checklist is the reviewable record of that state.
