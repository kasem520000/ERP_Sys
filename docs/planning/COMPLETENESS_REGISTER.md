# Completeness Register — Blueprint v3.0 (The Full-ERP Completion Program)

> **Status:** ACCEPTED — extended by v3.1 (CR-41…CR-48, the gap-consolidation wave) · **Owner:** Product Owner & Platform Architecture · **Date:** 2026-11-10 (v3.0) · 2026-11-11 (v3.1)
> **Extends:** [EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) (v2.0, stages 9–11, PHASE-026…034) without altering any prior decision. v1.1 and v2.0 content remain binding and untouched.

This register is the **single canonical source** for Blueprint v3.0: the post-Enterprise-Depth
completion program that takes the platform from **ERP-L3.2 (60% of a full ERP per the
independent audit)** to a **genuinely complete, integrated, differentiated ERP** —
closing the **495 audited gaps** (plus this register's own additions) across
**31 phases (PHASE-035…065)** organized in **4 waves (stage groups 12–15)** — **extended
by v3.1 (2026-11-11): the second-round gap consolidation adds 43 new gaps (L1-01…L1-23,
L2-01…L2-20) and three new phases (PHASE-066…068), taking the program to 34 phases and
536 in-scope gaps (CR-41…CR-48 below).**

**Any document that conflicts with this register is wrong and must be corrected; this
register governs v3.0/v3.1 additions only.** Evidence base: the three independent audit
reports copied verbatim into [gap-analysis/](gap-analysis/)
(`PROJECT_EVALUATION_2026-11-10.md` · `ERP_COMPLETENESS_GAP_REPORT.md` ·
`ERP_FULL_GAP_ANALYSIS.md`) plus the two v3.1 layer files
(`GAP_ANALYSIS_LAYER1_23_GAPS.md` · `GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md`) — every
gap ID cited by the phase documents traces to one of those five reports or to §D of
this register (owner additions).

## A. Program decisions (CR-01…CR-48)

### v3.1 — The gap-consolidation wave (CR-41…CR-48, 2026-11-11)

| # | Decision | Authority |
|---|----------|-----------|
| CR-41 | **The all-gaps policy + the L1/L2 identifier namespaces:** every gap discovered by any audit round — regardless of severity (حرجة/عالية/متوسطة/منخفضة) — enters the plan; nothing is excluded for being small. The 43 second/third-round gaps are documented in [gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md](gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) (L1-01…L1-23) and [gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-01…L2-20). **Identifier disambiguation:** the requested `N-xx` prefix for Layer-1 collided with the existing Integrations gap family N-01…N-21 (FULL_GAP §17, consumed by phases 037/040/041/045/047/054/055/056/061) — Layer-1 is therefore numbered **L1-xx** (1:1 with the requested N-01…N-23), mirroring L2-xx. Gap knowledge never lives only in conversations (see CR-47). | Owner directive 2026-11-11 + this register |
| CR-42 | **PHASE-066 — IFRS Advanced Compliance I (Measurements & Provisions):** related-party registry & disclosure (IAS 24, L2-01), government grants (IAS 20, L2-02), held-for-sale & discontinued operations (IFRS 5, L2-03), investment property (IAS 40, L2-04), goodwill register & annual test (IFRS 3 measurement side, L2-05), provisions & contingencies (IAS 37, L2-11), impairment machinery (IAS 36, L2-13), going-concern assessment (IAS 1, L2-19). Wave 3 / Stage 14, after 053/054; REQUIRES_VERIFICATION governs every estimate. | [PHASE-066.md](../implementation/phases/PHASE-066.md) |
| CR-43 | **PHASE-067 — IFRS Advanced Compliance II (Business, Ownership & Disclosure):** business combinations with PPA and the consolidation entry (IFRS 3, L2-06), share-based payments (IFRS 2, L2-07), defined-benefit plans + actuarial assumptions & sensitivity (IAS 19, L2-08/09), hyperinflation restatement (IAS 29, L2-10, designation-gated), non-controlling interests (IFRS 10/3, L2-16), XBRL-tagged statutory statements (L2-18). Wave 4 / Stage 15, after 054/066. | [PHASE-067.md](../implementation/phases/PHASE-067.md) |
| CR-44 | **PHASE-068 — Accrual Engine, Revenue Recognition & Recurring Commerce:** the allocation-schedule engine (deferred revenue L1-01, revenue recognition L1-02, prepaid amortization L1-03, monthly accruals with auto-reversal L1-05 — extending the shipped `recurring_journals`), the recurring-generation engine (recurring invoices L1-04, customer standing orders L1-15, subscription depth L1-16 — extending the shipped service-contract cluster), and the IFRS-15 contract balances (L2-14 contract assets, L2-17 contract liabilities/RPO). Created **instead of** ballooning PHASE-053 (the owner's "أو مرحلة جديدة إن تضخم النطاق" rule); Wave 3 / Stage 14, after 053. | [PHASE-068.md](../implementation/phases/PHASE-068.md) |
| CR-45 | **The Layer-2 special-case bindings (decided early because they are early dependencies):** L2-12 (standard costing) → **PHASE-042** scope extension, decided BEFORE 042/043 start per the owner mandate (042's variance machinery consumes it; 043 plans against the frozen standard); L2-15 (milestone billing) + L2-20 (subcontracting) → bound to **PHASE-048** existing scope items 9/7 (PR-11/PR-06) with the IFRS-15 output-method alignment rule and the inbound-subcontract linkage documented — no parallel scope invented; L2-14/L2-17 (contract balances) → **PHASE-068** (they derive mechanically from 068's own schedules — placing them in 066/067 would split one substrate across three phases). | [GAP_ANALYSIS_LAYER2 §3](gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) |
| CR-46 | **The Layer-1 triage dispositions (evidence-cited in the L1 file):** L1-06 (petty cash — BR-020 + `cash_accounts` PETTY, PHASE-008) and L1-14 (official statements — `partner.statement`/`supplier.statement`, PHASE-011/012) are **SHIPPED, never re-planned**; the partial-shipped residuals and orphans are assigned: **039** ← L1-10 (already scoped item 6) + L1-11 + L1-12 (new scope items — decided before 039 starts, the owner mandate); **040** ← L1-21 export-templates half; **042** ← L1-… none (L2-12 only, per CR-45); **044** ← L1-20; **048** ← L2-15/20 IDs; **053** ← L1-07 residual + L1-08 + L1-09; **054** ← L1-22; **055** ← L1-23; **058** ← L1-13 residual + L1-17 + L1-18 (ID binding) + L1-19 residual; **062** ← L1-21 batch-ops ID binding; **068** ← L1-01…05 residuals, L1-15, L1-16. Effort estimates updated in each phase doc and the roadmap. | [GAP_ANALYSIS_LAYER1 §1](gap-analysis/GAP_ANALYSIS_LAYER1_23_GAPS.md) |
| CR-47 | **The gap-intake protocol (process hardening):** any gap discovered in the future — by the owner, an audit, or an implementing agent — receives an identifier (next free in its family), a severity, an effort estimate, and a phase home **in the same commit** that records it, into the owning gap-analysis file + the roadmap mapping. Gap knowledge that lives only in a conversation is a defect (the 035/036 lesson — knowledge generated in sessions was lost until re-derived). A gap with no phase home is an invalid state and fails `docs:validate` once the check exists. | Owner directive 2026-11-11 |
| CR-48 | **The completion-evidence hardening (process hardening):** (a) the completion-report template now carries a **mandatory code-evidence checklist** (new tables with schema.ts line numbers, migration file names, web page paths, test files with counts, new permission counts) — a report without it is invalid; (b) a phase may be marked COMPLETE only when **all three** flip together — the phase doc header, the IMPLEMENTATION_STATUS row, and the completion report with evidence — "الثلاثة معاً أو لا شيء"; (c) IMPLEMENTATION_STATUS's own header must state the last completed phase (the line-3 lesson). | Owner directive 2026-11-11 |

### Wave boundaries and release gates

| # | Decision | Authority |
|---|----------|-----------|
| CR-01 | The program is organized as **4 waves / stage groups 12–15**: Stage 12 *Sellable Foundation* (035–041), Stage 13 *Full-ERP Completion* (042–051), Stage 14 *Enterprise Platform* (052–059), Stage 15 *Differentiation & Growth* (060–065). Each wave closes with a release gate; no wave retro-alters the MVP (014) / GA (025) / Enterprise-Depth (034) gates. | This register |
| CR-02 | **The audit exclusions:** two gaps were already closed by the 2026-11-09 delivery completion inside the delivered archive and are therefore **out of program scope**: (a) the 13th industry template `industry.rental_logistics` (migration `0047` — the audit's "1 deferred template" finding), and (b) the public marketing landing surface (the audit's UX-01 "no marketing site" finding). They must never be re-planned. | Delivery CHANGELOG 2026-11-09 |
| CR-03 | **Scope honesty rule:** every phase document carries a `Status: NOT_STARTED — PLANNED (Blueprint v3.0)` header until its completion report exists. Nothing in v3.0 may be described as implemented until recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) with evidence. | House rule (STATUS legend) |
| CR-04 | **The already-shipped surfaces are confirmed present** (audit §5.1 + F-4): the platform admin console, the subscription/billing + `/checkout` flow, and the onboarding business-activity selection wizard exist in `apps/web`. v3.0 phases reference them as prerequisites, never re-implement them. | Audit §5.1 |

### Wave 1 — Stage 12: Sellable Foundation (PHASE-035…041)

| # | Decision | Authority |
|---|----------|-----------|
| CR-05 | **PHASE-035 — Activation & Truth Restoration:** batch/serial/expiry inventory screens (F-1), the inventory-adjustments surface (F-2), `reports.consolidated` nav registration (F-3), `items.import_export` grant repair (F-5/H-18), `tax.e-invoicing-log` report (F-6), scheduled-reports truth decision (F-7 → implemented by PHASE-057 or DEFERRED-recorded), `platform.payouts` truth decision (F-9), catalog reconciliation (7 unlisted report contracts + counts 85), planning-doc truth refresh (CURRENT_STATE/NEXT_ACTION), and repository hygiene (generated artifacts out of Git). | Audit §9.أ/ب/ج |
| CR-06 | **PHASE-036 — Extensibility Core (Custom Fields):** tenant-defined custom fields (UDF) with typed storage, per-entity form designer layouts, custom picklists; the platform-wide answer to FD-18/FD-19/FD-20 — judged by the audit "the single most important functional gap" (kills the SaaS model without it). Ships BEFORE the big module waves because phases 042+ surface custom fields on their entities. | FULL_GAP §25.2 |
| CR-07 | **PHASE-037 — ZATCA Phase-1 & QR Compliance:** TLV-base64 QR payload generation, **real scannable QR images** in print templates (replacing the `[QR]` text placeholder — H-02), invoice counter (PIH/ICV) chain, standalone simplified-invoice compliance path, and the `tax.e-invoicing-log` delivery if not already closed by PHASE-035. GATE-1..4 verification discipline is preserved: implementation is Phase-1 (generation-only, no clearance API), with Phase-2 (clearance/reporting + CSID) explicitly staged for post-GATE. | H-01, H-02 |
| CR-08 | **PHASE-038 — Procurement Sourcing:** RFQ + supplier quotes + awarding (H-11/P-01/P-02), blanket agreements (P-03), supplier rating & approved-vendor lists (P-04), supplier portal skeleton (P-05), contract-based POs (P-06), CAPEX requests (P-10), supplier advances (P-12), early-payment discounts (P-13), public-tender intake (DF-53). | §5 P-01…P-15 |
| CR-09 | **PHASE-039 — Returns & Collections:** the RMA workflow (authorization → receipt → inspection → restock/scrap/refund — H-12/S-14), managed warranties (S-15), and the AR dunning engine (letters, escalation ladder, collection actions — H-13/S-16). | H-12, H-13 |
| CR-10 | **PHASE-040 — Data Onboarding & Migration Toolkit:** import kinds beyond PARTNERS/ITEMS/OPENING_BALANCES (H-17) — COA, account opening balances, fixed assets, employees, price lists, contracts, budgets; migration adapters from Excel/QuickBooks/Odoo-shaped extracts (IN-26); one-click demo-data loader per industry template (TB-19/TB-20). | H-17, IN-26 |
| CR-11 | **PHASE-041 — Communications Hub:** WhatsApp Business API + SMS gateway providers with the channel-port discipline (H-22/N-06/N-07/IN-13/IN-14), verified email provider abstraction (N-08/IN-15), tenant email/print templates (FD-30), per-module notification preferences (TB-23). | H-22, N-06…N-08 |

### Wave 2 — Stage 13: Full-ERP Completion (PHASE-042…051)

| # | Decision | Authority |
|---|----------|-----------|
| CR-12 | **PHASE-042 — Manufacturing I (Routing & Work Centers):** routings/operations, work centers with capacity and cost rates, operation-level production order execution, setup/run times, actual operation costing, rework orders, downtime tracking, shop-floor barcode scan points. | H-04, M-02…M-04, M-14, M-15, M-17, M-18 |
| CR-13 | **PHASE-043 — Manufacturing II (MRP & Planning):** net-requirements explosion over multi-level BOMs, planning horizon buckets, auto-suggested production/purchase orders, MPS, ATP, phantom BOMs, alternative materials, by/co-products, MTO linkage, contract manufacturing, bill of resources. | H-03, M-01, M-05…M-09, M-11, M-21, M-22, M-24, M-25 |
| CR-14 | **PHASE-044 — WMS & Inventory Intelligence:** warehouse zones/aisles/racks/bins, putaway rules, directed picking strategies (FIFO/FEFO/nearest), wave/cluster picking, LPN/pallets, cycle-count schedules, ABC analysis, quarantine/hold status, consignment & VMI ownership, cross-docking, slow-movement rotation automation, shelf-life alert jobs, serial movement ledger. | H-07, I-01…I-25 |
| CR-15 | **PHASE-045 — HR Core (Attendance, Leaves & Shifts):** attendance records + device-agnostic import, shift calendars and rosters, overtime rules, leave types/balances/requests with carry-over, employee↔user linkage. | H-05 (part), HR-01…HR-04, HR-13 |
| CR-16 | **PHASE-046 — HR Payroll Compliance:** statutory payroll engines per jurisdiction (GOSI KSA, social security AE/EG/JO), payroll income tax (PIT) withholding, automated EOSB computation per labor-law rules, variable-pay reconciliation feeds from attendance/overtime. | HR-11, HR-12, X-02, IN-06 |
| CR-17 | **PHASE-047 — HR Growth (Talent):** performance cycles/competencies/goals, recruitment (vacancies→applicants→interviews), training programs & certifications, org structure/positions/grades, employee document expiry tracking, external HR integration surface. | HR-05…HR-10, DF-51 |
| CR-18 | **PHASE-048 — Projects & Contracting:** WBS tasks/milestones, project budgets vs actuals, EVM progress, resource allocation, change orders, subcontractor contracts & certificates, retention (ضمان) handling, progress-certificated invoicing, field-service dispatch & SLA. | H-06, PR-01…PR-15 |
| CR-19 | **PHASE-049 — CMMS (Asset Maintenance):** maintenance work orders, preventive schedules by calendar/meter, spare-parts consumption, asset meters/odometer, asset transfer between branches, barcode/QR asset tags, warranty/insurance/license expiry registers. | H-15, F-01…F-09, F-11 |
| CR-20 | **PHASE-050 — Quality Management (QMS):** NCR, CAPA, calibration records, SPC control charts, quality specifications, supplier quality records, COA/COC generation, complaint tracking, batch quality holds, recall readiness, HACCP-style risk analysis. | Q-01…Q-12, M-23 |
| CR-21 | **PHASE-051 — Foreign Trade & Logistics:** letters of credit, documentary collections, Incoterms, bills of lading, packing lists, customs declarations & HS codes, duty/tax computation into landed costs, certificates of origin/compliance, shipment tracking, bonded-warehouse handling, duty drawback. | H-08, L-01…L-14 |

### Wave 3 — Stage 14: Enterprise Platform (PHASE-052…059)

| # | Decision | Authority |
|---|----------|-----------|
| CR-22 | **PHASE-052 — Workflow & Approvals Engine:** multi-step approval chains with conditional amount/department branching, delegation (absence), escalation timers, email/mobile approve actions, full step history, document-linked tasks, rules-engine alerts, outbound event hooks. | H-14, W-01…W-12 |
| CR-23 | **PHASE-053 — Accounting Depth & Treasury:** additional analytic dimensions beyond cost-center/project (department/region/channel/employee), hierarchical cost-center aggregation, full FX revaluation runs, segment reporting (branch P&L), AR/AP netting for dual-role partners, intercompany vouchers, cash-flow forecasting, daily cash position, bank guarantees, cash-account banking details (IBAN/SWIFT), inter-account netting, vault management, multi-currency cash boxes, card/gateway reconciliation, split payments. | A-01…A-15, T-01…T-13, S-19, DF-55 |
| CR-24 | **PHASE-054 — Tax & Corporate Compliance:** corporate income tax provisioning (per jurisdiction profile with REQUIRES_VERIFICATION discipline), Zakat (KSA) declaration support, withholding tax, excise tax positions, stamp duty, tax calendar with obligations tracking, multi-year tax reporting, SAF-T-style audit file export, transfer-pricing disclosure data extracts — **plus the Phase-2 e-invoicing integrations:** ZATCA Phase-2 (clearance/reporting API, CSID certificate lifecycle, UBL 2.1 + XAdES signing — post-GATE discipline preserved) and the Egypt ETA adapter (N-02/X-09). | X-01, X-03…X-07, X-08 (P2), X-09, X-10…X-13, N-02 |
| CR-25 | **PHASE-055 — Public API & Webhooks Platform:** tenant API keys with scopes/rate limits, generated OpenAPI 3.1 document, outbound webhooks with retries and HMAC signing, iPaaS-ready recipes, BI export connectors (Power BI/Tableau feeds), event-carried data export. | H-21, N-10, N-11, N-21, IN-19…IN-23, IN-25 |
| CR-26 | **PHASE-056 — Payments & Commerce Integrations:** production payment provider adapter (DR-002 resolution — at least one of Moyasar/HyperPay/Tap/PayTabs), payment links with invoices (PayLink-style), BNPL provider integrations (Tamara/Tabby), e-commerce connectors (Salla/Zid/Shopify/WooCommerce via the existing commerce-port), marketplace ingestion (Amazon/Noon), carrier integrations (Aramex/SMSA/DHL) with invoice shipment tracking. | H-09, N-03, N-04, IN-02…IN-04, IN-07…IN-10, S-13 |
| CR-27 | **PHASE-057 — BI & Analytics:** report builder (drag dimensions/measures), pivot/cross-tab surfaces, self-service dashboards with widgets, report alerts, scheduled report delivery by email/WhatsApp (closing F-7 honestly), predictive/what-if scenario surfaces, KPI engine, benchmarking placeholders, free drill-down, saved views for reports, side-by-side report comparison. | R-01…R-15, F-7, PP-22…PP-24, PP-27 |
| CR-28 | **PHASE-058 — Enterprise Identity & Governance:** SSO (SAML 2.0/OIDC — Azure AD/Okta/Google Workspace), LDAP bridging, SCIM provisioning, WebAuthn passkeys, tenant-enforced MFA policy, GDPR/CCPA data-subject request register, consent management, retention policy automation, internal audit module with risk register, fraud-detection hooks, field-level audit trail surfaces, real SoD matrix, e-signature on documents/reports. | H-20, IN-28…IN-32, G-01…G-10, G-19, G-20, UX-19, PP-28 |
| CR-29 | **PHASE-059 — Platform Operations & Trust:** per-tenant backup/restore, full data export/portability, tenant quotas, Redis cache layer, background-jobs console UI, secrets management (Vault-style), sandbox tenants, public status page + SLA publication, support ticket portal + public KB, CI/CD deployment pipelines, APM/observability exporter completion, FinOps cost views, auto-DR drills, data archival, K8s/Helm/multi-region deployment optionality, hosted load-test closure. | H-19, PL-01…PL-18, TB-24…TB-30, TB-31…TB-35, G-14…G-18, FD-33 |

### Wave 4 — Stage 15: Differentiation & Growth (PHASE-060…065)

| # | Decision | Authority |
|---|----------|-----------|
| CR-30 | **PHASE-060 — Sales & CRM Depth:** opportunity pipeline with stages/probability/values, campaigns with ROI, sales targets/quotas per rep/territory, territories, rebates, contract price agreements with periods/ceilings, formula-based pricing, channel management, scheduled delivery windows, drop-ship orders, sales forecasting, customer portal (statements/invoices/payments — the deferred S-20, sharing portal infra with P-05). | S-01…S-07, S-10, S-11, S-17, S-18, S-21, S-20 |
| CR-31 | **PHASE-061 — POS & Retail Depth:** loyalty programs (points/tiers), gift cards/vouchers, e-receipts (email/WhatsApp), external POS integrations, cashier hardware integration (thermal printers, cash drawers, customer displays, scales), POS API for third parties. | S-08, S-09, IN-11, IN-12, N-16, N-19 |
| CR-32 | **PHASE-062 — UX Excellence & Document Design:** dark mode (app-wide, not Storybook-only), white-label theming (tenant logo/brand colors), saved views/filters on lists, bulk actions, column chooser, server-side pagination unification, quick row actions, copy-document-as-template, autosave drafts, print template designer (tenant-customizable templates incl. payslip), watermarks/DRAFT stamps, batch print, reprint reasons, barcode label templates, ECM-style document folders/versions, global search expansion (⌘K across all entities), realtime notifications (WebSocket), PWA shell, product tours/onboarding wizard refresh, in-app help center, changelog page, report-a-problem button, Arabic-Indic numeral display option, **the additional-locales framework (H-23 — Urdu/French roll-out substrate, AR/EN stay canonical)**, **the iOS client (UX-11 — Expo iOS target with parity tests, honoring DR-P25-05 by decision here)**, and sync-conflict surfaces for users (TB-34). | TB-01…TB-14, TB-15…TB-18, TB-22, TB-34, FD-01…FD-17, FD-21…FD-29, FD-34, FD-35, A-13, H-23, UX-05…UX-09, UX-11, UX-12…UX-18, PP-01…PP-10, PP-13, PP-14, PP-17…PP-19, PP-29…PP-34, §D additions |
| CR-33 | **PHASE-063 — Gulf & Arabic Differentiators:** full Hijri calendar support across reports/filters/closings (Umm al-Qura-standard conversion, dual-calendar display), Tafqeet (التفقيط) as a platform service on every money surface, Ramadan/Hajj/season planning patterns (seasonal budget templates & demand profiles), Murabaha/Tawarruq accounting template pack (Sharia-compliant financing structures), JoFotara (JoF) Jordanian e-invoicing adapter, Yemen-market tax pack completion, GCC e-invoicing readiness matrix (BH/KW/OM/QA phases), deeper Omani/Bahraini VAT packs. | DF-01…DF-06, DF-08, DF-10, DF-54, §D additions |
| CR-34 | **PHASE-064 — AI Copilot & Intelligent Automation:** the documented non-goal #9 is **formally reversed by decision** (this register): an Arabic-first conversational copilot over permitted data (GL queries, customer balances, stock checks), supplier-invoice OCR ingestion into AP drafts, GL auto-classification suggestions, anomaly detection on entries, cash-flow prediction, smart reorder recommendations, Arabic report narration, fuzzy bank-match suggestions, voice entry assist. All AI features are tenant-opt-in, permission-gated, and never write financial records without human confirmation. | DF-25…DF-35, UX-20 |
| CR-35 | **PHASE-065 — Growth Platform & Customer Success:** referral program, partner/reseller program with margin management (leveraging white-label), in-app messaging campaigns, product usage analytics + feature-adoption tracking, customer health scores, MRR/ARR/churn revenue dashboard, trust center (security/compliance public pages), legal document library (Terms/DPA/SLA/AUP), feature-request voting, public changelog, self-serve trial → paid conversion flows. | DF-36…DF-48, DF-49, DF-50, TB-26…TB-30, §D additions |

### Cross-cutting program rules

| # | Decision | Authority |
|---|----------|-----------|
| CR-36 | **Discipline gates (every phase):** each phase MUST ship with (a) its new tables in SQL migration **and** Drizzle mirror **and** `ENTITY_CATALOG.md`; (b) new permissions seeded with the 245-discipline zero-drift check extended; (c) AR/EN dictionary parity (4,186-style equality) for every new screen key; (d) `docs:validate` green; (e) RLS attack tests A1–A10 for every new tenant table; (f) feature-flag gating with template-composable grants; (g) offline sync surface assessment (desktop/mobile clients updated or explicitly N/A-recorded). | House disciplines (audit §21) |
| CR-37 | **Sequential numbering is binding:** PHASE-035…065 identifiers are fixed by this register and may not be renumbered. A phase may ship early/late but its ID is immutable. v3.1 extends the same immutability to PHASE-066…068. | This register |
| CR-38 | **Wave gates:** Stage-12 gate = "sellable" (ZATCA-1 + pricing decision OQ-002 + payments-ready); Stage-13 gate = "full ERP" (MRP + HR + WMS + projects live); Stage-14 gate = "enterprise" (API platform + SSO + BI + ops); Stage-15 gate = "differentiated" (Arabic/AI/growth advantages). Release strategy updates the tier table accordingly. | RELEASE_STRATEGY.md v3.0 rows |
| CR-39 | **OQ-002 (pricing) is a Wave-1 entry condition, not a phase:** final plan pricing is an owner decision recorded in SUBSCRIPTION_AND_ENTITLEMENTS.md; PHASE-037/056 phases assume it resolved. | OQ register |
| CR-40 | **The program is documentation-first:** this register + [COMPLETENESS_ROADMAP.md](COMPLETENESS_ROADMAP.md) + the 31 phase documents are the authoritative plan. Implementation happens phase-by-phase per the 15-step protocol; each completion appends a report and flips the IMPLEMENTATION_STATUS row. v3.1 extends the document set to 34 phase documents + the two gap-analysis layer files. | AGENT_START_HERE.md protocol |

## B. Identifier allocation (v3.0 + v3.1)

| Namespace | v1.1/v2.0 range | v3.0 range | v3.1 range | Notes |
|---|---|---|---|---|
| Phases | 001…034 | 035…065 | **066…068** | immutable (CR-37 extended) |
| Stage groups | 1…11 | 12…15 | — (066/068 → 14, 067 → 15) | waves 1…4 |
| Decisions | DR-001…, ED-01…19 | CR-01…40 | **CR-41…48** | this register |
| Modules | 26 existing | new module keys per phase doc | +`ifrs` (066/067) | feature keys follow `<module>.<capability>` |
| Entities | 198 | +N per phase doc | +N per 066/067/068 doc | every new table: SQL + Drizzle + ENTITY_CATALOG row (CR-36) |
| Permissions | 245 | +N per phase doc | +N per 066/067/068 doc | zero-drift discipline extended |
| Reports | 85 contracts | +N per phase doc | +N per 066/067/068 doc | REPORT_CATALOG rows mandatory |
| Goldens/INV/BR | G-01…32, INV-001…26, BR-001…056 | continue per phase doc | continue (next free at implementation) | JOURNAL_RULES/ACCOUNTING_INVARIANTS/BUSINESS_RULES updated |
| Gap IDs | — | H-01…H-23, A/S/P/I/M/Q/F/HR/PR/T/X/L/R/W/N/PL/G/UX + FD/IN/TB/PP/DF | **L1-01…L1-23, L2-01…L2-20** | full mapping in COMPLETENESS_ROADMAP.md §6 |

## C. What this program does NOT redo (already delivered / already shipped)

1. The **13th industry template** (`industry.rental_logistics`) — shipped in the delivered archive (migration `0047`).
2. The **marketing landing surface** — shipped at the public root (38 bilingual keys).
3. The **platform admin console, subscription/billing + checkout, onboarding activity-selection wizard** — shipped in stages 1–11 (audit §5.1) and treated as prerequisites.
4. The **command palette (⌘K), keyboard shortcuts, offline sync clients, consolidation, posting engine, RLS isolation, decimal discipline** — audit §21 "do not touch" list. Every v3.0 phase MUST preserve these invariants (CR-36 gates).

## D. Owner additions beyond the three audit reports

Items the independent audits did not enumerate, added by the platform owner's review
(they carry the same authority as audited gaps):

| # | Addition | Home phase |
|---|---|---|
| OA-01 | **Arabic-Indic numeral display option** (٠١٢٣ vs 0123) as a per-user locale preference across all numeric surfaces | PHASE-063 |
| OA-02 | **Sync-fleet regression duty:** every phase adding synced entities must extend the offline outbox/inbox contracts + run the sync-fleet harness | CR-36 (all) |
| OA-03 | **SDAIA/KSA cloud-hosting compliance note** in deployment documentation (data-residency posture for KSA public-sector deals) | PHASE-059 |
| OA-04 | **Command-palette coverage rule:** every new module registers its navigation + searchable entities into ⌘K | CR-36 (all) |
| OA-05 | **Demo/sandbox tenant per industry template** with realistic seeded data for sales demos | PHASE-040 |
| OA-06 | **Performance budgets per new table** (index strategy, EXPLAIN-verified hot paths) as phase acceptance criteria | CR-36 (all) |
| OA-07 | **Interim delivery convention:** the program ships as versioned archives `ERP_PLATFORM_PHASE0NN.zip` per completed phase, built from this repository state | This register |
| OA-08 | **The second/third-round gap layers (v3.1):** the 43 gaps documented in the two gap-analysis layer files carry the same authority as audited gaps (CR-41); their dispositions are CR-45/CR-46 | This register (v3.1) |

---

*This register was authored as part of the 2026-11-10 completeness planning session and
extended 2026-11-11 by the v3.1 gap-consolidation wave (CR-41…CR-48). It
extends — and never contradicts — CONSOLIDATION_REGISTER.md (v1.1), EXPANSION_REGISTER.md
(v2.0), and the 18 binding ADRs. Validation: `scripts/validate_docs.py` check 8 (v3.0
artifacts) verifies this register, the roadmap, and the 34 phase documents exist with
canonical headings.*
