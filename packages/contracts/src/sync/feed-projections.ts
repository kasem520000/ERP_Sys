/**
 * PHASE-022 · DR-P22-05 — the mobile feed LITE projections (LOCAL_DATABASE
 * §1.1 rule 3: explicit column subsets defined in `packages/contracts` so
 * the server feed writers and the device-side consumers share ONE shape).
 *
 * One interface per NEW pull entity type (the 020 precedent keeps its
 * projections inline in the server's change-log writer; every type added
 * from 022 on carries its payload contract here). These are the
 * `payload` objects of the pull envelope's change rows — money/quantities
 * are TEXT canonical decimal strings (ADR-0009 §4: never REAL, never
 * number), dates are ISO (`YYYY-MM-DD` for document dates, ISO timestamps
 * for changedAt), and every list is bounded by the source read model.
 *
 * Entity-type names (the wire vocabulary; recorded as the task-1-d
 * deviation note): `van_stocks` (PHASE-017 mirror table of the same name),
 * `routes` (route headers + their customer lists), `settlement_templates`
 * (the PHASE-017 `rep_settlements` read model — the field app's name for
 * the rep settlement day template; the source table name differs, the
 * entity type is the 022 mobile cache's), `statements` (per-partner
 * statement snapshots computed at pull time — no source table; the change
 * row's `id` is the partner id), `receipts` (treasury receipts headers),
 * `notifications` (the per-user notification cache).
 */

/** `van_stocks` — the van stock snapshot row (the PHASE-017 mirror,
 * refreshed from stock_moves inside the owning transaction). `id` is the
 * mirror row's uuid; the natural key is (warehouseId, itemId, batchId).
 * The feed re-emits the whole touched warehouse slice on every mirror
 * refresh (the 017 store rebuilds rows by delete+insert), so a device's
 * cache converges by last-writer-wins per `id`; keys that vanish from the
 * mirror are fed as op:'DELETE' + a tombstones row (the vanished-key diff
 * in the server's catch-up writer). */
export interface VanStockLite {
  readonly id: string;
  readonly version: number;
  readonly changedAt: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly batchId: string | null;
  /** TEXT decimal string, 6-dp quantities (numeric(19,6) at rest). */
  readonly qty: string;
  /** TEXT decimal string, 4-dp value (numeric(19,4) at rest). */
  readonly value: string;
  readonly refreshedAt: string;
}

/** `routes` — one route header plus its ordered customer list (the route
 * customers read model: the field app's route-visit list and the
 * statements-feed scope for the class). */
export interface RouteCustomerLite {
  readonly partnerId: string;
  readonly visitOrder: number;
  readonly isPinned: boolean;
}

export interface RouteLite {
  readonly id: string;
  readonly version: number;
  readonly changedAt: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly salesRepId: string | null;
  readonly vanWarehouseId: string | null;
  /** The weekday plan (jsonb at rest) — e.g. ["SUN","MON",…]. */
  readonly dayPattern: unknown;
  /** 'ACTIVE' | 'INACTIVE' (deactivation rides status; routes never delete). */
  readonly status: string;
  readonly customers: readonly RouteCustomerLite[];
}

/** `settlement_templates` — the rep settlement day template: the PHASE-017
 * `rep_settlements` header projection (DRAFT days are the template the rep
 * fills; status rides the payload — settlements are never deleted,
 * CANCELLED is ordinary data). `settlementNo` is null until numbering
 * assigns it at posting. */
export interface SettlementTemplateLite {
  readonly id: string;
  readonly version: number;
  readonly changedAt: string;
  readonly settlementNo: string | null;
  readonly salesRepId: string;
  readonly vanWarehouseId: string | null;
  readonly shiftId: string | null;
  /** ISO date (YYYY-MM-DD). */
  readonly settlementDate: string;
  /** 'DRAFT' | 'COUNTED' | 'APPROVED' | 'POSTED' | 'CANCELLED'. */
  readonly status: string;
  /** TEXT 4-dp decimal strings (numeric(19,4) at rest). */
  readonly openingCash: string;
  readonly cashSales: string;
  readonly collections: string;
  readonly cashRefunds: string;
  readonly repExpenses: string;
  readonly expectedCash: string;
  readonly countedCash: string | null;
  readonly variance: string | null;
  /** 'SHORTAGE' | 'SURPLUS' | 'NONE' | null. */
  readonly varianceDirection: string | null;
  readonly depositAmount: string | null;
}

/** `statements` — one partner's statement snapshot as of the pull
 * (computed per pull over the AR subledger, the PHASE-012/13 read model;
 * LOCAL_DATABASE §1.1: personal rows are partner-authorized server-side
 * before they enter the feed). The change row's `id` IS the partner id;
 * `version` is null on the wire (no server row version — the snapshot is
 * synthetic, the permissions-entity precedent). */
export interface StatementEntryLite {
  /** ISO date (YYYY-MM-DD). */
  readonly entryDate: string;
  readonly docRef: string | null;
  readonly sourceType: string;
  readonly currencyCode: string;
  readonly debit: string;
  readonly credit: string;
  readonly balance: string;
  readonly outstanding: string;
}

export interface StatementLite {
  readonly partnerId: string;
  readonly customerCode: string;
  readonly customerName: string;
  readonly customerNameAr: string | null;
  /** ISO date (YYYY-MM-DD) — the as-of the snapshot was computed at. */
  readonly asOf: string;
  readonly currencyCode: string;
  readonly openingBalance: string;
  readonly entries: readonly StatementEntryLite[];
  readonly closingBalance: string;
  readonly closingBalanceBase: string;
  readonly aging: {
    readonly not_due: string;
    readonly "1_30": string;
    readonly "31_60": string;
    readonly "61_90": string;
    readonly "90_plus": string;
  };
  /** ISO timestamp — the snapshot generation time (refreshed on content
   * change or at the latest every ~6 days; clients render the as-of label
   * from this, stale is labeled, never guessed). */
  readonly generatedAt: string;
}

/** `receipts` — the treasury receipt header projection (personal feeds
 * only; `partnerId` is the partner-scope key). Status rides the payload —
 * receipts are never deleted (CANCELLED is ordinary data); `receiptNo` is
 * null until posting. */
export interface ReceiptLite {
  readonly id: string;
  readonly version: number;
  readonly changedAt: string;
  readonly receiptNo: string | null;
  /** 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'POSTED' | 'CANCELLED'. */
  readonly status: string;
  /** The partner-scope key (the personal serve filter). */
  readonly partnerId: string;
  /** 'CASH' | 'BANK' | 'CHEQUE' | 'CARD' | 'TRANSFER'. */
  readonly method: string;
  readonly currencyCode: string;
  /** TEXT 4-dp decimal string. */
  readonly amount: string;
  /** ISO date (YYYY-MM-DD). */
  readonly valueDate: string;
  readonly reference: string | null;
  readonly postedAt: string | null;
}

/** `notifications` — the per-user notification cache (personal feeds
 * only; `userId` is the per-user scope key — a null-user row is a
 * broadcast that no personal feed ever serves). */
export interface NotificationLite {
  readonly id: string;
  readonly version: number;
  readonly changedAt: string;
  /** The per-user scope key (the personal serve filter). */
  readonly userId: string | null;
  /** 'limits' | 'subscription' | 'reconciliation' | 'invoice_overdue'. */
  readonly category: string;
  /** 'info' | 'warning' | 'critical'. */
  readonly severity: string;
  /** Bilingual {ar, en} jsonb at rest. */
  readonly title: unknown;
  readonly body: unknown;
  readonly actionLabel: unknown;
  readonly actionUrl: string | null;
  readonly readAt: string | null;
}
