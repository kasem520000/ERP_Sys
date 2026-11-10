import { describe, expect, it } from "vitest";

import {
  AuditService,
  AuditStore,
  InvalidAuditEventError,
  type AuditEventInput,
  type AuditEventRow,
  type AuditQuery,
} from "./audit.service";
import {
  MissingTenantContextError,
  tenantContextStorage,
  type TenantContext,
} from "../../../infra/db/tenant-context";

/**
 * Unit tests: validation + the fail-closed tenant-context contract with a
 * fake store. Real-database behavior (RLS, append-only guards, attack tests
 * A1–A5/A10) is proven by src/__db__/rls-attacks.db.spec.ts.
 */
class RecordingStore extends AuditStore {
  async appendPlatform(): Promise<void> {
    // PHASE-004 platform append — exercised by the tenancy suite.
  }
  async listPlatform(): Promise<readonly AuditEventRow[]> {
    return [];
  }
  readonly appended: AuditEventInput[] = [];
  private readonly rows: AuditEventRow[] = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: "11111111-1111-4111-8111-111111111111",
      actorId: null,
      action: "x.created",
      entityType: "x",
      entityId: "00000000-0000-4000-8000-000000000002",
      before: null,
      after: { a: 1 },
      correlationId: null,
      deviceId: null,
      at: "2026-10-28T00:00:00.000Z",
      viaPlatformAdmin: false,
    },
  ];

  append(context: TenantContext, event: AuditEventInput): Promise<void> {
    if (context.tenantId === "fail") {
      return Promise.reject(new Error("store failure"));
    }
    this.appended.push(event);
    return Promise.resolve();
  }

  list(_context: TenantContext, query: AuditQuery): Promise<readonly AuditEventRow[]> {
    return Promise.resolve(
      query.entityType === "none" ? [] : this.rows,
    );
  }
}

function service(): { audit: AuditService; store: RecordingStore } {
  const store = new RecordingStore();
  return { audit: new AuditService(store), store };
}

const validEvent: AuditEventInput = {
  action: "invoice.posted",
  entityType: "sales_invoice",
  entityId: "00000000-0000-4000-8000-000000000003",
};

const tenantScope = (): TenantContext => ({ tenantId: "11111111-1111-4111-8111-111111111111" });

describe("AuditService (PHASE-002 §2.3)", () => {
  it("records inside a tenant scope and forwards the event", async () => {
    const { audit, store } = service();
    await tenantContextStorage.run(tenantScope(), async () => audit.record(validEvent));
    expect(store.appended).toHaveLength(1);
    expect(store.appended[0]?.action).toBe("invoice.posted");
  });

  it("fails closed without a tenant context (ADR-0005)", async () => {
    const { audit } = service();
    await expect(audit.record(validEvent)).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it("validates action/entityType lengths", async () => {
    const { audit } = service();
    await expect(
      tenantContextStorage.run(tenantScope(), async () =>
        audit.record({ ...validEvent, action: "" }),
      ),
    ).rejects.toBeInstanceOf(InvalidAuditEventError);
    await expect(
      tenantContextStorage.run(tenantScope(), async () =>
        audit.record({ ...validEvent, entityType: "x".repeat(101) }),
      ),
    ).rejects.toMatchObject({ code: "audit/invalid-event" });
  });

  it("list() requires the tenant scope and applies query limits", async () => {
    const { audit } = service();
    await expect(audit.list({})).rejects.toBeInstanceOf(MissingTenantContextError);
    await expect(
      tenantContextStorage.run(tenantScope(), async () => audit.list({ limit: 0 })),
    ).rejects.toBeInstanceOf(InvalidAuditEventError);
    const rows = await tenantContextStorage.run(tenantScope(), async () =>
      audit.list({ entityType: "x" }),
    );
    expect(rows).toHaveLength(1);
  });
});
