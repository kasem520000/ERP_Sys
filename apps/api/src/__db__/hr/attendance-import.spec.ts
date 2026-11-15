import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { AttendanceImportService, DEFAULT_IMPORT_MAPPING } from "../../modules/hr/application/attendance-import-service";
import { AttendanceService } from "../../modules/hr/application/attendance-service";
import { H_ACTOR, setupHrFixture, shiftSvc } from "./fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-045 (T-05, N-17) — the DEVICE-AGNOSTIC attendance import
 * pinned:
 *
 * - THE ZKTECO-STYLE DEFAULT (the generic CSV adapter — user id,
 *   timestamp, direction, device id; never a vendor SDK): preview is
 *   the analysis alone (ZERO writes); commit writes the log + the
 *   records + the quarantine;
 * - THE ANOMALY FAMILY, every refused line quarantined with its raw
 *   evidence — UNKNOWN_EMPLOYEE, INVALID_ROW (bad shape / bad
 *   direction / unparseable timestamp), OUT_OF_RANGE (outside the
 *   import horizon), DUPLICATE_IN_FILE (the same employee + timestamp
 *   twice — the collapse law), DOUBLE_PUNCH_IN, ORPHAN_PUNCH_OUT,
 *   and the DB floors ALREADY_IMPORTED + SESSION_OVERLAP;
 * - THE FINGERPRINT LAW: the same file never commits twice (the typed
 *   refusal); a CHANGED file imports its fresh rows and quarantines
 *   the overlaps — both laws hold;
 * - THE DERIVATION: imported rows derive immediately (the same
 *   day-verdict law as the manual capture);
 * - THE QUARANTINE REVIEW: REJECT + IMPORT-with-corrections — the
 *   correction rides the SAME capture laws (an overlapping correction
 *   is the typed INV-031 refusal, the anomaly stays PENDING), and the
 *   resolved anomaly never resolves twice;
 * - THE MAPPING: the code-level default, the stored per-tenant mapping
 *   (tenant_settings), and the per-request override;
 * - the tenant boundary.
 */

const TENANT_H = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a";
const TENANT_H_RLS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7c7c";

const audit = new AuditService(new DrizzleAuditStore());
const attendanceSvc = new AttendanceService(audit);
const importSvc = new AttendanceImportService(audit, attendanceSvc);

interface ImportFixture {
  employeeI1Id: string;
  employeeI2Id: string;
  dayShiftCode: string;
}

const spec: { fixture?: ImportFixture } = {};
let seq = 0;

function uniqueCode(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now() % 100000}-${seq}`;
}

/** THE EXACT MAIN FILE (shared by arms (a) and (b) — the fingerprint
 * law refuses the same BYTES, never a similar file). */
const MAIN_CSV = [
  "User ID,Timestamp,Direction,Device",
  "EMP-I1,2026-06-11 08:05:00,in,ZK-01",
  "EMP-I1,2026-06-11 16:10:00,out,ZK-01",
  "EMP-I2,2026-06-11 08:00:00,in,ZK-01",
  "EMP-I2,2026-06-11 12:00:00,out,ZK-01",
  "EMP-XX,2026-06-11 13:00:00,in,ZK-01",
  "EMP-I1,2026-06-11 08:05:00,in,ZK-01",
  "EMP-I1,2026-06-12 08:20:00,in,ZK-01",
  "EMP-I1,2026-06-12 09:30:00,in,ZK-01",
  "EMP-I1,2026-06-12 16:00:00,out,ZK-01",
  "EMP-I2,2026-06-12 17:00:00,out,ZK-01",
  "BADROW,garbage,in,ZK-01",
  "EMP-I1,2020-01-01 08:00:00,in,ZK-01",
  "EMP-I2,2026-06-13 09:00:00,SIDEWAYS,ZK-01",
].join("\n");

beforeAll(async () => {
  await setupHrFixture();

  // The append-only reset (the attendance.spec precedent): capture and
  // import are INSERT-only; the spec's world is purged for a
  // deterministic re-run (the batches purge CASCADES its anomalies;
  // the mapping setting is cleared so the default-mapping arms are
  // order-independent).
  const su: Client = await superuserClient();
  await su.query(`DELETE FROM attendance_records WHERE tenant_id = $1`, [TENANT_H]);
  await su.query(`DELETE FROM attendance_import_batches WHERE tenant_id = $1`, [TENANT_H]);
  await su.query(
    `DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'hr.attendance.import.map'`,
    [TENANT_H],
  );
  const employeeRows = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-I1', 'Imad Al-Import', 'عماد الاستيراد', '2026-01-01', 'FULL_TIME', 8000, $2),
       (gen_random_uuid(), $1, 'EMP-I2', 'Inaya Al-Device', 'عناية الجهاز', '2026-01-01', 'FULL_TIME', 9000, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_H, H_ACTOR],
  );
  const byCode = new Map(employeeRows.rows.map((row) => [row.code, row.id]));
  await su.end();

  const dayShift = await withTenant(TENANT_H, () =>
    shiftSvc.create({
      code: uniqueCode("IMP-DAY"),
      name: "Import day shift 08:00–16:00",
      nameAr: "وردية الاستيراد ٠٨:٠٠–١٦:٠٠",
      startTime: "08:00",
      endTime: "16:00",
      graceMinutes: 15,
      breakMinutes: 30,
      isNight: false,
      note: null,
      noteAr: null,
      actorId: H_ACTOR,
    }),
  );
  const f: ImportFixture = {
    employeeI1Id: byCode.get("EMP-I1")!,
    employeeI2Id: byCode.get("EMP-I2")!,
    dayShiftCode: dayShift.code,
  };
  for (const [employeeId, workDate] of [
    [f.employeeI1Id, "2026-06-11"],
    [f.employeeI1Id, "2026-06-12"],
    [f.employeeI2Id, "2026-06-11"],
  ] as const) {
    await withTenant(TENANT_H, () =>
      shiftSvc.setRosterCell({
        employeeId,
        workDate,
        shiftId: dayShift.id,
        note: null,
        actorId: H_ACTOR,
      }),
    );
  }
  spec.fixture = f;
});

describe("PHASE-045 T-05 — the device-agnostic attendance import: preview, commit, the fingerprint, the quarantine, the review", () => {
  it("(a) THE ZKTECO-STYLE DEFAULT — preview is the analysis alone (zero writes) and every refused line is quarantined with its raw evidence", async () => {
    const content = MAIN_CSV;

    const preview = await withTenant(TENANT_H, () =>
      importSvc.preview({ content, mapping: DEFAULT_IMPORT_MAPPING }),
    );
    // 13 data rows: 6 lines pair into 3 sessions; 7 lines quarantine —
    // the full accounting, nothing lands silently.
    expect(preview.rowCount).toBe(13);
    expect(preview.sessions).toHaveLength(3);
    expect(preview.anomalies).toHaveLength(7);
    const reasons = preview.anomalies.map((anomaly) => anomaly.reason).sort();
    expect(reasons).toEqual([
      "DOUBLE_PUNCH_IN",
      "DUPLICATE_IN_FILE",
      "INVALID_ROW",
      "INVALID_ROW",
      "ORPHAN_PUNCH_OUT",
      "OUT_OF_RANGE",
      "UNKNOWN_EMPLOYEE",
    ]);
    // Every anomaly carries its raw line — the reviewer's evidence.
    expect(preview.anomalies.every((anomaly) => anomaly.rawLine.length > 0)).toBe(true);

    // The preview wrote NOTHING: no batches, no records.
    const batchesBefore = await withTenant(TENANT_H, () => importSvc.batches({}));
    expect(batchesBefore.total).toBe(0);

    // THE COMMIT: the log + the records + the quarantine, and the
    // imported rows derive immediately (the day-verdict law).
    const batch = await withTenant(TENANT_H, () =>
      importSvc.commit({
        content,
        fileName: "zkteco-2026-06-13.csv",
        mapping: DEFAULT_IMPORT_MAPPING,
        deviceRef: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(batch.rowCount).toBe(13);
    expect(batch.importedCount).toBe(3);
    expect(batch.quarantineCount).toBe(7);
    expect(batch.deviceRef).toBe("ZK-01");
    expect(batch.fileSha256).toHaveLength(64);

    const day11 = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-11"));
    const i1Row11 = day11.rows.find((row) => row.employeeCode === "EMP-I1");
    expect(i1Row11!.source).toBe("IMPORT");
    expect(i1Row11!.derivedStatus).toBe("PRESENT");
    expect(i1Row11!.lateMinutes).toBe(0);
    expect(i1Row11!.workedMinutes).toBe(455);
    expect(i1Row11!.overtimeMinutes).toBe(10);
    const i2Row11 = day11.rows.find((row) => row.employeeCode === "EMP-I2");
    expect(i2Row11!.derivedStatus).toBe("PRESENT");
    expect(i2Row11!.workedMinutes).toBe(210);
    const day12 = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-12"));
    const i1Row12 = day12.rows.find((row) => row.employeeCode === "EMP-I1");
    expect(i1Row12!.derivedStatus).toBe("LATE");
    expect(i1Row12!.lateMinutes).toBe(5);
    expect(i1Row12!.workedMinutes).toBe(430);
    // The import batch is the records' traceability.
    expect(i1Row11!.importBatchId).toBe(batch.id);

    // The quarantine rows landed, PENDING.
    const quarantine = await withTenant(TENANT_H, () =>
      importSvc.anomalies({ batchId: batch.id, status: "PENDING" }),
    );
    expect(quarantine.total).toBe(7);
  });

  it("(b) THE FINGERPRINT LAW — the same file never commits twice; a CHANGED file imports its fresh rows and quarantines the overlaps", async () => {
    // THE EXACT SAME BYTES as the committed main file — the typed
    // refusal (never a silent second batch).
    await expect(
      withTenant(TENANT_H, () =>
        importSvc.commit({
          content: MAIN_CSV,
          fileName: "zkteco-2026-06-13.csv (retry)",
          mapping: DEFAULT_IMPORT_MAPPING,
          deviceRef: null,
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_ALREADY_COMMITTED" });

    // A changed file: the I1 06-11 session already exists →
    // ALREADY_IMPORTED; the fresh I2 06-12 session imports.
    const changedContent = [
      "User ID,Timestamp,Direction,Device",
      "EMP-I1,2026-06-11 08:05:00,in,ZK-01",
      "EMP-I1,2026-06-11 16:10:00,out,ZK-01",
      "EMP-I2,2026-06-12 08:00:00,in,ZK-02",
      "EMP-I2,2026-06-12 12:00:00,out,ZK-02",
    ].join("\n");
    const batch2 = await withTenant(TENANT_H, () =>
      importSvc.commit({
        content: changedContent,
        fileName: "zkteco-round2.csv",
        mapping: DEFAULT_IMPORT_MAPPING,
        deviceRef: null,
        note: null,
        actorId: H_ACTOR,
      }),
    );
    expect(batch2.importedCount).toBe(1);
    expect(batch2.quarantineCount).toBe(1);
    const overlaps = await withTenant(TENANT_H, () =>
      importSvc.anomalies({ batchId: batch2.id }),
    );
    expect(overlaps.rows[0]!.reason).toBe("ALREADY_IMPORTED");

    const day12 = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-12"));
    const i2Row12 = day12.rows.find((row) => row.employeeCode === "EMP-I2");
    expect(i2Row12).toBeDefined();
    expect(i2Row12!.source).toBe("IMPORT");
    // I2 is unrostered on 06-12 → PRESENT with the raw span.
    expect(i2Row12!.derivedStatus).toBe("PRESENT");
    expect(i2Row12!.workedMinutes).toBe(240);

    const batches = await withTenant(TENANT_H, () => importSvc.batches({}));
    expect(batches.total).toBe(2);
  });

  it("(c) THE QUARANTINE REVIEW — REJECT, and IMPORT-with-corrections riding the SAME capture laws (an overlap is the typed refusal, the anomaly stays PENDING)", async () => {
    const pending = await withTenant(TENANT_H, () => importSvc.anomalies({ status: "PENDING" }));
    expect(pending.total).toBe(8); // 7 from batch 1 + 1 from batch 2

    // REJECT the OUT_OF_RANGE line — the note is the verdict.
    const outOfRange = pending.rows.find((row) => row.reason === "OUT_OF_RANGE")!;
    const rejected = await withTenant(TENANT_H, () =>
      importSvc.resolve({
        anomalyId: outOfRange.id,
        action: "REJECT",
        note: "device clock reset — ignore",
        actorId: H_ACTOR,
      }),
    );
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.resolutionNote).toBe("device clock reset — ignore");
    expect(rejected.resolvedBy).toBe(H_ACTOR);

    // The UNKNOWN_EMPLOYEE line: a correction that OVERLAPS I2's
    // 06-11 session (08:00→12:00) is the typed INV-031 refusal — and
    // the anomaly STAYS PENDING (no partial state).
    const unknown = pending.rows.find((row) => row.reason === "UNKNOWN_EMPLOYEE")!;
    await expect(
      withTenant(TENANT_H, () =>
        importSvc.resolve({
          anomalyId: unknown.id,
          action: "IMPORT",
          employeeId: spec.fixture!.employeeI2Id,
          checkIn: "2026-06-11T09:00:00+03:00",
          checkOut: "2026-06-11T10:00:00+03:00",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_SESSION_OVERLAP" });
    const stillPending = await withTenant(TENANT_H, () =>
      importSvc.anomalies({ status: "PENDING" }),
    );
    expect(stillPending.rows.some((row) => row.id === unknown.id)).toBe(true);

    // The NON-overlapping correction imports: a second I2 session on
    // 06-11 (13:00→14:00) — the day re-derives (worked 240 + 60 − 30).
    const resolved = await withTenant(TENANT_H, () =>
      importSvc.resolve({
        anomalyId: unknown.id,
        action: "IMPORT",
        employeeId: spec.fixture!.employeeI2Id,
        checkIn: "2026-06-11T13:00:00+03:00",
        checkOut: "2026-06-11T14:00:00+03:00",
        note: "mapped EMP-XX → EMP-I2 (the card reprint)",
        actorId: H_ACTOR,
      }),
    );
    expect(resolved.status).toBe("RESOLVED");
    const day11 = await withTenant(TENANT_H, () => attendanceSvc.register("2026-06-11"));
    const i2Rows = day11.rows.filter((row) => row.employeeCode === "EMP-I2");
    expect(i2Rows).toHaveLength(2);
    expect(i2Rows.every((row) => row.derivedStatus === "PRESENT")).toBe(true);
    expect(i2Rows.every((row) => row.workedMinutes === 270)).toBe(true);
    expect(i2Rows.every((row) => row.source === "IMPORT")).toBe(true);

    // The lifecycle: a resolved anomaly never resolves twice; an
    // unknown id is the A7 typed not-found.
    await expect(
      withTenant(TENANT_H, () =>
        importSvc.resolve({
          anomalyId: unknown.id,
          action: "REJECT",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_ANOMALY_RESOLVED" });
    await expect(
      withTenant(TENANT_H, () =>
        importSvc.resolve({
          anomalyId: "00000000-0000-4000-8000-0000000000aa",
          action: "REJECT",
          note: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_ANOMALY_NOT_FOUND" });

    // The status filter: 6 PENDING remain (7 + 1 − REJECT − RESOLVED).
    const afterReview = await withTenant(TENANT_H, () =>
      importSvc.anomalies({ status: "PENDING" }),
    );
    expect(afterReview.total).toBe(6);
  });

  it("(d) THE MAPPING — the code-level default, the per-tenant stored mapping, and the per-request override", async () => {
    // Nothing stored yet (the beforeAll purge): the effective mapping
    // is the ZKTeco-style default.
    const initial = await withTenant(TENANT_H, () => importSvc.effectiveMapping());
    expect(initial.stored).toBe(false);
    expect(initial.mapping).toEqual(DEFAULT_IMPORT_MAPPING);

    // A stored custom mapping: semicolon-delimited, direction-less
    // (alternating pairing), DMY timestamps, no header.
    const custom = {
      employeeCode: 0,
      timestamp: 1,
      direction: null,
      deviceRef: null,
      timestampFormat: "DMY" as const,
      skipHeader: false,
      delimiter: ";" as const,
    };
    await withTenant(TENANT_H, () => importSvc.saveMapping(custom, H_ACTOR));
    const storedNow = await withTenant(TENANT_H, () => importSvc.effectiveMapping());
    expect(storedNow.stored).toBe(true);
    expect(storedNow.mapping).toEqual(custom);

    const dmyContent = ["EMP-I1;13/06/2026 08:00", "EMP-I1;13/06/2026 15:30"].join("\n");
    // The STORED mapping interprets the file (no override): one
    // direction-less alternating session.
    const viaStored = await withTenant(TENANT_H, () => importSvc.preview({ content: dmyContent }));
    expect(viaStored.sessions).toHaveLength(1);
    expect(viaStored.sessions[0]!.checkInNaive).toBe("2026-06-13 08:00:00");
    expect(viaStored.sessions[0]!.checkOutNaive).toBe("2026-06-13 15:30:00");

    // The per-request OVERRIDE wins over the stored mapping (the
    // wizard's try-before-save): the same file read with the DEFAULT
    // mapping refuses the DMY timestamps as INVALID_ROW.
    const viaOverride = await withTenant(TENANT_H, () =>
      importSvc.preview({ content: dmyContent, mapping: DEFAULT_IMPORT_MAPPING }),
    );
    expect(viaOverride.sessions).toHaveLength(0);
    expect(viaOverride.anomalies.every((anomaly) => anomaly.reason === "INVALID_ROW")).toBe(true);

    // The bad-mapping refusals, typed.
    await expect(
      withTenant(TENANT_H, () =>
        importSvc.saveMapping({ ...custom, employeeCode: 99 }, H_ACTOR),
      ),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_INVALID" });

    // Reset to the default (order-independence for the suite's world).
    await withTenant(TENANT_H, () => importSvc.saveMapping(DEFAULT_IMPORT_MAPPING, H_ACTOR));
  });

  it("(e) THE TENANT BOUNDARY — the empty boundary tenant sees none of tenant H's log or quarantine, and its RLS hides H's employees", async () => {
    const foreignBatches = await withTenant(TENANT_H_RLS, () => importSvc.batches({}));
    expect(foreignBatches.total).toBe(0);
    const foreignAnomalies = await withTenant(TENANT_H_RLS, () => importSvc.anomalies({}));
    expect(foreignAnomalies.total).toBe(0);

    // A preview in the boundary tenant: tenant H's employee codes are
    // invisible under its RLS → UNKNOWN_EMPLOYEE, zero sessions.
    const preview = await withTenant(TENANT_H_RLS, () =>
      importSvc.preview({
        content: ["User ID,Timestamp,Direction,Device", "EMP-I1,2026-06-11 08:05:00,in,ZK-01"].join("\n"),
      }),
    );
    expect(preview.sessions).toHaveLength(0);
    expect(preview.anomalies).toHaveLength(1);
    expect(preview.anomalies[0]!.reason).toBe("UNKNOWN_EMPLOYEE");

    // The empty-content and oversized refusals, typed.
    await expect(
      withTenant(TENANT_H, () => importSvc.preview({ content: "" })),
    ).rejects.toMatchObject({ code: "ATTENDANCE_IMPORT_INVALID" });
  });
});
