# P24-SEC-B — PHASE-024 T5 rate-limit hardening (R-04/R-05) + T9 security headers

**Task ID:** P24-SEC-B · **Scope:** SECURITY_TEST_PLAN §5 R-04 + R-05, §8 (T9 headers/CSP)
**Status:** COMPLETE — api tsc clean, web tsc clean, 15 new unit tests green, full plain api suite 295 green, web suite 73 green, depcruise clean, both web builds + runtime smoke verified.

## Files created

| Path | What |
|------|------|
| `apps/api/src/infra/http/tenant-rate-limit.middleware.ts` | R-04 global Nest middleware: `/api/v1/` only, skips `isPublicRoute` rows, resolves tenant via its OWN indexed lookup (`hashToken(x-session-token)` → `findSessionTenantByTokenHash`), consumes `TENANT_LIMITER`, sets `X-RateLimit-Limit/Remaining` on pass, on saturation short-circuits 429 with the error-filter envelope shape (`TENANT_RATE_LIMITED`, `retryable:false`, `traceId: getCorrelationId() ?? ""`) + `Retry-After` (integer-arith ceil). Enforcement split into exported `enforceTenantRateLimit(req,res,next,deps)` pure seam for unit tests. |
| `apps/api/src/infra/http/security-headers.middleware.ts` | T9 API-origin fixed headers: HSTS 2y+includeSubDomains, nosniff, X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin, Permissions-Policy camera/mic/geo `()`, CSP `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`. |
| `apps/api/src/infra/http/security-headers.spec.ts` | Plain unit spec (3 tests): exact header values, applies outside /api/v1, exactly six headers. |
| `apps/api/src/infra/http/tenant-rate-limit.spec.ts` | Plain unit spec (7 tests): pass headers + decrement, 429 envelope + Retry-After exact, ceil/integer Retry-After + window slide, tenant A/B isolation, skip cases (public routes incl. `:token` param, non-API path, anonymous, unknown session, tenantless session), env-tunability (`TENANT_RATE_LIMIT_MAX` read at factory call), default fallback. |
| `apps/api/src/modules/identity/application/recovery-flood.spec.ts` | Plain unit spec (5 tests, `vi.hoisted`+`vi.mock` seam like `reservation-sweep.spec.ts`; store + limiter modules mocked, manual clock): 3/h budget sends, 4th → uniform 200 + email suppressed, unknown email consumes no budget, per-account isolation, 60-min window slide. |
| `apps/web/app/csp-report/route.ts` | T9 staging CSP report capture: POST → parse JSON, one structured console line, module counter, 204; malformed body still 204. **DEVIATION from task path `/__csp-report`: Next.js treats every `app/` folder starting with `_` as PRIVATE (non-routed; cf. `__boundary-violations__` fixtures + `next/dist/build/route-discovery.js` `ignorePartFilter: part => part.startsWith('_')`), so the route lives at `/csp-report` and the `report-uri` matches.** Desktop export build verified unaffected. |

## Files modified

| Path | Change |
|------|--------|
| `apps/api/src/modules/identity/domain/session-policy.ts` | + `PER_ACCOUNT_RESET_WINDOW_MS` (60 min) / `PER_ACCOUNT_RESET_MAX_ATTEMPTS` (3) binding constants (R-05). |
| `apps/api/src/modules/identity/infrastructure/rate-limiter.ts` | + non-throwing `attempt(key): RateLimitDecision {allowed, limit, remaining, retryAfterSeconds}`; `consume()` now throws on `!allowed` (behavior identical). + `resetAccountRateLimiter()`/`RESET_ACCOUNT_LIMITER`. + `TENANT_BURST_WINDOW_MS` 10s, `TENANT_BURST_MAX_DEFAULT` 1000 (class comment: default sized for the suite's sequential traffic, prod tuning = ops decision), `tenantRateLimitMax()` (env read at CONSTRUCTION, unset/empty/garbage → default), `tenantRateLimiter()`, `TENANT_LIMITER`. Removed the pre-existing `Math.max` (file now integer-arithmetic only, house rule). |
| `apps/api/src/modules/identity/infrastructure/identity.store.ts` | + `SessionTenantRef` + `findSessionTenantByTokenHash(tokenHash)` — raw `SELECT active_tenant_id FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL LIMIT 1` via `db().execute` (sessions = global table, no RLS). |
| `apps/api/src/infra/auth/route-permissions.ts` | + `isPublicRoute(method, path)` reusing `PUBLIC_ROUTES` + the existing `pathMatches` (no path re-listing). |
| `apps/api/src/app.module.ts` | Middleware chain now: RequestId → **SecurityHeaders** → Session → **TenantRateLimit**. Security headers BEFORE the 423/429 short-circuits so every response carries them; tenant limiter AFTER the session block (order-independent by its own lookup) with a comment saying why. |
| `apps/api/src/modules/identity/application/recovery-service.ts` | R-05: after user lookup, `RESET_ACCOUNT_LIMITER.attempt("reset-account:" + user.id)`; saturated → warn with `hashToken(user.id)` discriminator, uniform `{accepted:true}` 200, email SKIPPED, no token signed, audit still recorded (request genuinely happened); unsaturated → unchanged flow. |
| `apps/web/middleware.ts` | T9: BFF branch (pathname `/api/bff` or `/api/bff/*`) → fixed headers (nosniff, DENY, Referrer-Policy, CSP `default-src 'none'; frame-ancestors 'none'`), no nonce logic, early `next()`. Document flow untouched + `CSP_REPORT_ONLY=1` adds `Content-Security-Policy-Report-Only: <same csp>; report-uri /csp-report`. Matcher: first pattern unchanged + added `"/api/bff/:path*"`. |
| `apps/web/tests/security/headers-csp.spec.ts` | + 2 probe tests: (a) BFF unauthenticated 4xx (empty-body POST → BFF's own 400, no API needed) asserting the 4 fixed headers; (b) M-03 DOM probe — failed BFF login sets no `erp_session`, then plants the exact `applySessionCookies` pair (httpOnly session / readable csrf, SameSite=Lax) and asserts `document.cookie` lacks `erp_session`+value but contains `erp_csrf=…`. NOT run here (playwright heavy) — extended per task. |
| `.env.example` (root) | Documented `TENANT_RATE_LIMIT_MAX` (small addition beyond the letter of the task — root file exists and is the repo's env doc; `apps/web/.env.example` does NOT exist so `CSP_REPORT_ONLY` doc lives in middleware/route comments per the task's skip clause). |

## Verification (all executed)

- `cd apps/api && pnpm exec tsc --noEmit -p tsconfig.json` → **clean**.
- `pnpm exec vitest run src/infra/http/security-headers.spec.ts src/infra/http/tenant-rate-limit.spec.ts src/modules/identity/application/recovery-flood.spec.ts` → **3 files / 15 tests passed**.
- Full plain api suite `pnpm exec vitest run` (regression for the `consume()` refactor) → **29 files / 295 tests passed**. NO db suite touched.
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json` → **clean**; web vitest suite → **5 files / 73 tests passed**.
- eslint on every touched file (api + web) → clean; `pnpm lint:depcruise` → no violations (2182 modules).
- `pnpm run build:desktop` → success (csp-report route tolerated by static export; stash/restore clean).
- `next build` (normal) → success; runtime smoke on `next start :3210`: document route full §8 set + rotating nonce; BFF 400 with the 4 fixed headers; `/csp-report` 204 + single structured log line + counter; `CSP_REPORT_ONLY=1` → Report-Only header with same CSP + `report-uri /csp-report` (enforced CSP still present). Smoke server stopped after.

## Deviations / judgment calls (report, don't hide)

1. **`/csp-report` vs `/__csp-report`** — Next private-folder rule makes any `_`-prefixed app dir unroutable (evidence in file comment). URL + on-disk route moved to `/csp-report`; `report-uri` matches.
2. **`Number(process.env.TENANT_RATE_LIMIT_MAX ?? "")`** instead of `?? 1000`: empty-string env values (common in compose) must not produce max 0 / NaN (fail-open or breakage); invalid → default 1000. Env is read at factory-call time (testable), singleton created at module load.
3. **`RESET_ACCOUNT_LIMITER.attempt(...)` not `.consume(...)`** — the task text says `consume`, but `consume` throws `RateLimitedError` (→429), which would break the uniform-200/no-oracle requirement. `attempt()` is the new non-throwing seam the task's own fallback ("extract the flood decision…") anticipates.
4. **Suppressed reset still writes the `password.reset_requested` audit** — the task only mandates skipping the email; the audit keeps the flood trail (E-04 discipline) and is strictly cheaper than today's audit+email. No token is signed when suppressed.
5. **Tenant limiter scope**: device Bearer traffic (PHASE-020) presents no `x-session-token` → skipped by design (sync plane owns its throttle, `SyncRateLimitedError`); wrong-method requests to public paths consume the presenter's tenant budget (no such routes exist — acceptable).
6. BFF fixed headers are exactly the four the task listed (no HSTS/Permissions-Policy on the BFF branch — task's explicit list; the API origin middleware carries the full set).

## Handoff notes

- HTTP-level R-04/R-05 + API-header proofs over real rows belong in the orchestrator's db specs (not written here by instruction).
- `RateLimiter.attempt()` is now the general non-throwing seam; `consume()` unchanged in behavior for login/reset per-IP flows.
- Windows are still in-memory singletons (Map) per PHASE-003 substrate; scale-out moves them to the shared plane (comment preserved).
