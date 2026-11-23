# PHASE-050 W-29 (THE WEB PLANE) evidence — 2026-11-23 (T-15; the gate record per the ratified عرف 049 option (a))

Every log below was generated THIS session against the W-29 step-2 head
`f749298`'s tree (the same-session evidence rule, the **FORTIETH**
consecutive wave — the owner's standing record counts thirty-nine
through the W-28 delivery). The wave is the APPROVED PLAN's §3 W-29
under the owner's standing order — «طيب واصل العمل وعند الانتهاء من أي
خطوة ادفعها إلى المستودع» (every step pushed at its own commit:
`6171b09` the screens → `f749298` the specs → this gate increment):
**T-15 the six quality screens + the COA print surface + the hold
banners + i18n BY BOTH COUNTS.**

## §0a FIRST — the local-vs-remote verification

- The remote verified first: `main @ f749298` (the W-29 step-2 head);
  `phase/049` @ `41c3701` · `phase/048` @ `ba459ff` · `phase/047` @
  `5b73bd1` · `phase/046` @ `4ddb39f` — **the three annotated tags' six
  identifiers + the 049 tag intact** (re-verified by the
  history-secrets run's four anchors).
- The working tree: this session's clone; the tree clean at HEAD at the
  wave's opening; the environment standing (pnpm 9.15.9, the workspace
  install, the persistent-store embedded-PG16 binaries, the chromium
  1200/1248 shells).

## The wave's acts (three delivery commits, each pushed at its own step)

1. **THE SCREENS** (`6171b09`): the six pages + six boards (D-17 — the
   data-slot shape, the 048/049 board patterns) + the COA print builder
   + the shared hold banner + the two batch-bearing-surface wirings +
   the six NAV_ITEMS rows + the six FALLBACK_CRUMBS + **i18n BY BOTH
   COUNTS (6,955 + 298 = 6,955 + 298 — ar=7,253 = en=7,253)** +
   `localizedQualityError` (33 codes) + the api-types mirrors.
2. **THE SPECS** (`f749298`): the ten web specs (the six board specs +
   the banner spec + the nav-rows flag-gating spec + the print spec —
   the web suite 21·171 → **30·204**) + **THE REAL CHROMIUM COA PRINT
   ARM** (`quality-coa-print-render.db.spec` 3 arms — both locales'
   thead/dir/numeric/woff2 assertions · the REAL PDF render · the
   determinism arm) + the coverage roster's declared movement (**chunk-a
   108 → 109 · the roster 295 → 296**; 296 = 296, missing NONE, extra
   NONE, duplicates NONE — VERDICT: COVERED) + the affected-folder runs
   (the quality family **13 · 159** · migrations + identity-flows 2 ·
   28).
3. **THIS GATE INCREMENT** — the battery (below) + the evidence
   envelope + the ledger accumulation (the acceptance ledger's W-29
   dated note: #4's print arm + #9's i18n/flag-gating arms DELIVERED ·
   NEXT_ACTION → W-30 · the IMPLEMENTATION_STATUS dated line) + this
   README.

## THE DETERMINISM FINDING (probe-evidenced, dated in the spec)

Skia's `/CreationDate` + `/ModDate` PDF metadata (second-resolution wall
clock) is the ONLY nondeterminism in the Chromium output — a 40-pair
probe: 31 byte-identical, the 9 crossing a second boundary differed at
exactly those two lines. The print spec's determinism arm asserts: two
**builds** byte-identical (full html compare) + two **renders**
byte-identical modulo the renderer's own clock stamps
(regex-normalized full-string compare, page counts + byteLengths equal)
— stable across consecutive runs instead of a wall-clock coin-flip. The
W-13/W-21 print laws' determinism demand is satisfied HONESTLY: the
document content is byte-identical; the renderer's own clock stamps are
the renderer's, disclosed and normalized.

## The isolates — THE FIVE standing (the pre-isolation mandate, §0c (2))

| The FIVE isolates (STANDALONE FIRST) | Files · Tests | Log |
|---|---|---|
| soak | 1·1 — 227.96s | `db-isolate-soak.log` |
| fcm | 1·8 | `db-isolate-fcm.log` |
| email | 1·5 | `db-isolate-email.log` |
| the cmms sweep | 1·4 | `db-isolate-sweep.log` |
| the quality calibration sweep | 1·4 | `db-isolate-quality-sweep.log` |

## The affected DB folders — re-run at the delta head, this session

| Folder | Files · Tests | Log |
|---|---|---|
| the quality family | **13 · 159 GREEN** (the family 156 → 159 — the REAL-Chromium print arm joins) | `db-affected-quality.log` |
| migrations + identity-flows | **2 · 28 GREEN** (the chain at 118 · the ROUTE_PERMISSIONS checklist over the 1,152 routes) | `db-affected-migrations-identityflows.log` |

The full ten-part envelope rides at **296 files** (VERDICT: COVERED) —
**W-32 re-runs it at the final head**.

## The 118-chain scratch from zero — TWICE (السلسلة من الصفر مرتين)

`scratch-rls-proof.ts`: both runs CHAIN_118_APPLIED → **[check-rls] OK
— 340 catalog tables** → SCRATCH_STOPPED, EXIT=0 (`check-rls-scratch-118-run1.log`
· `check-rls-scratch-118-run2.log`).

## The standing battery (every log this session, every stamp green)

| Check | Verdict | Log |
|---|---|---|
| typecheck | **8/8** (0 cached — the force re-run) | `typecheck.log` |
| lint | **8/8** (0 cached — the force re-run; no catch this wave) | `lint.log` |
| depcruise | clean — **2,184 modules · 16,312 dependencies** (+24/+174 dated) | `depcruise.log` |
| unit workspace | 8/8 (0 cached) — **167 files · 2,020 tests** (api 78·976 · web **30·204** · mobile 27·393 · desktop 16·274 · ui 3·43 · contracts 2·56 · domain-core 6·38 · sync-core 5·36 — **2,020 = 976+204+840 EXACT**) | `unit-workspace.log` (+ `unit-web.log`) |
| permissions drift | **347 = 347** (zero delta — a surface wave; no new routes) | `permissions-drift.log` |
| i18n parity | **ar=7,253 = en=7,253** (the declared delta 6,955+298 both sides — the first-surface-wave law) | `i18n-parity.log` |
| mobile i18n / tokens | 371 standing · 50/50 | `mobile-i18n.log` / `mobile-tokens.log` |
| manifests | 13/13 | `manifests.log` |
| capabilities | agree | `capabilities.log` |
| docs:validate | 33/33 | `docs-validate.log` |
| id-ledger | 0 errors — implemented G 61 · INV 34 · BR 100 | `id-ledger.log` |
| id-ledger self-test | all probes OK ✓ (probe 7 stands at G-62/PHASE-050) | `id-ledger-self-test.log` |
| history-secrets | **0 violations** · 6,723 allowlisted hits (the W-28 6,687 +36; the FOUR tag anchors untouched) | `history-secrets.log` |
| ROUTE_PERMISSIONS | **1,152 standing** (no new routes — the pages are file-based; the nav is data-driven) | (the static standing) |
| desktop-shell / mobile-shell | PASS / PASS | `desktop-shell.log` / `mobile-shell.log` |
| boundary-negative | PASS | `boundary-negative.log` |

**The static constants:** the chain 118 · ENTITY_CATALOG 340 · the
registry 315 tenant-owned tables · the drift 347 · ROUTE_PERMISSIONS
1,152 · the report registry 118 (the +4 are W-30's) · the unit ledger
167 · 2,020 (web 21·171 → 30·204) · the DB suite roster 296 files.

**NOT production approval — تسليم لا قبول.** W-30 (the review pack +
the hazard registers + the four report contracts — T-16 + T-17) waits
on the owner's dispatch under the standing order. The standing recalls
ride the 049 completion report §4; RISK-033 at EIGHT with ZERO new this
wave. The reservations G-62…G-63 · INV-035 · BR-101…BR-104 carry the
لا-كتابة-خارجها law into every remaining 050 wave.
