# PHASE-031 Completion Report — Healthcare Commercial Shell

> **Delivered:** 2026-11-08 · **Track:** v2.0 stage 10, post-GA (ED-07) ·
> **Migrations:** `0042_healthcare_claim_ref.sql` (idx 41, schema_version 42) +
> `0043_industry_healthcare.sql` (idx 42, schema_version 43) ·
> **CURRENT_SHIPPED_PHASE:** PHASE-031

## 1. The one-paragraph truth

The Healthcare Commercial Shell shipped as the register's first
**"configuration + light extension"** delivery: ONE additive nullable column
(`sales_invoices.claim_ref` varchar(64) — the external insurer claim reference;
non-null = a claim invoice billed to the insurer partner, null = self-pay
دفع مباشر), ONE data-only template seed (`industry.healthcare` v1.0.0 with the
partners.ar_aging → ar.aging pin reconciliation), the policy-gated claim-ref
capture (typed `CLAIM_REF_REQUIRED`, validated before the insert so every
failure path leaves zero residue), the `(partner, claim_ref)` claim-slice read
model partitioning the AR open items (INV-009), and the `group_by_claim`
parameter on the EXISTING notes.aging / notes.maturity-calendar /
partner.statement contracts (register §J stays closed — zero new report keys).
The claim lifecycle is proven end-to-end on a template tenant with every
journal line-asserted to the existing goldens (G-01/G-03 with the FEFO
dispensing pick, G-24/G-25/G-26 with the dishonor restoring the claim
EXACTLY), and the zero-clinical boundary is machine-checked — no clinical
field, terminology key, settings key, feature key, report surface, or request
vocabulary exists anywhere in the shell. Zero new tables beyond the column,
zero new journals, permission keys, or plan grants (INV-022 — the negative
ledger proof); zero web changes (the billing/pharmacy navigation + terminology
are data-driven through the unmodified PHASE-015 engine).

## 2. Task-by-task evidence

| # | Task | Delivered | Evidence |
|---|------|-----------|----------|
| T1 | The claim_ref migration | `0042_healthcare_claim_ref.sql` — the additive nullable column + the partial `(tenant_id, claim_ref)` index; no backfill, RLS untouched; `migrations.spec` manifest ↔ journal ↔ files green (last tag `0043_industry_healthcare`) | fresh chain 0001–0043 green on embedded PG16 (the full DB suite below); the v1.1 sales suites run unchanged (the column is invisible with the template off — null by default) |
| T2 | The healthcare seed | `0043_industry_healthcare.sql` — DATA-ONLY, idempotent upsert on key; the manifest transcribed VERBATIM with the §J reconciliation | `pnpm validate:manifests` 10/10 (hash `sha256:f8b707e6…0947e`, byte-equivalent to the contracts constant under canonicalManifestJson — verified programmatically); the templates-031 apply pins the KNOWN hash; re-apply idempotent |
| T3 | The six policy keys | `POLICY_REGISTRY` healthcare block (five registry-only + `claim_ref_required_for_insured_invoices` → `sales.claim_ref_required_for_insured`); CONFIGURATION_ENGINE §4 rows landed | unknown-key rejection holds (NFR-011 — the manifest validation gate); precedence L10 > L5 > L1 > platform proven by the templates-031 L5-beats-L1 leg; the config cannot alter posting (INV-022 — the negative ledger proof) |
| T4 | Claim-ref capture + grouping | `invoice-claim-ref.ts` (normalize + the pure capture assertion + the three typed errors) wired into `SalesInvoiceService.create`; `arClaimSlicesAsOf` (the claim-slice read model); the additive `insured`/`claimRef` HTTP fields (read-compat) | templates-031 "claim capture" leg (typed rejection + zero residue + self-pay null + the disjoint-state rejection); healthcare-claim-lifecycle legs 2–3 (the slices + the INV-009 partition) |
| T5 | Visit billing presets | The visit rides `crm.service_orders` (the invoice chain unchanged — G-01 + G-03); the pharmacy dispensing reuses `inventory.batch_tracking` with the server-side FEFO auto-pick | lifecycle legs 1 + 3: the visit holds NO ledger; the insured invoice posts G-01 (two revenue natures) + G-03 (WAC 1.50 × 10, the moves issue HC-B-EARLY — the nearest-expiry batch); the over-dispensing rejects INSUFFICIENT_STOCK with the whole post rolled back |
| T6 | group_by_claim wiring | The parameter + the claim column + the groups on `notes.aging`, `notes.maturity-calendar`, `partner.statement` (existing contracts); the source-claim-ref batch read in notes-queries | lifecycle legs 5–6: the statement groups `[CLM-HL-A]` with debit/credit subtotals; the aging groups with the baseTotal subtotal; the footer ties unchanged with the parameter on AND off (the notes-open-tie PASSes) |
| T7 | The governance suite | `templates-031.spec.ts` (7 tests) | clean apply (KNOWN hash, 4 series, pins, all-visible checklist with the honest "no clinical data" framing, notes+crm modules, audited), the claim-capture legs, idempotent re-apply, switch safety retail→healthcare→retail (the posted CLAIM invoice byte-identical WITH claim_ref retained through both switches; series union; archives; audited), degraded entitlement (notes.received feeds BOTH insurance_claim_billing and pdc_notes — blocked typed + grant-back recovery), L5-beats-L1 (config AND save path), THE NEGATIVE LEDGER PROOF |
| T8 | The claim-lifecycle E2E | `healthcare-claim-lifecycle.spec.ts` (10 tests) | visit → self-pay G-01 exact → insured G-01 + G-03 + FEFO + the claim slice → BR-001 over-limit block (zero residue) → statement claim-grouped + INV-009 tie → G-24 exact (the claim settles; slices → []) → dunning per claim (the footer tie unchanged) → G-25 exact → G-26 exact (the claim restored — amount, partner, claim reference; INV-024) → failure paths (CLAIM_REF_REQUIRED + INSUFFICIENT_STOCK rollback, zero residue) |
| T9 | Capability cross-check | `capability-matrix-reconciliation.spec.ts` extended with HLT (STRICT) | 6/6 green: HLT reconciles zero-mismatches both directions; the §L explicit rows extended (insurance_claim_billing N/A/N/A/REQ); the 32-entry KNOWN_DELTA frozen unchanged; RNT/EDU/AGR stay unmapped |
| T10 | Zero-clinical-surface | `healthcare-no-clinical-surfaces.spec.ts` (7 tests) | the manifest, the registries (POLICY/SETTINGS/FEATURE_DEPS), the report surface (incl. the group_by_claim parameter), the 0042/0043 executable SQL text, the request vocabulary, and the whole shipped set carry no clinical stems — with the honest boundary phrases ("no clinical data") exempted as the guard itself |
| T11 | Navigation/switch safety | The templates-031 switch legs + the golden structural assertions | core nav unchanged through the switch; the derived billing/pharmacy groups land (`["billing", "pharmacy"]` with the visits/invoices/claims + expiry/counter/pdc items); terminology AR+EN (المريض (الملف المالي) / مطالبة تأمينية / دفع مباشر); posted claim invoices immutable ordinary documents with claim_ref retained read-only |
| T12 | Docs sync | This report + the wave | ENTITY_CATALOG (the sales_invoices claim_ref note + the 031 leg in the migration chain), CONFIGURATION_ENGINE §4 (the settings key + the six policy rows), INDUSTRY_CATALOG + templates README + industries README shipped pointers, FEATURE_CATALOG (the zero-new-keys cross-check), healthcare.md (status + the pin reconciliation), manifest.healthcare.json (regenerated), IMPLEMENTATION_STATUS (row 031 → COMPLETE + the header), PHASE_ACCEPTANCE_CRITERIA (§PHASE-031 copy), CHANGELOG, CURRENT_STATE, NEXT_ACTION, agent-ctx/P31-A |

## 3. Final gate (serial, foreground)

- **typecheck** 8/8 workspaces green.
- **lint** 8/8 green.
- **depcruise** 0 violations / 1,522 modules / 10,723 dependencies.
- **unit** api 406/406 (37 files — the +3 files: healthcare-no-clinical-surfaces
  + the two extended configuration specs) + contracts 53/53 + sync-core 36/36 +
  web 73/73 + ui 42/42 + desktop 274/274 + mobile 393/393.
- **DB suite** 161 files / 2,295 tests — the full 0001–0043 chain fresh on
  embedded PG16, chunked foreground: **2,293 green + 2 skipped + ONE
  documented environmental flake** (the PHASE-025 T-04 perf-tier p95 budget
  measured under the chunked run; it measures GREEN in isolation — 13/13 —
  the known load-dependent posture the PHASE-030 report already records).
  The two new specs: templates-031 7/7, healthcare-claim-lifecycle 10/10.
- **validate:manifests** 10/10 (ids unique, semver, non-empty REQUIRED keys).
- **docs:validate** 29/29 · **permissions-drift** 245=245 · **i18n**
  4,069=4,069 · **check:rls** green (violations=[], 199 catalog tables) ·
  **check:capabilities** GREEN (25 PASS · 3 DEFERRED · 16 n/a).

## 4. Engineering notes paid for (the lessons worth carrying)

1. **The runtime policy-read seam.** The save-path policy resolution rides the
   settings surface (`readEffectiveSetting` = L5 row ∪ SETTINGS_REGISTRY
   default — the partners/items precedent), which does NOT see L1 template
   defaults. The honest design: give the policy a settingsKey whose PLATFORM
   default equals the intended invariant (true — the capture discipline), and
   let the manifest ship the same true as its L1 default. Runtime, L1, and
   platform then agree for template tenants; L5 relaxes for everyone else.
   Any future policy consumed by a save path should follow exactly this shape
   (or extend the resolver read seam — a reviewed engine change, never a
   phase-side fork).
2. **The claim is a reference, not an entity** (CAPABILITY_MATRIX §2.9 held
   under pressure): the whole per-claim tracking composes the EXISTING AR
   subledger + ONE column + a bounded grouping query. The "just add a claims
   table" pull was answered by the partition proof — Σ claim slices + Σ
   self-pay/non-invoice open items = the partner's AR open total, at every
   lifecycle step.
3. **The as-of register reads filter created_at, not event dates** (the
   notes-as-of reconstruction): the claim-dunning legs assert against an asOf
   that postdates the note's creation while the cheque is still in custody —
   the register fold then ties exactly (the G-24 entry predates asOf, the
   creation predates asOf, the custody log holds).
4. **The numbering R5 nuance.** A template's tenant-level series rows are
   acquisition-inert REGISTRY proposals: the rendered document number comes
   from the owning service's own format (the SAL- series for standard
   invoices), with uniqueness riding the assignment table. The specs assert
   the registry rows (the apply evidence) and the SAL- shape (the runtime
   truth) — both honestly.
5. **Stem gates need domain calibration.** The automotive workshop's
   `svc.diagnosis` (vehicle fault diagnosis) is NOT medical — the
   zero-clinical stems name the MEDICAL surfaces (patient diagnoses,
   prescriptions, charts, labs, dosages), and the honest boundary phrases
   ("no clinical data") are exempted as the guard itself, never violations.

## 5. Findings (recorded, not hidden)

- **The pre-existing retail/grocery `inventory.stock_valuation` pins** stay
  the KNOWN_PRE030_UNRESOLVED_PINS snapshot (unchanged; retrofitting those
  two PHASE-015 manifests is a reviewed registry-hygiene change per their
  owning phase — the 030 posture carried forward).
- **The 32-entry planned-vs-shipped KNOWN_DELTA** (the pre-030 templates ×
  the 2026-11-02 matrix) stays frozen: HLT reconciles strictly so it never
  contributes; growing it fails CI, shrinking it is a reviewed change.
- **`check:capabilities` 3 DEFERRED** rows remain the pre-existing posture
  (unchanged by this phase).

## 6. Honest notes and deferrals (explicit, none silently shipped)

- **The §8 letter vs. the shipped battery.** The industries/README §8
  seven-governance-tests battery is covered by the templates-031 suite in the
  030 composite shape (apply + pins + checklist + terminology + nav +
  idempotence + switch + degraded + ledger), with the workflow-smoke and
  RTL-visual legs living in healthcare-claim-lifecycle (the smoke — a superset
  of the §8 letter: the real journals) and in the golden structural
  assertions (the AR+EN terminology + the derived navigation). The §8
  "golden onboarding fixture (AR + EN)" leg is the applied-overrides +
  checklist + terminology assertions; a byte-level fixture FILE was not
  introduced (the 030 posture — recorded, not silently narrowed).
- **The self-pay CASH receipt leg** (the phase doc's manual-verification #2)
  is covered manually per the doc; the automated suite proves the self-pay
  INVOICE (G-01) + the open-item partition. The treasury receipt chain is
  pinned by the PHASE-008/012 suites; the claim settlement chain (the
  phase's actual subject) is fully automated.
- **Per-insurer group exposure aggregation** is NOT fabricated (the phase
  doc's own constraint): credit limits are per partner; cross-insurer
  exposure is consolidation territory (PHASE-034) — documented honestly in
  the policy registry description.
- **Fee schedules** are ordinary price lists + customer tiers (BR-003), not a
  tariff engine — the shell says so; no adjudication surface exists (the
  register's known limitations, quoted in the template doc).

## 7. Acceptance criteria ×10 — verdicts

1. **Applies/switches via the unmodified engine, seven governance tests, AR +
   EN** — PASS (templates-031 legs 1/3/4; zero engine-code changes in the
   diff; terminology + navigation asserted bilingually).
2. **The claim billing workflow end-to-end, line-asserted goldens, zero
   residue** — PASS (healthcare-claim-lifecycle 10/10 — the
   acceptance-defining suite).
3. **Exactly one additive nullable column + the catalog note; fresh +
   regression green; invisible with the template off** — PASS (0042; the
   v1.1 sales suites unchanged; ENTITY_CATALOG updated).
4. **Policy-driven capture (L1 default, L5 override), typed error, self-pay
   null, never posting** — PASS (templates-031 legs 2 + 6; the negative
   ledger proof).
5. **Per-claim reconciliation (INV-009/012/016/024)** — PASS (the slice
   partition asserted at every lifecycle step; the dishonor restore exact).
6. **Existing report keys only + the group_by_claim parameter; no new report
   key** — PASS (report-pack-wiring 5/5; the registry stays 81 contracts).
7. **Pharmacy reuse (batch/expiry at GRN, FEFO, no negative stock,
   approval-gated EXPIRED write-off)** — PASS (the FEFO pick + the
   INSUFFICIENT_STOCK rollback in the lifecycle spec; the write-off
   discipline pinned by the PHASE-010 tracking suite, unchanged).
8. **Zero clinical data surfaces, machine-checked** — PASS
   (healthcare-no-clinical-surfaces 7/7).
9. **Graceful degraded entitlement + the HLT cross-check green** — PASS
   (templates-031 leg 5 + capability-matrix-reconciliation 6/6).
10. **Docs validation green with the catalog note + §4 rows** — PASS
    (docs:validate 29/29; the full wave in §2 T12).

## 8. Handoff

Read [agent-ctx/NEXT_ACTION.md](../../../../agent-ctx/NEXT_ACTION.md) — the
post-PHASE-031 handoff: the group_by_claim pattern, the light-extension shape,
the zero-clinical gate as the model for 032/033's boundary claims, the HLT →
EDU/AGR relay, and the golden re-pin discipline
([agent-ctx/P31-A-claim-ref.md](../../../../agent-ctx/P31-A-claim-ref.md) is the
031 record). **Next eligible: PHASE-032 — Education Commercial Shell**
(PHASE-033 parallel-eligible after its deps; both identify-only).
