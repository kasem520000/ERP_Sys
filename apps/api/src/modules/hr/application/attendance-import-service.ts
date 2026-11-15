import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import {
  AttendanceAnomalyNotFoundError,
  AttendanceAnomalyResolvedError,
  AttendanceDuplicatePunchError,
  AttendanceImportAlreadyCommittedError,
  AttendanceImportInvalidError,
  AttendanceRecordInvalidError,
  AttendanceSessionOverlapError,
  EmployeeNotFoundError,
} from "../domain/hr-errors";
import * as importStore from "../infrastructure/attendance-import.store";
import { employeeExists } from "../infrastructure/hr.store";
import { AttendanceService } from "./attendance-service";

/**
 * PHASE-045 (T-05, N-17) — the DEVICE-AGNOSTIC attendance import: a
 * generic CSV adapter covering ZKTeco-style layouts (user id,
 * timestamp, direction, device id) with a CONFIGURABLE column mapping
 * (tenant_settings key `hr.attendance.import.map`, code-level defaults
 * — never a vendor SDK, never a lock-in).
 *
 * THE PIPELINE (preview = the analysis alone, ZERO writes; commit =
 * the same analysis + the log + the records + the quarantine):
 *
 *   parse   → the CSV lines (quoted fields respected; the header row
 *             skipped per the mapping);
 *   shape   → per-line column extraction; a bad shape/timestamp is the
 *             INVALID_ROW quarantine (the raw line is the evidence);
 *   horizon → OUT_OF_RANGE: a punch before today−400d or after
 *             tomorrow (the tenant's tz wall-clock — the import
 *             horizon; a longer backfill is a deliberate migration,
 *             not a device file);
 *   codes   → the employee CODE axis: device files name people by
 *             their printed code; an unknown code is the
 *             UNKNOWN_EMPLOYEE quarantine;
 *   dedupe  → the SAME employee + timestamp twice in ONE file: the
 *             first stays, the rest are DUPLICATE_IN_FILE (the plan's
 *             collapse law — nothing lands twice, nothing silently);
 *   pair    → events pair into sessions per employee-day, sorted by
 *             wall-clock: an IN opens, the next OUT closes; a second
 *             IN while a session is open is DOUBLE_PUNCH_IN; an OUT
 *             with no open session is ORPHAN_PUNCH_OUT; a
 *             direction-less file (no direction column mapped) pairs
 *             ALTERNATELY (1st opens, 2nd closes — the documented
 *             convention; an odd count leaves the last open, the
 *             MISSING_PUNCH derivation's honest signal);
 *   floor   → ALREADY_IMPORTED (the 0081 dedupe floor vs the DB — a
 *             different file with overlapping rows imports the rest)
 *             and SESSION_OVERLAP (INV-031 at import time).
 *
 * THE FINGERPRINT LAW: the committed batch carries the file's sha256
 * and the (tenant, sha256) UNIQUE is the floor — THE SAME FILE NEVER
 * COMMITSS TWICE (the typed refusal carries the original batch's
 * date). A different file with overlapping content imports its fresh
 * rows and quarantines the overlaps — both laws hold.
 *
 * THE QUARANTINE: every refused line lands in
 * attendance_import_anomalies with its raw line + the typed reason,
 * PENDING review; the resolve action is the reviewer's explicit act —
 * REJECT (the note is the verdict) or IMPORT-with-corrections (the
 * corrected session rides the SAME capture laws — shape, envelope,
 * interval, INV-031, the dedupe floor — typed refusals before any
 * write, then source IMPORT + the original batch's traceability).
 *
 * TIME SPACE: the file's timestamps are NAIVE tenant-local wall-clocks
 * (device clocks have no offsets); the entire analysis runs in
 * wall-clock milliseconds, and the ONLY conversion to timestamptz is
 * the store's `AT TIME ZONE` at the DB boundary.
 */

const MS_PER_DAY = 86_400_000;
/** The import horizon: a device file covers the recent operational
 * past; a longer backfill is a deliberate migration (the toolkit's
 * world), not a device import. */
const HORIZON_DAYS = 400;
/** The analysis window's ceiling — a bigger file is refused typed
 * (device files are bounded by their export horizon). */
const MAX_FILE_ROWS = 20_000;
/** The CSV content ceiling (bytes). */
const MAX_CONTENT_CHARS = 2_000_000;

export interface ImportMapping {
  /** 0-based column index of the employee CODE. */
  employeeCode: number;
  /** 0-based column index of the punch timestamp. */
  timestamp: number;
  /** 0-based column index of the direction (IN/OUT), or null for a
   * direction-less file (alternating pairing). */
  direction: number | null;
  /** 0-based column index of the device ref, or null. */
  deviceRef: number | null;
  timestampFormat: "ISO" | "DMY" | "MDY";
  skipHeader: boolean;
  delimiter: "," | ";" | "\t";
}

/** The code-level default — the ZKTeco-style layout (user id,
 * timestamp, direction, device id): the honest generic shape, never a
 * vendor contract. */
export const DEFAULT_IMPORT_MAPPING: ImportMapping = {
  employeeCode: 0,
  timestamp: 1,
  direction: 2,
  deviceRef: 3,
  timestampFormat: "ISO",
  skipHeader: true,
  delimiter: ",",
};

export type ImportAnomalyReason =
  | "UNKNOWN_EMPLOYEE"
  | "INVALID_ROW"
  | "OUT_OF_RANGE"
  | "DUPLICATE_IN_FILE"
  | "ALREADY_IMPORTED"
  | "DOUBLE_PUNCH_IN"
  | "ORPHAN_PUNCH_OUT"
  | "SESSION_OVERLAP";

export interface ImportAnomaly {
  lineNo: number;
  employeeCode: string | null;
  punchAt: string | null;
  direction: string | null;
  reason: ImportAnomalyReason;
  detail: string | null;
  rawLine: string;
}

export interface ImportableSession {
  employeeId: string;
  workDate: string;
  checkInNaive: string;
  checkOutNaive: string | null;
  lineIn: number;
  lineOut: number | null;
  deviceRef: string | null;
}

export interface ImportAnalysis {
  fingerprint: string;
  rowCount: number;
  sessions: ImportableSession[];
  anomalies: ImportAnomaly[];
}

interface ParsedEvent {
  lineNo: number;
  rawLine: string;
  employeeCode: string;
  punchAtRaw: string;
  direction: "IN" | "OUT" | null;
  deviceRef: string | null;
  /** The normalized naive wall-clock `YYYY-MM-DD HH:MM:SS`. */
  naive: string;
  /** The wall-clock epoch-ms (UTC-interpreted — the analysis space). */
  wcMs: number;
  /** The naive DATE (the work-date axis). */
  date: string;
}

function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function intParam(value: number | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isNaN(parsed) ? fallback : fallback;
}

/** Validate a mapping's shape (the bounds the zod edge carries too —
 * the service re-verifies for every caller, the defense-in-depth
 * pair). */
export function validateMapping(mapping: ImportMapping): void {
  const indexes = [mapping.employeeCode, mapping.timestamp];
  if (mapping.direction !== null) indexes.push(mapping.direction);
  if (mapping.deviceRef !== null) indexes.push(mapping.deviceRef);
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index > 49)) {
    throw new AttendanceImportInvalidError(
      `mapping column indexes must be integers 0–49: ${indexes.join(", ")}`,
    );
  }
  if (!["ISO", "DMY", "MDY"].includes(mapping.timestampFormat)) {
    throw new AttendanceImportInvalidError(`unknown timestampFormat: ${mapping.timestampFormat}`);
  }
  if (![",", ";", "\t"].includes(mapping.delimiter)) {
    throw new AttendanceImportInvalidError(`unknown delimiter: ${JSON.stringify(mapping.delimiter)}`);
  }
}

/** Parse a raw timestamp per the mapped format → the normalized naive
 * wall-clock `YYYY-MM-DD HH:MM:SS` (seconds default 00). */
function parseTimestamp(raw: string, format: ImportMapping["timestampFormat"]): string | null {
  const trimmed = raw.trim().replace("T", " ");
  const iso = /^(\d{4})-(\d{2})-(\d{2})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  const slash = /^(\d{1,2})[/](\d{1,2})[/](\d{4})[ ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  let y = ""; let m = ""; let d = ""; let hh = ""; let mm = ""; let ss = "";
  if (format === "ISO" && iso !== null) {
    [, y = "", m = "", d = "", hh = "", mm = "", ss = "00"] = iso;
  } else if (format === "DMY" && slash !== null) {
    [, d = "", m = "", y = "", hh = "", mm = "", ss = "00"] = slash;
  } else if (format === "MDY" && slash !== null) {
    [, m = "", d = "", y = "", hh = "", mm = "", ss = "00"] = slash;
  } else if (format === "ISO" && slash !== null) {
    // ISO-declared but slash-formatted: refuse — the mapping is the
    // interpretation contract, never a guess.
    return null;
  } else {
    return null;
  }
  const pad = (value: string, width = 2) => value.padStart(width, "0");
  const naive = `${y}-${pad(m)}-${pad(d)} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  return Number.isNaN(Date.parse(`${naive.replace(" ", "T")}Z`)) ? null : naive;
}

/** RFC-4180-simple CSV line split (quoted fields respected; no
 * embedded newlines — the device-file world). */
function splitCsvLine(line: string, delimiter: string): string[] {
  const cols: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cols.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cols.push(current);
  return cols;
}

@Injectable()
export class AttendanceImportService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AttendanceService) private readonly attendance: AttendanceService,
  ) {}

  // -- the mapping setting -------------------------------------------------------------

  async effectiveMapping(): Promise<{ mapping: ImportMapping; stored: boolean }> {
    const stored = await importStore.readMappingSetting();
    if (stored === undefined) return { mapping: DEFAULT_IMPORT_MAPPING, stored: false };
    const merged = this.coerceMapping(stored);
    return { mapping: merged, stored: true };
  }

  async saveMapping(mapping: ImportMapping, actorId: string | null): Promise<ImportMapping> {
    validateMapping(mapping);
    await importStore.saveMappingSetting(mapping, actorId);
    await this.audit.record({
      action: "hr.attendance_import_mapping_saved",
      entityType: "attendance_import_batch",
      // entity_id is NOT NULL — a settings write anchors on a fresh uuid
      // (the rotation precedent).
      entityId: generateUuidV7(),
      actorId: actorId ?? undefined,
      after: mapping as unknown as Record<string, unknown>,
    });
    return mapping;
  }

  /** The stored value coerced onto the full mapping shape (old rows
   * missing a newer field fall back to the default — the setting is
   * additive; an EXPLICIT null stays null — a direction-less mapping
   * is a deliberate choice, never coerced back to the default
   * column). */
  private coerceMapping(value: unknown): ImportMapping {
    if (typeof value !== "object" || value === null) {
      throw new AttendanceImportInvalidError("the stored import mapping is not an object");
    }
    const raw = value as Record<string, unknown>;
    const columnOrNull = (field: string, fallback: number | null): number | null => {
      const rawValue = raw[field];
      if (rawValue === null) return null;
      if (typeof rawValue === "number") return rawValue;
      return fallback;
    };
    const mapping: ImportMapping = {
      employeeCode: columnOrNull("employeeCode", DEFAULT_IMPORT_MAPPING.employeeCode) ?? DEFAULT_IMPORT_MAPPING.employeeCode,
      timestamp: columnOrNull("timestamp", DEFAULT_IMPORT_MAPPING.timestamp) ?? DEFAULT_IMPORT_MAPPING.timestamp,
      direction: columnOrNull("direction", DEFAULT_IMPORT_MAPPING.direction),
      deviceRef: columnOrNull("deviceRef", DEFAULT_IMPORT_MAPPING.deviceRef),
      timestampFormat:
        raw.timestampFormat === "DMY" || raw.timestampFormat === "MDY" || raw.timestampFormat === "ISO"
          ? raw.timestampFormat
          : DEFAULT_IMPORT_MAPPING.timestampFormat,
      skipHeader: typeof raw.skipHeader === "boolean" ? raw.skipHeader : DEFAULT_IMPORT_MAPPING.skipHeader,
      delimiter:
        raw.delimiter === ";" || raw.delimiter === "\t" || raw.delimiter === ","
          ? raw.delimiter
          : DEFAULT_IMPORT_MAPPING.delimiter,
    };
    validateMapping(mapping);
    return mapping;
  }

  // -- the analysis (preview = this alone; zero writes) ---------------------------------

  async analyze(content: string, mappingOverride?: ImportMapping): Promise<ImportAnalysis> {
    if (typeof content !== "string" || content.length === 0) {
      throw new AttendanceImportInvalidError("the import content is empty");
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw new AttendanceImportInvalidError(
        `the import content is too large (max ${MAX_CONTENT_CHARS} chars): ${content.length}`,
      );
    }
    const mapping =
      mappingOverride === undefined
        ? (await this.effectiveMapping()).mapping
        : (validateMapping(mappingOverride), mappingOverride);

    const fingerprint = createHash("sha256").update(content, "utf8").digest("hex");
    const anomalies: ImportAnomaly[] = [];

    // -- parse + shape ---------------------------------------------------------------
    const rawLines = content.split(/\r?\n/);
    const dataLines = rawLines
      .map((raw, index) => ({ raw, lineNo: index + 1 }))
      .filter(({ raw }) => raw.trim().length > 0);
    if (dataLines.length === 0) {
      throw new AttendanceImportInvalidError("the import content has no data rows");
    }
    if (dataLines.length > MAX_FILE_ROWS) {
      throw new AttendanceImportInvalidError(
        `the import file has too many rows (max ${MAX_FILE_ROWS}): ${dataLines.length}`,
      );
    }
    const rows = mapping.skipHeader ? dataLines.slice(1) : dataLines;
    const rowCount = rows.length;

    const today = await importStore.tenantTodayNaive();
    const horizonStart = addDaysIso(today, -HORIZON_DAYS);
    const horizonEnd = addDaysIso(today, 1);

    const events: ParsedEvent[] = [];
    for (const { raw, lineNo } of rows) {
      const cols = splitCsvLine(raw, mapping.delimiter);
      const employeeCode = (cols[mapping.employeeCode] ?? "").trim();
      const punchAtRaw = (cols[mapping.timestamp] ?? "").trim();
      if (employeeCode.length === 0 || punchAtRaw.length === 0) {
        anomalies.push({
          lineNo,
          employeeCode: employeeCode.length > 0 ? employeeCode : null,
          punchAt: punchAtRaw.length > 0 ? punchAtRaw : null,
          direction: null,
          reason: "INVALID_ROW",
          detail: `missing ${employeeCode.length === 0 ? "employee code" : "timestamp"} column (indexes ${mapping.employeeCode}/${mapping.timestamp})`,
          rawLine: raw,
        });
        continue;
      }
      let direction: "IN" | "OUT" | null = null;
      if (mapping.direction !== null) {
        const rawDirection = (cols[mapping.direction] ?? "").trim().toUpperCase();
        if (rawDirection === "IN" || rawDirection === "I" || rawDirection === "0") direction = "IN";
        else if (rawDirection === "OUT" || rawDirection === "O" || rawDirection === "1") direction = "OUT";
        else {
          anomalies.push({
            lineNo,
            employeeCode,
            punchAt: punchAtRaw,
            direction: null,
            reason: "INVALID_ROW",
            detail: `unrecognized direction '${rawDirection}' (expected IN/OUT)`,
            rawLine: raw,
          });
          continue;
        }
      }
      const naive = parseTimestamp(punchAtRaw, mapping.timestampFormat);
      if (naive === null) {
        anomalies.push({
          lineNo,
          employeeCode,
          punchAt: punchAtRaw,
          direction,
          reason: "INVALID_ROW",
          detail: `unparseable timestamp for format ${mapping.timestampFormat}`,
          rawLine: raw,
        });
        continue;
      }
      const date = naive.slice(0, 10);
      if (date < horizonStart || date > horizonEnd) {
        anomalies.push({
          lineNo,
          employeeCode,
          punchAt: punchAtRaw,
          direction,
          reason: "OUT_OF_RANGE",
          detail: `the punch date ${date} is outside the import horizon ${horizonStart}…${horizonEnd} (today − ${HORIZON_DAYS}d … tomorrow, the tenant's timezone)`,
          rawLine: raw,
        });
        continue;
      }
      events.push({
        lineNo,
        rawLine: raw,
        employeeCode,
        punchAtRaw,
        direction,
        deviceRef:
          mapping.deviceRef === null ? null : (cols[mapping.deviceRef] ?? "").trim() || null,
        naive,
        wcMs: Date.parse(`${naive.replace(" ", "T")}Z`),
        date,
      });
    }

    // -- the employee code axis --------------------------------------------------------
    const codeToId = await importStore.employeeIdsByCodes(events.map((event) => event.employeeCode));
    const knownEvents: ParsedEvent[] = [];
    for (const event of events) {
      if (codeToId.has(event.employeeCode)) {
        knownEvents.push(event);
      } else {
        anomalies.push({
          lineNo: event.lineNo,
          employeeCode: event.employeeCode,
          punchAt: event.punchAtRaw,
          direction: event.direction,
          reason: "UNKNOWN_EMPLOYEE",
          detail: `no ACTIVE employee with code '${event.employeeCode}' in this tenant`,
          rawLine: event.rawLine,
        });
      }
    }

    // -- the in-file dedupe (the collapse law) -----------------------------------------
    const seenEmployeeTs = new Set<string>();
    const dedupedEvents: ParsedEvent[] = [];
    for (const event of knownEvents) {
      const key = `${event.employeeCode}|${event.naive}`;
      if (seenEmployeeTs.has(key)) {
        anomalies.push({
          lineNo: event.lineNo,
          employeeCode: event.employeeCode,
          punchAt: event.punchAtRaw,
          direction: event.direction,
          reason: "DUPLICATE_IN_FILE",
          detail: `the same employee + timestamp already appeared earlier in this file — one session, never two`,
          rawLine: event.rawLine,
        });
        continue;
      }
      seenEmployeeTs.add(key);
      dedupedEvents.push(event);
    }

    // -- the pairing (per employee-day, wall-clock order) -------------------------------
    const sessions: ImportableSession[] = [];
    const byEmployeeDay = new Map<string, ParsedEvent[]>();
    for (const event of dedupedEvents) {
      const key = `${event.employeeCode}|${event.date}`;
      const bucket = byEmployeeDay.get(key);
      if (bucket === undefined) byEmployeeDay.set(key, [event]);
      else bucket.push(event);
    }
    for (const dayEvents of byEmployeeDay.values()) {
      dayEvents.sort((a, b) => a.wcMs - b.wcMs || a.lineNo - b.lineNo);
      const employeeId = codeToId.get(dayEvents[0]!.employeeCode)!;
      let openEvent: ParsedEvent | null = null;
      // The direction-less file: alternate pairing (1st opens, 2nd
      // closes — the documented convention).
      let alternateIsIn = true;
      for (const event of dayEvents) {
        const isIn = event.direction === null ? alternateIsIn : event.direction === "IN";
        if (event.direction === null) alternateIsIn = !alternateIsIn;
        if (isIn) {
          if (openEvent !== null) {
            anomalies.push({
              lineNo: event.lineNo,
              employeeCode: event.employeeCode,
              punchAt: event.punchAtRaw,
              direction: event.direction,
              reason: "DOUBLE_PUNCH_IN",
              detail: `a second punch-in while the session opened at ${openEvent.naive} (line ${openEvent.lineNo}) is still open — the first stays, this one is quarantined`,
              rawLine: event.rawLine,
            });
            continue;
          }
          openEvent = event;
        } else {
          if (openEvent === null) {
            anomalies.push({
              lineNo: event.lineNo,
              employeeCode: event.employeeCode,
              punchAt: event.punchAtRaw,
              direction: event.direction,
              reason: "ORPHAN_PUNCH_OUT",
              detail: `a punch-out with no open session before it`,
              rawLine: event.rawLine,
            });
            continue;
          }
          sessions.push({
            employeeId,
            workDate: openEvent.date,
            checkInNaive: openEvent.naive,
            checkOutNaive: event.naive,
            lineIn: openEvent.lineNo,
            lineOut: event.lineNo,
            deviceRef: openEvent.deviceRef ?? event.deviceRef,
          });
          openEvent = null;
        }
      }
      // The still-open session closes the day honestly: check_out
      // NULL — the MISSING_PUNCH derivation's signal.
      if (openEvent !== null) {
        sessions.push({
          employeeId,
          workDate: openEvent.date,
          checkInNaive: openEvent.naive,
          checkOutNaive: null,
          lineIn: openEvent.lineNo,
          lineOut: null,
          deviceRef: openEvent.deviceRef,
        });
      }
    }

    // -- the DB floors (ALREADY_IMPORTED + SESSION_OVERLAP) -----------------------------
    if (sessions.length > 0) {
      const from = sessions.reduce((min, session) => (session.workDate < min ? session.workDate : min), sessions[0]!.workDate);
      const to = sessions.reduce((max, session) => (session.workDate > max ? session.workDate : max), sessions[0]!.workDate);
      const existing = await importStore.listExistingSessionsWallClock({
        from,
        to,
        employeeIds: [...new Set(sessions.map((session) => session.employeeId))],
      });
      const existingByDay = new Map<string, importStore.ExistingSessionRow[]>();
      for (const row of existing) {
        const key = `${row.employeeId}|${row.workDate}`;
        const bucket = existingByDay.get(key);
        if (bucket === undefined) existingByDay.set(key, [row]);
        else bucket.push(row);
      }
      const kept: ImportableSession[] = [];
      for (const session of sessions) {
        const checkInWc = Date.parse(`${session.checkInNaive.replace(" ", "T")}Z`);
        const checkOutWc =
          session.checkOutNaive === null
            ? Number.POSITIVE_INFINITY
            : Date.parse(`${session.checkOutNaive.replace(" ", "T")}Z`);
        const siblings = existingByDay.get(`${session.employeeId}|${session.workDate}`) ?? [];
        const duplicate = siblings.find((row) => row.checkInWcMs === checkInWc);
        if (duplicate !== undefined) {
          anomalies.push({
            lineNo: session.lineIn,
            employeeCode: null,
            punchAt: session.checkInNaive,
            direction: "IN",
            reason: "ALREADY_IMPORTED",
            detail: `a session for this employee already opens at ${session.checkInNaive} on ${session.workDate} (the 0081 dedupe floor)${session.lineOut === null ? "" : ` — the paired out line was ${session.lineOut}`}`,
            rawLine: `line ${session.lineIn}: ${session.checkInNaive}${session.checkOutNaive === null ? "" : ` → ${session.checkOutNaive}`}`,
          });
          continue;
        }
        const overlap = siblings.find(
          (row) =>
            row.checkInWcMs !== null &&
            row.checkInWcMs < checkOutWc &&
            checkInWc < (row.checkOutWcMs ?? Number.POSITIVE_INFINITY),
        );
        if (overlap !== undefined) {
          anomalies.push({
            lineNo: session.lineIn,
            employeeCode: null,
            punchAt: session.checkInNaive,
            direction: "IN",
            reason: "SESSION_OVERLAP",
            detail: `the session [${session.checkInNaive} → ${session.checkOutNaive ?? "open"}] overlaps an existing session of this employee-day (INV-031)${session.lineOut === null ? "" : ` — the paired out line was ${session.lineOut}`}`,
            rawLine: `line ${session.lineIn}: ${session.checkInNaive}${session.checkOutNaive === null ? "" : ` → ${session.checkOutNaive}`}`,
          });
          continue;
        }
        kept.push(session);
        // The session becomes part of the day's floor for the NEXT
        // session of the same employee-day (two sessions in one file
        // must not overlap EACH OTHER either).
        existingByDay.get(`${session.employeeId}|${session.workDate}`)?.push({
          employeeId: session.employeeId,
          workDate: session.workDate,
          checkInWcMs: checkInWc,
          checkOutWcMs: checkOutWc === Number.POSITIVE_INFINITY ? null : checkOutWc,
        });
      }
      sessions.length = 0;
      sessions.push(...kept);
    }

    return { fingerprint, rowCount, sessions, anomalies };
  }

  // -- preview / commit ----------------------------------------------------------------

  async preview(input: {
    content: string;
    mapping?: ImportMapping;
  }): Promise<ImportAnalysis & { mappingUsed: ImportMapping }> {
    const mappingUsed =
      input.mapping === undefined ? (await this.effectiveMapping()).mapping : input.mapping;
    const analysis = await this.analyze(input.content, input.mapping);
    return { ...analysis, mappingUsed };
  }

  async commit(input: {
    content: string;
    fileName: string;
    mapping?: ImportMapping;
    deviceRef?: string | null;
    note?: string | null;
    actorId: string | null;
  }): Promise<importStore.ImportBatchRow & { anomalies: number }> {
    if (typeof input.fileName !== "string" || input.fileName.trim().length === 0 || input.fileName.length > 200) {
      throw new AttendanceImportInvalidError("fileName is required (1–200 chars) — the import log's identity");
    }
    const analysis = await this.analyze(input.content, input.mapping);
    const mappingUsed =
      input.mapping === undefined ? (await this.effectiveMapping()).mapping : input.mapping;

    // THE FINGERPRINT FLOOR: the same file never commits twice.
    const existingBatch = await importStore.findImportBatchByFingerprint(analysis.fingerprint);
    if (existingBatch !== undefined) {
      throw new AttendanceImportAlreadyCommittedError(
        `this exact file (sha256 ${analysis.fingerprint.slice(0, 12)}…) was already committed as '${existingBatch.fileName}' at ${existingBatch.createdAt} — the same file never commits twice; a CHANGED file is a new fingerprint`,
      );
    }

    // The file's device identity: the explicit default, else the first
    // mapped device ref the file carries.
    const deviceRef =
      input.deviceRef ?? analysis.sessions.find((session) => session.deviceRef !== null)?.deviceRef ?? null;

    const batch = await importStore.insertImportBatch({
      fileName: input.fileName.trim(),
      fileSha256: analysis.fingerprint,
      fileSize: Buffer.byteLength(input.content, "utf8"),
      rowCount: analysis.rowCount,
      importedCount: analysis.sessions.length,
      quarantineCount: analysis.anomalies.length,
      deviceRef,
      mapping: mappingUsed,
      note: input.note ?? null,
      createdBy: input.actorId,
    });
    await importStore.insertImportAnomalies(
      analysis.anomalies.map((anomaly) => ({
        batchId: batch.id,
        lineNo: anomaly.lineNo,
        employeeCode: anomaly.employeeCode,
        punchAt: anomaly.punchAt,
        direction: anomaly.direction,
        reason: anomaly.reason,
        detail: anomaly.detail,
        rawLine: anomaly.rawLine,
        createdBy: input.actorId,
      })),
    );
    for (const session of analysis.sessions) {
      await importStore.insertImportedRecord({
        employeeId: session.employeeId,
        workDate: session.workDate,
        checkInNaive: session.checkInNaive,
        checkOutNaive: session.checkOutNaive,
        importBatchId: batch.id,
        note: null,
        createdBy: input.actorId,
      });
    }
    // The derivation law runs over the file's span for the affected
    // employees — every imported row carries its verdict immediately
    // (the register never shows a stale derivation; the absent
    // synthesis may honestly fire for the file's rostered punchless
    // days — the same law the derive endpoint rides).
    if (analysis.sessions.length > 0) {
      const from = analysis.sessions.reduce((min, session) => (session.workDate < min ? session.workDate : min), analysis.sessions[0]!.workDate);
      const to = analysis.sessions.reduce((max, session) => (session.workDate > max ? session.workDate : max), analysis.sessions[0]!.workDate);
      await this.attendance.deriveDays({
        from,
        to,
        employeeIds: [...new Set(analysis.sessions.map((session) => session.employeeId))],
        actorId: null,
      });
    }
    await this.audit.record({
      action: "hr.attendance_import_committed",
      entityType: "attendance_import_batch",
      entityId: batch.id,
      actorId: input.actorId ?? undefined,
      after: {
        fileName: batch.fileName,
        fingerprint: analysis.fingerprint,
        rowCount: analysis.rowCount,
        importedCount: analysis.sessions.length,
        quarantineCount: analysis.anomalies.length,
      },
    });
    return { ...batch, anomalies: analysis.anomalies.length };
  }

  // -- the quarantine review --------------------------------------------------------------

  async batches(input: { page?: number; pageSize?: number }): Promise<{
    rows: importStore.ImportBatchRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const page = Math.max(intParam(input.page, 1), 1);
    const pageSize = Math.min(Math.max(intParam(input.pageSize, 50), 1), 200);
    const rows = await importStore.listImportBatches({ limit: pageSize, offset: (page - 1) * pageSize });
    const total = await importStore.countImportBatches();
    return { rows, page, pageSize, total, hasMore: page * pageSize < total };
  }

  async anomalies(input: {
    batchId?: string;
    status?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    rows: importStore.ImportAnomalyRow[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    if (input.status !== undefined && !["PENDING", "RESOLVED", "REJECTED"].includes(input.status)) {
      throw new AttendanceImportInvalidError(`unknown anomaly status filter: ${input.status}`);
    }
    const page = Math.max(intParam(input.page, 1), 1);
    const pageSize = Math.min(Math.max(intParam(input.pageSize, 50), 1), 500);
    const filter = {
      ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
      ...(input.status === undefined ? {} : { status: input.status }),
    };
    const rows = await importStore.listImportAnomalies({
      ...filter,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = await importStore.countImportAnomalies(filter);
    return { rows, page, pageSize, total, hasMore: page * pageSize < total };
  }

  /** The reviewer's explicit act: REJECT (the note is the verdict) or
   * IMPORT-with-corrections — the corrected session rides the SAME
   * capture laws (shape, envelope, interval, INV-031, the dedupe
   * floor), typed refusals before any write, then source IMPORT with
   * the original batch's traceability. */
  async resolve(input: {
    anomalyId: string;
    action: "REJECT" | "IMPORT";
    employeeId?: string;
    checkIn?: string;
    checkOut?: string | null;
    note?: string | null;
    actorId: string | null;
  }): Promise<importStore.ImportAnomalyRow> {
    const anomaly = await importStore.findImportAnomalyById(input.anomalyId);
    if (anomaly === undefined) {
      throw new AttendanceAnomalyNotFoundError(input.anomalyId);
    }
    if (anomaly.status !== "PENDING") {
      throw new AttendanceAnomalyResolvedError(input.anomalyId, anomaly.status);
    }

    if (input.action === "REJECT") {
      const updated = await importStore.resolveImportAnomaly({
        id: anomaly.id,
        status: "REJECTED",
        resolutionNote: input.note ?? null,
        resolvedBy: input.actorId,
      });
      await this.audit.record({
        action: "hr.attendance_anomaly_resolved",
        entityType: "attendance_import_anomaly",
        entityId: anomaly.id,
        actorId: input.actorId ?? undefined,
        after: { action: "REJECT", reason: anomaly.reason, note: input.note ?? null },
      });
      return updated!;
    }

    // IMPORT-with-corrections.
    if (input.employeeId === undefined || input.checkIn === undefined) {
      throw new AttendanceImportInvalidError(
        "the IMPORT resolution requires employeeId and checkIn (the corrected session's facts)",
      );
    }
    if (!(await employeeExists(input.employeeId))) {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    const checkInInstant = input.checkIn;
    if (
      !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(checkInInstant) ||
      Number.isNaN(Date.parse(checkInInstant))
    ) {
      throw new AttendanceRecordInvalidError(`checkIn must be an ISO-8601 instant: ${checkInInstant}`);
    }
    const checkInNaive = await importStore.instantToNaiveLocal(checkInInstant);
    const checkOutNaive =
      input.checkOut === undefined || input.checkOut === null
        ? null
        : await importStore.instantToNaiveLocal(input.checkOut);
    const workDate = checkInNaive.slice(0, 10);

    // The capture laws, in the file's wall-clock space.
    const checkInWc = Date.parse(`${checkInNaive.replace(" ", "T")}Z`);
    const checkOutWc = checkOutNaive === null ? null : Date.parse(`${checkOutNaive.replace(" ", "T")}Z`);
    if (checkOutWc !== null && checkOutWc <= checkInWc) {
      throw new AttendanceRecordInvalidError("checkOut must be after checkIn (the 0081 interval law)");
    }
    const dayRows = await importStore.listExistingSessionsWallClock({
      from: workDate,
      to: workDate,
      employeeIds: [input.employeeId],
    });
    for (const row of dayRows) {
      if (row.checkInWcMs === checkInWc) {
        throw new AttendanceDuplicatePunchError(
          `a session for this employee already opens at ${checkInNaive} on ${workDate} — the 0081 dedupe floor`,
        );
      }
      if (row.checkInWcMs !== null) {
        const existingEnd = row.checkOutWcMs ?? Number.POSITIVE_INFINITY;
        const newEnd = checkOutWc ?? Number.POSITIVE_INFINITY;
        if (row.checkInWcMs < newEnd && checkInWc < existingEnd) {
          throw new AttendanceSessionOverlapError(
            `the corrected session overlaps an existing session of this employee-day (INV-031)`,
          );
        }
      }
    }
    // The envelope: both timestamps on the work date or the day after
    // (the tenant's tz wall-clock — the naive dates ARE the tz dates).
    const tomorrow = addDaysIso(workDate, 1);
    if (checkInNaive.slice(0, 10) < workDate || checkInNaive.slice(0, 10) > tomorrow) {
      throw new AttendanceRecordInvalidError(
        `checkIn must fall on ${workDate} or the day after (the operational day's envelope)`,
      );
    }
    if (checkOutNaive !== null && (checkOutNaive.slice(0, 10) < workDate || checkOutNaive.slice(0, 10) > tomorrow)) {
      throw new AttendanceRecordInvalidError(
        `checkOut must fall on ${workDate} or the day after (the operational day's envelope)`,
      );
    }

    await importStore.insertImportedRecord({
      employeeId: input.employeeId,
      workDate,
      checkInNaive,
      checkOutNaive,
      importBatchId: anomaly.batchId,
      note: input.note ?? null,
      createdBy: input.actorId,
    });
    await this.attendance.deriveDays({
      from: workDate,
      to: workDate,
      employeeIds: [input.employeeId],
      actorId: null,
    });
    const updated = await importStore.resolveImportAnomaly({
      id: anomaly.id,
      status: "RESOLVED",
      resolutionNote: input.note ?? null,
      resolvedBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.attendance_anomaly_resolved",
      entityType: "attendance_import_anomaly",
      entityId: anomaly.id,
      actorId: input.actorId ?? undefined,
      after: {
        action: "IMPORT",
        reason: anomaly.reason,
        employeeId: input.employeeId,
        checkIn: checkInNaive,
        checkOut: checkOutNaive,
        workDate,
      },
    });
    return updated!;
  }
}
