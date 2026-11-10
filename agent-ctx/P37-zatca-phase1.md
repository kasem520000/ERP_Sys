# P37 — ZATCA Phase-1 & QR Compliance (working record)

Task: PHASE-037 per `docs/implementation/phases/PHASE-037.md` (CR-07).
Everything below is the as-built ledger for the closeout and the 054 author.

## Shipped surface (the short map)

- `apps/api/migrations/0050_zatca_phase1.sql` — the seven NULLABLE
  sales_invoices addenda + stamp-shape CHECK + partial UNIQUE
  (tenant, device, icv) + chain/classification indexes + the RLS'd
  `zatca_devices` + the one permission seed (drift 248 → 249) + the purge
  path + schema_version 50. Journal idx 49; MIGRATIONS manifest;
  Drizzle mirror (salesInvoices addenda + zatcaDevices).
- `tax/application/zatca/` — tlv.ts (phase1-tlv-v1) · hash-chain.ts
  (invoice-hash-v1 + GENESIS_PIH) · qr-renderer.ts (PNG/SVG) ·
  zatca-phase1-service.ts (devices / stampForPost / verifyDeviceChain /
  backfillPlan+Run / assertPrintGuard).
- `tax/infrastructure/zatca.store.ts` (the only writer of the chain
  columns; reserveNextIcv = SELECT FOR UPDATE + counter bump + predecessor
  hash read) · `zatca-backfill.job.ts` (zatca.backfill-sweep, 3:15 UTC).
- `tax/adapters/zatca/zatca-stub.ts` → ZatcaGenerationAdapter (BR-061).
- `sales/application/invoices.ts` — post() step 8 (the stamp after the
  numbering bind, over the STORED posted_at) + the classification capture
  at create (POS → SIMPLIFIED default).
- `pos/application/receipt-service.ts` — the QR injection + BR-060 print
  guard. `packages/ui/print/templates.ts` — v2 (the [QR] placeholder gone).
- `tax/presentation/tax.controller.ts` — 8 zatca routes
  (tax.einvoicing.devices.manage) · `tax/tax.module.ts` — service + job
  registration · `infra/auth/route-permissions.ts` — +8 rows ·
  `reporting` — tax.e-invoicing-log v2 · `sync` — the additive projection ·
  isolation registry + zatca_devices fixtures · identity-flows pin 249 ·
  drift seed list + migrations.spec + permissions-drift.spec extended.
- WEB-037: `/settings/tax/zatca-devices` + the manager (3 tabs) + api-types
  + 89 i18n keys (4,536=4,536) + the nav crumbs entry.
- Docs: INV-027 · BR-060/061 · REPORT_CATALOG v2 row · DATA_DICTIONARY §16 ·
  ENTITY_CATALOG 204 · GCC_EINVOICING_READINESS.md (DF-54) ·
  GATE-DISCIPLINE-ZATCA.md · DR-001 status note · the phase header flip ·
  the completion report.

## The BR-060 semantics decision (recorded — the one design turn)

The first cut fired the guard on mere VAT registration, which REJECTED every
legacy POS/sync posting (their tenants are SA-VAT registered without
devices). The honest resolution: **enrollment is the compliance switch** —
BR-060 engages when an EIAS device exists (the settings screen is the
enrollment act; the spec's feature-flag note §4 rides
tax.einvoicing_zatca). Consequences:
- Unenrolled tenants: zero behavior change (their suite stays green —
  45 failed tests → 0).
- Enrolled: the stamp is produced in-transaction ALWAYS (device → stamp), so
  the typed post-side rejection is the backstop for the DB-impossible
  REGISTERED-without-number state (ck_tax_registrations_number_shape); the
  print-side rejection is real and DB-provable (the strip test).
- The DB spec proves both legs + the unenrolled no-behavior-change leg.

## Pinned vectors (verify before touching the encoder)

- Sample payload (Mother's Market / 310122393500003 / 2015-12-17T12:17:28Z /
  1000.00 / 150.00):
  `AQ9Nb3RoZXIncyBNYXJrZXQCDzMxMDEyMjM5MzUwMDAwMwMUMjAxNS0xMi0xN1QxMjoxNzoyOFoEBzEwMDAuMDAFBjE1MC4wMA==`
- Genesis PIH: `X+zrZv/IbzjZUnhsbWlsecLbwjndTpG0ZynXOif7V+k=`
  = base64(SHA-256(ASCII "0")).
- The QR timestamp is the STORED posted_at normalized to
  `YYYY-MM-DDTHH:MM:SSZ` (SQL to_char on the verify path, JS toISOString on
  the mint path — same instant, or the walk breaks).

## Gate repairs (recorded; the 035/036 ledger continuation)

1. golden.spec failure pack — November period reset to OPEN before the
   soft-close→lock walk (file-order robustness).
2. g32-elimination — the two-line journal assertion is now order-insensitive
   (sorted compare; the heap's load-dependent debit/credit order).
3. custom-fields OA-06 value-fetch EXPLAIN — accepts either index on the
   same predicate (uq_* or ix_custom_field_values_tenant_entity_ids).
4. identity-isolation seedFixtures — the custom-fields cluster moved from
   'partners' to 'purchase_orders' (the custom-fields functional spec owns
   (TENANT_A, 'partners') AND reads resolveLayout('items','sales')
   expecting NULL — neither entity may be claimed by the isolation
   fixtures; the value row is polymorphic by design).
5. validate_docs 8b — accepts NOT_STARTED or COMPLETE (the PHASE-034
   baseline precedent; the status can never silently vanish).

## Environmental item (recorded, not repaired)

crm/tasks.spec.ts reminder-sweep mail capture raced its deadline twice in
four full runs under peak load ("no matching mail captured (6 total)"),
passed in isolation and on the final green run. Nothing in this phase's diff
touches crm/email. The 030/036 environmental-runbook lineage continues.

## Final gate evidence (2026-11-10)

- typecheck 8/8 · lint 8/8 (turbo) · api unit 486/486 · web unit 73/73
- **DB full suite: 169 files, 2,407/2,407 GREEN** (final run /tmp/db-suite4.log)
- docs:validate 32/32 · i18n parity 4,536=4,536 · permissions drift 249=249
- The QR decode evidence: jsQR-in-Chromium round-trip (unit spec, 3 tests).
