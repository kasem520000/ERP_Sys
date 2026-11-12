import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { WmsService } from "../application/wms.service";
import { PutawayService } from "../application/putaway-service";
import { PickingService } from "../application/picking-service";
import { CycleCountService } from "../application/cycle-count-service";
import { QuarantineService } from "../application/quarantine-service";

/**
 * WMS routes (PHASE-044 T-14; matrix §3.5 WMS block): the HTTP surface of
 * the T-03…T-08 services the web boards ride. Permissions are the eight
 * 0071-seeded keys (one per surface — locations, putaway, picking, cycle
 * counts, ABC, serial ledger, quarantine); feature gates are the plan
 * feature_keys seeded in 0071 §3 (business + enterprise, the
 * distribution/wholesale templates require them by default).
 *
 * Quantities travel as decimal strings ≤ 6dp (ADR-0009); foreign or
 * unknown ids are 404-shaped (A7 — no existence disclosure); every
 * mutating route is audited inside its service (the controller adds no
 * second audit row) and idempotency rides the global POST guard.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const LIMIT = z.coerce.number().int().min(1).max(1000);
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const NOTE = z.string().min(1).max(500).nullable().optional();
const CODE = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "code shape");
const ZONE_TYPE = z.enum(["PICKING", "BULK", "QUARANTINE", "DOCK", "STAGE"]);
const BIN_STATUS = z.enum(["AVAILABLE", "QUARANTINE", "HOLD"]);
const CLS = z.enum(["A", "B", "C"]).optional();

const createZoneSchema = z.object({
  warehouseId: UUID,
  code: CODE,
  name: z.string().min(1).max(160),
  nameAr: z.string().min(1).max(200).nullable().optional(),
  zoneType: ZONE_TYPE,
  isDefault: z.boolean().optional(),
  note: NOTE,
});

const updateZoneSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  nameAr: z.string().min(1).max(200).nullable().optional(),
  zoneType: ZONE_TYPE.optional(),
  isDefault: z.boolean().optional(),
  note: NOTE,
});

const createAisleSchema = z.object({
  code: CODE,
  name: z.string().min(1).max(160),
  nameAr: z.string().min(1).max(200).nullable().optional(),
});

const createRackSchema = createAisleSchema;

const createBinSchema = z.object({
  warehouseId: UUID,
  rackId: UUID,
  code: CODE,
  barcode: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  nameAr: z.string().min(1).max(200).nullable().optional(),
  pickSequence: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  capacity: QTY.nullable().optional(),
  allowMixedBatches: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  note: NOTE,
});

const updateBinSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  nameAr: z.string().min(1).max(200).nullable().optional(),
  pickSequence: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  capacity: QTY.nullable().optional(),
  allowMixedBatches: z.boolean().optional(),
  note: NOTE,
});

const createLpnSchema = z.object({
  lpnCode: z.string().min(1).max(60),
  note: NOTE,
});

const moveLpnSchema = z.object({
  toBinId: UUID,
  note: NOTE,
});

const bindLpnSchema = z.object({ contentId: UUID });

const transitionSchema = z.object({
  toStatus: BIN_STATUS,
  note: NOTE,
});

const createRuleSchema = z.object({
  priority: z.coerce.number().int().min(1).max(1_000),
  name: z.string().min(1).max(160),
  condition: z.record(z.string(), z.unknown()),
  targetZoneType: ZONE_TYPE.nullable().optional(),
  targetBinId: UUID.nullable().optional(),
  note: NOTE,
});

const updateRuleSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  condition: z.record(z.string(), z.unknown()).optional(),
  targetZoneType: ZONE_TYPE.nullable().optional(),
  targetBinId: UUID.nullable().optional(),
  isActive: z.boolean().optional(),
  note: NOTE,
});

const strategySchema = z.object({
  warehouseId: UUID,
  method: z.enum(["FIFO", "FEFO", "NEAREST"]),
  allowPartial: z.boolean(),
});

const createWaveSchema = z.object({
  warehouseId: UUID,
  lines: z
    .array(
      z.object({
        deliveryNoteId: UUID,
        lineNo: z.coerce.number().int().min(1),
        itemId: UUID,
        qty: QTY,
        batchId: UUID.nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  method: z.enum(["FIFO", "FEFO", "NEAREST"]).nullable().optional(),
  routeNote: NOTE,
});

const confirmPutawaySchema = z.object({ scannedBarcode: z.string().min(1).max(80) });

const assignSchema = z.object({ userId: UUID.nullable() });

const confirmPickSchema = z.object({
  scannedBarcode: z.string().min(1).max(80),
  qty: QTY.optional(),
});

const cancelTaskSchema = z.object({ reason: NOTE });

const releaseSchema = z.object({});
const completeSchema = z.object({});
const cancelWaveSchema = z.object({ reason: NOTE });

const createScheduleSchema = z.object({
  warehouseId: UUID,
  name: z.string().min(1).max(160),
  classADays: z.coerce.number().int().min(1).max(3650),
  classBDays: z.coerce.number().int().min(1).max(3650),
  classCDays: z.coerce.number().int().min(1).max(3650),
  approvalThreshold: MONEY,
  blind: z.boolean().optional(),
  note: NOTE,
});

const updateScheduleSchema = z.object({
  classADays: z.coerce.number().int().min(1).max(3650).optional(),
  classBDays: z.coerce.number().int().min(1).max(3650).optional(),
  classCDays: z.coerce.number().int().min(1).max(3650).optional(),
  approvalThreshold: MONEY.optional(),
  blind: z.boolean().optional(),
  isActive: z.boolean().optional(),
  note: NOTE,
});

const runScheduleSchema = z.object({ maxItems: z.coerce.number().int().min(1).max(200).optional() });

const recomputeAbcSchema = z.object({
  windowDays: z.coerce.number().int().min(1).max(3650).optional(),
  aPct: z.string().regex(/^0?\.\d{1,4}$/, "share decimal 0..1").optional(),
  bPct: z.string().regex(/^0?\.\d{1,4}$/, "share decimal 0..1").optional(),
});

const createDocumentSchema = z.object({
  warehouseId: UUID,
  itemIds: z.array(UUID).min(1).max(200),
  blind: z.boolean().optional(),
  note: NOTE,
});

const enterCountsSchema = z.object({
  entries: z
    .array(
      z.object({
        lineNo: z.coerce.number().int().min(1),
        countedQty: QTY,
      }),
    )
    .min(1)
    .max(500),
});

const recountSchema = z.object({
  lineNo: z.coerce.number().int().min(1),
  countedQty: QTY,
  recountNote: z.string().min(1).max(500),
});

const approveSchema = z.object({ supervisor: z.boolean().optional() });

const disposeSchema = z.object({
  disposition: z.enum(["RELEASE", "RETURN_TO_VENDOR", "SCRAP"]),
  note: NOTE,
  counterAccountId: UUID.nullable().optional(),
});

@Controller("api/v1/inventory/wms")
export class WmsController {
  constructor(
    @Inject(WmsService) private readonly wms: WmsService,
    @Inject(PutawayService) private readonly putaway: PutawayService,
    @Inject(PickingService) private readonly picking: PickingService,
    @Inject(CycleCountService) private readonly cycleCounts: CycleCountService,
    @Inject(QuarantineService) private readonly quarantine: QuarantineService,
  ) {}

  // -- the location tree (§2.1) --------------------------------------------------------

  @Get("zones")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async listZones(@Query("warehouseId") warehouseId?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.wms.listZones({
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 200),
      }),
    );
  }

  @Post("zones")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async createZone(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createZoneSchema.parse(body);
    return envelope(
      await this.wms.createZone({
        warehouseId: input.warehouseId,
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        zoneType: input.zoneType,
        isDefault: input.isDefault ?? false,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("zones/:id")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async updateZone(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateZoneSchema.parse(body ?? {});
    return envelope(
      await this.wms.updateZone(
        id,
        {
          name: input.name,
          nameAr: input.nameAr,
          zoneType: input.zoneType,
          isDefault: input.isDefault,
          note: input.note,
        },
        identity.userId,
      ),
    );
  }

  @Get("zones/:id/aisles")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async listAisles(@Param("id") id: string) {
    return envelope(await this.wms.listAisles(id));
  }

  @Post("zones/:id/aisles")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async createAisle(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createAisleSchema.parse(body);
    return envelope(
      await this.wms.createAisle({
        zoneId: id,
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("aisles/:id/racks")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async listRacks(@Param("id") id: string) {
    return envelope(await this.wms.listRacks(id));
  }

  @Post("aisles/:id/racks")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async createRack(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRackSchema.parse(body);
    return envelope(
      await this.wms.createRack({
        aisleId: id,
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("bins")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async listBins(
    @Query("warehouseId") warehouseId?: string,
    @Query("zoneId") zoneId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.wms.listBins({
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        zoneId: UUID.nullish().parse(zoneId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 500),
      }),
    );
  }

  @Get("bins/barcode/:barcode")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async findBinByBarcode(@Param("barcode") barcode: string) {
    return envelope(await this.wms.findBinByBarcode(barcode));
  }

  @Get("bins/:id")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async findBin(@Param("id") id: string) {
    return envelope(await this.wms.findBin(id));
  }

  @Post("bins")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async createBin(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createBinSchema.parse(body);
    return envelope(
      await this.wms.createBin({
        warehouseId: input.warehouseId,
        rackId: input.rackId,
        code: input.code,
        barcode: input.barcode,
        name: input.name,
        nameAr: input.nameAr ?? null,
        pickSequence: input.pickSequence ?? null,
        capacity: input.capacity ?? null,
        allowMixedBatches: input.allowMixedBatches ?? true,
        isDefault: input.isDefault ?? false,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("bins/:id")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async updateBin(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateBinSchema.parse(body ?? {});
    return envelope(
      await this.wms.updateBin(
        id,
        {
          name: input.name,
          nameAr: input.nameAr,
          pickSequence: input.pickSequence,
          capacity: input.capacity,
          allowMixedBatches: input.allowMixedBatches,
          note: input.note,
        },
        identity.userId,
      ),
    );
  }

  /** T-14's tree read: zones → aisles → racks → bins for the location board. */
  @Get("locations/tree")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async locationTree(@Query("warehouseId") warehouseId: string) {
    return envelope(await this.wms.locationTree(UUID.parse(warehouseId)));
  }

  // -- bin contents + the INV-029 report (§2.2) ----------------------------------------

  @Get("bin-contents")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async listBinContents(
    @Query("binId") binId?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("itemId") itemId?: string,
    @Query("status") status?: string,
    @Query("lpnId") lpnId?: string,
    @Query("limit") limit?: string,
  ) {
    const statusFilter = z
      .enum(["AVAILABLE", "QUARANTINE", "HOLD"])
      .optional()
      .parse(status ?? undefined);
    return envelope(
      await this.wms.listBinContents({
        binId: UUID.nullish().parse(binId ?? undefined) ?? undefined,
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        itemId: UUID.nullish().parse(itemId ?? undefined) ?? undefined,
        status: statusFilter,
        lpnId: UUID.nullish().parse(lpnId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 500),
      }),
    );
  }

  /** Bin-level ATP (AVAILABLE, tenant-owned — BR-076's exclusion). */
  @Get("availability-by-bin")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async availableQtyByBin(@Query("warehouseId") warehouseId: string, @Query("itemId") itemId: string) {
    return envelope(
      await this.wms.availableQtyByBin(UUID.parse(warehouseId), UUID.parse(itemId)),
    );
  }

  /** The INV-029 probe's report surface (the nightly job's detector read). */
  @Get("reconcile")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async reconcile(@Query("warehouseId") warehouseId?: string) {
    return envelope(
      await this.wms.reconcile({
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
      }),
    );
  }

  // -- LPNs (§2.5) ----------------------------------------------------------------------

  @Get("lpns")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async listLpns(@Query("status") status?: string, @Query("limit") limit?: string) {
    const statusFilter = z.enum(["ACTIVE", "CLOSED"]).optional().parse(status ?? undefined);
    return envelope(
      await this.wms.listLpns({ status: statusFilter, limit: LIMIT.parse(limit ?? 100) }),
    );
  }

  @Get("lpns/:id/contents")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async lpnContents(@Param("id") id: string) {
    return envelope(await this.wms.lpnContents(id));
  }

  @Post("lpns")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async createLpn(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createLpnSchema.parse(body);
    return envelope(
      await this.wms.createLpn({
        lpnCode: input.lpnCode,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("lpns/:id/close")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async closeLpn(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.wms.closeLpn(id, identity.userId));
  }

  @Post("lpns/:id/bind")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async bindContentToLpn(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = bindLpnSchema.parse(body);
    return envelope(await this.wms.bindContentToLpn(input.contentId, id, identity.userId));
  }

  @Post("lpns/:id/move")
  @RequirePermissions("inventory.wms.locations")
  @RequireFeature("inventory.wms")
  async moveLpn(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = moveLpnSchema.parse(body);
    return envelope(
      await this.wms.moveLpn({
        lpnId: id,
        toBinId: input.toBinId,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- the serial-movement ledger read (§2.12) -------------------------------------------

  @Get("serial-movements")
  @RequirePermissions("inventory.tracking.serial_ledger")
  @RequireFeature("inventory.serial_ledger")
  async listSerialMovements(
    @Query("serialId") serialId?: string,
    @Query("itemId") itemId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.wms.listSerialMovements({
        serialId: UUID.nullish().parse(serialId ?? undefined) ?? undefined,
        itemId: UUID.nullish().parse(itemId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 200),
      }),
    );
  }

  // -- directed putaway (§2.3/PP-12) ------------------------------------------------------

  @Get("putaway/rules")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async listPutawayRules(@Query("activeOnly") activeOnly?: string) {
    return envelope(await this.putaway.listRules(activeOnly === "true"));
  }

  @Post("putaway/rules")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async createPutawayRule(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRuleSchema.parse(body);
    return envelope(
      await this.putaway.createRule({
        priority: input.priority,
        name: input.name,
        condition: input.condition,
        targetZoneType: input.targetZoneType ?? null,
        targetBinId: input.targetBinId ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("putaway/rules/:id")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async updatePutawayRule(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateRuleSchema.parse(body ?? {});
    return envelope(
      await this.putaway.updateRule(
        id,
        {
          name: input.name,
          condition: input.condition,
          targetZoneType: input.targetZoneType,
          targetBinId: input.targetBinId,
          isActive: input.isActive,
          note: input.note,
        },
        identity.userId,
      ),
    );
  }

  @Get("putaway/tasks")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async listPutawayTasks(
    @Query("status") status?: string,
    @Query("assigneeUserId") assigneeUserId?: string,
    @Query("sourceType") sourceType?: string,
    @Query("sourceId") sourceId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.putaway.listTasks({
        status: z
          .enum(["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
          .optional()
          .parse(status ?? undefined),
        assigneeUserId: UUID.nullish().parse(assigneeUserId ?? undefined) ?? undefined,
        sourceType: sourceType === undefined ? undefined : z.string().max(40).parse(sourceType),
        sourceId: UUID.nullish().parse(sourceId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 200),
      }),
    );
  }

  @Post("putaway/tasks/:id/assign")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async assignPutawayTask(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = assignSchema.parse(body ?? {});
    return envelope(await this.putaway.assign(id, input.userId, identity.userId));
  }

  /** The scan confirmation (PP-11/PP-12): wrong-bin scans are the typed
   * rejection; the response carries the PP-12 bin-label payload. */
  @Post("putaway/tasks/:id/confirm")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async confirmPutaway(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = confirmPutawaySchema.parse(body);
    return envelope(
      await this.putaway.confirm({
        taskId: id,
        scannedBarcode: input.scannedBarcode,
        actorId: identity.userId,
      }),
    );
  }

  @Post("putaway/tasks/:id/cancel")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async cancelPutawayTask(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelTaskSchema.parse(body ?? {});
    return envelope(await this.putaway.cancel(id, input.reason ?? null, identity.userId));
  }

  /** PP-12's fixed BIN-LABEL-V1 payload for one task. */
  @Get("putaway/tasks/:id/label")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async putawayTaskLabel(@Param("id") id: string) {
    return envelope(await this.putaway.binLabel(id));
  }

  /** The receipt's whole label set (every task generated by one source). */
  @Get("putaway/labels")
  @RequirePermissions("inventory.wms.putaway")
  @RequireFeature("inventory.putaway")
  async putawayLabels(@Query("sourceType") sourceType: string, @Query("sourceId") sourceId: string) {
    return envelope(
      await this.putaway.receiptLabels(z.string().max(40).parse(sourceType), UUID.parse(sourceId)),
    );
  }

  // -- directed picking (§2.4/PP-11) ------------------------------------------------------

  @Get("pick-strategy/:warehouseId")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async getPickStrategy(@Param("warehouseId") warehouseId: string) {
    return envelope(await this.picking.getStrategy(UUID.parse(warehouseId)));
  }

  @Put("pick-strategy")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async upsertPickStrategy(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = strategySchema.parse(body);
    return envelope(
      await this.picking.upsertStrategy({
        warehouseId: input.warehouseId,
        method: input.method,
        allowPartial: input.allowPartial,
        actorId: identity.userId,
      }),
    );
  }

  @Get("pick-waves")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async listPickWaves(
    @Query("warehouseId") warehouseId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.picking.listWaves({
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        status: z
          .enum(["DRAFT", "RELEASED", "COMPLETED", "CANCELLED"])
          .optional()
          .parse(status ?? undefined),
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Get("pick-waves/:id")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async findPickWave(@Param("id") id: string) {
    return envelope(await this.picking.findWave(id));
  }

  @Get("pick-waves/:id/tasks")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async pickWaveTasks(@Param("id") id: string) {
    return envelope(await this.picking.waveTasks(id));
  }

  @Get("pick-waves/:id/cluster-route")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async clusterRoute(@Param("id") id: string) {
    return envelope(await this.picking.clusterRoute(id));
  }

  @Post("pick-waves")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async createPickWave(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createWaveSchema.parse(body);
    return envelope(
      await this.picking.createWave({
        warehouseId: input.warehouseId,
        lines: input.lines.map((line) => ({
          deliveryNoteId: line.deliveryNoteId,
          lineNo: line.lineNo,
          itemId: line.itemId,
          qty: line.qty,
          batchId: line.batchId ?? null,
        })),
        method: input.method ?? null,
        routeNote: input.routeNote ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("pick-waves/:id/release")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async releasePickWave(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    releaseSchema.parse(body ?? {});
    return envelope(await this.picking.releaseWave(id, identity.userId));
  }

  @Post("pick-waves/:id/complete")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async completePickWave(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    completeSchema.parse(body ?? {});
    return envelope(await this.picking.completeWave(id, identity.userId));
  }

  @Post("pick-waves/:id/cancel")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async cancelPickWave(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelWaveSchema.parse(body ?? {});
    return envelope(await this.picking.cancelWave(id, input.reason ?? null, identity.userId));
  }

  @Get("pick-tasks")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async listPickTasks(
    @Query("status") status?: string,
    @Query("waveId") waveId?: string,
    @Query("assigneeUserId") assigneeUserId?: string,
    @Query("sourceType") sourceType?: string,
    @Query("sourceId") sourceId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.picking.listTasks({
        status: z
          .enum(["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
          .optional()
          .parse(status ?? undefined),
        waveId: UUID.nullish().parse(waveId ?? undefined) ?? undefined,
        assigneeUserId: UUID.nullish().parse(assigneeUserId ?? undefined) ?? undefined,
        sourceType: sourceType === undefined ? undefined : z.string().max(40).parse(sourceType),
        sourceId: UUID.nullish().parse(sourceId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 200),
      }),
    );
  }

  @Post("pick-tasks/:id/assign")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async assignPickTask(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = assignSchema.parse(body ?? {});
    return envelope(await this.picking.assignTask(id, input.userId, identity.userId));
  }

  @Post("pick-tasks/:id/start")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async startPickTask(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.picking.startTask(id, identity.userId));
  }

  /** The scan-verified confirm (PP-11): the scan must resolve to the
   * task's allocated bin; short qty confirms only under allow_partial. */
  @Post("pick-tasks/:id/confirm")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async confirmPick(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = confirmPickSchema.parse(body);
    return envelope(
      await this.picking.confirmPick({
        taskId: id,
        scannedBarcode: input.scannedBarcode,
        qty: input.qty,
        actorId: identity.userId,
      }),
    );
  }

  @Post("pick-tasks/:id/cancel")
  @RequirePermissions("inventory.wms.picking")
  @RequireFeature("inventory.picking")
  async cancelPickTask(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelTaskSchema.parse(body ?? {});
    return envelope(await this.picking.cancelTask(id, input.reason ?? null, identity.userId));
  }

  // -- the raw status transition (the T-03 primitive; the board's G-43
  // wrapper lives under quarantine below) ----------------------------------------------

  @Post("bin-contents/:id/transition")
  @RequirePermissions("inventory.quarantine")
  @RequireFeature("inventory.quarantine")
  async transitionStatus(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = transitionSchema.parse(body);
    return envelope(
      await this.wms.transitionStatus(id, input.toStatus, {
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- cycle counting (§2.6) + ABC (§2.7) -------------------------------------------------

  @Get("cycle-count-schedules")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async listSchedules(
    @Query("warehouseId") warehouseId?: string,
    @Query("activeOnly") activeOnly?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.cycleCounts.listSchedules({
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        activeOnly: activeOnly === "true",
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("cycle-count-schedules")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async createSchedule(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createScheduleSchema.parse(body);
    return envelope(
      await this.cycleCounts.createSchedule({
        warehouseId: input.warehouseId,
        name: input.name,
        classADays: input.classADays,
        classBDays: input.classBDays,
        classCDays: input.classCDays,
        approvalThreshold: input.approvalThreshold,
        blind: input.blind ?? false,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("cycle-count-schedules/:id")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async updateSchedule(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateScheduleSchema.parse(body ?? {});
    return envelope(
      await this.cycleCounts.updateSchedule(
        id,
        {
          classADays: input.classADays,
          classBDays: input.classBDays,
          classCDays: input.classCDays,
          approvalThreshold: input.approvalThreshold,
          blind: input.blind,
          isActive: input.isActive,
          note: input.note,
        },
        identity.userId,
      ),
    );
  }

  /** Run one schedule's due-items pass now (the nightly job's manual twin). */
  @Post("cycle-count-schedules/:id/run")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async runSchedule(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = runScheduleSchema.parse(body ?? {});
    return envelope(
      await this.cycleCounts.runSchedule(id, {
        maxItems: input.maxItems,
        actorId: identity.userId,
      }),
    );
  }

  @Get("cycle-count-documents")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async listDocuments(
    @Query("warehouseId") warehouseId?: string,
    @Query("scheduleId") scheduleId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.cycleCounts.listDocuments({
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        scheduleId: UUID.nullish().parse(scheduleId ?? undefined) ?? undefined,
        status: z
          .enum(["DRAFT", "COUNTED", "VARIANCE_REVIEW", "POSTED", "CANCELLED"])
          .optional()
          .parse(status ?? undefined),
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Get("cycle-count-documents/:id")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async findDocument(@Param("id") id: string) {
    return envelope(await this.cycleCounts.findDocument(id));
  }

  @Get("cycle-count-documents/:id/lines")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async documentLines(@Param("id") id: string) {
    return envelope(await this.cycleCounts.lines(id));
  }

  @Post("cycle-count-documents")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async createDocument(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createDocumentSchema.parse(body);
    return envelope(
      await this.cycleCounts.createDocument({
        warehouseId: input.warehouseId,
        itemIds: input.itemIds,
        blind: input.blind ?? false,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("cycle-count-documents/:id/enter")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async enterCounts(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = enterCountsSchema.parse(body);
    return envelope(
      await this.cycleCounts.enterCounts({
        documentId: id,
        entries: input.entries,
        actorId: identity.userId,
      }),
    );
  }

  @Post("cycle-count-documents/:id/recount")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async recountLine(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = recountSchema.parse(body);
    return envelope(
      await this.cycleCounts.recountLine({
        documentId: id,
        lineNo: input.lineNo,
        countedQty: input.countedQty,
        recountNote: input.recountNote,
        actorId: identity.userId,
      }),
    );
  }

  @Post("cycle-count-documents/:id/submit")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async submitDocument(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.cycleCounts.submit(id, identity.userId));
  }

  @Post("cycle-count-documents/:id/review")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async reviewDocument(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.cycleCounts.review(id, identity.userId));
  }

  /** Approval → the G-13/G-14 CYCLE_COUNT posting; the supervisor flag is
   * BR-075's threshold override. */
  @Post("cycle-count-documents/:id/approve")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async approveDocument(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = approveSchema.parse(body ?? {});
    return envelope(
      await this.cycleCounts.approve({
        id,
        supervisor: input.supervisor ?? false,
        actorId: identity.userId,
      }),
    );
  }

  @Post("cycle-count-documents/:id/cancel")
  @RequirePermissions("inventory.cycle_counts")
  @RequireFeature("inventory.cycle_counts")
  async cancelDocument(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.cycleCounts.cancel(id, identity.userId));
  }

  // -- ABC (§2.7) -------------------------------------------------------------------------

  @Get("abc")
  @RequirePermissions("inventory.abc")
  @RequireFeature("inventory.abc")
  async listAbc(@Query("cls") cls?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.cycleCounts.listAbc({ cls: CLS.parse(cls ?? undefined), limit: LIMIT.parse(limit ?? 500) }),
    );
  }

  @Post("abc/recompute")
  @RequirePermissions("inventory.abc")
  @RequireFeature("inventory.abc")
  async recomputeAbc(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = recomputeAbcSchema.parse(body ?? {});
    return envelope(
      await this.cycleCounts.recomputeAbc({
        windowDays: input.windowDays,
        aPct: input.aPct,
        bPct: input.bPct,
        actorId: identity.userId,
      }),
    );
  }

  // -- the quarantine/HOLD board (§2.8/G-43) ----------------------------------------------

  @Get("quarantine-board")
  @RequirePermissions("inventory.quarantine")
  @RequireFeature("inventory.quarantine")
  async quarantineBoard(
    @Query("status") status?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("limit") limit?: string,
  ) {
    const statusFilter = z
      .enum(["AVAILABLE", "QUARANTINE", "HOLD"])
      .optional()
      .parse(status ?? undefined);
    return envelope(
      await this.quarantine.board({
        status: statusFilter,
        warehouseId: UUID.nullish().parse(warehouseId ?? undefined) ?? undefined,
        limit: LIMIT.parse(limit ?? 200),
      }),
    );
  }

  /** The G-43-wrapped transition (policy-gated journal leg, BR-077). */
  @Post("quarantine-board/:contentId/transition")
  @RequirePermissions("inventory.quarantine")
  @RequireFeature("inventory.quarantine")
  async quarantineTransition(
    @Req() request: Request,
    @Param("contentId") contentId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = transitionSchema.parse(body);
    return envelope(
      await this.quarantine.transition(contentId, input.toStatus, {
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** The dispositions: RELEASE / RETURN_TO_VENDOR / SCRAP (§2.8). */
  @Post("quarantine-board/:contentId/dispose")
  @RequirePermissions("inventory.quarantine")
  @RequireFeature("inventory.quarantine")
  async quarantineDispose(
    @Req() request: Request,
    @Param("contentId") contentId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = disposeSchema.parse(body);
    return envelope(
      await this.quarantine.dispose({
        contentId,
        disposition: input.disposition,
        note: input.note ?? null,
        counterAccountId: input.counterAccountId ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
