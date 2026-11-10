/**
 * PHASE-020 · the ONLINE_ONLY guard constants (MASTER-PLAN §6.6/§7 last
 * table row; CONFLICT_RESOLUTION §2 configuration row; SYNC_PROTOCOL §3).
 *
 * Entity types that are NEVER writable from a device carry NO handler in
 * the registry — the push service checks `ONLINE_ONLY_ENTITIES`
 * (from @erp/contracts, wave 1) BEFORE handler lookup and rejects per-item
 * FORBIDDEN resubmittable:false. This module exists so the reason code
 * has one sync-module-owned spelling; the entity list itself stays in the
 * contracts package (one source of truth shared with the device side).
 */

/** The rejection reason for ONLINE_ONLY pushes + non-owner draft pushes
 * (CONFLICT_RESOLUTION §2). */
export const ONLINE_ONLY_REASON = "FORBIDDEN";
