import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/cmms.store";
import {
  CmmsInputInvalidError,
  CmmsSpareItemDiscontinuedError,
  CmmsSpareNotFoundError,
} from "../domain/cmms-errors";

/**
 * PHASE-049 (W-18 — T-09) THE SPARES API: the per-asset spare-parts BOM
 * (D-05 — BR-099) — the owner's W-18 order: «القطع عبر WMS الحقيقي
 * حصرًا والمقاصة ذرّية»:
 *
 *   THE BOM (0106's asset_spares): the item-master FK with the phase
 *   doc's own drift mitigation made typed — a discontinued item refuses
 *   AT BOM SAVE (SPARE_ITEM_DISCONTINUED naming the sku and status);
 *   qty > 0; one row per (asset, item) — the 0106 unique's typed first
 *   line directs the patch, never a silent duplicate.
 *
 *   THE CONSUMPTION PATH — exclusively the REAL WMS (the declared
 *   reading): the BOM never issues stock itself; the work-order PARTS
 *   lines are the consumption surface, and their issue rides the W-17
 *   completion act's REAL WMS path (planIssue/applyIssue sourced
 *   maintenance_work_order) in the SAME ambient transaction as the G-59
 *   journal — G-60's discipline on the credit leg, the atomic clearing
 *   (together-or-nothing, the owner's four-conditions ruling's second
 *   condition, proven by the W-17 all-nothing arm). The BOM is the
 *   picking surface the parts lines draw from — never a second writer of
 *   item_stock/stock_moves (cmms.store never touches them; ADR-0007's
 *   twin discipline on the inventory plane).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new CmmsInputInvalidError(`${what} must be a UUID: ${value}`);
  }
  return value;
}

@Injectable()
export class AssetSparesService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async addSpare(input: {
    assetId: string;
    itemId: string;
    qty: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.SpareRow> {
    requireUuid(input.assetId, "assetId");
    requireUuid(input.itemId, "itemId");
    if (!QTY_RE.test(input.qty) || Number(input.qty) <= 0) {
      throw new CmmsInputInvalidError(`qty must be a positive decimal (≤ 6dp): ${input.qty}`);
    }
    const asset = await store.findAssetStatus(input.assetId);
    if (asset === undefined) {
      throw new CmmsInputInvalidError(`asset ${input.assetId} does not exist in this tenant`);
    }
    // The phase doc's own drift mitigation, made typed: discontinued
    // items refuse at BOM save (the item-master FK is the floor).
    const item = await store.findItemLite(input.itemId);
    if (item === undefined) {
      throw new CmmsInputInvalidError(`item ${input.itemId} does not exist in this tenant`);
    }
    if (item.status !== "ACTIVE") {
      throw new CmmsSpareItemDiscontinuedError({
        itemId: item.id,
        sku: item.sku,
        status: item.status,
      });
    }
    // One BOM row per (asset, item) — the 0106 unique's typed first line
    // (the patch is the honest edit, never a duplicate).
    const existing = (await store.listSpares({ assetId: input.assetId })).find(
      (row) => row.itemId === input.itemId,
    );
    if (existing !== undefined) {
      throw new CmmsInputInvalidError(
        `the asset's BOM already carries item ${item.sku} (line ${existing.id}, qty ${existing.qty}) — patch the line instead of adding a duplicate (one row per asset+item, 0106's floor)`,
      );
    }
    const spare = await store.insertSpare({
      assetId: input.assetId,
      itemId: input.itemId,
      qty: input.qty,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.asset_spare_added",
      entityType: "asset_spare",
      entityId: spare.id,
      actorId: input.actorId ?? undefined,
      after: { assetId: spare.assetId, itemId: spare.itemId, qty: spare.qty },
    });
    return spare;
  }

  async listSpares(filter: { assetId?: string }): Promise<store.SpareRow[]> {
    if (filter.assetId !== undefined) requireUuid(filter.assetId, "assetId");
    return store.listSpares(filter);
  }

  async patchSpare(input: {
    spareId: string;
    qty?: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.SpareRow> {
    requireUuid(input.spareId, "spareId");
    const spare = await store.findSpareById(input.spareId);
    if (spare === undefined) throw new CmmsSpareNotFoundError(input.spareId);
    if (input.qty !== undefined) {
      if (!QTY_RE.test(input.qty) || Number(input.qty) <= 0) {
        throw new CmmsInputInvalidError(`qty must be a positive decimal (≤ 6dp): ${input.qty}`);
      }
    }
    const patched = await store.patchSpare({
      spareId: spare.id,
      qty: input.qty,
      note: input.note ?? undefined,
      noteAr: input.noteAr ?? undefined,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "assets.asset_spare_patched",
      entityType: "asset_spare",
      entityId: spare.id,
      actorId: input.actorId ?? undefined,
      before: { qty: spare.qty },
      after: { qty: patched?.qty },
    });
    return patched ?? spare;
  }

  async removeSpare(input: { spareId: string; actorId: string | null }): Promise<void> {
    requireUuid(input.spareId, "spareId");
    const spare = await store.findSpareById(input.spareId);
    if (spare === undefined) throw new CmmsSpareNotFoundError(input.spareId);
    await store.deleteSpare(spare.id);
    await this.audit.record({
      action: "assets.asset_spare_removed",
      entityType: "asset_spare",
      entityId: spare.id,
      actorId: input.actorId ?? undefined,
      before: { assetId: spare.assetId, itemId: spare.itemId, qty: spare.qty },
    });
  }
}
