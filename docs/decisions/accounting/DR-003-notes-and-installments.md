# DR-003 — Notes & Installments: PDC Lifecycle, Exact Dishonor Restoration, Flat-Fee Plans

> **Status:** ACCEPTED · **Owner:** Accounting Domain Architecture · **Updated:** 2026-10-28 ·
> **Date:** opened 2026-10-28, accepted 2026-10-28 ·
> **Approver:** Product Owner (author: Accounting Domain Architecture) ·
> **Source:** [ED-03](../../EXPANSION_REGISTER.md) (Blueprint v2.0) ·
> **Related:** [INV-024](../../accounting/ACCOUNTING_INVARIANTS.md),
> [BR-045…BR-049](../../product/BUSINESS_RULES.md),
> G-24…G-28 golden postings ([../../accounting/JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7),
> assumption A-014, [OQ-002](../../ASSUMPTIONS_AND_OPEN_QUESTIONS.md), PHASE-027,
> umbrella record [product/DR-003](../product/DR-003-platform-expansion-v2.md)

## Context

v1.1 deferred cheque management twice: `treasury.cheques` was a deferral note in PHASE-008
carried toward PHASE-012 (assumption A-014 — payment-method status tracking only), and the
comparative research shows PDC (post-dated cheque) handling is **table stakes** in the
leading Arabic-market systems — a credit-informal market that runs on post-dated cheques
and promissory notes (الشيكات المؤجلة والسندات الإذنية). Blueprint v2.0 terminates the
deferral chain: cheques are delivered by the new **`notes`** module (ED-03), alongside a
new **`installments`** module, both at **PHASE-027**.

Two policy hazards shape this record:

- **Custody vs. journal truth**: a note in custody is not cash; endorsement (تظهير) is a
  custody movement, not a financial effect. The ledger must track custody exactly, but
  only journal on the events that move money or receivables — otherwise the AR subledger
  and the PDC calendar lie to each other.
- **Riba (interest) avoidance**: installment sale plans in the target market must not be
  interest-bearing instruments. The platform computes **flat fees**, never interest.

## Options

| Option | Shape | Pros | Cons |
|--------|-------|------|------|
| **A. Notes module with event log + installments with flat fees (adopted)** | `notes` (cheques & promissory notes, event-sourced custody, PDC calendar, endorsement, dishonor, discounting) + `installments` (plans, schedules, late-fee policies) | Closes the market table-stakes gap with engine-only postings; custody state machine is fully auditable; riba-free by construction | Two modules instead of one treasury add-on — deliberate separation of instrument vs. receivable plan |
| **B. Extend `treasury.cheques` into the full module** | Grow the v1.1 placeholder key | Smaller surface change | The deferral chain (008→012) was never designed for maturity calendars, endorsement chains, or dishonor restoration; retrofit risks under-specified postings; feature-key naming would mislead (cheques ≠ all notes) |
| **C. Notes only; installments via generic credit terms** | PDC without plan machinery | Less to build | Installment schedules (BR-048/049, tuition/large-ticket commerce) are a table-stakes requirement; credit-term fields cannot model dues, aging, and late fees honestly |

## Decision

**Option A.** The modules `notes` + `installments` ship at **PHASE-027** with this policy:

1. **The v1.1 `treasury.cheques` deferral chain (008→012) terminates here** (ED-03): the
   existing feature key is re-pointed to PHASE-027 with the note "delivered by the `notes`
   module (accounting DR-003, ED-03)". No v1.1 tenant-visible promise is broken — v1.1
   shipped only payment-method status tracking (A-014), which stays untouched.
2. **PDC calendar (BR-045)**: notes require partner + maturity date; the maturity calendar
   is auto-derived from note maturity dates (report `notes.maturity-calendar`) — no manual
   maintenance.
3. **Custody events journal only at money moments**: receipt into custody (G-24),
   collection at maturity (G-25), dishonor (G-26), issue (G-27), issue-paid mirror,
   discounting (with `NOTES_DISCOUNT_EXPENSE`), return. **Endorsement moves custody
   without a journal (BR-047)** — journal only on collect/dishonor/return/discount.
4. **Dishonor restores AR exactly (INV-024 / BR-046)**: a dishonored received note
   restores the AR open item exactly (amount + references), requires a reason, and may
   post the bank fee via the existing `BANK_CHARGES` purpose. A dishonored note carries
   zero `NOTES_RECEIVABLE` balance and no silent residual.
5. **Installment plans are flat-fee only — NO interest computation (explicit, riba
   concern)**: a plan is defined by source document total, down payment, count,
   frequency, and due dates (BR-048: plan total must equal the source document total;
   schedule immutable after activation). The platform computes **no interest, no implicit
   rate, no time-value-of-money charge** — any finance charge a tenant charges must be a
   **flat, disclosed fee** on the plan.
6. **Late-fee policy per plan (BR-049)**: rate + cap + grace per plan, with **PLACEHOLDER
   product defaults** belonging to the OQ-002 decision family — no default is a legal
   statement; postings go only through the engine (G-28: DR `AR_CONTROL` · CR
   `LATE_FEE_INCOME`).

## Consequences

- Tables `notes`, `note_events` (🔒), `installment_plans`, `installment_lines` land at
  PHASE-027 per [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §C; feature
  keys `notes.*` (7) + `installments.*` (5) per §D; reports `notes.maturity-calendar`,
  `notes.aging`, `notes.dishonored-register`, `installments.schedule`,
  `installments.aging` per §J.
- INV-024 (custody equals journal effects) joins the invariant suite; G-24…G-28 join the
  golden postings; every posting flows through the engine (INV-006/013, idempotent
  operations) — the note event log itself is append-only (INV-003-style guards on
  `note_events`).
- The **riba exclusion is a product boundary**, not a technical limit: any future
  interest-bearing product requires a new decision record with religious/compliance
  review and is expected to remain out of scope permanently.
- New CoA purposes `NOTES_RECEIVABLE`, `NOTES_PAYABLE`, `NOTES_DISCOUNT_EXPENSE`,
  `LATE_FEE_INCOME` (register §E) are tenant-mapped before use, like all purposes.
- Education/healthcare shells (PHASE-031/032) consume `installments.plans` for tuition
  installments — this record is the policy base for those template workflows.
- Late-fee numeric defaults stay PLACEHOLDER until the OQ-002 family resolves them;
  enabling a plan without a policy set requires explicit tenant action (never a silent
  default rate).

## Revisit conditions

- Bank guarantee/LC (خطاب ضمان) requests appear from design partners → new record; not a
  note.
- A jurisdiction mandates regulatory treatment of dishonored-cheque reporting (none known
  at decision time) → compliance-folder record with official sources; nothing fabricated
  here.
- Demand for interest-bearing plans → expected permanent rejection; if ever entertained,
  a new record must pass religious/compliance review first.

## Approval

ACCEPTED 2026-10-28 — product owner, under the platform-expansion umbrella record
([product/DR-003](../product/DR-003-platform-expansion-v2.md)); the accounting domain
owner countersigns INV-024 and the flat-fee-only boundary as invariant-grade policy.
