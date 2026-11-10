import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as store from "../infrastructure/crm.store";
import {
  ServiceOrderInputInvalidError,
  ServiceOrderLineError,
  ServiceOrderNotFoundError,
  ServiceOrderPostingNotConfiguredError,
  ServiceOrderStateError,
} from "../domain/crm-errors";

/**
 * Service-order service (PHASE-019 T48; MASTER-PLAN §7): the job-card
 * lifecycle generalized to the crm module. A service order is field work
 * under (or outside) a service contract: DRAFT (SO- number at creation) →
 * IN_PROGRESS at approval (`reserve` holds parts via inventory reservations
 * holderType SERVICE_ORDER; `issue_immediate` defers to the posting port —
 * the `service_order:issue_parts` COGS journal) → logged hours per SERVICE
 * line → COMPLETED → INVOICED through the posting port (the ordinary sales
 * chain: SalesInvoiceService.create + POLICY_ACTOR auto-approve + post
 * in-transaction). CANCELLED is audited with NO ledger ever; an order with
 * issued parts or an invoice can never cancel — corrections are credit
 * notes (the job-card step-8 posture). Contract linkage does NOT alter any
 * journal (§7): contractId is provenance on the order + invoice rows only.
 *
 * The parts issue policy is chosen at APPROVAL (0027's service_orders has
 * no parts_issue_mode column — the DDL is binding); the persisted line
 * stamps carry it forward.
 *
 * The posting boundary is `ServiceOrderPostingPort` (implemented in
 * service-order-posting.ts and registered with `setPostingPort` — the
 * controller wires it at construction, the JobCardsController precedent);
 * until registered the two port-dependent paths fail with the typed
 * SERVICE_ORDER_POSTING_NOT_CONFIGURED.
 */

const SO_FORMAT = { prefix: "SO", format: "SO-{YYYY}-{SEQ:5}", docType: "service_order" } as const;

const DECIMAL6_RE = /^\d+(\.\d{1,6})?$/;

/**
 * The posting port. `issuePartsImmediate` runs at approval under the
 * `issue_immediate` policy (ONE COGS journal service_order:issue_parts +
 * stock moves sourced `service_order`; it stamps the per-line issue
 * linkage). `invoiceCard` runs at COMPLETED → INVOICED: it creates the
 * sales invoice through the ordinary chain (SERVICE lines as service
 * revenue lines, PARTS lines as goods lines; warehouseId under `reserve`
 * so the invoice's own post issues stock), auto-approves with the POLICY
 * actor, posts in-transaction, and MUST link `invoice_line_id` on each
 * order line inside the same transaction — the port owns the order-line ↔
 * invoice-line mapping; this service stamps the order (INVOICED) and the
 * line statuses.
 */
export interface ServiceOrderPostingPort {
  issuePartsImmediate(orderId: string, actorId: string | null): Promise<void>;
  invoiceCard(
    orderId: string,
    actorId: string | null,
  ): Promise<{
    invoiceId: string;
    invoiceNo: string | null;
    journalEntryId: string;
    cogsJournalEntryId: string | null;
  }>;
}

export interface ServiceOrderLineInput {
  /** Preserved on the DRAFT full-replace (update); ignored on create. */
  id?: string | null;
  lineType: "SERVICE" | "PARTS";
  itemId: string;
  /** PARTS only (required > 0 — the parts quantity). SERVICE lines bill the
   * estimatedHours; their stored qty is 1 (the line count — the job-card
   * LABOR convention; the input qty is ignored for SERVICE lines). */
  qty: string | null;
  /** SERVICE: the per-hour rate. PARTS: the per-unit price. NULL → 0. */
  unitPrice: string | null;
  /** SERVICE only (required > 0 — the billed quantity). */
  estimatedHours: string | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

export interface CreateServiceOrderInput {
  branchId: string;
  partnerId: string;
  /** Optional: when set it must exist + be ACTIVE (the crm store read). */
  contractId: string | null;
  warehouseId: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  lines: readonly ServiceOrderLineInput[];
}

export interface UpdateServiceOrderInput {
  note?: string | null;
  noteAr?: string | null;
  /** Full line-set replace — DRAFT only; provided line ids are preserved. */
  lines?: readonly ServiceOrderLineInput[];
  actorId: string | null;
}

/** A service-validated line (decimal strings normalized for the store). */
interface ValidatedLine {
  id: string | null;
  lineType: "SERVICE" | "PARTS";
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  estimatedHours: string | null;
  note: string | null;
}

@Injectable()
export class ServiceOrderService {
  private postingPort: ServiceOrderPostingPort | null = null;

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject — the vitest/esbuild
    // pipeline does not emit design:paramtypes (the JobCardService
    // silent-undefined precedent, the ContractService note). The token is
    // exported by AccountingModule (CrmModule imports it).
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  /** Register (or clear) the posting port (tests + the controller wiring). */
  setPostingPort(port: ServiceOrderPostingPort | null): void {
    this.postingPort = port;
  }

  private requirePostingPort(): ServiceOrderPostingPort {
    if (this.postingPort === null) {
      throw new ServiceOrderPostingNotConfiguredError(
        "the service-order posting port is not registered — issue_immediate approvals and COMPLETED→INVOICED invoicing need it (ServiceOrderService.setPostingPort)",
      );
    }
    return this.postingPort;
  }

  // -- reads -------------------------------------------------------------------

  async find(id: string) {
    const order = await store.findServiceOrderById(id);
    if (order === undefined) throw new ServiceOrderNotFoundError(id);
    return order;
  }

  async findWithLines(id: string) {
    const order = await this.find(id);
    return { ...order, lines: await store.listServiceOrderLines(id) };
  }

  async list(filter: { status?: string; contractId?: string; limit: number }) {
    return store.listServiceOrders(filter);
  }

  // -- creation (the SO- number reserves at creation — the JC pattern) ---------

  async create(input: CreateServiceOrderInput) {
    if (input.lines.length === 0) {
      throw new ServiceOrderInputInvalidError("service order must carry at least one line");
    }
    // The billing target must be a live customer-partner (the invoice path
    // re-validates through requireCustomer — this is the fail-early belt).
    const partner = await store.findPartnerForCrm(input.partnerId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new ServiceOrderInputInvalidError(`partner ${input.partnerId} does not exist in this tenant`);
    }
    if (partner.kind !== "CUSTOMER" && partner.kind !== "BOTH") {
      throw new ServiceOrderInputInvalidError(`partner ${partner.code} is ${partner.kind} — service orders bill customer partners`);
    }
    if (partner.status !== "ACTIVE") {
      throw new ServiceOrderInputInvalidError(`partner ${partner.code} is ${partner.status} and cannot receive service orders`);
    }
    // Contract linkage is provenance only (§7: it never alters a journal).
    if (input.contractId !== null) {
      const contract = await store.findContractById(input.contractId);
      if (contract === undefined) {
        throw new ServiceOrderInputInvalidError(`service contract ${input.contractId} does not exist in this tenant`);
      }
      if (contract.status !== "ACTIVE") {
        throw new ServiceOrderInputInvalidError(
          `service contract ${contract.contractNo ?? contract.id} is ${contract.status} — service orders link ACTIVE contracts only`,
        );
      }
    }
    const lines = await this.validateLines(input.lines);
    // The official SO- number reserves at creation (the JC boundary: the
    // SO- series is global per tenant-year — branchId null, periodKey the
    // creation year).
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: SO_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: SO_FORMAT.format,
      prefix: SO_FORMAT.prefix,
      year,
    });
    const created = await store.insertServiceOrder({
      branchId: input.branchId,
      orderNo: acquired.number,
      partnerId: input.partnerId,
      contractId: input.contractId,
      warehouseId: input.warehouseId,
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
    await this.numbering.bind(SO_FORMAT.docType, acquired.number, created.id);
    await this.audit.record({
      action: "crm.service_order.created",
      entityType: "service_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        orderNo: created.orderNo,
        partnerId: input.partnerId,
        contractId: input.contractId,
        lines: lines.length,
      },
    });
    return created;
  }

  // -- DRAFT edits (PUT :id — DRAFT only, the whole document) -------------------

  async update(id: string, patch: UpdateServiceOrderInput) {
    const order = await this.find(id);
    if (order.status !== "DRAFT") {
      throw new ServiceOrderStateError(
        `service order ${id} is ${order.status} — only DRAFT orders accept edits (the line set + fields)`,
      );
    }
    if (patch.lines !== undefined) {
      if (patch.lines.length === 0) {
        throw new ServiceOrderInputInvalidError("service order must carry at least one line");
      }
      const lines = await this.validateLines(patch.lines);
      for (const line of lines) {
        if (line.id === null) continue;
        const existing = await store.findServiceOrderLineById(line.id);
        if (existing === undefined || existing.orderId !== id) {
          throw new ServiceOrderLineError(`line ${line.id} does not belong to service order ${id}`);
        }
      }
      await store.replaceServiceOrderLines(
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
    await store.patchServiceOrder({
      id,
      note: patch.note ?? null,
      noteAr: patch.noteAr ?? null,
    });
    await this.audit.record({
      action: "crm.service_order.updated",
      entityType: "service_order",
      entityId: id,
      actorId: patch.actorId ?? undefined,
      after: {
        linesReplaced: patch.lines?.length ?? 0,
        fields: Object.keys(patch).filter((k) => k !== "lines" && k !== "actorId"),
      },
    });
    return this.find(id);
  }

  // -- approval (DRAFT → IN_PROGRESS) --------------------------------------------

  /**
   * The parts issue policy is an APPROVE-TIME input (0027's service_orders
   * carries no parts_issue_mode column — the DDL is binding): `reserve`
   * (the default) holds SERVICE_ORDER reservations per PARTS line, no
   * ledger; `issue_immediate` defers to the posting port — ONE COGS journal
   * (service_order:issue_parts) + stock moves at approval. The choice is
   * recorded in the approve audit's after-state; the persisted line stamps
   * (reservationId vs issueJournalId) carry it forward — invoiceCard derives
   * the invoice's with-goods posture from them.
   */
  async approve(id: string, input: { partsIssueMode: "reserve" | "issue_immediate"; actorId: string | null }) {
    const order = await this.find(id);
    if (order.status !== "DRAFT") {
      throw new ServiceOrderStateError(
        `service order ${id} is ${order.status} — only DRAFT orders approve`,
      );
    }
    if (input.partsIssueMode !== "reserve" && input.partsIssueMode !== "issue_immediate") {
      throw new ServiceOrderInputInvalidError(`parts issue mode must be reserve|issue_immediate: ${input.partsIssueMode}`);
    }
    const lines = await store.listServiceOrderLines(id);
    if (input.partsIssueMode === "issue_immediate") {
      // The parts issue + COGS journal at approval — the port owns them.
      await this.requirePostingPort().issuePartsImmediate(id, input.actorId);
    } else {
      // Default `reserve` policy: one SERVICE_ORDER-held availability hold
      // per PARTS line; NO ledger (the job-card reserve branch).
      const { ReservationService } = await import("../../inventory/application/reservation-service");
      const svc = new ReservationService(this.audit);
      for (const line of lines) {
        if (line.lineType !== "PARTS" || line.status === "VOID") continue;
        const reservation = await svc.create({
          itemId: line.itemId,
          warehouseId: order.warehouseId,
          qty: line.qty,
          // The service's TS union predates migration 0028's CHECK widening
          // ('SERVICE_ORDER' is a legal holder since 0028); the single
          // documented boundary cast at this seam — the job-card JOB_CARD
          // cast precedent.
          holderType: "SERVICE_ORDER" as "MANUAL" | "SALES_ORDER",
          holderId: id,
          expiresAt: null,
          note: `service order ${order.orderNo ?? id} line ${line.lineNo}`,
          actorId: input.actorId,
        });
        await store.patchServiceOrderLine({ id: line.id, status: "RESERVED", reservationId: reservation.id });
      }
    }
    await store.patchServiceOrder({ id, status: "IN_PROGRESS" });
    await this.audit.record({
      action: "crm.service_order.approved",
      entityType: "service_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { partsIssueMode: input.partsIssueMode, orderNo: order.orderNo },
    });
    return this.find(id);
  }

  // -- work execution (SERVICE lines log their hours) -----------------------------

  async logHours(id: string, lineId: string, input: { hours: string; actorId: string | null }) {
    const order = await this.find(id);
    if (order.status !== "IN_PROGRESS" && order.status !== "COMPLETED") {
      throw new ServiceOrderStateError(
        `service order ${id} is ${order.status} — hours log while the order is IN_PROGRESS/COMPLETED only`,
      );
    }
    if (!DECIMAL6_RE.test(input.hours) || Number(input.hours) <= 0) {
      throw new ServiceOrderInputInvalidError(`hours must be a positive decimal (≤ 6dp): ${input.hours}`);
    }
    const line = await store.findServiceOrderLineById(lineId);
    if (line === undefined || line.orderId !== id) {
      throw new ServiceOrderLineError(`service order line ${lineId} does not belong to order ${id}`);
    }
    if (line.lineType !== "SERVICE") {
      throw new ServiceOrderLineError(`line ${line.lineNo} is a ${line.lineType} line — only SERVICE lines log hours`);
    }
    if (line.status === "VOID") {
      throw new ServiceOrderLineError(`line ${line.lineNo} is VOID — removed lines log no hours`);
    }
    const loggedHours = new Decimal(line.loggedHours).plus(new Decimal(input.hours)).toFixed(6);
    await store.patchServiceOrderLine({ id: lineId, loggedHours });
    await this.audit.record({
      action: "crm.service_order.hours_logged",
      entityType: "service_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { lineId, hours: input.hours, loggedHours },
    });
    return this.find(id);
  }

  // -- completion / invoicing ------------------------------------------------------

  async complete(id: string, input: { actorId: string | null }) {
    const order = await this.find(id);
    if (order.status !== "IN_PROGRESS") {
      throw new ServiceOrderStateError(`service order ${id} is ${order.status} — only IN_PROGRESS orders complete`);
    }
    await store.patchServiceOrder({ id, status: "COMPLETED" });
    await this.audit.record({
      action: "crm.service_order.completed",
      entityType: "service_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { orderNo: order.orderNo },
    });
    return this.find(id);
  }

  async invoice(id: string, input: { actorId: string | null }) {
    const order = await this.find(id);
    if (order.status !== "COMPLETED") {
      throw new ServiceOrderStateError(`service order ${id} is ${order.status} — only COMPLETED orders invoice`);
    }
    // The port creates + posts the sales invoice through the ordinary chain
    // (SERVICE lines → SERVICE_REVENUE; PARTS lines → SALES_REVENUE + COGS
    // at issue) and links invoice_line_id on each order line in the same
    // transaction.
    const result = await this.requirePostingPort().invoiceCard(id, input.actorId);
    await store.patchServiceOrder({ id, status: "INVOICED" });
    const lines = await store.listServiceOrderLines(id);
    for (const line of lines) {
      if (line.status === "VOID") continue; // tombstoned by a DRAFT replace
      await store.patchServiceOrderLine({ id: line.id, status: "INVOICED" });
    }
    await this.audit.record({
      action: "crm.service_order.invoiced",
      entityType: "service_order",
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

  // -- cancellation (audited, no ledger — ever) --------------------------------------

  async cancel(id: string, input: { reason: string; actorId: string | null }) {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new ServiceOrderInputInvalidError("cancel requires a non-empty reason");
    }
    const order = await this.find(id);
    const lines = await store.listServiceOrderLines(id);
    if (
      order.status === "INVOICED" ||
      lines.some(
        (line) =>
          line.status === "ISSUED" || line.issueJournalId !== null || line.issueUnitCost !== null,
      )
    ) {
      throw new ServiceOrderStateError(
        `service order ${id} already has ${order.status === "INVOICED" ? "an invoice" : "issued parts"} — corrections are credit notes, never a cancel`,
      );
    }
    if (order.status !== "DRAFT" && order.status !== "IN_PROGRESS") {
      throw new ServiceOrderStateError(`service order ${id} is ${order.status} — only DRAFT/IN_PROGRESS orders cancel`);
    }
    if (order.status === "IN_PROGRESS") {
      // Release every ACTIVE SERVICE_ORDER-held reservation (approve's
      // holds); the reservation row stays linked on the line as the audit
      // trail (the job-card cancel branch).
      const { ReservationService } = await import("../../inventory/application/reservation-service");
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
      await store.patchServiceOrderLine({ id: line.id, status: "VOID" });
    }
    // ck_service_orders_cancel_requires_reason: CANCELLED rows carry
    // cancelled_at (the CASE stamp) + a non-NULL cancel_reason — the
    // dedicated column (job cards emulated this on note).
    await store.patchServiceOrder({ id, status: "CANCELLED", cancelReason: reason });
    await this.audit.record({
      action: "crm.service_order.cancelled",
      entityType: "service_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { reason, orderNo: order.orderNo },
    });
    return this.find(id);
  }

  // -- line validation (shared by create + the DRAFT full-replace) ------------------

  private async validateLines(lines: readonly ServiceOrderLineInput[]): Promise<ValidatedLine[]> {
    const validated: ValidatedLine[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      const position = index + 1;
      const item = await store.findItemForCrm(line.itemId);
      if (item === undefined || item.deletedAt !== null) {
        throw new ServiceOrderLineError(`line ${position}: item ${line.itemId} does not exist in this tenant`);
      }
      if (item.status !== "ACTIVE") {
        throw new ServiceOrderLineError(`line ${position}: item ${item.sku} is ${item.status} and cannot go on a service order`);
      }
      const unitPrice = line.unitPrice ?? "0";
      if (!DECIMAL6_RE.test(unitPrice) || Number(unitPrice) < 0) {
        throw new ServiceOrderLineError(
          `line ${position}: unit price must be a non-negative decimal (≤ 6dp): ${String(line.unitPrice)}`,
        );
      }
      let estimatedHours: string | null = null;
      let qty: string;
      if (line.lineType === "PARTS") {
        if (item.kind !== "STOCK") {
          throw new ServiceOrderLineError(`line ${position}: PARTS lines reference STOCK items — ${item.sku} is ${item.kind}`);
        }
        const partsQty = line.qty ?? null;
        if (partsQty === null || !DECIMAL6_RE.test(partsQty) || Number(partsQty) <= 0) {
          throw new ServiceOrderLineError(
            `line ${position}: PARTS lines require qty > 0 (the parts quantity; ≤ 6dp): ${String(line.qty)}`,
          );
        }
        qty = new Decimal(partsQty).toFixed(6);
      } else {
        if (item.kind !== "SERVICE") {
          throw new ServiceOrderLineError(`line ${position}: SERVICE lines reference SERVICE items — ${item.sku} is ${item.kind}`);
        }
        const hours = line.estimatedHours ?? null;
        if (hours === null || !DECIMAL6_RE.test(hours) || Number(hours) <= 0) {
          throw new ServiceOrderLineError(
            `line ${position}: SERVICE lines require estimatedHours > 0 (the billed quantity; ≤ 6dp): ${String(line.estimatedHours)}`,
          );
        }
        estimatedHours = new Decimal(hours).toFixed(6);
        // The line count (billing rides estimatedHours — the job-card LABOR
        // convention); the DDL CHECK needs qty > 0 on every line.
        qty = "1.000000";
      }
      validated.push({
        id: line.id ?? null,
        lineType: line.lineType,
        itemId: line.itemId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty,
        unitPrice: new Decimal(unitPrice).toFixed(6),
        estimatedHours,
        note: line.note,
      });
    }
    return validated;
  }
}
