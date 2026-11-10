/**
 * PHASE-022 · the digits policy (MASTER-PLAN §5 / DR-P22-04): identifiers,
 * amounts and doc numbers render `latn` (Western digits) with tabular-nums;
 * `arab` (Arabic-Indic) DISPLAY is tenant-configurable behind an option — it
 * never applies to identifiers (formatDocNumber is always latn).
 *
 * Binding rules implemented (RTL_DESIGN_RULES §8 + ADR-0009):
 *   - money/quantities are TEXT canonical decimal strings (`/^-?\d+(\.\d+)?$/`)
 *     — NEVER REAL. A malformed input is returned VERBATIM, unformatted and
 *     unlabeled: the formatter never invents precision (honesty over cosmetics).
 *   - thousands separator "," and decimal point "." are PHYSICAL — they never
 *     mirror and never become "٬"/"٫" even under the `arab` display option.
 *   - the minus sign LEADS the digits (RTL §8); parentheses-as-negative are
 *     forbidden.
 *   - the decimal SCALE of the input is preserved exactly ("1234.5000" stays
 *     4-dp) — no padding, no truncation.
 *   - currency: ISO codes in, localized short label out (`SAR` → ar "ر.س" /
 *     en "SAR"); unknown codes render verbatim (bilingual-neutral); an empty
 *     currency yields the bare formatted amount.
 *
 * Formatting is hand-rolled (no Intl): RN locale data is uneven and the
 * parity gate needs byte-deterministic outputs in both locales.
 */
import type { Locale } from "./dictionaries";

/** Digit-shape display option — `latn` is the default; `arab` is the
 * tenant-configurable presentation layer (never for identifiers). */
export type NumeralsOption = "latn" | "arab";

export interface DigitsOptions {
  numerals?: NumeralsOption;
}

// -- the digit-shape primitives ------------------------------------------------

const ARAB_INDIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"] as const;
const EXTENDED_ARAB_INDIC_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"] as const;

/** ASCII 0-9 → Arabic-Indic ٠-٩. Non-digits pass through untouched. */
export function toArabIndic(text: string): string {
  return text.replace(/[0-9]/g, (digit: string): string => {
    return ARAB_INDIC_DIGITS[Number(digit)] ?? digit;
  });
}

/** Arabic-Indic ٠-٩ (and the extended ۰-۹ set) → ASCII 0-9 — the defensive
 * normalizer for identifiers that must stay latn (see formatDocNumber). */
export function toLatnDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (glyph: string): string => {
    const indic = ARAB_INDIC_DIGITS.indexOf(glyph as (typeof ARAB_INDIC_DIGITS)[number]);
    if (indic >= 0) return String(indic);
    const extended = EXTENDED_ARAB_INDIC_DIGITS.indexOf(glyph as (typeof EXTENDED_ARAB_INDIC_DIGITS)[number]);
    return extended >= 0 ? String(extended) : glyph;
  });
}

function applyNumerals(text: string, numerals: NumeralsOption | undefined): string {
  return numerals === "arab" ? toArabIndic(text) : text;
}

// -- decimal-string formatting (pure string math — ADR-0009, no floats) --------

const CANONICAL_DECIMAL = /^-?\d+(\.\d+)?$/;

/** "1234567" → "1,234,567" (groups of three from the units side). */
function groupIntegerPart(intPart: string): string {
  if (intPart.length <= 3) {
    return intPart;
  }
  const groups: string[] = [];
  let end = intPart.length;
  while (end > 0) {
    groups.unshift(intPart.slice(Math.max(0, end - 3), end));
    end -= 3;
  }
  return groups.join(",");
}

/** Group a canonical decimal string, preserving its exact scale and sign. */
function formatDecimalWithGrouping(canonical: string): string {
  const negative = canonical.startsWith("-");
  const unsigned = negative ? canonical.slice(1) : canonical;
  const dot = unsigned.indexOf(".");
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracPart = dot === -1 ? undefined : unsigned.slice(dot + 1);
  const grouped = groupIntegerPart(intPart);
  const body = fracPart === undefined ? grouped : `${grouped}.${fracPart}`;
  return negative ? `-${body}` : body;
}

// -- currency -------------------------------------------------------------------

/** Localized short labels for known ISO codes; unknown codes render verbatim
 * in both locales (bilingual-neutral — callers pass ISO codes, never
 * pre-localized labels). */
const CURRENCY_DISPLAY: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  SAR: { ar: "ر.س", en: "SAR" },
};

function currencyLabel(locale: Locale, currency: string): string {
  if (currency === "") return "";
  const known = CURRENCY_DISPLAY[currency];
  if (known === undefined) return currency;
  return known[locale];
}

/**
 * Format a money amount (TEXT canonical decimal string) for display:
 * latn digits by default, "," thousands / "." decimal (physical — never
 * mirrored), minus leads the digits, exact scale preserved, currency label
 * appended after the amount ("1,234.50 ر.س" / "1,234.50 SAR").
 * Malformed amounts are returned verbatim (never invented, never labeled).
 */
export function formatMoney(
  locale: Locale,
  amount: string,
  currency: string,
  options?: DigitsOptions,
): string {
  if (!CANONICAL_DECIMAL.test(amount)) {
    return amount;
  }
  const amountText = applyNumerals(formatDecimalWithGrouping(amount), options?.numerals);
  const label = currencyLabel(locale, currency);
  return label === "" ? amountText : `${amountText} ${label}`;
}

/**
 * Format a quantity (TEXT canonical decimal string): same grouping/scale/
 * numerals policy as money, no currency. The locale parameter is kept for
 * signature symmetry with formatMoney (quantity shapes are locale-invariant
 * under the digits policy).
 */
export function formatQty(
  _locale: Locale,
  qty: string,
  options?: DigitsOptions,
): string {
  if (!CANONICAL_DECIMAL.test(qty)) {
    return qty;
  }
  return applyNumerals(formatDecimalWithGrouping(qty), options?.numerals);
}

// -- dates (Gregorian only — A-004; fiscal years stay Gregorian) -----------------

const MONTH_NAMES: Readonly<Record<Locale, readonly string[]>> = {
  ar: [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

const MONTH_NAMES_SHORT_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const WEEKDAY_NAMES: Readonly<Record<Locale, readonly string[]>> = {
  ar: ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export type DateStyle = "canonical" | "short" | "medium" | "long";

/** `YYYY-MM-DD` or a full ISO timestamp (the time part is ignored — dates
 * only at MVP); a four-digit year, valid month/day (real calendar lengths,
 * e.g. 2026-02-30 is malformed). Unparseable input returns verbatim. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Format an ISO date for display:
 *   - canonical (default): `2026-11-05` — the ISO identifier form, ALWAYS
 *     latn in both locales, ignoring the numerals option (identifier-adjacent,
 *     like doc numbers).
 *   - short:  ar `05/11/2026` (DD/MM/YYYY) / en `11/05/2026` (MM/DD/YYYY).
 *   - medium: ar `5 نوفمبر 2026` / en `Nov 5, 2026`.
 *   - long:   ar `الخميس 5 نوفمبر 2026` / en `Thursday, November 5, 2026`.
 * The `arab` numerals option applies to short/medium/long only.
 */
export function formatDate(
  locale: Locale,
  iso: string,
  style: DateStyle = "canonical",
  options?: DigitsOptions,
): string {
  const match = ISO_DATE.exec(iso);
  if (match === null) {
    return iso;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return iso; // e.g. 2026-02-30 — round-trip mismatch means not a real day
  }
  if (style === "canonical") {
    return `${year}-${pad2(month)}-${pad2(day)}`; // always latn — see header
  }
  let text: string;
  switch (style) {
    case "short":
      text =
        locale === "ar"
          ? `${pad2(day)}/${pad2(month)}/${year}`
          : `${pad2(month)}/${pad2(day)}/${year}`;
      break;
    case "medium":
      text =
        locale === "ar"
          ? `${day} ${MONTH_NAMES.ar[month - 1] ?? ""} ${year}`
          : `${MONTH_NAMES_SHORT_EN[month - 1] ?? ""} ${day}, ${year}`;
      break;
    case "long": {
      const weekday = WEEKDAY_NAMES[locale][utc.getUTCDay()] ?? "";
      text =
        locale === "ar"
          ? `${weekday} ${day} ${MONTH_NAMES.ar[month - 1] ?? ""} ${year}`
          : `${weekday}, ${MONTH_NAMES.en[month - 1] ?? ""} ${day}, ${year}`;
      break;
    }
  }
  return applyNumerals(text, options?.numerals);
}

// -- identifiers -------------------------------------------------------------------

/**
 * Doc numbers are ALWAYS latn (identifiers never take the arab display —
 * DR-P22-04). This is also the defensive normalizer: any Arabic-Indic digits
 * that crept into an identifier (bad paste, upstream bug) are converted back
 * to ASCII before display. The locale parameter is positional only.
 */
export function formatDocNumber(_locale: Locale, docNo: string): string {
  return toLatnDigits(docNo);
}

// -- tabular numerals (the rendering half of the policy) ---------------------------

/**
 * The RN style value for tabular numerals — consumed by MoneyText and every
 * numeric column (the theme primitives / screens join it onto their text
 * styles; money cells also get `textAlign: "end"` logical alignment per
 * RTL_DESIGN_RULES §8). Plain frozen object: NO react-native import — RN's
 * TextStyle accepts it structurally (DR-P22-01 pure-TS).
 */
export const TABULAR_NUMS_STYLE: { fontVariant: "tabular-nums"[] } = {
  fontVariant: ["tabular-nums"],
};
