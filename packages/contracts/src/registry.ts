import type { ZodType } from "zod";

/**
 * Contract schema registry v0 (PHASE-001): machinery only, zero entries at
 * import time. Request/response schemas register here as the API contract
 * source of truth (ADR-0002 rule 1) starting with PHASE-002+ endpoints.
 */

/** Thrown when two schemas claim the same contract key. */
export class ContractKeyConflictError extends Error {
  constructor(readonly key: string) {
    super(`Contract key already registered: ${key}`);
    this.name = "ContractKeyConflictError";
  }
}

/** Thrown when a lookup targets an unregistered contract key. */
export class ContractKeyNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No contract schema registered under: ${key}`);
    this.name = "ContractKeyNotFoundError";
  }
}

const schemas = new Map<string, ZodType>();

/** Register a schema under a stable contract key (fails on duplicates). */
export function registerContractSchema<T extends ZodType>(key: string, schema: T): T {
  if (schemas.has(key)) {
    throw new ContractKeyConflictError(key);
  }
  schemas.set(key, schema);
  return schema;
}

/** Look up a schema by contract key. */
export function getContractSchema(key: string): ZodType {
  const schema = schemas.get(key);
  if (!schema) {
    throw new ContractKeyNotFoundError(key);
  }
  return schema;
}

/** Sorted list of registered keys (empty in v0). */
export function listContractSchemas(): readonly string[] {
  return [...schemas.keys()].sort();
}

/** Test-only: clear the registry between tests. */
export function resetContractRegistryForTests(): void {
  schemas.clear();
}
