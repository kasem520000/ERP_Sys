import { sql } from "drizzle-orm";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../../infra/db/client";
import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-023 T8 — the CommerceChannelPort + ShippingPort with fakes
 * (integrations README §3.7/§3.8; phase §2 item 9):
 *
 * - pullOrders/pushPrice/pushStock — import is UPSERT-BY-NATURAL-KEY
 *   (channel order id) with an `Idempotency-Key` per batch: a duplicate
 *   batch returns the RECORDED outcome without re-pulling (the webhook
 *   ingest discipline);
 * - conflict policy for imported orders is SERVER-DECISION (ADR-0012 —
 *   never last-write-wins): a re-import whose FINANCIAL fields differ
 *   flags the row CONFLICT with the previous payload preserved in
 *   conflict_detail; resolution is an explicit human decision;
 * - ShippingPort is RESERVED with a fake only (post-MVP, not scheduled —
 *   the port exists to prevent ad-hoc coupling later).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("commerce channel access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- the ports -------------------------------------------------------------------

/** A pulled channel order (adapter-neutral; the channel speaks the port). */
export interface ChannelOrder {
  readonly channelOrderId: string;
  readonly orderDate: string;
  readonly currencyCode: string;
  readonly total: string;
  readonly items: readonly { sku: string; qty: number; unitPrice: string }[];
  readonly customerName: string | null;
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** The commerce channel port (integrations README §3.7). */
export interface CommerceChannelPort {
  readonly id: string;
  pullOrders(cursor: unknown): Promise<{ orders: readonly ChannelOrder[]; nextCursor: unknown; hasMore: boolean }>;
  pushPrice(list: readonly { sku: string; price: string; currencyCode: string }[]): Promise<{ accepted: number }>;
  pushStock(levels: readonly { sku: string; qty: number }[]): Promise<{ accepted: number }>;
}

/**
 * The fake channel (contract-testing substrate): a DETERMINISTIC order
 * stream scripted per test — no real platform API knowledge is encoded
 * (the same NO-FABRICATION discipline; the fake speaks the port only).
 */
export class FakeCommerceChannel implements CommerceChannelPort {
  readonly id = "fake-channel";
  private readonly batches: ChannelOrder[][] = [];
  private readonly pricePushes: unknown[] = [];
  private readonly stockPushes: unknown[] = [];

  /** Script the next pull batch (deterministic order). */
  enqueueBatch(orders: readonly ChannelOrder[]): this {
    this.batches.push([...orders]);
    return this;
  }

  get pricePushCount(): number {
    return this.pricePushes.length;
  }

  get stockPushCount(): number {
    return this.stockPushes.length;
  }

  async pullOrders(cursor: unknown): Promise<{ orders: readonly ChannelOrder[]; nextCursor: unknown; hasMore: boolean }> {
    const index = typeof cursor === "number" ? cursor : 0;
    const orders = this.batches[index] ?? [];
    const hasMore = index + 1 < this.batches.length;
    return { orders, nextCursor: index + 1, hasMore };
  }

  async pushPrice(list: readonly { sku: string; price: string; currencyCode: string }[]): Promise<{ accepted: number }> {
    this.pricePushes.push([...list]);
    return { accepted: list.length };
  }

  async pushStock(levels: readonly { sku: string; qty: number }[]): Promise<{ accepted: number }> {
    this.stockPushes.push([...levels]);
    return { accepted: levels.length };
  }
}

/**
 * The shipping port (RESERVED — post-MVP; integrations README §3.8): the
 * fake exists so the boundary is testable; no live integration ships.
 */
export interface ShippingPort {
  readonly id: string;
  quote(input: { weightGrams: number; destinationCountry: string; currencyCode: string }): Promise<{
    amount: string;
    currencyCode: string;
    serviceName: string;
  }>;
}

export class FakeShippingProvider implements ShippingPort {
  readonly id = "fake-shipping";
  async quote(input: { weightGrams: number; destinationCountry: string; currencyCode: string }): Promise<{
    amount: string;
    currencyCode: string;
    serviceName: string;
  }> {
    // Deterministic fake rate: 10 currency units + 0.001/gram — clearly a
    // FAKE rate shape, never a real carrier tariff.
    const amount = (10 + input.weightGrams * 0.001).toFixed(2);
    return { amount, currencyCode: input.currencyCode, serviceName: "FAKE-STANDARD" };
  }
}

// -- the import bookkeeping --------------------------------------------------------

export class CommerceImportError extends DomainError {
  constructor(reason: string, details?: Readonly<Record<string, unknown>>) {
    super("sales/commerce-import", reason, details);
  }
}

export interface CommerceImportOutcome {
  readonly batchId: string;
  readonly idempotentReplay: boolean;
  readonly pulled: number;
  readonly imported: number;
  readonly skipped: number;
  readonly conflicts: number;
}

/**
 * The financial fields the server-decision conflict policy guards — a
 * CANONICAL form (key-order independent: jsonb reorders object keys, so a
 * naive JSON.stringify comparison would flag every unchanged re-import).
 */
function financialFingerprint(order: ChannelOrder): string {
  const items = [...order.items]
    .map((item) => `${item.sku}:${item.qty}:${item.unitPrice}`)
    .sort()
    .join("|");
  return `${order.total}::${order.currencyCode}::${items}`;
}

/**
 * Import one pull batch (T8): upsert by natural key (tenant, channel,
 * channel order id). A NEW order → IMPORTED. A re-import with UNCHANGED
 * financials → skipped (idempotent). A re-import with CHANGED financials
 * → CONFLICT (previous payload preserved; human decides — no LWW).
 */
export async function importChannelOrders(input: {
  channel: CommerceChannelPort;
  /** The Idempotency-Key per batch (duplicate batch = recorded replay). */
  batchKey: string;
  actorId: string | null;
}): Promise<CommerceImportOutcome> {
  const tx = tenantTx();
  const existingBatch = (await tx.execute(sql`
    SELECT id FROM commerce_channel_imports
    WHERE channel_adapter_id = ${input.channel.id} AND batch_key = ${input.batchKey}
    LIMIT 1
  `)).rows as unknown as { id: string }[];
  if (existingBatch.length > 0) {
    const recorded = (await tx.execute(sql`
      SELECT pulled_count AS pulled, imported_count AS imported, skipped_count AS skipped,
        conflict_count AS conflicts FROM commerce_channel_imports WHERE id = ${existingBatch[0]!.id}
    `)).rows as unknown as { pulled: number; imported: number; skipped: number; conflicts: number }[];
    const row = recorded[0]!;
    return {
      batchId: existingBatch[0]!.id,
      idempotentReplay: true,
      pulled: row.pulled,
      imported: row.imported,
      skipped: row.skipped,
      conflicts: row.conflicts,
    };
  }

  const cursorRow = (await tx.execute(sql`
    SELECT cursor_after FROM commerce_channel_imports
    WHERE channel_adapter_id = ${input.channel.id}
    ORDER BY created_at DESC LIMIT 1
  `)).rows as unknown as { cursor_after: unknown }[];
  const cursor = cursorRow[0]?.cursor_after ?? 0;

  const { orders, nextCursor } = await input.channel.pullOrders(cursor);
  let imported = 0;
  let skipped = 0;
  let conflicts = 0;
  for (const order of orders) {
    const existing = (await tx.execute(sql`
      SELECT id, status, payload FROM commerce_channel_orders
      WHERE channel_adapter_id = ${input.channel.id} AND channel_order_id = ${order.channelOrderId}
      LIMIT 1
    `)).rows as unknown as { id: string; status: string; payload: Record<string, unknown> }[];
    if (existing.length === 0) {
      const id = generateUuidV7();
      await tx.execute(sql`
        INSERT INTO commerce_channel_orders (id, tenant_id, created_by, channel_adapter_id,
          channel_order_id, payload, status)
        VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.channel.id},
          ${order.channelOrderId}, ${JSON.stringify(order)}::jsonb, 'IMPORTED')
      `);
      imported += 1;
      continue;
    }
    const prior = existing[0]!;
    if (prior.status === "CONFLICT") {
      // An unresolved conflict swallows the re-import as another conflict
      // signal (counts, no data change — the human still decides).
      conflicts += 1;
      continue;
    }
    const priorOrder = JSON.parse(JSON.stringify(prior.payload)) as ChannelOrder;
    if (financialFingerprint(priorOrder) === financialFingerprint(order)) {
      skipped += 1;
      continue;
    }
    // Financial drift on re-import → server-decision conflict (ADR-0012).
    await tx.execute(sql`
      UPDATE commerce_channel_orders SET status = 'CONFLICT',
        conflict_detail = ${JSON.stringify({ previous: prior.payload, incoming: order })}::jsonb,
        updated_at = now(), version = version + 1
      WHERE id = ${prior.id}
    `);
    conflicts += 1;
  }

  const batchId = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO commerce_channel_imports (id, tenant_id, created_by, channel_adapter_id,
      batch_key, cursor_before, cursor_after, pulled_count, imported_count, skipped_count,
      conflict_count, status)
    VALUES (${batchId}, erp.current_tenant_id(), ${input.actorId}, ${input.channel.id},
      ${input.batchKey}, ${JSON.stringify(cursor)}::jsonb, ${JSON.stringify(nextCursor)}::jsonb,
      ${orders.length}, ${imported}, ${skipped}, ${conflicts}, 'COMPLETED')
  `);
  return {
    batchId,
    idempotentReplay: false,
    pulled: orders.length,
    imported,
    skipped,
    conflicts,
  };
}

/** Resolve a conflict (the explicit human decision — server-decision policy). */
export async function resolveConflict(input: {
  channelOrderId: string;
  resolution: "KEEP_EXISTING" | "TAKE_INCOMING" | "REJECT_BOTH";
  actorId: string | null;
}): Promise<void> {
  const tx = tenantTx();
  if (!["KEEP_EXISTING", "TAKE_INCOMING", "REJECT_BOTH"].includes(input.resolution)) {
    throw new CommerceImportError(`unknown resolution "${input.resolution}"`);
  }
  const rows = (await tx.execute(sql`
    SELECT id, status, conflict_detail FROM commerce_channel_orders
    WHERE id = ${input.channelOrderId} AND status = 'CONFLICT' LIMIT 1
  `)).rows as unknown as { id: string; status: string; conflict_detail: Record<string, unknown> | null }[];
  const row = rows[0];
  if (row === undefined) {
    throw new CommerceImportError(`channel order ${input.channelOrderId} not found or not in CONFLICT`);
  }
  const detail = (row.conflict_detail ?? {}) as { incoming?: Record<string, unknown> };
  if (input.resolution === "TAKE_INCOMING" && detail.incoming !== undefined) {
    await tx.execute(sql`
      UPDATE commerce_channel_orders SET payload = ${JSON.stringify(detail.incoming)}::jsonb,
        status = 'RESOLVED', resolution = ${input.resolution}, resolved_by = ${input.actorId},
        resolved_at = now(), updated_at = now(), version = version + 1
      WHERE id = ${row.id}
    `);
    return;
  }
  await tx.execute(sql`
    UPDATE commerce_channel_orders SET status = 'RESOLVED', resolution = ${input.resolution},
      resolved_by = ${input.actorId}, resolved_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${row.id}
  `);
}

/** List imported orders (the staging surface for the UI). */
export async function listChannelOrders(filter: {
  status?: string;
  limit?: number;
}): Promise<
  { id: string; channelAdapterId: string; channelOrderId: string; status: string; createdAt: string }[]
> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, channel_adapter_id AS "channelAdapterId", channel_order_id AS "channelOrderId",
      status, created_at::text AS "createdAt"
    FROM commerce_channel_orders
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null}::text)
    ORDER BY created_at DESC LIMIT ${filter.limit ?? 100}
  `);
  return rows.rows as unknown as {
    id: string;
    channelAdapterId: string;
    channelOrderId: string;
    status: string;
    createdAt: string;
  }[];
}
