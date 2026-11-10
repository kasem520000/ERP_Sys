# THE FINAL RESTORATION — PHASE-001…034 United in One Build

> **Status:** COMPLETE · **Date:** 2026-11-09 · **Type:** BREAKING-ARCH (the final-project consolidation)
> **Scope:** the restoration merge of the lost stage-9/10 lineage (028–031) onto the PHASE-034 head,
> producing the FINAL project deliverable — `ERP_PLATFORM_PHASE034.zip` — encompassing every
> implemented phase from PHASE-001 through PHASE-034.

---

## 1. The story (what happened and why this report exists)

The platform's delivery history split into two lineages:

- **The surviving lineage** carried PHASE-001…027, then — after an environment reset cost it the
  stage-9/10 work — shipped PHASE-032 (education), PHASE-033 (agriculture), and PHASE-034
  (consolidation, the roadmap's final phase) as configuration/module work on top of the 027
  surface, recording the lost 028–031 siblings honestly as `NOT_STARTED` in
  [../../../planning/IMPLEMENTATION_STATUS.md](../../../planning/IMPLEMENTATION_STATUS.md).
- **The lost lineage** carried the same PHASE-001…027 history and then delivered the four
  missing siblings: PHASE-028 (Budgeting & Variance Control), PHASE-029 (Payroll: Salaries,
  Loans & End-of-Service), PHASE-030 (Wholesale & Electronics Templates), and PHASE-031
  (Healthcare Commercial Shell) — culminating in its `ERP_PLATFORM_PHASE031.zip` archive.

The user uploaded that archive. Its `.git` directory — once extracted to fast storage —
proved complete: the full commit chain `f007d17` (028) → `9b251a0` (029) → `ca28803` (030) →
`49e6b92` (031) with all trees intact, sharing the exact `502dc47` (PHASE-027) merge base with
the surviving lineage. That made a **true three-way merge** possible:

| Role | Commit | Content |
|------|--------|---------|
| Base | `502dc47` | PHASE-027 (identical in both lineages) |
| Ours | `64ecb41` | PHASE-034 head (032 education + 033 agriculture + 034 consolidation) |
| Theirs | `49e6b92` | PHASE-031 cumulative (028 budgeting + 029 payroll + 030 wholesale/electronics + 031 healthcare) |

The merge introduced the restored lineage's four commits into the repository's history
(branch `restored-031`) and merged them onto the PHASE-034 head — **the 34-phase roadmap is
now COMPLETE in one single build, with the real history preserved.**

## 2. The migration renumbering (the application-order rule)

Both lineages numbered their post-027 migrations `0039…`. The merged sequence keeps the
surviving lineage's files untouched and renumbers the restored five (the journal now carries
**46 entries**; `migrations.ts` manifest and `migrations.spec.ts` expectations updated to match):

| Restored-lineage file | Renumbered to | schema_version | Content |
|---|---|---|---|
| `0039_budgeting.sql` | `0042_budgeting.sql` | 42 | the budgeting schema |
| `0040_payroll.sql` | `0043_payroll.sql` | 43 | the payroll schema |
| `0041_industry_wholesale_electronics.sql` | `0044_industry_wholesale_electronics.sql` | 44 | wholesale + electronics registry seeds |
| `0042_healthcare_claim_ref.sql` | `0045_healthcare_claim_ref.sql` | 45 | `sales_invoices.claim_ref` + partial index |
| `0043_industry_healthcare.sql` | `0046_industry_healthcare.sql` | 46 | the healthcare registry seed (DATA-ONLY) |

The surviving lineage's `0039_education_template.sql` (39), `0040_agriculture_template.sql` (40),
and `0041_consolidation.sql` (41) are unchanged. Every internal `schema_version` stamp and every
code/doc reference to the renumbered files was updated; the only intentionally-preserved
original numbers live inside the historical completion reports and changelog entries of the
restored lineage (verbatim historical records — the mapping above is the normative one).

## 3. The semantic merge decisions

### 3.1 CURRENT_SHIPPED_PHASE: 027 → 034 (the honesty rule, inverted)

The surviving lineage kept the gate at `PHASE-027` because claiming 028–031 would have been
false there. The restoration inverts the situation: **001–034 are all implemented in this
build**, so the honest gate is the roadmap's end. Consequences, all deliberate and tested:

- `apps/api/src/modules/configuration/application/apply/prerequisites.ts` —
  `CURRENT_SHIPPED_PHASE = "PHASE-034"` with the restoration note.
- Agriculture's `crop_cycle_costing` (`available_from_phase` PHASE-033 ≤ 034) no longer
  phase-gates on ungranted plans — it is a plain hard block whose `accounting.projects` key
  joins the starter missing-chain (now 7 keys). The template-prerequisites spec's agriculture
  legs were updated to the new, equally-honest assertions.
- The §4 phase-gate **mechanism** stays proven by synthetic fixtures on a deliberately
  post-roadmap phase horizon (a future phase beyond the finished roadmap — the §18 lesson-5
  pattern, kept green under the gate).

### 3.2 The twelve-template registry

`SHIPPED_TEMPLATE_MANIFESTS` 9 → **12** (the surviving lineage's education + agriculture
united with the restored lineage's wholesale + electronics + healthcare). `validate:manifests`
**12/12** — the restored templates' content hashes carried over byte-identical
(healthcare `sha256:f8b707e6…0947e` matches the restored lineage's own record exactly).
`industry-manifests.test.ts` runs the full reconciliation suite over all twelve (**44/44**).

### 3.3 The 85-contract report registry

The surviving lineage's registry ended at 80 (76 + the four §10 consolidation contracts); the
restored lineage's at 81 (76 + two budgeting + three payroll contracts). The merged registry
carries **85** — the union. `consolidation-contracts.spec` and `report-pack-wiring.spec`
expectations updated; the budgeting/payroll contracts' `budgeting.reports.view` /
`payroll.reports.view` permissions joined the specs' known-permission snapshots (they were
already pre-seeded — see §3.4).

### 3.4 Permissions: 245 = 245, zero drift — both lineages already agreed

The surviving lineage's `0004` seed had pre-seeded the full plan-time permission catalog at
PHASE-034 (including the budgeting and payroll keys for phases it had not implemented), and the
restored lineage's seed carried the same catalog. The pre-merge HEAD and restored-031 seed
unions are **byte-for-byte the same 245-key set** — the merge needed no permission changes at
all, and `check-permissions-drift` passes with zero drift in either direction (matrix 245 =
seed 245, including consolidation ×5, budgeting ×5, payroll ×9).

### 3.5 The capability matrix: 12 columns mapped, EDU/AGR strict

`capability-matrix-reconciliation.spec.ts` (a restored-lineage spec) maps shipped templates to
the CAPABILITY_MATRIX §1 columns. Education and agriculture — whose 2026-11-02 planning-matrix
cells match their shipped manifests exactly — joined the STRICT reconciliation set
(`WHL/ELC/HLT/EDU/AGR`): **zero mismatches, both directions, for all five**. The one remaining
v2.0-only column (RNT rental/logistics) stays honestly unmapped until a shell ships.

### 3.6 Golden effective-configs: 37 rows re-pinned, the cross-lineage proof

The merged SETTINGS_REGISTRY carries the six 028/029 policy keys (budgeting controls ×2,
payroll loans/EOS ×4), which land in every tenant's policy map as platform defaults. All 37
golden rows (12 templates × 3 plans + the no-template row) were recomputed by re-running the
compose pipeline over the merged fixtures:

- **28 surviving-lineage pins moved** — by exactly those six platform policy defaults (the
  same two-notch 028/029 pattern the restored lineage recorded for its own rows, now applied
  honestly to the united set).
- **9 restored-lineage pins carried over byte-identical** — wholesale/electronics/healthcare ×
  3 plans. This is the cross-lineage consistency proof: the merged tree's compose pipeline
  produces byte-identical output to the pre-reset lineage's for those inputs.

### 3.7 The configuration suite

`template-prerequisites.spec.ts` — the union of both lineages' legs (25 surviving + 9 restored)
with the gate-034 updates — runs **34/34**. `golden-effective-configs.spec.ts` runs **41/41**.
The `layer-fixtures` (plan grants) needed no union work: both lineages had transcribed the same
0038 grant block, and the restored lineage had deliberately left the 028/029 grant waves
un-mirrored (the documented fixture role: the template-relevant grant subset).

## 4. The verification record (the sandbox-runnable suites, all green)

| Suite | Result | Notes |
|---|---|---|
| `template-prerequisites.spec.ts` | **34/34** | the united 12-template entitlement + gate suite |
| `golden-effective-configs.spec.ts` | **41/41** | 37 pinned rows + the §5/structure legs |
| `industry-manifests.test.ts` (contracts) | **44/44** | per-file, vitest module isolation |
| `contracts.test.ts` (contracts) | **11/11** | per-file |
| unit specs (`apps/api`, non-`__db__`) | **395 pass / 0 assertion failures** | 42 files; 5 file-load errors are the recorded sandbox-only dependency gaps (argon2 / exceljs / reflect-metadata) — unchanged by this merge, re-run on the live harness |
| `migrations.spec.ts` | **4/4** | 46-entry journal + manifest consistency |
| `check-permissions-drift.ts` | **245 = 245, zero drift** | both lineages' pre-seeded catalogs were already identical |
| `validate-manifests.ts` | **12/12** | ids unique, hashes byte-stable across the merge |
| `docs:validate` | **29/29** | after this report + the changelog wording fix (below) |
| i18n dictionaries | **4,186 = 4,186** | `assertDictionaryParity` PASS (en/ar) |

The `__db__` suites (166 files — including the restored lineage's budgeting/payroll/healthcare
DB governance packs and the surviving lineage's consolidation packs) require the live harness
(postgres + the full pnpm install) exactly as every prior completion report records; they
re-run there.

## 5. Docs sync

- `docs/planning/IMPLEMENTATION_STATUS.md` — the four restored rows (028–031) rebuilt COMPLETE
  with per-row restoration notes and migration renumbering facts; the header current-state line
  now reads PHASE-001..034 ALL COMPLETE; the 032/033/034 rows keep their honest
  "later RESTORED post-034" annotations.
- `docs/handoff/CHANGELOG.md` — the restoration entry (newest-first position) documenting the
  merge, the renumbering table, the pin re-computation, and the gate decision; the restored
  lineage's 028–031 entries carried over verbatim between the 034 and 027 entries.
- `docs/handoff/VALIDATION_REPORT.md` — the "202 total markdown files" statement stays as the
  recorded historical baseline; the merged `docs/` corpus now counts 316 markdown files (the
  restored lineage's docs united).
- This report — referenced by every restoration note.

## 6. The final deliverable

`ERP_PLATFORM_PHASE034.zip` — produced from this merge commit — is **THE final project file**:
the complete git history (001–027 shared, 028–031 restored, 032–034 surviving), the 46-migration
journal, the twelve-template registry, the 85-contract report catalog, the 245-key permission
catalog, and every doc — nothing from PHASE-001 through PHASE-034 is missing.

**NEXT: NONE — the roadmap is complete; the maintenance/ops handoff per
[../../../planning/MASTER_ROADMAP.md](../../../planning/MASTER_ROADMAP.md) §Handoff.**

---

## Update — the delivery completion (2026-11-09, post-audit)

The final-project audit found two gaps in this deliverable, both closed in the
delivery completion (see [../../../handoff/CHANGELOG.md](../../../handoff/CHANGELOG.md)
— the delivery-completion entry):

1. **The marketing landing surface** (FR-PLT-007 / Journey A1 / ADR-0003) — the public
   `/{locale}` root rendered a bare login redirect for anonymous visitors; it now renders
   the marketing site (hero + "ابدأ مجاناً" CTA + the PROJECT_VISION pillars + the LIVE
   template registry + the plans teaser). The pricing page, checkout, billing, register,
   onboarding activity selection, and the platform console were all verified PRESENT
   during the audit — only the landing page was missing.
2. **The RNT column** — §3.5 above recorded "the one remaining v2.0-only column (RNT
   rental/logistics) stays honestly unmapped until a shell ships." The shell has now
   SHIPPED: migration `0047_industry_rental_logistics.sql` (DATA-ONLY, the 0044/0046
   convention) seeds `industry.rental_logistics` v1.0.0 over live granted keys;
   `SHIPPED_TEMPLATE_MANIFESTS` is now **13/13** and the capability-matrix
   reconciliation maps RNT in the STRICT set. The 13-activity INDUSTRY_CATALOG the
   blueprint registers is fully live.
