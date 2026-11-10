import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../../audit/api/audit";
import { NumberingService } from "../../../accounting/application/numbering-service";
import { ownTenantBaseCurrency } from "../../../../infra/settings/setting-reader";
import { QuotationService, type QuotationLineInput } from "../../application/quotations";
import type { QuotationRow } from "../../infrastructure/sales.store";
import * as store from "../../infrastructure/job-cards.store";
import {
  JobCardInputInvalidError,
  JobCardLineError,
  JobCardNotFoundError,
  JobCardNotCancelableError,
  JobCardPostingNotConfiguredError,
  JobCardStateError,
} from "../domain/job-card-errors";

/**
 * Job-card service (PHASE-017 T3; industry-workflows.md (b)): the workshop
 * work order as a SALES-module document — check-in (DRAFT, JC- number at
 * creation) → diagnosis quotation (BR-006, no ledger) → customer approval
 * (IN_PROGRESS; `reserve` holds parts via inventory reservations with
 * holder JOB_CARD, `issue_immediate` defers to the T4 posting port) →
 * labor hours logged per line as billing data → completion → invoice
 * (delegates to the T4 posting port). CANCELLED is audited with NO ledger
 * ever; a card with issued parts or an invoice can never cancel —
 * corrections are credit notes (step 8).
 *
 * The T4 posting boundary is `JobCardPostingPort` (implemented by 4-a and
 * registered with `setPostingPort`); until then the two port-dependent
 * paths fail with the typed `sales/job-card-posting-not-configured`.
 */

const JC_FORMAT = { prefix: "JC", format: "JC-{YYYY}-{SEQ:5}", docType: "job_card" } as const;

const DECIMAL6_RE = /^\d+(\.\d{1,6})?$/;
const DECIMAL4_RE = /^\d+(\.\d{1,4})?$/;

/**
 * The T4 posting port. `issuePartsImmediate` runs at approval under the
 * `issue_immediate` policy (COGS journal + stock move referencing the
 * card; it stamps the per-line issue linkage). `invoiceCard` runs at
 * COMPLETED → INVOICED: it creates the sales invoice (parts + labor, two
 * revenue natures), posts the revenue journal (+ COGS journal under
 * `reserve`), and MUST link `invoice_line_id` on each card line inside
 * the same transaction — the port owns the card-line ↔ invoice-line
 * mapping; this service stamps the card (INVOICED, invoiced_at,
 * invoice_id) and the line statuses.
 */
export interface JobCardPostingPort {
  issuePartsImmediate(cardId: string, actorId: string | null): Promise<void>;
  invoiceCard(
    cardId: string,
    actorId: string | null,
  ): Promise<{
    invoiceId: string;
    invoiceNo: string | null;
    journalEntryId: string;
    cogsJournalEntryId: string | null;
  }>;
}

export interface JobCardLineInput {
  /** Preserved on the DRAFT full-replace (update); ignored on create. */
  id?: string | null;
  lineType: "PARTS" | "LABOR";
  itemId: string;
  /** PARTS: the parts quantity. LABOR: the line count (billing rides estimatedHours). */
  qty: string;
  /** PARTS: per-unit price. LABOR: PER-HOUR rate. NULL → 0. */
  unitPrice: string | null;
  /** LABOR only: the billed quantity — required > 0 on LABOR lines. */
  estimatedHours: string | null;
  discountAmount: string | null;
  taxCodeId: string | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

export interface CreateJobCardInput {
  branchId: string;
  customerId: string;
  vehicleId: string | null;
  warehouseId: string;
  partsIssueMode: "reserve" | "issue_immediate";
  complaints: string | null;
  complaintsAr: string | null;
  odometerKm: string | null;
  checkedInAt: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  lines: readonly JobCardLineInput[];
}

export interface UpdateJobCardInput {
  complaints?: string | null;
  complaintsAr?: string | null;
  diagnosis?: string | null;
  diagnosisAr?: string | null;
  note?: string | null;
  noteAr?: string | null;
  odometerKm?: string | null;
  /** Full line-set replace — DRAFT only; provided line ids are preserved. */
  lines?: readonly JobCardLineInput[];
  actorId: string | null;
}

/** A service-validated line (decimal strings normalized for the store). */
interface ValidatedLine {
  id: string | null;
  lineType: "PARTS" | "LABOR";
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  estimatedHours: string | null;
  discountAmount: string;
  taxCodeId: string | null;
  note: string | null;
}

@Injectable()
export class JobCardService {
  private postingPort: JobCardPostingPort | null = null;

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * The diagnosis quotation is generated through the real
   * QuotationService (BR-006) — instantiated directly like orders.ts
   * instantiates ReservationService (same-module dependency, no DI graph
   * change); stateless, so one lazily-created instance is enough.
   */
  private quotationService: QuotationService | null = null;
  private quotations(): QuotationService {
    if (this.quotationService === null) {
      this.quotationService = new QuotationService(this.audit, this.numbering);
    }
    return this.quotationService;
  }

  /** Register (or clear) the T4 posting port (tests and 4-a wiring). */
  setPostingPort(port: JobCardPostingPort | null): void {
    this.postingPort = port;
  }

  private requirePostingPort(): JobCardPostingPort {
    if (this.postingPort === null) {
      throw new JobCardPostingNotConfiguredError(
        "the job-card posting port (T4) is not registered — issue_immediate approvals and COMPLETED→INVOICED invoicing need it (JobCardService.setPostingPort)",
      );
    }
    return this.postingPort;
  }

  // -- reads -------------------------------------------------------------------

  async find(id: string) {
    const card = await store.findJobCardById(id);
    if (card === undefined) throw new JobCardNotFoundError(id);
    return card;
  }

  async findWithLines(id: string) {
    const card = await this.find(id);
    return { ...card, lines: await store.listJobCardLines(id) };
  }

  async list(filter: { status?: string; customerId?: string; vehicleId?: string; limit: number }) {
    return store.listJobCards(filter);
  }

  // -- check-in (workflow (b) step 1) --------------------------------------------

  async create(input: CreateJobCardInput) {
    if (input.lines.length === 0) {
      throw new JobCardInputInvalidError("job card must carry at least one line");
    }
    const lines = await this.validateLines(input.lines);
    if (input.partsIssueMode !== "reserve" && input.partsIssueMode !== "issue_immediate") {
      throw new JobCardInputInvalidError(`parts issue mode must be reserve|issue_immediate: ${input.partsIssueMode}`);
    }
    if (input.odometerKm !== null && (!DECIMAL6_RE.test(input.odometerKm) || Number(input.odometerKm) < 0)) {
      throw new JobCardInputInvalidError(`odometer must be a non-negative decimal (≤ 6dp): ${input.odometerKm}`);
    }
    // The official JC- number reserves at creation (BR-029 boundary; the
    // JC- series is global per tenant-year — branchId null, periodKey the
    // creation year).
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: JC_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: JC_FORMAT.format,
      prefix: JC_FORMAT.prefix,
      year,
    });
    const created = await store.insertJobCard({
      branchId: input.branchId,
      cardNo: acquired.number,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      partsIssueMode: input.partsIssueMode,
      warehouseId: input.warehouseId,
      complaints: input.complaints,
      complaintsAr: input.complaintsAr,
      diagnosis: null,
      diagnosisAr: null,
      odometerKm:
        input.odometerKm === null
          ? null
          : new Decimal(input.odometerKm).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1),
      checkedInAt: input.checkedInAt,
      laborHoursTotal: "0",
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      lines: lines.map((line) => ({
        ...line,
        loggedHours: "0",
        status: "PENDING",
        reservationId: null,
      })),
    });
    await this.numbering.bind(JC_FORMAT.docType, acquired.number, created.id);
    await this.audit.record({
      action: "sales.job_card.created",
      entityType: "job_card",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        cardNo: created.cardNo,
        customerId: input.customerId,
        partsIssueMode: input.partsIssueMode,
        lines: lines.length,
      },
    });
    return created;
  }

  // -- diagnosis edits (step 2) ---------------------------------------------------

  async update(id: string, patch: UpdateJobCardInput) {
    const card = await this.find(id);
    if (card.status !== "DRAFT" && card.status !== "IN_PROGRESS") {
      throw new JobCardStateError(
        `job card ${id} is ${card.status} — only DRAFT/IN_PROGRESS cards accept diagnosis edits`,
      );
    }
    if (patch.lines !== undefined) {
      if (card.status !== "DRAFT") {
        throw new JobCardStateError(
          `job card ${id} is ${card.status} — the line set can only be replaced on a DRAFT card`,
        );
      }
      if (patch.lines.length === 0) {
        throw new JobCardInputInvalidError("job card must carry at least one line");
      }
      const lines = await this.validateLines(patch.lines);
      for (const line of lines) {
        if (line.id === null) continue;
        const existing = await store.findJobCardLineById(line.id);
        if (existing === undefined || existing.jobCardId !== id) {
          throw new JobCardLineError(`line ${line.id} does not belong to job card ${id}`);
        }
      }
      await store.replaceJobCardLines(
        id,
        lines.map((line) => ({
          ...line,
          loggedHours: "0",
          status: "PENDING",
          reservationId: null,
          createdBy: patch.actorId,
        })),
      );
    }
    await store.patchJobCard({
      id,
      complaints: patch.complaints ?? null,
      complaintsAr: patch.complaintsAr ?? null,
      diagnosis: patch.diagnosis ?? null,
      diagnosisAr: patch.diagnosisAr ?? null,
      note: patch.note ?? null,
      noteAr: patch.noteAr ?? null,
      odometerKm:
        patch.odometerKm === undefined || patch.odometerKm === null
          ? null
          : new Decimal(patch.odometerKm).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1),
    });
    await this.audit.record({
      action: "sales.job_card.updated",
      entityType: "job_card",
      entityId: id,
      actorId: patch.actorId ?? undefined,
      after: { linesReplaced: patch.lines?.length ?? 0, fields: Object.keys(patch).filter((k) => k !== "lines" && k !== "actorId") },
    });
    return this.find(id);
  }

  // -- diagnosis quotation (step 3; BR-006) ----------------------------------------

  async generateQuotation(id: string, input: { actorId: string | null }): Promise<QuotationRow> {
    const card = await this.find(id);
    if (card.status !== "DRAFT" && card.status !== "IN_PROGRESS") {
      throw new JobCardStateError(
        `job card ${id} is ${card.status} — quotations generate from DRAFT/IN_PROGRESS cards (the diagnosis step)`,
      );
    }
    const lines = await store.listJobCardLines(id);
    const live = lines.filter((line) => line.status !== "CANCELLED");
    if (live.length === 0) {
      throw new JobCardInputInvalidError(`job card ${id} has no live lines to quote`);
    }
    const quoteLines: QuotationLineInput[] = live.map((line) => {
      const base = {
        itemId: line.itemId,
        discountAmount: line.discountAmount,
        taxCodeId: line.taxCodeId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        note: line.note,
      };
      if (line.lineType === "PARTS") {
        // PARTS: billed as qty × unit price.
        return { ...base, qty: line.qty, unitPrice: line.unitPrice } satisfies QuotationLineInput;
      }
      // LABOR: the billed quantity is the estimated hours; the unit price
      // is the per-hour rate (workflow (b) step 2).
      const hours = line.estimatedHours ?? null;
      if (hours === null || Number(hours) <= 0) {
        throw new JobCardLineError(`LABOR line ${line.lineNo} of card ${id} has no estimated hours to quote`);
      }
      return { ...base, qty: hours, unitPrice: line.unitPrice } satisfies QuotationLineInput;
    });
    const quotation = await this.quotations().create({
      branchId: card.branchId,
      customerId: card.customerId,
      salesRepId: null,
      quoteDate: new Date().toISOString().slice(0, 10),
      validUntil: null,
      currencyCode: await ownTenantBaseCurrency(),
      exchangeRate: null,
      note: card.note,
      noteAr: card.noteAr,
      actorId: input.actorId,
      lines: quoteLines,
    });
    await store.patchJobCard({ id, quotationId: quotation.id });
    await this.audit.record({
      action: "sales.job_card.quotation_generated",
      entityType: "job_card",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { quotationId: quotation.id, totalNet: quotation.totalNet },
    });
    return quotation;
  }

  // -- customer approval (step 4) ---------------------------------------------------

  async approve(id: string, input: { actorId: string | null }) {
    const card = await this.find(id);
    if (card.status !== "DRAFT") {
      throw new JobCardStateError(
        `job card ${id} is ${card.status} — only DRAFT cards approve (customer approval, workflow (b) step 4)`,
      );
    }
    const lines = await store.listJobCardLines(id);
    if (card.partsIssueMode === "issue_immediate") {
      // COGS journal + stock move at issue — the T4 port owns them.
      await this.requirePostingPort().issuePartsImmediate(id, input.actorId);
    } else {
      // Default `reserve` policy: one JOB_CARD-held availability hold per
      // PARTS line; NO ledger (workflow (b) step 4 reserve branch).
      const { ReservationService } = await import("../../../inventory/application/reservation-service");
      const svc = new ReservationService(this.audit);
      for (const line of lines) {
        if (line.lineType !== "PARTS" || line.status === "CANCELLED") continue;
        const reservation = await svc.create({
          itemId: line.itemId,
          warehouseId: card.warehouseId,
          qty: line.qty,
          // JOB_CARD_HOLDER — the service's TS union predates migration
          // 0025's CHECK widening ('JOB_CARD' is a legal holder since
          // 0025); the single documented boundary cast at this seam.
          holderType: "JOB_CARD" as "MANUAL" | "SALES_ORDER",
          holderId: id,
          expiresAt: null,
          note: `job card ${card.cardNo ?? id} line ${line.lineNo}`,
          actorId: input.actorId,
        });
        await store.patchJobCardLine({ id: line.id, status: "RESERVED", reservationId: reservation.id });
      }
    }
    await store.patchJobCard({ id, status: "IN_PROGRESS" });
    await this.audit.record({
      action: "sales.job_card.approved",
      entityType: "job_card",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { partsIssueMode: card.partsIssueMode, cardNo: card.cardNo },
    });
    return this.find(id);
  }

  // -- work execution (step 5) ------------------------------------------------------

  async logHours(id: string, lineId: string, input: { hours: string; actorId: string | null }) {
    const card = await this.find(id);
    if (card.status !== "IN_PROGRESS" && card.status !== "COMPLETED") {
      throw new JobCardStateError(
        `job card ${id} is ${card.status} — hours log while the card is IN_PROGRESS/COMPLETED only`,
      );
    }
    if (!DECIMAL6_RE.test(input.hours) || Number(input.hours) <= 0) {
      throw new JobCardInputInvalidError(`hours must be a positive decimal (≤ 6dp): ${input.hours}`);
    }
    const line = await store.findJobCardLineById(lineId);
    if (line === undefined || line.jobCardId !== id) {
      throw new JobCardLineError(`job card line ${lineId} does not belong to card ${id}`);
    }
    if (line.lineType !== "LABOR") {
      throw new JobCardLineError(`line ${line.lineNo} is a ${line.lineType} line — only LABOR lines log hours`);
    }
    if (line.status === "CANCELLED") {
      throw new JobCardLineError(`line ${line.lineNo} is CANCELLED — removed lines log no hours`);
    }
    const loggedHours = new Decimal(line.loggedHours).plus(new Decimal(input.hours)).toFixed(6);
    await store.patchJobCardLine({ id: lineId, loggedHours });
    // Recompute the card total from the persisted LIVE lines — the single
    // source of truth (never a client-supplied running total; tombstoned
    // lines from a DRAFT full-replace never count).
    const lines = await store.listJobCardLines(id);
    let total = new Decimal(0);
    for (const row of lines) {
      if (row.lineType === "LABOR" && row.status !== "CANCELLED") {
        total = total.plus(new Decimal(row.loggedHours));
      }
    }
    const laborHoursTotal = total.toFixed(6);
    await store.patchJobCard({ id, laborHoursTotal });
    await this.audit.record({
      action: "sales.job_card.hours_logged",
      entityType: "job_card",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { lineId, hours: input.hours, loggedHours, laborHoursTotal },
    });
    return this.find(id);
  }

  // -- completion / invoicing (step 6) -----------------------------------------------

  async complete(id: string, input: { actorId: string | null }) {
    const card = await this.find(id);
    if (card.status !== "IN_PROGRESS") {
      throw new JobCardStateError(`job card ${id} is ${card.status} — only IN_PROGRESS cards complete`);
    }
    await store.patchJobCard({ id, status: "COMPLETED" });
    await this.audit.record({
      action: "sales.job_card.completed",
      entityType: "job_card",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { cardNo: card.cardNo },
    });
    return this.find(id);
  }

  async invoice(id: string, input: { actorId: string | null }) {
    const card = await this.find(id);
    if (card.status !== "COMPLETED") {
      throw new JobCardStateError(
        `job card ${id} is ${card.status} — only COMPLETED cards invoice (workflow (b) step 6)`,
      );
    }
    // The port creates + posts the sales invoice (parts + labor revenue
    // natures, VAT per treatment, COGS under `reserve`) and links
    // invoice_line_id on each card line in the same transaction.
    const result = await this.requirePostingPort().invoiceCard(id, input.actorId);
    await store.patchJobCard({ id, status: "INVOICED", invoiceId: result.invoiceId });
    const lines = await store.listJobCardLines(id);
    for (const line of lines) {
      if (line.status === "CANCELLED") continue; // tombstoned by a DRAFT replace
      await store.patchJobCardLine({ id: line.id, status: "INVOICED" });
    }
    await this.audit.record({
      action: "sales.job_card.invoiced",
      entityType: "job_card",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        invoiceId: result.invoiceId,
        invoiceNo: result.invoiceNo,
        journalEntryId: result.journalEntryId,
        cogsJournalEntryId: result.cogsJournalEntryId,
      },
    });
    return this.find(id);
  }

  // -- cancellation (audited, no ledger — ever) ----------------------------------------

  async cancel(id: string, input: { reason: string; actorId: string | null }) {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new JobCardInputInvalidError("cancel requires a non-empty reason");
    }
    const card = await this.find(id);
    const lines = await store.listJobCardLines(id);
    if (
      card.invoiceId !== null ||
      lines.some(
        (line) =>
          line.status === "ISSUED" || line.issueJournalId !== null || line.issueUnitCost !== null,
      )
    ) {
      throw new JobCardNotCancelableError(
        `job card ${id} already has ${card.invoiceId !== null ? "an invoice" : "issued parts"} — corrections are credit notes (workflow (b) step 8), never a cancel`,
      );
    }
    if (card.status !== "DRAFT" && card.status !== "IN_PROGRESS") {
      throw new JobCardStateError(`job card ${id} is ${card.status} — only DRAFT/IN_PROGRESS cards cancel`);
    }
    if (card.status === "IN_PROGRESS") {
      // Release every active JOB_CARD-held reservation (approve's holds);
      // the reservation row stays linked on the line as the audit trail.
      const { ReservationService } = await import("../../../inventory/application/reservation-service");
      const svc = new ReservationService(this.audit);
      for (const line of lines) {
        if (line.reservationId === null) continue;
        const reservation = await svc.find(line.reservationId);
        if (reservation.status === "ACTIVE") {
          await svc.release(line.reservationId, input.actorId);
        }
      }
    }
    for (const line of lines) {
      await store.patchJobCardLine({ id: line.id, status: "CANCELLED" });
    }
    // ck_job_cards_cancel_requires_reason: CANCELLED rows carry
    // cancelled_at (the CASE stamp) and a non-NULL note — the reason is
    // recorded on note (no dedicated column exists).
    await store.patchJobCard({ id, status: "CANCELLED", note: reason });
    await this.audit.record({
      action: "sales.job_card.cancelled",
      entityType: "job_card",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { reason, cardNo: card.cardNo },
    });
    return this.find(id);
  }

  // -- line validation (shared by create + the DRAFT full-replace) ---------------------

  private async validateLines(lines: readonly JobCardLineInput[]): Promise<ValidatedLine[]> {
    const itemsStore = await import("../../../items/infrastructure/items.store");
    const validated: ValidatedLine[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const position = index + 1;
      const item = await itemsStore.findItemById(line.itemId);
      if (item === undefined || item.deletedAt !== null) {
        throw new JobCardLineError(`line ${position}: item ${line.itemId} does not exist in this tenant`);
      }
      if (item.status !== "ACTIVE") {
        throw new JobCardLineError(`line ${position}: item ${item.sku} is ${item.status} and cannot go on a job card`);
      }
      if (!DECIMAL6_RE.test(line.qty) || Number(line.qty) <= 0) {
        throw new JobCardLineError(`line ${position}: qty must be a positive decimal (≤ 6dp): ${line.qty}`);
      }
      const unitPrice = line.unitPrice ?? "0";
      if (!DECIMAL6_RE.test(unitPrice) || Number(unitPrice) < 0) {
        throw new JobCardLineError(
          `line ${position}: unit price must be a non-negative decimal (≤ 6dp): ${String(line.unitPrice)}`,
        );
      }
      const discount = line.discountAmount ?? "0";
      if (!DECIMAL4_RE.test(discount) || Number(discount) < 0) {
        throw new JobCardLineError(
          `line ${position}: discount must be a non-negative decimal (≤ 4dp): ${String(line.discountAmount)}`,
        );
      }
      let estimatedHours: string | null = null;
      if (line.lineType === "PARTS") {
        if (item.kind !== "STOCK") {
          throw new JobCardLineError(`line ${position}: PARTS lines reference STOCK items — ${item.sku} is ${item.kind}`);
        }
      } else {
        if (item.kind !== "SERVICE") {
          throw new JobCardLineError(`line ${position}: LABOR lines reference SERVICE items — ${item.sku} is ${item.kind}`);
        }
        const hours = line.estimatedHours ?? null;
        if (hours === null || !DECIMAL6_RE.test(hours) || Number(hours) <= 0) {
          throw new JobCardLineError(
            `line ${position}: LABOR lines require estimatedHours > 0 (the billed quantity; ≤ 6dp): ${String(line.estimatedHours)}`,
          );
        }
        estimatedHours = new Decimal(hours).toFixed(6);
      }
      validated.push({
        id: line.id ?? null,
        lineType: line.lineType,
        itemId: line.itemId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(unitPrice).toFixed(6),
        estimatedHours,
        discountAmount: new Decimal(discount).toFixed(4),
        taxCodeId: line.taxCodeId,
        note: line.note,
      });
    }
    return validated;
  }
}
