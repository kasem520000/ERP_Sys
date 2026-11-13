import { sql } from "drizzle-orm";

import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { UomConversionMissingError } from "../domain/inventory-errors";

/**
 * WMS store (PHASE-044, migrations 0067…0071): the ONLY writer of the
 * location tree, bin_contents, LPNs, the directed-ops family, cycle
 * counts, ABC, serial_movements, and the policy/job tables. Every
 * statement runs in the caller's ambient tenant UoW — the bin writes
 * ride the SAME transaction as the movement-core item_stock writes
 * (INV-029's same-transaction discipline; the movement core reaches
 * these helpers from its apply* steps).
 *
 * INV-029 (the reconciliation law): Σ bin_contents WHERE owner_partner_id
 * IS NULL = item_stock.qty per (tenant, warehouse, item) at all times.
 * Consignment rows (owner set) are the EXCLUDED set — they never touch
 * item_stock, valuation, or ATP (BR-076).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("wms access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- the location tree -----------------------------------------------------------

export interface ZoneRow {
  id: string;
  warehouseId: string;
  warehouseCode: string | null;
  code: string;
  name: string;
  nameAr: string | null;
  zoneType: string;
  isDefault: boolean;
  note: string | null;
}

const ZONE_COLUMNS = sql`z.id, z.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
  z.code, z.name, z.name_ar AS "nameAr", z.zone_type AS "zoneType",
  z.is_default AS "isDefault", z.note`;

export async function listZones(filter: {
  warehouseId?: string;
  limit: number;
}): Promise<ZoneRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ZONE_COLUMNS} FROM warehouse_zones z
    JOIN warehouses w ON w.id = z.warehouse_id AND w.tenant_id = z.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR z.warehouse_id = ${filter.warehouseId ?? null})
    ORDER BY z.warehouse_id, z.code
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as ZoneRow[];
}

export async function findZoneById(id: string): Promise<ZoneRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ZONE_COLUMNS} FROM warehouse_zones z
    JOIN warehouses w ON w.id = z.warehouse_id AND w.tenant_id = z.tenant_id
    WHERE z.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ZoneRow[])[0];
}

export async function findDefaultZone(warehouseId: string): Promise<ZoneRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ZONE_COLUMNS} FROM warehouse_zones z
    JOIN warehouses w ON w.id = z.warehouse_id AND w.tenant_id = z.tenant_id
    WHERE z.warehouse_id = ${warehouseId} AND z.is_default
    LIMIT 1
  `);
  return (rows.rows as unknown as ZoneRow[])[0];
}

export async function insertZone(input: {
  warehouseId: string;
  code: string;
  name: string;
  nameAr: string | null;
  zoneType: string;
  isDefault: boolean;
  note: string | null;
  createdBy: string | null;
}): Promise<ZoneRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO warehouse_zones (id, tenant_id, warehouse_id, code, name, name_ar,
                                 zone_type, is_default, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.code},
            ${input.name}, ${input.nameAr}, ${input.zoneType}, ${input.isDefault},
            ${input.note}, ${input.createdBy})
  `);
  return (await findZoneById(id))!;
}

export interface AisleRow {
  id: string;
  zoneId: string;
  code: string;
  name: string;
  nameAr: string | null;
}

export async function listAisles(zoneId: string): Promise<AisleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, zone_id AS "zoneId", code, name, name_ar AS "nameAr"
    FROM warehouse_aisles WHERE zone_id = ${zoneId} ORDER BY code
  `);
  return rows.rows as unknown as AisleRow[];
}

export async function findAisleById(id: string): Promise<AisleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, zone_id AS "zoneId", code, name, name_ar AS "nameAr"
    FROM warehouse_aisles WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as AisleRow[])[0];
}

export async function insertAisle(input: {
  zoneId: string;
  code: string;
  name: string;
  nameAr: string | null;
  createdBy: string | null;
}): Promise<AisleRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO warehouse_aisles (id, tenant_id, zone_id, code, name, name_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.zoneId}, ${input.code}, ${input.name},
            ${input.nameAr}, ${input.createdBy})
  `);
  return (await findAisleById(id))!;
}

export interface RackRow {
  id: string;
  aisleId: string;
  code: string;
  name: string;
  nameAr: string | null;
}

export async function listRacks(aisleId: string): Promise<RackRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, aisle_id AS "aisleId", code, name, name_ar AS "nameAr"
    FROM warehouse_racks WHERE aisle_id = ${aisleId} ORDER BY code
  `);
  return rows.rows as unknown as RackRow[];
}

export async function findRackById(id: string): Promise<RackRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, aisle_id AS "aisleId", code, name, name_ar AS "nameAr"
    FROM warehouse_racks WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RackRow[])[0];
}

export async function insertRack(input: {
  aisleId: string;
  code: string;
  name: string;
  nameAr: string | null;
  createdBy: string | null;
}): Promise<RackRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO warehouse_racks (id, tenant_id, aisle_id, code, name, name_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.aisleId}, ${input.code}, ${input.name},
            ${input.nameAr}, ${input.createdBy})
  `);
  return (await findRackById(id))!;
}

export interface BinRow {
  id: string;
  warehouseId: string;
  warehouseCode: string | null;
  rackId: string;
  code: string;
  barcode: string;
  name: string;
  nameAr: string | null;
  pickSequence: number | null;
  capacity: string | null;
  allowMixedBatches: boolean;
  isDefault: boolean;
  zoneId: string | null;
  zoneCode: string | null;
  zoneType: string | null;
  note: string | null;
}

const BIN_COLUMNS = sql`b.id, b.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
  b.rack_id AS "rackId", b.code, b.barcode, b.name, b.name_ar AS "nameAr",
  b.pick_sequence AS "pickSequence", b.capacity, b.allow_mixed_batches AS "allowMixedBatches",
  b.is_default AS "isDefault", z.id AS "zoneId", z.code AS "zoneCode", z.zone_type AS "zoneType",
  b.note`;
const BIN_FROM = sql`warehouse_bins b
  JOIN warehouses w ON w.id = b.warehouse_id AND w.tenant_id = b.tenant_id
  LEFT JOIN warehouse_aisles a ON a.id = b.rack_id AND a.tenant_id = b.tenant_id
  LEFT JOIN warehouse_racks r ON r.id = b.rack_id AND r.tenant_id = b.tenant_id
  LEFT JOIN warehouse_aisles a2 ON a2.id = r.aisle_id AND a2.tenant_id = r.tenant_id
  LEFT JOIN warehouse_zones z ON z.id = a2.zone_id AND z.tenant_id = a2.tenant_id`;

export async function listBins(filter: {
  warehouseId?: string;
  zoneId?: string;
  limit: number;
}): Promise<BinRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BIN_COLUMNS} FROM ${BIN_FROM}
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR b.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.zoneId ?? null}::uuid IS NULL OR z.id = ${filter.zoneId ?? null})
    ORDER BY b.warehouse_id, b.pick_sequence NULLS LAST, b.code
    LIMIT ${Math.min(filter.limit, 1000)}
  `);
  return rows.rows as unknown as BinRow[];
}

export async function findBinById(id: string): Promise<BinRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BIN_COLUMNS} FROM ${BIN_FROM} WHERE b.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BinRow[])[0];
}

export async function findBinByBarcode(barcode: string): Promise<BinRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BIN_COLUMNS} FROM ${BIN_FROM} WHERE b.barcode = ${barcode} LIMIT 1
  `);
  return (rows.rows as unknown as BinRow[])[0];
}

export async function findDefaultBin(warehouseId: string): Promise<BinRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BIN_COLUMNS} FROM ${BIN_FROM}
    WHERE b.warehouse_id = ${warehouseId} AND b.is_default LIMIT 1
  `);
  return (rows.rows as unknown as BinRow[])[0];
}

export async function insertBin(input: {
  warehouseId: string;
  rackId: string;
  code: string;
  barcode: string;
  name: string;
  nameAr: string | null;
  pickSequence: number | null;
  capacity: string | null;
  allowMixedBatches: boolean;
  isDefault: boolean;
  note: string | null;
  createdBy: string | null;
}): Promise<BinRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO warehouse_bins (id, tenant_id, warehouse_id, rack_id, code, barcode, name,
                                name_ar, pick_sequence, capacity, allow_mixed_batches,
                                is_default, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.rackId},
            ${input.code}, ${input.barcode}, ${input.name}, ${input.nameAr},
            ${input.pickSequence}, ${input.capacity}, ${input.allowMixedBatches},
            ${input.isDefault}, ${input.note}, ${input.createdBy})
  `);
  return (await findBinById(id))!;
}

/** Zone patch (name/type/default flag/note — code stays the scan-stable key). */
export async function updateZone(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    zoneType?: string;
    isDefault?: boolean;
    note?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouse_zones SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = COALESCE(${patch.nameAr ?? null}, name_ar),
      zone_type = COALESCE(${patch.zoneType ?? null}, zone_type),
      is_default = COALESCE(${patch.isDefault ?? null}, is_default),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/** Bin patch (display/sequence/capacity/mixed-batch rule — code + barcode
 * stay the scan-stable keys; capacity stays advisory for the putaway
 * engine, never a hard gate on explicit directed writes). */
export async function updateBin(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    pickSequence?: number | null;
    capacity?: string | null;
    allowMixedBatches?: boolean;
    note?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouse_bins SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = COALESCE(${patch.nameAr ?? null}, name_ar),
      pick_sequence = COALESCE(${patch.pickSequence ?? null}, pick_sequence),
      capacity = COALESCE(${patch.capacity ?? null}, capacity),
      allow_mixed_batches = COALESCE(${patch.allowMixedBatches ?? null}, allow_mixed_batches),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/**
 * The lazy default-bin anchor (D-5): warehouses created after 0071 get
 * their DEFAULT zone/aisle/rack/bin on the first bin-aware write — the
 * exact shape the migration seeded for existing warehouses.
 */
export async function ensureDefaultBin(warehouseId: string): Promise<BinRow> {
  const existing = await findDefaultBin(warehouseId);
  if (existing !== undefined) {
    return existing;
  }
  const warehouse = await tenantTx().execute<{ code: string }>(sql`
    SELECT code FROM warehouses WHERE id = ${warehouseId} LIMIT 1
  `);
  const whCode = warehouse.rows[0]?.code ?? "WH";
  let zone = await findDefaultZone(warehouseId);
  if (zone === undefined) {
    zone = await insertZone({
      warehouseId,
      code: "DEFAULT",
      name: "Default zone",
      nameAr: "المنطقة الافتراضية",
      zoneType: "PICKING",
      isDefault: true,
      note: null,
      createdBy: null,
    });
  }
  let aisle = (await listAisles(zone.id))[0];
  if (aisle === undefined) {
    aisle = await insertAisle({
      zoneId: zone.id,
      code: "A1",
      name: "Default aisle",
      nameAr: "الممر الافتراضي",
      createdBy: null,
    });
  }
  let rack = (await listRacks(aisle.id))[0];
  if (rack === undefined) {
    rack = await insertRack({
      aisleId: aisle.id,
      code: "R1",
      name: "Default rack",
      nameAr: "الرف الافتراضي",
      createdBy: null,
    });
  }
  return insertBin({
    warehouseId,
    rackId: rack.id,
    code: "DEFAULT",
    barcode: `BIN-${whCode.toUpperCase()}-DEFAULT`,
    name: "Default bin",
    nameAr: "الصندوق الافتراضي",
    pickSequence: 1,
    capacity: null,
    allowMixedBatches: true,
    isDefault: true,
    note: null,
    createdBy: null,
  });
}

// -- bin_contents (INV-029's subject) ---------------------------------------------

export interface BinContentRow {
  id: string;
  binId: string;
  binCode: string | null;
  warehouseId: string;
  itemId: string;
  itemSku: string | null;
  batchId: string | null;
  batchNo: string | null;
  serialId: string | null;
  serialNo: string | null;
  lpnId: string | null;
  lpnCode: string | null;
  ownerPartnerId: string | null;
  ownerPartnerName: string | null;
  status: string;
  qty: string;
  uomId: string | null;
  receivedAt: string;
  note: string | null;
}

const CONTENT_COLUMNS = sql`bc.id, bc.bin_id AS "binId", b.code AS "binCode",
  bc.warehouse_id AS "warehouseId", bc.item_id AS "itemId", i.sku AS "itemSku",
  bc.batch_id AS "batchId", bt.batch_no AS "batchNo", bc.serial_id AS "serialId",
  s.serial_no AS "serialNo", bc.lpn_id AS "lpnId", l.lpn_code AS "lpnCode",
  bc.owner_partner_id AS "ownerPartnerId", p.name AS "ownerPartnerName",
  bc.status, bc.qty, bc.uom_id AS "uomId", bc.received_at AS "receivedAt", bc.note`;
const CONTENT_FROM = sql`bin_contents bc
  JOIN warehouse_bins b ON b.id = bc.bin_id AND b.tenant_id = bc.tenant_id
  LEFT JOIN items i ON i.id = bc.item_id AND i.tenant_id = bc.tenant_id
  LEFT JOIN item_batches bt ON bt.id = bc.batch_id AND bt.tenant_id = bc.tenant_id
  LEFT JOIN item_serials s ON s.id = bc.serial_id AND s.tenant_id = bc.tenant_id
  LEFT JOIN lpns l ON l.id = bc.lpn_id AND l.tenant_id = bc.tenant_id
  LEFT JOIN partners p ON p.id = bc.owner_partner_id AND p.tenant_id = bc.tenant_id`;

export async function listBinContents(filter: {
  binId?: string;
  warehouseId?: string;
  itemId?: string;
  status?: string;
  ownerPartnerId?: string | null;
  /** T-06 (§2.5): the LPN-bound contents view — every row riding a plate. */
  lpnId?: string;
  limit: number;
}): Promise<BinContentRow[]> {
  const ownerFilter =
    filter.ownerPartnerId === undefined
      ? sql`TRUE`
      : filter.ownerPartnerId === null
        ? sql`bc.owner_partner_id IS NULL`
        : sql`bc.owner_partner_id = ${filter.ownerPartnerId}`;
  const rows = await tenantTx().execute(sql`
    SELECT ${CONTENT_COLUMNS} FROM ${CONTENT_FROM}
    WHERE (${filter.binId ?? null}::uuid IS NULL OR bc.bin_id = ${filter.binId ?? null})
      AND (${filter.warehouseId ?? null}::uuid IS NULL OR bc.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR bc.item_id = ${filter.itemId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR bc.status = ${filter.status ?? null})
      AND (${filter.lpnId ?? null}::uuid IS NULL OR bc.lpn_id = ${filter.lpnId ?? null})
      AND ${ownerFilter}
    ORDER BY bc.bin_id, bc.item_id, bc.received_at
    LIMIT ${Math.min(filter.limit, 1000)}
  `);
  return rows.rows as unknown as BinContentRow[];
}

/** The movement-core allocation source: matching rows for a slice. The
 * statuses filter defaults to AVAILABLE (the pickable floor — BR-072's
 * availability law); the quarantine board passes its own set. */
export async function listAllocatableBinContents(input: {
  warehouseId: string;
  itemId: string;
  batchId: string | null;
  serialId: string | null;
  statuses?: string[];
}): Promise<
  { id: string; binId: string; qty: string; status: string; lpnId: string | null; uomId: string | null }[]
> {
  const statuses = input.statuses ?? ["AVAILABLE"];
  // drizzle binds a raw JS array as ONE flattened param — the ARRAY[]
  // constructor with individually-bound literals is the injection-safe
  // shape (the custom-fields.store precedent).
  const statusArray = sql`ARRAY[${sql.join(
    statuses.map((s) => sql`${s}`),
    sql`, `,
  )}]::text[]`;
  const rows = await tenantTx().execute(sql`
    SELECT id, bin_id AS "binId", qty::text AS qty, status, lpn_id AS "lpnId", uom_id AS "uomId"
    FROM bin_contents
    WHERE warehouse_id = ${input.warehouseId}
      AND item_id = ${input.itemId}
      AND owner_partner_id IS NULL
      AND status = ANY(${statusArray})
      AND batch_id IS NOT DISTINCT FROM ${input.batchId}::uuid
      AND serial_id IS NOT DISTINCT FROM ${input.serialId}::uuid
    ORDER BY received_at, id
  `);
  return rows.rows as unknown as {
    id: string;
    binId: string;
    qty: string;
    status: string;
    lpnId: string | null;
    uomId: string | null;
  }[];
}

/**
 * T-09 (§2.9): the consignment allocation source — the OWNER's AVAILABLE
 * rows for (owner, warehouse, item), FIFO by received_at (the tenant rows
 * are never visible here — BR-076's exclusion runs both ways).
 */
export async function listOwnerRows(input: {
  ownerPartnerId: string;
  warehouseId: string;
  itemId: string;
}): Promise<{ id: string; binId: string; qty: string; serialId: string | null; status: string }[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, bin_id AS "binId", qty::text AS qty, serial_id AS "serialId", status
    FROM bin_contents
    WHERE owner_partner_id = ${input.ownerPartnerId}
      AND warehouse_id = ${input.warehouseId}
      AND item_id = ${input.itemId}
      AND status = 'AVAILABLE' AND qty > 0
    ORDER BY received_at, id
  `);
  return rows.rows as unknown as { id: string; binId: string; qty: string; serialId: string | null; status: string }[];
}

/** Does the item have ANY tenant-owned bin row in the warehouse? */
export async function hasAnyBinContent(warehouseId: string, itemId: string): Promise<boolean> {
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM bin_contents
    WHERE warehouse_id = ${warehouseId} AND item_id = ${itemId} AND owner_partner_id IS NULL
  `);
  return (rows.rows[0]?.n ?? 0) > 0;
}

/** The tenant-owned batch already sitting in a bin (the mixed-batch guard,
 * BR-072's §2.1 rule — one batch per no-mixed-batches bin). */
export async function findDistinctBatchInBin(binId: string): Promise<string | null> {
  const rows = await tenantTx().execute<{ batch_id: string | null }>(sql`
    SELECT batch_id FROM bin_contents
    WHERE bin_id = ${binId} AND batch_id IS NOT NULL AND owner_partner_id IS NULL
    LIMIT 1
  `);
  return rows.rows[0]?.batch_id ?? null;
}

/** One bin_contents row by id (the board + the transition paths). */
export async function findBinContentById(id: string): Promise<BinContentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CONTENT_COLUMNS} FROM ${CONTENT_FROM} WHERE bc.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BinContentRow[])[0];
}

/**
 * The slot's current UOM (NULLS NOT DISTINCT over the full slot key) —
 * the conversion anchor for addToBinSlot: an existing slot keeps its UOM
 * (the single-UOM-slot law, I-15); a new slot takes the incoming one.
 */
async function slotUomId(key: {
  binId: string;
  itemId: string;
  batchId: string | null;
  serialId: string | null;
  lpnId: string | null;
  ownerPartnerId: string | null;
  status: string;
}): Promise<string | null> {
  const rows = await tenantTx().execute<{ uom_id: string | null }>(sql`
    SELECT uom_id FROM bin_contents
    WHERE bin_id = ${key.binId}
      AND item_id = ${key.itemId}
      AND batch_id IS NOT DISTINCT FROM ${key.batchId}::uuid
      AND serial_id IS NOT DISTINCT FROM ${key.serialId}::uuid
      AND lpn_id IS NOT DISTINCT FROM ${key.lpnId}::uuid
      AND owner_partner_id IS NOT DISTINCT FROM ${key.ownerPartnerId}::uuid
      AND status = ${key.status}
    LIMIT 1
  `);
  return rows.rows[0]?.uom_id ?? null;
}

/**
 * Add qty to a bin slot (the receipt/settlement path): upserts the exact
 * (bin, item, batch, serial, LPN, owner, status) slot — NULLS NOT DISTINCT
 * makes the ON CONFLICT see NULL dimensions. UOM discipline (I-15): the
 * incoming qty converts into the SLOT's uom when the slot exists and the
 * uoms differ (the direct factor or the mirrored 1/factor through
 * uom_conversions; the slot stays single-UOM — the caller surfaces the
 * typed UomConversionMissingError before any write lands).
 */
export async function addToBinSlot(input: {
  binId: string;
  warehouseId: string;
  itemId: string;
  batchId: string | null;
  serialId: string | null;
  lpnId: string | null;
  ownerPartnerId: string | null;
  status: string;
  qty: string;
  uomId: string | null;
  receivedAt: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<{ qtyAdded: string; uomId: string | null; contentId: string }> {
  const slotUom = await slotUomId({
    binId: input.binId,
    itemId: input.itemId,
    batchId: input.batchId,
    serialId: input.serialId,
    lpnId: input.lpnId,
    ownerPartnerId: input.ownerPartnerId,
    status: input.status,
  });
  let qty = input.qty;
  let uomId = input.uomId;
  if (slotUom !== null && input.uomId !== null && slotUom !== input.uomId) {
    const conversion = await findUomConversion(input.uomId, slotUom);
    if (conversion === null) {
      throw new UomConversionMissingError(input.uomId, slotUom);
    }
    const factor = conversion.reverse
      ? new Decimal(1).div(new Decimal(conversion.factor))
      : new Decimal(conversion.factor);
    qty = new Decimal(input.qty)
      .times(factor)
      .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
      .toFixed(6);
    uomId = slotUom;
  }
  const upserted = await tenantTx().execute<{ id: string }>(sql`
    INSERT INTO bin_contents (id, tenant_id, bin_id, warehouse_id, item_id, batch_id,
                              serial_id, lpn_id, owner_partner_id, status, qty, uom_id,
                              received_at, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.binId}, ${input.warehouseId},
            ${input.itemId}, ${input.batchId}, ${input.serialId}, ${input.lpnId},
            ${input.ownerPartnerId}, ${input.status}, ${qty}, ${uomId},
            COALESCE(${input.receivedAt}::timestamptz, now()), ${input.note}, ${input.createdBy})
    ON CONFLICT (tenant_id, bin_id, item_id, batch_id, serial_id, lpn_id, owner_partner_id, status)
    DO UPDATE SET qty = bin_contents.qty + EXCLUDED.qty,
                  uom_id = COALESCE(bin_contents.uom_id, EXCLUDED.uom_id),
                  updated_at = now(),
                  version = bin_contents.version + 1
    RETURNING id
  `);
  return { qtyAdded: qty, uomId, contentId: upserted.rows[0]!.id };
}

/** Decrement a specific bin_contents row (the issue path — rows reaching 0
 * stay as the honest history floor). */
export async function decrementBinContent(id: string, qty: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE bin_contents
    SET qty = qty - ${qty}::numeric, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/** Move qty between slots of the same item (the status/board + LPN paths):
 * decrements the source row, adds to the target slot — returns the TARGET
 * row's id (the board's new state). */
export async function moveBetweenSlots(input: {
  fromContentId: string;
  qty: string;
  toBinId: string;
  toStatus: string;
  note: string | null;
}): Promise<string> {
  await tenantTx().execute(sql`
    UPDATE bin_contents
    SET qty = qty - ${input.qty}::numeric, updated_at = now(), version = version + 1
    WHERE id = ${input.fromContentId}
  `);
  const source = await tenantTx().execute<{
    warehouse_id: string;
    item_id: string;
    batch_id: string | null;
    serial_id: string | null;
    lpn_id: string | null;
    owner_partner_id: string | null;
    uom_id: string | null;
  }>(sql`
    SELECT warehouse_id, item_id, batch_id, serial_id, lpn_id, owner_partner_id, uom_id
    FROM bin_contents WHERE id = ${input.fromContentId}
  `);
  const row = source.rows[0];
  if (row === undefined) {
    throw new Error(`bin_contents row ${input.fromContentId} vanished mid-move`);
  }
  const added = await addToBinSlot({
    binId: input.toBinId,
    warehouseId: row.warehouse_id,
    itemId: row.item_id,
    batchId: row.batch_id,
    serialId: row.serial_id,
    lpnId: row.lpn_id,
    ownerPartnerId: row.owner_partner_id,
    status: input.toStatus,
    qty: input.qty,
    uomId: row.uom_id,
    receivedAt: null,
    note: input.note,
    createdBy: null,
  });
  return added.contentId;
}

/** The INV-029 probe: per (warehouse, item) folds — bins vs item_stock. */
export interface BinReconciliationRow {
  warehouseId: string;
  warehouseCode: string | null;
  itemId: string;
  itemSku: string | null;
  binQty: string;
  stockQty: string;
  difference: string;
}

export async function reconcileBins(filter: {
  warehouseId?: string;
}): Promise<BinReconciliationRow[]> {
  const rows = await tenantTx().execute(sql`
    WITH bins AS (
      SELECT warehouse_id, item_id, sum(qty) AS bin_qty
      FROM bin_contents
      WHERE owner_partner_id IS NULL
      GROUP BY warehouse_id, item_id
    ), stock AS (
      SELECT warehouse_id, item_id, qty AS stock_qty
      FROM item_stock
    )
    SELECT COALESCE(b.warehouse_id, s.warehouse_id) AS "warehouseId",
           w.code AS "warehouseCode",
           COALESCE(b.item_id, s.item_id) AS "itemId",
           i.sku AS "itemSku",
           COALESCE(b.bin_qty, 0)::text AS "binQty",
           COALESCE(s.stock_qty, 0)::text AS "stockQty",
           (COALESCE(b.bin_qty, 0) - COALESCE(s.stock_qty, 0))::text AS "difference"
    FROM bins b
    FULL OUTER JOIN stock s ON s.warehouse_id = b.warehouse_id AND s.item_id = b.item_id
    LEFT JOIN warehouses w ON w.id = COALESCE(b.warehouse_id, s.warehouse_id) AND w.tenant_id = erp.current_tenant_id()
    LEFT JOIN items i ON i.id = COALESCE(b.item_id, s.item_id) AND i.tenant_id = erp.current_tenant_id()
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL
             OR COALESCE(b.warehouse_id, s.warehouse_id) = ${filter.warehouseId ?? null}::uuid)
      AND COALESCE(b.bin_qty, 0) <> COALESCE(s.stock_qty, 0)
    ORDER BY "difference" DESC
  `);
  return rows.rows as unknown as BinReconciliationRow[];
}

/**
 * PHASE-044 T-20 — the legacy-stock backfill (§7's mitigation): every
 * (warehouse, item) where item_stock EXCEEDS Σ tenant-owned bin_contents
 * (the pre-WMS residue: stock that predates the bin substrate). The
 * backfill lands the shortfall on the warehouse's DEFAULT bin; a SURPLUS
 * (bins > stock) is genuine drift the backfill never touches.
 */
export interface BinBackfillRow {
  warehouseId: string;
  warehouseCode: string | null;
  itemId: string;
  itemSku: string | null;
  binQty: string;
  stockQty: string;
  shortfall: string;
}

export async function listBinShortfalls(): Promise<BinBackfillRow[]> {
  const rows = await tenantTx().execute(sql`
    WITH bins AS (
      SELECT warehouse_id, item_id, sum(qty) AS bin_qty
      FROM bin_contents
      WHERE owner_partner_id IS NULL
      GROUP BY warehouse_id, item_id
    )
    SELECT s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
           s.item_id AS "itemId", i.sku AS "itemSku",
           COALESCE(b.bin_qty, 0)::text AS "binQty",
           s.qty::text AS "stockQty",
           (s.qty - COALESCE(b.bin_qty, 0))::text AS shortfall
    FROM item_stock s
    LEFT JOIN bins b ON b.warehouse_id = s.warehouse_id AND b.item_id = s.item_id
    LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = erp.current_tenant_id()
    LEFT JOIN items i ON i.id = s.item_id AND i.tenant_id = erp.current_tenant_id()
    WHERE s.qty > COALESCE(b.bin_qty, 0)
    ORDER BY w.code, i.sku
  `);
  return rows.rows as unknown as BinBackfillRow[];
}

/** Insert one backfill row onto a bin (the uq_bin_contents_slot shape — a
 * single AVAILABLE, tenant-owned, batch-less, LPN-less row per slot). */
export async function insertBackfillContent(input: {
  binId: string;
  warehouseId: string;
  itemId: string;
  qty: string;
  note: string;
  createdBy: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO bin_contents
      (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
       lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.binId}, ${input.warehouseId},
            ${input.itemId}, NULL, NULL, NULL, NULL, 'AVAILABLE', ${input.qty},
            NULL, now(), ${input.note}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "bin_id", "item_id", "batch_id", "serial_id",
                 "lpn_id", "owner_partner_id", "status")
    DO UPDATE SET qty = bin_contents.qty + EXCLUDED.qty, updated_at = now()
    RETURNING id
  `);
  return id;
}

/** Available-to-promise at bin level: AVAILABLE, tenant-owned rows only. */
export async function availableQtyByBin(filter: {
  warehouseId: string;
  itemId: string;
}): Promise<{ binId: string; qty: string }[]> {
  const rows = await tenantTx().execute(sql`
    SELECT bin_id AS "binId", sum(qty)::text AS qty
    FROM bin_contents
    WHERE warehouse_id = ${filter.warehouseId}
      AND item_id = ${filter.itemId}
      AND status = 'AVAILABLE'
      AND owner_partner_id IS NULL
    GROUP BY bin_id
    ORDER BY sum(qty) DESC
  `);
  return rows.rows as unknown as { binId: string; qty: string }[];
}

// -- LPNs -------------------------------------------------------------------------

export interface LpnRow {
  id: string;
  lpnCode: string;
  status: string;
  closedAt: string | null;
  note: string | null;
}

export async function listLpns(filter: { status?: string; limit: number }): Promise<LpnRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, lpn_code AS "lpnCode", status, closed_at AS "closedAt", note
    FROM lpns
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as LpnRow[];
}

export async function findLpnById(id: string): Promise<LpnRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, lpn_code AS "lpnCode", status, closed_at AS "closedAt", note
    FROM lpns WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as LpnRow[])[0];
}

export async function findLpnByCode(code: string): Promise<LpnRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, lpn_code AS "lpnCode", status, closed_at AS "closedAt", note
    FROM lpns WHERE lpn_code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as LpnRow[])[0];
}

export async function insertLpn(input: {
  lpnCode: string;
  note: string | null;
  createdBy: string | null;
}): Promise<LpnRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO lpns (id, tenant_id, lpn_code, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.lpnCode}, ${input.note}, ${input.createdBy})
  `);
  return (await findLpnById(id))!;
}

export async function closeLpn(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE lpns SET status = 'CLOSED', closed_at = now(), updated_at = now(),
                    version = version + 1
    WHERE id = ${id} AND status = 'ACTIVE'
  `);
}

/** Bind a bin_contents row to an LPN (the move-by-LPN substrate). */
export async function bindContentToLpn(contentId: string, lpnId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE bin_contents SET lpn_id = ${lpnId}, updated_at = now(), version = version + 1
    WHERE id = ${contentId}
  `);
}

/**
 * Move every row of an LPN into a target bin (move-by-LPN, T-06 §2.5):
 * each row KEEPS ITS OWN STATUS — a QUARANTINE pallet stays quarantined
 * at the new slot (the structural move never changes the control state;
 * only the T-08 board's dispositions release it).
 */
export async function moveLpnContents(input: {
  lpnId: string;
  toBinId: string;
  note: string | null;
}): Promise<number> {
  const contents = await tenantTx().execute<{ id: string; qty: string; status: string }>(sql`
    SELECT id, qty::text, status FROM bin_contents WHERE lpn_id = ${input.lpnId} AND qty > 0
  `);
  for (const row of contents.rows as unknown as { id: string; qty: string; status: string }[]) {
    await moveBetweenSlots({
      fromContentId: row.id,
      qty: row.qty,
      toBinId: input.toBinId,
      toStatus: row.status,
      note: input.note,
    });
  }
  return (contents.rows as unknown as unknown[]).length;
}

// -- serial_movements (T-11's ledger) ----------------------------------------------

export type SerialMovementEvent =
  | "RECEIVE"
  | "PUTAWAY"
  | "PICK"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "ADJUST_OUT"
  | "ADJUST_IN"
  | "RETURN"
  | "QUARANTINE"
  | "RELEASE"
  | "SCRAP"
  | "CONSIGNMENT_IN"
  | "CONSIGNMENT_OUT"
  | "KIT_IN"
  | "KIT_OUT"
  | "SETTLE";

export async function appendSerialMovement(input: {
  serialId: string;
  event: SerialMovementEvent;
  moveId: string | null;
  sourceType: string;
  sourceId: string;
  fromBinId: string | null;
  toBinId: string | null;
  movedAt: string;
  note: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO serial_movements (id, tenant_id, serial_id, event, move_id, source_type,
                                  source_id, from_bin_id, to_bin_id, moved_at, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.serialId}, ${input.event},
            ${input.moveId}, ${input.sourceType}, ${input.sourceId}, ${input.fromBinId},
            ${input.toBinId}, ${input.movedAt}::timestamptz, ${input.note}, ${input.createdBy})
  `);
}

export interface SerialLedgerRow {
  id: string;
  serialId: string;
  serialNo: string | null;
  itemSku: string | null;
  event: string;
  moveId: string | null;
  sourceType: string;
  sourceId: string;
  fromBinId: string | null;
  fromBinCode: string | null;
  toBinId: string | null;
  toBinCode: string | null;
  movedAt: string;
  note: string | null;
}

export async function listSerialMovements(filter: {
  serialId?: string;
  itemId?: string;
  limit: number;
}): Promise<SerialLedgerRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT sm.id, sm.serial_id AS "serialId", s.serial_no AS "serialNo", i.sku AS "itemSku",
           sm.event, sm.move_id AS "moveId", sm.source_type AS "sourceType",
           sm.source_id AS "sourceId", sm.from_bin_id AS "fromBinId",
           fb.code AS "fromBinCode", sm.to_bin_id AS "toBinId", tb.code AS "toBinCode",
           sm.moved_at AS "movedAt", sm.note
    FROM serial_movements sm
    LEFT JOIN item_serials s ON s.id = sm.serial_id AND s.tenant_id = sm.tenant_id
    LEFT JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
    LEFT JOIN warehouse_bins fb ON fb.id = sm.from_bin_id AND fb.tenant_id = sm.tenant_id
    LEFT JOIN warehouse_bins tb ON tb.id = sm.to_bin_id AND tb.tenant_id = sm.tenant_id
    WHERE (${filter.serialId ?? null}::uuid IS NULL OR sm.serial_id = ${filter.serialId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR s.item_id = ${filter.itemId ?? null})
    ORDER BY sm.moved_at DESC, sm.id
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as SerialLedgerRow[];
}

// -- UOM conversion (I-15) ----------------------------------------------------------

/**
 * The I-15 auto-conversion source: the DIRECT factor from→to (identical
 * uoms = "1"); the REVERSE factor when only the mirror row exists
 * (returned as { reverse: true } — the service does the 1/x with the
 * Decimal type per ADR-0009); null when no conversion row exists either
 * way (the typed UomConversionMissingError is the caller's).
 */
export async function findUomConversion(
  fromUomId: string,
  toUomId: string,
): Promise<{ factor: string; reverse: boolean } | null> {
  if (fromUomId === toUomId) {
    return { factor: "1", reverse: false };
  }
  const direct = await tenantTx().execute<{ factor: string }>(sql`
    SELECT factor::text FROM uom_conversions
    WHERE from_uom_id = ${fromUomId} AND to_uom_id = ${toUomId} LIMIT 1
  `);
  if (direct.rows[0] !== undefined) {
    return { factor: direct.rows[0].factor, reverse: false };
  }
  const mirror = await tenantTx().execute<{ factor: string }>(sql`
    SELECT factor::text FROM uom_conversions
    WHERE from_uom_id = ${toUomId} AND to_uom_id = ${fromUomId} LIMIT 1
  `);
  if (mirror.rows[0] !== undefined) {
    return { factor: mirror.rows[0].factor, reverse: true };
  }
  return null;
}

// -- putaway rules (T-04, §2.3; I-03/PP-12) ----------------------------------------

export interface PutawayRuleRow {
  id: string;
  priority: number;
  name: string;
  condition: Record<string, unknown>;
  targetZoneType: string | null;
  targetBinId: string | null;
  targetBinCode: string | null;
  isActive: boolean;
  note: string | null;
}

export async function listPutawayRules(filter: {
  activeOnly?: boolean;
}): Promise<PutawayRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id, r.priority, r.name, r.condition, r.target_zone_type AS "targetZoneType",
           r.target_bin_id AS "targetBinId", b.code AS "targetBinCode",
           r.is_active AS "isActive", r.note
    FROM putaway_rules r
    LEFT JOIN warehouse_bins b ON b.id = r.target_bin_id AND b.tenant_id = r.tenant_id
    WHERE (${filter.activeOnly ?? false} = false OR r.is_active)
    ORDER BY r.priority
  `);
  return rows.rows as unknown as PutawayRuleRow[];
}

export async function findPutawayRuleById(id: string): Promise<PutawayRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id, r.priority, r.name, r.condition, r.target_zone_type AS "targetZoneType",
           r.target_bin_id AS "targetBinId", b.code AS "targetBinCode",
           r.is_active AS "isActive", r.note
    FROM putaway_rules r
    LEFT JOIN warehouse_bins b ON b.id = r.target_bin_id AND b.tenant_id = r.tenant_id
    WHERE r.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PutawayRuleRow[])[0];
}

export async function insertPutawayRule(input: {
  priority: number;
  name: string;
  condition: Record<string, unknown>;
  targetZoneType: string | null;
  targetBinId: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<PutawayRuleRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO putaway_rules (id, tenant_id, priority, name, condition,
                               target_zone_type, target_bin_id, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.priority}, ${input.name},
            ${JSON.stringify(input.condition)}::jsonb, ${input.targetZoneType},
            ${input.targetBinId}, ${input.note}, ${input.createdBy})
  `);
  return (await findPutawayRuleById(id))!;
}

export async function updatePutawayRule(
  id: string,
  patch: {
    name?: string;
    condition?: Record<string, unknown>;
    targetZoneType?: string | null;
    targetBinId?: string | null;
    isActive?: boolean;
    note?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE putaway_rules SET
      name = COALESCE(${patch.name ?? null}, name),
      condition = COALESCE(${patch.condition === undefined ? null : JSON.stringify(patch.condition)}::jsonb, condition),
      target_zone_type = COALESCE(${patch.targetZoneType ?? null}, target_zone_type),
      target_bin_id = COALESCE(${patch.targetBinId ?? null}, target_bin_id),
      is_active = COALESCE(${patch.isActive ?? null}, is_active),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/**
 * The zone-type suggestion source (§2.3): every bin of the warehouse whose
 * zone carries the requested type, EMPTIEST first (Σ contents qty asc,
 * never-bused NULLs first), then pick_sequence — the "prefer empty faces"
 * heuristic. Capacity stays advisory (never a hard gate on directed ops).
 */
export async function listBinsByZoneType(
  warehouseId: string,
  zoneType: string,
): Promise<(BinRow & { contentsQty: string })[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BIN_COLUMNS}, COALESCE(c.contents_qty, 0)::text AS "contentsQty"
    FROM ${BIN_FROM}
    LEFT JOIN LATERAL (
      SELECT sum(qty) AS contents_qty FROM bin_contents
      WHERE bin_id = b.id AND tenant_id = b.tenant_id
    ) c ON true
    WHERE b.warehouse_id = ${warehouseId} AND z.zone_type = ${zoneType}
    ORDER BY COALESCE(c.contents_qty, 0) ASC, b.pick_sequence NULLS LAST, b.code
  `);
  return rows.rows as unknown as (BinRow & { contentsQty: string })[];
}

// -- pick tasks (T-04 putaway + T-05 picking; §2.4; PP-11/OA-02) ---------------------

export interface PickTaskRow {
  id: string;
  waveId: string | null;
  waveNo: string | null;
  taskKind: "PICK" | "PUTAWAY";
  status: string;
  assigneeUserId: string | null;
  itemId: string;
  itemSku: string | null;
  itemName: string | null;
  batchId: string | null;
  batchNo: string | null;
  serialId: string | null;
  serialNo: string | null;
  lpnId: string | null;
  lpnCode: string | null;
  qty: string;
  qtyDone: string;
  fromBinId: string | null;
  fromBinCode: string | null;
  toBinId: string | null;
  toBinCode: string | null;
  sourceType: string;
  sourceId: string;
  sourceLineNo: number | null;
  scanVerified: boolean;
  sequenceNo: number | null;
  completedAt: string | null;
  completedBy: string | null;
  note: string | null;
  createdAt: string;
  version: number;
}

const TASK_COLUMNS = sql`t.id, t.wave_id AS "waveId", w.wave_no AS "waveNo",
  t.task_kind AS "taskKind", t.status, t.assignee_user_id AS "assigneeUserId",
  t.item_id AS "itemId", i.sku AS "itemSku", i.name AS "itemName",
  t.batch_id AS "batchId", bt.batch_no AS "batchNo", t.serial_id AS "serialId",
  s.serial_no AS "serialNo", t.lpn_id AS "lpnId", l.lpn_code AS "lpnCode",
  t.qty::text AS qty, t.qty_done::text AS "qtyDone",
  t.from_bin_id AS "fromBinId", fb.code AS "fromBinCode",
  t.to_bin_id AS "toBinId", tb.code AS "toBinCode",
  t.source_type AS "sourceType", t.source_id AS "sourceId",
  t.source_line_no AS "sourceLineNo", t.scan_verified AS "scanVerified",
  t.sequence_no AS "sequenceNo", t.completed_at AS "completedAt",
  t.completed_by AS "completedBy", t.note, t.created_at AS "createdAt", t.version`;
const TASK_FROM = sql`pick_tasks t
  LEFT JOIN pick_waves w ON w.id = t.wave_id AND w.tenant_id = t.tenant_id
  JOIN items i ON i.id = t.item_id AND i.tenant_id = t.tenant_id
  LEFT JOIN item_batches bt ON bt.id = t.batch_id AND bt.tenant_id = t.tenant_id
  LEFT JOIN item_serials s ON s.id = t.serial_id AND s.tenant_id = t.tenant_id
  LEFT JOIN lpns l ON l.id = t.lpn_id AND l.tenant_id = t.tenant_id
  LEFT JOIN warehouse_bins fb ON fb.id = t.from_bin_id AND fb.tenant_id = t.tenant_id
  LEFT JOIN warehouse_bins tb ON tb.id = t.to_bin_id AND tb.tenant_id = t.tenant_id`;

export async function listPickTasks(filter: {
  taskKind?: string;
  status?: string;
  waveId?: string;
  assigneeUserId?: string;
  sourceType?: string;
  sourceId?: string;
  limit?: number;
}): Promise<PickTaskRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TASK_COLUMNS} FROM ${TASK_FROM}
    WHERE (${filter.taskKind ?? null}::text IS NULL OR t.task_kind = ${filter.taskKind ?? null})
      AND (${filter.status ?? null}::text IS NULL OR t.status = ${filter.status ?? null})
      AND (${filter.waveId ?? null}::uuid IS NULL OR t.wave_id = ${filter.waveId ?? null})
      AND (${filter.assigneeUserId ?? null}::uuid IS NULL OR t.assignee_user_id = ${filter.assigneeUserId ?? null})
      AND (${filter.sourceType ?? null}::text IS NULL OR t.source_type = ${filter.sourceType ?? null})
      AND (${filter.sourceId ?? null}::uuid IS NULL OR t.source_id = ${filter.sourceId ?? null})
    ORDER BY t.sequence_no NULLS LAST, t.created_at, t.id
    LIMIT ${Math.min(filter.limit ?? 200, 500)}
  `);
  return rows.rows as unknown as PickTaskRow[];
}

export async function findPickTaskById(id: string): Promise<PickTaskRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TASK_COLUMNS} FROM ${TASK_FROM} WHERE t.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PickTaskRow[])[0];
}

export async function insertPickTask(input: {
  taskKind: "PICK" | "PUTAWAY";
  itemId: string;
  qty: string;
  fromBinId: string | null;
  toBinId: string | null;
  sourceType: string;
  sourceId: string;
  sourceLineNo: number | null;
  batchId?: string | null;
  serialId?: string | null;
  lpnId?: string | null;
  waveId?: string | null;
  sequenceNo?: number | null;
  note?: string | null;
  createdBy: string | null;
}): Promise<PickTaskRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO pick_tasks (id, tenant_id, task_kind, item_id, batch_id, serial_id, lpn_id,
                            qty, from_bin_id, to_bin_id, source_type, source_id,
                            source_line_no, wave_id, sequence_no, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.taskKind}, ${input.itemId},
            ${input.batchId ?? null}, ${input.serialId ?? null}, ${input.lpnId ?? null},
            ${input.qty}, ${input.fromBinId}, ${input.toBinId}, ${input.sourceType},
            ${input.sourceId}, ${input.sourceLineNo}, ${input.waveId ?? null},
            ${input.sequenceNo ?? null}, ${input.note ?? null}, ${input.createdBy})
  `);
  return (await findPickTaskById(id))!;
}

/** Task transition + evidence stamps (the ck_pick_tasks_state_evidence floor). */
export async function updatePickTask(
  id: string,
  patch: {
    status?: string;
    assigneeUserId?: string | null;
    qtyDone?: string;
    scanVerified?: boolean;
    completedAt?: string | null;
    completedBy?: string | null;
    sequenceNo?: number | null;
    note?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE pick_tasks SET
      status = COALESCE(${patch.status ?? null}, status),
      assignee_user_id = COALESCE(${patch.assigneeUserId ?? null}, assignee_user_id),
      qty_done = COALESCE(${patch.qtyDone ?? null}, qty_done),
      scan_verified = COALESCE(${patch.scanVerified ?? null}, scan_verified),
      completed_at = COALESCE(${patch.completedAt ?? null}, completed_at),
      completed_by = COALESCE(${patch.completedBy ?? null}, completed_by),
      sequence_no = COALESCE(${patch.sequenceNo ?? null}, sequence_no),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- pick waves + strategies (T-05, §2.4; I-04/I-06/I-07) ----------------------------

export interface PickWaveRow {
  id: string;
  waveNo: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  status: string;
  method: string | null;
  routeNote: string | null;
  releasedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export async function listPickWaves(filter: {
  warehouseId?: string;
  status?: string;
  limit?: number;
}): Promise<PickWaveRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT w.id, w.wave_no AS "waveNo", w.warehouse_id AS "warehouseId",
           wh.code AS "warehouseCode", w.status, w.method, w.route_note AS "routeNote",
           w.released_at AS "releasedAt", w.completed_at AS "completedAt", w.created_at AS "createdAt"
    FROM pick_waves w
    JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.tenant_id = w.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR w.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR w.status = ${filter.status ?? null})
    ORDER BY w.created_at DESC, w.id
    LIMIT ${Math.min(filter.limit ?? 100, 300)}
  `);
  return rows.rows as unknown as PickWaveRow[];
}

export async function findPickWaveById(id: string): Promise<PickWaveRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT w.id, w.wave_no AS "waveNo", w.warehouse_id AS "warehouseId",
           wh.code AS "warehouseCode", w.status, w.method, w.route_note AS "routeNote",
           w.released_at AS "releasedAt", w.completed_at AS "completedAt", w.created_at AS "createdAt"
    FROM pick_waves w
    JOIN warehouses wh ON wh.id = w.warehouse_id AND wh.tenant_id = w.tenant_id
    WHERE w.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PickWaveRow[])[0];
}

export async function insertPickWave(input: {
  warehouseId: string;
  method: string | null;
  routeNote: string | null;
  createdBy: string | null;
}): Promise<PickWaveRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO pick_waves (id, tenant_id, warehouse_id, method, route_note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.method},
            ${input.routeNote}, ${input.createdBy})
  `);
  return (await findPickWaveById(id))!;
}

/** The state-evidence stamp flip (the ck_pick_waves_state_evidence floor). */
export async function updatePickWave(
  id: string,
  patch: {
    status?: string;
    waveNo?: string | null;
    method?: string | null;
    routeNote?: string | null;
    releasedAt?: string | null;
    releasedBy?: string | null;
    completedAt?: string | null;
    completedBy?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE pick_waves SET
      status = COALESCE(${patch.status ?? null}, status),
      wave_no = COALESCE(${patch.waveNo ?? null}, wave_no),
      method = COALESCE(${patch.method ?? null}, method),
      route_note = COALESCE(${patch.routeNote ?? null}, route_note),
      released_at = COALESCE(${patch.releasedAt ?? null}, released_at),
      released_by = COALESCE(${patch.releasedBy ?? null}, released_by),
      completed_at = COALESCE(${patch.completedAt ?? null}, completed_at),
      completed_by = COALESCE(${patch.completedBy ?? null}, completed_by),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

export interface PickStrategyRow {
  id: string;
  warehouseId: string;
  method: "FIFO" | "FEFO" | "NEAREST";
  allowPartial: boolean;
}

export async function findPickStrategy(warehouseId: string): Promise<PickStrategyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, warehouse_id AS "warehouseId", method, allow_partial AS "allowPartial"
    FROM pick_strategies WHERE warehouse_id = ${warehouseId} LIMIT 1
  `);
  return (rows.rows as unknown as PickStrategyRow[])[0];
}

export async function upsertPickStrategyRow(input: {
  warehouseId: string;
  method: "FIFO" | "FEFO" | "NEAREST";
  allowPartial: boolean;
  createdBy: string | null;
}): Promise<PickStrategyRow> {
  await tenantTx().execute(sql`
    INSERT INTO pick_strategies (id, tenant_id, warehouse_id, method, allow_partial, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.warehouseId},
            ${input.method}, ${input.allowPartial}, ${input.createdBy})
    ON CONFLICT (tenant_id, warehouse_id)
    DO UPDATE SET method = EXCLUDED.method, allow_partial = EXCLUDED.allow_partial,
                  updated_at = now(), version = pick_strategies.version + 1
  `);
  return (await findPickStrategy(input.warehouseId))!;
}

/**
 * The strategy-ordered allocation source (§2.4): the item's AVAILABLE,
 * tenant-owned rows with the batch dims — FIFO (received_at), FEFO (batch
 * expiry, earliest first — NULL expiries LAST, they never expire), or
 * NEAREST (the bin's pick_sequence, then received_at).
 */
export async function listPickableRows(input: {
  warehouseId: string;
  itemId: string;
  method: "FIFO" | "FEFO" | "NEAREST";
}): Promise<
  { id: string; binId: string; binCode: string | null; qty: string; batchId: string | null; expiryDate: string | null }[]
> {
  const order =
    input.method === "FEFO"
      ? sql`bt.expiry_date NULLS LAST, bc.received_at, bc.id`
      : input.method === "NEAREST"
        ? sql`b.pick_sequence NULLS LAST, b.code, bc.received_at, bc.id`
        : sql`bc.received_at, bc.id`;
  const rows = await tenantTx().execute(sql`
    SELECT bc.id, bc.bin_id AS "binId", b.code AS "binCode", bc.qty::text AS qty,
           bc.batch_id AS "batchId", bt.expiry_date::text AS "expiryDate"
    FROM bin_contents bc
    JOIN warehouse_bins b ON b.id = bc.bin_id AND b.tenant_id = bc.tenant_id
    LEFT JOIN item_batches bt ON bt.id = bc.batch_id AND bt.tenant_id = bc.tenant_id
    WHERE bc.warehouse_id = ${input.warehouseId}
      AND bc.item_id = ${input.itemId}
      AND bc.owner_partner_id IS NULL
      AND bc.status = 'AVAILABLE'
      AND bc.qty > 0
    ORDER BY ${order}
  `);
  return rows.rows as unknown as {
    id: string;
    binId: string;
    binCode: string | null;
    qty: string;
    batchId: string | null;
    expiryDate: string | null;
  }[];
}

/** The cluster route: the wave's open tasks ordered by the from-bin's pick
 * sequence (one walk, every order — the multi-order cluster discipline). */
export async function listWaveRouteTasks(waveId: string): Promise<PickTaskRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TASK_COLUMNS} FROM ${TASK_FROM}
    JOIN warehouse_bins rb ON rb.id = t.from_bin_id AND rb.tenant_id = t.tenant_id
    WHERE t.wave_id = ${waveId}
    ORDER BY rb.pick_sequence NULLS LAST, rb.code, t.source_id, t.source_line_no, t.id
  `);
  return rows.rows as unknown as PickTaskRow[];
}
