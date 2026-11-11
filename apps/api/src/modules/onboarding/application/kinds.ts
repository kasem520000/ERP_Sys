/**
 * PHASE-040 import-kind catalog (§2.1): the SEVEN new kinds, their canonical
 * columns (EN + AR aliases — the header auto-detect contract), typed row
 * rules, and file-level checks. Pure data + pure functions — NO database
 * access here; reference resolution lives in the engine's resolver (batched,
 * cached) and application in the per-kind appliers.
 *
 * Error vocabulary: every issue carries {en, ar} — the wizard renders both
 * and the exportable error report is bilingual (acceptance 2).
 */

export type ImportKind =
  | "COA"
  | "ACCOUNT_OPENING_BALANCES"
  | "FIXED_ASSETS"
  | "EMPLOYEES"
  | "PRICE_LISTS"
  | "CONTRACTS"
  | "BUDGETS";

export const IMPORT_KINDS: readonly ImportKind[] = [
  "COA",
  "ACCOUNT_OPENING_BALANCES",
  "FIXED_ASSETS",
  "EMPLOYEES",
  "PRICE_LISTS",
  "CONTRACTS",
  "BUDGETS",
];

export type ColumnType = "text" | "enum" | "decimal" | "integer" | "date" | "boolean";

export interface ColumnSpec {
  /** Canonical field name (the mapping's target vocabulary). */
  readonly name: string;
  readonly label: { readonly en: string; readonly ar: string };
  /** Header aliases (normalized keys — see normalizeHeader). */
  readonly aliases: readonly string[];
  readonly required: boolean;
  readonly type: ColumnType;
  /** For enum columns: the accepted raw values (EN + AR). */
  readonly enumValues?: readonly string[];
  readonly pii?: boolean;
}

export interface KindSpec {
  readonly kind: ImportKind;
  readonly label: { readonly en: string; readonly ar: string };
  readonly description: { readonly en: string; readonly ar: string };
  readonly columns: readonly ColumnSpec[];
  /** Accepted file formats (BUDGETS rides the PHASE-028 XLSX grid). */
  readonly formats: readonly ("CSV" | "XLSX")[];
  /** Options required at job creation (validated by the engine). */
  readonly requiredOptions?: readonly string[];
  /** The grid kinds bypass column mapping (positional PHASE-028 contract). */
  readonly gridFormat?: boolean;
  /** The natural-key columns for duplicate detection (in-file + db). */
  readonly naturalKey: readonly string[];
  /** Row-level typed rules (pure). */
  readonly validateRow: (values: Record<string, string>, issues: RowIssue[]) => void;
  /** File-level checks (balanced-by-nature, cycles, list-shape consistency). */
  readonly validateFile?: (rows: ValidatedRow[], issues: FileIssue[]) => void;
}

export interface RowIssue {
  readonly field: string;
  readonly en: string;
  readonly ar: string;
}

export interface FileIssue {
  readonly en: string;
  readonly ar: string;
}

/** A row that passed shape validation (references resolve separately). */
export interface ValidatedRow {
  readonly rowNo: number;
  readonly values: Record<string, string>;
}

// -- shared helpers -------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_RE = /^-?\d+(\.\d{1,6})?$/;
const POSITIVE_MONEY_RE = /^\d+(\.\d{1,4})?$/;
const INT_RE = /^\d+$/;

export function parseBool(raw: string): boolean | null {
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "نعم"].includes(normalized)) return true;
  if (["0", "false", "no", "لا"].includes(normalized)) return false;
  return null;
}

function issue(field: string, en: string, ar: string): RowIssue {
  return { field, en, ar };
}

const ACCOUNT_TYPES: Readonly<Record<string, string>> = {
  asset: "ASSET",
  assets: "ASSET",
  الأصول: "ASSET",
  أصول: "ASSET",
  liability: "LIABILITY",
  liabilities: "LIABILITY",
  الالتزامات: "LIABILITY",
  التزامات: "LIABILITY",
  equity: "EQUITY",
  حقوقالملكية: "EQUITY",
  حقوق_الملكية: "EQUITY",
  revenue: "REVENUE",
  revenues: "REVENUE",
  الإيرادات: "REVENUE",
  إيرادات: "REVENUE",
  expense: "EXPENSE",
  expenses: "EXPENSE",
  المصروفات: "EXPENSE",
  مصروفات: "EXPENSE",
};

export function normalizeAccountType(raw: string): string | null {
  return ACCOUNT_TYPES[raw.trim().toLowerCase().replace(/[\s_-]+/g, "")] ?? null;
}

// -- COA -------------------------------------------------------------------------

const COA: KindSpec = {
  kind: "COA",
  label: { en: "Chart of Accounts", ar: "دليل الحسابات" },
  description: {
    en: "Accounts with type, parent and postable-leaf shape (tree rules V3/V5)",
    ar: "الحسابات بالنوع والأب وشكل الورقة القابلة للترحيل (قواعد الشجرة)",
  },
  formats: ["CSV", "XLSX"],
  naturalKey: ["code"],
  columns: [
    { name: "code", label: { en: "Account Code", ar: "رمز الحساب" }, aliases: ["code", "accountcode", "رقمالحساب", "رمزالحساب", "الكود"], required: true, type: "text" },
    { name: "name", label: { en: "Account Name", ar: "اسم الحساب" }, aliases: ["name", "accountname", "اسمالحساب", "الاسم"], required: true, type: "text" },
    { name: "name_ar", label: { en: "Account Name (AR)", ar: "الاسم العربي" }, aliases: ["namear", "accountnamear", "الاسمالعربي", "اسمعربي"], required: false, type: "text" },
    { name: "type", label: { en: "Account Type", ar: "نوع الحساب" }, aliases: ["type", "accounttype", "نوعالحساب", "النوع"], required: true, type: "enum", enumValues: ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "أصول", "التزامات", "حقوق ملكية", "إيرادات", "مصروفات"] },
    { name: "parent_code", label: { en: "Parent Account Code", ar: "رمز الحساب الأب" }, aliases: ["parentcode", "parent", "parentaccountcode", "الحسابالأب", "رمزالأب"], required: false, type: "text" },
    { name: "currency", label: { en: "Currency", ar: "العملة" }, aliases: ["currency", "currencycode", "العملة"], required: false, type: "text" },
    { name: "is_group", label: { en: "Is Group", ar: "مجموعة" }, aliases: ["isgroup", "group", "مجموعة", "حسابمجموعة"], required: false, type: "boolean" },
  ],
  validateRow(values, issues) {
    const code = values["code"] ?? "";
    if (code === "" || code.length > 20) {
      issues.push(issue("code", "account code is required (1–20 chars)", "رمز الحساب مطلوب (١–٢٠ حرفاً)"));
    }
    const name = values["name"] ?? "";
    if (name === "" || name.length > 200) {
      issues.push(issue("name", "account name is required (1–200 chars)", "اسم الحساب مطلوب (١–٢٠٠ حرفاً)"));
    }
    const type = values["type"] ?? "";
    if (type === "" || normalizeAccountType(type) === null) {
      issues.push(
        issue("type", "type must be ASSET, LIABILITY, EQUITY, REVENUE or EXPENSE", "النوع يجب أن يكون أصول أو التزامات أو حقوق ملكية أو إيرادات أو مصروفات"),
      );
    }
    const parentCode = values["parent_code"] ?? "";
    if (parentCode !== "" && parentCode === code) {
      issues.push(issue("parent_code", "an account cannot be its own parent", "لا يمكن أن يكون الحساب أباً لنفسه"));
    }
    const currency = values["currency"] ?? "";
    if (currency !== "" && !/^[A-Za-z]{3}$/.test(currency)) {
      issues.push(issue("currency", "currency must be a 3-letter code", "العملة يجب أن تكون رمزاً من ثلاثة أحرف"));
    }
    if ((values["is_group"] ?? "") !== "" && parseBool(values["is_group"] ?? "") === null) {
      issues.push(issue("is_group", "is_group must be true/false (نعم/لا)", "قيمة المجموعة يجب أن تكون نعم/لا"));
    }
  },
  validateFile(rows, issues) {
    // In-file parent references: the parent's type must match; no cycles;
    // a parent that carries children must be a group (V5).
    const byCode = new Map<string, { type: string | null; parent: string }>();
    for (const row of rows) {
      byCode.set(row.values["code"] ?? "", {
        type: normalizeAccountType(row.values["type"] ?? ""),
        parent: row.values["parent_code"] ?? "",
      });
    }
    for (const row of rows) {
      const code = row.values["code"] ?? "";
      const parentCode = row.values["parent_code"] ?? "";
      if (parentCode === "") continue;
      const parent = byCode.get(parentCode);
      if (parent !== undefined) {
        const type = normalizeAccountType(row.values["type"] ?? "");
        if (parent.type !== null && type !== null && parent.type !== type) {
          issues.push({
            en: `row ${row.rowNo}: account ${code} (${type}) cannot nest under ${parentCode} (${parent.type}) — trees stay homogeneous (V3)`,
            ar: `الصف ${row.rowNo}: لا يمكن للحساب ${code} (${type}) أن يتفرع من ${parentCode} (${parent.type}) — الشجرة متجانسة`,
          });
        }
      }
    }
    // Cycle detection: walk parent chains with a visit set.
    for (const row of rows) {
      const start = row.values["code"] ?? "";
      let cursor = row.values["parent_code"] ?? "";
      const seen = new Set<string>([start]);
      while (cursor !== "" && byCode.has(cursor)) {
        if (seen.has(cursor)) {
          issues.push({
            en: `row ${row.rowNo}: account ${start} sits in a parent cycle`,
            ar: `الصف ${row.rowNo}: الحساب ${start} داخل دورة أبوتية`,
          });
          break;
        }
        seen.add(cursor);
        cursor = byCode.get(cursor)?.parent ?? "";
      }
    }
    // A parent declared as a postable leaf in the same file would be rejected
    // by the service (V5): surface it at dry-run.
    const parentsReferenced = new Set(
      rows.map((row) => row.values["parent_code"] ?? "").filter((parent) => parent !== ""),
    );
    for (const row of rows) {
      const code = row.values["code"] ?? "";
      if (parentsReferenced.has(code) && parseBool(row.values["is_group"] ?? "") === false) {
        issues.push({
          en: `row ${row.rowNo}: account ${code} carries children but declares is_group=false — parents must be groups (V5)`,
          ar: `الصف ${row.rowNo}: الحساب ${code} له حسابات فرعية لكنه غير معلن كمجموعة — الأب يجب أن يكون مجموعة`,
        });
      }
    }
  },
};

// -- ACCOUNT_OPENING_BALANCES ----------------------------------------------------

const ACCOUNT_OPENING_BALANCES: KindSpec = {
  kind: "ACCOUNT_OPENING_BALANCES",
  label: { en: "Account Opening Balances", ar: "الأرصدة الافتتاحية للحسابات" },
  description: {
    en: "Trial-balance shaped opening balances — balanced by nature, landing through the opening engine",
    ar: "أرصدة افتتاحية على شكل ميزان مراجعة — متوازنة بالطبيعة وتهبط عبر محرك الأرصدة الافتتاحية",
  },
  formats: ["CSV", "XLSX"],
  naturalKey: ["account_code"],
  columns: [
    { name: "account_code", label: { en: "Account Code", ar: "رمز الحساب" }, aliases: ["accountcode", "code", "رقمالحساب", "رمزالحساب"], required: true, type: "text" },
    { name: "account_name", label: { en: "Account Name (informational)", ar: "اسم الحساب (استرشادي)" }, aliases: ["accountname", "name", "اسمالحساب", "الاسم"], required: false, type: "text" },
    { name: "debit", label: { en: "Debit", ar: "مدين" }, aliases: ["debit", "مدين"], required: false, type: "decimal" },
    { name: "credit", label: { en: "Credit", ar: "دائن" }, aliases: ["credit", "دائن"], required: false, type: "decimal" },
    { name: "note", label: { en: "Note", ar: "ملاحظة" }, aliases: ["note", "ملاحظة"], required: false, type: "text" },
  ],
  validateRow(values, issues) {
    const accountCode = values["account_code"] ?? "";
    if (accountCode === "") {
      issues.push(issue("account_code", "account code is required", "رمز الحساب مطلوب"));
    }
    const debit = values["debit"] ?? "";
    const credit = values["credit"] ?? "";
    const debitOk = debit === "" || POSITIVE_MONEY_RE.test(debit);
    const creditOk = credit === "" || POSITIVE_MONEY_RE.test(credit);
    if (!debitOk) {
      issues.push(issue("debit", "debit must be a non-negative decimal (≤ 4dp)", "المدين يجب أن يكون عدداً غير سالب (٤ منازل كحد أقصى)"));
    }
    if (!creditOk) {
      issues.push(issue("credit", "credit must be a non-negative decimal (≤ 4dp)", "الدائن يجب أن يكون عدداً غير سالب (٤ منازل كحد أقصى)"));
    }
    if (debitOk && creditOk && debit !== "" && credit !== "" && Number(debit) > 0 && Number(credit) > 0) {
      issues.push(issue("debit", "a row carries debit OR credit, never both", "الصف يحمل مدين أو دائن وليس كليهما"));
    }
    if (debitOk && creditOk && debit === "" && credit === "") {
      issues.push(issue("debit", "a row carries a debit or a credit amount", "الصف يجب أن يحمل مبلغاً مديناً أو دائناً"));
    }
  },
  validateFile(rows, issues) {
    // Balanced by nature: Σdebit = Σcredit exactly (4dp string math).
    let debit = "0";
    let credit = "0";
    for (const row of rows) {
      debit = addMoney(debit, row.values["debit"] ?? "0");
      credit = addMoney(credit, row.values["credit"] ?? "0");
    }
    if (debit !== credit) {
      issues.push({
        en: `the file is not balanced by nature: debits ${debit} ≠ credits ${credit} (difference ${(Number(debit) - Number(credit)).toFixed(4)}) — fix the rows or add the balancing row`,
        ar: `الملف غير متوازن بالطبيعة: المدين ${debit} ≠ الدائن ${credit} — صحّح الصفوف أو أضف صف الموازنة`,
      });
    }
  },
};

function addMoney(a: string, b: string): string {
  const sum = Number(a) + Number(b);
  return sum.toFixed(4);
}

// -- FIXED_ASSETS -----------------------------------------------------------------

const DEPRECIATION_METHODS = ["STRAIGHT_LINE", "DECLINING_BALANCE", "UNITS_OF_PRODUCTION"] as const;

const FIXED_ASSETS: KindSpec = {
  kind: "FIXED_ASSETS",
  label: { en: "Fixed Assets", ar: "الأصول الثابتة" },
  description: {
    en: "Asset register rows with acquisition fields (category, branch, cost, life, method)",
    ar: "سجلات أصول ببيانات الاقتناء (الفئة، الفرع، التكلفة، العمر، الطريقة)",
  },
  formats: ["CSV", "XLSX"],
  naturalKey: ["code"],
  columns: [
    { name: "code", label: { en: "Asset Code", ar: "رمز الأصل" }, aliases: ["code", "assetcode", "رمزالأصل", "الكود"], required: true, type: "text" },
    { name: "name", label: { en: "Asset Name", ar: "اسم الأصل" }, aliases: ["name", "assetname", "اسمالأصل", "الاسم"], required: true, type: "text" },
    { name: "name_ar", label: { en: "Asset Name (AR)", ar: "الاسم العربي" }, aliases: ["namear", "الاسمالعربي", "اسمعربي"], required: true, type: "text" },
    { name: "category_code", label: { en: "Category Code", ar: "رمز الفئة" }, aliases: ["categorycode", "category", "رمزالفئة", "الفئة"], required: true, type: "text" },
    { name: "branch_code", label: { en: "Branch Code", ar: "رمز الفرع" }, aliases: ["branchcode", "branch", "رمزالفرع", "الفرع"], required: true, type: "text" },
    { name: "acquisition_date", label: { en: "Acquisition Date", ar: "تاريخ الشراء" }, aliases: ["acquisitiondate", "purchasedate", "تاريخالشراء", "تاريخالاقتناء"], required: true, type: "date" },
    { name: "cost", label: { en: "Cost", ar: "التكلفة" }, aliases: ["cost", "acquisitioncost", "التكلفة"], required: true, type: "decimal" },
    { name: "salvage_value", label: { en: "Salvage Value", ar: "القيمة التخريدية" }, aliases: ["salvagevalue", "salvage", "القيمةالتخريدية"], required: false, type: "decimal" },
    { name: "opening_accumulated", label: { en: "Opening Accumulated Depreciation", ar: "مجمع الاستهلاك الافتتاحي" }, aliases: ["openingaccumulated", "accumulateddepreciation", "مجمعالاستهلاك"], required: false, type: "decimal" },
    { name: "useful_life_months", label: { en: "Useful Life (months)", ar: "العمر الإنتاجي (أشهر)" }, aliases: ["usefullifemonths", "life", "usefullife", "العمر", "العمرالإنتاجي"], required: false, type: "integer" },
    { name: "depreciation_method", label: { en: "Depreciation Method", ar: "طريقة الاستهلاك" }, aliases: ["depreciationmethod", "method", "طريقةالاستهلاك"], required: false, type: "enum", enumValues: [...DEPRECIATION_METHODS, "خط مستقيم", "قسط متناقص", "وحدات الإنتاج"] },
    { name: "note", label: { en: "Note", ar: "ملاحظة" }, aliases: ["note", "ملاحظة"], required: false, type: "text" },
  ],
  validateRow(values, issues) {
    const code = values["code"] ?? "";
    if (code === "" || code.length > 40) {
      issues.push(issue("code", "asset code is required (1–40 chars)", "رمز الأصل مطلوب (١–٤٠ حرفاً)"));
    }
    if ((values["name"] ?? "") === "") {
      issues.push(issue("name", "asset name (EN) is required", "اسم الأصل بالإنجليزية مطلوب"));
    }
    if ((values["name_ar"] ?? "") === "") {
      issues.push(issue("name_ar", "asset name (AR) is required (bilingual rule §3)", "اسم الأصل بالعربية مطلوب (القاعدة الثنائية)"));
    }
    if ((values["category_code"] ?? "") === "") {
      issues.push(issue("category_code", "category code is required", "رمز الفئة مطلوب"));
    }
    if ((values["branch_code"] ?? "") === "") {
      issues.push(issue("branch_code", "branch code is required", "رمز الفرع مطلوب"));
    }
    const date = values["acquisition_date"] ?? "";
    if (!DATE_RE.test(date)) {
      issues.push(issue("acquisition_date", "acquisition date must be YYYY-MM-DD", "تاريخ الشراء يجب أن يكون بصيغة سنة-شهر-يوم"));
    }
    const cost = values["cost"] ?? "";
    if (cost === "" || !POSITIVE_MONEY_RE.test(cost) || Number(cost) <= 0) {
      issues.push(issue("cost", "cost must be a positive decimal (≤ 4dp)", "التكلفة يجب أن تكون عدداً موجباً"));
    }
    const salvage = values["salvage_value"] ?? "";
    if (salvage !== "" && (!POSITIVE_MONEY_RE.test(salvage) || Number(salvage) > Number(cost || "0"))) {
      issues.push(issue("salvage_value", "salvage must be 0 ≤ salvage ≤ cost", "القيمة التخريدية يجب أن تكون بين صفر والتكلفة"));
    }
    const opening = values["opening_accumulated"] ?? "";
    if (opening !== "" && (!POSITIVE_MONEY_RE.test(opening) || Number(opening) > Math.max(Number(cost || "0") - Number(salvage || "0"), 0))) {
      issues.push(issue("opening_accumulated", "opening accumulated cannot exceed cost − salvage", "مجمع الاستهلاك لا يتجاوز التكلفة ناقص القيمة التخريدية"));
    }
    const life = values["useful_life_months"] ?? "";
    if (life !== "" && (!INT_RE.test(life) || Number(life) < 1 || Number(life) > 1200)) {
      issues.push(issue("useful_life_months", "useful life must be an integer 1–1200 months", "العمر الإنتاجي يجب أن يكون عدداً صحيحاً بين ١ و١٢٠٠ شهراً"));
    }
    const method = values["depreciation_method"] ?? "";
    if (method !== "" && !(DEPRECIATION_METHODS as readonly string[]).includes(method)) {
      issues.push(issue("depreciation_method", `method must be one of ${DEPRECIATION_METHODS.join(" | ")}`, `الطريقة يجب أن تكون إحدى: ${DEPRECIATION_METHODS.join(" | ")}`));
    }
  },
};

// -- EMPLOYEES ----------------------------------------------------------------------

const CONTRACT_TYPES: Readonly<Record<string, string>> = {
  full_time: "FULL_TIME",
  fulltime: "FULL_TIME",
  دوامكامل: "FULL_TIME",
  part_time: "PART_TIME",
  parttime: "PART_TIME",
  دوامجزئي: "PART_TIME",
  contractor: "CONTRACTOR",
  مقاول: "CONTRACTOR",
};

export function normalizeContractType(raw: string): string | null {
  return CONTRACT_TYPES[raw.trim().toLowerCase().replace(/[\s_-]+/g, "")] ?? null;
}

const EMPLOYEES: KindSpec = {
  kind: "EMPLOYEES",
  label: { en: "Employees", ar: "الموظفون" },
  description: {
    en: "Employee master rows under the payroll PII discipline (masked error reports)",
    ar: "سجلات الموظفين وفق انضباط خصوصية الرواتب (تقارير أخطاء مموّهة)",
  },
  formats: ["CSV", "XLSX"],
  naturalKey: ["code"],
  columns: [
    { name: "code", label: { en: "Employee Code", ar: "الرقم الوظيفي" }, aliases: ["code", "employeecode", "الرقمالوظيفي", "الكود"], required: true, type: "text" },
    { name: "name", label: { en: "Full Name", ar: "الاسم الكامل" }, aliases: ["name", "fullname", "الاسم", "الاسمالكامل"], required: true, type: "text" },
    { name: "name_ar", label: { en: "Full Name (AR)", ar: "الاسم بالعربية" }, aliases: ["namear", "الاسمالعربي", "اسمعربي"], required: false, type: "text" },
    { name: "national_id", label: { en: "National ID (PII)", ar: "رقم الهوية (خاص)" }, aliases: ["nationalid", "رقمالهوية", "الهوية"], required: false, type: "text", pii: true },
    { name: "hire_date", label: { en: "Hire Date", ar: "تاريخ التعيين" }, aliases: ["hiredate", "تاريخالتعيين"], required: true, type: "date" },
    { name: "contract_type", label: { en: "Contract Type", ar: "نوع العقد" }, aliases: ["contracttype", "نوعالعقد"], required: true, type: "enum", enumValues: ["FULL_TIME", "PART_TIME", "CONTRACTOR", "دوام كامل", "دوام جزئي", "مقاول"] },
    { name: "basic_salary", label: { en: "Basic Salary", ar: "الراتب الأساسي" }, aliases: ["basicsalary", "salary", "الراتبالأساسي", "الراتب"], required: true, type: "decimal" },
    { name: "branch_code", label: { en: "Branch Code", ar: "رمز الفرع" }, aliases: ["branchcode", "branch", "رمزالفرع", "الفرع"], required: false, type: "text" },
    { name: "cost_center_code", label: { en: "Cost Center Code", ar: "رمز مركز التكلفة" }, aliases: ["costcentercode", "costcenter", "رمزمركزالتكلفة"], required: false, type: "text" },
    { name: "structure_code", label: { en: "Salary Structure Code", ar: "رمز هيكل الرواتب" }, aliases: ["structurecode", "salarystructure", "رمزهيكلالرواتب"], required: false, type: "text" },
    { name: "bank_name", label: { en: "Bank Name (PII)", ar: "اسم البنك (خاص)" }, aliases: ["bankname", "bank", "اسمالبنك"], required: false, type: "text", pii: true },
    { name: "bank_iban", label: { en: "Bank IBAN (PII)", ar: "الآيبان (خاص)" }, aliases: ["bankiban", "iban", "الآيبان", "ايبان"], required: false, type: "text", pii: true },
    { name: "bank_account", label: { en: "Bank Account (PII)", ar: "الحساب البنكي (خاص)" }, aliases: ["bankaccount", "account", "الحسابالبنكي"], required: false, type: "text", pii: true },
    { name: "note", label: { en: "Note", ar: "ملاحظة" }, aliases: ["note", "ملاحظة"], required: false, type: "text" },
  ],
  validateRow(values, issues) {
    const code = values["code"] ?? "";
    if (code === "" || code.length > 40) {
      issues.push(issue("code", "employee code is required (1–40 chars)", "الرقم الوظيفي مطلوب (١–٤٠ حرفاً)"));
    }
    if ((values["name"] ?? "") === "" || (values["name"] ?? "").length > 200) {
      issues.push(issue("name", "full name is required (1–200 chars)", "الاسم الكامل مطلوب (١–٢٠٠ حرفاً)"));
    }
    if (!DATE_RE.test(values["hire_date"] ?? "")) {
      issues.push(issue("hire_date", "hire date must be YYYY-MM-DD", "تاريخ التعيين يجب أن يكون بصيغة سنة-شهر-يوم"));
    }
    const contractType = values["contract_type"] ?? "";
    if (contractType === "" || normalizeContractType(contractType) === null) {
      issues.push(issue("contract_type", "contract type must be FULL_TIME, PART_TIME or CONTRACTOR", "نوع العقد يجب أن يكون دوام كامل أو دوام جزئي أو مقاول"));
    }
    const salary = values["basic_salary"] ?? "";
    if (salary === "" || !POSITIVE_MONEY_RE.test(salary) || Number(salary) <= 0) {
      issues.push(issue("basic_salary", "basic salary must be a positive decimal", "الراتب الأساسي يجب أن يكون عدداً موجباً"));
    }
    const iban = values["bank_iban"] ?? "";
    if (iban !== "" && !/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(iban)) {
      issues.push(issue("bank_iban", "IBAN shape is 2 letters + 13–32 alphanumerics", "صيغة الآيبان: حرفان ثم ١٣–٣٢ رقماً/حرفاً"));
    }
  },
};

// -- PRICE_LISTS ----------------------------------------------------------------------

const PRICE_LISTS: KindSpec = {
  kind: "PRICE_LISTS",
  label: { en: "Price Lists", ar: "قوائم الأسعار" },
  description: {
    en: "List headers + tiered lines (one row per item tier; the list header rides the first row of its group)",
    ar: "رؤوس القوائم مع سطور الشرائح (صف لكل شريحة صنف؛ رأس القائمة في أول صف من مجموعتها)",
  },
  formats: ["CSV", "XLSX"],
  naturalKey: ["list_code", "item_sku"],
  columns: [
    { name: "list_code", label: { en: "Price List Code", ar: "رمز القائمة" }, aliases: ["listcode", "pricelistcode", "رمزالقائمة", "الكود"], required: true, type: "text" },
    { name: "list_name", label: { en: "Price List Name", ar: "اسم القائمة" }, aliases: ["listname", "pricelistname", "اسمالقائمة", "الاسم"], required: true, type: "text" },
    { name: "list_name_ar", label: { en: "Price List Name (AR)", ar: "الاسم بالعربية" }, aliases: ["listnamear", "الاسمالعربي"], required: false, type: "text" },
    { name: "kind", label: { en: "List Kind", ar: "نوع القائمة" }, aliases: ["kind", "listkind", "النوع", "نوعالقائمة"], required: true, type: "enum", enumValues: ["SALE", "PURCHASE", "بيع", "شراء"] },
    { name: "currency", label: { en: "Currency", ar: "العملة" }, aliases: ["currency", "العملة"], required: false, type: "text" },
    { name: "valid_from", label: { en: "Valid From", ar: "سارٍ من" }, aliases: ["validfrom", "سارٍمن"], required: false, type: "date" },
    { name: "valid_to", label: { en: "Valid To", ar: "سارٍ إلى" }, aliases: ["validto", "سارٍإلى"], required: false, type: "date" },
    { name: "item_sku", label: { en: "Item SKU", ar: "رمز الصنف" }, aliases: ["itemsku", "sku", "رمزالصنف"], required: true, type: "text" },
    { name: "uom_code", label: { en: "UoM Code", ar: "رمز الوحدة" }, aliases: ["uomcode", "uom", "unit", "رمزالوحدة", "الوحدة"], required: false, type: "text" },
    { name: "unit_price", label: { en: "Unit Price", ar: "سعر الوحدة" }, aliases: ["unitprice", "price", "سعرالوحدة", "السعر"], required: true, type: "decimal" },
    { name: "min_qty", label: { en: "Min Qty", ar: "الحد الأدنى للكمية" }, aliases: ["minqty", "minimumqty", "الحدالأدنى", "كمية"], required: false, type: "decimal" },
  ],
  validateRow(values, issues) {
    const listCode = values["list_code"] ?? "";
    if (listCode === "") {
      issues.push(issue("list_code", "price list code is required", "رمز القائمة مطلوب"));
    }
    if ((values["list_name"] ?? "") === "") {
      issues.push(issue("list_name", "price list name is required (on the first row of each list group)", "اسم القائمة مطلوب (في أول صف من كل مجموعة)"));
    }
    const kind = (values["kind"] ?? "").trim().toUpperCase();
    if (kind !== "SALE" && kind !== "PURCHASE") {
      issues.push(issue("kind", "list kind must be SALE or PURCHASE", "نوع القائمة يجب أن يكون بيع أو شراء"));
    }
    const currency = values["currency"] ?? "";
    if (currency !== "" && !/^[A-Za-z]{3}$/.test(currency)) {
      issues.push(issue("currency", "currency must be a 3-letter code", "العملة يجب أن تكون رمزاً من ثلاثة أحرف"));
    }
    const from = values["valid_from"] ?? "";
    const to = values["valid_to"] ?? "";
    if (from !== "" && !DATE_RE.test(from)) {
      issues.push(issue("valid_from", "valid_from must be YYYY-MM-DD", "سارٍ من يجب أن يكون بتاريخ صحيح"));
    }
    if (to !== "" && !DATE_RE.test(to)) {
      issues.push(issue("valid_to", "valid_to must be YYYY-MM-DD", "سارٍ إلى يجب أن يكون بتاريخ صحيح"));
    }
    if (from !== "" && to !== "" && to < from) {
      issues.push(issue("valid_to", "valid_to must not precede valid_from", "سارٍ إلى لا يسبق سارٍ من"));
    }
    if ((values["item_sku"] ?? "") === "") {
      issues.push(issue("item_sku", "item SKU is required", "رمز الصنف مطلوب"));
    }
    const price = values["unit_price"] ?? "";
    if (price === "" || !POSITIVE_MONEY_RE.test(price)) {
      issues.push(issue("unit_price", "unit price must be a non-negative decimal", "سعر الوحدة يجب أن يكون عدداً غير سالب"));
    }
    const minQty = values["min_qty"] ?? "";
    if (minQty !== "" && (!DECIMAL_RE.test(minQty) || Number(minQty) <= 0)) {
      issues.push(issue("min_qty", "min qty must be a positive decimal", "الحد الأدنى للكمية يجب أن يكون عدداً موجباً"));
    }
  },
  validateFile(rows, issues) {
    // Consistency: the same list_code must not declare conflicting names/kinds.
    const meta = new Map<string, { name: string; kind: string }>();
    for (const row of rows) {
      const code = row.values["list_code"] ?? "";
      const name = row.values["list_name"] ?? "";
      const kind = (row.values["kind"] ?? "").trim().toUpperCase();
      const existing = meta.get(code);
      if (existing === undefined) {
        meta.set(code, { name, kind });
        continue;
      }
      if (name !== "" && existing.name !== "" && name !== existing.name) {
        issues.push({
          en: `row ${row.rowNo}: list ${code} declares two names ("${existing.name}" / "${name}")`,
          ar: `الصف ${row.rowNo}: القائمة ${code} تعلن اسمين مختلفين`,
        });
      }
      if (kind !== "" && existing.kind !== "" && kind !== existing.kind) {
        issues.push({
          en: `row ${row.rowNo}: list ${code} declares two kinds (${existing.kind} / ${kind})`,
          ar: `الصف ${row.rowNo}: القائمة ${code} تعلن نوعين مختلفين`,
        });
      }
    }
  },
};

// -- CONTRACTS ------------------------------------------------------------------------

const FEE_MODELS: Readonly<Record<string, string>> = {
  retainer: "RETAINER",
  monthly: "RETAINER",
  شهري: "RETAINER",
  milestone: "MILESTONES",
  milestones: "MILESTONES",
  مراحل: "MILESTONES",
  hourly: "HOURLY",
  بالساعة: "HOURLY",
};

export function normalizeFeeModel(raw: string): string | null {
  return FEE_MODELS[raw.trim().toLowerCase().replace(/[\s_-]+/g, "")] ?? null;
}

const CONTRACTS: KindSpec = {
  kind: "CONTRACTS",
  label: { en: "Service Contracts", ar: "عقود الخدمة" },
  description: {
    en: "CRM service contracts (retainer / milestones / hourly) onto crm.service_contracts",
    ar: "عقود خدمات إدارة العملاء (شهري / مراحل / بالساعة)",
  },
  formats: ["CSV", "XLSX"],
  naturalKey: ["partner_code", "title"],
  columns: [
    { name: "partner_code", label: { en: "Partner Code", ar: "رمز العميل" }, aliases: ["partnercode", "customercode", "رمزالعميل", "الكود"], required: true, type: "text" },
    { name: "title", label: { en: "Contract Title", ar: "عنوان العقد" }, aliases: ["title", "عنوانالعقد", "العنوان"], required: true, type: "text" },
    { name: "title_ar", label: { en: "Contract Title (AR)", ar: "العنوان بالعربية" }, aliases: ["titlear", "العنوانالعربي"], required: false, type: "text" },
    { name: "fee_model", label: { en: "Fee Model", ar: "نموذج الأجور" }, aliases: ["feemodel", "model", "نموذجالأجور", "النموذج"], required: true, type: "enum", enumValues: ["RETAINER", "MILESTONES", "HOURLY", "شهري", "مراحل", "بالساعة"] },
    { name: "start_date", label: { en: "Start Date", ar: "تاريخ البداية" }, aliases: ["startdate", "تاريخالبداية", "من"], required: true, type: "date" },
    { name: "end_date", label: { en: "End Date", ar: "تاريخ النهاية" }, aliases: ["enddate", "تاريخالنهاية", "إلى"], required: true, type: "date" },
    { name: "monthly_amount", label: { en: "Monthly Amount", ar: "المبلغ الشهري" }, aliases: ["monthlyamount", "المبلغالشهري"], required: false, type: "decimal" },
    { name: "project_code", label: { en: "Project Code", ar: "رمز المشروع" }, aliases: ["projectcode", "رمزالمشروع"], required: false, type: "text" },
    { name: "fee_item_sku", label: { en: "Fee Item SKU", ar: "رمز صنف الأجور" }, aliases: ["feeitemsku", "feeitem", "رمزصنفالأجور"], required: false, type: "text" },
    { name: "note", label: { en: "Note", ar: "ملاحظة" }, aliases: ["note", "ملاحظة"], required: false, type: "text" },
  ],
  validateRow(values, issues) {
    if ((values["partner_code"] ?? "") === "") {
      issues.push(issue("partner_code", "partner code is required", "رمز العميل مطلوب"));
    }
    const title = values["title"] ?? "";
    if (title === "" || title.length > 200) {
      issues.push(issue("title", "contract title is required (1–200 chars)", "عنوان العقد مطلوب (١–٢٠٠ حرفاً)"));
    }
    const feeModel = values["fee_model"] ?? "";
    if (feeModel === "" || normalizeFeeModel(feeModel) === null) {
      issues.push(issue("fee_model", "fee model must be RETAINER, MILESTONES or HOURLY", "نموذج الأجور يجب أن يكون شهري أو مراحل أو بالساعة"));
    }
    const start = values["start_date"] ?? "";
    const end = values["end_date"] ?? "";
    if (!DATE_RE.test(start)) {
      issues.push(issue("start_date", "start date must be YYYY-MM-DD", "تاريخ البداية غير صحيح"));
    }
    if (!DATE_RE.test(end)) {
      issues.push(issue("end_date", "end date must be YYYY-MM-DD", "تاريخ النهاية غير صحيح"));
    }
    if (DATE_RE.test(start) && DATE_RE.test(end) && end < start) {
      issues.push(issue("end_date", "end date must not precede the start date", "تاريخ النهاية لا يسبق البداية"));
    }
    const monthly = values["monthly_amount"] ?? "";
    if (monthly !== "" && (!POSITIVE_MONEY_RE.test(monthly) || Number(monthly) <= 0)) {
      issues.push(issue("monthly_amount", "monthly amount must be a positive decimal", "المبلغ الشهري يجب أن يكون عدداً موجباً"));
    }
  },
};

// -- BUDGETS (the PHASE-028 grid contract — no column mapping) --------------------------

const BUDGETS: KindSpec = {
  kind: "BUDGETS",
  label: { en: "Budget Grid", ar: "شبكة الموازنة" },
  description: {
    en: "The PHASE-028 XLSX period grid (3 identity columns + periods; whole-grid replace, DRAFT budgets only)",
    ar: "شبكة فترات الموازنة (ثلاثة أعمدة هوية + الفترات؛ استبدال كامل للشبكة، مسودات فقط)",
  },
  formats: ["XLSX"],
  requiredOptions: ["budgetId"],
  gridFormat: true,
  naturalKey: [],
  columns: [
    { name: "account_code", label: { en: "Account Code", ar: "رمز الحساب" }, aliases: ["accountcode"], required: true, type: "text" },
    { name: "account_name", label: { en: "Account Name (informational)", ar: "اسم الحساب (استرشادي)" }, aliases: ["accountname"], required: false, type: "text" },
    { name: "dimension_code", label: { en: "Dimension Code", ar: "رمز البُعد" }, aliases: ["dimensioncode"], required: false, type: "text" },
  ],
  validateRow() {
    // The grid validates through the PHASE-028 budgeting import service.
  },
};

export const KIND_SPECS: Readonly<Record<ImportKind, KindSpec>> = {
  COA,
  ACCOUNT_OPENING_BALANCES,
  FIXED_ASSETS,
  EMPLOYEES,
  PRICE_LISTS,
  CONTRACTS,
  BUDGETS,
};

export function isImportKind(kind: string): kind is ImportKind {
  return (IMPORT_KINDS as readonly string[]).includes(kind);
}

/**
 * Header auto-detect (the FD-18 wizard step 2): exact alias match first,
 * then a tolerant pass (normalized contains) for common variants. Returns
 * canonical → header text for every column it can place.
 */
export function autoDetectMapping(
  headers: readonly string[],
  kind: ImportKind,
): Record<string, string> {
  const spec = KIND_SPECS[kind];
  const normalized = headers.map((header) => ({ header, key: header.trim().toLowerCase().replace(/[\s_-]+/g, "") }));
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  // Pass 1: exact alias hits.
  for (const column of spec.columns) {
    for (const alias of column.aliases) {
      const hit = normalized.find((entry) => !used.has(entry.header) && entry.key === alias);
      if (hit !== undefined) {
        mapping[column.name] = hit.header;
        used.add(hit.header);
        break;
      }
    }
  }
  // Pass 2: tolerant contains (longest alias wins the header).
  for (const column of spec.columns) {
    if (mapping[column.name] !== undefined) continue;
    let best: { header: string; len: number } | undefined;
    for (const alias of column.aliases) {
      if (alias.length < 4) continue; // short aliases only match exactly
      for (const entry of normalized) {
        if (used.has(entry.header)) continue;
        if (entry.key.includes(alias) || alias.includes(entry.key)) {
          if (best === undefined || alias.length > best.len) {
            best = { header: entry.header, len: alias.length };
          }
        }
      }
    }
    if (best !== undefined) {
      mapping[column.name] = best.header;
      used.add(best.header);
    }
  }
  return mapping;
}
