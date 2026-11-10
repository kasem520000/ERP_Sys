# ADR-0003 — Next.js Web Client + Headless NestJS API (BFF Pattern)

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

The Platform needs (a) a marketing site with pricing, (b) an authenticated ERP web app
(RTL-first), and (c) a clean REST API consumed by desktop and Android clients. Session
security must not depend on client-side token handling (XSS/token theft risk), and the
directive requires the server to remain authoritative.

## Decision

- **Next.js (App Router)** hosts the marketing site **and** the ERP web UI.
- The ERP web UI calls the NestJS API **through Next.js route handlers acting as a BFF
  (Backend-for-Frontend) proxy** on the server: browser → Next route handler → API.
- Authentication uses **server-side sessions** ([ADR-0015](ADR-0015-authentication.md)):
  the browser holds an `httpOnly` session cookie against Next.js; the BFF attaches the
  session (cookie forwarding with `credentials: 'include'` on same-site API or an
  internal token exchange) when calling the API. No access tokens in browser storage.
- Desktop and Android talk to the **same public versioned REST API** directly with device
  tokens — the BFF is web-only sugar, never a second business-logic layer.
- The BFF contains **no business rules**: it validates nothing beyond transport, forwards
  idempotency keys, and normalizes errors ([../../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md)).

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Next.js full-stack (API routes = the ERP backend) | Couples backend lifetime to the web app; poor fit for desktop/Android, background jobs, long-running report workers; NestJS module system better enforces boundaries. |
| Browser → API directly with JWT in localStorage | XSS-exfiltratable tokens; refresh-token rotation in the browser is fragile; cookies + BFF are safer and simpler. |
| GraphQL gateway | Rejected in [../ARCHITECTURE_DECISIONS.md](../ARCHITECTURE_DECISIONS.md) — REST + generated clients are simpler and idempotency-friendly. |
| Separate marketing site (e.g., Astro) | Second toolchain for marginal gains; Next.js handles both well. |

## Consequences

- Two server runtimes in production (Next.js and API) — acceptable operational cost,
  documented in [../DEPLOYMENT_ARCHITECTURE.md](../DEPLOYMENT_ARCHITECTURE.md).
- All ERP API contracts are designed **client-agnostic** (desktop/Android parity) from
  day one; the BFF must never become a feature fork.
- Web SSR/RSC is used mainly for shell + marketing; data grids are client components
  fetching via BFF — keeps ERP interactivity simple and offline-predictable.
- CSP and CSRF: same-site cookies + CSRF token on unsafe methods via BFF; documented in
  [../../security/DATA_PROTECTION.md](../../security/DATA_PROTECTION.md).

## Revisit triggers

- If BFF proxying measurably hurts latency (double hop), allow direct browser→API calls
  for read-only endpoints with the same cookie domain — requires a security review note.
- If marketing traffic dominates and needs a separate CDN/SSG strategy, split the
  marketing app (mechanical, low risk).
