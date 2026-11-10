# T11 (WEB UI) — PHASE-034 multi-entity consolidation surfaces — work record

Task ID: T11 · agent: WEB (subagent) · status: COMPLETE (all surfaces + wiring
verified against the live API controller DTOs; bun-transpiler syntax pass
green; dictionary parity type+AR+EN green — no build/typecheck binaries exist
in this extracted tree, per the WRITE-CODE-ONLY brief no build was run)

## What was delivered (all AR+EN bilingual, RTL-ready, dictionary-only labels)

Routes (apps/web/app/[locale]/consolidation/):

1. `page.tsx` — the workspace hub (§2): server-fetches groups + recent runs +
   the fiscal calendar (period labels degrade to raw ids on 403 — the
   reference-list rule); 403 → honest ErrorState; 401 → login redirect.
   Title `consolidationTitle` = القوائم الموحدة / Consolidated statements.
2. `groups/[id]/page.tsx` — the group Settings surface (§8): 404 → notFound;
   server-fetches group + members + the group's eliminations + runs.
3. `eliminations/page.tsx` — the eliminations log (§2 List+Search): deep links
   `?groupId=&status=` land pre-filtered (the API's own filter vocabulary).
4. `eliminations/new/page.tsx` — the Transaction Entry workspace (§4): deep
   link `?groupId=` pre-selects the group.
5. `runs/page.tsx` — the run Report Page (§7): deep links `?groupId=&status=`.

Client components (apps/web/components/):

1. `consolidation-groups.tsx` — group cards (status badge, base currency,
   FX method) + create-group dialog (name/nameAr, ISO3 currency select
   SAR/USD/EUR/AED/GBP/KWD, CLOSING_RATE/TEMPORARY) + recent-runs strip.
   Exports `runStatusLabel` (shared by the runs + group-detail surfaces).
2. `consolidation-group-detail.tsx` — group settings form (PUT groups/:id —
   name/nameAr/FX method; archive/reactivate rides the same PUT's status),
   members table + add-member form (uuid + percent + includeFrom + note) +
   update-member dialog (percent / REMOVED status via PUT members/:uuid),
   archived-group warning banner (role="status"), the group's eliminations +
   runs strips with deep links.
3. `eliminations-table.tsx` — the log: group/status filters reload through
   the BFF; the KIND filter is client-side (the list endpoint carries no kind
   param — honest degrade, never a fabricated server param); ΣDR/ΣCR per row
   (sumExact), approved badge, journals count, reversalOf cross-reference;
   approve/post(confirm)/reverse(note dialog) row actions.
4. `elimination-workspace.tsx` — group + fiscal period + kind picks;
   INTERCOMPANY member A/B uuid inputs with keyboard-fill buttons from the
   group's ACTIVE members + on-demand reader suggestions (endpoint 14, asOf
   DatePicker); lines editor (purposeKey AR_CONTROL/AP_CONTROL ·
   CONSOLIDATION_ADJUSTMENT, direction, MoneyInput, member A/B); the LIVE
   balanced DR/CR preview (string-safe sumExact + compareExact, red/green
   BalancedChip — the sales-ar SubledgerTieChip pattern); submit → DRAFT; the
   created row carries approve (SoD hint shown) → post (confirm dialog) →
   reverse (POSTED only → NEW DRAFT counter-entry).
5. `consolidation-runs.tsx` — create-run form (group + period), runs register
   with QUEUED/RUNNING/COMPLETED/FAILED badges (+ errorCode) and the
   synchronous execute action; the COMPLETED snapshot viewer: members table
   (ownershipPercent + dated appliedRates chips), consolidated lines
   (DR/CR/net with subtractExact), eliminations effects, the INV-026 badge
   (PASS green / FAIL red + the compared values), the group-view disclaimer
   (قوائم المجموعة — لا تحل محل الدفاتر النظامية / Group view — never
   replaces member statutory books). Opening a non-COMPLETED run's snapshot
   renders the honest pending notice (never a silent blank).

Wiring:

- `components/app-shell.tsx` NAV_FALLBACK — `consolidation`,
  `consolidation/groups`, `consolidation/eliminations`,
  `consolidation/eliminations/new`, `consolidation/runs` (all group
  navReports) placed right after the `reports:` entry with the
  `// -- PHASE-034 (T11): the consolidation surfaces (reports.consolidated …)`
  comment; the dynamic-prefix rule covers `consolidation/groups/:id`.
- `i18n/dictionaries.ts` — full `consolidation*`/`elimination*`/
  `eliminations*`/`navConsolidated` key set in the Dictionary type + BOTH the
  AR and EN objects (~100 keys; AR block ends the file's ar object, EN block
  ends the en object; verified programmatically — every key used by the 10
  surfaces resolves in type+AR+EN).
- `lib/api-types.ts` — ConsolidationGroupRow, GroupMemberRow,
  EliminationLineRow, EliminationRow, IntercompanySuggestionRow
  (snake_case on purpose — the platform-plane reader contract),
  ConsolidationRunRow, ConsolidationRunSnapshotView, ConsolidationSnapshot
  (+ member/extract/elimination/consolidated/inv026 sub-rows) under the
  `// -- PHASE-034 (T11)` banner.

## Contract notes for other agents

- The web sends `memberATenantId/memberBTenantId/line.memberTenantId` as
  JSON `null` for INVESTMENT_EQUITY — the controller DTOs are
  `UUID.nullable().optional()`, verified in
  `apps/api/src/modules/consolidation/presentation/consolidation.controller.ts`.
- Eliminations kind filtering is client-side only: `GET /eliminations`
  accepts groupId/fiscalPeriodId/status (no kind) — do not invent one.
- Fiscal-calendar fetches (fiscal-years + periods) are display-only; their
  403s degrade to raw period ids everywhere (never a blocker).
- Money math is string-safe via `lib/exact-money.ts` (sumExact /
  subtractExact / compareExact — never floats, ADR-0009).

## Deviations from the brief (minor, deliberate)

- The DR/CR preview uses the existing `lib/exact-money.ts` helpers instead
  of a bespoke inline implementation (same string-safe semantics, the
  codebase's sanctioned primitive — no duplicated decimal math).
- The runs snapshot "Open" row action is offered on every row; a
  non-COMPLETED fetch now renders the honest `consolidationSnapshotPending`
  notice (added to type+AR+EN) instead of a silent no-op.
- `reversalOf` renders the source elimination's number (tooltip carries the
  full id) — no elimination detail route exists this phase, so there is no
  destination to link to.
- No route handlers / API code / tests touched, per the brief.
