import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/accounting.store";
import * as journal from "../infrastructure/journal.store";
import { PostingService } from "./posting-service";
import type { JournalSpec, JournalLineSpec } from "../domain/posting-engine/journal-spec";
import { OpeningBalanceNotPostableError } from "../domain/accounting-errors";
import { absExact, addExact, subExact } from "./decimal-strings";
import * as partnersStore from "../../partners/infrastructure/partners.store";

/**
 * Opening-balances posting service (PHASE-007 T14; BR-035; G-16): posts the
 * PHASE-006 `opening_balance_docs` DRAFTs ONCE through the OPENING period —
 * partner kinds create per-partner AR/AP control lines (subledger rows via
 * the posting transaction — INV-009 exact from entry #1), account kinds post
 * their declared balances, and the balancing line lands on OPENING_EQUITY.
 * STOCK drafts remain DRAFT (they post with the stock ledger in PHASE-010).
 * Corrections afterwards are normal journals in open periods (BR-035 fixed).
 */

interface OpeningDocRow {
  id: string;
  kind: "PARTNER" | "ACCOUNT" | "STOCK";
  partnerId: string | null;
  accountId: string | null;
  itemId: string | null;
  amount: string | null;
  qty: string | null;
  unitCost: string | null;
  currencyCode: string;
  status: string;
}

@Injectable()
export class OpeningBalancesPostingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async listDrafts(kind?: string): Promise<OpeningDocRow[]> {
    const rows = await listOpeningDocs(kind);
    return rows;
  }

  /**
   * Post once per fiscal year (INV-013 key: opening_balances/{yearId}:post).
   * All PARTNER/ACCOUNT docs of the tenant post as ONE entry; the entry
   * date is the year's OPENING period date.
   */
  async post(
    actorId: string,
    fiscalYearId: string,
  ): Promise<{ journalEntryId: string; entryNo: string | null; skippedStockDrafts: number }> {
    // INV-013 replay first: a stored opening entry for this year returns
    // the original result (BR-035 once-only) — before any doc-state check.
    const stored = await journal.findEntryBySourceKey("opening_balances", fiscalYearId, "post");
    if (stored !== undefined) {
      return {
        journalEntryId: stored.id,
        entryNo: stored.entryNo,
        skippedStockDrafts: 0,
      };
    }
    const base = await ownTenantBaseCurrency();
    const year = await store.findFiscalYearById(fiscalYearId);
    if (year === undefined) {
      throw new OpeningBalanceNotPostableError(`fiscal year ${fiscalYearId} does not exist`);
    }
    const periods = await store.listPeriods(fiscalYearId);
    const opening = periods.find((period) => period.kind === "OPENING");
    if (opening === undefined) {
      throw new OpeningBalanceNotPostableError(`fiscal year ${year.name} has no OPENING period`);
    }
    const docs = await listOpeningDocs();
    const partnerDocs = docs.filter((doc) => doc.kind === "PARTNER" && doc.status === "DRAFT");
    const accountDocs = docs.filter((doc) => doc.kind === "ACCOUNT" && doc.status === "DRAFT");
    const stockDocs = docs.filter((doc) => doc.kind === "STOCK" && doc.status === "DRAFT");
    if (partnerDocs.length === 0 && accountDocs.length === 0) {
      throw new OpeningBalanceNotPostableError(
        "no DRAFT partner/account opening balances to post (stock drafts post in PHASE-010)",
      );
    }
    for (const doc of [...partnerDocs, ...accountDocs]) {
      if (doc.currencyCode !== base) {
        throw new OpeningBalanceNotPostableError(
          `opening balance ${doc.id} is in ${doc.currencyCode}; only the base currency ${base} is postable at this phase`,
        );
      }
    }
    const lines: JournalLineSpec[] = [];
    const postedDocIds: string[] = [];
    // Partner kinds: per-partner AR/AP control lines (G-16).
    for (const doc of partnerDocs) {
      const partner = await partnersStore.findPartnerById(doc.partnerId!);
      if (partner === undefined) {
        throw new OpeningBalanceNotPostableError(`partner ${doc.partnerId} no longer exists`);
      }
      const amount = doc.amount!;
      const isCustomer = Number(amount) > 0;
      const purpose = isCustomer ? "AR_CONTROL" : "AP_CONTROL";
      lines.push({
        purpose,
        direction: isCustomer ? "DEBIT" : "CREDIT",
        amount: absExact(amount),
        partnerId: doc.partnerId ?? undefined,
        memo: { en: `Opening balance — ${partner.code}`, ar: `رصيد افتتاحي — ${partner.code}` },
      });
      postedDocIds.push(doc.id);
    }
    // Account kinds: declared balances at the declared account.
    for (const doc of accountDocs) {
      const amount = doc.amount!;
      lines.push({
        accountId: doc.accountId!,
        direction: Number(amount) > 0 ? "DEBIT" : "CREDIT",
        amount: absExact(amount),
        memo: { en: "Opening balance", ar: "رصيد افتتاحي" },
      });
      postedDocIds.push(doc.id);
    }
    // Balancing via OPENING_EQUITY (G-16 shape): one line for the residual.
    let debit = "0";
    let credit = "0";
    for (const line of lines) {
      if (line.direction === "DEBIT") debit = addExact(debit, line.amount);
      else credit = addExact(credit, line.amount);
    }
    const difference = subExact(debit, credit);
    if (difference !== "0") {
      lines.push({
        purpose: "OPENING_EQUITY",
        direction: Number(difference) > 0 ? "CREDIT" : "DEBIT",
        amount: absExact(difference),
        memo: { en: "Opening balances balancing", ar: "تسوية الأرصدة الافتتاحية" },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "opening_balances", docId: fiscalYearId, operation: "post" },
      entryDate: opening.startDate,
      fiscalPeriodId: opening.id,
      description: { en: `Opening balances ${year.name}`, ar: `الأرصدة الافتتاحية ${year.name}` },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, {
      postedBy: actorId,
      onPosted: async (entryId) => {
        await journal.markOpeningDocsPosted({ docIds: postedDocIds, journalEntryId: entryId });
      },
    });
    await this.audit.record({
      action: "accounting.opening_balances_posted",
      entityType: "fiscal_year",
      entityId: fiscalYearId,
      actorId,
      after: {
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        partnerDocs: partnerDocs.length,
        accountDocs: accountDocs.length,
        stockDraftsRemaining: stockDocs.length,
      },
    });
    return {
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      skippedStockDrafts: stockDocs.length,
    };
  }
}

async function listOpeningDocs(kind?: string): Promise<OpeningDocRow[]> {
  const { listOpeningBalanceDocsForPosting } = await import(
    "../../partners/infrastructure/partners.store"
  );
  return listOpeningBalanceDocsForPosting(kind);
}


