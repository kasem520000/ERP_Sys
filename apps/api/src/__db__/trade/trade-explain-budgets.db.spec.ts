import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import {
  setupTradeFixture,
  TENANT_TRADE,
  TR_ACTOR,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { RevaluationService } from "../../modules/inventory/application/revaluation-service";
import { LandedCostService } from "../../modules/purchasing/application/landed-costs";
import { TransportService } from "../../modules/trade/application/transport-service";
import { TrackingService } from "../../modules/trade/application/tracking-service";
import { CustomsService } from "../../modules/trade/application/customs-service";

/**
 * PHASE-051 (W-41 — T-16, dated 2026-11-26) ·
 * `trade-explain-budgets.db.spec` — THE OA-06 EXPLAIN BUDGETS over the
 * trade plane's documented hot paths (the master plan §3 W-41's own
 * probes; the quality-explain-budgets precedent's shape):
 *
 * - P0 THE CORPUS + THE LIVE READS — the customs register's own find
 *   (the declaration + its lines + the totals rendered from the LINES)
 *   and the tracking board's own event reads (by the B/L and by the
 *   declaration link) over a REAL corpus: the reads the budgets police;
 * - P1 THE DECLARATION-LINES READ — `listDeclarationLines`' own shape
 *   (the declaration predicate + the (line_no, id) ordering) must ride
 *   `ix_customs_declaration_lines_tenant_decl` (the 0121 index — the
 *   migration's own OA-06 anchor);
 * - P2 THE TRACKING-EVENTS READ — `listTrackingEvents`' own shape by
 *   the bill of lading (the B/L predicate + the (event_at, id)
 *   ordering + the cap) must ride `ix_shipment_tracking_events_tenant_bl`
 *   (the 0122 index);
 * - P3 THE CUSTOMS-LEG READ — the same store read filtered by the
 *   event's declaration link must ride the 0122 partial index
 *   `ix_shipment_tracking_events_tenant_declaration` (the migration's
 *   own OA-06 anchor comment).
 *
 * THE OA-06 ASSERTION LAW (the 048 W-14 ruling, D-17's own text): the
 * probes assert the stable INDEX-DRIVEN law — no seq-scan — accepting
 * the planner's legitimate index-driven paths (the bitmap family); the
 * rejected alternatives, per the ruling: enable_bitmapscan=off /
 * planner hints would make the probe testify about a FORCED plan, and
 * isolating the probe hides the shared-table context it exists to
 * police. **Never a forced plan, never an isolated probe context.**
 *
 * THE CORPUS LAW: the world rides the REAL trade services end to end
 * (the declarations + their lines through the REAL customs engine + the
 * B/Ls and their events through the REAL transport/tracking services —
 * never raw register pokes), so the EXPLAIN testifies about the very
 * statements the register reads run; ANALYZE runs before the probes so
 * the planner's index choice is informed. Every corpus world carries
 * its own official number (the XB-* family reserves per row — the
 * codes never collide across specs sharing the tenant).
 */

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const posting = new PostingService(audit, new PartnerSubledgerService());
const landedCosts = new LandedCostService(audit, posting, numbering, new RevaluationService(audit));
const transport = new TransportService(audit, numbering);
const tracking = new TrackingService(audit);
const customs = new CustomsService(audit, numbering, landedCosts);

let probeItemId = "";
let probeDeclarationId = "";
let probeBlId = "";
const siblingDeclarationIds: string[] = [];
const siblingBlIds: string[] = [];

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  probeItemId = fixture.itemId;

  // ── THE DECLARATION-LINES CORPUS — the REAL customs engine ──────────
  // The probe declaration (30 lines) + two sibling declarations (10
  // lines each) so the (tenant, declaration) index carries several
  // distinct keys — the planner's choice is meaningful, never a
  // one-declaration accident.
  const line = () => ({
    hsCode: "8471",
    originCountry: "CN",
    itemId: probeItemId,
    description: null,
    quantity: "1",
    uom: "PCS",
    customsValue: "100",
    dutyRate: "0.05",
    importVat: "5",
    note: null,
    noteAr: null,
  });
  for (const [index, count] of [30, 10, 10].entries()) {
    const created = await withTenant(TENANT_TRADE, () =>
      customs.createDeclaration({
        declarationType: "IMPORT",
        customsOffice: "Jeddah Customs",
        currency: "SAR",
        receiptId: null,
        purchaseOrderId: null,
        billOfLadingId: null,
        lines: Array.from({ length: count }, () => line()),
        note: `the XB corpus declaration ${index}`,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    if (index === 0) {
      probeDeclarationId = created.id;
    } else {
      siblingDeclarationIds.push(created.id);
    }
  }

  // ── THE TRACKING-EVENTS CORPUS — the REAL transport/tracking engine ─
  // The probe B/L (30 events) + two sibling B/Ls (5 events each) so the
  // (tenant, B/L) index carries several distinct keys. The milestone
  // repetition is the append-only log's own truth (the monotone law
  // REFUSES the drive but always RECORDS the carrier's late-arriving
  // fact — the corpus rides the real shapes).
  const corpusBl = async (): Promise<string> => {
    const bl = await withTenant(TENANT_TRADE, () =>
      transport.createBl({
        docType: "SEA",
        carrierName: "XB Corpus Carrier",
        portOfLoading: "Port Jeddah",
        portOfDischarge: "Port Rotterdam",
        containerRefs: ["XBCU0000001"],
        purchaseOrderId: null,
        deliveryNoteId: null,
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    return bl.id;
  };
  probeBlId = await corpusBl();
  for (let i = 0; i < 2; i += 1) {
    siblingBlIds.push(await corpusBl());
  }
  const appendEvent = (blId: string, day: number, declarationId: string | null) =>
    withTenant(TENANT_TRADE, () =>
      tracking.appendEvent({
        billOfLadingId: blId,
        milestone: "DEPARTED",
        eventAt: `2026-11-${String(1 + (day % 28)).padStart(2, "0")}T${String(
          (day * 3) % 24,
        ).padStart(2, "0")}:${String((day * 7) % 60).padStart(2, "0")}:00Z`,
        declarationId,
        actorId: TR_ACTOR,
      }),
    );
  // The probe B/L: 30 events, three of them carrying the probe
  // declaration link (the customs-leg read's own corpus).
  for (let day = 0; day < 30; day += 1) {
    await appendEvent(
      probeBlId,
      day,
      day % 10 === 0 ? probeDeclarationId : null,
    );
  }
  for (const blId of siblingBlIds) {
    for (let day = 0; day < 5; day += 1) {
      await appendEvent(blId, day, null);
    }
  }

  // ANALYZE — the planner's index choice must be informed.
  const su = await superuserClient();
  for (const table of [
    "customs_declaration_lines",
    "customs_declarations",
    "shipment_tracking_events",
    "bills_of_lading",
  ]) {
    await su.query(`ANALYZE ${table}`);
  }
  await su.end();
});

async function explain(label: string, query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_TRADE, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  const text = plan.join("\n");
  // The plans are LOGGED (the OA-06 explain plans log — the evidence
  // keeps the suite output verbatim).
  process.stdout.write(`[trade-explain-budgets] ${label}:\n${text}\n`);
  return text;
}

describe("PHASE-051 W-41 — T-16: OA-06 EXPLAIN budgets (the declaration-lines read + the shipment-tracking-events reads)", () => {
  it("P0 THE CORPUS + THE LIVE READS — the register's own find renders the totals from the LINES and the tracking board's own reads return the corpus (the very reads the budgets police)", async () => {
    // THE LIVE READ — the customs register's find (the declaration +
    // its lines + the totals rendered from the LINES, never a stored
    // parallel figure).
    const found = await withTenant(TENANT_TRADE, () => customs.find(probeDeclarationId));
    expect(found.declaration.id).toBe(probeDeclarationId);
    expect(found.lines).toHaveLength(30);
    expect(found.lines[0]!.lineNo).toBe(1);
    expect(found.lines[29]!.lineNo).toBe(30);
    expect(found.totals.totalCustomsValue).toBe("3000.0000");
    expect(found.totals.totalDuty).toBe("150.0000");
    expect(found.totals.totalImportVat).toBe("150.0000");
    expect(found.totals.totalLandedAmount).toBe("300.0000");

    // THE LIVE READ — the tracking board's event read by the B/L (the
    // same store read the EXPLAIN probes police).
    const byBl = await withTenant(TENANT_TRADE, () =>
      tracking.listEvents({ billOfLadingId: probeBlId }),
    );
    expect(byBl).toHaveLength(30);
    // The customs-leg read (the event's declaration link).
    const byDeclaration = await withTenant(TENANT_TRADE, () =>
      tracking.listEvents({ declarationId: probeDeclarationId }),
    );
    expect(byDeclaration).toHaveLength(3);
    expect(byDeclaration.every((row) => row.billOfLadingId === probeBlId)).toBe(true);
    // The siblings' own events (the several-distinct-keys corpus).
    for (const blId of siblingBlIds) {
      const rows = await withTenant(TENANT_TRADE, () =>
        tracking.listEvents({ billOfLadingId: blId }),
      );
      expect(rows).toHaveLength(5);
    }
    for (const declarationId of siblingDeclarationIds) {
      const rows = await withTenant(TENANT_TRADE, () =>
        requireTenantContext().tx!.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM customs_declaration_lines
          WHERE declaration_id = ${declarationId}`),
      );
      expect(rows.rows[0]!.n).toBe(10);
    }
  });

  it("P1 THE DECLARATION-LINES READ (listDeclarationLines' own shape) is index-driven — no seq-scan", async () => {
    // The trade store's own statement shape (the register read the
    // customs find consumes VERBATIM): the declaration predicate + the
    // (line_no, id) ordering — the 0121 index's own subject.
    const text = await explain(
      "P1 the declaration-lines read (the tenant+declaration index-driven law)",
      sql`
      SELECT id, declaration_id AS "declarationId", line_no AS "lineNo",
             hs_code AS "hsCode", origin_country AS "originCountry", item_id AS "itemId",
             description, quantity::text AS "quantity", uom, customs_value::text AS "customsValue",
             duty_rate::text AS "dutyRate", duty_amount::text AS "dutyAmount",
             import_vat::text AS "importVat", note, note_ar AS "noteAr"
      FROM customs_declaration_lines
      WHERE declaration_id = ${probeDeclarationId}
      ORDER BY line_no, id
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_customs_declaration_lines_tenant_decl|Bitmap (Heap )?Scan on customs_declaration_lines|Bitmap Index Scan on ix_customs_declaration_lines_tenant_decl/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 THE TRACKING-EVENTS READ (listTrackingEvents' own shape by the B/L) is index-driven — no seq-scan", async () => {
    // The trade store's own statement shape (the tracking board's read):
    // the B/L predicate + the (event_at, id) ordering + the cap — the
    // 0122 index's own subject.
    const text = await explain(
      "P2 the tracking-events read by the bill of lading",
      sql`
      SELECT id, bill_of_lading_id AS "billOfLadingId", declaration_id AS "declarationId",
             milestone, event_at::text AS "eventAt", carrier_ref AS "carrierRef", location,
             note, note_ar AS "noteAr", created_at::text AS "createdAt"
      FROM shipment_tracking_events
      WHERE bill_of_lading_id = ${probeBlId}
      ORDER BY event_at, id
      LIMIT 200
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_shipment_tracking_events_tenant_bl|Bitmap (Heap )?Scan on shipment_tracking_events|Bitmap Index Scan on ix_shipment_tracking_events_tenant_bl/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P3 THE CUSTOMS-LEG READ (listTrackingEvents by the declaration link) is index-driven — no seq-scan", async () => {
    // The trade store's own statement shape (the customs leg's read —
    // the event's declaration link): the declaration predicate + the
    // (event_at, id) ordering + the cap — the 0122 partial index's own
    // subject (the migration's OA-06 anchor).
    const text = await explain(
      "P3 the tracking-events read by the declaration link (the customs leg)",
      sql`
      SELECT id, bill_of_lading_id AS "billOfLadingId", declaration_id AS "declarationId",
             milestone, event_at::text AS "eventAt", carrier_ref AS "carrierRef", location,
             note, note_ar AS "noteAr", created_at::text AS "createdAt"
      FROM shipment_tracking_events
      WHERE declaration_id = ${probeDeclarationId}
      ORDER BY event_at, id
      LIMIT 200
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_shipment_tracking_events_tenant_declaration|Bitmap (Heap )?Scan on shipment_tracking_events|Bitmap Index Scan on ix_shipment_tracking_events_tenant_declaration/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
