import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { accruedThrough, rollupWeightedPercent, type CurveCell } from "../domain/projects-math";
import {
  aggregateWeightedPercent,
  costPerformanceIndex,
  earnedValue,
  earnedValueFromAggregate,
  forecastAtCompletion,
  schedulePerformanceIndex,
} from "../domain/evm-math";
import { EvmInputInvalidError, ProjectPlaneNotFoundError } from "../domain/projects-errors";
import * as projectsStore from "../infrastructure/projects.store";
import * as gateStore from "../infrastructure/change-order.store";
import { ProjectActualsService } from "./project-actuals-service";
import { ProjectBudgetService } from "./project-budget-service";

/**
 * PHASE-048 (W-10 — T-08) — the EVM service (D-06): PV/EV/AC, CPI/SPI,
 * ETC/EAC per project and per WBS node — a PURE READ (no writes, no
 * audit events; the typed refusals carry their own evidence).
 *
 * THE LAWS (the owner's W-10 dispatch, the plan D-06):
 *
 * - **PV EXCLUSIVELY FROM THE APPROVED CURVE**: the service reads
 *   ProjectBudgetService.curve — the APPROVED budget ALONE (D-04's own
 *   law; the typed BudgetStateError when no APPROVED budget stands —
 *   never a DRAFT's plan, never a fabricated zero).
 * - **THE TWO EV DISCIPLINES**: the STRUCTURAL EV = the whole-tree
 *   aggregate percent (BR-095's super-root corollary — every leaf
 *   contributes (weight ?? 1) × its own report; the exact rational,
 *   ONE rounding at the money) × BAC; the CERTIFICATE EV = the latest
 *   APPROVED progress certificate's cumulative percent × BAC (the
 *   customer-billing figure). The delta is the management signal (the
 *   phase doc's %-complete-honesty mitigation) — surfaced, never an
 *   error.
 * - **THE EV CEILING (acceptance #4)**: EV never exceeds the budget at
 *   the scope it is earned against — the project EV against BAC, each
 *   node's EV against the node's planned cells (the pure folds' typed
 *   refusal; the boundary EV = ceiling is legal).
 * - **AC FROM T-07's OUTPUT ALONE**: the service calls the actual
 *   collectors' breakdown — never re-reads a source table (so the EVM
 *   cost figure is INV-033-consistent by construction, the same fold).
 * - **BAC = THE RE-BASELINE CEILING (G-58)**: the approved curve's
 *   total + the APPROVED change orders' price deltas ONLY (BR-094:
 *   DRAFT/SUBMITTED/REJECTED never enter) — the gate is the ONLY
 *   re-planning path (the W-9 one-approved law's other half).
 * - **THE NODE ARM'S HONEST SHAPE**: per-node PV/EV read the node's
 *   own approved-curve cells and the W-9 per-node rollup percent (the
 *   node-by-node reconciliation with the /wbs/rollup read holds); the
 *   node AC is the LABOR leg only (the only node-dimensioned collector
 *   — materials/subcontract/overhead roll at the project level; a
 *   fabricated node split would violate the honest-shape law).
 * - **THE INDEX FALLBACK LAW**: CPI/SPI are null at a zero denominator
 *   (never a fabricated ∞); the forecast rides the pure folds.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

export interface EvmNodeRow {
  readonly wbsTaskId: string;
  readonly wbsCode: string;
  readonly name: string;
  /** The node's approved-curve planned cells (its own ceiling). */
  readonly planned: string;
  readonly pv: string;
  /** The W-9 rollup's leaf-recomputed node percent (BR-095). */
  readonly rolledPercent: string;
  readonly ev: string;
  /** The LABOR leg only — the node-dimensioned collector (the honest shape). */
  readonly acLabor: string;
  readonly cpi: string | null;
  readonly spi: string | null;
}

export interface EvmSnapshot {
  readonly projectId: string;
  readonly asOf: string;
  readonly budget: {
    readonly budgetId: string;
    readonly approvedTotal: string;
    readonly approvedChangeOrders: number;
    readonly priceDeltaSum: string;
    /** The budget at completion — the re-baselined ceiling (G-58). */
    readonly bac: string;
  };
  readonly pv: string;
  readonly ev: {
    readonly structural: { readonly percent: string | null; readonly value: string };
    readonly certificate: {
      readonly certificateId: string;
      readonly certificateNo: string | null;
      readonly kind: string;
      readonly cumulativePercent: string;
      readonly value: string;
    } | null;
    /** structural − certificate (the management signal's figure). */
    readonly delta: string | null;
    readonly signal: "STRUCTURAL_AHEAD" | "CERTIFICATE_AHEAD" | "AGREE" | "NO_CERTIFICATE";
  };
  readonly ac: {
    readonly labor: string;
    readonly materials: string;
    readonly subcontract: string;
    readonly overhead: string;
    readonly total: string;
    readonly unpricedCount: number;
    readonly degradedMaterials: boolean;
    readonly degradedOverhead: boolean;
  };
  readonly indices: { readonly cpi: string | null; readonly spi: string | null };
  readonly forecast: { readonly etc: string; readonly eac: string; readonly method: "CPI_BASED" | "REMAINDER" };
  readonly nodes: EvmNodeRow[];
  readonly disclosures: string[];
}

@Injectable()
export class EvmService {
  constructor(
    @Inject(ProjectBudgetService) private readonly budgets: ProjectBudgetService,
    @Inject(ProjectActualsService) private readonly actuals: ProjectActualsService,
  ) {}

  async snapshot(projectId: string, asOf: string): Promise<EvmSnapshot> {
    if (!UUID_RE.test(projectId)) {
      throw new EvmInputInvalidError(`projectId must be a uuid: ${projectId}`);
    }
    if (!DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw new EvmInputInvalidError(`asOf must be an ISO date (YYYY-MM-DD): ${asOf}`);
    }
    const project = await projectsStore.findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);

    // PV — the APPROVED curve ALONE (D-04's law through the budget
    // service's own read; the typed refusal when none stands).
    const curve = await this.budgets.curve(projectId, asOf);
    // BAC — the re-baselined ceiling: the approved total + the APPROVED
    // change orders' price deltas (G-58; inert orders never count).
    const deltas = await gateStore.approvedDeltaSum(projectId);
    const bac = new Decimal(curve.totalPlanned).plus(deltas.priceDeltaSum).toFixed(4);

    // The tree + the two rollup cuts (the W-9 per-node read + the
    // super-root aggregate for the project percent).
    const tasks = await projectsStore.listWbsTasks(projectId);
    const nodeRollups = rollupWeightedPercent(
      tasks.map((task) => ({
        id: task.id,
        parentTaskId: task.parentTaskId,
        weight: task.weight,
        percentComplete: task.percentComplete,
      })),
    );
    const aggregate = aggregateWeightedPercent(
      tasks.map((task) => ({
        id: task.id,
        parentTaskId: task.parentTaskId,
        weight: task.weight,
        percentComplete: task.percentComplete,
      })),
    );

    // EV — the structural discipline (the exact rational × BAC, ONE
    // rounding at money; the typed ceiling refusal).
    const structuralValue =
      aggregate === null ? "0.0000" : earnedValueFromAggregate(bac, aggregate);

    // EV — the certificate discipline (the latest APPROVED progress
    // certificate's cumulative percent × BAC — the billing figure).
    const certificate = await gateStore.latestApprovedProgressCertificate(projectId);
    const certificateValue = certificate === undefined ? null : earnedValue(bac, certificate.cumulativePercent);

    // AC — T-07's output ALONE (the same fold INV-033 reconciles).
    const breakdown = await this.actuals.breakdown(projectId);

    const pv = curve.accruedTotal;
    const cpi = costPerformanceIndex(structuralValue, breakdown.acTotal);
    const spi = schedulePerformanceIndex(structuralValue, pv);
    const forecast = forecastAtCompletion(bac, structuralValue, breakdown.acTotal);

    // The per-node arm: the node's own approved-curve cells (its
    // planned ceiling) + the W-9 per-node rollup percent + the labor
    // leg (the only node-dimensioned collector).
    const cellsByNode = new Map<string, { planned: Decimal; cells: CurveCell[] }>();
    for (const bucket of curve.buckets) {
      if (bucket.wbsTaskId === null) continue;
      const entry = cellsByNode.get(bucket.wbsTaskId) ?? { planned: new Decimal("0.0000"), cells: [] };
      entry.planned = entry.planned.plus(bucket.plannedAmount);
      entry.cells.push({
        periodStart: bucket.periodStart,
        periodEnd: bucket.periodEnd,
        plannedAmount: bucket.plannedAmount,
      });
      cellsByNode.set(bucket.wbsTaskId, entry);
    }
    const laborByNode = new Map(breakdown.labor.byNode.map((node) => [node.wbsTaskId, node.amount]));
    const nodeIds = new Set<string>([...cellsByNode.keys(), ...laborByNode.keys()]);
    const nodes: EvmNodeRow[] = [];
    for (const task of tasks) {
      if (!nodeIds.has(task.id)) continue;
      const entry = cellsByNode.get(task.id);
      const planned = (entry?.planned ?? new Decimal("0.0000")).toFixed(4);
      const nodePv = accruedThrough(entry?.cells ?? [], asOf);
      const rolled = nodeRollups.get(task.id)?.rolledPercent ?? "0.00";
      const nodeEv = earnedValue(planned, rolled);
      const acLabor = laborByNode.get(task.id) ?? "0.0000";
      nodes.push({
        wbsTaskId: task.id,
        wbsCode: task.wbsCode,
        name: task.name,
        planned,
        pv: nodePv,
        rolledPercent: rolled,
        ev: nodeEv,
        acLabor,
        cpi: costPerformanceIndex(nodeEv, acLabor),
        spi: schedulePerformanceIndex(nodeEv, nodePv),
      });
    }

    // The management signal (the two disciplines' delta — surfaced,
    // never an error).
    let delta: string | null = null;
    let signal: EvmSnapshot["ev"]["signal"] = "NO_CERTIFICATE";
    if (certificateValue !== null) {
      const deltaDecimal = new Decimal(structuralValue).minus(certificateValue);
      delta = deltaDecimal.toFixed(4);
      signal = deltaDecimal.greaterThan(0)
        ? "STRUCTURAL_AHEAD"
        : deltaDecimal.lessThan(0)
          ? "CERTIFICATE_AHEAD"
          : "AGREE";
    }

    const disclosures: string[] = [];
    if (aggregate === null) {
      disclosures.push(
        "the project carries no WBS tasks — the structural EV is the honest zero (the certificate discipline may still carry the billing figure)",
      );
    } else if (aggregate.leafCount > cellsByNode.size) {
      disclosures.push(
        "the structural percent covers leaves without approved-curve budget cells — the project EV (percent × BAC) and Σ node EV (each node's own cells) are two honest cuts, not one sum",
      );
    }
    if (certificate === undefined) {
      disclosures.push(
        "no APPROVED progress certificate exists — the certificate EV discipline is absent (NO_CERTIFICATE), never a fabricated zero percent",
      );
    }
    if (breakdown.labor.unpriced.count > 0) {
      disclosures.push(
        `the labor collector carries ${breakdown.labor.unpriced.count} unpriced entries (${breakdown.labor.unpriced.hours}h) — an honest zero, never a fabricated rate`,
      );
    }
    if (breakdown.materials.degraded) {
      disclosures.push("the materials collector is degraded — no project-tied WMS issue posting exists (the honest zero)");
    }
    if (breakdown.overhead.degraded) {
      disclosures.push("the overhead collector is degraded — the distributor setting is unset (the honest zero)");
    }
    if (nodes.length > 0) {
      disclosures.push(
        "the node AC is the LABOR leg only — materials/subcontract/overhead roll at the project level (the honest node-dimensioned shape)",
      );
    }

    return {
      projectId,
      asOf,
      budget: {
        budgetId: curve.budgetId,
        approvedTotal: curve.totalPlanned,
        approvedChangeOrders: deltas.count,
        priceDeltaSum: deltas.priceDeltaSum,
        bac,
      },
      pv,
      ev: {
        structural: { percent: aggregate?.percent ?? null, value: structuralValue },
        certificate:
          certificate === undefined || certificateValue === null
            ? null
            : {
                certificateId: certificate.id,
                certificateNo: certificate.certificateNo,
                kind: certificate.kind,
                cumulativePercent: certificate.cumulativePercent,
                value: certificateValue,
              },
        delta,
        signal,
      },
      ac: {
        labor: breakdown.labor.total,
        materials: breakdown.materials.total,
        subcontract: breakdown.subcontract.total,
        overhead: breakdown.overhead.allocated,
        total: breakdown.acTotal,
        unpricedCount: breakdown.labor.unpriced.count,
        degradedMaterials: breakdown.materials.degraded,
        degradedOverhead: breakdown.overhead.degraded,
      },
      indices: { cpi, spi },
      forecast,
      nodes,
      disclosures,
    };
  }
}
