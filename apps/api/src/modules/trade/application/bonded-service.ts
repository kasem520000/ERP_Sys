import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { RevaluationService } from "../../inventory/application/revaluation-service";
import {
  applyIssue,
  applyReceipt,
  planIssue,
  planReceipt,
  resolveInventoryAccount,
} from "../../inventory/application/movement-core";
import { findActivePurpose } from "../../tenancy/infrastructure/tenancy.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";

import * as store from "../infrastructure/trade.store";
import {
  allocateBaseAmounts,
  computeReleaseDuty,
  nextBondedMove,
  validateBondedLines,
  validateBondedMoveShape,
} from "../domain/bonded-fold";
import {
  BondedLineInvalidError,
  BondedMoveDuplicateError,
  BondedMoveRecordNotFoundError,
  BondedMoveStateError,
  BondedReleaseShapeError,
  TradeInputInvalidError,
} from "../domain/trade-errors";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";

/**
 * PHASE-051 (W-38 — T-11, 2026-11-25) THE BONDED ENGINE (L-14 — G-66 +
 * BR-107, D-08/D-11): the bonded_warehouse_moves register's lifecycle —
 * create → execute — the customs bond's own moves.
 *
 *   THE IN-BOND TRANSFER (G-66 — D-08 VERBATIM): moves INSIDE the bond
 *   post NO duty — the physical transfer rides the REAL movement core
 *   (the transfer paths, moveKind transfer, sourced `bonded_move`, ONE
 *   ambient transaction): the OUT leg at WAC (planIssue — the trade
 *   module's own typed caller carrying the movement core's
 *   `allowBondedStock` bypass, the beneficiary discipline), the IN leg
 *   at the carried cost (planReceipt — value conservation, G-15's own
 *   law), and the G-15 journal policy ONLY when the warehouses resolve
 *   distinct accounts (the transfer dispatch's own shape VERBATIM — a
 *   value-neutral inventory pair, NEVER a duty entry; policy-none
 *   otherwise). The INITIAL DEPOSIT (from NULL — the goods enter the
 *   customs bond there): the receipt leg alone at the tenant's OWN
 *   declared unit cost (never invented), NO journal (the declared
 *   interpretation #10, recorded here at the claim site: the deposit
 *   is the CUSTODIAL entry — foreign goods in the tenant's bonded
 *   custody carry no GL recognition while suspended; the GL lands at
 *   the release — BR-107's Dr — and the INV-010 movement trail stays
 *   exact: the receipt move carries the deposit's own value, the
 *   revaluation's adjust move carries the release's uplift).
 *
 *   THE BOND LEDGER (the declared interpretation #7, the gate's own
 *   claim site — trade/infrastructure/bonded-gate.ts): the register IS
 *   the ledger — an EXECUTED IN_BOND move's lines INTO a warehouse
 *   register the duty-suspended quantities; an EXECUTED RELEASE move's
 *   lines FROM the warehouse release them. The suspended pool = Σ
 *   IN_BOND into − Σ IN_BOND out of − Σ RELEASE out of, clamped at
 *   zero — never a parallel stock dimension.
 *
 *   THE RELEASE (BR-107 — D-11 VERBATIM): the release into free
 *   circulation recognizes the duty EXACTLY ONCE — THE DECLARATION
 *   LINK (the duty's source: the linked declaration must be an IMPORT
 *   declaration at the ACCEPTED rung — the customs office's acceptance
 *   precedes the duty's authority; a COMPLETED declaration's duties
 *   already flowed through the G-65 landed-cost completion — the
 *   double-recognition refusal, the honest bifurcation) · THE FOLD'S
 *   FIGURE (the per-line duty = the declaration's OWN duty_amount ×
 *   the released share, the bonded-fold's tie — every declared line
 *   item-bearing, every released item declared exactly once, the
 *   over-release guard over the register's own Σ) · THE FX RIDE (D-21
 *   — the recognition is the BASE figure at the act's contract rate
 *   when the declaration's currency differs; the per-line base
 *   allocation carries the exact-Σ law) · THE RECOGNITION (the
 *   G-65-shaped pair at the released quantity: **DR the released
 *   stock's value — the revaluation discipline's own math, the
 *   WAC/layers uplift at the released quantity through the REAL
 *   RevaluationService VERBATIM · CR the purpose-mapped
 *   CUSTOMS_DUTY_PAYABLE (the 0122 §8 marker 2145 — fail-closed until
 *   mapped)**, INV-013 single-use on (bonded_warehouse_moves, id,
 *   release) — the journal source's own anchor) · THE SINGLE-USE STAMP
 *   (the execution CAS: DRAFT → EXECUTED with the recognition pair
 *   ATOMIC in ONE guarded statement — ck_release_shape's own demand; a
 *   raced or repeated execution is the typed replay refusal naming
 *   the move + the figures) · THE ZERO-DUTY RELEASE (the declared
 *   interpretation #6 extended by the same law: an all-zero duty set
 *   at the released quantity executes with the EMPTY recognition pair
 *   — «the duties that exist flow; the duties that do not, do not»;
 *   the pool still releases — the goods leave the bond, the
 *   flip-and-restore at the gate's own face).
 *
 *   ONE AMBIENT TRANSACTION (INV-018): the movement legs, the journal,
 *   the revaluation, the execution stamp and the recognition pair
 *   commit together or not at all.
 */
const BND_NUMBER_FORMAT = { prefix: "BND", format: "BND-{YYYY}-{SEQ:6}", docType: "bonded_warehouse_move" };

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new TradeInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The FX rate resolution (the LC/customs engines' own shape — D-21):
 * the contract rate is required at the act when the declaration's
 * currency differs from the tenant's base. */
async function resolveRate(currency: string, exchangeRate: string | null): Promise<string | undefined> {
  const base = await ownTenantBaseCurrency();
  if (currency === base) {
    return undefined;
  }
  if (exchangeRate === null || exchangeRate === "") {
    throw new TradeInputInvalidError({
      field: "exchangeRate",
      reason: `the declaration is in ${currency} (base ${base}) — the contract rate is required at the act (the existing FX discipline)`,
    });
  }
  const rate = new Decimal(exchangeRate);
  if (!rate.isFinite() || rate.lessThanOrEqualTo(0)) {
    throw new TradeInputInvalidError({
      field: "exchangeRate",
      reason: `a positive contract rate is required, got "${exchangeRate}"`,
    });
  }
  return rate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

function baseAmountAt(amount: string, rate: string | undefined): string {
  if (rate === undefined) {
    return amount;
  }
  return new Decimal(amount)
    .times(new Decimal(rate))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

@Injectable()
export class BondedService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(RevaluationService) private readonly revaluation: RevaluationService,
  ) {}

  // ── the reads ─────────────────────────────────────────────────────────

  async list(filter: { moveKind?: string; status?: string; warehouseId?: string; declarationId?: string }) {
    return store.listBondedMoves({ ...filter, limit: 200 });
  }

  async find(id: string) {
    const row = await store.findBondedMoveById(requireUuid(id, "id"));
    if (row === undefined) {
      throw new BondedMoveRecordNotFoundError({ moveId: id });
    }
    return row;
  }

  // ── the create act (the register's DRAFT row) ─────────────────────────

  async create(input: {
    moveKind: string;
    fromWarehouseId?: string | null;
    toWarehouseId?: string | null;
    declarationId?: string | null;
    lines: readonly { itemId: string; qty: string; unitCost?: string | null }[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.BondedMoveRow> {
    // THE KIND SHAPES (the fold's own verdicts, rendered VERBATIM).
    const shape = validateBondedMoveShape({
      kind: input.moveKind,
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
    });
    if (!shape.valid) {
      if (shape.field === "moveKind") {
        throw new TradeInputInvalidError({ field: "moveKind", reason: shape.reason! });
      }
      throw new BondedMoveStateError({
        moveId: "",
        moveNo: "(unassigned)",
        from: "DRAFT",
        to: "DRAFT",
        reason: shape.reason!,
      });
    }
    // THE LINE FLOORS (the fold's own verdicts).
    const lines = validateBondedLines(input.lines);
    if (!lines.valid) {
      throw new BondedLineInvalidError({ field: lines.field, reason: lines.reason! });
    }
    // THE DEPOSIT'S OWN COST (from NULL — the custodial receipt's
    // value): the tenant's OWN figure per line, never invented.
    if (input.moveKind === "IN_BOND" && (input.fromWarehouseId ?? null) === null) {
      for (const [index, line] of input.lines.entries()) {
        if (line.unitCost === undefined || line.unitCost === null || line.unitCost === "") {
          throw new BondedLineInvalidError({
            field: `lines[${index}].unitCost`,
            reason: "the initial deposit (from NULL) carries its own commercial unit cost per line — the tenant's own figure, never invented (the custodial receipt's value)",
          });
        }
      }
    }
    // THE RELEASE'S DECLARATION LINK (BR-107's own law — the duty's
    // source is the linked declaration, fail-closed at create).
    if (input.moveKind === "RELEASE" && (input.declarationId ?? null) === null) {
      throw new BondedReleaseShapeError({
        moveNo: "(unassigned)",
        reason:
          "a RELEASE move carries its declaration link (BR-107 — the duty recognized is the declaration's own figure; link the import declaration at create)",
      });
    }
    for (const [field, value] of [
      ["fromWarehouseId", input.fromWarehouseId ?? null],
      ["toWarehouseId", input.toWarehouseId ?? null],
      ["declarationId", input.declarationId ?? null],
    ] as const) {
      if (value !== null) {
        requireUuid(value, field);
      }
    }
    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: BND_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: BND_NUMBER_FORMAT.format,
      prefix: BND_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findBondedMoveByNo(acquired.number)) !== undefined) {
      throw new BondedMoveDuplicateError({ moveNo: acquired.number });
    }
    const row = await store.insertBondedMove({
      moveNo: acquired.number,
      moveKind: input.moveKind as "IN_BOND" | "RELEASE",
      fromWarehouseId: input.fromWarehouseId ?? null,
      toWarehouseId: input.toWarehouseId ?? null,
      declarationId: input.declarationId ?? null,
      lines: input.lines.map((line) => ({
        itemId: line.itemId,
        qty: new Decimal(line.qty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
        unitCost: line.unitCost ?? null,
      })),
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.bonded_move_created",
      entityType: "bonded_warehouse_moves",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { moveNo: row.moveNo, moveKind: row.moveKind, lines: input.lines.length },
    });
    return row;
  }

  // ── THE EXECUTE ACT (the single act — DRAFT → EXECUTED) ───────────────

  async execute(input: {
    id: string;
    exchangeRate?: string | null;
    entryDate?: string | null;
    actorId: string | null;
  }): Promise<{
    move: store.BondedMoveRow;
    journalEntryId: string | null;
    transferJournalEntryId: string | null;
    dutyBase: string | null;
  }> {
    const row = await store.findBondedMoveById(requireUuid(input.id, "id"));
    if (row === undefined) {
      throw new BondedMoveRecordNotFoundError({ moveId: input.id });
    }
    // THE LADDER (the fold's verdict, rendered VERBATIM — the typed
    // replay refusal names the exactly-once law).
    const verdict = nextBondedMove(row.status as "DRAFT", "execute");
    if (!verdict.allowed) {
      throw new BondedMoveStateError({
        moveId: row.id,
        moveNo: row.moveNo,
        from: row.status,
        to: "EXECUTED",
        reason: verdict.reason!,
      });
    }
    const executeDate = input.entryDate ?? todayIso();

    if (row.moveKind === "IN_BOND") {
      return this.executeInBond(row, executeDate, input.actorId);
    }
    return this.executeRelease(row, executeDate, input);
  }

  /** THE IN-BOND TRANSFER (G-66 — NO duty entry, the REAL movement core). */
  private async executeInBond(
    row: store.BondedMoveRow,
    executeDate: string,
    actorId: string | null,
  ): Promise<{
    move: store.BondedMoveRow;
    journalEntryId: null;
    transferJournalEntryId: string | null;
    dutyBase: null;
  }> {
    // The deposit (from NULL): the receipt leg alone — the custodial
    // entry, NO journal (the declared interpretation #10 at the claim
    // site above). PLAN every leg first (no writes), then the CAS,
    // then APPLY — the transfer dispatch's own discipline.
    if (row.fromWarehouseId === null) {
      const receiptPlans: Awaited<ReturnType<typeof planReceipt>>[] = [];
      for (const line of row.lines) {
        receiptPlans.push(
          await planReceipt({
            itemId: line.itemId,
            warehouseId: row.toWarehouseId!,
            qty: line.qty,
            unitCost: line.unitCost ?? "0",
            movedAt: executeDate,
            moveKind: "receipt",
            sourceType: "bonded_move",
            sourceId: row.id,
          }),
        );
      }
      const stamped = await store.stampBondedMoveExecuted({
        id: row.id,
        dutyAmount: null,
        releaseJournalEntryId: null,
        declarationId: null,
      });
      if (stamped === undefined) {
        throw new BondedMoveStateError({
          moveId: row.id,
          moveNo: row.moveNo,
          from: "DRAFT",
          to: "EXECUTED",
          reason: "the execution raced — the move is already executed (the exactly-once stamp law)",
        });
      }
      for (const plan of receiptPlans) {
        await applyReceipt(plan, null);
      }
      await this.audit.record({
        action: "trade.bonded_move_executed",
        entityType: "bonded_warehouse_moves",
        entityId: row.id,
        actorId: actorId ?? undefined,
        after: { moveNo: row.moveNo, kind: "IN_BOND", shape: "DEPOSIT", journal: null },
      });
      return { move: stamped, journalEntryId: null, transferJournalEntryId: null, dutyBase: null };
    }

    // The within-bond transfer (from → to): the REAL movement core's
    // two-legged shape — the OUT leg at WAC (the typed caller carrying
    // the bypass), the IN leg at the carried cost.
    const outPlans: Awaited<ReturnType<typeof planIssue>>[] = [];
    for (const line of row.lines) {
      outPlans.push(
        await planIssue({
          itemId: line.itemId,
          warehouseId: row.fromWarehouseId,
          qty: line.qty,
          movedAt: executeDate,
          moveKind: "transfer_out",
          sourceType: "bonded_move",
          sourceId: row.id,
          allowNegative: false,
          allowBondedStock: true,
        }),
      );
    }
    // The G-15 journal policy (the transfer dispatch's own shape
    // VERBATIM): a value-neutral inventory pair ONLY when the
    // warehouses resolve distinct accounts — NEVER a duty entry.
    const sourceAccount = await resolveInventoryAccount(row.fromWarehouseId);
    const destAccount = await resolveInventoryAccount(row.toWarehouseId!);
    let transferJournalEntryId: string | null = null;
    if (sourceAccount !== destAccount) {
      const total = outPlans
        .reduce((sum, plan) => sum.plus(new Decimal(plan.valueAmount)), new Decimal(0))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
      const spec: JournalSpec = {
        source: { docType: "bonded_warehouse_move", docId: row.id, operation: "in_bond" },
        entryDate: executeDate,
        description: {
          en: `In-bond transfer ${row.moveNo} (G-66 — no duty)`,
          ar: `تحويل داخل الضمان ${row.moveNo} (G-66 — بلا رسوم)`,
        },
        currency: await ownTenantBaseCurrency(),
        lines: [
          {
            accountId: destAccount,
            direction: "DEBIT",
            amount: total,
            memo: { en: `In-bond transfer in ${row.moveNo}`, ar: `تحويل وارد داخل الضمان ${row.moveNo}` },
          },
          {
            accountId: sourceAccount,
            direction: "CREDIT",
            amount: total,
            memo: { en: `In-bond transfer out ${row.moveNo}`, ar: `تحويل صادر داخل الضمان ${row.moveNo}` },
          },
        ],
      };
      const posted = await this.posting.post(spec, { postedBy: actorId });
      if (!posted.idempotentReplay) {
        transferJournalEntryId = posted.journalEntryId;
      }
    }
    // The execution CAS (the register's single guarded statement).
    const stamped = await store.stampBondedMoveExecuted({
      id: row.id,
      dutyAmount: null,
      releaseJournalEntryId: null,
      declarationId: null,
    });
    if (stamped === undefined) {
      throw new BondedMoveStateError({
        moveId: row.id,
        moveNo: row.moveNo,
        from: "DRAFT",
        to: "EXECUTED",
        reason: "the execution raced — the move is already executed (the exactly-once stamp law)",
      });
    }
    // APPLY the legs (idempotent state flip first — the transfer
    // dispatch's own order).
    for (const plan of outPlans) {
      await applyIssue(plan, transferJournalEntryId);
    }
    for (const [index, line] of row.lines.entries()) {
      const plan = outPlans[index]!;
      const carriedCost = new Decimal(plan.valueAmount)
        .div(new Decimal(line.qty))
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toFixed(6);
      const receiptPlan = await planReceipt({
        itemId: line.itemId,
        warehouseId: row.toWarehouseId!,
        qty: line.qty,
        unitCost: carriedCost,
        movedAt: executeDate,
        moveKind: "transfer_in",
        sourceType: "bonded_move",
        sourceId: row.id,
      });
      await applyReceipt(receiptPlan, transferJournalEntryId);
    }
    await this.audit.record({
      action: "trade.bonded_move_executed",
      entityType: "bonded_warehouse_moves",
      entityId: row.id,
      actorId: actorId ?? undefined,
      after: {
        moveNo: row.moveNo,
        kind: "IN_BOND",
        shape: "TRANSFER",
        journal: transferJournalEntryId,
        journalPolicy: sourceAccount !== destAccount ? "G15_DISTINCT_ACCOUNTS" : "POLICY_NONE",
      },
    });
    return { move: stamped, journalEntryId: null, transferJournalEntryId, dutyBase: null };
  }

  /** THE RELEASE (BR-107 — the exactly-once duty recognition). */
  private async executeRelease(
    row: store.BondedMoveRow,
    executeDate: string,
    input: { exchangeRate?: string | null; actorId: string | null },
  ): Promise<{
    move: store.BondedMoveRow;
    journalEntryId: string | null;
    transferJournalEntryId: string | null;
    dutyBase: string | null;
  }> {
    // THE DECLARATION LINK (BR-107's own law — fail-closed).
    if (row.declarationId === null) {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: "the release carries no declaration link — the duty recognized is the declaration's own figure (link the import declaration)",
      });
    }
    const declaration = await store.findDeclarationById(row.declarationId);
    if (declaration === undefined) {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: `the linked declaration ${row.declarationId} does not exist (the register's own FK floor — the row was never found)`,
      });
    }
    if (declaration.declarationType !== "IMPORT") {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: `the linked declaration ${declaration.declarationNo} is ${declaration.declarationType} — the release recognizes IMPORT duty (the import declaration's own figure)`,
      });
    }
    if (declaration.status === "COMPLETED") {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: `the linked declaration ${declaration.declarationNo} is COMPLETED — its duties already flowed through the G-65 landed-cost completion (the double-recognition refusal, the honest bifurcation)`,
      });
    }
    if (declaration.status !== "ACCEPTED") {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: `the linked declaration ${declaration.declarationNo} is ${declaration.status} — only the ACCEPTED rung carries the authoritative duty figure (the customs office's acceptance precedes)`,
      });
    }
    // THE FOLD'S TIE (the declaration's OWN lines — every declared line
    // item-bearing, the tie's exactness law).
    const declarationLines = await store.listDeclarationLines(declaration.id);
    const itemBearing = declarationLines.filter((line) => line.itemId !== null);
    if (itemBearing.length !== declarationLines.length) {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: `the declaration ${declaration.declarationNo} carries a line without an item — the release tie demands every declared line item-bearing (the duty partition is by item, the INV-036 tie's own exactness)`,
      });
    }
    if (declarationLines.length === 0) {
      throw new BondedReleaseShapeError({
        moveNo: row.moveNo,
        reason: `the declaration ${declaration.declarationNo} carries no lines — the release's duty has no source`,
      });
    }
    // THE FOLD'S FIGURE (the per-line duty at the released quantity +
    // the over-release guard over the register's own Σ).
    const alreadyReleased = await store.sumReleasedQtyByDeclaration(declaration.id);
    const duty = computeReleaseDuty({
      declared: declarationLines.map((line) => ({
        itemId: line.itemId!,
        quantity: line.quantity ?? "0",
        dutyAmount: line.dutyAmount,
      })),
      released: row.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
      alreadyReleasedByItem: alreadyReleased,
    });
    if (duty.lines === null || duty.totalDuty === null) {
      throw new BondedReleaseShapeError({ moveNo: row.moveNo, reason: `${duty.field}: ${duty.reason}` });
    }
    const positiveDuty = new Decimal(duty.totalDuty).greaterThan(0);

    // THE FX RIDE (D-21 — the recognition is the BASE figure).
    const rate = await resolveRate(declaration.currency, input.exchangeRate ?? null);
    const dutyBase = positiveDuty ? baseAmountAt(duty.totalDuty, rate) : null;

    // THE PURPOSE MAPPING (fail-closed until mapped — the 0122 §8
    // marker standing; the G-65 flow's own wording).
    if (positiveDuty) {
      const mapping = await findActivePurpose("CUSTOMS_DUTY_PAYABLE");
      if (mapping === undefined) {
        throw new BondedReleaseShapeError({
          moveNo: row.moveNo,
          reason:
            "the purpose CUSTOMS_DUTY_PAYABLE is not mapped in the tenant's COA — the release's recognition is fail-closed until mapped (the 0122 §8 marker, the G-65 flow's own law)",
        });
      }
    }

    // THE PHYSICAL LEGS (to provided — the release INTO the destination
    // free warehouse): the OUT leg at WAC (the typed caller carrying
    // the bypass — the pool is still positive while the goods move),
    // the IN leg at the carried cost; the G-15 policy journal (distinct
    // accounts — a value-neutral pair, NEVER a duty entry). In-place
    // (to NULL): NO legs — the goods stay, only the duty state flips.
    let transferJournalEntryId: string | null = null;
    const outPlans: Awaited<ReturnType<typeof planIssue>>[] = [];
    if (row.toWarehouseId !== null) {
      for (const line of row.lines) {
        outPlans.push(
          await planIssue({
            itemId: line.itemId,
            warehouseId: row.fromWarehouseId!,
            qty: line.qty,
            movedAt: executeDate,
            moveKind: "transfer_out",
            sourceType: "bonded_move",
            sourceId: row.id,
            allowNegative: false,
            allowBondedStock: true,
          }),
        );
      }
      const sourceAccount = await resolveInventoryAccount(row.fromWarehouseId!);
      const destAccount = await resolveInventoryAccount(row.toWarehouseId);
      if (sourceAccount !== destAccount) {
        const total = outPlans
          .reduce((sum, plan) => sum.plus(new Decimal(plan.valueAmount)), new Decimal(0))
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
          .toFixed(4);
        const spec: JournalSpec = {
          source: { docType: "bonded_warehouse_move", docId: row.id, operation: "release_transfer" },
          entryDate: executeDate,
          description: {
            en: `Bond release transfer ${row.moveNo} (G-66 — no duty on the move)`,
            ar: `تحويل الإفراج من الضمان ${row.moveNo} (G-66 — بلا رسوم على الحركة)`,
          },
          currency: await ownTenantBaseCurrency(),
          lines: [
            {
              accountId: destAccount,
              direction: "DEBIT",
              amount: total,
              memo: { en: `Release transfer in ${row.moveNo}`, ar: `تحويل وارد الإفراج ${row.moveNo}` },
            },
            {
              accountId: sourceAccount,
              direction: "CREDIT",
              amount: total,
              memo: { en: `Release transfer out ${row.moveNo}`, ar: `تحويل صادر الإفراج ${row.moveNo}` },
            },
          ],
        };
        const posted = await this.posting.post(spec, { postedBy: input.actorId });
        if (!posted.idempotentReplay) {
          transferJournalEntryId = posted.journalEntryId;
        }
      }
    }

    // THE RECOGNITION JOURNAL (BR-107's G-65-shaped pair — the released
    // stock's value uplift against the purpose-mapped liability): Dr
    // INVENTORY (the released stock's warehouse) · Cr CUSTOMS_DUTY_
    // PAYABLE — INV-013 single-use on (bonded_warehouse_moves, id,
    // release). The zero-duty release posts NOTHING (the empty pair —
    // interpretation #6's own law).
    const upliftWarehouseId = row.toWarehouseId ?? row.fromWarehouseId!;
    let journalEntryId: string | null = null;
    if (positiveDuty) {
      const inventoryAccount = await resolveInventoryAccount(upliftWarehouseId);
      const journalLines: JournalLineSpec[] = [
        {
          accountId: inventoryAccount,
          direction: "DEBIT",
          amount: dutyBase!,
          memo: {
            en: `Bond release ${row.moveNo} — released stock value uplift (BR-107)`,
            ar: `إفراج الضمان ${row.moveNo} — رفع قيمة المخزون المفرج BR-107`,
          },
        },
        {
          purpose: "CUSTOMS_DUTY_PAYABLE",
          direction: "CREDIT",
          amount: dutyBase!,
          memo: {
            en: `Bond release ${row.moveNo} — customs duty recognized at release (BR-107)`,
            ar: `إفراج الضمان ${row.moveNo} — الرسوم الجمركية المعترف بها عند الإفراج BR-107`,
          },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "bonded_warehouse_move", docId: row.id, operation: "release" },
        entryDate: executeDate,
        description: {
          en: `Bond release ${row.moveNo} — the duty recognized exactly once (BR-107)`,
          ar: `إفراج الضمان ${row.moveNo} — الرسوم تعترف مرة واحدة BR-107`,
        },
        currency: await ownTenantBaseCurrency(),
        lines: journalLines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
    }

    // THE EXECUTION CAS — the register's single guarded statement: the
    // stamp + THE RECOGNITION PAIR ATOMIC (duty_amount + the stamp +
    // the journal link + the declaration link land TOGETHER, or the
    // empty pair when zero — ck_release_shape's own demand). A raced
    // or repeated execution returns undefined — the typed replay
    // refusal (BR-107's exactly-once).
    const stamped = await store.stampBondedMoveExecuted({
      id: row.id,
      dutyAmount: dutyBase,
      releaseJournalEntryId: journalEntryId,
      declarationId: row.declarationId,
    });
    if (stamped === undefined) {
      throw new BondedMoveStateError({
        moveId: row.id,
        moveNo: row.moveNo,
        from: "DRAFT",
        to: "EXECUTED",
        reason:
          "the execution raced — the move is already executed (the release's recognition is exactly-once, BR-107 — the single-use stamp law)",
      });
    }

    // APPLY the physical legs (the flip-and-restore's own substrate:
    // the CAS landed EXECUTED first — the pool released — then the
    // legs land the stock).
    for (const plan of outPlans) {
      await applyIssue(plan, transferJournalEntryId);
    }
    for (const [index, line] of row.lines.entries()) {
      if (row.toWarehouseId === null) {
        break;
      }
      const plan = outPlans[index]!;
      const carriedCost = new Decimal(plan.valueAmount)
        .div(new Decimal(line.qty))
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toFixed(6);
      const receiptPlan = await planReceipt({
        itemId: line.itemId,
        warehouseId: row.toWarehouseId,
        qty: line.qty,
        unitCost: carriedCost,
        movedAt: executeDate,
        moveKind: "transfer_in",
        sourceType: "bonded_move",
        sourceId: row.id,
      });
      await applyReceipt(receiptPlan, transferJournalEntryId);
    }

    // THE REVALUATION UPLIFT (the revaluation discipline's own math —
    // the WAC/layers uplift at the released quantity, through the REAL
    // RevaluationService VERBATIM): the per-line base allocation (the
    // exact-Σ law — the remainder to the last line) revalues the
    // released stock at its warehouse; the journal link rides every
    // adjust row (INV-018's all-or-nothing — the same ambient
    // transaction). Zero-duty lines never revalue (the positive-amount
    // floor's own law).
    if (positiveDuty) {
      const lineDuties = duty.lines.map((line) => line.dutyAmount);
      const baseFigures = allocateBaseAmounts(lineDuties, rate);
      for (const [index, line] of row.lines.entries()) {
        const amount = baseFigures[index]!;
        if (new Decimal(amount).greaterThan(0)) {
          await this.revaluation.applyLandedCostRevalue({
            itemId: line.itemId,
            warehouseId: upliftWarehouseId,
            amount,
            journalEntryId: journalEntryId!,
            movedAt: executeDate,
            sourceType: "bonded_move",
            sourceId: row.id,
            actorId: input.actorId,
          });
        }
      }
    }

    await this.audit.record({
      action: "trade.bonded_move_executed",
      entityType: "bonded_warehouse_moves",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: {
        moveNo: row.moveNo,
        kind: "RELEASE",
        declarationNo: declaration.declarationNo,
        dutyDeclarationCurrency: duty.totalDuty,
        dutyBase,
        journal: journalEntryId,
        transferJournal: transferJournalEntryId,
        upliftWarehouse: upliftWarehouseId,
        rate: rate ?? null,
      },
    });
    return { move: stamped, journalEntryId, transferJournalEntryId, dutyBase };
  }
}
