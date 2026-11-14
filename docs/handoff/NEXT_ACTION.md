# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-14 (the PHASE-043 completion round delivered the reservation hard protection (BR-081) — the head + evidence under the owner's review; PHASE-045 (HR Core) STARTED in parallel per the owner's directive — starting 045 is not 043-closure nor production approval)

## The single next action

**PHASE-043's completion round is delivered and pushed** — the reservation
hard protection (BR-081) is implemented + tested (the 10-test deterministic
spec, the before/after runs, the flipped pins, the rollback hardening); the
head + its evidence ledger await the owner's review. The remaining
unreserved-demand POLICY choice stays the owner's (RISK-032, open); RISK-031
and the async/progress deviation stay open.

**PHASE-045 (HR Core — Attendance, Leaves & Shifts) is STARTED** per the
owner's 2026-11-14 parallel directive (its kickoff + implementation carry
their own evidence and separate commits; the two phases' migrations, ids,
and shared files are coordinated through the ID_LEDGER — this round took
BR-081 and shifted every post-043 phase's BR slots +1, dated notes in every
phase doc; the DB test runs are sequential — the embedded-PG harness shares
one data dir, so the phases' suites never run concurrently on one machine).
Starting 045 is NOT closure of 043 and NOT production approval. Its prerequisite (035 ✓) has
been satisfied since Wave 1; nothing in HR consumes MRP directly (the payroll
variable-feed discipline mirrors the run-snapshot pattern 043 delivered — the
PHASE-043.md §8 handoff notes). Read [PHASE-045.md](../implementation/phases/PHASE-045.md)
first. Any other unblocked wave-2 phase remains eligible in parallel (046 waits
on 045; 047 on 046; 048 and 053+ per the roadmap).

## Post-PHASE-043 context for the next author (2026-11-13)

PHASE-043 (Manufacturing II — MRP & Planning, CR-13) is COMPLETE — the planning
brain the audit called the single most disqualifying manufacturing gap:
migrations `0074`–`0079` (schema_version 79; 11 tables — 10 RLS'd + the global
lot-sizing catalog; ENTITY_CATALOG 261 → 272), the deterministic MRP engine
(low-level codes depth-from-root, cycle typing, phantom Σ-preservation,
ROOT-component substitution, batch-aware carry, exact 4-dp netting), replayable
run snapshots (runs post nothing), the INV-030 idempotent one-click conversion
through the OWNING services (the PO via the 038 path, the MO BOM-pre-bound, the
transfer via inventory — 0079 is the link leg), MPS with the BR-078 frozen
fence, the BOR rough-cut warning law, ATP/CTP with the BR-080 hard exclusions
consumed by sales lines, the G-49 MTO chain, the G-48 tolling round trip
(1420/2136/5126), the G-47 joint allocation, the reservation policy engine over
the 044 strategies, the /mrp + /mps screens + the item-card planning tab, and
the two reports (registry 99 → 101). Permissions 287 → 291 (matrix §3.22);
goldens G-47/G-48/G-49 · INV-030 · BR-078…080 (planning goldens 12/12); i18n
5,767 keys/locale; the full DB suite 210 files / 3,095 green; OA-06 EXPLAIN
budgets 4/4. **Stage 13's CR-38 "full ERP" gate condition — MRP live — is now
satisfied; record its evidence in the gate checklist.**

**The honest notes for the next author:**

- **RISK-031 stays OPEN by decision** — the nightly INV-029 probe remains a
  NECESSARY aggregate condition, never a per-batch/per-serial integrity proof;
  043's netting consumes the aggregate fold and claims nothing stronger. The
  per-batch/per-serial recurring detector is future hardening exactly as the
  register records it.
- **The full DB suite keeps catching what isolated folders hide** — this phase
  it surfaced the G-49 golden straddling the WIP-GL as-of window (an in-flight
  100.0000 that matched control-to-subledger — status OK, diffCount 0, but the
  pinned absolute zero broke), the cycle-count shared-warehouse lottery, and the
  mail/CRM capture timing (PHASE-043-COMPLETION.md §4). Run it before every
  flip; isolated folders lie.
- **Server pages never VALUE-import the `@erp/ui` barrel** (the P5-T12 rule,
  `apps/web/lib/cx.ts`) — the 043 item-card tab broke the web build until the
  client bridge (`item-detail-tabs.tsx`) took the barrel import over. Reach
  interactive overlays through app-side client components.
- **Visual baselines are gitignored by design** — a fresh clone writes them on
  the first harness run then compares on the second (the documented first-run
  protocol); do not commit them.
- **The pure-kernel oracle tests earn their keep** — they forced three real
  design corrections (batch-aware carry, ROOT-component substitution, the LLC
  depth formula) before any golden ran. Keep new domain math pure-first.
- **Migration slots continue from 0080.**

The roadmap's Wave-2 order continues: 045/046 (HR) → 047 (Costing II) → 048
(Field Service) → … — see [MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md)
§Wave 2.
