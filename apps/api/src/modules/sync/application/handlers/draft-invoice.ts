import { sql } from "drizzle-orm";

import { Decimal, DomainError, generateUuidV7 } from "@erp/domain-core";
import {
  draftInvoiceCreateSchema,
  draftInvoiceUpdateSchema,
} from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../../../infra/settings/setting-reader";
import { resolveOutputTaxLines } from "../../../sales/application/tax-lines";
import { requireCustomer, requireSellableItem } from "../../../sales/application/quotations";
import { TaxResolverService } from "../../../tax/application/tax-resolver-service";
import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-020 · `sales_invoice:create_draft` + `sales_invoice:update_draft`
 * (MASTER-PLAN §7 OWNER_DEVICE_WINS rows; CONFLICT_RESOLUTION §2 drafts
 * row + §4 optimistic concurrency; SYNC_PROTOCOL §3/§6.2 — aggregate
 * snapshots, never line patches). v2 only (the desktop OFFLINE-DRAFT
 * capability class).
 *
 * create_draft: DRAFT creation through the sales module's
 * SalesInvoiceService.create (kind=CREDIT — no cash exposure, no autopost;
 * stock/warehouse stay post-time concerns) with the substrate's
 * owner_device_id stamp (0029) — the direct stamp is the pragmatic seam
 * (the owning module is sales, the owner stamp is sync substrate;
 * recorded as a decision in T-P20-2b-push.md).
 *
 * update_draft: ownership + baseVersion gates FIRST (FORBIDDEN /
 * STALE_VERSION), then a wholesale aggregate replace (header fields +
 * lines + recomputed tax/totals through the sales module's own tax
 * resolution) — everything validated BEFORE the first write (zero
 * residue: the ambient tx cannot roll back per item).
 */

/** Stateless leaf service (the sales module's own resolver); one per
 * process for the handler's tax recomputation. */
const resolver = new TaxResolverService();

/** The tenant's primary branch (create_draft's branch default — MAIN). */
async function primaryBranchId(): Promise<string> {
  const { listBranches } = await import("../../../tenancy/infrastructure/tenancy.store");
  const branches = await listBranches(null);
  const main = branches.find((branch) => branch.code === "MAIN") ?? branches[0];
  if (main === undefined) {
    handlerValidationError("the tenant has no branch — create_draft needs one");
  }
  return main.id;
}

/** Resolve a null customerId to the tenant's walk-in cash partner (the
 * PosSaleService.walkInCustomerId singleton seam: find-or-create the
 * code-reserved POS-WALKIN row through the partners store). */
async function resolveCustomerId(customerId: string | null): Promise<string> {
  if (customerId !== null) {
    return customerId;
  }
  const partnersStore = await import("../../../partners/infrastructure/partners.store");
  const existing = await partnersStore.findPartnerByCode("POS-WALKIN");
  if (existing !== undefined) {
    return existing.id;
  }
  const created = await partnersStore.insertPartner({
    kind: "CUSTOMER",
    code: "POS-WALKIN",
    name: "Walk-in customer",
    nameAr: "عميل نقدي",
    taxNumber: null,
    creditLimit: null,
    creditTermsId: null,
    priceListId: null,
  });
  return created.id;
}

async function invoiceRowVersion(invoiceId: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM sales_invoices WHERE id = ${invoiceId} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}

// -- create_draft ----------------------------------------------------------------

export const draftInvoiceCreateHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("sales_invoice:create_draft is a v2-only intent");
  }
  const parsed = draftInvoiceCreateSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError(
      "sales_invoice:create_draft payload rejected by the contract",
      { issues: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  const payload = parsed.data;

  const customerId = await resolveCustomerId(payload.customerId);
  const branchId = await primaryBranchId();
  const currencyCode = await ownTenantBaseCurrency();

  // The sales module's DRAFT creation (validations + tax snapshots + the
  // BR-001 preview + its own audit event live there).
  const created = await handlerServices().invoices.create({
    branchId,
    customerId,
    salesRepId: null,
    kind: "CREDIT",
    invoiceDate: payload.orderDate,
    dueDate: null,
    currencyCode,
    exchangeRate: null,
    orderId: null,
    deliveryId: null,
    warehouseId: null,
    cashAccountId: null,
    note: null,
    noteAr: null,
    actorId: ctx.userId,
    lines: payload.lines.map((line) => ({
      itemId: line.itemId,
      accountId: null,
      deliveryLineId: null,
      description: line.description ?? null,
      descriptionAr: null,
      qty: line.qty,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount ?? null,
      taxCodeId: line.taxCodeId ?? null,
      batchId: null,
      serialIds: null,
      note: null,
    })),
  });

  // The owner stamp (0029): the OWNER_DEVICE_WINS discriminator. Direct
  // SQL — the column is sync substrate on a sales-owned table; the owning
  // module's service has no owner concept (recorded as the pragmatic seam).
  const tx = requireTenantContext().tx!;
  await tx.execute(sql`
    UPDATE sales_invoices SET owner_device_id = ${ctx.deviceId}::uuid, updated_at = now()
    WHERE id = ${created.id}::uuid
  `);

  const version = await invoiceRowVersion(created.id);
  return {
    status: "ACCEPTED",
    result: { invoiceId: created.id, status: "DRAFT" },
    entity: { id: created.id, version },
    feedEntries: [
      {
        entityType: "sales_invoices",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};

// -- update_draft ----------------------------------------------------------------

interface DraftRow {
  id: string;
  version: number;
  status: string;
  owner_device_id: string | null;
  customer_id: string;
  invoice_date: string;
  currency_code: string;
}

export const draftInvoiceUpdateHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("sales_invoice:update_draft is a v2-only intent");
  }
  const parsed = draftInvoiceUpdateSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError(
      "sales_invoice:update_draft payload rejected by the contract",
      { issues: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  const payload = parsed.data;
  const tx = requireTenantContext().tx!;

  // 1. Load (RLS tenant-scoped — identical error for unknown-vs-foreign
  // ids, C-13; no existence disclosure).
  const rows = await tx.execute(sql`
    SELECT id, version, status, owner_device_id, customer_id, invoice_date, currency_code
    FROM sales_invoices
    WHERE tenant_id = erp.current_tenant_id() AND id = ${payload.invoiceId}::uuid
    LIMIT 1
  `);
  const draft = (rows.rows as unknown as DraftRow[])[0];
  if (draft === undefined) {
    handlerValidationError(`invoice ${payload.invoiceId} does not exist in this tenant`);
  }

  // 2. State gate: only DRAFT mutates (everything else is server-owned).
  if (draft.status !== "DRAFT") {
    handlerValidationError(
      `invoice ${payload.invoiceId} is ${draft.status} — only DRAFT invoices take device edits`,
      { currentStatus: draft.status },
    );
  }

  // 3. Ownership gate (OWNER_DEVICE_WINS, CONFLICT_RESOLUTION §2 drafts
  // row): a null owner (an online-created draft) is equally non-owner for
  // devices — transfers are admin-mediated (drafts.reassign). Typed
  // FORBIDDEN with details.ownerDeviceId (C-10).
  if (draft.owner_device_id === null || draft.owner_device_id !== ctx.deviceId) {
    throw new DomainError(
      "FORBIDDEN",
      `invoice ${payload.invoiceId} is owned by another device — only its owner edits it (OWNER_DEVICE_WINS)`,
      { ownerDeviceId: draft.owner_device_id },
    );
  }

  // 4. Optimistic concurrency (CONFLICT_RESOLUTION §4): baseVersion rides
  // the COMMAND envelope; mismatch → STALE_VERSION with
  // details.currentVersion; absent → accepted (legacy tolerance,
  // MASTER-PLAN §7 — recorded).
  if (ctx.command.baseVersion !== undefined && ctx.command.baseVersion !== draft.version) {
    throw new DomainError(
      "STALE_VERSION",
      `invoice ${payload.invoiceId} is at version ${draft.version} — the command's baseVersion ${ctx.command.baseVersion} is stale (refresh and re-apply)`,
      { currentVersion: draft.version },
    );
  }

  // 5. Line validation BEFORE any write (the DB CHECKs mirror these —
  // validating first keeps the ambient tx clean; zero residue).
  for (const [index, line] of payload.lines.entries()) {
    if (Number(line.qty) <= 0) {
      handlerValidationError(`line ${index + 1} qty must be positive (≤ 6dp): ${line.qty}`);
    }
    if (Number(line.unitPrice) < 0) {
      handlerValidationError(`line ${index + 1} unit price must be non-negative: ${line.unitPrice}`);
    }
    if (Number(line.discountAmount ?? "0") < 0) {
      handlerValidationError(`line ${index + 1} discount must be non-negative: ${line.discountAmount}`);
    }
    const net = new Decimal(line.qty).times(new Decimal(line.unitPrice)).minus(
      new Decimal(line.discountAmount ?? "0"),
    );
    if (net.comparedTo(new Decimal(0)) <= 0) {
      handlerValidationError(
        `line ${index + 1} net amount must be positive (qty × unitPrice − discount > 0)`,
      );
    }
    await requireSellableItem(line.itemId);
  }
  if (payload.customerId !== null && payload.customerId !== draft.customer_id) {
    // A customer switch re-validates through the sales module's gate
    // (existence + CUSTOMER kind + ACTIVE — PARTNER_INACTIVE vocabulary).
    await requireCustomer(payload.customerId);
  }

  // 6. Tax recomputation through the sales module's own resolution (the
  // same path create() uses — totals stay consistent with the snapshot).
  const taxLines = await resolveOutputTaxLines({
    resolver,
    documentDate: payload.orderDate,
    currencyCode: draft.currency_code,
    lines: payload.lines
      .map((line) => ({
        taxCodeId: line.taxCodeId ?? "",
        amount: new Decimal(line.qty)
          .times(new Decimal(line.unitPrice))
          .minus(new Decimal(line.discountAmount ?? "0"))
          .toFixed(4),
      }))
      .filter((line) => line.taxCodeId !== ""),
  });
  const taxByLine = new Map<number, (typeof taxLines.lines)[number]>();
  let taxIndex = 0;
  for (let index = 0; index < payload.lines.length; index += 1) {
    if (payload.lines[index]!.taxCodeId !== null) {
      taxByLine.set(index + 1, taxLines.lines[taxIndex]!);
      taxIndex += 1;
    }
  }

  let totalNet = new Decimal(0);
  const storeLines: {
    lineNo: number;
    itemId: string;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    taxSnapshot: Record<string, unknown> | null;
    description: string | null;
  }[] = [];
  let lineNo = 0;
  for (const line of payload.lines) {
    lineNo += 1;
    const net = new Decimal(line.qty).times(new Decimal(line.unitPrice)).minus(
      new Decimal(line.discountAmount ?? "0"),
    );
    const tax = taxByLine.get(lineNo);
    const taxAmount = tax?.resolved.taxAmount ?? "0.0000";
    totalNet = totalNet.plus(net);
    storeLines.push({
      lineNo,
      itemId: line.itemId,
      qty: new Decimal(line.qty).toFixed(6),
      unitPrice: new Decimal(line.unitPrice).toFixed(6),
      discountAmount: new Decimal(line.discountAmount ?? "0").toFixed(4),
      taxCodeId: line.taxCodeId ?? null,
      netAmount: net.toFixed(4),
      taxAmount,
      taxSnapshot: (tax?.resolved.snapshot as Record<string, unknown> | undefined) ?? null,
      description: line.description ?? null,
    });
  }
  const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  const totalTaxS = new Decimal(taxLines.totalTax)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
  const totalGross = new Decimal(totalNetS)
    .plus(new Decimal(totalTaxS))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);

  // 7. Apply — the aggregate replace (SYNC_PROTOCOL §6.2: "update_draft
  //    commands are aggregate snapshots, not line patches"): DELETE the
  //    existing line set + INSERT the payload's lines wholesale. The
  //    DELETE grant landed with migration 0031 (0018 granted the online
  //    module SELECT/INSERT/UPDATE only — its drafts are append-only);
  //    safety is by construction: the status gate above rejects anything
  //    that is not DRAFT before any write, and OWNER_DEVICE_WINS
  //    guarantees a single writer, so a posted document's lines are
  //    unreachable through this handler.
  await tx.execute(sql`
    DELETE FROM sales_invoice_lines
    WHERE tenant_id = erp.current_tenant_id() AND invoice_id = ${payload.invoiceId}::uuid
  `);
  for (const line of storeLines) {
    await tx.execute(sql`
      INSERT INTO sales_invoice_lines
        (id, tenant_id, invoice_id, line_no, item_id, account_id, delivery_line_id,
         description, description_ar, qty, unit_price, discount_amount, tax_code_id,
         net_amount, tax_amount, tax_snapshot, batch_id, serial_ids,
         issue_unit_cost, issue_value, note, foc_reason_code)
      VALUES
        (${generateUuidV7()}, erp.current_tenant_id(), ${payload.invoiceId}::uuid,
         ${line.lineNo}, ${line.itemId}::uuid, null, null,
         ${line.description}, null, ${line.qty}, ${line.unitPrice}, ${line.discountAmount},
         ${line.taxCodeId}::uuid, ${line.netAmount}, ${line.taxAmount},
         ${JSON.stringify(line.taxSnapshot)}::jsonb, null, null, null, null, null, null)
    `);
  }
  // Header: the due-after-invoice CHECK (ck_sales_invoices_due_after_
  // invoice) — the due date never trails the (possibly moved) invoice
  // date (GREATEST); the credit-terms window re-derives at approve/post.
  await tx.execute(sql`
    UPDATE sales_invoices SET
      customer_id = ${payload.customerId ?? draft.customer_id}::uuid,
      invoice_date = ${payload.orderDate},
      due_date = GREATEST(due_date, ${payload.orderDate}),
      total_net = ${totalNetS}, total_tax = ${totalTaxS}, total_gross = ${totalGross},
      tax_summary = ${JSON.stringify({ groups: taxLines.summaryGroups, totalTax: taxLines.totalTax })}::jsonb,
      updated_at = now(), version = version + 1
    WHERE tenant_id = erp.current_tenant_id() AND id = ${payload.invoiceId}::uuid
  `);

  // 8. Audit the mutation (the module services audit their own paths; this
  // direct-SQL replace records the device edit with before/after).
  await handlerServices().audit.record({
    action: "sales.invoice_draft_updated",
    entityType: "sales_invoice",
    entityId: payload.invoiceId,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    before: {
      customerId: draft.customer_id,
      invoiceDate: draft.invoice_date,
      version: draft.version,
    },
    after: {
      customerId: payload.customerId ?? draft.customer_id,
      invoiceDate: payload.orderDate,
      version: draft.version + 1,
      totalNet: totalNetS,
      totalTax: totalTaxS,
      totalGross,
      lines: payload.lines.length,
    },
  });

  const version = draft.version + 1;
  return {
    status: "ACCEPTED",
    result: { invoiceId: payload.invoiceId, status: "DRAFT", version },
    entity: { id: payload.invoiceId, version },
    feedEntries: [
      {
        entityType: "sales_invoices",
        entityId: payload.invoiceId,
        op: "UPSERT" as const,
        payload: { id: payload.invoiceId, version },
      },
    ],
  };
};
