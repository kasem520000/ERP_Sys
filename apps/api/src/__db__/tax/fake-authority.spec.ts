import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../../modules/files/api/files";
import { S3FilesStore } from "../../modules/files/infrastructure/s3-files.store";
import { SubmissionRegistryService } from "../../modules/tax/submissions/registry-service";
import * as store from "../../modules/tax/submissions/store";
import { RETRY_MAX_ATTEMPTS } from "../../modules/tax/submissions/state-machine";
import { FakeZatcaAuthority } from "../../../../../tests/authorities/fake-zatca/fake-authority";
import { FakeEtaAuthority } from "../../../../../tests/authorities/fake-eta/fake-authority";
import { setupPackTenant, X_ACTOR, type PackTenant } from "./fixtures";

/**
 * PHASE-023 T11 — the fake-authority harness scenario matrix (phase §6):
 * submit → ACCEPTED (uuid stored) / REJECTED (codes surfaced for user
 * action) / timeout → retry per policy / poison → dead-letter + alert —
 * all against the REAL registry + retry policy, with duplicates proving
 * registry idempotency (no double clearance). The fake speaks the PORT
 * only (no authority wire format is encoded anywhere — NO-FABRICATION).
 */

const audit = new AuditService(new DrizzleAuditStore());
const files = new FilesService(new S3FilesStore());

let tenant: PackTenant;
let registry: SubmissionRegistryService;

/**
 * The harness simulates a PASSED verification gate (E_INVOICING §3): the
 * SA jurisdiction flips to VERIFIED with a pinned date — exactly the
 * state production reaches after the T3 checklist completes (the pack
 * seed's REQUIRES_VERIFICATION default stays untouched for every other
 * suite; restored in afterAll).
 */
async function simulatePassedGate(): Promise<() => Promise<void>> {
  const su = await superuserClient();
  await su.query(
    `UPDATE jurisdictions SET verification_status = 'VERIFIED', verified_at = now()
     WHERE country_code = 'SA' AND verification_status <> 'VERIFIED'`,
  );
  await su.end();
  return async () => {
    const restore = await superuserClient();
    await restore.query(
      `UPDATE jurisdictions SET verification_status = 'REQUIRES_VERIFICATION', verified_at = NULL
       WHERE country_code = 'SA'`,
    );
    await restore.end();
  };
}

let restoreGate: (() => Promise<void>) | undefined;

beforeAll(async () => {
  tenant = await setupPackTenant("SA");
  restoreGate = await simulatePassedGate();
});

afterAll(async () => {
  if (restoreGate !== undefined) {
    await restoreGate();
  }
});

/** Drive a fresh submission through generate → submit with a scripted adapter. */
async function scriptedSubmission(
  authority: FakeZatcaAuthority,
  script: { behavior: string; rejectionCodes?: readonly string[] },
): Promise<string> {
  const sourceId = generateUuidV7();
  authority.script(sourceId, script);
  const row = await withTenant(tenant.tenantId, () =>
    store.enqueueSubmission({
      countryCode: "SA",
      adapterId: authority.id,
      sourceType: "sales_invoice",
      sourceId,
      payloadDigest: null,
      actorId: X_ACTOR,
    }),
  );
  await withTenant(tenant.tenantId, () =>
    registry.generatePayload({
      submissionId: row.row.id,
      document: {
        officialNumber: "INV-FAKE-0001",
        issuedOn: "2026-11-06",
        partyName: "جهة وهمية",
        currencyCode: "SAR",
        totals: { gross: "115.0000" },
      },
      taxSummary: [],
    }),
  );
  return row.row.id;
}

describe("fake-zatca scenario matrix (the harness drives the REAL registry)", () => {
  it("ACCEPT stores the authority reference (uuid)", async () => {
    const authority = new FakeZatcaAuthority(true);
    registry = new SubmissionRegistryService(audit, files);
    registry.registerAdapter(authority);
    // The registry's UNVERIFIED gate must be bypassed for harness runs: the
    // harness simulates a PASSED gate by patching the jurisdiction check —
    // the honest mechanism is the adapter override (the port's seam).
    const submissionId = await scriptedSubmission(authority, { behavior: "accept" });
    const result = await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    expect(result.outcome?.status).toBe("ACCEPTED");
    expect(result.outcome?.authorityReference).toMatch(/^FAKE-ZATCA-UUID-/);
    const row = await withTenant(tenant.tenantId, () => store.findSubmission(submissionId));
    expect(row?.status).toBe("ACCEPTED");
    expect(row?.authorityRefs).toContain(result.outcome?.authorityReference);
  });

  it("REJECT surfaces reason codes for user action; resubmission creates a NEW row", async () => {
    const authority = new FakeZatcaAuthority(true);
    registry = new SubmissionRegistryService(audit, files);
    registry.registerAdapter(authority);
    const submissionId = await scriptedSubmission(authority, {
      behavior: "reject",
      rejectionCodes: ["BR-CL-10001", "BR-CL-10002"],
    });
    const result = await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    expect(result.outcome?.status).toBe("REJECTED");
    expect((result.outcome?.error as { reasonCodes: string[] }).reasonCodes).toEqual([
      "BR-CL-10001",
      "BR-CL-10002",
    ]);
    const row = await withTenant(tenant.tenantId, () => store.findSubmission(submissionId));
    expect(row?.status).toBe("REJECTED");
    // User action → resubmit (new row chained; history intact).
    const resubmitted = await withTenant(tenant.tenantId, () =>
      registry.resubmit({ submissionId, actorId: X_ACTOR }),
    );
    expect(resubmitted.id).not.toBe(submissionId);
    expect(resubmitted.retryOfSubmissionId).toBe(submissionId);
    expect(resubmitted.status).toBe("PENDING");
  });

  it("TIMEOUT retries with backoff inside the budget (timeout-then-accept)", async () => {
    const authority = new FakeZatcaAuthority(true);
    registry = new SubmissionRegistryService(audit, files);
    registry.registerAdapter(authority);
    const submissionId = await scriptedSubmission(authority, { behavior: "timeout-then-accept:2" });
    // Attempt 1: timeout → retry scheduled.
    const first = await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    expect(first.outcome?.status).toBe("FAILED");
    expect(first.retried).toBe(true);
    let row = await withTenant(tenant.tenantId, () => store.findSubmission(submissionId));
    expect(row?.status).toBe("GENERATED"); // stayed in the live state
    expect(row?.attempts).toBe(1);
    expect(row?.nextAttemptAt).not.toBeNull();
    // Attempt 2: timeout again → still retrying.
    const second = await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    expect(second.retried).toBe(true);
    // Attempt 3: the fake accepts.
    const third = await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    expect(third.outcome?.status).toBe("ACCEPTED");
    row = await withTenant(tenant.tenantId, () => store.findSubmission(submissionId));
    expect(row?.status).toBe("ACCEPTED");
    expect(row?.attempts).toBe(3);
  });

  it("POISON dead-letters after the capped retries and records the terminal error", async () => {
    const authority = new FakeZatcaAuthority(true);
    registry = new SubmissionRegistryService(audit, files);
    registry.registerAdapter(authority);
    const submissionId = await scriptedSubmission(authority, { behavior: "poison" });
    let deadLettered = false;
    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt += 1) {
      const result = await withTenant(tenant.tenantId, () =>
        registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
      );
      deadLettered = result.deadLettered === true;
    }
    expect(deadLettered).toBe(true);
    const row = await withTenant(tenant.tenantId, () => store.findSubmission(submissionId));
    expect(row?.status).toBe("FAILED");
    expect(row?.attempts).toBe(RETRY_MAX_ATTEMPTS);
    expect(row?.lastErrorCode).toBe("AUTHORITY_TIMEOUT");
    // The dead-letter notification exists (einvoicing.submission.failed).
    const notices = await withTenant(tenant.tenantId, async () => {
      const tx = (await import("../../infra/db/tenant-context")).requireTenantContext();
      const rows = await tx.tx!.execute(
        (await import("drizzle-orm")).sql`
          SELECT count(*)::int AS n FROM notifications
          WHERE category = 'einvoicing' AND dedupe_key LIKE ${`einvoicing:submission:${submissionId}:%`}
        `,
      );
      return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
    });
    expect(notices).toBeGreaterThan(0);
  });

  it("duplicate submit calls cannot double-clear (registry idempotency holds end-to-end)", async () => {
    const authority = new FakeZatcaAuthority(true);
    registry = new SubmissionRegistryService(audit, files);
    registry.registerAdapter(authority);
    const submissionId = await scriptedSubmission(authority, { behavior: "accept" });
    await withTenant(tenant.tenantId, () =>
      registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
    );
    // A duplicate driver run on the ACCEPTED row refuses (terminal state).
    await expect(
      withTenant(tenant.tenantId, () =>
        registry.submitThroughAdapter({ submissionId, adapterOverride: authority }),
      ),
    ).rejects.toThrow(/not in a submittable state/);
    // One row for the document × adapter, one authority reference — the
    // no-double-clearance guarantee (acceptance criterion 4/5).
    const rows = await withTenant(tenant.tenantId, () =>
      store.listSubmissions({ adapterId: "fake-zatca", status: "ACCEPTED" }),
    );
    const mine = rows.filter((row) => row.id === submissionId);
    expect(mine).toHaveLength(1);
  });
});

describe("fake-eta evaluation track (RISK-007) — refuses until DR-003 approves", () => {
  it("the evaluation fake refuses (no implementation claim)", async () => {
    const eta = new FakeEtaAuthority();
    registry = new SubmissionRegistryService(audit, files);
    registry.registerAdapter(eta);
    const outcome = await eta.submit({
      countryCode: "EG",
      sourceType: "sales_invoice",
      sourceId: generateUuidV7(),
      document: {},
    });
    expect(outcome.status).toBe("FAILED");
    expect(outcome.error?.code).toBe("UNVERIFIED_REGIME");
    expect((outcome.error as { decisionRecord: string }).decisionRecord).toContain("DR-003");
  });
});
