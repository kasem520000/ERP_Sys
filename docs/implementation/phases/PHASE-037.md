# PHASE-037 — ZATCA Phase-1 & QR Compliance

> **Status:** COMPLETE — IMPLEMENTED (2026-11-10) · **Wave:** 1 / Stage 12 · **Register:** [CR-07](../../planning/COMPLETENESS_REGISTER.md) · completion evidence:
> [reports/PHASE-037-COMPLETION.md](reports/PHASE-037-COMPLETION.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-01 Phase-1 · H-02) · X-08 (P1) · DF-54 · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.1

## 1. Phase Overview

- **Phase ID:** PHASE-037
- **Title:** ZATCA Phase-1 & QR Compliance (الامتثال السعودي (المرحلة الأولى) ورمز QR)
- **Objective:** Deliver Saudi e-invoicing **Phase-1 generation compliance with
  zero external APIs** — the audit's verdict that "Phase 1 (QR) needs no
  outside access; it is pure mathematical encoding", so its absence was "a
  decision, not a necessity". Concretely: the TLV-base64 QR payload (seller
  name, VAT registration number, timestamp, invoice total including VAT, and
  VAT amount in SAR), a **real scannable QR image** in the print templates
  replacing today's `[QR]` text placeholder (H-02), the per-device **invoice
  counter (ICV)** and **previous-invoice-hash (PIH)** chain, and the
  **simplified-invoice (B2C) compliance path**. The existing
  `zatca-stub.ts` evolves into an honest Phase-1 GENERATION adapter — it
  never claims clearance or reporting (Phase-2 with CSID, UBL 2.1, and
  XAdES signing is explicitly staged for PHASE-054), and the GATE-1..4
  verification discipline is preserved and documented. The GCC e-invoicing
  readiness matrix document is started here (DF-54; completed by PHASE-063).
- **Business value:** Saudi Arabia is the largest GCC market; without
  compliant QR invoices the platform legally cannot be sold to any Saudi
  entity (H-01). Phase-1 is the compliance milestone of the Wave-1
  "sellable" gate (CR-38) and unblocks every KSA demo: a printed invoice a
  ZATCA reader can actually scan.
- **الملخص التنفيذي (AR):** توليد الامتثال السعودي للفوترة الإلكترونية (المرحلة
  الأولى) دون أي واجهة خارجية: ترميز TLV-base64 لحمولة QR (اسم البائع، الرقم
  الضريبي، الطابع الزمني، الإجمالي شامل الضريبة، مبلغ الضريبة بالريال)، ورمز QR
  حقيقي قابل للمسح في قوالب الطباعة بدلاً من النص المزيّف، وعدّاد الفواتير ICV
  وسلسلة التجزئة PIH لكل جهاز، ومسار الفاتورة المبسطة (B2C). يتطوّر
  `zatca-stub.ts` إلى وضع «توليد» صادق لا يدّعي مقاصةً ولا إبلاغاً (المرحلة
  الثانية في PHASE-054)، وتُوثَّق بوابات GATE-1..4، ويبدأ مستند جاهزية الفوترة
  الإلكترونية الخليجية، مع ترحيل أعمدةٍ قابلة للفراغ يحافظ على انضباط السجل
  الملحق ومهمة تعبئة رجعية للتاريخ.

## 2. Scope

In scope:

1. **Invoice chain columns** (H-01 Phase-1 part, X-08 P1): additive NULLABLE
   columns on the sales and POS invoice tables — `icv`,
   `previous_invoice_hash`, `invoice_hash`, `qr_payload` — with the
   append-only discipline preserved (existing rows never reshape; history is
   filled by a backfill job, never rewritten).
2. **Device registry** (`zatca_devices`): per-tenant EIAS device rows —
   device UUID/serial, solution-provider placeholder fields, registration
   status (an explicit NOT_REGISTERED placeholder for Phase-2), and the
   per-device ICV counter — the chain anchor.
3. **QR generation service** (pure computation): TLV encoding of the five
   mandated fields, the base64 payload, the invoice hash digest, and PIH
   linking; pinned unit vectors including the ZATCA-documented sample
   encodings and the genesis PIH convention (base64 SHA-256 of ASCII "0").
4. **QR image rendering** (H-02): server-side SVG/data-URI generation (the
   qrcode library) injected into the print templates, REPLACING the `[QR]`
   text placeholder in the packages/ui print templates — the printed invoice
   becomes scannable (the QR leg of FD-28).
5. **Adapter honesty**: `zatca-stub.ts` → Phase-1 GENERATION mode with the
   status vocabulary GENERATED/FAILED only; the Phase-2 surface
   (clearance/reporting, CSID lifecycle, UBL 2.1, XAdES) remains a typed
   NOT_IMPLEMENTED placeholder documented for PHASE-054 (BR-061).
6. **Simplified-invoice path** (B2C): invoice classification surfaced
   (standard vs simplified); BR-060 fail-closed guard — a KSA-VAT tenant
   cannot issue or print a simplified invoice without a QR payload.
7. **Backfill job**: a bounded pg-boss job computing and persisting
   icv/hash/payload for already-issued invoices in issuance order per device
   — dry-run report first, idempotent, resumable.
8. **Settings screen**: the EIAS device registration placeholder — create and
   view devices, chain status, registration-status placeholder
   (Phase-2-ready), on the 12-template screen discipline.
9. **GCC e-invoicing readiness matrix started** (DF-54): the KSA row marked
   live for Phase-1 with Phase-2 staged; BH/KW/OM/QA/AE planning rows —
   the document is completed by PHASE-063 per CR-33.
10. **Report extension**: the PHASE-035 `tax.e-invoicing-log` report gains
    ICV/PIH/QR-presence columns and a per-device filter (no new registry
    key; the REPORT_CATALOG.md row is updated).

Out of scope: ZATCA Phase-2 clearance/reporting API, CSID, UBL 2.1 + XAdES
signing (054) · Egypt ETA adapter (054) · JoFotara Jordan (063) · QR for
non-KSA jurisdictions beyond the readiness-matrix rows · any external
network call.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 (Activation & Truth Restoration) COMPLETE | planned — the v3.0 entry phase; hard ordering rule (roadmap §5: 035 ships first) |
| e-invoicing tables + the `tax.e-invoicing-log` report contract | delivered baseline; report closed by PHASE-035 |
| v3.0 planning artifacts (register + roadmap + this document) | authored 2026-11-10 |

The hard ordering rule that binds this phase: 037 before 054 — the Phase-2
clearance integration builds on this chain. PHASE-036 is a parallel-safe
sibling, not a prerequisite; cumulative counters assume the sequential
lineage 035 → 036 → 037 → ….

## 4. Design Impact

- **Migrations**: `0050_zatca_phase1.sql` (journal 49 → 50 — next in sequence
  after PHASE-036's 0049): the four nullable invoice columns + the partial
  (tenant, device_id, icv) index + the RLS'd `zatca_devices` tenant table;
  append-only grants untouched; Drizzle journal/spec updated.
- **Entities**: +1 table (ENTITY_CATALOG.md 203 → 204); the invoice columns
  are additive on catalogued tables (column addenda rows).
- **Permissions**: +1 key — `tax.einvoicing.devices.manage`; zero-drift
  extended (248 → 249 on the sequential lineage; seed = mirror).
- **i18n**: ~90 new AR/EN keys (device settings, chain status,
  classification labels, print notices); parity gate as ever.
- **Reports**: +0 contracts; the `tax.e-invoicing-log` extension is
  documented in REPORT_CATALOG.md (columns + filter, no new registry key).
- **Feature flags**: no new key — Phase-1 generation rides the existing
  `tax.einvoicing_zatca` entitlement (FEATURE_CATALOG.md unchanged; plan
  grants untouched; template-composable behavior preserved).
- **Invariants/rules**: INV-027 (chain integrity — ICV strictly monotonic
  per device; PIH equals the stored hash of the device-chain predecessor;
  verification fails closed on tamper) appended to ACCOUNTING_INVARIANTS.md
  (numbering continues from INV-026); BR-060 (QR mandatory, fail-closed) and
  BR-061 (honest generation vocabulary) appended to BUSINESS_RULES.md
  (numbering continues from BR-059 shipped with PHASE-036).
- **Docs**: this document · ACCOUNTING_INVARIANTS.md · BUSINESS_RULES.md ·
  REPORT_CATALOG.md note · DATA_DICTIONARY.md (the four columns + device
  rows) · the GATE-1..4 discipline record · the started
  docs/tax/GCC_EINVOICING_READINESS.md.
- **Sync surface (CR-36 g)**: `icv`/`invoice_hash`/`qr_payload` ride the
  existing invoice feed projections additively (offline clients render them
  read-only); device management is online-only — N/A-recorded.
- **Performance (OA-06)**: EXPLAIN-verified (tenant, device_id, icv) index
  path for chain verification at seeded volumes; QR rendering happens at
  print time only (payload stored, not the image).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | TLV encoder + hash-chain service with pinned vectors (ZATCA samples, genesis PIH, SAR decimal discipline 19,4) | api |
| T-02 | Migration `0050` (four nullable columns + indexes + `zatca_devices`) + Drizzle journal/spec | api |
| T-03 | ICV minting + PIH linking inside the invoice issue transaction (per-device, monotonic, zero gaps) | api |
| T-04 | QR image renderer (SVG/data-URI via the qrcode library) + payload caching | api |
| T-05 | Print-template change: replace the `[QR]` text placeholder with the rendered image across invoice templates | web |
| T-06 | `zatca-stub.ts` GENERATION mode: honest status vocabulary + the Phase-2 NOT_IMPLEMENTED placeholder + tests | api |
| T-07 | Simplified/standard invoice classification + the BR-060 fail-closed issue/print guard | api |
| T-08 | Backfill pg-boss job (dry-run report, issuance-order, idempotent, resumable) | api |
| T-09 | EIAS device settings screen + chain-status view (12-template discipline, RTL) | web |
| T-10 | `tax.e-invoicing-log` extension (ICV/PIH/QR columns + per-device filter) + catalog note | api |
| T-11 | INV-027/BR-060/BR-061 rule specs + tamper and verification tests | api |
| T-12 | GCC readiness matrix document + GATE-1..4 discipline record + docs wave | docs |
| T-13 | Full local gates + evidence recording | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migration 0050 applies cleanly with zero reshape of existing rows
   (nullable columns; append-only discipline preserved); the backfill
   completes over seeded invoices with ZERO journal-row changes (the
   negative ledger proof) and is idempotent on re-run.
2. Payload correctness: the TLV encoder reproduces the ZATCA-documented
   sample encodings for the five mandated fields (seller name, VAT
   registration number, ISO-8601 timestamp, invoice total incl VAT, VAT
   amount in SAR) — unit-pinned vectors.
3. Print preview (Playwright): the invoice print preview renders the QR as
   an IMAGE; an in-test QR reader decodes it back to the EXACT stored
   payload (H-02 closed); a repo grep proves the `[QR]` text placeholder is
   gone from the shipped templates.
4. Chain integrity (INV-027): issuing N invoices on one device yields ICV
   1..N strictly monotonic, each PIH equal to its predecessor's stored hash,
   and the first invoice carrying the documented genesis PIH.
5. Hash-chain tamper test: mutating any stored total or hash breaks
   verification — the verification service fails closed with a typed
   failure pack, and the failing run is recorded as evidence.
6. Simplified invoices: a B2C invoice for a KSA-VAT tenant cannot be issued
   or printed without a QR payload (BR-060 typed rejection, zero residue);
   standard invoices carry the QR as well.
7. Adapter honesty (BR-061): contract tests + a repo grep prove the ZATCA
   adapter's status vocabulary is GENERATED/FAILED only — no clearance or
   reporting claims exist before Phase-2; the Phase-2 surface is a typed
   NOT_IMPLEMENTED placeholder.
8. House gates green (CR-36): RLS A1–A10 for `zatca_devices` · typecheck ·
   lint · unit · `docs:validate` · i18n parity (~90 keys) · permissions
   drift 248 → 249 · SQL + Drizzle + ENTITY_CATALOG parity (204) ·
   EXPLAIN budget for the chain-verification path.
9. The GCC e-invoicing readiness matrix document exists with the KSA Phase-1
   row marked live and Phase-2 staged (054), BH/KW/OM/QA/AE planning rows,
   and the GATE-1..4 discipline record linked from the phase docs.
10. Completion report `docs/implementation/phases/reports/PHASE-037-COMPLETION.md`
    appended with evidence; `IMPLEMENTATION_STATUS.md` row flipped; archive
    delivered as `ERP_PLATFORM_PHASE037.zip` (OA-07).

## 7. Risks and Constraints

- **Spec drift on the Phase-1 field set** — mitigated by pinning the official
  sample vectors in unit tests and carrying a REQUIRES_VERIFICATION flag on
  any spec detail not covered by a sample; Phase-2 deltas resolve in 054.
- **Hash serialization choice** — the invoice-hash digest depends on a
  canonical serialization that Phase-2 finalizes with UBL 2.1; mitigated by a
  code-level version marker on the digest function and a documented
  re-derive path for 054 (PIH links remain valid; no chain rewrite).
- **Backfill ordering correctness** — ICV must follow issuance order;
  mitigated by issuance-timestamp ordering with a deterministic tie-breaker,
  a dry-run report before commit, and idempotent re-runs.
- **Print performance** — QR rendering on batch prints; mitigated by storing
  `qr_payload` (render-at-print only) and SVG size budgets in the template.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-037-COMPLETION.md`
  (payload vectors, the scannable-decode evidence, the tamper-failure run,
  gate output).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-037 row → COMPLETE;
  `NEXT_ACTION.md` → next eligible phase PHASE-038 (Procurement Sourcing)
  with its prerequisites.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE037.zip` (OA-07);
  the owner continues with «ابدأ تنفيذ المرحلة PHASE-038».
- Handoff notes for PHASE-038: none binding (parallel-safe sibling). For
  PHASE-054: the chain columns (icv/PIH/hash), `zatca_devices`, and the
  NOT_IMPLEMENTED Phase-2 surface are the exact substrate the clearance
  integration extends — this phase's GATE-1..4 record is its entry evidence.
