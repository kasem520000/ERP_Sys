/**
 * Document lifecycle status map (COMPONENT_CATALOG §6.4 + DOCUMENT_LIFECYCLE).
 *
 * The component ships the status→tone mapping (never translations — text comes
 * from the app i18n bundle keyed by status) and the transitions table that
 * feeds DocumentActions. Tone changes require a design decision record;
 * screens may never re-color statuses ad hoc.
 */

export type DocumentStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "POSTED"
  | "REVERSED"
  | "CANCELLED"
  | "PENDING_SYNC";

export type StatusTone =
  | "neutral"
  | "primary"
  | "info"
  | "warning"
  | "success"
  | "success-info"
  | "danger";

export interface StatusStyle {
  /** Semantic token tone — fixed by the table; never bespoke per screen. */
  tone: StatusTone;
  /** Registry icon name (decorative, aria-hidden). */
  icon:
    | "pencil"
    | "hourglass"
    | "circle-check"
    | "book-check"
    | "undo-2"
    | "x"
    | "cloud-off";
  /** CANCELLED renders its label with strikethrough (catalog §6.4). */
  strikethrough?: boolean;
}

/** The binding tone map — DRAFT→Info, PENDING_APPROVAL→Warning, APPROVED→Success-info,
 *  POSTED→Success, REVERSED→Danger tint, CANCELLED→gray solid+strike, PENDING_SYNC→Info. */
export const DOCUMENT_STATUS_STYLE: Readonly<Record<DocumentStatus, StatusStyle>> = {
  DRAFT: { tone: "info", icon: "pencil" },
  PENDING_APPROVAL: { tone: "warning", icon: "hourglass" },
  APPROVED: { tone: "success-info", icon: "circle-check" },
  POSTED: { tone: "success", icon: "book-check" },
  REVERSED: { tone: "danger", icon: "undo-2" },
  CANCELLED: { tone: "neutral", icon: "x", strikethrough: true },
  PENDING_SYNC: { tone: "info", icon: "cloud-off" },
};

export const DOCUMENT_STATUSES: readonly DocumentStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "POSTED",
  "REVERSED",
  "CANCELLED",
  "PENDING_SYNC",
];

/** DocumentActions transition ids, derived from the same lifecycle table. */
export type DocumentActionId =
  | "submit"
  | "approve"
  | "reject"
  | "post"
  | "reverse"
  | "cancel";

/** DOCUMENT_LIFECYCLE §2 — allowed transitions per current status. */
export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentStatus, readonly DocumentActionId[]>> = {
  DRAFT: ["submit", "approve", "cancel"],
  PENDING_APPROVAL: ["approve", "reject", "cancel"],
  APPROVED: ["post"],
  POSTED: ["reverse"],
  REVERSED: [],
  CANCELLED: [],
  PENDING_SYNC: [],
};

/** i18n key namespace — the app bundle owns the actual strings. */
export function statusMessageKey(status: DocumentStatus): string {
  return `enums.document_status.${status.toLowerCase()}`;
}

export function actionMessageKey(action: DocumentActionId): string {
  return `enums.document_action.${action}`;
}
