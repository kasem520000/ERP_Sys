# Gap Layer-3 Directive — Owner Approval + Task F + PHASE-039 Go (2026-11-11)

> **Status:** ACCEPTED — EXECUTED (roadmap v3.2, CR-49…CR-52) · **Kind:** owner
> directive, preserved per the no-conversation-memory rule (CR-47) · **Authority:**
> Product Owner, final — no decision in this document requires further approval.
> **Outcome:** [GAP_ANALYSIS_LAYER3_RESIDUAL.md](../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md)
> (the 15 items, R-01…R-15) · [COMPLETENESS_REGISTER.md](../planning/COMPLETENESS_REGISTER.md)
> (CR-49…CR-52) · [COMPLETENESS_ROADMAP.md](../planning/COMPLETENESS_ROADMAP.md) (v3.2).

## 0. الموافقات أولاً (the approvals, as received)

1. **The L1-01…L1-23 numbering (CR-41) is FINALLY APPROVED** — the `N` family is
   genuinely taken and the citation friction would have been permanent. The decision
   is final and not open to discussion from this point on.
2. One formal note on the previous delivery: **line 101 of
   `ROADMAP-V3.1-CONSOLIDATION.md` said "15/26" while the detail tables give 17/24**
   — corrected in the first commit after this directive (the v3.2 commit).
3. The consolidation delivery was excellent and met every acceptance criterion —
   continue with the same discipline (CR-36 + the three v3.1 rules: the
   code-evidence checklist, the three-together-or-nothing completion flip, and no
   knowledge living in conversations).

## 1. Context — the final independent sweep of the v3.1 plan

The owner independently reviewed the consolidated plan against the standards and
domains that entered no previous audit round. The result: functional and commercial
coverage is comprehensive, **but 15 items remained** (11 standards/functional +
4 UX/productivity) absent from any phase. The owner resolved all of them **by final
decision in this directive** — executed as received under **CR-47** (identifier +
severity + effort + phase home in the same commit, `R-xx` family, in
[the Layer-3 file](../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md) +
roadmap §6.5 + the register). No re-proposal and no further approval was required.

## 2. The standards/functional decisions

**Added now to their phases' scope (phase doc + roadmap §6.5 + register):**

| ID | Item | Decision (final) | Home | Effort |
|---|---|---|---|---|
| R-01 | **ECL allowance (IFRS 9)** — simplified aging matrix generating the receivables allowance with a periodic posting | Added — high; the strongest remaining accounting gap | **066** | ~1.5 w |
| R-02 | **Dual-book** (local Zakat ↔ IFRS) — a second base layer: book-tagged reconciliation entries + dual reporting | Added — high; a recognized Saudi/Gulf requirement | **053** | ~2–3 w |
| R-03 | **Supplier RMA** — return authorization to the supplier → automatic debit note through the posting engine (the customer-RMA mirror) | Added — mandatory before any 039 code is written | **039** | ~1 w |
| R-04 | IAS 23 borrowing costs — capitalizing construction financing | Added — low | **048** | ~0.5 w |
| R-05 | IAS 33 earnings per share (EPS) | Added — low | **054** | ~0.5 w |
| R-06 | IAS 34 interim reporting | Documentation only: SHIPPED-BY-DESIGN via arbitrary periods — bind the ID to the periods/reporting-engine evidence | binding | ~0 |
| R-07 | **Intercompany trade** — auto-matched PO↔SO between entities + intercompany clearance statement | Added — medium; the natural completion of consolidation & charged eliminations | **053** | ~2 w |
| R-08 | Central DMS | **COVERED BY PLAN** — 062 scopes "ECM-style document folders/versions"; bind the ID only | 062 | 0 |
| R-10 | Fleet depth (fuel/violations/licenses) | **Light version only**: vehicle document expiry (license/insurance/inspection) + odometer counter inside CMMS; full fuel & violations management = sectoral non-goal | **049** | ~0.5 w |

**Owner non-goals (recorded in the register with justification — never planned):**

| ID | Item | Justification |
|---|---|---|
| R-09 | Product configurator (CTO/CPQ) | An independent product category; alternatives: BOM variants (042) + custom fields (036) — revisit after 065 if needed |
| R-11 | IAS 41 biological assets at fair value | Rarely applicable; the agriculture template works on historical cost + shrinkage accounts and stays as `agriculture.md` documents it |

## 3. The UX/productivity additions (062/064 reviewed in full — these four were the absent ones)

| ID | Item | Home | Effort |
|---|---|---|---|
| R-12 | **Calendar view** for invoices/aging/visits/leaves (table↔calendar toggle) | **062** | ~0.5 w |
| R-13 | **Route & customer maps** — route visits and customer points on a map (field-sales distribution 017/060) | **062** | ~1 w |
| R-14 | **Paste from Excel** inside line grids (invoices/orders/entries) — among the most-requested ERP productivity features | **062** | ~1 w |
| R-15 | **Invoice-by-email** — forward a supplier-invoice email → OCR (064) → AP draft | **064** | ~0.5 w |

## 4. What was executed, in order

1. **Task F complete (documentation only — no production code):** the Layer-3 file
   created with the 15 items and their final decisions exactly as received — no
   re-proposal, no waiting.
2. Updated: the affected phase documents (039/048/049/053/054/062/064/066) with the
   new scope items · roadmap §6.5 + §3 table + effort estimates ·
   `COMPLETENESS_REGISTER.md` (CR-49 and following) · `RISK_REGISTER.md` · the honest
   total re-estimate (**+11–12 weeks** — announced explicitly; see CR-52) · line 101
   of the v3.1 consolidation report. **R-03 alone affects the immediate scope** — it
   entered PHASE-039's document and moved its estimate to **~4 weeks**.
3. `python3 scripts/validate_docs.py` run — all checks PASS mandatory (extended with
   the Layer-3 artifacts check).
4. One commit: `roadmap: v3.2 residual layer (R-01…R-15) — owner decisions applied`,
   pushed to GitHub.
5. **PHASE-039 (Returns & Collections) started immediately** with its full extended
   scope: H-12/H-13/S-14…16 + L1-10/L1-11/L1-12 + **R-03** (~4 weeks) per
   CR-09/CR-46/CR-50, under every v3.1 rule (code evidence mandatory in the
   completion report; the three together or nothing).

## 5. Standing rules (binding reminder)

- Every gap discovered in the future — from any review or conversation — is recorded
  immediately per CR-47 in the same commit. Knowledge living only in a conversation
  is a defect.
- Nothing from any conversation may be relied upon without being documented in a
  file; **this very directive is preserved as this document** and entered the
  repository in the v3.2 commit.
- Credential security: the PAT lives in git commands only — writing it into any
  file, commit, or archive is forbidden. (Rule recorded here as a rule; this
  document contains no secret material.)
- On 039 completion: report with code evidence + the header flip + the status row +
  the delivery zip — then stop and notify the owner before PHASE-040.

## 6. The strategic summary (as received)

The plan is now **34 phases + 15 new items** — the last gaps an independent review
could prove. After Task F the plan is **comprehensive in the full sense at the
planning level**, and every future discovery is caught automatically by the CR-47
protocol. Execution is what remains (single-agent estimate ~**147–197 weeks total,
~132–183 remaining** after the delivered 035–038 — the honest v3.2 re-estimate,
CR-52), and PHASE-039 is the next step.
