# PHASE-043 — Task 3-WEB: MRP + MPS screens, item planning tab, navigation & i18n

Agent: 3-WEB (web screens) · Scope: `apps/web` + `packages/contracts` only (no `apps/api`, no migrations, no build).
API layer was already complete (mrp/mps/planning controllers + stores); every wire type here mirrors
`apps/api/src/modules/manufacturing/infrastructure/planning.store.ts` and the items planning projection verbatim.

## Files created

| File | Purpose |
| --- | --- |
| `apps/web/app/[locale]/manufacturing/mrp/page.tsx` | T-13 server page (boms-page skeleton: locale check, `getDictionary`, `requireSessionToken`, parallel `fetchApi` — runs + suggestions + warehouses + items; 401→login, 403→`ErrorState(d.errorsForbidden)`; `AppShell pagePath="manufacturing/mrp"`). |
| `apps/web/components/manufacturing-mrp.tsx` | T-13 client body: run-configuration Card (warehouse Select, bucketSize DAY/WEEK, horizon 1..366, runMode, allowTransfers Checkbox, NET_CHANGE scope via @erp/ui ItemPicker + chip list), run-history DataTable (createdAt/status Badge/mode/bucket/horizon/asOf/stats), run detail card (pinned run params), suggestions board (status+type filter Selects; item/type/qty mono/due/release/status+frozen/converted columns; Accept → `POST …/suggestions/:id/accept`, Dismiss → Dialog with REQUIRED 1..300 reason → `POST …/dismiss`; toasts + refetch after every mutation). |
| `apps/web/app/[locale]/manufacturing/mps/page.tsx` | T-14 server page: warehouses fetch first (default = first active), then parallel entries (`manufacturing/mps/entries?limit=500&warehouseId=…`) + readiness + items + uoms. |
| `apps/web/components/manufacturing-mps.tsx` | T-14 client body: warehouse Select + ItemPicker add-row, @erp/ui PeriodGrid over the next 8 Monday-anchored weekly buckets (engine `weekStartIso` convention), per-cell PUT upserts (debounced 600ms), per-row FIRMED toggle (re-PUTs non-empty buckets with flipped status), data-readiness Card (scopeSize + itemsWithoutLeadTime). |
| `apps/web/components/item-planning.tsx` | T-14 part 2: the item-card planning tab — loads `manufacturing/planning/policies/:itemId` + `lot-sizing-rules` on mount, full policy form (lead time, safety stock policy/qty/service level/lookback, lot-sizing with catalog labels + code fallback, fixed qty/order multiple/period buckets, frozen + slushy fences), PUT saves with client-side range validation, INVALID_VALUE/domain-invalid-value + ATP_INPUT_INVALID → toast + inline notice. |

## Files modified

| File | Change |
| --- | --- |
| `apps/web/lib/api-types.ts` | +PHASE-043 wire types: `MrpRunRow`, `MrpSuggestionRow`, `MrpRunResult`, `MrpRunDetail`, `MpsEntryRow`, `MpsReadinessResult`, `ItemPlanningPolicyRow`, `LotSizingRuleRow` (exact API mirrors; stats/netting ride as `Record<string, unknown>`). |
| `apps/web/i18n/dictionaries.ts` | +95 keys × 3 places (interface, `ar`, `en`) under the PHASE-042 mfg tail: all required keys from the task + support keys (run-status badges RUNNING/COMPLETED/FAILED, empty states, toasts, scope hints, MPS grid labels, planning load states). AR follows the existing mfg tone; EN concise. |
| `apps/web/lib/messages.ts` | `localizedManufacturingError`: +17 cases — MRP_RUN_INPUT_INVALID, MRP_SUGGESTION_STATE_INVALID, MRP_DISMISS_REASON_REQUIRED, MRP_CONVERSION_CONFLICT, MRP_CONVERSION_PREREQUISITE, MPS_ENTRY_INVALID, MPS_FROZEN_FENCE_EDIT, MPS_FROZEN_REASON_REQUIRED, BOM_ALLOCATION_INVALID, BOM_SUBSTITUTION_INVALID, BOM_OUTPUT_INVALID, BOR_INVALID, ATP_INPUT_INVALID, TOLLING_STATE_INVALID, TOLLING_INPUT_INVALID, MTO_LINK_INVALID, RESERVATION_POLICY_INVALID. |
| `packages/contracts/src/navigation.ts` | +2 NAV_ITEMS rows after `manufacturing.standard_costs` (order 60/70): `manufacturing.mrp` (icon `calendar-clock`) and `manufacturing.mps` (icon `calendar-check`), both featureKey+permission = `manufacturing.mrp|mps`, archetype `list-search`, branchScoped false. |
| `apps/web/components/app-shell.tsx` | +2 FALLBACK_CRUMBS: `manufacturing/mrp` → mfgMrpTitle, `manufacturing/mps` → mfgMpsTitle (group `manufacturingNavSection`). |
| `apps/web/app/[locale]/inventory/items/[id]/page.tsx` | Wrapped the existing two-column grid + barcodes + archive + attachments in `@erp/ui` Tabs (data-slot pattern from manufacturing-orders): `general` (existing content verbatim) + `planning` (the new `<ItemPlanning>`). |

## Gate outputs (all green)

1. `apps/web` typecheck: `pnpm exec tsc --noEmit -p tsconfig.json` → **clean (0 errors)**.
2. `pnpm check:i18n-parity` → **ar=5767 keys, en=5767 keys, 100% parity, no empty values** (95 new keys this task).
3. `apps/web` eslint: `pnpm exec eslint app components lib --ext .ts,.tsx` → **0 errors / 0 warnings**.
4. `packages/contracts`: tsc clean, eslint clean, vitest 56/56 pass (industry-manifests + contracts tests unaffected).
5. Extras run defensively: `check:capabilities-matrix` PASS, `validate:manifests` 13/13 OK, web vitest (`__tests__` + `lib`) 73/73 pass.
6. Archetype discipline: one archetype per screen — `/manufacturing/mrp` and `/manufacturing/mps` are both `list-search`; the item detail stays `generic-detail` (the planning tab rides the manufacturing-orders Tabs precedent).

## Deviations from the task letter (all intentional, documented)

1. **Icons**: `brain` is not in `@erp/ui`'s ICON_REGISTRY → MRP uses `calendar-clock` (the task's first fallback) and MPS uses `calendar-check` (both valid registry names; `calendar-clock` was already used by notes/calendar, repeats are allowed).
2. **MPS cell-write status**: cell PUTs carry the row's *effective* status (PLANNED by default, FIRMED when the row is firmed) rather than a hard-coded `"PLANNED"` — a hard-coded value would silently un-firm a FIRMED row on every qty edit. The Firm toggle PUTs the flipped status for the row's non-empty buckets.
3. **MPS cell debounce**: PeriodGrid's `onCellChange` fires per keystroke; PUTs are debounced 600ms per cell (one upsert per settled cell — partial input like `"1."` waits). Emptying a cell settles as the explicit zero `"0"` (the API keeps the row; mps_entries has no DELETE by design).
4. **InvalidValueError code**: the domain error's wire code is `domain/invalid-value` (domain-core errors.ts), not `INVALID_VALUE` — `item-planning.tsx` handles both spellings and surfaces the API's message verbatim (fallback `errorsValidation`).
5. **Run "detail" row action**: selecting a run pins the suggestions board to that run (server refetch `?runId=`) and renders the run's stored params/stats card from the history row itself (the list row already carries params + stats — no extra GET needed).
6. **Key count**: 95 keys instead of ~70 — the required list plus run-status badges, empty states, mutation toasts, scope hints, MPS grid labels and planning load states (no collisions; checked with grep first).

## Notes for the next agent

- The frozen-fence override permission `manufacturing.mps.frozen_edit` is DATA-DEPENDENT (resolved per request by MpsService) — the grid surfaces `MPS_FROZEN_FENCE_EDIT` / `MPS_FROZEN_REASON_REQUIRED` through `localizedManufacturingError` and refetches the truth on failure.
- `manufacturing-mrp.tsx` reuses the generic-value keys `d.budgetCreatedAt` (created-at column header), `d.stockFilterWarehouse` (warehouse label), `d.mfgBomItem` (item label) and `d.mfgOrdersAllStatuses` (all-statuses filter option) — the established cross-screen key-reuse precedent (work-centers uses `accountingColStatus` the same way).
- The ⌘K / command-menu registration for the two new screens rides the NAV_ITEMS registry rows automatically (the shell + command menu consume ResolvedNavigation; no hard-coded listeners were added).
