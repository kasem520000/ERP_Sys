/**
 * PHASE-047 (W-4 — T-10, D-07) — the external HR bridges' PURE layer:
 * the three export contracts' documented field lists (amendment A-4's
 * PII cross-check made STRUCTURAL — the forbidden axes are a typed
 * list and the unit spec pins that no contract column ever intersects
 * it), the CSV/JSON rendering laws, and the two import paths' per-row
 * validators (typed rejection reasons — the attendance-import
 * precedent's discipline, pure so the DB spec and the HTTP layer ride
 * the SAME laws).
 *
 * THE EXPORT CONTRACTS (the integrations README's documented bridges —
 * `docs/api/integrations/README.md` §3.10; NOT report-registry
 * contracts: the reporting registry stays 106 until W-6's four, per
 * the plan §0's baselines):
 *
 * - `hr.employee-master` v1 — the person + employment master: code,
 *   names, contract type, employment status, hire/termination dates.
 *   Permission plane: `payroll.employees.view` (the 045 bridge-read
 *   precedent — the master's own read key).
 * - `hr.employment-org-snapshot` v1 — the employment record enriched
 *   with the D-01 placement extension + the org snapshot axes: one row
 *   per employee, the position (code/title/grade/status), the org unit
 *   (code/names/path/active), and the reports-to position code. A
 *   position-less employee ships with empty placement columns (the
 *   master stays valid — D-01's own law); an org unit with no holders
 *   is the org plane's own surface (the snapshot is the employment
 *   VIEW of the org, the documented boundary). Permission plane:
 *   `payroll.employees.view`.
 * - `hr.appraisal-results` v1 — the appraisal OUTCOMES: one row per
 *   (cycle × reviewee) MANAGER review in SUBMITTED/CALIBRATED state —
 *   overall score, goal rollup, review status. BR-090's posture holds
 *   at the bridge BY CONSTRUCTION: the 360 input rows (SELF/PEER/
 *   SUBORDINATE) never ship and no reviewer column exists — an
 *   attributed source never leaves the platform through the bridge.
 *   The scorecard detail (per-competency levels) stays in-app (the
 *   v1 boundary, documented). Permission plane:
 *   `hr.performance.view`.
 *
 * AMENDMENT A-4 (the PII cross-check, binding): every contract's field
 * list was checked against the PII inventory (DATA_PROTECTION §3) at
 * implementation — the payslips/remittance precedent governs: employee
 * code + name; NEVER national_id / bank fields / document numbers /
 * nationality / probation end; no free-form notes/comments (the
 * minimization rule); no payroll money axes. The forbidden list is the
 * typed constant below and the unit spec walks EVERY contract column
 * against it — the law is structural, not a one-time review.
 *
 * THE RENDERING LAWS (the reporting module's CSV discipline, the 046
 * remittance-export precedent — reimplemented here because hr may not
 * import reporting's internals: DEPENDENCY_RULES §1 — `application/`
 * may import other modules' `api/` surfaces only, and the renderer is
 * not one): UTF-8 with BOM (Excel Arabic — ADR-0011), RFC 4180
 * quoting, CRLF line endings, `.` decimals, ISO-8601 dates, header row
 * in the export locale. JSON = the same rows under a self-describing
 * envelope (contract id + version + generatedAt + locale + columns +
 * rowCount — machine-to-machine, no totals block: these are data
 * exchanges, not statements).
 *
 * THE IMPORT ROW LAWS (the two paths, acceptance #9's bad-row report):
 * every row is validated PURE FIRST (shape → typed
 * `INVALID_FIELD`/`SELF_KIND_MISMATCH`), then the service resolves the
 * code axes and rides the SAME submission/enrollment machinery the
 * in-app surfaces ride (the laws are literally the same code paths —
 * the row report's reasons extend, never replace, the typed error
 * taxonomy). The first occurrence of a repeated natural key in one
 * file proceeds; the rest are `DUPLICATE_IN_FILE` (the attendance
 * import's collapse law — nothing lands twice, nothing silently).
 */

// ── The export contracts (D-07's three documented bridges) ─────────────────

export interface BridgeColumn {
  /** The stable field key — the contract's axis (never localized). */
  readonly id: string;
  /** The CSV/JSON header label at locale=en. */
  readonly labelEn: string;
  /** The CSV/JSON header label at locale=ar. */
  readonly labelAr: string;
}

/**
 * AMENDMENT A-4's forbidden axes — the PII inventory's employee-plane
 * members + the free-form fields (the minimization rule: no notes/
 * comments/scorecards in exports) + the payroll money axes the bridge
 * master never carries. A contract column id may never intersect this
 * list (the unit spec pins it — the structural cross-check).
 */
export const PII_FORBIDDEN_COLUMN_IDS: readonly string[] = [
  // The PII inventory's employee-plane fields (DATA_PROTECTION §3):
  "nationalId", // employees.national_id — never in exports
  "bankName", // employees.bank_name — never in exports
  "bankIban", // employees.bank_iban — never in exports
  "bankAccount", // employees.bank_account — never in exports
  "nationality", // employees.nationality (046 D-02) — payroll-plane only
  "probationEnd", // employees.probation_end (047 D-02/A-1) — the sweep's probe, never an export axis
  "documentNumber", // employee_documents.number (047 A-4) — never in exports
  "email", // applicant/user contact — never in exports
  "phone", // applicant/user contact — never in exports
  // The free-form fields (the minimization rule):
  "notes",
  "comments",
  "scorecard",
  // The payroll money axes (the payslips precedent's identity-file law):
  "basicSalary",
];

export const EMPLOYEE_MASTER_COLUMNS: readonly BridgeColumn[] = [
  { id: "employeeCode", labelEn: "Employee Code", labelAr: "رمز الموظف" },
  { id: "employeeName", labelEn: "Employee Name", labelAr: "اسم الموظف" },
  { id: "employeeNameAr", labelEn: "Employee Name (AR)", labelAr: "الاسم العربي للموظف" },
  { id: "contractType", labelEn: "Contract Type", labelAr: "نوع العقد" },
  { id: "employmentStatus", labelEn: "Employment Status", labelAr: "حالة التوظيف" },
  { id: "hireDate", labelEn: "Hire Date", labelAr: "تاريخ التعيين" },
  { id: "terminationDate", labelEn: "Termination Date", labelAr: "تاريخ انتهاء الخدمة" },
];

export const EMPLOYMENT_ORG_SNAPSHOT_COLUMNS: readonly BridgeColumn[] = [
  { id: "employeeCode", labelEn: "Employee Code", labelAr: "رمز الموظف" },
  { id: "employeeName", labelEn: "Employee Name", labelAr: "اسم الموظف" },
  { id: "hireDate", labelEn: "Hire Date", labelAr: "تاريخ التعيين" },
  { id: "terminationDate", labelEn: "Termination Date", labelAr: "تاريخ انتهاء الخدمة" },
  { id: "employmentStatus", labelEn: "Employment Status", labelAr: "حالة التوظيف" },
  { id: "positionCode", labelEn: "Position Code", labelAr: "رمز الوظيفة" },
  { id: "positionTitle", labelEn: "Position Title", labelAr: "مسمى الوظيفة" },
  { id: "positionTitleAr", labelEn: "Position Title (AR)", labelAr: "المسمى العربي للوظيفة" },
  { id: "positionGrade", labelEn: "Position Grade", labelAr: "درجة الوظيفة" },
  { id: "positionStatus", labelEn: "Position Status", labelAr: "حالة الوظيفة" },
  { id: "orgUnitCode", labelEn: "Org Unit Code", labelAr: "رمز الوحدة التنظيمية" },
  { id: "orgUnitName", labelEn: "Org Unit Name", labelAr: "اسم الوحدة التنظيمية" },
  { id: "orgUnitNameAr", labelEn: "Org Unit Name (AR)", labelAr: "الاسم العربي للوحدة" },
  { id: "orgUnitPath", labelEn: "Org Unit Path", labelAr: "مسار الوحدة التنظيمية" },
  { id: "orgUnitActive", labelEn: "Org Unit Active", labelAr: "الوحدة نشطة" },
  { id: "reportsToPositionCode", labelEn: "Reports-To Position Code", labelAr: "رمز الوظيفة المشرفية" },
];

export const APPRAISAL_RESULTS_COLUMNS: readonly BridgeColumn[] = [
  { id: "cycleId", labelEn: "Cycle ID", labelAr: "معرّف الدورة" },
  { id: "cycleName", labelEn: "Cycle Name", labelAr: "اسم الدورة" },
  { id: "cyclePeriodStart", labelEn: "Cycle Period Start", labelAr: "بداية فترة الدورة" },
  { id: "cyclePeriodEnd", labelEn: "Cycle Period End", labelAr: "نهاية فترة الدورة" },
  { id: "cycleStatus", labelEn: "Cycle Status", labelAr: "حالة الدورة" },
  { id: "employeeCode", labelEn: "Employee Code", labelAr: "رمز الموظف" },
  { id: "employeeName", labelEn: "Employee Name", labelAr: "اسم الموظف" },
  { id: "overallScore", labelEn: "Overall Score", labelAr: "الدرجة الكلية" },
  { id: "goalRollup", labelEn: "Goal Rollup", labelAr: "محصلة الأهداف" },
  { id: "reviewStatus", labelEn: "Review Status", labelAr: "حالة التقييم" },
];

export interface BridgeContract {
  readonly id: string;
  readonly version: number;
  readonly columns: readonly BridgeColumn[];
}

export const BRIDGE_CONTRACTS: readonly BridgeContract[] = [
  { id: "hr.employee-master", version: 1, columns: EMPLOYEE_MASTER_COLUMNS },
  { id: "hr.employment-org-snapshot", version: 1, columns: EMPLOYMENT_ORG_SNAPSHOT_COLUMNS },
  { id: "hr.appraisal-results", version: 1, columns: APPRAISAL_RESULTS_COLUMNS },
];

export function bridgeContract(id: string): BridgeContract {
  const contract = BRIDGE_CONTRACTS.find((candidate) => candidate.id === id);
  if (contract === undefined) {
    throw new Error(`unknown bridge contract: ${id}`);
  }
  return contract;
}

/**
 * AMENDMENT A-4's structural cross-check: the contract column ids that
 * intersect the forbidden list (empty = the law holds). The unit spec
 * pins this empty for EVERY contract; the service never needs to call
 * it at runtime — it is the check's typed shape.
 */
export function forbiddenColumnsIn(contractId: string): string[] {
  const contract = bridgeContract(contractId);
  return contract.columns
    .map((column) => column.id)
    .filter((id) => PII_FORBIDDEN_COLUMN_IDS.includes(id));
}

// ── The rendering (CSV/JSON — the 046 remittance precedent's laws) ─────────

export type BridgeExportFormat = "csv" | "json";
export type BridgeExportLocale = "ar" | "en";

/** One export row: the contract's column ids as keys (string | null). */
export type BridgeExportRow = Readonly<Record<string, string | null>>;

export interface BridgeExportInput {
  readonly contractId: string;
  readonly locale: BridgeExportLocale;
  readonly generatedAt: string;
  readonly rows: readonly BridgeExportRow[];
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The CSV rendering: UTF-8 BOM (Excel Arabic — ADR-0011), RFC 4180
 * quoting, CRLF line endings, the header row in the export locale,
 * empty cells for null. Machine-to-machine: header + rows only — the
 * metadata (contract/version/generatedAt) rides the JSON envelope and
 * the filename, never a footer line (the data-exchange shape, the
 * offboarding export's "CSV alternates for core lists" precedent).
 */
export function renderBridgeCsv(input: BridgeExportInput): Buffer {
  const contract = bridgeContract(input.contractId);
  const header = contract.columns
    .map((column) => csvCell(input.locale === "ar" ? column.labelAr : column.labelEn))
    .join(",");
  const lines = [header];
  for (const row of input.rows) {
    lines.push(
      contract.columns
        .map((column) => {
          const value = row[column.id];
          return csvCell(value === null || value === undefined ? "" : String(value));
        })
        .join(","),
    );
  }
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

/** The JSON envelope's column shape (the label resolved per locale). */
export interface BridgeJsonColumn {
  readonly id: string;
  readonly label: string;
}

export interface BridgeJsonEnvelope {
  readonly contract: string;
  readonly version: number;
  readonly generatedAt: string;
  readonly locale: BridgeExportLocale;
  readonly columns: readonly BridgeJsonColumn[];
  readonly rowCount: number;
  readonly rows: readonly BridgeExportRow[];
}

/** The JSON rendering: the same rows under the self-describing
 * envelope (stable contract id + version so consumers can pin). */
export function buildBridgeJson(input: BridgeExportInput): BridgeJsonEnvelope {
  const contract = bridgeContract(input.contractId);
  return {
    contract: contract.id,
    version: contract.version,
    generatedAt: input.generatedAt,
    locale: input.locale,
    columns: contract.columns.map((column) => ({
      id: column.id,
      label: input.locale === "ar" ? column.labelAr : column.labelEn,
    })),
    rowCount: input.rows.length,
    rows: input.rows,
  };
}

// ── The import paths (D-07's two, with row-level validation reports) ───────

/** The import ceiling: one file's bounded batch (the attendance
 * import's MAX_FILE_ROWS law — a bigger file is a deliberate
 * migration, not a bridge import; the typed file-level refusal). */
export const BRIDGE_IMPORT_MAX_ROWS = 5_000;

/** The free-form text ceiling (the attendance import's TEXT law). */
const TEXT_MAX = 4_000;
/** The code-axis shape (the talent family's CODE_RE). */
const CODE_RE = /^[\w\-. ]{1,64}$/;
/** The 2-dp decimal-string law (exact, never float — ADR-0009). */
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;

/** The typed rejection reasons (the report's vocabulary — the
 * attendance-import precedent's anomaly taxonomy, extended with the
 * talent plane's own laws). */
export type BridgeImportRejection =
  | "INVALID_FIELD"
  | "SELF_KIND_MISMATCH"
  | "DUPLICATE_IN_FILE"
  | "UNKNOWN_REVIEWEE"
  | "UNKNOWN_REVIEWER"
  | "UNKNOWN_COMPETENCY"
  | "NOT_IN_CYCLE_SCOPE"
  | "ALREADY_SUBMITTED"
  | "GOAL_WEIGHTS_INVALID"
  | "LEVEL_INVALID"
  | "UNKNOWN_PROGRAM"
  | "UNKNOWN_EMPLOYEE"
  | "PROGRAM_RETIRED"
  | "ALREADY_COMPLETED"
  | "ENROLLMENT_WITHDRAWN";

/** One appraisal-results import row (the external system's shape: the
 * code axes + the scorecard by competency CODE — external files speak
 * codes, never internal uuids; the service translates before riding
 * the in-app submission machinery). */
export interface AppraisalImportRow {
  readonly revieweeCode: string;
  readonly reviewerCode: string;
  readonly kind: "MANAGER" | "SELF" | "PEER" | "SUBORDINATE";
  readonly overallScore: string | null;
  readonly competencyScores: Readonly<Record<string, number>>;
  readonly comments: string | null;
}

const APPRAISAL_KINDS = new Set(["MANAGER", "SELF", "PEER", "SUBORDINATE"]);

export type RowValidation<T> =
  | { readonly ok: true; readonly row: T }
  | { readonly ok: false; readonly reason: BridgeImportRejection; readonly detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, what: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error(`${what} must be a string when present`);
  return value;
}

/**
 * The appraisal row's PURE laws (shape only — the code axes' existence,
 * the cycle window, the scorecard dictionary and BR-089 are the
 * service's, resolved against the tenant's data):
 * - the kind is the fixed enum;
 * - the SELF ⇔ reviewer==reviewee law (the 0095 CHECK — derivable
 *   pre-DB: equal codes ⇒ equal ids);
 * - overallScore is a 2-dp decimal string in [0…100] or null (null is
 *   legal on MANAGER rows only — the 360 input contract);
 * - competencyScores is an object of competency CODE → integer level
 *   1–5 (the tenant's scale band);
 * - comments ≤ 4,000 chars.
 */
export function validateAppraisalImportRow(raw: unknown): RowValidation<AppraisalImportRow> {
  if (!isRecord(raw)) {
    return { ok: false, reason: "INVALID_FIELD", detail: "the row must be a JSON object" };
  }
  const { revieweeCode, reviewerCode, kind, overallScore, competencyScores, comments } = raw;
  if (typeof revieweeCode !== "string" || !CODE_RE.test(revieweeCode)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `revieweeCode must be 1–64 characters of letters/digits/dash/dot/space: ${String(revieweeCode)}`,
    };
  }
  if (typeof reviewerCode !== "string" || !CODE_RE.test(reviewerCode)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `reviewerCode must be 1–64 characters of letters/digits/dash/dot/space: ${String(reviewerCode)}`,
    };
  }
  if (typeof kind !== "string" || !APPRAISAL_KINDS.has(kind)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `kind must be one of MANAGER/SELF/PEER/SUBORDINATE: ${String(kind)}`,
    };
  }
  if (kind === "SELF" && reviewerCode !== revieweeCode) {
    return {
      ok: false,
      reason: "SELF_KIND_MISMATCH",
      detail: "a SELF review's reviewer IS the reviewee (the 0095 natural-key law)",
    };
  }
  if (kind !== "SELF" && reviewerCode === revieweeCode) {
    return {
      ok: false,
      reason: "SELF_KIND_MISMATCH",
      detail: `a ${kind} review requires reviewer ≠ reviewee (the 0095 natural-key law)`,
    };
  }
  let score: string | null = null;
  try {
    score = optionalText(overallScore, "overallScore");
  } catch (error) {
    return { ok: false, reason: "INVALID_FIELD", detail: (error as Error).message };
  }
  if (score !== null && !PCT_RE.test(score)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `overallScore must be a 2-dp decimal string like "87.50" within [0 … 100]: ${score}`,
    };
  }
  if (score !== null) {
    const scaled = Number.parseInt(score.replace(".", ""), 10);
    if (scaled > 10_000) {
      return {
        ok: false,
        reason: "INVALID_FIELD",
        detail: `overallScore must be within [0 … 100]: ${score}`,
      };
    }
  }
  if (kind !== "MANAGER" && score === null) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `a ${kind} input carries an overallScore — it is the 360 aggregate's input contract`,
    };
  }
  if (competencyScores === undefined) {
    return { ok: false, reason: "INVALID_FIELD", detail: "competencyScores is required ({} for none)" };
  }
  if (!isRecord(competencyScores)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: "competencyScores must be an object of competency code → level 1–5",
    };
  }
  for (const [code, level] of Object.entries(competencyScores)) {
    if (!CODE_RE.test(code)) {
      return {
        ok: false,
        reason: "INVALID_FIELD",
        detail: `competencyScores key must be a competency code (1–64 chars): ${code}`,
      };
    }
    if (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 5) {
      return {
        ok: false,
        reason: "INVALID_FIELD",
        detail: `competencyScores["${code}"] must be an integer level 1–5: ${String(level)}`,
      };
    }
  }
  let notes: string | null = null;
  try {
    notes = optionalText(comments, "comments");
  } catch (error) {
    return { ok: false, reason: "INVALID_FIELD", detail: (error as Error).message };
  }
  if (notes !== null && notes.length > TEXT_MAX) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `comments must be at most ${TEXT_MAX} characters: ${notes.length}`,
    };
  }
  return {
    ok: true,
    row: {
      revieweeCode,
      reviewerCode,
      kind: kind as AppraisalImportRow["kind"],
      overallScore: score,
      competencyScores: competencyScores as Record<string, number>,
      comments: notes,
    },
  };
}

/** One training-completions import row (the code axes + the completion
 * payload the enrollment update rides). */
export interface TrainingImportRow {
  readonly programCode: string;
  readonly employeeCode: string;
  readonly attendancePct: string | null;
  readonly completionPct: string | null;
  readonly result: "PENDING" | "PASSED" | "FAILED";
  readonly notes: string | null;
}

const TRAINING_RESULTS = new Set(["PENDING", "PASSED", "FAILED"]);

/**
 * The training row's PURE laws: the code axes' shape, the percentages
 * (2-dp decimal strings in [0…100] or null), the fixed result enum,
 * the notes ceiling.
 */
export function validateTrainingImportRow(raw: unknown): RowValidation<TrainingImportRow> {
  if (!isRecord(raw)) {
    return { ok: false, reason: "INVALID_FIELD", detail: "the row must be a JSON object" };
  }
  const { programCode, employeeCode, attendancePct, completionPct, result, notes } = raw;
  if (typeof programCode !== "string" || !CODE_RE.test(programCode)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `programCode must be 1–64 characters of letters/digits/dash/dot/space: ${String(programCode)}`,
    };
  }
  if (typeof employeeCode !== "string" || !CODE_RE.test(employeeCode)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `employeeCode must be 1–64 characters of letters/digits/dash/dot/space: ${String(employeeCode)}`,
    };
  }
  const percents: [string, string | null][] = [];
  for (const [name, value] of [
    ["attendancePct", attendancePct],
    ["completionPct", completionPct],
  ] as const) {
    let parsed: string | null = null;
    try {
      parsed = optionalText(value, name);
    } catch (error) {
      return { ok: false, reason: "INVALID_FIELD", detail: (error as Error).message };
    }
    if (parsed !== null && !PCT_RE.test(parsed)) {
      return {
        ok: false,
        reason: "INVALID_FIELD",
        detail: `${name} must be a 2-dp decimal string like "87.50" within [0 … 100]: ${parsed}`,
      };
    }
    if (parsed !== null) {
      const scaled = Number.parseInt(parsed.replace(".", ""), 10);
      if (scaled > 10_000) {
        return {
          ok: false,
          reason: "INVALID_FIELD",
          detail: `${name} must be within [0 … 100]: ${parsed}`,
        };
      }
    }
    percents.push([name, parsed]);
  }
  if (typeof result !== "string" || !TRAINING_RESULTS.has(result)) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `result must be one of PENDING/PASSED/FAILED: ${String(result)}`,
    };
  }
  let note: string | null = null;
  try {
    note = optionalText(notes, "notes");
  } catch (error) {
    return { ok: false, reason: "INVALID_FIELD", detail: (error as Error).message };
  }
  if (note !== null && note.length > TEXT_MAX) {
    return {
      ok: false,
      reason: "INVALID_FIELD",
      detail: `notes must be at most ${TEXT_MAX} characters: ${note.length}`,
    };
  }
  return {
    ok: true,
    row: {
      programCode,
      employeeCode,
      attendancePct: percents[0]![1],
      completionPct: percents[1]![1],
      result: result as TrainingImportRow["result"],
      notes: note,
    },
  };
}

// ── The row-level validation report (acceptance #9's shape) ────────────────

/** One report entry: accepted (the created record's id — traceability)
 * or rejected (the typed reason + the raw row — the evidence, the
 * attendance import's rawLine law). */
export interface BridgeImportReportEntry {
  readonly index: number;
  readonly status: "ACCEPTED" | "REJECTED";
  readonly reason?: BridgeImportRejection;
  readonly detail?: string;
  /** The raw row as submitted (the evidence). */
  readonly row: unknown;
  /** The created review id (appraisal, accepted rows only). */
  readonly reviewId?: string;
  /** The enrollment id (training, accepted rows only). */
  readonly enrollmentId?: string;
}

export interface BridgeImportReport {
  readonly kind: "appraisal-results" | "training-completions";
  readonly totalCount: number;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly rows: readonly BridgeImportReportEntry[];
}
