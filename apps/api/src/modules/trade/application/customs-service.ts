import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { LandedCostService } from "../../purchasing/application/landed-costs";
import { findLandedCostByDeclaration } from "../../purchasing/infrastructure/purchasing.store";
import { findActivePurpose } from "../../tenancy/infrastructure/tenancy.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";

import * as store from "../infrastructure/trade.store";
import { computeDeclarationTotals, computeLineDuty } from "../domain/duty-vat-fold";
import {
  CustomsPurposeNotMappedError,
  DeclarationDuplicateError,
  DeclarationLandedCostDuplicateError,
  DeclarationLineInvalidError,
  DeclarationRecordNotFoundError,
  DeclarationStateError,
  HsCodeDuplicateError,
  HsCodeFrozenError,
  HsCodeInvalidError,
  HsCodeRecordNotFoundError,
  TradeInputInvalidError,
} from "../domain/trade-errors";

/**
 * PHASE-051 (W-37 — T-10, 2026-11-25) THE CUSTOMS ENGINE (L-06/L-07/L-08):
 * the declarations register's lifecycle — create (with the declaration's
 * own lines) → submit → accept → **complete — G-65's flow** — with the
 * duty/VAT line math (D-06 — the PURE fold rendered VERBATIM, zero
 * parallel computation) and the HS registry's tenant extension.
 *
 *   THE LADDER (the 0121 stamp law's fold): DRAFT → SUBMITTED → ACCEPTED
 *   → COMPLETED | CANCELLED (the DRAFT-only exit — the submission stamp
 *   is monotone evidence that never un-stamps; a COMPLETED declaration
 *   is terminal). The COMPLETED rung is INV-036's own floor.
 *
 *   THE LINE MATH (D-06 — the duty/VAT fold): every line's duty_amount
 *   is computed by the PURE fold on Decimal (ADR-0009 — customs_value ×
 *   duty_rate at the ledger's 4dp); the rates and the import VAT are
 *   the TENANT'S OWN DATA (the no-hardcoded-rates law — never seeded,
 *   never defaulted; a zero rate is the explicit EXW/free statement).
 *   The declaration's totals render from the LINES at every read —
 *   never a stored parallel figure.
 *
 *   THE G-65 FLOW (the completion act — D-06 VERBATIM): the completed
 *   declaration's duties and import VAT flow into the EXISTING
 *   landed-cost allocation — **a landed-cost document of kind `customs`
 *   sourced from the declaration's OWN lines, allocated by VALUE per
 *   the existing engine VERBATIM (zero parallel computation — the REAL
 *   LandedCostService is the ONLY allocator)**: DR INVENTORY (the
 *   on-hand allocation) · DR COGS (the issued portion) · CR the
 *   purpose-mapped `CUSTOMS_DUTY_PAYABLE` (the 0122 §8 marker 2145 —
 *   fail-closed until mapped), the line-level tie riding the allocation
 *   rows (the trade gate's map — INV-036's own demand). ONE ambient
 *   transaction (INV-018): the completion stamp, the landed-cost
 *   document, the journal, the revaluation and the linkage pair commit
 *   together or not at all. The exactly-once: the completion CAS (the
 *   stamp law) + the 0125 partial unique (one customs landed cost per
 *   declaration, ever — the INV-013-equivalent single-use, D-06's own
 *   wording).
 *
 *   THE FX RIDE (D-21's own shape): the declaration's duties ride the
 *   EXISTING FX discipline at the contract rate — the landed-cost
 *   amount is the BASE-currency figure (the existing engine's own law),
 *   converted at the act's explicit rate when the declaration's
 *   currency differs from the base.
 *
 *   THE ZERO-DUTY COMPLETION (the declared interpretation #6, recorded
 *   here at the claim site): a declaration whose fold totals land at
 *   0.0000 (the all-EXW/free set — every rate and VAT zero, the
 *   tenant's explicit statement) completes WITHOUT a landed-cost
 *   document: nothing to allocate (the existing engine demands a
 *   positive amount — its own floor), the linkage pair stays NULL, and
 *   the completion stamp stands alone. The duties that exist flow; the
 *   duties that do not, do not.
 *
 *   THE HS REGISTRY (D-16): the tenant-extensible starter set — the
 *   reads render the seeds (the 0122 §6 rows through the onboarding
 *   materialization); the tenant additions refuse the (tenant, hs_code)
 *   natural key BY NAME; the code is the row's identity (frozen); the
 *   retirement (is_active = false) is the registry's own snapshot
 *   semantics (a retired code never rides a NEW declaration line's
 *   display; the lines keep their recorded code).
 */

const CUS_NUMBER_FORMAT = { prefix: "CUS", format: "CUS-{YYYY}-{SEQ:6}", docType: "customs_declaration" };

const DECLARATION_TYPES = ["IMPORT", "EXPORT", "TRANSIT"] as const;
type DeclarationType = (typeof DECLARATION_TYPES)[number];

function requireUuid(value: string, what: string): string {
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    throw new TradeInputInvalidError({ field: what, reason: "a uuid is required" });
  }
  return value;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The FX rate resolution (the LC engine's own shape — D-21): the
 * contract rate is required at the act when the declaration's currency
 * differs from the tenant's base. */
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
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** The declaration's own line input (the controller's shape — the fold's
 * write face). */
export interface DeclarationLineInput {
  hsCode: string;
  originCountry?: string | null;
  itemId?: string | null;
  description?: string | null;
  quantity?: string | null;
  uom?: string | null;
  customsValue: string;
  dutyRate: string;
  importVat: string;
  note?: string | null;
  noteAr?: string | null;
}

@Injectable()
export class CustomsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly landedCosts: LandedCostService,
  ) {}

  // ── the reads (the register + the totals from the LINES) ─────────────

  async list(filter: { status?: string; declarationType?: string; receiptId?: string }) {
    return store.listDeclarations(filter);
  }

  async find(id: string): Promise<{
    declaration: store.DeclarationRow;
    lines: store.DeclarationLineRow[];
    totals: ReturnType<typeof computeDeclarationTotals>;
  }> {
    requireUuid(id, "id");
    const found = await store.findDeclarationWithLines(id);
    if (found === undefined) {
      throw new DeclarationRecordNotFoundError({ declarationId: id });
    }
    // The totals render from the LINES at every read (never a stored
    // parallel figure — D-06's zero-parallel-computation law).
    const totals = computeDeclarationTotals(
      found.lines.map((line) => ({
        customsValue: line.customsValue,
        dutyRate: line.dutyRate,
        importVat: line.importVat,
        dutyAmount: line.dutyAmount,
      })),
    );
    return { ...found, totals };
  }

  // ── the register acts (the ladder + the lines) ───────────────────────

  async createDeclaration(input: {
    declarationType: string;
    customsOffice: string;
    currency: string;
    receiptId?: string | null;
    purchaseOrderId?: string | null;
    billOfLadingId?: string | null;
    lines: readonly DeclarationLineInput[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.DeclarationRow> {
    if (!DECLARATION_TYPES.includes(input.declarationType as DeclarationType)) {
      throw new TradeInputInvalidError({
        field: "declarationType",
        reason: `the declaration vocabulary is ${DECLARATION_TYPES.join("/")}, got "${input.declarationType}"`,
      });
    }
    if (input.customsOffice.trim().length === 0 || input.customsOffice.length > 200) {
      throw new TradeInputInvalidError({ field: "customsOffice", reason: "1…200 chars are required (the customs office of lodging)" });
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) {
      throw new TradeInputInvalidError({ field: "currency", reason: `an ISO-4217 code is required, got "${input.currency}"` });
    }
    for (const [field, value] of [
      ["receiptId", input.receiptId ?? null],
      ["purchaseOrderId", input.purchaseOrderId ?? null],
      ["billOfLadingId", input.billOfLadingId ?? null],
    ] as const) {
      if (value !== null) {
        requireUuid(value, field);
      }
    }
    if (input.lines.length === 0) {
      throw new DeclarationLineInvalidError({
        field: "lines",
        reason: "a declaration carries at least one line at create (the empty-declaration floor — the register's own shape)",
      });
    }
    if (input.lines.length > 200) {
      throw new DeclarationLineInvalidError({
        field: "lines",
        reason: `at most 200 lines are accepted, got ${input.lines.length}`,
      });
    }
    // The lines validate + compute through THE FOLD (D-06 VERBATIM — the
    // duty_amount is the fold's output, never the caller's).
    const computed = computeLines(input.lines);
    // The FX floor at create (the contract rate resolves at the
    // completion act; at create the currency's shape is the floor).
    const year = todayIso().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: CUS_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: CUS_NUMBER_FORMAT.format,
      prefix: CUS_NUMBER_FORMAT.prefix,
      year,
    });
    if ((await store.findDeclarationByNo(acquired.number)) !== undefined) {
      throw new DeclarationDuplicateError({ declarationNo: acquired.number });
    }
    const declaration = await store.insertDeclaration({
      declarationNo: acquired.number,
      declarationType: input.declarationType,
      customsOffice: input.customsOffice.trim(),
      currency: input.currency,
      receiptId: input.receiptId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      billOfLadingId: input.billOfLadingId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    let lineNo = 1;
    for (const line of computed) {
      await store.insertDeclarationLine({
        declarationId: declaration.id,
        lineNo,
        hsCode: line.hsCode,
        originCountry: line.originCountry,
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity,
        uom: line.uom,
        customsValue: line.customsValue,
        dutyRate: line.dutyRate,
        dutyAmount: line.dutyAmount,
        importVat: line.importVat,
        note: line.note,
        noteAr: line.noteAr,
        actorId: input.actorId,
      });
      lineNo += 1;
    }
    await this.audit.record({
      action: "trade.declaration_created",
      entityType: "customs_declarations",
      entityId: declaration.id,
      actorId: input.actorId ?? undefined,
      after: {
        declarationNo: declaration.declarationNo,
        declarationType: declaration.declarationType,
        lines: computed.length,
        receiptId: declaration.receiptId,
      },
    });
    return declaration;
  }

  /** The lines API's add arm (the DRAFT-only window — once submitted the
   * lines are the customs office's own record, S/I/U no rewrite). */
  async addLine(declarationId: string, input: DeclarationLineInput, actorId: string | null): Promise<store.DeclarationLineRow> {
    requireUuid(declarationId, "id");
    const declaration = await store.findDeclarationById(declarationId);
    if (declaration === undefined) {
      throw new DeclarationRecordNotFoundError({ declarationId });
    }
    if (declaration.status !== "DRAFT") {
      throw new DeclarationStateError({
        declarationId,
        declarationNo: declaration.declarationNo,
        from: declaration.status,
        to: `+line ${input.hsCode}`,
        reason: "the lines window is the DRAFT rung only — once submitted, the declaration's lines are the customs office's own record",
      });
    }
    const line = computeLines([input])[0]!;
    const lineNo = await store.nextDeclarationLineNo(declarationId);
    const inserted = await store.insertDeclarationLine({
      declarationId,
      lineNo,
      hsCode: line.hsCode,
      originCountry: line.originCountry,
      itemId: line.itemId,
      description: line.description,
      quantity: line.quantity,
      uom: line.uom,
      customsValue: line.customsValue,
      dutyRate: line.dutyRate,
      dutyAmount: line.dutyAmount,
      importVat: line.importVat,
      note: line.note,
      noteAr: line.noteAr,
      actorId,
    });
    await this.audit.record({
      action: "trade.declaration_line_added",
      entityType: "customs_declaration_lines",
      entityId: inserted.id,
      actorId: actorId ?? undefined,
      after: { declarationId, lineNo, hsCode: inserted.hsCode },
    });
    return inserted;
  }

  async submit(id: string, actorId: string | null): Promise<store.DeclarationRow> {
    const declaration = await requireDeclaration(id, "submit");
    const lines = await store.listDeclarationLines(id);
    if (lines.length === 0) {
      throw new DeclarationStateError({
        declarationId: declaration.id,
        declarationNo: declaration.declarationNo,
        from: declaration.status,
        to: "SUBMITTED",
        reason: "the declaration carries no lines — a submitted declaration is the customs office's complete record",
      });
    }
    const stamped = await store.stampDeclarationSubmitted(id);
    if (stamped === undefined) {
      throw racedMove(declaration, "SUBMITTED");
    }
    await this.audit.record({
      action: "trade.declaration_submitted",
      entityType: "customs_declarations",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { declarationNo: stamped.declarationNo, status: stamped.status },
    });
    return stamped;
  }

  async accept(id: string, actorId: string | null): Promise<store.DeclarationRow> {
    const declaration = await requireDeclaration(id, "accept");
    const stamped = await store.stampDeclarationAccepted(id);
    if (stamped === undefined) {
      throw racedMove(declaration, "ACCEPTED");
    }
    await this.audit.record({
      action: "trade.declaration_accepted",
      entityType: "customs_declarations",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { declarationNo: stamped.declarationNo, status: stamped.status },
    });
    return stamped;
  }

  async cancel(id: string, reason: string, actorId: string | null): Promise<store.DeclarationRow> {
    const declaration = await requireDeclaration(id, "cancel");
    if (reason.trim().length === 0 || reason.length > 2000) {
      throw new TradeInputInvalidError({ field: "reason", reason: "1…2000 chars are required (the cancellation's own record)" });
    }
    if (declaration.status !== "DRAFT") {
      // THE STAMP-SHAPE FLOOR's own wording (the 0121
      // ck_customs_declarations_submitted_shape law: CANCELLED carries
      // submitted_at NULL — the submission stamp is monotone evidence
      // that never un-stamps; once submitted, the declaration completes
      // or stands).
      throw new DeclarationStateError({
        declarationId: declaration.id,
        declarationNo: declaration.declarationNo,
        from: declaration.status,
        to: "CANCELLED",
        reason: "the cancellation exits the DRAFT rung only — the submission stamp is monotone evidence that never un-stamps (the 0121 stamp-shape floor)",
      });
    }
    const stamped = await store.stampDeclarationCancelled(id);
    if (stamped === undefined) {
      throw racedMove(declaration, "CANCELLED");
    }
    await this.audit.record({
      action: "trade.declaration_cancelled",
      entityType: "customs_declarations",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { declarationNo: stamped.declarationNo, status: stamped.status, reason },
    });
    return stamped;
  }

  // ── THE G-65 FLOW (the completion act — D-06 VERBATIM) ───────────────

  async complete(input: {
    id: string;
    exchangeRate?: string | null;
    entryDate?: string | null;
    actorId: string | null;
  }): Promise<{
    declaration: store.DeclarationRow;
    landedCost: { id: string; costNo: string | null; journalEntryId: string | null } | null;
    totals: ReturnType<typeof computeDeclarationTotals>;
    landedAmountBase: string;
  }> {
    const declaration = await requireDeclaration(input.id, "complete");
    if (declaration.status !== "ACCEPTED") {
      throw new DeclarationStateError({
        declarationId: declaration.id,
        declarationNo: declaration.declarationNo,
        from: declaration.status,
        to: "COMPLETED",
        reason:
          declaration.status === "COMPLETED"
            ? "the declaration is already completed — the completion is exactly-once (the stamp law; the landed cost landed with the first act)"
            : "only the ACCEPTED rung completes (the customs office's acceptance precedes the duties' flow)",
      });
    }
    // THE IMPORT-RECEIPT LAW (G-65's own demand): the completion carries
    // the receipt link — the landed-cost allocation's substrate.
    if (declaration.receiptId === null) {
      throw new DeclarationStateError({
        declarationId: declaration.id,
        declarationNo: declaration.declarationNo,
        from: declaration.status,
        to: "COMPLETED",
        reason: "the declaration carries no goods-receipt link — the G-65 flow allocates over the import receipt (link the declaration to its receipt at create)",
      });
    }
    const lines = await store.listDeclarationLines(declaration.id);
    if (lines.length === 0) {
      throw new DeclarationStateError({
        declarationId: declaration.id,
        declarationNo: declaration.declarationNo,
        from: declaration.status,
        to: "COMPLETED",
        reason: "the declaration carries no lines — the duties have no source",
      });
    }
    // THE FOLD'S TOTALS (D-06 VERBATIM — sourced from the declaration's
    // OWN lines, never recomputed anywhere else).
    const totals = computeDeclarationTotals(
      lines.map((line) => ({
        customsValue: line.customsValue,
        dutyRate: line.dutyRate,
        importVat: line.importVat,
        dutyAmount: line.dutyAmount,
      })),
    );
    // THE FX RIDE (D-21's own shape): the landed-cost amount is the
    // BASE-currency figure at the act's contract rate.
    const rate = await resolveRate(declaration.currency, input.exchangeRate ?? null);
    const landedAmountBase = baseAmountAt(totals.totalLandedAmount, rate);
    // THE EXACTLY-ONCE PRE-CHECK (the 0125 unique index's caller-side
    // face — the duplicate refused BY NAME before the DB floor).
    const existing = await findLandedCostByDeclaration(declaration.id);
    if (existing !== undefined) {
      throw new DeclarationLandedCostDuplicateError({
        declarationNo: declaration.declarationNo,
        landedCostId: existing.id,
      });
    }
    // THE PURPOSE MAPPING (fail-closed until mapped — the 0122 §8 marker
    // standing; D-06's own wording).
    const mapping = await findActivePurpose("CUSTOMS_DUTY_PAYABLE");
    if (mapping === undefined) {
      throw new CustomsPurposeNotMappedError({ declarationNo: declaration.declarationNo });
    }
    // THE COMPLETION STAMP (the CAS — the exactly-once's service face:
    // the rung moves ACCEPTED → COMPLETED with completed_at in ONE
    // guarded statement; a raced completion returns undefined).
    const stamped = await store.stampDeclarationCompleted({
      id: declaration.id,
      landedCostId: null,
      landedCostNo: null,
    });
    if (stamped === undefined) {
      throw racedMove(declaration, "COMPLETED");
    }
    // THE LANDED-COST FLOW (the REAL LandedCostService — the ONLY
    // allocator, VERBATIM): the kind-customs document sourced from the
    // declaration, allocated by VALUE, charged to the purpose-mapped
    // CUSTOMS_DUTY_PAYABLE. The zero-duty completion (the declared
    // interpretation #6 at the claim site above) skips the document:
    // nothing to allocate.
    let landedCost: { id: string; costNo: string | null; journalEntryId: string | null } | null = null;
    if (new Decimal(landedAmountBase).greaterThan(0)) {
      const created = await this.landedCosts.create({
        grnId: declaration.receiptId,
        costType: "customs",
        vendorId: null,
        amount: landedAmountBase,
        allocationMethod: "VALUE",
        chargeAccountId: mapping.accountId,
        note: `Customs duties + import VAT — declaration ${declaration.declarationNo} (G-65)`,
        actorId: input.actorId,
        declarationId: declaration.id,
      });
      const posted = await this.landedCosts.post(created.id, input.actorId);
      await store.linkDeclarationLandedCost({
        id: declaration.id,
        landedCostId: created.id,
        landedCostNo: posted.costNo,
      });
      landedCost = { id: created.id, costNo: posted.costNo, journalEntryId: posted.journalEntryId };
    }
    await this.audit.record({
      action: "trade.declaration_completed",
      entityType: "customs_declarations",
      entityId: declaration.id,
      actorId: input.actorId ?? undefined,
      after: {
        declarationNo: declaration.declarationNo,
        totals,
        landedAmountBase,
        landedCost,
        exchangeRate: rate ?? null,
      },
    });
    const current = (await store.findDeclarationById(declaration.id)) ?? stamped;
    return { declaration: current, landedCost, totals, landedAmountBase };
  }

  // ── the HS registry (D-16 — the tenant-extensible starter set) ───────

  async listHsCodes(filter: { activeOnly?: boolean }) {
    return store.listHsCodes({ activeOnly: filter.activeOnly ?? true, limit: 500 });
  }

  async findHsCode(code: string) {
    const row = await store.findHsCodeByCode(code.trim());
    if (row === undefined) {
      throw new HsCodeRecordNotFoundError({ hsCode: code });
    }
    return row;
  }

  async createHsCode(input: {
    hsCode: string;
    name: string;
    nameAr: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.HsCodeRow> {
    const hsCode = input.hsCode.trim();
    if (!/^[0-9]{2,10}$/.test(hsCode)) {
      throw new HsCodeInvalidError({ field: "hsCode", reason: `2…10 digits are required (the harmonized system's own shape), got "${hsCode}"` });
    }
    for (const [field, value] of [
      ["name", input.name],
      ["nameAr", input.nameAr],
    ] as const) {
      if (value.trim().length < 2 || value.length > 160) {
        throw new HsCodeInvalidError({ field, reason: "2…160 chars are required (the bilingual name floors)" });
      }
    }
    if ((await store.findHsCodeByCode(hsCode)) !== undefined) {
      throw new HsCodeDuplicateError({ hsCode });
    }
    const row = await store.insertHsCode({
      hsCode,
      name: input.name.trim(),
      nameAr: input.nameAr.trim(),
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "trade.hs_code_created",
      entityType: "hs_code_registry",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { hsCode: row.hsCode, name: row.name },
    });
    return row;
  }

  async updateHsCode(input: {
    hsCode: string;
    attemptedCode?: string | null;
    name?: string | null;
    nameAr?: string | null;
    isActive?: boolean;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.HsCodeRow> {
    const hsCode = input.hsCode.trim();
    if (input.attemptedCode !== undefined && input.attemptedCode !== null && input.attemptedCode.trim() !== hsCode) {
      throw new HsCodeFrozenError({ hsCode, attempted: input.attemptedCode });
    }
    if ((await store.findHsCodeByCode(hsCode)) === undefined) {
      throw new HsCodeRecordNotFoundError({ hsCode });
    }
    const row = await store.updateHsCode({
      hsCode,
      name: input.name?.trim() ?? null,
      nameAr: input.nameAr?.trim() ?? null,
      isActive: input.isActive,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
    });
    if (row === undefined) {
      throw new HsCodeRecordNotFoundError({ hsCode });
    }
    await this.audit.record({
      action: "trade.hs_code_updated",
      entityType: "hs_code_registry",
      entityId: row.id,
      actorId: input.actorId ?? undefined,
      after: { hsCode: row.hsCode, isActive: row.isActive },
    });
    return row;
  }
}

// ── the private helpers ────────────────────────────────────────────────────

async function requireDeclaration(id: string, move: string): Promise<store.DeclarationRow> {
  requireUuid(id, "id");
  const declaration = await store.findDeclarationById(id);
  if (declaration === undefined) {
    throw new DeclarationRecordNotFoundError({ declarationId: id });
  }
  void move;
  return declaration;
}

function racedMove(declaration: store.DeclarationRow, to: string): DeclarationStateError {
  return new DeclarationStateError({
    declarationId: declaration.id,
    declarationNo: declaration.declarationNo,
    from: declaration.status,
    to,
    reason: "the move was raced (the register's state moved under the act — re-read and retry)",
  });
}

/** The computed declaration line (the fold's output + the line's own
 * fields — the write shape the store consumes). */
interface ComputedDeclarationLine {
  hsCode: string;
  originCountry: string | null;
  itemId: string | null;
  description: string | null;
  quantity: string | null;
  uom: string | null;
  customsValue: string;
  dutyRate: string;
  importVat: string;
  dutyAmount: string;
  note: string | null;
  noteAr: string | null;
}

/** The lines' fold + floors (shared by create and addLine — D-06
 * VERBATIM: the duty_amount is the FOLD's output, never the caller's). */
function computeLines(lines: readonly DeclarationLineInput[]): ComputedDeclarationLine[] {
  const computed: ComputedDeclarationLine[] = [];
  for (const line of lines) {
    const hsCode = line.hsCode.trim();
    if (!/^[0-9]{2,10}$/.test(hsCode)) {
      throw new DeclarationLineInvalidError({
        field: "hsCode",
        reason: `2…10 digits are required (the harmonized system's own shape), got "${hsCode}"`,
      });
    }
    if (line.originCountry !== undefined && line.originCountry !== null && !/^[A-Z]{2}$/.test(line.originCountry)) {
      throw new DeclarationLineInvalidError({
        field: "originCountry",
        reason: `an ISO-3166 alpha-2 code is required, got "${line.originCountry}"`,
      });
    }
    if (line.itemId !== undefined && line.itemId !== null) {
      requireUuid(line.itemId, "itemId");
    }
    if (line.quantity !== undefined && line.quantity !== null) {
      const quantity = new Decimal(line.quantity);
      if (!quantity.isFinite() || quantity.isNegative()) {
        throw new DeclarationLineInvalidError({
          field: "quantity",
          reason: `a non-negative decimal is required, got "${line.quantity}"`,
        });
      }
    }
    // THE FOLD (D-06 — the verdict rendered VERBATIM; the DB CHECK is
    // the authority of last resort).
    const verdict = computeLineDuty({
      customsValue: line.customsValue,
      dutyRate: line.dutyRate,
      importVat: line.importVat,
    });
    if (verdict.dutyAmount === null || verdict.reason !== null) {
      throw new DeclarationLineInvalidError({ field: "dutyRate", reason: verdict.reason ?? "the line's figures are invalid" });
    }
    computed.push({
      hsCode,
      originCountry: line.originCountry ?? null,
      itemId: line.itemId ?? null,
      description: line.description ?? null,
      quantity: line.quantity ?? null,
      uom: line.uom ?? null,
      customsValue: line.customsValue,
      dutyRate: line.dutyRate,
      importVat: line.importVat,
      dutyAmount: verdict.dutyAmount,
      note: line.note ?? null,
      noteAr: line.noteAr ?? null,
    });
  }
  return computed;
}
