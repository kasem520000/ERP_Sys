import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/domain/identity-errors";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { withTenant } from "../../../infra/db/tenant-context";
import {
  CUSTOM_FIELD_ENTITIES,
  definitionCreateSchema,
  definitionPatchSchema,
  formLayoutUpsertSchema,
  picklistCreateSchema,
  picklistOptionCreateSchema,
  picklistOptionPatchSchema,
  picklistPatchSchema,
  picklistReorderSchema,
} from "../domain/custom-fields-schema";
import * as definitions from "../application/custom-field-service";
import * as picklists from "../application/picklist-service";
import * as layouts from "../application/form-layout-service";

/**
 * PHASE-036 T3–T7 custom-fields routes (matrix §3.8; ADR-0019):
 *
 * - `GET /custom-fields/surface?entityType=` — the render payload (ACTIVE
 *   definitions + inlined ACTIVE picklist options) — a SESSION route
 *   (SESSION_ROUTES): every tenant member renders entity forms, the
 *   BR-039 derived-only pattern; RLS scopes the rows.
 * - `GET /custom-fields/entities` — the code-owned entity registry
 *   (session route: the manager + designers read it before any
 *   permission-bearing write).
 * - `GET|POST /custom-fields/definitions`, `PATCH
 *   /custom-fields/definitions/:id`, `POST …/:id/archive|restore` — the
 *   definitions manager (`configuration.custom_fields.read` / `.manage`).
 * - `GET|POST /custom-fields/picklists`, `PATCH /custom-fields/picklists/:id`,
 *   `POST …/:id/archive|restore`, `POST …/:id/options`,
 *   `PATCH /custom-fields/picklist-options/:optionId`,
 *   `POST …/options/:optionId/archive|restore`,
 *   `POST /custom-fields/picklists/:id/options/reorder` — the picklist
 *   editor (FD-20).
 * - `GET /form-layouts?entityType=` + `PUT /form-layouts/:entityType` +
 *   `PUT|DELETE /form-layouts/:entityType/roles/:roleKey` — the form
 *   designer (FD-19; `configuration.form_layouts.manage`; BR-059).
 * - `GET /custom-fields/values/:entityType/:entityId` — the values read
 *   for one entity row (read key; the surface renders).
 *
 * Every route carries `@RequireFeature("platform.custom_fields")` (the
 * plan gate — business + enterprise per migration 0049's grant tail)
 * EXCEPT the session surface routes, which every tenant member reaches
 * (a starter tenant simply has zero definitions). Every handler runs
 * inside the TenantContextInterceptor's tenant UoW; all bodies are
 * zod-validated (VALIDATION_ERROR on shape drift); typed domain errors
 * map through the shared ERROR_MODEL filter.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

function requireTenantIdentity(request: Request): SessionContext & { tenantId: string } {
  const identity = requireIdentity(request);
  if (identity.activeTenantId === null) {
    throw new UnauthenticatedError();
  }
  return { ...identity, tenantId: identity.activeTenantId };
}

const entityTypeQuerySchema = z
  .object({ entityType: z.string().min(1).max(64) })
  .strict();

const roleKeyParamSchema = z
  .object({ roleKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) })
  .strict();

@Controller("api/v1/configuration")
export class CustomFieldsController {
  // -- session surface (BR-039 derived-only; every tenant member) ----------

  /** The render payload: ACTIVE definitions for one entity with the bound
   *  picklists' ACTIVE options inlined — what the entity form pages and
   *  CustomFieldSurface consume. */
  @Get("custom-fields/surface")
  async surface(@Req() request: Request, @Query() query: unknown): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const { entityType } = entityTypeQuerySchema.parse(query);
    return envelope(
      await withTenant(identity.tenantId, () => definitions.listSurfaceDefinitions(entityType)),
    );
  }

  /** The code-owned entity registry (ADR-0019): entity types, labels and
   *  the native-field lists the designer renders (BR-059 mandatory flags). */
  @Get("custom-fields/entities")
  async entities(@Req() request: Request): Promise<unknown> {
    requireTenantIdentity(request);
    return envelope(
      CUSTOM_FIELD_ENTITIES.map((entity) => ({
        entityType: entity.entityType,
        label: entity.label,
        labelAr: entity.labelAr,
        nativeFields: entity.nativeFields,
      })),
    );
  }

  // -- definitions manager (FD-18) -------------------------------------------

  @Get("custom-fields/definitions")
  @RequirePermissions("configuration.custom_fields.read")
  @RequireFeature("platform.custom_fields")
  async listDefinitions(@Req() request: Request, @Query("entityType") entityType?: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(
      await withTenant(identity.tenantId, () => definitions.listDefinitions(entityType)),
    );
  }

  @Post("custom-fields/definitions")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async createDefinition(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = definitionCreateSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () =>
        definitions.createDefinition(identity.userId, input),
      ),
    );
  }

  @Patch("custom-fields/definitions/:id")
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async updateDefinition(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = definitionPatchSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () => definitions.updateDefinition(identity.userId, id, input)),
    );
  }

  @Post("custom-fields/definitions/:id/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async archiveDefinition(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => definitions.archiveDefinition(id)));
  }

  @Post("custom-fields/definitions/:id/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async restoreDefinition(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => definitions.restoreDefinition(id)));
  }

  // -- picklists (FD-20) ---------------------------------------------------------

  @Get("custom-fields/picklists")
  @RequirePermissions("configuration.custom_fields.read")
  @RequireFeature("platform.custom_fields")
  async listPicklists(@Req() request: Request): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => picklists.listPicklists()));
  }

  @Get("custom-fields/picklists/:id")
  @RequirePermissions("configuration.custom_fields.read")
  @RequireFeature("platform.custom_fields")
  async getPicklist(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(
      await withTenant(identity.tenantId, () => picklists.listPicklistWithOptions(id)),
    );
  }

  @Post("custom-fields/picklists")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async createPicklist(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = picklistCreateSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () => picklists.createPicklist(identity.userId, input)),
    );
  }

  @Patch("custom-fields/picklists/:id")
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async updatePicklist(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = picklistPatchSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () => picklists.updatePicklist(id, input)),
    );
  }

  @Post("custom-fields/picklists/:id/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async archivePicklist(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => picklists.archivePicklist(id)));
  }

  @Post("custom-fields/picklists/:id/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async restorePicklist(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => picklists.restorePicklist(id)));
  }

  @Post("custom-fields/picklists/:id/options")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async addOption(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = picklistOptionCreateSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () => picklists.addOption(identity.userId, id, input)),
    );
  }

  @Patch("custom-fields/picklist-options/:optionId")
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async updateOption(
    @Req() request: Request,
    @Param("optionId") optionId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = picklistOptionPatchSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () => picklists.updateOption(optionId, input)),
    );
  }

  @Post("custom-fields/picklist-options/:optionId/archive")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async archiveOption(@Req() request: Request, @Param("optionId") optionId: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => picklists.archiveOption(optionId)));
  }

  @Post("custom-fields/picklist-options/:optionId/restore")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async restoreOption(@Req() request: Request, @Param("optionId") optionId: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(await withTenant(identity.tenantId, () => picklists.restoreOption(optionId)));
  }

  @Post("custom-fields/picklists/:id/options/reorder")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("configuration.custom_fields.manage")
  @RequireFeature("platform.custom_fields")
  async reorderOptions(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = picklistReorderSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () => picklists.reorderOptions(id, input.optionIds)),
    );
  }

  // -- form layouts (FD-19/UX-12; BR-059) ---------------------------------------

  @Get("form-layouts")
  @RequirePermissions("configuration.custom_fields.read")
  @RequireFeature("platform.custom_fields")
  async listLayouts(@Req() request: Request, @Query("entityType") entityType?: string): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    if (entityType === undefined) {
      return envelope(
        await withTenant(identity.tenantId, async () => {
          const out: Array<{ entityType: string; layouts: readonly unknown[] }> = [];
          for (const entity of CUSTOM_FIELD_ENTITIES) {
            out.push({
              entityType: entity.entityType,
              layouts: await layouts.listLayouts(entity.entityType),
            });
          }
          return out;
        }),
      );
    }
    return envelope(
      await withTenant(identity.tenantId, () => layouts.listLayouts(entityType)),
    );
  }

  @Put("form-layouts/:entityType")
  @RequirePermissions("configuration.form_layouts.manage")
  @RequireFeature("platform.custom_fields")
  async upsertDefaultLayout(
    @Req() request: Request,
    @Param("entityType") entityType: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const input = formLayoutUpsertSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () =>
        layouts.upsertLayout(identity.userId, entityType, null, input),
      ),
    );
  }

  @Put("form-layouts/:entityType/roles/:roleKey")
  @RequirePermissions("configuration.form_layouts.manage")
  @RequireFeature("platform.custom_fields")
  async upsertRoleLayout(
    @Req() request: Request,
    @Param("entityType") entityType: string,
    @Param("roleKey") roleKeyRaw: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const { roleKey } = roleKeyParamSchema.parse({ roleKey: roleKeyRaw });
    const input = formLayoutUpsertSchema.parse(body);
    return envelope(
      await withTenant(identity.tenantId, () =>
        layouts.upsertLayout(identity.userId, entityType, roleKey, input),
      ),
    );
  }

  @Delete("form-layouts/:entityType/roles/:roleKey")
  @RequirePermissions("configuration.form_layouts.manage")
  @RequireFeature("platform.custom_fields")
  async deleteRoleLayout(
    @Req() request: Request,
    @Param("entityType") entityType: string,
    @Param("roleKey") roleKeyRaw: string,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    const { roleKey } = roleKeyParamSchema.parse({ roleKey: roleKeyRaw });
    await withTenant(identity.tenantId, () => layouts.deleteOverride(entityType, roleKey));
    return envelope({ deleted: true });
  }

  // -- entity values read (the surface's value companion) ----------------------

  @Get("custom-fields/values/:entityType/:entityId")
  @RequirePermissions("configuration.custom_fields.read")
  @RequireFeature("platform.custom_fields")
  async readValues(
    @Req() request: Request,
    @Param("entityType") entityType: string,
    @Param("entityId") entityId: string,
  ): Promise<unknown> {
    const identity = requireTenantIdentity(request);
    return envelope(
      await withTenant(identity.tenantId, () => definitions.readValues(entityType, entityId)),
    );
  }
}
