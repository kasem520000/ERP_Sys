# Changelog

> **Status:** LIVING DOCUMENT — append-only, newest first · **Updated:** 2026-11-10 (PHASE-038 — Procurement Sourcing & Supplier Collaboration delivered)

Format: `DATE — item — type` where type ∈ {BLUEPRINT, PHASE-NNN, DOCS, BREAKING-ARCH, DECISION}.

- 2026-11-10 — **PHASE-038 — Procurement Sourcing & Supplier Collaboration — COMPLETE**
  (Blueprint v3.0 wave 1 / CR-08 — the audit's H-11 verdict resolved; evidence:
  [PHASE-038-COMPLETION.md](../implementation/phases/reports/PHASE-038-COMPLETION.md)):
  (1) migrations `0051`–`0054` (schema_version 54) — thirteen RLS'd tenant tables: the
  RFQ round (`rfqs`/`rfq_lines` OPEN/INVITED, `rfq_no` at ISSUE), supplier quotes
  (one per supplier per RFQ, re-submit replaces lines while open), the frozen award
  matrix (`quote_comparisons` — evidence written once, never recomputed; the
  one-live-comparison unique = the BR-063 DB floor), blanket agreements
  (`blanket_orders`/`blanket_releases` — transactional `released_amount`, releases
  mint the executable PO in-transaction; the additive NULLABLE
  `purchase_orders.contract_id` → crm.service_contracts), the collaboration cluster
  (`supplier_ratings`, `approved_supplier_items`, `supplier_advances`,
  `early_payment_discount_terms`), CAPEX + tenders (`capex_requests` with the 028
  budget guard advisory/enforced + the persisted evaluation snapshot,
  `tender_intakes` — intake records only). (2) two NEW goldens **G-33** (supplier
  advance disbursement + application — the tenant-mapped
  `purchasing.supplier_advance_control_account`, fail-closed when unmapped, BASE at
  rate 1, treasury via the store API INV-019 exact, supplier-level netting) and
  **G-34** (early-payment discount capture — once per invoice, POSTED payment +
  window + allocation verified). (3) the P-05 supplier-portal skeleton — ONE public
  endpoint (`POST /api/v1/portal/rfqs/:rfqId/quotes` in PUBLIC_ROUTES): scoped
  sha256-hashed tokens in `rfqs.portal_invites` (plaintext shown once), the SECURITY
  DEFINER `erp.portal_resolve_rfq_token` pre-GUC projection, re-validation under
  RLS, audited + rate-limited. (4) BR-062 (the 3-bid rule as tenant policy:
  ENFORCED/ADVISORY/OFF) + BR-063 (one award per round; awarding closes the RFQ)
  with traceability via `quote_comparisons.generated_docs` + PO line notes;
  scorecards fold delivery 40/quality 40/price 20 from LIVE documents (the
  `purchasing.scorecard-sweep` queue); the approved-vendor gate OFF/FLAG/BLOCK in
  pricing; matching gains `purchasing.match.tolerance_bands`. (5) web: the four
  sourcing screens (`/purchasing/rfq` + comparison/award matrix,
  `/purchasing/blanket-orders`, `/purchasing/supplier-scorecards`,
  `/purchasing/capex-requests`) + NAV_ITEMS §1.4 + command palette (OA-04). (6)
  reports +2 (`purchasing.rfq-award-matrix`, `purchasing.supplier-scorecard`;
  registry 86 → 88) + the RunService single-flight coalescing gate repair;
  permissions 249 → 256 (0051 §9, seven keys); feature keys +5; i18n
  4,699=4,699 (+163); ENTITY_CATALOG 204 → 217; isolation +13 tables (A1–A10);
  docs wave (BR-062/063 · G-33/G-34 + JOURNAL_RULES note 11 · DATA_DICTIONARY §17 ·
  FEATURE_CATALOG +5 · NAVIGATION_MODEL §1.4). Gates: typecheck 8/8 · lint 8/8 ·
  depcruise 0 · unit 1,414 · **DB 2,555/2,555 (176 files)** · build 8/8 · i18n
  parity · drift 256=256 · manifests 13 · token contrast · ui catalog · web-security
  6/6. Five recorded gate repairs + the notifications-email environmental item.
  Delivery: `ERP_PLATFORM_PHASE038.zip` (OA-07). Next: PHASE-039.

- 2026-11-10 — **PHASE-037 — ZATCA Phase-1 & QR Compliance — COMPLETE** (Blueprint
  v3.0 wave 1 / CR-07 — the audit's H-01 verdict resolved: Phase-1 is pure
  mathematical encoding, zero external APIs; evidence:
  [PHASE-037-COMPLETION.md](../implementation/phases/reports/PHASE-037-COMPLETION.md)):
  migration `0050` (the seven additive NULLABLE sales_invoices chain columns with
  the all-or-nothing stamp CHECK + the partial UNIQUE INV-027 floor; the RLS'd
  `zatca_devices` registry); the pure-computation core (TLV encoder with byte-pinned
  vectors, the `invoice-hash-v1` chain with the genesis PIH, the QR PNG/SVG
  renderer); post-transaction stamping (ICV under a row lock, PIH = predecessor
  hash) + the verification walk + the idempotent backfill + the daily pg-boss sweep;
  BR-060 fail-closed; the print templates v2 render a real scannable QR
  (Chromium-decoded to the exact payload — H-02 closed); the honest
  `ZatcaGenerationAdapter` (GENERATION only; submit = `ZATCA_PHASE2_NOT_IMPLEMENTED`
  with the GATE-1..4 checklist preserved); the `tax.e-invoicing-log` report v2; the
  `/settings/tax/zatca-devices` screen; permissions 248 → 249; i18n
  4,536=4,536 (+89); ENTITY_CATALOG 203 → 204; the GCC readiness matrix (DF-54) +
  `GATE-DISCIPLINE-ZATCA.md`. Gates green (typecheck 8/8 · lint 8/8 · DB full suite
  2,407/2,407). Three recorded gate repairs + one environmental item. Delivery:
  `ERP_PLATFORM_PHASE037.zip` (OA-07). Next: PHASE-038.

- 2026-11-10 — **PHASE-036 — Extensibility Core — Custom Fields — COMPLETE**
  (Blueprint v3.0 wave 1 / CR-06 — the audit's single most important functional gap
  FD-18/19/20 closed; evidence:
  [PHASE-036-COMPLETION.md](../implementation/phases/reports/PHASE-036-COMPLETION.md)):
  migration `0049` (five RLS'd tables — `custom_field_definitions`, the ADR-0019
  TYPED value store `custom_field_values` with the num_nonnulls=1 law, the picklist
  pair, `form_layouts` with the two partial uniques); the code-owned entity registry
  over the six first-wave entities; the ONE reusable value guard
  (validate-before-insert — zero partial writes; typed 400 packs; full-replace
  semantics) injected into all six entities' create/update/read paths; the
  `/settings/custom-fields` manager + picklist editor + BR-059 form designer; the
  shared CustomFieldSurface on the six forms; dynamic columns on the partner list.
  Permissions 245 → 248; i18n 4,290 → 4,447; ENTITY_CATALOG 198 → 203. Two recorded
  034-tree gate repairs (the reporting boot rule's missing
  `consolidation.reports.view`; the 0041 consolidation account/purpose pins).
  Delivery: `ERP_PLATFORM_PHASE036.zip` (OA-07). Next: PHASE-037.

- 2026-11-10 — **PHASE-035 — Activation & Truth Restoration — COMPLETE** (Blueprint v3.0's entry phase; evidence:
  [PHASE-035-COMPLETION.md](../implementation/phases/reports/PHASE-035-COMPLETION.md)): (1) migration `0048`
  (DATA-ONLY) — the `items.import_export` grant repair (EVAL-F-5): business+enterprise (starter keeps manual
  entry; the tier-4 precedent), schema_version 48, permissions drift 245=245, BR-040 closure 11/11. (2) three
  activation screens — `/inventory/batches` + `/inventory/serials` (List+Search; register + write-off /
  sold-at under `inventory.tracking.manage`) and the read-only `/inventory/adjustments` register (posting
  stays in the count wizard by design) — plus `reports.consolidated` as a CORE NAV_ITEMS entry (route
  `/consolidation`, template-independent); web i18n 4,290=4,290 / mobile 371=371. (3) `tax.e-invoicing-log`:
  registry 85 → 86; REPORT_CATALOG reconciled 86/86 (7 unlisted rows added, the sales.commissions_due
  duplicate removed); permission rides `tax.einvoicing.manage` (§12). (4) DR-035-01/02/03 — scheduled
  reports DEFERRED-057 (grant key preserved) · customer portal PLANNED-060 · platform.payouts DEFERRED-059.
  (5) repo hygiene: 251 generated files untracked, `.gitignore`, the ci-visual.yml guard, VISUAL_TESTING §5
  + README notes; the recorded pre-existing 034-tree gate repairs (0041 fresh-chain boot · include_from
  semantics · elimination INV-009 intercompany partner · isolation registry + 0041 tables · manifest/
  typecheck/lint — full ledger in the report); gates green: typecheck 8/8 · lint 8/8 · unit 1,386 · docs 32/32 · DB fresh-chain (migrations 7/7, entitlements 11/11, einvoicing-log 4/4, golden 86-pin, consolidation 22/22, isolation/RLS 1,095/1,095). Delivery: `ERP_PLATFORM_PHASE035.zip` (OA-07). Next: PHASE-036.

- 2026-11-10 — **BLUEPRINT v3.0 — THE COMPLETENESS PROGRAM (31 phases, PHASE-035…065,
  stages 12–15) — documentation-only planning delivery, zero code**:
  following the three independent audit reports delivered by the second reviewer
  (copied verbatim into `docs/planning/gap-analysis/` — `PROJECT_EVALUATION_2026-11-10.md`
  documenting 34/34 phases with 4 named screen gaps + 3 silent deviations;
  `ERP_COMPLETENESS_GAP_REPORT.md` grading the platform ERP-L3.2 at 72/100;
  `ERP_FULL_GAP_ANALYSIS.md` enumerating **495 numbered gaps** across 26 capability
  families), the platform now carries the authoritative completion plan:
  (1) **`docs/planning/COMPLETENESS_REGISTER.md`** — the v3.0 canonical register
  (CR-01…CR-40): 4 waves (Sellable Foundation 035–041 · Full-ERP Completion 042–051 ·
  Enterprise Platform 052–059 · Differentiation & Growth 060–065), the audit-exclusion
  decisions (the rental_logistics template + the marketing landing — both already
  delivered 2026-11-09 and never re-planned, CR-02), the confirmed-shipped surfaces
  (platform console / subscription+checkout / onboarding activity wizard, CR-04), the
  cross-cutting CR-36 discipline gates (SQL+Drizzle+ENTITY_CATALOG parity · permission
  zero-drift · AR/EN parity · docs:validate · RLS A1–A10 attack tests per new table ·
  feature-flag gating · offline sync-surface assessment), the identifier allocations
  (phases 035–065 immutable, stage groups 12–15, goldens G-33+ / INV-027+ / BR-057+
  continuation, gap-ID namespaces), and the owner additions OA-01…OA-07 beyond the
  audits (Arabic-Indic numerals · sync-fleet regression duty · SDAIA hosting note ·
  ⌘K coverage rule · demo tenants per template · per-table performance budgets · the
  per-phase archive delivery convention `ERP_PLATFORM_PHASE0NN.zip`).
  (2) **`docs/planning/COMPLETENESS_ROADMAP.md`** — the master index: the Arabic
  executive summary (§0) with the usage protocol («ابدأ تنفيذ المرحلة PHASE-0NN» →
  15-step protocol → per-phase archive), the 4-wave gate table, the 31-phase index with
  effort estimates, the complete **gap→phase mapping** (every one of the 495 audited
  gap IDs + EVAL-F-1…F-9 + owner additions, each with exactly one owning phase or an
  explicit exclusion/non-goal record), the mermaid dependency graph with the hard
  ordering rules, and the resumption protocol for interrupted phases.
  (3) **31 phase documents** `docs/implementation/phases/PHASE-035.md` … `PHASE-065.md`
  — each in the house 8-section format (Overview with bilingual executive summary ·
  Scope with entities/tables/feature-keys/gap-IDs · Prerequisites · Design Impact ·
  Implementation Plan tasks · 8–10 testable acceptance criteria ending with the
  completion-report + status-flip + archive-delivery criterion · Risks · Handoff),
  collectively specifying ~200 new tables, the full module surface (MRP, WMS, HR
  core/compliance/growth, projects & contracting, CMMS, QMS, foreign trade, workflow
  engine, accounting depth & treasury, tax compliance + ZATCA Phase-2 + ETA, public
  API & webhooks, payments & commerce, BI, SSO/governance, platform ops, sales/CRM
  depth, POS depth, UX excellence, Gulf differentiators incl. Hijri + Tafqeet +
  Murabaha + JoFotara, the opt-in AI copilot reversing non-goal #9 by decision CR-34,
  and the growth platform).
  (4) **Planning-doc truth updates**: MASTER_ROADMAP (stage table + v3.0 wave gates),
  IMPLEMENTATION_STATUS (the v3.0 NOT_STARTED ledger + the planning-completion note),
  NEXT_ACTION (rewritten — next eligible phase PHASE-035, the stale "next: PHASE-026"
  text gone), RELEASE_STRATEGY (the four v3.0 release tiers), AGENT_START_HERE (the
  v3.0 context paragraph + reading order), and `scripts/validate_docs.py` extended
  with check 8 (v3.0 artifacts: register + roadmap + 31 phase docs with canonical
  headings; phase-reference range widened 001–034 → 001–065).
  No v3.0 phase is implemented (CR-03 scope honesty) — all 31 are NOT_STARTED—PLANNED.
  Delivery: the repository state archived as `ERP_PLATFORM_PHASE034_FINAL.zip`
  (the planning-complete edition) per OA-07.

- 2026-11-09 — **THE DELIVERY COMPLETION (post-034 audit) — the marketing
  landing surface + the thirteenth industry template**:
  (1) **The marketing landing page (FR-PLT-007 / Journey A1 / ADR-0003)** —
  the public `/{locale}` root now renders the marketing site for anonymous
  visitors (previously a bare redirect to login): the hero with the
  "ابدأ مجاناً / Start free" CTA into registration, the PROJECT_VISION feature
  pillars, the LIVE industry-template registry section (read from the public
  register options endpoint — the single source of truth), the plans teaser
  (plan-seed prices verbatim with the OQ-002 placeholder badge), and the
  marketing footer; sessioned users keep the previous landing behavior
  verbatim. 38 new bilingual dictionary keys with full AR/EN parity, plus the
  login page's no-account → registration funnel link.
  (2) **`industry.rental_logistics` v1.0.0 — the thirteenth (final) template**
  (migration `0047_industry_rental_logistics.sql`, DATA-ONLY per the
  0044/0046 convention): the shell composes ONLY live granted feature keys
  (crm.service_contracts + crm.recurring_billing + the serial-tracked fleet +
  the live distribution routes/settlements pair), with four honest
  reconciliations recorded — REQUIRED keys → live keys (the deferred
  crm.rental_contracts / crm.contract_deposits / crm.late_fees /
  distribution.shipment_tracking intake pair NEVER granted, per the RISK-019
  decision record), report pins → live registry keys
  (inventory.serial-tracking / distribution.route_visit_compliance /
  services.contract_revenue_schedule / ar.aging — §J stays closed),
  navigation targets → live surfaces, and capability_prerequisites ≡ the
  CAPABILITY_MATRIX §1 RNT column STRICT both directions.
  `SHIPPED_TEMPLATE_MANIFESTS` 12 → **13**; the seven typed workflow-policy
  keys registered in the code-owned POLICY_REGISTRY; journal 46 → **47**
  entries (manifest + spec + drizzle `_journal.json` updated). The
  activity-map catalog extended 3 → **13 activities** (the onboarding
  wizard's free-text resolver now covers every shipped template, bilingual
  keywords both directions). Specs updated: capability-matrix-reconciliation
  (RNT strict + 13×13), industry-manifests (thirteen ids + the rental leg),
  template-prerequisites (three rental legs), migrations.spec (0047),
  activity-mapping (thirteen activities), layer-fixtures (thirteen
  manifests). Docs updated: INDUSTRY_CATALOG (rental row + the completion
  note), industries/README (all thirteen live), SUBSCRIPTION §3 (rental pack
  SHIPPED), IMPLEMENTATION_STATUS, this changelog. — PHASE-034 + DOCS

- 2026-11-09 — **THE RESTORATION MERGE — PHASE-001…034 UNITED IN ONE
  BUILD (the final-project consolidation)**: the stage-9/10 siblings 028–031 (budgeting /
  payroll / wholesale+electronics templates / healthcare), lost to environment resets on
  the surviving lineage (recorded honestly as NOT_STARTED through the 032–034 entries),
  were RESTORED from the uploaded `ERP_PLATFORM_PHASE031.zip` archive — the lost
  lineage's complete git history recovered (018→…→027 shared with this lineage, then
  f007d17/028 → 9b251a0/029 → ca28803/030 → 49e6b92/031, the cumulative tree intact) —
  and merged onto the PHASE-034 head (64ecb41) as a true three-way merge (base
  502dc47/027, ours 034, theirs 031-cumulative). The restored migrations renumbered to
  the merged sequence: 0039_budgeting → `0042_budgeting.sql`, 0040_payroll →
  `0043_payroll.sql`, 0041_industry_wholesale_electronics →
  `0044_industry_wholesale_electronics.sql`, 0042_healthcare_claim_ref →
  `0045_healthcare_claim_ref.sql`, 0043_industry_healthcare →
  `0046_industry_healthcare.sql` (journal 46 entries; the surviving
  0039_education/0040_agriculture/0041_consolidation unchanged). The merge united: the
  budgeting + payroll NestJS modules (their stores/services/controllers/web screens),
  the wholesale/electronics/healthcare registry seeds (`SHIPPED_TEMPLATE_MANIFESTS`
  9 → 12, `validate:manifests` 12/12), the claim-ref light extension, the 028/029
  SETTINGS_REGISTRY policy keys, the permissions 0004 seed union, and the plan-grant
  journal. Golden effective-configs re-pinned for the merged tree: 28 surviving-lineage
  pins moved by exactly the six new platform policy defaults; the 9 restored
  wholesale/electronics/healthcare pins carried over BYTE-IDENTICAL (the cross-lineage
  compose-pipeline consistency check — 37 rows total). CURRENT_SHIPPED_PHASE 027 →
  **034** (the honesty rule now points the other way: 001–034 are ALL implemented in
  this single build, so the gate takes the roadmap's end; the §4 phase-gate mechanism
  stays proven by the synthetic fixtures on a deliberately post-roadmap phase
  horizon). Docs: the
  IMPLEMENTATION_STATUS rows 028–031 flipped COMPLETE with the restoration note, the
  restoration-merge completion report with the full verification table, and this entry —
  `ERP_PLATFORM_PHASE034.zip` is THE final project file (001–034 complete) —
  **BREAKING-ARCH**
- 2026-11-09 — **PHASE-034 — Multi-Entity Consolidation (COMPLETE — the FINAL roadmap
  phase, stage 11 / the Enterprise Depth gate; the 34-phase roadmap is COMPLETE)**:
  migration `0041_consolidation.sql` (schema_version 41 — the four register §C tables
  `consolidation_groups`/`group_entities`/`elimination_entries`/`consolidation_runs`,
  all tenant-owned + RLS via the macro + composite FKs + hot indexes; the §9
  run-status CHECK enum; the snapshot rewrite-guard trigger; the
  CONSOLIDATION_ADJUSTMENT CoA template account 3220 under 3000 — used only in the
  parent's consolidation books; the 5 §3.15 permission seeds — pre-seeded in 0004 at
  plan time, converged idempotently here per the two-site 0037/0038 precedent, drift
  245 = 245; the 5 `consolidation.*` feature-key plan grants on business+enterprise,
  the tier-4 precedent; and **THE platform-plane reader** — the ONLY grant of its kind
  in the platform: role `erp_consolidation_reader` NOLOGIN (disabled-by-default) +
  BYPASSRLS (the 0003 erp_definer envelope — the RLS policy set itself untouched) with
  SELECT-only grants on the member GL read models, owning the three SECURITY DEFINER
  reader functions `consolidation_read_member_gl` (excluding
  consolidation_elimination-source lines — the member STATUTORY books are what
  consolidates) + the BR-056 period-lookup leg + the intercompany AR/AP suggestion
  leg, each revoked from PUBLIC and re-validating membership/include_from/closed-period
  in-function — ZERO cross-tenant writes at the grant level). The
  `consolidation` NestJS module: group/membership service (audited maintenance),
  elimination service (DRAFT over member-pair lines → approve (SoD creator ≠
  approver) → POST via `PostingEngine.post`, source CONSOLIDATION_ELIMINATION,
  G-32 intercompany shape, EL-{YYYY}-{SEQ:6}, reversal-only counter-entries per
  BR-056), the audited reader service (every member-book read writes an audit row),
  run service + the bounded on-demand pg-boss queue `consolidation.run.execute`
  (BR-056 typed MEMBER_PERIOD_OPEN pre-check; FAILED leaves no partial snapshot;
  snapshots immutable+versioned+content-hashed — ADR-0017 derived artifacts), the FX
  translation step (INV-008: amount × stored rate exactly; CLOSING_RATE default per
  **the T1 decision record DR-P34-FX-1 amending DR-006 §4 — OQ-V2-2 RESOLVED before
  executor merge**; per-group fx_translation_method ∈ {CLOSING_RATE, TEMPORARY};
  RATE_MISSING fail-closed; KWD-style 3-decimal currencies ride the ordinary
  machinery), and the 23-route controller. Reporting: the four §10 contracts
  (`consolidation.consolidated-tb/-is/-bs`, `consolidation.eliminations-log`) on the
  PHASE-013 engine — **registry 76 → 80** — with the INV-026 headline block-on-fail
  assertion (render-time line-by-line re-check vs the run snapshot), the TB balance
  tie, the eliminations-journal-tie INV-006 chain check, and group-view labeling;
  statements read immutable run snapshots, never live member books. Web: the five
  `/consolidation` surfaces (workspace hub, group Settings §8, eliminations log +
  the Transaction Entry workspace §4 with the live balanced DR/CR preview over
  member-pair lines + reader suggestions, the run Report Page §7 with the snapshot
  viewer + INV-026 badge + the group-view disclaimer) + nav under التقارير
  (reports.consolidated) + ~100 AR/EN dictionary keys. Verification (sandbox):
  consolidation units **50/50** (math INV-026 line-by-line + seeded drift · FX ·
  elimination-lines G-32 failure packs · snapshot determinism/tamper · the
  80-registry contracts boot check) · migrations 4/4 · configuration 111/111 ·
  contracts 41+11 · print-templates 8/8 · permissions-drift 245 = 245 ·
  validate:manifests 9/9 · docs:validate 29/29; the DB suites
  (`__db__/consolidation`: G-32 golden + failure packs zero-residue, INV-026
  line-by-line + member-GL byte-compare + tamper detection, BR-056 typed rejections +
  snapshot immutability, FX dated-rate equality, isolation attacks + write-attempt
  rejections + read-audit completeness + the policy-snapshot diff) written for the
  live harness re-run (the honest PHASE-033 posture). Lineage note: prereqs 025/013
  satisfied at this HEAD; 026/029 prereqs ship as the GA + 027-lineage surface (the
  phases 028–031 environment-reset note stands); CURRENT_SHIPPED_PHASE stays 027 —
  the honesty rule. Docs: DR-006 §4 amended · OQ-V2-2 closed · REPORT_CATALOG §10 ·
  NAVIGATION_MODEL LIVE row · IMPLEMENTATION_STATUS COMPLETE + roadmap-complete note
  · the completion report with the acceptance-criteria table (all 10 PASS) —
  **PHASE-NNN**
- 2026-11-08 — **PHASE-031 — Healthcare Commercial Shell (COMPLETE)**:
  migrations `0042_healthcare_claim_ref.sql` (journal idx 41, schema_version 42) —
  the phase's SINGLE schema change per ED-07 ("configuration + light extension"):
  the additive nullable `sales_invoices.claim_ref` varchar(64) (an external
  insurer claim reference — non-null = a claim invoice billed to the
  insurance-company partner, null = self-pay دفع مباشر; never a document number
  per ADR-0006; metadata that never enters a journal line per INV-022) + the
  partial `(tenant_id, claim_ref)` grouping index (no backfill, RLS untouched) —
  and `0043_industry_healthcare.sql` (journal idx 42, schema_version 43) —
  **DATA-ONLY**: the `industry.healthcare` v1.0.0 registry seed with the
  partners.ar_aging → ar.aging pin reconciliation (the 0025/0027/0041
  convention; inventory.expiry_list / notes.aging / notes.maturity-calendar
  resolve verbatim). Contracts: `HEALTHCARE_TEMPLATE_MANIFEST` transcribed
  verbatim (`SHIPPED_TEMPLATE_MANIFESTS` 9→10, `pnpm validate:manifests` 10/10,
  content hash sha256:f8b707e6…0947e — byte-equivalent to the 0043 seed). Sales:
  the claim-ref capture (policy-gated via the NEW settings key
  `sales.claim_ref_required_for_insured` — platform default true = the capture
  invariant, the manifest ships the same true as its L1 default, L5 may relax;
  typed `CLAIM_REF_REQUIRED` / `CLAIM_REF_ON_SELF_PAY` / `CLAIM_REF_INVALID`
  errors, validated BEFORE the insert so every failure path leaves zero
  residue) + the `(partner, claim_ref)` claim-slice read model
  (`arClaimSlicesAsOf` — the open AR claim slices partitioning the partner's
  open items, INV-009) + the additive `insured`/`claimRef` create fields on the
  HTTP schema (read-compat per CONFIGURATION_ENGINE §4). Reporting: the
  `group_by_claim` parameter on the EXISTING notes.aging /
  notes.maturity-calendar / partner.statement contracts (a report-contract
  parameter extension, register §J stays closed — zero new report keys; the
  claim groups + per-row claim_ref column + the unchanged footer ties). Policy
  registry: SIX typed healthcare keys (five registry-only +
  claim_ref_required_for_insured mapped onto the settings surface).
  CURRENT_SHIPPED_PHASE 030→031 (the shell's OWN insurance_claim_billing
  capability — available_from_phase PHASE-031 — resolves LIVE at its release;
  the REQUIRED pdc_notes chain on the 0038 grants: 027 is a prerequisite, so
  claims cheques never phase-gate). Tests: `templates-031.spec` 7/7 (clean
  apply with the KNOWN 0043 hash, the four series, pins, the all-visible
  checklist with the honest "no clinical data" framing, modules notes+crm ON,
  audited; the claim-capture legs — CLAIM_REF_REQUIRED typed + zero residue,
  self-pay null, claim-ref-on-self-pay rejected; idempotent re-apply; switch
  safety retail→healthcare additive-only with the posted CLAIM invoice
  byte-identical AND claim_ref retained through both switches; degraded
  entitlement fail-closed (notes.received feeds BOTH insurance_claim_billing
  and pdc_notes) + grant-back recovery; L5-beats-L1 on the capture key with
  the save path following; THE NEGATIVE LEDGER PROOF) +
  `healthcare-claim-lifecycle.spec` 10/10 (THE acceptance-defining suite:
  visit (crm.service_orders, no ledger) → self-pay invoice G-01 line-asserted
  → insured invoice G-01 + G-03 with the FEFO pick (the dispensing moves
  issue the nearest-expiry batch; WAC costing decoupled) + the claim slice →
  BR-001 over-limit block with zero residue → per-insurer statement claim-
  grouped + INV-009 tie → claim cheque G-24 → dunning per claim on the
  group-by-claim aging with the footer tie unchanged → G-25 deposit+collect →
  G-26 dishonor restores the claim EXACTLY (amount, partner, claim reference;
  INV-024) → failure paths: CLAIM_REF_REQUIRED + over-dispensing INSUFFICIENT_
  STOCK rollback with zero residue) + `healthcare-no-clinical-surfaces.spec`
  7/7 (THE ZERO-CLINICAL GATE: the manifest, the registries, the report
  surface, the 0042/0043 SQL executable text, the request vocabulary, and the
  whole shipped set carry no clinical stems — the "just one diagnosis field"
  creep fails CI) + capability-matrix-reconciliation 6/6 (HLT strict: zero
  mismatches both directions; the §L explicit rows extended with
  insurance_claim_billing N/A/N/A/REQ) + report-pack-wiring 5/5 (the
  healthcare pins resolve; group_by_claim parameter surface asserted) +
  template-prerequisites +3 healthcare legs (business INCLUDED incl.
  insurance_claim_billing LIVE at release; starter blocked with the claim
  chain; the downgraded-plan leg) + the synthetic phase-gate proofs moved to
  education.students@PHASE-032 (the §18 lesson-5 relay) + golden-effective-
  configs re-pinned (ALL 28 existing pins moved by the settings-key wave —
  sales.claim_ref_required_for_insured lands in every tenant's policy map as a
  platform default; the 3 new healthcare rows pin with the 0043 seed; the
  old→new table in agent-ctx/P31-A-claim-ref.md) + contracts
  industry-manifests +1 block. Web: ZERO changes (the billing/pharmacy
  navigation + terminology are data-driven — the configuration-only ethos
  held for the second stage-10 shell). Docs: ENTITY_CATALOG sales_invoices
  claim_ref note; CONFIGURATION_ENGINE §4 the settings key + the six policy
  rows; INDUSTRY_CATALOG + templates README + industries README shipped
  pointers; FEATURE_CATALOG the zero-new-keys cross-check; healthcare.md
  status + pin reconciliation; the manifest.healthcare.json mirror
  regenerated; IMPLEMENTATION_STATUS row 031 → COMPLETE + the current-state
  header; PHASE_ACCEPTANCE_CRITERIA §PHASE-031 copy; PHASE-031-COMPLETION.md
  (the evidence report); CURRENT_STATE + NEXT_ACTION (post-PHASE-031 — next
  eligible PHASE-032 Education Commercial Shell, identify only); agent-ctx
  P31-A. FINAL SWEEP ALL GREEN: typecheck 8/8 · lint 8/8 · depcruise 0
  violations/1,522 modules/10,723 dependencies · unit api 406/406 (37 files)
  + web 73/73 + ui 42/42 + contracts 53/53 + sync-core 36/36 + desktop
  274/274 + mobile 393/393 · DB suite 161 files / 2,295 tests (the full
  0001–0043 chain fresh on embedded PG16, chunked foreground: 2,293 green
  + 2 skipped + ONE documented environmental flake — the PHASE-025 T-04
  perf-tier p95 budget under the chunked run, which measures GREEN in
  isolation (13/13), the known load-dependent posture the 030 report
  records) · validate:manifests 10/10 · docs:validate 29/29 ·
  permissions-drift 245=245 · i18n 4,069=4,069 · check:rls green (violations=[], 199
  catalog tables).
  [PHASE-031-COMPLETION.md](../implementation/phases/reports/PHASE-031-COMPLETION.md)
  — type: PHASE-031

- 2026-11-08 — **PHASE-030 — Wholesale & Electronics Templates (COMPLETE)**:
  migration `0041_industry_wholesale_electronics.sql` (journal idx 40,
  schema_version 41) — **DATA-ONLY**: the two `industry_templates` registry rows
  at v1.0.0 (idempotent upsert on key; INV-022 = zero new
  tables/columns/enums/journals/permissions/plan-grants — every REQUIRED key was
  already granted: wholesale's notes chain by 0038, the electronics POS set by
  0024, `crm.service_orders` by 0027). Contracts: `WHOLESALE_TEMPLATE_MANIFEST`
  + `ELECTRONICS_TEMPLATE_MANIFEST` transcribed verbatim
  (`SHIPPED_TEMPLATE_MANIFESTS` 7→9, `pnpm validate:manifests` 9/9); report pins
  reconciled to the LIVE registry keys at every layer (partners.ar_aging →
  ar.aging, inventory.stock_valuation → inventory.valuation — the 0025/0027
  convention); NINE typed workflow-policy keys (no settingsKey mappings — the
  automotive/distribution L1-default posture); CURRENT_SHIPPED_PHASE 028→030
  (the 029 leg bookkeeping-only — no template capability rides payroll). Tests:
  `templates-030.spec` 8/8 (clean apply ×2 with the KNOWN 0041 hashes, series,
  pins, checklists, terminology AR+EN, derived navigation, policies; idempotent
  re-apply; switch safety retail→wholesale and retail→electronics additive-only
  with posted invoices byte-identical + series unions + read-only archives +
  audited switches; degraded entitlement fail-closed with the typed
  `TemplatePrerequisitesBlockedError` + grant-back recovery — activation is
  entitlement state, never a manifest edit; L5-beats-L1; THE NEGATIVE LEDGER
  PROOF — zero journal rows around every apply/switch/re-apply/grant-back) +
  `capability-matrix-reconciliation.spec` 6 (manifests ≡ CAPABILITY_MATRIX §1
  WHL/ELC columns, zero mismatches both directions; the 32-entry pre-existing
  planned-vs-shipped delta frozen as KNOWN_DELTA — growing fails CI) +
  `report-pack-wiring.spec` 4 (every pin resolves in the live 81-contract
  registry; the pre-030 retail+grocery doc-spelling gap frozen as
  KNOWN_PRE030_UNRESOLVED_PINS). Web: ZERO changes (the /settings/templates
  screen + navigation terminology are data-driven — i18n 4,069=4,069 unchanged,
  permissions 245=245). Honest notes: the two frozen snapshots, the
  phase-gating interplay resolved by sequencing (notes at 027 before 030), T11's
  UI composition reduced to zero code by the data-driven surfaces, the
  workflow-smoke/RTL-visual carve-outs, no E-commerce/carrier/BNPL. Evidence:
  [PHASE-030-COMPLETION.md](../implementation/phases/reports/PHASE-030-COMPLETION.md) —
  PHASE-030
- 2026-11-08 — **PHASE-029 — Payroll: Salaries, Loans & End-of-Service
  (COMPLETE — the planning-docs flip was honestly deferred at commit time
  (`9b251a0`) and is delivered with this PHASE-030 docs wave)**: migration
  `0040_payroll.sql` (journal idx 39, schema_version 40) — 7 RLS'd tenant tables
  (`employees` the PII-restricted financial file — national_id C-PII: masked in
  UI, excluded from logs/non-payroll exports by construction, employee reads are
  audit events; `salary_structures` + `salary_components` with per-component GL
  accounts + `is_eos_base`; `payroll_runs` DRAFT→PENDING_APPROVAL→POSTED;
  `payroll_run_lines` 🔒 append-only frozen `component_snapshot` via
  `erp.payroll_run_lines_guard`; `employee_loans` + `employee_loan_lines` with
  the BR-054 cap) + `apply_tenant_policy` ×7 + purge_path policies + §9 enum
  CHECKs + the CoA six payroll purposes (2170/2180/2190/5270/5280/5295 — the
  loan control account deliberately NOT a purpose: tenant-mapped via
  `payroll.loans.control_account_id`, typed `LOAN_ACCOUNT_UNMAPPED` until
  mapped) + the `cash_movements` widening ('payroll_payout','employee_loan' —
  ADDITIVE) + notifications category 'payroll' + the settings-registry payroll
  keys (BR-055 tenant-policy EOS, no jurisdiction rates fabricated) + the 8
  feature-key plan grants → business+enterprise (§3.14 permissions pre-seeded in
  0004/0005 — drift 245=245). The `payroll` module — 8 services (employee /
  structure / run-calculation / approval-workflow / run-posting / payout / loan
  / eos): G-29 exactly one journal per run through the PHASE-007 engine behind
  the six-account fail-closed precheck, the posting-engine BR-053 guard with the
  typed `PAYROLL_ACCOUNT_ENGINE_ONLY`, G-30 treasury payouts + the masked
  payslips batch, BR-054 deduction cap (default 25% PLACEHOLDER), BR-055 EOS
  accrual with G-31 settlement; reports `payroll.register` /
  `payroll.cost-summary` / `payroll.eos-provision` (registry 78→81, the
  `payroll-register-tie` block-on-fail assertion); web: the 'hr' navigation
  group (الموظفون والرواتب / HR & Payroll — group 10 filled with its four items)
  + the 12 `/[locale]/payroll` screens + i18n 4,069=4,069; tests:
  `payroll-rules.spec` (818 lines — the 14-story rule workbook incl. the G-29
  worked example 11,800, INV-025, G-30, G-31, BR-052…055, the PII read-audit
  trail) + `spoof.spec` 5 (S-04) + `fixtures.ts` (518 lines) + the isolation
  registry +42 → 1,062/1,062. Honest deferrals: "E2 pending" (the P29-E
  follow-up item, recorded as committed), the payslip print-template artifact
  (the masked batch + workspace rendering shipped instead), SIF/WPS bank files
  (the phase-doc §7 boundary). Evidence:
  [PHASE-029-COMPLETION.md](../implementation/phases/reports/PHASE-029-COMPLETION.md) —
  PHASE-029
- 2026-11-08 — **PHASE-028 — Budgeting & Variance Control (COMPLETE)**: migration
  `0039_budgeting.sql` (schema_version 39) — two RLS'd tenant tables (`budgets` with the
  BR-050 partial unique `uq_budgets_one_active` + the one-directional shape CHECKs +
  the `revision_no`/`supersedes_id` chain; `budget_lines` the period grid over the four
  scope dimensions) + the notifications category widening (`budgeting`) + the six §22
  feature-key plan grants; §3.13 permissions were PRE-SEEDED in 0004/0005 (docs-as-
  contract — drift stays 245=245). The `budgeting` module: the version machine with SoD
  approval + the atomic supersede flip, the DRAFT-only grid bulk replace (409
  IMMUTABLE_DOCUMENT), the read-only dimension-grouped consumption engine (BRANCHES via
  the source-document LATERAL with the honest unattributed bucket; ADR-0008 cache),
  the advisory-by-default control guard (BR-051 — ADVISORY warn-once / ENFORCE_DRAFT
  typed audited BUDGET_EXCEEDED on the DRAFT save only) + the daily sweep, XLSX
  import/export (exceljs RTL, dry-run per-row AR+EN errors, sha256 LRU idempotency),
  two report contracts (registry 76→78 with the `budget-ledger-tie` block-on-fail
  assertion), and the web screens + the `PeriodGrid` pattern (i18n +115/locale →
  3,914=3,914). THE NEGATIVE LEDGER PROOF: journal counts byte-identical after the
  full operation set + zero engine submissions + the structural grep — budgets are
  structurally ledger-incapable (DR-004). Honest deferrals recorded (guard production
  call-site wiring; import hash LRU scope; BRANCHES attribution story). Evidence:
  [PHASE-028-COMPLETION.md](../implementation/phases/reports/PHASE-028-COMPLETION.md) —
- 2026-11-07 — **PHASE-027 — Cheques, Promissory Notes & Installments (IN PROGRESS —
  the build waves + the docs sync landed; the serial orchestrator gate — full DB suite
  re-run + completion report + commit — closes the phase; status flips COMPLETE only on
  its evidence)**: migration `0038_notes_installments.sql` (schema_version 38; catalog
  199 rows — the four new tables were pre-catalogued at blueprint level ED-19) — four
  RLS'd tenant tables (`notes` with `cash_account_id` stored at DEPOSIT +
  `journal_entry_id` the G-24/G-27 entry + `note`/`note_ar`; `note_events` 🔒 append-only
  by grants + `erp.note_events_guard` (UPDATE never, DELETE only under `erp.purge_mode`);
  `installment_plans` with status NULL = draft + `late_fee_policy` jsonb;
  `installment_lines` with `receipt_refs` + `late_fee_*` stamps), the 0036-discipline
  purge_path policies ×4, 7 §9 enum CHECKs, **the `treasury_allocations.note_id`
  widening** (exactly-one-of-three + partial unique + composite FK — the
  settle/restore substrate), the `cash_movements` source widening (`'note'`, ADDITIVE —
  the 0025 kinds preserved; the first draft's non-additive CHECK broke every cash
  invoice G-02, caught by re-running the sales suite), the RC-11
  `reconciliation_runs.kind` widening (`NOTES`), the notifications categories
  (`notes`,`installments`), and the four CoA template purposes (1160/2150/4920/5260);
  the NEW permission key `notes.notes.return` (0004 edited in-phase + 0005 accountant
  grant — drift 244→245) + plan grants (12 feature keys → business+enterprise; starter
  NOT). The `notes` module: the custody machine (legal transitions per direction,
  resolved statuses terminal, `INVALID_CUSTODY_TRANSITION`), G-24/G-27 BASE-denominated
  create journals (allocated portion at the items' original stored rates — typed
  `NOTE_RATE_MISMATCH` on divergence; on-account at the note rate), G-25 collect with
  the explicit `FX_GAIN`/`FX_LOSS` residual (r₁ cash vs r₀ note leg — the G-06 mirror)
  + the treasury movement (INV-019, source_type `note`), G-26 dishonor + return with
  **the repoint-restore algebra** (DELETE the note's allocations, INSERT one
  consolidated row anchored at the restore journal's control debit entry — original
  open item byte-equal, anchored entry at outstanding 0, aging never double-counts;
  on-account notes land a new explicit open item), endorsement/deposit/RECLASSIFY with
  zero journal rows (`ck_note_events_journal_shape`), discounting
  (`NOTES_DISCOUNT_EXPENSE` explicit; base-currency only this phase — typed
  `NOTE_DISCOUNT_CURRENCY_UNSUPPORTED` honest deferral), the PDC calendar (cached read
  model, no new entity per register §C; daily sweep 2:20 UTC + on-event invalidation;
  staleness >26 h labeled never silent), RC-11 (register fold vs GL per purpose side,
  `NOTES_PAYABLE` credit-positive; NIGHTLY 2:30 + ON_DEMAND
  `POST /api/v1/notes/reconciliation/notes-check`; BROKEN → PC-04 close block). The
  `installments` module: the plan builder (BR-048 total equality `PLAN_TOTAL_MISMATCH`,
  schedule immutable `SCHEDULE_IMMUTABLE`, one plan per source), the daily sweep 2:40 UTC
  (job-derived line states only; WAIVED the sole manual transition, sticky; DEFAULTED
  flip + dunning), collections via the allocation reuse (`receipt_refs`; plans never
  duplicate AR), G-28 engine-only flat late fees (cap honored, INV-013 once per line;
  PLACEHOLDER defaults rate 2%/cap 500/grace 7 d/auto off/defaulted after 3 — OQ-002).
  P27-E: 5 report contracts (notes.maturity-calendar/aging/dishonored-register +
  installments.schedule/aging — registry 71→76, as-of via the custody-log
  reconstruction, block-on-fail RC-11 ties). P27-F: web screens (`/notes` ×4,
  `/installments` ×3) + the `TimelinePanel` pattern (COMPONENT_CATALOG row + AR+EN
  baselines) + the 3 NAV_ITEMS + i18n 3,599→3,799/locale. P27-G: the suites —
  isolation registry +4 (A1–A10; the `note_events` append-only grant proof), spoof ×5+×5
  (typed 404s `PARTNER_NOT_FOUND`/`NOTE_SOURCE_INVALID`/`NOTE_NOT_FOUND`/
  `PLAN_SOURCE_INVALID`/`LINE_NOT_FOUND`, zero partial creation, the asymmetric-dishonor
  probe, A7 parity), `notes-rules` 27, `installments-rules` 7, `inv-024` 3, `rc-11` 2,
  `pdc-calendar` 8 + perf, `overdue-job` 4 — DB suite 154 files (~2,094 tests).
  P27-H (this docs sync): IMPLEMENTATION_STATUS PHASE-027 row, the ten §6 acceptance
  criteria copied into PHASE_ACCEPTANCE_CRITERIA, ENTITY_CATALOG notes/installments
  sections → delivered (0038) + the new TABLES/notes-installments.md spec (the repoint
  algebra + the `late_fee_policy` shape + the INDEX list), DATA_DICTIONARY §9
  `installment_plan_status` NULL = draft + §14 the delivered policy shape, FEATURE_CATALOG
  §20/§21 DELIVERED (12 keys, plan grants) + the `treasury.cheques` re-point wording per
  register §D (delivered by the `notes` module — ED-03 chain closed),
  AUTHORIZATION_MATRIX §3.12 `notes.notes.return` row (drift 245=245) + §4 risky-key
  list, NAVIGATION_MODEL §1.1 rows verified vs shipped (pdc-calendar archetype corrected
  to the §1 dashboard), JOURNAL_RULES §7 delivered posting notes (BASE-denominated
  creates, the FX residual, the fee legs, the discount deferral, the repoint, the
  source keys), ACCOUNTING_INVARIANTS INV-024 enforced-by update (custody machine +
  repoint + RC-11), RECONCILIATION §1 row 11 (RC-11) + the §3 close-block list,
  BUSINESS_WORKFLOWS §10 (RETURNED/DISHONORED/DISCOUNTED terminal per the shipped
  machine) + §12 (DEFAULTED flip + job-derived notes), ACCOUNTING_TESTS §1 the 027
  suites + §5 the RC-11 row (and the 026 fixed-assets row's id corrected RC-11→RC-10 to
  match RECONCILIATION §1 row 10), SECURITY_TEST_PLAN §2 the PHASE-027 attack row;
  REPORT_CATALOG/BUSINESS_RULES/OFFLINE matrix/industries CAPABILITY_MATRIX verified
  pre-authored + green (capabilities check PASS). — PHASE-027

- 2026-11-07 — **PHASE-026 — Fixed Assets & Depreciation (IN PROGRESS — the parallel
  build waves landed; the serial orchestrator gate — full DB suite + drift battery +
  completion report — pending; status flips COMPLETE only on its evidence)**: migration
  `0037_fixed_assets.sql` (schema_version 37; catalog 156→162) — six RLS'd tenant
  tables (`asset_categories` BR-041 purpose links, `assets` with the NBV-floor
  CHECKs, `depreciation_runs` one-per-period, `depreciation_lines` 🔒 append-only by
  grants + `erp.depreciation_lines_guard` (INV-003 pattern, purge-path-only DELETE),
  `asset_disposals` with frozen snapshots + SoD stamps, `asset_revaluations` with the
  frozen delta + mandatory reason), the 0036-discipline purge_path policies on every
  table, the `reconciliation_runs.kind` widening with `FIXED_ASSETS` (RC-10 — the
  0012 BANK_REC precedent), the six v2.0 CoA template purposes (1210/1220/3210/4910/
  5300/5910), and the 13 §3.11 permission seeds (owner=13/accountant=11/viewer=3;
  drift-checked). The `fixed_assets` module: P26-A — category-service (BR-041 at
  create/update/first-use, staging allowed, in-use steering blocked),
  asset-service (register + the ACTIVE→FULLY_DEPRECIATED→DISPOSED machine,
  economic-column immutability, membership-scoped custodian A7), capitalization G-21
  (CREDIT partner-leg INV-009 / CASH / the OPENING variant resuming from the true
  NBV), the purchase-capitalization port (GRN capital-expense seam — documented port,
  zero purchasing edits); P26-B — the depreciation kernel (STRAIGHT_LINE /
  DECLINING_BALANCE 12/life on opening NBV / UNITS_OF_PRODUCTION manual usage;
  next-month convention; salvage-floor cap; final-period residual absorption —
  Σ over the life = cost − salvage EXACTLY, property-proven 17/17 in
  depreciation-math.spec), the ADR-0008 bounded/cancelable assembly job (500-asset
  chunks), run-service G-22 (per-asset pairs ≤ 50 assets then per-category
  collapse; PERIOD_LOCKED; INV-013 replay; INV-014 reversal with un-flip);
  P26-C — revaluation-service (BR-044 audited, both directions to
  REVALUATION_RESERVE, frozen-delta contract, disposal-math.spec 19/19 pinning the
  G-23 four shapes incl. the MANDATORY loss mirror), disposal-service (SoD
  second-user approve + SELF_APPROVAL_BLOCKED backstop, DSP- numbering, INV-023
  exactly-once lock), the RC-10 register check (kind FIXED_ASSETS, zero-tolerance,
  BROKEN → notification + PC-04 close block) + the non-blocking close-checklist
  advisory; P26-E — 8 archetype screens under `/[locale]/fixed-assets` (list, new,
  detail, edit, categories, the run workspace with UoP editing + live totals, the
  disposal wizard, reports) + the الأصول الثابتة nav item + i18n 3599 keys/locale.
  T12/T14 (P26-F): the six tables registered in the isolation registry with the
  generated A1–A10 coverage (incl. the append-only grant proof for
  depreciation_lines and the A3 mismatched-INSERT shapes for all six), the S-04
  spoof battery (foreign category/branch/custodian/asset/period references → typed
  404s, zero partial creation), `fixed-assets-rules.spec` covering BR-041…BR-044
  (BUSINESS_RULES §8 row), and the docs sync: SECURITY_TEST_PLAN §2 PHASE-026 row,
  RECONCILIATION §1 row 10 deferred→PHASE-026 + the PC-04 close-block list,
  PERIOD_CLOSING §2 advisory item 8, ACCOUNTING_TESTS §1 module-rule-suite row +
  §5 RC-11 fixed-assets row, DATA_DICTIONARY §14 fixed-assets column semantics,
  TABLES/fixed-assets.md authored in-phase (grow-per-phase rule), SCOPE ED-18 +
  ENTITY_CATALOG §fixed_assets + BUSINESS_WORKFLOWS §11 verified pre-authored.
  Pre-authored v2.0 docs verified untouched: JOURNAL_RULES §7, ACCOUNTING_INVARIANTS
  INV-023, POSTING_ENGINE §4.1, FEATURE_CATALOG §19, AUTHORIZATION_MATRIX §3.11/§4,
  NAVIGATION_MODEL, REPORT_CATALOG, BUSINESS_RULES BR-041..044. — PHASE-026

- 2026-11-06 — **PHASE-025 — Performance, Reliability & GA Readiness (COMPLETE — **GA
  RELEASE `v1.1.0`** · CalVer `v1.26.11.0` · tags `release/v1.1.0` + `v1.26.11.0` +
  `phase/025` created by the orchestrator at commit time — the repo carries `.git`, so
  the release tags are real repository objects this time (the v1.0.0 zip handover could
  only record the instruction)**: the honest-split discipline end-to-end — everything
  provable in this environment EXECUTED with evidence; the hosted legs (production-class
  k6 full-load, the 12 h staging soak, the recovery-region wall time, the external
  pen-test firm, the 30-day nightly restore-smoke cadence) carry the standing
  owner-directive waiver (2026-10-28) with local-equivalent evidence + named follow-ups;
  a missed item = a documented INCOMPLETE, never a quiet pass. NO new migrations, tables,
  or permission keys (§4 tuning-only; catalog unchanged at 156 tables / 244 keys).
  T1/T2 (PERF-A): `ga-fixtures.ts` (deterministic 10× mix — 1 large ≈100k docs/50
  users + 50 mid ≈10k/5–10 + 500 small ≈1k/1–2 = 1,175 concurrent, 1.1M documents,
  60/25/15 sales/purchases/treasury, RLS on) + `ga-full-load.db.spec.ts` (T-01…T-08
  assertions + the §4 DB baselines incl. EXPLAIN top-10 with the RLS predicate
  index-driven) — local-harness tier (embedded PostgreSQL 16); the production-class
  hosted run remains the INFRA-GATED gate leg (PERFORMANCE_TEST_PLAN §8: passing on
  weaker hardware does NOT close the gate). T4a `ga-spike.db.spec.ts`: 429-before-
  collapse via the R-04 per-tenant limiter + recovery. T4b `report-hammer.db.spec.ts`:
  noisy-neighbor isolation PROVEN (small tenant within budgets under the large tenant's
  heaviest concurrent report load) + the honest finding recorded: NO per-tenant
  report-run quota exists (MULTI_TENANCY §5 gap) → the GA checklist's open note with
  the owning slot `DR-P25-07`. T5 `soak-shaped.db.spec.ts`: the compressed soak with
  no-drift slope assertions (heap/queue-depth/budget) — the 12 h staging soak gated.
  T6 (DR-C): the S1 region-loss tabletop walked COLD from written runbooks only
  (`dr-drill-2026-11-06.md` — decision points + the G1–G11 gap list as actions) + the
  §7 cross-region-shaped rehearsal at local tier (`restore:drill-ga`: fresh env + full
  0001–0036 chain re-apply + timed nightly-shaped restore + invariant smoke + parity;
  the IaC/cutover + recovery-region wall time = hosted follow-ups). T7: the
  second-engineer cold PITR restore (§4 shape) executed from the runbook only —
  runbook §8 row 2026-11-06 (timings/smoke: gate output); the monthly attestation
  honestly NOT SIGNED (no 30-day hosted cadence yet; first attestable month 2026-12).
  T8: the DEPLOYMENT.md cold validation — PASS with fixes (3 §2 smoke-block code-drift
  bugs + 3 doc drifts fixed; `deployment-cold-run-2026-11-06.md`). T9 (SLO-B): the SLO
  substrate LIVE — `infra/observability/metrics.ts` (in-process registry,
  `erp_<module>_<name>_<unit>`) + `infra/http/metrics.middleware.ts` (golden signals
  per route group) + `infra/observability/slo.ts` (the MONITORING §5 six SLOs, burn
  2×/4×, SLOBurn) + `GET /api/v1/platform/slo` + the `/[locale]/platform/slo` screen
  (AR/EN); NO_DATA never green (the backup leg honestly waits for the pipeline —
  SF-024-021/DR-P25-06); the error-budget policy ("feature releases pause on
  exhaustion") recorded verbatim in the GA checklist. T10: `check:observability` (every
  §3 alert → runbook anchor; §1 dashboards; naming; retention; redaction). T12: the
  findings-log closure re-read — 0 Critical open; 3 High (SF-024-016/017 build-time/
  unreachable + SF-024-022 residual) with 30-day clocks + rationale, 2 Medium
  (SF-024-018/021) 90-day; regression specs per fixed finding in the suites; the GA
  re-test slice = the orchestrator's full gate on the release SHA (isolation/attack
  specs inside). T13 (DOCS-D): the **GA release checklist**
  `implementation/phases/reports/GA-RELEASE-CHECKLIST.md` (the 11 PHASE-025 §6 criteria
  × truthful status markers — 1 INFRA-GATED, 5 CLOSED-LOCAL-TIER, 5 CLOSED — evidence
  slots filled by the orchestrator's gate outputs + the GA-candidate SHA slot), the
  **bilingual
  release notes** `operations/release-notes/v1.1.0.md` (AR-first + EN; user-facing;
  the honest state markers: ZATCA UNVERIFIED/not enabled, ETA none, payments sandbox,
  personal accounts read-only, iOS no, SLA undefined, retention under legal review),
  the RELEASE_STRATEGY execution-log **v1.1.0 row** + v1.1.0 notes (tags real this
  time), and the MASTER_ROADMAP §GA-gate evidence marking. T14 (DOCS-D): the post-GA
  pointer records — `decisions/security/DR-P25-01-bug-bounty.md` (PROPOSED: scope
  tiers, PHASE-024 T14 disclosure-policy linkage, reward model open; trigger
  post-GA review), `decisions/product/DR-P25-02-support-sla.md` (OQ-008: per-severity
  targets vs the MONITORING §4 on-call reality), `decisions/product/
  DR-P25-03-personal-payments.md` (OQ-007: read-only posture governs; what changes if
  personal accounts open), `decisions/compliance/DR-P25-04-eta-uae-followup.md`
  (DR-003 DEFERRED + RISK-007 + the fake-eta harness; UAE waits for official specs),
  `decisions/product/DR-P25-05-ios-client.md` (the ADR-0014 slot; the PHASE-022
  two-capability precedent), `decisions/technical/DR-P25-06-observability-exporter.md`
  (SF-024-021: the names are live, the pipeline picks them up; with DR-003),
  `decisions/technical/DR-P25-07-report-quota.md` (the PERF-A finding's owning slot) —
  all PROPOSED with trigger + owner; the new `decisions/security/` folder + README +
  the decisions indexes updated (no vague aspirations). Final gate (orchestrator,
  serial): typecheck/lint/depcruise · db suite with the new perf specs
  DB suite **143 files/2035 tests** (+4 perf files); ga-full-load T-01 p95=8ms · T-02 23ms · T-04 interactive 1ms cached/343ms compute + statements 1576ms · T-05 round-trip 122ms · T-06 183/177ms · T-07 0/305 · T-08 111.3 posts/s — ALL within budget ·
  restore drills §4 quarterly 1.3s restore (RTO 4h GREEN) + §7 cross-region-shaped 1.1s restore leg/2.3s chain bootstrap/7.0s wall (RTO 8h GREEN) — both invariant-smoke a–f green, parity 5/5 · check:observability · the
  drift battery (docs:validate, permissions-drift 244=244, rls, capabilities, i18n,
  deps) · unit suites api 32/334 · web 5/73 · desktop 16/274 · mobile 27/393 — ALL GREEN
  — the serial orchestrator gate 2026-11-06: typecheck 8/8 · lint 8/8 · depcruise 0 violations/2209 modules · DB 143/2035 · drift battery (docs:validate 29/29 · permissions-drift 244=244 · capabilities agree · i18n 3399=3399 · check:deps 0 violations) — ALL GREEN. — PHASE-025

- 2026-11-06 — **PHASE-024 — Security Hardening & Compliance Review (COMPLETE — the
  honest split: internal leg evidenced; the external pen-test firm leg infra-gated as
  the recorded waiver; OQ-009 BLOCKED-EXTERNAL per DR-024-02)**: migration
  `0036_security_hardening.sql` (schema_version 36; catalog 154→156) — the MFA policy
  substrate (`plans.mfa_required_role_keys` default '{}' + `sessions.mfa_gate_passed`),
  the offboarding purge substrate (`tenants.legal_hold`, the `tenant_offboarding` flow
  state, `purged_tenants` deletion certificates keyed by HMAC-SHA256
  `hashed_tenant_id`, the audit-review indexes) + the EXPLICIT purge path
  (command-scoped `purge_path_delete`/`purge_path_update` RLS policies for
  erp_migrate on every tenant table — NO insert policy, the forged-insert denial
  proven — + the id-keyed tenants variant + the audit-guard `erp.purge_mode` UPDATE
  exception; check-rls drift-checks all of it; erp_app grants unchanged everywhere).
  T4: MFA enforcement per role/plan live (ADR-0015 §4's "mandatory-able later" —
  plan lists + the `identity.mfa.policy` tenant override where an explicit empty
  custom list beats a plan mandate; login 423 `MFA_REQUIRED` with
  `details.enrollmentRequired`; the 15-minute enrollment-bootstrap session — the
  deadlock-breaker, middleware route-gated `MFA_ENROLLMENT_REQUIRED`, rotation
  inherits the gate; admin-assisted reset — `identity.mfa.admin_reset`'s first
  route; the plan lever `PUT /platform/plans/:key/mfa-policy`; the web settings
  card + login routing; DR-024-01 WebAuthn DEFER post-GA; the matrix spec 9/9 at
  service AND HTTP level). T11: the offboarding purge END-TO-END (Journey H1–H6) —
  typed-name request → read-only grace (the subscription GRACE_READ_ONLY reuse,
  recorded) → the manifest export (per-artifact sha256 + counts + schema_version
  36; manifest + signed URLs — no zip dep added mid-phase, the deviation recorded)
  → two-person execution → suspend + the 90-day retention → the daily sweep on
  `MIGRATE_DATABASE_URL` (NEVER the app pool: FK-topological batched deletes,
  storage prefix wipe, session severance, audit ANONYMIZATION — tenant/actor/device
  → NULL, never deletion, the append-only guard holds — tenants → OFFBOARDED, the
  0-rows verification, the certificate) + legal-hold blocking audited; the staging
  drill spec 7/7. T5: R-04 per-tenant burst limiter (429 + Retry-After +
  X-RateLimit; A/B isolation) + R-05 per-account reset flood (uniform 200 kept — no
  oracle, the email skipped). T9: API + BFF security headers + CSP report-only
  capture (`CSP_REPORT_ONLY=1` + `/csp-report`) + the M-03 cookie DOM probe. T8:
  the tenant-admin audit review console (actor/action/correlationId filters + the
  bounded audited CSV export + `/audit` web screens + NAV). T12: the support-access
  review report (the ADR-0005 per-tenant fetch off the platform-widened audit
  index; the explicit gap list: expired-unclosed / zero-action / orphaned-reads).
  The RLS canary (`erp_rls_denials_total`, */5 no-GUC crown-jewel probes,
  auto-SEV-1 fatal logging; AppModule queue). T6 drills EXECUTED (S-01 ALTER ROLE
  + reconnect canary, S-03 envelope dual-accept — `IDENTITY_SECRET_KEY_PREVIOUS`,
  S-11 webhook dual-secret — `WEBHOOK_SIGNING_SECRET_PREVIOUS`, S-10 cert rotation
  against the fake-authority harness only) + the runbook + the drill record. T7
  triage: lockfile lint clean (11 manifests), `pnpm audit --prod` **0 CRITICAL**
  (the blocking rule holds; 3 high + 1 moderate recorded as SLA-clock findings),
  SBOMs server + web (the pnpm-9 invocation fix documented), the gitleaks local
  substitute clean + the CI job authoritative. T13: the threat-model update cycle
  (9 new boundary rows, S-14/15/16, residual-risk owners). T14: the public
  disclosure policy page AR+EN + the login link. The findings log
  `docs/operations/security-findings.md` (SF-024-001..022) opens as the living
  artifact — every internal finding fixed in-phase with regression links or open
  with SLA clocks + rationale; 0 Critical open at exit. FEATURE_CATALOG §25 +3
  platform-provided keys (`platform.support_review`, `identity.mfa_policy`,
  `audit.review_console` — never plan-metered). The pg-boss `createQueue` boot
  deadlock FIXED (proven pre-existing at 023 HEAD and flagged for this phase —
  every createQueue now serializes in `getBoss()`). The Nest middleware
  `request.path`-resets-to-"/" mounting behavior documented + worked around
  (`originalUrl`). Final sweep ALL GREEN: typecheck 8/8 · lint · depcruise 0
  violations/2194 modules · unit api 31/310 + web 5/73 + desktop 16/274 + mobile
  27/393 · **DB suite 139 files / 2019 tests** (+4/+29) · permissions-drift
  244=244 · i18n 3343=3343 (+59/locale) · docs 29/29. — PHASE-NNN

- 2026-11-05 — **PHASE-023 — External Integrations & E-Invoicing (COMPLETE)**: the
  external-integration substrate ships with the no-fabrication discipline made
  executable — the registry/monitoring/certificate/rollout machinery ANY authority
  or provider integration needs, with zero unverified wire-format knowledge.
  Migration `0035_external_integrations.sql` (schema_version 35; drizzle journal
  idx 34, the 0-based convention): the `e_invoicing_submissions` OPERATIONAL expansion (ONE LIVE row per
  document × adapter — the 009 UNIQUE became the PARTIAL unique
  `uq_einvoicing_submissions_live` over the live states; `SIGNED`/`REPORTED` join
  the ladder; `attempts` + `next_attempt_at` + the `ix_einvoicing_submissions_retry`
  sweep; retry chains via `retry_of_submission_id`; sealed payload/response
  artifacts — AES-256-GCM via `EINVOICING_SECRET_KEY`/`EINVOICING_SECRET_KEY_ID`
  with the `IDENTITY_SECRET_KEY` fallback, production fails closed), the S-10
  `e_invoicing_certificates` registry (secret-store PATH only — uq +
  `einvoicing/%` shape; `rotated_from` chain; the 30/14/7 expiry ladder recorded on
  `expires_alerted_at`), the append-only `e_invoicing_certificate_usage` audit,
  `e_invoicing_adapter_settings` (per-tenant rollout flags default OFF; enabled ⇒
  enabled_by+enabled_at CHECK; never the platform feature_flags table),
  `bank_statement_parked_lines` + the seeded `bank_statement_formats` registry,
  `commerce_channel_orders`/`commerce_channel_imports` (natural-key staging +
  Idempotency-Key batches), and `billing_payouts` (CHECK net = gross − fee) — all
  RLS'd + isolation-registered. Modules: `tax/submissions` (the adapter-neutral
  state machine — illegal transitions rejected in code; the registry service; the
  NON_AUTHORITATIVE compliance-archive payload builder over jurisdiction-pack
  labels + the INV-012 summary; pg-boss `einvoicing.sign|submit|poll|reconcile`
  jobs — idempotent, expo-capped retries, dead-letter at the cap with the
  `einvoice.submission.failed` inbox alert, degrade-the-feature-never-the-platform;
  funnel monitoring + `EInvoiceRejectSpike` >5%/15-min Sev-2), `tax/certs`
  (approval-separated audited enroll/rotate; signing-job-only key access — no API
  surface reads key material; the offboarding purge), `tax/adapters/zatca` (**the
  UNVERIFIED refuse-to-submit stub** — the verification gate is honestly
  NOT_VERIFIED (no external access; nothing fabricated): every refusal names the
  unmet GATE-1..GATE-4 items; DR-001 OPEN, option C recommended), `tax/rollout`
  (default OFF; the enablement gate = a provisioned ACTIVE certificate + the
  jurisdiction pack), `treasury/parsers` (the csv-debit-credit + csv-with-balances
  format families with parking — raw cells verbatim, amounts NEVER guessed, balance
  drift advisory-only) + the parked-lines list/resolve/discard endpoints,
  `sales/adapters/commerce` (CommerceChannelPort + FakeCommerceChannel + the import
  service; ShippingPort reserved with a fake; financial drift ⇒ CONFLICT for
  explicit human resolution — never LWW), and
  `tenancy/application/billing/refund-payout-service` (`refund()` on the sandbox
  provider port + `refundSettledPayment` + `syncPayouts`/`reconcilePayouts`/
  `listPayouts` + the `runPayoutReconciliation` job; `payment.refunded` billing
  events — the invoice stays PAID, history append-only; DRIFT reported, never
  auto-corrected). API: the tax registry/funnel/resubmit/certificates/settings
  surface + treasury parked lines + sales commerce
  (channels/import/orders/resolve) behind the NEW `sales.commerce.manage`
  (permission catalog 243→244, permissions-drift 244=244) + platform billing
  refund/payouts/sync. Web: `/settings/tax/einvoicing` (per-state registry,
  adapters + verification honesty, cert countdowns), `/platform/einvoicing-funnel`,
  the parked-lines mapping on the treasury statement screens, and checkout result
  states; i18n AR/EN parity maintained. Tests: `tests/authorities` (fake-zatca +
  fake-eta — in-process authority simulators driving the REAL registry + jobs
  through the submit/accept/reject/timeout/retry/DLQ scenario matrix; port-shaped
  only, zero wire-format knowledge) + the new db suites tax/submissions-registry,
  tax/certificates, tax/fake-authority, treasury/parsers, sales/commerce,
  billing/payout-reconciliation, and sync/chaos-submissions (C-01…C-04 with the
  submission jobs in the loop). Honest deferrals: the ZATCA real adapter (the
  verification gate NOT_VERIFIED + DR-001 OPEN — option C), Egypt ETA (NOT_STARTED;
  the DR-003 DEFERRED draft), the payment production cutover (DR-002 OPEN — the
  sandbox is hardened, no production claim), live-provider contract tests
  (staging-credentials-gated by design). Next eligible phase: PHASE-024 — Security
  Hardening & Compliance Review (identify only).

- 2026-11-05 — **PHASE-022 — Android Application (COMPLETE)**: the Expo/React Native
  client (ADR-0014) ships as **ONE app, TWO capability experiences** — `android-field`
  (van sales, collections, van load/unload, returns, counts, route visits) +
  `android-personal` (the read-only partner companion) — with scoping at device
  registration, never by build variant. `apps/mobile` = `@erp/mobile`, ALL application
  logic in TypeScript over the UNMODIFIED `packages/sync-core` (36/36 byte-identical):
  **DR-P22-01** the TS workspace package (contracts/domain-core/sync-core +
  react/react-native only — never packages/ui, depcruise-enforced) + the `native/`
  Expo glue dir excluded from the pnpm workspace (the src-tauri precedent — the root
  install never installs expo; the EAS release workflow compiles it;
  `check:mobile-shell` gates the structure; `"main": "./native/App.tsx"` with the
  library surface intact); **DR-P22-02** the two-layer design-token mirror behind the
  root `check:mobile-tokens` gate (130/130 + 50/50 derivations) + the RN primitives
  with the binding status-badge/finance-sign maps; **DR-P22-03** the RTL
  logical-props-only ESLint ban (the RN port of `erp/no-physical-direction`,
  negative-proven; bidi U+2068/U+2069 isolation); **DR-P22-04** the AR-first typed
  dictionary behind `check:mobile-i18n` (ar=en=371; latn + tabular-nums identifiers,
  arab display tenant-configurable; the web gate untouched at 3244=3244); **DR-P22-08**
  the mobile store (field migrations v4+ with TEXT money/qty, the 128 MB byte-exact
  LRU prune — the DR-P21-03 port, the proven §6.4 corruption drill) + the thin sync
  host with the §8 trigger set (2-min dirty foreground, 5 s connectivity debounce,
  after-write fast push, ≤ 15 min background), the 8 MB pull / 2 MB push / 256 KB
  personal budget guards, the C-08 contract gate → read-only + force-update prompt,
  and the D-01 revocation purge, + **DR-P22-08b** the personal profile = cursors +
  meta + read models ONLY — no outbox/inbox, push structurally unreachable (three
  layers); **DR-P22-09** device security (the SecureStore vault `erp.<deviceId>.*`,
  memory-only 15-min access tokens with silent refresh, rotation reuse = theft → wipe
  + re-login — non-credential failures never wipe, biometric-optional unlock + PIN
  never a brick, best-effort trust signals → trustFlags → degrade-to-online-only
  until admin ack (D-07), FLAG_SECURE on the 8 financial screens, the D-04 7-day
  watermark); **DR-P22-11** the 11-screen registry — real renders AR/EN with a11y +
  ≥ 44 px targets through the vitest Flow bridge (the 1-a deferral solved), honest
  states (PENDING_SYNC → POSTED/REJECTED(editable), as-of labels, ONLINE-ONLY
  disabled-with-reason never queued), LOCAL-VALID† advisory pre-validation, the FULL
  CONFLICT_RESOLUTION §3 rejection table (all 10 codes + traceId audit; resend = NEW
  commandId + fresh idempotencyKey); **DR-P22-10** release engineering (eas.json +
  native/package.json + `mobile-release.yml`: gates → shell → tokens/i18n → native
  install → S-15/FCM warn-and-continue provisioning → EAS build → SBOM → apk/aab →
  the staged-rollout config + the `minVersion` release manifest + the device-farm
  job; the ReleasePolicy/rollout client modules — calver compare, the force-update
  decision, promote 10→50 ≥ 99.5%/≥ 200 and 50→100 ≥ 99.7%/≥ 500, halt < 98.5% at
  ANY sample size with the minVersion remedy; the structural CI test). Server-side
  (the reuse-first additions): **DR-P22-05** the feed activation — FEED_GROUPS.field =
  POS + van_stocks + routes + settlement_templates + statements; personal =
  statements + sales_invoices + receipts + notifications (partner-scoped
  server-side, tampered-pull-proof) — with **DR-P22-05a** migration
  `0033_mobile_feeds.sql` (`devices.linked_partner_id` only; "no DB changes" read as
  *no business-schema changes*) + the 3-b registration writer (the link validated
  against the registering identity's partner authorization); **DR-P22-06** the
  write-intent registry 13→**17** (`receipt:create_field_collection`,
  `van:confirm_load`, `van:confirm_unload`, `credit_note:create_draft` — owning
  services only, typed rejections with machine-readable details, duplicate:true
  replays); **DR-P22-07** the FCM skeleton (NotificationChannelPort + the
  disabled-by-default FcmChannelAdapter, locale resolved pre-call, opt-in default
  OFF, per-tenant quota, NO financial payloads — three enforcement layers) +
  **DR-P22-07a** migration `0034_device_push_tokens.sql` + the
  `PUT /devices/:id/push-token` surface (revocation clears tokens). The expo chaos
  profile (`apps/api/src/__db__/sync/expo/`): the FULL C-01…C-16 (+C-11b) matrix on
  the REAL mobile store + battery/connectivity fault profiles + the 4-window
  real-SIGKILL kill-matrix + D-01/D-02/D-04 incl. the personal class (TENANT_EXPO
  dedicated). **Tests: `@erp/mobile` 27 files / 393 (NEW)**; the full DB suite
  **128 files / 1898** (021: 1829 → +69); the sync dir 21 files / 191 (expo profile
  27 + pull-fields/pull-personal 10 + field-intents 18 + register-partner-link 6) +
  fcm-channel 8; sync-core 36/36 untouched; desktop 274/274 + the 020/021 chaos
  regressions byte-identical; mobile tokens 130/130+50/50; capabilities-matrix agree
  (the 18 android cells implemented with real gates; 42 implemented rows, 0
  deferred); permissions-drift 243=243; depcruise 0 violations (1269 modules). Docs:
  MOBILE_QUICKSTART (new), DEVELOPMENT_SETUP §12, DEPLOYMENT §7 the Play Store
  staged-rollout + minimum-version runbook, TROUBLESHOOTING §9 android, MONITORING
  the client-stability rows, FEATURE_CATALOG `offline.android_app` +
  `offline.mobile_accounts` → shipped, OFFLINE_CAPABILITIES_MATRIX the android ✓
  marks live, IMPLEMENTATION_STATUS PHASE-022 → COMPLETE, the acceptance-criteria
  row with all 11 criteria, the completion report. Honest deferrals (the k6
  precedent): the on-device C-06/C-07/C-13 + D-02 cipher legs (the wired device-farm
  CI job), Play Store signing/EAS compile (CI only), the pixel snapshot gallery
  (tree-level parity proven), T-03 scan-to-cart on reference hardware, the
  force-update screen navigation glue (policy + tests complete; the App.tsx TODO
  asserted structurally). Next eligible phase: PHASE-023 — External Integrations &
  E-Invoicing (identify only).

- 2026-11-04 — **PHASE-021 — Desktop Application (COMPLETE)**: the Windows-first desktop
  client as the Tauri v2 shell around the web ERP static export (ADR-0013). `apps/desktop`
  = `@erp/desktop`, ALL application logic in TypeScript over the UNMODIFIED
  `packages/sync-core` (git diff empty; 36/36 re-verified): the **dual-profile SQLite
  store** (DR-P21-02 — cipher profile on the Windows CI `--features sqlcipher` build
  with `PRAGMA key` + `cipher_version` verified; fail-closed `SqlCipherUnavailableError`
  on the stock build; the recorded standard-profile fallback keeps every other
  key-management invariant + the secret-scan; the D-02 binary inspection is
  Windows-CI-cipher-only), desktop migrations **v4/v5 continuing the shared
  `schema_migrations` numbering** (read caches sales_invoices/quotations/delivery_notes/
  stock_counts + the `draft_docs` write-set DRAFT_LOCAL/PENDING_MERGE/SYNC_FAILED/
  MERGED/CANCELLED_LOCAL + `local_events` audit), **byte-exact 1 GB `dbstat` pruning**
  (DR-P21-03), the proven **§6.4 corruption drill** (stage → reset → re-import → full
  pull; never deletes the outbox without staging), enrollment/keychain/session/unlock
  (the D-04 7-day watermark), the sync host with the full §8 trigger table + the C-08
  read-only gate + the D-01 revocation purge (local_events payloads scrubbed, VACUUM
  file-level completion), the **real minisign/Ed25519 updater** (downgrade rejection,
  the dual-trust rotation window, `minVersion` force-update) + the **staged-rollout
  gates** (DR-P21-05: ≥ 99.5%/≥ 200 sessions to promote 10→50, ≥ 99.7%/≥ 500 for
  50→100, halt < 98.5% + the force-update remedy), the WebView2 probe (DR-P21-04:
  minimum 109.0.1518.78 / recommended 120.0.2210.61), crash-free-session telemetry, and
  bilingual 80/58 mm ESC-POS with reprint-from-cache (never re-numbers). Server-side
  exactly two additions: migration `0032_device_enrollment_one_time.sql`
  (schema_version 32 — `devices.device_key_hash` DROP NOT NULL) + **DR-P21-01**
  `POST /devices/:id/enroll` (the one-time credential exchange; concurrent double-spend
  closed by the conditional UPDATE; refresh's failure taxonomy) and **DR-P21-08** the
  7 desktop write intents inside the frozen v2 envelope (partner:create,
  quotation/delivery-note/cash-transfer/stock-transfer create_draft, expense:create,
  stock_count:submit_lines — owning services only; registry 6→13 intents; contract
  `2026-11-04.1` unchanged). Web: the **DR-P21-06 Offline Console**
  (`/{locale}/offline` + `/{locale}/unlock`) — the 9 OFFLINE-DRAFT flows, ONLINE-ONLY
  disabling with localized reasons (browser mode = the same components,
  capability-gated), as-of labels, the FULL rejection action table with every choice
  audit-logged incl. the rejecting `traceId`, sync-now, reprint; nav + dashboard
  entries; i18n 3044→3244 (exact AR/EN parity). **DR-P21-07** the exported shell
  subset (`build:desktop` → `out-desktop`; depcruise `web-shell-no-server` +
  `desktop-no-api`/`desktop-no-web`; `pnpm check:desktop-shell`; the Windows CI
  workflow compiles, EV-codesigns, minisign-signs (S-15), SBOMs, and publishes the
  updater manifest — the Rust shell ships SOURCE-only, the k6 precedent). **DR-P21-09**
  the bridge `sync` member (fail-closed SYNC_DRIVER_NOT_REGISTERED on older shells).
  Updater hosting: the `deploy/updater/` static-JSON layout (immutable versioned dirs)
  + `scripts/updater-manifest.ts sign|publish|--self-test`. **Tests: `@erp/desktop`
  16 files / 274** (real temp-dir SQLite + real keypairs); the sync dir 14 files / 130
  in 21 s — the desktop profile 27 (the chaos matrix C-01…C-16 on the REAL file store
  incl. C-08 through real signed updates + 4 real-SIGKILL kill windows + D-01/02/04/06
  on file) + enroll 6 + desktop-intents 23; the web console suites 73; the E2E offline
  journey `pnpm test:e2e-desktop` **2/2 green AR+EN** (~25 s; it exposed the real
  DR-P21-3b-1 enqueue defect — the outbox `payload` column must carry the full v2
  envelope — fixed in-phase); the 020 chaos regression 19/19 bit-identical. Docs:
  DESKTOP_QUICKSTART + DESKTOP_SYSTEM_REQUIREMENTS (new), DEVELOPMENT_SETUP §11,
  DEPLOYMENT §7 updater runbook, TROUBLESHOOTING §8 desktop, MONITORING client-
  stability note, FEATURE_CATALOG `offline.desktop_app` → shipped, IMPLEMENTATION_STATUS
  PHASE-021 → COMPLETE. Honest deferrals: the Rust compile/EV-signing execution
  (Windows CI code only), the cipher-profile D-02 inspection (Windows-CI-only),
  per-page deep offline integration beyond the console (iterative polish), offline
  UPDATE intents for the new draft types (create-only). Next eligible phase: PHASE-022.

- 2026-11-04 — **PHASE-020 — Offline Synchronization Foundation (COMPLETE)**: the
  platform-wide `sync` module generalizing the PHASE-016 POS slice (which keeps
  working byte-identically — wire compat is §11 rule 3, proven by the chaos
  suite's legacy legs). Migrations `0029_sync_foundation.sql` (tombstones +
  inbox_commands both tenant-owned + RLS; device_refresh_tokens identity-owned
  sessions-pattern; the devices registry widening — device_class, contract_version,
  attestation substrate, trust_flags, pull/push watermarks, data_expires_at;
  sales_invoices.owner_device_id) + `0030` (the 0024 sequence-grant gap on
  change_log) + `0031` (the sync update_draft line-replace grant). Server: 4
  device-class feed groups + the 9-entity catch-up writer + per-command feed
  entries in the same transaction; pull v2 (opaque signed cursors, contiguous
  seq windows, 2 MB page byte cap, C-12 resync, tombstone transport,
  permissions snapshot feed with the 7-day read-only watermark); push v2 (ONE
  handler registry calling owning-module services only — pos_sale/cashier_shift
  SERVER_DECISION byte-identical to 016, partner:contact_merge FIELD_LEVEL_MERGE,
  sales_invoice drafts OWNER_DEVICE_WINS + STALE_VERSION, ONLINE_ONLY →
  FORBIDDEN resubmittable:false; inbox replay with `duplicate:true` incl. the
  within-batch refinement; per-device rate limit → DEFERRED never-executed
  never-recorded; 1 MB batch byte cap); device registry with attestation-lite
  + refresh rotation (one-time-use chain, used_at reuse tripwire → revoke +
  alarm, the kill switch survives the failure response) + revocation with the
  pending-ops reconciliation queue and admin drafts.reassign; 4 maintenance
  jobs (inbox.retention 30d / tombstone.gc weekly / cursor.compact daily /
  feed.health 5-min); admin health aggregate (p95, outbox.lag gauge buckets,
  device.revoked.pending_ops, SyncPushFailSpike/SyncCursorStall alerts) — 15
  routes (devices ×7, sync ×5, admin ×3). `packages/sync-core` v1: runCycle
  engine, full-jitter retry, crash recovery + quarantine + cursor-reset
  re-bootstrap, row-budget LRU pruning, permission watermark; LOCAL_MIGRATIONS
  v2. Web: 3 platform screens (devices, sync-health, sync-reconciliation) +
  NAV_ITEMS rows; i18n 2926→3044. Contract `2026-11-04.1` (grace
  `2026-10-27.1`). **Tests: `apps/api/src/__db__/sync/` 9 files / 74 green**
  (chaos C-01..C-16, duplicates, device-security D, isolation Y — ledger oracle
  after every scenario; ~12 s wall vs the 15-min budget) + sync-core 36/36 +
  sales/pos regression 57/57; three production bugs found by the suites and
  fixed in-phase (BR-003 price gate on the POS autopost path, ITEM_INACTIVE
  vocabulary + resubmittable:false, the 1 MB push byte cap). Byte-exact LRU
  budgets + k6 sync-fleet staged-not-executed honestly deferred (021/025).

- 2026-11-03 — **PHASE-019 — CRM, Service Contracts & Projects (COMPLETE)**: the
  `crm` module (leads with conversion into partners, tasks/activities/reminders on
  the notification rails, service contracts with the recurring billing schedule,
  time entries + weekly timesheet review, service orders generalizing the
  PHASE-017 job cards with NO posting-rule fork) + the `accounting.projects`
  analytical dimension (journal-line stamping through the engine —
  PROJECT_NOT_FOUND/PROJECT_CLOSED fail-closed; GL filters; the cost-centers
  pattern) + the `industry.professional_services` template on the unmodified
  PHASE-015 engine. Migrations `0027_crm_projects.sql` (11 new RLS'd tenant
  tables + widenings incl. `journal_lines.project_id` +
  `manual_journal_lines.project_id` + the CoA marker **2130 DEFERRED_REVENUE** —
  the verified §2 gap) + `0028_crm_service_order_holder.sql`
  (stock_reservations.holder_type + SERVICE_ORDER). **The contract posts nothing;
  only its generated documents do**: billing runs (monthly pg-boss job + manual)
  generate DRAFT invoices through the REAL SalesInvoiceService — idempotent per
  (contract, period) via the contract_invoices partial uniques (double-fire and
  manual+scheduled overlap ⇒ ZERO duplicates, INV-013); LOCKED periods skipped +
  listed (INV-011); approval policies never bypassed (BR-034). **Deferred
  revenue**: advances tag against on-account receipt credit (BR-027) → policy ON
  posts **J-DEF [DR AR (partner, projectId) · CR DEFERRED_REVENUE]**; at invoice
  posting the contract-billing port fires **J-REL [DR DEFERRED_REVENUE · CR AR
  (partner, projectId)]** in the same UoW + the receipt→invoice allocation —
  revenue NEVER recognized before the billed period (the 2025-12 revenue == 0
  golden), INV-009 tied at every step. Reports registry 66→68
  (`services.contract_revenue_schedule` — GL tie tolerance 0 + the
  schedule=invoiced+draft+backlog reconciliation + ar.aging-matching overdue
  buckets; `services.time_billing_summary`). 45 routes (readonly-sweep
  violations 29→0); permission seeds 241→243; template activation
  (CURRENT_SHIPPED_PHASE 19, 6 manifest policies + the platform-only
  `crm.defer_advance_recognition`, templates-019.spec 7/7 incl. BR-038 switch
  safety). Web: 7 CRM screens + `/accounting/projects` + the GL project filter;
  i18n 2556→2926. **Full DB suite 106 files / 1687 tests ALL GREEN** (embedded
  PG16, migrations 0001–0028) + unit 404/404. The rental-logistics intake set
  (`crm.rental_contracts`, `crm.contract_deposits`, `crm.late_fees`,
  `distribution.shipment_tracking`) **deferred behind the decision record**
  (INDUSTRY_CATALOG + CAPABILITY_MATRIX §3 annotated — RISK-019/020).
- 2026-11-03 — **PHASE-018 — Manufacturing & Production (COMPLETE)**: migration
  `0026_manufacturing.sql` (schema_version 26) — 7 new RLS'd tenant tables +
  additive widenings + CoA markers + the template seed + permission/plan/role
  grants. `bills_of_materials` + `bom_lines` (versioned recipes per item —
  `uq (tenant, item, version_no)` + the partial-unique one-ACTIVE-per-item rule;
  `0 < yield_pct <= 100`; per-component `qty_per_output` + `scrap_pct`; DRAFT
  full-replace through the DELETE-granted lines; activate stamps `effective_from`
  and archives the previous ACTIVE). `production_orders` + `production_order_lines`
  (DRAFT → RELEASED → IN_PROGRESS → COMPLETED / CANCELLED-before-consumption with
  reason; the CANCELLED-shape CHECK; labor_rate/overhead_rate;
  `yield_snapshot` bound at release; fg_batch_id/fg_journal_id;
  fg/wip_credit/labor/overhead value columns; the `over_plan` variance flag on
  lines). `production_consumptions` (batch-tracked issue rows with per-slice
  journal refs + the partial index on batch). `production_scraps` (reason_code
  1..40 NOT NULL; value ≤ the order's WIP balance service-enforced). `inspections`
  (production_order\|goods_receipt targets with shape CHECKs; PASS\|FAIL +
  sampled/sample_size; dispositions ACCEPT\|SCRAP\|REWORK\|RETURN_TO_SUPPLIER
  required on FAIL by CHECK). Widenings: `item_batches.status` + QUARANTINED
  (FEFO/availability exclude it; explicit-batch issues throw BATCH_QUARANTINED),
  `stock_moves.source_type` + production_order, `warehouses.role` RAW\|WIP\|FG,
  `items.shelf_life_days`, `item_batches.production_order_id` produced-batch
  provenance (composite FK). CoA template markers: `1160 WIP` + `5120
  PRODUCTION_SCRAP` + the `5400` absorption group with `5410 PRODUCTION_LABOR` /
  `5420 PRODUCTION_OVERHEAD` (fail-closed PURPOSE_NOT_MAPPED at completion when
  the corresponding rate > 0). 8 permission seeds (`manufacturing.boms.manage`,
  `manufacturing.production_orders.{view,create,approve,post}` — approve/post
  RISKY — `manufacturing.qc.manage`, `manufacturing.genealogy.read`,
  `manufacturing.costing.read`; matrix 238 → 241 = the seed union drift-green) +
  plan grants (the seven `manufacturing.*` feature keys → business + enterprise;
  starter excluded) + role-template grants (owner/viewer/warehouse/accountant).
  `industry.food_manufacturing` seeded at v1.0.0 verbatim from the docs manifest.
  The `manufacturing` module: BomService (DRAFT→ACTIVE→ARCHIVED versioning;
  activate archives the previous ACTIVE; the multi-level explosion
  `round6(planned_qty × qty_per_output × (1 + scrap_pct/100) ÷ (yield_pct/100))`
  with cycle detection `BOM_CYCLE` + depth cap — property-proven composed
  level-by-level === single-pass; order planned lines are level-1 only, chaining
  via separate semi-finished orders); ProductionOrderService (release reserves +
  binds `PRD-{YYYY}-{SEQ:5}` per-branch INV-021 and snapshots the level-1
  explosion as order lines; consume through the inventory
  `planIssue`/`applyIssue` seam with `sourceType:"production_order"` —
  manufacturing never writes stock tables — one journal per call DR WIP · CR
  inventory at actual per-batch issue cost INV-018; consumption beyond plan ×
  (1 + threshold%) flags `over_plan` once + one dedupe-keyed inbox notification —
  never blocks, correction is an adjusted consumption; scrap reason-coded per
  policy, value ≤ current WIP balance (typed SCRAP_EXCEEDS_WIP), DR
  PRODUCTION_SCRAP · CR WIP, NO stock move; complete = the single completion
  journal DR FG inventory · CR WIP (materials) · [CR PRODUCTION_LABOR · CR
  PRODUCTION_OVERHEAD when rates > 0 — absorption inside the completion journal,
  no separate entry], FG receipt into a new batch with expiry = completedAt +
  shelf_life_days + producing-order provenance, quarantine when qc_gate=required,
  per-order WIP nets to EXACTLY zero, idempotent replay returns the stored result
  INV-013; cancel zero-consumption-only with reason; typed
  PRODUCTION_ORDER_STATE on illegal transitions; PERIOD_LOCKED fails closed);
  InspectionService (PASS releases quarantine with NO journal; FAIL+SCRAP → the
  qc_scrap posting DR PRODUCTION_SCRAP (reason QC_FAILED) · CR FG inventory
  account with the stock issue of the whole remaining quarantined batch;
  FAIL+REWORK stays quarantined; FAIL+ACCEPT operator-override audited;
  RETURN_TO_SUPPLIER record-only; GRN-attachable inspections);
  GenealogyService (read-only upstream/downstream/batch-summary walks over batch
  provenance + consumptions + sales edges — recall trace, never writes);
  ManufacturingReconciliationService (kind "WIP" INV-010: the GL WIP-purpose
  balance vs Σ per-order WIP; seeded drift ⇒ BROKEN + audit + inbox; wired into
  the PC-04 lock lists + the close checklist + `POST
  /api/v1/manufacturing/reconciliation/wip-check`). 24 routes under
  `/api/v1/manufacturing` (BOM CRUD + activate/archive + explosion; production
  orders CRUD + release/start/consume/scrap/complete/cancel; wip-check;
  genealogy upstream/downstream/batch; inspections list/get/create —
  route-permissions verbatim, envelope + Idempotency-Key, zod 6dp/4dp). The 3
  industry reports on the PHASE-013 contract (registry 63 → 66:
  `manufacturing.production_cost` with the production-materials-gl-tie tolerance 0,
  `manufacturing.batch_genealogy`, `manufacturing.qc_inspection_log` —
  ManufacturingQueriesService raw SQL via tenantTx, read-only). Template
  activation: CURRENT_SHIPPED_PHASE 17 → 18; the 4 POLICY/SETTINGS
  `manufacturing.*` keys (qc_gate, scrap_reason_required,
  fg_batch_expiry_from_shelf_life, consumption_variance_threshold_pct); 3 new
  golden effective-config pins + documented re-pins; templates-018.spec 7/7 incl.
  restaurant → food_manufacturing additive switch safety BR-038 (POS history
  untouched) + degraded-entitlement missingChain + restaurant prep-recipes hidden
  cleanly without the add-on. The §8 golden chain on the fixtures tenant (M-RAW /
  M-FG warehouses; dough v1 yield 80% + bread v1 two-level recipes): J1 consume
  8875.0000 · J2 scrap 443.7500 (WIP 8431.2500) · J3 dough completion DR INVENTORY
  8431.2500 · CR WIP (unit cost 8.875000, expiry +2d) · J4 bread consume 8554.6875
  · J5 bread completion DR 9117.1875 · CR WIP 8554.6875 · CR LABOR 375.0000 · CR
  OVERHEAD 187.5000 (unit cost 12.156250, expiry +5d) — WIP zero per order, the
  sale's COGS 1215.6250 ties. Web: the four manufacturing surfaces
  (`/manufacturing/boms` version registry + lines editor + explosion preview,
  `/manufacturing/orders` the order workspace with lifecycle bar + consume/scrap/
  complete dialogs + the over_plan chip, `/manufacturing/qc` the inspections
  console with the disposition matrix, `/manufacturing/genealogy` the recall
  search) + 3 report deep-links on the template-derived navigation + terminology
  (الوصفة / أمر الإنتاج / بوابة فحص الجودة / شجرة الدفعات); i18n parity 2348 →
  2556 (+208). Tests: 8 new db spec files (bom 11 incl. the property packs,
  orders 8, costing 9 — the golden chain exact, wip-recon 4 incl. seeded-drift
  BROKEN + PERIOD_LOCKED, qc 6 — the gate-on chain, genealogy 10 —
  forward/backward multi-level + read-only, industry-018 reports 11, templates-018
  7) inside the 96-file/1517-test suite on embedded PG16 (migrations 0001–0026) +
  the isolation suite extended to the 7 new tables; api unit 270/270 (25 files,
  reporting pins 66); contracts 46/46 (6 manifests — the food_manufacturing
  constant byte-equal to the seed); typecheck/lint 6/6; depcruise 0 violations;
  permissions-drift 241=241; docs validation 29/29; i18n parity 2556/2556. Docs
  authored in-phase: TABLES/manufacturing.md + ERD/manufacturing.md, the
  ENTITY_CATALOG manufacturing section, POSTING_ENGINE §4 production rows (consume
  / complete / scrap / qc_scrap), CHART_OF_ACCOUNTS labor/overhead purposes,
  FEATURE_CATALOG permission reconciliation, SUBSCRIPTION add-on wiring note,
  AUTHORIZATION_MATRIX rows, catalog flips. — PHASE-NNN

- 2026-11-02 — **PHASE-017 — Automotive & Distribution Templates (COMPLETE)**:
  migration `0025_automotive_distribution.sql` — 15 new RLS'd tenant tables +
  additive widenings + CoA markers + template seeds + permission/plan/role grants.
  Partners-owned `vehicles` (per-partner registry: make/model/VIN-shape chassis
  tenant-unique where set, plate, odometer readings; archive-only; service history is
  a read-only UNION ALL over sales-owned job cards / invoices / credit notes — the
  MODULE_BOUNDARIES §6 read precedent). Sales-owned `job_cards` + `job_card_lines`
  (DRAFT → IN_PROGRESS → COMPLETED → INVOICED + CANCELLED-with-reason;
  `parts_issue_mode` reserve\|issue_immediate; PARTS lines are STOCK-kind items with
  reservation/issue linkage, LABOR lines SERVICE-kind billed at estimated-hours ×
  per-hour rate; tombstone-based line full-replace — no DELETE grants). The
  `distribution` module's tables: `routes` + `route_customers` + `route_visits`
  (planning-only — no route/visit operation ever writes a journal), `van_stocks`
  (read-model mirror of Σ signed `stock_moves` scoped to VAN warehouses, refreshed
  inside the owning transaction, DELETE+INSERT grants), `customer_tiers` (the BR-003
  tier level; assignment rides `partners.customer_tier_id`), `free_goods_rules`
  (buy-X-get-Y, per-tier, reason-coded; the engine is pure — never posts),
  `rep_settlements` + `rep_settlement_lines` (STL- at post INV-021; expected =
  opening + cash sales + collections − refunds − expenses; variance ALWAYS posts
  BR-021-family with a reason for any non-zero, beyond-tolerance or an approval
  policy ⇒ creator≠approver BR-034; the (rep, date) day-lock; POSTED immutable —
  corrections are new documents; signed component lines Σ = expected, after post
  Σ = counted − deposit). `commission_runs` + `commission_run_lines` (one basis
  INVOICED\|COLLECTED per run; flat or tiered-band math with one rounding; exclusion
  note-lines explain basis mismatches; POSTED immutable). Additive: `warehouses`
  gains type VAN + rep binding (one van per rep; VAN rows inserted through the
  distribution store's documented VAN-slice with `inventory_account_id` NULL ⇒ the
  tenant INVENTORY purpose — the G-15 shared-account no-journal default),
  `sales_reps` commission rule columns, `sales_invoices` job_card_id/vehicle_id,
  `sales_invoice_lines` foc_reason_code (0018's net-positive CHECK re-issued
  `> 0 OR foc_reason_code IS NOT NULL` — BR-008 zero-price FOC lines legal exactly
  when reason-coded, still issuing stock and posting full COGS), `credit_notes`
  job_card_id, `stock_reservations` holder JOB_CARD, `stock_moves` source job_card,
  `cash_movements` source rep_settlement; CoA template markers `2150
  COMMISSION_ACCRUAL` + `5250 COMMISSION_EXPENSE` + the `4200 SERVICE_REVENUE`
  labor-revenue marker (fail-closed PURPOSE_NOT_MAPPED until mapped — the DR-016-02
  precedent); `industry.automotive` + `industry.distribution` seeded at v1.0.0
  (automotive pins the live report keys `inventory.valuation`/`ar.aging`); 7
  permission seeds (`sales.job_cards.manage`, `partners.vehicles.manage`,
  `distribution.{settlements,tiers,free_goods,van_stock}.manage`,
  `sales.commissions.manage` — matrix 238 = the seed union 0004+0024+0025
  drift-green) + plan grants (business/enterprise gain the distribution set +
  `sales.job_cards` + `sales.commissions`; business additionally
  `inventory.reservations`) + role-template grants (owner full set; sales
  job-cards/commissions/tiers/foc/settlement-create; warehouse van ops + routes;
  accountant settlement-approve + commissions). The job-card API (10 routes) with
  quotation-from-card through the REAL QuotationService (BR-006), approve reserving
  one JOB_CARD hold per PARTS line or issuing immediately, hours logging, invoice
  through the posting port (invoice with parts + labor revenue natures —
  SALES_REVENUE + SERVICE_REVENUE per line item kind, per-line VAT legs —
  invoice_line_id stamped per card line), cancel (never-cancelable once
  issued/invoiced; releases holds). Posting goldens: reserve = two revenue natures +
  flow-B COGS at invoice + holds→CONSUMED; issue_immediate = `job_card:issue_parts`
  DR COGS · CR INVENTORY at approval with per-line issue snapshots and exactly ONE
  COGS journal over the card's life; warranty credit note G-04/W-3 re-entry at the
  ORIGINAL issue cost; PERIOD_LOCKED/INSUFFICIENT_STOCK zero-residue packs. The
  distribution API (31 routes: routes CRUD + composition + idempotent plan-visits,
  the visit board check-in/complete/skip + missed sweep, van
  register/load-out/receive/unload as ordinary TRN- transfers — in-transit never
  sellable BR-016, mirror refreshed, conservation tie asserted, G-15 policy-none
  journal — settlements open/count/approve/post/cancel with the pending-documents
  gate + variance/deposit journals + INV-019 movement ties, tiers +
  free-goods-rules CRUD). The commissions API (7 routes; create+compute inline; post
  = the single accrual journal DR 5250 · CR 2150 dated period_to; COLLECTED basis
  over treasury_allocations → receipts → rep invoices; recompute excludes reversed
  sales via credit notes). Vehicles API (6 routes, typed chassis/duplicate/archived
  errors). BR-003 precedence chain proven (own list > tier > base; a quoted price is
  never overridden — the staleness gate re-resolves through the tier level). The 7
  industry reports on the PHASE-013 contract (registry 56 → 63:
  `automotive.job_card_profitability` with jc-parts-cogs-tie,
  `automotive.vehicle_service_history`, `distribution.rep_settlement` with
  settlement-gl-tie, `distribution.route_visit_compliance`,
  `distribution.van_stock_balances` with van-conservation-tie,
  `sales.discount_management_effectiveness`, `sales.commissions_due` with
  commissions-total-tie — all tolerance 0, reused permissions). Template activation:
  CURRENT_SHIPPED_PHASE 16 → 17; 11 new POLICY_REGISTRY keys; the FEATURE_DEPS
  `sales.job_cards` registration (deps `sales.quotations` + `inventory.reservations`);
  6 new golden effective-config pins + 7 re-pinned; grocery's
  `customer_price_tiers` flipped live; switch-safety retail → automotive → retail
  with zero data loss proven. Web: the seven 017 surfaces (job-cards workspace,
  vehicles registry + service history, routes & visit board, van stock, settlements
  console, tiers/free-goods editors, commissions) on the template-derived
  navigation + terminology; i18n parity 2348/2348. Tests: 78 new db tests on
  embedded PG16 (job-cards 5, job-card-posting 5, vehicles 13, distribution core 6,
  settlements 4, tiers-foc 18, commissions 11, industry-017 reports 10,
  templates-017 6) + regressions green (sales+pos 57/57 ×3, combined distribution
  38/38); api unit 267/267 (25 files); contracts 42/42 (5 manifests — the
  automotive/distribution constants byte-equal to the seeds); reporting unit 42/42
  (63 contracts); docs validation 29/29, manifests 5/5, permissions-drift 238=238.
  Docs authored in-phase: TABLES/automotive-distribution.md +
  ERD/automotive-distribution.md, ENTITY_CATALOG distribution-ownership
  reconciliation, POSTING_ENGINE §4 rows (job-card invoice/issue, settlement
  variance/deposit, commission accrual), FEATURE_CATALOG + capability/template
  catalog flips, SUBSCRIPTION add-on wiring note, AUTHORIZATION_MATRIX rows. —
  PHASE-NNN

- 2026-11-02 — **PHASE-016 — Point of Sale (COMPLETE)**: migration
  `0024_pos_core.sql`. The `pos` module lands as the terminal layer over sales:
  `pos_terminals` (registry per branch — code, till cash account binding, device link
  with one-terminal-one-device uniqueness, default warehouse, 80/58 mm receipt size,
  quick keys, ACTIVE/INACTIVE lifecycle only — documents reference terminals);
  `pos_tables` + `pos_checks` + `pos_kitchen_tickets` (the ledger-free floor: open
  checks carry a jsonb working-order document behind send/merge/transfer/split, and an
  unpaid check holds NO ledger effect — it converts to a `channel='POS'` sale at
  payment); `cashier_shifts` gains `pos_terminal_id` + `denominations` jsonb +
  `blind_count` (per-denomination blind count BR-021; writes stay treasury-owned);
  `sales_invoices` gains the POS channel columns (`channel` STANDARD/POS default
  STANDARD, `pos_terminal_id`, `order_type` DINE_IN/TAKEAWAY/DELIVERY/COUNTER,
  `pos_table_id`, `tenders` jsonb — the G-02 cash/card split); the narrow sync slice
  (`change_log` for the POS feed group items/barcodes/uoms/price_list_items/partners/
  tax_codes + `sync_cursors`; `tombstones` GC + `inbox_commands` remain 020); the
  `devices` pos-terminal slice (platform value + capabilities/tenant_id/terminal_id);
  the additive CoA template marker `1151 CARD_RECEIVABLE`; 4 permission seeds
  (`pos.terminals.manage`, `pos.sales.sell`, `pos.shifts.manage`,
  `pos.receipts.print`); plan grants (business/enterprise gain `pos.table_service`,
  `pos.kitchen_display`, `items.composite_products`). `PosSaleService`
  (`sales/application/pos-channel`): a POS sale IS a sales invoice — channel='POS',
  kind=CASH, BR-005 autopost with the `policy:pos.cash_autopost` sentinel, split
  tenders G-02 (DR till cash + DR the mapped CARD_RECEIVABLE — fail-closed
  PURPOSE_NOT_MAPPED until the tenant maps it once, DR-016-02), server-side
  `POS-{branch}-{yyMM}-{seq:5}` numbering, offline replay exactly-once (client UUIDv7
  + idempotencyKey + the (terminal, OFF-) triple dedupe — INV-013), typed rejections
  (PERIOD_LOCKED/PRICE_CHANGED/INSUFFICIENT_STOCK/CREDIT_LIMIT_EXCEEDED/
  VALIDATION_ERROR), returns as credit notes at original cost (G-04), the POS-WALKIN
  walk-in partner, and the shift capture feed to treasury. The `pos` API: terminal
  registry + manual device enrollment (revocation ⇒ DEVICE_REVOKED before execution),
  the shift flow (float, denomination grids, blind count, supervisor PIN), floor
  service (zones/tables/checks + kitchen tickets), receipts via the PHASE-013 print
  templates receipt-80/58 (AR/EN RTL-correct, the OFF- variant with the pending-sync
  notice), and the Z report. The narrow `sync` module: catch-up change_log writer,
  cursor pull with HMAC-signed opaque tokens, batch push ≤ 50 with per-item
  ACCEPTED/REJECTED/DEFERRED. `packages/sync-core` (NEW): storage-adapter contract +
  versioned local migrations for the POS subset, the outbox engine
  (QUEUED→IN_FLIGHT→ACKED/REJECTED + crash recovery), SyncClient, command builders,
  and the seeded-RNG chaos harness; `@erp/contracts` gains the sync wire schemas
  (`pos_sale`, `cashier_shift`, pull envelope, push results, rejection reasons).
  Web: `/[locale]/pos` (counter sale with the offline outbox in localStorage — OFF-
  numbering, honest PENDING_SYNC, auto-drain, typed rejection triage per DR-016-01),
  `/pos/floor`, `/pos/reconciliation` (Z report + OFF-⇄official pairs + rejection
  actions), `/pos/terminals`. Reports registered: `pos.sales_by_terminal`,
  `pos.sales_by_hour`, `treasury.shift_cash_reconciliation` (the two sales reports carry
  the pos-gl-tie assertion).
  Template activation: CURRENT_SHIPPED_PHASE 015→016; `pos.table_service` +
  `pos.kitchen_display` promoted to full FEATURE_CATALOG keys. Three §11 deviation
  decision records: DR-016-01 (web outbox via the localStorage bridge), DR-016-02
  (CARD_RECEIVABLE tenant mapping), DR-016-03 (devices on the identity table with
  session transport). Tests: chaos slice 8/8 green (C-01/03/04/07/09/16 + OFF-
  numbering + state honesty — packages/sync-core), API unit 257/257 (25 files), POS
  DB posting goldens green (cash G-02+COGS exact figures, split tender, offline
  replay exactly-once, PERIOD_LOCKED zero residue, G-04 return mirror), web tsc 0
  errors + i18n parity 2030/2030, 56 report contracts validated, docs validation
  29/29. — PHASE-NNN

- 2026-11-02 — **PHASE-015 — Industry Configuration Framework & Priority Templates
  (COMPLETE)**: migrations `0022_industry_configuration.sql` + `0023_notifications_categories.sql`.
  0022: `industry_templates` gains the registry lifecycle status (ACTIVE/DRAFT/RETIRED —
  the 004/008 seed stub becomes the engine-owned registry) + the three priority
  manifests seeded at v1.0.0 verbatim from the template docs
  (`industry.retail`/`industry.grocery`/`industry.restaurant`); `tenant_industry_config`
  — exactly one row per tenant (UNIQUE (tenant_id)): applied template key/version/
  manifest-hash, overrides jsonb (report_pins/onboarding_checklist/enabled_modules),
  BR-038 archived_terminology/archived_navigation/archived_capabilities snapshots +
  conflict_notes; `feature_flags` — the L8 platform rollout-flag table (global
  reference, no tenant_id/RLS, erp_migrate writes, app reads, seeded empty);
  `item_components` — composite-product definitions (tenant-composite FK pattern);
  both tenant-owned tables get the RLS macro. 0023: the `notifications`/
  `notification_prefs` category CHECK domains widen with `stock` (BR-019 reorder
  digests — alert only, never a PO) and `templates` (template upgrade offers) — the
  in-app inbox generalizes beyond the 014 billing-critical subset. The `configuration`
  module ships the ten-layer `resolveEffectiveConfig` engine (L1→L2→L3→L4→L5→L7→L8→L10
  merge with the precedence table, typed-key schema validation — unknown keys/type
  violations fail loudly, BR-040 dependency closure, content-hash tenant-static cache
  + §9 event invalidation, L6 request overlay — never cached across principals, L9
  navigation/terminology derivation — derived only, fail-closed); the apply service
  (bilingual activity→template resolution — null = plain onboarding, never a wrong
  guess; capability prerequisites: REQUIRED-missing ⇒ typed block with the exact
  missing chain, phase-gated entries labeled "coming with PHASE-016" with immediate
  back-office mode, OPTIONAL-missing ⇒ hidden; idempotent audited apply writing
  exactly one config row + tenant-level numbering series — R5 append-only, R3/INV-022
  no mutations of existing data); additive-only switch/extend (BR-038 R1–R10:
  no-writes preview diff, acknowledged switch archives terminology/navigation/
  capabilities read-only, unset-key conflicts resolved most-recently-applied-wins and
  recorded in conflict_notes, series append-only, switching back always possible,
  extend keeps the primary template with additive merges); the drift job (PATCH/MINOR
  ⇒ bilingual upgrade OFFER via the inbox, MAJOR ⇒ critical + migration note — never
  auto-applies); the terminology/navigation runtime (tenant addition > template >
  glossary; nav tree pruned by L4/L8/L6, POS items phase-gated not hidden). Supporting
  features: `items.composite_products` (component definitions + explosion at sale
  posting at component cost), `inventory.reservations` (hard pool with expiry sweep),
  `inventory.reorder_levels` (in-app `stock.below_reorder` digests, once-per-window),
  `purchasing.landed_costs` FULL workflow (value/qty allocation documents over posted
  GRNs with the remaining-qty constraint + COGS-adjustment posting). Industry reports
  over the PHASE-013 contract: `inventory.expiry_list` (age buckets + value-at-risk +
  FEFO pick, INV-010-tied), `grocery.expiry_writeoff` (EXPIRED/DAMAGE register tied to
  INVENTORY_SHRINKAGE journal debits), `retail.imei_register` (per-device in/out
  ledger with GRN/sale/return drills, INV-018-consistency assertion). Configuration
  API: session `GET /effective-config` + templates/activity-map/apply/preview/switch/
  extend/drift-check (Zod-strict, typed errors); UI surfaces: onboarding industry
  step, admin template management with diff preview, upgrade-offer notices. Contracts:
  `industry.template-manifest.v1` (zod mirror of industries/README §3 +
  `sha256` canonical hashing + the 3 frozen manifests) + the `pnpm validate:manifests`
  CI gate. Security: 3 new permission keys — `industry.templates.manage`,
  `industry.templates.switch` (risky — the additive-only twin of
  `configuration.templates.apply`), `industry.terminology.manage` — matrix 227=227
  drift-green. Tests: unit 257/257 (incl. permissions-drift) + the configuration db
  spec pack (template-apply/template-switch/degraded-entitlement/dependency-closure/
  engine + composites-golden/reservations-sweep/reorder-inapp/landed-costs/industry
  reports). — PHASE-NNN

- 2026-11-01 — **PHASE-014 — Subscription, Billing, Onboarding & Dashboards — MVP
  (COMPLETE, release tag `release/v1.0.0` — THE MVP GATE)**: migration
  `0021_subscriptions_billing.sql` — subscriptions lifecycle columns + the widened
  status domain (TRIAL/ACTIVE/PAST_DUE/GRACE_READ_ONLY/SUSPENDED/CANCELLED — the
  PHASE-004 subset stays valid); 6 RLS'd tenant tables (`subscription_invoices` — the
  billing history BOTH payment paths write identically; `billing_events` — append-only
  with `webhook:{id}` idempotency keys (replay protection); `usage_counters` — the §6
  read model; `notifications` + `notification_prefs` — the in-app inbox + preferences);
  `plans` marketing columns (bilingual positioning, annual price ⚠ PLACEHOLDER,
  highlight, sort order). Billing application: three self-serve plan seeds (every price
  0.0000 PLACEHOLDER per OQ-002 — pricing renders from seeds only); SubscriptionService
  — startTrial (Business entitlements materialized like paid, no parallel path),
  changePlan (§8 downgrade blockers named per limit), sandbox checkout
  (createCheckoutSession/completeCheckout), webhook ingest (HMAC-SHA256
  timingSafeEqual + 300 s staleness + idempotency gate — duplicate delivery is a
  no-op, INV-013 discipline), manual payment recording (`via_platform_admin` audited,
  mandatory reason) with IDENTICAL entitlement outcomes to the provider path (A-009),
  dunning → read-only grace → suspension wiring the PHASE-004 semantics (sessions
  killed, `tenant_suspended`), runDailyPass. UsageService: 80%/100% soft warnings
  (in-app + owner email), hard blocks ONLY on creation actions (require-limit
  decorator + guard) — documents/month NEVER blocks posting (INV-022,
  property-proven). Read-only grace = a first-class product state (typed
  `subscription_read_only` 403s with the bilingual resolving action; reports/exports/
  print/notifications/billing exempt and alive). Notifications module: in-app inbox +
  preferences + owner emails for the billing-critical set (limit warnings,
  subscription state changes, overdue, reorder). Dashboard widget registry per
  REPORT_CATALOG §14. Web: public bilingual pricing page, sandbox checkout
  workspace, billing home, owner dashboard (4 KPI tiles as LINKS to the bound
  report-contract runs — no parallel math), notifications center + bell, read-only
  banner/hook, onboarding Journey A6–A9 completed over the REAL controllers (honest
  skips, honest print-queue note), admin billing panel; i18n 1505→1723. Security
  review executed (docs/security/MVP_SECURITY_REVIEW.md — 0 prod criticals, findings
  F-01…F-05 triaged, zero open blockers, PHASE-024 pen-test split explicit).
  NFR-006: T-01 33 ms / T-02 10 ms / T-04 14 ms / T-06 156 ms AR + 160 ms EN / T-07
  0.000% (local harness; hosted k6 `k6/mvp-candidate.ts` staged = follow-up).
  First backup-restore rehearsal PASSED (runbook §8: RTO 0.7 s, post-restore
  INV-001/002/003/013 + RLS + parity 5/5 GREEN). Gate: ALL 17 local steps green
  (1153 db tests / 244 unit / visual 16/16 / CSP probe / docs 29/29). — PHASE-NNN

- 2026-11-01 — **PHASE-013 — Reporting, Statements & Printing (COMPLETE, tag
  `phase/013`)**: migration `0020_reporting_core.sql` — 2 tenant tables
  (`report_runs`: execution records with status QUEUED/RUNNING/SUCCEEDED/
  FAILED + stage, `params`/`params_hash`, `assertion_status`, result +
  assertions + artifacts jsonb, unique `(tenant_id, report_key, params_hash)`
  so idempotent re-runs replace their own artifacts — the stored result
  envelope is the export source of truth, "you print what you saw"; and
  `print_templates`: the per-tenant registry of the 4 code-defined base
  templates, synced from `packages/ui/print`, tenants pick locale variants
  and never author template logic); RLS macro on both + the isolation
  A-test registry with generated coverage. The `reporting` module: the
  code-defined contract registry — **48 contracts** = the REPORT_CATALOG
  §1–§7 phase-013 set — with boot-time zod validation (a malformed
  contract, an unknown permission, or a financial contract missing its §11
  assertion set fails startup — meta-tested); the executor with the inline
  path (p50 budget) and the pg-boss job path (`reporting-report-run`
  queue) where permissions are re-resolved at execution — a revoked grant
  kills a queued run FORBIDDEN_AT_RUN with zero partial artifacts (no
  TOCTOU); the as-of-keyed cache (60s current-TTL cap) invalidated by
  ledger events (journal.posted/period.locked via the new accounting
  ledger-events bus wired into PostingService.post + PeriodService.lock);
  and the assertion engine executing the FINANCIAL_REPORT_RULES §11
  minimum set at exact-decimal tolerance 0 — FAIL is stored on the run AND
  blocks export/print server-side with ASSERTION_FAILED. Financial
  statements exact per the rules: TB (one-side balances, zero suppression),
  GL (running balance + the INV-006 entry drill + gl-entry-balance), IS
  (contra aggregation via purposes SALES_RETURNS/SALES_DISCOUNTS, COGS
  section, YTD column, is-tb-tie), BS (RE composition counted once —
  bs-current-year-once; prior-year comparative re-derived), CF indirect
  (buckets by purposes/account groups; untagged lines display as
  "أخرى/Other" — the documented limitation; cf-cash-tie INV-019), the
  fiscal close pack as an archive-class job, journal-register, and
  cost-centers — consolidated by construction (journal lines carry no
  branch dimension in migrations 0001–0020; financial contracts declare
  branches "fixed-all" — FINANCIAL_REPORT_RULES §1 branch subsets land with
  a branch-dimensioned journal substrate). Operational contracts over
  module query services — 7 NEW application services
  (`sales-analytics`, `ap-analytics`, `inventory-queries`,
  `treasury-queries`, `partner-queries`, `tax-queries`, `user-queries`):
  AR/AP aging + statements + allocations (INV-009 ties) + partner
  balances; salesAnalytics.* (item/customer/rep revenue, payment-method
  split, pipeline conversion, branch revenue + sales-gl-tie);
  apAnalytics.* (supplier/item spend, PO status, matching exceptions +
  purchasing-gl-tie); inventory queries (on hand/movement/expiry/count
  variance/transfer log/serials/slow-moving + INV-010 tie); treasury
  queries (daily flow, receipts/payments registers, petty cash, expenses,
  shifts, bank recon + per-account INV-019 ties); the both-sides VAT
  return + summary-by-treatment (INV-012 tie via TaxQueriesService); and
  platform reports (audit-trail with the new actorId/action filters on
  AuditQuery, user-activity via the new UserQueriesService, report-runs,
  subscription-usage). Print/export system: `packages/ui/print` (NEW
  package surface `@erp/ui/print` — sanctioned in the erp-ui import-path
  rule which now allows the exact entry and bans deeper paths) with 4
  versioned templates — a4-document (tafqit amount-in-words verified per
  locale and per currency minor-unit incl. 3-dp KWD/BHD/OMR/JOD/IQD +
  bilingual legal footers), a4-report (assertion footers + freshness
  stamps), receipt-80, and receipt-58 (RTL rules — Western digits
  LTR-isolated, physical QR blocks, condensed 58mm) — over embedded woff2
  fonts (no system fonts, no network in render); the Chromium render
  service (playwright, pool bound 2 via Semaphore, 60s/300s timeouts,
  PDF/A-2b XMP identification stamping via pdf-lib — Chromium cannot emit
  conformance-level PDF/A; the stamp + artifact metadata record the
  archive class honestly); XLSX via exceljs (RTL sheet views, values-only
  with no formulas, typed columns); CSV UTF-8 BOM RFC4180; artifacts via
  the files module with sha256 + signed URLs (15 min) + audited export
  issuance. 8 routes under `/api/v1/reporting` (registry snapshot, POST
  report-runs, GET runs/:id, runs/:id/result, runs, POST runs/:id/exports,
  print-preview/:id, print-templates) in ROUTE_PERMISSIONS; errors
  FORBIDDEN_AT_RUN (403) + ASSERTION_FAILED / PARAMS_INVALID /
  CONTRACT_VERSION_MISMATCH (422) wired into the ErrorModelFilter.
  Security: 26 granular `reports.*.read` keys + `platform.reporting.read`
  seeded (0004 §3.8 + matrix — 224=224 drift-green) and granted to the
  viewer/accountant/owner templates (close pack accountant+owner; exports
  accountant+owner via `reporting.reports.export`); platform_admin key
  count 9→10; isolation A-tests registered. Web: the `/reports` workspace
  (report catalog grouped by category, declarative parameter bar, saved
  views as client-side parameter sets — no new tables per the phase
  constraint, run + polling, ReportViewer with group tree/check
  totals/assertion footer/freshness/drill links, export menu,
  print-preview iframe, run history) + the nav item `reports.workspace`;
  i18n 1465→1505 AR=EN. The dashboard widget seam is the §14 binding
  contract only (widgets land PHASE-014). Tests: registry meta-tests,
  cache/scope/assertions/tafqit/CSV/XLSX unit suite + the db suite
  (golden dataset envelopes, as-of byte-identical re-runs, run lifecycle
  incl. the FORBIDDEN_AT_RUN TOCTOU + idempotent artifact replacement,
  export block on seeded corruption, real-Chromium render with thead
  repetition + page count + the PDF/A stamp, isolation A-tests) — the full
  suite output is in the completion report. Known limitations documented
  honestly: no branch dimension on the journal substrate (statements
  consolidated); PDF/A-2b is an XMP identification stamp on Chromium PDF
  1.7 (conformance-level PDF/A is post-MVP with a dedicated processor);
  web E2E Playwright remains waived to first infra availability per the
  standing PHASE-003 owner directive (the @erp/ui visual harness +
  API-level HTTP tests cover the surfaces). — PHASE-013
- 2026-10-31 — **PHASE-012 — Sales & Receivables (COMPLETE, tag `phase/012`)**:
  migrations `0018_sales_core.sql` + `0019_sales_ar.sql` — 14 tenant tables
  (`sales_reps`, `quotations` + lines with the BR-006 validity CHECKs, `sales_orders`
  + lines carrying the optional soft-reservation reference (the PHASE-010 seam),
  `delivery_notes` + lines with the issue-cost snapshot (the W-3 provenance),
  `sales_invoices` + lines with BR-033 `tax_snapshot` stamps + `credit_check` jsonb +
  `offline_receipt_no`/`einvoice_status` reserved NULL (PHASE-016/023), `credit_notes`
  + lines with the mandatory `invoice_line_id` reference + reentry-cost snapshots,
  and the INSERT-only `sales_reallocations` + lines — the audited re-allocation
  trail, append-only by shape); `stock_moves.source_type` widened
  (delivery_note/sales_invoice/credit_note) + `cash_movements.source_type` gains
  `sales_invoice` (the G-02 counter payment, INV-019); the §6-mandated AR index
  `(tenant_id, customer_id, due_date)`; RLS macro on all 14 + the isolation
  registry with generated A-test coverage. The `sales` module: quotations BR-006
  (validity at send + accept + the expiry sweep; QOT- at SENT), orders SOR- at
  ISSUE with soft reservations honored by the availability netting, deliveries
  posting G-03 `DR COGS · CR INVENTORY` at issue cost through the inventory
  `planIssue`/`applyIssue` seam (sales never writes stock tables) and converting
  to revenue-only invoices with the DN issue-cost copied onto the invoice lines
  (BR-007 both flows first-class), invoices G-01 credit / G-02 cash / G-03
  with-goods W-1 exact (AR 1,380 / revenue 1,200 / VAT 180 with per-line
  output-VAT legs; official SAL- numbering at posting INV-021 proven under
  50-way parallel posts CC-03; BR-005 cash-autopost with the POLICY_ACTOR
  sentinel recorded distinctly from posted_by; BR-001 credit limits as a
  CREDIT-kind control — cash records ALLOW by shape, no credit exposure —
  enforced server-side at approve with the no-TOCTOU re-verification at post,
  the block/warn/allow × limit/overdue matrix with the exact
  8,200 + 2,500 > 10,000 math in the typed `CREDIT_LIMIT_EXCEEDED` payload,
  override via `sales.credit_check.override` audited; BR-003 price resolution
  with the PRICE_CHANGED staleness gate; BR-033 snapshots refusing a rate
  mismatch at post — never silently recomputing), credit notes G-04/W-3 exact
  (SALES_RETURNS 200 DR · VAT 30 DR · AR 230 CR + INVENTORY 120 DR · COGS 120 CR
  at the ORIGINAL issue cost — batch preserved, serial binds the originally sold
  unit BR-018; BR-004 window 14d/0 with the reference requirement never
  disabling; §3.4 explicit allocation — the invoice stays gross-open, the note
  its own subledger row, mirroring the accepted PHASE-011 debit-note model),
  receipts riding the PHASE-008 treasury service (G-05 settle + G-06 the W-2 FX
  gain/loss residual ±10 at the INV-008 stored rate; settlement + on-account
  control legs split explicitly BR-027), allocations with INV-016 bounds at post
  and CC-02 concurrency proven on the sales surface, audited re-allocation
  documents SRA- (from→to, to-NULL on-account, bounds, `receipts.allocated_amount`
  re-synced), AR aging buckets + customer statements as deterministic as-of
  recomputations (RC-10 byte-identical; BR-028 document currency + base totals;
  the INV-009 footer tie) + `verifyInv009`, RC-01 over 20 randomized AR ops OK +
  RC-03 seeded drift → BROKEN + PC-04 lock block on the PHASE-007 framework's AR
  kind, opening-AR settlement (G-16 AR side, INV-009 from entry #1), the
  `invoice.overdue` job exactly-once (audit-stamp dedupe), and sales-rep
  attribution on documents (commissions explicitly deferred to PHASE-017 —
  grep-clean). 51 routes under `/api/v1/sales` + `POST /partners/partners/:id/credit-check`
  (matrix §3.2 exact, risky keys audited). 27 sales db tests (golden G-01..G-06 +
  W-1/W-2/W-3 exact figures + PERIOD_LOCKED/NOT_SUBJECT/CC-01 zero-residue packs
  + the operations packs: BR-001 matrix ×4, BR-004 boundaries, BR-006 expiry +
  sweep, G-16 AR side, RC-01/RC-03/RC-10, overdue exactly-once, INV-016 + CC-02,
  re-allocations + the INSERT-only grant denial, CC-03 50-way contiguous) inside
  a 1044-test db suite. 5 AR/EN web screens (quotes+orders workspace, deliveries,
  invoices with the live credit-check decision panel, credit notes, AR
  aging/statement/open-items) + the sales nav group; print honestly marked
  "arriving with the PHASE-013 reporting release". i18n 1342→1465.
  TABLES/trade-sales.md column specs + ENTITY_CATALOG §sales line-table rows +
  the OFFLINE matrix PHASE-012 substrate note authored in-phase.
  `pnpm gate:local` ALL GREEN (evidence in the report). — PHASE-012
- 2026-10-30 — **PHASE-011 — Purchasing & Payables (COMPLETE, tag `phase/011`)**:
  migrations `0016_purchasing_core.sql` + `0017_purchasing_ap.sql` — 14 tenant tables
  (`purchase_requests` + lines with approval routing, `purchase_orders` + lines with
  BR-010 thresholds + linked revisions + BR-029 numbering at issue, `goods_receipts` +
  lines with the BR-012 po-less shape CHECK, `supplier_invoices` + lines with
  `match_result` jsonb recorded BEFORE approval + BR-033 `tax_snapshot` stamps + the
  per-line G-08 quanta (`grni_cleared_value`/`stock_revalue_value`), `debit_notes` +
  lines referencing the original invoice, `landed_costs` + `landed_cost_allocations`
  with the remaining-qty bound + the POSTED exact-split CHECK, and the INSERT-only
  `purchase_reallocations` + lines — the audited re-allocation trail, append-only by
  shape); the `stock_moves.source_type` CHECK expansion (goods_receipt/landed_cost
  provenance); the §6-mandated AP index `(tenant_id, supplier_id, due_date)`; RLS
  macro on all 14. The `purchasing` module: PR lifecycle with SoD, PO lifecycle with
  threshold routing against the PHASE-007 approval-policies substrate, the GRN service
  receiving stock through the inventory `planReceipt`/`applyReceipt` seam (batch
  capture at receipt; purchasing never writes stock tables — MODULE_BOUNDARIES held)
  and posting G-07 (`DR INVENTORY/expense · CR GRNI`) with the BR-012 policy (reason
  mandatory, forbid by setting, audited when allowed), the three-way match BR-009
  (tolerance matrix exact by default with the 2% worked examples both directions,
  partial-receipt 98/100 exception, dispositions with reasons, the service-level
  no-match-no-post guard, `purchasing.matching.override` risky + recorded), supplier
  invoices (BR-011 duplicate block/warn, G-08 posting clearing GRNI exactly incl.
  partial proportional clearing, VAT recoverability per pack + registration —
  RECOVERABLE/EXPENSED/NOT_SUBJECT all golden-proven), debit notes G-09 mirror
  corrections, payments riding the PHASE-008 treasury service (`purchasing.payments.*`
  keys; G-10 + the W-2 FX mirror honoring the stored rate INV-008) with audited
  re-allocation documents (BR-027 on-account both directions, INV-016 bounds under
  the CC-02 lock), the AP subledger tying to `AP_CONTROL` exactly (RC-02 over 20
  randomized ops + RC-03 seeded drift → BROKEN + PC-04 lock block; opening-AP
  settlement G-16 AP side, INV-009 from entry #1), aging buckets + supplier
  statements as deterministic as-of recomputations (RC-10 byte-identical; document
  currency + base totals BR-028), the GRNI register RC-09 registered into the
  PHASE-007 framework (live close-checklist item; GRNI BROKEN refuses the period
  lock), landed-cost baseline allocation (VALUE/QTY, remaining-qty constraint, the
  explicit COGS-adjustment split — never silent back-dating — via the new inventory
  revaluation seam), and supplier price-list consumption with BR-003 purchase-side
  provenance. 48 routes under `/api/v1/purchasing` (matrix §3.3 exact, risky keys
  audited, Idempotency-Key on POST actions); six purchasing settings keys
  (allow_po_less_grn, match tolerances, duplicate_invoice_behavior, input_vat_default,
  po_approval_threshold); 5 AR/EN web screens + the AP views (orders workspace,
  receipts + landed costs, invoices with the match-result panel — per-line
  PO/GRN/invoice triple with variance highlighting, debit notes, AP aging/statement
  with the INV-009 footer badge/GRNI register); i18n 1231→1342;
  TABLES/trade-purchasing.md column specs authored in-phase; ENTITY_CATALOG §purchasing.
  41 purchasing db tests inside a 939-test db suite (G-07…G-10 goldens + failure packs
  zero-residue, BR-009 matrix + BR-011 + BR-012 ×3 + BR-010 + SoD, RC-02/03/09/10,
  re-allocations + bounds + on-account, INV-021, CC-01 concurrent convergence, A7
  spoof parity + raw-plane RLS over the 14 new registry tables, landed-costs ×7,
  posting-smoke p95 58.4ms n=100); `pnpm gate:local` ALL GREEN (all 17 steps exit 0 —
  typecheck/lint/depcruise 1171 modules/permissions-drift 199=199/unit 183/db 939/
  build/contrast/i18n 1342=1342/ui-catalog 37↔60/visual harness 16 + axe 0 + perf/
  CSP probe 4/docs 29/29/negative proofs ×3).
- 2026-10-30 — **PHASE-010 — Inventory & Warehousing (COMPLETE, tag `phase/010`)**:
  migrations `0014_inventory_core.sql` + `0015_inventory_tracking.sql` — 13 tenant tables
  (`warehouses` branch-linked with the per-warehouse `inventory_account_id` G-15 override,
  `item_warehouse_settings` with the BR-019 once-per-window `last_reorder_alerted_at` stamp,
  `stock_moves` 🔒 append-only by grants (SELECT/INSERT only for erp_app — the A4 denial)
  + `trg_stock_moves_guard` (even superuser DELETE refuses — RC-05 asserts it), `stock_layers`
  with consumed rows kept at remaining 0 (Σ layer qty = on-hand exactly), `item_stock` the
  transactionally-maintained read model, `stock_transfers` + `stock_transfer_lines` with
  transit/posted shape CHECKs, `stock_adjustments` with the OTHER-requires-counter shape,
  `stock_reservations` (the §4 in-phase catalog addition — soft netting only), `item_batches`
  with the FEFO expiry index, `item_serials` with IMEI shape + sold/returned binding CHECKs,
  `stock_counts` + `stock_count_lines` with frozen-snapshot + variance jsonb shape CHECKs;
  the opening_balance_docs STOCK status lift + stock_moves↔batches/serials FK expand steps;
  RLS macro on all 13; the 0014 viewer-template correction (0005 pre-granted
  inventory.transfers.view/inventory.counts.view — matrix §3.5 says warehouse+owner only;
  PHASE-010's route surface made the drift observable, the module migration realigns it).
  The `inventory` module: warehouse service (activation/deactivation with in-flight guards),
  the movement core — one transaction per move: stock rows + `PostingEngine.post` + audit
  (INV-018; simulated-crash leaves neither), WAC + FIFO valuation engines (pure domain,
  6-decimal internal precision; oracle property suites: average within [min,max] of costs
  seen, valuation = Σ layer qty × cost), opening-stock posting consuming PHASE-006 stock
  drafts through the OPENING period (G-16 stock leg: DR INVENTORY · CR OPENING_EQUITY with
  per-item layers, idempotent replay), transfers DRAFT→IN_TRANSIT→POSTED (dispatch writes
  the OUT leg + G-15 journal only when the warehouses resolve distinct GL accounts — the
  policy-none same-account case asserted explicitly; receive writes the IN leg at conserved
  value; IN_TRANSIT netted out of availability BR-016), stock counts DRAFT→COUNTED→
  VARIANCE_REVIEW→POSTED (snapshot frozen at creation, blind mode, audited recount with
  note, BR-015 value-impact tolerance → supervisor override, approval posts G-13
  shrinkage / G-14 appreciation, INV-011 locked-period rejection with zero residue), FEFO
  batch issuing (BR-017) + expiry write-off as EXPIRED shrinkage, serial/IMEI registry
  with the original-unit return binding (BR-018), soft reservations + the availability
  service (on-hand − reserved − in-transit; expiry sweep), the nightly reorder job
  (BR-019: `stock.below_reorder` email digest via the notifications module — exactly once
  per 24h window per item-warehouse; no automatic POs exist, asserted), the INV-010/RC-04/
  RC-05 reconciliation check (movement trail + pending IN legs vs GL per resolved account,
  zero tolerance; orphan moves/journals surfaced; registered into the PHASE-007 framework
  with PC-04 lock block + the close-checklist inventory item live), method-lock +
  dated-revaluation method switch (INV-017: no in-flight movements, revaluation posting
  DR/CR inventory vs appreciation/shrinkage, past issues immutable, preview included), and
  manual reason-coded receipts/issues/adjustments (never a way around the engine).
  49 API routes under /api/v1/inventory (matrix §3.5 exact permission keys; risky
  inventory.items.method_switch / inventory.counts.post / inventory.adjustments.post
  audited; A7-parity 404s). Settings: `inventory.allow_negative_stock` (BR-013, default
  false) + `inventory.count_variance_tolerance` (BR-015, default 0). Web: المخزون /
  Inventory nav group live with 5 AR/EN routes (warehouses manager on the Settings
  archetype, stock on hand + the BR-016 availability drill, the movement ledger with
  direction/kind/warehouse filters + batch/serial columns, the transfer wizard with
  in-transit badge, and the count workspace — Journey D: item picking + blind mode +
  frozen sheet + variance review + recount + plain/supervisor approval); nav +5 items;
  i18n 1085→1231 AR=EN. Tests: 37 inventory db specs (G-13/G-14/G-15 both branches/G-16
  goldens + failure packs; INV-010/017/018; RC-04 mixed-ops green + RC-05 orphan drift →
  BROKEN + notification + PC-04 block + the documented superuser-tooling repair; FEFO +
  serial return-binding; CC-04 last-units race with zero residue; BR-013 negative-off
  default + explicit-on; the T-01 100k-move perf smoke with EXPLAIN-verified
  `ix_stock_moves_tenant_item_wh_date` use + suite-order cleanup; spoof A7 zero-residue)
  + the 12-test valuation property suite inside an 814-test db suite; the 438-test
  isolation suite covers the 13 new registry tables. `pnpm gate:local` ALL GREEN (all 17
  steps exit 0). Docs synced: ENTITY_CATALOG §inventory rows refined (+`stock_reservations`,
  +`stock_transfer_lines`), TABLES/trade-inventory §inventory column specs authored
  in-phase, GLOSSARY inventory terms unchanged (AR canonical already), OFFLINE matrix
  PHASE-016/020 notes stand.
- 2026-10-30 — **PHASE-009 — Tax Engine & Jurisdiction Packs (COMPLETE, tag `phase/009`)**:
  migration `0013_tax.sql` — 3 global reference tables (`tax_treatments` with return-box
  semantics for the six never-conflated treatments, `jurisdictions` with the full
  COUNTRY_PACKS §2 descriptor as jsonb + verification_status/verified_at shape, and
  `jurisdiction_tax_rates` with effective-dated versioned windows; NO RLS by design per
  TENANT_ISOLATION §3 — read-only grants to erp_app with INSERT/UPDATE/DELETE denials
  asserted; seed-only via erp_migrate) + 6 tenant tables (`tax_codes` tenant-unique with
  pack binding, `tax_registrations` with the REGISTERED-number shape CHECK migrating the
  PHASE-004 `tax.registration.*` settings (expand → dual-read window; contract step later),
  `tax_pack_bindings` for staged version pins, `tax_document_summaries` 🔒 append-only by
  grants + `erp.tax_summaries_guard()` (INV-012's document side — RC-07 drift is
  superuser tooling by construction), `vat_returns` with ready-revocation on cross-check
  failure, and `e_invoicing_submissions` schema-only per FEATURE_CATALOG "023 (schema
  009)"); the expand step wires `items.tax_code_id` + `item_categories.default_tax_code_id`
  + `expenses.tax_code_id` composite FKs. Seeds: 6 treatments + **all 10 packs**
  (SA 15% from 2020-07, AE 5% from 2018-01, BH both asserted windows 5%→10% across
  2022-01, OM 5% from 2021-04, EG 14% from 2017-01, JO/GST 16% from 2018-01; KW/QA/YE/IQ
  ship fully with NO rate rows) — every row carries source_ref + verified_at NULL
  (REQUIRES_VERIFICATION — directive §1.12–1.13; the NO-fabrication gate: SA's unasserted
  pre-2020-07 rate ships no row, documents before the window fail closed
  NO_RATE_FOR_DATE). The `tax` module: the pure deterministic resolver (rate snapshots
  stamped on lines BR-033 + draft-spanning boundary warnings; INCLUSIVE extraction within
  the same rounding rules; NOT_REGISTERED + NO_VAT/VAT_PLANNED modes; REVERSE_CHARGE
  self-accounts at the standard rate — baseline-labeled), codes/registrations/packs
  services (audited; reference-guarded archive; preview→apply with audit), the posting
  adapter (the G-11 expense VAT leg: DR EXPENSE net · DR VAT_RECOVERABLE tax · CR CASH
  gross with the golden updated; OUTPUT-lines + summary-recording seams for
  PHASE-011/012), the VAT return v1 (deterministic aggregation, INV-012 side-by-side
  cross-check gating READY, ready-revocation on drift, CSV/XLSX export via the files
  module, mark-filed as the audited human action), the INV-012 check (RC-06) registered
  into the PHASE-007 framework with PC-04 lock block + the close-checklist tax item live,
  and the EInvoicingAdapter port + fake adapter (RISK-005 UNVERIFIED refusal asserted;
  lifecycle walkers PENDING→…→ACCEPTED/REJECTED in tests). Frozen contracts
  `tax.snapshot.v1` / `summary-group` / `document-summary` / `resolved-line` /
  `pricing-mode` in @erp/contracts. 27 API routes under /api/v1/tax (permission-gated
  incl. the risky tax.registrations.manage/tax.returns.mark_filed keys, A7-parity 404s).
  Web: 4 AR/EN routes (الإعدادات: tax codes manager with resolve preview, registrations,
  pack viewer with versions/apply; التقارير: VAT return workspace with the cross-check
  side-by-side + export); nav registry +4 items; i18n 974→1085 AR=EN. Tests: 90 tax db
  specs (10 per-pack suites × the 7 engine-level scenario classes + NO_VAT modes + 2-dp/
  3-dp rounding worked examples + byte-identical determinism + return-prepare; VAT
  return RC-06/RC-07 + registration migration + adapter lifecycle + BR-033
  snapshot-preservation under a simulated version bump + grants denials; spoof A7/A8)
  inside the 699-test db suite; treasury G-11 golden gains the VAT leg. `pnpm gate:local`
  ALL GREEN. Docs synced: ENTITY_CATALOG §tax, TABLES/tax-compliance (authored to the
  delivered schema — doc-reality reconciliation recorded), ERD/treasury-tax, the 10
  compliance-matrix §9 implementation-status notes (pack seeded, fixtures executed,
  remaining scenarios mapped to 012/013/023), DEPENDENCY_RULES §2 treasury→tax edge.
- 2026-10-30 — **PHASE-008 — Treasury: Cash, Banking & Expenses (COMPLETE, tag `phase/008`)**:
  migration `0012_treasury.sql` (11 tenant tables — cash_accounts 1:1 to CoA accounts,
  append-only cash_movements 🔒 by grants + guard trigger, receipts/payments with posted-shape
  CHECKs, treasury_allocations with exactly-one-doc CHECK + partial uniques, expense_categories,
  expenses with reserved tax_code_id, cash_transfers with fee CHECKs, cashier_shifts with
  one-open-per-account partial unique, bank_statements idempotent by (tenant, file_hash),
  bank_statement_lines informational-only; reconciliation_runs kind widened with BANK_REC,
  file_objects owner widened with EXPENSE; all RLS'd + composite-FK'd + registry-isolated).
  The `treasury` module: account service (open requires mapped GL, close preserves history,
  balance ≡ Σ movements), receipt/payment services (DRAFT→POSTED via `PostingEngine.post`,
  RCV-/PAY- numbers INV-021, FX capture), allocation service (FIFO suggest, partials,
  INV-016 bounds under the open-item row lock CC-02, BR-027 on-account remainders),
  SettlementCore realized-FX posting (cash at current rate · control at the original
  stored rate INV-008 · explicit FX_GAIN/FX_LOSS residual with references — gain and
  loss goldens), petty-cash guard (BR-020 caps + override with audit, PLACEHOLDER defaults
  documented OQ-002), transfer service (G-12 with BANK_CHARGES), expense service (BR-023
  per-category approvals + receipt attachments via files), shift service (BR-021 worked
  example −2.50 posts with the shift as source; supervisor id+PIN above tolerance),
  statement import (adapter registry: generic-csv with Arabic-header mapping + generic-xlsx;
  sha-256 idempotency; 5000-row cap), bank-rec service (auto-match amount+window+reference,
  exact manual match, unmatched aging both sides, BR-022 per-account period lock), and the
  INV-019/RC-08 cash reconciliation check registered into the PHASE-007 framework (seeded
  drift → BROKEN + notification + PC-04 block; close-checklist cash + bank-rec items live).
  62 API routes under /api/v1/treasury (A7-parity 404s, Idempotency-Key guard, 37 treasury
  error codes typed in the ERROR_MODEL filter). Web: the الخزينة / Treasury nav group live
  with 12 AR/EN routes (accounts + movements drill-down, receipts/payments list/create/
  detail with the allocation editor + live exact-math totals bar, expenses + categories,
  transfers, shifts, bank-rec wizard → match grid → aging → lock); `ShiftPanel` pattern in
  @erp/ui (headless cashier console, exact-decimal expected math, supervisor PIN, 4 stories,
  AR+EN baselines; exact-decimal extracted so MoneySummaryBar shares it — ADR-0009); i18n
  733→974 AR=EN. **Reality-audit repairs (pre-existing latent defects found by this phase's
  gates)**: db-suite file-order couplings on the shared FY2026 — gl-perf posted into
  September that periods.spec soft-closes (observed live once treasury's 5 spec files
  perturbed vitest's scheduling), accounting/golden's FX-reval posted into September +
  October, concurrency's May, INV-011-022's March/April/May — every state-mutating suite
  now restores the pristine all-OPEN state in afterAll (`restorePeriodsOpen`), the INV-022
  fuzz corpus's flipped settings (incl. fx_revaluation_enabled) are restored, the treasury
  G-11 golden find-or-creates the T-RENT category, and master-data-flows reuses the
  isolation suite's canonical MAIN branch row id; order-independence proven with
  `--sequence.shuffle.files` across 4 seeds (default order + seed 7 fully green; seeds
  42/13/99 fail only on two pre-existing documented classes — the isolation suite's
  pristine-count design that requires it to run before row-adding suites, and the email
  suite's 10s queue deadline under a late-run loaded queue — both satisfied deterministically
  by the default gate order). Evidence: 572/572 db tests (43 treasury: goldens
  G-05/G-06+loss mirror/G-10+mirrors/G-11/G-12 with failure packs zero-residue, INV-016/019,
  CC-02, RC-08 drift, spoof S-04/A7, BR-020..023), `pnpm gate:local` ALL GREEN (typecheck,
  lint, depcruise, permissions-drift 199, unit 133, db 572, build, contrast, i18n 974/974,
  ui-catalog 37↔60, visual harness 16 + axe 0 + perf, CSP probe 4, docs 29/29, negative
  proofs ×3). Docs: TABLES/treasury-tax.md authored (the phase's §8 obligation), ERD
  treasury-tax.md refreshed (receipts/payments/treasury_allocations added), ENTITY_CATALOG
  treasury rows completed, FEATURE_CATALOG cheque-deferral note carries the PHASE-008
  provenance, PHASE_ACCEPTANCE_CRITERIA 008 row enriched, PERIOD_CLOSING cash/bank-rec
  items now live. (reports/PHASE-008-COMPLETION.md)
- 2026-10-30 — **PHASE-007 — Accounting Core & Posting Engine (COMPLETE, tag `phase/007`)**:
  migrations `0010_accounting_core.sql` + `0011_journal_tables.sql` (fiscal_years/fiscal_periods
  with no-overlap exclusion + OPENING/CLOSING windows, exchange_rates dated, cost_centers tree,
  recurring_journals, approval_policies, reconciliation_runs, numbering store per ADR-0006;
  journal_entries/lines append-only with `uq_journal_entries_tenant_source_op` (INV-013),
  balance + immutability + period-lock guard triggers, tenant-first hot indexes; all RLS'd +
  composite-FK'd + registry-isolated). The `accounting` module: CoA readiness service (V1–V6,
  purpose resolution fail-closed), period service (PC-01…PC-04, reopen + anti-fraud alert),
  FX service, the **posting engine** (ADR-0007: pure domain package, validation pipeline 1–8
  in order, verbatim error taxonomy, INV-001…022 enforcement, reversal-only correction),
  posting orchestration (JE-{yyyy}-{seq:6} numbering, insert-conflict idempotency CC-01),
  manual journals (draft→submit→approve→post lifecycle, SoD default-OFF), recurring journals
  (pg-boss draft generation, never auto-posts), approval policies (BR-034 base-currency
  thresholds), GL queries (trial balance, movements with running balance, journal register,
  INV-006 drill-down + EXPLAIN evidence), opening-balance posting (G-16, per-partner AR/AP
  subledger rows from entry #1 via the partners subledger port), year-end close (PC-05/06/07,
  idempotent, unit-reversible), reconciliation framework (RC-01…RC-03 AR/AP checks) + close
  checklist service (NOT_APPLICABLE explicit). Partners module gained the subledger-write api
  (same-transaction, module-boundary sanctioned). Web: the accounting navigation group live
  with 8 screens (CoA editor + purposes, journal list/detail/workspace on the JournalEntryGrid
  archetype-4 pattern with MoneySummaryBar live Δ, GL browser with drill-down, period
  management + checklist + reconciliation + year-end, approvals queue on the ApprovalsQueue
  pattern, rate editor, opening-balances post step); i18n 320→733 keys AR=EN; `JournalEntryGrid`
  + `MoneySummaryBar` + `ApprovalsQueue` patterns in @erp/ui with catalog rows + AR+EN
  baselines. **Reality-audit repairs (pre-existing latent defects found by the phase's own
  gates)**: Radix tooltip ≥1.1 requires a Provider — the primitive crashed every provider-less
  consumer (the overlays story baseline had captured a crashed error stack; the real app's
  collapsed sidebar would white-screen) — the primitive is now self-contained; the Tabs
  wrapper never mounted TabsContent (dangling `aria-controls`, axe critical — the real
  opening-balances console was affected) — content routing added (data-slot + fallback);
  Combobox clear-button + trigger naming and MoneyInput input labels added (grid cells now
  carry per-cell aria-labels); new `--erp-width-journal-grid` token through the DESIGN_TOKENS
  governance path. Evidence: 460/460 db tests (invariants INV-001…009/011/013/014/015/020/021/022,
  golden G-16/G-19/G-20 + engine goldens, CC-01/03/05/06, PC-01…PC-07, RC-01…RC-03, posting
  smoke p95 ≪ 500 ms local k6-equivalent), 171 unit tests, visual harness 16 passed (73→87
  baselines AR+EN), `pnpm gate:local` ALL GREEN —
  [reports/PHASE-007-COMPLETION.md](../implementation/phases/reports/PHASE-007-COMPLETION.md).
- 2026-10-29 — **PHASE-006 — Master Data (COMPLETE, tag `phase/006`)**: migration 0009 (15
  tenant-owned tables: partners + contacts/addresses, credit_terms, item_categories, items,
  uoms, uom_conversions, barcodes, price_lists, price_list_items, opening_balance_docs
  DRAFT-locked, partner_balances read model, file_objects attachment linkage, import_jobs;
  pg_trgm+btree_gin AR/EN search indexes; branches.default_price_list_id). Partners module:
  BR-025 auto-coded directory (P-000001…), contacts/addresses, BR-026 system terms, the BR-001
  credit-check interface (warn default over DRAFT exposure), opening-balance DRAFT capture
  (G-16 source; zero-posting proven: no journal tables exist). Items module: categories tree
  (cycle-proof), items (tracking-flag matrix, tax_code_id FK deferred to PHASE-009), UoM
  registry with exact-decimal conversions (compose-exactly property test), scan-unique
  barcodes, price lists + tiers, and the BR-003 resolution service (customer list → branch
  default → base price, with provenance + per-UoM exact conversion). Preview-gated import
  engine (CSV+XLSX, AR+EN headers, dry-run row reports, duplicates blocked/warned, commit
  idempotent per upload token via pg-boss, U-07 zip-bomb guard) + bounded signed-URL exports.
  Attachments wired through the PHASE-002 files module (U-01…U-07, A11). Trigram search in
  CommandMenu + PartnerPicker/ItemPicker patterns (catalog-covered) + headless hooks.
  Evidence: 328/328 db tests (168-test A1–A10 suite over all 27 registered tenant tables),
  10k-row perf ≤ 200 ms with EXPLAIN index proofs, S-04 no-existence-disclosure, 12/12
  acceptance criteria — [reports/PHASE-006-COMPLETION.md](../implementation/phases/reports/PHASE-006-COMPLETION.md).
- 2026-10-29 — **PHASE-005 — Design System, i18n & RTL Foundation (COMPLETE, tag `phase/005`)**:
  `@erp/ui` 1.0.0 (ADR-0016) — token layer byte-verbatim to DESIGN_TOKENS (§16 contrast gate
  in CI), Radix primitives (single legal import site), catalog components (DataTable
  virtualized-to-10k with grid semantics; MoneyInput §6.2 decimal-string contract;
  DatePicker/DateRangePicker canonical-Gregorian + `islamic-umalqura` display; DocumentStatusBadge
  + DocumentActions §6.4 fixed vocabulary; overlays/toasts/states/navigation) + AppShell with
  server-resolved entitlement-driven navigation (contract registry + pure resolver +
  GET /tenancy/navigation). AR+EN visual harness (Storybook --test frozen-clock → Playwright
  threshold-0 ×65 baselines, axe-in-harness 0, geometry invariants, both-direction coverage
  check, §3 quarantine). Four erp-ui lint rules + negative meta-tests. i18n dictionaries
  310→320 (triple parity). CSP middleware + §8 probe. S-03 bidi payload suite. All 18 web
  screens migrated; provisional styling removed. Gates: 42+58+38+11 unit, 207/207 db,
  harness 16+1, CSP 4/4, docs 29/29. Discovered+repaired: PHASE-003's inline
  no-physical-direction rule was structurally dead (create() nested in meta) — replaced.
  Evidence: implementation/phases/reports/PHASE-005-COMPLETION.md.
- 2026-10-28 — **PHASE-003 — Identity, Multi-Tenancy & Audit (COMPLETE)**:
  migrations `0003_identity_core.sql` (9 identity tables per TABLES/tenancy-identity;
  composite tenant FKs; variant command-specific RLS for roles/role_permissions +
  `template_seed` path TO erp_migrate — templates readable for cloning, never
  forgeable/mutable/deletable by the app role; `audit_events.actor_id → users(id)`
  expand-FK), `0004_permissions_seed.sql` (199 keys verbatim from AUTHORIZATION_MATRIX
  §3 — drift checker `scripts/check-permissions-drift.ts` in the gate), and
  `0005_system_role_templates_seed.sql` (9 templates, 413 grants). New role
  `erp_definer` (NOLOGIN BYPASSRLS) owns the pre-GUC SECURITY DEFINER projections
  (`user_membership_options`, `user_effective_permissions`, `invitation_by_token`) —
  FORCE RLS binds even the table owner, so definer ownership MUST bypass. Identity
  module: argon2id (64 MB/3/1, per-hash params), opaque rotating sessions (12 h
  absolute re-anchored on rotation / 30 min idle), progressive lockout (5 → 15 min,
  never permanent) + per-IP windows, TOTP MFA (RFC 6238, replay-rejecting timestep
  tracking, hashed single-use recovery codes), stateless HMAC reset tokens bound to
  the user version (single-use; documented deviation — no resets table in the 9-table
  set), 72 h single-use invitations. RBAC: `@RequirePermissions` guard + route
  registry (`infra/auth/route-permissions.ts`) + generated checklist test;
  `identity.mfa.manage` is runtime self-scope. Tenant-context interceptor wraps
  handlers in the `withTenant` UoW (S-02 suspension → 503 TENANT_SUSPENDED).
  Notifications skeleton: AR/EN plain-text templates, minimal SMTP client
  (EHLO/STARTTLS/AUTH PLAIN/DATA), pg-boss `notifications-email` queue with
  deterministic-UUID dedupe. Web (apps/web): BFF session cookie (httpOnly/Secure/
  SameSite=Lax) + CSRF double-submit + generic proxy; provisional screens login /
  forgot-password / accept-invitation / users / sessions / mfa / roles / settings
  with typed AR/EN dictionaries (~115 keys, parity-asserted). **Verified against
  embedded PostgreSQL 16: 105/105 db tests** — generated isolation suite A1–A10 ×
  every registered tenant-owned table (36) + registry negative proof, flows (20:
  R-01/02/03/05, M-01/02/04/06/07/08/10, S-01/02/03, invitations, checklist),
  HTTP end-to-end (12: 401/403+audit/200, oracle-uniform login, idempotency 422,
  MFA 423, reset-200-always), email over a real SMTP session (5); 58 api unit
  tests; typecheck/lint/depcruise/drift/web gates green. House rule discovered:
  tsx/esbuild emits no decorator metadata — all Nest DI uses explicit `@Inject`
  tokens. Waivers: mailpit capture + Playwright journey (first Docker/host),
  Testcontainers (standing), same class as PHASE-001/002 items.
  — PHASE-003

- 2026-10-28 — **PHASE-002 — Database & Migration Infrastructure (COMPLETE)**:
  migrations `0001_core_infra.sql` (roles erp_migrate/erp_app/erp_readonly — no
  passwords in SQL; `erp.current_tenant_id()` GUC; minimal `tenants`; append-only
  `audit_events` with grants + `erp.audit_events_guard()`; RLS ENABLE+FORCE;
  `boss` schema) and `0002_rls_macro.sql` (`erp.apply_tenant_policy()` macro +
  `erp._schema_state` readiness mirror); drizzle-kit workflow (`NNNN_description.sql`
  + journal); `withTenant()` unit-of-work (transaction-local GUC, ALS, transactional
  audit appends); pg-boss queue client + worker mode (`WORKER_MODE`); files module
  (S3 adapter, tenant-prefixed keys, signed URLs, upload constraints — A11); pino
  logging with X-Request-Id correlation + redaction; OTel api no-op wiring;
  `/health/ready` (DB + migration state + queue liveness); CI checkers
  (`scripts/check-rls.ts` RLS presence + ENTITY_CATALOG drift; `scripts/ci/migration-tests.ts`
  Testcontainers runner + ci-db.yml). **Verified against embedded PostgreSQL 16**:
  attack suite A1–A5/A10 zero leaks, append-only rejection (grants 42501 + trigger
  P0001), pg-boss dedupe (one execution for duplicate enqueues), signed-URL
  round-trip + expiry + A11, readiness `{db: up, migrations: up, queue: up}`; full
  gate green (typecheck/lint/depcruise/78 unit/32 db/build/docs 29–29/meta-test).
  Scoped repairs: compose/DEVELOPMENT_SETUP database naming unified (`erp`);
  DEVELOPMENT_SETUP filter names fixed (@erp/api); ci.yml `branches: [main]` typo
  repaired; Dockerfile runtime entry switched to the tsx workspace-source model
  (ADR-0002; production bundling stays PHASE-014+). Report:
  [../implementation/phases/reports/PHASE-002-COMPLETION.md](../implementation/phases/reports/PHASE-002-COMPLETION.md);
  tagged `phase/002`. — PHASE-002
- 2026-10-28 — **PHASE-001 flip to COMPLETE**: full local gate re-verified green after
  the blueprint v2.0 docs merge (`pnpm gate:local` exit 0 — typecheck, lint,
  boundaries, 51 tests, build, docs validation **29/29**, negative meta-test); the two
  infrastructure-bound evidence items (first hosted-CI green run, `docker compose up`
  healthcheck) are **waived to first infrastructure availability by project-owner
  directive (2026-10-28)** — recorded as follow-up obligations in
  [../implementation/phases/reports/PHASE-001-COMPLETION.md](../implementation/phases/reports/PHASE-001-COMPLETION.md)
  §Deferred evidence; tagged `phase/001`. — PHASE-001/DECISION
- 2026-10-28 — **Blueprint v2.0 — Platform Depth & Breadth Expansion**: 9 new phases
  (PHASE-026…034) in stages 9–11 — financial depth (fixed assets, cheques/notes/PDC,
  installments, budgeting, payroll) + 5 industry templates (wholesale, electronics,
  healthcare, education, agriculture commercial shells) + multi-entity consolidation
  (ADR-0018); 6 new modules/38 feature keys/23 entities/16 purposes/G-21…G-32/
  INV-023…026/BR-041…056/17 reports/10th navigation group; governed by
  [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) ED-01…ED-19; MVP (PHASE-014) and GA
  (PHASE-025) gates unchanged. — BLUEPRINT/DECISION
- 2026-10-28 — **PHASE-001 — Repository & Engineering Foundation (IN_PROGRESS)**:
  pnpm + Turborepo monorepo scaffolded — `apps/api` NestJS skeleton (`GET /health/live`,
  runtime smoke HTTP 200), `apps/web` Next.js `[locale]` AR/EN RTL/LTR skeleton
  (SSG both locales), desktop/mobile/ui README stubs, `packages/domain-core`
  (UUIDv7, Money/Quantity/Rate per ADR-0009 with half-up rounding and 3-decimal
  currencies, Result, CalendarDate; 38 tests), `packages/contracts` (registry v0,
  error-code seed, wire schemas; 11 tests), `packages/config` (strict tsconfig,
  ESLint with module-boundary enforcement + money/RTL custom rules, Prettier);
  `dependency-cruiser` graph rules; Docker Compose dev stack; GitHub Actions CI
  (gitleaks, docs validation, negative boundary meta-test); CODEOWNERS; root
  README/AGENTS. All local gates green (`pnpm gate:local`); scoped repairs: ADR-0002
  desktop/mobile phase refs corrected (canon 021/022), DEVELOPMENT_SETUP package
  filter names fixed. Pending for COMPLETE: first CI green run + compose
  healthcheck (see
  [../implementation/phases/reports/PHASE-001-COMPLETION.md](../implementation/phases/reports/PHASE-001-COMPLETION.md)).
  — PHASE-001
- 2026-10-28 — **Blueprint v1.1 — Consolidation**: Folder 3 adopted as the canonical
  baseline; audited ideas from competing plans integrated and all dispositions recorded.
  10 defect corrections (DEF-001…DEF-010, two HIGH: money wire-regex conflict; ledger
  balance trigger made DEFERRABLE), 12 consolidation decisions (CD-01…CD-12), new
  ADR-0017 (no event sourcing), 14 authoritative summary documents
  (ARCHITECTURE_BASELINE + domain summaries + registers + validation report), 8
  industry manifests extracted to machine-readable JSON
  (`industries/templates/manifests/`), 2 validation scripts (`scripts/`), 23/23
  deterministic doc checks green. See [../CONSOLIDATION_VALIDATION_REPORT.md](../CONSOLIDATION_VALIDATION_REPORT.md)
  and [../CONSOLIDATION_REGISTER.md](../CONSOLIDATION_REGISTER.md). — BLUEPRINT
- 2026-10-27 — **Blueprint v1.0**: complete documentation blueprint created — 202
  documents, 16 ADRs, 25 phase documents, 8-stage roadmap, 22 accounting invariants
  (INV-001…022), 40 business rules (BR-001…040), 10-country compliance matrices with
  verification flags, cross-document validation performed
  ([VALIDATION_REPORT.md](VALIDATION_REPORT.md)). Repository tagged `blueprint/v1.0`.
  No application code exists yet. — BLUEPRINT
- 2026-10-27 — Post-blueprint consistency fixes: phase-numbering drift corrected
  (ADR-0012 POS subset → PHASE-016; DEPLOYMENT client distribution → 021/022;
  OQ-004 ZATCA implementation → PHASE-023; OBSERVABILITY sync-health → PHASE-020;
  MODULE_BOUNDARIES configuration module → P-004/015 and sync tables aligned with
  ENTITY_CATALOG); PHASE_ACCEPTANCE_CRITERIA.md restored; permission-key
  reconciliation note added to FEATURE_CATALOG (AUTHORIZATION_MATRIX canonical);
  TABLES/tax-compliance.md added (referenced by E_INVOICING_ARCHITECTURE); phase
  template/README wording clarified (29 mandatory items mapped to 8 sections). — DOCS

- 2026-10-28 — PHASE-004 COMPLETE (tag `phase/004`): Tenant Provisioning &
  Platform Administration — public registration (per-IP + global rate limits,
  atomic tenant+owner+trial+audit), provisionWorkspace idempotent CoA
  instantiation (42 accounts + 16 purposes + 8 roles + numbering/fiscal/
  jurisdiction defaults), branches + branch-scoped membership enforcement,
  typed tenant_settings (L5) with §9 invalidation events, entitlements service
  with BR-039 server-side enforcement + BR-040 dependency-closure validation
  (PLACEHOLDER plans per OQ-002), rule-6 lifecycle (suspend kills sessions +
  support sessions, login blocked, console stays up, restore revives),
  matrix-§7 support access (opt-in/ticket, 4h box, lazy expiry, per-action
  via_platform_admin audit, enumerated reads, tenant termination), the platform
  admin console on the new PlatformScope plane (ops-tenant membership; per-use
  audited cross-tenant reads; entitlement edits; plan assignment; audit
  viewer), the platform-scope audit widening (tenant_id NULL rows +
  via_platform_admin on both trails), 8 provisional AR/EN screens, and the full
  isolation evidence: A1–A10 over 12 registered tenant tables + the platform-GUC
  mini-matrix. 207/207 db tests, all local gates green. Catalog markers synced
  (accounts 004/007, data_export→014, numeral_system default → latn). — CODE
