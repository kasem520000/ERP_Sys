import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { TransportService } from "../application/transport-service";
import { TrackingService } from "../application/tracking-service";

/**
 * PHASE-051 (W-36 — T-09 + T-13, 2026-11-25) the trade transport +
 * tracking routes (matrix §3.29, the keys-seed-first discipline's THIRD
 * trade binding wave — the keys landed at W-33 (0122 §5), the routes
 * bind as the service waves ship, every change dated at the
 * ROUTE_PERMISSIONS block): the transport documents bind
 * trade.shipments.view over the reads (the B/L register + the packing
 * lists — the family's OWN view key, the LC precedent's shape) and
 * trade.shipments.manage over the creates (the B/L — the shipment's
 * anchor — and the packing lists; the documents' shipment_status is
 * NEVER writable here — the fold drives it, D-14's own law); the
 * tracking events bind trade.shipments.view over the log reads and
 * trade.shipments.manage over THE APPEND (the carrier milestone log +
 * the drive on the linked B/L, the packing lists under it and the
 * event's own declaration). The routes are feature-gated at the
 * controller on the whole-module unit `trade` (D-04 — the
 * transport/tracking family carries no own flag). Foreign/unknown ids
 * are 404-shaped (A7 — RLS makes them indistinguishable). The drive's
 * own summary (the fold's verdicts per document) rides the append's
 * envelope — the W-39 board renders the same columns.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const NOTE = z.string().max(2000).nullable().optional();
const PORT = z.string().min(1).max(200).nullable().optional();
const CARRIER_REF = z.string().min(1).max(50);
const DOC_TYPE = z.enum(["SEA", "AIR", "ROAD", "RAIL", "MULTIMODAL"]);
const EVENT_AT = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    "an ISO datetime",
  );
const MILESTONE = z.enum(["BOOKED", "DEPARTED", "ARRIVED", "CLEARED", "DELIVERED"]);

const createBlSchema = z.object({
  docType: DOC_TYPE,
  carrierName: z.string().min(1).max(500),
  portOfLoading: PORT,
  portOfDischarge: PORT,
  containerRefs: z.array(CARRIER_REF).max(50).optional(),
  purchaseOrderId: UUID.nullable().optional(),
  deliveryNoteId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const packLineSchema = z.object({
  description: z.string().min(1).max(200),
  packages: z.number().int().min(1).max(1_000_000_000),
  grossKg: z.string().regex(/^\d+(\.\d{1,3})?$/, "a non-negative kilogram decimal (≤ 3dp)"),
  netKg: z.string().regex(/^\d+(\.\d{1,3})?$/, "a non-negative kilogram decimal (≤ 3dp)"),
});

const createPackingListSchema = z.object({
  billOfLadingId: UUID,
  receiptId: UUID.nullable().optional(),
  lines: z.array(packLineSchema).min(1).max(200),
  note: NOTE,
  noteAr: NOTE,
});

const appendEventSchema = z.object({
  billOfLadingId: UUID,
  milestone: MILESTONE,
  eventAt: EVENT_AT,
  carrierRef: z.string().min(1).max(200).nullable().optional(),
  location: z.string().min(1).max(200).nullable().optional(),
  declarationId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

@Controller("/api/v1/trade/transport")
export class TradeTransportController {
  constructor(@Inject(TransportService) private readonly transport: TransportService) {}

  // ── the bills of lading (the shipment's own anchor) ────────────────────

  @Get("bl")
  @RequirePermissions("trade.shipments.view")
  @RequireFeature("trade")
  listBls(@Query("docType") docType?: string, @Query("shipmentStatus") shipmentStatus?: string) {
    return envelope(
      this.transport.listBls({
        docType: docType === undefined || docType === "" ? undefined : docType,
        shipmentStatus: shipmentStatus === undefined || shipmentStatus === "" ? undefined : shipmentStatus,
      }),
    );
  }

  @Get("bl/:id")
  @RequirePermissions("trade.shipments.view")
  @RequireFeature("trade")
  async findBl(@Param("id") id: string) {
    return envelope(await this.transport.findBl(id));
  }

  @Post("bl")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.shipments.manage")
  @RequireFeature("trade")
  async createBl(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createBlSchema.parse(body);
    return envelope(
      await this.transport.createBl({
        docType: input.docType,
        carrierName: input.carrierName,
        portOfLoading: input.portOfLoading ?? null,
        portOfDischarge: input.portOfDischarge ?? null,
        containerRefs: input.containerRefs ?? [],
        purchaseOrderId: input.purchaseOrderId ?? null,
        deliveryNoteId: input.deliveryNoteId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // ── the packing lists (the shipment's pack shapes) ─────────────────────

  @Get("packing-lists")
  @RequirePermissions("trade.shipments.view")
  @RequireFeature("trade")
  listPackingLists(@Query("billOfLadingId") billOfLadingId?: string) {
    return envelope(
      this.transport.listPackingLists({
        billOfLadingId: billOfLadingId === undefined || billOfLadingId === "" ? undefined : billOfLadingId,
      }),
    );
  }

  @Post("packing-lists")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.shipments.manage")
  @RequireFeature("trade")
  async createPackingList(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createPackingListSchema.parse(body);
    return envelope(
      await this.transport.createPackingList({
        billOfLadingId: input.billOfLadingId,
        receiptId: input.receiptId ?? null,
        lines: input.lines,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}

@Controller("/api/v1/trade/shipments")
export class TradeTrackingController {
  constructor(@Inject(TrackingService) private readonly tracking: TrackingService) {}

  // ── the carrier milestone log (the append-only truth) ──────────────────

  @Get("events")
  @RequirePermissions("trade.shipments.view")
  @RequireFeature("trade")
  listEvents(
    @Query("billOfLadingId") billOfLadingId?: string,
    @Query("declarationId") declarationId?: string,
  ) {
    return envelope(
      this.tracking.listEvents({
        billOfLadingId: billOfLadingId === undefined || billOfLadingId === "" ? undefined : billOfLadingId,
        declarationId: declarationId === undefined || declarationId === "" ? undefined : declarationId,
      }),
    );
  }

  @Post("events")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.shipments.manage")
  @RequireFeature("trade")
  async appendEvent(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = appendEventSchema.parse(body);
    return envelope(
      await this.tracking.appendEvent({
        billOfLadingId: input.billOfLadingId,
        milestone: input.milestone,
        eventAt: input.eventAt,
        carrierRef: input.carrierRef ?? null,
        location: input.location ?? null,
        declarationId: input.declarationId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
