# DR-002 — Fixed Assets: Register, Depreciation Runs, NBV Floor, Revaluation Reserve

> **Status:** ACCEPTED · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28 ·
> **Date:** opened 2026-10-28, accepted 2026-10-28 ·
> **Approver:** Product Owner (author: Accounting Domain Architecture) ·
> **Source:** [ED-02](../../EXPANSION_REGISTER.md) (Blueprint v2.0) ·
> **Related:** [INV-023](../../accounting/ACCOUNTING_INVARIANTS.md),
> [BR-041…BR-044](../../product/BUSINESS_RULES.md),
> G-21…G-23 golden postings ([../../accounting/JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7),
> [INV-017](../../accounting/ACCOUNTING_INVARIANTS.md) analogy (method stability),
> PHASE-026, umbrella record [product/DR-003](../product/DR-003-platform-expansion-v2.md)

## Context

v1.1 carried fixed assets as a **deliberate deferral** (SCOPE §74, gated behind the
PHASE-025 scope review); comparative research (EXPANSION_REGISTER preamble) shows asset
registers and monthly depreciation are **table stakes** in the leading Arabic-market
systems (Qoyod, Odex, Wafeq, Deexe, iCore, Raito). Blueprint v2.0 promotes the module
`fixed_assets` to **planned scope at PHASE-026** (ED-02/ED-18), reusing the existing
posting engine, fiscal periods, and purposes machinery — no new ledger concepts.

Forces:

- The module's value is a **disciplined monthly depreciation cycle**, not per-asset manual
  journal creativity: uncontrolled asset journals are the classic audit failure.
- Asset accounting is jurisdiction-sensitive in ways the core is not (useful-life
  conventions, tax-vs-book depreciation). The platform's no-fabrication rule
  ([../../localization/compliance-matrix/README.md](../../localization/compliance-matrix/README.md))
  forbids shipping country-specific depreciation rules as product facts.
- Tenants must keep book value honest: an asset may never be depreciated below its salvage
  value, and disposals must be one-time, auditable events.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Register + category-driven runs (adopted)** | Asset register with categories; depreciation **only** via period runs; revaluation to a reserve; disposal as a posted document | Engine-monopoly preserved; period-locked runs mirror the accounting close; per-asset math is testable (INV-023) | Tenants cannot hand-adjust an asset's depreciation — by design |
| **B. Free-form asset journals** | Assets post like manual journals, any time | Maximum flexibility | Breaks BR-002's philosophy; unreviewable depreciation; period integrity erodes |
| **C. Country depreciation packs (tax-aware automation)** | Ship jurisdiction tables of useful lives / tax rates | Market-pleasing "compliance" checkbox | Fabricates legal facts; violates the official-sources protocol; packs would ossify quickly |

## Decision

**Option A.** The `fixed_assets` module ships at **PHASE-026** with this policy:

1. **Categories map purposes before use (BR-041)**: an asset category binds the three
   posting purposes `FIXED_ASSET`, `ACCUM_DEPRECIATION`, `DEPRECIATION_EXPENSE` onto the
   tenant's CoA before any asset may post (plus `ASSET_DISPOSAL_GAIN`/`ASSET_DISPOSAL_LOSS`
   and `REVALUATION_RESERVE` where used).
2. **Depreciation posts only via runs (BR-042)**: monthly `depreciation_runs` (one journal
   per run, lines per asset — G-22); runs are period-locked; **no manual asset journals**
   exist in the module.
3. **NBV floor at salvage value (BR-043 / INV-023)**: for every asset,
   Σ depreciation ≤ cost − salvage_value; NBV ≥ 0 always; disposal happens once, only from
   status ACTIVE/FULLY_DEPRECIATED, and locks the asset.
4. **Revaluation is optional, audited, and goes to `REVALUATION_RESERVE` (BR-044)**:
   `asset_revaluations` post the delta to the reserve — never through P&L.
5. **Depreciation methods**: `STRAIGHT_LINE`, `DECLINING_BALANCE`, `UNITS_OF_PRODUCTION`
   (per category default, per asset override before start).
6. **No country-specific tax-depreciation automation**: useful-life/method defaults are
   tenant-configured; the platform ships **zero fabricated jurisdiction rules**. If a
   jurisdiction pack later adds verified conventions, that happens under the compliance
   folder's official-sources protocol — not by hard-coding here.

## Consequences

- Tables `asset_categories`, `assets`, `depreciation_runs`, `depreciation_lines` (🔒),
  `asset_disposals`, `asset_revaluations` land at PHASE-026 per
  [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §C; feature keys
  `fixed_assets.*` (7) per §D; reports `asset-register`, `depreciation-schedule`,
  `movements` per §J.
- Golden postings G-21 (capitalization), G-22 (monthly run), G-23 (disposal with loss
  mirror) join [../../accounting/JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7;
  all postings flow through the engine with source/operation keys and INV-013 idempotency.
- INV-023 becomes part of the invariant suite tested at PHASE-026 (per the register §G).
- FR-ACC-009's v1.1 priority **3** is superseded by the v2.0 stage plan: the requirement is
  delivered at PHASE-026 (post-GA), per PRODUCT_REQUIREMENTS' v2.0 areas (FIX).
- Tax-book divergence (if a tenant needs it) is manual/parallel bookkeeping today; any
   automation waits for a verified jurisdiction pack and a linked record here.

## Revisit conditions

- A design partner proves a need for **component accounting** (sub-assets with separate
  lives) → amendment record; not in scope at PHASE-026.
- A jurisdiction pack with **officially verified** depreciation conventions is approved →
  optional defaults may ship as pack configuration (still tenant-configured, never forced).
- Evidence that UoP usage tracking is widely unused after two releases → consider
  deprecating the method for new categories (amendment, not silent).

## Approval

ACCEPTED 2026-10-28 — product owner, under the platform-expansion umbrella record
([product/DR-003](../product/DR-003-platform-expansion-v2.md)); the accounting domain
owner countersigns the NBV floor and run-only depreciation as invariant-grade policy
(INV-023 / BR-042).
