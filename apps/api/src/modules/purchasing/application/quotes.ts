import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/sourcing.store";
import { requireSupplier } from "./orders";
import {
  QuoteCurrencyMismatchError,
  QuoteLineInvalidError,
  PortalTokenInvalidError,
  PortalSubmissionInvalidError,
  RfqNotFoundError,
  SupplierNotInvitedError,
  SupplierQuoteNotFoundError,
} from "../domain/sourcing-errors";

/**
 * Supplier quotes service (PHASE-038 T-03; P-02): supplier responses with
 * line prices, lead time, validity windows and terms — submitted through
 * the portal endpoint (the scoped-token path, P-05) or back-office entry.
 * ONE quote per supplier per RFQ: a re-submission while the round is open
 * REPLACES the header + lines (the upsert keeps the original id stable).
 * The first submitted quote flips the round ISSUED → QUOTED.
 *
 * The portal path (P-05 skeleton): the token IS the credential (the
 * device-enrollment pattern — the sha256 hash is stored on the RFQ row;
 * the plaintext is shown ONCE at mint). The submission is audited inside
 * the tenant scope; the rate limiter owns the public surface.
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

/** sha256 hex of the portal token (the stored form). */
export async function hashPortalToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Mint a cryptographically-random url-safe portal token (32 bytes). */
export function mintPortalToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export interface QuoteSubmissionInput {
  rfqId: string;
  supplierId: string;
  quoteRef: string | null;
  submittedVia: "PORTAL" | "BACK_OFFICE";
  currencyCode: string;
  leadTimeDays: number | null;
  validUntil: string | null;
  paymentTerms: string | null;
  submittedBy: string | null;
  portalContact: string | null;
  note: string | null;
  lines: readonly { rfqLineId: string; qty: string; unitPrice: string; leadTimeDays: number | null; note: string | null }[];
}

@Injectable()
export class SupplierQuoteService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async listForRfq(rfqId: string) {
    return store.listSupplierQuotes(rfqId);
  }

  async find(id: string) {
    const quote = await store.findSupplierQuoteById(id);
    if (quote === undefined) throw new SupplierQuoteNotFoundError(id);
    return quote;
  }

  async findWithLines(id: string) {
    const quote = await this.find(id);
    return { ...quote, lines: await store.listQuoteLines(id) };
  }

  /** The shared submission path (portal + back-office land here). */
  async submit(input: QuoteSubmissionInput) {
    const rfq = await store.findRfqById(input.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(input.rfqId);

    // Round eligibility: ISSUED/QUOTED + the due date.
    if (rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new PortalSubmissionInvalidError(
        `RFQ ${input.rfqId} is ${rfq.status} — quotes land on ISSUED/QUOTED rounds only`,
      );
    }
    if (rfq.dueAt !== null && new Date(rfq.dueAt).getTime() < Date.now()) {
      throw new PortalSubmissionInvalidError(
        `RFQ ${input.rfqId} closed for responses at ${rfq.dueAt}`,
      );
    }
    // Supplier eligibility: an ACTIVE supplier registry entry, on the
    // INVITED list when the round is INVITED-mode.
    const supplier = await requireSupplier(input.supplierId);
    if (rfq.mode === "INVITED" && !rfq.invitedSuppliers.includes(input.supplierId)) {
      throw new SupplierNotInvitedError({ rfqId: input.rfqId, supplierId: input.supplierId });
    }
    // Currency + line shapes.
    if (!CURRENCY_RE.test(input.currencyCode)) {
      throw new QuoteLineInvalidError(`quote currency must be ISO-4217: ${input.currencyCode}`);
    }
    if (input.currencyCode !== rfq.currencyCode) {
      throw new QuoteCurrencyMismatchError({
        rfqCurrency: rfq.currencyCode,
        quoteCurrency: input.currencyCode,
      });
    }
    if (input.lines.length === 0) {
      throw new QuoteLineInvalidError("a quote must carry at least one offered line");
    }
    const rfqLines = await store.listRfqLines(input.rfqId);
    const rfqLineIds = new Map(rfqLines.map((l) => [l.id, l]));
    for (const line of input.lines) {
      const rfqLine = rfqLineIds.get(line.rfqLineId);
      if (rfqLine === undefined) {
        throw new QuoteLineInvalidError(
          `quote line references an unknown RFQ line of this round: ${line.rfqLineId}`,
        );
      }
      if (!QTY_RE.test(line.qty) || new (await import("@erp/domain-core")).Decimal(line.qty).lte(0)) {
        throw new QuoteLineInvalidError(`quote line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      if (!PRICE_RE.test(line.unitPrice)) {
        throw new QuoteLineInvalidError(
          `quote line unit price must be a non-negative decimal (≤ 6dp): ${line.unitPrice}`,
        );
      }
    }

    const quoteId = await store.upsertSupplierQuote({
      rfqId: input.rfqId,
      supplierId: input.supplierId,
      quoteRef: input.quoteRef,
      submittedVia: input.submittedVia,
      currencyCode: input.currencyCode,
      leadTimeDays: input.leadTimeDays,
      validUntil: input.validUntil,
      paymentTerms: input.paymentTerms,
      submittedBy: input.submittedBy,
      portalContact: input.portalContact,
      note: input.note,
    });
    // Replace semantics: the re-submission swaps the lines wholesale.
    await store.deleteQuoteLines(quoteId);
    await store.insertQuoteLines(quoteId, input.lines);

    await this.audit.record({
      action: input.submittedVia === "PORTAL"
        ? "purchasing.portal_quote_submitted"
        : "purchasing.supplier_quote_submitted",
      entityType: "supplier_quote",
      entityId: quoteId,
      actorId: input.submittedBy ?? undefined,
      after: {
        rfqId: input.rfqId,
        supplierId: input.supplierId,
        supplierCode: supplier.code,
        lines: input.lines.length,
        via: input.submittedVia,
      },
    });
    await this.markRfqQuoted(input.rfqId);
    return this.findWithLines(quoteId);
  }

  private async markRfqQuoted(rfqId: string): Promise<void> {
    const rfq = await store.findRfqById(rfqId);
    if (rfq !== undefined && rfq.status === "ISSUED") {
      await store.updateRfq(rfqId, { quotedAt: new Date().toISOString(), status: "QUOTED" });
      await this.audit.record({
        action: "purchasing.rfq_quoted",
        entityType: "rfq",
        entityId: rfqId,
        after: { via: "first_quote" },
      });
    }
  }

  async withdraw(id: string, actorId: string | null) {
    const quote = await this.find(id);
    const rfq = await store.findRfqById(quote.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(quote.rfqId);
    if (rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new PortalSubmissionInvalidError(
        `RFQ ${rfq.id} is ${rfq.status} — quotes withdraw only while the round is open`,
      );
    }
    await store.withdrawSupplierQuote(id);
    await this.audit.record({
      action: "purchasing.supplier_quote_withdrawn",
      entityType: "supplier_quote",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  // -- portal invite minting (P-05) -------------------------------------------------

  /**
   * Mint a scoped portal credential for (rfq, supplier). The plaintext
   * token is returned ONCE — only its sha256 hash persists on the RFQ
   * row. The invite requires the round ISSUED/QUOTED and the supplier on
   * the INVITED list (INVITED mode) or known to the round (OPEN mode).
   */
  async mintPortalInvite(input: {
    rfqId: string;
    supplierId: string;
    expiresAt: string;
    actorId: string | null;
  }): Promise<{ token: string; expiresAt: string }> {
    const rfq = await store.findRfqById(input.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(input.rfqId);
    if (rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new PortalSubmissionInvalidError(
        `RFQ ${input.rfqId} is ${rfq.status} — portal invites mint on ISSUED/QUOTED rounds only`,
      );
    }
    if (rfq.mode === "INVITED" && !rfq.invitedSuppliers.includes(input.supplierId)) {
      throw new SupplierNotInvitedError({ rfqId: input.rfqId, supplierId: input.supplierId });
    }
    await requireSupplier(input.supplierId);
    const token = mintPortalToken();
    const tokenHash = await hashPortalToken(token);
    const invite = {
      supplierId: input.supplierId,
      tokenHash,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    };
    await store.updateRfq(input.rfqId, {
      portalInvites: [...rfq.portalInvites.filter((i) => i.supplierId !== input.supplierId), invite],
    });
    await this.audit.record({
      action: "purchasing.portal_invite_minted",
      entityType: "rfq",
      entityId: input.rfqId,
      actorId: input.actorId ?? undefined,
      after: { supplierId: input.supplierId, expiresAt: input.expiresAt },
    });
    return { token, expiresAt: input.expiresAt };
  }

  /**
   * The P-05 submission path: resolve the scoped token → (rfq, supplier)
   * and submit. The token must be valid for THIS rfq, unrevoked, and
   * unexpired; the supplier identity comes ONLY from the token (a body
   * supplierId is ignored — the spoof battery's first leg).
   */
  async portalSubmit(input: {
    rfqId: string;
    token: string;
    quoteRef: string | null;
    currencyCode: string;
    leadTimeDays: number | null;
    validUntil: string | null;
    paymentTerms: string | null;
    portalContact: string | null;
    note: string | null;
    lines: readonly { rfqLineId: string; qty: string; unitPrice: string; leadTimeDays: number | null; note: string | null }[];
  }) {
    const rfq = await store.findRfqById(input.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(input.rfqId);
    const tokenHash = await hashPortalToken(input.token);
    const now = new Date().toISOString();
    const invite = rfq.portalInvites.find(
      (i) => i.tokenHash === tokenHash && i.revokedAt === null && i.expiresAt > now,
    );
    if (invite === undefined) {
      // Shape-uniform rejection: unknown/expired/revoked/wrong-rfq all
      // render the same typed error (no oracle).
      throw new PortalTokenInvalidError();
    }
    if (rfq.status !== "ISSUED" && rfq.status !== "QUOTED") {
      throw new PortalSubmissionInvalidError(
        `RFQ ${rfq.id} is ${rfq.status} — the portal accepts quotes while the round is open only`,
      );
    }
    const submitted = await this.submit({
      rfqId: rfq.id,
      supplierId: invite.supplierId,
      quoteRef: input.quoteRef,
      submittedVia: "PORTAL",
      currencyCode: input.currencyCode,
      leadTimeDays: input.leadTimeDays,
      validUntil: input.validUntil,
      paymentTerms: input.paymentTerms,
      submittedBy: null,
      portalContact: input.portalContact,
      note: input.note,
      lines: input.lines,
    });
    return submitted;
  }

  async revokePortalInvite(input: { rfqId: string; supplierId: string; actorId: string | null }) {
    const rfq = await store.findRfqById(input.rfqId);
    if (rfq === undefined) throw new RfqNotFoundError(input.rfqId);
    const updated = rfq.portalInvites.map((i) =>
      i.supplierId === input.supplierId && i.revokedAt === null
        ? { ...i, revokedAt: new Date().toISOString() }
        : i,
    );
    await store.updateRfq(input.rfqId, { portalInvites: updated });
    await this.audit.record({
      action: "purchasing.portal_invite_revoked",
      entityType: "rfq",
      entityId: input.rfqId,
      actorId: input.actorId ?? undefined,
      after: { supplierId: input.supplierId },
    });
  }
}
