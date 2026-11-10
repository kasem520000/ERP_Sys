import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { getDb, type TenantDb } from "../../../infra/db/client";
import { requireTenantContext, ambientAnyTx } from "../../../infra/db/tenant-context";

/**
 * PHASE-014 billing data access (PHASE-014 §4/§5 T1–T6): pure storage for
 * the subscription lifecycle, the billing history (both payment paths
 * write the same tables — A-009), the append-only billing event trail
 * (webhook idempotency = replay protection, INV-013 discipline), and the
 * usage read model. No business rules here — the application services own
 * those. Access planes mirror tenancy.store:
 * - TENANT-owned rows run inside the ambient tenant transaction
 *   (withTenant / withTenantOnTx);
 * - GLOBAL `plans` reads resolve the ambient scope (tenant or platform)
 *   or fall back to the app pool (no RLS by design);
 * - the pre-GUC projections (migration 0021 definer functions) serve the
 *   read-only interceptor + usage-limit guard before any UoW exists.
 */

const db = () => getDb();

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("billing access requires an ambient tenant scope");
  }
  return context.tx;
}

// ---------------------------------------------------------------------------
// plans (global; marketing surface columns included)

export interface BillingPlanRow {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  priceAmount: string;
  annualPriceAmount: string;
  currencyCode: string;
  billingPeriod: string;
  limits: Record<string, unknown>;
  featureKeys: string[];
  isActive: boolean;
  positioning: { ar: string; en: string } | null;
  highlight: boolean;
  sortOrder: number;
}

const PLAN_COLUMNS = sql`id, key, name, name_ar AS "nameAr",
  price_amount AS "priceAmount", annual_price_amount AS "annualPriceAmount",
  currency_code AS "currencyCode", billing_period AS "billingPeriod",
  limits::jsonb AS "limits", feature_keys AS "featureKeys", is_active AS "isActive",
  positioning::jsonb AS "positioning", highlight, sort_order AS "sortOrder"`;

export async function listPublicPlans(): Promise<BillingPlanRow[]> {
  const handle = ambientAnyTx() ?? db();
  const rows = await handle.execute(sql`
    SELECT ${PLAN_COLUMNS} FROM plans
    WHERE is_active AND key IN ('starter', 'business', 'enterprise')
    ORDER BY sort_order, key
  `);
  return rows.rows as unknown as BillingPlanRow[];
}

export async function findBillingPlanByKey(key: string): Promise<BillingPlanRow | undefined> {
  const handle = ambientAnyTx() ?? db();
  const rows = await handle.execute(sql`
    SELECT ${PLAN_COLUMNS} FROM plans
    WHERE is_active AND key = ${key} LIMIT 1
  `);
  return (rows.rows as unknown as BillingPlanRow[])[0];
}

export async function findBillingPlanById(id: string): Promise<BillingPlanRow | undefined> {
  const handle = ambientAnyTx() ?? db();
  const rows = await handle.execute(sql`
    SELECT ${PLAN_COLUMNS} FROM plans WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BillingPlanRow[])[0];
}

// ---------------------------------------------------------------------------
// subscriptions (tenant plane; lifecycle columns live)

export interface SubscriptionRow {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  provider: string | null;
  providerRef: string | null;
  providerCheckoutRef: string | null;
  providerSubscriptionRef: string | null;
  providerCustomerRef: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  dunningStep: number;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: string | null;
  journeyCompletedAt: string | null;
}

const SUBSCRIPTION_COLUMNS = sql`id, tenant_id AS "tenantId", plan_id AS "planId", status,
  period_start AS "periodStart", period_end AS "periodEnd",
  provider, provider_ref AS "providerRef",
  provider_checkout_ref AS "providerCheckoutRef",
  provider_subscription_ref AS "providerSubscriptionRef",
  provider_customer_ref AS "providerCustomerRef",
  trial_ends_at AS "trialEndsAt", grace_ends_at AS "graceEndsAt",
  dunning_step AS "dunningStep", cancel_at_period_end AS "cancelAtPeriodEnd",
  pending_plan_id AS "pendingPlanId", journey_completed_at AS "journeyCompletedAt"`;

export async function currentSubscriptionRow(): Promise<SubscriptionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE status <> 'CANCELLED'
    ORDER BY created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0];
}

export async function findSubscriptionRowById(id: string): Promise<SubscriptionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
    WHERE id = ${id} AND status <> 'CANCELLED' LIMIT 1
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0];
}

export interface InsertSubscriptionInput {
  planId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "GRACE_READ_ONLY" | "SUSPENDED";
  periodStart: string;
  periodEnd: string;
  provider?: string | null;
  providerRef?: string | null;
  providerCheckoutRef?: string | null;
  providerSubscriptionRef?: string | null;
  providerCustomerRef?: string | null;
  trialEndsAt?: string | null;
  graceEndsAt?: string | null;
  dunningStep?: number;
  pendingPlanId?: string | null;
}

export async function insertSubscriptionRow(
  input: InsertSubscriptionInput,
): Promise<SubscriptionRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO subscriptions (
      id, tenant_id, plan_id, status, period_start, period_end,
      provider, provider_ref, provider_checkout_ref, provider_subscription_ref,
      provider_customer_ref, trial_ends_at, grace_ends_at, dunning_step,
      pending_plan_id
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.planId},
      ${input.status}, ${input.periodStart}, ${input.periodEnd},
      ${input.provider ?? null}, ${input.providerRef ?? null},
      ${input.providerCheckoutRef ?? null}, ${input.providerSubscriptionRef ?? null},
      ${input.providerCustomerRef ?? null}, ${input.trialEndsAt ?? null},
      ${input.graceEndsAt ?? null}, ${input.dunningStep ?? 0}, ${input.pendingPlanId ?? null}
    ) RETURNING ${SUBSCRIPTION_COLUMNS}
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0]!;
}

export interface SubscriptionPatch {
  status?: "TRIAL" | "ACTIVE" | "PAST_DUE" | "GRACE_READ_ONLY" | "SUSPENDED" | "CANCELLED";
  graceEndsAt?: string | null;
  dunningStep?: number;
  pendingPlanId?: string | null;
  cancelAtPeriodEnd?: boolean;
  provider?: string | null;
  providerCheckoutRef?: string | null;
  providerSubscriptionRef?: string | null;
  providerCustomerRef?: string | null;
  journeyCompletedAt?: string | null;
}

export async function updateSubscriptionRow(
  id: string,
  patch: SubscriptionPatch,
): Promise<SubscriptionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    UPDATE subscriptions SET
      status = COALESCE(${patch.status ?? null}, status),
      grace_ends_at = COALESCE(${patch.graceEndsAt ?? null}, grace_ends_at),
      dunning_step = COALESCE(${patch.dunningStep ?? null}, dunning_step),
      pending_plan_id = COALESCE(${patch.pendingPlanId ?? null}, pending_plan_id),
      cancel_at_period_end = COALESCE(${patch.cancelAtPeriodEnd ?? null}, cancel_at_period_end),
      provider = COALESCE(${patch.provider ?? null}, provider),
      provider_checkout_ref = COALESCE(${patch.providerCheckoutRef ?? null}, provider_checkout_ref),
      provider_subscription_ref = COALESCE(${patch.providerSubscriptionRef ?? null}, provider_subscription_ref),
      provider_customer_ref = COALESCE(${patch.providerCustomerRef ?? null}, provider_customer_ref),
      journey_completed_at = COALESCE(${patch.journeyCompletedAt ?? null}, journey_completed_at),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING ${SUBSCRIPTION_COLUMNS}
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0];
}

/** Downgrade-at-period-end bookkeeping (SUBSCRIPTION §8 row). */
export async function setPendingDowngrade(
  id: string,
  pendingPlanId: string,
): Promise<SubscriptionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    UPDATE subscriptions SET
      pending_plan_id = ${pendingPlanId}, cancel_at_period_end = true,
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING ${SUBSCRIPTION_COLUMNS}
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0];
}

export interface SubscriptionAttentionRow {
  tenantId: string;
  subscriptionId: string;
  planId: string;
  status: string;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  dunningStep: number;
  periodEnd: string;
  pendingPlanId: string | null;
  cancelAtPeriodEnd: boolean;
}

/** The daily-pass worklist (definer projection; any scope). */
export async function platformListSubscriptionsNeedingAttention(): Promise<
  ReadonlyArray<SubscriptionAttentionRow>
> {
  const rows = await db().execute(
    sql`SELECT tenant_id AS "tenantId", subscription_id AS "subscriptionId",
               plan_id AS "planId", status, trial_ends_at AS "trialEndsAt",
               grace_ends_at AS "graceEndsAt", dunning_step AS "dunningStep",
               period_end AS "periodEnd", pending_plan_id AS "pendingPlanId",
               cancel_at_period_end AS "cancelAtPeriodEnd"
        FROM erp.subscriptions_needing_attention()`,
  );
  return rows.rows as unknown as SubscriptionAttentionRow[];
}

export interface InvoiceByRefProjection {
  tenantId: string;
  id: string;
  number: string;
  status: string;
  amount: string;
  currencyCode: string;
  planKey: string;
  periodStart: string;
  periodEnd: string;
  source: string;
  dueDate: string;
  paidVia: string | null;
  providerRef: string | null;
}

/** Anonymous webhook target resolution (definer projection; no scope). */
export async function findInvoiceByProviderRefPlatform(
  providerRef: string,
): Promise<InvoiceByRefProjection | undefined> {
  const rows = await db().execute(
    sql`SELECT tenant_id AS "tenantId", id, number, status, amount,
               currency_code AS "currencyCode", plan_key AS "planKey",
               period_start AS "periodStart", period_end AS "periodEnd",
               source, due_date AS "dueDate", paid_via AS "paidVia",
               provider_ref AS "providerRef"
        FROM erp.subscription_invoice_by_ref(${providerRef})`,
  );
  return (rows.rows as unknown as InvoiceByRefProjection[])[0];
}

// ---------------------------------------------------------------------------
// subscription invoices (billing history)

export interface SubscriptionInvoiceRow {
  id: string;
  tenantId: string;
  subscriptionId: string;
  number: string;
  planKey: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  currencyCode: string;
  status: "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE";
  source: "checkout" | "manual" | "trial_credit";
  providerRef: string | null;
  dueDate: string;
  paidAt: string | null;
  paidVia: "provider_webhook" | "manual_recorded" | null;
  paidReference: string | null;
  recordedBy: string | null;
  reason: string | null;
  placeholderPrice: boolean;
}

const INVOICE_COLUMNS = sql`id, tenant_id AS "tenantId", subscription_id AS "subscriptionId",
  number, plan_key AS "planKey", period_start AS "periodStart", period_end AS "periodEnd",
  amount, currency_code AS "currencyCode", status, source, provider_ref AS "providerRef",
  due_date AS "dueDate", paid_at AS "paidAt", paid_via AS "paidVia",
  paid_reference AS "paidReference", recorded_by AS "recordedBy", reason,
  placeholder_price AS "placeholderPrice"`;

export async function insertSubscriptionInvoice(input: {
  subscriptionId: string;
  number: string;
  planKey: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
  currencyCode: string;
  source: "checkout" | "manual" | "trial_credit";
  providerRef: string | null;
  dueDate: string;
  placeholderPrice: boolean;
}): Promise<SubscriptionInvoiceRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO subscription_invoices (
      id, tenant_id, subscription_id, number, plan_key, period_start, period_end,
      amount, currency_code, status, source, provider_ref, due_date, placeholder_price
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.subscriptionId}, ${input.number},
      ${input.planKey}, ${input.periodStart}, ${input.periodEnd}, ${input.amount},
      ${input.currencyCode}, 'OPEN', ${input.source}, ${input.providerRef},
      ${input.dueDate}, ${input.placeholderPrice}
    ) RETURNING ${INVOICE_COLUMNS}
  `);
  return (rows.rows as unknown as SubscriptionInvoiceRow[])[0]!;
}

export async function findInvoiceByProviderRef(providerRef: string): Promise<SubscriptionInvoiceRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${INVOICE_COLUMNS} FROM subscription_invoices
    WHERE provider_ref = ${providerRef} ORDER BY created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as SubscriptionInvoiceRow[])[0];
}

export async function findInvoiceById(id: string): Promise<SubscriptionInvoiceRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${INVOICE_COLUMNS} FROM subscription_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SubscriptionInvoiceRow[])[0];
}

export async function listInvoices(limit = 50): Promise<SubscriptionInvoiceRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${INVOICE_COLUMNS} FROM subscription_invoices
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  return rows.rows as unknown as SubscriptionInvoiceRow[];
}

export async function markInvoicePaid(input: {
  id: string;
  paidVia: "provider_webhook" | "manual_recorded";
  paidReference: string;
  recordedBy?: string | null;
  reason?: string | null;
}): Promise<SubscriptionInvoiceRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    UPDATE subscription_invoices SET
      status = 'PAID', paid_at = now(), paid_via = ${input.paidVia},
      paid_reference = ${input.paidReference},
      recorded_by = COALESCE(${input.recordedBy ?? null}, recorded_by),
      reason = COALESCE(${input.reason ?? null}, reason),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'OPEN'
    RETURNING ${INVOICE_COLUMNS}
  `);
  return (rows.rows as unknown as SubscriptionInvoiceRow[])[0];
}

/** Next invoice number per tenant (BI-{yyyy}-{seq:4}; numbering service pattern). */
export async function nextInvoiceNumber(): Promise<string> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT count(*)::int AS n FROM subscription_invoices
  `);
  const n = (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
  const year = new Date().toISOString().slice(0, 4);
  return `BI-${year}-${String(n + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// billing events (append-only trail + webhook idempotency)

export interface BillingEventRow {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  actorId: string | null;
  viaPlatformAdmin: boolean;
  createdAt: string;
}

const EVENT_COLUMNS = sql`id, tenant_id AS "tenantId", type, payload::jsonb AS "payload",
  idempotency_key AS "idempotencyKey", actor_id AS "actorId",
  via_platform_admin AS "viaPlatformAdmin", created_at AS "createdAt"`;

export interface RecordBillingEventInput {
  type: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  actorId?: string | null;
  viaPlatformAdmin?: boolean;
}

/**
 * Append one billing event. When `idempotencyKey` is set and the key
 * already exists, returns { inserted: false } WITHOUT raising — the
 * webhook duplicate-delivery contract (idempotent no-op, INV-013
 * discipline).
 */
export async function recordBillingEvent(
  input: RecordBillingEventInput,
): Promise<{ inserted: boolean; row?: BillingEventRow }> {
  const tx = tenantTx();
  if (input.idempotencyKey !== undefined && input.idempotencyKey !== null) {
    const existing = await tx.execute(sql`
      SELECT ${EVENT_COLUMNS} FROM billing_events WHERE idempotency_key = ${input.idempotencyKey} LIMIT 1
    `);
    const prior = (existing.rows as unknown as BillingEventRow[])[0];
    if (prior !== undefined) {
      return { inserted: false, row: prior };
    }
  }
  const rows = await tx.execute(sql`
    INSERT INTO billing_events (id, tenant_id, type, payload, idempotency_key, actor_id, via_platform_admin)
    VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.type},
      ${JSON.stringify(input.payload ?? {})}::jsonb,
      ${input.idempotencyKey ?? null}, ${input.actorId ?? null}, ${input.viaPlatformAdmin ?? false}
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING ${EVENT_COLUMNS}
  `);
  const row = (rows.rows as unknown as BillingEventRow[])[0];
  return row === undefined ? { inserted: false } : { inserted: true, row };
}

export async function listBillingEvents(limit = 50): Promise<BillingEventRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${EVENT_COLUMNS} FROM billing_events
    ORDER BY created_at DESC LIMIT ${limit}
  `);
  return rows.rows as unknown as BillingEventRow[];
}

// ---------------------------------------------------------------------------
// usage counters (§6 read model)

export interface UsageCounterRow {
  counterKey: string;
  period: string;
  value: number;
  updatedAt: string;
}

export async function upsertUsageCounter(input: {
  counterKey: string;
  period: string;
  value: number;
}): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO usage_counters (id, tenant_id, counter_key, period, value)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.counterKey}, ${input.period}, ${input.value})
    ON CONFLICT (tenant_id, counter_key, period) DO UPDATE
      SET value = EXCLUDED.value, updated_at = now(), version = usage_counters.version + 1
  `);
}

export async function readUsageCounter(counterKey: string, period: string): Promise<number> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT value FROM usage_counters
    WHERE counter_key = ${counterKey} AND period = ${period} LIMIT 1
  `);
  return (rows.rows as unknown as { value: number }[])[0]?.value ?? 0;
}

export async function listUsageCounters(): Promise<UsageCounterRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT counter_key AS "counterKey", period, value, updated_at AS "updatedAt"
    FROM usage_counters ORDER BY counter_key, period
  `);
  return rows.rows as unknown as UsageCounterRow[];
}

/** Durable document count for a period (the reconcile source of truth). */
export async function countJournalEntriesForPeriod(period: string): Promise<number> {
  const tx = tenantTx();
  const monthStart = `${period}-01`;
  const rows = await tx.execute(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE posted_at IS NOT NULL
      AND posted_at >= ${`${monthStart} 00:00:00`}::timestamptz
      AND posted_at < (${`${monthStart} 00:00:00`}::timestamptz + interval '1 month')
  `);
  return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
}

// ---------------------------------------------------------------------------
// pre-GUC projections (migration 0021 definer functions; guard input)

export interface SubscriptionStateProjection {
  id: string;
  status: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  dunningStep: number;
  cancelAtPeriodEnd: boolean;
  pendingPlanId: string | null;
}

export async function subscriptionStateProjection(
  tenantId: string,
): Promise<SubscriptionStateProjection | undefined> {
  const rows = await db().execute(
    sql`SELECT id, status, plan_id AS "planId", period_start AS "periodStart",
               period_end AS "periodEnd", trial_ends_at AS "trialEndsAt",
               grace_ends_at AS "graceEndsAt", dunning_step AS "dunningStep",
               cancel_at_period_end AS "cancelAtPeriodEnd",
               pending_plan_id AS "pendingPlanId"
        FROM erp.tenant_subscription_state(${tenantId}::uuid)`,
  );
  return (rows.rows as unknown as SubscriptionStateProjection[])[0];
}

export interface BillingSnapshot {
  subscription: {
    id: string;
    status: string;
    planId: string;
    periodStart: string;
    periodEnd: string;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
    dunningStep: number;
    cancelAtPeriodEnd: boolean;
    pendingPlanId: string | null;
  } | null;
  plan: { key: string; limits: Record<string, unknown> } | null;
  usage: { users: number; branches: number; warehouses: number };
}

export async function billingSnapshot(tenantId: string): Promise<BillingSnapshot> {
  const rows = await db().execute(
    sql`SELECT erp.tenant_billing_snapshot(${tenantId}::uuid) AS snapshot`,
  );
  const raw = (rows.rows as unknown as { snapshot: BillingSnapshot | null }[])[0]?.snapshot;
  if (raw === null || raw === undefined) {
    return { subscription: null, plan: null, usage: { users: 0, branches: 0, warehouses: 0 } };
  }
  return raw;
}
