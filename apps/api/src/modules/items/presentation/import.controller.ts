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

import { envelope, paginatedEnvelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { ImportService } from "../application/import-service";
import { ExportService } from "../application/export-service";

/**
 * Import/export routes (PHASE-006 §2.6/T8; matrix `items.import.run` — the
 * bulk-data permission, symmetric for imports and exports): preview-gated
 * import jobs (dry-run first, commit idempotent per upload token) and
 * bounded signed-URL exports. The import file itself is uploaded through
 * the files module's direct-upload slot BEFORE the job is created.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const LIMIT = z.coerce.number().int().min(1).max(100).default(25);

const importJobCreateSchema = z.object({
  kind: z.enum(["PARTNERS", "ITEMS", "OPENING_BALANCES"]),
  format: z.enum(["CSV", "XLSX"]),
  uploadToken: z.string().min(8).max(128),
  fileKey: z.string().min(3).max(400),
  fileName: z.string().min(1).max(200).nullish(),
});

const exportJobCreateSchema = z.object({
  kind: z.enum(["PARTNERS", "ITEMS", "OPENING_BALANCES"]),
  format: z.enum(["CSV", "XLSX"]),
});

@Controller("api/v1/items")
export class ImportController {
  constructor(
    @Inject(ImportService) private readonly imports: ImportService,
    @Inject(ExportService) private readonly exports: ExportService,
  ) {}

  @Get("import-jobs")
  @RequirePermissions("items.import.run")
  async list(@Query("cursor") cursor?: string, @Query("limit") limit?: string): Promise<unknown> {
    const page = await this.imports.list(cursor, LIMIT.parse(limit ?? undefined));
    return paginatedEnvelope(page.rows, {
      limit: page.rows.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ?? undefined,
    });
  }

  /** Dry-run preview (idempotent per upload token; writes nothing). */
  @Post("import-jobs")
  @RequirePermissions("items.import.run")
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = importJobCreateSchema.parse(body);
    return envelope(
      await this.imports.createJob(identity.userId, { ...input, fileName: input.fileName ?? null }),
    );
  }

  @Get("import-jobs/:id")
  @RequirePermissions("items.import.run")
  async get(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.imports.get(id));
  }

  /** Commit applies exactly the previewed rows (idempotent per token). */
  @Post("import-jobs/:id/commit")
  @RequirePermissions("items.import.run")
  @HttpCode(HttpStatus.OK)
  async commit(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.imports.commit(identity.userId, id));
  }

  /** Bounded export via the files module (signed URL; A11-tested). */
  @Post("export-jobs")
  @RequirePermissions("items.import.run")
  @HttpCode(HttpStatus.OK)
  async export(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = exportJobCreateSchema.parse(body);
    return envelope(await this.exports.run(identity.userId, input));
  }
}
