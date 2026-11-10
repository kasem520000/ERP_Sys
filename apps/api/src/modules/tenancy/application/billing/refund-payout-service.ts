import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../../infra/db/client";
import { requireTenantContext, withTenant } from "../../../../infra/db/tenant-context";
import { listActiveTenantIds } from "../../../../infra/jobs/system-tenants";
import { childLogger } from "../../../../infra/observability/logger";
import { AuditService } from "../../../audit/api/audit";
import { DrizzleAuditStore } from "../../../audit/infrastructure/drizzle-audit.store";
import type { ProviderAdapterPort } from "./provider-adapter";

/**
 * PHASE-023 T6 — refund flow + payout/fee reconciliation (phase §2 item 7;
 * DR-002 OPEN ⇒ sandbox depth): completes PHASE-014's sandbox adapter with
 * the provider-side refund call and the payout-batch reconciliation job.
 *
 * HONESTY NOTES (the completion report's INCOMPLETE pointer):
 * - The production provider cutover does NOT ship — DR-002 is OPEN; the
 *   chosen provider's adapter goes live in a follow-up release with
 *   production credentials (S-09), its real webhook shape, and its fee
 *   schedule. Nothing here claims production payment operation.
 * - Refunds record a `payment.refunded` billing event + the provider
 *   refund reference (the auditable trail); the invoice row stays PAID —
 *   history is append-only, and re-charging/void semantics belong to the
 *   real provider's flow (the sandbox does not invent them).
 * - Payout reconciliation compares the PROVIDER-REPORTED batch against the
 *   platform-computed settlements for the same window; drift is REPORTED
 *   (status DRIFT + detail), never auto-corrected.
 */

const log = childLogger({ module: "billing-payouts" });

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("billing payout access requires an ambient tenant scope");
  }
  return context.tx;
}

export class RefundPayoutError extends DomainError {
  constructor(reason: string, details?: Readonly<Record<string, unknown>>) {
    super("billing/refund-payout", reason, details);
  }
}

export interface PayoutRow {
  readonly id: string;
  readonly providerId: string;
  readonly providerRef: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly grossAmount: string;
  readonly feeAmount: string;
  readonly netAmount: string;
  readonly currencyCode: string;
  readonly status: "PENDING" | "RECONCILED" | "DRIFT";
  readonly settledPaymentCount: number | null;
  readonly driftDetail: Record<string, unknown> | null;
}

const PAYOUT_COLUMNS = sql`id, provider_id AS "providerId", provider_ref AS "providerRef",
  period_start::text AS "periodStart", period_end::text AS "periodEnd",
  gross_amount::text AS "grossAmount", fee_amount::text AS "feeAmount", net_amount::text AS "netAmount",
  currency_code AS "currencyCode", status, settled_payment_count AS "settledPaymentCount",
  drift_detail AS "driftDetail"`;

/**
 * The refund flow (T6): call the provider's refund, record the billing
 * event + audit trail. Requires a PAID invoice with a provider reference
 * (manual payments have no provider refund — their reversal is the manual
 * bookkeeping flow, out of scope here).
 */
export async function refundSettledPayment(input: {
  provider: ProviderAdapterPort;
  invoiceNumber: string;
  amount: string;
  actorId: string | null;
}): Promise<{ refundRef: string }> {
  const tx = tenantTx();
  const rows = (await tx.execute(sql`
    SELECT id, number, status, paid_via AS "paidVia", provider_ref AS "providerRef",
      amount::text AS "amount", currency_code AS "currencyCode"
    FROM subscription_invoices WHERE number = ${input.invoiceNumber} LIMIT 1
  `)).rows as unknown as {
    id: string;
    number: string;
    status: string;
    paidVia: string | null;
    providerRef: string | null;
    amount: string;
    currencyCode: string;
  }[];
  const invoice = rows[0];
  if (invoice === undefined) {
    throw new RefundPayoutError(`invoice ${input.invoiceNumber} not found`);
  }
  if (invoice.status !== "PAID" || invoice.paidVia !== "provider_webhook" || invoice.providerRef === null) {
    throw new RefundPayoutError(
      `invoice ${input.invoiceNumber} is not a provider-settled payment (status ${invoice.status}, via ${invoice.paidVia ?? "none"})`,
    );
  }
  if (Number(input.amount) <= 0 || Number(input.amount) > Number(invoice.amount)) {
    throw new RefundPayoutError(`refund amount must be within (0, ${invoice.amount}]`);
  }
  const refund = await input.provider.refund({
    providerRef: invoice.providerRef,
    amount: input.amount,
    currency: invoice.currencyCode,
  });
  await tx.execute(sql`
    INSERT INTO billing_events (id, tenant_id, type, idempotency_key, payload, actor_id)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'payment.refunded',
      ${`refund:${refund.refundRef}`},
      ${JSON.stringify({
        invoice: invoice.number,
        providerRef: invoice.providerRef,
        refundRef: refund.refundRef,
        amount: input.amount,
        currency: invoice.currencyCode,
      })}::jsonb, ${input.actorId})
    ON CONFLICT DO NOTHING
  `);
  const audit = new AuditService(new DrizzleAuditStore());
  await audit.record({
    action: "billing.payment_refunded",
    entityType: "subscription_invoice",
    entityId: invoice.id,
    actorId: input.actorId ?? undefined,
    after: { refundRef: refund.refundRef, amount: input.amount, provider: input.provider.id },
  });
  return { refundRef: refund.refundRef };
}

/**
 * Pull + persist the provider's payout batches for a window (T6): rows are
 * upserted by (provider, provider_ref) — re-pulling the window is
 * idempotent; RECONCILED rows never regress to PENDING.
 */
export async function syncPayouts(input: {
  provider: ProviderAdapterPort;
  periodStart: string;
  periodEnd: string;
}): Promise<{ payouts: PayoutRow[]; inserted: number }> {
  const tx = tenantTx();
  const providerPayouts = await input.provider.listPayouts({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
  });
  let inserted = 0;
  const payouts: PayoutRow[] = [];
  for (const payout of providerPayouts) {
    const result = await tx.execute(sql`
      INSERT INTO billing_payouts (id, tenant_id, created_by, provider_id, provider_ref,
        period_start, period_end, gross_amount, fee_amount, net_amount, currency_code,
        status, settled_payment_count, raw)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), NULL, ${input.provider.id},
        ${payout.providerRef}, ${payout.periodStart}, ${payout.periodEnd},
        ${payout.grossAmount}, ${payout.feeAmount}, ${payout.netAmount}, ${payout.currencyCode},
        'PENDING', ${payout.settledPaymentRefs.length}, ${JSON.stringify(payout)}::jsonb)
      ON CONFLICT ("provider_id", "provider_ref") DO NOTHING
      RETURNING ${PAYOUT_COLUMNS}
    `);
    if (result.rows.length > 0) {
      inserted += 1;
      payouts.push((result.rows as unknown as PayoutRow[])[0]!);
    } else {
      const existing = (await tx.execute(sql`
        SELECT ${PAYOUT_COLUMNS} FROM billing_payouts
        WHERE provider_id = ${input.provider.id} AND provider_ref = ${payout.providerRef}
      `)).rows as unknown as PayoutRow[];
      if (existing[0] !== undefined) payouts.push(existing[0]);
    }
  }
  return { payouts, inserted };
}

/**
 * The reconciliation pass (T6): for each PENDING payout, compare the
 * provider-reported batch against the platform's settled provider payments
 * in the same window — matches flip RECONCILED (with the settled count);
 * mismatches flip DRIFT with the detail (reported vs computed). Drift is
 * NEVER auto-corrected — finance investigates with the detail.
 */
export async function reconcilePayouts(): Promise<{
  checked: number;
  reconciled: number;
  drifted: number;
}> {
  const tx = tenantTx();
  const pending = (await tx.execute(sql`
    SELECT ${PAYOUT_COLUMNS} FROM billing_payouts WHERE status = 'PENDING'
  `)).rows as unknown as PayoutRow[];
  let reconciled = 0;
  let drifted = 0;
  for (const payout of pending) {
    const computed = (await tx.execute(sql`
      SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::text AS gross
      FROM subscription_invoices
      WHERE status = 'PAID' AND paid_via = 'provider_webhook'
        AND paid_at::date BETWEEN ${payout.periodStart}::date AND ${payout.periodEnd}::date
        AND currency_code = ${payout.currencyCode}
    `)).rows as unknown as { n: number; gross: string }[];
    const settledCount = computed[0]?.n ?? 0;
    const computedGross = computed[0]?.gross ?? "0";
    const matches =
      settledCount === (payout.settledPaymentCount ?? -1) &&
      Math.abs(Number(computedGross) - Number(payout.grossAmount)) < 0.00005;
    if (matches) {
      await tx.execute(sql`
        UPDATE billing_payouts SET status = 'RECONCILED', reconciled_at = now(),
          updated_at = now(), version = version + 1 WHERE id = ${payout.id}
      `);
      reconciled += 1;
    } else {
      await tx.execute(sql`
        UPDATE billing_payouts SET status = 'DRIFT',
          drift_detail = ${JSON.stringify({
            reported: { count: payout.settledPaymentCount, gross: payout.grossAmount },
            computed: { count: settledCount, gross: computedGross },
          })}::jsonb,
          updated_at = now(), version = version + 1 WHERE id = ${payout.id}
      `);
      drifted += 1;
    }
  }
  return { checked: pending.length, reconciled, drifted };
}

/** The system-job body: one reconciliation pass per ACTIVE tenant. */
export async function runPayoutReconciliation(): Promise<
  { tenantId: string; outcome: { checked: number; reconciled: number; drifted: number } | { error: string } }[]
> {
  const results: { tenantId: string; outcome: { checked: number; reconciled: number; drifted: number } | { error: string } }[] = [];
  for (const tenantId of await listActiveTenantIds()) {
    try {
      const outcome = await withTenant(tenantId, () => reconcilePayouts());
      results.push({ tenantId, outcome });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.warn({ tenantId, err: message }, "payout reconciliation pass failed (isolated)");
      results.push({ tenantId, outcome: { error: message } });
    }
  }
  return results;
}

/** List payouts (the finance surface). */
export async function listPayouts(): Promise<PayoutRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${PAYOUT_COLUMNS} FROM billing_payouts ORDER BY period_end DESC LIMIT 200
  `);
  return rows.rows as unknown as PayoutRow[];
}

/** A webhook-storm helper (T6 verification): duplicate event ids dedupe. */
export function webhookDeliveryId(): string {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
