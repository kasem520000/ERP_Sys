# Risk Register

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28

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

## Top-5 watchlist (reviewed at every phase boundary)

1. RISK-010 (tenant isolation) — any anomaly is Sev-1.
2. RISK-009 (accounting correctness) — invariant failures block releases.
3. RISK-005 (ZATCA compliance) — gated on verified specs, no fabrication.
4. RISK-011 (sync double-posting) — chaos-tested before any offline release.
5. RISK-001 (MVP scope) — protects the commercial timeline.
