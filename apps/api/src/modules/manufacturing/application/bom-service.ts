import { Inject, Injectable } from "@nestjs/common";
import { Decimal, InvalidValueError } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/manufacturing.store";
import type { BomRow } from "../infrastructure/manufacturing.store";
import {
  BomActiveExistsError,
  BomItemNotStockError,
  BomLineInvalidError,
  BomNotFoundError,
  BomNotActiveError,
  BomNotDraftError,
  BomSelfReferenceError,
  BomTooDeepError,
  BomUomMismatchError,
  BomVersionConflictError,
  BomYieldInvalidError,
  BomCycleError,
} from "../domain/manufacturing-errors";

/**
 * BOM service (PHASE-018 T38a; MASTER-PLAN §3/§7): versioned recipe
 * maintenance for one FG item — DRAFT → ACTIVE → ARCHIVED with exactly one
 * ACTIVE version per item (the partial unique index backs the invariant;
 * activate archives the previous ACTIVE version in the same call).
 * versionNo is monotonic per (tenant, item): max across ALL versions
 * (DRAFT included) + 1, so versions never renumber.
 *
 * The BOM never posts a journal and never touches stock — it is recipe data
 * (CAPABILITY_MATRIX §2.4 shape); only production orders (T38b) reach the
 * posting engine, binding the version and snapshotting the level-1 explosion
 * at release (the released order keeps ITS version even after a newer BOM
 * activates — the T38b order spec owns that proof).
 *
 * Explosion math (MASTER-PLAN §3, pinned by bom.spec):
 *   gross = round6( planned_qty × qty_per_output × (1 + scrap_pct/100) ÷ (yield_pct/100) )
 * composed level-by-level at 6dp — multi-level totals are the per-item sum
 * across levels (a raw material at several levels accumulates), with cycle
 * detection on the current chain and a 16-level depth cap. All math runs
 * through @erp/domain-core Decimal; no JS number arithmetic.
 */

const DECIMAL6_RE = /^\d+(\.\d{1,6})?$/;
const DECIMAL4_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The explosion depth cap (MASTER-PLAN §3): levels 1..16 walk, 17+ rejects. */
const MAX_EXPLOSION_DEPTH = 16;

/** Canonical 6dp, half-up (decimal.js default) — the explosion quantum. */
function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 23505 = unique_violation (PostgreSQL SQLSTATE); unwraps driver causes. */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

export interface BomLineInput {
  /** Preserved on the DRAFT full-replace (update); ignored on create. */
  id?: string | null;
  componentItemId: string;
  /** Per unit of FG output, in the component's base uom. > 0, ≤ 6dp. */
  qtyPerOutput: string;
  /** ≥ 0, ≤ 4dp. Defaults to 0. */
  scrapPct?: string | null;
  note?: string | null;
  noteAr?: string | null;
}

export interface CreateBomInput {
  itemId: string;
  /** Must equal the FG item's base uom (PHASE-018 has no conversion seam). */
  outputUomId: string;
  /** 0 < yield ≤ 100, ≤ 4dp (stored numeric(7,4); 80.0000 = 80%). */
  yieldPct: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
  lines: readonly BomLineInput[];
}

export interface UpdateBomInput {
  outputUomId?: string;
  yieldPct?: string;
  note?: string | null;
  noteAr?: string | null;
  /** Full line-set replace — DRAFT only; provided line ids are preserved. */
  lines?: readonly BomLineInput[];
  actorId: string | null;
}

/** A service-validated line (decimal strings normalized for the store). */
interface ValidatedLine {
  id: string | null;
  componentItemId: string;
  /** The component's base uom (from the validation read). */
  uomId: string;
  qtyPerOutput: string;
  scrapPct: string;
  note: string | null;
  noteAr: string | null;
}

export interface ExplosionLevelItem {
  itemId: string;
  sku: string;
  name: string;
  nameAr: string | null;
  /** The gross requirement at this level — canonical 6dp string. */
  qty: string;
  scrapPct: string;
  /** The yield of the BOM version that produced this line (4dp). */
  yieldPct: string;
  /** The semi-finished parent whose BOM produced this line; null on level 1. */
  viaSemiFinished: string | null;
}

export interface ExplosionResult {
  item: { id: string; sku: string; name: string; nameAr: string | null };
  /** The requested output quantity — canonical 6dp string. */
  outputQty: string;
  levels: { level: number; items: ExplosionLevelItem[] }[];
  /** Per-item sum across levels, itemId-ascending. */
  totals: { itemId: string; sku: string; qty: string }[];
}

@Injectable()
export class BomService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- reads -------------------------------------------------------------------

  async find(id: string): Promise<BomRow> {
    const bom = await store.findBomById(id);
    if (bom === undefined) throw new BomNotFoundError(id);
    return bom;
  }

  async findWithLines(id: string): Promise<BomRow & { lines: store.BomLineRow[] }> {
    const bom = await this.find(id);
    return { ...bom, lines: await store.listBomLines(id) };
  }

  async list(filter: { itemId?: string; status?: string; limit: number }): Promise<BomRow[]> {
    return store.listBoms(filter);
  }

  // -- create (DRAFT; versionNo monotonic per item) --------------------------------

  async create(input: CreateBomInput): Promise<BomRow> {
    const fg = await this.requireBomItem(input.itemId);
    if (fg.kind !== "STOCK") {
      throw new BomItemNotStockError(`the FG item of a BOM must be STOCK — ${fg.sku} is ${fg.kind}`);
    }
    if (fg.status !== "ACTIVE") {
      throw new BomItemNotStockError(`the FG item of a BOM must be ACTIVE — ${fg.sku} is ${fg.status}`);
    }
    this.assertOutputUom(input.outputUomId, fg);
    const yieldPct = this.canonicalYield(input.yieldPct);
    const lines = await this.validateLines(input.itemId, input.lines);

    const versions = await store.listBomsForItem(input.itemId);
    const versionNo = versions.reduce((max, row) => Math.max(max, row.versionNo), 0) + 1;
    let created: BomRow;
    try {
      created = await store.insertBom({
        itemId: input.itemId,
        versionNo,
        status: "DRAFT",
        outputUomId: input.outputUomId,
        yieldPct,
        effectiveFrom: null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: input.actorId,
        lines,
      });
    } catch (error) {
      // uq_bills_of_materials_tenant_item_version — a concurrent create won
      // the same (item, version) slot; the whole UoW rolls back.
      if (isUniqueViolation(error)) throw new BomVersionConflictError(input.itemId, versionNo);
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.bom.created",
      entityType: "bom",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        versionNo,
        status: "DRAFT",
        yieldPct,
        lines: lines.length,
      },
    });
    return created;
  }

  // -- DRAFT edits (PUT; full-replace) ---------------------------------------------

  async update(id: string, input: UpdateBomInput): Promise<BomRow> {
    const bom = await this.find(id);
    if (bom.status !== "DRAFT") {
      throw new BomNotDraftError(`bill of materials ${id} is ${bom.status} — only DRAFT versions accept edits`);
    }
    if (input.outputUomId !== undefined) {
      const fg = await this.requireBomItem(bom.itemId);
      this.assertOutputUom(input.outputUomId, fg);
    }
    let yieldPct: string | undefined;
    if (input.yieldPct !== undefined) {
      yieldPct = this.canonicalYield(input.yieldPct);
    }
    if (input.lines !== undefined) {
      const lines = await this.validateLines(bom.itemId, input.lines);
      for (const line of lines) {
        if (line.id === null) continue;
        const existing = await store.findBomLineById(line.id);
        if (existing === undefined || existing.bomId !== id) {
          throw new BomLineInvalidError(`line ${line.id} does not belong to bill of materials ${id}`);
        }
      }
      await store.replaceBomLines(id, lines);
    }
    await store.patchBom({
      id,
      outputUomId: input.outputUomId,
      yieldPct,
      note: input.note,
      noteAr: input.noteAr,
    });
    await this.audit.record({
      action: "manufacturing.bom.updated",
      entityType: "bom",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        fields: Object.keys(input).filter((key) => key !== "lines" && key !== "actorId"),
        linesReplaced: input.lines?.length ?? 0,
      },
    });
    return this.find(id);
  }

  // -- activate (DRAFT → ACTIVE; archives the previous ACTIVE in the same call) ----

  async activate(
    id: string,
    input: { effectiveFrom?: string | null; actorId: string | null },
  ): Promise<BomRow> {
    const bom = await this.find(id);
    if (bom.status !== "DRAFT") {
      throw new BomNotDraftError(`bill of materials ${id} is ${bom.status} — only DRAFT versions activate`);
    }
    const effectiveFrom =
      input.effectiveFrom !== undefined && input.effectiveFrom !== null
        ? input.effectiveFrom
        : today();
    if (!DATE_RE.test(effectiveFrom)) {
      throw new InvalidValueError(`effectiveFrom must be an ISO date (YYYY-MM-DD): ${effectiveFrom}`);
    }
    // One-active invariant: archive the previous ACTIVE version first, in
    // this same call/transaction — the partial unique index never trips on
    // our own writes; the 23505 catch below is the concurrent-activate race.
    const previous = await store.findActiveBom(bom.itemId);
    let archivedPrevious: { id: string; versionNo: number } | null = null;
    if (previous !== undefined && previous.id !== id) {
      await store.patchBom({ id: previous.id, status: "ARCHIVED" });
      archivedPrevious = { id: previous.id, versionNo: previous.versionNo };
    }
    try {
      await store.patchBom({ id, status: "ACTIVE", effectiveFrom });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BomActiveExistsError(bom.itemId, previous?.id ?? null);
      }
      throw error;
    }
    await this.audit.record({
      action: "manufacturing.bom.activated",
      entityType: "bom",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        status: "ACTIVE",
        effectiveFrom,
        archivedPrevious, // the archived-note detail (MASTER-PLAN handoff)
      },
    });
    return this.find(id);
  }

  // -- archive (ACTIVE → ARCHIVED) --------------------------------------------------

  async archive(id: string, input: { actorId: string | null }): Promise<BomRow> {
    const bom = await this.find(id);
    if (bom.status !== "ACTIVE") {
      throw new BomNotActiveError(`bill of materials ${id} is ${bom.status} — only ACTIVE versions archive`);
    }
    await store.patchBom({ id, status: "ARCHIVED" });
    await this.audit.record({
      action: "manufacturing.bom.archived",
      entityType: "bom",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { status: "ARCHIVED", versionNo: bom.versionNo },
    });
    return this.find(id);
  }

  // -- explosion (MASTER-PLAN §3; multi-level, cycle/depth-guarded) -----------------

  async explode(itemId: string, qty: string, bomId?: string | null): Promise<ExplosionResult> {
    if (!DECIMAL6_RE.test(qty) || Number(qty) <= 0) {
      throw new InvalidValueError(`explosion qty must be a positive decimal (≤ 6dp): ${qty}`);
    }
    const item = await this.requireBomItem(itemId);
    return this.explodeResolved(item, qty, bomId ?? null);
  }

  // -- validation helpers (shared by create + the DRAFT full-replace) --------------

  /** Exists, not deleted — the explosion/create/update FG read. */
  private async requireBomItem(itemId: string): Promise<store.BomItemRow> {
    const item = await store.findItemForBom(itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new BomNotFoundError(`item ${itemId} does not exist in this tenant`);
    }
    return item;
  }

  private assertOutputUom(outputUomId: string, fg: store.BomItemRow): void {
    if (outputUomId !== fg.baseUomId) {
      throw new BomUomMismatchError(
        `outputUomId must equal the FG item's base uom (${fg.sku}: ${fg.baseUomId}) — got ${outputUomId} (no UoM conversion seam in PHASE-018)`,
      );
    }
  }

  private canonicalYield(raw: string): string {
    if (!DECIMAL4_RE.test(raw)) {
      throw new BomYieldInvalidError(raw);
    }
    const value = new Decimal(raw);
    if (value.lessThanOrEqualTo(0) || value.greaterThan(100)) {
      throw new BomYieldInvalidError(raw);
    }
    return value.toFixed(4);
  }

  private async validateLines(fgItemId: string, lines: readonly BomLineInput[]): Promise<ValidatedLine[]> {
    if (lines.length < 1 || lines.length > 200) {
      throw new BomLineInvalidError(`a bill of materials carries 1..200 component lines — got ${lines.length}`);
    }
    const validated: ValidatedLine[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const position = index + 1;
      if (line.componentItemId === fgItemId) {
        throw new BomSelfReferenceError(fgItemId);
      }
      const component = await store.findItemForBom(line.componentItemId);
      if (component === undefined || component.deletedAt !== null) {
        throw new BomLineInvalidError(`line ${position}: component ${line.componentItemId} does not exist in this tenant`);
      }
      if (component.status !== "ACTIVE") {
        throw new BomLineInvalidError(`line ${position}: component ${component.sku} is ${component.status} and cannot go on a BOM`);
      }
      if (component.kind !== "STOCK") {
        throw new BomItemNotStockError(`line ${position}: component ${component.sku} is ${component.kind} — BOM components must be STOCK items`);
      }
      if (seen.has(component.id)) {
        throw new BomLineInvalidError(`line ${position}: duplicate component ${component.sku} — one line per component per version`);
      }
      seen.add(component.id);
      if (!DECIMAL6_RE.test(line.qtyPerOutput) || Number(line.qtyPerOutput) <= 0) {
        throw new BomLineInvalidError(`line ${position}: qtyPerOutput must be a positive decimal (≤ 6dp): ${line.qtyPerOutput}`);
      }
      const scrapRaw = line.scrapPct ?? "0";
      if (!DECIMAL4_RE.test(scrapRaw) || Number(scrapRaw) < 0) {
        throw new BomLineInvalidError(`line ${position}: scrapPct must be a non-negative decimal (≤ 4dp): ${scrapRaw}`);
      }
      validated.push({
        id: line.id ?? null,
        componentItemId: component.id,
        uomId: component.baseUomId,
        qtyPerOutput: new Decimal(line.qtyPerOutput).toFixed(6),
        scrapPct: new Decimal(scrapRaw).toFixed(4),
        note: line.note ?? null,
        noteAr: line.noteAr ?? null,
      });
    }
    return validated;
  }

  // -- the explosion walk (resolved-root shape) -------------------------------------

  private async explodeResolved(
    item: store.BomItemRow,
    qty: string,
    bomId: string | null,
  ): Promise<ExplosionResult> {
    // Resolve the root version: an explicit bomId wins (a what-if over a
    // DRAFT is legitimate); otherwise the item's ACTIVE version.
    let root: BomRow | undefined;
    if (bomId !== null) {
      root = await store.findBomById(bomId);
      if (root === undefined) {
        throw new BomNotFoundError(bomId);
      }
      if (root.itemId !== item.id) {
        throw new BomNotFoundError(`bill of materials ${bomId} is not a version of item ${item.id}`);
      }
    } else {
      root = await store.findActiveBom(item.id);
      if (root === undefined) {
        throw new BomNotFoundError(`item ${item.id} (${item.sku}) has no ACTIVE bill of materials`);
      }
    }

    const outputQty = new Decimal(qty).toFixed(6);
    const levels = new Map<number, ExplosionLevelItem[]>();
    const totals = new Map<string, { sku: string; qty: Decimal }>();

    await this.walkLevel(item.id, root, round6(new Decimal(qty)), 1, [item.id], levels, totals);

    const sortedLevels = [...levels.entries()]
      .map(([level, items]) => ({
        level,
        items: [...items].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)),
      }))
      .sort((a, b) => a.level - b.level);
    const sortedTotals = [...totals.entries()]
      .map(([itemId, entry]) => ({ itemId, sku: entry.sku, qty: entry.qty.toFixed(6) }))
      .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    return {
      item: { id: item.id, sku: item.sku, name: item.name, nameAr: item.nameAr },
      outputQty,
      levels: sortedLevels,
      totals: sortedTotals,
    };
  }

  /**
   * One level of the walk: `parentItem`'s BOM (`bom`) converts `plannedQty`
   * (the parent's gross requirement) into component gross quantities
   * (MASTER-PLAN §3); components that themselves have an ACTIVE version
   * recurse — their gross becomes the next level's planned qty. `path` is
   * the current chain (cycle detection); level > 16 rejects (BomTooDeep).
   */
  private async walkLevel(
    parentItemId: string,
    bom: BomRow,
    plannedQty: Decimal,
    level: number,
    path: readonly string[],
    levels: Map<number, ExplosionLevelItem[]>,
    totals: Map<string, { sku: string; qty: Decimal }>,
  ): Promise<void> {
    if (level > MAX_EXPLOSION_DEPTH) {
      throw new BomTooDeepError(MAX_EXPLOSION_DEPTH);
    }
    const lines = await store.listBomLines(bom.id);
    const yieldPct = new Decimal(bom.yieldPct);
    const yieldDivisor = yieldPct.div(100);
    for (const line of lines) {
      if (path.includes(line.componentItemId)) {
        throw new BomCycleError(path);
      }
      // gross = round6(planned × qtyPerOutput × (1 + scrap/100) ÷ (yield/100))
      const gross = round6(
        plannedQty
          .times(new Decimal(line.qtyPerOutput))
          .times(new Decimal(line.scrapPct).plus(100).div(100))
          .div(yieldDivisor),
      );
      const component = await store.findItemForBom(line.componentItemId);
      const entry = levels.get(level) ?? [];
      entry.push({
        itemId: line.componentItemId,
        sku: component?.sku ?? line.componentItemId,
        name: component?.name ?? line.componentItemId,
        nameAr: component?.nameAr ?? null,
        qty: gross.toFixed(6),
        scrapPct: line.scrapPct,
        yieldPct: bom.yieldPct,
        viaSemiFinished: level === 1 ? null : parentItemId,
      });
      levels.set(level, entry);
      const total = totals.get(line.componentItemId);
      if (total === undefined) {
        totals.set(line.componentItemId, { sku: component?.sku ?? line.componentItemId, qty: gross });
      } else {
        total.qty = total.qty.plus(gross);
      }
      const nested = await store.findActiveBom(line.componentItemId);
      if (nested !== undefined) {
        await this.walkLevel(
          line.componentItemId,
          nested,
          gross,
          level + 1,
          [...path, line.componentItemId],
          levels,
          totals,
        );
      }
    }
  }
}
