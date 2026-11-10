# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-10 (PHASE-035 COMPLETE — next eligible: PHASE-036)

## The single next action

**PHASE-035 — Activation & Truth Restoration — is COMPLETE (2026-11-10), so the
next eligible phase is PHASE-036 — Extensibility Core — Custom Fields** (the
audit's single most important functional gap, FD-18 — "not a missing feature but
a missing business model" — with its siblings FD-19 form layouts and FD-20
picklists). Read the phase document
[../implementation/phases/PHASE-036.md](../implementation/phases/PHASE-036.md)
(§3: prerequisite PHASE-035 ✓ met; no other Wave-1 phase blocks it; the hard
ordering rule — roadmap §5 — ships it BEFORE PHASE-042+ so every module wave
surfaces custom fields on its new entities by registering them into the
substrate in one line), then execute per [AGENT_START_HERE.md](AGENT_START_HERE.md);
on completion append the report, flip the
[../planning/IMPLEMENTATION_STATUS.md](../planning/IMPLEMENTATION_STATUS.md) row,
and deliver the archive `ERP_PLATFORM_PHASE036.zip` (OA-07). What 036 builds: the
typed custom-field store (`custom_field_definitions` + `custom_field_values`:
TEXT/NUMBER/DATE/BOOLEAN/SELECT/MULTISELECT/REFERENCE with BR-057 type
integrity), the tenant-managed picklist pair, `form_layouts` with role overrides
(BR-059 protects mandatory native fields), and the code-owned entity registry —
a tenant adds, validates, and renders a new field with **zero code changes,
zero migrations, zero deploys** — via migration `0049` (five RLS'd tenant
tables + the `platform.custom_fields` grant to business+enterprise riding its
DATA-ONLY tail), three new permission keys (zero-drift re-pinned), the
`/settings/custom-fields` manager + per-entity form designer + shared
`CustomFieldSurface` screens (the 12-template AR/EN discipline), and ADR-0019.
First-wave entity surfaces: partners, items, sales invoices, purchase orders,
employees, projects. **PHASE-035's handoff note:** the batch/serial screens
shipped at 035 become the first custom-field consumers — their entity lists are
the exemplar fixtures. The wave-1 entry condition **OQ-002 (plan pricing)**
remains an owner decision recorded in SUBSCRIPTION_AND_ENTITLEMENTS.md (CR-39).

The completed lineage for context: GA shipped 2026-11-06 (PHASE-025; release `v1.1.0` /
CalVer `v1.26.11.0`), stages 9–11 (026–034) completed 2026-11-08/09 with the Enterprise
Depth gate, the 2026-11-09 delivery completion shipped the marketing landing + the
thirteenth template, and PHASE-035 (2026-11-10) delivered Blueprint v3.0's entry phase —
the activation surfaces (`/inventory/batches`, `/inventory/serials`,
`/inventory/adjustments`, `reports.consolidated` core nav, the `items.import_export`
grant via migration `0048`), the `tax.e-invoicing-log` contract (registry 85 → 86,
catalog 86/86), DR-035-01/02/03, and the documentation truth sweep (evidence:
[../implementation/phases/reports/PHASE-035-COMPLETION.md](../implementation/phases/reports/PHASE-035-COMPLETION.md);
completion archive `ERP_PLATFORM_PHASE035.zip`). Post-GA governance continues on three
tracks (no vague aspirations — every item has a home):

1. **The v3.0 completeness releases (stages 12–15 — PHASE-035…065)** per
   [../planning/COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md) +
   [../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) — additive releases
   that never alter the MVP/GA/Enterprise-Depth gate criteria (CR-01). **Next eligible
   phase: PHASE-036** (extensibility core — custom fields; prerequisite 035 ✓
   delivered 2026-11-10).
2. **The decision-record queue** (the PHASE-025 T14 stubs + the standing records):
   DR-P25-01 bug bounty · DR-P25-02 support SLA (OQ-008) · DR-P25-03 personal
   payments (OQ-007) · DR-P25-04 ETA/UAE adapter follow-ups · DR-P25-05 iOS ·
   DR-P25-06 the observability exporter swap (SF-024-021 → the live in-process
   substrate's pipeline leg) · DR-P25-07 the report-run quota — plus the standing
   open records GA shipped with: DR-001 (ZATCA option C — the launch segment
   excludes e-invoicing-requiring taxpayers; certification path per the
   verification gate), DR-002 (payment production cutover), DR-003 (Egypt ETA),
   DR-024-02 (OQ-009 legal review — BLOCKED-EXTERNAL, 90-day working assumption).
   (DR-035-01/02/03 are decided and closed — scheduled reports DEFERRED-057,
   customer portal PLANNED-060, platform.payouts DEFERRED-059.)

Why now: the audit's model-killer verdict sits on FD-18 — every competitor it
named (Odoo, NetSuite, Dynamics, SAP B1) lets a customer add a field without a
developer, while today every "add the municipality license number to the
customer card" request costs this platform a code change, a migration, and a
deploy; the hard ordering rule ships the substrate BEFORE the module waves
(042+ consume it in one line), and PHASE-035 hands over the first consumers +
exemplar fixtures (the batch/serial entity lists). The honest ledger GA shipped
with still governs the hosted legs — the named owner-directive follow-ups with
their obligations: **the production-class hosted k6 full-load + the 12 h
staging soak + the recovery-region wall time** (PERFORMANCE_TEST_PLAN §8 —
passing on weaker hardware does not close the hosted gate; re-run before any
production-scale claim is re-quoted), **the external pen-test firm leg** (the
PHASE-024 waiver re-read at the GA checklist), and **the November backup
attestation honestly NOT SIGNED** (first due 2026-12-01 — the first full month
post-GA; the nightly smoke exists as an executable procedure, not 30 calendar
days of scheduled runs).

How (the standing operating rules, now the product's operating system):

1. The maintenance protocols of every governing document own the cadences: test
   plan §14 (new hot queries → the top-10 EXPLAIN list), performance §9
   (historical results never re-quoted without a re-run note), secrets §8
   (rotation drills), chaos §9, compliance matrix §6 (official-source
   monitoring), backup runbook §8 (quarterly cold drills + monthly
   attestations), DR §7 (readiness inventory quarterly).
2. Every new phase intake follows the handoff protocol: read the completion
   report + the consumed-as-is specs first; register intake keys per
   FEATURE_CATALOG §25 BEFORE code (catalog drift: migrations manifest +
   ENTITY_CATALOG + AUTHORIZATION_MATRIX + schema.ts mirror + runtime
   FEATURE_DEPS + check-rls + attack-suite fixtures for every new table).
3. Do not mark a hosted leg green without its hosted evidence (the honest-marker
   discipline: a documented INCOMPLETE beats a fabricated pass — directive
   §1.10–1.11).
4. The staged client channels' crash gates (10/50/100, halt < 98.5%) stay live
   through and after every rollout; error-budget exhaustion pauses feature
   releases (MONITORING §5 — the policy recorded in the GA checklist).
