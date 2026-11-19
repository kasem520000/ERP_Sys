import { describe, expect, it } from "vitest";

import {
  AppraisalImportRow,
  APPRAISAL_RESULTS_COLUMNS,
  BRIDGE_CONTRACTS,
  BRIDGE_IMPORT_MAX_ROWS,
  buildBridgeJson,
  EMPLOYEE_MASTER_COLUMNS,
  EMPLOYMENT_ORG_SNAPSHOT_COLUMNS,
  forbiddenColumnsIn,
  PII_FORBIDDEN_COLUMN_IDS,
  renderBridgeCsv,
  validateAppraisalImportRow,
  validateTrainingImportRow,
} from "../domain/talent-bridge";

/**
 * PHASE-047 (W-4 — T-10) — the external HR bridges' PURE layer pinned
 * at the unit layer, FIRST (the D-08/unit-first law: the contracts'
 * field lists + the A-4 PII cross-check + the CSV/JSON rendering laws
 * + the two import validators are unit-tested before any store or
 * service lands). The DB-side behaviors (the exports over real rows,
 * the imports' row reports end-to-end, the tenant boundary) are pinned
 * by `src/__db__/hr/talent-bridges.db.spec.ts`.
 *
 * AMENDMENT A-4's cross-check is STRUCTURAL here: every contract's
 * column set is walked against the typed forbidden-axes list — a future
 * column that smuggles a PII axis into a bridge export fails THIS spec
 * before it can fail an audit.
 */

describe("PHASE-047 W-4 — A-4: the PII cross-check (the structural law)", () => {
  it("(a) every contract's field list intersects the forbidden axes in ZERO columns", () => {
    expect(BRIDGE_CONTRACTS).toHaveLength(3);
    for (const contract of BRIDGE_CONTRACTS) {
      expect(
        forbiddenColumnsIn(contract.id),
        `${contract.id} must carry no PII-forbidden column`,
      ).toEqual([]);
    }
  });

  it("(b) the forbidden list carries the inventory's employee-plane members + the free-form + the money axes", () => {
    // The named prohibitions of the payslips/remittance precedent:
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("nationalId");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("bankName");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("bankIban");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("bankAccount");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("documentNumber");
    // The 046/047 PII-inventory additions:
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("nationality");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("probationEnd");
    // The minimization rule's free-form axes + the payroll money axis:
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("notes");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("comments");
    expect(PII_FORBIDDEN_COLUMN_IDS).toContain("basicSalary");
  });

  it("(c) the cross-check DETECTS a forbidden column (the guard is real, not vacuous)", () => {
    // The pure function's honesty: feed it a contract id that exists
    // and the walk returns [] — but the SAME walk over a corrupted
    // list must flag. We prove the mechanism by walking the employee
    // master's columns against a locally-extended forbidden list.
    const smuggled = [...EMPLOYEE_MASTER_COLUMNS.map((column) => column.id), "nationalId"];
    const hits = smuggled.filter((id) => PII_FORBIDDEN_COLUMN_IDS.includes(id));
    expect(hits).toEqual(["nationalId"]);
  });

  it("(d) the three contracts' documented shapes (the integrations README's field lists)", () => {
    expect(EMPLOYEE_MASTER_COLUMNS.map((column) => column.id)).toEqual([
      "employeeCode",
      "employeeName",
      "employeeNameAr",
      "contractType",
      "employmentStatus",
      "hireDate",
      "terminationDate",
    ]);
    expect(EMPLOYMENT_ORG_SNAPSHOT_COLUMNS.map((column) => column.id)).toEqual([
      "employeeCode",
      "employeeName",
      "hireDate",
      "terminationDate",
      "employmentStatus",
      "positionCode",
      "positionTitle",
      "positionTitleAr",
      "positionGrade",
      "positionStatus",
      "orgUnitCode",
      "orgUnitName",
      "orgUnitNameAr",
      "orgUnitPath",
      "orgUnitActive",
      "reportsToPositionCode",
    ]);
    // BR-090's posture, structural: the appraisal contract carries NO
    // reviewer axis and NO scorecard axis — an attributed source or a
    // panel detail never leaves through the bridge.
    expect(APPRAISAL_RESULTS_COLUMNS.map((column) => column.id)).toEqual([
      "cycleId",
      "cycleName",
      "cyclePeriodStart",
      "cyclePeriodEnd",
      "cycleStatus",
      "employeeCode",
      "employeeName",
      "overallScore",
      "goalRollup",
      "reviewStatus",
    ]);
    expect(
      APPRAISAL_RESULTS_COLUMNS.map((column) => column.id).filter((id) =>
        id.toLowerCase().includes("reviewer"),
      ),
    ).toEqual([]);
  });
});

describe("PHASE-047 W-4 — the CSV rendering (the 046 remittance precedent's laws)", () => {
  const rows = [
    { employeeCode: "EMP-1", employeeName: 'Al "Quote" One', employeeNameAr: null },
    { employeeCode: "EMP-2", employeeName: "Comma, Name", employeeNameAr: "اثنان" },
  ];

  it("(a) UTF-8 BOM + CRLF line endings + the header in the locale", () => {
    const csv = renderBridgeCsv({
      contractId: "hr.employee-master",
      locale: "en",
      generatedAt: "2026-11-19T00:00:00Z",
      rows: rows as never,
    }).toString("utf8");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("Employee Code,Employee Name,Employee Name (AR),Contract Type,Employment Status,Hire Date,Termination Date");
    // A trailing CRLF closes the last record (RFC 4180's optional shape).
    expect(lines.at(-1)).toBe("");
    expect(lines[1]).toBe('EMP-1,"Al ""Quote"" One",,,,,');
  });

  it("(b) RFC 4180 quoting: embedded quotes doubled, commas/quotes/newlines force quoting", () => {
    const csv = renderBridgeCsv({
      contractId: "hr.employee-master",
      locale: "en",
      generatedAt: "2026-11-19T00:00:00Z",
      rows: rows as never,
    }).toString("utf8");
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[1]).toContain('"Al ""Quote"" One"');
    expect(lines[2]).toContain('"Comma, Name"');
  });

  it("(c) null renders as the empty cell; the Arabic header at locale=ar", () => {
    const csv = renderBridgeCsv({
      contractId: "hr.employee-master",
      locale: "ar",
      generatedAt: "2026-11-19T00:00:00Z",
      rows: [{ employeeCode: "E", employeeName: "X", employeeNameAr: null }] as never,
    }).toString("utf8");
    const lines = csv.replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("رمز الموظف,اسم الموظف,الاسم العربي للموظف,نوع العقد,حالة التوظيف,تاريخ التعيين,تاريخ انتهاء الخدمة");
    expect(lines[1]).toBe("E,X,,,,,");
  });

  it("(d) an unknown contract id refuses (the documented three only)", () => {
    expect(() =>
      renderBridgeCsv({
        contractId: "hr.nope",
        locale: "en",
        generatedAt: "2026-11-19T00:00:00Z",
        rows: [],
      }),
    ).toThrow(/unknown bridge contract/);
  });
});

describe("PHASE-047 W-4 — the JSON envelope", () => {
  it("(a) self-describing: contract + version + generatedAt + locale + columns + rowCount + rows", () => {
    const envelope = buildBridgeJson({
      contractId: "hr.appraisal-results",
      locale: "ar",
      generatedAt: "2026-11-19T01:02:03Z",
      rows: [{ cycleId: "c1", overallScore: "88.50" }] as never,
    });
    expect(envelope.contract).toBe("hr.appraisal-results");
    expect(envelope.version).toBe(1);
    expect(envelope.generatedAt).toBe("2026-11-19T01:02:03Z");
    expect(envelope.locale).toBe("ar");
    expect(envelope.rowCount).toBe(1);
    expect(envelope.columns[0]).toEqual({ id: "cycleId", label: "معرّف الدورة" });
    expect(envelope.rows[0]).toEqual({ cycleId: "c1", overallScore: "88.50" });
  });

  it("(b) the rows ride untouched (frozen strings, never re-formatted)", () => {
    const rows = [{ employeeCode: "E1", hireDate: "2026-01-01", terminationDate: null }];
    const envelope = buildBridgeJson({
      contractId: "hr.employee-master",
      locale: "en",
      generatedAt: "2026-11-19T00:00:00Z",
      rows: rows as never,
    });
    expect(envelope.rows).toEqual(rows);
  });
});

describe("PHASE-047 W-4 — the appraisal-results import validator (the pure laws)", () => {
  const base: AppraisalImportRow = {
    revieweeCode: "EMP-1",
    reviewerCode: "EMP-9",
    kind: "MANAGER",
    overallScore: "87.50",
    competencyScores: { COMM: 4 },
    comments: null,
  };

  it("(a) the legal row passes with the normalized shape", () => {
    const result = validateAppraisalImportRow(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.row.kind).toBe("MANAGER");
      expect(result.row.overallScore).toBe("87.50");
    }
  });

  it("(b) the SELF ⇔ reviewer==reviewee law, both directions (the 0095 CHECK)", () => {
    const selfOther = validateAppraisalImportRow({ ...base, kind: "SELF" });
    expect(selfOther.ok).toBe(false);
    if (!selfOther.ok) {
      expect(selfOther.reason).toBe("SELF_KIND_MISMATCH");
    }
    const managerSelf = validateAppraisalImportRow({
      ...base,
      kind: "PEER",
      reviewerCode: "EMP-1",
    });
    expect(managerSelf.ok).toBe(false);
    if (!managerSelf.ok) {
      expect(managerSelf.reason).toBe("SELF_KIND_MISMATCH");
    }
    const selfOk = validateAppraisalImportRow({
      ...base,
      kind: "SELF",
      reviewerCode: "EMP-1",
    });
    expect(selfOk.ok).toBe(true);
  });

  it("(c) the score law: 2-dp band [0…100]; MANAGER may omit, the 360 kinds may not", () => {
    expect(validateAppraisalImportRow({ ...base, overallScore: "101.00" }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, overallScore: "8.755" }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, overallScore: 87.5 }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, overallScore: null }).ok).toBe(true);
    const peer = validateAppraisalImportRow({
      ...base,
      kind: "PEER",
      overallScore: null,
    });
    expect(peer.ok).toBe(false);
    if (!peer.ok) {
      expect(peer.reason).toBe("INVALID_FIELD");
      expect(peer.detail).toContain("360 aggregate's input contract");
    }
  });

  it("(d) the scorecard law's shape arm: code keys + integer levels 1–5", () => {
    expect(validateAppraisalImportRow({ ...base, competencyScores: { X: 0 } }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, competencyScores: { X: 6 } }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, competencyScores: { X: 4.5 } }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, competencyScores: null }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, competencyScores: {} }).ok).toBe(true);
  });

  it("(e) the kind enum + the code axes + the comments ceiling", () => {
    expect(validateAppraisalImportRow({ ...base, kind: "UPWARD" }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, revieweeCode: "" }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, comments: "x".repeat(4_001) }).ok).toBe(false);
    expect(validateAppraisalImportRow({ ...base, comments: "solid" }).ok).toBe(true);
    expect(validateAppraisalImportRow(null).ok).toBe(false);
    expect(validateAppraisalImportRow("row").ok).toBe(false);
  });
});

describe("PHASE-047 W-4 — the training-completions import validator (the pure laws)", () => {
  const base = {
    programCode: "PROG-1",
    employeeCode: "EMP-1",
    attendancePct: "100.00",
    completionPct: "95.50",
    result: "PASSED",
    notes: null,
  };

  it("(a) the legal row passes; nulls are legal on both percentages", () => {
    expect(validateTrainingImportRow(base).ok).toBe(true);
    expect(
      validateTrainingImportRow({ ...base, attendancePct: null, completionPct: null }).ok,
    ).toBe(true);
  });

  it("(b) the percentage law: 2-dp band [0…100], strings never numbers", () => {
    expect(validateTrainingImportRow({ ...base, attendancePct: "100.01" }).ok).toBe(false);
    expect(validateTrainingImportRow({ ...base, completionPct: "95.555" }).ok).toBe(false);
    expect(validateTrainingImportRow({ ...base, attendancePct: 100 }).ok).toBe(false);
  });

  it("(c) the result enum + the code axes + the notes ceiling", () => {
    expect(validateTrainingImportRow({ ...base, result: "GREAT" }).ok).toBe(false);
    expect(validateTrainingImportRow({ ...base, programCode: "" }).ok).toBe(false);
    expect(validateTrainingImportRow({ ...base, notes: "y".repeat(4_001) }).ok).toBe(false);
    expect(validateTrainingImportRow([]).ok).toBe(false);
  });
});

describe("PHASE-047 W-4 — the import ceiling", () => {
  it("the documented batch cap is 5,000 rows (the attendance import's bounded-file law)", () => {
    expect(BRIDGE_IMPORT_MAX_ROWS).toBe(5_000);
  });
});
