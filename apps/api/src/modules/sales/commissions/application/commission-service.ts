import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../../audit/api/audit";
import { PostingService } from "../../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../../infra/settings/setting-reader";
import * as store from "../../infrastructure/commissions.store";
import type { CommissionRunLineRow, CommissionRunRow, CommissionTier } from "../../infrastructure/commissions.store";
import { SalesRepNotFoundError } from "../../domain/sales-errors";
import { CommissionRuleInvalidError, CommissionRunNotFoundError, CommissionRunStateError } from "../domain/commission-errors";

/**
 * Commission service (PHASE-017 T7-a; §2 item 10 + CAPABILITY_MATRIX §2.5):
 * per-rep commission rules (flat percentage or tiered bands on the INVOICED
 * or COLLECTED base) + commission runs — compute from POSTED, non-reversed
 * sales in a window, then accrue EXACTLY at run post time with ONE journal:
 *
 *   DR COMMISSION_EXPENSE (one line per earning rep, memo the rep)   Σ = total
 *   CR COMMISSION_ACCRUAL (one line, the run total)                  Σ = total
 *
 * source { docType: "commission_run", docId: runId, operation: "accrual" }.
 * The invoice and its VAT are NEVER touched (a commission is an expense of
 * the period, not a mutation of the sale); payouts are ordinary treasury
 * payments — out of scope here, payout_status starts ACCRUED and payments
 * flip it later via payment_id (a later task).
 *
 * Semantics (documented decisions):
 *
 * - RUN-LEVEL BASIS: a run computes every line on ONE basis (INVOICED or
 *   COLLECTED) — mixing per-rep bases inside a single accrual journal would
 *   blend unlike measures. Reps whose rule basis ≠ the run basis are
 *   EXCLUDED from earning but get a zero note-line (base 0, rate 0,
 *   commission 0, detail { excluded: true, reason: "BASIS_MISMATCH", ... })
 *   so the commissions-due statement explains their absence; excluded lines
 *   contribute nothing to either run total and never produce a DR line.
 *
 * - INVOICED BASE (posted, non-reversed): Σ total_net of the rep's POSTED
 *   sales invoices dated in the window MINUS Σ total_net of the rep's
 *   POSTED credit notes dated in the window (a credit note is the only
 *   reversal channel — an invoice is never mutated).
 *
 * - COLLECTED BASE: Σ allocations of POSTED receipts against the rep's
 *   invoice open items, receipt value_date in the window.
 *
 * - FLAT MATH: commission = round₄(base × rate%).
 *
 * - TIERED MATH (portion bands): bands B₁..Bₙ sorted ascending, Bₙ.upTo =
 *   null (open). portionᵢ = min(base, upToᵢ) − min(base, upToᵢ₋₁) with
 *   upTo₀ = 0; each portion ≥ 0 and Σ portions = base.
 *   commission = round₄(Σᵢ portionᵢ × rateᵢ%) — exact Decimal band products
 *   summed, ONE half-up rounding at the end (the golden example:
 *   tiers [{upTo 1000, rate 1}, {upTo null, rate 3}], base 1600 →
 *   1000×1% = 10 + 600×3% = 18 → 28.0000). rate_applied stores the flat
 *   rate, or the EFFECTIVE rate (commission ÷ base × 100) for tiered lines.
 *
 * - RUNS HAVE NO NUMBER SERIES (commission_runs has no number column by
 *   design); the run id is the reference.
 *
 * - ACCRUAL DATE = the run's period_to (the matching principle: the
 *   expense lands in the period the commissions were earned; the engine
 *   rejects a locked period with its own typed error).
 *
 * - POST IDEMPOTENCY (INV-013): a POSTED run re-posts as a typed
 *   CommissionRunStateError (no second accrual); the engine's
 *   (source, docId, operation) unique key is the concurrent backstop, so a
 *   racing double-post converges on the single stored entry.
 *
 * - COMPUTE IS REPEATABLE on DRAFT runs (a recompute rewrites the line
 *   set in place — per-rep upsert; reps that drop out are zeroed with a
 *   `dropped` detail note, never deleted — the 0025 grant model); POSTED
 *   runs are immutable — corrections reverse the accrual journal
 *   (INV-014), never a recompute. CANCEL is DRAFT-only and terminal.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d{1,4})?$/;
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;
const MAX_TIERS = 20;

export interface CommissionRuleInput {
  method: "NONE" | "PERCENTAGE";
  /** Flat percentage 0..100 (4dp) — required for flat PERCENTAGE rules, must be 0/absent with tiers or NONE. */
  rate?: string | null;
  basis?: "INVOICED" | "COLLECTED";
  /** Tiered bands (mutually exclusive with a flat rate); null for flat/NONE rules. */
  tiers?: readonly CommissionTier[] | null;
}

export interface CreateCommissionRunInput {
  periodFrom: string;
  periodTo: string;
  basis: "INVOICED" | "COLLECTED";
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

/** A run with its lines (the findWithLines statement shape). */
export interface CommissionRunWithLines extends CommissionRunRow {
  lines: CommissionRunLineRow[];
}

function money(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Portion-band product: portion × rate% (exact Decimal, no rounding). */
function bandAmount(portion: Decimal, rate: string): Decimal {
  return portion.times(new Decimal(rate)).dividedBy(new Decimal(100));
}

@Injectable()
export class CommissionService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  // -- per-rep rules ----------------------------------------------------------------

  async getRule(repId: string): Promise<store.RepCommissionRuleRow> {
    const rule = await store.getRepCommissionRule(repId);
    if (rule === undefined) throw new SalesRepNotFoundError(repId);
    return rule;
  }

  async setRule(repId: string, input: CommissionRuleInput, actorId: string | null): Promise<store.RepCommissionRuleRow> {
    const existing = await store.getRepCommissionRule(repId);
    if (existing === undefined) throw new SalesRepNotFoundError(repId);

    const basis: "INVOICED" | "COLLECTED" = input.basis ?? "INVOICED";
    const rateInput = input.rate ?? null;
    const tiersInput = input.tiers ?? null;

    if (input.method === "NONE") {
      if (rateInput !== null) {
        if (!RATE_RE.test(rateInput)) {
          throw new CommissionRuleInvalidError(`rate must be a decimal percentage string (got ${rateInput})`);
        }
        if (new Decimal(rateInput).comparedTo(new Decimal(0)) !== 0) {
          throw new CommissionRuleInvalidError(
            `method NONE carries no rate (got ${rateInput}) — set method PERCENTAGE to commission this rep, or clear the rate`,
          );
        }
      }
      if (tiersInput !== null && tiersInput.length > 0) {
        throw new CommissionRuleInvalidError("method NONE carries no tier bands — set method PERCENTAGE to commission this rep");
      }
      const saved = await store.setRepCommissionRule({ repId, method: "NONE", rate: "0.0000", basis, tiers: null, actorId });
      await this.audit.record({
        action: "sales.commission_rule_set",
        entityType: "sales_rep",
        entityId: repId,
        actorId: actorId ?? undefined,
        before: { method: existing.method, rate: existing.rate, basis: existing.basis, tiers: existing.tiers },
        after: { method: "NONE", rate: "0.0000", basis, tiers: null },
      });
      return saved;
    }

    // method PERCENTAGE: exactly one of flat rate or tier bands.
    if (rateInput !== null && !RATE_RE.test(rateInput)) {
      throw new CommissionRuleInvalidError(`rate must be a decimal percentage string (got ${rateInput})`);
    }
    if (rateInput !== null && new Decimal(rateInput).comparedTo(new Decimal(100)) > 0) {
      throw new CommissionRuleInvalidError(`rate must be within 0..100 (got ${rateInput})`);
    }
    const hasTiers = tiersInput !== null && tiersInput.length > 0;
    const hasRate = rateInput !== null && new Decimal(rateInput).comparedTo(new Decimal(0)) !== 0;
    if (hasTiers && hasRate) {
      throw new CommissionRuleInvalidError(
        `provide either a flat rate (${rateInput}) or tier bands — not both; the tiered rule ignores the flat column`,
      );
    }

    if (hasTiers) {
      const tiers = normalizeTiers(tiersInput!);
      const saved = await store.setRepCommissionRule({ repId, method: "PERCENTAGE", rate: "0.0000", basis, tiers, actorId });
      await this.audit.record({
        action: "sales.commission_rule_set",
        entityType: "sales_rep",
        entityId: repId,
        actorId: actorId ?? undefined,
        before: { method: existing.method, rate: existing.rate, basis: existing.basis, tiers: existing.tiers },
        after: { method: "PERCENTAGE", rate: "0.0000", basis, tiers },
      });
      return saved;
    }

    const flatRate = money(rateInput ?? "0");
    const saved = await store.setRepCommissionRule({
      repId,
      method: "PERCENTAGE",
      rate: flatRate,
      basis,
      tiers: null,
      actorId,
    });
    await this.audit.record({
      action: "sales.commission_rule_set",
      entityType: "sales_rep",
      entityId: repId,
      actorId: actorId ?? undefined,
      before: { method: existing.method, rate: existing.rate, basis: existing.basis, tiers: existing.tiers },
      after: { method: "PERCENTAGE", rate: flatRate, basis, tiers: null },
    });
    return saved;
  }

  // -- runs --------------------------------------------------------------------------

  async find(runId: string): Promise<CommissionRunRow> {
    const run = await store.findCommissionRunById(runId);
    if (run === undefined) throw new CommissionRunNotFoundError(runId);
    return run;
  }

  async list(filter: { status?: string; limit: number }): Promise<CommissionRunRow[]> {
    return store.listCommissionRuns(filter);
  }

  async findWithLines(runId: string): Promise<CommissionRunWithLines> {
    const run = await this.find(runId);
    return { ...run, lines: await store.listCommissionRunLines(runId) };
  }

  /** Create + compute in ONE call (the registered route set has no separate
   * compute endpoint; the POST body carries the period). Status stays DRAFT
   * after creation — compute is repeatable, post is the accrual point. */
  async createRun(input: CreateCommissionRunInput): Promise<CommissionRunWithLines> {
    if (!DATE_RE.test(input.periodFrom) || !DATE_RE.test(input.periodTo)) {
      throw new CommissionRuleInvalidError("periodFrom/periodTo must be ISO yyyy-mm-dd dates");
    }
    if (input.periodFrom > input.periodTo) {
      throw new CommissionRuleInvalidError(`period ${input.periodFrom}..${input.periodTo} is inverted (periodFrom must precede periodTo)`);
    }
    const created = await store.insertCommissionRun({
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      basis: input.basis,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "sales.commission_run_created",
      entityType: "commission_run",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { periodFrom: created.periodFrom, periodTo: created.periodTo, basis: created.basis, status: "DRAFT" },
    });
    await this.compute(created.id, input.actorId);
    return this.findWithLines(created.id);
  }

  /** (Re)compute a DRAFT run's lines from the current posted surface. */
  async compute(runId: string, actorId: string | null): Promise<CommissionRunWithLines> {
    const run = await this.find(runId);
    if (run.status !== "DRAFT") {
      throw new CommissionRunStateError(
        `commission run ${runId} is ${run.status} — only DRAFT runs compute (POSTED runs are immutable; corrections reverse the accrual journal, INV-014)`,
      );
    }

    const reps = await store.listRepsWithRules({ status: "ACTIVE", limit: 500 });
    const lines: store.CommissionRunLineInsert[] = [];
    let excluded = 0;

    for (const rep of reps) {
      if (rep.method !== "PERCENTAGE") continue; // NONE reps never earn — no line, no note

      // Run-level basis: a rep whose rule basis differs is excluded from
      // earning but keeps a zero note-line so the statement explains why.
      if (rep.basis !== run.basis) {
        excluded += 1;
        lines.push({
          salesRepId: rep.repId,
          baseAmount: "0.0000",
          rateApplied: "0.0000",
          commissionAmount: "0.0000",
          detail: {
            excluded: true,
            reason: "BASIS_MISMATCH",
            note: `rep rule basis ${rep.basis} ≠ run basis ${run.basis} — excluded from this run`,
            ruleBasis: rep.basis,
            runBasis: run.basis,
          },
        });
        continue;
      }

      const base = await store.repCommissionBase(rep.repId, run.periodFrom, run.periodTo, run.basis);
      if (new Decimal(base.base).comparedTo(new Decimal(0)) === 0) continue; // no activity — no line

      const { commission, rateApplied, bands } = applyRule(rep, base.base);
      lines.push({
        salesRepId: rep.repId,
        baseAmount: base.base,
        rateApplied,
        commissionAmount: commission,
        detail: {
          excluded: false,
          method: rep.tiers === null ? "FLAT" : "TIERED",
          invoicedNet: base.detail.invoicedNet,
          creditedNet: base.detail.creditedNet,
          collectedNet: base.detail.collectedNet,
          ...(bands === null ? {} : { bands }),
        },
      });
    }

    await store.replaceCommissionRunLines(runId, lines, actorId);
    const totalBase = lines
      .reduce((sum, line) => sum.plus(new Decimal(line.baseAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    const totalCommission = lines
      .reduce((sum, line) => sum.plus(new Decimal(line.commissionAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    await store.patchCommissionRun({
      id: runId,
      totalBase,
      totalCommission,
      stampComputedAt: true,
    });
    await this.audit.record({
      action: "sales.commission_run_computed",
      entityType: "commission_run",
      entityId: runId,
      actorId: actorId ?? undefined,
      after: { lines: lines.length, excluded, totalBase, totalCommission, basis: run.basis },
    });
    return this.findWithLines(runId);
  }

  /** The accrual point: ONE journal per run (DR expense per rep · CR accrual). */
  async post(
    runId: string,
    actorId: string | null,
  ): Promise<{ run: CommissionRunRow; journalEntryId: string; entryNo: string | null; idempotentReplay: boolean }> {
    const run = await this.find(runId);
    if (run.status === "POSTED") {
      throw new CommissionRunStateError(
        `commission run ${runId} is already POSTED (journal ${run.journalEntryId}) — a re-post creates no second accrual (INV-013); corrections reverse the accrual journal`,
      );
    }
    if (run.status === "CANCELLED") {
      throw new CommissionRunStateError(`commission run ${runId} is CANCELLED — cancelled runs never post`);
    }
    const lines = await store.listCommissionRunLines(runId);
    if (lines.length === 0) {
      throw new CommissionRunStateError(
        `commission run ${runId} has no computed lines — compute before posting (create computes inline; an empty window yields nothing to accrue)`,
      );
    }
    const earning = lines.filter((line) => new Decimal(line.commissionAmount).comparedTo(new Decimal(0)) > 0);
    const total = earning
      .reduce((sum, line) => sum.plus(new Decimal(line.commissionAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    if (new Decimal(total).comparedTo(new Decimal(0)) <= 0) {
      throw new CommissionRunStateError(
        `commission run ${runId} carries no commission to accrue (total ${total}) — every line is zero or an exclusion note`,
      );
    }

    const journalLines: JournalLineSpec[] = earning.map((line) => ({
      purpose: "COMMISSION_EXPENSE",
      direction: "DEBIT",
      amount: line.commissionAmount,
      memo: {
        en: `Commission — ${line.repName} (${line.repCode})`,
        ar: `عمولة — ${line.repName}`,
      },
    }));
    journalLines.push({
      purpose: "COMMISSION_ACCRUAL",
      direction: "CREDIT",
      amount: total,
      memo: {
        en: `Commission accrual — run ${runId} (${run.periodFrom}..${run.periodTo}, ${run.basis})`,
        ar: `مخصص عمولات — التشغيلة ${runId}`,
      },
    });

    // Balance holds by construction (Σ DR = Σ CR = total); the engine's own
    // balance validation is the invariant backstop.
    const currency = await ownTenantBaseCurrency();
    const spec: JournalSpec = {
      source: { docType: "commission_run", docId: runId, operation: "accrual" },
      entryDate: run.periodTo,
      description: {
        en: `Commission accrual — run ${runId} (${run.periodFrom}..${run.periodTo}, basis ${run.basis})`,
        ar: `مخصص عمولات — التشغيلة ${runId} (${run.periodFrom}..${run.periodTo})`,
      },
      currency,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });

    await store.patchCommissionRun({
      id: runId,
      status: "POSTED",
      journalEntryId: result.journalEntryId,
      stampPostedAt: true,
      postedBy: actorId,
    });
    await this.audit.record({
      action: "sales.commission_run_posted",
      entityType: "commission_run",
      entityId: runId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT", totalCommission: run.totalCommission },
      after: {
        status: "POSTED",
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        totalCommission: total,
        earningReps: earning.length,
        idempotentReplay: result.idempotentReplay,
      },
    });
    return {
      run: await this.find(runId),
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      idempotentReplay: result.idempotentReplay,
    };
  }

  /** Cancel a DRAFT run (terminal). POSTED runs are immutable — the
   * corrections path is a reversal of the accrual journal (INV-014). */
  async cancel(runId: string, input: { reason: string; actorId: string | null }): Promise<CommissionRunRow> {
    const run = await this.find(runId);
    if (run.status === "POSTED") {
      throw new CommissionRunStateError(
        `commission run ${runId} is POSTED and immutable — cancel is reversal-only: reverse the accrual journal ${run.journalEntryId} (INV-014)`,
      );
    }
    if (run.status === "CANCELLED") {
      throw new CommissionRunStateError(`commission run ${runId} is already CANCELLED`);
    }
    await store.patchCommissionRun({ id: runId, status: "CANCELLED" });
    await this.audit.record({
      action: "sales.commission_run_cancelled",
      entityType: "commission_run",
      entityId: runId,
      actorId: input.actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "CANCELLED", reason: input.reason },
    });
    return this.find(runId);
  }
}

/** Validate + normalize tier bands: 1..MAX_TIERS, each rate 0..100 (4dp),
 * closed bands carry a positive upTo (4dp), bands strictly ascending, and
 * the LAST band is the open one (upTo null) — exactly one null, in last
 * position. Returns the canonical 4dp-string bands for the jsonb column. */
function normalizeTiers(tiers: readonly CommissionTier[]): CommissionTier[] {
  if (tiers.length === 0 || tiers.length > MAX_TIERS) {
    throw new CommissionRuleInvalidError(`tier bands must number 1..${MAX_TIERS} (got ${tiers.length})`);
  }
  const normalized: CommissionTier[] = [];
  for (let index = 0; index < tiers.length; index += 1) {
    const band = tiers[index]!;
    const isLast = index === tiers.length - 1;
    if (typeof band.rate !== "string" || !RATE_RE.test(band.rate)) {
      throw new CommissionRuleInvalidError(`tier ${index + 1} rate must be a decimal percentage string (got ${String(band.rate)})`);
    }
    const rate = new Decimal(band.rate);
    if (rate.comparedTo(new Decimal(100)) > 0) {
      throw new CommissionRuleInvalidError(`tier ${index + 1} rate must be within 0..100 (got ${band.rate})`);
    }
    if (band.upTo === null) {
      if (!isLast) {
        throw new CommissionRuleInvalidError(
          `tier ${index + 1} has no upTo bound — only the LAST band may be open (null upTo)`,
        );
      }
      normalized.push({ upTo: null, rate: money(band.rate) });
      continue;
    }
    if (typeof band.upTo !== "string" || !AMOUNT_RE.test(band.upTo)) {
      throw new CommissionRuleInvalidError(`tier ${index + 1} upTo must be a positive decimal amount string (got ${String(band.upTo)})`);
    }
    const upTo = new Decimal(band.upTo);
    if (upTo.comparedTo(new Decimal(0)) <= 0) {
      throw new CommissionRuleInvalidError(`tier ${index + 1} upTo must be positive (got ${band.upTo})`);
    }
    normalized.push({ upTo: money(band.upTo), rate: money(band.rate) });
  }
  if (normalized[normalized.length - 1]!.upTo !== null) {
    throw new CommissionRuleInvalidError(
      "the last tier band must be the open band (upTo null) — a bounded final band would strand any base above it",
    );
  }
  for (let index = 1; index < normalized.length - 1; index += 1) {
    const previous = new Decimal(normalized[index - 1]!.upTo!);
    const current = new Decimal(normalized[index]!.upTo!);
    if (current.comparedTo(previous) <= 0) {
      throw new CommissionRuleInvalidError(
        `tier bands must be strictly ascending and non-overlapping (band ${index + 1} upTo ${normalized[index]!.upTo} ≤ band ${index} upTo ${normalized[index - 1]!.upTo})`,
      );
    }
  }
  return normalized;
}

/** Apply a PERCENTAGE rule to a base: flat rate or tiered portion math.
 * Returns the 4dp commission, the rate_applied column value (flat rate, or
 * the effective rate for tiered), and the per-band breakdown for detail. */
function applyRule(
  rep: store.RepCommissionRuleRow,
  base: string,
): { commission: string; rateApplied: string; bands: { upTo: string | null; rate: string; portion: string; amount: string }[] | null } {
  const baseAmount = new Decimal(base);

  if (rep.tiers === null || rep.tiers.length === 0) {
    const commission = baseAmount
      .times(new Decimal(rep.rate))
      .dividedBy(new Decimal(100))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    return { commission, rateApplied: money(rep.rate), bands: null };
  }

  // Portion bands: portion_i = min(base, upTo_i) − min(base, upTo_{i-1}).
  let lower = new Decimal(0);
  let commission = new Decimal(0);
  const bands: { upTo: string | null; rate: string; portion: string; amount: string }[] = [];
  for (const tier of rep.tiers) {
    const upper = tier.upTo === null ? null : new Decimal(tier.upTo);
    const portion =
      upper === null
        ? baseAmount.minus(lower)
        : Decimal.min(baseAmount, upper).minus(lower);
    if (portion.comparedTo(new Decimal(0)) > 0) {
      const amount = bandAmount(portion, tier.rate);
      commission = commission.plus(amount);
      bands.push({
        upTo: tier.upTo,
        rate: money(tier.rate),
        portion: portion.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        amount: amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      });
    }
    if (upper !== null) lower = Decimal.max(lower, upper);
    if (upper !== null && upper.comparedTo(baseAmount) >= 0) break; // base exhausted
  }
  const commissionTotal = commission.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
  const effective = baseAmount.comparedTo(new Decimal(0)) === 0
    ? new Decimal(0)
    : commission.times(new Decimal(100)).dividedBy(baseAmount);
  return {
    commission: commissionTotal,
    rateApplied: effective.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    bands,
  };
}
