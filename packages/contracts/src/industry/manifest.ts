import { z } from "zod";

import { registerContractSchema } from "../registry";

/**
 * Industry-template manifest contracts (PHASE-015 T3) — the zod mirror of the
 * normative JSON Schema in docs/industries/README.md §3. Industries are
 * configuration, never code forks: a manifest selects capabilities, enables
 * modules, overrides terminology, installs navigation, sets workflow policies,
 * proposes numbering and inventory defaults, pins reports, and defines
 * onboarding steps.
 *
 * Mirroring rules (JSON Schema → zod, kept EXACT):
 *   - `additionalProperties: false`  → `.strict()`
 *   - `pattern`                      → `.regex(PATTERN, message)`
 *   - `enum`                         → `z.enum([...])`
 *   - `minItems` / `uniqueItems`     → `.min(n)` + a uniqueness refinement
 *   - `const: false`                 → `z.literal(false)` (templates may NEVER
 *     enable negative stock — INVENTORY_ACCOUNTING §1)
 *   - `propertyNames` patterns/enums → `z.record(keySchema, valueSchema)` /
 *     `z.partialRecord(z.enum(...), valueSchema)` (§$defs.documentType keys —
 *     any subset of the series-bearing document types is valid)
 *
 * `report_defaults[].dashboard` carries a JSON-Schema `default: false`
 * ANNOTATION in §3 — annotations are not validation; the apply service
 * (PHASE-015 T5) materializes the default, this schema stays faithful.
 */
export const INDUSTRY_TEMPLATE_ID_PATTERN = /^industry\.[a-z][a-z0-9_]{2,30}$/;
/** Manifest versions are semantic MAJOR.MINOR.PATCH (§8 versioning rules). */
export const INDUSTRY_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Feature keys follow `module.feature_name` (GLOSSARY + FEATURE_CATALOG §1);
 * the module segment is one of the catalog modules (16 at v1.1 GA + the six
 * stage-9 modules per EXPANSION_REGISTER §D).
 */
const FEATURE_KEY_MODULE_SEGMENT =
  "platform|accounting|partners|items|inventory|sales|purchasing|treasury|tax|reporting|" +
  "crm|manufacturing|distribution|pos|offline|industry|fixed_assets|notes|installments|" +
  "budgeting|payroll|consolidation";

export const INDUSTRY_FEATURE_KEY_PATTERN = new RegExp(
  `^(${FEATURE_KEY_MODULE_SEGMENT})\\.[a-z0-9_]+$`,
);

/** §3 $defs.moduleName — runtime modules per MODULE_BOUNDARIES. */
export const MODULE_NAMES = [
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
  "manufacturing",
  "pos",
  "distribution",
  "configuration",
  "fixed_assets",
  "notes",
  "installments",
  "budgeting",
  "payroll",
  "consolidation",
] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

/** §3 $defs.documentType — document types that may carry a numbering series. */
export const DOCUMENT_TYPES = [
  "quotation",
  "sales_order",
  "delivery_note",
  "sales_invoice",
  "credit_note",
  "receipt",
  "purchase_order",
  "goods_receipt",
  "supplier_invoice",
  "debit_note",
  "payment",
  "stock_transfer",
  "stock_count",
  "production_order",
  "job_card",
  "settlement",
  "contract_invoice",
  "rental_contract",
  "shipment",
  "pos_sale",
  "stock_adjustment",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** §3 $defs.localizedText — bilingual UI text (presentation only). */
export const localizedTextSchema = z.object({ en: z.string(), ar: z.string() }).strict();
export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** §3 $defs.featureKey. */
export const featureKeySchema = z
  .string()
  .regex(
    INDUSTRY_FEATURE_KEY_PATTERN,
    "feature keys follow module.feature_name with a cataloged module segment",
  );

/** §3 $defs.numberingRule — proposed series; jurisdiction packs always win. */
export const numberingRuleSchema = z
  .object({
    prefix: z
      .string()
      .regex(/^[A-Z0-9]{1,8}$/, "numbering prefixes are 1-8 uppercase letters/digits"),
    format: z
      .string()
      .regex(
        /^[A-Za-z0-9{}:-]{3,40}$/,
        "numbering formats use the tokens {yyyy} {yy} {MM} {seq:n} {branch} (3-40 chars)",
      ),
    per_branch: z.boolean(),
    reserve_on_approval: z.boolean(),
  })
  .strict();
export type NumberingRule = z.infer<typeof numberingRuleSchema>;

/**
 * §3 navigation manifest — menu groups + items with entitlement-aware
 * visibility (`feature_key` items hide when the key is unentitled).
 */
const navigationItemSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "navigation item ids are lower_snake_case"),
    label: localizedTextSchema,
    /** Route key or feature-key-prefixed route. */
    target: z.string(),
    feature_key: featureKeySchema.optional(),
  })
  .strict();
export type NavigationItem = z.infer<typeof navigationItemSchema>;

const navigationGroupSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "navigation group ids are lower_snake_case"),
    label: localizedTextSchema,
    order: z.number().int().min(1).optional(),
    items: z
      .array(navigationItemSchema)
      .min(1, "navigation groups must contain at least one item (minItems 1)"),
  })
  .strict();
export type NavigationGroup = z.infer<typeof navigationGroupSchema>;

export const navigationManifestSchema = z
  .object({
    groups: z
      .array(navigationGroupSchema)
      .min(1, "navigation_manifest.groups must contain at least one group (minItems 1)"),
  })
  .strict();
export type NavigationManifest = z.infer<typeof navigationManifestSchema>;

/** §3 workflow_policies — typed policy values (string | number | boolean). */
export type WorkflowPolicyValue = string | number | boolean;

/** §3 terminology_overrides — glossary term key → industry label (EN/AR). */
export const terminologyOverridesSchema = z.record(
  z.string().regex(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/, "term keys are dot-separated lower_snake_case"),
  localizedTextSchema,
);
export type TerminologyOverrides = z.infer<typeof terminologyOverridesSchema>;

/** §3 document_numbering_defaults — keyed by series-bearing document types. */
export const documentNumberingDefaultsSchema = z.partialRecord(
  z.enum(DOCUMENT_TYPES),
  numberingRuleSchema,
);
export type DocumentNumberingDefaults = z.infer<typeof documentNumberingDefaultsSchema>;

/**
 * §3 $defs.inventoryPolicyDefaults — defaults applied to NEWLY created items;
 * existing items only via the explicit conversion wizard (§5 R3).
 * `allow_negative_stock` is `const: false`: templates may never enable it.
 */
export const inventoryPolicyDefaultsSchema = z
  .object({
    costing_method: z.enum(["WAC", "FIFO"]),
    default_track_batch: z.boolean(),
    default_track_expiry: z.boolean(),
    default_track_serial: z.boolean(),
    default_imei_tracking: z.boolean(),
    fefo_picking: z.boolean(),
    allow_negative_stock: z.literal(false, {
      error:
        "templates may never enable negative stock (const false — tenant-level exception only)",
    }),
  })
  .strict();
export type InventoryPolicyDefaults = z.infer<typeof inventoryPolicyDefaultsSchema>;

/** §3 report_defaults — pinned reports + dashboard widgets. */
const reportDefaultSchema = z
  .object({
    report_key: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*\.[a-z0-9_-]+$/,
        "report keys are <report_family>.<report_name> from the shared report registry",
      ),
    pinned: z.boolean(),
    dashboard: z.boolean().optional(),
    default_period: z.enum(["today", "this_week", "this_month", "this_year", "custom"]).optional(),
  })
  .strict();
export type ReportDefault = z.infer<typeof reportDefaultSchema>;

/** §3 onboarding_steps — the bilingual checklist produced at apply time. */
const onboardingStepSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/, "onboarding step ids are lower_snake_case"),
    title: localizedTextSchema,
    required: z.boolean(),
    feature_key: featureKeySchema.optional(),
    hint: localizedTextSchema.optional(),
  })
  .strict();
export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

/** §3 capability_prerequisites — capability id → level, keys, phase gate. */
const capabilityPrerequisiteSchema = z
  .object({
    level: z.enum(["REQUIRED", "OPTIONAL"]),
    feature_keys: z
      .array(featureKeySchema)
      .min(1, "capability feature_keys must contain at least one key (minItems 1)"),
    available_from_phase: z
      .string()
      .regex(/^PHASE-0[0-9]{2}$/, "phase gates have the form PHASE-0NN (e.g. PHASE-016)"),
  })
  .strict();
export type CapabilityPrerequisite = z.infer<typeof capabilityPrerequisiteSchema>;

/**
 * JSON Schema `uniqueItems` — deep structural uniqueness, key-order
 * insensitive (two entries that differ only in key order are duplicates).
 */
function hasUniqueItems(items: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const fingerprint = JSON.stringify(canonicalize(item));
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
  }
  return true;
}

const requiredFeatureKeysSchema = z
  .array(featureKeySchema)
  .min(1, "required_feature_keys must contain at least one key (minItems 1)")
  .refine(hasUniqueItems, {
    message: "required_feature_keys entries must be unique (uniqueItems)",
  });

const defaultModulesEnabledSchema = z.array(z.enum(MODULE_NAMES)).refine(hasUniqueItems, {
  message: "default_modules_enabled entries must be unique (uniqueItems)",
});

const reportDefaultsSchema = z
  .array(reportDefaultSchema)
  .refine(hasUniqueItems, { message: "report_defaults entries must be unique (uniqueItems)" });

const onboardingStepsSchema = z
  .array(onboardingStepSchema)
  .min(3, "onboarding_steps must contain at least 3 steps (minItems 3)")
  .refine(hasUniqueItems, { message: "onboarding_steps entries must be unique (uniqueItems)" });

const workflowPoliciesSchema = z.record(
  z
    .string()
    .regex(
      /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)?$/,
      "workflow policy keys are lower_snake_case (a single dot segment is allowed)",
    ),
  z.union([z.string(), z.number(), z.boolean()]),
);

const capabilityPrerequisitesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/, "capability ids are lower_snake_case"),
  capabilityPrerequisiteSchema,
);

/**
 * The industry template manifest (§3) — the contract between product thinking
 * and the configuration engine. Parsed at registry publish time (fail-closed:
 * no manifest ships or upgrades without passing this schema) and re-hashed at
 * apply time (`applied_manifest_hash`).
 */
export const IndustryTemplateManifestSchema = z
  .object({
    id: z
      .string()
      .regex(
        INDUSTRY_TEMPLATE_ID_PATTERN,
        "manifest ids follow the industry.<key> feature-catalog naming rule and are immutable",
      ),
    name: z.string().min(1).max(80),
    name_ar: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    description_ar: z.string().max(500).optional(),
    version: z.string().regex(INDUSTRY_SEMVER_PATTERN, "manifest versions are MAJOR.MINOR.PATCH"),
    inherits: z
      .string()
      .regex(
        INDUSTRY_TEMPLATE_ID_PATTERN,
        "inherits must reference a base template id (industry.<key>)",
      )
      .optional(),
    required_feature_keys: requiredFeatureKeysSchema,
    default_modules_enabled: defaultModulesEnabledSchema,
    terminology_overrides: terminologyOverridesSchema,
    navigation_manifest: navigationManifestSchema,
    workflow_policies: workflowPoliciesSchema,
    document_numbering_defaults: documentNumberingDefaultsSchema,
    inventory_policy_defaults: inventoryPolicyDefaultsSchema,
    report_defaults: reportDefaultsSchema,
    onboarding_steps: onboardingStepsSchema,
    capability_prerequisites: capabilityPrerequisitesSchema,
  })
  .strict();
export type IndustryTemplateManifest = z.infer<typeof IndustryTemplateManifestSchema>;

/**
 * Thrown when a manifest fails §3 validation — same error style as the rest of
 * @erp/contracts (typed field + name + actionable message).
 */
export class IndustryManifestValidationError extends Error {
  constructor(
    readonly issues: readonly z.core.$ZodIssue[],
    readonly manifestId?: string,
  ) {
    const details = issues
      .map(
        (issue) =>
          `  - ${issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)"}: ${issue.message}`,
      )
      .join("\n");
    super(
      `Industry template manifest${manifestId ? ` '${manifestId}'` : ""} failed schema validation ` +
        `(docs/industries/README.md §3):\n${details}`,
    );
    this.name = "IndustryManifestValidationError";
  }
}

/** Parse an unknown payload as an IndustryTemplateManifest (fail-closed). */
export function parseIndustryTemplateManifest(input: unknown): IndustryTemplateManifest {
  const result = IndustryTemplateManifestSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const manifestId =
    typeof input === "object" &&
    input !== null &&
    typeof (input as { id?: unknown }).id === "string"
      ? (input as { id: string }).id
      : undefined;
  throw new IndustryManifestValidationError(result.error.issues, manifestId);
}

/** Recursively copy `value` with every object's keys sorted (canonical form). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical JSON of a manifest: recursively key-sorted, no whitespace — the
 * byte-stable serialization behind `applied_manifest_hash` (identical content
 * ⇒ identical hash, independent of authoring key order).
 */
export function canonicalManifestJson(manifest: IndustryTemplateManifest): string {
  return JSON.stringify(canonicalize(manifest));
}

/*
 * Deterministic SHA-256 (FIPS 180-4) + UTF-8 encoding, dependency-free.
 *
 * @erp/contracts is consumed by every app — web, desktop, mobile
 * (DEPENDENCY_RULES §3) — so it must not import node:crypto at module scope
 * (that would break browser bundling) and carries no @types/node. The
 * implementation below is the standard algorithm; the test suite cross-checks
 * `hashManifestJson` byte-for-byte against node:crypto on the shipped
 * manifests (Arabic content included) as the oracle.
 */

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Rotate a 32-bit word right by `n` positions. */
const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

function sha256Hex(input: Uint8Array): string {
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  // Padding: 0x80, zero fill, then the 64-bit big-endian bit length.
  const blocks = ((input.length + 8) >> 6) + 1;
  const padded = new Uint8Array(blocks << 6);
  padded.set(input);
  padded[input.length] = 0x80;
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  view.setUint32(padded.length - 8, input.length >>> 29); // high word (bits 32-63)
  view.setUint32(padded.length - 4, (input.length << 3) >>> 0); // low word

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) {
      w[t] = view.getUint32(offset + t * 4);
    }
    for (let t = 16; t < 64; t += 1) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t += 1) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + bigS1 + ch + SHA256_K[t]! + w[t]!) >>> 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigS0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * UTF-8 encoding of a well-formed string. Canonical JSON output is always
 * well-formed (ES2019 JSON.stringify escapes lone surrogates as \uXXXX), so
 * this matches TextEncoder byte-for-byte; a stray lone surrogate — impossible
 * via `canonicalManifestJson` — is encoded as U+FFFD, the WHATWG behavior.
 */
function utf8Bytes(text: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < text.length;) {
    let codePoint = text.charCodeAt(i);
    i += 1;
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i < text.length) {
      const low = text.charCodeAt(i);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Deterministic content hash of a manifest — `sha256:<hex>` over the canonical
 * JSON. Stored as `applied_manifest_hash` at apply time and compared by the
 * registry drift-detection job (PHASE-015 T4): same content ⇒ same hash,
 * whatever key order authored it.
 */
export function hashManifestJson(manifest: IndustryTemplateManifest): string {
  return `sha256:${sha256Hex(utf8Bytes(canonicalManifestJson(manifest)))}`;
}

/** Register under a stable contract key (ADR-0002 registry). */
registerContractSchema("industry.template-manifest.v1", IndustryTemplateManifestSchema);
