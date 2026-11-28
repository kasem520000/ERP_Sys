/**
 * PHASE-052 (W-47 — T-07's rules half, dated 2026-11-27) THE ALERT-RULES
 * FOLD (UX-13 — the configurable threshold/condition rules' own pure
 * normalizer). The settings registry carries the tenant's configured
 * rules under the typed key `workflow.alert_rules` (the envelope's own
 * zod shape at the configuration plane); THIS fold is the workflow
 * domain's own reading — the honest boundary between the two planes:
 *
 *   THE SETTINGS PLANE validates the ENVELOPE (the name, the audience,
 *   the severity, and that the conditions field is a present object) —
 *   the stored value's shape is its own law.
 *
 *   THE WORKFLOW DOMAIN owns the CONDITIONS' one validator (the D-06
 *   fold — evaluateConditions — NEVER a parallel schema, never a second
 *   evaluator): a rule whose conditions are malformed is SKIPPED at
 *   evaluation (the fail-closed direction for a NOTIFICATION plane —
 *   no alert from garbage, never a crash of the emitting request; the
 *   chain-open path's own catch-and-continue law). This fold normalizes
 *   what it can (the envelope's typed members) and drops what it
 *   cannot — the caller never sees a malformed rule.
 *
 * THE RULE SHAPE (the declared interpretation, the honest minimal
 * vocabulary — widenings are dated additive):
 *   - name: the rule's own label (the audit + the inbox payload);
 *   - conditions: the D-06 condition group ({all:[…]} / {any:[…]}) —
 *     evaluated against the ENGINE'S OWN document context (the same
 *     assembly the chain's entry conditions saw — zero parallel
 *     computation);
 *   - audience: "owner" (the tenant owner — the escalation sweep's own
 *     audience precedent) | "creator" (the document's creator — the
 *     person waiting on the chain);
 *   - severity: "info" | "warning" (the inbox row's own class).
 */

/** The typed alert rule (the normalized shape the adapter evaluates). */
export interface WorkflowAlertRule {
  readonly name: string;
  readonly conditions: unknown;
  readonly audience: "owner" | "creator";
  readonly severity: "info" | "warning";
}

const AUDIENCES: ReadonlySet<string> = new Set(["owner", "creator"]);
const SEVERITIES: ReadonlySet<string> = new Set(["info", "warning"]);

/**
 * Normalize the stored settings value into the typed rules —
 * FAIL-CLOSED (the notification plane's own direction): a non-array
 * value reads as NO rules; a rule that is not an object, carries no
 * non-empty name, a present non-object conditions field, an unknown
 * audience, or an unknown severity is DROPPED (the garbage never
 * alerts, never crashes); the defaults: audience "owner", severity
 * "warning" (the escalation family's own shape).
 */
export function normalizeAlertRules(stored: unknown): readonly WorkflowAlertRule[] {
  if (!Array.isArray(stored)) {
    return [];
  }
  const rules: WorkflowAlertRule[] = [];
  for (const candidate of stored) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const name = record.name;
    if (typeof name !== "string" || name.length === 0 || name.length > 200) {
      continue;
    }
    const conditions = record.conditions;
    if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
      continue;
    }
    const rawAudience = record.audience === undefined ? "owner" : record.audience;
    if (typeof rawAudience !== "string" || !AUDIENCES.has(rawAudience)) {
      continue;
    }
    const audience = rawAudience as WorkflowAlertRule["audience"];
    const rawSeverity = record.severity === undefined ? "warning" : record.severity;
    if (typeof rawSeverity !== "string" || !SEVERITIES.has(rawSeverity)) {
      continue;
    }
    const severity = rawSeverity as WorkflowAlertRule["severity"];
    rules.push({
      name,
      conditions,
      audience,
      severity,
    });
  }
  return rules;
}
