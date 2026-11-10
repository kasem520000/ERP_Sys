# P5-T12 — apps/web migration onto @erp/ui (design system, i18n & RTL foundation)

**Task ID:** P5-T12 (PHASE-005)
**Status:** COMPLETE — all app-side gates green; one pre-existing failure inside the frozen `packages/ui` package documented below.
**Scope:** `apps/web` only. `packages/ui` untouched (frozen). BFF routes/logic, `lib/server-api.ts` / `lib/client-api.ts` signatures, API contracts, prisma/db, `apps/api` untouched. No new pages/routes.

## What was done

1. **Server app shell** (`components/app-shell.tsx`, rewritten): async server component that fetches `GET /tenancy/navigation` via `fetchApi<ResolvedNavigation>("tenancy/navigation")` (envelope-unwrapped; failure ⇒ no navigation), renders the `@erp/ui` client `AppShell` with `density="compact"`, `activePath` derived from `pagePath` (tenant-detail pages map to `/platform` so the console item stays highlighted), brand from dictionaries, `userMenu` = locale-switch link + `LogoutButton`, and the required `strings` from new dictionary keys. Keeps the old `AppShell({ locale, pagePath, title, children })` signature. Renders page title (`text-lg` per PAGE_ARCHETYPES) + `Breadcrumbs` (registry labels first; static dictionary fallback for routes outside the shipped registry: onboarding, settings/password, platform tenant detail).
2. **Public shell** (`components/public-shell.tsx`, rewritten): centered card (`border border-subtle rounded-lg bg-surface-card shadow-e3 max-w-lg`) on the token background, slim brand bar + locale switch, no sidebar.
3. **Dictionaries**: +10 keys (AR=EN, parity now 320=320): `shellSkipToContent, shellCommandSearch, shellShortcutsTitle, shellClose, shellMore, statusOffboarded, wizardStepOf, platformBackToConsole, rolesEmpty, retryLabel`. Nav-group labels come from the server payload — NOT duplicated.
4. **lib/messages.ts**: `statusClass()` (dead `badge-*` classes) replaced by `statusTone()` → Badge `primary|neutral`; `localizedStatus()` gained the `OFFBOARDED` case.
5. **All 18 pages + every component** migrated to token classes + catalog components; all provisional classes deleted. Lists → `DataTable` via per-screen client wrappers (columns carry closures, so server pages pass rows only). Statuses → `Badge` (non-document vocabularies). Forms → `Input`/`Select`/`Switch`(settings booleans)/`NumberInput`(trial days)/`DatePicker`(grant expiry)/`Button` with `loading` wired to existing busy flags; one primary per view. Empty → DataTable `empty` (EmptyState); errors → `ErrorState` + `RetryButton` (router.refresh); success/notes → app-side `SuccessNotice`/`ErrorNotice`/`InfoNotice`.
6. **Onboarding wizard** → Wizard archetype: ordered-list stepper (tokens, aria-current="step", sr-only "Step {current} of {total}"), step = fieldset+legend, sticky action rail.

## Archetype per screen

| Screen | Archetype (PAGE_ARCHETYPES) |
| --- | --- |
| `/{locale}` dashboard | 1 Dashboard (KPI-lite: tenant/role card, switcher, screen tiles) |
| users, roles, sessions, branches, support-sessions | 2 List + Search (DataTable; server-side `q` search kept on platform console) |
| platform (console), platform/audit | 2 List + Search (+ URL-state filters; cursor next-page link) |
| platform/tenants/[id] | 2 List + Search sections + 8 Settings-style cards (detail/composite) |
| settings, settings/password, mfa | 8 Settings (section cards, per-field save, Switch for booleans) |
| onboarding | 9 Wizard (stepper + fieldset steps + sticky rail) |
| login, register, forgot-password, accept-invitation | Public auth cards (archetype-3 form inside the public shell) |

## New app-side primitives (composition, not package changes)

`card.tsx`, `notices.tsx`, `def-list.tsx`, `link-button.tsx` (anchor with Button token classes — Button can't take href), `retry-button.tsx`, `client-ui.tsx`, `table-header.ts`, `lib/cx.ts`.

## Verification (exact)

- `pnpm --filter @erp/web typecheck` → **green** (no output).
- `pnpm --filter @erp/web lint` → **green** (erp-ui rules active: no physical-direction / hex / px / deep-import / raw-radix violations).
- `pnpm --filter @erp/web build` → **green**: "✓ Compiled successfully", TypeScript pass, 36/36 pages generated; `/` 307; smoke test of the built server rendered the full AR + EN shells (skip-link, command-search, breadcrumbs, ErrorState+retry with the API down).
- `pnpm check:i18n-parity` → **green**: `ar=320 keys, en=320 keys … 100% key parity; no empty values`.
- Negative meta-tests still prove the gates: `negative-ui-rules-test.sh` + `negative-i18n-parity-test.sh` both pass.
- Root `pnpm lint` → **fails ONLY inside frozen `packages/ui`** (pre-existing, zero diff from this task): `src/components/data-table/data-table.tsx:137` Math.floor without the ADR-0009 disable comment its neighbours carry, and `tests/perf/data-table-perf.spec.ts` raw `530px`/`#eee`/Math.floor (3). `@erp/web`, `@erp/contracts`, `@erp/domain-core`, `@erp/config` all lint clean. Fix belongs to the design-system owner (package frozen this task).

## Workarounds / blocked composition (for the phase report)

1. **`client-ui.tsx` bridge**: the frozen `@erp/ui` barrel mixes pure utils with `createContext` modules (`utils/direction`), so ANY value import of `"@erp/ui"` from a React Server Component fails the Turbopack build. Server pages import client catalog components through a `"use client"` re-export shim; app-side pure primitives use a local `cx()` join instead of `cn`. Permanent fix: split the barrel (client entry vs pure-utils entry) or mark it `"use client"` — next `packages/ui` change window.
2. **DataTable renders only `column.header.en`**: `table-header.ts#activeLocaleHeader()` puts the active-locale label into both bilingual slots so grid headers follow the page locale (Arabic-first). Needs a locale-aware header in the package.
3. **`Input` lacks `maxLength`/`minLength`/native-attr passthrough** (and `type="date"`): length caps dropped from form fields (server still validates); the grant-expiry native date input became `DatePicker`; the timezone `datalist` became a hint (no `list` passthrough).
4. **`Button` has no `title`/`aria-current` passthrough**: tenant-switcher buttons convey state via the status `Badge` + disabled only.
5. **`Badge` tones are neutral/primary only** for non-document statuses (per catalog): ACTIVE/ACCEPTED → primary, everything else → neutral with the localized label as the differentiator.
6. **Server pages await their fetches** (existing data flow kept): no mount-time client fetch window exists, so `LoadingState` is not visible on list screens; empty/error states are fully wired (DataTable empty + ErrorState/retry). Interactive fetches (MFA enroll/verify/recovery, support-session reads) show Button `loading`.
7. **`dir` attribute dropped from Arabic-name inputs** (register/profile/branch): RTL_DESIGN_RULES reserve `dir` for the `[locale]/layout.tsx` `<html>` only; `Input` doesn't accept `dir` anyway.
8. Old shell `phaseNote` footer dropped (the design-system shell owns chrome; key retained unused in dictionaries — keys are append-only).
9. Pre-existing phase debt fixed app-side to make gates green: `tsconfig.json` excludes `**/__ui-violations__/**` (same pattern as `__boundary-violations__`; the negative lint test still lints it via `--no-ignore`), and a 1-line `?? ""` type fix in `tests/security/headers-csp.spec.ts` (`noUncheckedIndexedAccess`).

## Strings not localizable both ways

None — every user-visible string is localized AR+EN (parity gate green). Remaining non-localized text is by design: protocol/data values (ISO codes, feature keys, plan keys, uuids, JSON payloads) rendered `mono`/`bidiIsolate`.
