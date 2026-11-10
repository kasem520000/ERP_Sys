import { Injectable } from "@nestjs/common";

import * as store from "../infrastructure/accounting.store";
import * as journal from "../infrastructure/journal.store";
import { addExact } from "./decimal-strings";
import { GlAccountNotFoundError } from "../domain/accounting-errors";

/**
 * GL query services (PHASE-007 T12; REPORT_CATALOG `accounting.journal-register`):
 * account balances + period movements, the journal-register data feed
 * (statement RENDERING arrives PHASE-013 — this is the engine-data side),
 * and the line-level drill-down account → entries → source document
 * (INV-006's `source` chain, both directions).
 */

const DEFAULT_LIMIT = 100;

@Injectable()
export class GlQueries {
  /** Account balances over a window (trial-balance shape, base currency).
   * PHASE-019 (§8): an optional projectId slices the window to one
   * project's lines (project-filtered totals equal the unfiltered slice
   * sums by construction). */
  async accountBalances(filter: { fromDate?: string; toDate?: string; projectId?: string } = {}) {
    return journal.trialBalances(filter);
  }

  /** Period movements of one account (the GL browser's line feed).
   * PHASE-019 (§8): an optional projectId restricts the feed to that
   * project's lines (the running balance accumulates over the slice). */
  async accountMovements(input: {
    accountId: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    projectId?: string;
  }) {
    const account = await store.findAccountById(input.accountId);
    if (account === undefined) throw new GlAccountNotFoundError(input.accountId);
    const movements = await journal.accountMovements({
      accountId: input.accountId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      limit: input.limit ?? DEFAULT_LIMIT,
      projectId: input.projectId,
    });
    // Running balance (base) — chronological accumulation.
    let running = "0";
    const withBalance = movements.map((movement) => {
      const signed =
        movement.direction === "DEBIT" ? movement.baseAmount : `-${movement.baseAmount}`;
      running = addExact(running, signed);
      return { ...movement, balanceAfter: running };
    });
    return {
      account,
      movements: withBalance,
      openingBalance: "0", // full-history from entry #1 at this phase
    };
  }

  /** The journal register data feed (filters mirror the GL report params).
   * PHASE-019 (§8): an optional projectId keeps only entries carrying
   * that project's lines, with totals summed over those lines alone. */
  async journalRegister(filter: {
    fromDate?: string;
    toDate?: string;
    sourceType?: string;
    limit?: number;
    projectId?: string;
  } = {}) {
    return journal.journalRegister({ ...filter, limit: filter.limit ?? DEFAULT_LIMIT });
  }

  /**
   * Drill-down (INV-006): entry + lines + the source-document reference
   * both directions — the entry carries source_type/source_id, and the
   * source (manual journal draft, opening docs, year) links back via
   * posted_journal_id.
   */
  async entryDetail(entryId: string) {
    const entry = await journal.findEntryById(entryId);
    if (entry === undefined) {
      throw new GlAccountNotFoundError(entryId);
    }
    const lines = await journal.listLines(entry.id);
    const source = await resolveSource(entry.sourceType, entry.sourceId);
    return { entry, lines, source };
  }

  /** EXPLAIN evidence for the acceptance criteria's index-driven checks. */
  async explainMovements(accountId: string): Promise<string> {
    return journal.explainAccountMovements(accountId);
  }
}

async function resolveSource(
  sourceType: string,
  sourceId: string | null,
): Promise<{ type: string; id: string | null; resolvable: boolean; summary: string | null }> {
  if (sourceId === null) {
    return { type: sourceType, id: null, resolvable: false, summary: null };
  }
  if (sourceType === "journal_entry") {
    const draft = await journal.findManualJournalById(sourceId);
    if (draft !== undefined) {
      return {
        type: sourceType,
        id: sourceId,
        resolvable: true,
        summary: draft.description ?? draft.descriptionAr ?? "manual journal",
      };
    }
  }
  if (sourceType === "opening_balances") {
    return {
      type: sourceType,
      id: sourceId,
      resolvable: true,
      summary: "opening balances entry",
    };
  }
  if (sourceType === "year_end_close") {
    return { type: sourceType, id: sourceId, resolvable: true, summary: "year-end closing entry" };
  }
  return { type: sourceType, id: sourceId, resolvable: false, summary: null };
}

