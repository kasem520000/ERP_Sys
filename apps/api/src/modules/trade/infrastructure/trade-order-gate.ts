import { sql } from "drizzle-orm";

import { type TenantDb, requireTenantContext } from "../../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  incotermMandateVerdict,
  type TradeDirection,
} from "../domain/incoterm-matrix";
import {
  IncotermInactiveError,
  IncotermRecordNotFoundError,
  OrderIncotermRequiredError,
} from "../domain/trade-errors";
import { findIncotermByCode } from "./trade.store";

/**
 * PHASE-051 (W-35 — T-08, 2026-11-25) THE SHARED ORDER GATE (BR-106's
 * mandate at the order's OWN posting — D-10's own wording): the plain
 * documented-contract surface the purchasing and sales issue acts
 * consume (the treasury-store/ownTenantBaseCurrency import shape — a
 * function on the ambient tenant scope, zero DI ceremony, zero module
 * coupling; never a PurchasingModule→TradeModule import).
 *
 *   THE MANDATE (BR-106 — the owner's ruling (ج) at the approval
 *   dispatch, carried VERBATIM): with the `trade` flag enabled, an
 *   order whose currency differs from the tenant's base currency OR
 *   that carries the explicit import/export marker must post WITH an
 *   incoterm — THE TYPED REFUSAL AT THE ORDER'S OWN POSTING naming
 *   the order + the missing field. The flag is the entitlement probe
 *   (the trade plane's whole-module composable unit — 0122 §5c; the
 *   sweep job's own gate shape); the trigger is the PURE fold's
 *   verdict (incotermMandateVerdict — zero parallel computation); the
 *   refusal is the typed OrderIncotermRequiredError with the fold's
 *   arms rendered VERBATIM.
 *
 *   THE SELECTION FLOOR (the create-act arm): a PROVIDED code must
 *   exist and be ACTIVE in the tenant's registry (the typed refusals
 *   name the code — unknown / retired); a null selection passes
 *   create (the mandate fires at posting, never at create — D-10's
 *   own boundary). The registry's later retirement never rewrites a
 *   posted order (the snapshot semantics: the order froze its choice
 *   at create; the ISSUE gate checks PRESENCE, the registry's
 *   activeness is the CREATE gate — the declared interpretation,
 *   recorded here at the claim site).
 *
 *   ZERO LEDGER EFFECT: the gate only REFUSES — it posts nothing,
 *   stamps nothing, writes nothing (the mandate is a floor, not an
 *   act; the reservations G-64…G-66 · INV-036 · BR-105…BR-108 — لا
 *   كتابة خارجها).
 */

/** The trade plane's whole-module entitlement probe (the sweep job's
 * own gate shape — business + enterprise carry it; the three
 * trade-carrying industry templates compose it by default; starter
 * stays at the declared neutral zero). */
async function tenantHasTradePlane(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the order gate requires an ambient tenant scope");
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

/**
 * THE SELECTION FLOOR (the PO/SO create acts' arm): a provided code
 * must exist and be ACTIVE (the selector's own floor, the typed
 * refusals naming the code); a null selection passes — the mandate
 * fires at the order's own posting, never at create.
 */
export async function assertIncotermSelection(incotermCode: string | null): Promise<void> {
  if (incotermCode === null || incotermCode === "") {
    return;
  }
  const row = await findIncotermByCode(incotermCode.trim().toUpperCase());
  if (row === undefined) {
    throw new IncotermRecordNotFoundError({ code: incotermCode.trim().toUpperCase() });
  }
  if (!row.isActive) {
    throw new IncotermInactiveError({ code: row.code });
  }
}

/**
 * THE MANDATE GATE (the PO/SO issue acts' arm — BR-106 at the order's
 * own posting): with the trade flag enabled, a triggered order (the
 * currency arm OR the marker arm) must carry its incoterm — the typed
 * refusal names the order and the missing field with the trigger's
 * arms. The flag OFF means NO trade plane and NO mandate (the
 * declared neutral zero's own reading — a starter tenant's
 * foreign-currency order posts untouched).
 */
export async function assertTradeIncotermMandate(input: {
  docType: "purchase_order" | "sales_order";
  orderId: string;
  orderNo: string | null;
  currencyCode: string;
  tradeDirection: TradeDirection | null;
  incotermCode: string | null;
}): Promise<void> {
  if (!(await tenantHasTradePlane())) {
    return;
  }
  const base = await ownTenantBaseCurrency();
  const verdict = incotermMandateVerdict({
    currency: input.currencyCode,
    baseCurrency: base,
    tradeDirection: input.tradeDirection,
  });
  if (!verdict.triggered) {
    return;
  }
  if (input.incotermCode !== null && input.incotermCode !== "") {
    // PRESENCE satisfied — the code's registry existence was the
    // create-act's floor (the snapshot semantics above).
    return;
  }
  throw new OrderIncotermRequiredError({
    docType: input.docType,
    orderId: input.orderId,
    orderNo: input.orderNo,
    currency: input.currencyCode,
    baseCurrency: base,
    tradeDirection: input.tradeDirection,
    arms: verdict.arms,
  });
}
