import { Decimal } from "@erp/domain-core";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  listLiveNotesForCalendar,
  type CalendarNoteView,
} from "../infrastructure/notes.store";

/**
 * The PDC maturity calendar read model (PHASE-027 T7; BR-045): job-derived
 * from `maturity_date` ONLY — register §C deliberately lists no calendar
 * table; this is a cached read model over `notes` + freshness stamps. NEVER
 * STALE-SILENT: every payload carries `computedAt` + a `stale` flag (the
 * daily job keeps the stamp fresh; a skipped run surfaces as a labeled
 * warning, never a guess). No posting can originate from the calendar — it
 * is pure read; custody events invalidate it.
 *
 * Buckets (days from asOf, integral day arithmetic — the ar-queries
 * precedent, no Math.*): OVERDUE (maturity < asOf), THIS_WEEK [0,7),
 * D30 [7,30), D60 [30,60), D90 [60,90), BEYOND [90,∞). Two-sided:
 * received vs issued, by partner/bank drill lists.
 */

/** The daily refresh is considered stale after this age (label, never block). */
export const CALENDAR_STALE_AFTER_HOURS = 26;

/** One snapshot per tenant (module-level cache; jobs replace, reads serve). */
export interface PdcCalendarSnapshot {
  tenantId: string;
  asOf: string;
  computedAt: string;
  buckets: {
    received: PdcDirectionBuckets;
    issued: PdcDirectionBuckets;
  };
  drill: {
    byPartner: { partnerId: string; partnerName: string | null; count: number; amountBase: string }[];
    byBank: { bank: string | null; count: number }[];
    notes: CalendarNoteView[];
  };
}

export interface PdcDirectionBuckets {
  overdue: { count: number; amountBase: string };
  thisWeek: { count: number; amountBase: string };
  d30: { count: number; amountBase: string };
  d60: { count: number; amountBase: string };
  d90: { count: number; amountBase: string };
  beyond: { count: number; amountBase: string };
}

const snapshots = new Map<string, PdcCalendarSnapshot>();

/** Compute the pure fold over live notes (deterministic — the job's body). */
export async function computePdcCalendar(input: {
  tenantId: string;
  asOf: string;
  now?: string;
}): Promise<PdcCalendarSnapshot> {
  const notes = await listLiveNotesForCalendar(1_000_000);
  return foldPdcCalendar({
    tenantId: input.tenantId,
    asOf: input.asOf,
    computedAt: input.now ?? new Date().toISOString(),
    notes,
  });
}

/** The pure bucket fold (exported for the calendar spec + the 100k perf probe). */
export function foldPdcCalendar(input: {
  tenantId: string;
  asOf: string;
  computedAt: string;
  notes: readonly CalendarNoteView[];
}): PdcCalendarSnapshot {
  const asOfMs = new Date(`${input.asOf}T00:00:00Z`).getTime();
  const empty = (): PdcDirectionBuckets => ({
    overdue: { count: 0, amountBase: "0.0000" },
    thisWeek: { count: 0, amountBase: "0.0000" },
    d30: { count: 0, amountBase: "0.0000" },
    d60: { count: 0, amountBase: "0.0000" },
    d90: { count: 0, amountBase: "0.0000" },
    beyond: { count: 0, amountBase: "0.0000" },
  });
  const received = empty();
  const issued = empty();
  const byPartner = new Map<string, { partnerId: string; partnerName: string | null; count: number; amountBase: string }>();
  const byBank = new Map<string, { bank: string | null; count: number }>();

  for (const note of input.notes) {
    const direction = note.direction === "RECEIVED" ? received : issued;
    const maturityMs = new Date(`${note.maturityDate}T00:00:00Z`).getTime();
    // Integral day difference (UTC ms / 86_400_000 | 0 — exact for whole
    // dates, the ar-queries aging precedent; no floating-point rounding).
    const days = ((maturityMs - asOfMs) / 86_400_000) | 0;
    let bucket: keyof PdcDirectionBuckets;
    if (days < 0) bucket = "overdue";
    else if (days < 7) bucket = "thisWeek";
    else if (days < 30) bucket = "d30";
    else if (days < 60) bucket = "d60";
    else if (days < 90) bucket = "d90";
    else bucket = "beyond";
    direction[bucket].count += 1;
    direction[bucket].amountBase = addBase(direction[bucket].amountBase, note.amount, note.exchangeRate);

    const partnerKey = note.partnerId;
    const partnerRow = byPartner.get(partnerKey) ?? {
      partnerId: partnerKey,
      partnerName: note.partnerName,
      count: 0,
      amountBase: "0.0000",
    };
    partnerRow.count += 1;
    partnerRow.amountBase = addBase(partnerRow.amountBase, note.amount, note.exchangeRate);
    byPartner.set(partnerKey, partnerRow);

    const bankKey = note.issuingBank ?? "(unspecified)";
    const bankRow = byBank.get(bankKey) ?? { bank: note.issuingBank, count: 0 };
    bankRow.count += 1;
    byBank.set(bankKey, bankRow);
  }

  return {
    tenantId: input.tenantId,
    asOf: input.asOf,
    computedAt: input.computedAt,
    buckets: { received, issued },
    drill: {
      byPartner: [...byPartner.values()].sort((a, b) => b.count - a.count || a.partnerId.localeCompare(b.partnerId)),
      byBank: [...byBank.values()].sort((a, b) => b.count - a.count || (a.bank ?? "").localeCompare(b.bank ?? "")),
      notes: [...input.notes],
    },
  };
}

/** Exact base accumulation (amount × rate, canonical 4dp — no Math.*). */
function addBase(running: string, amount: string, rate: string): string {
  const product = new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
  return new Decimal(running).plus(new Decimal(product)).toDecimalPlaces(4).toFixed(4);
}

/**
 * Read path: serve the cached snapshot when present (fresh or stale — the
 * staleness flag travels with the payload), else compute inline. On-event
 * invalidation deletes the entry so the next read reflects the new state.
 */
export function getPdcCalendarSnapshot(): PdcCalendarSnapshot | null {
  const tenantId = requireTenantContext().tenantId;
  return snapshots.get(tenantId) ?? null;
}

export async function getOrComputePdcCalendar(asOf: string): Promise<PdcCalendarSnapshot> {
  const tenantId = requireTenantContext().tenantId;
  const cached = snapshots.get(tenantId);
  if (cached !== undefined && cached.asOf === asOf) {
    return cached;
  }
  const fresh = await computePdcCalendar({ tenantId, asOf });
  snapshots.set(tenantId, fresh);
  return fresh;
}

/** The daily sweep's replace (idempotent: same data → same buckets). */
export function replacePdcCalendarSnapshot(snapshot: PdcCalendarSnapshot): void {
  snapshots.set(snapshot.tenantId, snapshot);
}

/** On-event invalidation (every custody event calls this). */
export function invalidatePdcCalendar(): void {
  snapshots.delete(requireTenantContext().tenantId);
}

/** Staleness labeling (never silent): age > 26h ⇒ stale true. */
export function isStale(snapshot: PdcCalendarSnapshot, now?: string): boolean {
  const nowMs = new Date(now ?? new Date().toISOString()).getTime();
  const computedMs = new Date(snapshot.computedAt).getTime();
  return nowMs - computedMs > CALENDAR_STALE_AFTER_HOURS * 3_600_000;
}

/** Test seam: force a computedAt age (the staleness label spec). */
export function __setSnapshotForTests(snapshot: PdcCalendarSnapshot): void {
  snapshots.set(snapshot.tenantId, snapshot);
}
