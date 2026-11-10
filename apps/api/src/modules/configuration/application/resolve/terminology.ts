import { DomainError } from "@erp/domain-core";
import { localizedTextSchema, terminologyOverridesSchema, type LocalizedText } from "@erp/contracts";

/**
 * Terminology layering runtime (PHASE-015 T1/T8; CONFIGURATION_ENGINE §3
 * "Screen terminology / menus: L1 > platform glossary"; industries/README
 * §5 R2): tenant addition > template override > platform glossary default.
 * Presentation only — glossary meanings and data-model semantics never
 * change (feature `industry.terminology`).
 */

/**
 * Platform glossary defaults for the term keys the shipped manifests
 * override — the rows that exist in docs/GLOSSARY.md, transcribed verbatim:
 *
 * | Term key              | GLOSSARY.md row                                        |
 * |-----------------------|--------------------------------------------------------|
 * | batch.expiry          | "Expiry date | تاريخ الانتهاء"                          |
 * | doc.sales_invoice_pos | "Sales invoice | فاتورة البيع" (the POS document IS a  |
 * |                       |  sales invoice; templates rename it, e.g. "POS sale")   |
 * | inventory.writeoff    | "Shrinkage | الهالك / الفاقد" (write-offs post as       |
 * |                       |  shrinkage per INVENTORY_ACCOUNTING §5; grocery renames |
 * |                       |  to "Write-off | الإعدام")                              |
 *
 * The remaining manifest term keys (pos.table, menu.combo, item.scale_item,
 * …) have no glossary row — a template-less tenant simply does not carry
 * industry language, so those keys resolve only once a template (or a
 * tenant addition) provides them.
 */
export const GLOSSARY_DEFAULTS: Readonly<Record<string, LocalizedText>> = Object.freeze({
  "batch.expiry": Object.freeze({ en: "Expiry date", ar: "تاريخ الانتهاء" }),
  "doc.sales_invoice_pos": Object.freeze({ en: "Sales invoice", ar: "فاتورة البيع" }),
  "inventory.writeoff": Object.freeze({ en: "Shrinkage", ar: "الهالك / الفاقد" }),
});

/** A terminology map failed bilingual-shape validation (fail closed). */
export class InvalidTerminologyError extends DomainError {
  constructor(readonly source: string, message: string) {
    super(
      "configuration/invalid-terminology",
      `Terminology overrides from ${source} are invalid: ${message}`,
      { source },
    );
  }
}

/**
 * Parse an unknown terminology map (jsonb from tenant_industry_config or a
 * manifest section) into the typed form — every value must be a bilingual
 * { en, ar } label; corruption is a typed failure, never a silent drop.
 */
export function parseTerminologyMap(
  source: string,
  input: unknown,
): Readonly<Record<string, LocalizedText>> {
  const result = terminologyOverridesSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new InvalidTerminologyError(
      source,
      issue === undefined ? "schema validation failed" : `${issue.message} at ${issue.path.join(".")}`,
    );
  }
  return result.data;
}

/** Validate a single label (imported manifests re-checked at resolution). */
export function parseLocalizedText(source: string, key: string, input: unknown): LocalizedText {
  const result = localizedTextSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidTerminologyError(source, `term "${key}" must be a bilingual { en, ar } label`);
  }
  return result.data;
}

export interface TerminologyInput {
  /** Platform glossary (GLOSSARY_DEFAULTS unless a caller extends it). */
  readonly glossary?: Readonly<Record<string, LocalizedText>>;
  /** L1: the applied template's terminology_overrides. */
  readonly template?: Readonly<Record<string, LocalizedText>>;
  /** Tenant additions (tenant_industry_config.overrides.terminology). */
  readonly tenantAdditions?: Readonly<Record<string, LocalizedText>>;
}

/**
 * The full effective label map for the tenant: glossary defaults, refined
 * by template overrides, refined by tenant additions. Deterministic — the
 * canonical-JSON hash sorts keys, so authoring order never matters.
 */
export function resolveTerminology(input: TerminologyInput): Record<string, LocalizedText> {
  const merged: Record<string, LocalizedText> = {
    ...(input.glossary ?? GLOSSARY_DEFAULTS),
  };
  for (const [key, label] of Object.entries(input.template ?? {})) {
    merged[key] = parseLocalizedText("template", key, label);
  }
  for (const [key, label] of Object.entries(input.tenantAdditions ?? {})) {
    merged[key] = parseLocalizedText("tenant", key, label);
  }
  return merged;
}
