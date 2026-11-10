import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/items.store";
import type { ItemRow } from "../infrastructure/items.store";
import {
  ComponentDuplicateError,
  ComponentNotStockError,
  ComponentQtyInvalidError,
  ComponentSelfReferenceError,
  CompositeKindInvalidError,
  CompositeNotDefinedError,
  ItemNotFoundError,
} from "../domain/items-errors";

/**
 * Composite-product service (PHASE-015 T9; `items.composite_products`):
 * the component-definition maintenance for COMPOSITE-kind items plus the
 * explosion contract consumed by sale posting (`combo_explosion_at_posting`
 * — the restaurant manifest policy; the accounting rule: the COMPOSITE
 * line carries revenue/VAT, the COMPONENTS issue at their own cost, and
 * no stock move ever exists for the composite SKU itself).
 *
 * v1 constraints (FEATURE_CATALOG row): components must be STOCK items —
 * no nested explosion (a COMPOSITE inside a COMPOSITE is rejected at
 * definition time, not discovered at posting); the DB's CHECK constraints
 * (qty > 0, composite ≠ component, unique pair) are the second line of
 * defense behind these typed validations.
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;

/** One component line of a definition (the API payload shape). */
export interface ComponentDefinitionInput {
  componentItemId: string;
  qty: string;
}

/** The explosion contract's resolved component demand for a sale line. */
export interface ComponentDemand {
  componentItemId: string;
  componentSku: string;
  /** definition qty × the sale-line multiplier, 6dp exact. */
  qty: string;
  /** null in v1 — WAC/FIFO cost comes from the issue path itself. */
  unitCostHint: string | null;
}

/** Normalize + validate a qty against the shared decimal grammar. */
function normalizeQty(qty: string, error: (q: string) => Error): string {
  if (!QTY_RE.test(qty) || new Decimal(qty).lte(0)) {
    throw error(qty);
  }
  return new Decimal(qty).toDecimalPlaces(6).toFixed(6);
}

/**
 * Pure validation of a full-replace definition (unit-tested in
 * `__tests__/composites.spec.ts`): the caller fetches the rows, this
 * function enforces every rule and returns the normalized (6dp) rows —
 * so the service orchestration stays a thin store + audit shell.
 */
export function validateComponentDefinition(input: {
  composite: ItemRow;
  components: readonly ComponentDefinitionInput[];
  /** Fetched component rows keyed by id (missing ids surface as 404s). */
  componentItems: ReadonlyMap<string, ItemRow>;
}): { componentItemId: string; qty: string }[] {
  const { composite, components, componentItems } = input;
  if (composite.deletedAt !== null) {
    throw new ItemNotFoundError(composite.id);
  }
  if (composite.kind !== "COMPOSITE") {
    throw new CompositeKindInvalidError(composite.id, composite.kind);
  }
  const seen = new Set<string>();
  const normalized: { componentItemId: string; qty: string }[] = [];
  for (const component of components) {
    if (component.componentItemId === composite.id) {
      throw new ComponentSelfReferenceError(composite.id);
    }
    if (seen.has(component.componentItemId)) {
      throw new ComponentDuplicateError(component.componentItemId);
    }
    const qty = normalizeQty(component.qty, (q) => new ComponentQtyInvalidError(q));
    const item = componentItems.get(component.componentItemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new ItemNotFoundError(component.componentItemId);
    }
    if (item.kind !== "STOCK") {
      throw new ComponentNotStockError(component.componentItemId, item.kind);
    }
    seen.add(component.componentItemId);
    normalized.push({ componentItemId: component.componentItemId, qty });
  }
  return normalized;
}

/**
 * The explosion contract (consumed by the sales posting seam): resolve the
 * component list × the sale qty — a PURE resolution, no stock reads, no
 * writes. Throws `CompositeNotDefinedError` when no definition rows exist
 * (fail closed: a COMPOSITE line never silently skips its stock effect).
 */
export async function explodeForSale(
  compositeItemId: string,
  qty: string,
): Promise<ComponentDemand[]> {
  const multiplier = new Decimal(
    normalizeQty(qty, (q) => new ComponentQtyInvalidError(q)),
  );
  const definition = await store.listItemComponents(compositeItemId);
  if (definition.length === 0) {
    throw new CompositeNotDefinedError(compositeItemId);
  }
  return definition.map((row) => ({
    componentItemId: row.componentItemId,
    componentSku: row.componentSku,
    qty: new Decimal(row.qty).times(multiplier).toDecimalPlaces(6).toFixed(6),
    unitCostHint: null,
  }));
}

@Injectable()
export class CompositeService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The definition read (GET /items/:id/components). */
  async listComponents(itemId: string): Promise<store.ItemComponentRow[]> {
    const composite = await store.findItemById(itemId);
    if (composite === undefined || composite.deletedAt !== null) {
      throw new ItemNotFoundError(itemId);
    }
    if (composite.kind !== "COMPOSITE") {
      throw new CompositeKindInvalidError(itemId, composite.kind);
    }
    return store.listItemComponents(itemId);
  }

  /**
   * Full-replace definition write (PUT /items/:id/components) — idempotent
   * by construction: the same payload always lands the same rows. An empty
   * list clears the definition (selling then fails closed with
   * COMPOSITE_NOT_DEFINED at posting).
   */
  async setComponents(
    actorId: string,
    itemId: string,
    components: readonly ComponentDefinitionInput[],
  ): Promise<store.ItemComponentRow[]> {
    const composite = await store.findItemById(itemId);
    if (composite === undefined) {
      throw new ItemNotFoundError(itemId);
    }
    const componentItems = new Map<string, ItemRow>();
    for (const component of components) {
      if (!componentItems.has(component.componentItemId)) {
        const item = await store.findItemById(component.componentItemId);
        if (item !== undefined) {
          componentItems.set(component.componentItemId, item);
        }
      }
    }
    const normalized = validateComponentDefinition({ composite, components, componentItems });
    const before = await store.listItemComponents(itemId);
    await store.replaceItemComponents(
      itemId,
      normalized.map((row) => ({ componentItemId: row.componentItemId, qty: row.qty })),
    );
    await this.audit.record({
      action: "item.components_set",
      entityType: "item",
      entityId: itemId,
      actorId,
      before: { components: before.map((row) => ({ itemId: row.componentItemId, qty: row.qty })) },
      after: { components: normalized },
    });
    return store.listItemComponents(itemId);
  }
}
