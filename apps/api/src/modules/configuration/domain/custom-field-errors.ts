import { DomainError } from "@erp/domain-core";

/**
 * PHASE-036 custom-fields error registry (ERROR_MODEL §4: module-scoped
 * codes are contracts). HTTP mapping in the exception filter:
 *
 *   404  not-founds (A7 parity — unknown == foreign ids, never an
 *        existence disclosure): definitions, picklists, options, layouts;
 *   409  natural-key conflicts (the uq_custom_field_definitions_tenant_
 *        entity_key / uq_custom_picklists_tenant_key law);
 *   400  the VALUE-guard failure packs (the phase's acceptance 3: wrong
 *        type, regex/min/max violations, unknown picklist options,
 *        unknown field keys, writes against ARCHIVED definitions — each a
 *        typed pack with the offending key, zero partial writes);
 *   422  the definition/policy family (entity not in the registry, key
 *        namespace violations, per-type config shape) — the house default.
 */

// -- not-founds (404; A7 parity) ----------------------------------------------

export class CustomFieldNotFoundError extends DomainError {
  constructor(id: string) {
    super("CUSTOM_FIELD_NOT_FOUND", `custom field ${id} does not exist in this tenant`);
  }
}

export class PicklistNotFoundError extends DomainError {
  constructor(id: string) {
    super("PICKLIST_NOT_FOUND", `picklist ${id} does not exist in this tenant`);
  }
}

export class PicklistOptionNotFoundError extends DomainError {
  constructor(id: string) {
    super("PICKLIST_OPTION_NOT_FOUND", `picklist option ${id} does not exist in this tenant`);
  }
}

export class FormLayoutNotFoundError extends DomainError {
  constructor(entityType: string) {
    super(
      "FORM_LAYOUT_NOT_FOUND",
      `no form layout exists for entity ${entityType} in this tenant`,
    );
  }
}

// -- natural-key conflicts (409) ----------------------------------------------

export class CustomFieldKeyTakenError extends DomainError {
  constructor(entityType: string, key: string) {
    super(
      "CUSTOM_FIELD_KEY_TAKEN",
      `custom field key ${key} is already used for entity ${entityType} in this tenant`,
    );
  }
}

export class PicklistKeyTakenError extends DomainError {
  constructor(key: string) {
    super("PICKLIST_KEY_TAKEN", `picklist key ${key} is already used in this tenant`);
  }
}

/** The reorder payload must list exactly the ACTIVE options (no unknown,
 *  no archived, no duplicates — the uq (tenant, list, order) law). */
export class PicklistOrderInvalidError extends DomainError {
  constructor() {
    super(
      "PICKLIST_ORDER_INVALID",
      "reorder must list exactly the picklist's ACTIVE option ids, once each",
    );
  }
}

// -- definition/policy family (422; the house default) -------------------------

/** The entity is not registered in the code-owned entity registry (ADR-0019). */
export class CustomFieldEntityUnknownError extends DomainError {
  constructor(entityType: string) {
    super(
      "CUSTOM_FIELD_ENTITY_UNKNOWN",
      `entity type ${entityType} is not registered for custom fields (ADR-0019 registry)`,
    );
  }
}

/** BR-058: the key violates the namespace discipline (syntax, the reserved
 *  stems, or the entity's native-column blocklist). */
export class CustomFieldKeyInvalidError extends DomainError {
  constructor(key: string, reason: string) {
    super("CUSTOM_FIELD_KEY_INVALID", `custom field key ${key} is invalid: ${reason}`, { key, reason });
  }
}

/** The definition's config does not match its data_type (SELECT without a
 *  picklist binding, REFERENCE without a target entity, …). */
export class CustomFieldConfigInvalidError extends DomainError {
  constructor(dataType: string, reason: string) {
    super(
      "CUSTOM_FIELD_CONFIG_INVALID",
      `config invalid for data type ${dataType}: ${reason}`,
      { dataType, reason },
    );
  }
}

/** A validation rule does not apply to the data type (regex on a NUMBER, …). */
export class CustomFieldValidationMismatchError extends DomainError {
  constructor(dataType: string, rule: string) {
    super(
      "CUSTOM_FIELD_VALIDATION_MISMATCH",
      `validation rule ${rule} does not apply to data type ${dataType}`,
      { dataType, rule },
    );
  }
}

/** The bound picklist is ARCHIVED — new ACTIVE definitions need an ACTIVE list. */
export class PicklistArchivedError extends DomainError {
  constructor(id: string) {
    super("PICKLIST_ARCHIVED", `picklist ${id} is archived`);
  }
}

/** Immutable definition columns (entity_type/key/data_type) cannot change. */
export class CustomFieldImmutableError extends DomainError {
  constructor() {
    super(
      "CUSTOM_FIELD_IMMUTABLE",
      "entity type, key and data type are immutable — archive and create a new field instead",
    );
  }
}

// -- the VALUE guard failure packs (400; acceptance 3) --------------------------

/** A provided key has no definition in this tenant (typo, other tenant, deleted). */
export class CustomFieldUnknownKeyError extends DomainError {
  constructor(key: string) {
    super("CUSTOM_FIELD_UNKNOWN_KEY", `custom field ${key} is not defined for this entity`, { key });
  }
}

/** The definition exists but is ARCHIVED — new/updated values are rejected
 *  while historical ones keep rendering (BR-057 archive semantics). */
export class CustomFieldArchivedError extends DomainError {
  constructor(key: string) {
    super("CUSTOM_FIELD_ARCHIVED", `custom field ${key} is archived — values are read-only`, { key });
  }
}

/** The value failed its typed rule set (wrong type, regex, min/max, length,
 *  unknown picklist option, unknown reference). */
export class CustomFieldValueInvalidError extends DomainError {
  constructor(
    key: string,
    reason: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super("CUSTOM_FIELD_VALUE_INVALID", `custom field ${key}: ${reason}`, {
      key,
      reason,
      ...details,
    });
  }
}

/** A required field was missing/empty in a full-replace payload. */
export class CustomFieldRequiredError extends DomainError {
  constructor(key: string) {
    super("CUSTOM_FIELD_REQUIRED", `custom field ${key} is required`, { key });
  }
}

// -- form layouts (422 family; BR-059) ------------------------------------------

/** BR-059: a mandatory native field was removed, duplicated or reordered. */
export class FormLayoutNativeProtectedError extends DomainError {
  constructor(violation: string) {
    super(
      "FORM_LAYOUT_NATIVE_PROTECTED",
      `form layout violates BR-059 (mandatory native field protection): ${violation}`,
      { violation },
    );
  }
}

/** The sections jsonb failed its shape floor (unknown field keys, bad types). */
export class FormLayoutInvalidError extends DomainError {
  constructor(reason: string) {
    super("FORM_LAYOUT_INVALID", `form layout invalid: ${reason}`, { reason });
  }
}
