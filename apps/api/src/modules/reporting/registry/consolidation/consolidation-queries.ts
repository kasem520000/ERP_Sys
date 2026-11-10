import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import { addExact, compareExact, subExact } from "../../../accounting/application/decimal-strings";
import { RunNotCompleteError } from "../../../consolidation/domain/consolidation-errors";
import {
  findGroupById,
  findLatestCompletedRun,
  findOwnerPeriod,
  listEliminations,
} from "../../../consolidation/infrastructure/consolidation.store";
import type { ConsolidationSnapshot } from "../../../consolidation/application/snapshot";
import { assertInv026, assertTrialBalanceBalanced } from "../../../consolidation/application/consolidation-math";

/**
 * PHASE-034 T8 · the consolidation report queries (REPORT_CATALOG §10 rows
 * — the queries behind `consolidation.consolidated-tb/is/bs` and
 * `consolidation.eliminations-log`): reporting-facing, read-only, executed
 * inside the ambient OWNER tenant transaction (ADR-0011 — deterministic
 * functions of POSTED data: the posted member books were frozen into the
 * run snapshot; statements read SNAPSHOTS, never live member books —
 * O(1) renders, ADR-0018 "No RLS changes" consequences).
 *
 * ── INV-026 (the headline assertion every consolidated statement carries)
 *
 * consolidated = Σ member statements (group currency, dated FX) −
 * eliminations, checked LINE-BY-LINE against the run snapshot at render
 * time (a tampered snapshot value or an unbalanced elimination ⇒
 * ASSERTION_FAILED + block-export; the statement flags, never drifts
 * silently). The eliminations-log ties to the parent's elimination
 * journals (the G-32 chain, INV-006).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("consolidation report query requires an ambient tenant scope");
  }
  return context.tx;
}

void sql;

/** One consolidated statement row (the account-level line). */
export interface ConsolidatedStatementRow {
  accountCode: string;
  accountType: string;
  purposeKey: string | null;
  debit: string;
  credit: string;
  /** The net (debit − credit) — the TB presentation column. */
  net: string;
}

/** Resolve the snapshot for (group, period) + its INV-026 render check. */
export interface ConsolidatedStatementSource {
  runId: string;
  groupId: string;
  groupName: string;
  groupNameAr: string;
  baseCurrency: string;
  fxTranslationMethod: string;
  periodEndDate: string;
  memberCount: number;
  eliminationLineCount: number;
  rows: ConsolidatedStatementRow[];
  inv026: {
    status: "PASS" | "FAIL";
    compared: { left: string; right: string };
    brokenLines: string[];
  };
  tbBalance: { status: "PASS" | "FAIL"; debit: string; credit: string };
  snapshot: ConsolidationSnapshot;
}

export class ConsolidationQueriesService {
  /** The statement substrate: the LATEST COMPLETED snapshot + the render
   * time INV-026 + TB-balance recomputation (seeded drift surfaces HERE). */
  async statementSource(input: {
    groupId: string;
    fiscalPeriodId: string;
    statement: "TB" | "IS" | "BS";
  }): Promise<ConsolidatedStatementSource> {
    const group = await findGroupById(input.groupId);
    if (group === undefined) {
      throw new RunNotCompleteError({ runId: "(group)", status: "GROUP_NOT_FOUND" });
    }
    const period = await findOwnerPeriod(input.fiscalPeriodId);
    if (period === undefined) {
      throw new RunNotCompleteError({ runId: "(period)", status: "PERIOD_NOT_FOUND" });
    }
    const run = await findLatestCompletedRun(input.groupId, input.fiscalPeriodId);
    if (run === undefined) {
      throw new RunNotCompleteError({ runId: "(none)", status: "NO_COMPLETED_RUN" });
    }
    const snapshot = run.snapshot as ConsolidationSnapshot;

    // The render-time INV-026 line-by-line re-check (seeded drift ⇒ FAIL).
    const inv026 = assertInv026({
      runId: run.id,
      consolidated: snapshot.consolidated,
      members: snapshot.memberExtracts,
      eliminations: snapshot.eliminations,
    });
    const tbBalance = assertTrialBalanceBalanced(snapshot.consolidated);

    // The statement slice: TB = every account; IS = REVENUE/EXPENSE; BS =
    // ASSET/LIABILITY/EQUITY (FINANCIAL_REPORT_RULES derivation shapes).
    const rows: ConsolidatedStatementRow[] = snapshot.consolidated
      .filter((line) => {
        if (input.statement === "TB") return true;
        const type = line.accountType.toUpperCase();
        if (input.statement === "IS") return type === "REVENUE" || type === "EXPENSE";
        return type === "ASSET" || type === "LIABILITY" || type === "EQUITY";
      })
      .map((line) => ({
        accountCode: line.accountCode,
        accountType: line.accountType,
        purposeKey: line.purposeKey,
        debit: line.amounts.debit,
        credit: line.amounts.credit,
        net: subExact(line.amounts.debit, line.amounts.credit),
      }));

    return {
      runId: run.id,
      groupId: group.id,
      groupName: group.name,
      groupNameAr: group.nameAr,
      baseCurrency: group.baseCurrency,
      fxTranslationMethod: group.fxTranslationMethod,
      periodEndDate: period.endDate,
      memberCount: snapshot.members.length,
      eliminationLineCount: snapshot.eliminations.length,
      rows,
      inv026: {
        status: inv026.status,
        compared: inv026.compared,
        brokenLines: inv026.brokenLines,
      },
      tbBalance,
      snapshot,
    };
  }

  /** The eliminations-log rows: the parent's elimination documents (DRAFT +
   * POSTED — the log shows the full audit trail incl. reversals) with the
   * journal-chain provenance. */
  async eliminationsLog(input: {
    groupId: string;
    fiscalPeriodId: string;
  }): Promise<
    {
      eliminationId: string;
      eliminationNo: string | null;
      kind: string;
      description: string;
      status: string;
      reversalOf: string | null;
      journalEntryIds: string[];
      debitTotal: string;
      creditTotal: string;
      createdAt: string;
      postedAt: string | null;
    }[]
  > {
    const rows = await listEliminations({
      groupId: input.groupId,
      fiscalPeriodId: input.fiscalPeriodId,
    });
    return rows.map((row) => {
      const lines = Array.isArray(row.lines) ? (row.lines as unknown[]) : [];
      let debit = "0.0000";
      let credit = "0.0000";
      for (const raw of lines) {
        if (raw === null || typeof raw !== "object") continue;
        const line = raw as { direction?: unknown; amount?: unknown };
        if (line.direction !== "DEBIT" && line.direction !== "CREDIT") continue;
        if (typeof line.amount !== "string") continue;
        if (line.direction === "DEBIT") {
          debit = addExact(debit, line.amount);
        } else {
          credit = addExact(credit, line.amount);
        }
      }
      const journalIds = Array.isArray(row.journalEntryIds)
        ? (row.journalEntryIds as unknown[]).filter(
            (id): id is string => typeof id === "string",
          )
        : [];
      return {
        eliminationId: row.id,
        eliminationNo: row.eliminationNo,
        kind: row.kind,
        description: row.description,
        status: row.status,
        reversalOf: row.reversalOf,
        journalEntryIds: journalIds,
        debitTotal: debit,
        creditTotal: credit,
        createdAt: row.createdAt,
        postedAt: row.postedAt,
      };
    });
  }

  /** The eliminations-log ↔ journal tie: every POSTED elimination carries ≥1
   * journal entry id (INV-006 chain) and the log's DR == CR per document
   * (the G-32 balanced shape). */
  async eliminationsTie(input: {
    groupId: string;
    fiscalPeriodId: string;
  }): Promise<{
    journalChainBroken: string[];
    unbalanced: string[];
    postedCount: number;
  }> {
    const rows = await this.eliminationsLog(input);
    const journalChainBroken: string[] = [];
    const unbalanced: string[] = [];
    let postedCount = 0;
    for (const row of rows) {
      if (row.status !== "POSTED") continue;
      postedCount += 1;
      if (row.journalEntryIds.length === 0) {
        journalChainBroken.push(row.eliminationNo ?? row.eliminationId);
      }
      if (compareExact(row.debitTotal, row.creditTotal) !== 0) {
        unbalanced.push(row.eliminationNo ?? row.eliminationId);
      }
    }
    return { journalChainBroken, unbalanced, postedCount };
  }
}
