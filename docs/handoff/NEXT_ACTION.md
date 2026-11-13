# Next Action

> **Status:** LIVING DOCUMENT — updated at every phase completion · **Updated:** 2026-11-13 (PHASE-044 COMPLETE — PHASE-043 (MRP) unblocked; STOPPED awaiting the owner's go per the standing rule)

## The single next action

**PHASE-044 is COMPLETE and pushed** — the triple flip is done (the phase doc
header, the IMPLEMENTATION_STATUS row + header, and
[the completion report](../implementation/phases/reports/PHASE-044-COMPLETION.md)
with the CR-48 code-evidence checklist). **Execution is stopped here per the
owner's standing rule** — the next phase awaits the owner's go.

**Start PHASE-043 (Manufacturing II — MRP & Planning, CR-13)** — «ابدأ تنفيذ
المرحلة PHASE-043» — when the owner gives the go. Its prerequisites are ALL
satisfied now (042 ✓ · 044 ✓ · 038 ✓): the WMS inputs it consumes shipped with
this phase — bin-level availability, the FEFO/expiry-aware supply qualification,
the consignment exclusion (BR-076), and the reservation policy engine (I-14);
the pick strategy service is the single source both sales picking and MRP
netting call (the PHASE-044.md §8 handoff notes). Read
[PHASE-043.md](../implementation/phases/PHASE-043.md) first. **PHASE-045 (HR
Core)** remains eligible in parallel («ابدأ تنفيذ المرحلة PHASE-045»).

## Post-PHASE-044 context for the next author (2026-11-13)

PHASE-044 (WMS & Inventory Intelligence, CR-14 — scope extended by v3.1/CR-46
L1-20 returnable packaging) is COMPLETE — H-07, I-01…I-25, PP-11/PP-12, DF-12,
and L1-20 all closed: migrations `0067`–`0073` (schema_version 73; 22 RLS'd
tables, catalog 239 → 261; the INV-029 same-transaction law with the nightly
`inventory.bin-reconcile` probe), the directed putaway (PP-12 BIN-LABEL-V1) +
picking (FIFO/FEFO/NEAREST, waves, cluster, PP-11 scan confirms) surfaces, LPN
plates, the ABC-classified cycle counts (BR-075), the quarantine/HOLD board
(G-43), consignment/VMI (BR-076 + G-44), cross-docking, kitting (G-45), the
serial-movement ledger, the alert jobs + transit exceptions + transfer pricing
(G-46), the OA-02 sync duty (the task feeds + the two scan write intents,
BR-074), the five web boards + the PP-11 embeds, and the four intelligence
reports (registry 95 → 99). Permissions 279 → 287 (matrix §3.21); goldens
G-43…G-46 (the honest slots — the planned G-47…G-50 numbering note); INV-029;
BR-072…077; i18n 5,672 keys/locale.

**The honest notes for the next author:**

- **The full DB suite is the gate that catches corpus drift** — 2,979/2,979 over
  202 files this phase, but only because T-20 ran it FIRST since 042 and repaired
  what T-03…T-13's isolated-folder runs had missed (the AppModule-boot DI hole,
  the tenancy CoA pins, the picking suite's shared-item WAC pollution, the
  corpus-fragile assertions — PHASE-044-COMPLETION.md §4f). Run the full suite
  before every flip; isolated folders lie.
- **Nest DI under vitest:** the transform emits no `design:paramtypes` — every
  constructor param BEFORE a later `@Inject` must carry its own `@Inject` (the
  compiled app is unaffected; the boot is not). The four WMS services carry the
  repaired pattern.
- **The legacy-stock backfill** ships as an operator job
  (`apps/api/scripts/backfill-bins.ts`, dry-run first) — existing tenants'
  pre-WMS stock lands on the DEFAULT bins on its first run; the probe goes green
  after it.
- **Migration slots continue from 0074.**

The roadmap's Wave-2 order continues: 043 (MRP) → 045/046 (HR) → 047 (Costing
II) → 048 (Field Service) → … — see
[MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) §Wave 2.
