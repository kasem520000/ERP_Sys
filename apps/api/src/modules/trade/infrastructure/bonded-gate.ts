import { sql } from "drizzle-orm";

import { type TenantDb, requireTenantContext } from "../../../infra/db/tenant-context";

import { BondedStockSuspendedError } from "../domain/trade-errors";

/**
 * PHASE-051 (W-38 — T-11, 2026-11-25) THE SHARED BONDED GATE (G-66's
 * own structural face — D-08's own demand, the 050 hold-gate precedent
 * verbatim): the plain documented-contract surface the inventory
 * movement core's `planIssue` consumes (the
 * quality/application/hold-gate import shape — a function on the
 * ambient tenant scope, zero DI ceremony, zero module coupling; never
 * an InventoryModule→TradeModule import beyond this plain function).
 *
 *   THE BOND LEDGER (the declared interpretation #7, recorded here at
 *   the claim site): the bonded_warehouse_moves register IS the bond
 *   ledger — an EXECUTED IN_BOND move's lines into a warehouse
 *   register the duty-suspended quantities AT that warehouse (the
 *   goods entered the customs bond); an EXECUTED RELEASE move's lines
 *   from the warehouse release them (the duty recognized at BR-107's
 *   act). The suspended quantity of an item at a warehouse =
 *   Σ(executed IN_BOND lines into the warehouse for the item) −
 *   Σ(executed RELEASE lines from the warehouse for the item) — the
 *   ledger's own arithmetic, never a parallel stock dimension (the
 *   stock ledger carries NO duty dimension by design; the bond is the
 *   trade module's own register).
 *
 *   THE BLOCK (D-08's own wording: «the duty-suspended stock is
 *   BLOCKED from customer issue while suspended through THE SHARED
 *   GATE PATTERN — a second blocking validation wired INSIDE the
 *   movement core's planIssue, at the INV-035 gate's own choke point;
 *   every issue/ship path passes it BY CONSTRUCTION»): a position
 *   whose suspended pool is POSITIVE refuses every issue plan at that
 *   position — the coarse structural law (the declared interpretation
 *   #9, recorded here at the claim site: the per-unit duty state is
 *   deliberately NOT modeled — the position is suspended WHILE its
 *   pool is positive; the tenant releases the bond to free the
 *   position, and the flip-and-restore at release is the gate's own
 *   proof shape). The reservations law rides the block: NO new
 *   invariant identifier is minted (the restriction is G-66's own
 *   reserved wording's structural face — the typed refusal
 *   BONDED_STOCK_SUSPENDED names the stock + the bond).
 *
 *   THE FLAG BOUNDARY (the hold gate's own reading): the gate is
 *   silent when the trade plane's entitlement is OFF (a pre-051
 *   tenant's positions carry no bond ledger — the bond register lives
 *   on the trade plane; the ordinary issues behave exactly as before).
 *
 *   ZERO LEDGER EFFECT: the gate only REFUSES and READS — it posts
 *   nothing, stamps nothing (the reservations G-64…G-66 · INV-036 ·
 *   BR-105…BR-108 — لا كتابة خارجها).
 */

/** The trade plane's whole-module entitlement probe (the customs
 * landed-cost floor's own shape). */
async function tenantHasTradePlane(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the bonded gate requires an ambient tenant scope");
  }
  const tx: TenantDb = context.tx;
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'trade'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

/** The bond ledger's own read: the item's duty-suspended quantity at
 * the warehouse (the ledger's arithmetic: + Σ executed IN_BOND lines
 * INTO the warehouse (the goods entered the bond there — the initial
 * deposit's from is NULL) − Σ executed IN_BOND lines OUT of it (a
 * within-bond transfer to another bond) − Σ executed RELEASE lines out
 * of it (BR-107's act); clamped at zero — a free warehouse's from-leg
 * never drives the pool negative). */
export async function suspendedQtyAt(itemId: string, warehouseId: string): Promise<string> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the bonded gate requires an ambient tenant scope");
  }
  const tx: TenantDb = context.tx;
  const rows = await tx.execute<{ suspended: string }>(sql`
    WITH ledger AS (
      SELECT (line->>'qty')::numeric(19,6) AS qty, m.move_kind AS kind,
             m.to_warehouse_id AS to_wh, m.from_warehouse_id AS from_wh
      FROM bonded_warehouse_moves m, jsonb_array_elements(m.lines) AS line
      WHERE m.tenant_id = erp.current_tenant_id()
        AND m.status = 'EXECUTED'
        AND line->>'itemId' = ${itemId}
        AND (m.to_warehouse_id = ${warehouseId} OR m.from_warehouse_id = ${warehouseId})
    )
    SELECT GREATEST(
      COALESCE((SELECT SUM(qty) FROM ledger WHERE kind = 'IN_BOND' AND to_wh = ${warehouseId}), 0)
      - COALESCE((SELECT SUM(qty) FROM ledger WHERE kind = 'IN_BOND' AND from_wh = ${warehouseId}), 0)
      - COALESCE((SELECT SUM(qty) FROM ledger WHERE kind = 'RELEASE' AND from_wh = ${warehouseId}), 0),
      0)::text AS suspended
  `);
  return rows.rows[0]!.suspended;
}

/**
 * THE GATE (the planIssue act's second blocking validation — D-08):
 * throws BondedStockSuspendedError (the typed 409 naming the stock +
 * the bond + the figures) when the item's position at the warehouse
 * carries a positive duty-suspended pool; returns silently otherwise.
 * The bonded module's own paths (the in-bond transfer, the release)
 * are the typed callers that legitimately move suspended stock — they
 * carry the movement core's `allowBondedStock` bypass (the beneficiary
 * discipline, never a silent bypass).
 */
export async function assertNoBondedSuspension(input: {
  itemId: string;
  warehouseId: string;
  onHand?: string;
}): Promise<void> {
  if (!(await tenantHasTradePlane())) {
    return; // the flag OFF = the gate silent (the pre-051 behavior)
  }
  const suspended = await suspendedQtyAt(input.itemId, input.warehouseId);
  if (Number(suspended) > 0) {
    throw new BondedStockSuspendedError({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      suspendedQty: suspended,
      onHand: input.onHand ?? "unknown",
    });
  }
}
