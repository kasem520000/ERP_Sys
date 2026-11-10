import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { TaxCodesService } from "../application/codes-service";
import { RegistrationService } from "../application/registration-service";
import { TaxResolverService } from "../application/tax-resolver-service";
import { VatReturnService } from "../application/vat-return-service";
import { PackService } from "../application/pack-service";
import { EInvoicingService } from "../application/einvoicing-service";
import { TaxReconciliationService } from "../application/tax-reconciliation-service";
import { SubmissionRegistryService } from "../submissions/registry-service";
import * as certs from "../certs/certificate-service";
import * as rollout from "../rollout/adapter-settings";
import { FilesService } from "../../files/application/files.service";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { findTenantCountry } from "../infrastructure/tax.store";

/** The tenant's own country (the registration migration's anchor). */
async function currentTenantCountry(): Promise<string> {
  const tenantId = requireTenantContext().tenantId;
  return (await findTenantCountry(tenantId)) ?? "SA";
}

/**
 * Tax routes (PHASE-009 §4; matrix §3.7): every route is permission-guarded,
 * Idempotency-Key'd by the global POST guard, and returns the success
 * envelope; foreign/unknown ids are 404-shaped (A7). Risky keys
 * (`tax.registrations.manage`, `tax.returns.mark_filed`) are audited in the
 * services; pack data is global read-only (seed-only — no writes through
 * the API).
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
const COUNTRY = z.string().length(2);
const MONEY = z.string().regex(/^-?\d+(\.\d{1,8})?$/, "decimal string");
const TREATMENT = z.enum([
  "STANDARD_RATED",
  "ZERO_RATED",
  "EXEMPT",
  "OUT_OF_SCOPE",
  "REVERSE_CHARGE",
  "NOT_SUBJECT",
]);

const taxCodeCreateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(160),
  nameAr: z.string().min(1).max(200).nullish(),
  countryCode: COUNTRY,
  defaultTreatment: TREATMENT,
});

const registrationUpsertSchema = z.object({
  countryCode: COUNTRY,
  status: z.enum(["REGISTERED", "NOT_REGISTERED", "DEREGISTERED"]),
  registrationNumber: z.string().min(3).max(50).nullish(),
  effectiveFrom: DATE,
  effectiveTo: DATE.nullish(),
  note: z.string().min(1).max(2000).nullish(),
});

const resolveLinesSchema = z.object({
  documentDate: DATE,
  countryCode: COUNTRY.optional(),
  pricingMode: z.enum(["EXCLUSIVE", "INCLUSIVE"]).optional(),
  lines: z
    .array(
      z.object({
        amount: MONEY,
        taxCodeId: UUID,
        currencyCode: z.string().length(3),
      }),
    )
    .min(1)
    .max(200),
});

const vatReturnCreateSchema = z.object({
  countryCode: COUNTRY,
  periodStart: DATE,
  periodEnd: DATE,
});

const markFiledSchema = z.object({
  filingReference: z.string().min(1).max(80).nullish(),
  filingNote: z.string().min(1).max(2000).nullish(),
});

const packApplySchema = z.object({ packVersion: z.string().min(1).max(40) });

const einvoicingSubmitSchema = z.object({
  countryCode: COUNTRY,
  sourceType: z.string().min(3).max(40),
  sourceId: UUID,
  document: z.record(z.string(), z.unknown()),
});

const certEnrollSchema = z.object({
  countryCode: COUNTRY,
  adapterId: z.string().min(2).max(40),
  label: z.string().min(1).max(120),
  keyVersion: z.string().min(1).max(40),
  pem: z.string().min(64).max(100_000),
  notBefore: z.string().min(10).max(40),
  notAfter: z.string().min(10).max(40),
  rotatedFromId: UUID.nullish(),
});

const adapterSettingSchema = z.object({
  countryCode: COUNTRY,
  enabled: z.boolean(),
});

@Controller("api/v1/tax")
export class TaxController {
  constructor(
    @Inject(TaxCodesService) private readonly codes: TaxCodesService,
    @Inject(RegistrationService) private readonly registrations: RegistrationService,
    @Inject(TaxResolverService) private readonly resolver: TaxResolverService,
    @Inject(VatReturnService) private readonly vatReturns: VatReturnService,
    @Inject(PackService) private readonly packs: PackService,
    @Inject(EInvoicingService) private readonly einvoicing: EInvoicingService,
    @Inject(TaxReconciliationService) private readonly reconciliation: TaxReconciliationService,
    @Inject(SubmissionRegistryService) private readonly submissionRegistry: SubmissionRegistryService,
    @Inject(FilesService) private readonly files: FilesService,
  ) {}

  // -- reference data (read-only packs + treatments) ------------------------------

  @Get("packs")
  @RequirePermissions("tax.returns.view")
  async listPacks(): Promise<unknown> {
    return envelope(await this.packs.listPacks());
  }

  @Get("packs/:country")
  @RequirePermissions("tax.returns.view")
  async findPack(@Param("country") country: string): Promise<unknown> {
    return envelope(await this.packs.findPack(country.toUpperCase()));
  }

  @Get("packs/:country/versions")
  @RequirePermissions("tax.returns.view")
  async packVersions(@Param("country") country: string): Promise<unknown> {
    return envelope(await this.packs.versions(country.toUpperCase()));
  }

  @Get("packs/:country/preview")
  @RequirePermissions("tax.returns.view")
  async packPreview(
    @Param("country") country: string,
    @Query("target") target?: string,
  ): Promise<unknown> {
    return envelope(
      await this.packs.preview(country.toUpperCase(), target ?? "1.0.0-baseline"),
    );
  }

  @Post("packs/:country/apply")
  @RequirePermissions("tax.codes.manage")
  @HttpCode(HttpStatus.OK)
  async packApply(
    @Req() request: Request,
    @Param("country") country: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = packApplySchema.parse(body);
    return envelope(
      await this.packs.apply({
        countryCode: country.toUpperCase(),
        packVersion: input.packVersion,
        actorId: identity.userId,
      }),
    );
  }

  // -- tax codes (§2.2; tax.codes.manage — audited) ---------------------------------

  @Get("tax-codes")
  @RequirePermissions("tax.codes.manage")
  async listCodes(
    @Query("country") country?: string,
    @Query("status") status?: string,
  ): Promise<unknown> {
    return envelope(await this.codes.list({ countryCode: country, status }));
  }

  @Post("tax-codes")
  @RequirePermissions("tax.codes.manage")
  async createCode(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = taxCodeCreateSchema.parse(body);
    return envelope(
      await this.codes.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        countryCode: input.countryCode.toUpperCase(),
        defaultTreatment: input.defaultTreatment,
        actorId: identity.userId,
      }),
    );
  }

  @Get("tax-codes/:id")
  @RequirePermissions("tax.codes.manage")
  async findCode(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.codes.find(id));
  }

  @Post("tax-codes/:id/archive")
  @RequirePermissions("tax.codes.manage")
  @HttpCode(HttpStatus.OK)
  async archiveCode(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.codes.archive(id, identity.userId));
  }

  // -- registrations (§2.3; tax.registrations.manage — RISKY, audited) ----------------

  @Get("tax-registrations")
  @RequirePermissions("tax.registrations.manage")
  async listRegistrations(): Promise<unknown> {
    // The expand step's migration anchor: the tenant's own country row (from
    // tenants.country_code via the settings-free context) migrates first.
    const tenantCountry = await currentTenantCountry();
    await this.registrations.ensureMigrated(tenantCountry);
    return envelope(await this.registrations.list());
  }

  @Post("tax-registrations")
  @RequirePermissions("tax.registrations.manage")
  async upsertRegistration(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = registrationUpsertSchema.parse(body);
    return envelope(
      await this.registrations.upsert({
        countryCode: input.countryCode.toUpperCase(),
        status: input.status,
        registrationNumber: input.registrationNumber ?? null,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- resolution preview (§2.5; deterministic, side-effect-free) ----------------------

  @Post("resolve-lines")
  @RequirePermissions("tax.codes.manage")
  async resolveLines(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    requireIdentity(request);
    const input = resolveLinesSchema.parse(body);
    return envelope(
      await this.resolver.resolve({
        documentDate: input.documentDate,
        pricingModeOverride: input.pricingMode,
        lines: input.lines,
      }),
    );
  }

  // -- VAT returns (§2.9; statuses + INV-012 cross-check + export) ----------------------

  @Get("vat-returns")
  @RequirePermissions("tax.returns.view")
  async listReturns(@Query("country") country?: string): Promise<unknown> {
    return envelope(await this.vatReturns.list(country));
  }

  @Post("vat-returns")
  @RequirePermissions("tax.returns.prepare")
  async createReturn(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = vatReturnCreateSchema.parse(body);
    return envelope(
      await this.vatReturns.createDraft({
        countryCode: input.countryCode.toUpperCase(),
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        actorId: identity.userId,
      }),
    );
  }

  @Get("vat-returns/:id")
  @RequirePermissions("tax.returns.view")
  async findReturn(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.vatReturns.find(id));
  }

  @Post("vat-returns/:id/prepare")
  @RequirePermissions("tax.returns.prepare")
  @HttpCode(HttpStatus.OK)
  async prepareReturn(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.vatReturns.prepare(id, identity.userId));
  }

  @Post("vat-returns/:id/mark-filed")
  @RequirePermissions("tax.returns.mark_filed")
  @HttpCode(HttpStatus.OK)
  async markFiled(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = markFiledSchema.parse(body);
    return envelope(
      await this.vatReturns.markFiled({
        id,
        filingReference: input.filingReference ?? null,
        filingNote: input.filingNote ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("vat-returns/:id/export")
  @RequirePermissions("tax.returns.prepare")
  @HttpCode(HttpStatus.OK)
  async exportReturn(
    @Req() request: Request,
    @Param("id") id: string,
    @Query("format") format?: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const resolved = format === "XLSX" ? "XLSX" : "CSV";
    return envelope(await this.vatReturns.export({ id, format: resolved, actorId: identity.userId }));
  }

  // -- INV-012 reconciliation (T11 — the framework registration) -----------------------

  @Post("reconciliation/vat-check")
  @RequirePermissions("tax.returns.view")
  @HttpCode(HttpStatus.OK)
  async vatCheck(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = z.object({ asOf: DATE }).parse(body);
    return envelope(
      await this.reconciliation.runVatCheck({
        asOf: input.asOf,
        runMode: "ON_DEMAND",
        checkedBy: identity.userId,
      }),
    );
  }

  // -- e-invoicing registry (T10 — queries; fake-adapter actions are test-only) ---------

  @Get("einvoicing/submissions")
  @RequirePermissions("tax.einvoicing.manage")
  async listSubmissions(
    @Query("country") country?: string,
    @Query("status") status?: string,
  ): Promise<unknown> {
    return envelope(await this.einvoicing.listSubmissions({ countryCode: country, status }));
  }

  @Get("einvoicing/submissions/:id")
  @RequirePermissions("tax.einvoicing.manage")
  async findSubmission(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.einvoicing.findSubmission(id));
  }

  @Get("einvoicing/adapters")
  @RequirePermissions("tax.einvoicing.manage")
  async listAdapters(): Promise<unknown> {
    return envelope(this.einvoicing.listAdapters());
  }

  @Post("einvoicing/submissions")
  @RequirePermissions("tax.einvoicing.manage")
  async submit(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = einvoicingSubmitSchema.parse(body);
    return envelope(
      await this.einvoicing.submit({
        payload: {
          countryCode: input.countryCode.toUpperCase(),
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          document: input.document,
        },
        actorId: identity.userId,
      }),
    );
  }

  // -- PHASE-023: the operational registry surface (T1/T5/T10/T13) ------------------

  /** Registry queries feed from the operational store (funnel/dashboard). */
  @Get("einvoicing/registry/submissions")
  @RequirePermissions("tax.einvoicing.manage")
  async registrySubmissions(
    @Query("country") country?: string,
    @Query("adapter") adapter?: string,
    @Query("status") status?: string,
    @Query("sourceType") sourceType?: string,
    @Query("sourceId") sourceId?: string,
  ): Promise<unknown> {
    return envelope(
      await this.submissionRegistry.listSubmissions({
        countryCode: country,
        adapterId: adapter,
        status,
        sourceType,
        sourceId,
      }),
    );
  }

  /** The per-tenant funnel aggregate (MONITORING §1 — the tenant surface). */
  @Get("einvoicing/funnel")
  @RequirePermissions("tax.einvoicing.manage")
  async funnel(): Promise<unknown> {
    return envelope(await this.submissionRegistry.funnel());
  }

  /** Resubmission after REJECTED/FAILED (TROUBLESHOOTING §10 — new row, history intact). */
  @Post("einvoicing/submissions/:id/resubmit")
  @RequirePermissions("tax.einvoicing.manage")
  async resubmit(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(
      await this.submissionRegistry.resubmit({ submissionId: id, actorId: identity.userId }),
    );
  }

  /** Certificate metadata + countdowns (NO key material — SECRETS §6.2). */
  @Get("einvoicing/certificates")
  @RequirePermissions("tax.einvoicing.manage")
  async listCertificates(): Promise<unknown> {
    return envelope({
      certificates: await certs.listCertificates(),
      signingVolume: await certs.signingVolume(),
    });
  }

  /** Enrollment trigger (admin workflow — the blob ships out-of-band; sealed at rest). */
  @Post("einvoicing/certificates/enroll")
  @RequirePermissions("tax.einvoicing.manage")
  async enrollCertificate(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = certEnrollSchema.parse(body);
    return envelope(
      await certs.enrollCertificate(this.files, {
        countryCode: input.countryCode.toUpperCase(),
        adapterId: input.adapterId,
        label: input.label,
        keyVersion: input.keyVersion,
        pem: input.pem,
        notBefore: input.notBefore,
        notAfter: input.notAfter,
        actorId: identity.userId,
        rotatedFromId: input.rotatedFromId ?? null,
      }),
    );
  }

  /** The tenant's adapter rollout flags (T13 — default OFF; enablement gated). */
  @Get("einvoicing/settings")
  @RequirePermissions("tax.einvoicing.manage")
  async adapterSettings(): Promise<unknown> {
    return envelope(await rollout.listAdapterSettings());
  }

  @Post("einvoicing/settings/:adapterId")
  @RequirePermissions("tax.einvoicing.manage")
  async setAdapterSetting(
    @Req() request: Request,
    @Param("adapterId") adapterId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = adapterSettingSchema.parse(body);
    return envelope(
      await rollout.setAdapterEnabled({
        adapterId,
        countryCode: input.countryCode.toUpperCase(),
        enabled: input.enabled,
        actorId: identity.userId,
      }),
    );
  }
}
