# Task 3-a · PHASE-015 T11 — web UI: onboarding industry step, admin "Industry & templates", template nav + terminology, policy defaults

Task ID: **3-a**. Agent: web-industry-ui. Scope: `apps/web/**` ONLY (verified —
`git status` shows my changes touch nothing else; the concurrent api/db/docs
changes in the tree belong to the other agents). Status: **DONE** — typecheck,
lint, i18n parity, web build all green.

## Files created / modified

| File | Change |
|---|---|
| `apps/web/lib/api-types.ts` | **CHANGED** — one new import (`type IndustryTemplateManifest` from @erp/contracts) + a PHASE-015 T11 block appended: `ConfigLocalizedText`, `IndustryTemplateRow`, `ActivityCatalogRow`, `ActivityMapData`, `PrerequisiteCapabilityState`, `PrerequisiteCheckView`, `IndustryTemplateDetail`, `TemplateApplyOutcome`, the R9 diff types (`CapabilityDiffEntry`, `RenamedLabelEntry`, `NumberingSeriesEntry`, `InventoryDefaultChange`, `WorkflowPolicyChange`, `TemplateSwitchPreview`, `TemplateSwitchResult`), `TemplateDriftResult`, and the effective-config shape (`EffectiveConfigLayers`, `DerivedNavItem`, `DerivedNavGroup`, `EffectiveConfig`). Every type mirrors the configuration controller + apply/switch/drift/resolve services verbatim (read, not assumed). |
| `apps/web/lib/effective-config.ts` | **NEW** (236 lines) — `fetchEffectiveConfig()` (server-side, fail-open), `appliedTemplateOf()` (L1 identity), `mergeNavigation()` (pure): template-derived L9 groups appended AFTER the core groups, terminology resolution `terminology[id] ?? core label` applied to every core + derived group/item label, and `resolveDerivedItem()` mapping each derived target → route (registry nav-item id → its real route; the 3 T10 industry report keys → `/reports?report=<key>` deep link; anything else → the Industry & templates screen with an honest inline label suffix). |
| `apps/web/components/app-shell.tsx` | **CHANGED** — the effective config resolves in the same parallel batch as navigation + entitlements; the merged payload feeds ShellWithSearch; bilingual suffix labels built from BOTH dictionaries (`coming with {phase}` per locale, `not yet in the web app`); +1 FALLBACK_CRUMBS entry (`settings/templates`). Breadcrumbs over merged groups work automatically (registry-item lookup flatMaps all groups). |
| `apps/web/components/onboarding/industry-step.tsx` | **NEW** (495 lines) — the wizard's industry step: activity cards (bilingual, exact confidence by construction) + free-text `?activity=` resolution (exact auto-selects; **suggested requires the registrant's confirmation**; no-match stated honestly), the 3 template cards (bilingual name/description/version + the §4 capability preview chips: included / «قادم مع المرحلة 0NN» / optional / blocked-with-guidance — a blocked card can't be selected), the honest skip-forever ("بدون قالب قطاع — مساحة عمل أساسية"), and the already-applied summary state. NO journey write happens here. |
| `apps/web/components/onboarding-wizard.tsx` | **CHANGED** (971 → 1118 lines) — new FIRST step (see sequence below): `StepId` 1–7, `industrySelection` (in-session only) + `IndustryApplyOutcome` state; `onProvision` now provisions THEN `POST /configuration/templates/:key/apply` (idempotent; typed 422 `configuration/template-prerequisites-blocked` renders the payload's AR/EN guidance + missing chain — never a raw dump; 403 → honest permission line; any failure NEVER blocks onboarding); the result step renders the apply outcome card; the print/terminal numbering shifted; `appliedTemplate` prop (page-resolved) drives the already-applied state. |
| `apps/web/app/[locale]/onboarding/page.tsx` | **CHANGED** — resolves `fetchEffectiveConfig()` in the existing parallel batch and passes `appliedTemplateOf(effective)` into the wizard (fail-open). |
| `apps/web/app/[locale]/settings/templates/page.tsx` | **NEW** (105 lines) — server page: session (permissions → `canApply`), registry list, the per-template details (capability previews resolved against the caller's entitlements server-side), effective config — all in parallel; 401 → login; honest error states otherwise. |
| `apps/web/components/templates-admin.tsx` | **NEW** (988 lines) — the admin client: applied card (key, bilingual name, APPLIED version pin, short manifest hash, registry status, honest applied-at gap note), upgrade-offer section (client-side drift-check POST, holders only: current / upgrade-available with versions + "راجع التغييرات" CTA into the R9 preview / MAJOR flagged critical + migration-note wording / registry-behind anomaly / "never auto-applied" + recorded-in-notifications), registry cards with capability previews and permission-gated actions (Apply when none applied; Preview switch/extend → the what-will-change dialog → Switch/Extend with the REQUIRED-phase-gated acknowledgement checkbox), the full R9 diff dialog (added capabilities split included/phase-gated/optional-missing, archived R6 note, renamed labels AR+EN old→new, new + kept numbering series, inventory defaults with the new-items-only R3 note, workflow policy changes with conflict flags, report pin + onboarding checklist changes, blocked chain), and the read-only policy-defaults table. |
| `apps/web/i18n/dictionaries.ts` | **CHANGED** — +106 keys appended to the END of the `Dictionary` interface, the `ar` literal, and the `en` literal (1723 → 1829 per locale). Arabic authored properly (not machine-literal), EN mirrors. |

## Wizard step sequence — before / after

- **Before (PHASE-014):** 1 fiscal+numbering → 2 provision result → 3 first item → 4 first customer → 5 first invoice → 6 print. Resume: `stepForJourney` mapped `workspace_provisioned→2 … completed→6`.
- **After (PHASE-015 T11):** **1 industry (NEW)** → 2 fiscal+numbering → 3 provision result + industry-apply outcome → 4 item → 5 customer → 6 invoice → 7 print. `stepForJourney` offset accordingly (`workspace_provisioned→3`, `first_item_created→4`, `first_customer_created→5`, `first_invoice_posted/printed/completed→7`; `registered/activity_picked/skipped/null→1`).
- **Provisioning sequence:** provision POST → journey write (`workspace_provisioned`) → **template apply POST** → outcome recorded → step 3. Skip-plain path sets the selection to null and continues (applyOutcome `none`). The industry step is NOT a journey milestone — nothing is written there; the applied template is recorded server-side on `tenant_industry_config` (and a resumed wizard shows the server-truth already-applied state via the effective-config L1, never a fabricated selection).
- Apply failures: 422 blocked → payload guidance + missing chain + "onboarding continues on platform defaults" note + retry hint (Settings → القوالب القطاعية); 403 → permission line; other → localized generic + the same continue/retry notes. `applied:false reason:"already-applied"` → honest "nothing changed".

## Nav merge + terminology + degrade (app shell)

- **Merge:** `mergeNavigation(core, effective)` — core groups first, template-derived `ui.navigation_tree` groups after (the payload's own group `order` is template-internal, not a global interleave position, so after-core is the instructed default; within the template block the payload order is preserved). The merged payload flows into the SAME @erp/ui AppShell (sidebar + mobile drawer + ⌘K command menu all render the template groups; template items become searchable — a bonus the instruction didn't ask for).
- **Terminology:** `terminology[id] ?? core label` applied to every core AND derived group/item label at the merge (presentation-layer resolution; the map carries glossary keys — none of the 3 shipped templates overrides a nav-item id, so current data changes no core label: the mechanism is in place and honest, it just doesn't fire today).
- **Degrade (all three paths verified in code):** no template applied (L1 null) → core payload passes through UNTOUCHED (identical shell to today — this also avoids duplicating the DEFAULT_NAVIGATION mirror); effective-config fetch failure → fail-open, identical core shell; core nav fetch failure → today's no-sidebar behavior stands (the template groups never render alone).
- **Target → route resolution (mechanically verified against all 3 manifests):** registry ids resolve to real routes (`sales.credit_notes→/sales/credit-notes`, `treasury.receipts`, `inventory.transfers`, `inventory.counts→/inventory/counting`, `treasury.shifts`); `inventory.expiry_list` → `/reports?report=inventory.expiry_list` (a real T10 report key; the workspace enforces permission and degrades unpermitted keys to no selection); `pos.counter/pos.floor/pos.kitchen/pos.z_close/items.tiers/inventory.writeoff/inventory.imei` have no web surface in this build → inline honest suffix + link to the Industry & templates screen.
- **Phase-gated items:** the payload marks them `phase_gated` (pos.table_service / pos.kitchen_display intake keys); they render with the badge text INLINE in the label («نقطة البيع · قادم مع المرحلة 016») and a clock icon, linking to the Industry & templates screen — **deviation (documented in code + here): the frozen @erp/ui `NavigationSidebar` renders every item as a plain `<a>` with no disabled/badge variant, so a literal disabled item is impossible in apps/web this phase; the inline badge + honest destination is the closest non-fabricating approximation, and the packages/ui disabled+badged item variant is flagged for the next UI-owning task.** Unentitled items never arrive (server-side prune, R10) — nothing to do client-side.

## Policy-source approach — payload-derived, partially, with the gap reported

The effective-config `policies` map carries MERGED values only (`EffectiveLayers` has no L5/L10 block, no per-key provenance). The task's suggested derivation ("value ≠ platform default && key in tenant settings") is **not honestly executable** from the web: `GET /tenancy/settings` returns the EFFECTIVE snapshot (SETTINGS_REGISTRY defaults merged in — explicit rows are indistinguishable), and the web knows neither the platform defaults nor the POLICY_REGISTRY policyKey→settingsKey mapping (api-internal). So per the fallback rule I badge ONLY what the payloads can PROVE:

- **«قالب الصناعة» (template default, L1):** keys of the applied template's `workflow_policies` that appear VERBATIM in the merged map — provable, because `mergePolicies` writes SETTINGS_REGISTRY keys + `approvals.*` only, so an unmapped policy key (e.g. `shift_variance_approval_required`, `pos.return_requires_original_invoice`) can only have been produced by the template's defaults.
- **«إعدادك» (your explicit setting, L5):** `numbering.<dt>.assign_at` values that CONTRADICT the applied template's `reserve_on_approval` posture for that doc type (approval-without-reserve, or posting-over-reserve) — provably only the tenant's explicit `numbering.defaults` row could produce them.
- **Everything else:** NO badge (—) + one honest note stating the three possible origins. The legend row spells out all three badge meanings.

## Honest gaps found (NOT fabricated around)

1. **`applied_at` is not exposed by any API read route** (controller checked: `/effective-config` L1 carries key/version/terminology count; `/templates/:key` carries appliedVersion/appliedManifestHash/isPrimary but no timestamp). The applied card shows key/name/applied-version/short-hash/status + the note «تاريخ التطبيق غير معروض — لا تكشفه الواجهة البرمجية حاليًا» instead of inventing a date.
2. Per-policy provenance (above) — partial badges only where provable.
3. Applied-row `status` (vs registry status) is likewise not exposed — the card shows the REGISTRY status (ACTIVE) labeled as such.
4. @erp/ui sidebar disabled+badge variant (above).

## Conventions followed

- BFF pattern: server pages via `fetchApi` (cookie forwarding), client via `bffFetch` (CSRF double-submit + idempotency key); no ports/absolute URLs anywhere.
- Permission gating mirrors the existing pattern (sales credit-notes page): the server page resolves `identity/sessions/current` → `canApply = permissions.includes("configuration.templates.apply")`; the registry cards HIDE all actions without it (read-only note), and the drift-check POST (permission-bearing) runs client-side for holders only. Every mutating route re-enforces server-side regardless.
- i18n: every new string in BOTH dictionaries; parity gate green at 1829/1829 (was 1723).
- RTL/logical properties throughout (`ms-`, `me-`, `text-start`); LTR-isolated mono values (`dir="ltr"`); `min-h-11` touch targets on card/step buttons; capability lists capped `max-h-64 overflow-y-auto`; Dialog/crumb fallbacks for the new route.
- Honest UX: no fabricated progress (the industry step writes nothing), phase-gated capabilities labeled «قادم مع المرحلة …», blocked applies show the typed guidance + missing chain, offers never auto-applied (wording on the drift card), already-applied outcomes say "nothing changed".

## Verification (all green)

```
pnpm --filter @erp/web typecheck   → exit 0 (clean)
pnpm --filter @erp/web lint        → exit 0 (clean; one raw-design-value
                                      text-[11px] caught + fixed to text-xs
                                      before the final run)
pnpm check:i18n-parity             → ar=1829 keys, en=1829 keys;
                                      "ar/en catalogs at 100% key parity; no
                                      empty values."
pnpm --filter @erp/web build       → "✓ Compiled successfully in 3.0s",
                                      "✓ Generating static pages using 1
                                      worker (134/134) in 695ms", exit 0
                                      (routes include ƒ /[locale]/settings/
                                      templates; 132→134 = the new screen ×
                                      2 locales)
Bonus (not mandated): pnpm lint:depcruise → "no dependency violations found
(1426 modules, 5452 dependencies cruised)"; pnpm check:ui-catalog → "37
component exports ↔ 60 catalog rows; export↔row parity green" (packages/ui
untouched, so its test suite is unaffected).
```

A throwaway tsx sanity script (created, run, deleted — not committed) verified
the derived-target → route mapping for all 3 shipped manifests against the
NAV_ITEMS registry (output reproduced in the nav-merge section above).

## Notes for the next agent

- The onboarding wizard's industry step intentionally does NOT write
  `activity_picked` (the journey vocabulary has the step, but the task forbids
  fabricating a milestone; the server-side `tenant_industry_config` row is the
  applied-template record, and resume honesty comes from the effective-config).
- `apps/web/lib/effective-config.ts` is server-only (imports server-api); the
  merged-navigation cast is a single documented boundary — a first-class
  @erp/ui nav extension (template groups + disabled/badged items) should
  replace it.
- The settings screens themselves (PHASE-004 typed settings cards) were NOT
  touched: the policy-defaults view lives on the templates screen per the task
  instruction ("no separate route"); surfacing template-default badges next to
  each settings field would need the same per-key provenance the API doesn't
  expose yet (gap #2).
