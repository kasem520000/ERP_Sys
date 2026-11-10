/**
 * PHASE-022 · the i18n runtime (MASTER-PLAN §5): locale resolution, RTL
 * detection, `{param}` interpolation, and the native-direction bootstrap
 * hint. PURE TS — NO react-native imports (DR-P22-01): `I18nManager.forceRTL`
 * belongs to the native shell at the port boundary (native/App.tsx), which
 * consumes `nativeDirection(locale)` below; this module never reaches for RN.
 */
import {
  defaultLocale,
  getDictionary,
  isLocale,
  type Dictionary,
  type Locale,
} from "./dictionaries";

/** Interpolation values — pass PRE-FORMATTED strings (digits.ts owns number
 * and date shapes); numbers are `String()`-ed as-is (never formatted here). */
export type TranslationParams = Readonly<Record<string, string | number>>;

/**
 * Resolve the active locale from a persisted preference (the native shell
 * reads SecureStore and passes the string; `null`/`undefined`/garbage fall
 * back to the Arabic default — an unparsable preference must never crash
 * the app, and Arabic-first is the product default, RTL_DESIGN_RULES §1).
 */
export function resolveLocale(persisted?: string | null): Locale {
  if (persisted !== null && persisted !== undefined && isLocale(persisted)) {
    return persisted;
  }
  return defaultLocale;
}

/** RTL detection — `ar` is RTL, `en` is LTR. The ONLY place direction is
 * decided (the RTL_DESIGN_RULES §2 source-of-truth rule, mobile port). */
export function isRTL(locale: Locale): boolean {
  return locale === "ar";
}

/** The layout direction for a locale ("rtl" | "ltr") — feeds dir attributes
 * and logical-prop-aware components. */
export function directionFor(locale: Locale): "rtl" | "ltr" {
  return isRTL(locale) ? "rtl" : "ltr";
}

/**
 * Translate `key` for `locale`, interpolating `{param}` tokens from `params`.
 * A token whose param is absent stays VISIBLE (`{param}`) — an honest,
 * greppable omission; never a silent blank. Without `params` the raw string
 * is returned unchanged.
 */
export function t(
  locale: Locale,
  key: keyof Dictionary,
  params?: TranslationParams,
): string {
  const value = getDictionary(locale)[key];
  if (params === undefined) {
    return value;
  }
  return value.replace(
    /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,
    (token: string, name: string): string => {
      const replacement = params[name];
      return replacement === undefined ? token : String(replacement);
    },
  );
}

/**
 * The helper the native App calls at boot and on every language change —
 * the RN port boundary (MASTER-PLAN §5: "`I18nManager.forceRTL` happens in
 * native/App.tsx"). native/App.tsx does:
 *
 *   const nd = nativeDirection(locale);
 *   I18nManager.allowRTL(nd.allowRTL);
 *   I18nManager.forceRTL(nd.forceRTL);
 *
 * …then re-renders (or restarts, per RN docs) so the layout direction takes
 * effect. `allowRTL` stays `true` for both locales: the app ships RTL-safe
 * (logical props only, DR-P22-03), so LTR layouts are always available.
 */
export interface NativeDirection {
  readonly locale: Locale;
  readonly direction: "rtl" | "ltr";
  readonly isRTL: boolean;
  readonly allowRTL: boolean;
  readonly forceRTL: boolean;
}

export function nativeDirection(locale: Locale): NativeDirection {
  const rtl = isRTL(locale);
  return {
    locale,
    direction: rtl ? "rtl" : "ltr",
    isRTL: rtl,
    allowRTL: true,
    forceRTL: rtl,
  };
}
