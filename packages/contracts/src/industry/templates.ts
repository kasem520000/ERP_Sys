import type { IndustryTemplateManifest } from "./manifest";

/**
 * The thirteen shipped v1.0.0 templates — the three PHASE-015 priority ones
 * (transcribed VERBATIM from the normative template documents), the
 * two PHASE-017 industry templates (transcribed VERBATIM from the
 * migration 0025 registry seeds), the PHASE-018 manufacturing
 * template (transcribed VERBATIM from the migration 0026 registry seed),
 * the PHASE-019 professional-services template (transcribed VERBATIM
 * from the migration 0027 registry seed), the PHASE-032 education
 * template (transcribed VERBATIM from the migration 0039 registry seed),
 * the PHASE-033 agriculture template (transcribed VERBATIM from the
 * migration 0040 registry seed), the PHASE-030 wholesale + electronics
 * pair (transcribed VERBATIM from the migration 0044 registry seeds),
 * and the PHASE-031 healthcare commercial shell (transcribed VERBATIM
 * from the migration 0046 registry seed; the seeds are canonical; every
 * key, every Arabic string, every numbering rule):
 *
 *   - RETAIL_MANIFEST      docs/industries/templates/retail.md
 *   - GROCERY_MANIFEST     docs/industries/templates/grocery-supermarket.md
 *   - RESTAURANT_MANIFEST  docs/industries/templates/restaurant-cafe.md
 *   - AUTOMOTIVE_TEMPLATE_MANIFEST  apps/api/migrations/0025 (docs mirror:
 *     docs/industries/templates/manifests/manifest.automotive.json)
 *   - DISTRIBUTION_TEMPLATE_MANIFEST apps/api/migrations/0025 (docs mirror:
 *     docs/industries/templates/manifests/manifest.distribution.json)
 *   - FOOD_MANUFACTURING_TEMPLATE_MANIFEST apps/api/migrations/0026 (docs
 *     mirror: docs/industries/templates/manifests/manifest.food_manufacturing.json)
 *   - PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST apps/api/migrations/0027 (docs
 *     mirror: docs/industries/templates/manifests/manifest.professional_services.json)
 *   - EDUCATION_TEMPLATE_MANIFEST apps/api/migrations/0039 (docs mirror:
 *     docs/industries/templates/manifests/manifest.education.json — the
 *     §J doc reconciliation applied: partners.ar_aging pinned to the live
 *     ar.aging registry key)
 *   - AGRICULTURE_TEMPLATE_MANIFEST apps/api/migrations/0040 (docs mirror:
 *     docs/industries/templates/manifests/manifest.agriculture.json — the
 *     §J doc reconciliation applied: inventory.stock_valuation pinned to
 *     the live inventory.valuation registry key, the 0025/0039 precedent)
 *   - WHOLESALE_TEMPLATE_MANIFEST apps/api/migrations/0044 (docs mirror:
 *     docs/industries/templates/manifests/manifest.wholesale.json — the
 *     report pins reconciled to the LIVE registry keys ar.aging /
 *     inventory.valuation, the 0025/0027 convention)
 *   - ELECTRONICS_TEMPLATE_MANIFEST apps/api/migrations/0044 (docs mirror:
 *     docs/industries/templates/manifests/manifest.electronics.json — the
 *     valuation pin reconciled to inventory.valuation likewise)
 *   - HEALTHCARE_TEMPLATE_MANIFEST apps/api/migrations/0046 (docs mirror:
 *     docs/industries/templates/manifests/manifest.healthcare.json — the
 *     aging pin reconciled to the LIVE registry key ar.aging likewise;
 *     inventory.expiry_list / notes.aging / notes.maturity-calendar resolve
 *     verbatim)
 *
 * CI (scripts/validate-manifests.ts, wired into scripts/ci/local-gate.sh)
 * re-parses each constant against the §3 schema so contracts and docs cannot
 * drift (RISK-020). The constants are deep-frozen: registry manifests are
 * platform-owned, versioned documents — never edited in place (§5/§8).
 */

/** Deep-freeze a JSON-shaped value (records, arrays, and their children). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) {
        deepFreeze(item);
      }
    } else {
      for (const key of Object.keys(value)) {
        deepFreeze((value as Record<string, unknown>)[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

export const RETAIL_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.retail",
  name: "Retail Stores",
  name_ar: "متاجر التجزئة",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.multi_warehouse",
    "inventory.stock_transfers",
    "inventory.serial_tracking",
    "pos.terminals",
    "pos.sales",
    "pos.offline_queue",
    "pos.receipts",
    "treasury.cashier_shifts",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "pos",
    "configuration",
  ],
  terminology_overrides: {
    "pos.terminal": { en: "Terminal", ar: "الطرفية" },
    "doc.sales_invoice_pos": { en: "POS sale", ar: "بيع نقطة البيع" },
    "item.exchange": { en: "Exchange", ar: "الاستبدال" },
    "item.variant": { en: "Variant (size/color)", ar: "المقاس / اللون" },
    "item.tag_price": { en: "Tag price", ar: "السعر المعلن" },
    "promo.season_sale": { en: "Season sale", ar: "تخفيضات الموسم" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "selling",
        label: { en: "Selling", ar: "البيع" },
        order: 1,
        items: [
          {
            id: "pos",
            label: { en: "Point of sale", ar: "نقطة البيع" },
            target: "pos.counter",
            feature_key: "pos.sales",
          },
          {
            id: "returns",
            label: { en: "Returns & exchanges", ar: "المرتجعات والاستبدال" },
            target: "sales.credit_notes",
          },
          {
            id: "receipts",
            label: { en: "Receipts", ar: "سندات القبض" },
            target: "treasury.receipts",
          },
        ],
      },
      {
        id: "stock",
        label: { en: "Stock", ar: "المخزون" },
        order: 2,
        items: [
          {
            id: "transfers",
            label: { en: "Branch transfers", ar: "تحويلات الفروع" },
            target: "inventory.transfers",
          },
          {
            id: "imei",
            label: { en: "IMEI register", ar: "سجل الأجهزة" },
            target: "inventory.imei",
            feature_key: "inventory.serial_tracking",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    cash_sales_autopost: true,
    "pos.return_requires_original_invoice": true,
    exchange_same_value_only: false,
    shift_variance_approval_required: true,
    stock_transfer_in_transit_visible: true,
  },
  document_numbering_defaults: {
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    pos_sale: {
      prefix: "POS",
      format: "POS-{branch}-{yy}{MM}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    stock_transfer: {
      prefix: "TRF",
      format: "TRF-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "pos.sales_by_terminal",
      pinned: true,
      dashboard: true,
      default_period: "today",
    },
    {
      report_key: "pos.sales_by_hour",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "retail.imei_register",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    {
      report_key: "inventory.stock_valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
  ],
  onboarding_steps: [
    {
      id: "branch_warehouse",
      title: { en: "Create branch and stockroom", ar: "إنشاء الفرع والمستودع" },
      required: true,
    },
    {
      id: "coa_confirm",
      title: { en: "Confirm chart of accounts", ar: "تأكيد دليل الحسابات" },
      required: true,
    },
    {
      id: "categories",
      title: { en: "Item categories & tracking flags", ar: "تصنيفات الأصناف وخيارات التتبع" },
      required: true,
    },
    {
      id: "suppliers",
      title: { en: "Suppliers & opening stock", ar: "الموردون ورصيد المخزون الافتتاحي" },
      required: true,
    },
    {
      id: "terminals",
      title: { en: "Set up POS terminals", ar: "تهيئة أجهزة نقطة البيع" },
      required: true,
      feature_key: "pos.terminals",
    },
    {
      id: "first_shift",
      title: {
        en: "Open first shift and make a sale",
        ar: "افتتاح أول وردية وإجراء أول عملية بيع",
      },
      required: false,
      feature_key: "pos.sales",
    },
  ],
  capability_prerequisites: {
    barcode_pos: {
      level: "REQUIRED",
      feature_keys: ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "REQUIRED",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    imei_tracking: {
      level: "OPTIONAL",
      feature_keys: ["inventory.serial_tracking"],
      available_from_phase: "PHASE-010",
    },
    composite_kits: {
      level: "OPTIONAL",
      feature_keys: ["items.composite_products"],
      available_from_phase: "PHASE-016",
    },
    free_goods_promo: {
      level: "OPTIONAL",
      feature_keys: ["distribution.free_goods"],
      available_from_phase: "PHASE-017",
    },
    landed_costs: {
      level: "OPTIONAL",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
  },
});

export const GROCERY_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.grocery",
  name: "Grocery & Supermarket",
  name_ar: "البقالات والسوبرماركت",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "distribution.customer_tiers",
    "inventory.multi_warehouse",
    "inventory.batch_tracking",
    "inventory.stock_counts",
    "pos.terminals",
    "pos.sales",
    "pos.offline_queue",
    "pos.barcode_scanning",
    "pos.receipts",
    "treasury.cashier_shifts",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "pos",
    "configuration",
  ],
  terminology_overrides: {
    "item.scale_item": { en: "Scale item", ar: "صنف الميزان" },
    "batch.expiry": { en: "Expiry date", ar: "تاريخ الانتهاء" },
    "inventory.fefo": { en: "FEFO (nearest expiry first)", ar: "الأقرب انتهاءً يصدر أولاً" },
    "inventory.markdown": { en: "Near-expiry markdown", ar: "تخفيض قرب الانتهاء" },
    "inventory.writeoff": { en: "Write-off", ar: "الإعدام" },
    "item.shelf_life": { en: "Shelf life", ar: "مدة الصلاحية" },
    "purchasing.reorder": { en: "Reorder level", ar: "حد إعادة الطلب" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "selling",
        label: { en: "Selling", ar: "البيع" },
        order: 1,
        items: [
          {
            id: "pos",
            label: { en: "Point of sale", ar: "نقطة البيع" },
            target: "pos.counter",
            feature_key: "pos.sales",
          },
          {
            id: "tiers",
            label: { en: "Customer price tiers", ar: "فئات أسعار العملاء" },
            target: "items.tiers",
          },
        ],
      },
      {
        id: "expiry",
        label: { en: "Expiry control", ar: "الرقابة على الصلاحية" },
        order: 2,
        items: [
          {
            id: "expiry_list",
            label: { en: "Expiry list", ar: "قائمة الصلاحيات" },
            target: "inventory.expiry_list",
          },
          {
            id: "writeoff",
            label: { en: "Write-off register", ar: "سجل الإعدام" },
            target: "inventory.writeoff",
          },
          {
            id: "counts",
            label: { en: "Stock counts", ar: "جرد المخزون" },
            target: "inventory.counts",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    cash_sales_autopost: true,
    expiry_writeoff_requires_approval: true,
    markdown_requires_approval: false,
    batch_expiry_capture_required_on_grn: true,
    scale_item_weighed_lines: true,
    shift_variance_approval_required: true,
  },
  document_numbering_defaults: {
    pos_sale: {
      prefix: "POS",
      format: "POS-{branch}-{yy}{MM}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: true,
    default_track_expiry: true,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: true,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "inventory.expiry_list",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "grocery.expiry_writeoff",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "pos.sales_by_hour",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "inventory.stock_valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
  ],
  onboarding_steps: [
    {
      id: "branch_warehouse",
      title: {
        en: "Create branch, shop floor and backroom",
        ar: "إنشاء الفرع وصالة البيع والمستودع الخلفي",
      },
      required: true,
    },
    {
      id: "coa_confirm",
      title: { en: "Confirm chart of accounts", ar: "تأكيد دليل الحسابات" },
      required: true,
    },
    {
      id: "categories",
      title: {
        en: "Food categories with batch/expiry defaults",
        ar: "تصنيفات الأغذية مع خيارات الدفعة والصلاحية",
      },
      required: true,
    },
    {
      id: "scale_items",
      title: { en: "Set up scale items", ar: "تهيئة أصناف الميزان" },
      required: false,
      feature_key: "pos.barcode_scanning",
    },
    {
      id: "suppliers",
      title: {
        en: "Suppliers & opening stock with batches",
        ar: "الموردون والمخزون الافتتاحي مع الدفعات",
      },
      required: true,
    },
    {
      id: "tiers",
      title: { en: "Price tiers (retail / wholesale)", ar: "فئات الأسعار (تجزئة / جملة)" },
      required: false,
    },
    {
      id: "terminals",
      title: { en: "Set up POS terminals & scales", ar: "تهيئة أجهزة نقطة البيع والموازين" },
      required: true,
      feature_key: "pos.terminals",
    },
    {
      id: "first_count",
      title: {
        en: "Baseline count for expiry-sensitive stock",
        ar: "جرد أساسي للأصناف الحساسة للصلاحية",
      },
      required: true,
    },
  ],
  capability_prerequisites: {
    barcode_pos: {
      level: "REQUIRED",
      feature_keys: ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    scale_barcodes: {
      level: "REQUIRED",
      feature_keys: ["pos.barcode_scanning"],
      available_from_phase: "PHASE-016",
    },
    expiry_tracking_fefo: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    customer_price_tiers: {
      level: "REQUIRED",
      feature_keys: ["distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    cashier_shifts: {
      level: "REQUIRED",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    free_goods_promo: {
      level: "OPTIONAL",
      feature_keys: ["sales.discount_management", "distribution.free_goods"],
      available_from_phase: "PHASE-017",
    },
    composite_kits: {
      level: "OPTIONAL",
      feature_keys: ["items.composite_products"],
      available_from_phase: "PHASE-016",
    },
    qc_inspections: {
      level: "OPTIONAL",
      feature_keys: ["manufacturing.qc"],
      available_from_phase: "PHASE-018",
    },
  },
});

export const RESTAURANT_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.restaurant",
  name: "Restaurant & Café",
  name_ar: "المطاعم والمقاهي",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.multi_warehouse",
    "inventory.batch_tracking",
    "items.composite_products",
    "inventory.stock_counts",
    "pos.terminals",
    "pos.sales",
    "pos.offline_queue",
    "pos.table_service",
    "pos.receipts",
    "treasury.cashier_shifts",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "pos",
    "configuration",
  ],
  terminology_overrides: {
    "pos.table": { en: "Table", ar: "طاولة" },
    "pos.order": { en: "Order", ar: "طلب" },
    "pos.kitchen": { en: "Kitchen", ar: "المطبخ" },
    "pos.order_type": { en: "Order type", ar: "نوع الطلب" },
    "pos.dine_in": { en: "Dine-in", ar: "داخل المطعم" },
    "pos.takeaway": { en: "Takeaway", ar: "سفري" },
    "pos.delivery": { en: "Delivery", ar: "توصيل" },
    "pos.check": { en: "Guest check", ar: "الحساب" },
    "menu.combo": { en: "Combo / set meal", ar: "وجبة" },
    "menu.modifier": { en: "Modifier (extra)", ar: "إضافة" },
    "pos.z_close": { en: "Z close (day end)", ar: "الإغلاق اليومي" },
    "billing.service_charge": { en: "Service charge", ar: "رسوم الخدمة" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "floor",
        label: { en: "Floor", ar: "صالة المطعم" },
        order: 1,
        items: [
          {
            id: "tables",
            label: { en: "Tables", ar: "الطاولات" },
            target: "pos.floor",
            feature_key: "pos.table_service",
          },
          {
            id: "quick_sale",
            label: { en: "Quick sale", ar: "بيع سريع" },
            target: "pos.counter",
            feature_key: "pos.sales",
          },
          {
            id: "kitchen",
            label: { en: "Kitchen tickets", ar: "تذاكر المطبخ" },
            target: "pos.kitchen",
            feature_key: "pos.kitchen_display",
          },
        ],
      },
      {
        id: "day",
        label: { en: "Daily close", ar: "الإغلاق اليومي" },
        order: 2,
        items: [
          {
            id: "shifts",
            label: { en: "Shifts", ar: "الورديات" },
            target: "treasury.shifts",
          },
          {
            id: "z_close",
            label: { en: "Z close report", ar: "تقرير الإغلاق اليومي" },
            target: "pos.z_close",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    cash_sales_autopost: true,
    default_pos_order_type: "dine_in",
    unpaid_table_holds_no_ledger: true,
    combo_explosion_at_posting: true,
    service_charge_default_rate: 0,
    shift_variance_approval_required: true,
    daily_waste_count_recommended: true,
  },
  document_numbering_defaults: {
    pos_sale: {
      prefix: "RC",
      format: "RC-{branch}-{yy}{MM}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    },
    purchase_order: {
      prefix: "PO",
      format: "PO-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: true,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    stock_adjustment: {
      prefix: "ADJ",
      format: "ADJ-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: true,
    default_track_expiry: true,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: true,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "restaurant.sales_by_table",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "restaurant.order_type_mix",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "pos.sales_by_hour",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "treasury.shift_cash_reconciliation",
      pinned: true,
      dashboard: false,
      default_period: "today",
    },
    {
      report_key: "inventory.expiry_list",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
  ],
  onboarding_steps: [
    {
      id: "branch_floors",
      title: { en: "Branch, kitchen & floor layout", ar: "الفرع والمطبخ وتخطيط الصالة" },
      required: true,
    },
    {
      id: "coa_confirm",
      title: { en: "Confirm chart of accounts", ar: "تأكيد دليل الحسابات" },
      required: true,
    },
    {
      id: "menu",
      title: {
        en: "Build menu (items, combos, modifiers)",
        ar: "بناء قائمة الطعام (أصناف، وجبات، إضافات)",
      },
      required: true,
    },
    {
      id: "ingredients",
      title: { en: "Ingredient stock with expiry", ar: "مخزون المكونات مع الصلاحية" },
      required: true,
    },
    {
      id: "suppliers",
      title: { en: "Suppliers & opening stock", ar: "الموردون والمخزون الافتتاحي" },
      required: true,
    },
    {
      id: "terminals",
      title: { en: "Terminals & floor plan", ar: "تهيئة الأجهزة وخريطة الطاولات" },
      required: true,
      feature_key: "pos.table_service",
    },
    {
      id: "first_day",
      title: { en: "Run first service day and Z close", ar: "تشغيل أول يوم خدمة والإغلاق اليومي" },
      required: false,
      feature_key: "pos.sales",
    },
  ],
  capability_prerequisites: {
    table_service: {
      level: "REQUIRED",
      feature_keys: ["pos.table_service"],
      available_from_phase: "PHASE-016",
    },
    barcode_pos: {
      level: "REQUIRED",
      feature_keys: ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "REQUIRED",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    composite_kits: {
      level: "REQUIRED",
      feature_keys: ["items.composite_products"],
      available_from_phase: "PHASE-016",
    },
    expiry_tracking_fefo: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    kitchen_display: {
      level: "OPTIONAL",
      feature_keys: ["pos.kitchen_display"],
      available_from_phase: "PHASE-016",
    },
    bom_production: {
      level: "OPTIONAL",
      feature_keys: ["manufacturing.bom", "manufacturing.production_orders"],
      available_from_phase: "PHASE-018",
    },
    free_goods_promo: {
      level: "OPTIONAL",
      feature_keys: ["distribution.free_goods"],
      available_from_phase: "PHASE-017",
    },
  },
});

/**
 * Automotive & Workshop v1.0.0 (PHASE-017) — parts counter + repair workshop
 * on one core: every vehicle is a customer asset, every repair is a job card
 * (parts + labor). Transcribed VERBATIM from the migration 0025 registry seed
 * (`industry_templates` row `industry.automotive`) — the seed is canonical.
 */
export const AUTOMOTIVE_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.automotive",
  name: "Automotive & Workshop",
  name_ar: "قطع الغيار والورش",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.multi_warehouse",
    "inventory.serial_tracking",
    "inventory.reservations",
    "sales.quotations",
    "sales.job_cards",
    "sales.reps",
    "treasury.cashier_shifts",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "configuration",
  ],
  terminology_overrides: {
    "svc.job_card": { en: "Job card", ar: "بطاقة عمل" },
    "fleet.vehicle": { en: "Vehicle", ar: "المركبة" },
    "svc.labor": { en: "Labor", ar: "أجور العمل" },
    "vehicle.make": { en: "Make", ar: "الصانع" },
    "vehicle.model": { en: "Model", ar: "الطراز" },
    "vehicle.chassis_no": { en: "Chassis number (VIN)", ar: "رقم الهيكل" },
    "vehicle.odometer": { en: "Odometer", ar: "عداد المسافة" },
    "svc.diagnosis": { en: "Diagnosis", ar: "الفحص والتشخيص" },
    "svc.technician": { en: "Technician", ar: "الفني" },
    "svc.service_history": { en: "Service history", ar: "سجل الصيانة" },
    "part.warranty": { en: "Parts warranty", ar: "ضمان قطع الغيار" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "workshop",
        label: { en: "Workshop", ar: "الورشة" },
        order: 1,
        items: [
          {
            id: "job_cards",
            label: { en: "Job cards", ar: "بطاقات العمل" },
            target: "sales.job_cards",
          },
          {
            id: "vehicles",
            label: { en: "Vehicles", ar: "المركبات" },
            target: "partners.vehicles",
          },
          {
            id: "quotes",
            label: { en: "Diagnosis quotes", ar: "عروض التشخيص" },
            target: "sales.quotations",
          },
        ],
      },
      {
        id: "parts",
        label: { en: "Parts", ar: "قطع الغيار" },
        order: 2,
        items: [
          {
            id: "parts_stock",
            label: { en: "Parts stock", ar: "مخزون القطع" },
            target: "inventory.on_hand",
          },
          {
            id: "purchasing",
            label: { en: "Parts purchasing", ar: "شراء القطع" },
            target: "purchasing.orders",
          },
          {
            id: "counter",
            label: { en: "Counter sale", ar: "بيع الكاونتر" },
            target: "pos.counter",
            feature_key: "pos.sales",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    job_card_parts_issue_mode: "reserve",
    job_card_labor_rate_source: "price_list",
    quotation_validity_days: 7,
    invoice_approval_required_over: 0,
    warranty_credit_note_requires_original_invoice: true,
    shift_variance_approval_required: true,
  },
  document_numbering_defaults: {
    job_card: {
      prefix: "JC",
      format: "JC-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    },
    quotation: {
      prefix: "QT",
      format: "QT-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    purchase_order: {
      prefix: "PO",
      format: "PO-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: true,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "automotive.job_card_profitability",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "automotive.vehicle_service_history",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
    {
      report_key: "inventory.valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
    {
      report_key: "ar.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
  ],
  onboarding_steps: [
    {
      id: "branch_bays",
      title: { en: "Branch, workshop & bays", ar: "الفرع والورشة والمواقف" },
      required: true,
    },
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (parts vs labor revenue)",
        ar: "تأكيد دليل الحسابات (إيراد القطع مقابل أجور العمل)",
      },
      required: true,
    },
    {
      id: "labor_rates",
      title: { en: "Labor rate price lists", ar: "قوائم أسعار أجور العمل" },
      required: true,
    },
    {
      id: "parts_catalog",
      title: { en: "Parts catalog & suppliers", ar: "كتالوج القطع والموردون" },
      required: true,
    },
    {
      id: "opening_stock",
      title: { en: "Opening parts stock", ar: "رصيد القطع الافتتاحي" },
      required: true,
    },
    {
      id: "vehicles",
      title: { en: "Import customer vehicles", ar: "استيراد مركبات العملاء" },
      required: false,
    },
    {
      id: "first_job",
      title: { en: "Run a first job card end-to-end", ar: "تنفيذ أول بطاقة عمل كاملة" },
      required: false,
    },
  ],
  capability_prerequisites: {
    job_cards: {
      level: "REQUIRED",
      feature_keys: ["sales.job_cards"],
      available_from_phase: "PHASE-017",
    },
    commissions: {
      level: "OPTIONAL",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    barcode_pos: {
      level: "OPTIONAL",
      feature_keys: ["pos.terminals", "pos.sales", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    service_contracts: {
      level: "OPTIONAL",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    landed_costs: {
      level: "OPTIONAL",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
    qc_inspections: {
      level: "OPTIONAL",
      feature_keys: ["manufacturing.qc"],
      available_from_phase: "PHASE-018",
    },
  },
});

/**
 * Distribution & Field Sales v1.0.0 (PHASE-017) — van sales: stock on
 * wheels, planned routes, rep accountability, and the hard day-end rep
 * settlement. Transcribed VERBATIM from the migration 0025 registry seed
 * (`industry_templates` row `industry.distribution`) — the seed is canonical.
 */
export const DISTRIBUTION_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.distribution",
  name: "Distribution & Field Sales",
  name_ar: "التوزيع والمبيعات الميدانية",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "distribution.routes",
    "distribution.van_stock",
    "distribution.settlements",
    "treasury.receipts_disbursements",
    "distribution.customer_tiers",
    "sales.discount_management",
    "sales.reps",
    "sales.commissions",
    "inventory.multi_warehouse",
    "inventory.stock_transfers",
    "inventory.batch_tracking",
    "treasury.cashier_shifts",
    "inventory.wms",
    "inventory.putaway",
    "inventory.picking",
    "inventory.cycle_counts",
    "inventory.abc",
    "inventory.serial_ledger",
    "inventory.quarantine",
    "inventory.consignment",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "distribution",
    "configuration",
  ],
  terminology_overrides: {
    "route.route": { en: "Route", ar: "خط السير" },
    "route.visit": { en: "Visit", ar: "الزيارة" },
    "van.van_stock": { en: "Van stock", ar: "مخزون السيارة" },
    "van.load_out": { en: "Load-out", ar: "التحميل الصباحي" },
    "van.unload": { en: "Evening unload", ar: "التنزيل المسائي" },
    "settlement.rep_settlement": { en: "Rep settlement", ar: "تسوية المندوب" },
    "settlement.variance": { en: "Cash variance", ar: "فرق الصندوق" },
    "billing.collection": { en: "Collection", ar: "التحصيل" },
    "price.tier": { en: "Customer tier", ar: "فئة العميل" },
    "promo.free_goods": { en: "Free goods", ar: "بضاعة مجانية" },
    "hr.field_rep": { en: "Sales rep (van)", ar: "مندوب التوزيع" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "field",
        label: { en: "Field operations", ar: "العمليات الميدانية" },
        order: 1,
        items: [
          {
            id: "routes",
            label: { en: "Routes & visits", ar: "خطوط السير والزيارات" },
            target: "distribution.routes",
          },
          {
            id: "van_stock",
            label: { en: "Van stock", ar: "مخزون السيارة" },
            target: "distribution.van_stock",
          },
          {
            id: "collections",
            label: { en: "Collections", ar: "التحصيل" },
            target: "distribution.collections",
          },
        ],
      },
      {
        id: "settle",
        label: { en: "Settlements", ar: "التسويات" },
        order: 2,
        items: [
          {
            id: "rep_settlements",
            label: { en: "Rep settlements", ar: "تسويات المندوبين" },
            target: "distribution.settlements",
          },
          {
            id: "commissions",
            label: { en: "Commissions", ar: "العمولات" },
            target: "sales.commissions",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    van_loadout_requires_transfer: true,
    settlement_required_daily: true,
    settlement_variance_approval_required: true,
    collection_receipt_at_visit: true,
    tier_price_automatic_by_partner: true,
    credit_sale_credit_limit_enforced: true,
    free_goods_require_reason_code: true,
  },
  document_numbering_defaults: {
    stock_transfer: {
      prefix: "LOD",
      format: "LOD-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    receipt: {
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    settlement: {
      prefix: "STL",
      format: "STL-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: true,
    default_track_expiry: true,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: true,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "distribution.rep_settlement",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "distribution.van_stock_balances",
      pinned: true,
      dashboard: true,
      default_period: "today",
    },
    {
      report_key: "distribution.route_visit_compliance",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "sales.discount_management_effectiveness",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    {
      report_key: "sales.commissions_due",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
  ],
  onboarding_steps: [
    {
      id: "main_warehouse",
      title: { en: "Main warehouse & van fleet", ar: "المستودع الرئيسي وأسطول السيارات" },
      required: true,
    },
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (rep cash account)",
        ar: "تأكيد دليل الحسابات (حساب نقديات المندوب)",
      },
      required: true,
    },
    {
      id: "reps_vans",
      title: {
        en: "Create reps, vans & assign routes",
        ar: "إنشاء المندوبين والسيارات وإسناد خطوط السير",
      },
      required: true,
    },
    {
      id: "tiers",
      title: { en: "Customer tiers & price lists", ar: "فئات العملاء وقوائم الأسعار" },
      required: true,
    },
    {
      id: "customers",
      title: { en: "Route customers with credit terms", ar: "عملاء الخطوط وشروط الدفع" },
      required: true,
    },
    {
      id: "opening_stock",
      title: { en: "Opening stock with batches", ar: "المخزون الافتتاحي مع الدفعات" },
      required: true,
    },
    {
      id: "first_day",
      title: {
        en: "Run first load-out → visits → settlement",
        ar: "تنفيذ أول يوم: تحميل، زيارات، تسوية",
      },
      required: false,
    },
  ],
  capability_prerequisites: {
    van_stock: {
      level: "REQUIRED",
      feature_keys: ["distribution.van_stock"],
      available_from_phase: "PHASE-017",
    },
    route_planning: {
      level: "REQUIRED",
      feature_keys: ["distribution.routes"],
      available_from_phase: "PHASE-017",
    },
    field_collections: {
      level: "REQUIRED",
      feature_keys: ["treasury.receipts_disbursements"],
      available_from_phase: "PHASE-017",
    },
    customer_price_tiers: {
      level: "REQUIRED",
      feature_keys: ["distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    free_goods_promo: {
      level: "REQUIRED",
      feature_keys: ["sales.discount_management", "distribution.free_goods"],
      available_from_phase: "PHASE-017",
    },
    commissions: {
      level: "REQUIRED",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    cashier_shifts: {
      level: "REQUIRED",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    expiry_tracking_fefo: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    landed_costs: {
      level: "OPTIONAL",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
  },
});

/**
 * Food Manufacturing v1.0.0 (PHASE-018) — recipes (BOMs) with yield, batch
 * production orders with QC quarantine + genealogy, and expiry-controlled
 * finished goods: every batch is traceable upstream to its materials and
 * downstream to its sales. Transcribed VERBATIM from the migration 0026
 * registry seed (`industry_templates` row `industry.food_manufacturing`;
 * the canonical source is
 * docs/industries/templates/manifests/manifest.food_manufacturing.json).
 */
export const FOOD_MANUFACTURING_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.food_manufacturing",
  name: "Food Manufacturing",
  name_ar: "التصنيع الغذائي",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "manufacturing.bom",
    "manufacturing.production_orders",
    "manufacturing.qc",
    "manufacturing.batch_genealogy",
    // PHASE-042 (0066 §9): the manufacturing-execution set — the
    // manufacturing-bearing template requires the routing/work-center/
    // shop-floor keys by default (CR-36 (f) template-composable grants).
    "manufacturing.routing",
    "manufacturing.work_centers",
    "manufacturing.shopfloor",
    "manufacturing.rework",
    "manufacturing.downtime",
    "manufacturing.standard_costs",
    "inventory.multi_warehouse",
    "inventory.batch_tracking",
    "inventory.stock_counts",
    "items.price_lists",
    "purchasing.landed_costs",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "manufacturing",
    "configuration",
  ],
  terminology_overrides: {
    "mfg.recipe": { en: "Recipe (BOM)", ar: "الوصفة (قائمة المواد)" },
    "mfg.production_order": { en: "Production order", ar: "أمر الإنتاج" },
    "mfg.yield": { en: "Yield", ar: "المردود" },
    "mfg.scrap": { en: "Scrap", ar: "الهالك" },
    "mfg.qc_gate": { en: "QC gate", ar: "بوابة فحص الجودة" },
    "mfg.batch_genealogy": { en: "Batch genealogy", ar: "شجرة الدفعات" },
    "mfg.semi_finished": { en: "Semi-finished", ar: "نصف مصنّع" },
    "item.shelf_life": { en: "Shelf life (days)", ar: "مدة الصلاحية (أيام)" },
    "mfg.production_line": { en: "Production line", ar: "خط الإنتاج" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "production",
        label: { en: "Production", ar: "الإنتاج" },
        order: 1,
        items: [
          {
            id: "recipes",
            label: { en: "Recipes (BOM)", ar: "الوصفات (قائمة المواد)" },
            target: "manufacturing.bom",
          },
          {
            id: "orders",
            label: { en: "Production orders", ar: "أوامر الإنتاج" },
            target: "manufacturing.orders",
          },
          {
            id: "qc",
            label: { en: "QC inspections", ar: "فحوصات الجودة" },
            target: "manufacturing.qc",
          },
        ],
      },
      {
        id: "trace",
        label: { en: "Traceability", ar: "التتبع" },
        order: 2,
        items: [
          {
            id: "genealogy",
            label: { en: "Batch genealogy", ar: "شجرة الدفعات" },
            target: "manufacturing.genealogy",
          },
          {
            id: "expiry",
            label: { en: "Expiry control", ar: "الرقابة على الصلاحية" },
            target: "inventory.expiry_list",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    production_qc_gate: "required",
    fg_batch_expiry_from_shelf_life: true,
    scrap_reason_required: true,
    consumption_variance_threshold_pct: 5,
    expiry_writeoff_requires_approval: true,
    markdown_requires_approval: false,
  },
  document_numbering_defaults: {
    production_order: {
      prefix: "PRD",
      format: "PRD-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: true,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    delivery_note: {
      prefix: "DLV",
      format: "DLV-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    stock_adjustment: {
      prefix: "ADJ",
      format: "ADJ-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: true,
    default_track_expiry: true,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: true,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "manufacturing.production_cost",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "manufacturing.batch_genealogy",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
    {
      report_key: "manufacturing.qc_inspection_log",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    {
      report_key: "inventory.expiry_list",
      pinned: true,
      dashboard: true,
      default_period: "this_week",
    },
    {
      report_key: "grocery.expiry_writeoff",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
  ],
  onboarding_steps: [
    {
      id: "warehouses",
      title: {
        en: "Raw materials, WIP and finished-goods warehouses",
        ar: "مستودعات المواد الخام والتشغيل والإنتاج التام",
      },
      required: true,
    },
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (WIP, scrap accounts)",
        ar: "تأكيد دليل الحسابات (حسابات تحت التشغيل والهالك)",
      },
      required: true,
    },
    {
      id: "recipes",
      title: { en: "Recipes with yield", ar: "الوصفات مع المردود" },
      required: true,
    },
    {
      id: "materials",
      title: { en: "Materials with batches & suppliers", ar: "المواد مع الدفعات والموردون" },
      required: true,
    },
    {
      id: "fg_shelf_life",
      title: { en: "Finished goods & shelf-life defaults", ar: "المنتجات التامة ومدد الصلاحية" },
      required: true,
    },
    {
      id: "first_run",
      title: { en: "Run first production order end-to-end", ar: "تنفيذ أول أمر إنتاج كامل" },
      required: false,
    },
    {
      id: "outlet",
      title: { en: "Optional factory outlet counter", ar: "كاونتر منفذ بيع المصنع (اختياري)" },
      required: false,
      feature_key: "pos.sales",
    },
  ],
  capability_prerequisites: {
    bom_production: {
      level: "REQUIRED",
      feature_keys: ["manufacturing.bom", "manufacturing.production_orders"],
      available_from_phase: "PHASE-018",
    },
    qc_inspections: {
      level: "REQUIRED",
      feature_keys: ["manufacturing.qc"],
      available_from_phase: "PHASE-018",
    },
    batch_genealogy: {
      level: "REQUIRED",
      feature_keys: ["manufacturing.batch_genealogy"],
      available_from_phase: "PHASE-018",
    },
    expiry_tracking_fefo: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    landed_costs: {
      level: "REQUIRED",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
    barcode_pos: {
      level: "OPTIONAL",
      feature_keys: ["pos.terminals", "pos.sales", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "OPTIONAL",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    customer_price_tiers: {
      level: "OPTIONAL",
      feature_keys: ["distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
  },
});

/**
 * Professional Services v1.0.0 (PHASE-019) — service contracts with
 * retainer/milestone/hourly fee models, recurring billing runs over the
 * expanded schedule grid, and the projects (cases) dimension: practice
 * management for law, accounting, and consulting offices. Transcribed
 * VERBATIM from the migration 0027 registry seed (`industry_templates` row
 * `industry.professional_services`; the canonical source is
 * docs/industries/templates/manifests/manifest.professional_services.json —
 * the §12 doc reconciliation applied there: the bom_production N/A entry
 * dropped, the ar_aging pin reconciled to the live `ar.aging` registry key).
 */
export const PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.professional_services",
  name: "Professional Services",
  name_ar: "المكاتب المهنية",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.item_master",
    "crm.service_contracts",
    "crm.recurring_billing",
    "accounting.projects",
    "sales.invoices",
    "partners.statements",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "sales",
    "treasury",
    "tax",
    "reporting",
    "crm",
    "configuration",
  ],
  terminology_overrides: {
    "svc.case": { en: "Case / Matter", ar: "القضية / الملف" },
    "svc.time_entry": { en: "Time entry", ar: "تسجيل الوقت" },
    "svc.timesheet": { en: "Timesheet", ar: "كشف الساعات" },
    "svc.billable": { en: "Billable", ar: "قابل للفوترة" },
    "fee.fixed_fee": { en: "Fixed fee", ar: "أتعاب مقطوعة" },
    "fee.hourly": { en: "Hourly fee", ar: "أتعاب بالساعة" },
    "fee.retainer": { en: "Retainer", ar: "أتعاب دورية" },
    "billing.milestone": { en: "Milestone", ar: "دفعة مرحلية" },
    "doc.contract": { en: "Service contract", ar: "عقد الخدمات" },
    "acc.project": { en: "Project", ar: "المشروع" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "practice",
        label: { en: "Practice", ar: "المكتب" },
        order: 1,
        items: [
          {
            id: "cases",
            label: { en: "Cases / Projects", ar: "القضايا / المشاريع" },
            target: "accounting.projects",
          },
          {
            id: "timesheets",
            label: { en: "Time & timesheets", ar: "الوقت وكشوف الساعات" },
            target: "crm.time",
          },
          {
            id: "contracts",
            label: { en: "Service contracts", ar: "عقود الخدمات" },
            target: "crm.contracts",
          },
        ],
      },
      {
        id: "billing",
        label: { en: "Billing", ar: "الفوترة" },
        order: 2,
        items: [
          {
            id: "recurring",
            label: { en: "Recurring invoices", ar: "الفواتير الدورية" },
            target: "crm.recurring_billing",
          },
          {
            id: "invoices",
            label: { en: "Invoices", ar: "الفواتير" },
            target: "sales.invoices",
          },
          {
            id: "statements",
            label: { en: "Client statements", ar: "كشوف حسابات العملاء" },
            target: "partners.statements",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    contract_billing_mode: "retainer_or_milestones",
    time_entries_require_case: true,
    unbilled_time_review_before_invoice: true,
    invoice_approval_required: true,
    invoice_numbering_per_series: false,
    narrative_required_on_time_billing: true,
  },
  document_numbering_defaults: {
    contract_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    receipt: {
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "services.contract_revenue_schedule",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "services.time_billing_summary",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "ar.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    {
      report_key: "sales.commissions_due",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
  ],
  onboarding_steps: [
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (fee revenue natures)",
        ar: "تأكيد دليل الحسابات (طبيعة إيرادات الأتعاب)",
      },
      required: true,
    },
    {
      id: "clients",
      title: {
        en: "Clients & engagement contacts",
        ar: "العملاء وجهات التعامل",
      },
      required: true,
    },
    {
      id: "fee_items",
      title: {
        en: "Fee items (hourly, fixed, disbursements)",
        ar: "بنود الأتعاب (بالساعة، مقطوعة، مصروفات نائبة)",
      },
      required: true,
    },
    {
      id: "first_contract",
      title: {
        en: "First service contract",
        ar: "أول عقد خدمات",
      },
      required: true,
    },
    {
      id: "billing_run",
      title: {
        en: "Run first recurring billing cycle",
        ar: "تشغيل أول دورة فوترة دورية",
      },
      required: false,
    },
    {
      id: "projects",
      title: {
        en: "Open projects/cases",
        ar: "فتح المشاريع/القضايا",
      },
      required: false,
    },
  ],
  capability_prerequisites: {
    service_contracts: {
      level: "REQUIRED",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    recurring_billing: {
      level: "REQUIRED",
      feature_keys: ["crm.recurring_billing"],
      available_from_phase: "PHASE-019",
    },
    deposits_late_fees: {
      level: "OPTIONAL",
      feature_keys: ["crm.contract_deposits", "crm.late_fees"],
      available_from_phase: "PHASE-019",
    },
    commissions: {
      level: "OPTIONAL",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    job_cards: {
      level: "OPTIONAL",
      feature_keys: ["sales.job_cards"],
      available_from_phase: "PHASE-017",
    },
  },
});

/**
 * The PHASE-032 education commercial shell (ED-08) — transcribed VERBATIM
 * from the migration 0039 registry seed (docs mirror:
 * docs/industries/templates/manifests/manifest.education.json, the §J
 * reconciliation applied: the doc draft's partners.ar_aging planning id is
 * pinned to the live ar.aging registry key — the 0025/0027 precedent).
 *
 * Configuration only (PHASE-032 §4): the guardian is the paying partner,
 * the student a partner financial file (never academic data — ED-11), the
 * enrollment year a crm.service_contracts schedule source, tuition invoices
 * ordinary sales documents with sibling line discounts, and the tuition
 * calendar the PHASE-027 installments backbone (installments.plans/
 * collections/late_fees). No new tables, modules, feature keys, or
 * permissions ship with the template.
 */
export const EDUCATION_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.education",
  name: "Education (Commercial Shell)",
  name_ar: "التعليم — الغلاف التجاري",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.item_master",
    "items.price_lists",
    "partners.directory",
    "partners.statements",
    "crm.service_contracts",
    "sales.invoices",
    "treasury.receipts_disbursements",
    "installments.plans",
    "installments.collections",
    "installments.late_fees",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "sales",
    "treasury",
    "tax",
    "reporting",
    "crm",
    "installments",
    "configuration",
  ],
  terminology_overrides: {
    "partner.student": { en: "Student (financial file)", ar: "الطالب (الملف المالي)" },
    "partner.guardian": { en: "Guardian (payer)", ar: "ولي الأمر (الدافع)" },
    "fee.tuition": { en: "Tuition fees", ar: "الرسوم الدراسية" },
    "fee.schedule": { en: "Fee schedule (program/grade)", ar: "جدول الرسوم (البرنامج / الصف)" },
    "doc.enrollment_contract": { en: "Enrollment contract", ar: "عقد الالتحاق" },
    "billing.installment": { en: "Installment", ar: "القسط" },
    "billing.installment_plan": { en: "Installment plan", ar: "خطة الأقساط" },
    "billing.down_payment": { en: "Down payment", ar: "الدفعة المقدمة" },
    "fee.late": { en: "Late fee", ar: "رسوم التأخير" },
    "discount.siblings": { en: "Sibling discount", ar: "خصم الأشقاء" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "enrollment",
        label: { en: "Enrollment", ar: "الالتحاق" },
        order: 1,
        items: [
          {
            id: "contracts",
            label: { en: "Enrollment contracts", ar: "عقود الالتحاق" },
            target: "crm.contracts",
            feature_key: "crm.service_contracts",
          },
          {
            id: "students",
            label: { en: "Students & guardians", ar: "الطلاب وأولياء الأمور" },
            target: "partners.directory",
          },
          {
            id: "fee_lists",
            label: { en: "Fee schedules", ar: "جداول الرسوم" },
            target: "items.price_lists",
          },
        ],
      },
      {
        id: "billing",
        label: { en: "Tuition billing", ar: "فوترة الرسوم" },
        order: 2,
        items: [
          {
            id: "plans",
            label: { en: "Installment plans", ar: "خطط الأقساط" },
            target: "installments.plans",
            feature_key: "installments.plans",
          },
          {
            id: "invoices",
            label: { en: "Tuition invoices", ar: "فواتير الرسوم" },
            target: "sales.invoices",
          },
          {
            id: "due_list",
            label: { en: "Due & overdue installments", ar: "الأقساط المستحقة والمتأخرة" },
            target: "installments.collections",
            feature_key: "installments.collections",
          },
          {
            id: "receipts",
            label: { en: "Receipts", ar: "سندات القبض" },
            target: "treasury.receipts",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    guardian_is_paying_partner: true,
    tuition_invoice_from_contract: true,
    installment_schedule_immutable_after_activation: true,
    late_fee_policy_per_plan: true,
    sibling_discount_line_level: true,
    dunning_cycle_before_late_fee: true,
    invoice_approval_required: true,
  },
  document_numbering_defaults: {
    contract_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    receipt: {
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "installments.schedule",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "installments.aging",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "services.contract_revenue_schedule",
      pinned: true,
      dashboard: false,
      default_period: "this_year",
    },
    {
      report_key: "ar.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
  ],
  onboarding_steps: [
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (tuition revenue, late-fee income)",
        ar: "تأكيد دليل الحسابات (إيراد الرسوم، إيراد رسوم التأخير)",
      },
      required: true,
    },
    {
      id: "programs",
      title: {
        en: "Programs/grades + fee schedule price lists",
        ar: "البرامج والصفوف + جداول الرسوم",
      },
      required: true,
    },
    {
      id: "guardians",
      title: {
        en: "Guardian partners & student financial files",
        ar: "أولياء الأمور والملفات المالية للطلاب",
      },
      required: true,
    },
    {
      id: "first_contract",
      title: {
        en: "First enrollment contract",
        ar: "أول عقد التحاق",
      },
      required: true,
    },
    {
      id: "first_plan",
      title: {
        en: "First tuition invoice + installment plan",
        ar: "أول فاتورة رسوم وخطة أقساط",
      },
      required: true,
    },
    {
      id: "first_collection",
      title: {
        en: "Collect a due installment (apply late fee)",
        ar: "تحصيل قسط مستحق (مع رسوم تأخير)",
      },
      required: false,
    },
  ],
  capability_prerequisites: {
    installment_terms: {
      level: "REQUIRED",
      feature_keys: ["installments.plans", "installments.collections", "installments.late_fees"],
      available_from_phase: "PHASE-027",
    },
    service_contracts: {
      level: "REQUIRED",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    recurring_billing: {
      level: "OPTIONAL",
      feature_keys: ["crm.recurring_billing"],
      available_from_phase: "PHASE-019",
    },
    deposits_late_fees: {
      level: "OPTIONAL",
      feature_keys: ["crm.contract_deposits", "crm.late_fees"],
      available_from_phase: "PHASE-019",
    },
    customer_price_tiers: {
      level: "OPTIONAL",
      feature_keys: ["items.price_lists", "distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    pdc_notes: {
      level: "OPTIONAL",
      feature_keys: ["notes.received"],
      available_from_phase: "PHASE-027",
    },
    cashier_shifts: {
      level: "OPTIONAL",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
  },
});

/**
 * The PHASE-033 agriculture commercial shell (ED-09) — transcribed VERBATIM
 * from the migration 0040 registry seed (docs mirror:
 * docs/industries/templates/manifests/manifest.agriculture.json, the §J
 * reconciliation applied: the doc draft's inventory.stock_valuation
 * planning id is pinned to the live inventory.valuation registry key —
 * the 0025/0039 precedent).
 *
 * Configuration only (PHASE-033 §4): the crop cycle is a BOM recipe run as
 * a production order costed to the field project (accounting.projects +
 * cost centers), the harvest lands as a batch at production cost (then WAC
 * onward), livestock are serial-tracked items at head level, inputs are
 * ordinary purchases, and produce sells from harvest batches (FEFO) — all
 * riding the manufacturing/trading goldens (G-07/G-08, the G-17 chain,
 * G-18, G-01/G-02/G-03). No new tables, modules, feature keys, or
 * permissions ship with the template.
 */
export const AGRICULTURE_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.agriculture",
  name: "Agriculture (Commercial Shell)",
  name_ar: "الزراعة — الغلاف التجاري",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "manufacturing.bom",
    "manufacturing.production_orders",
    "inventory.batch_tracking",
    "purchasing.orders",
    "purchasing.goods_receipts",
    "sales.invoices",
    "accounting.projects",
    "accounting.cost_centers",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "manufacturing",
    "configuration",
  ],
  terminology_overrides: {
    "crop.item": { en: "Crop", ar: "المحصول" },
    "crop.cycle": { en: "Crop cycle", ar: "الدورة الزراعية" },
    "mfg.recipe": { en: "Crop-cycle recipe (BOM)", ar: "وصفة الدورة الزراعية (قائمة المواد)" },
    "mfg.production_order": { en: "Cycle run order", ar: "أمر تنفيذ الدورة" },
    "harvest.batch": { en: "Harvest batch", ar: "دفعة الحصاد" },
    "farm.field": { en: "Farm / Field", ar: "المزرعة / الحقل" },
    "livestock.head": { en: "Livestock head", ar: "رأس" },
    "input.seeds": { en: "Seeds & inputs", ar: "البذور والمدخلات" },
    "input.feed": { en: "Feed", ar: "الأعلاف" },
    "mfg.yield": { en: "Yield", ar: "المردود" },
    "mfg.scrap": { en: "Crop loss", ar: "الفاقد" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "season",
        label: { en: "Season", ar: "الموسم" },
        order: 1,
        items: [
          {
            id: "fields",
            label: { en: "Fields & projects", ar: "الحقول والمشاريع" },
            target: "accounting.projects",
          },
          {
            id: "recipes",
            label: { en: "Crop-cycle recipes (BOM)", ar: "وصفات الدورات (قائمة المواد)" },
            target: "manufacturing.bom",
            feature_key: "manufacturing.bom",
          },
          {
            id: "cycles",
            label: { en: "Cycle run orders", ar: "أوامر تنفيذ الدورات" },
            target: "manufacturing.orders",
            feature_key: "manufacturing.production_orders",
          },
        ],
      },
      {
        id: "harvest",
        label: { en: "Harvest & trade", ar: "الحصاد والتجارة" },
        order: 2,
        items: [
          {
            id: "batches",
            label: { en: "Harvest batches", ar: "دفعات الحصاد" },
            target: "inventory.batches",
            feature_key: "inventory.batch_tracking",
          },
          {
            id: "sales",
            label: { en: "Produce sales", ar: "مبيعات المحاصيل" },
            target: "sales.invoices",
          },
          {
            id: "livestock",
            label: { en: "Livestock register", ar: "سجل الثروة الحيوانية" },
            target: "inventory.serials",
            feature_key: "inventory.serial_tracking",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    cycle_order_per_field_project: true,
    harvest_batch_genealogy_enabled: true,
    field_cost_center_mandatory_on_cycle: true,
    scrap_reason_required: true,
    consumption_variance_threshold_pct: 5,
    livestock_serial_per_head: true,
  },
  document_numbering_defaults: {
    production_order: {
      prefix: "CYC",
      format: "CYC-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: true,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    delivery_note: {
      prefix: "DLV",
      format: "DLV-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    stock_transfer: {
      prefix: "TRF",
      format: "TRF-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: true,
    default_track_expiry: true,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: true,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "manufacturing.production_cost",
      pinned: true,
      dashboard: true,
      default_period: "this_year",
    },
    {
      report_key: "inventory.valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
    {
      report_key: "inventory.expiry_list",
      pinned: true,
      dashboard: false,
      default_period: "this_week",
    },
    {
      report_key: "manufacturing.batch_genealogy",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
  ],
  onboarding_steps: [
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (WIP, crop loss, biological assets)",
        ar: "تأكيد دليل الحسابات (تحت التشغيل، الفاقد، الأصول الحيوية)",
      },
      required: true,
    },
    {
      id: "fields",
      title: {
        en: "Fields as projects + cost centers",
        ar: "الحقول كمشاريع ومراكز تكلفة",
      },
      required: true,
    },
    {
      id: "recipes",
      title: {
        en: "Crop-cycle recipes per crop",
        ar: "وصفات الدورات لكل محصول",
      },
      required: true,
    },
    {
      id: "inputs",
      title: {
        en: "Seeds/feed/inputs with batches",
        ar: "البذور والأعلاف والمدخلات مع الدفعات",
      },
      required: true,
    },
    {
      id: "livestock",
      title: {
        en: "Livestock items with head-level serials",
        ar: "أصناف الثروة الحيوانية بتسجيل رأس برأس",
      },
      required: false,
      feature_key: "inventory.serial_tracking",
    },
    {
      id: "first_cycle",
      title: {
        en: "Run first cycle: order → harvest intake → sale",
        ar: "تنفيذ أول دورة: أمر، حصاد، بيع",
      },
      required: false,
    },
  ],
  capability_prerequisites: {
    crop_cycle_costing: {
      level: "REQUIRED",
      feature_keys: ["manufacturing.bom", "manufacturing.production_orders", "accounting.projects"],
      available_from_phase: "PHASE-033",
    },
    harvest_batches: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking", "manufacturing.batch_genealogy"],
      available_from_phase: "PHASE-018",
    },
    bom_production: {
      level: "REQUIRED",
      feature_keys: ["manufacturing.bom", "manufacturing.production_orders"],
      available_from_phase: "PHASE-018",
    },
    expiry_tracking_fefo: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    batch_genealogy: {
      level: "OPTIONAL",
      feature_keys: ["manufacturing.batch_genealogy"],
      available_from_phase: "PHASE-018",
    },
    qc_inspections: {
      level: "OPTIONAL",
      feature_keys: ["manufacturing.qc"],
      available_from_phase: "PHASE-018",
    },
    customer_price_tiers: {
      level: "OPTIONAL",
      feature_keys: ["distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    commissions: {
      level: "OPTIONAL",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    landed_costs: {
      level: "OPTIONAL",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
    shipment_tracking: {
      level: "OPTIONAL",
      feature_keys: ["distribution.shipment_tracking"],
      available_from_phase: "PHASE-019",
    },
    pdc_notes: {
      level: "OPTIONAL",
      feature_keys: ["notes.received"],
      available_from_phase: "PHASE-027",
    },
    cashier_shifts: {
      level: "OPTIONAL",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
  },
});

// ---------------------------------------------------------------------------
// PHASE-030 (migration 0044 registry seeds): the wholesale + electronics
// pair — the first two Blueprint v2.0 stage-10 templates, configuration-only
// over the existing modules (INV-022: zero new journal/schema surface; the
// pins land from existing report keys only, register §J).
// ---------------------------------------------------------------------------

export const WHOLESALE_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.wholesale",
  name: "Wholesale & Trade",
  name_ar: "الجملة والتجارة",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "partners.credit_terms",
    "partners.statements",
    "sales.quotations",
    "sales.orders",
    "sales.deliveries",
    "sales.invoices",
    "sales.credit_limits",
    "purchasing.goods_receipts",
    "inventory.multi_warehouse",
    "notes.received",
    "inventory.wms",
    "inventory.putaway",
    "inventory.picking",
    "inventory.cycle_counts",
    "inventory.abc",
    "inventory.serial_ledger",
    "inventory.quarantine",
    "inventory.consignment",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "notes",
    "configuration",
  ],
  terminology_overrides: {
    "partner.customer": { en: "Customer (trader)", ar: "العميل / التاجر" },
    "doc.sales_invoice": { en: "Wholesale sales invoice", ar: "فاتورة بيع جملة" },
    "doc.quotation": { en: "Trade quote", ar: "عرض السعر" },
    "doc.sales_order": { en: "Bulk order", ar: "أمر التوريد" },
    "billing.receipt_voucher": { en: "Receipt voucher", ar: "سند قبض" },
    "price.qty_break": { en: "Quantity break", ar: "شريحة الكمية" },
    "price.min_qty": { en: "Min. quantity", ar: "الحد الأدنى للكمية" },
    "price.customer_tier": { en: "Customer price tier", ar: "فئة سعر العميل" },
    "credit.limit": { en: "Credit limit", ar: "سقف الائتمان" },
    "credit.terms": { en: "Credit terms", ar: "شروط الدفع" },
    "notes.pdc": { en: "Post-dated note", ar: "شيك مؤجل" },
    "billing.statement": { en: "Customer statement", ar: "كشف حساب العميل" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "trading",
        label: { en: "Trading", ar: "التجارة" },
        order: 1,
        items: [
          {
            id: "quick_order",
            label: { en: "Bulk quick order", ar: "إدخال طلب سريع" },
            target: "sales.quick_order",
          },
          {
            id: "quotes",
            label: { en: "Quotes", ar: "عروض الأسعار" },
            target: "sales.quotations",
          },
          {
            id: "orders",
            label: { en: "Bulk orders", ar: "أوامر التوريد" },
            target: "sales.orders",
          },
          {
            id: "deliveries",
            label: { en: "Deliveries", ar: "إشعارات التسليم" },
            target: "sales.deliveries",
          },
        ],
      },
      {
        id: "credit",
        label: { en: "Credit & collections", ar: "الائتمان والتحصيل" },
        order: 2,
        items: [
          {
            id: "invoices",
            label: { en: "Credit invoices", ar: "فواتير الآجل" },
            target: "sales.invoices",
          },
          {
            id: "statements",
            label: { en: "Customer statements", ar: "كشوف الحسابات" },
            target: "partners.statements",
          },
          {
            id: "pdc",
            label: { en: "PDC custody", ar: "الشيكات المؤجلة" },
            target: "notes.received",
            feature_key: "notes.received",
          },
          {
            id: "maturity",
            label: { en: "Maturity calendar", ar: "تقويم الاستحقاق" },
            target: "notes.pdc_calendar",
            feature_key: "notes.pdc_calendar",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    credit_sale_credit_limit_enforced: true,
    qty_break_pricing_automatic: true,
    tier_price_automatic_by_partner: true,
    bulk_order_from_quote_one_click: true,
    delivery_before_credit_invoice: true,
    statement_monthly_by_default: true,
    pdc_note_requires_maturity_date: true,
  },
  document_numbering_defaults: {
    quotation: {
      prefix: "QT",
      format: "QT-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_order: {
      prefix: "ORD",
      format: "ORD-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: true,
    },
    delivery_note: {
      prefix: "DLV",
      format: "DLV-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    receipt: {
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    stock_transfer: {
      prefix: "TRF",
      format: "TRF-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "notes.maturity-calendar",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "notes.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    { report_key: "ar.aging", pinned: true, dashboard: true, default_period: "this_month" },
    {
      report_key: "inventory.valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
  ],
  onboarding_steps: [
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (trade receivables, notes receivable)",
        ar: "تأكيد دليل الحسابات (ذمم التجار، أوراق القبض)",
      },
      required: true,
    },
    {
      id: "warehouses",
      title: { en: "Main & branch warehouses", ar: "المستودع الرئيسي ومستودعات الفروع" },
      required: true,
    },
    {
      id: "price_tiers",
      title: {
        en: "Price lists with quantity breaks & customer tiers",
        ar: "قوائم الأسعار مع شرائح الكمية وفئات العملاء",
      },
      required: true,
    },
    {
      id: "customers_credit",
      title: {
        en: "Customers with credit terms, limits & opening balances",
        ar: "العملاء مع شروط الدفع وحدود الائتمان والأرصدة الافتتاحية",
      },
      required: true,
    },
    {
      id: "opening_stock",
      title: { en: "Opening stock via goods receipts", ar: "المخزون الافتتاحي عبر سندات الاستلام" },
      required: true,
    },
    {
      id: "first_cycle",
      title: {
        en: "Run quote → bulk order → delivery → credit invoice",
        ar: "تنفيذ أول دورة: عرض، أمر توريد، تسليم، فاتورة آجل",
      },
      required: false,
    },
    {
      id: "first_pdc",
      title: {
        en: "Receive a first PDC note against an invoice",
        ar: "استلام أول شيك مؤجل مقابل فاتورة",
      },
      required: false,
      feature_key: "notes.received",
    },
  ],
  capability_prerequisites: {
    customer_price_tiers: {
      level: "REQUIRED",
      feature_keys: ["items.price_lists", "distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    pdc_notes: {
      level: "REQUIRED",
      feature_keys: ["notes.received", "notes.pdc_calendar"],
      available_from_phase: "PHASE-027",
    },
    installment_terms: {
      level: "OPTIONAL",
      feature_keys: ["installments.plans", "installments.late_fees"],
      available_from_phase: "PHASE-027",
    },
    barcode_pos: {
      level: "OPTIONAL",
      feature_keys: ["pos.terminals", "pos.sales", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "OPTIONAL",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    imei_tracking: {
      level: "OPTIONAL",
      feature_keys: ["inventory.serial_tracking"],
      available_from_phase: "PHASE-010",
    },
    expiry_tracking_fefo: {
      level: "OPTIONAL",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    free_goods_promo: {
      level: "OPTIONAL",
      feature_keys: ["sales.discount_management", "distribution.free_goods"],
      available_from_phase: "PHASE-017",
    },
    commissions: {
      level: "OPTIONAL",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    landed_costs: {
      level: "OPTIONAL",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
    route_planning: {
      level: "OPTIONAL",
      feature_keys: ["distribution.routes"],
      available_from_phase: "PHASE-017",
    },
    field_collections: {
      level: "OPTIONAL",
      feature_keys: ["treasury.receipts_disbursements"],
      available_from_phase: "PHASE-017",
    },
    shipment_tracking: {
      level: "OPTIONAL",
      feature_keys: ["distribution.shipment_tracking"],
      available_from_phase: "PHASE-019",
    },
  },
});

export const ELECTRONICS_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.electronics",
  name: "Mobile & Electronics",
  name_ar: "الجوالات والإلكترونيات",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.serial_tracking",
    "pos.terminals",
    "pos.sales",
    "pos.offline_queue",
    "pos.receipts",
    "crm.service_orders",
    "sales.invoices",
    "treasury.cashier_shifts",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "pos",
    "crm",
    "configuration",
  ],
  terminology_overrides: {
    "pos.sale": { en: "Retail sale", ar: "بيع بالتجزئة" },
    "svc.repair_card": { en: "Repair card", ar: "بطاقة صيانة" },
    "svc.repair": { en: "Repair", ar: "الصيانة / الإصلاح" },
    "item.imei": { en: "IMEI", ar: "الرقم التسلسلي (IMEI)" },
    "device.checkin": { en: "Device check-in", ar: "استلام الجهاز" },
    "tradein.purchase": { en: "Trade-in purchase", ar: "شراء جهاز مستعمل" },
    "part.accessory": { en: "Accessory", ar: "ملحق" },
    "part.spare": { en: "Spare part", ar: "قطعة غيار" },
    "svc.warranty": { en: "Warranty claim", ar: "بطارية الضمان / مطالبة الضمان" },
    "svc.labor": { en: "Labor", ar: "أجور الصيانة" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "counter",
        label: { en: "Counter", ar: "الكاونتر" },
        order: 1,
        items: [
          {
            id: "pos",
            label: { en: "Point of sale", ar: "نقطة البيع" },
            target: "pos.counter",
            feature_key: "pos.sales",
          },
          {
            id: "imei",
            label: { en: "IMEI register", ar: "سجل الأجهزة" },
            target: "inventory.imei",
            feature_key: "inventory.serial_tracking",
          },
          {
            id: "tradein",
            label: { en: "Trade-in purchases", ar: "شراء الأجهزة المستعملة" },
            target: "purchasing.tradein",
          },
        ],
      },
      {
        id: "service",
        label: { en: "Repair", ar: "الصيانة" },
        order: 2,
        items: [
          {
            id: "repair_cards",
            label: { en: "Repair cards", ar: "بطاقات الصيانة" },
            target: "crm.service_orders",
            feature_key: "crm.service_orders",
          },
          {
            id: "returns",
            label: { en: "Returns & exchanges", ar: "المرتجعات والاستبدال" },
            target: "sales.credit_notes",
          },
          {
            id: "receipts",
            label: { en: "Receipts", ar: "سندات القبض" },
            target: "treasury.receipts",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    cash_sales_autopost: true,
    imei_capture_required_flagged_items: true,
    repair_parts_issue_mode: "reserve",
    repair_card_labor_rate_source: "price_list",
    tradein_purchase_at_branch: true,
    warranty_credit_note_requires_original_invoice: true,
    shift_variance_approval_required: true,
  },
  document_numbering_defaults: {
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    pos_sale: {
      prefix: "POS",
      format: "POS-{branch}-{yy}{MM}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    },
    job_card: {
      prefix: "RC",
      format: "RC-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: true,
    default_imei_tracking: true,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "retail.imei_register",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "pos.sales_by_terminal",
      pinned: true,
      dashboard: true,
      default_period: "today",
    },
    {
      report_key: "pos.sales_by_hour",
      pinned: true,
      dashboard: false,
      default_period: "this_week",
    },
    {
      report_key: "inventory.valuation",
      pinned: true,
      dashboard: false,
      default_period: "custom",
    },
  ],
  onboarding_steps: [
    {
      id: "counter_branch",
      title: {
        en: "Create branch, stockroom & terminals",
        ar: "إنشاء الفرع والمستودع وأجهزة نقطة البيع",
      },
      required: true,
    },
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (device vs service vs used-goods)",
        ar: "تأكيد دليل الحسابات (الأجهزة، الصيانة، الأجهزة المستعملة)",
      },
      required: true,
    },
    {
      id: "imei_categories",
      title: { en: "Item categories with IMEI flags", ar: "تصنيفات الأصناف مع خيار تسجيل IMEI" },
      required: true,
    },
    {
      id: "labor_rates",
      title: { en: "Repair labor rate lists", ar: "قوائم أسعار أجور الصيانة" },
      required: true,
    },
    {
      id: "opening_stock",
      title: { en: "Opening stock with IMEI capture", ar: "المخزون الافتتاحي مع تسجيل الأجهزة" },
      required: true,
    },
    {
      id: "first_repair",
      title: { en: "Run a first repair card end-to-end", ar: "تنفيذ أول بطاقة صيانة كاملة" },
      required: false,
      feature_key: "crm.service_orders",
    },
    {
      id: "first_shift",
      title: { en: "Open first shift and sell", ar: "افتتاح أول وردية وإجراء أول عملية بيع" },
      required: false,
      feature_key: "pos.sales",
    },
  ],
  capability_prerequisites: {
    imei_tracking: {
      level: "REQUIRED",
      feature_keys: ["inventory.serial_tracking"],
      available_from_phase: "PHASE-010",
    },
    job_cards: {
      level: "REQUIRED",
      feature_keys: ["crm.service_orders"],
      available_from_phase: "PHASE-019",
    },
    barcode_pos: {
      level: "REQUIRED",
      feature_keys: ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "REQUIRED",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    composite_kits: {
      level: "OPTIONAL",
      feature_keys: ["items.composite_products"],
      available_from_phase: "PHASE-016",
    },
    customer_price_tiers: {
      level: "OPTIONAL",
      feature_keys: ["distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    free_goods_promo: {
      level: "OPTIONAL",
      feature_keys: ["sales.discount_management", "distribution.free_goods"],
      available_from_phase: "PHASE-017",
    },
    commissions: {
      level: "OPTIONAL",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    landed_costs: {
      level: "OPTIONAL",
      feature_keys: ["purchasing.landed_costs"],
      available_from_phase: "PHASE-011",
    },
    service_contracts: {
      level: "OPTIONAL",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    pdc_notes: {
      level: "OPTIONAL",
      feature_keys: ["notes.received"],
      available_from_phase: "PHASE-027",
    },
    installment_terms: {
      level: "OPTIONAL",
      feature_keys: ["installments.plans"],
      available_from_phase: "PHASE-027",
    },
  },
});

// ---------------------------------------------------------------------------
// PHASE-031 · industry.healthcare — the Healthcare Commercial Shell (ED-07)
// ---------------------------------------------------------------------------

/**
 * The healthcare commercial shell (transcribed VERBATIM from the migration
 * 0046 registry seed — the source docs/industries/templates/healthcare.md
 * with the single §J pin reconciliation partners.ar_aging → ar.aging):
 * the patient is a partner FINANCIAL file only (the bold ED-07/ED-11
 * zero-clinical boundary — no diagnosis/prescription/appointment field
 * exists anywhere in the shell, machine-checked by the
 * zero-clinical-surface test), insurers are customer-kind partners with
 * per-claim open items tracked through the single additive
 * sales_invoices.claim_ref column (migration 0045 — a claim_ref-carrying
 * invoice is a claim invoice billed to the insurer partner; a null one is
 * self-pay دفع مباشر billed to the patient), the pharmacy is a FEFO batch
 * store reusing inventory.batch_tracking unchanged, and claims settle by
 * cheque / post-dated note through the PHASE-027 notes module
 * (G-24/G-25/G-26 — REQUIRED pdc_notes, live at apply time since 027
 * shipped before this template registered).
 */
export const HEALTHCARE_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.healthcare",
  name: "Healthcare (Commercial Shell)",
  name_ar: "الرعاية الصحية — الغلاف التجاري",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "partners.directory",
    "partners.statements",
    "sales.invoices",
    "sales.credit_limits",
    "notes.received",
    "inventory.batch_tracking",
    "crm.service_orders",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "crm",
    "notes",
    "configuration",
  ],
  terminology_overrides: {
    "partner.patient": { en: "Patient (financial file)", ar: "المريض (الملف المالي)" },
    "partner.insurer": { en: "Insurance company", ar: "شركة التأمين" },
    "claim.ref": { en: "Insurance claim", ar: "مطالبة تأمينية" },
    "pharmacy.store": { en: "Pharmacy", ar: "صيدلية" },
    "svc.visit": { en: "Visit", ar: "الزيارة" },
    "doc.services_invoice": { en: "Medical services invoice", ar: "فاتورة الخدمات الطبية" },
    "billing.self_pay": { en: "Self-pay", ar: "دفع مباشر" },
    "notes.pdc": { en: "Post-dated note", ar: "شيك مؤجل" },
    "billing.collection": { en: "Collection", ar: "التحصيل" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "billing",
        label: { en: "Billing", ar: "الفوترة" },
        order: 1,
        items: [
          {
            id: "visits",
            label: { en: "Visits & service orders", ar: "الزيارات وأوامر الخدمة" },
            target: "crm.service_orders",
            feature_key: "crm.service_orders",
          },
          {
            id: "invoices",
            label: { en: "Invoices (patient / insurance)", ar: "الفواتير (مريض / تأمين)" },
            target: "sales.invoices",
          },
          {
            id: "claims",
            label: { en: "Claims by insurer", ar: "المطالبات حسب الشركة" },
            target: "partners.statements",
          },
        ],
      },
      {
        id: "pharmacy",
        label: { en: "Pharmacy", ar: "الصيدلية" },
        order: 2,
        items: [
          {
            id: "expiry",
            label: { en: "Expiry control", ar: "الرقابة على الصلاحية" },
            target: "inventory.expiry_list",
            feature_key: "inventory.batch_tracking",
          },
          {
            id: "counter",
            label: { en: "Pharmacy counter", ar: "كاونتر الصيدلية" },
            target: "pos.counter",
            feature_key: "pos.sales",
          },
          {
            id: "pdc",
            label: { en: "Claims cheques", ar: "شيكات المطالبات" },
            target: "notes.received",
            feature_key: "notes.received",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    patient_file_financial_only: true,
    claim_ref_required_for_insured_invoices: true,
    insurance_invoice_billed_to_company_partner: true,
    pharmacy_fefo_enforced: true,
    dunning_by_claim_enabled: true,
    insurance_credit_limit_per_company: true,
  },
  document_numbering_defaults: {
    sales_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    credit_note: {
      prefix: "CN",
      format: "CN-{yyyy}-{seq:5}",
      per_branch: false,
      reserve_on_approval: false,
    },
    receipt: {
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    goods_receipt: {
      prefix: "GRN",
      format: "GRN-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: true,
    default_track_expiry: true,
    default_track_serial: false,
    default_imei_tracking: false,
    fefo_picking: true,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "notes.aging",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "notes.maturity-calendar",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "ar.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    {
      report_key: "inventory.expiry_list",
      pinned: true,
      dashboard: false,
      default_period: "this_week",
    },
  ],
  onboarding_steps: [
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (services, pharmacy, notes receivable)",
        ar: "تأكيد دليل الحسابات (الخدمات، الصيدلية، أوراق القبض)",
      },
      required: true,
    },
    {
      id: "payers",
      title: {
        en: "Insurers with credit limits & contracted fee schedules",
        ar: "شركات التأمين مع سقوف الائتمان وأسعار التعاقد",
      },
      required: true,
    },
    {
      id: "patients",
      title: {
        en: "Patient financial files (no clinical data)",
        ar: "الملفات المالية للمرضى (بيانات مالية فقط)",
      },
      required: true,
    },
    {
      id: "pharmacy_items",
      title: {
        en: "Pharmacy items with batches & expiry",
        ar: "أصناف الصيدلية مع الدفعات والصلاحية",
      },
      required: true,
    },
    {
      id: "service_items",
      title: {
        en: "Service items (consultation, procedure fees)",
        ar: "بنود الخدمات (الاستشارات، الرسوم الطبية)",
      },
      required: true,
    },
    {
      id: "first_visit",
      title: {
        en: "Bill a first visit (self-pay and insurance)",
        ar: "فوترة أول زيارة (دفع مباشر وتأمين)",
      },
      required: false,
    },
    {
      id: "first_claim",
      title: {
        en: "Register a first claim cheque",
        ar: "تسجيل أول شيك مطالبة",
      },
      required: false,
      feature_key: "notes.received",
    },
  ],
  capability_prerequisites: {
    insurance_claim_billing: {
      level: "REQUIRED",
      feature_keys: ["sales.invoices", "notes.received", "partners.statements"],
      available_from_phase: "PHASE-031",
    },
    pdc_notes: {
      level: "REQUIRED",
      feature_keys: ["notes.received", "notes.pdc_calendar"],
      available_from_phase: "PHASE-027",
    },
    expiry_tracking_fefo: {
      level: "REQUIRED",
      feature_keys: ["inventory.batch_tracking"],
      available_from_phase: "PHASE-010",
    },
    job_cards: {
      level: "REQUIRED",
      feature_keys: ["crm.service_orders"],
      available_from_phase: "PHASE-019",
    },
    barcode_pos: {
      level: "OPTIONAL",
      feature_keys: ["pos.terminals", "pos.sales", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "OPTIONAL",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    customer_price_tiers: {
      level: "OPTIONAL",
      feature_keys: ["items.price_lists", "distribution.customer_tiers"],
      available_from_phase: "PHASE-017",
    },
    service_contracts: {
      level: "OPTIONAL",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    installment_terms: {
      level: "OPTIONAL",
      feature_keys: ["installments.plans"],
      available_from_phase: "PHASE-027",
    },
  },
});

/**
 * The Rental & Logistics commercial shell — the thirteenth (final) template,
 * completing the 13-activity INDUSTRY_CATALOG the blueprint documents.
 *
 * Source and reconciliation record (the 0025/0027/0044/0046 convention):
 * transcribed from docs/industries/templates/manifests/manifest.rental_logistics.json
 * (the normative v1.0.0 doc) with FOUR honest reconciliations, each following
 * a shipped precedent:
 *
 *   - REQUIRED feature keys → LIVE granted keys only. The doc's
 *     crm.rental_contracts / crm.contract_deposits / crm.late_fees /
 *     distribution.shipment_tracking intake keys were the deferred PHASE-019
 *     pair (RISK-019 decision record — "never silently granted"); the shipped
 *     shell composes the SAME commercial surface over the live contracts
 *     engine exactly the healthcare way (healthcare's insurance billing =
 *     sales invoices + notes + partner statements; here rental = service
 *     contracts + recurring billing + serial-tracked fleet). The doc's
 *     treasury.cash_accounts → the live treasury.accounts key.
 *   - report pins → LIVE registry keys (register §J stays closed): the doc's
 *     rental.fleet_utilization → inventory.serial-tracking (the fleet is the
 *     serial register), rental.late_fee_register → ar.aging (late-fee
 *     receivables ARE AR open items), logistics.shipment_status_board →
 *     distribution.route_visit_compliance (the live route status board),
 *     partners.ar_aging → ar.aging; services.contract_revenue_schedule
 *     resolves verbatim.
 *   - navigation targets → live surfaces (reservations ride the CRM pipeline,
 *     fleet rides the serial-tracked item master, returns & inspections ride
 *     crm.service_orders, shipments ride distribution routes, the status
 *     board rides settlements) with live feature keys on every gated item.
 *   - capability_prerequisites ≡ the CAPABILITY_MATRIX §1 RNT column,
 *     STRICT both directions (the five matrix OPT cells the doc manifest
 *     omitted — job_cards / customer_price_tiers / commissions / pdc_notes /
 *     installment_terms — are declared here over their live keys).
 *
 * Deposits & late fees post through the EXISTING contract-invoice + receipt
 * machinery (deposit intake = an advance receipt against the customer
 * deposits liability; late fee = a contract invoice line after the grace
 * policy), enforced by the seven typed workflow policies below — the
 * crm.contract_deposits / crm.late_fees feature-intake pair stays deferred
 * per its decision record, never granted by this template.
 */
export const RENTAL_LOGISTICS_TEMPLATE_MANIFEST: IndustryTemplateManifest = deepFreeze({
  id: "industry.rental_logistics",
  name: "Rental & Logistics",
  name_ar: "التأجير والخدمات اللوجستية",
  version: "1.0.0",
  required_feature_keys: [
    "industry.template_engine",
    "crm.service_contracts",
    "crm.recurring_billing",
    "inventory.serial_tracking",
    "items.item_master",
    "partners.statements",
    "treasury.accounts",
  ],
  default_modules_enabled: [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "treasury",
    "tax",
    "reporting",
    "crm",
    "distribution",
    "configuration",
  ],
  terminology_overrides: {
    "rental.contract": { en: "Rental contract", ar: "عقد الإيجار" },
    "rental.reservation": { en: "Reservation", ar: "الحجز" },
    "rental.deposit": { en: "Security deposit", ar: "مبلغ التأمين" },
    "rental.late_fee": { en: "Late fee", ar: "رسوم التأخير" },
    "rental.pickup": { en: "Pickup (check-out)", ar: "الاستلام" },
    "rental.return": { en: "Return (check-in)", ar: "الإرجاع" },
    "rental.inspection": { en: "Damage inspection", ar: "فحص الأضرار" },
    "rental.fleet": { en: "Fleet", ar: "الأسطول" },
    "rental.utilization": { en: "Utilization", ar: "نسبة الاستغلال" },
    "rental.grace_period": { en: "Grace period", ar: "مدة السماح" },
    "logi.shipment": { en: "Shipment", ar: "الشحنة" },
    "logi.waybill": { en: "Waybill", ar: "بوليصة الشحن" },
    "logi.milestone": { en: "Milestone", ar: "تحديث حالة الشحنة" },
  },
  navigation_manifest: {
    groups: [
      {
        id: "rental",
        label: { en: "Rental", ar: "التأجير" },
        order: 1,
        items: [
          {
            id: "reservations",
            label: { en: "Reservations", ar: "الحجوزات" },
            target: "crm.pipeline",
            feature_key: "crm.leads",
          },
          {
            id: "contracts",
            label: { en: "Rental contracts", ar: "عقود الإيجار" },
            target: "crm.contracts",
          },
          {
            id: "fleet",
            label: { en: "Fleet & assets", ar: "الأسطول والأصول" },
            target: "items.item_master",
            feature_key: "inventory.serial_tracking",
          },
          {
            id: "returns",
            label: { en: "Returns & inspections", ar: "الإرجاع والفحص" },
            target: "crm.service_orders",
            feature_key: "crm.service_orders",
          },
        ],
      },
      {
        id: "logistics",
        label: { en: "Logistics", ar: "الخدمات اللوجستية" },
        order: 2,
        items: [
          {
            id: "shipments",
            label: { en: "Shipments", ar: "الشحنات" },
            target: "distribution.routes",
            feature_key: "distribution.routes",
          },
          {
            id: "status_board",
            label: { en: "Status board", ar: "لوحة الحالات" },
            target: "distribution.settlements",
            feature_key: "distribution.settlements",
          },
        ],
      },
    ],
  },
  workflow_policies: {
    rental_deposit_required: true,
    late_fee_after_grace_hours: 3,
    late_fee_calculation: "daily_rate_based",
    damage_charge_requires_inspection: true,
    deposit_release_requires_manager_approval: true,
    overdue_rental_blocks_new_reservation: true,
    shipment_milestones_manual: true,
  },
  document_numbering_defaults: {
    rental_contract: {
      prefix: "RNT",
      format: "RNT-{yyyy}-{seq:5}",
      per_branch: true,
      reserve_on_approval: true,
    },
    contract_invoice: {
      prefix: "INV",
      format: "INV-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    receipt: {
      prefix: "RCP",
      format: "RCP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    payment: {
      prefix: "PAY",
      format: "PAY-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
    shipment: {
      prefix: "SHP",
      format: "SHP-{yyyy}-{seq:6}",
      per_branch: false,
      reserve_on_approval: false,
    },
  },
  inventory_policy_defaults: {
    costing_method: "WAC",
    default_track_batch: false,
    default_track_expiry: false,
    default_track_serial: true,
    default_imei_tracking: false,
    fefo_picking: false,
    allow_negative_stock: false,
  },
  report_defaults: [
    {
      report_key: "inventory.serial-tracking",
      pinned: true,
      dashboard: true,
      default_period: "this_month",
    },
    {
      report_key: "distribution.route_visit_compliance",
      pinned: true,
      dashboard: true,
      default_period: "today",
    },
    {
      report_key: "services.contract_revenue_schedule",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
    {
      report_key: "ar.aging",
      pinned: true,
      dashboard: false,
      default_period: "this_month",
    },
  ],
  onboarding_steps: [
    {
      id: "coa_confirm",
      title: {
        en: "Confirm chart of accounts (customer deposits liability)",
        ar: "تأكيد دليل الحسابات (التزامات تأمينات العملاء)",
      },
      required: true,
    },
    {
      id: "fleet",
      title: {
        en: "Register fleet/assets as serial items",
        ar: "تسجيل الأسطول/الأصول كأصناف متسلسلة",
      },
      required: true,
    },
    {
      id: "rate_cards",
      title: {
        en: "Rental rate cards",
        ar: "تعريفات التأجير",
      },
      required: true,
    },
    {
      id: "customers",
      title: {
        en: "Customers & ID documents",
        ar: "العملاء ووثائق الهوية",
      },
      required: true,
    },
    {
      id: "deposit_policy",
      title: {
        en: "Deposit & late-fee policy",
        ar: "سياسة التأمين ورسوم التأخير",
      },
      required: true,
    },
    {
      id: "first_contract",
      title: {
        en: "Run first rental contract end-to-end",
        ar: "تنفيذ أول عقد إيجار كامل",
      },
      required: false,
    },
    {
      id: "shipments",
      title: {
        en: "Configure shipment milestones (logistics)",
        ar: "تهيئة حالات الشحنات (اللوجستيات)",
      },
      required: false,
      feature_key: "distribution.routes",
    },
  ],
  capability_prerequisites: {
    rental_contracts: {
      level: "REQUIRED",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    service_contracts: {
      level: "REQUIRED",
      feature_keys: ["crm.service_contracts"],
      available_from_phase: "PHASE-019",
    },
    recurring_billing: {
      level: "REQUIRED",
      feature_keys: ["crm.recurring_billing"],
      available_from_phase: "PHASE-019",
    },
    deposits_late_fees: {
      level: "REQUIRED",
      feature_keys: ["crm.recurring_billing", "treasury.receipts_disbursements"],
      available_from_phase: "PHASE-019",
    },
    shipment_tracking: {
      level: "REQUIRED",
      feature_keys: ["distribution.routes", "distribution.settlements"],
      available_from_phase: "PHASE-017",
    },
    field_collections: {
      level: "REQUIRED",
      feature_keys: ["treasury.receipts_disbursements"],
      available_from_phase: "PHASE-017",
    },
    barcode_pos: {
      level: "OPTIONAL",
      feature_keys: ["pos.terminals", "pos.sales", "pos.receipts"],
      available_from_phase: "PHASE-016",
    },
    cashier_shifts: {
      level: "OPTIONAL",
      feature_keys: ["treasury.cashier_shifts"],
      available_from_phase: "PHASE-016",
    },
    job_cards: {
      level: "OPTIONAL",
      feature_keys: ["crm.service_orders"],
      available_from_phase: "PHASE-019",
    },
    customer_price_tiers: {
      level: "OPTIONAL",
      feature_keys: ["items.price_lists"],
      available_from_phase: "PHASE-017",
    },
    commissions: {
      level: "OPTIONAL",
      feature_keys: ["sales.commissions"],
      available_from_phase: "PHASE-017",
    },
    route_planning: {
      level: "OPTIONAL",
      feature_keys: ["distribution.routes"],
      available_from_phase: "PHASE-017",
    },
    pdc_notes: {
      level: "OPTIONAL",
      feature_keys: ["notes.received"],
      available_from_phase: "PHASE-027",
    },
    installment_terms: {
      level: "OPTIONAL",
      feature_keys: ["installments.plans"],
      available_from_phase: "PHASE-027",
    },
  },
});

/** Every manifest shipped by this build — the CI validation set (§8). */
export const SHIPPED_TEMPLATE_MANIFESTS: readonly IndustryTemplateManifest[] = Object.freeze([
  RETAIL_MANIFEST,
  GROCERY_MANIFEST,
  RESTAURANT_MANIFEST,
  AUTOMOTIVE_TEMPLATE_MANIFEST,
  DISTRIBUTION_TEMPLATE_MANIFEST,
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST,
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST,
  EDUCATION_TEMPLATE_MANIFEST,
  AGRICULTURE_TEMPLATE_MANIFEST,
  WHOLESALE_TEMPLATE_MANIFEST,
  ELECTRONICS_TEMPLATE_MANIFEST,
  HEALTHCARE_TEMPLATE_MANIFEST,
  RENTAL_LOGISTICS_TEMPLATE_MANIFEST,
]);
