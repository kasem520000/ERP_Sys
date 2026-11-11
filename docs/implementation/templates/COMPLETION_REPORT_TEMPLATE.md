# Completion Report — PHASE-NNN

> **Status:** TEMPLATE (not a living document — no Status line of its own when copied;
> completed reports use the standard `> **Status:** COMPLETE · **Updated:** <date>` header)

> **Template:** every implementing agent MUST produce this report at
> `docs/implementation/phases/reports/PHASE-NNN-COMPLETION.md` before marking a phase
> COMPLETE. Fields may not be omitted; write "none" where empty. **A report may not
> claim success when critical tests failed or were skipped without explicit
> justification.** Evidence beats adjectives (directive §22).
> **v3.1 (CR-48):** the Mandatory code-evidence checklist (below) is a hard gate —
> a report without it is INVALID and the phase stays IN_PROGRESS. The triple-flip rule
> applies: phase doc header + IMPLEMENTATION_STATUS row + this report flip TOGETHER.

## Report fields (all mandatory)

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-NNN · ISO date of completion |
| **Summary** | What was built, in plain language (≤ 200 words) |
| **Files created** | Paths (grouped by app/package) |
| **Files changed** | Paths + why |
| **Database migrations** | Migration file names + one-line purpose each |
| **API changes** | Endpoints/contracts added/changed/removed |
| **UI changes** | Screens/components added/changed |
| **Security changes** | New permissions, RLS tables, rate limits, attack tests added |
| **Tests executed** | Exact commands run |
| **Actual test results** | Counts (pass/fail/skip), duration; failures listed with justification or fix |
| **Build results** | Typecheck/lint/build status per app |
| **Invariants covered** | INV-xxx with test names (if applicable) |
| **Acceptance criteria verification** | Criterion-by-criterion table: PASS/FAIL + evidence pointer |
| **Evidence** | Command outputs, CI run links, file listings (paths), screenshots only as secondary |
| **Known limitations** | Honest list |
| **Deferred work** | Items intentionally deferred + where recorded |
| **Documentation updated** | Files updated (status, catalog, changelog…) |
| **Risks** | New risks added to RISK_REGISTER (RISK-xxx) / changed ratings |
| **Rollback instructions** | Exact steps to revert this phase safely |
| **Next eligible phase** | Phase ID + confirmation prerequisites are met — do NOT implement it |

## Mandatory code-evidence checklist (v3.1 / CR-48 — the report is INVALID without every row)

Copy this table into the report and fill it with **exact, verifiable pointers** —
numbers and paths a reviewer can check in one jump. "None this phase" is a valid entry
only when the phase genuinely adds none of that kind.

| Evidence | Required content | This phase
|---|---|---|
| **New tables** | Table name → `apps/api/src/db/schema.ts` **line number** of its `pgTable` (and the migration file that creates it) | |
| **Migrations** | Every new migration file name (e.g. `0055_rma_warranty.sql`) + one-line purpose + resulting `schema_version` | |
| **Drizzle mirror** | Confirmation the Drizzle journal/spec row exists for each migration (path) | |
| **Web pages** | Every new/changed page path under `apps/web` (and mobile/desktop surfaces if touched) | |
| **Test files** | Every new test spec path **with its test count** (e.g. `rma.lifecycle.db.spec.ts — 14 tests`) | |
| **Permissions** | The permission keys added (list) + the before→after seed count (e.g. 256 → 263) | |
| **Reports** | New report contract keys + the registry before→after count | |
| **Goldens / rules** | New G-xx golden IDs and BR-xx rule IDs with the docs file they were registered in | |
| **i18n** | AR/EN dictionary before→after key counts (web + mobile where applicable) | |
| **Feature flags** | New feature keys + the catalog file rows | |

## Quality gate (reviewer checklist before accepting the report)

- [ ] Every acceptance criterion has PASS evidence (not promises)
- [ ] **The mandatory code-evidence checklist is complete with verifiable pointers (v3.1)**
- [ ] Tests green in CI — not just locally
- [ ] No failing/skipped critical tests without written justification
- [ ] Docs updates actually merged (status file, changelog, catalog/ERD sync)
- [ ] **The triple-flip is complete: phase doc header + IMPLEMENTATION_STATUS row (incl. its own header line) + this report — all three together (v3.1/CR-48)**
- [ ] Security checklist for new tables/routes completed
- [ ] Rollback instructions exercised or at least dry-verified where feasible
- [ ] Report placed at the required path and linked from IMPLEMENTATION_STATUS
