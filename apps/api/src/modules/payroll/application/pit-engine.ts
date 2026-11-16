import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { ownTenantCountryCode } from "../../../infra/settings/setting-reader";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import {
  foldPitBrackets,
  resolveExemptions,
  type ExemptionResult,
  type PitSlice,
} from "../domain/statutory-math";
import { PitBracketSetInvalidError, StatutoryRequiresVerificationError } from "../domain/statutory-errors";
import * as store from "../infrastructure/statutory.store";
import type { PitBracketRow } from "../infrastructure/statutory.store";

/**
 * PHASE-046 (W-2, T-04) — THE PIT WITHHOLDING ENGINE (D-03): the
 * effective-dated bracket-set resolution per period, the exemption
 * resolution (the set's defaults overridden per employee), and the
 * marginal fold with the explicit per-slice rounding (the G-40
 * discipline — the breakdown reconstructs the total to the last
 * half-unit; INV-032's exactness).
 *
 * THE LAWS:
 * - SET-CONSISTENCY (D-03): a bracket set tiles [0, ∞) bottom-up — the
 *   first floor is 0, every next floor equals the previous ceiling, no
 *   overlaps, no gaps, and the set-level allowance fields agree on every
 *   row; an inconsistent set is the typed PitBracketSetInvalidError
 *   (never a partial fold).
 * - THE HONEST NO-BRACKET STATE: a jurisdiction with NO bracket rows
 *   valid on the date computes ZERO PIT and says so (KSA — no employee
 *   PIT; never an invented bracket).
 * - BR-085: a REQUIRES_VERIFICATION bracket set that WOULD have applied
 *   refuses the computation typed (audited) — the blocked state, never a
 *   guessed rate.
 * - EXEMPTIONS: taxable = max(0, gross − personal − dependents ×
 *   per-dependent − other); the employee's overrides replace the set
 *   defaults field by field (absent = the default — never a fabricated
 *   value).
 */

/** One validated bracket set (grouped by code, sorted, tiling). */
export interface BracketSet {
  readonly code: string;
  readonly rows: readonly PitBracketRow[];
  readonly personalAllowanceDefault: string;
  readonly perDependentAllowance: string;
  readonly effectiveFrom: string;
  readonly status: PitBracketRow["status"];
}

export interface PitComputation {
  readonly jurisdictionCode: string;
  /** The set that priced the tax (null = the honest no-bracket state). */
  readonly bracketSet: BracketSet | null;
  readonly noBracketState: boolean;
  readonly exemptions: ExemptionResult | null;
  readonly slices: readonly PitSlice[];
  readonly taxable: string;
  readonly tax: string;
  readonly residualNote: string | null;
}

@Injectable()
export class PitEngine {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * The effective-dated bracket sets of a jurisdiction (grouped by code,
   * validated SET-CONSISTENT — an inconsistent set throws typed). All
   * statuses resolve; the compute applies the BR-085 gate.
   */
  async resolveSets(filter: {
    jurisdictionCode?: string;
    onDate: string;
  }): Promise<{ jurisdictionCode: string; sets: BracketSet[] }> {
    const jurisdictionCode = filter.jurisdictionCode ?? (await ownTenantCountryCode());
    const rows = await store.listBrackets({ jurisdictionCode, onDate: filter.onDate });
    const byCode = new Map<string, PitBracketRow[]>();
    for (const row of rows) {
      const group = byCode.get(row.code) ?? [];
      group.push(row);
      byCode.set(row.code, group);
    }
    const sets: BracketSet[] = [];
    for (const [code, group] of byCode) {
      const sorted = [...group].sort((a, b) => a.sort - b.sort);
      validateSetConsistency(jurisdictionCode, code, sorted);
      sets.push({
        code,
        rows: sorted,
        personalAllowanceDefault: sorted[0]!.personalAllowanceDefault,
        perDependentAllowance: sorted[0]!.perDependentAllowance,
        effectiveFrom: sorted[0]!.effectiveFrom,
        status: sorted[0]!.status,
      });
    }
    return { jurisdictionCode, sets };
  }

  /**
   * THE EMPLOYEE COMPUTATION: exemptions → the marginal fold. The
   * no-bracket jurisdiction computes ZERO PIT with the honest state; a
   * REQUIRES_VERIFICATION set refuses typed (BR-085, audited). The
   * rounding residual note states the fold's rounding points explicitly
   * (per-slice half-up 4dp, summed exactly — never absorbed).
   */
  async computeForEmployee(input: {
    employeeId: string;
    gross: string;
    pitExemptions?: { personalAllowance?: string; dependents?: string; other?: string } | null;
    onDate: string;
    jurisdictionCode?: string;
  }): Promise<PitComputation> {
    const jurisdictionCode = input.jurisdictionCode ?? (await ownTenantCountryCode());
    const { sets } = await this.resolveSets({ jurisdictionCode, onDate: input.onDate });
    if (sets.length === 0) {
      return {
        jurisdictionCode,
        bracketSet: null,
        noBracketState: true,
        exemptions: null,
        slices: [],
        taxable: "0.0000",
        tax: "0.0000",
        residualNote: `No PIT bracket set valid in ${jurisdictionCode} on ${input.onDate} — zero PIT computed (the honest no-bracket state; KSA carries no employee PIT)`,
      };
    }
    const set = sets[0]!;
    if (set.status !== "VERIFIED") {
      const row = set.rows[0]!;
      // The refusal's evidence survives the caller's rollback (its own
      // UoW — the same law as the profile service's BR-085 refusal).
      const tenantId = requireTenantContext().tenantId;
      await withTenant(tenantId, () =>
        this.audit.record({
          action: "payroll.statutory_refused",
          entityType: "payroll_tax_bracket",
          entityId: row.id,
          after: { jurisdictionCode, code: set.code, status: set.status, employeeId: input.employeeId },
        }),
      );
      throw new StatutoryRequiresVerificationError({
        jurisdictionCode,
        code: set.code,
        kind: "PIT_BRACKET",
        reviewNote: row.reviewNote,
      });
    }
    const exemptions = resolveExemptions({
      gross: input.gross,
      personalAllowanceDefault: set.personalAllowanceDefault,
      perDependentAllowance: set.perDependentAllowance,
      override: input.pitExemptions ?? null,
    });
    const fold = foldPitBrackets(
      exemptions.taxable,
      set.rows.map((row) => ({ floor: row.floor, ceiling: row.ceiling, rate: row.rate })),
    );
    return {
      jurisdictionCode,
      bracketSet: set,
      noBracketState: false,
      exemptions,
      slices: fold.slices,
      taxable: exemptions.taxable,
      tax: fold.tax,
      residualNote:
        fold.slices.length > 0
          ? "Each slice's amount rounds half-up at 4dp; the total is the exact sum of the rounded slices (no absorbed residual)"
          : null,
    };
  }
}

/** D-03's SET-CONSISTENT law: the sorted set tiles [0, ∞) — first floor
 * 0, next floor == previous ceiling (no gap, no overlap), and the
 * allowance fields agree on every row of the set. */
function validateSetConsistency(jurisdictionCode: string, code: string, sorted: readonly PitBracketRow[]): void {
  const first = sorted[0]!;
  if (first.floor !== "0.0000") {
    throw new PitBracketSetInvalidError({
      jurisdictionCode,
      code,
      reason: `the first band opens at ${first.floor}, not 0.0000 (the set must tile from zero)`,
    });
  }
  for (let index = 0; index < sorted.length; index += 1) {
    const row = sorted[index]!;
    if (index < sorted.length - 1) {
      const next = sorted[index + 1]!;
      if (row.ceiling === null) {
        throw new PitBracketSetInvalidError({
          jurisdictionCode,
          code,
          reason: `band ${index + 1} has an open top but a successor band exists (sort ${row.sort} → ${next.sort})`,
        });
      }
      if (row.ceiling !== next.floor) {
        throw new PitBracketSetInvalidError({
          jurisdictionCode,
          code,
          reason: `band ${index + 1} closes at ${row.ceiling} but band ${index + 2} opens at ${next.floor} (a gap or an overlap — the set must tile exactly)`,
        });
      }
    } else if (row.ceiling === null) {
      // The last band's open top is the legal shape.
    }
    if (
      row.personalAllowanceDefault !== first.personalAllowanceDefault ||
      row.perDependentAllowance !== first.perDependentAllowance
    ) {
      throw new PitBracketSetInvalidError({
        jurisdictionCode,
        code,
        reason: `band ${index + 1} carries different set-level allowance fields than band 1 (the defaults must be SET-CONSISTENT)`,
      });
    }
  }
}
