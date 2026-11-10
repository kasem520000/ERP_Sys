/**
 * PHASE-020/021/022 · the machine capabilities fixture (MASTER-PLAN §15, T17).
 *
 * ONE source of truth the `check:capabilities-matrix` gate
 * (scripts/check-capabilities-matrix.ts) cross-checks against
 * OFFLINE_CAPABILITIES_MATRIX.md §2 row by row: implemented intents ×
 * device class × capability class × conflict policy. The matrix is the
 * normative scope; this fixture is the machine-readable claim of what is
 * TRUE TODAY, plus the explicit deferral annotations the checker demands
 * (rule d: an offline-capability cell due by PHASE-020 that is not live
 * must carry an `implemented: false` row naming the phase it lands in —
 * the honest-deferral contract of MASTER-PLAN §1.5).
 *
 * Row kinds:
 *  - `implemented: true`  — live in the codebase today, proven by `gate`
 *    (a spec/test path or chaos-matrix case). The set is EXACTLY:
 *    the PHASE-016 ✓ rows (matrix §1 legend: #1–#5, #8, #23, #31, #32,
 *    #33, #35 — the POS-terminal column) + the PHASE-020 generalized
 *    rows (the desktop-column drafts: sales_invoice drafts + partner
 *    contact merge) + the PHASE-021 desktop column (matrix rows #4, #5,
 *    #7, #10, #11, #23, #25, #26, #32, #33, #34 — the read cache, the
 *    cache reprint, partner create, and the seven DR-P21-08 write
 *    intents; MASTER-PLAN §11) + the PHASE-022 android columns (matrix
 *    rows #4–#7, #9, #11–#14, #21, #23, #25, #27, #33, #35 android-field
 *    and #13, #14, #29 android-personal — DR-P22-05/06; the gates name
 *    the staged 022 specs exactly like the rows name the specs of their
 *    phase, and each row's note records what is live at which 022 wave).
 *    No extension ever passes a column without a gate.
 *  - `implemented: false` — an explicit deferred-phase annotation (no
 *    gate; `phase` names where it lands). Required by the checker for
 *    every offline-capability cell of a matrix row whose first phase is
 *    ≤ 020; other rows defer by their matrix Phase column alone.
 *
 * `operation` is the EXACT matrix §2 "Operation" spelling (the checker's
 * typo guard is an exact-name match — an unknown operation fails the gate).
 *
 * `capability` uses the matrix §1 spellings, incl. `LOCAL-VALID` (the
 * † LOCALLY-VALIDATED-PENDING-SERVER class); CAPABILITY_CLASSES in
 * ./index keeps the contracts-side spelling of the same class.
 *
 * This module is deliberately STANDALONE (zero imports — not even
 * type-only): ./index re-exports it, and a back-import would trip the
 * `no-circular` dependency-cruiser rule (DEPENDENCY_RULES §2.1).
 */

/** The four matrix device classes — mirrors DEVICE_CLASSES in ./index
 * (LOCAL_DATABASE §1.1); kept as a local literal so this module stays
 * acyclic (see the header note). The `_` prefix satisfies the unused-value
 * rule — the literal rides only in the derived type. */
const _MATRIX_DEVICE_CLASSES = [
  "pos-terminal",
  "tauri-desktop",
  "android-field",
  "android-personal",
] as const;

export type MatrixDeviceClass = (typeof _MATRIX_DEVICE_CLASSES)[number];

/** The matrix §1 capability-class spellings (OFFLINE_CAPABILITIES_MATRIX "Values"). */
export type MatrixCapabilityClass =
  | "OFFLINE-COMPLETE"
  | "OFFLINE-DRAFT"
  | "LOCAL-VALID"
  | "READ-CACHED"
  | "ONLINE-ONLY";

/** The matrix §1 conflict-policy codes (CONFLICT_RESOLUTION §2). */
export type MatrixConflictPolicy = "SD" | "SAS" | "FM" | "OD" | "RO" | "n/a";

/** One (operation × deviceClass) claim or deferral annotation. */
export interface SyncCapabilityRow {
  /** EXACT matrix §2 Operation cell (the checker matches by this name). */
  readonly operation: string;
  readonly deviceClass: MatrixDeviceClass;
  /** The capability class the matrix grants that cell (matrix §1 spelling). */
  readonly capability: MatrixCapabilityClass;
  /** The row's primary conflict policy (matrix "Conflict policy" first code). */
  readonly conflictPolicy: MatrixConflictPolicy;
  /** "016" | "020" | "021" | "022" | … — implemented rows: when it went live; deferred rows: when it lands. */
  readonly phase: string;
  /** True only for what is live in the codebase today. */
  readonly implemented: boolean;
  /** The spec/test that proves an implemented row (null on deferred rows). */
  readonly gate: string | null;
  /** Why a deferred row defers, or a scope note (never parsed by the checker). */
  readonly note?: string;
}

/**
 * The fixture. Implemented rows are the PHASE-016 ✓ surface (POS-terminal
 * column) + the PHASE-020 generalized foundation + the PHASE-021 desktop
 * column + the PHASE-022 android columns (DR-P22-05/06; the server feed
 * substrate + reused intents live, the field intents and on-device
 * surfaces land with the remaining 022 waves — every row's gate names
 * its proving specs, every note records the staging honestly).
 */
export const SYNC_CAPABILITY_FIXTURE: readonly SyncCapabilityRow[] = [
  // ---- PHASE-016 ✓ (POS-terminal column — the offline sale queue) --------------
  {
    operation: "POS sale (cash/card at counter)",
    deviceClass: "pos-terminal",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "pos/golden.spec (cash + split-tender + offline replay) + sync/chaos-matrix C-01/C-09",
  },
  {
    operation: "POS return/refund against receipt",
    deviceClass: "pos-terminal",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "pos/golden.spec (return W-3 — POS credit note at original cost)",
  },
  {
    operation: "Cashier shift open/close (float, count)",
    deviceClass: "pos-terminal",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "treasury/treasury-rules.spec (shift open/close + variance; the 016 cashier_shift command path)",
  },
  {
    operation: "Items / barcodes / prices lookup",
    deviceClass: "pos-terminal",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "016",
    implemented: true,
    gate: "sync/pull.spec (feed groups + projections)",
  },
  {
    operation: "Price list view",
    deviceClass: "pos-terminal",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "016",
    implemented: true,
    gate: "sync/pull.spec (price_list_items feed projection)",
  },
  {
    operation: "Receipt — POS cash collection",
    deviceClass: "pos-terminal",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "pos/golden.spec (cash tender DR till) + sync/chaos-matrix C-09",
  },
  {
    operation: "Partner create (new walk-in / route customer)",
    deviceClass: "pos-terminal",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "master-data-flows.db.spec (partner create) + sync/pull.spec (partners feed)",
  },
  {
    operation: "POS on-account (credit) sale to known customer",
    deviceClass: "pos-terminal",
    capability: "LOCAL-VALID",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "sales/operations.spec (BR-001 credit-limit matrix — the hard server decision)",
  },
  {
    operation: "Reprint of an already-POSTED receipt/invoice",
    deviceClass: "pos-terminal",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "RO",
    phase: "016",
    implemented: true,
    gate: "sync/pull.spec (synced-doc cache read; ADR-0011 local print templates)",
  },
  {
    operation: "Master-data search (items, partners)",
    deviceClass: "pos-terminal",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "016",
    implemented: true,
    gate: "sync/pull.spec (items + partners feeds)",
  },
  {
    operation: "Serial/IMEI or batch capture on sale line (where tracked)",
    deviceClass: "pos-terminal",
    capability: "LOCAL-VALID",
    conflictPolicy: "SD",
    phase: "016",
    implemented: true,
    gate: "pos/golden.spec (offline replay; serialIds ride the sale aggregate) — server re-check per SYNC_PROTOCOL §3.4",
  },

  // ---- PHASE-020 generalized (desktop-column drafts — MASTER-PLAN §1.5) -------
  {
    operation: "Sales invoice draft (back office)",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "OD",
    phase: "020",
    implemented: true,
    gate: "sync/policies.spec #3–#6 (create_draft/update_draft, owner_device_id) + sync/chaos-matrix C-10",
  },
  {
    operation: "Partner edit — contact fields (phone, email, address)",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "FM",
    phase: "020",
    implemented: true,
    gate: "sync/policies.spec #1–#2 (partner:contact_merge whitelisted fields, zero merge on constrained)",
  },

  // ---- PHASE-021 desktop column — the read cache (MASTER-PLAN §11) ------------
  // The Tauri desktop client's READ-CACHED cells: the offline console's
  // cached reads over the REAL desktop file store (E2E journey, AR+EN) +
  // the store-client read suite + the schema-parity pin against the v1–v5
  // DDL. The feed substrate is the 020 POS group (sync/pull.spec).
  {
    operation: "Items / barcodes / prices lookup",
    deviceClass: "tauri-desktop",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "021",
    implemented: true,
    gate:
      "tests/e2e/desktop-offline.spec.ts (journey step 2: cached item reads + base price, AR+EN, real store) + apps/web lib/shell/__tests__/store-client.test.ts (cached read filters — the pickers' sources) + apps/web __tests__/local-schema-parity.test.ts (v1–v5 DDL pin)",
  },
  {
    operation: "Price list view",
    deviceClass: "tauri-desktop",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "021",
    implemented: true,
    gate:
      "sync/pull.spec (POS-group feed projections — the desktop class's feed scope, 020) + packages/sync-core __tests__/watermark-tombstone.test.ts (price_list_items upsert/tombstone — the local cache projection) + apps/desktop __tests__/store.test.ts (the file store carries the v1–v5 read-cache schema incl. price_list_items)",
  },
  {
    operation: "Reprint of an already-POSTED receipt/invoice",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "RO",
    phase: "021",
    implemented: true,
    gate:
      "apps/desktop __tests__/print.test.ts (renderReprintFromCache: cached doc_no VERBATIM exactly once + REPRINT marker, NOT_POSTED/NOT_CACHED refusals, corrupt-payload degrade) + tests/e2e/desktop-offline.spec.ts (journey step 2: exactly ONE printHtml capture carrying the cached doc_no + bilingual REPRINT marker, AR+EN) + apps/web components/offline/__tests__/offline-components.test.tsx (the reprint template — never re-numbers)",
  },
  {
    operation: "Master-data search (items, partners)",
    deviceClass: "tauri-desktop",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "021",
    implemented: true,
    gate:
      "tests/e2e/desktop-offline.spec.ts (journey step 2: search narrows \"ESP\" → 1 item and clears back to 2, AR+EN) + apps/web lib/shell/__tests__/store-client.test.ts (cached read filters — search by display text, ACTIVE only)",
  },

  // ---- PHASE-021 desktop column — the DR-P21-08 write intents (MASTER-PLAN §6/§11)
  // The seven server-side write intents + the offline console's draft forms.
  // DEFERRED-INTENT SPLIT (DR-P21-08): CREATE-DRAFT ONLY for the new types —
  // no offline update intents this phase (invoice keeps 020's create+update
  // pair); non-owner edits are simply not offered offline. The split is
  // pinned by desktop-intents.spec #7 (quotation:update_draft is an
  // unknown-intent rejection from ANY device) + #23 (frozen feed-group
  // scope).
  {
    operation: "Partner create (new walk-in / route customer)",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #1–#3 (partner:create cluster: accept+feed+device audit+C-01 replay, zod reject zero-residue, business rule) + apps/web lib/shell/__tests__/store-client.test.ts (partner:create builder → the outbox+projection enqueue contract) + tests/e2e/desktop-offline.spec.ts (the offline console enqueue→drain journey the form rides, AR+EN)",
    note: "DR-P21-08 desktop write intent; contact fields ride 020's partner:contact_merge (row #21) — this row is the partner record itself (code auto-numbered server-side, BR-025)",
  },
  {
    operation: "Quotation draft",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "OD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #4–#7 (quotation:create_draft cluster: accept+feed+audit+replay, zod reject, INACTIVE-customer rule, the OD-create posture — update_draft is an unknown-intent rejection) + apps/web components/offline forms (quotation-form rides buildQuotationCreateDraft, the store-client enqueue contract)",
    note: "DR-P21-08 deferred-intent split: CREATE-DRAFT ONLY — no offline quotation:update_draft this phase (registry has no such key; OD-create posture pinned by spec #7)",
  },
  {
    operation: "Delivery note",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #8–#10 (delivery_note:create_draft cluster: accept+feed+audit+replay, zod reject, SERVICE-item rule) + apps/web components/offline forms (delivery-note-form rides buildDeliveryNoteCreateDraft, the store-client enqueue contract)",
    note: "DR-P21-08 deferred-intent split: CREATE-DRAFT ONLY (stock issues at submit stay online server-side, SD-at-submit)",
  },
  {
    operation: "Stock count entry (lines as counted)",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #20–#22 (stock_count:submit_lines cluster: accept+feed+audit+replay, zod reject, non-DRAFT-session rule — SD-aggregate via CountService.enterCounts) + apps/web lib/shell/__tests__/store-client.test.ts (only DRAFT count sessions are pickable — sessions are created online so the snapshot freezes server-side)",
    note: "DR-P21-08 deferred-intent split: line submission only — session submit/review/approve + variance posting stay online server decisions",
  },
  {
    operation: "Expense entry (field/back office)",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #11–#13 (expense:create cluster: accept+feed+audit+replay, zod reject, negative-amount rule) + apps/web components/offline forms (expense-form rides buildExpenseCreate, the store-client enqueue contract)",
    note: "DR-P21-08 desktop write intent (SD — the claim posts at sync)",
  },
  {
    operation: "Stock transfer draft",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #17–#19 (stock_transfer:create_draft cluster: accept+feed+audit+replay, zod reject, same-warehouse rule) + apps/web components/offline forms (stock-transfer-form rides buildStockTransferCreateDraft, the store-client enqueue contract)",
    note: "DR-P21-08 deferred-intent split: CREATE-DRAFT ONLY — dispatch (IN_TRANSIT/POSTED) stays online; no batch binding at draft (FEFO at dispatch)",
  },
  {
    operation: "Cash transfer / drawer drop",
    deviceClass: "tauri-desktop",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "021",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #14–#16 (cash_transfer:create_draft cluster: accept+feed+audit+replay, zod reject, fee-≥-amount rule) + apps/web components/offline forms (cash-transfer-form rides buildCashTransferCreateDraft, the store-client enqueue contract)",
    note: "DR-P21-08 desktop write intent (treasury drafts post at sync)",
  },

  // ---- PHASE-022 android columns — the mobile activation (DR-P22-05/06; --------------
  // MASTER-PLAN §6 + §11 task 1-d). The android-field cells: FEED_GROUPS.field
  // = POS base + van_stocks/routes/settlement_templates/statements (the golden
  // constants §0) — the server pull substrate is LIVE (sync/pull-fields.spec:
  // in-group pulls, LITE projections with money/qty TEXT decimal strings, the
  // van-stock vanished-key DELETE diff, the route-customer statements scope);
  // the three NEW field intents land with 2-c (sync/field-intents.spec) and the
  // on-device flows/screens + the expo chaos re-proof with 2-e/3-a
  // (sync/expo/expo-chaos.spec) — every gate names its proving spec, every note
  // records the staging. The android-personal cells: the partner-scoped
  // personal feeds are LIVE end-to-end server-side (sync/pull-personal.spec:
  // linked-partner ONLY, fabricated other-partner rows never in pages, tampered
  // cursors never widen the scope, fail-closed unlinked devices).
  {
    operation: "Items / barcodes / prices lookup",
    deviceClass: "android-field",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-fields.spec (the android-field feed group, DR-P22-05: the POS-base items/barcodes/price_list_items feeds serve the field class — the in-group pull proof + SYNC_ENTITY_NOT_PULLED outside) + sync/expo/expo-chaos.spec (T-P22-3-a: the field device's cached lookups over the REAL mobile store)",
    note: "022 staging: server feed substrate live at T-P22-1d; the on-device lookup screens land with 2-e, the expo re-proof with 3-a (the gate names both)",
  },
  {
    operation: "Price list view",
    deviceClass: "android-field",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-fields.spec (price_list_items rides the field group's POS base — the ACTIVE-list projection, the 020 feed) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "022 staging: server feed substrate live at T-P22-1d; the on-device price-list view lands with 2-e/3-b",
  },
  {
    operation: "Sales invoice draft (back office)",
    deviceClass: "android-field",
    capability: "LOCAL-VALID",
    conflictPolicy: "OD",
    phase: "022",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #3–#6 (the REUSED sales_invoice:create_draft pair — DR-P22-06: van-sale capture rides the 020 intent, owner-device OD posture) + sync/pull-fields.spec (van_stocks feed — the LOCAL-VALID prevalidation snapshot, qty/value TEXT decimal strings) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "LOCAL-VALID† (MASTER-PLAN §8): pre-validation against the cached van snapshot is advisory — 2% price tolerance, credit advisory; the server decides at sync",
  },
  {
    operation: "Quotation draft",
    deviceClass: "android-field",
    capability: "LOCAL-VALID",
    conflictPolicy: "OD",
    phase: "022",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #4–#7 (the REUSED quotation:create_draft intent — DR-P22-06, OD-create posture) + sync/pull-fields.spec (routes + statements feeds — the per-customer read models the quotation prevalidation reads) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "LOCAL-VALID†; 022 staging: the reused intent + feeds are live; the on-device quotation flow lands with 2-e",
  },
  {
    operation: "Receipt — field collection (van route)",
    deviceClass: "android-field",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/field-intents.spec (T-P22-2-c: receipt:create_field_collection — accept+feed+audit+replay, rep-attributed, INV-013 idempotent, SD at sync) + sync/pull-fields.spec (settlement_templates feed — the rep day template the collection posts against) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "one of the three NEW 022 intents (DR-P22-06); the server feed substrate is live at T-P22-1d, the intent lands with 2-c, the flow with 2-e",
  },
  {
    operation: "Stock count entry (lines as counted)",
    deviceClass: "android-field",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #20–#22 (the REUSED stock_count:submit_lines intent — DR-P22-06: counted lines are facts, variance is a server-side decision) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "022 staging: the reused intent is live (021); the on-device count-lines flow lands with 2-e",
  },
  {
    operation: "Van load / unload confirmation",
    deviceClass: "android-field",
    capability: "OFFLINE-COMPLETE",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/field-intents.spec (T-P22-2-c: van:confirm_load + van:confirm_unload — double-load and unload-beyond-van INSUFFICIENT_STOCK rejections against the van snapshot) + sync/pull-fields.spec (van_stocks feed: the LITE projection + the vanished-key DELETE diff over the REAL loadOut/receiveTransfer/unload chain — the snapshot substrate) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "one of the three NEW 022 intents (DR-P22-06); the van_stocks feed substrate is live at T-P22-1d (mirror rebuild diff proven), the intents land with 2-c",
  },
  {
    operation: "Customer statement view",
    deviceClass: "android-field",
    capability: "READ-CACHED",
    conflictPolicy: "RO",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-fields.spec (the statements feed: route-customer scope, the content-diff catch-up over the REAL AR subledger, StatementLite with money TEXT decimal strings, as-of labels) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "the per-partner statement snapshots are computed at pull time (the permissions-snapshot pattern — no source table); the companion screens land with 3-b",
  },
  {
    operation: "Invoice view (issued, own documents)",
    deviceClass: "android-field",
    capability: "READ-CACHED",
    conflictPolicy: "RO",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-fields.spec (the statements feed's per-partner entries — the issued-invoice rows (docRef/sourceType/debit/credit/balance/outstanding) the companion's invoice view renders, route-customer scoped; the field group deliberately carries no sales_invoices entity — DR-P22-05 golden constants) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "the field companion's invoice view rides the statements read cache (LOCAL_DATABASE §1.1 field subset = POS + van_stocks + routes + statements — no invoice table in the field store, DR-P22-08); the screens land with 3-b",
  },
  {
    operation: "Partner edit — contact fields (phone, email, address)",
    deviceClass: "android-field",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "FM",
    phase: "022",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #1–#2 (the REUSED partner:contact_merge intent — whitelisted non-constrained fields, field-level audit, FM — DR-P22-06 lists the merge among the 022 reused intents) + sync/pull-fields.spec (partners feed rides the field group's POS base) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "matrix Phase column \"PHASE-021 / 022\" assigns the android-field cell to 022 (021 = the desktop ✓ portion; 022 = the field portion — the only other capability cell in the row; the same reading as rows #6/#7/#11, whose Phase cells read identically and are 022-activated per MASTER-PLAN §6)",
  },
  {
    operation: "Partner create (new walk-in / route customer)",
    deviceClass: "android-field",
    capability: "LOCAL-VALID",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #1–#3 (the REUSED partner:create intent — DR-P22-06; code auto-numbered server-side, duplicate checks server-side) + sync/pull-fields.spec (partners feed — the cached read model the LOCAL-VALID duplicate advisory reads) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "LOCAL-VALID† (the 022 flip of the 020-era deferral annotation): the reused intent + feed substrate are live; the on-device partner-create flow lands with 2-e",
  },
  {
    operation: "Expense entry (field/back office)",
    deviceClass: "android-field",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/desktop-intents.spec #11–#13 (the REUSED expense:create intent — DR-P22-06: the claim posts at sync, SD) + sync/pull-fields.spec (settlement_templates feed — the rep day the expense reconciles into) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "matrix Phase column \"PHASE-021 / 022\" assigns the android-field cell to 022 (the row-21 reading, verbatim); the on-device expense flow lands with 2-e",
  },
  {
    operation: "Credit note (van return from customer)",
    deviceClass: "android-field",
    capability: "OFFLINE-DRAFT",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/field-intents.spec (T-P22-2-c: credit_note:create_draft — accept+feed+audit+replay + the per-reason rejection pack) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "one of the three NEW 022 intents (DR-P22-06); posting stays online (the returns draft is OFFLINE-DRAFT, the 021 deferred-intent split)",
  },
  {
    operation: "Master-data search (items, partners)",
    deviceClass: "android-field",
    capability: "READ-CACHED",
    conflictPolicy: "SAS",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-fields.spec (items + partners feeds ride the field group's POS base — the search cache sources; the field device's in-group items pull is asserted) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "the 022 flip of the 020-era deferral annotation; the on-device search lands with 2-e/3-b",
  },
  {
    operation: "Serial/IMEI or batch capture on sale line (where tracked)",
    deviceClass: "android-field",
    capability: "LOCAL-VALID",
    conflictPolicy: "SD",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-fields.spec (the items feed carries trackBatch/trackSerial/trackImei — the capture-gating read model; serialIds ride the sale aggregate, the 016 payload shape the van-sale draft reuses) + sync/field-intents.spec (T-P22-2-c: the serial/batch line payload extension) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "LOCAL-VALID†: uniqueness is checked against the snapshot, the server re-verifies at sync (VALIDATION_ERROR on serial reuse — the 016 semantics, unchanged)",
  },
  {
    operation: "Customer statement view",
    deviceClass: "android-personal",
    capability: "READ-CACHED",
    conflictPolicy: "RO",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-personal.spec (the personal statements feed: the linked partner ONLY — fabricated other-partner rows never in pages, stolen/forged/cross-entity cursors never widen the scope, the unlinked device fails closed) + sync/expo/expo-chaos.spec (T-P22-3-a: the personal authorization drills)",
    note: "partner-scoped server-side (LOCAL_DATABASE §1.1 rule 2, migration 0033 devices.linked_partner_id); the personal screens land with 3-b",
  },
  {
    operation: "Invoice view (issued, own documents)",
    deviceClass: "android-personal",
    capability: "READ-CACHED",
    conflictPolicy: "RO",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-personal.spec (sales_invoices partner scope: ONLY the linked partner's customerId rows are served — payload-keyed serve filter; an unlinked personal device pulls nothing, fail closed) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "the personal group's sales_invoices carry the partner key in the payload (feed-projections ReceiptLite/StatementLite family); the screens land with 3-b",
  },
  {
    operation: "Notifications / message read state",
    deviceClass: "android-personal",
    capability: "READ-CACHED",
    conflictPolicy: "RO",
    phase: "022",
    implemented: true,
    gate:
      "sync/pull-personal.spec (notifications per-user scope: ONLY the device user's rows are served — the NULL-user broadcast never rides any personal feed; the ≤ 2 MB page cap splits the big rows across pages) + sync/expo/expo-chaos.spec (T-P22-3-a)",
    note: "read state is the feed's readAt field (READ-CACHED — no personal write path exists, DR-P22-08b: the personal store has no outbox)",
  },
];
