import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  applyIssue,
  planIssue,
  resolveInventoryAccount,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import { batchOnHand } from "../../inventory/infrastructure/inventory.store";
import { findItemForInventory } from "../../inventory/infrastructure/inventory.store";
import { findInspectionById } from "../../manufacturing/infrastructure/manufacturing.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";

import * as store from "../infrastructure/quality.store";
import {
  NCR_SOURCES,
  nextNcrMove,
  ncrSourceShapeValid,
  scrapJournalScope,
  type NcrDisposition,
  type NcrSource,
} from "../domain/ncr-lifecycle";
import {
  NcrAffectedQtyAboveOnHandError,
  NcrDispositionRequiredError,
  NcrRecordNotFoundError,
  NcrStateError,
  QualityInputInvalidError,
  QualityInspectionNotFoundError,
} from "../domain/quality-errors";

/**
 * PHASE-050 (W-25 — T-06, 2026-11-23) THE NCR ENGINE (Q-01): the
 * non-conformance register's lifecycle (the sources INSPECTION/
 * PRODUCTION/COMPLAINT/SUPPLIER with the 0114 source-shape law; the
 * severity vocabulary; the affected-quantity floor) + BR-102's closure
 * gate at the service (the pure fold decides, the typed refusal names
 * the record — the DB floor stays the authority of last resort) +
 * G-62's SCRAP write-off (D-05):
 *
 *   THE POSTING: the SCRAP disposition of a BATCH-referencing NCR posts
 *   the inventory write-off through the REAL posting engine on the
 *   purpose-mapped pair — DR the purpose-mapped INVENTORY_SHRINKAGE (the
 *   existing marker, the 044 valuation-ledger precedent) · CR the
 *   PER-WAREHOUSE inventory accounts at the affected quantity's own
 *   value (the issue plans' own 4dp values, aggregated per account —
 *   the G-59 credit-side pattern) — fail-closed PURPOSE_NOT_MAPPED
 *   until the tenant maps (the G-61 law: the engine's own refusal
 *   through the `purpose:` line and resolveInventoryAccount's own
 *   throw), INV-013 idempotent with the single-use source key
 *   (ncr_record, disposition), and the write-off MOVES issue through
 *   the REAL WMS path (planIssue/applyIssue, the G-60 discipline —
 *   moveKind "adjust", sourced ncr_record, reason QUALITY_SCRAP) in
 *   the SAME ambient transaction (INV-018 — a failure anywhere rolls
 *   the journal, the moves and the stamp back to zero).
 *
 *   THE COVERAGE ORDER (the deterministic write-off fold): the batch's
 *   live on-hand per warehouse (the stock_moves ledger's own Σ IN − Σ
 *   OUT, grouped — the manufacturing store's qcBatchOnHand mirror
 *   precedent) covers the affected quantity warehouse-by-warehouse in
 *   warehouse_id ASC order; the affected-quantity floor refuses when
 *   the batch's TOTAL on-hand is short (the typed refusal names BOTH
 *   figures — the live stock read, never a DB constraint).
 *
 *   THE HONEST SHAPES (D-05's recorded law + the declared W-25
 *   interpretation, the wave README's table): REWORK/ACCEPT/
 *   RETURN_TO_SUPPLIER carry NO GL entry in every case; a batch-less
 *   SCRAP stamps the disposition with NO journal (the 0114 gate's own
 *   NULL allowance — the record never named stock under a batch); a
 *   QUARANTINED batch's scrap is refused by the inventory floor itself
 *   (BATCH_QUARANTINED — the 018 sole-caller law; the QC surface owns
 *   that bypass); a serial-tracked item's write-off is refused by
 *   BR-018's serial binding (the serial ledger's own Q-board
 *   dispositions own serial-level scraps).
 */

/** Official NCR numbers (INV-021/ADR-0006; the treasury {PREFIX}-{YYYY}-
 * {SEQ:6} convention, the MO- precedent). */
export const NCR_NUMBER_FORMAT = {
  prefix: "NCR",
  format: "NCR-{YYYY}-{SEQ:6}",
  docType: "ncr_record",
} as const;

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new QualityInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface CreateNcrInput {
  source: NcrSource;
  severity?: string;
  itemId: string;
  batchId?: string | null;
  inspectionId?: string | null;
  partnerId?: string | null;
  problem: string;
  problemAr?: string | null;
  affectedQty: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

/** The disposition act's own result — the record, the journal link (the
 * SCRAP write-off's entry when it posted), and the write-off's own
 * figures (the moves' per-warehouse quantities and values, the
 * engine's OWN numbers verbatim — zero client arithmetic). */
export interface NcrDispositionResult {
  ncr: store.NcrRow;
  journalEntryId: string | null;
  writeOff: {
    totalValue: string;
    perWarehouse: { warehouseId: string; qty: string; valueAmount: string }[];
  } | null;
}

@Injectable()
export class NcrService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  async create(input: CreateNcrInput): Promise<store.NcrRow> {
    requireUuid(input.itemId, "itemId");
    if (input.problem.trim().length === 0 || input.problem.length > 2000) {
      throw new QualityInputInvalidError({
        field: "problem",
        reason: "the problem description is required (1…2000 chars)",
      });
    }
    const severity = input.severity ?? "MEDIUM";
    if (!(SEVERITIES as readonly string[]).includes(severity)) {
      throw new QualityInputInvalidError({
        field: "severity",
        reason: `severity must be one of ${SEVERITIES.join("/")}: ${severity}`,
      });
    }
    if (!(NCR_SOURCES as readonly string[]).includes(input.source)) {
      throw new QualityInputInvalidError({
        field: "source",
        reason: `source must be one of ${NCR_SOURCES.join("/")}: ${input.source}`,
      });
    }
    // THE AFFECTED-QUANTITY FLOOR (> 0 — the 0114 CHECK; the ≤-on-hand
    // floor is the live read below and again at the disposition act).
    const affectedQty = new Decimal(input.affectedQty);
    if (affectedQty.lessThanOrEqualTo(0)) {
      throw new QualityInputInvalidError({
        field: "affectedQty",
        reason: "the affected quantity must be positive",
      });
    }
    // THE SOURCE-SHAPE LAW (the 0114 CHECK at the service floor — the
    // typed refusal names the missing shape, never a raw 23514).
    if (
      !ncrSourceShapeValid({
        source: input.source,
        hasInspection: (input.inspectionId ?? null) !== null,
        hasPartner: (input.partnerId ?? null) !== null,
      })
    ) {
      throw new QualityInputInvalidError({
        field: "source",
        reason: `a ${input.source}-sourced NCR carries its ${
          input.source === "INSPECTION" ? "inspection row" : "partner row"
        } (the 0114 source-shape law)`,
      });
    }
    // THE MAPPING CONTRACT'S OWN BINDING: an INSPECTION-sourced NCR binds
    // to the inspections module's OWN row (findInspectionById — the
    // composite FK's service face, zero parallel computation).
    if (input.inspectionId !== undefined && input.inspectionId !== null) {
      requireUuid(input.inspectionId, "inspectionId");
      const inspection = await findInspectionById(input.inspectionId);
      if (inspection === undefined) {
        throw new QualityInspectionNotFoundError({ inspectionId: input.inspectionId });
      }
    }
    const item = await findItemForInventory(input.itemId);
    if (item === undefined) {
      throw new QualityInputInvalidError({
        field: "itemId",
        reason: `item ${input.itemId} does not exist in this tenant`,
      });
    }
    // G-62's live floor at create (D-05: the affected quantity is capped
    // by the batch's own on-hand — re-read again at the disposition act).
    const batchId = input.batchId ?? null;
    if (batchId !== null) {
      requireUuid(batchId, "batchId");
      const onHand = await batchOnHand(batchId);
      if (affectedQty.greaterThan(new Decimal(onHand))) {
        throw new NcrAffectedQtyAboveOnHandError({
          batchId,
          affectedQty: input.affectedQty,
          onHand,
        });
      }
    }

    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: NCR_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: NCR_NUMBER_FORMAT.format,
      prefix: NCR_NUMBER_FORMAT.prefix,
      year,
    });
    const row = await store.insertNcr({
      ncrNo: acquired.number,
      source: input.source,
      severity,
      itemId: input.itemId,
      batchId,
      inspectionId: input.inspectionId ?? null,
      partnerId: input.partnerId ?? null,
      problem: input.problem,
      problemAr: input.problemAr ?? null,
      affectedQty: input.affectedQty,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.numbering.bind(NCR_NUMBER_FORMAT.docType, acquired.number, row.id);
    await this.audit.record({
      action: "quality.ncr_created",
      entityType: "ncr_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { ncrNo: row.ncrNo, source: row.source, severity: row.severity, affectedQty: row.affectedQty },
    });
    return row;
  }

  async find(id: string): Promise<store.NcrRow> {
    requireUuid(id, "id");
    const row = await store.findNcrById(id);
    if (row === undefined) throw new NcrRecordNotFoundError({ ncrId: id });
    return row;
  }

  async list(filter: {
    status?: string;
    itemId?: string;
    batchId?: string;
    source?: string;
    limit?: number;
  }): Promise<store.NcrRow[]> {
    return store.listNcrs({
      status: filter.status,
      itemId: filter.itemId,
      batchId: filter.batchId,
      source: filter.source,
      limit: filter.limit ?? 200,
    });
  }

  /**
   * THE DISPOSITION ACT (BR-102's ladder step + G-62's posting) — ONE
   * ambient transaction, all-or-nothing: the write-off plans (no
   * writes) → the accounts resolved (fail-closed) → the posting (INV-013
   * single-use) → the moves applied → the disposition stamp CAS. A
   * failure anywhere rolls EVERYTHING back (zero journal rows, zero
   * moves, the record stays OPEN).
   */
  async disposition(
    ncrId: string,
    input: { disposition: NcrDisposition; actorId: string | null },
  ): Promise<NcrDispositionResult> {
    requireUuid(ncrId, "id");
    const row = await store.findNcrById(ncrId);
    if (row === undefined) throw new NcrRecordNotFoundError({ ncrId });
    const verdict = nextNcrMove(row.status as "OPEN" | "DISPOSITIONED" | "CLOSED", "disposition");
    if (!verdict.allowed) {
      throw new NcrStateError({
        ncrId: row.id,
        ncrNo: row.ncrNo,
        from: row.status,
        to: "DISPOSITIONED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }

    const scope = scrapJournalScope({
      disposition: input.disposition,
      hasBatch: row.batchId !== null,
    });
    const today = todayIso();

    let journalEntryId: string | null = null;
    let writeOff: NcrDispositionResult["writeOff"] = null;

    if (scope === "POSTS_WRITE_OFF") {
      // ── G-62's write-off (D-05) ────────────────────────────────────────
      // The live floor re-read at the act (the stock may have moved since
      // the create — the refusal names BOTH figures).
      const shares = await store.batchOnHandByWarehouse(row.batchId!);
      const totalOnHand = shares.reduce(
        (sum, share) => sum.plus(new Decimal(share.onHand)),
        new Decimal(0),
      );
      if (new Decimal(row.affectedQty).greaterThan(totalOnHand)) {
        throw new NcrAffectedQtyAboveOnHandError({
          batchId: row.batchId!,
          affectedQty: row.affectedQty,
          onHand: totalOnHand.toFixed(6),
        });
      }
      // The deterministic coverage: warehouse_id ASC (the store read's
      // own order), each share capped by the warehouse-local on-hand —
      // planIssue re-asserts its own floor against the same ledger.
      const perWarehouse: { warehouseId: string; qty: string; valueAmount: string }[] = [];
      const plans: { plan: IssuePlan; warehouseId: string; qty: string }[] = [];
      const accountTotals = new Map<string, Decimal>();
      let remaining = new Decimal(row.affectedQty);
      for (const share of shares) {
        if (remaining.lessThanOrEqualTo(0)) break;
        const take = Decimal.min(remaining, new Decimal(share.onHand));
        if (take.lessThanOrEqualTo(0)) continue;
        const qty = take.toFixed(6);
        const plan = await planIssue({
          itemId: row.itemId,
          warehouseId: share.warehouseId,
          qty,
          movedAt: today,
          moveKind: "adjust",
          sourceType: "ncr_record",
          sourceId: row.id,
          reason: "QUALITY_SCRAP",
          batchId: row.batchId,
          // PHASE-050 (W-28 — INV-035/BR-101, D-07): the G-62 write-off is
          // the SOLE held-batch bypass — the SCRAP write-off lands AT the
          // disposition act, while the investigating hold may still be
          // ACTIVE (the hold's release comes after, justified by this very
          // disposition — BR-101's own ordering).
          allowHeldBatch: true,
          memo: `NCR ${row.ncrNo} — quality scrap write-off (G-62)`,
          memoAr: `سجل عدم مطابقة ${row.ncrNo} — إعدام الجودة G-62`,
        });
        const account = await resolveInventoryAccount(share.warehouseId);
        accountTotals.set(
          account,
          (accountTotals.get(account) ?? new Decimal(0)).plus(new Decimal(plan.valueAmount)),
        );
        plans.push({ plan, warehouseId: share.warehouseId, qty });
        remaining = remaining.minus(take);
      }
      if (!remaining.isZero()) {
        // Unreachable past the floor (the total covered the qty by the
        // read's own HAVING clause) — the honest belt-and-suspenders.
        throw new NcrAffectedQtyAboveOnHandError({
          batchId: row.batchId!,
          affectedQty: row.affectedQty,
          onHand: totalOnHand.toFixed(6),
        });
      }
      // THE G-62 ENTRY: DR the purpose-mapped INVENTORY_SHRINKAGE · CR the
      // per-warehouse inventory accounts (aggregated per account, the
      // G-59 credit-side pattern; the account order deterministic).
      const totalValue = [...accountTotals.values()].reduce(
        (sum, value) => sum.plus(value),
        new Decimal(0),
      );
      const lines: JournalLineSpec[] = [
        {
          purpose: "INVENTORY_SHRINKAGE",
          direction: "DEBIT",
          amount: totalValue.toFixed(4),
          memo: {
            en: `NCR ${row.ncrNo} — quality scrap write-off (G-62)`,
            ar: `سجل عدم مطابقة ${row.ncrNo} — إعدام الجودة G-62`,
          },
        },
      ];
      for (const [accountId, amount] of [...accountTotals.entries()].sort(([a], [b]) =>
        a < b ? -1 : 1,
      )) {
        lines.push({
          accountId,
          direction: "CREDIT",
          amount: amount.toFixed(4),
          memo: {
            en: `NCR ${row.ncrNo} — inventory written off at the affected quantity's own value (G-62)`,
            ar: `سجل عدم مطابقة ${row.ncrNo} — إعدام المخزون بقيمة الكمية المتأثرة G-62`,
          },
        });
      }
      const spec: JournalSpec = {
        source: { docType: "ncr_record", docId: row.id, operation: "disposition" },
        entryDate: today,
        description: {
          en: `NCR ${row.ncrNo} — G-62 scrap write-off`,
          ar: `سجل عدم مطابقة ${row.ncrNo} — إعدام G-62`,
        },
        currency: await ownTenantBaseCurrency(),
        lines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
      for (const { plan } of plans) {
        await applyIssue(plan, posted.journalEntryId);
      }
      for (const { plan, warehouseId, qty } of plans) {
        perWarehouse.push({ warehouseId, qty, valueAmount: plan.valueAmount });
      }
      writeOff = {
        totalValue: totalValue.toFixed(4),
        perWarehouse: perWarehouse,
      };
    }

    // THE DISPOSITION STAMP (the single-use CAS — the 0114 journal gate
    // satisfied by the same statement: the pair and the journal link
    // land together).
    const stamped = await store.stampNcrDisposition({
      id: row.id,
      disposition: input.disposition,
      dispositionAt: nowIso(),
      journalEntryId,
      actorId: input.actorId,
    });
    if (stamped === undefined) {
      // The raced/stale move — re-read and refuse with the record's own
      // state (the ambient transaction rolls the posting back with it —
      // zero residue, INV-018).
      const current = await store.findNcrById(ncrId);
      throw new NcrStateError({
        ncrId,
        ncrNo: current?.ncrNo ?? row.ncrNo,
        from: current?.status ?? "UNKNOWN",
        to: "DISPOSITIONED",
        reason: "the record moved under the act — the disposition stamp is single-use",
      });
    }
    await this.audit.record({
      action: "quality.ncr_dispositioned",
      entityType: "ncr_record",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      before: { status: row.status },
      after: {
        status: stamped.status,
        disposition: stamped.disposition,
        journalEntryId: stamped.journalEntryId,
        writeOffValue: writeOff?.totalValue ?? null,
      },
    });
    return { ncr: stamped, journalEntryId, writeOff };
  }

  /**
   * THE CLOSE ACT (BR-102's own gate): no NCR closes without a
   * disposition — the typed refusal NAMES the record (its number, its
   * state, the law).
   */
  async close(ncrId: string, actorId: string | null): Promise<store.NcrRow> {
    requireUuid(ncrId, "id");
    const row = await store.findNcrById(ncrId);
    if (row === undefined) throw new NcrRecordNotFoundError({ ncrId });
    const verdict = nextNcrMove(row.status as "OPEN" | "DISPOSITIONED" | "CLOSED", "close");
    if (!verdict.allowed) {
      if (verdict.refusal === "DISPOSITION_REQUIRED") {
        throw new NcrDispositionRequiredError({
          ncrId: row.id,
          ncrNo: row.ncrNo,
          status: row.status,
        });
      }
      throw new NcrStateError({
        ncrId: row.id,
        ncrNo: row.ncrNo,
        from: row.status,
        to: "CLOSED",
        reason: verdict.reason ?? "the move is illegal",
      });
    }
    const stamped = await store.stampNcrClosed({ id: row.id, closedAt: nowIso(), actorId });
    if (stamped === undefined) {
      const current = await store.findNcrById(ncrId);
      throw new NcrStateError({
        ncrId,
        ncrNo: current?.ncrNo ?? row.ncrNo,
        from: current?.status ?? "UNKNOWN",
        to: "CLOSED",
        reason: "the record moved under the act",
      });
    }
    await this.audit.record({
      action: "quality.ncr_closed",
      entityType: "ncr_record",
      entityId: row.id,
      actorId: actorId ?? undefined,
      before: { status: row.status },
      after: { status: stamped.status, closedAt: stamped.closedAt },
    });
    return stamped;
  }
}
