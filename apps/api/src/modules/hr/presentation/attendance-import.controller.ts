import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import type { ImportMapping } from "../application/attendance-import-service";
import { AttendanceImportService } from "../application/attendance-import-service";

/**
 * PHASE-045 (T-05, N-17) — the device-import wizard + the quarantine
 * review. THE PERMISSION SPLIT (the 0086 seed's law): the WIZARD —
 * preview, commit, and the mapping — rides `hr.attendance.import`
 * ("run the device-import wizard"); the REVIEW — the import log and
 * the anomaly quarantine — rides `hr.attendance` (the register's
 * management key). Foreign/unknown ids are 404-shaped (A7 — RLS
 * parity).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const INSTANT = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
    "ISO-8601 instant (e.g. 2026-06-01T08:05:00Z)",
  );
const TEXT = z.string().min(1).max(500).nullable().optional();

/** The mapping schema — EXPORTED for the wizard's client and any unit
 * contract test (the rotationBody/captureBody precedent). The bounds
 * are the service's law re-stated at the edge (the defense-in-depth
 * pair): column indexes 0–49, the three timestamp formats, the three
 * delimiters. */
export const importMappingBody = z.object({
  employeeCode: z.number().int().min(0).max(49),
  timestamp: z.number().int().min(0).max(49),
  direction: z.number().int().min(0).max(49).nullable(),
  deviceRef: z.number().int().min(0).max(49).nullable(),
  timestampFormat: z.enum(["ISO", "DMY", "MDY"]),
  skipHeader: z.boolean(),
  delimiter: z.enum([",", ";", "\t"]),
});

const previewBody = z.object({
  content: z.string().min(1).max(2_000_000),
  mapping: importMappingBody.optional(),
});

const commitBody = z.object({
  content: z.string().min(1).max(2_000_000),
  fileName: z.string().min(1).max(200),
  mapping: importMappingBody.optional(),
  deviceRef: z.string().min(1).max(120).nullable().optional(),
  note: TEXT,
});

const resolveBody = z
  .object({
    action: z.enum(["REJECT", "IMPORT"]),
    employeeId: UUID.optional(),
    checkIn: INSTANT.optional(),
    checkOut: INSTANT.nullable().optional(),
    note: TEXT,
  })
  .refine((body) => body.action === "REJECT" || (body.employeeId !== undefined && body.checkIn !== undefined), {
    message: "the IMPORT resolution requires employeeId and checkIn (the corrected session's facts)",
    path: ["employeeId"],
  });

@Controller("api/v1/hr")
export class AttendanceImportController {
  constructor(@Inject(AttendanceImportService) private readonly imports: AttendanceImportService) {}

  // -- the wizard (hr.attendance.import) ----------------------------------------------

  @Post("attendance/import/preview")
  @RequirePermissions("hr.attendance.import")
  preview(@Req() request: Request, @Body() body: unknown) {
    requireIdentity(request);
    const input = previewBody.parse(body);
    return envelope(
      this.imports.preview({
        content: input.content,
        ...(input.mapping === undefined ? {} : { mapping: input.mapping as ImportMapping }),
      }),
    );
  }

  @Post("attendance/import/commit")
  @RequirePermissions("hr.attendance.import")
  commit(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = commitBody.parse(body);
    return envelope(
      this.imports.commit({
        content: input.content,
        fileName: input.fileName,
        ...(input.mapping === undefined ? {} : { mapping: input.mapping as ImportMapping }),
        deviceRef: input.deviceRef ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("attendance/import/mapping")
  @RequirePermissions("hr.attendance.import")
  getMapping(@Req() request: Request) {
    requireIdentity(request);
    return envelope(this.imports.effectiveMapping());
  }

  @Put("attendance/import/mapping")
  @RequirePermissions("hr.attendance.import")
  saveMapping(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = importMappingBody.parse(body);
    return envelope(this.imports.saveMapping(input as ImportMapping, identity.userId));
  }

  // -- the review surface (hr.attendance) ----------------------------------------------

  @Get("attendance/import/batches")
  @RequirePermissions("hr.attendance")
  batches(
    @Req() request: Request,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.imports.batches({
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  @Get("attendance/import/anomalies")
  @RequirePermissions("hr.attendance")
  anomalies(
    @Req() request: Request,
    @Query("batchId") batchId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.imports.anomalies({
        ...(batchId === undefined || batchId === "" ? {} : { batchId }),
        ...(status === undefined || status === "" ? {} : { status }),
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  @Post("attendance/import/anomalies/:id/resolve")
  @RequirePermissions("hr.attendance")
  resolve(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = resolveBody.parse(body);
    return envelope(
      this.imports.resolve({
        anomalyId: id,
        action: input.action,
        ...(input.employeeId === undefined ? {} : { employeeId: input.employeeId }),
        ...(input.checkIn === undefined ? {} : { checkIn: input.checkIn }),
        checkOut: input.checkOut ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
