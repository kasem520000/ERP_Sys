import { describe, expect, it } from "vitest";

import {
  currentTenantContext,
  requireTenantContext,
  tenantContextStorage,
  MissingTenantContextError,
} from "./tenant-context";

describe("tenant context (ADR-0005 layer 1 — fail closed)", () => {
  it("requireTenantContext throws outside a tenant scope", () => {
    expect(() => requireTenantContext()).toThrow(MissingTenantContextError);
    try {
      requireTenantContext();
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as MissingTenantContextError).code).toBe(
        "tenancy/tenant-context-missing",
      );
    }
  });

  it("currentTenantContext is undefined outside and set inside the ALS scope", async () => {
    expect(currentTenantContext()).toBeUndefined();
    const tenantId = "11111111-1111-4111-8111-111111111111";
    const context = await tenantContextStorage.run({ tenantId }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentTenantContext();
    });
    expect(context).toEqual({ tenantId });
    expect(currentTenantContext()).toBeUndefined();
  });

  it("the stored code matches the documented invariant: no context, no access", () => {
    expect(new MissingTenantContextError().code).toBe("tenancy/tenant-context-missing");
  });
});
