import { Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { ActualsInputInvalidError, Inv033ReconciliationError, ProjectPlaneNotFoundError } from "../domain/projects-errors";
import {
  allocateOverhead,
  hourlyCostRate,
  monthlyEmployerCost,
  valueHoursAtRate,
} from "../domain/projects-math";
import * as store from "../infrastructure/projects.store";

/**
 * PHASE-048 (W-9 — T-07) — the actual collectors + INV-033 (D-05): the
 * four AC legs, each reading ITS OWN source tables read-only, and the
 * typed reconciliation service that refuses to report at any residual.
 *
 * THE FOUR LEGS (the owner's T-07 wording, the plan D-05):
 *
 * - LABOR = the APPROVED-class time entries on the WBS dimension × the
 *   employee cost rates READ from the payroll data (D-01: 048 NEVER
 *   writes a payroll table). The rate = the ACTIVE salary structure's
 *   monthly employer cost (basic + allowances + employer contributions,
 *   the payroll fold's documented order) ÷ the tenant's configured
 *   standard monthly hours — SNAPSHOTTED AT VALUATION (the rate card in
 *   the output is the snapshot's evidence; the crm_time_entries.unitRate
 *   precedent). While the divisor is unset the entries land UNPRICED
 *   with the explicit warning — an honest zero, never a fabricated rate
 *   (the payroll.variable.overtime_hours_per_day precedent). BILLED is
 *   the post-invoice terminal of an approved entry — excluding it would
 *   fabricate a cost drop at billing; DRAFT/VOID never cost.
 * - MATERIALS = the 044 WMS issue paths READ-ONLY: the stock issue
 *   moves whose POSTING carries the project stamp, valued at the MOVE's
 *   own value (the WMS source — never re-derived from the GL, so
 *   INV-033's materials leg stays independent of its GL target). When
 *   no issue posting ties to the project: the honest zero with the
 *   degraded note (the phase doc's soft-dependency law — صفر أمين لا
 *   صفر مختلق).
 * - SUBCONTRACT = the APPROVED certificates' NET values (the owner's
 *   wording — صافي قيم المستخلصات; the retention leg is the W-11
 *   retention engine's world).
 * - OVERHEAD = the tenant-configured distributor (the
 *   projects.overhead_distributor setting — driver + pool accounts): the
 *   pool's net GL carry distributed over the projects by the driver
 *   share (LABOR_HOURS or DIRECT_COST) — the PURE fold, one half-up
 *   rounding per project at 4 dp. While unset: the honest zero with the
 *   degraded note (red line 5 — no fabricated allocation).
 *
 * INV-033 (the EVM consistency invariant, the INV-032(b) tolerance-0
 * spirit): per project, AC = labor + materials + subcontract + the
 * allocated overhead, reconciling to the GL project dimension (the net
 * DEBIT carry of the project-stamped journal lines) TO THE CENT — the
 * typed service REFUSES to report at any residual, carrying the full
 * per-leg breakdown in the refusal (auditable and actionable).
 */

const UUID_RE = /^[0-9a-fA-F-]{36}$/;

/** The overhead distributor setting's shape (settings-schema.ts). */
interface OverheadDistributorSetting {
  driver: "LABOR_HOURS" | "DIRECT_COST";
  pool_account_ids: string[];
}

export interface LaborNodeBreakdown {
  wbsTaskId: string;
  hours: string;
  amount: string;
}

export interface ActualsBreakdown {
  projectId: string;
  labor: {
    total: string;
    entries: number;
    byNode: LaborNodeBreakdown[];
    /** The valuation-time rate snapshot (D-01's evidence). */
    rateCard: ReadonlyArray<{ employeeId: string; monthlyEmployerCost: string; hourlyRate: string }>;
    unpriced: {
      count: number;
      hours: string;
      reasons: string[];
    };
  };
  materials: {
    total: string;
    moves: number;
    /** True when no project-tied issue posting exists — the honest zero. */
    degraded: boolean;
  };
  subcontract: {
    total: string;
    certificates: ReadonlyArray<{ id: string; certificateDate: string; certificateNo: string | null; netPayable: string }>;
  };
  overhead: {
    allocated: string;
    pool: string;
    share: string;
    driver: string | null;
    /** True while the distributor setting is unset — the honest zero. */
    degraded: boolean;
    projectsSharingThePool: number;
  };
  acTotal: string;
}

export interface Inv033Report {
  projectId: string;
  labor: string;
  materials: string;
  subcontract: string;
  overheadAllocated: string;
  acTotal: string;
  glProjectDimension: { debit: string; credit: string; net: string };
  residual: string;
}

function sum4(values: ReadonlyArray<string>): string {
  return values.reduce((acc, value) => new Decimal(acc).plus(value).toFixed(4), "0.0000");
}

@Injectable()
export class ProjectActualsService {
  /** A pure read service — no writes, no audit events (the typed
   * refusals carry their own evidence in the error details). */

  private requireProject(projectId: string): Promise<void> {
    if (!UUID_RE.test(projectId)) {
      throw new ActualsInputInvalidError(`projectId must be a uuid: ${projectId}`);
    }
    return store.findProjectPlane(projectId).then((project) => {
      if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    });
  }

  /** The per-entry labor valuation fold (shared by the per-project and
   * the tenant-wide driver reads). */
  private async laborFold(
    entries: ReadonlyArray<{
      id: string;
      hours: string;
      wbsTaskId: string | null;
      employeeId: string | null;
      employeeBasicSalary: string | null;
    }>,
  ): Promise<{
    total: string;
    byNode: Map<string, { hours: Decimal; amount: Decimal }>;
    rateCard: Map<string, { monthlyEmployerCost: string; hourlyRate: string }>;
    unpriced: { count: number; hours: string; reasons: string[] };
    pricedCostByProject?: Map<string, Decimal>;
  }> {
    const standardHours = await readEffectiveSetting<number | null>(
      "projects.labor_standard_monthly_hours",
    );
    const divisor =
      typeof standardHours === "number" && Number.isInteger(standardHours) && standardHours >= 1
        ? standardHours
        : null;
    const componentCache = new Map<string, Awaited<ReturnType<typeof store.listEmployeeSalaryComponents>>>();
    const rateCard = new Map<string, { monthlyEmployerCost: string; hourlyRate: string }>();
    const byNode = new Map<string, { hours: Decimal; amount: Decimal }>();
    let total = new Decimal("0.0000");
    let unpricedCount = 0;
    let unpricedHours = new Decimal("0.000000");
    const unpricedReasons = new Set<string>();

    for (const entry of entries) {
      if (divisor === null) {
        unpricedCount += 1;
        unpricedHours = unpricedHours.plus(entry.hours);
        unpricedReasons.add(
          "the tenant's standard monthly hours are unset (projects.labor_standard_monthly_hours) — the labor rate refuses to fabricate",
        );
        continue;
      }
      if (entry.employeeId === null || entry.employeeBasicSalary === null) {
        unpricedCount += 1;
        unpricedHours = unpricedHours.plus(entry.hours);
        unpricedReasons.add(
          `entry ${entry.id} carries no employee link (fee_earner_user_id unresolved to an employee) — no cost rate exists`,
        );
        continue;
      }
      let components = componentCache.get(entry.employeeId);
      if (components === undefined) {
        components = await store.listEmployeeSalaryComponents(entry.employeeId);
        componentCache.set(entry.employeeId, components);
      }
      const monthly = monthlyEmployerCost(
        entry.employeeBasicSalary,
        components.map((component) => ({
          kind: component.kind as "ALLOWANCE" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION",
          calc: component.calc as "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS",
          amount: component.amount,
          rate: component.rate,
        })),
      );
      const rate = hourlyCostRate(monthly, divisor);
      if (rate === null) {
        unpricedCount += 1;
        unpricedHours = unpricedHours.plus(entry.hours);
        unpricedReasons.add(`the hourly rate for employee ${entry.employeeId} did not resolve`);
        continue;
      }
      rateCard.set(entry.employeeId, { monthlyEmployerCost: monthly, hourlyRate: rate });
      const amount = valueHoursAtRate(entry.hours, rate);
      total = total.plus(amount);
      const nodeKey = entry.wbsTaskId ?? "UNNODED";
      const node = byNode.get(nodeKey) ?? { hours: new Decimal("0.000000"), amount: new Decimal("0.0000") };
      node.hours = node.hours.plus(entry.hours);
      node.amount = node.amount.plus(amount);
      byNode.set(nodeKey, node);
    }
    return {
      total: total.toFixed(4),
      byNode,
      rateCard,
      unpriced: {
        count: unpricedCount,
        hours: unpricedHours.toFixed(6),
        reasons: [...unpricedReasons],
      },
    };
  }

  /** The four-leg breakdown (each leg its own source — D-05). */
  async breakdown(projectId: string): Promise<ActualsBreakdown> {
    await this.requireProject(projectId);
    // LABOR — the approved-class WBS-dimensioned entries × the payroll
    // cost rates (D-01 read-only).
    const laborEntries = await store.listLaborEntryRows(projectId);
    const labor = await this.laborFold(laborEntries);
    // MATERIALS — the WMS issue paths tied by their postings' project
    // stamp, valued at the MOVE's own value (the honest zero when
    // nothing ties).
    const moves = await store.listProjectIssueMoves(projectId);
    const materialsTotal = sum4(moves.map((move) => move.valueAmount));
    // SUBCONTRACT — the APPROVED certificates' net values.
    const certificates = await store.listApprovedSubCertificates(projectId);
    const subcontractTotal = sum4(certificates.map((certificate) => certificate.netPayable));
    // OVERHEAD — the tenant-configured distributor fold.
    const overhead = await this.overheadForProject(projectId);

    const byNode: LaborNodeBreakdown[] = [...labor.byNode.entries()]
      .filter(([key]) => key !== "UNNODED")
      .map(([wbsTaskId, node]) => ({
        wbsTaskId,
        hours: node.hours.toFixed(6),
        amount: node.amount.toFixed(4),
      }));

    return {
      projectId,
      labor: {
        total: labor.total,
        entries: laborEntries.length,
        byNode,
        rateCard: [...labor.rateCard.entries()].map(([employeeId, card]) => ({
          employeeId,
          monthlyEmployerCost: card.monthlyEmployerCost,
          hourlyRate: card.hourlyRate,
        })),
        unpriced: labor.unpriced,
      },
      materials: {
        total: materialsTotal,
        moves: moves.length,
        degraded: moves.length === 0,
      },
      subcontract: {
        total: subcontractTotal,
        certificates: certificates.map((certificate) => ({
          id: certificate.id,
          certificateDate: certificate.certificateDate,
          certificateNo: certificate.certificateNo,
          netPayable: certificate.netPayable,
        })),
      },
      overhead,
      acTotal: sum4([labor.total, materialsTotal, subcontractTotal, overhead.allocated]),
    };
  }

  /** The overhead distributor fold for ONE project (the pool + the
   * tenant-wide driver shares — the pure allocateOverhead). */
  private async overheadForProject(projectId: string): Promise<ActualsBreakdown["overhead"]> {
    const distributor = await readEffectiveSetting<OverheadDistributorSetting | null>(
      "projects.overhead_distributor",
    );
    if (
      distributor === null ||
      distributor === undefined ||
      (distributor.driver !== "LABOR_HOURS" && distributor.driver !== "DIRECT_COST") ||
      !Array.isArray(distributor.pool_account_ids) ||
      distributor.pool_account_ids.length === 0
    ) {
      return {
        allocated: "0.0000",
        pool: "0.0000",
        share: "0.000000",
        driver: null,
        degraded: true,
        projectsSharingThePool: 0,
      };
    }
    const pool = await store.glAccountsNet(distributor.pool_account_ids);
    let shares: ReadonlyArray<{ projectId: string; driverValue: string }>;
    if (distributor.driver === "LABOR_HOURS") {
      shares = (await store.laborHoursByProject()).map((row) => ({
        projectId: row.projectId,
        driverValue: row.hours,
      }));
    } else {
      // DIRECT_COST: labor (priced) + materials + subcontract per project.
      const laborEntries = await store.listAllLaborEntryRows();
      const laborByProject = new Map<string, Decimal>();
      const entriesByProject = new Map<string, Array<(typeof laborEntries)[number]>>();
      for (const entry of laborEntries) {
        const list = entriesByProject.get(entry.projectId) ?? [];
        list.push(entry);
        entriesByProject.set(entry.projectId, list);
      }
      for (const [pid, entries] of entriesByProject) {
        laborByProject.set(pid, new Decimal((await this.laborFold(entries)).total));
      }
      const materialsByProject = new Map<string, Decimal>();
      for (const move of await store.listAllProjectIssueMoves()) {
        materialsByProject.set(
          move.projectId,
          (materialsByProject.get(move.projectId) ?? new Decimal("0.0000")).plus(move.valueAmount),
        );
      }
      const subByProject = new Map<string, Decimal>();
      for (const certificate of await store.listAllApprovedSubCertificates()) {
        subByProject.set(
          certificate.projectId,
          (subByProject.get(certificate.projectId) ?? new Decimal("0.0000")).plus(certificate.netPayable),
        );
      }
      const projectIds = new Set<string>([
        ...laborByProject.keys(),
        ...materialsByProject.keys(),
        ...subByProject.keys(),
        projectId,
      ]);
      shares = [...projectIds].map((pid) => ({
        projectId: pid,
        driverValue: (laborByProject.get(pid) ?? new Decimal("0.0000"))
          .plus(materialsByProject.get(pid) ?? new Decimal("0.0000"))
          .plus(subByProject.get(pid) ?? new Decimal("0.0000"))
          .toFixed(4),
      }));
    }
    const allocations = allocateOverhead(pool, shares);
    const mine = allocations.find((allocation) => allocation.projectId === projectId);
    return {
      allocated: mine?.allocated ?? "0.0000",
      pool,
      share: mine?.share ?? "0.000000",
      driver: distributor.driver,
      degraded: false,
      projectsSharingThePool: allocations.length,
    };
  }

  // -- INV-033 (the typed reconciliation — refuses at ANY residual) ------------

  async inv033(projectId: string): Promise<Inv033Report> {
    await this.requireProject(projectId);
    const breakdown = await this.breakdown(projectId);
    const gl = await store.glProjectDimension(projectId);
    const acTotal = new Decimal(breakdown.labor.total)
      .plus(breakdown.materials.total)
      .plus(breakdown.subcontract.total)
      .plus(breakdown.overhead.allocated)
      .toFixed(4);
    const residual = new Decimal(acTotal).minus(new Decimal(gl.net)).toFixed(4);
    if (residual !== "0.0000" && residual !== "-0.0000") {
      // The typed refusal — the service NEVER reports a non-reconciling
      // AC (INV-032(b)'s tolerance-0 spirit).
      throw new Inv033ReconciliationError(
        `INV-033 reconciliation refused for project ${projectId}: the four-leg AC (${acTotal}) does not equal the GL project dimension (${gl.net}) — residual ${residual}`,
        {
          projectId,
          labor: breakdown.labor.total,
          materials: breakdown.materials.total,
          subcontract: breakdown.subcontract.total,
          overheadAllocated: breakdown.overhead.allocated,
          acTotal,
          glProjectDimension: gl.net,
          residual,
        },
      );
    }
    return {
      projectId,
      labor: breakdown.labor.total,
      materials: breakdown.materials.total,
      subcontract: breakdown.subcontract.total,
      overheadAllocated: breakdown.overhead.allocated,
      acTotal,
      glProjectDimension: gl,
      residual: "0.0000",
    };
  }
}
