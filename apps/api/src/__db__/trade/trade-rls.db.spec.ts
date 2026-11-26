import { beforeAll, describe, expect, it } from "vitest";
import { sql, type SQL } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { appClient, superuserClient } from "../test-db";
import {
  setupTradeFixture,
  TENANT_TRADE,
  TR_ACTOR,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { RevaluationService } from "../../modules/inventory/application/revaluation-service";
import { PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { LandedCostService } from "../../modules/purchasing/application/landed-costs";
import { LcService } from "../../modules/trade/application/lc-service";
import { CollectionsService } from "../../modules/trade/application/collections-service";
import { IncotermsService } from "../../modules/trade/application/incoterms-service";
import { TransportService } from "../../modules/trade/application/transport-service";
import { TrackingService } from "../../modules/trade/application/tracking-service";
import { CertificateService } from "../../modules/trade/application/certificate-service";
import { CustomsService } from "../../modules/trade/application/customs-service";
import { BondedService } from "../../modules/trade/application/bonded-service";
import { DrawbackService } from "../../modules/trade/application/drawback-service";
import * as store from "../../modules/trade/infrastructure/trade.store";

/**
 * PHASE-051 (W-41 — T-16, dated 2026-11-26) · `trade-rls.db.spec` —
 * THE RLS ATTACK MATRIX A1–A10 over the FOURTEEN TRADE FAMILY TABLES
 * (the 0119–0122 family; the quality-rls precedent's exact attack
 * vocabulary, the family-deep edition): the victim is the TR world
 * (TENANT_TRADE — seeded through the REAL trade services end to end,
 * one row per table minimum) and the attacker is the DEDICATED BOUNDARY
 * TENANT (RLS-2 — empty BY CONSTRUCTION, never written: any row it ever
 * saw would itself be the breach; the honest disclosure's lesson — the
 * fixture boundary tenant TR-RLS carries the sibling specs' flag-off
 * worlds, so THIS spec's empty-by-construction law demands its own
 * tenant), every probe running through the APP-ROLE path (withTenant +
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
 * rows are denied (the evidence/registry tables carry no grant by
 * design — the LC/collection/transport/certificate/declaration/line/
 * bonded/drawback/tracking registers) or touch 0 rows (the two
 * tenant-extensible SEED registers: incoterms + hs_code_registry —
 * the 0120/0121 grants carry the DELETE, the RLS filter is the wall) ·
 * A7 id-probes leak no existence (0 rows, and the typed finds answer
 * the SAME not-found for a foreign id as for an absent one) · A8 THE
 * COMPOSITE-FK LAW (the pg_constraint catalog walk — every child FK is
 * (id, tenant_id) or the tenants root + a live FK-inversion probe
 * rejects 23503) · A9 the FK-chain joins stay confined · A10 UNION ALL
 * + a recursive CTE stay confined (the declaration → B/L → declaration
 * cycle through the tracking events' declaration link) — and the final
 * census: the victim's world survives every attack row-for-row (the
 * snapshot law — the before/after census pair, the shared-tenant
 * edition).
 */

/** THE DEDICATED BOUNDARY TENANT — this spec's own (empty BY
 * CONSTRUCTION, never written by any spec). */
const TENANT_TRADE_RLS2 = "7c7c7c7c-7c7c-7c7c-7c7c-7c7c7c7c7c7e";

/** The FOURTEEN trade family tables (0119–0122) — the attack surface. */
const TRADE_TABLES = [
  "letters_of_credit",
  "lc_amendments",
  "lc_documents",
  "documentary_collections",
  "incoterms",
  "bills_of_lading",
  "packing_lists",
  "certificates_of_origin",
  "customs_declarations",
  "customs_declaration_lines",
  "hs_code_registry",
  "bonded_warehouse_moves",
  "duty_drawback_claims",
  "shipment_tracking_events",
] as const;

/** The evidence-discipline tables — DELETE carries NO grant by design
 * (the 0119–0122 grants: the LC/collection registers, the transport
 * documents, the certificates, the declarations and their lines, the
 * bonded moves, the drawback claims and the tracking log are
 * append-only evidence — A5 asserts the denial). */
const NO_DELETE_GRANT = new Set([
  "letters_of_credit",
  "lc_amendments",
  "lc_documents",
  "documentary_collections",
  "bills_of_lading",
  "packing_lists",
  "certificates_of_origin",
  "customs_declarations",
  "customs_declaration_lines",
  "bonded_warehouse_moves",
  "duty_drawback_claims",
  "shipment_tracking_events",
]);

/** The victim's own ids the arms probe (seeded in beforeAll through the
 * REAL trade services — the per-table parent chains the forged inserts
 * and the id-probes target). */
interface VictimWorld {
  lcId: string;
  amendmentId: string;
  documentId: string;
  collectionId: string;
  incotermId: string;
  blId: string;
  plId: string;
  certificateId: string;
  importDeclarationId: string;
  exportDeclarationId: string;
  declarationLineId: string;
  hsCodeId: string;
  bondedMoveId: string;
  drawbackClaimId: string;
  trackingEventId: string;
}

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const revaluation = new RevaluationService(audit);
const landedCosts = new LandedCostService(audit, posting, numbering, new RevaluationService(audit));
const lcs = new LcService(audit, posting, numbering);
const collections = new CollectionsService(audit, numbering);
const registry = new IncotermsService(audit);
const transport = new TransportService(audit, numbering);
const tracking = new TrackingService(audit);
const certificates = new CertificateService(audit, numbering);
const customs = new CustomsService(audit, numbering, landedCosts);
const bonded = new BondedService(audit, numbering, posting, revaluation);
const drawbacks = new DrawbackService(audit, numbering);
const purchaseOrders = new PurchaseOrderService(audit, numbering);

let victim: VictimWorld;
/** The fixture's FREE warehouse id (the forged bonded move's target —
 * the fixture's own row, resolved in beforeAll). */
let victimWarehouseBId = "";
/** The census snapshot taken after the seeding (the shared-tenant
 * edition: the victim tenant accumulates the family's other worlds, so
 * the honest census is the BEFORE/AFTER pair, never absolute counts). */
let censusBefore: Record<string, number>;

/** The per-table census (superuser — the audit read). */
async function census(): Promise<Record<string, number>> {
  const su = await superuserClient();
  const counts: Record<string, number> = {};
  for (const table of TRADE_TABLES) {
    const rows = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_TRADE],
    );
    counts[table] = rows.rows[0]!.n;
  }
  await su.end();
  return counts;
}

/** The attacker's failure-capture connection (the quality-rls
 * precedent's own): the erp_app role with the ATTACKER's GUC, BEGIN/
 * COMMIT around the statement so a refusal is captured, never ambient. */
async function attackExpectFailure(
  query: string,
  params: unknown[] = [],
): Promise<string | undefined> {
  const app = await appClient();
  await app.query("BEGIN");
  await app.query("SELECT set_config('erp.tenant_id', $1, true)", [TENANT_TRADE_RLS2]);
  const failure = await app
    .query(query, params as never[])
    .then(() => undefined)
    .catch((error: { code?: string }) => error.code);
  await app.query("COMMIT");
  await app.end();
  return failure;
}

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  victimWarehouseBId = fixture.warehouseBId;
  // THE DEDICATED BOUNDARY TENANT (created BEFORE any probe — the
  // forged inserts' FK-inversion arm needs a live tenants row).
  const suTenant = await superuserClient();
  await suTenant.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant TR-RLS2 (trade boundary)', 'المستأجر تج للفصل ٢', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TRADE_RLS2],
  );
  await suTenant.end();

  // THE VICTIM WORLD — every row through the REAL trade services (the
  // LC plane: create → issue (margin-free: no ledger footprint) → the
  // checklist → the amendment).
  const lc = await withTenant(TENANT_TRADE, () =>
    lcs.create({
      currency: "SAR",
      amount: "3000.0000",
      marginAmount: "0.0000",
      issuingBank: "RLS Victim Bank",
      beneficiaryName: "Overseas Seller SARL",
      applicantName: "TR Trading Co",
      expiryDate: "2027-06-30",
      actorId: TR_ACTOR,
    }),
  );
  await withTenant(TENANT_TRADE, () => lcs.issue(lc.id, { actorId: TR_ACTOR }));
  const document = await withTenant(TENANT_TRADE, () =>
    lcs.recordDocument(lc.id, {
      docType: "COMMERCIAL INVOICE",
      presented: true,
      actorId: TR_ACTOR,
    }),
  );
  const amended = await withTenant(TENANT_TRADE, () =>
    lcs.amend(lc.id, {
      changeType: "VALUE",
      valueFrom: "3000.0000",
      valueTo: "3600.0000",
      actorId: TR_ACTOR,
    }),
  );

  // The collections plane (a REAL PO link — the chain arm's own
  // substrate).
  const order = await withTenant(TENANT_TRADE, () =>
    purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: "2026-11-26",
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      lines: [
        { itemId: fixture.itemId, qty: "10", unitPrice: "45.000000", taxCodeId: null, requestLineId: null, note: null },
      ],
    }),
  );
  const collection = await withTenant(TENANT_TRADE, () =>
    collections.create({
      purchaseOrderId: order.id,
      termsType: "D/P",
      amount: "42000.0000",
      currency: "USD",
      dueDate: null,
      documents: ["COMMERCIAL INVOICE", "BILL OF LADING"],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );

  // The Incoterms registry (the tenant-extensible seed register — this
  // spec's OWN row, never the canonical codes whose presence is
  // order-dependent).
  const incoterm = await withTenant(TENANT_TRADE, () =>
    registry.create({
      code: "RVX",
      name: "RLS Victim Term",
      nameAr: "شرط الفصل",
      carriageBySeller: true,
      insuranceBySeller: false,
      exportClearanceBySeller: true,
      importClearanceBySeller: false,
      importDutyBySeller: false,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );

  // The transport plane (the B/L — the shipment's identity — + a
  // packing list + a certificate under it).
  const bl = await withTenant(TENANT_TRADE, () =>
    transport.createBl({
      docType: "SEA",
      carrierName: "RLS Victim Carrier",
      portOfLoading: "Port Jeddah",
      portOfDischarge: "Port Rotterdam",
      containerRefs: ["RLSU0000001"],
      purchaseOrderId: order.id,
      deliveryNoteId: null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  const packing = await withTenant(TENANT_TRADE, () =>
    transport.createPackingList({
      billOfLadingId: bl.id,
      lines: [{ description: "RLS victim pallets", packages: 10, grossKg: "1050.000", netKg: "1000.000" }],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  const certificate = await withTenant(TENANT_TRADE, () =>
    certificates.issue({
      certType: "ORIGIN",
      exporterName: "RLS Victim Exporter",
      consigneeName: "RLS Victim Consignee",
      billOfLadingId: bl.id,
      goods: [{ description: "RLS victim goods", originCountry: "SA", hsCode: "8471", quantity: "10", uom: "PCS" }],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );

  // The customs plane (an IMPORT declaration linked to the B/L + an
  // EXPORT declaration for the drawback's evidence).
  const importDeclaration = await withTenant(TENANT_TRADE, () =>
    customs.createDeclaration({
      declarationType: "IMPORT",
      customsOffice: "Jeddah Customs",
      currency: "SAR",
      receiptId: null,
      purchaseOrderId: null,
      billOfLadingId: bl.id,
      lines: [
        {
          hsCode: "8471",
          originCountry: "CN",
          itemId: fixture.itemId,
          description: null,
          quantity: "10",
          uom: "PCS",
          customsValue: "100",
          dutyRate: "0.05",
          importVat: "5",
          note: null,
          noteAr: null,
        },
      ],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  const exportDeclaration = await withTenant(TENANT_TRADE, () =>
    customs.createDeclaration({
      declarationType: "EXPORT",
      customsOffice: "Jeddah Customs",
      currency: "SAR",
      receiptId: null,
      purchaseOrderId: null,
      billOfLadingId: null,
      lines: [
        {
          hsCode: "8471",
          originCountry: "SA",
          itemId: fixture.itemId,
          description: null,
          quantity: "10",
          uom: "PCS",
          customsValue: "100",
          dutyRate: "0",
          importVat: "0",
          note: null,
          noteAr: null,
        },
      ],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );
  const declarationLines = await withTenant(TENANT_TRADE, () =>
    store.listDeclarationLines(importDeclaration.id),
  );
  const hsCode = await withTenant(TENANT_TRADE, () =>
    customs.createHsCode({
      hsCode: "76",
      name: "Aluminium and articles thereof",
      nameAr: "الألومنيوم ومنتجاته",
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );

  // The bonded plane (a DRAFT RELEASE carrying its declaration link —
  // the bond register's own row, zero ledger footprint).
  const bondedMove = await withTenant(TENANT_TRADE, () =>
    bonded.create({
      moveKind: "RELEASE",
      fromWarehouseId: fixture.warehouseAId,
      toWarehouseId: null,
      declarationId: importDeclaration.id,
      lines: [{ itemId: fixture.itemId, qty: "10", unitCost: null }],
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );

  // The drawback plane (the EXPORT evidence link).
  const claim = await withTenant(TENANT_TRADE, () =>
    drawbacks.create({
      exportDeclarationId: exportDeclaration.id,
      exportBillOfLadingId: null,
      claimedAmount: "1000.0000",
      currency: "SAR",
      note: "the RLS victim world's drawback claim",
      noteAr: null,
      actorId: TR_ACTOR,
    }),
  );

  // The tracking plane (an event on the B/L carrying the declaration
  // link — the recursive CTE's own cycle edge).
  const event = await withTenant(TENANT_TRADE, () =>
    tracking.appendEvent({
      billOfLadingId: bl.id,
      milestone: "DEPARTED",
      eventAt: "2026-11-26T09:00:00Z",
      declarationId: importDeclaration.id,
      actorId: TR_ACTOR,
    }),
  );

  victim = {
    lcId: lc.id,
    amendmentId: amended.amendment.id,
    documentId: document.id,
    collectionId: collection.id,
    incotermId: incoterm.row.id,
    blId: bl.id,
    plId: packing.id,
    certificateId: certificate.id,
    importDeclarationId: importDeclaration.id,
    exportDeclarationId: exportDeclaration.id,
    declarationLineId: declarationLines[0]!.id,
    hsCodeId: hsCode.id,
    bondedMoveId: bondedMove.id,
    drawbackClaimId: claim.id,
    trackingEventId: event.event.id,
  };

  // The seeding is REAL: the victim's own read sees every table's row
  // (the paired witness A2 rides).
  for (const table of TRADE_TABLES) {
    const own = await withTenant(TENANT_TRADE, async (tx) => {
      const rows = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
      );
      return rows.rows[0]!.n;
    });
    expect(own, `${table} seeded`).toBeGreaterThanOrEqual(1);
  }

  // THE CENSUS SNAPSHOT (after the seeding, before the attacks).
  censusBefore = await census();
});

describe("PHASE-051 W-41 — T-16: the TRADE RLS attack matrix (A1–A10 × the fourteen family tables)", () => {
  it("A1 — SELECT without any GUC fails closed on every table (0 rows)", async () => {
    for (const table of TRADE_TABLES) {
      const app = await appClient();
      const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      await app.end();
      expect(rows.rows[0]!.n, table).toBe(0);
    }
  });

  it("A2 — the attacker's GUC never exposes the victim's rows (the paired witness at BOTH floors: the raw SQL counts and the store's own list surfaces)", async () => {
    // (a) THE RAW SQL FLOOR — the paired witness per table: the
    // victim's own read (the rows EXIST) against the attacker's 0.
    for (const table of TRADE_TABLES) {
      const own = await withTenant(TENANT_TRADE, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
        );
        return rows.rows[0]!.n;
      });
      expect(own, `${table} victim rows exist`).toBeGreaterThanOrEqual(1);
      const foreign = await withTenant(TENANT_TRADE_RLS2, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
        );
        return rows.rows[0]!.n;
      });
      expect(foreign, `${table} attacker sees none`).toBe(0);
    }

    // (b) THE STORE'S OWN LIST SURFACES — the trade store's reads under
    // the attacker's GUC return ZERO rows on every register (the
    // service floor rides the same boundary).
    const attackerLists = await withTenant(TENANT_TRADE_RLS2, async () => [
      await store.listLcs({ limit: 50 }),
      await store.listLcAmendments(victim.lcId),
      await store.listLcDocuments(victim.lcId),
      await store.listCollections({ limit: 50 }),
      await store.listIncoterms({ limit: 50 }),
      await store.listBls({ limit: 50 }),
      await store.listPackingLists({ limit: 50 }),
      await store.listCertificates({ limit: 50 }),
      await store.listDeclarations({ limit: 50 }),
      await store.listDeclarationLines(victim.importDeclarationId),
      await store.listHsCodes({ limit: 50 }),
      await store.listBondedMoves({ limit: 50 }),
      await store.listDrawbackClaims({ limit: 50 }),
      await store.listTrackingEvents({ limit: 50 }),
    ]);
    for (const [index, rows] of attackerLists.entries()) {
      expect(rows, `${TRADE_TABLES[index]} store list`).toHaveLength(0);
    }
  });

  it("A3 — forged-tenant INSERTs (the victim's tenant_id under the attacker's GUC) reject 42501 with zero residue", async () => {
    const v = victim;
    const shapes: Array<[string, string, unknown[]]> = [
      [
        "letters_of_credit",
        `INSERT INTO letters_of_credit (id, tenant_id, lc_no, currency, amount, margin_amount,
                                        issuing_bank, beneficiary_name, applicant_name, expiry_date, status)
         VALUES (gen_random_uuid(), $1, 'LC-FORGE-RLS2', 'USD', 1000, 0, 'Forged Bank',
                 'Forged Beneficiary', 'Forged Applicant', '2027-12-31', 'DRAFT')`,
        [TENANT_TRADE],
      ],
      [
        "lc_amendments",
        `INSERT INTO lc_amendments (id, tenant_id, lc_id, amendment_no, change_type, value_from, value_to)
         VALUES (gen_random_uuid(), $1, $2, 1, 'VALUE', 3000, 3600)`,
        [TENANT_TRADE, v.lcId],
      ],
      [
        "lc_documents",
        `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented)
         VALUES (gen_random_uuid(), $1, $2, 'COMMERCIAL INVOICE', false)`,
        [TENANT_TRADE, v.lcId],
      ],
      [
        "documentary_collections",
        `INSERT INTO documentary_collections (id, tenant_id, collection_no, terms_type, amount,
                                              currency, documents, status)
         VALUES (gen_random_uuid(), $1, 'COLL-FORGE-RLS2', 'D/P', 500, 'USD', '[]'::jsonb, 'OPEN')`,
        [TENANT_TRADE],
      ],
      [
        "incoterms",
        `INSERT INTO incoterms (id, tenant_id, code, name, name_ar, carriage_by_seller,
                                insurance_by_seller, export_clearance_by_seller,
                                import_clearance_by_seller, import_duty_by_seller)
         VALUES (gen_random_uuid(), $1, 'FGX', 'Forged term', 'شرط مزيف', false, false, true, false, false)`,
        [TENANT_TRADE],
      ],
      [
        "bills_of_lading",
        `INSERT INTO bills_of_lading (id, tenant_id, bl_no, doc_type, carrier_name, shipment_status)
         VALUES (gen_random_uuid(), $1, 'BL-FORGE-RLS2', 'SEA', 'Forged Carrier', 'BOOKED')`,
        [TENANT_TRADE],
      ],
      [
        "packing_lists",
        `INSERT INTO packing_lists (id, tenant_id, pl_no, bill_of_lading_id, lines, shipment_status)
         VALUES (gen_random_uuid(), $1, 'PL-FORGE-RLS2', $2, '[]'::jsonb, 'BOOKED')`,
        [TENANT_TRADE, v.blId],
      ],
      [
        "certificates_of_origin",
        `INSERT INTO certificates_of_origin (id, tenant_id, certificate_no, cert_type,
                                             bill_of_lading_id, snapshot, issued_at)
         VALUES (gen_random_uuid(), $1, 'CERT-FORGE-RLS2', 'ORIGIN', $2, '{}'::jsonb, now())`,
        [TENANT_TRADE, v.blId],
      ],
      [
        "customs_declarations",
        `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type,
                                           customs_office, status, currency)
         VALUES (gen_random_uuid(), $1, 'DEC-FORGE-RLS2', 'IMPORT', 'Jeddah Customs', 'DRAFT', 'SAR')`,
        [TENANT_TRADE],
      ],
      [
        "customs_declaration_lines",
        `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code,
                                                customs_value, duty_rate, duty_amount, import_vat)
         VALUES (gen_random_uuid(), $1, $2, 1, '8471', 100, 0.05, 5, 0)`,
        [TENANT_TRADE, v.importDeclarationId],
      ],
      [
        "hs_code_registry",
        `INSERT INTO hs_code_registry (id, tenant_id, hs_code, name, name_ar)
         VALUES (gen_random_uuid(), $1, '99', 'Forged HS', 'صنف مزيف')`,
        [TENANT_TRADE],
      ],
      [
        "bonded_warehouse_moves",
        `INSERT INTO bonded_warehouse_moves (id, tenant_id, move_no, move_kind, to_warehouse_id,
                                             lines, status)
         VALUES (gen_random_uuid(), $1, 'BND-FORGE-RLS2', 'IN_BOND', $2,
                 '[{"itemId":"00000000-0000-4000-8000-000000000000","qty":"1"}]'::jsonb, 'DRAFT')`,
        [TENANT_TRADE, victimWarehouseBId],
      ],
      [
        "duty_drawback_claims",
        `INSERT INTO duty_drawback_claims (id, tenant_id, claim_no, export_declaration_id,
                                           claimed_amount, currency, status)
         VALUES (gen_random_uuid(), $1, 'DBK-FORGE-RLS2', $2, 100, 'SAR', 'DRAFT')`,
        [TENANT_TRADE, v.exportDeclarationId],
      ],
      [
        "shipment_tracking_events",
        `INSERT INTO shipment_tracking_events (id, tenant_id, bill_of_lading_id, milestone, event_at)
         VALUES (gen_random_uuid(), $1, $2, 'DEPARTED', now())`,
        [TENANT_TRADE, v.blId],
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
      ["letters_of_credit", sql`UPDATE letters_of_credit SET issuing_bank = 'hijacked' WHERE id = ${v.lcId}`],
      ["lc_amendments", sql`UPDATE lc_amendments SET summary = 'hijacked' WHERE id = ${v.amendmentId}`],
      [
        "lc_documents",
        sql`UPDATE lc_documents SET discrepancy_notes = 'hijacked' WHERE id = ${v.documentId}`,
      ],
      [
        "documentary_collections",
        sql`UPDATE documentary_collections SET note = 'hijacked' WHERE id = ${v.collectionId}`,
      ],
      ["incoterms", sql`UPDATE incoterms SET name = 'hijacked' WHERE id = ${v.incotermId}`],
      ["bills_of_lading", sql`UPDATE bills_of_lading SET carrier_name = 'hijacked' WHERE id = ${v.blId}`],
      ["packing_lists", sql`UPDATE packing_lists SET note = 'hijacked' WHERE id = ${v.plId}`],
      [
        "certificates_of_origin",
        sql`UPDATE certificates_of_origin SET note = 'hijacked' WHERE id = ${v.certificateId}`,
      ],
      [
        "customs_declarations",
        sql`UPDATE customs_declarations SET customs_office = 'hijacked' WHERE id = ${v.importDeclarationId}`,
      ],
      [
        "customs_declaration_lines",
        sql`UPDATE customs_declaration_lines SET note = 'hijacked' WHERE id = ${v.declarationLineId}`,
      ],
      ["hs_code_registry", sql`UPDATE hs_code_registry SET note = 'hijacked' WHERE id = ${v.hsCodeId}`],
      ["bonded_warehouse_moves", sql`UPDATE bonded_warehouse_moves SET note = 'hijacked' WHERE id = ${v.bondedMoveId}`],
      [
        "duty_drawback_claims",
        sql`UPDATE duty_drawback_claims SET note = 'hijacked' WHERE id = ${v.drawbackClaimId}`,
      ],
      [
        "shipment_tracking_events",
        sql`UPDATE shipment_tracking_events SET note = 'hijacked' WHERE id = ${v.trackingEventId}`,
      ],
    ];
    for (const [table, update] of updates) {
      const affected = await withTenant(TENANT_TRADE_RLS2, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`WITH updated AS (${update} RETURNING 1) SELECT count(*)::int AS n FROM updated`,
        );
        return rows.rows[0]!.n;
      });
      expect(affected, `${table} hijack`).toBe(0);
    }
    // Byte-identical: the victim's probe rows unchanged (the probe
    // pair — one row per family register).
    const su = await superuserClient();
    const lcRow = await su.query<{ issuing_bank: string }>(
      `SELECT issuing_bank FROM letters_of_credit WHERE id = $1`,
      [victim.lcId],
    );
    const declarationRow = await su.query<{ customs_office: string }>(
      `SELECT customs_office FROM customs_declarations WHERE id = $1`,
      [victim.importDeclarationId],
    );
    const eventRow = await su.query<{ note: string | null }>(
      `SELECT note FROM shipment_tracking_events WHERE id = $1`,
      [victim.trackingEventId],
    );
    await su.end();
    expect(lcRow.rows[0]!.issuing_bank).toBe("RLS Victim Bank");
    expect(declarationRow.rows[0]!.customs_office).toBe("Jeddah Customs");
    expect(eventRow.rows[0]!.note).toBeNull();
  });

  it("A5 — DELETEs of the other tenant's rows: the evidence/registry tables DENIED (no grant by design), the two tenant-extensible seed registers touch 0 rows", async () => {
    for (const table of TRADE_TABLES) {
      if (NO_DELETE_GRANT.has(table)) {
        // The no-grant tables: the DELETE statement itself is denied
        // (42501 — permission denied; the registers are append-only
        // evidence by grants) — or, at the very floor, the RLS filter
        // yields 0 rows; the census compare below is the net either way.
        const code = await attackExpectFailure(
          `WITH deleted AS (DELETE FROM ${table} WHERE tenant_id = $1 RETURNING 1)
             SELECT count(*)::int AS n FROM deleted`,
          [TENANT_TRADE],
        );
        expect(code === "42501" || code === undefined, `${table} delete denied`).toBe(true);
      } else {
        // The two tenant-extensible seed registers (incoterms +
        // hs_code_registry) carry the DELETE grant by design — the RLS
        // filter is the only wall, and it holds: 0 rows touched.
        const affected = await withTenant(TENANT_TRADE_RLS2, async (tx) => {
          const rows = await tx.execute<{ n: number }>(
            sql`WITH deleted AS (DELETE FROM ${sql.raw(table)} WHERE tenant_id = ${TENANT_TRADE} RETURNING 1)
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
      ["letters_of_credit", "id", v.lcId],
      ["lc_amendments", "lc_id", v.lcId],
      ["lc_documents", "lc_id", v.lcId],
      ["documentary_collections", "id", v.collectionId],
      ["incoterms", "id", v.incotermId],
      ["bills_of_lading", "id", v.blId],
      ["packing_lists", "bill_of_lading_id", v.blId],
      ["certificates_of_origin", "id", v.certificateId],
      ["customs_declarations", "id", v.importDeclarationId],
      ["customs_declaration_lines", "declaration_id", v.importDeclarationId],
      ["hs_code_registry", "id", v.hsCodeId],
      ["bonded_warehouse_moves", "id", v.bondedMoveId],
      ["duty_drawback_claims", "id", v.drawbackClaimId],
      ["shipment_tracking_events", "bill_of_lading_id", v.blId],
    ];
    for (const [table, column, value] of probes) {
      const present = await withTenant(TENANT_TRADE_RLS2, async (tx) => {
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
    const foreignLc = await withTenant(TENANT_TRADE_RLS2, () =>
      lcs.find(v.lcId).catch((error: unknown) => error),
    );
    expect((foreignLc as { code?: string }).code).toBe("LC_RECORD_NOT_FOUND");
    const foreignDeclaration = await withTenant(TENANT_TRADE_RLS2, () =>
      customs.find(v.importDeclarationId).catch((error: unknown) => error),
    );
    expect((foreignDeclaration as { code?: string }).code).toBe("DECLARATION_RECORD_NOT_FOUND");
    const foreignBonded = await withTenant(TENANT_TRADE_RLS2, () =>
      bonded.find(v.bondedMoveId).catch((error: unknown) => error),
    );
    expect((foreignBonded as { code?: string }).code).toBe("BONDED_MOVE_RECORD_NOT_FOUND");
    const foreignClaim = await withTenant(TENANT_TRADE_RLS2, () =>
      drawbacks.find(v.drawbackClaimId).catch((error: unknown) => error),
    );
    expect((foreignClaim as { code?: string }).code).toBe("DRAWBACK_CLAIM_RECORD_NOT_FOUND");
    // The absent ids answer the SAME codes (the equality law).
    const absentLc = await withTenant(TENANT_TRADE_RLS2, () =>
      lcs.find("00000000-0000-4000-8000-000000000000").catch((error: unknown) => error),
    );
    expect((absentLc as { code?: string }).code).toBe((foreignLc as { code?: string }).code);
    const absentDeclaration = await withTenant(TENANT_TRADE_RLS2, () =>
      customs.find("00000000-0000-4000-8000-000000000000").catch((error: unknown) => error),
    );
    expect((absentDeclaration as { code?: string }).code).toBe(
      (foreignDeclaration as { code?: string }).code,
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
    `, [[...TRADE_TABLES]]);
    await su.end();
    expect(fks.rows.length).toBeGreaterThanOrEqual(25);
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
        `INSERT INTO customs_declaration_lines (id, tenant_id, declaration_id, line_no, hs_code,
                                                customs_value, duty_rate, duty_amount, import_vat)
         VALUES (gen_random_uuid(), $1, $2, 1, '8471', 100, 0.05, 5, 0)`,
        [TENANT_TRADE_RLS2, victim.importDeclarationId],
      )
      .then(() => undefined)
      .catch((error: { code?: string }) => error);
    await su2.query("ROLLBACK");
    await su2.end();
    expect(failure?.code).toBe("23503");
  });

  it("A9 — FK-chain joins under the attacker's GUC expose 0 victim rows (the paired witness: the same joins resolve under the victim)", async () => {
    // The family's own chains: amendments → LC · documents → LC ·
    // collections → PO · packing lists → B/L · certificates → B/L ·
    // declaration lines → declaration → B/L · tracking events → B/L +
    // the event's declaration · bonded moves → their declaration ·
    // drawback claims → the EXPORT declaration. (incoterms +
    // hs_code_registry carry no child FKs beyond the tenants root —
    // their confinement is A2/A10's own subject.)
    const joins: Array<[string, SQL]> = [
      [
        "amendments-lc",
        sql`SELECT count(*)::int AS n
             FROM lc_amendments a
             JOIN letters_of_credit l ON l.id = a.lc_id AND l.tenant_id = a.tenant_id
            WHERE l.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "documents-lc",
        sql`SELECT count(*)::int AS n
             FROM lc_documents d
             JOIN letters_of_credit l ON l.id = d.lc_id AND l.tenant_id = d.tenant_id
            WHERE l.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "collections-po",
        sql`SELECT count(*)::int AS n
             FROM documentary_collections c
             JOIN purchase_orders po ON po.id = c.purchase_order_id AND po.tenant_id = c.tenant_id
            WHERE po.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "packing-bl",
        sql`SELECT count(*)::int AS n
             FROM packing_lists p
             JOIN bills_of_lading b ON b.id = p.bill_of_lading_id AND b.tenant_id = p.tenant_id
            WHERE b.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "certificate-bl",
        sql`SELECT count(*)::int AS n
             FROM certificates_of_origin cert
             JOIN bills_of_lading b ON b.id = cert.bill_of_lading_id AND b.tenant_id = cert.tenant_id
            WHERE b.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "lines-declaration-bl",
        sql`SELECT count(*)::int AS n
             FROM customs_declaration_lines dl
             JOIN customs_declarations d ON d.id = dl.declaration_id AND d.tenant_id = dl.tenant_id
             JOIN bills_of_lading b ON b.id = d.bill_of_lading_id AND b.tenant_id = d.tenant_id
            WHERE d.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "events-bl-declaration",
        sql`SELECT count(*)::int AS n
             FROM shipment_tracking_events e
             JOIN bills_of_lading b ON b.id = e.bill_of_lading_id AND b.tenant_id = e.tenant_id
             JOIN customs_declarations d ON d.id = e.declaration_id AND d.tenant_id = e.tenant_id
            WHERE b.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "bonded-declaration",
        sql`SELECT count(*)::int AS n
             FROM bonded_warehouse_moves m
             JOIN customs_declarations d ON d.id = m.declaration_id AND d.tenant_id = m.tenant_id
            WHERE d.tenant_id = ${TENANT_TRADE}`,
      ],
      [
        "drawback-declaration",
        sql`SELECT count(*)::int AS n
             FROM duty_drawback_claims k
             JOIN customs_declarations d ON d.id = k.export_declaration_id AND d.tenant_id = k.tenant_id
            WHERE d.tenant_id = ${TENANT_TRADE}`,
      ],
    ];
    for (const [label, join] of joins) {
      const attackerRows = await withTenant(TENANT_TRADE_RLS2, (tx) =>
        tx.execute<{ n: number }>(join),
      );
      expect(attackerRows.rows[0]!.n, `${label} attacker`).toBe(0);
      // The paired witness — the SAME join resolves under the victim
      // (the emptiness above is the boundary, never a broken walk).
      const victimRows = await withTenant(TENANT_TRADE, (tx) =>
        tx.execute<{ n: number }>(join),
      );
      expect(victimRows.rows[0]!.n, `${label} victim witness`).toBeGreaterThanOrEqual(1);
    }
  });

  it("A10 — UNION ALL over every table + a recursive CTE stay confined (0 victim rows)", async () => {
    const unionQuery = TRADE_TABLES.map(
      (table) => `SELECT tenant_id FROM ${table}`,
    ).join(" UNION ALL ");
    const unionRows = await withTenant(TENANT_TRADE_RLS2, async (tx) => {
      const rows = await tx.execute<{ tenant_id: string }>(sql.raw(unionQuery));
      return rows.rows as unknown as { tenant_id: string }[];
    });
    // The attacker's world is empty BY CONSTRUCTION — the union itself
    // must return ZERO rows (any row would be a breach of the boundary
    // tenant's own promise), and no victim tenant_id can ever appear.
    expect(unionRows).toHaveLength(0);
    expect(unionRows.some((row) => row.tenant_id === TENANT_TRADE)).toBe(false);

    // The paired witness: the SAME union under the victim's GUC sees
    // at least one row per table (the emptiness above is RLS, never an
    // empty register).
    const victimUnion = await withTenant(TENANT_TRADE, async (tx) => {
      const rows = await tx.execute<{ tenant_id: string }>(sql.raw(unionQuery));
      return rows.rows as unknown as { tenant_id: string }[];
    });
    expect(victimUnion.length).toBeGreaterThanOrEqual(TRADE_TABLES.length);
    expect(victimUnion.every((row) => row.tenant_id === TENANT_TRADE)).toBe(true);

    // THE RECURSIVE CTE: walk the trade plane's own cycle — the
    // declaration → its bill of lading → the tracking events on that
    // B/L carrying a declaration link → their declaration — seeded at
    // the VICTIM's IMPORT declaration; under the attacker's GUC the
    // base case is RLS-invisible and the walk yields 0 rows at every
    // hop.
    const cte = sql`
      WITH RECURSIVE walk AS (
        SELECT d.id AS declaration_id, d.tenant_id
          FROM customs_declarations d WHERE d.id = ${victim.importDeclarationId}
        UNION
        SELECT nd.id, nd.tenant_id
          FROM walk w
          JOIN customs_declarations d ON d.id = w.declaration_id AND d.tenant_id = w.tenant_id
          JOIN bills_of_lading b ON b.id = d.bill_of_lading_id AND b.tenant_id = d.tenant_id
          JOIN shipment_tracking_events e ON e.bill_of_lading_id = b.id AND e.tenant_id = b.tenant_id
          JOIN customs_declarations nd ON nd.id = e.declaration_id AND nd.tenant_id = e.tenant_id
         WHERE e.declaration_id IS NOT NULL
      )
      SELECT count(*)::int AS n FROM walk WHERE tenant_id = ${TENANT_TRADE}`;
    const cteRows = await withTenant(TENANT_TRADE_RLS2, (tx) =>
      tx.execute<{ n: number }>(cte),
    );
    expect(cteRows.rows[0]!.n).toBe(0);
    // The paired witness: under the victim's GUC the same walk resolves
    // (the seeded cycle declaration → B/L → event → declaration) — the
    // walk shape is honest, the emptiness above is the boundary.
    const victimWalk = await withTenant(TENANT_TRADE, (tx) =>
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
    for (const table of TRADE_TABLES) {
      const n = await withTenant(TENANT_TRADE_RLS2, async (tx) => {
        const rows = await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)}`,
        );
        return rows.rows[0]!.n;
      });
      expect(n, `${table} attacker world empty`).toBe(0);
    }
  });
});
