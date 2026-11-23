import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  ensureQualityPostingWorld,
  freshQualityInstrument,
  setupQualityFixture,
} from "./fixtures";
import { CalibrationService } from "../../modules/quality/application/calibration-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  CalibrationDueDateInvalidError,
  CalibrationRecordNotFoundError,
  QualityInputInvalidError,
  QualityInstrumentNotFoundError,
} from "../../modules/quality/domain/quality-errors";

/**
 * PHASE-050 (W-26 — T-08, 2026-11-23) `quality-calibration.db.spec` — THE
 * CALIBRATION REGISTER over real PG16 (the plan §4's own arm; acceptance
 * #8's register arms): the instrument-AS-asset binding (D-08 — the
 * typed not-found for a foreign instrument; the binding through the
 * fixed-assets module's OWN read), the official CAL-{YYYY}-{SEQ:6}
 * numbering, the due-after floor's typed pre-check (the 0115 CHECK's own
 * shape — the refusal naming BOTH dates), G-63's exactly-once at the
 * create act (the PRE-GENERATED record id naming the INV-013 source key
 * before the row exists; DR 5320 · CR 2137; the zero-cost in-house
 * honest shape with NO entry), the unmapped-purpose fail-closed with
 * the ZERO residue and the flip-and-restore re-run, and the
 * instrument's own history (the service-timeline leg, newest first).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const calibration = new CalibrationService(audit, posting, numbering);

beforeAll(async () => {
  await setupQualityFixture();
  await ensureQualityPostingWorld();
});

/** The journal lines of a source key (the golden read's own shape). */
async function journalLines(docType: string, docId: string, operation: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.base_amount::text AS amount
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
      AND je.operation = ${operation}
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

async function entryCount(docType: string, docId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId}
  `);
  return rows.rows[0]!.n;
}

async function supersedePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  expect(active).toBeDefined();
  await accounting.supersedePurpose(active!.id, active!.activeFrom);
}

async function restorePurposeKey(purposeKey: string, code: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  if (active === undefined) {
    const account = await tenancy.findAccountByCode(code);
    expect(account).toBeDefined();
    await tenancy.insertAccountPurpose({
      purposeKey,
      accountId: account!.id,
      activeFrom: new Date().toISOString().slice(0, 10),
    });
  }
}

function createInput(overrides: {
  assetId: string;
  externalCost?: string | null;
  calibratedAt?: string;
  dueDate?: string;
}) {
  return {
    assetId: overrides.assetId,
    standardUsed: "ISO 3675 viscometer standard",
    result: "PASS" as const,
    calibratedAt: overrides.calibratedAt ?? "2026-11-01T09:00:00.000Z",
    dueDate: overrides.dueDate ?? "2026-12-01",
    providerId: null,
    certificateRef: "CERT-2026-114",
    externalCost: overrides.externalCost ?? null,
    note: null,
    noteAr: null,
    actorId: QL_ACTOR,
  };
}

describe("PHASE-050 W-26 — T-08: the calibration register (create — the binding, the floor, the numbering)", () => {
  it("THE BINDING (D-08): the instrument IS an asset — the register binds the asset card; a foreign instrument is the typed not-found", async () => {
    const refused = await withTenant(TENANT_QUALITY, () =>
      calibration
        .create(
          createInput({
            assetId: "99999999-9999-4999-8999-999999999999",
            externalCost: "0",
          }),
        )
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInstrumentNotFoundError);
    expect((refused as QualityInstrumentNotFoundError).code).toBe(
      "QUALITY_INSTRUMENT_NOT_FOUND",
    );
  });

  it("creates the record with the official number, the due date, the provider link", async () => {
    const assetId = await freshQualityInstrument("CAL-CREATE");
    const created = await withTenant(TENANT_QUALITY, () =>
      calibration.create(createInput({ assetId, externalCost: "0" })),
    );
    expect(created.calibrationNo).toMatch(/^CAL-20\d{2}-\d{6}$/);
    expect(created.assetId).toBe(assetId);
    expect(created.result).toBe("PASS");
    expect(created.dueDate).toBe("2026-12-01");
    expect(created.externalCost).toBe("0.0000");
    expect(created.journalEntryId).toBeNull();
    expect(created.certificateRef).toBe("CERT-2026-114");
  });

  it("THE DUE-AFTER FLOOR: the due date on/before the calibration act's UTC day is the typed refusal naming BOTH dates (never a raw CHECK)", async () => {
    const assetId = await freshQualityInstrument("CAL-FLOOR");
    const sameDay = await withTenant(TENANT_QUALITY, () =>
      calibration
        .create(
          createInput({
            assetId,
            calibratedAt: "2026-11-01T23:30:00.000Z",
            dueDate: "2026-11-01",
            externalCost: "0",
          }),
        )
        .catch((error: unknown) => error),
    );
    expect(sameDay).toBeInstanceOf(CalibrationDueDateInvalidError);
    expect((sameDay as CalibrationDueDateInvalidError).details).toMatchObject({
      calibratedAt: "2026-11-01T23:30:00.000Z",
      dueDate: "2026-11-01",
    });
    const earlier = await withTenant(TENANT_QUALITY, () =>
      calibration
        .create(
          createInput({
            assetId,
            calibratedAt: "2026-11-01T09:00:00.000Z",
            dueDate: "2026-10-31",
            externalCost: "0",
          }),
        )
        .catch((error: unknown) => error),
    );
    expect(earlier).toBeInstanceOf(CalibrationDueDateInvalidError);
    // The strictly-after shape is legal: the next UTC day.
    const legal = await withTenant(TENANT_QUALITY, () =>
      calibration.create(
        createInput({
          assetId,
          calibratedAt: "2026-11-01T23:30:00.000Z",
          dueDate: "2026-11-02",
          externalCost: "0",
        }),
      ),
    );
    expect(legal.dueDate).toBe("2026-11-02");
  });

  it("the result vocabulary is closed — PASS/FAIL/ADJUSTED; a foreign value is the typed input refusal", async () => {
    const assetId = await freshQualityInstrument("CAL-RESULT");
    const refused = await withTenant(TENANT_QUALITY, () =>
      calibration
        .create({ ...createInput({ assetId, externalCost: "0" }), result: "PASSED" })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInputInvalidError);
    for (const result of ["PASS", "FAIL", "ADJUSTED"] as const) {
      const row = await withTenant(TENANT_QUALITY, () =>
        calibration.create({ ...createInput({ assetId, externalCost: "0" }), result }),
      );
      expect(row.result).toBe(result);
    }
  });

  it("a foreign calibration id is the typed not-found", async () => {
    const refused = await withTenant(TENANT_QUALITY, () =>
      calibration.find("99999999-9999-4999-8999-999999999999").catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CalibrationRecordNotFoundError);
  });
});

describe("PHASE-050 W-26 — T-08: G-63 at the create act (D-06 — the external calibration cost)", () => {
  it("THE GOLDEN-CLASS ARM: the external cost posts DR 5320 · CR 2137 with the PRE-GENERATED id's source key — the stamp and the row in ONE transaction", async () => {
    const assetId = await freshQualityInstrument("CAL-G63");
    const created = await withTenant(TENANT_QUALITY, () =>
      calibration.create(createInput({ assetId, externalCost: "450.5" })),
    );
    expect(created.externalCost).toBe("450.5000");
    expect(created.journalEntryId).not.toBeNull();
    const lines = await withTenant(TENANT_QUALITY, () =>
      journalLines("calibration_record", created.id, "external_cost"),
    );
    expect(lines).toEqual([
      { direction: "DEBIT", code: "5320", amount: "450.5000" },
      { direction: "CREDIT", code: "2137", amount: "450.5000" },
    ]);
  });

  it("the zero-cost (in-house) calibration carries NO entry — the recorded honest shape", async () => {
    const assetId = await freshQualityInstrument("CAL-INHOUSE");
    const created = await withTenant(TENANT_QUALITY, () =>
      calibration.create(createInput({ assetId, externalCost: "0" })),
    );
    expect(created.journalEntryId).toBeNull();
    expect(await withTenant(TENANT_QUALITY, () => entryCount("calibration_record", created.id))).toBe(0);
    // Absent cost ≡ zero cost (the null shape reads as 0 — the 0115 default).
    const absent = await withTenant(TENANT_QUALITY, () =>
      calibration.create(createInput({ assetId, externalCost: null })),
    );
    expect(absent.externalCost).toBe("0.0000");
    expect(absent.journalEntryId).toBeNull();
  });

  it("THE UNMAPPED-PURPOSE FAIL-CLOSED: EXTERNAL_ACCRUAL superseded → the EXTERNAL-cost create refuses PURPOSE_NOT_MAPPED with ZERO residue (no row, no journal); restored → the re-run GREEN; the in-house create stays GREEN throughout", async () => {
    const assetId = await freshQualityInstrument("CAL-UNMAPPED");
    await withTenant(TENANT_QUALITY, async () => {
      await supersedePurposeKey("EXTERNAL_ACCRUAL");
      const refused = await calibration
        .create(createInput({ assetId, externalCost: "200" }))
        .catch((error: unknown) => error);
      // The engine's own refusal (fail-closed — no fallback account).
      expect((refused as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
      // THE ZERO RESIDUE: the whole create rolled back — no calibration
      // row exists for the instrument yet, zero journals.
      const rows = await calibration.list({ assetId });
      expect(rows).toHaveLength(0);
      // The in-house create is UNAFFECTED (no posting → no mapping needed
      // — the honest shape: a tenant without the mapping keeps calibrating).
      const inHouse = await calibration.create(createInput({ assetId, externalCost: "0" }));
      expect(inHouse.journalEntryId).toBeNull();
      // THE RESTORE: the tenant's own runtime repair path — the
      // external-cost re-run GREEN (the flip-and-restore idiom).
      await restorePurposeKey("EXTERNAL_ACCRUAL", "2137");
      const external = await calibration.create(
        createInput({ assetId, externalCost: "200" }),
      );
      expect(external.journalEntryId).not.toBeNull();
      const lines = await journalLines("calibration_record", external.id, "external_cost");
      expect(lines).toEqual([
        { direction: "DEBIT", code: "5320", amount: "200.0000" },
        { direction: "CREDIT", code: "2137", amount: "200.0000" },
      ]);
    });
  });

  it("INV-013's single-use by construction: the source key names the record's own id — exactly one journal per row", async () => {
    const assetId = await freshQualityInstrument("CAL-ONCE");
    const created = await withTenant(TENANT_QUALITY, () =>
      calibration.create(createInput({ assetId, externalCost: "90" })),
    );
    expect(await withTenant(TENANT_QUALITY, () => entryCount("calibration_record", created.id))).toBe(1);
  });
});

describe("PHASE-050 W-26 — T-08: the instrument's own history (D-08 — the service-timeline leg)", () => {
  it("the per-asset register reads newest-first — the asset card's calibration leg", async () => {
    const assetId = await freshQualityInstrument("CAL-HISTORY");
    const first = await withTenant(TENANT_QUALITY, () =>
      calibration.create(
        createInput({
          assetId,
          calibratedAt: "2026-05-01T09:00:00.000Z",
          dueDate: "2026-11-01",
          externalCost: "0",
        }),
      ),
    );
    const second = await withTenant(TENANT_QUALITY, () =>
      calibration.create(
        createInput({
          assetId,
          calibratedAt: "2026-11-01T09:00:00.000Z",
          dueDate: "2027-05-01",
          externalCost: "0",
        }),
      ),
    );
    const history = await withTenant(TENANT_QUALITY, () =>
      calibration.list({ assetId }),
    );
    expect(history.map((row) => row.id)).toEqual([second.id, first.id]);
    // The RLS scoping: the empty tenant sees nothing (the per-arm worlds
    // stay isolated — the boundary read on a foreign instrument).
    const foreignRead = await withTenant(TENANT_QUALITY, () =>
      calibration.list({ assetId: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(foreignRead).toEqual([]);
  });
});
