import { sql } from "drizzle-orm";

import { type TenantDb, requireTenantContext } from "../../../infra/db/tenant-context";

import {
  DeclarationIncompleteError,
  DeclarationLineTieInvalidError,
  DeclarationRequiredError,
} from "../domain/trade-errors";
import { listDeclarationLines } from "./trade.store";

/**
 * PHASE-051 (W-37 — T-10, 2026-11-25) THE SHARED CUSTOMS LANDED-COST
 * FLOOR (INV-036 — D-07's own wording, the honest interpretation): the
 * plain documented-contract surface the purchasing LandedCostService's
 * post act consumes (the trade-order-gate import shape — a function on
 * the ambient tenant scope, zero DI ceremony, zero module coupling;
 * never a PurchasingModule→TradeModule import).
 *
 *   THE FLOOR (INV-036 — declaration completeness): a customs-duty
 *   landed-cost allocation on an import receipt REQUIRES a COMPLETED
 *   declaration reference — the typed refusals
 *   DECLARATION_REQUIRED (no declaration references this receipt) /
 *   DECLARATION_INCOMPLETE (the resolved declaration's own state) name
 *   the receipt + the declaration's own state, with ZERO residue (the
 *   refused allocation stays a draft, nothing posts — the caller's own
 *   law). Ordinary NON-DUTY landed costs (freight/insurance/other) on
 *   domestic receipts stand untouched — the existing behavior, never
 *   restated narrower (D-07's own boundary).
 *
 *   THE FLAG BOUNDARY (the trade-order-gate's own reading, the
 *   declared neutral zero): with the `trade` flag OFF there is no trade
 *   plane and no floor — a pre-051 customs-kind landed cost behaves
 *   exactly as before (the gate is silent, the ordinary allocation
 *   proceeds; INV-036's reservations wording rides the trade plane
 *   where the declarations exist).
 *
 *   THE LINE-LEVEL TIE (D-06 — «every allocated duty tied to its
 *   declaration line (the line-level linkage recorded on the
 *   allocation — INV-036's own demand)»): the resolved completed
 *   declaration's OWN lines joined to the receipt's stock lines by
 *   ITEM — the one-line-per-item exactness laws (the declared
 *   interpretation #5, recorded here at the claim site): every
 *   declaration line ITEM-BEARING (a line without an item cannot tie
 *   its duty to the receipt's stock); every item declared EXACTLY ONCE
 *   (an ambiguous tie is refused — the tie is a function, never a
 *   relation); every GRN stock line's item declared (a stock line
 *   without its declaration line would allocate duty that ties to
 *   nothing — INV-036's own demand). The tie map rides the floor's
 *   return — the LandedCostService's post writes each allocation row's
 *   declaration_line_id from it (the documented contract, never a
 *   cross-module read).
 *
 *   ZERO LEDGER EFFECT: the gate only REFUSES and RESOLVES — it posts
 *   nothing, stamps nothing (the floor is the allocation's own law;
 *   the reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا كتابة
 *   خارجها).
 */

/** The trade plane's whole-module entitlement probe (the order gate's
 * own shape — the sweep job's gate). */
async function tenantHasTradePlane(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the customs landed-cost floor requires an ambient tenant scope");
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

/** The floor's resolution — the completed declaration + the line-level
 * tie map (the allocation rows' declaration_line_id source). */
export interface CustomsLandedCostFloor {
  declarationId: string;
  declarationNo: string;
  /** The line-level tie: GRN stock line id → the declaration line id
   * of its item (D-06's own demand; every GRN stock line carries its
   * tie — the coverage law). */
  declarationLineByGrnLine: ReadonlyMap<string, string>;
}

/**
 * THE FLOOR (the LandedCostService post act's arm): resolves the
 * completed declaration for a customs-kind allocation on the given
 * receipt — null when the floor is silent (a non-customs cost type, or
 * the trade flag OFF); the typed refusals otherwise. The caller passes
 * the landed cost's own declaration source (the completion act's
 * linkage) or null (an ordinary customs landed cost — resolved by the
 * receipt's own declarations), and the receipt's OWN stock lines (the
 * allocation basis — the purchasing store's own read, passed through
 * the documented contract; never a cross-module read here).
 */
export async function resolveCustomsLandedCostFloor(input: {
  grnId: string;
  declarationId: string | null;
  costType: string;
  grnStockLines: readonly { grnLineId: string; itemId: string }[];
}): Promise<CustomsLandedCostFloor | null> {
  if (input.costType !== "customs") {
    return null; // the non-duty landed costs stand untouched (D-07)
  }
  if (!(await tenantHasTradePlane())) {
    return null; // the flag OFF = the floor silent (the pre-051 behavior)
  }
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the customs landed-cost floor requires an ambient tenant scope");
  }
  const tx: TenantDb = context.tx;

  // THE DECLARATION RESOLUTION: the landed cost's own source first (the
  // completion act's linkage — validated BY STATE), else the receipt's
  // own declarations (a COMPLETED one satisfies the floor; an
  // incomplete-only set refuses with the declaration's own state).
  type DeclarationProbe = { id: string; declarationNo: string; status: string };
  let resolved: DeclarationProbe | undefined;
  if (input.declarationId !== null) {
    const rows = await tx.execute(sql`
      SELECT id, declaration_no AS "declarationNo", status FROM customs_declarations
      WHERE id = ${input.declarationId} LIMIT 1
    `);
    resolved = (rows.rows as unknown as DeclarationProbe[])[0];
    if (resolved === undefined) {
      // The linked declaration vanished (RLS or deletion) — the
      // completeness floor's own 404-class refusal.
      throw new DeclarationIncompleteError({
        grnId: input.grnId,
        declarationId: input.declarationId,
        declarationNo: input.declarationId,
        status: "not found in this tenant",
      });
    }
  } else {
    const rows = await tx.execute(sql`
      SELECT id, declaration_no AS "declarationNo", status FROM customs_declarations
      WHERE receipt_id = ${input.grnId}
      ORDER BY (status = 'COMPLETED') DESC, created_at DESC
      LIMIT 1
    `);
    resolved = (rows.rows as unknown as DeclarationProbe[])[0];
    if (resolved === undefined) {
      throw new DeclarationRequiredError({ grnId: input.grnId, costType: input.costType });
    }
  }
  if (resolved.status !== "COMPLETED") {
    throw new DeclarationIncompleteError({
      grnId: input.grnId,
      declarationId: resolved.id,
      declarationNo: resolved.declarationNo,
      status: resolved.status,
    });
  }

  // THE LINE-LEVEL TIE (the one-line-per-item exactness laws — the
  // declared interpretation #5): the declaration's own lines joined to
  // the GRN's stock lines by item.
  const lines = await listDeclarationLines(resolved.id);
  const declaredByItem = new Map<string, string>();
  for (const line of lines) {
    if (line.itemId === null) {
      throw new DeclarationLineTieInvalidError({
        declarationNo: resolved.declarationNo,
        reason: `line ${line.lineNo} (HS ${line.hsCode}) carries no item — the G-65 tie demands every declaration line item-bearing (a line without an item cannot tie its duty to the receipt's stock)`,
      });
    }
    const existing = declaredByItem.get(line.itemId);
    if (existing !== undefined) {
      throw new DeclarationLineTieInvalidError({
        declarationNo: resolved.declarationNo,
        reason: `item ${line.itemId} is declared on both line ${existing} and line ${line.lineNo} — the tie is a function, never a relation (one declaration line per item)`,
      });
    }
    declaredByItem.set(line.itemId, line.id);
  }
  if (declaredByItem.size === 0) {
    throw new DeclarationLineTieInvalidError({
      declarationNo: resolved.declarationNo,
      reason: "the declaration carries no lines — the G-65 tie has nothing to allocate",
    });
  }
  // The coverage law: every GRN stock line's item declared (the stock
  // lines are the allocation basis — the purchasing store's own read
  // stays in purchasing; the GRN lines arrive as the caller's input).
  const tie = new Map<string, string>();
  for (const grnLine of input.grnStockLines) {
    const declarationLineId = declaredByItem.get(grnLine.itemId);
    if (declarationLineId === undefined) {
      throw new DeclarationLineTieInvalidError({
        declarationNo: resolved.declarationNo,
        reason: `goods receipt line ${grnLine.grnLineId}'s item ${grnLine.itemId} is not declared on this declaration — every allocated duty must tie to its declaration line (INV-036's own demand; declare the item's line or split the receipt)`,
      });
    }
    tie.set(grnLine.grnLineId, declarationLineId);
  }
  return {
    declarationId: resolved.id,
    declarationNo: resolved.declarationNo,
    declarationLineByGrnLine: tie,
  };
}
