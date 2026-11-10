import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { PosTerminalService } from "../application/terminal-service";
import { PosShiftFlowService } from "../application/shift-flow-service";
import { PosFloorService } from "../application/floor-service";
import { PosReceiptService } from "../application/receipt-service";
import { PosZReportService } from "../application/zreport-service";
import { PosSaleService } from "../../sales/application/pos-channel/pos-sale-service";

/**
 * POS routes (PHASE-016 §4): every route is permission-guarded, BR-039
 * feature-gated, Idempotency-Key'd by the global POST guard, and returns
 * the success envelope. The cashier role is terminal-scoped (matrix §3.2
 * — one branch, one terminal during a shift).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "money decimal");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");

const registerTerminalSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9._-]{2,30}$/),
  name: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(160).nullable().optional(),
  branchId: UUID,
  cashAccountId: UUID,
  warehouseId: UUID.nullable().optional(),
  receiptSize: z.enum(["80mm", "58mm"]).default("80mm"),
});

const saleSchema = z.object({
  terminalId: UUID,
  customerId: UUID.nullable(),
  lines: z
    .array(
      z.object({
        itemId: UUID,
        description: z.string().max(300).nullable().optional(),
        descriptionAr: z.string().max(400).nullable().optional(),
        qty: QTY,
        unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/),
        discountAmount: MONEY.nullable().optional(),
        taxCodeId: UUID.nullable().optional(),
        batchId: UUID.nullable().optional(),
        serialIds: z.array(UUID).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  tenders: z
    .array(
      z.object({
        method: z.enum(["CASH", "CARD"]),
        amount: MONEY,
        reference: z.string().max(80).nullable().optional(),
      }),
    )
    .min(1)
    .max(10),
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "COUNTER"]).default("COUNTER"),
  checkId: UUID.nullable().optional(),
  offlineReceiptNo: z.string().min(1).max(60).nullable().optional(),
});

const returnSchema = z.object({
  terminalId: UUID,
  invoiceId: UUID,
  lines: z
    .array(
      z.object({
        invoiceLineId: UUID,
        qty: QTY,
        reason: z.string().max(200).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  note: z.string().max(500).nullable().optional(),
});

const checkLineSchema = z.object({
  lineNo: z.number().int().min(1).optional(),
  itemId: UUID,
  name: z.string().min(1).max(300),
  nameAr: z.string().max(400).nullable().optional(),
  qty: QTY,
  unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/),
  note: z.string().max(300).nullable().optional(),
  sentToKitchen: z.boolean().default(false),
});

@Controller("api/v1/pos")
export class PosController {
  constructor(
    private readonly terminals: PosTerminalService,
    private readonly shiftFlow: PosShiftFlowService,
    private readonly floor: PosFloorService,
    private readonly receipts: PosReceiptService,
    private readonly zreports: PosZReportService,
    private readonly posSales: PosSaleService,
  ) {}

  // -- terminal registry (T2; pos.terminals.manage) --------------------------

  @Get("terminals")
  @RequirePermissions("pos.terminals.manage")
  @RequireFeature("pos.terminals")
  async listTerminals(
    @Query("branchId") branchId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.terminals.list({
        branchId: branchId && z.string().uuid().safeParse(branchId).success ? branchId : undefined,
        status,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("terminals")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("pos.terminals.manage")
  @RequireFeature("pos.terminals")
  async registerTerminal(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = registerTerminalSchema.parse(body);
    return envelope(
      await this.terminals.register({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        branchId: input.branchId,
        cashAccountId: input.cashAccountId,
        warehouseId: input.warehouseId ?? null,
        receiptSize: input.receiptSize,
        actorId: identity.userId,
      }),
    );
  }

  @Post("terminals/:id/activate")
  @RequirePermissions("pos.terminals.manage")
  @RequireFeature("pos.terminals")
  async activateTerminal(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.terminals.setStatus({ id, status: "ACTIVE", actorId: identity.userId }),
    );
  }

  @Post("terminals/:id/deactivate")
  @RequirePermissions("pos.terminals.manage")
  @RequireFeature("pos.terminals")
  async deactivateTerminal(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.terminals.setStatus({ id, status: "INACTIVE", actorId: identity.userId }),
    );
  }

  @Post("terminals/:id/devices")
  @RequirePermissions("sync.devices.register")
  @RequireFeature("pos.terminals")
  async enrollDevice(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = z
      .object({ deviceName: z.string().min(1).max(120), deviceKey: z.string().min(16).max(200) })
      .parse(body);
    return envelope(
      await this.terminals.enrollDevice({
        terminalId: id,
        deviceName: input.deviceName,
        deviceKey: input.deviceKey,
        actorId: identity.userId,
      }),
    );
  }

  @Post("terminals/:id/devices/revoke")
  @RequirePermissions("sync.devices.revoke")
  @RequireFeature("pos.terminals")
  async revokeDevice(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.terminals.revokeDevice({ terminalId: id, actorId: identity.userId }));
  }

  // -- shifts (T3; pos.shifts.manage / sales.pos_session.*) -------------------

  @Get("terminals/:id/shift")
  @RequirePermissions("sales.pos_session.open")
  @RequireFeature("pos.shifts")
  async openShift(@Param("id") id: string) {
    return envelope(await this.shiftFlow.openShiftForTerminal(id));
  }

  @Post("terminals/:id/shift/open")
  @RequirePermissions("sales.pos_session.open")
  @RequireFeature("pos.shifts")
  async openShiftFlow(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        openingAmount: MONEY.default("0"),
        denominations: z.record(z.string(), z.string()).nullable().optional(),
      })
      .parse(body ?? {});
    return envelope(
      await this.shiftFlow.open({
        terminalId: id,
        openingAmount: input.openingAmount,
        denominations: input.denominations ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("terminals/:id/shift/capture")
  @RequirePermissions("sales.pos_session.open")
  @RequireFeature("pos.shifts")
  async captureShift(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = z
      .object({ shiftId: UUID, cashIn: MONEY.default("0"), cashOut: MONEY.default("0") })
      .parse(body);
    return envelope(
      await this.shiftFlow.capture({
        terminalId: id,
        shiftId: input.shiftId,
        cashIn: input.cashIn,
        cashOut: input.cashOut,
        actorId: identity.userId,
      }),
    );
  }

  @Post("terminals/:id/shift/close")
  @RequirePermissions("sales.pos_session.close")
  @RequireFeature("pos.shifts")
  async closeShift(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        shiftId: UUID,
        denominations: z.record(z.string(), z.string()),
        reason: z.string().max(500).optional(),
        supervisorId: z.string().max(80).optional(),
        supervisorPin: z.string().max(12).optional(),
      })
      .parse(body);
    return envelope(
      await this.shiftFlow.close({
        terminalId: id,
        shiftId: input.shiftId,
        denominations: input.denominations,
        reason: input.reason,
        supervisorId: input.supervisorId,
        supervisorPin: input.supervisorPin,
        actorId: identity.userId,
      }),
    );
  }

  // -- counter sales (T4/T5; pos.sales.sell) -----------------------------------

  @Post("sales")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.sales")
  async submitSale(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = saleSchema.parse(body);
    return envelope(
      await this.posSales.submit({
        terminalId: input.terminalId,
        customerId: input.customerId,
        lines: input.lines,
        tenders: input.tenders,
        orderType: input.orderType,
        checkId: input.checkId ?? null,
        offlineReceiptNo: input.offlineReceiptNo ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("sales/returns")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.sales")
  async returnSale(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = returnSchema.parse(body);
    return envelope(
      await this.posSales.returnSale({
        terminalId: input.terminalId,
        invoiceId: input.invoiceId,
        lines: input.lines,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- receipts (T11; pos.receipts.print) --------------------------------------

  @Get("invoices/:id/receipt")
  @RequirePermissions("pos.receipts.print")
  @RequireFeature("pos.receipts")
  async receipt(
    @Param("id") id: string,
    @Query("locale") locale?: string,
  ) {
    const parsedLocale = locale === "en" ? "en" : "ar";
    return envelope(await this.receipts.renderForInvoice({ invoiceId: id, locale: parsedLocale }));
  }

  // -- table service (T6; pos.table_service / pos.kitchen_display) -------------

  @Get("floor")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async getFloor(@Query("branchId") branchId: string) {
    return envelope(await this.floor.listFloor(z.string().uuid().parse(branchId)));
  }

  @Post("floor/tables")
  @RequirePermissions("pos.terminals.manage")
  @RequireFeature("pos.table_service")
  async addTable(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        branchId: UUID,
        zone: z.string().min(1).max(60).default("MAIN"),
        zoneAr: z.string().max(80).nullable().optional(),
        label: z.string().min(1).max(30),
        seats: z.coerce.number().int().min(1).max(40).default(4),
        sortKey: z.coerce.number().int().default(0),
      })
      .parse(body);
    return envelope(
      await this.floor.addTable({
        ...input,
        zoneAr: input.zoneAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("checks")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async openCheck(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        branchId: UUID,
        tableId: UUID.nullable().optional(),
        orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "COUNTER"]).default("DINE_IN"),
        guestCount: z.coerce.number().int().min(1).max(50).default(1),
      })
      .parse(body);
    return envelope(
      await this.floor.openCheck({
        branchId: input.branchId,
        tableId: input.tableId ?? null,
        orderType: input.orderType,
        guestCount: input.guestCount,
        actorId: identity.userId,
      }),
    );
  }

  @Get("checks")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async listChecks(
    @Query("branchId") branchId: string,
    @Query("status") status?: string,
  ) {
    return envelope(
      await this.floor.listChecks(z.string().uuid().parse(branchId), status),
    );
  }

  @Put("checks/:id/lines")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async saveCheckLines(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = z.object({ lines: z.array(checkLineSchema).max(200) }).parse(body);
    return envelope(
      await this.floor.saveLines({
        checkId: id,
        lines: input.lines.map((line, index) => ({
          ...line,
          lineNo: line.lineNo ?? index + 1,
          nameAr: line.nameAr ?? null,
          note: line.note ?? null,
        })),
        actorId: identity.userId,
      }),
    );
  }

  @Post("checks/:id/kitchen-ticket")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.kitchen_display")
  async sendKitchenTicket(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.floor.sendKitchenTicket({ checkId: id, actorId: identity.userId }));
  }

  @Get("checks/:id/kitchen-tickets")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.kitchen_display")
  async kitchenTickets(@Param("id") id: string) {
    return envelope(await this.floor.listKitchenTickets(id));
  }

  @Post("checks/:id/transfer")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async transferCheck(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = z.object({ toTableId: UUID }).parse(body);
    return envelope(
      await this.floor.transfer({ checkId: id, toTableId: input.toTableId, actorId: identity.userId }),
    );
  }

  @Post("checks/:id/split")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async splitCheck(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = z.object({ lineNos: z.array(z.number().int().min(1)).min(1).max(200) }).parse(body);
    return envelope(await this.floor.split({ checkId: id, lineNos: input.lineNos, actorId: identity.userId }));
  }

  @Post("checks/:id/cancel")
  @RequirePermissions("pos.sales.sell")
  @RequireFeature("pos.table_service")
  async cancelCheck(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(1).max(500) }).parse(body);
    return envelope(await this.floor.cancel({ checkId: id, reason: input.reason, actorId: identity.userId }));
  }

  // -- Z report (T12) -----------------------------------------------------------

  @Get("z-report")
  @RequirePermissions("sales.pos_session.close")
  @RequireFeature("pos.shifts")
  async zReport(
    @Query("branchId") branchId: string,
    @Query("date") date?: string,
    @Query("shiftId") shiftId?: string,
  ) {
    const resolvedDate = date !== undefined && DATE.safeParse(date).success ? date : new Date().toISOString().slice(0, 10);
    return envelope(
      await this.zreports.build({
        branchId: z.string().uuid().parse(branchId),
        date: resolvedDate,
        shiftId: shiftId !== undefined && UUID.safeParse(shiftId).success ? shiftId : undefined,
      }),
    );
  }
}
