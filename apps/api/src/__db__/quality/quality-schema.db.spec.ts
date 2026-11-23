import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { superuserClient } from "../test-db";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  freshQualityBatch,
  freshQualityItem,
  setupQualityFixture,
} from "./fixtures";

/**
 * PHASE-050 (W-24 — T-01…T-04, the foundation wave) — the quality
 * family's FIRST spec (the hr/projects/cmms family precedent: the
 * `__db__/quality/` directory opens with the migrations' own structural
 * laws; the service specs land with their W-25…W-28 waves). What this
 * spec pins over real PostgreSQL 16 (the plan §4's foundation arms):
 *
 * - THE NO-FABRICATION BAND LAW (0113): both tolerance ends NULLABLE, a
 *   one-sided band legal, a point band (UCL = LCL) refused BY NAME — an
 *   unset tolerance is UNTOLERATED, never a fabricated limit;
 * - the specifications' (tenant, item, parameter) uniqueness;
 * - the SPC samples' source vocabulary + the spec's composite FK;
 * - BR-102's disposition-closure gate at the floor (the status/
 *   disposition/stamps XOR law — 0114's own stamp-law shape);
 * - the NCR source-shape law (INSPECTION ⇒ inspection; SUPPLIER/
 *   COMPLAINT ⇒ partner) + the affected-quantity floor + the G-62
 *   journal gate (the stamp exists ONLY on the SCRAP disposition path);
 * - BR-103's effectiveness floor (no CAPA closes without the recorded
 *   check) + the G-63 cost-stamp gate (a zero-cost CAPA carries no
 *   entry) + the actions/effectiveness jsonb shapes;
 * - the complaints' resolved-shape law (the resolution pair together on
 *   the resolved paths) + the channel vocabulary;
 * - the calibration register's due-after law (the UTC-pinned floor) +
 *   the result vocabulary + the G-63 cost gate + the instrument-asset
 *   composite FK (D-08);
 * - the supplier scores' delivery shape + the score bounds + the
 *   (tenant, partner, period) uniqueness;
 * - the COA documents' frozen-snapshot array shape + the COA/COC
 *   vocabulary;
 * - THE ONE-ACTIVE-HOLD-PER-BATCH partial unique (INV-035/BR-101's own
 *   index — a second ACTIVE hold refused, a RELEASED row re-arms the
 *   batch) + BR-101's release floor (the release pair + the NCR link);
 * - the recall ladder's stamp law + the scope/customers array shapes;
 * - the reviews' indicator-pack object shape + the attendees/decisions
 *   array shapes;
 * - the hazard registers' CCP-critical-limit floor (the HACCP law) +
 *   the category vocabulary.
 *
 * THE OWNER'S PER-ARM-WORLD LAW («أذرع الرفض كلٌّ على عالمه»): every
 * rejection arm builds its OWN world — a fresh item/batch/spec with a
 * unique natural key; no arm shares mutable rows with another; the
 * worlds are cheap (direct SQL on the migration's own floors; the typed
 * services are the later waves').
 */

interface PgError {
  code?: string;
  constraint?: string;
}

async function expectConstraint(
  run: () => Promise<unknown>,
  constraint: string,
  pgCode: "23514" | "23505" | "23503",
): Promise<void> {
  let caught: PgError | undefined;
  try {
    await run();
  } catch (error) {
    caught = error as PgError;
  }
  expect(caught, `expected ${constraint} to refuse the row`).toBeTruthy();
  expect(caught?.code).toBe(pgCode);
  expect(caught?.constraint).toBe(constraint);
}

let su: Client;
let instrumentAssetId: string;
let basePartnerId: string;

beforeAll(async () => {
  const base = await setupQualityFixture();
  instrumentAssetId = base.instrumentAssetId;
  basePartnerId = base.partnerId;
  su = await superuserClient();
});

/** A fresh specification world per arm: its own item + its first spec. */
async function freshSpecWorld(
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<{ itemId: string; specId: string }> {
  const itemId = await freshQualityItem(code);
  const spec = await su.query<{ id: string }>(
    `INSERT INTO quality_specifications
       (id, tenant_id, item_id, parameter, parameter_ar, unit, target_value, ucl, lcl,
        is_active, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      TENANT_QUALITY,
      itemId,
      overrides.parameter ?? "Viscosity",
      overrides.parameterAr ?? "اللزوجة",
      overrides.unit ?? "cP",
      overrides.targetValue ?? 100,
      overrides.ucl ?? null,
      overrides.lcl ?? null,
      overrides.isActive ?? true,
      QL_ACTOR,
    ],
  );
  return { itemId, specId: spec.rows[0]!.id };
}

async function insertNcr(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO ncr_records
       (id, tenant_id, ncr_no, source, severity, item_id, batch_id, inspection_id,
        partner_id, problem, affected_qty, status, disposition, disposition_at, closed_at,
        journal_entry_id, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16)`,
    [
      TENANT_QUALITY,
      row.ncrNo,
      row.source ?? "PRODUCTION",
      row.severity ?? "MEDIUM",
      row.itemId,
      row.batchId ?? null,
      row.inspectionId ?? null,
      row.partnerId ?? null,
      row.problem ?? "Out of band",
      row.affectedQty ?? 5,
      row.status ?? "OPEN",
      row.disposition ?? null,
      row.dispositionAt ?? null,
      row.closedAt ?? null,
      row.journalEntryId ?? null,
      QL_ACTOR,
    ],
  );
}

describe("PHASE-050 W-24 — THE NO-FABRICATION BAND LAW (0113, Q-05)", () => {
  it("the legal shapes all insert: no band, one-sided UCL, one-sided LCL, a real band", async () => {
    const w = await freshSpecWorld("BAND-LEGAL", { parameter: "pH" });
    // The same item's further parameters (the (tenant, item, parameter)
    // uniqueness never collides inside one world).
    await su.query(
      `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value)
       VALUES (gen_random_uuid(), $1, $2, 'Brix', 12)`,
      [TENANT_QUALITY, w.itemId],
    );
    await su.query(
      `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value, ucl)
       VALUES (gen_random_uuid(), $1, $2, 'Temperature', 4, 8)`,
      [TENANT_QUALITY, w.itemId],
    );
    await su.query(
      `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value, lcl)
       VALUES (gen_random_uuid(), $1, $2, 'Weight', 500, 490)`,
      [TENANT_QUALITY, w.itemId],
    );
    await su.query(
      `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value, ucl, lcl)
       VALUES (gen_random_uuid(), $1, $2, 'Density', 1.02, 1.05, 0.99)`,
      [TENANT_QUALITY, w.itemId],
    );
  });

  it("a point band (UCL = LCL) is refused BY NAME — a band is real or absent", async () => {
    const w = await freshSpecWorld("BAND-POINT", { parameter: "Viscosity" });
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value, ucl, lcl)
           VALUES (gen_random_uuid(), $1, $2, 'pH', 7, 7.5, 7.5)`,
          [TENANT_QUALITY, w.itemId],
        ),
      "ck_quality_specifications_band",
      "23514",
    );
  });

  it("an inverted band (UCL < LCL) is refused BY NAME", async () => {
    const w = await freshSpecWorld("BAND-INV", { parameter: "Viscosity" });
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value, ucl, lcl)
           VALUES (gen_random_uuid(), $1, $2, 'pH', 7, 6.5, 7.5)`,
          [TENANT_QUALITY, w.itemId],
        ),
      "ck_quality_specifications_band",
      "23514",
    );
  });

  it("the (tenant, item, parameter) uniqueness refuses a duplicate parameter", async () => {
    const w = await freshSpecWorld("BAND-DUP", { parameter: "Viscosity" });
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value)
           VALUES (gen_random_uuid(), $1, $2, 'Viscosity', 101)`,
          [TENANT_QUALITY, w.itemId],
        ),
      "uq_quality_specifications_tenant_item_parameter",
      "23505",
    );
  });

  it("a foreign tenant's spec row never satisfies the composite FK — refused BY NAME", async () => {
    // The composite (id, tenant_id) law: an item of ANOTHER tenant is not
    // a valid target (the probe uses the boundary tenant's absent world).
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value)
           VALUES (gen_random_uuid(), $1, $2, 'Viscosity', 100)`,
          [TENANT_QUALITY, "00000000-0000-0000-0000-0000000000ff"],
        ),
      "fk_quality_specifications_item",
      "23503",
    );
  });
});

describe("PHASE-050 W-24 — the SPC sample store (0113, Q-04/D-12)", () => {
  it("the legal sources insert (MANUAL/PRODUCTION/INSPECTION) with the batch provenance", async () => {
    const world = await freshQualityBatch("SPC-LEGAL");
    const spec = await su.query<{ id: string }>(
      `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value, ucl, lcl)
       VALUES (gen_random_uuid(), $1, $2, 'Viscosity', 100, 110, 90)
       RETURNING id`,
      [TENANT_QUALITY, world.itemId],
    );
    for (const source of ["MANUAL", "PRODUCTION", "INSPECTION"]) {
      await su.query(
        `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at, source, batch_id)
         VALUES (gen_random_uuid(), $1, $2, 100, '2026-02-10T09:00:00Z', $3, $4)`,
        [TENANT_QUALITY, spec.rows[0]!.id, source, world.batchId],
      );
    }
    // Negative values are legal measurements (a temperature, a deviation).
    await su.query(
      `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at, source)
       VALUES (gen_random_uuid(), $1, $2, -4.5, '2026-02-10T10:00:00Z', 'MANUAL')`,
      [TENANT_QUALITY, spec.rows[0]!.id],
    );
  });

  it("an unknown source is refused BY NAME — the vocabulary is closed", async () => {
    const w = await freshSpecWorld("SPC-SRC", { parameter: "Viscosity" });
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at, source)
           VALUES (gen_random_uuid(), $1, $2, 100, '2026-02-10T09:00:00Z', 'TELEPATHY')`,
          [TENANT_QUALITY, w.specId],
        ),
      "ck_spc_measurements_source",
      "23514",
    );
  });

  it("a sample without its specification is refused BY NAME (no parallel parameter source — D-12)", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at)
           VALUES (gen_random_uuid(), $1, '00000000-0000-0000-0000-0000000000ee', 100,
            '2026-02-10T09:00:00Z')`,
          [TENANT_QUALITY],
        ),
      "fk_spc_measurements_spec",
      "23503",
    );
  });
});

describe("PHASE-050 W-24 — BR-102's disposition-closure gate at the floor (0114, Q-01)", () => {
  it("the legal ladder inserts: OPEN (no stamps) → DISPOSITIONED (the disposition pair) → CLOSED (both pairs)", async () => {
    const itemId = await freshQualityItem("NCR-LEGAL");
    await insertNcr({ itemId, ncrNo: "NCR-QL-LEGAL-1", status: "OPEN" });
    await insertNcr({
      itemId,
      ncrNo: "NCR-QL-LEGAL-2",
      status: "DISPOSITIONED",
      disposition: "REWORK",
      dispositionAt: "2026-02-15T10:00:00Z",
    });
    await insertNcr({
      itemId,
      ncrNo: "NCR-QL-LEGAL-3",
      status: "CLOSED",
      disposition: "ACCEPT",
      dispositionAt: "2026-02-15T10:00:00Z",
      closedAt: "2026-02-20T10:00:00Z",
    });
  });

  it("a DISPOSITIONED row without its disposition is refused BY NAME — no closure without a disposition", async () => {
    const itemId = await freshQualityItem("NCR-NODISP");
    await expectConstraint(
      () =>
        insertNcr({
          itemId,
          ncrNo: "NCR-QL-NODISP-1",
          status: "DISPOSITIONED",
          dispositionAt: "2026-02-15T10:00:00Z",
        }),
      "ck_ncr_records_disposition_gate",
      "23514",
    );
  });

  it("a CLOSED row without the full stamp pair is refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-NOCLOSE");
    await expectConstraint(
      () =>
        insertNcr({
          itemId,
          ncrNo: "NCR-QL-NOCLOSE-1",
          status: "CLOSED",
          disposition: "SCRAP",
          dispositionAt: "2026-02-15T10:00:00Z",
        }),
      "ck_ncr_records_disposition_gate",
      "23514",
    );
  });

  it("an OPEN row carrying a disposition is refused BY NAME — OPEN means no disposition yet", async () => {
    const itemId = await freshQualityItem("NCR-EARLY");
    await expectConstraint(
      () =>
        insertNcr({
          itemId,
          ncrNo: "NCR-QL-EARLY-1",
          status: "OPEN",
          disposition: "REWORK",
          dispositionAt: "2026-02-15T10:00:00Z",
        }),
      "ck_ncr_records_disposition_gate",
      "23514",
    );
  });

  it("the INSPECTION source without its inspection is refused BY NAME (the source-shape law)", async () => {
    const itemId = await freshQualityItem("NCR-SRCINS");
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-SRCINS-1", source: "INSPECTION" }),
      "ck_ncr_records_source_shape",
      "23514",
    );
  });

  it("the SUPPLIER source without its supplier partner is refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-SRCSUP");
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-SRCSUP-1", source: "SUPPLIER" }),
      "ck_ncr_records_source_shape",
      "23514",
    );
  });

  it("the COMPLAINT source without its customer partner is refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-SRCCMP");
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-SRCCMP-1", source: "COMPLAINT" }),
      "ck_ncr_records_source_shape",
      "23514",
    );
  });

  it("the affected quantity floor: zero and negative refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-QTY");
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-QTY-0", affectedQty: 0 }),
      "ck_ncr_records_affected_qty",
      "23514",
    );
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-QTY-NEG", affectedQty: -1 }),
      "ck_ncr_records_affected_qty",
      "23514",
    );
  });

  it("THE G-62 JOURNAL GATE: a journal stamp on a non-SCRAP disposition is refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-JNLWRONG");
    await expectConstraint(
      () =>
        insertNcr({
          itemId,
          ncrNo: "NCR-QL-JNLWRONG-1",
          status: "DISPOSITIONED",
          disposition: "REWORK",
          dispositionAt: "2026-02-15T10:00:00Z",
          journalEntryId: "00000000-0000-0000-0000-0000000000dd",
        }),
      "ck_ncr_records_journal_gated",
      "23514",
    );
  });

  it("THE G-62 JOURNAL GATE: a journal stamp on the OPEN path is refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-JNLOPEN");
    await expectConstraint(
      () =>
        insertNcr({
          itemId,
          ncrNo: "NCR-QL-JNLOPEN-1",
          status: "OPEN",
          journalEntryId: "00000000-0000-0000-0000-0000000000dd",
        }),
      "ck_ncr_records_journal_gated",
      "23514",
    );
  });

  it("the severity/source/disposition vocabularies are closed — refused BY NAME", async () => {
    const itemId = await freshQualityItem("NCR-VOCAB");
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-VOCAB-SEV", severity: "CATASTROPHIC" }),
      "ck_ncr_records_severity",
      "23514",
    );
    await expectConstraint(
      () => insertNcr({ itemId, ncrNo: "NCR-QL-VOCAB-SRC", source: "AUDIT" }),
      "ck_ncr_records_source",
      "23514",
    );
    await expectConstraint(
      () =>
        insertNcr({
          itemId,
          ncrNo: "NCR-QL-VOCAB-DISP",
          status: "DISPOSITIONED",
          disposition: "DESTROY",
          dispositionAt: "2026-02-15T10:00:00Z",
        }),
      "ck_ncr_records_disposition",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — BR-103's effectiveness floor + the G-63 cost stamp (0114, Q-02)", () => {
  async function insertCapa(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO capa_records
         (id, tenant_id, capa_no, ncr_id, title, owner_employee_id, root_cause,
          root_cause_at, actions, due_date, status, effectiveness, external_cost,
          journal_entry_id, closed_at, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb,
          $12, $13, $14, $15)`,
      [
        TENANT_QUALITY,
        row.capaNo,
        row.ncrId ?? null,
        row.title ?? "Contain the drift",
        row.ownerEmployeeId ?? null,
        row.rootCause ?? null,
        row.rootCauseAt ?? null,
        row.actions ?? "[]",
        row.dueDate ?? null,
        row.status ?? "OPEN",
        row.effectiveness ?? null,
        row.externalCost ?? 0,
        row.journalEntryId ?? null,
        row.closedAt ?? null,
        QL_ACTOR,
      ],
    );
  }

  it("the legal shapes insert: OPEN with the actions array → IN_PROGRESS → CLOSED with the effectiveness object", async () => {
    await insertCapa({
      capaNo: "CAPA-QL-LEGAL-1",
      actions: JSON.stringify([
        { title: "Recalibrate", ownerEmployeeId: null, dueDate: "2026-03-01" },
      ]),
    });
    await insertCapa({
      capaNo: "CAPA-QL-LEGAL-2",
      status: "IN_PROGRESS",
      rootCause: "Thermostat drift",
      rootCauseAt: "2026-02-18T09:00:00Z",
      actions: JSON.stringify([
        { title: "Recalibrate", ownerEmployeeId: null, dueDate: "2026-03-01", completedAt: "2026-02-25T09:00:00Z" },
      ]),
      externalCost: 417.25,
    });
    await insertCapa({
      capaNo: "CAPA-QL-LEGAL-3",
      status: "CLOSED",
      actions: JSON.stringify([
        { title: "Recalibrate", ownerEmployeeId: null, dueDate: "2026-03-01", completedAt: "2026-02-25T09:00:00Z" },
      ]),
      effectiveness: JSON.stringify({ result: "EFFECTIVE", checkedAt: "2026-03-10T09:00:00Z" }),
      externalCost: 417.25,
      closedAt: "2026-03-11T09:00:00Z",
    });
  });

  it("a CLOSED CAPA without the effectiveness record is refused BY NAME — BR-103's floor", async () => {
    await expectConstraint(
      () =>
        insertCapa({
          capaNo: "CAPA-QL-NOEFF-1",
          status: "CLOSED",
          closedAt: "2026-03-11T09:00:00Z",
        }),
      "ck_capa_records_close_gate",
      "23514",
    );
  });

  it("a CLOSED CAPA without its closed_at stamp is refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertCapa({
          capaNo: "CAPA-QL-NOSTAMP-1",
          status: "CLOSED",
          effectiveness: JSON.stringify({ result: "EFFECTIVE" }),
        }),
      "ck_capa_records_close_gate",
      "23514",
    );
  });

  it("an open-path row carrying closed_at is refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertCapa({
          capaNo: "CAPA-QL-EARLYCLOSE-1",
          status: "OPEN",
          closedAt: "2026-03-11T09:00:00Z",
        }),
      "ck_capa_records_close_gate",
      "23514",
    );
  });

  it("THE G-63 COST GATE: a journal stamp on a zero-cost CAPA is refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertCapa({
          capaNo: "CAPA-QL-JNLZERO-1",
          status: "IN_PROGRESS",
          externalCost: 0,
          journalEntryId: "00000000-0000-0000-0000-0000000000dd",
        }),
      "ck_capa_records_journal_gated",
      "23514",
    );
  });

  it("a negative external cost is refused BY NAME", async () => {
    await expectConstraint(
      () => insertCapa({ capaNo: "CAPA-QL-NEGCOST-1", externalCost: -1 }),
      "ck_capa_records_external_cost",
      "23514",
    );
  });

  it("the actions array shape is enforced — an object refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertCapa({
          capaNo: "CAPA-QL-ACTIONS-1",
          actions: JSON.stringify({ title: "not an array" }),
        }),
      "ck_capa_records_actions_shape",
      "23514",
    );
  });

  it("the effectiveness shape is enforced — an array refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertCapa({
          capaNo: "CAPA-QL-EFFSHAPE-1",
          status: "CLOSED",
          effectiveness: JSON.stringify(["not an object"]),
          closedAt: "2026-03-11T09:00:00Z",
        }),
      "ck_capa_records_effectiveness_shape",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — the complaints' resolved-shape law (0114, Q-08)", () => {
  async function insertComplaint(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO complaints
         (id, tenant_id, complaint_no, channel, severity, customer_id, item_id, batch_id,
          ncr_id, subject, details, status, resolution, resolved_at, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        TENANT_QUALITY,
        row.complaintNo,
        row.channel ?? "PHONE",
        row.severity ?? "MEDIUM",
        basePartnerId,
        row.itemId ?? null,
        row.batchId ?? null,
        row.ncrId ?? null,
        row.subject ?? "Lumpy syrup",
        row.details ?? null,
        row.status ?? "NEW",
        row.resolution ?? null,
        row.resolvedAt ?? null,
        QL_ACTOR,
      ],
    );
  }

  it("the legal lifecycle inserts: NEW → TRIAGED → IN_PROGRESS → RESOLVED/CLOSED with the pair", async () => {
    const itemId = await freshQualityItem("CMP-LEGAL");
    for (const status of ["NEW", "TRIAGED", "IN_PROGRESS"]) {
      await insertComplaint({ complaintNo: `CMP-QL-LEGAL-${status}`, itemId, status });
    }
    for (const status of ["RESOLVED", "CLOSED"]) {
      await insertComplaint({
        complaintNo: `CMP-QL-LEGAL-${status}`,
        itemId,
        status,
        resolution: "Replaced the batch",
        resolvedAt: "2026-02-22T10:00:00Z",
      });
    }
  });

  it("a RESOLVED complaint without its resolution is refused BY NAME", async () => {
    const itemId = await freshQualityItem("CMP-NORES");
    await expectConstraint(
      () =>
        insertComplaint({
          complaintNo: "CMP-QL-NORES-1",
          itemId,
          status: "RESOLVED",
          resolvedAt: "2026-02-22T10:00:00Z",
        }),
      "ck_complaints_resolved_shape",
      "23514",
    );
  });

  it("an open-path complaint carrying the resolution pair is refused BY NAME", async () => {
    const itemId = await freshQualityItem("CMP-EARLY");
    await expectConstraint(
      () =>
        insertComplaint({
          complaintNo: "CMP-QL-EARLY-1",
          itemId,
          status: "NEW",
          resolution: "Replaced the batch",
          resolvedAt: "2026-02-22T10:00:00Z",
        }),
      "ck_complaints_resolved_shape",
      "23514",
    );
  });

  it("the channel vocabulary is closed — refused BY NAME", async () => {
    const itemId = await freshQualityItem("CMP-CHAN");
    await expectConstraint(
      () => insertComplaint({ complaintNo: "CMP-QL-CHAN-1", itemId, channel: "FAX" }),
      "ck_complaints_channel",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — the calibration register (0115, Q-03/D-08)", () => {
  async function insertCalibration(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO calibration_records
         (id, tenant_id, calibration_no, asset_id, standard_used, result, calibrated_at,
          due_date, provider_id, certificate_ref, external_cost, journal_entry_id, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        TENANT_QUALITY,
        row.calibrationNo,
        row.assetId ?? instrumentAssetId,
        row.standardUsed ?? "ISO 17025 reference",
        row.result ?? "PASS",
        row.calibratedAt ?? "2026-01-15T09:00:00Z",
        row.dueDate ?? "2027-01-15",
        row.providerId ?? null,
        row.certificateRef ?? null,
        row.externalCost ?? 0,
        row.journalEntryId ?? null,
        QL_ACTOR,
      ],
    );
  }

  it("the legal shapes insert: PASS/FAIL/ADJUSTED with the due date strictly after (D-08's binding)", async () => {
    for (const result of ["PASS", "FAIL", "ADJUSTED"]) {
      await insertCalibration({ calibrationNo: `CAL-QL-LEGAL-${result}`, result });
    }
    // The external cost carries its G-63 stamp only with a cost — the
    // posting itself is W-26's; here the zero-cost shape inserts clean.
    await insertCalibration({ calibrationNo: "CAL-QL-LEGAL-COST", externalCost: 417.25 });
  });

  it("a due date BEFORE the calibration act is refused BY NAME (the UTC-pinned floor)", async () => {
    await expectConstraint(
      () =>
        insertCalibration({
          calibrationNo: "CAL-QL-DUEBEFORE-1",
          calibratedAt: "2026-01-15T09:00:00Z",
          dueDate: "2026-01-15",
        }),
      "ck_calibration_records_due_after",
      "23514",
    );
  });

  it("THE G-63 COST GATE: a journal stamp on a zero-cost calibration is refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertCalibration({
          calibrationNo: "CAL-QL-JNLZERO-1",
          externalCost: 0,
          journalEntryId: "00000000-0000-0000-0000-0000000000dd",
        }),
      "ck_calibration_records_journal_gated",
      "23514",
    );
  });

  it("the result vocabulary is closed — refused BY NAME", async () => {
    await expectConstraint(
      () => insertCalibration({ calibrationNo: "CAL-QL-RESULT-1", result: "MAYBE" }),
      "ck_calibration_records_result",
      "23514",
    );
  });

  it("THE INSTRUMENT-ASSET BINDING: a foreign asset is refused BY NAME (D-08 — the composite FK)", async () => {
    await expectConstraint(
      () =>
        insertCalibration({
          calibrationNo: "CAL-QL-ASSET-1",
          assetId: "00000000-0000-0000-0000-0000000000ea",
        }),
      "fk_calibration_records_asset",
      "23503",
    );
  });
});

describe("PHASE-050 W-24 — the supplier quality fold (0115, Q-06/D-13)", () => {
  it("the legal fold rows insert (one per partner per period) with the counts and the bounded score", async () => {
    await su.query(
      `INSERT INTO supplier_quality_scores
         (id, tenant_id, partner_id, period_start, ncr_count, rejection_count,
          on_time_deliveries, total_deliveries, score, created_by)
       VALUES (gen_random_uuid(), $1, $2, '2026-01-01', 1, 2, 8, 10, 87.5, $3)`,
      [TENANT_QUALITY, basePartnerId, QL_ACTOR],
    );
  });

  it("the (tenant, partner, period) uniqueness refuses a duplicate window row", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO supplier_quality_scores
             (id, tenant_id, partner_id, period_start, score, created_by)
           VALUES (gen_random_uuid(), $1, $2, '2026-01-01', 90, $3)`,
          [TENANT_QUALITY, basePartnerId, QL_ACTOR],
        ),
      "uq_supplier_quality_scores_tenant_partner_period",
      "23505",
    );
  });

  it("on-time deliveries beyond the total are refused BY NAME (the delivery shape)", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO supplier_quality_scores
             (id, tenant_id, partner_id, period_start, on_time_deliveries, total_deliveries,
              score, created_by)
           VALUES (gen_random_uuid(), $1, $2, '2026-02-01', 11, 10, 90, $3)`,
          [TENANT_QUALITY, basePartnerId, QL_ACTOR],
        ),
      "ck_supplier_quality_scores_counts",
      "23514",
    );
  });

  it("the score bounds are enforced — 100.01 and -1 refused BY NAME", async () => {
    for (const score of [100.01, -1]) {
      await expectConstraint(
        () =>
          su.query(
            `INSERT INTO supplier_quality_scores
               (id, tenant_id, partner_id, period_start, score, created_by)
             VALUES (gen_random_uuid(), $1, $2, '2026-03-01', $3, $4)`,
            [TENANT_QUALITY, basePartnerId, score, QL_ACTOR],
          ),
        "ck_supplier_quality_scores_score",
        "23514",
      );
    }
  });
});

describe("PHASE-050 W-24 — the COA/COC frozen snapshot (0115, Q-07/BR-104)", () => {
  async function insertCoa(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO coa_documents
         (id, tenant_id, doc_no, doc_type, item_id, batch_id, inspection_id, parameters,
          issued_at, issued_by, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        TENANT_QUALITY,
        row.docNo,
        row.docType ?? "COA",
        row.itemId,
        row.batchId ?? null,
        row.inspectionId ?? null,
        row.parameters ?? JSON.stringify([
          { parameter: "Viscosity", target: 100, ucl: 110, lcl: 90, measured: 100, within: true },
        ]),
        row.issuedAt ?? "2026-02-11T10:00:00Z",
        row.issuedBy ?? QL_ACTOR,
        QL_ACTOR,
      ],
    );
  }

  it("the legal certificates insert: COA and COC, the frozen parameter arrays", async () => {
    const itemId = await freshQualityItem("COA-LEGAL");
    await insertCoa({ docNo: "COA-QL-LEGAL-1", itemId, docType: "COA" });
    await insertCoa({
      docNo: "COC-QL-LEGAL-1",
      itemId,
      docType: "COC",
      parameters: JSON.stringify([
        { parameter: "Viscosity", target: 100, ucl: 110, lcl: 90, measured: 112, within: false, deviationNcr: "NCR-QL-LEGAL-3" },
      ]),
    });
  });

  it("the frozen snapshot must be an ARRAY — an object refused BY NAME", async () => {
    const itemId = await freshQualityItem("COA-SHAPE");
    await expectConstraint(
      () =>
        insertCoa({
          docNo: "COA-QL-SHAPE-1",
          itemId,
          parameters: JSON.stringify({ parameter: "Viscosity" }),
        }),
      "ck_coa_documents_parameters_shape",
      "23514",
    );
  });

  it("the doc_type vocabulary is closed — refused BY NAME", async () => {
    const itemId = await freshQualityItem("COA-TYPE");
    await expectConstraint(
      () => insertCoa({ docNo: "COA-QL-TYPE-1", itemId, docType: "COf" }),
      "ck_coa_documents_type",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — THE ONE-ACTIVE-HOLD-PER-BATCH LAW + BR-101's release floor (0116, Q-09/INV-035)", () => {
  async function insertHold(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO batch_quality_holds
         (id, tenant_id, batch_id, reason, ncr_id, status, held_at, released_at,
          release_note, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        TENANT_QUALITY,
        row.batchId,
        row.reason ?? "Foreign matter suspected",
        row.ncrId ?? null,
        row.status ?? "ACTIVE",
        row.heldAt ?? "2026-02-20T08:00:00Z",
        row.releasedAt ?? null,
        row.releaseNote ?? null,
        QL_ACTOR,
      ],
    );
  }

  it("the legal hold → release cycle inserts, and a RELEASED row re-arms the batch for a NEW active hold", async () => {
    const world = await freshQualityBatch("HOLD-LEGAL");
    await insertHold({ batchId: world.batchId });
    // Released with the full pair + the disposition link (an NCR world of
    // its own — BR-101's record).
    const itemId = await freshQualityItem("HOLD-LEGAL-NCR");
    const ncr = await su.query<{ id: string }>(
      `INSERT INTO ncr_records (id, tenant_id, ncr_no, source, item_id, problem, affected_qty,
          status, disposition, disposition_at)
       VALUES (gen_random_uuid(), $1, 'NCR-QL-HOLD-LEGAL', 'PRODUCTION', $2, 'Foreign matter',
          3, 'DISPOSITIONED', 'ACCEPT', '2026-02-21T09:00:00Z')
       RETURNING id`,
      [TENANT_QUALITY, itemId],
    );
    await su.query(
      `UPDATE batch_quality_holds SET status = 'RELEASED', released_at = '2026-02-21T10:00:00Z',
          release_note = 'Disposition accepted', ncr_id = $1
       WHERE tenant_id = $2 AND batch_id = $3 AND status = 'ACTIVE'`,
      [ncr.rows[0]!.id, TENANT_QUALITY, world.batchId],
    );
    // The re-arm: a NEW active hold on the same batch is legal (the
    // partial unique keys on ACTIVE alone).
    await insertHold({ batchId: world.batchId, reason: "Second look" });
  });

  it("a SECOND ACTIVE hold on the same batch is refused BY NAME — the blocking read stays single-row", async () => {
    const world = await freshQualityBatch("HOLD-SECOND");
    await insertHold({ batchId: world.batchId });
    await expectConstraint(
      () => insertHold({ batchId: world.batchId, reason: "Another reason" }),
      "uq_batch_quality_holds_tenant_batch_active",
      "23505",
    );
  });

  it("a RELEASED hold without the release pair is refused BY NAME — release requires the record", async () => {
    const world = await freshQualityBatch("HOLD-NOPAIR");
    await insertHold({ batchId: world.batchId });
    await expectConstraint(
      () =>
        su.query(
          `UPDATE batch_quality_holds SET status = 'RELEASED', released_at = '2026-02-21T10:00:00Z'
           WHERE tenant_id = $1 AND batch_id = $2 AND status = 'ACTIVE'`,
          [TENANT_QUALITY, world.batchId],
        ),
      "ck_batch_quality_holds_release_shape",
      "23514",
    );
  });

  it("a RELEASED hold without the DISPOSITION LINK (the NCR) is refused BY NAME — BR-101's floor", async () => {
    const world = await freshQualityBatch("HOLD-NOLINK");
    await insertHold({ batchId: world.batchId });
    await expectConstraint(
      () =>
        su.query(
          `UPDATE batch_quality_holds SET status = 'RELEASED', released_at = '2026-02-21T10:00:00Z',
              release_note = 'Accepted'
           WHERE tenant_id = $1 AND batch_id = $2 AND status = 'ACTIVE'`,
          [TENANT_QUALITY, world.batchId],
        ),
      "ck_batch_quality_holds_release_shape",
      "23514",
    );
  });

  it("an ACTIVE hold carrying release stamps is refused BY NAME", async () => {
    const world = await freshQualityBatch("HOLD-EARLY");
    await expectConstraint(
      () =>
        insertHold({
          batchId: world.batchId,
          status: "ACTIVE",
          releasedAt: "2026-02-21T10:00:00Z",
          releaseNote: "Premature",
        }),
      "ck_batch_quality_holds_release_shape",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — the recall drill's record (0116, Q-09/Q-12/D-14)", () => {
  async function insertRecall(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO recall_registry
         (id, tenant_id, recall_no, batch_id, reason, status, initiated_at, executed_at,
          closed_at, scope, affected_customers, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
      [
        TENANT_QUALITY,
        row.recallNo,
        row.batchId,
        row.reason ?? "Precautionary drill",
        row.status ?? "INITIATED",
        row.initiatedAt ?? "2026-02-23T08:00:00Z",
        row.executedAt ?? null,
        row.closedAt ?? null,
        row.scope ?? null,
        row.affectedCustomers ?? null,
        QL_ACTOR,
      ],
    );
  }

  it("the legal ladder inserts: INITIATED → EXECUTED (the frozen snapshots) → CLOSED", async () => {
    const world = await freshQualityBatch("RCL-LEGAL");
    await insertRecall({ recallNo: "RCL-QL-LEGAL-1", batchId: world.batchId });
    await insertRecall({
      recallNo: "RCL-QL-LEGAL-2",
      batchId: world.batchId,
      status: "EXECUTED",
      executedAt: "2026-02-23T10:00:00Z",
      scope: JSON.stringify(["where-used:WO-42", "where-used:SO-17"]),
      affectedCustomers: JSON.stringify(["QL-CUST"]),
    });
    await insertRecall({
      recallNo: "RCL-QL-LEGAL-3",
      batchId: world.batchId,
      status: "CLOSED",
      executedAt: "2026-02-23T10:00:00Z",
      closedAt: "2026-03-01T10:00:00Z",
    });
  });

  it("an EXECUTED row without its execution stamp is refused BY NAME", async () => {
    const world = await freshQualityBatch("RCL-NOSTAMP");
    await expectConstraint(
      () =>
        insertRecall({ recallNo: "RCL-QL-NOSTAMP-1", batchId: world.batchId, status: "EXECUTED" }),
      "ck_recall_registry_stamps",
      "23514",
    );
  });

  it("a CLOSED row without the full pair is refused BY NAME", async () => {
    const world = await freshQualityBatch("RCL-NOFULL");
    await expectConstraint(
      () =>
        insertRecall({
          recallNo: "RCL-QL-NOFULL-1",
          batchId: world.batchId,
          status: "CLOSED",
          closedAt: "2026-03-01T10:00:00Z",
        }),
      "ck_recall_registry_stamps",
      "23514",
    );
  });

  it("the scope snapshot must be an ARRAY — an object refused BY NAME", async () => {
    const world = await freshQualityBatch("RCL-SCOPE");
    await expectConstraint(
      () =>
        insertRecall({
          recallNo: "RCL-QL-SCOPE-1",
          batchId: world.batchId,
          status: "EXECUTED",
          executedAt: "2026-02-23T10:00:00Z",
          scope: JSON.stringify({ chain: "not an array" }),
        }),
      "ck_recall_registry_scope_shape",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — the management reviews' frozen pack (0116, Q-10/D-15)", () => {
  it("the legal record inserts: the meeting with the indicator pack object + the arrays", async () => {
    await su.query(
      `INSERT INTO quality_management_reviews
         (id, tenant_id, review_no, title, held_at, attendees, indicator_pack, decisions,
          created_by)
       VALUES (gen_random_uuid(), $1, 'QMR-QL-LEGAL-1', 'Quarterly quality review',
          '2026-03-31T13:00:00Z',
          '[{"name":"QA Lead"}]'::jsonb,
          '{"ncr":{"open":2,"closed":5},"capa":{"open":1},"complaints":{"new":0},"spc":{"outOfControl":0}}'::jsonb,
          '[{"title":"Rebalance the viscosity band"}]'::jsonb, $2)`,
      [TENANT_QUALITY, QL_ACTOR],
    );
  });

  it("the indicator pack must be an OBJECT — an array refused BY NAME", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_management_reviews
             (id, tenant_id, review_no, title, held_at, indicator_pack, created_by)
           VALUES (gen_random_uuid(), $1, 'QMR-QL-PACK-1', 'Bad pack', '2026-03-31T13:00:00Z',
            '["not an object"]'::jsonb, $2)`,
          [TENANT_QUALITY, QL_ACTOR],
        ),
      "ck_quality_management_reviews_indicators_shape",
      "23514",
    );
  });

  it("the attendees and decisions must be ARRAYS — refused BY NAME", async () => {
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_management_reviews
             (id, tenant_id, review_no, title, held_at, attendees, indicator_pack, created_by)
           VALUES (gen_random_uuid(), $1, 'QMR-QL-ATT-1', 'Bad attendees',
            '2026-03-31T13:00:00Z', '{"name":"not an array"}'::jsonb, '{}'::jsonb, $2)`,
          [TENANT_QUALITY, QL_ACTOR],
        ),
      "ck_quality_management_reviews_attendees_shape",
      "23514",
    );
    await expectConstraint(
      () =>
        su.query(
          `INSERT INTO quality_management_reviews
             (id, tenant_id, review_no, title, held_at, decisions, indicator_pack, created_by)
           VALUES (gen_random_uuid(), $1, 'QMR-QL-DEC-1', 'Bad decisions',
            '2026-03-31T13:00:00Z', '{"title":"not an array"}'::jsonb, '{}'::jsonb, $2)`,
          [TENANT_QUALITY, QL_ACTOR],
        ),
      "ck_quality_management_reviews_decisions_shape",
      "23514",
    );
  });
});

describe("PHASE-050 W-24 — the HACCP hazard registers (0116, Q-11/D-15)", () => {
  async function insertHazard(row: Record<string, unknown>): Promise<unknown> {
    return su.query(
      `INSERT INTO hazard_registers
         (id, tenant_id, name, name_ar, hazard, hazard_ar, category, process_step, item_id,
          is_ccp, critical_limit, critical_limit_ar, monitoring_procedure, corrective_action,
          is_active, created_by)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        TENANT_QUALITY,
        row.name,
        row.nameAr ?? null,
        row.hazard ?? "Pathogen growth",
        row.hazardAr ?? null,
        row.category ?? "BIOLOGICAL",
        row.processStep ?? null,
        row.itemId ?? null,
        row.isCcp ?? false,
        row.criticalLimit ?? null,
        row.criticalLimitAr ?? null,
        row.monitoringProcedure ?? null,
        row.correctiveAction ?? null,
        row.isActive ?? true,
        QL_ACTOR,
      ],
    );
  }

  it("the legal shapes insert: a non-CCP hazard and a CCP with its critical limit (the tenant's own structure)", async () => {
    const itemId = await freshQualityItem("HAZ-LEGAL");
    await insertHazard({ name: "QL Cold chain", isCcp: true, criticalLimit: "≤ 4°C" });
    await insertHazard({
      name: "QL Metal shards",
      category: "PHYSICAL",
      hazard: "Metal fragments",
      itemId,
      processStep: "Filling",
      monitoringProcedure: "Magnet check per lot",
      correctiveAction: "Hold + sieve",
    });
  });

  it("a CCP without its critical limit is refused BY NAME — the HACCP floor", async () => {
    await expectConstraint(
      () => insertHazard({ name: "QL CCP no limit", isCcp: true }),
      "ck_hazard_registers_ccp_limit",
      "23514",
    );
  });

  it("the category vocabulary is closed — refused BY NAME", async () => {
    await expectConstraint(
      () => insertHazard({ name: "QL Bad category", category: "RADIATION" }),
      "ck_hazard_registers_category",
      "23514",
    );
  });

  it("the (tenant, name) uniqueness refuses a duplicate register name", async () => {
    await insertHazard({ name: "QL UNIQUE HAZARD" });
    await expectConstraint(
      () => insertHazard({ name: "QL UNIQUE HAZARD", category: "CHEMICAL" }),
      "uq_hazard_registers_tenant_name",
      "23505",
    );
  });
});
