# PHASE-051 — Foreign Trade & Logistics

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 2 / Stage 13 · **Register:** [CR-21](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-08) · §14 (L-01…L-14) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.1/§6.2

## 1. Phase Overview

- **Phase ID:** PHASE-051
- **Title:** Foreign Trade & Logistics (التجارة الخارجية واللوجستيات)
- **Objective:** Close H-08 — an importer or exporter in the region currently cannot run
  their basic operations in the platform. This phase delivers the trade document chain:
  letters of credit with amendments, a documents checklist and expiry alerts; documentary
  collections; an Incoterms registry with selection and risk hints on purchase and sales
  orders; bills of lading and packing lists across transport modes; customs declarations
  with HS codes, origins, quantities and duties flowing into the existing landed-cost
  allocation; certificates of origin; shipment tracking events driving document status;
  bonded-warehouse moves with duty-suspended stock; and duty drawback claims.
- **Business value:** Foreign trade is the wedge between a domestic ERP and a regional
  one: LC discipline, customs computation and landed-cost honesty decide margin for
  every importer, and the audit found all of it at zero (H-08, L-01…L-14). The phase
  reuses delivered machinery — landed costs, FX, financial charges, the posting engine —
  so the marginal cost is the document layer while the payoff is an entirely new buyer
  persona: the trading company.
- **الملخص التنفيذي (AR):** تسدّ هذه المرحلة فجوة التجارة الخارجية بالكامل
  (H-08 وL-01…L-14): اعتمادات مستندية بتعديلاتها وقائمة مستنداتها وتنبيهات
  انتهائها، وتحصيل مستندي، وسجل شروط التجارة Internoterms مع تلميحات المخاطر عند
  الاختيار في أوامر الشراء والبيع، وبوالص شحن وقوائم تعبئة بوسائط نقل متعددة،
  وإقرارات جمركية بأسعار HS ومنشأ وكميات ورسوم تتدفق إلى توزيع التكاليف الأرضية
  القائم، وشهادات منشأ ومطابقة، وتتبّع أحداث الشحنة يحدّث حالة المستندات، وحركات
  المستودع الجمركي بمخزون معلّق الرسوم، وطلبات استرداد الرسوم — مع ترحيل هامش
  الاعتماد ورسومه ومصاريفه وتحمل الرسوم الجمركية (G-64/G-65/G-66).

## 2. Scope

In scope:

1. **Letters of credit (L-01, H-08)**: `letters_of_credit` + `lc_amendments`
   (value/validity/document changes) + `lc_documents` (the documents checklist with
   presented/verified status and discrepancy notes); margin deposit and retirement
   postings per G-64; expiry/discrepancy alerts at 30/14/7/1 days (BR-104).
2. **Documentary collections (L-02)**: `documentary_collections` — D/P and D/A terms,
   the documents set, status and settlement linkage.
3. **Incoterms (L-03)**: `incoterms` registry (2020 set seeded, tenant-extensible) with
   selection on purchase and sales orders plus risk hints — the carriage/insurance/duty
   ownership matrix shown at selection time (BR-105).
4. **Transport documents (L-04, L-05, L-13)**: `bills_of_lading` (sea/air/road — the
   document types cover multimodal trade) and `packing_lists` tied to shipments and
   receipts.
5. **Customs declarations (L-06, L-07, L-08)**: `customs_declarations` +
   `customs_declaration_lines` (HS code, origin, quantities, customs value, duty rates,
   import VAT) and the tenant-extensible `hs_code_registry` seed; duties and taxes flow
   into the existing landed-cost allocation (G-65) with declaration completeness
   enforced (INV-036).
6. **Certificates of origin (L-09, L-10)**: `certificates_of_origin` with bilingual
   chamber-format prints; certificates of conformity ride the same table as a document
   type attached to declarations.
7. **Shipment tracking (L-11)**: `shipment_tracking_events` — the carrier milestone log
   per shipment (booked → departed → arrived → cleared → delivered) driving document
   status on the linked trade documents.
8. **Bonded warehouse (L-14)**: `bonded_warehouse_moves` — duty-suspended stock flag;
   moves inside the bond post no duty (G-66); release into free circulation triggers
   duty recognition (BR-106).
9. **Duty drawback (L-12)**: `duty_drawback_claims` — export-evidence linkage, claimed
   amounts, status workflow; submission requires the linked export evidence (BR-107).
10. **Integration**: LC fees post to financial charges through the existing bank-charge
    discipline; FX applies at the contract rate through the existing FX discipline;
    customs duties and import taxes flow into the existing landed-cost allocation on
    receipts; shipment events update document status; the chain PO → LC/collection →
    transport documents → declaration → receipt → landed cost is navigable end-to-end.

Out of scope: live carrier API ingestion (056) · the bank-guarantee module (053) · FX
revaluation runs (053) · customs-authority e-filing adapters (jurisdiction packs with
REQUIRES_VERIFICATION discipline; 054 territory) · transfer-pricing documentation
(054).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 — Activation & Truth Restoration COMPLETE (v3.0 entry point and discipline baseline) | NOT_STARTED — PLANNED (Blueprint v3.0) |
| Delivered baseline: purchasing + landed-cost allocation, FX/multi-currency discipline, financial charges, posting engine, RLS isolation, AR/EN i18n, ⌘K palette, pg-boss jobs | delivered (stages 1–11) |
| Soft dependencies (read-only, not blocking): PHASE-044 warehouse zones for bonded locations · PHASE-050 print pipeline patterns | NOT_STARTED — PLANNED (degrade gracefully when absent) |

Per [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5 this phase has
no v3.0 hard ordering edge beyond 035; it extends the delivered purchasing and landed
cost machinery rather than replacing it.

## 4. Design Impact

- **Navigation**: +3 screens — `/trade/lc`, `/trade/customs` (declarations register +
  lines editor), `/trade/shipments` (tracking board) — plus the Incoterms reference
  page and the incoterm selector embedded in PO/SO forms; ⌘K registration (OA-04);
  12-template screen discipline.
- **Migrations**: 4 scripts, next in sequence — `0091_trade_lc_collections.sql`
  (letters of credit, amendments, document checklist, documentary collections),
  `0092_trade_documents.sql` (incoterms, bills of lading, packing lists, certificates
  of origin), `0093_trade_customs.sql` (declarations + lines, HS registry, bonded
  moves, drawback claims), `0094_trade_shipments.sql` (tracking events + the DATA-ONLY
  grants block and the Incoterms-2020 / HS starter seeds). Exact numbers confirmed
  against the Drizzle journal at implementation time.
- **Entities**: +14 tenant tables → SQL + Drizzle mirror + `ENTITY_CATALOG.md` rows
  (CR-36a).
- **Permissions**: +10 keys — `trade.view`, `trade.lc.view/manage`,
  `trade.collections.manage`, `trade.customs.view/manage`, `trade.shipments.view/manage`,
  `trade.bonded.manage`, `trade.drawback.manage`; zero-drift discipline extended
  (CR-36b).
- **i18n**: ~+280 AR/EN key pairs across the three screen families, the reference page
  and the print templates; parity equality extended (base+n = base+n).
- **Reports**: +4 contracts — `trade.lc-register`, `trade.customs-declaration-register`,
  `trade.shipment-status`, `trade.duty-drawback-status` — with `REPORT_CATALOG.md` rows
  and the catalog↔registry reconciliation check extended.
- **Feature flags**: `trade`, `trade.lc`, `trade.customs` — template-composable grants
  (CR-36f); wholesale, distribution-field-sales and electronics templates compose them
  by default.
- **Posting rules** (reservations re-coordinated 2026-11-13 per
  [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md) — the original plan's G-65…G-67/INV-035/BR-074…077 predate the 044 wave's consumption of those slots): `JOURNAL_RULES.md` gains G-64 (LC margin deposit and retirement),
  G-65 (customs duty + import VAT capitalization into landed cost), G-66 (bonded
  transfer — physical move without duty recognition, duty on release from bond);
  `ACCOUNTING_INVARIANTS.md` gains INV-036 (declaration completeness);
  `BUSINESS_RULES.md` gains BR-104…BR-107.
- **Seeds**: Incoterms 2020 set and an HS-code starter set (tenant-extensible by design,
  with a documented accuracy disclaimer — the tenant owns final classification).
- **Jobs**: a `trade-expiry-sweep` (LC validity + document checklist due dates) on the
  existing pg-boss queue.
- **Docs**: `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`, `NAVIGATION_MODEL.md`,
  `JOURNAL_RULES.md`, `ACCOUNTING_INVARIANTS.md`, `BUSINESS_RULES.md`, the
  trade tables doc, jurisdiction-pack notes for customs rates.
- **No new ADR** — postings ride the centralized posting engine and the existing landed
  cost and FX disciplines; CR-36 gates apply.
- **Offline sync assessment (OA-02)**: N/A-recorded — trade documentation is web-only;
  no synced entity added.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0091` (LC, amendments, document checklist, documentary collections) + journal/spec updates | api |
| T-02 | Migration `0092` (incoterms, bills of lading, packing lists, certificates of origin) | api |
| T-03 | Migration `0093` (declarations + lines, HS registry, bonded moves, drawback claims) | api |
| T-04 | Migration `0094` (tracking events + grants + Incoterms/HS seeds) | api |
| T-05 | LC API: lifecycle with amendments, checklist states, discrepancy notes; G-64 margin/retirement postings | api |
| T-06 | LC fee postings to financial charges + `trade-expiry-sweep` job (BR-104) | api |
| T-07 | Documentary collections API with settlement linkage | api |
| T-08 | Incoterms registry + PO/SO selector with the risk-hint matrix (BR-105) | api |
| T-09 | Transport documents API: bills of lading (multimodal types), packing lists, shipment linkage | api |
| T-10 | Customs API: declarations + lines, HS registry extension, duty computation into landed costs (G-65, INV-036) | api |
| T-11 | Bonded warehouse API: duty-suspended moves (G-66), release triggers duty recognition (BR-106) | api |
| T-12 | Duty drawback API: export-evidence gate (BR-107) + claim workflow | api |
| T-13 | Shipment tracking API: milestone events → document status transitions | api |
| T-14 | `/trade/lc`, `/trade/customs`, `/trade/shipments` screens + Incoterms reference page + certificate prints | web |
| T-15 | Report contracts ×4 + `REPORT_CATALOG.md` rows + catalog↔registry check extension | api |
| T-16 | Golden tests G-64…G-66 + INV-036 test + RLS attack tests A1–A10 + OA-06 budgets on declaration/tracking queries | api |
| T-17 | Docs: catalog/invariants/journal-rules/business-rules/navigation updates + seed disclaimer | docs |
| T-18 | Run full local gates and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations `0091…0094` apply cleanly with Drizzle mirror parity; all 14 new tables
   have `ENTITY_CATALOG.md` rows (CR-36a); the Incoterms and HS seeds load and are
   tenant-extensible.
2. The LC lifecycle runs end-to-end — issue, amend, track the documents checklist with
   discrepancies, retire — with G-64 posting balanced margin/retirement entries and LC
   fees posting to financial charges; expiry alerts fire at 30/14/7/1 days (BR-104).
3. Customs declarations compute duties and import VAT per line and flow into the
   existing landed-cost allocation (G-65); INV-036 holds — no landed-cost allocation on
   an import receipt without a completed declaration reference, and every allocated duty
   ties to a declaration line.
4. Bonded moves post no duty on movement (G-66); release into free circulation
   recognizes duty exactly once (BR-106); duty-suspended stock is visibly flagged and
   blocked from customer issue while suspended.
5. Duty drawback claims cannot submit without linked export evidence (BR-107); the
   claim workflow records claimed amounts and status transitions.
6. Incoterm selection is mandatory on trade-flagged purchase/sales orders and renders
   the carriage/insurance/duty risk-hint matrix (BR-105); the registry page lists the
   seeded set and accepts tenant additions.
7. Shipment tracking events drive document status transitions (booked → departed →
   arrived → cleared → delivered) on the linked bills of lading, packing lists and
   declarations; the tracking board renders AR/EN parity with RTL and loading/empty
   states.
8. Certificates of origin print in bilingual chamber format; the PO → LC/collection →
   transport documents → declaration → receipt → landed-cost chain is navigable
   end-to-end.
9. CR-36 gates: +10 permission keys with zero-drift equality · i18n parity · RLS attack
   tests A1–A10 on all new tables · feature-flag/template gating verified ·
   `docs:validate` green · OA-06 budgets (indexes + EXPLAIN on declaration lines and
   tracking events).
10. Completion report `reports/PHASE-051-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE051.zip` (OA-07).

## 7. Risks and Constraints

- **Customs rules vary by jurisdiction** — duty rates and valuation rules differ per
  country and change: mitigated by tenant-configurable rate tables on declarations (no
  hardcoded rates) with jurisdiction-pack notes carrying the REQUIRES_VERIFICATION
  discipline.
- **LC banking complexity** — full trade-finance semantics outrun an ERP ledger:
  mitigated by keeping the ledger side to margin, fees and retirement (G-64) and leaving
  bank connectivity to the payments phase (056).
- **HS seed accuracy** — a shipped classification table ages and misclassifies:
  mitigated by a starter-set disclaimer, tenant extensibility, and classification
  ownership staying with the tenant.
- **Bonded regimes differ** — free-zone and bond rules vary by country: mitigated by
  configuration flags per jurisdiction pack rather than fixed behavior, with the G-66
  invariant unchanged.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-051-COMPLETION.md`
  (evidence per acceptance criterion, G-64…G-66 transcripts, the INV-036 completeness
  test, seed disclaimer).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-051 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase PHASE-052 (Workflow & Approvals Engine — Wave 3 entry), with
  the Stage-13 release gate checked per CR-38 (full ERP: MRP + HR + WMS + projects
  live) and recorded in the completion report before Wave 3 starts.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE051.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-052».
- Handoff notes for PHASE-052: change orders (048) and duty drawback submissions are
  the first documents to bind multi-step approval chains; the workflow engine should
  adopt them as exemplar documents. For 053/054: LC fees and bank-charge postings
  extend treasury surfaces, and the customs jurisdiction-pack notes feed the tax
  compliance calendar.
