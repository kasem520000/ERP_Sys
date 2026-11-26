import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { TrackingService } from "../../modules/trade/application/tracking-service";
import { computeDeclarationTotals } from "../../modules/trade/domain/duty-vat-fold";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { registrySnapshot } from "../../modules/reporting/registry/runtime";
import { REPORT_CONTRACTS } from "../../modules/reporting/registry";
import { ALL_KNOWN_PERMISSIONS, fullContext, newRunService } from "../reporting/fixtures";
import { superuserClient } from "../test-db";
import {
  freshTradeBl,
  freshTradeDeclaration,
  freshTradeLc,
  setupTradeFixture,
  TENANT_TRADE,
  TENANT_TRADE_RLS,
  TR_ACTOR,
} from "./fixtures";
import * as tradeStore from "../../modules/trade/infrastructure/trade.store";

/**
 * PHASE-051 (W-40 — T-15, dated 2026-11-26) · `trade-reports.db.spec` —
 * the four trade report contracts over the real registers (the
 * cmms-reports pattern, the quality-reports precedent): every arm runs
 * the contract through the REAL RunService on the trade tenant's own
 * worlds and pins THE ENGINE-VERBATIM LAW (zero parallel computation —
 * every rendered figure re-checked against the module's own reads:
 * the store's listLcs/listDeclarations/listBls/listDrawbackClaims and
 * the REAL folds), the band-fold verdict (the sweep's own fold, never
 * the run), the line-fold totals tie (the same computeDeclarationTotals
 * the completion act rides), the event-log's own truth, the deny paths
 * (one per contract), the tenant-isolation floor, and the registry's
 * own four rows.
 *
 * The worlds (the per-arm-world law «أذرع الرفض كلٌّ على عالمه»): RP-LC
 * (the LC inside the ≤14 band + the unverified discrepancy note + the
 * amendment) · RP-DEC (the declaration with its own two lines whose
 * stored duty figures are the fold's own outputs) · RP-SHIP (the B/L +
 * two REAL appended events — the fold's own driven status) · RP-DBK
 * (the SUBMITTED claim with its export evidence + the honest-dash
 * DRAFT sibling).
 */

const audit = new AuditService(new DrizzleAuditStore());
const tracking = new TrackingService(audit);

let lcId = "";
let declarationId = "";
let blId = "";
let drawbackId = "";
let drawbackDraftId = "";

async function runReport(reportKey: string, params: Record<string, unknown>) {
  const outcome = await withTenant(TENANT_TRADE, () =>
    newRunService().run({
      reportKey,
      params,
      ctx: fullContext(TENANT_TRADE),
    }),
  );
  expect(outcome.status).toBe("SUCCEEDED");
  return outcome.result!;
}

beforeAll(async () => {
  await setupTradeFixture();
  // The database's own CURRENT_DATE (the derived-step clock law — no
  // JavaScript clock anywhere in this spec's world-building).
  const su: Client = await superuserClient();
  const band = await su.query<{ expiry: string }>(
    `SELECT (CURRENT_DATE + 10)::text AS expiry`,
  );
  const bandExpiry = band.rows[0]!.expiry;

  // RP-LC: the LC inside the ≤14 band (10 days out), ISSUED, with an
  // unverified discrepancy note (the store's own open-discrepancy law)
  // and one amendment.
  lcId = await freshTradeLc("RP-LC", {
    status: "ISSUED",
    expiryDate: bandExpiry,
    amount: 60000,
    marginAmount: 6000,
  });
  await su.query(
    `INSERT INTO lc_documents (id, tenant_id, lc_id, doc_type, presented, presented_at, verified, discrepancy_notes, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'BILL_OF_LADING', true, now(), false, 'late presentation', $3)`,
    [TENANT_TRADE, lcId, TR_ACTOR],
  );
  await su.query(
    `INSERT INTO lc_amendments (id, tenant_id, lc_id, amendment_no, change_type, value_from, value_to, created_by)
     VALUES (gen_random_uuid(), $1, $2, 1, 'VALUE', 60000, 66000, $3)`,
    [TENANT_TRADE, lcId, TR_ACTOR],
  );

  // RP-DEC: the declaration with two lines whose duty figures are the
  // fold's own outputs (10% of 10000 = 1000; 5% of 4000 = 200) — the
  // ladder's stamp law honored (submitted then accepted, both stamps).
  declarationId = await freshTradeDeclaration("RP-DEC", {
    declarationType: "IMPORT",
  });
  await su.query(
    `UPDATE customs_declarations
     SET status = 'ACCEPTED', submitted_at = now(), accepted_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [declarationId, TENANT_TRADE],
  );
  await su.query(
    `INSERT INTO customs_declaration_lines
       (id, tenant_id, declaration_id, line_no, hs_code, origin_country, item_id,
        description, quantity, uom, customs_value, duty_rate, duty_amount, import_vat)
     VALUES
       (gen_random_uuid(), $1, $2, 1, '847130', 'CN', NULL, 'RP machines', 10, 'PCS',
        10000, 0.10, 1000, 500),
       (gen_random_uuid(), $1, $2, 2, '854442', 'TR', NULL, 'RP cables', 40, 'M',
        4000, 0.05, 200, 200)`,
    [TENANT_TRADE, declarationId],
  );

  // RP-SHIP: the B/L + two REAL appended events through the REAL
  // TrackingService (the fold's own driven status — DEPARTED then
  // ARRIVED; the monotone ladder's own CAS chain).
  blId = await freshTradeBl("RP-SHIP");
  await withTenant(TENANT_TRADE, async () => {
    await tracking.appendEvent({
      billOfLadingId: blId,
      milestone: "DEPARTED",
      eventAt: "2026-11-20T08:00:00Z",
      carrierRef: "RP-VESSEL-1",
      location: "Port Jeddah",
      actorId: TR_ACTOR,
    });
    await tracking.appendEvent({
      billOfLadingId: blId,
      milestone: "ARRIVED",
      eventAt: "2026-11-24T14:30:00Z",
      carrierRef: "RP-VESSEL-1",
      location: "Port Rotterdam",
      actorId: TR_ACTOR,
    });
  });

  // RP-DBK: the SUBMITTED claim with its export evidence + the
  // honest-dash DRAFT sibling (no evidence links).
  const dbk = await su.query<{ id: string }>(
    `INSERT INTO duty_drawback_claims
       (id, tenant_id, claim_no, export_declaration_id, claimed_amount, currency, status, submitted_at, created_by)
     VALUES (gen_random_uuid(), $1, 'DBK-RP-001', $2, 4500, 'SAR', 'SUBMITTED', now(), $3)
     RETURNING id`,
    [TENANT_TRADE, declarationId, TR_ACTOR],
  );
  drawbackId = dbk.rows[0]!.id;
  const dbkDraft = await su.query<{ id: string }>(
    `INSERT INTO duty_drawback_claims
       (id, tenant_id, claim_no, claimed_amount, currency, status, created_by)
     VALUES (gen_random_uuid(), $1, 'DBK-RP-002', 100, 'SAR', 'DRAFT', $2)
     RETURNING id`,
    [TENANT_TRADE, TR_ACTOR],
  );
  drawbackDraftId = dbkDraft.rows[0]!.id;
  await su.end();
});

describe("PHASE-051 W-40 — T-15: the four trade report contracts (the engine-verbatim law)", () => {
  it("(a) trade.lc-register: the register's own figures verbatim + the sweep's own band fold + the vocabulary PASS", async () => {
    // The store's own read (the verbatim reference).
    const engineRows = await withTenant(TENANT_TRADE, () =>
      tradeStore.listLcs({ status: "ISSUED", limit: 5000 }),
    );
    const engineLc = engineRows.find((row) => row.id === lcId);
    expect(engineLc).toBeDefined();

    const report = await runReport("trade.lc-register", {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      locale: "en",
    });
    const row = report.rows.find((r) => r.key === lcId);
    expect(row).toBeDefined();
    // The register's own figures VERBATIM.
    expect(row!.values.lcNo).toBe(engineLc!.lcNo);
    expect(row!.values.status).toBe("ISSUED");
    expect(row!.values.currency).toBe(engineLc!.currency);
    expect(row!.values.amount).toBe(engineLc!.amount);
    expect(row!.values.marginAmount).toBe(engineLc!.marginAmount);
    // The store's own column list leaves issuing_bank UNALIASED (the raw
    // driver key — the register's own shape); the verbatim tie rides the
    // row's own figure either way.
    expect(row!.values.issuingBank).toBe(
      (engineLc as unknown as { issuing_bank: string }).issuing_bank,
    );
    expect(row!.values.beneficiaryName).toBe(engineLc!.beneficiaryName);
    expect(row!.values.expiryDate).toBe(engineLc!.expiryDate);
    // The checklist's own discrepancy count + the amendments count.
    expect(row!.values.openDiscrepancies).toBe("1");
    expect(row!.values.amendments).toBe("1");
    // THE BAND FOLD (the sweep's own verdict: 10 days out → the ≤14
    // band; the days derived on the DB's own CURRENT_DATE).
    expect(row!.values.daysToExpiry).toBe("10");
    expect((row!.values.band as string).startsWith("≤14")).toBe(true);
    // The vocabulary law PASSes on the coherent world.
    const vocab = report.assertions.find((a) => a.id === "lc-status-vocabulary");
    expect(vocab?.status).toBe("PASS");
    // The totals label carries the register's own counts (the
    // tenant-global register read — the family run's other worlds' LCs
    // ride the same tenant, so the LABEL'S OWN SHAPE is pinned here;
    // this world's own row is pinned above).
    expect(report.totals[0]!.label.en).toMatch(/^LCs: \d+ · issued: \d+ · in alert bands: \d+$/);
  });

  it("(b) trade.customs-declaration-register: the line fold's OWN totals — the same computeDeclarationTotals the completion act rides", async () => {
    // The fold's own output over the store's own lines (the verbatim
    // reference — the same fold the completion act rides).
    const engineLines = await withTenant(TENANT_TRADE, () =>
      tradeStore.listDeclarationLines(declarationId),
    );
    const engineTotals = computeDeclarationTotals(
      engineLines.map((line) => ({
        customsValue: line.customsValue,
        dutyRate: line.dutyRate,
        importVat: line.importVat,
        dutyAmount: line.dutyAmount,
      })),
    );

    const report = await runReport("trade.customs-declaration-register", {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      locale: "en",
    });
    const row = report.rows.find((r) => r.key === declarationId);
    expect(row).toBeDefined();
    expect(row!.values.lines).toBe("2");
    expect(row!.values.totalCustomsValue).toBe(engineTotals.totalCustomsValue);
    expect(row!.values.totalDuty).toBe(engineTotals.totalDuty);
    expect(row!.values.totalImportVat).toBe(engineTotals.totalImportVat);
    expect(row!.values.totalLandedAmount).toBe(engineTotals.totalLandedAmount);
    // The exact figures (10,000 + 4,000 · 1,000 + 200 · 500 + 200 · the
    // landed 1,900 — the fold's own 4dp shape).
    expect(row!.values.totalCustomsValue).toBe("14000.0000");
    expect(row!.values.totalDuty).toBe("1200.0000");
    expect(row!.values.totalImportVat).toBe("700.0000");
    expect(row!.values.totalLandedAmount).toBe("1900.0000");
    const vocab = report.assertions.find((a) => a.id === "declaration-status-vocabulary");
    expect(vocab?.status).toBe("PASS");
  });

  it("(c) trade.shipment-status: the fold's own driven status + the event log's own truth", async () => {
    // The store's own read (the verbatim reference).
    const engineBls = await withTenant(TENANT_TRADE, () =>
      tradeStore.listBls({ limit: 5000 }),
    );
    const engineBl = engineBls.find((row) => row.id === blId);
    expect(engineBl).toBeDefined();
    expect(engineBl!.shipmentStatus).toBe("ARRIVED"); // the REAL service drove it

    const report = await runReport("trade.shipment-status", {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      locale: "en",
    });
    const row = report.rows.find((r) => r.key === blId);
    expect(row).toBeDefined();
    expect(row!.values.blNo).toBe(engineBl!.blNo);
    // THE FOLD'S OWN DRIVEN FIGURE — verbatim from the register's own
    // column (never writable by hand — D-14's own law).
    expect(row!.values.shipmentStatus).toBe("ARRIVED");
    // The event log's own truth: two events, the latest ARRIVED.
    expect(row!.values.events).toBe("2");
    expect(row!.values.latestMilestone).toBe("ARRIVED");
    expect((row!.values.latestEventAt as string).startsWith("2026-11-24")).toBe(true);
    const vocab = report.assertions.find((a) => a.id === "shipment-status-vocabulary");
    expect(vocab?.status).toBe("PASS");
  });

  it("(d) trade.duty-drawback-status: the claims' own figures + the export evidence's own briefs + the honest dash", async () => {
    const engineRows = await withTenant(TENANT_TRADE, () =>
      tradeStore.listDrawbackClaims({ limit: 5000 }),
    );
    const engineClaim = engineRows.find((row) => row.id === drawbackId);
    expect(engineClaim).toBeDefined();

    const report = await runReport("trade.duty-drawback-status", {
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      locale: "en",
    });
    const row = report.rows.find((r) => r.key === drawbackId);
    expect(row).toBeDefined();
    expect(row!.values.claimNo).toBe(engineClaim!.claimNo);
    expect(row!.values.status).toBe("SUBMITTED");
    expect(row!.values.claimedAmount).toBe(engineClaim!.claimedAmount);
    // The export evidence's own brief: the declaration's own number.
    expect(row!.values.exportDeclarationNo).toBe("DEC-RP-DEC");
    expect(row!.values.exportBlNo).toBe("—");
    // The honest dash on the no-evidence DRAFT sibling.
    const draftRow = report.rows.find((r) => r.key === drawbackDraftId);
    expect(draftRow).toBeDefined();
    expect(draftRow!.values.exportDeclarationNo).toBe("—");
    expect(draftRow!.values.exportBlNo).toBe("—");
    const vocab = report.assertions.find((a) => a.id === "drawback-status-vocabulary");
    expect(vocab?.status).toBe("PASS");
  });

  it("(e) the deny paths: sessions without the module key are denied before params bind (one per contract)", async () => {
    const cases: Array<[string, string]> = [
      ["trade.lc-register", "trade.lc.view"],
      ["trade.customs-declaration-register", "trade.customs.view"],
      ["trade.shipment-status", "trade.shipments.view"],
      ["trade.duty-drawback-status", "trade.view"],
    ];
    for (const [reportKey, key] of cases) {
      const denied = new Set([...ALL_KNOWN_PERMISSIONS].filter((entry) => entry !== key));
      const ctx = fullContext(TENANT_TRADE, { permissions: denied });
      await expect(
        withTenant(TENANT_TRADE, () =>
          newRunService().run({
            reportKey,
            params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
            ctx,
          }),
        ),
      ).rejects.toThrowError(PermissionDeniedError);
    }
  });

  it("(f) the reports stay tenant-scoped (the isolation floor — the empty boundary tenant reads zero rows)", async () => {
    for (const reportKey of [
      "trade.lc-register",
      "trade.customs-declaration-register",
      "trade.shipment-status",
      "trade.duty-drawback-status",
    ] as const) {
      const outcome = await withTenant(TENANT_TRADE_RLS, () =>
        newRunService().run({
          reportKey,
          params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", locale: "en" },
          ctx: fullContext(TENANT_TRADE_RLS),
        }),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      expect(outcome.result!.rows).toHaveLength(0);
    }
  });

  it("(g) the registry carries the four rows on the module's own keys (the §12 convention)", () => {
    const snapshot = registrySnapshot([...REPORT_CONTRACTS]);
    expect(snapshot).toHaveLength(126); // PHASE-051 (W-40, T-15, dated 2026-11-26): 122 → 126 (+4 trade: lc-register, customs-declaration-register, shipment-status, duty-drawback-status)
    const byId = new Map(snapshot.map((row) => [row.id, row]));
    expect(byId.get("trade.lc-register")?.requiredPermission).toBe("trade.lc.view");
    expect(byId.get("trade.customs-declaration-register")?.requiredPermission).toBe("trade.customs.view");
    expect(byId.get("trade.shipment-status")?.requiredPermission).toBe("trade.shipments.view");
    expect(byId.get("trade.duty-drawback-status")?.requiredPermission).toBe("trade.view");
    // The bilingual titles (registry-bilingual, never dictionary keys).
    expect(byId.get("trade.lc-register")?.title.ar).toBe("سجل الاعتمادات المستندية");
    expect(byId.get("trade.lc-register")?.title.en).toBe("LC Register");
    expect(byId.get("trade.shipment-status")?.title.en).toBe("Shipment Status");
  });
});
