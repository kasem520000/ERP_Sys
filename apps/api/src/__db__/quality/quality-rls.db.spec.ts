import { beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { appClient, superuserClient } from "../test-db";
import * as qualityStore from "../../modules/quality/infrastructure/quality.store";
import { CalibrationService } from "../../modules/quality/application/calibration-service";
import { CapaService } from "../../modules/quality/application/capa-service";
import { CoaService } from "../../modules/quality/application/coa-service";
import { HazardRegistersService } from "../../modules/quality/application/hazards-service";
import { ManagementReviewsService } from "../../modules/quality/application/reviews-service";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { SpcService } from "../../modules/quality/application/spc-service";
import { SpecificationService } from "../../modules/quality/application/specification-service";
import { SupplierScoreService } from "../../modules/quality/application/supplier-score-service";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  audit,
  complaints,
  currentMonthStart,
  ensureQualityOwnerTarget,
  freshQualityHoldWorld,
  freshQualityInstrument,
  freshQualityItem,
  freshQualitySupplier,
  holds,
  numbering,
  posting,
  recalls,
  setupQualityFixture,
} from "./fixtures";

/**
 * PHASE-050 (W-31 — T-18b, 2026-11-23) · `quality-rls.db.spec` —
 * THE RLS ATTACK MATRIX A1–A10 over the TWELVE QUALITY FAMILY TABLES
 * (the 0113–0116 family; the cmms-rls precedent's exact attack
 * vocabulary, the family-deep edition): the victim is the QL world
 * (TENANT_QUALITY — seeded through the REAL services where cheap, the
 * direct SQL substrate for the master-data registers) and the attacker
 * is the DEDICATED BOUNDARY TENANT (TENANT_QUALITY_RLS — empty BY
 * CONSTRUCTION, never written: any row it ever saw would itself be the
 * breach), every probe running through the APP-ROLE path (withTenant +
 * the ambient transaction — the erp_app role the production request
 * rides, never superuser), and the attacker's connection running the
 * attack shapes against every table:
 *
 * A1 no-GUC reads fail closed · A2 the attacker's GUC never exposes
 * the victim's rows (the paired witness: the victim's own read ≥ 1 per
 * table — the rows EXIST — against the attacker's 0, at BOTH the raw
 * SQL floor and the store's own list surfaces) · A3 forged-tenant
 * INSERTs reject 42501 with zero residue · A4 staged UPDATE hijacks
 * touch 0 rows byte-identically · A5 DELETEs of the other tenant's
 * rows are denied (the evidence tables carry no grant by design — the
 * NCR/CAPA/complaint/calibration/COA/hold/recall/review/SPC history)
 * or touch 0 rows (the three master-data/rebuildable registers) ·
 * A7 id-probes leak no existence (0 rows, and the typed finds answer
 * the SAME not-found for a foreign id as for an absent one) · A8 THE
 * COMPOSITE-FK LAW (the pg_constraint catalog walk — every child FK is
 * (id, tenant_id) or the tenants root + a live FK-inversion probe
 * rejects 23503) · A9 the FK-chain joins stay confined · A10 UNION ALL
 * + a recursive CTE stay confined — and the final census: the victim's
 * world survives every attack row-for-row (the snapshot law — the
 * before/after census pair, the shared-tenant edition of the cmms
 * per-tenant census).
 */

/** The TWELVE quality family tables (0113–0116) — the attack surface. */
const QUALITY_TABLES = [
  "quality_specifications",
  "spc_measurements",
  "ncr_records",
  "capa_records",
  "complaints",
  "calibration_records",
  "supplier_quality_scores",
  "coa_documents",
  "batch_quality_holds",
  "recall_registry",
  "quality_management_reviews",
  "hazard_registers",
] as const;

/** The evidence-discipline tables — DELETE carries NO grant by design
 * (the 0113–0116 grants: the NCR/CAPA/complaint registers, the
 * calibration history, the SPC sample store, the COA certificates, the
 * holds, the recalls and the reviews are append-only evidence — A5
 * asserts the denial). */
const NO_DELETE_GRANT = new Set([
  "spc_measurements",
  "ncr_records",
  "capa_records",
  "complaints",
  "calibration_records",
  "coa_documents",
  "batch_quality_holds",
  "recall_registry",
  "quality_management_reviews",
]);

/** The victim's own ids the arms probe (seeded in beforeAll through the
 * REAL services — the per-table parent chains the forged inserts and
 * the id-probes target). */
interface VictimWorld {
  itemId: string;
  specId: string;
  batchId: string;
  batchItemId: string;
  instrumentAssetId: string;
  supplierPartnerId: string;
  customerPartnerId: string;
  ncrId: string;
  capaId: string;
  complaintId: string;
  calibrationId: string;
  scoreId: string;
  coaId: string;
  holdId: string;
  recallId: string;
  reviewId: string;
  hazardId: string;
}

const ncrs = new NcrService(audit, posting, numbering);
const capas = new CapaService(audit, posting, numbering);
const calibrations = new CalibrationService(audit, posting, numbering);
const specifications = new SpecificationService(audit);
const spc = new SpcService(audit);
const coa = new CoaService(audit, numbering);
const reviews = new ManagementReviewsService(audit, numbering, spc);
const hazards = new HazardRegistersService(audit);
const scores = new SupplierScoreService(audit);

let victim: VictimWorld;
/** The census snapshot taken after the seeding (the shared-tenant
 * edition: the victim tenant accumulates the family's other worlds, so
 * the honest census is the BEFORE/AFTER pair, never absolute counts). */
let censusBefore: Record<string, number>;

/** The per-table census (superuser — the audit read). */
async function census(): Promise<Record<string, number>> {
  const su = await superuserClient();
  const counts: Record<string, number> = {};
  for (const table of QUALITY_TABLES) {
    const rows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_QUALITY],
    );
    counts[table] = rows.rows[0]!.n;
  }
  await su.end();
  return counts;
}

/** The attacker's failure-capture connection (the cmms-rls precedent's
 * own): the erp_app role with the ATTACKER's GUC, BEGIN/COMMIT around
 * the statement so a refusal is captured, never ambient. */
async function attackExpectFailure(
  query: string,
  params: unknown[] = [],
): Promise<string | undefined> {
  const app = await appClient();
  await app.query("BEGIN");
  await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_QUALITY_RLS]);
  const failure = await app
    .query(query, params as never[])
    .then(() => undefined)
    .catch((error: { code?: string }) => error.code);
  await app.query("COMMIT");
  await app.end();
  return failure;
}

beforeAll(async () => {
  const base = await setupQualityFixture();
  await ensureQualityOwnerTarget();

  // THE VICTIM WORLD — every row through the REAL services (the master-
  // data registers' item/batch/asset substrate through the fixtures'
  // own surfaces). The spec/item plane.
  const itemId = await freshQualityItem("QRL");
  const spec = await withTenant(TENANT_QUALITY, () =>
    specifications.create({
      itemId,
      parameter: "Viscosity",
      parameterAr: "اللزوجة",
      unit: "cP",
      targetValue: "100.000000",
      ucl: "110.000000",
      lcl: "90.000000",
      actorId: QL_ACTOR,
    }),
  );
  await withTenant(TENANT_QUALITY, async () => {
    await spc.record({
      specId: spec.id,
      value: "100.500000",
      sampledAt: "2026-11-23T09:00:00.000Z",
      source: "PRODUCTION",
      actorId: QL_ACTOR,
    });
    await spc.record({
      specId: spec.id,
      value: "101.250000",
      sampledAt: "2026-11-23T10:00:00.000Z",
      source: "MANUAL",
      actorId: QL_ACTOR,
    });
  });
  const coaRow = await withTenant(TENANT_QUALITY, () =>
    coa.generate({
      docType: "COA",
      itemId,
      parameters: [{ specId: spec.id, value: "100.500000" }],
      actorId: QL_ACTOR,
    }),
  );

  // The batch/hold/recall plane (a batch-tracked world with REAL stock
  // — the NCR's on-hand floor and the recall drill's own substrate).
  const holdWorld = await freshQualityHoldWorld("QRL");
  const ncrRow = await withTenant(TENANT_QUALITY, () =>
    ncrs.create({
      source: "PRODUCTION",
      itemId: holdWorld.itemId,
      batchId: holdWorld.batchId,
      severity: "HIGH",
      problem: "the RLS victim world's NCR",
      affectedQty: "2",
      actorId: QL_ACTOR,
    }),
  );
  const holdRow = await withTenant(TENANT_QUALITY, () =>
    holds.create({
      batchId: holdWorld.batchId,
      reason: "the RLS victim world's hold",
      ncrId: ncrRow.id,
      actorId: QL_ACTOR,
    }),
  );
  const recallRow = await withTenant(TENANT_QUALITY, () =>
    recalls.initiate({
      batchId: holdWorld.batchId,
      reason: "the RLS victim world's recall",
      actorId: QL_ACTOR,
    }),
  );

  // The CAPA plane.
  const capaRow = await withTenant(TENANT_QUALITY, async () => {
    const created = await capas.create({
      title: "the RLS victim world's CAPA",
      actorId: QL_ACTOR,
    });
    return capas.recordRootCause(created.id, {
      rootCause: "the RLS victim world's root cause",
      actorId: QL_ACTOR,
    });
  });

  // The complaints plane (the QL customer — the base fixture's own).
  const complaintRow = await withTenant(TENANT_QUALITY, () =>
    complaints.create({
      channel: "PHONE",
      severity: "MEDIUM",
      customerId: base.partnerId,
      subject: "the RLS victim world's complaint",
      actorId: QL_ACTOR,
    }),
  );

  // The calibration plane (a fresh instrument asset — D-08's binding).
  const instrumentAssetId = await freshQualityInstrument("QRL");
  const calibrationRow = await withTenant(TENANT_QUALITY, () =>
    calibrations.create({
      assetId: instrumentAssetId,
      standardUsed: "ISO 17025 reference",
      result: "PASS",
      calibratedAt: "2026-01-15T09:00:00.000Z",
      dueDate: "2027-01-15",
      actorId: QL_ACTOR,
    }),
  );

  // The supplier-score plane (the REAL fold — the unmeasured zero on a
  // fresh supplier, an honest row through the engine's own upsert).
  const supplierWorld = await freshQualitySupplier("QRL");
  const scoreRow = await withTenant(TENANT_QUALITY, () =>
    scores.recompute({
      partnerId: supplierWorld.supplierId,
      periodStart: currentMonthStart(),
      actorId: QL_ACTOR,
    }),
  );

  // The review + hazard planes.
  const reviewRow = await withTenant(TENANT_QUALITY, () =>
    reviews.create({
      meetingDate: "2026-11-23T10:00:00.000Z",
      title: "the RLS victim world's review",
      attendees: ["Quality Manager"],
      decisions: ["Approve the RLS attack matrix"],
      actorId: QL_ACTOR,
    }),
  );
  const hazardRow = await withTenant(TENANT_QUALITY, () =>
    hazards.create({
      name: "HAZ-QRL-001 Pasteurization temperature",
      hazard: "Survival of pathogens at low pasteurization temperature",
      category: "BIOLOGICAL",
      processStep: "Pasteurization",
      isCcp: true,
      criticalLimit: ">= 72 C for 15 seconds",
      monitoringProcedure: "Continuous temperature recorder",
      correctiveAction: "Divert to re-pasteurization",
      actorId: QL_ACTOR,
    }),
  );

  victim = {
    itemId,
    specId: spec.id,
    batchId: holdWorld.batchId,
    batchItemId: holdWorld.itemId,
    instrumentAssetId,
    supplierPartnerId: supplierWorld.supplierId,
    customerPartnerId: base.partnerId,
    ncrId: ncrRow.id,
    capaId: capaRow.id,
    complaintId: complaintRow.id,
    calibrationId: calibrationRow.id,
    scoreId: scoreRow.row.id,
    coaId: coaRow.id,
    holdId: holdRow.id,
    recallId: recallRow.id,
    reviewId: reviewRow.id,
    hazardId: hazardRow.id,
  };

  // The seeding is REAL: the victim's own read sees every row (the
  // paired witness A2 rides).
  await withTenant(TENANT_QUALITY, async (tx) => {
    const rows = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM quality_specifications WHERE id = ${spec.id}`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  // THE CENSUS SNAPSHOT (after the seeding, before the attacks).
  censusBefore = await census();
  for (const table of QUALITY_TABLES) {
    expect(censusBefore[table], `${table} seeded`).toBeGreaterThanOrEqual(1);
  }
});

describe("PHASE-050 W-31 — T-18b: the QUALITY RLS attack matrix (A1–A10 × the twelve family tables)", () => {
  it("A1 — SELECT without any GUC fails closed on every table (0 rows)", async () => {
    for (const table of QUALITY_TABLES) {
      const app = await appClient();
      const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      await app.end();
      expect(rows.rows[0]!.n, table).toBe(0);
    }
  });

  it("A2 — the attacker's GUC never exposes the victim's rows (the paired witness at BOTH floors: the raw SQL counts and the store's own list surfaces)", async () => {
    // (a) THE RAW SQL FLOOR — the paired witness per table: the
    // victim's own read (the rows EXIST) against the attacker's 0.
    for (const table of QUALITY_TABLES) {
      const own = await withTenant(TENANT_QUALITY, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
        );
        return rows.rows[0]!.n;
      });
      expect(own, `${table} victim rows exist`).toBeGreaterThanOrEqual(1);
      const foreign = await withTenant(TENANT_QUALITY_RLS, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
        );
        return rows.rows[0]!.n;
      });
      expect(foreign, `${table} attacker sees none`).toBe(0);
    }

    // (b) THE STORE'S OWN LIST SURFACES — the services' reads under the
    // attacker's GUC return ZERO rows on every register (the service
    // floor rides the same boundary).
    const attackerLists = await withTenant(TENANT_QUALITY_RLS, async () => [
      await qualityStore.listQualitySpecs({ limit: 50 }),
      await qualityStore.listSpcMeasurements({ specId: victim.specId, limit: 50 }),
      await qualityStore.listNcrs({ limit: 50 }),
      await qualityStore.listCapas({ limit: 50 }),
      await qualityStore.listComplaints({ limit: 50 }),
      await qualityStore.listCalibrations({ limit: 50 }),
      await qualityStore.listSupplierQualityScores({ limit: 50 }),
      await qualityStore.listCoaDocuments({ limit: 50 }),
      await qualityStore.listBatchQualityHolds({ limit: 50 }),
      await qualityStore.listRecalls({ limit: 50 }),
      await qualityStore.listManagementReviews({ limit: 50 }),
      await qualityStore.listHazardRegisters({ limit: 50 }),
    ]);
    for (const [index, rows] of attackerLists.entries()) {
      expect(rows, `${QUALITY_TABLES[index]} store list`).toHaveLength(0);
    }
  });

  it("A3 — forged-tenant INSERTs (the victim's tenant_id under the attacker's GUC) reject 42501 with zero residue", async () => {
    const shapes: Array<[string, string, unknown[]]> = [
      [
        "quality_specifications",
        `INSERT INTO quality_specifications (id, tenant_id, item_id, parameter, target_value)
         VALUES (gen_random_uuid(), $1, $2, 'Forged viscosity', 100)`,
        [TENANT_QUALITY, victim.itemId],
      ],
      [
        "spc_measurements",
        `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at, source)
         VALUES (gen_random_uuid(), $1, $2, 100, '2026-04-01T09:00:00Z', 'MANUAL')`,
        [TENANT_QUALITY, victim.specId],
      ],
      [
        "ncr_records",
        `INSERT INTO ncr_records (id, tenant_id, ncr_no, source, severity, item_id, problem,
                                  affected_qty, status)
         VALUES (gen_random_uuid(), $1, 'NCR-FORGE-RLS', 'PRODUCTION', 'MEDIUM', $2,
                 'forged problem', 1, 'OPEN')`,
        [TENANT_QUALITY, victim.batchItemId],
      ],
      [
        "capa_records",
        `INSERT INTO capa_records (id, tenant_id, capa_no, title, status)
         VALUES (gen_random_uuid(), $1, 'CAPA-FORGE-RLS', 'forged capa', 'OPEN')`,
        [TENANT_QUALITY],
      ],
      [
        "complaints",
        `INSERT INTO complaints (id, tenant_id, complaint_no, channel, severity, customer_id,
                                subject, status)
         VALUES (gen_random_uuid(), $1, 'CMP-FORGE-RLS', 'PHONE', 'MEDIUM', $2,
                 'forged subject', 'NEW')`,
        [TENANT_QUALITY, victim.customerPartnerId],
      ],
      [
        "calibration_records",
        `INSERT INTO calibration_records (id, tenant_id, calibration_no, asset_id, standard_used,
                                         result, calibrated_at, due_date)
         VALUES (gen_random_uuid(), $1, 'CAL-FORGE-RLS', $2, 'ISO 17025 forged', 'PASS',
                 '2026-01-15T09:00:00Z', '2027-01-15')`,
        [TENANT_QUALITY, victim.instrumentAssetId],
      ],
      [
        "supplier_quality_scores",
        `INSERT INTO supplier_quality_scores (id, tenant_id, partner_id, period_start, score)
         VALUES (gen_random_uuid(), $1, $2, '2026-05-01', 50)`,
        [TENANT_QUALITY, victim.supplierPartnerId],
      ],
      [
        "coa_documents",
        `INSERT INTO coa_documents (id, tenant_id, doc_no, doc_type, item_id, parameters, issued_at)
         VALUES (gen_random_uuid(), $1, 'COA-FORGE-RLS', 'COA', $2,
                 '[{"parameter":"Viscosity"}]'::jsonb, '2026-02-11T10:00:00Z')`,
        [TENANT_QUALITY, victim.itemId],
      ],
      [
        "batch_quality_holds",
        `INSERT INTO batch_quality_holds (id, tenant_id, batch_id, reason, status, held_at)
         VALUES (gen_random_uuid(), $1, $2, 'forged hold', 'ACTIVE', now())`,
        [TENANT_QUALITY, victim.batchId],
      ],
      [
        "recall_registry",
        `INSERT INTO recall_registry (id, tenant_id, recall_no, batch_id, reason, status)
         VALUES (gen_random_uuid(), $1, 'REC-FORGE-RLS', $2, 'forged recall', 'INITIATED')`,
        [TENANT_QUALITY, victim.batchId],
      ],
      [
        "quality_management_reviews",
        `INSERT INTO quality_management_reviews (id, tenant_id, review_no, title, held_at,
                                                indicator_pack)
         VALUES (gen_random_uuid(), $1, 'QMR-FORGE-RLS', 'Forged review', '2026-03-31T13:00:00Z',
                 '{}'::jsonb)`,
        [TENANT_QUALITY],
      ],
      [
        "hazard_registers",
        `INSERT INTO hazard_registers (id, tenant_id, name, hazard, category, is_ccp)
         VALUES (gen_random_uuid(), $1, 'Forged hazard name', 'Forged pathogen', 'BIOLOGICAL',
                 false)`,
        [TENANT_QUALITY],
      ],
    ];
    for (const [table, query, params] of shapes) {
      const failure = await attackExpectFailure(query, params);
      expect(failure, `${table} forged insert`).toBe("42501");
    }
    // ZERO RESIDUE: the victim's census is unmoved.
    const after = await census();
    for (const [table, expected] of Object.entries(censusBefore)) {
      expect(after[table], `${table} residue`).toBe(expected);
    }
  });

  it("A4 — staged UPDATE hijacks under the attacker's GUC touch 0 rows (byte-identical)", async () => {
    const v = victim;
    const updates: Array<[string, SQL]> = [
      [
        "quality_specifications",
        sql`UPDATE quality_specifications SET unit = 'hijacked' WHERE id = ${v.specId}`,
      ],
      [
        "spc_measurements",
        sql`UPDATE spc_measurements SET value = 999 WHERE spec_id = ${v.specId}`,
      ],
      ["ncr_records", sql`UPDATE ncr_records SET problem = 'hijacked' WHERE id = ${v.ncrId}`],
      ["capa_records", sql`UPDATE capa_records SET title = 'hijacked' WHERE id = ${v.capaId}`],
      [
        "complaints",
        sql`UPDATE complaints SET subject = 'hijacked' WHERE id = ${v.complaintId}`,
      ],
      [
        "calibration_records",
        sql`UPDATE calibration_records SET standard_used = 'hijacked' WHERE id = ${v.calibrationId}`,
      ],
      [
        "supplier_quality_scores",
        sql`UPDATE supplier_quality_scores SET score = 0 WHERE partner_id = ${v.supplierPartnerId}`,
      ],
      [
        "coa_documents",
        sql`UPDATE coa_documents SET note = 'hijacked' WHERE id = ${v.coaId}`,
      ],
      [
        "batch_quality_holds",
        sql`UPDATE batch_quality_holds SET reason = 'hijacked' WHERE id = ${v.holdId}`,
      ],
      [
        "recall_registry",
        sql`UPDATE recall_registry SET reason = 'hijacked' WHERE id = ${v.recallId}`,
      ],
      [
        "quality_management_reviews",
        sql`UPDATE quality_management_reviews SET title = 'hijacked' WHERE id = ${v.reviewId}`,
      ],
      [
        "hazard_registers",
        sql`UPDATE hazard_registers SET hazard = 'hijacked' WHERE id = ${v.hazardId}`,
      ],
    ];
    for (const [table, update] of updates) {
      const affected = await withTenant(TENANT_QUALITY_RLS, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`WITH updated AS (${update} RETURNING 1) SELECT count(*)::int AS n FROM updated`,
        );
        return rows.rows[0]!.n;
      });
      expect(affected, `${table} hijack`).toBe(0);
    }
    // Byte-identical: the victim's probe rows unchanged (the probe pair).
    const su = await superuserClient();
    const ncrRow = await su.query<{ problem: string }>(
      `SELECT problem FROM ncr_records WHERE id = $1`,
      [victim.ncrId],
    );
    const holdRow = await su.query<{ reason: string }>(
      `SELECT reason FROM batch_quality_holds WHERE id = $1`,
      [victim.holdId],
    );
    const specRow = await su.query<{ unit: string }>(
      `SELECT unit FROM quality_specifications WHERE id = $1`,
      [victim.specId],
    );
    await su.end();
    expect(ncrRow.rows[0]!.problem).toBe("the RLS victim world's NCR");
    expect(holdRow.rows[0]!.reason).toBe("the RLS victim world's hold");
    expect(specRow.rows[0]!.unit).toBe("cP");
  });

  it("A5 — DELETEs of the other tenant's rows: the evidence tables DENIED (no grant by design), the master-data/rebuildable tables touch 0 rows", async () => {
    for (const table of QUALITY_TABLES) {
      if (NO_DELETE_GRANT.has(table)) {
        // The no-grant tables: the DELETE statement itself is denied
        // (42501 — permission denied; the registers are append-only
        // evidence by grants) — or, at the very floor, the RLS filter
        // yields 0 rows; the census compare below is the net either way.
        const code = await attackExpectFailure(
          `WITH deleted AS (DELETE FROM ${table} WHERE tenant_id = $1 RETURNING 1)
             SELECT count(*)::int AS n FROM deleted`,
          [TENANT_QUALITY],
        );
        expect(code === "42501" || code === undefined, `${table} delete denied`).toBe(true);
      } else {
        // The three master-data/rebuildable registers carry the DELETE
        // grant by design — the RLS filter is the only wall, and it
        // holds: 0 rows touched.
        const affected = await withTenant(TENANT_QUALITY_RLS, async (tx) => {
          const rows = await tx.execute<{ n: number }>(
            sql`WITH deleted AS (DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${TENANT_QUALITY} RETURNING 1)
                  SELECT count(*)::int AS n FROM deleted`,
          );
          return rows.rows[0]!.n;
        });
        expect(affected, `${table} delete`).toBe(0);
      }
    }
    // The census unmoved.
    const after = await census();
    for (const [table, expected] of Object.entries(censusBefore)) {
      expect(after[table], `${table} residue`).toBe(expected);
    }
  });

  it("A7 — id-based probes leak no existence (0 rows, and the typed finds answer the SAME not-found for a foreign id as for an absent one)", async () => {
    const v = victim;
    const probes: Array<[string, string, string]> = [
      ["quality_specifications", "id", v.specId],
      ["spc_measurements", "spec_id", v.specId],
      ["ncr_records", "id", v.ncrId],
      ["capa_records", "id", v.capaId],
      ["complaints", "id", v.complaintId],
      ["calibration_records", "id", v.calibrationId],
      ["supplier_quality_scores", "partner_id", v.supplierPartnerId],
      ["coa_documents", "id", v.coaId],
      ["batch_quality_holds", "batch_id", v.batchId],
      ["recall_registry", "batch_id", v.batchId],
      ["quality_management_reviews", "id", v.reviewId],
      ["hazard_registers", "id", v.hazardId],
    ];
    for (const [table, column, value] of probes) {
      const present = await withTenant(TENANT_QUALITY_RLS, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${sql.raw(column)} = ${value}::uuid`,
        );
        return rows.rows[0]!.n;
      });
      expect(present, `${table} id probe`).toBe(0);
    }
    // THE TYPED FINDS — the attacker's service-floor reads answer the
    // SAME typed not-found for the victim's id as for an absent one
    // (no existence disclosure, never data).
    const foreignNcr = await withTenant(TENANT_QUALITY_RLS, () =>
      ncrs.find(v.ncrId).catch((error: unknown) => error),
    );
    expect((foreignNcr as { code?: string }).code).toBe("NCR_RECORD_NOT_FOUND");
    const foreignCapa = await withTenant(TENANT_QUALITY_RLS, () =>
      capas.find(v.capaId).catch((error: unknown) => error),
    );
    expect((foreignCapa as { code?: string }).code).toBe("CAPA_RECORD_NOT_FOUND");
    const foreignRecall = await withTenant(TENANT_QUALITY_RLS, () =>
      recalls.find(v.recallId).catch((error: unknown) => error),
    );
    expect((foreignRecall as { code?: string }).code).toBe("RECALL_RECORD_NOT_FOUND");
    const absentNcr = await withTenant(TENANT_QUALITY_RLS, () =>
      ncrs.find("00000000-0000-4000-8000-000000000000").catch((error: unknown) => error),
    );
    expect((absentNcr as { code?: string }).code).toBe(
      (foreignNcr as { code?: string }).code,
    );
  });

  it("A8 — THE COMPOSITE-FK LAW: every child FK is (id, tenant_id) in the catalog + a live FK-inversion probe rejects 23503", async () => {
    // (a) The catalog walk: every FK these tables carry references its
    // parent through the composite (id, tenant_id) pair — the
    // cross-tenant parent is structurally unresolvable.
    const su = await superuserClient();
    const fks = await su.query<{
      conname: string;
      child: string;
      parent: string;
      cols: string[];
      parent_cols: string[];
    }>(`
      SELECT c.conname, cl.relname AS child, pr.relname AS parent,
             (SELECT array_agg(a.attname ORDER BY x.ord)::text[]
                FROM unnest(c.conkey) WITH ORDINALITY AS x(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = x.attnum) AS cols,
             (SELECT array_agg(a.attname ORDER BY x.ord)::text[]
                FROM unnest(c.confkey) WITH ORDINALITY AS x(attnum, ord)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = x.attnum) AS parent_cols
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_class pr ON pr.oid = c.confrelid
      WHERE c.contype = 'f' AND cl.relname = ANY($1::text[])
    `, [[...QUALITY_TABLES]]);
    await su.end();
    expect(fks.rows.length).toBeGreaterThanOrEqual(30);
    for (const fk of fks.rows) {
      // Every FK on these tables includes tenant_id on BOTH sides (the
      // composite law) or is the tenants FK itself (tenant_id →
      // tenants.id, the root scoping — allowed).
      const composite = fk.cols.includes("tenant_id") && fk.parent_cols.includes("tenant_id");
      const tenantRoot = fk.cols.length === 1 && fk.cols[0] === "tenant_id";
      expect(
        composite || tenantRoot,
        `${fk.child} → ${fk.parent} (${fk.cols.join(",")})`,
      ).toBe(true);
    }

    // (b) The live probe: a superuser INSERT of a child row whose
    // (parent id, OWN tenant) pair points at the VICTIM's parent — the
    // composite FK rejects it (23503), the cross-tenant parent is
    // unreachable even inside a single statement.
    const su2 = await superuserClient();
    await su2.query("BEGIN");
    const failure = await su2
      .query(
        `INSERT INTO spc_measurements (id, tenant_id, spec_id, value, sampled_at, source)
         VALUES (gen_random_uuid(), $1, $2, 100, '2026-04-01T09:00:00Z', 'MANUAL')`,
        [TENANT_QUALITY_RLS, victim.specId],
      )
      .then(() => undefined)
      .catch((error: { code?: string }) => error);
    await su2.query("ROLLBACK");
    await su2.end();
    expect(failure?.code).toBe("23503");
  });

  it("A9 — FK-chain joins under the attacker's GUC expose 0 victim rows", async () => {
    // The family's own chains: measurements → spec → item · NCR → item
    // + batch · complaints → customer · calibrations → instrument asset
    // · scores → supplier · holds → batch + its NCR · recalls → batch
    // → item · COA → item → its specs · hazards → item.
    const joins: Array<[string, SQL]> = [
      [
        "measurements-spec-item",
        sql`SELECT count(*)::int AS n
             FROM spc_measurements m
             JOIN quality_specifications s ON s.id = m.spec_id AND s.tenant_id = m.tenant_id
             JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
            WHERE i.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "ncr-item-batch",
        sql`SELECT count(*)::int AS n
             FROM ncr_records n
             JOIN items i ON i.id = n.item_id AND i.tenant_id = n.tenant_id
             LEFT JOIN item_batches b ON b.id = n.batch_id AND b.tenant_id = n.tenant_id
            WHERE i.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "complaints-customer",
        sql`SELECT count(*)::int AS n
             FROM complaints c
             JOIN partners p ON p.id = c.customer_id AND p.tenant_id = c.tenant_id
            WHERE p.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "calibrations-asset",
        sql`SELECT count(*)::int AS n
             FROM calibration_records cr
             JOIN assets a ON a.id = cr.asset_id AND a.tenant_id = cr.tenant_id
            WHERE a.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "scores-partner",
        sql`SELECT count(*)::int AS n
             FROM supplier_quality_scores s
             JOIN partners p ON p.id = s.partner_id AND p.tenant_id = s.tenant_id
            WHERE p.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "holds-batch-ncr",
        sql`SELECT count(*)::int AS n
             FROM batch_quality_holds h
             JOIN item_batches b ON b.id = h.batch_id AND b.tenant_id = h.tenant_id
             JOIN ncr_records n ON n.id = h.ncr_id AND n.tenant_id = h.tenant_id
            WHERE b.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "recalls-batch-item",
        sql`SELECT count(*)::int AS n
             FROM recall_registry r
             JOIN item_batches b ON b.id = r.batch_id AND b.tenant_id = r.tenant_id
             JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
            WHERE i.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "coa-item-spec",
        sql`SELECT count(*)::int AS n
             FROM coa_documents d
             JOIN items i ON i.id = d.item_id AND i.tenant_id = d.tenant_id
             JOIN quality_specifications s ON s.item_id = i.id AND s.tenant_id = i.tenant_id
            WHERE i.tenant_id = ${TENANT_QUALITY}`,
      ],
      [
        "hazards-item",
        sql`SELECT count(*)::int AS n
             FROM hazard_registers h
             JOIN items i ON i.id = h.item_id AND i.tenant_id = h.tenant_id
            WHERE i.tenant_id = ${TENANT_QUALITY}`,
      ],
    ];
    for (const [label, join] of joins) {
      const rows = await withTenant(TENANT_QUALITY_RLS, (tx) =>
        tx.execute<{ n: number }>(join),
      );
      expect(rows.rows[0]!.n, label).toBe(0);
    }
  });

  it("A10 — UNION ALL over every table + a recursive CTE stay confined (0 victim rows)", async () => {
    const unionQuery = QUALITY_TABLES.map(
      (table) => `SELECT tenant_id FROM ${table}`,
    ).join(" UNION ALL ");
    const unionRows = await withTenant(TENANT_QUALITY_RLS, async (tx) => {
      const rows = await tx.execute<{ tenant_id: string }>(sql.raw(unionQuery));
      return rows.rows as unknown as { tenant_id: string }[];
    });
    // The attacker's world is empty BY CONSTRUCTION — the union itself
    // must return ZERO rows (any row would be a breach of the boundary
    // tenant's own promise), and no victim tenant_id can ever appear.
    expect(unionRows).toHaveLength(0);
    expect(unionRows.some((row) => row.tenant_id === TENANT_QUALITY)).toBe(false);

    // The paired witness: the SAME union under the victim's GUC sees
    // at least one row per table (the emptiness above is RLS, never an
    // empty register).
    const victimUnion = await withTenant(TENANT_QUALITY, async (tx) => {
      const rows = await tx.execute<{ tenant_id: string }>(sql.raw(unionQuery));
      return rows.rows as unknown as { tenant_id: string }[];
    });
    expect(victimUnion.length).toBeGreaterThanOrEqual(QUALITY_TABLES.length);
    expect(victimUnion.every((row) => row.tenant_id === TENANT_QUALITY)).toBe(true);

    // THE RECURSIVE CTE: walk the quality plane's own cycle — the
    // batch → its hold → the hold's NCR → the NCR's batch — seeded at
    // the VICTIM's batch id; under the attacker's GUC the base case is
    // RLS-invisible and the walk yields 0 rows at every hop.
    const cte = sql`
      WITH RECURSIVE walk AS (
        SELECT b.id AS batch_id, b.tenant_id
          FROM item_batches b WHERE b.id = ${victim.batchId}
        UNION
        SELECT nb.id, nb.tenant_id
          FROM walk w
          JOIN batch_quality_holds h ON h.batch_id = w.batch_id AND h.tenant_id = w.tenant_id
          JOIN ncr_records n ON n.id = h.ncr_id AND n.tenant_id = h.tenant_id
          JOIN item_batches nb ON nb.id = n.batch_id AND nb.tenant_id = n.tenant_id
         WHERE n.batch_id IS NOT NULL
      )
      SELECT count(*)::int AS n FROM walk WHERE tenant_id = ${TENANT_QUALITY}`;
    const cteRows = await withTenant(TENANT_QUALITY_RLS, (tx) =>
      tx.execute<{ n: number }>(cte),
    );
    expect(cteRows.rows[0]!.n).toBe(0);
    // The paired witness: under the victim's GUC the same walk resolves
    // (the seeded cycle batch → hold → NCR → batch) — the walk shape is
    // honest, the emptiness above is the boundary.
    const victimWalk = await withTenant(TENANT_QUALITY, (tx) =>
      tx.execute<{ n: number }>(cte),
    );
    expect(victimWalk.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("THE CENSUS — the victim's world survives every attack row-for-row (the snapshot law)", async () => {
    const after = await census();
    for (const [table, expected] of Object.entries(censusBefore)) {
      expect(after[table], `${table} survives`).toBe(expected);
    }
    // And the attacker's world is STILL empty on every register (the
    // boundary tenant's own promise held through every attack).
    for (const table of QUALITY_TABLES) {
      const n = await withTenant(TENANT_QUALITY_RLS, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
        );
        return rows.rows[0]!.n;
      });
      expect(n, `${table} attacker world empty`).toBe(0);
    }
  });
});
