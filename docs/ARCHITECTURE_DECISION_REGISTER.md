# ARCHITECTURE_DECISION_REGISTER — Master Decision Register

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28
> **Authority:** One-line index + durable record for every major decision. Full ADRs
> remain the normative record for architecture decisions
> ([architecture/ARCHITECTURE_DECISIONS.md](architecture/ARCHITECTURE_DECISIONS.md), ADR-0001…ADR-0018);
> product/compliance commitments live in [decisions/](decisions/) (DR-xxx). This register
> cross-indexes all of them and adds the consolidation decisions (CD-xxx) that do not
> warrant standalone ADRs but must never be silently re-litigated.

## 1. Baseline architecture decisions (all ACCEPTED — see ADRs for options/trade-offs)

| ID | Decision | ADR | Security / financial implication | Reconsideration trigger |
|----|----------|-----|----------------------------------|--------------------------|
| AD-01 | Modular monolith (one NestJS deployable) | [ADR-0001](architecture/ADR/ADR-0001-modular-monolith.md) | Tenant isolation by RLS, not network splits | Extraction criteria per ADR |
| AD-02 | TypeScript pnpm+Turborepo monorepo; contracts as single API truth | [ADR-0002](architecture/ADR/ADR-0002-typescript-monorepo.md) | — | — |
| AD-03 | Next.js web (BFF) + NestJS API | [ADR-0003](architecture/ADR/ADR-0003-nextjs-nestjs.md) | No tokens in browser (httpOnly sessions) | — |
| AD-04 | PostgreSQL 16+ + Drizzle; hand-reviewable SQL migrations | [ADR-0004](architecture/ADR/ADR-0004-postgresql-drizzle.md) | System of record; RLS available | — |
| AD-05 | Shared-schema multi-tenancy + RLS + app tenant context | [ADR-0005](architecture/ADR/ADR-0005-multi-tenancy.md) | Release-blocking requirement; attack tests A1–A11; RLS-denial canary | DB-per-tenant for a compliance-demanding tier |
| AD-06 | UUIDv7 technical ids + separate official document numbers | [ADR-0006](architecture/ADR/ADR-0006-identifiers.md) | Offline-safe identity; legal sequences server-side | — |
| AD-07 | Centralized posting engine = only GL writer | [ADR-0007](architecture/ADR/ADR-0007-centralized-posting-engine.md) | Accounting integrity bottleneck by design; INV-001…022 guard it | — |
| AD-08 | pg-boss on Postgres; Redis deferred | [ADR-0008](architecture/ADR/ADR-0008-jobs-redis.md) | Jobs transactional with business data | Measured queue-path contention |
| AD-09 | Money NUMERIC(19,4)/(19,6)/(19,8), decimal.js, string transport; **per-type wire patterns (DEF-001)** | [ADR-0009](architecture/ADR/ADR-0009-money-precision.md) | No float drift; regex conflicts resolved | — |
| AD-10 | Tax jurisdiction packs; nothing country-specific in engine | [ADR-0010](architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) | Compliance honesty (see CD-05/CD-06) | New jurisdiction outside pack model |
| AD-11 | Report contracts; HTML→Chromium PDF; exceljs | [ADR-0011](architecture/ADR/ADR-0011-reporting-printing.md) | Assertions block bad output | — |
| AD-12 | Offline: SQLite + outbox/inbox; server-authoritative posting | [ADR-0012](architecture/ADR/ADR-0012-offline-sync.md) | Money/stock never LWW | — |
| AD-13 | Desktop on Tauri v2 | [ADR-0013](architecture/ADR/ADR-0013-tauri-desktop.md) | — | WebView2 minimum-version issues |
| AD-14 | Android on Expo; shares contracts/domain-core only | [ADR-0014](architecture/ADR/ADR-0014-android-expo.md) | — | — |
| AD-15 | argon2id + server sessions + TOTP MFA + device tokens | [ADR-0015](architecture/ADR/ADR-0015-authentication.md) | Login/refresh excluded from idempotency keys (CD-04) | — |
| AD-16 | Tailwind v4 + Radix + custom RTL-first design system | [ADR-0016](architecture/ADR/ADR-0016-ui-tailwind-radix.md) | — | — |
| AD-17 | **No event sourcing** — relational journal + append-only audit | [ADR-0017](architecture/ADR/ADR-0017-no-event-sourcing.md) (adopted from Folder 4 during consolidation) | One source of financial truth; audit via triggers + events | Regulatory demand for event-log chaining |
| AD-18 | **Multi-entity consolidation** — legal entity = tenant; read-only member aggregation via one audited platform-plane reader; eliminations posted by the engine into the parent's consolidation books; zero cross-tenant writes (Blueprint v2.0) | [ADR-0018](architecture/ADR/ADR-0018-multi-entity-consolidation.md) (policy: [decisions/accounting/DR-006](decisions/accounting/DR-006-consolidation.md)) | Member RLS never relaxed; consolidated statements are derived artifacts; eliminations are real journals (INV-006/013/026) | Group calendar misalignment; mandated statutory translation method; intercompany document automation request |

## 2. Consolidation decisions (2026-10-28) — new rationale recorded during this pass

| ID | Title | Status | Context & options | Selected decision | Reasons / trade-offs | Affected docs | Reconsider when |
|----|-------|--------|------------------|-------------------|--------------------|---------------|-----------------|
| CD-01 | Seven-way effect matrix as operation-authoring gate | ACCEPTED (adopted from F1) | New operations risk being specified only as journal lines | Require doc-state/inventory/AR-AP/cash/GL/tax/audit matrix row + G-scenario postconditions before approval | Cheap review gate; prevents under-specified posting operations | POSTING_ENGINE §4, ACCOUNTING_ENGINE_SPECIFICATION §2.5 | — |
| CD-02 | Leakage-path checklist per feature | ACCEPTED (adopted from F1) | Table-level RLS tests don't cover files/jobs/exports/caches/logs | Mandatory checklist in security review | Complements A1–A11 | SECURITY_AND_TENANT_ISOLATION §3 | — |
| CD-03 | Tafqit amount-in-words on financial prints | ACCEPTED (adopted from F1) | Arabic legal/business custom; F3 lacked it | Shared per-locale helper + fixtures (3-decimal currencies) at PHASE-013 | Small scope, high business value | PRINTING_AND_EXPORT §1–2 | — |
| CD-04 | Login/refresh excluded from idempotency-key rule | ACCEPTED (adopted from F2) | Blanket "all POSTs keyed" replays stale sessions — latent defect | Explicit exclusion + rate-limit/rotation protection | Correctness of auth flows | API_IDEMPOTENCY §1.5 | — |
| CD-05 | Anti-fabrication marketing rule | ACCEPTED (adopted from F4) | Compliance claims could outpace evidence in commercial surfaces | No copy may claim beyond matrix ladder; in-product status shown from matrix data | Protects against regulatory misrepresentation | compliance-matrix README §1 | — |
| CD-06 | Tenant pack-version pinning **rejected** | REJECTED (corrects earlier comparison report) | F2 pins pack versions per tenant | Keep effective-dated, law-driven packs; platform-managed verification | Pinning legal rates would diverge from law; stability already provided by effective dating | REGIONAL_TAX_AND_COMPLIANCE §2.5, CONSOLIDATION_REGISTER CR-2-F2-04 | A jurisdiction offers a legitimately electable regime version |
| CD-07 | Permission keys follow resource-table ownership | ACCEPTED (fixes DEF-007) | `treasury.receipts.*` violated matrix rule §1.1 vs MODULE_BOUNDARIES | `sales.receipts.*` / `purchasing.payments.*`; treasury keeps the money-leg *feature* key | Smallest consistent change; matches role templates & feature catalog | AUTHORIZATION_MATRIX §3.4, phases 008/011/012, FEATURE_CATALOG | A future module re-organization (requires ADR) |
| CD-08 | Canonical industry template identity = manifest `id` | ACCEPTED (fixes DEF-008) | Three spellings of template ids across docs | `industry.*` manifest id canonical; filenames are doc slugs; 8 manifests extracted as JSON | Machine keys must be unique and engine-resolvable | industries/templates/README, INDUSTRY_CATALOG | — |
| CD-09 | Deferred ledger-balance trigger | ACCEPTED (adopted from F4, fixes DEF-010) | F3's belt-and-braces trigger fired immediately → aborts valid postings | `DEFERRABLE INITIALLY DEFERRED` constraint trigger at commit + engine-bypass test | DB-level last resort preserved without breaking multi-line inserts | CONSTRAINTS_AND_INDEXES §2, PHASE-007 scope | — |
| CD-10 | Status-badge token binding | ACCEPTED (adopted from F2) | F3 had 4/6 lifecycle states colored implicitly | Binding table incl. APPROVED; visual tests assert it | Uniform status language across screens | DESIGN_TOKENS §3 | — |
| CD-11 | Costing–picking decoupling explicit | ACCEPTED (adopted from F4) | Implicit in F3 §5; make it a testable rule | Separate attributes, never conflated | Food/pharma correctness | INVENTORY_ACCOUNTING §5 | — |
| CD-12 | Report-reconciliation independent code path | ACCEPTED (adopted from F4) | Golden datasets could reuse report's own query | Expected values via direct SQL | Catches self-consistent-but-wrong reports | REPORTING_AND_DOCUMENT_ENGINE §2.2 | — |

## 3. Superseded / rejected decision pointers

- **Tenant pack pinning (F2 idea):** REJECTED — see CD-06. The earlier comparison report
  (`docs/PLAN_COMPARISON_REPORT.md` §6, item 3) recommended adoption; this register
  **supersedes that recommendation** after source-level re-verification (Stage B).
- **Folder 2 stack** (Next.js 14/React 18 + BullMQ-at-launch): REJECTED — superseded by
  F3's ADR-0003/ADR-0008.
- No F3 ADR is superseded by this consolidation; ADR-0009's Consequences section was
  **corrected** (DEF-001) without changing its decision.

## 4. Register rules

1. Any decision here may be superseded only by a new ADR (architecture) or DR
   (product/compliance) that links back to it.
2. ADR↔register↔spec contradictions are release-blocking docs defects
   (checked by [scripts/validate_docs.py](../scripts/validate_docs.py) where mechanically possible).
3. Security- or finance-relevant decisions must name their test evidence in the ADR
   before a phase that depends on them may start.
