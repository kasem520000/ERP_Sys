# Gate evidence — PHASE-045 start: the kickoff + the HR core substrate (2026-11-14)

**Scope:** the owner's parallel directive — PHASE-045 (HR Core) STARTS
alongside the 043-completion review. Starting 045 is NOT closure of 043
and NOT production approval. The owner's rules for the parallel work:
separate commits and evidence per phase, coordinated migration numbers /
ids / shared files, independent test databases when running both phases'
tests (the harness's single embedded-PG data dir makes the runs
SEQUENTIAL on one machine — recorded), the shared gates re-run on the
unified head after each merge (each its own run, never combined into one
success claim), and no closure/production claims before the independent
review.

---

## Item 1 — the kickoff (the scope/requirements/plan + the conflict report)

The scope, requirements, and implementation plan are the ones
[PHASE-045.md](../../implementation/phases/PHASE-045.md) already carries
(authored 2026-11-10; reviewed against the current head at start — no
scope change). The kickoff coordination record (in the phase doc's
header block) reports the conflict check against the 043-completion
fixes — **NO REAL CONFLICTS**:

1. **Migrations:** the completion round took NO migrations (code + docs
   only); the journal ended at 0079, so this phase's honest slots are
   **0080…0086** (the plan's "≈ 0082…0088" predates the journal's actual
   end — the numbering note, recorded in migrations.ts, the journal, and
   the spec).
2. **Ids:** BR-081 was taken by the completion round (the reservation
   hard protection); this phase's business-rule slots are **BR-082…084**
   (the ledger's ladder re-coordinated 2026-11-14, dated notes in every
   post-043 phase doc — the ledger checker green at 0 errors). G-50/G-51
   and INV-031 are untouched and free.
3. **Shared source files:** the completion round touched movement-core,
   the inventory store, deliveries, orders, and the reservation specs —
   the HR core touches NONE of them (new tables + new services; the only
   shared surfaces are the migration manifest/journal, schema.ts,
   ENTITY_CATALOG, the permissions seed + drift registry, and the
   authorization matrix — all coordinated in this step's commits).
4. **Test runs:** sequential (one embedded-PG data dir).

## Item 2 — the delivered substrate (T-01 + T-02's substrate half)

- **Migrations 0080…0086** (applied cleanly; schema_version 86): the
  shift family (templates + the employee × date roster grid), the punch
  sessions (the derived daily status + the import-dedupe floor), the
  overtime family (BR-084's pre-approval lifecycle), the leave family
  (INV-031's per-year balance cells + the simple-approval chain), the
  per-jurisdiction holiday calendars, the employee ↔ user identity
  bridge (HR-13 — the partial-UNIQUE guard, ON DELETE SET NULL, the
  SoD-scoped link), and the DATA-ONLY seed (the six hr.* permission
  keys — catalog 291 → 297; the business/enterprise plan grants).
- **Two recorded seed decisions** (the phase doc's kickoff record): (1)
  the default leave types are the PER-TENANT first-use default — the
  table is tenant-scoped, no global row exists to seed (the BR-055
  no-fabricated-defaults discipline); (2) the workforce-industry MANIFEST
  enablement is DEFERRED to the phase's T-15 web step — it is one
  coherent change with the CANONICAL manifests (the contracts' code
  source of truth), the specs' pinned manifest hashes, and the
  starter-plan degradation-chain pins; the DB half alone (the 0078 §4
  shape) would desync the stored manifests from the canonical hash the
  apply service verifies (proven by the bring-up run below).
- **The feature registration:** hr.attendance / hr.leave / hr.shifts in
  FEATURE_DEPS (on the payroll employees substrate — both business and
  enterprise carry it, closure-valid) + the `hr` module segment in the
  contracts' manifest schema.
- **The coordination (T-02):** the Drizzle mirrors for all 10 tables;
  the ENTITY_CATALOG rows (272 → 282); AUTHORIZATION_MATRIX §3.23 (the
  six keys, the guarded-routes plan, the SoD note — HR data visibility
  rides HR permissions, never user administration); the isolation
  registry + the A1–A10 fixtures for the 10 tables — the generated
  attack suite now covers them (cross-tenant isolation proven per
  table); the permissions count pin (291 → 297).

## Item 3 — the bring-up findings (recorded honestly, each its own run)

The substrate's first unified-head full run found **17 files / 40 tests
failing** — three root causes, all in MY new work (never in the
043-completion code):

1. **The BR-040 closure:** the hr.* plan keys were not in FEATURE_DEPS
   → every plan carrying them violated the dependency closure (the
   entitlements, demo-data, template, and sandbox suites). Fixed by the
   FEATURE_DEPS registration.
2. **The manifest schema:** the `hr` module segment was not cataloged in
   the contracts' feature-key pattern → the automotive/food_manufacturing
   template parses rejected the manifests. Fixed by the segment
   registration.
3. **The canonical-hash pins:** my DB-side manifest enablement
   (the 0078 §4 shape, with the keys wrongly unprefixed — a no-op — then
   correctly prefixed) desynced the stored manifests from the canonical
   hash the template specs pin, and the starter-plan degradation chains
   would need re-pinning. **Decision: DEFER the enablement to T-15**
   (the coherent change), rather than touch the canonical manifests +
   hash pins from the substrate step.
4. Plus one fixture CHECK bug of mine (a lexicographic `BETWEEN '1' AND
   '32'` where a `char_length` check was meant — the isolation seeding
   caught it immediately). Fixed.

After the fixes: the failing set green (14 files / 106 tests), the
isolation suite **1,572/1,572**.

## Item 4 — the gate sweep at the unified head (each row its OWN run)

| Gate | Command | Result (this session, this head) |
|------|---------|----------------------------------|
| The migrations spec (boots embedded PG, applies the full 0080…0086 chain, checks the manifest + schema_version + ownership + FORCE RLS) | `vitest run --config vitest.db.config.ts src/__db__/migrations.db.spec.ts` | **7/7 passed** |
| The isolation suite (the registry completeness + the generated A1–A10 attacks over all 261 tenant tables — the 10 new included) | `… src/__db__/isolation/identity-isolation.db.spec.ts` | **1,572/1,572 passed** |
| The identity flows (the permissions count pin 297) | `… src/__db__/identity-flows.db.spec.ts` | **passed** |
| The bring-up intermediate full run (pre-fixes) | `… src/__db__/` | **17 files / 40 tests failed** (the three root causes above — verbatim in Item 3; never merged into any other claim) |
| The bring-up intermediate full run (post-closure/manifest fixes, pre-deferral) | the same | **2 failed** (the hash-pin desync + the count pin — drove the deferral decision + the pin update) |
| **FULL DB SUITE at the unified head (the FINAL run)** | the same | **224/224 files · 3,216 passed \| 2 skipped (3,218) — 0 failed** (started 12:10:35 UTC, 499.53s — the 043-completion work + the 045 substrate together, one process, one embedded PG) |
| api typecheck | `tsc --noEmit -p tsconfig.json` (apps/api) | **clean** |
| lint (the changed files) | `eslint <the ten changed sources>` | **clean** |
| docs validation | `pnpm docs:validate` | **33/33 passed** |
| id-ledger | `pnpm check:id-ledger` | **0 errors, 0 warnings** (implemented: G 49 · INV 30 · BR 81) |
| permissions drift | `pnpm check:permissions-drift` | **matrix 297 = seed 297** |

**NOT re-run this round (no web-side changes):** web build, web-security,
token-contrast, ui-catalog, i18n parity, the design-system visual harness.

## Item 5 — what remains (the phase stays IN_PROGRESS, honestly)

NOT delivered yet: the services (T-03…T-11 — shifts/rosters, the
attendance derivation, the device import, the overtime engine, the leave
engine, the holiday integration, the identity-bridge service, the
payroll feeds), the goldens G-50/G-51 + the INV-031/BR-082…084 suites +
their failure packs, the screens + i18n (T-12…T-15, incl. the deferred
manifest enablement), the three report contracts (T-16), the OA-06
EXPLAIN budgets, the completion report, and the archive (OA-07). **No
closure is claimed and no production approval is implied — the
043-completion head (25affc6, carried in this unified head) and this
045 substrate both await the owner's independent review.**
