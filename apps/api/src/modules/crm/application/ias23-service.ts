import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { readEffectiveSetting, ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  BudgetStateError,
  Ias23AlreadyPostedError,
  Ias23AsOfInFutureError,
  Ias23InputInvalidError,
  Ias23NothingToCapitalizeError,
  Ias23RateUnverifiedError,
  Ias23ScopeEmptyError,
  Ias23WindowUndefinedError,
  ProjectPlaneNotFoundError,
} from "../domain/projects-errors";
import { ias23Split, ias23Window, rateToExactString, type Ias23SplitResult } from "../domain/evm-math";
import * as gateStore from "../infrastructure/change-order.store";
import type { Ias23CapitalizationRow } from "../infrastructure/change-order.store";
import { findProjectPlane, listApprovedBudgetLines, listWbsTasks } from "../infrastructure/projects.store";
import type { BudgetLineRow } from "../infrastructure/projects.store";

/**
 * PHASE-048 (W-10 — the D-11 engine) — the IAS 23 borrowing-costs
 * capitalization service over the WBS window (R-04, the v3.2/CR-50
 * addition): financing costs on qualifying construction assets
 * capitalize over the construction window, with the rate register
 * REQUIRES_VERIFICATION (the W-8 planted settings key — the posting
 * refuses without it) and the DOCUMENTED STOP RULES.
 *
 * THE MODEL (the service header's own record — the golden's formal
 * proof is W-14's):
 *
 * - **THE RATE REGISTER (REQUIRES_VERIFICATION)**: the planted key
 *   `projects.ias23_capitalization_rate` — { rate (a fraction 0…1),
 *   source_evidence, verified: true } — tenant-entered WITH the source
 *   evidence and the explicit verified acknowledgement. While unset,
 *   malformed, or unverified, BOTH the preview computation and the
 *   posting REFUSE typed (never a fabricated rate — red line 5, the
 *   BR-055 family). The z.number rate crosses ONE float boundary
 *   (rateToExactString, the 6-dp exact string) — everything downstream
 *   is exact scaled-integer arithmetic (ADR-0009).
 * - **THE WINDOW (the WBS schedule law)**: [min scheduled start, max
 *   scheduled end] over the project's tasks carrying BOTH dates — the
 *   construction window (no dated task = the typed refusal, never a
 *   fabricated window).
 * - **THE SCOPE (the budget-line law)**: the APPROVED budget's lines
 *   ONLY (D-11's "scope tracking rides the project budget lines it
 *   capitalizes" — DRAFT is authoring, CLOSED is history; no APPROVED
 *   budget = the typed refusal, the curve's own law).
 * - **THE SPLIT (the pure fold)**: per line, the eligible expenditure =
 *   the line's own uniform daily spread over [max(periodStart,
 *   windowStart), min(periodEnd, windowEnd, asOf)] (ONE rounding at
 *   4-dp money); the expenditures base = the whole line's accrual
 *   through asOf (the W-9 curve fold); the residual = the exact
 *   difference; capitalized = eligible × rate, expensed = residual ×
 *   rate — with the 0103 CHECK's law (capitalized + expensed ≤
 *   expenditures) holding by construction (the pure spec proves it).
 * - **THE DOCUMENTED STOP RULES**: (1) THE START LAW — accrual before
 *   the window start never capitalizes (its attributable borrowing
 *   cost expenses); (2) THE COMPLETION LAW — capitalization stops at
 *   the window end; (3) THE ELAPSED LAW — the posting arm covers
 *   ELAPSED expenditure only (asOf > today is the typed refusal — the
 *   preview arm computes at any asOf and says so).
 * - **THE POSTING (through the REAL engine)**: ONE entry per project
 *   window — source { ias_capitalization, projectId, post_<window
 *   start YYYYMMDD> } (the 0011 shape CHECKs: source types and
 *   operations are lowercase snake-case, digits barred — hence
 *   "ias_capitalization"), INV-013 idempotent (a retried post
 *   converges) — DR the
 *   mapped qualifying-asset account (IAS23_QUALIFYING_ASSET) · CR the
 *   mapped borrowing-cost account (IAS23_BORROWING_COST) at Σ
 *   capitalized; the ENGINE resolves both fail-closed
 *   PURPOSE_NOT_MAPPED until the tenant maps them (the 038/0077
 *   discipline). The expensed portion needs no entry — it stays in the
 *   borrowing-cost account by construction (the classic capitalization
 *   shape). NO project stamp (the capitalization moves expense to
 *   asset at the tenant level — INV-033's cost carry is untouched).
 * - **THE STAMP (single-use)**: the POSTED rows (status POSTED +
 *   posted_at, the 0103 CHECK's law) refuse re-capitalization of the
 *   same (line, slice) — the history is computation evidence, no
 *   delete. The rows write AFTER the posting succeeds, in the same
 *   ambient transaction (all-or-nothing).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

/** The register's planted shape (settings-schema.ts, the W-8 key). */
interface Ias23RateRegister {
  rate: number;
  source_evidence: string;
  verified: true;
}

export interface Ias23LineSplit {
  readonly budgetLineId: string;
  readonly costType: string;
  readonly wbsTaskId: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly plannedAmount: string;
  readonly slice: Ias23SplitResult;
}

export interface Ias23Preview {
  readonly projectId: string;
  readonly asOf: string;
  /** True when asOf > today — a projection, never a posting basis. */
  readonly projection: boolean;
  readonly window: { readonly start: string; readonly end: string };
  /** The register's evidence trail (the applied rate + the source text). */
  readonly register: {
    readonly rate: string;
    readonly sourceEvidence: string;
  };
  readonly lines: Ias23LineSplit[];
  /** The lines whose period does not overlap the window (listed, never zeroed). */
  readonly outOfScope: ReadonlyArray<{ budgetLineId: string; periodStart: string; periodEnd: string }>;
  readonly totals: {
    readonly expenditures: string;
    readonly eligible: string;
    readonly ineligible: string;
    readonly capitalized: string;
    readonly expensed: string;
  };
}

@Injectable()
export class Ias23Service {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  /** The register read + the REQUIRES_VERIFICATION law (the W-10 exit
   * arm: the typed refusal while unset/malformed/unverified). */
  private async requireVerifiedRate(): Promise<{ rate: string; sourceEvidence: string }> {
    const stored = await readEffectiveSetting<Ias23RateRegister | null>(
      "projects.ias23_capitalization_rate",
    );
    if (stored === null || stored === undefined) {
      throw new Ias23RateUnverifiedError(
        "the IAS-23 capitalization rate register is unset (projects.ias23_capitalization_rate) — REQUIRES_VERIFICATION: the tenant enters the weighted-average rate WITH source evidence and the explicit verified acknowledgement; the posting refuses (never a fabricated rate — red line 5)",
      );
    }
    if (
      typeof stored !== "object" ||
      typeof stored.rate !== "number" ||
      typeof stored.source_evidence !== "string" ||
      stored.source_evidence.length < 1 ||
      stored.verified !== true
    ) {
      throw new Ias23RateUnverifiedError(
        "the IAS-23 capitalization rate register is malformed or unverified (projects.ias23_capitalization_rate requires { rate, source_evidence, verified: true }) — the posting refuses (never a fabricated rate — red line 5)",
      );
    }
    const rate = rateToExactString(stored.rate);
    if (rate === null) {
      throw new Ias23RateUnverifiedError(
        `the IAS-23 capitalization rate register's rate ${stored.rate} is out of band (a fraction 0…1) — the posting refuses`,
      );
    }
    return { rate, sourceEvidence: stored.source_evidence };
  }

  /** The shared computation (the preview's body): the register → the
   * window → the approved lines → the pure splits. */
  private async compute(projectId: string, asOf: string): Promise<{
    register: { rate: string; sourceEvidence: string };
    window: { start: string; end: string };
    lines: Ias23LineSplit[];
    outOfScope: { budgetLineId: string; periodStart: string; periodEnd: string }[];
    totals: Ias23Preview["totals"];
    lineRows: BudgetLineRow[];
  }> {
    const register = await this.requireVerifiedRate();

    const tasks = await listWbsTasks(projectId);
    const window = ias23Window(
      tasks.map((task) => ({ startDate: task.startDate, endDate: task.endDate })),
    );
    if (window === null) {
      throw new Ias23WindowUndefinedError(
        `project ${projectId} carries no WBS task with both schedule dates — the qualifying window is the WBS schedule's span (D-11), and without it the capitalization refuses (never a fabricated window)`,
      );
    }

    const lines = await listApprovedBudgetLines(projectId);
    if (lines.length === 0) {
      throw new BudgetStateError(
        `project ${projectId} holds no APPROVED budget — the capitalization rides the APPROVED budget's lines (D-11); author and approve a budget first`,
        { projectId },
      );
    }

    const splits: Ias23LineSplit[] = [];
    const outOfScope: { budgetLineId: string; periodStart: string; periodEnd: string }[] = [];
    let expenditures = new Decimal("0.0000");
    let eligible = new Decimal("0.0000");
    let ineligible = new Decimal("0.0000");
    let capitalized = new Decimal("0.0000");
    let expensed = new Decimal("0.0000");
    for (const line of lines) {
      const split = ias23Split(
        {
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          plannedAmount: line.plannedAmount,
        },
        window,
        register.rate,
        asOf,
      );
      if (split === null) {
        outOfScope.push({
          budgetLineId: line.id,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
        });
        continue;
      }
      splits.push({
        budgetLineId: line.id,
        costType: line.costType,
        wbsTaskId: line.wbsTaskId,
        periodStart: line.periodStart,
        periodEnd: line.periodEnd,
        plannedAmount: line.plannedAmount,
        slice: split,
      });
      expenditures = expenditures.plus(split.expenditures);
      eligible = eligible.plus(split.eligible);
      ineligible = ineligible.plus(split.ineligible);
      capitalized = capitalized.plus(split.capitalized);
      expensed = expensed.plus(split.expensed);
    }
    if (splits.length === 0) {
      throw new Ias23ScopeEmptyError(
        `project ${projectId}'s approved budget lines do not overlap the qualifying window ${window.start}..${window.end} — nothing is in scope (the out-of-scope lines are listed in the refusal)`,
        { projectId, window, outOfScope },
      );
    }

    return {
      register,
      window,
      lines: splits,
      outOfScope,
      totals: {
        expenditures: expenditures.toFixed(4),
        eligible: eligible.toFixed(4),
        ineligible: ineligible.toFixed(4),
        capitalized: capitalized.toFixed(4),
        expensed: expensed.toFixed(4),
      },
      lineRows: lines,
    };
  }

  /** The projection arm: the split at any asOf (a projection when asOf
   * lies in the future — the output says so; the posting arm refuses). */
  async preview(projectId: string, asOf: string): Promise<Ias23Preview> {
    if (!UUID_RE.test(projectId)) {
      throw new Ias23InputInvalidError(`projectId must be a uuid: ${projectId}`);
    }
    if (!DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw new Ias23InputInvalidError(`asOf must be an ISO date (YYYY-MM-DD): ${asOf}`);
    }
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    const computed = await this.compute(projectId, asOf);
    const today = new Date().toISOString().slice(0, 10);
    return {
      projectId,
      asOf,
      projection: asOf > today,
      window: computed.window,
      register: { rate: computed.register.rate, sourceEvidence: computed.register.sourceEvidence },
      lines: computed.lines,
      outOfScope: computed.outOfScope,
      totals: computed.totals,
    };
  }

  /**
   * The posting arm: the split at asOf (≤ today — the elapsed law) +
   * ONE engine entry at Σ capitalized + the POSTED scope rows — all in
   * ONE ambient transaction (a posting failure writes nothing).
   */
  async capitalize(
    projectId: string,
    asOf: string,
    actorId: string | null,
    note: string | null = null,
  ): Promise<{
    journalEntryId: string;
    rows: Ias23CapitalizationRow[];
    totals: Ias23Preview["totals"];
  }> {
    if (!UUID_RE.test(projectId)) {
      throw new Ias23InputInvalidError(`projectId must be a uuid: ${projectId}`);
    }
    if (!DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw new Ias23InputInvalidError(`asOf must be an ISO date (YYYY-MM-DD): ${asOf}`);
    }
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);

    const today = new Date().toISOString().slice(0, 10);
    if (asOf > today) {
      throw new Ias23AsOfInFutureError(
        `the capitalization posting covers ELAPSED expenditure only — asOf ${asOf} is beyond today ${today} (the preview arm computes projections; the posting arm refuses them)`,
        { asOf, today },
      );
    }

    const computed = await this.compute(projectId, asOf);
    if (new Decimal(computed.totals.capitalized).isZero()) {
      throw new Ias23NothingToCapitalizeError(
        `project ${projectId}'s capitalization at ${asOf} totals ZERO capitalized (every eligible accrual is zero — the rate may be 0 or the window not started) — nothing to post, and the service refuses to mint an empty entry`,
        { projectId, asOf, totals: computed.totals },
      );
    }

    // THE SINGLE-USE STAMP — any POSTED row at a (line, slice) refuses
    // the re-capitalization (the history is computation evidence).
    for (const line of computed.lines) {
      const existing = await gateStore.findIas23ByLineAndSliceStart(
        line.budgetLineId,
        line.slice.sliceStart,
      );
      if (existing !== undefined) {
        throw new Ias23AlreadyPostedError(
          `budget line ${line.budgetLineId} already carries a ${existing.status} capitalization for the slice starting ${line.slice.sliceStart} (posted ${existing.postedAt ?? "—"}) — the posting stamp is single-use; a re-planned window opens a NEW slice, never a re-post`,
          { projectId, budgetLineId: line.budgetLineId, windowStart: line.slice.sliceStart },
        );
      }
    }

    // THE POSTING — one entry per project window through the REAL
    // engine (INV-013 idempotent on the deterministic source key).
    const result = await this.posting.post(
      {
        source: {
          docType: "ias_capitalization",
          docId: projectId,
          operation: `post_${computed.window.start.replaceAll("-", "")}`,
        },
        entryDate: today,
        description: {
          en: `IAS 23 borrowing-costs capitalization — project ${project.code} through ${asOf} (rate ${computed.register.rate})`,
          ar: `رسملة تكاليف الاقتراض IAS 23 — المشروع ${project.code} حتى ${asOf} (المعدل ${computed.register.rate})`,
        },
        currency: await ownTenantBaseCurrency(),
        lines: [
          {
            purpose: "IAS23_QUALIFYING_ASSET",
            direction: "DEBIT",
            amount: computed.totals.capitalized,
            memo: { en: "IAS 23 capitalized borrowing costs", ar: "تكاليف الاقتراض المرسملة IAS 23" },
          },
          {
            purpose: "IAS23_BORROWING_COST",
            direction: "CREDIT",
            amount: computed.totals.capitalized,
            memo: { en: "IAS 23 borrowing costs released", ar: "تكاليف الاقتراض المحولة IAS 23" },
          },
        ],
      },
      { postedBy: actorId },
    );

    // The scope rows — POSTED, after the posting succeeded, in the same
    // ambient transaction (all-or-nothing).
    const rows: Ias23CapitalizationRow[] = [];
    for (const line of computed.lines) {
      rows.push(
        await gateStore.insertIas23Capitalization({
          projectId,
          budgetLineId: line.budgetLineId,
          windowStart: line.slice.sliceStart,
          windowEnd: line.slice.sliceEnd,
          expendituresAmount: line.slice.expenditures,
          capitalizedAmount: line.slice.capitalized,
          expensedAmount: line.slice.expensed,
          rateSnapshot: computed.register.rate,
          note,
        }),
      );
    }

    await this.audit.record({
      action: "projects.ias23_capitalized",
      entityType: "ias23_capitalization",
      entityId: projectId,
      actorId: actorId ?? undefined,
      after: {
        projectId,
        asOf,
        window: computed.window,
        rate: computed.register.rate,
        totals: computed.totals,
        journalEntryId: result.journalEntryId,
        rows: rows.length,
      },
    });

    return { journalEntryId: result.journalEntryId, rows, totals: computed.totals };
  }

  /** The scope rows' read (the computation evidence). */
  async listCapitalizations(projectId: string): Promise<Ias23CapitalizationRow[]> {
    if (!UUID_RE.test(projectId)) {
      throw new Ias23InputInvalidError(`projectId must be a uuid: ${projectId}`);
    }
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    return gateStore.listIas23Capitalizations(projectId);
  }
}
