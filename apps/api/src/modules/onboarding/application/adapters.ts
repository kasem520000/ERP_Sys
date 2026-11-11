/**
 * PHASE-040 migration adapters (§2.4, IN-26 — extract-then-import, NOT live
 * connectors): versioned mapping presets for QuickBooks-shaped, Odoo-shaped,
 * and Excel-generic extracts. Each adapter names its target import kind, the
 * source→canonical column map, and where the import runs (the PHASE-040
 * toolkit engine or the baseline items import console for the three
 * PHASE-006 kinds).
 *
 * The mapping documents are the CONTRACT (docs/migration/MIGRATION_ADAPTERS.md
 * — acceptance 5): a fixture that drifts from the documented mapping fails
 * the spec. Ambiguous columns carry REQUIRES_VERIFICATION (the §7 risk
 * mitigation: versioned docs + the wizard's manual override per column).
 */


export interface AdapterColumn {
  /** The SOURCE system's column header (verbatim — the template file's header). */
  readonly source: string;
  /** The target kind's canonical column (null = informational/ignored). */
  readonly canonical: string | null;
  readonly required: boolean;
  readonly requiresVerification?: boolean;
  readonly note?: { readonly en: string; readonly ar: string };
}

export interface MigrationAdapter {
  readonly key: string;
  readonly source: "QUICKBOOKS" | "ODOO" | "EXCEL_GENERIC";
  readonly label: { readonly en: string; readonly ar: string };
  readonly targetKind: string;
  /** Where the import runs: the toolkit engine, or the baseline items console. */
  readonly engine: "toolkit" | "baseline-console";
  readonly format: "CSV" | "XLSX";
  readonly columns: readonly AdapterColumn[];
  /** The source→canonical map handed to the toolkit engine as columnMap. */
  readonly columnMap: Record<string, string>;
  /** One example row (source headers order) for the downloadable template. */
  readonly exampleRow: readonly string[];
  readonly notes: { readonly en: string; readonly ar: string };
}

function mapOf(columns: readonly AdapterColumn[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const column of columns) {
    if (column.canonical !== null) {
      map[column.canonical] = column.source;
    }
  }
  return map;
}

// -- QuickBooks-shaped ------------------------------------------------------------

const QUICKBOOKS_CHART: MigrationAdapter = {
  key: "quickbooks-chart-of-accounts",
  source: "QUICKBOOKS",
  label: { en: "QuickBooks — Chart of Accounts", ar: "كويك بوكس — دليل الحسابات" },
  targetKind: "COA",
  engine: "toolkit",
  format: "CSV",
  columns: [
    { source: "Account Number", canonical: "code", required: true },
    { source: "Account Name", canonical: "name", required: true },
    {
      source: "Account Type",
      canonical: "type",
      required: true,
      note: {
        en: "Translated per the §2 table (Bank/Fixed Asset/…→ ASSET; Accounts Payable/…→ LIABILITY; Income→ REVENUE; …)",
        ar: "تُترجم وفق جدول §٢ (بنك/أصل ثابت/… ← أصول؛ حسابات دائنة/… ← التزامات؛ دخل ← إيرادات؛ …)",
      },
    },
    {
      source: "Parent Account Number",
      canonical: "parent_code",
      required: false,
      requiresVerification: true,
      note: {
        en: "REQUIRES_VERIFICATION: QuickBooks names sub-accounts in the full path; export the parent's own number here (the wizard allows manual override)",
        ar: "يتطلب تحققاً: يسمي كويك بوكس الحسابات الفرعية بالمسار الكامل؛ صدّر رقم الحساب الأب نفسه هنا (يمكن التعديل اليدوي في المعيّن)",
      },
    },
    { source: "Is Header Account", canonical: "is_group", required: false },
    { source: "Description", canonical: null, required: false },
  ],
  columnMap: {},
  exampleRow: ["1000", "Cash on Hand", "Bank", "", "TRUE", "Petty cash drawer"],
  notes: {
    en: "The QuickBooks Account List export (Reports → Account List → Excel), with the parent column flattened to the parent's own number",
    ar: "تصدير قائمة الحسابات من كويك بوكس، مع تسطيح عمود الأب إلى رقم الحساب الأب نفسه",
  },
};

const QUICKBOOKS_TRIAL_BALANCE: MigrationAdapter = {
  key: "quickbooks-trial-balance",
  source: "QUICKBOOKS",
  label: { en: "QuickBooks — Trial Balance (opening)", ar: "كويك بوكس — ميزان المراجعة (افتتاحي)" },
  targetKind: "ACCOUNT_OPENING_BALANCES",
  engine: "toolkit",
  format: "CSV",
  columns: [
    { source: "Account Number", canonical: "account_code", required: true },
    { source: "Account Name", canonical: "account_name", required: false },
    { source: "Debit", canonical: "debit", required: false },
    { source: "Credit", canonical: "credit", required: false },
  ],
  columnMap: {},
  exampleRow: ["1000", "Cash on Hand", "50000.00", ""],
  notes: {
    en: "The as-of-migration-date trial balance; the file must balance by nature (Σdebit = Σcredit) — the dry-run rejects an unbalanced file",
    ar: "ميزان المراجعة بتاريخ الترحيل؛ يجب أن يكون الملف متوازناً بالطبيعة (مجموع المدين = مجموع الدائن) — يرفض التشغيل التجريبي الملف غير المتوازن",
  },
};

const QUICKBOOKS_CUSTOMERS: MigrationAdapter = {
  key: "quickbooks-customers",
  source: "QUICKBOOKS",
  label: { en: "QuickBooks — Customer List", ar: "كويك بوكس — قائمة العملاء" },
  targetKind: "PARTNERS",
  engine: "baseline-console",
  format: "CSV",
  columns: [
    { source: "Customer Name", canonical: "name", required: true },
    { source: "Company Name", canonical: "name", required: false, requiresVerification: true },
    { source: "Main Phone", canonical: null, required: false },
    { source: "Email", canonical: null, required: false },
    { source: "Balance", canonical: null, required: false },
  ],
  columnMap: {},
  exampleRow: ["Elite Trading", "", "+966 50 000 0000", "billing@elite.example", "0.00"],
  notes: {
    en: "Runs through the baseline items import console (inventory → import): map Customer Name → name, kind = CUSTOMER; the open balance lands as a PARTNER opening-balance draft (aggregate the open invoices per customer — transactional history import is the documented out-of-scope boundary)",
    ar: "يعمل عبر وحدة الاستيراد الأساسية: اربط اسم العميل بالاسم والنوع عميل؛ يُحمَّل الرصيد المفتوح كرصيد افتتاحي للعميل (بتجميع الفواتير المفتوحة لكل عميل — استيراد السجل التاريخي خارج النطاق بموجب التوثيق)",
  },
};

const QUICKBOOKS_ITEMS: MigrationAdapter = {
  key: "quickbooks-items",
  source: "QUICKBOOKS",
  label: { en: "QuickBooks — Product/Service List", ar: "كويك بوكس — قائمة المنتجات والخدمات" },
  targetKind: "ITEMS",
  engine: "baseline-console",
  format: "CSV",
  columns: [
    { source: "Item Name", canonical: "name", required: true },
    { source: "Type", canonical: null, required: false, requiresVerification: true },
    { source: "Sales Price", canonical: null, required: false },
    { source: "Cost", canonical: null, required: false },
  ],
  columnMap: {},
  exampleRow: ["Consulting Hour", "Service", "350.00", "120.00"],
  notes: {
    en: "Runs through the baseline items import console: map Item Name → name; Inventory items become STOCK, Services become SERVICE (manual pass — the wizard maps each column)",
    ar: "يعمل عبر وحدة الاستيراد الأساسية: اربط اسم الصنف بالاسم؛ أصناف المخزون تصبح مخزنية والخدمات خدمية (مراجعة يدوية عبر معيّن الربط)",
  },
};

// -- Odoo-shaped ------------------------------------------------------------------

const ODOO_CHART: MigrationAdapter = {
  key: "odoo-chart-of-accounts",
  source: "ODOO",
  label: { en: "Odoo — Chart of Accounts", ar: "أودو — دليل الحسابات" },
  targetKind: "COA",
  engine: "toolkit",
  format: "CSV",
  columns: [
    { source: "Code", canonical: "code", required: true },
    { source: "Name", canonical: "name", required: true },
    {
      source: "Type",
      canonical: "type",
      required: true,
      note: {
        en: "Translated per the §3 table (asset/receivable → ASSET; payable/liability → LIABILITY; income → REVENUE; expense → EXPENSE; equity → EQUITY)",
        ar: "تُترجم وفق جدول §٣ (أصل/مدينون ← أصول؛ دائنون/التزامات ← التزامات؛ دخل ← إيرادات؛ مصروف ← مصروفات؛ حقوق ملكية ← حقوق ملكية)",
      },
    },
    {
      source: "Parent Code",
      canonical: "parent_code",
      required: false,
      requiresVerification: true,
      note: {
        en: "REQUIRES_VERIFICATION: odoo exports the parent as a name by default — switch the export to the parent's code column",
        ar: "يتطلب تحققاً: يصدّر أودو الأب بالاسم افتراضياً — بدّل التصدير إلى عمود رمز الأب",
      },
    },
  ],
  columnMap: {},
  exampleRow: ["110000", "Bank", "bank", ""],
  notes: {
    en: "The account.account list export (Accounting → Chart of Accounts → list view export), filtered to your company",
    ar: "تصدير قائمة الحسابات من أودو (المحاسبة ← دليل الحسابات ← تصدير القائمة) مع تحديد شركتك",
  },
};

const ODOO_PARTNERS: MigrationAdapter = {
  key: "odoo-partners",
  source: "ODOO",
  label: { en: "Odoo — Partners (customers/vendors)", ar: "أودو — الشركاء (عملاء/موردون)" },
  targetKind: "PARTNERS",
  engine: "baseline-console",
  format: "CSV",
  columns: [
    { source: "Name", canonical: "name", required: true },
    { source: "Is Company", canonical: null, required: false },
    { source: "Email", canonical: null, required: false },
    { source: "Phone", canonical: null, required: false },
  ],
  columnMap: {},
  exampleRow: ["شركة الأمل التجارية", "True", "info@amal.example", "+966 11 000 0000"],
  notes: {
    en: "Runs through the baseline items import console: map Name → name, kind = CUSTOMER or SUPPLIER (two passes — filter by the odoo supplier_rank/customer_rank columns)",
    ar: "يعمل عبر وحدة الاستيراد الأساسية: اربط الاسم بالاسم مع تمريرين — عملاء ثم موردين (صفِّ حسب عمودي التصنيف في أودو)",
  },
};

const ODOO_PRODUCTS: MigrationAdapter = {
  key: "odoo-products",
  source: "ODOO",
  label: { en: "Odoo — Products", ar: "أودو — المنتجات" },
  targetKind: "ITEMS",
  engine: "baseline-console",
  format: "CSV",
  columns: [
    { source: "Internal Reference", canonical: "sku", required: true },
    { source: "Name", canonical: "name", required: true },
    { source: "Product Type", canonical: null, required: false, requiresVerification: true },
    { source: "Sales Price", canonical: null, required: false },
  ],
  columnMap: {},
  exampleRow: ["SKU-001", "Arabic Coffee 500g", "Goods", "45.00"],
  notes: {
    en: "Runs through the baseline items import console: map Internal Reference → sku, Name → name; storable products become STOCK, services become SERVICE",
    ar: "يعمل عبر وحدة الاستيراد الأساسية: اربط المرجع الداخلي برمز الصنف والاسم بالاسم؛ المنتجات المخزنية مخزنية والخدمات خدمية",
  },
};

// -- Excel-generic (the canonical EN templates) -------------------------------------

const GENERIC_COA: MigrationAdapter = {
  key: "excel-generic-coa",
  source: "EXCEL_GENERIC",
  label: { en: "Excel generic — Chart of Accounts", ar: "إكسل عام — دليل الحسابات" },
  targetKind: "COA",
  engine: "toolkit",
  format: "CSV",
  columns: [
    { source: "Account Code", canonical: "code", required: true },
    { source: "Account Name", canonical: "name", required: true },
    { source: "Account Name (AR)", canonical: "name_ar", required: false },
    { source: "Account Type", canonical: "type", required: true },
    { source: "Parent Account Code", canonical: "parent_code", required: false },
    { source: "Currency", canonical: "currency", required: false },
    { source: "Is Group", canonical: "is_group", required: false },
  ],
  columnMap: {},
  exampleRow: ["1100", "Cash on Hand", "النقد بالصندوق", "ASSET", "1000", "SAR", "FALSE"],
  notes: {
    en: "The canonical EN template — the auto-detect maps these headers directly (arabic headers work too)",
    ar: "القالب الإنجليزي القياسي — يربطه الكشف التلقائي مباشرة (تعمل الترويسات العربية أيضاً)",
  },
};

const GENERIC_TRIAL_BALANCE: MigrationAdapter = {
  key: "excel-generic-trial-balance",
  source: "EXCEL_GENERIC",
  label: { en: "Excel generic — Opening Trial Balance", ar: "إكسل عام — ميزان المراجعة الافتتاحي" },
  targetKind: "ACCOUNT_OPENING_BALANCES",
  engine: "toolkit",
  format: "CSV",
  columns: [
    { source: "Account Code", canonical: "account_code", required: true },
    { source: "Account Name", canonical: "account_name", required: false },
    { source: "Debit", canonical: "debit", required: false },
    { source: "Credit", canonical: "credit", required: false },
    { source: "Note", canonical: "note", required: false },
  ],
  columnMap: {},
  exampleRow: ["1100", "Cash on Hand", "50000.0000", "", "Opening cash"],
  notes: {
    en: "Balanced by nature (Σdebit = Σcredit) — lands through the opening engine as ACCOUNT drafts",
    ar: "متوازن بالطبيعة (مجموع المدين = مجموع الدائن) — يهبط عبر محرك الأرصدة الافتتاحية كمسودات حسابات",
  },
};

function withMap(adapter: MigrationAdapter): MigrationAdapter {
  return { ...adapter, columnMap: mapOf(adapter.columns) };
}

const ADAPTERS: readonly MigrationAdapter[] = [
  withMap(QUICKBOOKS_CHART),
  withMap(QUICKBOOKS_TRIAL_BALANCE),
  withMap(QUICKBOOKS_CUSTOMERS),
  withMap(QUICKBOOKS_ITEMS),
  withMap(ODOO_CHART),
  withMap(ODOO_PARTNERS),
  withMap(ODOO_PRODUCTS),
  withMap(GENERIC_COA),
  withMap(GENERIC_TRIAL_BALANCE),
];

export const MIGRATION_ADAPTERS: readonly MigrationAdapter[] = Object.freeze(
  Object.freeze([...ADAPTERS]),
);

export function findAdapter(key: string): MigrationAdapter | undefined {
  return MIGRATION_ADAPTERS.find((adapter) => adapter.key === key);
}

/** The CSV template body (BOM + source headers + one example row). */
export function adapterTemplateCsv(adapter: MigrationAdapter): string {
  const headers = adapter.columns.map((column) => column.source);
  const rows = [headers, adapter.exampleRow];
  return `\uFEFF${rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
    .join("\r\n")}`;
}
