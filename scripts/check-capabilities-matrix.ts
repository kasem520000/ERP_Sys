/**
 * PHASE-020 capabilities cross-check (MASTER-PLAN §15, T17 — the W4-a tool).
 *
 * Cross-checks the normative capability scope — the OFFLINE_CAPABILITIES_MATRIX.md
 * §2 table (operation × device-class cells, conflict policies, phases) — against
 * the machine fixture SYNC_CAPABILITY_FIXTURE (@erp/contracts
 * packages/contracts/src/sync/capabilities.ts: implemented intents × class ×
 * policy × gate) and prints a row-by-row PASS / DEFERRED(phase) table.
 *
 * Exit ≠ 0 on any of (the task spec, verbatim mapping):
 *  (a) a fixture row claims implemented for a matrix cell the matrix doesn't
 *      mark implemented/✓ — operationalized as: a POS-terminal claim on a row
 *      without ✓; a capability class or conflict-policy disagreement with the
 *      matrix cell; an implemented row without a proving gate ("a cell claiming
 *      implementation without a matching gate", MASTER-PLAN §15);
 *  (b) a matrix cell marked ✓ (the POS-terminal portion, matrix §1 legend) with
 *      no matching implemented fixture row;
 *  (c) a fixture row referencing an operation not in the matrix (typo guard —
 *      exact operation-name match);
 *  (d) a matrix row whose phase is ≤ 020 (by phase number) carrying an
 *      offline-capability cell that is implemented=false WITHOUT an explicit
 *      deferred-phase annotation (an implemented:false fixture row naming the
 *      landing phase).
 *
 * The matrix ✓ is per-ROW (POS-terminal column, matrix §1); the fixture is per
 * (operation × deviceClass) — for PHASE-020 the implemented set extends past
 * the ✓ into the desktop column only where the fixture says so with a gate
 * (the 020-generalized drafts rows), per MASTER-PLAN §1.5's scope honesty.
 *
 * Usage: tsx scripts/check-capabilities-matrix.ts   (wired as
 * `pnpm check:capabilities-matrix`); exit 0 = agreement, 1 = violations.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SYNC_CAPABILITY_FIXTURE,
  type SyncCapabilityRow,
} from "../packages/contracts/src/sync/capabilities";

// -- matrix model -----------------------------------------------------------------------

const DEVICE_CLASS_COLUMNS = [
  { key: "pos-terminal", label: "pos-terminal" },
  { key: "tauri-desktop", label: "desktop" },
  { key: "android-field", label: "android-field" },
  { key: "android-personal", label: "android-personal" },
] as const;

type DeviceClassKey = (typeof DEVICE_CLASS_COLUMNS)[number]["key"];

/** The matrix §1 class spellings in check order (LOCAL-VALID is the † class). */
const MATRIX_CLASSES = [
  "OFFLINE-COMPLETE",
  "OFFLINE-DRAFT",
  "LOCAL-VALID",
  "READ-CACHED",
  "ONLINE-ONLY",
] as const;

type MatrixClass = (typeof MATRIX_CLASSES)[number];

/** The classes that constitute an offline capability (everything but ONLINE-ONLY). */
const OFFLINE_CLASSES: readonly MatrixClass[] = MATRIX_CLASSES.filter(
  (cls) => cls !== "ONLINE-ONLY",
);

const POLICY_CODES = ["SD", "SAS", "FM", "OD", "RO"] as const;
type PolicyCode = (typeof POLICY_CODES)[number] | "n/a";

interface MatrixRow {
  num: string;
  operation: string;
  cells: Record<DeviceClassKey, string>;
  policyText: string;
  policy: PolicyCode | null;
  stateMachine: string;
  phaseText: string;
  phaseNumbers: string[];
  checked: boolean; // ✓ in the Phase column (the POS-terminal portion, §1 legend)
}

const NO_CAPABILITY = "—"; // the matrix's empty-cell marker (em dash)

function cellClass(cell: string): MatrixClass | null {
  const normalized = cell.replace(/\*\*/g, "").replace(/†/g, "").trim();
  if (normalized === "" || normalized === NO_CAPABILITY) return null;
  for (const cls of MATRIX_CLASSES) {
    if (normalized.includes(cls)) return cls;
  }
  return null; // prose ("enforced server-side by …") — no offline grant, no online-only marker
}

function phaseTokens(phaseText: string): string[] {
  const tokens: string[] = [];
  for (const part of phaseText.split("/")) {
    const match = part.match(/\d{3}/);
    if (match !== null) tokens.push(match[0]);
  }
  return tokens;
}

function policyCode(policyText: string): PolicyCode | null {
  if (/\bn\/a\b/.test(policyText)) return "n/a";
  let best: { code: PolicyCode; at: number } | null = null;
  for (const code of POLICY_CODES) {
    const at = policyText.indexOf(code);
    if (at >= 0 && (best === null || at < best.at)) best = { code, at };
  }
  return best === null ? null : best.code;
}

/** Parse the §2 matrix table (the first `| # | Operation | …` table in the doc). */
function parseMatrix(markdown: string): MatrixRow[] {
  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex((line) => /^\|\s*#\s*\|\s*Operation\s*\|/.test(line));
  if (headerIndex < 0) {
    throw new Error("OFFLINE_CAPABILITIES_MATRIX.md §2 table not found (header row `| # | Operation | …`)");
  }
  const rows: MatrixRow[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.startsWith("|")) break; // §2 ends at the first non-table line
    if (/^\|[-\s|]*\|$/.test(line)) continue; // the |---| separator row
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== 9) {
      throw new Error(`matrix row with ${cells.length} columns (expected 9): ${line}`);
    }
    const phaseText = cells[8] ?? "";
    rows.push({
      num: cells[0] ?? "",
      operation: cells[1] ?? "",
      cells: {
        "pos-terminal": cells[2] ?? "",
        "tauri-desktop": cells[3] ?? "",
        "android-field": cells[4] ?? "",
        "android-personal": cells[5] ?? "",
      },
      policyText: cells[6] ?? "",
      policy: policyCode(cells[6] ?? ""),
      stateMachine: cells[7] ?? "",
      phaseText,
      phaseNumbers: phaseTokens(phaseText),
      checked: phaseText.includes("✓"),
    });
  }
  if (rows.length === 0) {
    throw new Error("OFFLINE_CAPABILITIES_MATRIX.md §2 table parsed to zero rows");
  }
  return rows;
}

// -- cross-check -------------------------------------------------------------------------

type Rule = "a" | "b" | "c" | "d";

interface Violation {
  rule: Rule;
  message: string;
}

function describeRule(rule: Rule): string {
  switch (rule) {
    case "a":
      return "fixture claims implementation the matrix doesn't mark (class/policy/✓/gate mismatch)";
    case "b":
      return "matrix cell marked ✓ has no matching implemented fixture row";
    case "c":
      return "fixture row references an operation not in the matrix (typo guard)";
    case "d":
      return "offline cell due by phase ≤ 020 lacks an explicit deferred-phase annotation";
  }
}

interface CellStatus {
  kind: "pass" | "deferred" | "online-only" | "none";
  phase: string; // PASS phase / DEFERRED phase ("" for online-only/none)
}

function crossCheck(
  rows: readonly MatrixRow[],
  fixture: readonly SyncCapabilityRow[],
): { violations: Violation[]; statuses: Map<string, Map<DeviceClassKey, CellStatus>> } {
  const violations: Violation[] = [];
  const byOperation = new Map<string, Map<DeviceClassKey, SyncCapabilityRow[]>>();
  for (const row of fixture) {
    const perClass = byOperation.get(row.operation) ?? new Map<DeviceClassKey, SyncCapabilityRow[]>();
    const list = perClass.get(row.deviceClass) ?? [];
    list.push(row);
    perClass.set(row.deviceClass, list);
    byOperation.set(row.operation, perClass);
  }

  // (c) typo guard — every fixture operation must exist in the matrix.
  for (const [operation, perClass] of byOperation) {
    if (!rows.some((row) => row.operation === operation)) {
      for (const [deviceClass, list] of perClass) {
        for (const entry of list) {
          violations.push({
            rule: "c",
            message: `unknown operation "${operation}" (deviceClass ${deviceClass}, implemented=${entry.implemented}) — no matrix §2 row by that exact name`,
          });
        }
      }
    }
  }

  const statuses = new Map<string, Map<DeviceClassKey, CellStatus>>();
  for (const row of rows) {
    const perClass = byOperation.get(row.operation);
    const rowStatuses = new Map<DeviceClassKey, CellStatus>();
    statuses.set(row.operation, rowStatuses);

    for (const column of DEVICE_CLASS_COLUMNS) {
      const deviceClass = column.key;
      const entries = perClass?.get(deviceClass) ?? [];
      const implementedEntries = entries.filter((entry) => entry.implemented);
      const deferredEntries = entries.filter((entry) => !entry.implemented);
      const cls = cellClass(row.cells[deviceClass]);

      // (a) — every fixture row for this cell must agree with the matrix.
      for (const entry of entries) {
        if (entry.implemented && entry.gate === null) {
          violations.push({
            rule: "a",
            message: `"${row.operation}" × ${deviceClass}: implemented without a proving gate (MASTER-PLAN §15 — no gate, no claim)`,
          });
        }
        if (entry.implemented && deviceClass === "pos-terminal" && !row.checked) {
          violations.push({
            rule: "a",
            message: `"${row.operation}" × ${deviceClass}: claims implemented but the matrix Phase column carries no ✓ (the §1 legend marks implemented rows per-POS-terminal-column)`,
          });
        }
        if (cls === null || cls === "ONLINE-ONLY" || cls !== entry.capability) {
          violations.push({
            rule: "a",
            message: `"${row.operation}" × ${deviceClass}: fixture capability ${entry.capability} disagrees with the matrix cell "${row.cells[deviceClass]}" (${cls === null ? "no capability granted" : cls})`,
          });
        }
        if (row.policy !== null && entry.conflictPolicy !== row.policy) {
          violations.push({
            rule: "a",
            message: `"${row.operation}" × ${deviceClass}: fixture policy ${entry.conflictPolicy} disagrees with the matrix policy "${row.policyText}" (${row.policy})`,
          });
        }
      }
      if (implementedEntries.length > 0 && deferredEntries.length > 0) {
        violations.push({
          rule: "a",
          message: `"${row.operation}" × ${deviceClass}: contradictory fixture rows (implemented AND deferred annotations for the same cell)`,
        });
      }

      // (d) — rows due by ≤ 020 need an explicit deferral for offline cells.
      const firstPhase = row.phaseNumbers[0];
      const dueBy020 = firstPhase !== undefined && Number(firstPhase) <= 20;
      if (dueBy020 && cls !== null && OFFLINE_CLASSES.includes(cls) && implementedEntries.length === 0) {
        if (deferredEntries.length === 0) {
          violations.push({
            rule: "d",
            message: `"${row.operation}" × ${deviceClass}: the matrix grants ${cls} (row phase ${firstPhase} ≤ 020) but the cell is not implemented and carries no deferred-phase annotation`,
          });
        } else {
          const phase = deferredEntries[0]?.phase ?? "";
          if (phase === "") {
            violations.push({
              rule: "d",
              message: `"${row.operation}" × ${deviceClass}: deferred annotation without a landing phase`,
            });
          }
        }
      }

      // cell status for the table
      if (implementedEntries.length > 0) {
        const entry = implementedEntries[0]!;
        rowStatuses.set(deviceClass, { kind: "pass", phase: entry.phase });
      } else if (deferredEntries.length > 0) {
        const entry = deferredEntries[0]!;
        rowStatuses.set(deviceClass, { kind: "deferred", phase: entry.phase });
      } else if (cls !== null && OFFLINE_CLASSES.includes(cls)) {
        const derived = row.phaseNumbers[row.phaseNumbers.length - 1] ?? "post-MVP";
        rowStatuses.set(deviceClass, { kind: "deferred", phase: derived });
      } else if (cls === "ONLINE-ONLY") {
        rowStatuses.set(deviceClass, { kind: "online-only", phase: "" });
      } else {
        rowStatuses.set(deviceClass, { kind: "none", phase: "" });
      }
    }

    // (b) — every ✓ row must have a matching implemented POS-terminal fixture row.
    if (row.checked) {
      const posStatus = rowStatuses.get("pos-terminal");
      if (posStatus?.kind !== "pass") {
        violations.push({
          rule: "b",
          message: `"${row.operation}" (row #${row.num}) is marked ✓ in the matrix Phase column but has no implemented pos-terminal fixture row`,
        });
      }
    }
  }
  return { violations, statuses };
}

// -- rendering ---------------------------------------------------------------------------

function pad(text: string, width: number): string {
  const padded = text.padEnd(width, " ");
  return padded.length > width ? `${padded.slice(0, width - 1)}…` : padded;
}

function cellLabel(status: CellStatus): string {
  switch (status.kind) {
    case "pass":
      return `PASS(${status.phase})`;
    case "deferred":
      return `DEFERRED(${status.phase})`;
    case "online-only":
      return "online-only";
    case "none":
      return NO_CAPABILITY;
  }
}

function main(): number {
  const here = dirname(fileURLToPath(import.meta.url));
  const matrixPath = resolve(here, "../docs/offline/OFFLINE_CAPABILITIES_MATRIX.md");
  const rows = parseMatrix(readFileSync(matrixPath, "utf8"));

  const implementedRows = SYNC_CAPABILITY_FIXTURE.filter((row) => row.implemented);
  const deferredRows = SYNC_CAPABILITY_FIXTURE.filter((row) => !row.implemented);
  const checkedRows = rows.filter((row) => row.checked);
  console.log(
    `== offline capabilities cross-check: OFFLINE_CAPABILITIES_MATRIX §2 (${rows.length} rows, ✓ ${checkedRows.length}) × SYNC_CAPABILITY_FIXTURE (${SYNC_CAPABILITY_FIXTURE.length} rows: implemented ${implementedRows.length}, deferred-annotations ${deferredRows.length}) ==`,
  );

  const { violations, statuses } = crossCheck(rows, SYNC_CAPABILITY_FIXTURE);

  const operationWidth = 58;
  const statusWidth = 18;
  const classWidth = 17;
  const header =
    pad("#", 4) +
    pad("operation", operationWidth) +
    pad("row status", statusWidth) +
    DEVICE_CLASS_COLUMNS.map((column) => pad(column.label, classWidth)).join("");
  console.log(header);
  let passRows = 0;
  let deferredRowCount = 0;
  let naRows = 0;
  for (const row of rows) {
    const perClass = statuses.get(row.operation);
    const cells = DEVICE_CLASS_COLUMNS.map((column) =>
      pad(cellLabel(perClass?.get(column.key) ?? { kind: "none", phase: "" }), classWidth),
    ).join("");
    const hasPass = DEVICE_CLASS_COLUMNS.some((column) => perClass?.get(column.key)?.kind === "pass");
    const hasOffline = DEVICE_CLASS_COLUMNS.some((column) => {
      const status = perClass?.get(column.key);
      return status?.kind === "deferred";
    });
    let rowStatus: string;
    if (hasPass) {
      rowStatus = "PASS";
      passRows += 1;
    } else if (hasOffline) {
      rowStatus = `DEFERRED(${row.phaseNumbers[0] ?? "post-MVP"})`;
      deferredRowCount += 1;
    } else {
      rowStatus = "n/a (online-only)";
      naRows += 1;
    }
    console.log(pad(`#${row.num}`, 4) + pad(row.operation, operationWidth) + pad(rowStatus, statusWidth) + cells);
  }

  let passCells = 0;
  let annotatedCells = 0;
  let derivedCells = 0;
  let onlineOnlyCells = 0;
  let noneCells = 0;
  for (const row of rows) {
    const perClass = statuses.get(row.operation);
    for (const column of DEVICE_CLASS_COLUMNS) {
      const status = perClass?.get(column.key);
      if (status?.kind === "pass") passCells += 1;
      else if (status?.kind === "deferred") {
        const annotated = deferredRows.some(
          (entry) => entry.operation === row.operation && entry.deviceClass === column.key,
        );
        if (annotated) annotatedCells += 1;
        else derivedCells += 1;
      } else if (status?.kind === "online-only") onlineOnlyCells += 1;
      else noneCells += 1;
    }
  }
  console.log(
    `rows: PASS ${passRows} · DEFERRED ${deferredRowCount} · n/a ${naRows} — cells: PASS ${passCells} · DEFERRED ${annotatedCells + derivedCells} (annotated ${annotatedCells} + matrix-derived ${derivedCells}) · online-only ${onlineOnlyCells} · ${NO_CAPABILITY} ${noneCells}`,
  );

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`FAIL (${violation.rule}) — ${describeRule(violation.rule)}: ${violation.message}`);
    }
    console.error(
      `\n${violations.length} capabilities-matrix violation(s) — the fixture and the normative matrix must agree row by row (MASTER-PLAN §15).`,
    );
    return 1;
  }
  console.log(
    "capabilities matrix and fixture agree: every implemented claim carries a gate, every ✓ row has a fixture row, every deferral is annotated.",
  );
  return 0;
}

process.exitCode = main();
