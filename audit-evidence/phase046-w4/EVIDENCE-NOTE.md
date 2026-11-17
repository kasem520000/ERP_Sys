# PHASE-046 W-4 — the evidence-artifact disclosure (2026-11-17, recorded at push time)

## What this directory should have held — and what happened instead

Per the per-wave evidence convention (every gate run its own verbatim
log artifact, every number in the gate table traceable to a file in
this directory), the W-4 delivery's gate table
([the gate doc](../../docs/operations/gate-evidence/2026-11-17-phase046-w4.md))
references the following artifacts that this directory does **not**
contain:

- `typecheck.log` · `lint.log` · `depcruise.log` · `api-unit.log` ·
  `unit-workspace.log` · `payroll-folder.log` · `hr-folder.log` ·
  `isolation-entitlements-tenancy-migrations-identity.log` ·
  `docs-validate.log` · `permissions-drift.log` · `manifests.log` ·
  the remaining shared-gate logs (i18n parity, capabilities,
  id-ledger, history-secrets, shells, check:rls).

**The facts, plainly:**

1. The W-4 gate runs happened during the W-4 working session of
   2026-11-17 (the gate doc records their results verbatim — the
   table, the two first-attempt reds honestly kept, and the
   base-commit stash test that proves both honest repairs fix
   PRE-EXISTING defects). The gate doc was finalized at 04:51 UTC;
   the delivery record in `agent-ctx/NEXT_ACTION.md` at 04:53 UTC.
2. That session ended in a context exhaustion **before the delivery
   commit could be pushed** — the W-4 work survived only in the
   sandbox working tree, while the raw `*.log` artifacts did not
   survive the sandbox session handoff at all: the sandbox's own
   checkpoint layer ignores `*.log` by its `.gitignore`, so no
   checkpoint ever captured them, and the working-tree copies were
   lost across the sandbox restarts that followed (the exact restart
   at which each log vanished cannot be pinned from the surviving
   state — the 08:31 UTC full-tree snapshot already contains none of
   them, so the loss predates it).
3. This push is performed from a later session, by the owner's
   dispatch, from the surviving W-4 working-tree state (byte-verified
   against that snapshot — content-identical for every W-4 file).
   The logs are **absent, honestly declared — not fabricated, not
   re-synthesized to match the recorded numbers.** Fabricating log
   artifacts after the fact to satisfy the convention would be a far
   graver violation than the loss itself (the F1 law: never make a
   record that is not literally true).

## Where the W-4 numbers therefore live

The gate doc
(`docs/operations/gate-evidence/2026-11-17-phase046-w4.md`) is the
wave's record of the runs, as finalized by the session that performed
them: typecheck 8/8 · lint 8/8 · depcruise clean 1,926 modules ·
14,307 deps · api unit 660/660 (57 files) · unit workspace 8/8 · the
new route-level spec 11/11 · payroll folder 8 files · 64/64 · hr
folder 13 files · 83/83 · isolation+entitlements+tenancy×2+migrations
+identity×2 8 files · 1,693/1,693 · docs 33/33 · permissions drift
300 = 300 · manifests 13/13 · i18n parity 6,007 = 6,007 ·
capabilities agree · id-ledger 0 errors · history-secrets 0 · shells
PASS · check:rls clean (292 catalog tables).

## The re-proof path (already the plan's own law)

- **W-5 and W-6** re-run the payroll folder suite, the hr folder, and
  the shared gates on their own heads — every W-4 surface (the verify
  route's CAS/SoD laws, the export's round-trips, the negative ledger
  proof) is exercised by `statutory-routes.spec.ts` on each of those
  heads.
- **W-7** runs the FULL DB suite + the complete shared-gate battery on
  the final unified head (the plan's scope-label law — the full suite
  was never a per-wave obligation).
- Any regression the lost logs might have hidden would surface at
  those heads; the W-4 record's claims are thereby re-proven on every
  subsequent head, which is the strongest verification available
  after the artifact loss.

## The standing lesson (recorded for the process, dated 2026-11-17)

Gate-log artifacts must be pushed (or copied to a checkpoint-safe
location) **in the same working session that generates them** — a
sandbox whose checkpoint layer ignores `*.log` silently discards the
evidence layer of every wave that does not push before its session
ends. From W-5 onward: the evidence directory is created and its
artifacts pushed together with (or immediately after) the code, in
the same session, before any context-exhaustion boundary.
