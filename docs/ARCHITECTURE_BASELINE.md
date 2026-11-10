# ARCHITECTURE_BASELINE — Universal Business ERP Platform

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28 (consolidation pass; v2.0 expansion note)
> **Authority:** This is the single authoritative summary of the selected system architecture. It **supersedes conflicting statements** in older overview documents; the detailed documents it links remain the normative source for their domains. Change control per [handoff/IMPLEMENTATION_PROTOCOL.md](handoff/IMPLEMENTATION_PROTOCOL.md).

## 1. Product and deployment shape

A multi-tenant, multi-industry SaaS ERP for MENA/GCC markets — Arabic-first, fully
bilingual (AR/EN), RTL-first UI — delivered as:

| Surface | Technology | Delivery phase |
|---------|------------|----------------|
| Web application | Next.js (App Router) — marketing site + ERP UI + BFF session routing | PHASE-005+ |
| REST API (system of record) | NestJS modular monolith, `/api/v1`, versioned, idempotent | PHASE-002+ |
| Desktop application | Tauri v2 (Windows-first; Electron documented fallback) | PHASE-021 |
| Android application | React Native + Expo (field sales + personal accounts) | PHASE-022 |
| Offline capability | SQLite local store + outbox/inbox sync (server-authoritative posting) | PHASE-016 (POS subset), PHASE-020 (general) |

One deployable API; all shared business rules live in server domain modules; clients
consume generated TypeScript contracts (`packages/contracts`) and never implement
financial logic ([architecture/ADR/ADR-0002-typescript-monorepo.md](architecture/ADR/ADR-0002-typescript-monorepo.md),
[ADR-0003](architecture/ADR/ADR-0003-nextjs-nestjs.md)).

## 2. Technology stack (authoritative)

| Layer | Choice | ADR |
|-------|--------|-----|
| Language / repo | TypeScript (strict), pnpm + Turborepo monorepo | ADR-0002 |
| Backend framework | NestJS modular monolith, lint-enforced module boundaries | ADR-0001, ADR-0003 |
| Database | PostgreSQL 16+; **system of record for money, documents, stock, jobs, audit** | ADR-0004 |
| Data access | Drizzle ORM; hand-reviewable SQL migrations; non-owner runtime roles | ADR-0004 |
| Money | `numeric(19,4)` amounts / `(19,6)` qty / `(19,8)` rates; decimal.js; **string JSON transport** with per-type patterns ([api/API_CONVENTIONS.md](api/API_CONVENTIONS.md) §7) | ADR-0009 (as corrected by DEF-001) |
| Jobs / async | pg-boss on PostgreSQL (`FOR UPDATE SKIP LOCKED` semantics); Redis **deferred** with documented triggers | ADR-0008 |
| Auth | argon2id + server-side sessions (httpOnly cookies), TOTP MFA, device tokens; JWT never in browser | ADR-0015 |
| Multi-tenancy | Shared schema + Row-Level Security + application tenant context (defense in depth) | ADR-0005 |
| Ledger | Centralized posting engine as the **only** GL writer; relational journal + append-only audit — **no event sourcing** | ADR-0007, ADR-0017 |
| Tax / compliance | Jurisdiction packs (effective-dated, verified against official sources); e-invoicing adapters (ZATCA first) | ADR-0010 |
| Reporting | Report contracts with executable assertions; HTML → headless Chromium PDF; exceljs XLSX; tafqit amount-in-words | ADR-0011 |
| Offline | SQLite + outbox/inbox; per-entity conflict policies; LWW forbidden for financial data | ADR-0012 |
| UI | Tailwind CSS v4 + Radix primitives + custom RTL-first design system | ADR-0016 |
| Object storage | S3-compatible (attachments, exports, prints) via signed URLs | [architecture/SYSTEM_OVERVIEW.md](architecture/SYSTEM_OVERVIEW.md) §3 |

## 3. Module map (19 modules + 6 in v2.0)

Authoritative table: [architecture/MODULE_BOUNDARIES.md](architecture/MODULE_BOUNDARIES.md).
Blueprint v2.0 ([EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)) adds six post-GA modules —
`fixed_assets`, `notes`, `installments`, `budgeting`, `payroll`, `consolidation`
(PHASE-026…034) — under the same boundary and dependency rules. Layers: shared kernel → core domains (accounting+posting engine, partners, items) →
operations (inventory, sales, purchasing, treasury, tax) → experience (reporting, pos,
crm, manufacturing, distribution, notifications, files) → platform (identity, tenancy,
entitlements, audit, sync). Dependency direction is enforced in CI; cross-module writes
are forbidden outside the published-service allow-list. Document-table ownership note
(DEF-007 resolution): `receipts` is owned by **sales**, `payments` by **purchasing**;
the money-movement engine that both use is a treasury-owned service (feature
`treasury.receipts_disbursements`, PHASE-008).

## 4. The five architectural invariants (non-negotiable)

1. **The posting engine is the only writer of `journal_entries`/`journal_lines`** — every
   financial effect from any module, client, or sync path flows through it
   ([accounting/POSTING_ENGINE.md](accounting/POSTING_ENGINE.md)).
2. **Tenant isolation is layered and provable** — transaction-local GUC + `FORCE RLS` +
   composite tenant-scoped FKs + per-table CI attack tests + production RLS-denial canary
   ([security/SECURITY_AND_TENANT_ISOLATION.md](security/SECURITY_AND_TENANT_ISOLATION.md)).
3. **Money is never approximate** — NUMERIC storage, decimal arithmetic, string transport,
   per-currency rounding with residuals posted, never dropped ([architecture/ADR/ADR-0009-money-precision.md](architecture/ADR/ADR-0009-money-precision.md)).
4. **The engine, not the configuration, decides accounting truth** — INV-022 config-fuzz
   proves no template/plan/flag combination can alter journal math
   ([testing/ACCOUNTING_TESTS.md](testing/ACCOUNTING_TESTS.md) §2).
5. **Compliance claims require evidence** — no rate, field, or authority behavior is
   asserted without a cited official source; nothing may be *claimed* beyond the
   compliance-matrix ladder ([localization/compliance-matrix/README.md](localization/compliance-matrix/README.md)).

## 5. Data flow and consistency model

Writes: client → API controller → application service → domain services (posting engine,
tax engine, stock engine) → **single PostgreSQL transaction**. Reads: scoped query services
→ reports always reconcile to posted ledger data. Background jobs re-establish tenant
context per job (RLS applies to workers). Offline writes arrive as idempotent sync
commands and re-validate server-side (never trusted). See
[architecture/DATA_FLOW.md](architecture/DATA_FLOW.md).

## 6. Environments and deployment

Docker Compose in development (`api`, `web`, `postgres:16`, `minio`, `mailpit`); staging
mirrors production with seeded test tenant; production MVP = managed PostgreSQL, 1–2 API
nodes, object storage, nightly encrypted backups + WAL PITR (7d) + quarterly restore
drills. Sizing budgets and scaling ladder: [architecture/DEPLOYMENT_ARCHITECTURE.md](architecture/DEPLOYMENT_ARCHITECTURE.md);
backup/DR: [database/BACKUP_AND_RECOVERY.md](database/BACKUP_AND_RECOVERY.md),
[operations/DISASTER_RECOVERY.md](operations/DISASTER_RECOVERY.md).

## 7. What this platform is NOT (binding non-goals)

Microservices at launch; DB-per-tenant; event sourcing (ADR-0017); GraphQL; iOS (declared
non-goal); payroll HR operations (v2.0 adds **financial-scope** payroll at PHASE-029 — HR
ops stay excluded, ED-18); an integration store. Full list: [SCOPE_AND_NON_GOALS.md](SCOPE_AND_NON_GOALS.md).

## 8. Consolidation status

This baseline absorbs the audited best of Folders 1, 2, and 4 without architecture drift;
the post-GA **Blueprint v2.0 layer** (stages 9–11: six depth modules, five industry
commercial shells, ADR-0018) is specified canonically in [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)
and changes no decision above. Every adopted idea, rejected candidate, and corrected defect is traceable in
[CONSOLIDATION_REGISTER.md](CONSOLIDATION_REGISTER.md) (ideas) and
[CONSOLIDATION_VALIDATION_REPORT.md](CONSOLIDATION_VALIDATION_REPORT.md) (defects DEF-001…DEF-010).
Nothing in this document may be cited to bypass the detailed domain specifications.
