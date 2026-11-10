import { sql } from "drizzle-orm";

import {
  DEVICE_CLASSES,
  FEED_GROUPS,
  PERMISSIONS_ENTITY_TYPE,
  PULLED_ENTITY_TYPES,
} from "@erp/contracts";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-020 · feed groups (T5; SYNC_PROTOCOL §2.2 + MASTER-PLAN §1.3/§5):
 * the server-enforced pull scope per device class. `@erp/contracts`
 * FEED_GROUPS is the single source of truth (pos / desktop / field /
 * personal); this module resolves a device's class → group, enforces the
 * "is this entity pullable by THIS device" gate (SYNC_ENTITY_NOT_PULLED —
 * no existence leak across classes), and loads the device row for the pull
 * path (devices stays service-mediated — PHASE-003 §4: no tenant_id, no
 * RLS — so a direct read inside the ambient tenant tx is the sanctioned
 * access; every tenant-owned read still rides RLS).
 *
 * 016 wire compat (MASTER-PLAN §1.1): a device with NO class (the manual
 * 016 pos-terminal enrollment leaves device_class NULL) resolves to the
 * pos group — the 016 terminal keeps pulling exactly what it pulled
 * before, plus the always-pulled `permissions` snapshot entity.
 */

/**
 * Static proof (the contracts/index.ts subset-proof style): every
 * feed-group entity is a registered pulled entity type — the pull gate
 * below can treat the groups as subsets of PULLED_ENTITY_TYPES.
 */
const FEED_GROUP_ENTITIES_ARE_PULLABLE: readonly string[] = PULLED_ENTITY_TYPES;
void FEED_GROUP_ENTITIES_ARE_PULLABLE;

/** device_class → the contracts feed group (compile-time completeness:
 * every DEVICE_CLASSES member must have an entry). */
const GROUP_BY_DEVICE_CLASS: Readonly<
  Record<(typeof DEVICE_CLASSES)[number], readonly string[]>
> = {
  "pos-terminal": FEED_GROUPS.pos,
  "tauri-desktop": FEED_GROUPS.desktop,
  "android-field": FEED_GROUPS.field,
  "android-personal": FEED_GROUPS.personal,
};

/**
 * The entity types a device class may pull: its feed group + the synthetic
 * `permissions` snapshot entity (every class pulls it every cycle —
 * MASTER-PLAN §10). Unknown/NULL class → the pos group + permissions
 * (fail-safe default; 016 terminals carry device_class NULL).
 */
export function feedGroupForDeviceClass(deviceClass: string | null): readonly string[] {
  if (deviceClass !== null) {
    const group = GROUP_BY_DEVICE_CLASS[deviceClass as (typeof DEVICE_CLASSES)[number]];
    if (group !== undefined) {
      return [...group, PERMISSIONS_ENTITY_TYPE];
    }
  }
  return [...FEED_GROUPS.pos, PERMISSIONS_ENTITY_TYPE];
}

/**
 * The pull-scope gate (MASTER-PLAN §5.1): the entity must be in the
 * device's feed group, or be the permissions snapshot (pulled by every
 * class). False → the caller throws SYNC_ENTITY_NOT_PULLED.
 */
export function isEntityPullableByDevice(entityType: string, deviceClass: string | null): boolean {
  if (entityType === PERMISSIONS_ENTITY_TYPE) {
    return true;
  }
  return (feedGroupForDeviceClass(deviceClass) as readonly string[]).includes(entityType);
}

/**
 * Resolve a device's class: the 020 `device_class` column when set, else
 * the 003 `platform` mapping, else the fail-safe pos-terminal default
 * (016 devices have device_class NULL and platform 'pos-terminal').
 */
export function deviceClassOf(row: { deviceClass: string | null; platform: string | null }): string {
  if (row.deviceClass !== null && row.deviceClass !== undefined && row.deviceClass !== "") {
    return row.deviceClass;
  }
  switch (row.platform) {
    case "pos-terminal":
      return "pos-terminal";
    case "DESKTOP":
      return "tauri-desktop";
    case "ANDROID":
      return "android-field";
    default:
      return "pos-terminal";
  }
}

/** The device fields the pull path needs (devices has no RLS by design). */
export interface SyncDeviceRow {
  id: string;
  userId: string;
  deviceClass: string | null;
  platform: string | null;
  revokedAt: string | null;
  dataExpiresAt: string | null;
  contractVersion: string | null;
  /** jsonb NOT NULL DEFAULT '{}' on the devices row (0029). */
  trustFlags: Record<string, unknown> | null;
  /** PHASE-022 · DR-P22-05a (migration 0033): the personal-account device's
   * linked partner — the server-side partner scope for the personal pull
   * feeds (LOCAL_DATABASE §1.1 rule 2). NULL on every other class / on a
   * personal device without linkage. */
  linkedPartnerId: string | null;
}

/**
 * Load a device row by id inside the ambient tenant tx. devices is
 * service-mediated (no tenant_id column, no RLS — PHASE-003 §4), so the
 * direct SELECT is the documented access path; the tenant binding of a
 * pull is the request's tenant context, not the device row.
 */
export async function loadDevice(deviceId: string): Promise<SyncDeviceRow | undefined> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT id, user_id AS "userId", device_class AS "deviceClass", platform,
           revoked_at AS "revokedAt", data_expires_at AS "dataExpiresAt",
           contract_version AS "contractVersion", trust_flags AS "trustFlags",
           linked_partner_id AS "linkedPartnerId"
    FROM devices WHERE id = ${deviceId} LIMIT 1
  `);
  return (rows.rows as unknown as SyncDeviceRow[])[0];
}
