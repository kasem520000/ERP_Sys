# P24-WEB-A — PHASE-024 T4 web + T8 web (MFA enforcement UX + tenant audit review console)

> Task: **P24-WEB-A** · Repo: `/home/z/phase017_work` (pnpm turborepo) · Scope: `apps/web/**`
> plus the ONE allowed outside file `packages/contracts/src/navigation.ts`.
> Spec: `docs/implementation/phases/PHASE-024.md` §T4 (web leg) + §T8 (web leg);
> master plan `agent-ctx/PHASE-024-MASTER-PLAN.md` §2/§3.

## What shipped

### A. MFA policy enforcement UX (T4 web leg)

1. **BFF bootstrap route** — `apps/web/app/api/bff/identity/mfa/bootstrap/route.ts`
   (NEW). POST `{email, password}` → API `POST /api/v1/identity/mfa/bootstrap`.
   On 200 + envelope + token: `applySessionCookies(response, data.token)` +
   `strippedDataResponse(data)` — EXACTLY the `app/api/bff/session/route.ts`
   POST contract (raw token never reaches the browser). 401/409/429 envelopes
   pass through via `errorPassthrough`. Public/CSRF-exempt like session login
   (credential exchange, not a session-bearing mutation).
2. **Login form** — `apps/web/components/login-form.tsx` (MODIFIED): 423
   `MFA_REQUIRED` with `details.enrollmentRequired === true` (narrowed via
   `isRecord`) → re-POST the same credentials to
   `/api/bff/identity/mfa/bootstrap`; on success `router.push("/{locale}/mfa?enforced=1")`
   + `router.refresh()`; 409 `MFA_BOOTSTRAP_NOT_ELIGIBLE` → new localized
   `loginErrorMfaBootstrapIneligible`; other bootstrap failures reuse
   `localizedLoginError`. The plain code-challenge path (`showMfa`) is
   UNTOUCHED.
3. **MFA page + panel** — `apps/web/app/[locale]/mfa/page.tsx` (MODIFIED:
   reads `searchParams.enforced === "1"`, passes down),
   `apps/web/components/mfa-panel.tsx` (MODIFIED: optional `enforced` prop →
   prominent warning banner `mfaEnforcedNotice` — warning tokens,
   `role="note"`, the support-opt-in/readOnlyBanner house pattern).
4. **Settings → MFA policy card** — `apps/web/components/mfa-policy-card.tsx`
   (NEW) + `apps/web/app/[locale]/settings/page.tsx` (MODIFIED: parallel
   `fetchApi<RolesData>("identity/roles")`; card renders in the
   `settings.ok` branch). Mode Select (plan/custom) + custom-mode roles
   Checkbox list (tenant roles from `GET identity/roles`, localized names +
   `dir="ltr"` mono keys, `max-h-96 overflow-y-auto` fieldset, 20-role cap
   client-enforced with localized max error, selected-count
   `aria-live` line). ONE save button per PUT
   (`PUT /api/bff/tenancy/settings/identity.mfa.policy { value: { mode,
   required_roles } }` — both keys always sent; the zod schema requires
   `required_roles`) + a second save button under the roles list (same
   single PUT). Feedback: inline saving/✓saved/error (the TenantSettingsForm
   pattern) PLUS toast success/danger via `useToast` (mounted by the
   `@erp/ui` AppShell — the export-card pattern). Roles fetch failure
   degrades to `roles: null` → unavailable note + stored keys still shown
   checkable (nothing silently disappears); stored keys missing from the
   live list render as labeled ghost checkboxes.

### B. Tenant-admin audit review console (T8 web leg)

5. **`apps/web/app/[locale]/audit/page.tsx`** (NEW, server component — the
   platform/audit structure, tenant plane): URL-encoded filters
   (action/actorId/entityType/entityId/correlationId/fromAt/toAt/limit),
   `fetchApi("audit/events?…")`, 401 → login redirect, 403 → the localized
   `errorsForbidden` ErrorState (the settings/support-sessions pattern),
   other errors → localizedApiError + RetryButton. Result count
   (`aria-live`) + "Export CSV" `LinkButton` anchor to
   `/api/bff/audit/events/export?…` (SAME query params; same-origin anchor
   carries the session cookie).
6. **`apps/web/components/audit-review-filter-form.tsx`** (NEW,
   audit-filter-form pattern): 5 text Inputs (`mono bidiIsolate`), 2 raw
   `<input type="datetime-local">` (the house Input type union has no
   datetime-local — the treasury-bank-rec file-input precedent; house
   control classes + `dir="ltr"`), limit Select (50/100/200/500, default
   200; `AUDIT_LIMIT_OPTIONS`/`AUDIT_DEFAULT_LIMIT` exported for the page's
   param parsing). datetime-local → API `z.string().datetime()` conversion:
   `YYYY-MM-DDTHH:mm` → `+":00Z"`, 19-char → `+"Z"` (UTC interpretation,
   labels say "(UTC)"); ISO → local round-trips via `slice(0,16)`.
7. **`apps/web/components/audit-review-table.tsx`** (NEW,
   platform-audit-table pattern): DataTable columns at/action/entityType/
   entityId/actorId/correlationId; mono columns; ids rendered in
   `<span dir="ltr">`; null actorId/correlationId → "—"; `at` via
   `formatDateTime`. The house DataTable ships its own
   `max-h-[70vh] overflow-auto` scroll container (see deviations).
8. **BFF CSV download route** — `apps/web/app/api/bff/audit/events/export/route.ts`
   (NEW): the generic `/api/bff/[...path]` proxy is JSON-only — it runs
   `parseJsonOrUndefined(await upstream.text())` on EVERY body, so a
   `text/csv` attachment would be mangled into a 200 INTERNAL error
   envelope (verified by reading the route). The dedicated route requires
   the session cookie (401 otherwise), re-broadcasts ONLY the 8 known
   filter keys (never the raw search string), forwards `x-session-token` +
   `x-request-id` + `x-forwarded-for`, and on 200 passes the body through
   with the upstream `Content-Type` + `Content-Disposition`; non-200 passes
   the JSON error envelope + status + Retry-After through.
9. **NAV_ITEMS** — `packages/contracts/src/navigation.ts` (MODIFIED, the one
   allowed outside-apps/web file): `settings.audit` entry — parentGroup
   `settings`, order 75 (between settings.support=70 and platform.*=80+),
   route `/audit`, permission `audit.view`, PERMISSION-gated only (no
   featureKey — the settings.support/platform.audit declaration rule), icon
   `file-text`, archetype `list-search`. Bilingual label
   `{ar: "سجل التدقيق", en: "Audit review"}`.
10. **App-shell fallback crumb** — `apps/web/components/app-shell.tsx`
    (MODIFIED): `audit: { group: "navSettings", label: "auditReviewTitle" }`
    (registry-driven when navigation resolves; fallback covers nav-fetch
    failure — the support-sessions rule).

### C. Shared

11. **`apps/web/lib/api-types.ts`** (MODIFIED): `MfaBootstrapResult`
    (token/sessionId/expiresAt/mfaEnrollmentRequired:true/user),
    `MfaPolicyValue` (`{mode: "plan"|"custom", required_roles: string[]}`),
    `TenantAuditEvent` (id/action/entityType/entityId/actorId:string|null/
    correlationId:string|null/at).
12. **i18n** — `apps/web/i18n/dictionaries.ts`: **+37 keys** in the
    `Dictionary` interface AND both `ar` and `en` objects (1 login, 1 MFA
    notice, 14 mfaPolicy*, 21 audit*). Counts **3284 → 3321 per locale**,
    parity gate green.

## Verification (run on the final tree)

- `pnpm run check:i18n-parity` → `ar=3321 keys, en=3321 keys` · "100% key
  parity; no empty values" (before: 3284=3284).
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json` → clean (exit 0).
- `cd packages/contracts && pnpm exec tsc --noEmit` → clean (navigation.ts edit).
- `cd apps/web && pnpm exec eslint .` → clean; contracts `eslint src/navigation.ts` → clean.
- `cd apps/web && pnpm exec vitest run` → 73/73. `cd packages/contracts && pnpm exec vitest run` → 50/50.
- `pnpm run check:permissions-drift` → OK 244=244 (`audit.view` pre-existing in the catalog).
- `grep -rn "Math\." apps/web/components apps/web/app | grep -v node_modules`
  over MY new/modified files → empty (ADR-0009).
- Did NOT run `pnpm test:db` (forbidden — shared embedded PostgreSQL).

## Pattern deviations (deliberate, with reasons)

1. **DataTable instead of a `max-h-96 overflow-y-auto` wrapper div** for the
   audit table: the house `DataTable` (the exact platform-audit-table
   pattern this task says to mirror) ships its own internal
   `max-h-[70vh] overflow-auto` scroll region with a sticky header;
   wrapping it in another max-h container would nest scrollbars / clip the
   sticky header. The long-list rule is satisfied by the component itself.
   The MFA-policy roles list DOES use the literal `max-h-96 overflow-y-auto`.
2. **Raw `<input type="datetime-local">`** instead of the house `Input`:
   `InputProps.type` union is `"text" | "password" | "email" | "tel" | "url"`
   (packages/ui frozen); the repo precedent for unsupported types is a raw
   input with house classes (treasury-bank-rec `type="file"`). House control
   classes + `h-[var(--erp-density-control-height)]` keep row alignment.
3. **Dedicated BFF export route instead of the generic proxy**: verified the
   generic proxy mangles non-JSON bodies (see A.8) — the task explicitly
   allowed/asked for this ("if the generic proxy mangles downloads, add a
   dedicated BFF route").
4. **MFA policy card = one card, one PUT** (not one PUT per field): the
   setting is a single compound registry key (`identity.mfa.policy`), so the
   atomic compound save follows the `numbering.defaults` precedent.
5. **Inline feedback + toast**: existing settings cards use inline
   per-field feedback only; the task asked for toasts too — the card does
   both (inline = exact existing pattern; toast = export-card pattern; the
   provider is mounted by the `@erp/ui` AppShell).
6. **`limit` is included in the export href** (same query params) — the API
   export endpoint overrides any client limit with its own 10k ceiling, so
   it is a documented no-op there.

## API-shape notes / mismatches found (reported, NOT fixed — API side is done)

- None blocking. Verified against source: `POST /identity/mfa/bootstrap`
  returns `{token, sessionId, expiresAt, mfaEnrollmentRequired: true,
  user}`; login 423 carries `details.enrollmentRequired` (MfaRequiredError);
  409 = `MFA_BOOTSTRAP_NOT_ELIGIBLE`; `GET /audit/events` returns
  `{id, action, entityType, entityId, actorId: string|null,
  correlationId: string|null, at}` (actorId/correlationId ARE nullable on
  the wire — the web type reflects that); export = `text/csv; charset=utf-8`
  + `Content-Disposition: attachment` (10k-row ceiling, `audit.exported`
  self-audit). `GET /tenancy/settings` includes the `identity.mfa.policy`
  default (`{mode: "plan", required_roles: []}`); the PUT schema REQUIRES
  both `mode` and `required_roles` (no default on the array) — the card
  always sends both. `GET /identity/roles` is gated
  `identity.roles.assign` (owner has it per the 0005 seed); failure is
  degraded gracefully in the card.
- Note for the phase report: the `/mfa?enforced=1` page renders under the
  bootstrap session with the shell's documented degrade (navigation /
  entitlements / effective-config fetches answer 423 MFA_ENROLLMENT_REQUIRED
  → "no navigation" shell, writable default, fail-open config) — pages
  enforce their own 401/403 and the MFA endpoints work; that is the
  pre-existing documented behavior, not a defect.

## Files

Created: `apps/web/app/api/bff/identity/mfa/bootstrap/route.ts`,
`apps/web/app/api/bff/audit/events/export/route.ts`,
`apps/web/app/[locale]/audit/page.tsx`,
`apps/web/components/mfa-policy-card.tsx`,
`apps/web/components/audit-review-filter-form.tsx`,
`apps/web/components/audit-review-table.tsx`.

Modified: `apps/web/components/login-form.tsx`,
`apps/web/components/mfa-panel.tsx`, `apps/web/components/app-shell.tsx`,
`apps/web/app/[locale]/mfa/page.tsx`, `apps/web/app/[locale]/settings/page.tsx`,
`apps/web/lib/api-types.ts`, `apps/web/i18n/dictionaries.ts`,
`packages/contracts/src/navigation.ts`.
