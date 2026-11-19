# PHASE-047 Completion Report — HR Growth: Talent & Performance

> **Status:** COMPLETE · **Date:** 2026-11-19 · **Phase doc:**
> [../PHASE-047.md](../PHASE-047.md) · **Register:** [CR-17](../../../planning/COMPLETENESS_REGISTER.md)
> · **Triple flip:** this report + the phase doc header + the IMPLEMENTATION_STATUS
> row flipped together (CR-48) · **Wave 2's fifth phase** — the platform that runs
> the daily workforce truth and the statutory world now runs the FULL talent
> lifecycle on top of them (the performance engine with BR-090's anonymized 360,
> the monotonic recruitment pipeline, the training/certification registers, the
> org structure with cycle-safe moves, and the Gulf compliance document register
> as a scheduled alert product), and PHASE-048 (Projects & Contracting) is
> unblocked per the roadmap's hard chain.
> **Scope discipline:** completing 047 is NOT closure of the 043 hard review and
> NOT production approval — RISK-031/RISK-032 stay OPEN per the governance record;
> the 045 self-board Tabs defect stands recorded for the owner's dispatch (the
> W-5 disclosure — 045 scope).

## 1. Executive summary

PHASE-047 closed the platform's **talent gap** (CR-17): the **performance
engine** (the one-way CAS cycle lifecycle, the review submission with
**BR-089's exactly-100% weight-sum gate** (zero residue), **BR-090's 360
aggregate** (the SELF/PEER/SUBORDINATE inputs visible only as per-relationship
count/mean/min/max at the ≥ 3 threshold — never an attributed source, the
posture structural at every bridge), the calibration act, the cascading goals
with the KRI triad, and the competency framework with the tenant's
configurable 1–5 scale (BR-055 — the seeded AR/EN default the one shipped
default)), the **recruitment engine** (**BR-088's FIXED monotonic ladder**
with the one recorded REOPEN and the **written-once hire link** to the 045
employee master — D-01: the talent layer never writes the employees table),
the **training/certification registers** (the once-stamped COMPLETED edge),
the **org structure** (D-09 — the materialized path + the pure cycle guard;
**the W-4 NF-9 fix: the literal-prefix subtree rewrite** with the adversarial
close-code test), the **HR-10 document register** (the Gulf compliance
exposure as a scheduled alert product — the numbers PII-registered per
amendment A-4, never in exports), and the **daily hr-expiry-sweep**
(**BR-091's structural dedupe** — the four probes, the disjoint 30/7/0
bands as tenant-configurable DATA with fail-closed documented defaults and
the explicit off switch, the exact dedupe key shape riding the notifications
unique index). The phase delivered the **external bridges** (D-07 — the
three export contracts with the A-4 PII cross-check STRUCTURAL (the typed
forbidden-axes list + the bait scans) and the two import paths with
row-level validation reports on the same machinery the in-app surfaces
ride), the **web plane** (the four screen families + the employee 360
extension + the four composition reads — 308 i18n keys/locale at 6,433
parity), the **four report contracts** (registry 106 → 110, all pin sites
re-pinned together, the catalog↔registry reconciliation extended to 110/110,
zero new permissions and zero new routes — drift 312 = 312), the **proof
wave** (the dedicated talent RLS attack suite over full FK-chained
two-tenant worlds with the composite-FK law proven live + the OA-06 EXPLAIN
budgets in the W-9-settled shape), and **the honest infrastructure repairs**:
the NF-9/NF-10/NF-11 fixes (the owner's W-3 verification findings) and the
**vitest suite-failure exit-0 finding** (the second NF-4-class finding —
vitest 3.2.7 under the DB config exits 0 on suite-level failures; repaired
structurally with THE VITEST SUMMARY GUARD in the capture wrapper, the stamp
now the MAX of the process code and the summary's own verdict).

**Ledger-free by design (D-05):** the phase touched no journal rule, no
golden entry, no account purpose — the talent layer is structurally
ledger-incapable (the W-2 negative proof), and the ID_LEDGER's BR-088…091
slots flipped to implemented (BR-001…091) with zero G/INV claims.

## 2. Mandatory code-evidence checklist (CR-48)

- Migrations **0095–0099** (the fourteen talent tables + the employees
  position_id/probation_end extensions per D-01/D-02+A-1 + the DATA-ONLY
  grants: the twelve permission keys, the four feature flags, the four
  manifest enablements, the competency scale seed) — Drizzle mirrors +
  `tables.registry` +15 + `ENTITY_CATALOG` 292 → 306 → 307 (hr_alert_jobs);
  the chain applies cleanly from zero with re-apply no-op (the full suite's
  migrations spec green in-chunk; the standalone scratch `check:rls` 307/0
  re-proofs from zero at the final head).
- Drizzle schema parity: the mirrors landed with the migrations (W-1's
  one-increment law; drift checks green all wave).
- Permissions: +12 keys seeded (0098 §1), matrix §3.25 (300 → 312), the
  zero-drift equality held at every wave (**312 = 312** — W-1/W-7 gates).
- ROUTE_PERMISSIONS: 944 → 988 across W-2/W-3/W-5 (no route after W-5; the
  four report contracts add none — the §12 convention).
- i18n: 6,125 → **6,433** per locale (+308, 100% parity; D-12's
  exact-count law) + mobile 371 + tokens 50/50.
- `docs:validate` **33/33** at every wave; manifests **13/13**.
- The archive `ERP_PLATFORM_PHASE047.zip` (OA-07) — members byte-verified
  (§6); the tag `phase/047` at the delivery head.

## 3. Acceptance criteria vs. evidence (§6 of the phase doc)

1. **Migrations + mirrors + catalog rows (CR-36a)** — W-1 delivered the
   fourteen tables with every catalog row (ENTITY_CATALOG 306 → 307 with
   0099); the chain re-proven from zero at the final head (the W-7 scratch
   run 307/0).
2. **The end-to-end cycle (BR-089/090)** — `talent-performance.db.spec`:
   the full walk activate → submit (the 360 inputs + the manager review) →
   the aggregate render → calibrate → close with the worked example
   40%@50 + 60%@75 = 65.00; the weights-sum law proven both ways (the 100%
   pass + the 80% typed refusal with zero residue).
3. **The monotonic pipeline (BR-088) + the hire link + the scorecards** —
   `talent-recruitment.db.spec`: the ladder matrix, the recorded REOPEN, the
   written-once hire link (the NF-10 real arm), the per-panelist-per-round
   scorecards; the CAS race as a two-transaction duel.
4. **Training completions + certifications (issuer/expiry intact)** —
   `talent-training-org.db.spec`: the COMPLETED edge's once-stamp law, the
   certification register feeding the sweep's probe-2.
5. **The sweep at 30/7/0, deduplicated, with evidence** —
   `talent-documents-sweep.db.spec`: the four probes, the disjoint bands,
   the re-run dedupe (BR-091's structural key), the NULL probation skip,
   the custom thresholds + the off switch, the stamped run stats; the
   notifications land in the inbox (the 0099 category widening).
6. **The screens + the 360 + NAV/⌘K with flag gating (AR/EN, RTL)** —
   W-5: the four families + the 360 extension + the NAV/⌘K rows on W-1's
   registration, the flag-gating arm at the resolver (each flag hides its
   own row), 308 keys/locale at 6,433 parity; the honest disclosure of the
   PRE-EXISTING 045 self-board Tabs defect (gate doc §5 — the owner
   dispatches the 3-line repair, 045 scope).
7. **The +12 keys + zero drift + the plan-tier grants** — drift 312 = 312
   at every wave; the business-plan granted subset vs the enterprise
   all-four-families split is the entitlement/authorization divergence
   (matrix §3.25's dated note; the four flags ride plans/manifests, the
   twelve keys ride roles).
8. **RLS attack tests A1–A10 extended to all 14 tables (CR-36e)** — the
   W-1 registration's generated +84 (the isolation folder green at the
   final head: 1,710/1,710) + the W-6 dedicated `talent-rls.db.spec` 10/10
   (A1–A10 ×14 over full FK-chained two-tenant worlds, the composite-FK
   law proven live: the FK-inversion probe fails 23503 BY CONSTRUCTION).
9. **House gates + the bridges** — the full sweep green at the final head
   (§5); the bridges verified end-to-end (`talent-bridges.db.spec`): the
   three exports as CSV/JSON with the A-4 PII cross-check structural (the
   typed forbidden-axes list + the seeded-bait scans), the two imports with
   the row-level validation reports (the 15-reason vocabulary, the in-file
   collapse law, the idempotence laws), the contracts documented in the
   integrations README §3.10; the OA-06 budgets index-driven with the
   plans logged verbatim (`talent-explain-budgets.db.spec` 5/5).
10. **This report + the flips + the archive (OA-07)** — §5/§6 below.

## 4. Deviations & decisions (documented)

- **Migration 0099 — the honest fifth slot** (W-3): the plan §2's inventory
  listed 0095–0098 (the talent TABLES only); D-06's own text requires the
  config surface. The dated note rides the plan's §2 and the W-3 gate doc —
  never a silent rewrite.
- **The entitlement/authorization divergence** (W-1, deliberate): the four
  feature flags gate the capability; the twelve permission keys ride roles
  (045/046 used one key for both jobs; 047's finer-grained set diverges —
  matrix §3.25's dated note).
- **The NF-7/NF-8 record fixes** (W-2/W-4, the owner's verification
  findings): the route-count pins 919 → 944 → 979 → 984 → 988 with the
  dated notes at every claim site.
- **The NF-9 security fix** (W-4, mandatory with T-10): the org move's
  LIKE-with-unescaped-underscore hole (`SALES_EAST.%` matching
  `SALESXEAST.`) repaired with the literal-prefix rewrite + the adversarial
  close-code test.
- **The NF-10 fix** (W-4, the owner's preferred remedy): the hire CAS's
  written-once arm made real (`AND hired_employee_id IS NULL` active when
  the statement carries a link) with the store-level zero-residue pin; the
  two stale doc comments re-dated.
- **The NF-11 fix** (W-4): the W-3 gate doc's 58 → 59 unit-count correction
  at the claim site.
- **The 045 self-board Tabs defect** (W-5, honestly disclosed, NOT fixed):
  hr-self-board's conditional-expression Tabs children render EMPTY for
  every tab except the last (the Children.forEach null-overwrite); the W-5
  boards are immune (the data-slot shape); the 3-line repair is 045 scope —
  the owner dispatches (the one-phase law).
- **The vitest suite-failure exit-0 finding** (W-6, the second NF-4-class
  finding): vitest 3.2.7 under the DB config exits 0 on suite-level
  failures — the wave's own red run stamped VITEST_EXIT=0 through a
  faithful wrapper. Repaired structurally: THE VITEST SUMMARY GUARD (the
  stamp is the MAX of the process code and the summary's verdict; the
  wrapper's self-tests prove both ways; every W-6/W-7 log passed through
  the repaired wrapper). The prior waves' green stamps are not impugned —
  every earlier green log's summary counts match its stamp.
- **The 3,621 → 3,623 F1 correction** (W-7): the full-suite expectation
  carried a 2-test underestimate from the W-5 base estimate; the delivered
  actual settles the count; the dated corrections ride the W-6 gate doc and
  the master plan's W-6 note.
- **§7(b)'s three PHASE-045 final-audit remarks**: their text never entered
  the record (referenced by the 045 acceptance dispatch; never restated) —
  nothing folded, nothing fabricated; they stand as the owner's open input.
- **The register's exactly-two narrowed items stand** (the SANED 15,000
  ceiling + the EOSB M/51 Art. 84 text) — unchanged, the owner's.

## 5. Gate evidence (the full sweep — the W-7 final head, 2026-11-19)

Every log wrapper-captured in the delivery session
(`audit-evidence/phase047-w7/`); the DB chunks at the delivered head:

| Gate | Result |
|---|---|
| typecheck / lint | **8/8 packages green** |
| depcruise | no violations — **1,993 modules · 14,855 dependencies** |
| unit | **8/8 packages** — api 60 · 712 · web 13 · 122 · mobile 393 · desktop 274 · ui 43 · contracts 56 · domain-core 38 · sync-core 36 |
| **THE FULL DB SUITE** | **259/259 files · 3,623/3,623 tests · 0 failed · 0 skipped** — smoke 3 · 1,717 (migrations + isolation) + perf 6 · 22 (the load-shaped family) + 83 · 641 + 77 · 511 + 90 · 732 |
| check:rls (scratch PG16, the 99-chain from zero) | **OK — 307 catalog tables, 0 violations** |
| permissions drift | **312 = 312** |
| i18n parity | **6,433 = 6,433** · mobile **371 = 371** · tokens 50/50 |
| manifests / docs:validate | **13/13** · **33/33** |
| id-ledger | **0 errors + self-test all-probes-OK** — implemented **G 54 · INV 32 · BR 91** (the BR-088…091 flip) |
| history-secrets / capabilities / shells | 0 violations · agree · PASS |
| negative boundary | **PASS** (boundary + the i18n negative proof) |

## 6. Delivery and handoff

- **The triple flip (CR-48):** this report · the phase doc header →
  COMPLETE · the IMPLEMENTATION_STATUS row → COMPLETE.
- **The archive:** `ERP_PLATFORM_PHASE047.zip` (OA-07) at the delivery head
  — all members byte-verified; the standing `ERP_PLATFORM_PHASE043.zip` /
  `ERP_PLATFORM_PHASE045.zip` / `ERP_PLATFORM_PHASE046.zip` verified
  untouched.
- **The tag:** `phase/047` (annotated, at the delivery head — amendment
  A-3's confirmed tag).
- **Handoff to PHASE-048 (Projects & Contracting):** `positions` (with
  grades and cost bands) and the employee master are the picker source for
  `project_resource_allocations`; the employee 360 extension is the surface
  project managers use when allocating people to WBS nodes; the org tree's
  materialized paths roll project rollups up the reporting lines. The
  ID_LEDGER's PHASE-048 reservations stand (G-55…58 · INV-033 ·
  BR-092…096).
