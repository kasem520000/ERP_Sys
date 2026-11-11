import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "../infrastructure/returns.store";
import { WarrantyNotFoundError, WarrantyTermsInvalidError } from "../domain/sales-errors";

/**
 * Warranties service (PHASE-039 T-05; migration 0055; S-15): managed
 * warranties with STRUCTURED terms — the typed jsonb
 * { durationMonths: int 1..120, coverage: REPAIR|REPLACE|REFUND|LABOR_ONLY|
 * PARTS_ONLY, basis: INVOICE_DATE|DELIVERY_DATE, mileageLimitKm?: int > 0 }
 * — replacing the free-text blob. endDate = start + durationMonths WHOLE
 * UTC months (month-end clamped: Jan 31 + 1 month lands on Feb 28/29,
 * never March 3). The basis records which anchor date the caller resolved
 * startDate from (the invoice's or the delivery's date); the register is
 * operational evidence — no ledger legs live here.
 *
 * The expiry sweep (the daily 02:50 job): ACTIVE warranties entering the
 * 30/7/0-day windows get ONE inbox notification per window — severity info
 * at 30 days, warning at 7 and 0 — deduped by
 * `warranty-expiry:{id}:{window}` (uq_notifications_dedupe) with
 * last_notified_at stamped per run, so the tightest window of any single
 * run wins and the nightly re-run is a no-op.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const COVERAGES = new Set(["REPAIR", "REPLACE", "REFUND", "LABOR_ONLY", "PARTS_ONLY"]);
const BASES = new Set(["INVOICE_DATE", "DELIVERY_DATE"]);

export interface WarrantyTerms {
  durationMonths: number;
  coverage: string;
  basis: string;
  mileageLimitKm?: number | null;
}

/** start + whole UTC months, month-end clamped (Jan 31 + 1 → Feb 28/29). */
export function addWholeUtcMonths(startDate: string, months: number): string {
  const [year, month, day] = startDate.split("-").map((part) => Number(part));
  const base = new Date(Date.UTC(year!, month! - 1, day!));
  const target = new Date(base.getTime());
  target.setUTCMonth(base.getUTCMonth() + months);
  if (target.getUTCDate() < base.getUTCDate()) {
    // Overflowed past the target month's end — clamp to its last day.
    target.setUTCDate(0);
  }
  return target.toISOString().slice(0, 10);
}

/** The structured-terms validation (S-15) — typed rejection on any drift. */
export function validateWarrantyTerms(terms: WarrantyTerms): void {
  if (!Number.isInteger(terms.durationMonths) || terms.durationMonths < 1 || terms.durationMonths > 120) {
    throw new WarrantyTermsInvalidError(
      `durationMonths must be an integer in 1..120: ${String(terms.durationMonths)}`,
    );
  }
  if (!COVERAGES.has(terms.coverage)) {
    throw new WarrantyTermsInvalidError(
      `coverage must be one of REPAIR|REPLACE|REFUND|LABOR_ONLY|PARTS_ONLY: ${terms.coverage}`,
    );
  }
  if (!BASES.has(terms.basis)) {
    throw new WarrantyTermsInvalidError(
      `basis must be INVOICE_DATE or DELIVERY_DATE: ${terms.basis}`,
    );
  }
  if (
    terms.mileageLimitKm !== undefined &&
    terms.mileageLimitKm !== null &&
    (!Number.isInteger(terms.mileageLimitKm) || terms.mileageLimitKm <= 0)
  ) {
    throw new WarrantyTermsInvalidError(
      `mileageLimitKm must be a positive integer when present: ${String(terms.mileageLimitKm)}`,
    );
  }
}

@Injectable()
export class WarrantiesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  async list(filter: { partnerId?: string; status?: string; limit: number }) {
    return store.listWarranties(filter);
  }

  async find(id: string) {
    const warranty = await store.findWarrantyById(id);
    if (warranty === undefined) throw new WarrantyNotFoundError(id);
    return warranty;
  }

  async create(input: {
    partnerId: string;
    itemId: string;
    serialNo: string | null;
    invoiceId: string | null;
    jobCardId: string | null;
    startDate: string;
    terms: WarrantyTerms;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    if (!DATE_RE.test(input.startDate)) {
      throw new WarrantyTermsInvalidError(`startDate must be an ISO date (yyyy-mm-dd): ${input.startDate}`);
    }
    validateWarrantyTerms(input.terms);
    const endDate = addWholeUtcMonths(input.startDate, input.terms.durationMonths);
    const id = await store.insertWarranty({
      partnerId: input.partnerId,
      itemId: input.itemId,
      serialNo: input.serialNo,
      invoiceId: input.invoiceId,
      jobCardId: input.jobCardId,
      terms: {
        durationMonths: input.terms.durationMonths,
        coverage: input.terms.coverage,
        basis: input.terms.basis,
        ...(input.terms.mileageLimitKm !== undefined && input.terms.mileageLimitKm !== null
          ? { mileageLimitKm: input.terms.mileageLimitKm }
          : {}),
      },
      startDate: input.startDate,
      endDate,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "sales.warranty_created",
      entityType: "warranty_registration",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        partnerId: input.partnerId,
        itemId: input.itemId,
        startDate: input.startDate,
        endDate,
        terms: input.terms,
      },
    });
    return this.find(id);
  }

  /** VOID — the register's only exit besides expiry (no deletes). */
  async void(id: string, actorId: string | null) {
    const warranty = await this.find(id);
    if (warranty.status !== "ACTIVE") {
      throw new WarrantyTermsInvalidError(
        `warranty ${id} is ${warranty.status} — only ACTIVE warranties void`,
      );
    }
    await store.voidWarranty(id);
    await this.audit.record({
      action: "sales.warranty_voided",
      entityType: "warranty_registration",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  /**
   * The 30/7/0-day expiry sweep (the daily job's body): per window, the
   * ACTIVE warranties whose end date falls inside it and that were not
   * notified today get ONE inbox notification (info at 30d, warning at
   * 7/0d) + last_notified_at. Windows run tightest-first so a warranty
   * expiring today gets exactly the 0-day warning, never the whole ladder
   * at once.
   */
  async runExpirySweep(input: {
    withinDaysList?: number[];
    limit?: number;
  }): Promise<{ window: number; notified: number }[]> {
    const windows = [...(input.withinDaysList ?? [30, 7, 0])]
      .filter((days) => Number.isInteger(days) && days >= 0)
      .sort((a, b) => a - b);
    const limit = input.limit ?? 200;
    const outcome: { window: number; notified: number }[] = [];
    for (const window of windows) {
      let notified = 0;
      const expiring = await store.expiringWarranties({ withinDays: window, limit });
      for (const warranty of expiring) {
        const recorded = await this.inbox.record({
          category: "warranties",
          severity: window >= 30 ? "info" : "warning",
          title: {
            en: `Warranty expiring${window === 0 ? " today" : ` in ${window} days`}`,
            ar: window === 0 ? "ضمان ينتهي اليوم" : `ضمان ينتهي خلال ${window} يومًا`,
          },
          body: {
            en: `The warranty for ${await this.partnerLabel(warranty.partnerId)} on ${await this.itemLabel(warranty.itemId)}${warranty.serialNo === null ? "" : ` (serial ${warranty.serialNo})`} ends on ${warranty.endDate}.`,
            ar: `ينتهي ضمان ${await this.partnerLabel(warranty.partnerId)} على ${await this.itemLabel(warranty.itemId)}${warranty.serialNo === null ? "" : ` (رقم تسلسلي ${warranty.serialNo})`} في ${warranty.endDate}.`,
          },
          dedupeKey: `warranty-expiry:${warranty.id}:${window}`,
        });
        // Stamp the run: even a deduped re-run refreshes last_notified_at,
        // keeping the warranty out of tonight's wider windows.
        await store.markWarrantyNotified(warranty.id);
        if (recorded.inserted) notified += 1;
      }
      outcome.push({ window, notified });
    }
    return outcome;
  }

  private async partnerLabel(partnerId: string): Promise<string> {
    const partnersStore = await import("../../partners/infrastructure/partners.store");
    const partner = await partnersStore.findPartnerById(partnerId);
    return partner?.name ?? partnerId;
  }

  private async itemLabel(itemId: string): Promise<string> {
    const itemsStore = await import("../../items/infrastructure/items.store");
    const item = await itemsStore.findItemById(itemId);
    return item?.name ?? itemId;
  }
}
