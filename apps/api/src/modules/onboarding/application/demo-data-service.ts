import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { getDb } from "../../../infra/db/client";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { OnboardingService } from "../../tenancy/application/onboarding-service";
import { TemplateApplyService } from "../../configuration/application/apply/apply-service";
import { PeriodService } from "../../accounting/application/period-service";
import { BranchService } from "../../tenancy/application/branch-service";
import { WarehouseService } from "../../inventory/application/warehouse-service";
import { AccountService } from "../../treasury/application/account-service";
import { ReceiptService } from "../../treasury/application/receipt-service";
import { PartnerService } from "../../partners/application/partner-service";
import { OpeningBalancesService } from "../../partners/application/opening-balances-service";
import { ItemService } from "../../items/application/item-service";
import { PriceListService } from "../../items/application/price-list-service";
import { SalesInvoiceService } from "../../sales/application/invoices";
import { OpeningStockService } from "../../inventory/application/opening-stock-service";
import { TaxCodesService } from "../../tax/application/codes-service";
import * as tenancyStore from "../../tenancy/infrastructure/tenancy.store";
import { insertAccountPurpose } from "../../tenancy/infrastructure/tenancy.store";
import * as itemsStore from "../../items/infrastructure/items.store";
import * as partnersStore from "../../partners/infrastructure/partners.store";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import { findActivePurpose } from "../../accounting/infrastructure/accounting.store";
import { DemoSeedRefusedError, ImportKindUnknownError } from "../domain/onboarding-errors";

/**
 * PHASE-040 demo-data loader (§2.5, TB-19/TB-20): one click seeds a tenant
 * with REALISTIC data per industry template — partners, items, a price
 * list, opening stock, posted sales invoices and receipts — every journal
 * POSTED THROUGH THE POSTING ENGINE so reports and dashboards light up with
 * real GL data. Idempotent re-run (natural keys DEMO-*): existing rows are
 * skipped, zero duplicates.
 *
 * Guardrails:
 * - A tenant with posted real documents refuses demo seeding (typed
 *   rejection — journals exist and the demo never ran here).
 * - Re-seeding a different template on an already-seeded tenant refuses
 *   (the template switch flow owns that — the apply engine's contract).
 * - SoD discipline: the synthetic DEMO_ACTOR creates, DEMO_APPROVER
 *   approves (creator ≠ approver holds — the fixture pattern).
 *
 * The whole seed runs in ONE ambient tenant UoW (all-or-nothing).
 */

/** Synthetic actors (SoD: creator ≠ approver — the sales fixtures' pattern). */
const DEMO_ACTOR = "a11ce500-0000-4000-8000-0000000000d1";
const DEMO_APPROVER = "a11ce500-0000-4000-8000-0000000000d2";

/**
 * The synthetic actors must exist as user rows (audit_events.actor_id FK —
 * the sales-fixtures pattern). Idempotent per deterministic id/email; the
 * rows carry non-login password hashes.
 */
async function ensureDemoActorUsers(): Promise<void> {
  await getDb().execute(sql`
    INSERT INTO users (id, email, full_name, password_hash, status) VALUES
      (${DEMO_ACTOR}, 'demo-actor@erp.internal', 'Demo Data Actor', 'not-a-login-hash', 'ACTIVE'),
      (${DEMO_APPROVER}, 'demo-approver@erp.internal', 'Demo Approver', 'not-a-login-hash', 'ACTIVE')
    ON CONFLICT DO NOTHING
  `);
}

export interface DemoSeedSummary {
  templateKey: string;
  created: {
    partners: number;
    items: number;
    invoices: number;
    receipts: number;
    priceLists: number;
    warehouses: number;
    cashAccounts: number;
  };
  skipped: { reason: string } | null;
}

/** Shared realistic partner names (bilingual trading businesses). */
const CUSTOMERS: readonly { name: string; nameAr: string }[] = [
  { name: "Elite Trading Co.", nameAr: "شركة النخبة التجارية" },
  { name: "Golden Horizon", nameAr: "الأفق الذهبي" },
  { name: "Al-Salam Stores", nameAr: "متاجر السلام" },
  { name: "Noor Foundation", nameAr: "مؤسسة نور" },
  { name: "Cedar House", nameAr: "بيت الأرز" },
  { name: "Falcon Supplies", nameAr: "مؤسسة الصقر للتوريدات" },
  { name: "Bait Al-Khair", nameAr: "بيت الخير" },
  { name: "Modern Vision", nameAr: "الرؤية الحديثة" },
  { name: "Dar Al-Rayan", nameAr: "دار الريان" },
  { name: "Summit Enterprises", nameAr: "مؤسسة القمة" },
];

const SUPPLIERS: readonly { name: string; nameAr: string }[] = [
  { name: "Gulf Wholesale", nameAr: "الخليج للجملة" },
  { name: "Al-Manar Factory", nameAr: "مصنع المنار" },
  { name: "Unity Imports", nameAr: "الوحدة للاستيراد" },
  { name: "Rawda Materials", nameAr: "مواد الروضة" },
  { name: "Tamkeen Logistics", nameAr: "تمكين للخدمات اللوجستية" },
];

/** Per-template item packs (8 realistic names each, bilingual). */
const ITEM_PACKS: Readonly<Record<string, readonly { name: string; nameAr: string }[]>> = {
  "industry.retail": [
    { name: "Men's Cotton T-Shirt", nameAr: "تيشيرت رجالي قطن" },
    { name: "Women's Abaya (Classic)", nameAr: "عباءة نسائية كلاسيكية" },
    { name: "Kids' Sneakers", nameAr: "حذاء رياضي أطفال" },
    { name: "Leather Belt", nameAr: "حزام جلدي" },
    { name: "Denim Jeans", nameAr: "بنطال جينز" },
    { name: "Silk Scarf", nameAr: "وشاح حريري" },
    { name: "Sports Socks (3-pack)", nameAr: "جوارب رياضية (٣ أزواج)" },
    { name: "Handbag (Premium)", nameAr: "حقيبة يد فاخرة" },
  ],
  "industry.grocery": [
    { name: "Arabic Coffee 500g", nameAr: "قهوة عربية ٥٠٠ جم" },
    { name: "Basmati Rice 5kg", nameAr: "أرز بسمتي ٥ كجم" },
    { name: "Olive Oil 1L", nameAr: "زيت زيتون ١ لتر" },
    { name: "Dates Ajwa 1kg", nameAr: "تمر عجوة ١ كجم" },
    { name: "Full-Fat Milk 1L", nameAr: "حليب كامل الدسم ١ لتر" },
    { name: "Egyptian Sugar 2kg", nameAr: "سكر مصري ٢ كجم" },
    { name: "Honey (Natural) 500g", nameAr: "عسل طبيعي ٥٠٠ جم" },
    { name: "Black Tea 100 Bags", nameAr: "شاي أسود ١٠٠ كيس" },
  ],
  "industry.restaurant": [
    { name: "Mixed Grill Platter", nameAr: "مشاوي مشكلة" },
    { name: "Chicken Shawarma", nameAr: "شاورما دجاج" },
    { name: "Margherita Pizza", nameAr: "بيتزا مارغريتا" },
    { name: "Arabic Mezze Board", nameAr: "مقبلات عربية" },
    { name: "Fresh Orange Juice", nameAr: "عصير برتقال طازج" },
    { name: "Kabsa (Family)", nameAr: "كبسة عائلية" },
    { name: "Garden Salad", nameAr: "سلطة خضراء" },
    { name: "Umm Ali Dessert", nameAr: "أم علي" },
  ],
  "industry.automotive": [
    { name: "Engine Oil 5W-30 (4L)", nameAr: "زيت محرك 5W-30 (٤ لتر)" },
    { name: "Brake Pads (Front)", nameAr: "فحمات فرامل أمامية" },
    { name: "Cabin Air Filter", nameAr: "فلتر مكيف" },
    { name: "Spark Plug (Iridium)", nameAr: "شمعة إشعال إيريديوم" },
    { name: "Car Battery 70Ah", nameAr: "بطارية ٧٠ أمبير" },
    { name: "Tire 205/55 R16", nameAr: "إطار 205/55 R16" },
    { name: "Wiper Blade Pair", nameAr: "مساحات زجاج (زوج)" },
    { name: "Timing Belt Kit", nameAr: "طقم سير التايمينج" },
  ],
  "industry.distribution": [
    { name: "Soft Drinks Case (24)", nameAr: "كرتون مشروبات غازية (٢٤)" },
    { name: "Water Bottles Case (12)", nameAr: "كرتون مياه (١٢)" },
    { name: "Snacks Mixed Box", nameAr: "صندوق وجبات خفيفة مشكل" },
    { name: "Detergent 3L", nameAr: "منظف ٣ لتر" },
    { name: "Tissue Box (Bulk)", nameAr: "علب مناديل (جملة)" },
    { name: "Chips Carton", nameAr: "كرتون شيبس" },
    { name: "Juice Pack 1L (12)", nameAr: "عبوة عصير ١ لتر (١٢)" },
    { name: "Biscuits Carton", nameAr: "كرتون بسكويت" },
  ],
  "industry.food_manufacturing": [
    { name: "White Flour 50kg", nameAr: "دقيق أبيض ٥٠ كجم" },
    { name: "Refined Sugar 25kg", nameAr: "سكر مكرر ٢٥ كجم" },
    { name: "Palm Oil 20L", nameAr: "زيت نخيل ٢٠ لتر" },
    { name: "Yeast (Instant) 1kg", nameAr: "خميرة فورية ١ كجم" },
    { name: "Salt (Iodized) 25kg", nameAr: "ملح مدعم باليود ٢٥ كجم" },
    { name: "Milk Powder 25kg", nameAr: "حليب مجفف ٢٥ كجم" },
    { name: "Cocoa Powder 10kg", nameAr: "مسحوق كاكاو ١٠ كجم" },
    { name: "Packaging Film Roll", nameAr: "لفة فيلم تغليف" },
  ],
  "industry.professional_services": [
    { name: "Consulting Hour (Senior)", nameAr: "ساعة استشارية (خبير أول)" },
    { name: "Audit Engagement (Std)", nameAr: "تكليف تدقيق (قياسي)" },
    { name: "Tax Filing Service", nameAr: "خدمة الإقرار الضريبي" },
    { name: "Legal Retainer (Monthly)", nameAr: "أتعاب قانونية شهرية" },
    { name: "Feasibility Study", nameAr: "دراسة جدوى" },
    { name: "Bookkeeping (Monthly)", nameAr: "مسك دفاتر (شهري)" },
    { name: "IT Advisory Session", nameAr: "جلسة استشارات تقنية" },
    { name: "Training Day (On-site)", nameAr: "يوم تدريبي (في الموقع)" },
  ],
  "industry.education": [
    { name: "Tuition — Primary (Term)", nameAr: "رسوم ابتدائي (فصل)" },
    { name: "Tuition — Secondary (Term)", nameAr: "رسوم ثانوي (فصل)" },
    { name: "Bus Service (Monthly)", nameAr: "خدمة النقل (شهري)" },
    { name: "Uniform Set", nameAr: "طقم زي مدرسي" },
    { name: "Textbooks Bundle", nameAr: "حزمة كتب دراسية" },
    { name: "Lab Fee (Annual)", nameAr: "رسوم معامل (سنوية)" },
    { name: "Activities Program", nameAr: "برنامج الأنشطة" },
    { name: "Registration Fee", nameAr: "رسوم التسجيل" },
  ],
  "industry.agriculture": [
    { name: "NPK Fertilizer 50kg", nameAr: "سماد NPK ٥٠ كجم" },
    { name: "Wheat Seeds 40kg", nameAr: "بذور قمح ٤٠ كجم" },
    { name: "Drip Line 200m", nameAr: "خط تنقيط ٢٠٠ م" },
    { name: "Date Palm Seedling", nameAr: "شتلة نخيل" },
    { name: "Pesticide 5L", nameAr: "مبيد حشري ٥ لتر" },
    { name: "Irrigation Filter", nameAr: "فلتر ري" },
    { name: "Greenhouse Cover 50m", nameAr: "غطاء بيت محمي ٥٠ م" },
    { name: "Organic Compost 30kg", nameAr: "سماد عضوي ٣٠ كجم" },
  ],
  "industry.wholesale": [
    { name: "LED Bulb 9W (Carton 50)", nameAr: "لمبة ليد ٩ واط (كرتون ٥٠)" },
    { name: "Extension Cord 5m", nameAr: "موصلة كهربائية ٥ م" },
    { name: "Power Strip 6-Socket", nameAr: "مشترك ٦ مخارج" },
    { name: "HDMI Cable 2m", nameAr: "كابل HDMI بطول ٢ م" },
    { name: "Phone Charger 20W", nameAr: "شاحن هاتف ٢٠ واط" },
    { name: "Wall Paint 18L", nameAr: "دهان جداري ١٨ لتر" },
    { name: "Ceramic Tile (m²)", nameAr: "بلاط سيراميك (م²)" },
    { name: "PVC Pipe 4in", nameAr: "أنبوب PVC ٤ بوصة" },
  ],
  "industry.electronics": [
    { name: "Smartphone 128GB", nameAr: "هاتف ذكي ١٢٨ جيجا" },
    { name: "Wireless Earbuds", nameAr: "سماعات لاسلكية" },
    { name: "Fast Charger 65W", nameAr: "شاحن سريع ٦٥ واط" },
    { name: "Phone Case (Clear)", nameAr: "غطاء هاتف شفاف" },
    { name: "Screen Protector", nameAr: "واقي شاشة" },
    { name: "Power Bank 20000mAh", nameAr: "بطارية متنقلة ٢٠٠٠٠" },
    { name: "Bluetooth Speaker", nameAr: "مكبر بلوتوث" },
    { name: "Smart Watch (Basic)", nameAr: "ساعة ذكية (أساسية)" },
  ],
  "industry.healthcare": [
    { name: "General Consultation", nameAr: "استشارة عامة" },
    { name: "Dental Cleaning", nameAr: "تنظيف أسنان" },
    { name: "Lab Panel (Basic)", nameAr: "تحاليل مخبرية (أساسية)" },
    { name: "X-Ray (Single)", nameAr: "أشعة سينية (موضع واحد)" },
    { name: "Physiotherapy Session", nameAr: "جلسة علاج طبيعي" },
    { name: "Vaccination Dose", nameAr: "جرعة تطعيم" },
    { name: "Dressing & Wound Care", nameAr: "تغيير ضماد وجروح" },
    { name: "Follow-up Visit", nameAr: "زيارة متابعة" },
  ],
  "industry.rental_logistics": [
    { name: "Pickup Day-Rate (3T)", nameAr: "يومية ونش ٣ طن" },
    { name: "Box Truck Day-Rate", nameAr: "يومية شاحنة صندوقية" },
    { name: "Forklift Day-Rate", nameAr: "يومية رافعة شوكية" },
    { name: "Warehouse Slot (Pallet/Mo)", nameAr: "مستودع (منصة/شهر)" },
    { name: "Manpower Hour (Mover)", nameAr: "ساعة عمال (نقل)" },
    { name: "Packing Service (Hour)", nameAr: "خدمة تغليف (ساعة)" },
    { name: "Last-Mile Delivery", nameAr: "توصيل الميل الأخير" },
    { name: "Cold Chain Transport (Day)", nameAr: "نقل مبرد (يوم)" },
  ],
};

@Injectable()
export class DemoDataService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OnboardingService) private readonly provisioning: OnboardingService,
    @Inject(TemplateApplyService) private readonly apply: TemplateApplyService,
    @Inject(PeriodService) private readonly periods: PeriodService,
    @Inject(BranchService) private readonly branches: BranchService,
    @Inject(WarehouseService) private readonly warehouses: WarehouseService,
    @Inject(AccountService) private readonly cashAccounts: AccountService,
    @Inject(ReceiptService) private readonly receipts: ReceiptService,
    @Inject(PartnerService) private readonly partners: PartnerService,
    @Inject(OpeningBalancesService) private readonly openingDrafts: OpeningBalancesService,
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(PriceListService) private readonly priceLists: PriceListService,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    @Inject(OpeningStockService) private readonly openingStock: OpeningStockService,
    @Inject(TaxCodesService) private readonly taxCodes: TaxCodesService,
  ) {}

  /** The 13 shipped templates + this tenant's seeded status. */
  async status(): Promise<unknown> {
    const tenant = await tenancyStore.getOwnTenant();
    const templates = await tenancyStore.listIndustryTemplates();
    return {
      tenant: {
        demoSeededAt: tenant.demoSeededAt ?? null,
        demoTemplate: tenant.demoTemplate ?? null,
      },
      templates: templates.map((row) => ({
        key: row.key,
        name: row.name,
        nameAr: row.nameAr,
        seeded: tenant.demoTemplate === row.key,
      })),
    };
  }

  /** The one-click loader (idempotent; refuses tenants with posted real docs). */
  async seed(actorId: string, templateKey: string): Promise<DemoSeedSummary> {
    const tenant = await tenancyStore.getOwnTenant();
    const templates = await tenancyStore.listIndustryTemplates();
    const template = templates.find((row) => row.key === templateKey);
    if (template === undefined) {
      throw new ImportKindUnknownError(`industry template ${templateKey}`);
    }
    if (tenant.demoSeededAt !== null && tenant.demoTemplate !== templateKey) {
      throw new DemoSeedRefusedError(
        `this tenant already carries demo data for ${tenant.demoTemplate} — a template switch is the apply engine's flow, not a re-seed`,
      );
    }
    if (tenant.demoSeededAt !== null) {
      // Idempotent re-run: a no-op with zero writes (the acceptance-7 shape —
      // zero duplicate rows; the first seed ran inside one all-or-nothing UoW,
      // so a failed seed leaves nothing behind to half-resume).
      return {
        templateKey,
        created: { partners: 0, items: 0, invoices: 0, receipts: 0, priceLists: 0, warehouses: 0, cashAccounts: 0 },
        skipped: { reason: "already-seeded" },
      };
    }
    {
      const journalCount = (await journalStore.listEntries({ limit: 1 })).rows.length;
      if (journalCount > 0) {
        throw new DemoSeedRefusedError(
          "this tenant carries posted real documents — demo seeding is for fresh tenants (the refusal is the guardrail)",
        );
      }
    }

    await ensureDemoActorUsers();
    const pack = ITEM_PACKS[templateKey] ?? ITEM_PACKS["industry.professional_services"]!;
    const base = await ownTenantBaseCurrency();
    const year = new Date().getUTCFullYear();
    const summary: DemoSeedSummary = {
      templateKey,
      created: { partners: 0, items: 0, invoices: 0, receipts: 0, priceLists: 0, warehouses: 0, cashAccounts: 0 },
      skipped: null,
    };

    // 1. The workspace substrate (idempotent — the onboarding diff).
    await this.provisioning.provision(DEMO_ACTOR, { industryTemplateKey: templateKey });
    // 2. The industry template (idempotent — same version + hash = no-op).
    await this.apply.apply(DEMO_ACTOR, { templateKey, mode: "initial" });
    // 3. The fiscal year (idempotent by name).
    await this.periods.createYear(DEMO_ACTOR, {
      name: `FY-${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });

    // 3b. Purpose completions the CoA template deliberately leaves unmapped
    //     (fail-closed by design — the sales-fixture pattern): the demo's
    //     posting legs need OPENING_EQUITY (+ the belt-and-braces set).
    const mapPurpose = async (purposeKey: string, code: string): Promise<void> => {
      if ((await findActivePurpose(purposeKey)) !== undefined) return;
      const account = await accountingStore.findAccountByCode(code);
      if (account === undefined) {
        throw new DemoSeedRefusedError(`CoA template account ${code} missing — provisioning integrity`);
      }
      await insertAccountPurpose({
        purposeKey,
        accountId: account.id,
        activeFrom: `${year}-01-01`,
      });
    };
    await mapPurpose("OPENING_EQUITY", "3100");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("COGS", "5100");
    await mapPurpose("VAT_PAYABLE", "2120");

    // 4. Branch + warehouse + cash account (idempotent per code).
    const branch =
      (await tenancyStore.findBranchByCode("MAIN")) ??
      (await this.branches.create(DEMO_ACTOR, {
        code: "MAIN",
        name: "Main Branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    const inventoryAccount = await accountingStore.findAccountByCode("1140");
    const warehouse =
      (await this.warehouses.list({ limit: 1 }))[0] ??
      (await this.warehouses.create({
        branchId: branch.id,
        code: "MAIN",
        name: "Main Warehouse",
        nameAr: "المستودع الرئيسي",
        inventoryAccountId: inventoryAccount?.id ?? null,
        note: null,
        actorId: DEMO_ACTOR,
      }));
    summary.created.warehouses += 1;
    const cashAccount =
      (await this.cashAccounts.list({}))[0] ??
      (await this.cashAccounts.open({
        name: "Main Cash",
        nameAr: "الصندوق الرئيسي",
        type: "CASH",
        accountId: (await accountingStore.findAccountByCode("1111"))!.id,
        branchId: branch.id,
        currencyCode: base,
        actorId: DEMO_ACTOR,
      }));
    summary.created.cashAccounts += 1;

    // 5. Items (idempotent per DEMO- sku).
    const uom = await itemsStore.findUomByCode("PCS");
    if (uom === undefined) {
      throw new DemoSeedRefusedError("the PCS unit seed is missing — run the workspace provisioning first");
    }
    const createdItems: { id: string; sku: string; price: string }[] = [];
    for (const [index, entry] of pack.entries()) {
      const sku = `DEMO-${String(index + 1).padStart(3, "0")}`;
      const price = (35 + index * 15).toFixed(2);
      const existing = await itemsStore.findItemBySku(sku);
      const item =
        existing ??
        (await this.items.create(DEMO_ACTOR, {
          sku,
          name: entry.name,
          nameAr: entry.nameAr,
          kind: "STOCK",
          uomId: uom.id,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: false,
          trackSerial: false,
          trackImei: false,
          hasExpiry: false,
          reorderLevel: null,
          reorderQty: null,
          basePrice: price,
        }));
      if (existing === undefined) {
        summary.created.items += 1;
      }
      createdItems.push({ id: item.id, sku, price });
    }

    // 6. Partners (idempotent per DEMO- code).
    const createdCustomers: string[] = [];
    for (const [index, entry] of CUSTOMERS.entries()) {
      const code = `DEMO-C-${String(index + 1).padStart(2, "0")}`;
      const existing = await partnersStore.findPartnerByCode(code);
      const partner =
        existing ??
        (await this.partners.create(DEMO_ACTOR, {
          kind: "CUSTOMER",
          code,
          name: entry.name,
          nameAr: entry.nameAr,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        }));
      if (existing === undefined) {
        summary.created.partners += 1;
      }
      createdCustomers.push(partner.id);
    }
    for (const [index, entry] of SUPPLIERS.entries()) {
      const code = `DEMO-S-${String(index + 1).padStart(2, "0")}`;
      const existing = await partnersStore.findPartnerByCode(code);
      if (existing === undefined) {
        await this.partners.create(DEMO_ACTOR, {
          kind: "SUPPLIER",
          code,
          name: entry.name,
          nameAr: entry.nameAr,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        });
        summary.created.partners += 1;
      }
    }

    // 7. The price list (idempotent by name).
    const listName = "Demo Price List";
    const existingList = (await this.priceLists.list(undefined)).find((row) => row.name === listName);
    const priceList =
      existingList ??
      (await this.priceLists.create(DEMO_ACTOR, {
        name: listName,
        nameAr: "قائمة الأسعار التجريبية",
        kind: "SALE",
        currencyCode: base,
        validFrom: null,
        validTo: null,
      }));
    if (existingList === undefined) {
      summary.created.priceLists += 1;
      for (const item of createdItems) {
        await this.priceLists.upsertRow(DEMO_ACTOR, priceList.id, {
          itemId: item.id,
          uomId: uom.id,
          unitPrice: item.price,
          minQty: "1",
        });
      }
    }

    // 8. Opening stock (idempotent: DRAFT docs only; the post is once per
    //    warehouse — the INV-013 source key makes a re-run a replay).
    const stockDrafts = await this.openingStock.listDrafts();
    if (stockDrafts.length === 0) {
      for (const item of createdItems) {
        await this.openingDrafts.create(DEMO_ACTOR, {
          kind: "STOCK",
          itemId: item.id,
          qty: "120",
          unitCost: (Number(item.price) * 0.6).toFixed(4),
          note: "Demo opening stock",
        });
      }
    }
    await this.openingStock.post({ warehouseId: warehouse.id, actorId: DEMO_ACTOR });

    // 9. Posted sales invoices through the engine (SoD: DEMO_APPROVER approves).
    const postedInvoiceIds: { id: string; amount: string; customerId: string }[] = [];
    const taxCodes = await this.taxCodes.list({});
    const neutralTax =
      taxCodes.find((row) => row.defaultTreatment === "NOT_SUBJECT") ?? null;
    for (let index = 0; index < 6; index += 1) {
      const customerId = createdCustomers[index % createdCustomers.length]!;
      const item = createdItems[index % createdItems.length]!;
      const month = String(1 + (index % 12)).padStart(2, "0");
      const invoiceDate = `${year}-${month}-${String(5 + (index % 20)).padStart(2, "0")}`;
      const qty = 2 + (index % 4);
      const gross = (Number(item.price) * qty).toFixed(4);
      const invoice = await this.invoices.create({
        branchId: branch.id,
        customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate,
        dueDate: null,
        currencyCode: base,
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: warehouse.id,
        cashAccountId: null,
        note: `Demo invoice ${index + 1}`,
        noteAr: `فاتورة تجريبية ${index + 1}`,
        actorId: DEMO_ACTOR,
        lines: [
          {
            itemId: item.id,
            accountId: null,
            deliveryLineId: null,
            description: `Demo line ${index + 1}`,
            descriptionAr: null,
            qty: String(qty),
            unitPrice: item.price,
            discountAmount: null,
            taxCodeId: neutralTax?.id ?? null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      });
      await this.invoices.submit(invoice.id, DEMO_ACTOR);
      await this.invoices.approve(invoice.id, DEMO_APPROVER, false);
      const posted = await this.invoices.post(invoice.id, DEMO_APPROVER);
      postedInvoiceIds.push({ id: posted.invoice.id, amount: gross, customerId });
      summary.created.invoices += 1;
    }

    // 10. Receipts against the first three invoices (three-step + SoD).
    for (const [index, invoice] of postedInvoiceIds.slice(0, 3).entries()) {
      const receiptDate = `${year}-${String(12 - (index % 10)).padStart(2, "0")}-20`;
      const receipt = await this.receipts.create({
        cashAccountId: cashAccount.id,
        partnerId: invoice.customerId,
        method: "CASH",
        payerName: null,
        currencyCode: base,
        amount: invoice.amount,
        exchangeRate: null,
        valueDate: receiptDate,
        reference: `DEMO-RCP-${index + 1}`,
        description: `Demo receipt ${index + 1}`,
        descriptionAr: `سند قبض تجريبي ${index + 1}`,
        actorId: DEMO_ACTOR,
      });
      await this.receipts.submit(receipt.id, DEMO_ACTOR);
      await this.receipts.approve(receipt.id, DEMO_APPROVER);
      await this.receipts.post(receipt.id, DEMO_APPROVER);
      summary.created.receipts += 1;
    }

    // 11. The tenant markers (idempotency + the status surface).
    await tenancyStore.stampDemoSeed(templateKey, `demo:${templateKey}:v1`);

    await this.audit.record({
      action: "onboarding.demo_data_seeded",
      entityType: "tenant",
      entityId: tenant.id,
      actorId,
      after: { template: templateKey, ...summary.created },
    });
    return summary;
  }
}
