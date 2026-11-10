import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  type CustomFieldConfig,
  type CustomFieldDataType,
} from "../domain/custom-fields-schema";

/**
 * PHASE-036 custom-fields data access (DEPENDENCY_RULES §1 infrastructure
 * layer): pure storage inside the ambient tenant transaction, no business
 * rules. RLS confines every statement to the caller's tenant (the A1–A10
 * battery extends to all five 0049 tables — isolation registry +5).
 *
 * The value store is TYPED (ADR-0019): each data_type maps to exactly one
 * column — TEXT/SELECT/REFERENCE → value_text, NUMBER → value_number,
 * DATE → value_date, BOOLEAN → value_boolean, MULTISELECT → value_json
 * (the num_nonnulls=1 row law backs the mapping at the DB level).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("custom-fields access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- definitions ---------------------------------------------------------------

export interface CustomFieldDefinitionRow {
  id: string;
  entityType: string;
  key: string;
  label: string;
  labelAr: string;
  dataType: CustomFieldDataType;
  config: CustomFieldConfig;
  required: boolean;
  validationRegex: string | null;
  minValue: string | null;
  maxValue: string | null;
  minLength: number | null;
  maxLength: number | null;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface DefinitionRecord {
  id: string;
  entity_type: string;
  key: string;
  label: string;
  label_ar: string;
  data_type: string;
  config: unknown;
  required: boolean;
  validation_regex: string | null;
  min_value: string | null;
  max_value: string | null;
  min_length: number | null;
  max_length: number | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapDefinition(row: DefinitionRecord): CustomFieldDefinitionRow {
  return {
    id: row.id,
    entityType: row.entity_type,
    key: row.key,
    label: row.label,
    labelAr: row.label_ar,
    dataType: row.data_type as CustomFieldDataType,
    config: (row.config ?? {}) as CustomFieldConfig,
    required: row.required,
    validationRegex: row.validation_regex,
    minValue: row.min_value,
    maxValue: row.max_value,
    minLength: row.min_length,
    maxLength: row.max_length,
    status: row.status,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function listDefinitions(
  entityType?: string,
  statuses?: readonly string[],
): Promise<CustomFieldDefinitionRow[]> {
  const statusList = statuses ?? ["ACTIVE", "ARCHIVED"];
  const rows = await tenantTx().execute(sql`
    SELECT d.id, d.entity_type, d.key, d.label, d.label_ar, d.data_type, d.config,
           d.required, d.validation_regex, d.min_value, d.max_value,
           d.min_length, d.max_length, d.status, d.version,
           d.created_at, d.updated_at
    FROM custom_field_definitions d
    WHERE (${entityType === undefined}::boolean OR d.entity_type = ${entityType ?? ""})
      AND d.status = ANY(${sql.raw(`ARRAY[${statusList.map((s) => `'${s}'`).join(",")}]::text[]`)})
    ORDER BY d.entity_type, d.key
  `);
  return (rows.rows as unknown as DefinitionRecord[]).map(mapDefinition);
}

export async function findDefinitionById(id: string): Promise<CustomFieldDefinitionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT d.id, d.entity_type, d.key, d.label, d.label_ar, d.data_type, d.config,
           d.required, d.validation_regex, d.min_value, d.max_value,
           d.min_length, d.max_length, d.status, d.version,
           d.created_at, d.updated_at
    FROM custom_field_definitions d
    WHERE d.id = ${id}
  `);
  const row = (rows.rows as unknown as DefinitionRecord[])[0];
  return row === undefined ? undefined : mapDefinition(row);
}

export async function findDefinitionByKey(
  entityType: string,
  key: string,
): Promise<CustomFieldDefinitionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT d.id, d.entity_type, d.key, d.label, d.label_ar, d.data_type, d.config,
           d.required, d.validation_regex, d.min_value, d.max_value,
           d.min_length, d.max_length, d.status, d.version,
           d.created_at, d.updated_at
    FROM custom_field_definitions d
    WHERE d.entity_type = ${entityType} AND d.key = ${key}
  `);
  const row = (rows.rows as unknown as DefinitionRecord[])[0];
  return row === undefined ? undefined : mapDefinition(row);
}

export interface DefinitionInsert {
  entityType: string;
  key: string;
  label: string;
  labelAr: string;
  dataType: CustomFieldDataType;
  config: CustomFieldConfig;
  required: boolean;
  validationRegex: string | null;
  minValue: number | null;
  maxValue: number | null;
  minLength: number | null;
  maxLength: number | null;
  createdBy: string | null;
}

export async function insertDefinition(input: DefinitionInsert): Promise<CustomFieldDefinitionRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO custom_field_definitions
      (id, tenant_id, created_by, entity_type, key, label, label_ar, data_type, config,
       required, validation_regex, min_value, max_value, min_length, max_length, status)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy},
            ${input.entityType}, ${input.key}, ${input.label}, ${input.labelAr}, ${input.dataType},
            ${JSON.stringify(input.config)}::jsonb, ${input.required}, ${input.validationRegex},
            ${input.minValue}, ${input.maxValue}, ${input.minLength}, ${input.maxLength}, 'ACTIVE')
  `);
  const row = await findDefinitionById(id);
  if (row === undefined) {
    throw new Error("custom field definition insert did not read back");
  }
  return row;
}

export interface DefinitionUpdate {
  label?: string;
  labelAr?: string;
  config?: CustomFieldConfig;
  required?: boolean;
  validationRegex?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
}

export async function updateDefinition(
  id: string,
  patch: DefinitionUpdate,
): Promise<CustomFieldDefinitionRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE custom_field_definitions SET
      label = COALESCE(${patch.label ?? null}, label),
      label_ar = COALESCE(${patch.labelAr ?? null}, label_ar),
      config = COALESCE(${patch.config === undefined ? null : JSON.stringify(patch.config)}::jsonb, config),
      required = COALESCE(${patch.required ?? null}, required),
      validation_regex = COALESCE(${patch.validationRegex ?? null}, validation_regex),
      min_value = COALESCE(${patch.minValue ?? null}, min_value),
      max_value = COALESCE(${patch.maxValue ?? null}, max_value),
      min_length = COALESCE(${patch.minLength ?? null}, min_length),
      max_length = COALESCE(${patch.maxLength ?? null}, max_length),
      version = version + 1,
      updated_at = now()
    WHERE id = ${id}
  `);
  return findDefinitionById(id);
}

export async function setDefinitionStatus(
  id: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<CustomFieldDefinitionRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE custom_field_definitions
    SET status = ${status}, version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
  return findDefinitionById(id);
}

// -- picklists -------------------------------------------------------------------

export interface PicklistRow {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  status: string;
  optionCount: number;
  version: number;
}

export async function listPicklists(): Promise<PicklistRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT p.id, p.key, p.name, p.name_ar, p.status, p.version,
           (SELECT count(*)::int FROM custom_picklist_options o
             WHERE o.picklist_id = p.id AND o.tenant_id = p.tenant_id) AS option_count
    FROM custom_picklists p
    ORDER BY p.key
  `);
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    key: row.key as string,
    name: row.name as string,
    nameAr: row.name_ar as string,
    status: row.status as string,
    optionCount: row.option_count as number,
    version: row.version as number,
  }));
}

export async function findPicklistById(id: string): Promise<PicklistRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT p.id, p.key, p.name, p.name_ar, p.status, p.version,
           (SELECT count(*)::int FROM custom_picklist_options o
             WHERE o.picklist_id = p.id AND o.tenant_id = p.tenant_id) AS option_count
    FROM custom_picklists p
    WHERE p.id = ${id}
  `);
  const row = (rows.rows as unknown as Array<Record<string, unknown>>)[0];
  return row === undefined
    ? undefined
    : {
        id: row.id as string,
        key: row.key as string,
        name: row.name as string,
        nameAr: row.name_ar as string,
        status: row.status as string,
        optionCount: row.option_count as number,
        version: row.version as number,
      };
}

export async function insertPicklist(input: {
  key: string;
  name: string;
  nameAr: string;
  createdBy: string | null;
}): Promise<PicklistRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO custom_picklists (id, tenant_id, created_by, key, name, name_ar, status)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy},
            ${input.key}, ${input.name}, ${input.nameAr}, 'ACTIVE')
  `);
  const row = await findPicklistById(id);
  if (row === undefined) {
    throw new Error("picklist insert did not read back");
  }
  return row;
}

export async function updatePicklist(
  id: string,
  patch: { name?: string; nameAr?: string },
): Promise<PicklistRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE custom_picklists SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = COALESCE(${patch.nameAr ?? null}, name_ar),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
  return findPicklistById(id);
}

export async function setPicklistStatus(
  id: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<PicklistRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE custom_picklists SET status = ${status}, version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
  return findPicklistById(id);
}

// -- picklist options --------------------------------------------------------------

export interface PicklistOptionRow {
  id: string;
  picklistId: string;
  label: string;
  labelAr: string;
  sortOrder: number;
  status: string;
}

interface OptionRecord {
  id: string;
  picklist_id: string;
  label: string;
  label_ar: string;
  sort_order: number;
  status: string;
}

function mapOption(row: OptionRecord): PicklistOptionRow {
  return {
    id: row.id,
    picklistId: row.picklist_id,
    label: row.label,
    labelAr: row.label_ar,
    sortOrder: row.sort_order,
    status: row.status,
  };
}

export async function listPicklistOptions(picklistId: string): Promise<PicklistOptionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.picklist_id, o.label, o.label_ar, o.sort_order, o.status
    FROM custom_picklist_options o
    WHERE o.picklist_id = ${picklistId}
    ORDER BY o.sort_order, o.id
  `);
  return (rows.rows as unknown as OptionRecord[]).map(mapOption);
}

export async function listActiveOptionsForPicklists(
  picklistIds: readonly string[],
): Promise<PicklistOptionRow[]> {
  if (picklistIds.length === 0) {
    return [];
  }
  const idList = sql.join(
    picklistIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.picklist_id, o.label, o.label_ar, o.sort_order, o.status
    FROM custom_picklist_options o
    WHERE o.picklist_id IN (${idList}) AND o.status = 'ACTIVE'
    ORDER BY o.sort_order, o.id
  `);
  return (rows.rows as unknown as OptionRecord[]).map(mapOption);
}

export async function findPicklistOptionById(
  id: string,
): Promise<PicklistOptionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.picklist_id, o.label, o.label_ar, o.sort_order, o.status
    FROM custom_picklist_options o
    WHERE o.id = ${id}
  `);
  const row = (rows.rows as unknown as OptionRecord[])[0];
  return row === undefined ? undefined : mapOption(row);
}

export async function insertPicklistOption(input: {
  picklistId: string;
  label: string;
  labelAr: string;
  sortOrder: number;
  createdBy: string | null;
}): Promise<PicklistOptionRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO custom_picklist_options
      (id, tenant_id, created_by, picklist_id, label, label_ar, sort_order, status)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy},
            ${input.picklistId}, ${input.label}, ${input.labelAr}, ${input.sortOrder}, 'ACTIVE')
  `);
  const row = await findPicklistOptionById(id);
  if (row === undefined) {
    throw new Error("picklist option insert did not read back");
  }
  return row;
}

export async function updatePicklistOption(
  id: string,
  patch: { label?: string; labelAr?: string; sortOrder?: number },
): Promise<PicklistOptionRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE custom_picklist_options SET
      label = COALESCE(${patch.label ?? null}, label),
      label_ar = COALESCE(${patch.labelAr ?? null}, label_ar),
      sort_order = COALESCE(${patch.sortOrder ?? null}, sort_order),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
  return findPicklistOptionById(id);
}

export async function setPicklistOptionStatus(
  id: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<PicklistOptionRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE custom_picklist_options SET status = ${status}, version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
  return findPicklistOptionById(id);
}

/** Reorder: renumbers the given option ids to 1..N in the payload order
 *  (the uq (tenant, list, sort_order) law stays satisfied — conflicting
 *  renumbers resolve by first nulling the affected rows). */
export async function reorderPicklistOptions(
  picklistId: string,
  optionIds: readonly string[],
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE custom_picklist_options SET sort_order = NULL, version = version + 1, updated_at = now()
    WHERE picklist_id = ${picklistId} AND status = 'ACTIVE'
  `);
  for (let index = 0; index < optionIds.length; index += 1) {
    await tenantTx().execute(sql`
      UPDATE custom_picklist_options
      SET sort_order = ${index + 1}, version = version + 1, updated_at = now()
      WHERE id = ${optionIds[index]} AND picklist_id = ${picklistId}
    `);
  }
}

// -- the typed value store (T4; ADR-0019) -----------------------------------------

export interface StoredCustomFieldValue {
  fieldId: string;
  fieldKey: string;
  dataType: CustomFieldDataType;
  entityId: string;
  valueText: string | null;
  valueNumber: string | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: string | null;
}

interface ValueRecord {
  field_id: string;
  field_key: string;
  data_type: string;
  entity_id: string;
  value_text: string | null;
  value_number: string | null;
  value_date: string | null;
  value_boolean: boolean | null;
  value_json: string | null;
}

const VALUE_SELECT = sql`
  SELECT v.field_id, d.key AS field_key, d.data_type, v.entity_id,
         v.value_text, v.value_number, v.value_date, v.value_boolean, v.value_json
  FROM custom_field_values v
  JOIN custom_field_definitions d
    ON d.id = v.field_id AND d.tenant_id = v.tenant_id
`;

function mapValue(row: ValueRecord): StoredCustomFieldValue {
  return {
    fieldId: row.field_id,
    fieldKey: row.field_key,
    dataType: row.data_type as CustomFieldDataType,
    entityId: row.entity_id,
    valueText: row.value_text,
    valueNumber: row.value_number,
    valueDate: row.value_date,
    valueBoolean: row.value_boolean,
    // node-pg parses jsonb columns to JS values; normalize to the wire
    // string so consumers always see ONE shape (JSON.parse-able).
    valueJson:
      typeof row.value_json === "string"
        ? row.value_json
        : row.value_json === null || row.value_json === undefined
          ? null
          : JSON.stringify(row.value_json),
  };
}

/** All definitions (ACTIVE + ARCHIVED — the guard needs both: ACTIVE
 *  validates writes, ARCHIVED rejects them typed) for one entity type. */
export async function listDefinitionsForGuard(
  entityType: string,
): Promise<CustomFieldDefinitionRow[]> {
  return listDefinitions(entityType, ["ACTIVE", "ARCHIVED"]);
}

export async function findValuesForEntity(
  entityType: string,
  entityId: string,
): Promise<StoredCustomFieldValue[]> {
  const rows = await tenantTx().execute(sql`
    ${VALUE_SELECT}
    WHERE v.entity_type = ${entityType} AND v.entity_id = ${entityId}
  `);
  return (rows.rows as unknown as ValueRecord[]).map(mapValue);
}

export async function findValuesForEntities(
  entityType: string,
  entityIds: readonly string[],
): Promise<StoredCustomFieldValue[]> {
  if (entityIds.length === 0) {
    return [];
  }
  const idList = sql.join(
    entityIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    ${VALUE_SELECT}
    WHERE v.entity_type = ${entityType} AND v.entity_id IN (${idList})
  `);
  return (rows.rows as unknown as ValueRecord[]).map(mapValue);
}

export interface ValueUpsert {
  fieldId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: string | null;
  createdBy: string | null;
}

export async function upsertValue(
  entityType: string,
  entityId: string,
  input: ValueUpsert,
): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO custom_field_values
      (id, tenant_id, created_by, entity_type, entity_id, field_id,
       value_text, value_number, value_date, value_boolean, value_json)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy},
            ${entityType}, ${entityId}, ${input.fieldId},
            ${input.valueText}, ${input.valueNumber}, ${input.valueDate},
            ${input.valueBoolean}, ${input.valueJson === null ? null : sql`${input.valueJson}::jsonb`})
    ON CONFLICT ("tenant_id", "entity_type", "entity_id", "field_id") DO UPDATE SET
      value_text = EXCLUDED.value_text,
      value_number = EXCLUDED.value_number,
      value_date = EXCLUDED.value_date,
      value_boolean = EXCLUDED.value_boolean,
      value_json = EXCLUDED.value_json,
      version = custom_field_values.version + 1,
      updated_at = now()
  `);
}

/** Replace semantics: values whose keys are absent from the payload are
 *  cleared (DELETE grant — data rows, not history). */
export async function deleteValuesExcept(
  entityType: string,
  entityId: string,
  keepFieldIds: readonly string[],
): Promise<void> {
  if (keepFieldIds.length === 0) {
    await tenantTx().execute(sql`
      DELETE FROM custom_field_values
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}
    `);
    return;
  }
  const idList = sql.join(
    keepFieldIds.map((id) => sql`${id}`),
    sql`, `,
  );
  await tenantTx().execute(sql`
    DELETE FROM custom_field_values
    WHERE entity_type = ${entityType} AND entity_id = ${entityId}
      AND field_id NOT IN (${idList})
  `);
}

/** Option-label resolution (history-preserving: ARCHIVED options included). */
export interface OptionLabelRow {
  id: string;
  label: string;
  labelAr: string;
  status: string;
}

export async function findOptionLabels(
  optionIds: readonly string[],
): Promise<OptionLabelRow[]> {
  if (optionIds.length === 0) {
    return [];
  }
  const idList = sql.join(
    optionIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.label, o.label_ar, o.status
    FROM custom_picklist_options o
    WHERE o.id IN (${idList})
  `);
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    label: row.label as string,
    labelAr: row.label_ar as string,
    status: row.status as string,
  }));
}

/** REFERENCE existence check (registry-owned physical table, RLS-scoped). */
export async function referenceExists(table: string, id: string): Promise<boolean> {
  const rows = await tenantTx().execute(
    sql`SELECT 1 AS one FROM ${sql.raw(`"${table}"`)} WHERE id = ${id} LIMIT 1`,
  );
  return rows.rows.length > 0;
}

// -- form layouts (T6; FD-19/UX-12) --------------------------------------------------

export interface FormLayoutRow {
  id: string;
  entityType: string;
  roleKey: string | null;
  name: string;
  sections: unknown;
  status: string;
  version: number;
}

interface LayoutRecord {
  id: string;
  entity_type: string;
  role_key: string | null;
  name: string;
  sections: unknown;
  status: string;
  version: number;
}

function mapLayout(row: LayoutRecord): FormLayoutRow {
  return {
    id: row.id,
    entityType: row.entity_type,
    roleKey: row.role_key,
    name: row.name,
    sections: row.sections,
    status: row.status,
    version: row.version,
  };
}

export async function listFormLayouts(entityType: string): Promise<FormLayoutRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.entity_type, l.role_key, l.name, l.sections, l.status, l.version
    FROM form_layouts l
    WHERE l.entity_type = ${entityType} AND l.status = 'ACTIVE'
    ORDER BY l.role_key NULLS FIRST
  `);
  return (rows.rows as unknown as LayoutRecord[]).map(mapLayout);
}

export async function findFormLayout(
  entityType: string,
  roleKey: string | null,
): Promise<FormLayoutRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.entity_type, l.role_key, l.name, l.sections, l.status, l.version
    FROM form_layouts l
    WHERE l.entity_type = ${entityType} AND l.role_key IS NOT DISTINCT FROM ${roleKey}
      AND l.status = 'ACTIVE'
  `);
  const row = (rows.rows as unknown as LayoutRecord[])[0];
  return row === undefined ? undefined : mapLayout(row);
}

export async function upsertFormLayout(input: {
  entityType: string;
  roleKey: string | null;
  name: string;
  sections: unknown;
  createdBy: string | null;
}): Promise<FormLayoutRow> {
  const existing = await findFormLayout(input.entityType, input.roleKey);
  if (existing === undefined) {
    await tenantTx().execute(sql`
      INSERT INTO form_layouts
        (id, tenant_id, created_by, entity_type, role_key, name, sections, status)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy},
              ${input.entityType}, ${input.roleKey}, ${input.name},
              ${JSON.stringify(input.sections)}::jsonb, 'ACTIVE')
    `);
  } else {
    await tenantTx().execute(sql`
      UPDATE form_layouts SET
        name = ${input.name}, sections = ${JSON.stringify(input.sections)}::jsonb,
        version = version + 1, updated_at = now()
      WHERE id = ${existing.id}
    `);
  }
  const row = await findFormLayout(input.entityType, input.roleKey);
  if (row === undefined) {
    throw new Error("form layout upsert did not read back");
  }
  return row;
}

export async function deleteFormLayout(entityType: string, roleKey: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    DELETE FROM form_layouts
    WHERE entity_type = ${entityType} AND role_key = ${roleKey} AND status = 'ACTIVE'
    RETURNING id
  `);
  return rows.rows.length > 0;
}
