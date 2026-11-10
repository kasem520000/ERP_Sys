import { Controller, Get, Inject, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { AuditService } from "../application/audit.service";
import { identityOf } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../../modules/identity/domain/identity-errors";

/**
 * Audit query endpoint (PHASE-003 §2.11): gated by `audit.view` (matrix
 * §3.8); reads flow through the ambient tenant UoW so RLS confines the
 * trail to the caller's tenant (A1/A2 hold here by construction — the
 * store has no cross-tenant path even if the query were wrong).
 *
 * PHASE-024 T8 (the tenant-admin review tooling): the HTTP surface gains
 * the actor/action/correlation-id filters the service always supported,
 * plus the bounded CSV export (audited `audit.exported` — E-04 discipline:
 * every export is an audit event with the filter set it ran).
 */

const querySchema = z.object({
  entityType: z.string().min(3).max(100).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  correlationId: z.string().uuid().optional(),
  fromAt: z.string().datetime().optional(),
  toAt: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** The export runs the SAME filter set with a bounded ceiling (DLP-lite). */
const exportQuerySchema = querySchema;

const EXPORT_ROW_LIMIT = 10_000;

@Controller("api/v1/audit/events")
export class AuditEventsController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions("audit.view")
  async list(@Req() request: Request, @Query() query: unknown) {
    const identity = identityOf(request);
    if (identity === undefined) {
      throw new UnauthenticatedError();
    }
    const input = querySchema.parse(query);
    const rows = await this.audit.list(input);
    return envelope(
      rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actorId: row.actorId,
        correlationId: row.correlationId,
        at: row.at,
      })),
    );
  }

  /**
   * PHASE-024 T8: the tenant-admin CSV export — the same filters, the same
   * RLS-confined read, a hard 10k-row ceiling, and an `audit.exported`
   * event recording the filter set (E-04). CSV field escaping is minimal
   * and complete: quotes doubled, commas/quotes/newlines always quoted.
   */
  @Get("export")
  @RequirePermissions("audit.view")
  async export(@Req() request: Request, @Res() response: Response, @Query() query: unknown) {
    const identity = identityOf(request);
    if (identity === undefined) {
      throw new UnauthenticatedError();
    }
    const input = exportQuerySchema.parse(query);
    const rows = await this.audit.list({ ...input, limit: EXPORT_ROW_LIMIT });
    // E-04 discipline: every export is itself audited with the filter set.
    await this.audit.record({
      action: "audit.exported",
      entityType: "audit_events",
      entityId: identity.userId,
      actorId: identity.userId,
      after: {
        row_count: rows.length,
        truncated: rows.length === EXPORT_ROW_LIMIT,
        filters: {
          entity_type: input.entityType ?? null,
          entity_id: input.entityId ?? null,
          actor_id: input.actorId ?? null,
          action: input.action ?? null,
          correlation_id: input.correlationId ?? null,
          from_at: input.fromAt ?? null,
          to_at: input.toAt ?? null,
        },
      },
    });
    const header = "at,action,entity_type,entity_id,actor_id,correlation_id";
    const body = rows.map((row) =>
      [
        row.at,
        row.action,
        row.entityType,
        row.entityId,
        row.actorId ?? "",
        row.correlationId ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
    const csv = [header, ...body].join("\r\n");
    response.header("Content-Type", "text/csv; charset=utf-8");
    response.header(
      "Content-Disposition",
      `attachment; filename="audit-events-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    response.status(200).send(csv);
  }
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}
