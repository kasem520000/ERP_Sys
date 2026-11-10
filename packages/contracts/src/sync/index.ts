import { z } from "zod";

import { ISO_DATE_PATTERN, MONEY_AMOUNT_PATTERN, QUANTITY_PATTERN } from "../wire";

/**
 * PHASE-016 · the sync wire contracts (SYNC_PROTOCOL §2/§3 + §11 — the
 * POS-scoped subset): ONE source of truth shared by the server push/pull
 * services and the device-side sync-core. The generalized PHASE-020
 * protocol keeps these shapes verbatim (§11 rule 1: the subset is in
 * scope, not in format; rule 3: 020 must accept a 016 terminal on day
 * one via the contract-version gate).
 *
 * PHASE-020 · contracts v2 (MASTER-PLAN §2 — SYNC_PROTOCOL §2/§3/§9,
 * LOCAL_DATABASE §1.1, CONFLICT_RESOLUTION §3): the v2 additions are
 * ADDITIVE ONLY — every 016 export keeps its name and shape byte-for-byte
 * (the pull envelope gains optional fields, the push result gains an
 * extended superset type, the rejection registry grows around the POS
 * subset). The v2 section below is the 020 wire surface; the 016 section
 * above it stays the 016 terminal's contract.
 */

/** The POS feed group (§11 boundary — pulled read-caches, nothing else). */
export const POS_FEED_ENTITY_TYPES = [
  "items",
  "barcodes",
  "uoms",
  "price_list_items",
  "partners",
  "tax_codes",
] as const;

export type PosFeedEntityType = (typeof POS_FEED_ENTITY_TYPES)[number];

export const POS_FEED_ENTITY_TYPE_SCHEMA = z.enum(POS_FEED_ENTITY_TYPES);

/** Pull envelope (§2): opaque cursor + ordered changes. The PHASE-020
 * additions are optional + additive: `nextCursor`/`serverTime`/
 * `contractVersion`/`resync` (C-12 bounded-restart directive) and the
 * per-change server row `version` (DELETE entries carry null) — a 016
 * envelope without them parses identically. */
export const pullEnvelopeSchema = z.object({
  entityType: z.string().min(2).max(40),
  cursor: z.string().min(1),
  hasMore: z.boolean(),
  changes: z
    .array(
      z.object({
        id: z.string().min(1),
        seq: z.number().int().nonnegative(),
        op: z.enum(["UPSERT", "DELETE"]),
        payload: z.record(z.string(), z.unknown()).nullable(),
        changedAt: z.string().min(4),
        // PHASE-020: the server row version (optimistic-concurrency source,
        // CONFLICT_RESOLUTION §4) — null on DELETE feed entries.
        version: z.number().int().nonnegative().nullable().optional(),
      }),
    )
    .max(1000),
  // PHASE-020 v2 fields (all optional — absent on the 016 wire).
  nextCursor: z.string().optional(),
  serverTime: z.string().optional(),
  contractVersion: z.string().optional(),
  resync: z.boolean().optional(),
});

export type PullEnvelope = z.infer<typeof pullEnvelopeSchema>;

/** A single change applied through the device store's local transaction. */
export interface PullChange {
  readonly id: string;
  readonly seq: number;
  readonly op: "UPSERT" | "DELETE";
  readonly payload: Record<string, unknown> | null;
  readonly changedAt: string;
  /** PHASE-020: the server row version (null on DELETE entries). */
  readonly version?: number | null;
}

// -- push commands (§3 + §11) ----------------------------------------------------

const money = z.string().regex(MONEY_AMOUNT_PATTERN);
const qty = z.string().regex(QUANTITY_PATTERN);

/** `pos_sale` — the invoice + lines + tenders aggregate (a POS sale IS a
 * sales invoice; the server executes through the sales module service +
 * posting engine — never a second business-logic path). */
export const posSaleCommandSchema = z.object({
  type: z.literal("pos_sale"),
  id: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(120),
  createdAt: z.string().min(4),
  sale: z.object({
    clientId: z.string().uuid(),
    terminalId: z.string().uuid(),
    offlineReceiptNo: z.string().min(1).max(60),
    invoiceDate: z.string().regex(ISO_DATE_PATTERN),
    customerId: z.string().uuid().nullable(),
    orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "COUNTER"]),
    checkId: z.string().uuid().nullable().optional(),
    lines: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          qty,
          unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/),
          discountAmount: money.nullable().optional(),
          taxCodeId: z.string().uuid().nullable().optional(),
          serialIds: z.array(z.string().uuid()).nullable().optional(),
        }),
      )
      .min(1)
      .max(200),
    tenders: z
      .array(
        z.object({
          method: z.enum(["CASH", "CARD"]),
          amount: z.string().regex(/^\d+(\.\d{1,4})?$/),
          reference: z.string().max(80).nullable().optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
});

export type PosSaleCommand = z.infer<typeof posSaleCommandSchema>;

/** `cashier_shift` — open/close events over the treasury shift model. */
export const cashierShiftCommandSchema = z.object({
  type: z.literal("cashier_shift"),
  id: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(120),
  createdAt: z.string().min(4),
  event: z.enum(["open", "close"]),
  shift: z.object({
    terminalId: z.string().uuid(),
    clientId: z.string().uuid().optional(),
    openingAmount: money.optional(),
    denominations: z.record(z.string(), z.string()).nullable().optional(),
    reason: z.string().max(500).nullable().optional(),
    supervisorId: z.string().max(80).nullable().optional(),
    supervisorPin: z.string().max(12).nullable().optional(),
  }),
});

export type CashierShiftCommand = z.infer<typeof cashierShiftCommandSchema>;

/** The per-item push results (§3): ACCEPTED / REJECTED / DEFERRED. */
export const POS_REJECTION_REASONS = [
  "PERIOD_LOCKED",
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "CREDIT_LIMIT_EXCEEDED",
  "VALIDATION_ERROR",
  "DEVICE_REVOKED",
] as const;

export type PosRejectionReason = (typeof POS_REJECTION_REASONS)[number];

/** CONFLICT_RESOLUTION §3: the user action per typed rejection code. */
export type RejectionAction = "EDIT_AND_RESEND" | "ACCEPT_SERVER_PRICE" | "CANCEL_WITH_REASON";

export function actionForRejection(reason: PosRejectionReason): RejectionAction {
  switch (reason) {
    case "PRICE_CHANGED":
      return "ACCEPT_SERVER_PRICE";
    case "VALIDATION_ERROR":
      return "EDIT_AND_RESEND";
    default:
      return "CANCEL_WITH_REASON";
  }
}

export type PushItemResult =
  | {
      id: string;
      status: "ACCEPTED";
      idempotencyKey: string;
      result: Record<string, unknown>;
    }
  | {
      id: string;
      status: "REJECTED";
      idempotencyKey: string;
      reason: PosRejectionReason;
      message: string;
      details?: Record<string, unknown>;
      action: RejectionAction;
    }
  | {
      id: string;
      status: "DEFERRED";
      idempotencyKey: string;
      reason: string;
      message: string;
    };

export const pushResponseSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["ACCEPTED", "REJECTED", "DEFERRED"]),
        idempotencyKey: z.string(),
      }),
    )
    .max(50),
});

/** The max batch budget (§3 + phase §6 performance budgets). */
export const MAX_PUSH_BATCH = 50;

// -- PHASE-020 · contracts v2 (MASTER-PLAN §2) ------------------------------------
//
// Everything below extends the 016 surface ADDITIVELY: no export above
// changes name or shape; a 016 POS terminal keeps working byte-identically
// (§11 rule 3). The v2 pull envelope fields and the per-change `version`
// are optional on the wire; the v2 rejection registry strictly contains
// POS_REJECTION_REASONS; the v2 result type is a superset of
// PushItemResult.

/** The current sync contract version (MASTER-PLAN §0). The grace list is
 * the set of older versions the server still accepts (the 016 baseline);
 * anything else → per-item CONTRACT_VERSION_UNSUPPORTED (C-08). */
export const SYNC_CONTRACT_VERSION = "2026-11-04.1";
export const SYNC_CONTRACT_GRACE = ["2026-10-27.1"] as const;

export function isContractSupported(version: string): boolean {
  return version === SYNC_CONTRACT_VERSION || (SYNC_CONTRACT_GRACE as readonly string[]).includes(version);
}

/** Device classes (LOCAL_DATABASE §1.1): the class resolves the feed group
 * + capability scoping; `platform` (003) stays for back-compat. */
export const DEVICE_CLASSES = [
  "pos-terminal",
  "tauri-desktop",
  "android-field",
  "android-personal",
] as const;

export type DeviceClass = (typeof DEVICE_CLASSES)[number];

/** Capability classes (PHASE-020 phase doc §2; OFFLINE_CAPABILITIES_MATRIX
 * rows): the per-entity offline behavior vocabulary. */
export const CAPABILITY_CLASSES = [
  "OFFLINE-COMPLETE",
  "OFFLINE-DRAFT",
  "LOCALLY-VALIDATED-PENDING-SERVER",
  "READ-CACHED",
  "ONLINE-ONLY",
] as const;

export type CapabilityClass = (typeof CAPABILITY_CLASSES)[number];

/** The POS feed group — the pull scope base every write-capable class
 * rides (MASTER-PLAN §2): the 016 read-caches + terminal config + cashier
 * shifts. */
const POS_FEED_GROUP = [
  "items",
  "barcodes",
  "uoms",
  "price_list_items",
  "partners",
  "tax_codes",
  "pos_terminals",
  "cashier_shifts",
] as const;

/** PHASE-022 · DR-P22-05 — the field feed group (MASTER-PLAN §0 golden
 * constants): the POS base + the field-sales read models — the van stock
 * snapshot (`van_stocks`, the PHASE-017 mirror), route customers (`routes`,
 * headers + their customer lists), the rep settlement template
 * (`settlement_templates`, the PHASE-017 `rep_settlements` read model —
 * the 022 mobile cache's name for it), and per-partner statements
 * (`statements`, computed per pull over the AR subledger; the field serve
 * is scoped to route customers, LOCAL_DATABASE §1.1). */
const FIELD_FEED_GROUP = [
  ...POS_FEED_GROUP,
  "van_stocks",
  "routes",
  "settlement_templates",
  "statements",
] as const;

/** PHASE-022 · DR-P22-05 — the personal feed group (MASTER-PLAN §0 golden
 * constants): the personal read models, partner-scoped server-side (the
 * linked partner ONLY — LOCAL_DATABASE §1.1 rule 2: a tampered device
 * cannot pull other partners' rows; a device without linkage pulls an
 * empty scope, fail closed). `statements` is per-partner (linked partner);
 * `sales_invoices`/`receipts` carry the partner key in the payload;
 * `notifications` is per device user. */
const PERSONAL_FEED_GROUP = ["statements", "sales_invoices", "receipts", "notifications"] as const;

/** Feed groups per device class (pull scope — server-enforced; a device
 * asking outside its group gets SYNC_ENTITY_NOT_PULLED, no existence
 * leak). desktop adds the sales-invoice read cache (DRAFT+POSTED
 * headers). PHASE-022 (DR-P22-05): field gains the field-sales read
 * models (van_stocks/routes/settlement_templates + route-customer
 * statements); personal — honestly empty through 021 — gains the
 * partner-scoped personal read models. */
export const FEED_GROUPS = {
  pos: POS_FEED_GROUP,
  desktop: [...POS_FEED_GROUP, "sales_invoices"],
  field: FIELD_FEED_GROUP,
  personal: PERSONAL_FEED_GROUP,
} as const;

export type FeedGroupKey = keyof typeof FEED_GROUPS;

/** Every entity type any feed group can pull (deduped flat). */
export const PULLED_ENTITY_TYPES = [
  ...new Set(Object.values(FEED_GROUPS).flat()),
] as const;

export type PulledEntityType = (typeof PULLED_ENTITY_TYPES)[number];

/** The synthetic permissions snapshot entity (MASTER-PLAN §10): every
 * device class pulls it every cycle (the device user's effective
 * permission keys, chunked ≤ 500 per change row). */
export const PERMISSIONS_ENTITY_TYPE = "permissions";

/** The generalized rejection registry (CONFLICT_RESOLUTION §3 + §2
 * ONLINE_ONLY row): the 016 six plus the 020 codes. Strict superset of
 * POS_REJECTION_REASONS (asserted below). */
export const SYNC_REJECTION_REASONS = [
  "PERIOD_LOCKED",
  "PRICE_CHANGED",
  "INSUFFICIENT_STOCK",
  "CREDIT_LIMIT_EXCEEDED",
  "STALE_VERSION",
  "VALIDATION_ERROR",
  "ITEM_INACTIVE",
  "PARTNER_INACTIVE",
  "DUPLICATE_COMMAND",
  "DEVICE_REVOKED",
  "TENANT_SUSPENDED",
  "CONTRACT_VERSION_UNSUPPORTED",
  "FORBIDDEN",
] as const;

export type SyncRejectionReason = (typeof SYNC_REJECTION_REASONS)[number];

// Static subset proof (016 compat): every POS reason is a sync reason —
// the narrow registry never escapes the generalized one, so a 016 result
// object structurally satisfies the v2 result type.
const POS_REASONS_ARE_SYNC_REASONS: readonly SyncRejectionReason[] = POS_REJECTION_REASONS;
void POS_REASONS_ARE_SYNC_REASONS;

/** CONFLICT_RESOLUTION §3 (v2 codes): the user action per typed sync
 * rejection — the v2 counterpart of actionForRejection (which stays
 * untouched for the 016 POS reasons). */
export function actionForSyncRejection(reason: SyncRejectionReason): RejectionAction {
  switch (reason) {
    case "PRICE_CHANGED":
      return "ACCEPT_SERVER_PRICE";
    case "ITEM_INACTIVE":
    case "PARTNER_INACTIVE":
    case "DUPLICATE_COMMAND":
    case "DEVICE_REVOKED":
    case "TENANT_SUSPENDED":
    case "CONTRACT_VERSION_UNSUPPORTED":
    case "FORBIDDEN":
      return "CANCEL_WITH_REASON";
    default:
      // PERIOD_LOCKED / INSUFFICIENT_STOCK / CREDIT_LIMIT_EXCEEDED /
      // VALIDATION_ERROR / STALE_VERSION — the doc's first-listed action
      // for each is edit-and-resend (STALE_VERSION is review-and-merge,
      // which the client renders as the edit path).
      return "EDIT_AND_RESEND";
  }
}

/** The generic resubmittable default per reason (MASTER-PLAN §2): false
 * for the administrative/terminal codes, true otherwise. The server may
 * still stamp a per-item `resubmittable: false` on a specific rejection
 * (e.g. C-11's stale push referencing a deleted item) — this map is the
 * client-side default, not a per-command verdict. */
export const RESUBMITTABLE_BY_REASON: Record<SyncRejectionReason, boolean> = {
  PERIOD_LOCKED: true,
  PRICE_CHANGED: true,
  INSUFFICIENT_STOCK: true,
  CREDIT_LIMIT_EXCEEDED: true,
  STALE_VERSION: true,
  VALIDATION_ERROR: true,
  // Deactivated master data (C-11 binding): the same command can never
  // succeed on retry — the user must cancel or substitute-and-resend
  // (CONFLICT_RESOLUTION §3 row; action CANCEL_WITH_REASON). MASTER-PLAN
  // §2's "true otherwise" list was the pre-scoping spelling; §14 + the
  // actions table win (orchestrator decision DR-P20-01).
  ITEM_INACTIVE: false,
  PARTNER_INACTIVE: false,
  DUPLICATE_COMMAND: false,
  DEVICE_REVOKED: false,
  TENANT_SUSPENDED: false,
  CONTRACT_VERSION_UNSUPPORTED: false,
  FORBIDDEN: false,
};

/** Entity types that are NEVER writable from a device (MASTER-PLAN §6.6 —
 * the ONLINE_ONLY guard): a push naming one is REJECTED FORBIDDEN with
 * resubmittable:false before any handler runs. */
export const ONLINE_ONLY_ENTITIES = [
  "roles",
  "entitlements",
  "tenant_settings",
  "users",
  "journal_entries",
  "accounting_periods",
  "chart_of_accounts",
  "tax_registrations",
] as const;

export type OnlineOnlyEntity = (typeof ONLINE_ONLY_ENTITIES)[number];

/** The v2 command envelope (SYNC_PROTOCOL §3.2): entityType+intent name the
 * handler ("entityType:intent" registry key); commandId is the client
 * UUIDv7 (the inbox dedupe key with the device); baseVersion is the
 * optimistic-concurrency guard for edit intents (CONFLICT_RESOLUTION §4);
 * clientCreatedAt is advisory only (§7 clock skew); localRef is the
 * device-side reference for UI surfacing. */
export const syncCommandSchema = z.object({
  commandId: z.string().uuid(),
  entityType: z.string().min(2).max(40),
  intent: z.string().min(2).max(40),
  idempotencyKey: z.string().min(8).max(120),
  baseVersion: z.number().int().nonnegative().optional(),
  clientCreatedAt: z.string().min(4),
  localRef: z.string().max(80).optional(),
  payload: z.unknown(),
});

export type SyncCommandV2 = z.infer<typeof syncCommandSchema>;

/** The v2 push request (SYNC_PROTOCOL §3): `contractVersion` absent means
 * the 016 legacy shape ({batchId, commands: [{type: "pos_sale" | ...}]}).
 * Commands are `unknown` at the envelope level — each is parsed to v2
 * (intent + entityType present) or legacy (`type` present) per item. */
export const pushRequestSchema = z.object({
  contractVersion: z.string().optional(),
  commands: z.array(z.unknown()).max(MAX_PUSH_BATCH),
});

export type PushRequestV2 = z.infer<typeof pushRequestSchema>;

/** The v2 per-result extensions (MASTER-PLAN §1.1): every field optional —
 * the 016 wire stays byte-identical; v2 clients read what their intents
 * produce. `duplicate: true` marks an inbox replay (C-01/C-04). */
export interface PushItemResultV2Extension {
  commandId?: string;
  duplicate?: true;
  entity?: { id: string; version: number };
  officialNumber?: string;
  effects?: {
    journalEntryIds?: string[];
    stockMoveIds?: string[];
  };
  resubmittable?: boolean;
  localized?: { ar: string; en: string };
}

/** The v2 push result: the 016 shapes with the REJECTED reason widened to
 * the sync registry (POS reasons remain assignable — see the subset proof
 * above) plus the v2 extensions. Server results satisfy PushItemResult on
 * the legacy path and PushItemResultV2 everywhere. */
export type PushItemResultV2 =
  | ({
      id: string;
      status: "ACCEPTED";
      idempotencyKey: string;
      result: Record<string, unknown>;
    } & PushItemResultV2Extension)
  | ({
      id: string;
      status: "REJECTED";
      idempotencyKey: string;
      reason: SyncRejectionReason;
      message: string;
      details?: Record<string, unknown>;
      action: RejectionAction;
    } & PushItemResultV2Extension)
  | ({
      id: string;
      status: "DEFERRED";
      idempotencyKey: string;
      reason: string;
      message: string;
    } & PushItemResultV2Extension);

// -- per-intent payload schemas (MASTER-PLAN §7 conflict policies) -----------------

/** `partner:contact_merge` (FIELD_LEVEL_MERGE): partnerId + the whitelisted
 * non-constrained contact fields ONLY — at least one must be present;
 * constrained fields (creditLimit, paymentTerms, taxNumber, priceListId,
 * status) never ride this payload (the server rejects their presence with
 * VALIDATION_ERROR + details.constrainedFields, zero merge). */
export const partnerContactMergeSchema = z
  .object({
    partnerId: z.string().uuid(),
    phone: z.string().max(200).optional(),
    phone2: z.string().max(200).optional(),
    email: z.string().max(200).optional(),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(200).optional(),
    contactPerson: z.string().max(200).optional(),
  })
  .refine(
    (fields) =>
      fields.phone !== undefined ||
      fields.phone2 !== undefined ||
      fields.email !== undefined ||
      fields.addressLine1 !== undefined ||
      fields.addressLine2 !== undefined ||
      fields.city !== undefined ||
      fields.contactPerson !== undefined,
    { message: "partner:contact_merge requires at least one whitelisted contact field" },
  );

export type PartnerContactMergePayload = z.infer<typeof partnerContactMergeSchema>;

/** The draft-invoice line snapshot (the posSaleCommandSchema line shape —
 * money/qty as canonical decimal strings, ADR-0009): the aggregate rides
 * the command wholesale (document-before-lines is intra-command). */
const draftInvoiceLineSchema = z.object({
  itemId: z.string().uuid(),
  qty,
  unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/),
  discountAmount: money.nullable().optional(),
  taxCodeId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).optional(),
});

/** `sales_invoice:create_draft` (OWNER_DEVICE_WINS): the aggregate the
 * device captured offline; the server creates the DRAFT through the sales
 * module service and stamps owner_device_id = the pushing device. */
export const draftInvoiceCreateSchema = z.object({
  customerId: z.string().uuid().nullable(),
  orderDate: z.string().regex(ISO_DATE_PATTERN),
  lines: z.array(draftInvoiceLineSchema).min(1).max(200),
});

export type DraftInvoiceCreatePayload = z.infer<typeof draftInvoiceCreateSchema>;

/** `sales_invoice:update_draft` (OWNER_DEVICE_WINS + baseVersion): the
 * full aggregate snapshot (lines replace wholesale); baseVersion rides
 * the COMMAND envelope (syncCommandSchema), compared server-side before
 * execution — mismatch → STALE_VERSION with details.currentVersion. */
export const draftInvoiceUpdateSchema = z.object({
  invoiceId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  orderDate: z.string().regex(ISO_DATE_PATTERN),
  lines: z.array(draftInvoiceLineSchema).min(1).max(200),
});

export type DraftInvoiceUpdatePayload = z.infer<typeof draftInvoiceUpdateSchema>;

// -- PHASE-021 · DR-P21-08 · the desktop write-intent payload schemas ------------
//
// ADDITIVE, VERSION-FROZEN (MASTER-PLAN §6 table): per-intent payload
// schemas for the seven desktop write intents, riding the v2 command
// envelope above unchanged. Each mirrors the OWNING module service's
// create/draft input; CREATE-draft only (no offline update intents for
// the new types — DR-P21-08).
export {
  cashTransferCreateDraftPayloadSchema,
  deliveryNoteCreateDraftPayloadSchema,
  expenseCreatePayloadSchema,
  partnerCreatePayloadSchema,
  quotationCreateDraftPayloadSchema,
  stockCountSubmitLinesPayloadSchema,
  stockTransferCreateDraftPayloadSchema,
  type CashTransferCreateDraftPayload,
  type DeliveryNoteCreateDraftPayload,
  type ExpenseCreatePayload,
  type PartnerCreatePayload,
  type QuotationCreateDraftPayload,
  type StockCountSubmitLinesPayload,
  type StockTransferCreateDraftPayload,
} from "./desktop-intents";

// -- PHASE-022 · DR-P22-06 · the field write-intent payload schemas ------------
//
// ADDITIVE, VERSION-FROZEN (the DR-P21-08 rules, applied to the 022 field
// intents): per-intent payload schemas riding the v2 command envelope above
// unchanged. Each mirrors the OWNING module service's create/post input
// (receipt treasury create+post chain, the PHASE-017 van transfer chain,
// the sales credit-note draft); CREATE only (no offline update intents).
export {
  creditNoteCreateDraftPayloadSchema,
  receiptCreateFieldCollectionPayloadSchema,
  vanConfirmLoadPayloadSchema,
  vanConfirmUnloadPayloadSchema,
  type CreditNoteCreateDraftPayload,
  type ReceiptCreateFieldCollectionPayload,
  type VanConfirmLoadPayload,
  type VanConfirmUnloadPayload,
} from "./field-intents";

// -- PHASE-022 · DR-P22-05 · the mobile feed LITE payload shapes -----------------
//
// Explicit column subsets for the 022 feed entities (LOCAL_DATABASE §1.1
// rule 3: defined here so the server feed writers and the device-side
// consumers share ONE shape; money/quantities as TEXT canonical decimal
// strings — ADR-0009).
export type {
  NotificationLite,
  ReceiptLite,
  RouteCustomerLite,
  RouteLite,
  SettlementTemplateLite,
  StatementEntryLite,
  StatementLite,
  VanStockLite,
} from "./feed-projections";

// -- PHASE-020 · the machine capabilities fixture (MASTER-PLAN §15, T17) --------
//
// The capabilities manifest the `check:capabilities-matrix` gate
// cross-checks against OFFLINE_CAPABILITIES_MATRIX.md §2 (see
// ./capabilities for the row semantics; standalone on purpose — no
// back-import from here, dependency-cruiser `no-circular`).
export {
  SYNC_CAPABILITY_FIXTURE,
  type MatrixCapabilityClass,
  type MatrixConflictPolicy,
  type MatrixDeviceClass,
  type SyncCapabilityRow,
} from "./capabilities";
