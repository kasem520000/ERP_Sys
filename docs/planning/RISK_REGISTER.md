# Risk Register

> **Status:** STABLE — extended by v3.1 (RISK-026…RISK-028), v3.2 (RISK-029…RISK-030), the post-044 audit waves (RISK-031), and the 043 round-2 audit (RISK-032) · **Owner:** Platform Architecture · **Updated:** 2026-11-15

Living risk register. Likelihood/Impact: L/M/H. Each risk has mitigations (built into
phases) and a trigger (when it becomes an issue to escalate). IDs referenced by phase
documents. **Update protocol:** any phase that materializes a risk must update this file.

## Product & market risks

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-001 | MVP scope too large → delayed revenue | M | H | MVP gate = end of P-014 with hard scope table; scope-discipline rules in roadmap; quarterly scope review | 2+ phases slip > 2 weeks each → product owner |
| RISK-002 | Industry templates feel generic vs. local competitors | M | M | Template manifests include terminology + workflow defaults; design-partner tenants per template (P-015 rollout) | Design-partner churn > 30% |
| RISK-003 | Pricing/entitlement model wrong (OQ-002) | M | M | Entitlement engine decoupled from plan data; plan changes are config | Conversion < target |
| RISK-004 | Offline expectations exceed protocol capacity (real-time-ish multi-user) | L | H | Capabilities matrix communicates limits honestly; POS-scoped offline first | Partner pilot failures in P-020 |

## Regulatory & compliance risks

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-005 | ZATCA requirements misread → non-compliant invoices | M | H | Implementation ONLY against verified official specs (P-023 checklist); certification-path study; no claims before evidence | Any spec mismatch found → block KSA e-invoicing launch segment |
| RISK-006 | Tax rates/rules change mid-development | H | M | Versioned jurisdiction packs + effective dates + snapshots on documents (ADR-0010) | Official-source monitor alerts |
| RISK-007 | Egypt ETA scope creep (e-invoice + e-receipt) | M | M | Evaluation-first adapter in P-023; decision record before implementation | Customer demand |
| RISK-008 | No-VAT jurisdictions assumed wrong (e.g., Kuwait introducing VAT) | M | L | Packs flag applicability; verification task in P-009 + monitoring | Official announcements |

## Technical risks

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-009 | Accounting bugs destroy trust | L | H | Posting engine + invariants suite + golden datasets + reconciliation tests; reversals-only corrections | ANY invariant failure in prod → Sev-1 |
| RISK-010 | Cross-tenant data leak | L | **H** | 3-layer isolation (ADR-0005) + attack suite + RLS denial monitoring (should stay 0) | 1 RLS denial in prod traffic → investigate immediately |
| RISK-011 | Sync double-posting / lost offline sales | M | H | Idempotency keys + inbox dedupe + posting-operation keys (ADR-0007/0012); chaos suite in P-020/016 | Any duplicate journal from sync |
| RISK-012 | Drizzle/young-library friction | M | M | Raw-SQL escape hatch allowed; pinned versions; migration tests on real PG | Blocked feature > 2 days → decision record |
| RISK-013 | Chromium-in-worker operational burden (reports) | M | L | Worker isolation; queue smoothing; render budget timeouts | Worker OOM/crash loop |
| RISK-014 | Performance collapse under real data volumes | M | H | NFR-006 budgets; indexes tenant-first; k6 load tests at P-014 and P-025; query review in code review template | p95 breach in staging load |
| RISK-015 | Hijri/Arabic-numeral UX edge cases | M | M | Bilingual visual snapshot tests both directions; ICU-backed calendars | Recurring locale bugs |
| RISK-016 | Module boundary erosion over time | M | M | CI boundary enforcement (P-001); dependency-cruiser; review checklist | CI bypass attempts |
| RISK-017 | Tauri/WebView2 on old shop PCs | M | M | Min-version checks + updater channel guidance; Electron fallback documented (ADR-0013 revisit) | Install failures in pilot |
| RISK-018 | Backup restores untested | M | H | Restore drills quarterly + in P-025 gate; runbook with second-engineer cold run | Drill failure |

## Organizational / process risks

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-019 | AI agents implement beyond phase / drift from docs | M | H | AGENT_START_HERE protocol; completion reports with evidence; code review checklist; status file audits | Review finds undocumented behavior |
| RISK-020 | Docs drift from implementation | M | H | Docs updates required per phase exit; validation script in CI (links/sections); reconcile step in protocol | Validation script failures |
| RISK-021 | Key-person / agent-context loss | M | M | Everything needed lives in the repo (handoff docs, worklog protocol); no tribal knowledge | Handoff test: new agent completes a phase |
| RISK-022 | Payment provider choice blocks billing (OQ-003) | M | M | Manual invoicing fallback mandatory in P-014; adapter port | Provider rejection/delay |

## Expansion risks (Blueprint v2.0 — stages 9–11)

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-023 | Payroll jurisdiction variance — GOSI/social-insurance/EOS rules REQUIRE_VERIFICATION per country | M | H | Tenant-configured components; **no fabricated rates** (BR-055, DR-005); official-sources protocol governs any jurisdiction rule; EOS accrual per tenant policy table | A country-specific rate is demanded without a verified official source → payroll owner / product |
| RISK-024 | Expansion dilution — stages 9–11 alter MVP/GA gates or pull scope backward | M | H | ED-01: stages 9–11 are additive post-GA releases; scope-discipline rules in [MASTER_ROADMAP.md](MASTER_ROADMAP.md) keep MVP/GA acceptance criteria frozen | Any v2.0 change touching MVP/GA gate criteria → platform architecture |
| RISK-025 | Consolidation complexity — FX translation + elimination correctness | M | H | INV-026 (consolidated = Σ members − eliminations); read-only consolidation runs (ADR-0018); golden G-32; member-period-closed prerequisite (BR-056); eliminations reversible only by counter-entry | Consolidated statements fail to reconcile to member books → block Enterprise Depth release |

## Blueprint v3.1 risks (gap-consolidation wave — CR-41…CR-48)

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-026 | Advanced-IFRS measurement rules misapplied (IAS 36/37/19/29, IFRS 3/5) — wrong impairment, provisions, or combination numbers are worse than none | M | H | REQUIRES_VERIFICATION on every rate/assumption (worksheet mode refuses to post); source-evidenced estimates; disclosure packs never print unsourced numbers; standards-framework tests pinned per phase 066/067 | Any measurement posting lacking a cited source → block the 066/067 release / platform architecture |
| RISK-027 | Program scope growth from the consolidation + residual waves (34 phases, 548 in-scope gaps) overloads the sequential agent protocol and pushes delivery far out | M | H | The honest re-estimate is recorded at every layer (roadmap §1/§3 v3.1→v3.2: ~147–197 total, ~132–183 remaining); wave gates stay binding; parallel-safe sets documented for team execution; every new gap now enters through CR-47's same-commit intake (no more silent scope) | 2+ consecutive phases exceed their estimate by >50% → product owner re-prioritizes wave content |
| RISK-028 | Standard-costing layer (L2-12 in 042) destabilizes inventory valuation — PPV/revaluation postings corrupt WAC-era balances | M | H | Frozen-standard effective dating; revaluation rides the G-13/G-14 shapes with a variance account; dual mode (routing-less orders keep the legacy path) documented; failure packs + golden worked examples mandatory in 042 | Any invariant failure in standard-cost postings → Sev-1 (the RISK-009 class) |

## Blueprint v3.2 risks (the residual layer — CR-49…CR-52)

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-029 | Dual-book (R-02) + intercompany trade (R-07) in 053 corrupt the single-base posting invariants — a book-tagged reconciliation layer or a PO↔SO pair that double-counts breaks both books and the eliminations | M | H | Book tags live ONLY on reconciling adjustment entries (never a parallel ledger copy — one journal substrate, dual filters); dual statements render from the same lines with deterministic book filters; intercompany matching is proposal-first with tolerance rules and never auto-posts; golden worked examples for both books + the clearance statement; invariants suite extended before any 054 Zakat/IFRS consumer lands | Any statement pair (books or entities) failing to reconcile to the same journal substrate → block the 053 release / platform architecture |
| RISK-030 | ECL estimate discipline (R-01 in 066, IFRS 9) — fabricated loss rates are worse than no allowance (the RISK-026 class applied to receivables) | M | H | REQUIRES_VERIFICATION on every matrix rate (tenant-entered with source evidence or the run refuses to post — worksheet mode); matrix versioned with effective dating; the ECL report never prints unsourced rates; movement postings ride the golden-numbered discipline with failure packs | Any ECL posting lacking a cited rate source → block the 066 release / platform architecture |

## Operational risks (the post-044 migration era)

| ID | Risk | L | I | Mitigation | Trigger / owner |
|----|------|---|---|------------|-----------------|
| RISK-031 | The nightly INV-029 probe is trusted as a per-batch/per-serial integrity proof — it is ONLY the aggregate (warehouse, item) fold (Σ tenant-owned `bin_contents` = `item_stock`), so a balanced position can hide disagreeing batches/serials (a batch whose bins hold stock with zero ledger legs against a sibling batch's ledger; a placed serial whose registry says `sold`/`returned` while bins and ledger corroborate the placement). Pre-wave-5 the backfill could even ERASE a visible deficit by writing a provable sibling onto the aggregate (test-proven: the wave-5 owner's case) | M | H | The aggregate check is documented as a NECESSARY condition, never a per-batch/per-serial proof ([WMS_UPGRADE_BACKFILL_RUNBOOK.md](../operations/WMS_UPGRADE_BACKFILL_RUNBOOK.md) §9); the backfill's totals-matching guard (waves 3/4/5) refuses to write whenever a named per-batch/per-serial conflict exists — a visible deficit stays visible; conflicts are named per batch/serial in the report; a per-batch/per-serial recurring detector remains future hardening | Any operator or report presenting a green probe as proof that every batch and serial is correct → operations owner; any post-backfill position whose sources were never examined (green before the first run) → ticket the §5 investigation |
| RISK-032 | The ATP "OK" stamp for UNRESERVED demand is an advisory promise, not a protected one: unreserved sibling demand does not reduce the promiseable basis (atp-service law 4), so two ISSUED, UNRESERVED orders can BOTH stamp OK on stock that exists once, and the second order over-promises (a backorder results). The RESERVATION side of the original exposure is CLOSED (the 043-completion round, 2026-11-14 — the owner's directive): a reservation now PHYSICALLY holds its stock at the movement core's single issue choke point (BR-081 — `planIssue`'s guard: onHand − qty ≥ reservedPool − allowance; the beneficiary delivery carries the only allowance; every other path may consume FREE STOCK ONLY; the only door to reserved stock is the permission-gated, audited release). The POLICY choice for unreserved demand is DOCUMENTED and remains the owner's — an open business decision, not a settled one | M | M | The reservation-side exposure is implemented + tested (BR-081 — reservation-hard-protection.spec, 10 deterministic DB tests: prevention, beneficiary full/partial/surplus/cancel/rollback, the concurrent race, the pg_locks serialization window, the audited unlock; reservation-basis.spec (c) rewritten to the hard truth; the (c, race) dichotomy re-pinned to exactly-one-winner); the ATP advisory standing is explicit at the sales line (`checkLineAtp` answers `PROTECTED_BY_RESERVATION` vs `UNPROTECTED` + the bilingual advisory note — an unallocated OK can never be presented as a guarantee); a stock shortage NEVER blocks issuing a sales order (no ATP gate at issue — the backorder stays a legal outcome, pinned by test); the pre-fix steal + the post-fix block are both on record (the before/after runs in the round's gate evidence) | The platform owner decides the remaining policy for unreserved demand: (a) auto-reserve at order issue when stock allows, (b) a blocking ATP gate at issue, or (c) accept the declared advisory model with the standing surfaced at the point of promise — until decided, any operator treating an UNPROTECTED OK stamp as a guaranteed allocation → platform architecture; the owner LIFTED the PHASE-045-start blocker on 2026-11-14 (the parallel-start directive — 045 runs alongside the 043-completion review; starting 045 is not closure of 043 or production approval) |

## Top-5 watchlist (reviewed at every phase boundary)

1. RISK-010 (tenant isolation) — any anomaly is Sev-1.
2. RISK-009 (accounting correctness) — invariant failures block releases.
3. RISK-005 (ZATCA compliance) — gated on verified specs, no fabrication.
4. RISK-011 (sync double-posting) — chaos-tested before any offline release.
5. RISK-001 (MVP scope) — protects the commercial timeline.
