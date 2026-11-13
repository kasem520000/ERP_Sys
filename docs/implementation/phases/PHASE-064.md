# PHASE-064 — AI Copilot & Intelligent Automation

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0, scope extended by v3.2/CR-50) · **Wave:** 4 / Stage 15 · **Register:** [CR-34](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) DF-25…DF-35 · UX-20 · PP-16 · G-07 · [gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER3_RESIDUAL.md) (R-15 invoice-by-email — the v3.2 scope extension) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.3 (non-goal reversal) · §6.5

## 1. Phase Overview

- **Phase ID:** PHASE-064
- **Title:** AI Copilot & Intelligent Automation (المساعد الذكي والأتمتة الذكية)
- **Objective:** Deliver the AI capability family the audit scored as a top RFP-loser
  (DF-25 — «loses 40% of modern RFP comparisons») under a **formal reversal of the
  documented non-goal #9** by register decision CR-34, with guardrails that are
  invariants, not preferences: **tenant opt-in** (default OFF), **permission-scoped**
  (every tool call executes under the calling user's own permission set — the
  245-discipline keys apply to AI exactly as to humans), **no auto-writes to financial
  records** (human confirmation is mandatory; AI stages drafts and suggestions only),
  **full audit** (`ai_interactions`), **cost controls** (`ai_cost_ledgers` with per-tenant
  caps and hard stops), and a **model-adapter port** (pluggable providers — no hard vendor
  lock). On that foundation: an **Arabic-first conversational copilot** with tool-calling
  over whitelisted READ APIs; **supplier-invoice OCR** into AP drafts with confidence
  scores and human confirmation; **suggesters** — GL account classification, bank-match
  fuzzy suggestions, seasonality-aware smart reorder (via 063), cash-flow prediction, and
  journal-entry anomaly detection feeding the PHASE-058 fraud case queue; and
  **narration & voice** — Arabic report narration, the human-readable journal entry
  narrative (PP-16 — «why this entry exists» from source documents), and Arabic voice
  entry assist.
- **Business value:** OCR of supplier invoices is the audit's «biggest possible time
  saving» (DF-26) — hours per week per clerk returned; the copilot restores RFP parity
  against AI-branded competitors without surrendering the platform's honesty discipline
  (the reversal is register-recorded, the guardrails are tested invariants); anomaly
  detection turns the existing GL into a fraud radar feeding 058; and the model-adapter
  port keeps every capability provider-portable so pricing and residency decisions stay
  reversible.
- **الملخص التنفيذي (AR):** تعكس هذه المرحلة رسمياً «الهدف غير المعلن رقم 9» بقرار
  السجل CR-34، لكن بضوابطٍ ثابتة لا تفضيلات: اشتراك المستأجر الاختياري (معطَّل
  افتراضياً)، وتقييدُ كل نداء أداة بصلاحيات المستخدم نفسه (مفاتيح الصلاحيات تنطبق
  على الذكاء الاصطناعي كما تنطبق على البشر)، ومنعُ أي كتابة تلقائية على السجلات
  المالية — التأكيد البشري إلزامي والمخرجات مسودات واقتراحات فقط —، وتدقيقٌ كامل في
  `ai_interactions`، وضبطُ تكاليف بسقوف صارمة في `ai_cost_ledgers`، ومنفذُ مهايئات
  نماذج قابل للاستبدال بلا ارتهان لبائع. فوق ذلك: مساعد محادثة عربي أولاً بأدوات
  قراءة بيضاء (رصيد الأستاذ، كشف عميل، توافر مخزون، أفضل الأصناف، أعمار الديون)
  بإجاباتٍ بمصادر وقابلة للتعمق؛ وقراءة فواتير الموردين ضوئياً إلى مسودات ذمة مع
  درجات ثقة وتأكيد بشري — لا ترحيل تلقائي أبداً؛ ومقترحات تصنيف الحسابات ومطابقة
  بنكية تقريبية وتوصيات طلب موسمية (من 063) وتنبؤ تدفق نقدي وكشف شذوذ القيود يغذي
  قضايا الاحتيال في 058؛ وسردُ التقارير بالعربية وشرحُ «لماذا وُجد هذا القيد» من
  مستنداته المصدر، ومساعد إدخال صوتي عربي للنماذج السريعة.

## 2. Scope

In scope:

1. **Copilot** (DF-25, DF-31):
   - **Arabic-first conversational assistant**: an in-app chat surface (RTL-native, AR/EN)
     answering tenant questions through **tool-calling over whitelisted READ APIs** — GL
     balance query, customer statement, stock availability, top items, aging summary; the
     whitelist is explicit and versioned; no free-form SQL, no arbitrary endpoints.
   - **Answers with source links + drill-down**: every answer cites the records it was
     built from (entity links, report anchors); when the tools are insufficient the
     copilot refuses rather than improvises; no financial advice is rendered — facts with
     provenance only.
2. **OCR — supplier invoice ingestion** (DF-26, UX-20, DF-31): supplier invoice
   photo/PDF → **AP draft** extraction (line items, VAT, partner match) with
   **confidence scores per field** and **human confirmation** — the draft is created, never
   posted; low-confidence fields are highlighted for review; partner matching proposes,
   the user disposes; every extraction is an audited `ai_suggestions` row.
3. **Suggesters** (DF-27…DF-30, DF-34, DF-35, G-07):
   - **GL account classification suggestions** (DF-27): learns from the tenant's own
     posting history (partner/item/text patterns) and proposes accounts on document
     lines — accept/reject is one click and feeds the learning loop; suggestions never
     bypass the account validation rules.
   - **Bank-match fuzzy suggestions** (DF-34): on the reconciliation screen, probable
     statement-line ↔ open-document pairings with scores; accepting a match executes the
     existing reconciliation flow unchanged.
   - **Smart reorder recommendations** (DF-30): seasonality-aware via the PHASE-063
     season demand profiles layered on the PHASE-043 reorder engine — recommendations
     appear as reviewable suggestions in the existing reorder surfaces.
   - **Cash-flow prediction** (DF-29): AR/AP history + recurring patterns → a projected
     cash position surfaced as a forecast panel with explicit confidence ranges, never as
     a posting or a commitment.
   - **Anomaly detection on journal entries** (DF-35, G-07): outlier scoring on entry
     shape (amounts, accounts, timing, partners vs tenant history) → flagged entries open
     a **case queue that feeds the PHASE-058 fraud case workflow**; scoring is advisory —
     it creates cases, it never blocks postings.
4. **Narration & voice** (DF-32, DF-33, PP-16):
   - **Arabic report narration** (DF-32): NLP summary paragraphs rendered on report
     results (what moved, what stands out) — clearly labeled as generated narration
     beneath the numbers, which remain the contract output.
   - **Human-readable journal entry narrative** (PP-16): «why this entry exists» composed
     from the source documents — the AI-assisted extension of the deterministic narrative
     shipped with PHASE-062 (PP-08); source-doc facts remain the ground truth.
   - **Voice entry assist** (DF-33): Arabic speech-to-text into quick forms (partner
     lookup, item lookup, quick payment notes) — voice fills fields, the user confirms.
5. **Invoice-by-email** (**R-15 — added by v3.2/CR-50**): the inbound front door to
   item 2's OCR pipeline — forwarding a supplier-invoice email to the tenant's
   intake address lands the attachment in the OCR queue and returns an AP draft
   (with per-field confidence + the human-confirmation gate, exactly as the upload
   path). The intake address rides the 041 channel substrate (inbound email
   provider behind the provider-port); every intake event is audited; spam/bounce
   handling documented. No auto-posting — INV-045 governs this path identically.

Out of scope: any AI write path to posted records (excluded by INV-045) · auto-approval or
auto-matching that bypasses human confirmation · AI-generated financial advice or
automated decisioning on credit/limits · public/model training on tenant data (contract
term in the adapter port, not a feature) · marketing-website content generation ·
reversal of any other documented non-goal (DF-38 marketplace, DF-41 storefront stay
non-goals per the register).

**v3.2 scope note (CR-50):** the invoice-by-email intake (R-15) was added by the
owner's residual-layer decision — it is the inbound front door to the already-scoped
OCR pipeline, not a new engine; the effort estimate moves from ~5–6 to **~5.5–6.5
weeks**.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-055 (Public API & Webhooks) COMPLETE | hard prerequisite — the whitelisted READ API surface, scope model, and rate-limit discipline the copilot tools call |
| PHASE-041 (Communications Hub) COMPLETE | hard prerequisite — channel + notification-preference substrate for AI task completion notices and review requests |
| PHASE-058 (Identity & Governance) COMPLETE | advisory — the audit-trail surfaces and fraud case queue that anomaly detection feeds |
| PHASE-063 (Gulf & Arabic Differentiators) COMPLETE | advisory — season demand profiles feed smart reorder; Arabic rendering surfaces are ready |

## 4. Design Impact

- **Migrations:** the next in sequence after the predecessors' last journal entry (~0140+
  at planning time; exact numbers bound at implementation start). Grouped SQL migrations +
  Drizzle mirrors for 4 new tables: `ai_settings` (tenant opt-in, provider config, cost
  caps), `ai_interactions` (full audit of every call — prompt shape, tools invoked, actor,
  result disposition), `ai_suggestions` (type, payload, status accepted/rejected/dismissed,
  target entity refs), `ai_cost_ledgers` (per-call/per-token cost accounting per tenant).
- **Entities/catalog parity:** +4 rows in `ENTITY_CATALOG.md`; SQL + Drizzle + catalog row
  for every table (CR-36 a).
- **Permissions:** +5 keys — `ai.copilot.use`, `ai.ocr.use`, `ai.suggestions.review`,
  `ai.settings.manage`, `ai.audit.view`; zero-drift check re-anchored (seed = catalog =
  matrix rows). **Permission scoping is dual**: the feature key gates the surface, and
  every tool call re-checks the acting user's own data permissions — a user without AR
  read cannot pull a customer statement through the copilot.
- **Invariants:** **INV-045 — AI guardrail invariants** (reservation re-coordinated 2026-11-13 per [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md), the plan's INV-044 predates the 044 wave) added to
  `ACCOUNTING_INVARIANTS.md`: (1) no AI subsystem holds posting authority — AI output that
  would mutate financial records is staged as a draft or suggestion only; (2) human
  confirmation is mandatory and executes under the confirming user's own permissions and
  audit identity; (3) every AI call is permission-scoped and recorded in `ai_interactions`;
  (4) every call's cost lands in `ai_cost_ledgers` and hard-stops at the tenant cap. No new
  goldens (G-07 is consumed, not authored here).
- **i18n:** Arabic-first copilot and narration; AR/EN parity for every new UI key; the
  narration label («سرد مولَّد») is itself bilingual.
- **Reports:** +1 contract — `ai.activity-report` (tenant-admin review of interactions,
  suggestions, and cost over a period), registered in `REPORT_CATALOG.md`.
- **Docs:** `FEATURE_CATALOG.md` (ai module) · `ENTITY_CATALOG.md` ·
  `ACCOUNTING_INVARIANTS.md` (INV-045) · `REPORT_CATALOG.md` (+1) · the architecture
  document carrying documented non-goal #9, amended by CR-34 with a pointer to this phase
  and its guardrails · `ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md` (model-provider
  dependency risk row) · `NAVIGATION_MODEL.md` · `IMPLEMENTATION_STATUS.md`.
- **Feature flags:** `ai.copilot.*`, `ai.ocr.*`, `ai.suggest.*` — tenant opt-in default
  OFF, plan-gated (enterprise + business add-on per the resolved pricing table OQ-002);
  narration and voice ride `ai.suggest.*` as suggestion-producing surfaces.
- **Sync/offline assessment (CR-36 g):** AI features are online-only — recorded as
  explicitly N/A for the offline clients; suggestion review states sync where the
  underlying documents already sync.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Author migrations for `ai_settings`, `ai_interactions`, `ai_suggestions`, `ai_cost_ledgers` + Drizzle mirrors + catalog rows | api |
| T-02 | Model-adapter port: pluggable provider config, no vendor-specific code paths in features, no-training data terms in the adapter contract | api |
| T-03 | Tenant opt-in settings surface + cost caps + hard-stop enforcement + `ai_cost_ledgers` accounting | api |
| T-04 | Copilot chat surface (AR/EN, RTL-native) with tool-calling over the whitelisted READ APIs and source-link drill-down answers | web |
| T-05 | Tool whitelist implementation (GL balance, customer statement, stock availability, top items, aging summary) with per-call permission re-checks and audit rows | api |
| T-06 | OCR pipeline: supplier invoice photo/PDF → AP draft with per-field confidence scores, partner-match proposal, human confirmation gate | api |
| T-07 | OCR review surface: field-level confidence highlighting, accept/reject, draft creation through the existing AP flow | web |
| T-08 | GL account classification suggester (posting-history learning loop, one-click accept/reject feeding `ai_suggestions`) | api |
| T-09 | Bank-match fuzzy suggestions on the reconciliation screen (scored pairings executing the existing match flow) | web |
| T-10 | Smart reorder recommendations: 063 season profiles layered on the 043 engine, surfaced as reviewable suggestions | api |
| T-11 | Cash-flow prediction panel (AR/AP history + recurring patterns, explicit confidence ranges) | api |
| T-12 | Anomaly detection on journal entries: outlier scoring → case creation feeding the 058 fraud case queue | api |
| T-13 | Arabic report narration on report results (labeled generated narration) + PP-16 journal entry narrative from source documents | api |
| T-14 | Voice entry assist: Arabic speech-to-text into quick forms with user confirmation | web |
| T-15 | `ai.activity-report` contract + admin review surface; docs: FEATURE_CATALOG/ENTITY_CATALOG/INV-045/non-goal amendment/report catalog | docs |
| T-16 | Full local gates incl. the INV-045 negative tests (permission-scoping refusal, no-auto-write, cost hard-stop, opt-in default OFF) + evidence recording | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations apply cleanly with journal/spec/catalog parity; RLS attack tests A1–A10 pass
   for the four `ai_*` tables (CR-36 a, e); `ai_interactions` records every call with
   actor, tools, and disposition.
2. **Permission-scoping negative test**: a user without the relevant data permission asks
   the copilot for a customer statement → the tool call is refused, the refusal is
   audited, and no data leaks through the answer text (INV-045 guardrail exercised).
3. **No-auto-write test (INV-045)**: OCR extraction and every suggester produce drafts or
   suggestions only; no test path exists where AI output reaches the posting engine
   without a human confirmation step under the confirming user's identity; postings made
   after confirmation carry the human actor, never an AI principal.
4. Copilot answers over the whitelisted tools cite source records with drill-down links;
   a question outside tool coverage produces an explicit refusal, not an improvised
   answer; Arabic-first phrasing verified with EN parity keys green.
5. OCR: a photographed supplier invoice extracts line items, VAT, and a partner match
   with per-field confidence scores; the human confirmation gate creates an AP draft;
   posting happens only through the existing AP flow (DF-26, UX-20).
6. Suggesters: classification suggestions learn from seeded posting history and improve
   over a recorded accept/reject sequence; a bank-match suggestion executes the existing
   reconciliation flow; a seasonality-aware reorder recommendation appears from the 063
   profiles; anomaly scoring opens a case in the 058 queue (G-07 feed verified).
7. Cost controls: every call lands in `ai_cost_ledgers`; a tenant at its cap receives a
   hard stop with a typed error and an operator notice; opt-in default OFF is verified on
   a fresh tenant.
8. Model-adapter port: the same golden conversation and extraction set passes under two
   different provider configurations with zero feature-code changes (no vendor lock).
9. Narration and voice: Arabic report narration renders labeled beneath the contract
   numbers; the PP-16 entry narrative composes from source documents; voice assist fills
   a quick form with user confirmation (DF-32, DF-33, PP-16).
10. All house gates green (typecheck, lint, boundaries, unit tests, `docs:validate`, i18n
    parity, permissions zero-drift re-anchored, manifests); completion report
    `reports/PHASE-064-COMPLETION.md` appended with evidence; `IMPLEMENTATION_STATUS.md`
    row flipped; archive delivered as `ERP_PLATFORM_PHASE064.zip` (OA-07).

## 7. Risks and Constraints

- **Non-goal reversal optics** — the platform's celebrated honesty says AI was a declared
  non-goal: mitigated by carrying the reversal only through register decision CR-34,
  amending the non-goal document in the same change, defaulting opt-in OFF, and making
  the guardrails testable invariants (INV-045) whose negative tests are acceptance
  criteria.
- **Incorrect or hallucinated answers** — mitigated by the closed tool whitelist with
  source links, explicit refusal when tools are insufficient, and no free-form financial
  advice anywhere in the answer contract.
- **Cost runaway** — mitigated by per-tenant caps with hard stops in `ai_cost_ledgers`,
  operator alerts at threshold fractions, and per-feature cost visibility in
  `ai.activity-report`.
- **Vendor lock** — mitigated by the model-adapter port as an architectural requirement
  (verified by the two-provider test), provider config as data, and no-training data
  terms required by the adapter contract.
- **Privacy and data residency** — prompts may carry tenant data to the provider:
  mitigated by tenant opt-in, minimal-field tool payloads, the audited record of what was
  sent, and provider candidates constrained to residency-compatible options per the
  deployment posture.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-064-COMPLETION.md` — evidence
  per acceptance criterion including the INV-045 negative-test output, the two-provider
  adapter-port run, the cost hard-stop demonstration, and the CR-34 non-goal amendment.
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-064 row → COMPLETE; `NEXT_ACTION.md` →
  next eligible phase PHASE-065 (Growth Platform & Customer Success) with its
  prerequisites (PHASE-062, PHASE-059).
- Delivery: repository state archived as `ERP_PLATFORM_PHASE064.zip` (OA-07); the owner
  continues with «ابدأ تنفيذ المرحلة PHASE-065».
- Handoff notes for PHASE-065: `ai_suggestions`/`ai_interactions` are potential
  feature-adoption telemetry sources (privacy-scrubbed, opt-in respected); the copilot
  surface is the natural in-app delivery vehicle for targeted announcement campaigns; and
  the anomaly case queue gives customer-success teams an early health signal.
