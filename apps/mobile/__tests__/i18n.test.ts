import { describe, expect, it } from "vitest";
import {
  assertMobileParity,
  collectMobileParityViolations,
  getDictionary,
  otherLocale,
  type Dictionary,
} from "../src/i18n/dictionaries";
import {
  directionFor,
  isRTL,
  nativeDirection,
  resolveLocale,
  t,
} from "../src/i18n/runtime";
import {
  formatMoney,
  formatQty,
  formatDate,
  formatDocNumber,
  toArabIndic,
  toLatnDigits,
  TABULAR_NUMS_STYLE,
} from "../src/i18n/digits";
import {
  bidiDocNumber,
  bidiIban,
  bidiIsolate,
  bidiIsolateStrong,
  bidiPhone,
  bidiSerial,
  sanitizeBidi,
} from "../src/i18n/bidi";
import * as barrel from "../src/index";

describe("PHASE-022 i18n — catalog parity (DR-P22-04)", () => {
  it("assertMobileParity() is green on the shipped ar/en pair", () => {
    expect(() => assertMobileParity()).not.toThrow();
  });

  it("ar and en carry the same key count, ≥ 350 keys (the full screen-set floor)", () => {
    const ar = getDictionary("ar");
    const en = getDictionary("en");
    const arKeys = Object.keys(ar);
    const enKeys = Object.keys(en);
    expect(arKeys.length).toBe(enKeys.length);
    expect(arKeys.length).toBeGreaterThanOrEqual(350);
  });

  it("no key is empty or whitespace-only in either locale", () => {
    const ar = getDictionary("ar");
    const en = getDictionary("en");
    for (const [key, value] of Object.entries(ar)) {
      expect(value.trim(), `ar.${key}`).not.toBe("");
    }
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), `en.${key}`).not.toBe("");
    }
  });

  it("covers the four post-sync states with real labels in both locales", () => {
    expect(getDictionary("ar").syncStatePendingSync).toBe("بانتظار المزامنة");
    expect(getDictionary("en").syncStatePendingSync).toBe("Pending sync");
    expect(getDictionary("ar").syncStatePosted).toBe("تم الترحيل");
    expect(getDictionary("en").syncStatePosted).toBe("Posted");
    expect(getDictionary("ar").syncStateRejected).toBe("مرفوض (قابل للمعالجة)");
    expect(getDictionary("en").syncStateRejected).toBe("Rejected (editable)");
    expect(getDictionary("ar").syncStateDraftLocal).toBe("مسودة محلية");
    expect(getDictionary("en").syncStateDraftLocal).toBe("Local draft");
  });

  it("covers all ten rejection codes with label + detail (CONFLICT_RESOLUTION §3)", () => {
    const codes = [
      "rejectPeriodLocked",
      "rejectPriceChanged",
      "rejectInsufficientStock",
      "rejectCreditLimitExceeded",
      "rejectStaleVersion",
      "rejectItemInactive",
      "rejectPartnerInactive",
      "rejectValidationError",
      "rejectDeviceRevoked",
      "rejectTenantSuspended",
    ] as const;
    for (const code of codes) {
      expect(getDictionary("ar")[code].trim()).not.toBe("");
      expect(getDictionary("en")[code].trim()).not.toBe("");
      expect(getDictionary("ar")[`${code}Detail`].trim()).not.toBe("");
      expect(getDictionary("en")[`${code}Detail`].trim()).not.toBe("");
    }
    // spot-check two real strings (not placeholders)
    expect(getDictionary("ar").rejectPeriodLocked).toBe("الفترة مقفلة");
    expect(getDictionary("en").rejectCreditLimitExceeded).toBe("Credit limit exceeded");
  });

  it("covers the full rejection action table", () => {
    const ar = getDictionary("ar");
    const en = getDictionary("en");
    expect(ar.actionEditAndResend).toBe("تعديل وإعادة الإرسال");
    expect(en.actionEditAndResend).toBe("Edit and resend");
    expect(ar.actionAcceptServerPrice).toBe("اعتماد سعر الخادم");
    expect(en.actionAcceptPartial).toBe("Accept partial");
    expect(ar.actionSubstituteAndResend).toBe("استبدال وإعادة إرسال");
    expect(en.actionReviewAndMerge).toBe("Review and merge");
    expect(ar.actionDiscard).toBe("تجاهل");
    expect(en.actionRequestApproval).toBe("Request approval");
  });

  it("pins the canonical offline badge and as-of vocabulary (Journey B4 / rows 13-14-29)", () => {
    expect(getDictionary("ar").syncStatusOffline).toBe("غير متصل — سيتم المزامنة");
    expect(getDictionary("en").syncStatusOffline).toBe("Offline — will sync");
    expect(getDictionary("ar").asOfLabel).toBe("كما في {date}");
    expect(getDictionary("en").asOfLabel).toBe("As of {date}");
    expect(getDictionary("en").onlineOnlyTitle).toBe("Requires connection");
  });

  it("shows language endonyms in both locales (the toggle never mistranslates a name)", () => {
    expect(getDictionary("ar").settingsLanguageAr).toBe("العربية");
    expect(getDictionary("en").settingsLanguageAr).toBe("العربية");
    expect(getDictionary("ar").settingsLanguageEn).toBe("English");
    expect(getDictionary("en").settingsLanguageEn).toBe("English");
  });

  it("keeps Western digits inside Arabic sentences (RTL §5) — no Arabic-Indic in catalog values", () => {
    const ar = getDictionary("ar");
    for (const value of Object.values(ar)) {
      expect(value).not.toMatch(/[٠-٩]/);
    }
  });
});

describe("PHASE-022 i18n — parity validation rejects drift + empties", () => {
  const ar = getDictionary("ar");
  const en = getDictionary("en");

  it("flags a key present in ar but missing in en", () => {
    const doctoredEn = { ...en } as Record<string, string>;
    delete doctoredEn.asOfLabel;
    const violations = collectMobileParityViolations(ar, doctoredEn);
    expect(violations).toContain("missing in en: asOfLabel");
  });

  it("flags a key present in en but missing in ar", () => {
    const doctoredEn: Record<string, string> = { ...en, futureKey: "Orphan" };
    const violations = collectMobileParityViolations(ar, doctoredEn);
    expect(violations).toContain("missing in ar: futureKey");
  });

  it("flags an empty string as a violation (empty is not a translation)", () => {
    const doctoredEn: Record<string, string> = { ...en, commonOk: "" };
    const violations = collectMobileParityViolations(ar, doctoredEn);
    expect(violations).toContain("empty in en: commonOk");
  });

  it("flags whitespace-only values (trimmed emptiness is still emptiness)", () => {
    const doctoredAr: Record<string, string> = { ...ar, commonSave: "   " };
    const violations = collectMobileParityViolations(doctoredAr, en);
    expect(violations).toContain("empty in ar: commonSave");
  });

  it("rejects non-object candidates instead of throwing", () => {
    expect(collectMobileParityViolations(null, en)).toEqual([
      "dictionary candidates must be non-null objects",
    ]);
  });
});

describe("PHASE-022 i18n — t() interpolation (AR + EN)", () => {
  it("interpolates {date} into the as-of label in both locales", () => {
    expect(t("ar", "asOfLabel", { date: "2026-11-05" })).toBe("كما في 2026-11-05");
    expect(t("en", "asOfLabel", { date: "2026-11-05" })).toBe("As of 2026-11-05");
  });

  it("interpolates two params (server price detail)", () => {
    expect(t("ar", "rejectPriceChangedDetail", { server: "12.75", cached: "12.00" })).toBe(
      "السعر عند الخادم 12.75 بينما المسودة تحمل 12.00 خارج حد السماح.",
    );
    expect(t("en", "rejectPriceChangedDetail", { server: "12.75", cached: "12.00" })).toBe(
      "The server price is 12.75 while the draft carried 12.00 beyond tolerance.",
    );
  });

  it("interpolates a second two-param string (allocation summary)", () => {
    expect(t("en", "collectionAllocated", { count: 3, amount: "1,500.00 SAR" })).toBe(
      "Allocated across 3 invoices totalling 1,500.00 SAR.",
    );
  });

  it("String()-s number params as-is (formatting is the caller's job)", () => {
    expect(t("ar", "syncRetryIn", { seconds: 30 })).toBe("إعادة المحاولة بعد 30 ثانية");
    expect(t("en", "unlockPinIncorrect", { attempts: 2 })).toBe("Wrong PIN — 2 attempts left.");
  });

  it("keeps a missing param token VISIBLE (honest omission, never silent blank)", () => {
    expect(t("en", "asOfLabel", {})).toBe("As of {date}");
    expect(t("ar", "asOfLabel", {})).toBe("كما في {date}");
  });

  it("returns the raw string when no params are passed", () => {
    expect(t("ar", "commonOk")).toBe("موافق");
    expect(t("en", "appTitle")).toBe("ERP Field");
  });

  it("ignores surplus params without touching the template", () => {
    expect(t("en", "commonOk", { surplus: "x" })).toBe("OK");
  });
});

describe("PHASE-022 i18n — locale resolution + direction", () => {
  it("isRTL: ar is RTL, en is LTR (the single direction authority)", () => {
    expect(isRTL("ar")).toBe(true);
    expect(isRTL("en")).toBe(false);
  });

  it("directionFor returns the layout direction string", () => {
    expect(directionFor("ar")).toBe("rtl");
    expect(directionFor("en")).toBe("ltr");
  });

  it("resolveLocale accepts a persisted preference and falls back to Arabic", () => {
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ar")).toBe("ar");
    expect(resolveLocale("fr")).toBe("ar"); // garbage never crashes — Arabic-first default
    expect(resolveLocale("")).toBe("ar");
    expect(resolveLocale(null)).toBe("ar");
    expect(resolveLocale(undefined)).toBe("ar");
  });

  it("otherLocale swaps the pair (the settings toggle is a 1:1 link swap)", () => {
    expect(otherLocale("ar")).toBe("en");
    expect(otherLocale("en")).toBe("ar");
  });

  it("nativeDirection feeds the RN shell at the port boundary (no RN import here)", () => {
    const arDir = nativeDirection("ar");
    expect(arDir).toEqual({
      locale: "ar",
      direction: "rtl",
      isRTL: true,
      allowRTL: true,
      forceRTL: true,
    });
    expect(nativeDirection("en")).toEqual({
      locale: "en",
      direction: "ltr",
      isRTL: false,
      allowRTL: true,
      forceRTL: false,
    });
  });
});

describe("PHASE-022 i18n — digits policy (latn default, arab option)", () => {
  it("formatMoney: latn default, ',' thousands / '.' decimal, currency after the amount", () => {
    expect(formatMoney("ar", "1234.5", "SAR")).toBe("1,234.5 ر.س");
    expect(formatMoney("en", "1234.5", "SAR")).toBe("1,234.5 SAR");
    expect(formatMoney("en", "1234567.89", "SAR")).toBe("1,234,567.89 SAR");
    expect(formatMoney("en", "45.25", "SAR")).toBe("45.25 SAR"); // no grouping under 1,000
  });

  it("formatMoney: minus leads the digits; exact scale preserved (ADR-0009)", () => {
    expect(formatMoney("en", "-45.25", "SAR")).toBe("-45.25 SAR");
    expect(formatMoney("en", "1234.5000", "SAR")).toBe("1,234.5000 SAR");
    expect(formatMoney("en", "0.5", "SAR")).toBe("0.5 SAR");
  });

  it("formatMoney: unknown currency codes render verbatim; empty currency = bare amount", () => {
    expect(formatMoney("ar", "12.5", "USD")).toBe("12.5 USD");
    expect(formatMoney("en", "12.5", "USD")).toBe("12.5 USD");
    expect(formatMoney("en", "12.5", "")).toBe("12.5");
  });

  it("formatMoney: malformed amounts return VERBATIM (never invented, never labeled)", () => {
    expect(formatMoney("en", "abc", "SAR")).toBe("abc");
    expect(formatMoney("en", "", "SAR")).toBe("");
    expect(formatMoney("en", "12.", "SAR")).toBe("12.");
    expect(formatMoney("en", ".5", "SAR")).toBe(".5");
    expect(formatMoney("en", "+5", "SAR")).toBe("+5");
  });

  it("formatMoney: the arab option converts digits only — separators stay physical , .", () => {
    expect(formatMoney("ar", "1234.5", "SAR", { numerals: "arab" })).toBe("١,٢٣٤.٥ ر.س");
    expect(formatMoney("en", "1234567.89", "SAR", { numerals: "arab" })).toBe("١,٢٣٤,٥٦٧.٨٩ SAR");
    expect(formatMoney("ar", "-45.25", "SAR", { numerals: "arab" })).toBe("-٤٥.٢٥ ر.س");
  });

  it("formatQty: same shape as money, no currency, scale preserved", () => {
    expect(formatQty("en", "1234.5678")).toBe("1,234.5678");
    expect(formatQty("en", "3")).toBe("3");
    expect(formatQty("en", "-3")).toBe("-3");
    expect(formatQty("ar", "1234.5678", { numerals: "arab" })).toBe("١,٢٣٤.٥٦٧٨");
    expect(formatQty("en", "12x")).toBe("12x"); // malformed → verbatim
  });

  it("formatDate: canonical is the ISO form, always latn (even under the arab option)", () => {
    expect(formatDate("ar", "2026-11-05")).toBe("2026-11-05");
    expect(formatDate("en", "2026-11-05")).toBe("2026-11-05");
    expect(formatDate("ar", "2026-11-05", "canonical", { numerals: "arab" })).toBe("2026-11-05");
  });

  it("formatDate: short/medium/long per locale", () => {
    expect(formatDate("ar", "2026-11-05", "short")).toBe("05/11/2026");
    expect(formatDate("en", "2026-11-05", "short")).toBe("11/05/2026");
    expect(formatDate("ar", "2026-11-05", "medium")).toBe("5 نوفمبر 2026");
    expect(formatDate("en", "2026-11-05", "medium")).toBe("Nov 5, 2026");
    expect(formatDate("ar", "2026-11-05", "long")).toBe("الخميس 5 نوفمبر 2026");
    expect(formatDate("en", "2026-11-05", "long")).toBe("Thursday, November 5, 2026");
  });

  it("formatDate: real weekday names from the calendar (2027-01-31 is a Sunday)", () => {
    expect(formatDate("en", "2027-01-31", "long")).toBe("Sunday, January 31, 2027");
    expect(formatDate("ar", "2027-01-31", "long")).toBe("الأحد 31 يناير 2027");
  });

  it("formatDate: arab numerals apply to short/medium/long only", () => {
    expect(formatDate("ar", "2026-11-05", "medium", { numerals: "arab" })).toBe("٥ نوفمبر ٢٠٢٦");
    expect(formatDate("ar", "2026-11-05", "long", { numerals: "arab" })).toBe("الخميس ٥ نوفمبر ٢٠٢٦");
    expect(formatDate("ar", "2026-11-05", "short", { numerals: "arab" })).toBe("٠٥/١١/٢٠٢٦");
  });

  it("formatDate: full ISO timestamps use the date part; invalid input returns verbatim", () => {
    expect(formatDate("en", "2026-11-05T14:30:00Z")).toBe("2026-11-05");
    expect(formatDate("en", "not-a-date")).toBe("not-a-date");
    expect(formatDate("en", "2026-02-30")).toBe("2026-02-30"); // not a real day
    expect(formatDate("en", "2026-13-01")).toBe("2026-13-01"); // not a real month
  });

  it("formatDocNumber: always latn — even normalizes Arabic-Indic contamination", () => {
    expect(formatDocNumber("en", "INV-2026-0001")).toBe("INV-2026-0001");
    expect(formatDocNumber("ar", "INV-٢٠٢٦-٠٠٠١")).toBe("INV-2026-0001");
    expect(formatDocNumber("ar", "RTL-۲۰۲۶")).toBe("RTL-2026"); // extended set ۰-۹ too
  });

  it("toArabIndic / toLatnDigits round-trip the digit shapes", () => {
    expect(toArabIndic("0123456789")).toBe("٠١٢٣٤٥٦٧٨٩");
    expect(toArabIndic("A1")).toBe("A١");
    expect(toArabIndic("no digits")).toBe("no digits");
    expect(toLatnDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toArabIndic(toLatnDigits("١٢٣"))).toBe("١٢٣");
  });

  it("exports the TABULAR_NUMS_STYLE value for MoneyText / numeric columns", () => {
    expect(TABULAR_NUMS_STYLE).toEqual({ fontVariant: ["tabular-nums"] });
  });
});

describe("PHASE-022 i18n — bidi isolation (byte-exact, RTL §5)", () => {
  it("bidiIsolate wraps with FSI…PDI (U+2068…U+2069)", () => {
    const wrapped = bidiIsolate("INV-0001");
    expect(wrapped).toBe("\u2068INV-0001\u2069");
    expect(wrapped.codePointAt(0)).toBe(0x2068);
    expect(wrapped.codePointAt(wrapped.length - 1)).toBe(0x2069);
  });

  it("bidiIsolateStrong wraps with LRI…PDI (U+2066…U+2069) for identifiers", () => {
    const wrapped = bidiIsolateStrong("SA44 2000 0001 2345 6789 0000");
    expect(wrapped).toBe("\u2066SA44 2000 0001 2345 6789 0000\u2069");
    expect(wrapped.codePointAt(0)).toBe(0x2066);
    expect(wrapped.codePointAt(wrapped.length - 1)).toBe(0x2069);
  });

  it("the identifier helpers all use the strong-LTR form", () => {
    expect(bidiDocNumber("INV-2026-0001")).toBe("\u2066INV-2026-0001\u2069");
    expect(bidiIban("SA4420000001234567890000")).toBe("\u2066SA4420000001234567890000\u2069");
    expect(bidiSerial("SN-889900")).toBe("\u2066SN-889900\u2069");
    expect(bidiPhone("+966501234567")).toBe("\u2066+966501234567\u2069");
  });

  it("sanitizeBidi strips RLM/LRM/ALM, overrides, and isolates; trims", () => {
    expect(sanitizeBidi("\u2068INV-0001\u2069")).toBe("INV-0001"); // round-trips the isolates off
    expect(sanitizeBidi("\u200Fhello\u200E")).toBe("hello"); // RLM + LRM
    expect(sanitizeBidi("\u061Cمرحبا\u061C")).toBe("مرحبا"); // ALM
    expect(sanitizeBidi("\u202Abracket\u202C")).toBe("bracket"); // embedding controls
    expect(sanitizeBidi("\u202DLRO smuggle\u202C")).toBe("LRO smuggle"); // the dangerous one
    expect(sanitizeBidi("  padded  ")).toBe("padded");
  });

  it("never breaks visible text: plain content passes through", () => {
    expect(sanitizeBidi("فاتورة INV-0001 من 2026-01-02")).toBe("فاتورة INV-0001 من 2026-01-02");
  });

  it("punctuation stays OUTSIDE the isolate (the classic corruption case, RTL §5)", () => {
    const label = `فاتورة رقم ${bidiDocNumber("INV-0001")}:`;
    expect(label).toBe("فاتورة رقم \u2066INV-0001\u2069:");
    // composed with t(): screens build labels exactly this way
    const numbered = t("ar", "invoiceViewNumber", { number: bidiDocNumber("INV-2026-0001") });
    expect(numbered).toBe("الرقم: \u2066INV-2026-0001\u2069");
    const asOf = t("ar", "asOfLabel", { date: formatDate("ar", "2026-11-05") });
    expect(asOf).toBe("كما في 2026-11-05");
  });
});

describe("PHASE-022 i18n — the package surface (root barrel)", () => {
  it("re-exports the i18n area next to the golden constants", () => {
    expect(barrel.defaultLocale).toBe("ar");
    expect(typeof barrel.t).toBe("function");
    expect(typeof barrel.formatMoney).toBe("function");
    expect(barrel.directionFor("ar")).toBe("rtl");
    expect(barrel.TOUCH_TARGET_MIN).toBe(44); // constants untouched
    const dict: Dictionary = barrel.getDictionary("en");
    expect(dict.commonOk).toBe("OK");
  });
});
