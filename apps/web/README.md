# @erp/web — PHASE-003 identity UI (BFF)

Next.js 16 App Router client for the PHASE-003 identity module. The web app is
the **BFF** (ADR-0003): the browser never talks to the NestJS API directly and
never sees a session token in a response body — credentials live in one
httpOnly cookie, and every call is proxied server-side.

Styling is **admin-neutral provisional** (plain CSS in `app/globals.css` —
no design system, no component libraries). Arabic-first: default locale `ar`
(RTL), every string in `ar` + `en` via the typed dictionary
(`i18n/dictionaries.ts`, key parity asserted at module load).

## Security model (M-03 contract)

- **`erp_session`** — httpOnly, Secure (prod), SameSite=Lax, Path=/, 12h;
  contains the opaque session token issued by the API.
- **`erp_csrf`** — readable (NOT httpOnly), Secure (prod), SameSite=Lax,
  Path=/; a fresh random 32-byte base64url value on every login/switch.
- Every unsafe browser request (POST/PUT/DELETE) echoes `erp_csrf` in the
  `X-CSRF-Token` header (`lib/client-api.ts`). The BFF compares cookie vs
  header and answers **403 `FORBIDDEN`** on mismatch or absence — only for
  requests that carry a session cookie; public unsafe calls (login,
  password-reset, invitation accept) pass.
- The BFF forwards the session cookie as `X-Session-Token` to
  `${ERP_API_URL}/api/v1/...` (env var, default `http://127.0.0.1:3001`).
  The API plane is CSRF-exempt by construction.
- Idempotency: unsafe proxied calls send the browser's `Idempotency-Key` or a
  generated uuid; the browser wrapper sends one per attempt.
- Token stripping: login / switch-tenant / invitation-accept responses carry
  `data.token` — the BFF moves it into the session cookie and removes it from
  the JSON body before the browser sees it. The generic proxy does the same
  defensively for any token-bearing success payload.
- Logout (DELETE `/api/bff/session`) always clears both cookies, even if the
  upstream revoke fails (a dead session must not trap a signed-in browser).

## BFF route map

| Browser route | API route (`/api/v1` prefix) | Notes |
| --- | --- | --- |
| `POST /api/bff/session` | `POST /identity/sessions` | login; sets both cookies; 423 `MFA_REQUIRED` / 429 `Retry-After` pass through |
| `PUT /api/bff/session` | `POST /identity/sessions/switch-tenant` | CSRF-checked; re-issues both cookies |
| `DELETE /api/bff/session` | `DELETE /identity/sessions/current` | CSRF-checked; clears both cookies |
| `POST /api/bff/session/accept` | `POST /identity/invitations/accept` | public; sets cookies on success |
| `* /api/bff/identity/*` | `* /identity/*` | generic proxy (GET/POST/PUT/DELETE), envelope + status + `Retry-After` as-is |

Generic-proxy consumers: `mfa/totp/enroll`, `mfa/totp/verify`,
`mfa/recovery-codes`, `users`, `invitations` (list/issue/revoke),
`invitations/accept?token=` (public GET view), `roles`,
`roles/clone-template`, `sessions/tenant`, `sessions/{id}/revoke`,
`password-resets`, `password-change`.

## Screens (`app/[locale]/…`)

| Path | Screen |
| --- | --- |
| `/` | redirects to `/ar`; `/{locale}` = dashboard (user, tenant switcher, admin links) or login redirect |
| `/login` | email/password (+ MFA field on 423 or toggle), localized errors by stable code |
| `/forgot-password` | always the same success message (no account enumeration) |
| `/accept-invitation?token=` | public invitation view + name/password form → session |
| `/users` | users + invitations + invite form with role dropdown and in-UI accept link (dev: no mail delivery); 403 → "no permission" |
| `/sessions` | tenant sessions with per-row revoke |
| `/mfa` | TOTP enroll (secret + otpauth text) → verify → recovery codes (show once, regenerate) |
| `/roles` | tenant roles + system templates with clone buttons |
| `/settings/password` | change password (keeps this session, kills others) |

Server pages fetch through the BFF's internal helpers (`lib/server-api.ts`)
— never by self-fetching their own HTTP routes.

## Development

```bash
pnpm --filter @erp/web typecheck
pnpm --filter @erp/web lint
```

`ERP_API_URL` points at the identity API (default `http://127.0.0.1:3001`).
`pnpm dev` runs on port 3000 per `package.json` — note that in the shared
sandbox environment this port may conflict, so the app is verified by
typecheck + lint only here; run it locally where port 3000 is free.
