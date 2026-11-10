/**
 * PHASE-021 T11 · WebView2 runtime probe + minimum-version enforcement
 * (MASTER-PLAN §1 item 9 / §7; ADR-0013: WebView2 is a system requirement;
 * RISK-017 old shop PCs): the Rust shell reports the installed Evergreen
 * runtime string through the bridge; this module parses it, compares it
 * against the shipped floor (WEBVIEW2_MINIMUM) and the recommended band
 * (WEBVIEW2_RECOMMENDED), and produces the bilingual status + guidance
 * payload for the system-requirements screen (below minimum = unsupported
 * with Evergreen standalone-installer guidance; ≥ minimum but < recommended
 * = degraded-capability notice; ≥ recommended = supported).
 *
 * Graceful degradation, never a crash: an unparseable/absent version is
 * reported as unsupported with install guidance — the shell renders the
 * requirements screen, not a broken window.
 */

import { WEBVIEW2_MINIMUM, WEBVIEW2_RECOMMENDED } from "../constants";

export interface WebView2Version {
  readonly major: number;
  readonly minor: number;
  readonly build: number;
  readonly revision: number;
}

const VERSION_SEGMENT_COUNT = 4;

/**
 * Parse a WebView2 runtime version string. Tolerates "109.0.1518.78",
 * short forms ("109.0.1518", "109"), surrounding whitespace, and a leading
 * probe prefix ("WV2 109.0.1518.78"). Missing segments read as 0. Returns
 * null for anything non-numeric (never throws).
 */
export function parseWebview2Version(raw: string): WebView2Version | null {
  if (typeof raw !== "string") return null;
  let text = raw.trim();
  const prefixed = text.match(/^wv2\s+/i);
  if (prefixed !== null) text = text.slice(prefixed[0].length).trim();
  if (text.length === 0) return null;
  const segments = text.split(".");
  if (segments.length === 0 || segments.length > VERSION_SEGMENT_COUNT) return null;
  const numbers: number[] = [];
  for (const segment of segments) {
    if (!/^\d+$/.test(segment)) return null;
    const value = Number(segment);
    if (!Number.isSafeInteger(value)) return null;
    numbers.push(value);
  }
  while (numbers.length < VERSION_SEGMENT_COUNT) numbers.push(0);
  return { major: numbers[0]!, minor: numbers[1]!, build: numbers[2]!, revision: numbers[3]! };
}

function compareParsed(a: WebView2Version, b: WebView2Version): -1 | 0 | 1 {
  const keys: readonly (keyof WebView2Version)[] = ["major", "minor", "build", "revision"];
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

/**
 * Numeric segment-wise comparison of two WebView2 version STRINGS.
 * Returns null when either side does not parse (callers decide the
 * fallback policy — webview2Policy fails closed to unsupported).
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const parsedA = parseWebview2Version(a);
  const parsedB = parseWebview2Version(b);
  if (parsedA === null || parsedB === null) return null;
  return compareParsed(parsedA, parsedB);
}

export interface WebView2Policy {
  readonly status: "supported" | "degraded" | "unsupported";
  /** The probed runtime string (verbatim, for the requirements screen). */
  readonly current: string;
  readonly minimum: string;
  readonly recommended: string;
  /** Bilingual guidance (AR first, RTL_DESIGN_RULES; EN variant) — the
   * unsupported string cites the Evergreen standalone installer. */
  readonly guidance: { readonly ar: string; readonly en: string };
}

const GUIDANCE: Record<WebView2Policy["status"], { ar: string; en: string }> = {
  unsupported: {
    ar: "إصدار WebView2 الحالي أقل من الحد الأدنى المطلوب للتشغيل. الرجاء تثبيت أحدث إصدار من مثبّت WebView2 Evergreen المستقل (Evergreen Standalone Installer) من موقع Microsoft ثم إعادة تشغيل التطبيق.",
    en: "Your WebView2 runtime is below the minimum required version. Install the latest WebView2 Evergreen Standalone Installer from Microsoft, then restart the app.",
  },
  degraded: {
    ar: "إصدار WebView2 الحالي مدعوم لكنه أقدم من الإصدار الموصى به؛ قد تتأثر بعض الإمكانات (الأداء وميزات العرض الحديثة). يُنصح بالتحديث إلى أحدث إصدار Evergreen.",
    en: "Your WebView2 runtime is supported but older than the recommended version; some capabilities (performance, modern rendering features) may be degraded. Updating to the latest Evergreen runtime is recommended.",
  },
  supported: {
    ar: "إصدار WebView2 الحالي يفي بالحد الأدنى والموصى به — التطبيق مدعوم بالكامل.",
    en: "Your WebView2 runtime meets the minimum and recommended versions — the app is fully supported.",
  },
};

/**
 * Band the probed runtime against WEBVIEW2_MINIMUM / WEBVIEW2_RECOMMENDED:
 * below minimum ⇒ unsupported (requirements screen + installer guidance);
 * EXACTLY the minimum ⇒ supported — the shipped floor is the tested
 * baseline this build is certified on (the MASTER-PLAN probe matrix pins
 * 109.0.1518.78 as the supported edge); strictly above minimum but below
 * recommended ⇒ degraded (capability notices); ≥ recommended ⇒ supported.
 * Unparseable versions fail closed to unsupported with honest guidance.
 */
export function webview2Policy(version: string): WebView2Policy {
  const parsed = parseWebview2Version(version);
  const base = {
    current: version,
    minimum: WEBVIEW2_MINIMUM,
    recommended: WEBVIEW2_RECOMMENDED,
  };
  if (parsed === null) {
    return {
      ...base,
      status: "unsupported",
      guidance: {
        ar: "تعذّر قراءة إصدار WebView2 المثبّت. الرجاء تثبيت مثبّت WebView2 Evergreen المستقل (Evergreen Standalone Installer) من موقع Microsoft ثم إعادة تشغيل التطبيق.",
        en: "The installed WebView2 version could not be determined. Install the WebView2 Evergreen Standalone Installer from Microsoft, then restart the app.",
      },
    };
  }
  const minimum = parseWebview2Version(WEBVIEW2_MINIMUM)!;
  const recommended = parseWebview2Version(WEBVIEW2_RECOMMENDED)!;
  const againstMinimum = compareParsed(parsed, minimum);
  if (againstMinimum < 0) {
    return { ...base, status: "unsupported", guidance: GUIDANCE.unsupported };
  }
  if (againstMinimum === 0) {
    // The supported edge: the floor itself is fully supported.
    return { ...base, status: "supported", guidance: GUIDANCE.supported };
  }
  if (compareParsed(parsed, recommended) < 0) {
    return { ...base, status: "degraded", guidance: GUIDANCE.degraded };
  }
  return { ...base, status: "supported", guidance: GUIDANCE.supported };
}
