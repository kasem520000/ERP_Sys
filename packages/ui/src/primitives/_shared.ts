/**
 * Shared Radix helpers — collision padding, surface classes, direction
 * plumbing. The primitives layer is the ONLY legal Radix import site
 * (DESIGN_SYSTEM §2; lint erp/no-raw-radix enforces it in app code).
 */
export const COLLISION_PADDING = 8;

/** Overlay/popover/card surface recipe from tokens (no raw values). */
export const surfaceCx =
  "bg-surface-card border border-subtle rounded-lg shadow-e3 outline-none";

/** Portal target: Radix portals to body; z-layers come from tokens (§10). */
export const portalZ = {
  dropdown: "z-[var(--erp-z-dropdown)]",
  drawer: "z-[var(--erp-z-drawer)]",
  overlay: "z-[var(--erp-z-overlay)]",
  dialog: "z-[var(--erp-z-dialog)]",
  popover: "z-[var(--erp-z-popover)]",
  tooltip: "z-[var(--erp-z-tooltip)]",
} as const;

/** Overlay scrim per §5: rgba overlay, NO backdrop blur (transactional contexts). */
export const overlayCx = "fixed inset-0 bg-surface-overlay";
