import { sql } from "drizzle-orm";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-023 T7 — parked statement lines (phase §2 item 8): rows the
 * format-family adapters could not parse park with their RAW CELLS stored
 * verbatim; a human maps them (every field confirmed — never a guessed
 * amount into bank_statement_lines); discard records why. Resolution links
 * the created bank_statement_line; the parked row is history (no DELETE).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("parked lines access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface ParkedLineRow {
  readonly id: string;
  readonly statementId: string;
  readonly lineIndex: number;
  readonly rawCells: readonly string[];
  readonly rawLine: string;
  readonly parkedReason: string;
  readonly status: "PARKED" | "RESOLVED" | "DISCARDED";
  readonly resolvedLineId: number | null;
  readonly resolutionNote: string | null;
  readonly createdAt: string;
}

const COLUMNS = sql`id, statement_id::text AS "statementId", line_index AS "lineIndex",
  raw_cells AS "rawCells", raw_line AS "rawLine", parked_reason AS "parkedReason",
  status, resolved_line_id AS "resolvedLineId", resolution_note AS "resolutionNote",
  created_at::text AS "createdAt"`;

export class ParkedLineError extends DomainError {
  constructor(reason: string, details?: Readonly<Record<string, unknown>>) {
    super("treasury/parked-line", reason, details);
  }
}

export async function listParkedLines(filter: {
  statementId?: string;
  status?: string;
}): Promise<ParkedLineRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${COLUMNS} FROM bank_statement_parked_lines
    WHERE (${filter.statementId ?? null}::uuid IS NULL OR statement_id = ${filter.statementId ?? null}::uuid)
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null}::text)
    ORDER BY statement_id, line_index
    LIMIT 500
  `);
  return rows.rows as unknown as ParkedLineRow[];
}

/** Persist a parser's parked rows (import path; ON CONFLICT = re-import no-op). */
export async function recordParkedRows(input: {
  statementId: string;
  rows: readonly { lineIndex: number; rawLine: string; rawCells: readonly string[]; reason: string }[];
  actorId: string | null;
}): Promise<number> {
  if (input.rows.length === 0) return 0;
  const tx = tenantTx();
  let inserted = 0;
  for (const row of input.rows) {
    const result = await tx.execute(sql`
      INSERT INTO bank_statement_parked_lines (id, tenant_id, created_by, statement_id,
        line_index, raw_cells, raw_line, parked_reason)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
        ${input.statementId}::uuid, ${row.lineIndex}, ${JSON.stringify(row.rawCells)}::jsonb,
        ${row.rawLine}, ${row.reason.slice(0, 200)})
      ON CONFLICT ("statement_id", "line_index") DO NOTHING
      RETURNING id
    `);
    inserted += result.rows.length;
  }
  return inserted;
}

/**
 * Manual mapping (the mapper confirms EVERY field — the resolved line is
 * written exactly as confirmed; amounts are never derived or guessed):
 * creates the bank_statement_line row and marks the parked line RESOLVED.
 */
export async function resolveParkedLine(input: {
  parkedLineId: string;
  lineDate: string;
  amount: string;
  reference?: string | null;
  description?: string | null;
  actorId: string | null;
}): Promise<ParkedLineRow> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.lineDate)) {
    throw new ParkedLineError("lineDate must be an ISO date");
  }
  if (!/^-?\d+(\.\d{1,8})?$/.test(input.amount)) {
    throw new ParkedLineError("amount must be a plain decimal string");
  }
  const tx = tenantTx();
  const parked = (await tx.execute(sql`
    SELECT ${COLUMNS} FROM bank_statement_parked_lines WHERE id = ${input.parkedLineId} LIMIT 1
  `)).rows as unknown as ParkedLineRow[];
  const row = parked[0];
  if (row === undefined) {
    throw new ParkedLineError(`parked line ${input.parkedLineId} not found`);
  }
  if (row.status !== "PARKED") {
    throw new ParkedLineError(`parked line ${input.parkedLineId} is already ${row.status}`);
  }
  const [int, frac = ""] = input.amount.replace(/^-/, "").split(".");
  const canonical = `${input.amount.startsWith("-") ? "-" : ""}${int}.${(frac + "0000").slice(0, 4)}`;
  // The next line_no for the statement (uq per statement — the import path's
  // numbering continues after the resolved parked rows).
  const nextNo = (await tx.execute(sql`
    SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM bank_statement_lines
    WHERE bank_statement_id = ${row.statementId}::uuid
  `)).rows as unknown as { n: number }[];
  const lineNo = nextNo[0]?.n ?? 1;
  // The resolved statement line (same shape the import path writes).
  const lineResult = await tx.execute(sql`
    INSERT INTO bank_statement_lines (id, tenant_id, bank_statement_id, line_no, line_date,
      amount, reference, description)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.statementId}::uuid, ${lineNo},
      ${input.lineDate}, ${canonical}, ${input.reference ?? null}, ${input.description ?? null})
    RETURNING id
  `);
  const lineId = (lineResult.rows as unknown as { id: string }[])[0]!.id;
  const updated = await tx.execute(sql`
    UPDATE bank_statement_parked_lines SET status = 'RESOLVED', resolved_line_id = ${lineId}::uuid,
      resolved_by = ${input.actorId}, resolved_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${input.parkedLineId}
    RETURNING ${COLUMNS}
  `);
  return (updated.rows as unknown as ParkedLineRow[])[0]!;
}

/** Discard a parked line with a recorded reason (audit — no silent drops). */
export async function discardParkedLine(input: {
  parkedLineId: string;
  note: string;
  actorId: string | null;
}): Promise<ParkedLineRow> {
  const tx = tenantTx();
  if (input.note.trim().length < 3) {
    throw new ParkedLineError("a discard note (≥3 chars) is required — no silent drops");
  }
  const updated = await tx.execute(sql`
    UPDATE bank_statement_parked_lines SET status = 'DISCARDED',
      resolution_note = ${input.note.slice(0, 500)}, resolved_by = ${input.actorId},
      resolved_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${input.parkedLineId} AND status = 'PARKED'
    RETURNING ${COLUMNS}
  `);
  const row = (updated.rows as unknown as ParkedLineRow[])[0];
  if (row === undefined) {
    throw new ParkedLineError(`parked line ${input.parkedLineId} not found or not PARKED`);
  }
  return row;
}
