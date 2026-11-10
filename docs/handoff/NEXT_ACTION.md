# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-10 (PHASE-036 COMPLETE — next eligible: PHASE-037)

## The single next action

**Start PHASE-037 (ZATCA Phase-1 & QR Compliance, CR-07)** — «ابدأ تنفيذ
المرحلة PHASE-037». Per EXPANSION sequencing the wave-1 siblings are
parallel-safe; 037's prerequisites (035 ✓, the tax module + print templates
delivered in the 34-phase baseline) are all satisfied. Read
[PHASE-037.md](../implementation/phases/PHASE-037.md) first — the TLV-base64
QR payload, the real scannable QR image replacing the `[QR]` placeholder
(H-02), the ICV/PIH per-device chain, and the simplified-invoice (B2C) path;
generation-only, zero external APIs (Phase-2 clearance/CSID is PHASE-054).

## Post-PHASE-036 context for the next author

PHASE-036 (Extensibility Core — Custom Fields) is COMPLETE — the audit's
single most important functional gap (FD-18/19/20) closed: migration `0049`
(five RLS'd tables — the definitions registry, the ADR-0019 TYPED value
store with the num_nonnulls=1 row law, the picklist pair, form layouts), the
code-owned entity registry over the six first-wave entities (partners, items,
sales invoices, purchase orders, employees, projects), the ONE reusable value
guard injected into all six entities' create/update/read paths
(validate-before-insert — zero partial writes; typed 400 packs;
full-replace semantics), the `/settings/custom-fields` manager + picklist
editor + BR-059 form designer, the shared CustomFieldSurface on the six
forms, and dynamic custom-field columns on the partner list.
CURRENT_SHIPPED_PHASE = "PHASE-036" (schema_version 49; permissions 248=248;
web i18n 4,447=4,447; mobile 371=371; ENTITY_CATALOG 203 domain rows;
isolation registry 183; report registry 86 — unchanged, settings surfaces
are not reporting).

Key handoffs from 036 (read `agent-ctx/P36-custom-fields.md` + the
[completion report](../implementation/phases/reports/PHASE-036-COMPLETION.md)
first):

- **The value guard is the ONE import later phases reuse**:
  `validateValues` / `persistValues` / `attachValues` / `mergeValuesInto` /
  `customFieldsPayloadSchema` from `modules/configuration/api`. Any phase
  from 042 on that ships a new entity registers it into
  `CUSTOM_FIELD_ENTITIES` in the same PR (one registry line + the
  ENTITY_CATALOG row — the ADR-0019 additive rule, zero migrations).
- **037's print-template opportunity**: sales invoices now carry
  `customFields` on their read paths (get + findWithLines merge) — including
  optional print inclusion is a 037-scope decision, never an obligation.
- **The re-pin discipline held**: permissions 245→248 (both seed-path lists
  extended — permissions-drift.ts AND permissions-drift.spec.ts), i18n
  4,290→4,447, catalog 198→203, isolation +5/+30; the golden
  effective-configs did NOT move (platform.custom_fields is not
  template-relevant, so layer-fixtures stay untranscribed — the documented
  fixture role).
- **Two recorded 034-tree gate repairs** (the 035 ledger continuation): the
  reporting boot rule's missing `consolidation.reports.view` (every
  full-AppModule boot spec was failing) and the 0041 consolidation
  account/purpose pins (64/41 → 65/42). If your phase boots AppModule in DB
  specs, it now boots clean.
- **The environmental item**: `report-hammer` fails on this hardware (the
  4-lane concurrent trial-balance compute exceeds the production 15s
  statement_timeout; unreachable pre-036 because the boot defect skipped it;
  single-lane ga-spike budgets pass) — recorded per the 030 environmental
  runbook precedent. Watch also one golden.spec period-state order flake
  (observed once, passed on every rerun; `restorePeriodsOpen` is the
  designed harness).
- Watch items carried: SF-026-001 (purge vs guards), SF-026-002 (RC-10
  seeded drift DB proof), the 028 ControlGuard first production call-site,
  the 029 "E2" item + payslip print-template deferrals, the 030
  environmental runbook set (+ report-hammer per this phase).
