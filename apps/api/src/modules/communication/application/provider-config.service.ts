/**
 * PHASE-041 (T-03) — the tenant-scoped provider configuration service:
 * the masked catalog read, the sealed write (BR-067 + the secret-store
 * discipline), the per-market sender resolution, the send-cost hard cap,
 * and the LIVE port resolution the pipeline consumes (selection +
 * COMPLETE credentials → the real adapter; anything else → SANDBOX).
 *
 * Entitlement discipline (tier-4): selecting a provider for WHATSAPP/
 * SMS/EMAIL requires the channel's feature key (communication.whatsapp/
 * sms/email_providers — business + enterprise). The check rides the same
 * materialized-entitlements projection the route guard uses
 * (tenantActiveEntitlements) so a starter tenant cannot even CONFIGURE a
 * paid provider (fail-closed at write time, not first send).
 */

import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { tenantActiveEntitlements } from "../../tenancy/infrastructure/tenancy.store";
import { openSecret } from "../../identity/infrastructure/secret-envelope";
import {
  OutboxError,
  ProviderUnknownError,
} from "../domain/communication-errors";
import type { OutboundChannel, OutboundChannelPort } from "../domain/channel-port";
import { findProviderDescriptor, PROVIDER_REGISTRY } from "./provider-registry";
import {
  buildProviderCatalog,
  CHANNEL_FEATURE_KEY,
  EMPTY_PROVIDER_SETTINGS,
  parseProviderSettings,
  resolveEffectiveProvider,
  sealCredentials,
  type CommunicationProviderSettings,
  type MarketSenderConfig,
  type ProviderConfigShapeError,
} from "./provider-config";
import { sandboxProviders } from "./providers/sandbox-provider";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("provider configuration requires an ambient tenant scope");
  }
  return context.tx;
}

/** The settings update input (the controller's body shape). */
export interface ProviderConfigUpdate {
  /** New selections per channel (absent channels keep their current one). */
  readonly selection?: Readonly<
    Partial<Record<OutboundChannel, string | undefined>>
  >;
  /**
   * Credential upserts per provider (plain values — SEALED on write).
   * Passing a field with "" clears it.
   */
  readonly credentials?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Per-market sender identities (replaces the whole map). */
  readonly markets?: Readonly<Record<string, Readonly<Partial<MarketSenderConfig>>>>;
  /** The send-cost hard cap (null clears it). */
  readonly sendCap?: { readonly dailyHardCap?: number | null };
}

export class ProviderConfigService {
  /** The stored settings (parsed + validated). */
  async readSettings(): Promise<CommunicationProviderSettings> {
    const tx = tenantTx();
    const rows = await tx.execute(
      sql`SELECT value FROM tenant_settings WHERE key = 'communication.providers' LIMIT 1`,
    );
    const raw = (rows.rows as unknown as { value: unknown }[])[0]?.value;
    if (raw === undefined) {
      return EMPTY_PROVIDER_SETTINGS;
    }
    try {
      return parseProviderSettings(raw);
    } catch (error) {
      // A corrupted blob must never take the pipeline down: fall back to
      // the SANDBOX defaults and surface the parse failure on the read.
      const shapeError = error as ProviderConfigShapeError;
      throw new OutboxError(
        "communication/provider-settings-corrupted",
        shapeError.message,
      );
    }
  }

  /** The masked catalog (GET /communication/providers). */
  async readCatalog() {
    return buildProviderCatalog(await this.readSettings());
  }

  /** The sealed write (PUT): validate + entitlement-check + seal + persist. */
  async updateConfig(
    actorId: string,
    input: ProviderConfigUpdate,
  ): Promise<ReturnType<ProviderConfigService["readCatalog"]>> {
    const current = await this.readSettings();

    // 1. Selection validation + per-channel entitlement checks (tier-4).
    const selection: Partial<Record<OutboundChannel, string>> = { ...current.selection };
    if (input.selection !== undefined) {
      const entitled = new Set(
        (await tenantActiveEntitlements(requireTenantContext().tenantId)).map(
          (row) => row.featureKey,
        ),
      );
      for (const [channel, providerId] of Object.entries(input.selection)) {
        if (providerId === undefined || providerId === null || providerId === "") {
          delete selection[channel as OutboundChannel];
          continue;
        }
        if (typeof providerId !== "string") {
          throw new OutboxError(
            "communication/provider-selection-invalid",
            `selection.${channel} must be a provider id`,
          );
        }
        const descriptor = findProviderDescriptor(providerId);
        if (descriptor === undefined) {
          throw new ProviderUnknownError(providerId);
        }
        if (descriptor.kind !== channel) {
          throw new OutboxError(
            "communication/provider-selection-invalid",
            `provider ${providerId} serves ${descriptor.kind}, not ${channel}`,
          );
        }
        // The tier-4 gate: configuring a paid provider requires the
        // channel's feature key (starter cannot even save the selection).
        const featureKey = CHANNEL_FEATURE_KEY[channel as OutboundChannel];
        if (!entitled.has(featureKey)) {
          throw new OutboxError(
            "communication/channel-not-entitled",
            `selecting a ${channel} provider requires the ${featureKey} feature (business + enterprise)`,
          );
        }
        selection[channel as OutboundChannel] = providerId;
      }
    }

    // 2. Credential upserts: field-name validation + sealing.
    const credentials: Record<string, Record<string, string>> = {
      ...Object.fromEntries(
        Object.entries(current.credentials).map(([id, fields]) => [id, { ...fields }]),
      ),
    };
    if (input.credentials !== undefined) {
      for (const [providerId, fields] of Object.entries(input.credentials)) {
        if (findProviderDescriptor(providerId) === undefined) {
          throw new ProviderUnknownError(providerId);
        }
        const incoming = sealCredentials(providerId, fields);
        const merged: Record<string, string> = { ...(credentials[providerId] ?? {}) };
        for (const [field, value] of Object.entries(fields)) {
          if (value === "") {
            delete merged[field]; // "" clears the field
          }
        }
        credentials[providerId] = { ...merged, ...incoming };
      }
    }

    // 3. Markets + send cap replace-whole semantics.
    const markets = input.markets ?? current.markets;
    const rawCap =
      input.sendCap !== undefined ? input.sendCap.dailyHardCap : current.sendCap.dailyHardCap;
    const sendCap = { dailyHardCap: rawCap === null ? undefined : rawCap };

    // 4. Shape-validate the assembled whole BEFORE persisting (the parse
    //    is the single validation door — unknown providers, wrong kinds,
    //    malformed market keys all fail here).
    const next = parseProviderSettings({ selection, credentials, markets, sendCap });

    await this.persist(next, actorId);
    return buildProviderCatalog(next);
  }

  /**
   * The LIVE port resolution (BR-067): the selected provider with COMPLETE
   * credentials (unsealed for the factory) or the SANDBOX default.
   */
  async resolveChannelPort(channel: OutboundChannel): Promise<OutboundChannelPort> {
    const settings = await this.readSettings();
    const effective = resolveEffectiveProvider(channel, settings);
    if (!effective.live) {
      return sandboxProviders()[channel];
    }
    const descriptor = findProviderDescriptor(effective.providerId)!;
    const sealedFields = settings.credentials[effective.providerId] ?? {};
    // Unseal the secret fields for the factory (values never logged).
    const plain: Record<string, string> = {};
    for (const [field, value] of Object.entries(sealedFields)) {
      if (value.startsWith("v1:")) {
        plain[field] = openSecret(value);
      } else {
        plain[field] = value;
      }
    }
    return descriptor.create(plain);
  }

  /**
   * The per-market sender identity (T-03): WhatsApp numbers, SMS sender
   * names, email from-addresses per ISO market; undefined → the provider
   * default.
   */
  async resolveSenderId(
    channel: OutboundChannel,
    market: string | null | undefined,
  ): Promise<string | undefined> {
    if (market === undefined || market === null) {
      return undefined;
    }
    const settings = await this.readSettings();
    const config = settings.markets[market.toUpperCase()];
    if (config === undefined) {
      return undefined;
    }
    if (channel === "WHATSAPP") {
      return config.whatsappPhoneNumberId;
    }
    if (channel === "SMS") {
      return config.smsSenderName;
    }
    return config.emailFromAddress;
  }

  /** The send-cost hard cap (messages per UTC day; undefined = uncapped). */
  async dailySendCap(): Promise<number | undefined> {
    return (await this.readSettings()).sendCap.dailyHardCap;
  }

  /** True when the selected provider for the channel is fully credentialed. */
  async isChannelLive(channel: OutboundChannel): Promise<boolean> {
    const settings = await this.readSettings();
    return resolveEffectiveProvider(channel, settings).live;
  }

  private async persist(
    settings: CommunicationProviderSettings,
    actorId: string,
  ): Promise<void> {
    const tx = tenantTx();
    await tx.execute(
      sql`INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
          VALUES (${generateUuidV7()}, erp.current_tenant_id(), 'communication.providers',
                  ${JSON.stringify(settings)}::jsonb, ${actorId})
          ON CONFLICT (tenant_id, key) DO UPDATE
            SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
                updated_at = now(), version = tenant_settings.version + 1`,
    );
  }
}

/** The registry re-export for the controller's catalog route. */
export { PROVIDER_REGISTRY };
