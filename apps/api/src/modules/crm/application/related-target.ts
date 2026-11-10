import { PartnerNotFoundError } from "../../partners/domain/partner-errors";
import * as store from "../infrastructure/crm.store";
import { LeadNotFoundError, ServiceOrderNotFoundError } from "../domain/crm-errors";

/**
 * The shared related-target validator (T45 — tasks + activities both anchor
 * to a LEAD|PARTNER|CONTRACT|SERVICE_ORDER record). LEAD is checked against
 * the crm-owned table; PARTNER through the read-only partners probe (the
 * sales requireCustomer mirror — A7 404 parity on foreign/unknown ids).
 *
 * SERVICE_ORDER landed with T48 (the service-order slice owns the table —
 * the T45 handoff's documented gap, closed here). CONTRACT remains the one
 * open gap: T46 shipped without the probe (its random-uuid CONTRACT anchor
 * is pinned by tasks.spec as accepted uuid-shaped ids), so it stays
 * accepted as uuid-shaped ids at this seam — the documented phase gap for
 * the plan owner.
 */
const RELATED_TYPES = ["LEAD", "PARTNER", "CONTRACT", "SERVICE_ORDER"] as const;
export type RelatedType = (typeof RELATED_TYPES)[number];

export function isRelatedType(value: string): value is RelatedType {
  return (RELATED_TYPES as readonly string[]).includes(value);
}

export async function assertRelatedTarget(relatedType: RelatedType, relatedId: string): Promise<void> {
  if (relatedType === "LEAD") {
    const lead = await store.findLeadById(relatedId);
    if (lead === undefined) throw new LeadNotFoundError(relatedId);
    return;
  }
  if (relatedType === "PARTNER") {
    const partner = await store.findPartnerForCrm(relatedId);
    if (partner === undefined || partner.deletedAt !== null) {
      throw new PartnerNotFoundError(relatedId);
    }
    return;
  }
  if (relatedType === "SERVICE_ORDER") {
    // T48: the service-order probe (the job-card generalization's table).
    const order = await store.findServiceOrderById(relatedId);
    if (order === undefined) throw new ServiceOrderNotFoundError(relatedId);
    return;
  }
  // CONTRACT → still accepted as uuid-shaped ids (the documented gap above).
}
