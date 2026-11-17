# Statutory Verification Register

> **Status:** LIVING REGISTER · **Owner:** Product Owner (verifications) / the owner's
> verifier (official-source fetches) · **Established:** 2026-11-17 (PHASE-046 W-7/T-15,
> CR-16) · **Discipline:** BR-085 + BR-055 ([../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md))

Every seeded statutory row's provenance lives here: the source citation, the status,
the reviewer and date, and the BLOCKING EFFECT while unverified. The register is the
human-readable mirror of the machine verification records carried on the rows
themselves (`source_name` / `source_ref` / `verified_at` / `review_note` — the 0089
VERIFIED⟺source CHECK makes a VERIFIED row without a citation unrepresentable); the
ONE versioned source of the seeded shapes is `statutory-canonical.ts` (D-11's law —
one source, auditable, never a second hand-typed copy).

**The law (BR-085):** a REQUIRES_VERIFICATION row is NEVER selected by a payroll run —
the typed refusal + the audit event, zero residue. Only the verify act (permission
`payroll.statutory.verify`, owner-only, SoD-bound: the verifier ≠ the row's last
editor, the one-conditional-UPDATE CAS) flips a row to VERIFIED. Any correction to a
seeded figure lands as a SEED EDIT BEFORE the gates, never after (the plan §7(c) law).

## 1. KSA — GOSI (the social-insurance row-set, migrations 0092 + 0093)

The corrected schedule (the owner's PHASE-046 approval dispatch, 2026-11-16):
Saudi = employer 11.75% total (9% pension + 0.75% SANED + 2% OH) / employee 9.75%;
non-Saudi = OH-only (employer 2%, employee 0); the `GOSI-OH` row applies to ALL.

| Row | Rates (employee/employer) | Base window | Applies to | Status | Citation | Blocking effect |
|-----|--------------------------|-------------|------------|--------|-----------|-----------------|
| `SA · GOSI-PENSION` | 9.0000% / 9.0000% | 1,500 … **45,000** | CITIZEN | **VERIFIED** | PwC Worldwide Tax Summaries — "Saudi Arabia: Individual — Other taxes" (https://taxsummaries.pwc.com/saudi-arabia/individual/other-taxes — fetched 2026-11-16 21:34 UTC by the owner's verifier; page title "Saudi Arabia - Individual - Other taxes"): verbatim — "Social insurance contributions are paid monthly based on the monthly basic salary plus housing (paid or in kind) with an upper limit of SAR 45,000 … For Saudi employees, the rate is 21.5% and is paid by both the employee (9.75% = 9% social insurance + 0.75% unemployment insurance [SANED]) and the employer (11.75% = 9% social insurance + 2% occupational hazard + 0.75% unemployment insurance [SANED])." | none — posts out of the box on a KSA tenant |
| `SA · GOSI-SANED` | 0.7500% / 0.7500% | 1,500 … **15,000** | CITIZEN | **VERIFIED (rates)** — the 15,000 ceiling is OPEN (§4.1) | The same PwC source corroborates 0.75% + 0.75% and states the general SAR 45,000 contributory ceiling — but does NOT state the SANED-specific 15,000 ceiling | the RATES post; the 15,000 ceiling awaits the owner's official confirmation (§4.1) |
| `SA · GOSI-OH` | 0.0000% / 2.0000% | 1,500 … **45,000** | ALL | **VERIFIED** | The same PwC source: the 2% non-Saudi occupational-hazard rate paid by the employer AND the 2% inside the Saudi employer's 11.75%, with the SAR 45,000 upper limit on basic + housing | none — posts out of the box (the owner's corrected row) |

**Decision record (not the citation):** the owner's PHASE-046 approval dispatch
(2026-11-16) is WHY the schedule was corrected (the GOSI-OH row on ALL at 0%/2%; the
Saudi employer total 11.75% / employee 9.75%; the non-Saudi arm OH-only) — recorded as
the decision record on every row, no longer presented as the citation itself
(migration 0093, the reserved slot). The GOSI rates and the 45,000 ceiling are CLOSED.

**Contributory wage base:** basic + housing (the `["HOUSING"]` contributory keys — the
frozen structure snapshot at run time; `contributory_keys` is DATA, never hard-coded).

## 2. KSA — PIT (personal income tax brackets)

**No rows seeded — deliberately.** Saudi Arabia levies no employee personal income
tax on salaries; a jurisdiction without VERIFIED brackets computes ZERO PIT with the
explicit no-bracket note in the run (the honest state, never a fabricated schedule).
If an official schedule emerges, it lands through the normal seed-edit-before-gates
path + this register's row.

## 3. KSA — EOSB (the end-of-service award tiers, migration 0092)

| Row | Tier | Days/year | Status | Citation | Blocking effect |
|-----|------|-----------|--------|-----------|-----------------|
| `SA · EOSB 0–5y` | from 0 (inclusive) to 5 (exclusive) years | **15.00** | **VERIFIED** | Saudi Labor Law (Royal Decree M/51, as amended) — the end-of-service award; the phase document's own worked shape (half a month's wage per year for the first five years, a full month thereafter) | none — the fold posts (7 years × eosBase 9,000 → 5×15 + 2×30 = 135 days → 40,500.0000) |
| `SA · EOSB >5y` | from 5 years, open top | **30.00** | **VERIFIED** | The same source + worked shape | none |

**The official-text open item (§4.2):** the M/51 Art. 84 text itself is unreachable
from both environments (all Saudi government domains TCP-blocked from the delivery
sandbox AND the owner's verifier — the fetch attempts are documented in the W-1/W-2
gate evidence); the tiers are verified against the phase document's worked shape and
published implementations, and the official text remains one of the register's
exactly-two open items.

## 4. The open items (exactly two)

1. **The SANED-specific 15,000 ceiling** — PwC does not state it; the plan's D-01
   dual-cap basis seeded it; the owner's official confirmation is pending. Until
   confirmed, the row posts at its verified RATES with the ceiling as seeded — any
   correction lands as a seed edit before the gates.
2. **The EOSB official text** — Labor Law M/51 Art. 84 (the 15/30-days tiers);
   unreachable from both environments. The tiers post as verified against the worked
   shape; the official text's confirmation closes the item.

(The GOSI rates + the 45,000 ceiling are CLOSED — §1.)

## 5. AE / EG / JO — the blocked-state placeholders (migration 0092)

One 0-rate REQUIRES_VERIFICATION row per family per jurisdiction (contribution
profile `SOCIAL-INSURANCE`, PIT bracket `PIT-STANDARD`, EOSB tier 0/∞ × 0):

| Jurisdiction | Rows | Status | Blocking effect |
|--------------|------|--------|-----------------|
| AE (UAE) | profile + bracket + tier | **REQUIRES_VERIFICATION** | BR-085: a run selecting any row refuses the WHOLE calculation typed with the audit event and zero residue — no rate, cap, or tier is guessed |
| EG (Egypt) | profile + bracket + tier | **REQUIRES_VERIFICATION** | the same typed refusal |
| JO (Jordan) | profile + bracket + tier | **REQUIRES_VERIFICATION** | the same typed refusal |

**The owner's open item:** sourcing the official schedules for UAE / Egypt / Jordan
(and any additional market) — each pending verification is listed here with its
blocking effect explicit. The rows exist to SURFACE the blocked state; the tenant
enters the official figures and verifies them through the BR-085 act (owner-only,
SoD-bound, audited).

## 6. The verify act (how a row flips)

- **Permission:** `payroll.statutory.verify` — owner-only (the SoD law, D-10).
- **CAS:** one conditional UPDATE — a concurrent second verify collapses to one flip
  + the typed `STATUTORY_ALREADY_VERIFIED`; exactly one audit event.
- **SoD:** the verifier must differ from the row's last editor.
- **The flip requires the citation:** the 0089 CHECK (`VERIFIED ⟺ verified_at +
  source_name`) makes a citation-less flip unrepresentable.
- **The evidence survives rollback:** the refusal audits record in their own UoW
  (a fresh pooled connection).

## 7. Maintenance

- A correction to any seeded figure lands as a **seed edit BEFORE the gates** (the
  plan §7(c) law) — never a post-gate data patch.
- The register row + the canonical source (`statutory-canonical.ts`) + the migration
  records move TOGETHER (the one-source law).
- Every verification event is auditable (`payroll.statutory.verified`); this file is
  updated in the same change as the flip it records.

## Related

- [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) §"statutory rules" (BR-085…087)
- [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md) INV-032
- [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-52…G-54) + entry 17
- PHASE-046: [../../implementation/phases/PHASE-046.md](../../implementation/phases/PHASE-046.md)
  · the completion report · migrations 0089–0094
