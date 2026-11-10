import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { AuditService } from "../../audit/api/audit";
import { requireTenantContext, type TenantContext } from "../../../infra/db/tenant-context";
import { childLogger } from "../../../infra/observability/logger";
import { processMetrics } from "../../../infra/observability/metrics";
import { PostingEngine, type PostingReadModel } from "../domain/posting-engine/posting-engine";
import {
  type JournalSpec,
  type PostingResult,
  type ReversalInput,
} from "../domain/posting-engine/journal-spec";
import { alreadyReversed, PostingError } from "../domain/posting-engine/posting-errors";
import { publishLedgerEvent } from "./ledger-events";
import { JournalStateError, PeriodNotFoundError } from "../domain/accounting-errors";
import * as store from "../infrastructure/accounting.store";
import * as journal from "../infrastructure/journal.store";
import {
  PARTNER_SUBLEDGER_PORT,
  type PartnerSubledgerEffect,
  type PartnerSubledgerPort,
} from "./partner-subledger-port";

/**
 * Posting application service (PHASE-007 T7/T8; POSTING_ENGINE.md §1/§5/§6;
 * ADR-0007): the transaction orchestration around the pure engine —
 * idempotent replay, JE-{yyyy}-{seq:6} numbering inside the caller's UoW,
 * the single write phase (entry + lines + subledger + audit), and the
 * reversal flow (INV-014). Runs INSIDE the ambient tenant transaction (the
 * HTTP interceptor's UoW or a service-to-service caller's) — partial
 * failure rolls the whole thing back (§5).
 */

const ENGINE = new PostingEngine();

const log = childLogger({ module: "posting-service" });

/**
 * PHASE-025 T9c wiring — the posting SLO's zero-tolerance leg (MONITORING
 * §3 PostingInvariantFail; POSTING_ENGINE.md §3): the INV-001/002 balance
 * failure (ENTRY_NOT_BALANCED) is the engine-internal bug class — "should
 * never fire". Every other PostingError code is a business-rule rejection
 * (user-input class), not an invariant breach.
 */
function postingFailureClass(
  error: unknown,
): { code: string; invariant: boolean } {
  if (error instanceof PostingError) {
    return { code: error.code, invariant: error.code === "ENTRY_NOT_BALANCED" };
  }
  return { code: "UNKNOWN", invariant: false };
}

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

@Injectable()
export class PostingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PARTNER_SUBLEDGER_PORT) private readonly subledger: PartnerSubledgerPort,
  ) {}

  /** SQL-backed read model bound to the ambient transaction. */
  readModel(): PostingReadModel {
    return {
      findEntryBySourceKey: async (sourceType, sourceId, operation) => {
        if (sourceId === null) return undefined;
        const row = await journal.findEntryBySourceKey(sourceType, sourceId, operation);
        return row === undefined
          ? undefined
          : { id: row.id, entryNo: row.entryNo, status: row.status as "POSTED" | "REVERSED" };
      },
      findPeriodForDate: async (entryDate) => {
        const period = await store.findPeriodForDate(entryDate);
        return period === undefined
          ? undefined
          : {
              id: period.id,
              status: period.status as "OPEN" | "SOFT_CLOSED" | "LOCKED",
              startDate: period.startDate,
              endDate: period.endDate,
            };
      },
      findPeriodById: async (periodId) => {
        const period = await store.findPeriodById(periodId);
        return period === undefined
          ? undefined
          : {
              id: period.id,
              status: period.status as "OPEN" | "SOFT_CLOSED" | "LOCKED",
              startDate: period.startDate,
              endDate: period.endDate,
            };
      },
      findAccount: async (accountId) => {
        const account = await store.findAccountById(accountId);
        return account === undefined
          ? undefined
          : {
              id: account.id,
              code: account.code,
              status: account.status as "ACTIVE" | "ARCHIVED",
              isPostable: account.isPostable,
              currencyCode: account.currencyCode,
            };
      },
      findActivePurposeAccount: async (purposeKey) => {
        const mapping = await store.findActivePurpose(purposeKey);
        return mapping === undefined ? undefined : { accountId: mapping.accountId };
      },
      findProject: async (projectId) => {
        // PHASE-019 §8: the projects dimension stamp target — mirrors
        // findActivePurposeAccount (the caller's open transaction).
        const project = await store.findProjectById(projectId);
        return project === undefined
          ? undefined
          : { id: project.id, status: project.status as "OPEN" | "CLOSED" };
      },
      findArApControlAccounts: async () => {
        const [arRow, apRow] = await Promise.all([
          store.findActivePurpose("AR_CONTROL"),
          store.findActivePurpose("AP_CONTROL"),
        ]);
        return {
          arControlAccountId: arRow?.accountId ?? "00000000-0000-0000-0000-000000000000",
          apControlAccountId: apRow?.accountId ?? "00000000-0000-0000-0000-000000000000",
        };
      },
      // PHASE-029 (BR-053): the six payroll purposes' actively-mapped
      // account ids — fetched ONLY for manual-journal sources (the engine
      // asks lazily; zero overhead on every module-source post).
      findPayrollPurposeAccounts: async () => {
        const keys = [
          "SALARIES_EXPENSE",
          "SALARIES_PAYABLE",
          "DEDUCTIONS_PAYABLE",
          "EMPLOYER_CONTRIBUTIONS",
          "EOS_PROVISION",
          "EOS_PROVISION_EXPENSE",
        ];
        const ids = new Set<string>();
        for (const key of keys) {
          const mapping = await store.findActivePurpose(key);
          if (mapping !== undefined) {
            ids.add(mapping.accountId);
          }
        }
        return ids;
      },
      baseCurrency: async () => ownTenantBaseCurrencyCached(),
    };
  }

  /**
   * Post a spec (validation 1–8 + the write phase). Idempotent (INV-013):
   * a stored entry for the same source key is returned as a replay —
   * sequential retries AND concurrent duplicates converge on one entry
   * (CC-01: the loser rolls back to the posting savepoint and replays).
   *
   * PHASE-025 T9c: the SLO counters wrap this method — every call is one
   * engine attempt (a replay counts as a SUCCESS: convergence, not
   * failure); the engine-path duration feeds erp_posting_duration_ms
   * (T-02 budget) and a thrown posting records erp_posting_failures_total
   * (+ erp_posting_invariant_failures_total + a fatal log line on the
   * ENTRY_NOT_BALANCED class — the SF-024-021 triage path).
   */
  async post(
    spec: JournalSpec,
    options: { postedBy: string | null; onPosted?: (entryId: string) => Promise<void> } = {
      postedBy: null,
    },
  ): Promise<PostingResult> {
    processMetrics.recordPostingAttempt();
    // Date.now() is integer-ms by definition: no float rounding involved.
    const startedAt = Date.now();
    try {
      const result = await this.postUnchecked(spec, options);
      processMetrics.recordPostingSuccess(Date.now() - startedAt);
      return result;
    } catch (error) {
      const failure = postingFailureClass(error);
      processMetrics.recordPostingFailure(failure.code, failure.invariant);
      if (failure.invariant) {
        log.fatal(
          {
            metric: "erp_posting_invariant_failures_total",
            code: failure.code,
            spec: { docType: spec.source.docType, docId: spec.source.docId, operation: spec.source.operation },
          },
          "POSTING INVARIANT FAILURE: the engine rejected an unbalanced entry (INV-001/002, RISK-009 — zero tolerance, auto-SEV-1) — investigate immediately",
        );
      }
      throw error;
    }
  }

  private async postUnchecked(
    spec: JournalSpec,
    options: { postedBy: string | null; onPosted?: (entryId: string) => Promise<void> },
  ): Promise<PostingResult> {
    const ctx = requireTenantContext();
    // Idempotent replay short-circuit (sequential path).
    if (spec.source.docId !== null) {
      const stored = await journal.findEntryBySourceKey(
        spec.source.docType,
        spec.source.docId,
        spec.source.operation,
      );
      if (stored !== undefined) {
        return {
          journalEntryId: stored.id,
          entryNo: stored.entryNo,
          idempotentReplay: true,
          status: stored.status as "POSTED" | "REVERSED",
        };
      }
    }
    let plan: Awaited<ReturnType<PostingEngine["post"]>>;
    try {
      plan = await ENGINE.post(spec, this.readModel());
    } catch (error) {
      // CC-01 concurrent-duplicate window (T-TESTS fix): a racer read the
      // source document as un-posted before the winner committed, so by the
      // engine's step-1 source-key check the winner's entry is already
      // visible (READ COMMITTED). The engine's documented contract (§2
      // step 1) is that PostService surfaces ALREADY_POSTED as the STORED
      // replay result — the writePlan unique-violation path below already
      // does the same for the in-flight interleaving; this closes the
      // post-commit interleaving so duplicate concurrent posts always
      // converge instead of throwing.
      if (
        error instanceof PostingError &&
        error.code === "ALREADY_POSTED" &&
        spec.source.docId !== null
      ) {
        const stored = await journal.findEntryBySourceKey(
          spec.source.docType,
          spec.source.docId,
          spec.source.operation,
        );
        if (stored !== undefined) {
          return {
            journalEntryId: stored.id,
            entryNo: stored.entryNo,
            idempotentReplay: true,
            status: stored.status as "POSTED" | "REVERSED",
          };
        }
      }
      throw error;
    }
    const { entry, replay } = await this.writePlan(ctx, plan, options);
    return {
      journalEntryId: entry.id,
      entryNo: entry.entryNo,
      idempotentReplay: replay,
      status: "POSTED",
    };
  }

  /** The write phase (validation step 8) inside a posting savepoint. */
  private async writePlan(
    ctx: TenantContext,
    plan: Awaited<ReturnType<PostingEngine["post"]>>,
    options: { postedBy: string | null; onPosted?: (entryId: string) => Promise<void> },
  ): Promise<{ entry: journal.JournalEntryRow; replay: boolean }> {
    const tx = ctx.tx;
    if (tx === undefined) {
      throw new Error("posting requires an ambient tenant transaction");
    }
    await tx.execute(sql`SAVEPOINT erp_posting`);
    try {
      const year = plan.spec.entryDate.slice(0, 4);
      const acquired = await store.acquireNumber({
        docType: "journal_entry",
        branchId: null,
        periodKey: year,
        format: "JE-{YYYY}-{SEQ:6}",
        prefix: "JE",
        year,
      });
      const entry = await journal.insertPostedEntry({
        plan,
        entryNo: acquired.number,
        postedBy: options.postedBy,
        reversalOfId: null,
      });
      await store.bindNumberAssignment("journal_entry", acquired.number, entry.id);
      // Module-owned subledger rows (INV-009): every AR/AP control line gets
      // its partner row in the SAME transaction via the partners port.
      const lines = await journal.listLines(entry.id);
      const effects: PartnerSubledgerEffect[] = [];
      for (const line of plan.lines) {
        if (!line.isArApControl || line.partnerId === undefined) continue;
        const row = lines.find((candidate) => candidate.lineNo === line.lineNo);
        if (row === undefined) continue;
        effects.push({
          partnerId: line.partnerId,
          journalEntryId: entry.id,
          journalLineId: row.id,
          entryDate: plan.spec.entryDate,
          direction: line.direction,
          amount: line.amount,
          baseAmount: line.baseAmount,
          currencyCode: plan.spec.currency,
          sourceType: plan.spec.source.docType,
          sourceId: plan.spec.source.docId,
          memo: plan.spec.description?.en ?? null,
        });
      }
      if (effects.length > 0) {
        await this.subledger.recordJournalEffects(effects);
      }
      await options.onPosted?.(entry.id);
      await this.audit.record({
        action: "accounting.journal_posted",
        entityType: "journal_entry",
        entityId: entry.id,
        actorId: options.postedBy ?? undefined,
        after: {
          entryNo: entry.entryNo,
          entryDate: entry.entryDate,
          source: plan.spec.source,
          currency: plan.spec.currency,
          rate: plan.exchangeRate,
          lines: plan.lines.length,
        },
      });
      // PHASE-013: ledger event for reporting cache invalidation
      // (in-process side channel — see ledger-events.ts; a rolled-back
      // outer transaction can only cause a harmless recompute).
      publishLedgerEvent({
        type: "journal.posted",
        tenantId: ctx.tenantId,
        entryId: entry.id,
      });
      await tx.execute(sql`RELEASE SAVEPOINT erp_posting`);
      return { entry, replay: false };
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT erp_posting`);
      if (isUniqueViolation(error) && plan.spec.source.docId !== null) {
        // CC-01 concurrent duplicate: the winner's entry is the truth.
        const stored = await journal.findEntryBySourceKey(
          plan.spec.source.docType,
          plan.spec.source.docId,
          plan.spec.source.operation,
        );
        if (stored !== undefined) {
          return { entry: stored, replay: true };
        }
      }
      throw error;
    }
  }

  /**
   * Reversal (INV-014): load the original (POSTED, not already reversed),
   * mirror accounts/partners/items/tax codes/amounts with flipped
   * directions, new entry date ≤ today in an open period, same-currency
   * rate = original rate, link reversal_of_id/reversed_by_id, mark the
   * original REVERSED — one transaction.
   *
   * PHASE-025 T9c: wrapped with the same SLO counters as post() — a
   * reversal is an engine attempt too (it runs the same validations +
   * write phase).
   */
  async reverse(
    input: ReversalInput,
    options: { reversedBy: string | null } = { reversedBy: null },
  ): Promise<PostingResult> {
    processMetrics.recordPostingAttempt();
    // Date.now() is integer-ms by definition: no float rounding involved.
    const startedAt = Date.now();
    try {
      const result = await this.reverseUnchecked(input, options);
      processMetrics.recordPostingSuccess(Date.now() - startedAt);
      return result;
    } catch (error) {
      const failure = postingFailureClass(error);
      processMetrics.recordPostingFailure(failure.code, failure.invariant);
      if (failure.invariant) {
        log.fatal(
          { metric: "erp_posting_invariant_failures_total", code: failure.code, originalEntryId: input.originalEntryId },
          "POSTING INVARIANT FAILURE: the engine rejected an unbalanced reversal (INV-001/002, RISK-009 — zero tolerance, auto-SEV-1) — investigate immediately",
        );
      }
      throw error;
    }
  }

  private async reverseUnchecked(
    input: ReversalInput,
    options: { reversedBy: string | null },
  ): Promise<PostingResult> {
    const ctx = requireTenantContext();
    const original = await journal.findEntryById(input.originalEntryId);
    if (original === undefined) {
      throw new PeriodNotFoundError(input.originalEntryId);
    }
    if (original.status === "REVERSED" || original.reversedById !== null) {
      throw alreadyReversed({ entryId: input.originalEntryId });
    }
    if (original.status !== "POSTED") {
      throw new JournalStateError("only POSTED entries can be reversed");
    }
    const today = new Date().toISOString().slice(0, 10);
    if (input.entryDate > today) {
      throw new JournalStateError("reversal entry date cannot be in the future");
    }
    const lines = await journal.listLines(original.id);
    const spec: JournalSpec = {
      source: {
        docType: original.sourceType,
        docId: original.sourceId,
        operation: "reverse",
      },
      entryDate: input.entryDate,
      // Same-date reversals stay in the original's period (the year-end
      // CLOSING window); other dates resolve by date as usual.
      fiscalPeriodId:
        input.entryDate === original.entryDate ? original.fiscalPeriodId : undefined,
      description: {
        en: `Reversal of ${original.entryNo ?? original.id}: ${input.reason}`,
        ar: `عكس القيد ${original.entryNo ?? original.id}: ${input.reason}`,
      },
      currency: original.currencyCode,
      exchangeRate: original.exchangeRate,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        direction: line.direction === "DEBIT" ? ("CREDIT" as const) : ("DEBIT" as const),
        amount: line.amount,
        partnerId: line.partnerId ?? undefined,
        itemId: line.itemId ?? undefined,
        costCenterId: line.costCenterId ?? undefined,
        taxCodeId: line.taxCodeId ?? undefined,
        memo: { en: line.memo, ar: line.memoAr },
      })),
    };
    const plan = await ENGINE.post(spec, this.readModel());
    const tx = ctx.tx;
    if (tx === undefined) {
      throw new Error("reversal requires an ambient tenant transaction");
    }
    await tx.execute(sql`SAVEPOINT erp_posting`);
    try {
      const year = input.entryDate.slice(0, 4);
      const acquired = await store.acquireNumber({
        docType: "journal_entry",
        branchId: null,
        periodKey: year,
        format: "JE-{YYYY}-{SEQ:6}",
        prefix: "JE",
        year,
      });
      const reversal = await journal.insertPostedEntry({
        plan,
        entryNo: acquired.number,
        postedBy: options.reversedBy,
        reversalOfId: original.id,
      });
      await store.bindNumberAssignment("journal_entry", acquired.number, reversal.id);
      // Sanctioned reversal link: original POSTED → REVERSED (the ONLY
      // sanctioned UPDATE on journal_entries; guard trigger polices shape).
      await journal.markEntryReversed(original.id, reversal.id);
      const reversalLines = await journal.listLines(reversal.id);
      const effects: PartnerSubledgerEffect[] = [];
      for (const row of reversalLines) {
        if (row.partnerId === null) continue;
        effects.push({
          partnerId: row.partnerId,
          journalEntryId: reversal.id,
          journalLineId: row.id,
          entryDate: input.entryDate,
          direction: row.direction === "DEBIT" ? "DEBIT" : "CREDIT",
          amount: row.amount,
          baseAmount: row.baseAmount,
          currencyCode: plan.spec.currency,
          sourceType: reversal.sourceType,
          sourceId: reversal.sourceId,
          memo: `reversal of ${original.entryNo ?? original.id}`,
        });
      }
      if (effects.length > 0) {
        await this.subledger.recordJournalEffects(effects);
      }
      await this.audit.record({
        action: "accounting.journal_reversed",
        entityType: "journal_entry",
        entityId: original.id,
        actorId: options.reversedBy ?? undefined,
        before: { status: "POSTED", entryNo: original.entryNo },
        after: { status: "REVERSED", reversedByEntryNo: reversal.entryNo, reason: input.reason },
      });
      await tx.execute(sql`RELEASE SAVEPOINT erp_posting`);
      return {
        journalEntryId: reversal.id,
        entryNo: reversal.entryNo,
        idempotentReplay: false,
        status: "POSTED",
      };
    } catch (error) {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT erp_posting`);
      if (isUniqueViolation(error) && spec.source.docId !== null) {
        const stored = await journal.findEntryBySourceKey(
          spec.source.docType,
          spec.source.docId,
          spec.source.operation,
        );
        if (stored !== undefined) {
          return {
            journalEntryId: stored.id,
            entryNo: stored.entryNo,
            idempotentReplay: true,
            status: stored.status as "POSTED" | "REVERSED",
          };
        }
      }
      throw error;
    }
  }

  /** Engine probe (POSTING_ENGINE §1) — open-period check without posting. */
  async isDatePostable(entryDate: string): Promise<boolean> {
    return ENGINE.isDatePostable(entryDate, this.readModel());
  }
}

/** Tenant base currency via the tenancy settings substrate (cached read). */
let baseCurrencyCache: { tenantId: string; value: string } | undefined;

async function ownTenantBaseCurrencyCached(): Promise<string> {
  const ctx = requireTenantContext();
  if (baseCurrencyCache?.tenantId === ctx.tenantId) {
    return baseCurrencyCache.value;
  }
  const { ownTenantBaseCurrency } = await import("../../../infra/settings/setting-reader");
  const value = await ownTenantBaseCurrency();
  baseCurrencyCache = { tenantId: ctx.tenantId, value };
  return value;
}
