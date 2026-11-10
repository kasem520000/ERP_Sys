import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { DomainError } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-023 T13 — per-tenant e-invoicing adapter rollout flags
 * (DEPLOYMENT §7 PHASE-023 row): every adapter ships DISABLED for every
 * tenant (`enabled` DEFAULT FALSE — migration 0035). Enabling is a gated,
 * audited action that requires a provisioned ACTIVE certificate for the
 * tenant's jurisdiction (the gate test asserts the refusal); disabling is
 * always allowed (rollback = flag off — phase §6 Migration & rollback).
 *
 * The global `feature_flags` table (L8) stays platform-only: adapter
 * enablement is TENANT configuration, RLS-scoped, per jurisdiction.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("einvoicing adapter settings require an ambient tenant scope");
  }
  return context.tx;
}

export interface AdapterSettingRow {
  readonly id: string;
  readonly adapterId: string;
  readonly countryCode: string;
  readonly enabled: boolean;
  readonly config: Record<string, unknown>;
  readonly enabledBy: string | null;
  readonly enabledAt: string | null;
}

export class AdapterEnablementGateError extends DomainError {
  constructor(reason: string, details?: Readonly<Record<string, unknown>>) {
    super("tax/adapter-enablement-gate", reason, details);
  }
}

/** List the tenant's adapter settings (absent rows = default OFF). */
export async function listAdapterSettings(): Promise<AdapterSettingRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, adapter_id AS "adapterId", country_code AS "countryCode", enabled,
      config, enabled_by::text AS "enabledBy", enabled_at::text AS "enabledAt"
    FROM e_invoicing_adapter_settings ORDER BY adapter_id
  `);
  return rows.rows as unknown as AdapterSettingRow[];
}

export async function findAdapterSetting(adapterId: string): Promise<AdapterSettingRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, adapter_id AS "adapterId", country_code AS "countryCode", enabled,
      config, enabled_by::text AS "enabledBy", enabled_at::text AS "enabledAt"
    FROM e_invoicing_adapter_settings WHERE adapter_id = ${adapterId} LIMIT 1
  `);
  return (rows.rows as unknown as AdapterSettingRow[])[0];
}

/**
 * The enablement gate (T13 + DEPLOYMENT §7): requires an ACTIVE,
 * non-expired certificate for the adapter's jurisdiction BEFORE the flag
 * can flip ON. Provisioning precedes enablement — asserted by the gate
 * test (phase §5 T13: "enablement requires provisioned cert").
 */
export async function requireProvisionedCertificate(input: {
  adapterId: string;
  countryCode: string;
  now?: Date;
}): Promise<void> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, status, not_after FROM e_invoicing_certificates
    WHERE adapter_id = ${input.adapterId} AND country_code = ${input.countryCode}
      AND status IN ('ACTIVE', 'EXPIRING_SOON')
    ORDER BY not_after DESC LIMIT 1
  `);
  const cert = (rows.rows as unknown as { id: string; status: string; not_after: string }[])[0];
  if (cert === undefined) {
    throw new AdapterEnablementGateError(
      "adapter enablement requires a provisioned ACTIVE certificate (DEPLOYMENT §7: certificates provisioned BEFORE adapter enablement)",
      { adapterId: input.adapterId, countryCode: input.countryCode },
    );
  }
}

/** Upsert the tenant's setting for an adapter (enable or disable). */
export async function setAdapterEnabled(input: {
  adapterId: string;
  countryCode: string;
  enabled: boolean;
  actorId: string;
}): Promise<AdapterSettingRow> {
  if (input.enabled) {
    await requireProvisionedCertificate({
      adapterId: input.adapterId,
      countryCode: input.countryCode,
    });
  }
  const tx = tenantTx();
  const id = generateUuidV7();
  const rows = await tx.execute(sql`
    INSERT INTO e_invoicing_adapter_settings (id, tenant_id, adapter_id, country_code,
      enabled, enabled_by, enabled_at)
    VALUES (${id}, erp.current_tenant_id(), ${input.adapterId}, ${input.countryCode},
      ${input.enabled}, ${input.actorId}, CASE WHEN ${input.enabled} THEN now() ELSE NULL END)
    ON CONFLICT ("tenant_id", "adapter_id") DO UPDATE SET
      enabled = EXCLUDED.enabled,
      enabled_by = EXCLUDED.enabled_by,
      enabled_at = EXCLUDED.enabled_at,
      updated_at = now(), version = e_invoicing_adapter_settings.version + 1
    RETURNING id, adapter_id AS "adapterId", country_code AS "countryCode", enabled,
      config, enabled_by::text AS "enabledBy", enabled_at::text AS "enabledAt"
  `);
  return (rows.rows as unknown as AdapterSettingRow[])[0]!;
}

/**
 * The default state every tenant starts from: NO settings rows at all —
 * adapters are OFF until explicitly provisioned + enabled (flag-off
 * default asserted by the T13 gate test).
 */
export async function assertDefaultOff(adapterId: string): Promise<boolean> {
  const setting = await findAdapterSetting(adapterId);
  return setting === undefined || setting.enabled === false;
}
