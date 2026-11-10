import type { LocalizedText } from "@erp/contracts";

/**
 * Activity → template resolution (PHASE-015 T5; industries/README §4 step 1:
 * "Resolve activity to template id"): the bilingual business-activity catalog
 * the onboarding wizard renders. A declared activity maps to an industry
 * template key; an activity outside the catalog resolves to `null` — the
 * registrant onboards on the plain ERP core (no template, platform
 * defaults), never onto a wrong-industry guess.
 *
 * Catalog rules (README §1: industries are configuration):
 * - every entry carries AR + EN labels plus keywords in BOTH languages, so
 *   an Arabic-only or English-only registrant resolves identically;
 * - keyword matching normalizes case/whitespace and matches exact keywords
 *   with `confidence: "exact"`, looser containment with `"suggested"` —
 *   the wizard confirms suggestions with the registrant before applying;
 * - unknown activities never guess: `null` = plain onboarding (§4).
 */

/** One catalog row: a declared business activity → its template. */
export interface ActivityCatalogEntry {
  /** Canonical activity key (lowercase, ASCII). */
  readonly activity: string;
  /** Bilingual display label (the wizard's card title). */
  readonly label: LocalizedText;
  /** Match keywords, AR + EN, normalized (lowercase, trimmed). */
  readonly keywords: readonly string[];
  /** The industry template this activity resolves to. */
  readonly templateKey: string;
}

/**
 * The supported-activity catalog (all thirteen shipped templates — the
 * PHASE-015 trio, then extended by the PHASE-017/018/019 shells, the
 * v2.0 stage-10 shells, and the delivery-completion rental shell).
 * Exported for the onboarding UI
 * (`GET /api/v1/configuration/templates/activity-map`).
 */
export const SUPPORTED_ACTIVITIES: readonly ActivityCatalogEntry[] = Object.freeze([
  Object.freeze({
    activity: "retail",
    label: Object.freeze({ en: "Retail store", ar: "متجر تجزئة" }),
    keywords: Object.freeze([
      "retail",
      "retail store",
      "retail shop",
      "clothing store",
      "fashion store",
      "electronics store",
      "phone shop",
      "تجزئة",
      "متجر تجزئة",
      "محل تجزئة",
      "متاجر التجزئة",
      "محل ملابس",
      "محل موبايلات",
    ]),
    templateKey: "industry.retail",
  }),
  Object.freeze({
    activity: "grocery",
    label: Object.freeze({ en: "Grocery / supermarket", ar: "بقالة / سوبرماركت" }),
    keywords: Object.freeze([
      "grocery",
      "grocery store",
      "supermarket",
      "mini market",
      "corner shop",
      "بقالة",
      "بقال",
      "سوبرماركت",
      "سوبر ماركت",
      "ميني ماركت",
      "دكان",
    ]),
    templateKey: "industry.grocery",
  }),
  Object.freeze({
    activity: "restaurant",
    label: Object.freeze({ en: "Restaurant / café", ar: "مطعم / مقهى" }),
    keywords: Object.freeze([
      "restaurant",
      "cafe",
      "café",
      "coffee shop",
      "diner",
      "food court",
      "مطعم",
      "مقهى",
      "مقاهي",
      "مطاعم",
      "كافيه",
      "وجبات سريعة",
    ]),
    templateKey: "industry.restaurant",
  }),
  Object.freeze({
    activity: "automotive",
    label: Object.freeze({ en: "Auto parts & workshop", ar: "قطع غيار وورشة سيارات" }),
    keywords: Object.freeze([
      "automotive",
      "auto parts",
      "car parts",
      "workshop",
      "garage",
      "tire shop",
      "auto repair",
      "ورشة سيارات",
      "ورشة",
      "قطع غيار",
      "قطع غيار سيارات",
      "كوشة",
      "بوفيه سيارات",
      "إطارات",
      "محل اطارات",
    ]),
    templateKey: "industry.automotive",
  }),
  Object.freeze({
    activity: "distribution",
    label: Object.freeze({ en: "Distribution & field sales", ar: "توزيع ومبيعات ميدانية" }),
    keywords: Object.freeze([
      "distribution",
      "distributor",
      "field sales",
      "van sales",
      "sales routes",
      "توزيع",
      "موزع",
      "مبيعات ميدانية",
      "مندوب مبيعات",
      "مندوبين",
      "توزيع بضاعة",
    ]),
    templateKey: "industry.distribution",
  }),
  Object.freeze({
    activity: "food_manufacturing",
    label: Object.freeze({ en: "Food manufacturing", ar: "تصنيع غذائي" }),
    keywords: Object.freeze([
      "food manufacturing",
      "food production",
      "bakery production",
      "food factory",
      "food plant",
      "تصنيع غذائي",
      "مصنع غذائي",
      "مصنع أغذية",
      "معمل غذائي",
      "إنتاج غذائي",
    ]),
    templateKey: "industry.food_manufacturing",
  }),
  Object.freeze({
    activity: "professional_services",
    label: Object.freeze({ en: "Professional services", ar: "خدمات مهنية" }),
    keywords: Object.freeze([
      "professional services",
      "law office",
      "law firm",
      "accounting office",
      "consulting",
      "consultancy",
      "agency",
      "contractor",
      "خدمات مهنية",
      "مكتب محاماة",
      "مكتب محامي",
      "مكتب استشارات",
      "مكتب محاسبة",
      "استشارات",
      "مقاولات",
    ]),
    templateKey: "industry.professional_services",
  }),
  Object.freeze({
    activity: "rental_logistics",
    label: Object.freeze({ en: "Rental & logistics", ar: "تأجير وخدمات لوجستية" }),
    keywords: Object.freeze([
      "rental",
      "rental company",
      "car rental",
      "equipment rental",
      "logistics",
      "freight",
      "shipping company",
      "transport",
      "courier",
      "تأجير",
      "مكتب تأجير",
      "تأجير سيارات",
      "تأجير معدات",
      "لوجستيات",
      "خدمات لوجستية",
      "شحن",
      "شركة شحن",
      "نقل",
      "نقل بضائع",
    ]),
    templateKey: "industry.rental_logistics",
  }),
  Object.freeze({
    activity: "wholesale",
    label: Object.freeze({ en: "Wholesale & trade", ar: "جملة وتجارة" }),
    keywords: Object.freeze([
      "wholesale",
      "wholesaler",
      "trading",
      "trading company",
      "import export",
      "جملة",
      "بيع بالجملة",
      "تاجر جملة",
      "تجارة",
      "شركة تجارية",
      "استيراد وتصدير",
    ]),
    templateKey: "industry.wholesale",
  }),
  Object.freeze({
    activity: "electronics",
    label: Object.freeze({ en: "Mobiles & electronics", ar: "جوالات وإلكترونيات" }),
    keywords: Object.freeze([
      "electronics",
      "mobile shop",
      "mobile store",
      "phone repair",
      "device repair",
      "electronics repair",
      "إلكترونيات",
      "الكترونيات",
      "جوالات",
      "موبايلات",
      "محل جوالات",
      "محل إلكترونيات",
      "صيانة جوالات",
      "صيانة موبايلات",
    ]),
    templateKey: "industry.electronics",
  }),
  Object.freeze({
    activity: "healthcare",
    label: Object.freeze({ en: "Healthcare (commercial)", ar: "رعاية صحية (تجاري)" }),
    keywords: Object.freeze([
      "healthcare",
      "clinic",
      "medical center",
      "pharmacy",
      "dispensary",
      "medical clinic",
      "عيادة",
      "عيادات",
      "مركز طبي",
      "مستوصف",
      "صيدلية",
      "صيدليات",
    ]),
    templateKey: "industry.healthcare",
  }),
  Object.freeze({
    activity: "education",
    label: Object.freeze({ en: "Education (commercial)", ar: "تعليم (تجاري)" }),
    keywords: Object.freeze([
      "education",
      "school",
      "institute",
      "training center",
      "academy",
      "تعليم",
      "مدرسة",
      "مدارس",
      "معهد",
      "معاهد",
      "مركز تدريب",
      "دورات",
      "أكاديمية",
    ]),
    templateKey: "industry.education",
  }),
  Object.freeze({
    activity: "agriculture",
    label: Object.freeze({ en: "Agriculture", ar: "زراعة" }),
    keywords: Object.freeze([
      "agriculture",
      "farm",
      "farming",
      "livestock",
      "poultry",
      "greenhouse",
      "زراعة",
      "مزرعة",
      "مزارع",
      "ثروة حيوانية",
      "مواشي",
      "دواجن",
      "بيوت محمية",
    ]),
    templateKey: "industry.agriculture",
  }),
]);

/** Normalize free-text input for matching (case + whitespace folding). */
function normalizeActivity(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a declared business activity to a template key.
 *
 * - an exact keyword hit (either language) → `{ confidence: "exact" }`;
 * - a containment hit (the activity contains a keyword of ≥ 4 characters,
 *   or a keyword contains the activity — e.g. "retail and wholesale" or
 *   "supermarket branch") → `{ confidence: "suggested" }` (the wizard
 *   confirms before applying);
 * - anything else → `null` — plain onboarding, no template (§4).
 */
export function resolveTemplateForActivity(
  activity: string,
): { templateKey: string; confidence: "exact" | "suggested" } | null {
  const normalized = normalizeActivity(activity);
  if (normalized.length === 0) {
    return null;
  }
  for (const entry of SUPPORTED_ACTIVITIES) {
    if (entry.keywords.includes(normalized) || entry.activity === normalized) {
      return { templateKey: entry.templateKey, confidence: "exact" };
    }
  }
  // Looser pass: containment in either direction, both sides ≥ 4 chars so
  // a stray fragment ("caf") inside an unrelated word can never fire.
  for (const entry of SUPPORTED_ACTIVITIES) {
    for (const keyword of entry.keywords) {
      if (
        keyword.length >= 4 &&
        normalized.length >= 4 &&
        (normalized.includes(keyword) || keyword.includes(normalized))
      ) {
        return { templateKey: entry.templateKey, confidence: "suggested" };
      }
    }
  }
  return null;
}
