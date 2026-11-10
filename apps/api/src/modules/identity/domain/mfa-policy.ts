/**
 * MFA enforcement policy resolution (PHASE-024 T4; ADR-0015 §4
 * "mandatory-able per role/plan policy later" — this is the "later").
 *
 * Policy model (expand-contract; migration 0036):
 * - PLAN level: `plans.mfa_required_role_keys` — role keys for which a
 *   confirmed TOTP factor is mandatory at login (every seeded plan ships
 *   `[]` = the current opt-in behavior; nothing is forced retroactively).
 * - TENANT level: the `identity.mfa.policy` tenant setting —
 *   `{ mode: "plan" | "custom", required_roles: string[] }`. `mode: "plan"`
 *   (the default) inherits the plan's list; `mode: "custom"` overrides it,
 *   and an explicit empty custom list makes MFA optional for everyone even
 *   when the plan mandates it (the tenant's wall, the tenant's rule).
 *
 * Resolution is TOTAL: unknown roles never mandate (a policy naming a role
 * the tenant doesn't use is inert), and the effective set is always a
 * de-duplicated array of role KEYS matched against the login-selected
 * active membership's role key.
 */

/** The tenant-level policy stored in tenant_settings (`identity.mfa.policy`). */
export interface MfaTenantPolicy {
  readonly mode: "plan" | "custom";
  readonly required_roles: readonly string[];
}

export const MFA_POLICY_PLAN_DEFAULT: MfaTenantPolicy = Object.freeze({
  mode: "plan",
  required_roles: [],
});

export interface MfaPolicySources {
  /** Plan-level mandatory role keys (plans.mfa_required_role_keys). */
  readonly planRequiredRoleKeys: readonly string[];
  /** The tenant's policy setting (undefined = never configured → plan). */
  readonly tenantPolicy: MfaTenantPolicy | undefined;
}

/**
 * Resolve the effective mandatory-role key set. Deterministic, pure, and
 * order-preserving on first occurrence (stable for tests + logs).
 */
export function resolveMfaRequiredRoles(
  sources: MfaPolicySources,
): readonly string[] {
  if (sources.tenantPolicy === undefined || sources.tenantPolicy.mode === "plan") {
    return dedupe(sources.planRequiredRoleKeys);
  }
  return dedupe(sources.tenantPolicy.required_roles);
}

/** Does the policy mandate MFA for a user holding this role key? */
export function mfaRequiredForRole(
  roleKey: string,
  requiredRoles: readonly string[],
): boolean {
  return requiredRoles.includes(roleKey);
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
