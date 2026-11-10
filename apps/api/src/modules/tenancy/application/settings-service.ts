import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  SETTINGS_REGISTRY,
  cachedTenantSettings,
  parseSettingValue,
  publishTenancyEvent,
  storeTenantSettingsCache,
  validateTaxRegistrationPair,
} from "../../configuration/api";
import * as store from "../infrastructure/tenancy.store";

/**
 * Tenant settings service (PHASE-004 §2.6/T8; CONFIGURATION_ENGINE §4/§9,
 * L5): schema-validated typed-key writes (unknown keys rejected loudly),
 * before/after audit, invalidation events, and the effective-config
 * snapshot (stored rows ∪ registry defaults) the PHASE-004 screens and the
 * PHASE-015 engine consume.
 */

@Injectable()
export class SettingsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Effective L5 snapshot: stored values overlaid on registry defaults
   * (absent keys resolve to their registered default; INV-022: values
   * configure, never override math). Cached per tenant, invalidated by
   * the §9 event bus.
   */
  async effectiveConfig(): Promise<Record<string, unknown>> {
    const tenant = await store.getOwnTenant();
    const cached = cachedTenantSettings(tenant.id);
    if (cached !== undefined) {
      return { ...cached };
    }
    const rows = await store.listSettings();
    const merged: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(SETTINGS_REGISTRY)) {
      merged[key] = definition.default;
    }
    for (const row of rows) {
      merged[row.key] = row.value;
    }
    storeTenantSettingsCache(tenant.id, merged);
    return merged;
  }

  async write(
    actorId: string,
    key: string,
    value: unknown,
  ): Promise<{ key: string; value: unknown }> {
    const parsed = parseSettingValue(key, value);

    // Cross-key invariants (TAX_ENGINE §1 registration pair).
    if (key === "tax.registration.status" || key === "tax.registration.number") {
      const current = await this.effectiveConfig();
      const status = key === "tax.registration.status"
        ? (parsed as string)
        : ((current["tax.registration.status"] as string | undefined) ?? "NOT_REGISTERED");
      const number = key === "tax.registration.number"
        ? ((parsed as string | null) ?? null)
        : ((current["tax.registration.number"] as string | null) ?? null);
      validateTaxRegistrationPair(status, number);
    }

    const before = await store.findSetting(key);
    const row = await store.upsertSetting(key, parsed, actorId);
    const tenant = await store.getOwnTenant();
    await this.audit.record({
      action: "settings.changed",
      entityType: "tenant_setting",
      entityId: tenant.id,
      actorId,
      before: before === undefined ? undefined : { value: before.value },
      after: { key, value: row.value },
    });
    publishTenancyEvent({ type: "settings.changed", tenantId: tenant.id, key });
    return { key: row.key, value: row.value };
  }
}
