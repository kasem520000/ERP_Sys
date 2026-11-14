# ID Ledger — Canonical Identifier Reservations (G / INV / BR)

> **Status:** ACTIVE · **Created:** 2026-11-13 (the PHASE-044 post-closure audit
> wave — before PHASE-043 starts) · **Checker:** `pnpm check:id-ledger`
> (`scripts/check-id-ledger.ts`, self-test: `pnpm check:id-ledger -- --self-test`)
> · **Rule zero:** an IMPLEMENTED id is NEVER renumbered — corrections ride
> errata notes, not renumbering.

## 1. Sources of truth (what "implemented" means)

The checker parses the three canon documents at run time — the ledger never
duplicates their rows, only counts them for the operator:

| Family | Canon document | Row shape | Implemented through |
|---|---|---|---|
| Goldens `G-xx` | [../accounting/JOURNAL_RULES.md](../accounting/JOURNAL_RULES.md) §7 | `\| G-xx \| … \| PHASE-0yy \|` | G-01…G-49 (through PHASE-043) |
| Invariants `INV-xxx` | [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md) | `\| INV-xxx \| … \|` | INV-001…INV-030 (through PHASE-043) |
| Business rules `BR-xxx` | [../product/BUSINESS_RULES.md](../product/BUSINESS_RULES.md) §"the register" | `\| BR-xxx \| … \|` | BR-001…BR-081 (through the PHASE-043 completion round) |

## 2. Reservations (the coordinated ladder — 2026-11-13)

The plan documents were authored 2026-11-10 with per-phase id guesses that the
039–044 waves then consumed (the 042/044 precedent: final numbers are taken at
implementation time from the next FREE slot). This table is the single
coordinated reservation: it shifts every future claim onto the next free
slots after the implemented inventory, with NO gaps and NO overlaps inside a
family. A phase may take FEWER slots than reserved (scope cut at
implementation); it may never take another phase's slot.

*(2026-11-13, wave 2 errata: the descriptive names in this table were
re-verified against the actual phase-doc titles — 046 HR Payroll, 047 HR
Growth, 048 Projects & Contracting, 049 CMMS, 053 Accounting Depth &
Treasury, 054 Tax & Corporate Compliance, 057 BI & Analytics, 058 Enterprise
Identity & Governance, 059 Platform Operations & Trust, 060 Sales & CRM
Depth, 061 POS & Retail Depth, 062 UX Excellence & Document Design, 063 Gulf
& Arabic Differentiators. The reservations themselves are UNCHANGED — name
corrections never move a slot.)*

| Phase | Goldens | Invariants | Business rules | Was (the stale plan) |
|---|---|---|---|---|
| ~~PHASE-043 (MRP)~~ **DELIVERED 2026-11-13** — its slots are now IMPLEMENTED (G-47…G-49 · INV-030 · BR-078…080; see §1) and no longer reservations | — | — | — | G-44…G-46 · INV-028 · BR-061…063 (all consumed by 039–044) |
| PHASE-045 (HR Core) | G-50…G-51 | INV-031 | BR-082…BR-084 | ~~BR-081…BR-083~~ (BR-081 taken by the 043-completion round — the reservation hard protection, re-coordinated 2026-11-14; the original plan's BR-068…070 were already consumed by 039–042) |
| PHASE-046 (HR Payroll) | G-52…G-54 | INV-032 | BR-085…BR-087 | G-53…G-55 · INV-031 · BR-071…073 (consumed by 039–042/044); ~~BR-084…086~~ shifted +1 by the 043-completion round's BR-081 (re-coordinated 2026-11-14) |
| PHASE-047 (HR Growth) | — | — | BR-088…BR-091 | BR-057…060 (consumed by 036/037); ~~BR-087…090~~ shifted +1 by the 043-completion round's BR-081 (re-coordinated 2026-11-14) |
| PHASE-048 (Projects & Contracting) | G-55…G-58 | INV-033 | BR-092…BR-096 | G-56…G-59 · INV-032 · BR-061…065 (consumed by 037–040); shifted +1 by the 043-completion round's BR-081 (re-coordinated 2026-11-14) |
| PHASE-049 (CMMS) | G-59…G-61 | INV-034 | BR-097…BR-100 | G-60…G-62 · INV-033 · BR-066…069 (consumed by 040/042); shifted +1 by the 043-completion round's BR-081 (re-coordinated 2026-11-14) |
| PHASE-050 (QMS) | G-62…G-63 | INV-035 | BR-101…BR-104 | G-63…G-64 · INV-034 · BR-070…073 (consumed by 042/044); shifted +1 by the 043-completion round's BR-081 (re-coordinated 2026-11-14) |
| PHASE-051 (FTL) | G-64…G-66 | INV-036 | BR-105…BR-108 | G-65…G-67 · INV-035 · BR-074…077 (consumed by 044); shifted +1 by the 043-completion round's BR-081 (re-coordinated 2026-11-14) |
| PHASE-052 (Workflow) | G-67 | INV-037 | — | G-68 · INV-036 |
| PHASE-053 (Accounting Depth & Treasury) | G-68…G-70 | INV-038 | — | G-69…G-71 · INV-037 |
| PHASE-054 (Tax & Corporate Compliance) | G-71…G-72 | INV-039 | — | G-72…G-73 · INV-038 |
| PHASE-055 (API platform) | — | INV-040 | — | INV-039 |
| PHASE-056 (Payments) | G-73…G-74 | INV-041 | — | G-74…G-75 · INV-040 |
| PHASE-057 (BI & Analytics) | — | — | — | none |
| PHASE-058 (Enterprise Identity & Governance) | — | INV-042 | — | INV-041 |
| PHASE-059 (Platform Operations & Trust) | — | — | — | none |
| PHASE-060 (Sales & CRM Depth) | G-75…G-76 | INV-043 | — | G-76…G-77 · INV-042 |
| PHASE-061 (POS & Retail Depth) | G-77…G-78 | INV-044 | — | G-78…G-79 · INV-043 |
| PHASE-062 (UX Excellence & Document Design) | — | — | — | none |
| PHASE-063 (Gulf & Arabic Differentiators) | G-79 | — | — | G-80 |
| PHASE-064 (AI) | — | INV-045 | — | INV-044 |
| PHASE-065…068 | — | — | — | none claimed |

**Coordination arithmetic** (the checker re-derives it): goldens — implemented
ends at G-49 (PHASE-043 delivered 2026-11-13); 045 takes 50–51, 046 52–54,
048 55–58, 049 59–61, 050 62–63, 051 64–66, 052 67, 053 68–70, 054 71–72,
056 73–74, 060 75–76, 061 77–78, 063 79 — contiguous, no overlap. Invariants —
implemented ends at INV-030 (PHASE-043 delivered); 045 031, 046 032, 048 033,
049 034, 050 035, 051 036, 052 037, 053 038, 054 039, 055 040, 056 041, 058 042,
060 043, 061 044, 064 045 — contiguous. Business rules — implemented ends at
BR-081 (the PHASE-043 completion round delivered — the reservation hard
protection); 045 082–084, 046 085–087, 047 088–091, 048 092–096,
049 097–100, 050 101–104, 051 105–108 — contiguous (every phase after 043
shifted +1 by the completion round's BR-081, re-coordinated 2026-11-14).

## 3. Cross-references (forward references between future phases)

A phase doc may reference ANOTHER future phase's reserved id when it builds on
its delivery (a reference, never a second claim). These are the blessed ones
after re-coordination — 046's references to 045's second golden move from the
stale G-52 to **G-51** (045's new reservation):

| In phase | References | Owned by |
|---|---|---|
| PHASE-046 | G-51 (045's leave-encashment settlement golden) | PHASE-045 |

## 4. Conventions

1. **Claim vs reference.** A CLAIM is a phase doc statement that the phase
   WILL ADD an id ("goldens G-xx… added to", "BUSINESS_RULES gains BR-xx…",
   "invariant INV-xx added", "Golden suites G-xx/G-yy with failure packs" in a
   task row). A REFERENCE is any other mention ("reuses the G-13/G-14 shapes",
   "excluded by design — G-80", "the BR-063 one-award law"). The checker's
   claim-context patterns implement this split **per CLAUSE, not per
   paragraph** (the wave-3 fix): the 043/045/046 posting-canon shape is ONE
   logical unit holding BOTH an old-plan reference note ("… — the original
   plan's G-44…G-46/INV-028/BR-061…063 predate …): ") and the phase's new
   claims ("goldens G-47 (…), G-48 (…) added to JOURNAL_RULES §7") — each
   clause is judged by its OWN markers (a marker-less clause inherits the
   unit verdict; an id within ±45 chars of a reference-only marker inside a
   claim clause — "… as the extension of the G-29 family" — stays a
   reference). A reference-only marker in one clause NEVER demotes another
   clause's claim: swapping a claim sentence's id for an implemented one is
   a STALE claim, caught at its file:line.
2. **Validity (the owner-based claim law — the 043-audit fix).** A claim of
   id X in phase P is judged by WHO owns X, never by P's delivery status:
   X implemented & owned by P → P's legitimate historical record (valid);
   X implemented & owned by another phase → STALE claim (the id already
   shipped under a different meaning — caught for ANY phase status; a
   delivered doc claiming a live golden of another phase is exactly the
   9b shape); X implemented with UNKNOWN ownership (the pre-ledger corpus —
   the INV/BR canon rows carry no per-row phase cell, and the G-01…20
   battery rows predate this ledger) → STALE for a FUTURE phase only (its
   ids are reserved, never implemented — a future claimant is provably
   wrong), conservative pass for delivered/unlisted phases (their own
   historical claims are indistinguishable from drift without ownership
   data — the honest boundary); X reserved by P → valid (P's live
   reservation); X reserved by another phase → CONFLICT; X in no ledger
   state → claim-unreserved. Ownership resolution: the canon's per-row
   `PHASE-0xx` cell (the G-21+ JOURNAL_RULES §7 rows), else the DELIVERED
   rows of §2 (the canonical record for every phase delivered after this
   ledger's creation — each delivered phase's row names its ids in the
   first cell). A reference is valid iff X is implemented or reserved by
   any phase; references to ids in NO ledger state surface as warnings
   (typos, stale cross-refs — reviewed by hand).
3. **Final numbers at implementation.** A reservation may shrink (scope cut);
   a phase takes the next free slot when it needs MORE than reserved — the
   implementing commit updates this ledger in the same change (the
   definitions, tests, acceptance criteria, and dependent references move
   together, per the audit's instruction).
4. **No renumbering implemented records.** Ever. Corrections to implemented
   ids ride errata notes in the owning documents.
5. **Shorthand ranges.** Both `G-47…G-50` and `BR-068…070` forms expand to
   their full spans (the checker understands both).

## 5. The check protocol

- `pnpm check:id-ledger` — parses the canon docs (§1) + this ledger's §2/§3 +
  every `docs/implementation/phases/PHASE-*.md`, expands the shorthand ranges,
  classifies claims vs references, and fails (exit 1) on: a stale claim (an
  implemented id claimed as new), a reservation overlap, a claim outside its
  phase's reservation, or a §3 cross-reference that does not resolve.
- `pnpm check:id-ledger -- --self-test` — injects SYNTHETIC-FIXTURE probes
  (the 043-audit fix: probes 1/5/8 now carry their own synthetic
  reservation world — ids in the 880+ range no canon will ever reach and
  synthetic phases — so they can never break on a real phase's delivery;
  probes 9/9b/9c/9d replay the REAL 043/045/046 posting-canon paragraphs
  and hold under the owner-based law across BOTH statuses of their
  phases): the clean text claims its reserved ids with the old-plan note
  staying references, and the mutated claim sentence (G-47/G-50/G-52 → the
  implemented G-44) is REJECTED as a stale claim while the same G-44 inside
  the old-plan note remains a legitimate reference. The negative proof on
  the REAL scan path: mutating PHASE-043.md's T-17 claim G-47→G-44 fails
  the plain scan with `stale-claim … already implemented (PHASE-044)`. The
  self-test rides the local gate AND the CI quality job (the 043-audit fix
  — CI previously never ran this check).
