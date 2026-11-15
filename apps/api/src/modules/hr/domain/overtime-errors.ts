import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-06 — the overtime engine) domain errors: the rule/
 * entry shape family, the tier-matching refusals (ambiguity and
 * unavailability — never a silent pick), and the lifecycle conflicts.
 * Codes are stable API contracts; A7-sensitive not-founds render
 * identically for unknown-vs-foreign ids.
 */

export class OvertimeRuleNotFoundError extends DomainError {
  constructor(id: string) {
    super("OVERTIME_RULE_NOT_FOUND", `overtime rule ${id} does not exist in this tenant`);
  }
}
export class OvertimeRuleInvalidError extends DomainError {
  constructor(message: string) {
    super("OVERTIME_RULE_INVALID", message);
  }
}
export class OvertimeRuleInactiveError extends DomainError {
  constructor(id: string) {
    super("OVERTIME_RULE_INACTIVE", `overtime rule ${id} is inactive — reactivate it before recording time under it (HR-03)`);
  }
}
export class OvertimeTierUnavailableError extends DomainError {
  constructor(message: string) {
    super("OVERTIME_TIER_UNAVAILABLE", message);
  }
}
export class OvertimeTierAmbiguousError extends DomainError {
  constructor(message: string) {
    super("OVERTIME_TIER_AMBIGUOUS", message);
  }
}
export class OvertimeEntryInvalidError extends DomainError {
  constructor(message: string) {
    super("OVERTIME_ENTRY_INVALID", message);
  }
}
export class OvertimeEntryNotFoundError extends DomainError {
  constructor(id: string) {
    super("OVERTIME_ENTRY_NOT_FOUND", `overtime entry ${id} does not exist in this tenant`);
  }
}
export class OvertimeEntryResolvedError extends DomainError {
  constructor(id: string, status: string) {
    super(
      "OVERTIME_ENTRY_RESOLVED",
      `overtime entry ${id} is already ${status} — only a PENDING entry can be decided`,
    );
  }
}
