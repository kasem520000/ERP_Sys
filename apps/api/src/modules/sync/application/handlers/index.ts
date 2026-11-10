/**
 * PHASE-020 · the per-intent push handler registry (MASTER-PLAN §4/§6/§7;
 * SYNC_PROTOCOL §3 + §6; CONFLICT_RESOLUTION §2). One handler per
 * `entityType:intent` key; the push service normalizes v2 + legacy
 * commands into ONE NormalizedCommand and dispatches through this
 * registry. Handlers call OWNING module services only (MODULE_BOUNDARIES —
 * sync adds transport, never a second business-logic path), validate
 * BEFORE any write (zero-residue: the ambient request tx cannot roll back
 * per item — SYNC_PROTOCOL §3.3/§6.3), and declare their feed entries so
 * the push service writes them in the SAME transaction as the command
 * (MASTER-PLAN §1.3b).
 *
 * The shared handler contract (types, service wiring, the typed
 * validation throw) lives in ./contract — a leaf, so the handler modules
 * never import this registry file (DEPENDENCY_RULES §2.1 no-circular;
 * everything below stays re-exported for "./handlers" consumers).
 */
export {
  configureHandlerServices,
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type HandlerServices,
  type NormalizedCommand,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

import { posSaleCreateHandler } from "./pos-sale";
import { shiftCloseHandler, shiftOpenHandler } from "./shift";
import { partnerContactMergeHandler } from "./partner-merge";
import {
  draftInvoiceCreateHandler,
  draftInvoiceUpdateHandler,
} from "./draft-invoice";
import { partnerCreateHandler } from "./desktop-partner";
import {
  deliveryNoteCreateDraftHandler,
  quotationCreateDraftHandler,
} from "./desktop-sales-drafts";
import {
  cashTransferCreateDraftHandler,
  expenseCreateHandler,
} from "./desktop-treasury-drafts";
import {
  stockCountSubmitLinesHandler,
  stockTransferCreateDraftHandler,
} from "./desktop-inventory-drafts";
// PHASE-022 · DR-P22-06: the three field write intents' owning handlers.
import { receiptFieldCollectionHandler } from "./field-receipt";
import { vanConfirmLoadHandler, vanConfirmUnloadHandler } from "./van-confirm";
import { creditNoteCreateDraftHandler } from "./credit-note-draft";
import type { SyncCommandHandler } from "./contract";

/** key: `${entityType}:${intent}` — the ONLINE_ONLY entities never
 * register a handler (CONFLICT_RESOLUTION §2 last row: the push service
 * rejects them BEFORE handler lookup).
 *
 * PHASE-021 · DR-P21-08 (MASTER-PLAN §6 table): the seven desktop write
 * intents land as ADDITIVE registry entries behind the frozen v2
 * envelope. CREATE-draft only for the new types — no update intents
 * exist for them (a non-owner device's update attempt is an
 * unknown-intent rejection by construction).
 *
 * PHASE-022 · DR-P22-06 (MASTER-PLAN §6 + §1): the three field write
 * intents join the same way (rows 9/12/27 android-field): the field
 * collection receipt POSTS at sync (like pos_sale), the two van
 * confirmations operate on the 017 van ledger against the van snapshot,
 * and the credit note is an OD draft (no posting) — CREATE only. */
export const HANDLER_REGISTRY: ReadonlyMap<string, SyncCommandHandler> = new Map<
  string,
  SyncCommandHandler
>([
  ["pos_sale:create", posSaleCreateHandler],
  ["cashier_shift:open", shiftOpenHandler],
  ["cashier_shift:close", shiftCloseHandler],
  ["partner:contact_merge", partnerContactMergeHandler],
  ["sales_invoice:create_draft", draftInvoiceCreateHandler],
  ["sales_invoice:update_draft", draftInvoiceUpdateHandler],
  // -- PHASE-021 · DR-P21-08: the desktop write intents --------------------
  ["partner:create", partnerCreateHandler],
  ["quotation:create_draft", quotationCreateDraftHandler],
  ["delivery_note:create_draft", deliveryNoteCreateDraftHandler],
  ["expense:create", expenseCreateHandler],
  ["cash_transfer:create_draft", cashTransferCreateDraftHandler],
  ["stock_transfer:create_draft", stockTransferCreateDraftHandler],
  ["stock_count:submit_lines", stockCountSubmitLinesHandler],
  // -- PHASE-022 · DR-P22-06: the field write intents (registry 13 → 16) --
  ["receipt:create_field_collection", receiptFieldCollectionHandler],
  ["van:confirm_load", vanConfirmLoadHandler],
  ["van:confirm_unload", vanConfirmUnloadHandler],
  ["credit_note:create_draft", creditNoteCreateDraftHandler],
]);

/** Handler lookup by (entityType, intent). */
export function handlerFor(entityType: string, intent: string): SyncCommandHandler | undefined {
  return HANDLER_REGISTRY.get(`${entityType}:${intent}`);
}

/** The registry keys in stable order — rides REJECTED details.supported
 * when a command names an unknown intent (the client can self-diagnose). */
export function handlerRegistryKeys(): string[] {
  return [...HANDLER_REGISTRY.keys()];
}
