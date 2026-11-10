import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { GlQueries } from "../application/gl-queries";

/**
 * GL routes (PHASE-007 §4; REPORT_CATALOG `accounting.journal-register`):
 * account balances + movements with drill-down, the journal-register data
 * feed, and the entry detail with its source-document chain (INV-006).
 * Statement RENDERING arrives with the reporting engine (PHASE-013).
 * PHASE-019 (§8): every feed gains an optional `projectId` query param —
 * the projects dimension slice (query params are not route-registry
 * rows; the passthrough mirrors from/to/sourceType, unvalidated at the
 * edge exactly like them).
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const LIMIT = z.coerce.number().int().min(1).max(500).default(100);

@Controller("api/v1/accounting")
export class GlController {
  constructor(@Inject(GlQueries) private readonly gl: GlQueries) {}

  @Get("gl/accounts")
  @RequirePermissions("accounting.journal_entries.view")
  async balances(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("projectId") projectId?: string,
  ): Promise<unknown> {
    return envelope(await this.gl.accountBalances({ fromDate: from, toDate: to, projectId }));
  }

  @Get("gl/accounts/:id/movements")
  @RequirePermissions("accounting.journal_entries.view")
  async movements(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
    @Query("projectId") projectId?: string,
  ): Promise<unknown> {
    return envelope(
      await this.gl.accountMovements({
        accountId: id,
        fromDate: from,
        toDate: to,
        limit: LIMIT.parse(limit ?? undefined),
        projectId,
      }),
    );
  }

  @Get("gl/journal-register")
  @RequirePermissions("accounting.journal_entries.view")
  async journalRegister(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("sourceType") sourceType?: string,
    @Query("limit") limit?: string,
    @Query("projectId") projectId?: string,
  ): Promise<unknown> {
    void DATE;
    return envelope(
      await this.gl.journalRegister({
        fromDate: from,
        toDate: to,
        sourceType,
        limit: LIMIT.parse(limit ?? undefined),
        projectId,
      }),
    );
  }

  /** Drill-down (INV-006): entry + lines + source document reference. */
  @Get("gl/entries/:id")
  @RequirePermissions("accounting.journal_entries.view")
  async entryDetail(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.gl.entryDetail(id));
  }
}
