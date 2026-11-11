import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope, paginatedEnvelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { ImportKindUnknownError as OnboardingImportKindUnknownError } from "../domain/onboarding-errors";
import { FilesService } from "../../files/api/files";
import { ImportToolkitService } from "../application/import-toolkit-service";
import { MappingsService } from "../application/mappings-service";
import { MIGRATION_ADAPTERS, adapterTemplateCsv, findAdapter } from "../application/adapters";

/**
 * PHASE-040 import toolkit routes (§2.8; matrix §3.18 — all under
 * `configuration.imports.manage`, the back-office hub permission): the kind
 * catalog, header preview + auto-detect, preview-gated import jobs (dry-run
 * first, BR-066 atomic commit), the saved-mapping CRUD (both directions),
 * the bilingual error-report export, and the direct-upload slot for import
 * files (the files module's tenant-prefixed presigned PUT — the job's
 * fileKey references it; A11 cross-tenant guard applies at read).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const LIMIT = z.coerce.number().int().min(1).max(100).default(25);

const TOOLKIT_KINDS = [
  "COA",
  "ACCOUNT_OPENING_BALANCES",
  "FIXED_ASSETS",
  "EMPLOYEES",
  "PRICE_LISTS",
  "CONTRACTS",
  "BUDGETS",
] as const;

const jobCreateSchema = z.object({
  kind: z.enum(TOOLKIT_KINDS),
  format: z.enum(["CSV", "XLSX"]),
  uploadToken: z.string().min(8).max(128),
  fileKey: z.string().min(3).max(400),
  fileName: z.string().min(1).max(200).nullish(),
  mappingId: z.string().uuid().nullish(),
  options: z.record(z.string(), z.unknown()).nullish(),
  columnMap: z.record(z.string(), z.string()).nullish(),
});

const commitSchema = z.object({
  acknowledged: z.boolean().default(false),
});

const previewHeadersSchema = z.object({
  fileKey: z.string().min(3).max(400),
  format: z.enum(["CSV", "XLSX"]),
  kind: z.enum(TOOLKIT_KINDS).optional(),
});

const uploadIssueSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.enum(["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  sizeBytes: z.number().int().min(1).max(32 * 1024 * 1024),
});

const mappingCreateSchema = z.object({
  name: z.string().min(1).max(100),
  direction: z.enum(["IMPORT", "EXPORT"]),
  kind: z.string().min(2).max(40),
  entity: z.string().min(2).max(60).nullish(),
  columnMap: z.record(z.string(), z.unknown()),
  options: z.record(z.string(), z.unknown()).nullish(),
});

const mappingUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  columnMap: z.record(z.string(), z.unknown()).optional(),
  options: z.record(z.string(), z.unknown()).nullish(),
});

@Controller("api/v1/imports")
export class ImportsController {
  constructor(
    @Inject(ImportToolkitService) private readonly imports: ImportToolkitService,
    @Inject(MappingsService) private readonly mappings: MappingsService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  // -- wizard ----------------------------------------------------------------------

  @Get("kinds")
  @RequirePermissions("configuration.imports.manage")
  async kinds(): Promise<unknown> {
    return envelope(this.imports.listKinds());
  }

  @Post("preview-headers")
  @RequirePermissions("configuration.imports.manage")
  @HttpCode(HttpStatus.OK)
  async previewHeaders(@Body() body: unknown): Promise<unknown> {
    const input = previewHeadersSchema.parse(body);
    return envelope(await this.imports.previewHeaders(input));
  }

  /**
   * The direct-upload slot for import files (the files module's presigned
   * PUT; tenant-prefixed key; csv/xlsx only; 32 MiB — the toolkit bound).
   */
  @Post("uploads")
  @RequirePermissions("configuration.imports.manage")
  @HttpCode(HttpStatus.OK)
  async issueUpload(@Body() body: unknown): Promise<unknown> {
    const input = uploadIssueSchema.parse(body);
    const issued = await this.files.issueUploadUrl(requireTenantContext().tenantId, {
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    return envelope(issued);
  }

  // -- import jobs (BR-066 dry-run → commit) -----------------------------------------

  @Get("jobs")
  @RequirePermissions("configuration.imports.manage")
  async list(@Query("cursor") cursor?: string, @Query("limit") limit?: string): Promise<unknown> {
    const page = await this.imports.listJobs(cursor, LIMIT.parse(limit ?? undefined));
    return paginatedEnvelope(page.rows, {
      limit: page.rows.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ?? undefined,
    });
  }

  @Post("jobs")
  @RequirePermissions("configuration.imports.manage")
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = jobCreateSchema.parse(body);
    return envelope(
      await this.imports.createJob(identity.userId, {
        kind: input.kind,
        format: input.format,
        uploadToken: input.uploadToken,
        fileKey: input.fileKey,
        fileName: input.fileName ?? null,
        mappingId: input.mappingId ?? null,
        options: input.options ?? null,
        columnMap: input.columnMap ?? null,
      }),
    );
  }

  @Get("jobs/:id")
  @RequirePermissions("configuration.imports.manage")
  async get(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.imports.getJob(id));
  }

  @Post("jobs/:id/commit")
  @RequirePermissions("configuration.imports.manage")
  @HttpCode(HttpStatus.OK)
  async commit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = commitSchema.parse(body ?? {});
    return envelope(await this.imports.commit(identity.userId, id, input.acknowledged));
  }

  @Get("jobs/:id/error-report")
  @RequirePermissions("configuration.imports.manage")
  async errorReport(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.imports.errorReportUrl(id));
  }

  // -- migration adapters (IN-26 — extract-then-import) ------------------------------

  @Get("adapters")
  @RequirePermissions("configuration.imports.manage")
  async adapters(): Promise<unknown> {
    return envelope(MIGRATION_ADAPTERS);
  }

  @Get("adapters/:key/template")
  @RequirePermissions("configuration.imports.manage")
  async adapterTemplate(@Param("key") key: string): Promise<unknown> {
    const adapter = findAdapter(key);
    if (adapter === undefined) {
      throw new OnboardingImportKindUnknownError(`migration adapter ${key}`);
    }
    const tenantId = requireTenantContext().tenantId;
    const key2 = await this.files.writeArtifact(
      tenantId,
      "migration_adapters",
      `${adapter.key}.csv`,
      Buffer.from(adapterTemplateCsv(adapter), "utf8"),
    );
    const url = await this.files.issueDownloadUrl(tenantId, key2);
    return envelope({ key: adapter.key, url });
  }

  // -- saved mappings (both directions) ------------------------------------------------

  @Get("mappings")
  @RequirePermissions("configuration.imports.manage")
  async listMappings(
    @Query("direction") direction?: string,
    @Query("kind") kind?: string,
  ): Promise<unknown> {
    return envelope(await this.mappings.list(direction, kind));
  }

  @Post("mappings")
  @RequirePermissions("configuration.imports.manage")
  @HttpCode(HttpStatus.OK)
  async createMapping(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = mappingCreateSchema.parse(body);
    return envelope(
      await this.mappings.create(identity.userId, {
        name: input.name,
        direction: input.direction,
        kind: input.kind,
        entity: input.entity ?? null,
        columnMap: input.columnMap,
        options: input.options ?? null,
      }),
    );
  }

  @Patch("mappings/:id")
  @RequirePermissions("configuration.imports.manage")
  async updateMapping(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = mappingUpdateSchema.parse(body);
    return envelope(await this.mappings.update(identity.userId, id, input));
  }

  @Delete("mappings/:id")
  @RequirePermissions("configuration.imports.manage")
  async deleteMapping(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    await this.mappings.remove(identity.userId, id);
    return envelope({ deleted: true });
  }
}
