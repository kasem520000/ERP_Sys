import { describe, expect, it } from "vitest";

import { validateRegistry, registrySnapshot, REPORT_CONTRACTS } from "../../reporting/registry";

/**
 * PHASE-034 T8 · the consolidation-contract registry validation (the
 * sandbox-runnable slice of the reporting-unit meta-tests — the full unit
 * suite's export legs need the live harness (exceljs), exactly as recorded
 * in the PHASE-033 completion report; THIS file imports only the registry,
 * so the four new contracts' boot validation runs everywhere):
 *
 * - the 85-contract registry (76 base + the two PHASE-028 budgeting
 *   rows + the three PHASE-029 payroll rows from the restored lineage +
 *   the four §10 consolidation rows — the restoration merge's union)
 *   validates against the known-permission catalog (a malformed contract
 *   fails startup — REPORT_CONTRACT §2);
 * - the consolidation ids/permissions are exactly the REPORT_CATALOG §10
 *   pins (verbatim keys — the §J reconciliation rule);
 * - every consolidated statement carries the INV-026 headline assertion
 *   with onFailure block-export + the group-view note; the eliminations
 *   log carries the journal-chain tie and drills only to the parent's
 *   books;
 * - statements' data sources name the consolidation module (the §13
 *   readiness matrix's module↔phase cross-check shape).
 */

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set([
  "reporting.reports.run",
  "reporting.reports.export",
  "reporting.templates.manage",
  "reports.financial.tb.read",
  "reports.financial.gl.read",
  "reports.financial.is.read",
  "reports.financial.bs.read",
  "reports.financial.cf.read",
  "reports.financial.close.read",
  "reports.accounting.cost-centers.read",
  "accounting.journals.read",
  "reports.ar.aging.read",
  "reports.ap.aging.read",
  "sales.statements.read",
  "purchasing.statements.read",
  "reports.ar-alloc.read",
  "partners.balances.read",
  "reports.sales.by-item.read",
  "reports.sales.by-customer.read",
  "reports.sales.by-rep.read",
  "reports.sales.by-paymethod.read",
  "reports.sales.pipeline.read",
  "reports.sales.by-branch.read",
  "reports.sales.profitability.read",
  "reports.purchasing.by-supplier.read",
  "reports.purchasing.by-item.read",
  "reports.purchasing.grni.read",
  "purchasing.po.read",
  "reports.purchasing.matching.read",
  "inventory.stock.read",
  "inventory.moves.read",
  "inventory.valuation.read",
  "inventory.batches.read",
  "inventory.counts.read",
  "inventory.serials.read",
  "treasury.cash.read",
  "treasury.receipts.read",
  "treasury.payments.read",
  "treasury.petty.read",
  "treasury.expenses.read",
  "treasury.shifts.read",
  "treasury.bankrec.read",
  "reports.treasury.fx.read",
  "reports.tax.vat-return.read",
  "reports.tax.summary.read",
  "platform.audit.read",
  "platform.users.read",
  "platform.reporting.read",
  "platform.tenants.read",
  "manufacturing.costing.read",
  "manufacturing.genealogy.read",
  "manufacturing.qc.manage",
  "crm.contracts.manage",
  "fixed_assets.reports.view",
  "notes.notes.view",
  "installments.plans.view",
  // PHASE-028/029 (restored lineage, migrations 0042/0043 seeds): the
  // budgeting + payroll report keys ride their own .reports.view grants.
  "budgeting.reports.view",
  "payroll.reports.view",
  // PHASE-034 (0041 seed): the consolidation keys (§3.15)
  "consolidation.reports.view",
  "consolidation.eliminations.create",
]);

const CONSOLIDATION_IDS = [
  "consolidation.consolidated-tb",
  "consolidation.consolidated-is",
  "consolidation.consolidated-bs",
  "consolidation.eliminations-log",
] as const;

describe("PHASE-034 · the consolidation report contracts (REPORT_CATALOG §10)", () => {
  it("the 85-contract registry validates against the known-permission catalog", () => {
    const result = validateRegistry([...REPORT_CONTRACTS], { knownPermissions: KNOWN_PERMISSIONS });
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(85);
  });

  it("the four §10 keys are registered verbatim with consolidation.reports.view", () => {
    const snapshot = registrySnapshot(REPORT_CONTRACTS);
    expect(snapshot).toHaveLength(85);
    for (const id of CONSOLIDATION_IDS) {
      const row = snapshot.find((entry) => entry.id === id);
      expect(row, `${id} must be registered`).toBeDefined();
      expect(row!.requiredPermission).toBe("consolidation.reports.view");
    }
  });

  it("every consolidated statement asserts INV-026 block-on-fail + the group-view label", () => {
    for (const id of CONSOLIDATION_IDS.slice(0, 3)) {
      const contract = REPORT_CONTRACTS.find((entry) => entry.id === id)!;
      const inv026 = contract.assertions.find(
        (assertion) => assertion.id === "inv026-consolidated-equals-members-minus-eliminations",
      );
      expect(inv026, `${id} must carry the inv026 headline assertion`).toBeDefined();
      expect(inv026!.onFailure).toBe("block-export");
      expect(inv026!.invariant).toBe("INV-026");
      // The group-view labeling rides the contract description (every
      // output renders the bilingual description header — group views
      // never replace member statutory books, ADR-0018).
      expect(contract.description.en.toLowerCase()).toContain("consolidat");
    }
    const log = REPORT_CONTRACTS.find((entry) => entry.id === "consolidation.eliminations-log")!;
    const tie = log.assertions.find((assertion) => assertion.id === "eliminations-journal-tie");
    expect(tie).toBeDefined();
    expect(tie!.onFailure).toBe("block-export");
    expect(tie!.invariant).toBe("INV-006");
  });

  it("statements read snapshots — the consolidation module is the declared source", () => {
    for (const id of CONSOLIDATION_IDS) {
      const contract = REPORT_CONTRACTS.find((entry) => entry.id === id)!;
      const consolidationSource = contract.dataSources.find(
        (dataSource) => dataSource.module === "consolidation",
      );
      expect(consolidationSource, `${id} must name the consolidation module`).toBeDefined();
      expect(consolidationSource!.tables).toContain("consolidation_runs");
    }
  });

  it("the eliminations-log drills ONLY into the parent's books (journal route)", () => {
    const log = REPORT_CONTRACTS.find((entry) => entry.id === "consolidation.eliminations-log")!;
    expect(log.drillTargets).toHaveLength(1);
    expect(log.drillTargets[0]!.route).toContain("source=consolidation_elimination");
  });

  it("exports: statements PDF·XLSX·CSV per the catalog rows; the log XLSX·CSV", () => {
    for (const id of CONSOLIDATION_IDS.slice(0, 3)) {
      const contract = REPORT_CONTRACTS.find((entry) => entry.id === id)!;
      expect([...contract.exportFormats].sort()).toEqual(["csv", "pdf", "xlsx"]);
    }
    const log = REPORT_CONTRACTS.find((entry) => entry.id === "consolidation.eliminations-log")!;
    expect([...log.exportFormats].sort()).toEqual(["csv", "xlsx"]);
  });
});
