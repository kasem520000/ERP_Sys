import { z } from "zod";

import {
  CustomFieldArchivedError,
  CustomFieldKeyTakenError,
  CustomFieldNotFoundError,
  CustomFieldRequiredError,
  CustomFieldUnknownKeyError,
  CustomFieldValueInvalidError,
  PicklistArchivedError,
  PicklistNotFoundError,
} from "../domain/custom-field-errors";
import {
  assertDefinitionRules,
  type CustomFieldConfig,
  type CustomFieldDataType,
  type DefinitionCreateInput,
  type DefinitionPatchInput,
  customFieldEntity,
} from "../domain/custom-fields-schema";
import * as store from "../infrastructure/custom-fields.store";
import type { CustomFieldDefinitionRow } from "../infrastructure/custom-fields.store";

/**
 * PHASE-036 T3/T4 — the custom-field services: the definitions CRUD (BR-058
 * namespace guard + archive semantics) and THE REUSABLE VALUE GUARD every
 * first-wave entity API calls on create/update/read (the mechanism later
 * phases reuse — one import, zero per-entity logic).
 *
 * The guard's write contract (acceptance 3): validate BEFORE the entity
 * insert so every failure path leaves zero partial writes (the 031
 * claim-ref discipline), typed 400 failure packs for wrong type / regex /
 * min-max / unknown picklist option / unknown field key / ARCHIVED
 * definition writes, and full-replace semantics (absent keys clear their
 * values; `customFields === undefined` never touches the store).
 */

// -- definitions (T3) -----------------------------------------------------------

export interface DefinitionDto {
  id: string;
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
  status: string;
  version: number;
  options?: readonly store.PicklistOptionRow[];
}

function toDto(
  row: CustomFieldDefinitionRow,
  options?: readonly store.PicklistOptionRow[],
): DefinitionDto {
  return {
    id: row.id,
    entityType: row.entityType,
    key: row.key,
    label: row.label,
    labelAr: row.labelAr,
    dataType: row.dataType,
    config: row.config,
    required: row.required,
    validationRegex: row.validationRegex,
    minValue: row.minValue === null ? null : Number(row.minValue),
    maxValue: row.maxValue === null ? null : Number(row.maxValue),
    minLength: row.minLength,
    maxLength: row.maxLength,
    status: row.status,
    version: row.version,
    ...(options === undefined ? {} : { options }),
  };
}

async function assertPicklistUsable(picklistId: string): Promise<void> {
  const row = await store.findPicklistById(picklistId);
  if (row === undefined) {
    throw new PicklistNotFoundError(picklistId);
  }
  if (row.status !== "ACTIVE") {
    throw new PicklistArchivedError(picklistId);
  }
}

export async function listDefinitions(
  entityType?: string,
): Promise<DefinitionDto[]> {
  if (entityType !== undefined) {
    customFieldEntity(entityType);
  }
  const rows = await store.listDefinitions(entityType);
  return rows.map((row) => toDto(row));
}

/** The render surface payload (SESSION route): ACTIVE definitions with the
 *  bound picklists' ACTIVE options inlined — what CustomFieldSurface and
 *  the entity form pages consume. */
export async function listSurfaceDefinitions(entityType: string): Promise<DefinitionDto[]> {
  customFieldEntity(entityType);
  const rows = await store.listDefinitions(entityType, ["ACTIVE"]);
  const picklistIds = rows
    .map((row) => row.config.picklistId)
    .filter((id): id is string => id !== undefined);
  const options = await store.listActiveOptionsForPicklists(picklistIds);
  const byPicklist = new Map<string, store.PicklistOptionRow[]>();
  for (const option of options) {
    const list = byPicklist.get(option.picklistId) ?? [];
    list.push(option);
    byPicklist.set(option.picklistId, list);
  }
  return rows.map((row) =>
    toDto(
      row,
      row.config.picklistId === undefined
        ? []
        : (byPicklist.get(row.config.picklistId) ?? []),
    ),
  );
}

export async function createDefinition(
  actorId: string,
  input: DefinitionCreateInput,
): Promise<DefinitionDto> {
  assertDefinitionRules({
    entityType: input.entityType,
    key: input.key,
    dataType: input.dataType,
    config: input.config,
    validationRegex: input.validationRegex ?? null,
    minValue: input.minValue ?? null,
    maxValue: input.maxValue ?? null,
    minLength: input.minLength ?? null,
    maxLength: input.maxLength ?? null,
  });
  if (input.config?.picklistId !== undefined) {
    await assertPicklistUsable(input.config.picklistId);
  }
  const existing = await store.findDefinitionByKey(input.entityType, input.key);
  if (existing !== undefined) {
    throw new CustomFieldKeyTakenError(input.entityType, input.key);
  }
  const row = await store.insertDefinition({
    entityType: input.entityType,
    key: input.key,
    label: input.label,
    labelAr: input.labelAr,
    dataType: input.dataType,
    config: input.config ?? {},
    required: input.required ?? false,
    validationRegex: input.validationRegex ?? null,
    minValue: input.minValue ?? null,
    maxValue: input.maxValue ?? null,
    minLength: input.minLength ?? null,
    maxLength: input.maxLength ?? null,
    createdBy: actorId,
  });
  return toDto(row);
}

export async function updateDefinition(
  actorId: string,
  id: string,
  input: DefinitionPatchInput,
): Promise<DefinitionDto> {
  const existing = await store.findDefinitionById(id);
  if (existing === undefined) {
    throw new CustomFieldNotFoundError(id);
  }
  const mergedConfig: CustomFieldConfig =
    input.config === undefined ? existing.config : input.config;
  assertDefinitionRules({
    entityType: existing.entityType,
    dataType: existing.dataType,
    config: mergedConfig,
    validationRegex:
      input.validationRegex === undefined ? existing.validationRegex : input.validationRegex,
    minValue:
      input.minValue === undefined
        ? existing.minValue === null
          ? null
          : Number(existing.minValue)
        : input.minValue,
    maxValue:
      input.maxValue === undefined
        ? existing.maxValue === null
          ? null
          : Number(existing.maxValue)
        : input.maxValue,
    minLength: input.minLength === undefined ? existing.minLength : input.minLength,
    maxLength: input.maxLength === undefined ? existing.maxLength : input.maxLength,
  });
  if (mergedConfig.picklistId !== undefined) {
    await assertPicklistUsable(mergedConfig.picklistId);
  }
  const row = await store.updateDefinition(id, {
    label: input.label,
    labelAr: input.labelAr,
    config: mergedConfig,
    required: input.required,
    validationRegex: input.validationRegex,
    minValue: input.minValue === undefined ? undefined : input.minValue,
    maxValue: input.maxValue === undefined ? undefined : input.maxValue,
    minLength: input.minLength === undefined ? undefined : input.minLength,
    maxLength: input.maxLength === undefined ? undefined : input.maxLength,
  });
  if (row === undefined) {
    throw new CustomFieldNotFoundError(id);
  }
  void actorId;
  return toDto(row);
}

/** Archive (BR-057): the definition stops validating/accepting NEW values;
 *  historical values keep rendering (the read paths join ARCHIVED rows
 *  too). A no-op on an already-archived row. */
export async function archiveDefinition(id: string): Promise<DefinitionDto> {
  const existing = await store.findDefinitionById(id);
  if (existing === undefined) {
    throw new CustomFieldNotFoundError(id);
  }
  const row = await store.setDefinitionStatus(id, "ARCHIVED");
  if (row === undefined) {
    throw new CustomFieldNotFoundError(id);
  }
  return toDto(row);
}

export async function restoreDefinition(id: string): Promise<DefinitionDto> {
  const existing = await store.findDefinitionById(id);
  if (existing === undefined) {
    throw new CustomFieldNotFoundError(id);
  }
  if (existing.config.picklistId !== undefined) {
    await assertPicklistUsable(existing.config.picklistId);
  }
  const row = await store.setDefinitionStatus(id, "ACTIVE");
  if (row === undefined) {
    throw new CustomFieldNotFoundError(id);
  }
  return toDto(row);
}

// -- the reusable VALUE GUARD (T4) ---------------------------------------------

/** The entity payload shape injected into the six first-wave entities'
 *  create/update bodies (zod passthrough-free: one explicit record). */
export const customFieldsPayloadSchema = z.record(z.string(), z.unknown());

export type CustomFieldsPayload = Record<string, unknown>;

export interface CustomFieldValueView {
  value: unknown;
  /** Option labels for SELECT/MULTISELECT (history-preserving: archived
   *  options still resolve their labels). */
  optionLabel?: string;
  optionLabelAr?: string;
}

export type CustomFieldValueMap = Record<string, CustomFieldValueView>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface TypedInput {
  valueText: string | null;
  valueNumber: number | null;
  valueDate: string | null;
  valueBoolean: boolean | null;
  valueJson: string | null;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0);
}

/** Validates ONE value against its definition — the typed 400 pack family
 *  (wrong type, regex, min/max, length, unknown option, bad reference). */
async function validateTypedValue(
  definition: CustomFieldDefinitionRow,
  value: unknown,
): Promise<TypedInput> {
  const { key, dataType } = definition;
  const invalid = (reason: string): never => {
    throw new CustomFieldValueInvalidError(key, reason);
  };
  switch (dataType) {
    case "TEXT": {
      if (typeof value !== "string") {
        invalid("expected a text value");
      }
      const text = value as string;
      if (definition.minLength !== null && text.length < definition.minLength) {
        invalid(`minimum length is ${definition.minLength}`);
      }
      if (definition.maxLength !== null && text.length > definition.maxLength) {
        invalid(`maximum length is ${definition.maxLength}`);
      }
      if (
        definition.validationRegex !== null &&
        definition.validationRegex.length > 0 &&
        !new RegExp(definition.validationRegex).test(text)
      ) {
        invalid(`value does not match the required pattern`);
      }
      return { valueText: text, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: null };
    }
    case "NUMBER": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        invalid("expected a numeric value");
      }
      const number = value as number;
      if (definition.minValue !== null && number < Number(definition.minValue)) {
        invalid(`minimum value is ${Number(definition.minValue)}`);
      }
      if (definition.maxValue !== null && number > Number(definition.maxValue)) {
        invalid(`maximum value is ${Number(definition.maxValue)}`);
      }
      const precision = definition.config.precision;
      const rounded = precision === undefined ? number : Number(number.toFixed(precision));
      return { valueText: null, valueNumber: rounded, valueDate: null, valueBoolean: null, valueJson: null };
    }
    case "DATE": {
      if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
        invalid("expected an ISO date value (YYYY-MM-DD)");
      }
      return { valueText: null, valueNumber: null, valueDate: value as string, valueBoolean: null, valueJson: null };
    }
    case "BOOLEAN": {
      if (typeof value !== "boolean") {
        invalid("expected a boolean value");
      }
      return { valueText: null, valueNumber: null, valueDate: null, valueBoolean: value as boolean, valueJson: null };
    }
    case "SELECT": {
      if (typeof value !== "string") {
        invalid("expected a picklist option id");
      }
      const options = await store.listPicklistOptions(definition.config.picklistId!);
      const option = options.find((row) => row.id === value);
      if (option === undefined) {
        throw new CustomFieldValueInvalidError(key, "unknown picklist option", {
          optionId: value,
        });
      }
      if (option.status !== "ACTIVE") {
        throw new CustomFieldValueInvalidError(key, "picklist option is archived", {
          optionId: value,
        });
      }
      return { valueText: option.id, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: null };
    }
    case "MULTISELECT": {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        invalid("expected an array of picklist option ids");
      }
      const ids = value as string[];
      if (ids.length === 0) {
        invalid("at least one option is required (send an absent/empty key to clear)");
      }
      const options = await store.listPicklistOptions(definition.config.picklistId!);
      for (const id of ids) {
        const option = options.find((row) => row.id === id);
        if (option === undefined) {
          throw new CustomFieldValueInvalidError(key, "unknown picklist option", { optionId: id });
        }
        if (option.status !== "ACTIVE") {
          throw new CustomFieldValueInvalidError(key, "picklist option is archived", { optionId: id });
        }
      }
      if (new Set(ids).size !== ids.length) {
        invalid("duplicate picklist options in the value");
      }
      return {
        valueText: null,
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
        valueJson: JSON.stringify(ids),
      };
    }
    case "REFERENCE": {
      const referenceId: string =
        typeof value === "string" ? value : invalid("expected a reference id (uuid)");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referenceId)) {
        invalid("expected a reference id (uuid)");
      }
      const target = customFieldEntity(definition.config.referenceEntity!);
      const exists = await store.referenceExists(target.table, referenceId);
      if (!exists) {
        throw new CustomFieldValueInvalidError(key, "referenced entity does not exist", {
          referenceEntity: definition.config.referenceEntity,
        });
      }
      return { valueText: referenceId, valueNumber: null, valueDate: null, valueBoolean: null, valueJson: null };
    }
  }
}

export interface ValidatedValues {
  /** The validated (definition, typed-input) pairs to write. */
  readonly writes: ReadonlyArray<{
    definition: CustomFieldDefinitionRow;
    typed: TypedInput;
  }>;
  /** The field ids to KEEP (all keys present in the payload). */
  readonly keepFieldIds: readonly string[];
}

/**
 * THE REUSABLE WRITE GUARD — called BEFORE the entity insert (zero partial
 * writes, the 031 discipline) or before a PATCH's entity update. Full
 * replace semantics: keys absent from the payload are cleared afterwards
 * by {@link persistValues}.
 *
 * Failure family (all typed, all zero-residue):
 *   CUSTOM_FIELD_UNKNOWN_KEY   — no definition for a provided key;
 *   CUSTOM_FIELD_ARCHIVED      — the definition is ARCHIVED (read-only);
 *   CUSTOM_FIELD_REQUIRED      — a required ACTIVE field is missing/empty;
 *   CUSTOM_FIELD_VALUE_INVALID — wrong type / regex / min-max / length /
 *                                unknown or archived option / bad reference.
 */
export async function validateValues(
  entityType: string,
  payload: CustomFieldsPayload,
): Promise<ValidatedValues> {
  const definitions = await store.listDefinitionsForGuard(entityType);
  const byKey = new Map(definitions.map((row) => [row.key, row]));
  const writes: Array<{ definition: CustomFieldDefinitionRow; typed: TypedInput }> = [];
  const keepFieldIds: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    const definition = byKey.get(key);
    if (definition === undefined) {
      throw new CustomFieldUnknownKeyError(key);
    }
    if (definition.status !== "ACTIVE") {
      throw new CustomFieldArchivedError(key);
    }
    if (isEmpty(value)) {
      continue; // explicit clear — required-check runs below
    }
    writes.push({ definition, typed: await validateTypedValue(definition, value) });
    keepFieldIds.push(definition.id);
  }
  for (const definition of definitions) {
    if (definition.status === "ACTIVE" && definition.required) {
      const provided = payload[definition.key];
      if (isEmpty(provided)) {
        throw new CustomFieldRequiredError(definition.key);
      }
    }
  }
  return { writes, keepFieldIds };
}

/** Persists a validated payload (call AFTER the entity write succeeded —
 *  the ambient tenant UoW keeps everything atomic). */
export async function persistValues(
  entityType: string,
  entityId: string,
  actorId: string,
  validated: ValidatedValues,
): Promise<void> {
  await store.deleteValuesExcept(entityType, entityId, validated.keepFieldIds);
  for (const write of validated.writes) {
    await store.upsertValue(entityType, entityId, {
      fieldId: write.definition.id,
      valueText: write.typed.valueText,
      valueNumber: write.typed.valueNumber,
      valueDate: write.typed.valueDate,
      valueBoolean: write.typed.valueBoolean,
      valueJson: write.typed.valueJson,
      createdBy: actorId,
    });
  }
}

// -- the read merge (T7 read side) ------------------------------------------------

function storedToView(
  value: store.StoredCustomFieldValue,
  optionLabels: Map<string, store.OptionLabelRow>,
): CustomFieldValueView {
  switch (value.dataType) {
    case "NUMBER":
      return { value: value.valueNumber === null ? null : Number(value.valueNumber) };
    case "BOOLEAN":
      return { value: value.valueBoolean };
    case "DATE":
      return { value: value.valueDate };
    case "MULTISELECT": {
      const ids = (JSON.parse(value.valueJson ?? "[]") as string[]) ?? [];
      const labels = ids
        .map((id) => optionLabels.get(id))
        .filter((row): row is store.OptionLabelRow => row !== undefined);
      return {
        value: ids,
        optionLabel: labels.map((row) => row.label).join(", "),
        optionLabelAr: labels.map((row) => row.labelAr).join("، "),
      };
    }
    case "SELECT": {
      const option = optionLabels.get(value.valueText ?? "");
      return {
        value: value.valueText,
        optionLabel: option?.label,
        optionLabelAr: option?.labelAr,
      };
    }
    case "REFERENCE":
    case "TEXT":
    default:
      return { value: value.valueText };
  }
}

async function valuesToMap(
  _definitions: readonly CustomFieldDefinitionRow[],
  values: readonly store.StoredCustomFieldValue[],
): Promise<CustomFieldValueMap> {
  const optionIds = new Set<string>();
  for (const value of values) {
    if (value.dataType === "SELECT" && value.valueText !== null) {
      optionIds.add(value.valueText);
    }
    if (value.dataType === "MULTISELECT" && value.valueJson !== null) {
      for (const id of JSON.parse(value.valueJson) as string[]) {
        optionIds.add(id);
      }
    }
  }
  const optionRows = await store.findOptionLabels([...optionIds]);
  const optionLabels = new Map(optionRows.map((row) => [row.id, row]));
  const map: CustomFieldValueMap = {};
  for (const value of values) {
    map[value.fieldKey] = storedToView(value, optionLabels);
  }
  return map;
}

/** Read merge for ONE entity row (the get paths): `row.customFields = …`. */
export async function attachValues<T extends { id: string }>(
  entityType: string,
  row: T,
): Promise<T & { customFields: CustomFieldValueMap }> {
  const definitions = await store.listDefinitionsForGuard(entityType);
  if (definitions.length === 0) {
    return { ...row, customFields: {} }; // the OA-06 fast path: no UDF surface
  }
  const values = await store.findValuesForEntity(entityType, row.id);
  return { ...row, customFields: await valuesToMap(definitions, values) };
}

/** Read merge for a page of entity rows (the list paths): ONE batched
 *  values query + ONE batched option-label query for the whole page. */
export async function mergeValuesInto<T extends { id: string }>(
  entityType: string,
  rows: readonly T[],
): Promise<Array<T & { customFields: CustomFieldValueMap }>> {
  if (rows.length === 0) {
    return rows.map((row) => ({ ...row, customFields: {} }));
  }
  const definitions = await store.listDefinitionsForGuard(entityType);
  if (definitions.length === 0) {
    return rows.map((row) => ({ ...row, customFields: {} })); // OA-06 fast path
  }
  const values = await store.findValuesForEntities(entityType, rows.map((row) => row.id));
  const byEntity = new Map<string, store.StoredCustomFieldValue[]>();
  for (const value of values) {
    const list = byEntity.get(value.entityId) ?? [];
    list.push(value);
    byEntity.set(value.entityId, list);
  }
  const optionIds = new Set<string>();
  for (const value of values) {
    if (value.dataType === "SELECT" && value.valueText !== null) {
      optionIds.add(value.valueText);
    }
    if (value.dataType === "MULTISELECT" && value.valueJson !== null) {
      for (const id of JSON.parse(value.valueJson) as string[]) {
        optionIds.add(id);
      }
    }
  }
  const optionRows = await store.findOptionLabels([...optionIds]);
  const optionLabels = new Map(optionRows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const entityValues = byEntity.get(row.id) ?? [];
    const customFields: CustomFieldValueMap = {};
    for (const value of entityValues) {
      customFields[value.fieldKey] = storedToView(value, optionLabels);
    }
    return { ...row, customFields };
  });
}

/** Raw values for the entity-values read route. */
export async function readValues(
  entityType: string,
  entityId: string,
): Promise<CustomFieldValueMap> {
  const definitions = await store.listDefinitionsForGuard(entityType);
  if (definitions.length === 0) {
    return {};
  }
  const values = await store.findValuesForEntity(entityType, entityId);
  return valuesToMap(definitions, values);
}
