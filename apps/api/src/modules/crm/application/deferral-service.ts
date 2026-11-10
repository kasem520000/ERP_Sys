import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { InboxService } from "../../notifications/application/inbox-service";
import { ambientTx, requireTenantContext } from "../../../infra/db/tenant-context";
import * as store from "../infrastructure/crm.store";

/**
 * Deferral-release service (PHASE-019 T47; MASTER-PLAN §1 row 5 + §4): the
 * contract-billing port's `onContractInvoicePosted` implementation, wired in
 * the CrmModule constructor and fired by SalesInvoiceService.post after the
 * POSTED flip of a contract-linked invoice — INSIDE the same posting UoW
 * (§11; the release commits or rolls back with the invoice).
 *
 * Mechanics (the §1 DECISION pair): at tagging, policy ON moved the on-account
 * credit into DEFERRED_REVENUE (J-DEF: DR AR · CR DEFERRED). At invoice
 * posting, the release posts **J-REL** — DR DEFERRED_REVENUE · CR AR_CONTROL
 * (partner, projectId on BOTH lines) — with entryDate = the INVOICE's date
 * (the liability clears in the same period as the revenue the invoice
 * recognizes; revenue is credited exactly once, by the invoice journal) +
 * the receipt→invoice treasury allocation (the advance application — the
 * replacePostedReceiptAllocations mirror aggregating on (receipt, open
 * item), with the receipt's allocated_amount recomputed exact) so the
 * invoice's open = gross − released and the ar.allocations tie holds
 * (INV-016 by construction). The advance flips RELEASED with its
 * releasedJournalId/releasedInvoiceId. A partial release (advance > the
 * invoice's remaining open) leaves the remainder as a NEW HELD advance row
 * — same receipt, same J-DEF anchor — for the next invoice.
 *
 * Honest-failure posture (NEVER throws — the invoice post SUCCEEDS): only
 * HELD advances WITH a deferJournalId release (link-only advances never
 * raised the liability); each advance releases inside its own SAVEPOINT, so
 * a per-advance failure (e.g. DEFERRED_REVENUE unmapped → PURPOSE_NOT_MAPPED)
 * rolls back to zero residue for THAT advance, records
 * `crm.advance_release_failed` + a critical crm inbox notification
 * (deduped per advance), and leaves it HELD — the NEXT invoice posting
 * retries it once the mapping is fixed.
 *
 * Idempotency (INV-013): re-firing the port for the same invoice is a
 * zero-effect no-op (fully released advances are no longer HELD; the
 * remaining-open is computed as gross − already-settled-on-the-invoice, so
 * a re-fire can never over-release); a J-REL source-key replay (a stored
 * release journal for the advance) skips the allocation add — the journal
 * is the truth.
 */

function money4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function errorSummary(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return {
      code: (error as { code?: string }).code ?? error.name,
      message: error.message,
    };
  }
  return { code: "UNKNOWN", message: String(error) };
}

@Injectable()
export class DeferralService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * The port hook (§11) — NEVER throws. Fired inside the invoice posting
   * UoW after the POSTED status flip; the whole release runs inside its own
   * outer SAVEPOINT so even a structural failure (a failed statement would
   * otherwise POISON the ambient transaction) rolls back to the pre-release
   * state and the invoice post completes; every failure is contained
   * (per advance, or per invoice) with a critical notification.
   */
  async onContractInvoicePosted(
    contractId: string,
    invoiceId: string,
    actorId: string | null,
  ): Promise<void> {
    const tx = ambientTx();
    if (tx !== undefined) {
      await tx.execute(sql`SAVEPOINT crm_advance_release`);
    }
    try {
      await this.releaseHeldAdvances(contractId, invoiceId, actorId);
      if (tx !== undefined) {
        await tx.execute(sql`RELEASE SAVEPOINT crm_advance_release`);
      }
    } catch (error) {
      // The honest-failure belt: roll the WHOLE release back to a clean
      // pre-release state (the invoice itself stays posted), then record
      // the failure. Even the rollback is best-effort — a missing
      // savepoint (no ambient tx) just surfaces the error to the audit.
      if (tx !== undefined) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT crm_advance_release`).catch(() => undefined);
      }
      const summary = errorSummary(error);
      await this.audit
        .record({
          action: "crm.advance_release_failed",
          entityType: "sales_invoice",
          entityId: invoiceId,
          actorId: actorId ?? undefined,
          after: {
            contractId,
            invoiceId,
            stage: "release",
            code: summary.code,
            reason: summary.message,
          },
        })
        .catch(() => undefined);
      await this.recordFailureNotification(invoiceId, {
        dedupeKey: `crm-advance-release-failed:invoice:${invoiceId}`,
        reason: summary.message,
        code: summary.code,
      });
    }
  }

  private async releaseHeldAdvances(
    contractId: string,
    invoiceId: string,
    actorId: string | null,
  ): Promise<void> {
    const contract = await store.findContractById(contractId);
    if (contract === undefined) return; // the port validated existence at create
    const invoice = await store.findInvoiceForCrm(invoiceId);
    if (invoice === undefined || invoice.status !== "POSTED") return;

    // Link-only advances (policy OFF at tagging) never raised the
    // liability — they stay plain on-account credits until allocated
    // through the ordinary treasury path.
    const held = (await store.listContractAdvances(contractId)).filter(
      (advance) => advance.status === "HELD" && advance.deferJournalId !== null,
    );
    if (held.length === 0) return;

    // §18 lesson 3's loud guard: the invoice's AR open item must exist (the
    // posting service writes it in the same UoW, source sales_invoice:post).
    // If it ever does not, FAIL LOUDLY (critical inbox + audit) — never a
    // silent no-op; the advances stay HELD.
    const openItem = await store.findInvoiceArOpenItem(invoiceId);
    if (openItem === undefined) {
      await this.audit.record({
        action: "crm.advance_release_failed",
        entityType: "sales_invoice",
        entityId: invoiceId,
        actorId: actorId ?? undefined,
        after: {
          contractId,
          invoiceId,
          stage: "open-item-lookup",
          code: "AR_OPEN_ITEM_NOT_FOUND",
          reason:
            "the posted invoice has no AR subledger open item — the release cannot allocate (partner subledger shape mismatch)",
        },
      });
      await this.recordFailureNotification(invoiceId, {
        dedupeKey: `crm-advance-release-failed:invoice:${invoiceId}`,
        reason: "no AR open item on the posted invoice",
        code: "AR_OPEN_ITEM_NOT_FOUND",
      });
      return;
    }

    const ctx = requireTenantContext();
    const tx = ctx.tx;
    if (tx === undefined) {
      throw new Error("advance release requires an ambient tenant transaction");
    }

    // The releasable open: gross minus everything already settled on the
    // invoice's open item (prior releases AND any ordinary receipt
    // allocations — never over-settle; makes a port re-fire a true no-op).
    let remaining = new Decimal(invoice.totalGross).minus(new Decimal(openItem.settledAmount));
    if (remaining.lessThanOrEqualTo(0)) return;
    remaining = new Decimal(money4(remaining));

    for (const advance of held) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const amount = new Decimal(advance.amount);
      const release = Decimal.min(amount, remaining);
      if (release.lessThanOrEqualTo(0)) continue;
      const releaseAmount = money4(release);

      // Per-advance SAVEPOINT: a failure here (e.g. PURPOSE_NOT_MAPPED for
      // DEFERRED_REVENUE) rolls back to zero residue for THIS advance — no
      // half-released journals, no allocation without its journal.
      await tx.execute(sql`SAVEPOINT crm_advance_entry`);
      try {
        // J-REL (§1 row 5): DR DEFERRED_REVENUE · CR AR_CONTROL —
        // projectId on BOTH lines, partner on the AR credit, entryDate =
        // the INVOICE's date (same-period liability clearing).
        const lines: JournalLineSpec[] = [
          {
            purpose: "DEFERRED_REVENUE",
            direction: "DEBIT",
            amount: releaseAmount,
            projectId: contract.projectId ?? undefined,
            memo: {
              en: `Advance release — contract ${contract.contractNo ?? contract.id}`,
              ar: `تحرير دفعة مقدمة — عقد ${contract.contractNo ?? contract.id}`,
            },
          },
          {
            purpose: "AR_CONTROL",
            direction: "CREDIT",
            amount: releaseAmount,
            partnerId: contract.partnerId,
            projectId: contract.projectId ?? undefined,
            memo: {
              en: `Advance application — invoice ${invoice.id}`,
              ar: `تطبيق دفعة مقدمة — فاتورة ${invoice.id}`,
            },
          },
        ];
        const spec: JournalSpec = {
          source: { docType: "contract_advance", docId: advance.id, operation: "release" },
          entryDate: invoice.invoiceDate,
          description: {
            en: `Contract advance release — ${contract.contractNo ?? contract.id} (${releaseAmount}) against invoice ${invoice.id}`,
            ar: `تحرير دفعة عقد — ${contract.contractNo ?? contract.id} (${releaseAmount}) على الفاتورة ${invoice.id}`,
          },
          currency: invoice.currencyCode,
          lines,
        };
        const posted = await this.posting.post(spec, { postedBy: actorId });

        if (!posted.idempotentReplay) {
          // The receipt→invoice allocation (the advance application): the
          // replacePostedReceiptAllocations mirror, aggregating on (receipt,
          // open item) with the exact receipt.allocated_amount recompute.
          await store.upsertReceiptAllocation({
            receiptId: advance.receiptId,
            openItemId: openItem.id,
            addAmount: releaseAmount,
            actorId,
          });
        }

        await store.patchContractAdvance({
          id: advance.id,
          status: "RELEASED",
          releasedJournalId: posted.journalEntryId,
          releasedInvoiceId: invoiceId,
        });

        // Partial release: the remainder continues as a NEW HELD advance
        // row — same receipt, same J-DEF anchor (§4 + the §15 partial
        // golden) — consumable by the next invoice posting.
        let continuationId: string | null = null;
        if (release.lessThan(amount)) {
          const continuation = await store.insertContractAdvance({
            contractId: contract.id,
            receiptId: advance.receiptId,
            amount: money4(amount.minus(release)),
            note: `continuation of advance ${advance.id} after partial release against invoice ${invoiceId}`,
            noteAr: null,
            actorId,
          });
          await store.patchContractAdvance({
            id: continuation.id,
            // The HELD filter guarantees the anchor is present.
            deferJournalId: advance.deferJournalId!,
          });
          continuationId = continuation.id;
        }

        await this.audit.record({
          action: "crm.contract_advance.released",
          entityType: "contract_advance",
          entityId: advance.id,
          actorId: actorId ?? undefined,
          after: {
            contractId: contract.id,
            invoiceId,
            receiptId: advance.receiptId,
            released: releaseAmount,
            remainder: money4(amount.minus(release)),
            releasedJournalId: posted.journalEntryId,
            continuationId: continuationId ?? undefined,
          },
        });

        await tx.execute(sql`RELEASE SAVEPOINT crm_advance_entry`);
        remaining = new Decimal(money4(remaining.minus(release)));
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT crm_advance_entry`);
        const summary = errorSummary(error);
        await this.audit.record({
          action: "crm.advance_release_failed",
          entityType: "contract_advance",
          entityId: advance.id,
          actorId: actorId ?? undefined,
          after: {
            contractId,
            invoiceId,
            advanceId: advance.id,
            code: summary.code,
            reason: summary.message,
          },
        });
        await this.recordFailureNotification(invoiceId, {
          dedupeKey: `crm-advance-release-failed:${advance.id}`,
          reason: summary.message,
          code: summary.code,
        });
        // The advance stays HELD — the next invoice posting retries it
        // once the failure's cause (e.g. the DEFERRED_REVENUE mapping) is
        // fixed. Continue with the remaining advances.
      }
    }
  }

  /**
   * The critical crm inbox row (the failure leg of the honest-failure
   * posture): tenant broadcast — the owner dashboard surfaces it; deduped
   * per subject (advance or invoice) so a repeat failure does not spam.
   */
  private async recordFailureNotification(
    invoiceId: string,
    input: { dedupeKey: string; reason: string; code: string },
  ): Promise<void> {
    await this.inbox
      .record({
        category: "crm",
        severity: "critical",
        title: { en: "Contract advance release failed", ar: "فشل تحرير دفعة العقد" },
        body: {
          en: `A HELD contract advance could not be released against invoice ${invoiceId} (${input.code}: ${input.reason}). ` +
            `If the reason is a missing purpose mapping, map DEFERRED_REVENUE to a liability account — the advance stays HELD and the next invoice posting retries the release.`,
          ar:
            `تعذّر تحرير دفعة عقد محتفظ بها مقابل الفاتورة ${invoiceId} (${input.code}: ${input.reason}). ` +
            `إذا كان السبب غياب ربط الحساب، فاربط DEFERRED_REVENUE بحساب التزامات — تبقى الدفعة محتفظًا بها ويعيد ترحين الفاتورة التالية المحاولة.`,
        },
        actionUrl: "/crm/contracts",
        dedupeKey: input.dedupeKey,
        userId: null,
      })
      .catch(() => undefined);
  }
}
