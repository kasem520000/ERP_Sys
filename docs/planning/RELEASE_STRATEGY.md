# Release Strategy

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-11-10 (Blueprint v3.0 wave tiers)

## Release tiers and definitions

| Release | Definition | Content |
|---------|-----------|---------|
| **MVP (v1.0)** | First paid customers, KSA + UAE back-office segment | Phases 001–014 |
| **v1.x industry releases** | Quarterly post-MVP | POS + industry templates (015–017), manufacturing/CRM (018–019) |
| **v2.0 multi-platform** | Desktop + Android + offline field sales | 020–022 |
| **GA** | Compliance integrations + hardening + SLOs | 023–025 |
| **Enterprise Depth** | Post-GA platform depth & breadth: financial depth, industry expansion II, consolidation | 026–034 (stages 9–11) |
| **v3.0 Sellable** | The launch-market unlock: ZATCA Phase-1, custom fields, sourcing, RMA/dunning, migration, communications | 035–041 (stage 12) |
| **v3.0 Full-ERP** | MRP, WMS, HR (core/compliance/growth), projects, CMMS, QMS, foreign trade | 042–051 (stage 13) |
| **v3.0 Enterprise** | Public API/webhooks, payments/commerce, BI, SSO/governance, platform ops | 052–059 (stage 14) |
| **v3.0 Differentiated** | Sales/POS depth, UX excellence, Gulf differentiators, AI copilot, growth | 060–065 (stage 15) |

Each release ships only phases marked `COMPLETE` in
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) with evidence. **No release may
include partially verified phases.**

## Post-GA expansion releases (stages 9–11 — Blueprint v2.0)

Per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md), stages 9–11 (PHASE-026…034) are
**additive post-GA releases**: they never alter the MVP (PHASE-014) or GA (PHASE-025)
gates (ED-01) and may ship as independent releases as their phases complete:

- **Stage 9 — financial depth (PHASE-026…029)**: fixed assets, cheques/promissory notes &
  installments, budgeting, payroll (financial scope) — entitlement-gated modules rolled
  out per the existing feature-flag + cohort rules.
- **Stage 10 — industry expansion II (PHASE-030…033)**: wholesale, electronics,
  healthcare, education, agriculture commercial-shell templates — configuration-layer
  releases on the v1.x industry pattern.
- **Stage 11 — enterprise consolidation (PHASE-034)**: multi-entity consolidation
  (ADR-0018).

**Enterprise Depth gate (after PHASE-034)**: consolidated statements reconcile to member
books with eliminations proven (INV-026, golden G-32); payroll, fixed-assets, and
notes/installments suites green (INV-023…025, goldens G-21…G-31); zero cross-tenant
writes demonstrated (ADR-0018). The release ships only `COMPLETE` phases with evidence
and is tagged per the CalVer scheme like every other release.

## Blueprint v3.0 completeness releases (stages 12–15 — the Full-ERP program)

Per [COMPLETENESS_REGISTER.md](COMPLETENESS_REGISTER.md) (CR-01/CR-38), stages 12–15
(PHASE-035…065) are **additive completeness releases**: they never alter the MVP
(014) / GA (025) / Enterprise-Depth (034) gate criteria, and each wave closes with its
own gate defined in [MASTER_ROADMAP.md](MASTER_ROADMAP.md) §Release gates:

- **Stage 12 — Sellable Foundation (035–041)**: activation & truth restoration,
  extensibility core (custom fields), ZATCA Phase-1 QR, procurement sourcing, RMA +
  dunning, migration toolkit, communications hub. Gate: sellable in launch markets
  (requires OQ-002 resolution — CR-39).
- **Stage 13 — Full-ERP Completion (042–051)**: manufacturing routing + MRP, WMS, HR
  core/compliance/growth, projects & contracting, CMMS, QMS, foreign trade.
- **Stage 14 — Enterprise Platform (052–059)**: workflow engine, accounting depth &
  treasury, tax compliance (+ ZATCA-2/ETA), public API & webhooks, payments & commerce,
  BI & analytics, identity & governance, platform operations & trust.
- **Stage 15 — Differentiation & Growth (060–065)**: sales/CRM depth, POS & retail
  depth, UX excellence & document design, Gulf & Arabic differentiators, AI copilot
  (opt-in), growth platform.

Every v3.0 phase ships with the CR-36 discipline gates (SQL+Drizzle+catalog parity,
permission zero-drift, AR/EN parity, docs:validate, RLS attack tests, feature flags,
sync-surface assessment) and is delivered as the per-phase archive
`ERP_PLATFORM_PHASE0NN.zip` (OA-07).

## Branching & versioning

- Trunk-based: `main` always releasable; short-lived feature branches; PR reviews use
  the [code review template](../implementation/templates/CODE_REVIEW_TEMPLATE.md).
- Versioning: **CalVer for releases** (`v1.YY.MM.patch`) + semver for `packages/*`
  consumed by apps. API versions follow [../api/API_VERSIONING.md](../api/API_VERSIONING.md)
  (URL-prefixed major).
- Every completed phase is tagged `phase/NNN`; every release tagged `release/vX`.

## Rollout

1. Internal dogfood tenant → 5–10 design-partner tenants (staging data isolation) →
   general availability by cohort.
2. Feature flags + entitlement gating for staged exposure of new modules.
3. Desktop/Android: staged rollout channels (10% → 50% → 100%) with crash-rate gates.
4. Migrations: expand-contract; never a destructive step in the same deploy that serves
   traffic (see [../database/MIGRATION_STRATEGY.md](../database/MIGRATION_STRATEGY.md)).

## Quality gates per release

- CI green (unit/integration/E2E/visual AR+EN/tenant isolation/accounting invariants).
- Migration rehearsal on staging succeeded.
- Security checklist: dependency audit, SAST, new-endpoint permission review.
- Performance smoke against NFR-006 budgets.
- Documentation freeze: IMPLEMENTATION_STATUS + CHANGELOG updated; docs validation
  script (link/section checks) passes.

## Communication

- Release notes generated from `CHANGELOG.md` entries (user-facing, bilingual).
- Breaking API changes: deprecation window per [../api/API_VERSIONING.md](../api/API_VERSIONING.md);
  never break offline clients mid-rollout (they lag).

## Rollback

- Apps/API: redeploy previous image (DB-compatible by expand-contract).
- Clients: force-update via minimum-version enforcement (ADR-0014/0013 channels).
- Data: documented per-phase rollback notes; forward-fix preferred over restore;
  restore-from-backup is the last resort with incident process
  ([../security/INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md)).

## Release execution log (append-only)

| Release | Date | Tier | Quality gates | Evidence |
|---------|------|------|---------------|----------|
| **v1.0.0 (MVP)** — CalVer `v1.26.10.0` per §Branching & versioning | 2026-11-01 | MVP (PHASE-001…014) | CI-equivalent local gate: **ALL 17 steps green** (typecheck, lint + module boundaries, depcruise, permissions-drift 224=224, unit 244 tests, db suite 69 files/1153 tests on embedded PostgreSQL 16, build, token contrast, i18n parity 1723/1723, ui-catalog 37↔60, visual harness 16/16 + axe, web CSP/security probe, docs validation 29/29, negative meta-tests ×3). Migration rehearsal: fresh-apply of 0001–0021 proven by every db-suite boot + the restore drill's clean chain apply. Security checklist: [MVP_SECURITY_REVIEW.md](../security/MVP_SECURITY_REVIEW.md) — 0 prod criticals, findings triaged, zero open blockers (pen-test PHASE-024 per §Scope split). Performance smoke vs NFR-006: T-01 33 ms p95 @100k docs / T-02 10 ms / T-04 14 ms compute / T-06 156 ms AR + 160 ms EN / T-07 0.000% 5xx (local harness; hosted k6 staged). Docs freeze: IMPLEMENTATION_STATUS (001–014 COMPLETE), CHANGELOG, handoff set updated; docs validation green. Restore rehearsal: PASSED (runbook §8 drill record, 2026-11-01). | [PHASE-014-COMPLETION.md](../implementation/phases/reports/PHASE-014-COMPLETION.md) |
| **v1.1.0 (GA)** — CalVer `v1.26.11.0` per §Branching & versioning | 2026-11-06 | GA (PHASE-023…025) | CI-equivalent local gate (the PHASE-025 serial gate, all steps): **typecheck 8/8 · lint 8/8 · depcruise 0 violations/2209 modules · DB suite 143 files/2035 tests (ga-full-load 13/13: T-01 8ms · T-02 23ms · T-04 1ms/1576ms · T-05 122ms · T-06 183/177ms · T-07 0.000% · T-08 111.3 posts/s; ga-spike 1/1: 429@1001 + A/B isolation + window recovery; report-hammer 1/1; soak-shaped 1/1: retained-heap ratio 0.996) · unit api 32/334 · web 5/73 · desktop 16/274 · mobile 27/393 · docs:validate 29/29 · permissions-drift 244=244 · check:rls in-suite green · capabilities-matrix agree · i18n 3399=3399 · check:deps 0 violations · check:observability 19 alerts/11 dashboards/35 metrics GREEN** Migration rehearsal: **no new migrations this phase** (tuning only, PHASE-025 §4); the 0001–0036 chain fresh-applies on every db-suite boot + both restore drills (§4 quarterly + §7 cross-region-shaped) — **§4 quarterly: 0.2s dump/1.3s restore (RTO 4h GREEN), a–f green, parity 5/5; §7 cross-region-shaped: 2.3s chain bootstrap + 1.1s restore (RTO 8h GREEN, restore leg), a–f + boss-exclusion green, parity 5/5, wall 7.0s — both PASSED 2026-11-06 (runbook §8 rows)**. Security checklist: [security-findings.md](../operations/security-findings.md) re-read at the gate — **0 Critical open**; 3 High open with rationale + 30-day SLA clocks (build-time-only/unreachable/residual); regression tests per fixed finding in the suite (gate re-run green: DB suite 143/2035 incl. isolation/attack specs); external pen-test firm leg the standing infra-gated waiver, internal §11 re-verification green; scoped GA re-test = the full suite incl. isolation/attack specs on the release SHA: **143 files/2035 tests ALL PASS 2026-11-06**. Performance: the GA load specs at the documented 10× mix (1,175 concurrent users, 1.1M docs, RLS on) — **T-01 p95 8ms (p50 6/p99 8) @100k · T-02 23ms (5/30) · T-04 interactive 1ms cached, compute tb 343ms; statements 1576ms (922/1576) · T-05 122ms (46/119) · T-06 183ms AR/177ms EN · T-07 0/305 · T-08 111.3 posts/s; DB baselines: pool 40% (8/20, 0 waiters), EXPLAIN 10/10 RLS-predicate-present index-driven, slow-queries interactive 0/62, queue drain-stable (failed-delta 0), cross-tenant locks: concurrent 86ms vs sequential 664ms (overlap proven); spike: 429-before-collapse at ceiling 1000/10s + A/B isolation + ≤15s recovery; hammer: small tenant 14/15ms under concurrent large-tenant TB storm; soak: retained-heap 0.996 ratio, 0 5xx** (local harness tier — embedded PostgreSQL 16; the hosted production-class re-run carries the gate); production-class hosted k6 + 12 h staging soak remain the infra-gated legs (standing waiver; PERFORMANCE_TEST_PLAN §8 weaker-hardware rule). Docs freeze: IMPLEMENTATION_STATUS (001–025 COMPLETE, GA RELEASE recorded), CHANGELOG GA entry, bilingual release notes ([release-notes/v1.1.0.md](../operations/release-notes/v1.1.0.md)); docs validation green: **29/29** (2026-11-06). Restore rehearsals: quarterly §4 cold drill + §7 cross-region-shaped, both executed 2026-11-06 (runbook §8 rows). **Tags created by the orchestrator at commit time — the repo carries `.git` (unlike the MVP zip handover, these are real repository objects): `release/v1.1.0` + CalVer alias `v1.26.11.0` + `phase/025`.** | [GA-RELEASE-CHECKLIST.md](../implementation/phases/reports/GA-RELEASE-CHECKLIST.md) |

### v1.0.0 notes

- **Hosted-infra gates waived per the standing owner directive (2026-10-28)**: GitHub CI
  green run, compose healthcheck, Testcontainers run, hosted k6, staging-tier restore —
  local-equivalent evidence recorded in the completion report; first-infra-availability
  follow-ups tracked in [NEXT_ACTION.md](../handoff/NEXT_ACTION.md).
- **Tag instruction**: `release/v1.0.0` (+ `v1.26.10.0` CalVer alias) is to be created in
  the delivery repository when the PHASE-014 archive is restored to a git checkout — the
  sandbox handover is zip-based (no `.git`), so the tag cannot be created here; the
  completion report records this instruction as the release record.
- Rollback posture: expand-contract migrations (0001–0021 additive), entitlement-gated
  feature surface, no data rollback paths — per §Rollback above.

### v1.1.0 notes

- **Gate record**: the enumerated close-out of every GA-gate clause with status markers
  (CLOSED / CLOSED-LOCAL-TIER / INFRA-GATED / OPEN) is
  [GA-RELEASE-CHECKLIST.md](../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
  (PHASE-025 §6's 11 acceptance criteria; the honest-marker ledger). The release ships
  only COMPLETE phases with evidence — the PHASE-023/024 INCOMPLETE gated items ship as
  honest UNVERIFIED/NOT_STARTED states (ZATCA stub refuses to submit; payment
  production cutover pending [product/DR-002](../decisions/product/DR-002-payment-provider-selection.md)),
  never as claims.
- **Hosted-infra gates waived per the standing owner directive (2026-10-28 — same
  pattern as v1.0.0)**: production-class hosted k6 full-load, the 12 h staging soak, the
  recovery-region wall time of the cross-region rehearsal, the external pen-test firm,
  and the 30-day nightly restore-smoke cadence (first attestable month 2026-12) —
  local-equivalent evidence in the checklist + drill records; follow-ups tracked in
  [NEXT_ACTION.md](../handoff/NEXT_ACTION.md).
- **Tags are real this time**: `release/v1.1.0`, `v1.26.11.0` (CalVer alias), and
  `phase/025` are created by the orchestrator at commit time on the GA-candidate SHA —
  the repository carries `.git` end-to-end through PHASE-025 (the MVP release could only
  record the tag *instruction*; this release records the tags).
- **Post-GA pointers**: every open item has an owning decision-record slot
  ([decisions/](../decisions/README.md) — DR-P25-01…07, filed 2026-11-06): bug bounty,
  support SLA (OQ-008), personal-account payments (OQ-007), ETA/UAE follow-ups, iOS,
  the OTel exporter swap (SF-024-021), and the per-tenant report-run quota
  (MULTI_TENANCY §5).
- Rollback posture unchanged: expand-contract only, staged client channels with
  crash-rate gates + `minVersion` force-update (ADR-0014/0013 channels), forward-fix
  preferred, restore-from-backup last resort per [INCIDENT_RESPONSE.md](../security/INCIDENT_RESPONSE.md).
