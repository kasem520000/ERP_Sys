import {
  CustomFieldKeyInvalidError,
  PicklistKeyTakenError,
  PicklistNotFoundError,
  PicklistOrderInvalidError,
  PicklistOptionNotFoundError,
} from "../domain/custom-field-errors";
import {
  type PicklistCreateInput,
  type PicklistOptionCreateInput,
  type PicklistOptionPatchInput,
  type PicklistPatchInput,
} from "../domain/custom-fields-schema";
import * as store from "../infrastructure/custom-fields.store";

/**
 * PHASE-036 T5 — the tenant-managed picklist service (FD-20): list/option
 * CRUD, ordering, and the archive-preserving history law (BR-057):
 * archived options are rejected for NEW values (the value guard's typed
 * 400) while historical ones keep rendering their labels (the read merge
 * resolves labels regardless of status).
 */

export interface PicklistDto extends store.PicklistRow {
  options?: readonly store.PicklistOptionRow[];
}

export async function listPicklists(): Promise<PicklistDto[]> {
  return store.listPicklists();
}

/** The list's options (ACTIVE + ARCHIVED — the editor + history renders). */
export async function listPicklistOptions(
  picklistId: string,
): Promise<readonly store.PicklistOptionRow[]> {
  return store.listPicklistOptions(picklistId);
}

export async function listPicklistWithOptions(id: string): Promise<PicklistDto> {
  const row = await store.findPicklistById(id);
  if (row === undefined) {
    throw new PicklistNotFoundError(id);
  }
  return { ...row, options: await store.listPicklistOptions(id) };
}

const PICKLIST_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export async function createPicklist(
  actorId: string,
  input: PicklistCreateInput,
): Promise<PicklistDto> {
  if (!PICKLIST_KEY_PATTERN.test(input.key)) {
    throw new CustomFieldKeyInvalidError(
      input.key,
      "picklist keys are lowercase snake_case (letters, digits, underscore; max 64 chars)",
    );
  }
  const existing = (await store.listPicklists()).find((row) => row.key === input.key);
  if (existing !== undefined) {
    throw new PicklistKeyTakenError(input.key);
  }
  return store.insertPicklist({
    key: input.key,
    name: input.name,
    nameAr: input.nameAr,
    createdBy: actorId,
  });
}

export async function updatePicklist(
  id: string,
  input: PicklistPatchInput,
): Promise<PicklistDto> {
  const existing = await store.findPicklistById(id);
  if (existing === undefined) {
    throw new PicklistNotFoundError(id);
  }
  const row = await store.updatePicklist(id, input);
  if (row === undefined) {
    throw new PicklistNotFoundError(id);
  }
  return row;
}

export async function archivePicklist(id: string): Promise<PicklistDto> {
  const existing = await store.findPicklistById(id);
  if (existing === undefined) {
    throw new PicklistNotFoundError(id);
  }
  const row = await store.setPicklistStatus(id, "ARCHIVED");
  if (row === undefined) {
    throw new PicklistNotFoundError(id);
  }
  return row;
}

export async function restorePicklist(id: string): Promise<PicklistDto> {
  const existing = await store.findPicklistById(id);
  if (existing === undefined) {
    throw new PicklistNotFoundError(id);
  }
  const row = await store.setPicklistStatus(id, "ACTIVE");
  if (row === undefined) {
    throw new PicklistNotFoundError(id);
  }
  return row;
}

// -- options -------------------------------------------------------------------

export async function addOption(
  actorId: string,
  picklistId: string,
  input: PicklistOptionCreateInput,
): Promise<store.PicklistOptionRow> {
  const picklist = await store.findPicklistById(picklistId);
  if (picklist === undefined) {
    throw new PicklistNotFoundError(picklistId);
  }
  const options = await store.listPicklistOptions(picklistId);
  const next =
    input.sortOrder ?? (options.length === 0 ? 1 : Math.max(...options.map((row) => row.sortOrder)) + 1);
  return store.insertPicklistOption({
    picklistId,
    label: input.label,
    labelAr: input.labelAr,
    sortOrder: next,
    createdBy: actorId,
  });
}

export async function updateOption(
  id: string,
  input: PicklistOptionPatchInput,
): Promise<store.PicklistOptionRow> {
  const existing = await store.findPicklistOptionById(id);
  if (existing === undefined) {
    throw new PicklistOptionNotFoundError(id);
  }
  const row = await store.updatePicklistOption(id, input);
  if (row === undefined) {
    throw new PicklistOptionNotFoundError(id);
  }
  return row;
}

export async function archiveOption(id: string): Promise<store.PicklistOptionRow> {
  const existing = await store.findPicklistOptionById(id);
  if (existing === undefined) {
    throw new PicklistOptionNotFoundError(id);
  }
  const row = await store.setPicklistOptionStatus(id, "ARCHIVED");
  if (row === undefined) {
    throw new PicklistOptionNotFoundError(id);
  }
  return row;
}

export async function restoreOption(id: string): Promise<store.PicklistOptionRow> {
  const existing = await store.findPicklistOptionById(id);
  if (existing === undefined) {
    throw new PicklistOptionNotFoundError(id);
  }
  const row = await store.setPicklistOptionStatus(id, "ACTIVE");
  if (row === undefined) {
    throw new PicklistOptionNotFoundError(id);
  }
  return row;
}

export async function reorderOptions(
  picklistId: string,
  optionIds: readonly string[],
): Promise<readonly store.PicklistOptionRow[]> {
  const picklist = await store.findPicklistById(picklistId);
  if (picklist === undefined) {
    throw new PicklistNotFoundError(picklistId);
  }
  const options = await store.listPicklistOptions(picklistId);
  const known = new Set(options.map((row) => row.id));
  const unknown = optionIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new PicklistOptionNotFoundError(unknown[0]!);
  }
  const activeIds = options.filter((row) => row.status === "ACTIVE").map((row) => row.id);
  const sameSet =
    optionIds.length === activeIds.length && optionIds.every((id) => activeIds.includes(id));
  if (!sameSet) {
    throw new PicklistOrderInvalidError();
  }
  await store.reorderPicklistOptions(picklistId, optionIds);
  return store.listPicklistOptions(picklistId);
}
