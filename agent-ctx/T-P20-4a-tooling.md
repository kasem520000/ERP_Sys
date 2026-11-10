# T-P20-4a — k6 fleet script + capabilities cross-check tooling (Wave 4)

> Task ID: 4-a · PHASE-020 · MASTER-PLAN §15 (T16 k6 + T17 capabilities tool).
> Delivered by subagent (session cut by an environment shutdown before the
> evidence file was written — the orchestrator verified every deliverable,
> re-ran the gates, and records them here; retroactive record).

## Files

| File | Status |
|---|---|
| `tests/performance/sync-fleet.js` | NEW (531 lines) — k6 fleet script |
| `packages/contracts/src/sync/capabilities.ts` | NEW (314 lines) — the machine fixture |
| `packages/contracts/src/sync/index.ts` | EXTENDED (fixture re-export) |
| `scripts/check-capabilities-matrix.ts` | NEW (415 lines) — the cross-check gate |
| `package.json` | +`check:capabilities-matrix` script |

## k6 sync-fleet.js (T16)

- 500 VU default (`STAGE_VUS`), 5m duration (`DURATION`), BASE_URL env.
- Scenarios: (a) pull loop — status → per-entity pull round-trip with the
  Trend `sync_roundtrip`; (b) push loop — small v2 pos_sale batches (the
  exact `{sale:{…}}` inner shape from `_oracle.ts posSalePayload`); (c) the
  5% revoked-fleet slice — cheap DEVICE_REVOKED/403 rejection asserts (R-06).
- Thresholds: `sync_roundtrip` p(95) < 3000ms; expected-response failure rate
  < 0.05 (2xx/expected-4xx tagged).
- Provisioning: documented staged procedure in the header (register devices
  → refresh→access tokens → PROVISIONED_TOKENS_FILE JSON → `k6 run -e …`);
  without the tokens file the script degrades to anonymous status checks
  (documented). **The sandbox does NOT execute k6** — the script + procedure
  is the deliverable (MASTER-PLAN §15 says exactly this; the completion
  report notes it honestly).

## capabilities fixture + gate (T17)

- `SYNC_CAPABILITY_FIXTURE` (contracts): implemented rows ONLY for what is
  TRUE TODAY — the 016 POS rows + the 020-generalized rows (pull feeds,
  permission snapshot, partner:contact_merge, sales_invoice drafts
  create/update, drafts.reassign, device registry/attestation/revocation,
  D-04 watermark, reconciliation queue) — each carrying its gate pointer
  (e.g. `chaos-matrix C-01`, `pos/golden.spec`).
- `scripts/check-capabilities-matrix.ts`: parses
  `docs/offline/OFFLINE_CAPABILITIES_MATRIX.md` §2 + the fixture →
  row-by-row PASS/DEFERRED(phase) table; exit ≠ 0 on any cell claiming
  implementation without a matching gate (or vice-versa), unknown-operation
  typos, or unannotated deferrals ≤ phase 020.

## Gate outputs (re-run by orchestrator 2026-11-04)

```
$ pnpm check:capabilities-matrix
… (row-by-row table)
rows: PASS 13 · DEFERRED 15 · n/a 16 — cells: PASS 13 · DEFERRED 37
(annotated 10 + matrix-derived 27) · online-only 18 · — 108
capabilities matrix and fixture agree: every implemented claim carries a
gate, every ✓ row has a fixture row, every deferral is annotated.
EXIT=0

$ node --check tests/performance/sync-fleet.js   # k6 script parses
$ cd packages/contracts && npx tsc --noEmit -p tsconfig.json   # clean
```

## Orchestrator close-out additions (same wave)

- `CURRENT_SHIPPED_PHASE` → `"PHASE-020"` (prerequisites.ts) + the pinned
  spec (template-prerequisites.spec.ts) + the §18-lesson-5 maintenance
  moves: the two "beyond shipped phase" synthetic proofs advanced
  PHASE-020 → PHASE-021; layer-fixtures BUSINESS_KEYS gains the 0029
  offline keys (sync_protocol + device_management; the 021/022 app keys
  stay enterprise-only); the 8 business-plan golden hashes re-pinned.
  Configuration suite 97/97 green after the flip.

## Decisions (for the completion report)

1. k6 staged-not-executed (sandbox honesty — MASTER-PLAN §15's explicit
   instruction; quoted in the completion report §5.3).
2. The fixture's implemented set is exactly the 016+020 surface; the 021
   (desktop) and 022 (van/personal) columns stay DEFERRED with phase
   annotations — asserted by the gate, not by prose.
3. The gate derives DEFERRED rows from the matrix when the fixture row is
   absent + annotated (matrix-derived deferrals), so unimplemented future
   cells need no fixture noise.

## Leftovers

- None for this task. (The W4 orchestrator close-out handled the
  CURRENT_SHIPPED_PHASE flip + spec pins; see T-P20-4b-docs.md decisions.)
