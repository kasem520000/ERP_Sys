import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/tax.store";
import {
  JurisdictionNotFoundError,
  PackBindingInvalidError,
} from "../domain/tax-errors";

/**
 * PHASE-009 T13 — pack lifecycle service (COUNTRY_PACKS §6): version
 * viewer, staged preview → apply per tenant (audited), and the BR-033
 * draft-spanning warnings. Pack upgrades NEVER rewrite posted snapshots —
 * a version bump ships as a seed migration (changelog + verification
 * record per SEEDS rule 2) and tenants move versions via apply; drafts
 * spanning an effective-date boundary are flagged on open via the
 * resolver's boundaryWarning surface.
 */
@Injectable()
export class PackService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The pack registry view (all 10, verification status front and center). */
  async listPacks() {
    const packs = await store.listJurisdictions();
    return Promise.all(
      packs.map(async (pack) => ({
        ...pack,
        rates: await store.listJurisdictionRates(pack.id),
      })),
    );
  }

  async findPack(countryCode: string) {
    const pack = await store.findJurisdictionByCountry(countryCode);
    if (pack === undefined) throw new JurisdictionNotFoundError(countryCode);
    return { ...pack, rates: await store.listJurisdictionRates(pack.id) };
  }

  /**
   * Version history for a pack: the effective-dated rate windows + the
   * current seeded pack version + the tenant's pinned binding (when any).
   */
  async versions(countryCode: string) {
    const pack = await this.findPack(countryCode);
    const binding = await store.findPackBinding(countryCode);
    return {
      countryCode,
      packVersion: pack.packVersion,
      verificationStatus: pack.verificationStatus,
      tenantBinding: binding ?? null,
      windows: pack.rates.map((row) => ({
        treatment: row.treatment,
        rate: row.rate,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        sourceRef: row.sourceRef,
        verifiedAt: row.verifiedAt,
      })),
    };
  }

  /**
   * Staged upgrade preview (admin diff): what changes between the tenant's
   * current binding and a target version — the rate-window diff plus the
   * upcoming boundary (draft-spanning warnings read the same surface).
   */
  async preview(countryCode: string, targetVersion: string) {
    const pack = await this.findPack(countryCode);
    const binding = await store.findPackBinding(countryCode);
    const currentVersion = binding?.packVersion ?? pack.packVersion;
    if (targetVersion !== pack.packVersion) {
      // Only seeded versions exist today — an unknown target is invalid
      // (upgrades ship as seed migrations; this endpoint always previews a
      // REAL seeded version, never a hypothetical).
      throw new PackBindingInvalidError(
        `pack ${countryCode} has no seeded version "${targetVersion}" (current: ${pack.packVersion})`,
      );
    }
    return {
      countryCode,
      currentVersion,
      targetVersion,
      changed: currentVersion !== targetVersion,
      windows: pack.rates.map((row) => ({
        treatment: row.treatment,
        rate: row.rate,
        effectiveFrom: row.effectiveFrom,
        effectiveTo: row.effectiveTo,
        sourceRef: row.sourceRef,
      })),
      note:
        currentVersion === targetVersion
          ? "no rate-window changes between the pinned and target versions"
          : "rate-window changes listed; posted snapshots are never rewritten (BR-033)",
    };
  }

  /** Staged apply: pin the tenant to a seeded version + audit the rollout. */
  async apply(input: { countryCode: string; packVersion: string; actorId: string | null }) {
    const pack = await this.findPack(input.countryCode);
    if (input.packVersion !== pack.packVersion) {
      throw new PackBindingInvalidError(
        `pack ${input.countryCode} has no seeded version "${input.packVersion}" (current: ${pack.packVersion})`,
      );
    }
    const before = await store.findPackBinding(input.countryCode);
    const binding = await store.upsertPackBinding({
      countryCode: input.countryCode,
      packVersion: input.packVersion,
      appliedBy: input.actorId,
    });
    await this.audit.record({
      action: "tax.pack_applied",
      entityType: "tax_pack_binding",
      entityId: binding.id,
      actorId: input.actorId ?? undefined,
      before: before === undefined ? undefined : { packVersion: before.packVersion },
      after: { countryCode: input.countryCode, packVersion: input.packVersion },
    });
    return binding;
  }
}
