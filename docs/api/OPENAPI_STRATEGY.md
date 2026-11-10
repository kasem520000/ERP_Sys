# OpenAPI Strategy

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

How the machine-readable API contract is produced, validated, and consumed. Principles:
**the spec is generated, never hand-authored**; the zod schemas in `packages/contracts`
are the single source of truth ([ADR-0002](../architecture/ADR/ADR-0002-typescript-monorepo.md)
monorepo discipline); drift is a CI failure, not a state.

## 1. Spec generation from zod schemas

- Every request/response shape is a zod schema registered in `packages/contracts`
  (`ApiContract` objects: method, route pattern, request/response schemas, error codes,
  idempotency requirement, permission key).
- A build-time step (`zod-to-openapi` style registry) compiles registered contracts into
  an **OpenAPI 3.1** document: paths, schemas (with the money-as-string patterns of
  [ADR-0009](../architecture/ADR/ADR-0009-money-precision.md)), parameters (including the
  filter/sort syntax enums of [API_CONVENTIONS.md](API_CONVENTIONS.md) §5), and the error
  envelope ([ERROR_MODEL.md](ERROR_MODEL.md) §1) as a reusable component.
- Hand-edited `openapi.json` fragments are forbidden; anything not expressible from zod
  is a contracts-package gap to fix, not a spec patch.

## 2. Route registration mapping

- NestJS controllers declare their route with a reference to the same contract id the
  generator consumed; a startup-time consistency check (dev + CI) verifies that every
  mounted route has a registered contract and every registered contract has a mounted
  route — orphan routes fail the build (no undocumented API surface).
- Permission keys, idempotency requirements, and rate-limit tiers are declared on the
  contract and flow into both the OpenAPI document (security/extension fields) and the
  NestJS guards — one declaration, three consumers.
- Sync push/pull document their per-item result schemas (multi-item envelopes are modeled
  as `oneOf` components; see [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §3).

## 3. Spec artifacts per CI build

1. Every CI build publishes `openapi.json` and `openapi.yaml` for the current major
   (plus the frozen document of any deprecated major still in its Sunset window,
   [API_VERSIONING.md](API_VERSIONING.md) §4) as build artifacts.
2. The build runs the **diff gate** against the committed baseline: additive-only changes
   pass; breaking rows ([API_VERSIONING.md](API_VERSIONING.md) §3) fail
   ([API_VERSIONING.md](API_VERSIONING.md) §6.1).
3. Contract tests run generated clients against the live test server; the artifact and
   the behavior must agree byte-level on schemas (field sets, patterns, requiredness).

## 4. Consumer codegen policy

| Consumer | Client source | Rationale |
|----------|---------------|-----------|
| Web (BFF) | **Generated directly from `packages/contracts`** (shared TS types + fetch client) | same-monorepo source of truth; no codegen step needed — the contracts package IS the client |
| Desktop (Tauri) | Same generated TS client as web (shared package, no server dependency at runtime) | ADR-0013 reuse; offline layer wraps it with the sync engine |
| Android (Expo) | **Its own client generated from the published OpenAPI document** | different language/runtime; regenerating from the artifact keeps the Play-Store-lagging client honest against a frozen spec ([API_VERSIONING.md](API_VERSIONING.md) §5) |
| External/integrators | The published `openapi.json` (self-serve) | spec is the product surface; no private contracts |

Regeneration for Android is a CI job: spec diff → generated-client PR — the diff gate
rules what lands.

## 5. Diff gates vs baseline (summary)

- Baseline = committed `openapi.json` of the current major at last approved bump.
- Gate matrix: breaking row ⇒ fail; additive change ⇒ pass + changelog-required check;
  baseline change on a feature PR ⇒ fail (dedicated bump PR only).
- Error-code registry ([ERROR_MODEL.md](ERROR_MODEL.md) §4) is diffed as an enum: removal
  or re-semantics = breaking; addition = additive.

## 6. Documentation portal (post-MVP — deferred)

A hosted, browsable API reference rendered from the published spec (per-major, with the
changelog, deprecation table, and sandbox examples) is **planned but explicitly deferred
until after MVP (PHASE-014)**; until then the artifacts of §3 + the changelog are the
developer documentation. The portal will consume the same artifacts — no parallel
authoring path may appear in the meantime (single-source rule).

## 7. Ownership and change process

1. **Owner**: the `packages/contracts` package — every schema/contract change is a PR to
   that package; API-behavior PRs without a contracts PR fail review by rule.
2. **Review gates** per change class: additive (module owner approval) · breaking
   ([API_VERSIONING.md](API_VERSIONING.md) §3 table — requires the major-version process
   + deprecation plan) · error-code addition ([ERROR_MODEL.md](ERROR_MODEL.md) §4 registry
   row + client-handling row required in the same PR).
3. **Changelog discipline**: each merged contracts PR adds a user-facing changelog entry
   (endpoint, change class, migration note); the changelog is published with the build
   artifacts and feeds the deprecation table.
4. **Tooling budget**: zod-to-openapi generation + `openapi-diff` gate + generated-client
   jobs run in CI only — no paid spec-management SaaS at MVP; the artifacts + git history
   ARE the audit trail.

