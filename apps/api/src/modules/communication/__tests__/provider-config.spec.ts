import { describe, expect, it } from "vitest";

import { openSecret } from "../../identity/infrastructure/secret-envelope";
import {
  buildProviderCatalog,
  credentialsComplete,
  EMPTY_PROVIDER_SETTINGS,
  parseProviderSettings,
  ProviderConfigShapeError,
  resolveEffectiveProvider,
  sealCredentials,
} from "../application/provider-config";
import { findProviderDescriptor } from "../application/provider-registry";
import type { CommunicationProviderSettings } from "../application/provider-config";

/**
 * PHASE-041 T-03 — the provider configuration substrate (pure half): the
 * settings blob shape/validation, the secret-store sealing discipline
 * (secret fields sealed, masked reads NEVER expose values), and the
 * BR-067 effective-provider resolution (incomplete credentials → SANDBOX).
 */

function settingsWith(
  overrides: Partial<CommunicationProviderSettings>,
): CommunicationProviderSettings {
  return { ...EMPTY_PROVIDER_SETTINGS, ...overrides };
}

describe("parseProviderSettings (the single validation door)", () => {
  it("accepts the empty shape (no configuration = all SANDBOX)", () => {
    const parsed = parseProviderSettings(undefined);
    expect(parsed).toEqual(EMPTY_PROVIDER_SETTINGS);
    expect(parsed.selection).toEqual({});
  });

  it("rejects unknown providers, wrong channel kinds, and malformed market keys", () => {
    expect(() =>
      parseProviderSettings({ selection: { EMAIL: "does-not-exist" } }),
    ).toThrow(ProviderConfigShapeError);
    expect(() =>
      parseProviderSettings({ selection: { EMAIL: "twilio" } }),
    ).toThrow(/serves SMS, not EMAIL/);
    expect(() => parseProviderSettings({ markets: { "sa": {} } })).toThrow(
      /ISO-3166 alpha-2/,
    );
  });

  it("validates the send-cap bounds", () => {
    expect(() => parseProviderSettings({ sendCap: { dailyHardCap: 0 } })).toThrow(
      /dailyHardCap/,
    );
    expect(() => parseProviderSettings({ sendCap: { dailyHardCap: 2_000_000 } })).toThrow(
      /dailyHardCap/,
    );
    const ok = parseProviderSettings({ sendCap: { dailyHardCap: 500 } });
    expect(ok.sendCap.dailyHardCap).toBe(500);
  });
});

describe("sealCredentials (the secret-store discipline)", () => {
  it("seals secret fields and passes plain fields through (round-trips via openSecret)", () => {
    const sealed = sealCredentials("whatsapp-business", {
      accessToken: "EAAG-secret-token",
      phoneNumberId: "123456",
    });
    expect(sealed.phoneNumberId).toBe("123456");
    expect(sealed.accessToken).toMatch(/^v1:/);
    expect(openSecret(sealed.accessToken!)).toBe("EAAG-secret-token");
  });

  it("never double-seals an already-sealed value (idempotent masked re-write)", () => {
    const once = sealCredentials("msegat", { password: "pw" });
    const twice = sealCredentials("msegat", { password: once.password! });
    expect(twice.password).toBe(once.password);
  });

  it("rejects unknown providers and unknown fields", () => {
    expect(() => sealCredentials("nope", { a: "b" })).toThrow(ProviderConfigShapeError);
    expect(() =>
      sealCredentials("twilio", { accountSid: "AC1", authToken: "t", fromNumber: "+1", bogus: "x" }),
    ).toThrow(/no credential field bogus/);
  });
});

describe("resolveEffectiveProvider (BR-067)", () => {
  const whatsappDescriptor = findProviderDescriptor("whatsapp-business")!;

  it("no selection → SANDBOX", () => {
    const resolution = resolveEffectiveProvider("WHATSAPP", EMPTY_PROVIDER_SETTINGS);
    expect(resolution).toEqual({
      providerId: "sandbox",
      live: false,
      blockedOnCredentials: false,
    });
  });

  it("selection with INCOMPLETE credentials → SANDBOX + blockedOnCredentials", () => {
    const settings = settingsWith({
      selection: { WHATSAPP: "whatsapp-business" },
      credentials: { "whatsapp-business": { phoneNumberId: "1" } },
    });
    const resolution = resolveEffectiveProvider("WHATSAPP", settings);
    expect(resolution).toEqual({
      providerId: "sandbox",
      live: false,
      blockedOnCredentials: true,
    });
    expect(credentialsComplete(whatsappDescriptor, settings.credentials["whatsapp-business"])).toBe(
      false,
    );
  });

  it("selection with COMPLETE credentials → LIVE", () => {
    const settings = settingsWith({
      selection: { WHATSAPP: "whatsapp-business" },
      credentials: {
        "whatsapp-business": { accessToken: "v1:sealed", phoneNumberId: "1" },
      },
    });
    expect(resolveEffectiveProvider("WHATSAPP", settings)).toEqual({
      providerId: "whatsapp-business",
      live: true,
      blockedOnCredentials: false,
    });
  });
});

describe("buildProviderCatalog (the masked read)", () => {
  it("exposes configured STATE, never credential VALUES", () => {
    const catalog = buildProviderCatalog(
      settingsWith({
        selection: { SMS: "msegat" },
        credentials: {
          msegat: {
            username: "msegat-user-9",
            password: "v1:sealed-envelope-xyz",
            senderName: "Brand",
          },
        },
        markets: { SA: { whatsappPhoneNumberId: "SA-NUM-1" } },
        sendCap: { dailyHardCap: 250 },
      }),
    );
    const msegat = catalog.providers.find((entry) => entry.id === "msegat")!;
    expect(msegat.credentialFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "username", configured: true, secret: false }),
        expect.objectContaining({ name: "password", configured: true, secret: true }),
      ]),
    );
    // The catalog shape carries NO credential values anywhere.
    expect(JSON.stringify(catalog)).not.toContain("sealed-envelope-xyz");
    expect(JSON.stringify(catalog)).not.toContain("msegat-user-9");
    expect(catalog.channels.SMS).toEqual({
      providerId: "msegat",
      live: true,
      blockedOnCredentials: false,
    });
    expect(catalog.markets.SA).toEqual({ whatsappPhoneNumberId: "SA-NUM-1" });
    expect(catalog.sendCap.dailyHardCap).toBe(250);
  });
});
