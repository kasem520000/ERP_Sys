import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import {
  GroupNotActiveError,
  GroupNotFoundError,
  MemberNotInGroupError,
  MemberPeriodOpenError,
  RunNotCompleteError,
  RunNotFoundError,
  SnapshotMissingError,
} from "../domain/consolidation-errors";
import {
  assertInv026,
  computeConsolidatedLines,
  throwOnDrift,
  type EliminationEffectLine,
  type MemberExtractLine,
} from "./consolidation-math";
import {
  requireDatedRate,
  type FxTranslationMethod,
  type StoredRate,
} from "./fx-translation";
import { buildSnapshot, type ConsolidationSnapshot } from "./snapshot";
import { ConsolidationReaderService } from "./reader-service";
import {
  findGroupById,
  findLatestCompletedRun,
  findOwnerPeriod,
  findRunById,
  insertRun,
  listActiveGroupMembers,
  listEliminations,
  listOwnerRates,
  listRuns,
  readEliminationEffects,
  updateRun,
  type GroupRow,
  type MemberGlRow,
  type RunRow,
} from "../infrastructure/consolidation.store";
/**
 * PHASE-034 T6 · the run orchestration: BR-056 pre-check (typed
 * MEMBER_PERIOD_OPEN rejection — never a warning), QUEUED → RUNNING →
 * COMPLETED/FAILED as a bounded pg-boss job (ADR-0008; the job wiring
 * lives in infrastructure/consolidation-run.job.ts), and the immutable
 * versioned SNAPSHOT (member statement extracts in group currency + the
 * frozen elimination set + the consolidated line set — ADR-0017: a
 * derived artifact, never a second ledger).
 *
 * INV-026 is enforced AT BUILD TIME: a snapshot that does not reconcile
 * line-by-line (consolidated == Σ members − eliminations) never reaches
 * COMPLETED — the run FAILS typed (ASSERTION_FAILED) with zero partial
 * snapshot (the CHECK constraint enforces the shape at the DB level too).
 * Runs never write member books: the member reads go through the audited
 * reader ONLY (the byte-compare suite proves member GL rows are identical
 * before/after).
 *
 * FX translation (T7, the OQ-V2-2 decision DR-P34-FX-1): the member's
 * posted base totals translate into the GROUP currency at the OWNER's
 * dated stored rates (latest stored ≤ the period end, exactly as stored —
 * INV-008; RATE_MISSING fails closed). Same-currency members pass through
 * UNTOUCHED (no multiplication — byte-stable parity with the member's own
 * books). CLOSING_RATE and TEMPORARY share the per-period translation at
 * PHASE-034 (the TEMPORARY equity-recycling delta is the bounded extra
 * leg — computeEquityRecyclingDelta in fx-translation.ts — surfaced as a
 * CONSOLIDATION_ADJUSTMENT elimination line when the group's method is
 * TEMPORARY; recorded honestly in the completion report).
 */
@Injectable()
export class RunService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ConsolidationReaderService) private readonly reader: ConsolidationReaderService,
  ) {}

  async find(runId: string): Promise<RunRow> {
    const row = await findRunById(runId);
    if (row === undefined) throw new RunNotFoundError(runId);
    return row;
  }

  async list(filter: { groupId?: string; status?: string }): Promise<RunRow[]> {
    return listRuns(filter);
  }

  /**
   * Create a run (QUEUED): the BR-056 pre-check walks EVERY active member,
   * resolves the member's fiscal period covering the run window (each
   * member's period ids are its own — the reader's period-lookup leg,
   * audited per lookup), and rejects with the typed MEMBER_PERIOD_OPEN if
   * any covering period is OPEN or missing (an unmapped calendar cannot be
   * consolidated — the same fail-closed posture). include_from bounds the
   * window per member.
   */
  async createRun(input: {
    groupId: string;
    fiscalPeriodId: string;
    actorId: string | null;
  }): Promise<RunRow> {
    const group = await findGroupById(input.groupId);
    if (group === undefined) throw new GroupNotFoundError(input.groupId);
    if (group.status !== "ACTIVE") {
      throw new GroupNotActiveError({ groupId: input.groupId, status: group.status });
    }
    const period = await findOwnerPeriod(input.fiscalPeriodId);
    if (period === undefined) {
      throw new RunNotFoundError("(fiscal-period)");
    }
    const members = await listActiveGroupMembers(input.groupId);
    if (members.length === 0) {
      throw new MemberNotInGroupError({
        groupId: input.groupId,
        memberTenantId: "(none)",
      });
    }
    for (const member of members) {
      const windowStart =
        member.includeFrom !== null && member.includeFrom > period.startDate
          ? member.includeFrom
          : period.startDate;
      const memberPeriods = await this.reader.readMemberPeriods({
        groupId: input.groupId,
        memberTenantId: member.memberTenantId,
        windowStart,
        windowEnd: period.endDate,
        runId: null,
        actorId: input.actorId,
      });
      const covering = memberPeriods.find((candidate) => candidate.end_date >= period.endDate);
      if (covering === undefined || covering.status === "OPEN") {
        throw new MemberPeriodOpenError({
          groupId: input.groupId,
          memberTenantId: member.memberTenantId,
          fiscalPeriodId: input.fiscalPeriodId,
          periodName: covering?.period_name,
        });
      }
    }
    const run = await insertRun({
      groupId: input.groupId,
      fiscalPeriodId: input.fiscalPeriodId,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "consolidation.run.created",
      entityType: "consolidation_run",
      entityId: run.id,
      actorId: input.actorId ?? undefined,
      after: {
        groupId: input.groupId,
        fiscalPeriodId: input.fiscalPeriodId,
        memberCount: members.length,
        br056Precheck: "passed",
      },
    });
    return run;
  }

  /**
   * EXECUTE the run (the job handler's body; also directly callable —
   * idempotent per state machine: a COMPLETED or RUNNING run returns its
   * row untouched; re-consolidation is always a NEW run). The whole body
   * runs in the OWNER tenant's ambient UoW: every member read through the
   * audited reader, translation at dated stored rates (INV-008), the
   * elimination set frozen from the parent's posted journals, the INV-026
   * line-by-line gate, then COMPLETED + snapshot — or FAILED typed with
   * ZERO partial snapshot.
   */
  async executeRun(input: { runId: string; actorId: string | null }): Promise<RunRow> {
    const run = await this.find(input.runId);
    if (run.status === "COMPLETED" || run.status === "RUNNING") {
      return run;
    }
    const group = await findGroupById(run.groupId);
    if (group === undefined) throw new GroupNotFoundError(run.groupId);
    const period = await findOwnerPeriod(run.fiscalPeriodId);
    if (period === undefined) throw new RunNotFoundError("(fiscal-period)");

    const started = await updateRun(run.id, {
      status: "RUNNING",
      startedAt: new Date().toISOString(),
    });
    if (started === undefined) throw new RunNotFoundError(run.id);

    try {
      const snapshot = await this.buildSnapshot({
        runId: run.id,
        group,
        fiscalPeriodId: run.fiscalPeriodId,
        periodStartDate: period.startDate,
        periodEndDate: period.endDate,
        actorId: input.actorId,
      });
      const completed = await updateRun(run.id, {
        status: "COMPLETED",
        completedAt: new Date().toISOString(),
        snapshot,
        snapshotVersion: 1,
      });
      if (completed === undefined) throw new RunNotFoundError(run.id);
      await this.audit.record({
        action: "consolidation.run.completed",
        entityType: "consolidation_run",
        entityId: run.id,
        actorId: input.actorId ?? undefined,
        after: {
          groupId: run.groupId,
          fiscalPeriodId: run.fiscalPeriodId,
          memberCount: snapshot.members.length,
          eliminationLineCount: snapshot.eliminations.length,
          inv026: snapshot.inv026.status,
        },
      });
      return completed;
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as { code?: unknown }).code ?? "RUN_FAILED")
          : "RUN_FAILED";
      const failed = await updateRun(run.id, {
        status: "FAILED",
        completedAt: new Date().toISOString(),
        errorCode: code,
        errorDetail: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
      if (failed === undefined) throw new RunNotFoundError(run.id);
      await this.audit.record({
        action: "consolidation.run.failed",
        entityType: "consolidation_run",
        entityId: run.id,
        actorId: input.actorId ?? undefined,
        after: { errorCode: code },
      });
      return failed;
    }
  }

  /**
   * The snapshot build (reader → FX → freeze → INV-026 gate). Reads
   * members through the audited reader ONLY; resolves rates from the
   * OWNER's own dated stored rate table; freezes eliminations from the
   * parent's POSTED elimination journals (owner scope — never member
   * books); builds the consolidated line set; gates on INV-026
   * line-by-line.
   */
  async buildSnapshot(input: {
    runId: string;
    group: GroupRow;
    fiscalPeriodId: string;
    periodStartDate: string;
    periodEndDate: string;
    actorId: string | null;
  }): Promise<ConsolidationSnapshot> {
    const groupCurrency = input.group.baseCurrency;
    const members = await listActiveGroupMembers(input.group.id);

    // -- pass 1: read every member (audited) + collect the currency set
    interface MemberPass {
      memberTenantId: string;
      ownershipPercent: string;
      includeFrom: string | null;
      memberName: string | null;
      glRows: MemberGlRow[];
    }
    const passes: MemberPass[] = [];
    const currencies = new Set<string>();
    for (const member of members) {
      const windowStart =
        member.includeFrom !== null && member.includeFrom > input.periodStartDate
          ? member.includeFrom
          : input.periodStartDate;
      const memberPeriods = await this.reader.readMemberPeriods({
        groupId: input.group.id,
        memberTenantId: member.memberTenantId,
        windowStart,
        windowEnd: input.periodEndDate,
        runId: input.runId,
        actorId: input.actorId,
      });
      const covering = memberPeriods.find((candidate) => candidate.end_date >= input.periodEndDate);
      if (covering === undefined || covering.status === "OPEN") {
        // BR-056 re-verified at READ time (defense in depth — a period
        // reopened between creation and execution fails HERE, closed).
        throw new MemberPeriodOpenError({
          groupId: input.group.id,
          memberTenantId: member.memberTenantId,
          fiscalPeriodId: input.fiscalPeriodId,
          periodName: covering?.period_name,
        });
      }
      const glRows = await this.reader.readMemberGl({
        groupId: input.group.id,
        memberTenantId: member.memberTenantId,
        memberPeriodId: covering.period_id,
        runId: input.runId,
        actorId: input.actorId,
      });
      for (const row of glRows) {
        currencies.add(row.currency);
      }
      passes.push({
        memberTenantId: member.memberTenantId,
        ownershipPercent: member.ownershipPercent,
        includeFrom: member.includeFrom,
        memberName: member.note ?? null,
        glRows,
      });
    }

    // -- resolve the owner's dated stored rates for every foreign currency
    // (INV-008: latest stored ≤ period end, exactly as stored; the foreign
    // set excludes the group base — same-currency rows pass through).
    const foreignCurrencies = [...currencies].filter((currency) => currency !== groupCurrency);
    const storedRates: StoredRate[] = await listOwnerRates(foreignCurrencies, input.periodEndDate);
    const rateIndex = new Map<string, StoredRate[]>();
    for (const rate of storedRates) {
      const bucket = rateIndex.get(rate.currency) ?? [];
      bucket.push(rate);
      rateIndex.set(rate.currency, bucket);
    }

    // -- pass 2: translate (dated stored rate; pass-through for the group
    // currency — NO multiplication, byte-stable member parity)
    const memberExtracts: MemberExtractLine[] = [];
    const appliedRatesByMember: Record<string, Record<string, string>> = {};
    for (const pass of passes) {
      const applied: Record<string, string> = {};
      for (const row of pass.glRows) {
        let debit = row.base_debit_total;
        let credit = row.base_credit_total;
        if (row.currency !== groupCurrency) {
          const rate = requireDatedRate(
            new Map(
              (rateIndex.get(row.currency) ?? []).map((candidate) => [
                `${candidate.currency}@${candidate.rateDate}`,
                candidate.rate,
              ]),
            ),
            row.currency,
            input.periodEndDate,
            input.group.id,
          );
          debit = translateExact(debit, rate);
          credit = translateExact(credit, rate);
          applied[row.currency] = rate;
        }
        memberExtracts.push({
          memberTenantId: pass.memberTenantId,
          accountCode: row.account_code,
          accountType: row.account_type,
          purposeKey: row.purpose_key,
          amounts: { debit, credit },
        });
      }
      appliedRatesByMember[pass.memberTenantId] = applied;
    }

    // -- freeze the elimination set: the parent's POSTED elimination
    // journals for the group + period (owner scope — never member books)
    const postedEliminations = await listEliminations({
      groupId: input.group.id,
      fiscalPeriodId: input.fiscalPeriodId,
      status: "POSTED",
    });
    const effects = await readEliminationEffects(postedEliminations.map((row) => row.id));
    const numbersById = new Map(postedEliminations.map((row) => [row.id, row.eliminationNo]));
    const eliminationLines: EliminationEffectLine[] = effects.map((effect) => ({
      eliminationId: effect.eliminationId,
      eliminationNo: numbersById.get(effect.eliminationId) ?? null,
      accountCode: effect.accountCode,
      purposeKey: effect.purposeKey,
      amounts: { debit: effect.debit, credit: effect.credit },
    }));

    // -- the consolidated line set + the INV-026 build-time gate
    const consolidated = computeConsolidatedLines(memberExtracts, eliminationLines);
    const inv026 = assertInv026({
      runId: input.runId,
      consolidated,
      members: memberExtracts,
      eliminations: eliminationLines,
    });
    throwOnDrift({ runId: input.runId, result: inv026 });

    return buildSnapshot({
      runId: input.runId,
      groupId: input.group.id,
      fiscalPeriodId: input.fiscalPeriodId,
      periodEndDate: input.periodEndDate,
      group: {
        groupId: input.group.id,
        name: input.group.name,
        nameAr: input.group.nameAr,
        baseCurrency: groupCurrency,
        fxTranslationMethod: input.group.fxTranslationMethod as FxTranslationMethod,
      },
      members: passes.map((pass) => ({
        memberTenantId: pass.memberTenantId,
        memberName: pass.memberName,
        ownershipPercent: pass.ownershipPercent,
        includeFrom: pass.includeFrom,
        baseCurrency: pass.glRows[0]?.currency ?? groupCurrency,
        appliedRates: appliedRatesByMember[pass.memberTenantId] ?? {},
      })),
      memberExtracts,
      eliminations: eliminationLines,
      consolidated,
      inv026: {
        status: inv026.status,
        compared: inv026.compared,
        brokenLines: inv026.brokenLines,
      },
    });
  }

  /**
   * The statement-render lookup: the LATEST COMPLETED run's snapshot for a
   * (group, period) — statements read snapshots, never live member books
   * (O(1) renders; the report contracts consume exactly this).
   */
  async latestSnapshot(input: {
    groupId: string;
    fiscalPeriodId: string;
  }): Promise<{ run: RunRow; snapshot: ConsolidationSnapshot }> {
    const run = await findLatestCompletedRun(input.groupId, input.fiscalPeriodId);
    if (run === undefined) {
      throw new RunNotCompleteError({ runId: "(none)", status: "NO_COMPLETED_RUN" });
    }
    if (run.snapshot === null || run.snapshot === undefined) {
      throw new SnapshotMissingError(run.id);
    }
    return { run, snapshot: run.snapshot as ConsolidationSnapshot };
  }
}

/** amount × rate at canonical 4dp half-up (the moneyRate discipline —
 * Decimal, never Math.*; CURRENCY_AND_PRECISION §5: round once, at the
 * final step). */
function translateExact(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}
