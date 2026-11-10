# AGENTS.md — project instructions for AI coding agents

This file is the machine-discoverable entry point. The **authoritative** protocol
is [docs/handoff/AGENT_START_HERE.md](docs/handoff/AGENT_START_HERE.md) (15-step
mandatory protocol); the operating rules are
[docs/handoff/IMPLEMENTATION_PROTOCOL.md](docs/handoff/IMPLEMENTATION_PROTOCOL.md).

## Non-negotiables

1. **Implement exactly one phase per run.** The phase document under
   `docs/implementation/phases/` is the contract; its out-of-scope list is a set
   of prohibitions, not suggestions.
2. **Document precedence (Blueprint v1.1 consolidation):**
   `docs/ARCHITECTURE_BASELINE.md`, the ADRs (`docs/architecture/ADR/`), and the
   consolidation decisions CD-01…CD-12 (`docs/CONSOLIDATION_REGISTER.md`)
   supersede older detail documents on conflict. Record discrepancies in your
   report — never silently rewrite the baseline.
3. **Verify before building.** Run `pnpm docs:validate` (expect 23/23), inspect
   the real code, schema, migrations, and tests. Documentation may drift; do not
   trust it blindly (protocol step 8–9).
4. **Never weaken:** tenant isolation (RLS), the posting-engine monopoly
   (ADR-0007), accounting invariants INV-001…022, or auditability. Any
   ADR-bound change requires the full change-control process
   (IMPLEMENTATION_PROTOCOL.md §3) and product-owner approval.
5. **No binary floating point for money** (ADR-0009): all money/quantity/rate
   math goes through `@erp/domain-core`; constructing money from JS numbers is
   banned (runtime + ESLint).
6. **No fabricated compliance content:** jurisdiction work follows the
   verification ladder in `docs/localization/compliance-matrix/` — no tax rate,
   legal rule, or official API behavior is invented or marked verified without
   cited sources.
7. **Honesty rules:** never mark a phase COMPLETE without evidence; completion
   reports go to `docs/implementation/phases/reports/PHASE-NNN-COMPLETION.md`
   using the template; a claim without evidence is not a claim. Update
   `IMPLEMENTATION_STATUS.md`, `CURRENT_STATE.md`, `NEXT_ACTION.md`, and
   `CHANGELOG.md` at every phase completion.
8. **Do not commit secrets.** `.env` is gitignored and gitleaks runs in CI;
   `.env.example` carries dev-only placeholders.

## Verification gate (every phase)

`pnpm gate:local` — typecheck, lint (incl. boundaries), dependency-cruiser,
tests, build, docs validation, and the boundary negative meta-test. All green,
with outputs recorded in the completion report, or the phase stays
`IN_PROGRESS` (the Definition of Done is binary).
