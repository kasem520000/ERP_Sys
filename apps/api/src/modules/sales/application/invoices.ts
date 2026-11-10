import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { recordDocumentTaxSummary } from "../../tax/application/posting-adapter";
import {
  planIssue,
  applyIssue,
  resolveInventoryAccount,
  stagePendingOverlay,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/sales.store";
import {
  DeliveryAlreadyInvoicedError,
  DeliveryNoteNotFoundError,
  EmptyDocumentError,
  InvoiceLineInvalidError,
  SalesDocumentStateError,
  SalesInvoiceNotFoundError,
} from "../domain/sales-errors";
import { requireCustomer, requireSellableItem } from "./quotations";
import { resolveOutputTaxLines, type SalesTaxLine } from "./tax-lines";
import { salesLineNetAmount, PRICE_RE } from "./pricing";
import { enforceAtApproval, runCreditCheck } from "./credit-limits";
import { assertClaimRefCapture, normalizeClaimRef } from "./invoice-claim-ref";

/**
 * Sales-invoice service (PHASE-012 T5/T6; POSTING_ENGINE §4/§5; goldens
 * G-01/G-02/G-03; W-1): cash + credit kinds posting through the engine —
 *
 *   G-01 credit: DR AR_CONTROL (partner) · CR SALES_REVENUE · CR VAT_PAYABLE
 *   G-02 cash:   DR cash/bank · CR revenue · CR VAT_PAYABLE
 *                (+ the treasury cash_movements row — INV-019)
 *   G-03 COGS (with-goods, flow B): DR COGS · CR INVENTORY at issue cost
 *
 * Sequencing per §5 — ONE transaction: planIssues → COGS post
 * (sales_invoice:cogs) → applyIssues → tax stamp (INV-012 OUTPUT) →
 * AR/cash post (sales_invoice:post) → subledger (the posting service's
 * partner-subledger port, INV-009 from entry #1) → SAL- number → audit.
 *
 * BR-001: credit limits enforce at APPROVAL (server-side, all three
 * postures, override via sales.credit_check.override audited) and
 * RE-VERIFY at post (no TOCTOU gap). BR-005: cash invoices may auto-post
 * on save per sales.cash_autopost (approved_by = the POLICY_ACTOR sentinel,
 * recorded distinctly from posted_by). BR-033: tax snapshots stamp per
 * line at create; posting re-resolves deterministically and REFUSES a
 * mismatch (never silently recomputes).
 */

const SAL_FORMAT = { prefix: "SAL", format: "SAL-{YYYY}-{SEQ:6}", docType: "sales_invoice" };

/** BR-005: the policy-driven approval actor sentinel (never a real user). */
export const POLICY_ACTOR_ID = "00000000-0000-0000-0000-000000000505";

const QTY_RE = /^\d+(\.\d{1,6})?$/;

export interface InvoiceLineInput {
  itemId: string | null;
  accountId: string | null;
  deliveryLineId: string | null;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string | null;
  taxCodeId: string | null;
  batchId: string | null;
  serialIds: string[] | null;
  /** PHASE-017 (0025): BR-008 zero-price FOC lines carry their reason code
   * (persisted to sales_invoice_lines.foc_reason_code); null otherwise. */
  focReasonCode?: string | null;
  note: string | null;
}

@Injectable()
export class SalesInvoiceService {
  /**
   * PHASE-019 (§11): the contract-billing port — wired by the CrmModule
   * constructor (the JobCardsController port-wiring precedent; avoids
   * circular module imports). `validateContract` replaces the raw
   * existence read for contractId when set; `onContractInvoicePosted`
   * fires the advance release after a successful post of a contract-linked
   * invoice, inside the same posting UoW. Null by default (no crm wiring).
   */
  private contractBillingPort: {
    validateContract(contractId: string): Promise<boolean>;
    onContractInvoicePosted(
      contractId: string,
      invoiceId: string,
      actorId: string | null,
    ): Promise<void>;
  } | null = null;

  setContractBillingPort(port: {
    validateContract(contractId: string): Promise<boolean>;
    onContractInvoicePosted(
      contractId: string,
      invoiceId: string,
      actorId: string | null,
    ): Promise<void>;
  } | null): void {
    this.contractBillingPort = port;
  }

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // NOTE: every param carries an explicit @Inject — the vitest/esbuild
    // pipeline does not emit design:paramtypes (the JobCardService
    // silent-undefined precedent, the ContractService note). PHASE-019 T48
    // surfaced this: HTTP row 44 (the service-order invoice) was the first
    // AppModule-constructed drive of invoices.create — the bare params
    // resolved undefined (resolver.resolveOne TypeError). PostingService +
    // NumberingService are exported by AccountingModule; TaxResolverService
    // by TaxModule (both imported by SalesModule).
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(TaxResolverService) private readonly resolver: TaxResolverService,
  ) {}

  async list(filter: {
    status?: string;
    customerId?: string;
    orderId?: string;
    kind?: string;
    limit: number;
  }) {
    return store.listSalesInvoices(filter);
  }

  async find(id: string) {
    const invoice = await store.findSalesInvoiceById(id);
    if (invoice === undefined) throw new SalesInvoiceNotFoundError(id);
    return invoice;
  }

  async findWithLines(id: string) {
    const invoice = await this.find(id);
    return { ...invoice, lines: await store.listSalesInvoiceLines(id) };
  }

  /**
   * Create a DRAFT invoice. Flow A (delivery_then_invoice): deliveryId +
   * per-line deliveryLineId; stock/COGS already posted by the DN — the
   * issue snapshots copy over (the W-3 provenance). Flow B
   * (invoice_then_delivery, with-goods): warehouseId; stock issues + COGS
   * post at the invoice itself. CASH invoices carry a cashAccountId.
   */
  async create(input: {
    branchId: string;
    customerId: string;
    salesRepId: string | null;
    kind: "CASH" | "CREDIT";
    invoiceDate: string;
    dueDate: string | null;
    currencyCode: string;
    exchangeRate: string | null;
    orderId: string | null;
    deliveryId: string | null;
    warehouseId: string | null;
    cashAccountId: string | null;
    /** PHASE-017 (0025): the originating job card (existence-validated
     * below) + the vehicle the work was done on (provenance columns). */
    jobCardId?: string | null;
    vehicleId?: string | null;
    /** PHASE-019 (0027): the service-billing provenance trio. projectId is
     * existence+OPEN-validated below (accounting store is importable);
     * contractId goes through the contract-billing port when wired (else
     * the raw existence read); serviceOrderId is crm-side validated before
     * the call and trusted at the boundary (documented §11) with a raw
     * existence probe as the backstop. */
    contractId?: string | null;
    serviceOrderId?: string | null;
    projectId?: string | null;
    /** PHASE-031 (0042 — the healthcare claim-ref light extension, ED-07):
     *  `insured` is the request-scoped payer selection (the UI's patient /
     *  insurer picker — insurance billing selected); `claimRef` is the
     *  external insurer claim reference (مطالبة تأمينية, varchar(64), never
     *  a document number per ADR-0006). A claimRef-carrying invoice is a
     *  claim invoice billed to the insurance-company partner; a null one is
     *  self-pay (دفع مباشر) billed to the patient. With the
     *  sales.claim_ref_required_for_insured policy resolved true (platform
     *  default; L5 may relax), insured invoices cannot save without their
     *  claim ref — the typed CLAIM_REF_REQUIRED error (capture behavior
     *  ONLY, never posting; INV-022). */
    insured?: boolean;
    claimRef?: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly InvoiceLineInput[];
    /** PHASE-016 (T5): POS channel context — a POS sale IS a sales invoice
     * (channel='POS'); the pos-channel service is the only caller that
     * sets this. Client id keeps the offline sync exactly-once (INV-013). */
    pos?: {
      clientId?: string;
      terminalId: string;
      orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "COUNTER";
      tableId?: string | null;
      offlineReceiptNo?: string | null;
      tenders?: readonly store.PosTender[] | null;
    };
  }): Promise<store.SalesInvoiceRow> {
    if (input.lines.length === 0) throw new EmptyDocumentError("sales invoice");
    const customer = await requireCustomer(input.customerId);
    const base = await ownTenantBaseCurrency();
    // PHASE-031 T4 — the claim-ref capture (policy-gated, validated BEFORE
    // the insert so every failure path leaves zero residue): the payer
    // selection + the normalized claim reference against the resolved
    // sales.claim_ref_required_for_insured setting (platform default true;
    // the healthcare manifest ships the same true as its L1 default; an
    // explicit L5 row may relax it — toggling changes only capture).
    const claimRef = normalizeClaimRef(input.claimRef ?? null);
    assertClaimRefCapture({
      insured: input.insured === true,
      claimRef,
      required: (await store.readSetting<boolean>("sales.claim_ref_required_for_insured")) ?? true,
    });
    if (input.currencyCode !== base && (input.exchangeRate === null || Number(input.exchangeRate) <= 0)) {
      throw new InvoiceLineInvalidError(
        `invoice in ${input.currencyCode} requires a positive exchange rate (base ${base})`,
      );
    }
    if (input.deliveryId !== null && input.warehouseId !== null) {
      throw new InvoiceLineInvalidError(
        "an invoice references either a delivery (flow A) or issues stock itself (flow B) — not both (BR-007)",
      );
    }
    if (input.kind === "CASH" && input.cashAccountId === null) {
      throw new InvoiceLineInvalidError("cash invoices require cashAccountId (the G-02 DR leg)");
    }
    if (input.kind === "CASH" && input.currencyCode !== base) {
      throw new InvoiceLineInvalidError(
        "cash invoices settle in the base currency at the counter — foreign-currency cash invoices belong to the credit + receipt flow (W-2)",
      );
    }

    // Cash account validation (A7 + active check).
    if (input.cashAccountId !== null) {
      const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
      const account = await treasuryStore.findCashAccountById(input.cashAccountId);
      if (account === undefined) {
        throw new InvoiceLineInvalidError(`cash account ${input.cashAccountId} does not exist in this tenant`);
      }
      if (account.status !== "ACTIVE") {
        throw new SalesDocumentStateError(
          `cash account ${account.name} is ${account.status} and cannot receive counter receipts`,
        );
      }
    }

    // PHASE-017 T4: the job-card provenance pair — existence of the card
    // is the only validation (no FK beyond that; the port is the sole
    // caller passing these and it just read the card row).
    if (input.jobCardId !== null && input.jobCardId !== undefined) {
      const jobCardsStore = await import("../infrastructure/job-cards.store");
      const card = await jobCardsStore.findJobCardById(input.jobCardId);
      if (card === undefined) {
        throw new InvoiceLineInvalidError(
          `job card ${input.jobCardId} does not exist in this tenant — the invoice cannot claim its provenance`,
        );
      }
    }

    // PHASE-019 (§11): the service-billing provenance trio — existence
    // probes BEFORE the insert (the composite FKs guarantee shape; these
    // give the typed errors). The project must additionally be OPEN (a
    // CLOSED project rejects NEW stamps — the engine re-validates every
    // stamped line at post).
    if (input.projectId !== null && input.projectId !== undefined) {
      const accountingStore = await import("../../accounting/infrastructure/accounting.store");
      const project = await accountingStore.findProjectById(input.projectId);
      if (project === undefined) {
        throw new InvoiceLineInvalidError(
          `project ${input.projectId} does not exist in this tenant — the invoice cannot stamp it`,
        );
      }
      if (project.status !== "OPEN") {
        throw new SalesDocumentStateError(
          `project ${project.name} is ${project.status} and cannot receive new journal-line stamps`,
        );
      }
    }
    if (input.contractId !== null && input.contractId !== undefined) {
      const ok = this.contractBillingPort !== null
        ? await this.contractBillingPort.validateContract(input.contractId)
        : await store.findContractExists(input.contractId);
      if (!ok) {
        throw new InvoiceLineInvalidError(
          `service contract ${input.contractId} does not exist in this tenant — the invoice cannot claim its provenance`,
        );
      }
    }
    if (input.serviceOrderId !== null && input.serviceOrderId !== undefined) {
      const ok = await store.findServiceOrderExists(input.serviceOrderId);
      if (!ok) {
        throw new InvoiceLineInvalidError(
          `service order ${input.serviceOrderId} does not exist in this tenant — the invoice cannot claim its provenance`,
        );
      }
    }

    // Due date: explicit, or the customer's credit terms from invoice date (BR-026).
    let dueDate = input.dueDate;
    if (dueDate === null) {
      dueDate = input.kind === "CASH" ? input.invoiceDate : null;
      if (dueDate === null) {
        dueDate = input.invoiceDate;
        if (customer.creditTermId !== null) {
          const partnersStore = await import("../../partners/infrastructure/partners.store");
          const term = await partnersStore.findCreditTermsById(customer.creditTermId);
          if (term !== undefined && term.days > 0) {
            dueDate = new Date(
              new Date(`${input.invoiceDate}T00:00:00Z`).getTime() + term.days * 24 * 60 * 60 * 1000,
            )
              .toISOString()
              .slice(0, 10);
          }
        }
      }
    }

    // Flow A context: the posted DN + per-line bounds (INV-016 shape).
    const deliveryLines =
      input.deliveryId !== null ? await this.requireDeliveryContext(input.deliveryId, input.customerId) : new Map<
        string,
        store.DeliveryNoteLineRow
      >();
    const alreadyInvoiced = await store.deliveryLineInvoicedQty();

    // Line validation + tax resolution (BR-033 snapshots at create).
    const taxLines = await resolveOutputTaxLines({
      resolver: this.resolver,
      documentDate: input.invoiceDate,
      currencyCode: input.currencyCode,
      lines: input.lines
        .map((line) => ({
          taxCodeId: line.taxCodeId ?? "",
          amount: salesLineNetAmount(
            line.qty,
            line.unitPrice,
            line.discountAmount ?? "0",
          ),
        }))
        .filter((line) => line.taxCodeId !== ""),
    });
    const taxByLine = new Map<number, SalesTaxLine>();
    let taxIndex = 0;
    for (let index = 0; index < input.lines.length; index += 1) {
      if (input.lines[index]!.taxCodeId !== null) {
        taxByLine.set(index + 1, taxLines.lines[taxIndex]!);
        taxIndex += 1;
      }
    }

    let totalNet = new Decimal(0);
    let totalTax = new Decimal(0);
    type SiStoreLine = Parameters<typeof store.insertSalesInvoice>[0]["lines"][number];
    const storeLines: SiStoreLine[] = [];
    let lineNo = 0;
    for (const line of input.lines) {
      lineNo += 1;
      if ((line.itemId === null) === (line.accountId === null)) {
        throw new InvoiceLineInvalidError(
          "each invoice line targets exactly one of item (stock/revenue) or account (service/charge)",
        );
      }
      if (!QTY_RE.test(line.qty) || Number(line.qty) <= 0) {
        throw new InvoiceLineInvalidError(`invoice line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      if (!PRICE_RE.test(line.unitPrice) || Number(line.unitPrice) < 0) {
        throw new InvoiceLineInvalidError(`invoice line unit price must be non-negative: ${line.unitPrice}`);
      }
      if (line.itemId !== null) {
        await requireSellableItem(line.itemId);
      }
      const net = salesLineNetAmount(line.qty, line.unitPrice, line.discountAmount ?? "0");
      const tax = taxByLine.get(lineNo);
      const taxAmount = tax?.resolved.taxAmount ?? "0.0000";

      // Flow A: the delivery-line bound (invoiced ≤ delivered).
      let issueUnitCost: string | null = null;
      let issueValue: string | null = null;
      let batchId = line.batchId;
      let serialIds = line.serialIds;
      if (line.deliveryLineId !== null) {
        const deliveryLine = deliveryLines.get(line.deliveryLineId);
        if (deliveryLine === undefined) {
          throw new InvoiceLineInvalidError(
            `delivery line ${line.deliveryLineId} does not exist on delivery ${input.deliveryId}`,
          );
        }
        if (deliveryLine.itemId !== line.itemId) {
          throw new InvoiceLineInvalidError(
            `delivery line ${line.deliveryLineId} carries a different item — the invoice line must match (INV-006)`,
          );
        }
        const invoiced = alreadyInvoiced.get(line.deliveryLineId) ?? "0";
        const after = new Decimal(invoiced).plus(new Decimal(line.qty));
        if (after.comparedTo(new Decimal(deliveryLine.qty)) > 0) {
          throw new DeliveryAlreadyInvoicedError({
            deliveryLineId: line.deliveryLineId,
            delivered: deliveryLine.qty,
            alreadyInvoiced: invoiced,
            requested: line.qty,
          });
        }
        // The W-3 provenance copies from the DN line's post snapshots.
        issueUnitCost = deliveryLine.issueUnitCost;
        issueValue = new Decimal(deliveryLine.issueUnitCost ?? "0")
          .times(new Decimal(line.qty))
          .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
          .toFixed(4);
        batchId = deliveryLine.batchId;
        serialIds = deliveryLine.serialIds;
      } else if (line.itemId !== null && input.warehouseId !== null) {
        // Flow B: stock issues at post — capture batch/serial now.
        void issueUnitCost;
        void issueValue;
      }

      totalNet = totalNet.plus(new Decimal(net));
      totalTax = totalTax.plus(new Decimal(taxAmount));
      storeLines.push({
        itemId: line.itemId,
        accountId: line.accountId,
        deliveryLineId: line.deliveryLineId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(line.unitPrice).toFixed(6),
        discountAmount: new Decimal(line.discountAmount ?? "0").toFixed(4),
        taxCodeId: line.taxCodeId,
        netAmount: net,
        taxAmount,
        taxSnapshot: (tax?.resolved.snapshot as unknown as Record<string, unknown>) ?? null,
        batchId,
        serialIds,
        focReasonCode: line.focReasonCode ?? null,
        note: line.note,
      });
    }

    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalTaxS = totalTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalGross = totalNet.plus(totalTax).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    // BR-001 preview (recorded on the draft; enforced at approve). CASH
    // invoices carry no credit exposure (money received at the counter) —
    // the check is a CREDIT-kind control, so cash records ALLOW by shape.
    const documentBase =
      input.currencyCode === base
        ? totalGross
        : new Decimal(totalGross).times(new Decimal(input.exchangeRate ?? "1"))
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
            .toFixed(4);
    const preview =
      input.kind === "CASH"
        ? {
            posture: "cash",
            partnerId: input.customerId,
            openBalance: "0.0000",
            documentAmount: documentBase,
            limit: null,
            wouldExceed: false,
            overdueCount: 0,
            decision: "ALLOW" as const,
            math: "cash — no credit exposure",
          }
        : await runCreditCheck({
            customerId: input.customerId,
            documentAmountBase: documentBase,
          });

    const created = await store.insertSalesInvoice({
      branchId: input.branchId,
      customerId: input.customerId,
      salesRepId: input.salesRepId,
      kind: input.kind,
      invoiceDate: input.invoiceDate,
      dueDate,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      orderId: input.orderId,
      deliveryId: input.deliveryId,
      warehouseId: input.warehouseId,
      cashAccountId: input.cashAccountId,
      jobCardId: input.jobCardId ?? null,
      vehicleId: input.vehicleId ?? null,
      contractId: input.contractId ?? null,
      serviceOrderId: input.serviceOrderId ?? null,
      projectId: input.projectId ?? null,
      claimRef,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalNet: totalNetS,
      totalTax: totalTaxS,
      totalGross,
      taxSummary: { groups: taxLines.summaryGroups, totalTax: taxLines.totalTax },
      creditCheck: { ...preview, stage: "draft" },
      lines: storeLines,
      ...(input.pos === undefined
        ? {}
        : {
            id: input.pos.clientId,
            channel: "POS" as const,
            posTerminalId: input.pos.terminalId,
            orderType: input.pos.orderType,
            posTableId: input.pos.tableId ?? null,
            offlineReceiptNo: input.pos.offlineReceiptNo ?? null,
            tenders: input.pos.tenders ?? null,
          }),
    });
    await this.audit.record({
      action: "sales.invoice_created",
      entityType: "sales_invoice",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        kind: input.kind,
        customerId: input.customerId,
        totalNet: totalNetS,
        totalTax: totalTaxS,
        totalGross,
        creditDecision: preview.decision,
      },
    });

    // BR-005: cash autopost (policy-driven approval + post, distinctly
    // recorded). The POS channel carries its own sentinel —
    // `pos.cash_autopost` — falling back to the sales default (counter
    // sales never sit in a draft queue; DOCUMENT_LIFECYCLE §2 rule 1).
    const autopost =
      input.pos !== undefined
        ? (await store.readSetting<boolean>("pos.cash_autopost")) ??
          (await store.readSetting<boolean>("sales.cash_autopost")) ??
          true
        : (await store.readSetting<boolean>("sales.cash_autopost")) ?? false;
    if (autopost && input.kind === "CASH") {
      // DOCUMENT_LIFECYCLE §2 rule 1: approved_by carries the POLICY
      // sentinel (distinct from posted_by); the post itself + its audit
      // trail carry the REAL acting user — the sentinel is a marker on
      // the document, never an audit actor (fk_audit_events_actor).
      await store.updateSalesInvoiceStatus({
        id: created.id,
        status: "APPROVED",
        actorId: POLICY_ACTOR_ID,
      });
      // posted_by must be non-null on POSTED rows (ck_sales_invoices_
      // posted_shape): system/offline postings carry the policy sentinel;
      // the audit trail maps the sentinel to "no human actor".
      const posted = await this.post(created.id, input.actorId ?? POLICY_ACTOR_ID);
      return posted.invoice;
    }
    return created;
  }

  async submit(id: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `sales invoice ${id} is ${invoice.status} — only DRAFT invoices submit`,
      );
    }
    await store.updateSalesInvoiceStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  /**
   * Approve: SoD + the BR-001 enforcement (all three postures; override
   * requires sales.credit_check.override — the controller verifies the
   * permission and passes override=true, audited here).
   */
  async approve(id: string, actorId: string | null, override: boolean) {
    const invoice = await this.find(id);
    if (invoice.status !== "PENDING_APPROVAL" && invoice.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `sales invoice ${id} is ${invoice.status} — only DRAFT/PENDING_APPROVAL invoices approve`,
      );
    }
    if (invoice.createdBy !== null && invoice.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    // BR-003 staleness gate (sync-vocabulary aligned): when manual overrides
    // are disallowed, every item line's price must still match the
    // deterministic resolution — a drifted draft is PRICE_CHANGED, never
    // silently posted (the offline sync reason codes reuse this vocabulary).
    const overrideAllowed = (await store.readSetting<boolean>("sales.price_override_allowed")) ?? true;
    if (!overrideAllowed) {
      const lines = await store.listSalesInvoiceLines(id);
      for (const line of lines) {
        if (line.itemId === null || line.deliveryLineId !== null) continue;
        const resolved = await (
          await import("./pricing")
        ).resolveSalesPrice({ customerId: invoice.customerId, itemId: line.itemId, qty: line.qty });
        if (resolved.source !== "MANUAL" && resolved.unitPrice !== line.unitPrice) {
          throw new (await import("../domain/sales-errors")).PriceChangedError({
            itemId: line.itemId,
            resolved: resolved.unitPrice,
            provided: line.unitPrice,
          });
        }
      }
    }
    const base = await ownTenantBaseCurrency();
    // BR-001 at approval is a CREDIT-kind control: cash invoices carry no
    // AR exposure, so no check runs (the draft preview records ALLOW by
    // shape; the post-time re-verification guards the same way).
    if (invoice.kind === "CREDIT") {
      const documentBase =
        invoice.currencyCode === base
          ? invoice.totalGross
          : new Decimal(invoice.totalGross).times(new Decimal(invoice.exchangeRate ?? "1"))
              .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
              .toFixed(4);
      const check = await enforceAtApproval({
        customerId: invoice.customerId,
        documentAmountBase: documentBase,
        override,
      });
      if (override) {
        await this.audit.record({
          action: "sales.credit_check_overridden",
          entityType: "sales_invoice",
          entityId: id,
          actorId: actorId ?? undefined,
          after: { check },
        });
      }
      await store.updateSalesInvoiceStatus({
        id,
        status: "APPROVED",
        actorId,
        creditCheck: { ...check, stage: "approved", override },
      });
      await this.audit.record({
        action: "sales.invoice_approved",
        entityType: "sales_invoice",
        entityId: id,
        actorId: actorId ?? undefined,
        after: { creditDecision: check.decision, math: check.math },
      });
      return this.find(id);
    }
    await store.updateSalesInvoiceStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "sales.invoice_approved",
      entityType: "sales_invoice",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { creditDecision: "ALLOW", math: "cash — no credit exposure" },
    });
    return this.find(id);
  }

  /**
   * Post (POSTING_ENGINE §5): ONE transaction — planIssues (flow B) →
   * COGS journal → applyIssues → tax stamp (INV-012) → AR/cash journal →
   * SAL- number → status flip. Idempotent (INV-013); BR-001 re-verified
   * (no TOCTOU); PERIOD_LOCKED refuses pre-write (INV-011, zero residue).
   */
  async post(id: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status === "POSTED") {
      return {
        invoice,
        journalEntryId: invoice.postedJournalId,
        cogsJournalEntryId: invoice.postedCogsJournalId,
        invoiceNo: invoice.invoiceNo,
        idempotentReplay: true,
      };
    }
    if (invoice.status !== "APPROVED") {
      throw new SalesDocumentStateError(
        `sales invoice ${id} is ${invoice.status} — approval (with the credit decision) precedes posting`,
      );
    }
    const lines = await store.listSalesInvoiceLines(id);
    const base = await ownTenantBaseCurrency();

    // BR-001 re-verification at post (the no-TOCTOU gap closer).
    if (invoice.kind === "CREDIT") {
      const documentBase =
        invoice.currencyCode === base
          ? invoice.totalGross
          : new Decimal(invoice.totalGross).times(new Decimal(invoice.exchangeRate ?? "1"))
              .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
              .toFixed(4);
      const fresh = await enforceAtApproval({
        customerId: invoice.customerId,
        documentAmountBase: documentBase,
        override: (invoice.creditCheck as { override?: boolean } | null)?.override === true,
      });
      void fresh;
    }

    // (1) Flow B: plan every stock issue — NO writes yet. PHASE-015 T9
    // (items.composite_products, `combo_explosion_at_posting`): a
    // COMPOSITE-kind line explodes into its component definition — each
    // component issues at its own cost through this same path — while the
    // composite line itself carries only revenue/VAT (no stock move for
    // the composite SKU). STOCK lines plan exactly as before.
    const plans: { line: store.SalesInvoiceLineRow; plan: IssuePlan }[] = [];
    if (invoice.warehouseId !== null) {
      const itemsStore = await import("../../items/infrastructure/items.store");
      const { explodeForSale } = await import("../../items/application/composite-service");
      for (const line of lines) {
        if (line.itemId === null) continue;
        const item = await itemsStore.findItemById(line.itemId);
        // PHASE-017 T4 (two revenue natures): SERVICE item lines (job-card
        // labor, consulting hours, any service item) carry revenue/VAT ONLY
        // — no stock issue, no COGS contribution; the settlement credits
        // them to SERVICE_REVENUE. Same shape as a COMPOSITE line's own SKU
        // (components issue, the composite shell never does).
        if (item?.kind === "SERVICE") continue;
        const demands =
          item?.kind === "COMPOSITE" ? await explodeForSale(line.itemId, line.qty) : null;
        const issueTargets =
          demands === null
            ? [{ itemId: line.itemId, qty: line.qty, memoSuffix: "" }]
            : demands.map((demand) => ({
                itemId: demand.componentItemId,
                qty: demand.qty,
                memoSuffix: ` — component ${demand.componentSku}`,
              }));
        for (const target of issueTargets) {
          const plan = await planIssue({
            itemId: target.itemId,
            warehouseId: invoice.warehouseId,
            qty: target.qty,
            movedAt: invoice.invoiceDate,
            moveKind: "issue",
            sourceType: "sales_invoice",
            sourceId: id,
            batchId: line.batchId,
            serialIds: line.serialIds ?? [],
            memo: `Invoice ${invoice.invoiceNo ?? id}${target.memoSuffix}`,
            memoAr: `فاتورة ${invoice.invoiceNo ?? id}`,
          });
          plans.push({ line, plan });
          stagePendingOverlay(plan);
        }
      }
    }

    // (2) The COGS journal (sales_invoice:cogs) — G-03 at issue cost.
    // PHASE-019 (§8/§11): every line of the COGS journal carries the
    // invoice's project stamp (with the AR/cash journal below — project-
    // filtered totals slice exactly).
    const projectStamp = invoice.projectId ?? undefined;
    let cogsJournalId: string | null = null;
    let cogsTotal = new Decimal(0);
    if (plans.length > 0) {
      const accountingStore = await import("../../accounting/infrastructure/accounting.store");
      const cogsMapping = await accountingStore.findActivePurpose("COGS");
      if (cogsMapping === undefined) {
        const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw purposeNotMapped({ purposeKey: "COGS" });
      }
      const inventoryByAccount = new Map<string, string>();
      for (const { plan } of plans) {
        const inventoryAccount = await resolveInventoryAccount(invoice.warehouseId!);
        inventoryByAccount.set(
          inventoryAccount,
          new Decimal(inventoryByAccount.get(inventoryAccount) ?? "0")
            .plus(new Decimal(plan.valueAmount))
            .toFixed(4),
        );
        cogsTotal = cogsTotal.plus(new Decimal(plan.valueAmount));
      }
      const cogsLines: JournalLineSpec[] = [
        {
          accountId: cogsMapping.accountId,
          direction: "DEBIT",
          amount: cogsTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
          projectId: projectStamp,
          memo: {
            en: `Invoice ${invoice.invoiceNo ?? id} — COGS at issue cost`,
            ar: `فاتورة ${invoice.invoiceNo ?? id} — تكلفة المبيعات بسعر الإصدار`,
          },
        },
      ];
      for (const [accountId, amount] of [...inventoryByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (amount === "0.0000") continue;
        cogsLines.push({
          accountId,
          direction: "CREDIT",
          amount,
          projectId: projectStamp,
          memo: {
            en: `Invoice ${invoice.invoiceNo ?? id} — stock issued`,
            ar: `فاتورة ${invoice.invoiceNo ?? id} — صرف مخزون`,
          },
        });
      }
      const cogsSpec: JournalSpec = {
        source: { docType: "sales_invoice", docId: id, operation: "cogs" },
        entryDate: invoice.invoiceDate,
        description: {
          en: `Sales invoice ${invoice.invoiceNo ?? id} — COGS entry`,
          ar: `فاتورة بيع ${invoice.invoiceNo ?? id} — قيد تكلفة المبيعات`,
        },
        currency: base,
        lines: cogsLines,
      };
      const cogsResult = await this.posting.post(cogsSpec, { postedBy: actorId });
      if (cogsResult.idempotentReplay) {
        cogsJournalId = cogsResult.journalEntryId;
      } else {
        cogsJournalId = cogsResult.journalEntryId;
        for (const { plan } of plans) {
          await applyIssue(plan, cogsJournalId);
        }
        // W-3 provenance per LINE (a composite line explodes into several
        // plans — aggregate them: the line's issueUnitCost is the per-unit
        // component COGS of one composite, issueValue the Σ component cost).
        const issuedByLine = new Map<string, { value: Decimal; lineQty: Decimal }>();
        for (const { line, plan } of plans) {
          const totals = issuedByLine.get(line.id) ?? {
            value: new Decimal(0),
            lineQty: new Decimal(line.qty),
          };
          totals.value = totals.value.plus(new Decimal(plan.valueAmount));
          issuedByLine.set(line.id, totals);
        }
        for (const [lineId, totals] of issuedByLine) {
          const unitCost = totals.lineQty.gt(0)
            ? totals.value.div(totals.lineQty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
            : new Decimal(0);
          await store.markInvoiceLineIssued({
            lineId,
            issueUnitCost: unitCost.toFixed(6),
            issueValue: totals.value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
          });
        }
      }
    }

    // (3) Tax stamp integrity (BR-033): deterministic re-resolution — a
    // mismatch refuses the post (the draft spans a rate boundary).
    const taxableLines = lines.filter((line) => line.taxCodeId !== null);
    const taxResolution = await resolveOutputTaxLines({
      resolver: this.resolver,
      documentDate: invoice.invoiceDate,
      currencyCode: invoice.currencyCode,
      lines: taxableLines.map((line) => ({
        taxCodeId: line.taxCodeId!,
        amount: line.netAmount,
      })),
    });
    const taxLinesByNo = new Map<number, SalesTaxLine>();
    taxableLines.forEach((line, index) => taxLinesByNo.set(line.lineNo, taxResolution.lines[index]!));
    for (const line of taxableLines) {
      const tax = taxLinesByNo.get(line.lineNo);
      if (tax !== undefined && line.taxSnapshot !== null) {
        const persistedRate = (line.taxSnapshot as { rate?: string }).rate ?? null;
        if (persistedRate !== null && persistedRate !== tax.resolved.rate) {
          // COGS side may have applied — but the whole UoW rolls back on throw.
          throw new SalesDocumentStateError(
            `line ${line.lineNo} tax snapshot (rate ${persistedRate}) no longer matches the resolution (rate ${tax.resolved.rate}) — re-open the draft to recompute (BR-033)`,
          );
        }
      }
    }
    const vatLines: JournalLineSpec[] = [];
    for (const [, tax] of taxLinesByNo) {
      vatLines.push(...tax.vatLines);
    }
    // PHASE-019: the VAT legs carry the project stamp too (§11 row 1 —
    // EVERY line of the post journal).
    for (const vatLine of vatLines) {
      vatLine.projectId = projectStamp;
    }

    // (4) The AR/cash journal (sales_invoice:post) — G-01/G-02.
    const accountingStore = await import("../../accounting/infrastructure/accounting.store");
    //
    // Revenue natures (PHASE-017 T4 — two revenue natures is the platform
    // behavior, not a job-card special case): every ITEM line resolves its
    // revenue purpose from the item's kind — STOCK/COMPOSITE → SALES_REVENUE
    // (goods), SERVICE → SERVICE_REVENUE (labor). The settlement credit
    // lines aggregate PER PURPOSE: two CR lines when both natures are
    // present on the document, one otherwise. Non-job-card invoices with
    // SERVICE item lines get SERVICE_REVENUE the same way (0025 maps the
    // purpose to 4200); ACCOUNT lines keep their explicit account.
    const itemsStore = await import("../../items/infrastructure/items.store");
    const revenueByPurpose = new Map<"SALES_REVENUE" | "SERVICE_REVENUE", Decimal>();
    for (const line of lines) {
      if (line.itemId === null) continue;
      const item = await itemsStore.findItemById(line.itemId);
      const purposeKey: "SALES_REVENUE" | "SERVICE_REVENUE" =
        item?.kind === "SERVICE" ? "SERVICE_REVENUE" : "SALES_REVENUE";
      revenueByPurpose.set(
        purposeKey,
        (revenueByPurpose.get(purposeKey) ?? new Decimal(0)).plus(new Decimal(line.netAmount)),
      );
    }
    const salesRevenueTotal = revenueByPurpose.get("SALES_REVENUE") ?? new Decimal(0);
    const serviceRevenueTotal = revenueByPurpose.get("SERVICE_REVENUE") ?? new Decimal(0);
    const revenueMapping = await accountingStore.findActivePurpose("SALES_REVENUE");
    if (revenueMapping === undefined) {
      const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw purposeNotMapped({ purposeKey: "SALES_REVENUE" });
    }
    let serviceMapping: { accountId: string } | undefined;
    if (serviceRevenueTotal.gt(0)) {
      serviceMapping = await accountingStore.findActivePurpose("SERVICE_REVENUE");
      if (serviceMapping === undefined) {
        const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw purposeNotMapped({ purposeKey: "SERVICE_REVENUE" });
      }
    }
    // Revenue: account lines → their account (unchanged).
    const revenueByAccount = new Map<string, string>();
    for (const line of lines) {
      if (line.itemId !== null) continue;
      revenueByAccount.set(
        line.accountId!,
        new Decimal(revenueByAccount.get(line.accountId!) ?? "0")
          .plus(new Decimal(line.netAmount))
          .toFixed(4),
      );
    }
    const journalLines: JournalLineSpec[] = [];
    // G-02 cash: DR cash/bank first; G-01 credit: DR AR_CONTROL (partner).
    // PHASE-016 tender split: a POS invoice with tenders splits the debit —
    // cash → the till account, card → the CARD_RECEIVABLE purpose
    // (fail-closed like every purpose). Non-POS cash invoices are exactly
    // as before (single till debit).
    if (invoice.kind === "CASH") {
      const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
      const account = await treasuryStore.findCashAccountById(invoice.cashAccountId!);
      if (account === undefined) {
        throw new InvoiceLineInvalidError(
          `cash account ${invoice.cashAccountId} does not exist in this tenant`,
        );
      }
      const tenders =
        invoice.tenders !== null && Array.isArray(invoice.tenders) && invoice.tenders.length > 0
          ? (invoice.tenders as store.PosTender[])
          : null;
      if (tenders !== null) {
        let cashTotal = new Decimal(0);
        let cardTotal = new Decimal(0);
        for (const tender of tenders) {
          if (tender.method === "CASH") {
            cashTotal = cashTotal.plus(new Decimal(tender.amount));
          } else {
            cardTotal = cardTotal.plus(new Decimal(tender.amount));
          }
        }
        const tenderSum = cashTotal.plus(cardTotal);
        if (tenderSum.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4) !== invoice.totalGross) {
          throw new InvoiceLineInvalidError(
            `tender split (${tenderSum.toFixed(4)}) must equal the invoice total (${invoice.totalGross}) — G-02 balance`,
          );
        }
        if (cashTotal.gt(0)) {
          journalLines.push({
            accountId: account.accountId,
            direction: "DEBIT",
            amount: cashTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
            projectId: projectStamp,
            memo: {
              en: `POS cash tender ${invoice.invoiceNo ?? id}`,
              ar: `فاتورة نقاط بيع نقدية ${invoice.invoiceNo ?? id}`,
            },
          });
        }
        if (cardTotal.gt(0)) {
          journalLines.push({
            purpose: "CARD_RECEIVABLE",
            direction: "DEBIT",
            amount: cardTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
            projectId: projectStamp,
            memo: {
              en: `POS card tender ${invoice.invoiceNo ?? id}`,
              ar: `فاتورة نقاط بيع بالبطاقة ${invoice.invoiceNo ?? id}`,
            },
          });
        }
      } else {
        journalLines.push({
          accountId: account.accountId,
          direction: "DEBIT",
          amount: invoice.totalGross,
          projectId: projectStamp,
          memo: {
            en: `Cash invoice ${invoice.invoiceNo ?? id}`,
            ar: `فاتورة نقدية ${invoice.invoiceNo ?? id}`,
          },
        });
      }
    } else {
      journalLines.push({
        purpose: "AR_CONTROL",
        direction: "DEBIT",
        amount: invoice.totalGross,
        partnerId: invoice.customerId,
        projectId: projectStamp,
        memo: {
          en: `Sales invoice ${invoice.invoiceNo ?? id}`,
          ar: `فاتورة بيع ${invoice.invoiceNo ?? id}`,
        },
      });
    }
    if (salesRevenueTotal.gt(0)) {
      journalLines.push({
        accountId: revenueMapping.accountId,
        direction: "CREDIT",
        amount: salesRevenueTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        projectId: projectStamp,
        memo: {
          en: `Sales revenue — invoice ${invoice.invoiceNo ?? id}`,
          ar: `إيرادات المبيعات — فاتورة ${invoice.invoiceNo ?? id}`,
        },
      });
    }
    if (serviceRevenueTotal.gt(0)) {
      // The labor revenue leg (PHASE-017 T4): SERVICE item lines —
      // job-card labor, consulting hours, any service item — credit the
      // SERVICE_REVENUE purpose (4200) separately from goods revenue.
      journalLines.push({
        accountId: serviceMapping!.accountId,
        direction: "CREDIT",
        amount: serviceRevenueTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        projectId: projectStamp,
        memo: {
          en: `Service revenue (labor) — invoice ${invoice.invoiceNo ?? id}`,
          ar: `إيرادات الخدمات (أعمال) — فاتورة ${invoice.invoiceNo ?? id}`,
        },
      });
    }
    for (const [accountId, amount] of [...revenueByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (amount === "0.0000") continue;
      journalLines.push({
        accountId,
        direction: "CREDIT",
        amount,
        projectId: projectStamp,
        memo: {
          en: `Service revenue — invoice ${invoice.invoiceNo ?? id}`,
          ar: `إيرادات خدمات — فاتورة ${invoice.invoiceNo ?? id}`,
        },
      });
    }
    journalLines.push(...vatLines);

    const effectiveRate =
      invoice.currencyCode === base ? undefined : invoice.exchangeRate ?? undefined;
    const spec: JournalSpec = {
      source: { docType: "sales_invoice", docId: id, operation: "post" },
      entryDate: invoice.invoiceDate,
      description: {
        en: `Sales invoice ${invoice.invoiceNo ?? id} — ${invoice.kind === "CASH" ? "cash" : "AR open"}`,
        ar: `فاتورة بيع ${invoice.invoiceNo ?? id} — ${invoice.kind === "CASH" ? "نقدية" : "فتح حساب مدين"}`,
      },
      currency: invoice.currencyCode,
      exchangeRate: effectiveRate,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await this.find(id);
      return {
        invoice: current,
        journalEntryId: result.journalEntryId,
        cogsJournalEntryId: current.postedCogsJournalId,
        invoiceNo: current.invoiceNo,
        idempotentReplay: true,
      };
    }

    // (5) INV-012 document summaries — same transaction (OUTPUT side).
    await recordDocumentTaxSummary({
      sourceType: "sales_invoice",
      sourceId: id,
      documentDate: invoice.invoiceDate,
      fiscalPeriodId: null,
      direction: "OUTPUT",
      lines: taxableLines.map((line) => taxLinesByNo.get(line.lineNo)!.resolved),
    });

    // (6) Cash invoice: the treasury cash_movements row (INV-019 — the
    // cash account's balance is ALWAYS Σ movements). A POS tender split
    // records the CASH portion only — card money settles through
    // CARD_RECEIVABLE and never sits in the drawer.
    if (invoice.kind === "CASH") {
      const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
      const tenders =
        invoice.tenders !== null && Array.isArray(invoice.tenders) && invoice.tenders.length > 0
          ? (invoice.tenders as store.PosTender[])
          : null;
      const cashPortion =
        tenders === null
          ? invoice.totalGross
          : tenders
              .filter((tender) => tender.method === "CASH")
              .reduce((sum, tender) => sum.plus(new Decimal(tender.amount)), new Decimal(0))
              .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
              .toFixed(4);
      if (cashPortion !== "0.0000") {
        await treasuryStore.insertCashMovement({
          cashAccountId: invoice.cashAccountId!,
          direction: "IN",
          amount: cashPortion,
          currencyCode: invoice.currencyCode,
          exchangeRate: "1",
          baseAmount: cashPortion,
          sourceType: "sales_invoice",
          sourceId: id,
          valueDate: invoice.invoiceDate,
          memo: `Cash invoice ${invoice.invoiceNo ?? id}`,
          memoAr: `فاتورة نقدية ${invoice.invoiceNo ?? id}`,
        });
      }
    }

    // (7) Official number + status flip. POS-channel invoices carry the
    // POS series per branch (POS-{branch}-{yyMM}-{seq:5}, INV-021 —
    // server-side only; the OFF- terminal sequence reconciles 1:1 here).
    const year = invoice.invoiceDate.slice(0, 4);
    const isPos = invoice.channel === "POS";
    // The POS series embeds the branch code (short, unique per tenant) so
    // the rendered number is tenant-unique across parallel branches —
    // POS-{branch}-{yyMM}-{seq:5} (INV-021: uniqueness under parallel
    // terminals, server-side assignment only).
    const tenancyStore = await import("../../tenancy/infrastructure/tenancy.store");
    const branch = await tenancyStore.findBranchById(invoice.branchId);
    const branchCode = (branch?.code ?? invoice.branchId.slice(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const posPeriod = `${year}${invoice.invoiceDate.slice(5, 7)}`.slice(2);
    const POS_FORMAT = {
      prefix: "POS",
      format: `POS-${branchCode}-${posPeriod}-{SEQ:5}`,
      docType: "pos_sales_invoice",
    };
    const acquired = await this.numbering.reserve(
      isPos
        ? {
            docType: POS_FORMAT.docType,
            branchId: invoice.branchId,
            periodKey: posPeriod,
            format: POS_FORMAT.format,
            prefix: POS_FORMAT.prefix,
            year,
          }
        : {
            docType: SAL_FORMAT.docType,
            branchId: invoice.branchId,
            periodKey: year,
            format: SAL_FORMAT.format,
            prefix: SAL_FORMAT.prefix,
            year,
          },
    );
    await store.updateSalesInvoiceStatus({
      id,
      status: "POSTED",
      actorId,
      invoiceNo: acquired.number,
      postingDate: invoice.invoiceDate,
      postedJournalId: result.journalEntryId,
      postedCogsJournalId: cogsJournalId,
      cogsValue: cogsTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    });
    await this.numbering.bind(isPos ? POS_FORMAT.docType : SAL_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "sales.invoice_posted",
      entityType: "sales_invoice",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        invoiceNo: acquired.number,
        journalEntryId: result.journalEntryId,
        cogsJournalEntryId: cogsJournalId,
        totalGross: invoice.totalGross,
        kind: invoice.kind,
      },
    });
    // PHASE-019 (§1 row 5/§11): the contract-billing port fires the advance
    // release (J-REL) after a successful post of a contract-linked invoice —
    // same UoW (this whole post runs inside the caller's transaction),
    // optional-chained so unwired tenants post exactly as before.
    if (invoice.contractId !== null && this.contractBillingPort !== null) {
      await this.contractBillingPort.onContractInvoicePosted(invoice.contractId, id, actorId);
    }
    return {
      invoice: await this.find(id),
      journalEntryId: result.journalEntryId,
      cogsJournalEntryId: cogsJournalId,
      invoiceNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const invoice = await this.find(id);
    if (invoice.status === "POSTED") {
      throw new SalesDocumentStateError(
        "posted sales invoices are immutable — correction is a credit note or reversal (INV-003/BR-031)",
      );
    }
    await store.updateSalesInvoiceStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "sales.invoice_cancelled",
      entityType: "sales_invoice",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /** The flow-A delivery context: posted DN + same customer + its lines. */
  private async requireDeliveryContext(
    deliveryId: string,
    customerId: string,
  ): Promise<Map<string, store.DeliveryNoteLineRow>> {
    const delivery = await store.findDeliveryNoteById(deliveryId);
    if (delivery === undefined) throw new DeliveryNoteNotFoundError(deliveryId);
    if (delivery.status !== "POSTED") {
      throw new SalesDocumentStateError(
        `delivery note ${deliveryId} is ${delivery.status} — invoices clear posted deliveries only`,
      );
    }
    if (delivery.customerId !== customerId) {
      throw new InvoiceLineInvalidError(
        "the delivery belongs to a different customer — the source chain must match (INV-006)",
      );
    }
    const lines = await store.listDeliveryNoteLines(deliveryId);
    return new Map(lines.map((line) => [line.id, line]));
  }

  /** Flow A conversion: create the invoice from a posted DN (lines carried). */
  async createFromDelivery(input: {
    deliveryId: string;
    dueDate: string | null;
    taxCodeId: string | null;
    note: string | null;
    actorId: string | null;
  }): Promise<store.SalesInvoiceRow> {
    const delivery = await store.findDeliveryNoteById(input.deliveryId);
    if (delivery === undefined) throw new DeliveryNoteNotFoundError(input.deliveryId);
    if (delivery.status !== "POSTED") {
      throw new SalesDocumentStateError(
        `delivery note ${input.deliveryId} is ${delivery.status} — only POSTED deliveries convert to invoices`,
      );
    }
    if (delivery.convertedInvoiceId !== null) {
      throw new SalesDocumentStateError(
        `delivery note ${input.deliveryId} already converted to invoice ${delivery.convertedInvoiceId}`,
      );
    }
    const lines = await store.listDeliveryNoteLines(input.deliveryId);
    const invoice = await this.create({
      branchId: delivery.branchId,
      customerId: delivery.customerId,
      salesRepId: delivery.salesRepId,
      kind: "CREDIT",
      invoiceDate: new Date().toISOString().slice(0, 10),
      dueDate: input.dueDate,
      currencyCode: delivery.currencyCode,
      exchangeRate: null,
      orderId: delivery.orderId,
      deliveryId: delivery.id,
      warehouseId: null,
      cashAccountId: null,
      note: input.note,
      noteAr: null,
      actorId: input.actorId,
      lines: lines.map((line) => ({
        itemId: line.itemId,
        accountId: null,
        deliveryLineId: line.id,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxCodeId: input.taxCodeId,
        batchId: line.batchId,
        serialIds: line.serialIds,
        note: null,
      })),
    });
    await store.setDeliveryConvertedInvoice(delivery.id, invoice.id);
    // W-3 provenance: carry the DN line's issue-cost snapshot onto the
    // invoice lines — the re-entry cost source for later credit notes
    // (INVENTORY_ACCOUNTING §2: the ORIGINAL issue cost, never a
    // current-average recompute).
    const invoiceLines = await store.listSalesInvoiceLines(invoice.id);
    const dnLineById = new Map(lines.map((line) => [line.id, line]));
    for (const invoiceLine of invoiceLines) {
      const dnLine =
        invoiceLine.deliveryLineId !== null ? dnLineById.get(invoiceLine.deliveryLineId) : undefined;
      if (dnLine !== undefined && dnLine.issueUnitCost !== null && dnLine.issueValue !== null) {
        await store.markInvoiceLineIssued({
          lineId: invoiceLine.id,
          issueUnitCost: dnLine.issueUnitCost,
          issueValue: dnLine.issueValue,
        });
      }
    }
    return invoice;
  }
}
