# Completion Report — PHASE-032

> **Status:** COMPLETE · **Updated:** 2026-11-08

## Phase ID / Date

PHASE-032 — Education Commercial Shell · 2026-11-08

## Summary

The `industry.education` template (ED-08) shipped as a **commercial shell**
through the unmodified PHASE-015 engine — **configuration only**: migration
`0039_education_template.sql` is an additive registry seed (the manifest row
converging the 0008 index row to the full v1.0.0 manifest) with **no new
tables, no new modules, no new feature keys, no new permission keys, and
INV-022 unchanged**. The guardian is the paying AR partner, the student a
partner financial file (never academic data — ED-11), the enrollment year a
`crm.service_contracts` schedule source, tuition invoices ordinary sales
documents with sibling line discounts (BR-002 ceilings), and the tuition
calendar the PHASE-027 installments backbone (BR-048/BR-049, G-05/G-28) — all
riding the twelve installments/notes plan keys migration 0038 already granted
to business + enterprise (the tier-4 precedent; starter stays degraded
back-office by design). The manifest pins the §J-reconciled report pack
(`installments.schedule`, `installments.aging`,
`services.contract_revenue_schedule`, `ar.aging` — the draft's
`partners.ar_aging` planning id pinned to the live `ar.aging` registry key,
the 0025/0027 precedent) and the seven workflow policies (six education-owned
POLICY_REGISTRY keys with **no settingsKey mapping** — the deliberate 0039
choice keeping non-education tenants' policy maps byte-stable — plus
`invoice_approval_required` REUSING the PHASE-019 crm key; templates never
fork policy keys).

**Lineage note (recorded honestly):** PHASE-032 executes on the PHASE-027
lineage after the working environments holding the interim PHASE-028–031
states were lost to sandbox resets. Stage-9/10 siblings share only the GA
gate and pre-GA functional prereqs; education's prereqs (PHASE-015/025/027)
are all satisfied at this HEAD, so the template ships here ahead of the
still-unexecuted 028–031, which remain NOT_STARTED. Consequently
`CURRENT_SHIPPED_PHASE` **stays PHASE-027** — every education capability
gates at ≤ 027 (installment_terms/pdc_notes @ 027 is the highest), and
claiming 028–031 would be false; the gate constant stays the honest
statement of which phases' features are live in THIS build.

## Files created

- `apps/api/migrations/0039_education_template.sql` — the template registry
  seed, generated programmatically from the constant (byte-level parity with
  the 0027 seed-only pattern: first-line `{` directly after the quote, the
  statement-breakpoint discipline); idempotent upsert on `key`, converging
  the 0008 index row to the full v1.0.0 manifest (`is_active = true`,
  `status = 'ACTIVE'`); registered in the drizzle journal (`idx` 39) and the
  `migrations.ts` manifest with the PHASE-032 comment.
- `agent-ctx/P32-T5-golden-pins.md` — the reviewed §10 #2 old→new pin table
  (15 moved + 3 new + 7 byte-stable; the 0038-grant re-pin rationale).
- `docs/implementation/phases/reports/PHASE-032-COMPLETION.md` (this file).

## Files changed

- `packages/contracts/src/industry/templates.ts` — added
  `EDUCATION_TEMPLATE_MANIFEST` (deepFreeze, transcribed VERBATIM from
  docs/industries/templates/manifests/manifest.education.json — the canonical
  source, the §J reconciliation applied); appended to
  `SHIPPED_TEMPLATE_MANIFESTS` (8); header comment documents the
  eighth-template set and the lineage note.
- `packages/contracts/src/industry/index.ts` +
  `packages/contracts/src/index.ts` — exported the constant by name from both
  barrels.
- `apps/api/src/modules/configuration/domain/policy-registry.ts` — the six
  education-owned policy keys (`guardian_is_paying_partner`,
  `tuition_invoice_from_contract`,
  `installment_schedule_immutable_after_activation`, `late_fee_policy_per_plan`,
  `sibling_discount_line_level`, `dunning_cycle_before_late_fee`) with the
  no-settingsKey documentation block (the seventh policy —
  `invoice_approval_required` — reuses the PHASE-019 crm key).
- `apps/api/src/modules/configuration/__tests__/layer-fixtures.ts` —
  transcribed the PHASE-027 **0038 plan grants** (the twelve
  notes/installments keys → business + enterprise) into `BUSINESS_KEYS` with
  the documented rationale (the education REQUIRED/OPTIONAL chains resolve
  through exactly these grants; the 0035/0037 blocks stay untranscribed);
  `SHIPPED_TEMPLATES` grew to 8.
- `apps/api/src/modules/configuration/__tests__/golden-effective-configs.spec.ts`
  — the PHASE-032 review note + the re-pinned GOLDEN map (25 rows) + the
  education structural anchors (navigation targets, terminology, the seven
  policies, L8 `installments`/`crm`, the starter degradation set).
- `apps/api/src/modules/configuration/__tests__/template-prerequisites.spec.ts`
  — the education legs: business (full tuition set INCLUDED on the 0038
  grants), starter (blocked with the exact uncovered chain + bilingual
  guidance), the pdc_notes pair (below), the enterprise closure entry, and
  the CURRENT_SHIPPED_PHASE honesty note (stays 027).
- `apps/api/src/infra/db/migrations.ts` +
  `apps/api/src/infra/db/migrations.spec.ts` + journal — the 0039
  registration (last tag + comment).
- `packages/contracts/src/__tests__/industry-manifests.test.ts` — "all
  seven" → "all eight" (parse + round-trip + the ids pin +=
  `industry.education`), the PHASE-032 pins block (report pins incl. the
  reconciled `ar.aging`; enrollment/billing nav targets; the seven §2
  workflow policies; INV-/RCP-/CN- numbering; required-keys +
  partner.student/guardian terminology; the installment_terms/pdc_notes
  capability posture), and the (r) fixture now tolerates both zod 4.x
  `partialRecord` key-violation shapes (the repo pins 4.6.7
  `unrecognized_keys` at the record path; older 4.x resolves report
  `invalid_key` at the child path — both name the offending
  `service_contract` key, so the §3 rule is asserted, not the zod
  internals).
- `docs/industries/templates/education.md` — status STABLE · Updated
  2026-11-08 (shipped in PHASE-032).
- `docs/industries/templates/manifests/manifest.education.json` — the docs
  mirror regenerated from the constant (JSON deep-equality verified).
- `docs/implementation/phases/PHASE-032.md` — status COMPLETE.
- `docs/planning/IMPLEMENTATION_STATUS.md` — the PHASE-032 row COMPLETE.

## The pdc_notes pair (the BR-040 lesson this phase paid for)

The interrupted first draft asserted "remove `notes.received` → pdc_notes
hides cleanly, check stays ok" — which is **impossible on the transcribed
0038 cluster**: `notes.pdc_calendar`/`endorsement`/`dishonor`/`discounting`
all depend on `notes.received` (FEATURE_DEPS §7), so removing that ONE key
tears the tenant-set closure and the whole check degrades. The shipped pair
asserts both honest postures:

1. **Without the notes family** (a pre-0038 lineage plan): the set stays
   closed (only notes.* keys depend on notes.* keys), so the OPTIONAL
   `pdc_notes` entry degrades HIDDEN on its missing key alone while the
   REQUIRED tuition chain stays INCLUDED — governance #7.
2. **With a torn 0038 grant** (business minus `notes.received` alone): the
   whole cluster **blocks** — `missingChain = ["notes.received"]`, the four
   orphaned dependents named in `closureViolations`, bilingual guidance
   naming the key — a plan is a closed grant cluster, and a torn cluster is
   guided plan selection, NEVER a silently-partial notes surface
   (BR-040 fail-loud).

## Verification evidence

Sandbox runner: `bun test` over the repo's vitest-style specs via a local
`node_modules` shim (vitest→bun:test re-export, inert drizzle/pg/pino/@nestjs
stubs — `node_modules/` is gitignored; no network install exists in this
environment).

- `validate:manifests` — **8/8** OK (education content hash
  `sha256:1334e1744256fb10b773d7e00aa056a34974d4efb9564100629228da3c9c9745`);
  ids unique; versions semver; required_feature_keys non-empty.
- `golden-effective-configs.spec` — **29/29** (25 pinned rows: 7 starter
  byte-stable, 15 re-pinned, 3 new education; §5 shape; per-template
  structure; distinct-pins; reviewed-change-atomicity).
- `template-prerequisites.spec` — **21/21** (education business/starter/pdc
  pair + enterprise closure + the pre-existing industries unchanged).
- `migrations.spec` — **4/4** (manifest ↔ SQL files on disk; journal ↔
  manifest order; schema-state upserts; fail-closed drift signal).
- Configuration suite (`__tests__/`, 5 files) — **104/104** (incl.
  `config-resolution.spec` + `template-drift.spec` regression over the
  changed fixtures, 50/50).
- Contracts package — `industry-manifests.test` **40/40**, `contracts.test`
  **11/11** (run per-file, mirroring vitest's module isolation; the §3
  registry check shares contract-registry state across files in a single
  bun process — an artifact of the sandbox runner, not the repo).
- `docs/industries/templates/manifests/manifest.education.json` — JSON
  deep-equals the constant (mirror regenerated, no drift).
- Education report pins — all four resolve to REGISTERED report contracts
  (`registry/index.ts`: `installmentsScheduleContract` +
  `installmentsAgingContract` @ 027, `services.contract_revenue_schedule`
  @ 019, `arAgingContract`): the report pack wires through the manifest's
  `report_defaults` (apply/switch materialization) with zero
  reporting-module changes, exactly the phase's config-only design.

**Environment-constrained (recorded honestly):** the DB suites (the §6
tuition end-to-end golden, template-apply/switch/degraded-entitlement db
specs against a live tenant) and the reporting unit suite (exceljs-dependent
export tests) require the live harness environment (postgres + the pnpm
install); they are NOT runnable in this sandbox and remain to re-run there —
the phase's unit-level surface above is fully green, and every file the
phase touched is covered by it. No reporting/installments/partners/crm/sales
source file was modified (git status: the 13-file configuration-only set).

## Deviations & decisions (recorded)

1. **`CURRENT_SHIPPED_PHASE` stays PHASE-027** — no gate bump (the honesty
   note; see Summary). The gate mechanism itself is still proven by the
   synthetic PHASE-028 `budgeting.budgets` REQUIRED fixture (§18 lesson 5).
2. **Migration 0039 adds NO plan grants** — the twelve installments/notes
   keys landed with 0038 already; education rides them (the manifest's
   REQUIRED chain resolves on the existing grants; starter excluded by the
   tier-4 posture).
3. **No settingsKey mapping for the six education policy keys** — L1
   defaults land under their raw policy-key names; non-education tenants'
   policy maps (and golden pins) stay byte-stable apart from the L4 grant
   growth (the agent-ctx pin table records the exact 15+3+7 split).
4. **The (r) negative fixture asserts the §3 rule, not zod internals** —
   tolerates both 4.x `partialRecord` violation shapes (repo pins 4.6.7).
5. **Zero new report keys** — the §J reconciliation pins the LIVE
   `ar.aging` registry key (the draft's `partners.ar_aging` planning id),
   exactly the §12 precedent on 0027's professional_services transcription.

## Documentation updates — all done

- `education.md` — STABLE · 2026-11-08 (shipped).
- `manifest.education.json` — regenerated mirror (deep-equal).
- `PHASE-032.md` — COMPLETE.
- `IMPLEMENTATION_STATUS.md` — PHASE-032 row COMPLETE (this report linked).
- `CAPABILITY_MATRIX.md` — the EDU column + `installment_terms` row landed
   with the v2.0 doc sync (pre-existing; citations intact — no edit needed).
- `PHASE_ACCEPTANCE_CRITERIA.md` — the v2.0 PHASE-032 section pre-existing
   (mirrored at plan time; no edit needed).

## Exit criteria

Configuration-only scope shipped and unit-verified per the plan's §5
T1-homologue (manifest + registry seed + policies + entitlement
classification + golden pins); T2–T7 ride the shipped PHASE-015/025/027
surfaces verbatim (config only — no code to write); T8 report-pack wiring is
the manifest's `report_defaults` (verified against the live registry); T9's
governance suite re-runs on the harness environment (recorded above).

## Handoff

Next eligible per EXPANSION_REGISTER §B on this lineage: PHASE-028/029
(stage-9) or the stage-10 siblings (030/031) — NOT_STARTED; the agent
protocol takes the roadmap's next eligible phase. The golden pins are the
drift tripwire for every future change to the fixtures, the manifest, or the
compose pipeline (§10 #2).
