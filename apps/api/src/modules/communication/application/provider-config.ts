/**
 * PHASE-041 (T-03) — the provider configuration substrate: the tenant
 * settings blob `communication.providers` (selection per channel, sealed
 * credentials per provider, per-market sender identities, the send-cost
 * hard cap) + the PURE shape/validation/masking helpers (unit-tested
 * without a DB).
 *
 * Secret-store discipline (the phase's risk register): secret credential
 * fields are SEALED at rest (the identity module's AES-256-GCM envelope —
 * the dual-accept rotation window applies) and NEVER returned to the
 * client — the read API exposes field NAMES + configured/unconfigured
 * state only; logs never see values (the service logs keys, never
 * envelopes). The BR-067 resolution rule: a channel rides its SELECTED
 * provider only when that provider's credentials are COMPLETE — anything
 * else falls back to the SANDBOX default (zero external calls).
 */

import {
  findProviderDescriptor,
  PROVIDER_REGISTRY,
  type ProviderDescriptor,
} from "./provider-registry";
import { sealSecret } from "../../identity/infrastructure/secret-envelope";
import type { OutboundChannel } from "../domain/channel-port";

/** The tenant settings key for the whole provider configuration. */
export const PROVIDER_SETTINGS_KEY = "communication.providers";

/** The per-market sender identities (T-03's per-market WhatsApp numbers). */
export interface MarketSenderConfig {
  /** The WhatsApp phone-number id for this market. */
  readonly whatsappPhoneNumberId?: string;
  /** The SMS sender name for this market (operator-registered). */
  readonly smsSenderName?: string;
  /** The email envelope-from override for this market. */
  readonly emailFromAddress?: string;
}

/** The stored settings shape (tenant_settings.communication.providers). */
export interface CommunicationProviderSettings {
  /** The selected provider id per channel (registry ids). */
  readonly selection: Readonly<Partial<Record<OutboundChannel, string>>>;
  /**
   * Credentials per provider id → field → value. SECRET fields hold the
   * `v1:…` envelope (sealed at write time); non-secret fields are plain.
   */
  readonly credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Per-market sender identities (ISO-3166 alpha-2 keys). */
  readonly markets: Readonly<Record<string, MarketSenderConfig>>;
  /** The send-cost hard cap (messages per UTC day across channels). */
  readonly sendCap: { readonly dailyHardCap?: number };
}

export const EMPTY_PROVIDER_SETTINGS: CommunicationProviderSettings = {
  selection: {},
  credentials: {},
  markets: {},
  sendCap: {},
};

/** The channel a provider selection unlocks (the tier-4 feature keys). */
export const CHANNEL_FEATURE_KEY: Readonly<Record<OutboundChannel, string>> = {
  WHATSAPP: "communication.whatsapp",
  SMS: "communication.sms",
  EMAIL: "communication.email_providers",
};

// -- validation + normalization ------------------------------------------------

export class ProviderConfigShapeError extends Error {
  constructor(detail: string) {
    super(`communication.providers invalid: ${detail}`);
    this.name = "ProviderConfigShapeError";
  }
}

/** Parse + validate a raw stored value (unknown → the typed shape). */
export function parseProviderSettings(raw: unknown): CommunicationProviderSettings {
  if (raw === undefined || raw === null) {
    return EMPTY_PROVIDER_SETTINGS;
  }
  if (typeof raw !== "object") {
    throw new ProviderConfigShapeError("the settings value must be an object");
  }
  const value = raw as Record<string, unknown>;
  const selection: Partial<Record<OutboundChannel, string>> = {};
  const selectionRaw = value.selection ?? {};
  if (typeof selectionRaw !== "object") {
    throw new ProviderConfigShapeError("selection must be an object");
  }
  for (const [channel, providerId] of Object.entries(selectionRaw)) {
    if (channel !== "WHATSAPP" && channel !== "SMS" && channel !== "EMAIL") {
      throw new ProviderConfigShapeError(`unknown channel ${channel}`);
    }
    if (typeof providerId !== "string" || providerId.length === 0) {
      continue;
    }
    const descriptor = findProviderDescriptor(providerId);
    if (descriptor === undefined) {
      throw new ProviderConfigShapeError(`unknown provider ${providerId}`);
    }
    if (descriptor.kind !== channel) {
      throw new ProviderConfigShapeError(
        `provider ${providerId} serves ${descriptor.kind}, not ${channel}`,
      );
    }
    selection[channel] = providerId;
  }
  const credentials: Record<string, Record<string, string>> = {};
  const credentialsRaw = value.credentials ?? {};
  if (typeof credentialsRaw !== "object") {
    throw new ProviderConfigShapeError("credentials must be an object");
  }
  for (const [providerId, fields] of Object.entries(credentialsRaw)) {
    if (findProviderDescriptor(providerId) === undefined) {
      throw new ProviderConfigShapeError(`credentials for unknown provider ${providerId}`);
    }
    if (typeof fields !== "object" || fields === null) {
      throw new ProviderConfigShapeError(`credentials.${providerId} must be an object`);
    }
    const typed: Record<string, string> = {};
    for (const [field, fieldValue] of Object.entries(fields)) {
      if (typeof fieldValue !== "string") {
        continue;
      }
      typed[field] = fieldValue;
    }
    credentials[providerId] = typed;
  }
  const markets: Record<string, MarketSenderConfig> = {};
  const marketsRaw = value.markets ?? {};
  if (typeof marketsRaw !== "object") {
    throw new ProviderConfigShapeError("markets must be an object");
  }
  for (const [market, config] of Object.entries(marketsRaw)) {
    if (!/^[A-Z]{2}$/.test(market)) {
      throw new ProviderConfigShapeError(`market key ${market} must be ISO-3166 alpha-2`);
    }
    if (typeof config !== "object" || config === null) {
      throw new ProviderConfigShapeError(`markets.${market} must be an object`);
    }
    const raw = config as Record<string, unknown>;
    const typed: {
      whatsappPhoneNumberId?: string;
      smsSenderName?: string;
      emailFromAddress?: string;
    } = {};
    for (const key of ["whatsappPhoneNumberId", "smsSenderName", "emailFromAddress"] as const) {
      if (typeof raw[key] === "string" && (raw[key] as string).length > 0) {
        typed[key] = raw[key] as string;
      }
    }
    markets[market] = typed;
  }
  let dailyHardCap: number | undefined;
  if (value.sendCap !== undefined && value.sendCap !== null) {
    const cap = (value.sendCap as { dailyHardCap?: unknown }).dailyHardCap;
    if (cap !== undefined && cap !== null) {
      if (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1 || cap > 1_000_000) {
        throw new ProviderConfigShapeError("sendCap.dailyHardCap must be an integer 1..1000000");
      }
      dailyHardCap = cap;
    }
  }
  return { selection, credentials, markets, sendCap: { dailyHardCap } };
}

// -- credential completeness + sealing ------------------------------------------

/** True when every REQUIRED credential field holds a non-empty value. */
export function credentialsComplete(
  descriptor: ProviderDescriptor,
  fields: Readonly<Record<string, string>> | undefined,
): boolean {
  return descriptor.credentialFields
    .filter((field) => field.required)
    .every((field) => {
      const value = fields?.[field.name];
      return typeof value === "string" && value.length > 0;
    });
}

/**
 * Seal the SECRET fields of an incoming credential update (the write
 * path): plain values in → envelopes out. Non-secret fields pass through.
 * A value already carrying the `v1:` envelope prefix stays untouched
 * (idempotent re-write of a masked read must not double-seal).
 */
export function sealCredentials(
  providerId: string,
  fields: Readonly<Record<string, string>>,
): Record<string, string> {
  const descriptor = findProviderDescriptor(providerId);
  if (descriptor === undefined) {
    throw new ProviderConfigShapeError(`unknown provider ${providerId}`);
  }
  const sealed: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    const fieldSpec = descriptor.credentialFields.find((spec) => spec.name === field);
    if (fieldSpec === undefined) {
      throw new ProviderConfigShapeError(
        `provider ${providerId} has no credential field ${field}`,
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      continue; // absent/empty fields are simply not written
    }
    if (fieldSpec.secret && !value.startsWith("v1:")) {
      sealed[field] = sealSecret(value);
    } else {
      sealed[field] = value;
    }
  }
  return sealed;
}

/** The masked read shape for one provider's credentials (NEVER values). */
export interface MaskedCredentialState {
  readonly field: string;
  readonly secret: boolean;
  readonly configured: boolean;
}

// -- the effective provider resolution (BR-067) ---------------------------------

export interface EffectiveProviderResolution {
  /** The provider id that will serve the channel (sandbox = the default). */
  readonly providerId: string;
  /** True when a credentialed REAL provider serves the channel. */
  readonly live: boolean;
  /** False when a selection exists but its credentials are incomplete. */
  readonly blockedOnCredentials: boolean;
}

/**
 * BR-067's resolution: the SELECTED provider serves the channel only when
 * its credentials are COMPLETE; everything else — no selection, unknown
 * provider, incomplete credentials — falls back to the SANDBOX default
 * (zero external calls until configured AND credentialed).
 */
export function resolveEffectiveProvider(
  channel: OutboundChannel,
  settings: CommunicationProviderSettings,
): EffectiveProviderResolution {
  const selected = settings.selection[channel];
  if (selected === undefined) {
    return { providerId: "sandbox", live: false, blockedOnCredentials: false };
  }
  const descriptor = findProviderDescriptor(selected);
  if (descriptor === undefined || descriptor.kind !== channel) {
    return { providerId: "sandbox", live: false, blockedOnCredentials: false };
  }
  if (!credentialsComplete(descriptor, settings.credentials[selected])) {
    return { providerId: "sandbox", live: false, blockedOnCredentials: true };
  }
  return { providerId: selected, live: true, blockedOnCredentials: false };
}

/** The catalog read shape (GET /communication/providers). */
export interface ProviderCatalogEntry {
  readonly id: string;
  readonly kind: OutboundChannel;
  readonly label: { readonly ar: string; readonly en: string };
  readonly requiresVerification: boolean;
  readonly credentialFields: readonly {
    readonly name: string;
    readonly label: { readonly ar: string; readonly en: string };
    readonly secret: boolean;
    readonly required: boolean;
    readonly configured: boolean;
  }[];
}

/** The full masked catalog (the settings UI's only view of credentials). */
export function buildProviderCatalog(
  settings: CommunicationProviderSettings,
): {
  readonly providers: readonly ProviderCatalogEntry[];
  readonly channels: Readonly<Record<OutboundChannel, EffectiveProviderResolution>>;
  readonly markets: Readonly<Record<string, MarketSenderConfig>>;
  readonly sendCap: { readonly dailyHardCap?: number };
} {
  const providers = PROVIDER_REGISTRY.map((descriptor): ProviderCatalogEntry => {
    const stored = settings.credentials[descriptor.id];
    return {
      id: descriptor.id,
      kind: descriptor.kind,
      label: descriptor.label,
      requiresVerification: descriptor.requiresVerification,
      credentialFields: descriptor.credentialFields.map((field) => ({
        name: field.name,
        label: field.label,
        secret: field.secret,
        required: field.required,
        configured:
          typeof stored?.[field.name] === "string" &&
          (stored[field.name] as string).length > 0,
      })),
    };
  });
  const channels: Record<OutboundChannel, EffectiveProviderResolution> = {
    EMAIL: resolveEffectiveProvider("EMAIL", settings),
    WHATSAPP: resolveEffectiveProvider("WHATSAPP", settings),
    SMS: resolveEffectiveProvider("SMS", settings),
  };
  return { providers, channels, markets: settings.markets, sendCap: settings.sendCap };
}
