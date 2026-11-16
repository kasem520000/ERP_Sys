import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { AttendanceService } from "../application/attendance-service";

/**
 * PHASE-045 (T-04) — the attendance routes: session capture, the
 * one-shot checkout (BR-082), the daily register, the exception board,
 * and the derivation run. Every route rides `hr.attendance` (matrix
 * §3.23, the 0086-seeded key); the DEVICE-import pipeline (T-05)
 * lands separately on `hr.attendance.import`. Foreign/unknown ids are
 * 404-shaped (A7 — RLS parity).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
/** An ISO-8601 instant (Z or explicit offset) — PostgreSQL casts to
 * timestamptz at the store; the service re-validates the shape typed. */
const INSTANT = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
    "ISO-8601 instant (e.g. 2026-06-01T08:05:00Z)",
  );
const TEXT = z.string().min(1).max(500).nullable().optional();

/** The capture body — EXPORTED for the module's unit contract surface
 * (the rotationBody precedent). A session OPENS with a check-in (the
 * 0081 session-shape law); a DEVICE-source record requires its
 * deviceRef (the device-shape CHECK, surfaced at the edge as a 422
 * naming the field — the store CHECK is the floor, never the first
 * line of defense). */
export const captureBody = z
  .object({
    employeeId: UUID,
    workDate: DATE,
    checkIn: INSTANT,
    checkOut: INSTANT.nullable().optional(),
    source: z.enum(["MANUAL", "DEVICE"]).default("MANUAL"),
    deviceRef: z.string().min(1).max(120).nullable().optional(),
    geoLat: z.number().min(-90).max(90).nullable().optional(),
    geoLng: z.number().min(-180).max(180).nullable().optional(),
    note: TEXT,
  })
  .refine((body) => body.source !== "DEVICE" || (body.deviceRef !== undefined && body.deviceRef !== null), {
    message: "a DEVICE-source record requires a deviceRef (the 0081 device-shape law)",
    path: ["deviceRef"],
  })
  .refine((body) => body.source !== "MANUAL" || body.deviceRef === undefined || body.deviceRef === null, {
    message: "a MANUAL-source record carries no deviceRef",
    path: ["deviceRef"],
  });

/** The derive body — the employeeIds case law (c537113): normalized to
 * canonical lowercase before the uniqueness comparison, at the edge AND
 * independently in the service (the defense-in-depth pair). */
export const deriveBody = z
  .object({
    from: DATE,
    to: DATE,
    employeeIds: z.array(UUID).max(200).optional(),
  })
  .refine(
    (body) =>
      body.employeeIds === undefined ||
      new Set(body.employeeIds.map((id) => id.toLowerCase())).size === body.employeeIds.length,
    {
      message:
        "employeeIds must be unique — a repeated id (any hex-case spelling of it) would derive the same employee-day twice",
      path: ["employeeIds"],
    },
  );

@Controller("api/v1/hr")
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  @Post("attendance/records")
  @RequirePermissions("hr.attendance")
  async capture(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = captureBody.parse(body);
    return envelope(
      await this.attendance.capture({
        employeeId: input.employeeId,
        workDate: input.workDate,
        checkIn: input.checkIn,
        checkOut: input.checkOut ?? null,
        source: input.source,
        deviceRef: input.deviceRef ?? null,
        geoLat: input.geoLat ?? null,
        geoLng: input.geoLng ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("attendance/records/:id/checkout")
  @RequirePermissions("hr.attendance")
  async checkout(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ checkOut: INSTANT }).parse(body);
    return envelope(await this.attendance.checkout(id, input.checkOut, identity.userId));
  }

  @Get("attendance/register")
  @RequirePermissions("hr.attendance")
  async register(@Req() request: Request, @Query("date") date: string) {
    requireIdentity(request);
    return envelope(await this.attendance.register(date));
  }

  @Get("attendance/exceptions")
  @RequirePermissions("hr.attendance")
  async exceptions(
    @Req() request: Request,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("employeeId") employeeId?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireIdentity(request);
    const employeeIds =
      employeeId === undefined || employeeId === "" ? undefined : [employeeId];
    return envelope(
      await this.attendance.exceptions({
        from,
        to,
        employeeIds,
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  @Post("attendance/derive")
  @RequirePermissions("hr.attendance")
  async derive(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = deriveBody.parse(body);
    return envelope(
      await this.attendance.deriveDays({
        from: input.from,
        to: input.to,
        employeeIds: input.employeeIds,
        actorId: identity.userId,
      }),
    );
  }
}
