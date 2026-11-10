# DR-016-02 — Card tenders debit a tenant-mapped CARD_RECEIVABLE (fail-closed until mapped)

> **Status:** ACCEPTED · **Owner:** Accounting Architecture · **Date:** 2026-11-02
> (decided in-phase) · **Approver:** Product Owner (accounting policy) · **Related:**
> [../accounting/CHART_OF_ACCOUNTS.md](../accounting/CHART_OF_ACCOUNTS.md) (purpose
> mapping), [../accounting/ACCOUNTING_INVARIANTS.md](../accounting/ACCOUNTING_INVARIANTS.md)
> INV-019, PHASE-007 purpose discipline, PHASE-016 §2 item 4 (split tenders, G-02)

## Context

A POS sale with a **card tender** must NOT debit the till drawer: no cash entered the
drawer, so INV-019 (till cash = Σ cash movements) requires the card leg to land
elsewhere. Migration `0024_pos_core.sql` therefore adds the additive CoA template row
`1151 CARD_RECEIVABLE` (card-settlement receivable) and the G-02 split-tender posting
debits cash → till, card → the account mapped to the `CARD_RECEIVABLE` purpose.
Existing tenants' charts were instantiated before this marker existed; the platform's
purpose resolution is deliberately fail-closed (`PURPOSE_NOT_MAPPED`, PHASE-007) and
never guesses an account.

## Options

| Option | Consequences |
|--------|--------------|
| **A. Default card tenders to the till cash account** | Dishonest drawer (INV-019 broken); Z report and shift counts disagree with physical cash |
| **B. Auto-create the account on first card tender** | Violates the tenant-owned CoA and the fail-closed purpose discipline; silent chart mutation |
| **C. Require a one-time tenant mapping; typed refusal until then** | Consistent with every other purpose; cash tenders unaffected; one admin action unblocks card sales |

## Decision

**Option C.** Card tenders require the tenant to map the `CARD_RECEIVABLE` purpose once
(existing tenants add the account + purpose mapping via `accounting.accounts.manage`;
new tenants get `1151` from the CoA template). Until mapped, a card tender fails closed
with the typed `PURPOSE_NOT_MAPPED` refusal and bilingual guidance — the same error
class every other unmapped purpose produces, never a fallback.

## Consequences

- The first card tender before mapping is a loud, typed failure with the resolving
  action — not a blocked checkout mystery; cash/mixed-cash tenders are unaffected.
- Once mapped, the Z report's tender split, `treasury.shift_cash_reconciliation`, and
  the till's INV-019 tie stay exact (card totals reconcile against `1151`, not the
  drawer).
- Phase-017 industry templates may carry the mapping as an onboarding hint; the
  accounting substrate itself is unchanged, so PHASE-020 needs no action — this record
  exists so later phases do not "fix" the fail-closed behavior by defaulting it.

## Approval requirements

Product owner sign-off (accounting policy default) + architecture owner counter-sign
(purpose discipline preserved); referenced from the PHASE-016 completion report and
SYNC_PROTOCOL §11's shipped note.
