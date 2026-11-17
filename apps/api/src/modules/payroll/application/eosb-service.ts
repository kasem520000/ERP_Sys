import { Inject, Injectable } from "@nestjs/common";

import { sql } from "drizzle-orm";

import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ownTenantBaseCurrency, ownTenantCountryCode } from "../../../infra/settings/setting-reader";
import { lockPayrollEosbEmployee } from "../../hr/infrastructure/atomic";
import {
  foldEosbTiers,
  serviceYearsBetween,
  trueUpDelta,
  type EosbFoldResult,
} from "../domain/statutory-math";
import {
  EosbNoRuleError,
  EosbTrueUpInvalidError,
  StatutoryRequiresVerificationError,
} from "../domain/statutory-errors";
import { EmployeeNotFoundError, RunNotFoundError } from "../domain/payroll-errors";
import * as payrollStore from "../infrastructure/payroll.store";
import type { ComponentRow } from "../infrastructure/payroll.store";
import * as store from "../infrastructure/statutory.store";
import type { EosbCalculationKind, EosbCalculationRow } from "../infrastructure/statutory.store";
import { EosService } from "./eos-service";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";

/**
 * PHASE-046 (W-2, T-06) — THE EOSB ENGINE (D-04 + BR-087): the tier
 * resolution over the jurisdiction's rules, the per-employee entitlement
 * (the per-service-year tier fold over the 029 eosBase concept), and the
 * DELTA-ONLY TRUE-UP (G-54) — positive accrues DR EOS_PROVISION_EXPENSE ·
 * CR EOS_PROVISION, negative is the release mirror, ZERO posts nothing.
 *
 * THE LAWS:
 * - BR-087 — THE DELTA-ONLY TRUE-UP: only entitlement − standing
 *   provision (signed, 4dp exact — INV-032(c)) posts; the OPENING true-up
 *   on first adoption; TERMINATED employees settle only through the
 *   existing G-31 path (this service ALIGNS the provision first, the 029
 *   EosService.settle stays the settlement); the reconciliation view ties
 *   computed entitlement ↔ provision balance ↔ settled at every row.
 * - The 029 interplay: the provision balance is the 029 EosService's own
 *   `balanceFor` (Σ eos_accrual over POSTED run lines; the G-31
 *   extinguishes it) — this service never re-derives it.
 * - The eosBase snapshot (the 029 concept frozen at calculation time):
 *   basic + Σ is_eos_base ALLOWANCE values, priced exactly as the run's
 *   calculation prices them (the FIXED order: basic → PERCENT_OF_BASIC →
 *   PERCENT_OF_GROSS → FIXED; the per-component product rounds half-up
 *   4dp — the `payroll-rules` spec's law, mirrored here for the frozen
 *   snapshot).
 * - Every calculation records its evidence row (the tier breakdown + the
 *   wage-base snapshot + the signed delta) and stamps POSTED with its
 *   G-54 journal in the same UoW; BR-085 refuses a REQUIRES_VERIFICATION
 *   rule set; a jurisdiction with no matching rule is the typed
 *   EosbNoRuleError (fail-closed, never a guessed tier).
 */

/** The frozen wage-base snapshot (the 029 eosBase concept). */
export interface EosbWageBaseSnapshot {
  readonly basic: string;
  readonly components: readonly { key: string; name: string; amount: string }[];
  readonly eosBase: string;
}

/** The entitlement computation (no posting — the read/compute surface). */
export interface EosbEntitlement {
  readonly employeeId: string;
  readonly jurisdictionCode: string;
  readonly serviceYears: string;
  readonly wageBase: EosbWageBaseSnapshot;
  readonly fold: EosbFoldResult;
  readonly entitlement: string;
  readonly provisionBalance: string;
  readonly delta: string;
}

@Injectable()
export class EosbService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly eos: EosService,
  ) {}

  /**
   * The entitlement computation for one employee on a date: the tier
   * resolution (contract-type aware), the eosBase fold, the 029 provision
   * balance, and the signed true-up delta — NO posting (the trueUp act
   * posts; the reconciliation view and the screens read this).
   */
  async computeEntitlement(input: {
    employeeId: string;
    onDate: string;
    jurisdictionCode?: string;
  }): Promise<EosbEntitlement> {
    const employee = await payrollStore.findEmployeeById(input.employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(input.employeeId);
    const jurisdictionCode = input.jurisdictionCode ?? (await ownTenantCountryCode());
    const rules = await store.listEosbRules({
      jurisdictionCode,
      onDate: input.onDate,
      contractType: employee.contractType,
    });
    // The contract-type override REPLACES the default tier set: when
    // contract-specific rows exist for the employee's contract type, they
    // win; otherwise the NULL-contract rows (all types) apply. Never both
    // (a mixed fold would double-count the service years).
    const contractSpecific = rules.filter((rule) => rule.contractType !== null);
    const applicable =
      contractSpecific.length > 0
        ? contractSpecific
        : rules.filter((rule) => rule.contractType === null);
    const matching = applicable.filter((rule) => rule.status !== "RETIRED");
    const blocked = matching.filter((rule) => rule.status !== "VERIFIED");
    if (blocked.length > 0) {
      throw new StatutoryRequiresVerificationError({
        jurisdictionCode,
        code: `EOSB tier ${blocked[0]!.fromYears}..${blocked[0]!.toYears ?? "∞"}`,
        kind: "EOSB_RULE",
        reviewNote: blocked[0]!.reviewNote,
      });
    }
    if (matching.length === 0) {
      throw new EosbNoRuleError({
        jurisdictionCode,
        serviceYears: "n/a",
        contractType: employee.contractType,
        onDate: input.onDate,
      });
    }

    const throughDate =
      employee.status === "TERMINATED" && employee.terminationDate !== null
        ? employee.terminationDate
        : input.onDate;
    const serviceYears = serviceYearsBetween(employee.hireDate, throughDate);
    const wageBase = await foldWageBaseFor(employee.salaryStructureId, employee.basicSalary);
    const fold = foldEosbTiers(
      serviceYears,
      wageBase.eosBase,
      matching.map((rule) => ({
        fromYears: rule.fromYears,
        toYears: rule.toYears,
        daysPerYear: rule.daysPerYear,
      })),
    );
    // THE STANDING PROVISION (BR-087's zero-delta law demands it): the 029
    // machinery's balance (Σ eos_accrual over POSTED run lines, extinguished
    // at the G-31) PLUS the accumulated true-up deltas (each recorded in
    // eosb_calculations) — so a re-run with nothing changed computes delta
    // 0.0000 and posts NO journal (never a double true-up).
    const { balance } = await this.eos.balanceFor(employee.id);
    const priorCalculations = await store.listEosbCalculations({ employeeId: employee.id });
    let standing = balance;
    for (const prior of priorCalculations) {
      standing = addExact(standing, prior.delta);
    }
    const delta = trueUpDelta(fold.entitlement, standing);
    return {
      employeeId: employee.id,
      jurisdictionCode,
      serviceYears,
      wageBase,
      fold,
      entitlement: fold.entitlement,
      provisionBalance: standing,
      delta,
    };
  }

  /**
   * THE TRUE-UP ACT (BR-087): compute → record the evidence → post the
   * G-54 journal (the delta only) → stamp POSTED — one UoW.
   *
   * - OPENING — first adoption (no prior calculation rows); any
   *   non-terminated employee.
   * - PERIOD_TRUE_UP — the periodic re-alignment; any non-terminated
   *   employee whose provision has drifted from the entitlement.
   * - TERMINATION — the TERMINATED employee's alignment before the G-31
   *   settlement (the 029 path settles after this aligns).
   * A settled employee (the G-31 already extinguished the provision)
   * never true-ups again; a TERMINATION true-up on a non-terminated
   * employee is refused typed; a zero delta posts NO journal (the
   * zero-delta no-journal law — the evidence row still records the
   * computation).
   */
  async trueUp(input: {
    employeeId: string;
    kind: EosbCalculationKind;
    onDate: string;
    note?: string | null;
    actorId: string | null;
    runId?: string | null;
    fiscalPeriodId?: string | null;
    jurisdictionCode?: string;
  }): Promise<{ calculation: EosbCalculationRow; journalEntryId: string | null; delta: string }> {
    // D-09 THE EOSB EMPLOYEE GATE — before the guard reads: the true-up's
    // window (the provision read + the delta write) serializes against
    // another true-up AND the G-31 settle (which takes the same gate) —
    // the provision never double-counts, the settled employee's terminal
    // stamp never races a drifting delta.
    await lockPayrollEosbEmployee(input.employeeId);

    const employee = await payrollStore.findEmployeeById(input.employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(input.employeeId);
    if (employee.eosSettledAmount !== null) {
      throw new EosbTrueUpInvalidError({
        employeeId: employee.id,
        kind: input.kind,
        reason: "the employee is already settled (the G-31 extinguished the provision — no further true-ups)",
      });
    }
    if (input.kind === "TERMINATION" && employee.status !== "TERMINATED") {
      throw new EosbTrueUpInvalidError({
        employeeId: employee.id,
        kind: input.kind,
        reason: `the employee is ${employee.status} — terminate first (TERMINATED employees settle through G-31 after this alignment)`,
      });
    }
    if (input.kind !== "TERMINATION" && employee.status === "TERMINATED") {
      throw new EosbTrueUpInvalidError({
        employeeId: employee.id,
        kind: input.kind,
        reason: "a TERMINATED employee takes the TERMINATION true-up (then the G-31 settlement)",
      });
    }
    if (input.kind === "OPENING") {
      const prior = await store.listEosbCalculations({ employeeId: employee.id });
      if (prior.length > 0) {
        throw new EosbTrueUpInvalidError({
          employeeId: employee.id,
          kind: input.kind,
          reason: "an OPENING true-up exists only on first adoption (prior calculation rows present)",
        });
      }
    }

    const entitlement = await this.computeEntitlement({
      employeeId: employee.id,
      onDate: input.onDate,
      jurisdictionCode: input.jurisdictionCode,
    });
    const calculation = await store.insertEosbCalculation({
      employeeId: employee.id,
      kind: input.kind,
      serviceYears: entitlement.serviceYears,
      tierBreakdown: entitlement.fold.breakdown,
      wageBaseSnapshot: entitlement.wageBase,
      entitlementAmount: entitlement.entitlement,
      provisionBalance: entitlement.provisionBalance,
      delta: entitlement.delta,
      runId: input.runId ?? null,
      fiscalPeriodId: input.fiscalPeriodId ?? null,
      entryDate: input.onDate,
      note: input.note ?? null,
      createdBy: input.actorId,
    });

    let journalEntryId: string | null = null;
    if (compareExact(entitlement.delta, "0.0000") !== 0) {
      const base = await ownTenantBaseCurrency();
      const positive = compareExact(entitlement.delta, "0.0000") > 0;
      const amount = positive ? entitlement.delta : entitlement.delta.slice(1);
      const lines: JournalLineSpec[] = positive
        ? [
            {
              purpose: "EOS_PROVISION_EXPENSE",
              direction: "DEBIT",
              amount,
              memo: { en: "EOSB true-up accrual (G-54)", ar: "تسوية مخصص نهاية الخدمة (G-54)" },
            },
            {
              purpose: "EOS_PROVISION",
              direction: "CREDIT",
              amount,
              memo: { en: "EOSB true-up accrual (G-54)", ar: "تسوية مخصص نهاية الخدمة (G-54)" },
            },
          ]
        : [
            {
              purpose: "EOS_PROVISION",
              direction: "DEBIT",
              amount,
              memo: { en: "EOSB true-up release (G-54)", ar: "تحرير تسوية مخصص نهاية الخدمة (G-54)" },
            },
            {
              purpose: "EOS_PROVISION_EXPENSE",
              direction: "CREDIT",
              amount,
              memo: { en: "EOSB true-up release (G-54)", ar: "تحرير تسوية مخصص نهاية الخدمة (G-54)" },
            },
          ];
      const spec: JournalSpec = {
        source: { docType: "eosb_calculation", docId: calculation.id, operation: "eosb_true_up" },
        entryDate: input.onDate,
        description: {
          en: `EOSB ${input.kind} true-up — ${employee.code} (G-54)`,
          ar: `تسوية نهاية الخدمة (${input.kind}) — ${employee.code} (G-54)`,
        },
        currency: base,
        lines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      const stamped = await store.markEosbCalculationPosted(calculation.id, result.journalEntryId);
      journalEntryId = result.journalEntryId;
      if (stamped !== undefined) {
        Object.assign(calculation, stamped);
      }
    }
    await this.audit.record({
      action: "payroll.eosb_true_up",
      entityType: "eosb_calculation",
      entityId: calculation.id,
      actorId: input.actorId ?? undefined,
      after: {
        employeeId: employee.id,
        kind: input.kind,
        entitlement: entitlement.entitlement,
        provisionBalance: entitlement.provisionBalance,
        delta: entitlement.delta,
        journalEntryId,
      },
    });
    // D-05's run column: a true-up carrying the run reference advances
    // the run's eosb_trueup_total (Σ the G-54 deltas tied to this run —
    // the reconciliation's per-run view; the run row itself is not a
    // ledger document, so advancing the tracked total on the POSTED row
    // violates no append-only law — the journal is the evidence).
    if (input.runId !== null && input.runId !== undefined) {
      const run = await payrollStore.findRunById(input.runId);
      if (run === undefined) throw new RunNotFoundError(input.runId);
      await payrollStore.updateRun(input.runId, {
        eosbTrueupTotal: addExact(run.eosbTrueupTotal, entitlement.delta),
      });
    }
    return { calculation, journalEntryId, delta: entitlement.delta };
  }

  /**
   * THE RECONCILIATION VIEW (BR-087): computed entitlement ↔ provision
   * balance ↔ settled at every row — the standing tie between the EOSB
   * engine's computation and the 029 provision machinery.
   */
  async reconciliation(filter: {
    employeeId?: string;
  }): Promise<
    {
      employeeId: string;
      entitlement: string;
      provisionBalance: string;
      settled: string | null;
      alignedDelta: string;
      lastCalculation: EosbCalculationRow | null;
    }[]
  > {
    const employeeIds = new Set<string>();
    if (filter.employeeId !== undefined) {
      employeeIds.add(filter.employeeId);
    } else {
      const rows = await payrollStore.requireAmbientTx().execute<{ employee_id: string }>(
        sql`SELECT DISTINCT employee_id FROM eosb_calculations`,
      );
      for (const row of rows.rows as unknown as { employee_id: string }[]) {
        employeeIds.add(row.employee_id);
      }
    }
    const result: {
      employeeId: string;
      entitlement: string;
      provisionBalance: string;
      settled: string | null;
      alignedDelta: string;
      lastCalculation: EosbCalculationRow | null;
    }[] = [];
    for (const employeeId of employeeIds) {
      const employee = await payrollStore.findEmployeeById(employeeId);
      if (employee === undefined) continue;
      const { accrued, settled, balance } = await this.eos.balanceFor(employeeId);
      const calculations = await store.listEosbCalculations({ employeeId });
      const last = calculations[0] ?? null;
      // The standing provision (the 029 balance + the accumulated true-up
      // deltas — the same fold computeEntitlement uses) and the tie: the
      // entitlement vs the standing, zero when aligned.
      let standing = balance;
      for (const calculation of calculations) {
        standing = addExact(standing, calculation.delta);
      }
      result.push({
        employeeId,
        entitlement: last?.entitlementAmount ?? "0.0000",
        provisionBalance: standing,
        settled,
        alignedDelta: last === null ? accrued : subExact(last.entitlementAmount, standing),
        lastCalculation: last,
      });
    }
    return result;
  }
}

/**
 * The eosBase fold (the 029 concept): basic + Σ is_eos_base ALLOWANCE
 * values priced exactly as the run's calculation prices them — the
 * FIXED order (basic → PERCENT_OF_BASIC → PERCENT_OF_GROSS → FIXED),
 * each component's product rounded half-up 4dp, PERCENT_OF_GROSS
 * reading the earnings accumulated before it (the calculation's own
 * law, mirrored here for the snapshot).
 */
async function foldWageBaseFor(
  structureId: string | null,
  basic: string,
): Promise<EosbWageBaseSnapshot> {
  const components: ComponentRow[] =
    structureId === null ? [] : await payrollStore.listComponents(structureId);
  const ordered = [...components].sort(
    (a, b) => componentOrder(a) - componentOrder(b) || a.seq - b.seq,
  );
  let gross = basic;
  const eosBaseComponents: { key: string; name: string; amount: string }[] = [];
  let eosBase = basic;
  for (const component of ordered.filter((c) => c.kind !== "DEDUCTION")) {
    const amount = priceComponent(component, { basic, gross });
    if (component.kind === "ALLOWANCE") {
      gross = addExact(gross, amount);
      if (component.isEosBase) {
        eosBase = addExact(eosBase, amount);
        eosBaseComponents.push({ key: component.key, name: component.name, amount });
      }
    }
  }
  return { basic, components: eosBaseComponents, eosBase };
}

/** The FIXED calculation order (the calculation service's law, mirrored). */
function componentOrder(component: ComponentRow): number {
  if (component.calc === "PERCENT_OF_BASIC") return 1;
  if (component.calc === "PERCENT_OF_GROSS") return 2;
  return 3;
}

/** One component's priced value (the calculation service's law, mirrored). */
function priceComponent(component: ComponentRow, basis: { basic: string; gross: string }): string {
  if (component.calc === "FIXED") {
    return new Decimal(component.amount ?? "0").toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  }
  const base = component.calc === "PERCENT_OF_BASIC" ? basis.basic : basis.gross;
  return new Decimal(base)
    .times(new Decimal(component.rate ?? "0"))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}
