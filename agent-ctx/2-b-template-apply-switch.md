# Task 2-b · PHASE-015 T5/T6/T7 — template apply service, additive-only switching (BR-038), closure/degradation (BR-040)

Task ID: **2-b**. Agent: configuration-apply-switch. Status: **DONE** (all verification green).

## Session note

A previous (interrupted) run of this same task had already written every
deliverable file but never verified. This session **reviewed the full surface
against PHASE-015.md §2/§6 + industries/README §4/§5/§7/§8**, fixed 4 real
defects found by the db specs (see "Fixes this session"), and drove
typecheck / lint / unit / db verification green.

## Files shipped (all under `apps/api/src/modules/configuration/` unless noted)

| File | Content |
|---|---|
| `application/apply/activity-mapping.ts` | Bilingual activity→template catalog (`SUPPORTED_ACTIVITIES`: retail/grocery/restaurant, AR+EN labels + keywords), `resolveTemplateForActivity()` → `{templateKey, confidence: "exact"\|"suggested"} \| null` (null = plain onboarding — never a wrong-industry guess; ≥4-char containment guard for suggestions). |
| `application/apply/prerequisites.ts` | `checkPrerequisites(manifest, activeEntitlementKeys)` → structured `PrerequisiteCheck`: per-capability classification (REQUIRED-missing ⇒ `blocked` + exact key chain + AR/EN plan-upgrade guidance; REQUIRED-phase-gated via `available_from_phase > CURRENT_SHIPPED_PHASE` string-order or `PHASE_GATED_INTAKE_KEYS` ⇒ `phase_gated` "coming with PHASE-0NN" back-office mode; OPTIONAL-missing ⇒ `hidden`; OPTIONAL-phase-gated ⇒ coming-soon), `required_feature_keys` fail-closed backstop, and BR-040 closure over active∪required keys via `closureViolations` (intake keys = satisfied-but-labeled). Typed `TemplatePrerequisitesBlockedError` (chain + guidance + closure violations). |
| `application/apply/applied-state.store.ts` | The apply/switch write legs inside the ambient tenant tx: typed `AppliedOverrides` (report_pins, onboarding_checklist with phase-gated flags, enabled_modules, tenant terminology additions, applied_extensions) + `parseAppliedOverrides` (fail-closed), full-row `findAppliedStateRow()` (archives + conflict_notes included), `upsertAppliedConfig()` (UNIQUE(tenant_id) upsert, caller-computed full jsonb so audit diff and row can never disagree, `touchAppliedAt` flag for extends), `listSeriesDocTypes()`, `registerSeriesRow()` (tenant-level branch-NULL/period-NULL registry rows, append-only `ON CONFLICT DO NOTHING`, `next_value` seeded 1 — see Fixes #1). R7 documented in the header: no shipped pack carries a programmatic numbering mandate today → manifest series stored as-is, R7 enforced at series-use time. |
| `application/apply/apply-service.ts` | `TemplateApplyService.apply(actorId, {templateKey, mode})`: registry load+parse (fail-closed `TemplateNotFoundError` incl. non-ACTIVE), idempotency ladder (same key+version+hash ⇒ `{applied:false, reason:"already-applied"}` zero writes; different template ⇒ typed `TemplateAlreadyAppliedError` redirect to switch; registry behind/equal-version-different-hash ⇒ `TemplateRegistryBehindError`), prerequisites gate, ONE audited ambient-tx UoW: upsert `tenant_industry_config` (hash = `hashManifestJson`, ACTIVE, overrides seeded, archives/conflicts carried over untouched), register numbering series (skip doc types with an existing series — R5), **NO tenant_settings writes** (L1 flows through the engine merge, L5 wins), **NO item/doc mutations** (R3/INV-022), audit `industry.template.applied` with before/after, publish `template.applied`. Pure builders exported: `buildReportPins` (materializes §3 `dashboard:false` default), `buildOnboardingChecklist` (steps classified visible/phase_gated/hidden — POS entries labeled PHASE-016 even when their keys are granted), `compareVersions` (numeric semver). |
| `application/switch/switch-service.ts` | `TemplateSwitchService.preview/switch/extend` + pure `buildSwitchDiff`: R9 preview (added capabilities split included/phaseGated/optionalMissing, archived capabilities R6, renamed labels old→new AR+EN, new/kept numbering series, inventory default changes marked `new-items-only` R3, workflow policy changes with conflict flags, report pin + checklist changes, blocked/missingChain, acknowledgement contract) — NO writes. `switch` (BR-038 R1–R10): blocked ⇒ typed chain (R10); OPTIONAL-missing proceeds degraded; REQUIRED-phase-gated only with `acknowledged:true` (`TemplateSwitchAcknowledgementRequiredError` carrying the diff); archives current terminology+navigation+retired capabilities (append with key+version+timestamp, R2/R6); never deletes anything; conflicts (same unset key set differently) ⇒ most-recently-applied-wins for UNSET keys only + `conflict_notes` records; series append-only; publishes `template.switched` + audits `industry.template.switched` with the FULL diff. `extend`: primary template_key stays, additive merges (pins/checklist/modules union, terminology for keys the primary doesn't set — primary wins otherwise, recorded as conflicts), `overrides.applied_extensions` record, audits `industry.template.extended`. Switching back always succeeds (nothing destroyed). |
| `application/closure/drift-service.ts` | `TemplateDriftService.checkDrift(tenantId)` (ambient tenant scope asserted): semver compare applied vs registry; PATCH/MINOR ⇒ upgrade-OFFER notification (category `templates`, bilingual, actionUrl `TEMPLATES_ADMIN_URL=/settings/templates`, dedupeKey `template.upgrade:<key>:<registryVersion>`), MAJOR ⇒ `critical` severity + migration-note wording; registry-behind surfaced as anomaly; offers recorded via `InboxService.record` (owner preference-gated) — NEVER auto-applied; recorded offers audited `industry.template.upgrade_offered`. Pure `driftKind()`. |
| `presentation/configuration.controller.ts` | `@Controller("api/v1/configuration")`: `GET /effective-config` (session route; tenant-static + L6 overlay + L9 via the engine), `GET /templates` (ACTIVE registry list), `GET /templates/:key` (manifest + capability preview vs caller's entitlements + appliedHere), `GET /templates/activity-map` (?activity= resolution), `POST /templates/:key/apply` (`configuration.templates.apply` + `industry.template_engine`), `POST /templates/:key/preview` + `/switch` + `/extend` (`configuration.templates.apply` + `industry.template_switching`), `POST /templates/drift-check`. Zod bodies (`.strict()`), typed errors through the shared error model. |
| `configuration.module.ts` | Providers registered: `TemplateApplyService`, `TemplateSwitchService`, `TemplateDriftService` (+ exported; imports AuditModule + NotificationsModule). |
| `api/index.ts` | T5/T6/T7 export block appended (services, errors, builders, types, tokens). |
| `apps/api/src/infra/auth/route-permissions.ts` | **Additive**: 5 `ROUTE_PERMISSIONS` rows (`POST /api/v1/configuration/templates/:key/{apply,preview,switch,extend}`, `POST …/templates/drift-check` → `configuration.templates.apply`) + 4 `SESSION_ROUTES` rows (`GET …/effective-config`, `GET …/templates`, `GET …/templates/activity-map`, `GET …/templates/:key`). |
| Unit tests `__tests__/` | `activity-mapping.spec.ts` (4), `template-prerequisites.spec.ts` (12: §4 classification matrix × plans, BR-040 closure edges incl. `pos.sales→sales.invoices`, intake keys satisfied-but-labeled, typed error shape), `template-drift.spec.ts` (3: semver ordering + §8 drift-kind). |
| Db specs `src/__db__/configuration/` | `template-fixtures.ts` (real-flow business-plan tenants via RegistrationService, posting substrate + NS service-invoice golden flow with a **second approver user for BR-034 SoD**, entitlement grant/revoke helpers, tenant-level series + audit-count queries), `template-apply.spec.ts` (6), `template-switch.spec.ts` (8), `degraded-entitlement.spec.ts` (3), `dependency-closure.spec.ts` (3). |

## Apply/switch flow — written vs derived

- **Written (one ambient-tx UoW, audited, idempotent):** exactly ONE
  `tenant_industry_config` row (key/version/hash/status/overrides +
  archived_terminology/navigation/capabilities + conflict_notes) and
  tenant-level `numbering_sequences` registry rows for manifest doc types
  that carry no series yet. Nothing else — no tenant_settings, no items, no
  documents, no journals, no posted numbers.
- **Derived (never stored):** effective config, policies, terminology
  resolution, navigation tree (phase-gated POS items flagged, not hidden),
  inventory defaults for NEW items, L1 defaults — all flow through
  `ResolveEffectiveConfigService` from the applied manifest (L1) at read
  time; L5 explicit rows always win by precedence (proven in the switch
  spec: the pre-switch `sales.cash_autopost=false` row survives a
  retail→grocery→retail round-trip).

## Fixes this session (previous session's defects, found by the db specs)

1. `registerSeriesRow` seeded `next_value = 0` → violated
   `ck_numbering_sequences_next (next_value >= 1)` (migration 0010). Now
   seeds 1; documented why the registry row is acquisition-inert (every
   consumer's `reserve()` passes a non-null periodKey, so no conflict onto
   the NULL/NULL row is possible — no numbering gap, ADR-0006).
2. `postServiceInvoice` approved the invoice **as its creator** →
   `SelfApprovalBlockedError` (BR-034 SoD). Fixture now provisions a second
   tenant user per substrate and approves as the approver (same shape as the
   sales fixtures); email lowercased for `ck_users_email_shape`.
3. Drift-restore SQL in `template-apply.spec.ts` used `$2::jsonb` with one
   parameter ("could not determine data type of parameter $1") → `$1::jsonb`.
4. Spec expectations corrected to the real (correct) behavior: the posted
   invoice's branch-scoped `sales_invoice` acquisition row makes the apply
   SKIP that doc type (R5 skip-existing rule) — kept/post-switch series lists
   updated + strengthened (asserts sales_invoice stays branch-scoped only);
   `acknowledgementPhases` for retail→grocery on business = `["PHASE-017"]`
   (the plan GRANTS pos.* keys, so barcode_pos is included, not gated — §4
   gates on missing keys).

## Golden hashes asserted (equal to `pnpm validate:manifests` / agent 1-a)

```
industry.retail     sha256:ac0a93342ae85cd9b870c96b2bf63cb13e5e815477ebd9d9679f08700080cbba
industry.grocery    sha256:c6ef7c8a82bdc3817e46e9068892e550ea2bbacb1583d0954f5c86704e29525e
industry.restaurant sha256:e187c90342250bf0a99497c27e7cb97ec7ce0b7420f76e1b3d1aab1b6954b127
```

## Verification (all green)

```
pnpm --filter @erp/api typecheck   → exit 0
pnpm --filter @erp/api lint        → exit 0
pnpm --filter @erp/api test        → 256/257 pass — ONLY failure is the KNOWN
                                      permissions-drift.spec.ts (3 industry.* keys
                                      pending docs; seeded by agent 1-b, docs agent's
                                      to reconcile — not this task's)
configuration unit specs           → 5 files / 80 tests pass
targeted db run (embedded PG16, after the concurrent full suite finished
at 01:21 — /tmp/db-suite.log stale, no vitest/postgres processes):
  pnpm vitest run --config vitest.db.config.ts src/__db__/configuration/
  ✓ template-switch.spec.ts (8 tests) 671ms
  ✓ template-apply.spec.ts   (6 tests) 1032ms
  ✓ degraded-entitlement.spec.ts (3 tests) 684ms
  ✓ engine.db.spec.ts        (5 tests) 265ms   (agent 2-a's, still green)
  ✓ dependency-closure.spec.ts (3 tests) 225ms
  Test Files  5 passed (5)   Tests  25 passed (25)   exit 0
```

NOTE on the filter syntax: `pnpm --filter @erp/api test:db -- src/...` passes
an extra `--` through to vitest and the path filter is IGNORED (the whole
78-file suite runs — that is how the first full-suite evidence below was
gathered). Use `pnpm --filter @erp/api exec vitest run --config
vitest.db.config.ts src/__db__/configuration/` for a targeted run.

Db-spec coverage highlights (PHASE-015 §6): golden fixture per template
(hash = known manifest hash; series registry; overrides pins/checklist with
POS steps flagged PHASE-016; navigation POS items phase-gated-not-hidden;
terminology template>glossary; inventory defaults via the engine); idempotent
re-apply (zero writes — appliedAt unchanged, no second audit, no duplicate
series); apply on a tenant with an item + POSTED invoice changes NOTHING
existing (byte-identical snapshot incl. journal lines); drift PATCH-bump ⇒
bilingual offer recorded + deduped + applied row still pins 1.0.0 (never
auto-applied), registry restored verbatim in a finally block; switch safety
(zero data loss, L5 setting survives, numbering append-only incl.
branch-scoped immutability, terminology/navigation/capabilities archived
read-only, conflicts recorded, switch-back succeeds, journal still balanced
DR 100/CR 100); degraded entitlement (OPTIONAL missing ⇒ nav item hidden
cleanly; REQUIRED missing ⇒ typed chain + zero rows written; phase-gated ⇒
"PHASE-016" labels + a real invoice posts AFTER the apply); closure
(`pos.sales→sales.invoices` rejected with the chain + engine fails closed on
the same set; repaired set applies cleanly).

## Cross-agent findings (NOT mine — need owners)

1. **`uq_users_email` collision in a FULL db-suite run** (seen in the first
   unfiltered run): `src/__db__/billing/readonly-sweep.db.spec.ts` and
   `src/__db__/inventory/reorder-inapp.db.spec.ts` (T10's new spec) BOTH
   insert the fixed email `ro-owner@fixture.test` — whichever runs second
   fails. One of the two agents needs a unique email. (In the concurrent
   suite's own log, readonly-sweep was skipped, so it may bite only on full
   runs.)
2. Known/expected, already reported by 1-a/1-b: permissions-drift (3 keys ↔
   AUTHORIZATION_MATRIX docs) and the 2 `item_components` ENTITY_CATALOG
   catalog-drift failures in migrations.db.spec — docs agent's items.
3. `applied-state.store.ts` documents the R7 workaround: no shipped
   jurisdiction pack exposes a programmatic numbering mandate
   (`tax/` has no numbering surface; migration-0013 descriptor jsonb carries
   no numbering key) → manifest series stored as-is with use-time R7
   enforcement noted — a future pack-descriptor mandate key is the intended
   hook.

## Handoff notes

- `tenant_industry_config.status` values this task writes: `ACTIVE` only
  (no CHECK on the column — deliberate per 1-b).
- Extend semantics: the PRIMARY manifest stays L1-resolved; extension
  terminology for keys the primary doesn't set lands in
  `overrides.terminology` (tenant-additions plane) — resolveTerminology
  precedence: tenant addition > template > glossary.
- `CURRENT_SHIPPED_PHASE = "PHASE-015"` in prerequisites.ts is the phase
  gate constant — bump with the roadmap (PHASE-016 flips `pos.*` gates).
- The controller's apply route accepts `acknowledged` for shape parity but
  apply itself never blocks on phase gates (§4 back-office mode applies
  immediately); acknowledgement is a switch/extend-only contract.
