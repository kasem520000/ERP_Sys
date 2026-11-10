/**
 * Money rendering helpers (ADR-0009: decimal strings only — never floats;
 * COMPONENT_CATALOG §6.2 MoneyInput contract).
 *
 * Decimal point is ALWAYS '.' and thousands separator ',' — Arabic-Indic or
 * comma-decimal display is FORBIDDEN at MVP (RTL_DESIGN_RULES §8); the digit
 * run itself is always LTR inside RTL.
 */

/** Canonical decimal string pattern (same shape as @erp/contracts MONEY_AMOUNT_PATTERN). */
const CANONICAL = /^-?\d+(\.\d+)?$/;

/** Raw digit-run input state (typing): keep plain digits + '.' + leading '-'. */
export function sanitizeMoneyInput(raw: string, minorUnits: number): string {
  // keep digits, '.', leading minus; strip anything else (paste sanitization §6.2)
  let next = raw.replace(/[^\d.-]/g, "");
  next = next.replace(/-/g, (m, off: number) => (off === 0 ? m : ""));
  const firstDot = next.indexOf(".");
  if (firstDot !== -1) {
    next = `${next.slice(0, firstDot + 1)}${next.slice(firstDot + 1).replace(/\./g, "")}`;
    next = next.slice(0, firstDot + 1 + minorUnits);
  }
  return next;
}

export function isCanonicalMoneyString(value: string): boolean {
  return CANONICAL.test(value);
}

/** Grouping display on blur: `12500` → `12,500.00` (Western grouping, `.` decimal).
 *  With minorUnits > 0 the fraction always renders exactly minorUnits digits. */
export function formatMoneyDisplay(amount: string, minorUnits: number): string {
  if (amount === "" || !CANONICAL.test(amount)) return amount;
  const negative = amount.startsWith("-");
  const abs = negative ? amount.slice(1) : amount;
  const parts = abs.split(".");
  const int = parts[0] ?? "0";
  const frac = parts[1] ?? "";
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let out: string;
  if (minorUnits > 0) {
    const fracClamped = frac.slice(0, minorUnits);
    out = `${grouped}.${fracClamped.padEnd(minorUnits, "0")}`;
  } else {
    out = grouped;
  }
  return negative ? `-${out}` : out;
}

/** Raw digits on focus: strip grouping separators for caret-preserving edits. */
export function stripMoneyGrouping(display: string): string {
  return display.replace(/,/g, "");
}

/** Sign classification for §4 semantics — color by SIGN, never by context. */
export type MoneySign = "positive" | "negative" | "zero";

export function moneySign(amount: string): MoneySign {
  if (!CANONICAL.test(amount) || amount === "") return "positive";
  const value = Number(amount);
  if (Number.isNaN(value)) return "positive";
  if (value < 0) return "negative";
  if (value === 0) return "zero";
  return "positive";
}

/** Amount color class per §4: negative red, zero gray-600, otherwise inherit. */
export function moneyColorClass(amount: string): string {
  const sign = moneySign(amount);
  if (sign === "negative") return "text-finance-negative";
  if (sign === "zero") return "text-gray-600";
  return "";
}

/** Currency chip label: ISO code + Arabic symbol (`SAR ر.س`) — LTR-isolated digits stay. */
export function currencyChipLabel(currency: string): string {
  const symbols: Record<string, string> = {
    SAR: "ر.س",
    AED: "د.إ",
    BHD: "د.ب",
    EGP: "ج.م",
    IQD: "د.ع",
    JOD: "د.أ",
    KWD: "د.ك",
    OMR: "ر.ع",
    QAR: "ر.ق",
    YER: "ر.ي",
    USD: "$",
    EUR: "€",
  };
  const symbol = symbols[currency.toUpperCase()] ?? currency;
  return `${currency.toUpperCase()} ${symbol}`;
}

/** Renders an amount for a table/list cell: grouped, tabular, sign-colored. */
export function renderMoneyCell(amount: string, currency?: string): string {
  const grouped = formatMoneyDisplay(amount, inferMinorUnits(amount));
  return currency ? `${grouped} ${currency.toUpperCase()}` : grouped;
}

function inferMinorUnits(amount: string): number {
  const frac = amount.split(".")[1] ?? "";
  return frac.length > 0 ? Math.min(frac.length, 3) : 2;
}
