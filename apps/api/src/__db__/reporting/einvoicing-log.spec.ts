import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import * as store from "../../modules/tax/submissions/store";
import {
  fullContext,
  newRunService,
  setupReportingFixture,
  TENANT_R,
} from "./fixtures";

/**
 * PHASE-035 T-06 verification (phase §6 criterion 5): the tax.e-invoicing-log
 * contract — REPORT_CATALOG §6's documented-but-missing 86th row (audit
 * EVAL-F-6) — renders over the real e_invoicing_submissions registry through
 * the module-owned query surface (ADR-0011): seeded submissions appear with
 * their state-machine statuses, the status filter narrows, the created_at
 * window filters, the status-vocabulary assertion passes, and a session
 * without `tax.einvoicing.manage` is denied before params bind (the §12
 * module-register convention — same key as every e-invoicing route; zero-drift
 * 245=245).
 */

/** Fixed source ids — the registry's live-unique key makes re-entries no-ops. */
const DOC = {
  accepted: "51515151-0000-4000-8000-0000000000a1",
  rejected: "51515151-0000-4000-8000-0000000000a2",
  pending: "51515151-0000-4000-8000-0000000000a3",
} as const;

/** A window that deterministically covers every seeded row. */
const WINDOW = { dateFrom: "2020-01-01", dateTo: "2030-12-31", locale: "en" } as const;

beforeAll(async () => {
  await setupReportingFixture();
  await withTenant(TENANT_R, async () => {
    // Seed the registry through the ONLY writer (the store's own state
    // machine): one full happy lifecycle to ACCEPTED, one REJECTED, one
    // left PENDING — all on the zatca adapter, jurisdiction SA.
    const accepted = await store.enqueueSubmission({
      countryCode: "SA",
      adapterId: "zatca",
      sourceType: "sales_invoice",
      sourceId: DOC.accepted,
      payloadDigest: "sha256-035-a1",
      actorId: null,
    });
    if (!accepted.idempotentReplay) {
      await store.transitionSubmission({ id: accepted.row.id, to: "GENERATED" });
      await store.transitionSubmission({ id: accepted.row.id, to: "SUBMITTED" });
      await store.transitionSubmission({
        id: accepted.row.id,
        to: "ACCEPTED",
        authorityReference: "035-auth-ref-accepted",
      });
    }
    const rejected = await store.enqueueSubmission({
      countryCode: "SA",
      adapterId: "zatca",
      sourceType: "sales_invoice",
      sourceId: DOC.rejected,
      payloadDigest: "sha256-035-a2",
      actorId: null,
    });
    if (!rejected.idempotentReplay) {
      await store.transitionSubmission({ id: rejected.row.id, to: "GENERATED" });
      await store.transitionSubmission({ id: rejected.row.id, to: "SUBMITTED" });
      await store.transitionSubmission({
        id: rejected.row.id,
        to: "REJECTED",
        errorCode: "035-REJECTED-BY-AUTHORITY",
      });
    }
    await store.enqueueSubmission({
      countryCode: "SA",
      adapterId: "zatca",
      sourceType: "sales_invoice",
      sourceId: DOC.pending,
      payloadDigest: null,
      actorId: null,
    });
  });
});

describe("PHASE-035 · tax.e-invoicing-log (the 86th contract, audit EVAL-F-6)", () => {
  it("renders the seeded registry rows with state-machine statuses and a PASS vocabulary assertion", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "tax.e-invoicing-log",
        params: { ...WINDOW },
        ctx: fullContext(),
      }),
    );
    expect(outcome.queued).toBeUndefined();
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result).toBeDefined();
    const rows = outcome.result!.rows;
    const byDoc = new Map(rows.map((row) => [row.values.sourceId, row.values]));
    expect(byDoc.get(DOC.accepted)?.status).toBe("ACCEPTED");
    expect(byDoc.get(DOC.accepted)?.authorityReference).toBe("035-auth-ref-accepted");
    expect(byDoc.get(DOC.rejected)?.status).toBe("REJECTED");
    expect(byDoc.get(DOC.rejected)?.lastErrorCode).toBe("035-REJECTED-BY-AUTHORITY");
    expect(byDoc.get(DOC.pending)?.status).toBe("PENDING");
    const vocabulary = outcome.result!.assertions.find(
      (assertion) => assertion.id === "einvoicing-log-status-vocabulary",
    );
    expect(vocabulary?.status).toBe("PASS");
  });

  it("the status filter narrows to the requested state", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "tax.e-invoicing-log",
        params: { ...WINDOW, status: "REJECTED" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    const rejectedRows = outcome.result!.rows.filter(
      (row) => row.values.sourceId === DOC.rejected,
    );
    const acceptedRows = outcome.result!.rows.filter(
      (row) => row.values.sourceId === DOC.accepted,
    );
    expect(rejectedRows).toHaveLength(1);
    expect(acceptedRows).toHaveLength(0);
  });

  it("the created_at window excludes rows outside it", async () => {
    const outcome = await withTenant(TENANT_R, () =>
      newRunService().run({
        reportKey: "tax.e-invoicing-log",
        params: { dateFrom: "2019-01-01", dateTo: "2019-12-31", locale: "en" },
        ctx: fullContext(),
      }),
    );
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(0);
  });

  it("a session without tax.einvoicing.manage is denied before params bind", async () => {
    const deniedCtx = fullContext(TENANT_R, {
      permissions: new Set(["reporting.reports.run"]),
    });
    await expect(
      withTenant(TENANT_R, () =>
        newRunService().run({
          reportKey: "tax.e-invoicing-log",
          params: { ...WINDOW },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});
