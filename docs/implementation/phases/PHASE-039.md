# PHASE-039 — Returns & Collections (RMA + Dunning)

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 1 / Stage 12 · **Register:** [CR-09](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-12/H-13) · §4 (S-14/S-15/S-16) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §3/§6.2

## 1. Phase Overview

- **Phase ID:** PHASE-039
- **Title:** Returns & Collections (RMA + Dunning) (المرتجعات والتحصيل)
- **Objective:** Give returns and receivables collection the **process layers
  the audit found missing**. Today a return is only a financial credit note
  with no logistics behind it (H-12: no authorization, receipt, inspection,
  justified restock, or refund — "a return is a credit note with no
  operational process"), and AR collection is a single overdue notification
  (H-13: no dunning letters, no escalation ladder, no collection actions —
  "no collection automation = dead receivables"). This phase ships the RMA
  workflow (`return_authorizations` + lines:
  REQUESTED → APPROVED → RECEIVED → INSPECTED → RESTOCKED/SCRAPPED/REFUNDED)
  whose completion **auto-generates the credit note through the posting
  engine**, managed warranties with structured terms
  (`warranty_registrations`), and the dunning engine (`dunning_policies`
  step ladder, `dunning_letters`, `collection_actions`) wired to the aging
  report. Three NEW journal goldens register the dispositions — G-35 (RMA
  restock reversal), G-36 (scrap write-off), G-37 (refund posting) — with
  the numbering continuing from G-34 shipped with PHASE-038. Dunning
  letters send over email now; the WhatsApp channel arrives post-041 through
  the channel-port (policies already store the channel).
- **Business value:** Returns become recoverable value instead of ad-hoc
  credit notes (stock returns to sellable inventory or writes off with an
  audit trail), warranties stop living in free-text blobs, and collections
  become an escalating, logged, template-driven process tied to the aging
  report — faster cash and a defensible AR practice.
- **الملخص التنفيذي (AR):** تضيف هذه المرحلة طبقة العمليات الناقصة للمرتجعات
  وللتحصيل: سير عمل RMA كامل (طلب → موافقة → استلام → فحص → إعادة تخزين أو
  إتلاف أو استرداد) يُولِّد إشعار الدائن تلقائياً عبر محرك الترحيل عند اكتماله
  بثلاث قواعد ترحيل جديدة (G-35/G-36/G-37 تواصل ترقيم G-32)، وضمانات مُدارة
  بشروط مهيكلة بدل النص الحر، ومحرك تحصيل بسلّم خطوات قابل للضبط (أيام متأخرة
  × قناة × قالب) مع رسائل مُولَّدة وإجراءات تحصيل مسجَّلة وربط بتقرير الأعمار،
  وتصنيف مخاطر ائتمانية للعملاء مع قواعد مراجعة، وتُرسَل الرسائل بالبريد الآن
  وتنتظر قناة واتساب من مركز الاتصالات لاحقاً.

## 2. Scope

In scope:

1. **RMA workflow** (`return_authorizations` + `return_authorization_lines`,
   H-12/S-14): lifecycle REQUESTED → APPROVED → RECEIVED → INSPECTED →
   RESTOCKED/SCRAPPED/REFUNDED with state-machine CHECKs; lines reference
   the originating invoice/delivery lines and quantities are bounded by the
   invoiced quantity (typed rejection above it).
2. **Dispositions + goldens**: RESTOCKED returns stock through the inventory
   movement engine and posts G-35 (restock reversal); SCRAPPED posts G-36
   (scrap write-off); REFUNDED posts G-37 (refund posting). RMA completion
   auto-generates the credit note via the posting engine — the financial and
   logistics legs post atomically, exactly once (BR-064).
3. **Managed warranties** (`warranty_registrations` + structured
   `warranty_terms`, S-15): typed terms (duration, coverage enum, start
   basis from delivery/invoice) replacing the free-text blob; expiry
   notifications through the existing notification machinery.
4. **Dunning policies** (`dunning_policies`, H-13/S-16): the step ladder —
   days-overdue thresholds × channel × template + escalation rules, per
   tenant, attached to partner classes or invoice categories.
5. **Dunning letters + collection actions** (`dunning_letters`,
   `collection_actions`): letters generated per ladder step (email channel
   now; WhatsApp post-041 through the channel-port), and logged actions
   (calls, promises-to-pay, disputes) with outcome codes.
6. **Partner credit-risk fields** on `partners` (the register's credit-risk
   addition): credit score class + review rules (next review date,
   reviewer) — interplaying with the existing credit-management block.
7. **Aging-report linkage**: the dunning step surfaces inside the existing
   `ar.aging` contract (additive column, no new key) — collectors work one
   screen; a NEW `sales.dunning_status` report tracks the ladder per
   overdue invoice.
8. **Jobs**: the daily dunning sweep (bounded pg-boss) advances steps per
   policy, emits letters/notifications, and logs actions — the ladder is
   monotonic, no step skipping (BR-065).
9. **Goldens registered**: G-35/G-36/G-37 in JOURNAL_RULES.md with worked
   examples and failure packs — the numbering continues from G-32 through
   G-33/G-34 (PHASE-038).
10. **RMA register report** (`sales.rma_register`): the RMA lifecycle
    register with disposition mix and cycle times.

Out of scope: WhatsApp letter delivery (041 — the channel-port ships there;
policies store the channel now) · dispute-management workflow engine (052;
disputes are recorded as collection actions) · supplier-side return orders
(the purchasing debit-note path remains) · repair/field-service RMAs (the
service-order surfaces) · credit-scoring integrations (the class is
tenant-entered or rule-computed locally).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | planned — the v3.0 entry phase; hard ordering rule (roadmap §5: 035 ships first) |
| Sales credit notes + aging contract + notification machinery baseline | delivered with the 34-phase baseline |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

No hard ordering binds this phase inside Wave 1 (siblings may run in
parallel); cumulative counters assume the sequential lineage
035 → 036 → 037 → 038 → 039 → …. The G-35..G-37 numbering assumes
PHASE-038 shipped G-33/G-34 first on that lineage.

## 4. Design Impact

- **Migrations**: `0055_rma_warranty.sql` (return_authorizations + lines,
  warranty_registrations with structured terms) ·
  `0056_dunning_collections.sql` (dunning_policies, dunning_letters,
  collection_actions) · `0057_partner_credit_risk.sql` (additive partner
  credit-risk columns) — journal 54 → 57, next in sequence after
  PHASE-038's 0054; all tables RLS'd; Drizzle journal/spec updated.
- **Entities**: +6 tables (ENTITY_CATALOG.md 217 → 223); the partner
  columns are additive on a catalogued table.
- **Permissions**: +5 keys — `sales.rma.read`, `sales.rma.manage`,
  `sales.rma.approve`, `sales.dunning.manage`,
  `sales.warranties.manage`; zero-drift extended (256 → 261; seed =
  mirror).
- **i18n**: ~150 new AR/EN keys (RMA screens, dunning workspace, warranty
  surfaces, letter templates, credit-risk labels); parity gate as ever.
- **Reports**: +2 contracts — `sales.rma_register` and
  `sales.dunning_status` (registry 88 → 90); the `ar.aging` additive
  dunning-step column documented in REPORT_CATALOG.md (no new key).
- **Feature flags**: +3 keys — `sales.rma`, `sales.warranties`,
  `sales.dunning` (business + enterprise, the tier-4 precedent;
  FEATURE_CATALOG.md rows + dependency edges).
- **Goldens**: G-35/G-36/G-37 registered in JOURNAL_RULES.md with
  posting-engine source types and failure packs; the numbering continues
  from G-32 (the last shipped golden) through G-33/G-34.
- **Rules**: BR-064 (dispositions only from INSPECTED; the credit note is
  generated exactly once, atomically with the stock/refund leg) and BR-065
  (the dunning ladder is monotonic per policy — steps advance, never skip
  or regress) appended to BUSINESS_RULES.md (continues from BR-063 shipped
  with PHASE-038).
- **Docs**: JOURNAL_RULES.md · BUSINESS_RULES.md · ENTITY_CATALOG.md (+6) ·
  FEATURE_CATALOG.md (+3) · REPORT_CATALOG.md (+2 + the aging note) ·
  DATA_DICTIONARY.md (letter/action/disposition vocabularies) ·
  NAVIGATION_MODEL.md (+ returns and collections items).
- **Sync surface (CR-36 g)**: RMA read feeds project additively to the
  offline clients; dunning runs server-side and letters render at send —
  offline writes N/A-recorded.
- **Performance (OA-06)**: EXPLAIN-verified hot paths — RMA list by
  (tenant, status), the dunning sweep's overdue-invoice scan, aging
  grouping; command-palette entries for RMA/warranty/dunning entities
  (OA-04).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migrations `0055`–`0057` (6 RLS'd tables + partner columns) + Drizzle journal/spec | api |
| T-02 | RMA lifecycle service (state machine, quantity bounding, approval with SoD) + specs | api |
| T-03 | Disposition engine: restock via inventory movements + G-35, scrap G-36, refund G-37 + failure packs | api |
| T-04 | Auto-credit-note generation on RMA completion (atomic with the disposition leg, exactly once — BR-064) | api |
| T-05 | Warranty registrations + structured terms + expiry notification sweep | api |
| T-06 | Dunning policies service (step ladder config, attachment scopes) + BR-065 monotonic guard | api |
| T-07 | Daily dunning sweep job (letters via email, notifications, action logging) | api |
| T-08 | Collection actions + partner credit-risk fields + review rules + credit-block interplay | api |
| T-09 | Aging linkage (additive dunning-step column) + `sales.dunning_status` contract | api |
| T-10 | `sales.rma_register` report contract + catalog rows | api |
| T-11 | Web screens: RMA workspace, dunning workspace, warranty surfaces (12-template discipline) | web |
| T-12 | NAV_ITEMS + command palette + feature gating + AR/EN dictionaries | web |
| T-13 | Rule specs (BR-064/065, G-35..37 worked examples, spoof battery) + RLS A1–A10 + docs wave + full gates | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations 0055–0057 apply cleanly; the six new tables are RLS'd with
   composite tenant FKs; Drizzle + ENTITY_CATALOG.md parity (223 rows); the
   partner columns are additive with zero reshape.
2. RMA end-to-end: REQUESTED → APPROVED → RECEIVED → INSPECTED →
   RESTOCKED — the completion auto-generates the credit note through the
   posting engine (the G-35 worked example, balanced lines, exactly once —
   a replay attempt is a typed rejection per BR-064); the stock leg and the
   financial leg post atomically.
3. The remaining dispositions post their goldens: SCRAPPED → G-36 (scrap
   write-off) and REFUNDED → G-37 (refund posting) with balanced worked
   examples and failure packs (unmapped accounts → typed rejection, zero
   partial writes).
4. Quantity bounding: a return line above the invoiced quantity of its
   originating line is a typed rejection; state-machine violations are
   typed 409s with zero residue.
5. Warranty terms round-trip: structured terms persist and re-read
   identically; the expiry sweep emits notifications on the seeded
   near-expiry fixtures.
6. Dunning ladder end-to-end: seeded overdue invoices advance through the
   configured steps (letters generated per step, logged, monotonic — no
   skips or regressions per BR-065); the ladder respects per-policy
   channel/template bindings (email now; the WhatsApp channel is stored
   and marked pending the 041 port).
7. Aging linkage: the `ar.aging` output carries the dunning step and
   `sales.dunning_status` tracks the ladder per overdue invoice — both
   render over seeded data with REPORT_CATALOG.md rows (registry 90).
8. Credit risk: partner score class + review dates persist and interplay
   with the existing credit-management block (a blocked class behaves like
   an over-limit block in the documented scenarios).
9. House gates green (CR-36): RLS A1–A10 for the six tables · typecheck ·
   lint · unit · `docs:validate` · i18n parity (~150 keys) · permissions
   drift 256 → 261 · EXPLAIN budgets for the sweep and RMA list paths.
10. Completion report `docs/implementation/phases/reports/PHASE-039-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive
    delivered as `ERP_PLATFORM_PHASE039.zip` (OA-07).

## 7. Risks and Constraints

- **Returns inventory valuation** — restocked goods must re-enter at the
  original cost basis, not today's WAC; mitigated by the G-35 reversal
  shape posting the valuation delta explicitly and a worked example pinned
  in the spec.
- **Double-posting on completion** — a retried completion must never
  duplicate the credit note or the stock leg; mitigated by BR-064's
  exactly-once guard (idempotent completion keyed on the RMA id) plus the
  failure-pack test.
- **Dunning tone and compliance** — aggressive ladders damage customer
  relationships and may breach local practice; mitigated by capped
  frequency per policy, template review before activation, and per-partner
  opt-out flags.
- **PII in collection actions** — call notes carry personal data;
  mitigated by the data-classification discipline (masked exports,
  audit-event reads, retention note in DATA_DICTIONARY.md).

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-039-COMPLETION.md`
  (evidence per acceptance criterion, the three golden worked examples, the
  ladder trace, gate output).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-039 row → COMPLETE;
  `NEXT_ACTION.md` → next eligible phase PHASE-040 (Data Onboarding &
  Migration Toolkit) with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE039.zip`
  (OA-07); the owner continues with «ابدأ تنفيذ المرحلة PHASE-040».
- Handoff notes for PHASE-040: none binding (parallel-safe sibling). For
  PHASE-041: the dunning letters are the first queued consumer of the
  WhatsApp channel the moment the channel-port ships — the letter rows
  already store channel + template bindings.
