import { z } from "zod";

import type {
  ReportContract,
  RegistrySnapshotRow,
  ReportCategory,
  DataSourceModule,
} from "../application/contract";
import { ContractValidationError } from "../domain/reporting-errors";

/**
 * PHASE-013 T2 · the code-defined report-contract registry
 * (REPORTING_ARCHITECTURE §2): every contract is a TypeScript module
 * validated at boot against the REPORT_CONTRACT schema — a malformed
 * contract fails startup. Unique id + monotonic version; the snapshot
 * (id, bilingual title, category, permission) drives report navigation
 * and the command menu: a report without a registry entry is invisible
 * by construction.
 */

// ---------------------------------------------------------------------------
// Boot-validation schema (REPORT_CONTRACT §1). `parameters` and `run` are
// validated structurally (a zod schema instance / a function) — the deep
// behavioral checks (provenance, permission existence, phase readiness)
// are cross-checks below.
// ---------------------------------------------------------------------------

const bilingualSchema = z.object({
  ar: z.string().min(1),
  en: z.string().min(1),
});

const CATEGORIES: readonly ReportCategory[] = [
  "financial",
  "ar-ap",
  "sales",
  "purchasing",
  "inventory",
  "treasury",
  "tax",
  "platform",
  "industry",
];

const SOURCE_MODULES: readonly DataSourceModule[] = [
  "accounting",
  "sales",
  "purchasing",
  "inventory",
  "treasury",
  "tax",
  "partners",
  "audit",
  "identity",
  "tenancy",
  "reporting",
  "pos", // PHASE-016: the pos module query surface (Z-report contracts)
  "distribution", // PHASE-017: the distribution query surface (settlements/van stock/routes)
  "manufacturing", // PHASE-018: the manufacturing query surface (production cost/genealogy/QC)
  "crm", // PHASE-019: the CRM query surface (contract revenue schedule / time billing)
  "fixed_assets", // PHASE-026: the fixed_assets query surface (asset register/schedule/movements)
  "notes", // PHASE-027: the notes query surface (maturity calendar / aging / dishonored register)
  "installments", // PHASE-027: the installments query surface (schedule / aging)
  "budgeting", // PHASE-028: the budgeting query surface (budget vs actual / variance analysis)
  "payroll", // PHASE-029: the payroll query surface (register / cost summary / EOS provision)
  "consolidation", // PHASE-034: the consolidation query surface (consolidated TB/IS/BS + eliminations log over the completed run's immutable snapshots)
];

const dataSourceSchema = z.object({
  module: z.enum(SOURCE_MODULES as [DataSourceModule, ...DataSourceModule[]]),
  service: z.string().min(1),
  tables: z.array(z.string().min(1)).min(1),
  purpose: bilingualSchema,
});

/**
 * Report keys: '<domain>.<subject>' in kebab-case (the core catalog,
 * REPORT_CATALOG §1) or snake_case (the industry catalog keys the template
 * manifests pin verbatim — `retail.imei_register`, industries/reports
 * §Catalog; PHASE-015). One separator style per segment run; the domain
 * and subject shapes are otherwise identical.
 */
const REPORT_KEY_PATTERN = /^[a-z0-9]+([_-][a-z0-9]+)*\.[a-z0-9]+([_-][a-z0-9]+)*$/;

const contractShapeSchema = z.object({
  id: z.string().regex(REPORT_KEY_PATTERN, "kebab- or snake-case '<domain>.<subject>'"),
  version: z.number().int().min(1),
  title: bilingualSchema,
  category: z.enum(CATEGORIES as [ReportCategory, ...ReportCategory[]]),
  description: bilingualSchema,
  parameters: z.custom<z.ZodType>((value) => value instanceof z.ZodType, {
    message: "parameters must be a zod schema",
  }),
  scopeRules: z.object({
    tenant: z.literal(true),
    branches: z.enum(["required", "optional", "fixed-all"]),
    warehouses: z.enum(["optional", "required"]).optional(),
    costCenters: z.enum(["optional"]).optional(),
    dateRange: z.enum(["required", "optional"]),
    asOf: z.enum(["required", "optional", "forbidden"]),
  }),
  requiredPermission: z.string().min(1),
  currencyHandling: z.object({
    presentation: z.enum(["base", "document", "both"]),
    method: z.literal("posted-rates"),
  }),
  dataSources: z.array(dataSourceSchema).min(1),
  aggregation: z.object({
    groupBy: z.array(z.string()),
    measures: z
      .array(
        z.object({
          id: z.string().min(1),
          kind: z.enum(["sum", "count", "balance", "derived"]),
          source: z.string().optional(),
          rounding: z.string().optional(),
        }),
      )
      .min(1),
    sorting: z.array(
      z.object({ by: z.string(), dir: z.enum(["asc", "desc"]) }),
    ),
    zeroSuppression: z.enum(["rows", "none"]),
  }),
  totals: z.object({
    rowTotals: z.boolean(),
    grandTotals: z.enum(["sum", "balance-check", "none"]),
    subTotalsByGroup: z.boolean(),
  }),
  drillTargets: z.array(
    z.object({
      from: z.string().min(1),
      route: z.string().min(1),
      label: bilingualSchema,
      permission: z.string().min(1),
    }),
  ),
  exportFormats: z
    .array(z.enum(["pdf", "xlsx", "csv"]))
    .min(1)
    .refine((formats) => new Set(formats).size === formats.length, {
      message: "duplicate export format",
    }),
  printTemplate: z.enum(["a4-report", "a4-document"]).optional(),
  localization: z.object({
    numerals: z.literal("western"),
    direction: z.literal("per-run-locale"),
    labels: z.literal("registry-bilingual"),
  }),
  freshness: z.object({
    semantics: z.enum(["as-of", "current"]),
    cacheTtlSeconds: z.number().int().min(0),
    invalidationEvents: z.array(z.string()),
  }),
  assertions: z.array(
    z.object({
      id: z.string().min(1),
      invariant: z.string().optional(),
      check: z.string().min(1),
      onFailure: z.literal("block-export"),
      message: bilingualSchema,
    }),
  ),
  executionClass: z.enum(["inline", "job"]),
  run: z.custom<(ctx: never, params: never) => Promise<unknown>>(
    (value) => typeof value === "function",
    { message: "run must be the executable derivation" },
  ),
});

/**
 * Data-readiness matrix (REPORT_CATALOG §13): the module → phase that made
 * its query services real. The registry refuses a contract whose declared
 * dataSources belong to a phase beyond PHASE-013's registration window
 * (phases 003–012 delivered; 013 = this engine; later phases = refused).
 */
const MODULE_DATA_PHASE: Readonly<Record<DataSourceModule, number>> = Object.freeze({
  accounting: 7,
  sales: 12,
  purchasing: 11,
  inventory: 10,
  treasury: 8,
  tax: 9,
  partners: 6,
  audit: 3,
  identity: 3,
  tenancy: 4,
  reporting: 13,
  pos: 16, // PHASE-016: the pos query surface (by-terminal/by-hour/shift tie)
  distribution: 17, // PHASE-017: routes/visits/vans/settlements query surfaces
  manufacturing: 18, // PHASE-018: production cost / batch genealogy / QC query surfaces
  crm: 19, // PHASE-019: contract revenue schedule / time billing query surfaces
  fixed_assets: 26, // PHASE-026: asset register / depreciation schedule / movements query surfaces
  notes: 27, // PHASE-027: maturity calendar / aging / dishonored register query surfaces
  installments: 27, // PHASE-027: installment schedule / aging query surfaces
  budgeting: 28, // PHASE-028: budget vs actual / variance analysis query surfaces
  payroll: 29, // PHASE-029: register / cost-summary / eos-provision query surfaces
  consolidation: 34, // PHASE-034: consolidated TB/IS/BS + eliminations log over the completed run's immutable snapshots
});

const REGISTERED_PHASE_WINDOW = 34; // PHASE-013 window, widened by the
// delivering phases that registered contracts over real query surfaces:
// 15 (industry reports) + 16 (the POS set) + 17 (distribution) + 18
// (manufacturing) + 19 (CRM) + 26 (fixed assets) + 27 (notes/installments) +
// 28 (budgeting — see MODULE_DATA_PHASE) + 29 (payroll — see
// MODULE_DATA_PHASE) + 34 (consolidation — see MODULE_DATA_PHASE).

/** Financial reports must carry the §11 minimum assertion set (§16 checklist). */
const FINANCIAL_MINIMUM_ASSERTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "financial.trial-balance": ["tb-debits-equal-credits", "tb-closing-net-zero"],
  "financial.general-ledger": ["gl-entry-balance"],
  "financial.income-statement": ["is-tb-tie"],
  "financial.balance-sheet": ["bs-tb-tie", "bs-current-year-once"],
  "financial.cash-flow": ["cf-cash-tie"],
});

/**
 * Validate one contract (shape + cross-checks). Throws ContractValidationError
 * with the precise reason — the boot path aggregates these into a single
 * startup failure listing every offender.
 */
export function validateContract(contract: ReportContract): void {
  const parsed = contractShapeSchema.safeParse(contract);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new ContractValidationError(
      contract.id ?? "<unknown>",
      `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
  }
  // Cross-check: provenance tables must not be empty per source (§16).
  for (const source of contract.dataSources) {
    if (source.tables.length === 0) {
      throw new ContractValidationError(contract.id, `dataSource ${source.service} has no tables`);
    }
  }
  // Cross-check: phase readiness (§13) — no report before its data phase.
  for (const source of contract.dataSources) {
    const phase = MODULE_DATA_PHASE[source.module];
    if (phase === undefined || phase > REGISTERED_PHASE_WINDOW) {
      throw new ContractValidationError(
        contract.id,
        `dataSource module '${source.module}' is not phase-ready (§13 matrix)`,
      );
    }
  }
  // Cross-check: financial minimum assertion set (FINANCIAL_REPORT_RULES §11).
  const minimum = FINANCIAL_MINIMUM_ASSERTIONS[contract.id];
  if (minimum !== undefined) {
    const declared = new Set(contract.assertions.map((a: { id: string }) => a.id));
    for (const required of minimum) {
      if (!declared.has(required)) {
        throw new ContractValidationError(
          contract.id,
          `financial contract is missing required assertion '${required}' (§11 minimum set)`,
        );
      }
    }
  }
}

export interface RegistryValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly count: number;
}

/**
 * Validate a full set of contracts (boot): shape, unique ids, and — when
 * `options.knownPermissions` is provided — permission existence against the
 * seeded catalog. Returns instead of throwing so the boot path can report
 * every offender at once and the meta-tests can assert failure modes.
 */
export function validateRegistry(
  contracts: readonly ReportContract[],
  options: { knownPermissions?: ReadonlySet<string> } = {},
): RegistryValidationResult {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const contract of contracts) {
    try {
      validateContract(contract);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const previous = seen.get(contract.id);
    if (previous !== undefined) {
      errors.push(`duplicate report id '${contract.id}' (versions ${previous} and ${contract.version})`);
    } else {
      seen.set(contract.id, contract.version);
    }
    if (options.knownPermissions !== undefined) {
      if (!options.knownPermissions.has(contract.requiredPermission)) {
        errors.push(
          `report '${contract.id}' requires unknown permission '${contract.requiredPermission}' (matrix §12 rule)`,
        );
      }
    }
  }
  return { ok: errors.length === 0, errors, count: contracts.length };
}

/** Snapshot for navigation + the command menu (§2.3). */
export function registrySnapshot(
  contracts: readonly ReportContract[],
): readonly RegistrySnapshotRow[] {
  return contracts.map((contract) => ({
    id: contract.id,
    title: contract.title,
    category: contract.category,
    requiredPermission: contract.requiredPermission,
    version: contract.version,
    executionClass: contract.executionClass,
    exportFormats: [...contract.exportFormats],
    semantics: contract.freshness.semantics,
  }));
}

/** Find a contract by id (null-safe lookup used by the runner). */
export function findContract(
  contracts: readonly ReportContract[],
  id: string,
): ReportContract | undefined {
  return contracts.find((contract) => contract.id === id);
}
