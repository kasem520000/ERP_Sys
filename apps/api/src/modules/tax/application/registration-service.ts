import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/tax.store";
import {
  JurisdictionNotFoundError,
  RegistrationDeregisteredShapeError,
  RegistrationNumberNotAllowedError,
  RegistrationNumberRequiredError,
} from "../domain/tax-errors";

/**
 * PHASE-009 T4 — tax registrations service: per-jurisdiction status
 * (REGISTERED / NOT_REGISTERED / DEREGISTERED) with the registration number
 * + effective dates. Owns the PHASE-004 settings migration (expand step of
 * expand → dual-read → contract, MIGRATION_STRATEGY §3): the first read
 * migrates the provisional `tax.registration.*` values into
 * `tax_registrations`; the legacy keys stay readable during the dual-read
 * window (the contract step is a later phase's decision record — the
 * migration plan is documented in both phase reports).
 *
 * `tax.registrations.manage` is a RISKY matrix key: every write is audited
 * (matrix §3.7), and registration transitions NEVER rewrite posted
 * snapshots (BR-033 — the resolver stamps NOT_SUBJECT only for new
 * resolutions).
 */
@Injectable()
export class RegistrationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * The expand step: when no row exists for the tenant's bound jurisdiction,
   * migrate the legacy PHASE-004 settings (status + number + binding).
   * Idempotent — the second call is a no-op. The tenant's country_code is
   * the default jurisdiction when no explicit binding was recorded.
   */
  async ensureMigrated(tenantCountryCode: string): Promise<void> {
    const existing = await store.listTaxRegistrations();
    if (existing.length > 0) return;
    const legacy = await store.readLegacyRegistrationSettings();
    const countryCode =
      legacy.binding !== null && legacy.binding.country_code.length === 2
        ? legacy.binding.country_code
        : tenantCountryCode;
    const jurisdiction = await store.findJurisdictionByCountry(countryCode);
    if (jurisdiction === undefined) return; // no seeded pack for this country — nothing to migrate yet
    const status =
      legacy.status === "REGISTERED" || legacy.status === "DEREGISTERED" || legacy.status === "NOT_REGISTERED"
        ? legacy.status
        : "NOT_REGISTERED";
    const number = legacy.number !== null && legacy.number.length > 0 ? legacy.number : null;
    if (status === "REGISTERED" && number === null) {
      // The legacy pair's cross-key rule guarantees a number while REGISTERED;
      // a drifted store cannot migrate — leave the row absent (fail loud on
      // the next explicit upsert, which validates properly).
      return;
    }
    const migrated = await store.upsertTaxRegistration({
      countryCode,
      status,
      registrationNumber: number,
      effectiveFrom: "2020-01-01",
      effectiveTo: null,
      deregisteredAt: status === "DEREGISTERED" ? "2020-01-01" : null,
      note: "migrated from PHASE-004 tax.registration.* settings (expand step)",
      createdBy: null,
    });
    await this.audit.record({
      action: "tax.registration_migrated",
      entityType: "tax_registration",
      entityId: migrated.id,
      after: { countryCode, status, migratedFrom: "tenant_settings:tax.registration.*" },
    });
  }

  async list() {
    return store.listTaxRegistrations();
  }

  /**
   * Upsert one jurisdiction's registration (risky — audited). REGISTERED
   * requires a number; NOT_REGISTERED/DEREGISTERED must not carry one;
   * DEREGISTERED requires deregistered_at. The transition fixture
   * (NOT_REGISTERED → REGISTERED) leaves posted snapshots untouched — there
   * is nothing here that touches posted data by construction.
   */
  async upsert(input: {
    countryCode: string;
    status: "REGISTERED" | "NOT_REGISTERED" | "DEREGISTERED";
    registrationNumber: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    actorId: string | null;
    note?: string | null;
  }) {
    const jurisdiction = await store.findJurisdictionByCountry(input.countryCode);
    if (jurisdiction === undefined) throw new JurisdictionNotFoundError(input.countryCode);
    if (input.status === "REGISTERED" && (input.registrationNumber === null || input.registrationNumber.length < 3)) {
      throw new RegistrationNumberRequiredError(input.countryCode);
    }
    if (input.status !== "REGISTERED" && input.registrationNumber !== null && input.registrationNumber.length > 0) {
      throw new RegistrationNumberNotAllowedError(input.countryCode);
    }
    const before = await store.findTaxRegistrationByCountry(input.countryCode);
    if (input.status === "DEREGISTERED" && before?.status !== "DEREGISTERED") {
      // deregistered_at defaults to the effective window start.
      const row = await store.upsertTaxRegistration({
        countryCode: input.countryCode,
        status: input.status,
        registrationNumber: null,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        deregisteredAt: input.effectiveFrom,
        note: input.note ?? null,
        createdBy: input.actorId,
      });
      await this.auditUp(input, before, row);
      return row;
    }
    if (input.status !== "DEREGISTERED") {
      const row = await store.upsertTaxRegistration({
        countryCode: input.countryCode,
        status: input.status,
        registrationNumber: input.registrationNumber,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
        deregisteredAt: null,
        note: input.note ?? null,
        createdBy: input.actorId,
      });
      await this.auditUp(input, before, row);
      return row;
    }
    throw new RegistrationDeregisteredShapeError(
      `DEREGISTERED rows cannot carry a registration number (got "${input.registrationNumber ?? ""}")`,
    );
  }

  private async auditUp(
    input: Parameters<RegistrationService["upsert"]>[0],
    before: Awaited<ReturnType<typeof store.findTaxRegistrationByCountry>>,
    after: Awaited<ReturnType<typeof store.upsertTaxRegistration>>,
  ) {
    await this.audit.record({
      action: "tax.registration_upserted",
      entityType: "tax_registration",
      entityId: after.id,
      actorId: input.actorId ?? undefined,
      before: before === undefined ? undefined : { status: before.status },
      after: { countryCode: after.countryCode, status: after.status },
    });
  }
}
