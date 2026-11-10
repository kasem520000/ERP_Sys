import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { ForbiddenError, UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { CategoryService } from "../application/category-service";
import { AssetService } from "../application/asset-service";
import { CapitalizationService } from "../application/capitalization-service";
import { PurchaseCapitalizationService } from "../application/purchase-capitalization";
// P26-B (T6/T7 — depreciation runs): the run services + the bounded assembly
// job's controller-facing entry (startAssembly = create-or-reuse + enqueue).
import { DepreciationService } from "../application/depreciation-service";
import { RunService } from "../application/run-service";
import { cancelAssembly, startAssembly } from "../infrastructure/depreciation-assembly.job";

/**
 * Fixed-assets routes (PHASE-026 §4; matrix §3.11): every route is
 * permission-guarded with the exact seeded keys, `Idempotency-Key`-guarded
 * by the global POST guard (IDEMPOTENCY §1.1), and returns the success
 * envelope. Foreign/unknown ids are 404-shaped (A7 — no existence
 * disclosure; RLS makes them indistinguishable). The register/listing
 * surfaces are branch-scoped by the guard per §3.11.
 *
 * Section map (append-only — later P26 waves add their routes here):
 *   - categories (T2)          — below
 *   - assets register (T3)     — below
 *   - capitalization (T4/T5)   — below
 *   - depreciation runs        — P26-B appends
 *   - revaluations / disposals — P26-C appends
 *   - reports                  — P26-D appends
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const UUID = z.string().uuid();
const CODE = z.string().min(1).max(60);
/** Non-negative canonical money (ADR-0009 wire rule, ≤ 4dp). */
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const UNITS = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)");
const METHOD = z.enum(["STRAIGHT_LINE", "DECLINING_BALANCE", "UNITS_OF_PRODUCTION"]);
const PURPOSE_KEY = z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/, "purpose key shape");
const LIFE = z.coerce.number().int().min(1).max(1200);
const TEXT = z.string().min(1).max(500).nullable().optional();

// -- categories (T2 — settings archetype §8) --------------------------------------

const createCategorySchema = z.object({
  code: CODE,
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  usefulLifeMonthsDefault: LIFE,
  depreciationMethodDefault: METHOD,
  assetPurposeKey: PURPOSE_KEY,
  accumDepreciationPurposeKey: PURPOSE_KEY,
  expensePurposeKey: PURPOSE_KEY,
  note: TEXT,
  noteAr: TEXT,
});

const updateCategorySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    nameAr: z.string().min(1).max(200).optional(),
    usefulLifeMonthsDefault: LIFE.optional(),
    depreciationMethodDefault: METHOD.optional(),
    assetPurposeKey: PURPOSE_KEY.optional(),
    accumDepreciationPurposeKey: PURPOSE_KEY.optional(),
    expensePurposeKey: PURPOSE_KEY.optional(),
    active: z.boolean().optional(),
    note: TEXT,
    noteAr: TEXT,
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

// -- asset register (T3 — list+search §2 / create-edit §3) ------------------------

const createAssetSchema = z.object({
  code: CODE,
  name: z.string().min(1).max(300),
  nameAr: z.string().min(1).max(300),
  categoryId: UUID,
  branchId: UUID,
  acquisitionDate: DATE,
  cost: MONEY,
  salvageValue: MONEY.optional(),
  openingAccumulated: MONEY.optional(),
  usefulLifeMonths: LIFE.optional(),
  depreciationMethod: METHOD.optional(),
  totalEstimatedUnits: UNITS.nullable().optional(),
  custodianUserId: UUID.nullable().optional(),
  note: TEXT,
  noteAr: TEXT,
});

const updateAssetSchema = z
  .object({
    name: z.string().min(1).max(300).optional(),
    nameAr: z.string().min(1).max(300).optional(),
    branchId: UUID.optional(),
    custodianUserId: UUID.nullable().optional(),
    note: TEXT,
    noteAr: TEXT,
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

// -- capitalization (T4/T5 — G-21) -------------------------------------------------

const fundingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CREDIT"), partnerId: UUID }),
  z.object({ kind: z.literal("CASH") }),
  z.object({
    kind: z.literal("OPENING"),
    openingEquityPurposeKey: PURPOSE_KEY.optional(),
  }),
]);

const capitalizeSchema = z.object({
  funding: fundingSchema,
  postingDate: DATE,
  description: z.string().min(1).max(500).nullable().optional(),
});

const fromPurchaseSchema = z.object({
  code: CODE,
  name: z.string().min(1).max(300),
  nameAr: z.string().min(1).max(300),
  categoryId: UUID,
  cost: MONEY,
  supplierInvoiceId: UUID,
  grnId: UUID.nullable().optional(),
  poId: UUID.nullable().optional(),
  branchId: UUID.optional(),
  acquisitionDate: DATE.optional(),
  salvageValue: MONEY.optional(),
  openingAccumulated: MONEY.optional(),
  usefulLifeMonths: LIFE.optional(),
  depreciationMethod: METHOD.optional(),
  totalEstimatedUnits: UNITS.nullable().optional(),
  custodianUserId: UUID.nullable().optional(),
  postingDate: DATE.optional(),
  note: TEXT,
  noteAr: TEXT,
});

// -- depreciation runs (P26-B — T6 assembly / T7 G-22 post + INV-014 reverse) --------

const assembleRunSchema = z.object({
  fiscalPeriodId: UUID,
  /** UoP manual usage per asset id (DR-002 — no metering; ≤ 6dp). */
  unitsByAssetId: z.record(UUID, UNITS).optional(),
});

const postRunSchema = z.object({
  /** PC-02: required when the period is SOFT_CLOSED (extra permission below). */
  softCloseReason: z.string().min(3).max(500).optional(),
});

const reverseRunSchema = z.object({
  reason: z.string().min(1).max(500),
});

const recomputeLineUnitsSchema = z.object({
  periodUnits: UNITS,
});

@Controller("/api/v1/fixed-assets")
export class FixedAssetsController {
  constructor(
    @Inject(CategoryService) private readonly categories: CategoryService,
    @Inject(AssetService) private readonly assets: AssetService,
    @Inject(CapitalizationService) private readonly capitalization: CapitalizationService,
    @Inject(PurchaseCapitalizationService) private readonly purchase: PurchaseCapitalizationService,
    // P26-B (T6/T7).
    @Inject(DepreciationService) private readonly depreciation: DepreciationService,
    @Inject(RunService) private readonly runs: RunService,
  ) {}

  // -- categories (T2 — BR-041 purpose links; Settings screen §8) ------------------

  @Get("categories")
  @RequirePermissions("fixed_assets.categories.manage")
  listCategories(@Query("active") active?: string) {
    return envelope(
      this.categories.list({ activeOnly: active === undefined ? undefined : active === "true" }),
    );
  }

  @Post("categories")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("fixed_assets.categories.manage")
  async createCategory(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createCategorySchema.parse(body);
    return envelope(
      await this.categories.create({
        ...input,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("categories/:id")
  @RequirePermissions("fixed_assets.categories.manage")
  async updateCategory(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = updateCategorySchema.parse(body);
    return envelope(await this.categories.update(id, input, identity.userId));
  }

  // -- asset register (T3) -----------------------------------------------------------

  @Get("assets")
  @RequirePermissions("fixed_assets.assets.view")
  listAssets(
    @Query("search") search?: string,
    @Query("categoryId") categoryId?: string,
    @Query("branchId") branchId?: string,
    @Query("status") status?: string,
    @Query("custodianUserId") custodianUserId?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const statusEnum = z.enum(["ACTIVE", "FULLY_DEPRECIATED", "DISPOSED", "WRITTEN_OFF"]).optional();
    return envelope(
      this.assets.list({
        search: search !== undefined && search !== "" ? search : undefined,
        categoryId: UUID.optional().parse(categoryId),
        branchId: UUID.optional().parse(branchId),
        status: statusEnum.parse(status),
        custodianUserId: UUID.optional().parse(custodianUserId),
        limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 50),
        offset: z.coerce.number().int().min(0).parse(offset ?? 0),
      }),
    );
  }

  @Post("assets")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("fixed_assets.assets.create")
  async createAsset(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createAssetSchema.parse(body);
    return envelope(
      await this.assets.create({
        ...input,
        salvageValue: input.salvageValue ?? "0",
        openingAccumulated: input.openingAccumulated ?? "0",
        totalEstimatedUnits: input.totalEstimatedUnits ?? null,
        custodianUserId: input.custodianUserId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("assets/:id")
  @RequirePermissions("fixed_assets.assets.view")
  async findAsset(@Param("id") id: string) {
    return envelope(await this.assets.detail(id));
  }

  @Patch("assets/:id")
  @RequirePermissions("fixed_assets.assets.manage")
  async updateAsset(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateAssetSchema.parse(body);
    return envelope(await this.assets.edit(id, input, identity.userId));
  }

  // -- direct capitalization (T4 — G-21 credit/cash/opening) --------------------------

  @Post("assets/:id/capitalize")
  @RequirePermissions("fixed_assets.assets.create")
  capitalizeAsset(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = capitalizeSchema.parse(body);
    return envelope(
      this.capitalization.capitalize({
        assetId: id,
        funding: input.funding,
        postingDate: input.postingDate,
        description: input.description ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- purchase capitalization (T5 — direct off a POSTED supplier invoice) ------------

  @Post("assets/from-purchase")
  @RequirePermissions("fixed_assets.assets.create")
  createAssetFromPurchase(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = fromPurchaseSchema.parse(body);
    return envelope(
      this.purchase.createFromPurchase({
        ...input,
        grnId: input.grnId ?? null,
        poId: input.poId ?? null,
        salvageValue: input.salvageValue ?? "0",
        openingAccumulated: input.openingAccumulated ?? "0",
        totalEstimatedUnits: input.totalEstimatedUnits ?? null,
        custodianUserId: input.custodianUserId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- depreciation runs (P26-B: T6 assembly + T7 G-22 post/reverse) ------------------

  /** Workspace index: the tenant's runs with period name/status joined. */
  @Get("depreciation-runs")
  @RequirePermissions("fixed_assets.depreciation_runs.view")
  listDepreciationRuns(@Query("status") status?: string, @Query("limit") limit?: string) {
    const statusEnum = z.enum(["DRAFT", "POSTED"]).optional();
    return envelope(
      this.runs.listRuns({
        status: statusEnum.parse(status),
        limit: z.coerce.number().int().min(1).max(200).parse(limit ?? 100),
      }),
    );
  }

  /** The run workspace: run + period + per-line live NBV preview (§4 archetype). */
  @Get("depreciation-runs/:id")
  @RequirePermissions("fixed_assets.depreciation_runs.view")
  async getDepreciationRun(@Param("id") id: string) {
    return envelope(await this.runs.getRunWorkspace(id));
  }

  /**
   * Create-or-reuse the period's DRAFT run, then hand assembly to the
   * bounded pg-boss job (ADR-0008 — 500-asset chunks, cancelable, idempotent
   * per period). Returns { runId, jobId, reusedDraft } immediately; the
   * workspace polls GET /:id. 409 DEPRECIATION_RUN_PERIOD_TAKEN when the
   * period's run is not a re-assemblable DRAFT (one run per period, BR-042).
   */
  @Post("depreciation-runs/assemble")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("fixed_assets.depreciation_runs.run")
  async assembleDepreciationRun(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = assembleRunSchema.parse(body);
    return envelope(
      await startAssembly({
        fiscalPeriodId: input.fiscalPeriodId,
        actorId: identity.userId,
        ...(input.unitsByAssetId !== undefined
          ? { unitsByAssetId: input.unitsByAssetId }
          : {}),
      }),
    );
  }

  /**
   * Cancel an in-flight DRAFT assembly (ADR-0008 cancel surface): in-process
   * flag + best-effort queue cancel; an in-flight job rolls its transaction
   * back at the next chunk probe (zero residue, run stays DRAFT).
   */
  @Post("depreciation-runs/:id/cancel-assembly")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("fixed_assets.depreciation_runs.run")
  async cancelDepreciationAssembly(@Param("id") id: string) {
    return envelope(await cancelAssembly(id));
  }

  /**
   * Workspace UoP edit: re-assemble the DRAFT with one asset's period units
   * overridden (depreciation_lines is append-only 🔒 — the sanctioned edit is
   * the whole-DRAFT reset + recompute; existing units are preserved, and the
   * run's assembled_by re-stamps from its prior assembler/creator).
   */
  @Post("depreciation-runs/:id/lines/:assetId/units")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("fixed_assets.depreciation_runs.run")
  async recomputeDepreciationLine(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("assetId") assetId: string,
    @Body() body: unknown,
  ) {
    requireIdentity(request); // permission-guarded surface; the run re-stamps its own assembler
    const input = recomputeLineUnitsSchema.parse(body);
    return envelope(await this.depreciation.recomputeDraftLine(id, assetId, input.periodUnits));
  }

  /**
   * Post the assembled run (G-22, JOURNAL_RULES §7): DR depreciation
   * expense / CR accumulated depreciation per asset (≤ 50 assets — above
   * that the pairs collapse per category), engine INV-013 idempotency on
   * (DEPRECIATION_RUN, runId, post). LOCKED periods → PERIOD_LOCKED;
   * SOFT_CLOSED periods need softCloseReason AND the PC-02 posting
   * permission (checked here — the service mirrors the failure shape).
   */
  @Post("depreciation-runs/:id/post")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("fixed_assets.depreciation_runs.post")
  async postDepreciationRun(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = postRunSchema.parse(body ?? {});
    if (
      input.softCloseReason !== undefined &&
      identity.permissions?.has("accounting.periods.post_to_soft_closed") !== true
    ) {
      // PC-02 (fail-closed): the PermissionsGuard pre-resolved the set for
      // this request (the route key above forced it).
      throw new ForbiddenError("accounting.periods.post_to_soft_closed");
    }
    return envelope(
      await this.runs.postRun({
        runId: id,
        actorId: identity.userId,
        ...(input.softCloseReason !== undefined
          ? { softCloseReason: input.softCloseReason }
          : {}),
      }),
    );
  }

  /**
   * Reverse a posted run (INV-014): engine counter-entry on the run's
   * journal entry; the run keeps status POSTED + its append-only lines and
   * gains reversal_journal_entry_id/reversed_at/reversal_reason. Re-do path
   * after a reverse = re-assemble (the DRAFT reuse of the same run row).
   */
  @Post("depreciation-runs/:id/reverse")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("fixed_assets.depreciation_runs.run")
  async reverseDepreciationRun(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = reverseRunSchema.parse(body);
    return envelope(
      await this.runs.reverseRun({ runId: id, actorId: identity.userId, reason: input.reason }),
    );
  }

  // -- revaluations (P26-C: /revaluations[/{id}/post] appends here —
  //    fixed_assets.revaluations.*) ----------------------------------------------------

  // -- disposals (P26-C: /disposals[/{id}/approve|/post] appends here —
  //    fixed_assets.disposals.*, SoD second-user approve) -------------------------------

  // -- reports (P26-D: the three report contract surfaces appends here —
  //    fixed_assets.reports.view) -------------------------------------------------------
}
