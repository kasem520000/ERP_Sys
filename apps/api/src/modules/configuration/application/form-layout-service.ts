import {
  FormLayoutInvalidError,
  FormLayoutNativeProtectedError,
  FormLayoutNotFoundError,
} from "../domain/custom-field-errors";
import {
  customFieldEntity,
  type FormLayoutSection,
  type FormLayoutUpsertInput,
} from "../domain/custom-fields-schema";
import * as store from "../infrastructure/custom-fields.store";

/**
 * PHASE-036 T6 — the form-layout service (FD-19/UX-12): per-entity designer
 * layouts (sections jsonb) + role overrides, with BR-059: mandatory native
 * fields can never be removed, duplicated, or reordered against the
 * registry's canonical order.
 *
 * The resolution contract for renderers: ask for a role's layout; if the
 * tenant defined an override for that role it wins, else the entity's
 * default layout, else null (the screen renders its built-in native form
 * plus the CustomFieldSurface in its default slot).
 */

export interface FormLayoutDto {
  id: string;
  entityType: string;
  roleKey: string | null;
  name: string;
  sections: readonly FormLayoutSection[];
  version: number;
}

function toDto(row: store.FormLayoutRow): FormLayoutDto {
  return {
    id: row.id,
    entityType: row.entityType,
    roleKey: row.roleKey,
    name: row.name,
    sections: (row.sections ?? []) as readonly FormLayoutSection[],
    version: row.version,
  };
}

export async function listLayouts(entityType: string): Promise<FormLayoutDto[]> {
  customFieldEntity(entityType);
  return (await store.listFormLayouts(entityType)).map(toDto);
}

/** The renderer's resolution: role override → default → null. */
export async function resolveLayout(
  entityType: string,
  roleKey: string | null,
): Promise<FormLayoutDto | null> {
  customFieldEntity(entityType);
  if (roleKey !== null) {
    const override = await store.findFormLayout(entityType, roleKey);
    if (override !== undefined) {
      return toDto(override);
    }
  }
  const fallback = await store.findFormLayout(entityType, null);
  return fallback === undefined ? null : toDto(fallback);
}

/** BR-059 + the shape floor: every mandatory native field appears EXACTLY
 *  once, in the canonical registry order; native keys are registry-known;
 *  custom keys belong to ACTIVE definitions of the entity (custom fields
 *  may be omitted — an absent custom field simply does not render). */
export function assertLayoutRules(
  entityType: string,
  sections: readonly FormLayoutSection[],
  activeDefinitionKeys: ReadonlySet<string>,
): void {
  const descriptor = customFieldEntity(entityType);
  const seen = new Map<string, { custom: boolean; occurrences: number }>();
  for (const section of sections) {
    for (const fieldRef of section.fields) {
      const entry = seen.get(fieldRef.key);
      if (entry === undefined) {
        seen.set(fieldRef.key, { custom: fieldRef.custom, occurrences: 1 });
      } else {
        entry.occurrences += 1;
      }
    }
  }
  for (const [key, entry] of seen) {
    if (entry.occurrences > 1) {
      throw new FormLayoutInvalidError(`field ${key} appears ${entry.occurrences} times`);
    }
    if (entry.custom) {
      if (!activeDefinitionKeys.has(key)) {
        throw new FormLayoutInvalidError(
          `custom field ${key} is not an ACTIVE definition of ${entityType}`,
        );
      }
    } else if (!descriptor.nativeFields.some((field) => field.key === key)) {
      throw new FormLayoutInvalidError(
        `native field ${key} does not exist on ${entityType} (registry)`,
      );
    }
  }
  // BR-059: mandatory native fields — present exactly once AND their
  // relative order across the flattened layout preserves the canonical
  // registry order.
  const mandatory = descriptor.nativeFields.filter((field) => field.mandatory);
  const flattened = sections.flatMap((section) => section.fields.map((field) => field.key));
  for (const field of mandatory) {
    if ((seen.get(field.key)?.occurrences ?? 0) !== 1) {
      throw new FormLayoutNativeProtectedError(
        `mandatory native field ${field.key} must appear exactly once`,
      );
    }
  }
  const ordered = mandatory
    .map((field) => flattened.indexOf(field.key))
    .filter((index) => index >= 0);
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index]! <= ordered[index - 1]!) {
      throw new FormLayoutNativeProtectedError(
        `mandatory native fields must keep their canonical order (${mandatory
          .map((field) => field.key)
          .join(" → ")})`,
      );
    }
  }
}

async function activeKeys(entityType: string): Promise<Set<string>> {
  const rows = await store.listDefinitions(entityType, ["ACTIVE"]);
  return new Set(rows.map((row) => row.key));
}

export async function upsertLayout(
  actorId: string,
  entityType: string,
  roleKey: string | null,
  input: FormLayoutUpsertInput,
): Promise<FormLayoutDto> {
  customFieldEntity(entityType);
  assertLayoutRules(entityType, input.sections, await activeKeys(entityType));
  const row = await store.upsertFormLayout({
    entityType,
    roleKey,
    name: input.name,
    sections: input.sections,
    createdBy: actorId,
  });
  return toDto(row);
}

export async function deleteOverride(entityType: string, roleKey: string): Promise<void> {
  customFieldEntity(entityType);
  const deleted = await store.deleteFormLayout(entityType, roleKey);
  if (!deleted) {
    throw new FormLayoutNotFoundError(entityType);
  }
}
