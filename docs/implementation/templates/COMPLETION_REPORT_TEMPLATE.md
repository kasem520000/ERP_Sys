# Completion Report — PHASE-NNN

> **Status:** TEMPLATE (not a living document — no Status line of its own when copied;
> completed reports use the standard `> **Status:** COMPLETE · **Updated:** <date>` header)

> **Template:** every implementing agent MUST produce this report at
> `docs/implementation/phases/reports/PHASE-NNN-COMPLETION.md` before marking a phase
> COMPLETE. Fields may not be omitted; write "none" where empty. **A report may not
> claim success when critical tests failed or were skipped without explicit
> justification.** Evidence beats adjectives (directive §22).

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

## Quality gate (reviewer checklist before accepting the report)

- [ ] Every acceptance criterion has PASS evidence (not promises)
- [ ] Tests green in CI — not just locally
- [ ] No failing/skipped critical tests without written justification
- [ ] Docs updates actually merged (status file, changelog, catalog/ERD sync)
- [ ] Security checklist for new tables/routes completed
- [ ] Rollback instructions exercised or at least dry-verified where feasible
- [ ] Report placed at the required path and linked from IMPLEMENTATION_STATUS
