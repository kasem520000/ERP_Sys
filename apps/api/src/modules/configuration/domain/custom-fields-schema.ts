import { z } from "zod";

import {
  CustomFieldConfigInvalidError,
  CustomFieldEntityUnknownError,
  CustomFieldKeyInvalidError,
  CustomFieldValidationMismatchError,
} from "./custom-field-errors";

/**
 * PHASE-036 T3 — the CODE-OWNED custom-field entity registry (ADR-0019):
 * the single list of entities that can carry custom fields. A tenant adds,
 * validates and renders a new field with ZERO code changes, zero migrations,
 * zero deploys; a LATER PHASE registers its new entity into this registry
 * in the same PR (one registry line + the ENTITY_CATALOG row — the
 * ADR-0019 additive rule; the migration 0049 tables deliberately carry NO
 * DB-level entity CHECK so registration never needs a migration).
 *
 * entityType strings follow the sync PULLED_ENTITY_TYPES naming
 * ("partners", "items", "sales_invoices", …) so values ride the feeds'
 * entity vocabulary unchanged.
 *
 * nativeFields drive the form-layout designer: every native field is
 * placeable in a section; `mandatory: true` rows are BR-059-protected
 * (never removable, never reorderable against the canonical order below).
 * The native keys double as the BR-058 native-column blocklist — a custom
 * field key may never collide with a native field name.
 */

export interface CustomFieldNativeField {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string;
  readonly mandatory: boolean;
}

export interface CustomFieldEntityDescriptor {
  readonly entityType: string;
  /** Physical table (REFERENCE existence checks + the orphan-sweep job). */
  readonly table: string;
  readonly label: string;
  readonly labelAr: string;
  readonly nativeFields: readonly CustomFieldNativeField[];
}

const field = (key: string, label: string, labelAr: string, mandatory = false): CustomFieldNativeField => ({
  key,
  label,
  labelAr,
  mandatory,
});

export const CUSTOM_FIELD_ENTITIES: readonly CustomFieldEntityDescriptor[] = [
  {
    entityType: "partners",
    table: "partners",
    label: "Partners",
    labelAr: "العملاء والموردون",
    nativeFields: [
      field("kind", "Kind", "النوع", true),
      field("code", "Code", "الرمز"),
      field("name", "Name", "الاسم", true),
      field("nameAr", "Arabic name", "الاسم بالعربية"),
      field("taxNumber", "Tax number", "الرقم الضريبي"),
      field("creditLimit", "Credit limit", "حد الائتمان"),
      field("creditTermsId", "Credit terms", "شروط الدفع"),
      field("priceListId", "Price list", "قائمة الأسعار"),
      field("status", "Status", "الحالة"),
    ],
  },
  {
    entityType: "items",
    table: "items",
    label: "Items",
    labelAr: "الأصناف",
    nativeFields: [
      field("sku", "SKU", "رمز الصنف", true),
      field("name", "Name", "الاسم", true),
      field("nameAr", "Arabic name", "الاسم بالعربية"),
      field("kind", "Kind", "النوع"),
      field("uomId", "Unit", "وحدة القياس", true),
      field("categoryId", "Category", "التصنيف"),
      field("taxCodeId", "Tax code", "الرمز الضريبي"),
      field("basePrice", "Base price", "السعر الأساسي"),
      field("status", "Status", "الحالة"),
    ],
  },
  {
    entityType: "sales_invoices",
    table: "sales_invoices",
    label: "Sales invoices",
    labelAr: "فواتير البيع",
    nativeFields: [
      field("branchId", "Branch", "الفرع", true),
      field("customerId", "Customer", "العميل", true),
      field("kind", "Type (cash/credit)", "النوع (نقدي/آجل)", true),
      field("invoiceDate", "Invoice date", "تاريخ الفاتورة", true),
      field("currencyCode", "Currency", "العملة", true),
      field("dueDate", "Due date", "تاريخ الاستحقاق"),
      field("note", "Notes", "الملاحظات"),
      field("status", "Status", "الحالة"),
    ],
  },
  {
    entityType: "purchase_orders",
    table: "purchase_orders",
    label: "Purchase orders",
    labelAr: "أوامر الشراء",
    nativeFields: [
      field("branchId", "Branch", "الفرع", true),
      field("supplierId", "Supplier", "المورد", true),
      field("orderDate", "Order date", "تاريخ الأمر", true),
      field("currencyCode", "Currency", "العملة", true),
      field("expectedDate", "Expected date", "تاريخ التوريد المتوقع"),
      field("note", "Notes", "الملاحظات"),
      field("status", "Status", "الحالة"),
    ],
  },
  {
    entityType: "employees",
    table: "employees",
    label: "Employees",
    labelAr: "الموظفون",
    nativeFields: [
      field("code", "Code", "الرمز", true),
      field("name", "Full name", "الاسم الكامل", true),
      field("nameAr", "Arabic name", "الاسم بالعربية"),
      field("nationalId", "National ID", "رقم الهوية"),
      field("hireDate", "Hire date", "تاريخ التعيين", true),
      field("contractType", "Contract type", "نوع العقد", true),
      field("basicSalary", "Basic salary", "الراتب الأساسي", true),
      field("salaryStructureId", "Salary structure", "هيكل الراتب"),
      field("branchId", "Branch", "الفرع"),
      field("costCenterId", "Cost center", "مركز التكلفة"),
      field("projectId", "Project", "المشروع"),
      field("status", "Status", "الحالة"),
    ],
  },
  {
    entityType: "projects",
    table: "projects",
    label: "Projects",
    labelAr: "المشاريع",
    nativeFields: [
      field("code", "Code", "الرمز", true),
      field("name", "Name", "الاسم", true),
      field("nameAr", "Arabic name", "الاسم بالعربية"),
      field("parentId", "Parent project", "المشروع الأب"),
      field("status", "Status", "الحالة"),
    ],
  },
];

const ENTITY_BY_TYPE = new Map(CUSTOM_FIELD_ENTITIES.map((row) => [row.entityType, row]));

export function customFieldEntity(entityType: string): CustomFieldEntityDescriptor {
  const descriptor = ENTITY_BY_TYPE.get(entityType);
  if (descriptor === undefined) {
    throw new CustomFieldEntityUnknownError(entityType);
  }
  return descriptor;
}

export function isCustomFieldEntity(entityType: string): boolean {
  return ENTITY_BY_TYPE.has(entityType);
}

/** BR-058 reserved stems — never valid custom-field keys on ANY entity. */
const RESERVED_KEY_STEMS: readonly string[] = [
  "id",
  "tenant_id",
  "tenantid",
  "created_at",
  "createdat",
  "updated_at",
  "updatedat",
  "version",
  "created_by",
  "createdby",
  "deleted_at",
  "deletedat",
  "status",
  "customfields",
  "custom_fields",
];

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** BR-058: the namespace discipline — snake_case syntax, the reserved
 *  stems, and the entity's native-column blocklist (a custom key can never
 *  shadow a native field, so future native columns are checked against the
 *  registry at design time — the ADR-0019 rule documented in
 *  DATA_DICTIONARY §15). */
export function assertCustomFieldKeyValid(entityType: string, key: string): void {
  const descriptor = customFieldEntity(entityType);
  if (!KEY_PATTERN.test(key)) {
    throw new CustomFieldKeyInvalidError(
      key,
      "keys are lowercase snake_case (letters, digits, underscore; max 64 chars, leading letter)",
    );
  }
  if (RESERVED_KEY_STEMS.includes(key)) {
    throw new CustomFieldKeyInvalidError(key, "the stem is reserved by the platform");
  }
  if (descriptor.nativeFields.some((field) => field.key === key)) {
    throw new CustomFieldKeyInvalidError(
      key,
      `the key collides with a native ${entityType} field (BR-058 blocklist)`,
    );
  }
}

// -- data types + config (FD-18; BR-057 typed columns) -------------------------

export const CUSTOM_FIELD_DATA_TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTISELECT",
  "REFERENCE",
] as const;

export type CustomFieldDataType = (typeof CUSTOM_FIELD_DATA_TYPES)[number];

export interface CustomFieldConfig {
  /** REFERENCE: the target entity (must itself be a registry entity). */
  readonly referenceEntity?: string;
  /** SELECT/MULTISELECT: the bound picklist id. */
  readonly picklistId?: string;
  /** NUMBER: the display precision (0–6, default 2 — storage is numeric 19,6). */
  readonly precision?: number;
}

const configSchema = z
  .object({
    referenceEntity: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
    picklistId: z.string().uuid().optional(),
    precision: z.number().int().min(0).max(6).optional(),
  })
  .strict();

// -- definition payloads --------------------------------------------------------

export const definitionCreateSchema = z
  .object({
    entityType: z.string().min(1).max(64),
    key: z.string().min(1).max(64),
    label: z.string().min(1).max(100),
    labelAr: z.string().min(1).max(100),
    dataType: z.enum(CUSTOM_FIELD_DATA_TYPES),
    config: configSchema.optional(),
    required: z.boolean().optional(),
    validationRegex: z.string().min(1).max(500).nullish(),
    minValue: z.number().finite().nullish(),
    maxValue: z.number().finite().nullish(),
    minLength: z.number().int().min(0).max(1000).nullish(),
    maxLength: z.number().int().min(0).max(1000).nullish(),
  })
  .strict();

export type DefinitionCreateInput = z.infer<typeof definitionCreateSchema>;

export const definitionPatchSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    labelAr: z.string().min(1).max(100).optional(),
    config: configSchema.optional(),
    required: z.boolean().optional(),
    validationRegex: z.string().min(1).max(500).nullish(),
    minValue: z.number().finite().nullish(),
    maxValue: z.number().finite().nullish(),
    minLength: z.number().int().min(0).max(1000).nullish(),
    maxLength: z.number().int().min(0).max(1000).nullish(),
  })
  .strict();

export type DefinitionPatchInput = z.infer<typeof definitionPatchSchema>;

/** Service-level rule set (the zod layer covers shape only):
 *  registry membership, BR-058 key validity, per-type config shape and the
 *  validation-rule/data-type matrix. Throws the typed 422 family. */
export function assertDefinitionRules(input: {
  entityType: string;
  key?: string;
  dataType: CustomFieldDataType;
  config?: CustomFieldConfig;
  validationRegex?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
}): void {
  customFieldEntity(input.entityType);
  if (input.key !== undefined) {
    assertCustomFieldKeyValid(input.entityType, input.key);
  }
  const config = input.config ?? {};
  const has = (field: keyof CustomFieldConfig): boolean => config[field] !== undefined;
  switch (input.dataType) {
    case "SELECT":
    case "MULTISELECT":
      if (!has("picklistId")) {
        throw new CustomFieldConfigInvalidError(input.dataType, "picklistId is required");
      }
      if (has("referenceEntity") || has("precision")) {
        throw new CustomFieldConfigInvalidError(
          input.dataType,
          "referenceEntity/precision do not apply to picklist-bound types",
        );
      }
      break;
    case "REFERENCE":
      if (!has("referenceEntity")) {
        throw new CustomFieldConfigInvalidError(input.dataType, "referenceEntity is required");
      }
      if (!isCustomFieldEntity(config.referenceEntity!)) {
        throw new CustomFieldEntityUnknownError(config.referenceEntity!);
      }
      if (has("picklistId") || has("precision")) {
        throw new CustomFieldConfigInvalidError(
          input.dataType,
          "picklistId/precision do not apply to REFERENCE",
        );
      }
      break;
    case "NUMBER":
      if (has("picklistId") || has("referenceEntity")) {
        throw new CustomFieldConfigInvalidError(
          input.dataType,
          "picklistId/referenceEntity do not apply to NUMBER",
        );
      }
      break;
    case "TEXT":
    case "DATE":
    case "BOOLEAN":
      if (has("picklistId") || has("referenceEntity") || has("precision")) {
        throw new CustomFieldConfigInvalidError(
          input.dataType,
          "config entries do not apply to this type",
        );
      }
      break;
  }
  // The validation-rule × data-type matrix: regex/lengths are TEXT-only;
  // min/max are NUMBER-only (DATE bounds ride the zod ISO-date floor).
  const textOnly: Array<[string, unknown]> = [
    ["validationRegex", input.validationRegex],
    ["minLength", input.minLength],
    ["maxLength", input.maxLength],
  ];
  for (const [rule, value] of textOnly) {
    if (value !== undefined && value !== null && input.dataType !== "TEXT") {
      throw new CustomFieldValidationMismatchError(input.dataType, rule);
    }
  }
  for (const rule of ["minValue", "maxValue"] as const) {
    const value = input[rule];
    if (value !== undefined && value !== null && input.dataType !== "NUMBER") {
      throw new CustomFieldValidationMismatchError(input.dataType, rule);
    }
  }
  if (
    input.validationRegex !== undefined &&
    input.validationRegex !== null &&
    input.validationRegex.length > 0
  ) {
    try {
      new RegExp(input.validationRegex);
    } catch {
      throw new CustomFieldConfigInvalidError("TEXT", "validationRegex is not a valid RegExp");
    }
  }
  if (
    input.minValue !== undefined &&
    input.minValue !== null &&
    input.maxValue !== undefined &&
    input.maxValue !== null &&
    input.minValue > input.maxValue
  ) {
    throw new CustomFieldConfigInvalidError("NUMBER", "minValue must be ≤ maxValue");
  }
  if (
    input.minLength !== undefined &&
    input.minLength !== null &&
    input.maxLength !== undefined &&
    input.maxLength !== null &&
    input.minLength > input.maxLength
  ) {
    throw new CustomFieldConfigInvalidError("TEXT", "minLength must be ≤ maxLength");
  }
}

// -- picklists (FD-20) ------------------------------------------------------------

export const picklistCreateSchema = z
  .object({
    key: z.string().min(1).max(64),
    name: z.string().min(1).max(100),
    nameAr: z.string().min(1).max(100),
  })
  .strict();

export type PicklistCreateInput = z.infer<typeof picklistCreateSchema>;

export const picklistPatchSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    nameAr: z.string().min(1).max(100).optional(),
  })
  .strict();

export type PicklistPatchInput = z.infer<typeof picklistPatchSchema>;

export const picklistOptionCreateSchema = z
  .object({
    label: z.string().min(1).max(100),
    labelAr: z.string().min(1).max(100),
    sortOrder: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type PicklistOptionCreateInput = z.infer<typeof picklistOptionCreateSchema>;

export const picklistOptionPatchSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    labelAr: z.string().min(1).max(100).optional(),
    sortOrder: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export type PicklistOptionPatchInput = z.infer<typeof picklistOptionPatchSchema>;

export const picklistReorderSchema = z
  .object({
    optionIds: z.array(z.string().uuid()).min(1).max(200),
  })
  .strict();

// -- form layouts (FD-19/UX-12; BR-059) --------------------------------------------

export interface FormLayoutFieldRef {
  readonly key: string;
  /** true = a custom-field key (definitions registry); false = native. */
  readonly custom: boolean;
}

export interface FormLayoutSection {
  readonly key: string;
  readonly label: string;
  readonly labelAr: string;
  readonly collapsed: boolean;
  readonly columns: number;
  readonly fields: readonly FormLayoutFieldRef[];
}

const formLayoutFieldRefSchema = z
  .object({ key: z.string().min(1).max(64), custom: z.boolean() })
  .strict();

const formLayoutSectionSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    label: z.string().min(1).max(100),
    labelAr: z.string().min(1).max(100),
    collapsed: z.boolean(),
    columns: z.number().int().min(1).max(3),
    fields: z.array(formLayoutFieldRefSchema).max(60),
  })
  .strict();

export const formLayoutUpsertSchema = z
  .object({
    name: z.string().min(1).max(100),
    sections: z.array(formLayoutSectionSchema).min(1).max(12),
  })
  .strict();

export type FormLayoutUpsertInput = z.infer<typeof formLayoutUpsertSchema>;
