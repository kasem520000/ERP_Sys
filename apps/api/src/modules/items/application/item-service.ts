import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/items.store";
import {
  BarcodeTakenError,
  CategoryCodeTakenError,
  CategoryCycleError,
  CategoryNotFoundError,
  CategoryParentArchivedError,
  ItemArchivedError,
  ItemNotFoundError,
  ItemShelfLifeInvalidError,
  ItemSkuTakenError,
  TaxCodeAssignmentInvalidError,
  TrackingFlagsInvalidError,
  UomNotFoundError,
} from "../domain/items-errors";

/**
 * Item master service (PHASE-006 §2.2/T4): sku rules (tenant-unique,
 * auto-shape-validated), bilingual categories tree (cycle-free by
 * construction — moves under a descendant are rejected), barcodes (per
 * UoM, tenant-wide scan-unique), tracking-flag matrix (expiry requires
 * batch; only STOCK items carry tracking), and trigram search (T10).
 *
 * tax_code_id stays accepted but FK-less until PHASE-009
 * (expand-migrate-contract; UI hides the field until then).
 */

export interface CreateItemInput {
  sku: string;
  name: string;
  nameAr: string | null;
  kind: "STOCK" | "SERVICE" | "COMPOSITE";
  uomId: string;
  categoryId: string | null;
  taxCodeId: string | null;
  costingMethod: "WAC" | "FIFO";
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
  /** PHASE-018 (migration 0026): 1..3650 or null (FG batch expiry). */
  shelfLifeDays?: number | null;
  reorderLevel: string | null;
  reorderQty: string | null;
  basePrice: string | null;
}

function assertTrackingFlags(input: {
  kind: string;
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
}): void {
  if (input.kind !== "STOCK" && (input.trackBatch || input.trackSerial || input.trackImei || input.hasExpiry)) {
    throw new TrackingFlagsInvalidError("tracking flags are only valid on STOCK items");
  }
  if (input.hasExpiry && !input.trackBatch) {
    throw new TrackingFlagsInvalidError("has_expiry requires track_batch (expiry dates ride on batches)");
  }
}

/** PHASE-018 (migration 0026): integer 1..3650 or null (no flag-matrix change —
 * shelf life is orthogonal to the tracking flags). */
function assertShelfLifeDays(value: number | null | undefined): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value) || value < 1 || value > 3650) {
    throw new ItemShelfLifeInvalidError(value);
  }
  return value;
}

/**
 * PHASE-009 (T5): an item/category tax-code assignment requires an ACTIVE
 * tenant tax code (the migration-0013 FK's clean error surface — items keeps
 * its DEPENDENCY_RULES §2 shape with no tax-module import; this is a direct
 * read of the tax_codes table the migration FK guards).
 */
async function assertTaxCodeUsable(taxCodeId: string | null | undefined): Promise<string | null> {
  if (taxCodeId === null || taxCodeId === undefined || taxCodeId === "") return null;
  const code = await store.findTaxCodeForItemAssignment(taxCodeId);
  if (code === undefined) {
    throw new TaxCodeAssignmentInvalidError(`tax code ${taxCodeId} does not exist in this tenant`);
  }
  if (code.status !== "ACTIVE") {
    throw new TaxCodeAssignmentInvalidError(`tax code ${code.code} is ARCHIVED and cannot be assigned`);
  }
  return code.id;
}

@Injectable()
export class ItemService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(
    filter: store.ItemListFilter,
    cursor: string | undefined,
    limit: number,
  ): Promise<store.ItemListPage> {
    return store.listItems(filter, cursor, limit);
  }

  async get(id: string): Promise<store.ItemRow> {
    const item = await store.findItemById(id);
    if (item === undefined || item.deletedAt !== null) {
      throw new ItemNotFoundError(id);
    }
    return item;
  }

  async create(actorId: string, input: CreateItemInput): Promise<store.ItemRow> {
    assertTrackingFlags(input);
    const existing = await store.findItemBySku(input.sku);
    if (existing !== undefined) {
      throw new ItemSkuTakenError(input.sku);
    }
    const uom = await store.findUomById(input.uomId);
    if (uom === undefined) {
      throw new UomNotFoundError(input.uomId);
    }
    if (input.categoryId !== null) {
      const category = await store.findCategoryById(input.categoryId);
      if (category === undefined) {
        throw new CategoryNotFoundError(input.categoryId);
      }
      if (category.status !== "ACTIVE") {
        throw new CategoryParentArchivedError(input.categoryId);
      }
    }
    // PHASE-009 (T5): the FK's existence + ACTIVE check surfaced cleanly.
    const taxCodeId = await assertTaxCodeUsable(input.taxCodeId);
    const item = await store.insertItem({
      ...input,
      taxCodeId,
      shelfLifeDays: assertShelfLifeDays(input.shelfLifeDays),
    });
    await this.audit.record({
      action: "item.created",
      entityType: "item",
      entityId: item.id,
      actorId,
      after: { sku: item.sku, name: item.name, kind: item.kind },
    });
    return item;
  }

  async update(
    actorId: string,
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      categoryId?: string | null;
      taxCodeId?: string | null;
      trackBatch?: boolean;
      trackSerial?: boolean;
      trackImei?: boolean;
      hasExpiry?: boolean;
      /** PHASE-018: 1..3650, or null to clear; undefined = untouched. */
      shelfLifeDays?: number | null;
      reorderLevel?: string | null;
      reorderQty?: string | null;
      basePrice?: string | null;
      status?: string;
      version?: number;
    },
  ): Promise<store.ItemRow> {
    const before = await store.findItemById(id);
    if (before === undefined || before.deletedAt !== null) {
      throw new ItemNotFoundError(id);
    }
    assertTrackingFlags({
      kind: before.kind,
      trackBatch: patch.trackBatch ?? before.trackBatch,
      trackSerial: patch.trackSerial ?? before.trackSerial,
      trackImei: patch.trackImei ?? before.trackImei,
      hasExpiry: patch.hasExpiry ?? before.hasExpiry,
    });
    if (patch.categoryId !== undefined && patch.categoryId !== null) {
      const category = await store.findCategoryById(patch.categoryId);
      if (category === undefined) {
        throw new CategoryNotFoundError(patch.categoryId);
      }
      if (category.status !== "ACTIVE") {
        throw new CategoryParentArchivedError(patch.categoryId);
      }
    }
    const patchWithTax =
      patch.taxCodeId !== undefined
        ? { ...patch, taxCodeId: await assertTaxCodeUsable(patch.taxCodeId) }
        : patch;
    const patchWithShelfLife =
      patch.shelfLifeDays === undefined
        ? patchWithTax
        : { ...patchWithTax, shelfLifeDays: assertShelfLifeDays(patch.shelfLifeDays) };
    const updated = await store.updateItem(id, patchWithShelfLife);
    if (updated === undefined) {
      throw new ItemNotFoundError(id);
    }
    await this.audit.record({
      action: "item.updated",
      entityType: "item",
      entityId: id,
      actorId,
      before: { name: before.name, base_price: before.basePrice, status: before.status },
      after: { name: updated.name, base_price: updated.basePrice, status: updated.status },
    });
    return updated;
  }

  async archive(actorId: string, id: string): Promise<store.ItemRow> {
    const before = await store.findItemById(id);
    if (before === undefined) {
      throw new ItemNotFoundError(id);
    }
    if (before.deletedAt !== null) {
      throw new ItemArchivedError(id);
    }
    const archived = await store.archiveItem(id);
    if (archived === undefined) {
      throw new ItemNotFoundError(id);
    }
    await this.audit.record({
      action: "item.archived",
      entityType: "item",
      entityId: id,
      actorId,
      before: { status: before.status },
      after: { status: archived.status, deleted: true },
    });
    return archived;
  }

  // -- categories -----------------------------------------------------------

  async listCategories(): Promise<store.ItemCategoryRow[]> {
    return store.listCategories();
  }

  async createCategory(
    actorId: string,
    input: {
      code: string;
      name: string;
      nameAr: string | null;
      parentId: string | null;
      defaultTaxCodeId?: string | null;
    },
  ): Promise<store.ItemCategoryRow> {
    const existing = await store.findCategoryByCode(input.code);
    if (existing !== undefined) {
      throw new CategoryCodeTakenError(input.code);
    }
    if (input.parentId !== null) {
      const parent = await store.findCategoryById(input.parentId);
      if (parent === undefined) {
        throw new CategoryNotFoundError(input.parentId);
      }
      if (parent.status !== "ACTIVE") {
        throw new CategoryParentArchivedError(input.parentId);
      }
    }
    const defaultTaxCodeId = await assertTaxCodeUsable(input.defaultTaxCodeId ?? null);
    const category = await store.insertCategory({ ...input, defaultTaxCodeId });
    await this.audit.record({
      action: "item_category.created",
      entityType: "item_category",
      entityId: category.id,
      actorId,
      after: { code: category.code, name: category.name, defaultTaxCodeId },
    });
    return category;
  }

  /** Reparenting walks the ancestor chain — a descendant parent is a cycle. */
  async updateCategory(
    actorId: string,
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      parentId?: string | null;
      defaultTaxCodeId?: string | null;
      status?: string;
    },
  ): Promise<store.ItemCategoryRow> {
    const before = await store.findCategoryById(id);
    if (before === undefined) {
      throw new CategoryNotFoundError(id);
    }
    if (patch.parentId !== undefined && patch.parentId !== null) {
      if (patch.parentId === id) {
        throw new CategoryCycleError();
      }
      const parent = await store.findCategoryById(patch.parentId);
      if (parent === undefined) {
        throw new CategoryNotFoundError(patch.parentId);
      }
      if (parent.status !== "ACTIVE") {
        throw new CategoryParentArchivedError(patch.parentId);
      }
      const ancestors = await store.categoryAncestors(patch.parentId);
      if (ancestors.includes(id)) {
        throw new CategoryCycleError();
      }
    }
    const patchWithTax =
      patch.defaultTaxCodeId !== undefined
        ? { ...patch, defaultTaxCodeId: await assertTaxCodeUsable(patch.defaultTaxCodeId) }
        : patch;
    const updated = await store.updateCategory(id, patchWithTax);
    if (updated === undefined) {
      throw new CategoryNotFoundError(id);
    }
    await this.audit.record({
      action: "item_category.updated",
      entityType: "item_category",
      entityId: id,
      actorId,
      before: { name: before.name, parent_id: before.parentId, status: before.status },
      after: { name: updated.name, parent_id: updated.parentId, status: updated.status },
    });
    return updated;
  }

  // -- barcodes ----------------------------------------------------------------

  async addBarcode(
    actorId: string,
    input: { itemId: string; uomId: string; code: string },
  ): Promise<store.BarcodeRow> {
    const item = await store.findItemById(input.itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new ItemNotFoundError(input.itemId);
    }
    const uom = await store.findUomById(input.uomId);
    if (uom === undefined) {
      throw new UomNotFoundError(input.uomId);
    }
    const existing = await store.findBarcodeByCode(input.code);
    if (existing !== undefined) {
      throw new BarcodeTakenError(input.code);
    }
    const row = await store.insertBarcode(input);
    await this.audit.record({
      action: "barcode.added",
      entityType: "item",
      entityId: input.itemId,
      actorId,
      after: { barcode_id: row.id, code: row.code },
    });
    return row;
  }

  async listBarcodes(itemId: string): Promise<store.BarcodeRow[]> {
    await this.get(itemId);
    return store.listBarcodes(itemId);
  }

  // -- search (T10; CommandMenu + ItemPicker surface) ---------------------------

  async search(q: string): Promise<store.ItemRow[]> {
    return store.searchItems(q);
  }

  /** Existence + kind read for opening-balance stock drafts (partners api). */
  async getItemForOpeningBalance(itemId: string): Promise<store.ItemRow | undefined> {
    const item = await store.findItemById(itemId);
    if (item === undefined || item.deletedAt !== null) {
      return undefined;
    }
    return item;
  }
}
