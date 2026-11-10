import { Injectable } from "@nestjs/common";
import { renderReceipt58, renderReceipt80, type ReceiptPayload } from "@erp/ui/print";

import { ZatcaQrPayloadRequiredError } from "../../tax/domain/zatca/zatca-errors";
import { findTaxRegistrationByCountry } from "../../tax/infrastructure/tax.store";
import { listZatcaDevices } from "../../tax/infrastructure/zatca.store";
import { qrDataUri } from "../../tax/application/zatca/qr-renderer";
import * as posStore from "../infrastructure/pos.store";
import * as salesStore from "../../sales/infrastructure/sales.store";
import { PosTerminalNotFoundError } from "../domain/pos-errors";

/**
 * POS receipt service (PHASE-016 T11): builds the receipt payload from a
 * POSTED invoice (+ terminal context) and renders it through the
 * PHASE-013 versioned print templates — `receipt-80` / `receipt-58`
 * (RTL-first per RTL_DESIGN_RULES; Arabic-first with EN variants). The
 * same HTML is used by the web PrintPreview (iframe srcDoc) and the
 * server Chromium renderer — screen and paper cannot diverge (ADR-0011).
 *
 * Offline variant (OFFLINE_ARCHITECTURE §5): a PENDING_SYNC local sale
 * prints the `OFF-…` number + a pending-sync notice — the official
 * number appears NOWHERE until the server assigns it; the web client
 * renders that variant locally from its outbox (this service covers the
 * posted/reprint path — matrix row #32; reprint asserts no re-numbering,
 * INV-021).
 */
@Injectable()
export class PosReceiptService {
  /** Render a POSTED invoice as a receipt (print + reprint path). */
  async renderForInvoice(input: { invoiceId: string; locale?: "ar" | "en" }): Promise<{
    html: string;
    payload: ReceiptPayload;
    template: "receipt-80" | "receipt-58";
  }> {
    const invoice = await salesStore.findSalesInvoiceById(input.invoiceId);
    if (invoice === undefined) {
      throw new PosTerminalNotFoundError(`invoice ${input.invoiceId}`);
    }
    const terminal =
      invoice.posTerminalId === null
        ? undefined
        : await posStore.findTerminalById(invoice.posTerminalId);
    const lines = await salesStore.listSalesInvoiceLines(invoice.id);
    const locale = input.locale ?? "ar";
    const template = (terminal?.receiptSize === "58mm" ? "receipt-58" : "receipt-80") as
      | "receipt-80"
      | "receipt-58";

    const itemsStore = await import("../../items/infrastructure/items.store");
    const items = await Promise.all(
      lines.map(async (line) => {
        let name = line.description ?? `item ${line.itemId}`;
        let nameAr = line.descriptionAr ?? null;
        if (line.itemId !== null) {
          const item = await itemsStore.findItemById(line.itemId);
          if (item !== undefined) {
            name = item.name;
            nameAr = item.nameAr;
          }
        }
        return {
          name: locale === "ar" ? (nameAr ?? name) : name,
          qty: line.qty,
          price: line.unitPrice,
          total: line.netAmount,
        };
      }),
    );
    const totals: { label: string; amount: string }[] = [
      { label: locale === "ar" ? "الإجمالي قبل الضريبة" : "Net", amount: invoice.totalNet },
    ];
    if (invoice.totalTax !== "0.0000") {
      totals.push({ label: locale === "ar" ? "الضريبة" : "VAT", amount: invoice.totalTax });
    }
    totals.push({ label: locale === "ar" ? "الإجمالي" : "Total", amount: invoice.totalGross });

    const tenders = invoice.tenders ?? [];
    const paymentMethod =
      tenders.length === 0
        ? locale === "ar"
          ? "نقداً"
          : "Cash"
        : tenders
            .map((tender) =>
              tender.method === "CASH"
                ? locale === "ar"
                  ? "نقداً"
                  : "Cash"
                : locale === "ar"
                  ? "بطاقة"
                  : "Card",
            )
            .join(" + ");

    // PHASE-037 (BR-060, fail-closed): for an ENROLLED tenant (an EIAS
    // device exists — the settings-screen registry is the enrollment
    // act), a KSA-VAT tenant cannot PRINT a SIMPLIFIED invoice without a
    // QR payload. POS receipts are the simplified path by definition
    // (classification SIMPLIFIED; legacy rows before 0050 carry NULL
    // classification + channel POS). Unenrolled tenants keep printing
    // their legacy receipts unchanged. The guard runs BEFORE any
    // rendering side effect — zero residue.
    const saRegistration = await findTaxRegistrationByCountry("SA");
    const sellerVatRegistered =
      saRegistration?.status === "REGISTERED" && saRegistration.registrationNumber !== null;
    const enrolled = (await listZatcaDevices({ limit: 1 })).length > 0;
    const simplified =
      invoice.classification === "SIMPLIFIED" ||
      (invoice.classification === null && invoice.channel === "POS");
    if (simplified && enrolled && sellerVatRegistered && invoice.qrPayload === null) {
      throw new ZatcaQrPayloadRequiredError({
        invoiceId: invoice.id,
        surface: "print",
        classification: "SIMPLIFIED",
      });
    }
    // H-02: the pre-rendered QR image over the STORED payload (never the
    // client's guess; render-at-print only — OA-06). Unstamped receipts
    // (no payload) print without an image — the guard above decides
    // whether that is legal (non-KSA-VAT tenants: yes).
    const qrImageUri = invoice.qrPayload !== null ? await qrDataUri(invoice.qrPayload) : undefined;

    const payload: ReceiptPayload = {
      template,
      locale,
      merchantName: locale === "ar" ? "المتجر" : "Store",
      docNo: invoice.invoiceNo ?? invoice.id,
      items,
      totals,
      paymentMethod,
      ...(qrImageUri === undefined ? {} : { qrImageUri }),
      ...(terminal === undefined ? {} : { terminal: terminal.code }),
      legalLine:
        locale === "ar"
          ? "هذه فاتورة مبسطة وفق نظام ضريبة القيمة المضافة"
          : "Simplified invoice per VAT regulations",
    };
    const html = template === "receipt-58" ? renderReceipt58(payload) : renderReceipt80(payload);
    return { html, payload, template };
  }

  /**
   * The offline variant's payload contract — the web client builds it
   * from its local outbox (PENDING_SYNC); exported for the client types
   * to stay in lockstep with the OFF- rules (§5: the official number is
   * printed NOWHERE offline).
   */
  offlinePayload(input: {
    locale: "ar" | "en";
    merchantName: string;
    offlineNo: string;
    items: ReceiptPayload["items"];
    totals: ReceiptPayload["totals"];
    paymentMethod: string;
    terminal?: string;
  }): ReceiptPayload {
    return {
      template: "receipt-80",
      locale: input.locale,
      merchantName: input.merchantName,
      docNo: "PENDING",
      items: input.items,
      totals: input.totals,
      paymentMethod: input.paymentMethod,
      ...(input.terminal === undefined ? {} : { terminal: input.terminal }),
      offlineNo: input.offlineNo,
    };
  }
}
