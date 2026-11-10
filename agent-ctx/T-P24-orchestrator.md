# PHASE-024 — Orchestrator work record (T4/T8/T11/T12/T15 + coordination)

Task ID: **P24-ORCH** (the orchestrator's own slices; the parallel agents' records:
P24-WEB-A, P24-SEC-B, P24-DOCS-C, P24-SEC-D).

## Slices implemented directly

- **Migration 0036 + the substrate** (with the check-rls purge-path drift extension,
  the schema.ts mirror, the manifest/journal/spec four-place consistency, the
  registry + attack-suite fixtures for `tenant_offboarding`, ENTITY_CATALOG 154→156).
  Two design iterations recorded: the first `WITH CHECK (true)` purge policy broke
  the erp_migrate forged-tenant-insert guard (isolation suite caught it — the exact
  reason that test exists) → command-scoped `purge_path_delete`/`purge_path_update`
  with NO insert policy; the `tenants` id-keyed variant added when the drill's
  OFFBOARDED marking hit FORCE-RLS denial.
- **T4 MFA policy** (API): the domain resolver, the login gate (423 +
  enrollmentRequired), the bootstrap service + route + middleware gate, the admin
  reset, the plan lever, rotate gate-inheritance (the self-rotation bypass found in
  review), the session-policy constant, the settings-registry key.
- **T8 audit tooling** (API): the correlationId store filter, the controller
  filters, the bounded audited CSV export.
- **T11 the purge**: the offboarding store/service (typed-name request, the grace
  via subscription GRACE_READ_ONLY — recorded decision, the manifest export with
  sha256 + counts + schema version — the no-zip deviation recorded, two-person
  execution, cancel), the purge service (the migrate-scope connection, FK-topological
  batched deletes, audit anonymization — never deletion, the guard exception proven,
  session severance, verification, the certificate), the jobs registration, the
  controllers + route permissions, the staging drill spec.
- **T12**: the support review report (the ADR-0005 discovery lesson:
  `apply_tenant_policy` is the STRICT macro — support_sessions is invisible to the
  platform GUC; the report indexes off the platform-widened audit trail then fetches
  per-tenant) + the platform route.
- **The RLS canary** (§3): the crown-jewel no-GUC probes + the counter + the
  AppModule queue registration.
- **T15 the gate**: the full re-run + the three fixes it surfaced (below).
- **The findings log** (SF-024-001..022) + the catalog/§25 sync (3 feature keys +
  FEATURE_DEPS + the subscriptions note + the decisions README index) +
  CURRENT_SHIPPED_PHASE 023→024 + the completion report + the four status docs.

## Bugs found + fixed during the gate (the honest list)

1. **Nest middleware path reset**: `request.path`/`request.url` reset to "/" under
   per-route middleware mounting — the MFA gate allowlist failed closed on EVERY
   route (found by the HTTP golden-path test), and the SEC agent's tenant limiter
   carried the same latent bug (its unit tests used fake paths). Fix: read
   `originalUrl` (query-stripped) in both middlewares. → SF-024-009.
2. **pg-boss createQueue boot deadlock**: PROVEN pre-existing at PHASE-022/023 HEAD
   (flagged for 024 in the PHASE-023 report); the wider boot surface (canary + purge
   queues) triggered it in the full-suite run (import-export spec deadlocked).
   Fix: serialize every createQueue behind one promise chain in `getBoss()`.
3. **The check-rls negative proof**: the new purge-path check legitimately flags the
   probe table's post-macro state (the macro creates tenant_isolation only) — the
   test's exclusion updated; the leak it caused (the un-dropped probe tripping the
   isolation registry check) resolved with it.
4. **audit_events is never deletable** — the purge's first sweep attempt hit the
   append-only guard on the DELETE; the anonymization-only design reasserted
   (delete loop excludes audit_events; the verification asserts the tenant_id count
   is 0 instead).

## Gate output (the PHASE-025 baseline)

- DB suite: **139 files / 2019 tests — all pass** (023: 135/1990).
- Unit: api 31/310 · web 5/73 · desktop 16/274 · mobile 27/393 (+contracts/sync-core).
- typecheck 8/8 · lint clean · depcruise 0 violations / 2194 modules ·
  permissions-drift 244=244 · i18n 3343=3343 · docs:validate 29/29 (post-report).

## Coordination notes

The four parallel agents delivered with their own verification (their records list
the exact outputs); the orchestrator merged, typechecked centrally, and ran the DB
suite ONCE per gate iteration (the embedded-PG exclusivity constraint — agents were
forbidden from db-suite runs by instruction).
