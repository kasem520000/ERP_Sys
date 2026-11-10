import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { resetConfigurationCache } from "../../modules/configuration/application/config-events";
import { findAppliedStateRow } from "../../modules/configuration/application/apply/applied-state.store";
import {
  applyService,
  grantEntitlement,
  provisionBusinessTenant,
  resolver,
  revokeEntitlement,
} from "./template-fixtures";

/**
 * PHASE-015 §6 `dependency-closure.spec` (BR-040; CONFIGURATION_ENGINE §7;
 * industries/README §7 dependency edges): representative closure edges at
 * apply time — an entitlement set that activates `pos.sales` without its
 * `sales.invoices` dependency (FEATURE_CATALOG's edge) is REJECTED with
 * the specific missing chain; a satisfiable set applies. The engine's own
 * resolve-time assertion (resolveFeatureAvailability) fails closed on the
 * same corruption — the apply-time check blocks it earlier, with the
 * chain the guided plan selection needs.
 */

let tenantClosure = "";
let ownerClosure = "";

beforeAll(async () => {
  const provisioned = await provisionBusinessTenant("closure-edge", "industry.retail");
  tenantClosure = provisioned.tenantId;
  ownerClosure = provisioned.ownerId;
  // The adversarial set: pos.sales stays active, its sales.invoices
  // dependency is revoked (a plan-materialization bug shape — BR-040's
  // exact reason to exist).
  await revokeEntitlement(tenantClosure, "sales.invoices");
});

describe("dependency closure at apply time (BR-040, §7)", () => {
  it("rejects the apply when the entitlement set violates closure — the missing chain is named", async () => {
    await expect(
      withTenant(tenantClosure, () =>
        applyService.apply(ownerClosure, { templateKey: "industry.retail", mode: "initial" }),
      ),
    ).rejects.toMatchObject({
      code: "configuration/template-prerequisites-blocked",
      templateKey: "industry.retail",
      // pos.sales → sales.invoices is the violated FEATURE_CATALOG edge;
      // the chain names the exact missing key (BR-040's contract).
      missingChain: expect.arrayContaining(["sales.invoices"]),
    });
    // Nothing was applied (fail closed — no partial state).
    expect(await withTenant(tenantClosure, () => findAppliedStateRow())).toBeUndefined();
  });

  it("the engine itself fails closed on the same corrupted entitlement set", async () => {
    resetConfigurationCache();
    // resolveFeatureAvailability asserts BR-040 closure — the same set that
    // blocked the apply also fails resolution with the typed layer error.
    await expect(
      withTenant(tenantClosure, () => resolver.resolveTenantStatic(tenantClosure)),
    ).rejects.toMatchObject({
      code: "configuration/resolution-failed",
    });
  });

  it("a satisfiable set applies (the closure gap repaired)", async () => {
    await grantEntitlement(tenantClosure, "sales.invoices");
    const result = await withTenant(tenantClosure, () =>
      applyService.apply(ownerClosure, { templateKey: "industry.retail", mode: "initial" }),
    );
    expect(result.applied).toBe(true);
    expect(result.prerequisiteCheck.closureViolations).toEqual([]);

    // And the effective config resolves cleanly with the repaired set.
    resetConfigurationCache();
    const config = await withTenant(tenantClosure, () =>
      resolver.resolveTenantStatic(tenantClosure),
    );
    expect(config.layers.l1_template?.key).toBe("industry.retail");
    expect(config.layers.l4_entitlements.active).toContain("sales.invoices");
    expect(config.layers.l4_entitlements.missing).toEqual([]);
  });
});
