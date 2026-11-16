import { Inject, Injectable } from "@nestjs/common";

import { addExact } from "../../accounting/application/decimal-strings";
import { AuditService } from "../../audit/api/audit";
import { ownTenantCountryCode } from "../../../infra/settings/setting-reader";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import {
  clampBase,
  contributionAmount,
  foldWageBase,
  matchesAppliesTo,
  type AppliesTo,
  type ContributoryComponentValue,
} from "../domain/statutory-math";
import {
  StatutoryAlreadyVerifiedError,
  StatutoryProfileNotFoundError,
  StatutoryRequiresVerificationError,
  StatutoryVerifySoDError,
} from "../domain/statutory-errors";
import * as store from "../infrastructure/statutory.store";
import type { StatutoryProfileRow } from "../infrastructure/statutory.store";

/**
 * PHASE-046 (W-2, T-03) — THE STATUTORY PROFILE SERVICE: the
 * effective-dated row-set resolution (D-01), the wage-base fold + the cap
 * clamps (pure `statutory-math` — the attendance-classification
 * precedent), the BR-085 fail-closed gate, and the verify act (the CAS +
 * SoD + audit, D-10).
 *
 * THE LAWS:
 * - EFFECTIVE-DATED RESOLUTION: the period's END date picks the set
 *   (`effective_from ≤ onDate ≤ effective_to | ∞`); future and retired
 *   rows never match.
 * - THE APPLIES-TO SPLIT (D-01/D-02): CITIZEN rows match only nationals
 *   of the tenant's jurisdiction (the tenant's country_code), NON_CITIZEN
 *   the complement, ALL everyone — and a NULL nationality matches NOTHING
 *   (fail-closed: the resolution returns NO rows + the explicit
 *   `unpricedNationality` warning; never a guessed rate — BR-055).
 * - BR-085 — THE VERIFICATION GATE: a REQUIRES_VERIFICATION row that
 *   WOULD have matched the employee refuses the whole resolution typed
 *   (the AE/EG/JO blocked state: the row exists to surface the refusal,
 *   never a guessed rate); the refusal is audited.
 * - THE VERIFY ACT (D-10): one conditional UPDATE (the CAS — only a
 *   REQUIRES_VERIFICATION row flips), the SoD law (the verifier ≠ the
 *   row's last editor), the audit trail; the loser of a concurrent pair
 *   reads the flipped row back for its typed 409.
 */

/** One matched VERIFIED row's computed contribution (the 4dp-exact pair). */
export interface ResolvedContribution {
  readonly profileId: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly appliesTo: AppliesTo;
  /** The contributory wage base: the basic + Σ matched component values
   *  (the KSA law — contributory_keys lists the ALLOWANCE keys that ride
   *  the always-included basic; DATA, never hard-coded). */
  readonly wageBase: string;
  /** The base after the row's [base_min, base_max] clamp. */
  readonly clampedBase: string;
  readonly clampedBy: "MIN" | "MAX" | null;
  readonly employeeRate: string;
  readonly employerRate: string;
  readonly employeeAmount: string;
  readonly employerAmount: string;
}

/** The explicit warning vocabulary (D-02 + the plan's warning surface). */
export interface StatutoryWarning {
  readonly code: "unpricedNationality";
  readonly message: string;
  readonly employeeId: string;
  readonly jurisdictionCode: string;
}

export interface StatutoryResolution {
  readonly jurisdictionCode: string;
  readonly nationality: string | null;
  readonly contributions: readonly ResolvedContribution[];
  readonly warnings: readonly StatutoryWarning[];
  /** The employee/employer totals (4dp-exact sums of the row amounts). */
  readonly employeeTotal: string;
  readonly employerTotal: string;
}

@Injectable()
export class StatutoryProfileService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * The effective-dated row-set of a jurisdiction on a date — every row
   * (any status) the date resolves; the read surface for the compliance
   * screens and the blocked-state visibility. Pure read: no gate, no
   * warnings — the caller sees exactly what the calendar holds.
   */
  async resolveSet(filter: {
    jurisdictionCode?: string;
    onDate: string;
  }): Promise<{ jurisdictionCode: string; rows: StatutoryProfileRow[] }> {
    const jurisdictionCode = filter.jurisdictionCode ?? (await ownTenantCountryCode());
    const rows = await store.listProfiles({ jurisdictionCode, onDate: filter.onDate });
    return { jurisdictionCode, rows };
  }

  /**
   * THE EMPLOYEE RESOLUTION (the run's statutory arm, W-3's consumer):
   * the applies-to split over the effective-dated VERIFIED rows, the
   * wage-base fold per row (the BASIC + the matched allowance components
   * — the contributory_keys are the ALLOWANCE keys riding the always-
   * included basic), the clamps, and the 4dp-exact pair per row.
   *
   * - NULL nationality → NO rows + the `unpricedNationality` warning
   *   (fail-closed, D-02 — the run surfaces the warning, never a rate);
   * - a matching REQUIRES_VERIFICATION row → the typed BR-085 refusal
   *   (audited) — the whole resolution refuses, never a partial price;
   * - otherwise the per-row contributions + the exact totals.
   */
  async resolveForEmployee(input: {
    employeeId: string;
    nationality: string | null;
    /** The employee's basic salary — always the contributory base's floor. */
    basic: string;
    /** The priced salary components (allowances/deductions) — the
     *  contributory_keys select which ride the base. */
    components: readonly ContributoryComponentValue[];
    onDate: string;
    jurisdictionCode?: string;
  }): Promise<StatutoryResolution> {
    const jurisdictionCode = input.jurisdictionCode ?? (await ownTenantCountryCode());
    const warnings: StatutoryWarning[] = [];
    if (input.nationality === null || input.nationality === undefined) {
      warnings.push({
        code: "unpricedNationality",
        message: `Employee ${input.employeeId} carries no nationality — no statutory lines priced (set employees.nationality; D-02 fail-closed)`,
        employeeId: input.employeeId,
        jurisdictionCode,
      });
      return {
        jurisdictionCode,
        nationality: null,
        contributions: [],
        warnings,
        employeeTotal: "0.0000",
        employerTotal: "0.0000",
      };
    }

    const { rows } = await this.resolveSet({ jurisdictionCode, onDate: input.onDate });
    // RETIRED rows never participate: withdrawn schedules neither price nor
    // block (the BR-085 gate is the blocked-state surface, not the retired
    // one). Future/retired-by-date rows never matched the store read.
    const live = rows.filter((row) => row.status !== "RETIRED");
    const matched = live.filter((row) => matchesAppliesTo(row.appliesTo, input.nationality, jurisdictionCode));
    const blocked = matched.filter((row) => row.status !== "VERIFIED");
    if (blocked.length > 0) {
      const row = blocked[0]!;
      // The refusal's evidence SURVIVES the caller's rollback: the audit
      // records in its OWN unit of work (a fresh pooled connection — the
      // typed throw below rolls the caller's transaction back, and the
      // blocked-state fact stands regardless).
      const tenantId = requireTenantContext().tenantId;
      await withTenant(tenantId, () =>
        this.audit.record({
          action: "payroll.statutory_refused",
          entityType: "statutory_profile",
          entityId: row.id,
          after: { jurisdictionCode, code: row.code, status: row.status, employeeId: input.employeeId },
        }),
      );
      throw new StatutoryRequiresVerificationError({
        jurisdictionCode,
        code: row.code,
        kind: "CONTRIBUTION_PROFILE",
        reviewNote: row.reviewNote,
      });
    }

    const contributions: ResolvedContribution[] = matched.map((row) => {
      const wageBase = addExact(input.basic, foldWageBase(input.components, row.contributoryKeys));
      const { clamped, clampedBy } = clampBase(wageBase, row.baseMin, row.baseMax);
      return {
        profileId: row.id,
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        appliesTo: row.appliesTo,
        wageBase,
        clampedBase: clamped,
        clampedBy,
        employeeRate: row.employeeRate,
        employerRate: row.employerRate,
        employeeAmount: contributionAmount(row.employeeRate, clamped),
        employerAmount: contributionAmount(row.employerRate, clamped),
      };
    });
    let employeeTotal = "0.0000";
    let employerTotal = "0.0000";
    for (const contribution of contributions) {
      employeeTotal = addExact(employeeTotal, contribution.employeeAmount);
      employerTotal = addExact(employerTotal, contribution.employerAmount);
    }
    return { jurisdictionCode, nationality: input.nationality, contributions, warnings, employeeTotal, employerTotal };
  }

  /**
   * THE VERIFY ACT (BR-085's flip + D-10's SoD + the audit trail): only
   * a REQUIRES_VERIFICATION row flips; the verifier records the citation
   * the flip rests on (the 0089 VERIFIED⟺source CHECK — a verification is
   * always against a source, never a bare assertion); the verifier may
   * not be the row's last editor; the flip is ONE conditional UPDATE so a
   * concurrent pair collapses to one verified row and one typed 409.
   */
  async verify(input: {
    profileId: string;
    actorId: string;
    sourceName: string;
    sourceRef?: string | null;
  }): Promise<StatutoryProfileRow> {
    const row = await store.findProfileById(input.profileId);
    if (row === undefined) {
      throw new StatutoryProfileNotFoundError(input.profileId);
    }
    if (row.status === "VERIFIED") {
      throw new StatutoryAlreadyVerifiedError({ id: row.id, code: row.code, verifiedBy: row.verifiedBy });
    }
    if (row.updatedBy !== null && row.updatedBy === input.actorId) {
      throw new StatutoryVerifySoDError({ id: row.id, actorId: input.actorId, lastEditedBy: row.updatedBy });
    }
    const flipped = await store.verifyProfileCas(input.profileId, input.actorId, input.sourceName, input.sourceRef ?? null);
    if (flipped === undefined) {
      // The CAS lost: either a concurrent verify flipped it (the typed
      // 409 below) or the row retired between the read and the CAS
      // (re-read decides — retired is also a typed refusal surface).
      const after = await store.findProfileById(input.profileId);
      if (after !== undefined && after.status === "VERIFIED") {
        throw new StatutoryAlreadyVerifiedError({ id: after.id, code: after.code, verifiedBy: after.verifiedBy });
      }
      if (after !== undefined && after.status === "RETIRED") {
        throw new StatutoryRequiresVerificationError({
          jurisdictionCode: after.jurisdictionCode,
          code: after.code,
          kind: "CONTRIBUTION_PROFILE",
          reviewNote: "the row retired while the verify was in flight",
        });
      }
      throw new StatutoryProfileNotFoundError(input.profileId);
    }
    await this.audit.record({
      action: "payroll.statutory_verified",
      entityType: "statutory_profile",
      entityId: flipped.id,
      actorId: input.actorId,
      before: { status: row.status },
      after: { status: "VERIFIED", code: flipped.code, jurisdictionCode: flipped.jurisdictionCode },
    });
    return flipped;
  }
}
