# Completion Report — PHASE-037

> **Status:** COMPLETE · **Updated:** 2026-11-10

## Phase ID / Date

PHASE-037 — ZATCA Phase-1 & QR Compliance (Blueprint v3.0, wave 1 / stage 12,
register CR-07 — the audit's H-01 Phase-1 verdict: "Phase 1 (QR) needs no
outside access; it is pure mathematical encoding", so its absence was "a
decision, not a necessity") · 2026-11-10

## Summary

Saudi e-invoicing **Phase-1 GENERATION compliance** landed with ZERO external
APIs, as migration `0050_zatca_phase1.sql` (schema_version 50): the seven
additive NULLABLE `sales_invoices` columns (`zatca_device_id`, `icv`,
`previous_invoice_hash`, `invoice_hash`, `invoice_hash_version`, `qr_payload`,
`classification` — the stamp-shape CHECK makes the chain columns all-or-nothing),
the partial UNIQUE `(tenant, device, icv)` as the INV-027 DB floor, the
EXPLAIN-verified chain-walk index, and the RLS'd `zatca_devices` registry
(device UUID/serial + solution-provider placeholders, an explicit
`NOT_REGISTERED` Phase-2 placeholder — BR-061 — and the per-device
`icv_counter` chain anchor). The pure-computation core (`application/zatca/`):
the TLV encoder over the five mandated QR fields (seller name, VAT number,
ISO-8601 timestamp, total incl. VAT, VAT total — byte-pinned vectors, UTF-8
BYTE-length discipline), the versioned hash chain (`invoice-hash-v1` code
marker + the genesis PIH convention base64(SHA-256(ASCII "0")) with the
documented 054 re-derive path), and the QR image renderer (PNG data-URI +
SVG, render-at-print only — OA-06). `ZatcaPhase1Service` stamps INSIDE the
invoice post transaction (ICV minted under a row lock, PIH = the predecessor's
stored hash, digest over the canonical v1 serialization with the STORED
posted_at instant — the verification walk re-derives every digest from the
rows and fails closed with a typed failure pack), verifies, backfills
(issuance order `posted_at, created_at, id`, dry-run first, idempotent,
resumable, the negative ledger proof), and owns the BR-060 fail-closed guards
(engagement = enrollment: an EIAS device is the compliance switch; an enrolled
KSA-VAT tenant cannot issue or print a SIMPLIFIED invoice without a QR
payload — typed `ZATCA_QR_PAYLOAD_REQUIRED`, zero residue; unenrolled tenants
keep their exact pre-037 behavior). The adapter file evolved from the PHASE-023
refusing stub into the honest `ZatcaGenerationAdapter` (BR-061: the produced
vocabulary is GENERATED/FAILED only; `submit()` is the typed
`ZATCA_PHASE2_NOT_IMPLEMENTED` refusal preserving the GATE-1..4 checklist).
H-02 closed: the print templates (a4-document + receipt-80/58 → v2) render the
QR as a REAL scannable `<img>` (the `[QR]` text placeholder is gone from the
shipped templates), decoded back to the exact stored payload by an in-test
reader in headless Chromium. The `tax.e-invoicing-log` report extended to v2
(ICV/PIH/QR-presence columns + the per-device filter, one batched stamp read);
the sync sales_invoices projection rides the chain fields additively (CR-36 g).
Permissions drift 248 → **249** (one key: `tax.einvoicing.devices.manage`).
i18n 4,536=4,536 (+89). ENTITY_CATALOG 203 → 204. GCC readiness matrix
started (DF-54); the GATE-1..4 discipline record written. Three recorded gate
repairs (below). All gates green. Next: PHASE-038.

## What Shipped (per the task table)

| Task | Delivered |
|---|---|
| T-01 TLV + hash-chain | `tax/application/zatca/tlv.ts` (5 mandated fields, tags 1..5, byte-length discipline, decode tool, `phase1-tlv-v1` marker) + `hash-chain.ts` (genesis PIH `X+zrZv/IbzjZUnhsbWlsecLbwjndTpG0ZynXOif7V+k=`, `invoice-hash-v1` canonical serialization + re-derive path) — pinned-vector unit spec (9 tests) |
| T-02 Migration 0050 | `0050_zatca_phase1.sql`: the seven nullable invoice columns + the stamp-shape CHECK + the partial UNIQUE floor + the chain/classification indexes + the RLS'd `zatca_devices` (purge-path policies; SELECT/INSERT/UPDATE — NO DELETE) + the composite tenant FK + schema_version 50; journal idx 49; MIGRATIONS manifest + spec pins; Drizzle mirror (`salesInvoices` addenda + `zatcaDevices`) |
| T-03 ICV/PIH minting | `tax/infrastructure/zatca.store.ts` (devices CRUD reads, chain reads, `reserveNextIcv` FOR UPDATE + `writeInvoiceStamp`, batched `listInvoiceStamps`) + the `post()` stamp step in `sales/application/invoices.ts` (step 8 — after the numbering bind, digest over the STORED posted_at; the audit record carries the stamp) |
| T-04 QR renderer | `qr-renderer.ts` (PNG 256px data-URI + SVG via the `qrcode` lib; no persisted images — render-at-print) + the H-02 decode spec (jsQR inside headless Chromium, byte-exact round-trip, 3 tests) |
| T-05 Print templates | `packages/ui/print/templates.ts` v2 for a4-document/receipt-80/58: the `qrImageUri` `<img>` block (~25mm, physical, caption) REPLACES the `[QR]` placeholder; raw `qrPayload` text only remains for offline PENDING_SYNC receipts |
| T-06 Adapter honesty | `adapters/zatca/zatca-stub.ts` → `ZatcaGenerationAdapter` (`ZATCA_GENERATION_STATUS_VOCABULARY` = GENERATED/FAILED; `generate()` digest; `submit()` = `ZATCA_PHASE2_NOT_IMPLEMENTED` + the preserved `ZATCA_UNMET_GATE_ITEMS`); back-compat registry alias kept |
| T-07 Classification + BR-060 | `classification` captured at create (POS → SIMPLIFIED default; explicit input validated); BR-060 post guard (enrolled + unstampable → typed rejection) + print guard (receipt service, enrolled-scoped) |
| T-08 Backfill job | `tax/infrastructure/zatca-backfill.job.ts` — pg-boss `zatca.backfill-sweep` (cron 3:15 UTC), per-tenant bounded sweep (500); the interactive plan/run routes share the service |
| T-09 Device settings screen | `/settings/tax/zatca-devices` (WEB-037): Devices / Chain & verification / Backfill tabs, NOT_REGISTERED honesty badges, chain table with truncated PIH/hash + QR badges, the typed failure-pack render, dry-run-first backfill with confirm; no delete anywhere (the chain anchor hint) |
| T-10 Report extension | `tax.e-invoicing-log` v2: `zatcaDeviceName/icv/previousInvoiceHash/qrPresent` columns + the `deviceId` equality filter + the `einvoicing-log-qr-presence-faithful` assertion; REPORT_CATALOG row updated |
| T-11 Rule specs | The DB spec `__db__/tax/zatca-phase1.spec.ts` (11 tests: device lifecycle, BR-060 unenrolled/enrolled, chain 1..N + genesis, tamper fail-closed + restore, print guard strip/restore, backfill idempotent + zero-journal, report columns/filter, sync columns, EXPLAIN index) |
| T-12 Docs wave | INV-027 (ACCOUNTING_INVARIANTS); BR-060/BR-061 (BUSINESS_RULES); REPORT_CATALOG v2 note; DATA_DICTIONARY §16 + 2 enum rows; ENTITY_CATALOG 204 + the addenda row; `docs/tax/GCC_EINVOICING_READINESS.md` (DF-54, started; SA live, BH/KW/OM/QA/AE planning, the RV register); `docs/decisions/compliance/GATE-DISCIPLINE-ZATCA.md`; DR-001 status note; the phase doc header flipped |
| T-13 Gates | Below |

## Verification (acceptance criteria → evidence)

1. **Migration 0050 applies cleanly with zero reshape** — the full DB suite
   boots the fresh chain through 0050 (journal 49 → 50; the
   migrations.db.spec manifest↔journal↔disk triple green; the drift CLI
   joins 0050's seed). The backfill's **negative ledger proof** is
   machine-checked: `journalCount()` before/after the run is identical while
   the history invoices gain their stamps; the re-run stamps 0 (idempotent);
   the workset reads `icv IS NULL` only (resumable).
2. **Payload correctness** — the pinned vectors: the documented sample
   five-field set encodes to
   `AQ9Nb3RoZXIncyBNYXJrZXQCDzMxMDEyMjM5MzUwMDAwMwMUMjAxNS0xMi0xN1QxMjoxNzoyOFoEBzEwMDAuMDAFBjE1MC4wMA==`
   byte-for-byte (unit spec, deterministic — recomputation inline is
   forbidden by the test); per-field TLV byte structure (tags 1..5, byte
   lengths 15/15/20/7/6); the ARABIC seller name length byte counts UTF-8
   BYTES (8 for "مطحة"); fail-closed input validation (15-digit VAT,
   ISO-8601 Z instant, SAR 19,4 discipline, non-empty name, the 255-byte
   TLV ceiling). REQUIRES_VERIFICATION items are registered in the GCC
   readiness doc's RV register (RV-1..3) with the §7 mitigations.
3. **Print preview renders the QR as an IMAGE (H-02 closed)** — the decode
   spec draws the data-URI into a canvas inside headless Chromium and a REAL
   QR reader (jsQR) decodes it back to the EXACT stored payload (both the
   documented sample and the Arabic-seller payload); the DB spec asserts the
   rendered receipt HTML carries `data:image/png;base64,` and NOT `[QR]`;
   the repo grep proves the `[QR]` placeholder is gone from
   `packages/ui/print/templates.ts` (the only remaining `qrPayload` render is
   the offline PENDING_SYNC text path — the payload exists only after the
   server post, so there is nothing to image yet).
4. **Chain integrity (INV-027)** — issuing N invoices on one device yields
   ICV 1..N strictly monotonic (asserted 1,2,3 + the post-backfill
   continuation), the first invoice carries the genesis PIH
   `X+zrZv/IbzjZUnhsbWlsecLbwjndTpG0ZynXOif7V+k=`, every PIH equals the
   predecessor's STORED hash (including across the live/backfilled
   boundary), and `verifyDeviceChain` returns `{ok, checked: N, failures:
   []}`.
5. **Tamper fails closed** — a "consistent-looking" forgery (all three
   totals moved together, keeping the net+tax=gross CHECK satisfied) breaks
   the walk: typed `ZATCA_CHAIN_BROKEN` with the failure pack (icv,
   invoiceId, reason); the restoration re-verifies `{ok: true}` — the chain
   is the integrity oracle for the strip/restore tests themselves.
6. **Simplified path (BR-060)** — an UNENROLLED tenant posts a SIMPLIFIED
   invoice unstamped with zero behavior change (the enrollment act is the
   device registry); an ENROLLED tenant whose QR cannot be built (the typed
   backstop branch, proven at the service boundary) fails
   `ZATCA_QR_PAYLOAD_REQUIRED` with zero residue; the print guard rejects
   the stripped payload-less simplified invoice typed and the byte-true
   restore re-verifies; STANDARD invoices carry the QR as well.
7. **Adapter honesty (BR-061)** — contract tests assert
   `ZATCA_GENERATION_STATUS_VOCABULARY = ["GENERATED","FAILED"]`, the
   `submit()` refusal is `ZATCA_PHASE2_NOT_IMPLEMENTED` carrying the GATE-1..4
   items + the 054 marker, and `regimeVerified` stays FALSE (the registry
   service's defense-in-depth gate unchanged).
8. **House gates** — typecheck 8/8 · lint 8/8 · unit 486 (api) + 73 (web) ·
   **DB full suite 2,407/2,407 green (169 files)** · docs:validate 32/32
   (validator 8b widened per the PHASE-034 COMPLETE-header precedent) · i18n
   parity 4,536=4,536 (+89) · permissions drift **249=249** (both seed-path
   lists extended) · manifests green · the EXPLAIN chain-walk budget rides
   the `(tenant, device, icv)` index family (the partial UNIQUE or the plain
   partial — the planner's volume-dependent choice; the partial UNIQUE is
   also the INV-027 floor) with `enable_seqscan` isolation in the sibling
   OA-06 pattern.
9. **GCC readiness matrix** — `docs/tax/GCC_EINVOICING_READINESS.md` exists:
   the KSA row LIVE for Phase-1 with Phase-2 staged (054), the
   BH/KW/OM/QA/AE planning rows with REQUIRES_VERIFICATION authority
   citations, the RV-1..3 register, and the GATE-1..4 discipline record
   linked (`GATE-DISCIPLINE-ZATCA.md` — "compute freely, claim nothing").
10. **This report + status flip** — IMPLEMENTATION_STATUS row flipped;
    CURRENT_STATE + NEXT_ACTION rewritten; the working record in
    `agent-ctx/P37-zatca-phase1.md`; the archive delivered as
    `ERP_PLATFORM_PHASE037.zip` (OA-07).

## Recorded gate repairs (the 035/036 ledger continuation)

- **`golden.spec` standard failure pack** — the setup soft-closed
  TENANT_A's FY2026-11 assuming it was OPEN; sibling suites (periods/
  invariants/concurrency) leave it non-OPEN depending on file order (the
  036 report already flagged the golden period-state order flake). The
  failure pack's subject is the POSTING REJECTION, not the transition — the
  fixture now resets November to OPEN before its own soft-close→lock walk
  (idempotent under any order; provenance comment).
- **`g32-elimination` line-order assertion** — the engine's two-line
  elimination entry has no documented order and the heap emits
  debit/credit in load-dependent order under full-suite CPU pressure; the
  G-32 shape is the SET {DR AP_CONTROL, CR AR_CONTROL} — the assertion now
  compares sorted lines (provenance comment).
- **`custom-fields` OA-06 value-fetch EXPLAIN** — the planner picks either
  the partial UNIQUE `uq_custom_field_values_tenant_entity_field` or the
  covering `ix_custom_field_values_tenant_entity_ids` on the same
  (tenant, entity_type, entity_id) predicate depending on stats volume;
  the budget's intent is "index scan, never seq-scan" — both honest index
  paths accepted (provenance comment).
- **`identity-isolation` seedFixtures collision** — the 036 isolation
  fixtures claimed `(TENANT_A, 'partners')` for the form-layouts DEFAULT,
  which collides with the custom-fields functional spec's own
  `(TENANT_A, 'partners')` row depending on file order; and the "no layout"
  probe reads `resolveLayout('items', 'sales')` expecting NULL, ruling
  'items' out too. The isolation cluster moved to `purchase_orders` (the
  registered entity no other spec writes a layout for; the value row is
  polymorphic by design — ADR-0019) with the collision genealogy recorded.
- **validate_docs 8b widened** — a v3.0 phase doc is born with the
  NOT_STARTED marker and its header flips to COMPLETE on delivery (the
  PHASE-034 baseline precedent); the check now requires one of the two
  markers so the status can never silently vanish.

## The environmental item (recorded, not repaired)

`crm/tasks.spec.ts` reminder-sweep mail capture raced its deadline twice
across four full-suite runs on this sandbox ("no matching mail captured (6
total)" under peak suite load) and passed on every isolated and subsequent
run — a load-dependent timing flake in the sweep's mail-wait harness, in the
036-report's environmental-runbook lineage (nothing in this phase's diff
touches crm/email). The 036 golden-period order flake's designed mitigation
(`restorePeriodsOpen`) plus the failure-pack repair above close the family.

## Handoff to PHASE-038 (Procurement Sourcing) / PHASE-054

None binding for 038 (parallel-safe sibling). For **PHASE-054** (ZATCA
Phase-2): the chain columns, `zatca_devices`, the `invoice-hash-v1` → UBL 2.1
re-derive path, the `ZATCA_PHASE2_NOT_IMPLEMENTED` surface, and
`GATE-DISCIPLINE-ZATCA.md` (the four gates are its entry evidence) are the
exact substrate the clearance integration extends. The registration_status
vocabulary (CHECK admits PENDING/REGISTERED/REVOKED) evolves in 054 with
zero reshape.
