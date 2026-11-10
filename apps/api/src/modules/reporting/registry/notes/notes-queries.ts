import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import { ownTenantBaseCurrency } from "../../../../infra/settings/setting-reader";
import * as journal from "../../../accounting/infrastructure/journal.store";
import { addExact, compareExact } from "../../../accounting/application/decimal-strings";
import { LIVE_STATUSES, type NoteStatus } from "../../../notes/application/custody-machine";
import { effectiveNoteRate } from "../../../notes/application/note-allocations";
import { notesAsOf, type NotesAsOfRow } from "../../../notes/application/notes-as-of";
import {
  listDishonorEvents,
  type DishonoredNoteEventRow,
} from "../../../notes/infrastructure/notes.store";

/**
 * PHASE-027 wave E · the notes report queries (REPORT_CATALOG §9 rows 231–233
 * — the queries behind `notes.maturity-calendar`, `notes.aging` and
 * `notes.dishonored-register`): reporting-facing, read-only, executed inside
 * the ambient tenant transaction exactly like the PHASE-026 fixed-assets
 * precedent (ADR-0011 — read-only over the PUBLISHED notes tables + the
 * accounting journal store for the GL side; this surface never writes).
 *
 * ── As-of reconstruction (the deterministic date anchors) ──────────────────
 *
 * Every figure derives from DATED source rows via the notes module's
 * `notesAsOf` read (notes created ≤ asOf, the as-of STATUS rebuilt from the
 * custody log — the latest event with event_date ≤ asOf; no event yet ⇒
 * IN_CUSTODY; RECLASSIFY never changes custody, BR-047). The LIVE-as-of
 * population (the calendar + the aging + the tie registers) is the as-of
 * register filtered to the live statuses (IN_CUSTODY/ENDORSED_OUT/DEPOSITED)
 * — INV-024: a resolved-as-of note (COLLECTED/DISHONORED/DISCOUNTED/RETURNED)
 * carries ZERO NOTES_RECEIVABLE/PAYABLE balance at asOf, exactly like the GL.
 *
 * ── The tie algebra (inv024-custody-tie / notes-open-tie / notes-payable-tie
 *    — the RC-11 register fold, date-anchored to asOf) ─────────────────────
 *
 *   REGISTER side (per direction, whole tenant — display filters never
 *   narrow the ledger check): Σ over live-as-of notes of amount × the
 *   EFFECTIVE stored rate (INV-008 — 1 for base currency, the stored rate
 *   otherwise; the same rate the G-24/G-27 legs posted at, so the fold is
 *   byte-equal to RC-11's live fold when asOf = today).
 *   GL side (journal.accountBalancesAt, entry_date ≤ asOf, asOf timestamp
 *   null — the statement/fixed-assets anchor):
 *     received = Σ signed balances (DEBIT−CREDIT) of the NOTES_RECEIVABLE
 *                accounts (debit-natured — G-24 debits it);
 *     issued   = Σ NEGATED signed balances of the NOTES_PAYABLE accounts
 *                (credit-positive register convention — the fa-accum
 *                precedent; G-27 credits it).
 *   An unmapped purpose folds to a 0.0000 GL side against its register side
 *   so the drift surfaces (never silently passes).
 *
 * Money discipline (ADR-0009): canonical 4dp strings, exact decimal
 * arithmetic (amount × rate = the moneyRate composition the posting engine
 * and RC-11 both use), tolerance 0, NO Math.*.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("notes report query requires an ambient tenant scope");
  }
  return context.tx;
}

/** Canonical 4dp normalization for GL text reads (the RC-10 precedent). */
function money4(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** amount × rate, canonical 4dp — the moneyRate composition (G-24/G-27/RC-11). */
function moneyRate(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}

/** The register scan bound (the RC-11 REGISTER_SCAN_LIMIT precedent). */
const REGISTER_ROW_LIMIT = 1_000_000;

/** The dishonored-register window bound (the movements precedent). */
const DISHONOR_ROW_LIMIT = 5_000;

/** The maturity-calendar buckets (BR-045 — the PDC fold convention). */
export type MaturityBucket = "OVERDUE" | "THIS_WEEK" | "D30" | "D60" | "D90" | "BEYOND";

/** The aging buckets (the ar-queries convention — fixed shape). */
export type NoteAgingBucket = "notDue" | "1_30" | "31_60" | "61_90" | "90_plus";

/**
 * The maturity bucket of (maturityDate vs asOf) — BR-045 / the PDC calendar
 * fold: OVERDUE (< asOf), THIS_WEEK [0,7), D30 [7,30), D60 [30,60),
 * D90 [60,90), BEYOND [90,∞). Integral day arithmetic, no Math.*.
 */
export function maturityBucketOf(maturityDate: string, asOf: string): MaturityBucket {
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const maturityMs = new Date(`${maturityDate}T00:00:00Z`).getTime();
  const days = ((maturityMs - asOfMs) / 86_400_000) | 0;
  if (days < 0) return "OVERDUE";
  if (days < 7) return "THIS_WEEK";
  if (days < 30) return "D30";
  if (days < 60) return "D60";
  if (days < 90) return "D90";
  return "BEYOND";
}

/**
 * The aging bucket of (maturityDate vs asOf) — the ar-queries convention:
 * notDue (overdueDays ≤ 0), 1–30, 31–60, 61–90, 90+ days overdue. Integral
 * day difference ((asOfMs − dueMs) / 86_400_000 | 0 — exact for whole dates).
 */
export function agingBucketOf(maturityDate: string, asOf: string): NoteAgingBucket {
  const asOfMs = new Date(`${asOf}T00:00:00Z`).getTime();
  const dueMs = new Date(`${maturityDate}T00:00:00Z`).getTime();
  const overdueDays = ((asOfMs - dueMs) / 86_400_000) | 0;
  if (overdueDays <= 0) return "notDue";
  if (overdueDays <= 30) return "1_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  return "90_plus";
}

/** Partner identity batch read (the as-of register rows carry partner_id only). */
async function partnerNames(
  partnerIds: readonly string[],
): Promise<Map<string, { name: string | null; nameAr: string | null }>> {
  const names = new Map<string, { name: string | null; nameAr: string | null }>();
  if (partnerIds.length === 0) return names;
  const rows = await tenantTx().execute(sql`
    SELECT id, name, name_ar AS "nameAr" FROM partners
    WHERE id IN (${sql.join(
      partnerIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
  `);
  for (const row of rows.rows as unknown as { id: string; name: string | null; nameAr: string | null }[]) {
    names.set(row.id, { name: row.name, nameAr: row.nameAr });
  }
  return names;
}

/**
 * PHASE-031 (0042 — the group-by-claim report parameter): source invoice
 * id → its external insurer claim reference, batch-read over the register's
 * notes whose source_type is 'sales_invoice' (claim notes settle claim
 * invoices; the claim ref rides through the note's source reference).
 * Invoices without a claim ref (self-pay / non-claim) never map — their
 * rows render the null group. Read-only over the sales module's PUBLISHED
 * sales_invoices table (ADR-0011 — the partnerNames precedent).
 */
async function sourceClaimRefs(
  register: readonly NotesAsOfRow[],
): Promise<Map<string, string>> {
  const sourceIds = [
    ...new Set(
      register
        .filter((note) => note.sourceType === "sales_invoice" && note.sourceId !== null)
        .map((note) => note.sourceId!),
    ),
  ];
  const refs = new Map<string, string>();
  if (sourceIds.length === 0) return refs;
  const rows = await tenantTx().execute(sql`
    SELECT id::text AS id, claim_ref AS "claimRef" FROM sales_invoices
    WHERE claim_ref IS NOT NULL
      AND id IN (${sql.join(
        sourceIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
  `);
  for (const row of rows.rows as unknown as { id: string; claimRef: string }[]) {
    refs.set(row.id, row.claimRef);
  }
  return refs;
}

/** The live-as-of register (the shared population of the calendar/aging/ties). */
async function liveNotesAsOf(asOf: string): Promise<NotesAsOfRow[]> {
  const register = await notesAsOf({ asOf, limit: REGISTER_ROW_LIMIT });
  return register.filter((note) => LIVE_STATUSES.includes(note.statusAsOf));
}

// -- notes.maturity-calendar ----------------------------------------------------------

/** One maturity-calendar row (a live-as-of note with its BR-045 bucket). */
export interface MaturityCalendarRow {
  noteId: string;
  kind: "CHEQUE" | "PROMISSORY_NOTE";
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  partnerName: string | null;
  partnerNameAr: string | null;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  /** amount × the effective stored rate (INV-008 — the tie currency). */
  baseAmount: string;
  maturityDate: string;
  statusAsOf: NoteStatus;
  bucket: MaturityBucket;
  /** PHASE-031 (0042): the SOURCE invoice's claim ref (null when the note
   *  settles no claim invoice) — the group-by-claim grouping key. */
  claimRef: string | null;
}

/** One notes-aging row (a live-as-of note with its bucket + both currencies). */
export interface NotesAgingRow {
  noteId: string;
  number: string | null;
  direction: "RECEIVED" | "ISSUED";
  partnerName: string | null;
  partnerNameAr: string | null;
  currency: string;
  amount: string;
  /** amount × the effective stored rate (the bucket/tie currency). */
  baseAmount: string;
  maturityDate: string;
  statusAsOf: NoteStatus;
  bucket: NoteAgingBucket;
  /** PHASE-031 (0042): the SOURCE invoice's claim ref (null when the note
   *  settles no claim invoice) — the group-by-claim grouping key. */
  claimRef: string | null;
}

/** One tie side: the register fold vs the GL balance of the mapped accounts. */
export interface NotesTieSide {
  purposeKey: "NOTES_RECEIVABLE" | "NOTES_PAYABLE";
  direction: "RECEIVED" | "ISSUED";
  registerTotal: string;
  glTotal: string;
  accountCodes: readonly string[];
}

export interface NotesTieSides {
  received: NotesTieSide;
  issued: NotesTieSide;
}

/** Exact-equality check over a tie side (tolerance 0 — RC-11/RECONCILIATION §2). */
export function tieSideBroken(side: NotesTieSide): boolean {
  return compareExact(side.registerTotal, side.glTotal) !== 0;
}

@Injectable()
export class NotesQueriesService {
  /**
   * `notes.maturity-calendar` (BR-045 — the PDC calendar auto-derived from
   * maturity_date): every note LIVE as-of with its maturity bucket, partner,
   * bank and instrument furniture. Display filters (direction/partner/bank)
   * apply HERE; the ledger tie is computed separately, whole tenant
   * (`maturityCalendarTies`).
   */
  async maturityCalendar(input: {
    asOf: string;
    direction: string | null;
    partnerId: string | null;
    bank: string | null;
  }): Promise<MaturityCalendarRow[]> {
    const base = await ownTenantBaseCurrency();
    const register = await liveNotesAsOf(input.asOf);
    const names = await partnerNames([...new Set(register.map((note) => note.partnerId))]);
    // PHASE-031 (0042): the source-invoice claim refs — the group-by-claim
    // grouping key rides the note→invoice source reference.
    const claimRefs = await sourceClaimRefs(register);
    const rows: MaturityCalendarRow[] = [];
    for (const note of register) {
      if (input.direction !== null && note.direction !== input.direction) continue;
      if (input.partnerId !== null && note.partnerId !== input.partnerId) continue;
      if (
        input.bank !== null &&
        (note.issuingBank === null || !note.issuingBank.toLowerCase().includes(input.bank.toLowerCase()))
      ) {
        continue;
      }
      const partner = names.get(note.partnerId);
      rows.push({
        noteId: note.id,
        kind: note.kind,
        direction: note.direction,
        partnerId: note.partnerId,
        partnerName: partner?.name ?? null,
        partnerNameAr: partner?.nameAr ?? null,
        number: note.number,
        issuingBank: note.issuingBank,
        amount: money4(note.amount),
        currency: note.currency,
        baseAmount: moneyRate(note.amount, effectiveNoteRate(note, base)),
        maturityDate: note.maturityDate,
        statusAsOf: note.statusAsOf,
        bucket: maturityBucketOf(note.maturityDate, input.asOf),
        claimRef:
          note.sourceType === "sales_invoice" && note.sourceId !== null
            ? (claimRefs.get(note.sourceId) ?? null)
            : null,
      });
    }
    return rows;
  }

  /**
   * The `inv024-custody-tie` sides (RC-11's register fold, date-anchored to
   * asOf; the GL side via journal.accountBalancesAt with the entry-date
   * anchor — see the header algebra). Whole tenant: the ledger check is
   * never narrowed by display filters. An unmapped purpose folds to a
   * 0.0000 GL side so register value with no GL account surfaces as drift.
   */
  async maturityCalendarTies(input: { asOf: string }): Promise<NotesTieSides> {
    const base = await ownTenantBaseCurrency();
    const register = await liveNotesAsOf(input.asOf);

    let receivedRegister = "0.0000";
    let issuedRegister = "0.0000";
    for (const note of register) {
      const contribution = moneyRate(note.amount, effectiveNoteRate(note, base));
      if (note.direction === "RECEIVED") {
        receivedRegister = addExact(receivedRegister, contribution);
      } else {
        issuedRegister = addExact(issuedRegister, contribution);
      }
    }

    const mappings = await journal.accountsForPurposes(["NOTES_RECEIVABLE", "NOTES_PAYABLE"]);
    const balances = await journal.accountBalancesAt({ asOfDate: input.asOf, asOf: null });
    const balanceByAccount = new Map(balances.map((b) => [b.accountId, b.signedBalance] as const));
    const codesByAccount = new Map(balances.map((b) => [b.accountId, b.code] as const));

    const side = (
      purposeKey: "NOTES_RECEIVABLE" | "NOTES_PAYABLE",
      direction: "RECEIVED" | "ISSUED",
      negate: boolean,
      registerTotal: string,
    ): NotesTieSide => {
      let glTotal = "0.0000";
      const accountCodes: string[] = [];
      for (const mapping of mappings) {
        if (mapping.purposeKey !== purposeKey) continue;
        const code = codesByAccount.get(mapping.accountId) ?? mapping.code;
        if (!accountCodes.includes(code)) accountCodes.push(code);
        const signed = balanceByAccount.get(mapping.accountId) ?? "0";
        const contribution = negate ? money4(`-${signed}`) : money4(signed);
        glTotal = money4(addExact(glTotal, contribution));
      }
      accountCodes.sort();
      return { purposeKey, direction, registerTotal: money4(registerTotal), glTotal, accountCodes };
    };

    return {
      received: side("NOTES_RECEIVABLE", "RECEIVED", false, receivedRegister),
      issued: side("NOTES_PAYABLE", "ISSUED", true, issuedRegister), // credit-positive
    };
  }

  // -- notes.aging ---------------------------------------------------------------------

  /**
   * `notes.aging`: the uncollected (live-as-of) notes with the ar-queries
   * maturity buckets vs asOf — one row per note. Display filters
   * (direction/partner) apply HERE; the footer ties are whole tenant
   * (`maturityCalendarTies`).
   */
  async aging(input: {
    asOf: string;
    direction: string | null;
    partnerId: string | null;
  }): Promise<NotesAgingRow[]> {
    const base = await ownTenantBaseCurrency();
    const register = await liveNotesAsOf(input.asOf);
    const names = await partnerNames([...new Set(register.map((note) => note.partnerId))]);
    // PHASE-031 (0042): the source-invoice claim refs — the group-by-claim
    // grouping key rides the note→invoice source reference.
    const claimRefs = await sourceClaimRefs(register);
    const rows: NotesAgingRow[] = [];
    for (const note of register) {
      if (input.direction !== null && note.direction !== input.direction) continue;
      if (input.partnerId !== null && note.partnerId !== input.partnerId) continue;
      const partner = names.get(note.partnerId);
      rows.push({
        noteId: note.id,
        number: note.number,
        direction: note.direction,
        partnerName: partner?.name ?? null,
        partnerNameAr: partner?.nameAr ?? null,
        currency: note.currency,
        amount: money4(note.amount),
        baseAmount: moneyRate(note.amount, effectiveNoteRate(note, base)),
        maturityDate: note.maturityDate,
        statusAsOf: note.statusAsOf,
        bucket: agingBucketOf(note.maturityDate, input.asOf),
        claimRef:
          note.sourceType === "sales_invoice" && note.sourceId !== null
            ? (claimRefs.get(note.sourceId) ?? null)
            : null,
      });
    }
    return rows;
  }

  // -- notes.dishonored-register -------------------------------------------------------

  /**
   * `notes.dishonored-register`: the DISHONOR events in the window (the
   * economic event_date anchor), joined to their notes + partners with the
   * G-26 restore provenance (journal entry id/no, reason, bank fee) — the
   * notes store's read-only window read.
   */
  async dishonoredRegister(input: {
    dateFrom: string;
    dateTo: string;
    partnerId: string | null;
    reasonContains: string | null;
  }): Promise<DishonoredNoteEventRow[]> {
    return listDishonorEvents({
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      partnerId: input.partnerId ?? undefined,
      reasonContains: input.reasonContains,
      limit: DISHONOR_ROW_LIMIT,
    });
  }
}
