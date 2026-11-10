/**
 * PHASE-013 · tafqit — amount-in-words (PRINTING_AND_EXPORT §2, adopted
 * from Folder 1): the shared helper every `a4-document` financial print
 * uses for the document total; verified per locale and per currency
 * minor-unit (2-dp and 3-dp currencies KWD/BHD/OMR/JOD/IQD) with fixture
 * tests. No print template may format amount-in-words with ad-hoc string
 * logic.
 */

const AR_ONES = [
  "",
  "واحد",
  "اثنان",
  "ثلاثة",
  "أربعة",
  "خمسة",
  "ستة",
  "سبعة",
  "ثمانية",
  "تسعة",
  "عشرة",
  "أحد عشر",
  "اثنا عشر",
  "ثلاثة عشر",
  "أربعة عشر",
  "خمسة عشر",
  "ستة عشر",
  "سبعة عشر",
  "ثمانية عشر",
  "تسعة عشر",
];
const AR_TENS = ["", "عشرة", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
/** Feminine counterparts (هللة/بيسة counted nouns): 1–19 reverse gender. */
const AR_ONES_FEM = [
  "",
  "واحدة",
  "اثنتان",
  "ثلاث",
  "أربع",
  "خمس",
  "ست",
  "سبع",
  "ثمان",
  "تسع",
  "عشر",
  "إحدى عشرة",
  "اثنتا عشرة",
  "ثلاث عشرة",
  "أربع عشرة",
  "خمس عشرة",
  "ست عشرة",
  "سبع عشرة",
  "ثماني عشرة",
  "تسع عشرة",
];
const AR_HUNDREDS = [
  "",
  "مائة",
  "مائتان",
  "ثلاثمائة",
  "أربعمائة",
  "خمسمائة",
  "ستمائة",
  "سبعمائة",
  "ثمانمائة",
  "تسعمائة",
];

const EN_ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * Arabic noun forms for the counted currency:
 * [مفرد, مفرد منصوب (11–99), جمع (3–10), مثنى].
 */
interface ArCurrencyWords {
  readonly major: readonly [string, string, string, string];
  /** [مفرد, جمع (3–10), مثنى] — 11–99 and 100+ take the singular. */
  readonly minor: readonly [string, string, string];
  /** Feminine minor nouns (هللة، بيسة): the 1–19 number words agree feminine. */
  readonly minorFeminine?: boolean;
}

/** English noun forms: [singular, plural] (the number decides). */
interface EnCurrencyWords {
  readonly major: readonly [string, string];
  readonly minor: readonly [string, string];
}

const CURRENCIES: Readonly<
  Record<string, { minorUnits: number; ar: ArCurrencyWords; en: EnCurrencyWords }>
> = Object.freeze({
  SAR: {
    minorUnits: 2,
    ar: {
      major: ["ريال سعودي", "ريالاً سعودياً", "ريالات سعودية", "ريالان سعوديان"],
      minor: ["هللة", "هللات", "هللتان"],
      minorFeminine: true,
    },
    en: { major: ["Saudi riyal", "Saudi riyals"], minor: ["halala", "halalas"] },
  },
  AED: {
    minorUnits: 2,
    ar: {
      major: ["درهم إماراتي", "درهماً إماراتياً", "دراهم إماراتية", "درهمان إماراتيان"],
      minor: ["فلس", "فلوس", "فلستان"],
    },
    en: { major: ["UAE dirham", "UAE dirhams"], minor: ["fils", "fils"] },
  },
  QAR: {
    minorUnits: 2,
    ar: {
      major: ["ريال قطري", "ريالاً قطرياً", "ريالات قطرية", "ريالان قطريان"],
      minor: ["درهم", "دراهم", "درهمان"],
    },
    en: { major: ["Qatari riyal", "Qatari riyals"], minor: ["dirham", "dirhams"] },
  },
  KWD: {
    minorUnits: 3,
    ar: {
      major: ["دينار كويتي", "ديناراً كويتياً", "دنانير كويتية", "ديناران كويتيان"],
      minor: ["فلس", "فلوس", "فلستان"],
    },
    en: { major: ["Kuwaiti dinar", "Kuwaiti dinars"], minor: ["fils", "fils"] },
  },
  BHD: {
    minorUnits: 3,
    ar: {
      major: ["دينار بحريني", "ديناراً بحرينياً", "دنانير بحرينية", "ديناران بحرينيان"],
      minor: ["فلس", "فلوس", "فلستان"],
    },
    en: { major: ["Bahraini dinar", "Bahraini dinars"], minor: ["fils", "fils"] },
  },
  OMR: {
    minorUnits: 3,
    ar: {
      major: ["ريال عماني", "ريالاً عمانياً", "ريالات عمانية", "ريالان عمانيان"],
      minor: ["بيسة", "بيسات", "بيستان"],
      minorFeminine: true,
    },
    en: { major: ["Omani rial", "Omani riyals"], minor: ["baisa", "baisas"] },
  },
  JOD: {
    minorUnits: 3,
    ar: {
      major: ["دينار أردني", "ديناراً أردنياً", "دنانير أردنية", "ديناران أردنيان"],
      minor: ["فلس", "فلوس", "فلستان"],
    },
    en: { major: ["Jordanian dinar", "Jordanian dinars"], minor: ["fils", "fils"] },
  },
  IQD: {
    minorUnits: 3,
    ar: {
      major: ["دينار عراقي", "ديناراً عراقياً", "دنانير عراقية", "ديناران عراقيان"],
      minor: ["فلس", "فلوس", "فلستان"],
    },
    en: { major: ["Iraqi dinar", "Iraqi dinars"], minor: ["fils", "fils"] },
  },
  EGP: {
    minorUnits: 2,
    ar: {
      major: ["جنيه مصري", "جنيهاً مصرياً", "جنيهات مصرية", "جنيهان مصريان"],
      minor: ["قرش", "قروش", "قرشان"],
    },
    en: { major: ["Egyptian pound", "Egyptian pounds"], minor: ["piastre", "piastres"] },
  },
  USD: {
    minorUnits: 2,
    ar: {
      major: ["دولار أمريكي", "دولاراً أمريكياً", "دولارات أمريكية", "دولاران أمريكيان"],
      minor: ["سنت", "سنتات", "سنتان"],
    },
    en: { major: ["US dollar", "US dollars"], minor: ["cent", "cents"] },
  },
  EUR: {
    minorUnits: 2,
    ar: {
      major: ["يورو", "يورو", "يورو", "يورو"],
      minor: ["سنت", "سنتات", "سنتان"],
    },
    en: { major: ["euro", "euros"], minor: ["cent", "cents"] },
  },
  YER: {
    minorUnits: 2,
    ar: {
      major: ["ريال يمني", "ريالاً يمنياً", "ريالات يمنية", "ريالان يمنيان"],
      minor: ["فلس", "فلوس", "فلستان"],
    },
    en: { major: ["Yemeni rial", "Yemeni riyals"], minor: ["fils", "fils"] },
  },
});

function currencyOf(code: string): { minorUnits: number; ar: ArCurrencyWords; en: EnCurrencyWords } {
  return (
    CURRENCIES[code] ?? {
      minorUnits: 2,
      ar: { major: [code, code, code, code], minor: ["", "", ""] },
      en: { major: [code, code], minor: ["", ""] },
    }
  );
}

/** Parse a decimal string into { whole, fraction } at the currency scale. */
function parseAmount(amount: string, minorUnits: number): { whole: bigint; fraction: bigint; negative: boolean } {
  const negative = amount.trim().startsWith("-");
  const cleaned = amount.trim().replace("-", "");
  const [wholeStr = "0", fracStr = ""] = cleaned.split(".");
  const whole = BigInt(wholeStr === "" ? "0" : wholeStr);
  const fraction = BigInt((fracStr + "0".repeat(minorUnits)).slice(0, minorUnits) || "0");
  return { whole, fraction, negative };
}

function arUnderThousand(n: bigint, feminine = false): string {
  const ones = feminine ? AR_ONES_FEM : AR_ONES;
  const parts: string[] = [];
  const hundreds = n / 100n;
  const rest = n % 100n;
  if (hundreds > 0n) {
    parts.push(AR_HUNDREDS[Number(hundreds)] ?? "");
  }
  if (rest >= 1n && rest <= 19n) {
    parts.push(ones[Number(rest)] ?? "");
  } else if (rest >= 20n) {
    const onesDigit = rest % 10n;
    const tens = rest / 10n;
    if (onesDigit > 0n) {
      parts.push(`${ones[Number(onesDigit)] ?? ""} و${AR_TENS[Number(tens)] ?? ""}`);
    } else {
      parts.push(AR_TENS[Number(tens)] ?? "");
    }
  }
  return parts.join(" و");
}

function arWholeWords(n: bigint): string {
  if (n === 0n) {
    return "صفر";
  }
  const groups: { value: bigint; one: string; two: string; few: string; many: string }[] = [
    { value: 1_000_000_000_000n, one: "تريليون", two: "تريليونان", few: "تريليونات", many: "تريليوناً" },
    { value: 1_000_000_000n, one: "مليار", two: "ملياران", few: "مليارات", many: "ملياراً" },
    { value: 1_000_000n, one: "مليون", two: "مليونان", few: "ملايين", many: "مليوناً" },
    { value: 1_000n, one: "ألف", two: "ألفان", few: "آلاف", many: "ألفاً" },
  ];
  let remaining = n;
  const parts: string[] = [];
  for (const group of groups) {
    const count = remaining / group.value;
    remaining %= group.value;
    if (count === 0n) {
      continue;
    }
    if (count === 1n) {
      parts.push(group.one);
    } else if (count === 2n) {
      parts.push(group.two);
    } else if (count >= 3n && count <= 10n) {
      parts.push(`${arUnderThousand(count)} ${group.few}`);
    } else {
      parts.push(`${arUnderThousand(count)} ${group.many}`);
    }
  }
  if (remaining > 0n) {
    parts.push(arUnderThousand(remaining));
  }
  return parts.join(" و");
}

function enUnderThousand(n: bigint): string {
  const parts: string[] = [];
  const hundreds = n / 100n;
  const rest = n % 100n;
  if (hundreds > 0n) {
    parts.push(`${EN_ONES[Number(hundreds)]} hundred`);
  }
  if (rest >= 1n && rest <= 19n) {
    parts.push(EN_ONES[Number(rest)] ?? "");
  } else if (rest >= 20n) {
    const ones = rest % 10n;
    const tens = rest / 10n;
    parts.push(ones > 0n ? `${EN_TENS[Number(tens)] ?? ""}-${EN_ONES[Number(ones)] ?? ""}` : EN_TENS[Number(tens)] ?? "");
  }
  return parts.join(" and ");
}

function enWholeWords(n: bigint): string {
  if (n === 0n) {
    return "zero";
  }
  const groups: { value: bigint; label: string }[] = [
    { value: 1_000_000_000n, label: "billion" },
    { value: 1_000_000n, label: "million" },
    { value: 1_000n, label: "thousand" },
  ];
  let remaining = n;
  const parts: string[] = [];
  for (const group of groups) {
    const count = remaining / group.value;
    remaining %= group.value;
    if (count > 0n) {
      parts.push(`${enUnderThousand(count)} ${group.label}`);
    }
  }
  if (remaining > 0n) {
    parts.push(enUnderThousand(remaining));
  }
  return parts.join(" ");
}

/**
 * Arabic counted-noun agreement (تمييز العدد) for the whole part: the last
 * two digits decide — 11–99 → singular accusative (مفرد منصوب), 3–10 →
 * plural (جمع), 2 → dual (مثنى); 1, whole hundreds (100–999) and exact
 * scale groups (ألف/مليون…) take the singular.
 */
function arMajorIndex(n: bigint): 0 | 1 | 2 | 3 {
  const rem100 = n % 100n;
  if (rem100 >= 11n && rem100 <= 99n) {
    return 1;
  }
  if (rem100 >= 3n && rem100 <= 10n) {
    return 2;
  }
  if (rem100 === 2n) {
    return 3;
  }
  return 0;
}

/**
 * Render an amount in words per locale and currency (the tafqit contract).
 * Examples: ("12500.0000", "SAR", "ar") → "اثنا عشر ألفاً وخمسمائة ريال سعودي".
 */
export function amountToWords(amount: string, currencyCode: string, locale: "ar" | "en"): string {
  const currency = currencyOf(currencyCode);
  const { whole, fraction, negative } = parseAmount(amount, currency.minorUnits);
  const prefix = negative ? (locale === "ar" ? "سالب " : "minus ") : "";
  if (locale === "ar") {
    if (whole === 0n && fraction === 0n) {
      return `صفر ${currency.ar.major[0]}`;
    }
    let words: string;
    if (whole === 1n) {
      words = `${currency.ar.major[0]} واحد`;
    } else if (whole === 2n) {
      words = currency.ar.major[3];
    } else {
      words = `${arWholeWords(whole)} ${currency.ar.major[arMajorIndex(whole)]}`;
    }
    if (fraction > 0n) {
      // Minor units never exceed 999 (3-dp currencies) — the gender-aware
      // under-a-thousand words cover the whole minor range (هللة/بيسة are
      // feminine: خمس هللات، خمس عشرة هللة).
      const minorNumberWords = arUnderThousand(fraction, currency.ar.minorFeminine === true);
      const minorWord =
        fraction === 1n
          ? `${currency.ar.minor[0]} واحدة`
          : fraction === 2n
            ? currency.ar.minor[2]
            : `${minorNumberWords} ${
                fraction >= 3n && fraction <= 10n ? currency.ar.minor[1] : currency.ar.minor[0]
              }`;
      words += ` و${minorWord}`;
    }
    return `${prefix}${words}`.trim();
  }
  if (whole === 0n && fraction === 0n) {
    return `zero ${currency.en.major[1]}`;
  }
  let words = `${enWholeWords(whole)} ${whole === 1n ? currency.en.major[0] : currency.en.major[1]}`;
  if (fraction > 0n) {
    words += ` and ${enWholeWords(fraction)} ${fraction === 1n ? currency.en.minor[0] : currency.en.minor[1]}`;
  }
  return `${prefix}${words}`.trim();
}
